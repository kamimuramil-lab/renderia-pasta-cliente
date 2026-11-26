const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const galeria = require('../lib/galeria');
const orc = require('../lib/orcamentos');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-orcamentos-'));
const CAMINHO = path.join(TMP, 'dados-galerias.json');
const DONO = 'arq@teste.com';
const INTRUSO = 'outro@teste.com';
const URL1 = 'https://drive.google.com/file/d/AAA/view?usp=sharing';

const g0 = galeria.criarOuAtualizarGaleria(CAMINHO, { projetoId: 'projO', licencaUsuario: DONO, nomeProjeto: 'Apartamento', clienteUsuario: 'cliente', clienteSenha: 'senha1234' });
const lerO = () => galeria.buscarGaleriaPorProjeto(CAMINHO, 'projO').orcamentos;

console.log('== 1. Galeria nova nasce sem orçamentos; galeria ANTIGA (sem o campo) também ganha ==');
const o0 = lerO();
assert.deepStrictEqual([o0.acesso, o0.itens, o0.notificacoes, o0.temNovidadeNaoLida], [null, [], [], false]);
assert.deepStrictEqual(o0.categorias.map((c) => c.nome), orc.ITENS_PADRAO, 'projeto novo já vem com as categorias padrão (vazias)');
const antigo = JSON.parse(fs.readFileSync(CAMINHO, 'utf8'));
delete antigo.galerias[0].orcamentos;
fs.writeFileSync(CAMINHO, JSON.stringify(antigo));
assert.deepStrictEqual(lerO().itens, []);
console.log('OK');

console.log('== 2. Acesso (login/senha PRÓPRIOS): criação, token diferente da Pasta Cliente, atualização, sem vazar hash ==');
assert.throws(() => orc.definirAcesso(CAMINHO, 'projO', { usuario: '', senha: 'abcd' }, DONO), /primeira vez/);
assert.throws(() => orc.definirAcesso(CAMINHO, 'projO', { usuario: 'orc', senha: 'abc' }, DONO), /4 caracteres/);
assert.strictEqual(lerO().acesso, null, 'tentativa inválida não cria nada');
const acesso = orc.definirAcesso(CAMINHO, 'projO', { usuario: '  orc-cliente ', senha: 'senha-orc' }, DONO);
assert.strictEqual(acesso.usuario, 'orc-cliente');
assert.ok(/^[0-9a-f]{32}$/.test(acesso.linkToken) && acesso.linkToken !== g0.linkToken, 'link do orçamento é outro, e diferente do da Pasta Cliente');
const lido = orc.lerParaArquiteto(CAMINHO, 'projO', DONO);
assert.deepStrictEqual(lido.acesso, { linkToken: acesso.linkToken, usuario: 'orc-cliente', senha: 'senha-orc' }); // o DONO vê a senha atual (cópia cifrada)
assert.ok(!JSON.stringify(lido).includes('senhaHash') && !JSON.stringify(lido).includes('sessoesAtivas'), 'o app nunca recebe hash nem sessões');
const tokSessao = orc.loginCliente(CAMINHO, acesso.linkToken, 'orc-cliente', 'senha-orc');
assert.ok(orc.validarTokenCliente(CAMINHO, acesso.linkToken, tokSessao));
orc.definirAcesso(CAMINHO, 'projO', { usuario: 'orc-cliente' }, DONO); // sem senha: mantém a atual e as sessões
assert.ok(orc.validarTokenCliente(CAMINHO, acesso.linkToken, tokSessao));
const acesso2 = orc.definirAcesso(CAMINHO, 'projO', { usuario: 'novo-login', senha: 'outra-senha' }, DONO);
assert.strictEqual(acesso2.linkToken, acesso.linkToken, 'o link não muda ao trocar o login');
assert.ok(!orc.validarTokenCliente(CAMINHO, acesso.linkToken, tokSessao), 'trocar a senha derruba as sessões');
assert.throws(() => orc.loginCliente(CAMINHO, acesso.linkToken, 'orc-cliente', 'senha-orc'), /incorretos/);
console.log('OK');

