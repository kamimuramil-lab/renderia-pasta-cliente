// Lógica pura (sem servidor): direção da câmera (leque) na planta + ícone/logo da CONTA do arquiteto + migração
// das galerias antigas.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const galeria = require('../lib/galeria');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-direcao-perfil-'));
const CAMINHO = path.join(TMP, 'dados-galerias.json');
const DONO = 'arq@teste.com';
const INTRUSO = 'outro@teste.com';

galeria.criarOuAtualizarGaleria(CAMINHO, { projetoId: 'projD', licencaUsuario: DONO, nomeProjeto: 'Apto', clienteUsuario: 'cli', clienteSenha: 'senha1234' });
const fFixa = galeria.adicionarFoto(CAMINHO, 'projD', { nomeExibicao: 'Sala', tipo: 'fixa', r2Key: 'a.webp' });
const f360 = galeria.adicionarFoto(CAMINHO, 'projD', { nomeExibicao: 'Sala 360', tipo: '360', r2Key: 'b.webp' });
const planta = galeria.adicionarPlanta(CAMINHO, 'projD', { r2Key: 'projD/planta.png' }, DONO);
const lerFoto = (id) => galeria.buscarGaleriaPorProjeto(CAMINHO, 'projD').fotos.find((f) => f.id === id);

console.log('== 1. Direção só vale pra foto que JÁ está na planta ==');
assert.throws(() => galeria.direcionarFotoNaPlanta(CAMINHO, 'projD', fFixa.id, { angulo: 90 }, DONO), /ainda não está na planta/);
galeria.posicionarFotoNaPlanta(CAMINHO, 'projD', fFixa.id, { plantaId: planta.id, x: 0.4, y: 0.6 }, DONO);
assert.deepStrictEqual(lerFoto(fFixa.id).pinPlanta, { x: 0.4, y: 0.6 }, 'sem direção: formato antigo, só x e y');
console.log('OK');

console.log('== 2. Definir, normalizar e tirar a direção ==');
let f = galeria.direcionarFotoNaPlanta(CAMINHO, 'projD', fFixa.id, { angulo: 135 }, DONO);
assert.deepStrictEqual(f.pinPlanta, { x: 0.4, y: 0.6, angulo: 135 });
assert.strictEqual(galeria.direcionarFotoNaPlanta(CAMINHO, 'projD', fFixa.id, { angulo: 370 }, DONO).pinPlanta.angulo, 10, '370 -> 10');
assert.strictEqual(galeria.direcionarFotoNaPlanta(CAMINHO, 'projD', fFixa.id, { angulo: -90 }, DONO).pinPlanta.angulo, 270, '-90 -> 270');
assert.strictEqual(galeria.direcionarFotoNaPlanta(CAMINHO, 'projD', fFixa.id, { angulo: '45.26' }, DONO).pinPlanta.angulo, 45.3, 'aceita texto numérico, 1 casa decimal');
assert.strictEqual(galeria.direcionarFotoNaPlanta(CAMINHO, 'projD', fFixa.id, { angulo: 359.97 }, DONO).pinPlanta.angulo, 0, '359,97 arredonda pra 360 = 0');
assert.strictEqual(galeria.direcionarFotoNaPlanta(CAMINHO, 'projD', fFixa.id, { angulo: 0 }, DONO).pinPlanta.angulo, 0, '0 (pra cima) é uma direção válida, não "sem direção"');
f = galeria.direcionarFotoNaPlanta(CAMINHO, 'projD', fFixa.id, { angulo: null }, DONO);
assert.deepStrictEqual(f.pinPlanta, { x: 0.4, y: 0.6 }, 'null tira a direção');
assert.ok(!('angulo' in lerFoto(fFixa.id).pinPlanta));
console.log('OK');

console.log('== 3. Lixo é recusado ==');
for (const ruim of ['abc', '', NaN, Infinity, true, [], {}, [90]]) {
  assert.throws(() => galeria.direcionarFotoNaPlanta(CAMINHO, 'projD', fFixa.id, { angulo: ruim }, DONO), /Ângulo inválido/, 'recusa ' + JSON.stringify(ruim));
}
assert.ok(!('angulo' in lerFoto(fFixa.id).pinPlanta), 'nada foi gravado');
console.log('OK');

