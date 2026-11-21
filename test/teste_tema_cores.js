// Cor de destaque do site do cliente: (1) a matemática (contraste legível no escuro e no claro, para QUALQUER cor), (2) o CSS gerado e a
// injeção na página, (3) o style.css traz o visual padrão intacto e os botões usam as variáveis de destaque, (4) o arquivo do app é
// idêntico ao do site, (5) HTTP de verdade: rota da conta, validação, posse, o que o cliente recebe e que ícone/logo/nome não se perdem.
// Portas livres aleatórias (nunca a 4102, que é do servidor de teste do Rodrigo).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');

const T = require('../public/assets/js/tema-cores.js');
const ok = (m) => console.log('OK  ' + m);

// ---------- 1) matemática ----------
assert.strictEqual(T.normalizarHex('#4A86D8'), '#4a86d8');
assert.strictEqual(T.normalizarHex('4a86d8'), '#4a86d8');
assert.strictEqual(T.normalizarHex('#abc'), '#aabbcc');
['', null, undefined, 'azul', '#12', '#12345', '#1234567', '#gggggg', 'rgb(1,2,3)'].forEach((v) => assert.strictEqual(T.normalizarHex(v), null, String(v)));
assert.strictEqual(T.variaveis('azul'), null);
assert.strictEqual(T.css(null), '');
assert.strictEqual(T.css('lixo'), '');
ok('normalizarHex aceita só cores válidas; cor inválida não gera CSS');

