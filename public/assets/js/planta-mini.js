// planta-mini.js -- miniatura da PLANTA BAIXA dentro do visualizador de imagem (cliente).
//
// Quando o cliente abre uma imagem (fixa ou 360°) que tem ícone na planta, aparece uma miniatura da planta do arquiteto no
// canto inferior esquerdo, com os ícones de todas as imagens daquele pavimento e a imagem atual em destaque. Dá para ir direto
// para outro ambiente clicando no ícone, sem voltar para a planta. A miniatura AMPLIA ao passar o mouse (no computador) ou ao
// clicar nela / no botão ⤢ (no celular), pra ficar fácil de escolher. "–" esconde (vira um botãozinho "Planta").
//
// Carregado DEPOIS do planta.js e ANTES do main.js. Usa `estado` só em tempo de chamada; navega pelo
// `window.PlantaCliente.abrirFoto` (o mesmo caminho dos ícones da planta grande).
(function () {
  const $ = (id) => document.getElementById(id);
  const M = { fotoId: null, plantaId: null, ampliada: false, fixada: false, escondida: false, razao: 1.4, tAmpliar: null, tReduzir: null };
  const temHover = () => !!(window.matchMedia && window.matchMedia('(hover: hover)').matches);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function plantaDaFoto(foto) {
    if (!foto || foto.__ehMood || !foto.plantaId || !estado.galeria) return null;
    return (estado.galeria.plantas || []).find((p) => p.id === foto.plantaId) || null;
  }
  const temIcone = (f) => !f.arquivada && f.pinPlanta && Number.isFinite(f.pinPlanta.x) && Number.isFinite(f.pinPlanta.y);
  function fotosDoPavimento(plantaId) {
    return (estado.galeria.fotos || []).filter((f) => f.plantaId === plantaId && temIcone(f));
  }
  function statusDe(f) {
    if (f.aprovada) return 'aprovada';
    if ((f.comentarios || []).length) return 'alteracao';
    return 'pendente';
  }
  const nomeDe = (f) => (window.nomeParaCliente ? window.nomeParaCliente(f) : (f.nomeExibicao || 'Imagem'));

  // Tamanho da miniatura: cabe a planta INTEIRA (sem cortar) dentro do limite do estado (pequena ou ampliada).
  function dimensionar() {
    const area = $('areaImagemVisualizador');
    const corpo = $('miniPlantaCorpo');
    if (!area || !corpo) return;
    const maxW = M.ampliada ? Math.min(area.clientWidth * 0.62, 680) : Math.min(190, area.clientWidth * 0.42);
    const maxH = M.ampliada ? area.clientHeight * 0.72 : 150;
    const w = Math.max(80, Math.min(maxW, maxH * M.razao));
    corpo.style.width = `${Math.round(w)}px`;
    corpo.style.height = `${Math.round(w / M.razao)}px`;
    $('miniPlanta').classList.toggle('ampliada', M.ampliada);
    $('btnMiniAmpliar').textContent = M.ampliada && M.fixada ? '⤡' : '⤢';
    $('btnMiniAmpliar').title = M.ampliada && M.fixada ? 'Diminuir a planta' : 'Ampliar a planta';
  }

  function desenharIcones(planta) {
    const fotos = fotosDoPavimento(planta.id);
    const atual = M.fotoId;
    $('miniPlantaPins').innerHTML = fotos.map((f) => {
      const eh360 = f.tipo === '360';
      const ang = f.pinPlanta.angulo;
      const leque = (f.id === atual && !eh360 && typeof ang === 'number' && Number.isFinite(ang))
        ? `<i class="mini-leque" style="left:${f.pinPlanta.x * 100}%; top:${f.pinPlanta.y * 100}%; --ang:${ang}deg"></i>` : '';
      return leque + `<button type="button" class="mini-pin ${eh360 ? 'p360' : 'pfixa'} st-${statusDe(f)} ${f.id === atual ? 'atual' : ''}" data-foto-id="${esc(f.id)}" style="left:${f.pinPlanta.x * 100}%; top:${f.pinPlanta.y * 100}%" title="${esc(nomeDe(f))}" aria-label="${esc(nomeDe(f))}"></button>`;
    }).join('');
  }

  function desenharAbas(planta) {
    const plantas = [...(estado.galeria.plantas || [])].sort((a, b) => a.ordem - b.ordem).filter((p) => fotosDoPavimento(p.id).length);
    const caixa = $('miniPlantaAbas');
    caixa.style.display = plantas.length > 1 ? 'flex' : 'none';
    caixa.innerHTML = plantas.length > 1 ? plantas.map((p) => `<button type="button" class="${p.id === planta.id ? 'ativa' : ''}" data-planta-id="${esc(p.id)}">${esc(p.nome)}</button>`).join('') : '';
  }

  function carregarImagem(planta) {
    const img = $('miniPlantaImg');
    if (img.getAttribute('src') === planta.url) { dimensionar(); return; }
    img.onload = () => { if (img.naturalWidth) M.razao = img.naturalWidth / img.naturalHeight; dimensionar(); };
    img.src = planta.url;
  }

  // Chamado a cada imagem mostrada no visualizador (e depois de aprovar/comentar, pra mudar a cor do ícone).
  function atualizar(foto) {
    const caixa = $('miniPlanta');
    const planta = plantaDaFoto(foto);
    if (!caixa || !planta || !temIcone(foto)) { esconder(); return; }
    M.fotoId = foto.id;
    if (M.plantaId !== planta.id) { M.plantaId = planta.id; }
    mostrarEstado(planta);
  }

  function mostrarEstado(planta) {
    $('miniPlantaNome').textContent = planta.nome || 'Planta';
    $('miniPlanta').style.display = M.escondida ? 'none' : 'block';
    $('btnMiniReabrir').style.display = M.escondida ? 'flex' : 'none';
    desenharAbas(planta);
    desenharIcones(planta);
    carregarImagem(planta);
  }

  function esconder() {
    M.fotoId = null; M.ampliada = false; M.fixada = false;
    clearTimeout(M.tAmpliar); clearTimeout(M.tReduzir);
    const caixa = $('miniPlanta'); if (caixa) { caixa.style.display = 'none'; caixa.classList.remove('ampliada'); }
    const pilula = $('btnMiniReabrir'); if (pilula) pilula.style.display = 'none';
  }

  function ampliar(fixar) { M.ampliada = true; if (fixar) M.fixada = true; dimensionar(); }
  function reduzir() { M.ampliada = false; M.fixada = false; dimensionar(); }

  function ligar() {
    const caixa = $('miniPlanta');
    if (!caixa) return;
    caixa.addEventListener('mouseenter', () => {
      if (!temHover()) return;
      clearTimeout(M.tReduzir);
      M.tAmpliar = setTimeout(() => ampliar(false), 140);
    });
    caixa.addEventListener('mouseleave', () => {
      if (!temHover()) return;
      clearTimeout(M.tAmpliar);
      if (!M.fixada) M.tReduzir = setTimeout(reduzir, 320);
    });
    $('btnMiniAmpliar').addEventListener('click', (e) => { e.stopPropagation(); if (M.ampliada && M.fixada) reduzir(); else ampliar(true); });
    $('btnMiniEsconder').addEventListener('click', (e) => { e.stopPropagation(); M.escondida = true; reduzir(); $('miniPlanta').style.display = 'none'; $('btnMiniReabrir').style.display = 'flex'; });
    $('btnMiniReabrir').addEventListener('click', () => { M.escondida = false; $('btnMiniReabrir').style.display = 'none'; $('miniPlanta').style.display = 'block'; dimensionar(); });
    // clicar na planta (fora de um ícone) amplia/diminui: é o caminho no celular, onde não existe "passar o mouse"
    $('miniPlantaCorpo').addEventListener('click', (e) => {
      if (e.target.closest('.mini-pin')) return;
      if (M.ampliada && M.fixada) reduzir(); else ampliar(true);
    });
    $('miniPlantaPins').addEventListener('click', (e) => {
      const b = e.target.closest('.mini-pin');
      if (!b) return;
      e.stopPropagation();
      clearTimeout(M.tAmpliar);
      reduzir(); // escolheu o ambiente: a planta volta ao tamanho pequeno e libera a imagem
      if (b.dataset.fotoId === M.fotoId) return; // já é esta imagem
      if (window.PlantaCliente && window.PlantaCliente.abrirFoto) window.PlantaCliente.abrirFoto(b.dataset.fotoId);
    });
    $('miniPlantaAbas').addEventListener('click', (e) => {
      const b = e.target.closest('[data-planta-id]');
      if (!b) return;
      const planta = (estado.galeria.plantas || []).find((p) => p.id === b.dataset.plantaId);
      if (planta) { M.plantaId = planta.id; mostrarEstado(planta); }
    });
    window.addEventListener('resize', () => { if (caixa.style.display !== 'none') dimensionar(); });
    ['fullscreenchange', 'webkitfullscreenchange'].forEach((ev) => document.addEventListener(ev, () => setTimeout(dimensionar, 60)));
  }
  document.addEventListener('DOMContentLoaded', ligar);

  window.PlantaMini = { atualizar, esconder };
})();
