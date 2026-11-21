// lib/drive-arquivo.js
// Busca, NO SERVIDOR, o arquivo (PDF ou imagem) de um link do Google Drive pra lousa de apresentação (modo escritório). O navegador não consegue
// ler o Drive direto (o Google não libera CORS), então o servidor busca e entrega o arquivo na mesma origem do site.
//
// Segurança (é um "proxy", então o cuidado é não virar porta pra buscar qualquer coisa):
//  - só o ID do arquivo é aproveitado do link, e só de links do Google Drive/Docs; o endereço buscado é SEMPRE o do Google (nunca o texto do link);
//  - redirecionamentos são seguidos à mão, no máximo 4, e só para hosts do Google (google.com / googleusercontent.com);
//  - o corpo é lido em pedaços e a leitura para ao passar do limite (60 MB por padrão); tempo máximo por pedido;
//  - o tipo é conferido pelos PRIMEIROS BYTES (PDF, PNG, JPEG, WEBP, GIF), nunca pelo cabeçalho: página HTML de "peça acesso"/login vira o erro
//    'nao-compartilhado' (o arquivo precisa estar como "Qualquer pessoa com o link").
const HOSTS_PERMITIDOS = /(^|\.)(google\.com|googleusercontent\.com)$/i;
const BASE_PADRAO = 'https://drive.usercontent.google.com';

function idDoDrive(url) {
  let u;
  try { u = new URL(String(url || '').trim()); } catch (e) { return null; }
  if (u.protocol !== 'https:' || !/^(drive|docs)\.google\.com$/i.test(u.hostname)) return null;
  const m = /\/(?:file|document|presentation|spreadsheets)\/d\/([A-Za-z0-9_-]{10,})/.exec(u.pathname) || /\/d\/([A-Za-z0-9_-]{10,})/.exec(u.pathname);
  const id = (m && m[1]) || u.searchParams.get('id');
  return id && /^[A-Za-z0-9_-]{10,}$/.test(id) ? id : null;
}

function tipoPelosBytes(buf) {
  if (buf.length >= 5 && buf.slice(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf.length >= 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.slice(0, 6).toString('latin1'))) return 'image/gif';
  return null;
}

class ErroDrive extends Error { constructor(codigo, mensagem) { super(mensagem); this.codigo = codigo; } }

// -> { buffer, tipo }. Lança ErroDrive com `codigo`: 'link-invalido' | 'nao-compartilhado' | 'grande-demais' | 'demorou' | 'falha'.
async function baixar(url, { fetchFn = fetch, base = BASE_PADRAO, limiteBytes = 60 * 1024 * 1024, timeoutMs = 60000, maxRedirecionamentos = 4 } = {}) {
  const id = idDoDrive(url);
  if (!id) throw new ErroDrive('link-invalido', 'O link do documento não é um arquivo do Google Drive.');
  const controle = new AbortController();
  const t = setTimeout(() => controle.abort(), timeoutMs);
  try {
    let alvo = `${String(base).replace(/\/$/, '')}/download?id=${encodeURIComponent(id)}&export=download&confirm=t`;
    let resp;
    for (let salto = 0; ; salto++) {
      resp = await fetchFn(alvo, { redirect: 'manual', signal: controle.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RENDERIA)' } });
      if (resp.status >= 300 && resp.status < 400 && resp.headers.get('location')) {
        if (salto >= maxRedirecionamentos) throw new ErroDrive('falha', 'Redirecionamentos demais ao buscar o arquivo.');
        const proximo = new URL(resp.headers.get('location'), alvo);
        const hostOk = HOSTS_PERMITIDOS.test(proximo.hostname) || (base !== BASE_PADRAO && proximo.origin === new URL(base).origin); // a 2ª parte só existe nos testes (servidor falso local)
        if (!hostOk || (proximo.protocol !== 'https:' && base === BASE_PADRAO)) throw new ErroDrive('falha', 'O Drive redirecionou para um endereço não permitido.');
        alvo = proximo.toString();
        continue;
      }
      break;
    }
    if (resp.status === 404) throw new ErroDrive('nao-compartilhado', 'Arquivo não encontrado no Drive (confira o link).');
    if (resp.status === 401 || resp.status === 403) throw new ErroDrive('nao-compartilhado', 'O Drive não liberou o arquivo: compartilhe como "Qualquer pessoa com o link".');
    if (!resp.ok) throw new ErroDrive('falha', 'O Drive respondeu ' + resp.status + '.');
    const declarado = Number(resp.headers.get('content-length') || 0);
    if (declarado && declarado > limiteBytes) throw new ErroDrive('grande-demais', `O arquivo tem ${Math.round(declarado / 1048576)} MB (limite ${Math.round(limiteBytes / 1048576)} MB).`);
    const pedacos = []; let total = 0;
    if (resp.body && typeof resp.body.getReader === 'function') {
      const leitor = resp.body.getReader();
      for (;;) {
        const { done, value } = await leitor.read();
        if (done) break;
        total += value.length;
        if (total > limiteBytes) { try { await leitor.cancel(); } catch (e) { /* já parou */ } throw new ErroDrive('grande-demais', `O arquivo passa de ${Math.round(limiteBytes / 1048576)} MB.`); }
        pedacos.push(Buffer.from(value));
      }
    } else {
      const b = Buffer.from(await resp.arrayBuffer()); total = b.length;
      if (total > limiteBytes) throw new ErroDrive('grande-demais', `O arquivo passa de ${Math.round(limiteBytes / 1048576)} MB.`);
      pedacos.push(b);
    }
    const buffer = Buffer.concat(pedacos);
    const tipo = tipoPelosBytes(buffer);
    if (!tipo) throw new ErroDrive('nao-compartilhado', 'O Drive não devolveu um PDF nem uma imagem: confira se o arquivo está compartilhado como "Qualquer pessoa com o link".');
    return { buffer, tipo };
  } catch (e) {
    if (e instanceof ErroDrive) throw e;
    if (e && e.name === 'AbortError') throw new ErroDrive('demorou', 'O Drive demorou demais para responder.');
    throw new ErroDrive('falha', 'Não consegui falar com o Drive.');
  } finally { clearTimeout(t); }
}

module.exports = { idDoDrive, tipoPelosBytes, baixar, ErroDrive, HOSTS_PERMITIDOS };
