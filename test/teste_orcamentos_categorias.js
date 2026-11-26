// Categorias da Pasta de Orçamentos (nov/2026): a categoria é só o separador; os orçamentos ficam dentro dela.
// Parte 1: módulo de dados (migração de projeto ANTIGO, CRUD de categorias, mover orçamento, o que o cliente vê).
// Parte 2: HTTP de verdade (server.js + licença falsa) nas rotas novas e posse entre contas.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');
const galeria = require('../lib/galeria');
const orc = require('../lib/orcamentos');
const cats = require('../lib/orcamentos-categorias');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-orc-cat-'));
const CAMINHO = path.join(TMP, 'dados-galerias.json');
const DONO = 'arq@teste.com';
const INTRUSO = 'outro@teste.com';
const lerO = () => galeria.buscarGaleriaPorProjeto(CAMINHO, 'projC').orcamentos;

console.log('== 1. MIGRAÇÃO: projeto no modelo ANTIGO (itens soltos) vira categoria + orçamento dentro ==');
galeria.criarOuAtualizarGaleria(CAMINHO, { projetoId: 'projC', licencaUsuario: DONO, nomeProjeto: 'Apto', clienteUsuario: 'cli', clienteSenha: 'senha1234' });
const bruto = JSON.parse(fs.readFileSync(CAMINHO, 'utf8'));
const agora = new Date().toISOString();
const velho = (id, item, extra) => Object.assign({ id, item, empresa: '', representante: '', telefone: '', valor: null, observacao: '', url: '', status: 'a_fazer', comentarios: [], criadoEm: agora, atualizadoEm: agora }, extra || {});
bruto.galerias[0].orcamentos = {
  acesso: null, notificacoes: [{ id: 'not_1', tipo: 'comentario', itemId: 'orc_mar2', itemNome: 'Marcenaria (cópia)', texto: 'oi', lida: false, quando: agora }], temNovidadeNaoLida: true,
  padraoV2: true, // projeto que já tinha aberto a tela: NÃO ganha as outras categorias padrão de novo
  itens: [
    velho('orc_ar', 'Ar Condicionado'), // de enfeite: vira só categoria
    velho('orc_mar1', 'Marcenaria', { empresa: 'Marcenaria Alfa', valor: 45000, status: 'analise_cliente' }),
    velho('orc_mar2', 'Marcenaria (cópia)', { empresa: 'Marcenaria Beta', valor: 52000, comentarios: [{ id: 'com_1', autor: 'cliente', texto: 'oi', criadoEm: agora, lido: false }] }),
    velho('orc_vazio', 'Marmoraria'), // de enfeite
    velho('orc_cortina', 'cortinas e persianas', { valor: 3000 }) // sem acento/maiúscula diferente do padrão
  ]
};
fs.writeFileSync(CAMINHO, JSON.stringify(bruto));
let o = lerO();
assert.deepStrictEqual(o.categorias.map((c) => c.nome), ['Ar Condicionado', 'Marcenaria', 'Marmoraria', 'cortinas e persianas'], 'uma categoria por nome (a cópia entra na mesma), na ordem em que apareceram');
assert.deepStrictEqual(o.itens.map((i) => i.id), ['orc_mar1', 'orc_mar2', 'orc_cortina'], 'os itens de enfeite viram só a categoria; os preenchidos continuam, com os MESMOS ids');
const catMar = o.categorias.find((c) => c.nome === 'Marcenaria').id;
assert.deepStrictEqual(o.itens.map((i) => i.categoriaId === catMar), [true, true, false], 'os dois orçamentos de marcenaria ficaram juntos');
assert.strictEqual(o.itens[1].comentarios.length, 1, 'comentários preservados');
assert.strictEqual(o.notificacoes.length, 1, 'novidades preservadas');
assert.strictEqual(lerO().categorias[0].id, o.categorias[0].id, 'ids das categorias estáveis entre leituras (mesmo antes de gravar)');
const v1 = orc.lerParaArquiteto(CAMINHO, 'projC', DONO); // grava a migração
assert.strictEqual(v1.categorias.length, 4);
const depois = JSON.parse(fs.readFileSync(CAMINHO, 'utf8')).galerias[0].orcamentos;
assert.strictEqual(depois.categoriasV1, true, 'migração gravada no disco');
assert.ok(depois.itens.every((i) => i.categoriaId), 'todo orçamento tem categoria no disco');
assert.deepStrictEqual(lerO().categorias, v1.categorias, 'ler de novo não muda nada (idempotente)');
console.log('OK');

