// lib/galeria.js
// Camada de dados pura (sem servidor/rede), testável com Node puro --
// mesmo padrão do lib/dados-licenca.js do servidor de licenças.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const senhaReversivel = require('./senha-reversivel');
const orcCategorias = require('./orcamentos-categorias');

const LIMITE_FOTOS_POR_PROJETO = null; // null = sem limite por projeto (vale só o limite da licença, somando todos os projetos)
const LIMITE_PLANTAS_POR_PROJETO = 10; // uma por pavimento -- 10 já é de sobra

function caminhoPadrao(baseDir) {
  const diretorio = process.env.DADOS_DIR || baseDir || __dirname;
  return path.join(diretorio, 'dados-galerias.json');
}

// Lê o arquivo de dados. Arquivo que ainda não existe (primeira execução) = estado vazio. Arquivo ILEGÍVEL nunca vira "vazio" (o
// próximo salvamento apagaria tudo): tenta a cópia anterior (.bak) e, se nem ela servir, PARA com um erro claro.
function lerJsonDoDisco(caminho) {
  if (!fs.existsSync(caminho)) return null;
  try { return JSON.parse(fs.readFileSync(caminho, 'utf8')); } catch (e) {
    console.error('ARQUIVO DE DADOS ILEGÍVEL:', caminho, e.message);
    const bak = caminho + '.bak';
    if (fs.existsSync(bak)) {
      try { const j = JSON.parse(fs.readFileSync(bak, 'utf8')); console.error('Usando a cópia anterior (.bak).'); return j; } catch (e2) { /* nem a cópia serve */ }
    }
    throw new Error('O arquivo de dados está ilegível e não há cópia boa. Nada foi gravado, para não perder dados: restaure um backup (restaurar-backup.js).');
  }
}

function lerEstado(caminho) {
  const bruto = lerJsonDoDisco(caminho);
  if (!bruto) return { galerias: [], perfis: {} };
  {
    const estado = bruto;
    if (!Array.isArray(estado.galerias)) estado.galerias = [];
    // Ícone e logo da CONTA do arquiteto (configurados uma vez, valem pra todos os projetos): { [licencaUsuario]: {...} }
    if (!estado.perfis || typeof estado.perfis !== 'object' || Array.isArray(estado.perfis)) estado.perfis = {};
    // Migração silenciosa: galerias criadas antes das categorias/marca
    // d'água/ícone existirem não têm esses campos -- garante que sempre
    // existem, pra não quebrar nada que espere isso aqui.
    estado.galerias.forEach((g) => {
      if (!Array.isArray(g.categorias)) g.categorias = [];
      g.pdfCliente = pdfClienteValido(g.pdfCliente);
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
      g.plantas.forEach((p) => { if (!Array.isArray(p.textos)) p.textos = []; }); // textos escritos em cima da planta (nov/2026): só ADICIONA o campo
      (g.fotos || []).forEach((f) => { if (!Array.isArray(f.anotacoes)) f.anotacoes = []; }); // anotações do arquiteto nas fotos (nov/2026): só ADICIONA o campo
      // Hub do cliente (nov/2026): dados do projeto, links externos e documentos (links do Drive). Também só
      // ADICIONA o campo -- galeria antiga continua igual e sem conteúdo de hub (o cliente abre direto a galeria).
      if (!g.hub || typeof g.hub !== 'object' || Array.isArray(g.hub)) g.hub = {};
      if (typeof g.hub.dadosProjeto !== 'string') g.hub.dadosProjeto = '';
      if (!g.hub.links || typeof g.hub.links !== 'object' || Array.isArray(g.hub.links)) g.hub.links = {};
      if (!Array.isArray(g.hub.gruposExecutivo)) g.hub.gruposExecutivo = null; // null = grupos padrão
      if (!Array.isArray(g.hub.documentos)) g.hub.documentos = [];
      if (!Array.isArray(g.reunioes)) g.reunioes = []; // atas das reuniões de apresentação (só do escritório; ver lib/reunioes.js)
      if (typeof g.hub.capaFotoId !== 'string') g.hub.capaFotoId = null; // capa do hub = uma foto do próprio projeto (null = capa padrão)
      // Recursos NOVOS que o dono da galeria tem na licença (cópia atualizada toda vez que o arquiteto usa o app nesse projeto).
      // Galeria antiga = tudo desligado = o cliente vê EXATAMENTE o que sempre viu (sem hub, sem tema claro, sem orçamentos).
      if (!g.recursosAtivos || typeof g.recursosAtivos !== 'object') g.recursosAtivos = {};
      ['paginaProjeto', 'orcamentos', 'memorial'].forEach((r) => { g.recursosAtivos[r] = g.recursosAtivos[r] === true; });
      // Pasta de Orçamentos (nov/2026): link, login e senha PRÓPRIOS (separados da Pasta do Cliente), itens com valores
      // e a lista de novidades (o cliente mudou um status / comentou). Só ADICIONA o campo; nada que existia muda.
      if (!g.orcamentos || typeof g.orcamentos !== 'object' || Array.isArray(g.orcamentos)) g.orcamentos = {};
      if (!g.orcamentos.acesso || typeof g.orcamentos.acesso !== 'object') g.orcamentos.acesso = null; // { linkToken, usuario, senhaHash, sessoesAtivas }
      if (g.orcamentos.acesso && !Array.isArray(g.orcamentos.acesso.sessoesAtivas)) g.orcamentos.acesso.sessoesAtivas = [];
      if (!Array.isArray(g.orcamentos.itens)) g.orcamentos.itens = [];
      if (!Array.isArray(g.orcamentos.notificacoes)) g.orcamentos.notificacoes = [];
      if (typeof g.orcamentos.temNovidadeNaoLida !== 'boolean') g.orcamentos.temNovidadeNaoLida = false;
      // Categorias da Pasta de Orçamentos (nov/2026): cada item antigo vira uma categoria com o orçamento dentro (ver lib/orcamentos-categorias.js).
      if (!Array.isArray(g.orcamentos.categorias)) g.orcamentos.categorias = null;
      orcCategorias.migrar(g.orcamentos);
      // Memorial de itens (nov/2026): tabela de itens por setor com foto do produto (lib/memorial.js). Só ADICIONA o campo.
      if (!g.memorial || typeof g.memorial !== 'object' || Array.isArray(g.memorial)) g.memorial = {};
      if (!Array.isArray(g.memorial.itens)) g.memorial.itens = [];
      if (!Array.isArray(g.memorial.setores)) g.memorial.setores = null; // null = os 12 setores padrão; o arquiteto pode criar, renomear e excluir
      if (!g.memorial.modos || typeof g.memorial.modos !== 'object' || Array.isArray(g.memorial.modos)) g.memorial.modos = {}; // modo por setor ('cards'); sem entrada = lista
      if (!g.memorial.plantas || typeof g.memorial.plantas !== 'object' || Array.isArray(g.memorial.plantas)) g.memorial.plantas = {}; // plantas por setor: { setor: [{ id, nome, r2Key, marcas }] }
    });
    return estado;
  }
}

