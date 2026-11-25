// Etapa 4 do memorial: os PDFs que o CLIENTE gera na página (documento de impressão `memorial-doc.js` e desenho em canvas `memorial-arquivo.js`)
// mostram o modo CARDS do setor, as fotos extras de cada item e as PLANTAS com os círculos numerados.
// O visual foi conferido no Electron real (impressão) e num navegador real (canvas); aqui ficam as regras que não dependem de tela.
const assert = require('assert'); const path = require('path'); const fs = require('fs');
const js = (n) => path.join(__dirname, '..', 'public', 'assets', 'js', n);
global.window = {};
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
  assert.ok(!r.html.includes('class="card"') && !r.html.includes('class="planta-pagina"'), 'sem modos nem plantas: lista como sempre, sem card nem planta');
  assert.strictEqual(contar(r.html, /<table>/g), 2, 'sem modos: duas tabelas de lista');
  assert.ok(r.html.includes('class="foto-extras"') && contar(r.html, /class="foto-extras"><img/g) === 2 && r.html.includes('https://f/a2.webp') && r.html.includes('https://f/a3.webp'), 'lista: miniaturas das fotos extras embaixo da capa (item sem extra não ganha a faixa)');
  ok('sem modos/plantas: lista igual à de antes + miniaturas das fotos extras');

  r = MemorialDoc.montarHtml({ ...base, modos: { 'Móveis': 'cards' } });
  assert.strictEqual(contar(r.html, /<table>/g), 1, 'só Louças fica em lista');
  assert.strictEqual(contar(r.html, /<table class="cards">/g), 1, 'Móveis em cards');
  assert.strictEqual(contar(r.html, /<div class="card">/g), 3, 'um card por item');
  assert.strictEqual(contar(r.html, /<td class="card-td">/g), 4, '2 cards por linha: 3 itens = 2 linhas e uma célula vazia no fim');
  assert.ok(r.html.includes('class="card-extras"><img src="https://f/b2.webp"'), 'card: faixa das fotos extras');
  assert.ok(!r.html.includes('javascript:') && contar(r.html, /Ver produto ↗/g) === 1, 'link inseguro (javascript:) nunca vira link; o item com link http continua na lista');
  assert.ok(r.html.includes('sem foto'), 'card sem foto diz "sem foto"');
  assert.ok(!/<div class="card-info"><\/div>/.test(r.html), 'card sem dados não desenha a caixa de dados vazia');
  assert.ok(r.html.includes('<span class="num-card">1</span><span>Poltrona</span>'), 'card: círculo com o Nº e o nome do item');
  ok('modo Cards por setor: 2 por linha, extras, sem link inseguro, setores misturados (lista + cards) no mesmo PDF');

  r = MemorialDoc.montarHtml({ ...base, plantas });
  assert.strictEqual(contar(r.html, /class="planta-pagina"/g), 2, 'uma folha por planta com imagem (a planta sem endereço é pulada)');
  assert.strictEqual(contar(r.html, /class="pino"/g), 2, 'um círculo por marca');
  assert.ok(r.html.includes('left:25.000%; top:50.000%;') && r.html.includes('left:100.000%; top:0.000%;'), 'posição em % da imagem; fora do intervalo é limitada a 0..1');
  assert.ok(r.html.includes('>1</span>') && r.html.includes('Banheiros &lt;1&gt;') && !r.html.includes('Banheiros <1>'), 'nome da planta escapado; número do item no círculo');
  const iLista = r.html.indexOf('<h2>Louças'), iPlanta = r.html.indexOf('Louças — Banheiros'), iMoveis = r.html.indexOf('<h2>Móveis');
  assert.ok(iLista > 0 && iLista < iPlanta && iPlanta < iMoveis, 'a planta do setor vem DEPOIS da lista dele e ANTES do setor seguinte');
  assert.ok(r.html.includes('.planta-pagina + .setor') && r.html.includes('.setor h2 { break-after: avoid'), 'o setor seguinte começa em folha nova e o título não fica sozinho no pé da folha');
  ok('plantas: uma folha por planta depois da lista, círculos em %, escape, ordem certa');

  r = MemorialDoc.montarHtml({ ...base, plantas, modos: { 'Louças': 'cards' }, setor: 'Móveis' });
  assert.ok(!r.html.includes('Louças') && contar(r.html, /class="planta-pagina"/g) === 1 && r.html.includes('Móveis — Sala'), 'filtro por setor: só as plantas daquele setor');
  assert.ok(!MemorialDoc.montarHtml({ ...base, plantas: { 'Louças': [{ nome: 'x', url: 'https://f/p.webp', marcas: [{ numero: 1, x: 'abc', y: null }] }] } }).html.includes('NaN'), 'marca com posição inválida não gera NaN');
  ok('filtro por setor e posição inválida');
}

// ---------- 2. desenho em canvas (memorial-arquivo.js): medida dos cards, sem tela ----------
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
  assert.ok(curto.h > 80 + 15 && curto.h < 170, 'card normal: imagem (80) + faixa de extras (15) + dados, dentro da folha');
  assert.strictEqual(curto.info.filter((l) => l.rot).length, 4, 'os 4 campos preenchidos viram linhas, cada uma com o rótulo na primeira');
  assert.strictEqual(curto.extras.length, 1);
  const semExtra = MemorialArquivo.medirCard(pc, { ...item, fotosExtras: [] }, 134.5, 170);
  assert.ok(Math.abs((curto.h - semExtra.h) - 16.5) < 1e-9, 'a faixa das fotos extras soma 16,5 mm (1,5 + 15)');
  const gigante = MemorialArquivo.medirCard(pc, { ...item, especificacoes: Array.from({ length: 400 }, (_, k) => 'palavra' + k).join(' ') }, 134.5, 170);
  assert.ok(gigante.h <= 170, 'texto enorme: o card nunca passa de uma folha (' + gigante.h.toFixed(1) + ' mm)');
  assert.ok(gigante.info.length > 0 && gigante.info[gigante.info.length - 1].t.endsWith('…'), 'o texto cortado termina em "…"');
  const vazio = MemorialArquivo.medirCard(pc, { id: 'v', numero: 1, item: 'Só nome', ambientes: [], fotosExtras: [] }, 134.5, 170);
  assert.ok(vazio.info.length === 0 && !vazio.amb && !vazio.href && vazio.h < curto.h, 'item só com nome: card curto, sem caixas vazias');
  ok('canvas: altura do card (extras, texto enorme corta com "…", item vazio)');
}

// ---------- 3. ligação na página (hub.js) e no gerador do celular ----------
{
  const hub = fs.readFileSync(js('hub.js'), 'utf8');
  assert.ok(/modos: m\.modos \|\| \{\}, plantas: m\.plantas \|\| \{\}/.test(hub), 'hub.js passa modos e plantas para os dois geradores de PDF');
  const arq = fs.readFileSync(js('memorial-arquivo.js'), 'utf8');
  assert.ok(arq.includes("t: 'planta'") && arq.includes("t: 'cards'") && arq.includes('imgs.clear()'), 'celular: folhas de planta e de cards, e as fotos de cada folha são soltas depois de desenhar');
  assert.ok(arq.includes('falhasPlantas') && arq.includes('a folha ficou sem a imagem'), 'celular: planta que não baixa vira folha com aviso (não derruba o PDF)');
  ok('ligações: hub passa modos/plantas; celular solta as fotos folha por folha e avisa das que falharam');
}
console.log('\nTODOS OS TESTES DO PDF DO MEMORIAL (CLIENTE) PASSARAM');
