// Anotações do arquiteto nas fotos (ponto + balão com texto e/ou imagem): validação, rotas HTTP reais (envio da imagem do balão, gravação da lista,
// posse, apagar arquivos órfãos), o que o cliente recebe, o PDF (HTML e desenhista de canvas) e a ligação no site e no app.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');
const galeria = require('../lib/galeria');
const I = require('../public/assets/js/imagens-pdf.js');
const AC = require('../public/assets/js/anotacoes-comum.js');
const ok = (m) => console.log('OK  ' + m);
const ler = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

// ---------------- validação (lib) ----------------
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-anotacoes-'));
const CAM = path.join(TMP, 'dados.json');
const DONO = 'arqA';
galeria.criarOuAtualizarGaleria(CAM, { projetoId: 'p1', licencaUsuario: DONO, nomeProjeto: 'P1', clienteUsuario: 'cli', clienteSenha: 'senha1234' });
galeria.adicionarFoto(CAM, 'p1', { nomeExibicao: 'Sala', tipo: 'fixa', r2Key: 'p1/sala.webp' });
galeria.adicionarFoto(CAM, 'p1', { nomeExibicao: 'Pano', tipo: '360', r2Key: 'p1/pano.webp' });
const [fixa, pano] = galeria.lerEstado(CAM).galerias[0].fotos;
assert.deepStrictEqual(fixa.anotacoes, [], 'foto (nova ou antiga) nasce com anotacoes: []');

let r = galeria.definirAnotacoesDaFoto(CAM, 'p1', fixa.id, [
  { texto: '  Trocar o painel  ', x: 0.3, y: 0.4, icone: 'alerta' },
  { texto: 'x', x: 5, y: -2, icone: 'icone-inexistente' },
  { texto: '', x: 0.5, y: 0.5, icone: 'info', imagemR2Key: `p1/anotacoes/${fixa.id}/a.webp` }
], DONO);
assert.deepStrictEqual(r.foto.anotacoes.map((a) => [a.texto, a.x, a.y, a.icone]), [['Trocar o painel', 0.3, 0.4, 'alerta'], ['x', 1, 0, 'alerta'], ['', 0.5, 0.5, 'info']], 'aparado, posição travada em 0..1, ícone inválido vira "alerta"');
assert.ok(r.foto.anotacoes.every((a) => /^[\w-]+$/.test(a.id)));
ok('validação: texto aparado, posição travada nos limites, ícone inválido vira "alerta", texto OU imagem');

const base = { texto: 'ok', x: 0.5, y: 0.5 };
const ruins = [
  [{ ...base, texto: '', imagemR2Key: null }, /escreva um texto ou escolha uma imagem/], [{ ...base, texto: 'x'.repeat(601) }, /passa de 600/],
  [{ ...base, x: 'a' }, /posição x/], [{ ...base, y: null }, /posição y/], [null, /formato/],
  [{ ...base, imagemR2Key: 'p1/anotacoes/OUTRA_FOTO/a.webp' }, /imagem inválida/], [{ ...base, imagemR2Key: 'outro_projeto/anotacoes/' + fixa.id + '/a.webp' }, /imagem inválida/],
  [{ ...base, imagemR2Key: `p1/anotacoes/${fixa.id}/../../outra.webp` }, /imagem inválida/], [{ ...base, imagemR2Key: 'p1/sala.webp' }, /imagem inválida/]
];
ruins.forEach(([a, msg]) => assert.throws(() => galeria.definirAnotacoesDaFoto(CAM, 'p1', fixa.id, [a], DONO), msg));
assert.throws(() => galeria.definirAnotacoesDaFoto(CAM, 'p1', fixa.id, Array.from({ length: 31 }, () => base), DONO), /até 30/);
assert.throws(() => galeria.definirAnotacoesDaFoto(CAM, 'p1', fixa.id, [{ ...base, id: 'igual' }, { ...base, id: 'igual' }], DONO), /repetidas/);
assert.throws(() => galeria.definirAnotacoesDaFoto(CAM, 'p1', 'foto_inexistente', [], DONO), /não encontrada/);
assert.throws(() => galeria.definirAnotacoesDaFoto(CAM, 'p1', fixa.id, [], 'outraConta'), /não pertence/);
assert.throws(() => galeria.definirAnotacoesDaFoto(CAM, 'p1', fixa.id, 'x', DONO), /inválida/);
assert.strictEqual(galeria.lerEstado(CAM).galerias[0].fotos[0].anotacoes.length, 3, 'nenhuma recusa mexeu no que estava gravado');
ok('recusas (sem gravar nada): vazia, texto grande, posição ruim, imagem de OUTRA foto/projeto, "..", arquivo que não é de anotação, 31 pontos, ids repetidos, outra conta');

