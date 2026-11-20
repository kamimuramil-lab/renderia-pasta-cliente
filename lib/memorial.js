// lib/memorial.js
// Memorial de itens (nov/2026): a tabela que o Rodrigo mantinha no Notion (BASE EXECUTIVO filtrada por "MI"):
// setor (COD.), Nº, item, ambiente(s), empresa, especificações, dimensões, quantidade, link, FOTO do produto, valor e
// status da revisão. Camada de dados pura (sem servidor/rede), no mesmo padrão do lib/hub.js e lib/orcamentos.js.
//
// Decisões do Rodrigo (spec em docs/spec-hub-cliente.md):
//  - as listas de opções são as mesmas pra todos os projetos (12 setores, 27 códigos de ambiente) e o arquiteto ESCOLHE
//    o ambiente de cada item (pode ser mais de um);
//  - "Dimensões" nasce com o modelo "Altura / Largura / Profundidade" (o app preenche; o servidor guarda o que vier);
//  - a foto do produto é pequena (o app reduz pra ~800 px e manda em WebP) e tem limite próprio por projeto, separado
//    das fotos da galeria; excluir o item apaga o arquivo (quem chama apaga a chave devolvida);
//  - o VALOR nunca sai pro cliente da Pasta Cliente (ele nem tem login de orçamentos): só o arquiteto vê, e só entra
//    no PDF se o arquiteto marcar.
const crypto = require('crypto');
const galeria = require('./galeria');
const { lerValorBR } = require('./valor-br');

const SETORES = [
  'Acessórios', 'Ar-Condicionado', 'Box e Espelhos', 'Decorativos', 'Eletrodomésticos', 'Esquadrias',
  'Iluminação', 'Louças', 'Metais', 'Móveis Soltos', 'Portas', 'Tecidos e Papeis'
];
const AMBIENTES = [
  'AS', 'B.01', 'B.02', 'B.03', 'B.04', 'CL', 'CO', 'CS', 'CZ', 'D.01', 'D.02', 'D.03', 'D.04', 'DP', 'DS',
  'HA', 'HO', 'LB', 'LV', 'S.01', 'S.02', 'S.03', 'SE', 'SJ', 'ST', 'VG', 'C.01'
];
const STATUS_ITEM = ['ATUAL', 'REVISAO', 'ANTIGA'];
const DIMENSOES_MODELO = 'Altura: \nLargura: \nProfundidade: ';
const LIMITE_ITENS_POR_PROJETO = 400;
const LIMITE_SETORES = 40;
const LIMITE_FOTOS_POR_PROJETO = 150;
const LIMITE_BYTES_FOTO = 400 * 1024; // o app já entrega ~250 KB; isto é só um teto de segurança no servidor
const TIPOS_FOTO = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' };

function textoLimpo(valor, max, campo) {
  if (valor === undefined || valor === null) return '';
  if (typeof valor !== 'string' && typeof valor !== 'number') throw new Error(`${campo} precisa ser texto.`);
  const t = String(valor).replace(/\r\n/g, '\n').trim();
  if (t.length > max) throw new Error(`${campo} passa de ${max} caracteres.`);
  return t;
}

// Link do produto é opcional; quando vem, só http/https (o cliente final pode abrir).
function linkOpcional(valor) {
  const t = textoLimpo(valor, 2000, 'Link');
  if (!t) return '';
  let u;
  try { u = new URL(t); } catch (e) { throw new Error('Link inválido (cole o endereço completo, começando com https://).'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Link inválido (só endereços http/https).');
  return t;
}

// Setores do PROJETO: os 12 padrão até o arquiteto criar/renomear/excluir algum (aí a lista própria passa a valer).
const setoresDe = (g) => (Array.isArray(g.memorial.setores) && g.memorial.setores.length ? g.memorial.setores : SETORES);
const norm = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

function setorValido(valor, lista) {
  if (!(lista || SETORES).includes(valor)) throw new Error('Setor inválido.');
  return valor;
}

function ambientesValidos(valor) {
  if (valor === undefined || valor === null) return [];
  if (!Array.isArray(valor)) throw new Error('Ambientes inválidos.');
  const vistos = [];
  valor.forEach((a) => {
    if (!AMBIENTES.includes(a)) throw new Error(`Ambiente desconhecido: ${a}.`);
    if (!vistos.includes(a)) vistos.push(a);
  });
  return AMBIENTES.filter((a) => vistos.includes(a)); // sempre na ordem da lista
}

function valorValido(valor) {
  const n = lerValorBR(valor); // aceita 27.252,00 / 27252,00 / 1234.5
  if (n === null) return null;
  if (n < 0 || n > 1e9) throw new Error('Valor inválido.');
  return Math.round(n * 100) / 100;
}

function numeroValido(valor) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1 || n > 9999) throw new Error('Nº inválido (use um número inteiro de 1 a 9999).');
  return n;
}