console.log('== 2. Projeto antigo SEM padraoV2 ganha as categorias padrão que faltam, sem repetir ==');
const b2 = JSON.parse(fs.readFileSync(CAMINHO, 'utf8'));
b2.galerias[0].orcamentos = { acesso: null, itens: [velho('orc_x', 'Marcenaria', { valor: 10 })], notificacoes: [], temNovidadeNaoLida: false };
fs.writeFileSync(CAMINHO, JSON.stringify(b2));
o = lerO();
assert.strictEqual(o.categorias.length, cats.CATEGORIAS_PADRAO.length, 'as 13 padrão, com Marcenaria só uma vez');
assert.strictEqual(o.categorias[0].nome, 'Marcenaria', 'a que já tinha item vem primeiro');
assert.strictEqual(o.itens.length, 1);
console.log('OK');

console.log('== 3. Criar / renomear / reordenar / excluir categorias ==');
const c1 = orc.adicionarCategoria(CAMINHO, 'projC', { nome: '  Paisagismo ' }, DONO);
assert.strictEqual(c1.nome, 'Paisagismo');
assert.throws(() => orc.adicionarCategoria(CAMINHO, 'projC', { nome: 'paisagismo' }, DONO), /Já existe/, 'nome repetido (sem acento/maiúscula) é recusado');
assert.throws(() => orc.adicionarCategoria(CAMINHO, 'projC', { nome: '   ' }, DONO), /nome/);
assert.throws(() => orc.adicionarCategoria(CAMINHO, 'projC', { nome: 'x'.repeat(121) }, DONO), /passa de 120/);
const r1 = orc.renomearCategoria(CAMINHO, 'projC', c1.id, { nome: 'Paisagismo e Jardins' }, DONO);
assert.strictEqual(r1.nome, 'Paisagismo e Jardins');
assert.strictEqual(r1.id, c1.id, 'renomear não muda o id');
assert.throws(() => orc.renomearCategoria(CAMINHO, 'projC', c1.id, { nome: 'Marcenaria' }, DONO), /Já existe/);
assert.throws(() => orc.renomearCategoria(CAMINHO, 'projC', 'cat_nao_existe', { nome: 'x' }, DONO), /não encontrada/);
const ids0 = lerO().categorias.map((c) => c.id);
orc.reordenarCategorias(CAMINHO, 'projC', [...ids0].reverse(), DONO);
assert.deepStrictEqual(lerO().categorias.map((c) => c.id), [...ids0].reverse());
orc.reordenarCategorias(CAMINHO, 'projC', [ids0[0], 'cat_fantasma', ids0[0]], DONO); // id estranho e repetido: ignora; o que não veio fica no fim
assert.strictEqual(lerO().categorias.length, ids0.length, 'ordem parcial nunca apaga categoria');
assert.strictEqual(lerO().categorias[0].id, ids0[0]);
assert.throws(() => orc.reordenarCategorias(CAMINHO, 'projC', 'x', DONO), /inválida/);
console.log('OK');