// foto 360°: yaw/pitch em vez de x/y (base da próxima função)
r = galeria.definirAnotacoesDaFoto(CAM, 'p1', pano.id, [{ texto: 'olhe aqui', yaw: 200, pitch: -95 }], DONO);
assert.deepStrictEqual([r.foto.anotacoes[0].yaw, r.foto.anotacoes[0].pitch, r.foto.anotacoes[0].x], [180, -90, undefined], '360°: direção travada e sem x/y');
ok('foto 360°: guarda yaw/pitch (travados em ±180/±90)');

// imagens que saíram da lista são devolvidas pra apagar
const chave = `p1/anotacoes/${fixa.id}/b.webp`;
galeria.definirAnotacoesDaFoto(CAM, 'p1', fixa.id, [{ texto: 't', x: 0.1, y: 0.1, imagemR2Key: chave }], DONO);
assert.ok(galeria.chavesDoProjeto(CAM, 'p1', DONO).chaves.includes(chave), 'a exclusão do projeto (LGPD) inclui as imagens dos balões');
r = galeria.definirAnotacoesDaFoto(CAM, 'p1', fixa.id, [], DONO);
assert.deepStrictEqual(r.chavesRemovidas, [chave], 'imagem que saiu da lista vai pra ser apagada');
ok('imagens dos balões: entram na exclusão do projeto e as removidas da lista são devolvidas pra apagar');

// ---------------- pinos e PDF ----------------
const lista = Array.from({ length: 30 }, (_, i) => ({ x: (i + 1) / 40, y: 0.5, icone: i % 2 ? 'info' : 'alerta', texto: 'Observação ' + (i + 1) + ' '.repeat(2) + 'z'.repeat(300) }));
const n = I.normalizarAnotacoes(lista);
assert.strictEqual(n.length, 12); assert.strictEqual(n.omitidas, 18, 'no máximo 12 no PDF (a coluna lateral tem 24 mm); o resto avisa quantas ficaram de fora');
assert.ok(n.every((a) => a.texto.length <= 51), 'cada texto é cortado pra caber na coluna estreita (orçamento de caracteres)');
assert.ok(n[0].texto.endsWith('…'), 'texto cortado termina com …');
assert.deepStrictEqual(I.normalizarAnotacoes([{ x: 0.5, y: 0.5, texto: '', imagemR2Key: 'k' }])[0].texto, '(imagem anexada: veja no site)', 'só imagem: avisa que a imagem está no site');
assert.strictEqual(I.normalizarAnotacoes([{ x: 'a', y: 1 }, null, { texto: 'sem posição' }]).length, 0, 'sem posição válida não entra');
assert.deepStrictEqual(I.normalizarAnotacoes([{ x: 0.5, y: 0.5, icone: 'x', texto: 'a' }])[0].cor, '#f2b01e', 'ícone desconhecido = alerta');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const base1 = { nomeProjeto: 'P', mostrarNomes: true, ambientes: [{ nome: 'Sala', imagens: [{ id: 'a', nome: 'Sala', uri: png, paleta: [{ hex: '#aabbcc', pct: 0.5 }], anotacoes: [{ x: 0.3, y: 0.4, icone: 'alerta', texto: 'Trocar o piso <b>' }, { x: 0.7, y: 0.2, icone: 'ok', texto: 'Aprovado' }] }, { id: 'b', nome: 'Outra', uri: png, paleta: [{ hex: '#112233', pct: 1 }], anotacoes: [] }] }] };
const html = I.montarHtml(base1).html;
const paginas = html.split('<section class="pagina pagina-imagem">').slice(1);
assert.strictEqual(paginas.length, 2);
assert.strictEqual((paginas[0].match(/class="marcador"/g) || []).length, 2, 'pinos numerados em cima da foto');
assert.ok(paginas[0].includes('class="coluna-lateral"') && paginas[0].includes('class="obs-col"') && paginas[0].includes('<div class="obs-titulo">Observações</div>') && paginas[0].includes('class="paleta-v compacta"') && !paginas[0].includes('sem-paleta'), 'as observações ficam na MESMA coluna lateral da paleta (compacta, só os códigos), e a foto não perde espaço');
assert.ok(paginas[0].includes('Trocar o piso &lt;b&gt;') && !paginas[0].includes('piso <b>'), 'o texto do arquiteto é escapado no PDF');
assert.ok(!paginas[1].includes('obs-col') && !paginas[1].includes('marcador') && paginas[1].includes('class="paleta-v"') && !paginas[1].includes('compacta'), 'foto sem anotação: paleta cheia, sem observações (só a paleta, agora dentro da coluna lateral)');
ok('PDF (HTML): pinos numerados, observações na MESMA coluna da paleta (compacta), foto com o tamanho de sempre, texto escapado; foto sem anotação não muda');

