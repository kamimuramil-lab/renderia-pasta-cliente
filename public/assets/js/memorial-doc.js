// memorial-doc.js -- o documento do PDF do Memorial de itens (página do cliente).
// Monta um HTML PRONTO PARA O PAPEL (A4 deitado, medidas em mm), independente do tamanho da tela: por isso o PDF sai igual no
// computador e no celular (antes ele imprimia a própria página, que no celular saía no layout de celular). O visual é o mesmo do
// PDF que saía no computador: cabeçalho com logo + "MEMORIAL DE ITENS" + nome do projeto + data, uma tabela por setor
// (Nº, Foto, Item, Ambiente, Empresa, Especificações, Dimensões, Qtd.), sem valores (eles nunca chegam aqui).
// Quem imprime/baixa é o impressao.js. Lógica pura: não usa `estado` nem mexe na página.
(function () {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hrefSeguro = (url) => { try { const u = new URL(url); return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : null; } catch (e) { return null; } };
  const dataPorExtenso = (d) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

  // O texto do rodapé do escritório vai pra DENTRO do @page (caixa da margem de baixo, que o navegador repete em todas as folhas sem ocupar
  // espaço do conteúdo). Antes era um bloco "fixo" que empurrava uma folha em branco só com o rodapé no fim do PDF.
  const textoCss = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/</g, '\\3C ').replace(/[\r\n]+/g, ' ');
  const CSS = (rodapeTexto) => `
@page { size: A4 landscape; margin: 10mm 10mm 17mm;
  ${rodapeTexto ? `@bottom-center { content: "${textoCss(rodapeTexto)}"; font-size: 8pt; color: #666; vertical-align: middle; }` : ''}
  @bottom-right { content: counter(page) " / " counter(pages); font-size: 8pt; color: #888; vertical-align: middle; } }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: 'Inter', 'Segoe UI', Arial, Helvetica, sans-serif; font-size: 16px; line-height: 1.55; color: #1c1c1c; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.folha { width: 297mm; padding: 10mm; margin: 0 auto; background: #fff; }
@media print { .folha { width: auto; padding: 0; margin: 0; } .rodape-escritorio { display: none; } html.sem-margem .rodape-escritorio { display: block; margin-top: 8mm; } }
@media screen { .rodape-escritorio { margin-top: 8mm; padding-top: 3mm; border-top: 1px solid #ddd; } }
.rodape-escritorio { text-align: center; font-size: 8pt; color: #666; line-height: 1.4; }
.cabecalho { display: flex; align-items: center; gap: 16px; margin-bottom: 3mm; border-bottom: 2px solid #1c1c1c; padding-bottom: 2.5mm; }
.cabecalho img { max-height: 16mm; max-width: 50mm; object-fit: contain; }
.titulo { font-size: 15pt; letter-spacing: .14em; font-weight: 300; }
.projeto { font-family: 'Archivo', 'Inter', 'Segoe UI', Arial, sans-serif; font-size: 26pt; font-weight: 800; line-height: 1.1; margin: 1mm 0 2mm; overflow-wrap: anywhere; letter-spacing: -.01em; }
.data { font-size: 8.5pt; color: #777; }
.setor { margin-bottom: 6mm; }
/* cada setor é UM bloco: moldura fina + faixa suave com o nome do setor (a faixa é a 1ª linha do cabeçalho da tabela, então repete em toda folha de continuação) */
table.setor-tabela { border: .7pt solid #aeb6c0; border-radius: 0; }
tr.titulo-setor th { background: #eef1f4; color: #2b3340; padding: 2mm 4mm 2mm 3.5mm; font-family: 'Archivo', 'Inter', 'Segoe UI', Arial, sans-serif; font-weight: 700; font-size: 12pt; letter-spacing: .1em; border-bottom: .7pt solid #aeb6c0; border-left: 1.3mm solid #7a8796; white-space: normal; }
tr.titulo-setor th span { font-weight: 400; color: #7b8591; font-size: 9pt; letter-spacing: 0; margin-left: 4mm; text-transform: none; }
/* dados do cliente (nome, e-mail, endereço) no título do setor: discretos, à direita, sem rótulos */
tr.titulo-setor th.dados-cliente { text-align: right; font-family: 'Inter', 'Segoe UI', Arial, sans-serif; font-weight: 400; font-size: 7.5pt; line-height: 1.5; letter-spacing: 0; text-transform: none; color: #6b7683; border-left: 0; vertical-align: middle; }
tr.titulo-setor th.dados-cliente span { margin: 0; font-size: inherit; color: inherit; }
tr.titulo-setor th.dados-cliente .dc-nome { font-weight: 600; color: #2b3340; letter-spacing: .03em; font-size: 8pt; }
tr.titulo-setor th.dados-cliente .dc-sep { color: #aeb6c0; padding: 0 1mm; }
table { width: 100%; border-collapse: separate; border-spacing: 0; background: #fff; border: 1px solid #bbb; border-radius: 12px; overflow: hidden; font-size: 8.5pt; color: #1c1c1c; table-layout: auto; }
thead { display: table-header-group; }
th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; background: #ececec; color: #444; padding: 5px 6px; border-bottom: 1px solid #d4d4d4; white-space: nowrap; }
td { padding: 5px 6px; border-bottom: 1px solid #d4d4d4; vertical-align: top; line-height: 1.5; }
tbody tr:last-child td { border-bottom: 0; }
tr { break-inside: avoid; page-break-inside: avoid; }
td.num { color: #666; font-weight: 700; width: 40px; }
td.item { min-width: 150px; }
td.item a { font-size: 12px; color: #1c1c1c; text-decoration: none; }
td.texto { white-space: pre-line; min-width: 150px; }
.amb { display: inline-block; font-size: 11px; font-weight: 700; padding: 1px 7px; margin: 0 4px 4px 0; border-radius: 999px; border: 1px solid #c9c9c9; color: #555; }
.foto { display: block; width: 20mm; height: 20mm; border: 1px solid #ccc; border-radius: 8px; overflow: hidden; background: #fff; }
.foto img { width: 100%; height: 100%; object-fit: contain; display: block; }
.sem { color: #888; }
.foto-n { display: inline-block; margin-left: 6px; font-size: 10px; font-weight: 700; color: #555; background: #e9e9e9; border-radius: 999px; padding: 0 7px; white-space: nowrap; vertical-align: middle; }
/* modo CARDS: duas colunas, imagem grande com os dados embaixo (linhas da tabela não se partem entre folhas) */
table.cards { border-radius: 0; overflow: visible; background: none; table-layout: fixed; }
table.cards td.card-td { width: 50%; border: 0; padding: 2mm 2mm 4mm; height: 1px; }
.card { border: 1px solid #bbb; border-radius: 3mm; overflow: hidden; background: #fff; height: 100%; }
.card-img { height: 80mm; background: #f3f3f3; display: flex; align-items: center; justify-content: center; color: #888; font-size: 9pt; }
.card-img img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
.card-corpo { padding: 2.5mm 4mm 3mm; }
.card-titulo { display: flex; align-items: center; gap: 2mm; font-size: 11.5pt; font-weight: 800; line-height: 1.25; }
.card-titulo .num-card { flex: 0 0 auto; width: 6.5mm; height: 6.5mm; line-height: 6.5mm; border-radius: 50%; background: #1c1c1c; color: #fff; text-align: center; font-size: 9pt; font-weight: 700; }
.card-corpo .card-amb { margin-top: 1mm; }
.card-info { margin-top: 1.5mm; font-size: 8.5pt; line-height: 1.4; overflow-wrap: anywhere; white-space: pre-line; }
.card-info b { color: #555; font-weight: 700; }
.card-link { margin-top: 1mm; font-size: 9pt; line-height: 1.4; }
.card-link a { color: #1c1c1c; text-decoration: none; }
/* PLANTA do setor: a 1ª linha da tabela do setor (altura máx. 110 mm), com um círculo numerado (o Nº do item) em cada posição marcada; os itens vêm logo abaixo */
.setor + .setor { break-before: page; page-break-before: always; }
tr.linha-planta td.planta-cel { text-align: center; padding: 2.5mm 3mm 2mm; background: #fafafa; border-bottom: .7pt solid #cfd5db; }
.planta-titulo { text-align: left; margin: 0 0 1.5mm; font-weight: 800; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .08em; color: #333; line-height: 1.3; }
.planta-palco { position: relative; display: inline-block; line-height: 0; border: 1px solid #c9c9c9; background: #fff; }
.planta-palco img { display: block; max-width: 268mm; max-height: 110mm; width: auto; height: auto; }
/* círculos numerados: o tamanho é uma FRAÇÃO da largura da planta (--m, ajustada pelo arquiteto; 100cqw = largura da camada, que tem o tamanho da imagem) */
.planta-pinos { position: absolute; inset: 0; container-type: size; pointer-events: none; }
.pino { position: absolute; transform: translate(-50%, -50%); box-sizing: border-box; display: flex; align-items: center; justify-content: center; width: calc(var(--m, .027) * 100cqw); height: calc(var(--m, .027) * 100cqw); border-radius: 50%; background: #d6342c; color: #fff; border: calc(var(--m, .027) * 100cqw * .085) solid #fff; box-shadow: 0 0 1.2mm rgba(0,0,0,.55); font-size: calc(var(--m, .027) * 100cqw * .5); font-weight: 800; line-height: 1; }
.planta-nota { margin-top: 2mm; font-size: 8pt; color: #777; text-align: left; line-height: 1.3; }
/* TEXTOS escritos em cima da planta: camada do tamanho da imagem; o texto vale uma FRAÇÃO da largura dela (100cqw = largura da camada) */
.planta-textos { position: absolute; inset: 0; container-type: size; overflow: hidden; pointer-events: none; }
.planta-textos .pl-texto { position: absolute; transform: translate(-50%, -50%); font-size: calc(var(--t, .018) * 100cqw); line-height: 1.15; white-space: pre; text-align: center; padding: .1em .35em; border-radius: .3em; font-family: 'Inter', 'Segoe UI', Arial, sans-serif; }
`;

  // Navegadores SEM suporte às caixas de margem do @page (Safari/iPhone, Chrome antigo) não mostrariam o rodapé do escritório nem a contagem de
  // páginas: neles o rodapé vai em linha, no fim do documento (a marca "sem-margem" liga isso só no papel). Chrome/Edge 131+ usam a margem.
  const SCRIPT_MARGEM = '<script>(function(){var m=/(?:Chrome|Edg)[/]([0-9]+)/.exec(navigator.userAgent||"");if(!(m&&+m[1]>=131))document.documentElement.className+=" sem-margem";})();</' + 'script>';

  // Um item com várias fotos vira VÁRIAS entradas (uma por foto: capa primeiro), todas com os mesmos dados do item. Sem foto = uma entrada sem imagem.
  function entradasDoItem(i) {
    const urls = [i.fotoUrl].concat((i.fotosExtras || []).map((f) => f && f.url)).filter(Boolean);
    if (!urls.length) return [{ i, url: null, k: 0, n: 1 }];
    return urls.map((url, k) => ({ i, url, k, n: urls.length }));
  }
  const marcaFoto = (e) => (e.n > 1 ? `<span class="foto-n">foto ${e.k + 1}/${e.n}</span>` : '');

  function linha(e) {
    const i = e.i;
    const href = i.link ? hrefSeguro(i.link) : null;
    const foto = e.url ? `<span class="foto"><img src="${esc(e.url)}" alt="${esc(i.item)}"></span>` : '<span class="sem">—</span>';
    const amb = (i.ambientes || []).map((a) => `<span class="amb">${esc(a)}</span>`).join('') || '—';
    return `<tr><td class="num">${esc(i.numero)}</td><td>${foto}</td><td class="item"><b>${esc(i.item)}</b>${marcaFoto(e)}${href ? `<br><a href="${esc(href)}">Ver produto ↗</a>` : ''}</td><td>${amb}</td><td>${esc(i.empresa) || '—'}</td><td class="texto">${esc(i.especificacoes) || '—'}</td><td class="texto">${esc(i.dimensoes) || '—'}</td><td>${esc(i.quantidade) || '—'}</td></tr>`;
  }

  // Um card (modo CARDS): imagem grande de UMA foto do item e os dados embaixo (item com várias fotos = um card por foto).
  function card(e) {
    const i = e.i;
    const href = i.link ? hrefSeguro(i.link) : null;
    const amb = (i.ambientes || []).map((a) => `<span class="amb">${esc(a)}</span>`).join('');
    const info = (rotulo, valor) => (String(valor == null ? '' : valor).trim() ? `<div><b>${rotulo}:</b> ${esc(valor)}</div>` : '');
    const infos = info('Empresa', i.empresa) + info('Especificações', i.especificacoes) + info('Dimensões', i.dimensoes) + info('Qtd.', i.quantidade);
    return `<div class="card"><div class="card-img">${e.url ? `<img src="${esc(e.url)}" alt="${esc(i.item)}">` : 'sem foto'}</div>` +
      `<div class="card-corpo"><div class="card-titulo"><span class="num-card">${esc(i.numero)}</span><span>${esc(i.item)}${marcaFoto(e)}</span></div>${amb ? `<div class="card-amb">${amb}</div>` : ''}` +
      `${infos ? `<div class="card-info">${infos}</div>` : ''}${href ? `<div class="card-link"><a href="${esc(href)}">Ver produto ↗</a></div>` : ''}</div></div>`;
  }
  // Dados do cliente no título do setor (à direita, discretos, sem rótulos): linha 1 = nome · e-mail; linha 2 = endereço. `c` = { nome, email, endereco }.
  function htmlDadosDoCliente(c) {
    const o = c || {};
    const t = (v) => String(v == null ? '' : v).trim();
    const l1 = [t(o.nome) && `<span class="dc-nome">${esc(t(o.nome))}</span>`, t(o.email) && `<span>${esc(t(o.email))}</span>`].filter(Boolean).join('<span class="dc-sep">·</span>');
    const l2 = t(o.endereco) ? `<span>${esc(t(o.endereco))}</span>` : '';
    return [l1, l2].filter(Boolean).map((l) => `<div>${l}</div>`).join('');
  }
  // `dados` = HTML dos dados do cliente ('' = faixa só com o nome do setor, como antes). Com dados, a faixa se divide em duas células.
  const faixaDoSetor = (setor, n, colspan, dados) => {
    const nome = `${esc(setor)}<span>${n} ${n === 1 ? 'item' : 'itens'}</span>`;
    if (!dados) return `<tr class="titulo-setor"><th colspan="${colspan}">${nome}</th></tr>`;
    const esq = Math.ceil(colspan / 2);
    return `<tr class="titulo-setor"><th colspan="${esq}">${nome}</th><th colspan="${colspan - esq}" class="dados-cliente">${dados}</th></tr>`;
  };
  function tabelaDeCards(setor, doSetor, plantas, dados) {
    const entradas = doSetor.reduce((acc, i) => acc.concat(entradasDoItem(i)), []);
    const linhas = [];
    for (let k = 0; k < entradas.length; k += 2) linhas.push(entradas.slice(k, k + 2));
    return `<table class="cards setor-tabela"><colgroup><col style="width:50%"><col style="width:50%"></colgroup><thead>${faixaDoSetor(setor, doSetor.length, 2, dados)}</thead><tbody>${plantas(2)}${linhas.map((p) => `<tr>${p.map((e) => `<td class="card-td">${card(e)}</td>`).join('')}${p.length === 1 ? '<td class="card-td"></td>' : ''}</tr>`).join('')}</tbody></table>`;
  }
  function tabelaDeLista(setor, doSetor, plantas, dados) {
    const entradas = doSetor.reduce((acc, i) => acc.concat(entradasDoItem(i)), []);
    return `<table class="setor-tabela"><thead>${faixaDoSetor(setor, doSetor.length, 8, dados)}<tr><th>Nº</th><th>Foto</th><th>Item</th><th>Ambiente</th><th>Empresa</th><th>Especificações</th><th>Dimensões</th><th>Qtd.</th></tr></thead><tbody>${plantas(8)}${entradas.map(linha).join('')}</tbody></table>`;
  }
  // Plantas do setor (opcional): `o.plantas[setor] = [{ id, nome, url, marcas: [{ itemId, numero, x, y }] }]`; x/y são frações (0..1) da imagem.
  // Cada planta é uma linha da tabela do setor, ANTES dos itens (a planta fica EM CIMA e os itens logo abaixo). Planta sem endereço de imagem é pulada.
  const frac = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0; };
  const tamanhoDosPinos = (p) => { const n = Number(p && p.tamanhoMarcas); return Number.isFinite(n) && n > 0 ? n : 0.027; }; // servidor antigo não manda: padrão
  function linhasDePlanta(setor, plantas, colspan) {
    const lista = plantas && Array.isArray(plantas[setor]) ? plantas[setor] : [];
    const validas = lista.filter((p) => p && p.url);
    return validas.map((p, k) => {
      const pinos = (Array.isArray(p.marcas) ? p.marcas : []).map((m) => `<span class="pino" style="left:${(frac(m.x) * 100).toFixed(3)}%; top:${(frac(m.y) * 100).toFixed(3)}%;">${esc(m.numero)}</span>`).join('');
      const PT = window.PlantaTextos; // carregado depois deste arquivo na página: lido só agora (sem ele, a planta sai sem textos em vez de quebrar)
      const textos = PT && PT.html ? PT.html(p.textos) : ''; // textos escritos em cima da planta (mesmo desenho do app); os círculos ficam por cima
      return `<tr class="linha-planta"><td class="planta-cel" colspan="${colspan}"><div class="planta-titulo">${esc(setor)} — ${validas.length > 1 ? `Planta ${k + 1}` : 'Planta'}</div><div class="planta-palco"><img src="${esc(p.url)}" alt="">${textos ? `<div class="planta-textos">${textos}</div>` : ''}${pinos ? `<div class="planta-pinos" style="--m:${tamanhoDosPinos(p)};">${pinos}</div>` : ''}</div></td></tr>`;
    }).join('');
  }

  // O rodapé de TODAS as páginas: nome, telefone, e-mail e Instagram do escritório (só o que foi cadastrado).
  // No papel vai na margem de baixo de cada folha (@page, ver acima); na tela (prévia do celular) aparece no fim do documento.
  const partesDoRodape = (e) => { const o = e || {}; return [o.nome, o.whatsapp, o.email, o.instagram].map((x) => String(x || '').trim()).filter(Boolean); };
  function rodapeDoEscritorio(e) {
    const partes = partesDoRodape(e);
    return partes.length ? `<div class="rodape-escritorio">${partes.map(esc).join(' &nbsp;·&nbsp; ')}</div>` : '';
  }

  // opcoes: { nomeProjeto, logo (url|null), itens (com fotosExtras [{id,url}]; item com várias fotos sai com uma linha/card POR FOTO), setores, modos { setor: 'cards' } (sem entrada = lista), plantas { setor: [{ nome, url, marcas }] }, setor ('' = todos), agora (Date), cliente: { nome, email, endereco } (opcional; vai no título de cada setor), escritorio: { nome, whatsapp (formatado), email, instagram (com @) } } -> { html, totalItens, setores }
  function montarHtml(opcoes) {
    const o = opcoes || {};
    const itens = Array.isArray(o.itens) ? o.itens : [];
    const setores = [...(Array.isArray(o.setores) ? o.setores : [])];
    itens.forEach((i) => { if (!setores.includes(i.setor)) setores.push(i.setor); });
    const incluidos = setores.filter((s) => (!o.setor || s === o.setor) && itens.some((i) => i.setor === s));
    if (!incluidos.length) throw new Error('Não há itens no memorial para gerar o PDF.');
    const dadosCliente = htmlDadosDoCliente(o.cliente); // nome, e-mail e endereço do cliente no título de TODO setor (e na faixa que repete em cada folha)
    const blocos = incluidos.map((setor) => {
      const doSetor = itens.filter((i) => i.setor === setor);
      const cards = o.modos && o.modos[setor] === 'cards';
      const plantas = (n) => linhasDePlanta(setor, o.plantas, n);
      return `<section class="setor">${cards ? tabelaDeCards(setor, doSetor, plantas, dadosCliente) : tabelaDeLista(setor, doSetor, plantas, dadosCliente)}</section>`;
    }).join('');
    const logo = o.logo ? `<img src="${esc(o.logo)}" alt="">` : '';
    const agora = o.agora instanceof Date ? o.agora : new Date();
    const total = incluidos.reduce((s, setor) => s + itens.filter((i) => i.setor === setor).length, 0);
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Memorial de itens — ${esc(o.nomeProjeto || '')}</title>` +
      '<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@800&family=Inter:wght@400;600;700&display=swap" rel="stylesheet">' +
      `<style>${CSS(partesDoRodape(o.escritorio).join('  ·  '))}</style></head><body><div class="folha"><div class="cabecalho">${logo}<div><div class="titulo">MEMORIAL DE ITENS</div><div class="projeto">${esc(o.nomeProjeto || '')}</div><div class="data">${esc(dataPorExtenso(agora))}</div></div></div>${blocos}${rodapeDoEscritorio(o.escritorio)}</div>${SCRIPT_MARGEM}</body></html>`;
    return { html, totalItens: total, setores: incluidos };
  }

  window.MemorialDoc = { montarHtml };
})();
