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
const LIMITE_FOTOS_POR_PROJETO = 400; // conta a capa e as fotos extras de todos os itens (era 150 quando o item tinha uma foto só)
const LIMITE_FOTOS_POR_ITEM = 6; // a capa + até 5 extras
const MODOS_SETOR = ['lista', 'cards']; // como o setor aparece pro cliente e no PDF (lista = tabela, cards = imagem grande com os dados embaixo)
const LIMITE_BYTES_FOTO = 600 * 1024; // o app entrega até ~380 KB (1200 px); isto é só um teto de segurança no servidor
const TIPOS_FOTO = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' };
const LIMITE_PLANTAS_POR_SETOR = 8; // uma por pavimento/página de PDF; 8 já é de sobra num setor
const LIMITE_PLANTAS_POR_PROJETO = 30;
const LIMITE_MARCAS_POR_PLANTA = 80; // círculos numerados sobre a planta
// Tamanho dos círculos numerados da planta: fração da LARGURA da planta (o arquiteto ajusta por planta; vale no app, no site e nos 3 PDFs)
const TAMANHO_MARCAS = { min: 0.012, max: 0.06, padrao: 0.027 };
const LIMITE_TEXTOS_POR_PLANTA = galeria.LIMITE_TEXTOS_POR_PLANTA; // textos escritos em cima da planta (mesma regra da planta da apresentação: 80)
const LIMITE_BYTES_PLANTA = 4 * 1024 * 1024; // o app entrega ~2800 px em WebP (algumas centenas de KB); isto é teto de segurança

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

// Ambientes da CONTA (nov/2026): a lista de códigos que o arquiteto escolhe em cada item. Nasce com os 27 padrão e o arquiteto pode
// acrescentar, renomear e excluir; fica guardada no perfil da licença (estado.perfis[licença].ambientesMemorial), então vale pra
// todos os projetos e pra todo computador que entra com o mesmo login. Sem lista própria = os padrão.
function ambientesDaConta(estado, licencaUsuario) {
  const p = estado.perfis && licencaUsuario ? estado.perfis[licencaUsuario] : null;
  const lista = p && Array.isArray(p.ambientesMemorial) ? p.ambientesMemorial.filter((a) => typeof a === 'string' && a) : [];
  return lista.length ? lista : AMBIENTES;
}

