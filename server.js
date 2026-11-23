// server.js -- Servidor da Pasta do Cliente
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const galeria = require('./lib/galeria');
const hubLib = require('./lib/hub');
const recursosDonoLib = require('./lib/recursos-dono');
const driveLib = require('./lib/drive-arquivo');
const reunioesLib = require('./lib/reunioes');
const orcLib = require('./lib/orcamentos');
const memLib = require('./lib/memorial');
const dashLib = require('./lib/dashboard');
const storage = require('./lib/storage');
const backup = require('./lib/backup');
const atividades = require('./lib/atividades');

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
// Ícone do ARQUITETO na prévia do link (WhatsApp etc.) e na aba do navegador: o que ele configurou em Configurações > "Ícone e logo da empresa".
// Antes a prévia usava um endereço ASSINADO de 1 h do armazenamento: depois disso o WhatsApp/navegador recebiam "negado" e o ícone sumia.
// Agora a página aponta pra /marca (endereço fixo, que serve o arquivo) e leva um trecho da chave do arquivo (?v=) pra a prévia trocar
// quando o arquiteto troca o ícone. Ordem: ícone do projeto > ícone da conta > logo da conta > logo do RENDERIA.
//   origem 'g' = pasta do cliente | 'o' = pasta de orçamentos | 'c' = dashboard (link da conta)
function chaveDaMarca(origem, token) {
  if (typeof token !== 'string' || !token || token.length > 200) return null;
  const estado = galeria.lerEstado(CAMINHO_DADOS);
  if (origem === 'c') {
    const licenca = dashLib.licencaDoLink(CAMINHO_DADOS, token);
    if (!licenca) return null;
    const perfil = galeria.perfilDaLicenca(estado, licenca);
    return perfil.icone.r2Key || perfil.marca.r2Key || null;
  }
  const g = origem === 'g' ? galeria.buscarGaleriaPorLinkToken(CAMINHO_DADOS, token) : (origem === 'o' ? orcLib.buscarPorLinkToken(CAMINHO_DADOS, token) : null);
  if (!g) return null;
  const pers = galeria.resolverPersonalizacao(estado, g);
  if (!pers.iconeExibir) return null; // o arquiteto desligou "Exibir ícone" neste projeto: a prévia também não mostra
  return pers.iconeR2Key || pers.marcaR2Key || null;
}
function imagemDaPagina(req, origem, token) {
  const padrao = `${req.protocol}://${req.get('host')}/assets/img/logo.jpg`;
  try {
    const chave = chaveDaMarca(origem, token);
    if (!chave) return padrao;
    const v = require('crypto').createHash('sha1').update(chave).digest('hex').slice(0, 8);
    return `${req.protocol}://${req.get('host')}/marca?${origem}=${encodeURIComponent(token)}&v=${v}`;
  } catch (e) { return padrao; }
}
app.get('/marca', async (req, res) => {
  const origem = ['g', 'o', 'c'].find((k) => typeof req.query[k] === 'string');
  try {
    const chave = origem ? chaveDaMarca(origem, req.query[origem]) : null;
    if (!chave) return res.redirect(302, '/assets/img/logo.jpg');
    const bytes = await storage.lerArquivo(chave);
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' }).send(bytes);
  } catch (e) { res.redirect(302, '/assets/img/logo.jpg'); }
});

app.get('/', async (req, res) => {
  let tituloProjeto = null;
  const linkToken = req.query.g;
  if (linkToken) {
    try {
      const g = galeria.buscarGaleriaPorLinkToken(CAMINHO_DADOS, linkToken);
      if (g) tituloProjeto = g.nomeProjeto;
    } catch (e) { /* se der erro na busca, só cai no título genérico abaixo */ }
  }
  const ogTitulo = tituloProjeto ? `${tituloProjeto} — Sua Galeria RENDERIA` : 'RENDERIA — Sua Galeria';
  const ogDescricao = 'Veja as fotos do seu projeto, aprove ou peça alterações.';
  const ogImagem = imagemDaPagina(req, 'g', linkToken);
  const html = comVersaoNosAssets(lerIndexHtml())
    .split('__OG_TITULO__').join(ogTitulo)
    .split('__OG_DESCRICAO__').join(ogDescricao)
    .split('__OG_IMAGEM__').join(ogImagem);
  res.send(html);
});

// Página da Pasta de Orçamentos (link próprio: /orcamentos?o=<token>). Mesmo esquema do index: prévia do WhatsApp preenchida
// no servidor e JS/CSS com versão na URL.
const CAMINHO_ORC_HTML = path.join(__dirname, 'public', 'orcamentos.html');
const ORC_HTML_BRUTO = fs.existsSync(CAMINHO_ORC_HTML) ? fs.readFileSync(CAMINHO_ORC_HTML, 'utf8') : '';
// A Pasta de Orçamentos só fica disponível pro cliente enquanto o DONO tem o recurso na licença (cópia em g.recursosAtivos).
async function orcamentosDisponiveis(linkToken) {
  const g = orcLib.buscarPorLinkToken(CAMINHO_DADOS, linkToken);
  if (!g || (await galeriaIndisponivel(g))) return null; // assinatura vencida: restrito
  return ((await recursosDoDono(g)).orcamentos === true) ? g : null;
}
// Link de orçamentos cuja pasta existe mas está INDISPONÍVEL por assinatura vencida (a página explica em vez de dizer "link não encontrado").
async function orcamentosVencidos(linkToken) {
  const g = orcLib.buscarPorLinkToken(CAMINHO_DADOS, linkToken);
  return !!(g && (await galeriaIndisponivel(g)));
}
const lerOrcHtml = () => (storage.MODO_LOCAL ? fs.readFileSync(CAMINHO_ORC_HTML, 'utf8') : ORC_HTML_BRUTO);
app.get('/orcamentos', async (req, res) => {
  let nome = null;
  try { const g = await orcamentosDisponiveis(req.query.o); if (g) nome = g.nomeProjeto; } catch (e) { /* título genérico */ }
  const html = comVersaoNosAssets(lerOrcHtml())
    .split('__OG_TITULO__').join(nome ? `${nome} — Orçamentos` : 'Orçamentos do seu projeto')
    .split('__OG_DESCRICAO__').join('Veja os orçamentos do seu projeto, acompanhe o andamento e comente.')
    .split('__OG_IMAGEM__').join(imagemDaPagina(req, 'o', req.query.o));
  res.send(html);
});

