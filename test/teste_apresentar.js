// Lousa de apresentação (modo escritório): (A) a busca do arquivo no Google Drive pelo servidor (só links do Drive, limites, tipo pelos bytes,
// redirecionamentos só pro Google) e (B) HTTP de verdade: só a sessão de ESCRITÓRIO usa; as atas das reuniões (anotações + prints) ficam só
// pro escritório e nunca chegam ao cliente. Portas livres aleatórias (nunca a 4102).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');
const drive = require('../lib/drive-arquivo');
const reunioes = require('../lib/reunioes');
const ok = (m) => console.log('OK  ' + m);

// ---------- A) lib/drive-arquivo ----------
const ID = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345';
assert.strictEqual(drive.idDoDrive(`https://drive.google.com/file/d/${ID}/view?usp=sharing`), ID);
assert.strictEqual(drive.idDoDrive(`https://drive.google.com/open?id=${ID}`), ID);
assert.strictEqual(drive.idDoDrive(`https://docs.google.com/document/d/${ID}/edit`), ID);
assert.strictEqual(drive.idDoDrive(`https://drive.google.com/uc?export=download&id=${ID}`), ID);
['http://drive.google.com/file/d/' + ID, 'https://evil.com/file/d/' + ID, 'https://drive.google.com.evil.com/file/d/' + ID, 'https://drive.google.com/file/d/curto', 'javascript:alert(1)', 'https://drive.google.com/', '', null, 'https://user@evil.com/@drive.google.com/file/d/' + ID].forEach((u) => assert.strictEqual(drive.idDoDrive(u), null, String(u)));
ok('só aproveita o ID de links https do Google Drive/Docs (nada de outros sites, http, subdomínio falso ou texto estranho)');

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(500, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200)]);
assert.strictEqual(drive.tipoPelosBytes(PDF), 'application/pdf'); assert.strictEqual(drive.tipoPelosBytes(PNG), 'image/png');
assert.strictEqual(drive.tipoPelosBytes(Buffer.from('<html>faça login</html>')), null);
const resposta = (corpo, { status = 200, headers = {} } = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (k) => headers[String(k).toLowerCase()] || null }, arrayBuffer: async () => corpo, body: null });
(async () => {
  let pedidos = [];
  const fakeFetch = (mapa) => async (url) => { pedidos.push(url); const r = mapa(url); if (r instanceof Error) throw r; return r; };
  let r = await drive.baixar(`https://drive.google.com/file/d/${ID}/view`, { fetchFn: fakeFetch(() => resposta(PDF)) });
  assert.strictEqual(r.tipo, 'application/pdf'); assert.ok(pedidos[0].startsWith('https://drive.usercontent.google.com/download?id=' + ID), 'sempre o endereço do Google, com o ID');
  assert.ok(!pedidos[0].includes('evil'), 'nunca o texto do link');
  // página de login/"peça acesso" (HTML) = não compartilhado
  await assert.rejects(drive.baixar(`https://drive.google.com/file/d/${ID}`, { fetchFn: fakeFetch(() => resposta(Buffer.from('<html>Entrar</html>'))) }), (e) => e.codigo === 'nao-compartilhado');
  await assert.rejects(drive.baixar(`https://drive.google.com/file/d/${ID}`, { fetchFn: fakeFetch(() => resposta(Buffer.alloc(0), { status: 403 })) }), (e) => e.codigo === 'nao-compartilhado');
  await assert.rejects(drive.baixar(`https://drive.google.com/file/d/${ID}`, { fetchFn: fakeFetch(() => resposta(Buffer.alloc(0), { status: 404 })) }), (e) => e.codigo === 'nao-compartilhado');
  await assert.rejects(drive.baixar('https://evil.com/x', { fetchFn: fakeFetch(() => resposta(PDF)) }), (e) => e.codigo === 'link-invalido');
  // tamanho: pelo cabeçalho e pelo que realmente chega
  await assert.rejects(drive.baixar(`https://drive.google.com/file/d/${ID}`, { limiteBytes: 100, fetchFn: fakeFetch(() => resposta(PDF, { headers: { 'content-length': '999999' } })) }), (e) => e.codigo === 'grande-demais');
  await assert.rejects(drive.baixar(`https://drive.google.com/file/d/${ID}`, { limiteBytes: 100, fetchFn: fakeFetch(() => resposta(PDF)) }), (e) => e.codigo === 'grande-demais');
  // redirecionamento: pra um host do Google vale; pra qualquer outro (ou http) é recusado
  const redir = (para) => (url) => (url.includes('drive.usercontent') ? resposta(Buffer.alloc(0), { status: 302, headers: { location: para } }) : resposta(PDF));
  r = await drive.baixar(`https://drive.google.com/file/d/${ID}`, { fetchFn: fakeFetch(redir('https://doc-0g-ac-docs.googleusercontent.com/docs/abc')) });
  assert.strictEqual(r.tipo, 'application/pdf');
  for (const ruim of ['https://evil.com/roubo', 'http://doc.googleusercontent.com/x', 'https://googleusercontent.com.evil.com/x', 'http://127.0.0.1:8080/interno', 'https://169.254.169.254/latest/meta-data']) {
    await assert.rejects(drive.baixar(`https://drive.google.com/file/d/${ID}`, { fetchFn: fakeFetch(redir(ruim)) }), (e) => e.codigo === 'falha', ruim);
  }
  await assert.rejects(drive.baixar(`https://drive.google.com/file/d/${ID}`, { fetchFn: fakeFetch(() => resposta(Buffer.alloc(0), { status: 302, headers: { location: 'https://x.google.com/a' } })), maxRedirecionamentos: 2 }), (e) => e.codigo === 'falha', 'laço de redirecionamentos');
  await assert.rejects(drive.baixar(`https://drive.google.com/file/d/${ID}`, { fetchFn: fakeFetch(() => new Error('ECONNRESET')) }), (e) => e.codigo === 'falha');
  ok('busca no Drive: só endereço do Google, redirecionamento só pro Google, limite de tamanho, tipo pelos bytes e erros claros (inclusive "não compartilhado")');

  // ---------- reunioes (validação) ----------
  const bom = reunioes.validarDados({ titulo: 'Reunião com a família', apresentado: 'Planta baixa', notas: 'DECISÃO: ampliar a varanda', iniciouEm: '2026-11-21T14:00:00Z', prints: [{ rotulo: 'Planta - pág. 1' }] });
  assert.deepStrictEqual([bom.titulo, bom.rotulosDosPrints], ['Reunião com a família', ['Planta - pág. 1']]);
  for (const ruim of [{}, { titulo: '' }, { titulo: 'x', notas: 5 }, { titulo: 'x', notas: 'a'.repeat(20001) }, { titulo: 'x', iniciouEm: 'ontem' }, { titulo: 'x', prints: 'sim' }, { titulo: 'x', prints: new Array(41).fill({ rotulo: 'a' }) }]) {
    assert.throws(() => reunioes.validarDados(ruim), JSON.stringify(ruim).slice(0, 60));
  }
  ok('ata: título obrigatório; notas, datas e prints validados (nada inválido passa)');

  // ---------- B) HTTP de verdade ----------
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-apresentar-'));
  const portaLivre = () => new Promise((resolve, reject) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); s.on('error', reject); });
  // Drive FALSO local: devolve o PDF do arquivo ID, uma página HTML ("não compartilhado") pro ID2
  const ID2 = 'ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ99';
  let pedidosDrive = 0;
  const driveFalso = http.createServer((req, res) => {
    pedidosDrive++;
    const u = new URL(req.url, 'http://x');
    if (u.searchParams.get('id') === ID) { res.writeHead(200, { 'Content-Type': 'application/pdf' }); return res.end(PDF); }
    res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>Você precisa de acesso</html>');
  });
  await new Promise((r) => driveFalso.listen(0, '127.0.0.1', r));
  const licenca = http.createServer((req, res) => {
    let c = ''; req.on('data', (d) => { c += d; });
    req.on('end', () => {
      let token = null; try { token = JSON.parse(c).token; } catch (e) { /* vazio */ }
      const m = { tokA: { usuario: 'arqA', recursos: { paginaProjeto: true, orcamentos: true, memorial: true } }, tokB: { usuario: 'arqB', recursos: { paginaProjeto: true } }, tokBasica: { usuario: 'arqC', recursos: {} } }[token];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(m ? { valida: true, usuario: m.usuario, limiteFotos: 50, recursos: m.recursos } : { valida: false, motivo: 'Sessão inválida.' }));
    });
  });
  await new Promise((r) => licenca.listen(0, '127.0.0.1', r));
  const porta = await portaLivre();
  const filho = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { cwd: path.join(__dirname, '..'), env: Object.assign({}, process.env, { PORT: String(porta), DADOS_DIR: TMP, ARMAZENAMENTO_LOCAL_TESTE: '1', ARMAZENAMENTO_LOCAL_DIR: path.join(TMP, 'arm'), LICENCA_SERVIDOR_URL: `http://127.0.0.1:${licenca.address().port}`, RENDERIA_DRIVE_URL_BASE: `http://127.0.0.1:${driveFalso.address().port}` }) });
  let saida = ''; filho.stdout.on('data', (d) => { saida += d; }); filho.stderr.on('data', (d) => { saida += d; });
  await new Promise((resolve, reject) => { const t0 = Date.now(); const iv = setInterval(() => { if (/rodando na porta/.test(saida)) { clearInterval(iv); resolve(); } else if (Date.now() - t0 > 15000) { clearInterval(iv); reject(new Error(saida)); } }, 100); });
  const BASE = `http://127.0.0.1:${porta}`;
  const encerrar = () => { try { filho.kill(); } catch (e) { /* já foi */ } licenca.close(); driveFalso.close(); };
  const api = async (m, p, { tok, cli, dash, corpo, bruto } = {}) => {
    const o = { method: m, headers: {} };
    if (tok) o.headers['x-sessao-token'] = tok; if (cli) o.headers['x-cliente-token'] = cli; if (dash) o.headers['x-dashboard-token'] = dash;
    if (corpo !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(corpo); }
    const r = await fetch(BASE + p, o);
    if (bruto) return { status: r.status, tipo: r.headers.get('content-type'), buf: Buffer.from(await r.arrayBuffer()) };
    let j = null; try { j = await r.json(); } catch (e) { /* vazio */ }
    return { status: r.status, json: j };
  };
  const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7)]);
  const dataUrl = (buf, tipo) => `data:${tipo};base64,${buf.toString('base64')}`;
  try {
    const g = await api('POST', '/api/app/galeria', { tok: 'tokA', corpo: { projetoId: 'projA', nomeProjeto: 'Apartamento Silva', clienteUsuario: 'cliA', clienteSenha: 'senha1234' } });
    assert.strictEqual(g.status, 200); const link = g.json.linkToken;
    const P = '/api/app/galeria/projA';
    const d1 = (await api('POST', P + '/documentos', { tok: 'tokA', corpo: { secao: 'planta_original', titulo: 'Planta baixa', url: `https://drive.google.com/file/d/${ID}/view` } })).json.documento;
    const d2 = (await api('POST', P + '/documentos', { tok: 'tokA', corpo: { secao: 'conceitual', titulo: 'Conceito', url: `https://drive.google.com/file/d/${ID2}/view` } })).json.documento;
    const d3 = (await api('POST', P + '/documentos', { tok: 'tokA', corpo: { secao: 'conceitual', titulo: 'Fora do Drive', url: 'https://exemplo.com/arquivo.pdf' } })).json.documento;
    // sessões: cliente de verdade e ESCRITÓRIO (pelo dashboard)
    const cliente = (await api('POST', `/api/cliente/${link}/login`, { corpo: { usuario: 'cliA', senha: 'senha1234' } })).json.token;
    const linkDash = (await api('PUT', '/api/app/dashboard/senha', { tok: 'tokA', corpo: { senha: 'mestra123' } })).json.linkToken;
    const dashTok = (await api('POST', `/api/dashboard/${linkDash}/login`, { corpo: { senha: 'mestra123' } })).json.token;
    const esc = (await api('POST', `/api/dashboard/${linkDash}/projetos/projA/abrir`, { dash: dashTok })).json.token;
    assert.ok(cliente && esc);

    // 1) o arquivo do Drive: só no modo escritório
    let r = await api('GET', `/api/cliente/${link}/apresentar/documento/${d1.id}`, { cli: esc, bruto: true });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.tipo, 'application/pdf'); assert.ok(r.buf.equals(PDF), 'o PDF chega inteiro');
    for (const [rotulo, req] of [['cliente de verdade', { cli: cliente }], ['sem sessão', {}], ['sessão inválida', { cli: 'xxx' }]]) {
      r = await api('GET', `/api/cliente/${link}/apresentar/documento/${d1.id}`, { ...req, bruto: true });
      assert.ok([401, 403].includes(r.status), rotulo + ' => ' + r.status);
    }
    assert.strictEqual(pedidosDrive, 1, 'quem não é escritório nem chega a acionar o Drive');
    ok('o arquivo do Drive só sai para a sessão de escritório; cliente final e visitante são barrados antes de tocar no Drive');

    r = await api('GET', `/api/cliente/${link}/apresentar/documento/${d2.id}`, { cli: esc });
    assert.strictEqual(r.status, 422); assert.strictEqual(r.json.motivo, 'nao-compartilhado'); assert.match(r.json.erro, /Qualquer pessoa com o link/);
    r = await api('GET', `/api/cliente/${link}/apresentar/documento/${d3.id}`, { cli: esc });
    assert.strictEqual(r.status, 400); assert.strictEqual(r.json.motivo, 'link-invalido');
    assert.strictEqual((await api('GET', `/api/cliente/${link}/apresentar/documento/doc_inexistente`, { cli: esc })).status, 404);
    ok('arquivo não compartilhado (422), link que não é do Drive (400) e documento inexistente (404) dão erro claro');

    // 2) ata: só escritório; valida; prints gravados; cliente nunca recebe
    const corpoAta = { titulo: 'Reunião - Apartamento Silva', apresentado: 'Planta baixa', notas: '[14:05] DECISÃO: ampliar a varanda\nPENDÊNCIA: medir o terraço', iniciouEm: '2026-11-21T14:00:00Z', encerrouEm: '2026-11-21T15:10:00Z', prints: [{ rotulo: 'Planta - pág. 1', imagem: dataUrl(JPEG, 'image/jpeg') }, { rotulo: 'Sala', imagem: dataUrl(PNG, 'image/png') }] };
    assert.strictEqual((await api('POST', `/api/cliente/${link}/reunioes`, { cli: cliente, corpo: corpoAta })).status, 403, 'cliente de verdade não salva ata');
    assert.ok([401, 403].includes((await api('POST', `/api/cliente/${link}/reunioes`, { corpo: corpoAta })).status));
    for (const ruim of [{ ...corpoAta, titulo: '' }, { ...corpoAta, notas: 'x'.repeat(20001) }, { ...corpoAta, prints: [{ rotulo: 'a', imagem: 'data:text/html;base64,PGI+' }] }, { ...corpoAta, prints: [{ rotulo: 'a', imagem: dataUrl(Buffer.from('nao sou imagem'), 'image/jpeg') }] }, { ...corpoAta, prints: [{ rotulo: 'a', imagem: dataUrl(Buffer.alloc(6 * 1024 * 1024 + 10, 0xff), 'image/jpeg') }] }]) {
      const rr = await api('POST', `/api/cliente/${link}/reunioes`, { cli: esc, corpo: ruim });
      assert.strictEqual(rr.status, 400, JSON.stringify(rr.json));
    }
    assert.strictEqual((await api('GET', `${P}/reunioes`, { tok: 'tokA' })).json.reunioes.length, 0, 'nada inválido foi gravado');
    r = await api('POST', `/api/cliente/${link}/reunioes`, { cli: esc, corpo: corpoAta });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json)); assert.strictEqual(r.json.reuniao.prints, 2);
    ok('ata: cliente de verdade e visitante não salvam; título vazio, texto enorme e print inválido/grande são recusados sem gravar nada; a ata válida entra');

    // 3) o arquiteto vê (app); o CLIENTE nunca
    r = await api('GET', `${P}/reunioes`, { tok: 'tokA' });
    assert.strictEqual(r.json.reunioes.length, 1);
    const ata = r.json.reunioes[0];
    assert.strictEqual(ata.prints.length, 2); assert.deepStrictEqual(ata.prints.map((p) => p.rotulo), ['Planta - pág. 1', 'Sala']);
    assert.ok(ata.texto.includes('*Reunião - Apartamento Silva*') && ata.texto.includes('DECISÃO: ampliar a varanda') && ata.texto.includes('Apresentado: Planta baixa'), 'texto pronto pro WhatsApp');
    for (const p of ata.prints) { const rr = await fetch(p.url.startsWith('/') ? BASE + p.url : p.url); assert.strictEqual(rr.status, 200, 'o print abre'); }
    const galCli = JSON.stringify((await api('GET', `/api/cliente/${link}/galeria`, { cli: cliente })).json);
    const galEsc = JSON.stringify((await api('GET', `/api/cliente/${link}/galeria`, { cli: esc })).json);
    const galApp = JSON.stringify((await api('GET', P, { tok: 'tokA' })).json);
    for (const [quem, txt] of [['cliente', galCli], ['escritório (visão do cliente)', galEsc], ['app (rota da galeria)', galApp]]) {
      ['reunioes', 'ampliar a varanda', 'print-1', 'Planta - pág. 1'].forEach((t) => assert.ok(!txt.includes(t), quem + ' não recebe: ' + t));
    }
    ok('o arquiteto vê a ata (texto pronto pro WhatsApp e prints que abrem); a galeria do cliente, do escritório e do app NUNCA carregam as atas');

    // 4) posse e licença
    assert.notStrictEqual((await api('GET', `${P}/reunioes`, { tok: 'tokB' })).status, 200, 'outra conta não lê');
    assert.strictEqual((await api('GET', `${P}/reunioes`, { tok: 'tokBasica' })).status, 403, 'licença Básica não');
    assert.strictEqual((await api('GET', `${P}/reunioes`)).status, 401);
    assert.notStrictEqual((await api('DELETE', `${P}/reunioes/${ata.id}`, { tok: 'tokB' })).status, 200, 'outra conta não apaga');
    // 5) excluir apaga a ata E os prints do armazenamento
    const urlPrint = ata.prints[0].url.startsWith('/') ? BASE + ata.prints[0].url : ata.prints[0].url;
    assert.strictEqual((await api('DELETE', `${P}/reunioes/${ata.id}`, { tok: 'tokA' })).status, 200);
    assert.strictEqual((await api('GET', `${P}/reunioes`, { tok: 'tokA' })).json.reunioes.length, 0);
    assert.strictEqual((await fetch(urlPrint)).status, 404, 'o arquivo do print foi apagado do armazenamento');
    ok('outra conta e licença Básica não mexem nas atas; excluir apaga a ata e os prints do armazenamento');

    assert.ok(!saida.includes('mestra123'), 'senha mestra fora do log');
    console.log('\nTudo certo: lousa de apresentação (servidor).');
    encerrar();
  } catch (e) { encerrar(); console.error(e); console.error(saida.slice(-1200)); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