console.log('== 4. Mover o ícone NÃO perde a direção; mudar de planta também mantém ==');
galeria.direcionarFotoNaPlanta(CAMINHO, 'projD', fFixa.id, { angulo: 200 }, DONO);
f = galeria.posicionarFotoNaPlanta(CAMINHO, 'projD', fFixa.id, { plantaId: planta.id, x: 0.9, y: 0.1 }, DONO);
assert.deepStrictEqual(f.pinPlanta, { x: 0.9, y: 0.1, angulo: 200 });
const planta2 = galeria.adicionarPlanta(CAMINHO, 'projD', { r2Key: 'projD/planta2.png' }, DONO);
f = galeria.posicionarFotoNaPlanta(CAMINHO, 'projD', fFixa.id, { plantaId: planta2.id, x: 0.2, y: 0.3 }, DONO);
assert.strictEqual(f.pinPlanta.angulo, 200);
console.log('OK');

console.log('== 5. Posicionar já com direção (ou null) ==');
f = galeria.posicionarFotoNaPlanta(CAMINHO, 'projD', fFixa.id, { plantaId: planta.id, x: 0.5, y: 0.5, angulo: 45 }, DONO);
assert.strictEqual(f.pinPlanta.angulo, 45);
f = galeria.posicionarFotoNaPlanta(CAMINHO, 'projD', fFixa.id, { plantaId: planta.id, x: 0.5, y: 0.5, angulo: null }, DONO);
assert.ok(!('angulo' in f.pinPlanta));
assert.throws(() => galeria.posicionarFotoNaPlanta(CAMINHO, 'projD', fFixa.id, { plantaId: planta.id, x: 0.5, y: 0.5, angulo: 'xyz' }, DONO), /Ângulo inválido/);
console.log('OK');

console.log('== 6. Tirar o ícone da planta apaga a direção junto ==');
galeria.direcionarFotoNaPlanta(CAMINHO, 'projD', fFixa.id, { angulo: 90 }, DONO);
f = galeria.posicionarFotoNaPlanta(CAMINHO, 'projD', fFixa.id, { plantaId: null }, DONO);
assert.strictEqual(f.pinPlanta, null);
f = galeria.posicionarFotoNaPlanta(CAMINHO, 'projD', fFixa.id, { plantaId: planta.id, x: 0.3, y: 0.3 }, DONO);
assert.deepStrictEqual(f.pinPlanta, { x: 0.3, y: 0.3 }, 'voltou pra planta sem a direção antiga');
console.log('OK');

console.log('== 7. Imagem 360° não tem direção ==');
galeria.posicionarFotoNaPlanta(CAMINHO, 'projD', f360.id, { plantaId: planta.id, x: 0.7, y: 0.7, angulo: 90 }, DONO);
assert.ok(!('angulo' in lerFoto(f360.id).pinPlanta), 'angulo ignorado no 360');
assert.throws(() => galeria.direcionarFotoNaPlanta(CAMINHO, 'projD', f360.id, { angulo: 10 }, DONO), /360/);
console.log('OK');

console.log('== 8. Só o dono mexe na direção ==');
galeria.direcionarFotoNaPlanta(CAMINHO, 'projD', fFixa.id, { angulo: 15 }, DONO);
assert.throws(() => galeria.direcionarFotoNaPlanta(CAMINHO, 'projD', fFixa.id, { angulo: 99 }, INTRUSO), /não pertence/);
assert.strictEqual(lerFoto(fFixa.id).pinPlanta.angulo, 15);
assert.throws(() => galeria.direcionarFotoNaPlanta(CAMINHO, 'projD', 'foto_que_nao_existe', { angulo: 1 }, DONO), /Foto não encontrada/);
console.log('OK');

// ------------------------------------------------------------------ ícone e logo da conta
console.log('== 9. Conta sem nada configurado ==');
assert.deepStrictEqual(galeria.lerPerfil(CAMINHO, DONO), { icone: { r2Key: null }, marca: { r2Key: null } });
let pers = galeria.resolverPersonalizacao(galeria.lerEstado(CAMINHO), galeria.buscarGaleriaPorProjeto(CAMINHO, 'projD'));
assert.deepStrictEqual([pers.iconeR2Key, pers.marcaR2Key, pers.iconeOrigem, pers.marcaOrigem, pers.iconeExibir], [null, null, null, null, true]);
console.log('OK');