console.log('== 4. Orçamento dentro da categoria: criar, mover, categoria inválida ==');
const marc = lerO().categorias.find((c) => c.nome === 'Marcenaria');
const novo = orc.adicionarItem(CAMINHO, 'projC', { item: 'Cozinha planejada', categoriaId: marc.id, empresa: 'Gama', valor: '12.000,00' }, DONO);
assert.strictEqual(novo.categoriaId, marc.id);
assert.throws(() => orc.adicionarItem(CAMINHO, 'projC', { item: 'x', categoriaId: 'cat_nao_existe' }, DONO), /Categoria não encontrada/);
const movido = orc.editarItem(CAMINHO, 'projC', novo.id, { categoriaId: c1.id }, DONO);
assert.strictEqual(movido.categoriaId, c1.id);
assert.throws(() => orc.editarItem(CAMINHO, 'projC', novo.id, { categoriaId: 'cat_nao_existe', empresa: 'Mudou' }, DONO), /Categoria não encontrada/);
assert.strictEqual(lerO().itens.find((i) => i.id === novo.id).empresa, 'Gama', 'edição inválida não aplica nada');
orc.editarItem(CAMINHO, 'projC', novo.id, { valor: '13000' }, DONO);
assert.strictEqual(lerO().itens.find((i) => i.id === novo.id).categoriaId, c1.id, 'editar outro campo não tira o orçamento da categoria');
// app ANTIGO (sem categoria na tela): cai na categoria do próprio nome, criando se precisar
const deAppAntigo = orc.adicionarItem(CAMINHO, 'projC', { item: 'Piso vinílico', valor: 100 }, DONO);
assert.strictEqual(lerO().categorias.find((c) => c.id === deAppAntigo.categoriaId).nome, 'Piso vinílico');
console.log('OK');

console.log('== 5. O que o CLIENTE vê: só categorias com orçamento liberado, na ordem do arquiteto ==');
const a = orc.definirAcesso(CAMINHO, 'projC', { usuario: 'orc', senha: 'senha-orc' }, DONO);
let vista = orc.listarParaCliente(CAMINHO, a.linkToken);
assert.ok(vista.categorias.every((c) => Object.keys(c).sort().join() === 'id,nome'), 'o cliente recebe só id e nome da categoria');
const nomesCli = vista.categorias.map((c) => c.nome);
assert.ok(!nomesCli.includes('Ar Condicionado') && !nomesCli.includes('Marmoraria'), 'categoria vazia (sem orçamento liberado) não aparece pro cliente');
assert.ok(nomesCli.includes('Paisagismo e Jardins') && nomesCli.includes('Marcenaria'));
assert.ok(vista.itens.every((i) => vista.categorias.some((c) => c.id === i.categoriaId)), 'todo orçamento visível tem categoria visível');
const ordemArq = lerO().categorias.map((c) => c.nome).filter((n) => nomesCli.includes(n));
assert.deepStrictEqual(nomesCli, ordemArq, 'mesma ordem do arquiteto');
const placeholder = orc.adicionarItem(CAMINHO, 'projC', { item: 'Ainda sem nada', categoriaId: marc.id }, DONO); // À fazer e vazio
assert.ok(!orc.listarParaCliente(CAMINHO, a.linkToken).itens.some((i) => i.id === placeholder.id), 'orçamento de enfeite continua escondido');
orc.editarItem(CAMINHO, 'projC', deAppAntigo.id, { status: 'evf' }, DONO);
orc.mudarStatusCliente(CAMINHO, a.linkToken, deAppAntigo.id, 'analise_cliente'); // a novidade leva o nome da categoria
assert.strictEqual(lerO().notificacoes.slice(-1)[0].categoriaNome, 'Piso vinílico');
console.log('OK');

console.log('== 6. Excluir categoria leva os orçamentos e as novidades deles ==');
const antes = lerO().itens.length;
const dentro = lerO().itens.filter((i) => i.categoriaId === c1.id).length;
assert.ok(dentro >= 1);
const res = orc.excluirCategoria(CAMINHO, 'projC', c1.id, DONO);
assert.strictEqual(res.orcamentosExcluidos, dentro);
assert.strictEqual(lerO().itens.length, antes - dentro);
assert.ok(!lerO().categorias.some((c) => c.id === c1.id));
assert.throws(() => orc.excluirCategoria(CAMINHO, 'projC', c1.id, DONO), /não encontrada/);
assert.ok(lerO().itens.every((i) => lerO().categorias.some((c) => c.id === i.categoriaId)), 'nenhum orçamento ficou sem categoria');
console.log('OK');

