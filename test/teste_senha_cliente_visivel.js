// Senha do cliente visível pro arquiteto (dono): cópia cifrada (AES-GCM) ao lado do hash. Parte em lib pura, parte HTTP de verdade
// (server.js + licença FALSA de duas contas, porta aleatória -- nunca a 4102): a senha só sai na rota do DONO, nunca nas rotas do cliente.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-senha-cli-'));
const ok = (m) => console.log('OK  ' + m);
const portaLivre = () => new Promise((resolve, reject) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); s.on('error', reject); });

// ---------------------------------------------------------------- 1) cifra
const SR = require('../lib/senha-reversivel');
{
  const dir = fs.mkdtempSync(path.join(TMP, 'cifra-'));
  const estado = path.join(dir, 'dados.json');
  const c = SR.cifrar('Senha-do-Cliente 123 çãõ', estado, {});
  assert.ok(!c.includes('Senha-do-Cliente'), 'o texto cifrado não mostra a senha');
  assert.strictEqual(SR.decifrar(c, estado, {}), 'Senha-do-Cliente 123 çãõ', 'ida e volta (chave em arquivo)');
  assert.ok(fs.existsSync(path.join(dir, SR.ARQUIVO_CHAVE)), 'a chave ficou num arquivo ao lado dos dados');
  assert.notStrictEqual(SR.cifrar('abc', estado, {}), SR.cifrar('abc', estado, {}), 'cada cifra usa um IV novo');
  // adulterado / lixo / vazio nunca lançam: voltam null
  const partes = c.split('.'); partes[4] = partes[4].slice(0, -2) + (partes[4].slice(-2) === 'AA' ? 'BB' : 'AA');
  for (const ruim of [partes.join('.'), 'lixo', '', null, undefined, 'v1.a.x.y.z', 'v2.a.a.a.a']) assert.strictEqual(SR.decifrar(ruim, estado, {}), null, 'não decifra: ' + ruim);
  // chave do arquivo trocada = não abre
  fs.writeFileSync(path.join(dir, SR.ARQUIVO_CHAVE), 'a'.repeat(64));
  assert.strictEqual(SR.decifrar(c, estado, {}), null, 'outra chave não abre');
  // segredo compartilhado dos servidores, quando existe, é a chave ('e'); e continua abrindo se for ligado DEPOIS de já haver cifras em arquivo
  const env = { RENDERIA_SEGREDO_SERVIDORES: 'segredo-de-teste' };
  const ce = SR.cifrar('outra-senha', estado, env);
  assert.ok(ce.startsWith('v1.e.'));
  assert.strictEqual(SR.decifrar(ce, estado, env), 'outra-senha');
  assert.strictEqual(SR.decifrar(ce, estado, { RENDERIA_SEGREDO_SERVIDORES: 'outro' }), null, 'segredo diferente não abre');
  assert.strictEqual(SR.decifrar(ce, estado, {}), null, 'sem o segredo não abre (e não lança)');
  fs.writeFileSync(path.join(dir, SR.ARQUIVO_CHAVE), fs.readFileSync(path.join(dir, SR.ARQUIVO_CHAVE), 'utf8')); // arquivo existe
  const dir2 = fs.mkdtempSync(path.join(TMP, 'cifra2-'));
  const est2 = path.join(dir2, 'd.json');
  const ca = SR.cifrar('velha', est2, {});
  assert.strictEqual(SR.decifrar(ca, est2, env), 'velha', 'cifra feita com a chave em arquivo abre mesmo com o segredo ligado depois');
  ok('cifra: ida e volta, IV novo, adulterado/lixo = null, segredo e arquivo de chave');
}

