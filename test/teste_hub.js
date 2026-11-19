const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const galeria = require('../lib/galeria');
const hub = require('../lib/hub');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-hub-'));
const CAMINHO = path.join(TMP, 'dados-galerias.json');
const DONO = 'arq@teste.com';
const INTRUSO = 'outro@teste.com';

galeria.criarOuAtualizarGaleria(CAMINHO, { projetoId: 'projH', licencaUsuario: DONO, nomeProjeto: 'Apartamento', clienteUsuario: 'cliente', clienteSenha: 'senha1234' });
const URL1 = 'https://drive.google.com/file/d/AAA/view?usp=sharing';

console.log('== 1. Galeria nova nasce com hub vazio; galeria ANTIGA (sem o campo) também ganha ==');
assert.deepStrictEqual(galeria.buscarGaleriaPorProjeto(CAMINHO, 'projH').hub, { dadosProjeto: '', links: {}, gruposExecutivo: null, documentos: [], capaFotoId: null });
const estadoAntigo = JSON.parse(fs.readFileSync(CAMINHO, 'utf8'));
delete estadoAntigo.galerias[0].hub;
fs.writeFileSync(CAMINHO, JSON.stringify(estadoAntigo));
assert.deepStrictEqual(galeria.buscarGaleriaPorProjeto(CAMINHO, 'projH').hub.documentos, []);
console.log('OK');

console.log('== 2. Dados do projeto e links externos ==');
let h = hub.atualizarHub(CAMINHO, 'projH', { dadosProjeto: '  Cliente: Fulano\nProjeto de Interiores 96m²  ', links: { tourVirtual: { url: 'https://kuula.co/share/collection/abc', titulo: 'Tour' }, dashboard: { url: 'https://view.monday.com/x' } } }, DONO);
assert.strictEqual(h.dadosProjeto, 'Cliente: Fulano\nProjeto de Interiores 96m²');
assert.strictEqual(h.links.tourVirtual.titulo, 'Tour');
assert.strictEqual(h.links.dashboard.titulo, '');
h = hub.atualizarHub(CAMINHO, 'projH', { links: { dashboard: { url: '' } } }, DONO); // vazio remove só esse
assert.ok(h.links.tourVirtual && !h.links.dashboard);
assert.throws(() => hub.atualizarHub(CAMINHO, 'projH', { links: { tourVirtual: { url: 'javascript:alert(1)' } } }, DONO), /inválido/);
assert.throws(() => hub.atualizarHub(CAMINHO, 'projH', { links: { tourVirtual: { url: 'texto solto' } } }, DONO), /inválido/);
assert.throws(() => hub.atualizarHub(CAMINHO, 'projH', { links: { outraCoisa: { url: 'https://a.com' } } }, DONO), /desconhecido/);
assert.ok(galeria.buscarGaleriaPorProjeto(CAMINHO, 'projH').hub.links.tourVirtual, 'link inválido não pode ter apagado o que já existia');
console.log('OK');

console.log('== 3. Grupos do executivo: padrão, personalizado e volta ao padrão ==');
assert.strictEqual(hub.gruposDoExecutivo(galeria.buscarGaleriaPorProjeto(CAMINHO, 'projH').hub).length, 8);
h = hub.atualizarHub(CAMINHO, 'projH', { gruposExecutivo: ['Elétrica', ' elétrica ', 'Hidráulica', ''] }, DONO);
assert.deepStrictEqual(h.gruposExecutivo, ['Elétrica', 'Hidráulica']); // sem repetido (ignora acento/maiúscula) e sem vazio
h = hub.atualizarHub(CAMINHO, 'projH', { gruposExecutivo: null }, DONO);
assert.strictEqual(hub.gruposDoExecutivo(h).length, 8);
console.log('OK');

