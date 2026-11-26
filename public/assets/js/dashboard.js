// Dashboard online (página /dashboard?c=<link>). Senha mestra -> todos os projetos da conta com filtros (arquiteto, nome,
// tipo, situação). Clicar num projeto abre a Pasta do Cliente dele SEM a senha do cliente, em modo escritório (só leitura).
// As etiquetas (arquitetos, tipo, situação) também podem ser editadas aqui.
(function () {
  const $ = (id) => document.getElementById(id);
  const LINK = new URLSearchParams(window.location.search).get('c');
  if (!LINK) {
    document.body.innerHTML = '<div style="padding:60px 24px; text-align:center; color:#9a9ea5; font-family:sans-serif;">Link inválido -- confira se você copiou o endereço completo.</div>';
    return;
  }
  const CHAVE_TOKEN = `renderia_dash_token_${LINK}`;
  const CHAVE_FILTROS = `renderia_dash_filtros_${LINK}`;
  const CHAVE_RECOLHIDOS = `renderia_dash_recolhidos_${LINK}`;
  const CHAVE_TEMA = 'renderia_tema_hub'; // a mesma escolha de tema da Pasta do Cliente (mesmo site, mesmo aparelho)
  const PADRAO_SITUACOES = [{ id: 'andamento', nome: 'Em andamento' }, { id: 'concluido', nome: 'Concluído' }];

  let token = null;
  let projetos = [];
  let iconeConta = null; // logo da conta: aparece no cartão que ainda não tem foto
  let editando = null; // projeto cujas etiquetas estão abertas no modal
  let arqEdicao = [];
  // Listas da conta (vêm do servidor): arquitetos cadastrados, tipos e situações. Os nomes cadastrados ficam registrados pra todos os projetos.
  let catalogo = { arquitetos: [], tipos: [{ nome: 'Interiores', padrao: true, usos: 0 }, { nome: 'Arquitetura', padrao: true, usos: 0 }], situacoes: PADRAO_SITUACOES.map((s) => ({ ...s, padrao: true, usos: 0 })) };
  const nomeSituacao = (id) => { const s = catalogo.situacoes.find((x) => x.id === id); return s ? s.nome : 'Em andamento'; };

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

  // ---------- Tema claro/escuro (segue o aparelho; o botão troca e fica lembrado) ----------
  const lerTema = () => { try { const t = localStorage.getItem(CHAVE_TEMA); return (t === 'claro' || t === 'escuro') ? t : null; } catch (e) { return null; } };
  const aparelhoClaro = () => !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
  const temaEfetivo = () => lerTema() || (aparelhoClaro() ? 'claro' : 'escuro');
  function aplicarTema() {
    const salvo = lerTema();
    if (salvo) document.body.dataset.tema = salvo; else delete document.body.dataset.tema;
    const claro = temaEfetivo() === 'claro';
    const d = claro ? 'M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z' : 'M12 17a5 5 0 100-10 5 5 0 000 10zM12 1v3M12 20v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M1 12h3M20 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1';
    $('btnTema').innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
    $('btnTema').title = claro ? 'Mudar para o tema escuro' : 'Mudar para o tema claro';
  }
  $('btnTema').addEventListener('click', () => { try { localStorage.setItem(CHAVE_TEMA, temaEfetivo() === 'claro' ? 'escuro' : 'claro'); } catch (e) { /* vale só nesta visita */ } aplicarTema(); });
  aplicarTema();

  let temporizadorAviso = null;
  function avisar(msg, erro) {
    const t = $('dashToast');
    t.textContent = msg; t.classList.toggle('erro', !!erro); t.classList.add('show');
    clearTimeout(temporizadorAviso); temporizadorAviso = setTimeout(() => t.classList.remove('show'), erro ? 5000 : 2600);
  }

  async function chamar(caminho, opcoes = {}) {
    const resp = await fetch(caminho, Object.assign({}, opcoes, { headers: Object.assign({ 'Content-Type': 'application/json' }, opcoes.headers || {}, token ? { 'x-dashboard-token': token } : {}) }));
    const json = await resp.json().catch(() => ({}));
    if (resp.status === 401 && token) { sairParaLogin('Sua sessão expirou. Entre de novo.'); throw new Error(json.erro || 'Entre de novo.'); }
    if (!resp.ok) throw new Error(json.erro || 'Erro ao falar com o servidor.');
    return json;
  }
  const enviar = (metodo, corpo) => ({ method: metodo, body: JSON.stringify(corpo || {}) });

  // ---------- login ----------
  function sairParaLogin(mensagem) {
    token = null; try { localStorage.removeItem(CHAVE_TOKEN); } catch (e) { /* tudo bem */ }
    $('telaDash').style.display = 'none'; $('telaLogin').style.display = 'flex';
    if (mensagem) { $('msgErroLogin').textContent = mensagem; $('msgErroLogin').style.display = 'block'; }
  }
  async function entrar() {
    const senha = $('inputSenha').value;
    $('msgErroLogin').style.display = 'none';
    if (!senha) { $('msgErroLogin').textContent = 'Digite a senha mestra.'; $('msgErroLogin').style.display = 'block'; return; }
    $('btnEntrar').disabled = true; $('btnEntrar').textContent = 'Entrando...';
    try {
      const resp = await fetch(`/api/dashboard/${LINK}/login`, Object.assign({ headers: { 'Content-Type': 'application/json' } }, enviar('POST', { senha })));
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json.erro || 'Senha incorreta.');
      token = json.token;
      try { localStorage.setItem(CHAVE_TOKEN, token); } catch (e) { /* vale só agora */ }
      $('inputSenha').value = '';
      await carregar();
    } catch (e) {
      $('msgErroLogin').textContent = e.message; $('msgErroLogin').style.display = 'block';
    } finally {
      $('btnEntrar').disabled = false; $('btnEntrar').textContent = 'Entrar';
    }
  }
  $('btnEntrar').addEventListener('click', entrar);
  $('inputSenha').addEventListener('keydown', (e) => { if (e.key === 'Enter') entrar(); });
  $('btnSair').addEventListener('click', async () => { try { await chamar(`/api/dashboard/${LINK}/sair`, enviar('POST')); } catch (e) { /* sai mesmo assim */ } sairParaLogin(); });

  // ---------- dados e filtros ----------
  let carregadoEm = 0;
  async function carregar() {
    const r = await chamar(`/api/dashboard/${LINK}/projetos`);
    carregadoEm = Date.now();
    projetos = r.projetos;
    if (r.catalogo) catalogo = r.catalogo;
    iconeConta = r.iconeUrl || null;
    if (r.iconeUrl) { $('imgLogoLogin').src = r.iconeUrl; $('imgLogoDash').src = r.iconeUrl; }
    $('telaLogin').style.display = 'none'; $('telaDash').style.display = 'block';
    montarFiltros();
    restaurarFiltros();
    desenhar();
  }

  const todosArquitetos = () => catalogo.arquitetos.map((a) => a.nome); // os cadastrados na conta (inclui quem ainda não está em nenhum projeto)
  // Os três filtros saem das listas da conta; o que estava escolhido continua escolhido se ainda existir.
  function montarFiltros() {
    const manter = (id, html, vazio) => { const sel = $(id); const atual = sel.value; sel.innerHTML = html; sel.value = [...sel.options].some((o) => o.value === atual) ? atual : vazio; };
    manter('fArquiteto', '<option value="">Todos</option>' + todosArquitetos().map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('') + '<option value="__sem__">Sem arquiteto</option>', '');
    manter('fTipo', '<option value="">Todos</option>' + catalogo.tipos.map((t) => `<option value="${esc(t.nome)}">${esc(t.nome)}</option>`).join(''), '');
    manter('fSituacao', '<option value="">Todos</option>' + catalogo.situacoes.map((s) => `<option value="${esc(s.id)}">${esc(s.nome)}</option>`).join(''), '');
  }
  function lerFiltros() { return { busca: $('fBusca').value, arquiteto: $('fArquiteto').value, tipo: $('fTipo').value, situacao: $('fSituacao').value }; }
  function restaurarFiltros() {
    let f = {}; try { f = JSON.parse(localStorage.getItem(CHAVE_FILTROS) || '{}'); } catch (e) { f = {}; }
    $('fBusca').value = f.busca || '';
    $('fTipo').value = f.tipo || '';
    $('fSituacao').value = f.situacao || '';
    if (f.arquiteto && [...$('fArquiteto').options].some((o) => o.value === f.arquiteto)) $('fArquiteto').value = f.arquiteto;
  }
  function gravarFiltros() { try { localStorage.setItem(CHAVE_FILTROS, JSON.stringify(lerFiltros())); } catch (e) { /* tudo bem */ } }
  ['fBusca', 'fArquiteto', 'fTipo', 'fSituacao'].forEach((id) => $(id).addEventListener(id === 'fBusca' ? 'input' : 'change', () => { gravarFiltros(); desenhar(); }));
  $('btnLimparFiltros').addEventListener('click', () => { $('fBusca').value = ''; $('fArquiteto').value = ''; $('fTipo').value = ''; $('fSituacao').value = ''; gravarFiltros(); desenhar(); });

  // Grupos (Em andamento, Concluído...) que o arquiteto recolheu: ficam lembrados neste aparelho.
  const lerRecolhidos = () => { try { const v = JSON.parse(localStorage.getItem(CHAVE_RECOLHIDOS) || '[]'); return new Set(Array.isArray(v) ? v : []); } catch (e) { return new Set(); } };
  const gravarRecolhidos = (conjunto) => { try { localStorage.setItem(CHAVE_RECOLHIDOS, JSON.stringify([...conjunto])); } catch (e) { /* vale só nesta visita */ } };

  function passaNoFiltro(p, f) {
    if (f.busca && !semAcento(p.nome).includes(semAcento(f.busca))) return false;
    if (f.arquiteto === '__sem__') { if (p.meta.arquitetos.length) return false; }
    else if (f.arquiteto && !p.meta.arquitetos.includes(f.arquiteto)) return false;
    if (f.tipo && p.meta.tipo !== f.tipo) return false;
    if (f.situacao && p.meta.situacao !== f.situacao) return false;
    return true;
  }

  // ---------- Agrupar por (Nenhum, Arquiteto, Tipo ou Status; o padrão é Status). Lembrado neste aparelho. ----------
  const CHAVE_AGRUPAR = `renderia_dash_agrupar_${LINK}`;
  const lerAgrupar = () => { try { const v = localStorage.getItem(CHAVE_AGRUPAR); return ['nenhum', 'arquiteto', 'tipo', 'status'].includes(v) ? v : 'status'; } catch (e) { return 'status'; } };
  $('fAgrupar').value = lerAgrupar();
  $('fAgrupar').addEventListener('change', () => { try { localStorage.setItem(CHAVE_AGRUPAR, $('fAgrupar').value); } catch (e) { /* vale só nesta visita */ } desenhar(); });
  // Projeto com dois arquitetos aparece nos DOIS grupos; quem não tem a etiqueta vai pro "Sem ...", no fim; grupo vazio não aparece.
  // `chave` lembra os grupos recolhidos (no Status é o id da situação, como sempre foi).
  function gruposDoDashboard(lista, criterio, listas) {
    if (criterio === 'nenhum') return [{ chave: '', titulo: '', projetos: lista }];
    if (criterio === 'status') return listas.situacoes.map((s) => ({ chave: s.id, titulo: s.nome, projetos: lista.filter((p) => p.meta.situacao === s.id) })).filter((g) => g.projetos.length);
    const mesmo = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
    const valores = (p) => (criterio === 'arquiteto' ? p.meta.arquitetos : (p.meta.tipo ? [p.meta.tipo] : []));
    const nomes = (criterio === 'arquiteto' ? listas.arquitetos.map((a) => a.nome).sort((a, b) => a.localeCompare(b, 'pt-BR')) : listas.tipos.map((t) => t.nome));
    lista.forEach((p) => valores(p).forEach((v) => { if (!nomes.some((n) => mesmo(n, v))) nomes.push(v); }));
    const grupos = nomes.map((n) => ({ chave: `${criterio}:${String(n).toLowerCase()}`, titulo: n, projetos: lista.filter((p) => valores(p).some((v) => mesmo(v, n))) }));
    const sem = lista.filter((p) => !valores(p).length);
    if (sem.length) grupos.push({ chave: `${criterio}:`, titulo: criterio === 'arquiteto' ? 'Sem arquiteto' : 'Sem tipo', projetos: sem });
    return grupos.filter((g) => g.projetos.length);
  }

  // ---------- desenho ----------
  const PALETA = ['#7a4fa3', '#a65d3a', '#3c7a8c', '#6b7a3a', '#a33f6a', '#4a5fa8', '#8a6a2a', '#3a8a62'];
  function corDoNome(nome) { let h = 0; for (const c of String(nome)) h = (h * 31 + c.codePointAt(0)) >>> 0; return PALETA[h % PALETA.length]; }

  function cartao(p) {
    const chips = [
      ...p.meta.arquitetos.map((a) => `<span class="dash-chip" style="background:${corDoNome(a)}">${esc(a)}</span>`),
      `<span class="dash-chip situacao ${p.meta.situacao === 'andamento' || p.meta.situacao === 'concluido' ? p.meta.situacao : 'outra'}">${esc(nomeSituacao(p.meta.situacao))}</span>`,
      p.meta.tipo ? `<span class="dash-chip tipo">${esc(p.meta.tipo)}</span>` : ''
    ].join('');
    return `<article class="dash-card" data-id="${esc(p.projetoId)}" tabindex="0" role="button" aria-label="Abrir a pasta do cliente de ${esc(p.nome)}">
      <div class="dash-capa ${p.capaUrl ? 'com-foto' : ''}" ${p.capaUrl ? `style="background-image:url('${esc(p.capaUrl)}')"` : ''}>${p.capaUrl ? '' : (iconeConta ? `<img class="dash-capa-logo" src="${esc(iconeConta)}" alt="">` : '<span>Sem capa</span>')}</div>
      <button type="button" class="dash-editar" data-editar title="Editar etiquetas (arquiteto, tipo, situação)" aria-label="Editar etiquetas de ${esc(p.nome)}">✎</button>
      <div class="dash-corpo"><h3>${esc(p.nome)}</h3><div class="dash-chips">${chips}</div></div>
    </article>`;
  }

  function desenhar() {
    const f = lerFiltros();
    const filtrando = !!(f.busca || f.arquiteto || f.tipo || f.situacao);
    $('btnLimparFiltros').style.display = filtrando ? 'inline-flex' : 'none';
    const lista = projetos.filter((p) => passaNoFiltro(p, f));
    $('dashResumo').textContent = projetos.length ? `${lista.length} de ${projetos.length} ${projetos.length === 1 ? 'projeto' : 'projetos'}` : '';
    if (!projetos.length) { $('dashLista').innerHTML = '<div class="vazio-galeria">Ainda não há projetos com Pasta do Cliente. Crie a Pasta do Cliente de um projeto no RENDERIA e ele aparece aqui.</div>'; return; }
    if (!lista.length) { $('dashLista').innerHTML = '<div class="vazio-galeria">Nenhum projeto com esses filtros.</div>'; return; }
    const recolhidos = lerRecolhidos();
    $('dashLista').innerHTML = gruposDoDashboard(lista, $('fAgrupar').value, catalogo).map((g) => {
      if (!g.titulo) return `<section class="dash-grupo"><div class="dash-grid">${g.projetos.map(cartao).join('')}</div></section>`; // sem agrupar
      const fechado = recolhidos.has(g.chave);
      return `<section class="dash-grupo${fechado ? ' recolhido' : ''}" data-sit="${esc(g.chave)}"><h2 class="dash-grupo-titulo" role="button" tabindex="0" aria-expanded="${fechado ? 'false' : 'true'}" title="Tocar para recolher ou abrir"><span class="dash-seta" aria-hidden="true">▾</span>${esc(g.titulo.toUpperCase())} <span>${g.projetos.length}</span></h2><div class="dash-grid">${g.projetos.map(cartao).join('')}</div></section>`;
    }).join('');
  }

  // Depois de salvar: a contagem de uso de cada item mudou, então relê as listas e as etiquetas.
  async function carregarCatalogo() {
    try { const r = await chamar(`/api/dashboard/${LINK}/projetos`); if (r.catalogo) catalogo = r.catalogo; projetos.forEach((p) => { const n = r.projetos.find((x) => x.projetoId === p.projetoId); if (n) p.meta = n.meta; }); } catch (e) { /* mantém o que já tem */ }
  }

  // ---------- abrir a pasta do cliente (modo escritório) ----------
  async function abrirProjeto(id) {
    const card = $('dashLista').querySelector(`.dash-card[data-id="${CSS.escape(id)}"]`);
    if (card) card.classList.add('abrindo');
    try {
      const r = await chamar(`/api/dashboard/${LINK}/projetos/${encodeURIComponent(id)}/abrir`, enviar('POST'));
      // a página do cliente (mesmo site) lê esta chave e já entra, sem pedir a senha do cliente
      localStorage.setItem(`renderia_cliente_token_${r.linkToken}`, r.token);
      localStorage.setItem('renderia_dash_conta', LINK);
      window.location.href = `/?g=${encodeURIComponent(r.linkToken)}`;
    } catch (e) {
      if (card) card.classList.remove('abrindo');
      avisar(e.message, true);
    }
  }
  function alternarGrupo(titulo) {
    const secao = titulo.closest('.dash-grupo');
    const recolher = !secao.classList.contains('recolhido');
    secao.classList.toggle('recolhido', recolher);
    titulo.setAttribute('aria-expanded', recolher ? 'false' : 'true');
    const r = lerRecolhidos(); if (recolher) r.add(secao.dataset.sit); else r.delete(secao.dataset.sit); gravarRecolhidos(r);
  }
  $('dashLista').addEventListener('click', (e) => {
    const titulo = e.target.closest('.dash-grupo-titulo');
    if (titulo) { alternarGrupo(titulo); return; }
    const card = e.target.closest('.dash-card');
    if (!card) return;
    if (e.target.closest('[data-editar]')) { abrirEdicao(card.dataset.id); return; }
    abrirProjeto(card.dataset.id);
  });
  $('dashLista').addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('dash-grupo-titulo')) { e.preventDefault(); alternarGrupo(e.target); return; }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('dash-card')) { e.preventDefault(); abrirProjeto(e.target.dataset.id); }
  });

  // ---------- editar etiquetas ----------
  function desenharChipsEdicao() {
    $('dashArqChips').innerHTML = arqEdicao.length
      ? arqEdicao.map((a, i) => `<span class="dash-chip" style="background:${corDoNome(a)}">${esc(a)}<button type="button" data-tirar="${i}" aria-label="Tirar ${esc(a)}">✕</button></span>`).join('')
      : '<span class="dash-sem">Nenhum arquiteto marcado</span>';
    // os cadastrados na conta que ainda não estão neste projeto: um toque escolhe
    const livres = todosArquitetos().filter((n) => !arqEdicao.some((a) => a.toLowerCase() === n.toLowerCase()));
    $('dashArqLista').innerHTML = livres.length ? livres.map((n) => `<button type="button" class="dash-chip-opcao" data-escolher="${esc(n)}">${esc(n)}</button>`).join('') : '<span class="dash-sem">Nenhum outro arquiteto cadastrado</span>';
  }
  const opcoesTipo = () => '<option value="">—</option>' + catalogo.tipos.map((t) => `<option value="${esc(t.nome)}">${esc(t.nome)}</option>`).join('');
  const opcoesSituacao = () => catalogo.situacoes.map((s) => `<option value="${esc(s.id)}">${esc(s.nome)}</option>`).join('');
  function desenharSelectsEdicao(tipo, situacao) {
    $('dashTipo').innerHTML = opcoesTipo(); $('dashTipo').value = tipo || '';
    $('dashSituacao').innerHTML = opcoesSituacao(); $('dashSituacao').value = situacao || 'andamento';
  }
  // Gerenciar as listas: quem não está em uso (e não é padrão) tem ✕ pra remover
  function desenharListasGerenciar() {
    const grupo = (titulo, lista, chaveDe) => `<div class="dash-lista-grupo"><span class="dash-rotulo">${titulo}</span><div class="dash-chips-lista">${lista.length ? lista.map((x) => {
      const removivel = !x.padrao && !x.usos;
      const dica = x.padrao ? 'Item padrão' : (x.usos ? 'Em uso em ' + x.usos + (x.usos === 1 ? ' projeto' : ' projetos') : 'Sem uso');
      return `<span class="dash-chip-opcao fixo" title="${dica}">${esc(x.nome)}${x.usos ? ` <small>${x.usos}</small>` : ''}${removivel ? `<button type="button" data-remover-lista="${esc(titulo)}" data-chave="${esc(chaveDe(x))}" aria-label="Remover ${esc(x.nome)}">✕</button>` : ''}</span>`;
    }).join('') : '<span class="dash-sem">Nenhum</span>'}</div></div>`;
    $('dashListasGerenciar').innerHTML = grupo('Arquitetos', catalogo.arquitetos, (x) => x.nome) + grupo('Tipos', catalogo.tipos, (x) => x.nome) + grupo('Situações', catalogo.situacoes, (x) => x.id);
  }
  const LISTA_DO_TITULO = { Arquitetos: 'arquitetos', Tipos: 'tipos', 'Situações': 'situacoes' };
  function abrirEdicao(id) {
    editando = projetos.find((p) => p.projetoId === id);
    if (!editando) return;
    $('dashModalTitulo').textContent = editando.nome;
    arqEdicao = [...editando.meta.arquitetos];
    desenharSelectsEdicao(editando.meta.tipo, editando.meta.situacao);
    $('dashArqNovo').value = ''; $('dashTipoNovo').value = ''; $('dashSituacaoNova').value = '';
    desenharChipsEdicao();
    desenharListasGerenciar();
    $('dashModal').classList.remove('hidden');
    $('dashArqNovo').focus();
  }
  function fecharEdicao() { $('dashModal').classList.add('hidden'); editando = null; }
  // Cadastra o nome na conta (fica registrado pra todos os projetos) e já marca neste projeto.
  async function adicionarArquiteto() {
    const nome = $('dashArqNovo').value.trim();
    if (!nome) return;
    try {
      const r = await chamar(`/api/dashboard/${LINK}/catalogo`, enviar('POST', { lista: 'arquitetos', nome }));
      catalogo = r.catalogo;
      if (!arqEdicao.some((a) => a.toLowerCase() === r.nome.toLowerCase())) arqEdicao.push(r.nome);
      $('dashArqNovo').value = '';
      desenharChipsEdicao(); desenharListasGerenciar(); montarFiltros();
    } catch (e) { avisar(e.message, true); }
  }
  async function cadastrarNaLista(lista, campo, aoCadastrar) {
    const nome = $(campo).value.trim();
    if (!nome) return;
    try {
      const r = await chamar(`/api/dashboard/${LINK}/catalogo`, enviar('POST', { lista, nome }));
      catalogo = r.catalogo;
      $(campo).value = '';
      aoCadastrar(r);
      desenharListasGerenciar(); montarFiltros();
    } catch (e) { avisar(e.message, true); }
  }
  const tipoAtual = () => $('dashTipo').value;
  const situacaoAtual = () => $('dashSituacao').value;
  $('dashArqAdd').addEventListener('click', adicionarArquiteto);
  $('dashArqNovo').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); adicionarArquiteto(); } });
  $('dashTipoAdd').addEventListener('click', () => cadastrarNaLista('tipos', 'dashTipoNovo', (r) => desenharSelectsEdicao(r.nome, situacaoAtual())));
  $('dashTipoNovo').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('dashTipoAdd').click(); } });
  $('dashSituacaoAdd').addEventListener('click', () => cadastrarNaLista('situacoes', 'dashSituacaoNova', (r) => desenharSelectsEdicao(tipoAtual(), r.id)));
  $('dashSituacaoNova').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('dashSituacaoAdd').click(); } });
  $('dashArqChips').addEventListener('click', (e) => { const b = e.target.closest('[data-tirar]'); if (b) { arqEdicao.splice(Number(b.dataset.tirar), 1); desenharChipsEdicao(); } });
  $('dashArqLista').addEventListener('click', (e) => {
    const b = e.target.closest('[data-escolher]');
    if (!b) return;
    if (arqEdicao.length >= 6) { avisar('No máximo 6 arquitetos por projeto.', true); return; }
    arqEdicao.push(b.dataset.escolher); desenharChipsEdicao();
  });
  $('dashListasGerenciar').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-remover-lista]');
    if (!b) return;
    try {
      const r = await chamar(`/api/dashboard/${LINK}/catalogo/remover`, enviar('POST', { lista: LISTA_DO_TITULO[b.dataset.removerLista], chave: b.dataset.chave }));
      catalogo = r.catalogo;
      desenharSelectsEdicao(tipoAtual(), situacaoAtual()); desenharChipsEdicao(); desenharListasGerenciar(); montarFiltros();
    } catch (err) { avisar(err.message, true); }
  });
  $('dashModalFechar').addEventListener('click', fecharEdicao);
  $('dashModalCancelar').addEventListener('click', fecharEdicao);
  $('dashModal').addEventListener('click', (e) => { if (e.target === $('dashModal')) fecharEdicao(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('dashModal').classList.contains('hidden')) fecharEdicao(); });
  $('dashModalSalvar').addEventListener('click', async () => {
    if (!editando) return;
    if ($('dashArqNovo').value.trim()) await adicionarArquiteto(); // o que ficou digitado e não foi cadastrado também entra
    $('dashModalSalvar').disabled = true;
    try {
      const r = await chamar(`/api/dashboard/${LINK}/projetos/${encodeURIComponent(editando.projetoId)}/meta`, enviar('PUT', { arquitetos: arqEdicao, tipo: $('dashTipo').value, situacao: $('dashSituacao').value }));
      editando.meta = r.meta;
      fecharEdicao();
      await carregarCatalogo();
      montarFiltros();
      desenhar();
      avisar('Etiquetas salvas.');
    } catch (e) { avisar(e.message, true); } finally { $('dashModalSalvar').disabled = false; }
  });

  // Voltando da pasta do cliente (botão Voltar do navegador), a página volta do cache do jeito que saiu: com o cartão ainda marcado como
  // "abrindo" (apagado e sem clique). Sempre que a página reaparece, tira essa marca.
  const liberarCartoes = () => document.querySelectorAll('.dash-card.abrindo').forEach((c) => c.classList.remove('abrindo'));
  window.addEventListener('pageshow', liberarCartoes);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) liberarCartoes(); });

  // ---------- Atualizar: o que muda no RENDERIA aparece aqui sem recarregar a página ----------
  // Botão, e sozinho quando a pessoa volta pra esta aba (no máximo 1x a cada 15 s; nunca com a janela de etiquetas aberta).
  $('btnAtualizarDash').addEventListener('click', async () => {
    const botao = $('btnAtualizarDash'); botao.disabled = true;
    try { await carregar(); avisar('Atualizado.'); } catch (e) { avisar(e.message, true); } finally { botao.disabled = false; }
  });
  function atualizarAoVoltar() {
    if (document.hidden || $('telaDash').style.display === 'none' || editando || Date.now() - carregadoEm < 15000) return;
    carregar().catch(() => { /* sem rede: fica o que já está na tela */ });
  }
  document.addEventListener('visibilitychange', atualizarAoVoltar);
  window.addEventListener('focus', atualizarAoVoltar); // alternar entre o RENDERIA e o navegador não troca de aba

  // ---------- entrada: sessão lembrada ----------
  (async function iniciar() {
    try {
      const r = await fetch(`/api/dashboard/${LINK}/info-publica`);
      if (!r.ok) { document.body.innerHTML = '<div style="padding:60px 24px; text-align:center; color:#9a9ea5; font-family:sans-serif;">Link não encontrado -- confira se você copiou o endereço completo.</div>'; return; }
    } catch (e) { /* a tela de login continua */ }
    try { token = localStorage.getItem(CHAVE_TOKEN); } catch (e) { token = null; }
    if (token) { try { await carregar(); } catch (e) { sairParaLogin(); } }
  })();
})();
