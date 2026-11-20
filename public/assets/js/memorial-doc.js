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

  const CSS = `
@page { size: A4 landscape; margin: 10mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: 'Inter', 'Segoe UI', Arial, Helvetica, sans-serif; font-size: 16px; line-height: 1.55; color: #1c1c1c; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.folha { width: 297mm; padding: 10mm; margin: 0 auto; background: #fff; }
@media print { .folha { width: auto; padding: 0; margin: 0; } }
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
`;

  function linha(i) {
    const href = i.link ? hrefSeguro(i.link) : null;
    const foto = i.fotoUrl ? `<span class="foto"><img src="${esc(i.fotoUrl)}" alt="${esc(i.item)}"></span>` : '<span class="sem">—</span>';
    const amb = (i.ambientes || []).map((a) => `<span class="amb">${esc(a)}</span>`).join('') || '—';
    return `<tr><td class="num">${esc(i.numero)}</td><td>${foto}</td><td class="item"><b>${esc(i.item)}</b>${href ? `<br><a href="${esc(href)}">Ver produto ↗</a>` : ''}</td><td>${amb}</td><td>${esc(i.empresa) || '—'}</td><td class="texto">${esc(i.especificacoes) || '—'}</td><td class="texto">${esc(i.dimensoes) || '—'}</td><td>${esc(i.quantidade) || '—'}</td></tr>`;
  }

  // opcoes: { nomeProjeto, logo (url|null), itens, setores, setor ('' = todos), agora (Date) } -> { html, totalItens, setores }
  function montarHtml(opcoes) {
    const o = opcoes || {};
    const itens = Array.isArray(o.itens) ? o.itens : [];
    const setores = [...(Array.isArray(o.setores) ? o.setores : [])];
    itens.forEach((i) => { if (!setores.includes(i.setor)) setores.push(i.setor); });
    const incluidos = setores.filter((s) => (!o.setor || s === o.setor) && itens.some((i) => i.setor === s));
    if (!incluidos.length) throw new Error('Não há itens no memorial para gerar o PDF.');
    const blocos = incluidos.map((setor) => {
      const doSetor = itens.filter((i) => i.setor === setor);
      return `<section class="setor"><h2>${esc(setor)} <span>${doSetor.length}</span></h2><table><thead><tr><th>Nº</th><th>Foto</th><th>Item</th><th>Ambiente</th><th>Empresa</th><th>Especificações</th><th>Dimensões</th><th>Qtd.</th></tr></thead><tbody>${doSetor.map(linha).join('')}</tbody></table></section>`;
    }).join('');
    const logo = o.logo ? `<img src="${esc(o.logo)}" alt="">` : '';
    const agora = o.agora instanceof Date ? o.agora : new Date();
    const total = incluidos.reduce((s, setor) => s + itens.filter((i) => i.setor === setor).length, 0);
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Memorial de itens — ${esc(o.nomeProjeto || '')}</title>` +
      '<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@800&family=Inter:wght@400;600;700&display=swap" rel="stylesheet">' +
      `<style>${CSS}</style></head><body><div class="folha"><div class="cabecalho">${logo}<div><div class="titulo">MEMORIAL DE ITENS</div><div class="projeto">${esc(o.nomeProjeto || '')}</div><div class="data">${esc(dataPorExtenso(agora))}</div></div></div>${blocos}</div></body></html>`;
    return { html, totalItens: total, setores: incluidos };
  }

  window.MemorialDoc = { montarHtml };
})();
