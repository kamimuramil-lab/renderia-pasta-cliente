// lib/hub.js
// Hub do cliente (nov/2026): o que o Rodrigo tinha nas páginas do Notion e o cliente via -- dados do projeto,
// links externos (Tour Virtual, Dashboard) e DOCUMENTOS (planta original, conceitual, executivo, visitas).
// Camada de dados pura (sem servidor/rede), testável com Node puro, no mesmo padrão do lib/galeria.js.
//
// Decisões do Rodrigo (spec em docs/spec-hub-cliente.md):
//  - os arquivos ficam no Google Drive; aqui se guarda só o LINK (nada de upload de PDF/DWG pro R2);
//  - cada documento tem status ATUAL / REVISAO / ANTIGA e número de revisão (REV.0, REV.1...);
//  - ao salvar um documento novo como ATUAL, o app MOSTRA qual vai virar ANTIGA e só depois aplica. O servidor
//    NUNCA arquiva sozinho: só arquiva os ids que o app mandar em `substituirIds` (um grupo pode ter 2 documentos
//    diferentes sem pavimento -- ex.: dois memoriais --, e arquivar o errado seria grave). A chave que SUGERE
//    candidatos é (seção + grupo + pavimento), porque casa de 2 andares tem um documento de cada.
const crypto = require('crypto');
const galeria = require('./galeria');

const SECOES = ['planta_original', 'conceitual', 'executivo', 'visitas'];
const STATUS_DOCUMENTO = ['ATUAL', 'REVISAO', 'ANTIGA'];
const CHAVES_LINK = ['tourVirtual', 'dashboard'];
const GRUPOS_EXECUTIVO_PADRAO = [
  'Demolição e Construção',
  'Pontos e Acionadores',
  'Iluminação e Circuitos',
  'Planta de Forro',
  'Pintura e Revestimentos',
  'Mármores e Granitos',
  'Móveis Planejados / Marcenaria',
  'Memorial de Itens'
];
const LIMITE_DOCUMENTOS_POR_PROJETO = 300;
const LIMITE_GRUPOS = 30;

// ---------- validação ----------
function textoLimpo(valor, max, campo) {
  if (valor === undefined || valor === null) return '';
  if (typeof valor !== 'string') throw new Error(`${campo} precisa ser texto.`);
  const t = valor.trim();
  if (t.length > max) throw new Error(`${campo} passa de ${max} caracteres.`);
  return t;
}

// Só http/https: nunca aceita "javascript:" nem outro esquema (o link é aberto pelo cliente final).
function urlValida(valor, campo) {
  const t = textoLimpo(valor, 2000, campo);
  if (!t) throw new Error(`${campo} é obrigatório.`);
  let u;
  try { u = new URL(t); } catch (e) { throw new Error(`${campo} inválido (cole o endereço completo, começando com https://).`); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(`${campo} inválido (só endereços http/https).`);
  return t;
}

function normalizar(texto) {
  return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function revisaoValida(valor) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 0 || n > 99) throw new Error('Revisão inválida (use um número inteiro de 0 a 99).');
  return n;
}

function gruposDoExecutivo(hub) {
  return Array.isArray(hub.gruposExecutivo) && hub.gruposExecutivo.length ? hub.gruposExecutivo : GRUPOS_EXECUTIVO_PADRAO;
}

