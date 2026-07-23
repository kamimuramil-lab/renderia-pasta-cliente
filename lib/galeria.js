// lib/galeria.js
// Camada de dados pura (sem servidor/rede), testável com Node puro --
// mesmo padrão do lib/dados-licenca.js do servidor de licenças.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const LIMITE_FOTOS_POR_PROJETO = 50;

function caminhoPadrao(baseDir) {
  const diretorio = process.env.DADOS_DIR || baseDir || __dirname;
  return path.join(diretorio, 'dados-galerias.json');
}

function lerEstado(caminho) {
  try {
    const estado = JSON.parse(fs.readFileSync(caminho, 'utf8'));
    if (!Array.isArray(estado.galerias)) estado.galerias = [];
    // Migração silenciosa: galerias criadas antes das categorias/marca
    // d'água/ícone existirem não têm esses campos -- garante que sempre
    // existem, pra não quebrar nada que espere isso aqui.
    estado.galerias.forEach((g) => {
      if (!Array.isArray(g.categorias)) g.categorias = [];
      if (!g.marcaDagua) g.marcaDagua = { ativa: false, r2Key: null, transparencia: 100, escala: 100 };
      if (!g.iconePersonalizado) g.iconePersonalizado = { r2Key: null };
    });
    return estado;
  } catch (e) {
    return { galerias: [] };
  }
}

function salvarEstado(caminho, estado) {
  const pasta = path.dirname(caminho);
  if (!fs.existsSync(pasta)) fs.mkdirSync(pasta, { recursive: true });
  fs.writeFileSync(caminho, JSON.stringify(estado, null, 2));
}

function gerarToken() {
  return crypto.randomBytes(24).toString('hex');
}

// Token de link mais curto (vai numa URL) mas ainda assim impossível de
// adivinhar por tentativa -- 16 bytes = 32 caracteres hex.
function gerarLinkToken() {
  return crypto.randomBytes(16).toString('hex');
}

function buscarGaleriaPorProjeto(caminho, projetoId) {
  const estado = lerEstado(caminho);
  return estado.galerias.find((g) => g.projetoId === projetoId) || null;
}

function buscarGaleriaPorLinkToken(caminho, linkToken) {
  const estado = lerEstado(caminho);
  return estado.galerias.find((g) => g.linkToken === linkToken) || null;
}

// Cria a galeria a primeira vez que o arquiteto abre "PASTA DO CLIENTE"
// pra esse projeto, ou atualiza a configuração (nome, login do cliente)
// se já existir. Trocar a senha do cliente derruba as sessões "lembradas"
// dele (precisa logar de novo com a senha nova).
function criarOuAtualizarGaleria(caminho, { projetoId, licencaUsuario, nomeProjeto, clienteUsuario, clienteSenha }) {
  if (!projetoId) throw new Error('projetoId é obrigatório.');
  if (!licencaUsuario) throw new Error('licencaUsuario é obrigatório.');
  const estado = lerEstado(caminho);
  let galeria = estado.galerias.find((g) => g.projetoId === projetoId);

  if (!galeria) {
    if (!clienteUsuario || !clienteSenha) {
      throw new Error('Pra criar a Pasta do Cliente pela primeira vez, informe o usuário e a senha do cliente.');
    }
    if (clienteSenha.length < 4) throw new Error('Senha do cliente precisa ter pelo menos 4 caracteres.');
    galeria = {
      projetoId,
      licencaUsuario,
      linkToken: gerarLinkToken(),
      clienteUsuario: clienteUsuario.trim(),
      clienteSenhaHash: bcrypt.hashSync(clienteSenha, 10),
      nomeProjeto: (nomeProjeto && nomeProjeto.trim()) || 'Projeto',
      criadoEm: new Date().toISOString(),
      atualizadoEm: new Date().toISOString(),
      temComentarioNaoLido: false,
      sessoesClienteAtivas: [],
      categorias: [],
      marcaDagua: { ativa: false, r2Key: null, transparencia: 100, escala: 100 },
      iconePersonalizado: { r2Key: null },
      fotos: []
    };
    estado.galerias.push(galeria);
  } else {
    if (nomeProjeto !== undefined) galeria.nomeProjeto = (nomeProjeto && nomeProjeto.trim()) || galeria.nomeProjeto;
    if (clienteUsuario !== undefined && clienteUsuario.trim()) galeria.clienteUsuario = clienteUsuario.trim();
    if (clienteSenha) {
      if (clienteSenha.length < 4) throw new Error('Senha do cliente precisa ter pelo menos 4 caracteres.');
      galeria.clienteSenhaHash = bcrypt.hashSync(clienteSenha, 10);
      galeria.sessoesClienteAtivas = []; // força login de novo com a senha nova
    }
    galeria.atualizadoEm = new Date().toISOString();
  }
  salvarEstado(caminho, estado);
  return galeria;
}

