// Orçamento com a mesma ficha do Memorial (quantidade, especificações, dimensões, ambientes, link do produto e fotos), por HTTP real.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'orc-ficha-'));
const ARM = path.join(TMP, 'arm');
const portaLivre = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const contarArquivos = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).reduce((s, e) => s + (e.isDirectory() ? contarArquivos(path.join(dir, e.name)) : 1), 0) : 0);

(async () => {
  const licenca = http.createServer((req, res) => {
    let corpo = ''; req.on('data', (c) => { corpo += c; });
    req.on('end', () => {
      let t = null; try { t = JSON.parse(corpo).token; } catch (e) { /* */ }
      const contas = { tokA: 'arqA', tokB: 'arqB' };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(contas[t] ? { valida: true, usuario: contas[t], limiteFotos: 50, recursos: { paginaProjeto: true, orcamentos: true, memorial: true } } : { valida: false, recursos: { paginaProjeto: true, orcamentos: true, memorial: true } }));
    });
  });
  await new Promise((r) => licenca.listen(0, '127.0.0.1', r));
  const porta = await portaLivre();
  const filho = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { cwd: path.join(__dirname, '..'), env: Object.assign({}, process.env, { PORT: String(porta), DADOS_DIR: TMP, ARMAZENAMENTO_LOCAL_TESTE: '1', ARMAZENAMENTO_LOCAL_DIR: ARM, LICENCA_SERVIDOR_URL: `http://127.0.0.1:${licenca.address().port}` }) });
  let saida = ''; filho.stdout.on('data', (d) => { saida += d; }); filho.stderr.on('data', (d) => { saida += d; });
  try {
    await new Promise((resolve, reject) => { const t0 = Date.now(); const iv = setInterval(() => { if (/rodando na porta/.test(saida)) { clearInterval(iv); resolve(); } else if (Date.now() - t0 > 15000) { clearInterval(iv); reject(new Error('servidor não subiu: ' + saida)); } }, 100); });
    const BASE = `http://127.0.0.1:${porta}`;
    const api = async (metodo, caminho, { tok = 'tokA', orcamento, corpo, form } = {}) => {
      const headers = {};
      if (orcamento) headers['x-orcamento-token'] = orcamento; else if (tok) headers['x-sessao-token'] = tok;
      if (corpo !== undefined) headers['Content-Type'] = 'application/json';
      const r = await fetch(BASE + caminho, { method: metodo, headers, body: form || (corpo === undefined ? undefined : JSON.stringify(corpo)) });
      return { status: r.status, json: await r.json().catch(() => ({})) };
    };
    const foto = (cor) => { const f = new FormData(); f.append('arquivo', new Blob([Buffer.from('RIFF0000WEBP' + cor)], { type: 'image/webp' }), 'f.webp'); return f; };

    // galeria do arqA
    const sessaoGaleria = await api('POST', '/api/app/galeria', { corpo: { projetoId: 'p1', nomeProjeto: 'Apto', clienteUsuario: 'cli', clienteSenha: 'senha1234' } });
    assert.strictEqual(sessaoGaleria.status, 200, JSON.stringify(sessaoGaleria.json));
    const B = '/api/app/galeria/p1/orcamentos';

    console.log('== 1. Ficha completa grava e volta; link do produto é separado do link do arquivo ==');
    let r = await api('GET', B);
    assert.ok(r.json.limites && r.json.limites.fotosPorItem === 6, 'o servidor avisa que tem a ficha completa');
    assert.ok(Array.isArray(r.json.ambientes) && r.json.ambientes.length, 'lista de ambientes da conta');
    const ambiente = r.json.ambientes[0];
    r = await api('POST', B + '/itens', { corpo: { item: 'Bancada', empresa: 'Mármores', quantidade: '2', especificacoes: 'Quartzo\r\nbranco', dimensoes: 'Altura: 3 cm', ambientes: [ambiente], linkProduto: 'https://loja.com.br/p', url: 'https://drive.google.com/file/d/ORCAMENTO-SECRETO/view', valor: '1.234,50', status: 'analise_cliente' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    const id = r.json.item.id;
    assert.strictEqual(r.json.item.especificacoes, 'Quartzo\nbranco');
    assert.deepStrictEqual(r.json.item.ambientes, [ambiente]);
    assert.strictEqual(r.json.item.linkProduto, 'https://loja.com.br/p');
    assert.ok(r.json.item.url.includes('ORCAMENTO-SECRETO'));
    assert.strictEqual(r.json.item.fotoUrl, null);
    assert.strictEqual((await api('POST', B + '/itens', { corpo: { item: 'x', linkProduto: 'javascript:alert(1)' } })).status, 400, 'link perigoso recusado');
    assert.strictEqual((await api('POST', B + '/itens', { corpo: { item: 'x', ambientes: ['ambiente inventado'] } })).status, 400);
    // editar só um campo não apaga os outros
    r = await api('PUT', `${B}/itens/${id}`, { corpo: { empresa: 'Outra' } });
    assert.strictEqual(r.json.item.quantidade, '2'); assert.strictEqual(r.json.item.dimensoes, 'Altura: 3 cm');
    console.log('OK');

    console.log('== 2. Fotos: capa + extras, limite de 6, trocar capa, remover; arquivos acompanham ==');
    const antes = contarArquivos(ARM);
    const ids = [];
    for (let i = 0; i < 6; i++) { r = await api('POST', `${B}/itens/${id}/fotos`, { form: foto('c' + i) }); assert.strictEqual(r.status, 200, JSON.stringify(r.json)); ids.push(r.json.fotoId); }
    assert.strictEqual(ids[0], null, 'a primeira vira a capa');
    assert.strictEqual(r.json.item.fotosExtras.length, 5);
    assert.ok(r.json.item.fotoUrl && r.json.item.fotosExtras.every((f) => f.url && !f.r2Key), 'extras sem chave do armazenamento');
    assert.strictEqual((await api('POST', `${B}/itens/${id}/fotos`, { form: foto('7') })).status, 400, '7ª foto recusada');
    assert.strictEqual(contarArquivos(ARM), antes + 6, 'a recusada não deixa arquivo órfão');
    const capaAntes = r.json.item.fotoUrl.split('?')[0];
    r = await api('POST', `${B}/itens/${id}/fotos/${ids[2]}/capa`);
    assert.notStrictEqual(r.json.item.fotoUrl.split('?')[0], capaAntes);
    r = await api('DELETE', `${B}/itens/${id}/fotos/capa`);
    assert.strictEqual(r.json.item.fotosExtras.length, 4); assert.ok(r.json.item.fotoUrl, 'a próxima sobe pra capa');
    r = await api('DELETE', `${B}/itens/${id}/fotos/${r.json.item.fotosExtras[0].id}`);
    assert.strictEqual(r.json.item.fotosExtras.length, 3);
    assert.strictEqual(contarArquivos(ARM), antes + 4);
    console.log('OK');

    console.log('== 3. Outra conta não mexe ==');
    assert.notStrictEqual((await api('POST', `${B}/itens/${id}/fotos`, { tok: 'tokB', form: foto('x') })).status, 200);
    assert.notStrictEqual((await api('DELETE', `${B}/itens/${id}/fotos/capa`, { tok: 'tokB' })).status, 200);
    assert.strictEqual(contarArquivos(ARM), antes + 4);
    console.log('OK');

    console.log('== 4. O cliente dos orçamentos vê a ficha e as fotos, sem chaves do armazenamento ==');
    await api('PUT', B + '/acesso', { corpo: { usuario: 'orc', senha: 'senha-orc' } });
    const link = (await api('GET', B)).json.acesso.linkToken;
    const tok = (await api('POST', `/api/orcamentos/${link}/login`, { tok: null, corpo: { usuario: 'orc', senha: 'senha-orc' } })).json.token;
    r = await api('GET', `/api/orcamentos/${link}/itens`, { orcamento: tok });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    const doCliente = r.json.itens.find((i) => i.id === id);
    assert.strictEqual(doCliente.quantidade, '2'); assert.strictEqual(doCliente.especificacoes, 'Quartzo\nbranco'); assert.strictEqual(doCliente.linkProduto, 'https://loja.com.br/p');
    assert.strictEqual(doCliente.fotos.length, 4);
    assert.ok(!('fotoR2Key' in doCliente) && !('fotosExtras' in doCliente), 'sem chaves');
    assert.ok(!JSON.stringify(r.json).includes('r2Key'));
    // item que só tem ficha/foto já não é "de enfeite": o cliente vê
    const so = (await api('POST', B + '/itens', { corpo: { item: 'Só especificação', especificacoes: 'algo' } })).json.item;
    r = await api('GET', `/api/orcamentos/${link}/itens`, { orcamento: tok });
    assert.ok(r.json.itens.some((i) => i.id === so.id));
    console.log('OK');

    console.log('== 5. Excluir orçamento, categoria ou o projeto apaga as fotos ==');
    r = await api('DELETE', `${B}/itens/${id}`);
    assert.strictEqual(r.status, 200); assert.strictEqual(contarArquivos(ARM), antes);
    const cat = (await api('POST', B + '/categorias', { corpo: { nome: 'Com fotos' } })).json.categoria;
    const it2 = (await api('POST', B + '/itens', { corpo: { item: 'A', categoriaId: cat.id } })).json.item;
    await api('POST', `${B}/itens/${it2.id}/fotos`, { form: foto('a') });
    await api('POST', `${B}/itens/${it2.id}/fotos`, { form: foto('b') });
    assert.strictEqual(contarArquivos(ARM), antes + 2);
    r = await api('DELETE', `${B}/categorias/${cat.id}`);
    assert.strictEqual(r.json.orcamentosExcluidos, 1); assert.ok(!('chavesDeFotos' in r.json), 'as chaves não saem na resposta');
    assert.strictEqual(contarArquivos(ARM), antes);
    const it3 = (await api('POST', B + '/itens', { corpo: { item: 'B' } })).json.item;
    await api('POST', `${B}/itens/${it3.id}/fotos`, { form: foto('z') });
    const { nomeProjeto, chaves } = require('../lib/galeria').chavesDoProjeto(path.join(TMP, fs.readdirSync(TMP).find((n) => n.endsWith('.json'))), 'p1', 'arqA');
    assert.strictEqual(nomeProjeto, 'Apto'); assert.ok(chaves.some((k) => k.includes('/orcamento-')), 'a exclusão do projeto inclui as fotos dos orçamentos');
    console.log('OK');

    console.log('\nTODOS OS TESTES DA FICHA E DAS FOTOS DO ORÇAMENTO PASSARAM');
  } finally {
    filho.kill(); licenca.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
