const $ = (id) => document.getElementById(id);

// ---------- Token do link (da URL) ----------
const params = new URLSearchParams(window.location.search);
const LINK_TOKEN = params.get('g');
const CHAVE_LOCAL = `renderia_cliente_token_${LINK_TOKEN}`;

if (!LINK_TOKEN) {
  document.body.innerHTML = '<div style="padding:60px 24px; text-align:center; color:#9a9ea5; font-family:sans-serif;">Link inválido -- confira se você copiou o endereço completo que recebeu.</div>';
  throw new Error('sem token de link');
}

const estado = {
  galeria: null,
  categoriasOrdenadas: [], // todas as categorias, na ordem, + a virtual "sem categoria" se houver fotos soltas
  indiceCategoriaAtual: -1,
  fotosCategoriaAtual: [], // fotos da categoria aberta agora (pode incluir o mood como 1º item virtual)
  indiceAtual: -1,
  visualizadorPanorama: null,
  tokenClienteAtual: null // token da sessão ATUAL -- sempre usado nas chamadas, independente de estar salvo em localStorage ou não
};

// ---------- Chamadas à API ----------
async function chamarAPI(caminho, opcoes = {}) {
  const resp = await fetch(caminho, Object.assign({}, opcoes, {
    headers: Object.assign({}, opcoes.headers || {}, estado.tokenClienteAtual ? { 'x-cliente-token': estado.tokenClienteAtual } : {})
  }));
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(dados.erro || 'Erro ao falar com o servidor.');
  return dados;
}

// ---------- Login ----------
async function tentarEntrarComTokenSalvo() {
  const token = localStorage.getItem(CHAVE_LOCAL);
  if (!token) return false;
  estado.tokenClienteAtual = token;
  try {
    const galeria = await chamarAPI(`/api/cliente/${LINK_TOKEN}/galeria`);
    mostrarGaleria(galeria);
    return true;
  } catch (e) {
    estado.tokenClienteAtual = null;
    localStorage.removeItem(CHAVE_LOCAL); // token velho/inválido -- limpa e pede login de novo
    return false;
  }
}

$('btnEntrarCliente').addEventListener('click', fazerLogin);
$('inputSenhaCliente').addEventListener('keydown', (e) => { if (e.key === 'Enter') fazerLogin(); });

