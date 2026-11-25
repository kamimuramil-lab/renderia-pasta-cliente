// planta-encaixe.js -- "encaixa" a planta baixa na tela ignorando o espaço em branco (ou de uma cor só) em volta do desenho.
//
// Por quê: o arquiteto envia a imagem como veio do SketchUp/CAD, quase sempre com uma margem grande. O site mostrava a imagem INTEIRA
// ajustada à tela, então a margem aparecia como espaço vazio e a planta ficava pequena (principalmente no celular). Aqui se mede onde o
// desenho está e a tela passa a se ajustar SÓ a essa área. Nada é cortado de verdade: a imagem, os ícones, o leque e os textos continuam
// na mesma posição (frações da imagem inteira); só o enquadramento inicial muda, e o cliente ainda pode arrastar até a borda.
//
// Lógica PURA (sem DOM): recebe pixels (RGBA) e devolve frações da imagem. Na dúvida devolve null = mostrar a imagem inteira, como antes.
// Testado em Node (teste_planta_encaixe.js); quem lê os pixels da imagem é o planta.js.
(function (raiz) {
  'use strict';
  const LIMIAR_COR = 20;        // diferença máxima (0-255) por canal pra um pixel ainda contar como "fundo"
  const MIN_PARTE_FUNDO = 0.7;  // a moldura da imagem precisa ser quase toda da mesma cor, senão não há fundo confiável (foto, degradê, scan sujo)
  const MIN_CONTEUDO = 0.004;   // menos que isso de pixels com desenho = imagem vazia ou quase: não confia
  const CORTE_RUIDO = 0.001;    // ignora 0,1% dos pixels de desenho em cada ponta (poeira, risquinho solto)
  const MARGEM = 0.03;          // folga em volta do desenho, em fração do próprio desenho
  const MARGEM_MIN = 0.012;     // ... e no mínimo isso, em fração da imagem
  const AREA_MAX = 0.9;         // se o desenho já ocupa mais que isso da imagem, não vale mexer
  const LADO_MIN = 0.12;        // desenho muito estreito/baixo em relação à imagem: suspeito, não confia

  const sobreBranco = (v, a) => (a >= 255 ? v : (v * a + 255 * (255 - a)) / 255); // pixel transparente conta como branco

  // Cor de fundo = a cor mais comum na moldura da imagem. Devolve { r, g, b, parte } ou null.
  function corDoFundo(d, w, h) {
    const grupos = new Map();
    let total = 0;
    const amostra = (x, y) => {
      const i = (y * w + x) * 4, a = d[i + 3];
      const r = sobreBranco(d[i], a), g = sobreBranco(d[i + 1], a), b = sobreBranco(d[i + 2], a);
      const k = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const s = grupos.get(k) || { n: 0, r: 0, g: 0, b: 0 };
      s.n++; s.r += r; s.g += g; s.b += b; grupos.set(k, s); total++;
    };
    for (let x = 0; x < w; x++) { amostra(x, 0); amostra(x, h - 1); }
    for (let y = 1; y < h - 1; y++) { amostra(0, y); amostra(w - 1, y); }
    let melhor = null;
    grupos.forEach((s) => { if (!melhor || s.n > melhor.n) melhor = s; });
    return melhor ? { r: melhor.r / melhor.n, g: melhor.g / melhor.n, b: melhor.b / melhor.n, parte: melhor.n / total } : null;
  }

  // dados = { data: RGBA (Uint8ClampedArray ou parecido), width, height } (o ImageData do canvas serve).
  // -> { x0, y0, x1, y1 } em fração da imagem (0..1), ou null (= mostrar a imagem inteira).
  function calcularConteudo(dados) {
    if (!dados || !dados.data || !(dados.width > 8) || !(dados.height > 8)) return null;
    const d = dados.data, w = dados.width, h = dados.height;
    const fundo = corDoFundo(d, w, h);
    if (!fundo || fundo.parte < MIN_PARTE_FUNDO) return null;
    const colunas = new Uint32Array(w), linhas = new Uint32Array(h);
    let n = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4, a = d[i + 3];
        if (Math.abs(sobreBranco(d[i], a) - fundo.r) > LIMIAR_COR || Math.abs(sobreBranco(d[i + 1], a) - fundo.g) > LIMIAR_COR || Math.abs(sobreBranco(d[i + 2], a) - fundo.b) > LIMIAR_COR) {
          colunas[x]++; linhas[y]++; n++;
        }
      }
    }
    if (n < MIN_CONTEUDO * w * h) return null;
    const corte = Math.max(1, Math.floor(n * CORTE_RUIDO));
    const primeiro = (v) => { let s = 0; for (let i = 0; i < v.length; i++) { s += v[i]; if (s > corte) return i; } return 0; };
    const ultimo = (v) => { let s = 0; for (let i = v.length - 1; i >= 0; i--) { s += v[i]; if (s > corte) return i; } return v.length - 1; };
    let x0 = primeiro(colunas) / w, x1 = (ultimo(colunas) + 1) / w, y0 = primeiro(linhas) / h, y1 = (ultimo(linhas) + 1) / h;
    if (x1 - x0 < LADO_MIN || y1 - y0 < LADO_MIN) return null;
    const mx = Math.max(MARGEM_MIN, (x1 - x0) * MARGEM), my = Math.max(MARGEM_MIN, (y1 - y0) * MARGEM);
    const caixa = { x0: Math.max(0, x0 - mx), y0: Math.max(0, y0 - my), x1: Math.min(1, x1 + mx), y1: Math.min(1, y1 + my) };
    return valeAPena(caixa) ? caixa : null;
  }

  const area = (c) => (c.x1 - c.x0) * (c.y1 - c.y0);
  const valeAPena = (c) => !!c && area(c) <= AREA_MAX;

  // Garante que ícones e textos da planta (pontos { x, y, m } em fração da imagem, m = folga) continuem dentro do enquadramento,
  // mesmo que estejam na margem. Sem caixa (= imagem inteira) devolve null. Se depois disso quase nada sobra pra ganhar, também null.
  function unirComPontos(caixa, pontos) {
    if (!caixa) return null;
    const c = { x0: caixa.x0, y0: caixa.y0, x1: caixa.x1, y1: caixa.y1 };
    (pontos || []).forEach((p) => {
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
      const m = Number.isFinite(p.m) ? p.m : 0.04;
      c.x0 = Math.min(c.x0, Math.max(0, p.x - m)); c.x1 = Math.max(c.x1, Math.min(1, p.x + m));
      c.y0 = Math.min(c.y0, Math.max(0, p.y - m)); c.y1 = Math.max(c.y1, Math.min(1, p.y + m));
    });
    return valeAPena(c) ? c : null;
  }

  // Tamanho do palco (px) com a caixa enchendo a área visível (zoom 1) e o deslocamento que a deixa no centro.
  // caixa null = imagem inteira (jeito antigo). nw/nh = tamanho natural da imagem; vw/vh = área visível.
  function geometria(caixa, nw, nh, vw, vh) {
    const c = caixa || { x0: 0, y0: 0, x1: 1, y1: 1 };
    const bw = c.x1 - c.x0, bh = c.y1 - c.y0;
    const escala = Math.min(vw / (bw * nw), vh / (bh * nh));
    const baseW = nw * escala, baseH = nh * escala;
    return { baseW, baseH, tx: (vw - bw * baseW) / 2 - c.x0 * baseW, ty: (vh - bh * baseH) / 2 - c.y0 * baseH };
  }

  const api = { calcularConteudo, unirComPontos, geometria, corDoFundo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.PlantaEncaixe = api;
})(typeof window !== 'undefined' ? window : this);
