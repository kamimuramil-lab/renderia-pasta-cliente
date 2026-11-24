// Dashboard online, HTTP de verdade: senha mestra, login, lista só da PRÓPRIA conta, etiquetas (arquitetos/tipo/situação),
// abrir a pasta do cliente em "modo escritório" (só leitura: aprovar/comentar recusados) e isolamento entre contas.
// Sobe o server.js com licença FALSA de duas contas, em porta livre aleatória (nunca a 4102).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-dash-'));
const ok = (m) => console.log('OK  ' + m);
const portaLivre = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  s.on('error', reject);
});

(async () => {
  const licenca = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', (c) => { corpo += c; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      let token = null; try { token = JSON.parse(corpo).token; } catch (e) { /* vazio */ }
      const u = { tokA: ['arqA', true], tokB: ['arqB', true], tokBasico: ['arqC', false] }[token];
      res.end(JSON.stringify(u ? { valida: true, usuario: u[0], limiteFotos: 50, recursos: { paginaProjeto: u[1], orcamentos: u[1], memorial: u[1] } } : { valida: false, motivo: 'Sessão inválida.' }));
    });
  });
  await new Promise((r) => licenca.listen(0, '127.0.0.1', r));
  const porta = await portaLivre();
  const filho = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: path.join(__dirname, '..'),
    env: Object.assign({}, process.env, { PORT: String(porta), DADOS_DIR: TMP, ARMAZENAMENTO_LOCAL_TESTE: '1', ARMAZENAMENTO_LOCAL_DIR: path.join(TMP, 'arm'), LICENCA_SERVIDOR_URL: `http://127.0.0.1:${licenca.address().port}` })
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
  const api = async (metodo, caminho, { sessao, cliente, dash, corpo } = {}) => {
    const opcoes = { method: metodo, headers: {} };
    if (sessao) opcoes.headers['x-sessao-token'] = sessao;
    if (cliente) opcoes.headers['x-cliente-token'] = cliente;
    if (dash) opcoes.headers['x-dashboard-token'] = dash;
    if (corpo !== undefined) { opcoes.headers['Content-Type'] = 'application/json'; opcoes.body = JSON.stringify(corpo); }
    const r = await fetch(BASE + caminho, opcoes);
    let json = null; try { json = await r.json(); } catch (e) { /* sem corpo */ }
    return { status: r.status, json };
  };

  try {
    // galerias: A tem 2 projetos, B tem 1
    const criar = (sessao, projetoId, nome, extra) => api('POST', '/api/app/galeria', { sessao, corpo: { projetoId, nomeProjeto: nome, clienteUsuario: 'cli', clienteSenha: 'senha1234', ...extra } });
    let r = await criar('tokA', 'pA1', 'APA DGT'); const linkA1 = r.json.linkToken;
    await criar('tokA', 'pA2', 'APA AM2');
    await criar('tokB', 'pB1', 'CASA DA OUTRA');
    // dados do projeto com "Projeto de Interiores" (o tipo sai dali quando não há etiqueta)
    await api('PUT', '/api/app/galeria/pA1/hub', { sessao: 'tokA', corpo: { dadosProjeto: 'Nome do Cliente: Fulano\nProjeto de Interiores 96m²' } });

    console.log('== 1. Senha mestra: só quem tem o recurso; mínimo 6; link próprio ==');
    assert.strictEqual((await api('GET', '/api/app/dashboard')).status, 401, 'sem sessão');
    assert.strictEqual((await api('PUT', '/api/app/dashboard/senha', { sessao: 'tokBasico', corpo: { senha: 'mestra123' } })).status, 403, 'licença Básica não tem');
    r = await api('GET', '/api/app/dashboard', { sessao: 'tokA' });
    assert.deepStrictEqual([r.status, r.json.temSenha, r.json.linkToken], [200, false, null]);
    assert.strictEqual((await api('PUT', '/api/app/dashboard/senha', { sessao: 'tokA', corpo: { senha: '123' } })).status, 400, 'senha curta');
    r = await api('PUT', '/api/app/dashboard/senha', { sessao: 'tokA', corpo: { senha: 'mestra123' } });
    assert.strictEqual(r.status, 200);
    const linkDashA = r.json.linkToken;
    assert.ok(/^[0-9a-f]{32}$/.test(linkDashA));
    r = await api('PUT', '/api/app/dashboard/senha', { sessao: 'tokB', corpo: { senha: 'outrasenha' } });
    const linkDashB = r.json.linkToken;
    assert.notStrictEqual(linkDashA, linkDashB, 'cada conta tem o seu link');
    ok('senha mestra: recurso exigido, mínimo de 6, link próprio por conta');

    console.log('== 2. Login do dashboard ==');
    assert.strictEqual((await api('GET', `/api/dashboard/${linkDashA}/info-publica`)).status, 200);
    assert.strictEqual((await api('GET', '/api/dashboard/linkinexistente/info-publica')).status, 404);
    assert.strictEqual((await api('POST', `/api/dashboard/${linkDashA}/login`, { corpo: { senha: 'errada' } })).status, 401);
    assert.strictEqual((await api('POST', `/api/dashboard/${linkDashA}/login`, { corpo: { senha: 'outrasenha' } })).status, 401, 'a senha da conta B não abre a A');
    assert.strictEqual((await api('GET', `/api/dashboard/${linkDashA}/projetos`)).status, 401, 'sem token');
    assert.strictEqual((await api('GET', `/api/dashboard/${linkDashA}/projetos`, { dash: 'inventado' })).status, 401);
    assert.strictEqual((await api('GET', `/api/dashboard/${linkDashA}/projetos`, { sessao: 'tokA' })).status, 401, 'sessão do app não abre o dashboard');
    const tokA = (await api('POST', `/api/dashboard/${linkDashA}/login`, { corpo: { senha: 'mestra123' } })).json.token;
    const tokB = (await api('POST', `/api/dashboard/${linkDashB}/login`, { corpo: { senha: 'outrasenha' } })).json.token;
    assert.ok(tokA && tokB);
    assert.strictEqual((await api('GET', `/api/dashboard/${linkDashA}/projetos`, { dash: tokB })).status, 401, 'token da conta B no link da A');
    ok('login: senha certa entra; senha errada, token inventado, token de outra conta e sessão do app são recusados');

    console.log('== 3. Lista: só os projetos da PRÓPRIA conta; tipo vem do texto quando não há etiqueta ==');
    r = await api('GET', `/api/dashboard/${linkDashA}/projetos`, { dash: tokA });
    assert.deepStrictEqual(r.json.projetos.map((p) => p.nome), ['APA AM2', 'APA DGT']);
    const dgt = r.json.projetos.find((p) => p.projetoId === 'pA1');
    assert.deepStrictEqual(dgt.meta, { arquitetos: [], tipo: 'Interiores', situacao: 'andamento' });
    assert.ok(!JSON.stringify(r.json).includes('senhaHash') && !JSON.stringify(r.json).includes('sessoes'), 'nada de hash/sessão');
    r = await api('GET', `/api/dashboard/${linkDashB}/projetos`, { dash: tokB });
    assert.deepStrictEqual(r.json.projetos.map((p) => p.nome), ['CASA DA OUTRA']);
    ok('cada conta vê só os seus; tipo inferido de "Projeto de Interiores"');

    console.log('== 4. Etiquetas: pelo app e pelo dashboard, validadas, com posse ==');
    r = await api('PUT', '/api/app/galeria/pA1/meta', { sessao: 'tokA', corpo: { arquitetos: ['Adrielle S.', ' adrielle s. ', 'Rodrigo K.'], tipo: 'Arquitetura', situacao: 'concluido' } });
    assert.deepStrictEqual(r.json.meta, { arquitetos: ['Adrielle S.', 'Rodrigo K.'], tipo: 'Arquitetura', situacao: 'concluido' });
    r = await api('PUT', `/api/dashboard/${linkDashA}/projetos/pA2/meta`, { dash: tokA, corpo: { arquitetos: ['Nicole F.'], situacao: 'andamento' } });
    assert.deepStrictEqual(r.json.meta.arquitetos, ['Nicole F.']);
    assert.strictEqual((await api('PUT', `/api/dashboard/${linkDashA}/projetos/pA2/meta`, { dash: tokA, corpo: { tipo: 'Paisagismo' } })).status, 400);
    assert.strictEqual((await api('PUT', `/api/dashboard/${linkDashA}/projetos/pA2/meta`, { dash: tokA, corpo: { situacao: 'x' } })).status, 400);
    assert.strictEqual((await api('PUT', `/api/dashboard/${linkDashA}/projetos/pA2/meta`, { dash: tokA, corpo: { arquitetos: 'x' } })).status, 400);
    r = await api('GET', `/api/dashboard/${linkDashA}/projetos`, { dash: tokA });
    assert.deepStrictEqual(r.json.projetos.find((p) => p.projetoId === 'pA2').meta, { arquitetos: ['Nicole F.'], tipo: '', situacao: 'andamento' }, 'recusa não gravou nada');
    // posse: B não mexe no projeto de A, nem pelo app nem pelo dashboard
    assert.strictEqual((await api('PUT', '/api/app/galeria/pA1/meta', { sessao: 'tokB', corpo: { situacao: 'concluido' } })).status, 400);
    assert.strictEqual((await api('PUT', `/api/dashboard/${linkDashB}/projetos/pA1/meta`, { dash: tokB, corpo: { situacao: 'andamento' } })).status, 400);
    assert.strictEqual((await api('POST', `/api/dashboard/${linkDashB}/projetos/pA1/abrir`, { dash: tokB })).status, 400, 'B não abre a pasta de A');
    assert.strictEqual((await api('GET', `/api/dashboard/${linkDashA}/projetos`, { dash: tokA })).json.projetos.find((p) => p.projetoId === 'pA1').meta.situacao, 'concluido', 'nada mudou');
    // app: lista de etiquetas
    r = await api('GET', '/api/app/dashboard/projetos', { sessao: 'tokA' });
    assert.deepStrictEqual(r.json.projetos.map((p) => p.projetoId).sort(), ['pA1', 'pA2']);
    // o CLIENTE nunca recebe as etiquetas
    const tokCli = (await api('POST', `/api/cliente/${linkA1}/login`, { corpo: { usuario: 'cli', senha: 'senha1234' } })).json.token;
    r = await api('GET', `/api/cliente/${linkA1}/galeria`, { cliente: tokCli });
    assert.ok(!('meta' in r.json) && !('modoEscritorio' in r.json), 'cliente de verdade: sem etiquetas e sem modo escritório');
    ok('etiquetas gravadas pelo app e pelo dashboard; valores inválidos recusados sem gravar; outra conta barrada; cliente não vê');

    console.log('== 5. Abrir a pasta do cliente em modo escritório: só leitura ==');
    r = await api('POST', `/api/dashboard/${linkDashA}/projetos/pA1/abrir`, { dash: tokA });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.linkToken, linkA1);
    const tokEsc = r.json.token;
    r = await api('GET', `/api/cliente/${linkA1}/galeria`, { cliente: tokEsc });
    assert.deepStrictEqual([r.status, r.json.modoEscritorio, 'meta' in r.json], [200, true, false]);
    assert.strictEqual((await api('POST', `/api/cliente/${linkA1}/fotos/qualquer/aprovar`, { cliente: tokEsc, corpo: { aprovada: true } })).status, 403, 'aprovar recusado');
    assert.strictEqual((await api('POST', `/api/cliente/${linkA1}/fotos/qualquer/comentar`, { cliente: tokEsc, corpo: { texto: 'oi' } })).status, 403, 'comentar recusado');
    // o token de escritório não abre OUTRA galeria
    const linkA2 = (await api('GET', '/api/app/galeria/pA2', { sessao: 'tokA' })).json.linkToken;
    assert.strictEqual((await api('GET', `/api/cliente/${linkA2}/galeria`, { cliente: tokEsc })).status, 401);
    // o cliente de verdade continua aprovando/comentando normalmente (a rota segue igual; a foto não existe -> 400, não 403)
    assert.strictEqual((await api('POST', `/api/cliente/${linkA1}/fotos/qualquer/aprovar`, { cliente: tokCli, corpo: { aprovada: true } })).status, 400);
    ok('modo escritório: vê, mas aprovar e comentar dão 403; não abre outra galeria; cliente de verdade não mudou');

    console.log('== 6. Trocar a senha mestra derruba as sessões; sair encerra ==');
    assert.strictEqual((await api('POST', `/api/dashboard/${linkDashA}/sair`, { dash: tokA })).status, 200);
    assert.strictEqual((await api('GET', `/api/dashboard/${linkDashA}/projetos`, { dash: tokA })).status, 401, 'sair encerrou');
    const tokA2 = (await api('POST', `/api/dashboard/${linkDashA}/login`, { corpo: { senha: 'mestra123' } })).json.token;
    await api('PUT', '/api/app/dashboard/senha', { sessao: 'tokA', corpo: { senha: 'novasenha9' } });
    assert.strictEqual((await api('GET', `/api/dashboard/${linkDashA}/projetos`, { dash: tokA2 })).status, 401, 'senha trocada derruba as sessões');
    assert.strictEqual((await api('POST', `/api/dashboard/${linkDashA}/login`, { corpo: { senha: 'mestra123' } })).status, 401);
    assert.strictEqual((await api('POST', `/api/dashboard/${linkDashA}/login`, { corpo: { senha: 'novasenha9' } })).status, 200);
    assert.strictEqual((await api('GET', '/api/app/dashboard', { sessao: 'tokA' })).json.linkToken, linkDashA, 'o link não muda ao trocar a senha');
    ok('sair e trocar a senha encerram sessões; o link continua o mesmo');

    console.log('== 7. A página /dashboard ==');
    const pagina = await fetch(`${BASE}/dashboard?c=${linkDashA}`);
    const html = await pagina.text();
    assert.ok(pagina.status === 200 && /noindex/.test(html) && /assets\/js\/dashboard\.js\?v=\d+/.test(html), 'página com JS versionado e noindex');
    ok('página /dashboard servida (sem dados: eles só vêm depois da senha)');

    console.log('== 8. Nome do escritório (perfil da conta): vai para a galeria do cliente, validado, por conta ==');
    assert.strictEqual((await api('PUT', '/api/app/perfil/nome', { corpo: { nome: 'X' } })).status, 401, 'sem sessão');
    r = await api('PUT', '/api/app/perfil/nome', { sessao: 'tokA', corpo: { nome: '  Rodrigo   Kamimura  Arquitetura ' } });
    assert.deepStrictEqual([r.status, r.json.nomeEscritorio], [200, 'Rodrigo Kamimura Arquitetura'], 'espaços arrumados');
    assert.strictEqual((await api('PUT', '/api/app/perfil/nome', { sessao: 'tokA', corpo: { nome: 'x'.repeat(81) } })).status, 400, 'limite de 80');
    assert.strictEqual((await api('PUT', '/api/app/perfil/nome', { sessao: 'tokA', corpo: { nome: 123 } })).status, 400);
    const tokCli2 = (await api('POST', `/api/cliente/${linkA1}/login`, { corpo: { usuario: 'cli', senha: 'senha1234' } })).json.token;
    assert.strictEqual((await api('GET', `/api/cliente/${linkA1}/galeria`, { cliente: tokCli2 })).json.nomeEscritorio, 'Rodrigo Kamimura Arquitetura', 'o cliente recebe o nome para o PDF');
    const linkB1 = (await api('GET', '/api/app/galeria/pB1', { sessao: 'tokB' })).json.linkToken;
    const tokCliB = (await api('POST', `/api/cliente/${linkB1}/login`, { corpo: { usuario: 'cli', senha: 'senha1234' } })).json.token;
    assert.strictEqual((await api('GET', `/api/cliente/${linkB1}/galeria`, { cliente: tokCliB })).json.nomeEscritorio, '', 'a conta B não herda o nome da A');
    await api('PUT', '/api/app/perfil/nome', { sessao: 'tokA', corpo: { nome: '' } });
    assert.strictEqual((await api('GET', `/api/cliente/${linkA1}/galeria`, { cliente: tokCli2 })).json.nomeEscritorio, '', 'vazio = sem "Projeto por"');
    ok('nome do escritório: validado, por conta, chega ao cliente');

    console.log('== 9. Contatos do escritório (WhatsApp, e-mail, Instagram): normalizados, por conta, chegam ao cliente ==');
    r = await api('PUT', '/api/app/perfil/nome', { sessao: 'tokA', corpo: { nome: 'Escritório A', whatsapp: '(11) 91234-5678', email: '  Contato@Escritorio.COM ', instagram: 'https://www.instagram.com/escritorio.a/?hl=pt' } });
    assert.deepStrictEqual([r.status, r.json.contatos], [200, { whatsapp: '5511912345678', email: 'contato@escritorio.com', instagram: 'escritorio.a' }], 'WhatsApp com o 55, e-mail minúsculo, Instagram só o @');
    // o perfil da conta (que o app lê quando o login entra num computador com esses campos em branco) devolve nome e contatos
    const perfilA = await api('GET', '/api/app/perfil', { sessao: 'tokA' });
    assert.deepStrictEqual([perfilA.status, perfilA.json.nomeEscritorio, perfilA.json.contatosEscritorio], [200, 'Escritório A', { whatsapp: '5511912345678', email: 'contato@escritorio.com', instagram: 'escritorio.a' }], 'GET /api/app/perfil traz nome e contatos da conta');
    assert.strictEqual((await api('GET', '/api/app/perfil', { sessao: 'tokB' })).json.nomeEscritorio, '', 'a conta B não vê os dados da A');
    // "O mais recente vale": o servidor carimba a hora só quando algo MUDA (reenviar o mesmo valor não conta)
    const horaA1 = perfilA.json.escritorioAtualizadoEm;
    assert.ok(String(horaA1).startsWith('20') && horaA1.includes('T'),'o perfil traz a hora da última mudança');
    await api('PUT', '/api/app/perfil/nome', { sessao: 'tokA', corpo: { nome: 'Escritório A', whatsapp: '(11) 91234-5678' } });
    assert.strictEqual((await api('GET', '/api/app/perfil', { sessao: 'tokA' })).json.escritorioAtualizadoEm, horaA1, 'mesmo valor não muda a hora');
    await new Promise((r) => setTimeout(r, 15));
    r = await api('PUT', '/api/app/perfil/nome', { sessao: 'tokA', corpo: { whatsapp: '(11) 90000-1111' } });
    const horaA2 = (await api('GET', '/api/app/perfil', { sessao: 'tokA' })).json.escritorioAtualizadoEm;
    assert.ok(horaA2 > horaA1 && r.json.atualizadoEm === horaA2, 'mudou o telefone: hora nova (a resposta do PUT traz a mesma hora)');
    assert.strictEqual((await api('GET', '/api/app/perfil', { sessao: 'tokB' })).json.escritorioAtualizadoEm, '', 'a hora é por conta');
    await api('PUT', '/api/app/perfil/nome', { sessao: 'tokA', corpo: { whatsapp: '(11) 91234-5678' } }); // volta ao valor original para o resto do teste
    r = await api('GET', `/api/cliente/${linkA1}/galeria`, { cliente: tokCli2 });
    assert.deepStrictEqual(r.json.contatosEscritorio, { whatsapp: '5511912345678', email: 'contato@escritorio.com', instagram: 'escritorio.a' }, 'o cliente recebe os contatos');
    // app antigo (só manda o nome) NÃO apaga os contatos
    await api('PUT', '/api/app/perfil/nome', { sessao: 'tokA', corpo: { nome: 'Escritório A2' } });
    r = await api('GET', `/api/cliente/${linkA1}/galeria`, { cliente: tokCli2 });
    assert.strictEqual(r.json.nomeEscritorio, 'Escritório A2');
    assert.strictEqual(r.json.contatosEscritorio.whatsapp, '5511912345678', 'chamada só com o nome mantém os contatos');
    // "@perfil" e "+55 11..." também valem; lixo é recusado SEM gravar nada
    r = await api('PUT', '/api/app/perfil/nome', { sessao: 'tokA', corpo: { instagram: '@meu_perfil', whatsapp: '+55 (21) 98888-7777' } });
    assert.deepStrictEqual([r.json.contatos.instagram, r.json.contatos.whatsapp], ['meu_perfil', '5521988887777']);
    for (const ruim of [{ whatsapp: '123' }, { whatsapp: 'abc' }, { email: 'sem-arroba' }, { instagram: 'tem espaço' }, { instagram: 'a'.repeat(31) }, { email: 5 }]) {
      assert.strictEqual((await api('PUT', '/api/app/perfil/nome', { sessao: 'tokA', corpo: Object.assign({ nome: 'Nome que não pode gravar' }, ruim) })).status, 400, JSON.stringify(ruim));
    }
    r = await api('GET', `/api/cliente/${linkA1}/galeria`, { cliente: tokCli2 });
    assert.strictEqual(r.json.nomeEscritorio, 'Escritório A2', 'recusa não gravou nem o nome');
    assert.strictEqual(r.json.contatosEscritorio.instagram, 'meu_perfil');
    assert.deepStrictEqual((await api('GET', `/api/cliente/${linkB1}/galeria`, { cliente: tokCliB })).json.contatosEscritorio, { whatsapp: '', email: '', instagram: '' }, 'a conta B não herda os contatos da A');
    // vazio apaga
    r = await api('PUT', '/api/app/perfil/nome', { sessao: 'tokA', corpo: { whatsapp: '', email: '', instagram: '' } });
    assert.deepStrictEqual(r.json.contatos, { whatsapp: '', email: '', instagram: '' });
    ok('contatos: normalizados, validados sem gravar pela metade, preservados pelo app antigo, por conta');

    console.log('== 10. Listas da conta: arquitetos ficam registrados; tipos e situações novos; remover só o que ninguém usa ==');
    const tokD = (await api('POST', `/api/dashboard/${linkDashA}/login`, { corpo: { senha: 'novasenha9' } })).json.token;
    r = await api('GET', `/api/dashboard/${linkDashA}/projetos`, { dash: tokD });
    const nomesDe = (lista) => lista.map((x) => x.nome);
    assert.deepStrictEqual(nomesDe(r.json.catalogo.tipos), ['Interiores', 'Arquitetura'], 'tipos padrão');
    assert.deepStrictEqual(r.json.catalogo.situacoes.map((s) => s.id), ['andamento', 'concluido'], 'situações padrão');
    assert.ok(r.json.catalogo.arquitetos.some((a) => a.nome === 'Adrielle S.' && a.usos === 1), 'quem já está num projeto já aparece, com a contagem de uso');
    // arquiteto novo cadastrado direto (sem projeto) fica registrado
    r = await api('POST', `/api/dashboard/${linkDashA}/catalogo`, { dash: tokD, corpo: { lista: 'arquitetos', nome: '  Beatriz   L. ' } });
    assert.deepStrictEqual([r.status, r.json.adicionado, r.json.nome], [200, true, 'Beatriz L.']);
    r = await api('POST', `/api/dashboard/${linkDashA}/catalogo`, { dash: tokD, corpo: { lista: 'arquitetos', nome: 'beatriz l.' } });
    assert.strictEqual(r.json.adicionado, false, 'mesma pessoa com outra caixa de letras não duplica');
    assert.strictEqual(r.json.catalogo.arquitetos.filter((a) => a.nome.toLowerCase() === 'beatriz l.').length, 1);
    // ao salvar um projeto com nome novo, ele passa a ficar registrado MESMO depois de sair do projeto
    await api('PUT', `/api/dashboard/${linkDashA}/projetos/pA2/meta`, { dash: tokD, corpo: { arquitetos: ['Carla Z.'] } });
    await api('PUT', `/api/dashboard/${linkDashA}/projetos/pA2/meta`, { dash: tokD, corpo: { arquitetos: [] } });
    r = await api('GET', `/api/app/dashboard/projetos`, { sessao: 'tokA' });
    assert.ok(r.json.catalogo.arquitetos.some((a) => a.nome === 'Carla Z.' && a.usos === 0), 'o nome continua na lista (usos 0) depois de tirado do projeto');
    // o nome escrito com outra caixa de letras usa a escrita já cadastrada
    r = await api('PUT', `/api/dashboard/${linkDashA}/projetos/pA2/meta`, { dash: tokD, corpo: { arquitetos: ['carla z.'] } });
    assert.deepStrictEqual(r.json.meta.arquitetos, ['Carla Z.']);
    // tipo e situação novos
    assert.strictEqual((await api('PUT', `/api/dashboard/${linkDashA}/projetos/pA2/meta`, { dash: tokD, corpo: { tipo: 'Paisagismo' } })).status, 400, 'tipo que não existe na lista ainda é recusado');
    r = await api('POST', `/api/dashboard/${linkDashA}/catalogo`, { dash: tokD, corpo: { lista: 'tipos', nome: 'Paisagismo' } });
    assert.strictEqual(r.json.adicionado, true);
    r = await api('POST', `/api/app/dashboard/catalogo`, { sessao: 'tokA', corpo: { lista: 'situacoes', nome: 'Aguardando cliente' } });
    const idSit = r.json.id;
    assert.ok(/^sit_[0-9a-f]{6}$/.test(idSit), 'id novo para a situação');
    r = await api('PUT', `/api/dashboard/${linkDashA}/projetos/pA2/meta`, { dash: tokD, corpo: { tipo: 'paisagismo', situacao: idSit } });
    assert.deepStrictEqual([r.status, r.json.meta.tipo, r.json.meta.situacao], [200, 'Paisagismo', idSit]);
    r = await api('GET', `/api/dashboard/${linkDashA}/projetos`, { dash: tokD });
    assert.strictEqual(r.json.projetos.find((p) => p.projetoId === 'pA2').meta.situacao, idSit);
    assert.deepStrictEqual(r.json.catalogo.situacoes.find((s) => s.id === idSit), { id: idSit, nome: 'Aguardando cliente', padrao: false, usos: 1 });
    assert.strictEqual((await api('PUT', `/api/dashboard/${linkDashA}/projetos/pA2/meta`, { dash: tokD, corpo: { situacao: 'sit_ffffff' } })).status, 400, 'situação inventada');
    // remover: item em uso e itens padrão não saem; item sem uso sai
    assert.strictEqual((await api('POST', `/api/dashboard/${linkDashA}/catalogo/remover`, { dash: tokD, corpo: { lista: 'situacoes', chave: idSit } })).status, 400, 'em uso');
    assert.strictEqual((await api('POST', `/api/dashboard/${linkDashA}/catalogo/remover`, { dash: tokD, corpo: { lista: 'tipos', chave: 'Paisagismo' } })).status, 400, 'em uso');
    assert.strictEqual((await api('POST', `/api/dashboard/${linkDashA}/catalogo/remover`, { dash: tokD, corpo: { lista: 'tipos', chave: 'Interiores' } })).status, 400, 'padrão');
    assert.strictEqual((await api('POST', `/api/dashboard/${linkDashA}/catalogo/remover`, { dash: tokD, corpo: { lista: 'situacoes', chave: 'andamento' } })).status, 400, 'padrão');
    r = await api('POST', `/api/dashboard/${linkDashA}/catalogo/remover`, { dash: tokD, corpo: { lista: 'arquitetos', chave: 'Beatriz L.' } });
    assert.strictEqual(r.status, 200);
    assert.ok(!r.json.catalogo.arquitetos.some((a) => a.nome === 'Beatriz L.'), 'sem uso: sai da lista');
    // voltar o projeto para a situação padrão libera a remoção da situação nova
    await api('PUT', `/api/dashboard/${linkDashA}/projetos/pA2/meta`, { dash: tokD, corpo: { tipo: '', situacao: 'andamento' } });
    assert.strictEqual((await api('POST', `/api/dashboard/${linkDashA}/catalogo/remover`, { dash: tokD, corpo: { lista: 'situacoes', chave: idSit } })).status, 200);
    assert.strictEqual((await api('POST', `/api/dashboard/${linkDashA}/catalogo/remover`, { dash: tokD, corpo: { lista: 'tipos', chave: 'Paisagismo' } })).status, 200);
    // validações e isolamento
    assert.strictEqual((await api('POST', `/api/dashboard/${linkDashA}/catalogo`, { dash: tokD, corpo: { lista: 'outra', nome: 'x' } })).status, 400, 'lista inválida');
    assert.strictEqual((await api('POST', `/api/dashboard/${linkDashA}/catalogo`, { dash: tokD, corpo: { lista: 'tipos', nome: '   ' } })).status, 400, 'nome vazio');
    assert.strictEqual((await api('POST', `/api/dashboard/${linkDashA}/catalogo`, { dash: tokD, corpo: { lista: 'tipos', nome: 'x'.repeat(41) } })).status, 400, 'nome longo');
    assert.strictEqual((await api('POST', `/api/dashboard/${linkDashA}/catalogo`, { corpo: { lista: 'tipos', nome: 'Sem sessão' } })).status, 401, 'sem login do dashboard');
    assert.strictEqual((await api('POST', '/api/app/dashboard/catalogo', { sessao: 'tokBasico', corpo: { lista: 'tipos', nome: 'Sem recurso' } })).status, 403, 'licença sem o recurso');
    r = await api('GET', `/api/dashboard/${linkDashB}/projetos`, { dash: tokB });
    assert.ok(!r.json.catalogo.arquitetos.some((a) => a.nome === 'Carla Z.' || a.nome === 'Adrielle S.'), 'a conta B não vê os nomes da A');
    assert.deepStrictEqual(nomesDe(r.json.catalogo.tipos), ['Interiores', 'Arquitetura']);
    ok('listas: arquitetos registrados, tipos/situações novos, remoção só do que não está em uso, isolamento entre contas');

    console.log('\nTODOS OS TESTES DO DASHBOARD PASSARAM');
    encerrar();
  } catch (e) {
    console.error('FALHOU:', e);
    encerrar();
    process.exit(1);
  }
})();
