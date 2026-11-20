// pdf-cliente.js -- botão "Baixar PDF" no topo da galeria e da planta (página do cliente).
//
// O cliente escolhe os ambientes e o app monta o MESMO PDF das imagens do RENDERIA (capa do projeto, capa de cada ambiente, uma
// página por imagem com a paleta de cores numa faixa vertical, "Projeto por: <escritório>", aviso de direitos autorais e a DATA
// E HORA da geração). Tudo acontece no navegador do cliente: baixa as imagens, tira a paleta, monta o HTML (imagens-pdf.js,
// o mesmo arquivo do app) e abre a janela de imprimir -- é só escolher "Salvar como PDF". Sem servidor, sem custo, sem I.A.
// Imagens 360° nunca entram (e a foto que serve de capa do ambiente não repete como página).
//
// Entrega do PDF: impressao.js. No computador abre a janela de imprimir; no CELULAR abre uma aba nova com o PDF pronto e o
// botão "Salvar como PDF" (o quadro escondido que funcionava no computador não imprime no celular). Por isso o clique em
// "Gerar PDF" abre essa aba ANTES de baixar as imagens (senão o navegador do celular bloqueia a aba).
// Marca no canto da imagem: o cliente escolhe Logo, Ícone ou Nenhuma (o logo/ícone da empresa que o arquiteto configurou).
//
// Carregado DEPOIS do paleta-cores.js, do imagens-pdf.js e do impressao.js e ANTES do main.js. Usa `estado` e `escapeHtml` só em tempo de chamada.
(function () {
  const $ = (id) => document.getElementById(id);
  let gerando = false;

  // ---------- quais imagens e ambientes entram ----------
  function ambientesDisponiveis() {
    const g = estado.galeria;
    if (!g) return [];
    const capas = new Set((g.categorias || []).map((c) => c.moodFotoId).filter(Boolean));
    const elegivel = (f) => f.tipo !== '360' && !f.arquivada && !capas.has(f.id);
    const lista = (estado.categoriasOrdenadas || []).map((c, i) => ({ indice: i, nome: c.nome, capaUrl: c.moodUrl || null, fotos: (c.fotos || []).filter(elegivel) }));
    // foto que não caiu em nenhum ambiente listado (ex.: ambiente apagado) também entra, em "Outras imagens"
    const listadas = new Set((estado.categoriasOrdenadas || []).flatMap((c) => (c.fotos || []).map((x) => x.id)));
    const soltas = (g.fotos || []).filter((f) => !listadas.has(f.id) && elegivel(f));
    if (soltas.length) lista.push({ indice: lista.length, nome: 'Outras imagens', capaUrl: null, fotos: soltas });
    return lista.filter((a) => a.fotos.length);
  }
  // Por que não há nada pra gerar? Conta onde estão as imagens do projeto (ajuda a achar o motivo quando a mensagem aparece).
  function motivoDoVazio() {
    const g = estado.galeria;
    if (!g) return 'A galeria ainda não carregou. Atualize a página e tente de novo.';
    const todas = g.fotos || [];
    const capas = new Set((g.categorias || []).map((c) => c.moodFotoId).filter(Boolean));
    const n360 = todas.filter((f) => f.tipo === '360').length, arq = todas.filter((f) => f.arquivada).length, nCapa = todas.filter((f) => capas.has(f.id) && f.tipo !== '360' && !f.arquivada).length;
    return 'Ainda não há imagens (fora as de 360°) para gerar o PDF. No projeto há ' + todas.length + ' imagem(ns): ' + n360 + ' em 360°, ' + arq + ' arquivada(s) e ' + nCapa + ' usada(s) como capa de ambiente (a capa não se repete como página).';
  }

  // ---------- janela de escolha ----------
  function abrirModal() {
    const lista = ambientesDisponiveis();
    const caixa = $('pdfAmbientes');
    $('pdfMensagem').textContent = '';
    $('pdfProgresso').hidden = true;
    if (!lista.length) {
      caixa.innerHTML = '<div class="pdf-vazio">' + escapeHtml(motivoDoVazio()) + '</div>';
      $('btnGerarPdfCliente').disabled = true;
    } else {
      caixa.innerHTML = lista.map((a) => `<label class="pdf-linha"><input type="checkbox" data-ambiente="${a.indice}" checked><span class="pdf-nome">${escapeHtml(a.nome)}</span><span class="pdf-qtd">${a.fotos.length} ${a.fotos.length === 1 ? 'imagem' : 'imagens'}</span></label>`).join('');
      $('btnGerarPdfCliente').disabled = false;
    }
    prepararOpcoesDeMarca();
    $('modalPdfCliente').classList.remove('hidden');
  }
  // Logo / ícone / nenhuma: só liga a opção que existe. Padrão = o que o cliente já vê nas imagens (o logo, senão o ícone, senão nada).
  const urlDaMarca = (tipo) => {
    const g = estado.galeria || {};
    if (tipo === 'logo') return (g.marcaDagua && g.marcaDagua.url) || null;
    return (g.iconePersonalizado && (g.iconePersonalizado.urlArquivo || g.iconePersonalizado.url)) || null;
  };
  function prepararOpcoesDeMarca() {
    const temLogo = !!urlDaMarca('logo'), temIcone = !!urlDaMarca('icone');
    $('radioPdfLogo').disabled = !temLogo; $('radioPdfIcone').disabled = !temIcone;
    $('pdfMarca').hidden = !temLogo && !temIcone; // sem logo nem ícone cadastrados não há o que escolher
    const escolha = temLogo ? 'logo' : (temIcone ? 'icone' : 'nenhuma');
    ['logo', 'icone', 'nenhuma'].forEach((v) => { const r = document.querySelector('input[name="pdfMarca"][value="' + v + '"]'); if (r) r.checked = (v === escolha); });
  }
  const marcaEscolhida = () => { const r = document.querySelector('input[name="pdfMarca"]:checked'); return r ? r.value : 'nenhuma'; };
  function fecharModal() { if (!gerando) $('modalPdfCliente').classList.add('hidden'); }

  // ---------- preparar imagens (no navegador) ----------
  // fetch com cache desligado: a mesma imagem já foi mostrada na galeria SEM CORS, e o navegador reaproveitaria essa cópia
  // (que não pode ser lida pelo canvas). O arquivo vem como blob: o canvas nunca fica "contaminado".
  async function carregarBitmap(url) {
    const resp = await fetch(url, { mode: 'cors', cache: 'no-store' });
    if (!resp.ok) throw new Error('imagem indisponível');
    const blob = await resp.blob();
    if (window.createImageBitmap) return createImageBitmap(blob);
    const obj = URL.createObjectURL(blob);
    try {
      return await new Promise((ok, erro) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => erro(new Error('imagem inválida')); im.src = obj; });
    } finally { setTimeout(() => URL.revokeObjectURL(obj), 5000); }
  }
  function desenhar(bitmap, ladoMax) {
    const w = bitmap.width, h = bitmap.height;
    const f = Math.min(1, ladoMax / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * f)); c.height = Math.max(1, Math.round(h * f));
    const ctx = c.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, c.width, c.height);
    return { canvas: c, ctx };
  }
  // -> { uri (JPEG), pixels (RGBA de uma versão pequena, pra paleta) }
  async function prepararImagem(url, ladoMax, qualidade, comPaleta) {
    const bmp = await carregarBitmap(url);
    const grande = desenhar(bmp, ladoMax);
    const uri = grande.canvas.toDataURL('image/jpeg', qualidade);
    let pixels = null;
    if (comPaleta) { const peq = desenhar(bmp, 80); pixels = peq.ctx.getImageData(0, 0, peq.canvas.width, peq.canvas.height).data; }
    if (bmp.close) bmp.close();
    return { uri, pixels };
  }
  // Logo: fica em PNG (fundo transparente) e diz se é claro (aí a capa do PDF fica escura, senão o logo some no papel branco).
  async function prepararLogo(url, ladoMax) {
    const bmp = await carregarBitmap(url);
    const g = desenhar(bmp, ladoMax || 700);
    const d = g.ctx.getImageData(0, 0, g.canvas.width, g.canvas.height).data;
    let soma = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i + 3] > 128) { soma += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; n++; } }
    if (bmp.close) bmp.close();
    return { uri: g.canvas.toDataURL('image/png'), claro: n > 0 && soma / n > 200 };
  }

  // Capa e logo SEM filtro CSS: o celular tem dificuldade em imprimir/mostrar `filter` (blur, invert) em imagens grandes. Aqui o preto e
  // branco + desfoque leve da foto da capa e o logo em branco são feitos no próprio desenho (canvas), e o PDF recebe imagens prontas.
  const imagemDeUri = (uri) => new Promise((ok, erro) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => erro(new Error('imagem inválida')); im.src = uri; });
  async function prepararFotoDaCapa(uri) {
    const im = await imagemDeUri(uri);
    const { canvas, ctx } = desenhar(im, 1100);
    const dados = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = dados.data;
    for (let i = 0; i < d.length; i += 4) { const y = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]); d[i] = d[i + 1] = d[i + 2] = y; }
    ctx.putImageData(dados, 0, 0);
    const pequeno = document.createElement('canvas'); // desfoque leve: encolhe e amplia de volta
    pequeno.width = Math.max(1, Math.round(canvas.width / 4)); pequeno.height = Math.max(1, Math.round(canvas.height / 4));
    const pc = pequeno.getContext('2d'); pc.imageSmoothingEnabled = true; pc.imageSmoothingQuality = 'high'; pc.drawImage(canvas, 0, 0, pequeno.width, pequeno.height);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(pequeno, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  }
  async function logoEmBranco(uri) {
    const im = await imagemDeUri(uri);
    const c = document.createElement('canvas'); c.width = im.naturalWidth || im.width; c.height = im.naturalHeight || im.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(im, 0, 0);
    ctx.globalCompositeOperation = 'source-in'; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height); // só onde havia logo (o fundo transparente continua)
    return c.toDataURL('image/png');
  }
  // Dados do escritório já formatados pra ler (página final "MUITO OBRIGADO!"): WhatsApp (11) 98380-0042, e-mail, @instagram.
  function contatosParaOPdf(g) {
    const A = window.AjudaCliente;
    const c = A ? A.contatosValidos(g.contatosEscritorio) : {};
    return { whatsapp: c.whatsapp && A ? A.formatarWhatsapp(c.whatsapp) : '', email: c.email || '', instagram: c.instagram ? '@' + c.instagram : '' };
  }

  // ---------- gerar ----------
  const dois = (n) => String(n).padStart(2, '0');
  function nomeDoArquivo(nomeProjeto, d) {
    return `${nomeProjeto} - Imagens do Projeto - ${dois(d.getDate())}-${dois(d.getMonth() + 1)}-${d.getFullYear()} ${dois(d.getHours())}h${dois(d.getMinutes())}`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function mostrarProgresso(texto, feito, total, sessao) {
    $('pdfProgresso').hidden = false;
    $('pdfProgressoTexto').textContent = texto;
    $('pdfProgressoBarra').style.width = total ? `${Math.round((feito / total) * 100)}%` : '0%';
    if (sessao) sessao.progresso(texto, total ? feito / total : 0); // a aba do PDF (celular) mostra o mesmo andamento
  }

  async function gerar() {
    if (gerando) return;
    const marcados = [...$('pdfAmbientes').querySelectorAll('input[data-ambiente]:checked')].map((c) => Number(c.dataset.ambiente));
    const escolhidos = ambientesDisponiveis().filter((a) => marcados.includes(a.indice));
    if (!escolhidos.length) { $('pdfMensagem').textContent = 'Marque pelo menos um ambiente.'; return; }
    const mostrarNomes = $('chkPdfNomes').checked;
    const mostrarPaleta = $('chkPdfPaleta').checked;
    const total = escolhidos.reduce((s, a) => s + a.fotos.length, 0);
    const sessao = window.Impressao.iniciar(); // NO TOQUE: no celular abre a aba do PDF agora (depois o navegador bloquearia)
    // No celular as imagens vão menores (1500 px, JPEG 0,8: ~3x mais leve): o aparelho monta e imprime o PDF bem mais rápido. A foto do PDF no computador continua em 2000 px.
    const ladoMaximo = sessao.celular ? 1500 : 2000, qualidadeJpeg = sessao.celular ? 0.8 : 0.88;
    gerando = true;
    $('btnGerarPdfCliente').disabled = true; $('btnCancelarPdfCliente').disabled = true;
    $('pdfMensagem').textContent = '';
    let feitas = 0, falhas = 0;
    try {
      const g = estado.galeria;
      const ambientes = [];
      for (const a of escolhidos) {
        let capa = null;
        if (a.capaUrl) { try { capa = (await prepararImagem(a.capaUrl, sessao.celular ? 1600 : 2200, sessao.celular ? 0.8 : 0.9, false)).uri; } catch (e) { capa = null; } }
        const imagens = [];
        for (const f of a.fotos) {
          if (sessao.cancelada()) throw new Error('A aba do PDF foi fechada. Toque em Gerar PDF de novo.');
          mostrarProgresso(`Preparando a imagem ${feitas + 1} de ${total}...`, feitas, total, sessao);
          try {
            const p = await prepararImagem(f.url, ladoMaximo, qualidadeJpeg, mostrarPaleta);
            imagens.push({ id: f.id, nome: window.nomeParaCliente ? window.nomeParaCliente(f) : f.nomeExibicao, uri: p.uri, paleta: mostrarPaleta ? window.PaletaCores.paletaDominante(p.pixels, 5) : [] });
          } catch (e) { falhas++; }
          feitas++;
        }
        ambientes.push({ nome: a.nome, capa, imagens });
      }
      let logo = null, logoClaro = false;
      const urlLogo = g.marcaDagua && g.marcaDagua.ativa !== false ? g.marcaDagua.url : null;
      if (urlLogo) { try { const l = await prepararLogo(urlLogo); logo = l.claro ? l.uri : await logoEmBranco(l.uri); logoClaro = true; } catch (e) { logo = null; logoClaro = false; } } // a capa é escura: o logo já vai claro (sem filtro CSS)
      let fotoCapa = null;
      const primeira = ambientes[0] && ambientes[0].imagens[0];
      if (primeira) { try { fotoCapa = await prepararFotoDaCapa(primeira.uri); } catch (e) { fotoCapa = null; } } // sem ela, o imagens-pdf usa a 1ª imagem com filtro CSS
      // marca pequena no canto superior direito de cada imagem (logo ou ícone, a escolha do cliente no PDF)
      let marca = null;
      const tipoMarca = marcaEscolhida();
      if (tipoMarca !== 'nenhuma' && urlDaMarca(tipoMarca)) { try { marca = (await prepararLogo(urlDaMarca(tipoMarca), 400)).uri; } catch (e) { marca = null; } }
      mostrarProgresso('Montando o PDF...', total, total, sessao);
      const agora = new Date(); // o horário da geração: cada PDF baixado tem o seu
      const { html } = window.ImagensPdf.montarHtml({
        nomeProjeto: g.nomeProjeto, dadosProjeto: (g.hub && g.hub.dadosProjeto) || '', escritorio: g.nomeEscritorio || '',
        logo, logoClaro, marca, fotoCapa, contatos: contatosParaOPdf(g), ambientes, mostrarNomes, mostrarPaleta, agora
      });
      const aviso = falhas ? `${falhas} imagem(ns) não puderam ser carregadas e ficaram de fora do PDF.` : '';
      const entrega = await sessao.entregar(html, nomeDoArquivo(g.nomeProjeto, agora), { aviso }); // o aviso também aparece na aba do PDF (o painel some)
      if (entrega.via === 'toque') {
        // celular com a aba bloqueada pelo navegador: um botão (o toque libera a abertura)
        const caixa = $('pdfMensagem');
        caixa.textContent = 'O PDF está pronto. ' + aviso + ' ';
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'dash-btn-pri'; b.textContent = 'Abrir o PDF';
        b.addEventListener('click', () => { try { entrega.abrir(); $('modalPdfCliente').classList.add('hidden'); } catch (e) { caixa.textContent = e.message; } });
        caixa.appendChild(b);
      } else {
        $('pdfMensagem').textContent = aviso;
        $('modalPdfCliente').classList.add('hidden');
      }
    } catch (e) {
      sessao.fechar();
      $('pdfMensagem').textContent = e.message || 'Não consegui gerar o PDF.';
    } finally {
      gerando = false;
      $('btnGerarPdfCliente').disabled = false; $('btnCancelarPdfCliente').disabled = false;
      $('pdfProgresso').hidden = true;
    }
  }

  // ---------- ligações ----------
  function ligar() {
    ['btnPdfGaleria', 'btnPdfPlanta'].forEach((id) => { if ($(id)) $(id).addEventListener('click', abrirModal); });
    $('btnGerarPdfCliente').addEventListener('click', gerar);
    $('btnCancelarPdfCliente').addEventListener('click', fecharModal);
    $('btnFecharPdfCliente').addEventListener('click', fecharModal);
    $('pdfTodos').addEventListener('click', () => $('pdfAmbientes').querySelectorAll('input[data-ambiente]').forEach((c) => { c.checked = true; }));
    $('pdfNenhum').addEventListener('click', () => $('pdfAmbientes').querySelectorAll('input[data-ambiente]').forEach((c) => { c.checked = false; }));
    $('modalPdfCliente').addEventListener('click', (e) => { if (e.target === $('modalPdfCliente')) fecharModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('modalPdfCliente').classList.contains('hidden')) fecharModal(); });
  }
  document.addEventListener('DOMContentLoaded', ligar);

  window.PdfCliente = { abrirModal, ambientesDisponiveis };
})();