// ---------------------------------------------------------------- 2) galeria
process.env.ARMAZENAMENTO_LOCAL_TESTE = '1';
process.env.ARMAZENAMENTO_LOCAL_DIR = path.join(TMP, 'arm');
const galeria = require('../lib/galeria');
{
  const arq = path.join(TMP, 'estado-galeria.json');
  galeria.criarOuAtualizarGaleria(arq, { projetoId: 'p1', licencaUsuario: 'arqA', nomeProjeto: 'Casa', clienteUsuario: 'cli', clienteSenha: 'abc12345' });
  assert.strictEqual(galeria.senhaDoClientePeloDono(arq, 'p1', 'arqA'), 'abc12345', 'o dono vê a senha criada');
  assert.throws(() => galeria.senhaDoClientePeloDono(arq, 'p1', 'arqB'), /não pertence/, 'outra conta nunca vê');
  assert.throws(() => galeria.senhaDoClientePeloDono(arq, 'nao-existe', 'arqA'));
  const bruto = fs.readFileSync(arq, 'utf8');
  assert.ok(!bruto.includes('abc12345'), 'a senha NÃO está em texto no arquivo de dados (nem no backup dele)');
  // atualizar sem senha mantém; com senha nova troca
  galeria.criarOuAtualizarGaleria(arq, { projetoId: 'p1', licencaUsuario: 'arqA', nomeProjeto: 'Casa 2', clienteUsuario: 'cli' });
  assert.strictEqual(galeria.senhaDoClientePeloDono(arq, 'p1', 'arqA'), 'abc12345', 'salvar sem senha não mexe nela');
  galeria.criarOuAtualizarGaleria(arq, { projetoId: 'p1', licencaUsuario: 'arqA', clienteSenha: 'nova-senha-9' });
  assert.strictEqual(galeria.senhaDoClientePeloDono(arq, 'p1', 'arqA'), 'nova-senha-9', 'senha nova substitui');
  const g = galeria.buscarGaleriaPorProjeto(arq, 'p1');
  assert.throws(() => galeria.loginCliente(arq, g.linkToken, 'cli', 'abc12345'), /incorretos/, 'a senha antiga deixou de valer (hash trocado junto)');
  galeria.loginCliente(arq, g.linkToken, 'cli', 'nova-senha-9');
  ok('galeria: dono vê a senha; outra conta não; arquivo de dados não tem a senha em texto; trocar/manter');

  // galeria ANTIGA (só hash): o dono não vê nada até o cliente entrar; ao entrar a cópia nasce
  const estado = galeria.lerEstado(arq);
  const antiga = estado.galerias.find((x) => x.projetoId === 'p1');
  delete antiga.clienteSenhaCifrada;
  galeria.salvarEstado(arq, estado);
  assert.strictEqual(galeria.senhaDoClientePeloDono(arq, 'p1', 'arqA'), null, 'galeria antiga: sem cópia = null (a tela explica)');
  assert.throws(() => galeria.loginCliente(arq, g.linkToken, 'cli', 'errada'), /incorretos/);
  assert.strictEqual(galeria.senhaDoClientePeloDono(arq, 'p1', 'arqA'), null, 'senha errada não cria cópia');
  galeria.loginCliente(arq, g.linkToken, 'cli', 'nova-senha-9');
  assert.strictEqual(galeria.senhaDoClientePeloDono(arq, 'p1', 'arqA'), 'nova-senha-9', 'o login certo do cliente preenche a cópia');
  ok('galeria antiga: aparece sozinha na próxima entrada do cliente');
}

