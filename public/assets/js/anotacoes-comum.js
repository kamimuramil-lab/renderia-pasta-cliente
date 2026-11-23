// anotacoes-comum.js -- ícones e desenho dos PINOS das anotações que o arquiteto coloca nas fotos.
//
// ESTE ARQUIVO existe em DUAS pastas -- skp-to-360-ia/renderer e pasta-cliente/public/assets/js --: o editor do app e a página do cliente
// desenham o MESMO pino (um teste confere que os dois são iguais). Cada pino leva o NÚMERO da anotação (o mesmo que aparece no PDF).
//
//   anotacao: { id, icone, texto, imagemR2Key, imagemUrl, x, y }   (x,y = fração da imagem 0..1; 360°: yaw/pitch)
(function (raiz) {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Cada ícone é um SVG completo (forma + símbolo), 32x32, que fica bem sobre foto clara ou escura (contorno branco).
  const CONTORNO = 'stroke="#fff" stroke-width="2.2" stroke-linejoin="round"';
  const ICONES = {
    alerta: { rotulo: 'Atenção', cor: '#f2b01e', svg: `<path d="M16 3.5 29.5 28H2.5z" fill="#f2b01e" ${CONTORNO}/><path d="M16 12v8M16 23.5v.2" stroke="#3a2a00" stroke-width="2.6" stroke-linecap="round"/>` },
    info: { rotulo: 'Informação', cor: '#3d8bf2', svg: `<circle cx="16" cy="16" r="13" fill="#3d8bf2" ${CONTORNO}/><path d="M16 14.5v8M16 9.6v.2" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>` },
    duvida: { rotulo: 'Dúvida', cor: '#8b5cf6', svg: `<circle cx="16" cy="16" r="13" fill="#8b5cf6" ${CONTORNO}/><path d="M12.4 12.6a3.7 3.7 0 1 1 5.3 3.3c-1 .6-1.7 1.3-1.7 2.6M16 22.6v.2" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>` },
    ok: { rotulo: 'Confirmado', cor: '#2eb872', svg: `<circle cx="16" cy="16" r="13" fill="#2eb872" ${CONTORNO}/><path d="M9.8 16.4l4.3 4.3 8-8.6" fill="none" stroke="#fff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>` },
    ideia: { rotulo: 'Sugestão', cor: '#e5632e', svg: `<circle cx="16" cy="16" r="13" fill="#e5632e" ${CONTORNO}/><path d="M12.6 19.6c-1.7-1.3-2.4-3-2.4-4.6a5.8 5.8 0 0 1 11.6 0c0 1.6-.7 3.3-2.4 4.6v1.6h-6.8zM13.2 23.6h5.6" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>` }
  };
  const ORDEM = ['alerta', 'info', 'duvida', 'ok', 'ideia'];
  const iconeValido = (i) => (ICONES[i] ? i : 'alerta');

  function svgIcone(icone, tamanho) {
    const t = tamanho || 30;
    return `<svg viewBox="0 0 32 32" width="${t}" height="${t}" aria-hidden="true" focusable="false">${ICONES[iconeValido(icone)].svg}</svg>`;
  }
  // Pino (botão) já com o número. `estilo` = posição (left/top) que quem desenha calcula.
  function htmlPino(a, numero, estilo, extraClasse) {
    const rot = ICONES[iconeValido(a.icone)].rotulo;
    return `<button type="button" class="an-pino ${extraClasse || ''}" data-an-id="${esc(a.id)}" style="${estilo || ''}" title="${esc(rot)} ${numero}" aria-label="Anotação ${numero}: ${esc(rot)}">${svgIcone(a.icone, 30)}<span class="an-num">${numero}</span></button>`;
  }
  // Texto do balão (quebras de linha preservadas pelo CSS) + imagem opcional.
  function htmlBalao(a, numero) {
    const rot = ICONES[iconeValido(a.icone)].rotulo;
    return `<div class="an-balao-topo"><span class="an-balao-icone">${svgIcone(a.icone, 22)}</span><span class="an-balao-titulo">${numero}. ${esc(rot)}</span><button type="button" class="an-balao-fechar" aria-label="Fechar">×</button></div>`
      + (a.texto ? `<div class="an-balao-texto">${esc(a.texto)}</div>` : '')
      + (a.imagemUrl ? `<a class="an-balao-imagem" href="${esc(a.imagemUrl)}" target="_blank" rel="noopener noreferrer" title="Abrir a imagem"><img src="${esc(a.imagemUrl)}" alt="Imagem da anotação ${numero}" crossorigin="anonymous"></a>` : '');
  }

  const api = { ICONES, ORDEM, iconeValido, svgIcone, htmlPino, htmlBalao, esc };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.AnotacoesComum = api;
})(typeof window !== 'undefined' ? window : globalThis);
