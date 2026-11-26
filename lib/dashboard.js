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

// Dono (licença) do link do dashboard, ou null -- só pro registro de atividades.
function licencaDoLink(caminho, linkToken) {
  const achada = acharContaPeloLink(galeria.lerEstado(caminho), linkToken);
  return achada ? achada.licenca : null;
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

// ---------- listas da conta (catálogo): arquitetos, tipos de projeto e situações ----------
// Os nomes que o arquiteto cadastra ficam REGISTRADOS na conta (valem pra todos os projetos): é só escolher na lista nos demais.
// Tipos e situações podem ganhar itens novos além dos padrões. A lista que o app/dashboard mostra = o que foi cadastrado + o que
// algum projeto já usa. Item em uso por algum projeto não pode ser removido (senão o projeto ficaria com uma etiqueta "órfã").
const LISTAS = ['arquitetos', 'tipos', 'situacoes'];
const TIPOS_PADRAO = TIPOS;
const SITUACOES_PADRAO = [{ id: 'andamento', nome: 'Em andamento' }, { id: 'concluido', nome: 'Concluído' }];
const LIMITE_ITENS_CATALOGO = 60;
const LIMITE_NOME_CATALOGO = 40;
const mesmoNome = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

function catalogosBrutos(estado) {
  if (!estado.catalogosDash || typeof estado.catalogosDash !== 'object' || Array.isArray(estado.catalogosDash)) estado.catalogosDash = {};
  return estado.catalogosDash;
}
// HISTÓRICO do que foi apagado ou renomeado "em tudo": [{ lista, de, para (null = apagado), em }], na ordem em que aconteceu. É a memória
// que impede um computador desatualizado de trazer de volta um nome antigo (o app aplica no que está guardado nele; o servidor traduz ou
// recusa o que chegar com nome antigo). Criar o nome DE PROPÓSITO outra vez (reviver) tira o registro.
const LIMITE_HISTORICO = 500;
const historicoDe = (estado, licencaUsuario) => {
  const h = (catalogosBrutos(estado)[licencaUsuario] || {}).historico;
  return Array.isArray(h) ? h.filter((e) => e && LISTAS.includes(e.lista) && typeof e.de === 'string') : [];
};
// -> o nome como é hoje, ou null se foi apagado
function resolverNome(historico, lista, nome) {
  let atual = String(nome).replace(/\s+/g, ' ').trim();
  for (const e of historico) {
    if (e.lista !== lista || !mesmoNome(e.de, atual)) continue;
    if (e.para === null) return null;
    atual = e.para;
  }
  return atual;
}
const registroDaConta = (estado, licencaUsuario) => {
  const bruto = catalogosBrutos(estado);
  return (bruto[licencaUsuario] = Object.assign({ arquitetos: [], tipos: [], situacoes: [] }, bruto[licencaUsuario]));
};
const reviverNome = (conta, lista, nome) => {
  const antes = Array.isArray(conta.historico) ? conta.historico : [];
  conta.historico = antes.filter((e) => !(e.lista === lista && mesmoNome(e.de, nome)));
  return conta.historico.length !== antes.length;
};
const anotarNoHistorico = (conta, lista, de, para) => {
  conta.historico = (Array.isArray(conta.historico) ? conta.historico : []).concat([{ lista, de, para, em: new Date().toISOString() }]).slice(-LIMITE_HISTORICO);
};

function catalogoGuardado(estado, licencaUsuario) {
  const c = catalogosBrutos(estado)[licencaUsuario] || {};
  const textos = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()) : []);
  return {
    arquitetos: textos(c.arquitetos),
    tipos: textos(c.tipos),
    situacoes: (Array.isArray(c.situacoes) ? c.situacoes : []).filter((s) => s && typeof s.id === 'string' && typeof s.nome === 'string' && s.nome.trim())
  };
}
function juntarSemRepetir(...listas) {
  const saida = [];
  listas.forEach((l) => l.forEach((n) => { if (!saida.some((x) => mesmoNome(x, n))) saida.push(n); }));
  return saida;
}