// ---------------------------------------------------------------- 3) HTTP
(async () => {
  const licenca = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', (c) => { corpo += c; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      let token = null; try { token = JSON.parse(corpo).token; } catch (e) { /* vazio */ }
      const usuario = { tokA: 'arqA', tokB: 'arqB' }[token];
      res.end(JSON.stringify(usuario ? { valida: true, usuario, limiteFotos: 50, recursos: { paginaProjeto: true, orcamentos: true, memorial: true } } : { valida: false, motivo: 'Sessão inválida.' }));
    });
  });
  await new Promise((r) => licenca.listen(0, '127.0.0.1', r));
  const porta = await portaLivre();
  const filho = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: path.join(__dirname, '..'),
    env: Object.assign({}, process.env, {
      PORT: String(porta), DADOS_DIR: path.join(TMP, 'http'), ARMAZENAMENTO_LOCAL_TESTE: '1', ARMAZENAMENTO_LOCAL_DIR: path.join(TMP, 'arm-http'),
      LICENCA_SERVIDOR_URL: `http://127.0.0.1:${licenca.address().port}`
    })
  });
  let saida = '';
  filho.stdout.on('data', (d) => { saida += d; }); filho.stderr.on('data', (d) => { saida += d; });
  await new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (/rodando na porta/.test(saida)) { clearInterval(iv); resolve(); }
      else if (Date.now() - t0 > 15000) { clearInterval(iv); reject(new Error('o servidor não subiu: ' + saida)); }
    }, 100);
  });
  const BASE = `http://127.0.0.1:${porta}`;
  const api = async (metodo, caminho, cab, corpo) => {
    const r = await fetch(BASE + caminho, { method: metodo, headers: Object.assign(corpo ? { 'Content-Type': 'application/json' } : {}, cab || {}), body: corpo ? JSON.stringify(corpo) : undefined });
    let json = null; try { json = await r.json(); } catch (e) { /* sem corpo */ }
    return { status: r.status, json };
  };
  const A = { 'x-sessao-token': 'tokA' }, B = { 'x-sessao-token': 'tokB' };
  try {
    let r = await api('POST', '/api/app/galeria', A, { projetoId: 'pj1', nomeProjeto: 'Apto', clienteUsuario: 'maria', clienteSenha: 'SenhaDaMaria7' });
    assert.strictEqual(r.status, 200);
    const link = r.json.linkToken;
    r = await api('GET', '/api/app/galeria/pj1', A);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.clienteSenha, 'SenhaDaMaria7', 'o dono recebe a senha');
    assert.ok(!('clienteSenhaCifrada' in r.json) && !('clienteSenhaHash' in r.json), 'nem o hash nem a cópia cifrada saem');
    r = await api('GET', '/api/app/galeria/pj1', B);
    assert.strictEqual(r.status, 403); assert.ok(!JSON.stringify(r.json).includes('SenhaDaMaria7'), 'outra conta: 403 e nada vaza');
    assert.strictEqual((await api('GET', '/api/app/galeria/pj1')).status, 401, 'sem sessão: 401');
    // o cliente entra e a galeria que ELE recebe nunca leva senha
    r = await api('POST', `/api/cliente/${link}/login`, null, { usuario: 'maria', senha: 'SenhaDaMaria7' });
    assert.strictEqual(r.status, 200);
    const sessao = r.json.token;
    r = await api('GET', `/api/cliente/${link}/galeria`, { 'x-cliente-token': sessao });
    assert.strictEqual(r.status, 200);
    const texto = JSON.stringify(r.json);
    assert.ok(!texto.includes('SenhaDaMaria7') && !('clienteSenha' in r.json) && !texto.includes('clienteSenhaCifrada') && !texto.includes('clienteSenhaHash'), 'a página do cliente nunca recebe a senha');
    // trocar a senha pelo app: o dono passa a ver a nova
    assert.strictEqual((await api('POST', '/api/app/galeria', A, { projetoId: 'pj1', clienteSenha: 'Outra-Senha-55' })).status, 200);
    r = await api('GET', '/api/app/galeria/pj1', A);
    assert.strictEqual(r.json.clienteSenha, 'Outra-Senha-55');
    ok('HTTP: dono vê a senha; outra conta 403; sem sessão 401; a página do cliente nunca recebe senha/hash/cópia; trocar vale na hora');
  } finally { try { filho.kill(); } catch (e) { /* já foi */ } licenca.close(); }
  console.log('\nTudo certo: senha do cliente visível só pro dono.');
})().catch((e) => { console.error(e); process.exit(1); });
