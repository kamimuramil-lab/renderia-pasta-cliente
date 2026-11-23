// anotacoes-foto.js -- as ANOTAÇÕES do arquiteto sobre a foto, no visualizador da página do cliente.
//
// Pinos (ícone + número) por cima da imagem, no lugar que o arquiteto marcou (fração da imagem, então certo em qualquer tela); tocar num
// pino abre um balão com o texto e/ou a imagem. Um botão no canto mostra/esconde os pinos. Foto sem anotação: nada aparece.
//
// Carregado DEPOIS do anotacoes-comum.js; usa `retanguloImagemRenderizada` (main.js) só em tempo de CHAMADA.
(function () {
  const pid = (id) => document.getElementById(id);
  const ST = { foto: null, visivel: true, abertaId: null };

  const lista = () => ((ST.foto && ST.foto.anotacoes) || []).filter((a) => a && Number.isFinite(a.x) && Number.isFinite(a.y));

  function fecharBalao() { ST.abertaId = null; const b = pid('balaoAnotacao'); if (b) { b.hidden = true; b.innerHTML = ''; } document.querySelectorAll('.an-pino.aberto').forEach((p) => p.classList.remove('aberto')); }

  function posicionar() {
    const camada = pid('camadaAnotacoes'), img = pid('imgFotoVisualizador'), area = pid('areaImagemVisualizador');
    if (!camada || !ST.foto) return;
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
    const pino = document.querySelector(`.an-pino[data-an-id="${ST.abertaId}"]`);
    if (!balao || balao.hidden || !pino) return;
    const margem = 10;
    const bw = balao.offsetWidth, bh = balao.offsetHeight;
    const px = parseFloat(pino.style.left) || 0, py = parseFloat(pino.style.top) || 0;
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

  // Chamado a cada foto mostrada no visualizador (e quando a imagem termina de carregar). Foto sem anotação / capa / 360°: some tudo.
  function mostrar(foto) {
    ST.foto = foto || null;
    fecharBalao();
    const camada = pid('camadaAnotacoes'), btn = pid('btnVisualizadorAnotacoes');
    if (!camada) return;
    const itens = (!foto || foto.__ehMood || foto.tipo === '360') ? [] : lista();
    camada.innerHTML = itens.map((a, i) => window.AnotacoesComum.htmlPino(a, i + 1, '')).join('');
    btn.style.display = itens.length ? 'inline-flex' : 'none';
    pid('contagemAnotacoes').textContent = itens.length ? String(itens.length) : '';
    btn.classList.toggle('desligado', !ST.visivel);
    camada.style.display = itens.length && ST.visivel ? 'block' : 'none';
    posicionar();
  }

  document.addEventListener('click', (e) => {
    const pino = e.target.closest && e.target.closest('.an-pino');
    if (pino && pid('camadaAnotacoes').contains(pino)) { e.stopPropagation(); if (ST.abertaId === pino.dataset.anId) fecharBalao(); else abrirBalao(pino.dataset.anId); return; }
    if (e.target.closest && e.target.closest('.an-balao-fechar')) { fecharBalao(); return; }
    if (ST.abertaId && !(e.target.closest && e.target.closest('#balaoAnotacao'))) fecharBalao(); // tocar fora fecha
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ST.abertaId) fecharBalao(); });
  window.addEventListener('resize', posicionar);
  document.addEventListener('DOMContentLoaded', () => {
    const btn = pid('btnVisualizadorAnotacoes');
    if (btn) btn.addEventListener('click', (e) => { e.stopPropagation(); ST.visivel = !ST.visivel; mostrar(ST.foto); });
  });

  window.AnotacoesFoto = { mostrar, posicionar, fecharBalao, estaVisivel: () => ST.visivel };
})();
