// memorial-arquivo.js -- gera o PDF do MEMORIAL DE ITENS como ARQUIVO de verdade (A4 paisagem, sem margem do iOS), no navegador do cliente.
//
// Mesmo método do PDF das imagens (pdf-arquivo.js): cada página é desenhada num canvas, vira JPEG e o escritor de PDF junta tudo.
// O link "Ver produto" vira área clicável de verdade no PDF. O layout segue o memorial-doc.js (o documento que vai pra impressão):
// mudou o layout lá? Ajuste aqui também. Só o celular usa isto (no computador o memorial continua saindo pela impressão).
(function (raiz) {
  'use strict';
  const LARG = 297, ALT = 210;
  const MARG = 10, MARG_BAIXO = 17;                 // @page { margin: 10mm 10mm 17mm }
  const LIMITE = ALT - MARG_BAIXO;                  // até onde o conteúdo desce
  const PX = 25.4 / 96;                             // 1 px do CSS em mm
  const PAD_X = 6 * PX, PAD_Y = 5 * PX;             // padding das células (6px / 5px)
  const BORDA = 1 * PX;
  const LH_TD = 1.5, LH_TH = 1.55;
  // larguras (mm) das colunas; a soma é ajustada pra caber na tabela inteira
  const COLUNAS = [
    { t: 'Nº', w: 11 }, { t: 'Foto', w: 24 }, { t: 'Item', w: 52 }, { t: 'Ambiente', w: 38 },
    { t: 'Empresa', w: 32 }, { t: 'Especificações', w: 62 }, { t: 'Dimensões', w: 42 }, { t: 'Qtd.', w: 14 }
  ];
  const E = {
    td: { pt: 8.5, cor: '#1c1c1c' }, num: { pt: 8.5, peso: 700, cor: '#666666' }, item: { pt: 8.5, peso: 700, cor: '#1c1c1c' },
    link: { pt: 9, cor: '#1c1c1c' }, chip: { pt: 8.25, peso: 700, cor: '#555555' },
    th: { pt: 8.25, peso: 700, esp: .06, cor: '#444444', caixa: 'maiuscula' }
  };
  const PT = 25.4 / 72;
  const hLinha = (pt, mult) => pt * PT * (mult || LH_TD);

  const hrefSeguro = (url) => { try { const u = new URL(url); return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : null; } catch (e) { return null; } };
  const ehNum = (v) => typeof v === 'number' && isFinite(v);

  function caminho(ctx, S, x, y, w, h, r) {
    x *= S; y *= S; w *= S; h *= S; r = Math.min(r * S, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  // ---------- medidas de uma linha da tabela ----------
  function medirLinha(pc, it, cols) {
    const larg = (i) => cols[i].w - 2 * PAD_X;
    const texto = (txt, e, w) => { const linhas = pc.quebrar(txt, e, w); return { linhas, h: linhas.length * hLinha(e.pt) }; };
    const href = it.link ? hrefSeguro(it.link) : null;
    const nome = pc.quebrar(String(it.item || ''), E.item, larg(2));
    const m = {
      num: texto(String(it.numero == null ? '' : it.numero), E.num, larg(0)),
      item: { linhas: nome, href, h: nome.length * hLinha(E.item.pt) + (href ? hLinha(E.link.pt) : 0) },
      emp: texto(String(it.empresa || '—'), E.td, larg(4)),
      esp: texto(String(it.especificacoes || '—'), E.td, larg(5)),
      dim: texto(String(it.dimensoes || '—'), E.td, larg(6)),
      qtd: texto(String(it.quantidade || '—'), E.td, larg(7))
    };
    // ambientes: etiquetas arredondadas que quebram de linha quando não cabem
    const ambs = (it.ambientes || []).map(String);
    if (ambs.length) {
      const { tam, esp } = pc.estilo(E.chip);
      let x = 0, r = 0;
      const chips = ambs.map((txt) => {
        const w = pc.larguraDe(txt, tam, esp) / pc.S + 2 * 7 * PX + 2 * BORDA;
        if (x > 0 && x + w > larg(3)) { r++; x = 0; }
        const c = { txt, x, r, w }; x += w + 4 * PX; return c;
      });
      m.amb = { chips, h: (r + 1) * (hLinha(E.chip.pt) + 2 * PX + 2 * BORDA + 4 * PX) };
    } else m.amb = { chips: null, linhas: ['—'], h: hLinha(8.5) };
    m.h = Math.max(it.fotoUrl ? 20 : 0, m.num.h, m.item.h, m.amb.h, m.emp.h, m.esp.h, m.dim.h, m.qtd.h) + 2 * PAD_Y + BORDA;
    return m;
  }

  // ---------- gerar ----------
  // o: { nomeProjeto, logo (url|null), itens, setores, setor ('' = todos), agora, escritorio { nome, whatsapp, email, instagram } }
  // g: { progresso(texto, fracao), cancelada() } -> { blob, paginas, bytes, aviso }
  async function gerar(o, g) {
    const PA = raiz.PdfArquivo;
    if (!PA) throw new Error('módulos do PDF não carregados');
    const ganchos = g || {};
    const itens = Array.isArray(o.itens) ? o.itens : [];
    const setores = [...(Array.isArray(o.setores) ? o.setores : [])];
    itens.forEach((i) => { if (!setores.includes(i.setor)) setores.push(i.setor); });
    const incluidos = setores.filter((s) => (!o.setor || s === o.setor) && itens.some((i) => i.setor === s));
    if (!incluidos.length) throw new Error('Não há itens no memorial para gerar o PDF.');
    const agora = o.agora instanceof Date ? o.agora : new Date();
    const verifica = () => { if (ganchos.cancelada && ganchos.cancelada()) throw new Error('A aba do PDF foi fechada. Toque em Gerar PDF de novo.'); };
    const avisar = (texto, fr) => { if (ganchos.progresso) ganchos.progresso(texto, fr); };

    // 1) fotos dos itens (pequenas: 20 mm) e logo, com 4 downloads de cada vez
    const doProjeto = incluidos.flatMap((s) => itens.filter((i) => i.setor === s));
    const fotos = new Map();
    const urls = [...new Set(doProjeto.map((i) => i.fotoUrl).filter(Boolean))];
    let feitas = 0, falhas = 0, proxima = 0;
    const ladoFoto = 520; // 20 mm a 240 dpi = 190 px: 520 dá folga e pesa pouco
    const trabalhador = async () => {
      while (proxima < urls.length) {
        verifica();
        const url = urls[proxima++];
        try { fotos.set(url, await PA.baixarImagem(url, ladoFoto)); } catch (e) { falhas++; }
        feitas++;
        avisar('Baixando as fotos ' + feitas + ' de ' + urls.length + '...', urls.length ? feitas / urls.length * 0.5 : 0.5);
      }
    };
    await Promise.all([trabalhador(), trabalhador(), trabalhador(), trabalhador()]);
    let logo = null;
    if (o.logo) { try { logo = await PA.baixarImagem(o.logo, 1200); } catch (e) { logo = null; } }

    // 2) layout: onde cada coisa cai, página por página
    const M = PA.medidas;
    const canvas = document.createElement('canvas');
    canvas.width = M.LARGURA_PX_ALTA; canvas.height = Math.round(M.LARGURA_PX_ALTA * ALT / LARG);
    const ctx = canvas.getContext('2d');
    const S = canvas.width / LARG;
    const pc = PA.criarPincel(ctx, S);
    const somaCols = COLUNAS.reduce((s, c) => s + c.w, 0), larguraUtil = LARG - 2 * MARG - 2 * BORDA;
    const cols = COLUNAS.map((c) => ({ t: c.t, w: c.w * larguraUtil / somaCols }));
    const xCol = []; { let x = MARG + BORDA; cols.forEach((c) => { xCol.push(x); x += c.w; }); }
    const hTh = hLinha(E.th.pt, LH_TH) + 2 * PAD_Y + BORDA;
    const hTituloSetor = hLinha(9.75, LH_TH) + 10 * PX;

    // cabeçalho do documento
    const eTitulo = { pt: 15, peso: 300, esp: .14, cor: '#1c1c1c' }, eProj = { pt: 30, peso: 800, esp: -.01, cor: '#1c1c1c' }, eData = { pt: 8.5, cor: '#777777' };
    let lw = 0, lh = 0;
    if (logo) { const k = Math.min(50 / logo.width, 16 / logo.height); lw = logo.width * k; lh = logo.height * k; }
    const xTexto = MARG + (logo ? lw + 16 * PX : 0);
    const linhasProj = pc.quebrar(String(o.nomeProjeto || ''), eProj, LARG - MARG - xTexto);
    const hProjLinha = hLinha(30, 1.1);
    const hBlocoTexto = hLinha(15, LH_TH) + 2 + linhasProj.length * hProjLinha + 4 + hLinha(8.5, LH_TH);
    const hCab = Math.max(lh, hBlocoTexto);
    const dataTxt = agora.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

    const paginas = [];
    const nova = () => { const p = { blocos: [] }; paginas.push(p); return p; };
    let pag = nova();
    pag.blocos.push({ t: 'cab' });
    let y = MARG + hCab + 4 + 2 * PX + 6;
    incluidos.forEach((setor) => {
      const doSetor = itens.filter((i) => i.setor === setor);
      const med = doSetor.map((it) => medirLinha(pc, it, cols));
      if (y + hTituloSetor + hTh + med[0].h > LIMITE) { pag = nova(); y = MARG; } // título e cabeçalho da tabela nunca ficam sozinhos no pé da folha
      pag.blocos.push({ t: 'setor', y, setor, n: doSetor.length });
      y += hTituloSetor;
      let frag = { t: 'frag', y0: y, linhas: [] };
      pag.blocos.push(frag);
      y += hTh;
      doSetor.forEach((it, k) => {
        if (y + med[k].h > LIMITE && frag.linhas.length) {
          frag.y1 = y;
          pag = nova(); y = MARG;
          frag = { t: 'frag', y0: y, linhas: [] };
          pag.blocos.push(frag);
          y += hTh;
        }
        frag.linhas.push({ it, m: med[k], y });
        y += med[k].h;
      });
      frag.y1 = y;
      y += 6;
    });
    const total = paginas.length;

    // 3) desenho
    const e = o.escritorio || {};
    const rodape = [e.nome, e.whatsapp, e.email, e.instagram].map((x) => String(x || '').trim()).filter(Boolean).join('  ·  ');
    const saida = [];
    for (let pi = 0; pi < total; pi++) {
      verifica();
      const links = [];
      pc.retangulo(0, 0, LARG, ALT, '#ffffff');
      paginas[pi].blocos.forEach((b) => {
        if (b.t === 'cab') {
          if (logo) ctx.drawImage(logo, MARG * S, (MARG + (hCab - lh) / 2) * S, lw * S, lh * S);
          let yt = MARG + (hCab - hBlocoTexto) / 2;
          pc.linha('MEMORIAL DE ITENS', eTitulo, xTexto, yt + hLinha(15, LH_TH) / 2, 'esq'); yt += hLinha(15, LH_TH) + 2;
          linhasProj.forEach((t, i) => pc.linha(t, eProj, xTexto, yt + i * hProjLinha + hProjLinha / 2, 'esq')); yt += linhasProj.length * hProjLinha + 4;
          pc.linha(dataTxt, eData, xTexto, yt + hLinha(8.5, LH_TH) / 2, 'esq');
          pc.retangulo(MARG, MARG + hCab + 4, LARG - 2 * MARG, 2 * PX, '#1c1c1c');
        } else if (b.t === 'setor') {
          const cy = b.y + hLinha(9.75, LH_TH) / 2;
          const w1 = pc.linha(b.setor, { pt: 9.75, peso: 800, esp: .08, cor: '#1c1c1c', caixa: 'maiuscula' }, MARG, cy, 'esq');
          pc.linha(String(b.n), { pt: 9.75, peso: 700, cor: '#888888' }, MARG + w1 + 1.2 + 6 * PX, cy, 'esq');
        } else if (b.t === 'frag') {
          const x0 = MARG, w0 = LARG - 2 * MARG, h0 = b.y1 - b.y0;
          ctx.save();
          caminho(ctx, S, x0, b.y0, w0, h0, 12 * PX); ctx.clip();
          pc.retangulo(x0, b.y0, w0, h0, '#ffffff');
          pc.retangulo(x0, b.y0, w0, hTh, '#ececec');
          pc.retangulo(x0, b.y0 + hTh - BORDA, w0, BORDA, '#d4d4d4');
          cols.forEach((c, i) => pc.linha(c.t, E.th, xCol[i] + PAD_X, b.y0 + PAD_Y + hLinha(E.th.pt, LH_TH) / 2, 'esq'));
          b.linhas.forEach((l, li) => {
            const topo = l.y + PAD_Y, m = l.m, ultima = li === b.linhas.length - 1;
            const bloco = (info, e1, i) => info.linhas.forEach((t, k) => pc.linha(t, e1, xCol[i] + PAD_X, topo + k * hLinha(e1.pt) + hLinha(e1.pt) / 2, 'esq'));
            bloco(m.num, E.num, 0);
            // foto 20 x 20 mm com borda arredondada, imagem inteira (contain)
            const foto = l.it.fotoUrl ? fotos.get(l.it.fotoUrl) : null;
            const fx = xCol[1] + PAD_X;
            if (foto) {
              ctx.save(); caminho(ctx, S, fx, topo, 20, 20, 8 * PX); ctx.clip();
              pc.retangulo(fx, topo, 20, 20, '#ffffff');
              const k = Math.min(20 / foto.width, 20 / foto.height), dw = foto.width * k, dh = foto.height * k;
              ctx.drawImage(foto, (fx + (20 - dw) / 2) * S, (topo + (20 - dh) / 2) * S, dw * S, dh * S);
              ctx.restore();
              ctx.save(); caminho(ctx, S, fx + BORDA / 2, topo + BORDA / 2, 20 - BORDA, 20 - BORDA, 8 * PX); ctx.strokeStyle = '#cccccc'; ctx.lineWidth = BORDA * S; ctx.stroke(); ctx.restore();
            } else pc.linha('—', { pt: 8.5, cor: '#888888' }, fx, topo + hLinha(8.5) / 2, 'esq');
            bloco({ linhas: m.item.linhas }, E.item, 2);
            if (m.item.href) {
              const yl = topo + m.item.linhas.length * hLinha(E.item.pt), wl = pc.linha('Ver produto ↗', E.link, xCol[2] + PAD_X, yl + hLinha(E.link.pt) / 2, 'esq');
              links.push({ x: xCol[2] + PAD_X, y: yl, w: wl, h: hLinha(E.link.pt), url: m.item.href });
            }
            if (m.amb.chips) {
              m.amb.chips.forEach((c) => {
                const cx = xCol[3] + PAD_X + c.x, cy = topo + c.r * (hLinha(E.chip.pt) + 2 * PX + 2 * BORDA + 4 * PX), ch = hLinha(E.chip.pt) + 2 * PX + 2 * BORDA;
                ctx.save(); caminho(ctx, S, cx + BORDA / 2, cy + BORDA / 2, c.w - BORDA, ch - BORDA, 99); ctx.strokeStyle = '#c9c9c9'; ctx.lineWidth = BORDA * S; ctx.stroke(); ctx.restore();
                pc.linha(c.txt, E.chip, cx + BORDA + 7 * PX, cy + ch / 2, 'esq');
              });
            } else bloco(m.amb, E.td, 3);
            bloco(m.emp, E.td, 4); bloco(m.esp, E.td, 5); bloco(m.dim, E.td, 6); bloco(m.qtd, E.td, 7);
            if (!ultima) pc.retangulo(x0, l.y + m.h - BORDA, w0, BORDA, '#d4d4d4');
          });
          ctx.restore();
          ctx.save(); caminho(ctx, S, x0 + BORDA / 2, b.y0 + BORDA / 2, w0 - BORDA, h0 - BORDA, 12 * PX); ctx.strokeStyle = '#bbbbbb'; ctx.lineWidth = BORDA * S; ctx.stroke(); ctx.restore();
        }
      });
      // rodapé de toda folha: dados do escritório (centro) e "n / N" (direita)
      const yRod = LIMITE + MARG_BAIXO / 2;
      if (rodape) pc.linha(rodape, { pt: 8, cor: '#666666' }, LARG / 2, yRod, 'centro');
      pc.linha((pi + 1) + ' / ' + total, { pt: 8, cor: '#888888' }, LARG - MARG, yRod, 'dir');
      saida.push({ jpeg: PA.dataUriParaBytes(canvas.toDataURL('image/jpeg', M.QUALIDADE_JPEG_ALTA)), largura: canvas.width, altura: canvas.height, links });
      avisar('Montando a página ' + (pi + 1) + ' de ' + total + '...', 0.5 + 0.5 * (pi + 1) / total);
      await PA.cedeAVez();
    }
    const bytes = PA.montarPdf(saida, { titulo: 'Memorial de itens — ' + String(o.nomeProjeto || ''), data: agora });
    return {
      blob: new Blob([bytes], { type: 'application/pdf' }), paginas: total, bytes: bytes.length,
      aviso: falhas ? falhas + ' foto(s) não puderam ser carregadas e ficaram de fora do PDF.' : ''
    };
  }

  raiz.MemorialArquivo = { gerar, medirLinha };
})(typeof window !== 'undefined' ? window : this);