const arq = ler('public', 'assets', 'js', 'pdf-arquivo.js');
assert.ok(arq.includes('const maxW = temLateral ? 253 : 281;') && !arq.includes('const maxW = 281 - extra;') && arq.includes('const compacta = anot.length > 0;') && arq.includes("im.anotacoesOk = I.normalizarAnotacoes ? I.normalizarAnotacoes(im.anotacoes) : []"), 'PDF desenhado no navegador: a foto mantém o tamanho de sempre (253 mm com coluna lateral), paleta compacta e a MESMA normalização');
assert.ok(arq.includes("pc.linha('OBSERVAÇÕES'") && arq.includes("' no site'"), 'título da coluna e aviso "+ N no site"');
const appCopia = path.join(__dirname, '..', '..', 'skp-to-360-ia');
const igual = (a, b) => fs.readFileSync(a, 'utf8').replace(/\r\n/g, '\n') === fs.readFileSync(b, 'utf8').replace(/\r\n/g, '\n');
assert.ok(igual(path.join(appCopia, 'lib', 'imagens-pdf.js'), path.join(__dirname, '..', 'public', 'assets', 'js', 'imagens-pdf.js')), 'imagens-pdf.js idêntico no app e no site');
assert.ok(igual(path.join(appCopia, 'renderer', 'anotacoes-comum.js'), path.join(__dirname, '..', 'public', 'assets', 'js', 'anotacoes-comum.js')), 'anotacoes-comum.js idêntico no app e no site');
assert.ok(ler('public', 'assets', 'js', 'pdf-cliente.js').includes('anotacoes: f.anotacoes || [] });') && fs.readFileSync(path.join(appCopia, 'main.js'), 'utf8').includes('anotacoes: f.anotacoes || [] });'), 'site e app mandam as anotações da foto pro PDF');
ok('PDF: o desenhista de canvas segue o mesmo layout (foto sem encolher); arquivos compartilhados idênticos; site e app levam as anotações pro PDF');

const pino = AC.htmlPino({ id: 'x"><script>', icone: 'alerta' }, 3, 'left:1%;');
assert.ok(!pino.includes('<script>') && pino.includes('>3<') && pino.includes('Anotação 3'), 'pino escapado e numerado');
const balao = AC.htmlBalao({ id: 'a', icone: 'info', texto: '<img onerror=x>', imagemUrl: 'https://x/y.webp' }, 2);
assert.ok(!balao.includes('<img onerror') && balao.includes('crossorigin="anonymous"') && balao.includes('2. Informação'), 'balão: texto escapado, imagem com crossorigin, título numerado');
ok('pino e balão: HTML escapado, numerados');

