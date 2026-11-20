// Página do cliente (nov/2026): novidades por aba (bolinha), balão de ajuda + contatos do escritório, documento do PDF do memorial
// e impressão no celular. Os módulos são lógica pura (rodam em Node com `window` simulado); o que depende do navegador de verdade
// (tela, clique, aba nova) foi conferido num navegador com o projeto DGT. Aqui também há conferências ESTRUTURAIS (scripts, ordem, ganchos).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const pub = path.join(__dirname, '..', 'public');
const js = (n) => path.join(pub, 'assets/js', n);
const ok = (m) => console.log('OK  ' + m);

// ---- ambiente de navegador mínimo ----
const armazenamento = {};
let semArmazenamento = false;
global.window = {};
global.localStorage = {
  getItem: (k) => { if (semArmazenamento) throw new Error('bloqueado'); return Object.prototype.hasOwnProperty.call(armazenamento, k) ? armazenamento[k] : null; },
  setItem: (k, v) => { if (semArmazenamento) throw new Error('bloqueado'); armazenamento[k] = String(v); }
};
const trocarNavegador = (userAgent, toques) => Object.defineProperty(global, 'navigator', { value: { userAgent, maxTouchPoints: toques || 0 }, configurable: true });
trocarNavegador('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130');
require(js('novidades.js')); const Novidades = global.window.Novidades;
require(js('ajuda.js')); const Ajuda = global.window.AjudaCliente;
require(js('memorial-doc.js')); const MemorialDoc = global.window.MemorialDoc;
require(js('impressao.js')); const Impressao = global.window.Impressao;

console.log('== 1. Novidades: primeira visita em silêncio; depois novo/atualizado; abrir a aba zera ==');
{
  const chave = 'k1';
  const v1 = { executivo: [{ id: 'd1', versao: 'a' }, { id: 'd2', versao: 'a' }], memorial: [{ id: 'm1', versao: 'x' }] };
  let n = Novidades.abrir(chave, v1);
  assert.strictEqual(n.primeiraVisita, true);
  assert.deepStrictEqual([n.total('executivo'), n.total('memorial')], [0, 0], 'primeira visita: nada é novo (a foto inicial é gravada em silêncio)');
  n = Novidades.abrir(chave, v1);
  assert.deepStrictEqual([n.primeiraVisita, n.total('executivo')], [false, 0], 'mesma coisa: sem novidade');
  // o arquiteto acrescenta um documento, muda outro e acrescenta um item no memorial
  const v2 = { executivo: [{ id: 'd1', versao: 'a' }, { id: 'd2', versao: 'b' }, { id: 'd3', versao: 'a' }], memorial: [{ id: 'm1', versao: 'x' }, { id: 'm2', versao: 'x' }] };
  n = Novidades.abrir(chave, v2);
  assert.deepStrictEqual([n.total('executivo'), n.total('memorial')], [2, 1], 'd2 atualizado + d3 novo; m2 novo');
  assert.deepStrictEqual([n.tag('executivo', 'd3'), n.tag('executivo', 'd2'), n.tag('executivo', 'd1'), n.tag('memorial', 'm2')], ['NOVO', 'ATUALIZADO', '', 'NOVO']);
  n.marcarVisto('executivo');
  assert.strictEqual(Novidades.abrir(chave, v2).total('executivo'), 0, 'abriu a aba: some da próxima vez');
  assert.strictEqual(Novidades.abrir(chave, v2).total('memorial'), 1, 'a aba que não foi aberta continua com a bolinha');
  assert.strictEqual(n.tag('executivo', 'd3'), 'NOVO', 'o "NOVO" desta visita continua na tela até recarregar');
  // item que SAIU não conta; aba nova (criada depois) entra em silêncio
  assert.strictEqual(Novidades.abrir(chave, { executivo: [{ id: 'd1', versao: 'a' }], memorial: v2.memorial, criativo: [{ id: 'f1', versao: '' }] }).total('criativo'), 0, 'aba criada depois: sem novidade');
  // chaves diferentes não se misturam
  assert.strictEqual(Novidades.abrir('outra', v2).primeiraVisita, true);
  // sem armazenamento (navegação privada): não quebra e não mostra nada
  semArmazenamento = true;
  n = Novidades.abrir('k-sem', v2);
  assert.deepStrictEqual([n.primeiraVisita, n.total('executivo')], [true, 0]);
  n.marcarVisto('executivo');
  semArmazenamento = false;
  // lixo no armazenamento vira "primeira visita"
  armazenamento.lixo = '{nao é json';
  assert.strictEqual(Novidades.abrir('lixo', v2).primeiraVisita, true);
  ok('primeira visita sem marcas; novo x atualizado; abrir a aba zera só ela; sem armazenamento e dado quebrado não derrubam');
}