function proximoNumero(itens, setor, ignorarId) {
  const doSetor = itens.filter((i) => i.setor === setor && i.id !== ignorarId);
  return doSetor.length ? Math.max(...doSetor.map((i) => i.numero)) + 1 : 1;
}

function ordenar(itens, lista) {
  const ordem = lista || SETORES;
  return itens.slice().sort((a, b) => (ordem.indexOf(a.setor) - ordem.indexOf(b.setor)) || (a.numero - b.numero) || String(a.criadoEm).localeCompare(String(b.criadoEm)));
}

function contarFotos(itens) { return itens.filter((i) => i.fotoR2Key).length; }

function info(itens, setores) {
  return {
    setores: setores || SETORES, ambientes: AMBIENTES, dimensoesModelo: DIMENSOES_MODELO,
    limites: { itens: LIMITE_ITENS_POR_PROJETO, fotos: LIMITE_FOTOS_POR_PROJETO, fotosUsadas: contarFotos(itens) }
  };
}

// ---------- arquiteto ----------
// Devolve os itens crus (com fotoR2Key e valor): quem chama (server.js) troca a chave pela URL temporária.
function lerParaArquiteto(caminho, projetoId, licencaUsuario) {
  const estado = galeria.lerEstado(caminho);
  const g = galeria.exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  const setores = setoresDe(g);
  return { itens: ordenar(g.memorial.itens, setores), ...info(g.memorial.itens, setores) };
}

function adicionarItem(caminho, projetoId, entrada, licencaUsuario) {
  const estado = galeria.lerEstado(caminho);
  const g = galeria.exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  const itens = g.memorial.itens;
  if (itens.length >= LIMITE_ITENS_POR_PROJETO) throw new Error(`Limite de ${LIMITE_ITENS_POR_PROJETO} itens por projeto atingido.`);
  entrada = entrada || {};
  const setor = setorValido(entrada.setor, setoresDe(g));
  const nome = textoLimpo(entrada.item, 120, 'Item');
  if (!nome) throw new Error('O nome do item é obrigatório.');
  const status = entrada.status === undefined ? 'ATUAL' : entrada.status;
  if (!STATUS_ITEM.includes(status)) throw new Error('Status inválido.');
  const agora = new Date().toISOString();
  const item = {
    id: 'mem_' + crypto.randomBytes(6).toString('hex'),
    setor,
    numero: entrada.numero === undefined || entrada.numero === null || entrada.numero === '' ? proximoNumero(itens, setor) : numeroValido(entrada.numero),
    item: nome,
    ambientes: ambientesValidos(entrada.ambientes),
    empresa: textoLimpo(entrada.empresa, 120, 'Empresa'),
    especificacoes: textoLimpo(entrada.especificacoes, 1500, 'Especificações'),
    dimensoes: textoLimpo(entrada.dimensoes, 400, 'Dimensões'),
    quantidade: textoLimpo(entrada.quantidade, 40, 'Quantidade'),
    link: linkOpcional(entrada.link),
    valor: valorValido(entrada.valor),
    status,
    fotoR2Key: null,
    criadoEm: agora,
    atualizadoEm: agora
  };
  itens.push(item);
  g.atualizadoEm = agora;
  galeria.salvarEstado(caminho, estado);
  return item;
}

