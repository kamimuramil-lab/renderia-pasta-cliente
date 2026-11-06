// Guarda contra um bug real (nov/2026): a prévia dos ícones da planta carregava a foto como <img> comum e o
// navegador guardava a cópia SEM cabeçalho CORS; depois o visualizador 360 (XHR, exige CORS) pedia o mesmo
// arquivo do R2 e falhava com "The file ... could not be accessed". Toda <img> montada com a URL de uma foto
// da galeria (f.url / foto.url) precisa ter crossorigin="anonymous".
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const arq = path.join(__dirname, '..', 'public', 'assets', 'js', 'planta.js');
const fonte = fs.readFileSync(arq, 'utf8');

const imgsDeFoto = fonte.match(/<img[^>]*\$\{escapeHtml\(f\.url\)\}[^>]*>/g) || [];
assert.ok(imgsDeFoto.length >= 1, 'não achei a <img> da prévia em planta.js (o teste precisa ser atualizado?)');
for (const tag of imgsDeFoto) {
  assert.ok(/crossorigin="anonymous"/.test(tag), 'a <img> da prévia perdeu o crossorigin="anonymous": ' + tag);
}

// o visualizador 360 continua sendo carregado por XHR (pannellum) -- se isso mudar, rever o motivo acima
const principal = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'js', 'main.js'), 'utf8');
assert.ok(/pannellum\.viewer\('painelPanoramaCliente'/.test(principal));

console.log('OK teste_cors_previa: prévia da planta usa crossorigin="anonymous" (' + imgsDeFoto.length + ' img)');
