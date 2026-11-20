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
  const ROTULO = { a_fazer: 'À fazer', evf: 'EVF', em_andamento: 'Em andamento', analise_cliente: 'Para sua análise', fechado: 'Fechado', recusado: 'Recusado' };
  const TITULO_GRUPO = { analise_cliente: 'Para sua análise', em_andamento: 'Em andamento', evf: 'EVF', a_fazer: 'À fazer', fechado: 'Fechados', recusado: 'Recusados' };
  const ORDEM_GRUPOS = ['analise_cliente', 'em_andamento', 'evf', 'a_fazer', 'fechado', 'recusado'];

  let token = null;
  let dados = null;
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

  // Decisão do cliente: botões grandes e claros em vez de um menu escondido.
  const ROTULO_SITUACAO = { analise_cliente: 'Aguardando sua decisão', fechado: 'Aprovado por você', recusado: 'Recusado por você' };
  function decisao(item) {
    if (!item.podeMudarStatus) return '';
    if (item.status === 'fechado' || item.status === 'recusado') {
      return `<div class="orc-decisao"><span class="orc-decisao-texto">${item.status === 'fechado' ? '✓ Você aprovou este orçamento.' : '✕ Você recusou este orçamento.'}</span>
        <button class="orc-botao" data-acao="reabrir" title="Voltar para análise e decidir de novo">Alterar decisão</button></div>`;
    }
    return `<div class="orc-decisao"><button class="orc-botao aprovar" data-acao="aprovar">✓ Aprovar orçamento</button><button class="orc-botao recusar" data-acao="recusar">✕ Recusar</button></div>`;
  }

  function cartao(item) {
    const href = hrefSeguro(item.url);
    const telefone = String(item.telefone || '').replace(/[^0-9+()\-\s]/g, '').trim();
    const quem = [item.empresa, item.representante].filter(Boolean).map(esc).join(' · ');
    const aberto = abertos.has(item.id);
    const comentarios = item.comentarios.map((c) => `<div class="orc-msg ${c.autor === 'cliente' ? 'minha' : 'escritorio'}"><span class="orc-msg-autor">${c.autor === 'cliente' ? 'Você' : 'Escritório'}</span>${esc(c.texto)}</div>`).join('');
    return `<article class="orc-card status-${esc(item.status)}" data-id="${esc(item.id)}">
      <div class="orc-card-topo">
        <h3>${esc(item.item)}</h3>
        <span class="orc-selo s-${esc(item.status)}">${esc(ROTULO_SITUACAO[item.status] || ROTULO[item.status] || item.status)}</span>
      </div>
      ${quem ? `<div class="orc-linha">${quem}</div>` : ''}
      ${telefone ? `<div class="orc-linha"><a href="tel:${esc(telefone)}">${esc(item.telefone)}</a></div>` : ''}
      <div class="orc-valor">${moeda(item.valor)}</div>
      ${item.observacao ? `<div class="orc-obs">${esc(item.observacao)}</div>` : ''}
      ${decisao(item)}
      <div class="orc-acoes">
        ${href ? `<a class="orc-botao principal" href="${esc(href)}" target="_blank" rel="noopener noreferrer">Abrir orçamento ↗</a>` : ''}
        <button class="orc-botao" data-acao="conversa">Comentários (${item.comentarios.length})</button>
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

  function renderizar() {
    const itens = dados.itens;
    if (!itens.length) { $('orcLista').innerHTML = '<div class="vazio-galeria">Ainda não há orçamentos por aqui. Volte em breve!</div>'; return; }
    $('orcLista').innerHTML = ORDEM_GRUPOS.map((st) => {
      const doGrupo = itens.filter((i) => i.status === st);
      return doGrupo.length ? `<section class="orc-grupo"><h2>${esc(TITULO_GRUPO[st])} <span>${doGrupo.length}</span></h2>${doGrupo.map(cartao).join('')}</section>` : '';
    }).join('');
  }

  async function carregar() {
    dados = await chamar(`/api/orcamentos/${LINK}/itens`);
    $('telaLogin').style.display = 'none'; $('telaOrcamentos').style.display = 'block';
    $('nomeProjetoOrc').textContent = dados.nomeProjeto;
    document.title = `${dados.nomeProjeto} — Orçamentos`;
    renderizar();
  }

  const DECISOES = {
    aprovar: { status: 'fechado', confirmar: 'Aprovar este orçamento? O escritório será avisado.', ok: 'Orçamento aprovado. O escritório foi avisado.' },
    recusar: { status: 'recusado', confirmar: 'Recusar este orçamento? O escritório será avisado.', ok: 'Orçamento recusado. O escritório foi avisado.' },
    reabrir: { status: 'analise_cliente', confirmar: null, ok: 'Voltou para análise. O escritório foi avisado.' }
  };

  $('orcLista').addEventListener('click', async (e) => {
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
      if (caixa.hidden) abertos.delete(id); else abertos.add(id);
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
      if (!r.ok) { document.body.innerHTML = '<div style="padding:60px 24px; text-align:center; color:#9a9ea5; font-family:sans-serif;">Link não encontrado -- confira se você copiou o endereço completo que recebeu.</div>'; return; }
      const info = await r.json();
      $('tituloLogin').textContent = `Orçamentos — ${info.nomeProjeto}`;
      if (info.iconeUrl) { $('imgLogoLogin').src = info.iconeUrl; $('imgLogoOrc').src = info.iconeUrl; }
    } catch (e) { /* a tela de login continua com o título genérico */ }
    try { token = localStorage.getItem(CHAVE_TOKEN); } catch (e) { token = null; }
    if (token) { try { await carregar(); } catch (e) { sairParaLogin(); } }
  })();
})();
