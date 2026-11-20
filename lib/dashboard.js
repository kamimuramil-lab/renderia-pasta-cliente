// lib/dashboard.js
// Dashboard online (nov/2026): uma página com TODOS os projetos da conta que têm Pasta do Cliente, com filtros (arquiteto,
// nome, tipo, situação) e atalho para abrir a pasta de cada cliente SEM digitar a senha dele (só olhando: "modo escritório").
// Camada de dados pura (sem servidor/rede), testável com Node puro, no mesmo padrão do lib/hub.js e lib/orcamentos.js.
//
// Como se encaixa no que já existe:
//  - a conta é a licença do arquiteto (a mesma que é dona das galerias); a senha mestra é UMA por conta, definida no app;
//  - o dashboard tem link próprio (token) e login próprio: quem não tem a senha mestra não vê nada;
//  - as etiquetas de cada projeto (arquitetos, tipo, situação) ficam em `galeria.meta` (campo opcional: galeria antiga
//    abre igual) e podem ser editadas no app OU no próprio dashboard;
//  - abrir a pasta de um cliente cria uma sessão do cliente marcada `escritorio: true`: o servidor a trata como SÓ LEITURA
//    (aprovar/comentar são recusados) e ela expira em 12 h.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const galeria = require('./galeria');

const TIPOS = ['Interiores', 'Arquitetura'];
const SITUACOES = ['andamento', 'concluido'];
const VALIDADE_SESSAO_MS = 7 * 24 * 60 * 60 * 1000; // o dashboard lembra o login por 7 dias
const LIMITE_SESSOES = 20;
const LIMITE_SESSOES_ESCRITORIO = 40;
const LIMITE_ARQUITETOS_POR_PROJETO = 6;

const novoToken = (bytes) => crypto.randomBytes(bytes).toString('hex');

function contas(estado) {
  if (!estado.dashboards || typeof estado.dashboards !== 'object' || Array.isArray(estado.dashboards)) estado.dashboards = {};
  return estado.dashboards;
}

// ---------- senha mestra e login ----------
// Cria (ou troca) a senha mestra. A primeira vez também cria o link do dashboard; trocar a senha derruba as sessões abertas.
function definirSenha(caminho, licencaUsuario, senha) {
  if (!licencaUsuario) throw new Error('licencaUsuario é obrigatório.');
  if (typeof senha !== 'string' || senha.length < 6) throw new Error('A senha mestra precisa ter pelo menos 6 caracteres.');
  if (senha.length > 100) throw new Error('A senha mestra passa de 100 caracteres.');
  const estado = galeria.lerEstado(caminho);
  const todas = contas(estado);
  let conta = todas[licencaUsuario];
  if (!conta) {
    let linkToken;
    do { linkToken = novoToken(16); } while (Object.values(todas).some((c) => c.linkToken === linkToken));
    conta = todas[licencaUsuario] = { linkToken, senhaHash: null, sessoes: [] };
  }
  conta.senhaHash = bcrypt.hashSync(senha, 10);
  conta.sessoes = [];
  galeria.salvarEstado(caminho, estado);
  return { linkToken: conta.linkToken };
}

function infoDaConta(caminho, licencaUsuario) {
  const conta = contas(galeria.lerEstado(caminho))[licencaUsuario];
  return { temSenha: !!(conta && conta.senhaHash), linkToken: conta && conta.senhaHash ? conta.linkToken : null };
}

function acharContaPeloLink(estado, linkToken) {
  if (!linkToken || typeof linkToken !== 'string') return null;
  const todas = contas(estado);
  const licenca = Object.keys(todas).find((l) => todas[l].linkToken === linkToken && todas[l].senhaHash);
  return licenca ? { licenca, conta: todas[licenca] } : null;
}

// O link existe? (a página de login só mostra "link inválido" se não existir)
function linkExiste(caminho, linkToken) {
  return !!acharContaPeloLink(galeria.lerEstado(caminho), linkToken);
}

function login(caminho, linkToken, senha) {
  const estado = galeria.lerEstado(caminho);
  const achada = acharContaPeloLink(estado, linkToken);
  if (!achada || !bcrypt.compareSync(String(senha || ''), achada.conta.senhaHash)) throw new Error('Senha incorreta.');
  const token = novoToken(24);
  achada.conta.sessoes.push({ token, criadaEm: new Date().toISOString() });
  if (achada.conta.sessoes.length > LIMITE_SESSOES) achada.conta.sessoes.splice(0, achada.conta.sessoes.length - LIMITE_SESSOES);
  galeria.salvarEstado(caminho, estado);
  return token;
}

// -> licencaUsuario da conta, ou null (sessão inexistente, de outra conta ou vencida)
function validarSessao(caminho, linkToken, token) {
  if (!token || typeof token !== 'string') return null;
  const achada = acharContaPeloLink(galeria.lerEstado(caminho), linkToken);
  if (!achada) return null;
  const s = achada.conta.sessoes.find((x) => x.token === token);
  if (!s || Date.now() - Date.parse(s.criadaEm) > VALIDADE_SESSAO_MS) return null;
  return achada.licenca;
}

function sair(caminho, linkToken, token) {
  const estado = galeria.lerEstado(caminho);
  const achada = acharContaPeloLink(estado, linkToken);
  if (!achada) return false;
  achada.conta.sessoes = achada.conta.sessoes.filter((s) => s.token !== token);
  galeria.salvarEstado(caminho, estado);
  return true;
}