// `lista` = ambientes da conta. `extras` = etiquetas que o item JÁ tinha (excluir um ambiente da lista não tira a etiqueta dos itens
// que a usavam, então salvar o item de novo não pode falhar por causa delas). Sai na ordem da lista, com as extras no fim.
function ambientesValidos(valor, lista, extras) {
  const permitidos = lista || AMBIENTES;
  if (valor === undefined || valor === null) return [];
  if (!Array.isArray(valor)) throw new Error('Ambientes inválidos.');
  const vistos = [];
  valor.forEach((a) => {
    if (!permitidos.includes(a) && !(extras || []).includes(a)) throw new Error(`Ambiente desconhecido: ${a}.`);
    if (!vistos.includes(a)) vistos.push(a);
  });
  return [...permitidos.filter((a) => vistos.includes(a)), ...vistos.filter((a) => !permitidos.includes(a))];
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

// Fotos extras do item (além da capa `fotoR2Key`): [{ id, r2Key }]. Item de antes desse recurso não tem a lista = nenhuma.
const extrasDe = (item) => (Array.isArray(item.fotosExtras) ? item.fotosExtras.filter((f) => f && f.id && f.r2Key) : []);
const fotosNoItem = (item) => (item.fotoR2Key ? 1 : 0) + extrasDe(item).length;
function contarFotos(itens) { return itens.reduce((s, i) => s + fotosNoItem(i), 0); }

// Modo de exibição de cada setor (`g.memorial.modos[setor]`); sem escolha = lista, como sempre foi.
function modoDoSetor(g, setor) {
  const m = g.memorial && g.memorial.modos;
  return m && MODOS_SETOR.includes(m[setor]) ? m[setor] : 'lista';
}
function modosDe(g, setores) {
  const r = {};
  (setores || setoresDe(g)).forEach((s) => { r[s] = modoDoSetor(g, s); });
  return r;
}

function info(itens, setores, ambientes, modos) {
  return {
    setores: setores || SETORES, ambientes: ambientes || AMBIENTES, dimensoesModelo: DIMENSOES_MODELO, modos: modos || {},
    limites: { itens: LIMITE_ITENS_POR_PROJETO, fotos: LIMITE_FOTOS_POR_PROJETO, fotosUsadas: contarFotos(itens), fotosPorItem: LIMITE_FOTOS_POR_ITEM, plantasPorSetor: LIMITE_PLANTAS_POR_SETOR, plantasPorProjeto: LIMITE_PLANTAS_POR_PROJETO, marcasPorPlanta: LIMITE_MARCAS_POR_PLANTA, textosPorPlanta: LIMITE_TEXTOS_POR_PLANTA, tamanhoMarcas: TAMANHO_MARCAS }
  };
}

// ---------- plantas do setor (`g.memorial.plantas[setor] = [{ id, nome, r2Key, marcas: [{ id, itemId, x, y }], criadaEm }]`) ----------
// x e y são FRAÇÃO da imagem (0 a 1), nunca pixels: o cliente vê no lugar certo em qualquer tela. Um item pode ter mais de um círculo.
function plantasDe(g) {
  const p = g.memorial && g.memorial.plantas;
  return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
}
const plantasDoSetor = (g, setor) => (Array.isArray(plantasDe(g)[setor]) ? plantasDe(g)[setor] : []);
const marcasDe = (planta) => (Array.isArray(planta.marcas) ? planta.marcas.filter((m) => m && m.itemId) : []);
// Textos escritos em cima da planta (mesmo formato da planta da apresentação: veja public/assets/js/planta-textos.js). Planta antiga não tem o campo.
const tamanhoMarcasDe = (planta) => { const n = Number(planta && planta.tamanhoMarcas); return Number.isFinite(n) && n >= TAMANHO_MARCAS.min && n <= TAMANHO_MARCAS.max ? n : TAMANHO_MARCAS.padrao; };
const textosDe = (planta) => (Array.isArray(planta.textos) ? planta.textos.filter((t) => t && String(t.texto || '').trim()) : []);
function contarPlantas(g) { return Object.values(plantasDe(g)).reduce((s, l) => s + (Array.isArray(l) ? l.length : 0), 0); }
function acharPlanta(g, plantaId) {
  for (const [setor, lista] of Object.entries(plantasDe(g))) {
    const planta = (Array.isArray(lista) ? lista : []).find((p) => p && p.id === plantaId);
    if (planta) return { planta, setor, lista };
  }
  return null;
}
// Tira os círculos de um item (item excluído ou que mudou de setor): a planta guarda só círculos de itens do PRÓPRIO setor.
function tirarMarcasDoItem(g, itemId, soDoSetor) {
  Object.entries(plantasDe(g)).forEach(([setor, lista]) => {
    if (soDoSetor !== undefined && setor !== soDoSetor) return;
    (Array.isArray(lista) ? lista : []).forEach((p) => { if (Array.isArray(p.marcas)) p.marcas = p.marcas.filter((m) => m.itemId !== itemId); });
  });
}
// O que o arquiteto recebe: todas as plantas (com a chave do armazenamento, que o server.js troca pela URL).
function plantasParaArquiteto(g, setores) {
  const r = {};
  (setores || setoresDe(g)).forEach((s) => { r[s] = plantasDoSetor(g, s).map((p) => ({ id: p.id, nome: p.nome, r2Key: p.r2Key, marcas: marcasDe(p).map((m) => ({ id: m.id, itemId: m.itemId, x: m.x, y: m.y })), textos: textosDe(p), tamanhoMarcas: tamanhoMarcasDe(p), criadaEm: p.criadaEm || null })); });
  return r;
}

// ---------- arquiteto ----------
// Devolve os itens crus (com fotoR2Key e valor): quem chama (server.js) troca a chave pela URL temporária.
function lerParaArquiteto(caminho, projetoId, licencaUsuario) {
  const estado = galeria.lerEstado(caminho);
  const g = galeria.exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  const setores = setoresDe(g);
  return { itens: ordenar(g.memorial.itens, setores).map((i) => ({ ...i, fotosExtras: extrasDe(i) })), plantas: plantasParaArquiteto(g, setores), ...info(g.memorial.itens, setores, ambientesDaConta(estado, licencaUsuario), modosDe(g, setores)) };
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
    ambientes: ambientesValidos(entrada.ambientes, ambientesDaConta(estado, licencaUsuario)),
    empresa: textoLimpo(entrada.empresa, 120, 'Empresa'),
    especificacoes: textoLimpo(entrada.especificacoes, 1500, 'Especificações'),
    dimensoes: textoLimpo(entrada.dimensoes, 400, 'Dimensões'),
    quantidade: textoLimpo(entrada.quantidade, 40, 'Quantidade'),
    link: linkOpcional(entrada.link),
    valor: valorValido(entrada.valor),
    status,
    fotoR2Key: null,
    fotosExtras: [],
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
  if (entrada.ambientes !== undefined) novo.ambientes = ambientesValidos(entrada.ambientes, ambientesDaConta(estado, licencaUsuario), item.ambientes);
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
  const setorAntigo = item.setor;
  Object.assign(item, novo, { atualizadoEm: new Date().toISOString() });
  if (novo.setor && novo.setor !== setorAntigo) tirarMarcasDoItem(g, item.id); // os círculos ficam só nas plantas do setor do item
  g.atualizadoEm = item.atualizadoEm;
  galeria.salvarEstado(caminho, estado);
  return item;
}

// Devolve TODAS as chaves de foto do item (capa + extras) pra quem chama apagar do armazenamento.
function excluirItemComFotos(caminho, projetoId, itemId, licencaUsuario) {
  const estado = galeria.lerEstado(caminho);
  const g = galeria.exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  const indice = g.memorial.itens.findIndex((i) => i.id === itemId);
  if (indice < 0) throw new Error('Item não encontrado.');
  const [removido] = g.memorial.itens.splice(indice, 1);
  tirarMarcasDoItem(g, removido.id);
  g.atualizadoEm = new Date().toISOString();
  galeria.salvarEstado(caminho, estado);
  return [removido.fotoR2Key, ...extrasDe(removido).map((f) => f.r2Key)].filter(Boolean);
}
// Jeito antigo: devolve só a chave da capa (quem usa isto não apaga as extras).
function excluirItem(caminho, projetoId, itemId, licencaUsuario) {
  return excluirItemComFotos(caminho, projetoId, itemId, licencaUsuario)[0] || null;
}

// ---------- fotos extras do item (a capa continua sendo `fotoR2Key`) ----------
function conferirPodeReceberFotoExtra(caminho, projetoId, itemId, licencaUsuario) {
  const estado = galeria.lerEstado(caminho);
  const g = galeria.exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  const item = g.memorial.itens.find((i) => i.id === itemId);
  if (!item) throw new Error('Item não encontrado.');
  if (fotosNoItem(item) >= LIMITE_FOTOS_POR_ITEM) throw new Error(`Cada item pode ter até ${LIMITE_FOTOS_POR_ITEM} fotos. Remova alguma antes de adicionar outra.`);
  if (contarFotos(g.memorial.itens) >= LIMITE_FOTOS_POR_PROJETO) throw new Error(`Esse projeto já tem o máximo de ${LIMITE_FOTOS_POR_PROJETO} fotos no memorial. Remova alguma antes de adicionar outra.`);
  return true;
}

// Se o item ainda não tem capa, a foto vira a capa; senão entra no fim das extras. Devolve { item, fotoId } (fotoId = null quando virou capa).
function adicionarFotoExtra(caminho, projetoId, itemId, r2Key, licencaUsuario) {
  const estado = galeria.lerEstado(caminho);
  const g = galeria.exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  const item = g.memorial.itens.find((i) => i.id === itemId);
  if (!item) throw new Error('Item não encontrado.');
  if (!r2Key) throw new Error('Foto inválida.');
  if (fotosNoItem(item) >= LIMITE_FOTOS_POR_ITEM) throw new Error(`Cada item pode ter até ${LIMITE_FOTOS_POR_ITEM} fotos.`);
  if (contarFotos(g.memorial.itens) >= LIMITE_FOTOS_POR_PROJETO) throw new Error(`Esse projeto já tem o máximo de ${LIMITE_FOTOS_POR_PROJETO} fotos no memorial.`);
  let fotoId = null;
  if (!item.fotoR2Key) item.fotoR2Key = r2Key;
  else { fotoId = 'fx_' + crypto.randomBytes(5).toString('hex'); item.fotosExtras = [...extrasDe(item), { id: fotoId, r2Key }]; }
  item.atualizadoEm = new Date().toISOString();
  g.atualizadoEm = item.atualizadoEm;
  galeria.salvarEstado(caminho, estado);
  return { item, fotoId };
}

// Tira uma foto extra; devolve a chave pra apagar do armazenamento.
function removerFotoExtra(caminho, projetoId, itemId, fotoId, licencaUsuario) {
  const estado = galeria.lerEstado(caminho);
  const g = galeria.exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  const item = g.memorial.itens.find((i) => i.id === itemId);
  if (!item) throw new Error('Item não encontrado.');
  const extras = extrasDe(item);
  const alvo = extras.find((f) => f.id === fotoId);
  if (!alvo) throw new Error('Foto não encontrada.');
  item.fotosExtras = extras.filter((f) => f.id !== fotoId);
  item.atualizadoEm = new Date().toISOString();
  g.atualizadoEm = item.atualizadoEm;
  galeria.salvarEstado(caminho, estado);
  return { item, r2KeyAntiga: alvo.r2Key };
}

// Troca a capa com uma extra (a capa antiga vira extra, no lugar da escolhida).
function tornarCapa(caminho, projetoId, itemId, fotoId, licencaUsuario) {
  const estado = galeria.lerEstado(caminho);
  const g = galeria.exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  const item = g.memorial.itens.find((i) => i.id === itemId);
  if (!item) throw new Error('Item não encontrado.');
  const extras = extrasDe(item);
  const i = extras.findIndex((f) => f.id === fotoId);
  if (i < 0) throw new Error('Foto não encontrada.');
  const escolhida = extras[i].r2Key;
  if (item.fotoR2Key) extras[i] = { id: extras[i].id, r2Key: item.fotoR2Key }; else extras.splice(i, 1);
  item.fotoR2Key = escolhida;
  item.fotosExtras = extras;
  item.atualizadoEm = new Date().toISOString();
  g.atualizadoEm = item.atualizadoEm;
  galeria.salvarEstado(caminho, estado);
  return item;
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
  // Tirou a capa e o item tem outras fotos: a primeira extra sobe pra capa (o item nunca fica com extras e sem capa).
  if (!r2Key && extrasDe(item).length) { const [primeira, ...resto] = extrasDe(item); item.fotoR2Key = primeira.r2Key; item.fotosExtras = resto; }
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
    status: i.status, fotoR2Key: i.fotoR2Key, fotosExtras: extrasDe(i), criadoEm: i.criadoEm || null, atualizadoEm: i.atualizadoEm || i.criadoEm || null // as datas deixam o cliente ver o que é novidade
  }));
  // Plantas: só círculos de itens que o cliente VÊ (some quem é ANTIGA); `numero` é o do item agora (se o Nº mudar, o círculo acompanha).
  const porId = new Map(itens.map((i) => [i.id, i]));
  const plantas = {};
  setores.forEach((s) => {
    const lista = plantasDoSetor(galeriaObj, s);
    if (lista.length) plantas[s] = lista.map((p) => ({ id: p.id, nome: p.nome, r2Key: p.r2Key, marcas: marcasDe(p).filter((m) => porId.has(m.itemId)).map((m) => ({ id: m.id, itemId: m.itemId, numero: porId.get(m.itemId).numero, x: m.x, y: m.y })), textos: textosDe(p), tamanhoMarcas: tamanhoMarcasDe(p) }));
  });
  return { itens, setores, modos: modosDe(galeriaObj, setores), plantas };
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
  if (g.memorial.modos && g.memorial.modos[de]) { g.memorial.modos[novo] = g.memorial.modos[de]; delete g.memorial.modos[de]; } // o modo acompanha o nome novo
  if (g.memorial.plantas && g.memorial.plantas[de]) { g.memorial.plantas[novo] = g.memorial.plantas[de]; delete g.memorial.plantas[de]; } // e as plantas também
  g.atualizadoEm = new Date().toISOString();
  galeria.salvarEstado(caminho, estado);
  return lista;
}

