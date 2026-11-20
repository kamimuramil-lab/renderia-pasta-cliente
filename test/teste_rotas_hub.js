// HTTP de verdade: sobe o server.js (armazenamento local de teste + licença FALSA com duas contas) e confere as rotas
// do hub do cliente -- dados/links, documentos, prévia da substituição, posse (conta B nunca mexe no da conta A) e o que
// o cliente final enxerga. Portas livres aleatórias (nunca a 4102, que é do servidor de teste do Rodrigo).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-rotas-hub-'));
const ok = (m) => console.log('OK  ' + m);

function portaLivre() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on('error', reject);
  });
}

(async () => {
  const licenca = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', (c) => { corpo += c; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      let token = null; try { token = JSON.parse(corpo).token; } catch (e) { /* vazio */ }
      const usuario = { tokA: 'arqA', tokB: 'arqB' }[token];
      res.end(JSON.stringify(usuario ? { valida: true, usuario, limiteFotos: 50, recursos: { paginaProjeto: true, orcamentos: true, memorial: true } } : { valida: false, motivo: 'Sessão inválida.' }));
    });
  });
  await new Promise((r) => licenca.listen(0, '127.0.0.1', r));

  const porta = await portaLivre();
  const filho = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: path.join(__dirname, '..'),
    env: Object.assign({}, process.env, {
      PORT: String(porta), DADOS_DIR: TMP, ARMAZENAMENTO_LOCAL_TESTE: '1', ARMAZENAMENTO_LOCAL_DIR: path.join(TMP, 'armazenamento'),
      LICENCA_SERVIDOR_URL: `http://127.0.0.1:${licenca.address().port}`
    })
  });
  let saida = '';
  filho.stdout.on('data', (d) => { saida += d; });
  filho.stderr.on('data', (d) => { saida += d; });
  await new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (/rodando na porta/.test(saida)) { clearInterval(iv); resolve(); }
      else if (Date.now() - t0 > 15000) { clearInterval(iv); reject(new Error('o servidor não subiu: ' + saida)); }
    }, 100);
  });
  const BASE = `http://127.0.0.1:${porta}`;
  const encerrar = () => { try { filho.kill(); } catch (e) { /* já foi */ } licenca.close(); };

  const api = async (metodo, caminho, { sessao, cliente, corpo } = {}) => {
    const opcoes = { method: metodo, headers: {} };
    if (sessao) opcoes.headers['x-sessao-token'] = sessao;
    if (cliente) opcoes.headers['x-cliente-token'] = cliente;
    if (corpo !== undefined) { opcoes.headers['Content-Type'] = 'application/json'; opcoes.body = JSON.stringify(corpo); }
    const r = await fetch(BASE + caminho, opcoes);
    let json = null; try { json = await r.json(); } catch (e) { /* sem corpo */ }
    return { status: r.status, json };
  };
  const P = '/api/app/galeria/projHub';
  const URL1 = 'https://drive.google.com/file/d/AAA/view?usp=sharing';

  try {
    // ---- 1) cria a galeria (conta A) e entra como cliente
    let r = await api('POST', '/api/app/galeria', { sessao: 'tokA', corpo: { projetoId: 'projHub', nomeProjeto: 'APA Teste', clienteUsuario: 'cli', clienteSenha: 'senha1234' } });
    assert.strictEqual(r.status, 200);
    const linkToken = r.json.linkToken;
    r = await api('POST', `/api/cliente/${linkToken}/login`, { corpo: { usuario: 'cli', senha: 'senha1234' } });
    const tokCli = r.json.token;
    r = await api('GET', `/api/cliente/${linkToken}/galeria`, { cliente: tokCli });
    assert.deepStrictEqual(r.json.hub.documentos, []);
    assert.strictEqual(r.json.hub.gruposExecutivo.length, 8, 'a resposta já traz os grupos padrão do executivo');
    ok('galeria nova: hub vazio e grupos padrão na resposta (galeria sem hub segue igual)');

    // ---- 2) sem sessão / sessão inválida / token de CLIENTE nas rotas do arquiteto = 401
    assert.strictEqual((await api('PUT', P + '/hub', { corpo: { dadosProjeto: 'x' } })).status, 401);
    assert.strictEqual((await api('POST', P + '/documentos', { sessao: 'invalida', corpo: {} })).status, 401);
    assert.strictEqual((await api('POST', P + '/documentos', { cliente: tokCli, corpo: { secao: 'visitas', titulo: 'x', url: URL1 } })).status, 401);
    ok('rotas do hub exigem sessão do arquiteto (token do cliente não serve)');

    // ---- 3) dados do projeto e links
    r = await api('PUT', P + '/hub', { sessao: 'tokA', corpo: { dadosProjeto: 'Cliente: Fulano\nProjeto 96m²', links: { tourVirtual: { url: 'https://kuula.co/share/x', titulo: 'Tour' } } } });
    assert.strictEqual(r.status, 200);
    r = await api('PUT', P + '/hub', { sessao: 'tokA', corpo: { links: { tourVirtual: { url: 'javascript:alert(1)' } } } });
    assert.strictEqual(r.status, 400);
    ok('dados e links gravados; link com javascript: recusado');

    // ---- 4) documentos: prévia, criar, revisão nova com substituição confirmada
    r = await api('POST', P + '/documentos', { sessao: 'tokA', corpo: { secao: 'executivo', grupo: 'Planta de Forro', pavimento: 'Térreo', titulo: 'Forro térreo', url: URL1 } });
    assert.strictEqual(r.status, 200);
    const docTerreo = r.json.documento;
    r = await api('POST', P + '/documentos', { sessao: 'tokA', corpo: { secao: 'executivo', grupo: 'Planta de Forro', pavimento: 'Superior', titulo: 'Forro superior', url: URL1 } });
    const docSup = r.json.documento;
    r = await api('POST', P + '/documentos/previa', { sessao: 'tokA', corpo: { secao: 'executivo', grupo: 'Planta de Forro', pavimento: 'Térreo' } });
    assert.deepStrictEqual([r.status, r.json.substituiria.map((d) => d.id), r.json.revisaoSugerida], [200, [docTerreo.id], 1]);
    r = await api('POST', P + '/documentos', { sessao: 'tokA', corpo: { secao: 'executivo', grupo: 'Planta de Forro', pavimento: 'Térreo', titulo: 'Forro térreo REV1', url: URL1, substituirIds: [docTerreo.id] } });
    assert.deepStrictEqual([r.status, r.json.documento.revisao, r.json.substituidos.map((d) => d.id)], [200, 1, [docTerreo.id]]);
    r = await api('PUT', `${P}/documentos/${docSup.id}`, { sessao: 'tokA', corpo: { observacao: 'conferir com a marcenaria' } });
    assert.strictEqual(r.json.documento.observacao, 'conferir com a marcenaria');
    ok('prévia, criação, substituição confirmada (só o andar certo vira ANTIGA) e edição');

    // ordem manual (▲▼): documentos e categorias; o cliente recebe `ordem` e `ordemGrupos`
    r = await api('PUT', P + '/documentos-ordem', { sessao: 'tokA', corpo: { ids: [docSup.id, docTerreo.id] } });
    assert.strictEqual(r.status, 200);
    r = await api('PUT', P + '/hub', { sessao: 'tokA', corpo: { ordemGrupos: ['Planta de Forro', 'Demolição e Construção'] } });
    assert.deepStrictEqual([r.status, r.json.hub.ordemGrupos], [200, ['Planta de Forro', 'Demolição e Construção']]);
    r = await api('GET', `/api/cliente/${linkToken}/galeria`, { cliente: tokCli });
    assert.deepStrictEqual([r.json.hub.documentos.find((d) => d.id === docSup.id).ordem, r.json.hub.ordemGrupos[0]], [0, 'Planta de Forro']);
    ok('ordem dos documentos e das categorias pelas rotas, e o cliente recebe a ordem');

    // ---- 5) o que o cliente final enxerga
    r = await api('GET', `/api/cliente/${linkToken}/galeria`, { cliente: tokCli });
    const st = Object.fromEntries(r.json.hub.documentos.map((d) => [d.titulo, d.status]));
    assert.deepStrictEqual(st, { 'Forro térreo': 'ANTIGA', 'Forro superior': 'ATUAL', 'Forro térreo REV1': 'ATUAL' });
    assert.strictEqual(r.json.hub.dadosProjeto, 'Cliente: Fulano\nProjeto 96m²');
    assert.ok(!('clienteSenhaHash' in r.json) && !('sessoesClienteAtivas' in r.json), 'senha/sessões nunca saem');
    ok('cliente vê o hub; nenhum segredo da galeria vaza');

    // ---- 6) POSSE: conta B não lê prévia, não cria, não edita, não apaga, não muda dados
    const antes = JSON.stringify((await api('GET', `/api/cliente/${linkToken}/galeria`, { cliente: tokCli })).json.hub);
    for (const [metodo, rota, corpo] of [
      ['PUT', P + '/hub', { dadosProjeto: 'invadido' }],
      ['POST', P + '/documentos', { secao: 'visitas', titulo: 'x', url: URL1 }],
      ['POST', P + '/documentos/previa', { secao: 'executivo', grupo: 'Planta de Forro' }],
      ['PUT', `${P}/documentos/${docSup.id}`, { titulo: 'invadido' }],
      ['DELETE', `${P}/documentos/${docSup.id}`, undefined],
      ['PUT', P + '/documentos-ordem', { ids: [docSup.id] }],
      ['PUT', P + '/hub', { ordemGrupos: ['invadido'] }]
    ]) {
      const x = await api(metodo, rota, { sessao: 'tokB', corpo });
      assert.strictEqual(x.status, 400, `${metodo} ${rota}`);
      assert.match(x.json.erro, /não pertence/);
    }
    assert.strictEqual(JSON.stringify((await api('GET', `/api/cliente/${linkToken}/galeria`, { cliente: tokCli })).json.hub), antes);
    ok('conta B barrada em TODAS as rotas do hub e nada mudou');

    // ---- 6b) capa: foto do projeto vira capaUrl pro cliente; sumindo a foto, volta pra capa padrão (null)
    const galeriaLib = require('../lib/galeria');
    const arquivoDados = path.join(TMP, 'dados-galerias.json');
    const fotoCapa = galeriaLib.adicionarFoto(arquivoDados, 'projHub', { nomeExibicao: 'Sala', tipo: 'fixa', r2Key: 'projHub/capa.webp' });
    r = await api('PUT', P + '/hub', { sessao: 'tokA', corpo: { capaFotoId: fotoCapa.id } });
    assert.strictEqual(r.status, 200);
    r = await api('GET', `/api/cliente/${linkToken}/galeria`, { cliente: tokCli });
    assert.ok(r.json.hub.capaUrl && r.json.hub.capaUrl.includes('capa.webp'), 'capaUrl precisa vir resolvida');
    assert.strictEqual((await api('PUT', P + '/hub', { sessao: 'tokB', corpo: { capaFotoId: null } })).status, 400, 'conta B não troca a capa');
    galeriaLib.excluirFoto(arquivoDados, 'projHub', fotoCapa.id);
    r = await api('GET', `/api/cliente/${linkToken}/galeria`, { cliente: tokCli });
    assert.strictEqual(r.json.hub.capaUrl, null);
    ok('capa por foto do projeto: capaUrl resolvida; foto apagada volta pra capa padrão; conta B barrada');

    // ---- 7) excluir e a página do cliente carrega o hub.js
    assert.strictEqual((await api('DELETE', `${P}/documentos/${docSup.id}`, { sessao: 'tokA' })).status, 200);
    assert.strictEqual((await api('DELETE', `${P}/documentos/${docSup.id}`, { sessao: 'tokA' })).status, 400);
    const html = await (await fetch(`${BASE}/?g=${linkToken}`)).text();
    assert.match(html, /assets\/js\/hub\.js\?v=\d+/);
    assert.strictEqual((await fetch(`${BASE}/assets/js/hub.js`)).status, 200);
    ok('exclusão; página do cliente referencia o hub.js com versão no endereço');

    console.log('\nTODOS OS TESTES DAS ROTAS DO HUB PASSARAM');
  } finally {
    encerrar();
    fs.rmSync(TMP, { recursive: true, force: true });
  }
})().catch((e) => { console.error('FALHOU:', e && e.stack || e); process.exit(1); });
