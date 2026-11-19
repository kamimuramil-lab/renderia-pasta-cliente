// Memorial de itens (nov/2026): regras do modelo, foto do produto (limites, troca, exclusão), trava por licença,
// posse entre contas e o que o CLIENTE da Pasta Cliente pode (e NÃO pode) ver (valor nunca sai).
// HTTP de verdade; licença FALSA; porta livre aleatória (nunca a 4102).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-memorial-'));
const ARM = path.join(TMP, 'arm');
const ok = (m) => console.log('OK  ' + m);
const portaLivre = () => new Promise((resolve, reject) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); s.on('error', reject); });
const TUDO = { paginaProjeto: true, orcamentos: true, memorial: true };
const SO_MEMORIAL = { paginaProjeto: false, orcamentos: false, memorial: true };
const SEM = { paginaProjeto: true, orcamentos: true, memorial: false };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

(async () => {
  const contas = {
    tokA: { usuario: 'arqA', recursos: TUDO }, tokASemMem: { usuario: 'arqA', recursos: SEM }, tokASoMem: { usuario: 'arqA', recursos: SO_MEMORIAL },
    tokB: { usuario: 'arqB', recursos: TUDO }, tokOld: { usuario: 'arqA' }
  };
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
  const enviarFoto = async (sessao, projeto, itemId, buffer, tipo) => {
    const f = new FormData(); f.append('arquivo', new Blob([buffer], { type: tipo }), 'foto');
    const r = await fetch(`${BASE}/api/app/galeria/${projeto}/memorial/itens/${itemId}/foto`, { method: 'POST', headers: { 'x-sessao-token': sessao }, body: f });
    let json = null; try { json = await r.json(); } catch (e) { /* sem corpo */ }
    return { status: r.status, json };
  };
  const P = '/api/app/galeria/projM/memorial';
  const arquivosNoArmazenamento = () => { try { return fs.readdirSync(path.join(ARM, 'projM')).filter((n) => n.startsWith('memorial-')); } catch (e) { return []; } };

  try {
    console.log('== 1. Sem o recurso "memorial": 403 em todas as rotas (inclusive servidor de licença antigo) ==');
    let r = await api('POST', '/api/app/galeria', { sessao: 'tokA', corpo: { projetoId: 'projM', nomeProjeto: 'Projeto M', clienteUsuario: 'cli', clienteSenha: 'senha1234' } });
    assert.strictEqual(r.status, 200);
    const link = r.json.linkToken;
    for (const sessao of ['tokASemMem', 'tokOld']) {
      for (const [m, rota, corpo] of [['GET', '', undefined], ['POST', '/itens', { setor: 'Metais', item: 'x' }], ['PUT', '/itens/mem_x', { item: 'x' }], ['DELETE', '/itens/mem_x', undefined], ['DELETE', '/itens/mem_x/foto', undefined]]) {
        const x = await api(m, P + rota, { sessao, corpo });
        assert.strictEqual(x.status, 403, `${sessao} ${m} ${rota}`);
        assert.strictEqual(x.json.recurso, 'memorial');
      }
      assert.strictEqual((await enviarFoto(sessao, 'projM', 'mem_x', PNG, 'image/png')).status, 403);
    }
    ok('6 rotas dão 403 sem o recurso');

    console.log('== 2. Regras do item: validação, Nº automático, ordem ==');
    const novo = (corpo) => api('POST', P + '/itens', { sessao: 'tokA', corpo });
    for (const [corpo, msg] of [
      [{ setor: 'Inventado', item: 'x' }, /Setor inválido/], [{ setor: 'Metais', item: '   ' }, /obrigatório/], [{ setor: 'Metais', item: 'x', ambientes: ['ZZ'] }, /Ambiente desconhecido/],
      [{ setor: 'Metais', item: 'x', link: 'javascript:alert(1)' }, /Link inválido/], [{ setor: 'Metais', item: 'x', valor: -5 }, /Valor inválido/],
      [{ setor: 'Metais', item: 'x', numero: 0 }, /Nº inválido/], [{ setor: 'Metais', item: 'x', status: 'OUTRO' }, /Status inválido/], [{ setor: 'Metais', item: 'x'.repeat(121) }, /passa de 120/]
    ]) { r = await novo(corpo); assert.strictEqual(r.status, 400); assert.match(r.json.erro, msg); }
    assert.strictEqual((await api('GET', P, { sessao: 'tokA' })).json.itens.length, 0, 'nada foi gravado nos pedidos inválidos');

    const a = (await novo({ setor: 'Metais', item: 'Torneira', ambientes: ['CZ', 'AS', 'CZ'], empresa: 'Docol', quantidade: '02', dimensoes: 'Altura: 0,13m', valor: '12345,67' })).json.item;
    const b = (await novo({ setor: 'Metais', item: 'Tanque', ambientes: ['AS'] })).json.item;
    const c = (await novo({ setor: 'Acessórios', item: 'Varal', status: 'ATUAL' })).json.item;
    const d = (await novo({ setor: 'Metais', item: 'Item antigo', status: 'ANTIGA' })).json.item;
    assert.deepStrictEqual([a.numero, b.numero, c.numero, d.numero], [1, 2, 1, 3]);
    assert.deepStrictEqual(a.ambientes, ['AS', 'CZ'], 'ambientes sem repetição e na ordem da lista');
    assert.strictEqual(a.valor, 12345.67);
    assert.strictEqual(a.fotoUrl, null);
    let lista = (await api('GET', P, { sessao: 'tokA' })).json;
    assert.deepStrictEqual(lista.itens.map((i) => i.item), ['Varal', 'Torneira', 'Tanque', 'Item antigo'], 'ordem: setores na ordem da lista, depois Nº');
    assert.strictEqual(lista.setores.length, 12); assert.strictEqual(lista.ambientes.length, 27);
    assert.deepStrictEqual([lista.limites.itens, lista.limites.fotos, lista.limites.fotosUsadas], [400, 150, 0]);
    // trocar de setor sem dizer o Nº manda pro fim do setor novo; editar com dado inválido não grava nada
    r = await api('PUT', `${P}/itens/${c.id}`, { sessao: 'tokA', corpo: { setor: 'Metais' } });
    assert.deepStrictEqual([r.json.item.setor, r.json.item.numero], ['Metais', 4]);
    r = await api('PUT', `${P}/itens/${c.id}`, { sessao: 'tokA', corpo: { item: 'Varal novo', ambientes: ['ZZ'] } });
    assert.strictEqual(r.status, 400);
    assert.strictEqual((await api('GET', P, { sessao: 'tokA' })).json.itens.find((i) => i.id === c.id).item, 'Varal', 'edição inválida não gravou nada');
    r = await api('PUT', `${P}/itens/${c.id}`, { sessao: 'tokA', corpo: { item: 'Varal novo', numero: 9, valor: null, status: 'REVISAO' } });
    assert.deepStrictEqual([r.json.item.item, r.json.item.numero, r.json.item.valor, r.json.item.status], ['Varal novo', 9, null, 'REVISAO']);
    ok('validação, Nº automático, ambientes na ordem, valor "12345,67" aceito, edição atômica');

    console.log('== 3. Foto do produto: tipo, tamanho, troca, exclusão e limite ==');
    assert.strictEqual((await enviarFoto('tokA', 'projM', a.id, Buffer.from('texto'), 'text/plain')).status, 400);
    assert.strictEqual((await enviarFoto('tokA', 'projM', a.id, Buffer.alloc(401 * 1024, 1), 'image/webp')).status, 400);
    assert.strictEqual(arquivosNoArmazenamento().length, 0, 'recusadas não deixam arquivo órfão');
    r = await enviarFoto('tokA', 'projM', a.id, PNG, 'image/png');
    assert.strictEqual(r.status, 200); assert.ok(r.json.item.fotoUrl && r.json.item.fotoUrl.startsWith('/_local/'));
    assert.strictEqual(arquivosNoArmazenamento().length, 1);
    const arq1 = arquivosNoArmazenamento()[0];
    assert.strictEqual((await fetch(BASE + r.json.item.fotoUrl)).status, 200, 'a foto abre pela URL');
    r = await enviarFoto('tokA', 'projM', a.id, PNG, 'image/png');
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual([arquivosNoArmazenamento().length, arquivosNoArmazenamento()[0] === arq1], [1, false], 'trocar a foto apaga a antiga');
    assert.strictEqual((await api('DELETE', `${P}/itens/${a.id}/foto`, { sessao: 'tokA' })).json.item.fotoUrl, null);
    assert.strictEqual(arquivosNoArmazenamento().length, 0, 'remover a foto apaga o arquivo');
    await enviarFoto('tokA', 'projM', a.id, PNG, 'image/png');
    assert.strictEqual((await api('DELETE', `${P}/itens/${a.id}`, { sessao: 'tokA' })).status, 200);
    assert.strictEqual(arquivosNoArmazenamento().length, 0, 'excluir o item apaga a foto do armazenamento');
    // limite de 150 fotos por projeto (separado das fotos da galeria)
    const ids = [];
    for (let i = 0; i < 151; i++) ids.push((await novo({ setor: 'Decorativos', item: 'Quadro ' + i })).json.item.id);
    for (let i = 0; i < 150; i++) assert.strictEqual((await enviarFoto('tokA', 'projM', ids[i], PNG, 'image/png')).status, 200, 'foto ' + i);
    r = await enviarFoto('tokA', 'projM', ids[150], PNG, 'image/png');
    assert.strictEqual(r.status, 400); assert.match(r.json.erro, /máximo de 150/);
    assert.strictEqual(arquivosNoArmazenamento().length, 150, 'a 151ª foto não deixou arquivo órfão');
    assert.strictEqual((await enviarFoto('tokA', 'projM', ids[0], PNG, 'image/png')).status, 200, 'trocar uma foto existente continua valendo no limite');
    assert.strictEqual((await api('GET', P, { sessao: 'tokA' })).json.limites.fotosUsadas, 150);
    ok('tipo/tamanho recusados sem órfão; trocar/remover/excluir apagam o arquivo; limite de 150');
    for (const id of ids) await api('DELETE', `${P}/itens/${id}`, { sessao: 'tokA' }); // limpa

    console.log('== 4. Posse: outra conta não enxerga nem mexe ==');
    assert.strictEqual((await api('GET', P, { sessao: 'tokB' })).status, 400);
    assert.strictEqual((await api('POST', P + '/itens', { sessao: 'tokB', corpo: { setor: 'Metais', item: 'invasor' } })).status, 400);
    assert.strictEqual((await api('PUT', `${P}/itens/${b.id}`, { sessao: 'tokB', corpo: { item: 'invadido' } })).status, 400);
    assert.strictEqual((await api('DELETE', `${P}/itens/${b.id}`, { sessao: 'tokB' })).status, 400);
    assert.strictEqual((await enviarFoto('tokB', 'projM', b.id, PNG, 'image/png')).status, 400);
    assert.strictEqual((await api('GET', P, { sessao: 'tokA' })).json.itens.find((i) => i.id === b.id).item, 'Tanque');
    ok('conta B recebe erro em tudo e nada muda');

    console.log('== 5. Cliente: vê o memorial SEM valor, sem itens antigos e sem chaves ==');
    await enviarFoto('tokA', 'projM', b.id, PNG, 'image/png');
    assert.strictEqual((await api('PUT', `${P}/itens/${b.id}`, { sessao: 'tokA', corpo: { valor: 777777.77, link: 'https://loja.exemplo/torneira' } })).status, 200);
    const tokCli = (await api('POST', `/api/cliente/${link}/login`, { corpo: { usuario: 'cli', senha: 'senha1234' } })).json.token;
    r = await api('GET', `/api/cliente/${link}/galeria`, { cliente: tokCli });
    assert.strictEqual(r.json.novoVisual, true);
    const nomes = r.json.memorial.itens.map((i) => i.item);
    assert.ok(nomes.includes('Tanque') && nomes.includes('Varal novo') && !nomes.includes('Item antigo'), 'ANTIGA não aparece pro cliente: ' + nomes);
    const bruto = JSON.stringify(r.json);
    assert.ok(!/777777|12345|"valor"/.test(bruto), 'o valor nunca sai pro cliente');
    assert.ok(!/fotoR2Key|memorial-/.test(bruto.replace(/\/_local\/projM\/memorial-[^"]+/g, '')), 'sem chaves do armazenamento');
    const t = r.json.memorial.itens.find((i) => i.item === 'Tanque');
    assert.ok(t.fotoUrl.startsWith('/_local/') && t.link === 'https://loja.exemplo/torneira');
    ok('o cliente vê 2 itens (Item antigo escondido), com foto e link, nunca o valor');

    console.log('== 6. O cartão do memorial só existe com o recurso (e com a página do projeto) ==');
    await api('GET', '/api/app/galeria/projM', { sessao: 'tokASemMem' });
    r = await api('GET', `/api/cliente/${link}/galeria`, { cliente: tokCli });
    assert.deepStrictEqual(r.json.memorial.itens, [], 'dono sem o recurso: memorial vazio pro cliente');
    await api('GET', '/api/app/galeria/projM', { sessao: 'tokASoMem' });
    r = await api('GET', `/api/cliente/${link}/galeria`, { cliente: tokCli });
    assert.deepStrictEqual(r.json.memorial.itens, [], 'só memorial, sem página do projeto: o cliente cai na galeria clássica, sem memorial');
    assert.strictEqual((await api('GET', P, { sessao: 'tokASoMem' })).status, 200, 'mas o arquiteto continua usando (e gerando o PDF)');
    await api('GET', '/api/app/galeria/projM', { sessao: 'tokA' });
    assert.strictEqual((await api('GET', `/api/cliente/${link}/galeria`, { cliente: tokCli })).json.memorial.itens.length, 2, 'religar traz tudo de volta');
    ok('rebaixar esconde, religar volta; nada se perde');
  } finally {
    filho.kill();
    licenca.close();
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ok */ }
  }
  console.log('\nTODOS OS TESTES DO MEMORIAL (SERVIDOR) PASSARAM');
})().catch((e) => { console.error('FALHOU:', e); process.exit(1); });
