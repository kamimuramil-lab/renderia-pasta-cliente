// Hub do cliente (nov/2026): primeira tela do projeto quando o arquiteto montou conteúdo de hub (dados do projeto,
// documentos ou capa). Projeto SEM conteúdo de hub abre direto a galeria/planta, como sempre foi.
// Usa `estado`, `escapeHtml`, `mostrarTelaGaleriaDaPlanta` do main.js (carregado depois; só chamados em clique/entrada).
// Os links externos (Tour virtual, Dashboard) continuam no modelo de dados, mas NÃO aparecem aqui por decisão do Rodrigo:
// o tour 360° agora faz parte do "Projeto criativo" (a pasta do cliente que mostra planta, imagens e 360° sem link externo).
(function () {
  const ICONES = {
    planta_original: 'M3 3h18v18H3zM9 3v8h12M9 11v10',
    conceitual: 'M12 3l9 6-9 6-9-6zM3 15l9 6 9-6',
    criativo: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
    executivo: 'M3 17L17 3l4 4L7 21H3zM14 6l4 4',
    visitas: 'M4 7h3l2-3h6l2 3h3v13H4zM12 17a4 4 0 100-8 4 4 0 000 8z',
    memorial: 'M4 4h16v16H4zM4 10h16M4 15h16M10 10v10'
  };
  const TITULOS = { planta_original: 'Planta original', conceitual: 'Projeto conceitual', executivo: 'Projeto executivo', visitas: 'Fotos' };
  const ROTULO_STATUS = { ATUAL: 'ATUAL', REVISAO: 'REVISÃO', ANTIGA: 'ANTIGA' };
  const CHAVE_TEMA = 'renderia_tema_hub';
  const ICONE_SOL = 'M12 17a5 5 0 100-10 5 5 0 000 10zM12 1v3M12 20v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M1 12h3M20 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1';
  const ICONE_LUA = 'M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z';

  let galeriaAtual = null;
  let secaoAberta = null; // null = tela inicial do hub

  const el = (id) => document.getElementById(id);
  const esc = (s) => escapeHtml(String(s == null ? '' : s));
  const svg = (d, tam) => `<svg width="${tam || 22}" height="${tam || 22}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;

  // Só deixa passar http/https (a validação principal é no servidor; aqui é a segunda camada).
  function hrefSeguro(url) {
    try { const u = new URL(url); return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : null; } catch (e) { return null; }
  }

  function hubDe(galeria) { return (galeria && galeria.hub) || { dadosProjeto: '', links: {}, gruposExecutivo: [], documentos: [] }; }
  function documentosDaSecao(galeria, secao) { return hubDe(galeria).documentos.filter((d) => d.secao === secao); }
  function fotosValidas(galeria) { return (galeria.fotos || []).filter((f) => !f.arquivada); }

  // Tem hub quando há dados do projeto, documentos ou capa. Só links não conta (eles não aparecem aqui).
  function temConteudo(galeria) {
    const h = hubDe(galeria);
    return !!(h.dadosProjeto || (h.documentos && h.documentos.length) || h.capaFotoId || memorialDe(galeria).itens.length);
  }

  // ---------- Tema claro/escuro: segue o aparelho; o botão do topo troca e fica lembrado neste dispositivo ----------
  function lerTemaSalvo() { try { const t = localStorage.getItem(CHAVE_TEMA); return (t === 'claro' || t === 'escuro') ? t : null; } catch (e) { return null; } }
  function salvarTema(t) { try { localStorage.setItem(CHAVE_TEMA, t); } catch (e) { /* sem armazenamento: vale só nesta visita */ } }
  const aparelhoClaro = () => !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
  const temaEfetivo = () => lerTemaSalvo() || (aparelhoClaro() ? 'claro' : 'escuro');
  // O tema vale pra página toda (login, hub, galeria, planta) e os botões sol/lua ficam em cada topo (.btn-tema).
  function aplicarTema() {
    const salvo = lerTemaSalvo();
    if (salvo) document.body.dataset.tema = salvo; else delete document.body.dataset.tema;
    const claro = temaEfetivo() === 'claro';
    document.querySelectorAll('.btn-tema').forEach((b) => {
      b.innerHTML = svg(claro ? ICONE_LUA : ICONE_SOL, 18); // mostra pra onde vai trocar
      b.title = claro ? 'Mudar para o tema escuro' : 'Mudar para o tema claro';
    });
  }
  document.querySelectorAll('.btn-tema').forEach((b) => b.addEventListener('click', () => { salvarTema(temaEfetivo() === 'claro' ? 'escuro' : 'claro'); aplicarTema(); }));
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    (mq.addEventListener ? mq.addEventListener.bind(mq, 'change') : mq.addListener.bind(mq))(aplicarTema);
  }
  aplicarTema(); // já na abertura: aplica a escolha lembrada (o login também segue o tema)

  // ---------- Tela inicial: capa + dados do projeto + cartões ----------
  function capaHtml(g) {
    const h = hubDe(g);
    const logoUrl = g.marcaDagua && g.marcaDagua.url && g.marcaDagua.ativa !== false ? g.marcaDagua.url : null; // o logo das configurações do RENDERIA (respeita "Exibir logo" do projeto)
    return `<div class="hub-capa ${h.capaUrl ? 'com-foto' : ''}">
      ${h.capaUrl ? `<img class="hub-capa-img" src="${esc(h.capaUrl)}" alt="">` : ''}
      ${logoUrl ? `<img class="hub-capa-logo" src="${esc(logoUrl)}" alt="">` : ''}
      <div class="hub-capa-conteudo">
        <div class="hub-capa-titulo">${esc(g.nomeProjeto)}</div>
      </div>
    </div>`;
  }

  // Cartão sem nada dentro fica apagado e sem clique (aria-disabled), em vez de sumir.
  function cartao({ icone, titulo, detalhe, acao, ativo }) {
    const corpo = `<span class="hub-card-icone">${svg(icone)}</span><span class="hub-card-titulo">${esc(titulo)}</span><span class="hub-card-detalhe">${esc(detalhe)}</span>`;
    if (!ativo) return `<div class="hub-card desabilitado" aria-disabled="true">${corpo}</div>`;
    return `<button class="hub-card" data-hub-acao="${esc(acao)}">${corpo}</button>`;
  }

  function renderizarInicio() {
    const g = galeriaAtual;
    const h = hubDe(g);
    const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
    const cartoes = [];
    ['planta_original', 'conceitual'].forEach((id) => {
      const n = documentosDaSecao(g, id).length;
      cartoes.push(cartao({ icone: ICONES[id], titulo: TITULOS[id], ativo: n > 0, acao: 'secao:' + id, detalhe: n ? plural(n, 'documento', 'documentos') : 'Em breve' }));
    });
    // Projeto criativo = a pasta do cliente de sempre: planta com ícones, imagens e 360°, tudo dentro do RENDERIA.
    const validas = fotosValidas(g);
    const n360 = validas.filter((f) => f.tipo === '360').length;
    const aprov = validas.filter((f) => f.aprovada).length;
    const partes = [plural(validas.length - n360, 'imagem', 'imagens')];
    if (n360) partes.push(`${n360} em 360°`);
    cartoes.push(cartao({ icone: ICONES.criativo, titulo: 'Projeto criativo', ativo: validas.length > 0, acao: 'criativo',
      detalhe: validas.length ? `${partes.join(' · ')} · ${aprov} aprovada${aprov === 1 ? '' : 's'}` : 'Em breve' }));
    ['executivo', 'visitas'].forEach((id) => {
      const n = documentosDaSecao(g, id).filter((d) => d.status !== 'ANTIGA').length;
      const total = documentosDaSecao(g, id).length;
      cartoes.push(cartao({ icone: ICONES[id], titulo: TITULOS[id], ativo: total > 0, acao: 'secao:' + id, detalhe: total ? plural(n, 'documento', 'documentos') : 'Em breve' }));
    });
    // Memorial de itens: só entra quando o servidor mandou o recurso (memorial vem vazio pra quem não tem; aí o cartão nem aparece).
    const nMem = memorialDe(g).itens.length;
    if (nMem > 0) cartoes.push(cartao({ icone: ICONES.memorial, titulo: 'Memorial de itens', ativo: true, acao: 'secao:memorial', detalhe: plural(nMem, 'item', 'itens') }));

    el('hubConteudo').innerHTML = `${capaHtml(g)}
      <div class="hub-corpo">
        ${h.dadosProjeto ? `<div class="hub-dados">${window.DadosProjeto ? window.DadosProjeto.htmlDosDados(h.dadosProjeto, esc) : esc(h.dadosProjeto)}</div>` : ''}
        <div class="hub-grid">${cartoes.join('')}</div>
      </div>`;
    el('hubConteudo').querySelectorAll('[data-hub-acao]').forEach((b) => b.addEventListener('click', () => executarAcao(b.dataset.hubAcao)));
  }

  function executarAcao(acao) {
    if (acao === 'criativo') {
      fechar();
      if (window.PlantaCliente && window.PlantaCliente.temPlantaUtil(galeriaAtual)) window.PlantaCliente.abrir();
      else mostrarTelaGaleriaDaPlanta();
      return;
    }
    if (acao.startsWith('secao:')) { secaoAberta = acao.slice(6); renderizar(); window.scrollTo(0, 0); }
  }

  // ---------- Lista de documentos de uma seção ----------
  function linhaDocumento(d) {
    const href = hrefSeguro(d.url);
    const status = ROTULO_STATUS[d.status] || d.status;
    return `<div class="hub-doc status-${esc(String(d.status).toLowerCase())}">
      <div class="hub-doc-info">
        <div class="hub-doc-titulo">${esc(d.titulo)}</div>
        <div class="hub-doc-meta">
          ${d.pavimento ? `<span>${esc(d.pavimento)}</span>` : ''}
          <span>REV.${esc(d.revisao)}</span>
          <span class="hub-selo hub-selo-${esc(String(d.status).toLowerCase())}">${esc(status)}</span>
        </div>
        ${d.observacao ? `<div class="hub-doc-obs">${esc(d.observacao)}</div>` : ''}
      </div>
      ${href ? `<a class="hub-doc-abrir" data-status="${esc(d.status)}" href="${esc(href)}" target="_blank" rel="noopener noreferrer">Abrir ↗</a>` : ''}
    </div>`;
  }

  // ATUAL primeiro, depois REVISÃO; ANTIGA fica recolhida pra ninguém usar sem querer.
  function blocoDocumentos(docs) {
    const ordem = { ATUAL: 0, REVISAO: 1, ANTIGA: 2 };
    const porNome = (a, b) => (a.pavimento || '').localeCompare(b.pavimento || '', 'pt-BR') || a.titulo.localeCompare(b.titulo, 'pt-BR');
    // Ordem escolhida pelo arquiteto (setinhas ▲▼ no app) vale primeiro; o que ainda não tem ordem segue a de sempre.
    const posicao = (d) => (typeof d.ordem === 'number' ? d.ordem : 1e9);
    const vigentes = docs.filter((d) => d.status !== 'ANTIGA').sort((a, b) => (posicao(a) - posicao(b)) || (ordem[a.status] - ordem[b.status]) || porNome(a, b));
    const antigas = docs.filter((d) => d.status === 'ANTIGA').sort((a, b) => (posicao(a) - posicao(b)) || b.revisao - a.revisao || porNome(a, b));
    return `${vigentes.map(linhaDocumento).join('')}
      ${antigas.length ? `<details class="hub-antigas"><summary>Versões antigas (${antigas.length}) — não usar para execução</summary>${antigas.map(linhaDocumento).join('')}</details>` : ''}`;
  }

  // ---------- Memorial de itens: uma tabela por setor, com a foto do produto (sem valores; isso nunca chega aqui) ----------
  function memorialDe(galeria) { return (galeria && galeria.memorial && Array.isArray(galeria.memorial.itens)) ? galeria.memorial : { itens: [], setores: [] }; }

  function linhaMemorial(i) {
    const href = i.link ? hrefSeguro(i.link) : null;
    const foto = i.fotoUrl ? `<button class="mem-foto" data-mem-foto="${esc(i.fotoUrl)}" title="Ampliar"><img src="${esc(i.fotoUrl)}" alt="${esc(i.item)}" loading="lazy"></button>` : '<span class="mem-sem-foto">—</span>';
    const selo = ''; // o memorial não mostra status
    const amb = (i.ambientes || []).map((a) => `<span class="mem-amb">${esc(a)}</span>`).join('') || '—';
    return `<tr>
      <td data-rotulo="Nº">${esc(i.numero)}</td>
      <td data-rotulo="Foto" class="mem-col-foto">${foto}</td>
      <td data-rotulo="Item" class="mem-col-item"><b>${esc(i.item)}</b>${selo}${href ? `<br><a href="${esc(href)}" target="_blank" rel="noopener noreferrer">Ver produto ↗</a>` : ''}</td>
      <td data-rotulo="Ambiente">${amb}</td>
      <td data-rotulo="Empresa">${esc(i.empresa) || '—'}</td>
      <td data-rotulo="Especificações" class="mem-texto">${esc(i.especificacoes) || '—'}</td>
      <td data-rotulo="Dimensões" class="mem-texto">${esc(i.dimensoes) || '—'}</td>
      <td data-rotulo="Qtd.">${esc(i.quantidade) || '—'}</td>
    </tr>`;
  }

  function ampliarFotoMemorial(url) {
    const fundo = document.createElement('div');
    fundo.className = 'mem-ampliada';
    fundo.innerHTML = `<img src="${esc(url)}" alt="">`;
    const fechar = () => { fundo.remove(); document.removeEventListener('keydown', aoTecla); };
    const aoTecla = (e) => { if (e.key === 'Escape') fechar(); };
    fundo.addEventListener('click', fechar);
    document.addEventListener('keydown', aoTecla);
    document.body.appendChild(fundo);
  }

  function renderizarMemorial() {
    const m = memorialDe(galeriaAtual);
    const setores = [...(m.setores || [])];
    m.itens.forEach((i) => { if (!setores.includes(i.setor)) setores.push(i.setor); });
    const blocos = setores.map((setor) => {
      const doSetor = m.itens.filter((i) => i.setor === setor);
      if (!doSetor.length) return '';
      return `<section class="hub-grupo mem-setor" data-setor="${esc(setor)}"><h2>${esc(setor)} <span class="mem-contagem">${doSetor.length}</span></h2>
        <table class="mem-tabela"><thead><tr><th>Nº</th><th>Foto</th><th>Item</th><th>Ambiente</th><th>Empresa</th><th>Especificações</th><th>Dimensões</th><th>Qtd.</th></tr></thead>
        <tbody>${doSetor.map(linhaMemorial).join('')}</tbody></table></section>`;
    }).join('');
    const opcoesSetor = setores.filter((s) => m.itens.some((i) => i.setor === s)).map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
    const logoMem = galeriaAtual.marcaDagua && galeriaAtual.marcaDagua.url && galeriaAtual.marcaDagua.ativa !== false ? galeriaAtual.marcaDagua.url : null;
    el('hubConteudo').innerHTML = `<div class="hub-corpo">
      <div class="mem-impressao-cabecalho">${logoMem ? `<img src="${esc(logoMem)}" alt="">` : ''}<div><div class="mem-imp-titulo">MEMORIAL DE ITENS</div><div class="mem-imp-projeto">${esc(galeriaAtual.nomeProjeto)}</div><div class="mem-imp-data">${esc(new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }))}</div></div></div>
      <div class="mem-barra"><h2 class="hub-titulo-secao">Memorial de itens</h2>
        <div class="mem-acoes"><select id="selSetorMemorialCliente" aria-label="Setor"><option value="">Todos os setores</option>${opcoesSetor}</select><button class="hub-doc-abrir" id="btnPdfMemorialCliente" type="button">Gerar PDF</button></div></div>
      <div class="hub-aviso"><b>ATENÇÃO</b><br>Valide cada item com o fornecedor e com a arquitetura antes da compra: medidas, modelos e acabamentos podem variar conforme a marca/modelo adquirido ou a etapa de instalação.</div>${blocos}</div>`;
    el('hubConteudo').querySelectorAll('[data-mem-foto]').forEach((b) => b.addEventListener('click', () => ampliarFotoMemorial(b.dataset.memFoto)));
    el('btnPdfMemorialCliente').addEventListener('click', gerarPdfMemorialCliente);
    el('selSetorMemorialCliente').addEventListener('change', aplicarFiltroSetorMemorial);
  }

  // PDF do memorial pelo próprio navegador (sem servidor, sem custo): mostra só o setor escolhido, abre a janela de imprimir
  // ("Salvar como PDF") em A4 paisagem e depois devolve a tela como estava.
  // O filtro vale na tela E no PDF: mostra só o setor escolhido (ou todos).
  function aplicarFiltroSetorMemorial() {
    const setor = el('selSetorMemorialCliente').value;
    document.querySelectorAll('.mem-setor').forEach((s) => s.classList.toggle('mem-oculto', !!setor && s.dataset.setor !== setor));
  }

  function gerarPdfMemorialCliente() {
    const setor = el('selSetorMemorialCliente').value;
    aplicarFiltroSetorMemorial();
    document.body.classList.add('imprimindo-memorial');
    const nomeAntes = document.title;
    const hoje = new Date().toLocaleDateString('pt-BR').split('/').join('-');
    document.title = `${galeriaAtual.nomeProjeto} - Memorial de itens${setor ? ' - ' + setor : ''} - ${hoje}`; // vira o nome sugerido do arquivo
    const limpar = () => { document.body.classList.remove('imprimindo-memorial'); document.title = nomeAntes; window.removeEventListener('afterprint', limpar); };
    window.addEventListener('afterprint', limpar);
    setTimeout(() => { window.print(); }, 150);
  }

  function renderizarSecao() {
    if (secaoAberta === 'memorial') { renderizarMemorial(); return; }
    const docs = documentosDaSecao(galeriaAtual, secaoAberta);
    let corpo;
    if (secaoAberta === 'executivo') {
      const h = hubDe(galeriaAtual);
      const base = [...(h.gruposExecutivo || [])];
      const nomes = [];
      const extras = [];
      docs.forEach((d) => { if (d.grupo && !base.some((n) => n.toLowerCase() === d.grupo.toLowerCase()) && !extras.some((n) => n.toLowerCase() === d.grupo.toLowerCase())) extras.push(d.grupo); }); // combinada ("A + B") ou grupo renomeado/removido: não some do cliente
      base.forEach((n) => { nomes.push(n); extras.filter((e) => e.split(' + ')[0].trim().toLowerCase() === n.toLowerCase()).forEach((e) => nomes.push(e)); });
      extras.forEach((e) => { if (!nomes.includes(e)) nomes.push(e); });
      // ordem manual das categorias (setinhas no app) vale por cima; as que não estão nela ficam no fim, na ordem de antes
      const ordemManual = Array.isArray(h.ordemGrupos) ? h.ordemGrupos.map((n) => n.toLowerCase()) : [];
      if (ordemManual.length) {
        const pos = (n) => ordemManual.indexOf(n.toLowerCase());
        nomes.splice(0, nomes.length, ...nomes.filter((n) => pos(n) >= 0).sort((a, b) => pos(a) - pos(b)), ...nomes.filter((n) => pos(n) < 0));
      }
      corpo =`<div class="hub-aviso"><b>ATENÇÃO</b><br>Use somente o arquivo com status <b class="hub-ok">ATUAL</b>. Arquivos em <b class="hub-alerta">REVISÃO</b> ou <b class="hub-alerta">ANTIGA</b> não devem ser usados para a execução. Se o projeto já estiver com algum fornecedor, confirme que todos estão com a última versão.</div>` +
        nomes.map((nome) => {
          const doGrupo = docs.filter((d) => (d.grupo || '').toLowerCase() === nome.toLowerCase());
          return doGrupo.length ? `<section class="hub-grupo"><h2>${esc(nome)}</h2>${blocoDocumentos(doGrupo)}</section>` : '';
        }).join('');
    } else {
      corpo = `<section class="hub-grupo">${blocoDocumentos(docs)}</section>`;
    }
    el('hubConteudo').innerHTML = `<div class="hub-corpo"><h2 class="hub-titulo-secao">${esc(TITULOS[secaoAberta] || '')}</h2>${corpo}</div>`;
  }

  function renderizar() {
    el('telaHub').classList.toggle('largo', secaoAberta === 'memorial'); // Memorial usa a largura toda (computador/tablet deitado)
    el('btnHubVoltar').style.display = secaoAberta ? 'flex' : 'none'; // dentro de uma pasta, o voltar fica sempre no topo
    if (secaoAberta) renderizarSecao(); else renderizarInicio();
    if (window.NavCliente) window.NavCliente.sincronizar(); // cada tela do hub vira uma entrada do botão voltar do navegador
  }
  // Documento em REVISÃO ou ANTIGA: antes de abrir, um aviso (o cliente pode abrir mesmo assim, mas sabendo).
  const AVISOS_DOCUMENTO = {
    REVISAO: 'ESTE PROJETO ESTÁ SOB REVISÃO',
    ANTIGA: 'ESTE PROJETO É UMA VERSÃO ANTIGA'
  };
  let enderecoDoAviso = null;
  function fecharAviso() { el('modalAvisoDoc').classList.add('hidden'); enderecoDoAviso = null; }
  el('hubConteudo').addEventListener('click', (e) => {
    const link = e.target.closest('a.hub-doc-abrir[data-status]');
    if (!link || !AVISOS_DOCUMENTO[link.dataset.status]) return; // ATUAL abre direto
    e.preventDefault();
    enderecoDoAviso = link.href;
    el('tituloAvisoDoc').textContent = AVISOS_DOCUMENTO[link.dataset.status];
    el('modalAvisoDoc').classList.remove('hidden');
    el('btnAvisoAbrir').focus();
  });
  el('btnAvisoAbrir').addEventListener('click', () => {
    const url = enderecoDoAviso;
    fecharAviso();
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  });
  el('btnAvisoVoltar').addEventListener('click', fecharAviso);
  el('modalAvisoDoc').addEventListener('click', (e) => { if (e.target === el('modalAvisoDoc')) fecharAviso(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el('modalAvisoDoc').classList.contains('hidden')) fecharAviso(); });

  el('btnHubVoltar').addEventListener('click', () => {
    if (window.NavCliente && window.NavCliente.voltarSePossivel({ t: 'hub', s: null })) return; // volta de verdade, sem empilhar
    secaoAberta = null; renderizar(); window.scrollTo(0, 0);
  });

  // ---------- Entrada/saída ----------
  // Chamado pelo main.js ao entrar: mostra (ou esconde) os botões "Voltar ao projeto" da galeria e da planta.
  function preparar(galeria) {
    galeriaAtual = galeria;
    const mostrar = temConteudo(galeria) ? 'flex' : 'none';
    ['btnGaleriaParaHub', 'btnPlantaParaHub'].forEach((id) => { if (el(id)) el(id).style.display = mostrar; });
  }

  function abrir(secao) {
    secaoAberta = secao || null;
    ['telaGaleria', 'telaPlanta'].forEach((id) => { el(id).style.display = 'none'; });
    el('telaLogin').style.display = 'none';
    el('telaHub').style.display = 'block';
    el('nomeProjetoHub').textContent = galeriaAtual.nomeProjeto;
    document.title = `${galeriaAtual.nomeProjeto} — RENDERIA`;
    const icone = galeriaAtual.iconePersonalizado && galeriaAtual.iconePersonalizado.url;
    if (icone) el('imgLogoHub').src = icone;
    renderizar();
    window.scrollTo(0, 0);
  }
  function fechar() {
    el('telaHub').style.display = 'none';
  }

  ['btnGaleriaParaHub', 'btnPlantaParaHub'].forEach((id) => {
    if (!el(id)) return;
    el(id).addEventListener('click', () => {
      if (window.NavCliente && window.NavCliente.voltarSePossivel({ t: 'hub', s: null })) return;
      if (window.PlantaCliente) window.PlantaCliente.fechar();
      abrir();
    });
  });

  window.HubCliente = { secaoAberta: () => secaoAberta, temConteudo, preparar, abrir, fechar, estaAberta: () => el('telaHub').style.display !== 'none' };
})();
