// lib/storage.js
// Fala com o Cloudflare R2 (que usa a mesma API do S3, então dá pra usar
// o SDK oficial da AWS apontando pro endpoint do R2). Todo o resto do
// código nunca importa @aws-sdk diretamente -- só fala com as funções
// daqui, então se um dia vocês quiserem trocar de provedor de
// armazenamento, é só reescrever este arquivo.
const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const fs = require('fs');
const path = require('path');

const BUCKET = process.env.R2_BUCKET || null;

// Modo de teste: sem credenciais reais do R2, grava em disco local. NUNCA
// usar isso em produção -- é só pra dar pra testar o fluxo inteiro (e os
// testes automatizados) sem precisar de uma conta R2 de verdade.
const MODO_LOCAL = process.env.ARMAZENAMENTO_LOCAL_TESTE === '1';
const PASTA_LOCAL = process.env.ARMAZENAMENTO_LOCAL_DIR || path.join(__dirname, '..', '_armazenamento_local_teste');

function clienteR2() {
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey || !BUCKET) {
    throw new Error('Armazenamento não configurado -- faltam as variáveis R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET.');
  }
  return new S3Client({
    region: 'auto', // R2 não usa regiões de verdade, mas o SDK exige o campo
    endpoint,
    credentials: { accessKeyId, secretAccessKey }
  });
}

// Salva um arquivo (Buffer) no R2, sob a chave (caminho) indicada.
async function salvarArquivo(chave, buffer, contentType) {
  if (MODO_LOCAL) {
    const destino = path.join(PASTA_LOCAL, chave);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, buffer);
    return chave;
  }
  const client = clienteR2();
  await client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: chave,
    Body: buffer,
    ContentType: contentType || 'application/octet-stream'
  }));
  return chave;
}

async function excluirArquivo(chave) {
  if (MODO_LOCAL) {
    const destino = path.join(PASTA_LOCAL, chave);
    if (fs.existsSync(destino)) fs.unlinkSync(destino);
    return;
  }
  const client = clienteR2();
  await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: chave }));
}

// Gera uma URL temporária (expira sozinha) pro navegador do cliente final
// buscar a imagem direto do R2 -- assim o servidor não precisa "repassar"
// cada byte de cada imagem, só entrega o link. `expiraEmSegundos` padrão
// de 1h é de sobra pra alguém ver uma galeria inteira numa sessão.
async function urlTemporaria(chave, expiraEmSegundos = 3600) {
  if (MODO_LOCAL) {
    return `local-teste://${chave}`; // não é uma URL de verdade, só pra teste conseguir conferir a referência
  }
  const client = clienteR2();
  const comando = new GetObjectCommand({ Bucket: BUCKET, Key: chave });
  return getSignedUrl(client, comando, { expiresIn: expiraEmSegundos });
}

module.exports = { salvarArquivo, excluirArquivo, urlTemporaria };
