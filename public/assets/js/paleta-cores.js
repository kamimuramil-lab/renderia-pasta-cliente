// lib/paleta-cores.js
// Paleta de cores de uma imagem (as 5 cores mais predominantes) para o PDF das imagens do projeto. PURO: recebe os pixels
// (RGBA, de uma versão pequena da imagem) e devolve as cores; sem I.A., sem rede, sem Electron. Determinístico (mesma
// imagem = mesma paleta).
// Roda no app (Node) e na página do cliente (navegador): ESTE arquivo existe em DUAS pastas (skp-to-360-ia/lib e
// pasta-cliente/public/assets/js); o teste teste_pdf_imagens.js confere que são idênticos.
//
// Método: (1) conta os pixels em "caixas" de cor (5 bits por canal) e escolhe como sementes as caixas mais cheias que sejam
// BEM diferentes entre si (senão as 5 cores seriam 5 tons do mesmo bege); (2) refina com k-means (cada pixel vai pra semente
// mais próxima e a semente vira a média do grupo); (3) devolve os grupos do maior pro menor, com a fatia que cada um ocupa.

(function (raiz) {
const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
const paraHex = (r, g, b) => '#' + hex2(r) + hex2(g) + hex2(b);
const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

// pixels: Uint8Array/Buffer/Uint8ClampedArray RGBA (4 bytes por pixel). Ignora pixels quase transparentes.
function paletaDominante(pixels, quantas = 5) {
  const n = Math.max(1, Math.min(10, Math.floor(quantas)));
  const amostra = [];
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    amostra.push([pixels[i], pixels[i + 1], pixels[i + 2]]);
  }
  if (!amostra.length) return [];

  // 1) caixas de cor
  const caixas = new Map();
  amostra.forEach(([r, g, b]) => {
    const chave = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const c = caixas.get(chave) || { n: 0, r: 0, g: 0, b: 0 };
    c.n++; c.r += r; c.g += g; c.b += b;
    caixas.set(chave, c);
  });
  const candidatas = [...caixas.entries()]
    .map(([k, c]) => ({ k, n: c.n, cor: [c.r / c.n, c.g / c.n, c.b / c.n] }))
    .sort((a, b) => (b.n - a.n) || (a.k - b.k)); // empate: ordem estável

  // sementes: as mais cheias que estejam longe das já escolhidas (afrouxa a distância até conseguir n)
  const sementes = [];
  for (const limite of [48, 34, 22, 12, 0]) {
    for (const c of candidatas) {
      if (sementes.length >= n) break;
      if (sementes.every((s) => dist2(s, c.cor) >= limite * limite) && !sementes.includes(c.cor)) sementes.push(c.cor);
    }
    if (sementes.length >= n) break;
  }
  const k = sementes.length;

  // 2) k-means
  let centros = sementes.map((s) => s.slice());
  let atribuicao = new Array(amostra.length).fill(0);
  for (let it = 0; it < 10; it++) {
    const soma = centros.map(() => [0, 0, 0, 0]);
    let mudou = false;
    amostra.forEach((p, i) => {
      let melhor = 0; let md = Infinity;
      for (let j = 0; j < k; j++) { const d = dist2(p, centros[j]); if (d < md) { md = d; melhor = j; } }
      if (atribuicao[i] !== melhor) { atribuicao[i] = melhor; mudou = true; }
      soma[melhor][0] += p[0]; soma[melhor][1] += p[1]; soma[melhor][2] += p[2]; soma[melhor][3]++;
    });
    centros = centros.map((c, j) => (soma[j][3] ? [soma[j][0] / soma[j][3], soma[j][1] / soma[j][3], soma[j][2] / soma[j][3]] : c));
    if (!mudou && it > 0) break;
  }
  const contagem = centros.map(() => 0);
  atribuicao.forEach((j) => { contagem[j]++; });

  // 3) maior -> menor
  return centros
    .map((c, j) => ({ rgb: c.map((v) => Math.round(v)), hex: paraHex(c[0], c[1], c[2]), pct: contagem[j] / amostra.length }))
    .filter((c) => c.pct > 0)
    .sort((a, b) => (b.pct - a.pct) || (a.hex < b.hex ? -1 : 1));
}

// Preto ou branco, o que ler melhor em cima da cor (usado no texto escrito dentro do quadradinho).
function corDoTexto(rgb) {
  const [r, g, b] = rgb;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#1c1c1c' : '#ffffff';
}

const api = { paletaDominante, corDoTexto, paraHex };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else raiz.PaletaCores = api;
})(typeof window !== 'undefined' ? window : this);
