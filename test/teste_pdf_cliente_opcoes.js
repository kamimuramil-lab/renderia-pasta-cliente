// O PDF das imagens que o CLIENTE baixa: nome das imagens, paleta e marca no canto são decisão do ARQUITETO (guardada no projeto); o cliente só
// escolhe os ambientes. HTTP real; portas livres aleatórias (nunca a 4102).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');
const ok = (m) => console.log('OK  ' + m);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-controle-avisos-'));
const portaLivre = () => new Promise((resolve, reject) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); s.on('error', reject); });

(async () => {
  const COMPLETA = { paginaProjeto: true, orcamentos: true, memorial: true };
  const licenca = http.createServer((req, res) => {
    let c = ''; req.on('data', (d) => { c += d; });
    req.on('end', () => {
      let token = null; try { token = JSON.parse(c).token; } catch (e) { /* vazio */ }
      const m = { tokA: { usuario: 'arqA', recursos: COMPLETA }, tokB: { usuario: 'arqB', recursos: COMPLETA }, tokBasica: { usuario: 'arqC', recursos: {} } }[token];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(m ? { valida: true, usuario: m.usuario, limiteFotos: 50, recursos: m.recursos } : { valida: false, motivo: 'Sessão inválida.' }));
    });
  });
  await new Promise((r) => licenca.listen(0, '127.0.0.1', r));
  const porta = await portaLivre();
  const filho = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { cwd: path.join(__dirname, '..'), env: Object.assign({}, process.env, { PORT: String(porta), DADOS_DIR: TMP, ARMAZENAMENTO_LOCAL_TESTE: '1', ARMAZENAMENTO_LOCAL_DIR: path.join(TMP, 'arm'), LICENCA_SERVIDOR_URL: `http://127.0.0.1:${licenca.address().port}` }) });
  let saida = ''; filho.stdout.on('data', (d) => { saida += d; }); filho.stderr.on('data', (d) => { saida += d; });
  await new Promise((resolve, reject) => { const t0 = Date.now(); const iv = setInterval(() => { if (/rodando na porta/.test(saida)) { clearInterval(iv); resolve(); } else if (Date.now() - t0 > 15000) { clearInterval(iv); reject(new Error(saida)); } }, 100); });
  const BASE = `http://127.0.0.1:${porta}`;
  const encerrar = () => { try { filho.kill(); } catch (e) { /* já foi */ } licenca.close(); };
  const api = async (m, p, { tok, cli, corpo } = {}) => {
    const o = { method: m, headers: {} };
    if (tok) o.headers['x-sessao-token'] = tok; if (cli) o.headers['x-cliente-token'] = cli;
    if (corpo !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(corpo); }
    const r = await fetch(BASE + p, o); let j = null; try { j = await r.json(); } catch (e) { /* vazio */ }
    return { status: r.status, json: j };
  };
  const dormir = (ms) => new Promise((x) => setTimeout(x, ms));

  try {
    const g = await api('POST', '/api/app/galeria', { tok: 'tokA', corpo: { projetoId: 'projA', nomeProjeto: 'Projeto A', clienteUsuario: 'cliA', clienteSenha: 'senha1234' } });
    assert.strictEqual(g.status, 200); const link = g.json.linkToken;
    const P = '/api/app/galeria/projA';
    const login = await api('POST', `/api/cliente/${link}/login`, { corpo: { usuario: 'cliA', senha: 'senha1234' } });
    const doCliente = async () => (await api('GET', `/api/cliente/${link}/galeria`, { cli: login.json.token })).json.pdfCliente;

    assert.deepStrictEqual((await api('GET', P, { tok: 'tokA' })).json.pdfCliente, { nomes: true, paleta: true, marca: 'auto' });
    assert.deepStrictEqual(await doCliente(), { nomes: true, paleta: true, marca: 'auto' });
    ok('padrão (igual ao que o PDF sempre fez): nomes e paleta ligados, marca automática');

    let r = await api('PUT', P + '/pdf-cliente', { tok: 'tokA', corpo: { nomes: false, marca: 'icone' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.deepStrictEqual(r.json.pdfCliente, { nomes: false, paleta: true, marca: 'icone' }, 'só muda o que veio');
    assert.deepStrictEqual(await doCliente(), { nomes: false, paleta: true, marca: 'icone' }, 'o cliente recebe a decisão do arquiteto');
    r = await api('PUT', P + '/pdf-cliente', { tok: 'tokA', corpo: { paleta: false, marca: 'nenhuma' } });
    assert.deepStrictEqual(r.json.pdfCliente, { nomes: false, paleta: false, marca: 'nenhuma' });
    ok('o arquiteto define nomes, paleta e marca; o cliente recebe e não tem como mudar');

    for (const ruim of [{ nomes: 'sim' }, { paleta: 1 }, { marca: 'dourada' }, { marca: 5 }]) {
      assert.strictEqual((await api('PUT', P + '/pdf-cliente', { tok: 'tokA', corpo: ruim })).status, 400, JSON.stringify(ruim));
    }
    assert.deepStrictEqual(await doCliente(), { nomes: false, paleta: false, marca: 'nenhuma' }, 'valor inválido não grava nada');
    assert.notStrictEqual((await api('PUT', P + '/pdf-cliente', { tok: 'tokB', corpo: { nomes: true } })).status, 200, 'outra conta não mexe');
    assert.strictEqual((await api('PUT', P + '/pdf-cliente', { tok: 'tokBasica', corpo: { nomes: true } })).status, 403, 'sem Página do projeto');
    assert.strictEqual((await api('PUT', P + '/pdf-cliente', { corpo: { nomes: true } })).status, 401, 'sem sessão');
    ok('valores inválidos, outra conta, licença Básica e chamada sem sessão não mexem nas opções');

    console.log('\nTudo certo: opções do PDF definidas pelo arquiteto.');
    encerrar();
  } catch (e) { encerrar(); console.error(e); console.error(saida.slice(-1200)); process.exit(1); }
})();