// Ordem dos setores (▲▼ no app; o cliente e os PDFs seguem a mesma ordem). Recebe os nomes na ordem desejada; o que não veio fica no fim,
// na ordem de antes (tela desatualizada nunca esconde setor novo); nome que não existe é ignorado.
function ordenarSetores(caminho, projetoId, nomes, licencaUsuario) {
  const estado = galeria.lerEstado(caminho);
  const g = galeria.exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  if (!Array.isArray(nomes) || nomes.length > LIMITE_SETORES * 2) throw new Error('Lista de ordem inválida.');
  const atual = setoresDe(g).slice();
  const usados = new Set(); const nova = [];
  nomes.forEach((n) => { if (atual.includes(n) && !usados.has(n)) { usados.add(n); nova.push(n); } });
  atual.forEach((n) => { if (!usados.has(n)) nova.push(n); });
  g.memorial.setores = nova;
  g.atualizadoEm = new Date().toISOString();
  galeria.salvarEstado(caminho, estado);
  return nova;
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
  const nPlantas = plantasDoSetor(g, nome).length;
  if (nPlantas) throw new Error(`Esse setor tem ${nPlantas} ${nPlantas === 1 ? 'planta' : 'plantas'}. Exclua ${nPlantas === 1 ? 'a planta' : 'as plantas'} antes de excluir o setor.`);
  lista.splice(i, 1);
  g.memorial.setores = lista;
  if (g.memorial.modos) delete g.memorial.modos[nome];
  g.atualizadoEm = new Date().toISOString();
  galeria.salvarEstado(caminho, estado);
  return lista;
}