// ---------- dados do projeto, links e grupos ----------
function atualizarHub(caminho, projetoId, { dadosProjeto, links, gruposExecutivo, capaFotoId }, licencaUsuario) {
  const estado = galeria.lerEstado(caminho);
  const g = galeria.exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  const hub = g.hub;

  // Valida tudo ANTES de mexer em qualquer coisa (se algo for inválido, nada é gravado).
  const novoTexto = dadosProjeto !== undefined ? textoLimpo(dadosProjeto, 2000, 'Dados do projeto') : undefined;
  let novosLinks;
  if (links !== undefined) {
    if (!links || typeof links !== 'object' || Array.isArray(links)) throw new Error('Links inválidos.');
    novosLinks = { ...hub.links };
    Object.keys(links).forEach((chave) => {
      if (!CHAVES_LINK.includes(chave)) throw new Error(`Link desconhecido: ${chave}.`);
      const item = links[chave];
      if (!item || !item.url || !String(item.url).trim()) { delete novosLinks[chave]; return; } // vazio = remove
      novosLinks[chave] = { url: urlValida(item.url, 'Endereço do link'), titulo: textoLimpo(item.titulo, 80, 'Título do link') };
    });
  }
  let novosGrupos;
  if (gruposExecutivo !== undefined) {
    if (gruposExecutivo === null) novosGrupos = null;
    else {
      if (!Array.isArray(gruposExecutivo)) throw new Error('Grupos do executivo inválidos.');
      const vistos = new Set();
      novosGrupos = [];
      gruposExecutivo.forEach((nome) => {
        const limpo = textoLimpo(nome, 80, 'Nome do grupo');
        if (limpo && !vistos.has(normalizar(limpo))) { vistos.add(normalizar(limpo)); novosGrupos.push(limpo); }
      });
      if (novosGrupos.length > LIMITE_GRUPOS) throw new Error(`No máximo ${LIMITE_GRUPOS} grupos.`);
      if (!novosGrupos.length) novosGrupos = null;
    }
  }

  // Capa: uma foto FIXA do próprio projeto (a 360° é equirretangular e ficaria deformada como capa). null = capa padrão.
  let novaCapa;
  if (capaFotoId !== undefined) {
    if (capaFotoId === null || capaFotoId === '') novaCapa = null;
    else {
      const foto = g.fotos.find((f) => f.id === capaFotoId);
      if (!foto) throw new Error('Foto da capa não encontrada nesse projeto.');
      if (foto.tipo === '360') throw new Error('A foto 360° não pode ser a capa: escolha uma imagem fixa.');
      novaCapa = foto.id;
    }
  }

  if (novaCapa !== undefined) hub.capaFotoId = novaCapa;
  if (novoTexto !== undefined) hub.dadosProjeto = novoTexto;
  if (novosLinks !== undefined) hub.links = novosLinks;
  if (novosGrupos !== undefined) hub.gruposExecutivo = novosGrupos;
  g.atualizadoEm = new Date().toISOString();
  galeria.salvarEstado(caminho, estado);
  return hub;
}

// ---------- documentos ----------
function mesmaChave(a, b) {
  return a.secao === b.secao && normalizar(a.grupo) === normalizar(b.grupo) && normalizar(a.pavimento) === normalizar(b.pavimento);
}

function candidatosASubstituir(hub, chave, ignorarId) {
  return hub.documentos.filter((d) => d.id !== ignorarId && d.status === 'ATUAL' && mesmaChave(d, chave));
}

function revisaoSugerida(hub, chave) {
  const mesmos = hub.documentos.filter((d) => mesmaChave(d, chave));
  return mesmos.length ? Math.max(...mesmos.map((d) => d.revisao)) + 1 : 0;
}

function resumoCandidato(d) {
  return { id: d.id, titulo: d.titulo, revisao: d.revisao, pavimento: d.pavimento };
}

function validarChave({ secao, grupo, pavimento }) {
  if (!SECOES.includes(secao)) throw new Error('Seção inválida.');
  const g = textoLimpo(grupo, 80, 'Grupo');
  if (secao === 'executivo' && !g) throw new Error('Informe o grupo do documento do projeto executivo.');
  return { secao, grupo: secao === 'executivo' ? g : '', pavimento: textoLimpo(pavimento, 60, 'Pavimento') };
}

// Mostra, SEM gravar nada, o que viraria ANTIGA e qual revisão seria a próxima -- o app usa isso pra perguntar.
function preverSubstituicao(caminho, projetoId, entrada, licencaUsuario) {
  const estado = galeria.lerEstado(caminho);
  const g = galeria.exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  const chave = validarChave(entrada || {});
  return {
    substituiria: candidatosASubstituir(g.hub, chave, entrada && entrada.ignorarId).map(resumoCandidato),
    revisaoSugerida: revisaoSugerida(g.hub, chave)
  };
}

// Marca como ANTIGA os ids confirmados. Só vale se o documento novo/editado ficou ATUAL; tudo é conferido
// ANTES de mudar algo (quem chama só salva depois, então um id errado não deixa meia mudança gravada).
function aplicarSubstituicao(hub, statusFinal, substituirIds, idDoNovo) {
  if (statusFinal !== 'ATUAL' || substituirIds === undefined || substituirIds === null) return [];
  if (!Array.isArray(substituirIds)) throw new Error('substituirIds precisa ser uma lista.');
  const unicos = [...new Set(substituirIds)];
  const alvos = unicos.map((id) => {
    const d = hub.documentos.find((x) => x.id === id);
    if (!d || id === idDoNovo) throw new Error('Documento a substituir não encontrado.');
    return d;
  });
  const agora = new Date().toISOString();
  alvos.forEach((d) => { d.status = 'ANTIGA'; d.atualizadoEm = agora; });
  return alvos.map(resumoCandidato);
}

