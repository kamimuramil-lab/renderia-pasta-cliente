// Hub do cliente: Memorial vazio vira cartão "Em breve" (só se o dono tem o recurso) e a linha de baixo segue a ordem
// Fotos, Projeto executivo, Memorial. Teste de ligações no código (a página roda só no navegador).
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const hub = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'js', 'hub.js'), 'utf8');
const servidor = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

// Ordem da linha de baixo: visitas (Fotos) -> executivo -> memorial
const iVisitas = hub.indexOf("['visitas', 'executivo'].forEach");
const iMemorial = hub.indexOf("id: 'memorial', icone: ICONES.memorial");
assert.ok(iVisitas > 0 && iMemorial > iVisitas, 'Fotos e Executivo vêm antes do Memorial');
assert.ok(!hub.includes("['executivo', 'visitas'].forEach"), 'a ordem antiga saiu');

// Memorial sem item: aparece apagado "Em breve" só quando o servidor diz que o recurso existe
assert.ok(/nMem > 0 \|\| mem\.disponivel === true/.test(hub), 'cartão aparece com itens OU com o recurso disponível');
assert.ok(/ativo: nMem > 0/.test(hub) && /: 'Em breve' \}\)\);\s*\n\s*\n/.test(hub), 'sem itens fica desabilitado e com "Em breve"');

// Servidor: `disponivel` só dentro do bloco de quem tem o recurso
const bloco = servidor.slice(servidor.indexOf('if (novoVisual && recursosVivos.memorial === true)'));
assert.ok(bloco.slice(0, 600).includes('disponivel: true'), 'servidor marca disponivel só com o recurso');
assert.ok(!/let memorialCliente = \{[^}]*disponivel/.test(servidor), 'sem o recurso o memorial vazio NÃO leva disponivel');

console.log('OK teste_cartao_memorial_em_breve');