function editarItem(caminho, projetoId, itemId, entrada, licencaUsuario) {
  const estado = galeria.lerEstado(caminho);
  const g = galeria.exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  const item = g.memorial.itens.find((i) => i.id === itemId);
  if (!item) throw new Error('Item não encontrado.');
  entrada = entrada || {};
  // Valida tudo antes de aplicar (se algo for inválido, nada é gravado).
  const novo = {};
  if (entrada.setor !== undefined) novo.setor = setorValido(entrada.setor, setoresDe(g));
  if (entrada.item !== undefined) { novo.item = textoLimpo(entrada.item, 120, 'Item'); if (!novo.item) throw new Error('O nome do item é obrigatório.'); }
  if (entrada.ambientes !== undefined) novo.ambientes = ambientesValidos(entrada.ambientes);
  if (entrada.empresa !== undefined) novo.empresa = textoLimpo(entrada.empresa, 120, 'Empresa');
  if (entrada.especificacoes !== undefined) novo.especificacoes = textoLimpo(entrada.especificacoes, 1500, 'Especificações');
  if (entrada.dimensoes !== undefined) novo.dimensoes = textoLimpo(entrada.dimensoes, 400, 'Dimensões');
  if (entrada.quantidade !== undefined) novo.quantidade = textoLimpo(entrada.quantidade, 40, 'Quantidade');
  if (entrada.link !== undefined) novo.link = linkOpcional(entrada.link);
  if (entrada.valor !== undefined) novo.valor = valorValido(entrada.valor);
  if (entrada.status !== undefined) { if (!STATUS_ITEM.includes(entrada.status)) throw new Error('Status inválido.'); novo.status = entrada.status; }
  if (entrada.numero !== undefined && entrada.numero !== null && entrada.numero !== '') novo.numero = numeroValido(entrada.numero);
  // Mudou de setor sem dizer o Nº: vai pro fim do novo setor.
  if (novo.setor && novo.setor !== item.setor && novo.numero === undefined) novo.numero = proximoNumero(g.memorial.itens, novo.setor, item.id);
  Object.assign(item, novo, { atualizadoEm: new Date().toISOString() });
  g.atualizadoEm = item.atualizadoEm;
  galeria.salvarEstado(caminho, estado);
  return item;
}

// Devolve a chave da foto (se tinha) pra quem chama apagar do armazenamento.
function excluirItem(caminho, projetoId, itemId, licencaUsuario) {
  const estado = galeria.lerEstado(caminho);
  const g = galeria.exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  const indice = g.memorial.itens.findIndex((i) => i.id === itemId);
  if (indice < 0) throw new Error('Item não encontrado.');
  const [removido] = g.memorial.itens.splice(indice, 1);
  g.atualizadoEm = new Date().toISOString();
  galeria.salvarEstado(caminho, estado);
  return removido.fotoR2Key || null;
}

// Confere (ANTES de gravar no armazenamento) se esse item pode receber uma foto agora.
function conferirPodeReceberFoto(caminho, projetoId, itemId, licencaUsuario) {
  const estado = galeria.lerEstado(caminho);
  const g = galeria.exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  const item = g.memorial.itens.find((i) => i.id === itemId);
  if (!item) throw new Error('Item não encontrado.');
  if (!item.fotoR2Key && contarFotos(g.memorial.itens) >= LIMITE_FOTOS_POR_PROJETO) {
    throw new Error(`Esse projeto já tem o máximo de ${LIMITE_FOTOS_POR_PROJETO} fotos no memorial. Remova alguma antes de adicionar outra.`);
  }
  return true;
}

function definirFoto(caminho, projetoId, itemId, r2Key, licencaUsuario) {
  const estado = galeria.lerEstado(caminho);
  const g = galeria.exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  const item = g.memorial.itens.find((i) => i.id === itemId);
  if (!item) throw new Error('Item não encontrado.');
  if (r2Key && !item.fotoR2Key && contarFotos(g.memorial.itens) >= LIMITE_FOTOS_POR_PROJETO) {
    throw new Error(`Esse projeto já tem o máximo de ${LIMITE_FOTOS_POR_PROJETO} fotos no memorial.`);
  }
  const r2KeyAntiga = item.fotoR2Key || null;
  item.fotoR2Key = r2Key || null;
  item.atualizadoEm = new Date().toISOString();
  g.atualizadoEm = item.atualizadoEm;
  galeria.salvarEstado(caminho, estado);
  return { item, r2KeyAntiga };
}