// Escolhe como o setor aparece pro cliente e no PDF: 'lista' (tabela) ou 'cards' (imagem grande com os dados embaixo).
function definirModoSetor(caminho, projetoId, nome, modo, licencaUsuario) {
  const estado = galeria.lerEstado(caminho);
  const g = galeria.exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  if (!setoresDe(g).includes(nome)) throw new Error('Setor não encontrado.');
  if (!MODOS_SETOR.includes(modo)) throw new Error('Modo inválido (use lista ou cards).');
  if (!g.memorial.modos || typeof g.memorial.modos !== 'object' || Array.isArray(g.memorial.modos)) g.memorial.modos = {};
  if (modo === 'lista') delete g.memorial.modos[nome]; else g.memorial.modos[nome] = modo; // lista é o padrão: não precisa guardar
  g.atualizadoEm = new Date().toISOString();
  galeria.salvarEstado(caminho, estado);
  return modosDe(g);
}

// ---------- plantas do setor: adicionar, renomear, círculos, excluir ----------
// Confere (ANTES de gravar no armazenamento) se o setor pode receber mais uma planta.
function conferirPodeReceberPlanta(caminho, projetoId, setor, licencaUsuario) {
  const estado = galeria.lerEstado(caminho);
  const g = galeria.exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  if (!setoresDe(g).includes(setor)) throw new Error('Setor não encontrado.');
  if (plantasDoSetor(g, setor).length >= LIMITE_PLANTAS_POR_SETOR) throw new Error(`Esse setor já tem o máximo de ${LIMITE_PLANTAS_POR_SETOR} plantas. Exclua alguma antes de adicionar outra.`);
  if (contarPlantas(g) >= LIMITE_PLANTAS_POR_PROJETO) throw new Error(`Esse projeto já tem o máximo de ${LIMITE_PLANTAS_POR_PROJETO} plantas no memorial. Exclua alguma antes de adicionar outra.`);
  return true;
}

