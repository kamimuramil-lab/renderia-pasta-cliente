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

// --------------------------------------------------------------------
// LIMITADOR DE TENTATIVAS (correção A3, auditoria ago/2026) -- esse
// servidor não tinha NENHUM rate limiting antes, em rota nenhuma. Isso
// facilitava tentar muitos "projetoId" seguidos (pra achar um de outro
// arquiteto -- ver correção C1) ou forçar a senha do cliente final por
// tentativa e erro, sem nenhum atrito. Mesmo padrão simples já usado no
// licenca-servidor, aplicado aqui nas rotas mais sensíveis a isso.
// --------------------------------------------------------------------
const tentativasPorChave = new Map();
const JANELA_MS = 1 * 60 * 1000; // 1 minuto
const MAX_TENTATIVAS = 20;

function limiteExcedido(chave) {
  const agora = Date.now();
  const registro = tentativasPorChave.get(chave) || { tentativas: 0, desde: agora };
  if (agora - registro.desde > JANELA_MS) {
    registro.tentativas = 0;
    registro.desde = agora;
  }
  registro.tentativas++;
  tentativasPorChave.set(chave, registro);
  return registro.tentativas > MAX_TENTATIVAS;
}

function limitarPorIP(req, res, next) {
  if (limiteExcedido(req.ip)) {
    return res.status(429).json({ erro: 'Muitas tentativas em pouco tempo. Aguarde um minuto e tente de novo.' });
  }
  next();
}

// Precisa vir ANTES do express.static: é essa rota que preenche os
// marcadores de Open Graph (__OG_TITULO__ etc.) com o nome de cada
// projeto, pra quando o link é colado no WhatsApp aparecer uma prévia
// bonita em vez do link cru. Apps como WhatsApp não rodam JavaScript
// pra montar essa prévia -- por isso isso precisa estar pronto no HTML
// que o servidor manda, não pode ser montado só depois, no navegador.
const fs = require('fs');
const CAMINHO_INDEX_HTML = path.join(__dirname, 'public', 'index.html');
const INDEX_HTML_BRUTO = fs.readFileSync(CAMINHO_INDEX_HTML, 'utf8');
// Em produção o HTML é lido uma vez (a hospedagem reinicia a cada atualização). No modo de TESTE local
// relê a cada pedido: antes, quem deixava o servidor de teste aberto recebia o HTML ANTIGO misturado com
// JS/CSS NOVOS (esses vêm do disco a cada pedido) -- e a página ficava quebrada até reiniciar o servidor.
const lerIndexHtml = () => (storage.MODO_LOCAL ? fs.readFileSync(CAMINHO_INDEX_HTML, 'utf8') : INDEX_HTML_BRUTO);

// Coloca a data de modificação de cada JS/CSS na URL (assets/js/main.js?v=...): se o arquivo mudar, a URL
// muda, e o navegador nunca usa uma cópia velha junto com um HTML novo (nem o contrário).
function comVersaoNosAssets(html) {
  return html.replace(/(assets\/(?:js|css)\/[\w.-]+\.(?:js|css))(?=")/g, (m, caminho) => {
    try { return `${caminho}?v=${Math.round(fs.statSync(path.join(__dirname, 'public', caminho)).mtimeMs)}`; } catch (e) { return m; }
  });
}
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
  const html = comVersaoNosAssets(lerIndexHtml())
    .split('__OG_TITULO__').join(ogTitulo)
    .split('__OG_DESCRICAO__').join(ogDescricao)
    .split('__OG_IMAGEM__').join(ogImagem);
  res.send(html);
});

app.use(express.static(path.join(__dirname, 'public')));

// SÓ NO MODO DE TESTE (ARMAZENAMENTO_LOCAL_TESTE=1, nunca em produção): serve os
// arquivos gravados em disco local, pra página do cliente conseguir mostrar as
// imagens num navegador de verdade. Em produção (R2) esta rota nem é registrada.
if (storage.MODO_LOCAL) {
  app.get('/_local/*', (req, res) => {
    const relativo = decodeURIComponent(req.params[0] || '');
    const alvo = path.resolve(storage.PASTA_LOCAL, relativo);
    if (!alvo.startsWith(path.resolve(storage.PASTA_LOCAL) + path.sep) || !fs.existsSync(alvo)) return res.status(404).end();
    res.sendFile(alvo);
  });
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } }); // 15MB de folga (a otimização no app já deixa isso bem menor)

const PORTA = process.env.PORT || 3000;
const CAMINHO_DADOS = galeria.caminhoPadrao(__dirname);
const LICENCA_SERVIDOR_URL = process.env.LICENCA_SERVIDOR_URL || null;

