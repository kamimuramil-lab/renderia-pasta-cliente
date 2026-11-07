// lib/galeria.js
// Camada de dados pura (sem servidor/rede), testável com Node puro --
// mesmo padrão do lib/dados-licenca.js do servidor de licenças.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const LIMITE_FOTOS_POR_PROJETO = 50;
const LIMITE_PLANTAS_POR_PROJETO = 10; // uma por pavimento -- 10 já é de sobra

function caminhoPadrao(baseDir) {
  const diretorio = process.env.DADOS_DIR || baseDir || __dirname;
  return path.join(diretorio, 'dados-galerias.json');
}

function lerEstado(caminho) {
  try {
    const estado = JSON.parse(fs.readFileSync(caminho, 'utf8'));
    if (!Array.isArray(estado.galerias)) estado.galerias = [];
    // Ícone e logo da CONTA do arquiteto (configurados uma vez, valem pra todos os projetos): { [licencaUsuario]: {...} }
    if (!estado.perfis || typeof estado.perfis !== 'object' || Array.isArray(estado.perfis)) estado.perfis = {};
    // Migração silenciosa: galerias criadas antes das categorias/marca
    // d'água/ícone existirem não têm esses campos -- garante que sempre
    // existem, pra não quebrar nada que espere isso aqui.
    estado.galerias.forEach((g) => {
      if (!Array.isArray(g.categorias)) g.categorias = [];
      if (!g.marcaDagua) g.marcaDagua = { ativa: true, r2Key: null, transparencia: 100, escala: 100, migradoParaPerfil: true };
      if (!g.iconePersonalizado) g.iconePersonalizado = { r2Key: null };
      // Logo da conta (nov/2026): galeria que NUNCA teve logo próprio passa a mostrar o logo da conta (ligado por
      // padrão, a pedido do Rodrigo -- vale também pras galerias antigas). Roda UMA vez por galeria (a marca
      // `migradoParaPerfil` é gravada junto): se a pessoa desligar depois, o desligado vale. Galeria que tem
      // logo PRÓPRIO mantém a escolha dela. Sem logo nenhum (nem da conta), nada aparece -- então é seguro.
      if (!g.marcaDagua.migradoParaPerfil) {
        if (!g.marcaDagua.r2Key && g.marcaDagua.ativa === false) g.marcaDagua.ativa = true;
        g.marcaDagua.migradoParaPerfil = true;
      }
      // "Exibir ícone" por projeto (ligado por padrão): desliga só a EXIBIÇÃO, sem apagar o arquivo.
      if (g.iconePersonalizado.exibir === undefined) g.iconePersonalizado.exibir = true;
      // Plantas baixas (uma por pavimento) -- só ADICIONA o campo, nunca
      // mexe em nada que já existia, então galerias antigas seguem iguais.
      if (!Array.isArray(g.plantas)) g.plantas = [];
    });
    return estado;
  } catch (e) {
    return { galerias: [], perfis: {} };
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

// Confere que a galeria existe E pertence a essa licença -- centraliza a
// checagem de posse (auditoria de segurança, ago/2026) pra toda função
// que mexe num projeto específico. Antes, algumas funções (categorias,
// marca d'água via PUT, marcarComentariosLidos, e principalmente a
// criação/atualização da própria galeria) só checavam se o projeto
// EXISTIA, nunca se pertencia a quem estava pedindo -- o que permitia
// qualquer arquiteto autenticado mexer no projeto de outro, sabendo (ou
// adivinhando) o projetoId. Lança erro se não existir OU não pertencer.
function exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario) {
  const galeria = estado.galerias.find((g) => g.projetoId === projetoId);
  if (!galeria) throw new Error('Pasta do Cliente não encontrada.');
  if (galeria.licencaUsuario !== licencaUsuario) throw new Error('Esse projeto não pertence a essa licença.');
  return galeria;
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
      marcaDagua: { ativa: true, r2Key: null, transparencia: 100, escala: 100, migradoParaPerfil: true }, // ligada por padrão (aparece se houver logo próprio ou da conta)
      iconePersonalizado: { r2Key: null, exibir: true },
      plantas: [],
      fotos: []
    };
    estado.galerias.push(galeria);
  } else {
    // CORREÇÃO DE SEGURANÇA (C1, auditoria ago/2026): antes disso não
    // existia NENHUMA checagem aqui -- qualquer arquiteto autenticado
    // podia "atualizar" (e sobrescrever as credenciais do cliente de) a
    // galeria de OUTRO arquiteto, só sabendo/adivinhando o projetoId.
    if (galeria.licencaUsuario !== licencaUsuario) {
      throw new Error('Esse projeto não pertence a essa licença.');
    }
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
function criarCategoria(caminho, projetoId, nome, licencaUsuario) {
  if (!nome || !nome.trim()) throw new Error('Dê um nome pra categoria.');
  const estado = lerEstado(caminho);
  const galeria = exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
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

function editarCategoria(caminho, projetoId, categoriaId, { nome, ordem, moodFotoId }, licencaUsuario) {
  const estado = lerEstado(caminho);
  const galeria = exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
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
function excluirCategoria(caminho, projetoId, categoriaId, licencaUsuario) {
  const estado = lerEstado(caminho);
  const galeria = exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
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
function atualizarMarcaDagua(caminho, projetoId, { r2Key, ativa, transparencia, escala }, licencaUsuario) {
  const estado = lerEstado(caminho);
  const galeria = exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
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

// "Exibir ícone" desse projeto (liga/desliga só a exibição -- nunca apaga arquivo).
function atualizarExibirIcone(caminho, projetoId, exibir, licencaUsuario) {
  const estado = lerEstado(caminho);
  const galeria = exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  galeria.iconePersonalizado.exibir = !!exibir;
  galeria.atualizadoEm = new Date().toISOString();
  salvarEstado(caminho, estado);
  return galeria.iconePersonalizado;
}

// Tira o ícone/logo PRÓPRIO do projeto (volta a valer o da conta). Devolve a chave antiga pro chamador apagar o arquivo.
function removerPersonalizacaoPropria(caminho, projetoId, tipo, licencaUsuario) {
  if (tipo !== 'icone' && tipo !== 'marca') throw new Error('Tipo inválido.');
  const estado = lerEstado(caminho);
  const galeria = exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  const alvo = tipo === 'icone' ? galeria.iconePersonalizado : galeria.marcaDagua;
  const antiga = alvo.r2Key || null;
  alvo.r2Key = null;
  galeria.atualizadoEm = new Date().toISOString();
  salvarEstado(caminho, estado);
  return antiga;
}

// --------------------------------------------------------------------
// ÍCONE E LOGO DA CONTA (nov/2026) -- o arquiteto configura UMA vez (Configurações do app) e vale pra todos os
// projetos, inclusive as galerias já enviadas. Guardado por licença (quem manda é a sessão, nunca um parâmetro da
// tela). O ícone/logo PRÓPRIO de um projeto, quando existe, vence o da conta.
//   perfil: { icone: { r2Key }, marca: { r2Key } }
// --------------------------------------------------------------------
function perfilVazio() { return { icone: { r2Key: null }, marca: { r2Key: null } }; }

function perfilDaLicenca(estado, licencaUsuario) {
  const p = (estado.perfis && licencaUsuario && estado.perfis[licencaUsuario]) || {};
  return {
    icone: { r2Key: (p.icone && p.icone.r2Key) || null },
    marca: { r2Key: (p.marca && p.marca.r2Key) || null }
  };
}

function lerPerfil(caminho, licencaUsuario) {
  return perfilDaLicenca(lerEstado(caminho), licencaUsuario);
}

// Guarda a chave do arquivo novo e devolve a antiga (o chamador apaga o arquivo velho do armazenamento).
function definirArquivoPerfil(caminho, licencaUsuario, tipo, r2Key) {
  if (!licencaUsuario) throw new Error('licencaUsuario é obrigatório.');
  if (tipo !== 'icone' && tipo !== 'marca') throw new Error('Tipo inválido.');
  const estado = lerEstado(caminho);
  const atual = estado.perfis[licencaUsuario] || perfilVazio();
  const antiga = (atual[tipo] && atual[tipo].r2Key) || null;
  atual[tipo] = { r2Key: r2Key || null };
  estado.perfis[licencaUsuario] = atual;
  salvarEstado(caminho, estado);
  return antiga;
}

function removerArquivoPerfil(caminho, licencaUsuario, tipo) {
  return definirArquivoPerfil(caminho, licencaUsuario, tipo, null);
}

// O que VALE de verdade pra uma galeria: o próprio do projeto, senão o da conta. `origem` = de onde veio.
function resolverPersonalizacao(estado, galeriaObj) {
  const perfil = perfilDaLicenca(estado, galeriaObj.licencaUsuario);
  const proprioIcone = galeriaObj.iconePersonalizado && galeriaObj.iconePersonalizado.r2Key;
  const proprioMarca = galeriaObj.marcaDagua && galeriaObj.marcaDagua.r2Key;
  return {
    iconeR2Key: proprioIcone || perfil.icone.r2Key || null,
    iconeOrigem: proprioIcone ? 'projeto' : (perfil.icone.r2Key ? 'conta' : null),
    iconeExibir: !(galeriaObj.iconePersonalizado && galeriaObj.iconePersonalizado.exibir === false),
    marcaR2Key: proprioMarca || perfil.marca.r2Key || null,
    marcaOrigem: proprioMarca ? 'projeto' : (perfil.marca.r2Key ? 'conta' : null)
  };
}

// --------------------------------------------------------------------
// PLANTAS BAIXAS (uma por pavimento) -- o cliente abre a planta primeiro e
// navega pelos ícones das fotos/360°. A posição de cada foto na planta é
// guardada em FRAÇÃO da imagem (x e y de 0 a 1), não em pixels, pra ficar
// no lugar certo em qualquer tamanho de tela/zoom.
//   planta: { id, nome, r2Key, ordem, criadaEm }
//   foto:   { ..., plantaId: string|null, pinPlanta: { x, y }|null }
// Toda função aqui confere a POSSE do projeto (exigirGaleriaDaLicenca) --
// foi esse o padrão que faltou na auditoria de segurança de ago/2026.
// --------------------------------------------------------------------
function adicionarPlanta(caminho, projetoId, { nome, r2Key }, licencaUsuario) {
  if (!r2Key) throw new Error('r2Key é obrigatório (referência do arquivo já salvo no armazenamento).');
  const estado = lerEstado(caminho);
  const galeria = exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  if (galeria.plantas.length >= LIMITE_PLANTAS_POR_PROJETO) {
    throw new Error(`Esse projeto já tem o máximo de ${LIMITE_PLANTAS_POR_PROJETO} plantas. Exclua alguma antes de adicionar outra.`);
  }
  const planta = {
    id: 'planta_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
    nome: (nome && String(nome).trim()) || `Planta ${galeria.plantas.length + 1}`,
    r2Key,
    ordem: galeria.plantas.length,
    criadaEm: new Date().toISOString()
  };
  galeria.plantas.push(planta);
  galeria.atualizadoEm = new Date().toISOString();
  salvarEstado(caminho, estado);
  return planta;
}

function editarPlanta(caminho, projetoId, plantaId, { nome, ordem }, licencaUsuario) {
  const estado = lerEstado(caminho);
  const galeria = exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  const planta = galeria.plantas.find((p) => p.id === plantaId);
  if (!planta) throw new Error('Planta não encontrada.');
  if (nome !== undefined) planta.nome = (nome && String(nome).trim()) || planta.nome;
  if (ordem !== undefined && Number.isFinite(Number(ordem))) planta.ordem = Number(ordem);
  galeria.atualizadoEm = new Date().toISOString();
  salvarEstado(caminho, estado);
  return planta;
}

// Troca SÓ a imagem da planta (ex: versão corrigida) -- os ícones das fotos
// continuam nas mesmas posições. Devolve a chave ANTIGA pra quem chamou
// apagar o arquivo antigo do armazenamento.
function atualizarImagemPlanta(caminho, projetoId, plantaId, r2Key, licencaUsuario) {
  if (!r2Key) throw new Error('r2Key é obrigatório.');
  const estado = lerEstado(caminho);
  const galeria = exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  const planta = galeria.plantas.find((p) => p.id === plantaId);
  if (!planta) throw new Error('Planta não encontrada.');
  const antiga = planta.r2Key;
  planta.r2Key = r2Key;
  galeria.atualizadoEm = new Date().toISOString();
  salvarEstado(caminho, estado);
  return { planta, r2KeyAntiga: antiga };
}

// Excluir a planta NÃO exclui as fotos -- só tira os ícones dela (as fotos
// continuam na galeria e voltam a ficar "sem posição na planta").
// Devolve o r2Key removido pra quem chamou apagar o arquivo real.
function excluirPlanta(caminho, projetoId, plantaId, licencaUsuario) {
  const estado = lerEstado(caminho);
  const galeria = exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  const idx = galeria.plantas.findIndex((p) => p.id === plantaId);
  if (idx === -1) throw new Error('Planta não encontrada.');
  const [removida] = galeria.plantas.splice(idx, 1);
  galeria.fotos.forEach((f) => {
    if (f.plantaId === plantaId) { f.plantaId = null; f.pinPlanta = null; }
  });
  galeria.atualizadoEm = new Date().toISOString();
  salvarEstado(caminho, estado);
  return removida.r2Key;
}

// Coloca (ou move) o ícone de uma foto numa planta. plantaId vazio/null
// TIRA o ícone da planta (a foto volta pra "sem posição"). x e y são
// frações da imagem da planta; valores fora de 0..1 são travados nas bordas.
// Direção da câmera (leque na planta): `angulo` em GRAUS, 0 = pra cima (norte da planta), crescendo no sentido
// horário (90 = direita). Só existe em ícone de imagem FIXA (o 360° olha pra todos os lados). Normaliza pra 0..360.
function normalizarAngulo(valor) {
  const n = Number(valor);
  if (valor === '' || (typeof valor !== 'number' && typeof valor !== 'string') || !Number.isFinite(n)) throw new Error('Ângulo inválido.');
  return Math.round((((n % 360) + 360) % 360) * 10) / 10 % 360;
}

// Mover o ícone NÃO perde a direção já definida; `angulo` junto com a posição (ou null) também é aceito.
function posicionarFotoNaPlanta(caminho, projetoId, fotoId, { plantaId, x, y, angulo }, licencaUsuario) {
  const estado = lerEstado(caminho);
  const galeria = exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  const foto = galeria.fotos.find((f) => f.id === fotoId);
  if (!foto) throw new Error('Foto não encontrada.');
  if (!plantaId) {
    foto.plantaId = null;
    foto.pinPlanta = null;
  } else {
    if (!galeria.plantas.some((p) => p.id === plantaId)) throw new Error('Planta não encontrada.');
    const nx = Number(x), ny = Number(y);
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) throw new Error('Posição inválida.');
    const anterior = foto.pinPlanta && foto.pinPlanta.angulo !== undefined ? foto.pinPlanta.angulo : undefined;
    let novoAngulo = anterior;
    if (angulo === null) novoAngulo = undefined;                 // null = tira a direção
    else if (angulo !== undefined) novoAngulo = normalizarAngulo(angulo);
    if (foto.tipo === '360') novoAngulo = undefined;              // 360° não tem direção
    foto.plantaId = plantaId;
    foto.pinPlanta = { x: Math.min(1, Math.max(0, nx)), y: Math.min(1, Math.max(0, ny)) };
    if (novoAngulo !== undefined) foto.pinPlanta.angulo = novoAngulo;
  }
  galeria.atualizadoEm = new Date().toISOString();
  salvarEstado(caminho, estado);
  return foto;
}

// Só a DIREÇÃO do ícone que já está na planta (null = tira o leque).
function direcionarFotoNaPlanta(caminho, projetoId, fotoId, { angulo }, licencaUsuario) {
  const estado = lerEstado(caminho);
  const galeria = exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  const foto = galeria.fotos.find((f) => f.id === fotoId);
  if (!foto) throw new Error('Foto não encontrada.');
  if (!foto.plantaId || !foto.pinPlanta) throw new Error('A imagem ainda não está na planta.');
  if (foto.tipo === '360') throw new Error('Imagem 360° não tem direção da câmera.');
  if (angulo === null || angulo === undefined) delete foto.pinPlanta.angulo;
  else foto.pinPlanta.angulo = normalizarAngulo(angulo);
  galeria.atualizadoEm = new Date().toISOString();
  salvarEstado(caminho, estado);
  return foto;
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
function marcarComentariosLidos(caminho, projetoId, licencaUsuario) {
  const estado = lerEstado(caminho);
  const galeria = exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  galeria.temComentarioNaoLido = false;
  galeria.fotos.forEach((f) => f.comentarios.forEach((c) => { c.lido = true; }));
  salvarEstado(caminho, estado);
  return true;
}

module.exports = {
  LIMITE_FOTOS_POR_PROJETO, LIMITE_PLANTAS_POR_PROJETO,
  caminhoPadrao, lerEstado, salvarEstado,
  buscarGaleriaPorProjeto, buscarGaleriaPorLinkToken, exigirGaleriaDaLicenca,
  criarOuAtualizarGaleria, contarFotosDoUsuario,
  adicionarFoto, editarFoto, excluirFoto, reordenarFotos,
  criarCategoria, editarCategoria, excluirCategoria,
  atualizarMarcaDagua, atualizarIconePersonalizado, atualizarExibirIcone, removerPersonalizacaoPropria,
  lerPerfil, definirArquivoPerfil, removerArquivoPerfil, resolverPersonalizacao, perfilDaLicenca,
  adicionarPlanta, editarPlanta, atualizarImagemPlanta, excluirPlanta, posicionarFotoNaPlanta, direcionarFotoNaPlanta,
  loginCliente, validarTokenCliente,
  comentarFoto, aprovarFoto, marcarComentariosLidos
};
