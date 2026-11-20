// Restaura um backup do arquivo de dados da Pasta do Cliente. Rodar no servidor (Render > Shell), com as variáveis do R2 já presentes.
//   node restaurar-backup.js                 -> lista os backups (mais novo primeiro)
//   node restaurar-backup.js <chave-do-backup> -> grava o backup no lugar do arquivo de dados atual
// O arquivo atual NÃO é jogado fora: vira "dados-galerias.json.antes-da-restauracao-<data>". Depois de restaurar, reinicie o serviço no Render.
const fs = require('fs');
const path = require('path');
const storage = require('./lib/storage');
const backup = require('./lib/backup');
const galeria = require('./lib/galeria');

(async () => {
  const chave = process.argv[2];
  if (!chave) {
    const lista = await backup.listar();
    if (!lista.length) { console.log('Nenhum backup encontrado.'); return; }
    lista.forEach((b) => console.log(b.chave, ' ', new Date(b.modificadoEm).toISOString()));
    console.log('\nPara restaurar: node restaurar-backup.js <chave>');
    return;
  }
  if (!chave.startsWith(backup.PREFIXO)) throw new Error('Essa chave não é de um backup da Pasta do Cliente.');
  const conteudo = await storage.lerArquivo(chave);
  const estado = JSON.parse(conteudo.toString('utf8')); // confere que é um JSON de verdade antes de mexer em qualquer coisa
  if (!Array.isArray(estado.galerias)) throw new Error('O backup não parece ser o arquivo de dados da Pasta do Cliente.');
  const destino = galeria.caminhoPadrao();
  if (fs.existsSync(destino)) fs.copyFileSync(destino, `${destino}.antes-da-restauracao-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, conteudo);
  console.log(`Restaurado: ${chave} (${estado.galerias.length} galeria(s)) -> ${destino}\nReinicie o serviço no Render para valer.`);
})().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