// Catálogo completo da conta, com quantos projetos usam cada item (a tela esconde o "remover" do que está em uso).
function catalogoDe(estado, licencaUsuario) {
  const guardado = catalogoGuardado(estado, licencaUsuario);
  const galerias = (estado.galerias || []).filter((g) => g.licencaUsuario === licencaUsuario);
  const metas = galerias.map((g) => ({ meta: (g.meta && typeof g.meta === 'object') ? g.meta : {}, g }));
  const usadosArq = metas.flatMap(({ meta }) => (Array.isArray(meta.arquitetos) ? meta.arquitetos : [])).filter((a) => typeof a === 'string' && a.trim());
  const nomesArq = juntarSemRepetir(guardado.arquitetos, usadosArq).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const tiposUsados = metas.map(({ g }) => metaBasica(g).tipo).filter(Boolean);
  const nomesTipos = juntarSemRepetir(TIPOS_PADRAO, guardado.tipos, tiposUsados);
  const situacoes = SITUACOES_PADRAO.concat(guardado.situacoes.filter((s) => !SITUACOES_PADRAO.some((p) => p.id === s.id)));
  const conta = (lista, igual) => lista.filter(igual).length;
  const idsValidos = situacoes.map((s) => s.id);
  const situacaoEfetiva = (g) => { const s = metaBasica(g).situacao; return idsValidos.includes(s) ? s : 'andamento'; }; // item removido/desconhecido conta como "Em andamento", igual ao cartão
  return {
    arquitetos: nomesArq.map((nome) => ({ nome, usos: conta(metas, ({ meta }) => (meta.arquitetos || []).some((a) => mesmoNome(a, nome))) })),
    tipos: nomesTipos.map((nome) => ({ nome, padrao: TIPOS_PADRAO.includes(nome), usos: conta(metas, ({ g }) => mesmoNome(metaBasica(g).tipo, nome)) })),
    situacoes: situacoes.map((s) => ({ id: s.id, nome: s.nome, padrao: SITUACOES_PADRAO.some((p) => p.id === s.id), usos: conta(metas, ({ g }) => situacaoEfetiva(g) === s.id) })),
    historico: historicoDe(estado, licencaUsuario)
  };
}

function nomeDoCatalogo(valor) {
  if (typeof valor !== 'string') throw new Error('Nome inválido.');
  const nome = valor.replace(/\s+/g, ' ').trim();
  if (!nome) throw new Error('Escreva um nome.');
  if (nome.length > LIMITE_NOME_CATALOGO) throw new Error(`O nome passa de ${LIMITE_NOME_CATALOGO} caracteres.`);
  return nome;
}

// Acrescenta um item à lista (idempotente: o que já existe, com a mesma escrita ou só com outra caixa de letras, não duplica).
// opcoes.reviver = a pessoa está criando o nome DE PROPÓSITO (mesmo que ele já tenha sido apagado). Sem isso (envio automático de um
// computador), nome apagado é recusado e nome renomeado vira o novo.
function adicionarAoCatalogo(caminho, licencaUsuario, lista, nomeBruto, opcoes = {}) {
  if (!licencaUsuario) throw new Error('licencaUsuario é obrigatório.');
  if (!LISTAS.includes(lista)) throw new Error('Lista inválida.');
  let nome = nomeDoCatalogo(nomeBruto);
  const estado = galeria.lerEstado(caminho);
  let reviveu = false;
  if (opcoes.reviver) reviveu = reviverNome(registroDaConta(estado, licencaUsuario), lista, nome);
  else {
    const hoje = resolverNome(historicoDe(estado, licencaUsuario), lista, nome);
    if (hoje === null) return { adicionado: false, apagado: true, nome, catalogo: catalogoDe(estado, licencaUsuario) };
    nome = hoje;
  }
  const atual = catalogoDe(estado, licencaUsuario);
  const jaExiste = atual[lista].find((x) => mesmoNome(x.nome, nome));
  if (jaExiste) {
    if (reviveu) galeria.salvarEstado(caminho, estado);
    return { adicionado: false, nome: jaExiste.nome, id: jaExiste.id || undefined, catalogo: catalogoDe(estado, licencaUsuario) };
  }
  if (atual[lista].length >= LIMITE_ITENS_CATALOGO) throw new Error(`Chegou ao limite de ${LIMITE_ITENS_CATALOGO} itens nessa lista.`);
  const bruto = catalogosBrutos(estado);
  const guardado = bruto[licencaUsuario] = Object.assign({ arquitetos: [], tipos: [], situacoes: [] }, bruto[licencaUsuario]);
  let id;
  if (lista === 'situacoes') {
    do { id = 'sit_' + novoToken(3); } while (atual.situacoes.some((s) => s.id === id));
    guardado.situacoes = (Array.isArray(guardado.situacoes) ? guardado.situacoes : []).concat([{ id, nome }]);
  } else {
    guardado[lista] = (Array.isArray(guardado[lista]) ? guardado[lista] : []).concat([nome]);
  }
  galeria.salvarEstado(caminho, estado);
  return { adicionado: true, nome, id, catalogo: catalogoDe(estado, licencaUsuario) };
}

