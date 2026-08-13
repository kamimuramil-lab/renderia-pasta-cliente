const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const galeria = require('../lib/galeria');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-galeria-'));
const CAMINHO = path.join(TMP, 'dados-galerias.json');

console.log('== 1. Criar a Pasta do Cliente pela primeira vez exige usuário/senha do cliente ==');
assert.throws(() => {
  galeria.criarOuAtualizarGaleria(CAMINHO, { projetoId: 'proj1', licencaUsuario: 'arquiteto@teste.com', nomeProjeto: 'Casa X' });
}, /usuário e a senha do cliente/);
console.log('OK');

console.log('== 2. Criar com os dados certos funciona e gera um linkToken único ==');
const g1 = galeria.criarOuAtualizarGaleria(CAMINHO, {
  projetoId: 'proj1', licencaUsuario: 'arquiteto@teste.com', nomeProjeto: 'Casa X',
  clienteUsuario: 'cliente1', clienteSenha: 'abc123'
});
assert.ok(g1.linkToken && g1.linkToken.length >= 32, 'deveria ter um linkToken longo');
console.log('OK -- linkToken:', g1.linkToken.slice(0, 8) + '...');

console.log('== 3. Chamar de novo pro MESMO projeto atualiza (não duplica) ==');
galeria.criarOuAtualizarGaleria(CAMINHO, { projetoId: 'proj1', licencaUsuario: 'arquiteto@teste.com', nomeProjeto: 'Casa X Reforma' });
const estadoApos = galeria.lerEstado(CAMINHO);
assert.strictEqual(estadoApos.galerias.length, 1, 'não deveria ter criado uma segunda galeria pro mesmo projeto');
assert.strictEqual(estadoApos.galerias[0].nomeProjeto, 'Casa X Reforma');
console.log('OK');

console.log('== 3b. Foto sem nome fica com string vazia (não força "Sem nome") ==');
galeria.criarOuAtualizarGaleria(CAMINHO, {
  projetoId: 'projNomeVazio', licencaUsuario: 'outro-arquiteto@teste.com', nomeProjeto: 'Teste Nome Vazio',
  clienteUsuario: 'clienteNV', clienteSenha: 'abc123'
});
const fotoSemNome = galeria.adicionarFoto(CAMINHO, 'projNomeVazio', { tipo: 'fixa', r2Key: 'projNV/semnome.webp' });
assert.strictEqual(fotoSemNome.nomeExibicao, '', 'não deveria ter forçado nenhum texto padrão');
console.log('OK');

console.log('== 3c. Editar o nome pra vazio de propósito (apagar) funciona -- antes ficava preso no nome antigo ==');
galeria.editarFoto(CAMINHO, 'projNomeVazio', fotoSemNome.id, { nomeExibicao: 'Nome temporário' });
galeria.editarFoto(CAMINHO, 'projNomeVazio', fotoSemNome.id, { nomeExibicao: '' });
const fotoAposApagar = galeria.buscarGaleriaPorProjeto(CAMINHO, 'projNomeVazio').fotos.find((f) => f.id === fotoSemNome.id);
assert.strictEqual(fotoAposApagar.nomeExibicao, '', 'deveria ter aceitado apagar o nome de vez, não voltar pro antigo');
console.log('OK');

console.log('== 4. Adicionar fotos até o limite de 50 por projeto, a 51a falha ==');
for (let i = 0; i < 50; i++) {
  galeria.adicionarFoto(CAMINHO, 'proj1', { nomeExibicao: `Foto ${i}`, tag: 'Sala', tipo: 'fixa', r2Key: `proj1/foto${i}.webp`, capturaIdOrigem: `captura_${i}` });
}
assert.throws(() => {
  galeria.adicionarFoto(CAMINHO, 'proj1', { nomeExibicao: 'Foto 51', tipo: 'fixa', r2Key: 'proj1/foto51.webp' });
}, /limite de 50 fotos/);
console.log('OK -- bloqueou a 51a foto');

console.log('== 4b. capturaIdOrigem fica salvo, pro selinho de aprovada voltar pra galeria principal do app ==');
const primeiraDoProj1 = galeria.buscarGaleriaPorProjeto(CAMINHO, 'proj1').fotos[0];
assert.strictEqual(primeiraDoProj1.capturaIdOrigem, 'captura_0');
console.log('OK');

