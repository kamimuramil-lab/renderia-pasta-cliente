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

console.log('== 3. Orçamentos: categorias padrão do Notion, uma vez só ==');
assert.deepStrictEqual(o.categorias.map((c) => c.nome), orc.ITENS_PADRAO);
assert.strictEqual(o.categorias.length, 13);
assert.ok(orc.ITENS_PADRAO.includes('Boxes de Vidro, Envidraçamento de Sacada e Espelhos') && orc.ITENS_PADRAO.includes('Marmoraria'));
o = orc.lerParaArquiteto(CAM, 'p1', DONO);
assert.strictEqual(o.categorias.length, 14, 'ler de novo não repete as 13 (14 = 13 + a categoria "Teste" que o app antigo criou)');
assert.ok(o.itens.every((i) => i.categoriaId && o.categorias.some((c) => c.id === i.categoriaId)), 'todo orçamento está numa categoria');
// excluir todas as categorias NÃO recria
o.categorias.forEach((c) => orc.excluirCategoria(CAM, 'p1', c.id, DONO));
assert.strictEqual(orc.lerParaArquiteto(CAM, 'p1', DONO).categorias.length, 0, 'quem apagou não ganha as categorias de volta');
assert.strictEqual(orc.lerParaArquiteto(CAM, 'p1', DONO).itens.length, 0, 'e os orçamentos dentro delas foram junto');
// projeto novo com orçamentos criados logo de cara: cada um cai na categoria padrão do mesmo nome (sem acento nem maiúscula), sem repetir
novaGaleria('p2');
orc.adicionarItem(CAM, 'p2', { item: 'MARMORARIA ', valor: 5000, status: 'evf' }, DONO);
const p2 = orc.lerParaArquiteto(CAM, 'p2', DONO);
assert.strictEqual(p2.categorias.filter((c) => /marmoraria/i.test(c.nome)).length, 1, 'Marmoraria não foi duplicada');
assert.strictEqual(p2.itens.find((i) => /marmoraria/i.test(i.item)).valor, 5000, 'o orçamento não foi mexido');
// só o dono
assert.throws(() => orc.lerParaArquiteto(CAM, 'p2', 'outro'), /não pertence/);
ok('13 categorias na primeira abertura, só uma vez, não recria depois de apagar; sem repetir categoria do mesmo nome');

console.log('== 4. O cliente só vê o que foi começado; pode aprovar também no EVF ==');
novaGaleria('p3');
const link = orc.definirAcesso(CAM, 'p3', { usuario: 'orc', senha: 'abcd1234' }, DONO).linkToken;
const todos = orc.lerParaArquiteto(CAM, 'p3', DONO).itens;
assert.strictEqual(orc.listarParaCliente(CAM, link).itens.length, 0, 'sem orçamento liberado, o cliente não vê nada');
assert.strictEqual(orc.listarParaCliente(CAM, link).categorias.length, 0, 'nem as 13 categorias vazias');
const catMarm = orc.lerParaArquiteto(CAM, 'p3', DONO).categorias.find((c) => c.nome === 'Marmoraria');
const marmoraria = orc.adicionarItem(CAM, 'p3', { item: 'Marmoraria', categoriaId: catMarm.id }, DONO); // começa de enfeite (À fazer, vazio)
assert.strictEqual(orc.listarParaCliente(CAM, link).itens.length, 0, 'orçamento de enfeite não aparece pro cliente');
orc.editarItem(CAM, 'p3', marmoraria.id, { valor: '27.252,00', empresa: 'Marmoraria X', status: 'evf' }, DONO);
const vistos = orc.listarParaCliente(CAM, link).itens;
assert.deepStrictEqual(vistos.map((i) => [i.item, i.valor, i.podeMudarStatus]), [['Marmoraria', 27252, true]], 'só o preenchido aparece, e o cliente pode decidir (EVF)');
orc.mudarStatusCliente(CAM, link, marmoraria.id, 'fechado');
assert.strictEqual(orc.lerParaArquiteto(CAM, 'p3', DONO).itens.find((i) => i.id === marmoraria.id).status, 'fechado');
assert.ok(orc.lerParaArquiteto(CAM, 'p3', DONO).notificacoes.some((n) => n.tipo === 'status' && n.para === 'fechado'), 'o arquiteto recebe a novidade');
orc.mudarStatusCliente(CAM, link, marmoraria.id, 'analise_cliente'); // "Alterar decisão"
// item À fazer com observação passa a aparecer, mas o cliente ainda não decide nele
const catCort = orc.lerParaArquiteto(CAM, 'p3', DONO).categorias.find((c) => c.nome === 'Cortinas e Persianas');
const cortinas = orc.adicionarItem(CAM, 'p3', { item: 'Cortinas e Persianas', categoriaId: catCort.id }, DONO);
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

console.log('== 7. Comentários: o arquiteto edita os SEUS e apaga qualquer um ==');
novaGaleria('p6');
const link6 = orc.definirAcesso(CAM, 'p6', { usuario: 'orc', senha: 'abcd1234' }, DONO).linkToken;
const alvo = orc.adicionarItem(CAM, 'p6', { item: 'Ar Condicionado', categoriaId: orc.lerParaArquiteto(CAM, 'p6', DONO).categorias[0].id }, DONO);
const cCli = orc.comentarCliente(CAM, link6, alvo.id, 'Pode melhorar o prazo?');
const cArq = orc.comentarComoArquiteto(CAM, 'p6', alvo.id, 'Vou ver com o fornecedor.', DONO);
const ed = orc.editarComentarioDoArquiteto(CAM, 'p6', alvo.id, cArq.id, '  Consegui reduzir o prazo.  ', DONO);
assert.deepStrictEqual([ed.texto, !!ed.editadoEm], ['Consegui reduzir o prazo.', true]);
assert.throws(() => orc.editarComentarioDoArquiteto(CAM, 'p6', alvo.id, cCli.id, 'x', DONO), /Só dá para editar as mensagens que você enviou/);
assert.throws(() => orc.editarComentarioDoArquiteto(CAM, 'p6', alvo.id, cArq.id, '   ', DONO), /./, 'texto vazio é recusado');
assert.throws(() => orc.editarComentarioDoArquiteto(CAM, 'p6', alvo.id, 'com_x', 'x', DONO), /não encontrado/);
assert.throws(() => orc.editarComentarioDoArquiteto(CAM, 'p6', alvo.id, cArq.id, 'x', 'outro'), /não pertence/);
assert.strictEqual(orc.listarParaCliente(CAM, link6).itens[0].comentarios.find((c) => c.id === cArq.id).texto, 'Consegui reduzir o prazo.', 'o cliente vê a mensagem editada');
orc.excluirComentarioDoArquiteto(CAM, 'p6', alvo.id, cCli.id, DONO); // apaga a do CLIENTE
orc.excluirComentarioDoArquiteto(CAM, 'p6', alvo.id, cArq.id, DONO); // e a própria
assert.strictEqual(orc.lerParaArquiteto(CAM, 'p6', DONO).itens[0].comentarios.length, 0);
assert.throws(() => orc.excluirComentarioDoArquiteto(CAM, 'p6', alvo.id, cArq.id, DONO), /não encontrado/);
assert.throws(() => orc.excluirComentarioDoArquiteto(CAM, 'p6', alvo.id, 'x', 'outro'), /não pertence/);
ok('edita só os próprios; apaga os do cliente e os próprios; o cliente vê a edição; outra conta barrada');

fs.rmSync(TMP, { recursive: true, force: true });
console.log('\nTODOS OS TESTES DOS AJUSTES (VALOR, PADRÕES, SETORES) PASSARAM');