// Remove da lista (a "chave" é o nome; nas situações, o id). Padrão e item em uso por algum projeto não saem.
function removerDoCatalogo(caminho, licencaUsuario, lista, chave) {
  if (!licencaUsuario) throw new Error('licencaUsuario é obrigatório.');
  if (!LISTAS.includes(lista)) throw new Error('Lista inválida.');
  if (typeof chave !== 'string' || !chave.trim()) throw new Error('Escolha o item a remover.');
  const estado = galeria.lerEstado(caminho);
  const atual = catalogoDe(estado, licencaUsuario);
  const item = atual[lista].find((x) => (lista === 'situacoes' ? x.id === chave : mesmoNome(x.nome, chave)));
  if (!item) throw new Error('Esse item não está na lista.');
  if (item.padrao) throw new Error(`"${item.nome}" é um item padrão e não pode ser removido.`);
  if (item.usos > 0) throw new Error(`"${item.nome}" está em uso em ${item.usos} ${item.usos === 1 ? 'projeto' : 'projetos'}. Troque nesses projetos antes de remover.`);
  const guardado = catalogosBrutos(estado)[licencaUsuario];
  if (guardado) {
    if (lista === 'situacoes') guardado.situacoes = (guardado.situacoes || []).filter((s) => s.id !== chave);
    else guardado[lista] = (guardado[lista] || []).filter((n) => !mesmoNome(n, chave));
  }
  galeria.salvarEstado(caminho, estado);
  return { catalogo: catalogoDe(estado, licencaUsuario) };
}

// APAGAR e RENOMEAR "em tudo": valem para TODOS os projetos da conta, inclusive os que não estão no computador de quem pediu, e ficam
// no histórico. Os itens padrão não saem nem mudam de nome (mas dá pra juntar um nome seu a um padrão).
const itemPadrao = (lista, nome) => (lista === 'tipos' ? TIPOS_PADRAO.some((t) => mesmoNome(t, nome)) : (lista === 'situacoes' ? SITUACOES_PADRAO.some((s) => mesmoNome(s.nome, nome)) : false));

// Troca (para = nome) ou tira (para = null) o nome em todas as galerias da conta e na lista guardada. -> quantos projetos usavam
function trocarEmTudo(estado, licencaUsuario, conta, lista, de, para) {
  let afetados = 0;
  const todas = (estado.galerias || []).filter((g) => g.licencaUsuario === licencaUsuario);
  const mudar = (g, meta) => { g.meta = Object.assign({}, g.meta && typeof g.meta === 'object' ? g.meta : {}, meta); g.atualizadoEm = new Date().toISOString(); afetados++; };
  if (lista === 'situacoes') {
    const guardadas = Array.isArray(conta.situacoes) ? conta.situacoes : [];
    const todasSit = SITUACOES_PADRAO.concat(guardadas);
    const origem = todasSit.find((s) => mesmoNome(s.nome, de));
    const destino = para === null ? SITUACOES_PADRAO[0] : todasSit.find((s) => mesmoNome(s.nome, para) && !(origem && s.id === origem.id));
    if (origem && destino) {
      todas.forEach((g) => { if (metaBasica(g).situacao === origem.id) mudar(g, { situacao: destino.id }); });
      conta.situacoes = guardadas.filter((s) => s.id !== origem.id);
    } else if (origem) {
      afetados = todas.filter((g) => metaBasica(g).situacao === origem.id).length; // renomear mantém o id: os projetos já apontam pra ele
      conta.situacoes = guardadas.map((s) => (s.id === origem.id ? { id: s.id, nome: para } : s));
    } else if (para !== null && !destino) {
      conta.situacoes = guardadas.concat([{ id: 'sit_' + novoToken(3), nome: para }]);
    }
    return afetados;
  }
  if (lista === 'arquitetos') {
    todas.forEach((g) => {
      const atuais = metaBasica(g).arquitetos;
      if (!atuais.some((a) => mesmoNome(a, de))) return;
      mudar(g, { arquitetos: juntarSemRepetir(atuais.map((a) => (mesmoNome(a, de) ? para : a)).filter(Boolean)) });
    });
  } else {
    todas.forEach((g) => { if (mesmoNome(metaBasica(g).tipo, de)) mudar(g, { tipo: para || '' }); });
  }
  const guardado = (Array.isArray(conta[lista]) ? conta[lista] : []).filter((n) => !mesmoNome(n, de) && !(para !== null && mesmoNome(n, para)));
  conta[lista] = para === null || itemPadrao(lista, para) ? guardado : guardado.concat([para]);
  return afetados;
}

