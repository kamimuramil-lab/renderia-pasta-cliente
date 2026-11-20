// lib/imagens-pdf.js
// Monta o HTML do PDF das IMAGENS do projeto (nov/2026), pensado pra ficar bonito: capa do projeto, uma capa elegante pra
// cada ambiente (a foto de capa do ambiente em tela cheia, ou só o nome em tipografia quando não há capa) e uma página por
// imagem, com a paleta das 5 cores mais predominantes numa FAIXA VERTICAL ao lado da foto. Rodapé enxuto pra foto e a paleta
// ocuparem o máximo da folha: embaixo à ESQUERDA só o ambiente e o nome da imagem; embaixo à DIREITA a data e o horário em que o PDF
// foi gerado e o aviso de direitos autorais. O nome do escritório ("Projeto por: ...") fica na capa do projeto. Opcionalmente uma
// marca (logo ou ícone) pequena e discreta no canto superior direito de cada imagem.
// Lógica PURA (sem Electron, sem rede, sem require obrigatório): roda no app (main.js, printToPDF) e na página do cliente
// (navegador, "Baixar PDF"). Quem chama baixa as imagens, tira a paleta (paleta-cores.js) e passa tudo como data URI.
// Imagens 360° nunca entram (quem chama filtra). Sem I.A., sem token, sem custo.
// ESTE ARQUIVO (e o paleta-cores.js) existe em DUAS pastas -- skp-to-360-ia/lib e pasta-cliente/public/assets/js --: o teste
// skp-to-360-ia/test/teste_pdf_imagens.js confere que são idênticos. Mudou um? Copie para o outro.
(function (raiz) {
  const { corDoTexto } = (typeof require === 'function' && typeof module !== 'undefined') ? require('./paleta-cores') : raiz.PaletaCores;

  function esc(valor) {
    return String(valor === undefined || valor === null ? '' : valor)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  const imagemSegura = (uri) => (typeof uri === 'string' && /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(uri) ? uri : null);
  const corSegura = (hex) => (typeof hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() : null);
  const dois = (n) => String(n).padStart(2, '0');
  const dataPorExtenso = (d) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
  const horaCompleta = (d) => `${dois(d.getHours())}:${dois(d.getMinutes())}:${dois(d.getSeconds())}`;
  // "20/11/2026 às 13:45:07": cada geração tem o seu (o segundo evita duas gerações no mesmo minuto parecerem a mesma)
  const dataHoraCurta = (d) => `${dois(d.getDate())}/${dois(d.getMonth() + 1)}/${d.getFullYear()} às ${horaCompleta(d)}`;
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  const AVISO_AUTORAL = 'Este projeto contém direitos autorais.';

  const CSS = `
@page { size: A4 landscape; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: 'Segoe UI', Arial, Helvetica, sans-serif; color: #1c1c1c; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.pagina { position: relative; width: 297mm; height: 209.6mm; overflow: hidden; page-break-after: always; break-after: page; }
.pagina:last-child { page-break-after: auto; break-after: auto; }
.carimbo { position: absolute; right: 11mm; bottom: 6mm; font-size: 6.8pt; letter-spacing: .05em; color: #8a8a8a; text-align: right; }

/* capa do projeto */
.capa-projeto { background: #faf8f4; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.capa-projeto.escura { background: #1d1d1f; color: #f2f2f2; }
.capa-projeto.escura h1, .capa-projeto.escura .projeto { color: #fff; }
.capa-projeto.escura .dados { color: #c9c9c9; }
.capa-projeto.escura .data, .capa-projeto.escura .autoria, .capa-projeto.escura .carimbo { color: #9a9a9a; }
.capa-projeto img.logo { max-width: 66mm; max-height: 36mm; object-fit: contain; margin-bottom: 13mm; }
.capa-projeto h1 { font-size: 16pt; font-weight: 300; letter-spacing: .3em; margin: 0 0 5mm; }
.capa-projeto .linha { width: 28mm; height: 1px; background: #b79d62; margin: 0 auto 6mm; }
.capa-projeto .projeto { font-size: 54pt; line-height: 1.05; font-weight: 800; letter-spacing: -.01em; margin: 2mm 12mm 9mm; max-width: 262mm; overflow-wrap: anywhere; }
.capa-projeto .dados { white-space: pre-line; font-size: 10.5pt; color: #555; max-width: 190mm; margin-bottom: 9mm; line-height: 1.5; }
.capa-projeto .data { font-size: 9pt; color: #8a8a8a; letter-spacing: .06em; }
.capa-projeto .autoria { margin-top: 3mm; font-size: 9pt; color: #6f6f6f; letter-spacing: .04em; }
.capa-projeto .autoria small { display: block; margin-top: 1mm; font-size: 7pt; color: #9a9a9a; }

/* capa do ambiente */
.capa-ambiente { display: flex; }
.capa-ambiente .rotulo { font-size: 9.5pt; letter-spacing: .32em; text-transform: uppercase; }
.capa-ambiente .nome { font-weight: 300; letter-spacing: .08em; text-transform: uppercase; line-height: 1.12; overflow-wrap: anywhere; }
.capa-ambiente .contagem { font-size: 9.5pt; letter-spacing: .1em; }
.capa-ambiente.com-foto { align-items: flex-end; background: #111; }
.capa-ambiente.com-foto img.fundo { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.capa-ambiente.com-foto .veu { position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,.74) 0%, rgba(0,0,0,.34) 38%, rgba(0,0,0,0) 66%); }
.capa-ambiente.com-foto .texto { position: relative; color: #fff; padding: 0 20mm 19mm; width: 100%; }
.capa-ambiente.com-foto .rotulo { opacity: .82; }
.capa-ambiente.com-foto .nome { font-size: 36pt; margin: 4mm 0 5mm; }
.capa-ambiente.com-foto .fio { width: 26mm; height: 1px; background: #d9bf80; margin-bottom: 4mm; }
.capa-ambiente.com-foto .contagem { opacity: .8; }
.capa-ambiente.com-foto .carimbo { color: rgba(255,255,255,.6); }
.capa-ambiente.sem-foto { background: #efe9dd; align-items: center; justify-content: center; text-align: center; }
.capa-ambiente.sem-foto .texto { padding: 0 22mm; }
.capa-ambiente.sem-foto .rotulo { color: #8f7a45; }
.capa-ambiente.sem-foto .nome { font-size: 38pt; color: #232323; margin: 7mm 0; }
.capa-ambiente.sem-foto .fio { width: 26mm; height: 1px; background: #b79d62; margin: 0 auto 6mm; }
.capa-ambiente.sem-foto .contagem { color: #7b7567; }

/* página da imagem: a foto + a FAIXA VERTICAL de cores ao lado (as cores ocupam a altura da foto, na proporção de cada uma).
   A foto e a paleta usam quase a folha toda: só uma linha de rodapé embaixo. */
.pagina-imagem { background: #fff; }
.pagina-imagem .area { position: absolute; left: 8mm; top: 7mm; width: 281mm; height: 188mm; display: flex; align-items: center; justify-content: center; }
.pagina-imagem .grupo { display: flex; align-items: flex-start; gap: 4mm; max-width: 100%; max-height: 100%; }
.pagina-imagem .foto { position: relative; display: block; flex: 0 0 auto; line-height: 0; }
.pagina-imagem .foto img.principal { display: block; width: auto; height: auto; max-width: 253mm; max-height: 188mm; }
.pagina-imagem .grupo.sem-paleta .foto img.principal { max-width: 281mm; }
.pagina-imagem .foto img.marca { position: absolute; top: 2.4%; right: 2%; width: auto; height: auto; max-width: 14%; max-height: 11%; object-fit: contain; }
.paleta-v { align-self: stretch; width: 24mm; display: flex; flex-direction: column; gap: .7mm; border-radius: 2.4mm; overflow: hidden; flex-shrink: 0; }
.paleta-v .cor { flex-basis: 0; min-height: 13mm; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.paleta-v .hex { font-size: 6.4pt; font-weight: 700; letter-spacing: .05em; }
.paleta-v .pct { margin-top: .6mm; font-size: 5.8pt; letter-spacing: .04em; opacity: .78; }
.pagina-imagem .rodape-esq { position: absolute; left: 8mm; bottom: 5mm; width: 170mm; }
.pagina-imagem .ambiente { font-size: 7.6pt; letter-spacing: .26em; text-transform: uppercase; color: #9a8650; }
.pagina-imagem .linha-nome { margin-top: 1.2mm; font-size: 10.5pt; color: #333; overflow-wrap: anywhere; }
.pagina-imagem .rodape-dir { position: absolute; right: 8mm; bottom: 5mm; width: 100mm; text-align: right; }
.pagina-imagem .data-geracao { font-size: 6.8pt; letter-spacing: .05em; color: #8a8a8a; }
.pagina-imagem .aviso { margin-top: 1mm; font-size: 6.6pt; color: #9a9a9a; letter-spacing: .02em; }
`;

  // Faixa vertical: cada cor ocupa uma fatia da altura proporcional ao quanto aparece na foto (com um mínimo pra caber o texto).
  function paletaHtml(paleta) {
    const cores = (Array.isArray(paleta) ? paleta : []).map((c) => ({ ...c, hex: corSegura(c && c.hex) })).filter((c) => c.hex);
    if (!cores.length) return '';
    return `<div class="paleta-v">${cores.map((c) => {
      const rgb = Array.isArray(c.rgb) && c.rgb.length === 3 ? c.rgb : [parseInt(c.hex.slice(1, 3), 16), parseInt(c.hex.slice(3, 5), 16), parseInt(c.hex.slice(5, 7), 16)];
      const frac = typeof c.pct === 'number' ? Math.max(0.06, Math.min(1, c.pct)) : 0.2;
      const pct = typeof c.pct === 'number' ? `${Math.max(1, Math.round(c.pct * 100))}%` : '';
      return `<div class="cor" style="flex-grow:${Math.round(frac * 100)};background:${c.hex};color:${corDoTexto(rgb)}"><div class="hex">${esc(c.hex.toUpperCase())}</div><div class="pct">${esc(pct)}</div></div>`;
    }).join('')}</div>`;
  }

  // opcoes: { nomeProjeto, dadosProjeto, escritorio (nome do escritório na capa; vazio = sem "Projeto por"), logo (data URI da capa), logoClaro,
  //   marca (data URI do logo OU do ícone que vai pequeno no canto superior direito de cada imagem; vazio = sem marca), mostrarNomes,
  //   mostrarPaleta (padrão true), agora (Date; padrão = o momento da geração), ambientes: [{ nome, capa (data URI|null),
  //   imagens: [{ id, nome, uri (data URI), paleta: [{hex, rgb, pct}] }] }] }
  // -> { html, totalImagens, ambientesIncluidos, geradoEm }  (lança erro se não houver nenhuma imagem)
  function montarHtml(opcoes) {
    const o = opcoes || {};
    const mostrarPaleta = o.mostrarPaleta !== false;
    const ambientes = (Array.isArray(o.ambientes) ? o.ambientes : [])
      .map((a) => ({ nome: String((a && a.nome) || '').trim() || 'Outras imagens', capa: imagemSegura(a && a.capa), imagens: ((a && a.imagens) || []).filter((i) => i && imagemSegura(i.uri)) }))
      .filter((a) => a.imagens.length);
    const total = ambientes.reduce((s, a) => s + a.imagens.length, 0);
    if (!total) throw new Error('Não há imagens (fora as 360°) para gerar o PDF com essa seleção.');
    const agora = o.agora instanceof Date ? o.agora : new Date();
    const logo = imagemSegura(o.logo);
    const marca = imagemSegura(o.marca);
    const escritorio = String(o.escritorio || '').trim();
    const carimbo = `<div class="carimbo">PDF gerado em ${esc(dataHoraCurta(agora))}</div>`;

    const paginas = [`<section class="pagina capa-projeto${o.logoClaro ? ' escura' : ''}">
    ${logo ? `<img class="logo" src="${logo}" alt="">` : ''}
    <h1>IMAGENS DO PROJETO</h1><div class="linha"></div>
    <div class="projeto">${esc(o.nomeProjeto || '')}</div>
    ${o.dadosProjeto ? `<div class="dados">${esc(o.dadosProjeto)}</div>` : ''}
    <div class="data">${esc(dataPorExtenso(agora))} às ${esc(horaCompleta(agora))} · ${esc(plural(ambientes.length, 'ambiente', 'ambientes'))} · ${esc(plural(total, 'imagem', 'imagens'))}</div>
    <div class="autoria">${escritorio ? `Projeto por: <b>${esc(escritorio)}</b>` : ''}<small>${esc(AVISO_AUTORAL)}</small></div>
  </section>`]; // a capa do projeto não leva o carimbo de data/hora (a data aparece na linha do título)

    ambientes.forEach((a, idx) => {
      const rotulo = `Ambiente ${dois(idx + 1)}`;
      const contagem = esc(plural(a.imagens.length, 'imagem', 'imagens'));
      paginas.push(a.capa
        ? `<section class="pagina capa-ambiente com-foto"><img class="fundo" src="${a.capa}" alt=""><div class="veu"></div><div class="texto"><div class="rotulo">${esc(rotulo)}</div><div class="nome">${esc(a.nome)}</div><div class="fio"></div><div class="contagem">${contagem}</div></div>${carimbo}</section>`
        : `<section class="pagina capa-ambiente sem-foto"><div class="texto"><div class="rotulo">${esc(rotulo)}</div><div class="nome">${esc(a.nome)}</div><div class="fio"></div><div class="contagem">${contagem}</div></div>${carimbo}</section>`);
      a.imagens.forEach((im) => {
        const paleta = mostrarPaleta ? paletaHtml(im.paleta) : '';
        const nome = o.mostrarNomes && im.nome ? `<div class="linha-nome"><span class="nome">${esc(im.nome)}</span></div>` : '';
        paginas.push(`<section class="pagina pagina-imagem"><div class="area"><div class="grupo${paleta ? '' : ' sem-paleta'}"><span class="foto"><img class="principal" src="${imagemSegura(im.uri)}" alt="">${marca ? `<img class="marca" src="${marca}" alt="">` : ''}</span>${paleta}</div></div>
        <div class="rodape-esq"><div class="ambiente">${esc(a.nome)}</div>${nome}</div>
        <div class="rodape-dir"><div class="data-geracao">PDF gerado em ${esc(dataHoraCurta(agora))}</div><div class="aviso">${esc(AVISO_AUTORAL)}</div></div></section>`);
      });
    });

    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Imagens do projeto — ${esc(o.nomeProjeto || '')}</title><style>${CSS}</style></head><body>${paginas.join('')}</body></html>`;
    return { html, totalImagens: total, ambientesIncluidos: ambientes.map((a) => a.nome), geradoEm: dataHoraCurta(agora) };
  }

  const api = { montarHtml, paletaHtml, dataHoraCurta };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.ImagensPdf = api;
})(typeof window !== 'undefined' ? window : this);