const ESC = { pagina: '#0b0c0e', cartao: '#141618', cartao2: '#1c1f22' };
const CLA = { pagina: '#f5f2ec', cartao2: '#f0ece3' };
const amostra = T.MODELOS.filter((m) => m.cor).map((m) => m.cor).concat(['#000000', '#ffffff', '#808080', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#7f7f7f', '#101010', '#f0f0f0']);
let semente = 12345; const aleatorio = () => { semente = (semente * 1664525 + 1013904223) % 4294967296; return semente / 4294967296; };
for (let i = 0; i < 4000; i++) amostra.push('#' + Math.floor(aleatorio() * 16777216).toString(16).padStart(6, '0'));
let piorBotaoEscuro = 99, piorTextoBotaoEscuro = 99, piorBotaoClaro = 99, piorTextoBotaoClaro = 99, piorLinkEscuro = 99, piorLinkClaro = 99;
amostra.forEach((cor) => {
  const v = T.variaveis(cor);
  piorBotaoEscuro = Math.min(piorBotaoEscuro, T.contraste(v.escuro.destaque, ESC.cartao));
  piorTextoBotaoEscuro = Math.min(piorTextoBotaoEscuro, T.contraste(v.escuro.onDestaque, v.escuro.destaque));
  piorLinkEscuro = Math.min(piorLinkEscuro, T.contraste(v.escuro.steel300, ESC.cartao2));
  piorBotaoClaro = Math.min(piorBotaoClaro, T.contraste(v.claro.destaque, CLA.pagina));
  piorTextoBotaoClaro = Math.min(piorTextoBotaoClaro, T.contraste(v.claro.onDestaque, v.claro.destaque));
  piorLinkClaro = Math.min(piorLinkClaro, T.contraste(v.claro.steel300, CLA.cartao2));
  assert.ok(/^#[0-9a-f]{6}$/.test(v.escuro.destaque) && /^#[0-9a-f]{6}$/.test(v.claro.destaque), 'hex válido ' + cor);
});
assert.ok(piorBotaoEscuro >= 2.95, 'botão visível no escuro: ' + piorBotaoEscuro);
assert.ok(piorBotaoClaro >= 4.49, 'botão visível no claro: ' + piorBotaoClaro);
assert.ok(piorLinkEscuro >= 4.49 && piorLinkClaro >= 4.49, `links/ícones legíveis: ${piorLinkEscuro} / ${piorLinkClaro}`);
assert.ok(piorTextoBotaoEscuro >= 4.2 && piorTextoBotaoClaro >= 4.2, `texto do botão legível: ${piorTextoBotaoEscuro} / ${piorTextoBotaoClaro}`);
ok(`contraste garantido em ${amostra.length} cores (inclui preto, branco e cinza): botão ≥3 (escuro) e ≥4,5 (claro), links ≥4,5, texto do botão ≥4,2`);

// o matiz é preservado (azul continua azul) -- não vira cinza
const vAzul = T.variaveis('#4a86d8');
const maior = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const [r1, , b1] = maior(vAzul.escuro.destaque); const [r2, , b2] = maior(vAzul.claro.destaque);
assert.ok(b1 > r1 && b2 > r2, 'azul continua azul nos dois temas');
ok('o matiz da cor escolhida é preservado nos dois temas');

// ---------- 2) CSS gerado e injeção ----------
const css = T.css('#d2764f');
assert.ok(css.startsWith('body{') && css.includes('body.visual-novo[data-tema="claro"]{') && css.includes('@media (prefers-color-scheme: light){body.visual-novo:not([data-tema="escuro"]){') && css.includes('.visualizador,.modal-historico{'), 'os 4 contextos de tema');
['--destaque:', '--on-destaque:', '--destaque-hover:', '--steel-300:', '--steel-500:', '--steel-grad:', '--on-steel:'].forEach((v) => assert.ok(css.includes(v), v));
assert.ok(!/--steel-100|--bg|--text|--line|--green/.test(css), 'não mexe em fundo, texto, linhas nem no verde de aprovado');
ok('o CSS cobre escuro, claro (manual e automático) e as telas sempre escuras, sem tocar em fundo/texto');

const filhos = {};
const docFalso = {
  head: { appendChild: (el) => { filhos[el.id] = el; el.parentNode = docFalso.head; } , removeChild: (el) => { delete filhos[el.id]; el.parentNode = null; } },
  getElementById: (id) => filhos[id] || null,
  createElement: () => ({ id: '', textContent: '' })
};
assert.strictEqual(T.aplicar({ destaque: '#4a86d8' }, docFalso), true);
assert.ok(filhos['cores-conta'].textContent.includes('#'), 'injetou o <style>');
const antes = filhos['cores-conta'];
T.aplicar({ destaque: '#d2764f' }, docFalso);
assert.strictEqual(filhos['cores-conta'], antes, 'reaproveita o mesmo <style>');
assert.ok(antes.textContent.includes(T.variaveis('#d2764f').escuro.destaque));
assert.strictEqual(T.aplicar({ destaque: null }, docFalso), false);
assert.strictEqual(filhos['cores-conta'], undefined, 'sem cor: remove o <style> e o site volta ao padrão');
assert.strictEqual(T.aplicar(undefined, docFalso), false);
assert.strictEqual(T.aplicar({ destaque: 'lixo' }, docFalso), false);
ok('aplicar injeta, troca e remove o <style>; cor ausente/inválida deixa o site padrão');

// ---------- 3) style.css ----------
const style = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'css', 'style.css'), 'utf8');
assert.ok(style.includes('--destaque:#f4f5f7; --on-destaque:#0b0c0e; --destaque-hover:#c7cbd1;'), 'padrão escuro = o cinza-aço de sempre');
assert.strictEqual((style.match(/--destaque:#1b1c1e; --on-destaque:#f5f2ec; --destaque-hover:#4a4e55;/g) || []).length, 2, 'padrão claro (manual e automático)');
assert.ok(/\.visualizador, \.modal-historico\{[^}]*--destaque:#f4f5f7/.test(style), 'telas sempre escuras têm o padrão');
['.hub-doc-abrir{', '.pdf-progresso-barra{', '.ajuda-botao{', '.orc-botao.principal{', '.btn-voltar-projeto{'].forEach((seletor) => {
  const i = style.indexOf(seletor); assert.ok(i >= 0, seletor);
  assert.ok(style.slice(i, i + 220).includes('var(--destaque)'), seletor + ' usa a cor de destaque');
});
assert.ok(!/background:var\(--steel-100\); *color:var\(--bg\)/.test(style), 'nenhum botão ficou preso ao cinza antigo');
['index.html', 'orcamentos.html'].forEach((pg) => assert.ok(fs.readFileSync(path.join(__dirname, '..', 'public', pg), 'utf8').includes('<script src="assets/js/tema-cores.js"></script>'), pg + ' carrega o tema-cores.js'));
const mainJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'js', 'main.js'), 'utf8');
assert.ok(mainJs.includes('TemaCores.aplicar(galeria.coresEscritorio)') && mainJs.includes('TemaCores.aplicar(info.cores)'), 'galeria e login aplicam a cor');
assert.ok(fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'js', 'orcamentos.js'), 'utf8').includes('TemaCores.aplicar(info.cores)'), 'orçamentos aplica a cor');
ok('style.css: padrão intacto, botões usam a cor de destaque; as páginas carregam e aplicam o tema-cores.js');

// ---------- 4) arquivo igual no app ----------
const noApp = path.join(__dirname, '..', '..', 'skp-to-360-ia', 'renderer', 'tema-cores.js');
if (fs.existsSync(noApp)) {
  assert.strictEqual(fs.readFileSync(noApp, 'utf8').replace(/\r\n/g, '\n'), fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'js', 'tema-cores.js'), 'utf8').replace(/\r\n/g, '\n'), 'o tema-cores.js do app é idêntico ao do site');
  ok('tema-cores.js do app idêntico ao do site');
}

