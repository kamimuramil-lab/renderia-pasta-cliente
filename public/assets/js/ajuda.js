// ajuda.js -- (1) contatos do escritório (WhatsApp, e-mail, Instagram) e (2) o balão "?" no canto inferior direito da Pasta do Cliente.
//
// O balão explica a tela em que o cliente está (o que é, o que ele encontra, como interagir) e tem um atalho pro WhatsApp do
// escritório, quando o arquiteto cadastrou o número nas Configurações do RENDERIA. Os contatos vêm da galeria
// (`contatosEscritorio`, `nomeEscritorio`); sem contato cadastrado o balão só explica, sem o botão do WhatsApp.
// Serve a página do projeto (index.html) e a de orçamentos (orcamentos.html): quem usa chama `AjudaCliente.iniciar({...})`.
(function () {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- contatos ----------
  // 5511912345678 -> "+55 (11) 91234-5678"; outros países só ganham o "+".
  function formatarWhatsapp(d) {
    const n = String(d || '').replace(/\D+/g, '');
    const m = n.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
    return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : (n ? '+' + n : '');
  }
  function contatosValidos(c) {
    const x = c && typeof c === 'object' ? c : {};
    return {
      whatsapp: /^\d{10,15}$/.test(String(x.whatsapp || '')) ? String(x.whatsapp) : '',
      email: /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(String(x.email || '')) ? String(x.email) : '',
      instagram: /^[A-Za-z0-9._]{1,30}$/.test(String(x.instagram || '')) ? String(x.instagram) : ''
    };
  }
  const linkWhatsapp = (numero, mensagem) => `https://wa.me/${numero}${mensagem ? '?text=' + encodeURIComponent(mensagem) : ''}`;
  const ICONE = {
    whatsapp: '<path d="M3 21l1.7-5A8.5 8.5 0 1 1 8 19.3L3 21z"/><path d="M9 9.5c.3 2 2.5 4.2 4.6 4.7l1.2-1.3-1.9-1-.8.6c-.8-.4-1.6-1.2-2-2l.6-.8-1-1.9z"/>',
    email: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    instagram: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r="1"/>'
  };
  const svg = (d) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

  // Rodapé da tela inicial: nome do escritório + os contatos cadastrados ('' = não há nada pra mostrar).
  function htmlRodape(nomeEscritorio, contatos, nomeProjeto) {
    const c = contatosValidos(contatos);
    const nome = String(nomeEscritorio || '').trim();
    const links = [];
    if (c.whatsapp) links.push(`<a class="rodape-contato" href="${esc(linkWhatsapp(c.whatsapp, `Olá! Estou vendo a pasta do projeto ${nomeProjeto || ''} e queria tirar uma dúvida.`))}" target="_blank" rel="noopener noreferrer">${svg(ICONE.whatsapp)}<span>${esc(formatarWhatsapp(c.whatsapp))}</span></a>`);
    if (c.email) links.push(`<a class="rodape-contato" href="mailto:${esc(c.email)}">${svg(ICONE.email)}<span>${esc(c.email)}</span></a>`);
    if (c.instagram) links.push(`<a class="rodape-contato" href="https://instagram.com/${esc(c.instagram)}" target="_blank" rel="noopener noreferrer">${svg(ICONE.instagram)}<span>@${esc(c.instagram)}</span></a>`);
    if (!nome && !links.length) return '';
    return `<footer class="hub-rodape">${nome ? `<div class="hub-rodape-nome">${esc(nome)}</div>` : ''}${links.length ? `<div class="hub-rodape-links">${links.join('')}</div>` : ''}</footer>`;
  }

  // ---------- textos do balão, por tela ----------
  // Cada tela: título, uma frase do que é, a lista "o que você encontra" e "como usar".
  const TEXTOS = {
    inicio: {
      titulo: 'Sua pasta do projeto',
      oque: 'Esta é a tela inicial do seu projeto. Cada cartão é uma pasta com um tipo de conteúdo; toque em um para abrir.',
      lista: [
        ['Planta original e Projeto conceitual', 'documentos para consultar.'],
        ['Projeto criativo', 'as imagens do projeto (e em 360°). Em cada uma você pode aprovar ou pedir alteração.'],
        ['Projeto executivo', 'os desenhos técnicos da obra. Use sempre o arquivo com status ATUAL.'],
        ['Fotos', 'registros das visitas à obra.'],
        ['Memorial de itens', 'a lista do que será comprado, com foto, medidas e especificações.']
      ],
      como: ['Uma bolinha vermelha com número num cartão avisa que há novidades ali desde a sua última visita.', 'O botão da lua/sol, no topo, troca entre o tema claro e o escuro.']
    },
    documentos: {
      titulo: 'Documentos desta pasta',
      oque: 'Aqui ficam os arquivos desta pasta, cada um com a revisão (REV.) e o status.',
      lista: [['ATUAL', 'é a versão vigente: use esta.'], ['REVISÃO', 'está sendo revisada: espere a nova versão antes de executar ou orçar.'], ['ANTIGA', 'versão substituída: não use para obra nem orçamento.']],
      como: ['Toque em “Abrir” para ver o arquivo numa nova aba. Se ele estiver em revisão ou for antigo, o sistema avisa antes de abrir.', 'Para voltar, use o botão “Tela inicial” no topo.']
    },
    memorial: {
      titulo: 'Memorial de itens',
      oque: 'A lista de tudo que compõe o projeto, separada por setor, com foto, ambiente, empresa, especificações, dimensões e quantidade.',
      lista: [['Filtro de setor', 'mostra só um setor (ou todos).'], ['Foto', 'toque para ampliar.'], ['Ver produto', 'abre o link do item.']],
      como: ['“Gerar PDF” salva a lista (do setor escolhido ou de todos). No celular abre uma aba nova: toque em “Salvar como PDF”.', 'Confirme medidas e modelos com o escritório antes de comprar.']
    },
    galeria: {
      titulo: 'Imagens do projeto',
      oque: 'Aqui estão as imagens do seu projeto, separadas por ambiente.',
      lista: [['Toque num ambiente', 'para ver as imagens dele.'], ['Aprovar essa imagem', 'confirma que você gostou.'], ['Solicitar alteração', 'desenhe sobre a imagem e escreva o que quer mudar.'], ['Anotações', 'mostram o histórico do que já foi pedido.']],
      como: ['Use as setas (ou deslize) para passar de imagem; no fim do ambiente a seta leva ao próximo.', 'Imagens em 360°: arraste para olhar ao redor.', '“Baixar PDF” gera um PDF com os ambientes que você escolher.']
    },
    planta: {
      titulo: 'Planta baixa',
      oque: 'A planta do projeto com os pontos de onde cada imagem foi feita.',
      lista: [['Ícone de câmera', 'uma imagem daquele ponto.'], ['Pin vermelho', 'imagem em 360°.'], ['Visto verde', 'imagem aprovada.'], ['Aviso laranja', 'alteração solicitada.']],
      como: ['Toque num ícone para abrir a imagem. O leque azul mostra para onde a câmera olha.', 'Aumente com a pinça (ou os botões + e −) e arraste para se mover.', '“Galeria” mostra as mesmas imagens em lista.']
    },
    orcamentos: {
      titulo: 'Pasta de orçamentos',
      oque: 'Aqui estão os orçamentos dos itens do projeto, para você acompanhar e decidir.',
      lista: [['Abrir orçamento', 'abre o arquivo da proposta.'], ['Decisão', 'escolha Aprovado, Recusado ou Em análise nos orçamentos liberados para você.'], ['Ícone de mensagem', 'conversa com o escritório sobre aquele orçamento.'], ['Somar', 'marque os orçamentos que quer somar no total.']],
      como: ['Uma bolinha indica orçamento novo ou atualizado desde a sua última visita.']
    }
  };
  const TELA_DA_SECAO = { planta_original: 'documentos', conceitual: 'documentos', executivo: 'documentos', visitas: 'documentos', memorial: 'memorial' };
  const COMPLEMENTO_EXECUTIVO = 'Neste projeto executivo, confira que o arquivo é o ATUAL antes de mandar para a obra ou para um fornecedor.';

  let cfg = null; // { nomeProjeto, nomeEscritorio, contatos, telaAtual: () => 'inicio'|'galeria'|... , cartoes: () => ['planta_original', ...] }
  let botao = null, painel = null;

  function conteudoDaTela(tela) {
    const chave = tela.startsWith('secao:') ? (TELA_DA_SECAO[tela.slice(6)] || 'documentos') : tela;
    const base = TEXTOS[chave] || TEXTOS.inicio;
    const extra = tela === 'secao:executivo' ? `<p class="ajuda-aviso">${esc(COMPLEMENTO_EXECUTIVO)}</p>` : '';
    return `<h3>${esc(base.titulo)}</h3><p>${esc(base.oque)}</p>
      <ul>${base.lista.map(([a, b]) => `<li><b>${esc(a)}</b>: ${esc(b)}</li>`).join('')}</ul>
      <div class="ajuda-como"><span>Como usar</span>${base.como.map((t) => `<p>${esc(t)}</p>`).join('')}</div>${extra}`;
  }
  function blocoWhatsapp() {
    const c = contatosValidos(cfg.contatos);
    if (!c.whatsapp) return '';
    const tela = cfg.nomeDaTela ? cfg.nomeDaTela() : '';
    const msg = `Olá! Estou vendo a pasta do projeto ${cfg.nomeProjeto || ''}${tela ? ` (${tela})` : ''} e queria tirar uma dúvida.`;
    return `<a class="ajuda-whats" href="${esc(linkWhatsapp(c.whatsapp, msg))}" target="_blank" rel="noopener noreferrer">${svg(ICONE.whatsapp)}<span>Tirar dúvidas no WhatsApp${cfg.nomeEscritorio ? ` com ${esc(cfg.nomeEscritorio)}` : ''}</span></a>`;
  }

  function abrir() {
    if (!cfg || !painel) return;
    painel.innerHTML = `<div class="ajuda-topo"><strong>Ajuda</strong><button type="button" class="ajuda-fechar" aria-label="Fechar a ajuda">✕</button></div>
      <div class="ajuda-corpo">${conteudoDaTela(cfg.telaAtual())}</div>${blocoWhatsapp() ? `<div class="ajuda-rodape">${blocoWhatsapp()}</div>` : ''}`;
    painel.hidden = false;
    botao.setAttribute('aria-expanded', 'true');
    painel.querySelector('.ajuda-fechar').addEventListener('click', fechar);
    painel.querySelector('.ajuda-corpo').scrollTop = 0;
  }
  function fechar() { if (!painel) return; painel.hidden = true; botao.setAttribute('aria-expanded', 'false'); }

  // opcoes: { nomeProjeto, nomeEscritorio, contatos, telaAtual() -> 'inicio'|'galeria'|'planta'|'memorial'|'orcamentos'|'secao:<id>', nomeDaTela()? }
  function iniciar(opcoes) {
    cfg = opcoes || {};
    if (!botao) {
      botao = document.createElement('button');
      botao.type = 'button'; botao.className = 'ajuda-botao'; botao.id = 'btnAjudaCliente';
      botao.setAttribute('aria-label', 'Ajuda: o que é esta página e como usar'); botao.setAttribute('aria-expanded', 'false'); botao.title = 'Ajuda';
      botao.innerHTML = '<span aria-hidden="true">?</span>';
      painel = document.createElement('div');
      painel.className = 'ajuda-painel'; painel.id = 'painelAjudaCliente'; painel.hidden = true; painel.setAttribute('role', 'dialog'); painel.setAttribute('aria-label', 'Ajuda');
      document.body.appendChild(painel); document.body.appendChild(botao);
      botao.addEventListener('click', () => (painel.hidden ? abrir() : fechar()));
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !painel.hidden) fechar(); });
      document.addEventListener('click', (e) => { if (!painel.hidden && !painel.contains(e.target) && !botao.contains(e.target)) fechar(); });
    }
    botao.hidden = false;
  }
  function esconder() { if (botao) { botao.hidden = true; fechar(); } }

  window.AjudaCliente = { iniciar, esconder, abrir, fechar, htmlRodape, formatarWhatsapp, contatosValidos, linkWhatsapp, TEXTOS };
})();
