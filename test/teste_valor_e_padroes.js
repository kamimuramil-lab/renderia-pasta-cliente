// Ajustes de 20/11/2026: valor digitado do jeito brasileiro (27.252,00), orçamentos que já vêm com os itens padrão do Notion
// (e o cliente só vê o que o arquiteto começou a preencher), cliente podendo APROVAR/RECUSAR também nos orçamentos "EVF", e
// setores do Memorial que o arquiteto cria, renomeia e exclui. Camada de dados pura (sem servidor).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const galeria = require('../lib/galeria');
const orc = require('../lib/orcamentos');
const mem = require('../lib/memorial');
const { lerValorBR } = require('../lib/valor-br');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-padroes-'));
const CAM = path.join(TMP, 'dados-galerias.json');
const ok = (m) => console.log('OK  ' + m);
const DONO = 'arqA';
const novaGaleria = (id) => galeria.criarOuAtualizarGaleria(CAM, { projetoId: id, licencaUsuario: DONO, nomeProjeto: 'Proj ' + id, clienteUsuario: 'cli', clienteSenha: 'senha1234' });

console.log('== 1. Valor do jeito brasileiro ==');
[['27.252,00', 27252], ['27252,00', 27252], ['27252.00', 27252], ['27252', 27252], ['R$ 27.252,50', 27252.5], ['1.234.567,89', 1234567.89],
  ['1,234.50', 1234.5], ['12,5', 12.5], ['12.5', 12.5], ['27.252', 27252], ['1.234', 1234], ['0,99', 0.99], [27252.5, 27252.5], ['  3.000,00  ', 3000]]
  .forEach(([entrada, esperado]) => assert.strictEqual(lerValorBR(entrada), esperado, `"${entrada}" deveria ser ${esperado}`));
[[undefined, null], [null, null], ['', null], ['   ', null]].forEach(([e, v]) => assert.strictEqual(lerValorBR(e), v));
['abc', '12a', '1.2.3', '--5', '1e5', {}].forEach((ruim) => assert.throws(() => lerValorBR(ruim), /inválido/i, 'deveria recusar ' + JSON.stringify(ruim)));
ok('27.252,00 / 27252,00 / R$ / milhar / decimal com ponto; vazio vira null; lixo é recusado');

console.log('== 2. Orçamentos: valor BR no item e o erro antigo some ==');
novaGaleria('p1');
let o = orc.lerParaArquiteto(CAM, 'p1', DONO);
const item = orc.adicionarItem(CAM, 'p1', { item: 'Teste', valor: '27.252,00' }, DONO);
assert.strictEqual(item.valor, 27252);
assert.strictEqual(orc.editarItem(CAM, 'p1', item.id, { valor: '27252,00' }, DONO).valor, 27252);
assert.strictEqual(orc.editarItem(CAM, 'p1', item.id, { valor: '1.234,5' }, DONO).valor, 1234.5);
assert.throws(() => orc.adicionarItem(CAM, 'p1', { item: 'x', valor: 'abc' }, DONO), /Valor inválido/);
assert.throws(() => orc.adicionarItem(CAM, 'p1', { item: 'x', valor: '-5' }, DONO), /inválido/);
assert.throws(() => orc.adicionarItem(CAM, 'p1', { item: 'x', valor: '2.000.000.000' }, DONO), /entre 0 e/);
ok('27.252,00 é aceito (era o erro do Rodrigo); lixo e valor gigante continuam recusados');