console.log('== 7. Posse: outra licença não mexe nas categorias ==');
const foto = JSON.stringify(lerO());
assert.throws(() => orc.adicionarCategoria(CAMINHO, 'projC', { nome: 'X' }, INTRUSO), /não pertence/);
assert.throws(() => orc.renomearCategoria(CAMINHO, 'projC', marc.id, { nome: 'X' }, INTRUSO), /não pertence/);
assert.throws(() => orc.excluirCategoria(CAMINHO, 'projC', marc.id, INTRUSO), /não pertence/);
assert.throws(() => orc.reordenarCategorias(CAMINHO, 'projC', [], INTRUSO), /não pertence/);
assert.strictEqual(JSON.stringify(lerO()), foto, 'nada mudou');
console.log('OK');

console.log('== 8. Limite de categorias ==');
const cheio = JSON.parse(fs.readFileSync(CAMINHO, 'utf8'));
while (cheio.galerias[0].orcamentos.categorias.length < orc.LIMITE_CATEGORIAS) cheio.galerias[0].orcamentos.categorias.push({ id: 'cat_l' + cheio.galerias[0].orcamentos.categorias.length, nome: 'Lim ' + cheio.galerias[0].orcamentos.categorias.length });
fs.writeFileSync(CAMINHO, JSON.stringify(cheio));
assert.throws(() => orc.adicionarCategoria(CAMINHO, 'projC', { nome: 'Uma a mais' }, DONO), /Limite/);
console.log('OK');

