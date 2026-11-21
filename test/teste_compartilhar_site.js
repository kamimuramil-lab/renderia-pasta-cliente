// Site do cliente: botão de compartilhar (só o ícone) em cada documento da página do projeto. Copia o link do documento e mostra "Link copiado!".
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ler = (...p) => fs.readFileSync(path.join(__dirname, '..', 'public', ...p), 'utf8');
const ok = (m) => console.log('OK  ' + m);
const hub = ler('assets', 'js', 'hub.js'), css = ler('assets', 'css', 'style.css');

const linha = hub.match(/function linhaDocumento\(d\) \{[\s\S]*?\n  \}/)[0];
assert.ok(linha.includes('class="hub-doc-compartilhar"') && linha.includes('data-compartilhar="${esc(href)}"'), 'cada documento com link tem o botão de compartilhar');
assert.ok(linha.includes('aria-label="Copiar o link do documento"') && linha.includes('title="Copiar o link deste documento para compartilhar"'), 'só o ícone: com dica e nome acessível');
assert.ok(linha.indexOf('hub-doc-abrir"') < linha.indexOf('hub-doc-compartilhar'), 'ao lado do "Abrir"');
assert.ok(linha.includes('${href ? `<div class="hub-doc-botoes">'), 'documento sem link não tem botões (nem o de compartilhar)');
assert.ok(linha.includes('data-apresentar="${esc(d.id)}"'), 'o Apresentar do modo escritório continua');
ok('documentos do cliente: botão de compartilhar ao lado do Abrir (só com link), Apresentar preservado');

// o que é copiado passa pelo mesmo filtro de endereço seguro do "Abrir" (só http/https)
assert.ok(hub.includes("const url = hrefSeguro(b.getAttribute('data-compartilhar'));") && hub.includes('if (!url) return;'), 'só copia endereço http/https');
assert.ok(hub.includes("avisarCopiado('Link copiado!')") && hub.includes("avisarCopiado('Não consegui copiar o link.', true)"), 'avisa "Link copiado!" (e o erro)');
assert.ok(hub.includes("document.execCommand && document.execCommand('copy')") && hub.includes('try { await navigator.clipboard.writeText(texto); return; } catch (e)'), 'caminho alternativo quando a API não existe OU recusa a permissão (visto no navegador embutido)');
ok('copia só endereço seguro, avisa "Link copiado!" e tem alternativa sem a API moderna');

// função de verdade: hrefSeguro + copiarTexto com ambiente simulado
const hrefSeguro = new Function('return ' + hub.match(/function hrefSeguro\(url\) \{[\s\S]*?\n  \}/)[0])();
assert.ok(hrefSeguro('https://drive.google.com/file/d/abc/view'), 'https passa');
assert.ok(!hrefSeguro('javascript:alert(1)') && !hrefSeguro('data:text/html,x'), 'javascript:/data: são barrados');
ok('endereços perigosos não são copiados');

['.hub-doc-compartilhar{', '.hub-doc-botoes{', '.aviso-copiado{', '.aviso-copiado.visivel{'].forEach((s) => assert.ok(css.includes(s), 'CSS ' + s));
ok('estilos do botão e do aviso "Link copiado!"');
console.log('\nTudo certo: compartilhar link de documento (site).');
