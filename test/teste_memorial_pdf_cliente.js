// Etapas 4 e B do memorial: os PDFs que o CLIENTE gera na página (documento de impressão `memorial-doc.js` e desenho em canvas `memorial-arquivo.js`)
// mostram o modo CARDS do setor e as PLANTAS com os círculos numerados. Layout da etapa B: cada setor é UM bloco (moldura + faixa escura com o nome,
// no cabeçalho da tabela, que repete a cada folha), a PLANTA é a primeira linha do bloco (em cima) e os itens vêm logo abaixo; item com várias fotos
// sai com UMA linha/card POR FOTO repetindo os dados. O visual foi conferido no Electron real (impressão) e num navegador real (canvas);
// aqui ficam as regras que não dependem de tela.
const assert = require('assert'); const path = require('path'); const fs = require('fs');
const js = (n) => path.join(__dirname, '..', 'public', 'assets', 'js', n);
global.window = {};
global.window.PlantaTextos = require(js('planta-textos.js')); // a página carrega este arquivo depois dos geradores; aqui já fica pronto
require(js('memorial-doc.js')); const MemorialDoc = global.window.MemorialDoc;
require(js('memorial-arquivo.js')); const MemorialArquivo = global.window.MemorialArquivo;
const ok = (m) => console.log('OK ', m);

const itens = [
  { id: 'a1', setor: 'Louças', numero: 1, item: 'Vaso <b>', ambientes: ['B.01'], empresa: 'Deca', especificacoes: 'Branco', dimensoes: '', quantidade: '1', fotoUrl: 'https://f/a.webp', fotosExtras: [{ id: 'x1', url: 'https://f/a2.webp' }, { id: 'x2', url: 'https://f/a3.webp' }], link: 'https://p/vaso' },
  { id: 'a2', setor: 'Louças', numero: 2, item: 'Cuba', ambientes: [], empresa: '', especificacoes: '', dimensoes: '', quantidade: '', fotoUrl: null, fotosExtras: [] },
  { id: 'b1', setor: 'Móveis', numero: 1, item: 'Poltrona', ambientes: ['LV', 'Varanda'], empresa: 'M', especificacoes: 'Linho', dimensoes: '80 cm', quantidade: '2', fotoUrl: 'https://f/b.webp', fotosExtras: [{ id: 'x3', url: 'https://f/b2.webp' }], link: 'javascript:alert(1)' },
  { id: 'b2', setor: 'Móveis', numero: 2, item: 'Mesa', ambientes: ['LV'], empresa: '', especificacoes: '', dimensoes: '', quantidade: '', fotoUrl: null, fotosExtras: [] },
  { id: 'b3', setor: 'Móveis', numero: 3, item: 'Pufe', ambientes: [], empresa: '', especificacoes: '', dimensoes: '', quantidade: '', fotoUrl: 'https://f/c.webp', fotosExtras: [] }
];
const plantas = {
  'Louças': [{ id: 'p1', nome: 'Banheiros <1>', url: 'https://f/planta1.webp', marcas: [{ itemId: 'a1', numero: 1, x: 0.25, y: 0.5 }, { itemId: 'a2', numero: 2, x: 1.4, y: -3 }] }],
  'Móveis': [{ id: 'p2', nome: 'Sala', url: 'https://f/planta2.webp', marcas: [] }, { id: 'p3', nome: 'Sem imagem', url: '', marcas: [] }]
};
const base = { nomeProjeto: 'Apto', itens, setores: ['Louças', 'Móveis'], setor: '', agora: new Date(2026, 11, 3) };
const contar = (s, re) => (s.match(re) || []).length;