// ---------- 5) lógica do servidor + HTTP ----------
const galeria = require('../lib/galeria.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-tema-cores-'));
const CAMINHO_LOGICA = path.join(TMP, 'logica.json');
assert.deepStrictEqual(galeria.coresEscritorioDaLicenca(galeria.lerEstado(CAMINHO_LOGICA), 'A'), { destaque: null, modelo: '' });
assert.deepStrictEqual(galeria.definirCoresEscritorio(CAMINHO_LOGICA, 'A', { destaque: ' #4A86D8 ', modelo: 'azul' }), { destaque: '#4a86d8', modelo: 'azul' });
galeria.definirDadosEscritorio(CAMINHO_LOGICA, 'A', { nome: 'Escritório A' });
assert.deepStrictEqual(galeria.coresEscritorioDaLicenca(galeria.lerEstado(CAMINHO_LOGICA), 'A'), { destaque: '#4a86d8', modelo: 'azul' }, 'salvar nome/contatos não apaga a cor');
galeria.definirArquivoPerfil(CAMINHO_LOGICA, 'A', 'icone', 'perfis/x/icone-1.png');
assert.deepStrictEqual(galeria.coresEscritorioDaLicenca(galeria.lerEstado(CAMINHO_LOGICA), 'A'), { destaque: '#4a86d8', modelo: 'azul' }, 'enviar ícone não apaga a cor');
galeria.definirCoresEscritorio(CAMINHO_LOGICA, 'A', { destaque: '#d2764f' });
assert.strictEqual(galeria.lerPerfil(CAMINHO_LOGICA, 'A').icone.r2Key, 'perfis/x/icone-1.png', 'trocar a cor não apaga o ícone');
assert.strictEqual(galeria.coresEscritorioDaLicenca(galeria.lerEstado(CAMINHO_LOGICA), 'B').destaque, null, 'outra conta não herda');
['azul', '#12', 123, {}, '#gggggg', 'rgb(1,2,3)'].forEach((v) => assert.throws(() => galeria.definirCoresEscritorio(CAMINHO_LOGICA, 'A', { destaque: v }), /Cor inválida/, String(v)));
['Modelo Ruim', 'a'.repeat(31), 5].forEach((m) => assert.throws(() => galeria.definirCoresEscritorio(CAMINHO_LOGICA, 'A', { destaque: '#4a86d8', modelo: m }), /Modelo de cor inválido/, String(m)));
assert.strictEqual(galeria.coresEscritorioDaLicenca(galeria.lerEstado(CAMINHO_LOGICA), 'A').destaque, '#d2764f', 'valor inválido não gravou nada');
assert.deepStrictEqual(galeria.definirCoresEscritorio(CAMINHO_LOGICA, 'A', { destaque: null }), { destaque: null, modelo: '' });
// arquivo antigo/estranho no disco: nunca vira cor
const estadoRuim = galeria.lerEstado(CAMINHO_LOGICA); estadoRuim.perfis.Z = { cores: { destaque: 'url(javascript:x)', modelo: '<b>' } }; galeria.salvarEstado ? galeria.salvarEstado(CAMINHO_LOGICA, estadoRuim) : fs.writeFileSync(CAMINHO_LOGICA, JSON.stringify(estadoRuim));
assert.deepStrictEqual(galeria.coresEscritorioDaLicenca(galeria.lerEstado(CAMINHO_LOGICA), 'Z'), { destaque: null, modelo: '' }, 'valor estranho gravado no disco é ignorado (nunca vai pro CSS)');
ok('servidor (lógica): valida #rrggbb, guarda por conta, não apaga ícone/logo/nome, e ignora lixo no disco');

