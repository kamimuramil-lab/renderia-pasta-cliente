// Guarda contra DOIS bugs reais com a prévia dos ícones da planta (a foto que aparece ao passar o mouse):
// (nov/2026) carregada como <img> comum, o navegador guardava a cópia SEM cabeçalho CORS e o visualizador 360 (XHR, exige CORS) depois
// falhava com "The file ... could not be accessed";
// (25/11/2026) com <img crossorigin> a prévia podia quebrar (ícone de imagem quebrada) quando a mesma foto já estava no cache sem CORS, ou
// quando o link do armazenamento (vale 1 hora) vencia com a página aberta.
// Regra atual: nenhuma <img> recebe a URL da foto direto; a prévia vem de fetch com cache:'no-store' (não lê nem grava o cache) -> blob local,
// com uma renovação dos links se o primeiro falhar.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const arq = path.join(__dirname, '..', 'public', 'assets', 'js', 'planta.js');
const fonte = fs.readFileSync(arq, 'utf8');

const imgsDeFoto = fonte.match(/<img[^>]*\$\{escapeHtml\(f\.url\)\}[^>]*>/g) || [];
assert.ok(imgsDeFoto.length >= 1, 'não achei a <img> da prévia em planta.js (o teste precisa ser atualizado?)');
for (const tag of imgsDeFoto) {
  assert.ok(/data-src="\$\{escapeHtml\(f\.url\)\}"/.test(tag) && !/\ssrc="/.test(tag.replace(/data-src="[^"]*"/, '')), 'a <img> da prévia não pode ter src direto (só data-src): ' + tag);
  assert.ok(!/crossorigin/.test(tag), 'sem crossorigin: a prévia não usa o cache do navegador');
}
assert.ok(/fetch\(url, \{ cache: 'no-store' \}\)/.test(fonte), 'a prévia é baixada por fetch com cache:no-store');
assert.ok(/URL\.createObjectURL\(b\)/.test(fonte), 'e vira um endereço local (blob)');
assert.ok(/chamarAPI\('\/api\/cliente\/' \+ LINK_TOKEN \+ '\/galeria'\)/.test(fonte) && /ultimaRenovacaoUrls > 30000/.test(fonte), 'link vencido: renova os links (no máximo 1 vez a cada 30 s)');
assert.ok(/if \(!url\) return;/.test(fonte), 'se não deu, fica só o nome (sem ícone de imagem quebrada)');

// o visualizador 360 continua sendo carregado por XHR (pannellum) -- se isso mudar, rever o motivo acima
const principal = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'js', 'main.js'), 'utf8');
assert.ok(/pannellum\.viewer\('painelPanoramaCliente'/.test(principal));

console.log('OK teste_cors_previa: prévia da planta por fetch sem cache (' + imgsDeFoto.length + ' img), com renovação de link e sem imagem quebrada');