// Soma as fotos NÃO excluídas (arquivadas contam, excluídas de vez não)
// de TODOS os projetos desse arquiteto -- é o número comparado com o
// limiteFotos que vem do servidor de licenças.
function contarFotosDoUsuario(caminho, licencaUsuario) {
  const estado = lerEstado(caminho);
  return estado.galerias
    .filter((g) => g.licencaUsuario === licencaUsuario)
    .reduce((soma, g) => soma + g.fotos.length, 0);
}

function adicionarFoto(caminho, projetoId, { nomeExibicao, tag, tipo, r2Key, capturaIdOrigem, categoriaId }) {
  if (!r2Key) throw new Error('r2Key é obrigatório (referência do arquivo já salvo no armazenamento).');
  const estado = lerEstado(caminho);
  const galeria = estado.galerias.find((g) => g.projetoId === projetoId);
  if (!galeria) throw new Error('Pasta do Cliente não encontrada pra esse projeto -- crie ela primeiro.');
  if (galeria.fotos.length >= LIMITE_FOTOS_POR_PROJETO) {
    throw new Error(`Esse projeto já está no limite de ${LIMITE_FOTOS_POR_PROJETO} fotos na Pasta do Cliente. Arquive ou exclua alguma antes de adicionar outra.`);
  }
  const foto = {
    id: 'foto_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
    capturaIdOrigem: capturaIdOrigem || null, // qual captura, na galeria normal do app, essa foto veio -- usado pro selinho de "aprovada" voltar pra lá
    nomeExibicao: (nomeExibicao && nomeExibicao.trim()) || '',
    tag: (tag && tag.trim()) || null,
    categoriaId: categoriaId || null,
    tipo: tipo === '360' ? '360' : 'fixa',
    ordem: galeria.fotos.length,
    r2Key,
    arquivada: false,
    aprovada: false,
    comentarios: [],
    criadoEm: new Date().toISOString()
  };
  galeria.fotos.push(foto);
  galeria.atualizadoEm = new Date().toISOString();
  salvarEstado(caminho, estado);
  return foto;
}

function editarFoto(caminho, projetoId, fotoId, { nomeExibicao, tag, ordem, arquivada, categoriaId }) {
  const estado = lerEstado(caminho);
  const galeria = estado.galerias.find((g) => g.projetoId === projetoId);
  if (!galeria) throw new Error('Pasta do Cliente não encontrada.');
  const foto = galeria.fotos.find((f) => f.id === fotoId);
  if (!foto) throw new Error('Foto não encontrada.');
  if (nomeExibicao !== undefined) foto.nomeExibicao = nomeExibicao.trim();
  if (tag !== undefined) foto.tag = (tag && tag.trim()) || null;
  if (ordem !== undefined) foto.ordem = ordem;
  if (arquivada !== undefined) foto.arquivada = !!arquivada;
  if (categoriaId !== undefined) foto.categoriaId = categoriaId || null;
  galeria.atualizadoEm = new Date().toISOString();
  salvarEstado(caminho, estado);
  return foto;
}

// Reordena (e opcionalmente move de categoria) várias fotos de UMA VEZ,
// numa única leitura/escrita do arquivo -- é isso que evita a corrida
// que existia antes (várias chamadas de editarFoto em paralelo podiam
// se sobrescrever umas às outras: cada uma lia o arquivo, mexia só numa
// foto, e escrevia de volta -- se duas rodassem ao mesmo tempo, a
// segunda podia escrever por cima da primeira e perder a mudança dela).
function reordenarFotos(caminho, projetoId, categoriaId, ordemDosIds) {
  const estado = lerEstado(caminho);
  const galeria = estado.galerias.find((g) => g.projetoId === projetoId);
  if (!galeria) throw new Error('Pasta do Cliente não encontrada.');
  ordemDosIds.forEach((fotoId, indice) => {
    const foto = galeria.fotos.find((f) => f.id === fotoId);
    if (!foto) return;
    foto.ordem = indice;
    if (categoriaId !== undefined) foto.categoriaId = categoriaId || null;
  });
  galeria.atualizadoEm = new Date().toISOString();
  salvarEstado(caminho, estado);
  return galeria.fotos.filter((f) => ordemDosIds.includes(f.id));
}

