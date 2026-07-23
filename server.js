// server.js -- Servidor da Pasta do Cliente
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const galeria = require('./lib/galeria');
const storage = require('./lib/storage');

const app = express();
// O padrão do Express (100kb) é pequeno demais pro desenho de anotação
// em base64 -- ele agora é exportado na resolução REAL da foto original
// (pra bater certinho de posição), o que em fotos de resolução mais alta
// facilmente passa de 100kb. Erro que isso causava: "Erro ao falar com o
// servidor" só quando o comentário vinha COM desenho (texto sozinho é
// pequeno, nunca esbarrava nesse limite).
app.use(express.json({ limit: '15mb' }));

// Precisa vir ANTES do express.static: é essa rota que preenche os
// marcadores de Open Graph (__OG_TITULO__ etc.) com o nome de cada
// projeto, pra quando o link é colado no WhatsApp aparecer uma prévia
// bonita em vez do link cru. Apps como WhatsApp não rodam JavaScript
// pra montar essa prévia -- por isso isso precisa estar pronto no HTML
// que o servidor manda, não pode ser montado só depois, no navegador.
const fs = require('fs');
const INDEX_HTML_BRUTO = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
app.get('/', async (req, res) => {
  let tituloProjeto = null;
  let iconeUrl = null;
  const linkToken = req.query.g;
  if (linkToken) {
    try {
      const g = galeria.buscarGaleriaPorLinkToken(CAMINHO_DADOS, linkToken);
      if (g) {
        tituloProjeto = g.nomeProjeto;
        if (g.iconePersonalizado && g.iconePersonalizado.r2Key) {
          iconeUrl = await storage.urlTemporaria(g.iconePersonalizado.r2Key);
        }
      }
    } catch (e) { /* se der erro na busca, só cai no título/ícone genéricos abaixo */ }
  }
  const ogTitulo = tituloProjeto ? `${tituloProjeto} — Sua Galeria RENDERIA` : 'RENDERIA — Sua Galeria';
  const ogDescricao = 'Veja as fotos do seu projeto, aprove ou peça alterações.';
  const ogImagem = iconeUrl || `${req.protocol}://${req.get('host')}/assets/img/logo.jpg`;
  const html = INDEX_HTML_BRUTO
    .split('__OG_TITULO__').join(ogTitulo)
    .split('__OG_DESCRICAO__').join(ogDescricao)
    .split('__OG_IMAGEM__').join(ogImagem);
  res.send(html);
});

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
  const fotos = await Promise.all(galeriaObj.fotos.map(async (f) => {
    const comentarios = await Promise.all((f.comentarios || []).map(async (c) => ({
      ...c,
      desenhoUrl: c.desenhoR2Key ? await storage.urlTemporaria(c.desenhoR2Key) : null
    })));
    return { ...f, url: await storage.urlTemporaria(f.r2Key), comentarios };
  }));
  const categorias = await Promise.all((galeriaObj.categorias || []).map(async (c) => {
    const fotoMood = c.moodFotoId ? fotos.find((f) => f.id === c.moodFotoId) : null;
    return { ...c, moodUrl: fotoMood ? fotoMood.url : null };
  }));
  const marcaDagua = {
    ...galeriaObj.marcaDagua,
    url: (galeriaObj.marcaDagua && galeriaObj.marcaDagua.r2Key) ? await storage.urlTemporaria(galeriaObj.marcaDagua.r2Key) : null
  };
  const iconePersonalizado = {
    ...galeriaObj.iconePersonalizado,
    url: (galeriaObj.iconePersonalizado && galeriaObj.iconePersonalizado.r2Key) ? await storage.urlTemporaria(galeriaObj.iconePersonalizado.r2Key) : null
  };
  const { clienteSenhaHash, sessoesClienteAtivas, ...resto } = galeriaObj;
  return { ...resto, categorias, fotos, marcaDagua, iconePersonalizado };
}

