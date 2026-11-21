// Recursos da licença do DONO de uma Pasta do Cliente, consultados AO VIVO no servidor de licença (nov/2026).
//
// Por quê: o lado do cliente final (hub, tema claro/escuro, memorial, orçamentos, dashboard online) decidia pela CÓPIA dos recursos guardada em
// cada galeria, que só se atualizava quando o arquiteto abria o projeto no app. Trocar a conta de Completa para Básica não chegava aos clientes
// dos projetos que o arquiteto não abrisse. Agora o servidor pergunta ao servidor de licença (com cache curto) e a troca vale pra todos os projetos.
//
// Segurança e robustez:
//  - A pergunta é servidor-a-servidor e leva um SEGREDO COMPARTILHADO (header x-segredo-servidores); nada disso passa pelo navegador nem pelo app.
//  - Sem URL/segredo configurados (ou com o servidor de licença antigo, sem a rota), tudo funciona EXATAMENTE como antes (usa a cópia da galeria).
//  - Se o servidor de licença cair, vale o ÚLTIMO valor confirmado (cache vencido ou a cópia da galeria): o site do cliente nunca cai por causa disso.
//  - Cache por conta (padrão 60 s), uma única consulta por vez por conta, e falha não é reconsultada a cada pedido (espera `falhaMs`).
//  - A cada resposta confirmada, a cópia guardada nas galerias da conta é atualizada (`aoConfirmar`), então até a reserva fica em dia.
const NOMES = ['paginaProjeto', 'orcamentos', 'memorial'];

function normalizar(r) {
  const saida = {};
  NOMES.forEach((n) => { saida[n] = !!(r && r[n] === true); });
  return saida;
}

function criarResolvedor({ urlLicenca, segredo, ttlMs = 60000, falhaMs = 15000, timeoutMs = 4000, fetchFn = fetch, agora = () => Date.now(), aoConfirmar = null, aviso = () => {} } = {}) {
  const ativo = !!(urlLicenca && segredo);
  const cache = new Map();      // usuario -> { recursos, em }
  const falhas = new Map();     // usuario -> quando falhou pela última vez
  const emVoo = new Map();      // usuario -> Promise (evita consultas repetidas ao mesmo tempo)

  async function consultar(usuario) {
    const controle = new AbortController();
    const t = setTimeout(() => controle.abort(), timeoutMs);
    try {
      const resp = await fetchFn(`${String(urlLicenca).replace(/\/$/, '')}/api/recursos-da-conta-servidor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-segredo-servidores': segredo },
        body: JSON.stringify({ usuario }),
        signal: controle.signal
      });
      if (!resp.ok) throw new Error('resposta ' + resp.status);
      const dados = await resp.json();
      if (!dados || typeof dados !== 'object' || typeof dados.recursos !== 'object' || dados.recursos === null) throw new Error('resposta inesperada');
      // `ativa`: assinatura em dia. Servidor de licença antigo (sem o campo) = em dia. Conta apagada vem com tudo falso: vale (sem recurso).
      return { recursos: normalizar(dados.recursos), ativa: dados.ativa !== false };
    } finally { clearTimeout(t); }
  }

  // `copia` = a cópia guardada na galeria (reserva); `ativaCopia` = se a conta estava em dia da última vez que se soube (reserva).
  // Devolve { recursos: { paginaProjeto, orcamentos, memorial } | null (não há como saber), ativa }.
  async function obterEstado(usuario, copia, ativaCopia = true) {
    const reserva = { recursos: copia ? normalizar(copia) : null, ativa: ativaCopia !== false };
    if (!ativo || !usuario) return reserva;
    const t = agora();
    const guardado = cache.get(usuario);
    if (guardado && t - guardado.em < ttlMs) return guardado;
    const falhou = falhas.get(usuario);
    if (falhou && t - falhou < falhaMs) return guardado || reserva;
    if (!emVoo.has(usuario)) {
      emVoo.set(usuario, (async () => {
        try {
          const novos = await consultar(usuario);
          cache.set(usuario, { recursos: novos.recursos, ativa: novos.ativa, em: agora() });
          falhas.delete(usuario);
          if (aoConfirmar) { try { aoConfirmar(usuario, novos.recursos, novos.ativa); } catch (e) { /* a reserva é só um reforço */ } }
          return { recursos: novos.recursos, ativa: novos.ativa };
        } catch (e) {
          falhas.set(usuario, agora());
          aviso(`Não consegui confirmar os recursos de uma conta no servidor de licença (${e.message}); usando o último valor conhecido.`);
          return null;
        } finally { emVoo.delete(usuario); }
      })());
    }
    const resultado = await emVoo.get(usuario);
    if (resultado) return resultado;
    return guardado || reserva;
  }
  // Só os recursos (como antes).
  async function obter(usuario, copia) { return (await obterEstado(usuario, copia)).recursos; }

  return { obter, obterEstado, ativo, limparCache: () => { cache.clear(); falhas.clear(); } };
}

module.exports = { criarResolvedor, normalizar, NOMES };
