// Enquadramento automático da planta (planta-encaixe.js): acha onde está o desenho e ignora o branco em volta.
// Lógica pura, testada com imagens sintéticas (RGBA). O desenho no navegador foi conferido à parte.
const assert = require('assert'); const fs = require('fs'); const path = require('path');
const E = require('../public/assets/js/planta-encaixe.js');
const ok = (m) => console.log('OK ', m);

function imagem(w, h, fundo, a) { // fundo = [r,g,b] ; a = alfa do fundo (255 padrão)
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = fundo[0]; data[i * 4 + 1] = fundo[1]; data[i * 4 + 2] = fundo[2]; data[i * 4 + 3] = a === undefined ? 255 : a; }
  return { data, width: w, height: h };
}
function retangulo(im, x0, y0, x1, y1, cor) { // preenchido
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * im.width + x) * 4; im.data[i] = cor[0]; im.data[i + 1] = cor[1]; im.data[i + 2] = cor[2]; im.data[i + 3] = 255; }
}
const perto = (a, b, tol, m) => assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} deveria estar perto de ${b}`);

// 1) desenho no meio de uma imagem branca: a caixa fica em volta dele, com folga pequena
let im = imagem(800, 600, [255, 255, 255]);
retangulo(im, 200, 150, 600, 450, [40, 40, 40]);
let c = E.calcularConteudo(im);
assert.ok(c, 'achou o desenho');
perto(c.x0, 0.25, 0.03, 'esquerda'); perto(c.x1, 0.75, 0.03, 'direita'); perto(c.y0, 0.25, 0.03, 'topo'); perto(c.y1, 0.75, 0.03, 'base');
assert.ok(c.x0 < 0.25 && c.x1 > 0.75 && c.y0 < 0.25 && c.y1 > 0.75, 'com folga (nunca encosta no desenho)');
ok('desenho no meio da imagem branca');

// 2) poeira longe do desenho não estica a caixa (poucos pixels soltos); uma legenda grande conta como conteúdo
retangulo(im, 5, 5, 8, 8, [0, 0, 0]);       // 9 pixels
retangulo(im, 790, 590, 793, 592, [0, 0, 0]);
const c2 = E.calcularConteudo(im);
assert.ok(c2 && Math.abs(c2.x0 - c.x0) < 0.005 && Math.abs(c2.y1 - c.y1) < 0.005, 'poeira ignorada');
ok('pontinhos soltos são ignorados');
im = imagem(800, 600, [255, 255, 255]); retangulo(im, 200, 150, 600, 450, [40, 40, 40]); retangulo(im, 20, 560, 300, 590, [80, 80, 80]); // legenda embaixo
const c3 = E.calcularConteudo(im);
assert.ok(c3 === null || c3.y1 > 0.95, 'legenda grande entra na caixa (ou desiste): nunca corta conteúdo');
ok('legenda grande não é cortada');

// 3) fundo que não é branco (cinza de uma cor só) funciona; PNG transparente conta como branco
im = imagem(800, 600, [200, 200, 205]); retangulo(im, 300, 100, 500, 400, [20, 20, 20]);
c = E.calcularConteudo(im); assert.ok(c && c.x0 > 0.3 && c.x1 < 0.7, 'fundo cinza');
im = imagem(800, 600, [0, 0, 0], 0); retangulo(im, 300, 100, 500, 400, [20, 20, 20]); // fundo transparente
c = E.calcularConteudo(im); assert.ok(c && c.x0 > 0.3 && c.x1 < 0.7, 'fundo transparente');
ok('fundo cinza e fundo transparente');

// 4) sem fundo confiável (degradê/foto) ou sem desenho: null = imagem inteira
im = imagem(800, 600, [0, 0, 0]);
for (let y = 0; y < 600; y++) for (let x = 0; x < 800; x++) { const i = (y * 800 + x) * 4; im.data[i] = (x * 255 / 800) | 0; im.data[i + 1] = (y * 255 / 600) | 0; im.data[i + 2] = ((x + y) * 255 / 1400) | 0; im.data[i + 3] = 255; }
assert.strictEqual(E.calcularConteudo(im), null, 'degradê: sem fundo confiável');
assert.strictEqual(E.calcularConteudo(imagem(800, 600, [255, 255, 255])), null, 'imagem vazia');
im = imagem(800, 600, [255, 255, 255]); retangulo(im, 10, 10, 790, 590, [30, 30, 30]); // ocupa quase tudo
assert.strictEqual(E.calcularConteudo(im), null, 'desenho já ocupa quase a imagem: nada a ganhar');
assert.strictEqual(E.calcularConteudo(null), null); assert.strictEqual(E.calcularConteudo({ data: new Uint8ClampedArray(4), width: 1, height: 1 }), null);
ok('dúvida = imagem inteira (null)');

// 5) ícones e textos na margem entram na caixa
im = imagem(800, 600, [255, 255, 255]); retangulo(im, 200, 150, 600, 450, [40, 40, 40]);
c = E.calcularConteudo(im);
const u = E.unirComPontos(c, [{ x: 0.05, y: 0.5, m: 0.04 }, { x: 0.5, y: 0.97, m: 0.04 }]);
assert.ok(u && u.x0 <= 0.0101 && u.y1 >= 0.99 && u.x1 === c.x1, 'ícone na margem esquerda e embaixo');
assert.strictEqual(E.unirComPontos(null, [{ x: 0.5, y: 0.5 }]), null, 'sem caixa continua sem caixa');
assert.strictEqual(E.unirComPontos(c, [{ x: 0.02, y: 0.02, m: 0.04 }, { x: 0.98, y: 0.98, m: 0.04 }]), null, 'pontos nos cantos opostos: não sobra ganho -> imagem inteira');
assert.ok(E.unirComPontos(c, [{ x: NaN, y: 'a' }]), 'ponto inválido é ignorado');
ok('ícones e textos na margem não ficam fora da tela');

// 6) geometria: a caixa enche a área visível e fica no centro; sem caixa = jeito antigo (imagem inteira centralizada)
let g = E.geometria({ x0: 0.25, y0: 0.25, x1: 0.75, y1: 0.75 }, 1000, 600, 1000, 300);
perto(g.baseH * 0.5, 300, 0.01, 'a altura do desenho enche a tela (limitado pela altura)');
perto(g.tx + 0.5 * g.baseW, 500, 0.01, 'centro do desenho no centro horizontal');
perto(g.ty + 0.5 * g.baseH, 150, 0.01, 'centro do desenho no centro vertical');
g = E.geometria(null, 1000, 600, 500, 500);
perto(g.baseW, 500, 0.01, 'sem caixa: a imagem inteira cabe pela largura'); perto(g.baseH, 300, 0.01, 'proporção mantida'); perto(g.tx, 0, 0.01, 'sem deslocamento horizontal'); perto(g.ty, 100, 0.01, 'centralizada na vertical');
ok('geometria do palco');

// 7) ligações no planta.js e no index.html
const planta = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'js', 'planta.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
assert.ok(html.indexOf('planta-encaixe.js') > 0 && html.indexOf('planta-encaixe.js') < html.indexOf('assets/js/planta.js'), 'o módulo carrega antes do planta.js');
assert.ok(/img\.crossOrigin = 'anonymous'/.test(planta) && /img\.onerror = \(\) => \{ if \(img\.crossOrigin\)/.test(planta), 'imagem com CORS e plano B sem CORS');
assert.ok(/ST\.conteudo = medirConteudo\(img\)/.test(planta) && /unirComPontos\(ST\.conteudo, pontos\)/.test(planta), 'mede o desenho e junta com ícones/textos');
assert.ok(/ST\.tx = ST\.tx0 \|\| 0/.test(planta), 'o botão 100% volta ao enquadramento do desenho');
assert.ok(/palco\.style\.clipPath = caixa \? `inset\(/.test(planta), 'a margem vazia não é mostrada (só visual)');
ok('ligações no planta.js e no index.html');

console.log('\nTudo certo: enquadramento automático da planta.');