// Exclui a foto DE VERDADE (libera espaço na quota) -- devolve o r2Key
// removido, pra quem chamou também apagar o arquivo real do armazenamento.
function excluirFoto(caminho, projetoId, fotoId) {
  const estado = lerEstado(caminho);
  const galeria = estado.galerias.find((g) => g.projetoId === projetoId);
  if (!galeria) throw new Error('Pasta do Cliente não encontrada.');
  const idx = galeria.fotos.findIndex((f) => f.id === fotoId);
  if (idx === -1) throw new Error('Foto não encontrada.');
  const [removida] = galeria.fotos.splice(idx, 1);
  galeria.atualizadoEm = new Date().toISOString();
  salvarEstado(caminho, estado);
  return removida.r2Key;
}

// --------------------------------------------------------------------
// CATEGORIAS (ambientes) -- agrupam fotos, podem ter um mood como capa.
// --------------------------------------------------------------------
function criarCategoria(caminho, projetoId, nome) {
  if (!nome || !nome.trim()) throw new Error('Dê um nome pra categoria.');
  const estado = lerEstado(caminho);
  const galeria = estado.galerias.find((g) => g.projetoId === projetoId);
  if (!galeria) throw new Error('Pasta do Cliente não encontrada.');
  const categoria = {
    id: 'cat_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
    nome: nome.trim(),
    ordem: galeria.categorias.length,
    moodFotoId: null // referencia o id de uma foto (tipo moodboard) já enviada, usada como capa
  };
  galeria.categorias.push(categoria);
  galeria.atualizadoEm = new Date().toISOString();
  salvarEstado(caminho, estado);
  return categoria;
}

function editarCategoria(caminho, projetoId, categoriaId, { nome, ordem, moodFotoId }) {
  const estado = lerEstado(caminho);
  const galeria = estado.galerias.find((g) => g.projetoId === projetoId);
  if (!galeria) throw new Error('Pasta do Cliente não encontrada.');
  const categoria = galeria.categorias.find((c) => c.id === categoriaId);
  if (!categoria) throw new Error('Categoria não encontrada.');
  if (nome !== undefined) categoria.nome = (nome && nome.trim()) || categoria.nome;
  if (ordem !== undefined) categoria.ordem = ordem;
  if (moodFotoId !== undefined) categoria.moodFotoId = moodFotoId || null;
  galeria.atualizadoEm = new Date().toISOString();
  salvarEstado(caminho, estado);
  return categoria;
}

// Excluir uma categoria NÃO exclui as fotos dela -- elas só voltam a
// ficar "sem categoria" (categoriaId: null).
function excluirCategoria(caminho, projetoId, categoriaId) {
  const estado = lerEstado(caminho);
  const galeria = estado.galerias.find((g) => g.projetoId === projetoId);
  if (!galeria) throw new Error('Pasta do Cliente não encontrada.');
  galeria.categorias = galeria.categorias.filter((c) => c.id !== categoriaId);
  galeria.fotos.forEach((f) => { if (f.categoriaId === categoriaId) f.categoriaId = null; });
  galeria.atualizadoEm = new Date().toISOString();
  salvarEstado(caminho, estado);
  return true;
}


// --------------------------------------------------------------------
// MARCA D'ÁGUA E ÍCONE PERSONALIZADO -- personalização por arquiteto.
// A imagem em si (arquivo) é enviada separadamente pro R2 (mesmo jeito
// que uma foto) -- aqui só guardamos a referência (r2Key) e as opções.
// --------------------------------------------------------------------
function atualizarMarcaDagua(caminho, projetoId, { r2Key, ativa, transparencia, escala }) {
  const estado = lerEstado(caminho);
  const galeria = estado.galerias.find((g) => g.projetoId === projetoId);
  if (!galeria) throw new Error('Pasta do Cliente não encontrada.');
  if (r2Key !== undefined) galeria.marcaDagua.r2Key = r2Key;
  if (ativa !== undefined) galeria.marcaDagua.ativa = !!ativa;
  if (transparencia !== undefined) galeria.marcaDagua.transparencia = Math.max(10, Math.min(100, Number(transparencia) || 100));
  if (escala !== undefined) galeria.marcaDagua.escala = Math.max(10, Math.min(100, Number(escala) || 100));
  galeria.atualizadoEm = new Date().toISOString();
  salvarEstado(caminho, estado);
  return galeria.marcaDagua;
}

