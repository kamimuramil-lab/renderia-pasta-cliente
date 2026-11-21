// Cor de destaque da Pasta do Cliente (nov/2026): o arquiteto escolhe UMA cor no app (Configurações > Pasta do Cliente) e este módulo
// calcula, a partir dela, as variáveis de cor do site para o tema ESCURO e para o CLARO, sempre com contraste legível
// (a pessoa escolhe a cor; o site garante que o texto continua lendo). Sem cor escolhida, NADA é injetado: o site fica exatamente como sempre foi.
//
// Mexe só no "acabamento": botões, barra de progresso, ícones, links, bordas de destaque. Fundo, cartões, textos e o verde/vermelho de
// aprovado/pendente continuam os do site.
//
// ARQUIVO COMPARTILHADO: existe igual em pasta-cliente/public/assets/js/ (o site) e skp-to-360-ia/renderer/ (a prévia no app).
// Um teste confere que são idênticos -- mexeu aqui, copie pro outro.
(function (raiz) {
  'use strict';

  // Modelos prontos (cor de destaque). `padrao` = sem cor (o visual cinza-aço de sempre).
  const MODELOS = [
    { id: 'padrao', nome: 'Padrão (cinza aço)', cor: null },
    { id: 'areia', nome: 'Areia', cor: '#c9a86a' },
    { id: 'azul', nome: 'Azul', cor: '#4a86d8' },
    { id: 'petroleo', nome: 'Petróleo', cor: '#3aa0a8' },
    { id: 'verde', nome: 'Verde', cor: '#5aa874' },
    { id: 'oliva', nome: 'Oliva', cor: '#8a9a4a' },
    { id: 'terracota', nome: 'Terracota', cor: '#d2764f' },
    { id: 'vinho', nome: 'Vinho', cor: '#b4506a' },
    { id: 'lilas', nome: 'Lilás', cor: '#8d77d6' }
  ];

  // Superfícies do site (as mesmas do style.css) contra as quais o contraste é conferido.
  const ESCURO = { pagina: '#0b0c0e', cartao: '#141618', cartao2: '#1c1f22' };
  const CLARO = { pagina: '#f5f2ec', cartao: '#ffffff', cartao2: '#f0ece3' };

  function normalizarHex(valor) {
    if (valor === null || valor === undefined) return null;
    const t = String(valor).trim().toLowerCase();
    if (!t) return null;
    const m = /^#?([0-9a-f]{6})$/.exec(t);
    if (m) return '#' + m[1];
    const curto = /^#?([0-9a-f]{3})$/.exec(t);
    if (curto) return '#' + curto[1].split('').map((c) => c + c).join('');
    return null;
  }

  function hexParaRgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function rgbParaHex(rgb) { return '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); }

  function rgbParaHsl(rgb) {
    const r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    const l = (max + min) / 2;
    if (d === 0) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1));
    let h;
    if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
    return [h, s, l];
  }
  function hslParaRgb(hsl) {
    const h = hsl[0], s = hsl[1], l = hsl[2];
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
  }

  // Luminância relativa e razão de contraste (WCAG 2): 4,5 = texto legível; 3 = elemento gráfico/botão visível.
  function luminancia(hex) {
    const [r, g, b] = hexParaRgb(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function contraste(a, b) {
    const la = luminancia(a), lb = luminancia(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  function comLuz(hex, luz) {
    const hsl = rgbParaHsl(hexParaRgb(hex));
    return rgbParaHex(hslParaRgb([hsl[0], hsl[1], Math.max(0, Math.min(1, luz))]));
  }
  function luzDe(hex) { return rgbParaHsl(hexParaRgb(hex))[2]; }

  // Clareia (sentido +1) ou escurece (-1) a cor, mantendo o matiz e a saturação, até ter o contraste mínimo contra `fundo`.
  function ajustar(hex, fundo, minimo, sentido) {
    let luz = luzDe(hex);
    let atual = hex;
    for (let i = 0; i < 100 && contraste(atual, fundo) < minimo; i++) {
      luz += sentido * 0.01;
      if (luz < 0 || luz > 1) break;
      atual = comLuz(hex, luz);
    }
    return atual;
  }

  // Texto (preto do site ou branco) que melhor se lê sobre TODAS as cores da lista (o pior contraste é o que conta).
  function melhorTexto(fundos) {
    const pior = (texto) => Math.min.apply(null, fundos.map((f) => contraste(texto, f)));
    return pior('#0b0c0e') >= pior('#ffffff') ? '#0b0c0e' : '#ffffff';
  }

  // Variáveis de cor para cada tema, a partir da cor escolhida. Devolve null se a cor for inválida.
  function variaveis(corEscolhida) {
    const base = normalizarHex(corEscolhida);
    if (!base) return null;
    const luz = luzDe(base);

    // Tema ESCURO: o destaque tem de aparecer sobre o cartão escuro, e links/ícones têm de ler sobre as superfícies.
    const dDestaque = ajustar(base, ESCURO.cartao, 3, +1);
    const dLuz = luzDe(dDestaque);
    const dGrad = [comLuz(dDestaque, dLuz + 0.07), dDestaque, comLuz(dDestaque, dLuz - 0.12)];
    const escuro = {
      destaque: dDestaque,
      onDestaque: melhorTexto([dDestaque]),
      destaqueHover: comLuz(dDestaque, dLuz - 0.08),
      steel300: ajustar(base, ESCURO.cartao2, 4.5, +1),
      steel500: ajustar(comLuz(base, Math.min(luz, 0.6)), ESCURO.cartao, 3, +1),
      steelGrad: `linear-gradient(135deg, ${dGrad[0]} 0%, ${dGrad[1]} 45%, ${dGrad[2]} 100%)`,
      onSteel: melhorTexto(dGrad)
    };

    // Tema CLARO: o botão é a cor ESCURECIDA até ler sobre a página clara (e o texto do botão vira branco/preto conforme).
    const lDestaque = ajustar(base, CLARO.pagina, 4.5, -1);
    const lLuz = luzDe(lDestaque);
    const lGrad = [comLuz(lDestaque, lLuz + 0.05), comLuz(lDestaque, lLuz - 0.07)];
    const claro = {
      destaque: lDestaque,
      onDestaque: melhorTexto([lDestaque]),
      destaqueHover: comLuz(lDestaque, lLuz + 0.08),
      steel300: ajustar(base, CLARO.cartao2, 4.5, -1),
      steel500: ajustar(base, CLARO.pagina, 3, -1),
      steelGrad: `linear-gradient(135deg, ${lGrad[0]} 0%, ${lGrad[1]} 100%)`,
      onSteel: melhorTexto(lGrad)
    };
    return { base, escuro, claro };
  }

  function bloco(v) {
    return `--destaque:${v.destaque};--on-destaque:${v.onDestaque};--destaque-hover:${v.destaqueHover};`
      + `--steel-300:${v.steel300};--steel-500:${v.steel500};--steel-grad:${v.steelGrad};--on-steel:${v.onSteel};`;
  }

  // CSS que sobrepõe as variáveis do style.css (mesmos seletores do tema, injetado DEPOIS dele, então vence). '' se a cor não vale.
  function css(corEscolhida) {
    const v = variaveis(corEscolhida);
    if (!v) return '';
    return `body{${bloco(v.escuro)}}\n`
      + `body.visual-novo[data-tema="claro"]{${bloco(v.claro)}}\n`
      + `@media (prefers-color-scheme: light){body.visual-novo:not([data-tema="escuro"]){${bloco(v.claro)}}}\n`
      + `.visualizador,.modal-historico{${bloco(v.escuro)}}\n`; // visualizador de foto e histórico são SEMPRE escuros
  }

  // Liga/desliga a cor na página. `cores` = { destaque } (como o servidor manda); sem cor válida, tira o que estiver aplicado.
  function aplicar(cores, doc) {
    const d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d) return false;
    const texto = css(cores && cores.destaque);
    let el = d.getElementById('cores-conta');
    if (!texto) { if (el && el.parentNode) el.parentNode.removeChild(el); return false; }
    if (!el) { el = d.createElement('style'); el.id = 'cores-conta'; d.head.appendChild(el); }
    el.textContent = texto;
    return true;
  }

  const api = { MODELOS, normalizarHex, variaveis, css, aplicar, contraste, luminancia, ajustar, melhorTexto };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.TemaCores = api;
})(typeof window !== 'undefined' ? window : globalThis);
