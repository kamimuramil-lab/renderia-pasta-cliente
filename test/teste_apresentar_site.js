// Lousa de apresentação (site): as funções puras (texto da ata, zoom ancorado, ponto em fração da página, borracha, tempo) e a estrutura
// (botões só no modo escritório, itens do Drive e da galeria, CSS sempre escuro, escolhas do cliente fora do PDF). O desenho em si foi conferido no navegador.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const A = require('../public/assets/js/apresentar.js');
const ler = (...p) => fs.readFileSync(path.join(__dirname, '..', 'public', ...p), 'utf8');
const ok = (m) => console.log('OK  ' + m);

// texto da ata (WhatsApp)
const t = A.textoDaAta({ projeto: 'Apartamento Silva', apresentado: 'Planta original: Planta baixa', notas: '[14:05] DECISÃO: ampliar a varanda\nPENDÊNCIA: medir o terraço', quando: new Date(2026, 10, 21, 14, 32) });
assert.strictEqual(t, '*Reunião - Apartamento Silva*\n21/11/2026 às 14:32\nApresentado: Planta original: Planta baixa\n\n[14:05] DECISÃO: ampliar a varanda\nPENDÊNCIA: medir o terraço');
assert.strictEqual(A.textoDaAta({ projeto: 'X', notas: '   ', quando: new Date(2026, 0, 5, 9, 7) }), '*Reunião - X*\n05/01/2026 às 09:07', 'sem notas nem apresentado: só o cabeçalho');
ok('texto da ata pronto pro WhatsApp (data, o que foi apresentado, anotações)');

assert.strictEqual(A.duracao(0), '00:00'); assert.strictEqual(A.duracao(65), '01:05'); assert.strictEqual(A.duracao(3725), '62:05');
ok('relógio da reunião (mm:ss)');

// ponto em fração da página, com a página deslocada/ampliada (o retângulo já vem com o zoom)
assert.deepStrictEqual(A.fracao(150, 250, { left: 100, top: 200, width: 200, height: 100 }), { x: 0.25, y: 0.5 });
assert.deepStrictEqual(A.fracao(100, 200, { left: 100, top: 200, width: 200, height: 100 }), { x: 0, y: 0 });
// zoom ancorado: o ponto sob o cursor não sai do lugar, em qualquer zoom
for (const [mx, my, z0, z1] of [[300, 200, 1, 2], [10, 10, 1, 0.5], [500, 400, 2.5, 6], [120, 80, 1, 99], [120, 80, 1, 0.001]]) {
  const v0 = { zoom: z0, tx: 40, ty: -20 };
  const v1 = A.zoomEm(v0, mx, my, z1);
  assert.ok(v1.zoom >= 0.4 && v1.zoom <= 6, 'zoom limitado a 0,4x..6x');
  const pagX = (mx - v0.tx) / v0.zoom, pagY = (my - v0.ty) / v0.zoom;            // ponto da página sob o cursor ANTES
  assert.ok(Math.abs(v1.tx + pagX * v1.zoom - mx) < 1e-9 && Math.abs(v1.ty + pagY * v1.zoom - my) < 1e-9, 'o ponto sob o cursor continua sob o cursor');
}
ok('zoom ancorado no cursor (o ponto sob o mouse não se mexe) e limitado a 0,4x–6x');

// borracha: só leva o risco que passa perto
const risco = { pts: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }] };
assert.strictEqual(A.riscoPerto(risco, { x: 0.101, y: 0.1 }, 0.016), true); assert.strictEqual(A.riscoPerto(risco, { x: 0.9, y: 0.9 }, 0.016), false);
ok('borracha apaga só o risco que passa perto do ponto');

// ---------- estrutura ----------
const html = ler('index.html'); const css = ler('assets', 'css', 'lousa.css'); const style = ler('assets', 'css', 'style.css');
const main = ler('assets', 'js', 'main.js'); const hub = ler('assets', 'js', 'hub.js'); const mod = ler('assets', 'js', 'apresentar.js');
assert.ok(html.includes('assets/css/lousa.css') && html.indexOf('assets/js/apresentar.js') > 0 && html.indexOf('assets/js/apresentar.js') < html.indexOf('assets/js/hub.js'), 'CSS e script da lousa carregados (antes do hub)');
assert.ok(/\.so-escritorio\{ display:none !important; \}\s*body\.modo-escritorio \.so-escritorio\{ display:inline-flex !important; \}/.test(style), 'botões "Apresentar" só aparecem no modo escritório');
assert.ok(html.includes('id="btnApresentarGaleria"') && html.includes('id="btnApresentarPlanta"') && /btnApresentarGaleria[^>]*so-escritorio|so-escritorio[^>]*btnApresentarGaleria/.test(html), 'botão nos topos da galeria e da planta, marcado como só-escritório');
assert.ok(hub.includes('data-apresentar="todos"') && hub.includes("d.secao === 'planta_original' || d.secao === 'conceitual'") && hub.includes('/apresentar/documento/'), 'Planta original e Projeto conceitual: botão da seção e de cada documento, buscando o arquivo pelo servidor');
assert.ok(main.includes('itensDoProjetoCriativo') && main.includes("f.tipo !== '360'") && main.includes('logoDoEscritorio'), 'Projeto criativo: plantas e imagens (sem 360°) e o logo/ícone do escritório');
assert.ok(/iconePersonalizado && g\.iconePersonalizado\.url\) \|\| \(g\.marcaDagua/.test(main), 'logo da lousa: o ícone do escritório, senão o logo (aparece sozinho, vindo das Configurações)');
assert.ok(css.includes('.lousa{ position:fixed;') && css.includes('background:#101113') && css.includes('--destaque'), 'lousa sempre escura e usa a cor de destaque do escritório');
assert.ok(/\.lousa-ferr\{ width:38px;/.test(css) && /\.lousa-notas\{ width:208px;/.test(css) && css.includes('.lousa.sem-notas .lousa-notas{ display:none; }'), 'ferramentas e anotações pequenas; anotações recolhem');
['ponteiro', 'caneta', 'marcador', 'temp', 'borracha', 'mao'].forEach((f) => assert.ok(mod.includes(`'${f}'`), 'ferramenta ' + f));
assert.ok(mod.includes('lousaPrint') && mod.includes("/reunioes`") && mod.includes("'x-cliente-token'"), 'print e salvar ata ligados');
assert.ok(!mod.includes('innerHTML = texto') && mod.includes('esc(p.rotulo)'), 'texto de fora é escapado nos prints');
ok('botões só no modo escritório (galeria, planta, Planta original, Projeto conceitual), itens do Drive/galeria, logo do escritório, lousa escura e enxuta');

// o cliente não escolhe mais nome/paleta/logo no PDF: o arquiteto define
['chkPdfNomes', 'chkPdfPaleta', 'pdfMarca', 'pdfQualidade'].forEach((id) => assert.ok(!html.includes(`id="${id}"`), id));
ok('PDF do cliente: só a escolha dos ambientes na tela dele');

// capa do ambiente na galeria
assert.ok(html.includes('id="capaAmbienteVisualizador"') && style.includes('.capa-ambiente-slide') && style.includes('img.capa-escura') && main.includes("classList.toggle('capa-escura', !!foto.__ehMood)"), 'capa do ambiente: foto escurecida preenchendo a tela, com o nome grande');
ok('capa do ambiente: slide próprio, escurecido, com o nome grande');
console.log('\nTudo certo: lousa de apresentação (site).');