// ---------- cliente ----------
// O que a PASTA CLIENTE pode ver: itens que não são ANTIGA, SEM valor e sem chaves do armazenamento (o server.js
// acrescenta fotoUrl). Quem chama só usa isto quando o dono da galeria tem o recurso "memorial".
function paraCliente(galeriaObj) {
  const setores = setoresDe(galeriaObj);
  const itens = ordenar(galeriaObj.memorial.itens.filter((i) => i.status !== 'ANTIGA'), setores).map((i) => ({
    id: i.id, setor: i.setor, numero: i.numero, item: i.item, ambientes: i.ambientes, empresa: i.empresa,
    especificacoes: i.especificacoes, dimensoes: i.dimensoes, quantidade: i.quantidade, link: i.link,
    status: i.status, fotoR2Key: i.fotoR2Key, criadoEm: i.criadoEm || null, atualizadoEm: i.atualizadoEm || i.criadoEm || null // as datas deixam o cliente ver o que é novidade
  }));
  return { itens, setores };
}

// ---------- setores do projeto (o arquiteto cria, renomeia e exclui) ----------
function nomeDeSetor(valor) {
  const t = textoLimpo(valor, 60, 'Nome do setor');
  if (!t) throw new Error('Dê um nome ao setor.');
  return t;
}

function adicionarSetor(caminho, projetoId, nome, licencaUsuario) {
  const estado = galeria.lerEstado(caminho);
  const g = galeria.exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  const novo = nomeDeSetor(nome);
  const lista = setoresDe(g).slice();
  if (lista.length >= LIMITE_SETORES) throw new Error(`No máximo ${LIMITE_SETORES} setores.`);
  if (lista.some((s) => norm(s) === norm(novo))) throw new Error('Já existe um setor com esse nome.');
  lista.push(novo);
  g.memorial.setores = lista;
  g.atualizadoEm = new Date().toISOString();
  galeria.salvarEstado(caminho, estado);
  return lista;
}

// Os itens do setor acompanham o novo nome.
function renomearSetor(caminho, projetoId, de, para, licencaUsuario) {
  const estado = galeria.lerEstado(caminho);
  const g = galeria.exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  const lista = setoresDe(g).slice();
  const i = lista.indexOf(de);
  if (i < 0) throw new Error('Setor não encontrado.');
  const novo = nomeDeSetor(para);
  if (lista.some((s, j) => j !== i && norm(s) === norm(novo))) throw new Error('Já existe um setor com esse nome.');
  lista[i] = novo;
  g.memorial.setores = lista;
  g.memorial.itens.forEach((it) => { if (it.setor === de) it.setor = novo; });
  g.atualizadoEm = new Date().toISOString();
  galeria.salvarEstado(caminho, estado);
  return lista;
}

// Só exclui setor VAZIO (pra ninguém perder item sem querer): quem quiser, move ou exclui os itens antes.
function excluirSetor(caminho, projetoId, nome, licencaUsuario) {
  const estado = galeria.lerEstado(caminho);
  const g = galeria.exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  const lista = setoresDe(g).slice();
  const i = lista.indexOf(nome);
  if (i < 0) throw new Error('Setor não encontrado.');
  const usados = g.memorial.itens.filter((it) => it.setor === nome).length;
  if (usados) throw new Error(`Esse setor tem ${usados} ${usados === 1 ? 'item' : 'itens'}. Mova ou exclua os itens antes de excluir o setor.`);
  if (lista.length <= 1) throw new Error('Precisa sobrar pelo menos um setor.');
  lista.splice(i, 1);
  g.memorial.setores = lista;
  g.atualizadoEm = new Date().toISOString();
  galeria.salvarEstado(caminho, estado);
  return lista;
}

module.exports = {
  SETORES, AMBIENTES, STATUS_ITEM, DIMENSOES_MODELO, LIMITE_ITENS_POR_PROJETO, LIMITE_FOTOS_POR_PROJETO, LIMITE_BYTES_FOTO, TIPOS_FOTO,
  LIMITE_SETORES, adicionarSetor, renomearSetor, excluirSetor,
  lerParaArquiteto, adicionarItem, editarItem, excluirItem, conferirPodeReceberFoto, definirFoto, paraCliente
};
