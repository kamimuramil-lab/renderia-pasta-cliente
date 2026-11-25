// senha-reversivel.js -- guarda a senha que o arquiteto definiu pro CLIENTE de um jeito que o próprio arquiteto consiga VER depois.
//
// Por quê: o login do cliente (bcrypt) não deixa recuperar a senha, e o arquiteto queria ver login e senha de cada projeto sempre na tela
// (o escritório controla todos os acessos). O hash continua sendo o que vale pra entrar; isto é só uma cópia CIFRADA (AES-256-GCM) pra exibir
// ao DONO da licença. Nunca sai nas rotas do cliente (galeriaComUrls tira o campo) nem em backup legível sem a chave.
//
// Chave: o segredo compartilhado dos servidores (RENDERIA_SEGREDO_SERVIDORES) quando existe; senão um arquivo de chave ao lado dos dados.
// O texto cifrado diz de qual das duas veio ('e' ou 'a'), então ligar o segredo depois não perde as senhas já guardadas.
// Qualquer falha ao ler (chave sumiu, texto estragado) devolve null = "senha não disponível": nunca derruba o servidor.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ARQUIVO_CHAVE = 'chave-senha-cliente.key';
const cacheEnv = new Map(); // segredo -> chave derivada (scrypt é lento de propósito)

function chaveDoSegredo(segredo) {
  if (!cacheEnv.has(segredo)) cacheEnv.set(segredo, crypto.scryptSync(String(segredo), 'renderia-senha-cliente-v1', 32));
  return cacheEnv.get(segredo);
}

function chaveDoArquivo(caminhoEstado, criar) {
  const arq = path.join(path.dirname(caminhoEstado), ARQUIVO_CHAVE);
  try {
    const hex = fs.readFileSync(arq, 'utf8').trim();
    if (/^[0-9a-f]{64}$/.test(hex)) return Buffer.from(hex, 'hex');
  } catch (e) { /* ainda não existe */ }
  if (!criar) return null;
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  const nova = crypto.randomBytes(32);
  try { fs.writeFileSync(arq, nova.toString('hex'), { mode: 0o600, flag: 'wx' }); } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    return chaveDoArquivo(caminhoEstado, false); // outro processo criou primeiro: usa a dele
  }
  return nova;
}

// -> 'v1.<origem>.<iv>.<tag>.<cifrado>' (base64url). Lança só se não houver como gravar a chave (disco sem permissão).
function cifrar(texto, caminhoEstado, ambiente) {
  const env = (ambiente || process.env).RENDERIA_SEGREDO_SERVIDORES;
  const origem = env ? 'e' : 'a';
  const chave = env ? chaveDoSegredo(env) : chaveDoArquivo(caminhoEstado, true);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', chave, iv);
  const dado = Buffer.concat([c.update(String(texto), 'utf8'), c.final()]);
  return ['v1', origem, iv.toString('base64url'), c.getAuthTag().toString('base64url'), dado.toString('base64url')].join('.');
}

// -> o texto, ou null se não der (formato inválido, chave diferente, texto adulterado).
function decifrar(cifra, caminhoEstado, ambiente) {
  try {
    const p = String(cifra || '').split('.');
    if (p.length !== 5 || p[0] !== 'v1') return null;
    let chave = null;
    if (p[1] === 'e') { const env = (ambiente || process.env).RENDERIA_SEGREDO_SERVIDORES; chave = env ? chaveDoSegredo(env) : null; }
    else if (p[1] === 'a') chave = chaveDoArquivo(caminhoEstado, false);
    if (!chave) return null;
    const d = crypto.createDecipheriv('aes-256-gcm', chave, Buffer.from(p[2], 'base64url'));
    d.setAuthTag(Buffer.from(p[3], 'base64url'));
    return Buffer.concat([d.update(Buffer.from(p[4], 'base64url')), d.final()]).toString('utf8');
  } catch (e) { return null; }
}

module.exports = { cifrar, decifrar, ARQUIVO_CHAVE };
