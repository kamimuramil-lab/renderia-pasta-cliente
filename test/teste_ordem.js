// Ordem manual (setinhas ▲▼): orçamentos, documentos e categorias do executivo, com posse conferida.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const galeria = require('../lib/galeria');
const hub = require('../lib/hub');
const orc = require('../lib/orcamentos');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-ordem-'));
const CAMINHO = path.join(TMP, 'dados-galerias.json');
const DONO = 'arq@teste.com';
const INTRUSO = 'outro@teste.com';
const URL1 = 'https://drive.google.com/file/d/AAA/view';

galeria.criarOuAtualizarGaleria(CAMINHO, { projetoId: 'projO', licencaUsuario: DONO, nomeProjeto: 'Apto', clienteUsuario: 'cliente', clienteSenha: 'senha1234' });

console.log('== 1. Orçamentos: reordenar, intruso barrado, id estranho e item novo não some ==');
const nomes = () => orc.lerParaArquiteto(CAMINHO, 'projO', DONO).itens.map((i) => i.item);
const catsIni = orc.lerParaArquiteto(CAMINHO, 'projO', DONO).categorias;
assert.strictEqual(catsIni.length, 13, 'as 13 categorias padrão');
catsIni.forEach((c) => orc.adicionarItem(CAMINHO, 'projO', { item: 'Orçamento de ' + c.nome, categoriaId: c.id }, DONO)); // 1 orçamento (de enfeite) em cada
const antes = orc.lerParaArquiteto(CAMINHO, 'projO', DONO).itens;
assert.strictEqual(antes.length, 13, '13 orçamentos');
const ids = antes.map((i) => i.id);
const invertida = [...ids].reverse();
orc.reordenarItens(CAMINHO, 'projO', invertida, DONO);
assert.deepStrictEqual(orc.lerParaArquiteto(CAMINHO, 'projO', DONO).itens.map((i) => i.id), invertida);
assert.throws(() => orc.reordenarItens(CAMINHO, 'projO', ids, INTRUSO), /não pertence/);
assert.deepStrictEqual(orc.lerParaArquiteto(CAMINHO, 'projO', DONO).itens.map((i) => i.id), invertida, 'intruso não mexeu');
assert.throws(() => orc.reordenarItens(CAMINHO, 'projO', 'abc', DONO), /inválida/);
// lista parcial/com id desconhecido/repetido: o resto fica no fim, na ordem de antes, e nada some nem duplica
orc.reordenarItens(CAMINHO, 'projO', [ids[2], 'orc_que_nao_existe', ids[2], ids[0]], DONO);
const depois = orc.lerParaArquiteto(CAMINHO, 'projO', DONO).itens.map((i) => i.id);
assert.deepStrictEqual(depois.slice(0, 2), [ids[2], ids[0]]);
assert.strictEqual(depois.length, 13);
assert.strictEqual(new Set(depois).size, 13);
// o cliente enxerga na mesma ordem (itens preenchidos)
const a = orc.adicionarItem(CAMINHO, 'projO', { item: 'Piso', valor: '1.000,00', status: 'analise_cliente' }, DONO);
const b = orc.adicionarItem(CAMINHO, 'projO', { item: 'Teto', valor: '2.000,00', status: 'analise_cliente' }, DONO);
orc.definirAcesso(CAMINHO, 'projO', { usuario: 'orc', senha: 'abcd1234' }, DONO);
const link = orc.lerParaArquiteto(CAMINHO, 'projO', DONO).acesso.linkToken;
assert.deepStrictEqual(orc.listarParaCliente(CAMINHO, link).itens.map((i) => i.item), ['Piso', 'Teto']);
orc.reordenarItens(CAMINHO, 'projO', [b.id, a.id], DONO);
assert.deepStrictEqual(orc.listarParaCliente(CAMINHO, link).itens.map((i) => i.item), ['Teto', 'Piso']);
console.log('OK');

console.log('== 2. Documentos: ordem manual, id desconhecido recusa tudo, intruso barrado ==');
const d1 = hub.adicionarDocumento(CAMINHO, 'projO', { secao: 'executivo', grupo: 'Planta de Forro', titulo: 'Forro A', url: URL1 }, DONO).documento;
const d2 = hub.adicionarDocumento(CAMINHO, 'projO', { secao: 'executivo', grupo: 'Planta de Forro', titulo: 'Forro B', url: URL1 }, DONO).documento;
const d3 = hub.adicionarDocumento(CAMINHO, 'projO', { secao: 'executivo', grupo: 'Planta de Forro', titulo: 'Forro C', url: URL1 }, DONO).documento;
const lerDocs = () => galeria.buscarGaleriaPorProjeto(CAMINHO, 'projO').hub.documentos;
hub.ordenarDocumentos(CAMINHO, 'projO', [d3.id, d1.id, d2.id], DONO);
assert.deepStrictEqual(lerDocs().map((d) => [d.titulo, d.ordem]), [['Forro A', 1], ['Forro B', 2], ['Forro C', 0]]);
assert.throws(() => hub.ordenarDocumentos(CAMINHO, 'projO', [d1.id, 'doc_x'], DONO), /não encontrado/);
assert.strictEqual(lerDocs().find((d) => d.id === d1.id).ordem, 1, 'id estranho não gravou nada pela metade');
assert.throws(() => hub.ordenarDocumentos(CAMINHO, 'projO', [d1.id], INTRUSO), /não pertence/);
assert.throws(() => hub.ordenarDocumentos(CAMINHO, 'projO', 'x', DONO), /inválida/);
console.log('OK');

console.log('== 3. Ordem das categorias do executivo (sem mexer na lista de opções do formulário) ==');
let h = hub.atualizarHub(CAMINHO, 'projO', { ordemGrupos: ['Planta de Forro + Iluminação e Circuitos', ' planta de forro ', 'Demolição e Construção', '', 'Demolição e Construção'] }, DONO);
assert.deepStrictEqual(h.ordemGrupos, ['Planta de Forro + Iluminação e Circuitos', 'planta de forro', 'Demolição e Construção'], 'sem vazio nem repetido (ignora acento/maiúscula)');
assert.strictEqual(h.gruposExecutivo, null, 'a lista de opções do formulário não mudou');
assert.throws(() => hub.atualizarHub(CAMINHO, 'projO', { ordemGrupos: 'x' }, DONO), /inválida/);
assert.throws(() => hub.atualizarHub(CAMINHO, 'projO', { ordemGrupos: ['a'] }, INTRUSO), /não pertence/);
assert.deepStrictEqual(galeria.buscarGaleriaPorProjeto(CAMINHO, 'projO').hub.ordemGrupos.length, 3, 'tentativa recusada não gravou');
h = hub.atualizarHub(CAMINHO, 'projO', { dadosProjeto: 'texto' }, DONO);
assert.strictEqual(h.ordemGrupos.length, 3, 'salvar outra coisa preserva a ordem');
h = hub.atualizarHub(CAMINHO, 'projO', { ordemGrupos: null }, DONO);
assert.ok(!('ordemGrupos' in h), 'null volta à ordem de sempre');
console.log('OK');

console.log('\nTODOS OS TESTES DE ORDEM PASSARAM');
