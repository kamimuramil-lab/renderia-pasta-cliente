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
  fotosOrdenadas: [], // lista achatada, na ordem, usada pra navegação com setas
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
    // O token dessa sessão SEMPRE fica em memória (senão nem essa visita
    // funcionaria) -- só grava em localStorage (pra continuar valendo da
    // próxima vez que abrir o link) se "lembrar neste dispositivo" estiver marcado.
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

// ---------- Galeria ----------
function mostrarGaleria(galeria) {
  estado.galeria = galeria;
  $('telaLogin').style.display = 'none';
  $('telaGaleria').style.display = 'block';
  $('nomeProjetoGaleria').textContent = galeria.nomeProjeto;
  document.title = `${galeria.nomeProjeto} — RENDERIA`;

  estado.fotosOrdenadas = [...galeria.fotos].sort((a, b) => a.ordem - b.ordem);

  const porTag = new Map();
  estado.fotosOrdenadas.forEach((f) => {
    const chave = f.tag || 'Fotos';
    if (!porTag.has(chave)) porTag.set(chave, []);
    porTag.get(chave).push(f);
  });

  const wrap = $('wrapGaleria');
  if (!estado.fotosOrdenadas.length) {
    wrap.innerHTML = '<div class="vazio-galeria">Ainda não tem nenhuma foto por aqui. Volte em breve!</div>';
    return;
  }

  wrap.innerHTML = Array.from(porTag.entries()).map(([tag, fotos]) => `
    <div class="secao-ambiente">
      <h2>${escapeHtml(tag)}</h2>
      <div class="grid-fotos">
        ${fotos.map((f) => `
          <div class="card-foto" data-foto-id="${f.id}">
            <img src="${f.url}" loading="lazy">
            ${f.tipo === '360' ? '<div class="badge-360">360°</div>' : ''}
            ${f.aprovada ? '<div class="badge-aprovada">✓ Aprovada</div>' : (f.comentarios.length ? '<div class="badge-comentario">💬</div>' : '')}
            <div class="nome-foto">${escapeHtml(f.nomeExibicao)}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');

  wrap.querySelectorAll('[data-foto-id]').forEach((card) => {
    card.addEventListener('click', () => abrirVisualizador(card.dataset.fotoId));
  });
}

function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Visualizador (com navegação e 360°) ----------
function abrirVisualizador(fotoId) {
  const indice = estado.fotosOrdenadas.findIndex((f) => f.id === fotoId);
  if (indice === -1) return;
  estado.indiceAtual = indice;
  // Empurra uma entrada no histórico só pra isso -- assim o botão
  // voltar (do navegador OU do celular) fecha o visualizador em vez de
  // sair do site inteiro. O fechamento de verdade só acontece dentro do
  // "popstate" abaixo, pra ter um único lugar responsável por isso.
  history.pushState({ renderiaVisualizador: true }, '');
  $('visualizador').style.display = 'flex';
  renderizarFotoAtualNoVisualizador();
}

// Chamado pelo botão "X" e pela tecla Esc -- só pede pro navegador voltar
// uma entrada no histórico (o que aciona o "popstate" abaixo, que fecha
// de fato). Se por algum motivo não tiver aquela entrada extra no
// histórico (ex: o visualizador foi aberto de um jeito diferente), fecha
// direto como plano B.
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
document.addEventListener('keydown', (e) => {
  if ($('visualizador').style.display !== 'flex') return;
  if (e.key === 'ArrowLeft') navegarVisualizador(-1);
  else if (e.key === 'ArrowRight') navegarVisualizador(1);
  else if (e.key === 'Escape') pedirFechamentoVisualizador();
});

function navegarVisualizador(delta) {
  const novoIndice = estado.indiceAtual + delta;
  if (novoIndice < 0 || novoIndice >= estado.fotosOrdenadas.length) return;
  estado.indiceAtual = novoIndice;
  renderizarFotoAtualNoVisualizador();
}

function destruirPanoramaSeExistir() {
  if (estado.visualizadorPanorama) {
    estado.visualizadorPanorama.destroy();
    estado.visualizadorPanorama = null;
  }
}

function renderizarFotoAtualNoVisualizador() {
  const foto = estado.fotosOrdenadas[estado.indiceAtual];
  $('nomeFotoVisualizador').textContent = foto.nomeExibicao;
  $('tagFotoVisualizador').textContent = foto.tag || '';
  $('btnAnteriorFoto').disabled = estado.indiceAtual === 0;
  $('btnProximaFoto').disabled = estado.indiceAtual === estado.fotosOrdenadas.length - 1;

  desativarModoDesenho();
  // Desenhar só faz sentido sobre uma imagem estática -- não tem como
  // "sobrepor" um canvas de forma útil num visualizador 360 que gira.
  $('btnAlternarDesenho').style.display = foto.tipo === '360' ? 'none' : 'flex';

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

  renderizarAprovacaoEComentarios(foto);
}

function renderizarAprovacaoEComentarios(foto) {
  $('btnAprovarFoto').classList.toggle('aprovada', !!foto.aprovada);
  $('textoBtnAprovar').textContent = foto.aprovada ? 'Aprovada!' : 'Aprovar essa imagem';

  const lista = $('listaComentariosFoto');
  if (!foto.comentarios.length) {
    lista.innerHTML = '';
  } else {
    lista.innerHTML = foto.comentarios.map((c) => `
      <div class="comentario-item">
        ${c.desenhoUrl ? `<img src="${c.desenhoUrl}" class="miniatura-desenho-comentario">` : ''}
        ${escapeHtml(c.texto || (c.desenhoUrl ? '(alteração desenhada na imagem)' : ''))}
      </div>
    `).join('');
  }
  $('inputComentario').value = '';
}

// Atualiza o selinho no card da grade (aprovada OU comentário, nunca os
// dois) sem precisar recarregar a página inteira -- chamado depois de
// aprovar/desaprovar e depois de comentar.
function atualizarSeloNaGrade(foto) {
  const card = document.querySelector(`.card-foto[data-foto-id="${foto.id}"]`);
  if (!card) return;
  const existente = card.querySelector('.badge-aprovada, .badge-comentario');
  if (existente) existente.remove();
  if (foto.aprovada) {
    card.insertAdjacentHTML('afterbegin', '<div class="badge-aprovada">✓ Aprovada</div>');
  } else if (foto.comentarios.length) {
    card.insertAdjacentHTML('afterbegin', '<div class="badge-comentario">💬</div>');
  }
}

$('btnAprovarFoto').addEventListener('click', async () => {
  const foto = estado.fotosOrdenadas[estado.indiceAtual];
  const novoValor = !foto.aprovada;
  try {
    await chamarAPI(`/api/cliente/${LINK_TOKEN}/fotos/${foto.id}/aprovar`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ aprovada: novoValor })
    });
    foto.aprovada = novoValor;
    renderizarAprovacaoEComentarios(foto);
    atualizarSeloNaGrade(foto);
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
  const foto = estado.fotosOrdenadas[estado.indiceAtual];
  try {
    const corpo = { texto: texto || null };
    if (estado.temTraco) corpo.desenhoDataUrl = $('canvasDesenho').toDataURL('image/png');
    await chamarAPI(`/api/cliente/${LINK_TOKEN}/fotos/${foto.id}/comentar`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo)
    });
    foto.comentarios.push({ texto, criadoEm: new Date().toISOString() });
    renderizarAprovacaoEComentarios(foto);
    atualizarSeloNaGrade(foto);
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
  const canvas = $('canvasDesenho');
  canvas.width = area.clientWidth;
  canvas.height = area.clientHeight;
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
}

function desativarModoDesenho() {
  estado.desenhoAtivo = false;
  estado.temTraco = false;
  $('canvasDesenho').classList.remove('ativo');
  $('linhaCoresDesenho').style.display = 'none';
  $('btnAlternarDesenho').classList.remove('ativo');
  $('textoBtnDesenho').textContent = 'Solicitar alteração';
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
  const rect = $('canvasDesenho').getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
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
  ctxDesenho.lineWidth = 4;
  ctxDesenho.lineCap = 'round';
  ctxDesenho.lineJoin = 'round';
  ctxDesenho.stroke();
});
$('canvasDesenho').addEventListener('pointerup', () => { desenhando = false; });
$('canvasDesenho').addEventListener('pointerleave', () => { desenhando = false; });
window.addEventListener('resize', () => { if (estado.desenhoAtivo) ajustarTamanhoCanvas(); });

// ---------- Início ----------
tentarEntrarComTokenSalvo();