console.log('== 3. Item novo: validações e valores ==');
let i = orc.adicionarItem(CAMINHO, 'projO', { item: 'Mármore da bancada', empresa: 'Mármores SA', representante: 'João', telefone: '(11) 99999-0000', valor: '1500,50', url: URL1, observacao: 'frete incluso' }, DONO);
assert.deepStrictEqual([i.status, i.valor, i.comentarios.length], ['a_fazer', 1500.5, 0]);
assert.ok(i.id.startsWith('orc_'));
assert.strictEqual(orc.adicionarItem(CAMINHO, 'projO', { item: 'Sem valor nem link' }, DONO).valor, null);
assert.strictEqual(orc.adicionarItem(CAMINHO, 'projO', { item: 'Arredonda', valor: 1500.456 }, DONO).valor, 1500.46);
assert.throws(() => orc.adicionarItem(CAMINHO, 'projO', { item: '' }, DONO), /nome/);
assert.throws(() => orc.adicionarItem(CAMINHO, 'projO', { item: 'x', valor: -1 }, DONO), /Valor/);
assert.throws(() => orc.adicionarItem(CAMINHO, 'projO', { item: 'x', valor: 'abc' }, DONO), /Valor/);
assert.throws(() => orc.adicionarItem(CAMINHO, 'projO', { item: 'x', url: 'javascript:alert(1)' }, DONO), /inválido/);
assert.throws(() => orc.adicionarItem(CAMINHO, 'projO', { item: 'x', status: 'qualquer' }, DONO), /Status/);
assert.strictEqual(lerO().itens.length, 3, 'nenhuma tentativa inválida criou item');
console.log('OK');

console.log('== 4. Editar: valida tudo antes de aplicar; o arquiteto escolhe qualquer status ==');
i = orc.editarItem(CAMINHO, 'projO', i.id, { status: 'em_andamento', observacao: '  frete incluso, prazo 10 dias ' }, DONO);
assert.deepStrictEqual([i.status, i.observacao], ['em_andamento', 'frete incluso, prazo 10 dias']);
assert.throws(() => orc.editarItem(CAMINHO, 'projO', i.id, { empresa: 'Mudou', valor: 'lixo' }, DONO), /Valor/);
assert.strictEqual(lerO().itens.find((x) => x.id === i.id).empresa, 'Mármores SA', 'edição inválida não aplica NADA');
assert.throws(() => orc.editarItem(CAMINHO, 'projO', 'orc_inexistente', { item: 'x' }, DONO), /não encontrado/);
console.log('OK');

console.log('== 5. Cliente: login, token próprio, e a Pasta Cliente NÃO abre os orçamentos (nem o contrário) ==');
assert.throws(() => orc.loginCliente(CAMINHO, acesso.linkToken, 'novo-login', 'errada'), /incorretos/);
assert.throws(() => orc.loginCliente(CAMINHO, 'token-que-nao-existe', 'novo-login', 'outra-senha'), /não encontrado/);
assert.throws(() => orc.loginCliente(CAMINHO, g0.linkToken, 'cliente', 'senha1234'), /não encontrado/, 'o link da Pasta Cliente não serve de link de orçamentos');
const tokOrc = orc.loginCliente(CAMINHO, acesso.linkToken, 'novo-login', 'outra-senha');
const tokGaleria = galeria.loginCliente(CAMINHO, g0.linkToken, 'cliente', 'senha1234');
assert.ok(orc.validarTokenCliente(CAMINHO, acesso.linkToken, tokOrc));
assert.ok(!orc.validarTokenCliente(CAMINHO, acesso.linkToken, tokGaleria), 'sessão da Pasta Cliente não abre orçamentos');
assert.ok(!galeria.validarTokenCliente(CAMINHO, g0.linkToken, tokOrc), 'sessão de orçamentos não abre a Pasta Cliente');
assert.ok(!orc.validarTokenCliente(CAMINHO, acesso.linkToken, ''));
console.log('OK');