function adicionarDocumento(caminho, projetoId, entrada, licencaUsuario) {
  const estado = galeria.lerEstado(caminho);
  const g = galeria.exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  const hub = g.hub;
  if (hub.documentos.length >= LIMITE_DOCUMENTOS_POR_PROJETO) throw new Error(`Limite de ${LIMITE_DOCUMENTOS_POR_PROJETO} documentos por projeto atingido.`);

  const chave = validarChave(entrada || {});
  const titulo = textoLimpo(entrada.titulo, 120, 'Título');
  if (!titulo) throw new Error('Título é obrigatório.');
  const status = entrada.status === undefined ? 'ATUAL' : entrada.status;
  if (!STATUS_DOCUMENTO.includes(status)) throw new Error('Status inválido.');
  const agora = new Date().toISOString();
  const doc = {
    id: 'doc_' + crypto.randomBytes(6).toString('hex'),
    ...chave,
    titulo,
    revisao: entrada.revisao === undefined || entrada.revisao === null ? revisaoSugerida(hub, chave) : revisaoValida(entrada.revisao),
    status,
    url: urlValida(entrada.url, 'Link do documento'),
    observacao: textoLimpo(entrada.observacao, 500, 'Observação'),
    criadoEm: agora,
    atualizadoEm: agora
  };
  const substituidos = aplicarSubstituicao(hub, status, entrada.substituirIds, doc.id);
  hub.documentos.push(doc);
  g.atualizadoEm = agora;
  galeria.salvarEstado(caminho, estado);
  return { documento: doc, substituidos };
}

function editarDocumento(caminho, projetoId, docId, entrada, licencaUsuario) {
  const estado = galeria.lerEstado(caminho);
  const g = galeria.exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  const hub = g.hub;
  const doc = hub.documentos.find((d) => d.id === docId);
  if (!doc) throw new Error('Documento não encontrado.');
  entrada = entrada || {};

  // Valida tudo antes de aplicar.
  const novo = {};
  if (entrada.titulo !== undefined) { novo.titulo = textoLimpo(entrada.titulo, 120, 'Título'); if (!novo.titulo) throw new Error('Título é obrigatório.'); }
  if (entrada.grupo !== undefined || entrada.pavimento !== undefined) {
    const chave = validarChave({ secao: doc.secao, grupo: entrada.grupo !== undefined ? entrada.grupo : doc.grupo, pavimento: entrada.pavimento !== undefined ? entrada.pavimento : doc.pavimento });
    novo.grupo = chave.grupo; novo.pavimento = chave.pavimento;
  }
  if (entrada.revisao !== undefined) novo.revisao = revisaoValida(entrada.revisao);
  if (entrada.status !== undefined) { if (!STATUS_DOCUMENTO.includes(entrada.status)) throw new Error('Status inválido.'); novo.status = entrada.status; }
  if (entrada.url !== undefined) novo.url = urlValida(entrada.url, 'Link do documento');
  if (entrada.observacao !== undefined) novo.observacao = textoLimpo(entrada.observacao, 500, 'Observação');

  const statusFinal = novo.status !== undefined ? novo.status : doc.status;
  const substituidos = aplicarSubstituicao(hub, statusFinal, entrada.substituirIds, doc.id);
  Object.assign(doc, novo, { atualizadoEm: new Date().toISOString() });
  g.atualizadoEm = doc.atualizadoEm;
  galeria.salvarEstado(caminho, estado);
  return { documento: doc, substituidos };
}

function excluirDocumento(caminho, projetoId, docId, licencaUsuario) {
  const estado = galeria.lerEstado(caminho);
  const g = galeria.exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  const indice = g.hub.documentos.findIndex((d) => d.id === docId);
  if (indice < 0) throw new Error('Documento não encontrado.');
  g.hub.documentos.splice(indice, 1);
  g.atualizadoEm = new Date().toISOString();
  galeria.salvarEstado(caminho, estado);
  return true;
}

module.exports = {
  SECOES, STATUS_DOCUMENTO, CHAVES_LINK, GRUPOS_EXECUTIVO_PADRAO, LIMITE_DOCUMENTOS_POR_PROJETO,
  gruposDoExecutivo, atualizarHub, preverSubstituicao, adicionarDocumento, editarDocumento, excluirDocumento
};
