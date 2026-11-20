// Segurança e privacidade (LGPD): gravação segura do arquivo de dados, backup diário (60 dias) + restauração, excluir a Pasta do Cliente
// inteira (arquivos incluídos), registro de atividades (IP pela metade, isolado por conta, 180 dias) e novidades por aba guardadas no
// servidor (valem no modo escritório). Parte em lib pura, parte HTTP de verdade (server.js com licença FALSA de duas contas, porta aleatória).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const net = require('net');
const { spawn, spawnSync } = require('child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-priv-'));
const ARM = path.join(TMP, 'arm');
process.env.ARMAZENAMENTO_LOCAL_TESTE = '1';
process.env.ARMAZENAMENTO_LOCAL_DIR = ARM;
process.env.DADOS_DIR = path.join(TMP, 'dados');
const galeria = require('../lib/galeria');
const storage = require('../lib/storage');
const backup = require('../lib/backup');
const atividades = require('../lib/atividades');
const ok = (m) => console.log('OK  ' + m);
const portaLivre = () => new Promise((resolve, reject) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); s.on('error', reject); });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('== 1. Gravação segura do arquivo de dados ==');
  {
    const dir = fs.mkdtempSync(path.join(TMP, 'seg-'));
    const arq = path.join(dir, 'dados-galerias.json');
    assert.deepStrictEqual(galeria.lerEstado(arq), { galerias: [], perfis: {} }, 'primeira execução (sem arquivo) = vazio');
    galeria.criarOuAtualizarGaleria(arq, { projetoId: 'p1', licencaUsuario: 'a', nomeProjeto: 'Um', clienteUsuario: 'c', clienteSenha: 'senha1234' });
    galeria.criarOuAtualizarGaleria(arq, { projetoId: 'p2', licencaUsuario: 'a', nomeProjeto: 'Dois', clienteUsuario: 'c', clienteSenha: 'senha1234' });
    assert.ok(fs.existsSync(arq + '.bak'), 'a versão anterior fica guardada (.bak)');
    assert.strictEqual(JSON.parse(fs.readFileSync(arq + '.bak', 'utf8')).galerias.length, 1, 'o .bak é a versão de UM passo atrás');
    assert.ok(!fs.readdirSync(dir).some((n) => n.includes('.tmp-')), 'nenhum arquivo temporário sobra');
    // arquivo principal estragado: usa a cópia anterior, e a cópia boa NÃO é trocada pela estragada no próximo salvamento
    fs.writeFileSync(arq, '{"galerias": [ {"proj');
    const origErr = console.error; console.error = () => {};
    assert.strictEqual(galeria.lerEstado(arq).galerias.length, 1, 'ilegível -> volta pra cópia anterior');
    galeria.criarOuAtualizarGaleria(arq, { projetoId: 'p3', licencaUsuario: 'a', nomeProjeto: 'Três', clienteUsuario: 'c', clienteSenha: 'senha1234' });
    assert.strictEqual(galeria.lerEstado(arq).galerias.length, 2, 'depois de salvar, o arquivo principal volta a ser bom');
    // nenhum dos dois serve: PARA (não devolve "vazio", senão o próximo salvamento apagaria tudo)
    fs.writeFileSync(arq, 'lixo'); fs.writeFileSync(arq + '.bak', 'lixo também');
    assert.throws(() => galeria.lerEstado(arq), /ilegível e não há cópia boa/);
    assert.throws(() => galeria.criarOuAtualizarGaleria(arq, { projetoId: 'p9', licencaUsuario: 'a', nomeProjeto: 'Nove', clienteUsuario: 'c', clienteSenha: 'senha1234' }), /ilegível/);
    assert.strictEqual(fs.readFileSync(arq, 'utf8'), 'lixo', 'nada foi sobrescrito');
    console.error = origErr;
    ok('grava via temporário + .bak; ilegível volta pra cópia; sem cópia boa o servidor para em vez de apagar tudo');
  }

  console.log('== 2. Backup diário (60 dias), backup na hora e restauração ==');
  {
    const arq = path.join(TMP, 'estado-backup.json');
    galeria.criarOuAtualizarGaleria(arq, { projetoId: 'b1', licencaUsuario: 'a', nomeProjeto: 'Backup', clienteUsuario: 'c', clienteSenha: 'senha1234' });
    const dia = (n) => new Date(Date.UTC(2026, 0, 1 + n, 12));
    let r = await backup.garantirBackupDoDia(arq, dia(0));
    assert.deepStrictEqual([r.criado, r.chave], [true, backup.PREFIXO + 'estado-2026-01-01.json']);
    assert.strictEqual((await backup.garantirBackupDoDia(arq, dia(0))).criado, false, 'no mesmo dia não duplica');
    for (let i = 1; i <= 64; i++) await backup.garantirBackupDoDia(arq, dia(i));
    const lista = await backup.listar();
    assert.strictEqual(lista.length, 60, 'guarda só os 60 mais recentes');
    assert.ok(lista[0].chave.endsWith('estado-2026-03-06.json') && !lista.some((b) => b.chave.endsWith('estado-2026-01-01.json')), 'os mais antigos saem');
    const avulso = await backup.criarAgora(arq, 'antes-de-excluir');
    assert.ok(/estado-.*-antes-de-excluir\.json$/.test(avulso.chave) && fs.existsSync(path.join(ARM, avulso.chave)));
    // arquivo estragado: não faz backup (não troca um backup bom por lixo)
    const ruim = path.join(TMP, 'ruim.json'); fs.writeFileSync(ruim, '{estragado');
    await assert.rejects(backup.garantirBackupDoDia(ruim, dia(100)), /JSON|Unexpected|property/i);
    assert.strictEqual((await backup.garantirBackupDoDia(path.join(TMP, 'nao-existe.json'), dia(101))).criado, false, 'sem dados ainda: nada a guardar');
    // restauração (script de verdade, mesmas variáveis de ambiente)
    const env = Object.assign({}, process.env, { DADOS_DIR: path.join(TMP, 'restaurar') });
    const lis = spawnSync(process.execPath, [path.join(__dirname, '..', 'restaurar-backup.js')], { env, encoding: 'utf8' });
    assert.ok(lis.stdout.includes(lista[0].chave), 'sem argumento: lista os backups');
    fs.mkdirSync(env.DADOS_DIR, { recursive: true });
    fs.writeFileSync(path.join(env.DADOS_DIR, 'dados-galerias.json'), JSON.stringify({ galerias: [], perfis: { x: 1 } }));
    const rest = spawnSync(process.execPath, [path.join(__dirname, '..', 'restaurar-backup.js'), lista[0].chave], { env, encoding: 'utf8' });
    assert.ok(/Restaurado/.test(rest.stdout), rest.stdout + rest.stderr);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(env.DADOS_DIR, 'dados-galerias.json'), 'utf8')).galerias[0].projetoId, 'b1', 'o arquivo de dados é o do backup');
    assert.ok(fs.readdirSync(env.DADOS_DIR).some((n) => n.includes('antes-da-restauracao')), 'o arquivo de antes NÃO é jogado fora');
    assert.notStrictEqual(spawnSync(process.execPath, [path.join(__dirname, '..', 'restaurar-backup.js'), 'qualquer/outra/coisa.json'], { env, encoding: 'utf8' }).status, 0, 'só aceita chave de backup da Pasta do Cliente');
    ok('um por dia, 60 mais recentes, backup na hora, estragado não vira backup, restaurar funciona e guarda o arquivo de antes');
  }

  console.log('== 3. Registro de atividades (lib): IP pela metade, isolamento, repetidos, 180 dias ==');
  {
    const arq = path.join(TMP, 'ativ', 'dados-galerias.json');
    assert.strictEqual(atividades.anonimizarIp('187.12.34.56'), '187.12.34.0');
    assert.strictEqual(atividades.anonimizarIp('::ffff:10.1.2.3'), '10.1.2.0');
    assert.strictEqual(atividades.anonimizarIp('2804:14d:1234:5678::1'), '2804:14d:1234::');
    assert.strictEqual(atividades.anonimizarIp('lixo'), '');
    assert.ok(atividades.registrar(arq, { tipo: 'cliente_login', licenca: 'A', projetoId: 'p1', ip: '1.2.3.4' }));
    assert.ok(atividades.registrar(arq, { tipo: 'cliente_abriu', licenca: 'A', projetoId: 'p1', ip: '1.2.3.4' }));
    assert.strictEqual(atividades.registrar(arq, { tipo: 'cliente_abriu', licenca: 'A', projetoId: 'p1', ip: '1.2.3.9' }), false, 'mesmo projeto e mesmo aparelho (IP pela metade) em 30 min: uma linha só');
    assert.ok(atividades.registrar(arq, { tipo: 'dashboard_login_falha', licenca: 'A', ip: '1.2.3.4' }));
    assert.ok(atividades.registrar(arq, { tipo: 'cliente_login', licenca: 'B', projetoId: 'pB', ip: '9.9.9.9' }));
    assert.strictEqual(atividades.registrar(arq, { tipo: 'tipo_inventado', licenca: 'A' }), false, 'tipo desconhecido não entra');
    assert.deepStrictEqual(atividades.listar(arq, { licenca: 'A', projetoId: 'p1' }).map((e) => e.tipo).sort(), ['cliente_abriu', 'cliente_login']);
    assert.deepStrictEqual(atividades.listar(arq, { licenca: 'A' }).map((e) => e.tipo), ['dashboard_login_falha'], 'sem projeto = eventos da conta');
    assert.deepStrictEqual(atividades.listar(arq, { licenca: 'B', projetoId: 'p1' }), [], 'a conta B não enxerga o projeto da A');
    assert.ok(!fs.readFileSync(atividades.caminhoDoRegistro(arq), 'utf8').includes('1.2.3.4'), 'o IP inteiro nunca é gravado');
    // 180 dias
    fs.appendFileSync(atividades.caminhoDoRegistro(arq), JSON.stringify({ t: new Date(Date.now() - 181 * 86400000).toISOString(), tipo: 'cliente_login', licenca: 'A', projetoId: 'p1', ip: '', detalhe: '' }) + '\n');
    assert.strictEqual(atividades.limparAntigas(arq), 1, 'passou de 180 dias: sai');
    assert.strictEqual(atividades.listar(arq, { licenca: 'A', projetoId: 'p1' }).length, 2);
    assert.strictEqual(atividades.apagarDoProjeto(arq, 'A', 'p1'), 2, 'apagar o projeto apaga o registro dele');
    ok('IP pela metade, tipo desconhecido recusado, repetidos juntos, conta isolada, 180 dias, some junto com o projeto');
  }

  // ---------------- HTTP ----------------
  const licenca = http.createServer((req, res) => {
    let corpo = ''; req.on('data', (c) => { corpo += c; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      let token = null; try { token = JSON.parse(corpo).token; } catch (e) { /* vazio */ }
      const u = { tokA: 'arqA', tokB: 'arqB' }[token];
      res.end(JSON.stringify(u ? { valida: true, usuario: u, limiteFotos: 50, recursos: { paginaProjeto: true, orcamentos: true, memorial: true } } : { valida: false, motivo: 'Sessão inválida.' }));
    });
  });
  await new Promise((r) => licenca.listen(0, '127.0.0.1', r));
  const porta = await portaLivre();
  const filho = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { cwd: path.join(__dirname, '..'), env: Object.assign({}, process.env, { PORT: String(porta), LICENCA_SERVIDOR_URL: `http://127.0.0.1:${licenca.address().port}` }) });
  let saida = ''; filho.stdout.on('data', (d) => { saida += d; }); filho.stderr.on('data', (d) => { saida += d; });
  await new Promise((resolve, reject) => { const t0 = Date.now(); const iv = setInterval(() => { if (/rodando na porta/.test(saida)) { clearInterval(iv); resolve(); } else if (Date.now() - t0 > 15000) { clearInterval(iv); reject(new Error('servidor não subiu: ' + saida)); } }, 100); });
  const BASE = `http://127.0.0.1:${porta}`;
  const encerrar = () => { try { filho.kill(); } catch (e) { /* já foi */ } licenca.close(); };
  const api = async (metodo, caminho, { sessao, cliente, dash, corpo, ip } = {}) => {
    const o = { method: metodo, headers: {} };
    if (sessao) o.headers['x-sessao-token'] = sessao;
    if (cliente) o.headers['x-cliente-token'] = cliente;
    if (dash) o.headers['x-dashboard-token'] = dash;
    if (ip) o.headers['x-forwarded-for'] = ip;
    if (corpo !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(corpo); }
    const r = await fetch(BASE + caminho, o);
    let json = null; try { json = await r.json(); } catch (e) { /* sem corpo */ }
    return { status: r.status, json };
  };
  const CAM = galeria.caminhoPadrao();
  const existe = (k) => fs.existsSync(path.join(ARM, k));

  try {
    const criar = (sessao, projetoId, nome) => api('POST', '/api/app/galeria', { sessao, corpo: { projetoId, nomeProjeto: nome, clienteUsuario: 'cli', clienteSenha: 'senha1234' } });
    const linkA = (await criar('tokA', 'pA', 'Projeto Alfa')).json.linkToken;
    const linkB = (await criar('tokB', 'pB', 'Projeto Beta')).json.linkToken;
    // arquivos de verdade no armazenamento (fotos, planta, memorial, comentário com desenho, logo próprio) -- tudo isso tem que sumir na exclusão
    const arquivo = async (k) => { await storage.salvarArquivo(k, Buffer.from('x'), 'image/png'); return k; };
    const fotoA1 = galeria.adicionarFoto(CAM, 'pA', { nomeExibicao: 'F1', tipo: 'fixa', r2Key: await arquivo('pA/f1.webp') });
    galeria.adicionarFoto(CAM, 'pA', { nomeExibicao: 'F2', tipo: 'fixa', r2Key: await arquivo('pA/f2.webp') });
    galeria.adicionarFoto(CAM, 'pB', { nomeExibicao: 'B1', tipo: 'fixa', r2Key: await arquivo('pB/b1.webp') });
    galeria.adicionarPlanta(CAM, 'pA', { nome: 'Térreo', r2Key: await arquivo('pA/planta.png') }, 'arqA');
    const itemMem = (await api('POST', '/api/app/galeria/pA/memorial/itens', { sessao: 'tokA', corpo: { setor: 'Acessórios', item: 'Varal' } })).json.item;
    await arquivo('pA/memorial-foto.webp');
    const estado = JSON.parse(fs.readFileSync(CAM, 'utf8'));
    const gA = estado.galerias.find((g) => g.projetoId === 'pA');
    gA.memorial.itens.find((i) => i.id === itemMem.id).fotoR2Key = 'pA/memorial-foto.webp';
    gA.marcaDagua.r2Key = await arquivo('pA/logo-proprio.png');
    gA.fotos[0].comentarios = [{ id: 'c1', autor: 'cliente', texto: 'oi', desenhoR2Key: await arquivo('pA/desenho.png'), criadoEm: new Date().toISOString() }];
    fs.writeFileSync(CAM, JSON.stringify(estado));
    const fotoB = existe('pB/b1.webp');
    assert.ok(fotoA1 && fotoB);

    console.log('== 4. Novidades guardadas no servidor (valem também no modo escritório) ==');
    const loginCli = async (link, ip) => (await api('POST', `/api/cliente/${link}/login`, { corpo: { usuario: 'cli', senha: 'senha1234' }, ip })).json.token;
    let tokCli = await loginCli(linkA, '187.12.34.56');
    let r = await api('GET', `/api/cliente/${linkA}/galeria`, { cliente: tokCli, ip: '187.12.34.56' });
    assert.deepStrictEqual(r.json.novidadesCliente, {}, 'primeiro acesso: nada é novo (foto base)');
    assert.ok(!('vistoCliente' in r.json), 'o controle interno não vai pro cliente');
    await espera(30);
    const doc = (await api('POST', '/api/app/galeria/pA/documentos', { sessao: 'tokA', corpo: { secao: 'executivo', grupo: 'Pintura e Revestimentos', titulo: 'Projeto NOVO', url: 'https://drive.google.com/file/d/abc/view', status: 'ATUAL' } })).json.documento;
    await api('POST', '/api/app/galeria/pA/memorial/itens', { sessao: 'tokA', corpo: { setor: 'Acessórios', item: 'Item novo' } });
    r = await api('GET', `/api/cliente/${linkA}/galeria`, { cliente: tokCli });
    assert.deepStrictEqual(r.json.novidadesCliente.executivo, [{ id: doc.id, tag: 'NOVO' }]);
    assert.strictEqual(r.json.novidadesCliente.memorial.length, 1);
    // modo escritório: vê as MESMAS bolinhas, mas ler não apaga nada
    const tokEsc = (await api('POST', '/api/dashboard/' + (await (async () => { const s = await api('PUT', '/api/app/dashboard/senha', { sessao: 'tokA', corpo: { senha: 'mestra123' } }); return s.json.linkToken; })()) + '/login', { corpo: { senha: 'mestra123' } })).json.token;
    const linkDash = (await api('GET', '/api/app/dashboard', { sessao: 'tokA' })).json.linkToken;
    const aberto = (await api('POST', `/api/dashboard/${linkDash}/projetos/pA/abrir`, { dash: tokEsc, ip: '10.0.0.1' })).json;
    r = await api('GET', `/api/cliente/${linkA}/galeria`, { cliente: aberto.token });
    assert.deepStrictEqual([r.json.modoEscritorio, r.json.novidadesCliente.executivo.length], [true, 1], 'o escritório vê o que o cliente veria');
    assert.strictEqual((await api('POST', `/api/cliente/${linkA}/visto`, { cliente: aberto.token, corpo: { secao: 'executivo' } })).json.ignorado, true, 'escritório não marca como visto');
    r = await api('GET', `/api/cliente/${linkA}/galeria`, { cliente: tokCli });
    assert.strictEqual(r.json.novidadesCliente.executivo.length, 1, 'continua novidade para o cliente de verdade');
    // o cliente abre a aba: some só ela
    assert.strictEqual((await api('POST', `/api/cliente/${linkA}/visto`, { cliente: tokCli, corpo: { secao: 'executivo' } })).status, 200);
    assert.strictEqual((await api('POST', `/api/cliente/${linkA}/visto`, { cliente: tokCli, corpo: { secao: 'inventada' } })).status, 400);
    r = await api('GET', `/api/cliente/${linkA}/galeria`, { cliente: tokCli });
    assert.deepStrictEqual([r.json.novidadesCliente.executivo, r.json.novidadesCliente.memorial.length], [undefined, 1], 'a aba aberta zera; a outra continua');
    // documento alterado = ATUALIZADO; a versão ANTIGA nunca conta
    await espera(30);
    await api('PUT', `/api/app/galeria/pA/documentos/${doc.id}`, { sessao: 'tokA', corpo: { titulo: 'Projeto NOVO (rev.)' } });
    r = await api('GET', `/api/cliente/${linkA}/galeria`, { cliente: tokCli });
    assert.deepStrictEqual(r.json.novidadesCliente.executivo, [{ id: doc.id, tag: 'ATUALIZADO' }]);
    // a conta B tem a foto base e as novidades dela, separadas
    const tokB = await loginCli(linkB);
    assert.deepStrictEqual((await api('GET', `/api/cliente/${linkB}/galeria`, { cliente: tokB })).json.novidadesCliente, {});
    ok('foto base silenciosa, novo x atualizado, escritório vê sem apagar, aba aberta zera só ela, contas separadas');

    // projeto ANTIGO que o cliente ainda não abriu: a primeira mudança do escritório já conta como novidade (a base nasce antes dela)
    const linkC = (await criar('tokA', 'pC', 'Projeto Antigo')).json.linkToken;
    const linkD = (await criar('tokA', 'pD', 'Projeto Recém-criado')).json.linkToken;
    const est2 = JSON.parse(fs.readFileSync(CAM, 'utf8'));
    est2.galerias.find((g) => g.projetoId === 'pC').criadoEm = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
    fs.writeFileSync(CAM, JSON.stringify(est2));
    await api('POST', '/api/app/galeria/pC/memorial/itens', { sessao: 'tokA', corpo: { setor: 'Acessórios', item: 'Item que o cliente ainda não viu' } });
    await api('POST', '/api/app/galeria/pD/memorial/itens', { sessao: 'tokA', corpo: { setor: 'Acessórios', item: 'Projeto em montagem' } });
    await api('POST', '/api/app/galeria/pB/memorial/itens', { sessao: 'tokB', corpo: { setor: 'Acessórios', item: 'B' } }); // contas separadas: mexer na B não cria base na C
    const antes = galeria.buscarGaleriaPorLinkToken(CAM, linkC);
    assert.ok(antes.vistoCliente && antes.vistoCliente.base, 'a base nasceu na 1ª mudança do projeto antigo');
    assert.strictEqual(galeria.garantirBaseAntesDeMudar(CAM, 'pC', 'arqB'), false, 'outra conta não mexe na base');
    r = await api('GET', `/api/cliente/${linkC}/galeria`, { cliente: await loginCli(linkC) });
    assert.deepStrictEqual([r.json.novidadesCliente.memorial.length, r.json.novidadesCliente.memorial[0].tag], [1, 'NOVO'], 'o cliente entra pela 1ª vez e o item novo já aparece como novidade');
    r = await api('GET', `/api/cliente/${linkD}/galeria`, { cliente: await loginCli(linkD) });
    assert.deepStrictEqual(r.json.novidadesCliente, {}, 'projeto com menos de 24 h continua em silêncio na 1ª visita');
    ok('projeto antigo ainda não aberto: a 1ª mudança vira novidade; projeto recém-criado fica em silêncio; outra conta não interfere');

    console.log('== 5. Registro de atividades pelo servidor ==');
    assert.strictEqual((await api('POST', `/api/cliente/${linkA}/login`, { corpo: { usuario: 'cli', senha: 'errada' }, ip: '200.1.2.3' })).status, 401);
    assert.strictEqual((await api('POST', `/api/dashboard/${linkDash}/login`, { corpo: { senha: 'errada' }, ip: '200.1.2.3' })).status, 401);
    await api('POST', `/api/cliente/${linkA}/fotos/${fotoA1.id || fotoA1.foto && fotoA1.foto.id}/aprovar`, { cliente: tokCli, corpo: { aprovada: true } });
    let ev = (await api('GET', '/api/app/atividades?projetoId=pA', { sessao: 'tokA' })).json.atividades;
    const tipos = ev.map((e) => e.tipo);
    ['cliente_login', 'cliente_abriu', 'cliente_login_falha', 'escritorio_abriu'].forEach((t) => assert.ok(tipos.includes(t), 'registrou ' + t + ' (' + tipos.join(',') + ')'));
    const abriu = ev.filter((e) => e.tipo === 'cliente_abriu').map((e) => e.ip);
    assert.strictEqual(new Set(abriu).size, abriu.length, 'vários acessos seguidos do mesmo aparelho viram uma linha só (' + abriu + ')');
    assert.ok(ev.find((e) => e.tipo === 'cliente_login').ip === '187.12.34.0' && ev.find((e) => e.tipo === 'cliente_login_falha').ip === '200.1.2.0', 'IP pela metade');
    assert.ok(!JSON.stringify(ev).includes('senha') && !JSON.stringify(ev).includes('oi'), 'nenhum conteúdo');
    const daConta = (await api('GET', '/api/app/atividades', { sessao: 'tokA' })).json.atividades.map((e) => e.tipo);
    assert.ok(daConta.includes('dashboard_login') && daConta.includes('dashboard_login_falha') && daConta.includes('dashboard_senha_trocada'), 'acessos ao dashboard na conta: ' + daConta);
    assert.deepStrictEqual((await api('GET', '/api/app/atividades?projetoId=pA', { sessao: 'tokB' })).json.atividades, [], 'a conta B não vê nada da A');
    assert.strictEqual((await api('GET', '/api/app/atividades', {})).status, 401, 'sem sessão');
    ok('login, falha, abriu (1 a cada 30 min), escritório, dashboard; IP pela metade; sem conteúdo; só o dono lê');

    console.log('== 6. Excluir a Pasta do Cliente inteira ==');
    assert.strictEqual((await api('DELETE', '/api/app/galeria/pA', { corpo: { confirmacao: 'Projeto Alfa' } })).status, 401, 'sem sessão');
    assert.strictEqual((await api('DELETE', '/api/app/galeria/pA', { sessao: 'tokB', corpo: { confirmacao: 'Projeto Alfa' } })).status, 400, 'a conta B não exclui o projeto da A');
    assert.strictEqual((await api('DELETE', '/api/app/galeria/pA', { sessao: 'tokA', corpo: { confirmacao: 'outro nome' } })).status, 400, 'confirmação errada');
    assert.strictEqual((await api('DELETE', '/api/app/galeria/pA', { sessao: 'tokA', corpo: {} })).status, 400, 'sem confirmação');
    ['pA/f1.webp', 'pA/f2.webp', 'pA/planta.png', 'pA/memorial-foto.webp', 'pA/logo-proprio.png', 'pA/desenho.png'].forEach((k) => assert.ok(existe(k), 'antes: ' + k));
    // falha ao apagar UM arquivo: nada é removido do cadastro e dá pra tentar de novo
    fs.unlinkSync(path.join(ARM, 'pA/f2.webp')); fs.mkdirSync(path.join(ARM, 'pA/f2.webp'));
    r = await api('DELETE', '/api/app/galeria/pA', { sessao: 'tokA', corpo: { confirmacao: 'projeto alfa' } });
    assert.strictEqual(r.status, 502, 'arquivo que não saiu: ' + JSON.stringify(r.json));
    assert.ok((await api('GET', '/api/app/galeria/pA', { sessao: 'tokA' })).status === 200, 'o projeto continua cadastrado');
    fs.rmdirSync(path.join(ARM, 'pA/f2.webp')); fs.writeFileSync(path.join(ARM, 'pA/f2.webp'), 'x');
    const antesBackups = (await backup.listar()).length;
    r = await api('DELETE', '/api/app/galeria/pA', { sessao: 'tokA', corpo: { confirmacao: ' PROJETO alfa ' } });
    assert.deepStrictEqual([r.status, r.json.arquivosApagados], [200, 6], JSON.stringify(r.json));
    ['pA/f1.webp', 'pA/f2.webp', 'pA/planta.png', 'pA/memorial-foto.webp', 'pA/logo-proprio.png', 'pA/desenho.png'].forEach((k) => assert.ok(!existe(k), 'apagado: ' + k));
    assert.ok(existe('pB/b1.webp'), 'os arquivos da conta B ficaram intactos');
    assert.strictEqual((await api('GET', '/api/app/galeria/pA', { sessao: 'tokA' })).status, 404, 'não existe mais');
    assert.strictEqual((await api('GET', `/api/cliente/${linkA}/galeria`, { cliente: tokCli })).status, 401, 'o login do cliente deixou de valer');
    assert.strictEqual((await api('POST', `/api/cliente/${linkA}/login`, { corpo: { usuario: 'cli', senha: 'senha1234' } })).status, 401, 'o link morreu');
    assert.strictEqual((await api('GET', `/api/cliente/${linkA}/galeria`, { cliente: aberto.token })).status, 401, 'o modo escritório também');
    const lista = (await api('GET', `/api/dashboard/${linkDash}/projetos`, { dash: tokEsc })).json.projetos.map((p) => p.projetoId);
    assert.ok(!lista.includes('pA'), 'some do dashboard');
    assert.ok((await backup.listar()).length > antesBackups && (await backup.listar()).some((b) => /antes-de-excluir/.test(b.chave)), 'backup na hora, antes de excluir');
    const contaA = (await api('GET', '/api/app/atividades', { sessao: 'tokA' })).json.atividades;
    assert.ok(contaA.some((e) => e.tipo === 'pasta_excluida' && e.detalhe === 'Projeto Alfa'), 'a exclusão fica registrada');
    assert.deepStrictEqual((await api('GET', '/api/app/atividades?projetoId=pA', { sessao: 'tokA' })).json.atividades, [], 'os registros do projeto excluído também sumiram');
    assert.strictEqual((await api('GET', '/api/app/galeria/pB', { sessao: 'tokB' })).status, 200, 'o projeto da conta B segue normal');
    ok('exige dono + nome do projeto; falha em um arquivo não remove nada; apaga fotos, planta, memorial, desenho e logo; invalida links; some do dashboard; backup antes; outra conta intacta');

    console.log('\nTODOS OS TESTES DE PRIVACIDADE E BACKUP PASSARAM');
    encerrar();
    process.exit(0);
  } catch (e) {
    console.error('FALHOU:', e);
    encerrar();
    process.exit(1);
  }
})().catch((e) => { console.error('FALHOU:', e); process.exit(1); });
