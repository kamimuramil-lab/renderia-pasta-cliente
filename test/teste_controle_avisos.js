// Controle INTERNO de avisos nos documentos (Projeto executivo): quem o escritório já avisou sobre um projeto novo ou uma nova revisão
// (cliente, construtora, prestador de serviço). Só o escritório vê: o cliente final NUNCA recebe o campo, e marcar um aviso não conta
// como atualização do documento (não acende "novidade" pro cliente). HTTP real; portas livres aleatórias (nunca a 4102).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');
const ok = (m) => console.log('OK  ' + m);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-controle-avisos-'));
const portaLivre = () => new Promise((resolve, reject) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); s.on('error', reject); });

(async () => {
  const COMPLETA = { paginaProjeto: true, orcamentos: true, memorial: true };
  const licenca = http.createServer((req, res) => {
    let c = ''; req.on('data', (d) => { c += d; });
    req.on('end', () => {
      let token = null; try { token = JSON.parse(c).token; } catch (e) { /* vazio */ }
      const m = { tokA: { usuario: 'arqA', recursos: COMPLETA }, tokB: { usuario: 'arqB', recursos: COMPLETA }, tokBasica: { usuario: 'arqC', recursos: {} } }[token];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(m ? { valida: true, usuario: m.usuario, limiteFotos: 50, recursos: m.recursos } : { valida: false, motivo: 'Sessão inválida.' }));
    });
  });
  await new Promise((r) => licenca.listen(0, '127.0.0.1', r));
  const porta = await portaLivre();
  const filho = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { cwd: path.join(__dirname, '..'), env: Object.assign({}, process.env, { PORT: String(porta), DADOS_DIR: TMP, ARMAZENAMENTO_LOCAL_TESTE: '1', ARMAZENAMENTO_LOCAL_DIR: path.join(TMP, 'arm'), LICENCA_SERVIDOR_URL: `http://127.0.0.1:${licenca.address().port}` }) });
  let saida = ''; filho.stdout.on('data', (d) => { saida += d; }); filho.stderr.on('data', (d) => { saida += d; });
  await new Promise((resolve, reject) => { const t0 = Date.now(); const iv = setInterval(() => { if (/rodando na porta/.test(saida)) { clearInterval(iv); resolve(); } else if (Date.now() - t0 > 15000) { clearInterval(iv); reject(new Error(saida)); } }, 100); });
  const BASE = `http://127.0.0.1:${porta}`;
  const encerrar = () => { try { filho.kill(); } catch (e) { /* já foi */ } licenca.close(); };
  const api = async (m, p, { tok, cli, corpo } = {}) => {
    const o = { method: m, headers: {} };
    if (tok) o.headers['x-sessao-token'] = tok; if (cli) o.headers['x-cliente-token'] = cli;
    if (corpo !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(corpo); }
    const r = await fetch(BASE + p, o); let j = null; try { j = await r.json(); } catch (e) { /* vazio */ }
    return { status: r.status, json: j };
  };
  const dormir = (ms) => new Promise((x) => setTimeout(x, ms));

  try {
    const g = await api('POST', '/api/app/galeria', { tok: 'tokA', corpo: { projetoId: 'projA', nomeProjeto: 'Projeto A', clienteUsuario: 'cliA', clienteSenha: 'senha1234' } });
    assert.strictEqual(g.status, 200); const link = g.json.linkToken;
    const P = '/api/app/galeria/projA';

    // 1) documento novo SEM controle: nasce com o controle vazio (ninguém avisado), referente à revisão do documento
    let r = await api('POST', P + '/documentos', { tok: 'tokA', corpo: { secao: 'executivo', grupo: 'Planta de Forro', titulo: 'Forro Sala', url: 'https://drive.google.com/file/d/abc/view' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    const doc = r.json.documento;
    assert.deepStrictEqual(doc.controleInterno, { avisados: { cliente: null, construtora: null, prestador: null }, outros: '', ref: doc.revisao });
    ok('documento novo nasce com o controle de avisos vazio (ninguém avisado)');

    // 2) documento novo COM controle (marcou na criação)
    r = await api('POST', P + '/documentos', { tok: 'tokA', corpo: { secao: 'executivo', grupo: 'Iluminação e Circuitos', titulo: 'Elétrica', url: 'https://drive.google.com/file/d/def/view', controleInterno: { avisados: { cliente: '2026-11-20', construtora: '2026-11-21' }, outros: 'Eng. João (estrutural)' } } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.deepStrictEqual(r.json.documento.controleInterno.avisados, { cliente: '2026-11-20', construtora: '2026-11-21', prestador: null });
    assert.strictEqual(r.json.documento.controleInterno.outros, 'Eng. João (estrutural)');
    const doc2 = r.json.documento;
    ok('dá pra já criar o documento marcando quem foi avisado (com a data) e uma anotação livre');

    // 3) o CLIENTE nunca recebe o controle (nem o texto digitado nele)
    const login = await api('POST', `/api/cliente/${link}/login`, { corpo: { usuario: 'cliA', senha: 'senha1234' } });
    const olharCliente = async () => (await api('GET', `/api/cliente/${link}/galeria`, { cli: login.json.token })).json;
    let gc = await olharCliente();
    const texto = JSON.stringify(gc);
    ['controleInterno', 'avisados', 'Eng. João', 'construtora'].forEach((t) => assert.ok(!texto.includes(t), 'o cliente não pode receber: ' + t));
    assert.ok(gc.hub.documentos.length === 2 && gc.hub.documentos.every((d) => d.titulo), 'os documentos continuam chegando pro cliente');
    // ... mas o arquiteto recebe
    const ga = (await api('GET', P, { tok: 'tokA' })).json;
    assert.ok(ga.hub.documentos.find((d) => d.id === doc2.id).controleInterno.avisados.construtora === '2026-11-21', 'o escritório vê o controle');
    ok('o cliente final NÃO recebe o controle (nem o texto digitado nele); o escritório recebe');

    // 4) marcar um aviso NÃO é atualização: não mexe em atualizadoEm e não gera "novidade" pro cliente
    const antes = { gc: await olharCliente(), ga: (await api('GET', P, { tok: 'tokA' })).json };
    const dAntes = antes.ga.hub.documentos.find((d) => d.id === doc.id);
    await dormir(20);
    r = await api('PUT', `${P}/documentos/${doc.id}`, { tok: 'tokA', corpo: { controleInterno: { avisados: { cliente: '2026-11-22', construtora: null, prestador: '2026-11-22' }, outros: '' } } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.deepStrictEqual(r.json.documento.controleInterno.avisados, { cliente: '2026-11-22', construtora: null, prestador: '2026-11-22' });
    const depois = { gc: await olharCliente(), ga: (await api('GET', P, { tok: 'tokA' })).json };
    const dDepois = depois.ga.hub.documentos.find((d) => d.id === doc.id);
    assert.strictEqual(dDepois.atualizadoEm, dAntes.atualizadoEm, 'o documento não "mudou" pra ninguém');
    assert.strictEqual(depois.ga.atualizadoEm, antes.ga.atualizadoEm, 'a pasta também não');
    assert.deepStrictEqual(depois.gc.novidadesCliente, antes.gc.novidadesCliente, 'sem novidade nova pro cliente');
    assert.strictEqual(depois.gc.hub.documentos.find((d) => d.id === doc.id).atualizadoEm, antes.gc.hub.documentos.find((d) => d.id === doc.id).atualizadoEm);
    // contraprova: editar o documento DE VERDADE continua contando como atualização
    await dormir(20);
    r = await api('PUT', `${P}/documentos/${doc.id}`, { tok: 'tokA', corpo: { observacao: 'ajuste no forro' } });
    assert.ok(r.json.documento.atualizadoEm > dAntes.atualizadoEm, 'edição de verdade atualiza');
    assert.deepStrictEqual(r.json.documento.controleInterno.avisados, { cliente: '2026-11-22', construtora: null, prestador: '2026-11-22' }, 'editar o documento não apaga os avisos');
    ok('marcar/desmarcar aviso não vira "novidade" pro cliente; editar o documento de verdade continua valendo, sem apagar os avisos');

    // 5) nova REVISÃO: o controle guarda a revisão a que o aviso se refere (o app avisa quando ela mudou)
    r = await api('PUT', `${P}/documentos/${doc.id}`, { tok: 'tokA', corpo: { revisao: 2 } });
    assert.strictEqual(r.json.documento.revisao, 2);
    assert.strictEqual(r.json.documento.controleInterno.ref, doc.revisao, 'o aviso continua referente à revisão antiga até ser refeito');
    r = await api('PUT', `${P}/documentos/${doc.id}`, { tok: 'tokA', corpo: { controleInterno: { avisados: { cliente: '2026-11-25' } } } });
    assert.strictEqual(r.json.documento.controleInterno.ref, 2, 'avisar de novo passa a valer pra REV.2');
    ok('o aviso guarda a revisão a que se refere (nova revisão = o app mostra que falta avisar de novo)');

    // 6) validação: nada inválido é gravado
    const antesValidacao = JSON.stringify((await api('GET', P, { tok: 'tokA' })).json.hub.documentos.find((d) => d.id === doc.id).controleInterno);
    for (const ruim of [{ avisados: { cliente: '20/11/2026' } }, { avisados: { cliente: '2026-02-31' } }, { avisados: { cliente: 5 } }, { avisados: { dono: '2026-11-20' } }, { avisados: [] }, 'texto', [], { outros: 'x'.repeat(201) }]) {
      const rr = await api('PUT', `${P}/documentos/${doc.id}`, { tok: 'tokA', corpo: { controleInterno: ruim } });
      assert.strictEqual(rr.status, 400, JSON.stringify(ruim));
    }
    assert.strictEqual(JSON.stringify((await api('GET', P, { tok: 'tokA' })).json.hub.documentos.find((d) => d.id === doc.id).controleInterno), antesValidacao, 'nada foi gravado');
    r = await api('PUT', `${P}/documentos/${doc.id}`, { tok: 'tokA', corpo: { controleInterno: null } });
    assert.deepStrictEqual(r.json.documento.controleInterno.avisados, { cliente: null, construtora: null, prestador: null }, 'null = limpar');
    ok('datas/destinatários inválidos e texto enorme são recusados (400) sem gravar nada; null limpa');

    // 7) posse e licença
    assert.notStrictEqual((await api('PUT', `${P}/documentos/${doc.id}`, { tok: 'tokB', corpo: { controleInterno: { avisados: { cliente: '2026-11-20' } } } })).status, 200, 'outra conta não mexe');
    assert.strictEqual((await api('PUT', `${P}/documentos/${doc.id}`, { tok: 'tokBasica', corpo: { controleInterno: { avisados: { cliente: '2026-11-20' } } } })).status, 403, 'sem Página do projeto não mexe');
    assert.strictEqual((await api('PUT', `${P}/documentos/${doc.id}`, { corpo: { controleInterno: {} } })).status, 401, 'sem sessão');
    ok('outra conta, licença Básica e chamada sem sessão não mexem no controle');

    // 8) ordem manual / troca de status não perdem o controle
    r = await api('PUT', `${P}/documentos/${doc2.id}`, { tok: 'tokA', corpo: { status: 'REVISAO' } });
    assert.strictEqual(r.json.documento.controleInterno.avisados.cliente, '2026-11-20', 'trocar o status não apaga os avisos');
    ok('trocar o status do documento não apaga os avisos');

    console.log('\nTudo certo: controle interno de avisos.');
    encerrar();
  } catch (e) { encerrar(); console.error(e); console.error(saida.slice(-1200)); process.exit(1); }
})();
