// memorial-arquivo.js -- gera o PDF do MEMORIAL DE ITENS como ARQUIVO de verdade (A4 paisagem, sem margem do iOS), no navegador do cliente.
//
// Mesmo método do PDF das imagens (pdf-arquivo.js): cada página é desenhada num canvas, vira JPEG e o escritor de PDF junta tudo.
// O link "Ver produto" vira área clicável de verdade no PDF. O layout segue o memorial-doc.js (o documento que vai pra impressão):
// mudou o layout lá? Ajuste aqui também. Só o celular usa isto (no computador o memorial continua saindo pela impressão).
//
// Etapa 4 (dez/2026): o PDF também mostra o modo CARDS do setor (2 por linha), as fotos extras de cada item e as PLANTAS do setor (uma folha por
// planta, depois da lista, com um círculo vermelho numerado em cada posição marcada). As fotos são baixadas página por página e soltas logo depois
// de desenhar: com cards (fotos de 130 mm) e plantas (2600 px) guardar tudo de uma vez estouraria a memória do celular.
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
    th: { pt: 8.25, peso: 700, esp: .06, cor: '#444444', caixa: 'maiuscula' },
    cardTitulo: { pt: 11.5, peso: 800, cor: '#1c1c1c' }, cardInfo: { pt: 8.5, cor: '#1c1c1c' }, cardRotulo: { pt: 8.5, peso: 700, cor: '#555555' },
    cardNum: { pt: 9, peso: 700, cor: '#ffffff' }, pino: { pt: 9, peso: 800, cor: '#ffffff' }
  };
  // medidas dos cards (mm), iguais às do CSS do memorial-doc.js
  const CARD = { imgH: 80, extra: 15, extraGap: 1.5, extraTopo: 1.5, padX: 4, padTopo: 2.5, padBaixo: 3, raio: 3, tdPad: 2, tdPadBaixo: 4, circulo: 6.5 };
  const MINI = 8, MINI_GAP = 1, MINI_TOPO = 1.5;     // miniaturas das fotos extras na coluna Foto da lista
  // maior lado (px) com que cada tipo de imagem é guardada: foto de 20 mm precisa de pouco; card (130 mm) e planta (toda a folha), de mais
  const LADO = { capaLista: 520, extraLista: 220, capaCard: 1000, extraCard: 320, planta: 2600 };
  const PT = 25.4 / 72;
  const hLinha = (pt, mult) => pt * PT * (mult || LH_TD);

  const hrefSeguro = (url) => { try { const u = new URL(url); return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : null; } catch (e) { return null; } };
  const ehNum = (v) => typeof v === 'number' && isFinite(v);
  const fracao = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0; };
  const extrasDe = (it) => (Array.isArray(it.fotosExtras) ? it.fotosExtras : []).filter((f) => f && f.url);
  const chave = (url, lado) => lado + '|' + url;

  function caminho(ctx, S, x, y, w, h, r) {
    x *= S; y *= S; w *= S; h *= S; r = Math.min(r * S, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  // ---------- etiquetas de ambiente (quebram de linha quando não cabem) ----------
  const PASSO_CHIP = () => hLinha(E.chip.pt) + 2 * PX + 2 * BORDA + 4 * PX;
  function medirChips(pc, ambs, larg) {
    const { tam, esp } = pc.estilo(E.chip);
    let x = 0, r = 0;
    const chips = ambs.map((txt) => {
      const w = pc.larguraDe(txt, tam, esp) / pc.S + 2 * 7 * PX + 2 * BORDA;
      if (x > 0 && x + w > larg) { r++; x = 0; }
      const c = { txt, x, r, w }; x += w + 4 * PX; return c;
    });
    return { chips, h: (r + 1) * PASSO_CHIP() };
  }
  function desenharChips(pc, ctx, S, chips, x0, y0) {
    chips.forEach((c) => {
      const cx = x0 + c.x, cy = y0 + c.r * PASSO_CHIP(), ch = hLinha(E.chip.pt) + 2 * PX + 2 * BORDA;
      ctx.save(); caminho(ctx, S, cx + BORDA / 2, cy + BORDA / 2, c.w - BORDA, ch - BORDA, 99); ctx.strokeStyle = '#c9c9c9'; ctx.lineWidth = BORDA * S; ctx.stroke(); ctx.restore();
      pc.linha(c.txt, E.chip, cx + BORDA + 7 * PX, cy + ch / 2, 'esq');
    });
  }

  // ---------- medidas de uma linha da tabela (modo lista) ----------
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
    const ambs = (it.ambientes || []).map(String);
    if (ambs.length) m.amb = medirChips(pc, ambs, larg(3));
    else m.amb = { chips: null, linhas: ['—'], h: hLinha(8.5) };
    // coluna Foto: a capa (20 mm) e, embaixo, as miniaturas das fotos extras (8 mm, quantas couberem por linha)
    const nExtras = extrasDe(it).length;
    m.miniPorLinha = Math.max(1, Math.floor((larg(1) + MINI_GAP) / (MINI + MINI_GAP)));
    const linhasMini = Math.ceil(nExtras / m.miniPorLinha);
    m.topoMini = it.fotoUrl ? 20 : hLinha(8.5);
    m.miniH = nExtras ? MINI_TOPO + linhasMini * MINI + (linhasMini - 1) * MINI_GAP : 0;
    m.h = Math.max((it.fotoUrl || nExtras ? m.topoMini + m.miniH : 0), m.num.h, m.item.h, m.amb.h, m.emp.h, m.esp.h, m.dim.h, m.qtd.h) + 2 * PAD_Y + BORDA;
    return m;
  }

  // ---------- medidas de um card (modo cards) ----------
  // larg: largura do card em mm; hMax: altura máxima (um card nunca passa de uma folha: o texto que não couber termina em "…")
  function medirCard(pc, it, larg, hMax) {
    const wc = larg - 2 * BORDA - 2 * CARD.padX;
    const href = it.link ? hrefSeguro(it.link) : null;
    const tit = pc.quebrar(String(it.item || ''), E.cardTitulo, wc - CARD.circulo - 2);
    const hTit = Math.max(CARD.circulo, tit.length * hLinha(E.cardTitulo.pt, 1.25));
    const ambs = (it.ambientes || []).map(String);
    const amb = ambs.length ? medirChips(pc, ambs, wc) : null;
    const hInfoLinha = hLinha(E.cardInfo.pt, 1.4);
    let info = [];
    [['Empresa', it.empresa], ['Especificações', it.especificacoes], ['Dimensões', it.dimensoes], ['Qtd.', it.quantidade]].forEach(([rot, v]) => {
      if (!String(v == null ? '' : v).trim()) return;
      const prefixo = rot + ': ';
      pc.quebrar(prefixo + String(v), E.cardInfo, wc - 1.5).forEach((t, k) => info.push({ t, rot: k === 0 ? prefixo : null }));
    });
    const extras = extrasDe(it);
    const hExtras = extras.length ? CARD.extraTopo + CARD.extra : 0;
    const hHref = href ? 1 + hLinha(9, 1.4) : 0;
    const fixo = 2 * BORDA + CARD.imgH + hExtras + CARD.padTopo + hTit + (amb ? 1 + amb.h : 0) + hHref + CARD.padBaixo;
    const permitidas = Math.max(0, Math.floor((hMax - fixo - 1.5) / hInfoLinha));
    if (info.length > permitidas) { info = info.slice(0, permitidas); if (info.length) info[info.length - 1] = { ...info[info.length - 1], t: info[info.length - 1].t + ' …' }; }
    const hInfo = info.length ? 1.5 + info.length * hInfoLinha : 0;
    return { tit, hTit, amb, info, hInfoLinha, href, extras, hExtras, hHref, h: fixo + hInfo };
  }

  function desenharCard(pc, ctx, S, x, y, w, h, it, m, imgs, links) {
    ctx.save();
    caminho(ctx, S, x, y, w, h, CARD.raio); ctx.clip();
    pc.retangulo(x, y, w, h, '#ffffff');
    const x0 = x + BORDA, w0 = w - 2 * BORDA;
    let yy = y + BORDA;
    pc.retangulo(x0, yy, w0, CARD.imgH, '#f3f3f3');
    const capa = it.fotoUrl ? imgs.get(chave(it.fotoUrl, LADO.capaCard)) : null;
    if (capa) {
      const [dw, dh] = pc.encaixar(capa.width * PX, capa.height * PX, w0, CARD.imgH);
      ctx.drawImage(capa, (x0 + (w0 - dw) / 2) * S, (yy + (CARD.imgH - dh) / 2) * S, dw * S, dh * S);
    } else pc.linha(it.fotoUrl ? 'foto indisponível' : 'sem foto', { pt: 9, cor: '#888888' }, x0 + w0 / 2, yy + CARD.imgH / 2, 'centro');
    yy += CARD.imgH;
    if (m.extras.length) {
      yy += CARD.extraTopo;
      m.extras.forEach((f, k) => {
        const fx = x0 + CARD.padX + k * (CARD.extra + CARD.extraGap);
        const im = imgs.get(chave(f.url, LADO.extraCard));
        pc.recorteArredondado(fx, yy, CARD.extra, CARD.extra, 1.5, () => { pc.retangulo(fx, yy, CARD.extra, CARD.extra, '#ffffff'); if (im) pc.cobrir(im, fx, yy, CARD.extra, CARD.extra); });
        ctx.save(); caminho(ctx, S, fx + BORDA / 2, yy + BORDA / 2, CARD.extra - BORDA, CARD.extra - BORDA, 1.5); ctx.strokeStyle = '#cccccc'; ctx.lineWidth = BORDA * S; ctx.stroke(); ctx.restore();
      });
      yy += CARD.extra;
    }
    yy += CARD.padTopo;
    const xt = x0 + CARD.padX;
    ctx.save(); ctx.fillStyle = '#1c1c1c'; ctx.beginPath(); ctx.arc((xt + CARD.circulo / 2) * S, (yy + m.hTit / 2) * S, CARD.circulo / 2 * S, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    pc.linha(String(it.numero == null ? '' : it.numero), E.cardNum, xt + CARD.circulo / 2, yy + m.hTit / 2, 'centro');
    const hl = hLinha(E.cardTitulo.pt, 1.25);
    m.tit.forEach((t, k) => pc.linha(t, E.cardTitulo, xt + CARD.circulo + 2, yy + (m.hTit - m.tit.length * hl) / 2 + k * hl + hl / 2, 'esq'));
    yy += m.hTit;
    if (m.amb) { yy += 1; desenharChips(pc, ctx, S, m.amb.chips, xt, yy); yy += m.amb.h; }
    if (m.info.length) {
      yy += 1.5;
      m.info.forEach((l, k) => {
        const cy = yy + k * m.hInfoLinha + m.hInfoLinha / 2;
        if (l.rot && l.t.indexOf(l.rot) === 0) {
          const wr = pc.linha(l.rot, E.cardRotulo, xt, cy, 'esq');
          pc.linha(l.t.slice(l.rot.length), E.cardInfo, xt + wr, cy, 'esq');
        } else pc.linha(l.t, E.cardInfo, xt, cy, 'esq');
      });
      yy += m.info.length * m.hInfoLinha;
    }
    if (m.href) {
      yy += 1;
      const wl = pc.linha('Ver produto ↗', E.link, xt, yy + hLinha(9, 1.4) / 2, 'esq');
      links.push({ x: xt, y: yy, w: wl, h: hLinha(9, 1.4), url: m.href });
    }
    ctx.restore();
    ctx.save(); caminho(ctx, S, x + BORDA / 2, y + BORDA / 2, w - BORDA, h - BORDA, CARD.raio); ctx.strokeStyle = '#bbbbbb'; ctx.lineWidth = BORDA * S; ctx.stroke(); ctx.restore();
  }

  // ---------- planta do setor: uma folha, com um círculo numerado em cada marca ----------
  function desenharPlanta(pc, ctx, S, b, img) {
    const eT = { pt: 9.75, peso: 800, esp: .08, cor: '#1c1c1c', caixa: 'maiuscula' }, hT = hLinha(9.75, LH_TH);
    const w1 = pc.linha(b.setor + ' — ' + (b.planta.nome || 'Planta'), eT, MARG, MARG + hT / 2, 'esq');
    pc.linha('Planta', { pt: 8.25, peso: 700, cor: '#888888' }, MARG + w1 + 3, MARG + hT / 2, 'esq');
    pc.retangulo(MARG, MARG + hT + 1.5, LARG - 2 * MARG, 2 * PX, '#1c1c1c');
    const topo = MARG + hT + 1.5 + 2 * PX + 3, base = LIMITE - 7;
    let yFim = topo;
    if (!img) {
      pc.linha('Não consegui carregar a imagem desta planta.', { pt: 9, cor: '#888888' }, LARG / 2, topo + 12, 'centro');
      yFim = topo + 24;
    } else {
      const [dw, dh] = pc.encaixar(img.width * PX, img.height * PX, LARG - 2 * MARG - 2 * BORDA, base - topo - 2 * BORDA);
      const x0 = (LARG - dw) / 2;
      ctx.drawImage(img, x0 * S, topo * S + 0, dw * S, dh * S);
      ctx.save(); ctx.strokeStyle = '#c9c9c9'; ctx.lineWidth = BORDA * S; ctx.strokeRect(x0 * S - BORDA * S / 2, topo * S - BORDA * S / 2, dw * S + BORDA * S, dh * S + BORDA * S); ctx.restore();
      (Array.isArray(b.planta.marcas) ? b.planta.marcas : []).forEach((mk) => {
        const cx = x0 + fracao(mk.x) * dw, cy = topo + fracao(mk.y) * dh;
        ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 1.2 * S; ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(cx * S, cy * S, 3.5 * S, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        ctx.save(); ctx.fillStyle = '#d6342c'; ctx.beginPath(); ctx.arc(cx * S, cy * S, 2.9 * S, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        pc.linha(String(mk.numero == null ? '' : mk.numero), E.pino, cx, cy, 'centro');
      });
      yFim = topo + dh + 2 * BORDA;
    }
    pc.linha('Cada número é o do item na lista deste setor, nas folhas anteriores.', { pt: 8, cor: '#777777' }, MARG, yFim + 2 + hLinha(8, 1.3) / 2, 'esq');
  }

  // ---------- o que cada folha precisa baixar ----------
  function imagensDaFolha(folha) {
    const lista = [];
    const poe = (url, lado) => { if (url) lista.push({ url, lado }); };
    folha.blocos.forEach((b) => {
      if (b.t === 'frag') b.linhas.forEach((l) => { poe(l.it.fotoUrl, LADO.capaLista); extrasDe(l.it).forEach((f) => poe(f.url, LADO.extraLista)); });
      else if (b.t === 'cards') b.linhas.forEach((r) => r.cards.forEach((c) => { poe(c.it.fotoUrl, LADO.capaCard); extrasDe(c.it).forEach((f) => poe(f.url, LADO.extraCard)); }));
      else if (b.t === 'planta') poe(b.planta.url, LADO.planta);
    });
    const vistos = new Set();
    return lista.filter((i) => { const k = chave(i.url, i.lado); if (vistos.has(k)) return false; vistos.add(k); return true; });
  }

  // ---------- gerar ----------
  // o: { nomeProjeto, logo (url|null), itens (fotosExtras [{id,url}]), setores, modos { setor: 'cards' }, plantas { setor: [{ nome, url, marcas [{ numero, x, y }] }] },
  //      setor ('' = todos), agora, escritorio { nome, whatsapp, email, instagram } }
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
    const plantasDe = (setor) => (o.plantas && Array.isArray(o.plantas[setor]) ? o.plantas[setor] : []).filter((p) => p && p.url);

    // 1) só o logo vem antes (as fotos e plantas são baixadas folha por folha, mais abaixo)
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
    const larguraCard = (LARG - 2 * MARG) / 2 - 2 * CARD.tdPad;

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
      if (o.modos && o.modos[setor] === 'cards') {
        const hMax = LIMITE - MARG - hTituloSetor - 2 * CARD.tdPad;
        const linhasDeCards = [];
        for (let k = 0; k < doSetor.length; k += 2) {
          const cards = doSetor.slice(k, k + 2).map((it) => ({ it, m: medirCard(pc, it, larguraCard, hMax) }));
          linhasDeCards.push({ cards, h: Math.max(...cards.map((c) => c.m.h)) });
        }
        const passo = (r) => r.h + CARD.tdPad + CARD.tdPadBaixo;
        if (y + hTituloSetor + passo(linhasDeCards[0]) > LIMITE) { pag = nova(); y = MARG; }
        pag.blocos.push({ t: 'setor', y, setor, n: doSetor.length });
        y += hTituloSetor;
        let bloco = { t: 'cards', linhas: [] };
        pag.blocos.push(bloco);
        linhasDeCards.forEach((r) => {
          if (y + passo(r) > LIMITE && bloco.linhas.length) { pag = nova(); y = MARG; bloco = { t: 'cards', linhas: [] }; pag.blocos.push(bloco); }
          bloco.linhas.push({ y: y + CARD.tdPad, h: r.h, cards: r.cards });
          y += passo(r);
        });
      } else {
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
      }
      // as plantas do setor vêm DEPOIS da lista, cada uma na sua folha; o setor seguinte começa numa folha nova
      plantasDe(setor).forEach((planta) => { pag = nova(); pag.blocos.push({ t: 'planta', setor, planta }); y = ALT; });
    });
    const total = paginas.length;

    // 3) desenho (as imagens de cada folha são baixadas na hora e soltas logo depois)
    const e = o.escritorio || {};
    const rodape = [e.nome, e.whatsapp, e.email, e.instagram].map((x) => String(x || '').trim()).filter(Boolean).join('  ·  ');
    const saida = [];
    const imgs = new Map();
    let falhasFotos = 0, falhasPlantas = 0;
    for (let pi = 0; pi < total; pi++) {
      verifica();
      avisar('Baixando as fotos da página ' + (pi + 1) + ' de ' + total + '...', pi / total);
      const precisa = imagensDaFolha(paginas[pi]);
      let proxima = 0;
      const trabalhador = async () => {
        while (proxima < precisa.length) {
          verifica();
          const { url, lado } = precisa[proxima++];
          try { imgs.set(chave(url, lado), await PA.baixarImagem(url, lado)); } catch (err) { imgs.set(chave(url, lado), null); if (lado === LADO.planta) falhasPlantas++; else falhasFotos++; }
        }
      };
      await Promise.all([trabalhador(), trabalhador(), trabalhador(), trabalhador()]);
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
        } else if (b.t === 'cards') {
          b.linhas.forEach((r) => r.cards.forEach((c, k) => desenharCard(pc, ctx, S, MARG + k * (LARG - 2 * MARG) / 2 + CARD.tdPad, r.y, larguraCard, r.h, c.it, c.m, imgs, links)));
        } else if (b.t === 'planta') {
          desenharPlanta(pc, ctx, S, b, imgs.get(chave(b.planta.url, LADO.planta)));
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
            const foto = l.it.fotoUrl ? imgs.get(chave(l.it.fotoUrl, LADO.capaLista)) : null;
            const fx = xCol[1] + PAD_X;
            if (foto) {
              ctx.save(); caminho(ctx, S, fx, topo, 20, 20, 8 * PX); ctx.clip();
              pc.retangulo(fx, topo, 20, 20, '#ffffff');
              const k = Math.min(20 / foto.width, 20 / foto.height), dw = foto.width * k, dh = foto.height * k;
              ctx.drawImage(foto, (fx + (20 - dw) / 2) * S, (topo + (20 - dh) / 2) * S, dw * S, dh * S);
              ctx.restore();
              ctx.save(); caminho(ctx, S, fx + BORDA / 2, topo + BORDA / 2, 20 - BORDA, 20 - BORDA, 8 * PX); ctx.strokeStyle = '#cccccc'; ctx.lineWidth = BORDA * S; ctx.stroke(); ctx.restore();
            } else pc.linha('—', { pt: 8.5, cor: '#888888' }, fx, topo + hLinha(8.5) / 2, 'esq');
            // miniaturas das fotos extras (8 x 8 mm, cortadas pra preencher), logo abaixo da capa
            extrasDe(l.it).forEach((f, k) => {
              const mx = fx + (k % m.miniPorLinha) * (MINI + MINI_GAP), my = topo + m.topoMini + MINI_TOPO + Math.floor(k / m.miniPorLinha) * (MINI + MINI_GAP);
              const im = imgs.get(chave(f.url, LADO.extraLista));
              pc.recorteArredondado(mx, my, MINI, MINI, 1, () => { pc.retangulo(mx, my, MINI, MINI, '#ffffff'); if (im) pc.cobrir(im, mx, my, MINI, MINI); });
              ctx.save(); caminho(ctx, S, mx + BORDA / 2, my + BORDA / 2, MINI - BORDA, MINI - BORDA, 1); ctx.strokeStyle = '#cccccc'; ctx.lineWidth = BORDA * S; ctx.stroke(); ctx.restore();
            });
            bloco({ linhas: m.item.linhas }, E.item, 2);
            if (m.item.href) {
              const yl = topo + m.item.linhas.length * hLinha(E.item.pt), wl = pc.linha('Ver produto ↗', E.link, xCol[2] + PAD_X, yl + hLinha(E.link.pt) / 2, 'esq');
              links.push({ x: xCol[2] + PAD_X, y: yl, w: wl, h: hLinha(E.link.pt), url: m.item.href });
            }
            if (m.amb.chips) desenharChips(pc, ctx, S, m.amb.chips, xCol[3] + PAD_X, topo);
            else bloco(m.amb, E.td, 3);
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
      imgs.forEach((c) => { if (c) { c.width = 0; c.height = 0; } }); imgs.clear(); // solta a memória das fotos desta folha
      avisar('Montando a página ' + (pi + 1) + ' de ' + total + '...', (pi + 1) / total);
      await PA.cedeAVez();
    }
    const bytes = PA.montarPdf(saida, { titulo: 'Memorial de itens — ' + String(o.nomeProjeto || ''), data: agora });
    const avisos = [];
    if (falhasFotos) avisos.push(falhasFotos + ' foto(s) não puderam ser carregadas e ficaram de fora do PDF.');
    if (falhasPlantas) avisos.push(falhasPlantas + ' planta(s) não puderam ser carregadas (a folha ficou sem a imagem).');
    return { blob: new Blob([bytes], { type: 'application/pdf' }), paginas: total, bytes: bytes.length, aviso: avisos.join(' ') };
  }

  raiz.MemorialArquivo = { gerar, medirLinha, medirCard };
})(typeof window !== 'undefined' ? window : this);
