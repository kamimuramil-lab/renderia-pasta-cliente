// Textos escritos em cima da planta (nome dos ambientes etc.): validação e gravação no servidor, rota HTTP real (posse, limites),
// desenho idêntico no app e no site (arquivo compartilhado) e a ligação nas duas telas.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');
const galeria = require('../lib/galeria');
const PT = require('../public/assets/js/planta-textos.js');
const ok = (m) => console.log('OK  ' + m);

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-textos-planta-'));
const CAM = path.join(TMP, 'dados.json');
const DONO = 'arqA';
galeria.criarOuAtualizarGaleria(CAM, { projetoId: 'p1', licencaUsuario: DONO, nomeProjeto: 'P1', clienteUsuario: 'cli', clienteSenha: 'senha1234' });
const planta = galeria.adicionarPlanta(CAM, 'p1', { nome: 'Térreo', r2Key: 'p1/planta.png' }, DONO);
assert.deepStrictEqual(galeria.lerEstado(CAM).galerias[0].plantas[0].textos, [], 'planta nova (e antiga) nasce com textos vazio');

// ---- validação e normalização
const completo = { texto: '  COZINHA  ', x: 0.4, y: 0.6, tamanho: 0.02, cor: '#FFFFFF', fundo: '#000000', fundoOpacidade: 0.5, contorno: '#112233', negrito: false };
let r = galeria.definirTextosDaPlanta(CAM, 'p1', planta.id, [completo, { texto: 'SALA\nde estar', x: 2, y: -1, tamanho: 9 }], DONO);
assert.strictEqual(r.textos.length, 2);
assert.deepStrictEqual([r.textos[0].texto, r.textos[0].cor, r.textos[0].fundo, r.textos[0].contorno, r.textos[0].negrito, r.textos[0].fundoOpacidade], ['COZINHA', '#ffffff', '#000000', '#112233', false, 0.5], 'aparado, cores em minúsculas, opções guardadas');
assert.deepStrictEqual([r.textos[1].x, r.textos[1].y, r.textos[1].tamanho], [1, 0, 0.1], 'posição e tamanho travados nos limites');
assert.strictEqual(r.textos[1].texto, 'SALA\nde estar', 'quebra de linha preservada');
assert.strictEqual(r.textos[1].fundo, null); assert.strictEqual(r.textos[1].contorno, null); assert.strictEqual(r.textos[1].negrito, true);
assert.ok(r.textos.every((t) => /^[\w-]+$/.test(t.id)), 'cada texto tem um id');
assert.strictEqual(galeria.lerEstado(CAM).galerias[0].plantas[0].textos.length, 2, 'gravado');
ok('textos validados e normalizados (aparar, cores, limites, quebra de linha, ids)');

// lista inteira substitui a anterior; vazio apaga tudo
r = galeria.definirTextosDaPlanta(CAM, 'p1', planta.id, [{ id: 'meu_id-1', texto: 'BANHO', x: 0.1, y: 0.1, tamanho: 0.015 }], DONO);
assert.deepStrictEqual(r.textos.map((t) => [t.id, t.texto]), [['meu_id-1', 'BANHO']], 'a lista nova substitui a antiga (id válido é mantido)');
assert.strictEqual(galeria.definirTextosDaPlanta(CAM, 'p1', planta.id, [], DONO).textos.length, 0);
ok('a lista completa substitui a anterior; lista vazia apaga os textos');

