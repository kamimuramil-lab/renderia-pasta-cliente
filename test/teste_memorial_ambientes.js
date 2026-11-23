// Ambientes do memorial editáveis (nov/2026): a lista fica na CONTA (licença) -- vale pra todos os projetos e pra todo computador com
// o mesmo login; outra conta não é afetada. Acrescentar, renomear (os itens acompanham, em todos os projetos), excluir (a etiqueta dos
// itens que já usavam FICA) e restaurar os 27 padrão. HTTP de verdade; licença FALSA; porta livre aleatória (nunca a 4102).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-memorial-amb-'));
const ARM = path.join(TMP, 'arm');
const ok = (m) => console.log('OK  ' + m);
const portaLivre = () => new Promise((resolve, reject) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); s.on('error', reject); });
const TUDO = { paginaProjeto: true, orcamentos: true, memorial: true };
const SEM = { paginaProjeto: true, orcamentos: true, memorial: false };

(async () => {
  // tokA e tokA2 = o MESMO login em dois computadores; tokB = outra conta
  const contas = { tokA: { usuario: 'arqA', recursos: TUDO }, tokA2: { usuario: 'arqA', recursos: TUDO }, tokASem: { usuario: 'arqA', recursos: SEM }, tokB: { usuario: 'arqB', recursos: TUDO } };
  const licenca = http.createServer((req, res) => {
    let corpo = ''; req.on('data', (c) => { corpo += c; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      let token = null; try { token = JSON.parse(corpo).token; } catch (e) { /* vazio */ }
      const c = contas[token];
      res.end(JSON.stringify(c ? Object.assign({ valida: true, limiteFotos: 50 }, c) : { valida: false, motivo: 'Sessão inválida.' }));
    });
  });
  await new Promise((r) => licenca.listen(0, '127.0.0.1', r));
  const porta = await portaLivre();
  const filho = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { cwd: path.join(__dirname, '..'), env: Object.assign({}, process.env, {
    PORT: String(porta), DADOS_DIR: TMP, ARMAZENAMENTO_LOCAL_TESTE: '1', ARMAZENAMENTO_LOCAL_DIR: ARM, LICENCA_SERVIDOR_URL: `http://127.0.0.1:${licenca.address().port}` }) });
  let saida = ''; filho.stdout.on('data', (d) => { saida += d; }); filho.stderr.on('data', (d) => { saida += d; });
  await new Promise((resolve, reject) => { const t0 = Date.now(); const iv = setInterval(() => { if (/rodando na porta/.test(saida)) { clearInterval(iv); resolve(); } else if (Date.now() - t0 > 15000) { clearInterval(iv); reject(new Error('o servidor não subiu: ' + saida)); } }, 100); });
  const BASE = `http://127.0.0.1:${porta}`;
  const api = async (metodo, caminho, { sessao, cliente, corpo } = {}) => {
    const opcoes = { method: metodo, headers: {} };
    if (sessao) opcoes.headers['x-sessao-token'] = sessao;
    if (cliente) opcoes.headers['x-cliente-token'] = cliente;
    if (corpo !== undefined) { opcoes.headers['Content-Type'] = 'application/json'; opcoes.body = JSON.stringify(corpo); }
    const r = await fetch(BASE + caminho, opcoes);
    let json = null; try { json = await r.json(); } catch (e) { /* sem corpo */ }
    return { status: r.status, json };
  };
  const AMB = '/api/app/memorial/ambientes';
  const memorial = async (sessao, proj) => (await api('GET', `/api/app/galeria/${proj}/memorial`, { sessao })).json;
  const novoItem = (sessao, proj, corpo) => api('POST', `/api/app/galeria/${proj}/memorial/itens`, { sessao, corpo: Object.assign({ setor: 'Metais', item: 'Torneira' }, corpo) });

  try {
    console.log('== 1. Sem o recurso "memorial": 403 nas 5 rotas ==');
    for (const [m, rota, corpo] of [['GET', '', undefined], ['POST', '', { nome: 'X' }], ['POST', '/renomear', { de: 'AS', para: 'Y' }], ['POST', '/excluir', { nome: 'AS' }], ['POST', '/restaurar', {}]]) {
      const x = await api(m, AMB + rota, { sessao: 'tokASem', corpo });
      assert.strictEqual(x.status, 403, `${m} ${rota}`);
    }
    assert.strictEqual((await api('GET', AMB, {})).status, 401, 'sem sessão: 401');
    ok('sem o recurso (403) e sem sessão (401)');

    console.log('== 2. Conta nova: os 27 padrão, e é o que o memorial mostra ==');
    let r = await api('GET', AMB, { sessao: 'tokA' });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.json.ambientes.length, 27); assert.deepStrictEqual(r.json.usos, {}); assert.strictEqual(r.json.padrao.length, 27);
    for (const [proj, tok, nome] of [['projA1', 'tokA', 'Projeto A1'], ['projA2', 'tokA', 'Projeto A2'], ['projB1', 'tokB', 'Projeto B1']]) {
      assert.strictEqual((await api('POST', '/api/app/galeria', { sessao: tok, corpo: { projetoId: proj, nomeProjeto: nome, clienteUsuario: 'cli' + proj, clienteSenha: 'senha1234' } })).status, 200);
    }
    assert.strictEqual((await memorial('tokA', 'projA1')).ambientes.length, 27);
    ok('27 padrão na conta nova e no memorial');

    console.log('== 3. Acrescentar: validações ==');
    r = await api('POST', AMB, { sessao: 'tokA', corpo: { nome: '  Varanda   gourmet ' } });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.json.ambientes.length, 28); assert.strictEqual(r.json.ambientes[27], 'Varanda gourmet', 'espaços acertados, vai pro fim');
    for (const [corpo, re] of [[{ nome: 'varanda GOURMET' }, /Já existe/], [{ nome: 'b.01' }, /Já existe/], [{ nome: '   ' }, /Dê um nome/], [{ nome: 'x'.repeat(25) }, /passa de 24/], [{}, /Dê um nome/]]) {
      r = await api('POST', AMB, { sessao: 'tokA', corpo });
      assert.strictEqual(r.status, 400); assert.match(r.json.erro, re);
    }
    ok('acrescenta (limpa espaços); recusa repetido (sem diferenciar maiúscula), vazio e longo demais');

    console.log('== 4. Vale pro MESMO login em outro computador e em todos os projetos; outra conta não muda ==');
    assert.strictEqual((await api('GET', AMB, { sessao: 'tokA2' })).json.ambientes.length, 28, 'o outro computador (mesmo login) vê a lista nova');
    assert.ok((await memorial('tokA2', 'projA2')).ambientes.includes('Varanda gourmet'), 'e em outro projeto da conta');
    assert.strictEqual((await api('GET', AMB, { sessao: 'tokB' })).json.ambientes.length, 27, 'outra conta continua com os padrão');
    assert.ok(!(await memorial('tokB', 'projB1')).ambientes.includes('Varanda gourmet'));
    ok('mesmo login em 2 computadores e 2 projetos: lista igual; outra conta intacta');

    console.log('== 5. Itens: só ambientes da lista ==');
    r = await novoItem('tokA', 'projA1', { ambientes: ['Varanda gourmet', 'CZ'] });
    assert.strictEqual(r.status, 200); assert.deepStrictEqual(r.json.item.ambientes, ['CZ', 'Varanda gourmet'], 'na ordem da lista');
    const item1 = r.json.item;
    r = await novoItem('tokA', 'projA2', { item: 'Chuveiro', ambientes: ['Varanda gourmet', 'B.01'] });
    assert.strictEqual(r.status, 200);
    r = await novoItem('tokB', 'projB1', { ambientes: ['Varanda gourmet'] });
    assert.strictEqual(r.status, 400); assert.match(r.json.erro, /Ambiente desconhecido/, 'a outra conta não tem esse ambiente');
    r = await novoItem('tokA', 'projA1', { ambientes: ['ZZ'] });
    assert.strictEqual(r.status, 400);
    ok('item aceita os da lista (inclusive o novo); recusa os que não existem na conta');

    console.log('== 6. Renomear: itens de TODOS os projetos da conta acompanham ==');
    r = await api('GET', AMB, { sessao: 'tokA' });
    assert.strictEqual(r.json.usos['Varanda gourmet'], 2, 'usado em 2 itens (2 projetos)');
    r = await api('POST', AMB + '/renomear', { sessao: 'tokA', corpo: { de: 'Varanda gourmet', para: 'Área gourmet' } });
    assert.strictEqual(r.status, 200); assert.ok(r.json.ambientes.includes('Área gourmet') && !r.json.ambientes.includes('Varanda gourmet'));
    assert.strictEqual(r.json.ambientes.indexOf('Área gourmet'), 27, 'mantém a posição');
    assert.strictEqual(r.json.usos['Área gourmet'], 2); assert.ok(!r.json.usos['Varanda gourmet']);
    assert.deepStrictEqual((await memorial('tokA', 'projA1')).itens[0].ambientes, ['CZ', 'Área gourmet']);
    assert.deepStrictEqual((await memorial('tokA', 'projA2')).itens[0].ambientes, ['B.01', 'Área gourmet']);
    for (const [corpo, re] of [[{ de: 'Nada', para: 'Y' }, /não encontrado/], [{ de: 'Área gourmet', para: 'cz' }, /Já existe/], [{ de: 'Área gourmet', para: '' }, /Dê um nome/]]) {
      r = await api('POST', AMB + '/renomear', { sessao: 'tokA', corpo });
      assert.strictEqual(r.status, 400); assert.match(r.json.erro, re);
    }
    r = await api('POST', AMB + '/renomear', { sessao: 'tokA', corpo: { de: 'Área gourmet', para: 'ÁREA GOURMET' } }); // só maiúsculas no próprio nome: permitido
    assert.strictEqual(r.status, 200);
    await api('POST', AMB + '/renomear', { sessao: 'tokA', corpo: { de: 'ÁREA GOURMET', para: 'Área gourmet' } });
    ok('renomear atualiza os itens dos 2 projetos; recusa inexistente, repetido e vazio; trocar só maiúsculas pode');

    console.log('== 7. Excluir: sai da lista, mas a etiqueta dos itens que já usavam FICA ==');
    r = await api('POST', AMB + '/excluir', { sessao: 'tokA', corpo: { nome: 'CZ' } });
    assert.strictEqual(r.status, 200); assert.ok(!r.json.ambientes.includes('CZ')); assert.strictEqual(r.json.usos.CZ, 1, 'ainda aparece em uso (1 item)');
    let m1 = await memorial('tokA', 'projA1');
    assert.ok(!m1.ambientes.includes('CZ'));
    assert.deepStrictEqual([...m1.itens[0].ambientes].sort(), ['CZ', 'Área gourmet'].sort(), 'o item continua com as duas etiquetas, inclusive a excluída da lista');
    r = await api('PUT', `/api/app/galeria/projA1/memorial/itens/${item1.id}`, { sessao: 'tokA', corpo: { ambientes: ['CZ', 'Área gourmet', 'B.01'], empresa: 'Docol' } });
    assert.strictEqual(r.status, 200, 'salvar o item de novo mantendo a etiqueta excluída funciona: ' + JSON.stringify(r.json));
    assert.deepStrictEqual(r.json.item.ambientes, ['B.01', 'Área gourmet', 'CZ']);
    r = await api('PUT', `/api/app/galeria/projA1/memorial/itens/${item1.id}`, { sessao: 'tokA', corpo: { ambientes: ['Área gourmet', 'B.01'] } });
    assert.deepStrictEqual(r.json.item.ambientes, ['B.01', 'Área gourmet'], 'desmarcar tira de vez');
    r = await novoItem('tokA', 'projA1', { item: 'Outro', ambientes: ['CZ'] });
    assert.strictEqual(r.status, 400, 'item NOVO não pode mais escolher o excluído');
    r = await api('PUT', `/api/app/galeria/projA1/memorial/itens/${item1.id}`, { sessao: 'tokA', corpo: { ambientes: ['CZ'] } });
    assert.strictEqual(r.status, 400, 'nem um item que já tirou a etiqueta');
    ok('excluir tira só da lista; item que já usava continua (e pode ser salvo); só novas escolhas são barradas');

    console.log('== 8. Excluir o último é recusado; restaurar volta os 27 ==');
    let lista = (await api('GET', AMB, { sessao: 'tokA' })).json.ambientes.slice();
    while (lista.length > 1) { r = await api('POST', AMB + '/excluir', { sessao: 'tokA', corpo: { nome: lista.pop() } }); assert.strictEqual(r.status, 200); }
    r = await api('POST', AMB + '/excluir', { sessao: 'tokA', corpo: { nome: lista[0] } });
    assert.strictEqual(r.status, 400); assert.match(r.json.erro, /pelo menos um/);
    r = await api('POST', AMB + '/restaurar', { sessao: 'tokA2', corpo: {} });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.json.ambientes.length, 27); assert.ok(r.json.ambientes.includes('CZ'));
    assert.strictEqual((await api('GET', AMB, { sessao: 'tokA' })).json.ambientes.length, 27, 'restaurado num computador, vale no outro');
    assert.ok((await memorial('tokA', 'projA2')).itens[0].ambientes.includes('Área gourmet'), 'restaurar não mexe nas etiquetas dos itens');
    ok('sempre sobra 1; restaurar volta os 27 padrão sem tocar nos itens');

    console.log('== 9. Limite de 60 ==');
    for (let i = 0; i < 33; i++) { r = await api('POST', AMB, { sessao: 'tokA', corpo: { nome: 'Amb ' + i } }); assert.strictEqual(r.status, 200, 'amb ' + i); }
    r = await api('POST', AMB, { sessao: 'tokA', corpo: { nome: 'Passou' } });
    assert.strictEqual(r.status, 400); assert.match(r.json.erro, /No máximo 60/);
    ok('no máximo 60 ambientes');

    console.log('== 9b. Mover pra cima/baixo (a etiqueta dos itens segue a ordem) ==');
    await api('POST', AMB + '/restaurar', { sessao: 'tokA', corpo: {} });
    await api('POST', AMB, { sessao: 'tokA', corpo: { nome: 'Varanda' } }); // nasce no fim
    const itemMov = (await novoItem('tokA', 'projA1', { item: 'Mov', ambientes: ['AS', 'Varanda'] })).json.item;
    assert.deepStrictEqual(itemMov.ambientes, ['AS', 'Varanda']);
    r = await api('POST', AMB + '/mover', { sessao: 'tokA', corpo: { nome: 'Varanda', direcao: 'cima' } });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.json.ambientes[26], 'Varanda'); assert.strictEqual(r.json.ambientes[27], 'C.01');
    for (let k = 0; k < 40; k++) await api('POST', AMB + '/mover', { sessao: 'tokA2', corpo: { nome: 'Varanda', direcao: 'cima' } }); // vale do outro computador; para no topo
    r = await api('GET', AMB, { sessao: 'tokA' });
    assert.strictEqual(r.json.ambientes[0], 'Varanda', 'chegou ao topo e parou (sem erro)');
    assert.strictEqual(r.json.ambientes.length, 28);
    const movido = (await memorial('tokA', 'projA1')).itens.find((i) => i.id === itemMov.id);
    assert.deepStrictEqual(movido.ambientes, ['Varanda', 'AS'], 'a etiqueta do item acompanha a ordem nova da lista');
    r = await api('POST', AMB + '/mover', { sessao: 'tokA', corpo: { nome: 'Varanda', direcao: 'baixo' } });
    assert.strictEqual(r.json.ambientes[0], 'AS'); assert.strictEqual(r.json.ambientes[1], 'Varanda');
    for (const [corpo, re] of [[{ nome: 'Nada', direcao: 'cima' }, /não encontrado/], [{ nome: 'AS', direcao: 'lado' }, /Direção inválida/]]) {
      r = await api('POST', AMB + '/mover', { sessao: 'tokA', corpo }); assert.strictEqual(r.status, 400); assert.match(r.json.erro, re);
    }
    assert.strictEqual((await api('POST', AMB + '/mover', { sessao: 'tokASem', corpo: { nome: 'AS', direcao: 'cima' } })).status, 403);
    assert.strictEqual((await api('GET', AMB, { sessao: 'tokB' })).json.ambientes[0], 'AS', 'outra conta não muda');
    ok('mover sobe/desce, para na ponta, vale nos 2 computadores, reordena as etiquetas dos itens, recusa inválidos e sem recurso');
    await api('POST', AMB + '/restaurar', { sessao: 'tokA', corpo: {} });

    console.log('== 10. O cliente continua vendo as etiquetas dos itens ==');
    const link = (await api('GET', '/api/app/galeria/projA2', { sessao: 'tokA' })).json.linkToken;
    const tokCli = (await api('POST', `/api/cliente/${link}/login`, { corpo: { usuario: 'cliprojA2', senha: 'senha1234' } })).json.token;
    const g = await api('GET', `/api/cliente/${link}/galeria`, { cliente: tokCli });
    assert.deepStrictEqual(g.json.memorial.itens[0].ambientes, ['B.01', 'Área gourmet']);
    ok('cliente vê as etiquetas (inclusive de ambiente renomeado)');
  } finally {
    filho.kill();
    licenca.close();
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ok */ }
  }
  console.log('\nTODOS OS TESTES DOS AMBIENTES DO MEMORIAL (SERVIDOR) PASSARAM');
})().catch((e) => { console.error('FALHOU:', e); process.exit(1); });
