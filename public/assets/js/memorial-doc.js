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
.cabecalho { display: flex; align-items: center; gap: 16px; margin-bottom: 6mm; border-bottom: 2px solid #1c1c1c; padding-bottom: 4mm; }
.cabecalho img { max-height: 16mm; max-width: 50mm; object-fit: contain; }
.titulo { font-size: 15pt; letter-spacing: .14em; font-weight: 300; }
.projeto { font-family: 'Archivo', 'Inter', 'Segoe UI', Arial, sans-serif; font-size: 30pt; font-weight: 800; line-height: 1.1; margin: 2mm 0 4mm; overflow-wrap: anywhere; letter-spacing: -.01em; }
.data { font-size: 8.5pt; color: #777; }
.setor { margin-bottom: 6mm; }
.setor h2 { font-family: 'Archivo', 'Inter', 'Segoe UI', Arial, sans-serif; font-weight: 800; font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: #1c1c1c; margin: 0 0 10px; }
.setor h2 span { font-weight: 700; color: #888; margin-left: 6px; }
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
.foto-extras { display: flex; flex-wrap: wrap; gap: 1mm; margin-top: 1.5mm; }
.foto-extras img { width: 8mm; height: 8mm; object-fit: cover; border: 1px solid #ccc; border-radius: 1mm; background: #fff; display: block; }
/* modo CARDS: duas colunas, imagem grande com os dados embaixo (linhas da tabela não se partem entre folhas) */
table.cards { border: 0; border-radius: 0; overflow: visible; background: none; table-layout: fixed; }
table.cards td.card-td { width: 50%; border: 0; padding: 2mm 2mm 4mm; height: 1px; }
.card { border: 1px solid #bbb; border-radius: 3mm; overflow: hidden; background: #fff; height: 100%; }
.card-img { height: 80mm; background: #f3f3f3; display: flex; align-items: center; justify-content: center; color: #888; font-size: 9pt; }
.card-img img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
.card-extras { display: flex; gap: 1.5mm; padding: 1.5mm 4mm 0; }
.card-extras img { width: 15mm; height: 15mm; object-fit: cover; border: 1px solid #ccc; border-radius: 1.5mm; background: #fff; display: block; }
.card-corpo { padding: 2.5mm 4mm 3mm; }
.card-titulo { display: flex; align-items: center; gap: 2mm; font-size: 11.5pt; font-weight: 800; line-height: 1.25; }
.card-titulo .num-card { flex: 0 0 auto; width: 6.5mm; height: 6.5mm; line-height: 6.5mm; border-radius: 50%; background: #1c1c1c; color: #fff; text-align: center; font-size: 9pt; font-weight: 700; }
.card-corpo .card-amb { margin-top: 1mm; }
.card-info { margin-top: 1.5mm; font-size: 8.5pt; line-height: 1.4; overflow-wrap: anywhere; white-space: pre-line; }
.card-info b { color: #555; font-weight: 700; }
.card-link { margin-top: 1mm; font-size: 9pt; line-height: 1.4; }
.card-link a { color: #1c1c1c; text-decoration: none; }
/* PLANTA do setor: uma folha por planta (depois da lista do setor), com um círculo numerado (o Nº do item) em cada posição marcada */
.planta-pagina { break-before: page; page-break-before: always; text-align: center; }
.planta-pagina + .setor { break-before: page; page-break-before: always; }
.setor h2 { break-after: avoid; page-break-after: avoid; }
.planta-titulo { text-align: left; margin: 0 0 3mm; padding-bottom: 1.5mm; border-bottom: 2px solid #1c1c1c; font-family: 'Archivo', 'Inter', 'Segoe UI', Arial, sans-serif; font-weight: 800; font-size: 13px; text-transform: uppercase; letter-spacing: .08em; }
.planta-titulo small { font-weight: 700; color: #888; font-size: 11px; letter-spacing: 0; margin-left: 3mm; text-transform: none; }
.planta-palco { position: relative; display: inline-block; line-height: 0; border: 1px solid #c9c9c9; background: #fff; }
.planta-palco img { display: block; max-width: 275mm; max-height: 148mm; width: auto; height: auto; }
.pino { position: absolute; transform: translate(-50%, -50%); width: 7mm; height: 7mm; border-radius: 50%; background: #d6342c; color: #fff; border: .6mm solid #fff; box-shadow: 0 0 1.2mm rgba(0,0,0,.55); font-size: 9pt; font-weight: 800; line-height: 5.8mm; text-align: center; }
.planta-nota { margin-top: 2mm; font-size: 8pt; color: #777; text-align: left; line-height: 1.3; }
`;

  // Navegadores SEM suporte às caixas de margem do @page (Safari/iPhone, Chrome antigo) não mostrariam o rodapé do escritório nem a contagem de
  // páginas: neles o rodapé vai em linha, no fim do documento (a marca "sem-margem" liga isso só no papel). Chrome/Edge 131+ usam a margem.
  const SCRIPT_MARGEM = '<script>(function(){var m=/(?:Chrome|Edg)[/]([0-9]+)/.exec(navigator.userAgent||"");if(!(m&&+m[1]>=131))document.documentElement.className+=" sem-margem";})();</' + 'script>';

  function linha(i) {
    const href = i.link ? hrefSeguro(i.link) : null;
    const extras = (i.fotosExtras || []).filter((f) => f && f.url);
    const foto = (i.fotoUrl ? `<span class="foto"><img src="${esc(i.fotoUrl)}" alt="${esc(i.item)}"></span>` : '<span class="sem">—</span>') +
      (extras.length ? `<div class="foto-extras">${extras.map((f) => `<img src="${esc(f.url)}" alt="">`).join('')}</div>` : '');
    const amb = (i.ambientes || []).map((a) => `<span class="amb">${esc(a)}</span>`).join('') || '—';
    return `<tr><td class="num">${esc(i.numero)}</td><td>${foto}</td><td class="item"><b>${esc(i.item)}</b>${href ? `<br><a href="${esc(href)}">Ver produto ↗</a>` : ''}</td><td>${amb}</td><td>${esc(i.empresa) || '—'}</td><td class="texto">${esc(i.especificacoes) || '—'}</td><td class="texto">${esc(i.dimensoes) || '—'}</td><td>${esc(i.quantidade) || '—'}</td></tr>`;
  }

  // Um card (modo CARDS): imagem grande da capa, faixa com as fotos extras e os dados embaixo.
  function card(i) {
    const href = i.link ? hrefSeguro(i.link) : null;
    const extras = (i.fotosExtras || []).filter((f) => f && f.url);
    const amb = (i.ambientes || []).map((a) => `<span class="amb">${esc(a)}</span>`).join('');
    const info = (rotulo, valor) => (String(valor == null ? '' : valor).trim() ? `<div><b>${rotulo}:</b> ${esc(valor)}</div>` : '');
    const infos = info('Empresa', i.empresa) + info('Especificações', i.especificacoes) + info('Dimensões', i.dimensoes) + info('Qtd.', i.quantidade);
    return `<div class="card"><div class="card-img">${i.fotoUrl ? `<img src="${esc(i.fotoUrl)}" alt="${esc(i.item)}">` : 'sem foto'}</div>${extras.length ? `<div class="card-extras">${extras.map((f) => `<img src="${esc(f.url)}" alt="">`).join('')}</div>` : ''}` +
      `<div class="card-corpo"><div class="card-titulo"><span class="num-card">${esc(i.numero)}</span><span>${esc(i.item)}</span></div>${amb ? `<div class="card-amb">${amb}</div>` : ''}` +
      `${infos ? `<div class="card-info">${infos}</div>` : ''}${href ? `<div class="card-link"><a href="${esc(href)}">Ver produto ↗</a></div>` : ''}</div></div>`;
  }
  function tabelaDeCards(doSetor) {
    const linhas = [];
    for (let k = 0; k < doSetor.length; k += 2) linhas.push(doSetor.slice(k, k + 2));
    return `<table class="cards"><colgroup><col style="width:50%"><col style="width:50%"></colgroup><tbody>${linhas.map((p) => `<tr>${p.map((i) => `<td class="card-td">${card(i)}</td>`).join('')}${p.length === 1 ? '<td class="card-td"></td>' : ''}</tr>`).join('')}</tbody></table>`;
  }
  // Plantas do setor (opcional): `o.plantas[setor] = [{ id, nome, url, marcas: [{ itemId, numero, x, y }] }]`; x/y são frações (0..1) da imagem.
  // Uma folha por planta, DEPOIS da lista do setor (assim a primeira folha não fica só com o cabeçalho). Planta sem endereço de imagem é pulada.
  const frac = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0; };
  function paginasDePlanta(setor, plantas) {
    const lista = plantas && Array.isArray(plantas[setor]) ? plantas[setor] : [];
    return lista.filter((p) => p && p.url).map((p) => {
      const pinos = (Array.isArray(p.marcas) ? p.marcas : []).map((m) => `<span class="pino" style="left:${(frac(m.x) * 100).toFixed(3)}%; top:${(frac(m.y) * 100).toFixed(3)}%;">${esc(m.numero)}</span>`).join('');
      return `<section class="planta-pagina"><div class="planta-titulo">${esc(setor)} — ${esc(p.nome || 'Planta')}<small>Planta</small></div><div class="planta-palco"><img src="${esc(p.url)}" alt="">${pinos}</div><div class="planta-nota">Cada número é o do item na lista deste setor, nas folhas anteriores.</div></section>`;
    }).join('');
  }

  // O rodapé de TODAS as páginas: nome, telefone, e-mail e Instagram do escritório (só o que foi cadastrado).
  // No papel vai na margem de baixo de cada folha (@page, ver acima); na tela (prévia do celular) aparece no fim do documento.
  const partesDoRodape = (e) => { const o = e || {}; return [o.nome, o.whatsapp, o.email, o.instagram].map((x) => String(x || '').trim()).filter(Boolean); };
  function rodapeDoEscritorio(e) {
    const partes = partesDoRodape(e);
    return partes.length ? `<div class="rodape-escritorio">${partes.map(esc).join(' &nbsp;·&nbsp; ')}</div>` : '';
  }

  // opcoes: { nomeProjeto, logo (url|null), itens (com fotosExtras [{id,url}]), setores, modos { setor: 'cards' } (sem entrada = lista), plantas { setor: [{ nome, url, marcas }] }, setor ('' = todos), agora (Date), escritorio: { nome, whatsapp (formatado), email, instagram (com @) } } -> { html, totalItens, setores }
  function montarHtml(opcoes) {
    const o = opcoes || {};
    const itens = Array.isArray(o.itens) ? o.itens : [];
    const setores = [...(Array.isArray(o.setores) ? o.setores : [])];
    itens.forEach((i) => { if (!setores.includes(i.setor)) setores.push(i.setor); });
    const incluidos = setores.filter((s) => (!o.setor || s === o.setor) && itens.some((i) => i.setor === s));
    if (!incluidos.length) throw new Error('Não há itens no memorial para gerar o PDF.');
    const blocos = incluidos.map((setor) => {
      const doSetor = itens.filter((i) => i.setor === setor);
      const cards = o.modos && o.modos[setor] === 'cards';
      return `<section class="setor"><h2>${esc(setor)} <span>${doSetor.length}</span></h2>${cards ? tabelaDeCards(doSetor) : `<table><thead><tr><th>Nº</th><th>Foto</th><th>Item</th><th>Ambiente</th><th>Empresa</th><th>Especificações</th><th>Dimensões</th><th>Qtd.</th></tr></thead><tbody>${doSetor.map(linha).join('')}</tbody></table>`}</section>${paginasDePlanta(setor, o.plantas)}`;
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