// recusas: nada é gravado se UM texto for inválido
galeria.definirTextosDaPlanta(CAM, 'p1', planta.id, [{ texto: 'FICA', x: 0.5, y: 0.5, tamanho: 0.02 }], DONO);
const ruins = [
  [{ texto: '', x: 0.5, y: 0.5, tamanho: 0.02 }, /vazio/], [{ texto: '   ', x: 0.5, y: 0.5, tamanho: 0.02 }, /vazio/],
  [{ texto: 'x'.repeat(201), x: 0.5, y: 0.5, tamanho: 0.02 }, /passa de 200/], [{ texto: 'a', x: 'abc', y: 0.5, tamanho: 0.02 }, /posição x/],
  [{ texto: 'a', x: 0.5, y: null, tamanho: 0.02 }, /posição y/], [{ texto: 'a', x: 0.5, y: 0.5, tamanho: '' }, /tamanho/],
  [{ texto: 'a', x: 0.5, y: 0.5, tamanho: 0.02, cor: 'vermelho' }, /Cor da letra/], [{ texto: 'a', x: 0.5, y: 0.5, tamanho: 0.02, fundo: 'red' }, /Cor do fundo/],
  [{ texto: 'a', x: 0.5, y: 0.5, tamanho: 0.02, contorno: '#12' }, /Cor do contorno/], [null, /formato/], ['texto', /formato/]
];
ruins.forEach(([t, msg]) => assert.throws(() => galeria.definirTextosDaPlanta(CAM, 'p1', planta.id, [{ texto: 'BOM', x: 0.1, y: 0.1, tamanho: 0.02 }, t], DONO), msg));
assert.throws(() => galeria.definirTextosDaPlanta(CAM, 'p1', planta.id, 'nao-lista', DONO), /inválida/);
assert.throws(() => galeria.definirTextosDaPlanta(CAM, 'p1', planta.id, Array.from({ length: 81 }, () => ({ texto: 'a', x: 0.5, y: 0.5, tamanho: 0.02 })), DONO), /até 80/);
assert.throws(() => galeria.definirTextosDaPlanta(CAM, 'p1', planta.id, [{ id: 'igual', texto: 'a', x: 0.1, y: 0.1, tamanho: 0.02 }, { id: 'igual', texto: 'b', x: 0.2, y: 0.2, tamanho: 0.02 }], DONO), /repetidos/);
assert.throws(() => galeria.definirTextosDaPlanta(CAM, 'p1', 'planta_inexistente', [], DONO), /não encontrada/);
assert.throws(() => galeria.definirTextosDaPlanta(CAM, 'p1', planta.id, [], 'outraConta'), /não pertence/);
assert.deepStrictEqual(galeria.lerEstado(CAM).galerias[0].plantas[0].textos.map((t) => t.texto), ['FICA'], 'nenhuma recusa mexeu no que estava gravado');
ok('texto inválido (vazio, grande, número/cor ruim, formato), lista grande, ids repetidos, planta inexistente e conta errada: recusados sem gravar nada');