console.log('== 3. Orçamentos: itens padrão do Notion, uma vez só ==');
assert.deepStrictEqual(o.itens.map((i) => i.item), orc.ITENS_PADRAO);
assert.strictEqual(o.itens.length, 13);
assert.ok(o.itens.every((i) => i.status === 'a_fazer' && i.valor === null && i.comentarios.length === 0));
assert.ok(orc.ITENS_PADRAO.includes('Boxes de Vidro, Envidraçamento de Sacada e Espelhos') && orc.ITENS_PADRAO.includes('Marmoraria'));
o = orc.lerParaArquiteto(CAM, 'p1', DONO);
assert.strictEqual(o.itens.length, 14, 'ler de novo não repete os 13 (14 = 13 + o "Teste" que adicionei)');
// excluir todos NÃO recria
o.itens.forEach((i) => orc.excluirItem(CAM, 'p1', i.id, DONO));
assert.strictEqual(orc.lerParaArquiteto(CAM, 'p1', DONO).itens.length, 0, 'quem apagou não ganha os itens de volta');
// projeto que já tinha orçamentos (ex.: importado) não é mexido
novaGaleria('p2');
orc.adicionarItem(CAM, 'p2', { item: 'Mármore antigo', valor: 100 }, DONO);
assert.deepStrictEqual(orc.lerParaArquiteto(CAM, 'p2', DONO).itens.map((i) => i.item), ['Mármore antigo']);
// só o dono
assert.throws(() => orc.lerParaArquiteto(CAM, 'p2', 'outro'), /não pertence/);
ok('13 itens na primeira abertura, só uma vez, não recria depois de apagar, não mexe em projeto que já tem orçamento');

console.log('== 4. O cliente só vê o que foi começado; pode aprovar também no EVF ==');
novaGaleria('p3');
const link = orc.definirAcesso(CAM, 'p3', { usuario: 'orc', senha: 'abcd1234' }, DONO).linkToken;
const todos = orc.lerParaArquiteto(CAM, 'p3', DONO).itens;
assert.strictEqual(orc.listarParaCliente(CAM, link).itens.length, 0, 'os 13 de enfeite não aparecem pro cliente');
const marmoraria = todos.find((i) => i.item === 'Marmoraria');
orc.editarItem(CAM, 'p3', marmoraria.id, { valor: '27.252,00', empresa: 'Marmoraria X', status: 'evf' }, DONO);
const vistos = orc.listarParaCliente(CAM, link).itens;
assert.deepStrictEqual(vistos.map((i) => [i.item, i.valor, i.podeMudarStatus]), [['Marmoraria', 27252, true]], 'só o preenchido aparece, e o cliente pode decidir (EVF)');
orc.mudarStatusCliente(CAM, link, marmoraria.id, 'fechado');
assert.strictEqual(orc.lerParaArquiteto(CAM, 'p3', DONO).itens.find((i) => i.id === marmoraria.id).status, 'fechado');
assert.ok(orc.lerParaArquiteto(CAM, 'p3', DONO).notificacoes.some((n) => n.tipo === 'status' && n.para === 'fechado'), 'o arquiteto recebe a novidade');
orc.mudarStatusCliente(CAM, link, marmoraria.id, 'analise_cliente'); // "Alterar decisão"
// item À fazer com observação passa a aparecer, mas o cliente ainda não decide nele
const cortinas = todos.find((i) => i.item === 'Cortinas e Persianas');
orc.editarItem(CAM, 'p3', cortinas.id, { observacao: 'Aguardando medição' }, DONO);
const v2 = orc.listarParaCliente(CAM, link).itens.find((i) => i.item === 'Cortinas e Persianas');
assert.deepStrictEqual([v2.status, v2.podeMudarStatus], ['a_fazer', false]);
assert.throws(() => orc.mudarStatusCliente(CAM, link, cortinas.id, 'fechado'), /ainda está sendo preparado/);
ok('enfeite escondido; ao preencher aparece; cliente aprova/recusa/reabre no EVF; "À fazer" continua só leitura');

