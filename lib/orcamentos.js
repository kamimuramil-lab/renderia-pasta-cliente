// lib/orcamentos.js
// Pasta de Orçamentos (nov/2026): o que o Rodrigo tinha na tabela "ORÇAMENTOS" do Notion, agora com LINK, LOGIN e SENHA
// PRÓPRIOS (separados da Pasta do Cliente: se o cliente repassar a Pasta Cliente, quem receber não alcança os valores).
// Camada de dados pura (sem servidor/rede), testável com Node puro, no mesmo padrão do lib/hub.js e do lib/galeria.js.
//
// Regras (spec em docs/spec-hub-cliente.md):
//  - o arquiteto edita tudo no app; o cliente LÊ, abre o PDF (link do Drive), MUDA O STATUS e COMENTA;
//  - o cliente só escolhe entre Análise Cliente / Fechado (aprovar) / Recusado, e só nos orçamentos que já saíram da preparação
//    (só "À fazer" é do escritório: ele só lê; "EVF" o cliente já pode aprovar ou recusar);
//  - toda ação do cliente (status/comentário) vira uma NOVIDADE pro arquiteto (selo no app + lista "o que mudou");
//  - token/sessão daqui NÃO abrem a Pasta do Cliente e os de lá NÃO abrem os orçamentos (listas de sessão separadas).
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const galeria = require('./galeria');
const senhaReversivel = require('./senha-reversivel');
const { lerValorBR } = require('./valor-br');
const cats = require('./orcamentos-categorias');

// Cópia CIFRADA da senha da Pasta de Orçamentos (ver senha-reversivel.js): o hash continua sendo o que vale pra entrar; isto é só pra o
// DONO da licença ver a senha na tela do app. Se não houver como gravar a chave, tudo funciona igual: só não mostra a senha.
function cifrarSenha(senha, caminho) {
  try { return senhaReversivel.cifrar(senha, caminho); } catch (e) { console.error('Aviso: não consegui guardar a cópia cifrada da senha dos orçamentos: ' + e.message); return null; }
}

const STATUS_ORCAMENTO = ['a_fazer', 'evf', 'em_andamento', 'analise_cliente', 'fechado', 'recusado'];
const STATUS_QUE_CLIENTE_ESCOLHE = ['analise_cliente', 'fechado', 'recusado'];
const STATUS_ONDE_CLIENTE_PODE_MUDAR = ['evf', 'em_andamento', 'analise_cliente', 'fechado', 'recusado'];
const LIMITE_ITENS = 100;
const LIMITE_COMENTARIOS_POR_ITEM = 100;
const LIMITE_NOTIFICACOES = 200;
const LIMITE_SESSOES = 50;

// ---------- validação ----------
function textoLimpo(valor, max, campo) {
  if (valor === undefined || valor === null) return '';
  if (typeof valor !== 'string') throw new Error(`${campo} precisa ser texto.`);
  const t = valor.trim();
  if (t.length > max) throw new Error(`${campo} passa de ${max} caracteres.`);
  return t;
}

