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

console.log('== 5. Voltar do navegador: navegacao.js entre a miniatura e o hub, e ganchos nas telas ==');
assert.ok(pos('planta-mini.js') < pos('navegacao.js') && pos('navegacao.js') < pos('hub.js') && pos('hub.js') < pos('main.js'));
const hubjs = fs.readFileSync(path.join(pub, 'assets/js/hub.js'), 'utf8');
assert.ok(/NavCliente\.sincronizar\(\)/.test(hubjs) && /NavCliente\.sincronizar\(\)/.test(planta) && /NavCliente\.sincronizar\(\)/.test(main));
assert.ok(/secaoAberta: \(\) => secaoAberta/.test(hubjs) && /plantaAtual: \(\) => ST\.plantaId/.test(planta));
console.log('OK');

console.log('== 6. Dados do projeto com links: script carregado antes do hub ==');
assert.ok(pos('dados-projeto.js') > 0 && pos('dados-projeto.js') < pos('hub.js'));
assert.ok(/DadosProjeto\.htmlDosDados/.test(hubjs));
console.log('OK');

console.log('== 7. "Próxima categoria" é a própria seta da direita (não um botão por cima da imagem) ==');
assert.ok(/id="rotuloProximaCategoria"/.test(html) && /class="ico-cat"/.test(html));
assert.ok(/seta\.classList\.toggle\('proxima-categoria', vaiParaOutraCategoria\)/.test(main), 'a seta troca de visual no fim da categoria');
assert.ok(/\$\('btnProximaCategoria'\)\.style\.display = 'none'/.test(main), 'o botão antigo fica sempre escondido');
assert.ok(/delta > 0 && estado\.indiceCategoriaAtual < estado\.categoriasOrdenadas\.length - 1\) abrirCategoria\(estado\.indiceCategoriaAtual \+ 1\)/.test(main), 'seta, zona de clique e teclado avançam de categoria');
console.log('OK');

console.log('== 8. CSS: miniatura da câmera sem espremer, capa do hub na largura dos cartões, celular com aprovar/alterar lado a lado ==');
assert.ok(/\.pin-rotulo-img\{ max-width:none; flex-shrink:0;/.test(css) && /\.pin-rotulo\{ min-width:160px; \}/.test(css));
assert.ok(/@media \(min-width:700px\)\{\s*\.hub-capa\{ margin:18px 0 22px;/.test(css));
assert.ok(/\.linha-acoes-visualizador \.btn-aprovar, \.linha-acoes-visualizador \.btn-desenhar\{\s*flex:1 1 0;/.test(css) && /\.linha-acoes-visualizador \.area-comentario\{ flex:1 1 100%; \}/.test(css));
console.log('OK');

console.log('== 9. Baixar PDF (galeria e planta), aviso de revisão e categoria anterior ==');
const hubjs2 = fs.readFileSync(path.join(pub, 'assets/js/hub.js'), 'utf8');
const pdfjs = fs.readFileSync(path.join(pub, 'assets/js/pdf-cliente.js'), 'utf8');
['btnPdfGaleria', 'btnPdfPlanta', 'modalPdfCliente', 'pdfAmbientes', 'btnGerarPdfCliente', 'chkPdfNomes', 'chkPdfPaleta', 'modalAvisoDoc', 'btnAvisoAbrir', 'btnAvisoVoltar', 'rotuloCategoriaAnterior'].forEach((id) => assert.ok(html.includes(`id="${id}"`), 'no HTML: ' + id));
const idsPdf = [...new Set([...pdfjs.matchAll(/\$\('([A-Za-z0-9_]+)'\)/g)].map((m) => m[1]))];
idsPdf.forEach((id) => assert.ok(html.includes(`id="${id}"`), 'pdf-cliente.js usa #' + id));
assert.ok(pos('paleta-cores.js') < pos('imagens-pdf.js') && pos('imagens-pdf.js') < pos('pdf-cliente.js') && pos('pdf-cliente.js') < pos('main.js'));
assert.ok(/ImagensPdf\.montarHtml/.test(pdfjs) && /escritorio: g\.nomeEscritorio/.test(pdfjs) && /agora/.test(pdfjs), 'usa o mesmo gerador do app, com o escritório e o horário da geração');
assert.ok(/'no-store'/.test(pdfjs), 'busca a imagem sem o cache (evita imagem sem CORS "contaminando" o canvas)');
assert.ok(/AVISOS_DOCUMENTO/.test(hubjs2) && /ESTE PROJETO ESTÁ SOB REVISÃO/.test(hubjs2) && /ESTE PROJETO É UMA VERSÃO ANTIGA/.test(hubjs2) && /data-status="\$\{esc\(d\.status\)\}"/.test(hubjs2), 'aviso para REVISAO e ANTIGA');
assert.ok(/OK, ABRIR MESMO ASSIM/.test(html) && /execução ou orçamento/.test(html));
assert.ok(/categoria-anterior/.test(main) && /Categoria anterior:/.test(main));
console.log('OK');

console.log('\nTODOS OS TESTES DO VISUALIZADOR (ESTRUTURA) PASSARAM');
