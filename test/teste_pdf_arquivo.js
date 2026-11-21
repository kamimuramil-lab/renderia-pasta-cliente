// Testa o escritor de PDF de verdade (pdf-arquivo.js, parte pura) e a página "PDF pronto" do celular (impressao.js).
// O desenho das páginas (canvas) só roda no navegador: foi conferido à parte, vendo o resultado.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { montarPdf, textoPdf, alturasDaPaleta } = require('../public/assets/js/pdf-arquivo.js');
const ok = (m) => console.log('OK  ' + m);

// um JPEG mínimo válido (1x1)
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
const jpegs = [0, 1, 2].map((i) => ({ jpeg: new Uint8Array(Buffer.concat([JPEG, Buffer.from([i])])), largura: 2105, altura: 1488 }));

console.log('== 1. Estrutura do PDF ==');
const pdf = Buffer.from(montarPdf(jpegs, { titulo: 'Imagens do projeto — APA DGT', data: new Date(2026, 10, 20, 22, 3, 25) }));
const txt = pdf.toString('latin1');
assert.ok(txt.startsWith('%PDF-1.4\n') && txt.trimEnd().endsWith('%%EOF'), 'cabeçalho e fim');
assert.ok(/\/Count 3 \/Kids \[3 0 R 6 0 R 9 0 R\]/.test(txt), '3 páginas, na ordem');
assert.strictEqual((txt.match(/\/MediaBox \[0 0 841\.89 595\.28\]/g) || []).length, 3, 'cada página é A4 paisagem, sem margem');
assert.strictEqual((txt.match(/\/Filter \/DCTDecode/g) || []).length, 3, 'um JPEG por página');
// o xref aponta cada objeto pro byte certo
const iniXref = Number(/startxref\n(\d+)\n%%EOF/.exec(txt)[1]);
assert.ok(txt.slice(iniXref, iniXref + 5) === 'xref\n', 'startxref aponta o xref');
const tam = Number(/\/Size (\d+)/.exec(txt)[1]);
const linhas = txt.slice(iniXref).split('\n').slice(3, 3 + tam - 1);
assert.strictEqual(linhas.length, tam - 1);
linhas.forEach((l, i) => {
  assert.strictEqual(l.length + 1, 20, 'cada entrada do xref tem 20 bytes');
  const off = Number(l.slice(0, 10));
  assert.ok(txt.slice(off).startsWith((i + 1) + ' 0 obj\n'), `objeto ${i + 1} começa no offset do xref`);
});
// o /Length de cada imagem bate com os bytes do stream
let achou = 0;
txt.replace(/\/Length (\d+) >>\nstream\n/g, (m, len, pos) => {
  const ini = pos + m.length;
  const resto = txt.slice(ini + Number(len), ini + Number(len) + 17);
  assert.strictEqual(resto, '\nendstream\nendobj', 'o stream termina exatamente onde o /Length diz');
  achou++;
});
assert.strictEqual(achou, 6, '3 conteúdos + 3 imagens');
ok('PDF de 3 páginas: xref, offsets e comprimentos corretos; A4 paisagem; 1 JPEG por página');

console.log('== 2. Título com acento e caracteres especiais ==');
assert.strictEqual(textoPdf('abc (x)\\'), '(abc \\(x\\)\\\\)');
assert.strictEqual(textoPdf('Imagens — açaí'), '<FEFF0049006D006100670065006E0073002020140020006100E7006100ED>'); // "—" = 2014, "ç" = 00E7, "í" = 00ED
assert.ok(txt.includes('/Title <FEFF'), 'título com acento vai em UTF-16BE');
assert.ok(/\/CreationDate \(D:20261120220325\)/.test(txt), 'data de criação');
ok('título (ASCII e UTF-16) e data');

console.log('== 3. Faixa de cores: alturas proporcionais, mínimo de 13 mm ==');
const h = alturasDaPaleta([{ pct: .5 }, { pct: .3 }, { pct: .15 }, { pct: .03 }, { pct: .02 }], 188);
assert.ok(Math.abs(h.reduce((s, v) => s + v, 0) + 0.7 * 4 - 188) < 0.01, 'as alturas + os vãos de 0,7 mm preenchem a foto');
assert.ok(h.every((v) => v >= 13 - 1e-9), 'nenhuma cor fica abaixo de 13 mm');
assert.ok(h[0] > h[1] && h[1] > h[2], 'a que mais aparece é a mais alta');
ok('alturas da faixa');

console.log('== 4. Página "PDF pronto" do celular ==');
global.window = {}; // impressao.js se pendura no window
global.navigator = { userAgent: '' };
const src = fs.readFileSync(path.join(__dirname, '../public/assets/js/impressao.js'), 'utf8');
new Function('window', 'navigator', src)(global.window, global.navigator);
const pag = global.window.Impressao.paginaDoArquivo('blob:https://x/abc-123', 'APA DGT - Imagens 20-11-2026 22h03.pdf', { paginas: 16, bytes: 6.4 * 1048576, aviso: '1 imagem(ns) não puderam ser carregadas.' });
assert.ok(pag.includes('PDF pronto') && pag.includes('16 páginas · 6,4 MB') && pag.includes('Compartilhar / Salvar') && pag.includes('href="blob:https://x/abc-123"') && pag.includes('download="APA DGT - Imagens 20-11-2026 22h03.pdf"'), 'textos, links e nome do arquivo');
assert.ok(pag.includes('navigator.share') && pag.includes('navigator.canShare') && pag.includes('AbortError'), 'folha de compartilhar com plano B (abre o PDF)');
assert.ok(pag.includes('1 imagem(ns) não puderam ser carregadas.'), 'o aviso aparece');
const mau = global.window.Impressao.paginaDoArquivo('blob:x', 'a</script><b>"x.pdf', {});
assert.ok(!/a<\/script><b>/.test(mau.replace(/<\/script><\/body>/, '')), 'o nome do arquivo nunca fecha o script nem injeta HTML');
ok('página PDF pronto: botões, nome do arquivo, aviso e escape');

console.log('\nTODOS OS TESTES DO PDF EM ARQUIVO PASSARAM');
