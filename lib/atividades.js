// lib/atividades.js
// Registro de atividades (acessos e ações): quem abriu o quê e quando, SEM conteúdo. Serve pro arquiteto saber "o cliente abriu a pasta",
// "alguém errou a senha do dashboard", "a pasta foi excluída" -- e pra investigar algo estranho.
// Privacidade (LGPD, minimização): nenhum texto de comentário, nome ou valor; o IP é guardado só pela METADE (IPv4 com o último número
// zerado, IPv6 só os 3 primeiros blocos), o suficiente pra reconhecer um acesso diferente sem identificar a pessoa. Fica só no arquivo do
// servidor, ligado à conta dona (cada arquiteto lê apenas o que é da própria conta) e é apagado depois de 180 dias.
// Formato: uma linha JSON por evento (atividades.jsonl, ao lado do arquivo de dados). Nunca derruba quem chamou.
const fs = require('fs');
const path = require('path');

const RETENCAO_DIAS = 180;
const JANELA_REPETIDO_MS = 30 * 60 * 1000; // "cliente abriu" não vira uma linha por clique: no máximo uma a cada 30 min por projeto e aparelho
const TIPOS = [
  'cliente_login', 'cliente_login_falha', 'cliente_abriu', 'cliente_aprovou', 'cliente_desaprovou', 'cliente_comentou',
  'escritorio_abriu', 'orcamentos_login', 'orcamentos_login_falha',
  'dashboard_login', 'dashboard_login_falha', 'dashboard_senha_trocada', 'pasta_excluida'
];
const vistosRecentemente = new Map();

const caminhoDoRegistro = (caminhoEstado) => path.join(path.dirname(caminhoEstado), 'atividades.jsonl');

// 187.12.34.56 -> 187.12.34.0 ;  2804:14d:1234:5678::1 -> 2804:14d:1234:: ; qualquer outra coisa -> ''
function anonimizarIp(ip) {
  const texto = String(ip || '').trim().replace(/^::ffff:/i, '');
  const v4 = texto.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0`;
  if (/^[0-9a-f:]+$/i.test(texto) && texto.includes(':')) return texto.split(':').slice(0, 3).join(':') + '::';
  return '';
}

// evento: { tipo, licenca, projetoId?, ip?, detalhe? }  (detalhe: texto curto SEM dado pessoal, ex. o nome da aba)
function registrar(caminhoEstado, evento) {
  try {
    if (!evento || !TIPOS.includes(evento.tipo) || !evento.licenca) return false;
    if (evento.tipo === 'cliente_abriu') {
      const chave = `${evento.projetoId}|${anonimizarIp(evento.ip)}`;
      const antes = vistosRecentemente.get(chave) || 0;
      if (Date.now() - antes < JANELA_REPETIDO_MS) return false;
      vistosRecentemente.set(chave, Date.now());
      if (vistosRecentemente.size > 5000) vistosRecentemente.clear();
    }
    const linha = JSON.stringify({
      t: new Date().toISOString(), tipo: evento.tipo, licenca: String(evento.licenca), projetoId: evento.projetoId ? String(evento.projetoId) : null,
      ip: anonimizarIp(evento.ip), detalhe: evento.detalhe ? String(evento.detalhe).slice(0, 80) : ''
    });
    const arquivo = caminhoDoRegistro(caminhoEstado);
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    fs.appendFileSync(arquivo, linha + '\n');
    return true;
  } catch (e) { return false; }
}

function lerTodas(caminhoEstado) {
  const arquivo = caminhoDoRegistro(caminhoEstado);
  if (!fs.existsSync(arquivo)) return [];
  const saida = [];
  fs.readFileSync(arquivo, 'utf8').split('\n').forEach((l) => { if (!l) return; try { saida.push(JSON.parse(l)); } catch (e) { /* linha quebrada: ignora */ } });
  return saida;
}

// Só os eventos da CONTA pedida (posse): com projetoId = daquele projeto; sem projetoId = os da conta (dashboard). Mais novos primeiro.
function listar(caminhoEstado, { licenca, projetoId, limite = 200 } = {}) {
  if (!licenca) return [];
  return lerTodas(caminhoEstado)
    .filter((e) => e.licenca === licenca && (projetoId ? e.projetoId === projetoId : !e.projetoId))
    .sort((a, b) => (a.t < b.t ? 1 : -1))
    .slice(0, Math.max(1, Math.min(Number(limite) || 200, 500)))
    .map(({ t, tipo, ip, detalhe }) => ({ quando: t, tipo, ip, detalhe }));
}

// Apaga o que passou de 180 dias (reescreve o arquivo). -> quantas linhas saíram
function limparAntigas(caminhoEstado, agora = Date.now()) {
  try {
    const todas = lerTodas(caminhoEstado);
    const corte = agora - RETENCAO_DIAS * 24 * 60 * 60 * 1000;
    const ficam = todas.filter((e) => Date.parse(e.t) >= corte);
    if (ficam.length === todas.length) return 0;
    const arquivo = caminhoDoRegistro(caminhoEstado);
    const temp = arquivo + '.tmp';
    fs.writeFileSync(temp, ficam.map((e) => JSON.stringify(e)).join('\n') + (ficam.length ? '\n' : ''));
    fs.renameSync(temp, arquivo);
    return todas.length - ficam.length;
  } catch (e) { return 0; }
}

// Quando o projeto some, os registros dele também (eliminação): remove tudo daquele projeto, menos o próprio aviso de exclusão.
function apagarDoProjeto(caminhoEstado, licenca, projetoId) {
  try {
    const todas = lerTodas(caminhoEstado);
    const ficam = todas.filter((e) => !(e.licenca === licenca && e.projetoId === projetoId));
    if (ficam.length === todas.length) return 0;
    const arquivo = caminhoDoRegistro(caminhoEstado);
    const temp = arquivo + '.tmp';
    fs.writeFileSync(temp, ficam.map((e) => JSON.stringify(e)).join('\n') + (ficam.length ? '\n' : ''));
    fs.renameSync(temp, arquivo);
    return todas.length - ficam.length;
  } catch (e) { return 0; }
}

module.exports = { TIPOS, RETENCAO_DIAS, anonimizarIp, registrar, listar, limparAntigas, apagarDoProjeto, caminhoDoRegistro };