console.log('== 5. contarFotosDoUsuario soma corretamente entre vários projetos ==');
galeria.criarOuAtualizarGaleria(CAMINHO, {
  projetoId: 'proj2', licencaUsuario: 'arquiteto@teste.com', nomeProjeto: 'Apto Y',
  clienteUsuario: 'cliente2', clienteSenha: 'abc123'
});
galeria.adicionarFoto(CAMINHO, 'proj2', { nomeExibicao: 'Foto A', tipo: 'fixa', r2Key: 'proj2/a.webp' });
galeria.adicionarFoto(CAMINHO, 'proj2', { nomeExibicao: 'Foto B', tipo: '360', r2Key: 'proj2/b.webp' });
assert.strictEqual(galeria.contarFotosDoUsuario(CAMINHO, 'arquiteto@teste.com'), 52, '50 do proj1 + 2 do proj2');
console.log('OK -- total = 52');

console.log('== 6. Arquivar uma foto NÃO libera espaço na quota (continua contando) ==');
const fotosProj2 = galeria.buscarGaleriaPorProjeto(CAMINHO, 'proj2').fotos;
galeria.editarFoto(CAMINHO, 'proj2', fotosProj2[0].id, { arquivada: true });
assert.strictEqual(galeria.contarFotosDoUsuario(CAMINHO, 'arquiteto@teste.com'), 52, 'arquivar não deveria mudar a contagem');
console.log('OK');

console.log('== 7. Excluir de vez SIM libera espaço, e devolve o r2Key pra apagar do armazenamento ==');
const r2KeyRemovido = galeria.excluirFoto(CAMINHO, 'proj2', fotosProj2[0].id);
assert.strictEqual(r2KeyRemovido, 'proj2/a.webp');
assert.strictEqual(galeria.contarFotosDoUsuario(CAMINHO, 'arquiteto@teste.com'), 51, 'excluir deveria liberar 1 vaga');
console.log('OK');

console.log('== 8. Login do cliente com senha errada falha, com a certa funciona ==');
assert.throws(() => galeria.loginCliente(CAMINHO, g1.linkToken, 'cliente1', 'senhaerrada'), /incorretos/);
const tokenCliente = galeria.loginCliente(CAMINHO, g1.linkToken, 'cliente1', 'abc123');
assert.ok(tokenCliente);
assert.strictEqual(galeria.validarTokenCliente(CAMINHO, g1.linkToken, tokenCliente), true);
assert.strictEqual(galeria.validarTokenCliente(CAMINHO, g1.linkToken, 'token-invalido'), false);
console.log('OK');

console.log('== 9. Trocar a senha do cliente derruba as sessões antigas (precisa logar de novo) ==');
galeria.criarOuAtualizarGaleria(CAMINHO, { projetoId: 'proj1', licencaUsuario: 'arquiteto@teste.com', clienteSenha: 'novaSenha123' });
assert.strictEqual(galeria.validarTokenCliente(CAMINHO, g1.linkToken, tokenCliente), false, 'sessao antiga deveria ter sido derrubada');
assert.throws(() => galeria.loginCliente(CAMINHO, g1.linkToken, 'cliente1', 'abc123'), /incorretos/, 'senha antiga não deveria funcionar mais');
const tokenNovo = galeria.loginCliente(CAMINHO, g1.linkToken, 'cliente1', 'novaSenha123');
assert.ok(tokenNovo);
console.log('OK');

console.log('== 10. Comentário marca temComentarioNaoLido = true, e marcarComentariosLidos limpa ==');
const primeiraFoto = galeria.buscarGaleriaPorProjeto(CAMINHO, 'proj1').fotos[0];
galeria.comentarFoto(CAMINHO, g1.linkToken, primeiraFoto.id, { texto: 'Pode trocar o piso?' });
assert.strictEqual(galeria.buscarGaleriaPorProjeto(CAMINHO, 'proj1').temComentarioNaoLido, true);
galeria.marcarComentariosLidos(CAMINHO, 'proj1', 'arquiteto@teste.com');
assert.strictEqual(galeria.buscarGaleriaPorProjeto(CAMINHO, 'proj1').temComentarioNaoLido, false);
assert.strictEqual(galeria.buscarGaleriaPorProjeto(CAMINHO, 'proj1').fotos[0].comentarios[0].lido, true);
console.log('OK');

console.log('== 10b. Comentário com desenho (rabisco) guarda o desenhoR2Key certinho ==');
galeria.comentarFoto(CAMINHO, g1.linkToken, primeiraFoto.id, { texto: 'Aumentar essa área', desenhoR2Key: 'link123/comentarios/abc.png' });
const comentariosAposDesenho = galeria.buscarGaleriaPorProjeto(CAMINHO, 'proj1').fotos[0].comentarios;
const comDesenho = comentariosAposDesenho.find((c) => c.desenhoR2Key);
assert.ok(comDesenho, 'deveria ter um comentário com desenhoR2Key');
assert.strictEqual(comDesenho.desenhoR2Key, 'link123/comentarios/abc.png');
console.log('OK');