function portaLivre() {
  return new Promise((resolve, reject) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); s.on('error', reject); });
}
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

(async () => {
  const licenca = http.createServer((req, res) => {
    let corpo = ''; req.on('data', (c) => { corpo += c; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      let token = null; try { token = JSON.parse(corpo).token; } catch (e) { /* vazio */ }
      const usuario = { tokA: 'arqA', tokB: 'arqB' }[token];
      res.end(JSON.stringify(usuario ? { valida: true, usuario, limiteFotos: 50 } : { valida: false, motivo: 'Sessão inválida.' }));
    });
  });
  await new Promise((r) => licenca.listen(0, '127.0.0.1', r));
  const porta = await portaLivre();
  const filho = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: path.join(__dirname, '..'),
    env: Object.assign({}, process.env, { PORT: String(porta), DADOS_DIR: TMP, ARMAZENAMENTO_LOCAL_TESTE: '1', ARMAZENAMENTO_LOCAL_DIR: path.join(TMP, 'armazenamento'), LICENCA_SERVIDOR_URL: `http://127.0.0.1:${licenca.address().port}` })
  });
  let saida = ''; filho.stdout.on('data', (d) => { saida += d; }); filho.stderr.on('data', (d) => { saida += d; });
  await new Promise((resolve, reject) => { const t0 = Date.now(); const iv = setInterval(() => { if (/rodando na porta/.test(saida)) { clearInterval(iv); resolve(); } else if (Date.now() - t0 > 15000) { clearInterval(iv); reject(new Error('o servidor não subiu: ' + saida)); } }, 100); });
  const BASE = `http://127.0.0.1:${porta}`;
  const encerrar = () => { try { filho.kill(); } catch (e) { /* já foi */ } licenca.close(); };
  const api = async (metodo, caminho, token, corpo) => {
    const opcoes = { method: metodo, headers: {} };
    if (token) opcoes.headers['x-sessao-token'] = token;
    if (corpo instanceof FormData) opcoes.body = corpo; else if (corpo !== undefined) { opcoes.headers['Content-Type'] = 'application/json'; opcoes.body = JSON.stringify(corpo); }
    const r = await fetch(BASE + caminho, opcoes); let json = null; try { json = await r.json(); } catch (e) { /* sem corpo */ }
    return { status: r.status, json };
  };
  try {
    assert.strictEqual((await api('PUT', '/api/app/perfil/cores', null, { destaque: '#4a86d8' })).status, 401, 'sem sessão');
    assert.strictEqual((await api('PUT', '/api/app/perfil/cores', 'invalido', { destaque: '#4a86d8' })).status, 401);
    let r = await api('GET', '/api/app/perfil', 'tokA');
    assert.deepStrictEqual(r.json.cores, { destaque: null, modelo: '' }, 'começa sem cor');
    for (const ruim of ['azul', '#12', 'rgb(1,2,3)', '<script>', 123]) {
      r = await api('PUT', '/api/app/perfil/cores', 'tokA', { destaque: ruim });
      assert.strictEqual(r.status, 400, String(ruim)); assert.match(r.json.erro, /Cor inválida/);
    }
    r = await api('PUT', '/api/app/perfil/cores', 'tokA', { destaque: '#4a86d8', modelo: 'Modelo Ruim' });
    assert.strictEqual(r.status, 400); assert.match(r.json.erro, /Modelo/);
    assert.strictEqual((await api('GET', '/api/app/perfil', 'tokA')).json.cores.destaque, null, 'pedido recusado não gravou nada');
    ok('HTTP: sem sessão = 401; cor ou modelo inválido = 400 e nada é gravado');

    // projetos das duas contas + um ícone na conta A (pra provar que a cor não o derruba)
    const criar = (token, projetoId, usuario) => api('POST', '/api/app/galeria', token, { projetoId, nomeProjeto: 'P ' + projetoId, clienteUsuario: usuario, clienteSenha: 'senha1234' });
    const gA = await criar('tokA', 'projA', 'clienteA'); const gB = await criar('tokB', 'projB', 'clienteB');
    const f = new FormData(); f.append('arquivo', new Blob([PNG], { type: 'image/png' }), 'i.png');
    assert.strictEqual((await api('POST', '/api/app/perfil/icone', 'tokA', f)).status, 200);

    r = await api('PUT', '/api/app/perfil/cores', 'tokA', { destaque: '#D2764F', modelo: 'terracota' });
    assert.strictEqual(r.status, 200); assert.deepStrictEqual(r.json.cores, { destaque: '#d2764f', modelo: 'terracota' });
    r = await api('GET', '/api/app/perfil', 'tokA');
    assert.deepStrictEqual(r.json.cores, { destaque: '#d2764f', modelo: 'terracota' }); assert.strictEqual(r.json.icone.existe, true, 'o ícone continua');
    assert.deepStrictEqual((await api('GET', '/api/app/perfil', 'tokB')).json.cores, { destaque: null, modelo: '' }, 'a conta B não herda a cor da A');
    ok('HTTP: a cor fica na conta (normalizada), o ícone continua, e a outra conta não herda');

    // o que o app e o cliente recebem
    assert.deepStrictEqual((await api('GET', '/api/app/galeria/projA', 'tokA')).json.coresEscritorio, { destaque: '#d2764f', modelo: 'terracota' });
    assert.deepStrictEqual((await api('GET', '/api/app/galeria/projB', 'tokB')).json.coresEscritorio, { destaque: null, modelo: '' });
    let info = await (await fetch(`${BASE}/api/cliente/${gA.json.linkToken}/info-publica`)).json();
    assert.deepStrictEqual(info.cores, { destaque: '#d2764f', modelo: 'terracota' }, 'a tela de login já recebe a cor');
    info = await (await fetch(`${BASE}/api/cliente/${gB.json.linkToken}/info-publica`)).json();
    assert.strictEqual(info.cores.destaque, null, 'projeto de conta sem cor = padrão');
    const login = await (await fetch(`${BASE}/api/cliente/${gA.json.linkToken}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario: 'clienteA', senha: 'senha1234' }) })).json();
    assert.ok(login.token, 'login do cliente');
    const gCli = await (await fetch(`${BASE}/api/cliente/${gA.json.linkToken}/galeria`, { headers: { 'x-cliente-token': login.token } })).json();
    assert.deepStrictEqual(gCli.coresEscritorio, { destaque: '#d2764f', modelo: 'terracota' }, 'o cliente logado recebe a cor');
    ok('HTTP: o login do cliente e a galeria do cliente recebem a cor da conta do dono (e o app também)');

    // trocar a cor vale na hora pra projetos já existentes; null volta ao padrão
    await api('PUT', '/api/app/perfil/cores', 'tokA', { destaque: '#4a86d8', modelo: 'azul' });
    assert.strictEqual((await (await fetch(`${BASE}/api/cliente/${gA.json.linkToken}/info-publica`)).json()).cores.destaque, '#4a86d8', 'projeto já enviado muda sem reenviar');
    r = await api('PUT', '/api/app/perfil/cores', 'tokA', { destaque: null });
    assert.deepStrictEqual(r.json.cores, { destaque: null, modelo: '' });
    assert.strictEqual((await (await fetch(`${BASE}/api/cliente/${gA.json.linkToken}/info-publica`)).json()).cores.destaque, null);
    // nome/contatos depois da cor não a apagam
    await api('PUT', '/api/app/perfil/cores', 'tokA', { destaque: '#8d77d6', modelo: 'lilas' });
    r = await api('PUT', '/api/app/perfil/nome', 'tokA', { nome: 'Escritório A' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual((await api('GET', '/api/app/perfil', 'tokA')).json.cores.destaque, '#8d77d6', 'salvar o nome do escritório não apaga a cor');
    ok('HTTP: projeto já enviado muda na hora; null volta ao padrão; salvar o nome do escritório não apaga a cor');

    // a página do cliente de verdade serve o script e o CSS novos
    assert.strictEqual((await fetch(`${BASE}/assets/js/tema-cores.js`)).status, 200);
    assert.ok((await (await fetch(`${BASE}/assets/css/style.css`)).text()).includes('--destaque:#f4f5f7'));
    assert.ok((await (await fetch(`${BASE}/?g=${gA.json.linkToken}`)).text()).includes('tema-cores.js'));
    ok('o servidor entrega o tema-cores.js, o CSS novo e a página com o script');
    encerrar();
    console.log('\nTudo certo: cor de destaque do site do cliente.');
  } catch (e) {
    encerrar();
    console.error(e);
    console.error('--- saída do servidor ---\n' + saida.slice(-1500));
    process.exit(1);
  }
})();