// ---------------------------------------------------------------- parte 2: HTTP de verdade
const portaLivre = () => new Promise((resolve, reject) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); s.on('error', reject); });
(async () => {
  console.log('== 9. HTTP real: rotas das categorias, posse e página do cliente ==');
  const TMP2 = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-orc-cat-http-'));
  const licenca = http.createServer((req, res) => {
    let corpo = ''; req.on('data', (c) => { corpo += c; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      let token = null; try { token = JSON.parse(corpo).token; } catch (e) { /* vazio */ }
      const usuario = { tokA: 'arqA', tokB: 'arqB' }[token];
      res.end(JSON.stringify(usuario ? { valida: true, usuario, limiteFotos: 50, recursos: { paginaProjeto: true, orcamentos: true, memorial: true } } : { valida: false, motivo: 'Sessão inválida.' }));
    });
  });
  await new Promise((r) => licenca.listen(0, '127.0.0.1', r));
  const porta = await portaLivre();
  const filho = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { cwd: path.join(__dirname, '..'), env: Object.assign({}, process.env, { PORT: String(porta), DADOS_DIR: TMP2, ARMAZENAMENTO_LOCAL_TESTE: '1', ARMAZENAMENTO_LOCAL_DIR: path.join(TMP2, 'arm'), LICENCA_SERVIDOR_URL: `http://127.0.0.1:${licenca.address().port}` }) });
  let saida = ''; filho.stdout.on('data', (d) => { saida += d; }); filho.stderr.on('data', (d) => { saida += d; });
  await new Promise((resolve, reject) => { const t0 = Date.now(); const iv = setInterval(() => { if (/rodando na porta/.test(saida)) { clearInterval(iv); resolve(); } else if (Date.now() - t0 > 15000) { clearInterval(iv); reject(new Error('servidor não subiu: ' + saida)); } }, 100); });
  const BASE = `http://127.0.0.1:${porta}`;
  const api = async (metodo, caminho, { sessao, orcamento, corpo } = {}) => {
    const op = { method: metodo, headers: {} };
    if (sessao) op.headers['x-sessao-token'] = sessao;
    if (orcamento) op.headers['x-orcamento-token'] = orcamento;
    if (corpo !== undefined) { op.headers['Content-Type'] = 'application/json'; op.body = JSON.stringify(corpo); }
    const r = await fetch(BASE + caminho, op); let json = null; try { json = await r.json(); } catch (e) { /* sem corpo */ }
    return { status: r.status, json };
  };
  const P = '/api/app/galeria/projH';
  try {
    await api('POST', '/api/app/galeria', { sessao: 'tokA', corpo: { projetoId: 'projH', nomeProjeto: 'APA', clienteUsuario: 'cli', clienteSenha: 'senha1234' } });
    for (const [m, rota] of [['POST', '/orcamentos/categorias'], ['PUT', '/orcamentos/categorias/ordem'], ['PUT', '/orcamentos/categorias/cat_x'], ['DELETE', '/orcamentos/categorias/cat_x']]) {
      assert.strictEqual((await api(m, P + rota)).status, 401, `${m} ${rota} sem sessão`);
    }
    let r = await api('GET', P + '/orcamentos', { sessao: 'tokA' });
    assert.strictEqual(r.json.categorias.length, 13, 'projeto novo: 13 categorias padrão');
    r = await api('POST', P + '/orcamentos/categorias', { sessao: 'tokA', corpo: { nome: 'Paisagismo' } });
    assert.strictEqual(r.status, 200);
    const cat = r.json.categoria;
    assert.strictEqual((await api('POST', P + '/orcamentos/categorias', { sessao: 'tokA', corpo: { nome: 'paisagismo' } })).status, 400, 'repetida');
    r = await api('PUT', P + '/orcamentos/categorias/' + cat.id, { sessao: 'tokA', corpo: { nome: 'Jardins' } });
    assert.strictEqual(r.json.categoria.nome, 'Jardins');
    r = await api('POST', P + '/orcamentos/itens', { sessao: 'tokA', corpo: { item: 'Grama', categoriaId: cat.id, valor: 900, status: 'analise_cliente' } });
    assert.strictEqual(r.json.item.categoriaId, cat.id);
    const idItem = r.json.item.id;
    assert.strictEqual((await api('POST', P + '/orcamentos/itens', { sessao: 'tokA', corpo: { item: 'x', categoriaId: 'cat_fantasma' } })).status, 400);
    // posse: a conta B não alcança nada
    for (const [m, rota, corpo] of [['POST', '/orcamentos/categorias', { nome: 'Invasora' }], ['PUT', '/orcamentos/categorias/' + cat.id, { nome: 'X' }], ['DELETE', '/orcamentos/categorias/' + cat.id], ['PUT', '/orcamentos/categorias/ordem', { ids: [] }]]) {
      assert.strictEqual((await api(m, P + rota, { sessao: 'tokB', corpo })).status, 400, `conta B em ${m} ${rota}`);
    }
    r = await api('PUT', P + '/orcamentos/acesso', { sessao: 'tokA', corpo: { usuario: 'orc', senha: 'senha-orc' } });
    const link = r.json.acesso.linkToken;
    const tok = (await api('POST', `/api/orcamentos/${link}/login`, { corpo: { usuario: 'orc', senha: 'senha-orc' } })).json.token;
    r = await api('GET', `/api/orcamentos/${link}/itens`, { orcamento: tok });
    assert.deepStrictEqual(r.json.categorias, [{ id: cat.id, nome: 'Jardins' }], 'o cliente vê só a categoria que tem orçamento liberado');
    assert.strictEqual(r.json.itens[0].categoriaId, cat.id);
    r = await api('DELETE', P + '/orcamentos/categorias/' + cat.id, { sessao: 'tokA' });
    assert.strictEqual(r.json.orcamentosExcluidos, 1);
    r = await api('GET', `/api/orcamentos/${link}/itens`, { orcamento: tok });
    assert.deepStrictEqual([r.json.categorias.length, r.json.itens.length], [0, 0]);
    console.log('OK');
    // página do cliente: o JS novo tem que ser servido
    const js = await (await fetch(BASE + '/assets/js/orcamentos.js')).text();
    assert.ok(/categorias/.test(js), 'orcamentos.js do cliente agrupa por categoria');
    console.log('\nTODOS OS TESTES DAS CATEGORIAS DE ORÇAMENTOS PASSARAM');
  } finally {
    try { filho.kill(); } catch (e) { /* já foi */ }
    licenca.close();
    fs.rmSync(TMP, { recursive: true, force: true });
    fs.rmSync(TMP2, { recursive: true, force: true });
  }
})().catch((e) => { console.error('FALHOU:', e); process.exit(1); });
