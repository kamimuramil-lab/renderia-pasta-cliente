// Pasta de Orçamentos (lado do cliente final). Página própria: /orcamentos?o=<link>, login próprio. O cliente lê, abre o
// orçamento (link do Drive), APROVA ou RECUSA com botões claros (nos orçamentos já liberados) e comenta.
// Cada ação vira uma novidade pro arquiteto no servidor. Esta página NÃO fala com a Pasta Cliente (outras rotas, outro token).
(function () {
  const $ = (id) => document.getElementById(id);
  const LINK = new URLSearchParams(window.location.search).get('o');
  if (!LINK) {
    document.body.innerHTML = '<div style="padding:60px 24px; text-align:center; color:#9a9ea5; font-family:sans-serif;">Link inválido -- confira se você copiou o endereço completo que recebeu.</div>';
    return;
  }
  const CHAVE_TOKEN = `renderia_orc_token_${LINK}`;
  const CHAVE_TEMA = 'renderia_tema_hub'; // a mesma escolha de tema da Pasta Cliente (mesmo site, mesmo aparelho)
  const ROTULO = { a_fazer: 'À fazer', evf: 'EVF', em_andamento: 'Em andamento', analise_cliente: 'Para sua análise', fechado: 'Aprovado', recusado: 'Recusado' };

  let token = null;
  let dados = null;
  // Mensagens do escritório que este aparelho já viu (por orçamento): o botão de comentários avisa quando chega resposta nova.
  const CHAVE_VISTOS = `renderia_orc_vistos_${LINK}`;
  const lerVistos = () => { try { return JSON.parse(localStorage.getItem(CHAVE_VISTOS) || '{}'); } catch (e) { return {}; } };
  const gravarVistos = (v) => { try { localStorage.setItem(CHAVE_VISTOS, JSON.stringify(v)); } catch (e) { /* vale só nesta visita */ } };
  const novasDoEscritorio = (item) => { const vistos = lerVistos()[item.id] || []; return item.comentarios.filter((c) => c.autor !== 'cliente' && !vistos.includes(c.id)).length; };
  const marcarVistos = (item) => { const v = lerVistos(); v[item.id] = item.comentarios.map((c) => c.id); gravarVistos(v); };
  const abertos = new Set(); // orçamentos com a conversa aberta (sobrevive a recarregar a lista)
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hrefSeguro = (url) => { try { const u = new URL(url); return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : null; } catch (e) { return null; } };
  const moeda = (v) => (typeof v === 'number' ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'A definir');

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
  if (window.matchMedia) { const mq = window.matchMedia('(prefers-color-scheme: light)'); (mq.addEventListener ? mq.addEventListener.bind(mq, 'change') : mq.addListener.bind(mq))(aplicarTema); }
  aplicarTema();

  let temporizadorAviso = null;
  function avisar(msg, erro) {
    const t = $('orcToast');
    t.textContent = msg; t.classList.toggle('erro', !!erro); t.classList.add('show');
    clearTimeout(temporizadorAviso); temporizadorAviso = setTimeout(() => t.classList.remove('show'), erro ? 6000 : 3200);
  }

  async function chamar(caminho, opcoes = {}) {
    const resp = await fetch(caminho, Object.assign({}, opcoes, {
      headers: Object.assign({}, opcoes.headers || {}, token ? { 'x-orcamento-token': token } : {})
    }));
    const json = await resp.json().catch(() => ({}));
    if (resp.status === 401 && token) { sairParaLogin('Sua sessão expirou. Entre de novo.'); throw new Error(json.erro || 'Faça login de novo.'); }
    if (!resp.ok) throw new Error(json.erro || 'Erro ao falar com o servidor.');
    return json;
  }
  const enviarJson = (metodo, corpo) => ({ method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });

  // ---------- Login ----------
  function sairParaLogin(mensagem) {
    token = null; try { localStorage.removeItem(CHAVE_TOKEN); } catch (e) { /* tudo bem */ }
    $('telaOrcamentos').style.display = 'none'; $('telaLogin').style.display = 'flex';
    if (mensagem) { $('msgErroLogin').textContent = mensagem; $('msgErroLogin').style.display = 'block'; }
  }

  async function entrar() {
    const usuario = $('inputUsuario').value.trim(); const senha = $('inputSenha').value;
    $('msgErroLogin').style.display = 'none';
    if (!usuario || !senha) { $('msgErroLogin').textContent = 'Preencha usuário e senha.'; $('msgErroLogin').style.display = 'block'; return; }
    $('btnEntrar').disabled = true; $('btnEntrar').textContent = 'Entrando...';
    try {
      const resp = await fetch(`/api/orcamentos/${LINK}/login`, enviarJson('POST', { usuario, senha }));
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json.erro || 'Usuário ou senha incorretos.');
      token = json.token;
      try { if ($('chkLembrar').checked) localStorage.setItem(CHAVE_TOKEN, token); else localStorage.removeItem(CHAVE_TOKEN); } catch (e) { /* sem armazenamento: vale só agora */ }
      await carregar();
    } catch (e) {
      $('msgErroLogin').textContent = e.message; $('msgErroLogin').style.display = 'block';
    } finally {
      $('btnEntrar').disabled = false; $('btnEntrar').textContent = 'Entrar';
    }
  }
  $('btnEntrar').addEventListener('click', entrar);
  $('inputSenha').addEventListener('keydown', (e) => { if (e.key === 'Enter') entrar(); });

  // ---------- Lista ----------
  function opcoesStatus(item) {
    const escolhas = dados.statusQueClienteEscolhe;
    const atualFora = !escolhas.includes(item.status); // ex.: "Em andamento": aparece como ponto de partida, não escolhível
    return (atualFora ? `<option value="" selected disabled>${esc(ROTULO[item.status])} — escolha…</option>` : '') +
      escolhas.map((s) => `<option value="${s}" ${s === item.status ? 'selected' : ''}>${esc(ROTULO[s])}</option>`).join('');
  }

  // ---------- "Somar": o cliente marca quais orçamentos entram na soma do rodapé (fica lembrado neste aparelho) ----------
  const CHAVE_SOMAR = `renderia_orc_somar_${LINK}`;
  let somar = new Set();
  try { somar = new Set(JSON.parse(localStorage.getItem(CHAVE_SOMAR) || '[]')); } catch (e) { somar = new Set(); }
  const gravarSomar = () => { try { localStorage.setItem(CHAVE_SOMAR, JSON.stringify([...somar])); } catch (e) { /* vale só nesta visita */ } };
  const temValor = (i) => typeof i.valor === 'number';

  // Decisão do cliente. Os botões são discretos (contorno): a cor forte fica SÓ para o orçamento já aprovado/recusado.
  const ROTULO_SITUACAO = { analise_cliente: 'Aguardando sua decisão', fechado: '✓ Aprovado por você', recusado: '✕ Recusado por você' };
  const ICONE_MENSAGEM = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 01-2 2H8l-5 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>';
  // Comentários: só o ícone de mensagem + quantidade. Acende (vermelho, pulsando) quando o escritório respondeu e este aparelho ainda não viu.
  function textoBotaoComentarios(item) {
    const novas = novasDoEscritorio(item);
    return `${ICONE_MENSAGEM}<span class="orc-n">${item.comentarios.length}</span>${novas ? '<span class="orc-ponto" aria-hidden="true"></span>' : ''}`;
  }
  function tituloBotaoComentarios(item) {
    const novas = novasDoEscritorio(item);
    return `Comentários (${item.comentarios.length})${novas ? ' — ' + (novas === 1 ? 'nova mensagem do escritório' : novas + ' novas mensagens do escritório') : ''}`;
  }
  function botaoComentarios(item) {
    const novas = novasDoEscritorio(item);
    return `<button class="orc-botao orc-icone ${novas ? 'tem-novo' : ''}" data-acao="conversa" title="${esc(tituloBotaoComentarios(item))}" aria-label="${esc(tituloBotaoComentarios(item))}">${textoBotaoComentarios(item)}</button>`;
  }

  // Decisão num menu (Em análise / Aprovado / Recusado): ocupa pouco espaço. A cor forte é só do aprovado/recusado.
  const DECISAO_ROTULO = { analise_cliente: 'Em análise', fechado: 'Aprovado', recusado: 'Recusado' };
  function seletorDecisao(item) {
    if (!item.podeMudarStatus) return `<span class="orc-selo s-${esc(item.status)}">${esc(ROTULO[item.status] || item.status)}</span>`;
    const foraDoMenu = !DECISAO_ROTULO[item.status]; // ex.: EVF / Em andamento: aparece como ponto de partida
    const opcoes = (foraDoMenu ? `<option value="" selected>${esc(ROTULO[item.status] || item.status)}</option>` : '') +
      Object.keys(DECISAO_ROTULO).map((st) => `<option value="${st}" ${st === item.status ? 'selected' : ''}>${esc(DECISAO_ROTULO[st])}</option>`).join('');
    return `<select class="orc-decisao-sel s-${esc(item.status)}" data-acao-decisao aria-label="Decisão sobre ${esc(item.item)}">${opcoes}</select>`;
  }

  // Cada orçamento é uma LINHA (usa a largura toda da tela): Somar | Categoria e fornecedor | Valor | Observação | Decisão.
  function linha(item) {
    const href = hrefSeguro(item.url);
    const telefone = String(item.telefone || '').replace(/[^0-9+()\-\s]/g, '').trim();
    const quem = [item.empresa, item.representante].filter(Boolean).map(esc).join(' · ');
    const aberto = abertos.has(item.id);
    const comentarios = item.comentarios.map((c) => `<div class="orc-msg ${c.autor === 'cliente' ? 'minha' : 'escritorio'}"><span class="orc-msg-autor">${c.autor === 'cliente' ? 'Você' : 'Escritório'}</span>${esc(c.texto)}</div>`).join('');
    return `<article class="orc-row status-${esc(item.status)}" data-id="${esc(item.id)}">
      <label class="orc-c-somar" title="${temValor(item) ? 'Incluir este valor na soma' : 'Sem valor ainda'}"><input type="checkbox" data-somar ${somar.has(item.id) && temValor(item) ? 'checked' : ''} ${temValor(item) ? '' : 'disabled'} aria-label="Somar ${esc(item.item)}"></label>
      <div class="orc-c-item">
        <h3>${esc(item.item)}${tagNovidade(item.id)}</h3>
        ${quem ? `<div class="orc-linha">${quem}</div>` : ''}
        ${telefone ? `<div class="orc-linha"><a href="tel:${esc(telefone)}">${esc(item.telefone)}</a></div>` : ''}
      </div>
      <div class="orc-c-valor ${temValor(item) ? '' : 'sem'}">
        <span class="orc-abrir-slot">${href ? `<a class="orc-botao orc-abrir" href="${esc(href)}" target="_blank" rel="noopener noreferrer" title="Abrir o orçamento (arquivo do fornecedor)">Abrir ↗</a>` : ''}</span>
        <span class="orc-valor-num">${moeda(item.valor)}</span>
      </div>
      <div class="orc-c-obs">${item.observacao ? esc(item.observacao) : '<span class="orc-vazio">—</span>'}</div>
      <div class="orc-c-acoes">
        ${seletorDecisao(item)}
        ${botaoComentarios(item)}
      </div>
      <div class="orc-conversa" ${aberto ? '' : 'hidden'}>
        ${comentarios || '<div class="orc-obs">Nenhum comentário ainda.</div>'}
        <div class="orc-escrever">
          <textarea rows="2" maxlength="1000" placeholder="Escreva um comentário para o escritório..."></textarea>
          <button class="orc-botao principal" data-acao="enviar">Enviar</button>
        </div>
      </div>
    </article>`;
  }

  // Rodapé: total de todos (sem os recusados) e total só dos marcados em "Somar".
  function totaisHtml() {
    const itens = dados.itens;
    const soma = (lista) => lista.reduce((t, i) => t + (temValor(i) ? i.valor : 0), 0);
    const marcados = itens.filter((i) => somar.has(i.id) && temValor(i));
    const comValor = itens.filter(temValor).length;
    return `<div class="orc-total-acoes"><button type="button" class="orc-botao" data-acao-somar="todos" ${comValor ? '' : 'disabled'}>☑ Somar todos</button><button type="button" class="orc-botao" data-acao-somar="nenhum" ${marcados.length ? '' : 'disabled'}>Limpar seleção</button></div>
      <div class="orc-total-linha"><span>Total de todos os orçamentos <small>(sem os recusados)</small></span><strong>${moeda(soma(itens.filter((i) => i.status !== 'recusado')))}</strong></div>
      <div class="orc-total-linha destaque"><span>Total dos selecionados <small>(${marcados.length} ${marcados.length === 1 ? 'orçamento' : 'orçamentos'})</small></span><strong>${moeda(soma(marcados))}</strong></div>`;
  }
  const atualizarTotais = () => { const caixa = $('orcTotais'); if (caixa) caixa.innerHTML = totaisHtml(); };

  // ---------- Novidades: orçamento novo ou alterado pelo escritório desde a última visita deste aparelho ----------
  // A marca ("NOVO"/"ATUALIZADO" no item + contagem no topo) vale pra esta visita; o que o cliente já viu vira "visto" ao abrir a página.
  let novidades = null;
  const itensParaNovidades = () => ({ orcamentos: dados.itens.map((i) => ({ id: i.id, versao: [i.atualizadoEm || '', i.valor, i.url].join('|') })) });
  const tagNovidade = (id) => { const t = novidades ? novidades.tag('orcamentos', id) : ''; return t ? `<span class="hub-novo">${t}</span>` : ''; };
  function avisoDeNovidades() {
    const n = novidades ? novidades.total('orcamentos') : 0;
    return n ? `<div class="orc-novidades"><span class="hub-bolinha-fixa">${n}</span> ${n === 1 ? 'novidade' : 'novidades'} desde a sua última visita</div>` : '';
  }

  function renderizar() {
    const itens = dados.itens;
    if (!itens.length) { $('orcLista').innerHTML = '<div class="vazio-galeria">Ainda não há orçamentos por aqui. Volte em breve!</div>'; return; }
    // Os orçamentos ficam AGRUPADOS POR CATEGORIA (Marcenaria, Iluminação...), na ordem que o escritório definiu; cada orçamento
    // mostra o próprio status (menu de decisão). O total de cada categoria soma o que está nela (sem os recusados).
    const somaDe = (lista) => lista.filter((i) => i.status !== 'recusado').reduce((t, i) => t + (temValor(i) ? i.valor : 0), 0);
    const categorias = (dados.categorias && dados.categorias.length) ? dados.categorias : [{ id: '', nome: 'Orçamentos' }]; // servidor sem categorias: um grupo só
    const grupos = categorias.map((c) => {
      const doGrupo = itens.filter((i) => (c.id ? i.categoriaId === c.id : true));
      if (!doGrupo.length) return '';
      const sub = somaDe(doGrupo);
      return `<div class="orc-grupo-cab"><span class="orc-grupo-nome">${esc(c.nome)}</span> <span>${doGrupo.length}</span>${sub > 0 ? `<span class="orc-grupo-soma">${moeda(sub)}</span>` : ''}</div>${doGrupo.map(linha).join('')}`;
    }).join('');
    $('orcLista').innerHTML = `${avisoDeNovidades()}<div class="orc-tabela">
      <div class="orc-cab"><span>Somar</span><span>Orçamento</span><span class="orc-c-valor">Valor</span><span>Observação</span><span>Decisão</span></div>
      ${grupos}
      <div class="orc-totais" id="orcTotais">${totaisHtml()}</div>
    </div>`;
  }

  async function carregar() {
    dados = await chamar(`/api/orcamentos/${LINK}/itens`);
    $('telaLogin').style.display = 'none'; $('telaOrcamentos').style.display = 'block';
    $('nomeProjetoOrc').textContent = dados.nomeProjeto;
    document.title = `${dados.nomeProjeto} — Orçamentos`;
    if (!novidades && window.Novidades && !dados.modoEscritorio) { try { novidades = window.Novidades.abrir('renderia_orc_novidades_' + LINK, itensParaNovidades()); } catch (e) { novidades = null; } }
    renderizar();
    if (novidades) novidades.marcarVisto('orcamentos'); // já viu: na próxima visita só aparece o que mudar daqui pra frente (inclusive o que o cliente mesmo decidiu)
    if (window.AjudaCliente) window.AjudaCliente.iniciar({ nomeProjeto: dados.nomeProjeto, nomeEscritorio: dados.nomeEscritorio, contatos: dados.contatosEscritorio, telaAtual: () => 'orcamentos', nomeDaTela: () => 'Orçamentos' });
  }

  const DECISOES = {
    aprovar: { status: 'fechado', confirmar: 'Aprovar este orçamento? O escritório será avisado.', ok: 'Orçamento aprovado. O escritório foi avisado.' },
    recusar: { status: 'recusado', confirmar: 'Recusar este orçamento? O escritório será avisado.', ok: 'Orçamento recusado. O escritório foi avisado.' },
    reabrir: { status: 'analise_cliente', confirmar: null, ok: 'Voltou para análise. O escritório foi avisado.' }
  };

  $('orcLista').addEventListener('change', async (e) => {
    const menu = e.target.closest('select[data-acao-decisao]');
    if (menu) {
      const linhaMenu = menu.closest('[data-id]');
      const decisaoMenu = { analise_cliente: DECISOES.reabrir, fechado: DECISOES.aprovar, recusado: DECISOES.recusar }[menu.value];
      if (!decisaoMenu) return;
      if (decisaoMenu.confirmar && !window.confirm(decisaoMenu.confirmar)) { await carregar().catch(() => {}); return; } // cancelou: volta o menu ao que era
      menu.disabled = true;
      try {
        await chamar(`/api/orcamentos/${LINK}/itens/${encodeURIComponent(linhaMenu.dataset.id)}/status`, enviarJson('PUT', { status: decisaoMenu.status }));
        await carregar();
        avisar(decisaoMenu.ok);
      } catch (err) { avisar(err.message, true); await carregar().catch(() => {}); }
      return;
    }
    const caixa = e.target.closest('input[data-somar]');
    const linhaEl = caixa && caixa.closest('[data-id]');
    if (!linhaEl) return;
    if (caixa.checked) somar.add(linhaEl.dataset.id); else somar.delete(linhaEl.dataset.id);
    gravarSomar(); atualizarTotais(); // só o rodapé muda: não refaz a lista (não perde o que está sendo digitado)
  });
  $('orcLista').addEventListener('click', async (e) => {
    const botaoSomar = e.target.closest('[data-acao-somar]');
    if (botaoSomar && dados) {
      somar = botaoSomar.dataset.acaoSomar === 'todos' ? new Set(dados.itens.filter(temValor).map((i) => i.id)) : new Set();
      gravarSomar();
      $('orcLista').querySelectorAll('input[data-somar]').forEach((c) => { c.checked = somar.has(c.closest('[data-id]').dataset.id); });
      atualizarTotais();
      return;
    }
    const botao = e.target.closest('[data-acao]');
    if (!botao) return;
    const cartaoEl = botao.closest('[data-id]');
    const id = cartaoEl.dataset.id;
    const decisaoDoClique = DECISOES[botao.dataset.acao];
    if (decisaoDoClique) {
      if (decisaoDoClique.confirmar && !window.confirm(decisaoDoClique.confirmar)) return;
      botao.disabled = true;
      try {
        await chamar(`/api/orcamentos/${LINK}/itens/${encodeURIComponent(id)}/status`, enviarJson('PUT', { status: decisaoDoClique.status }));
        await carregar();
        avisar(decisaoDoClique.ok);
      } catch (err) { avisar(err.message, true); await carregar().catch(() => {}); }
      return;
    }
    if (botao.dataset.acao === 'conversa') {
      const caixa = cartaoEl.querySelector('.orc-conversa');
      caixa.hidden = !caixa.hidden;
      if (caixa.hidden) abertos.delete(id); else { abertos.add(id); const it = dados.itens.find((x) => x.id === id); if (it) { marcarVistos(it); botao.classList.remove('tem-novo'); botao.innerHTML = textoBotaoComentarios(it); botao.title = tituloBotaoComentarios(it); } }
    } else if (botao.dataset.acao === 'enviar') {
      const area = cartaoEl.querySelector('textarea');
      const texto = area.value.trim();
      if (!texto) { avisar('Escreva o comentário antes de enviar.', true); return; }
      botao.disabled = true;
      try {
        await chamar(`/api/orcamentos/${LINK}/itens/${encodeURIComponent(id)}/comentarios`, enviarJson('POST', { texto }));
        abertos.add(id);
        await carregar();
        avisar('Comentário enviado. O escritório foi avisado.');
      } catch (err) { avisar(err.message, true); botao.disabled = false; }
    }
  });

  // ---------- Entrada: nome do projeto na tela de login e sessão lembrada ----------
  (async function iniciar() {
    try {
      const r = await fetch(`/api/orcamentos/${LINK}/info-publica`);
      if (r.status === 403) { // assinatura do escritório vencida: a pasta fica indisponível (nada foi apagado)
        const j = await r.json().catch(() => ({}));
        if (j.indisponivel) { document.body.innerHTML = '<div style="padding:60px 24px; text-align:center; color:#9a9ea5; font-family:sans-serif;"></div>'; document.body.firstChild.textContent = j.erro || 'Esta pasta está temporariamente indisponível. Fale com o escritório responsável pelo seu projeto.'; return; }
      }
      if (!r.ok) { document.body.innerHTML = '<div style="padding:60px 24px; text-align:center; color:#9a9ea5; font-family:sans-serif;">Link não encontrado -- confira se você copiou o endereço completo que recebeu.</div>'; return; }
      const info = await r.json();
      $('tituloLogin').textContent = `Orçamentos — ${info.nomeProjeto}`;
      if (window.TemaCores) window.TemaCores.aplicar(info.cores); // cor de destaque do escritório (sem cor = o visual de sempre)
      if (info.iconeUrl) { $('imgLogoLogin').src = info.iconeUrl; $('imgLogoOrc').src = info.iconeUrl; }
    } catch (e) { /* a tela de login continua com o título genérico */ }
    try { token = localStorage.getItem(CHAVE_TOKEN); } catch (e) { token = null; }
    if (token) { try { await carregar(); } catch (e) { sairParaLogin(); } }
  })();
})();