console.log('== 3b. Capa do hub: só foto FIXA do próprio projeto; null volta pra capa padrão ==');
const fotoFixa = galeria.adicionarFoto(CAMINHO, 'projH', { nomeExibicao: 'Sala', tipo: 'fixa', r2Key: 'a.webp' });
const foto360 = galeria.adicionarFoto(CAMINHO, 'projH', { nomeExibicao: 'Sala 360', tipo: '360', r2Key: 'b.webp' });
assert.strictEqual(hub.atualizarHub(CAMINHO, 'projH', { capaFotoId: fotoFixa.id }, DONO).capaFotoId, fotoFixa.id);
assert.throws(() => hub.atualizarHub(CAMINHO, 'projH', { capaFotoId: foto360.id }, DONO), /360/);
assert.throws(() => hub.atualizarHub(CAMINHO, 'projH', { capaFotoId: 'foto_que_nao_existe' }, DONO), /não encontrada/);
assert.strictEqual(galeria.buscarGaleriaPorProjeto(CAMINHO, 'projH').hub.capaFotoId, fotoFixa.id, 'escolha inválida não pode ter apagado a capa');
assert.throws(() => hub.atualizarHub(CAMINHO, 'projH', { capaFotoId: fotoFixa.id }, INTRUSO), /não pertence/);
assert.strictEqual(hub.atualizarHub(CAMINHO, 'projH', { capaFotoId: null }, DONO).capaFotoId, null);
console.log('OK');

console.log('== 4. Documento novo: revisão automática, status padrão ATUAL, validações ==');
let r = hub.adicionarDocumento(CAMINHO, 'projH', { secao: 'executivo', grupo: 'Iluminação e Circuitos', pavimento: 'Térreo', titulo: 'Iluminação Térreo', url: URL1 }, DONO);
assert.strictEqual(r.documento.revisao, 0);
assert.strictEqual(r.documento.status, 'ATUAL');
assert.deepStrictEqual(r.substituidos, []);
assert.ok(r.documento.id.startsWith('doc_'));
assert.throws(() => hub.adicionarDocumento(CAMINHO, 'projH', { secao: 'executivo', pavimento: 'x', titulo: 't', url: URL1 }, DONO), /grupo/i);
assert.throws(() => hub.adicionarDocumento(CAMINHO, 'projH', { secao: 'inexistente', titulo: 't', url: URL1 }, DONO), /Seção/);
assert.throws(() => hub.adicionarDocumento(CAMINHO, 'projH', { secao: 'visitas', titulo: '', url: URL1 }, DONO), /Título/);
assert.throws(() => hub.adicionarDocumento(CAMINHO, 'projH', { secao: 'visitas', titulo: 'x', url: 'ftp://a.com/x' }, DONO), /inválido/);
assert.throws(() => hub.adicionarDocumento(CAMINHO, 'projH', { secao: 'visitas', titulo: 'x', url: URL1, status: 'QUALQUER' }, DONO), /Status/);
assert.throws(() => hub.adicionarDocumento(CAMINHO, 'projH', { secao: 'visitas', titulo: 'x', url: URL1, revisao: -1 }, DONO), /Revisão/);
// seção que não é executivo ignora o grupo
r = hub.adicionarDocumento(CAMINHO, 'projH', { secao: 'planta_original', grupo: 'lixo', titulo: 'Planta original', url: URL1 }, DONO);
assert.strictEqual(r.documento.grupo, '');
console.log('OK');

console.log('== 5. Prévia: mostra quem viraria ANTIGA e a próxima revisão, SEM gravar ==');
const antes = JSON.stringify(galeria.buscarGaleriaPorProjeto(CAMINHO, 'projH').hub);
let prev = hub.preverSubstituicao(CAMINHO, 'projH', { secao: 'executivo', grupo: 'iluminacao e circuitos', pavimento: 'térreo' }, DONO); // ignora acento/maiúscula
assert.strictEqual(prev.substituiria.length, 1);
assert.strictEqual(prev.substituiria[0].titulo, 'Iluminação Térreo');
assert.strictEqual(prev.revisaoSugerida, 1);
prev = hub.preverSubstituicao(CAMINHO, 'projH', { secao: 'executivo', grupo: 'Iluminação e Circuitos', pavimento: 'Superior' }, DONO); // outro andar: nada a substituir
assert.deepStrictEqual(prev, { substituiria: [], revisaoSugerida: 0 });
assert.strictEqual(JSON.stringify(galeria.buscarGaleriaPorProjeto(CAMINHO, 'projH').hub), antes);
console.log('OK');