console.log('== 6. O que o cliente vê (sem segredos) e quais orçamentos ele pode mexer ==');
const vistaCliente = orc.listarParaCliente(CAMINHO, acesso.linkToken);
const textoVista = JSON.stringify(vistaCliente);
for (const proibido of ['senhaHash', 'sessoesAtivas', 'notificacoes', 'temNovidadeNaoLida', 'criadoEm":"20']) assert.ok(!textoVista.includes(proibido) || proibido.startsWith('criadoEm'), 'vazou: ' + proibido);
assert.deepStrictEqual(vistaCliente.statusQueClienteEscolhe, ['analise_cliente', 'fechado', 'recusado']);
assert.deepStrictEqual(vistaCliente.itens.map((x) => [x.item, x.podeMudarStatus]), [['Mármore da bancada', true], ['Arredonda', false]]); // item À fazer intocado (sem valor, link, empresa...) fica escondido do cliente
console.log('OK');

console.log('== 7. Mudar status pelo cliente: só 3 opções, só em orçamento já liberado, com NOVIDADE pro arquiteto ==');
const idMarmore = i.id;
const idPreparando = vistaCliente.itens[1].id;
assert.throws(() => orc.mudarStatusCliente(CAMINHO, acesso.linkToken, idPreparando, 'fechado'), /preparado pelo escritório/);
assert.throws(() => orc.mudarStatusCliente(CAMINHO, acesso.linkToken, idMarmore, 'a_fazer'), /não pode ser escolhido/);
assert.throws(() => orc.mudarStatusCliente(CAMINHO, acesso.linkToken, idMarmore, 'em_andamento'), /não pode ser escolhido/);
assert.throws(() => orc.mudarStatusCliente(CAMINHO, acesso.linkToken, 'orc_inexistente', 'fechado'), /não encontrado/);
assert.strictEqual(lerO().temNovidadeNaoLida, false, 'tentativas recusadas não geram novidade');
let r = orc.mudarStatusCliente(CAMINHO, acesso.linkToken, idMarmore, 'analise_cliente');
assert.deepStrictEqual(r, { mudou: true, status: 'analise_cliente' });
r = orc.mudarStatusCliente(CAMINHO, acesso.linkToken, idMarmore, 'analise_cliente'); // igual: nada muda, nada notifica
assert.strictEqual(r.mudou, false);
orc.mudarStatusCliente(CAMINHO, acesso.linkToken, idMarmore, 'fechado');
const nots = lerO().notificacoes;
assert.deepStrictEqual(nots.map((n) => [n.tipo, n.de, n.para, n.itemNome, n.lida]), [['status', 'em_andamento', 'analise_cliente', 'Mármore da bancada', false], ['status', 'analise_cliente', 'fechado', 'Mármore da bancada', false]]);
assert.strictEqual(lerO().temNovidadeNaoLida, true);
// depois de FECHADO ele ainda pode voltar atrás (Recusado/Análise)
assert.strictEqual(orc.mudarStatusCliente(CAMINHO, acesso.linkToken, idMarmore, 'recusado').status, 'recusado');
console.log('OK');

console.log('== 8. Comentários: cliente e arquiteto, limites, novidade com prévia ==');
assert.throws(() => orc.comentarCliente(CAMINHO, acesso.linkToken, idMarmore, '   '), /vazio/);
assert.throws(() => orc.comentarCliente(CAMINHO, acesso.linkToken, idMarmore, 'x'.repeat(1001)), /passa de 1000/);
const longo = 'A'.repeat(300);
orc.comentarCliente(CAMINHO, acesso.linkToken, idMarmore, longo);
const ultima = lerO().notificacoes.slice(-1)[0];
assert.deepStrictEqual([ultima.tipo, ultima.texto.length], ['comentario', 141], 'a novidade traz só uma prévia do texto');
orc.comentarComoArquiteto(CAMINHO, 'projO', idMarmore, 'Combinado, vou rever o valor.', DONO);
const comentarios = orc.listarParaCliente(CAMINHO, acesso.linkToken).itens.find((x) => x.id === idMarmore).comentarios;
assert.deepStrictEqual(comentarios.map((c) => c.autor), ['cliente', 'arquiteto']);
assert.ok(comentarios.every((c) => !('lido' in c)), 'o cliente não vê o controle interno de "lido"');
const antesTotal = lerO().notificacoes.length;
orc.comentarComoArquiteto(CAMINHO, 'projO', idMarmore, 'Resposta do arquiteto', DONO);
assert.strictEqual(lerO().notificacoes.length, antesTotal, 'comentário do arquiteto não gera novidade pra ele mesmo');
console.log('OK');