function excluirEmTudo(caminho, licencaUsuario, lista, nomeBruto) {
  if (!licencaUsuario) throw new Error('licencaUsuario é obrigatório.');
  if (!LISTAS.includes(lista)) throw new Error('Lista inválida.');
  const nome = nomeDoCatalogo(nomeBruto);
  if (itemPadrao(lista, nome)) throw new Error(`"${nome}" é um item padrão e não pode ser removido.`);
  const estado = galeria.lerEstado(caminho);
  const conta = registroDaConta(estado, licencaUsuario);
  const afetados = trocarEmTudo(estado, licencaUsuario, conta, lista, nome, null);
  anotarNoHistorico(conta, lista, nome, null); // mesmo que o nome não exista aqui: outros computadores podem tê-lo
  galeria.salvarEstado(caminho, estado);
  return { afetados, catalogo: catalogoDe(estado, licencaUsuario) };
}

function renomearEmTudo(caminho, licencaUsuario, lista, deBruto, paraBruto) {
  if (!licencaUsuario) throw new Error('licencaUsuario é obrigatório.');
  if (!LISTAS.includes(lista)) throw new Error('Lista inválida.');
  const de = nomeDoCatalogo(deBruto);
  let para = nomeDoCatalogo(paraBruto);
  if (itemPadrao(lista, de)) throw new Error(`"${de}" é um item padrão e não pode mudar de nome.`);
  const estado = galeria.lerEstado(caminho);
  const existente = catalogoDe(estado, licencaUsuario)[lista].find((x) => mesmoNome(x.nome, para));
  if (existente && !mesmoNome(de, para)) para = existente.nome; // juntar com um que já existe: vale a escrita dele
  const conta = registroDaConta(estado, licencaUsuario);
  reviverNome(conta, lista, para);
  const afetados = trocarEmTudo(estado, licencaUsuario, conta, lista, de, para);
  anotarNoHistorico(conta, lista, de, para);
  galeria.salvarEstado(caminho, estado);
  return { afetados, nome: para, catalogo: catalogoDe(estado, licencaUsuario) };
}

function catalogoDaConta(caminho, licencaUsuario) { return catalogoDe(galeria.lerEstado(caminho), licencaUsuario); }

// Etiquetas "cruas" de uma galeria (sem olhar o catálogo): o tipo explícito, senão o que o texto dos dados do projeto diz.
function metaBasica(g) {
  const m = (g.meta && typeof g.meta === 'object') ? g.meta : {};
  return {
    arquitetos: Array.isArray(m.arquitetos) ? m.arquitetos.filter((a) => typeof a === 'string' && a.trim()) : [],
    tipo: typeof m.tipo === 'string' ? m.tipo.trim() : tipoDoTexto(g), // '' gravado = tirado de propósito: não volta pelo texto dos dados
    situacao: typeof m.situacao === 'string' && m.situacao ? m.situacao : 'andamento'
  };
}

// `situacoes` (ids válidos) é opcional: sem ele só as duas padrão valem. Situação desconhecida (item removido) volta a "andamento".
function metaDe(g, situacoes) {
  const b = metaBasica(g);
  const validas = Array.isArray(situacoes) && situacoes.length ? situacoes : SITUACOES_PADRAO.map((s) => s.id);
  return { arquitetos: b.arquitetos, tipo: b.tipo, situacao: validas.includes(b.situacao) ? b.situacao : 'andamento' };
}