function atualizarIconePersonalizado(caminho, projetoId, r2Key) {
  const estado = lerEstado(caminho);
  const galeria = estado.galerias.find((g) => g.projetoId === projetoId);
  if (!galeria) throw new Error('Pasta do Cliente não encontrada.');
  galeria.iconePersonalizado.r2Key = r2Key || null;
  galeria.atualizadoEm = new Date().toISOString();
  salvarEstado(caminho, estado);
  return galeria.iconePersonalizado;
}

// --------------------------------------------------------------------
// LOGIN E SESSÃO DO CLIENTE (público, via link -- nunca toca no
// servidor de licenças, que é só pro arquiteto)
// --------------------------------------------------------------------
function loginCliente(caminho, linkToken, usuario, senha) {
  const estado = lerEstado(caminho);
  const galeria = estado.galerias.find((g) => g.linkToken === linkToken);
  if (!galeria) throw new Error('Link não encontrado.');
  if (galeria.clienteUsuario !== (usuario || '').trim() || !bcrypt.compareSync(senha || '', galeria.clienteSenhaHash)) {
    throw new Error('Usuário ou senha incorretos.');
  }
  const token = gerarToken();
  galeria.sessoesClienteAtivas.push({ token, criadaEm: new Date().toISOString() });
  salvarEstado(caminho, estado);
  return token;
}

function validarTokenCliente(caminho, linkToken, token) {
  const galeria = buscarGaleriaPorLinkToken(caminho, linkToken);
  if (!galeria) return false;
  return galeria.sessoesClienteAtivas.some((s) => s.token === token);
}

// --------------------------------------------------------------------
// COMENTÁRIOS E APROVAÇÃO (o cliente faz isso, autenticado)
// --------------------------------------------------------------------
function comentarFoto(caminho, linkToken, fotoId, { texto, desenhoR2Key }) {
  if (!texto && !desenhoR2Key) throw new Error('Comentário vazio.');
  const estado = lerEstado(caminho);
  const galeria = estado.galerias.find((g) => g.linkToken === linkToken);
  if (!galeria) throw new Error('Pasta do Cliente não encontrada.');
  const foto = galeria.fotos.find((f) => f.id === fotoId);
  if (!foto) throw new Error('Foto não encontrada.');
  foto.comentarios.push({
    id: 'com_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
    texto: texto || null,
    desenhoR2Key: desenhoR2Key || null,
    criadoEm: new Date().toISOString(),
    lido: false
  });
  galeria.temComentarioNaoLido = true;
  galeria.atualizadoEm = new Date().toISOString();
  salvarEstado(caminho, estado);
  return true;
}

function aprovarFoto(caminho, linkToken, fotoId, aprovada) {
  const estado = lerEstado(caminho);
  const galeria = estado.galerias.find((g) => g.linkToken === linkToken);
  if (!galeria) throw new Error('Pasta do Cliente não encontrada.');
  const foto = galeria.fotos.find((f) => f.id === fotoId);
  if (!foto) throw new Error('Foto não encontrada.');
  foto.aprovada = !!aprovada;
  // Reaproveita o mesmo selinho dos comentários -- pro arquiteto também
  // ficar sabendo quando uma foto é aprovada, não só quando comentam.
  galeria.temComentarioNaoLido = true;
  galeria.atualizadoEm = new Date().toISOString();
  salvarEstado(caminho, estado);
  return true;
}

// Chamado pelo APP (arquiteto) quando ele abre a tela da Pasta do Cliente
// e vê os comentários -- limpa o selinho de "novo comentário".
function marcarComentariosLidos(caminho, projetoId) {
  const estado = lerEstado(caminho);
  const galeria = estado.galerias.find((g) => g.projetoId === projetoId);
  if (!galeria) throw new Error('Pasta do Cliente não encontrada.');
  galeria.temComentarioNaoLido = false;
  galeria.fotos.forEach((f) => f.comentarios.forEach((c) => { c.lido = true; }));
  salvarEstado(caminho, estado);
  return true;
}

module.exports = {
  LIMITE_FOTOS_POR_PROJETO,
  caminhoPadrao, lerEstado, salvarEstado,
  buscarGaleriaPorProjeto, buscarGaleriaPorLinkToken,
  criarOuAtualizarGaleria, contarFotosDoUsuario,
  adicionarFoto, editarFoto, excluirFoto, reordenarFotos,
  criarCategoria, editarCategoria, excluirCategoria,
  atualizarMarcaDagua, atualizarIconePersonalizado,
  loginCliente, validarTokenCliente,
  comentarFoto, aprovarFoto, marcarComentariosLidos
};
