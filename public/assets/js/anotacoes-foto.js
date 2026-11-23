// anotacoes-foto.js -- as ANOTAÇÕES do arquiteto no visualizador da página do cliente (foto fixa E 360°).
//
// FOTO FIXA: pinos (ícone + número) por cima da imagem, no lugar que o arquiteto marcou (fração da imagem, então certo em qualquer tela).
// 360°: os pinos são "hotSpots" do pannellum presos a uma DIREÇÃO da cena (yaw/pitch): flutuam no lugar certo enquanto o cliente gira e dá
// zoom, sempre do mesmo tamanho na tela (fácil de tocar no celular).
// Tocar num pino abre um balão com o texto e/ou a imagem. Um botão no canto mostra/esconde os pinos. Sem anotação: nada aparece.
//
// Carregado DEPOIS do anotacoes-comum.js; usa `retanguloImagemRenderizada` (main.js) só em tempo de CHAMADA.
(function () {
  const pid = (id) => document.getElementById(id);
  const ST = { foto: null, visivel: true, abertaId: null, viewer: null, hots: [] };

  const eh360 = () => !!(ST.foto && ST.foto.tipo === '360');
  const lista = () => ((ST.foto && ST.foto.anotacoes) || []).filter((a) => a && (eh360() ? (Number.isFinite(a.yaw) && Number.isFinite(a.pitch)) : (Number.isFinite(a.x) && Number.isFinite(a.y))));

  function fecharBalao() {
    ST.abertaId = null;
    const b = pid('balaoAnotacao'); if (b) { b.hidden = true; b.innerHTML = ''; }
    document.querySelectorAll('.an-pino.aberto').forEach((p) => p.classList.remove('aberto'));
  }

  // pino na tela (foto fixa: dentro da camada; 360°: dentro do ponto do pannellum)
  const pinoDe = (id) => document.querySelector(`.an-pino[data-an-id="${id}"]`);

  function posicionar() {
    const camada = pid('camadaAnotacoes'), img = pid('imgFotoVisualizador'), area = pid('areaImagemVisualizador');
    if (!camada || !ST.foto || eh360()) return;
    const itens = lista();
    if (!itens.length || !ST.visivel) { camada.style.display = 'none'; fecharBalao(); return; }
    const r = window.retanguloImagemRenderizada(img, area);
    camada.style.display = 'block';
    camada.querySelectorAll('.an-pino').forEach((p) => {
      const a = itens.find((x) => x.id === p.dataset.anId);
      if (!a) return;
      p.style.left = `${r.left + a.x * r.width}px`;
      p.style.top = `${r.top + a.y * r.height}px`;
    });
    if (ST.abertaId) posicionarBalao(); // o balão acompanha o pino (rotação da tela, etc.)
  }

  function posicionarBalao() {
    const balao = pid('balaoAnotacao'), area = pid('areaImagemVisualizador');
    const pino = pinoDe(ST.abertaId);
    if (!balao || balao.hidden || !pino) return;
    const margem = 10;
    const bw = balao.offsetWidth, bh = balao.offsetHeight;
    const ra = area.getBoundingClientRect(), rp = pino.getBoundingClientRect(); // vale pra foto fixa e pro 360° (o pino do 360° anda com a cena)
    const px = rp.left + rp.width / 2 - ra.left, py = rp.top + rp.height / 2 - ra.top;
    // à direita do pino se couber; senão à esquerda. Verticalmente alinhado ao pino, sem sair da área.
    let x = px + 22; if (x + bw > area.clientWidth - margem) x = px - 22 - bw;
    let y = py - 20;
    x = Math.max(margem, Math.min(x, area.clientWidth - bw - margem));
    y = Math.max(margem, Math.min(y, area.clientHeight - bh - margem));
    balao.style.left = `${x}px`; balao.style.top = `${y}px`;
  }

  function abrirBalao(id) {
    const itens = lista();
    const i = itens.findIndex((a) => a.id === id);
    if (i < 0) return;
    ST.abertaId = id;
    const balao = pid('balaoAnotacao');
    balao.innerHTML = window.AnotacoesComum.htmlBalao(itens[i], i + 1);
    balao.hidden = false;
    document.querySelectorAll('.an-pino').forEach((p) => p.classList.toggle('aberto', p.dataset.anId === id));
    const img = balao.querySelector('img');
    if (img && !img.complete) img.addEventListener('load', posicionarBalao, { once: true });
    posicionarBalao();
  }

  // ---------- 360°: pontos do pannellum ----------
  function configsDosPontos() {
    const AC = window.AnotacoesComum;
    return lista().map((a, i) => ({
      id: 'an_' + a.id, pitch: a.pitch, yaw: a.yaw, type: 'custom', cssClass: 'an-hotspot',
      createTooltipFunc: (div) => { div.innerHTML = AC.htmlPino(a, i + 1, '', 'an-pino-360'); },
      clickHandlerFunc: (ev) => { if (ev && ev.stopPropagation) ev.stopPropagation(); if (ST.abertaId === a.id) fecharBalao(); else abrirBalao(a.id); }
    }));
  }
  function tirarPontos360() {
    if (!ST.viewer) return;
    ST.hots.forEach((h) => { try { ST.viewer.removeHotSpot(h.id); } catch (e) { /* o viewer já foi destruído */ } });
    ST.hots = [];
  }
  function poePontos360() {
    if (!ST.viewer || !ST.visivel || ST.hots.length) return;
    ST.hots = configsDosPontos();
    ST.hots.forEach((h) => { try { ST.viewer.addHotSpot(h); } catch (e) { /* cena ainda não pronta: tenta de novo no 'load' */ } });
  }

  // Chamado a cada foto mostrada no visualizador. Fixa: pinos quando a imagem carrega. 360°: passa o viewer do pannellum já criado.
  // Foto sem anotação / capa / `foto` nula: some tudo.
  function mostrar(foto, viewer) {
    tirarPontos360();
    ST.foto = foto || null; ST.viewer = null;
    fecharBalao();
    const camada = pid('camadaAnotacoes'), btn = pid('btnVisualizadorAnotacoes');
    if (!camada) return;
    const itens = (!foto || foto.__ehMood) ? [] : lista();
    const nova360 = eh360();
    camada.innerHTML = (!nova360 && itens.length) ? itens.map((a, i) => window.AnotacoesComum.htmlPino(a, i + 1, '')).join('') : '';
    btn.style.display = itens.length ? 'inline-flex' : 'none';
    pid('contagemAnotacoes').textContent = itens.length ? String(itens.length) : '';
    btn.classList.toggle('desligado', !ST.visivel);
    camada.style.display = (!nova360 && itens.length && ST.visivel) ? 'block' : 'none';
    if (nova360 && itens.length && viewer) {
      ST.viewer = viewer;
      const pronto = () => { if (ST.viewer === viewer) poePontos360(); };
      if (viewer.isLoaded()) pronto(); else viewer.on('load', pronto);
    }
    posicionar();
  }

  document.addEventListener('click', (e) => {
    const pino = e.target.closest && e.target.closest('.an-pino');
    if (pino && pid('camadaAnotacoes').contains(pino)) { e.stopPropagation(); if (ST.abertaId === pino.dataset.anId) fecharBalao(); else abrirBalao(pino.dataset.anId); return; }
    if (e.target.closest && e.target.closest('.an-balao-fechar')) { fecharBalao(); return; }
    if (ST.abertaId && !(e.target.closest && (e.target.closest('#balaoAnotacao') || e.target.closest('.an-hotspot')))) fecharBalao(); // tocar fora fecha
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ST.abertaId) fecharBalao(); });
  window.addEventListener('resize', posicionar);
  document.addEventListener('DOMContentLoaded', () => {
    const btn = pid('btnVisualizadorAnotacoes');
    if (btn) btn.addEventListener('click', (e) => {
      e.stopPropagation();
      ST.visivel = !ST.visivel;
      if (eh360()) { fecharBalao(); if (ST.visivel) poePontos360(); else tirarPontos360(); btn.classList.toggle('desligado', !ST.visivel); }
      else mostrar(ST.foto);
    });
  });

  window.AnotacoesFoto = { mostrar, posicionar, fecharBalao, estaVisivel: () => ST.visivel, configsDosPontos };
})();