function validarMeta(entrada, catalogo) {
  const meta = {};
  if (entrada.arquitetos !== undefined) {
    if (!Array.isArray(entrada.arquitetos)) throw new Error('Arquitetos inválidos.');
    const vistos = new Set();
    meta.arquitetos = [];
    entrada.arquitetos.forEach((a) => {
      if (typeof a !== 'string') throw new Error('Nome de arquiteto inválido.');
      const nome = a.trim();
      if (!nome) return;
      if (nome.length > LIMITE_NOME_CATALOGO) throw new Error(`Nome de arquiteto passa de ${LIMITE_NOME_CATALOGO} caracteres.`);
      const doCatalogo = catalogo && catalogo.arquitetos.find((x) => mesmoNome(x.nome, nome)); // mesma pessoa com outra caixa de letras: usa a escrita já cadastrada
      const final = doCatalogo ? doCatalogo.nome : nome;
      if (!vistos.has(final.toLowerCase())) { vistos.add(final.toLowerCase()); meta.arquitetos.push(final); }
    });
    if (meta.arquitetos.length > LIMITE_ARQUITETOS_POR_PROJETO) throw new Error(`No máximo ${LIMITE_ARQUITETOS_POR_PROJETO} arquitetos por projeto.`);
  }
  if (entrada.tipo !== undefined) {
    const tipos = catalogo ? catalogo.tipos.map((t) => t.nome) : TIPOS_PADRAO;
    const achado = typeof entrada.tipo === 'string' ? tipos.find((t) => mesmoNome(t, entrada.tipo)) : null;
    if (entrada.tipo !== '' && !achado) throw new Error('Tipo inválido: escolha um da lista ou crie um tipo novo.');
    meta.tipo = entrada.tipo === '' ? '' : achado;
  }
  if (entrada.situacao !== undefined) {
    const ids = catalogo ? catalogo.situacoes.map((s) => s.id) : SITUACOES_PADRAO.map((s) => s.id);
    if (!ids.includes(entrada.situacao)) throw new Error('Situação inválida: escolha uma da lista ou crie uma situação nova.');
    meta.situacao = entrada.situacao;
  }
  return meta;
}

// Só o DONO do projeto muda as etiquetas (posse conferida como em todo o servidor). Nome de arquiteto novo já fica REGISTRADO
// na conta, pra aparecer na lista dos outros projetos mesmo depois de sair deste.
function definirMeta(caminho, licencaUsuario, projetoId, entrada) {
  const estado = galeria.lerEstado(caminho);
  const g = galeria.exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  const catalogo = catalogoDe(estado, licencaUsuario);
  // nome antigo vindo de um computador desatualizado: renomeado vira o novo; apagado é ignorado
  const pedido = Object.assign({}, entrada);
  const historico = historicoDe(estado, licencaUsuario);
  if (Array.isArray(pedido.arquitetos)) pedido.arquitetos = pedido.arquitetos.map((a) => (typeof a === 'string' && a.trim() ? resolverNome(historico, 'arquitetos', a) : a)).filter((a) => a !== null);
  if (typeof pedido.tipo === 'string' && pedido.tipo.trim()) {
    const hoje = resolverNome(historico, 'tipos', pedido.tipo);
    if (hoje === null) delete pedido.tipo; else pedido.tipo = hoje;
  }
  const novos = validarMeta(pedido, catalogo); // valida tudo ANTES de gravar
  g.meta = Object.assign({}, g.meta && typeof g.meta === 'object' ? g.meta : {}, novos);
  if (novos.arquitetos && novos.arquitetos.length) {
    const bruto = catalogosBrutos(estado);
    const guardado = bruto[licencaUsuario] = Object.assign({ arquitetos: [], tipos: [], situacoes: [] }, bruto[licencaUsuario]);
    guardado.arquitetos = juntarSemRepetir(Array.isArray(guardado.arquitetos) ? guardado.arquitetos : [], novos.arquitetos).slice(0, LIMITE_ITENS_CATALOGO);
  }
  g.atualizadoEm = new Date().toISOString();
  galeria.salvarEstado(caminho, estado);
  return metaDe(g, catalogoDe(estado, licencaUsuario).situacoes.map((s) => s.id));
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
  const idsSituacao = catalogoDe(estado, licencaUsuario).situacoes.map((s) => s.id);
  return estado.galerias.filter((g) => g.licencaUsuario === licencaUsuario).map((g) => ({
    projetoId: g.projetoId,
    nome: g.nomeProjeto,
    linkToken: g.linkToken,
    meta: metaDe(g, idsSituacao),
    definidas: Object.keys(g.meta && typeof g.meta === 'object' ? g.meta : {}), // o que já foi escolhido (mesmo que vazio)
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
  definirSenha, infoDaConta, linkExiste, licencaDoLink, login, validarSessao, sair,
  metaDe, definirMeta, listarProjetos, abrirComoEscritorio,
  catalogoDaConta, adicionarAoCatalogo, removerDoCatalogo, excluirEmTudo, renomearEmTudo
};
