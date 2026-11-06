// planta.js -- tela da PLANTA BAIXA na página do cliente.
//
// O cliente abre a planta primeiro e navega pelos ícones: câmera = imagem
// fixa, pin vermelho = 360°. Cada ícone mostra o status da foto (verde =
// aprovada, laranja = alteração pedida). Posição dos ícones vem do servidor
// em FRAÇÃO da imagem (x, y de 0 a 1), então fica no lugar certo em
// qualquer tamanho de tela e em qualquer zoom.
//
// Carregado ANTES do main.js; usa `estado`, `escapeHtml`, `abrirCategoria`
// e `mostrarTelaGaleriaDaPlanta` do main.js só em tempo de CHAMADA.
(function () {
  const pid = (id) => document.getElementById(id);
  const ZOOM_MIN = 1;
  const ZOOM_MAX = 6;

  const ST = {
    plantaId: null,
    z: 1, tx: 0, ty: 0,        // zoom e deslocamento (px) do palco dentro da área visível
    baseW: 0, baseH: 0,        // tamanho do palco com a planta "encaixada" na área visível (zoom 1)
    movido: false,             // true se o dedo/mouse arrastou (aí o toque NÃO conta como clique no ícone)
    ponteiros: new Map(),
    inicioArraste: null,
    distanciaPinca: 0,
    imgSrcAtual: null
  };

  // Nome pra mostrar ao cliente: o que o arquiteto deu; se vier vazio ou "Sem nome" (envios antigos), um
  // rótulo neutro por tipo -- nunca o texto cru "Sem nome".
  function nomeParaCliente(f) {
    const n = String((f && f.nomeExibicao) || '').trim();
    if (n && n.toLowerCase() !== 'sem nome') return n;
    return f && f.tipo === '360' ? 'Imagem 360°' : 'Imagem';
  }
  window.nomeParaCliente = nomeParaCliente;

  // ---------------------------------------------------------------- dados
  function plantasOrdenadas() {
    return [...((estado.galeria && estado.galeria.plantas) || [])].sort((a, b) => a.ordem - b.ordem);
  }
  function fotoTemIcone(f, idsPlantas) {
    return !f.arquivada && f.plantaId && idsPlantas.has(f.plantaId) && f.pinPlanta
      && Number.isFinite(f.pinPlanta.x) && Number.isFinite(f.pinPlanta.y);
  }
  // A planta só vira a tela inicial se o arquiteto JÁ posicionou algum ícone
  // (planta enviada mas vazia não deve esconder a galeria do cliente).
  function temPlantaUtil(galeria) {
    const ids = new Set(((galeria && galeria.plantas) || []).map((p) => p.id));
    return ((galeria && galeria.fotos) || []).some((f) => fotoTemIcone(f, ids));
  }
  function fotosDaPlanta(plantaId) {
    const ids = new Set([plantaId]);
    return estado.galeria.fotos.filter((f) => f.plantaId === plantaId && fotoTemIcone(f, ids));
  }
  function statusDaFoto(f) {
    if (f.aprovada) return 'aprovada';
    if ((f.comentarios || []).length) return 'alteracao';
    return 'pendente';
  }
  const TEXTO_STATUS = { aprovada: 'aprovada', alteracao: 'alteração solicitada', pendente: 'aguardando sua análise' };

  // ---------------------------------------------------------------- ícones
  const SVG_CAMERA = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>';
  const SVG_PIN360 = '<svg viewBox="0 0 24 30" width="30" height="38"><path d="M12 1C6.5 1 2 5.4 2 10.8c0 7.2 10 18.2 10 18.2s10-11 10-18.2C22 5.4 17.5 1 12 1z" fill="#e5372e" stroke="#fff" stroke-width="1.6"/><circle cx="12" cy="10.8" r="3.6" fill="#fff"/></svg>';

  function htmlPin(f) {
    const eh360 = f.tipo === '360';
    const status = statusDaFoto(f);
    const nome = nomeParaCliente(f);
    const insignia = status === 'aprovada' ? '<span class="pin-insignia aprovada">✓</span>'
      : status === 'alteracao' ? '<span class="pin-insignia alteracao">!</span>' : '';
    // data-x/data-y = fração (0..1) da planta; a posição em pixels sai de posicionarPins().
    // IMPORTANTE: o <img> da prévia PRECISA de crossorigin="anonymous". O visualizador 360 baixa o MESMO arquivo
    // por XHR (que exige CORS); sem esse atributo o navegador guarda a cópia SEM cabeçalho CORS ao passar o mouse
    // no ícone, e o 360 depois falha com "The file ... could not be accessed" (status 0). Bug real de nov/2026.
    // A prévia (data-src) só é baixada quando o mouse/foco chega no ícone -- baixar a imagem de todos
    // os ícones ao abrir a planta seria pesado (principalmente no celular).
    return `<button class="pin-planta ${eh360 ? 'pin-360' : 'pin-fixa'} status-${status}" data-foto-id="${f.id}"
        data-x="${f.pinPlanta.x}" data-y="${f.pinPlanta.y}"
        title="${escapeHtml(nome)} -- ${TEXTO_STATUS[status]}" aria-label="${escapeHtml(nome)}">
        <span class="pin-corpo">${eh360 ? SVG_PIN360 : SVG_CAMERA}</span>${insignia}
        <span class="pin-rotulo">
          ${f.url ? `<img class="pin-rotulo-img" data-src="${escapeHtml(f.url)}" alt="" draggable="false" crossorigin="anonymous">` : ''}
          <span>${escapeHtml(nome)}</span>
        </span>
      </button>`;
  }

  // ---------------------------------------------------------------- zoom / posição
  function areaVisivel() {
    const r = pid('plantaViewport').getBoundingClientRect();
    return { w: r.width, h: r.height, esq: r.left, topo: r.top };
  }
  function limitar(v, mn, mx) { return Math.min(mx, Math.max(mn, v)); }

  function aplicarTransformacao() {
    const v = areaVisivel();
    const sw = ST.baseW * ST.z, sh = ST.baseH * ST.z;
    // Menor que a área visível -> centraliza; maior -> não deixa "sair" da tela.
    ST.tx = sw <= v.w ? (v.w - sw) / 2 : limitar(ST.tx, v.w - sw, 0);
    ST.ty = sh <= v.h ? (v.h - sh) / 2 : limitar(ST.ty, v.h - sh, 0);
    const palco = pid('plantaPalco');
    palco.style.transform = `translate(${ST.tx}px, ${ST.ty}px) scale(${ST.z})`;
    pid('plantaZoomValor').textContent = `${Math.round(ST.z * 100)}%`;
    posicionarPins();
  }

  // Os ícones NÃO ficam dentro do bloco que recebe zoom (aí o navegador amplia a "foto" deles e ficam
  // borrados). Ficam numa camada por cima, sem escala, e a posição de cada um em pixels é calculada aqui
  // a partir da posição (fração) na planta, do zoom e do deslocamento -- sempre nítidos, em qualquer zoom.
  function posicionarPins() {
    pid('plantaPins').querySelectorAll('.pin-planta').forEach((el) => {
      el.style.left = `${ST.tx + parseFloat(el.dataset.x) * ST.baseW * ST.z}px`;
      el.style.top = `${ST.ty + parseFloat(el.dataset.y) * ST.baseH * ST.z}px`;
    });
  }

  // Encaixa a planta inteira na área visível (zoom 1) -- sem cortar nada.
  function ajustarAoVisor() {
    const img = pid('imgPlanta');
    if (!img.naturalWidth) return;
    const v = areaVisivel();
    if (!v.w || !v.h) return;
    const escala = Math.min(v.w / img.naturalWidth, v.h / img.naturalHeight);
    ST.baseW = img.naturalWidth * escala;
    ST.baseH = img.naturalHeight * escala;
    const palco = pid('plantaPalco');
    palco.style.width = `${ST.baseW}px`;
    palco.style.height = `${ST.baseH}px`;
    aplicarTransformacao();
  }

  function zoomEm(fator, cx, cy) {
    const v = areaVisivel();
    if (cx === undefined) { cx = v.w / 2; cy = v.h / 2; } // centro da área visível
    const novoZ = limitar(ST.z * fator, ZOOM_MIN, ZOOM_MAX);
    const razao = novoZ / ST.z;
    ST.tx = cx - (cx - ST.tx) * razao;
    ST.ty = cy - (cy - ST.ty) * razao;
    ST.z = novoZ;
    aplicarTransformacao();
  }
  function resetarZoom() { ST.z = 1; ST.tx = 0; ST.ty = 0; aplicarTransformacao(); }

  // ---------------------------------------------------------------- desenho
  function desenharPins() {
    const caixa = pid('plantaPins');
    const fotos = fotosDaPlanta(ST.plantaId);
    caixa.innerHTML = fotos.map(htmlPin).join('');
    caixa.querySelectorAll('.pin-planta').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (ST.movido) { ST.movido = false; return; } // foi um arrasto, não um toque
        abrirFotoPeloId(el.dataset.fotoId);
      });
    });
    caixa.querySelectorAll('.pin-planta').forEach((el) => {
      const carregarPrevia = () => {
        const img = el.querySelector('.pin-rotulo-img');
        if (img && !img.getAttribute('src')) img.setAttribute('src', img.dataset.src);
      };
      el.addEventListener('mouseenter', carregarPrevia);
      el.addEventListener('focus', carregarPrevia);
    });
    posicionarPins();
    // Contagem/progresso no topo da planta
    const validas = estado.galeria.fotos.filter((f) => !f.arquivada);
    const aprovadas = validas.filter((f) => f.aprovada).length;
    pid('plantaTextoProgresso').textContent = validas.length ? `${aprovadas} de ${validas.length} imagens aprovadas` : '';
  }

  function renderizar() {
    const plantas = plantasOrdenadas();
    if (!plantas.length) return;
    const atual = plantas.find((p) => p.id === ST.plantaId) || plantas[0];
    ST.plantaId = atual.id;

    const abas = pid('plantaAbas');
    abas.style.display = plantas.length > 1 ? 'flex' : 'none';
    abas.innerHTML = plantas.map((p) =>
      `<button class="aba-planta ${p.id === atual.id ? 'ativa' : ''}" data-planta-id="${p.id}">${escapeHtml(p.nome)}</button>`).join('');
    abas.querySelectorAll('.aba-planta').forEach((b) => b.addEventListener('click', () => {
      ST.plantaId = b.dataset.plantaId;
      ST.imgSrcAtual = null; // força recarregar a imagem da outra planta
      resetarZoom();
      renderizar();
    }));

    const img = pid('imgPlanta');
    if (ST.imgSrcAtual !== atual.url) {
      ST.imgSrcAtual = atual.url;
      pid('plantaPins').innerHTML = '';
      img.style.visibility = 'hidden';
      // desenharPins() ANTES: ele escreve o texto de progresso no cabeçalho, e isso muda a altura
      // da área visível -- o ajuste precisa vir depois, com o tamanho final.
      img.onload = () => { img.style.visibility = 'visible'; ST.z = 1; desenharPins(); ajustarAoVisor(); };
      img.src = atual.url;
    } else {
      desenharPins();
    }
  }

  // ---------------------------------------------------------------- navegação
  function abrirFotoPeloId(fotoId) {
    for (let ci = 0; ci < estado.categoriasOrdenadas.length; ci++) {
      const cat = estado.categoriasOrdenadas[ci];
      const i = cat.fotos.findIndex((f) => f.id === fotoId);
      if (i >= 0) {
        // o "mood" da categoria (capa) é o 1º item do visualizador, então a foto vem 1 depois
        abrirCategoria(ci, { indiceFoto: i + (cat.moodUrl ? 1 : 0), origem: 'planta' });
        return;
      }
    }
  }

  function abrir(plantaIdPreferida) {
    if (plantaIdPreferida && plantasOrdenadas().some((p) => p.id === plantaIdPreferida)) {
      if (ST.plantaId !== plantaIdPreferida) ST.imgSrcAtual = null;
      ST.plantaId = plantaIdPreferida;
    }
    pid('telaGaleria').style.display = 'none';
    pid('telaPlanta').style.display = 'flex';
    pid('nomeProjetoPlanta').textContent = estado.galeria.nomeProjeto;
    const logo = estado.galeria.iconePersonalizado && estado.galeria.iconePersonalizado.url;
    if (logo) pid('imgLogoPlanta').src = logo;
    renderizar();
    ajustarAoVisor(); // o visor só tem tamanho de verdade depois de aparecer
  }

  function fechar() { pid('telaPlanta').style.display = 'none'; }
  function estaAberta() { return pid('telaPlanta').style.display !== 'none'; }
  function atualizarPins() { if (estaAberta()) desenharPins(); } // status mudou (aprovou/comentou)

  // ---------------------------------------------------------------- eventos (mouse, toque, roda)
  function ligarEventos() {
    const visor = pid('plantaViewport');

    visor.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.planta-controles')) return;
      ST.ponteiros.set(e.pointerId, { x: e.clientX, y: e.clientY });
      ST.movido = false;
      if (ST.ponteiros.size === 1) ST.inicioArraste = { x: e.clientX, y: e.clientY, tx: ST.tx, ty: ST.ty };
      if (ST.ponteiros.size === 2) {
        const [a, b] = [...ST.ponteiros.values()];
        ST.distanciaPinca = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });

    visor.addEventListener('pointermove', (e) => {
      if (!ST.ponteiros.has(e.pointerId)) return;
      ST.ponteiros.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ST.ponteiros.size === 2) { // pinça: dois dedos
        const [a, b] = [...ST.ponteiros.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (ST.distanciaPinca > 0) {
          const v = areaVisivel();
          zoomEm(dist / ST.distanciaPinca, (a.x + b.x) / 2 - v.esq, (a.y + b.y) / 2 - v.topo);
        }
        ST.distanciaPinca = dist;
        ST.movido = true;
        return;
      }
      if (!ST.inicioArraste) return;
      const dx = e.clientX - ST.inicioArraste.x, dy = e.clientY - ST.inicioArraste.y;
      if (!ST.movido && Math.hypot(dx, dy) > 6) {
        ST.movido = true;
        try { visor.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
      }
      if (ST.movido) {
        ST.tx = ST.inicioArraste.tx + dx;
        ST.ty = ST.inicioArraste.ty + dy;
        aplicarTransformacao();
      }
    });

    const soltar = (e) => {
      ST.ponteiros.delete(e.pointerId);
      ST.inicioArraste = null;
      if (ST.ponteiros.size === 1) { // sobrou um dedo depois da pinça: recomeça o arraste dele
        const [p] = [...ST.ponteiros.values()];
        ST.inicioArraste = { x: p.x, y: p.y, tx: ST.tx, ty: ST.ty };
      }
      // o "movido" é consumido pelo clique do ícone; se não houver clique, limpa logo em seguida
      setTimeout(() => { if (!ST.ponteiros.size) ST.movido = false; }, 0);
    };
    visor.addEventListener('pointerup', soltar);
    visor.addEventListener('pointercancel', soltar);

    visor.addEventListener('wheel', (e) => {
      e.preventDefault();
      const v = areaVisivel();
      zoomEm(Math.exp(-e.deltaY * 0.0015), e.clientX - v.esq, e.clientY - v.topo);
    }, { passive: false });

    pid('btnPlantaZoomMais').addEventListener('click', () => zoomEm(1.4));
    pid('btnPlantaZoomMenos').addEventListener('click', () => zoomEm(1 / 1.4));
    pid('btnPlantaZoomReset').addEventListener('click', resetarZoom);
    pid('btnPlantaParaGaleria').addEventListener('click', () => { fechar(); mostrarTelaGaleriaDaPlanta(); });
    // Reencaixa a planta sempre que a ÁREA VISÍVEL mudar de tamanho (girar o celular, barra do
    // navegador que some/aparece, redimensionar a janela...). O ResizeObserver cobre isso melhor
    // que o evento "resize" da janela; o "resize" fica como reforço pra navegadores antigos.
    if (window.ResizeObserver) new ResizeObserver(() => { if (estaAberta()) ajustarAoVisor(); }).observe(visor);
    // As fontes da página carregam DEPOIS do primeiro ajuste e mexem uns pixels na altura do
    // cabeçalho/legenda -- reencaixa quando terminarem (e quando a página terminar de carregar).
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (estaAberta()) ajustarAoVisor(); });
    window.addEventListener('load', () => { if (estaAberta()) ajustarAoVisor(); });
    window.addEventListener('resize', () => { if (estaAberta()) ajustarAoVisor(); });
  }

  document.addEventListener('DOMContentLoaded', ligarEventos);

  window.PlantaCliente = { temPlantaUtil, abrir, fechar, estaAberta, atualizarPins, plantaDaFoto: (f) => (f && f.plantaId) || null };
})();