console.log('== 10. Definir ícone/logo da conta: vale pra todos os projetos dela, e devolve a chave antiga ==');
assert.strictEqual(galeria.definirArquivoPerfil(CAMINHO, DONO, 'icone', 'perfis/x/icone-1.png'), null);
assert.strictEqual(galeria.definirArquivoPerfil(CAMINHO, DONO, 'marca', 'perfis/x/marca-1.png'), null);
assert.strictEqual(galeria.definirArquivoPerfil(CAMINHO, DONO, 'icone', 'perfis/x/icone-2.png'), 'perfis/x/icone-1.png', 'devolve a antiga pra apagar o arquivo');
galeria.criarOuAtualizarGaleria(CAMINHO, { projetoId: 'projD2', licencaUsuario: DONO, nomeProjeto: 'Casa', clienteUsuario: 'cli2', clienteSenha: 'senha1234' });
for (const pid of ['projD', 'projD2']) {
  pers = galeria.resolverPersonalizacao(galeria.lerEstado(CAMINHO), galeria.buscarGaleriaPorProjeto(CAMINHO, pid));
  assert.deepStrictEqual([pers.iconeR2Key, pers.iconeOrigem, pers.marcaR2Key, pers.marcaOrigem], ['perfis/x/icone-2.png', 'conta', 'perfis/x/marca-1.png', 'conta'], pid);
}
console.log('OK');

console.log('== 11. Outra conta não enxerga (nem afeta) o perfil ==');
assert.deepStrictEqual(galeria.lerPerfil(CAMINHO, INTRUSO), { icone: { r2Key: null }, marca: { r2Key: null } });
galeria.definirArquivoPerfil(CAMINHO, INTRUSO, 'icone', 'perfis/y/icone-9.png');
assert.strictEqual(galeria.lerPerfil(CAMINHO, DONO).icone.r2Key, 'perfis/x/icone-2.png');
assert.strictEqual(galeria.lerPerfil(CAMINHO, INTRUSO).icone.r2Key, 'perfis/y/icone-9.png');
assert.throws(() => galeria.definirArquivoPerfil(CAMINHO, '', 'icone', 'k'), /licencaUsuario/);
assert.throws(() => galeria.definirArquivoPerfil(CAMINHO, DONO, 'qualquer', 'k'), /Tipo inválido/);
// a galeria do DONO nunca usa o ícone do intruso
pers = galeria.resolverPersonalizacao(galeria.lerEstado(CAMINHO), galeria.buscarGaleriaPorProjeto(CAMINHO, 'projD'));
assert.strictEqual(pers.iconeR2Key, 'perfis/x/icone-2.png');
console.log('OK');

console.log('== 12. Ícone/logo PRÓPRIO do projeto vence o da conta; removê-lo volta ao da conta ==');
galeria.atualizarIconePersonalizado(CAMINHO, 'projD', 'projD/icone-proprio.png');
galeria.atualizarMarcaDagua(CAMINHO, 'projD', { r2Key: 'projD/marca-propria.png' }, DONO);
pers = galeria.resolverPersonalizacao(galeria.lerEstado(CAMINHO), galeria.buscarGaleriaPorProjeto(CAMINHO, 'projD'));
assert.deepStrictEqual([pers.iconeR2Key, pers.iconeOrigem, pers.marcaR2Key, pers.marcaOrigem], ['projD/icone-proprio.png', 'projeto', 'projD/marca-propria.png', 'projeto']);
assert.throws(() => galeria.removerPersonalizacaoPropria(CAMINHO, 'projD', 'icone', INTRUSO), /não pertence/);
assert.strictEqual(galeria.removerPersonalizacaoPropria(CAMINHO, 'projD', 'icone', DONO), 'projD/icone-proprio.png', 'devolve a chave pra apagar o arquivo');
assert.strictEqual(galeria.removerPersonalizacaoPropria(CAMINHO, 'projD', 'marca', DONO), 'projD/marca-propria.png');
assert.strictEqual(galeria.removerPersonalizacaoPropria(CAMINHO, 'projD', 'marca', DONO), null, 'já removido');
assert.throws(() => galeria.removerPersonalizacaoPropria(CAMINHO, 'projD', 'x', DONO), /Tipo inválido/);
pers = galeria.resolverPersonalizacao(galeria.lerEstado(CAMINHO), galeria.buscarGaleriaPorProjeto(CAMINHO, 'projD'));
assert.deepStrictEqual([pers.iconeOrigem, pers.marcaOrigem], ['conta', 'conta']);
console.log('OK');