// Grava SEM risco de deixar o arquivo pela metade: escreve num temporário, guarda a versão anterior boa como ".bak" e só então troca
// (renomear é uma operação única). A cópia .bak só é feita se o arquivo atual está legível (nunca troca uma cópia boa por uma estragada).
function salvarEstado(caminho, estado) {
  const pasta = path.dirname(caminho);
  if (!fs.existsSync(pasta)) fs.mkdirSync(pasta, { recursive: true });
  const temporario = `${caminho}.tmp-${process.pid}`;
  const fd = fs.openSync(temporario, 'w');
  try { fs.writeSync(fd, JSON.stringify(estado, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  if (fs.existsSync(caminho)) {
    try { JSON.parse(fs.readFileSync(caminho, 'utf8')); fs.copyFileSync(caminho, caminho + '.bak'); } catch (e) { /* atual ilegível: mantém o .bak que já existe */ }
  }
  fs.renameSync(temporario, caminho);
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

// Cópia cifrada da senha do cliente (ver senha-reversivel.js). Se não houver como gravar a chave, a galeria funciona igual: só não mostra a senha.
function cifrarSenhaDoCliente(senha, caminho) {
  try { return senhaReversivel.cifrar(senha, caminho); } catch (e) { console.error('Aviso: não consegui guardar a cópia cifrada da senha do cliente: ' + e.message); return null; }
}
// A senha que o arquiteto definiu pro cliente, SÓ pro dono da licença (posse conferida). null = não disponível (galeria antiga que o cliente
// ainda não abriu, ou chave perdida): a tela pede pra definir uma senha nova.
function senhaDoClientePeloDono(caminho, projetoId, licencaUsuario) {
  const estado = lerEstado(caminho);
  const g = exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  return g.clienteSenhaCifrada ? senhaReversivel.decifrar(g.clienteSenhaCifrada, caminho) : null;
}

// Cria a galeria a primeira vez que o arquiteto abre "PASTA DO CLIENTE"
// pra esse projeto, ou atualiza a configuração (nome, login do cliente)
// se já existir. Trocar a senha do cliente derruba as sessões "lembradas"
// dele (precisa logar de novo com a senha nova).
// LOGIN OPCIONAL: `g.exigirLogin === false` = quem tem o link entra direto. Sem o campo (toda galeria antiga) o login continua valendo.
function criarOuAtualizarGaleria(caminho, { projetoId, licencaUsuario, nomeProjeto, clienteUsuario, clienteSenha, exigirLogin }) {
  if (!projetoId) throw new Error('projetoId é obrigatório.');
  if (!licencaUsuario) throw new Error('licencaUsuario é obrigatório.');
  const estado = lerEstado(caminho);
  let galeria = estado.galerias.find((g) => g.projetoId === projetoId);

  if (exigirLogin !== undefined && typeof exigirLogin !== 'boolean') throw new Error('Opção de login inválida.');

  if (!galeria) {
    const semLogin = exigirLogin === false;
    const temCredenciais = !!(clienteUsuario && String(clienteUsuario).trim() && clienteSenha); // sem login: só guarda se vierem os dois
    if (!semLogin && !temCredenciais) {
      throw new Error('Pra criar a Pasta do Cliente pela primeira vez, informe o usuário e a senha do cliente.');
    }
    if (temCredenciais && clienteSenha.length < 4) throw new Error('Senha do cliente precisa ter pelo menos 4 caracteres.');
    galeria = {
      projetoId,
      licencaUsuario,
      linkToken: gerarLinkToken(),
      exigirLogin: !semLogin,
      clienteUsuario: temCredenciais ? clienteUsuario.trim() : '',
      clienteSenhaHash: temCredenciais ? bcrypt.hashSync(clienteSenha, 10) : null,
      clienteSenhaCifrada: temCredenciais ? cifrarSenhaDoCliente(clienteSenha, caminho) : null, // cópia cifrada só pra o DONO ver a senha na tela
      nomeProjeto: (nomeProjeto && nomeProjeto.trim()) || 'Projeto',
      criadoEm: new Date().toISOString(),
      atualizadoEm: new Date().toISOString(),
      temComentarioNaoLido: false,
      sessoesClienteAtivas: [],
      categorias: [],
      marcaDagua: { ativa: true, r2Key: null, transparencia: 100, escala: 100, migradoParaPerfil: true }, // ligada por padrão (aparece se houver logo próprio ou da conta)
      pdfCliente: { nomes: true, paleta: true, marca: 'auto' }, // o que o PDF que o CLIENTE baixa mostra: quem decide é o arquiteto (o cliente só escolhe os ambientes)
      iconePersonalizado: { r2Key: null, exibir: true },
      plantas: [],
      hub: { dadosProjeto: '', links: {}, gruposExecutivo: null, documentos: [], capaFotoId: null },
      orcamentos: { acesso: null, itens: [], notificacoes: [], temNovidadeNaoLida: false },
      memorial: { itens: [], setores: null, modos: {}, plantas: {} },
      recursosAtivos: { paginaProjeto: false, orcamentos: false, memorial: false },
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
      galeria.clienteSenhaCifrada = cifrarSenhaDoCliente(clienteSenha, caminho);
      galeria.sessoesClienteAtivas = []; // força login de novo com a senha nova
    }
    if (exigirLogin !== undefined) {
      // ligar o login sem ter usuário e senha trancaria o cliente do lado de fora
      if (exigirLogin && !(galeria.clienteUsuario && galeria.clienteSenhaHash)) throw new Error('Pra ligar o login, informe o usuário e a senha do cliente.');
      galeria.exigirLogin = exigirLogin;
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
  // Sem teto por projeto (antes 50): o controle é o limite de fotos DA LICENÇA, somando todos os projetos (painel de admin > "Mudar limite de fotos"),
  // conferido no server.js antes de aceitar o arquivo.
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
// PDF das imagens que o CLIENTE baixa: o arquiteto define se mostra o nome de cada imagem, a paleta de cores e qual marca (logo/ícone) vai no canto.
// marca: 'auto' (logo, senão ícone, senão nada) | 'logo' | 'icone' | 'nenhuma'. O cliente final só escolhe os ambientes.
const MARCAS_PDF_CLIENTE = ['auto', 'logo', 'icone', 'nenhuma'];
function pdfClienteValido(p) {
  const x = (p && typeof p === 'object') ? p : {};
  return { nomes: x.nomes !== false, paleta: x.paleta !== false, marca: MARCAS_PDF_CLIENTE.includes(x.marca) ? x.marca : 'auto' };
}
function atualizarPdfCliente(caminho, projetoId, entrada, licencaUsuario) {
  const e = entrada || {};
  ['nomes', 'paleta'].forEach((k) => { if (e[k] !== undefined && typeof e[k] !== 'boolean') throw new Error('Opção do PDF inválida: ' + k + ' precisa ser verdadeiro ou falso.'); });
  if (e.marca !== undefined && !MARCAS_PDF_CLIENTE.includes(e.marca)) throw new Error('Marca do PDF inválida (use: ' + MARCAS_PDF_CLIENTE.join(', ') + ').');
  const estado = lerEstado(caminho);
  const galeriaObj = exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  const novos = {};
  ['nomes', 'paleta', 'marca'].forEach((k) => { if (e[k] !== undefined) novos[k] = e[k]; }); // só o que veio (undefined não apaga o que já estava)
  galeriaObj.pdfCliente = pdfClienteValido({ ...pdfClienteValido(galeriaObj.pdfCliente), ...novos });
  salvarEstado(caminho, estado);
  return galeriaObj.pdfCliente;
}

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

// Nome do escritório (nov/2026): configurado UMA vez no app (Configurações) e usado no "Projeto por: ..." do PDF das imagens,
// inclusive no PDF que o CLIENTE baixa pela Pasta do Cliente. Fica no perfil da conta (campo à parte: não mexe no ícone/logo).
function nomeEscritorioDaLicenca(estado, licencaUsuario) {
  const p = estado.perfis && licencaUsuario ? estado.perfis[licencaUsuario] : null;
  return (p && typeof p.nomeEscritorio === 'string') ? p.nomeEscritorio : '';
}
// Contatos do escritório (nov/2026): WhatsApp, e-mail e Instagram, configurados UMA vez no app (Configurações). Aparecem no rodapé da
// tela inicial da Pasta do Cliente e no balão de ajuda (atalho do WhatsApp). Tudo opcional; guardado já NORMALIZADO:
//   whatsapp = só dígitos com o país (55...), email em minúsculas, instagram = o @ sem o "@".
function normalizarWhatsapp(valor) {
  const digitos = String(valor || '').replace(/\D+/g, '');
  if (!digitos) {
    if (String(valor || '').trim()) throw new Error('WhatsApp inválido: use o DDD e o número (ex.: 11 91234-5678).'); // texto sem número não "apaga" em silêncio
    return '';
  }
  const comPais = (digitos.length === 10 || digitos.length === 11) ? '55' + digitos : digitos; // número brasileiro sem o 55
  if (comPais.length < 10 || comPais.length > 15) throw new Error('WhatsApp inválido: use o DDD e o número (ex.: 11 91234-5678).');
  return comPais;
}
function normalizarEmail(valor) {
  const t = String(valor || '').trim().toLowerCase();
  if (!t) return '';
  if (t.length > 120 || !/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(t)) throw new Error('E-mail inválido.');
  return t;
}
function normalizarInstagram(valor) {
  let t = String(valor || '').trim();
  if (!t) return '';
  t = t.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/^@/, '');
  if (!/^[A-Za-z0-9._]{1,30}$/.test(t)) throw new Error('Instagram inválido: escreva só o @ do perfil (ex.: @seuescritorio).');
  return t;
}
function contatosDoPerfil(p) {
  const c = (p && p.contatos && typeof p.contatos === 'object') ? p.contatos : {};
  return { whatsapp: typeof c.whatsapp === 'string' ? c.whatsapp : '', email: typeof c.email === 'string' ? c.email : '', instagram: typeof c.instagram === 'string' ? c.instagram : '' };
}
function contatosEscritorioDaLicenca(estado, licencaUsuario) {
  return contatosDoPerfil(estado.perfis && licencaUsuario ? estado.perfis[licencaUsuario] : null);
}

// Define nome e/ou contatos do escritório. Só mexe no que vier na chamada (`undefined` = deixa como está): o app antigo manda só
// o nome e não apaga os contatos. Valida TUDO antes de gravar. -> { nomeEscritorio, contatos }
function definirDadosEscritorio(caminho, licencaUsuario, entrada) {
  if (!licencaUsuario) throw new Error('licencaUsuario é obrigatório.');
  const e = entrada || {};
  if (e.nome !== undefined && e.nome !== null && typeof e.nome !== 'string') throw new Error('Nome do escritório inválido.');
  ['whatsapp', 'email', 'instagram'].forEach((k) => { if (e[k] !== undefined && e[k] !== null && typeof e[k] !== 'string') throw new Error('Contato do escritório inválido.'); });
  let nome;
  if (e.nome !== undefined) {
    nome = String(e.nome || '').replace(/\s+/g, ' ').trim();
    if (nome.length > 80) throw new Error('O nome do escritório passa de 80 caracteres.');
  }
  const novos = {};
  if (e.whatsapp !== undefined) novos.whatsapp = normalizarWhatsapp(e.whatsapp);
  if (e.email !== undefined) novos.email = normalizarEmail(e.email);
  if (e.instagram !== undefined) novos.instagram = normalizarInstagram(e.instagram);
  const estado = lerEstado(caminho);
  const atual = estado.perfis[licencaUsuario] || perfilVazio();
  const antes = JSON.stringify([typeof atual.nomeEscritorio === 'string' ? atual.nomeEscritorio : '', contatosDoPerfil(atual)]);
  if (nome !== undefined) atual.nomeEscritorio = nome;
  atual.contatos = Object.assign(contatosDoPerfil(atual), novos);
  const depois = JSON.stringify([typeof atual.nomeEscritorio === 'string' ? atual.nomeEscritorio : '', atual.contatos]);
  // "O mais recente vale": só quando algo MUDOU de verdade o servidor carimba a hora (reenviar o mesmo valor não conta). Os computadores da
  // conta comparam essa hora para saber quem tem o dado mais novo.
  if (antes !== depois) atual.dadosEscritorioEm = new Date().toISOString();
  estado.perfis[licencaUsuario] = atual;
  salvarEstado(caminho, estado);
  return { nomeEscritorio: typeof atual.nomeEscritorio === 'string' ? atual.nomeEscritorio : '', contatos: atual.contatos, atualizadoEm: atual.dadosEscritorioEm || null };
}
// Quando nome/contatos da conta mudaram pela última vez (ISO) -- '' se nunca houve mudança carimbada (dados de antes desta regra).
function dadosEscritorioAtualizadoEm(estado, licencaUsuario) {
  const p = estado.perfis && licencaUsuario ? estado.perfis[licencaUsuario] : null;
  return (p && typeof p.dadosEscritorioEm === 'string') ? p.dadosEscritorioEm : '';
}
function definirNomeEscritorio(caminho, licencaUsuario, nome) { // nome do escritório sozinho (mantido: app 1.35.0)
  return definirDadosEscritorio(caminho, licencaUsuario, { nome: nome === undefined || nome === null ? '' : nome }).nomeEscritorio;
}

// Cor de destaque do site do cliente (nov/2026): UMA cor (#rrggbb) escolhida no app (Configurações > Pasta do Cliente), vale pra todos os
// projetos da conta. O site calcula as variações (tema claro/escuro, contraste) a partir dela. `modelo` é só o nome do modelo pronto
// escolhido (pro app marcar o quadradinho certo). Sem cor = o visual cinza-aço de sempre.
function normalizarCorDestaque(valor) {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'string') throw new Error('Cor inválida: use o formato #rrggbb.');
  const t = valor.trim().toLowerCase();
  if (!t) return null;
  if (!/^#[0-9a-f]{6}$/.test(t)) throw new Error('Cor inválida: use o formato #rrggbb (ex.: #4a86d8).');
  return t;
}
function coresDoPerfil(p) {
  const c = (p && p.cores && typeof p.cores === 'object') ? p.cores : {};
  const destaque = (typeof c.destaque === 'string' && /^#[0-9a-f]{6}$/.test(c.destaque)) ? c.destaque : null;
  return { destaque, modelo: destaque && typeof c.modelo === 'string' && /^[a-z0-9-]{1,30}$/.test(c.modelo) ? c.modelo : '' };
}
function coresEscritorioDaLicenca(estado, licencaUsuario) {
  return coresDoPerfil(estado.perfis && licencaUsuario ? estado.perfis[licencaUsuario] : null);
}
// entrada: { destaque: '#rrggbb' | null | '', modelo?: 'id' }. Cor vazia/nula volta ao padrão. Valida ANTES de gravar. -> { destaque, modelo }
function definirCoresEscritorio(caminho, licencaUsuario, entrada) {
  if (!licencaUsuario) throw new Error('licencaUsuario é obrigatório.');
  const e = entrada || {};
  const destaque = normalizarCorDestaque(e.destaque);
  if (e.modelo !== undefined && e.modelo !== null && (typeof e.modelo !== 'string' || (e.modelo && !/^[a-z0-9-]{1,30}$/.test(e.modelo)))) throw new Error('Modelo de cor inválido.');
  const estado = lerEstado(caminho);
  const atual = estado.perfis[licencaUsuario] || perfilVazio();
  if (destaque) atual.cores = { destaque, modelo: e.modelo || '' };
  else delete atual.cores;
  estado.perfis[licencaUsuario] = atual;
  salvarEstado(caminho, estado);
  return coresDoPerfil(atual);
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

// TEXTOS em cima da planta (nome dos ambientes, observações): o app manda a lista COMPLETA e ela substitui a anterior (uma gravação só,
// sem estado intermediário). Tudo em fração da planta; veja public/assets/js/planta-textos.js. Valida cada texto ANTES de gravar qualquer coisa.
const LIMITE_TEXTOS_POR_PLANTA = 80;
const LIMITE_CARACTERES_TEXTO = 200;
function corOpcional(v, nomeCampo) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v.trim())) throw new Error(`${nomeCampo} inválida (use o formato #RRGGBB).`);
  return v.trim().toLowerCase();
}
function validarTextoDaPlanta(t, indice) {
  if (!t || typeof t !== 'object') throw new Error(`Texto ${indice + 1}: formato inválido.`);
  const texto = String(t.texto == null ? '' : t.texto).replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').trim();
  if (!texto) throw new Error(`Texto ${indice + 1}: está vazio.`);
  if (texto.length > LIMITE_CARACTERES_TEXTO) throw new Error(`Texto ${indice + 1}: passa de ${LIMITE_CARACTERES_TEXTO} caracteres.`);
  const num = (v, nomeCampo) => { const n = Number(v); if (v === '' || v === null || v === undefined || !Number.isFinite(n)) throw new Error(`Texto ${indice + 1}: ${nomeCampo} inválido.`); return n; };
  const limitar = (v, mn, mx) => Math.min(mx, Math.max(mn, v));
  const id = (typeof t.id === 'string' && /^[\w-]{1,60}$/.test(t.id)) ? t.id : 'txt_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e6).toString(36);
  const fundo = corOpcional(t.fundo, 'Cor do fundo');
  return {
    id,
    texto,
    x: Math.round(limitar(num(t.x, 'posição x'), 0, 1) * 10000) / 10000,
    y: Math.round(limitar(num(t.y, 'posição y'), 0, 1) * 10000) / 10000,
    tamanho: Math.round(limitar(num(t.tamanho, 'tamanho'), 0.006, 0.1) * 10000) / 10000,
    cor: corOpcional(t.cor, 'Cor da letra') || '#1b1b1b',
    fundo,
    fundoOpacidade: fundo ? Math.round(limitar(t.fundoOpacidade === undefined ? 0.85 : num(t.fundoOpacidade, 'opacidade do fundo'), 0, 1) * 100) / 100 : 0.85,
    contorno: corOpcional(t.contorno, 'Cor do contorno'),
    negrito: t.negrito !== false
  };
}
function definirTextosDaPlanta(caminho, projetoId, plantaId, textos, licencaUsuario) {
  if (!Array.isArray(textos)) throw new Error('A lista de textos é inválida.');
  if (textos.length > LIMITE_TEXTOS_POR_PLANTA) throw new Error(`Cada planta aceita até ${LIMITE_TEXTOS_POR_PLANTA} textos.`);
  const validados = textos.map(validarTextoDaPlanta); // valida tudo antes de mexer em qualquer coisa
  const ids = new Set(validados.map((v) => v.id));
  if (ids.size !== validados.length) throw new Error('Há textos repetidos na lista.');
  const estado = lerEstado(caminho);
  const galeria = exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  const planta = galeria.plantas.find((p) => p.id === plantaId);
  if (!planta) throw new Error('Planta não encontrada.');
  planta.textos = validados;
  galeria.atualizadoEm = new Date().toISOString();
  salvarEstado(caminho, estado);
  return planta;
}

// --------------------------------------------------------------------
// ANOTAÇÕES nas fotos (nov/2026): o arquiteto marca PONTOS na imagem (ícone arrastável, ex.: ⚠ amarelo); cada ponto abre um balão com texto
// e/ou uma imagem pro cliente entender que ali há uma observação. Vários por foto. Aparecem na galeria, no PDF (numeradas, com a lista ao
// lado) e -- na função seguinte -- no 360° (yaw/pitch em vez de x/y).
//   anotacao: { id, x, y, icone, texto, imagemR2Key|null }   (x e y: FRAÇÃO da imagem, 0..1)
// A lista COMPLETA substitui a anterior. A imagem do balão é enviada ANTES (rota própria) e aqui só referenciada: a chave precisa estar na
// pasta daquela foto -- assim ninguém aponta pra arquivo de outra conta/projeto.
// --------------------------------------------------------------------
const ICONES_ANOTACAO = ['alerta', 'info', 'duvida', 'ok', 'ideia'];
const LIMITE_ANOTACOES_POR_FOTO = 30;
const LIMITE_TEXTO_ANOTACAO = 600;
const prefixoImagensAnotacao = (projetoId, fotoId) => `${projetoId}/anotacoes/${fotoId}/`;
function validarAnotacao(a, indice, projetoId, fotoId, ehPanorama) {
  if (!a || typeof a !== 'object') throw new Error(`Anotação ${indice + 1}: formato inválido.`);
  const texto = String(a.texto == null ? '' : a.texto).replace(/\r/g, '').trim();
  if (texto.length > LIMITE_TEXTO_ANOTACAO) throw new Error(`Anotação ${indice + 1}: o texto passa de ${LIMITE_TEXTO_ANOTACAO} caracteres.`);
  let imagemR2Key = null;
  if (a.imagemR2Key !== null && a.imagemR2Key !== undefined && a.imagemR2Key !== '') {
    const chave = String(a.imagemR2Key);
    if (!chave.startsWith(prefixoImagensAnotacao(projetoId, fotoId)) || !/^[\w./-]+$/.test(chave) || chave.includes('..')) throw new Error(`Anotação ${indice + 1}: imagem inválida.`);
    imagemR2Key = chave;
  }
  if (!texto && !imagemR2Key) throw new Error(`Anotação ${indice + 1}: escreva um texto ou escolha uma imagem.`);
  const icone = ICONES_ANOTACAO.includes(a.icone) ? a.icone : 'alerta';
  const num = (v, nomeCampo) => { const n = Number(v); if (v === '' || v === null || v === undefined || !Number.isFinite(n)) throw new Error(`Anotação ${indice + 1}: ${nomeCampo} inválido.`); return n; };
  const limitar = (v, mn, mx) => Math.min(mx, Math.max(mn, v));
  const arred = (v) => Math.round(v * 10000) / 10000;
  const id = (typeof a.id === 'string' && /^[\w-]{1,60}$/.test(a.id)) ? a.id : 'an_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e6).toString(36);
  const base = { id, icone, texto, imagemR2Key };
  // foto comum: posição em fração da imagem; 360°: direção (yaw -180..180 e pitch -90..90, em graus)
  if (ehPanorama) return Object.assign(base, { yaw: arred(limitar(num(a.yaw, 'direção horizontal'), -180, 180)), pitch: arred(limitar(num(a.pitch, 'direção vertical'), -90, 90)) });
  return Object.assign(base, { x: arred(limitar(num(a.x, 'posição x'), 0, 1)), y: arred(limitar(num(a.y, 'posição y'), 0, 1)) });
}
function chavesDeAnotacoes(foto) {
  return ((foto && foto.anotacoes) || []).map((a) => a.imagemR2Key).filter(Boolean);
}
// -> { foto, chavesRemovidas }: as imagens que saíram da lista (quem chamou apaga os arquivos)
function definirAnotacoesDaFoto(caminho, projetoId, fotoId, anotacoes, licencaUsuario) {
  if (!Array.isArray(anotacoes)) throw new Error('A lista de anotações é inválida.');
  if (anotacoes.length > LIMITE_ANOTACOES_POR_FOTO) throw new Error(`Cada foto aceita até ${LIMITE_ANOTACOES_POR_FOTO} anotações.`);
  const estado = lerEstado(caminho);
  const g = exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  const foto = g.fotos.find((f) => f.id === fotoId);
  if (!foto) throw new Error('Foto não encontrada.');
  const validadas = anotacoes.map((a, i) => validarAnotacao(a, i, projetoId, fotoId, foto.tipo === '360')); // tudo antes de gravar
  if (new Set(validadas.map((v) => v.id)).size !== validadas.length) throw new Error('Há anotações repetidas na lista.');
  const antes = new Set(chavesDeAnotacoes(foto));
  foto.anotacoes = validadas;
  const depois = new Set(chavesDeAnotacoes(foto));
  g.atualizadoEm = new Date().toISOString();
  salvarEstado(caminho, estado);
  return { foto, chavesRemovidas: [...antes].filter((k) => !depois.has(k)) };
}
function exigirFotoDaLicenca(caminho, projetoId, fotoId, licencaUsuario) {
  const g = exigirGaleriaDaLicenca(lerEstado(caminho), projetoId, licencaUsuario);
  const foto = g.fotos.find((f) => f.id === fotoId);
  if (!foto) throw new Error('Foto não encontrada.');
  return foto;
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
  if (!galeria.clienteSenhaHash || galeria.clienteUsuario !== (usuario || '').trim() || !bcrypt.compareSync(senha || '', galeria.clienteSenhaHash)) {
    throw new Error('Usuário ou senha incorretos.');
  }
  // Galeria criada antes da cópia cifrada: a senha digitada agora está certa (o hash conferiu), então guarda a cópia pra o dono poder ver.
  if (!galeria.clienteSenhaCifrada) galeria.clienteSenhaCifrada = cifrarSenhaDoCliente(senha, caminho);
  const token = gerarToken();
  galeria.sessoesClienteAtivas.push({ token, criadaEm: new Date().toISOString() });
  salvarEstado(caminho, estado);
  return token;
}

// Sessão de escritório (aberta pelo dashboard, só leitura) vale 12 h; a do cliente de verdade não expira (como sempre foi).
const VALIDADE_SESSAO_ESCRITORIO_MS = 12 * 60 * 60 * 1000;
function sessaoCliente(caminho, linkToken, token) {
  const galeria = buscarGaleriaPorLinkToken(caminho, linkToken);
  if (!galeria || !token) return null;
  const s = galeria.sessoesClienteAtivas.find((x) => x.token === token);
  if (!s) return null;
  if (s.escritorio && Date.now() - Date.parse(s.criadaEm) > VALIDADE_SESSAO_ESCRITORIO_MS) return null;
  return s;
}

function validarTokenCliente(caminho, linkToken, token) {
  return !!sessaoCliente(caminho, linkToken, token);
}

// Login desligado pelo arquiteto: entra quem tem o link. Um token do modo ESCRITÓRIO (mesmo vencido) nunca vira visitante comum,
// senão a tela só-leitura do dashboard passaria a poder aprovar no lugar do cliente. Religar vale na hora (nada fica guardado).
function entraSemLogin(caminho, linkToken, token) {
  const g = buscarGaleriaPorLinkToken(caminho, linkToken);
  if (!g || g.exigirLogin !== false) return false;
  return !(token && g.sessoesClienteAtivas.some((s) => s.token === token && s.escritorio));
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

// Guarda na galeria quais recursos novos a licença do DONO tem agora. Só grava se algo mudou. Só o dono atualiza.
// É daqui que o lado do cliente decide se mostra a página do projeto, o tema claro/escuro e os orçamentos.
function sincronizarRecursos(caminho, projetoId, licencaUsuario, recursos) {
  const estado = lerEstado(caminho);
  const g = estado.galerias.find((x) => x.projetoId === projetoId);
  if (!g || g.licencaUsuario !== licencaUsuario) return false;
  const novos = {};
  ['paginaProjeto', 'orcamentos', 'memorial'].forEach((r) => { novos[r] = !!(recursos && recursos[r] === true); });
  if (['paginaProjeto', 'orcamentos', 'memorial'].every((r) => g.recursosAtivos[r] === novos[r])) return false;
  g.recursosAtivos = novos;
  salvarEstado(caminho, estado);
  return true;
}

// Mesma cópia, mas pra TODAS as galerias de uma conta de uma vez (o servidor de licença confirmou os recursos da conta). Só grava se algo mudou.
// `ativa` = assinatura em dia (false = vencida: o acesso à galeria fica restrito, nada é apagado). Guardado como reserva (`contaAtiva`) pra o
// último estado conhecido valer mesmo se o servidor de licença estiver fora quando a Pasta do Cliente reiniciar.
function sincronizarRecursosDaConta(caminho, licencaUsuario, recursos, ativa) {
  if (!licencaUsuario) return 0;
  const estado = lerEstado(caminho);
  const novos = {};
  ['paginaProjeto', 'orcamentos', 'memorial'].forEach((r) => { novos[r] = !!(recursos && recursos[r] === true); });
  const contaAtiva = ativa !== false;
  let mudou = 0;
  estado.galerias.forEach((g) => {
    if (g.licencaUsuario !== licencaUsuario) return;
    const igual = ['paginaProjeto', 'orcamentos', 'memorial'].every((r) => g.recursosAtivos[r] === novos[r]) && (g.contaAtiva !== false) === contaAtiva;
    if (igual) return;
    g.recursosAtivos = { ...novos };
    g.contaAtiva = contaAtiva;
    mudou++;
  });
  if (mudou) salvarEstado(caminho, estado);
  return mudou;
}

// --------------------------------------------------------------------
// EXCLUIR A PASTA DO CLIENTE INTEIRA (LGPD: eliminação) -- só o dono (posse conferida). Em duas etapas, pra nunca deixar arquivo
// órfão no armazenamento: 1) `chavesDoProjeto` lista TODOS os arquivos do projeto; o servidor apaga cada um; 2) só se todos foram
// apagados, `removerGaleria` tira o projeto do cadastro (e junto vão links, sessões do cliente/orçamentos/escritório e etiquetas).
// --------------------------------------------------------------------
function chavesDoProjeto(caminho, projetoId, licencaUsuario) {
  const g = exigirGaleriaDaLicenca(lerEstado(caminho), projetoId, licencaUsuario);
  const chaves = new Set();
  const poe = (k) => { if (typeof k === 'string' && k) chaves.add(k); };
  (g.fotos || []).forEach((f) => { poe(f.r2Key); (f.comentarios || []).forEach((c) => poe(c.desenhoR2Key)); chavesDeAnotacoes(f).forEach(poe); }); // + imagens dos balões de anotação
  (g.plantas || []).forEach((p) => poe(p.r2Key));
  poe(g.marcaDagua && g.marcaDagua.r2Key);
  poe(g.iconePersonalizado && g.iconePersonalizado.r2Key);
  ((g.memorial && g.memorial.itens) || []).forEach((i) => { poe(i.fotoR2Key); (i.fotosExtras || []).forEach((f) => poe(f && f.r2Key)); });
  ((g.orcamentos && g.orcamentos.itens) || []).forEach((i) => { poe(i.fotoR2Key); (i.fotosExtras || []).forEach((f) => poe(f && f.r2Key)); }); // fotos dos orçamentos
  Object.values((g.memorial && g.memorial.plantas) || {}).forEach((lista) => (Array.isArray(lista) ? lista : []).forEach((p) => poe(p && p.r2Key))); // plantas do memorial
  (g.reunioes || []).forEach((r) => (r.prints || []).forEach((p) => poe(p.r2Key))); // prints das reuniões também saem na exclusão do projeto (LGPD)
  return { nomeProjeto: g.nomeProjeto, chaves: [...chaves] };
}

function removerGaleria(caminho, projetoId, licencaUsuario) {
  const estado = lerEstado(caminho);
  const g = exigirGaleriaDaLicenca(estado, projetoId, licencaUsuario);
  estado.galerias = estado.galerias.filter((x) => x !== g);
  salvarEstado(caminho, estado);
  return { projetoId, nomeProjeto: g.nomeProjeto };
}

// --------------------------------------------------------------------
// NOVIDADES PARA O CLIENTE (bolinhas nos cartões): o servidor lembra o que o CLIENTE já viu, por aba (vale pra qualquer aparelho dele e
// também aparece, só pra ler, no "modo escritório"). A "foto base" é criada no primeiro acesso do cliente (nada é novo nesse dia);
// depois, o que o escritório criar ou mudar numa aba passa a contar como novidade até o cliente abrir a aba.
// --------------------------------------------------------------------
const SECOES_DE_DOCUMENTO = ['planta_original', 'conceitual', 'executivo', 'visitas'];
const SECOES_DE_NOVIDADE = [...SECOES_DE_DOCUMENTO, 'criativo', 'memorial'];

// Primeiro acesso do cliente de verdade: grava a foto base. Chamado a cada acesso; só age na primeira vez.
function garantirBaseVistoCliente(caminho, linkToken) {
  const estado = lerEstado(caminho);
  const g = estado.galerias.find((x) => x.linkToken === linkToken);
  if (!g || (g.vistoCliente && g.vistoCliente.base)) return false;
  g.vistoCliente = { base: new Date().toISOString(), secoes: {} };
  salvarEstado(caminho, estado);
  return true;
}

// Antes de o ESCRITÓRIO mudar algo (item no memorial, documento, foto...) num projeto que já existe há mais de um dia e cujo cliente ainda
// não abriu a página, a "foto base" nasce agora: assim o que o escritório acabou de colocar conta como novidade quando o cliente entrar
// (e o escritório já enxerga a bolinha). Projeto novo (menos de 24 h) segue silencioso: o cliente não vê "tudo é novo" na 1ª visita.
const HORAS_PROJETO_RECEM_CRIADO = 24;
function garantirBaseAntesDeMudar(caminho, projetoId, licencaUsuario) {
  const estado = lerEstado(caminho);
  const g = estado.galerias.find((x) => x.projetoId === projetoId);
  if (!g || g.licencaUsuario !== licencaUsuario || (g.vistoCliente && g.vistoCliente.base)) return false;
  const criada = Date.parse(g.criadoEm || '');
  if (Number.isFinite(criada) && Date.now() - criada < HORAS_PROJETO_RECEM_CRIADO * 3600 * 1000) return false;
  g.vistoCliente = { base: new Date(Date.now() - 1000).toISOString(), secoes: {} }; // 1 s antes: a mudança que vem a seguir é sempre depois da base
  salvarEstado(caminho, estado);
  return true;
}

function marcarVistoCliente(caminho, linkToken, secao) {
  if (!SECOES_DE_NOVIDADE.includes(secao)) throw new Error('Aba inválida.');
  const estado = lerEstado(caminho);
  const g = estado.galerias.find((x) => x.linkToken === linkToken);
  if (!g) throw new Error('Link não encontrado.');
  if (!g.vistoCliente || !g.vistoCliente.base) g.vistoCliente = { base: new Date().toISOString(), secoes: {} };
  g.vistoCliente.secoes = Object.assign({}, g.vistoCliente.secoes, { [secao]: new Date().toISOString() });
  salvarEstado(caminho, estado);
  return true;
}

// -> { aba: [{ id, tag: 'NOVO' | 'ATUALIZADO' }] }  (só abas com algo; {} se o cliente ainda não teve a primeira visita)
function novidadesDoCliente(g) {
  const v = g && g.vistoCliente;
  if (!v || !v.base) return {};
  const quando = (x) => { const n = Date.parse(x || ''); return Number.isFinite(n) ? n : 0; };
  const marca = (criado, atualizado, ref) => (quando(criado) > ref ? 'NOVO' : (quando(atualizado) > ref ? 'ATUALIZADO' : ''));
  const saida = {};
  const poe = (aba, id, tag) => { if (tag) (saida[aba] = saida[aba] || []).push({ id, tag }); };
  const refDe = (aba) => quando((v.secoes && v.secoes[aba]) || v.base);
  SECOES_DE_DOCUMENTO.forEach((aba) => ((g.hub && g.hub.documentos) || []).filter((d) => d.secao === aba && d.status !== 'ANTIGA')
    .forEach((d) => poe(aba, d.id, marca(d.criadoEm, d.atualizadoEm, refDe(aba)))));
  (g.fotos || []).filter((f) => !f.arquivada).forEach((f) => poe('criativo', f.id, marca(f.criadoEm, null, refDe('criativo'))));
  (g.plantas || []).forEach((p) => poe('criativo', 'planta:' + p.id, marca(p.criadaEm, null, refDe('criativo'))));
  ((g.memorial && g.memorial.itens) || []).filter((i) => i.status !== 'ANTIGA').forEach((i) => poe('memorial', i.id, marca(i.criadoEm, i.atualizadoEm, refDe('memorial'))));
  return saida;
}

module.exports = {
  chavesDoProjeto, removerGaleria, garantirBaseVistoCliente, garantirBaseAntesDeMudar, marcarVistoCliente, novidadesDoCliente, SECOES_DE_NOVIDADE,
  sincronizarRecursos,
  LIMITE_FOTOS_POR_PROJETO, LIMITE_PLANTAS_POR_PROJETO,
  caminhoPadrao, lerEstado, salvarEstado,
  buscarGaleriaPorProjeto, buscarGaleriaPorLinkToken, exigirGaleriaDaLicenca,
  criarOuAtualizarGaleria, contarFotosDoUsuario, senhaDoClientePeloDono,
  adicionarFoto, editarFoto, excluirFoto, reordenarFotos,
  criarCategoria, editarCategoria, excluirCategoria,
  atualizarPdfCliente, pdfClienteValido, atualizarMarcaDagua, atualizarIconePersonalizado, atualizarExibirIcone, removerPersonalizacaoPropria,
  nomeEscritorioDaLicenca, definirNomeEscritorio, definirDadosEscritorio, contatosEscritorioDaLicenca, dadosEscritorioAtualizadoEm,
  normalizarWhatsapp, normalizarEmail, normalizarInstagram,
  coresEscritorioDaLicenca, definirCoresEscritorio, normalizarCorDestaque, sincronizarRecursosDaConta,
  lerPerfil, definirArquivoPerfil, removerArquivoPerfil, resolverPersonalizacao, perfilDaLicenca,
  definirAnotacoesDaFoto, exigirFotoDaLicenca, chavesDeAnotacoes, prefixoImagensAnotacao, ICONES_ANOTACAO, LIMITE_ANOTACOES_POR_FOTO,
  adicionarPlanta, editarPlanta, definirTextosDaPlanta, validarTextoDaPlanta, LIMITE_TEXTOS_POR_PLANTA, atualizarImagemPlanta, excluirPlanta, posicionarFotoNaPlanta, direcionarFotoNaPlanta,
  loginCliente, validarTokenCliente, entraSemLogin, sessaoCliente,
  comentarFoto, aprovarFoto, marcarComentariosLidos
};