console.log('== 6. Revisão nova com confirmação: só o confirmado vira ANTIGA; outro pavimento fica intacto ==');
const terreo0 = galeria.buscarGaleriaPorProjeto(CAMINHO, 'projH').hub.documentos.find((d) => d.pavimento === 'Térreo');
const sup0 = hub.adicionarDocumento(CAMINHO, 'projH', { secao: 'executivo', grupo: 'Iluminação e Circuitos', pavimento: 'Superior', titulo: 'Iluminação Superior', url: URL1 }, DONO).documento;
const terreo1 = hub.adicionarDocumento(CAMINHO, 'projH', { secao: 'executivo', grupo: 'Iluminação e Circuitos', pavimento: 'Térreo', titulo: 'Iluminação Térreo REV1', url: URL1, substituirIds: [terreo0.id] }, DONO);
assert.strictEqual(terreo1.documento.revisao, 1);
assert.deepStrictEqual(terreo1.substituidos.map((d) => d.id), [terreo0.id]);
let docs = galeria.buscarGaleriaPorProjeto(CAMINHO, 'projH').hub.documentos;
assert.strictEqual(docs.find((d) => d.id === terreo0.id).status, 'ANTIGA');
assert.strictEqual(docs.find((d) => d.id === terreo1.documento.id).status, 'ATUAL');
assert.strictEqual(docs.find((d) => d.id === sup0.id).status, 'ATUAL', 'o outro pavimento não pode ser mexido');
console.log('OK');

console.log('== 7. Sem substituirIds o servidor NÃO arquiva nada sozinho (2 memoriais no mesmo grupo) ==');
const m1 = hub.adicionarDocumento(CAMINHO, 'projH', { secao: 'executivo', grupo: 'Memorial de Itens', titulo: 'Memorial de itens', url: URL1 }, DONO).documento;
const m2 = hub.adicionarDocumento(CAMINHO, 'projH', { secao: 'executivo', grupo: 'Memorial de Itens', titulo: 'Memorial de box e espelhos', url: URL1 }, DONO);
assert.deepStrictEqual(m2.substituidos, []);
docs = galeria.buscarGaleriaPorProjeto(CAMINHO, 'projH').hub.documentos;
assert.strictEqual(docs.find((d) => d.id === m1.id).status, 'ATUAL');
console.log('OK');

console.log('== 8. Status REVISAO no documento novo não arquiva ninguém; id inexistente recusa tudo sem gravar ==');
const rev = hub.adicionarDocumento(CAMINHO, 'projH', { secao: 'executivo', grupo: 'Iluminação e Circuitos', pavimento: 'Superior', titulo: 'Em revisão', url: URL1, status: 'REVISAO', substituirIds: [sup0.id] }, DONO);
assert.deepStrictEqual(rev.substituidos, []);
assert.strictEqual(galeria.buscarGaleriaPorProjeto(CAMINHO, 'projH').hub.documentos.find((d) => d.id === sup0.id).status, 'ATUAL');
const qtd = galeria.buscarGaleriaPorProjeto(CAMINHO, 'projH').hub.documentos.length;
assert.throws(() => hub.adicionarDocumento(CAMINHO, 'projH', { secao: 'executivo', grupo: 'Planta de Forro', titulo: 'Forro', url: URL1, substituirIds: [terreo1.documento.id, 'doc_que_nao_existe'] }, DONO), /não encontrado/);
const apos = galeria.buscarGaleriaPorProjeto(CAMINHO, 'projH').hub.documentos;
assert.strictEqual(apos.length, qtd, 'documento não pode ter sido criado');
assert.strictEqual(apos.find((d) => d.id === terreo1.documento.id).status, 'ATUAL', 'nada pode ter sido arquivado pela metade');
console.log('OK');

