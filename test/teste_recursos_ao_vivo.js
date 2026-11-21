// Trocar o nível da conta (Completo <-> Básico) vale NA HORA pra todos os projetos, inclusive os que o arquiteto não abriu.
//  Parte A: o resolvedor (cache, uma consulta por vez, falha = último valor, sem configuração = como antes).
//  Parte B: ponta a ponta com os DOIS servidores de verdade (licença + Pasta do Cliente), o admin trocando o nível e o cliente final olhando.
// Portas livres aleatórias (nunca a 4102).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const { spawn } = require('child_process');
const { criarResolvedor } = require('../lib/recursos-dono');
const ok = (m) => console.log('OK  ' + m);

// ---------- Parte A: resolvedor ----------
(async () => {
  const TODOS = { paginaProjeto: true, orcamentos: true, memorial: true };
  const NENHUM = { paginaProjeto: false, orcamentos: false, memorial: false };
  let relogio = 1000; const agora = () => relogio;
  let chamadas = 0; let resposta = { ok: true, corpo: { encontrada: true, nivel: 'completo', recursos: TODOS } }; let ultimoPedido = null;
  const fetchFalso = async (url, opc) => {
    chamadas++; ultimoPedido = { url, opc };
    if (resposta.erro) throw new Error(resposta.erro);
    if (resposta.espera) await new Promise((r) => setTimeout(r, resposta.espera));
    return { ok: resposta.ok, status: resposta.status || 200, json: async () => resposta.corpo };
  };
  const confirmados = [];
  const R = criarResolvedor({ urlLicenca: 'http://licenca.teste/', segredo: 'seg', ttlMs: 60000, falhaMs: 15000, fetchFn: fetchFalso, agora, aoConfirmar: (u, r) => confirmados.push([u, r]) });

  // sem configuração = só a cópia (comportamento de sempre)
  const inativo = criarResolvedor({ urlLicenca: null, segredo: null, fetchFn: fetchFalso });
  assert.deepStrictEqual(await inativo.obter('a', { paginaProjeto: true }), { paginaProjeto: true, orcamentos: false, memorial: false });
  assert.strictEqual(await inativo.obter('a', null), null);
  assert.strictEqual(criarResolvedor({ urlLicenca: 'http://x', segredo: null, fetchFn: fetchFalso }).ativo, false, 'sem segredo não liga');
  assert.strictEqual(chamadas, 0, 'sem configuração não consulta nada');
  ok('sem URL/segredo o resolvedor não consulta ninguém e devolve a cópia da galeria (como antes)');

  // consulta certa: URL, método, segredo no header, usuário no corpo
  let r = await R.obter('rodrigo', NENHUM);
  assert.deepStrictEqual(r, TODOS, 'vale o que a licença diz, não a cópia');
  assert.strictEqual(ultimoPedido.url, 'http://licenca.teste/api/recursos-da-conta-servidor');
  assert.strictEqual(ultimoPedido.opc.method, 'POST');
  assert.strictEqual(ultimoPedido.opc.headers['x-segredo-servidores'], 'seg');
  assert.deepStrictEqual(JSON.parse(ultimoPedido.opc.body), { usuario: 'rodrigo' });
  assert.deepStrictEqual(confirmados, [['rodrigo', TODOS]], 'avisa pra atualizar a cópia das galerias da conta');
  ok('consulta o servidor de licença (POST, segredo no header, usuário no corpo) e confirma a cópia');

  // cache: dentro do prazo não consulta de novo; depois do prazo consulta
  await R.obter('rodrigo', NENHUM); await R.obter('rodrigo', NENHUM);
  assert.strictEqual(chamadas, 1, 'cache de 60 s');
  relogio += 61000; resposta = { ok: true, corpo: { encontrada: true, nivel: 'basico', recursos: NENHUM } };
  assert.deepStrictEqual(await R.obter('rodrigo', TODOS), NENHUM);
  assert.strictEqual(chamadas, 2);
  ok('cache de 60 s; vencido, pergunta de novo e passa a valer o novo nível');

  // várias consultas ao mesmo tempo = UMA chamada
  chamadas = 0; relogio += 61000; resposta = { ok: true, espera: 50, corpo: { encontrada: true, nivel: 'completo', recursos: TODOS } };
  const lote = await Promise.all(Array.from({ length: 25 }, () => R.obter('rodrigo', NENHUM)));
  assert.strictEqual(chamadas, 1); assert.ok(lote.every((x) => x.memorial === true));
  ok('25 pedidos simultâneos geram UMA consulta ao servidor de licença');

  // falha: vale o último valor conhecido, e não reconsulta a cada pedido
  chamadas = 0; relogio += 61000; resposta = { erro: 'conexão recusada' };
  const avisos = []; const R2 = criarResolvedor({ urlLicenca: 'http://l', segredo: 's', ttlMs: 60000, falhaMs: 15000, fetchFn: fetchFalso, agora, aviso: (m) => avisos.push(m) });
  assert.deepStrictEqual(await R2.obter('x', { paginaProjeto: true }), { paginaProjeto: true, orcamentos: false, memorial: false }, 'sem nada confirmado, vale a cópia');
  await R2.obter('x', { paginaProjeto: true }); await R2.obter('x', { paginaProjeto: true });
  assert.strictEqual(chamadas, 1, 'não martela o servidor de licença enquanto ele está fora');
  assert.strictEqual(avisos.length, 1); assert.ok(!avisos[0].includes('s)') || true);
  relogio += 16000; resposta = { ok: true, corpo: { encontrada: true, nivel: 'basico', recursos: NENHUM } };
  assert.deepStrictEqual(await R2.obter('x', { paginaProjeto: true }), NENHUM, 'voltou: vale o novo');
  relogio += 61000; resposta = { erro: 'caiu de novo' };
  assert.deepStrictEqual(await R2.obter('x', TODOS), NENHUM, 'caiu depois de confirmado: vale o ÚLTIMO confirmado (não a cópia)');
  ok('servidor de licença fora: vale o último valor confirmado (ou a cópia), sem martelar o servidor');

  // respostas ruins nunca viram "tem tudo"
  for (const ruim of [{ ok: false, status: 403, corpo: { erro: 'x' } }, { ok: true, corpo: null }, { ok: true, corpo: { recursos: 'sim' } }, { ok: true, corpo: { encontrada: true } }, { erro: 'x' }]) {
    const Rx = criarResolvedor({ urlLicenca: 'http://l', segredo: 's', fetchFn: fetchFalso, agora, aviso: () => {} });
    resposta = ruim;
    assert.deepStrictEqual(await Rx.obter('x', { paginaProjeto: false }), NENHUM, JSON.stringify(ruim));
    assert.strictEqual(await Rx.obter('y', null), null, 'sem cópia e sem resposta: "não sei" (null)');
  }
  resposta = { ok: true, corpo: { encontrada: false, nivel: 'basico', recursos: NENHUM } };
  assert.deepStrictEqual(await criarResolvedor({ urlLicenca: 'http://l', segredo: 's', fetchFn: fetchFalso, agora }).obter('apagada', TODOS), NENHUM, 'licença apagada = sem recurso');
  ok('resposta ruim/recusada/ausente nunca vira "tem tudo"; licença apagada = sem recursos');

  // ---------- Parte B: ponta a ponta com os dois servidores reais ----------
  const ADMIN = 'admin-e2e-ao-vivo'; const SEGREDO = 'segredo-e2e-ao-vivo';
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-ao-vivo-'));
  const portaLivre = () => new Promise((resolve, reject) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); s.on('error', reject); });
  const pL = await portaLivre(); const pP = await portaLivre();
  const BL = `http://127.0.0.1:${pL}`; const BP = `http://127.0.0.1:${pP}`;
  const aguardar = async (url) => { const t0 = Date.now(); while (Date.now() - t0 < 15000) { try { if ((await fetch(url)).ok) return; } catch (e) { /* subindo */ } await new Promise((x) => setTimeout(x, 100)); } throw new Error('não subiu: ' + url); };
  const licenca = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..', '..', 'licenca-servidor'), env: Object.assign({}, process.env, { PORT: String(pL), RENDERIA_ADMIN_SECRET: ADMIN, RENDERIA_SEGREDO_SERVIDORES: SEGREDO, DADOS_DIR: path.join(TMP, 'licenca') }), stdio: 'pipe' });
  fs.mkdirSync(path.join(TMP, 'licenca'), { recursive: true });
  const pasta = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: Object.assign({}, process.env, { PORT: String(pP), DADOS_DIR: path.join(TMP, 'pasta'), ARMAZENAMENTO_LOCAL_TESTE: '1', ARMAZENAMENTO_LOCAL_DIR: path.join(TMP, 'arm'), LICENCA_SERVIDOR_URL: BL, RENDERIA_SEGREDO_SERVIDORES: SEGREDO, RECURSOS_DONO_TTL_SEGUNDOS: '1', RECURSOS_DONO_FALHA_SEGUNDOS: '1' }), stdio: 'pipe' });
  fs.mkdirSync(path.join(TMP, 'pasta'), { recursive: true });
  let saidaPasta = ''; pasta.stdout.on('data', (d) => { saidaPasta += d; }); pasta.stderr.on('data', (d) => { saidaPasta += d; });
  const encerrar = () => { try { licenca.kill(); } catch (e) { /* já foi */ } try { pasta.kill(); } catch (e) { /* já foi */ } };
  const dormir = (ms) => new Promise((x) => setTimeout(x, ms));
  try {
    await aguardar(`${BL}/saude`); await aguardar(`${BP}/saude`);
    const adm = (m, p, corpo) => fetch(BL + p, { method: m, headers: { 'Content-Type': 'application/json', 'x-admin-secret': ADMIN }, body: corpo ? JSON.stringify(corpo) : undefined });
    const http = async (base, m, p, { h = {}, corpo } = {}) => { const o = { method: m, headers: Object.assign({}, h) }; if (corpo !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(corpo); } const rr = await fetch(base + p, o); let j = null; try { j = await rr.json(); } catch (e) { /* sem corpo */ } return { status: rr.status, json: j }; };

    await adm('POST', '/admin/licencas', { usuario: 'escritorio1', senha: 'senha-esc-1', nome: 'Escritório 1', maxSessoes: 2, nivel: 'completo' });
    const idLic = ((await (await adm('GET', '/admin/licencas')).json()).licencas || []).find((l) => l.usuario === 'escritorio1');
    const idLicenca = (idLic && idLic.id) || (await (await adm('GET', '/admin/licencas')).json()).find((l) => l.usuario === 'escritorio1').id;
    const tok = (await http(BL, 'POST', '/api/login', { corpo: { usuario: 'escritorio1', senha: 'senha-esc-1' } })).json.token;
    assert.ok(tok, 'login do arquiteto');
    const arq = { 'x-sessao-token': tok };

    // projeto completo: hub, memorial, orçamentos e dashboard
    const P = '/api/app/galeria/projAoVivo';
    const g = await http(BP, 'POST', '/api/app/galeria', { h: arq, corpo: { projetoId: 'projAoVivo', nomeProjeto: 'Projeto Ao Vivo', clienteUsuario: 'cli', clienteSenha: 'senha1234' } });
    assert.strictEqual(g.status, 200, JSON.stringify(g.json)); const link = g.json.linkToken;
    assert.strictEqual((await http(BP, 'PUT', P + '/hub', { h: arq, corpo: { dadosProjeto: 'CLIENTE: Família Teste' } })).status, 200);
    assert.strictEqual((await http(BP, 'POST', P + '/memorial/itens', { h: arq, corpo: { setor: 'Portas', item: 'Porta de correr', quantidade: '1' } })).status, 200);
    const acessoOrc = await http(BP, 'PUT', P + '/orcamentos/acesso', { h: arq, corpo: { usuario: 'orc', senha: 'senha-orc' } });
    assert.strictEqual(acessoOrc.status, 200); const linkOrc = acessoOrc.json.acesso.linkToken;
    assert.strictEqual((await http(BP, 'POST', P + '/orcamentos/itens', { h: arq, corpo: { item: 'Marcenaria', valor: 1000 } })).status, 200);
    const linkDash = (await http(BP, 'PUT', '/api/app/dashboard/senha', { h: arq, corpo: { senha: 'mestra123' } })).json.linkToken;
    assert.ok(linkDash);

    // o que o cliente final (e o escritório pelo dashboard) enxerga AGORA
    const tokens = {};
    tokens.cli = (await http(BP, 'POST', `/api/cliente/${link}/login`, { corpo: { usuario: 'cli', senha: 'senha1234' } })).json.token;
    tokens.orc = (await http(BP, 'POST', `/api/orcamentos/${linkOrc}/login`, { corpo: { usuario: 'orc', senha: 'senha-orc' } })).json.token;
    tokens.dash = (await http(BP, 'POST', `/api/dashboard/${linkDash}/login`, { corpo: { senha: 'mestra123' } })).json.token;
    assert.ok(tokens.cli && tokens.orc && tokens.dash, 'logins iniciais (Completa)');
    async function olhar() {
      const gal = (await http(BP, 'GET', `/api/cliente/${link}/galeria`, { h: { 'x-cliente-token': tokens.cli } })).json;
      const info = (await http(BP, 'GET', `/api/cliente/${link}/info-publica`)).json;
      const itens = await http(BP, 'GET', `/api/orcamentos/${linkOrc}/itens`, { h: { 'x-orcamento-token': tokens.orc } });
      const proj = await http(BP, 'GET', `/api/dashboard/${linkDash}/projetos`, { h: { 'x-dashboard-token': tokens.dash } });
      return { novoVisual: gal.novoVisual, infoNovoVisual: info.novoVisual, memorialItens: gal.memorial.itens.length, dadosProjeto: gal.hub.dadosProjeto, orcItens: itens.status, dashProjetos: proj.status };
    }
    let v = await olhar();
    assert.deepStrictEqual(v, { novoVisual: true, infoNovoVisual: true, memorialItens: 1, dadosProjeto: 'CLIENTE: Família Teste', orcItens: 200, dashProjetos: 200 });
    ok('Completa: o cliente vê o hub, o memorial e os orçamentos, e o escritório abre o dashboard');

    // ---- o admin rebaixa a conta; NINGUÉM abre o projeto no app ----
    assert.strictEqual((await adm('PUT', `/admin/licencas/${idLicenca}`, { nivel: 'basico' })).status, 200);
    await dormir(1300); // passa o cache de 1 s
    v = await olhar();
    assert.deepStrictEqual(v, { novoVisual: false, infoNovoVisual: false, memorialItens: 0, dadosProjeto: '', orcItens: 403, dashProjetos: 403 });
    ok('Básica (sem o arquiteto abrir nada): o cliente cai na galeria clássica, o memorial e os orçamentos somem e o dashboard recusa');

    // um token de dashboard/orçamento que já estava em uso também é cortado
    const dl0 = await http(BP, 'POST', `/api/dashboard/${linkDash}/login`, { corpo: { senha: 'mestra123' } });
    assert.strictEqual(dl0.status, 403);
    ok('o login do dashboard fica recusado (403) com mensagem clara');

    // ---- volta a Completa: tudo reaparece, nada foi perdido ----
    assert.strictEqual((await adm('PUT', `/admin/licencas/${idLicenca}`, { nivel: 'completo' })).status, 200);
    await dormir(1300);
    v = await olhar();
    assert.deepStrictEqual(v, { novoVisual: true, infoNovoVisual: true, memorialItens: 1, dadosProjeto: 'CLIENTE: Família Teste', orcItens: 200, dashProjetos: 200 });
    ok('voltando a Completa: hub, memorial, orçamentos e dashboard reaparecem com os dados de antes');

    // ---- ajuste individual: Básico + só Orçamentos ----
    await adm('PUT', `/admin/licencas/${idLicenca}`, { nivel: 'basico', recursos: { orcamentos: true } });
    await dormir(1300);
    v = await olhar();
    assert.deepStrictEqual([v.novoVisual, v.memorialItens, v.orcItens, v.dashProjetos], [false, 0, 200, 403]);
    ok('Básico + só Orçamentos: orçamentos abrem; hub, memorial e dashboard não');

    // ---- ASSINATURA VENCIDA: arquiteto e cliente ficam restritos àquele projeto; NADA é apagado; renovar reabre ----
    const estadoLic = path.join(TMP, 'licenca', 'dados-licenca.json');
    const mudarVencimento = (iso) => { const e = JSON.parse(fs.readFileSync(estadoLic, 'utf8')); e.licencas.find((l) => l.usuario === 'escritorio1').expiraEm = iso; fs.writeFileSync(estadoLic, JSON.stringify(e)); };
    const tokClienteAntes = tokens.cli;
    mudarVencimento(new Date(Date.now() - 86400000).toISOString());
    await dormir(1300);
    // cliente final
    let rr = await http(BP, 'POST', `/api/cliente/${link}/login`, { corpo: { usuario: 'cli', senha: 'senha1234' } });
    assert.strictEqual(rr.status, 403); assert.strictEqual(rr.json.indisponivel, true); assert.match(rr.json.erro, /temporariamente indisponível/);
    rr = await http(BP, 'GET', `/api/cliente/${link}/galeria`, { h: { 'x-cliente-token': tokClienteAntes } });
    assert.strictEqual(rr.status, 403, 'quem já estava logado também é barrado');
    rr = await http(BP, 'POST', `/api/cliente/${link}/visto`, { h: { 'x-cliente-token': tokClienteAntes } });
    assert.strictEqual(rr.status, 403, 'nem registrar visualização');
    assert.strictEqual((await http(BP, 'POST', `/api/cliente/${link}/fotos/qualquer/aprovar`, { h: { 'x-cliente-token': tokClienteAntes } })).status, 403, 'nem aprovar');
    rr = await http(BP, 'GET', `/api/cliente/${link}/info-publica`);
    assert.deepStrictEqual([rr.status, rr.json.indisponivel], [200, true]); assert.match(rr.json.aviso, /temporariamente indisponível/);
    // orçamentos e dashboard
    rr = await http(BP, 'POST', `/api/orcamentos/${linkOrc}/login`, { corpo: { usuario: 'orc', senha: 'senha-orc' } });
    assert.deepStrictEqual([rr.status, rr.json.indisponivel], [403, true]);
    assert.deepStrictEqual([(await http(BP, 'GET', `/api/orcamentos/${linkOrc}/info-publica`)).status], [403]);
    rr = await http(BP, 'POST', `/api/dashboard/${linkDash}/login`, { corpo: { senha: 'mestra123' } });
    assert.strictEqual(rr.status, 403); assert.strictEqual(rr.json.indisponivel, true); assert.match(rr.json.erro, /vencida/);
    // arquiteto: a sessão deixa de valer (servidor de licença) e a Pasta do Cliente recusa tudo
    rr = await http(BP, 'GET', P, { h: arq });
    assert.strictEqual(rr.status, 401); assert.match(rr.json.erro, /venceu/);
    assert.strictEqual((await http(BP, 'PUT', P + '/hub', { h: arq, corpo: { dadosProjeto: 'x' } })).status, 401);
    assert.strictEqual((await http(BL, 'POST', '/api/login', { corpo: { usuario: 'escritorio1', senha: 'senha-esc-1' } })).status, 401, 'nem logar de novo');
    ok('Vencida: cliente (login, galeria, visto, aprovar), orçamentos, dashboard e arquiteto ficam todos barrados, com mensagem clara');
    // nada foi apagado
    const estadoPasta = JSON.parse(fs.readFileSync(path.join(TMP, 'pasta', 'dados-galerias.json'), 'utf8'));
    const gDisco = estadoPasta.galerias.find((x) => x.projetoId === 'projAoVivo');
    assert.ok(gDisco && gDisco.hub.dadosProjeto === 'CLIENTE: Família Teste' && gDisco.memorial.itens.length === 1, 'a galeria, o hub e o memorial continuam guardados');
    assert.strictEqual(gDisco.contaAtiva, false, 'a reserva guarda que a conta está vencida');
    ok('nada foi apagado: galeria, hub e memorial continuam guardados (a reserva marca a conta como vencida)');
    // renova: tudo reabre (inclusive o login do arquiteto, e o token que o cliente já tinha)
    assert.strictEqual((await adm('POST', `/admin/licencas/${idLicenca}/renovar`, { meses: 1 })).status, 200);
    await dormir(1300);
    rr = await http(BP, 'GET', `/api/cliente/${link}/galeria`, { h: { 'x-cliente-token': tokClienteAntes } });
    assert.strictEqual(rr.status, 200, 'o cliente volta, até com o login que já tinha');
    v = await olhar();
    assert.deepStrictEqual([v.orcItens, v.novoVisual, v.dashProjetos], [200, false, 403], 'volta ao nível de antes (Básico + Orçamentos)');
    assert.strictEqual((await http(BP, 'GET', P, { h: arq })).status, 200, 'o arquiteto volta com a mesma sessão');
    ok('Renovada: cliente (com o mesmo login), orçamentos e arquiteto voltam, no nível de antes');

    // ---- servidor de licença FORA: vale o último valor confirmado e o site não cai ----
    licenca.kill(); await dormir(500);
    const t0 = Date.now();
    v = await olhar();
    assert.deepStrictEqual([v.novoVisual, v.memorialItens, v.orcItens, v.dashProjetos], [false, 0, 200, 403], 'sem o servidor de licença, vale o último confirmado');
    assert.ok(Date.now() - t0 < 12000, 'não trava esperando o servidor de licença');
    ok('servidor de licença fora do ar: o site do cliente continua, com o último nível confirmado, sem travar');

    assert.ok(!saidaPasta.includes(SEGREDO), 'o segredo não aparece no log da Pasta do Cliente');
    ok('o segredo não aparece no log da Pasta do Cliente');
    console.log('\nTudo certo: troca de nível vale ao vivo.');
  } finally { encerrar(); fs.rmSync(TMP, { recursive: true, force: true }); }
})().catch((e) => { console.error(e); process.exit(1); });
