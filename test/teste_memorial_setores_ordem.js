// Ordem dos setores do Memorial (▲▼ no app): o cliente e os PDFs seguem a mesma ordem; posse, lista parcial e nome estranho.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const galeria = require('../lib/galeria');
const mem = require('../lib/memorial');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-setores-ordem-'));
const CAM = path.join(TMP, 'dados-galerias.json');
const DONO = 'arq@teste.com'; const INTRUSO = 'outro@teste.com';
galeria.criarOuAtualizarGaleria(CAM, { projetoId: 'p1', licencaUsuario: DONO, nomeProjeto: 'Apto', clienteUsuario: 'cli', clienteSenha: 'senha1234' });
const setores = () => mem.lerParaArquiteto(CAM, 'p1', DONO).setores;

console.log('== 1. Inverter a ordem e ela fica gravada ==');
const padrao = setores();
assert.deepStrictEqual(padrao, mem.SETORES);
const r = mem.ordenarSetores(CAM, 'p1', [...padrao].reverse(), DONO);
assert.deepStrictEqual(r, [...padrao].reverse());
assert.deepStrictEqual(setores(), [...padrao].reverse(), 'gravado');
console.log('OK');

console.log('== 2. Lista parcial / nome que não existe / repetido: nada some nem duplica ==');
const ordem0 = setores();
const r2 = mem.ordenarSetores(CAM, 'p1', [ordem0[3], 'Setor Fantasma', ordem0[3], ordem0[1]], DONO);
assert.deepStrictEqual(r2.slice(0, 2), [ordem0[3], ordem0[1]]);
assert.strictEqual(r2.length, ordem0.length);
assert.strictEqual(new Set(r2).size, ordem0.length);
assert.deepStrictEqual(r2.slice(2), ordem0.filter((s) => s !== ordem0[3] && s !== ordem0[1]), 'o resto fica no fim, na ordem de antes');
assert.throws(() => mem.ordenarSetores(CAM, 'p1', 'abc', DONO), /inválida/);
console.log('OK');

console.log('== 3. A ordem acompanha criar/renomear e o CLIENTE vê na mesma ordem ==');
mem.adicionarSetor(CAM, 'p1', 'Paisagismo', DONO);
const nomeA = setores()[0];
mem.renomearSetor(CAM, 'p1', nomeA, 'Primeiro Renomeado', DONO);
assert.strictEqual(setores()[0], 'Primeiro Renomeado', 'renomear não muda a posição');
assert.strictEqual(setores().slice(-1)[0], 'Paisagismo', 'setor novo entra no fim');
mem.adicionarItem(CAM, 'p1', { setor: 'Paisagismo', item: 'Vaso' }, DONO);
mem.adicionarItem(CAM, 'p1', { setor: 'Primeiro Renomeado', item: 'Torneira' }, DONO);
mem.ordenarSetores(CAM, 'p1', ['Paisagismo', ...setores().filter((s) => s !== 'Paisagismo')], DONO);
const g = galeria.buscarGaleriaPorProjeto(CAM, 'p1');
const cli = mem.paraCliente(g);
assert.strictEqual(cli.setores[0], 'Paisagismo', 'o cliente recebe os setores na ordem do arquiteto');
assert.deepStrictEqual(cli.itens.map((i) => i.item), ['Vaso', 'Torneira'], 'e os itens vêm na ordem dos setores');
console.log('OK');

console.log('== 4. Posse: outra licença não mexe ==');
const antes = JSON.stringify(setores());
assert.throws(() => mem.ordenarSetores(CAM, 'p1', [], INTRUSO), /não pertence/);
assert.strictEqual(JSON.stringify(setores()), antes);
console.log('OK');

fs.rmSync(TMP, { recursive: true, force: true });
console.log('\nTODOS OS TESTES DA ORDEM DOS SETORES PASSARAM');