console.log('== 9. Marcar como lido apaga o selo e mantém a lista ==');
orc.marcarNovidadesLidas(CAMINHO, 'projO', DONO);
assert.strictEqual(lerO().temNovidadeNaoLida, false);
assert.ok(lerO().notificacoes.length >= 3 && lerO().notificacoes.every((n) => n.lida));
orc.comentarCliente(CAMINHO, acesso.linkToken, idMarmore, 'Nova dúvida');
assert.strictEqual(lerO().temNovidadeNaoLida, true, 'uma ação nova acende o selo de novo');
console.log('OK');

console.log('== 10. Excluir item leva as novidades dele junto ==');
orc.excluirItem(CAMINHO, 'projO', idMarmore, DONO);
assert.ok(!lerO().itens.some((x) => x.id === idMarmore));
assert.ok(!lerO().notificacoes.some((n) => n.itemId === idMarmore));
assert.strictEqual(lerO().temNovidadeNaoLida, false);
assert.throws(() => orc.excluirItem(CAMINHO, 'projO', idMarmore, DONO), /não encontrado/);
console.log('OK');

console.log('== 11. Posse: outra licença não lê, não edita, não apaga, não cria acesso ==');
const foto = JSON.stringify(lerO());
const id2 = lerO().itens[0].id;
assert.throws(() => orc.lerParaArquiteto(CAMINHO, 'projO', INTRUSO), /não pertence/);
assert.throws(() => orc.definirAcesso(CAMINHO, 'projO', { usuario: 'ladrao', senha: 'abcd' }, INTRUSO), /não pertence/);
assert.throws(() => orc.adicionarItem(CAMINHO, 'projO', { item: 'x' }, INTRUSO), /não pertence/);
assert.throws(() => orc.editarItem(CAMINHO, 'projO', id2, { item: 'x' }, INTRUSO), /não pertence/);
assert.throws(() => orc.excluirItem(CAMINHO, 'projO', id2, INTRUSO), /não pertence/);
assert.throws(() => orc.comentarComoArquiteto(CAMINHO, 'projO', id2, 'x', INTRUSO), /não pertence/);
assert.throws(() => orc.marcarNovidadesLidas(CAMINHO, 'projO', INTRUSO), /não pertence/);
assert.throws(() => orc.lerParaArquiteto(CAMINHO, 'projInexistente', DONO), /não encontrada/);
assert.strictEqual(JSON.stringify(lerO()), foto, 'nada mudou');
console.log('OK');

console.log('== 12. Limite de orçamentos por projeto ==');
const cheio = JSON.parse(fs.readFileSync(CAMINHO, 'utf8'));
while (cheio.galerias[0].orcamentos.itens.length < orc.LIMITE_ITENS) cheio.galerias[0].orcamentos.itens.push({ id: 'x' + cheio.galerias[0].orcamentos.itens.length, item: 't', status: 'a_fazer', comentarios: [] });
fs.writeFileSync(CAMINHO, JSON.stringify(cheio));
assert.throws(() => orc.adicionarItem(CAMINHO, 'projO', { item: 'a mais' }, DONO), /Limite/);
console.log('OK');

fs.rmSync(TMP, { recursive: true, force: true });
console.log('\nTODOS OS TESTES DOS ORÇAMENTOS PASSARAM');