// Dashboard online (/dashboard?c=<link da conta>): a página só mostra o login; os dados vêm por API depois da senha mestra.
const CAMINHO_DASH_HTML = path.join(__dirname, 'public', 'dashboard.html');
const DASH_HTML_BRUTO = fs.existsSync(CAMINHO_DASH_HTML) ? fs.readFileSync(CAMINHO_DASH_HTML, 'utf8') : '';
const lerDashHtml = () => (storage.MODO_LOCAL ? fs.readFileSync(CAMINHO_DASH_HTML, 'utf8') : DASH_HTML_BRUTO);
app.get('/dashboard', (req, res) => {
  // título com o nome do escritório (se o arquiteto cadastrou), pra link compartilhado dizer de quem é
  let titulo = 'DASHBOARD de projetos';
  try {
    const licenca = typeof req.query.c === 'string' ? dashLib.licencaDoLink(CAMINHO_DADOS, req.query.c) : null;
    const nome = licenca ? galeria.nomeEscritorioDaLicenca(galeria.lerEstado(CAMINHO_DADOS), licenca).trim() : '';
    if (nome) titulo = `DASHBOARD — ${nome}`;
  } catch (e) { /* título genérico */ }
  const html = comVersaoNosAssets(lerDashHtml())
    .split('__OG_TITULO__').join(titulo)
    .split('__OG_DESCRICAO__').join('Acesso restrito.')
    .split('__OG_IMAGEM__').join(imagemDaPagina(req, 'c', req.query.c));
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

// Recursos do DONO consultados AO VIVO no servidor de licença (cache curto): trocar o nível da conta vale pra todos os projetos, sem esperar o
// arquiteto abrir cada um. Só liga com URL da licença + segredo compartilhado (RENDERIA_SEGREDO_SERVIDORES, o MESMO nos dois servidores);
// sem eles, tudo segue como antes (cópia guardada na galeria). Se o servidor de licença cair, vale o último valor conhecido. Ver lib/recursos-dono.js.
const recursosDono = recursosDonoLib.criarResolvedor({
  urlLicenca: LICENCA_SERVIDOR_URL,
  segredo: process.env.RENDERIA_SEGREDO_SERVIDORES || null,
  ttlMs: Math.max(1, Number(process.env.RECURSOS_DONO_TTL_SEGUNDOS) || 60) * 1000,
  falhaMs: Math.max(1, Number(process.env.RECURSOS_DONO_FALHA_SEGUNDOS) || 15) * 1000,
  aoConfirmar: (usuario, recursos, ativa) => galeria.sincronizarRecursosDaConta(CAMINHO_DADOS, usuario, recursos, ativa),
  aviso: (m) => console.error('Aviso: ' + m)
});
// O que o DONO da galeria tem AGORA ({ paginaProjeto, orcamentos, memorial }); sem como confirmar, a cópia guardada na galeria.
async function recursosDoDono(g) {
  return (await recursosDono.obter(g && g.licencaUsuario, g && g.recursosAtivos)) || { paginaProjeto: false, orcamentos: false, memorial: false };
}
// Assinatura VENCIDA = acesso restrito pro cliente final e pro dashboard (o arquiteto já é barrado no servidor de licença: a sessão dele deixa
// de valer). NADA é apagado: renovar a licença reabre tudo (em até ~1 min, pelo cache). Sem como confirmar (nada configurado), libera como sempre.
const MSG_PASTA_INDISPONIVEL = 'Esta pasta está temporariamente indisponível. Fale com o escritório responsável pelo seu projeto.';
async function galeriaIndisponivel(g) {
  if (!g) return false;
  const e = await recursosDono.obterEstado(g.licencaUsuario, g.recursosAtivos, g.contaAtiva);
  return e.ativa === false;
}
// Dashboard online da conta (só vale com a assinatura em dia E a Página do projeto). Sem como confirmar (nada configurado), libera como sempre foi.
// -> 'ok' | 'vencida' | 'sem-recurso'
async function situacaoDoDashboard(licencaConta) {
  const e = await recursosDono.obterEstado(licencaConta, null, true);
  if (e.ativa === false) return 'vencida';
  return (e.recursos === null || e.recursos.paginaProjeto === true) ? 'ok' : 'sem-recurso';
}

// Backup diário do arquivo de dados no R2 (60 dias) e limpeza do registro de atividades (180 dias).
backup.iniciarRotina(CAMINHO_DADOS);
atividades.limparAntigas(CAMINHO_DADOS);
setInterval(() => atividades.limparAntigas(CAMINHO_DADOS), 24 * 60 * 60 * 1000).unref();

// IP de quem chamou (o Render fica na frente: o primeiro do X-Forwarded-For). Só vai pro registro de atividades, e já pela metade.
const ipDaRequisicao = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || '';
const registrarAtividade = (req, tipo, licenca, projetoId, detalhe) => atividades.registrar(CAMINHO_DADOS, { tipo, licenca, projetoId, detalhe, ip: ipDaRequisicao(req) });

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
    // Recursos NOVOS da licença (o servidor de licença novo manda `recursos`; um servidor antigo não manda = nenhum recurso).
    // Também atualiza, na galeria do projeto, a cópia do que o dono tem (é ela que o lado do cliente consulta).
    req.recursos = (dados.recursos && typeof dados.recursos === 'object') ? dados.recursos : {};
    const projetoDaChamada = (req.params && req.params.projetoId) || (req.body && req.body.projetoId);
    if (projetoDaChamada) { try { galeria.sincronizarRecursos(CAMINHO_DADOS, projetoDaChamada, req.licencaUsuario, req.recursos); } catch (e) { /* não derruba a chamada */ } }
    // Mudança do escritório num projeto antigo que o cliente ainda não abriu: a "foto base" das bolinhas nasce ANTES da mudança.
    if (projetoDaChamada && req.method !== 'GET') { try { galeria.garantirBaseAntesDeMudar(CAMINHO_DADOS, projetoDaChamada, req.licencaUsuario); } catch (e) { /* só as bolinhas */ } }
    req.limiteFotos = dados.limiteFotos;
    next();
  } catch (e) {
    res.status(500).json({ erro: 'Erro conferindo sessão: ' + e.message });
  }
}

