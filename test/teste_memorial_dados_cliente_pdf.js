// PDFs do memorial gerados na página do cliente: nome, e-mail e endereço do cliente aparecem no título de CADA setor (sem rótulos, sem telefone).
// Documento de impressão (memorial-doc.js): regras de HTML aqui. Canvas do celular (memorial-arquivo.js): ligações no código (o desenho em si
// foi conferido num navegador real).
const assert = require('assert'); const path = require('path'); const fs = require('fs');
const js = (n) => path.join(__dirname, '..', 'public', 'assets', 'js', n);
global.window = {};
global.window.PlantaTextos = require(js('planta-textos.js'));
require(js('memorial-doc.js')); const MemorialDoc = global.window.MemorialDoc;
const ok = (m) => console.log('OK ', m);

const itens = [
  { id: 'a', setor: 'Louças', numero: 1, item: 'Cuba', ambientes: [], empresa: '', especificacoes: '', dimensoes: '', quantidade: '1', fotoUrl: null, fotosExtras: [] },
  { id: 'b', setor: 'Móveis', numero: 1, item: 'Mesa', ambientes: [], empresa: '', especificacoes: '', dimensoes: '', quantidade: '1', fotoUrl: null, fotosExtras: [] }
];
const base = { nomeProjeto: 'Apto', itens, setores: ['Louças', 'Móveis'], setor: '', agora: new Date(2026, 11, 3) };
const cliente = { nome: 'Maria <b>Souza</b>', email: 'maria@exemplo.com', endereco: 'Rua das Flores, 120 - SP', telefone: '(11) 91234-5678' };

// lista: faixa dividida em 4 + 4 colunas, uma célula de dados em CADA setor
let html = MemorialDoc.montarHtml({ ...base, cliente }).html;
assert.strictEqual((html.match(/<th colspan="4" class="dados-cliente">/g) || []).length, 2, 'uma célula de dados em cada setor');
assert.ok(/<th colspan="4">Louças<span>1 item<\/span><\/th>/.test(html), 'nome do setor à esquerda');
const cel = html.match(/class="dados-cliente">([\s\S]*?)<\/th>/)[1];
assert.ok(cel.includes('<span class="dc-nome">Maria &lt;b&gt;Souza&lt;/b&gt;</span>') && cel.includes('<span>maria@exemplo.com</span>') && cel.includes('<span>Rua das Flores, 120 - SP</span>'), 'nome, e-mail e endereço escapados');
assert.ok(!/91234|Tel|Cliente:|E-mail:|Endere/.test(cel), 'sem telefone e sem rótulos');
assert.strictEqual((cel.match(/<div>/g) || []).length, 2, 'duas linhas: nome · e-mail, e o endereço');
ok('lista: nome, e-mail e endereço no título de cada setor');

// cards: faixa dividida em 1 + 1
html = MemorialDoc.montarHtml({ ...base, cliente, modos: { 'Louças': 'cards' } }).html;
assert.ok(/<th colspan="1" class="dados-cliente">/.test(html), 'cards: duas células na faixa');
ok('cards: dados do cliente na faixa');

// sem cliente, ou só com telefone: faixa de sempre
for (const c of [undefined, {}, { nome: '', email: ' ', endereco: '' }, { telefone: '11 99999-0000' }]) {
  html = MemorialDoc.montarHtml({ ...base, cliente: c }).html;
  assert.ok(!html.includes('<th colspan="4" class="dados-cliente">') && /<th colspan="8">Louças/.test(html), 'sem dados: faixa inteira só com o setor ' + JSON.stringify(c));
}
ok('sem dados do cliente a faixa fica como era');

// só o nome
html = MemorialDoc.montarHtml({ ...base, cliente: { nome: 'Ana' } }).html;
assert.strictEqual(html.match(/class="dados-cliente">([\s\S]*?)<\/th>/)[1], '<div><span class="dc-nome">Ana</span></div>');
ok('só os dados que existem aparecem');

// canvas do celular e página: ligações
const arq = fs.readFileSync(js('memorial-arquivo.js'), 'utf8');
assert.ok(/desenharDadosDoCliente\(pc, o\.cliente, xDir, cyB/.test(arq), 'o celular desenha os dados na faixa de cada setor (a faixa repete em toda folha)');
assert.ok(/temDadosDoCliente\(o\.cliente\) \? 11\.8 : 0/.test(arq), 'a faixa ganha altura quando há dados');
assert.ok(!/\bTel\.?:|telefone/i.test(arq.slice(arq.indexOf('dados do cliente no título do setor'), arq.indexOf('// ---------- gerar'))), 'o celular não desenha telefone');
const hub = fs.readFileSync(js('hub.js'), 'utf8');
assert.ok(/window\.DadosProjeto\.interpretar\(hubDe\(galeriaAtual\)\.dadosProjeto\)/.test(hub) && /escritorio, cliente \}/.test(hub), 'a página passa o cliente aos dois geradores');
ok('celular e página ligados');

console.log('\nTudo certo: dados do cliente nos PDFs do memorial do cliente.');
