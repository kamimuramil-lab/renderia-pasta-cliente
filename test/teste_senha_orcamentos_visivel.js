// A senha da Pasta de ORÇAMENTOS fica sempre visível pro DONO no app (cópia cifrada no servidor; o hash continua sendo o que vale pra entrar).
// Regras: o dono vê a senha atual; trocar a senha troca a cópia; acesso ANTIGO (só hash) mostra null até o cliente entrar uma vez com a senha
// certa (aí a cópia nasce); outra conta não alcança; o cliente nunca recebe senha/hash/cópia; o arquivo de dados não guarda a senha em texto.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const galeria = require('../lib/galeria');
const orc = require('../lib/orcamentos');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-senha-orc-'));
const CAMINHO = path.join(TMP, 'dados-galerias.json');
const DONO = 'arq@teste.com';
const INTRUSO = 'outro@teste.com';
delete process.env.RENDERIA_SEGREDO_SERVIDORES; // usa o arquivo de chave ao lado dos dados (padrão de teste)

galeria.criarOuAtualizarGaleria(CAMINHO, { projetoId: 'p1', licencaUsuario: DONO, nomeProjeto: 'Apto', clienteUsuario: 'cliente', clienteSenha: 'senha1234' });

console.log('== 1. Criar o acesso: o dono vê a senha; o arquivo não guarda em texto ==');
const ac = orc.definirAcesso(CAMINHO, 'p1', { usuario: 'orc-fulano', senha: 'SenhaOrc42' }, DONO);
assert.deepStrictEqual(Object.keys(ac).sort(), ['exigirLogin', 'linkToken', 'usuario'], 'a resposta do PUT não devolve senha');
assert.strictEqual(orc.lerParaArquiteto(CAMINHO, 'p1', DONO).acesso.senha, 'SenhaOrc42');
assert.ok(!fs.readFileSync(CAMINHO, 'utf8').includes('SenhaOrc42'), 'a senha não está em texto puro no arquivo de dados');
console.log('OK');

console.log('== 2. Trocar só o login mantém a senha; trocar a senha troca a cópia ==');
orc.definirAcesso(CAMINHO, 'p1', { usuario: 'orc-novo' }, DONO);
assert.strictEqual(orc.lerParaArquiteto(CAMINHO, 'p1', DONO).acesso.senha, 'SenhaOrc42');
orc.definirAcesso(CAMINHO, 'p1', { usuario: 'orc-novo', senha: 'Outra-777' }, DONO);
const l2 = orc.lerParaArquiteto(CAMINHO, 'p1', DONO).acesso;
assert.strictEqual(l2.senha, 'Outra-777');
assert.ok(orc.loginCliente(CAMINHO, ac.linkToken, 'orc-novo', 'Outra-777'), 'a senha nova entra');
assert.throws(() => orc.loginCliente(CAMINHO, ac.linkToken, 'orc-novo', 'SenhaOrc42'), /incorretos/, 'a antiga não entra mais');
console.log('OK');

console.log('== 3. Acesso ANTIGO (só hash): senha indisponível até o cliente entrar com a senha certa ==');
const dados = JSON.parse(fs.readFileSync(CAMINHO, 'utf8'));
delete dados.galerias[0].orcamentos.acesso.senhaCifrada;
fs.writeFileSync(CAMINHO, JSON.stringify(dados));
assert.strictEqual(orc.lerParaArquiteto(CAMINHO, 'p1', DONO).acesso.senha, null);
assert.throws(() => orc.loginCliente(CAMINHO, ac.linkToken, 'orc-novo', 'errada'), /incorretos/);
assert.strictEqual(orc.lerParaArquiteto(CAMINHO, 'p1', DONO).acesso.senha, null, 'senha errada não cria cópia');
orc.loginCliente(CAMINHO, ac.linkToken, 'orc-novo', 'Outra-777');
assert.strictEqual(orc.lerParaArquiteto(CAMINHO, 'p1', DONO).acesso.senha, 'Outra-777', 'depois do login certo a cópia nasce');
console.log('OK');

console.log('== 4. Cópia estragada ou chave perdida = null, sem derrubar ==');
const estragado = JSON.parse(fs.readFileSync(CAMINHO, 'utf8'));
estragado.galerias[0].orcamentos.acesso.senhaCifrada = 'v1.a.xxx.yyy.zzz';
fs.writeFileSync(CAMINHO, JSON.stringify(estragado));
assert.strictEqual(orc.lerParaArquiteto(CAMINHO, 'p1', DONO).acesso.senha, null);
console.log('OK');

console.log('== 5. Posse: outra conta não alcança; o cliente nunca recebe senha/hash/cópia ==');
orc.definirAcesso(CAMINHO, 'p1', { usuario: 'orc-novo', senha: 'Final-123' }, DONO);
assert.throws(() => orc.lerParaArquiteto(CAMINHO, 'p1', INTRUSO), /não pertence/);
const paraCliente = JSON.stringify(orc.listarParaCliente(CAMINHO, ac.linkToken));
assert.ok(!/Final-123|senhaHash|senhaCifrada|sessoesAtivas|"senha"/.test(paraCliente), 'a lista do cliente não leva nada de senha');
console.log('OK');

fs.rmSync(TMP, { recursive: true, force: true });
console.log('\nTODOS OS TESTES DA SENHA DOS ORÇAMENTOS PASSARAM');
