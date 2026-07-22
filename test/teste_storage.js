const assert = require('assert');
const storage = require('/home/claude/pasta-cliente/lib/storage');

// Não temos credenciais reais do R2 aqui -- então o que dá pra testar
// sem rede é: o módulo detecta corretamente que não está configurado, em
// vez de tentar conectar em algo indefinido e travar/dar um erro confuso.
console.log('== 1. Sem as variáveis de ambiente configuradas, dá erro claro (não trava, não conecta em nada) ==');
delete process.env.R2_ENDPOINT;
delete process.env.R2_ACCESS_KEY_ID;
delete process.env.R2_SECRET_ACCESS_KEY;
delete process.env.R2_BUCKET;

async function testar() {
  await assert.rejects(
    () => storage.salvarArquivo('teste/arquivo.webp', Buffer.from('abc'), 'image/webp'),
    /Armazenamento não configurado/
  );
  console.log('OK -- salvarArquivo rejeita corretamente');

  await assert.rejects(
    () => storage.excluirArquivo('teste/arquivo.webp'),
    /Armazenamento não configurado/
  );
  console.log('OK -- excluirArquivo rejeita corretamente');

  await assert.rejects(
    () => storage.urlTemporaria('teste/arquivo.webp'),
    /Armazenamento não configurado/
  );
  console.log('OK -- urlTemporaria rejeita corretamente');

  console.log('\nTESTES DE ARMAZENAMENTO (SEM REDE) PASSARAM 🎉');
  console.log('NOTA: isso só confirma a validação de configuração -- o upload/download');
  console.log('de verdade só pode ser testado com credenciais reais do R2 configuradas.');
}

testar();