// ---------------- site: visualizador ----------------
const idx = ler('public', 'index.html'), main = ler('public', 'assets', 'js', 'main.js'), css = ler('public', 'assets', 'css', 'style.css');
assert.ok(idx.includes('id="camadaAnotacoes"') && idx.includes('id="balaoAnotacao"') && idx.includes('id="btnVisualizadorAnotacoes"'), 'camada, balão e botão no visualizador');
assert.ok(idx.indexOf('anotacoes-comum.js') < idx.indexOf('anotacoes-foto.js') && idx.indexOf('anotacoes-foto.js') < idx.indexOf('assets/js/main.js'), 'scripts na ordem certa');
assert.ok(main.includes('window.AnotacoesFoto.mostrar(foto); };') && main.includes("window.AnotacoesFoto.mostrar(foto.__ehMood ? foto : null)"), 'foto fixa: pinos quando a imagem carrega, e limpa ao trocar de foto');
assert.ok(main.includes('window.AnotacoesFoto.mostrar(foto, estado.visualizadorPanorama);'), '360°: passa o visualizador do pannellum, onde os pontos entram');
const af = ler('public', 'assets', 'js', 'anotacoes-foto.js');
assert.ok(af.includes("type: 'custom', cssClass: 'an-hotspot'") && af.includes('ST.viewer.addHotSpot(h)') && af.includes('ST.viewer.removeHotSpot(h.id)') && af.includes('viewer.isLoaded()') && af.includes("viewer.on('load', pronto)"), '360°: os pontos são hotSpots do pannellum (yaw/pitch), colocados quando a cena carrega');
assert.ok(af.includes('Number.isFinite(a.yaw) && Number.isFinite(a.pitch)') && af.includes('if (ST.viewer === viewer) poePontos360();'), '360°: só pontos com direção válida, e nunca num visualizador que já foi trocado');
assert.ok(af.includes('rp.left + rp.width / 2 - ra.left') && css.includes('.an-hotspot{ width:30px; height:30px;') && css.includes('.an-hotspot .an-pino{ position:relative;'), 'balão ancorado no pino pela posição real na tela (vale pra fixa e pro 360°); pino do 360° dentro do ponto do pannellum');
['.camada-anotacoes{', '.an-pino{', '.an-balao{', '.btn-canto-anotacoes{'].forEach((s) => assert.ok(css.includes(s), 'CSS ' + s));
ok('site: pinos e balão no visualizador, botão de mostrar/esconder, scripts na ordem');

