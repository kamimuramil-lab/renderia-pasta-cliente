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
const memLimite = require('../lib/memorial').LIMITE_BYTES_PLANTA;
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
    assert.deepStrictEqual([lista.limites.itens, lista.limites.fotos, lista.limites.fotosUsadas], [400, 400, 0]);
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
    assert.strictEqual((await enviarFoto('tokA', 'projM', a.id, Buffer.alloc(601 * 1024, 1), 'image/webp')).status, 400);
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
    // fotos EXTRAS do item: a 1ª vira capa, as outras entram na lista; limite de 6 por item; tornar capa; remover; capa removida promove a próxima
    const enviarExtra = (tok, proj, itemId, buf, mime) => { const f = new FormData(); f.append('arquivo', new Blob([buf], { type: mime }), 'x'); return fetch(BASE + '/api/app/galeria/' + proj + '/memorial/itens/' + itemId + '/fotos', { method: 'POST', headers: { 'x-sessao-token': tok }, body: f }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) })); };
    const e1 = (await novo({ setor: 'Decorativos', item: 'Item com várias fotos' })).json.item;
    r = await enviarExtra('tokA', 'projM', e1.id, PNG, 'image/png');
    assert.strictEqual(r.status, 200); assert.ok(r.json.item.fotoUrl, 'a primeira foto virou a capa'); assert.strictEqual(r.json.item.fotosExtras.length, 0); assert.strictEqual(r.json.fotoId, null);
    for (let k = 0; k < 5; k++) { r = await enviarExtra('tokA', 'projM', e1.id, PNG, 'image/png'); assert.strictEqual(r.status, 200, 'extra ' + k); }
    assert.strictEqual(r.json.item.fotosExtras.length, 5);
    assert.ok(r.json.item.fotosExtras.every((f) => f.id && f.url.startsWith('/_local/') && f.r2Key === undefined), 'extras com URL e sem chave do armazenamento');
    r = await enviarExtra('tokA', 'projM', e1.id, PNG, 'image/png');
    assert.strictEqual(r.status, 400); assert.match(r.json.erro, /até 6 fotos/);
    assert.strictEqual(arquivosNoArmazenamento().length, 6, 'a 7ª não deixou arquivo órfão');
    let it = (await api('GET', P, { sessao: 'tokA' })).json.itens.find((i) => i.id === e1.id);
    const capaAntes = it.fotoUrl; const extra0 = it.fotosExtras[0];
    r = await api('POST', P + '/itens/' + e1.id + '/fotos/' + extra0.id + '/capa', { sessao: 'tokA' });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.json.item.fotoUrl, extra0.url, 'a extra virou capa'); assert.strictEqual(r.json.item.fotosExtras[0].url, capaAntes, 'a capa antiga ocupou o lugar da extra'); assert.strictEqual(r.json.item.fotosExtras.length, 5);
    r = await api('DELETE', P + '/itens/' + e1.id + '/fotos/' + r.json.item.fotosExtras[1].id, { sessao: 'tokA' });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.json.item.fotosExtras.length, 4); assert.strictEqual(arquivosNoArmazenamento().length, 5, 'remover a extra apaga o arquivo');
    assert.strictEqual((await api('DELETE', P + '/itens/' + e1.id + '/fotos/inexistente', { sessao: 'tokA' })).status, 400);
    const proxima = r.json.item.fotosExtras[0].url;
    r = await api('DELETE', P + '/itens/' + e1.id + '/foto', { sessao: 'tokA' });
    assert.strictEqual(r.json.item.fotoUrl, proxima, 'tirar a capa promove a primeira extra'); assert.strictEqual(r.json.item.fotosExtras.length, 3); assert.strictEqual(arquivosNoArmazenamento().length, 4);
    assert.strictEqual((await enviarExtra('tokB', 'projM', e1.id, PNG, 'image/png')).status, 400, 'outra conta não envia extra');
    assert.strictEqual((await api('DELETE', P + '/itens/' + e1.id, { sessao: 'tokA' })).status, 200);
    assert.strictEqual(arquivosNoArmazenamento().length, 0, 'excluir o item apaga a capa e todas as extras');
    ok('fotos extras: 1ª vira capa, até 6 por item, tornar capa, remover, capa removida promove a próxima, sem órfão, outra conta barrada');

    // modo do setor (lista/cards): padrão lista, acompanha o renome, cliente recebe
    const lerModos = async () => (await api('GET', P, { sessao: 'tokA' })).json.modos;
    assert.strictEqual((await lerModos()).Decorativos, 'lista');
    r = await api('POST', P + '/setores/modo', { sessao: 'tokA', corpo: { nome: 'Decorativos', modo: 'cards' } });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.json.modos.Decorativos, 'cards');
    assert.strictEqual((await api('POST', P + '/setores/modo', { sessao: 'tokA', corpo: { nome: 'Decorativos', modo: 'tabela' } })).status, 400);
    assert.strictEqual((await api('POST', P + '/setores/modo', { sessao: 'tokA', corpo: { nome: 'Inexistente', modo: 'cards' } })).status, 400);
    assert.strictEqual((await api('POST', P + '/setores/modo', { sessao: 'tokB', corpo: { nome: 'Decorativos', modo: 'lista' } })).status, 400, 'outra conta não muda o modo');
    await api('POST', P + '/setores/renomear', { sessao: 'tokA', corpo: { de: 'Decorativos', para: 'Objetos' } });
    assert.strictEqual((await lerModos()).Objetos, 'cards', 'o modo acompanha o nome novo');
    await api('POST', P + '/setores/renomear', { sessao: 'tokA', corpo: { de: 'Objetos', para: 'Decorativos' } });
    r = await api('POST', P + '/setores/modo', { sessao: 'tokA', corpo: { nome: 'Decorativos', modo: 'lista' } });
    assert.strictEqual(r.json.modos.Decorativos, 'lista');
    ok('modo do setor: padrão lista, validação, posse, acompanha o renome');

    // limite de 400 fotos por projeto (capa + extras, separado das fotos da galeria): 68 itens, 6 fotos cada até completar 400
    const ids = [];
    for (let i = 0; i < 68; i++) ids.push((await novo({ setor: 'Decorativos', item: 'Quadro ' + i })).json.item.id);
    let enviadas = 0;
    for (let i = 0; i < 66; i++) for (let k = 0; k < 6; k++) { assert.strictEqual((await enviarExtra('tokA', 'projM', ids[i], PNG, 'image/png')).status, 200, 'foto ' + enviadas); enviadas++; }
    for (let k = 0; k < 4; k++) { assert.strictEqual((await enviarExtra('tokA', 'projM', ids[66], PNG, 'image/png')).status, 200); enviadas++; }
    assert.strictEqual(enviadas, 400);
    r = await enviarExtra('tokA', 'projM', ids[67], PNG, 'image/png');
    assert.strictEqual(r.status, 400); assert.match(r.json.erro, /máximo de 400/);
    r = await enviarFoto('tokA', 'projM', ids[67], PNG, 'image/png');
    assert.strictEqual(r.status, 400); assert.match(r.json.erro, /máximo de 400/);
    assert.strictEqual(arquivosNoArmazenamento().length, 400, 'a 401ª foto não deixou arquivo órfão');
    assert.strictEqual((await enviarFoto('tokA', 'projM', ids[0], PNG, 'image/png')).status, 200, 'trocar uma capa existente continua valendo no limite');
    assert.strictEqual((await api('GET', P, { sessao: 'tokA' })).json.limites.fotosUsadas, 400);
    ok('tipo/tamanho recusados sem órfão; trocar/remover/excluir apagam o arquivo; limite de 400 fotos (capa + extras)');
    for (const id of ids) await api('DELETE', P + '/itens/' + id, { sessao: 'tokA' }); // limpa

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

    console.log('== 10. Plantas do setor com círculos numerados (etapa 2) ==');
    const enviarPlanta = async (sessao, setor, buffer, tipo, nome) => {
      const f = new FormData(); f.append('setor', setor); if (nome) f.append('nome', nome); f.append('arquivo', new Blob([buffer], { type: tipo }), 'planta');
      const resp = await fetch(`${BASE}${P}/plantas`, { method: 'POST', headers: { 'x-sessao-token': sessao }, body: f });
      let json = null; try { json = await resp.json(); } catch (e) { /* sem corpo */ }
      return { status: resp.status, json };
    };
    const arquivosDePlanta = () => { try { return fs.readdirSync(path.join(ARM, 'projM')).filter((n) => n.startsWith('memorial-planta-')); } catch (e) { return []; } };
    const L1 = (await novo({ setor: 'Louças', item: 'Vaso sanitário' })).json.item;
    const L2 = (await novo({ setor: 'Louças', item: 'Cuba de apoio' })).json.item;
    const L3 = (await novo({ setor: 'Louças', item: 'Bidê antigo', status: 'ANTIGA' })).json.item;
    const M1 = (await novo({ setor: 'Metais', item: 'Torneira de teste' })).json.item;
    assert.deepStrictEqual([L1.numero, L2.numero, L3.numero], [1, 2, 3]);

    // 10.1 envio e validações (nada de arquivo órfão quando recusa)
    assert.strictEqual((await enviarPlanta('tokA', 'Inventado', PNG, 'image/png')).status, 400);
    assert.strictEqual((await enviarPlanta('tokA', 'Louças', Buffer.from('GIF89a'), 'image/gif')).status, 400);
    assert.strictEqual((await enviarPlanta('tokA', 'Louças', Buffer.alloc(memLimite + 1, 1), 'image/png')).status, 400);
    assert.strictEqual(arquivosDePlanta().length, 0, 'recusas não deixam arquivo no armazenamento');
    r = await enviarPlanta('tokA', 'Louças', PNG, 'image/png', 'Térreo');
    assert.strictEqual(r.status, 200); assert.strictEqual(r.json.planta.nome, 'Térreo');
    assert.ok(r.json.planta.url.startsWith('/_local/') && !('r2Key' in r.json.planta) && Array.isArray(r.json.planta.marcas) && r.json.planta.marcas.length === 0);
    const pl = r.json.planta; assert.strictEqual(arquivosDePlanta().length, 1);
    const semNome = (await enviarPlanta('tokA', 'Louças', PNG, 'image/png')).json.planta;
    assert.strictEqual(semNome.nome, 'Planta 2', 'sem nome: "Planta N"');
    ok('upload (PNG), nome padrão, recusas (setor, tipo, tamanho) sem deixar arquivo órfão');

    // 10.2 círculos: validação, limites das frações, vários por item
    const marcar = (plantaId, marcas, sessao) => api('PUT', `${P}/plantas/${plantaId}/marcas`, { sessao: sessao || 'tokA', corpo: { marcas } });
    for (const [marcas, msg] of [
      ['x', /inválida/], [[null], /inválido/], [[{ itemId: 'mem_nao_existe', x: 0.5, y: 0.5 }], /não existe/],
      [[{ itemId: M1.id, x: 0.5, y: 0.5 }], /mesmo setor/], [[{ itemId: L1.id, x: 'a', y: 0.5 }], /inválida/], [Array.from({ length: 81 }, () => ({ itemId: L1.id, x: 0.1, y: 0.1 })), /até 80/]
    ]) { r = await marcar(pl.id, marcas); assert.strictEqual(r.status, 400, JSON.stringify(marcas).slice(0, 40)); assert.match(r.json.erro, msg); }
    r = await marcar(pl.id, [{ itemId: L1.id, x: 0.2, y: 0.3 }, { itemId: L1.id, x: 0.8, y: 0.9 }, { itemId: L2.id, x: 1.5, y: -1 }, { itemId: L3.id, x: 0.5, y: 0.5 }]);
    assert.strictEqual(r.status, 200); assert.strictEqual(r.json.planta.marcas.length, 4);
    assert.deepStrictEqual([r.json.planta.marcas[2].x, r.json.planta.marcas[2].y], [1, 0], 'fora da imagem é limitado a 0..1');
    assert.ok(r.json.planta.marcas.every((m) => /^mk_[a-z0-9]+$/.test(m.id)) && new Set(r.json.planta.marcas.map((m) => m.id)).size === 4, 'ids próprios e distintos');
    const idsMarcas = r.json.planta.marcas.map((m) => m.id);
    r = await marcar(pl.id, [{ id: idsMarcas[0], itemId: L1.id, x: 0.25, y: 0.35 }]); // lista completa substitui; id válido é mantido
    assert.strictEqual(r.json.planta.marcas.length, 1); assert.strictEqual(r.json.planta.marcas[0].id, idsMarcas[0]);
    await marcar(pl.id, [{ itemId: L1.id, x: 0.2, y: 0.3 }, { itemId: L1.id, x: 0.8, y: 0.9 }, { itemId: L2.id, x: 0.5, y: 0.5 }, { itemId: L3.id, x: 0.6, y: 0.6 }]);
    ok('círculos: valida item/setor/posição, limita 0..1, aceita vários do mesmo item, lista nova substitui');

    // 10.3 leitura: arquiteto (tudo) e cliente (só itens que ele vê, com o Nº atual, sem chaves)
    lista = (await api('GET', P, { sessao: 'tokA' })).json;
    assert.strictEqual(lista.plantas['Louças'].length, 2); assert.deepStrictEqual(lista.plantas['Metais'], []);
    assert.strictEqual(lista.plantas['Louças'][0].marcas.length, 4, 'o arquiteto vê todos os círculos (inclusive o do item ANTIGA)');
    assert.ok(!JSON.stringify(lista.plantas).includes('r2Key'));
    assert.deepStrictEqual([lista.limites.plantasPorSetor, lista.limites.plantasPorProjeto, lista.limites.marcasPorPlanta], [8, 30, 80]);
    r = await api('GET', `/api/cliente/${link}/galeria`, { cliente: tokCli });
    const plCli = r.json.memorial.plantas['Louças'];
    assert.strictEqual(plCli.length, 2); assert.strictEqual(plCli[0].nome, 'Térreo');
    assert.strictEqual(plCli[0].marcas.length, 3, 'o círculo do item ANTIGA some pro cliente');
    assert.deepStrictEqual(plCli[0].marcas.map((m) => m.numero), [1, 1, 2], 'o círculo leva o Nº do item');
    assert.ok(plCli[0].url.startsWith('/_local/'));
    assert.ok(!/r2Key|memorial-planta-[^"]*"\s*:/.test(JSON.stringify(r.json.memorial.plantas)), 'sem chaves do armazenamento');
    await api('PUT', `${P}/itens/${L2.id}`, { sessao: 'tokA', corpo: { numero: 7 } });
    r = await api('GET', `/api/cliente/${link}/galeria`, { cliente: tokCli });
    assert.deepStrictEqual(r.json.memorial.plantas['Louças'][0].marcas.map((m) => m.numero), [1, 1, 7], 'mudou o Nº do item: o círculo acompanha');
    await api('PUT', `${P}/itens/${L2.id}`, { sessao: 'tokA', corpo: { numero: 2 } });
    ok('arquiteto vê tudo; cliente vê só itens vigentes, com o Nº atual e sem chaves');

    // 10.4 posse e recurso: outra conta / sem o recurso não mexe em nada
    assert.strictEqual((await enviarPlanta('tokB', 'Louças', PNG, 'image/png')).status, 400);
    assert.strictEqual((await marcar(pl.id, [], 'tokB')).status, 400);
    assert.strictEqual((await api('PUT', `${P}/plantas/${pl.id}`, { sessao: 'tokB', corpo: { nome: 'invadida' } })).status, 400);
    assert.strictEqual((await api('DELETE', `${P}/plantas/${pl.id}`, { sessao: 'tokB' })).status, 400);
    for (const sessao of ['tokASemMem', 'tokOld']) {
      assert.strictEqual((await enviarPlanta(sessao, 'Louças', PNG, 'image/png')).status, 403);
      assert.strictEqual((await marcar(pl.id, [], sessao)).status, 403);
      assert.strictEqual((await api('DELETE', `${P}/plantas/${pl.id}`, { sessao })).status, 403);
    }
    assert.strictEqual((await api('GET', P, { sessao: 'tokA' })).json.plantas['Louças'][0].marcas.length, 4, 'nada mudou');
    ok('outra conta recebe erro, quem não tem o recurso recebe 403, e nada muda');

    // 10.5 renomear a planta; item que muda de setor ou é excluído perde os círculos
    r = await api('PUT', `${P}/plantas/${pl.id}`, { sessao: 'tokA', corpo: { nome: 'Pavimento térreo' } });
    assert.strictEqual(r.json.planta.nome, 'Pavimento térreo');
    assert.strictEqual((await api('PUT', `${P}/plantas/${pl.id}`, { sessao: 'tokA', corpo: { nome: '  ' } })).status, 400);
    await api('PUT', `${P}/itens/${L3.id}`, { sessao: 'tokA', corpo: { setor: 'Metais' } });
    assert.strictEqual((await api('GET', P, { sessao: 'tokA' })).json.plantas['Louças'][0].marcas.length, 3, 'item mudou de setor: o círculo dele saiu');
    const L4 = (await novo({ setor: 'Louças', item: 'Chuveiro de teste' })).json.item;
    await marcar(pl.id, [{ itemId: L1.id, x: 0.2, y: 0.3 }, { itemId: L4.id, x: 0.4, y: 0.4 }]);
    assert.strictEqual((await api('DELETE', `${P}/itens/${L4.id}`, { sessao: 'tokA' })).status, 200);
    assert.deepStrictEqual((await api('GET', P, { sessao: 'tokA' })).json.plantas['Louças'][0].marcas.map((m) => m.itemId), [L1.id], 'item excluído: o círculo saiu');
    ok('renomear planta; item que muda de setor ou é excluído perde o círculo');

    // 10.6 setor: renomear leva as plantas; excluir recusa enquanto houver planta
    await api('POST', P + '/setores/renomear', { sessao: 'tokA', corpo: { de: 'Louças', para: 'Louças e Metais' } });
    lista = (await api('GET', P, { sessao: 'tokA' })).json;
    assert.strictEqual(lista.plantas['Louças e Metais'].length, 2); assert.ok(!lista.plantas['Louças']);
    assert.strictEqual(lista.plantas['Louças e Metais'][0].marcas.length, 1);
    await api('POST', P + '/setores/renomear', { sessao: 'tokA', corpo: { de: 'Louças e Metais', para: 'Louças' } });
    await api('POST', P + '/setores', { sessao: 'tokA', corpo: { nome: 'Setor das plantas' } });
    const sPl = (await enviarPlanta('tokA', 'Setor das plantas', PNG, 'image/png')).json.planta;
    r = await api('POST', P + '/setores/excluir', { sessao: 'tokA', corpo: { nome: 'Setor das plantas' } });
    assert.strictEqual(r.status, 400); assert.match(r.json.erro, /1 planta/);
    ok('o setor renomeado leva as plantas; setor com planta não é excluído');

    // 10.7 chaves do projeto (exclusão total) incluem as plantas; limites; excluir planta apaga o arquivo
    const galeriaLib = require('../lib/galeria');
    const emDisco = galeriaLib.chavesDoProjeto(path.join(TMP, 'dados-galerias.json'), 'projM', 'arqA');
    assert.strictEqual(emDisco.chaves.filter((k) => /memorial-planta-/.test(k)).length, 3, 'chavesDoProjeto lista as 3 plantas');
    assert.strictEqual((await api('DELETE', `${P}/plantas/${sPl.id}`, { sessao: 'tokA' })).status, 200);
    assert.strictEqual(arquivosDePlanta().length, 2, 'excluir a planta apaga o arquivo');
    assert.strictEqual((await api('POST', P + '/setores/excluir', { sessao: 'tokA', corpo: { nome: 'Setor das plantas' } })).status, 200, 'sem planta, o setor sai');
    for (let k = 0; k < 6; k++) assert.strictEqual((await enviarPlanta('tokA', 'Louças', PNG, 'image/png')).status, 200);
    r = await enviarPlanta('tokA', 'Louças', PNG, 'image/png');
    assert.strictEqual(r.status, 400); assert.match(r.json.erro, /máximo de 8/);
    assert.strictEqual(arquivosDePlanta().length, 8, 'a recusa não deixou arquivo');
    ok('chavesDoProjeto inclui as plantas; excluir apaga o arquivo; limite de 8 por setor');

    console.log('== 11. Textos escritos em cima da planta do setor (etapa D) ==');
    const textar = (plantaId, textos, sessao) => api('PUT', `${P}/plantas/${plantaId}/textos`, { sessao: sessao || 'tokA', corpo: { textos } });
    const T = (extra) => Object.assign({ texto: 'COZINHA', x: 0.3, y: 0.4, tamanho: 0.02, cor: '#112233', fundo: null, contorno: null, negrito: true }, extra || {});
    // 11.1 validação (a MESMA da planta da apresentação), antes de gravar qualquer coisa
    for (const [textos, msg] of [
      ['x', /inválida/], [[null], /formato inválido/], [[T({ texto: '   ' })], /vazio/], [[T({ texto: 'a'.repeat(201) })], /200 caracteres/],
      [[T({ x: 'a' })], /posição x inválido/], [[T({ tamanho: '' })], /tamanho inválido/], [[T({ cor: 'vermelho' })], /Cor da letra inválida/],
      [[T({ fundo: '#12' })], /Cor do fundo inválida/], [[T({ contorno: 'azul' })], /Cor do contorno inválida/],
      [[T({ id: 'repetido' }), T({ id: 'repetido', texto: 'SALA' })], /repetidos/], [Array.from({ length: 81 }, () => T()), /até 80/]
    ]) { r = await textar(pl.id, textos); assert.strictEqual(r.status, 400, JSON.stringify(textos).slice(0, 50)); assert.match(r.json.erro, msg); }
    assert.deepStrictEqual((await api('GET', P, { sessao: 'tokA' })).json.plantas['Louças'][0].textos, [], 'recusa não grava nada');
    // 11.2 gravar: lista completa substitui, números são limitados, ids são mantidos/criados
    r = await textar(pl.id, [T({ id: 'txt_a1' }), T({ texto: 'SALA\nDE ESTAR', x: 1.7, y: -2, tamanho: 0.5, cor: '#ABCDEF', fundo: '#FFFFFF', fundoOpacidade: 0.5, contorno: '#000000', negrito: false })]);
    assert.strictEqual(r.status, 200); assert.strictEqual(r.json.planta.textos.length, 2);
    const t1 = r.json.planta.textos[0], t2 = r.json.planta.textos[1];
    assert.strictEqual(t1.id, 'txt_a1'); assert.match(t2.id, /^txt_/);
    assert.deepStrictEqual([t2.x, t2.y, t2.tamanho], [1, 0, 0.1], 'posição 0..1 e tamanho 0,006..0,1');
    assert.deepStrictEqual([t2.cor, t2.fundo, t2.fundoOpacidade, t2.contorno, t2.negrito, t2.texto], ['#abcdef', '#ffffff', 0.5, '#000000', false, 'SALA\nDE ESTAR']);
    r = await textar(pl.id, [t1]); assert.strictEqual(r.json.planta.textos.length, 1, 'a lista nova substitui a anterior');
    await textar(pl.id, [t1, t2]);
    ok('textos: valida igual à planta da apresentação, limita números, mantém ids, lista nova substitui');
    // 11.3 leitura: arquiteto e cliente recebem; mexer nos círculos não apaga os textos (e vice-versa)
    lista = (await api('GET', P, { sessao: 'tokA' })).json;
    assert.strictEqual(lista.plantas['Louças'][0].textos.length, 2); assert.deepStrictEqual(lista.plantas['Louças'][1].textos, [], 'planta sem texto: lista vazia');
    assert.strictEqual(lista.limites.textosPorPlanta, 80);
    await marcar(pl.id, [{ itemId: L1.id, x: 0.2, y: 0.3 }]);
    assert.strictEqual((await api('GET', P, { sessao: 'tokA' })).json.plantas['Louças'][0].textos.length, 2, 'gravar círculos não mexe nos textos');
    await textar(pl.id, [t1]);
    assert.strictEqual((await api('GET', P, { sessao: 'tokA' })).json.plantas['Louças'][0].marcas.length, 1, 'gravar textos não mexe nos círculos');
    await textar(pl.id, [t1, t2]);
    r = await api('GET', `/api/cliente/${link}/galeria`, { cliente: tokCli });
    const textosCli = r.json.memorial.plantas['Louças'][0].textos;
    assert.deepStrictEqual(textosCli.map((t) => t.texto), ['COZINHA', 'SALA\nDE ESTAR'], 'o cliente recebe os textos');
    assert.ok(!/r2Key/.test(JSON.stringify(textosCli)));
    ok('arquiteto e cliente recebem os textos; textos e círculos são independentes');
    // 11.4 posse e recurso
    assert.strictEqual((await textar(pl.id, [], 'tokB')).status, 400);
    for (const sessao of ['tokASemMem', 'tokOld']) assert.strictEqual((await textar(pl.id, [], sessao)).status, 403);
    assert.strictEqual((await textar('mpl_inexistente', [])).status, 400);
    assert.strictEqual((await api('GET', P, { sessao: 'tokA' })).json.plantas['Louças'][0].textos.length, 2, 'nada mudou');
    ok('outra conta recebe erro, sem o recurso dá 403, planta inexistente é recusada');
  } finally {
    filho.kill();
    licenca.close();
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ok */ }
  }
  console.log('\nTODOS OS TESTES DO MEMORIAL (SERVIDOR) PASSARAM');
})().catch((e) => { console.error('FALHOU:', e); process.exit(1); });
