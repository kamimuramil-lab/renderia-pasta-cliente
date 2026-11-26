// Liberação por licença (nov/2026): sem o recurso, o arquiteto recebe 403 nas rotas novas e o CLIENTE vê exatamente o que sempre viu
// (sem hub, sem tema claro, sem orçamentos). Rebaixar a licença esconde; religar traz tudo de volta, sem perder nada.
// HTTP de verdade; licença FALSA com contas/planos diferentes; portas livres aleatórias (nunca a 4102).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-recursos-'));
const ok = (m) => console.log('OK  ' + m);
const portaLivre = () => new Promise((resolve, reject) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); s.on('error', reject); });
const TUDO = { paginaProjeto: true, orcamentos: true, memorial: true };

(async () => {
  // token -> { usuario, recursos }. tokA* são da MESMA conta arqA em planos diferentes; "semCampo" simula servidor de licença antigo.
  const contas = {
    tokAFull: { usuario: 'arqA', recursos: TUDO },
    tokABasico: { usuario: 'arqA', recursos: { paginaProjeto: false, orcamentos: false, memorial: false } },
    tokASemCampo: { usuario: 'arqA' },
    tokBFull: { usuario: 'arqB', recursos: TUDO },
    tokCBasico: { usuario: 'arqC', recursos: {} }
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
    PORT: String(porta), DADOS_DIR: TMP, ARMAZENAMENTO_LOCAL_TESTE: '1', ARMAZENAMENTO_LOCAL_DIR: path.join(TMP, 'arm'), LICENCA_SERVIDOR_URL: `http://127.0.0.1:${licenca.address().port}` }) });
  let saida = ''; filho.stdout.on('data', (d) => { saida += d; }); filho.stderr.on('data', (d) => { saida += d; });
  await new Promise((resolve, reject) => { const t0 = Date.now(); const iv = setInterval(() => { if (/rodando na porta/.test(saida)) { clearInterval(iv); resolve(); } else if (Date.now() - t0 > 15000) { clearInterval(iv); reject(new Error('o servidor não subiu: ' + saida)); } }, 100); });
  const BASE = `http://127.0.0.1:${porta}`;
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
  const P = '/api/app/galeria/projR';
  const DRIVE = 'https://drive.google.com/file/d/AAA/view';

  try {
    console.log('== 1. Dono SEM o recurso: 403 nas rotas novas; o que já existia continua funcionando ==');
    let r = await api('POST', '/api/app/galeria', { sessao: 'tokABasico', corpo: { projetoId: 'projR', nomeProjeto: 'Projeto R', clienteUsuario: 'cli', clienteSenha: 'senha1234' } });
    assert.strictEqual(r.status, 200);
    const link = r.json.linkToken;
    const tokCli = (await api('POST', `/api/cliente/${link}/login`, { corpo: { usuario: 'cli', senha: 'senha1234' } })).json.token;
    for (const sessao of ['tokABasico', 'tokASemCampo']) {
      for (const [m, rota, corpo, recurso] of [
        ['PUT', '/hub', { dadosProjeto: 'x' }, 'paginaProjeto'], ['POST', '/documentos/previa', { secao: 'visitas' }, 'paginaProjeto'],
        ['POST', '/documentos', { secao: 'visitas', titulo: 'x', url: DRIVE }, 'paginaProjeto'], ['PUT', '/documentos/doc_x', { titulo: 'x' }, 'paginaProjeto'], ['DELETE', '/documentos/doc_x', undefined, 'paginaProjeto'],
        ['GET', '/orcamentos', undefined, 'orcamentos'], ['PUT', '/orcamentos/acesso', { usuario: 'o', senha: 'abcd' }, 'orcamentos'], ['POST', '/orcamentos/itens', { item: 'x' }, 'orcamentos'],
        ['PUT', '/orcamentos/itens/orc_x', { item: 'x' }, 'orcamentos'], ['DELETE', '/orcamentos/itens/orc_x', undefined, 'orcamentos'], ['POST', '/orcamentos/itens/orc_x/comentarios', { texto: 'x' }, 'orcamentos'], ['POST', '/orcamentos/marcar-lido', undefined, 'orcamentos']
      ]) {
        const x = await api(m, P + rota, { sessao, corpo });
        assert.strictEqual(x.status, 403, `${sessao} ${m} ${rota}`);
        assert.strictEqual(x.json.recurso, recurso);
        assert.match(x.json.erro, /não inclui o recurso/);
      }
    }
    assert.strictEqual((await api('POST', P + '/categorias', { sessao: 'tokABasico', corpo: { nome: 'Sala' } })).status, 200);
    assert.strictEqual((await api('GET', '/api/app/status/projR', { sessao: 'tokABasico' })).status, 200);
    assert.strictEqual((await api('GET', P, { sessao: 'tokABasico' })).status, 200);
    ok('12 rotas novas dão 403 (plano básico e servidor de licença antigo); categorias, status e galeria seguem normais');

    console.log('== 2. Cliente da galeria de um dono SEM o recurso: visual de sempre ==');
    assert.strictEqual((await api('GET', `/api/cliente/${link}/info-publica`)).json.novoVisual, false);
    r = await api('GET', `/api/cliente/${link}/galeria`, { cliente: tokCli });
    assert.strictEqual(r.json.novoVisual, false);
    assert.deepStrictEqual([r.json.hub.dadosProjeto, r.json.hub.documentos.length, r.json.hub.capaUrl], ['', 0, null]);
    assert.ok(!('recursosAtivos' in r.json), 'a cópia interna dos recursos não vai pro cliente');
    ok('novoVisual=false e hub vazio: o cliente cai na galeria clássica');

    console.log('== 3. Dono COM o recurso: libera tudo; a galeria existente se atualiza ao ser usada no app ==');
    r = await api('PUT', P + '/hub', { sessao: 'tokAFull', corpo: { dadosProjeto: 'Cliente: Fulano' } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual((await api('POST', P + '/documentos', { sessao: 'tokAFull', corpo: { secao: 'visitas', titulo: 'Álbum', url: DRIVE } })).status, 200);
    r = await api('PUT', P + '/orcamentos/acesso', { sessao: 'tokAFull', corpo: { usuario: 'orc', senha: 'senha-orc' } });
    const linkOrc = r.json.acesso.linkToken;
    assert.strictEqual((await api('POST', P + '/orcamentos/itens', { sessao: 'tokAFull', corpo: { item: 'Mármore', valor: 100, status: 'analise_cliente' } })).status, 200);
    assert.strictEqual((await api('GET', `/api/cliente/${link}/info-publica`)).json.novoVisual, true);
    r = await api('GET', `/api/cliente/${link}/galeria`, { cliente: tokCli });
    assert.deepStrictEqual([r.json.novoVisual, r.json.hub.dadosProjeto, r.json.hub.documentos.length], [true, 'Cliente: Fulano', 1]);
    const tokOrc = (await api('POST', `/api/orcamentos/${linkOrc}/login`, { corpo: { usuario: 'orc', senha: 'senha-orc' } })).json.token;
    assert.strictEqual((await api('GET', `/api/orcamentos/${linkOrc}/itens`, { orcamento: tokOrc })).status, 200);
    assert.match(await (await fetch(`${BASE}/orcamentos?o=${linkOrc}`)).text(), /<title>Projeto R — Orçamentos<\/title>/);
    ok('hub, visual novo e orçamentos funcionam para o cliente');

    console.log('== 4. Licença REBAIXADA: o cliente volta ao visual de sempre, SEM perder nenhum dado ==');
    assert.strictEqual((await api('GET', P, { sessao: 'tokABasico' })).status, 200); // o arquiteto abre o projeto já no plano básico
    assert.strictEqual((await api('GET', `/api/cliente/${link}/info-publica`)).json.novoVisual, false);
    r = await api('GET', `/api/cliente/${link}/galeria`, { cliente: tokCli });
    assert.deepStrictEqual([r.json.novoVisual, r.json.hub.dadosProjeto, r.json.hub.documentos.length], [false, '', 0]);
    assert.strictEqual((await api('POST', `/api/orcamentos/${linkOrc}/login`, { corpo: { usuario: 'orc', senha: 'senha-orc' } })).status, 404, 'login de orçamentos some');
    assert.strictEqual((await api('GET', `/api/orcamentos/${linkOrc}/itens`, { orcamento: tokOrc })).status, 403, 'sessão antiga de orçamentos também para');
    assert.strictEqual((await api('GET', `/api/orcamentos/${linkOrc}/info-publica`)).status, 404);
    assert.match(await (await fetch(`${BASE}/orcamentos?o=${linkOrc}`)).text(), /<title>Orçamentos do seu projeto<\/title>/, 'a página nem revela o nome do projeto');
    ok('rebaixar esconde hub, tema e orçamentos do cliente');

    console.log('== 5. Religar: tudo volta como estava (nada foi apagado) ==');
    assert.strictEqual((await api('GET', P, { sessao: 'tokAFull' })).status, 200);
    r = await api('GET', `/api/cliente/${link}/galeria`, { cliente: tokCli });
    assert.deepStrictEqual([r.json.novoVisual, r.json.hub.dadosProjeto, r.json.hub.documentos.length], [true, 'Cliente: Fulano', 1]);
    r = await api('GET', P + '/orcamentos', { sessao: 'tokAFull' });
    assert.deepStrictEqual([r.json.itens.length, r.json.acesso.usuario], [1, 'orc']);
    assert.strictEqual((await api('POST', `/api/orcamentos/${linkOrc}/login`, { corpo: { usuario: 'orc', senha: 'senha-orc' } })).status, 200);
    ok('religar devolve hub, documentos, orçamentos e o login dos orçamentos intactos');

    console.log('== 6. Só o DONO atualiza a cópia dos recursos (outra conta não liga nem desliga a galeria alheia) ==');
    assert.strictEqual((await api('GET', P, { sessao: 'tokBFull' })).status, 403);
    assert.strictEqual((await api('GET', P, { sessao: 'tokCBasico' })).status, 403);
    assert.strictEqual((await api('GET', `/api/cliente/${link}/info-publica`)).json.novoVisual, true, 'a conta C (básica) não derrubou o visual da galeria da conta A');
    ok('conta alheia não mexe na cópia dos recursos');

    console.log('== 7. A página do cliente só aplica o tema com body.visual-novo ==');
    const css = await (await fetch(`${BASE}/assets/css/style.css`)).text();
    assert.ok(css.includes('body.visual-novo[data-tema="claro"]') && css.includes('body.visual-novo:not([data-tema="escuro"])'));
    assert.ok(!/(^|\n)body\[data-tema="claro"\]/.test(css) && !/(^|\n)\s*body:not\(\[data-tema="escuro"\]\)/.test(css), 'nenhum seletor de tema vale sem a classe');
    assert.ok(css.includes('.btn-tema{ display:none; }') && css.includes('body.visual-novo .btn-tema{ display:flex; }'));
    assert.match(await (await fetch(`${BASE}/orcamentos?o=nada`)).text(), /<body class="visual-novo">/);
    ok('CSS do tema atrás da classe; botão sol/lua escondido sem ela');

    console.log('\nTODOS OS TESTES DA LIBERAÇÃO POR LICENÇA PASSARAM');
  } finally { try { filho.kill(); } catch (e) { /* já foi */ } licenca.close(); fs.rmSync(TMP, { recursive: true, force: true }); }
})().catch((e) => { console.error('FALHOU:', e && e.stack || e); process.exit(1); });
