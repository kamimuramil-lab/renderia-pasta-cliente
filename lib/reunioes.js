// lib/reunioes.js
// Atas das reuniões de apresentação (lousa do modo escritório): data, o que foi apresentado, anotações e os "prints" das páginas rabiscadas.
// É controle INTERNO do escritório: o cliente final nunca recebe (o servidor tira `reunioes` das respostas dele). Os prints ficam no armazenamento
// (R2) em `reunioes/<projeto>/<reuniao>/print-N.jpg`; aqui só se guarda a chave. Camada de dados pura (sem rede), no mesmo padrão do hub.js.
const crypto = require('crypto');
const galeria = require('./galeria');

const LIMITE_REUNIOES = 300;
const LIMITE_PRINTS = 40;
const LIMITE_NOTAS = 20000;

function texto(valor, max, campo, obrigatorio) {
  if (valor === undefined || valor === null) valor = '';
  if (typeof valor !== 'string') throw new Error(campo + ' inválido.');
  const t = valor.replace(/\r\n/g, '\n').trim();
  if (obrigatorio && !t) throw new Error(campo + ' é obrigatório.');
  if (t.length > max) throw new Error(`${campo} passa de ${max} caracteres.`);
  return t;
}
function dataIso(valor, campo) {
  if (valor === undefined || valor === null || valor === '') return null;
  const d = new Date(valor);
  if (typeof valor !== 'string' || Number.isNaN(d.getTime())) throw new Error(campo + ' inválida.');
  return d.toISOString();
}

// Valida os dados da ata ANTES de gravar qualquer arquivo. -> dados limpos (sem os prints, que o servidor trata à parte).
function validarDados(entrada) {
  const e = entrada || {};
  const prints = e.prints === undefined ? [] : e.prints;
  if (!Array.isArray(prints)) throw new Error('Prints inválidos.');
  if (prints.length > LIMITE_PRINTS) throw new Error(`No máximo ${LIMITE_PRINTS} prints por reunião.`);
  return {
    titulo: texto(e.titulo, 160, 'Título', true),
    apresentado: texto(e.apresentado, 300, 'O que foi apresentado'),
    notas: texto(e.notas, LIMITE_NOTAS, 'Anotações'),
    iniciouEm: dataIso(e.iniciouEm, 'Data de início'),
    encerrouEm: dataIso(e.encerrouEm, 'Data de término'),
    rotulosDosPrints: prints.map((p) => texto(p && p.rotulo, 160, 'Rótulo do print'))
  };
}

function nova(g, dados, prints) {
  const id = 'reu_' + crypto.randomBytes(6).toString('hex');
  return { id, titulo: dados.titulo, apresentado: dados.apresentado, notas: dados.notas, iniciouEm: dados.iniciouEm, encerrouEm: dados.encerrouEm || new Date().toISOString(), criadaEm: new Date().toISOString(), prints };
}

// Registra a ata na galeria (achada pelo link do cliente em modo escritório). `prints`: [{ rotulo, r2Key }] já gravados no armazenamento.
function adicionar(caminho, linkToken, dados, prints) {
  const estado = galeria.lerEstado(caminho);
  const g = estado.galerias.find((x) => x.linkToken === linkToken);
  if (!g) throw new Error('Link não encontrado.');
  if (!Array.isArray(g.reunioes)) g.reunioes = [];
  if (g.reunioes.length >= LIMITE_REUNIOES) throw new Error(`Limite de ${LIMITE_REUNIOES} reuniões por projeto atingido.`);
  const r = nova(g, dados, prints);
  g.reunioes.push(r);
  salvar(caminho, estado);
  return { reuniao: r, projetoId: g.projetoId };
}
function salvar(caminho, estado) { galeria.salvarEstado(caminho, estado); }

function listar(caminho, projetoId, licencaUsuario) {
  const g = galeria.exigirGaleriaDaLicenca(galeria.lerEstado(caminho), projetoId, licencaUsuario);
  return [...(g.reunioes || [])].sort((a, b) => String(b.encerrouEm).localeCompare(String(a.encerrouEm)));
}
// Remove a ata e devolve as chaves dos prints (o servidor apaga os arquivos).
function excluir(caminho, projetoId, reuniaoId, licencaUsuario) {
  const estado = galeria.lerEstado(caminho);
  const g = galeria.exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  const r = (g.reunioes || []).find((x) => x.id === reuniaoId);
  if (!r) throw new Error('Reunião não encontrada.');
  g.reunioes = g.reunioes.filter((x) => x !== r);
  salvar(caminho, estado);
  return (r.prints || []).map((p) => p.r2Key).filter(Boolean);
}

// Texto da ata pronto pra colar no WhatsApp (sem imagens; as imagens ficam na ata).
function textoParaCopiar(r, nomeProjeto) {
  const data = new Date(r.encerrouEm || r.criadaEm);
  const dd = String(data.getDate()).padStart(2, '0') + '/' + String(data.getMonth() + 1).padStart(2, '0') + '/' + data.getFullYear();
  const hh = String(data.getHours()).padStart(2, '0') + ':' + String(data.getMinutes()).padStart(2, '0');
  const linhas = [`*Reunião - ${nomeProjeto || r.titulo}*`, `${dd} às ${hh}`];
  if (r.apresentado) linhas.push(`Apresentado: ${r.apresentado}`);
  if (r.notas) linhas.push('', r.notas);
  return linhas.join('\n');
}

module.exports = { validarDados, adicionar, listar, excluir, textoParaCopiar, LIMITE_PRINTS, LIMITE_NOTAS, LIMITE_REUNIOES };