console.log('== 9. Editar: promover REVISAO a ATUAL arquivando o confirmado; trocar link/obs ==');
const promovido = hub.editarDocumento(CAMINHO, 'projH', rev.documento.id, { status: 'ATUAL', revisao: 1, substituirIds: [sup0.id], observacao: '  versão final ' }, DONO);
assert.strictEqual(promovido.documento.status, 'ATUAL');
assert.strictEqual(promovido.documento.observacao, 'versão final');
assert.deepStrictEqual(promovido.substituidos.map((d) => d.id), [sup0.id]);
assert.strictEqual(galeria.buscarGaleriaPorProjeto(CAMINHO, 'projH').hub.documentos.find((d) => d.id === sup0.id).status, 'ANTIGA');
assert.throws(() => hub.editarDocumento(CAMINHO, 'projH', rev.documento.id, { url: 'nada' }, DONO), /inválido/);
assert.throws(() => hub.editarDocumento(CAMINHO, 'projH', rev.documento.id, { substituirIds: [rev.documento.id], status: 'ATUAL' }, DONO), /não encontrado/); // não substitui a si mesmo
assert.throws(() => hub.editarDocumento(CAMINHO, 'projH', 'doc_xx', { titulo: 'a' }, DONO), /não encontrado/);
console.log('OK');

console.log('== 10. Excluir documento ==');
hub.excluirDocumento(CAMINHO, 'projH', m2.documento.id, DONO);
assert.ok(!galeria.buscarGaleriaPorProjeto(CAMINHO, 'projH').hub.documentos.some((d) => d.id === m2.documento.id));
assert.throws(() => hub.excluirDocumento(CAMINHO, 'projH', m2.documento.id, DONO), /não encontrado/);
console.log('OK');

console.log('== 11. Posse: outra licença não mexe em nada (nem lê a prévia) ==');
const fotografia = JSON.stringify(galeria.buscarGaleriaPorProjeto(CAMINHO, 'projH').hub);
assert.throws(() => hub.atualizarHub(CAMINHO, 'projH', { dadosProjeto: 'invadido' }, INTRUSO), /não pertence/);
assert.throws(() => hub.adicionarDocumento(CAMINHO, 'projH', { secao: 'visitas', titulo: 'x', url: URL1 }, INTRUSO), /não pertence/);
assert.throws(() => hub.editarDocumento(CAMINHO, 'projH', m1.id, { titulo: 'x' }, INTRUSO), /não pertence/);
assert.throws(() => hub.excluirDocumento(CAMINHO, 'projH', m1.id, INTRUSO), /não pertence/);
assert.throws(() => hub.preverSubstituicao(CAMINHO, 'projH', { secao: 'executivo', grupo: 'x' }, INTRUSO), /não pertence/);
assert.throws(() => hub.atualizarHub(CAMINHO, 'projInexistente', { dadosProjeto: 'x' }, DONO), /não encontrada/);
assert.strictEqual(JSON.stringify(galeria.buscarGaleriaPorProjeto(CAMINHO, 'projH').hub), fotografia);
console.log('OK');

console.log('== 12. Limite de documentos por projeto ==');
const estadoCheio = JSON.parse(fs.readFileSync(CAMINHO, 'utf8'));
const gCheio = estadoCheio.galerias[0];
while (gCheio.hub.documentos.length < hub.LIMITE_DOCUMENTOS_POR_PROJETO) gCheio.hub.documentos.push({ id: 'x' + gCheio.hub.documentos.length, secao: 'visitas', grupo: '', pavimento: '', titulo: 't', revisao: 0, status: 'ATUAL', url: URL1 });
fs.writeFileSync(CAMINHO, JSON.stringify(estadoCheio));
assert.throws(() => hub.adicionarDocumento(CAMINHO, 'projH', { secao: 'visitas', titulo: 'a mais', url: URL1 }, DONO), /Limite/);
console.log('OK');

fs.rmSync(TMP, { recursive: true, force: true });
console.log('\nTODOS OS TESTES DO HUB PASSARAM');
