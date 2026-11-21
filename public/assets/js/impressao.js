// impressao.js -- salvar em PDF um documento HTML montado no navegador (PDF das imagens e PDF do memorial), no computador E no celular.
//
// Por que existe: no computador o "quadro escondido" + print() funciona; no CELULAR ele não faz nada (o Chrome do Android e o
// Safari do iPhone ignoram print() dentro de quadro) e imprimir a própria página saía com o layout de celular. Aqui o documento
// é sempre montado PRONTO PARA O PAPEL (A4 deitado, tamanhos em mm) e:
//   - no computador: abre a janela de imprimir (quadro escondido), como sempre;
//   - no celular: abre uma ABA NOVA com o documento (pré-visualização, que já mostra como o PDF vai ficar) e um botão grande
//     "Salvar como PDF". A aba precisa ser aberta NO TOQUE do botão (senão o navegador bloqueia), por isso `iniciar()` deve
//     ser chamado de dentro do clique, ANTES de qualquer espera; depois a aba recebe o documento pronto e abre a impressão.
// A pré-visualização no celular encolhe com transform:scale (NÃO com o `zoom` do CSS: o Chrome do celular aplica um tamanho mínimo de letra
// depois do zoom e as letras pequenas "engordavam", ficando uma por cima da outra).
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
  // O documento final vai pra aba por um endereço de verdade (blob:) em vez de ficar numa página "em branco" montada por script: o Compartilhar >
  // Imprimir do iPhone (Chrome) não respondia numa aba assim. Se o navegador recusar o blob, cai no document.write de sempre.
  function mostrarNaAba(janela, documento) {
    try {
      if (janela.location && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' && typeof Blob !== 'undefined') {
        const url = URL.createObjectURL(new Blob([documento], { type: 'text/html;charset=utf-8' }));
        janela.location.replace(url);
        setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) { /* nada a fazer */ } }, 15 * 60 * 1000);
        return;
      }
    } catch (e) { /* cai no document.write abaixo */ }
    escrever(janela, documento);
  }
  function abrirAbaDePreparo() {
    let w = null;
    try { w = window.open('', '_blank'); } catch (e) { w = null; }
    if (!w) return null;
    try { escrever(w, paginaDePreparo()); } catch (e) { try { w.close(); } catch (e2) { /* já fechada */ } return null; }
    return w;
  }

  // O documento que a aba recebe: o HTML do PDF + barra de ações (só na tela) + zoom pra caber no celular (só na tela).
  function prepararDocumento(html, tituloArquivo, largura, imprimirSozinho, aviso) {
    const estilo = '<style>' +
      '@media screen{html{background:#26282c;-webkit-text-size-adjust:100%;text-size-adjust:100%}body{margin:0;padding-top:var(--rt-barra,72px);display:flow-root}' + // flow-root: a margem negativa que desconta a altura do scale fica DENTRO do corpo (senão o corpo continua com a altura cheia)
      // barra COMPACTA (texto pequeno numa linha, botões embaixo): no celular ela não pode tomar a tela
      '.rt-barra{position:fixed;top:0;left:0;right:0;z-index:2147483000;display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;padding:8px 10px;background:#101114;color:#fff;font:600 13px/1.3 system-ui,-apple-system,Segoe UI,sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.5)}' +
      '.rt-barra #rt-estado{flex:1 1 100%;min-width:0;color:#d6d7db;font-weight:500}.rt-barra button{font:700 14px system-ui,-apple-system,Segoe UI,sans-serif;border:0;border-radius:999px;padding:9px 16px;background:#fff;color:#111;cursor:pointer}' +
      '.rt-barra button:disabled{opacity:.5}.rt-barra #rt-fechar{background:transparent;color:#ddd;border:1px solid #555;padding:8px 14px}' +
      '#rt-folhas{width:' + Number(largura) + 'px;transform-origin:0 0;display:flex;flex-direction:column;align-items:center;gap:12px;padding-bottom:30px}#rt-folhas>*{box-shadow:0 4px 22px rgba(0,0,0,.45);flex:none}' +
      'html.rt-imprimindo .rt-barra{display:none!important}html.rt-imprimindo #rt-folhas{transform:none!important;margin:0!important;width:auto!important;display:block!important}html.rt-imprimindo body{padding-top:0!important}}' +
      '@media print{.rt-barra{display:none!important}#rt-folhas{display:block!important;transform:none!important;margin:0!important;width:auto!important}}' +
      '</style>';
    const barra = '<div class="rt-barra"><span id="rt-estado">Preparando…</span><button type="button" id="rt-imprimir">Salvar como PDF</button><button type="button" id="rt-fechar">Fechar</button><div id="rt-ajuda" hidden></div></div>';
    const script = '<script>(function(){' +
      'var W=' + Number(largura) + ',raiz=document.documentElement,barra=document.querySelector(".rt-barra"),est=document.getElementById("rt-estado"),bt=document.getElementById("rt-imprimir");' +
      'var folhas=document.getElementById("rt-folhas");' +
      // a prévia encolhe com "scale" (a altura que sobra é descontada na margem de baixo; o "zoom" do CSS engordava as letras pequenas no celular)
      'function ajustar(){var z=Math.min(1,(raiz.clientWidth-16)/W);if(z<0.2)z=0.2;raiz.style.setProperty("--rt-z",z);raiz.style.setProperty("--rt-barra",(barra.offsetHeight+8)+"px");' +
      'folhas.style.transform=z<1?"scale("+z+")":"none";folhas.style.marginLeft=Math.max(0,(raiz.clientWidth-W*z)/2)+"px";folhas.style.marginBottom=z<1?(-(folhas.offsetHeight*(1-z)))+"px":"0";}' +
      'ajustar();window.addEventListener("resize",ajustar);' +
      'var abriuImpressao=false;window.addEventListener("beforeprint",function(){abriuImpressao=true;raiz.classList.add("rt-imprimindo");});' +
      'window.addEventListener("afterprint",function(){raiz.classList.remove("rt-imprimindo");ajustar();});' +
      // Chrome/Firefox/Edge do iPhone (CriOS, FxiOS, EdgiOS) NÃO implementam window.print(): o botão não faz nada. Aí o passo a passo manual aparece já de cara.
      // O texto da barra é CURTO; o passo a passo fica escondido atrás do botão "Passo a passo" (o Rodrigo não gostou do texto grande na tela).
      'var ND=/CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent||"");' +
      'var curto=ND?"Toque em Compartilhar e depois em Imprimir.":"Toque em “Salvar como PDF”.";' +
      'var ajuda=document.getElementById("rt-ajuda");' +
      'ajuda.style.cssText="flex:1 1 100%;font:400 13px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;color:#cfd0d4";' +
      'ajuda.textContent="1) Toque no ícone Compartilhar (quadrado com seta, na barra do navegador). 2) Toque em Imprimir. 3) Na tela de impressão, abra a prévia com a pinça (dois dedos). 4) Toque em Compartilhar e em Salvar em Arquivos. Se o Imprimir não responder, abra este site no Safari.";' +
      'if(ND)bt.textContent="Passo a passo";' +
      'bt.onclick=function(){if(ND){ajuda.hidden=!ajuda.hidden;ajustar();return;}abriuImpressao=false;try{window.print();}catch(e){est.textContent="A janela não abriu? "+curto;ajuda.hidden=false;ajustar();return;}setTimeout(function(){if(!abriuImpressao){est.textContent="A janela não abriu? Toque em Compartilhar e depois em Imprimir.";ajuda.hidden=false;ajustar();}},2000);};document.getElementById("rt-fechar").onclick=function(){window.close();};' +
      'var fontes=document.fonts&&document.fonts.ready?Promise.race([document.fonts.ready,new Promise(function(ok){setTimeout(ok,4000);})]):Promise.resolve();' +
      'var prontas=Promise.all([fontes].concat([].map.call(document.images,function(im){return im.decode?im.decode().catch(function(){}):Promise.resolve();})));' +
      'Promise.race([prontas,new Promise(function(ok){setTimeout(ok,12000);})]).then(function(){' + // o botão NUNCA fica preso esperando uma imagem lenta
      'est.textContent=' + JSON.stringify(aviso ? 'Pronto. ' + aviso + ' ' : 'Pronto. ') + '+curto;ajustar();' +
      (imprimirSozinho ? 'if(!ND){setTimeout(function(){try{window.print();}catch(e){}},500);}' : '') +
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

  // ---------- arquivo PDF de verdade (celular) ----------
  // O PDF já está pronto (blob). A aba mostra "PDF pronto" com: Compartilhar/Salvar (folha de compartilhar do aparelho, com o nome certo do arquivo),
  // Abrir o PDF (o leitor do aparelho, que também tem Compartilhar/Salvar em Arquivos) e Baixar o arquivo.
  function paginaDoArquivo(url, nomeArquivo, opcoes) {
    const o = opcoes || {};
    const nome = String(nomeArquivo || 'documento.pdf');
    const seguro = (s) => JSON.stringify(String(s)).replace(/</g, '\\u003c');
    const info = [o.paginas ? o.paginas + (o.paginas === 1 ? ' página' : ' páginas') : '', o.bytes ? (o.bytes / 1048576).toFixed(1).replace('.', ',') + ' MB' : ''].filter(Boolean).join(' · ');
    return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escHtml(nome) + '</title>' +
      '<style>body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:#17181b;color:#eee;font:600 18px/1.35 system-ui,-apple-system,Segoe UI,sans-serif;text-align:center;padding:24px;box-sizing:border-box}' +
      '.ok{width:56px;height:56px;border-radius:50%;background:#2e7d4f;display:flex;align-items:center;justify-content:center;font-size:30px}h1{margin:0;font-size:22px}p{margin:0;color:#aaa;font-weight:400;font-size:14px}' +
      'button,a.sec{display:block;width:min(320px,86vw);box-sizing:border-box;font:700 17px system-ui,-apple-system,Segoe UI,sans-serif;border-radius:999px;padding:15px 20px;text-decoration:none;cursor:pointer}' +
      'button{border:0;background:#fff;color:#111}a.sec{border:1px solid #555;color:#ddd;background:transparent;font-size:15px;padding:12px 20px}small{max-width:330px;color:#aaa;font-weight:400;font-size:13px}</style></head>' +
      '<body><div class="ok">&#10003;</div><h1>PDF pronto</h1><p>' + escHtml(info) + '</p>' +
      '<button type="button" id="bt">Compartilhar / Salvar</button>' +
      '<a class="sec" id="abrir" href="' + escHtml(url) + '">Abrir o PDF</a><a class="sec" id="baixar" href="' + escHtml(url) + '" download="' + escHtml(nome) + '">Baixar o arquivo</a>' +
      '<small>' + (o.aviso ? escHtml(o.aviso) + ' ' : '') + 'Para guardar: toque em Compartilhar / Salvar e escolha “Salvar em Arquivos”.</small>' +
      '<script>(function(){var url=' + seguro(url) + ',nome=' + seguro(nome) + ';' +
      'document.getElementById("bt").onclick=function(){fetch(url).then(function(r){return r.blob();}).then(function(b){var f=new File([b],nome,{type:"application/pdf"});' +
      'if(navigator.canShare&&navigator.canShare({files:[f]}))return navigator.share({files:[f],title:nome});location.href=url;})' +
      '.catch(function(e){if(!e||e.name!=="AbortError")location.href=url;});};})();' + '</' + 'script></body></html>';
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
          mostrarNaAba(janela, prepararDocumento(html, tituloArquivo, largura, true, opcoes && opcoes.aviso));
          return { via: 'janela' };
        }
        if (celular) {
          return {
            via: 'toque',
            abrir() {
              const w = window.open('', '_blank');
              if (!w) throw new Error('O navegador bloqueou a abertura do PDF. Permita pop-ups para este site e tente de novo.');
              mostrarNaAba(w, prepararDocumento(html, tituloArquivo, largura, false, opcoes && opcoes.aviso));
            }
          };
        }
        await imprimirNoQuadro(html, tituloArquivo);
        return { via: 'quadro' };
      },
      // O PDF já é um ARQUIVO (blob): aba "PDF pronto" no celular; no computador baixa direto. -> { via: 'janela' | 'toque' (+ abrir) | 'download' }
      async entregarArquivo(blob, nomeArquivo, opcoes) {
        const url = URL.createObjectURL(blob);
        setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) { /* nada a fazer */ } }, 30 * 60 * 1000);
        const doc = paginaDoArquivo(url, nomeArquivo, opcoes);
        if (janela) {
          if (janela.closed) throw new Error('A aba do PDF foi fechada. Toque em Gerar PDF de novo.');
          mostrarNaAba(janela, doc);
          return { via: 'janela' };
        }
        if (celular) {
          return {
            via: 'toque',
            abrir() {
              const w = window.open('', '_blank');
              if (!w) throw new Error('O navegador bloqueou a abertura do PDF. Permita pop-ups para este site e tente de novo.');
              mostrarNaAba(w, doc);
            }
          };
        }
        const a = document.createElement('a');
        a.href = url; a.download = nomeArquivo; a.style.display = 'none';
        document.body.appendChild(a); a.click(); a.remove();
        return { via: 'download' };
      }
    };
  }

  window.Impressao = { iniciar, config, ehCelular, prepararDocumento, paginaDoArquivo, LARGURA_A4_PAISAGEM };
})();