console.log('== 13. "Exibir ícone" desliga só a exibição (o arquivo continua); só o dono mexe ==');
const ic = galeria.atualizarExibirIcone(CAMINHO, 'projD', false, DONO);
assert.strictEqual(ic.exibir, false);
pers = galeria.resolverPersonalizacao(galeria.lerEstado(CAMINHO), galeria.buscarGaleriaPorProjeto(CAMINHO, 'projD'));
assert.strictEqual(pers.iconeExibir, false);
assert.strictEqual(pers.iconeR2Key, 'perfis/x/icone-2.png', 'o arquivo da conta continua lá');
assert.throws(() => galeria.atualizarExibirIcone(CAMINHO, 'projD', true, INTRUSO), /não pertence/);
assert.strictEqual(galeria.buscarGaleriaPorProjeto(CAMINHO, 'projD').iconePersonalizado.exibir, false);
galeria.atualizarExibirIcone(CAMINHO, 'projD', true, DONO);
console.log('OK');

console.log('== 14. Remover da conta ==');
assert.strictEqual(galeria.removerArquivoPerfil(CAMINHO, DONO, 'icone'), 'perfis/x/icone-2.png');
assert.strictEqual(galeria.lerPerfil(CAMINHO, DONO).icone.r2Key, null);
assert.strictEqual(galeria.lerPerfil(CAMINHO, DONO).marca.r2Key, 'perfis/x/marca-1.png', 'o logo continua');
console.log('OK');

// ------------------------------------------------------------------ migração das galerias antigas
console.log('== 15. Galerias ANTIGAS (formato de antes) ganham o padrão novo, UMA vez ==');
const CAMINHO_VELHO = path.join(TMP, 'velho.json');
const base = { linkToken: 't', clienteUsuario: 'c', clienteSenhaHash: 'h', nomeProjeto: 'X', fotos: [], sessoesClienteAtivas: [] };
fs.writeFileSync(CAMINHO_VELHO, JSON.stringify({ galerias: [
  Object.assign({}, base, { projetoId: 'sem-nada', licencaUsuario: DONO }),                                                       // muito antiga: sem marcaDagua/ícone
  Object.assign({}, base, { projetoId: 'desligada', licencaUsuario: DONO, marcaDagua: { ativa: false, r2Key: null, transparencia: 100, escala: 100 }, iconePersonalizado: { r2Key: null } }),
  Object.assign({}, base, { projetoId: 'logo-proprio-off', licencaUsuario: DONO, marcaDagua: { ativa: false, r2Key: 'x/m.png', transparencia: 70, escala: 50 }, iconePersonalizado: { r2Key: 'x/i.png' } }),
  Object.assign({}, base, { projetoId: 'logo-proprio-on', licencaUsuario: DONO, marcaDagua: { ativa: true, r2Key: 'x/m2.png', transparencia: 100, escala: 100 }, iconePersonalizado: { r2Key: null } })
] }));
const lerVelha = (id) => galeria.buscarGaleriaPorProjeto(CAMINHO_VELHO, id);
assert.strictEqual(lerVelha('sem-nada').marcaDagua.ativa, true);
assert.strictEqual(lerVelha('desligada').marcaDagua.ativa, true, 'nunca teve logo próprio: passa a seguir o da conta (ligado)');
assert.strictEqual(lerVelha('desligada').iconePersonalizado.exibir, true);
assert.strictEqual(lerVelha('logo-proprio-off').marcaDagua.ativa, false, 'tinha logo PRÓPRIO e escolheu desligar: respeita');
assert.strictEqual(lerVelha('logo-proprio-off').marcaDagua.transparencia, 70, 'ajustes próprios intactos');
assert.strictEqual(lerVelha('logo-proprio-on').marcaDagua.ativa, true);
assert.deepStrictEqual(galeria.lerEstado(CAMINHO_VELHO).perfis, {}, 'perfis nasce vazio');
// a pessoa desliga DEPOIS da migração: o desligado vale (a migração não roda de novo)
galeria.atualizarMarcaDagua(CAMINHO_VELHO, 'desligada', { ativa: false }, DONO);
assert.strictEqual(lerVelha('desligada').marcaDagua.ativa, false, 'desligar depois da migração é respeitado');
galeria.atualizarExibirIcone(CAMINHO_VELHO, 'desligada', false, DONO);
assert.strictEqual(lerVelha('desligada').iconePersonalizado.exibir, false);
assert.strictEqual(lerVelha('desligada').marcaDagua.ativa, false);
// arquivo inexistente / corrompido: estado vazio completo
assert.deepStrictEqual(galeria.lerEstado(path.join(TMP, 'nao-existe.json')), { galerias: [], perfis: {} });
console.log('OK');

console.log('\nOK teste_direcao_e_perfil');