console.log('== 2. Contatos e balão de ajuda ==');
{
  assert.strictEqual(Ajuda.formatarWhatsapp('5511912345678'), '+55 (11) 91234-5678');
  assert.strictEqual(Ajuda.formatarWhatsapp('551112345678'), '+55 (11) 1234-5678');
  assert.strictEqual(Ajuda.formatarWhatsapp('442079460958'), '+442079460958');
  assert.deepStrictEqual(Ajuda.contatosValidos({ whatsapp: '5511912345678', email: 'a@b.co', instagram: 'meu.perfil' }), { whatsapp: '5511912345678', email: 'a@b.co', instagram: 'meu.perfil' });
  assert.deepStrictEqual(Ajuda.contatosValidos({ whatsapp: 'javascript:alert(1)', email: '"><script>', instagram: 'x y' }), { whatsapp: '', email: '', instagram: '' }, 'o que vier estranho do servidor nunca vira link');
  assert.deepStrictEqual(Ajuda.contatosValidos(null), { whatsapp: '', email: '', instagram: '' });
  const rodape = Ajuda.htmlRodape('Escritório <K>', { whatsapp: '5511912345678', email: 'contato@x.com', instagram: 'perfil' }, 'Apto "Teste"');
  assert.ok(rodape.includes('Escritório &lt;K&gt;') && !rodape.includes('<K>'), 'nome escapado');
  assert.ok(rodape.includes('https://wa.me/5511912345678?text=') && rodape.includes('mailto:contato@x.com') && rodape.includes('https://instagram.com/perfil'), 'os três links');
  assert.ok(rodape.includes('+55 (11) 91234-5678') && rodape.includes('@perfil'));
  assert.ok(decodeURIComponent(rodape.match(/wa\.me\/5511912345678\?text=([^"]+)"/)[1].replace(/&amp;/g, '&')).includes('Apto "Teste"'), 'a mensagem pronta cita o projeto');
  assert.ok(rodape.split('rel="noopener noreferrer"').length - 1 === 2 && rodape.includes('target="_blank"'), 'links externos abrem fora, sem opener');
  assert.strictEqual(Ajuda.htmlRodape('', {}, 'X'), '', 'sem nome e sem contato: sem rodapé');
  assert.ok(Ajuda.htmlRodape('Só o nome', {}, 'X').includes('Só o nome') && !Ajuda.htmlRodape('Só o nome', {}, 'X').includes('hub-rodape-links'), 'só o nome: sem a faixa de links');
  assert.ok(!Ajuda.htmlRodape('', { email: 'a@b.co' }, 'X').includes('wa.me'), 'só mostra o que foi cadastrado');
  ['inicio', 'documentos', 'memorial', 'galeria', 'planta', 'orcamentos'].forEach((t) => {
    const x = Ajuda.TEXTOS[t];
    assert.ok(x && x.titulo && x.oque && x.lista.length && x.como.length, 'texto de ajuda da tela ' + t);
  });
  ok('contatos normalizados viram links seguros; rodapé escapado e só com o que existe; todas as telas têm texto de ajuda');
}

console.log('== 3. Documento do PDF do memorial (igual no computador e no celular) ==');
{
  const itens = [
    { id: 'a', setor: 'Acessórios', numero: 1, item: 'Varal <b>', ambientes: ['AS', 'CZ'], empresa: 'Bendito', especificacoes: 'linha 1\nlinha 2', dimensoes: 'Largura: 1m', quantidade: '1', link: 'https://loja.example/x', fotoUrl: 'https://img.example/a.webp' },
    { id: 'b', setor: 'Acessórios', numero: 2, item: 'Sem foto', ambientes: [], empresa: '', especificacoes: '', dimensoes: '', quantidade: '', link: 'javascript:alert(1)', fotoUrl: null },
    { id: 'c', setor: 'Metais', numero: 1, item: 'Torneira', ambientes: ['LV'], empresa: 'Docol', especificacoes: '', dimensoes: '', quantidade: '2', link: '', fotoUrl: null }
  ];
  const base = { nomeProjeto: 'Apto <Teste>', logo: 'https://img.example/logo.png', itens, setores: ['Acessórios', 'Louças', 'Metais'], setor: '', agora: new Date(2026, 10, 20) };
  let r = MemorialDoc.montarHtml(base);
  assert.deepStrictEqual([r.totalItens, r.setores], [3, ['Acessórios', 'Metais']], 'setor sem itens (Louças) não aparece');
  assert.ok(r.html.includes('Apto &lt;Teste&gt;') && r.html.includes('Varal &lt;b&gt;') && !r.html.includes('Varal <b>'), 'texto escapado');
  assert.ok(r.html.includes('20 de novembro de 2026') && r.html.includes('MEMORIAL DE ITENS'));
  assert.ok(r.html.includes('@page { size: A4 landscape; margin: 10mm 10mm 17mm;') && r.html.includes('width: 297mm'), 'A4 deitado e medidas em mm: independe da tela (é por isso que sai igual no celular)');
  assert.ok(!/@media\s*\(max-width/.test(r.html), 'nenhuma regra de tela estreita no documento');
  assert.ok(r.html.includes('href="https://loja.example/x"') && !r.html.includes('javascript:'), 'só link http(s)');
  assert.strictEqual((r.html.match(/<th>Nº<\/th>/g) || []).length, 2, 'uma tabela por setor, com as 8 colunas');
  assert.ok(['Nº', 'Foto', 'Item', 'Ambiente', 'Empresa', 'Especificações', 'Dimensões', 'Qtd.'].every((c) => r.html.includes(`<th>${c}</th>`)));
  assert.ok(!/valor|R\$/i.test(r.html.replace(/<style>[\s\S]*<\/style>/, '')), 'nunca leva valor');
  r = MemorialDoc.montarHtml({ ...base, setor: 'Metais' });
  assert.deepStrictEqual([r.totalItens, r.setores], [1, ['Metais']], 'filtro de setor');
  assert.ok(!r.html.includes('Varal'));
  assert.throws(() => MemorialDoc.montarHtml({ ...base, setor: 'Louças' }), /Não há itens/);
  assert.throws(() => MemorialDoc.montarHtml({ ...base, itens: [] }), /Não há itens/);
  // rodapé do escritório em TODAS as páginas (fixo no papel), só com o que foi cadastrado
  const comRodape = MemorialDoc.montarHtml({ ...base, escritorio: { nome: 'Escritório <K>', whatsapp: '+55 (11) 91234-5678', email: 'contato@x.com', instagram: '@perfil' } });
  assert.ok(comRodape.html.includes('<div class="rodape-escritorio">Escritório &lt;K&gt; &nbsp;·&nbsp; +55 (11) 91234-5678 &nbsp;·&nbsp; contato@x.com &nbsp;·&nbsp; @perfil</div>'), 'nome, telefone, e-mail e Instagram no rodapé (escapado)');
  // no papel o rodapé vai na caixa da margem de baixo do @page (repete em cada folha SEM ocupar espaço: um bloco "fixo" gerava uma folha extra só com ele)
  assert.ok(comRodape.html.includes('@bottom-center { content: "Escritório \\3C K>  ·  +55'), 'o texto do rodapé entra no @page (com "<" escapado)');
  assert.ok(comRodape.html.includes('@media print {') && comRodape.html.includes('.rodape-escritorio { display: none; }'), 'no papel o bloco da tela some (só a margem do @page vale)');
  // navegador SEM caixas de margem do @page (Safari/iPhone, Chrome < 131) recebe o rodapé em linha, no fim do documento
  assert.ok(comRodape.html.includes('html.sem-margem .rodape-escritorio { display: block;'), 'rodapé em linha só quando a margem não é suportada');
  const scriptMargem = comRodape.html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const classeDe = (ua) => { const dom = { documentElement: { className: '' } }; new Function('navigator', 'document', scriptMargem)({ userAgent: ua }, dom); return dom.documentElement.className.trim(); };
  assert.deepStrictEqual(
    ['Mozilla/5.0 (Windows NT 10.0) Chrome/131.0.0.0 Safari/537.36', 'Mozilla/5.0 (Linux; Android 14) Chrome/140.0.0.0 Mobile Safari/537.36', 'Mozilla/5.0 (Windows NT 10.0) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0', 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.0.0', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Version/17.0 Mobile Safari/604.1', 'Mozilla/5.0 (iPhone) CriOS/140.0 Mobile'].map(classeDe),
    ['', '', '', 'sem-margem', 'sem-margem', 'sem-margem'], 'Chrome/Edge 131+ usam a margem do papel; Safari, iPhone (inclusive Chrome do iPhone) e Chrome antigo usam o rodapé em linha');
  assert.ok(!/position:\s*fixed/.test(comRodape.html), 'nada de posição fixa no rodapé');
  assert.ok(comRodape.html.includes('+55 (11) 91234-5678  ·  contato@x.com  ·  @perfil"'), 'telefone, e-mail e Instagram no texto do rodapé da margem');
  assert.ok(!r.html.includes('@bottom-center'), 'sem dados do escritório não cria rodapé de margem');
  assert.ok(!r.html.includes('<div class="rodape-escritorio">') && MemorialDoc.montarHtml({ ...base, escritorio: { email: 'a@b.co' } }).html.includes('>a@b.co</div>'), 'sem dados do escritório não desenha rodapé; só mostra o que existe');
  ok('A4 deitado em mm, 8 colunas por setor, escape, só link http(s), filtro de setor, sem valores, rodapé do escritório, erro claro');
}

console.log('== 4. Impressão: computador x celular, documento da aba ==');
{
  trocarNavegador('Mozilla/5.0 (Windows NT 10.0) Chrome/130');
  assert.strictEqual(Impressao.ehCelular(), false);
  for (const ua of ['Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130 Mobile', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1', 'Mozilla/5.0 (iPhone) CriOS/130']) { trocarNavegador(ua); assert.strictEqual(Impressao.ehCelular(), true, ua); }
  trocarNavegador('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605', 5); assert.strictEqual(Impressao.ehCelular(), true, 'iPad que se apresenta como Mac');
  trocarNavegador('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605', 0); assert.strictEqual(Impressao.ehCelular(), false, 'Mac de verdade');
  Impressao.config.janela = true; assert.strictEqual(Impressao.ehCelular(), true, 'gancho de teste força a aba'); Impressao.config.janela = null;

  const original = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Antigo</title><style>.pagina{width:297mm}</style></head><body class="x"><section class="pagina">A</section><section class="pagina">B</section></body></html>';
  const doc = Impressao.prepararDocumento(original, 'Apto <1> - Memorial', 1123, true);
  assert.ok(doc.includes('<title>Apto &lt;1&gt; - Memorial</title>') && !doc.includes('<title>Antigo</title>'), 'o título (nome sugerido do arquivo) é trocado e escapado');
  assert.ok(doc.includes('name="viewport"') && doc.includes('id="rt-imprimir"') && doc.includes('id="rt-fechar"') && doc.includes('id="rt-folhas"'), 'barra com "Salvar como PDF", viewport e área das folhas');
  assert.ok(doc.indexOf('<body class="x">') < doc.indexOf('class="rt-barra"') && doc.indexOf('id="rt-folhas"') < doc.indexOf('<section class="pagina">A') && doc.indexOf('<section class="pagina">B') < doc.lastIndexOf('</div>'), 'as folhas ficam dentro da área; a barra vem antes');
  assert.ok(/@media print\{\.rt-barra\{display:none!important\}/.test(doc), 'a barra nunca sai no PDF');
  assert.ok(doc.includes('beforeprint') && doc.includes('afterprint') && doc.includes('--rt-z'), 'zoom da pré-visualização some na hora de imprimir');
  assert.ok(!/zoom\s*:/.test(doc) && doc.includes('transform:none!important') && doc.includes('"scale("') && doc.includes('text-size-adjust:100%'), 'prévia encolhe com scale (o zoom do CSS engordava as letras pequenas no celular) e some na impressão; letras não são inchadas');
  assert.ok(doc.includes('#rt-folhas{width:1123px;'), 'a área das folhas tem a largura da folha (A4 deitado) antes de encolher');
  assert.ok(doc.includes('window.print()') && doc.includes('setTimeout(function(){try{window.print();}catch(e){}},500)'), 'imprime sozinho quando pedido');
  assert.ok(!Impressao.prepararDocumento(original, 'x', 1123, false).includes('setTimeout(function(){try{window.print();'), 'sem imprimir sozinho (botão "Abrir o PDF"): só o botão');
  assert.strictEqual((doc.match(/<\/script>/g) || []).length, 1, 'um único script de apoio, bem fechado');
  assert.ok(!/id="rt-imprimir"[^>]*disabled/.test(doc) && doc.includes('setTimeout(ok,12000)'), 'o botão "Salvar como PDF" NUNCA fica preso esperando imagem (liberado desde o começo)');
  assert.ok(Impressao.prepararDocumento(original, 'x', 1123, true, '2 imagem(ns) ficaram de fora.').includes('2 imagem(ns) ficaram de fora.'), 'aviso de imagens que falharam aparece na aba do PDF');
  const pdfCli = fs.readFileSync(js('pdf-cliente.js'), 'utf8');
  assert.ok(/sessao\.celular \? 1500 : 2000/.test(pdfCli) && /sessao\.celular \? 0\.8 : 0\.88/.test(pdfCli), 'no celular as imagens do PDF vão menores (monta e imprime bem mais rápido)');
  assert.ok(Impressao.prepararDocumento('<html><head><title>t</title></head><body>preço $& e $1 ficam</body></html>', 'a', 1123, false).includes('preço $& e $1 ficam'), 'o conteúdo do PDF nunca é "interpretado" pelo replace');
  // sem celular: iniciar() não abre aba
  trocarNavegador('Mozilla/5.0 (Windows NT 10.0) Chrome/130');
  let abriu = 0; global.window.open = () => { abriu++; return null; };
  const sessaoPc = Impressao.iniciar();
  assert.deepStrictEqual([sessaoPc.usaJanela, abriu, sessaoPc.cancelada()], [false, 0, false], 'computador: nenhuma aba é aberta');
  // celular com a aba bloqueada pelo navegador: devolve o botão
  trocarNavegador('Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile');
  const sessaoBloq = Impressao.iniciar();
  assert.strictEqual(abriu, 1, 'celular: tenta abrir a aba NO TOQUE (antes de qualquer espera)');
  assert.strictEqual(sessaoBloq.usaJanela, false);
  ok('computador x celular (inclui iPad), título e botão da aba, zoom só na tela, conteúdo intacto, aba bloqueada vira botão');
}

(async () => {
  console.log('== 4b. Celular: a aba recebe o documento pronto ==');
  const escritas = [];
  const janelaFalsa = { closed: false, document: { open() { escritas.push('open'); }, write(h) { escritas.push(h); }, close() { escritas.push('close'); }, getElementById: () => ({ style: {}, textContent: '' }) }, close() { this.closed = true; } };
  global.window.open = () => janelaFalsa;
  trocarNavegador('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1');
  const sessao = Impressao.iniciar();
  assert.strictEqual(sessao.usaJanela, true);
  assert.ok(/Preparando o PDF/.test(escritas[1]), 'a aba abre já com a tela de "Preparando"');
  sessao.progresso('Preparando a imagem 2 de 9...', 0.2);
  const r = await sessao.entregar('<html><head><title>t</title></head><body><section class="pagina">ok</section></body></html>', 'Projeto - PDF');
  assert.strictEqual(r.via, 'janela');
  assert.ok(escritas[escritas.length - 2].includes('class="pagina">ok') && escritas[escritas.length - 2].includes('id="rt-imprimir"'), 'o documento final é escrito na aba');
  janelaFalsa.closed = true;
  assert.strictEqual(sessao.cancelada(), true);
  await assert.rejects(sessao.entregar('<html><head></head><body></body></html>', 'x'), /aba do PDF foi fechada/, 'fechou a aba no meio: erro claro, sem escrever num lugar que não existe');
  ok('aba aberta no toque com "Preparando", progresso, documento final escrito nela, aba fechada = erro claro');

  console.log('== 5. Estrutura: scripts, ordem e ganchos ==');
  const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
  const orc = fs.readFileSync(path.join(pub, 'orcamentos.html'), 'utf8');
  const hub = fs.readFileSync(js('hub.js'), 'utf8');
  const main = fs.readFileSync(js('main.js'), 'utf8');
  const orcjs = fs.readFileSync(js('orcamentos.js'), 'utf8');
  const pdfjs = fs.readFileSync(js('pdf-cliente.js'), 'utf8');
  const css = fs.readFileSync(path.join(pub, 'assets/css/style.css'), 'utf8');
  const pos = (s, n) => s.indexOf(`src="assets/js/${n}"`);
  ['novidades.js', 'ajuda.js', 'impressao.js', 'memorial-doc.js'].forEach((n) => assert.ok(pos(html, n) > 0 && pos(html, n) < pos(html, 'hub.js'), `${n} carregado antes do hub.js`));
  assert.ok(pos(html, 'impressao.js') < pos(html, 'pdf-cliente.js'), 'impressao.js antes do pdf-cliente.js');
  assert.ok(pos(orc, 'novidades.js') > 0 && pos(orc, 'ajuda.js') > 0 && pos(orc, 'novidades.js') < pos(orc, 'orcamentos.js'), 'a página de orçamentos também carrega novidades e ajuda');
  const blocoNovidades = hub.slice(hub.indexOf('Novidades por aba'), hub.indexOf('Tema claro/escuro'));
  assert.ok(/galeriaAtual\.novidadesCliente/.test(blocoNovidades) && !/localStorage/.test(blocoNovidades) && /\/visto/.test(blocoNovidades) && /registrarVisto\(secaoAberta\)/.test(hub) && /registrarVisto\('criativo'\)/.test(hub) && /galeriaAtual\.modoEscritorio/.test(blocoNovidades), 'hub: novidades vêm do SERVIDOR (valem em qualquer aparelho e no modo escritório), abrir a aba avisa o servidor, o escritório só olha');
  assert.ok(/data-ir-inicio/.test(html) && (html.match(/data-ir-inicio/g) || []).length === 6 && /function irParaInicio/.test(hub), 'logo e nome do projeto (hub, galeria e planta) levam à tela inicial');
  assert.ok(/data-recolher/.test(hub) && /\.mem-setor\.recolhido \.mem-tabela\{ display:none !important; \}/.test(css) && /\.mem-tabela \.mem-foto\{ width:100%; height:min\(62vw, 300px\); \}/.test(css), 'memorial: título do setor recolhe; no celular a foto ocupa a largura do cartão');
  assert.ok(/contarSemCapa/.test(main) && /capasDeAmbiente/.test(hub), 'a capa do ambiente não conta como imagem a mais (igual ao PDF)');
  assert.ok(/data-card="\$\{esc\(id\)\}"/.test(hub) && /hub-bolinha/.test(hub) && /AjudaCliente\.htmlRodape/.test(hub), 'cartões com data-card, bolinha e rodapé do escritório');
  assert.ok(/\.hub-card\[data-card="memorial"\]\{ order:4; \}/.test(css) && /\.hub-card\[data-card="visitas"\]\{ order:5; \}/.test(css) && /@media \(max-width:519px\)/.test(css), 'celular: o Memorial fica logo abaixo do Projeto executivo');
  assert.ok(/MemorialDoc\.montarHtml/.test(hub) && /Impressao\.iniciar\(\)/.test(hub) && !/window\.print\(\)/.test(hub) && !/imprimindo-memorial/.test(hub + css), 'PDF do memorial: documento próprio pela impressao.js (sem imprimir a própria página)');
  assert.ok(/Impressao\.iniciar\(\)/.test(pdfjs) && /sessao\.entregar\(/.test(pdfjs) && !/function imprimir\(/.test(pdfjs), 'PDF das imagens usa a impressao.js');
  assert.ok(pdfjs.indexOf('Impressao.iniciar()') < pdfjs.indexOf('await prepararImagem') && pdfjs.indexOf('Impressao.iniciar()') < pdfjs.indexOf('await prepararLogo'), 'a aba do celular abre ANTES de qualquer espera (senão é bloqueada)');
  assert.ok(/iniciarAjuda\(galeria\)/.test(main) && /AjudaCliente\.iniciar/.test(orcjs), 'balão de ajuda iniciado nas duas páginas');
  ['radioPdfLogo', 'radioPdfIcone', 'radioPdfNenhuma', 'pdfMarca'].forEach((id) => assert.ok(html.includes(`id="${id}"`), id));
  assert.ok(/marca, fotoCapa, contatos: contatosParaOPdf\(g\), ambientes/.test(pdfjs) && /marcaEscolhida\(\)/.test(pdfjs), 'a marca escolhida, a foto da capa já tratada e os contatos do escritório vão pro gerador do PDF');
  assert.ok(/prepararFotoDaCapa/.test(pdfjs) && /logoEmBranco/.test(pdfjs) && /getImageData/.test(pdfjs), 'celular: capa em preto e branco com desfoque e logo em branco feitos no canvas (sem filtro CSS no papel)');
  assert.ok(/\.ajuda-botao\{[^}]*position:fixed; right:16px; bottom:16px; z-index:45/.test(css) && /\.visualizador\{[^}]*z-index:50/.test(css.replace(/\n/g, ' ')) || /position:fixed; inset:0; background:var\(--bg\); z-index:50/.test(css), 'o balão fica embaixo à direita e por baixo do visualizador de imagens');
  ok('scripts na ordem certa, ganchos ligados, memorial abaixo do executivo no celular, abas abertas antes de esperar');

  console.log('\nTODOS OS TESTES DA PÁGINA DO CLIENTE (NOVIDADES, AJUDA, IMPRESSÃO) PASSARAM');
})().catch((e) => { console.error('FALHOU:', e); process.exit(1); });