// ---------- etiquetas dos projetos ----------
function tipoDoTexto(g) { // projeto antigo sem etiqueta: o tipo sai da linha "Projeto de Interiores 96m²" dos dados do projeto
  const m = String((g.hub && g.hub.dadosProjeto) || '').match(/projeto\s+de\s+(interiores|arquitetura)\b/i);
  return m ? (m[1].toLowerCase() === 'interiores' ? 'Interiores' : 'Arquitetura') : '';
}

function metaDe(g) {
  const m = (g.meta && typeof g.meta === 'object') ? g.meta : {};
  return {
    arquitetos: Array.isArray(m.arquitetos) ? m.arquitetos.filter((a) => typeof a === 'string' && a.trim()) : [],
    tipo: TIPOS.includes(m.tipo) ? m.tipo : tipoDoTexto(g),
    situacao: SITUACOES.includes(m.situacao) ? m.situacao : 'andamento'
  };
}

function validarMeta(entrada) {
  const meta = {};
  if (entrada.arquitetos !== undefined) {
    if (!Array.isArray(entrada.arquitetos)) throw new Error('Arquitetos inválidos.');
    const vistos = new Set();
    meta.arquitetos = [];
    entrada.arquitetos.forEach((a) => {
      if (typeof a !== 'string') throw new Error('Nome de arquiteto inválido.');
      const nome = a.trim();
      if (!nome) return;
      if (nome.length > 40) throw new Error('Nome de arquiteto passa de 40 caracteres.');
      if (!vistos.has(nome.toLowerCase())) { vistos.add(nome.toLowerCase()); meta.arquitetos.push(nome); }
    });
    if (meta.arquitetos.length > LIMITE_ARQUITETOS_POR_PROJETO) throw new Error(`No máximo ${LIMITE_ARQUITETOS_POR_PROJETO} arquitetos por projeto.`);
  }
  if (entrada.tipo !== undefined) {
    if (entrada.tipo !== '' && !TIPOS.includes(entrada.tipo)) throw new Error('Tipo inválido (Interiores ou Arquitetura).');
    meta.tipo = entrada.tipo;
  }
  if (entrada.situacao !== undefined) {
    if (!SITUACOES.includes(entrada.situacao)) throw new Error('Situação inválida (Em andamento ou Concluído).');
    meta.situacao = entrada.situacao;
  }
  return meta;
}

// Só o DONO do projeto muda as etiquetas (posse conferida como em todo o servidor).
function definirMeta(caminho, licencaUsuario, projetoId, entrada) {
  const estado = galeria.lerEstado(caminho);
  const g = galeria.exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  const novos = validarMeta(entrada || {}); // valida tudo ANTES de gravar
  g.meta = Object.assign({}, g.meta && typeof g.meta === 'object' ? g.meta : {}, novos);
  g.atualizadoEm = new Date().toISOString();
  galeria.salvarEstado(caminho, estado);
  return metaDe(g);
}

// Capa do cartão: a foto escolhida como capa do hub; senão a primeira imagem fixa. null = o cartão mostra o logo.
function capaR2KeyDe(g) {
  const fixas = (g.fotos || []).filter((f) => !f.arquivada && f.tipo !== '360');
  const escolhida = g.hub && g.hub.capaFotoId ? fixas.find((f) => f.id === g.hub.capaFotoId) : null;
  const foto = escolhida || [...fixas].sort((a, b) => (a.ordem || 0) - (b.ordem || 0))[0];
  return foto ? foto.r2Key : null;
}

// Projetos da conta (só os que têm Pasta do Cliente, ou seja, todas as galerias dela).
function listarProjetos(caminho, licencaUsuario) {
  const estado = galeria.lerEstado(caminho);
  return estado.galerias.filter((g) => g.licencaUsuario === licencaUsuario).map((g) => ({
    projetoId: g.projetoId,
    nome: g.nomeProjeto,
    linkToken: g.linkToken,
    meta: metaDe(g),
    capaR2Key: capaR2KeyDe(g),
    atualizadoEm: g.atualizadoEm || g.criadoEm || null
  })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

// ---------- abrir a pasta de um cliente SEM a senha dele (só leitura) ----------
function abrirComoEscritorio(caminho, licencaUsuario, projetoId) {
  const estado = galeria.lerEstado(caminho);
  const g = galeria.exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  const token = novoToken(24);
  g.sessoesClienteAtivas.push({ token, criadaEm: new Date().toISOString(), escritorio: true });
  // sessões de escritório não se acumulam sem fim (as do cliente de verdade nunca são tocadas aqui)
  const doEscritorio = g.sessoesClienteAtivas.filter((s) => s.escritorio);
  if (doEscritorio.length > LIMITE_SESSOES_ESCRITORIO) {
    const descartar = new Set(doEscritorio.slice(0, doEscritorio.length - LIMITE_SESSOES_ESCRITORIO).map((s) => s.token));
    g.sessoesClienteAtivas = g.sessoesClienteAtivas.filter((s) => !descartar.has(s.token));
  }
  galeria.salvarEstado(caminho, estado);
  return { linkToken: g.linkToken, token };
}

module.exports = {
  TIPOS, SITUACOES, VALIDADE_SESSAO_MS,
  definirSenha, infoDaConta, linkExiste, login, validarSessao, sair,
  metaDe, definirMeta, listarProjetos, abrirComoEscritorio
};
