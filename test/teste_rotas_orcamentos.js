// HTTP de verdade: sobe o server.js (armazenamento local de teste + licença FALSA com duas contas) e confere a Pasta de
// Orçamentos -- rotas do arquiteto, login próprio do cliente, status/comentário, novidades (selo), posse entre contas e,
// principalmente, o ISOLAMENTO: a Pasta Cliente nunca recebe valores de orçamento e as sessões das duas pastas não se
// misturam. Portas livres aleatórias (nunca a 4102, que é do servidor de teste do Rodrigo).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-rotas-orc-'));
const ok = (m) => console.log('OK  ' + m);
const portaLivre = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  s.on('error', reject);
});

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
    env: Object.assign({}, process.env, { PORT: String(porta), DADOS_DIR: TMP, ARMAZENAMENTO_LOCAL_TESTE: '1', ARMAZENAMENTO_LOCAL_DIR: path.join(TMP, 'arm'), LICENCA_SERVIDOR_URL: `http://127.0.0.1:${licenca.address().port}` })
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

  const api = async (metodo, caminho, { sessao, cliente, orcamento, corpo } = {}) => {
    const opcoes = { method: metodo, headers: {} };
    if (sessao) opcoes.headers['x-sessao-token'] = sessao;
    if (cliente) opcoes.headers['x-cliente-token'] = cliente;
    if (orcamento) opcoes.headers['x-orcamento-token'] = orcamento;
    if (corpo !== undefined) { opcoes.headers['Content-Type'] = 'application/json'; opcoes.body = JSON.stringify(corpo); }
    const r = await fetch(BASE + caminho, opcoes);
    let json = null; try { json = await r.json(); } catch (e) { /* sem corpo */ }
    return { status: r.status, json };
  };
  const P = '/api/app/galeria/projOrc';
  const DRIVE = 'https://drive.google.com/file/d/AAA/view';

  try {
    // ---- 1) galeria + login da Pasta Cliente; a resposta dela não pode ter NADA de orçamentos
    let r = await api('POST', '/api/app/galeria', { sessao: 'tokA', corpo: { projetoId: 'projOrc', nomeProjeto: 'APA Teste', clienteUsuario: 'cli', clienteSenha: 'senha1234' } });
    const linkGaleria = r.json.linkToken;
    const tokGaleria = (await api('POST', `/api/cliente/${linkGaleria}/login`, { corpo: { usuario: 'cli', senha: 'senha1234' } })).json.token;

    // ---- 2) rotas do arquiteto exigem a sessão do arquiteto
    for (const [m, rota] of [['GET', '/orcamentos'], ['PUT', '/orcamentos/acesso'], ['POST', '/orcamentos/itens'], ['POST', '/orcamentos/marcar-lido']]) {
      assert.strictEqual((await api(m, P + rota)).status, 401, `${m} ${rota} sem sessão`);
      assert.strictEqual((await api(m, P + rota, { sessao: 'invalida' })).status, 401, `${m} ${rota} sessão inválida`);
      assert.strictEqual((await api(m, P + rota, { cliente: tokGaleria })).status, 401, `${m} ${rota} com token de cliente`);
    }
    ok('rotas do arquiteto: 401 sem sessão, com sessão inválida e com token de CLIENTE');

    // ---- 3) criar acesso e itens
    r = await api('PUT', P + '/orcamentos/acesso', { sessao: 'tokA', corpo: { usuario: 'orc', senha: 'senha-orc' } });
    assert.strictEqual(r.status, 200);
    const linkOrc = r.json.acesso.linkToken;
    assert.ok(linkOrc && linkOrc !== linkGaleria, 'link de orçamentos é outro');
    r = await api('POST', P + '/orcamentos/itens', { sessao: 'tokA', corpo: { item: 'Mármore', empresa: 'EmpresaSecretaZZ', valor: 1500.5, url: DRIVE, status: 'analise_cliente' } });
    assert.strictEqual(r.status, 200);
    const idMarmore = r.json.item.id;
    r = await api('POST', P + '/orcamentos/itens', { sessao: 'tokA', corpo: { item: 'Pintura', valor: 800 } }); // à fazer
    const idPintura = r.json.item.id;
    assert.strictEqual((await api('POST', P + '/orcamentos/itens', { sessao: 'tokA', corpo: { item: 'x', url: 'javascript:alert(1)' } })).status, 400);
    r = await api('GET', P + '/orcamentos', { sessao: 'tokA' });
    assert.deepStrictEqual([r.json.itens.length, r.json.acesso.usuario, r.json.temNovidadeNaoLida], [2, 'orc', false]);
    assert.ok(!JSON.stringify(r.json).includes('senhaHash') && !JSON.stringify(r.json).includes('sessoesAtivas'));
    ok('acesso criado (link próprio), itens criados, link perigoso recusado, app nunca recebe hash');

    // ---- 4) ISOLAMENTO: valores e login de orçamentos não saem pela Pasta Cliente nem pela rota do app da galeria
    r = await api('GET', `/api/cliente/${linkGaleria}/galeria`, { cliente: tokGaleria });
    const textoGaleriaCliente = JSON.stringify(r.json);
    assert.ok(!('orcamentos' in r.json), 'a resposta da Pasta Cliente não tem o campo orcamentos');
    for (const segredo of ['EmpresaSecretaZZ', '1500', 'senha-orc', linkOrc, 'senhaHash']) assert.ok(!textoGaleriaCliente.includes(segredo), 'vazou na Pasta Cliente: ' + segredo);
    const galeriaApp = JSON.stringify((await api('GET', P, { sessao: 'tokA' })).json);
    assert.ok(!galeriaApp.includes('EmpresaSecretaZZ') && !galeriaApp.includes(linkOrc), 'nem a rota da galeria do app carrega os orçamentos');
    ok('a Pasta Cliente (e a galeria do app) não carregam valores, itens nem o link dos orçamentos');

    // ---- 5) login próprio; sessões não se misturam
    assert.strictEqual((await api('POST', `/api/orcamentos/${linkOrc}/login`, { corpo: { usuario: 'orc', senha: 'errada' } })).status, 401);
    assert.strictEqual((await api('POST', `/api/orcamentos/${linkGaleria}/login`, { corpo: { usuario: 'cli', senha: 'senha1234' } })).status, 404, 'o link da Pasta Cliente não é link de orçamentos');
    assert.strictEqual((await api('POST', `/api/cliente/${linkOrc}/login`, { corpo: { usuario: 'orc', senha: 'senha-orc' } })).status, 401, 'o link de orçamentos não loga na Pasta Cliente');
    r = await api('POST', `/api/orcamentos/${linkOrc}/login`, { corpo: { usuario: 'orc', senha: 'senha-orc' } });
    const tokOrc = r.json.token;
    assert.strictEqual((await api('GET', `/api/orcamentos/${linkOrc}/itens`)).status, 401);
    assert.strictEqual((await api('GET', `/api/orcamentos/${linkOrc}/itens`, { orcamento: tokGaleria })).status, 401, 'sessão da Pasta Cliente não abre orçamentos');
    assert.strictEqual((await api('GET', `/api/orcamentos/${linkOrc}/itens`, { cliente: tokOrc })).status, 401, 'o header da Pasta Cliente não vale aqui');
    assert.strictEqual((await api('GET', `/api/cliente/${linkGaleria}/galeria`, { cliente: tokOrc })).status, 401, 'sessão de orçamentos não abre a Pasta Cliente');
    assert.strictEqual((await api('GET', `/api/orcamentos/${linkOrc}/info-publica`)).json.nomeProjeto, 'APA Teste');
    assert.strictEqual((await api('GET', '/api/orcamentos/linkinexistente/info-publica')).status, 404);
    ok('login próprio; sessões das duas pastas não se misturam em nenhuma direção');

    // ---- 6) o que o cliente vê e faz
    r = await api('GET', `/api/orcamentos/${linkOrc}/itens`, { orcamento: tokOrc });
    assert.deepStrictEqual(r.json.itens.map((i) => [i.item, i.valor, i.podeMudarStatus]), [['Mármore', 1500.5, true], ['Pintura', 800, false]]);
    assert.ok(!JSON.stringify(r.json).includes('notificacoes'));
    assert.strictEqual((await api('PUT', `/api/orcamentos/${linkOrc}/itens/${idPintura}/status`, { orcamento: tokOrc, corpo: { status: 'fechado' } })).status, 400, 'item ainda em preparação');
    assert.strictEqual((await api('PUT', `/api/orcamentos/${linkOrc}/itens/${idMarmore}/status`, { orcamento: tokOrc, corpo: { status: 'a_fazer' } })).status, 400, 'status do escritório');
    assert.strictEqual((await api('PUT', `/api/orcamentos/${linkOrc}/itens/${idMarmore}/status`, { corpo: { status: 'fechado' } })).status, 401, 'sem sessão');
    assert.strictEqual((await api('GET', '/api/app/status/projOrc', { sessao: 'tokA' })).json.temComentarioNaoLido, false, 'ainda sem novidade');
    r = await api('PUT', `/api/orcamentos/${linkOrc}/itens/${idMarmore}/status`, { orcamento: tokOrc, corpo: { status: 'fechado' } });
    assert.deepStrictEqual([r.status, r.json.status], [200, 'fechado']);
    r = await api('POST', `/api/orcamentos/${linkOrc}/itens/${idMarmore}/comentarios`, { orcamento: tokOrc, corpo: { texto: 'Podem manter o prazo de 10 dias?' } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual((await api('POST', `/api/orcamentos/${linkOrc}/itens/${idMarmore}/comentarios`, { orcamento: tokOrc, corpo: { texto: '   ' } })).status, 400);
    ok('cliente: vê valores, muda status só onde pode, comenta; recusas com 400/401');

    // ---- 7) novidades chegam ao arquiteto (selo + lista) e o app limpa
    assert.strictEqual((await api('GET', '/api/app/status/projOrc', { sessao: 'tokA' })).json.temComentarioNaoLido, true, 'o selo do app acende');
    r = await api('GET', P + '/orcamentos', { sessao: 'tokA' });
    assert.deepStrictEqual(r.json.notificacoes.map((n) => [n.tipo, n.itemNome]), [['status', 'Mármore'], ['comentario', 'Mármore']]);
    assert.strictEqual(r.json.itens.find((i) => i.id === idMarmore).comentarios[0].autor, 'cliente');
    r = await api('POST', `${P}/orcamentos/itens/${idMarmore}/comentarios`, { sessao: 'tokA', corpo: { texto: 'Mantemos sim.' } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual((await api('POST', P + '/orcamentos/marcar-lido', { sessao: 'tokA' })).status, 200);
    assert.strictEqual((await api('GET', '/api/app/status/projOrc', { sessao: 'tokA' })).json.temComentarioNaoLido, false, 'selo apagado');
    r = await api('GET', `/api/orcamentos/${linkOrc}/itens`, { orcamento: tokOrc });
    assert.deepStrictEqual(r.json.itens.find((i) => i.id === idMarmore).comentarios.map((c) => c.autor), ['cliente', 'arquiteto']);
    ok('selo acende com a ação do cliente, lista "o que mudou" traz status e comentário, marcar lido apaga o selo, resposta do arquiteto aparece pro cliente');

    // ---- 8) editar/excluir pelo arquiteto
    r = await api('PUT', `${P}/orcamentos/itens/${idPintura}`, { sessao: 'tokA', corpo: { status: 'em_andamento', valor: '950,00' } });
    assert.deepStrictEqual([r.status, r.json.item.status, r.json.item.valor], [200, 'em_andamento', 950]);
    assert.strictEqual((await api('PUT', `${P}/orcamentos/itens/${idPintura}`, { sessao: 'tokA', corpo: { valor: 'lixo' } })).status, 400);
    assert.strictEqual((await api('DELETE', `${P}/orcamentos/itens/${idPintura}`, { sessao: 'tokA' })).status, 200);
    assert.strictEqual((await api('DELETE', `${P}/orcamentos/itens/${idPintura}`, { sessao: 'tokA' })).status, 400);
    // trocar a senha derruba a sessão do cliente
    await api('PUT', P + '/orcamentos/acesso', { sessao: 'tokA', corpo: { usuario: 'orc', senha: 'nova-senha' } });
    assert.strictEqual((await api('GET', `/api/orcamentos/${linkOrc}/itens`, { orcamento: tokOrc })).status, 401, 'senha nova derruba a sessão antiga');
    ok('editar, excluir e trocar a senha (derruba a sessão do cliente)');

    // ---- 9) POSSE: conta B barrada em tudo
    const antes = JSON.stringify((await api('GET', P + '/orcamentos', { sessao: 'tokA' })).json);
    for (const [m, rota, corpo] of [
      ['GET', '/orcamentos', undefined], ['PUT', '/orcamentos/acesso', { usuario: 'ladrao', senha: 'abcd' }],
      ['POST', '/orcamentos/itens', { item: 'x' }], ['PUT', `/orcamentos/itens/${idMarmore}`, { item: 'invadido' }],
      ['DELETE', `/orcamentos/itens/${idMarmore}`, undefined], ['POST', `/orcamentos/itens/${idMarmore}/comentarios`, { texto: 'x' }],
      ['POST', '/orcamentos/marcar-lido', undefined]
    ]) {
      const x = await api(m, P + rota, { sessao: 'tokB', corpo });
      assert.strictEqual(x.status, 400, `${m} ${rota}`);
      assert.match(x.json.erro, /não pertence/);
    }
    assert.strictEqual(JSON.stringify((await api('GET', P + '/orcamentos', { sessao: 'tokA' })).json), antes, 'nada mudou');
    ok('conta B barrada em TODAS as rotas de orçamentos e nada mudou');

    // ---- 10) a página
    const html = await (await fetch(`${BASE}/orcamentos?o=${linkOrc}`)).text();
    assert.match(html, /<title>APA Teste — Orçamentos<\/title>/);
    assert.match(html, /assets\/js\/orcamentos\.js\?v=\d+/);
    assert.match(html, /noindex/);
    assert.match(await (await fetch(`${BASE}/orcamentos?o=nada`)).text(), /<title>Orçamentos do seu projeto<\/title>/);
    assert.strictEqual((await fetch(`${BASE}/assets/js/orcamentos.js`)).status, 200);
    ok('página /orcamentos: título com o nome do projeto, JS versionado, noindex; link inválido não revela nada');

    console.log('\nTODOS OS TESTES DAS ROTAS DE ORÇAMENTOS PASSARAM');
  } finally {
    encerrar();
    fs.rmSync(TMP, { recursive: true, force: true });
  }
})().catch((e) => { console.error('FALHOU:', e && e.stack || e); process.exit(1); });