// --------------------------------------------------------------------
// Middleware: confere a sessão do ARQUITETO direto no servidor de
// licenças (nunca duplicamos essa lógica aqui) -- e já aproveita pra
// pegar o limiteFotos, que vem na mesma resposta. Usa o endpoint
// "-servidor" (não o /api/verificar-sessao normal, usado pelo app) --
// esse aqui não checa vínculo de chave de API nem versão mínima do app,
// porque nenhum dos dois faz sentido pra uma chamada servidor-a-servidor.
// --------------------------------------------------------------------
async function exigirSessaoArquiteto(req, res, next) {
  try {
    const token = req.headers['x-sessao-token'];
    if (!token) return res.status(401).json({ erro: 'Sessão não informada.' });
    if (!LICENCA_SERVIDOR_URL) return res.status(503).json({ erro: 'LICENCA_SERVIDOR_URL não configurada neste servidor.' });

    const resposta = await fetch(`${LICENCA_SERVIDOR_URL}/api/verificar-sessao-servidor`, {
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
  const plantas = await Promise.all((galeriaObj.plantas || []).map(async (p) => ({
    ...p,
    url: await storage.urlTemporaria(p.r2Key)
  })));
  const { clienteSenhaHash, sessoesClienteAtivas, ...resto } = galeriaObj;
  return { ...resto, categorias, plantas, fotos, marcaDagua, iconePersonalizado };
}

app.get('/saude', (req, res) => res.json({ ok: true, servico: 'renderia-pasta-cliente' }));

// Só devolve um número (não é dado sensível) -- usado pelo painel do
// servidor de licenças pra mostrar "quantas fotos esse arquiteto já usa".
// Libera CORS só pra origem do servidor de licenças (não mais pra
// qualquer site -- correção B1, auditoria ago/2026: "*" deixava
// qualquer página da internet chamar isso via JavaScript do navegador
// de quem estivesse com essa aba aberta).
const LICENCA_SERVIDOR_ORIGEM = (() => {
  try { return LICENCA_SERVIDOR_URL ? new URL(LICENCA_SERVIDOR_URL).origin : null; } catch (e) { return null; }
})();
app.get('/api/contagem-fotos/:licencaUsuario', (req, res) => {
  if (LICENCA_SERVIDOR_ORIGEM) res.header('Access-Control-Allow-Origin', LICENCA_SERVIDOR_ORIGEM);
  const usado = galeria.contarFotosDoUsuario(CAMINHO_DADOS, req.params.licencaUsuario);
  res.json({ usado });
});

// ====================================================================
// ROTAS DO APP (o arquiteto -- precisa de sessão válida do RENDERIA)
// ====================================================================

app.post('/api/app/galeria', limitarPorIP, exigirSessaoArquiteto, (req, res) => {
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
    const categoria = galeria.criarCategoria(CAMINHO_DADOS, req.params.projetoId, (req.body || {}).nome, req.licencaUsuario);
    res.json({ ok: true, categoria });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

app.put('/api/app/galeria/:projetoId/categorias/:categoriaId', exigirSessaoArquiteto, (req, res) => {
  try {
    const { nome, ordem, moodFotoId } = req.body || {};
    const categoria = galeria.editarCategoria(CAMINHO_DADOS, req.params.projetoId, req.params.categoriaId, { nome, ordem, moodFotoId }, req.licencaUsuario);
    res.json({ ok: true, categoria });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

app.delete('/api/app/galeria/:projetoId/categorias/:categoriaId', exigirSessaoArquiteto, (req, res) => {
  try {
    galeria.excluirCategoria(CAMINHO_DADOS, req.params.projetoId, req.params.categoriaId, req.licencaUsuario);
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
    const marcaDagua = galeria.atualizarMarcaDagua(CAMINHO_DADOS, req.params.projetoId, { r2Key: chave }, req.licencaUsuario);
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
    const marcaDagua = galeria.atualizarMarcaDagua(CAMINHO_DADOS, req.params.projetoId, { ativa, transparencia, escala }, req.licencaUsuario);
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

// --------------------------------------------------------------------
// PLANTAS BAIXAS (uma por pavimento). A imagem vai igual uma foto, mas
// SEM converter pra webp aqui: planta tem linhas finas e texto, então o
// app manda no formato que achar melhor (PNG/JPG/WebP) e guardamos como
// veio. Toda rota confere a posse do projeto.
// --------------------------------------------------------------------
const TIPOS_PLANTA = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

app.post('/api/app/galeria/:projetoId/plantas', exigirSessaoArquiteto, upload.single('arquivo'), async (req, res) => {
  let chave = null;
  try {
    if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado.' });
    const extensao = TIPOS_PLANTA[req.file.mimetype];
    if (!extensao) return res.status(400).json({ erro: 'Envie a planta como PNG, JPG ou WebP.' });
    const g = galeria.buscarGaleriaPorProjeto(CAMINHO_DADOS, req.params.projetoId);
    if (!g || g.licencaUsuario !== req.licencaUsuario) return res.status(404).json({ erro: 'Pasta do Cliente não encontrada.' });
    // Confere o limite ANTES de gravar no armazenamento, pra não deixar arquivo órfão.
    if ((g.plantas || []).length >= galeria.LIMITE_PLANTAS_POR_PROJETO) {
      return res.status(400).json({ erro: `Esse projeto já tem o máximo de ${galeria.LIMITE_PLANTAS_POR_PROJETO} plantas. Exclua alguma antes de adicionar outra.` });
    }
    chave = `${req.params.projetoId}/planta-${crypto.randomUUID()}.${extensao}`;
    await storage.salvarArquivo(chave, req.file.buffer, req.file.mimetype);
    const planta = galeria.adicionarPlanta(CAMINHO_DADOS, req.params.projetoId, { nome: (req.body || {}).nome, r2Key: chave }, req.licencaUsuario);
    res.json({ ok: true, planta: { ...planta, url: await storage.urlTemporaria(planta.r2Key) } });
  } catch (e) {
    if (chave) { try { await storage.excluirArquivo(chave); } catch (e2) { /* melhor esforço */ } }
    res.status(400).json({ erro: e.message });
  }
});

app.put('/api/app/galeria/:projetoId/plantas/:plantaId', exigirSessaoArquiteto, (req, res) => {
  try {
    const { nome, ordem } = req.body || {};
    const planta = galeria.editarPlanta(CAMINHO_DADOS, req.params.projetoId, req.params.plantaId, { nome, ordem }, req.licencaUsuario);
    res.json({ ok: true, planta });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

// Troca só a imagem da planta -- os ícones continuam onde estavam.
app.post('/api/app/galeria/:projetoId/plantas/:plantaId/imagem', exigirSessaoArquiteto, upload.single('arquivo'), async (req, res) => {
  let chave = null;
  try {
    if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado.' });
    const extensao = TIPOS_PLANTA[req.file.mimetype];
    if (!extensao) return res.status(400).json({ erro: 'Envie a planta como PNG, JPG ou WebP.' });
    const g = galeria.buscarGaleriaPorProjeto(CAMINHO_DADOS, req.params.projetoId);
    if (!g || g.licencaUsuario !== req.licencaUsuario) return res.status(404).json({ erro: 'Pasta do Cliente não encontrada.' });
    chave = `${req.params.projetoId}/planta-${crypto.randomUUID()}.${extensao}`;
    await storage.salvarArquivo(chave, req.file.buffer, req.file.mimetype);
    const { planta, r2KeyAntiga } = galeria.atualizarImagemPlanta(CAMINHO_DADOS, req.params.projetoId, req.params.plantaId, chave, req.licencaUsuario);
    try { await storage.excluirArquivo(r2KeyAntiga); } catch (e) { console.error('Aviso: falhou excluir a planta antiga do armazenamento:', e.message); }
    res.json({ ok: true, planta: { ...planta, url: await storage.urlTemporaria(planta.r2Key) } });
  } catch (e) {
    if (chave) { try { await storage.excluirArquivo(chave); } catch (e2) { /* melhor esforço */ } }
    res.status(400).json({ erro: e.message });
  }
});

app.delete('/api/app/galeria/:projetoId/plantas/:plantaId', exigirSessaoArquiteto, async (req, res) => {
  try {
    const r2Key = galeria.excluirPlanta(CAMINHO_DADOS, req.params.projetoId, req.params.plantaId, req.licencaUsuario);
    try { await storage.excluirArquivo(r2Key); } catch (e) { console.error('Aviso: falhou excluir a planta do armazenamento, mas já excluiu dos dados:', e.message); }
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

// Posição do ícone de uma foto na planta (plantaId vazio = tira da planta).
app.put('/api/app/galeria/:projetoId/fotos/:fotoId/posicao', exigirSessaoArquiteto, (req, res) => {
  try {
    const { plantaId, x, y } = req.body || {};
    const foto = galeria.posicionarFotoNaPlanta(CAMINHO_DADOS, req.params.projetoId, req.params.fotoId, { plantaId, x, y }, req.licencaUsuario);
    res.json({ ok: true, foto: { id: foto.id, plantaId: foto.plantaId, pinPlanta: foto.pinPlanta } });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

// Leve, só pro selinho de "novo comentário" no botão -- não busca URLs.
app.get('/api/app/status/:projetoId', exigirSessaoArquiteto, (req, res) => {
  const g = galeria.buscarGaleriaPorProjeto(CAMINHO_DADOS, req.params.projetoId);
  if (g && g.licencaUsuario !== req.licencaUsuario) return res.status(404).json({ existe: false, temComentarioNaoLido: false });
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
    galeria.marcarComentariosLidos(CAMINHO_DADOS, req.params.projetoId, req.licencaUsuario);
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

app.post('/api/cliente/:linkToken/login', limitarPorIP, (req, res) => {
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
