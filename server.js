// server.js -- Servidor da Pasta do Cliente
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const galeria = require('./lib/galeria');
const storage = require('./lib/storage');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } }); // 15MB de folga (a otimização no app já deixa isso bem menor)

const PORTA = process.env.PORT || 3000;
const CAMINHO_DADOS = galeria.caminhoPadrao(__dirname);
const LICENCA_SERVIDOR_URL = process.env.LICENCA_SERVIDOR_URL || null;

// --------------------------------------------------------------------
// Middleware: confere a sessão do ARQUITETO direto no servidor de
// licenças (nunca duplicamos essa lógica aqui) -- e já aproveita pra
// pegar o limiteFotos, que vem na mesma resposta.
// --------------------------------------------------------------------
async function exigirSessaoArquiteto(req, res, next) {
  try {
    const token = req.headers['x-sessao-token'];
    if (!token) return res.status(401).json({ erro: 'Sessão não informada.' });
    if (!LICENCA_SERVIDOR_URL) return res.status(503).json({ erro: 'LICENCA_SERVIDOR_URL não configurada neste servidor.' });

    const resposta = await fetch(`${LICENCA_SERVIDOR_URL}/api/verificar-sessao`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    const dados = await resposta.json();
    if (!dados.valida) return res.status(401).json({ erro: dados.motivo || 'Sessão inválida.' });

    req.licencaUsuario = dados.usuario;
    req.limiteFotos = dados.limiteFotos;
    next();
  } catch (e) {
    res.status(500).json({ erro: 'Erro conferindo sessão: ' + e.message });
  }
}

// Monta a resposta da galeria com URLs temporárias do R2 no lugar dos
// r2Keys crus -- tanto o app quanto o cliente final recebem isso pronto
// pra exibir, sem saber nada sobre como o armazenamento funciona por
// dentro.
async function galeriaComUrls(galeriaObj) {
  const fotos = await Promise.all(galeriaObj.fotos.map(async (f) => ({
    ...f,
    url: await storage.urlTemporaria(f.r2Key)
  })));
  const { clienteSenhaHash, sessoesClienteAtivas, ...resto } = galeriaObj;
  return { ...resto, fotos };
}

app.get('/saude', (req, res) => res.json({ ok: true, servico: 'renderia-pasta-cliente' }));

// ====================================================================
// ROTAS DO APP (o arquiteto -- precisa de sessão válida do RENDERIA)
// ====================================================================

app.post('/api/app/galeria', exigirSessaoArquiteto, (req, res) => {
  try {
    const { projetoId, nomeProjeto, clienteUsuario, clienteSenha } = req.body || {};
    const g = galeria.criarOuAtualizarGaleria(CAMINHO_DADOS, {
      projetoId, licencaUsuario: req.licencaUsuario, nomeProjeto, clienteUsuario, clienteSenha
    });
    res.json({ ok: true, linkToken: g.linkToken });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

app.get('/api/app/galeria/:projetoId', exigirSessaoArquiteto, async (req, res) => {
  try {
    const g = galeria.buscarGaleriaPorProjeto(CAMINHO_DADOS, req.params.projetoId);
    if (!g) return res.status(404).json({ erro: 'Essa Pasta do Cliente ainda não foi criada.' });
    if (g.licencaUsuario !== req.licencaUsuario) return res.status(403).json({ erro: 'Esse projeto não pertence a essa licença.' });
    res.json(await galeriaComUrls(g));
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// Leve, só pro selinho de "novo comentário" no botão -- não busca URLs.
app.get('/api/app/status/:projetoId', exigirSessaoArquiteto, (req, res) => {
  const g = galeria.buscarGaleriaPorProjeto(CAMINHO_DADOS, req.params.projetoId);
  res.json({ existe: !!g, temComentarioNaoLido: g ? g.temComentarioNaoLido : false });
});

app.post('/api/app/galeria/:projetoId/fotos', exigirSessaoArquiteto, upload.single('arquivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado.' });
    const g = galeria.buscarGaleriaPorProjeto(CAMINHO_DADOS, req.params.projetoId);
    if (!g) return res.status(404).json({ erro: 'Essa Pasta do Cliente ainda não foi criada.' });
    if (g.licencaUsuario !== req.licencaUsuario) return res.status(403).json({ erro: 'Esse projeto não pertence a essa licença.' });

    const usadas = galeria.contarFotosDoUsuario(CAMINHO_DADOS, req.licencaUsuario);
    if (usadas >= req.limiteFotos) {
      return res.status(403).json({ erro: `Você atingiu o limite de ${req.limiteFotos} fotos na Pasta do Cliente (somando todos os projetos). Exclua alguma foto antiga ou fale com a gente pra aumentar o limite.` });
    }

    const { nomeExibicao, tag, tipo, capturaIdOrigem } = req.body;
    const chave = `${req.params.projetoId}/${crypto.randomUUID()}.webp`;
    await storage.salvarArquivo(chave, req.file.buffer, 'image/webp');
    const foto = galeria.adicionarFoto(CAMINHO_DADOS, req.params.projetoId, { nomeExibicao, tag, tipo, r2Key: chave, capturaIdOrigem });
    res.json({ ok: true, foto });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

app.put('/api/app/galeria/:projetoId/fotos/:fotoId', exigirSessaoArquiteto, (req, res) => {
  try {
    const g = galeria.buscarGaleriaPorProjeto(CAMINHO_DADOS, req.params.projetoId);
    if (!g || g.licencaUsuario !== req.licencaUsuario) return res.status(404).json({ erro: 'Não encontrado.' });
    const { nomeExibicao, tag, ordem, arquivada } = req.body || {};
    const foto = galeria.editarFoto(CAMINHO_DADOS, req.params.projetoId, req.params.fotoId, { nomeExibicao, tag, ordem, arquivada });
    res.json({ ok: true, foto });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

app.delete('/api/app/galeria/:projetoId/fotos/:fotoId', exigirSessaoArquiteto, async (req, res) => {
  try {
    const g = galeria.buscarGaleriaPorProjeto(CAMINHO_DADOS, req.params.projetoId);
    if (!g || g.licencaUsuario !== req.licencaUsuario) return res.status(404).json({ erro: 'Não encontrado.' });
    const r2Key = galeria.excluirFoto(CAMINHO_DADOS, req.params.projetoId, req.params.fotoId);
    try { await storage.excluirArquivo(r2Key); } catch (e) { console.error('Aviso: falhou excluir do R2, mas já excluiu dos dados:', e.message); }
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

app.post('/api/app/galeria/:projetoId/marcar-lido', exigirSessaoArquiteto, (req, res) => {
  try {
    galeria.marcarComentariosLidos(CAMINHO_DADOS, req.params.projetoId);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

// ====================================================================
// ROTAS DO CLIENTE FINAL (público, via link -- nunca vê o servidor de
// licenças, só entra com o login que o arquiteto configurou)
// ====================================================================

app.post('/api/cliente/:linkToken/login', (req, res) => {
  try {
    const { usuario, senha } = req.body || {};
    const token = galeria.loginCliente(CAMINHO_DADOS, req.params.linkToken, usuario, senha);
    res.json({ ok: true, token });
  } catch (e) {
    res.status(401).json({ erro: e.message });
  }
});

function exigirSessaoCliente(req, res, next) {
  const token = req.headers['x-cliente-token'];
  if (!token || !galeria.validarTokenCliente(CAMINHO_DADOS, req.params.linkToken, token)) {
    return res.status(401).json({ erro: 'Faça login de novo.' });
  }
  next();
}

app.get('/api/cliente/:linkToken/galeria', exigirSessaoCliente, async (req, res) => {
  try {
    const g = galeria.buscarGaleriaPorLinkToken(CAMINHO_DADOS, req.params.linkToken);
    if (!g) return res.status(404).json({ erro: 'Link não encontrado.' });
    const resultado = await galeriaComUrls(g);
    resultado.fotos = resultado.fotos.filter((f) => !f.arquivada); // cliente nunca vê arquivadas
    res.json(resultado);
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

app.post('/api/cliente/:linkToken/fotos/:fotoId/comentar', exigirSessaoCliente, (req, res) => {
  try {
    const { texto, desenhoDataUrl } = req.body || {};
    // TODO: se vier desenhoDataUrl, salvar no R2 como imagem e guardar a
    // chave (desenhoR2Key) em vez do data URL cru -- por ora aceita só
    // o texto, o desenho fica pro próximo passo (tela do cliente).
    galeria.comentarFoto(CAMINHO_DADOS, req.params.linkToken, req.params.fotoId, { texto });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

app.post('/api/cliente/:linkToken/fotos/:fotoId/aprovar', exigirSessaoCliente, (req, res) => {
  try {
    const { aprovada } = req.body || {};
    galeria.aprovarFoto(CAMINHO_DADOS, req.params.linkToken, req.params.fotoId, aprovada !== false);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

app.listen(PORTA, () => console.log(`Servidor da Pasta do Cliente rodando na porta ${PORTA}`));
