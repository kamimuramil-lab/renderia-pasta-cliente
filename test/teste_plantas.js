const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const galeria = require('../lib/galeria');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-plantas-'));
const CAMINHO = path.join(TMP, 'dados-galerias.json');
const DONO = 'arq@teste.com';
const INTRUSO = 'outro@teste.com';

galeria.criarOuAtualizarGaleria(CAMINHO, {
  projetoId: 'projP', licencaUsuario: DONO, nomeProjeto: 'Apartamento',
  clienteUsuario: 'cliente', clienteSenha: 'senha1234'
});
const f1 = galeria.adicionarFoto(CAMINHO, 'projP', { nomeExibicao: 'Sala', tipo: 'fixa', r2Key: 'a.webp' });
const f2 = galeria.adicionarFoto(CAMINHO, 'projP', { nomeExibicao: 'Sala 360', tipo: '360', r2Key: 'b.webp' });

console.log('== 1. Galeria nova já nasce com plantas vazias ==');
assert.deepStrictEqual(galeria.buscarGaleriaPorProjeto(CAMINHO, 'projP').plantas, []);
console.log('OK');

console.log('== 2. Adicionar planta: nome padrão, ordem e id ==');
const p1 = galeria.adicionarPlanta(CAMINHO, 'projP', { r2Key: 'projP/planta-1.png' }, DONO);
const p2 = galeria.adicionarPlanta(CAMINHO, 'projP', { nome: '  Pavimento superior ', r2Key: 'projP/planta-2.png' }, DONO);
assert.strictEqual(p1.nome, 'Planta 1');
assert.strictEqual(p2.nome, 'Pavimento superior');
assert.deepStrictEqual([p1.ordem, p2.ordem], [0, 1]);
assert.ok(p1.id.startsWith('planta_') && p1.id !== p2.id);
assert.throws(() => galeria.adicionarPlanta(CAMINHO, 'projP', { nome: 'x' }, DONO), /r2Key/);
console.log('OK');

console.log('== 3. Posicionar foto na planta (frações 0..1) ==');
let foto = galeria.posicionarFotoNaPlanta(CAMINHO, 'projP', f1.id, { plantaId: p1.id, x: 0.25, y: 0.75 }, DONO);
assert.strictEqual(foto.plantaId, p1.id);
assert.deepStrictEqual(foto.pinPlanta, { x: 0.25, y: 0.75 });
// persistiu mesmo
assert.deepStrictEqual(galeria.buscarGaleriaPorProjeto(CAMINHO, 'projP').fotos.find((f) => f.id === f1.id).pinPlanta, { x: 0.25, y: 0.75 });
console.log('OK');

console.log('== 4. Coordenadas fora da imagem são travadas nas bordas; lixo é recusado ==');
foto = galeria.posicionarFotoNaPlanta(CAMINHO, 'projP', f2.id, { plantaId: p1.id, x: 1.7, y: -0.3 }, DONO);
assert.deepStrictEqual(foto.pinPlanta, { x: 1, y: 0 });
assert.throws(() => galeria.posicionarFotoNaPlanta(CAMINHO, 'projP', f2.id, { plantaId: p1.id, x: 'abc', y: 0.5 }, DONO), /inválida/i);
assert.throws(() => galeria.posicionarFotoNaPlanta(CAMINHO, 'projP', f2.id, { plantaId: p1.id, x: NaN, y: 0.5 }, DONO), /inválida/i);
assert.throws(() => galeria.posicionarFotoNaPlanta(CAMINHO, 'projP', f2.id, { plantaId: 'planta_que_nao_existe', x: 0.5, y: 0.5 }, DONO), /Planta não encontrada/);
assert.throws(() => galeria.posicionarFotoNaPlanta(CAMINHO, 'projP', 'foto_que_nao_existe', { plantaId: p1.id, x: 0.5, y: 0.5 }, DONO), /Foto não encontrada/);
console.log('OK');

