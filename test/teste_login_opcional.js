// Login do cliente OPCIONAL (Pasta do Cliente e Orçamentos), por HTTP real: ligar/desligar quando quiser, sem abrir mais do que se pediu.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'login-opcional-'));
const ARQ_DADOS = () => path.join(TMP, fs.readdirSync(TMP).find((n) => n.endsWith('.json') && fs.readFileSync(path.join(TMP, n), 'utf8').includes('"galerias"')));
const portaLivre = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });

(async () => {
  const RECURSOS = { paginaProjeto: true, orcamentos: true, memorial: true };
  const licenca = http.createServer((req, res) => {
    let corpo = ''; req.on('data', (c) => { corpo += c; });
    req.on('end', () => {
      let t = null; try { t = JSON.parse(corpo).token; } catch (e) { /* */ }
      const contas = { tokA: 'arqA', tokB: 'arqB' };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(contas[t] ? { valida: true, usuario: contas[t], limiteFotos: 50, recursos: RECURSOS } : { valida: false, recursos: RECURSOS }));
    });
  });
  await new Promise((r) => licenca.listen(0, '127.0.0.1', r));
  const porta = await portaLivre();
  const filho = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { cwd: path.join(__dirname, '..'), env: Object.assign({}, process.env, { PORT: String(porta), DADOS_DIR: TMP, ARMAZENAMENTO_LOCAL_TESTE: '1', ARMAZENAMENTO_LOCAL_DIR: path.join(TMP, 'arm'), LICENCA_SERVIDOR_URL: `http://127.0.0.1:${licenca.address().port}` }) });
  let saida = ''; filho.stdout.on('data', (d) => { saida += d; }); filho.stderr.on('data', (d) => { saida += d; });
  try {
    await new Promise((resolve, reject) => { const t0 = Date.now(); const iv = setInterval(() => { if (/rodando na porta/.test(saida)) { clearInterval(iv); resolve(); } else if (Date.now() - t0 > 15000) { clearInterval(iv); reject(new Error('servidor não subiu: ' + saida)); } }, 100); });
    const BASE = `http://127.0.0.1:${porta}`;
    const api = async (metodo, caminho, { arq, cliente, orcamento, corpo } = {}) => {
      const headers = {};
      if (arq) headers['x-sessao-token'] = arq;
      if (cliente !== undefined) headers['x-cliente-token'] = cliente;
      if (orcamento !== undefined) headers['x-orcamento-token'] = orcamento;
      if (corpo !== undefined) headers['Content-Type'] = 'application/json';
      const r = await fetch(BASE + caminho, { method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
      return { status: r.status, json: await r.json().catch(() => ({})) };
    };
    const salvar = (corpo, arq = 'tokA') => api('POST', '/api/app/galeria', { arq, corpo: Object.assign({ projetoId: 'p1' }, corpo) });
    const doArq = async (id = 'p1') => (await api('GET', `/api/app/galeria/${id}`, { arq: 'tokA' })).json;

    console.log('== 1. Pasta criada como sempre: com login, e sem o link nada abre ==');
    let r = await salvar({ nomeProjeto: 'Apto', clienteUsuario: 'cli', clienteSenha: 'senha1234' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    const link = r.json.linkToken;
    let g = await doArq();
    assert.strictEqual(g.exigirLogin, true); assert.strictEqual(g.loginOpcional, true, 'o servidor avisa que sabe ligar/desligar');
    assert.strictEqual((await api('GET', `/api/cliente/${link}/galeria`)).status, 401);
    assert.strictEqual((await api('GET', `/api/cliente/${link}/info-publica`)).json.semLogin, false);
    // galeria ANTIGA (arquivo sem o campo) continua pedindo senha
    const bruto = JSON.parse(fs.readFileSync(ARQ_DADOS(), 'utf8')); delete bruto.galerias[0].exigirLogin; fs.writeFileSync(ARQ_DADOS(), JSON.stringify(bruto));
    assert.strictEqual((await api('GET', `/api/cliente/${link}/galeria`)).status, 401, 'sem o campo = com login');
    assert.strictEqual((await doArq()).exigirLogin, true);
    const tokenCliente = (await api('POST', `/api/cliente/${link}/login`, { corpo: { usuario: 'cli', senha: 'senha1234' } })).json.token;
    assert.ok(tokenCliente);
    console.log('OK');

    console.log('== 2. Só o dono desliga; desligado, o link abre sem entrar ==');
    assert.notStrictEqual((await salvar({ exigirLogin: false }, 'tokB')).status, 200, 'outra conta não desliga');
    assert.strictEqual((await api('GET', `/api/cliente/${link}/galeria`)).status, 401);
    for (const lixo of ['false', 0, null]) assert.strictEqual((await salvar({ exigirLogin: lixo })).status, 400, 'valor estranho não desliga: ' + lixo);
    r = await salvar({ exigirLogin: false });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.strictEqual((await api('GET', `/api/cliente/${link}/info-publica`)).json.semLogin, true);
    r = await api('GET', `/api/cliente/${link}/galeria`);
    assert.strictEqual(r.status, 200); assert.strictEqual(r.json.semLogin, true); assert.ok(!r.json.modoEscritorio);
    const texto = JSON.stringify(r.json);
    for (const proibido of ['clienteUsuario', 'senha1234', 'clienteSenhaHash', 'clienteSenhaCifrada', 'sessoesClienteAtivas', '"orcamentos"']) assert.ok(!texto.includes(proibido), 'não sai: ' + proibido);
    assert.strictEqual((await api('GET', `/api/cliente/${link}/galeria`, { cliente: 'token-velho' })).status, 200, 'token velho guardado no aparelho não atrapalha');
    assert.strictEqual((await api('POST', `/api/cliente/${link}/visto`, { corpo: { secao: 'memorial' } })).status, 200);
    assert.strictEqual((await api('GET', '/api/cliente/linkqueNaoExiste/galeria')).status !== 200, true, 'sem o link certo, nada');
    const outra = await api('POST', '/api/app/galeria', { arq: 'tokA', corpo: { projetoId: 'p2', nomeProjeto: 'Outra', clienteUsuario: 'c2', clienteSenha: 'senha1234' } });
    assert.strictEqual((await api('GET', `/api/cliente/${outra.json.linkToken}/galeria`)).status, 401, 'desligar uma pasta não abre as outras');
    console.log('OK');

    console.log('== 3. Modo escritório do dashboard continua só leitura, mesmo sem login ==');
    await api('PUT', '/api/app/dashboard/senha', { arq: 'tokA', corpo: { senha: 'mestra123' } });
    const linkDash = (await api('GET', '/api/app/dashboard', { arq: 'tokA' })).json.linkToken;
    const tokDash = (await api('POST', `/api/dashboard/${linkDash}/login`, { corpo: { senha: 'mestra123' } })).json.token;
    const abrir = await fetch(`${BASE}/api/dashboard/${linkDash}/projetos/p1/abrir`, { method: 'POST', headers: { 'x-dashboard-token': tokDash } }).then((x) => x.json());
    r = await api('GET', `/api/cliente/${link}/galeria`, { cliente: abrir.token });
    assert.strictEqual(r.json.modoEscritorio, true); assert.ok(!r.json.semLogin);
    assert.strictEqual((await api('POST', `/api/cliente/${link}/fotos/qualquer/aprovar`, { cliente: abrir.token, corpo: { aprovada: true } })).status, 403, 'escritório não aprova');
    const comVencida = JSON.parse(fs.readFileSync(ARQ_DADOS(), 'utf8'));
    comVencida.galerias[0].sessoesClienteAtivas.find((s) => s.token === abrir.token).criadaEm = '2020-01-01T00:00:00.000Z';
    fs.writeFileSync(ARQ_DADOS(), JSON.stringify(comVencida));
    assert.strictEqual((await api('GET', `/api/cliente/${link}/galeria`, { cliente: abrir.token })).status, 401, 'sessão de escritório vencida não vira visitante (que poderia aprovar)');
    console.log('OK');

    console.log('== 4. Religar vale na hora; a senha de antes continua ==');
    assert.strictEqual((await salvar({ exigirLogin: true })).status, 200);
    assert.strictEqual((await api('GET', `/api/cliente/${link}/galeria`)).status, 401, 'quem estava sem login perde o acesso na hora');
    assert.strictEqual((await api('POST', `/api/cliente/${link}/visto`, { corpo: { secao: 'memorial' } })).status, 401);
    assert.strictEqual((await api('GET', `/api/cliente/${link}/galeria`, { cliente: tokenCliente })).status, 200, 'quem entrou com senha antes continua');
    assert.strictEqual((await api('POST', `/api/cliente/${link}/login`, { corpo: { usuario: 'cli', senha: 'senha1234' } })).status, 200);
    assert.strictEqual((await doArq()).clienteSenha, 'senha1234');
    console.log('OK');

    console.log('== 5. Criar a pasta já sem login; não dá pra ligar sem ter usuário e senha ==');
    r = await api('POST', '/api/app/galeria', { arq: 'tokA', corpo: { projetoId: 'p3', nomeProjeto: 'Aberta', exigirLogin: false } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    const aberto = r.json.linkToken;
    assert.strictEqual((await api('GET', `/api/cliente/${aberto}/galeria`)).status, 200);
    assert.strictEqual((await api('POST', `/api/cliente/${aberto}/login`, { corpo: { usuario: '', senha: '' } })).status, 401, 'login vazio não cria sessão (e não derruba o servidor)');
    assert.strictEqual((await api('POST', '/api/app/galeria', { arq: 'tokA', corpo: { projetoId: 'p3', exigirLogin: true } })).status, 400, 'ligar sem credenciais trancaria o cliente');
    assert.strictEqual((await api('GET', `/api/cliente/${aberto}/galeria`)).status, 200, 'a recusa não mudou nada');
    r = await api('POST', '/api/app/galeria', { arq: 'tokA', corpo: { projetoId: 'p3', exigirLogin: true, clienteUsuario: 'novo', clienteSenha: 'abcd1234' } });
    assert.strictEqual(r.status, 200); assert.strictEqual((await api('GET', `/api/cliente/${aberto}/galeria`)).status, 401);
    assert.strictEqual((await api('POST', `/api/cliente/${aberto}/login`, { corpo: { usuario: 'novo', senha: 'abcd1234' } })).status, 200);
    assert.strictEqual((await api('POST', '/api/app/galeria', { arq: 'tokA', corpo: { projetoId: 'p4', nomeProjeto: 'Sem nada' } })).status, 400, 'sem dizer nada, criar continua exigindo usuário e senha');
    console.log('OK');

    console.log('== 6. Orçamentos: interruptor próprio, independente da Pasta do Cliente ==');
    const O = '/api/app/galeria/p1/orcamentos';
    const acesso = (corpo, arq = 'tokA') => api('PUT', O + '/acesso', { arq, corpo });
    r = await acesso({ usuario: 'orc', senha: 'senha-orc' });
    const linkOrc = r.json.acesso.linkToken;
    assert.strictEqual(r.json.acesso.exigirLogin, true);
    await api('POST', O + '/itens', { arq: 'tokA', corpo: { item: 'Bancada', valor: '100', status: 'analise_cliente' } });
    const ver = (opcoes) => api('GET', `/api/orcamentos/${linkOrc}/itens`, opcoes);
    assert.strictEqual((await ver()).status, 401);
    assert.notStrictEqual((await acesso({ exigirLogin: false }, 'tokB')).status, 200, 'outra conta não desliga');
    // desligar o login da PASTA não abre os orçamentos
    await salvar({ exigirLogin: false });
    assert.strictEqual((await ver()).status, 401, 'os valores continuam protegidos');
    await salvar({ exigirLogin: true });
    r = await acesso({ exigirLogin: false });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.strictEqual((await api('GET', `/api/orcamentos/${linkOrc}/info-publica`)).json.semLogin, true);
    r = await ver();
    assert.strictEqual(r.status, 200); assert.strictEqual(r.json.itens.length, 1);
    assert.ok(!JSON.stringify(r.json).includes('senha-orc') && !JSON.stringify(r.json).includes('"usuario"'));
    const idItem = r.json.itens[0].id;
    assert.strictEqual((await api('PUT', `/api/orcamentos/${linkOrc}/itens/${idItem}/status`, { corpo: { status: 'fechado' } })).status, 200, 'sem login o cliente também aprova');
    assert.strictEqual((await api('GET', `/api/cliente/${link}/galeria`)).status, 401, 'e a Pasta continua com login');
    assert.strictEqual((await acesso({ exigirLogin: true })).status, 200);
    assert.strictEqual((await ver()).status, 401, 'religou: vale na hora');
    assert.strictEqual((await api('PUT', `/api/orcamentos/${linkOrc}/itens/${idItem}/status`, { corpo: { status: 'recusado' } })).status, 401);
    assert.strictEqual((await api('POST', `/api/orcamentos/${linkOrc}/login`, { corpo: { usuario: 'orc', senha: 'senha-orc' } })).status, 200);
    // orçamentos criados já sem login
    const O3 = '/api/app/galeria/p3/orcamentos';
    r = await api('PUT', O3 + '/acesso', { arq: 'tokA', corpo: { exigirLogin: false } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.strictEqual((await api('GET', `/api/orcamentos/${r.json.acesso.linkToken}/itens`)).status, 200);
    assert.strictEqual((await api('PUT', O3 + '/acesso', { arq: 'tokA', corpo: { exigirLogin: true } })).status, 400);
    assert.strictEqual((await api('GET', O3, { arq: 'tokA' })).json.loginOpcional, true);
    console.log('OK');

    console.log('\nTODOS OS TESTES DO LOGIN OPCIONAL PASSARAM');
  } finally { filho.kill(); licenca.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