function adicionarPlanta(caminho, projetoId, setor, { nome, r2Key }, licencaUsuario) {
  conferirPodeReceberPlanta(caminho, projetoId, setor, licencaUsuario);
  if (!r2Key) throw new Error('Imagem da planta inválida.');
  const estado = galeria.lerEstado(caminho);
  const g = galeria.exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  if (!g.memorial.plantas || typeof g.memorial.plantas !== 'object' || Array.isArray(g.memorial.plantas)) g.memorial.plantas = {};
  const lista = Array.isArray(g.memorial.plantas[setor]) ? g.memorial.plantas[setor] : (g.memorial.plantas[setor] = []);
  const planta = {
    id: 'mpl_' + crypto.randomBytes(6).toString('hex'),
    nome: textoLimpo(nome, 60, 'Nome da planta') || `Planta ${lista.length + 1}`,
    r2Key, marcas: [], textos: [], criadaEm: new Date().toISOString()
  };
  lista.push(planta);
  g.atualizadoEm = planta.criadaEm;
  galeria.salvarEstado(caminho, estado);
  return planta;
}

function renomearPlanta(caminho, projetoId, plantaId, nome, licencaUsuario) {
  const estado = galeria.lerEstado(caminho);
  const g = galeria.exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  const achada = acharPlanta(g, plantaId);
  if (!achada) throw new Error('Planta não encontrada.');
  const novo = textoLimpo(nome, 60, 'Nome da planta');
  if (!novo) throw new Error('Dê um nome à planta.');
  achada.planta.nome = novo;
  g.atualizadoEm = new Date().toISOString();
  galeria.salvarEstado(caminho, estado);
  return achada.planta;
}

