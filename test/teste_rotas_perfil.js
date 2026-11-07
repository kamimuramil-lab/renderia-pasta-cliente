// HTTP de verdade: sobe o server.js (armazenamento local de teste + licença FALSA com duas contas) e confere as rotas
// novas -- ícone/logo da conta, "exibir ícone", remover o próprio do projeto e a direção da câmera -- incluindo a posse
// (a conta B nunca mexe no que é da conta A). Usa portas livres aleatórias (nunca a 4102, que é do servidor de teste do Rodrigo).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-rotas-perfil-'));
const ARMAZ = path.join(TMP, 'armazenamento');
const ok = (m) => console.log('OK  ' + m);

function portaLivre() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on('error', reject);
  });
}

// PNG de verdade (1x1) -- o servidor confere a assinatura dos 8 primeiros bytes
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const PNG2 = Buffer.concat([PNG, Buffer.from('')]); // mesma assinatura; bytes iguais bastam pra o teste

(async () => {
  // ---- licença falsa: tokA = conta arqA, tokB = conta arqB
  const licenca = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', (c) => { corpo += c; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      let token = null; try { token = JSON.parse(corpo).token; } catch (e) { /* vazio */ }
      const usuario = { tokA: 'arqA', tokB: 'arqB' }[token];
      res.end(JSON.stringify(usuario ? { valida: true, usuario, limiteFotos: 50 } : { valida: false, motivo: 'Sessão inválida.' }));
    });
  });
  await new Promise((r) => licenca.listen(0, '127.0.0.1', r));
  const portaLicenca = licenca.address().port;

  const porta = await portaLivre();
  const filho = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: path.join(__dirname, '..'),
    env: Object.assign({}, process.env, {
      PORT: String(porta), DADOS_DIR: TMP, ARMAZENAMENTO_LOCAL_TESTE: '1', ARMAZENAMENTO_LOCAL_DIR: ARMAZ,
      LICENCA_SERVIDOR_URL: `http://127.0.0.1:${portaLicenca}`
    })
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

  const api = async (metodo, caminho, token, corpo) => {
    const opcoes = { method: metodo, headers: {} };
    if (token) opcoes.headers['x-sessao-token'] = token;
    if (corpo instanceof FormData) opcoes.body = corpo;
    else if (corpo !== undefined) { opcoes.headers['Content-Type'] = 'application/json'; opcoes.body = JSON.stringify(corpo); }
    const r = await fetch(BASE + caminho, opcoes);
    let json = null; try { json = await r.json(); } catch (e) { /* sem corpo */ }
    return { status: r.status, json };
  };
  const arquivo = (buffer, nome, tipo) => { const f = new FormData(); f.append('arquivo', new Blob([buffer], { type: tipo || 'image/png' }), nome); return f; };
  const urlCompleta = (u) => (u.startsWith('/') ? BASE + u : u);

  try {
    // ---- 1) sem sessão
    assert.strictEqual((await api('GET', '/api/app/perfil')).status, 401);
    assert.strictEqual((await api('POST', '/api/app/perfil/icone', 'invalido', arquivo(PNG, 'i.png'))).status, 401);
    ok('sem sessão (ou sessão inválida): 401 nas rotas do perfil');

    // ---- 2) perfil começa vazio; arquivo que NÃO é PNG é recusado
    let r = await api('GET', '/api/app/perfil', 'tokA');
    assert.deepStrictEqual([r.status, r.json.icone.existe, r.json.marca.existe], [200, false, false]);
    r = await api('POST', '/api/app/perfil/icone', 'tokA', arquivo(Buffer.from('<html>nao sou png</html>'), 'i.png'));
    assert.strictEqual(r.status, 400); assert.match(r.json.erro, /PNG/);
    r = await api('POST', '/api/app/perfil/icone', 'tokA', new FormData());
    assert.strictEqual(r.status, 400); assert.match(r.json.erro, /Nenhum arquivo/);
    ok('perfil começa vazio; arquivo que não é PNG (ou ausente) é recusado');

    // ---- 3) conta A envia ícone e logo
    r = await api('POST', '/api/app/perfil/icone', 'tokA', arquivo(PNG, 'icone.png'));
    assert.strictEqual(r.status, 200); assert.strictEqual(r.json.perfil.icone.existe, true);
    const urlIcone1 = r.json.perfil.icone.url;
    r = await api('POST', '/api/app/perfil/marca', 'tokA', arquivo(PNG, 'logo.png'));
    assert.strictEqual(r.status, 200); assert.strictEqual(r.json.perfil.marca.existe, true);
    assert.strictEqual((await fetch(urlCompleta(urlIcone1))).status, 200, 'o arquivo do ícone é servido');
    ok('conta A envia ícone e logo (PNG) e os arquivos ficam disponíveis');

    // ---- 4) galerias: A tem dois projetos, B tem um
    const criar = (token, projetoId, usuario) => api('POST', '/api/app/galeria', token, { projetoId, nomeProjeto: 'P ' + projetoId, clienteUsuario: usuario, clienteSenha: 'senha1234' });
    const gA1 = await criar('tokA', 'projA1', 'clienteA1'); const gA2 = await criar('tokA', 'projA2', 'clienteA2'); const gB = await criar('tokB', 'projB1', 'clienteB1');
    assert.ok(gA1.json.linkToken && gA2.json.linkToken && gB.json.linkToken);
    for (const pid of ['projA1', 'projA2']) {
      const g = (await api('GET', `/api/app/galeria/${pid}`, 'tokA')).json;
      assert.strictEqual(g.iconePersonalizado.origem, 'conta', pid);
      assert.ok(g.iconePersonalizado.url && g.iconePersonalizado.url.includes('perfis/'), 'url do ícone da conta em ' + pid);
      assert.strictEqual(g.iconePersonalizado.exibir, true);
      assert.strictEqual(g.marcaDagua.origem, 'conta');
      assert.strictEqual(g.marcaDagua.ativa, true, 'logo ligado por padrão');
      assert.ok(g.marcaDagua.url && g.marcaDagua.url.includes('perfis/'));
    }
    ok('os DOIS projetos da conta A já usam o ícone e o logo da conta (sem configurar nada em cada um); logo ligado por padrão');

    // ---- 5) conta B não tem nada, e não enxerga o da A
    r = await api('GET', '/api/app/perfil', 'tokB');
    assert.deepStrictEqual([r.json.icone.existe, r.json.marca.existe], [false, false]);
    const gb = (await api('GET', '/api/app/galeria/projB1', 'tokB')).json;
    assert.deepStrictEqual([gb.iconePersonalizado.url, gb.iconePersonalizado.origem, gb.marcaDagua.url, gb.marcaDagua.origem], [null, null, null, null]);
    ok('a conta B não herda nada da conta A');

    // ---- 6) posse: B não mexe nos projetos de A
    r = await api('PUT', '/api/app/galeria/projA1/icone', 'tokB', { exibir: false });
    assert.strictEqual(r.status, 400); assert.match(r.json.erro, /não pertence/);
    r = await api('DELETE', '/api/app/galeria/projA1/icone', 'tokB');
    assert.strictEqual(r.status, 400); assert.match(r.json.erro, /não pertence/);
    r = await api('DELETE', '/api/app/galeria/projA1/marca-dagua', 'tokB');
    assert.strictEqual(r.status, 400);
    assert.strictEqual((await api('GET', '/api/app/galeria/projA1', 'tokB')).status, 403);
    assert.strictEqual((await api('GET', '/api/app/galeria/projA1', 'tokA')).json.iconePersonalizado.exibir, true, 'nada mudou');
    ok('posse: a conta B não liga/desliga nem remove nada de um projeto da conta A');

    // ---- 7) "Exibir ícone" desligado: o cliente não recebe o ícone, o app ainda vê o arquivo; o link do projeto também some
    assert.strictEqual((await api('PUT', '/api/app/galeria/projA1/icone', 'tokA', { exibir: 'sim' })).status, 400, 'exige boolean');
    r = await api('PUT', '/api/app/galeria/projA1/icone', 'tokA', { exibir: false });
    assert.strictEqual(r.status, 200);
    let g = (await api('GET', '/api/app/galeria/projA1', 'tokA')).json;
    assert.strictEqual(g.iconePersonalizado.url, null); assert.ok(g.iconePersonalizado.urlArquivo, 'o app ainda enxerga o arquivo'); assert.strictEqual(g.iconePersonalizado.exibir, false);
    const paginaOff = await (await fetch(`${BASE}/?g=${gA1.json.linkToken}`)).text();
    assert.ok(!paginaOff.includes('perfis/'), 'prévia do link sem o ícone quando "Exibir ícone" está desligado');
    const paginaA2 = await (await fetch(`${BASE}/?g=${gA2.json.linkToken}`)).text();
    assert.ok(paginaA2.includes('perfis/'), 'o outro projeto continua com o ícone na prévia do link');
    await api('PUT', '/api/app/galeria/projA1/icone', 'tokA', { exibir: true });
    assert.ok((await (await fetch(`${BASE}/?g=${gA1.json.linkToken}`)).text()).includes('perfis/'));
    ok('"Exibir ícone" desligado: o cliente não recebe o ícone (nem na prévia do link); religar traz de volta');

    // ---- 8) logo desligado por projeto
    r = await api('PUT', '/api/app/galeria/projA1/marca-dagua', 'tokA', { ativa: false });
    assert.strictEqual(r.status, 200);
    g = (await api('GET', '/api/app/galeria/projA1', 'tokA')).json;
    assert.strictEqual(g.marcaDagua.ativa, false); assert.ok(g.marcaDagua.url, 'arquivo continua, só não é exibido (ativa=false)');
    assert.strictEqual((await api('GET', '/api/app/galeria/projA2', 'tokA')).json.marcaDagua.ativa, true, 'o outro projeto não foi afetado');
    await api('PUT', '/api/app/galeria/projA1/marca-dagua', 'tokA', { ativa: true });
    ok('"Exibir logo" é por projeto (usa a opção que já existia)');

    // ---- 9) ícone PRÓPRIO do projeto vence o da conta; remover volta ao da conta e apaga o arquivo
    r = await api('POST', '/api/app/galeria/projA2/icone', 'tokA', arquivo(PNG2, 'proprio.png'));
    assert.strictEqual(r.status, 200);
    g = (await api('GET', '/api/app/galeria/projA2', 'tokA')).json;
    assert.strictEqual(g.iconePersonalizado.origem, 'projeto'); assert.ok(!g.iconePersonalizado.url.includes('perfis/'));
    const urlPropria = g.iconePersonalizado.url;
    assert.strictEqual((await fetch(urlCompleta(urlPropria))).status, 200);
    r = await api('DELETE', '/api/app/galeria/projA2/icone', 'tokA');
    assert.strictEqual(r.status, 200);
    g = (await api('GET', '/api/app/galeria/projA2', 'tokA')).json;
    assert.strictEqual(g.iconePersonalizado.origem, 'conta'); assert.ok(g.iconePersonalizado.url.includes('perfis/'));
    assert.strictEqual((await fetch(urlCompleta(urlPropria))).status, 404, 'arquivo próprio apagado do armazenamento');
    ok('ícone próprio do projeto vence; "voltar ao da conta" remove e apaga o arquivo');

    // ---- 10) trocar o ícone da conta apaga o arquivo antigo; remover limpa tudo
    r = await api('POST', '/api/app/perfil/icone', 'tokA', arquivo(PNG, 'novo.png'));
    const urlIcone2 = r.json.perfil.icone.url;
    assert.notStrictEqual(urlIcone2, urlIcone1);
    assert.strictEqual((await fetch(urlCompleta(urlIcone1))).status, 404, 'arquivo antigo da conta apagado');
    assert.strictEqual((await fetch(urlCompleta(urlIcone2))).status, 200);
    r = await api('DELETE', '/api/app/perfil/icone', 'tokA');
    assert.strictEqual(r.json.perfil.icone.existe, false); assert.strictEqual(r.json.perfil.marca.existe, true, 'o logo continua');
    assert.strictEqual((await fetch(urlCompleta(urlIcone2))).status, 404);
    assert.strictEqual((await api('GET', '/api/app/galeria/projA1', 'tokA')).json.iconePersonalizado.origem, null);
    r = await api('DELETE', '/api/app/perfil/marca', 'tokA');
    assert.strictEqual(r.json.perfil.marca.existe, false);
    ok('trocar o ícone da conta apaga o arquivo antigo; remover ícone/logo deixa os projetos sem eles');

    // ---- 11) direção da câmera por HTTP
    r = await api('POST', '/api/app/galeria/projA1/plantas', 'tokA', arquivo(PNG, 'planta.png'));
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    const plantaId = r.json.planta.id;
    const fd = arquivo(PNG, 'foto.webp', 'image/webp'); fd.append('nomeExibicao', 'Sala'); fd.append('tipo', 'fixa');
    r = await api('POST', '/api/app/galeria/projA1/fotos', 'tokA', fd);
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    const fotoId = r.json.foto.id;
    const fd360 = arquivo(PNG, 'foto360.webp', 'image/webp'); fd360.append('nomeExibicao', 'Sala 360'); fd360.append('tipo', '360');
    const foto360Id = (await api('POST', '/api/app/galeria/projA1/fotos', 'tokA', fd360)).json.foto.id;

    r = await api('PUT', `/api/app/galeria/projA1/fotos/${fotoId}/direcao`, 'tokA', { angulo: 90 });
    assert.strictEqual(r.status, 400); assert.match(r.json.erro, /ainda não está na planta/);
    r = await api('PUT', `/api/app/galeria/projA1/fotos/${fotoId}/posicao`, 'tokA', { plantaId, x: 0.4, y: 0.5 });
    assert.deepStrictEqual(r.json.foto.pinPlanta, { x: 0.4, y: 0.5 });
    r = await api('PUT', `/api/app/galeria/projA1/fotos/${fotoId}/direcao`, 'tokA', { angulo: 120 });
    assert.strictEqual(r.status, 200); assert.deepStrictEqual(r.json.foto.pinPlanta, { x: 0.4, y: 0.5, angulo: 120 });
    // mover (como o app antigo faz, sem mandar ângulo) NÃO perde a direção
    r = await api('PUT', `/api/app/galeria/projA1/fotos/${fotoId}/posicao`, 'tokA', { plantaId, x: 0.7, y: 0.2 });
    assert.deepStrictEqual(r.json.foto.pinPlanta, { x: 0.7, y: 0.2, angulo: 120 });
    // o cliente (página) recebe o ângulo junto com a foto
    g = (await api('GET', '/api/app/galeria/projA1', 'tokA')).json;
    assert.strictEqual(g.fotos.find((f) => f.id === fotoId).pinPlanta.angulo, 120);
    assert.strictEqual((await api('PUT', `/api/app/galeria/projA1/fotos/${fotoId}/direcao`, 'tokA', {})).status, 400, 'sem o campo angulo: recusa (não apaga sem querer)');
    assert.strictEqual((await api('PUT', `/api/app/galeria/projA1/fotos/${fotoId}/direcao`, 'tokA', { angulo: 'abc' })).status, 400);
    assert.strictEqual((await api('PUT', `/api/app/galeria/projA1/fotos/${fotoId}/direcao`, 'tokB', { angulo: 5 })).status, 400, 'B não direciona foto de A');
    assert.strictEqual((await api('GET', '/api/app/galeria/projA1', 'tokA')).json.fotos.find((f) => f.id === fotoId).pinPlanta.angulo, 120);
    await api('PUT', `/api/app/galeria/projA1/fotos/${foto360Id}/posicao`, 'tokA', { plantaId, x: 0.1, y: 0.1 });
    r = await api('PUT', `/api/app/galeria/projA1/fotos/${foto360Id}/direcao`, 'tokA', { angulo: 10 });
    assert.strictEqual(r.status, 400); assert.match(r.json.erro, /360/);
    r = await api('PUT', `/api/app/galeria/projA1/fotos/${fotoId}/direcao`, 'tokA', { angulo: null });
    assert.deepStrictEqual(r.json.foto.pinPlanta, { x: 0.7, y: 0.2 });
    ok('direção da câmera por HTTP: define, normaliza, sobrevive a mover, aparece pro cliente, recusa lixo/360/outra conta, null tira');

    console.log('OK teste_rotas_perfil');
    encerrar();
    process.exit(0);
  } catch (e) {
    console.error('FALHOU:', e);
    console.error('--- saída do servidor ---\n' + saida);
    encerrar();
    process.exit(1);
  }
})().catch((e) => { console.error('FALHOU (preparo):', e); process.exit(1); });
