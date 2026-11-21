// pdf-arquivo.js -- gera um ARQUIVO PDF de verdade (A4 paisagem, sem margens) com o PDF das IMAGENS do projeto, no navegador do cliente.
//
// Por que existe: no iPhone/iPad o PDF saía pela impressão do navegador, e o iOS impõe uma margem branca em volta de cada folha (ignora
// @page{margin:0}), além de não imprimir certas fotos. Aqui cada página é DESENHADA num canvas (mesmo layout do imagens-pdf.js),
// vira um JPEG e um escritor de PDF próprio junta tudo num arquivo. Sem biblioteca, sem rede, sem I.A.
// O desenho segue as medidas do CSS do imagens-pdf.js (mm e pt). Mudou o layout de lá? Ajuste aqui também.
// O texto fica como imagem (não dá pra selecionar/copiar): o ganho é o PDF idêntico à tela, em qualquer aparelho.
// Só roda no navegador (precisa de canvas); `montarPdf` é puro e é testado em Node (test/teste_pdf_arquivo.js).
(function (raiz) {
  'use strict';
  const LARG = 297, ALT = 210;            // folha A4 paisagem, em mm
  const PT = 25.4 / 72;                   // 1 pt em mm
  const PX_CSS = 25.4 / 96;               // 1 px CSS em mm (tamanho natural de uma imagem, como na página HTML)
  const LH = 1.2;                         // "line-height: normal" aproximado
  const FAMILIA = "'Segoe UI', Arial, Helvetica, sans-serif";
  const LARGURA_PX = 2105;                // ~180 dpi na folha A4 paisagem
  const QUALIDADE_JPEG = 0.9;
  const LARGURA_PX_ALTA = 2800;           // ~240 dpi (limite seguro do canvas no iPhone: 2800 x 1980 = 5,5 milhões de pixels)
  const QUALIDADE_JPEG_ALTA = 0.93;
  const PAGINA_PT = [841.89, 595.28];     // A4 paisagem em pontos do PDF

  // ---------- escritor de PDF (puro) ----------
  const latin1 = (s) => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; };
  const h4 = (n) => n.toString(16).toUpperCase().padStart(4, '0');
  // string do PDF: ASCII puro entre parênteses; com acento, UTF-16BE em hexadecimal
  function textoPdf(s) {
    const t = String(s == null ? '' : s);
    if (/^[\x20-\x7e]*$/.test(t)) return '(' + t.replace(/([\\()])/g, '\\$1') + ')';
    let hex = 'FEFF';
    for (const ch of t) {
      const c = ch.codePointAt(0);
      if (c > 0xffff) { const v = c - 0x10000; hex += h4(0xd800 + (v >> 10)) + h4(0xdc00 + (v & 1023)); } else hex += h4(c);
    }
    return '<' + hex + '>';
  }
  const dois = (n) => String(n).padStart(2, '0');
  // paginas: [{ jpeg: Uint8Array, largura, altura, links?: [{ x, y, w, h (mm, do canto superior esquerdo da folha), url }] }]
  //   (um JPEG por página cobrindo a folha inteira; os links viram áreas clicáveis do PDF) -> Uint8Array do arquivo PDF
  function montarPdf(paginas, opcoes) {
    const o = opcoes || {};
    const [wpt, hpt] = PAGINA_PT;
    const partes = [];
    let pos = 0;
    const offs = [];
    const add = (u8) => { partes.push(u8); pos += u8.length; };
    const addTxt = (s) => add(latin1(s));
    const inicioObj = (n) => { offs[n] = pos; addTxt(n + ' 0 obj\n'); };
    const n = paginas.length;
    const idInfo = 3 + 3 * n;
    let proxId = idInfo + 1; // os links (anotações) vêm depois do Info
    const idsLinks = paginas.map((p) => (Array.isArray(p.links) ? p.links : []).map(() => proxId++));
    const ultimoId = proxId - 1;
    addTxt('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
    inicioObj(1); addTxt('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    inicioObj(2); addTxt('<< /Type /Pages /Count ' + n + ' /Kids [' + paginas.map((_, i) => (3 + 3 * i) + ' 0 R').join(' ') + '] >>\nendobj\n');
    paginas.forEach((p, i) => {
      const pg = 3 + 3 * i, ct = pg + 1, im = pg + 2;
      inicioObj(pg); addTxt('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + wpt + ' ' + hpt + '] /Resources << /XObject << /Im0 ' + im + ' 0 R >> >> /Contents ' + ct + ' 0 R' + (idsLinks[i].length ? ' /Annots [' + idsLinks[i].map((id) => id + ' 0 R').join(' ') + ']' : '') + ' >>\nendobj\n');
      const conteudo = 'q ' + wpt + ' 0 0 ' + hpt + ' 0 0 cm /Im0 Do Q';
      inicioObj(ct); addTxt('<< /Length ' + conteudo.length + ' >>\nstream\n' + conteudo + '\nendstream\nendobj\n');
      inicioObj(im);
      addTxt('<< /Type /XObject /Subtype /Image /Width ' + p.largura + ' /Height ' + p.altura + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + p.jpeg.length + ' >>\nstream\n');
      add(p.jpeg);
      addTxt('\nendstream\nendobj\n');
    });
    const d = o.data instanceof Date ? o.data : new Date();
    const dataPdf = 'D:' + d.getFullYear() + dois(d.getMonth() + 1) + dois(d.getDate()) + dois(d.getHours()) + dois(d.getMinutes()) + dois(d.getSeconds());
    inicioObj(idInfo); addTxt('<< /Title ' + textoPdf(o.titulo) + ' /Producer (RENDERIA) /CreationDate (' + dataPdf + ') >>\nendobj\n');
    const kpt = wpt / LARG; // mm -> pontos do PDF
    paginas.forEach((p, i) => (Array.isArray(p.links) ? p.links : []).forEach((l, j) => {
      const x1 = (l.x * kpt).toFixed(2), x2 = ((l.x + l.w) * kpt).toFixed(2), y1 = (hpt - (l.y + l.h) * kpt).toFixed(2), y2 = (hpt - l.y * kpt).toFixed(2);
      inicioObj(idsLinks[i][j]);
      addTxt('<< /Type /Annot /Subtype /Link /Rect [' + x1 + ' ' + y1 + ' ' + x2 + ' ' + y2 + '] /Border [0 0 0] /A << /S /URI /URI ' + textoPdf(l.url) + ' >> >>\nendobj\n');
    }));
    const xref = pos;
    addTxt('xref\n0 ' + (ultimoId + 1) + '\n0000000000 65535 f \n');
    for (let k = 1; k <= ultimoId; k++) addTxt(String(offs[k]).padStart(10, '0') + ' 00000 n \n');
    addTxt('trailer\n<< /Size ' + (ultimoId + 1) + ' /Root 1 0 R /Info ' + idInfo + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    const todo = new Uint8Array(pos);
    let p0 = 0;
    partes.forEach((u) => { todo.set(u, p0); p0 += u.length; });
    return todo;
  }

  // ---------- desenho das páginas (navegador) ----------
  const ehNum = (v) => typeof v === 'number' && isFinite(v);
  function criarPincel(ctx, S) {
    const px = (mm) => mm * S;
    const estilo = (e) => {
      const tam = e.pt * PT * S;
      ctx.font = (e.peso || 400) + ' ' + tam + 'px ' + FAMILIA;
      return { tam, esp: (e.esp || 0) * tam };
    };
    const larguraDe = (txt, tam, esp) => {
      if (!esp) return ctx.measureText(txt).width;
      let w = 0;
      for (const ch of txt) w += ctx.measureText(ch).width + esp;
      return Math.max(0, w - esp);
    };
    const maiuscula = (t, e) => (e.caixa === 'maiuscula' ? String(t).toLocaleUpperCase('pt-BR') : String(t));
    // quebra em linhas que cabem em maxMm (respeita \n; palavra maior que a linha quebra por letra, como overflow-wrap:anywhere)
    function quebrar(txt, e, maxMm) {
      const { tam, esp } = estilo(e);
      const maxPx = px(maxMm);
      const saida = [];
      String(maiuscula(txt, e)).split('\n').forEach((par) => {
        let linha = '';
        par.split(' ').forEach((palavra) => {
          const tenta = linha ? linha + ' ' + palavra : palavra;
          if (larguraDe(tenta, tam, esp) <= maxPx || !tenta) { linha = tenta; return; }
          if (linha) { saida.push(linha); linha = ''; }
          let resto = palavra;
          while (larguraDe(resto, tam, esp) > maxPx && resto.length > 1) {
            let k = resto.length - 1;
            while (k > 1 && larguraDe(resto.slice(0, k), tam, esp) > maxPx) k--;
            saida.push(resto.slice(0, k)); resto = resto.slice(k);
          }
          linha = resto;
        });
        saida.push(linha);
      });
      return saida;
    }
    // uma linha de texto com o centro vertical em yMm; alinhar: 'esq' (x = começo), 'centro' (x = meio), 'dir' (x = fim)
    function linha(txt, e, xMm, yMm, alinhar) {
      const { tam, esp } = estilo(e);
      const t = maiuscula(txt, e);
      const w = larguraDe(t, tam, esp);
      let x = px(xMm);
      if (alinhar === 'centro') x -= w / 2; else if (alinhar === 'dir') x -= w;
      ctx.save();
      ctx.globalAlpha = ehNum(e.alfa) ? e.alfa : 1;
      ctx.fillStyle = e.cor || '#000';
      ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      if (esp) { for (const ch of t) { ctx.fillText(ch, x, px(yMm)); x += ctx.measureText(ch).width + esp; } } else ctx.fillText(t, x, px(yMm));
      ctx.restore();
      return w / S;
    }
    const retangulo = (xMm, yMm, wMm, hMm, cor, alfa) => { ctx.save(); ctx.globalAlpha = ehNum(alfa) ? alfa : 1; ctx.fillStyle = cor; ctx.fillRect(px(xMm), px(yMm), px(wMm), px(hMm)); ctx.restore(); };
    const cobrir = (img, xMm, yMm, wMm, hMm) => { // object-fit: cover
      const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
      const k = Math.max(px(wMm) / iw, px(hMm) / ih);
      const sw = px(wMm) / k, sh = px(hMm) / k;
      ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, px(xMm), px(yMm), px(wMm), px(hMm));
    };
    const encaixar = (nw, nh, maxW, maxH) => { const k = Math.min(1, maxW / nw, maxH / nh); return [nw * k, nh * k]; }; // width/height:auto + max-*: nunca amplia
    function recorteArredondado(xMm, yMm, wMm, hMm, rMm, fazer) {
      const x = px(xMm), y = px(yMm), w = px(wMm), h = px(hMm), r = Math.min(px(rMm), w / 2, h / 2);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
      ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
      ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
      ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
      ctx.closePath(); ctx.clip();
      fazer(); ctx.restore();
    }
    return { px, estilo, larguraDe, quebrar, linha, retangulo, cobrir, encaixar, recorteArredondado, ctx, S };
  }

  const alturaLinha = (pt, mult) => pt * PT * (mult || LH);
  const FIO = 1 * PX_CSS; // um fio de "1px" do CSS

  function carimbo(pc, texto, cor, claro) {
    const e = { pt: 6.8, esp: .05, cor, alfa: 1 };
    pc.linha(texto, e, LARG - 11, ALT - 6 - alturaLinha(6.8) / 2, 'dir');
  }

  // Capa do projeto (APRESENTAÇÃO): foto à esquerda (46%), painel escuro à direita.
  function paginaCapaProjeto(pc, m, imgs) {
    const fotoW = LARG * 0.46;
    pc.retangulo(0, 0, LARG, ALT, '#1b1c1e');
    if (imgs.foto) {
      pc.cobrir(imgs.foto, 0, 0, fotoW, ALT);
      if (!m.fotoPronta) pc.retangulo(0, 0, fotoW, ALT, '#000', 0.45); // sem tratamento prévio: só escurece
    } else pc.retangulo(0, 0, fotoW, ALT, '#000');
    const g = pc.ctx.createLinearGradient(pc.px(fotoW * 0.7), 0, pc.px(fotoW), 0);
    g.addColorStop(0, 'rgba(27,28,30,0)'); g.addColorStop(1, 'rgba(27,28,30,.55)');
    pc.ctx.fillStyle = g; pc.ctx.fillRect(0, 0, pc.px(fotoW), pc.px(ALT));

    const largPainel = LARG - fotoW - 30, cx = fotoW + 15 + largPainel / 2;
    const itens = [];
    if (imgs.logo) {
      const [lw, lh] = pc.encaixar((imgs.logo.naturalWidth || imgs.logo.width) * PX_CSS, (imgs.logo.naturalHeight || imgs.logo.height) * PX_CSS, 112, 58);
      itens.push({ h: lh, mb: 13, desenhar: (y) => pc.ctx.drawImage(imgs.logo, pc.px(cx - lw / 2), pc.px(y), pc.px(lw), pc.px(lh)) });
    }
    itens.push({ h: alturaLinha(13), mb: 5, desenhar: (y) => pc.linha('APRESENTAÇÃO', { pt: 13, peso: 300, cor: '#cdb67a', esp: .46 }, cx, y + alturaLinha(13) / 2, 'centro') });
    itens.push({ h: FIO, mb: 8, desenhar: (y) => pc.retangulo(cx - 15, y, 30, FIO, '#b79d62') });
    const eProj = { pt: 46, peso: 800, cor: '#ffffff', esp: -.01 };
    const lProj = pc.quebrar(m.nomeProjeto, eProj, Math.min(140, largPainel)), hProj = alturaLinha(46, 1.05);
    itens.push({ h: lProj.length * hProj, mb: 8, desenhar: (y) => lProj.forEach((t, i) => pc.linha(t, eProj, cx, y + i * hProj + hProj / 2, 'centro')) });
    if (m.dadosProjeto) {
      const eD = { pt: 10, cor: '#c4c4c4' };
      const lD = pc.quebrar(m.dadosProjeto, eD, Math.min(128, largPainel)), hD = alturaLinha(10, 1.65);
      itens.push({ h: lD.length * hD, mb: 6, desenhar: (y) => lD.forEach((t, i) => pc.linha(t, eD, cx, y + i * hD + hD / 2, 'centro')) });
    }
    const eData = { pt: 8.4, cor: '#8f8f8f', esp: .14, caixa: 'maiuscula' };
    const lData = pc.quebrar(m.textoData, eData, largPainel), hData = alturaLinha(8.4);
    itens.push({ h: lData.length * hData, mb: 0, desenhar: (y) => lData.forEach((t, i) => pc.linha(t, eData, cx, y + i * hData + hData / 2, 'centro')) });
    const total = itens.reduce((s, it) => s + it.h + it.mb, 0);
    let y = (14 + (ALT - 30)) / 2 - total / 2; // centrado entre a margem de cima (14 mm) e a de baixo (30 mm)
    itens.forEach((it) => { it.desenhar(y); y += it.h + it.mb; });

    // rodapé: autoria e direitos autorais à esquerda, data e hora à direita
    const x0 = fotoW + 15, larg = largPainel, hL = alturaLinha(7.2, 1.55);
    const nl = m.escritorio ? 2 : 1, hBloco = nl * hL, base = ALT - 10;
    pc.retangulo(x0, base - hBloco - 3.2 - FIO, larg, FIO, '#3d3f43');
    let yl = base - hBloco + hL / 2;
    if (m.escritorio) {
      const w1 = pc.linha('Projeto por: ', { pt: 7.2, esp: .05, cor: '#9a9a9a' }, x0, yl, 'esq');
      pc.linha(m.escritorio, { pt: 7.2, peso: 700, esp: .05, cor: '#c9c9c9' }, x0 + w1, yl, 'esq');
      yl += hL;
    }
    pc.linha(m.aviso, { pt: 7.2, esp: .05, cor: '#9a9a9a' }, x0, yl, 'esq');
    pc.linha('PDF gerado em ' + m.geradoEm, { pt: 7.2, esp: .05, cor: '#9a9a9a' }, x0 + larg, base - hL / 2, 'dir');
  }

  // Capa do ambiente: com foto em tela cheia (véu escuro embaixo) ou só tipografia sobre fundo claro.
  function paginaCapaAmbiente(pc, m, a, idx, img) {
    const rotulo = 'Ambiente ' + dois(idx + 1), contagem = m.plural(a.imagens.length, 'imagem', 'imagens');
    if (img) {
      pc.retangulo(0, 0, LARG, ALT, '#111');
      pc.cobrir(img, 0, 0, LARG, ALT);
      const g = pc.ctx.createLinearGradient(0, pc.px(ALT), 0, 0);
      g.addColorStop(0, 'rgba(0,0,0,.74)'); g.addColorStop(.38, 'rgba(0,0,0,.34)'); g.addColorStop(.66, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      pc.ctx.fillStyle = g; pc.ctx.fillRect(0, 0, pc.px(LARG), pc.px(ALT));
      const eR = { pt: 9.5, esp: .32, cor: '#ffffff', alfa: .82, caixa: 'maiuscula' };
      const eN = { pt: 36, peso: 300, esp: .08, cor: '#ffffff', caixa: 'maiuscula' };
      const eC = { pt: 9.5, esp: .1, cor: '#ffffff', alfa: .8 };
      const lN = pc.quebrar(a.nome, eN, LARG - 40), hN = alturaLinha(36, 1.12), hR = alturaLinha(9.5), hC = alturaLinha(9.5);
      const total = hR + 4 + lN.length * hN + 5 + FIO + 4 + hC;
      let y = ALT - 19 - total;
      pc.linha(rotulo, eR, 20, y + hR / 2, 'esq'); y += hR + 4;
      lN.forEach((t, i) => pc.linha(t, eN, 20, y + i * hN + hN / 2, 'esq')); y += lN.length * hN + 5;
      pc.retangulo(20, y, 26, FIO, '#d9bf80'); y += FIO + 4;
      pc.linha(contagem, eC, 20, y + hC / 2, 'esq');
      carimbo(pc, 'PDF gerado em ' + m.geradoEm, 'rgba(255,255,255,.6)');
    } else {
      pc.retangulo(0, 0, LARG, ALT, '#efe9dd');
      const eR = { pt: 9.5, esp: .32, cor: '#8f7a45', caixa: 'maiuscula' };
      const eN = { pt: 38, peso: 300, esp: .08, cor: '#232323', caixa: 'maiuscula' };
      const eC = { pt: 9.5, esp: .1, cor: '#7b7567' };
      const lN = pc.quebrar(a.nome, eN, LARG - 44), hN = alturaLinha(38, 1.12), hR = alturaLinha(9.5), hC = alturaLinha(9.5);
      const total = hR + 7 + lN.length * hN + 7 + FIO + 6 + hC;
      let y = ALT / 2 - total / 2;
      pc.linha(rotulo, eR, LARG / 2, y + hR / 2, 'centro'); y += hR + 7;
      lN.forEach((t, i) => pc.linha(t, eN, LARG / 2, y + i * hN + hN / 2, 'centro')); y += lN.length * hN + 7;
      pc.retangulo(LARG / 2 - 13, y, 26, FIO, '#b79d62'); y += FIO + 6;
      pc.linha(contagem, eC, LARG / 2, y + hC / 2, 'centro');
      carimbo(pc, 'PDF gerado em ' + m.geradoEm, '#8a8a8a');
    }
  }

  // alturas das cores da faixa vertical: flex-grow proporcional ao quanto a cor aparece, com altura mínima de 13 mm
  function alturasDaPaleta(cores, alturaTotal) {
    const n = cores.length, gap = .7, disp = alturaTotal - gap * (n - 1);
    const grow = cores.map((c) => (ehNum(c.pct) ? Math.max(0.06, Math.min(1, c.pct)) : 0.2) * 100);
    const h = new Array(n).fill(0), fixo = new Array(n).fill(false);
    for (let volta = 0; volta < n + 1; volta++) {
      const livre = disp - h.reduce((s, v, i) => s + (fixo[i] ? v : 0), 0);
      const soma = grow.reduce((s, v, i) => s + (fixo[i] ? 0 : v), 0);
      let mudou = false;
      for (let i = 0; i < n; i++) {
        if (fixo[i]) continue;
        const alvo = soma ? livre * grow[i] / soma : 0;
        if (alvo < 13) { h[i] = 13; fixo[i] = true; mudou = true; } else h[i] = alvo;
      }
      if (!mudou) break;
    }
    return h;
  }

  // Página de uma imagem: foto + faixa de cores ao lado, marca no canto, rodapé com ambiente/nome e data.
  function paginaImagem(pc, m, a, im, imgs) {
    pc.retangulo(0, 0, LARG, ALT, '#ffffff');
    const cores = m.mostrarPaleta ? im.paletaOk : [];
    const maxW = cores.length ? 253 : 281;
    const [fw, fh] = pc.encaixar(imgs.foto.naturalWidth * PX_CSS, imgs.foto.naturalHeight * PX_CSS, maxW, 188);
    const gw = fw + (cores.length ? 4 + 24 : 0);
    const gx = 8 + (281 - gw) / 2, gy = 7 + (188 - fh) / 2;
    pc.ctx.imageSmoothingEnabled = true; pc.ctx.imageSmoothingQuality = 'high';
    pc.ctx.drawImage(imgs.foto, pc.px(gx), pc.px(gy), pc.px(fw), pc.px(fh));
    if (imgs.marca) {
      const [mw, mh] = pc.encaixar(imgs.marca.naturalWidth * PX_CSS, imgs.marca.naturalHeight * PX_CSS, fw * 0.14, fh * 0.11);
      pc.ctx.drawImage(imgs.marca, pc.px(gx + fw - fw * 0.02 - mw), pc.px(gy + fh * 0.024), pc.px(mw), pc.px(mh));
    }
    if (cores.length) {
      const px0 = gx + fw + 4, alturas = alturasDaPaleta(cores, fh), hRot = alturaLinha(6.4) + .6 + alturaLinha(5.8);
      pc.recorteArredondado(px0, gy, 24, fh, 2.4, () => {
        let y = gy;
        cores.forEach((c, i) => {
          pc.retangulo(px0, y, 24, alturas[i], c.hex);
          const cor = m.corDoTexto(c.rgb), temPct = typeof c.pct === 'number';
          const topo = y + alturas[i] / 2 - (temPct ? hRot : alturaLinha(6.4)) / 2;
          pc.linha(c.hex.toUpperCase(), { pt: 6.4, peso: 700, esp: .05, cor }, px0 + 12, topo + alturaLinha(6.4) / 2, 'centro');
          if (temPct) pc.linha(Math.max(1, Math.round(c.pct * 100)) + '%', { pt: 5.8, esp: .04, cor, alfa: .78 }, px0 + 12, topo + alturaLinha(6.4) + .6 + alturaLinha(5.8) / 2, 'centro');
          y += alturas[i] + .7;
        });
      });
    }
    // rodapé à esquerda: ambiente (e nome da imagem); à direita: data e aviso
    const base = ALT - 5, hA = alturaLinha(7.6);
    if (m.mostrarNomes && im.nome) {
      const hNm = alturaLinha(10.5);
      pc.linha(String(im.nome), { pt: 10.5, cor: '#333333' }, 8, base - hNm / 2, 'esq');
      pc.linha(a.nome, { pt: 7.6, esp: .26, cor: '#9a8650', caixa: 'maiuscula' }, 8, base - hNm - 1.2 - hA / 2, 'esq');
    } else pc.linha(a.nome, { pt: 7.6, esp: .26, cor: '#9a8650', caixa: 'maiuscula' }, 8, base - hA / 2, 'esq');
    const hAv = alturaLinha(6.6), hDt = alturaLinha(6.8);
    pc.linha(m.aviso, { pt: 6.6, esp: .02, cor: '#9a9a9a' }, LARG - 8, base - hAv / 2, 'dir');
    pc.linha('PDF gerado em ' + m.geradoEm, { pt: 6.8, esp: .05, cor: '#8a8a8a' }, LARG - 8, base - hAv - 1 - hDt / 2, 'dir');
  }

  // Página final: MUITO OBRIGADO! + dados do escritório.
  function paginaFinal(pc, m) {
    pc.retangulo(0, 0, LARG, ALT, '#1b1c1e');
    const itens = [];
    const eO = { pt: 30, peso: 300, esp: .34, cor: '#ffffff' }, hO = alturaLinha(30);
    itens.push({ h: hO, mb: 9, desenhar: (y) => pc.linha('MUITO OBRIGADO!', eO, LARG / 2, y + hO / 2, 'centro') });
    itens.push({ h: FIO, mb: 9, desenhar: (y) => pc.retangulo(LARG / 2 - 13, y, 26, FIO, '#b79d62') });
    if (m.escritorio) {
      const eE = { pt: 11, esp: .22, cor: '#cdb67a', caixa: 'maiuscula' }, hE = alturaLinha(11);
      itens.push({ h: hE, mb: 4, desenhar: (y) => pc.linha(m.escritorio, eE, LARG / 2, y + hE / 2, 'centro') });
    }
    const eC = { pt: 10.5, esp: .06, cor: '#c4c4c4' }, hC = alturaLinha(10.5, 1.9);
    m.contatos.forEach((t) => itens.push({ h: hC, mb: 0, desenhar: (y) => pc.linha(t, eC, LARG / 2, y + hC / 2, 'centro') }));
    const total = itens.reduce((s, it) => s + it.h + it.mb, 0);
    let y = ALT / 2 - 4 - total / 2; // o bloco tem 8 mm de folga embaixo, então sobe 4 mm
    itens.forEach((it) => { it.desenhar(y); y += it.h + it.mb; });
    pc.linha(m.aviso, { pt: 6.8, esp: .05, cor: '#7d7d7d' }, LARG / 2, ALT - 9 - alturaLinha(6.8) / 2, 'centro');
  }

  // ---------- orquestração ----------
  const carregarImagem = (uri) => new Promise((ok, erro) => {
    const im = new Image();
    im.onload = () => ok(im);
    im.onerror = () => erro(new Error('imagem inválida'));
    im.src = uri;
  });
  const dataUriParaBytes = (uri) => {
    const b64 = String(uri).slice(String(uri).indexOf(',') + 1);
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  };
  const cedeAVez = () => new Promise((ok) => setTimeout(ok, 0));
  const imagemSegura = (uri) => (typeof uri === 'string' && /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(uri) ? uri : null);

  // Baixa uma imagem (fetch com CORS, cache desligado) e devolve um canvas REDUZIDO a no máximo ladoMax px: o memorial tem dezenas de fotos
  // de 20 mm, e guardar cada uma em 2400 px estouraria a memória do celular. Plano B: <img crossorigin>. Lança erro se não conseguir.
  async function baixarImagem(url, ladoMax) {
    let fonte = null, motivo = '';
    try {
      const resp = await fetch(url, { mode: 'cors', cache: 'no-store' });
      if (!resp.ok) throw new Error('o servidor das imagens respondeu ' + resp.status);
      const blob = await resp.blob();
      if (raiz.createImageBitmap) { try { fonte = await raiz.createImageBitmap(blob); } catch (e) { fonte = null; } }
      if (!fonte) {
        const obj = URL.createObjectURL(blob);
        try { fonte = await carregarImagem(obj); } finally { setTimeout(() => URL.revokeObjectURL(obj), 5000); }
      }
    } catch (e) { motivo = (e && e.message) || 'falha ao baixar'; }
    if (!fonte) {
      fonte = await new Promise((ok, erro) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => ok(im); im.onerror = () => erro(new Error(motivo || 'imagem indisponível')); im.src = url; });
    }
    const w = fonte.naturalWidth || fonte.width, h = fonte.naturalHeight || fonte.height;
    const k = Math.min(1, ladoMax / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(fonte, 0, 0, c.width, c.height);
    if (fonte.close) fonte.close();
    return c;
  }

  function suportado() {
    try {
      if (typeof document === 'undefined' || typeof Blob === 'undefined' || typeof atob !== 'function') return false;
      const c = document.createElement('canvas'); c.width = 8; c.height = 8;
      const ctx = c.getContext('2d');
      return !!(ctx && typeof ctx.drawImage === 'function' && String(c.toDataURL('image/jpeg')).indexOf('data:image/jpeg') === 0);
    } catch (e) { return false; }
  }

  // opcoes: as MESMAS do ImagensPdf.montarHtml (nomeProjeto, dadosProjeto, escritorio, logo, marca, fotoCapa, contatos, mostrarNomes, mostrarPaleta,
  //   agora, qualidade ('alta' = 240 dpi/JPEG 0,93; senão 180 dpi/0,9), ambientes [{ nome, capa, capaPronta, imagens [{ id, nome, uri, paleta }] }]). ganchos: { progresso(feito, total), cancelada() }.
  // -> { blob (application/pdf), paginas, bytes }; lança erro se não houver imagem.
  async function gerarImagens(opcoes, ganchos) {
    const o = opcoes || {}, g = ganchos || {};
    const I = raiz.ImagensPdf, P = raiz.PaletaCores;
    if (!I || !P) throw new Error('módulos do PDF não carregados');
    const agora = o.agora instanceof Date ? o.agora : new Date();
    const ambientes = (Array.isArray(o.ambientes) ? o.ambientes : [])
      .map((a) => ({ nome: String((a && a.nome) || '').trim() || 'Outras imagens', capa: imagemSegura(a && a.capa), imagens: ((a && a.imagens) || []).filter((i) => i && imagemSegura(i.uri)) }))
      .filter((a) => a.imagens.length);
    const totalImgs = ambientes.reduce((s, a) => s + a.imagens.length, 0);
    if (!totalImgs) throw new Error('Não há imagens para gerar o PDF com essa seleção.');
    const c = o.contatos && typeof o.contatos === 'object' ? o.contatos : {};
    const m = {
      nomeProjeto: String(o.nomeProjeto || ''), dadosProjeto: String(o.dadosProjeto || ''), escritorio: String(o.escritorio || '').trim(),
      mostrarNomes: !!o.mostrarNomes, mostrarPaleta: o.mostrarPaleta !== false, fotoPronta: !!imagemSegura(o.fotoCapa),
      aviso: I.AVISO_AUTORAL, geradoEm: I.dataHoraCurta(agora), plural: I.plural, corDoTexto: P.corDoTexto,
      textoData: I.dataPorExtenso(agora) + ' · ' + I.plural(ambientes.length, 'ambiente', 'ambientes') + ' · ' + I.plural(totalImgs, 'imagem', 'imagens'),
      contatos: [c.whatsapp, c.email, c.instagram].map((x) => String(x || '').trim()).filter(Boolean)
    };
    const totalPaginas = 1 + ambientes.length + totalImgs + 1;
    const alta = o.qualidade === 'alta'; // alta: ~240 dpi (as fotos do site têm até 2400 px: cabem sem perder detalhe) e JPEG mais forte
    const larguraPx = alta ? LARGURA_PX_ALTA : LARGURA_PX, qualidadeJpeg = alta ? QUALIDADE_JPEG_ALTA : QUALIDADE_JPEG;
    const canvas = document.createElement('canvas');
    canvas.width = larguraPx; canvas.height = Math.round(larguraPx * ALT / LARG);
    const ctx = canvas.getContext('2d');
    const pc = criarPincel(ctx, canvas.width / LARG);
    const paginas = [];
    const fechar = async (rotulo) => {
      if (g.cancelada && g.cancelada()) throw new Error('A aba do PDF foi fechada. Toque em Gerar PDF de novo.');
      paginas.push({ jpeg: dataUriParaBytes(canvas.toDataURL('image/jpeg', qualidadeJpeg)), largura: canvas.width, altura: canvas.height });
      if (g.progresso) g.progresso(paginas.length, totalPaginas, rotulo);
      await cedeAVez();
    };

    const logo = imagemSegura(o.logo) ? await carregarImagem(o.logo).catch(() => null) : null;
    const marca = imagemSegura(o.marca) ? await carregarImagem(o.marca).catch(() => null) : null;
    let foto = null;
    const fotoUri = imagemSegura(o.fotoCapa) || (ambientes[0].imagens[0] && imagemSegura(ambientes[0].imagens[0].uri));
    if (fotoUri) foto = await carregarImagem(fotoUri).catch(() => null);
    paginaCapaProjeto(pc, m, { logo, foto });
    await fechar('capa');

    for (let ai = 0; ai < ambientes.length; ai++) {
      const a = ambientes[ai];
      const capa = a.capa ? await carregarImagem(a.capa).catch(() => null) : null;
      paginaCapaAmbiente(pc, m, a, ai, capa);
      await fechar('ambiente');
      for (const im of a.imagens) {
        const foto2 = await carregarImagem(im.uri);
        im.paletaOk = (Array.isArray(im.paleta) ? im.paleta : []).map((p) => ({ ...p, hex: /^#[0-9a-fA-F]{6}$/.test(p && p.hex) ? p.hex.toLowerCase() : null })).filter((p) => p.hex).map((p) => ({
          ...p, rgb: Array.isArray(p.rgb) && p.rgb.length === 3 ? p.rgb : [parseInt(p.hex.slice(1, 3), 16), parseInt(p.hex.slice(3, 5), 16), parseInt(p.hex.slice(5, 7), 16)]
        }));
        paginaImagem(pc, m, a, im, { foto: foto2, marca });
        await fechar('imagem');
      }
    }
    paginaFinal(pc, m);
    await fechar('final');
    const bytes = montarPdf(paginas, { titulo: 'Imagens do projeto — ' + m.nomeProjeto, data: agora });
    return { blob: new Blob([bytes], { type: 'application/pdf' }), paginas: paginas.length, bytes: bytes.length };
  }

  const api = {
    montarPdf, gerarImagens, suportado, alturasDaPaleta, textoPdf,
    // ferramentas de desenho, usadas também pelo memorial-arquivo.js
    criarPincel, alturaLinha, carregarImagem, baixarImagem, dataUriParaBytes, cedeAVez,
    medidas: { LARG, ALT, PX_CSS, FIO, PT, LARGURA_PX, LARGURA_PX_ALTA, QUALIDADE_JPEG, QUALIDADE_JPEG_ALTA }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.PdfArquivo = api;
})(typeof window !== 'undefined' ? window : this);