// ---------- 1. documento de impressão (memorial-doc.js) ----------
{
  let r = MemorialDoc.montarHtml(base);
  assert.ok(!r.html.includes('class="card"') && !r.html.includes('<tr class="linha-planta">'), 'sem modos nem plantas: lista, sem card nem planta');
  assert.strictEqual(contar(r.html, /<table class="setor-tabela">/g), 2, 'sem modos: duas tabelas de lista (uma por setor)');
  assert.ok(contar(r.html, /<tr class="titulo-setor"><th colspan="8">/g) === 2 && r.html.includes('Louças<span>2 itens</span>') && r.html.includes('Móveis<span>3 itens</span>'), 'faixa do setor (nome + nº de itens) no CABEÇALHO da tabela: é ele que se repete a cada folha');
  assert.ok(!r.html.includes('<h2>') && !r.html.includes('foto-extras'), 'sem título solto fora da tabela e sem faixa de miniaturas');
  assert.strictEqual(contar(r.html, /<td class="num">/g), 3 + 1 + 2 + 1 + 1, 'uma linha POR FOTO: Vaso (capa+2 extras)=3, Cuba (sem foto)=1, Poltrona (capa+1)=2, Mesa=1, Pufe=1');
  assert.strictEqual(contar(r.html, /<b>Vaso &lt;b&gt;<\/b>/g), 3, 'o item repete o nome nas 3 linhas');
  assert.strictEqual(contar(r.html, /Ver produto ↗/g), 3, 'e repete o link (e demais dados) em cada linha');
  assert.ok(['foto 1/3', 'foto 2/3', 'foto 3/3', 'foto 1/2', 'foto 2/2'].every((s) => r.html.includes(s)) && contar(r.html, /class="foto-n"/g) === 5, 'cada linha diz de qual foto é; item de uma foto só (ou sem foto) não ganha marca');
  assert.ok(['https://f/a.webp', 'https://f/a2.webp', 'https://f/a3.webp', 'https://f/b2.webp'].every((u) => r.html.includes(u)), 'todas as fotos aparecem, cada uma na sua linha');
  ok('lista: faixa escura do setor no cabeçalho, uma linha por foto repetindo os dados do item');

  r = MemorialDoc.montarHtml({ ...base, modos: { 'Móveis': 'cards' } });
  assert.strictEqual(contar(r.html, /<table class="setor-tabela">/g), 1, 'só Louças fica em lista');
  assert.strictEqual(contar(r.html, /<table class="cards setor-tabela">/g), 1, 'Móveis em cards');
  assert.strictEqual(contar(r.html, /<tr class="titulo-setor"><th colspan="2">Móveis<span>3 itens<\/span>/g), 1, 'cards: faixa do setor também no cabeçalho da tabela');
  assert.strictEqual(contar(r.html, /<div class="card">/g), 4, 'um card POR FOTO: Poltrona (2) + Mesa + Pufe');
  assert.strictEqual(contar(r.html, /<td class="card-td">/g), 4, '2 cards por linha: 4 cards = 2 linhas cheias');
  assert.ok(!r.html.includes('card-extras'), 'sem faixa de miniaturas nos cards');
  assert.strictEqual(contar(r.html, /<span class="num-card">1<\/span><span>Poltrona<span class="foto-n">foto \d\/2<\/span><\/span>/g), 2, 'os 2 cards da Poltrona repetem número e nome e dizem "foto 1/2" e "foto 2/2"');
  assert.ok(!r.html.includes('javascript:') && contar(r.html, /Ver produto ↗/g) === 3, 'link inseguro (javascript:) nunca vira link; o item da lista repete o link nas 3 linhas');
  assert.ok(r.html.includes('sem foto'), 'card sem foto diz "sem foto"');
  assert.ok(!/<div class="card-info"><\/div>/.test(r.html), 'card sem dados não desenha a caixa de dados vazia');
  ok('modo Cards por setor: 2 por linha, um card por foto, sem link inseguro, setores misturados (lista + cards) no mesmo PDF');

  r = MemorialDoc.montarHtml({ ...base, plantas });
  assert.strictEqual(contar(r.html, /<tr class="linha-planta">/g), 2, 'uma linha de planta por planta com imagem (a planta sem endereço é pulada)');
  assert.strictEqual(contar(r.html, /class="pino"/g), 2, 'um círculo por marca');
  assert.ok(r.html.includes('left:25.000%; top:50.000%;') && r.html.includes('left:100.000%; top:0.000%;'), 'posição em % da imagem; fora do intervalo é limitada a 0..1');
  assert.ok(r.html.includes('>1</span>') && r.html.includes('>Louças — Planta</div>') && !r.html.includes('Banheiros'), 'título "SETOR — Planta" (nunca o nome do arquivo/planta); número do item no círculo');
  const iFaixa = r.html.indexOf('Louças<span>'), iPlanta = r.html.indexOf('Louças — Planta'), iItens = r.html.indexOf('<td class="num">'), iMoveis = r.html.indexOf('Móveis<span>');
  assert.ok(iFaixa > 0 && iFaixa < iPlanta && iPlanta < iItens && iItens < iMoveis, 'ordem do setor: faixa com o nome, PLANTA em cima, itens logo abaixo, depois o setor seguinte');
  assert.ok(r.html.includes('.setor + .setor') && r.html.includes('max-height: 110mm'), 'cada setor começa em folha nova e a planta tem 110 mm de altura no máximo');
  assert.ok(!r.html.includes('planta-pagina') && !r.html.includes('nas folhas anteriores'), 'a planta não é mais uma folha separada depois da lista');
  ok('plantas: primeira linha do bloco do setor (em cima), círculos em %, escape, ordem certa');

  r = MemorialDoc.montarHtml({ ...base, plantas, modos: { 'Louças': 'cards' }, setor: 'Móveis' });
  assert.ok(!r.html.includes('Louças') && contar(r.html, /<tr class="linha-planta">/g) === 1 && r.html.includes('Móveis — Planta'), 'filtro por setor: só as plantas daquele setor');
  r = MemorialDoc.montarHtml({ ...base, plantas, modos: { 'Móveis': 'cards' } });
  assert.ok(/<tr class="linha-planta"><td class="planta-cel" colspan="2">/.test(r.html) && /colspan="8"><div class="planta-titulo">Louças/.test(r.html), 'a linha da planta ocupa a largura toda da tabela (2 colunas em cards, 8 na lista)');
  assert.ok(!MemorialDoc.montarHtml({ ...base, plantas: { 'Louças': [{ nome: 'x', url: 'https://f/p.webp', marcas: [{ numero: 1, x: 'abc', y: null }] }] } }).html.includes('NaN'), 'marca com posição inválida não gera NaN');
  ok('filtro por setor, largura da linha da planta e posição inválida');
}

