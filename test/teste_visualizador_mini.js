// Visualizador do cliente: barra de ações numa linha só e miniatura da planta. Teste ESTRUTURAL (sem navegador):
// todo id que o planta-mini.js usa existe no HTML, a ordem dos scripts está certa e os ganchos do main.js/planta.js estão ligados.
// (O comportamento visual foi conferido no navegador com o projeto DGT.)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const pub = path.join(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
const mini = fs.readFileSync(path.join(pub, 'assets/js/planta-mini.js'), 'utf8');
const main = fs.readFileSync(path.join(pub, 'assets/js/main.js'), 'utf8');
const planta = fs.readFileSync(path.join(pub, 'assets/js/planta.js'), 'utf8');
const css = fs.readFileSync(path.join(pub, 'assets/css/style.css'), 'utf8');

console.log('== 1. Todo id usado pela miniatura existe no HTML ==');
const ids = [...new Set([...mini.matchAll(/\$\('([A-Za-z0-9_]+)'\)/g)].map((m) => m[1]))];
assert.ok(ids.length >= 10, 'achou os ids');
ids.forEach((id) => assert.ok(html.includes(`id="${id}"`), `id ${id} existe no HTML`));
console.log('OK', ids.length, 'ids');

console.log('== 2. Ordem dos scripts: planta.js, planta-mini.js, main.js ==');
const pos = (s) => html.indexOf(`src="assets/js/${s}"`);
assert.ok(pos('planta.js') > 0 && pos('planta.js') < pos('planta-mini.js') && pos('planta-mini.js') < pos('main.js'));
console.log('OK');

console.log('== 3. Ganchos: o visualizador atualiza/esconde a miniatura e a planta expõe abrirFoto ==');
assert.ok(/PlantaMini\.atualizar\(foto\)/.test(main) && /PlantaMini\.esconder\(\)/.test(main));
assert.ok(/abrirFoto: abrirFotoPeloId/.test(planta) && /window\.PlantaCliente\.abrirFoto/.test(mini));
console.log('OK');

console.log('== 4. Aprovar, solicitar alteração e comentário na MESMA linha ==');
const linha = html.slice(html.indexOf('class="linha-acoes-visualizador"'), html.indexOf('id="linhaCoresDesenho"'));
['btnAprovarFoto', 'btnAlternarDesenho', 'inputComentario', 'btnEnviarComentario', 'btnVerHistorico'].forEach((id) => assert.ok(linha.includes(`id="${id}"`), `${id} dentro da linha de ações`));
assert.ok(/\.linha-acoes-visualizador\{ flex-wrap:wrap; \}/.test(css), 'quebra de linha só quando não cabe (celular)');
console.log('OK');

console.log('\nTODOS OS TESTES DO VISUALIZADOR (ESTRUTURA) PASSARAM');