app.get('/saude', (req, res) => res.json({ ok: true, servico: 'renderia-pasta-cliente' }));

// Só devolve um número (não é dado sensível) -- usado pelo painel do
// servidor de licenças pra mostrar "quantas fotos esse arquiteto já usa".
// Libera CORS só aqui: quem chama isso é o painel /admin do servidor de
// licenças, que fica num domínio diferente deste.
app.get('/api/contagem-fotos/:licencaUsuario', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  const usado = galeria.contarFotosDoUsuario(CAMINHO_DADOS, req.params.licencaUsuario);
  res.json({ usado });
});

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

app.post('/api/app/galeria/:projetoId/categorias', exigirSessaoArquiteto, (req, res) => {
  try {
    const categoria = galeria.criarCategoria(CAMINHO_DADOS, req.params.projetoId, (req.body || {}).nome);
    res.json({ ok: true, categoria });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

app.put('/api/app/galeria/:projetoId/categorias/:categoriaId', exigirSessaoArquiteto, (req, res) => {
  try {
    const { nome, ordem, moodFotoId } = req.body || {};
    const categoria = galeria.editarCategoria(CAMINHO_DADOS, req.params.projetoId, req.params.categoriaId, { nome, ordem, moodFotoId });
    res.json({ ok: true, categoria });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

app.delete('/api/app/galeria/:projetoId/categorias/:categoriaId', exigirSessaoArquiteto, (req, res) => {
  try {
    galeria.excluirCategoria(CAMINHO_DADOS, req.params.projetoId, req.params.categoriaId);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

// Marca d'água: o arquivo (PNG, pode ter transparência) vai igual uma
// foto -- só que SEM converter pra webp, pra não perder o canal alfa.
app.post('/api/app/galeria/:projetoId/marca-dagua', exigirSessaoArquiteto, upload.single('arquivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado.' });
    const g = galeria.buscarGaleriaPorProjeto(CAMINHO_DADOS, req.params.projetoId);
    if (!g || g.licencaUsuario !== req.licencaUsuario) return res.status(404).json({ erro: 'Pasta do Cliente não encontrada.' });
    const chave = `${req.params.projetoId}/marca-dagua-${crypto.randomUUID()}.png`;
    await storage.salvarArquivo(chave, req.file.buffer, 'image/png');
    const marcaDagua = galeria.atualizarMarcaDagua(CAMINHO_DADOS, req.params.projetoId, { r2Key: chave });
    res.json({ ok: true, marcaDagua });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

// Só as opções (ativar/desativar, transparência, escala) -- sem
// reenviar o arquivo (usado quando o arquiteto só mexe nos controles).
app.put('/api/app/galeria/:projetoId/marca-dagua', exigirSessaoArquiteto, (req, res) => {
  try {
    const { ativa, transparencia, escala } = req.body || {};
    const marcaDagua = galeria.atualizarMarcaDagua(CAMINHO_DADOS, req.params.projetoId, { ativa, transparencia, escala });
    res.json({ ok: true, marcaDagua });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

// Ícone personalizado -- aparece na tela de login do cliente, na tela
// principal, e na prévia do link quando compartilhado.
app.post('/api/app/galeria/:projetoId/icone', exigirSessaoArquiteto, upload.single('arquivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado.' });
    const g = galeria.buscarGaleriaPorProjeto(CAMINHO_DADOS, req.params.projetoId);
    if (!g || g.licencaUsuario !== req.licencaUsuario) return res.status(404).json({ erro: 'Pasta do Cliente não encontrada.' });
    const chave = `${req.params.projetoId}/icone-${crypto.randomUUID()}.png`;
    await storage.salvarArquivo(chave, req.file.buffer, 'image/png');
    const iconePersonalizado = galeria.atualizarIconePersonalizado(CAMINHO_DADOS, req.params.projetoId, chave);
    res.json({ ok: true, iconePersonalizado });
  } catch (e) {
    res.status(400).json({ erro: e.message });
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

    const { nomeExibicao, tag, tipo, capturaIdOrigem, categoriaId } = req.body;
    const chave = `${req.params.projetoId}/${crypto.randomUUID()}.webp`;
    await storage.salvarArquivo(chave, req.file.buffer, 'image/webp');
    const foto = galeria.adicionarFoto(CAMINHO_DADOS, req.params.projetoId, { nomeExibicao, tag, tipo, r2Key: chave, capturaIdOrigem, categoriaId });
    res.json({ ok: true, foto });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

app.put('/api/app/galeria/:projetoId/fotos/:fotoId', exigirSessaoArquiteto, (req, res) => {
  try {
    const g = galeria.buscarGaleriaPorProjeto(CAMINHO_DADOS, req.params.projetoId);
    if (!g || g.licencaUsuario !== req.licencaUsuario) return res.status(404).json({ erro: 'Não encontrado.' });
    const { nomeExibicao, tag, ordem, arquivada, categoriaId } = req.body || {};
    const foto = galeria.editarFoto(CAMINHO_DADOS, req.params.projetoId, req.params.fotoId, { nomeExibicao, tag, ordem, arquivada, categoriaId });
    res.json({ ok: true, foto });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

// Reordena várias fotos de uma categoria de UMA VEZ SÓ -- usado no
// arrastar-e-soltar do app. Existe pra evitar a corrida que dava quando
// o app mandava uma chamada PUT separada pra cada foto em paralelo
// (cada uma lendo/escrevendo o arquivo por conta própria podia
// sobrescrever a mudança das outras).
app.put('/api/app/galeria/:projetoId/reordenar', exigirSessaoArquiteto, (req, res) => {
  try {
    const g = galeria.buscarGaleriaPorProjeto(CAMINHO_DADOS, req.params.projetoId);
    if (!g || g.licencaUsuario !== req.licencaUsuario) return res.status(404).json({ erro: 'Não encontrado.' });
    const { categoriaId, ordemDosIds } = req.body || {};
    if (!Array.isArray(ordemDosIds)) return res.status(400).json({ erro: 'ordemDosIds precisa ser uma lista.' });
    const fotos = galeria.reordenarFotos(CAMINHO_DADOS, req.params.projetoId, categoriaId, ordemDosIds);
    res.json({ ok: true, fotos });
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

// Info pública, sem precisar estar logado -- só o necessário pra tela de
// login já mostrar o nome do projeto e o ícone personalizado (se tiver).
// Nada sensível aqui (nem usuário, nem senha, nem fotos).
app.get('/api/cliente/:linkToken/info-publica', async (req, res) => {
  const g = galeria.buscarGaleriaPorLinkToken(CAMINHO_DADOS, req.params.linkToken);
  if (!g) return res.status(404).json({ erro: 'Link não encontrado.' });
  const iconeUrl = (g.iconePersonalizado && g.iconePersonalizado.r2Key) ? await storage.urlTemporaria(g.iconePersonalizado.r2Key) : null;
  res.json({ nomeProjeto: g.nomeProjeto, iconeUrl });
});

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

app.post('/api/cliente/:linkToken/fotos/:fotoId/comentar', exigirSessaoCliente, async (req, res) => {
  try {
    const { texto, desenhoDataUrl } = req.body || {};
    let desenhoR2Key = null;
    if (desenhoDataUrl && desenhoDataUrl.startsWith('data:image/png;base64,')) {
      const buffer = Buffer.from(desenhoDataUrl.split(',')[1], 'base64');
      desenhoR2Key = `${req.params.linkToken}/comentarios/${crypto.randomUUID()}.png`;
      await storage.salvarArquivo(desenhoR2Key, buffer, 'image/png');
    }
    galeria.comentarFoto(CAMINHO_DADOS, req.params.linkToken, req.params.fotoId, { texto, desenhoR2Key });
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
