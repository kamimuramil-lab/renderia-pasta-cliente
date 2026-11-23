// Site do cliente: o PDF das imagens só existe na licença COMPLETA. Na básica o botão não aparece e o modal não abre.
// Parte 1: estrutura. Parte 2: HTTP real -- a galeria diz `novoVisual` conforme o nível do dono (licença falsa com 2 contas: completa e básica).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');
const ler = (...p) => fs.readFileSync(path.join(__dirname, '..', 'public', ...p), 'utf8');
const ok = (m) => console.log('OK  ' + m);

const css = ler('assets', 'css', 'style.css'), pdf = ler('assets', 'js', 'pdf-cliente.js'), main = ler('assets', 'js', 'main.js'), html = ler('index.html');
assert.ok(css.includes('body:not(.visual-novo) #btnPdfGaleria, body:not(.visual-novo) #btnPdfPlanta{ display:none !important; }'), 'sem .visual-novo (licença básica) os dois botões de PDF somem');
assert.ok(main.includes("document.body.classList.toggle('visual-novo', !!galeria.novoVisual)"), '.visual-novo vem de novoVisual (o dono tem a Página do projeto)');
assert.ok(html.includes('id="btnPdfGaleria"') && html.includes('id="btnPdfPlanta"'), 'os botões existem no HTML');
ok('botões de PDF escondidos por CSS quando o corpo não tem .visual-novo (licença básica)');
assert.ok(pdf.includes('const pdfLiberado = () => !!(estado.galeria && estado.galeria.novoVisual);') && /function abrirModal\(\) \{\s*if \(!pdfLiberado\(\)\) return;/.test(pdf), 'abrirModal recusa sem a licença completa (segunda trava)');
assert.ok(pdf.includes('window.PdfCliente = { abrirModal, ambientesDisponiveis, pdfLiberado };'), 'pdfLiberado exposto');
ok('modal do PDF não abre sem a licença completa, mesmo chamando a função direto');

// ---- HTTP real
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-pdf-completa-'));
const portaLivre = () => new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); });
(async () => {
  const NIVEL = { tokCompleta: { paginaProjeto: true, orcamentos: true, memorial: true }, tokBasica: { paginaProjeto: false, orcamentos: false, memorial: false } };
  const licenca = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', (c) => { corpo += c; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      let token = null; try { token = JSON.parse(corpo).token; } catch (e) { /* vazio */ }
      const usuario = { tokCompleta: 'arqCompleta', tokBasica: 'arqBasica' }[token];
      if (req.url.startsWith('/api/recursos-da-conta-servidor')) {
        let u = null; try { u = JSON.parse(corpo).usuario; } catch (e) { /* */ }
        return res.end(JSON.stringify({ recursos: u === 'arqCompleta' ? NIVEL.tokCompleta : NIVEL.tokBasica, ativa: true }));
      }
      res.end(JSON.stringify(usuario ? { valida: true, usuario, limiteFotos: 50, recursos: NIVEL[token] } : { valida: false, motivo: 'Sessão inválida.' }));
    });
  });
  await new Promise((r) => licenca.listen(0, '127.0.0.1', r));
  const porta = await portaLivre();
  const filho = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: path.join(__dirname, '..'),
    env: Object.assign({}, process.env, { PORT: String(porta), DADOS_DIR: TMP, ARMAZENAMENTO_LOCAL_TESTE: '1', ARMAZENAMENTO_LOCAL_DIR: path.join(TMP, 'arm'), LICENCA_SERVIDOR_URL: `http://127.0.0.1:${licenca.address().port}` })
  });
  let saida = '';
  filho.stdout.on('data', (d) => { saida += d; }); filho.stderr.on('data', (d) => { saida += d; });
  await new Promise((resolve, reject) => { const t0 = Date.now(); const iv = setInterval(() => { if (/rodando na porta/.test(saida)) { clearInterval(iv); resolve(); } else if (Date.now() - t0 > 15000) { clearInterval(iv); reject(new Error('servidor não subiu: ' + saida)); } }, 100); });
  const BASE = `http://127.0.0.1:${porta}`;
  const encerrar = () => { try { filho.kill(); } catch (e) { /* já foi */ } licenca.close(); };
  try {
    const api = async (metodo, caminho, token, corpo) => { const o = { method: metodo, headers: { 'x-sessao-token': token } }; if (corpo) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(corpo); } const r = await fetch(BASE + caminho, o); let j = null; try { j = await r.json(); } catch (e) { /* */ } return { status: r.status, json: j }; };
    const gC = (await api('POST', '/api/app/galeria', 'tokCompleta', { projetoId: 'pC', nomeProjeto: 'Completa', clienteUsuario: 'cliC', clienteSenha: 'senha1234' })).json;
    const gB = (await api('POST', '/api/app/galeria', 'tokBasica', { projetoId: 'pB', nomeProjeto: 'Basica', clienteUsuario: 'cliB', clienteSenha: 'senha1234' })).json;
    assert.ok(gC.linkToken && gB.linkToken);
    const login = async (link, usuario) => (await (await fetch(`${BASE}/api/cliente/${link}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario, senha: 'senha1234' }) })).json()).token;
    const galeriaDoCliente = async (link, usuario) => (await (await fetch(`${BASE}/api/cliente/${link}/galeria`, { headers: { 'x-cliente-token': await login(link, usuario) } })).json());
    const gc = await galeriaDoCliente(gC.linkToken, 'cliC'), gb = await galeriaDoCliente(gB.linkToken, 'cliB');
    assert.strictEqual(gc.novoVisual, true, 'licença completa: o cliente recebe novoVisual (PDF liberado)');
    assert.strictEqual(gb.novoVisual, false, 'licença básica: novoVisual falso (PDF escondido e travado)');
    ok('HTTP real: o cliente da licença completa recebe novoVisual=true; o da básica, false (é isso que esconde o botão de PDF)');
    // o app (arquiteto) também: a gravação das opções do PDF é recusada sem a licença completa
    assert.strictEqual((await api('PUT', '/api/app/galeria/pB/pdf-cliente', 'tokBasica', { nomes: true, paleta: true, marca: 'auto' })).status, 403, 'básica: opções do PDF recusadas');
    assert.strictEqual((await api('PUT', '/api/app/galeria/pC/pdf-cliente', 'tokCompleta', { nomes: true, paleta: true, marca: 'auto' })).status, 200, 'completa: aceitas');
    ok('HTTP real: gravar as opções do PDF é 403 na básica e 200 na completa');
    // lista de pastas da conta (usada pelo app para achar pastas sem projeto): só as da própria licença, sem dados sensíveis
    const lista = (await api('GET', '/api/app/galerias', 'tokCompleta')).json;
    assert.deepStrictEqual(lista.galerias.map((g) => g.projetoId), ['pC'], 'só as da conta, nunca as de outra licença');
    assert.ok(!JSON.stringify(lista).match(/linkToken|clienteSenha|r2Key|senha/i), 'sem link, senha nem chaves de arquivo');
    assert.deepStrictEqual(Object.keys(lista.galerias[0]).sort(), ['atualizadoEm', 'criadoEm', 'nDocumentos', 'nFotos', 'nPlantas', 'nomeProjeto', 'projetoId']);
    assert.strictEqual((await api('GET', '/api/app/galerias', 'tokBasica')).json.galerias.length, 1, 'a conta básica também pode listar (manutenção da própria conta)');
    assert.strictEqual((await api('GET', '/api/app/galerias', 'invalido')).status, 401, 'sem sessão: 401');
    ok('HTTP real: GET /api/app/galerias lista só as pastas da própria conta, sem dado sensível');
  } finally { encerrar(); }
  console.log('\nTudo certo: PDF só na licença completa (site) e lista de pastas da conta.');
})().catch((e) => { console.error(e); process.exit(1); });