console.log('== 5. Mover a foto de uma planta pra outra, e tirar da planta ==');
foto = galeria.posicionarFotoNaPlanta(CAMINHO, 'projP', f1.id, { plantaId: p2.id, x: 0.1, y: 0.2 }, DONO);
assert.strictEqual(foto.plantaId, p2.id);
foto = galeria.posicionarFotoNaPlanta(CAMINHO, 'projP', f1.id, { plantaId: null }, DONO);
assert.strictEqual(foto.plantaId, null);
assert.strictEqual(foto.pinPlanta, null);
console.log('OK');

console.log('== 6. Renomear e reordenar planta ==');
const editada = galeria.editarPlanta(CAMINHO, 'projP', p1.id, { nome: 'Térreo', ordem: 5 }, DONO);
assert.strictEqual(editada.nome, 'Térreo');
assert.strictEqual(editada.ordem, 5);
galeria.editarPlanta(CAMINHO, 'projP', p1.id, { nome: '   ' }, DONO); // nome vazio não apaga o nome
assert.strictEqual(galeria.buscarGaleriaPorProjeto(CAMINHO, 'projP').plantas.find((p) => p.id === p1.id).nome, 'Térreo');
assert.throws(() => galeria.editarPlanta(CAMINHO, 'projP', 'nao_existe', { nome: 'x' }, DONO), /não encontrada/i);
console.log('OK');

console.log('== 7. Trocar a imagem da planta mantém os ícones e devolve a chave antiga ==');
galeria.posicionarFotoNaPlanta(CAMINHO, 'projP', f1.id, { plantaId: p1.id, x: 0.4, y: 0.6 }, DONO);
const troca = galeria.atualizarImagemPlanta(CAMINHO, 'projP', p1.id, 'projP/planta-nova.png', DONO);
assert.strictEqual(troca.r2KeyAntiga, 'projP/planta-1.png');
assert.strictEqual(troca.planta.r2Key, 'projP/planta-nova.png');
assert.deepStrictEqual(galeria.buscarGaleriaPorProjeto(CAMINHO, 'projP').fotos.find((f) => f.id === f1.id).pinPlanta, { x: 0.4, y: 0.6 });
console.log('OK');

console.log('== 8. Excluir planta NÃO exclui as fotos -- só tira os ícones dela ==');
galeria.posicionarFotoNaPlanta(CAMINHO, 'projP', f2.id, { plantaId: p2.id, x: 0.9, y: 0.9 }, DONO);
const chaveRemovida = galeria.excluirPlanta(CAMINHO, 'projP', p1.id, DONO);
assert.strictEqual(chaveRemovida, 'projP/planta-nova.png');
const g8 = galeria.buscarGaleriaPorProjeto(CAMINHO, 'projP');
assert.strictEqual(g8.plantas.length, 1);
assert.strictEqual(g8.fotos.length, 2, 'as fotos continuam na galeria');
assert.strictEqual(g8.fotos.find((f) => f.id === f1.id).plantaId, null, 'ícone da planta excluída some');
assert.strictEqual(g8.fotos.find((f) => f.id === f1.id).pinPlanta, null);
assert.strictEqual(g8.fotos.find((f) => f.id === f2.id).plantaId, p2.id, 'ícone da OUTRA planta não é afetado');
assert.throws(() => galeria.excluirPlanta(CAMINHO, 'projP', p1.id, DONO), /não encontrada/i);
console.log('OK');

console.log('== 9. SEGURANÇA: outro arquiteto não mexe nas plantas nem nos ícones do projeto alheio ==');
assert.throws(() => galeria.adicionarPlanta(CAMINHO, 'projP', { r2Key: 'x.png' }, INTRUSO), /não pertence/);
assert.throws(() => galeria.editarPlanta(CAMINHO, 'projP', p2.id, { nome: 'Hackeada' }, INTRUSO), /não pertence/);
assert.throws(() => galeria.atualizarImagemPlanta(CAMINHO, 'projP', p2.id, 'x.png', INTRUSO), /não pertence/);
assert.throws(() => galeria.excluirPlanta(CAMINHO, 'projP', p2.id, INTRUSO), /não pertence/);
assert.throws(() => galeria.posicionarFotoNaPlanta(CAMINHO, 'projP', f2.id, { plantaId: null }, INTRUSO), /não pertence/);
assert.throws(() => galeria.adicionarPlanta(CAMINHO, 'projeto_inexistente', { r2Key: 'x.png' }, DONO), /não encontrada/i);
const g9 = galeria.buscarGaleriaPorProjeto(CAMINHO, 'projP');
assert.strictEqual(g9.plantas.find((p) => p.id === p2.id).nome, 'Pavimento superior', 'nada foi alterado pelo intruso');
console.log('OK');

