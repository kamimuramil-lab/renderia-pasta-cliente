// planta-textos.js -- TEXTOS que o arquiteto escreve em cima da planta (nome dos ambientes, observações).
//
// ESTE ARQUIVO existe em DUAS pastas -- skp-to-360-ia/renderer e pasta-cliente/public/assets/js --: o editor do app e a página do
// cliente desenham o texto IDÊNTICO a partir dele (um teste confere que os dois são iguais).
//
// Cada texto é guardado em FRAÇÃO da planta (nada de pixels), então fica no lugar certo e do tamanho certo em qualquer tela e zoom:
//   { id, texto, x, y, tamanho, cor, fundo, fundoOpacidade, contorno, negrito }
//   x, y        0..1   centro do texto na planta
//   tamanho     fração da LARGURA da planta (0.018 = 1,8% dela); o desenhista define a variável CSS --pw (largura da planta em px)
//   cor         #rrggbb  cor da letra
//   fundo       #rrggbb | null   null = transparente
//   fundoOpacidade  0..1 (só vale com fundo)
//   contorno    #rrggbb | null   contorno na letra (pra ler bem em cima de linhas e hachuras)
//   negrito     boolean
(function (raiz) {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const PADRAO = { tamanho: 0.018, cor: '#1b1b1b', fundo: null, fundoOpacidade: 0.85, contorno: null, negrito: true };
  const TAMANHO_MIN = 0.006, TAMANHO_MAX = 0.1;
  const ehCor = (c) => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);
  const limitar = (v, mn, mx) => Math.min(mx, Math.max(mn, v));

  function rgba(hex, opacidade) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${limitar(opacidade, 0, 1)})`;
  }
  // Contorno na letra: anel de sombras sem desfoque ao redor de cada letra (funciona igual em todos os navegadores, inclusive no celular).
  function sombraContorno(cor) {
    const e = '0.07em';
    return ['-' + e + ' -' + e, e + ' -' + e, '-' + e + ' ' + e, e + ' ' + e, '0 -' + e, '0 ' + e, '-' + e + ' 0', e + ' 0'].map((d) => `${d} 0 ${cor}`).join(', ');
  }

  // Estilo inline de UM texto (posição em % + aparência). Valores inválidos viram o padrão: nunca quebra a tela.
  function estilo(t) {
    const x = limitar(Number(t.x), 0, 1), y = limitar(Number(t.y), 0, 1);
    const tam = limitar(Number.isFinite(Number(t.tamanho)) ? Number(t.tamanho) : PADRAO.tamanho, TAMANHO_MIN, TAMANHO_MAX);
    const cor = ehCor(t.cor) ? t.cor : PADRAO.cor;
    const partes = [`left:${((Number.isFinite(x) ? x : 0.5) * 100).toFixed(3)}%`, `top:${((Number.isFinite(y) ? y : 0.5) * 100).toFixed(3)}%`, `--t:${tam}`, `color:${cor}`, `font-weight:${t.negrito === false ? 500 : 700}`];
    if (ehCor(t.fundo)) partes.push(`background:${rgba(t.fundo, typeof t.fundoOpacidade === 'number' ? t.fundoOpacidade : PADRAO.fundoOpacidade)}`);
    if (ehCor(t.contorno)) partes.push(`text-shadow:${sombraContorno(t.contorno)}`);
    return partes.join(';');
  }
  function htmlTexto(t, extra) {
    return `<div class="pl-texto ${extra || ''}" data-texto-id="${esc(t.id)}" style="${estilo(t)}">${esc(t.texto)}</div>`;
  }
  function html(textos) { return (Array.isArray(textos) ? textos : []).filter((t) => t && String(t.texto || '').trim()).map((t) => htmlTexto(t)).join(''); }

  const api = { PADRAO, TAMANHO_MIN, TAMANHO_MAX, estilo, htmlTexto, html, ehCor, rgba, sombraContorno };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.PlantaTextos = api;
})(typeof window !== 'undefined' ? window : globalThis);
