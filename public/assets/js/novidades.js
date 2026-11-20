// novidades.js -- "o que mudou desde a última visita", por aba (Pasta do Cliente e Pasta de Orçamentos).
//
// Como funciona: este aparelho guarda (no localStorage) uma "foto" do que já viu em cada aba: { id do item: versão }. Quando o
// arquiteto acrescenta um item (documento, imagem, item do memorial, orçamento) ou muda um que já existia, o id/versão deixa de
// bater e o item conta como novidade. A bolinha do cartão mostra quantas são; ao ABRIR a aba, a foto é atualizada.
// Primeira visita de um aparelho: nada é "novo" (senão o cliente veria tudo marcado); a foto inicial é gravada em silêncio.
// Sem localStorage (navegação privada, bloqueado): simplesmente não há bolinhas. Não depende da página nem do servidor.
(function () {
  'use strict';
  const versaoDe = (i) => String(i.versao == null ? '' : i.versao);

  function ler(chave) { try { const j = JSON.parse(localStorage.getItem(chave) || 'null'); return (j && typeof j === 'object' && j.grupos && typeof j.grupos === 'object') ? j : null; } catch (e) { return null; } }
  function gravar(chave, dados) { try { localStorage.setItem(chave, JSON.stringify(dados)); return true; } catch (e) { return false; } }
  const mapaDe = (itens) => { const m = {}; itens.forEach((i) => { m[i.id] = versaoDe(i); }); return m; };

  // visto: { id: versão } | undefined  ->  { novos: [ids], atualizados: [ids] }
  function diferenca(visto, itens) {
    const novos = [], atualizados = [];
    itens.forEach((i) => {
      const v = visto ? visto[i.id] : undefined;
      if (v === undefined) novos.push(i.id); else if (v !== versaoDe(i)) atualizados.push(i.id);
    });
    return { novos, atualizados };
  }

  // gruposDeItens: { nomeDaAba: [{ id, versao }] }  (o que EXISTE agora)
  // -> { diferencas: { aba: { novos, atualizados } }, primeiraVisita, marcarVisto(aba), gravar }
  // Abas que ainda não estavam na foto guardada (primeira visita, ou aba criada depois) entram em silêncio, sem contar como novidade.
  function abrir(chave, gruposDeItens) {
    let dados = ler(chave);
    const primeiraVisita = !dados;
    if (!dados) dados = { v: 1, grupos: {} };
    const diferencas = {};
    let mudouFoto = primeiraVisita;
    Object.keys(gruposDeItens).forEach((aba) => {
      if (!dados.grupos[aba]) { dados.grupos[aba] = mapaDe(gruposDeItens[aba]); mudouFoto = true; diferencas[aba] = { novos: [], atualizados: [] }; return; }
      diferencas[aba] = diferenca(dados.grupos[aba], gruposDeItens[aba]);
    });
    if (mudouFoto) gravar(chave, dados);
    return {
      primeiraVisita,
      diferencas,
      total: (aba) => (diferencas[aba] ? diferencas[aba].novos.length + diferencas[aba].atualizados.length : 0),
      tag: (aba, id) => { const d = diferencas[aba]; return !d ? '' : (d.novos.includes(id) ? 'NOVO' : (d.atualizados.includes(id) ? 'ATUALIZADO' : '')); },
      // O cliente abriu a aba: a foto dela passa a ser a de agora (as marcas "NOVO" desta visita continuam na tela até recarregar).
      marcarVisto(aba) {
        if (!gruposDeItens[aba]) return;
        const atual = ler(chave) || dados;
        atual.grupos[aba] = mapaDe(gruposDeItens[aba]);
        dados = atual;
        gravar(chave, atual);
      }
    };
  }

  window.Novidades = { abrir, diferenca };
})();
