// impressao.js -- salvar em PDF um documento HTML montado no navegador (PDF das imagens e PDF do memorial), no computador E no celular.
//
// Por que existe: no computador o "quadro escondido" + print() funciona; no CELULAR ele não faz nada (o Chrome do Android e o
// Safari do iPhone ignoram print() dentro de quadro) e imprimir a própria página saía com o layout de celular. Aqui o documento
// é sempre montado PRONTO PARA O PAPEL (A4 deitado, tamanhos em mm) e:
//   - no computador: abre a janela de imprimir (quadro escondido), como sempre;
//   - no celular: abre uma ABA NOVA com o documento (pré-visualização, que já mostra como o PDF vai ficar) e um botão grande
//     "Salvar como PDF". A aba precisa ser aberta NO TOQUE do botão (senão o navegador bloqueia), por isso `iniciar()` deve
//     ser chamado de dentro do clique, ANTES de qualquer espera; depois a aba recebe o documento pronto e abre a impressão.
// Se o navegador bloquear a aba, `entregar()` devolve { via: 'toque', abrir } e quem chamou mostra um botão "Abrir o PDF".
(function () {
  'use strict';
  const LARGURA_A4_PAISAGEM = 1123; // 297 mm em pixels CSS: a pré-visualização encolhe isso pra caber na tela do celular

  const config = { janela: null }; // null = decide pelo aparelho; true/false = força (testes)
  function ehCelular() {
    if (config.janela !== null) return !!config.janela;
    const ua = navigator.userAgent || '';
    if (/Android|iPhone|iPad|iPod|Mobile|CriOS|FxiOS|EdgA/i.test(ua)) return true;
    return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1; // iPad que se apresenta como Mac
  }
  const escHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- a aba nova ----------
  function paginaDePreparo() {
    return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Preparando o PDF…</title>' +
      '<style>body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:#17181b;color:#eee;font:600 18px/1.35 system-ui,-apple-system,Segoe UI,sans-serif;text-align:center;padding:24px;box-sizing:border-box}' +
      '.tr{width:min(320px,80vw);height:8px;border-radius:99px;background:#33353a;overflow:hidden}.tr>i{display:block;height:100%;width:6%;background:#fff;transition:width .25s}small{font-weight:400;color:#aaa;max-width:330px;font-size:14px}</style></head>' +
      '<body><div id="t">Preparando o PDF…</div><div class="tr"><i id="b"></i></div><small>Não feche esta aba: o PDF está sendo montado e aparece aqui, pronto para salvar.</small></body></html>';
  }
  function escrever(janela, html) { janela.document.open(); janela.document.write(html); janela.document.close(); }
  function abrirAbaDePreparo() {
    let w = null;
    try { w = window.open('', '_blank'); } catch (e) { w = null; }
    if (!w) return null;
    try { escrever(w, paginaDePreparo()); } catch (e) { try { w.close(); } catch (e2) { /* já fechada */ } return null; }
    return w;
  }

  // O documento que a aba recebe: o HTML do PDF + barra de ações (só na tela) + zoom pra caber no celular (só na tela).
  function prepararDocumento(html, tituloArquivo, largura, imprimirSozinho) {
    const estilo = '<style>' +
      '@media screen{html{background:#26282c}body{margin:0;padding-top:var(--rt-barra,72px)}' +
      '.rt-barra{position:fixed;top:0;left:0;right:0;z-index:2147483000;display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;padding:10px 12px;background:#101114;color:#fff;font:600 15px/1.3 system-ui,-apple-system,Segoe UI,sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.5)}' +
      '.rt-barra #rt-estado{flex:1 1 180px;min-width:0}.rt-barra button{font:700 15px system-ui,-apple-system,Segoe UI,sans-serif;border:0;border-radius:999px;padding:12px 20px;background:#fff;color:#111;cursor:pointer}' +
      '.rt-barra button:disabled{opacity:.5}.rt-barra #rt-fechar{background:transparent;color:#ddd;border:1px solid #555;padding:11px 16px}' +
      '#rt-folhas{zoom:var(--rt-z,1);display:flex;flex-direction:column;align-items:center;gap:12px;padding-bottom:30px}#rt-folhas>*{box-shadow:0 4px 22px rgba(0,0,0,.45);flex:none}' +
      'html.rt-imprimindo .rt-barra{display:none!important}html.rt-imprimindo #rt-folhas{zoom:1!important;display:block!important}html.rt-imprimindo body{padding-top:0!important}}' +
      '@media print{.rt-barra{display:none!important}#rt-folhas{display:block!important;zoom:1!important}}' +
      '</style>';
    const barra = '<div class="rt-barra"><span id="rt-estado">Preparando as imagens…</span><button type="button" id="rt-imprimir" disabled>Salvar como PDF</button><button type="button" id="rt-fechar">Fechar</button></div>';
    const script = '<script>(function(){' +
      'var W=' + Number(largura) + ',raiz=document.documentElement,barra=document.querySelector(".rt-barra"),est=document.getElementById("rt-estado"),bt=document.getElementById("rt-imprimir");' +
      'function ajustar(){var z=Math.min(1,(raiz.clientWidth-16)/W);if(z<0.2)z=0.2;raiz.style.setProperty("--rt-z",z);raiz.style.setProperty("--rt-barra",(barra.offsetHeight+8)+"px");}' +
      'ajustar();window.addEventListener("resize",ajustar);' +
      'window.addEventListener("beforeprint",function(){raiz.classList.add("rt-imprimindo");raiz.style.setProperty("--rt-z",1);});' +
      'window.addEventListener("afterprint",function(){raiz.classList.remove("rt-imprimindo");ajustar();});' +
      'bt.onclick=function(){window.print();};document.getElementById("rt-fechar").onclick=function(){window.close();};' +
      'var fontes=document.fonts&&document.fonts.ready?Promise.race([document.fonts.ready,new Promise(function(ok){setTimeout(ok,4000);})]):Promise.resolve();' +
      'Promise.all([fontes].concat([].map.call(document.images,function(im){return im.decode?im.decode().catch(function(){}):Promise.resolve();}))).then(function(){' +
      'est.textContent="Pronto. Toque em \\u201cSalvar como PDF\\u201d e, na janela que abrir, escolha salvar como PDF.";bt.disabled=false;ajustar();' +
      (imprimirSozinho ? 'setTimeout(function(){try{window.print();}catch(e){}},500);' : '') +
      '});})();' + '</' + 'script>';
    let h = String(html);
    h = h.replace(/<title>[\s\S]*?<\/title>/i, () => '<title>' + escHtml(tituloArquivo) + '</title>');
    h = h.replace('</head>', () => '<meta name="viewport" content="width=device-width, initial-scale=1">' + estilo + '</head>');
    h = h.replace(/<body([^>]*)>/i, (m, atributos) => '<body' + atributos + '>' + barra + '<div id="rt-folhas">');
    h = h.replace(/<\/body>/i, () => '</div>' + script + '</body>');
    return h;
  }

  // ---------- computador: quadro escondido + imprimir (o que já funcionava) ----------
  function imprimirNoQuadro(html, tituloArquivo) {
    return new Promise((resolve, reject) => {
      const quadro = document.createElement('iframe');
      quadro.setAttribute('aria-hidden', 'true');
      quadro.style.cssText = 'position:fixed; right:0; bottom:0; width:0; height:0; border:0; visibility:hidden;';
      const tituloAntes = document.title;
      const limpar = () => { document.title = tituloAntes; setTimeout(() => quadro.remove(), 500); };
      quadro.onload = async () => {
        try {
          const doc = quadro.contentDocument;
          const fontes = (doc.fonts && doc.fonts.ready) ? Promise.race([doc.fonts.ready, new Promise((ok) => setTimeout(ok, 4000))]) : Promise.resolve(); // fontes do Google (memorial)
          await Promise.all([fontes, ...[...doc.images].map((im) => (im.decode ? im.decode().catch(() => {}) : Promise.resolve()))]);
          document.title = tituloArquivo; // vira o nome sugerido do arquivo
          quadro.contentWindow.addEventListener('afterprint', limpar, { once: true });
          setTimeout(limpar, 10 * 60 * 1000); // garantia
          quadro.contentWindow.focus();
          quadro.contentWindow.print();
          resolve();
        } catch (e) { limpar(); reject(new Error('Não consegui abrir a janela de impressão. Tente de novo.')); }
      };
      document.body.appendChild(quadro);
      quadro.srcdoc = html;
    });
  }

  // ---------- API ----------
  // CHAMAR DENTRO DO CLIQUE. -> { usaJanela, progresso(texto, fracao), cancelada(), entregar(html, tituloArquivo, {largura}), fechar() }
  function iniciar() {
    const celular = ehCelular();
    const janela = celular ? abrirAbaDePreparo() : null;
    return {
      usaJanela: !!janela,
      celular,
      progresso(texto, fracao) {
        if (!janela || janela.closed) return;
        try {
          janela.document.getElementById('t').textContent = texto;
          janela.document.getElementById('b').style.width = Math.max(6, Math.round((fracao || 0) * 100)) + '%';
        } catch (e) { /* a aba já virou o documento */ }
      },
      cancelada() { return !!(janela && janela.closed); },
      fechar() { if (janela && !janela.closed) { try { janela.close(); } catch (e) { /* já fechada */ } } },
      // -> { via: 'janela' | 'quadro' } ou { via: 'toque', abrir } (celular com a aba bloqueada: quem chamou mostra um botão)
      async entregar(html, tituloArquivo, opcoes) {
        const largura = (opcoes && opcoes.largura) || LARGURA_A4_PAISAGEM;
        if (janela) {
          if (janela.closed) throw new Error('A aba do PDF foi fechada. Toque em Gerar PDF de novo.');
          escrever(janela, prepararDocumento(html, tituloArquivo, largura, true));
          return { via: 'janela' };
        }
        if (celular) {
          return {
            via: 'toque',
            abrir() {
              const w = window.open('', '_blank');
              if (!w) throw new Error('O navegador bloqueou a abertura do PDF. Permita pop-ups para este site e tente de novo.');
              escrever(w, prepararDocumento(html, tituloArquivo, largura, false));
            }
          };
        }
        await imprimirNoQuadro(html, tituloArquivo);
        return { via: 'quadro' };
      }
    };
  }

  window.Impressao = { iniciar, config, ehCelular, prepararDocumento, LARGURA_A4_PAISAGEM };
})();
