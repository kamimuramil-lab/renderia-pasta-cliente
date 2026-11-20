// dados-projeto.js -- "Dados do projeto" (o bloco de texto no alto da página do cliente) com campos fixos.
//
// O arquiteto preenche CAMPOS (nome, projeto de interiores/arquitetura + m², endereço, e-mail, telefone); o texto guardado
// continua sendo o mesmo texto simples de sempre (uma linha por informação), então nada muda no servidor, nos PDFs nem em
// projetos antigos. O cliente lê esse texto e transforma endereço em link do Google Maps/Waze, e-mail em mailto: e telefone
// em tel:. Este MESMO arquivo existe em duas pastas (pasta-cliente/public/assets/js e skp-to-360-ia/renderer): o teste
// skp-to-360-ia/test/teste_dados_projeto.js confere que são idênticos.
(function (raiz) {
  const TIPOS = ['Interiores', 'Arquitetura'];

  function interpretar(texto) {
    const r = { nome: '', tipo: '', metragem: '', endereco: '', email: '', telefone: '', outras: [] };
    String(texto || '').split(/\r?\n/).forEach((bruta) => {
      const linha = bruta.trim();
      if (!linha) return;
      let m;
      if ((m = linha.match(/^nome(?:\s+do\s+cliente)?\s*:\s*(.*)$/i))) { r.nome = m[1].trim(); return; }
      if ((m = linha.match(/^projeto\s+de\s+(interiores|arquitetura)\b\s*[-–,:]?\s*([\d.,]*)\s*(?:m²|m2|m)?\s*$/i))) {
        r.tipo = m[1].toLowerCase() === 'interiores' ? 'Interiores' : 'Arquitetura';
        r.metragem = (m[2] || '').trim();
        return;
      }
      if ((m = linha.match(/^endere[cç]o(?:\s+do\s+projeto)?\s*:\s*(.*)$/i))) { r.endereco = m[1].trim(); return; }
      if ((m = linha.match(/^e-?mail\s*:\s*(.*)$/i))) { r.email = m[1].trim(); return; }
      if ((m = linha.match(/^(?:telefone|celular|fone|whatsapp)\s*:\s*(.*)$/i))) { r.telefone = m[1].trim(); return; }
      r.outras.push(linha);
    });
    return r;
  }

  // Campos -> texto (só as linhas preenchidas; "Outras informações" vai no fim, uma linha por linha).
  function compor(c) {
    const linhas = [];
    const nome = String(c.nome || '').trim();
    const tipo = TIPOS.includes(c.tipo) ? c.tipo : '';
    const metragem = String(c.metragem || '').replace(/\s*m[²2]?\s*$/i, '').trim();
    if (nome) linhas.push(`Nome do Cliente: ${nome}`);
    if (tipo || metragem) linhas.push(`Projeto de ${tipo || 'Interiores'}${metragem ? ` ${metragem}m²` : ''}`);
    if (String(c.endereco || '').trim()) linhas.push(`Endereço do Projeto: ${String(c.endereco).trim()}`);
    if (String(c.email || '').trim()) linhas.push(`E-mail: ${String(c.email).trim()}`);
    if (String(c.telefone || '').trim()) linhas.push(`Telefone: ${String(c.telefone).trim()}`);
    String(c.outras || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).forEach((l) => linhas.push(l));
    return linhas.join('\n');
  }

  // ---- links (só http/https e esquemas seguros: nada que venha do texto vira "javascript:") ----
  const mapaUrl = (endereco) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(endereco)}`;
  const wazeUrl = (endereco) => `https://waze.com/ul?q=${encodeURIComponent(endereco)}&navigate=yes`;
  const emailValido = (e) => /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(e);
  const mailtoUrl = (e) => `mailto:${e}`;
  function telUrl(t) {
    const digitos = String(t || '').replace(/[^\d+]/g, '');
    return digitos.replace(/\D/g, '').length >= 8 ? `tel:${digitos}` : null;
  }

  // Texto -> HTML da caixa do cliente. `esc` escapa HTML. E-mail e telefone ficam na MESMA linha quando vêm juntos.
  function htmlDosDados(texto, esc) {
    const c = interpretar(texto);
    const linhas = [];
    if (c.nome) linhas.push(`<div class="dado"><span class="dado-rotulo">Cliente</span> ${esc(c.nome)}</div>`);
    if (c.tipo || c.metragem) linhas.push(`<div class="dado"><span class="dado-rotulo">Projeto</span> ${esc(`${c.tipo || 'Interiores'}${c.metragem ? ` · ${c.metragem} m²` : ''}`)}</div>`);
    if (c.endereco) {
      linhas.push(`<div class="dado"><span class="dado-rotulo">Endereço</span> <a href="${esc(mapaUrl(c.endereco))}" target="_blank" rel="noopener noreferrer" title="Abrir no Google Maps">${esc(c.endereco)}</a>`
        + ` <a class="dado-chip" href="${esc(mapaUrl(c.endereco))}" target="_blank" rel="noopener noreferrer">Maps</a>`
        + `<a class="dado-chip" href="${esc(wazeUrl(c.endereco))}" target="_blank" rel="noopener noreferrer">Waze</a></div>`);
    }
    const contato = [];
    if (c.email) contato.push(`<span class="dado-item"><span class="dado-rotulo">E-mail</span> ${emailValido(c.email) ? `<a href="${esc(mailtoUrl(c.email))}" title="Enviar e-mail">${esc(c.email)}</a>` : esc(c.email)}</span>`);
    if (c.telefone) contato.push(`<span class="dado-item"><span class="dado-rotulo">Telefone</span> ${telUrl(c.telefone) ? `<a href="${esc(telUrl(c.telefone))}" title="Ligar">${esc(c.telefone)}</a>` : esc(c.telefone)}</span>`);
    if (contato.length) linhas.push(`<div class="dado dado-contato">${contato.join('')}</div>`);
    c.outras.forEach((l) => linhas.push(`<div class="dado">${esc(l)}</div>`));
    return linhas.join('');
  }

  const api = { TIPOS, interpretar, compor, mapaUrl, wazeUrl, mailtoUrl, telUrl, emailValido, htmlDosDados };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.DadosProjeto = api;
})(typeof window !== 'undefined' ? window : this);
