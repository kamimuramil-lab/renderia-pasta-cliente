// lib/backup.js
// Backup do arquivo de dados da Pasta do Cliente (dados-galerias.json) no Cloudflare R2, em pasta própria do bucket
// (_backups_sistema/pasta-cliente/), SEM misturar com as fotos dos clientes. Um backup por dia (o primeiro que for possível no dia),
// guardando os 60 mais recentes; antes de excluir uma Pasta do Cliente inteira sai mais um, na hora ("antes-de-excluir").
// O backup tem só TEXTO (dados, comentários, orçamentos, senhas já criptografadas): as fotos moram no próprio R2.
// Nunca faz backup de um arquivo ilegível (senão o backup bom seria trocado por um estragado).
// Privacidade: o dado apagado do sistema ainda existe nos backups por até 60 dias -- isso precisa constar na política de privacidade.
const fs = require('fs');
const storage = require('./storage');

const PREFIXO = '_backups_sistema/pasta-cliente/';
const MANTER = 60;

const doisDigitos = (n) => String(n).padStart(2, '0');
const dataUTC = (d) => `${d.getUTCFullYear()}-${doisDigitos(d.getUTCMonth() + 1)}-${doisDigitos(d.getUTCDate())}`;
const nomeDoDia = (d) => `${PREFIXO}estado-${dataUTC(d)}.json`;
const nomeAvulso = (d, motivo) => `${PREFIXO}estado-${d.toISOString().replace(/[:.]/g, '-')}-${String(motivo || 'manual').replace(/[^a-z0-9-]/gi, '')}.json`;

function lerArquivoValido(caminhoEstado) {
  if (!fs.existsSync(caminhoEstado)) return null; // ainda não há dados: nada pra guardar
  const texto = fs.readFileSync(caminhoEstado, 'utf8');
  JSON.parse(texto); // lança se estiver estragado
  return Buffer.from(texto, 'utf8');
}

async function limparAntigos(manter = MANTER) {
  const lista = (await storage.listarArquivos(PREFIXO)).sort((a, b) => (a.chave < b.chave ? 1 : -1)); // mais novos primeiro (a data está no nome)
  const apagar = lista.slice(manter);
  for (const a of apagar) { try { await storage.excluirArquivo(a.chave); } catch (e) { console.error('Backup: não consegui apagar o antigo', a.chave, e.message); } }
  return apagar.length;
}

// Faz o backup do dia se ainda não existe. -> { criado, chave }
async function garantirBackupDoDia(caminhoEstado, agora = new Date()) {
  const chave = nomeDoDia(agora);
  const existentes = await storage.listarArquivos(PREFIXO);
  if (existentes.some((a) => a.chave === chave)) return { criado: false, chave };
  const conteudo = lerArquivoValido(caminhoEstado);
  if (!conteudo) return { criado: false, chave, semDados: true };
  await storage.salvarArquivo(chave, conteudo, 'application/json');
  await limparAntigos();
  return { criado: true, chave };
}

// Backup na hora (antes de algo sem volta, como excluir uma Pasta do Cliente). -> { chave }
async function criarAgora(caminhoEstado, motivo, agora = new Date()) {
  const conteudo = lerArquivoValido(caminhoEstado);
  if (!conteudo) return { chave: null };
  const chave = nomeAvulso(agora, motivo);
  await storage.salvarArquivo(chave, conteudo, 'application/json');
  return { chave };
}

async function listar() {
  return (await storage.listarArquivos(PREFIXO)).sort((a, b) => (a.chave < b.chave ? 1 : -1));
}

// Liga a rotina: confere logo depois de subir e de 6 em 6 horas (o servidor reinicia a cada atualização; assim o dia nunca fica sem backup).
function iniciarRotina(caminhoEstado, { intervaloMs = 6 * 60 * 60 * 1000, primeiroEm = 45 * 1000, log = console } = {}) {
  const rodar = async () => {
    try {
      const r = await garantirBackupDoDia(caminhoEstado);
      if (r.criado) log.log('Backup do dia criado:', r.chave);
    } catch (e) { log.error('Backup do dia FALHOU:', e.message); }
  };
  const t1 = setTimeout(rodar, primeiroEm);
  const t2 = setInterval(rodar, intervaloMs);
  if (t1.unref) { t1.unref(); t2.unref(); } // não segura o processo aberto (testes)
  return { parar() { clearTimeout(t1); clearInterval(t2); }, rodar };
}

module.exports = { PREFIXO, MANTER, garantirBackupDoDia, criarAgora, limparAntigos, listar, iniciarRotina, nomeDoDia };