// Link do orçamento no Drive: opcional, mas se vier só aceita http/https (o cliente final abre esse endereço).
function urlOpcional(valor, campo) {
  const t = textoLimpo(valor, 2000, campo);
  if (!t) return '';
  let u;
  try { u = new URL(t); } catch (e) { throw new Error(`${campo} inválido (cole o endereço completo, começando com https://).`); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(`${campo} inválido (só endereços http/https).`);
  return t;
}

function valorValido(valor) {
  const n = lerValorBR(valor); // aceita 27.252,00 / 27252,00 / R$ 27.252,00
  if (n === null) return null;
  if (n < 0 || n > 1e9) throw new Error('Valor inválido (use um número entre 0 e 1.000.000.000).');
  return Math.round(n * 100) / 100;
}

// Categorias que já vêm prontas em todo projeto (as mesmas do Notion): ver lib/orcamentos-categorias.js. O arquiteto renomeia,
// exclui ou acrescenta. Um orçamento ainda "de enfeite" (À fazer e sem nada preenchido) não aparece pro cliente.
const ITENS_PADRAO = cats.CATEGORIAS_PADRAO;
const ehPlaceholder = cats.ehPlaceholder;
const LIMITE_CATEGORIAS = 60;

function statusValido(s) {
  if (!STATUS_ORCAMENTO.includes(s)) throw new Error('Status inválido.');
  return s;
}

const novoId = (prefixo) => prefixo + crypto.randomBytes(6).toString('hex');

function orcamentosDaGaleria(caminho, projetoId, licencaUsuario) {
  const estado = galeria.lerEstado(caminho);
  const g = galeria.exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  return { estado, g, o: g.orcamentos };
}

function registrarNovidade(o, novidade) {
  o.notificacoes.push(Object.assign({ id: novoId('not_'), quando: new Date().toISOString(), lida: false }, novidade));
  if (o.notificacoes.length > LIMITE_NOTIFICACOES) o.notificacoes.splice(0, o.notificacoes.length - LIMITE_NOTIFICACOES);
  o.temNovidadeNaoLida = true;
}

// ====================================================================
// LADO DO ARQUITETO (sessão do app; posse conferida em toda função)
// ====================================================================

// Cria (ou atualiza) o login da Pasta de Orçamentos. Senha em branco mantém a atual; trocar a senha derruba as sessões.
function definirAcesso(caminho, projetoId, { usuario, senha }, licencaUsuario) {
  const { estado, g, o } = orcamentosDaGaleria(caminho, projetoId, licencaUsuario);
  const nomeUsuario = textoLimpo(usuario, 80, 'Usuário');
  if (!o.acesso) {
    if (!nomeUsuario || !senha) throw new Error('Pra criar a Pasta de Orçamentos pela primeira vez, informe o usuário e a senha.');
    if (typeof senha !== 'string' || senha.length < 4) throw new Error('A senha precisa ter pelo menos 4 caracteres.');
    // O token do link é único em TODAS as galerias (e diferente do token da Pasta do Cliente).
    let linkToken;
    do { linkToken = crypto.randomBytes(16).toString('hex'); }
    while (estado.galerias.some((x) => x.linkToken === linkToken || (x.orcamentos && x.orcamentos.acesso && x.orcamentos.acesso.linkToken === linkToken)));
    o.acesso = { linkToken, usuario: nomeUsuario, senhaHash: bcrypt.hashSync(senha, 10), senhaCifrada: cifrarSenha(senha, caminho), sessoesAtivas: [] };
  } else {
    if (nomeUsuario) o.acesso.usuario = nomeUsuario;
    if (senha) {
      if (typeof senha !== 'string' || senha.length < 4) throw new Error('A senha precisa ter pelo menos 4 caracteres.');
      o.acesso.senhaHash = bcrypt.hashSync(senha, 10);
      o.acesso.senhaCifrada = cifrarSenha(senha, caminho);
      o.acesso.sessoesAtivas = []; // força login de novo com a senha nova
    }
  }
  g.atualizadoEm = new Date().toISOString();
  galeria.salvarEstado(caminho, estado);
  return { linkToken: o.acesso.linkToken, usuario: o.acesso.usuario };
}

// Tudo que o app precisa, SEM hash de senha nem sessões.
function lerParaArquiteto(caminho, projetoId, licencaUsuario) {
  const { estado, g, o } = orcamentosDaGaleria(caminho, projetoId, licencaUsuario);
  // As categorias (e a migração dos itens antigos, que viraram categoria + orçamento dentro) já vêm prontas do galeria.lerEstado.
  // Grava uma vez pra a migração ficar no disco.
  if (!o.categoriasGravadas) { o.categoriasGravadas = true; galeria.salvarEstado(caminho, estado); }
  return {
    // `senha` = a senha atual, SÓ pro dono (null = não disponível: acesso criado antes desta cópia e que o cliente ainda não usou)
    acesso: o.acesso ? { linkToken: o.acesso.linkToken, usuario: o.acesso.usuario, senha: o.acesso.senhaCifrada ? senhaReversivel.decifrar(o.acesso.senhaCifrada, caminho) : null } : null,
    categorias: o.categorias,
    itens: o.itens,
    notificacoes: o.notificacoes,
    temNovidadeNaoLida: o.temNovidadeNaoLida
  };
}

// ---------- categorias (os separadores; os orçamentos ficam dentro delas) ----------
function nomeDaCategoria(nome) {
  const t = textoLimpo(nome, 120, 'Nome da categoria');
  if (!t) throw new Error('Dê um nome à categoria.');
  return t;
}
function categoriaExiste(o, id) { return o.categorias.some((c) => c.id === id); }

function adicionarCategoria(caminho, projetoId, entrada, licencaUsuario) {
  const { estado, g, o } = orcamentosDaGaleria(caminho, projetoId, licencaUsuario);
  const nome = nomeDaCategoria((entrada || {}).nome);
  if (o.categorias.length >= LIMITE_CATEGORIAS) throw new Error(`Limite de ${LIMITE_CATEGORIAS} categorias por projeto atingido.`);
  if (o.categorias.some((c) => cats.norm(c.nome) === cats.norm(nome))) throw new Error('Já existe uma categoria com esse nome.');
  const c = cats.categoriaPorNome(o, nome);
  o.categoriasGravadas = true;
  g.atualizadoEm = new Date().toISOString();
  galeria.salvarEstado(caminho, estado);
  return c;
}

function renomearCategoria(caminho, projetoId, categoriaId, entrada, licencaUsuario) {
  const { estado, g, o } = orcamentosDaGaleria(caminho, projetoId, licencaUsuario);
  const c = o.categorias.find((x) => x.id === categoriaId);
  if (!c) throw new Error('Categoria não encontrada.');
  const nome = nomeDaCategoria((entrada || {}).nome);
  if (o.categorias.some((x) => x.id !== c.id && cats.norm(x.nome) === cats.norm(nome))) throw new Error('Já existe uma categoria com esse nome.');
  c.nome = nome;
  g.atualizadoEm = new Date().toISOString();
  galeria.salvarEstado(caminho, estado);
  return c;
}

// Excluir a categoria leva os orçamentos que estão dentro (o app confirma antes, dizendo quantos).
function excluirCategoria(caminho, projetoId, categoriaId, licencaUsuario) {
  const { estado, g, o } = orcamentosDaGaleria(caminho, projetoId, licencaUsuario);
  const i = o.categorias.findIndex((x) => x.id === categoriaId);
  if (i < 0) throw new Error('Categoria não encontrada.');
  const ids = new Set(o.itens.filter((x) => x.categoriaId === categoriaId).map((x) => x.id));
  o.categorias.splice(i, 1);
  o.itens = o.itens.filter((x) => !ids.has(x.id));
  o.notificacoes = o.notificacoes.filter((n) => !ids.has(n.itemId));
  if (!o.notificacoes.some((n) => !n.lida)) o.temNovidadeNaoLida = false;
  g.atualizadoEm = new Date().toISOString();
  galeria.salvarEstado(caminho, estado);
  return { orcamentosExcluidos: ids.size };
}

// Ordem das categorias (▲▼ no app): o que não veio fica no fim, na ordem de antes (tela desatualizada nunca esconde categoria nova).
function reordenarCategorias(caminho, projetoId, ids, licencaUsuario) {
  const { estado, g, o } = orcamentosDaGaleria(caminho, projetoId, licencaUsuario);
  if (!Array.isArray(ids) || ids.length > LIMITE_CATEGORIAS * 2) throw new Error('Lista de ordem inválida.');
  const porId = new Map(o.categorias.map((c) => [c.id, c]));
  const usados = new Set(); const novas = [];
  ids.forEach((id) => { const c = porId.get(id); if (c && !usados.has(id)) { usados.add(id); novas.push(c); } });
  o.categorias.forEach((c) => { if (!usados.has(c.id)) novas.push(c); });
  o.categorias = novas;
  g.atualizadoEm = new Date().toISOString();
  galeria.salvarEstado(caminho, estado);
  return true;
}

function validarCamposItem(entrada, parcial) {
  const campos = {};
  const presente = (k) => entrada[k] !== undefined;
  if (!parcial || presente('item')) { campos.item = textoLimpo(entrada.item, 120, 'Item'); if (!campos.item) throw new Error('Dê um nome ao item do orçamento.'); }
  if (!parcial || presente('empresa')) campos.empresa = textoLimpo(entrada.empresa, 120, 'Empresa');
  if (!parcial || presente('representante')) campos.representante = textoLimpo(entrada.representante, 120, 'Representante');
  if (!parcial || presente('telefone')) campos.telefone = textoLimpo(entrada.telefone, 40, 'Telefone');
  if (!parcial || presente('valor')) campos.valor = valorValido(entrada.valor);
  if (!parcial || presente('observacao')) campos.observacao = textoLimpo(entrada.observacao, 1000, 'Observação');
  if (!parcial || presente('url')) campos.url = urlOpcional(entrada.url, 'Link do orçamento');
  if (!parcial || presente('status')) campos.status = entrada.status === undefined ? 'a_fazer' : statusValido(entrada.status);
  return campos;
}

function adicionarItem(caminho, projetoId, entrada, licencaUsuario) {
  const { estado, g, o } = orcamentosDaGaleria(caminho, projetoId, licencaUsuario);
  if (o.itens.length >= LIMITE_ITENS) throw new Error(`Limite de ${LIMITE_ITENS} orçamentos por projeto atingido.`);
  const campos = validarCamposItem(entrada || {}, false);
  // Em qual categoria entra: a escolhida (tem que existir). App antigo (sem categoria na tela) = categoria do próprio nome do item.
  const pedida = (entrada || {}).categoriaId;
  if (pedida !== undefined && pedida !== null && pedida !== '') {
    if (!categoriaExiste(o, pedida)) throw new Error('Categoria não encontrada.');
    campos.categoriaId = pedida;
  } else {
    if (o.categorias.length >= LIMITE_CATEGORIAS && !o.categorias.some((c) => cats.norm(c.nome) === cats.norm(cats.nomeSemCopia(campos.item) || campos.item))) throw new Error('Escolha uma categoria para o orçamento.');
    campos.categoriaId = cats.categoriaPorNome(o, cats.nomeSemCopia(campos.item) || campos.item).id;
  }
  const agora = new Date().toISOString();
  const item = Object.assign({ id: novoId('orc_') }, campos, { comentarios: [], criadoEm: agora, atualizadoEm: agora });
  o.itens.push(item);
  g.atualizadoEm = agora;
  galeria.salvarEstado(caminho, estado);
  return item;
}

function editarItem(caminho, projetoId, itemId, entrada, licencaUsuario) {
  const { estado, g, o } = orcamentosDaGaleria(caminho, projetoId, licencaUsuario);
  const item = o.itens.find((x) => x.id === itemId);
  if (!item) throw new Error('Orçamento não encontrado.');
  const campos = validarCamposItem(entrada || {}, true); // valida tudo ANTES de aplicar
  if (entrada && entrada.categoriaId !== undefined) { // mover o orçamento pra outra categoria
    if (!categoriaExiste(o, entrada.categoriaId)) throw new Error('Categoria não encontrada.');
    campos.categoriaId = entrada.categoriaId;
  }
  Object.assign(item, campos, { atualizadoEm: new Date().toISOString() });
  g.atualizadoEm = item.atualizadoEm;
  galeria.salvarEstado(caminho, estado);
  return item;
}

function excluirItem(caminho, projetoId, itemId, licencaUsuario) {
  const { estado, g, o } = orcamentosDaGaleria(caminho, projetoId, licencaUsuario);
  const indice = o.itens.findIndex((x) => x.id === itemId);
  if (indice < 0) throw new Error('Orçamento não encontrado.');
  o.itens.splice(indice, 1);
  o.notificacoes = o.notificacoes.filter((n) => n.itemId !== itemId); // novidade de item que não existe mais não ajuda ninguém
  if (!o.notificacoes.some((n) => !n.lida)) o.temNovidadeNaoLida = false;
  g.atualizadoEm = new Date().toISOString();
  galeria.salvarEstado(caminho, estado);
  return true;
}

// Ordem manual das categorias (▲▼ no app). Recebe os ids na ordem desejada; o que não veio fica no fim, na ordem de antes
// (assim uma tela desatualizada nunca apaga nem esconde um orçamento criado depois). O cliente enxerga nessa mesma ordem.
function reordenarItens(caminho, projetoId, ids, licencaUsuario) {
  const { estado, g, o } = orcamentosDaGaleria(caminho, projetoId, licencaUsuario);
  if (!Array.isArray(ids) || ids.length > LIMITE_ITENS * 2) throw new Error('Lista de ordem inválida.');
  const porId = new Map(o.itens.map((i) => [i.id, i]));
  const usados = new Set();
  const novos = [];
  ids.forEach((id) => { const it = porId.get(id); if (it && !usados.has(id)) { usados.add(id); novos.push(it); } });
  o.itens.forEach((i) => { if (!usados.has(i.id)) novos.push(i); });
  o.itens = novos;
  g.atualizadoEm = new Date().toISOString();
  galeria.salvarEstado(caminho, estado);
  return true;
}

function textoComentario(texto) {
  const t = textoLimpo(texto, 1000, 'Comentário');
  if (!t) throw new Error('Comentário vazio.');
  return t;
}

function acrescentarComentario(item, autor, texto) {
  if (item.comentarios.length >= LIMITE_COMENTARIOS_POR_ITEM) throw new Error(`Esse orçamento já tem ${LIMITE_COMENTARIOS_POR_ITEM} comentários.`);
  const c = { id: novoId('com_'), autor, texto, criadoEm: new Date().toISOString(), lido: autor === 'arquiteto' };
  item.comentarios.push(c);
  return c;
}

function comentarComoArquiteto(caminho, projetoId, itemId, texto, licencaUsuario) {
  const { estado, g, o } = orcamentosDaGaleria(caminho, projetoId, licencaUsuario);
  const item = o.itens.find((x) => x.id === itemId);
  if (!item) throw new Error('Orçamento não encontrado.');
  const c = acrescentarComentario(item, 'arquiteto', textoComentario(texto));
  g.atualizadoEm = c.criadoEm;
  galeria.salvarEstado(caminho, estado);
  return c;
}

// O arquiteto edita só as SUAS mensagens e apaga qualquer uma (inclusive as do cliente).
function editarComentarioDoArquiteto(caminho, projetoId, itemId, comentarioId, texto, licencaUsuario) {
  const { estado, g, o } = orcamentosDaGaleria(caminho, projetoId, licencaUsuario);
  const item = o.itens.find((x) => x.id === itemId);
  if (!item) throw new Error('Orçamento não encontrado.');
  const c = item.comentarios.find((x) => x.id === comentarioId);
  if (!c) throw new Error('Comentário não encontrado.');
  if (c.autor !== 'arquiteto') throw new Error('Só dá para editar as mensagens que você enviou. As do cliente você pode apagar.');
  c.texto = textoComentario(texto);
  c.editadoEm = new Date().toISOString();
  g.atualizadoEm = c.editadoEm;
  galeria.salvarEstado(caminho, estado);
  return c;
}

function excluirComentarioDoArquiteto(caminho, projetoId, itemId, comentarioId, licencaUsuario) {
  const { estado, g, o } = orcamentosDaGaleria(caminho, projetoId, licencaUsuario);
  const item = o.itens.find((x) => x.id === itemId);
  if (!item) throw new Error('Orçamento não encontrado.');
  const i = item.comentarios.findIndex((x) => x.id === comentarioId);
  if (i < 0) throw new Error('Comentário não encontrado.');
  item.comentarios.splice(i, 1);
  g.atualizadoEm = new Date().toISOString();
  galeria.salvarEstado(caminho, estado);
  return true;
}

// O arquiteto abriu a tela: apaga o selo e marca tudo como visto (a lista "o que mudou" continua, só deixa de ser "nova").
function marcarNovidadesLidas(caminho, projetoId, licencaUsuario) {
  const { estado, o } = orcamentosDaGaleria(caminho, projetoId, licencaUsuario);
  o.temNovidadeNaoLida = false;
  o.notificacoes.forEach((n) => { n.lida = true; });
  o.itens.forEach((i) => i.comentarios.forEach((c) => { c.lido = true; }));
  galeria.salvarEstado(caminho, estado);
  return true;
}

// ====================================================================
// LADO DO CLIENTE (público, via link próprio; nunca toca no servidor de licenças)
// ====================================================================
function galeriaPorLinkDeOrcamento(estado, linkToken) {
  if (!linkToken || typeof linkToken !== 'string') return null;
  return estado.galerias.find((g) => g.orcamentos && g.orcamentos.acesso && g.orcamentos.acesso.linkToken === linkToken) || null;
}

function buscarPorLinkToken(caminho, linkToken) {
  return galeriaPorLinkDeOrcamento(galeria.lerEstado(caminho), linkToken);
}

function loginCliente(caminho, linkToken, usuario, senha) {
  const estado = galeria.lerEstado(caminho);
  const g = galeriaPorLinkDeOrcamento(estado, linkToken);
  if (!g) throw new Error('Link não encontrado.');
  const a = g.orcamentos.acesso;
  if (a.usuario !== String(usuario || '').trim() || !bcrypt.compareSync(String(senha || ''), a.senhaHash)) throw new Error('Usuário ou senha incorretos.');
  // Acesso criado antes da cópia cifrada: a senha digitada agora está certa (o hash conferiu), então guarda a cópia pra o dono poder ver.
  if (!a.senhaCifrada) a.senhaCifrada = cifrarSenha(String(senha), caminho);
  const token = crypto.randomBytes(24).toString('hex');
  a.sessoesAtivas.push({ token, criadaEm: new Date().toISOString() });
  if (a.sessoesAtivas.length > LIMITE_SESSOES) a.sessoesAtivas.splice(0, a.sessoesAtivas.length - LIMITE_SESSOES);
  galeria.salvarEstado(caminho, estado);
  return token;
}

function validarTokenCliente(caminho, linkToken, token) {
  const g = buscarPorLinkToken(caminho, linkToken);
  return !!(g && token && g.orcamentos.acesso.sessoesAtivas.some((s) => s.token === token));
}

// O que o cliente enxerga: nada de hash, sessões ou notificações do arquiteto.
function listarParaCliente(caminho, linkToken) {
  const g = buscarPorLinkToken(caminho, linkToken);
  if (!g) throw new Error('Link não encontrado.');
  const visiveis = g.orcamentos.itens.filter((i) => !ehPlaceholder(i));
  return {
    nomeProjeto: g.nomeProjeto,
    // só as categorias que têm algum orçamento já liberado, na ordem que o arquiteto definiu
    categorias: g.orcamentos.categorias.filter((c) => visiveis.some((i) => i.categoriaId === c.id)).map((c) => ({ id: c.id, nome: c.nome })),
    itens: visiveis.map((i) => ({
      id: i.id, categoriaId: i.categoriaId, item: i.item, empresa: i.empresa, representante: i.representante, telefone: i.telefone, valor: i.valor,
      observacao: i.observacao, url: i.url, status: i.status, atualizadoEm: i.atualizadoEm || i.criadoEm || null,
      podeMudarStatus: STATUS_ONDE_CLIENTE_PODE_MUDAR.includes(i.status),
      comentarios: i.comentarios.map((c) => ({ id: c.id, autor: c.autor, texto: c.texto, criadoEm: c.criadoEm }))
    })),
    statusQueClienteEscolhe: STATUS_QUE_CLIENTE_ESCOLHE
  };
}

const nomeDaCategoriaDoItem = (o, item) => { const c = o.categorias.find((x) => x.id === item.categoriaId); return c ? c.nome : ''; };

function itemDoCliente(estado, linkToken, itemId) {
  const g = galeriaPorLinkDeOrcamento(estado, linkToken);
  if (!g) throw new Error('Link não encontrado.');
  const item = g.orcamentos.itens.find((x) => x.id === itemId);
  if (!item) throw new Error('Orçamento não encontrado.');
  return { g, o: g.orcamentos, item };
}

function mudarStatusCliente(caminho, linkToken, itemId, novoStatus) {
  const estado = galeria.lerEstado(caminho);
  const { g, o, item } = itemDoCliente(estado, linkToken, itemId);
  if (!STATUS_QUE_CLIENTE_ESCOLHE.includes(novoStatus)) throw new Error('Esse status não pode ser escolhido por aqui.');
  if (!STATUS_ONDE_CLIENTE_PODE_MUDAR.includes(item.status)) throw new Error('Esse orçamento ainda está sendo preparado pelo escritório.');
  if (item.status === novoStatus) return { mudou: false, status: item.status };
  const de = item.status;
  item.status = novoStatus;
  item.atualizadoEm = new Date().toISOString();
  registrarNovidade(o, { tipo: 'status', itemId: item.id, itemNome: item.item, categoriaNome: nomeDaCategoriaDoItem(o, item), de, para: novoStatus });
  g.atualizadoEm = item.atualizadoEm;
  galeria.salvarEstado(caminho, estado);
  return { mudou: true, status: novoStatus };
}

function comentarCliente(caminho, linkToken, itemId, texto) {
  const estado = galeria.lerEstado(caminho);
  const { g, o, item } = itemDoCliente(estado, linkToken, itemId);
  const t = textoComentario(texto);
  const c = acrescentarComentario(item, 'cliente', t);
  registrarNovidade(o, { tipo: 'comentario', itemId: item.id, itemNome: item.item, categoriaNome: nomeDaCategoriaDoItem(o, item), texto: t.length > 140 ? t.slice(0, 140) + '…' : t });
  g.atualizadoEm = c.criadoEm;
  galeria.salvarEstado(caminho, estado);
  return { id: c.id, autor: c.autor, texto: c.texto, criadoEm: c.criadoEm };
}

module.exports = {
  STATUS_ORCAMENTO, STATUS_QUE_CLIENTE_ESCOLHE, STATUS_ONDE_CLIENTE_PODE_MUDAR, LIMITE_ITENS, LIMITE_CATEGORIAS, ITENS_PADRAO,
  adicionarCategoria, renomearCategoria, excluirCategoria, reordenarCategorias,
  definirAcesso, lerParaArquiteto, adicionarItem, editarItem, excluirItem, comentarComoArquiteto, marcarNovidadesLidas,
  editarComentarioDoArquiteto, excluirComentarioDoArquiteto, reordenarItens,
  buscarPorLinkToken, loginCliente, validarTokenCliente, listarParaCliente, mudarStatusCliente, comentarCliente
};
