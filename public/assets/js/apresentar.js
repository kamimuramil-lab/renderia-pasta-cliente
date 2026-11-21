// Lousa de APRESENTAÇÃO (modo escritório): o arquiteto abre a pasta do cliente pelo dashboard e apresenta o projeto numa lousa -- o PDF ou a
// imagem (do Google Drive ou da galeria) ocupa a tela, com ponteiro, caneta, marca-texto, rabisco que apaga sozinho e borracha, e um campo
// pequeno de anotações. "Print" guarda a página rabiscada; "Encerrar e salvar" guarda a ata (anotações + prints) só pro escritório.
//
// Interface enxuta de propósito (a reunião costuma ser espelhada no Google Meet): barra fina no topo, ferramentas estreitas à esquerda, anotações
// numa coluna estreita que recolhe. Os riscos ficam presos a cada PÁGINA (guardados em frações da página: acompanham o zoom e o tamanho da tela).
(function (raiz) {
  'use strict';

  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const CORES = { vermelho: '#ff4d4f', azul: '#3b9cff', verde: '#2fd07f' };
  const LARGURA = { caneta: 0.0034, marcador: 0.017, temp: 0.0042 }; // fração da largura da página
  const TEMP_ESPERA = 700, TEMP_FADE = 1500, LIMITE_PRINTS = 40;

  // ---------- funções puras (testáveis em Node) ----------
  const dois = (n) => String(n).padStart(2, '0');
  function textoDaAta({ projeto, apresentado, notas, quando }) {
    const d = quando instanceof Date ? quando : new Date();
    const linhas = [`*Reunião - ${projeto}*`, `${dois(d.getDate())}/${dois(d.getMonth() + 1)}/${d.getFullYear()} às ${dois(d.getHours())}:${dois(d.getMinutes())}`];
    if (apresentado) linhas.push(`Apresentado: ${apresentado}`);
    if (String(notas || '').trim()) linhas.push('', String(notas).trim());
    return linhas.join('\n');
  }
  const duracao = (seg) => `${dois(Math.floor(seg / 60))}:${dois(seg % 60)}`;
  // Ponto de um evento em frações (0..1) da página: `r` = retângulo (já com zoom/deslocamento) do canvas da página.
  const fracao = (x, y, r) => ({ x: (x - r.left) / r.width, y: (y - r.top) / r.height });
  // Zoom ancorado no cursor: o ponto sob o mouse continua sob o mouse.
  function zoomEm(v, mx, my, novoZoom) { const z = Math.min(6, Math.max(0.4, novoZoom)); return { zoom: z, tx: mx - (mx - v.tx) * (z / v.zoom), ty: my - (my - v.ty) * (z / v.zoom) }; }
  // Risco (em frações) perto do ponto? (borracha)
  const riscoPerto = (risco, p, raio) => risco.pts.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < raio);

  const api = { textoDaAta, duracao, fracao, zoomEm, riscoPerto, CORES, LARGURA };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  // ---------- a lousa (só no navegador) ----------
  const ICONE = {
    ponteiro: '<circle cx="12" cy="12" r="2.6"/><circle cx="12" cy="12" r="7.5" opacity=".55"/>',
    caneta: '<path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/>',
    marcador: '<path d="M3 21h8"/><path d="M9 15l7-8 4 4-8 7z"/><path d="M9 15l-1 4 4-1"/>',
    borracha: '<path d="M7 20h11"/><path d="M5 14l7-8 7 7-5 6H9z"/>',
    mao: '<path d="M8 12V6.5a1.5 1.5 0 013 0V11m0-1V4.5a1.5 1.5 0 013 0V11m0-4.5a1.5 1.5 0 013 0V15a6 6 0 01-6 6h-.5a6 6 0 01-5-2.7L4.5 14a1.6 1.6 0 012.5-2z"/>',
    desfazer: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>',
    lixo: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13.5" r="3.5"/>',
    anterior: '<path d="M15 5l-7 7 7 7"/>', proximo: '<path d="M9 5l7 7-7 7"/>',
    mais: '<path d="M12 5v14M5 12h14"/>', menos: '<path d="M5 12h14"/>',
    ajustar: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    notas: '<path d="M5 4h14v16H5z"/><path d="M8 9h8M8 13h8M8 17h5"/>',
    fechar: '<path d="M6 6l12 12M18 6L6 18"/>'
  };
  const svg = (n, t) => `<svg viewBox="0 0 24 24" width="${t || 17}" height="${t || 17}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONE[n]}</svg>`;
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (id) => document.getElementById(id);

  let S = null; // estado da apresentação aberta
  let montada = false;

  function montar() {
    if (montada) return;
    montada = true;
    const ferramentas = [['ponteiro', 'Ponteiro (P): aponta e, se arrastar, risca um traço que some sozinho'], ['caneta', 'Caneta (C): risco que fica'], ['marcador', 'Grifar (G): marca-texto por cima'], ['borracha', 'Borracha (B)'], ['mao', 'Mão (H): arrastar a página. Com o botão do meio do mouse dá para arrastar em qualquer ferramenta']];
    const el = document.createElement('div');
    el.id = 'lousa'; el.className = 'lousa'; el.hidden = true; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Apresentação');
    el.innerHTML = `
      <div class="lousa-topo">
        <img id="lousaLogo" class="lousa-logo" alt="" hidden>
        <span class="lousa-titulo" id="lousaTitulo"></span>
        <span class="lousa-espaco"></span>
        <button type="button" class="lousa-btn" id="lousaAnt" title="Página anterior (←)" aria-label="Página anterior">${svg('anterior')}</button>
        <span class="lousa-pg" id="lousaPg">0 / 0</span>
        <button type="button" class="lousa-btn" id="lousaProx" title="Próxima página (→)" aria-label="Próxima página">${svg('proximo')}</button>
        <span class="lousa-sep"></span>
        <button type="button" class="lousa-btn" id="lousaMenos" title="Menos zoom (−)" aria-label="Menos zoom">${svg('menos')}</button>
        <button type="button" class="lousa-btn" id="lousaAjustar" title="Ajustar à tela (0)" aria-label="Ajustar à tela">${svg('ajustar')}</button>
        <button type="button" class="lousa-btn" id="lousaMais" title="Mais zoom (+)" aria-label="Mais zoom">${svg('mais')}</button>
        <span class="lousa-sep"></span>
        <span class="lousa-tempo" id="lousaTempo" title="Tempo de reunião">00:00</span>
        <button type="button" class="lousa-btn lousa-btn-texto" id="lousaPrint" title="Print da página com os riscos (vai junto da ata)">${svg('camera')}<span id="lousaPrintN">0</span></button>
        <button type="button" class="lousa-btn" id="lousaNotasBtn" title="Mostrar/esconder as anotações" aria-label="Anotações">${svg('notas')}</button>
        <button type="button" class="lousa-btn lousa-btn-texto lousa-encerrar" id="lousaEncerrar">Encerrar e salvar</button>
        <button type="button" class="lousa-btn" id="lousaSair" title="Sair (Esc)" aria-label="Sair">${svg('fechar')}</button>
      </div>
      <div class="lousa-corpo">
        <div class="lousa-ferr" id="lousaFerr">
          ${ferramentas.map(([id, tit]) => `<button type="button" class="lousa-btn lousa-ferr-btn" data-ferr="${id}" title="${esc(tit)}" aria-label="${esc(tit)}">${svg(id)}</button>`).join('')}
          <span class="lousa-cores">${Object.entries(CORES).map(([n, c]) => `<button type="button" class="lousa-cor" data-cor="${n}" title="${n}" aria-label="Cor ${n}" style="background:${c}"></button>`).join('')}</span>
          <button type="button" class="lousa-btn lousa-ferr-btn" id="lousaDesfazer" title="Desfazer o último risco (Ctrl+Z)" aria-label="Desfazer">${svg('desfazer')}</button>
          <button type="button" class="lousa-btn lousa-ferr-btn" id="lousaLimpar" title="Limpar os riscos desta página" aria-label="Limpar a página">${svg('lixo')}</button>
        </div>
        <div class="lousa-palco" id="lousaPalco">
          <div class="lousa-caixa" id="lousaCaixa"><canvas id="lousaDoc" class="lousa-doc"></canvas><canvas id="lousaTinta" class="lousa-tinta"></canvas></div>
          <div class="lousa-aviso" id="lousaAviso" hidden></div>
          <div class="lousa-flash" id="lousaFlash" hidden></div>
        </div>
        <div class="lousa-notas" id="lousaNotas">
          <div class="lousa-notas-topo"><b>Anotações</b>
            <button type="button" class="lousa-mini" data-ins="hora">Hora</button><button type="button" class="lousa-mini" data-ins="decisao">Decisão</button><button type="button" class="lousa-mini" data-ins="pendencia">Pendência</button></div>
          <textarea id="lousaTexto" placeholder="O que for combinado na reunião" aria-label="Anotações da reunião"></textarea>
          <div class="lousa-prints" id="lousaPrints"></div>
        </div>
      </div>
      <div class="lousa-dialogo" id="lousaDialogo" hidden><div class="lousa-dialogo-caixa" id="lousaDialogoCaixa"></div></div>`;
    document.body.appendChild(el);
    ligarEventos();
  }

  // ---------- carregar o que apresentar ----------
  function carregarPdfJs() {
    if (raiz.pdfjsLib) return Promise.resolve(raiz.pdfjsLib);
    return new Promise((ok, erro) => {
      const s = document.createElement('script');
      s.src = PDFJS; s.onload = () => { raiz.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; ok(raiz.pdfjsLib); };
      s.onerror = () => erro(new Error('Não consegui carregar o leitor de PDF. Confira a internet.'));
      document.head.appendChild(s);
    });
  }
  async function bitmapDe(blob) { return createImageBitmap(blob); }
  function carregarImg(url, comCors) {
    return new Promise((ok, erro) => { const im = new Image(); if (comCors) im.crossOrigin = 'anonymous'; im.onload = () => ok(im); im.onerror = () => erro(new Error('imagem')); im.src = url; });
  }
  // Imagem da galeria (R2). 1) fetch sem usar o cache: o navegador pode ter guardado a mesma imagem SEM os cabeçalhos de CORS (a galeria a mostrou
  // num <img>) e aí o fetch falha com "Failed to fetch"; 2) <img crossorigin>; 3) <img> comum (aparece, mas o print não funciona nessa imagem).
  async function carregarImagem(url) {
    try { const r = await fetch(url, { cache: 'no-store' }); if (r.ok) { const bmp = await bitmapDe(await r.blob()); return { tipo: 'bitmap', bmp, w: bmp.width, h: bmp.height }; } } catch (e) { /* tenta o próximo */ }
    try { const im = await carregarImg(url, true); return { tipo: 'bitmap', bmp: im, w: im.naturalWidth, h: im.naturalHeight }; } catch (e) { /* tenta o próximo */ }
    try { const im = await carregarImg(url, false); return { tipo: 'bitmap', bmp: im, w: im.naturalWidth, h: im.naturalHeight, protegida: true }; } catch (e) { /* sem jeito */ }
    throw new Error('Não consegui carregar esta imagem. Atualize a página e tente de novo.');
  }
  async function obterFonte(item) {
    if (item.fonte) return item.fonte;
    if (item.tipo === 'imagem') return (item.fonte = await carregarImagem(item.url));
    if (item.tipo === 'pdfpag') {
      const pagina = await item.pdf.getPage(item.n);
      const v = pagina.getViewport({ scale: 1 });
      return (item.fonte = { tipo: 'pdf', pagina, w: v.width, h: v.height });
    }
    // 'doc': arquivo do Google Drive buscado pelo servidor (PDF ou imagem)
    let r;
    try { r = await fetch(item.url, { headers: { 'x-cliente-token': S.opcoes.token() } }); } catch (e) { throw new Error('Não consegui falar com o servidor. Confira a internet e tente de novo.'); }
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.erro || 'Não consegui abrir o arquivo do Drive.'); }
    const tipo = r.headers.get('content-type') || '';
    if (/pdf/i.test(tipo)) {
      const buf = await r.arrayBuffer();
      const lib = await carregarPdfJs();
      const pdf = await lib.getDocument({ data: new Uint8Array(buf) }).promise;
      const i = S.itens.indexOf(item);
      const paginas = Array.from({ length: pdf.numPages }, (_, k) => ({ chave: `${item.chave}:p${k + 1}`, rotulo: pdf.numPages > 1 ? `${item.rotulo} · pág. ${k + 1}/${pdf.numPages}` : item.rotulo, tipo: 'pdfpag', pdf, n: k + 1 }));
      S.itens.splice(i, 1, ...paginas);
      return obterFonte(S.itens[i]);
    }
    const bmp = await bitmapDe(await r.blob());
    return (item.fonte = { tipo: 'bitmap', bmp, w: bmp.width, h: bmp.height });
  }

  // ---------- mostrar uma página ----------
  function aviso(texto, erro) { const a = $('lousaAviso'); a.hidden = !texto; a.textContent = texto || ''; a.classList.toggle('erro', !!erro); }
  function aplicarTransformacao() { const p = S.pagina; if (!p) return; $('lousaCaixa').style.transform = `translate(${S.tx}px, ${S.ty}px) scale(${S.zoom})`; }
  function ajustar() {
    const p = S.pagina; if (!p) return;
    const r = $('lousaPalco').getBoundingClientRect();
    S.zoom = 1; S.tx = (r.width - p.cw) / 2; S.ty = (r.height - p.ch) / 2;
    aplicarTransformacao();
  }
  function atualizarTopo() {
    const item = S.itens[S.idx];
    $('lousaTitulo').textContent = item ? item.rotulo : '';
    $('lousaPg').textContent = `${S.itens.length ? S.idx + 1 : 0} / ${S.itens.length}`;
    $('lousaAnt').disabled = S.idx <= 0; $('lousaProx').disabled = S.idx >= S.itens.length - 1;
  }
  async function mostrar(i) {
    if (!S || i < 0 || i >= S.itens.length) return;
    const meu = ++S.token;
    S.idx = i; S.temp = []; S.laser = null; S.pagina = null;
    atualizarTopo(); aviso('Carregando…');
    let fonte;
    try { fonte = await obterFonte(S.itens[i]); } catch (e) { if (meu === S.token) { aviso(e.message || 'Não consegui carregar.', true); limparCanvas(); } return; }
    if (meu !== S.token) return; // mudou de página no meio
    atualizarTopo(); // um PDF acabou de virar várias páginas
    const item = S.itens[S.idx];
    const area = $('lousaPalco').getBoundingClientRect();
    const f = Math.min((area.width - 24) / fonte.w, (area.height - 24) / fonte.h);
    const cw = Math.max(50, fonte.w * f), ch = Math.max(50, fonte.h * f);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let bw = cw * dpr * 1.8, bh = ch * dpr * 1.8;
    const maior = Math.max(bw, bh); if (maior > 4096) { bw *= 4096 / maior; bh *= 4096 / maior; }
    const doc = $('lousaDoc'), tinta = $('lousaTinta');
    doc.width = Math.round(bw); doc.height = Math.round(bh);
    doc.style.width = cw + 'px'; doc.style.height = ch + 'px';
    tinta.width = Math.round(cw * dpr * 2); tinta.height = Math.round(ch * dpr * 2);
    tinta.style.width = cw + 'px'; tinta.style.height = ch + 'px';
    $('lousaCaixa').style.width = cw + 'px'; $('lousaCaixa').style.height = ch + 'px';
    const ctx = doc.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, doc.width, doc.height);
    try {
      if (fonte.tipo === 'bitmap') ctx.drawImage(fonte.bmp, 0, 0, doc.width, doc.height);
      else { if (S.renderAtual) { try { S.renderAtual.cancel(); } catch (e) { /* já acabou */ } } S.renderAtual = fonte.pagina.render({ canvasContext: ctx, viewport: fonte.pagina.getViewport({ scale: doc.width / fonte.w }) }); await S.renderAtual.promise; }
    } catch (e) { if (meu === S.token && !(e && e.name === 'RenderingCancelledException')) aviso('Não consegui desenhar esta página.', true); return; }
    if (meu !== S.token) return;
    S.pagina = { chave: item.chave, rotulo: item.rotulo, cw, ch };
    aviso('');
    ajustar(); S.sujo = true;
  }
  function limparCanvas() { const t = $('lousaTinta'); t.getContext('2d').clearRect(0, 0, t.width, t.height); const d = $('lousaDoc'); d.getContext('2d').clearRect(0, 0, d.width, d.height); }

  // ---------- tinta ----------
  const riscosDaPagina = () => (S.pagina ? (S.tinta[S.pagina.chave] = S.tinta[S.pagina.chave] || []) : []);
  function tracar(ctx, r, W, H, alfa) {
    if (!r.pts.length) return;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = r.tool === 'marcador' ? '#ffd24a' : CORES[r.cor] || CORES.vermelho;
    ctx.globalAlpha = (r.tool === 'marcador' ? 0.38 : 1) * alfa;
    ctx.lineWidth = r.w * W;
    ctx.beginPath(); ctx.moveTo(r.pts[0].x * W, r.pts[0].y * H);
    r.pts.forEach((p) => ctx.lineTo(p.x * W + 0.01, p.y * H));
    ctx.stroke(); ctx.restore();
  }
  function quadro() {
    if (!S) return;
    requestAnimationFrame(quadro);
    const agora = performance.now();
    S.temp = S.temp.filter((r) => !r.fim || agora - r.fim < TEMP_ESPERA + TEMP_FADE);
    if (!S.sujo && !S.temp.length && !S.laser) return;
    S.sujo = false;
    const c = $('lousaTinta'), ctx = c.getContext('2d'); const W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);
    riscosDaPagina().forEach((r) => tracar(ctx, r, W, H, 1));
    S.temp.forEach((r) => { const idade = r.fim ? agora - r.fim : 0; tracar(ctx, r, W, H, idade < TEMP_ESPERA ? 1 : Math.max(0, 1 - (idade - TEMP_ESPERA) / TEMP_FADE)); });
    if (S.laser) {
      S.laser.rastro = S.laser.rastro.filter((p) => agora - p.t < 450);
      S.laser.rastro.forEach((p) => { ctx.save(); ctx.globalAlpha = Math.max(0, 1 - (agora - p.t) / 450) * 0.5; ctx.fillStyle = '#ff4d4f'; ctx.beginPath(); ctx.arc(p.x * W, p.y * H, W * 0.006, 0, 7); ctx.fill(); ctx.restore(); });
      ctx.save(); ctx.fillStyle = '#ff4d4f'; ctx.beginPath(); ctx.arc(S.laser.x * W, S.laser.y * H, W * 0.0085, 0, 7); ctx.fill(); ctx.strokeStyle = 'rgba(255,77,79,.35)'; ctx.lineWidth = W * 0.006; ctx.stroke(); ctx.restore();
      S.sujo = true;
    }
  }
  const pontoDoEvento = (e) => fracao(e.clientX, e.clientY, $('lousaTinta').getBoundingClientRect());
  function apagarEm(p) {
    const lista = riscosDaPagina();
    const resto = lista.filter((r) => !riscoPerto(r, p, 0.016));
    if (resto.length !== lista.length) { S.tinta[S.pagina.chave] = resto; S.sujo = true; }
  }
  function aoApertar(e) {
    if (!S || !S.pagina || e.target.closest('.lousa-aviso')) return;
    if (e.button > 1) return; // botão direito e outros: não riscam
    try { $('lousaPalco').setPointerCapture(e.pointerId); } catch (err) { /* sem captura: continua funcionando dentro do palco */ } S.apertado = true;
    const p = pontoDoEvento(e);
    if (e.button === 1 || S.ferr === 'mao') { e.preventDefault(); S.pan = { x: e.clientX, y: e.clientY, tx: S.tx, ty: S.ty }; $('lousaPalco').classList.add('arrastando'); S.laser = null; S.sujo = true; return; } // botão do MEIO (ou a mão): arrasta a página
    if (S.ferr === 'caneta' || S.ferr === 'marcador' || S.ferr === 'temp') {
      S.atual = { tool: S.ferr, cor: S.cor, w: LARGURA[S.ferr], pts: [p] };
      if (S.ferr === 'temp') S.temp.push(S.atual); else riscosDaPagina().push(S.atual);
      S.sujo = true;
    } else if (S.ferr === 'borracha') apagarEm(p);
    else if (S.ferr === 'ponteiro') {
      S.laser = { x: p.x, y: p.y, rastro: [] };
      S.atual = { tool: 'temp', cor: S.cor, w: LARGURA.temp, pts: [p] }; // arrastar com o ponteiro risca um traço que some sozinho
      S.temp.push(S.atual);
    }
  }
  function aoMover(e) {
    if (!S || !S.pagina) return;
    const p = pontoDoEvento(e);
    if (S.apertado && S.pan) { S.tx = S.pan.tx + (e.clientX - S.pan.x); S.ty = S.pan.ty + (e.clientY - S.pan.y); aplicarTransformacao(); return; }
    if (S.ferr === 'ponteiro') {
      const dentro = p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
      if (!dentro) { S.laser = null; S.sujo = true; return; }
      if (!S.laser) S.laser = { x: p.x, y: p.y, rastro: [] };
      S.laser.rastro.push({ x: S.laser.x, y: S.laser.y, t: performance.now() }); S.laser.x = p.x; S.laser.y = p.y;
      if (S.apertado && S.atual) S.atual.pts.push(p); // traço temporário do ponteiro
      return;
    }
    if (!S.apertado) return;
    if (S.atual) { S.atual.pts.push(p); S.sujo = true; }
    else if (S.ferr === 'borracha') apagarEm(p);
  }
  function aoSoltar() {
    if (!S) return;
    S.apertado = false; S.pan = null; $('lousaPalco').classList.remove('arrastando');
    if (S.atual && S.atual.tool === 'temp') S.atual.fim = performance.now();
    S.atual = null;
  }
  function aoRolar(e) {
    if (!S || !S.pagina) return;
    e.preventDefault();
    const r = $('lousaPalco').getBoundingClientRect();
    const v = zoomEm({ zoom: S.zoom, tx: S.tx, ty: S.ty }, e.clientX - r.left, e.clientY - r.top, S.zoom * Math.pow(1.0018, -e.deltaY));
    S.zoom = v.zoom; S.tx = v.tx; S.ty = v.ty; aplicarTransformacao();
  }
  function zoomBotao(fator) { const r = $('lousaPalco').getBoundingClientRect(); const v = zoomEm({ zoom: S.zoom, tx: S.tx, ty: S.ty }, r.width / 2, r.height / 2, S.zoom * fator); S.zoom = v.zoom; S.tx = v.tx; S.ty = v.ty; aplicarTransformacao(); }
  function escolherFerramenta(f) {
    S.ferr = f; S.laser = null; S.sujo = true;
    document.querySelectorAll('#lousaFerr [data-ferr]').forEach((b) => b.classList.toggle('ativa', b.dataset.ferr === f));
    $('lousaPalco').dataset.ferr = f;
  }
  function escolherCor(c) {
    S.cor = c; document.querySelectorAll('#lousaFerr [data-cor]').forEach((b) => b.classList.toggle('ativa', b.dataset.cor === c));
    if (S.ferr === 'borracha' || S.ferr === 'mao') escolherFerramenta('caneta'); // o ponteiro usa a cor escolhida no traço temporário
  }

  // ---------- print, anotações, ata ----------
  function mostrarFlash(texto) { const f = $('lousaFlash'); f.textContent = texto; f.hidden = false; clearTimeout(S.tFlash); S.tFlash = setTimeout(() => { f.hidden = true; }, 2200); }
  function tirarPrint() {
    if (!S.pagina) { mostrarFlash('Espere a página carregar para tirar o print.'); return; }
    if (S.prints.length >= LIMITE_PRINTS) { mostrarFlash(`Limite de ${LIMITE_PRINTS} prints por reunião.`); return; }
    const doc = $('lousaDoc');
    const maior = Math.max(doc.width, doc.height), f = maior > 2000 ? 2000 / maior : 1;
    const W = Math.round(doc.width * f), H = Math.round(doc.height * f);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.drawImage(doc, 0, 0, W, H);
    riscosDaPagina().forEach((r) => tracar(ctx, r, W, H, 1)); // só os riscos que ficam (o ponteiro e o rabisco temporário não entram)
    let imagem;
    try { imagem = c.toDataURL('image/jpeg', 0.84); } catch (e) { mostrarFlash('O navegador bloqueou o print desta imagem. Atualize a página e tente de novo.'); return; }
    S.prints.push({ rotulo: S.pagina.rotulo, imagem });
    desenharPrints();
    mostrarFlash(`Print guardado (${S.prints.length}). Vai junto da ata.`);
  }
  function desenharPrints() {
    $('lousaPrintN').textContent = String(S.prints.length);
    $('lousaPrints').innerHTML = S.prints.map((p, i) => `<div class="lousa-print" title="${esc(p.rotulo)}"><img src="${p.imagem}" alt="${esc(p.rotulo)}"><button type="button" data-rm-print="${i}" aria-label="Remover o print">×</button></div>`).join('');
  }
  function inserirNota(tipo) {
    const t = $('lousaTexto'); const d = new Date();
    const prefixo = tipo === 'hora' ? `[${dois(d.getHours())}:${dois(d.getMinutes())}] ` : (tipo === 'decisao' ? 'DECISÃO: ' : 'PENDÊNCIA: ');
    t.value += (t.value && !t.value.endsWith('\n') ? '\n' : '') + prefixo;
    t.focus(); t.dispatchEvent(new Event('input'));
  }
  const chaveRascunho = () => `renderia_lousa_${S.opcoes.link}`;
  function guardarRascunho() { try { localStorage.setItem(chaveRascunho(), JSON.stringify({ notas: $('lousaTexto').value, inicio: S.inicio.toISOString(), em: Date.now() })); } catch (e) { /* sem armazenamento: tudo bem */ } }
  function lerRascunho() { try { const r = JSON.parse(localStorage.getItem(chaveRascunho()) || 'null'); return r && Date.now() - r.em < 12 * 3600 * 1000 ? r : null; } catch (e) { return null; } }
  function limparRascunho() { try { localStorage.removeItem(chaveRascunho()); } catch (e) { /* ok */ } }
  const temConteudo = () => !!(S.prints.length || $('lousaTexto').value.trim());

  function dialogo(html, ligar) { const d = $('lousaDialogo'); $('lousaDialogoCaixa').innerHTML = html; d.hidden = false; if (ligar) ligar(); }
  function fecharDialogo() { $('lousaDialogo').hidden = true; }
  function pedirSair() {
    if (!S) return;
    if (!temConteudo()) { fechar(); return; }
    dialogo(`<p>Sair sem salvar a reunião? As anotações e os prints desta reunião serão perdidos.</p><div class="lousa-dialogo-acoes"><button type="button" class="lousa-btn lousa-btn-texto" id="dlgVoltar">Voltar à reunião</button><button type="button" class="lousa-btn lousa-btn-texto perigo" id="dlgSair">Sair sem salvar</button></div>`, () => {
      $('dlgVoltar').onclick = fecharDialogo; $('dlgSair').onclick = () => { fecharDialogo(); limparRascunho(); fechar(); };
    });
  }
  function pedirEncerrar() {
    if (!temConteudo()) { dialogo(`<p>Nada para salvar ainda: escreva uma anotação ou tire um print.</p><div class="lousa-dialogo-acoes"><button type="button" class="lousa-btn lousa-btn-texto" id="dlgOk">Entendi</button></div>`, () => { $('dlgOk').onclick = fecharDialogo; }); return; }
    const notas = $('lousaTexto').value;
    dialogo(`<p>Salvar a reunião? Ficam guardados as anotações${S.prints.length ? ` e ${S.prints.length} print${S.prints.length === 1 ? '' : 's'}` : ''}, só para o escritório (o cliente não vê).</p><div class="lousa-dialogo-acoes"><button type="button" class="lousa-btn lousa-btn-texto" id="dlgVoltar">Voltar</button><button type="button" class="lousa-btn lousa-btn-texto principal" id="dlgSalvar">Salvar reunião</button></div><div class="lousa-dialogo-erro" id="dlgErro" hidden></div>`, () => {
      $('dlgVoltar').onclick = fecharDialogo;
      $('dlgSalvar').onclick = () => salvarAta(notas);
    });
  }
  async function salvarAta(notas) {
    const botao = $('dlgSalvar'); botao.disabled = true; botao.textContent = 'Salvando…'; $('dlgErro').hidden = true;
    const fim = new Date();
    const corpo = { titulo: `Reunião - ${S.opcoes.projeto}`, apresentado: S.opcoes.apresentado || '', notas, iniciouEm: S.inicio.toISOString(), encerrouEm: fim.toISOString(), prints: S.prints.map((p) => ({ rotulo: p.rotulo, imagem: p.imagem })) };
    try {
      const r = await fetch(`/api/cliente/${S.opcoes.link}/reunioes`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cliente-token': S.opcoes.token() }, body: JSON.stringify(corpo) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.erro || 'Não consegui salvar a reunião.');
      limparRascunho();
      const texto = textoDaAta({ projeto: S.opcoes.projeto, apresentado: S.opcoes.apresentado, notas, quando: fim });
      dialogo(`<p><b>Reunião salva.</b> Ela já está na aba <b>Reuniões</b> do projeto, no app. Só o escritório vê.</p><div class="lousa-dialogo-acoes"><button type="button" class="lousa-btn lousa-btn-texto" id="dlgCopiar">Copiar texto (WhatsApp)</button><button type="button" class="lousa-btn lousa-btn-texto principal" id="dlgFechar">Fechar a apresentação</button></div>`, () => {
        $('dlgCopiar').onclick = async () => { try { await navigator.clipboard.writeText(texto); $('dlgCopiar').textContent = 'Copiado'; } catch (e) { $('dlgCopiar').textContent = 'Não consegui copiar'; } };
        $('dlgFechar').onclick = () => { fecharDialogo(); fechar(); };
      });
    } catch (e) {
      botao.disabled = false; botao.textContent = 'Tentar de novo';
      const err = $('dlgErro'); err.textContent = (e && e.message) || 'Erro ao salvar. Confira a internet e tente de novo.'; err.hidden = false;
    }
  }

  // ---------- abrir / fechar ----------
  function abrir(opcoes) {
    montar();
    const itens = (opcoes.itens || []).map((i) => Object.assign({}, i));
    if (!itens.length) { alert('Não há nada para apresentar aqui ainda.'); return; }
    S = { opcoes, itens, idx: 0, token: 0, tinta: {}, temp: [], laser: null, prints: [], ferr: 'ponteiro', cor: 'vermelho', zoom: 1, tx: 0, ty: 0, pagina: null, inicio: new Date(), sujo: true, apertado: false };
    const rasc = lerRascunho();
    $('lousaTexto').value = rasc ? rasc.notas : '';
    if (rasc && rasc.inicio) S.inicio = new Date(rasc.inicio);
    $('lousaLogo').hidden = !opcoes.logoUrl; if (opcoes.logoUrl) $('lousaLogo').src = opcoes.logoUrl;
    desenharPrints(); fecharDialogo(); aviso('');
    const lousa = $('lousa'); lousa.hidden = false; document.body.classList.add('lousa-aberta');
    escolherFerramenta('ponteiro'); escolherCor('vermelho'); // começa no ponteiro (o lápis é escolha de quem quer deixar o traço)
    S.relogio = setInterval(() => { $('lousaTempo').textContent = duracao(Math.floor((Date.now() - S.inicio.getTime()) / 1000)); }, 1000);
    $('lousaTempo').textContent = duracao(Math.floor((Date.now() - S.inicio.getTime()) / 1000));
    requestAnimationFrame(() => { mostrar(0); quadro(); });
    if (rasc && rasc.notas) mostrarFlash('Anotações da reunião anterior recuperadas.');
  }
  function fechar() {
    if (!S) return;
    clearInterval(S.relogio); S.token++;
    $('lousa').hidden = true; document.body.classList.remove('lousa-aberta');
    const dep = S.opcoes.aoFechar; S = null;
    if (dep) dep();
  }

  function ligarEventos() {
    const palco = $('lousaPalco');
    palco.addEventListener('pointerdown', aoApertar);
    palco.addEventListener('pointermove', aoMover);
    palco.addEventListener('pointerup', aoSoltar); palco.addEventListener('pointercancel', aoSoltar);
    palco.addEventListener('pointerleave', () => { if (S && S.ferr === 'ponteiro') { S.laser = null; S.sujo = true; } });
    palco.addEventListener('wheel', aoRolar, { passive: false });
    palco.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); }); // sem o círculo de rolagem automática do botão do meio
    palco.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
    palco.addEventListener('contextmenu', (e) => e.preventDefault());
    $('lousaFerr').addEventListener('click', (e) => { const f = e.target.closest('[data-ferr]'); if (f) escolherFerramenta(f.dataset.ferr); const c = e.target.closest('[data-cor]'); if (c) escolherCor(c.dataset.cor); });
    $('lousaDesfazer').addEventListener('click', () => { if (S && S.pagina) { riscosDaPagina().pop(); S.sujo = true; } });
    $('lousaLimpar').addEventListener('click', () => { if (S && S.pagina) { S.tinta[S.pagina.chave] = []; S.temp = []; S.sujo = true; } });
    $('lousaAnt').addEventListener('click', () => mostrar(S.idx - 1));
    $('lousaProx').addEventListener('click', () => mostrar(S.idx + 1));
    $('lousaMais').addEventListener('click', () => zoomBotao(1.25));
    $('lousaMenos').addEventListener('click', () => zoomBotao(0.8));
    $('lousaAjustar').addEventListener('click', ajustar);
    $('lousaPrint').addEventListener('click', tirarPrint);
    $('lousaNotasBtn').addEventListener('click', () => { $('lousa').classList.toggle('sem-notas'); setTimeout(() => { if (S && S.pagina) mostrar(S.idx); }, 60); });
    $('lousaEncerrar').addEventListener('click', pedirEncerrar);
    $('lousaSair').addEventListener('click', pedirSair);
    $('lousaNotas').addEventListener('click', (e) => { const b = e.target.closest('[data-ins]'); if (b) inserirNota(b.dataset.ins); const rm = e.target.closest('[data-rm-print]'); if (rm) { S.prints.splice(Number(rm.dataset.rmPrint), 1); desenharPrints(); } });
    let tRasc = null;
    $('lousaTexto').addEventListener('input', () => { clearTimeout(tRasc); tRasc = setTimeout(() => { if (S) guardarRascunho(); }, 500); });
    window.addEventListener('resize', () => { if (S && S.pagina) mostrar(S.idx); });
    document.addEventListener('keydown', (e) => {
      if (!S || $('lousa').hidden) return;
      const digitando = /^(textarea|input)$/i.test((e.target && e.target.tagName) || '');
      if (e.key === 'Escape') { if (!$('lousaDialogo').hidden) fecharDialogo(); else if (digitando) e.target.blur(); else pedirSair(); e.preventDefault(); return; }
      if (digitando || !$('lousaDialogo').hidden) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z') { $('lousaDesfazer').click(); e.preventDefault(); return; }
      const mapa = { p: 'ponteiro', c: 'caneta', g: 'marcador', b: 'borracha', h: 'mao' };
      if (mapa[k]) escolherFerramenta(mapa[k]);
      else if (e.key === 'ArrowRight' || e.key === 'PageDown') mostrar(S.idx + 1);
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') mostrar(S.idx - 1);
      else if (k === '+' || k === '=') zoomBotao(1.25);
      else if (k === '-') zoomBotao(0.8);
      else if (k === '0') ajustar();
    });
  }

  raiz.Apresentar = Object.assign({ abrir, fechar, aberta: () => !!S }, api);
})(typeof window !== 'undefined' ? window : globalThis);