// ---------------- HTTP real ----------------
const portaLivre = () => new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
(async () => {
  const lic = http.createServer((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); let tk = null; try { tk = JSON.parse(b).token; } catch (e) { /* */ } const u = { tokA: 'arqA', tokB: 'arqB' }[tk]; res.end(JSON.stringify(u ? { valida: true, usuario: u, limiteFotos: 50, recursos: { paginaProjeto: true } } : { valida: false })); }); });
  await new Promise((r) => lic.listen(0, '127.0.0.1', r));
  const porta = await portaLivre();
  const T2 = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-anotacoes-http-'));
  const ARM = path.join(T2, 'arm');
  const filho = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { cwd: path.join(__dirname, '..'), env: Object.assign({}, process.env, { PORT: String(porta), DADOS_DIR: T2, ARMAZENAMENTO_LOCAL_TESTE: '1', ARMAZENAMENTO_LOCAL_DIR: ARM, LICENCA_SERVIDOR_URL: `http://127.0.0.1:${lic.address().port}` }) });
  let saida = ''; filho.stdout.on('data', (d) => { saida += d; }); filho.stderr.on('data', (d) => { saida += d; });
  await new Promise((resolve, reject) => { const t0 = Date.now(); const iv = setInterval(() => { if (/rodando na porta/.test(saida)) { clearInterval(iv); resolve(); } else if (Date.now() - t0 > 15000) { clearInterval(iv); reject(new Error(saida)); } }, 100); });
  const BASE = `http://127.0.0.1:${porta}`;
  try {
    const api = async (m, c, tk, corpo) => { const o = { method: m, headers: { 'x-sessao-token': tk } }; if (corpo instanceof FormData) o.body = corpo; else if (corpo !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(corpo); } const rr = await fetch(BASE + c, o); let j = null; try { j = await rr.json(); } catch (e) { /* */ } return { status: rr.status, json: j }; };
    const arquivo = (buf, tipo) => { const f = new FormData(); f.append('arquivo', new Blob([buf], { type: tipo || 'image/png' }), 'a.png'); return f; };
    const g = (await api('POST', '/api/app/galeria', 'tokA', { projetoId: 'pH', nomeProjeto: 'H', clienteUsuario: 'cli', clienteSenha: 'senha1234' })).json;
    const fd = arquivo(Buffer.from('RIFF....WEBPfake'), 'image/webp'); fd.append('nomeExibicao', 'Sala'); fd.append('tipo', 'fixa');
    const foto = (await api('POST', '/api/app/galeria/pH/fotos', 'tokA', fd)).json.foto;
    const R = `/api/app/galeria/pH/fotos/${foto.id}/anotacoes`;
    // enviar a imagem do balão
    assert.strictEqual((await api('POST', R + '/imagem', 'invalido', arquivo(PNG))).status, 401);
    let x = await api('POST', R + '/imagem', 'tokA', arquivo(Buffer.from('<html>nao sou imagem</html>')));
    assert.strictEqual(x.status, 400); assert.match(x.json.erro, /PNG, JPG ou WebP/);
    assert.strictEqual((await api('POST', R + '/imagem', 'tokA', new FormData())).status, 400);
    assert.strictEqual((await api('POST', R + '/imagem', 'tokB', arquivo(PNG))).status, 400, 'outra conta não envia imagem pra foto alheia');
    assert.strictEqual((await api('POST', `/api/app/galeria/pH/fotos/foto_x/anotacoes/imagem`, 'tokA', arquivo(PNG))).status, 400, 'foto inexistente');
    x = await api('POST', R + '/imagem', 'tokA', arquivo(PNG));
    assert.strictEqual(x.status, 200); assert.ok(x.json.imagemR2Key.startsWith(`pH/anotacoes/${foto.id}/`) && x.json.imagemR2Key.endsWith('.png'), 'a chave fica na pasta daquela foto, com a extensão pelos BYTES');
    const k1 = x.json.imagemR2Key;
    assert.ok(fs.existsSync(path.join(ARM, k1)), 'arquivo gravado');
    // gravar a lista
    x = await api('PUT', R, 'tokA', { anotacoes: [{ texto: 'Trocar o painel', x: 0.4, y: 0.5, icone: 'alerta', imagemR2Key: k1 }, { texto: 'só texto', x: 0.2, y: 0.2, icone: 'info' }] });
    assert.strictEqual(x.status, 200); assert.strictEqual(x.json.anotacoes.length, 2); assert.ok(x.json.anotacoes[0].imagemUrl, 'devolve o endereço da imagem');
    assert.strictEqual((await api('PUT', R, 'tokB', { anotacoes: [] })).status, 400, 'outra conta não grava');
    x = await api('PUT', R, 'tokA', { anotacoes: [{ texto: 'a', x: 0.1, y: 0.1, imagemR2Key: `pH/anotacoes/${foto.id}/../../${foto.id}.webp` }] });
    assert.strictEqual(x.status, 400); assert.ok(fs.existsSync(path.join(ARM, k1)), 'recusa não apagou nada');
    // o app e o CLIENTE recebem as anotações (com a imagem)
    assert.strictEqual((await api('GET', '/api/app/galeria/pH', 'tokA')).json.fotos[0].anotacoes.length, 2);
    const login = (await (await fetch(`${BASE}/api/cliente/${g.linkToken}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario: 'cli', senha: 'senha1234' }) })).json()).token;
    const doCliente = await (await fetch(`${BASE}/api/cliente/${g.linkToken}/galeria`, { headers: { 'x-cliente-token': login } })).json();
    assert.deepStrictEqual(doCliente.fotos[0].anotacoes.map((a) => a.texto), ['Trocar o painel', 'só texto']);
    assert.ok(doCliente.fotos[0].anotacoes[0].imagemUrl);
    // tirar a imagem da lista apaga o arquivo
    x = await api('PUT', R, 'tokA', { anotacoes: [{ id: x.json ? undefined : undefined, texto: 'Trocar o painel', x: 0.4, y: 0.5 }] });
    assert.strictEqual(x.status, 200); assert.ok(!fs.existsSync(path.join(ARM, k1)), 'imagem que saiu da lista é apagada do armazenamento');
    // excluir a foto apaga as imagens dos balões também
    const k2 = (await api('POST', R + '/imagem', 'tokA', arquivo(PNG))).json.imagemR2Key;
    assert.strictEqual((await api('PUT', R, 'tokA', { anotacoes: [{ texto: 't', x: 0.5, y: 0.5, imagemR2Key: k2 }] })).status, 200);
    assert.ok(fs.existsSync(path.join(ARM, k2)));
    assert.strictEqual((await api('DELETE', '/api/app/galeria/pH/fotos/' + foto.id, 'tokA')).status, 200);
    assert.ok(!fs.existsSync(path.join(ARM, k2)), 'excluir a foto apaga a imagem do balão');
    ok('HTTP real: envio da imagem (bytes conferidos, posse), gravação da lista, recusas, o cliente recebe, imagem tirada da lista e foto excluída apagam os arquivos');
    // 360°: a mesma rota guarda a DIREÇÃO (yaw/pitch) e o cliente recebe
    const fd2 = arquivo(Buffer.from('RIFF....WEBPfake'), 'image/webp'); fd2.append('nomeExibicao', 'Pano'); fd2.append('tipo', '360');
    const pano = (await api('POST', '/api/app/galeria/pH/fotos', 'tokA', fd2)).json.foto;
    const R2 = `/api/app/galeria/pH/fotos/${pano.id}/anotacoes`;
    let y = await api('PUT', R2, 'tokA', { anotacoes: [{ texto: 'olhe a parede', yaw: 250, pitch: -120, icone: 'info' }, { texto: 'outro', yaw: -30.5, pitch: 12.25 }] });
    assert.strictEqual(y.status, 200); assert.deepStrictEqual(y.json.anotacoes.map((a) => [a.yaw, a.pitch, a.x]), [[180, -90, undefined], [-30.5, 12.25, undefined]], '360°: direção travada em ±180/±90, sem x/y');
    y = await api('PUT', R2, 'tokA', { anotacoes: [{ texto: 'sem direção', x: 0.5, y: 0.5 }] });
    assert.strictEqual(y.status, 400); assert.match(y.json.erro, /direção horizontal/, 'no 360° x/y não vale: exige yaw/pitch');
    const doCli = await (await fetch(`${BASE}/api/cliente/${g.linkToken}/galeria`, { headers: { 'x-cliente-token': login } })).json();
    const fp = doCli.fotos.find((f) => f.id === pano.id);
    assert.deepStrictEqual(fp.anotacoes.map((a) => a.texto), ['olhe a parede', 'outro'], 'o cliente recebe as anotações do 360°');
    ok('HTTP real (360°): a rota guarda yaw/pitch (travados), recusa x/y no panorama e o cliente recebe');
  } finally { try { filho.kill(); } catch (e) { /* já foi */ } lic.close(); }
  console.log('\nTudo certo: anotações nas fotos (servidor, PDF e site).');
})().catch((e) => { console.error(e); process.exit(1); });
