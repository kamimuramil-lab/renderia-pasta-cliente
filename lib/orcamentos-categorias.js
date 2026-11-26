// lib/orcamentos-categorias.js
// Categorias da Pasta de Orçamentos (nov/2026). Antes cada "item" do orçamento era, ao mesmo tempo, a categoria (Ar Condicionado,
// Marcenaria...) e o orçamento; pra ter mais de um orçamento da mesma coisa o arquiteto DUPLICAVA o item. Agora a categoria é só
// o SEPARADOR (título) e os orçamentos ficam dentro dela, como sempre foram.
//
// Modelo (aditivo, nada do que existia é apagado):
//   o.categorias = [{ id, nome }]   -- a ORDEM do vetor é a ordem na tela (app e cliente)
//   o.itens[i].categoriaId          -- em qual categoria o orçamento está (a ordem dos itens dentro dela é a do vetor `itens`)
//   o.categoriasV1                  -- true depois da migração
//
// Este módulo é PURO (sem disco/rede) e é chamado pelo galeria.lerEstado, então toda leitura já devolve o estado migrado.
// Os ids das categorias da migração são DETERMINÍSTICOS (hash do nome): duas leituras antes de gravar dão o mesmo resultado.
const crypto = require('crypto');

// Itens que já vêm prontos em todo projeto (os mesmos do Notion), agora como CATEGORIAS vazias. O arquiteto renomeia,
// exclui ou acrescenta.
const CATEGORIAS_PADRAO = [
  'Ar Condicionado', 'Automação', 'Boxes de Vidro, Envidraçamento de Sacada e Espelhos', 'Cortinas e Persianas',
  'Eletrodomésticos', 'Execução de Obra', 'Iluminação Decorativa', 'Iluminação Técnica', 'Louças e Metais',
  'Marcenaria', 'Marmoraria', 'Móveis Soltos', 'Revestimentos e Insumos'
];

const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const idDaCategoria = (nome) => 'cat_' + crypto.createHash('sha1').update(norm(nome)).digest('hex').slice(0, 10);
// "Marcenaria (cópia)" -> "Marcenaria" (o Duplicar antigo acrescentava isso ao nome)
const nomeSemCopia = (nome) => String(nome || '').replace(/\s*\(\s*c[óo]pia\s*\)\s*$/i, '').trim();

// Item "de enfeite": ainda intocado pelo arquiteto (À fazer, sem valor, link, empresa, observação nem comentários).
// O cliente não vê esses até o arquiteto começar a preencher.
const ehPlaceholder = (i) => i.status === 'a_fazer' && (i.valor === null || i.valor === undefined) && !i.url && !i.empresa && !i.representante && !i.telefone && !i.observacao && !(i.comentarios && i.comentarios.length)
  && !i.linkProduto && !i.especificacoes && !i.dimensoes && !i.quantidade && !(i.ambientes && i.ambientes.length) && !i.fotoR2Key;

// Acha a categoria pelo nome (sem acento/maiúscula) ou cria no fim da lista.
function categoriaPorNome(o, nome) {
  const limpo = String(nome || '').trim();
  const n = norm(limpo);
  let c = o.categorias.find((x) => norm(x.nome) === n);
  if (!c) {
    let id = idDaCategoria(limpo);
    while (o.categorias.some((x) => x.id === id)) id += 'x';
    c = { id, nome: limpo };
    o.categorias.push(c);
  }
  return c;
}

// Migra o estado antigo (itens soltos) pro modelo com categorias. Idempotente; devolve true se mexeu em alguma coisa.
function migrar(o) {
  if (o.categoriasV1 && Array.isArray(o.categorias)) {
    // Garantia: item sem categoria (criado por um app antigo depois da migração) entra na categoria do próprio nome.
    let mexeu = false;
    o.itens.forEach((i) => {
      if (!i.categoriaId || !o.categorias.some((c) => c.id === i.categoriaId)) { i.categoriaId = categoriaPorNome(o, nomeSemCopia(i.item) || i.item || 'Sem categoria').id; mexeu = true; }
    });
    return mexeu;
  }
  o.categorias = [];
  const mantidos = [];
  o.itens.forEach((i) => {
    const c = categoriaPorNome(o, nomeSemCopia(i.item) || i.item || 'Sem categoria');
    if (ehPlaceholder(i)) return; // item de enfeite vira só a categoria
    i.categoriaId = c.id;
    mantidos.push(i);
  });
  o.itens = mantidos;
  // Projeto que nunca teve a lista de padrão: completa com as categorias que faltam (uma vez só, como antes).
  if (!o.padraoV2) { CATEGORIAS_PADRAO.forEach((nome) => categoriaPorNome(o, nome)); o.padraoV2 = true; }
  o.padraoCriado = true;
  o.categoriasV1 = true;
  return true;
}

module.exports = { CATEGORIAS_PADRAO, norm, nomeSemCopia, ehPlaceholder, categoriaPorNome, migrar };
