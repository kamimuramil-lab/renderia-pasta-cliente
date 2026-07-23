const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const galeria = require('/home/claude/pasta-cliente/lib/galeria');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-categorias-'));
const CAMINHO = path.join(TMP, 'dados-galerias.json');

galeria.criarOuAtualizarGaleria(CAMINHO, {
  projetoId: 'projCat', licencaUsuario: 'arq@teste.com', nomeProjeto: 'Casa Categorias',
  clienteUsuario: 'clienteCat', clienteSenha: 'senha1234'
});

console.log('== 1. Criar categoria sem nome falha ==');
assert.throws(() => galeria.criarCategoria(CAMINHO, 'projCat', ''), /nome/i);
console.log('OK');

console.log('== 2. Criar categorias funciona e mantém ordem de criação ==');
const catLavabo = galeria.criarCategoria(CAMINHO, 'projCat', 'Lavabo');
const catSala = galeria.criarCategoria(CAMINHO, 'projCat', 'Sala de Estar');
assert.strictEqual(catLavabo.ordem, 0);
assert.strictEqual(catSala.ordem, 1);
assert.strictEqual(catLavabo.moodFotoId, null);
console.log('OK');

console.log('== 3. Adicionar foto já associada a uma categoria ==');
const fotoLavabo1 = galeria.adicionarFoto(CAMINHO, 'projCat', { nomeExibicao: 'Lavabo 1', tipo: 'fixa', r2Key: 'a.webp', categoriaId: catLavabo.id });
assert.strictEqual(fotoLavabo1.categoriaId, catLavabo.id);
console.log('OK');

console.log('== 4. editarFoto consegue mudar a categoria de uma foto depois ==');
const fotoSemCategoria = galeria.adicionarFoto(CAMINHO, 'projCat', { nomeExibicao: 'Foto solta', tipo: 'fixa', r2Key: 'b.webp' });
assert.strictEqual(fotoSemCategoria.categoriaId, null);
galeria.editarFoto(CAMINHO, 'projCat', fotoSemCategoria.id, { categoriaId: catSala.id });
const galeriaAtual1 = galeria.buscarGaleriaPorProjeto(CAMINHO, 'projCat');
assert.strictEqual(galeriaAtual1.fotos.find((f) => f.id === fotoSemCategoria.id).categoriaId, catSala.id);
console.log('OK');

console.log('== 5. Definir o mood de uma categoria (moodFotoId) ==');
const fotoMoodLavabo = galeria.adicionarFoto(CAMINHO, 'projCat', { nomeExibicao: 'Mood Lavabo', tipo: 'moodboard', r2Key: 'mood.webp' });
galeria.editarCategoria(CAMINHO, 'projCat', catLavabo.id, { moodFotoId: fotoMoodLavabo.id });
const galeriaAtual2 = galeria.buscarGaleriaPorProjeto(CAMINHO, 'projCat');
assert.strictEqual(galeriaAtual2.categorias.find((c) => c.id === catLavabo.id).moodFotoId, fotoMoodLavabo.id);
console.log('OK');

console.log('== 6. Renomear categoria ==');
galeria.editarCategoria(CAMINHO, 'projCat', catLavabo.id, { nome: 'Lavabo Social' });
assert.strictEqual(galeria.buscarGaleriaPorProjeto(CAMINHO, 'projCat').categorias.find((c) => c.id === catLavabo.id).nome, 'Lavabo Social');
console.log('OK');

console.log('== 7. Excluir categoria NÃO exclui as fotos, só desassocia ==');
galeria.excluirCategoria(CAMINHO, 'projCat', catSala.id);
const galeriaAtual3 = galeria.buscarGaleriaPorProjeto(CAMINHO, 'projCat');
assert.strictEqual(galeriaAtual3.categorias.length, 1, 'só deveria sobrar 1 categoria (Lavabo)');
assert.strictEqual(galeriaAtual3.fotos.find((f) => f.id === fotoSemCategoria.id).categoriaId, null, 'a foto deveria voltar a ficar sem categoria');
assert.strictEqual(galeriaAtual3.fotos.length, 3, 'nenhuma foto deveria ter sido apagada');
console.log('OK');

console.log('== 8. Marca d\'água começa desativada por padrão ==');
const galeriaInicial = galeria.buscarGaleriaPorProjeto(CAMINHO, 'projCat');
assert.strictEqual(galeriaInicial.marcaDagua.ativa, false);
assert.strictEqual(galeriaInicial.marcaDagua.transparencia, 100);
assert.strictEqual(galeriaInicial.marcaDagua.escala, 100);
assert.strictEqual(galeriaInicial.iconePersonalizado.r2Key, null);
console.log('OK');

console.log('== 9. Atualizar marca d\'água (upload + ativar + ajustar transparência/escala) ==');
galeria.atualizarMarcaDagua(CAMINHO, 'projCat', { r2Key: 'projCat/marca-dagua.png', ativa: true, transparencia: 60, escala: 40 });
const galeriaComMarca = galeria.buscarGaleriaPorProjeto(CAMINHO, 'projCat');
assert.strictEqual(galeriaComMarca.marcaDagua.ativa, true);
assert.strictEqual(galeriaComMarca.marcaDagua.r2Key, 'projCat/marca-dagua.png');
assert.strictEqual(galeriaComMarca.marcaDagua.transparencia, 60);
assert.strictEqual(galeriaComMarca.marcaDagua.escala, 40);
console.log('OK');

console.log('== 10. Transparência/escala ficam sempre entre 10 e 100 (não deixa passar do limite) ==');
galeria.atualizarMarcaDagua(CAMINHO, 'projCat', { transparencia: 500, escala: 2 });
const galeriaLimites = galeria.buscarGaleriaPorProjeto(CAMINHO, 'projCat');
assert.strictEqual(galeriaLimites.marcaDagua.transparencia, 100, 'não deveria passar de 100');
assert.strictEqual(galeriaLimites.marcaDagua.escala, 10, 'não deveria ficar abaixo de 10');
console.log('OK');

console.log('== 11. Desativar a marca d\'água mantém o resto da configuração salva ==');
galeria.atualizarMarcaDagua(CAMINHO, 'projCat', { ativa: false });
const galeriaDesativada = galeria.buscarGaleriaPorProjeto(CAMINHO, 'projCat');
assert.strictEqual(galeriaDesativada.marcaDagua.ativa, false);
assert.strictEqual(galeriaDesativada.marcaDagua.r2Key, 'projCat/marca-dagua.png', 'não deveria ter apagado o arquivo já enviado, só desativado');
console.log('OK');

console.log('== 12. Ícone personalizado ==');
galeria.atualizarIconePersonalizado(CAMINHO, 'projCat', 'projCat/icone.png');
assert.strictEqual(galeria.buscarGaleriaPorProjeto(CAMINHO, 'projCat').iconePersonalizado.r2Key, 'projCat/icone.png');
galeria.atualizarIconePersonalizado(CAMINHO, 'projCat', null);
assert.strictEqual(galeria.buscarGaleriaPorProjeto(CAMINHO, 'projCat').iconePersonalizado.r2Key, null, 'deveria conseguir remover o ícone também');
console.log('OK');

console.log('\nTODOS OS TESTES DE CATEGORIA PASSARAM 🎉');