console.log('== 11. Aprovar uma foto marca o campo aprovada ==');
galeria.aprovarFoto(CAMINHO, g1.linkToken, primeiraFoto.id, true);
assert.strictEqual(galeria.buscarGaleriaPorProjeto(CAMINHO, 'proj1').fotos[0].aprovada, true);
console.log('OK');

console.log('== 12. Aprovar também marca temComentarioNaoLido (arquiteto precisa saber, não só de comentário) ==');
galeria.marcarComentariosLidos(CAMINHO, 'proj1', 'arquiteto@teste.com'); // limpa antes, pra testar isolado
assert.strictEqual(galeria.buscarGaleriaPorProjeto(CAMINHO, 'proj1').temComentarioNaoLido, false);
galeria.aprovarFoto(CAMINHO, g1.linkToken, primeiraFoto.id, false);
assert.strictEqual(galeria.buscarGaleriaPorProjeto(CAMINHO, 'proj1').temComentarioNaoLido, true, 'aprovar/desaprovar deveria acender o selinho também');
console.log('OK');

console.log('\nTODOS OS TESTES DA GALERIA PASSARAM 🎉');

// ========================================================================
// TESTE DE SEGURANÇA (auditoria ago/2026) -- C1, o achado CRÍTICO do
// relatório. Confirma que um licencaUsuario diferente do dono real não
// consegue mais "atualizar" (e sequestrar as credenciais do cliente de)
// uma galeria que já pertence a outra pessoa.
// ========================================================================
console.log('\n=== TESTE DE SEGURANÇA CRÍTICO: sequestro de galeria via projetoId adivinhado (C1) ===');
const DONO_REAL = 'arquiteto@teste.com';
const ATACANTE_C1 = 'atacante@teste.com';

console.log('== C1-1. Atacante NÃO consegue "atualizar" (sequestrar) o proj1, que já pertence a outra licença ==');
assert.throws(
  () => galeria.criarOuAtualizarGaleria(CAMINHO, {
    projetoId: 'proj1', // já existe, criado pelo DONO_REAL lá em cima
    licencaUsuario: ATACANTE_C1,
    clienteUsuario: 'usuarioDoAtacante',
    clienteSenha: 'senhaDoAtacante123'
  }),
  /não pertence a essa licença/i
);
console.log('OK -- bloqueado\n');

console.log('== C1-2. E as credenciais do cliente NÃO foram alteradas pela tentativa ==');
// se a correção falhasse, as credenciais do atacante teriam substituído
// as da linha 95 (tokenNovo/novaSenha123) -- confirma que continuam as
// mesmas de antes da tentativa de ataque.
assert.throws(() => galeria.loginCliente(CAMINHO, g1.linkToken, 'usuarioDoAtacante', 'senhaDoAtacante123'), /incorretos/, 'login com as credenciais do atacante NUNCA deveria funcionar');
const loginAindaFunciona = galeria.loginCliente(CAMINHO, g1.linkToken, 'cliente1', 'novaSenha123');
assert.ok(loginAindaFunciona, 'as credenciais legítimas (do dono real) deveriam continuar funcionando normalmente');
console.log('OK -- credenciais do cliente real intactas, credenciais forjadas pelo atacante nunca vingaram\n');

console.log('== C1-3. O DONO real continua conseguindo atualizar o próprio projeto normalmente ==');
const atualizacaoLegitima = galeria.criarOuAtualizarGaleria(CAMINHO, {
  projetoId: 'proj1', licencaUsuario: DONO_REAL, nomeProjeto: 'Casa X Reforma V2'
});
assert.strictEqual(atualizacaoLegitima.nomeProjeto, 'Casa X Reforma V2');
console.log('OK -- dono real segue com acesso total\n');

console.log('== C1-4. Criar um projetoId NOVO (que não existe ainda) continua funcionando pra qualquer licença -- só ATUALIZAR um alheio é que é bloqueado ==');
const projetoGenuinamenteNovo = galeria.criarOuAtualizarGaleria(CAMINHO, {
  projetoId: 'projTotalmenteNovo', licencaUsuario: ATACANTE_C1,
  clienteUsuario: 'clienteLegitimoDoAtacante', clienteSenha: 'senha1234'
});
assert.strictEqual(projetoGenuinamenteNovo.licencaUsuario, ATACANTE_C1);
console.log('OK -- criar projeto genuinamente novo continua liberado (não é isso que era o problema)\n');

console.log('TESTE DE SEGURANÇA CRÍTICO (C1) PASSOU 🔒');