// ---- o desenho (arquivo compartilhado)
const estilo = PT.estilo({ x: 0.25, y: 0.5, tamanho: 0.02, cor: '#ffffff', fundo: '#000000', fundoOpacidade: 0.5, contorno: '#ff0000', negrito: true });
assert.ok(estilo.includes('left:25.000%') && estilo.includes('top:50.000%') && estilo.includes('--t:0.02') && estilo.includes('color:#ffffff') && estilo.includes('background:rgba(0, 0, 0, 0.5)') && estilo.includes('text-shadow:') && estilo.includes('font-weight:700'), 'estilo: posição, tamanho, cor, fundo com opacidade e contorno');
assert.ok(!PT.estilo({ x: 0.5, y: 0.5, tamanho: 0.02 }).includes('background') && !PT.estilo({ x: 0.5, y: 0.5, tamanho: 0.02 }).includes('text-shadow'), 'sem fundo e sem contorno: nada disso no estilo (transparente)');
assert.ok(PT.estilo({ x: 'lixo', y: undefined, tamanho: 'x', cor: '"><script>' }).includes('color:#1b1b1b'), 'valores inválidos viram o padrão, nunca quebram a tela');
const h = PT.html([{ id: 'a', texto: '<img src=x onerror=alert(1)>', x: 0.5, y: 0.5, tamanho: 0.02 }, { id: 'b', texto: '   ' }]);
assert.ok(!h.includes('<img') && h.includes('&lt;img'), 'o texto é escapado (nada de HTML do arquiteto na página do cliente)');
assert.strictEqual((h.match(/class="pl-texto/g) || []).length, 1, 'texto em branco não é desenhado');
ok('desenho do texto: estilo, transparente por padrão, valores ruins viram padrão, HTML escapado');

const appCopia = path.join(__dirname, '..', '..', 'skp-to-360-ia', 'renderer', 'planta-textos.js');
assert.strictEqual(fs.readFileSync(appCopia, 'utf8').replace(/\r\n/g, '\n'), fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'js', 'planta-textos.js'), 'utf8').replace(/\r\n/g, '\n'), 'o arquivo é idêntico no app e no site');
ok('planta-textos.js idêntico no app e no site');

// ---- ligação nas telas
const ler = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const plantaJs = ler('public', 'assets', 'js', 'planta.js'), indexHtml = ler('public', 'index.html'), css = ler('public', 'assets', 'css', 'style.css');
assert.ok(indexHtml.includes('<div class="planta-textos" id="plantaTextos"></div>') && indexHtml.indexOf('planta-textos.js') < indexHtml.indexOf('assets/js/planta.js'), 'site: camada dos textos DENTRO do palco e script carregado antes da planta');
assert.ok(plantaJs.includes("pid('plantaTextos').innerHTML = window.PlantaTextos ? window.PlantaTextos.html(atual.textos) : '';") && plantaJs.includes("palco.style.setProperty('--pw', `${ST.baseW}px`);"), 'site: desenha os textos e passa a largura da planta (o texto escala com o zoom)');
assert.ok(css.includes('.pl-texto{ position:absolute;') && css.includes('.planta-textos{ position:absolute; inset:0; pointer-events:none; }'), 'site: o texto não recebe clique (não atrapalha os ícones)');
ok('site do cliente: textos dentro do palco (acompanham o zoom), sem receber clique');

// ---- HTTP real: rota PUT, posse e o cliente recebendo os textos
const portaLivre = () => new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); });
(async () => {
  const lic = http.createServer((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); let tk = null; try { tk = JSON.parse(b).token; } catch (e) { /* */ } const u = { tokA: 'arqA', tokB: 'arqB' }[tk]; res.end(JSON.stringify(u ? { valida: true, usuario: u, limiteFotos: 50, recursos: { paginaProjeto: true } } : { valida: false })); }); });
  await new Promise((r) => lic.listen(0, '127.0.0.1', r));
  const porta = await portaLivre();
  const T2 = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-textos-http-'));
  const filho = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { cwd: path.join(__dirname, '..'), env: Object.assign({}, process.env, { PORT: String(porta), DADOS_DIR: T2, ARMAZENAMENTO_LOCAL_TESTE: '1', ARMAZENAMENTO_LOCAL_DIR: path.join(T2, 'arm'), LICENCA_SERVIDOR_URL: `http://127.0.0.1:${lic.address().port}` }) });
  let saida = ''; filho.stdout.on('data', (d) => { saida += d; }); filho.stderr.on('data', (d) => { saida += d; });
  await new Promise((resolve, reject) => { const t0 = Date.now(); const iv = setInterval(() => { if (/rodando na porta/.test(saida)) { clearInterval(iv); resolve(); } else if (Date.now() - t0 > 15000) { clearInterval(iv); reject(new Error(saida)); } }, 100); });
  const BASE = `http://127.0.0.1:${porta}`;
  try {
    const api = async (m, c, tk, corpo) => { const o = { method: m, headers: { 'x-sessao-token': tk } }; if (corpo !== undefined && !(corpo instanceof FormData)) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(corpo); } else if (corpo) o.body = corpo; const r = await fetch(BASE + c, o); let j = null; try { j = await r.json(); } catch (e) { /* */ } return { status: r.status, json: j }; };
    const g = (await api('POST', '/api/app/galeria', 'tokA', { projetoId: 'pH', nomeProjeto: 'H', clienteUsuario: 'cli', clienteSenha: 'senha1234' })).json;
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const fd = new FormData(); fd.append('arquivo', new Blob([PNG], { type: 'image/png' }), 'p.png'); fd.append('nome', 'Térreo');
    const pl = (await api('POST', '/api/app/galeria/pH/plantas', 'tokA', fd)).json.planta;
    const P = `/api/app/galeria/pH/plantas/${pl.id}/textos`;
    assert.strictEqual((await api('PUT', P, 'invalido', { textos: [] })).status, 401);
    let x = await api('PUT', P, 'tokA', { textos: [{ texto: 'COZINHA', x: 0.3, y: 0.4, tamanho: 0.02, fundo: '#ffffff', contorno: '#000000' }] });
    assert.strictEqual(x.status, 200); assert.strictEqual(x.json.planta.textos[0].texto, 'COZINHA');
    x = await api('PUT', P, 'tokA', { textos: [{ texto: '', x: 0.3, y: 0.4, tamanho: 0.02 }] });
    assert.strictEqual(x.status, 400); assert.match(x.json.erro, /vazio/);
    assert.strictEqual((await api('PUT', P, 'tokB', { textos: [] })).status, 400, 'outra conta não mexe');
    const doApp = (await api('GET', '/api/app/galeria/pH', 'tokA')).json;
    assert.strictEqual(doApp.plantas[0].textos[0].texto, 'COZINHA', 'o app lê os textos junto com a planta');
    const login = (await (await fetch(`${BASE}/api/cliente/${g.linkToken}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario: 'cli', senha: 'senha1234' }) })).json()).token;
    const doCliente = await (await fetch(`${BASE}/api/cliente/${g.linkToken}/galeria`, { headers: { 'x-cliente-token': login } })).json();
    assert.deepStrictEqual(doCliente.plantas[0].textos.map((t) => t.texto), ['COZINHA'], 'o CLIENTE recebe os textos junto com a planta');
    ok('HTTP real: o app grava e lê os textos, a validação responde 400, outra conta é recusada e o cliente recebe os textos');
  } finally { try { filho.kill(); } catch (e) { /* já foi */ } lic.close(); }
  console.log('\nTudo certo: textos em cima da planta (servidor e site).');
})().catch((e) => { console.error(e); process.exit(1); });