console.log('== 10. Limite de plantas por projeto ==');
for (let i = g9.plantas.length; i < galeria.LIMITE_PLANTAS_POR_PROJETO; i++) {
  galeria.adicionarPlanta(CAMINHO, 'projP', { r2Key: `projP/p${i}.png` }, DONO);
}
assert.throws(() => galeria.adicionarPlanta(CAMINHO, 'projP', { r2Key: 'extra.png' }, DONO), /máximo/i);
console.log('OK');

console.log('== 11. MIGRAÇÃO: galeria antiga (sem o campo plantas) abre normal e nada se perde ==');
const CAMINHO_ANTIGO = path.join(TMP, 'dados-antigos.json');
fs.writeFileSync(CAMINHO_ANTIGO, JSON.stringify({ galerias: [{
  projetoId: 'velha', licencaUsuario: DONO, linkToken: 'tok', clienteUsuario: 'c', clienteSenhaHash: 'h', nomeProjeto: 'Velha',
  sessoesClienteAtivas: [], categorias: [],
  fotos: [{ id: 'foto_1', nomeExibicao: 'Antiga', tipo: 'fixa', ordem: 0, r2Key: 'k.webp', aprovada: true, arquivada: false, comentarios: [{ id: 'c1', texto: 'oi' }] }]
}] }));
const velha = galeria.buscarGaleriaPorProjeto(CAMINHO_ANTIGO, 'velha');
assert.deepStrictEqual(velha.plantas, []);
assert.strictEqual(velha.fotos[0].aprovada, true);
assert.strictEqual(velha.fotos[0].comentarios.length, 1);
// e dá pra usar plantas nela normalmente; os campos antigos seguem intactos após gravar
const pv = galeria.adicionarPlanta(CAMINHO_ANTIGO, 'velha', { r2Key: 'v.png' }, DONO);
galeria.posicionarFotoNaPlanta(CAMINHO_ANTIGO, 'velha', 'foto_1', { plantaId: pv.id, x: 0.5, y: 0.5 }, DONO);
const velha2 = galeria.buscarGaleriaPorProjeto(CAMINHO_ANTIGO, 'velha');
assert.strictEqual(velha2.fotos[0].aprovada, true);
assert.strictEqual(velha2.fotos[0].comentarios[0].texto, 'oi');
console.log('OK');

console.log('== 12. RETROCOMPATIBILIDADE (rollback): o código ANTIGO preserva os campos de planta ao regravar ==');
// o código antigo faz lerEstado -> altera algo -> salvarEstado; os campos desconhecidos (plantas, pinPlanta) têm que sobreviver
const estadoBruto = JSON.parse(fs.readFileSync(CAMINHO_ANTIGO, 'utf8'));
estadoBruto.galerias[0].atualizadoEm = 'mexeu-como-codigo-antigo';
fs.writeFileSync(CAMINHO_ANTIGO, JSON.stringify(estadoBruto));
const velha3 = galeria.buscarGaleriaPorProjeto(CAMINHO_ANTIGO, 'velha');
assert.strictEqual(velha3.plantas.length, 1);
assert.deepStrictEqual(velha3.fotos[0].pinPlanta, { x: 0.5, y: 0.5 });
console.log('OK');

fs.rmSync(TMP, { recursive: true, force: true });
console.log('\nTODOS OS TESTES DE PLANTAS PASSARAM');
