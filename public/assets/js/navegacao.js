// navegacao.js -- o botão VOLTAR do navegador (e o gesto de voltar do celular) passa a andar pelas telas da própria Pasta do
// Cliente (início, uma pasta do hub, planta, galeria), em vez de sair da página.
//
// Como funciona: cada tela é "derivada" do que está visível (viewAtual) e, a cada troca, vira UMA entrada no histórico do
// navegador (pushState) com a descrição da tela. Ao voltar (popstate) a tela descrita é restaurada. O visualizador de imagem
// já tinha o histórico dele (main.js); aqui ele só é respeitado: nunca registramos tela enquanto ele está aberto.
// Os botões "Voltar" do próprio site, quando levam à tela anterior, usam o histórico de verdade (history.back) pra não
// empilhar entradas repetidas.
//
// Carregado DEPOIS do hub.js e do planta.js e ANTES do main.js (o handler de popstate daqui precisa rodar antes do do
// visualizador, que pode abrir uma tela por `acaoAposFecharVisualizador`).
(function () {
  const $ = (id) => document.getElementById(id);
  let restaurando = false;
  let idx = 0;
  const vistas = []; // vistas[i] = descrição da tela da entrada i do histórico (só desta aba/sessão de página)

  const visivel = (id) => { const e = $(id); return !!e && getComputedStyle(e).display !== 'none'; };
  const visualizadorAberto = () => visivel('visualizador');
  const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  function viewAtual() {
    if (visivel('telaPlanta')) return { t: 'planta', p: window.PlantaCliente && window.PlantaCliente.plantaAtual ? window.PlantaCliente.plantaAtual() : null };
    if (visivel('telaHub')) return { t: 'hub', s: window.HubCliente && window.HubCliente.secaoAberta ? window.HubCliente.secaoAberta() : null };
    if (visivel('telaGaleria')) return { t: 'galeria' };
    return null; // meio de uma troca (nada visível ainda): não registra
  }

  // Chamado no FIM de cada troca de tela.
  function sincronizar() {
    if (restaurando || visualizadorAberto()) return;
    const v = viewAtual();
    if (!v) return;
    const cur = history.state && history.state.renderiaTela;
    if (cur && igual(cur, v)) { vistas[idx] = v; return; }
    if (!cur) { idx = 0; vistas.length = 0; vistas[0] = v; history.replaceState({ renderiaTela: v, idx: 0 }, ''); return; }
    idx = (history.state.idx || 0) + 1;
    vistas.length = idx; // seguir por um caminho novo descarta o "futuro"
    vistas[idx] = v;
    history.pushState({ renderiaTela: v, idx }, '');
  }

  // Botões "Voltar" do site: se a tela de destino é justamente a anterior do histórico, volta DE VERDADE (sem empilhar).
  // Devolve true quando fez isso.
  function voltarSePossivel(destino) {
    if (restaurando || visualizadorAberto() || idx <= 0 || !vistas[idx - 1]) return false;
    if (!igual(vistas[idx - 1], destino)) return false;
    history.back();
    return true;
  }

  function restaurar(v) {
    if (!v) return;
    if (igual(viewAtual(), v)) return;
    restaurando = true;
    try {
      if (v.t === 'planta') {
        if (window.HubCliente) window.HubCliente.fechar();
        window.PlantaCliente.abrir(v.p || undefined);
      } else if (v.t === 'hub') {
        if (window.PlantaCliente) window.PlantaCliente.fechar();
        window.HubCliente.abrir(v.s || null);
      } else if (v.t === 'galeria') {
        if (window.HubCliente) window.HubCliente.fechar();
        if (window.PlantaCliente) window.PlantaCliente.fechar();
        $('telaGaleria').style.display = 'block';
        window.scrollTo(0, 0);
      }
    } catch (e) { /* tela que não existe mais: fica onde está */ } finally { restaurando = false; }
  }

  window.addEventListener('popstate', (e) => {
    const st = e.state;
    if (!st || !st.renderiaTela) return; // entrada do visualizador (ou de fora): o main.js cuida
    idx = st.idx || 0;
    vistas[idx] = st.renderiaTela;
    restaurar(st.renderiaTela);
  });

  window.NavCliente = { sincronizar, voltarSePossivel };
})();