// Trava por recurso da licença: o arquiteto sem o recurso recebe 403 (o app já esconde a tela; isto vale pra quem chamar a API direto).
const NOME_RECURSO = { paginaProjeto: 'Página do projeto', orcamentos: 'Pasta de Orçamentos', memorial: 'Memorial de itens' };
function exigirRecurso(recurso) {
  return (req, res, next) => {
    if (req.recursos && req.recursos[recurso] === true) return next();
    res.status(403).json({ erro: `Sua licença não inclui o recurso "${NOME_RECURSO[recurso] || recurso}".`, recurso });
  };
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
  // Ícone e logo: o PRÓPRIO do projeto vence; sem ele, vale o da CONTA do arquiteto (Configurações do app).
  // `origem` diz de onde veio ('projeto' | 'conta' | null). O cliente final só usa `url` (null = nada a mostrar).
  const pers = galeria.resolverPersonalizacao(galeria.lerEstado(CAMINHO_DADOS), galeriaObj);
  const urlMarca = pers.marcaR2Key ? await storage.urlTemporaria(pers.marcaR2Key) : null;
  const urlIcone = pers.iconeR2Key ? await storage.urlTemporaria(pers.iconeR2Key) : null;
  const marcaDagua = { ...galeriaObj.marcaDagua, origem: pers.marcaOrigem, url: urlMarca };
  const iconePersonalizado = {
    ...galeriaObj.iconePersonalizado,
    exibir: pers.iconeExibir,
    origem: pers.iconeOrigem,
    urlArquivo: urlIcone,                       // o arquivo, mesmo com "Exibir ícone" desligado (o app mostra a miniatura)
    url: pers.iconeExibir ? urlIcone : null     // o que o cliente final realmente mostra
  };
  const plantas = await Promise.all((galeriaObj.plantas || []).map(async (p) => ({
    ...p,
    url: await storage.urlTemporaria(p.r2Key)
  })));
  // Hub do cliente: já manda a lista de grupos do executivo resolvida (padrão quando o projeto não personalizou).
  // `capaUrl` = a foto escolhida como capa (some se a foto foi apagada/arquivada: volta pra capa padrão).
  const fotoCapa = galeriaObj.hub.capaFotoId ? fotos.find((f) => f.id === galeriaObj.hub.capaFotoId && !f.arquivada) : null;
  // Sem o recurso "Página do projeto" no dono da galeria, o hub NÃO sai (o cliente cai na galeria clássica, como sempre foi).
  const recursosVivos = await recursosDoDono(galeriaObj); // o que o dono tem AGORA (ao vivo, com reserva)
  const novoVisual = recursosVivos.paginaProjeto === true;
  const hub = novoVisual
    ? { ...galeriaObj.hub, gruposExecutivo: hubLib.gruposDoExecutivo(galeriaObj.hub), capaUrl: fotoCapa ? fotoCapa.url : null }
    : { dadosProjeto: '', links: {}, gruposExecutivo: hubLib.gruposDoExecutivo({}), documentos: [], capaFotoId: null, capaUrl: null };
  // `orcamentos` (valores, login e senha da Pasta de Orçamentos) NUNCA sai por aqui: esta resposta vai pro app E pro cliente
  // da Pasta Cliente, e quem recebe a Pasta Cliente não pode alcançar os valores. O app lê os orçamentos por rotas próprias.
  // Memorial de itens: só aparece pro cliente quando o dono tem o recurso "memorial" E a página do projeto (o cartão mora no hub).
  // Nunca leva o valor nem as chaves do armazenamento (só a URL temporária da foto do produto).
  let memorialCliente = { itens: [], setores: memLib.SETORES };
  if (novoVisual && recursosVivos.memorial === true) {
    const m = memLib.paraCliente(galeriaObj);
    memorialCliente = { ...m, itens: await Promise.all(m.itens.map(async ({ fotoR2Key, ...i }) => ({ ...i, fotoUrl: fotoR2Key ? await storage.urlTemporaria(fotoR2Key) : null }))) };
  }
  const { clienteSenhaHash, sessoesClienteAtivas, orcamentos, recursosAtivos, memorial, reunioes, ...resto } = galeriaObj;
  const estadoPerfil = galeria.lerEstado(CAMINHO_DADOS);
  const nomeEscritorio = galeria.nomeEscritorioDaLicenca(estadoPerfil, galeriaObj.licencaUsuario);
  const contatosEscritorio = galeria.contatosEscritorioDaLicenca(estadoPerfil, galeriaObj.licencaUsuario);
  const coresEscritorio = galeria.coresEscritorioDaLicenca(estadoPerfil, galeriaObj.licencaUsuario);
  return { ...resto, categorias, plantas, fotos, marcaDagua, iconePersonalizado, hub, novoVisual, nomeEscritorio, contatosEscritorio, coresEscritorio, memorial: memorialCliente };
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
    galeria.sincronizarRecursos(CAMINHO_DADOS, projetoId, req.licencaUsuario, req.recursos); // galeria nova já nasce com a cópia dos recursos do dono
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

// O que o PDF das imagens que o CLIENTE baixa mostra (nome de cada imagem, paleta, marca no canto). Quem define é o arquiteto.
app.put('/api/app/galeria/:projetoId/pdf-cliente', exigirSessaoArquiteto, exigirRecurso('paginaProjeto'), (req, res) => {
  try {
    const { nomes, paleta, marca } = req.body || {};
    res.json({ ok: true, pdfCliente: galeria.atualizarPdfCliente(CAMINHO_DADOS, req.params.projetoId, { nomes, paleta, marca }, req.licencaUsuario) });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

// Atas das reuniões de apresentação (só o escritório vê; o cliente nunca recebe).
app.get('/api/app/galeria/:projetoId/reunioes', exigirSessaoArquiteto, exigirRecurso('paginaProjeto'), async (req, res) => {
  try {
    const lista = reunioesLib.listar(CAMINHO_DADOS, req.params.projetoId, req.licencaUsuario);
    const g = galeria.buscarGaleriaPorProjeto(CAMINHO_DADOS, req.params.projetoId);
    const reunioes = await Promise.all(lista.map(async (r) => ({
      id: r.id, titulo: r.titulo, apresentado: r.apresentado, notas: r.notas, iniciouEm: r.iniciouEm, encerrouEm: r.encerrouEm, criadaEm: r.criadaEm,
      texto: reunioesLib.textoParaCopiar(r, g && g.nomeProjeto),
      prints: await Promise.all((r.prints || []).map(async (p) => ({ rotulo: p.rotulo, url: await storage.urlTemporaria(p.r2Key) })))
    })));
    res.json({ ok: true, reunioes });
  } catch (e) { res.status(400).json({ erro: e.message }); }
});
app.delete('/api/app/galeria/:projetoId/reunioes/:reuniaoId', exigirSessaoArquiteto, exigirRecurso('paginaProjeto'), async (req, res) => {
  try {
    const chaves = reunioesLib.excluir(CAMINHO_DADOS, req.params.projetoId, req.params.reuniaoId, req.licencaUsuario);
    for (const chave of chaves) { try { await storage.excluirArquivo(chave); } catch (e) { console.error('Aviso: falhou excluir o print da reunião:', e.message); } }
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ erro: e.message }); }
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

// "Exibir ícone" desse projeto (liga/desliga só a exibição)
app.put('/api/app/galeria/:projetoId/icone', exigirSessaoArquiteto, (req, res) => {
  try {
    const { exibir } = req.body || {};
    if (typeof exibir !== 'boolean') return res.status(400).json({ erro: 'Informe exibir: true ou false.' });
    const iconePersonalizado = galeria.atualizarExibirIcone(CAMINHO_DADOS, req.params.projetoId, exibir, req.licencaUsuario);
    res.json({ ok: true, iconePersonalizado });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

// Tira o ícone / o logo PRÓPRIO do projeto (volta a valer o da conta) e apaga o arquivo.
function rotaRemoverPersonalizacaoPropria(tipo) {
  return async (req, res) => {
    try {
      const antiga = galeria.removerPersonalizacaoPropria(CAMINHO_DADOS, req.params.projetoId, tipo, req.licencaUsuario);
      if (antiga) { try { await storage.excluirArquivo(antiga); } catch (e) { console.error('Aviso: falhou excluir o arquivo do armazenamento:', e.message); } }
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ erro: e.message });
    }
  };
}
app.delete('/api/app/galeria/:projetoId/icone', exigirSessaoArquiteto, rotaRemoverPersonalizacaoPropria('icone'));
app.delete('/api/app/galeria/:projetoId/marca-dagua', exigirSessaoArquiteto, rotaRemoverPersonalizacaoPropria('marca'));

// --------------------------------------------------------------------
// ÍCONE E LOGO DA CONTA do arquiteto (configurados uma vez nas Configurações do app, valem pra todos os projetos).
// A conta vem SEMPRE da sessão (req.licencaUsuario), nunca de um parâmetro: ninguém mexe no perfil de outro.
// --------------------------------------------------------------------
const ASSINATURA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function chaveDoPerfil(licencaUsuario, tipo) {
  const pasta = crypto.createHash('sha256').update(String(licencaUsuario)).digest('hex').slice(0, 16);
  return `perfis/${pasta}/${tipo}-${crypto.randomUUID()}.png`;
}
async function perfilComUrls(licencaUsuario) {
  const p = galeria.lerPerfil(CAMINHO_DADOS, licencaUsuario);
  return {
    icone: { existe: !!p.icone.r2Key, url: p.icone.r2Key ? await storage.urlTemporaria(p.icone.r2Key) : null },
    marca: { existe: !!p.marca.r2Key, url: p.marca.r2Key ? await storage.urlTemporaria(p.marca.r2Key) : null },
    cores: galeria.coresEscritorioDaLicenca(galeria.lerEstado(CAMINHO_DADOS), licencaUsuario)
  };
}
app.get('/api/app/perfil', exigirSessaoArquiteto, async (req, res) => {
  try {
    res.json(await perfilComUrls(req.licencaUsuario));
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});
function rotaEnviarPerfil(tipo) {
  return async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado.' });
      if (!req.file.buffer.subarray(0, 8).equals(ASSINATURA_PNG)) return res.status(400).json({ erro: 'Envie o arquivo como PNG.' });
      const chave = chaveDoPerfil(req.licencaUsuario, tipo);
      await storage.salvarArquivo(chave, req.file.buffer, 'image/png');
      const antiga = galeria.definirArquivoPerfil(CAMINHO_DADOS, req.licencaUsuario, tipo, chave);
      if (antiga) { try { await storage.excluirArquivo(antiga); } catch (e) { console.error('Aviso: falhou excluir o arquivo antigo do perfil:', e.message); } }
      res.json({ ok: true, perfil: await perfilComUrls(req.licencaUsuario) });
    } catch (e) {
      res.status(400).json({ erro: e.message });
    }
  };
}
function rotaRemoverPerfil(tipo) {
  return async (req, res) => {
    try {
      const antiga = galeria.removerArquivoPerfil(CAMINHO_DADOS, req.licencaUsuario, tipo);
      if (antiga) { try { await storage.excluirArquivo(antiga); } catch (e) { console.error('Aviso: falhou excluir o arquivo do perfil:', e.message); } }
      res.json({ ok: true, perfil: await perfilComUrls(req.licencaUsuario) });
    } catch (e) {
      res.status(400).json({ erro: e.message });
    }
  };
}
// Nome e contatos do escritório (nome no "Projeto por:" do PDF das imagens; WhatsApp/e-mail/Instagram no rodapé e no balão de
// ajuda da Pasta do Cliente). Chamado pelo app ao salvar as Configurações. O que não vier na chamada fica como está (app antigo
// só manda o nome).
app.put('/api/app/perfil/nome', exigirSessaoArquiteto, (req, res) => {
  try {
    const { nome, whatsapp, email, instagram } = req.body || {};
    const r = galeria.definirDadosEscritorio(CAMINHO_DADOS, req.licencaUsuario, { nome, whatsapp, email, instagram });
    res.json({ ok: true, nomeEscritorio: r.nomeEscritorio, contatos: r.contatos });
  } catch (e) { res.status(400).json({ erro: e.message }); }
});
// Cor de destaque do site do cliente (vale pra todos os projetos da conta). `destaque` vazio/nulo = volta ao visual padrão.
app.put('/api/app/perfil/cores', exigirSessaoArquiteto, (req, res) => {
  try {
    const { destaque, modelo } = req.body || {};
    const cores = galeria.definirCoresEscritorio(CAMINHO_DADOS, req.licencaUsuario, { destaque, modelo });
    res.json({ ok: true, cores });
  } catch (e) { res.status(400).json({ erro: e.message }); }
});
app.post('/api/app/perfil/icone', exigirSessaoArquiteto, upload.single('arquivo'), rotaEnviarPerfil('icone'));
app.post('/api/app/perfil/marca', exigirSessaoArquiteto, upload.single('arquivo'), rotaEnviarPerfil('marca'));
app.delete('/api/app/perfil/icone', exigirSessaoArquiteto, rotaRemoverPerfil('icone'));
app.delete('/api/app/perfil/marca', exigirSessaoArquiteto, rotaRemoverPerfil('marca'));

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
    const { plantaId, x, y, angulo } = req.body || {};
    const foto = galeria.posicionarFotoNaPlanta(CAMINHO_DADOS, req.params.projetoId, req.params.fotoId, { plantaId, x, y, angulo }, req.licencaUsuario);
    res.json({ ok: true, foto: { id: foto.id, plantaId: foto.plantaId, pinPlanta: foto.pinPlanta } });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

// Direção da câmera (o "leque" na planta): só o ângulo, em graus (0 = pra cima, horário). `angulo: null` tira o leque.
app.put('/api/app/galeria/:projetoId/fotos/:fotoId/direcao', exigirSessaoArquiteto, (req, res) => {
  try {
    if (!req.body || !('angulo' in req.body)) return res.status(400).json({ erro: 'Informe o ângulo (ou null pra tirar a direção).' });
    const foto = galeria.direcionarFotoNaPlanta(CAMINHO_DADOS, req.params.projetoId, req.params.fotoId, { angulo: req.body.angulo }, req.licencaUsuario);
    res.json({ ok: true, foto: { id: foto.id, plantaId: foto.plantaId, pinPlanta: foto.pinPlanta } });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

// Leve, só pro selinho de "novo comentário" no botão -- não busca URLs.
app.get('/api/app/status/:projetoId', exigirSessaoArquiteto, (req, res) => {
  const g = galeria.buscarGaleriaPorProjeto(CAMINHO_DADOS, req.params.projetoId);
  if (g && g.licencaUsuario !== req.licencaUsuario) return res.status(404).json({ existe: false, temComentarioNaoLido: false });
  // O selo do app acende também quando o cliente mexeu num orçamento (status/comentário).
  res.json({ existe: !!g, temComentarioNaoLido: g ? (g.temComentarioNaoLido || g.orcamentos.temNovidadeNaoLida) : false });
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

// --------------------------------------------------------------------
// HUB DO CLIENTE (nov/2026): dados do projeto, links externos e documentos (links do Google Drive).
// Toda rota confere POSSE pela licença da sessão (dentro de lib/hub.js, via exigirGaleriaDaLicenca).
// Quem vira ANTIGA é sempre decidido pelo app (substituirIds) depois de mostrar a prévia ao arquiteto.
// --------------------------------------------------------------------
app.put('/api/app/galeria/:projetoId/hub', exigirSessaoArquiteto, exigirRecurso('paginaProjeto'), (req, res) => {
  try {
    const { dadosProjeto, links, gruposExecutivo, capaFotoId, ordemGrupos } = req.body || {};
    const hub = hubLib.atualizarHub(CAMINHO_DADOS, req.params.projetoId, { dadosProjeto, links, gruposExecutivo, capaFotoId, ordemGrupos }, req.licencaUsuario);
    res.json({ ok: true, hub: { ...hub, gruposExecutivo: hubLib.gruposDoExecutivo(hub) } });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

// POST (e não GET) só pra mandar os campos no corpo; não grava nada.
app.post('/api/app/galeria/:projetoId/documentos/previa', exigirSessaoArquiteto, exigirRecurso('paginaProjeto'), (req, res) => {
  try {
    res.json({ ok: true, ...hubLib.preverSubstituicao(CAMINHO_DADOS, req.params.projetoId, req.body || {}, req.licencaUsuario) });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

app.post('/api/app/galeria/:projetoId/documentos', exigirSessaoArquiteto, exigirRecurso('paginaProjeto'), (req, res) => {
  try {
    const r = hubLib.adicionarDocumento(CAMINHO_DADOS, req.params.projetoId, req.body || {}, req.licencaUsuario);
    res.json({ ok: true, documento: r.documento, substituidos: r.substituidos });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

app.put('/api/app/galeria/:projetoId/documentos/:docId', exigirSessaoArquiteto, exigirRecurso('paginaProjeto'), (req, res) => {
  try {
    const r = hubLib.editarDocumento(CAMINHO_DADOS, req.params.projetoId, req.params.docId, req.body || {}, req.licencaUsuario);
    res.json({ ok: true, documento: r.documento, substituidos: r.substituidos });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

// Ordem manual dos documentos (▲▼ no app): recebe os ids na ordem desejada.
app.put('/api/app/galeria/:projetoId/documentos-ordem', exigirSessaoArquiteto, exigirRecurso('paginaProjeto'), (req, res) => {
  try {
    const ordem = hubLib.ordenarDocumentos(CAMINHO_DADOS, req.params.projetoId, (req.body || {}).ids, req.licencaUsuario);
    res.json({ ok: true, ordem });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

app.delete('/api/app/galeria/:projetoId/documentos/:docId', exigirSessaoArquiteto, exigirRecurso('paginaProjeto'), (req, res) => {
  try {
    hubLib.excluirDocumento(CAMINHO_DADOS, req.params.projetoId, req.params.docId, req.licencaUsuario);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

// --------------------------------------------------------------------
// PASTA DE ORÇAMENTOS -- lado do ARQUITETO (nov/2026): login/senha/link próprios, itens com valor, comentários e a lista
// de novidades (o cliente mudou um status / comentou). Posse conferida em lib/orcamentos.js (exigirGaleriaDaLicenca).
// --------------------------------------------------------------------
const rotaOrc = (fn) => (req, res) => {
  try { res.json(Object.assign({ ok: true }, fn(req))); } catch (e) { res.status(400).json({ erro: e.message }); }
};
const baseOrc = (req) => [CAMINHO_DADOS, req.params.projetoId];

app.get('/api/app/galeria/:projetoId/orcamentos', exigirSessaoArquiteto, exigirRecurso('orcamentos'), rotaOrc((req) => orcLib.lerParaArquiteto(...baseOrc(req), req.licencaUsuario)));
app.put('/api/app/galeria/:projetoId/orcamentos/acesso', exigirSessaoArquiteto, exigirRecurso('orcamentos'), rotaOrc((req) => ({ acesso: orcLib.definirAcesso(...baseOrc(req), req.body || {}, req.licencaUsuario) })));
app.put('/api/app/galeria/:projetoId/orcamentos/ordem', exigirSessaoArquiteto, exigirRecurso('orcamentos'), rotaOrc((req) => { orcLib.reordenarItens(...baseOrc(req), (req.body || {}).ids, req.licencaUsuario); return {}; }));
app.post('/api/app/galeria/:projetoId/orcamentos/itens', exigirSessaoArquiteto, exigirRecurso('orcamentos'), rotaOrc((req) => ({ item: orcLib.adicionarItem(...baseOrc(req), req.body || {}, req.licencaUsuario) })));
app.put('/api/app/galeria/:projetoId/orcamentos/itens/:itemId', exigirSessaoArquiteto, exigirRecurso('orcamentos'), rotaOrc((req) => ({ item: orcLib.editarItem(...baseOrc(req), req.params.itemId, req.body || {}, req.licencaUsuario) })));
app.delete('/api/app/galeria/:projetoId/orcamentos/itens/:itemId', exigirSessaoArquiteto, exigirRecurso('orcamentos'), rotaOrc((req) => { orcLib.excluirItem(...baseOrc(req), req.params.itemId, req.licencaUsuario); return {}; }));
app.post('/api/app/galeria/:projetoId/orcamentos/itens/:itemId/comentarios', exigirSessaoArquiteto, exigirRecurso('orcamentos'), rotaOrc((req) => ({ comentario: orcLib.comentarComoArquiteto(...baseOrc(req), req.params.itemId, (req.body || {}).texto, req.licencaUsuario) })));
app.put('/api/app/galeria/:projetoId/orcamentos/itens/:itemId/comentarios/:comId', exigirSessaoArquiteto, exigirRecurso('orcamentos'), rotaOrc((req) => ({ comentario: orcLib.editarComentarioDoArquiteto(...baseOrc(req), req.params.itemId, req.params.comId, (req.body || {}).texto, req.licencaUsuario) })));
app.delete('/api/app/galeria/:projetoId/orcamentos/itens/:itemId/comentarios/:comId', exigirSessaoArquiteto, exigirRecurso('orcamentos'), rotaOrc((req) => { orcLib.excluirComentarioDoArquiteto(...baseOrc(req), req.params.itemId, req.params.comId, req.licencaUsuario); return {}; }));
app.post('/api/app/galeria/:projetoId/orcamentos/marcar-lido', exigirSessaoArquiteto, exigirRecurso('orcamentos'), rotaOrc((req) => { orcLib.marcarNovidadesLidas(...baseOrc(req), req.licencaUsuario); return {}; }));

// --------------------------------------------------------------------
// MEMORIAL DE ITENS -- lado do ARQUITETO (nov/2026): tabela por setor com foto do produto e valor. Recurso `memorial`.
// A foto vem do app já reduzida (~800 px, WebP); aqui só se confere tipo/tamanho/limite, grava e troca a antiga.
// Posse conferida em lib/memorial.js (exigirGaleriaDaLicenca).
// --------------------------------------------------------------------
const comUrlDaFoto = async (item) => ({ ...item, fotoUrl: item.fotoR2Key ? await storage.urlTemporaria(item.fotoR2Key) : null });
const apagarDoArmazenamento = async (chave) => { if (chave) { try { await storage.excluirArquivo(chave); } catch (e) { console.error('Aviso: falhou excluir do armazenamento:', e.message); } } };

app.get('/api/app/galeria/:projetoId/memorial', exigirSessaoArquiteto, exigirRecurso('memorial'), async (req, res) => {
  try {
    const r = memLib.lerParaArquiteto(CAMINHO_DADOS, req.params.projetoId, req.licencaUsuario);
    res.json({ ok: true, ...r, itens: await Promise.all(r.itens.map(comUrlDaFoto)) });
  } catch (e) { res.status(400).json({ erro: e.message }); }
});
// Setores do memorial (criar, renomear, excluir -- só vazio): devolve a lista nova.
app.post('/api/app/galeria/:projetoId/memorial/setores', exigirSessaoArquiteto, exigirRecurso('memorial'), (req, res) => {
  try { res.json({ ok: true, setores: memLib.adicionarSetor(CAMINHO_DADOS, req.params.projetoId, (req.body || {}).nome, req.licencaUsuario) }); }
  catch (e) { res.status(400).json({ erro: e.message }); }
});
app.post('/api/app/galeria/:projetoId/memorial/setores/renomear', exigirSessaoArquiteto, exigirRecurso('memorial'), (req, res) => {
  try { res.json({ ok: true, setores: memLib.renomearSetor(CAMINHO_DADOS, req.params.projetoId, (req.body || {}).de, (req.body || {}).para, req.licencaUsuario) }); }
  catch (e) { res.status(400).json({ erro: e.message }); }
});
app.post('/api/app/galeria/:projetoId/memorial/setores/excluir', exigirSessaoArquiteto, exigirRecurso('memorial'), (req, res) => {
  try { res.json({ ok: true, setores: memLib.excluirSetor(CAMINHO_DADOS, req.params.projetoId, (req.body || {}).nome, req.licencaUsuario) }); }
  catch (e) { res.status(400).json({ erro: e.message }); }
});
app.post('/api/app/galeria/:projetoId/memorial/itens', exigirSessaoArquiteto, exigirRecurso('memorial'), async (req, res) => {
  try { res.json({ ok: true, item: await comUrlDaFoto(memLib.adicionarItem(CAMINHO_DADOS, req.params.projetoId, req.body || {}, req.licencaUsuario)) }); }
  catch (e) { res.status(400).json({ erro: e.message }); }
});
app.put('/api/app/galeria/:projetoId/memorial/itens/:itemId', exigirSessaoArquiteto, exigirRecurso('memorial'), async (req, res) => {
  try { res.json({ ok: true, item: await comUrlDaFoto(memLib.editarItem(CAMINHO_DADOS, req.params.projetoId, req.params.itemId, req.body || {}, req.licencaUsuario)) }); }
  catch (e) { res.status(400).json({ erro: e.message }); }
});
app.delete('/api/app/galeria/:projetoId/memorial/itens/:itemId', exigirSessaoArquiteto, exigirRecurso('memorial'), async (req, res) => {
  try {
    const chave = memLib.excluirItem(CAMINHO_DADOS, req.params.projetoId, req.params.itemId, req.licencaUsuario);
    await apagarDoArmazenamento(chave);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ erro: e.message }); }
});
app.post('/api/app/galeria/:projetoId/memorial/itens/:itemId/foto', exigirSessaoArquiteto, exigirRecurso('memorial'), upload.single('arquivo'), async (req, res) => {
  let chave = null;
  try {
    if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado.' });
    const extensao = memLib.TIPOS_FOTO[req.file.mimetype];
    if (!extensao) return res.status(400).json({ erro: 'Envie a foto como WebP, JPG ou PNG.' });
    if (req.file.size > memLib.LIMITE_BYTES_FOTO) return res.status(400).json({ erro: 'A foto do produto está grande demais (o app reduz sozinho; tente outra imagem).' });
    memLib.conferirPodeReceberFoto(CAMINHO_DADOS, req.params.projetoId, req.params.itemId, req.licencaUsuario); // limite/posse ANTES de gravar (sem arquivo órfão)
    chave = `${req.params.projetoId}/memorial-${crypto.randomUUID()}.${extensao}`;
    await storage.salvarArquivo(chave, req.file.buffer, req.file.mimetype);
    const { item, r2KeyAntiga } = memLib.definirFoto(CAMINHO_DADOS, req.params.projetoId, req.params.itemId, chave, req.licencaUsuario);
    await apagarDoArmazenamento(r2KeyAntiga);
    res.json({ ok: true, item: await comUrlDaFoto(item) });
  } catch (e) {
    await apagarDoArmazenamento(chave);
    res.status(400).json({ erro: e.message });
  }
});
app.delete('/api/app/galeria/:projetoId/memorial/itens/:itemId/foto', exigirSessaoArquiteto, exigirRecurso('memorial'), async (req, res) => {
  try {
    const { item, r2KeyAntiga } = memLib.definirFoto(CAMINHO_DADOS, req.params.projetoId, req.params.itemId, null, req.licencaUsuario);
    await apagarDoArmazenamento(r2KeyAntiga);
    res.json({ ok: true, item: await comUrlDaFoto(item) });
  } catch (e) { res.status(400).json({ erro: e.message }); }
});

// ====================================================================
// PASTA DE ORÇAMENTOS -- lado do CLIENTE FINAL (página /orcamentos?o=<link>, login próprio). A sessão daqui NÃO abre a
// Pasta Cliente e a de lá NÃO abre isto (listas de sessão separadas, header diferente).
// ====================================================================
app.get('/api/orcamentos/:linkToken/info-publica', async (req, res) => {
  const g = await orcamentosDisponiveis(req.params.linkToken);
  if (!g) {
    if (await orcamentosVencidos(req.params.linkToken)) return res.status(403).json({ erro: MSG_PASTA_INDISPONIVEL, indisponivel: true });
    return res.status(404).json({ erro: 'Link não encontrado.' });
  }
  let iconeUrl = null;
  try {
    const pers = galeria.resolverPersonalizacao(galeria.lerEstado(CAMINHO_DADOS), g);
    if (pers.iconeExibir && pers.iconeR2Key) iconeUrl = await storage.urlTemporaria(pers.iconeR2Key);
  } catch (e) { /* sem ícone: a página usa o padrão */ }
  const cores = galeria.coresEscritorioDaLicenca(galeria.lerEstado(CAMINHO_DADOS), g.licencaUsuario);
  res.json({ nomeProjeto: g.nomeProjeto, iconeUrl, cores });
});

app.post('/api/orcamentos/:linkToken/login', limitarPorIP, async (req, res) => {
  const dono = await orcamentosDisponiveis(req.params.linkToken);
  if (!dono) {
    if (await orcamentosVencidos(req.params.linkToken)) return res.status(403).json({ erro: MSG_PASTA_INDISPONIVEL, indisponivel: true });
    return res.status(404).json({ erro: 'Link não encontrado.' });
  }
  try {
    const { usuario, senha } = req.body || {};
    const token = orcLib.loginCliente(CAMINHO_DADOS, req.params.linkToken, usuario, senha);
    registrarAtividade(req, 'orcamentos_login', dono.licencaUsuario, dono.projetoId);
    res.json({ ok: true, token });
  } catch (e) {
    registrarAtividade(req, 'orcamentos_login_falha', dono.licencaUsuario, dono.projetoId);
    res.status(401).json({ erro: e.message });
  }
});

async function exigirSessaoOrcamento(req, res, next) {
  try {
    req.donoOrcamento = await orcamentosDisponiveis(req.params.linkToken);
  } catch (e) { return res.status(500).json({ erro: 'Erro conferindo a licença do escritório.' }); }
  if (!req.donoOrcamento) {
    if (await orcamentosVencidos(req.params.linkToken)) return res.status(403).json({ erro: MSG_PASTA_INDISPONIVEL, indisponivel: true });
    return res.status(403).json({ erro: 'Esta pasta de orçamentos não está disponível no momento.' });
  }
  const token = req.headers['x-orcamento-token'];
  if (!token || !orcLib.validarTokenCliente(CAMINHO_DADOS, req.params.linkToken, token)) {
    return res.status(401).json({ erro: 'Faça login de novo.' });
  }
  next();
}
const rotaOrcCliente = (fn) => (req, res) => {
  try { res.json(Object.assign({ ok: true }, fn(req))); } catch (e) { res.status(400).json({ erro: e.message }); }
};
app.get('/api/orcamentos/:linkToken/itens', exigirSessaoOrcamento, rotaOrcCliente((req) => {
  const lista = orcLib.listarParaCliente(CAMINHO_DADOS, req.params.linkToken);
  const g = req.donoOrcamento; // já conferido ao vivo no middleware
  const estadoPerfil = galeria.lerEstado(CAMINHO_DADOS);
  // nome e contatos do escritório: alimentam o balão de ajuda (atalho do WhatsApp) da página de orçamentos
  return Object.assign(lista, g ? { nomeEscritorio: galeria.nomeEscritorioDaLicenca(estadoPerfil, g.licencaUsuario), contatosEscritorio: galeria.contatosEscritorioDaLicenca(estadoPerfil, g.licencaUsuario), coresEscritorio: galeria.coresEscritorioDaLicenca(estadoPerfil, g.licencaUsuario) } : {});
}));
app.put('/api/orcamentos/:linkToken/itens/:itemId/status', exigirSessaoOrcamento, rotaOrcCliente((req) => orcLib.mudarStatusCliente(CAMINHO_DADOS, req.params.linkToken, req.params.itemId, (req.body || {}).status)));
app.post('/api/orcamentos/:linkToken/itens/:itemId/comentarios', exigirSessaoOrcamento, rotaOrcCliente((req) => ({ comentario: orcLib.comentarCliente(CAMINHO_DADOS, req.params.linkToken, req.params.itemId, (req.body || {}).texto) })));

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
  // `novoVisual`: o dono tem o recurso "Página do projeto" -> a página (inclusive o login) usa o tema claro/escuro novo.
  const cores = galeria.coresEscritorioDaLicenca(galeria.lerEstado(CAMINHO_DADOS), g.licencaUsuario); // cor de destaque da conta: a tela de login já nasce com ela
  const indisponivel = await galeriaIndisponivel(g); // assinatura do escritório vencida: a tela de login avisa e não deixa entrar
  res.json({ nomeProjeto: g.nomeProjeto, iconeUrl, novoVisual: (await recursosDoDono(g)).paginaProjeto === true, cores, indisponivel, ...(indisponivel ? { aviso: MSG_PASTA_INDISPONIVEL } : {}) });
});

app.post('/api/cliente/:linkToken/login', limitarPorIP, async (req, res) => {
  try {
    const donoDoLink = galeria.buscarGaleriaPorLinkToken(CAMINHO_DADOS, req.params.linkToken);
    if (donoDoLink && await galeriaIndisponivel(donoDoLink)) return res.status(403).json({ erro: MSG_PASTA_INDISPONIVEL, indisponivel: true });
  } catch (e) { return res.status(500).json({ erro: 'Erro conferindo a licença do escritório.' }); }
  try {
    const { usuario, senha } = req.body || {};
    const token = galeria.loginCliente(CAMINHO_DADOS, req.params.linkToken, usuario, senha);
    const dono = galeria.buscarGaleriaPorLinkToken(CAMINHO_DADOS, req.params.linkToken);
    if (dono) registrarAtividade(req, 'cliente_login', dono.licencaUsuario, dono.projetoId);
    res.json({ ok: true, token });
  } catch (e) {
    try { const dono = galeria.buscarGaleriaPorLinkToken(CAMINHO_DADOS, req.params.linkToken); if (dono) registrarAtividade(req, 'cliente_login_falha', dono.licencaUsuario, dono.projetoId); } catch (e2) { /* só o registro */ }
    res.status(401).json({ erro: e.message });
  }
});

async function exigirSessaoCliente(req, res, next) {
  try {
    const donoDoLink = galeria.buscarGaleriaPorLinkToken(CAMINHO_DADOS, req.params.linkToken);
    if (donoDoLink && await galeriaIndisponivel(donoDoLink)) return res.status(403).json({ erro: MSG_PASTA_INDISPONIVEL, indisponivel: true });
  } catch (e) { return res.status(500).json({ erro: 'Erro conferindo a licença do escritório.' }); }
  const token = req.headers['x-cliente-token'];
  const sessao = token ? galeria.sessaoCliente(CAMINHO_DADOS, req.params.linkToken, token) : null;
  if (!sessao) return res.status(401).json({ erro: 'Faça login de novo.' });
  req.somenteLeitura = sessao.escritorio === true; // aberta pelo dashboard (modo escritório): só olha
  next();
}
// Aprovar/comentar não valem em modo escritório: o arquiteto nunca registra uma decisão no lugar do cliente.
function exigirQueNaoSejaLeitura(req, res, next) {
  if (req.somenteLeitura) return res.status(403).json({ erro: 'Modo escritório: só visualização (aprovar e comentar são do cliente).' });
  next();
}

// ====================================================================
// APRESENTAÇÃO (lousa do modo escritório): o arquiteto abre a pasta pelo dashboard e apresenta o projeto numa lousa com ponteiro, caneta e anotações.
// Só vale pra sessão de ESCRITÓRIO (nunca pro cliente final). As atas ficam só pro escritório (o cliente nunca as recebe).
// ====================================================================
function exigirEscritorio(req, res, next) {
  if (!req.somenteLeitura) return res.status(403).json({ erro: 'Só o escritório (abrindo a pasta pelo dashboard) usa a apresentação.' });
  next();
}
const STATUS_DRIVE = { 'link-invalido': 400, 'nao-compartilhado': 422, 'grande-demais': 413, demorou: 504 };
// O arquivo (PDF ou imagem) de um documento do hub, buscado no Google Drive pelo servidor (o navegador não lê o Drive direto).
app.get('/api/cliente/:linkToken/apresentar/documento/:docId', exigirSessaoCliente, exigirEscritorio, async (req, res) => {
  try {
    const g = galeria.buscarGaleriaPorLinkToken(CAMINHO_DADOS, req.params.linkToken);
    const doc = g && ((g.hub && g.hub.documentos) || []).find((d) => d.id === req.params.docId);
    if (!doc) return res.status(404).json({ erro: 'Documento não encontrado.' });
    const r = await driveLib.baixar(doc.url, { base: process.env.RENDERIA_DRIVE_URL_BASE || undefined });
    res.setHeader('Content-Type', r.tipo);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(r.buffer);
  } catch (e) {
    res.status(STATUS_DRIVE[e.codigo] || 502).json({ erro: e.message || 'Não consegui buscar o arquivo.', motivo: e.codigo || 'falha' });
  }
});
// Salva a ata da reunião (anotações + prints). Prints chegam como imagens JPEG/PNG em base64; cada uma é conferida pelos bytes.
app.post('/api/cliente/:linkToken/reunioes', exigirSessaoCliente, exigirEscritorio, async (req, res) => {
  const gravados = [];
  try {
    const dados = reunioesLib.validarDados(req.body);
    const g = galeria.buscarGaleriaPorLinkToken(CAMINHO_DADOS, req.params.linkToken);
    if (!g) return res.status(404).json({ erro: 'Link não encontrado.' });
    const brutos = (req.body && Array.isArray(req.body.prints)) ? req.body.prints : [];
    const imagens = brutos.map((p) => {
      const m = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec((p && p.imagem) || '');
      if (!m) throw new Error('Imagem do print inválida (use JPEG ou PNG).');
      const buf = Buffer.from(m[2], 'base64');
      if (!buf.length || buf.length > 6 * 1024 * 1024) throw new Error('Cada print pode ter até 6 MB.');
      const ehPng = buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      const ehJpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
      if (!(ehPng || ehJpg)) throw new Error('O arquivo do print não é uma imagem válida.');
      return { buf, tipo: ehPng ? 'image/png' : 'image/jpeg', ext: ehPng ? 'png' : 'jpg' };
    });
    const pasta = crypto.randomBytes(8).toString('hex');
    const prints = [];
    for (let i = 0; i < imagens.length; i++) {
      const chave = `reunioes/${g.projetoId.replace(/[^A-Za-z0-9_-]/g, '_')}/${pasta}/print-${i + 1}.${imagens[i].ext}`;
      await storage.salvarArquivo(chave, imagens[i].buf, imagens[i].tipo);
      gravados.push(chave);
      prints.push({ rotulo: dados.rotulosDosPrints[i] || `Print ${i + 1}`, r2Key: chave });
    }
    const { reuniao } = reunioesLib.adicionar(CAMINHO_DADOS, req.params.linkToken, dados, prints);
    registrarAtividade(req, 'reuniao_salva', g.licencaUsuario, g.projetoId, `${prints.length} print(s)`);
    res.json({ ok: true, reuniao: { id: reuniao.id, titulo: reuniao.titulo, encerrouEm: reuniao.encerrouEm, prints: prints.length } });
  } catch (e) {
    for (const chave of gravados) { try { await storage.excluirArquivo(chave); } catch (e2) { /* sobra de arquivo é só lixo */ } }
    res.status(400).json({ erro: e.message });
  }
});

app.get('/api/cliente/:linkToken/galeria', exigirSessaoCliente, async (req, res) => {
  try {
    let g = galeria.buscarGaleriaPorLinkToken(CAMINHO_DADOS, req.params.linkToken);
    if (!g) return res.status(404).json({ erro: 'Link não encontrado.' });
    if (!req.somenteLeitura) {
      // Cliente de verdade: no primeiro acesso nasce a "foto base" das novidades; cada acesso entra no registro (no máx. 1 a cada 30 min).
      if (galeria.garantirBaseVistoCliente(CAMINHO_DADOS, req.params.linkToken)) g = galeria.buscarGaleriaPorLinkToken(CAMINHO_DADOS, req.params.linkToken);
      registrarAtividade(req, 'cliente_abriu', g.licencaUsuario, g.projetoId);
    }
    const resultado = await galeriaComUrls(g);
    resultado.fotos = resultado.fotos.filter((f) => !f.arquivada); // cliente nunca vê arquivadas
    delete resultado.meta; // etiquetas do dashboard (arquitetos etc.) são do escritório
    // Controle interno de avisos (quem o escritório já avisou sobre cada documento) é SÓ do escritório: nunca sai pro cliente final.
    if (resultado.hub && Array.isArray(resultado.hub.documentos)) resultado.hub = { ...resultado.hub, documentos: resultado.hub.documentos.map(({ controleInterno, ...doc }) => doc) };
    delete resultado.vistoCliente;
    resultado.novidadesCliente = galeria.novidadesDoCliente(g); // bolinhas: o que mudou desde que o CLIENTE abriu cada aba (o escritório vê o mesmo, só lendo)
    if (req.somenteLeitura) resultado.modoEscritorio = true;
    res.json(resultado);
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// O cliente abriu uma aba (Projeto executivo, Memorial...): a bolinha dela some. Em modo escritório não grava nada.
app.post('/api/cliente/:linkToken/visto', exigirSessaoCliente, (req, res) => {
  if (req.somenteLeitura) return res.json({ ok: true, ignorado: true });
  try { galeria.marcarVistoCliente(CAMINHO_DADOS, req.params.linkToken, (req.body || {}).secao); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ erro: e.message }); }
});

app.post('/api/cliente/:linkToken/fotos/:fotoId/comentar', exigirSessaoCliente, exigirQueNaoSejaLeitura, async (req, res) => {
  try {
    const { texto, desenhoDataUrl } = req.body || {};
    let desenhoR2Key = null;
    if (desenhoDataUrl && desenhoDataUrl.startsWith('data:image/png;base64,')) {
      const buffer = Buffer.from(desenhoDataUrl.split(',')[1], 'base64');
      desenhoR2Key = `${req.params.linkToken}/comentarios/${crypto.randomUUID()}.png`;
      await storage.salvarArquivo(desenhoR2Key, buffer, 'image/png');
    }
    galeria.comentarFoto(CAMINHO_DADOS, req.params.linkToken, req.params.fotoId, { texto, desenhoR2Key });
    const dono = galeria.buscarGaleriaPorLinkToken(CAMINHO_DADOS, req.params.linkToken);
    if (dono) registrarAtividade(req, 'cliente_comentou', dono.licencaUsuario, dono.projetoId);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

app.post('/api/cliente/:linkToken/fotos/:fotoId/aprovar', exigirSessaoCliente, exigirQueNaoSejaLeitura, (req, res) => {
  try {
    const { aprovada } = req.body || {};
    galeria.aprovarFoto(CAMINHO_DADOS, req.params.linkToken, req.params.fotoId, aprovada !== false);
    const dono = galeria.buscarGaleriaPorLinkToken(CAMINHO_DADOS, req.params.linkToken);
    if (dono) registrarAtividade(req, aprovada !== false ? 'cliente_aprovou' : 'cliente_desaprovou', dono.licencaUsuario, dono.projetoId);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

// ====================================================================
// DASHBOARD ONLINE (nov/2026) -- senha mestra por conta, lista de projetos com etiquetas e abertura "modo escritório".
// ====================================================================
const MSG_DASHBOARD_SEM_RECURSO = 'O Dashboard online não está incluído na licença deste escritório no momento.';
const MSG_DASHBOARD_VENCIDO = 'A assinatura deste escritório está vencida. Renove para voltar a acessar o Dashboard online (nada foi apagado).';
const respostaDashboard = (sit) => (sit === 'vencida' ? { erro: MSG_DASHBOARD_VENCIDO, indisponivel: true } : { erro: MSG_DASHBOARD_SEM_RECURSO, recurso: 'paginaProjeto' });
async function exigirSessaoDashboard(req, res, next) {
  const licenca = dashLib.validarSessao(CAMINHO_DADOS, req.params.linkDash, req.headers['x-dashboard-token']);
  if (!licenca) return res.status(401).json({ erro: 'Entre de novo com a senha mestra.' });
  try { const sit = await situacaoDoDashboard(licenca); if (sit !== 'ok') return res.status(403).json(respostaDashboard(sit)); }
  catch (e) { return res.status(500).json({ erro: 'Erro conferindo a licença do escritório.' }); }
  req.licencaConta = licenca;
  next();
}
const rotaDash = (fn) => async (req, res) => {
  try { res.json(Object.assign({ ok: true }, await fn(req))); } catch (e) { res.status(400).json({ erro: e.message }); }
};

app.get('/api/dashboard/:linkDash/info-publica', (req, res) => {
  if (!dashLib.linkExiste(CAMINHO_DADOS, req.params.linkDash)) return res.status(404).json({ erro: 'Link não encontrado.' });
  res.json({ ok: true });
});
app.post('/api/dashboard/:linkDash/login', limitarPorIP, async (req, res) => {
  const dono = dashLib.licencaDoLink(CAMINHO_DADOS, req.params.linkDash);
  try { const sit = dono ? await situacaoDoDashboard(dono) : 'ok'; if (sit !== 'ok') return res.status(403).json(respostaDashboard(sit)); }
  catch (e) { return res.status(500).json({ erro: 'Erro conferindo a licença do escritório.' }); }
  try {
    const token = dashLib.login(CAMINHO_DADOS, req.params.linkDash, (req.body || {}).senha);
    if (dono) registrarAtividade(req, 'dashboard_login', dono, null);
    res.json({ ok: true, token });
  } catch (e) {
    if (dono) registrarAtividade(req, 'dashboard_login_falha', dono, null);
    res.status(401).json({ erro: e.message });
  }
});
app.post('/api/dashboard/:linkDash/sair', exigirSessaoDashboard, rotaDash((req) => { dashLib.sair(CAMINHO_DADOS, req.params.linkDash, req.headers['x-dashboard-token']); return {}; }));
app.get('/api/dashboard/:linkDash/projetos', exigirSessaoDashboard, rotaDash(async (req) => {
  const projetos = await Promise.all(dashLib.listarProjetos(CAMINHO_DADOS, req.licencaConta).map(async ({ capaR2Key, ...p }) => ({ ...p, capaUrl: capaR2Key ? await storage.urlTemporaria(capaR2Key) : null })));
  const perfil = galeria.resolverPersonalizacao(galeria.lerEstado(CAMINHO_DADOS), { licencaUsuario: req.licencaConta });
  const iconeUrl = (perfil.iconeR2Key) ? await storage.urlTemporaria(perfil.iconeR2Key) : null;
  return { projetos, iconeUrl, catalogo: dashLib.catalogoDaConta(CAMINHO_DADOS, req.licencaConta) };
}));
// Listas da conta (arquitetos, tipos, situações): cadastrar um nome novo / remover um que ninguém usa. Valem pra todos os projetos.
app.post('/api/dashboard/:linkDash/catalogo', exigirSessaoDashboard, rotaDash((req) => dashLib.adicionarAoCatalogo(CAMINHO_DADOS, req.licencaConta, (req.body || {}).lista, (req.body || {}).nome)));
app.post('/api/dashboard/:linkDash/catalogo/remover', exigirSessaoDashboard, rotaDash((req) => dashLib.removerDoCatalogo(CAMINHO_DADOS, req.licencaConta, (req.body || {}).lista, (req.body || {}).chave)));
app.put('/api/dashboard/:linkDash/projetos/:projetoId/meta', exigirSessaoDashboard, rotaDash((req) => ({ meta: dashLib.definirMeta(CAMINHO_DADOS, req.licencaConta, req.params.projetoId, req.body || {}) })));
app.post('/api/dashboard/:linkDash/projetos/:projetoId/abrir', exigirSessaoDashboard, rotaDash((req) => {
  const r = dashLib.abrirComoEscritorio(CAMINHO_DADOS, req.licencaConta, req.params.projetoId);
  registrarAtividade(req, 'escritorio_abriu', req.licencaConta, req.params.projetoId);
  return r;
}));

// Lado do ARQUITETO (app): senha mestra, link e etiquetas. Recurso da licença: o mesmo da Página do projeto (nível Completo).
app.get('/api/app/dashboard', exigirSessaoArquiteto, exigirRecurso('paginaProjeto'), rotaDash((req) => dashLib.infoDaConta(CAMINHO_DADOS, req.licencaUsuario)));
app.put('/api/app/dashboard/senha', exigirSessaoArquiteto, exigirRecurso('paginaProjeto'), rotaDash((req) => {
  const r = dashLib.definirSenha(CAMINHO_DADOS, req.licencaUsuario, (req.body || {}).senha);
  registrarAtividade(req, 'dashboard_senha_trocada', req.licencaUsuario, null);
  return r;
}));

// ====================================================================
// EXCLUIR A PASTA DO CLIENTE INTEIRA (LGPD: eliminação) e REGISTRO DE ATIVIDADES -- só o dono (posse pela sessão).
// Exclusão: confirmação pelo NOME do projeto (o app pede pra digitar), backup na hora (por segurança: fica 60 dias), apaga TODOS os
// arquivos do projeto no armazenamento e só então o cadastro. Se algum arquivo não puder ser apagado, nada é removido e dá pra tentar de novo.
// ====================================================================
app.delete('/api/app/galeria/:projetoId', exigirSessaoArquiteto, async (req, res) => {
  try {
    const { nomeProjeto, chaves } = galeria.chavesDoProjeto(CAMINHO_DADOS, req.params.projetoId, req.licencaUsuario);
    const confirmacao = String((req.body || {}).confirmacao || '').trim().toLowerCase();
    if (!confirmacao || confirmacao !== String(nomeProjeto).trim().toLowerCase()) return res.status(400).json({ erro: 'A confirmação não confere com o nome do projeto. Nada foi excluído.' });
    try { await backup.criarAgora(CAMINHO_DADOS, 'antes-de-excluir'); } catch (e) { console.error('Backup antes de excluir FALHOU:', e.message); }
    const falhas = [];
    for (const chave of chaves) { try { await storage.excluirArquivo(chave); } catch (e) { falhas.push(chave); } }
    if (falhas.length) return res.status(502).json({ erro: `${falhas.length} de ${chaves.length} arquivos não puderam ser apagados agora. Nada foi removido do cadastro: tente de novo em alguns minutos.` });
    galeria.removerGaleria(CAMINHO_DADOS, req.params.projetoId, req.licencaUsuario);
    atividades.apagarDoProjeto(CAMINHO_DADOS, req.licencaUsuario, req.params.projetoId);
    registrarAtividade(req, 'pasta_excluida', req.licencaUsuario, null, nomeProjeto);
    res.json({ ok: true, arquivosApagados: chaves.length });
  } catch (e) { res.status(400).json({ erro: e.message }); }
});

// Lista as Pastas do Cliente da CONTA (todas as da licença, de qualquer computador da equipe). O app compara com os projetos que tem e mostra as
// que ficaram SEM projeto na lista daquele computador (ex.: projeto removido do app, ou criado em outro computador). Só dados de identificação e
// tamanho: nunca link, senha, nem conteúdo. Qualquer nível de licença (é manutenção da própria conta, não um recurso).
app.get('/api/app/galerias', exigirSessaoArquiteto, (req, res) => {
  try {
    const estado = galeria.lerEstado(CAMINHO_DADOS);
    const galerias = estado.galerias.filter((g) => g.licencaUsuario === req.licencaUsuario).map((g) => ({
      projetoId: g.projetoId, nomeProjeto: g.nomeProjeto, criadoEm: g.criadoEm || null, atualizadoEm: g.atualizadoEm || null,
      nFotos: (g.fotos || []).length, nPlantas: (g.plantas || []).length, nDocumentos: ((g.hub && g.hub.documentos) || []).length
    }));
    res.json({ ok: true, galerias });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// Registro de atividades: com ?projetoId = daquele projeto; sem = da conta (acessos ao dashboard, exclusões). Só o que é da PRÓPRIA conta.
app.get('/api/app/atividades', exigirSessaoArquiteto, (req, res) => {
  res.json({ ok: true, atividades: atividades.listar(CAMINHO_DADOS, { licenca: req.licencaUsuario, projetoId: req.query.projetoId || null, limite: req.query.limite }) });
});
app.get('/api/app/dashboard/projetos', exigirSessaoArquiteto, exigirRecurso('paginaProjeto'), rotaDash((req) => ({
  projetos: dashLib.listarProjetos(CAMINHO_DADOS, req.licencaUsuario).map(({ projetoId, nome, meta }) => ({ projetoId, nome, meta })),
  catalogo: dashLib.catalogoDaConta(CAMINHO_DADOS, req.licencaUsuario)
})));
app.post('/api/app/dashboard/catalogo', exigirSessaoArquiteto, exigirRecurso('paginaProjeto'), rotaDash((req) => dashLib.adicionarAoCatalogo(CAMINHO_DADOS, req.licencaUsuario, (req.body || {}).lista, (req.body || {}).nome)));
app.post('/api/app/dashboard/catalogo/remover', exigirSessaoArquiteto, exigirRecurso('paginaProjeto'), rotaDash((req) => dashLib.removerDoCatalogo(CAMINHO_DADOS, req.licencaUsuario, (req.body || {}).lista, (req.body || {}).chave)));
app.put('/api/app/galeria/:projetoId/meta', exigirSessaoArquiteto, exigirRecurso('paginaProjeto'), rotaDash((req) => ({ meta: dashLib.definirMeta(CAMINHO_DADOS, req.licencaUsuario, req.params.projetoId, req.body || {}) })));

app.listen(PORTA, () => console.log(`Servidor da Pasta do Cliente rodando na porta ${PORTA}`));
