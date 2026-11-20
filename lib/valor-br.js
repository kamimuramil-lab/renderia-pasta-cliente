// lib/valor-br.js
// Lê um valor em dinheiro do jeito que se digita no Brasil. Aceita "27.252,00", "27252,00", "27252.00", "R$ 1.234,5",
// "1,234.50" e números. Retorna um número, ou null se estiver vazio. Lança erro se não der pra entender.
//
// Regra do ponto sozinho: "27.252" (grupos de 3 dígitos) é MILHAR (27 mil); "27252.5" ou "12.5" é decimal.
function lerValorBR(valor) {
  if (valor === undefined || valor === null) return null;
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) throw new Error('Valor inválido.');
    return valor;
  }
  if (typeof valor !== 'string') throw new Error('Valor inválido.');
  let t = valor.trim().replace(/^R\$\s*/i, '').replace(/\s+/g, '');
  if (!t) return null;
  if (!/^[0-9.,]+$/.test(t)) throw new Error('Valor inválido: use só números, por exemplo 27.252,00 ou 27252,00.');
  const ultimaVirgula = t.lastIndexOf(',');
  const ultimoPonto = t.lastIndexOf('.');
  if (ultimaVirgula >= 0 && ultimoPonto >= 0) {
    // os dois aparecem: o que vem POR ÚLTIMO é o decimal; o outro é separador de milhar
    if (ultimaVirgula > ultimoPonto) t = t.replace(/\./g, '').replace(',', '.');
    else t = t.replace(/,/g, '');
  } else if (ultimaVirgula >= 0) {
    t = (t.match(/,/g).length > 1) ? t.replace(/,/g, '') : t.replace(',', '.'); // várias vírgulas = milhar
  } else if (ultimoPonto >= 0) {
    if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, ''); // 27.252 -> 27252
    else if ((t.match(/\./g) || []).length > 1) throw new Error('Valor inválido: use só números, por exemplo 27.252,00 ou 27252,00.');
  }
  const n = Number(t);
  if (!Number.isFinite(n)) throw new Error('Valor inválido: use só números, por exemplo 27.252,00 ou 27252,00.');
  return n;
}

module.exports = { lerValorBR };