// A lista COMPLETA de círculos da planta substitui a anterior (o app manda tudo de uma vez, depois de arrastar).
// Cada círculo representa um item DO MESMO SETOR da planta; o mesmo item pode ter vários.
function definirMarcasDaPlanta(caminho, projetoId, plantaId, marcas, licencaUsuario) {
  const estado = galeria.lerEstado(caminho);
  const g = galeria.exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  const achada = acharPlanta(g, plantaId);
  if (!achada) throw new Error('Planta não encontrada.');
  if (!Array.isArray(marcas)) throw new Error('Lista de círculos inválida.');
  if (marcas.length > LIMITE_MARCAS_POR_PLANTA) throw new Error(`Cada planta aceita até ${LIMITE_MARCAS_POR_PLANTA} círculos.`);
  const usados = new Set();
  const validadas = marcas.map((m, k) => {
    if (!m || typeof m !== 'object') throw new Error(`Círculo ${k + 1} inválido.`);
    const item = g.memorial.itens.find((i) => i.id === m.itemId);
    if (!item) throw new Error('Um dos itens do círculo não existe mais. Atualize a tela e tente de novo.');
    if (item.setor !== achada.setor) throw new Error('O círculo só pode representar um item do mesmo setor da planta.');
    const x = Number(m.x), y = Number(m.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`Posição do círculo ${k + 1} inválida.`);
    let id = typeof m.id === 'string' && /^mk_[a-z0-9]{1,24}$/.test(m.id) && !usados.has(m.id) ? m.id : null;
    if (!id) id = 'mk_' + crypto.randomBytes(5).toString('hex');
    usados.add(id);
    return { id, itemId: item.id, x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
  });
  achada.planta.marcas = validadas;
  g.atualizadoEm = new Date().toISOString();
  galeria.salvarEstado(caminho, estado);
  return achada.planta;
}

// TEXTOS em cima da planta (nome dos ambientes, observações): a lista COMPLETA substitui a anterior, como as marcas. A validação é a MESMA
// da planta da apresentação (galeria.validarTextoDaPlanta: fração 0..1, tamanho, cores #RRGGBB, até 200 caracteres) e roda ANTES de gravar.
function definirTextosDaPlanta(caminho, projetoId, plantaId, textos, licencaUsuario) {
  if (!Array.isArray(textos)) throw new Error('A lista de textos é inválida.');
  if (textos.length > LIMITE_TEXTOS_POR_PLANTA) throw new Error(`Cada planta aceita até ${LIMITE_TEXTOS_POR_PLANTA} textos.`);
  const validados = textos.map(galeria.validarTextoDaPlanta);
  if (new Set(validados.map((v) => v.id)).size !== validados.length) throw new Error('Há textos repetidos na lista.');
  const estado = galeria.lerEstado(caminho);
  const g = galeria.exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  const achada = acharPlanta(g, plantaId);
  if (!achada) throw new Error('Planta não encontrada.');
  achada.planta.textos = validados;
  g.atualizadoEm = new Date().toISOString();
  galeria.salvarEstado(caminho, estado);
  return achada.planta;
}

// TAMANHO dos círculos numerados da planta (um valor só, vale pra todos os círculos dela): fração da largura da planta, limitada ao intervalo permitido.
function definirTamanhoMarcasDaPlanta(caminho, projetoId, plantaId, tamanho, licencaUsuario) {
  const n = Number(tamanho);
  if (tamanho === null || tamanho === '' || typeof tamanho === 'boolean' || !Number.isFinite(n)) throw new Error('Tamanho dos círculos inválido.');
  const estado = galeria.lerEstado(caminho);
  const g = galeria.exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  const achada = acharPlanta(g, plantaId);
  if (!achada) throw new Error('Planta não encontrada.');
  achada.planta.tamanhoMarcas = Math.min(TAMANHO_MARCAS.max, Math.max(TAMANHO_MARCAS.min, n));
  g.atualizadoEm = new Date().toISOString();
  galeria.salvarEstado(caminho, estado);
  return achada.planta;
}

// Devolve a chave da imagem pra quem chama apagar do armazenamento.
function excluirPlanta(caminho, projetoId, plantaId, licencaUsuario) {
  const estado = galeria.lerEstado(caminho);
  const g = galeria.exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  const achada = acharPlanta(g, plantaId);
  if (!achada) throw new Error('Planta não encontrada.');
  achada.lista.splice(achada.lista.indexOf(achada.planta), 1);
  if (!achada.lista.length) delete g.memorial.plantas[achada.setor];
  g.atualizadoEm = new Date().toISOString();
  galeria.salvarEstado(caminho, estado);
  return achada.planta.r2Key;
}

// ---------- ambientes da conta (o arquiteto acrescenta, renomeia, exclui e restaura os padrão) ----------
const LIMITE_AMBIENTES = 60;

function nomeDeAmbiente(valor) {
  const t = textoLimpo(valor, 24, 'Nome do ambiente').replace(/\s+/g, ' ');
  if (!t) throw new Error('Dê um nome (ou código) ao ambiente.');
  return t;
}

// Quantos itens usam cada ambiente, somando TODOS os projetos da conta (mostrado no app antes de excluir/renomear).
function usosDosAmbientes(estado, licencaUsuario) {
  const usos = {};
  estado.galerias.filter((g) => g.licencaUsuario === licencaUsuario).forEach((g) => {
    ((g.memorial && g.memorial.itens) || []).forEach((i) => (i.ambientes || []).forEach((a) => { usos[a] = (usos[a] || 0) + 1; }));
  });
  return usos;
}

function respostaAmbientes(estado, licencaUsuario) {
  return { ambientes: ambientesDaConta(estado, licencaUsuario), usos: usosDosAmbientes(estado, licencaUsuario), padrao: AMBIENTES };
}

function gravarAmbientes(caminho, estado, licencaUsuario, lista) {
  const atual = estado.perfis[licencaUsuario] || { icone: { r2Key: null }, marca: { r2Key: null } };
  if (lista) atual.ambientesMemorial = lista; else delete atual.ambientesMemorial; // sem lista própria = os padrão
  estado.perfis[licencaUsuario] = atual;
  galeria.salvarEstado(caminho, estado);
}

function lerAmbientes(caminho, licencaUsuario) {
  if (!licencaUsuario) throw new Error('licencaUsuario é obrigatório.');
  return respostaAmbientes(galeria.lerEstado(caminho), licencaUsuario);
}

function adicionarAmbiente(caminho, licencaUsuario, nome) {
  if (!licencaUsuario) throw new Error('licencaUsuario é obrigatório.');
  const estado = galeria.lerEstado(caminho);
  const novo = nomeDeAmbiente(nome);
  const lista = ambientesDaConta(estado, licencaUsuario).slice();
  if (lista.length >= LIMITE_AMBIENTES) throw new Error(`No máximo ${LIMITE_AMBIENTES} ambientes.`);
  if (lista.some((a) => norm(a) === norm(novo))) throw new Error('Já existe um ambiente com esse nome.');
  lista.push(novo);
  gravarAmbientes(caminho, estado, licencaUsuario, lista);
  return respostaAmbientes(estado, licencaUsuario);
}

// Os itens que usavam o nome antigo (em TODOS os projetos da conta) passam a usar o novo.
function renomearAmbiente(caminho, licencaUsuario, de, para) {
  if (!licencaUsuario) throw new Error('licencaUsuario é obrigatório.');
  const estado = galeria.lerEstado(caminho);
  const lista = ambientesDaConta(estado, licencaUsuario).slice();
  const i = lista.indexOf(de);
  if (i < 0) throw new Error('Ambiente não encontrado.');
  const novo = nomeDeAmbiente(para);
  if (lista.some((a, j) => j !== i && norm(a) === norm(novo))) throw new Error('Já existe um ambiente com esse nome.');
  lista[i] = novo;
  const agora = new Date().toISOString();
  estado.galerias.filter((g) => g.licencaUsuario === licencaUsuario).forEach((g) => {
    ((g.memorial && g.memorial.itens) || []).forEach((it) => {
      if (!(it.ambientes || []).includes(de)) return;
      it.ambientes = ambientesValidos(it.ambientes.map((a) => (a === de ? novo : a)), lista, it.ambientes.concat(novo));
      it.atualizadoEm = agora;
      g.atualizadoEm = agora;
    });
  });
  gravarAmbientes(caminho, estado, licencaUsuario, lista);
  return respostaAmbientes(estado, licencaUsuario);
}

// Sobe ('cima') ou desce ('baixo') um ambiente na lista. A etiqueta dos itens também segue a ordem nova (em todos os projetos da conta).
function moverAmbiente(caminho, licencaUsuario, nome, direcao) {
  if (!licencaUsuario) throw new Error('licencaUsuario é obrigatório.');
  if (direcao !== 'cima' && direcao !== 'baixo') throw new Error('Direção inválida.');
  const estado = galeria.lerEstado(caminho);
  const lista = ambientesDaConta(estado, licencaUsuario).slice();
  const i = lista.indexOf(nome);
  if (i < 0) throw new Error('Ambiente não encontrado.');
  const j = direcao === 'cima' ? i - 1 : i + 1;
  if (j < 0 || j >= lista.length) return respostaAmbientes(estado, licencaUsuario); // já está na ponta: nada a fazer
  [lista[i], lista[j]] = [lista[j], lista[i]];
  estado.galerias.filter((g) => g.licencaUsuario === licencaUsuario).forEach((g) => {
    ((g.memorial && g.memorial.itens) || []).forEach((it) => { if ((it.ambientes || []).length > 1) it.ambientes = ambientesValidos(it.ambientes, lista, it.ambientes); });
  });
  gravarAmbientes(caminho, estado, licencaUsuario, lista);
  return respostaAmbientes(estado, licencaUsuario);
}

// Tira da LISTA de escolha. Os itens que já tinham a etiqueta ficam como estão (ninguém perde informação sem querer).
function excluirAmbiente(caminho, licencaUsuario, nome) {
  if (!licencaUsuario) throw new Error('licencaUsuario é obrigatório.');
  const estado = galeria.lerEstado(caminho);
  const lista = ambientesDaConta(estado, licencaUsuario).slice();
  const i = lista.indexOf(nome);
  if (i < 0) throw new Error('Ambiente não encontrado.');
  if (lista.length <= 1) throw new Error('Precisa sobrar pelo menos um ambiente.');
  lista.splice(i, 1);
  gravarAmbientes(caminho, estado, licencaUsuario, lista);
  return respostaAmbientes(estado, licencaUsuario);
}

function restaurarAmbientes(caminho, licencaUsuario) {
  if (!licencaUsuario) throw new Error('licencaUsuario é obrigatório.');
  const estado = galeria.lerEstado(caminho);
  gravarAmbientes(caminho, estado, licencaUsuario, null);
  return respostaAmbientes(estado, licencaUsuario);
}

module.exports = {
  LIMITE_AMBIENTES, lerAmbientes, adicionarAmbiente, renomearAmbiente, moverAmbiente, excluirAmbiente, restaurarAmbientes,
  SETORES, AMBIENTES, STATUS_ITEM, DIMENSOES_MODELO, LIMITE_ITENS_POR_PROJETO, LIMITE_FOTOS_POR_PROJETO, LIMITE_BYTES_FOTO, TIPOS_FOTO,
  LIMITE_SETORES, adicionarSetor, renomearSetor, excluirSetor, ordenarSetores, definirModoSetor, MODOS_SETOR, LIMITE_FOTOS_POR_ITEM,
  excluirItemComFotos, conferirPodeReceberFotoExtra, adicionarFotoExtra, removerFotoExtra, tornarCapa,
  LIMITE_PLANTAS_POR_SETOR, LIMITE_PLANTAS_POR_PROJETO, LIMITE_MARCAS_POR_PLANTA, LIMITE_TEXTOS_POR_PLANTA, LIMITE_BYTES_PLANTA,
  conferirPodeReceberPlanta, adicionarPlanta, renomearPlanta, definirMarcasDaPlanta, definirTextosDaPlanta, definirTamanhoMarcasDaPlanta, TAMANHO_MARCAS, tamanhoMarcasDe, excluirPlanta,
  lerParaArquiteto, adicionarItem, editarItem, excluirItem, conferirPodeReceberFoto, definirFoto, paraCliente,
  ambientesDaConta, ambientesValidos
};