// ---------- 2. desenho em canvas (memorial-arquivo.js): medidas, sem tela ----------
{
  assert.ok(typeof MemorialArquivo.gerar === 'function' && typeof MemorialArquivo.medirCard === 'function' && typeof MemorialArquivo.medirLinha === 'function', 'exporta gerar, medirCard e medirLinha');
  // pincel falso: cada palavra tem 4 mm; quebra por largura
  const pc = {
    S: 10,
    estilo: () => ({ tam: 10, esp: 0 }),
    larguraDe: (t) => String(t).length * 10,
    quebrar: (txt, e, maxMm) => {
      const porLinha = Math.max(1, Math.floor(maxMm / 2));
      const saida = [];
      String(txt).split('\n').forEach((par) => { let l = ''; par.split(' ').forEach((p) => { const t = l ? l + ' ' + p : p; if (t.length <= porLinha || !l) l = t; else { saida.push(l); l = p; } }); saida.push(l); });
      return saida;
    }
  };
  const item = { id: 'i', numero: 3, item: 'Poltrona', ambientes: ['LV'], empresa: 'Marca', especificacoes: 'x', dimensoes: '80', quantidade: '1', fotoUrl: 'https://f/a.webp', fotosExtras: [{ url: 'https://f/e.webp' }], link: 'https://p/x' };
  const curto = MemorialArquivo.medirCard(pc, item, 134.5, 170);
  assert.ok(curto.h > 80 + 10 && curto.h < 170, 'card normal: imagem (80) + dados, dentro da folha');
  assert.strictEqual(curto.info.filter((l) => l.rot).length, 4, 'os 4 campos preenchidos viram linhas, cada uma com o rótulo na primeira');
  assert.ok(curto.marca === null && !('extras' in curto), 'item puro (uma foto): sem marca "foto k/n" e sem faixa de extras');
  const segunda = MemorialArquivo.medirCard(pc, { it: item, url: 'https://f/e.webp', k: 1, n: 2 }, 134.5, 170);
  assert.ok(segunda.marca === 'foto 2/2' && segunda.h - curto.h > 3 && segunda.h - curto.h < 4, 'o card da 2ª foto diz "foto 2/2" e ganha uma linha pequena (' + (segunda.h - curto.h).toFixed(2) + ' mm)');
  assert.deepStrictEqual(segunda.info, curto.info, 'e repete os mesmos dados do item');
  const gigante = MemorialArquivo.medirCard(pc, { ...item, especificacoes: Array.from({ length: 400 }, (_, k) => 'palavra' + k).join(' ') }, 134.5, 170);
  assert.ok(gigante.h <= 170, 'texto enorme: o card nunca passa de uma folha (' + gigante.h.toFixed(1) + ' mm)');
  assert.ok(gigante.info.length > 0 && gigante.info[gigante.info.length - 1].t.endsWith('…'), 'o texto cortado termina em "…"');
  const vazio = MemorialArquivo.medirCard(pc, { id: 'v', numero: 1, item: 'Só nome', ambientes: [], fotosExtras: [] }, 134.5, 170);
  assert.ok(vazio.info.length === 0 && !vazio.amb && !vazio.href && vazio.h < curto.h, 'item só com nome: card curto, sem caixas vazias');
  ok('canvas: altura do card (uma foto por card, marca "foto k/n", texto enorme corta com "…", item vazio)');

  const cols = Array.from({ length: 8 }, () => ({ w: 30 }));
  const l1 = MemorialArquivo.medirLinha(pc, item, cols), l2 = MemorialArquivo.medirLinha(pc, { it: item, url: 'https://f/e.webp', k: 1, n: 3 }, cols);
  assert.ok(l1.item.marca === null && l2.item.marca === 'foto 2/3' && l2.item.h > l1.item.h, 'linha da lista: a 2ª foto diz "foto 2/3" e a célula do item ganha essa linha');
  assert.ok(l1.h >= 20, 'a linha tem pelo menos a altura da foto (20 mm)');
  ok('canvas: altura da linha da lista (uma linha por foto, marca "foto k/n")');
}

