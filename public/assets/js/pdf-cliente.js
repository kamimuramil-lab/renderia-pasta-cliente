// pdf-cliente.js -- botão "Baixar PDF" no topo da galeria e da planta (página do cliente).
//
// O cliente escolhe os ambientes e o app monta o MESMO PDF das imagens do RENDERIA (capa do projeto, capa de cada ambiente, uma
// página por imagem com a paleta de cores numa faixa vertical, "Projeto por: <escritório>", aviso de direitos autorais e a DATA
// E HORA da geração). Tudo acontece no navegador do cliente: baixa as imagens, tira a paleta, monta o HTML (imagens-pdf.js,
// o mesmo arquivo do app) e abre a janela de imprimir -- é só escolher "Salvar como PDF". Sem servidor, sem custo, sem I.A.
// Imagens 360° nunca entram (e a foto que serve de capa do ambiente não repete como página).
//
// Carregado DEPOIS do paleta-cores.js e do imagens-pdf.js e ANTES do main.js. Usa `estado` e `escapeHtml` só em tempo de chamada.
(function () {
  const $ = (id) => document.getElementById(id);
  let gerando = false;

  // ---------- quais imagens e ambientes entram ----------
  function ambientesDisponiveis() {
    const g = estado.galeria;
    if (!g) return [];
    const capas = new Set((g.categorias || []).map((c) => c.moodFotoId).filter(Boolean));
    const elegivel = (f) => f.tipo !== '360' && !f.arquivada && !capas.has(f.id);
    return (estado.categoriasOrdenadas || []).map((c, i) => ({ indice: i, nome: c.nome, capaUrl: c.moodUrl || null, fotos: (c.fotos || []).filter(elegivel) })).filter((a) => a.fotos.length);
  }

  // ---------- janela de escolha ----------
  function abrirModal() {
    const lista = ambientesDisponiveis();
    const caixa = $('pdfAmbientes');
    $('pdfMensagem').textContent = '';
    $('pdfProgresso').hidden = true;
    if (!lista.length) {
      caixa.innerHTML = '<div class="pdf-vazio">Ainda não há imagens (fora as de 360°) para gerar o PDF.</div>';
      $('btnGerarPdfCliente').disabled = true;
    } else {
      caixa.innerHTML = lista.map((a) => `<label class="pdf-linha"><input type="checkbox" data-ambiente="${a.indice}" checked><span class="pdf-nome">${escapeHtml(a.nome)}</span><span class="pdf-qtd">${a.fotos.length} ${a.fotos.length === 1 ? 'imagem' : 'imagens'}</span></label>`).join('');
      $('btnGerarPdfCliente').disabled = false;
    }
    $('modalPdfCliente').classList.remove('hidden');
  }
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
  async function prepararLogo(url) {
    const bmp = await carregarBitmap(url);
    const g = desenhar(bmp, 700);
    const d = g.ctx.getImageData(0, 0, g.canvas.width, g.canvas.height).data;
    let soma = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i + 3] > 128) { soma += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; n++; } }
    if (bmp.close) bmp.close();
    return { uri: g.canvas.toDataURL('image/png'), claro: n > 0 && soma / n > 200 };
  }

  // ---------- gerar ----------
  const dois = (n) => String(n).padStart(2, '0');
  function nomeDoArquivo(nomeProjeto, d) {
    return `${nomeProjeto} - Imagens do Projeto - ${dois(d.getDate())}-${dois(d.getMonth() + 1)}-${d.getFullYear()} ${dois(d.getHours())}h${dois(d.getMinutes())}`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function mostrarProgresso(texto, feito, total) {
    $('pdfProgresso').hidden = false;
    $('pdfProgressoTexto').textContent = texto;
    $('pdfProgressoBarra').style.width = total ? `${Math.round((feito / total) * 100)}%` : '0%';
  }

  async function gerar() {
    if (gerando) return;
    const marcados = [...$('pdfAmbientes').querySelectorAll('input[data-ambiente]:checked')].map((c) => Number(c.dataset.ambiente));
    const escolhidos = ambientesDisponiveis().filter((a) => marcados.includes(a.indice));
    if (!escolhidos.length) { $('pdfMensagem').textContent = 'Marque pelo menos um ambiente.'; return; }
    const mostrarNomes = $('chkPdfNomes').checked;
    const mostrarPaleta = $('chkPdfPaleta').checked;
    const total = escolhidos.reduce((s, a) => s + a.fotos.length, 0);
    gerando = true;
    $('btnGerarPdfCliente').disabled = true; $('btnCancelarPdfCliente').disabled = true;
    $('pdfMensagem').textContent = '';
    let feitas = 0, falhas = 0;
    try {
      const g = estado.galeria;
      const ambientes = [];
      for (const a of escolhidos) {
        let capa = null;
        if (a.capaUrl) { try { capa = (await prepararImagem(a.capaUrl, 2200, 0.9, false)).uri; } catch (e) { capa = null; } }
        const imagens = [];
        for (const f of a.fotos) {
          mostrarProgresso(`Preparando a imagem ${feitas + 1} de ${total}...`, feitas, total);
          try {
            const p = await prepararImagem(f.url, 2000, 0.88, mostrarPaleta);
            imagens.push({ id: f.id, nome: window.nomeParaCliente ? window.nomeParaCliente(f) : f.nomeExibicao, uri: p.uri, paleta: mostrarPaleta ? window.PaletaCores.paletaDominante(p.pixels, 5) : [] });
          } catch (e) { falhas++; }
          feitas++;
        }
        ambientes.push({ nome: a.nome, capa, imagens });
      }
      let logo = null, logoClaro = false;
      const urlLogo = g.marcaDagua && g.marcaDagua.ativa !== false ? g.marcaDagua.url : null;
      if (urlLogo) { try { const l = await prepararLogo(urlLogo); logo = l.uri; logoClaro = l.claro; } catch (e) { logo = null; } }
      mostrarProgresso('Montando o PDF...', total, total);
      const agora = new Date(); // o horário da geração: cada PDF baixado tem o seu
      const { html } = window.ImagensPdf.montarHtml({
        nomeProjeto: g.nomeProjeto, dadosProjeto: (g.hub && g.hub.dadosProjeto) || '', escritorio: g.nomeEscritorio || '',
        logo, logoClaro, ambientes, mostrarNomes, mostrarPaleta, agora
      });
      await imprimir(html, nomeDoArquivo(g.nomeProjeto, agora));
      $('pdfMensagem').textContent = falhas ? `${falhas} imagem(ns) não puderam ser carregadas e ficaram de fora.` : '';
      $('modalPdfCliente').classList.add('hidden');
    } catch (e) {
      $('pdfMensagem').textContent = e.message || 'Não consegui gerar o PDF.';
    } finally {
      gerando = false;
      $('btnGerarPdfCliente').disabled = false; $('btnCancelarPdfCliente').disabled = false;
      $('pdfProgresso').hidden = true;
    }
  }

  // Abre a janela de imprimir com o PDF montado num quadro escondido; o nome sugerido do arquivo vem do título da página.
  function imprimir(html, tituloArquivo) {
    return new Promise((resolve, reject) => {
      const quadro = document.createElement('iframe');
      quadro.setAttribute('aria-hidden', 'true');
      quadro.style.cssText = 'position:fixed; right:0; bottom:0; width:0; height:0; border:0; visibility:hidden;';
      const tituloAntes = document.title;
      const limpar = () => { document.title = tituloAntes; setTimeout(() => quadro.remove(), 500); };
      quadro.onload = async () => {
        try {
          const doc = quadro.contentDocument;
          await Promise.all([...doc.images].map((im) => (im.decode ? im.decode().catch(() => {}) : Promise.resolve())));
          document.title = tituloArquivo;
          quadro.contentWindow.addEventListener('afterprint', limpar, { once: true });
          setTimeout(limpar, 10 * 60 * 1000); // garantia
          quadro.contentWindow.focus();
          quadro.contentWindow.print();
          resolve();
        } catch (e) { limpar(); reject(new Error('Não consegui abrir a janela de impressão. Tente de novo.')); }
      };
      document.body.appendChild(quadro);
      quadro.srcdoc = html;
    });
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