console.log('== 5. Memorial: setores do projeto (criar, renomear, excluir) ==');
novaGaleria('p4');
let m = mem.lerParaArquiteto(CAM, 'p4', DONO);
assert.deepStrictEqual(m.setores, mem.SETORES, 'começa com os 12 padrão');
assert.deepStrictEqual(mem.adicionarSetor(CAM, 'p4', 'Paisagismo', DONO).slice(-2), ['Tecidos e Papeis', 'Paisagismo']);
assert.throws(() => mem.adicionarSetor(CAM, 'p4', '  paisagismo ', DONO), /Já existe/);
assert.throws(() => mem.adicionarSetor(CAM, 'p4', 'METAIS', DONO), /Já existe/);
assert.throws(() => mem.adicionarSetor(CAM, 'p4', '   ', DONO), /nome/i);
const a = mem.adicionarItem(CAM, 'p4', { setor: 'Paisagismo', item: 'Vaso grande' }, DONO);
assert.strictEqual(a.numero, 1);
assert.throws(() => mem.adicionarItem(CAM, 'p4', { setor: 'Setor Que Nao Existe', item: 'x' }, DONO), /Setor inválido/);
mem.renomearSetor(CAM, 'p4', 'Paisagismo', 'Jardim e Vasos', DONO);
m = mem.lerParaArquiteto(CAM, 'p4', DONO);
assert.ok(m.setores.includes('Jardim e Vasos') && !m.setores.includes('Paisagismo'));
assert.strictEqual(m.itens.find((i) => i.id === a.id).setor, 'Jardim e Vasos', 'o item acompanha o novo nome');
assert.throws(() => mem.renomearSetor(CAM, 'p4', 'Jardim e Vasos', 'Louças', DONO), /Já existe/);
assert.throws(() => mem.renomearSetor(CAM, 'p4', 'Nao Existe', 'X', DONO), /não encontrado/);
assert.throws(() => mem.excluirSetor(CAM, 'p4', 'Jardim e Vasos', DONO), /tem 1 item/);
mem.excluirSetor(CAM, 'p4', 'Portas', DONO); // vazio: pode
assert.ok(!mem.lerParaArquiteto(CAM, 'p4', DONO).setores.includes('Portas'));
assert.throws(() => mem.adicionarItem(CAM, 'p4', { setor: 'Portas', item: 'x' }, DONO), /Setor inválido/, 'setor excluído não aceita mais itens');
mem.excluirItem(CAM, 'p4', a.id, DONO);
mem.excluirSetor(CAM, 'p4', 'Jardim e Vasos', DONO);
// outro projeto continua com os 12 padrão (a lista é POR projeto)
novaGaleria('p5');
assert.deepStrictEqual(mem.lerParaArquiteto(CAM, 'p5', DONO).setores, mem.SETORES);
assert.throws(() => mem.adicionarSetor(CAM, 'p5', 'X', 'outro'), /não pertence/);
// valor BR também no memorial
assert.strictEqual(mem.adicionarItem(CAM, 'p5', { setor: 'Metais', item: 'Torneira', valor: '1.349,90' }, DONO).valor, 1349.9);
assert.strictEqual(mem.adicionarItem(CAM, 'p5', { setor: 'Metais', item: 'Torneira 2', valor: '1234.5' }, DONO).valor, 1234.5, 'antes "1234.5" virava 12345');
ok('criar/renomear (itens acompanham)/excluir só vazio; duplicado e inválido recusados; lista por projeto; valor BR');

console.log('== 6. O cliente recebe os setores do projeto, na ordem dele ==');
mem.adicionarSetor(CAM, 'p5', 'Paisagismo', DONO);
mem.adicionarItem(CAM, 'p5', { setor: 'Paisagismo', item: 'Vaso' }, DONO);
const g5 = galeria.buscarGaleriaPorProjeto(CAM, 'p5');
const paraCli = mem.paraCliente(g5);
assert.ok(paraCli.setores.includes('Paisagismo'));
assert.deepStrictEqual(paraCli.itens.map((i) => i.setor), ['Metais', 'Metais', 'Paisagismo']);
assert.ok(!JSON.stringify(paraCli).includes('"valor"'), 'sem valor pro cliente');
ok('setor novo chega ao cliente e a ordem segue a lista do projeto');

fs.rmSync(TMP, { recursive: true, force: true });
console.log('\nTODOS OS TESTES DOS AJUSTES (VALOR, PADRÕES, SETORES) PASSARAM');