async function fazerLogin() {
  const usuario = $('inputUsuarioCliente').value.trim();
  const senha = $('inputSenhaCliente').value;
  const msgErro = $('msgErroLogin');
  msgErro.style.display = 'none';
  if (!usuario || !senha) {
    msgErro.textContent = 'Preencha usuário e senha.';
    msgErro.style.display = 'block';
    return;
  }
  $('btnEntrarCliente').disabled = true;
  $('btnEntrarCliente').textContent = 'Entrando...';
  try {
    const resp = await fetch(`/api/cliente/${LINK_TOKEN}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, senha })
    });
    const dados = await resp.json();
    if (!resp.ok) throw new Error(dados.erro || 'Usuário ou senha incorretos.');
    estado.tokenClienteAtual = dados.token;
    if ($('chkLembrarDispositivo').checked) localStorage.setItem(CHAVE_LOCAL, dados.token);
    else localStorage.removeItem(CHAVE_LOCAL);
    const galeria = await chamarAPI(`/api/cliente/${LINK_TOKEN}/galeria`);
    mostrarGaleria(galeria);
  } catch (e) {
    msgErro.textContent = e.message;
    msgErro.style.display = 'block';
  } finally {
    $('btnEntrarCliente').disabled = false;
    $('btnEntrarCliente').textContent = 'Entrar';
  }
}

function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Home: grade de categorias ----------
function mostrarGaleria(galeria) {
  estado.galeria = galeria;
  $('telaLogin').style.display = 'none';
  $('telaGaleria').style.display = 'block';
  $('nomeProjetoGaleria').textContent = galeria.nomeProjeto;
  document.title = `${galeria.nomeProjeto} — RENDERIA`;

  const fotosValidas = galeria.fotos.filter((f) => !f.arquivada);
  const qtdAprovadas = fotosValidas.filter((f) => f.aprovada).length;
  if (fotosValidas.length) {
    $('barraProgressoCliente').style.display = 'block';
    $('preenchimentoProgressoCliente').style.width = `${Math.round((qtdAprovadas / fotosValidas.length) * 100)}%`;
    $('textoProgressoCliente').textContent = `${qtdAprovadas} de ${fotosValidas.length} fotos aprovadas`;
  }

  const categoriasReais = [...(galeria.categorias || [])].sort((a, b) => a.ordem - b.ordem);
  const semCategoria = fotosValidas.filter((f) => !f.categoriaId);

  estado.categoriasOrdenadas = categoriasReais.map((cat) => ({
    id: cat.id,
    nome: cat.nome,
    moodUrl: cat.moodUrl || null,
    fotos: fotosValidas.filter((f) => f.categoriaId === cat.id).sort((a, b) => a.ordem - b.ordem)
  }));
  if (semCategoria.length) {
    estado.categoriasOrdenadas.push({
      id: null,
      nome: 'Outras fotos',
      moodUrl: null,
      fotos: semCategoria.sort((a, b) => a.ordem - b.ordem)
    });
  }

  const wrap = $('wrapGaleria');
  if (!fotosValidas.length) {
    wrap.innerHTML = '<div class="vazio-galeria">Ainda não tem nenhuma foto por aqui. Volte em breve!</div>';
    return;
  }
  if (!estado.categoriasOrdenadas.length) {
    wrap.innerHTML = '<div class="vazio-galeria">As fotos ainda estão sendo organizadas. Volte em breve!</div>';
    return;
  }

  wrap.innerHTML = `<div class="grid-categorias">
    ${estado.categoriasOrdenadas.map((cat, idx) => `
      <div class="card-categoria ${cat.moodUrl ? 'tem-imagem' : ''}" data-categoria-indice="${idx}">
        ${cat.moodUrl ? `<img src="${cat.moodUrl}" loading="lazy">` : ''}
        <div class="nome-categoria-capa">
          ${escapeHtml(cat.nome)}
          <div class="contagem-categoria">${cat.fotos.length} foto${cat.fotos.length === 1 ? '' : 's'}</div>
        </div>
      </div>
    `).join('')}
  </div>`;

  wrap.querySelectorAll('[data-categoria-indice]').forEach((card) => {
    card.addEventListener('click', () => abrirCategoria(parseInt(card.dataset.categoriaIndice, 10)));
  });
}

// ---------- Abrir uma categoria (mood primeiro, se tiver, depois as fotos) ----------
function abrirCategoria(indiceCategoria, opcoes = {}) {
  const cat = estado.categoriasOrdenadas[indiceCategoria];
  if (!cat) return;
  estado.indiceCategoriaAtual = indiceCategoria;
  estado.fotosCategoriaAtual = cat.moodUrl
    ? [{ __ehMood: true, url: cat.moodUrl, nomeExibicao: cat.nome }, ...cat.fotos]
    : [...cat.fotos];
  if (!estado.fotosCategoriaAtual.length) return; // categoria vazia, sem mood -- não tem o que abrir
  estado.indiceAtual = opcoes.noFim ? estado.fotosCategoriaAtual.length - 1 : 0;
  // Só empurra uma entrada NOVA no histórico se ainda não estiver dentro
  // do visualizador -- trocar de categoria (avançar/voltar) não deveria
  // acumular uma entrada de histórico por transição, senão o botão
  // voltar do navegador precisaria de vários cliques só pra fechar.
  if (!(history.state && history.state.renderiaVisualizador)) {
    history.pushState({ renderiaVisualizador: true }, '');
  }
  $('visualizador').style.display = 'flex';
  renderizarFotoAtualNoVisualizador();
}

// ---------- Visualizador ----------
function pedirFechamentoVisualizador() {
  if (history.state && history.state.renderiaVisualizador) {
    history.back();
  } else {
    fecharVisualizadorDeVerdade();
  }
}

window.addEventListener('popstate', () => {
  if ($('visualizador').style.display === 'flex') fecharVisualizadorDeVerdade();
});

$('btnFecharVisualizador').addEventListener('click', pedirFechamentoVisualizador);
function fecharVisualizadorDeVerdade() {
  $('visualizador').style.display = 'none';
  destruirPanoramaSeExistir();
}

$('btnAnteriorFoto').addEventListener('click', () => navegarVisualizador(-1));
$('btnProximaFoto').addEventListener('click', () => navegarVisualizador(1));
$('zonaCliqueAnterior').addEventListener('click', () => navegarVisualizador(-1));
$('zonaCliqueProxima').addEventListener('click', () => navegarVisualizador(1));
document.addEventListener('keydown', (e) => {
  if ($('visualizador').style.display !== 'flex') return;
  if (e.key === 'ArrowLeft') navegarVisualizador(-1);
  else if (e.key === 'ArrowRight') navegarVisualizador(1);
  else if (e.key === 'Escape') pedirFechamentoVisualizador();
});

function navegarVisualizador(delta) {
  const novoIndice = estado.indiceAtual + delta;
  if (novoIndice < 0) {
    // Chegou no início da categoria -- se tiver uma categoria anterior,
    // volta pra ela (caindo na ÚLTIMA foto dela, simétrico ao "avançar").
    const anteriorIndice = estado.indiceCategoriaAtual - 1;
    if (anteriorIndice >= 0) abrirCategoria(anteriorIndice, { noFim: true });
    return;
  }
  if (novoIndice >= estado.fotosCategoriaAtual.length) return; // chegou no fim -- só o botão "próxima categoria" avança daqui
  estado.indiceAtual = novoIndice;
  renderizarFotoAtualNoVisualizador();
}

$('btnProximaCategoria').addEventListener('click', () => {
  const proximoIndice = estado.indiceCategoriaAtual + 1;
  if (proximoIndice >= estado.categoriasOrdenadas.length) { pedirFechamentoVisualizador(); return; }
  abrirCategoria(proximoIndice);
});

function destruirPanoramaSeExistir() {
  if (estado.visualizadorPanorama) {
    estado.visualizadorPanorama.destroy();
    estado.visualizadorPanorama = null;
  }
}

function renderizarFotoAtualNoVisualizador() {
  const foto = estado.fotosCategoriaAtual[estado.indiceAtual];
  const categoriaAtual = estado.categoriasOrdenadas[estado.indiceCategoriaAtual];
  $('categoriaAtualVisualizador').textContent = categoriaAtual ? categoriaAtual.nome : '';
  $('nomeFotoVisualizador').textContent = foto.__ehMood ? '' : foto.nomeExibicao;
  $('btnAnteriorFoto').disabled = estado.indiceAtual === 0 && estado.indiceCategoriaAtual === 0;

  const noUltimoItemDaCategoria = estado.indiceAtual === estado.fotosCategoriaAtual.length - 1;
  const temProximaCategoria = estado.indiceCategoriaAtual < estado.categoriasOrdenadas.length - 1;
  $('btnProximaFoto').style.display = noUltimoItemDaCategoria ? 'none' : 'flex';
  $('btnProximaCategoria').style.display = (noUltimoItemDaCategoria && temProximaCategoria) ? 'block' : 'none';
  if (noUltimoItemDaCategoria && temProximaCategoria) {
    $('nomeProximaCategoria').textContent = estado.categoriasOrdenadas[estado.indiceCategoriaAtual + 1].nome;
  }

  // O "mood" é só uma capa -- não tem comentário/aprovação, é a mesma
  // ideia de uma capa de revista, não uma entrega de verdade.
  $('painelInferiorVisualizador').style.display = foto.__ehMood ? 'none' : 'flex';

  desativarModoDesenho();
  $('btnAlternarDesenho').style.display = (foto.tipo === '360' || foto.__ehMood) ? 'none' : 'flex';

  destruirPanoramaSeExistir();
  if (foto.tipo === '360') {
    $('imgFotoVisualizador').style.display = 'none';
    $('painelPanoramaCliente').style.display = 'block';
    estado.visualizadorPanorama = window.pannellum.viewer('painelPanoramaCliente', {
      type: 'equirectangular',
      panorama: foto.url,
      autoLoad: true,
      showZoomCtrl: true,
      showFullscreenCtrl: false,
      compass: false
    });
  } else {
    $('painelPanoramaCliente').style.display = 'none';
    $('imgFotoVisualizador').style.display = 'block';
    $('imgFotoVisualizador').src = foto.url;
  }

  $('modalHistoricoComentarios').classList.add('hidden');
  if (!foto.__ehMood) renderizarAprovacaoEComentarios(foto);
}

function renderizarAprovacaoEComentarios(foto) {
  $('btnAprovarFoto').classList.toggle('aprovada', !!foto.aprovada);
  $('textoBtnAprovar').textContent = foto.aprovada ? 'Aprovada!' : 'Aprovar essa imagem';

  if (foto.comentarios.length) {
    $('btnVerHistorico').style.display = 'inline-block';
    $('qtdHistoricoComentarios').textContent = foto.comentarios.length;
  } else {
    $('btnVerHistorico').style.display = 'none';
  }
  montarListaComentarios(foto);
  $('inputComentario').value = '';
}

function montarListaComentarios(foto) {
  const lista = $('listaComentariosFoto');
  if (!foto.comentarios.length) {
    lista.innerHTML = '<div class="comentario-item">Nenhuma anotação ainda.</div>';
  } else {
    lista.innerHTML = foto.comentarios.map((c) => `
      <div class="comentario-item">
        ${c.desenhoUrl ? `<img src="${c.desenhoUrl}" class="miniatura-desenho-comentario">` : ''}
        ${escapeHtml(c.texto || (c.desenhoUrl ? '(alteração desenhada na imagem)' : ''))}
      </div>
    `).join('');
  }
}

$('btnVerHistorico').addEventListener('click', () => $('modalHistoricoComentarios').classList.remove('hidden'));
$('btnFecharHistorico').addEventListener('click', () => $('modalHistoricoComentarios').classList.add('hidden'));

function atualizarProgressoGlobal() {
  const fotosValidas = estado.galeria.fotos.filter((f) => !f.arquivada);
  const qtdAprovadas = fotosValidas.filter((f) => f.aprovada).length;
  if (fotosValidas.length) {
    $('preenchimentoProgressoCliente').style.width = `${Math.round((qtdAprovadas / fotosValidas.length) * 100)}%`;
    $('textoProgressoCliente').textContent = `${qtdAprovadas} de ${fotosValidas.length} fotos aprovadas`;
  }
}

$('btnAprovarFoto').addEventListener('click', async () => {
  const foto = estado.fotosCategoriaAtual[estado.indiceAtual];
  const novoValor = !foto.aprovada;
  try {
    await chamarAPI(`/api/cliente/${LINK_TOKEN}/fotos/${foto.id}/aprovar`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ aprovada: novoValor })
    });
    foto.aprovada = novoValor;
    const fotoGlobal = estado.galeria.fotos.find((f) => f.id === foto.id);
    if (fotoGlobal) fotoGlobal.aprovada = novoValor;
    renderizarAprovacaoEComentarios(foto);
    atualizarProgressoGlobal();
  } catch (e) {
    alert('Não consegui salvar: ' + e.message);
  }
});

$('btnEnviarComentario').addEventListener('click', enviarComentario);
$('inputComentario').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviarComentario(); }
});

async function enviarComentario() {
  const texto = $('inputComentario').value.trim();
  if (!texto && !estado.temTraco) return;
  const foto = estado.fotosCategoriaAtual[estado.indiceAtual];
  try {
    const corpo = { texto: texto || null };
    if (estado.temTraco) corpo.desenhoDataUrl = $('canvasDesenho').toDataURL('image/png');
    await chamarAPI(`/api/cliente/${LINK_TOKEN}/fotos/${foto.id}/comentar`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo)
    });
    foto.comentarios.push({ texto, criadoEm: new Date().toISOString() });
    renderizarAprovacaoEComentarios(foto);
    desativarModoDesenho();
  } catch (e) {
    alert('Não consegui enviar o comentário: ' + e.message);
  }
}

// ---------- Caneta de desenho (solicitar alteração) ----------
const ctxDesenho = $('canvasDesenho').getContext('2d');
estado.desenhoAtivo = false;
estado.corCanetaAtual = '#1a1a1a';
estado.temTraco = false;

function ajustarTamanhoCanvas() {
  const area = $('areaImagemVisualizador');
  const img = $('imgFotoVisualizador');
  const canvas = $('canvasDesenho');
  const rect = retanguloImagemRenderizada(img, area);
  // Posiciona o canvas EXATAMENTE em cima da imagem (não do container
  // inteiro) -- com object-fit:contain, a imagem pode não preencher todo
  // o espaço (sobra uma margem dos dois lados ou em cima/embaixo).
  canvas.style.left = rect.left + 'px';
  canvas.style.top = rect.top + 'px';
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';
  // A RESOLUÇÃO interna do canvas usa o tamanho de verdade da imagem
  // original (não o tamanho na tela) -- assim o desenho exportado sempre
  // bate certinho com a foto, não importa o tamanho da janela de quem
  // desenhou. Isso corrige o bug de "a marcação aparece no lugar errado".
  canvas.width = img.naturalWidth || rect.width;
  canvas.height = img.naturalHeight || rect.height;
}

// Calcula onde a imagem REALMENTE aparece dentro do container (com
// object-fit:contain, geralmente sobra uma margem de um dos lados).
function retanguloImagemRenderizada(img, container) {
  const cw = container.clientWidth, ch = container.clientHeight;
  const iw = img.naturalWidth || cw, ih = img.naturalHeight || ch;
  const escalaContainer = cw / ch;
  const escalaImagem = iw / ih;
  let largura, altura, offsetX, offsetY;
  if (escalaImagem > escalaContainer) {
    largura = cw;
    altura = cw / escalaImagem;
    offsetX = 0;
    offsetY = (ch - altura) / 2;
  } else {
    altura = ch;
    largura = ch * escalaImagem;
    offsetY = 0;
    offsetX = (cw - largura) / 2;
  }
  return { left: offsetX, top: offsetY, width: largura, height: altura };
}

$('btnAlternarDesenho').addEventListener('click', () => {
  if (estado.desenhoAtivo) desativarModoDesenho();
  else ativarModoDesenho();
});

function ativarModoDesenho() {
  estado.desenhoAtivo = true;
  ajustarTamanhoCanvas();
  $('canvasDesenho').classList.add('ativo');
  $('linhaCoresDesenho').style.display = 'flex';
  $('btnAlternarDesenho').classList.add('ativo');
  $('textoBtnDesenho').textContent = 'Cancelar alteração';
  $('zonaCliqueAnterior').classList.add('desativada');
  $('zonaCliqueProxima').classList.add('desativada');
}

function desativarModoDesenho() {
  estado.desenhoAtivo = false;
  estado.temTraco = false;
  $('canvasDesenho').classList.remove('ativo');
  $('linhaCoresDesenho').style.display = 'none';
  $('btnAlternarDesenho').classList.remove('ativo');
  $('textoBtnDesenho').textContent = 'Solicitar alteração';
  $('zonaCliqueAnterior').classList.remove('desativada');
  $('zonaCliqueProxima').classList.remove('desativada');
  ctxDesenho.clearRect(0, 0, $('canvasDesenho').width, $('canvasDesenho').height);
}

document.querySelectorAll('.cor-caneta').forEach((botao) => {
  botao.addEventListener('click', () => {
    document.querySelectorAll('.cor-caneta').forEach((b) => b.classList.remove('ativa'));
    botao.classList.add('ativa');
    estado.corCanetaAtual = botao.dataset.cor;
  });
});

$('btnLimparDesenho').addEventListener('click', () => {
  estado.temTraco = false;
  ctxDesenho.clearRect(0, 0, $('canvasDesenho').width, $('canvasDesenho').height);
});

let desenhando = false;
function posicaoNoCanvas(e) {
  const canvas = $('canvasDesenho');
  const rect = canvas.getBoundingClientRect();
  // O canvas é exibido num tamanho (rect.width/height, em pixels de
  // tela) mas sua resolução INTERNA agora é a da imagem original, que
  // costuma ser bem maior -- por isso a conversão de escala aqui.
  const escalaX = canvas.width / rect.width;
  const escalaY = canvas.height / rect.height;
  return { x: (e.clientX - rect.left) * escalaX, y: (e.clientY - rect.top) * escalaY, escalaMedia: (escalaX + escalaY) / 2 };
}
$('canvasDesenho').addEventListener('pointerdown', (e) => {
  if (!estado.desenhoAtivo) return;
  desenhando = true;
  estado.temTraco = true;
  const p = posicaoNoCanvas(e);
  ctxDesenho.beginPath();
  ctxDesenho.moveTo(p.x, p.y);
  $('canvasDesenho').setPointerCapture(e.pointerId);
});
$('canvasDesenho').addEventListener('pointermove', (e) => {
  if (!desenhando) return;
  const p = posicaoNoCanvas(e);
  ctxDesenho.lineTo(p.x, p.y);
  ctxDesenho.strokeStyle = estado.corCanetaAtual;
  // Espessura do traço também escalada -- senão, numa imagem de alta
  // resolução, o traço fica finíssimo (quase invisível) na hora de olhar.
  ctxDesenho.lineWidth = 4 * p.escalaMedia;
  ctxDesenho.lineCap = 'round';
  ctxDesenho.lineJoin = 'round';
  ctxDesenho.stroke();
});
$('canvasDesenho').addEventListener('pointerup', () => { desenhando = false; });
$('canvasDesenho').addEventListener('pointerleave', () => { desenhando = false; });
window.addEventListener('resize', () => { if (estado.desenhoAtivo) ajustarTamanhoCanvas(); });

// ---------- Início ----------
tentarEntrarComTokenSalvo();