// ---------- 2b. textos escritos em cima da planta (etapa D): impressão (HTML) e celular (canvas) ----------
{
  const T = (extra) => Object.assign({ id: 't', texto: 'COZINHA', x: 0.3, y: 0.4, tamanho: 0.02, cor: '#112233', fundo: null, contorno: null, negrito: true }, extra || {});
  const comTextos = { 'Louças': [{ id: 'p1', nome: 'x', url: 'https://f/planta1.webp', marcas: [{ itemId: 'a1', numero: 1, x: 0.5, y: 0.5 }], textos: [T({ id: 't1' }), T({ id: 't2', texto: 'Banheiro <b>&</b>', fundo: '#ffffff', fundoOpacidade: 0.5, contorno: '#000000', negrito: false }), T({ id: 't3', texto: '   ' })] }] };
  const base2 = { nomeProjeto: 'P', itens, setores: ['Louças', 'Móveis'], modos: {}, setor: 'Louças', agora: new Date(2026, 11, 1) };
  // impressão
  let h = MemorialDoc.montarHtml({ ...base2, plantas: comTextos }).html;
  const camada = h.match(/<div class="planta-textos">([\s\S]*?)<\/div><div class="planta-pinos"/);
  assert.ok(camada, 'camada de textos dentro da planta, antes dos círculos (os círculos ficam por cima)');
  assert.strictEqual(contar(camada[1], /class="pl-texto /g), 2, 'o texto em branco não sai');
  assert.ok(camada[1].includes('>COZINHA<') && camada[1].includes('Banheiro &lt;b&gt;&amp;&lt;/b&gt;') && !camada[1].includes('<b>'), 'texto escapado');
  assert.ok(camada[1].includes('left:30.000%;top:40.000%;') && camada[1].includes('--t:0.02') && camada[1].includes('background:rgba(255, 255, 255, 0.5)') && camada[1].includes('text-shadow:') && camada[1].includes('font-weight:500'), 'posição em %, tamanho (fração da largura), fundo com opacidade, contorno, sem negrito');
  assert.ok(h.includes('.planta-textos { position: absolute; inset: 0; container-type: size;') && h.includes('calc(var(--t, .018) * 100cqw)'), 'o texto escala com a largura da imagem (cqw), não com a página');
  assert.ok(!MemorialDoc.montarHtml({ ...base2, plantas }).html.includes('class="planta-textos"'), 'planta sem texto: sem camada (o PDF fica igual ao de antes)');
  global.window.PlantaTextos = undefined;
  assert.ok(!MemorialDoc.montarHtml({ ...base2, plantas: comTextos }).html.includes('class="planta-textos"'), 'sem o módulo dos textos a planta sai sem eles, sem quebrar');
  global.window.PlantaTextos = require(js('planta-textos.js'));
  ok('impressão: camada de textos sob os círculos, escapada, com fundo/contorno/negrito, escala pela largura da imagem');

  // tamanho dos círculos (fração da largura da planta, escolhida pelo arquiteto) e faixa suave do setor
  const comTam = (v) => ({ 'Louças': [{ ...comTextos['Louças'][0], tamanhoMarcas: v }] });
  assert.ok(MemorialDoc.montarHtml({ ...base2, plantas: comTam(0.04) }).html.includes('<div class="planta-pinos" style="--m:0.04;">'), 'o tamanho do arquiteto vai pra camada dos círculos');
  for (const v of [undefined, null, 0, -1, 'abc']) assert.ok(MemorialDoc.montarHtml({ ...base2, plantas: comTam(v) }).html.includes('style="--m:0.027;"'), 'servidor antigo/valor ruim: tamanho padrão ' + v);
  assert.ok(h.includes('width: calc(var(--m, .027) * 100cqw)') && h.includes('font-size: calc(var(--m, .027) * 100cqw * .5)') && !h.includes('width: 7mm; height: 7mm'), 'o círculo escala com a largura da imagem (não é mais 7 mm fixos)');
  assert.ok(h.includes('tr.titulo-setor th { background: #eef1f4;') && !/tr\.titulo-setor th \{ background: #1c1c1c/.test(h), 'faixa do setor suave (não mais a faixa preta)');
  assert.ok(h.includes('table.setor-tabela { border: .7pt solid #aeb6c0;'), 'moldura fina do setor');
  ok('impressão: tamanho dos círculos pela planta (padrão se faltar), faixa do setor suave');

  // celular (canvas): contexto de teste que anota o que foi desenhado
  const chamadas = [];
  const medidor = { font: '' };
  const ctx = new Proxy({}, { get: (_, nome) => {
    if (nome === 'measureText') return (s) => ({ width: String(s).length * 0.5 * Number(/([\d.]+)px/.exec(medidor.font)[1]) });
    if (nome === 'font') return medidor.font;
    return (...a) => { chamadas.push([nome, ...a, medidor.font]); };
  }, set: (_, nome, v) => { if (nome === 'font') medidor.font = v; else chamadas.push(['set:' + nome, v]); return true; } });
  chamadas.length = 0;
  MemorialArquivo.desenharTextosDaPlanta(ctx, 10, 20, 30, 200, 100, comTextos['Louças'][0].textos);
  const fills = chamadas.filter((c) => c[0] === 'fillText'), strokes = chamadas.filter((c) => c[0] === 'strokeText');
  assert.strictEqual(fills.length, 2, 'COZINHA + o segundo texto; o texto em branco não é desenhado');
  assert.ok(Math.abs(fills[0][2] - (20 + 0.3 * 200) * 10) < 1e-6, 'x = centro do texto: x0 + fração x largura (em px do canvas)');
  assert.ok(/^700 40px /.test(fills[0][4]) || /^700 40(\.0+)?px /.test(fills[0][4]), 'corpo da letra = tamanho (2%) x largura da imagem (200 mm) x 10 px/mm = 40 px, negrito: ' + fills[0][4]);
  assert.ok(/^500 /.test(fills[1][4]), 'negrito desligado: peso 500');
  assert.strictEqual(strokes.length, 1, 'contorno: só o texto que tem contorno é contornado (antes de preencher)');
  assert.ok(chamadas.some((c) => c[0] === 'set:fillStyle' && c[1] === 'rgba(255, 255, 255, 0.5)'), 'fundo com a opacidade');
  const iFundo = chamadas.findIndex((c) => c[0] === 'fill'), iTexto = chamadas.findIndex((c) => c[0] === 'fillText' && String(c[1]).startsWith('Banheiro'));
  assert.ok(iFundo >= 0 && iFundo < iTexto, 'o fundo é desenhado antes da letra');
  chamadas.length = 0;
  MemorialArquivo.desenharTextosDaPlanta(ctx, 10, 0, 0, 100, 100, [T({ texto: 'SALA\nDE ESTAR', contorno: '#000000' })]);
  const duas = chamadas.filter((c) => c[0] === 'fillText');
  assert.strictEqual(duas.length, 2, 'texto de duas linhas: cada linha é desenhada'); assert.strictEqual(chamadas.filter((c) => c[0] === 'strokeText').length, 2, 'e contornada');
  assert.ok(duas[1][3] > duas[0][3], 'a 2ª linha fica abaixo da 1ª');
  chamadas.length = 0;
  MemorialArquivo.desenharTextosDaPlanta(ctx, 10, 0, 0, 100, 100, [T({ x: 'abc', y: null, tamanho: 'zz', cor: 'vermelho' }), null, 5]);
  assert.strictEqual(chamadas.filter((c) => c[0] === 'fillText').length, 1, 'texto com número ruim usa o padrão; lixo na lista é ignorado');
  assert.ok(!chamadas.some((c) => /NaN/.test(JSON.stringify(c))), 'nada de NaN no desenho');
  chamadas.length = 0; global.window.PlantaTextos = undefined;
  MemorialArquivo.desenharTextosDaPlanta(ctx, 10, 0, 0, 100, 100, [T()]); assert.strictEqual(chamadas.length, 0, 'sem o módulo: não desenha nada e não quebra');
  global.window.PlantaTextos = require(js('planta-textos.js'));
  ok('celular (canvas): posição e tamanho pela largura da imagem, negrito, fundo antes da letra, contorno, entradas ruins');
}

// ---------- 3. ligação na página (hub.js) e no gerador do celular ----------
{
  const hub = fs.readFileSync(js('hub.js'), 'utf8');
  assert.ok(/modos: m\.modos \|\| \{\}, plantas: m\.plantas \|\| \{\}/.test(hub), 'hub.js passa modos e plantas para os dois geradores de PDF');
  const arq = fs.readFileSync(js('memorial-arquivo.js'), 'utf8');
  assert.ok(arq.includes("t: 'seg'") && arq.includes('entradasDoItem') && arq.includes('imgs.clear()'), 'celular: cada setor é um bloco (faixa + moldura), uma entrada por foto, e as fotos de cada folha são soltas depois de desenhar');
  assert.ok(arq.includes('falhasPlantas') && arq.includes('Não consegui carregar a imagem desta planta'), 'celular: planta que não baixa vira caixa com aviso (não derruba o PDF)');
  assert.ok(arq.includes('const dPino = tamPino * dw') && arq.includes('Number(b.planta.tamanhoMarcas) > 0') && !arq.includes('3.5 * S, 0, Math.PI * 2'), 'celular: o círculo tem diâmetro = fração da largura da planta (não mais 7 mm fixos)');
  assert.ok(arq.includes("fundo: '#eef1f4'") && arq.includes("cor: '#2b3340'") && !arq.includes("pc.retangulo(MARG, b.y0, w0, hBanda, '#1c1c1c')"), 'celular: faixa do setor suave');
  assert.ok(!arq.includes("t: 'planta'") && !arq.includes("'frag'"), 'sem os blocos antigos (planta em folha própria, fragmento de tabela)');
  ok('ligações: hub passa modos/plantas; celular solta as fotos folha por folha e avisa das que falharam');
}
console.log('\nTODOS OS TESTES DO PDF DO MEMORIAL (CLIENTE) PASSARAM');
