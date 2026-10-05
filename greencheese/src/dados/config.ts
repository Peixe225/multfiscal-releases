// Configuração geral do site. Tudo que o dono pode querer mudar sem mexer em código fica em src/dados/.

export const config = {
  /** Prévia de venda: liga noindex, o selo "prévia" e o crédito da I&H no rodapé. Trocar para false quando o site for oficial. */
  modoPrevia: true,

  marca: 'Green Cheese Imports',
  /** Endereço público do site (usado na imagem de compartilhamento e nos links da bio). */
  urlPublica: 'https://oprojeto.online/greencheese/',

  /** Crédito exibido no rodapé enquanto modoPrevia = true. */
  credito: { texto: 'Prévia criada pela I&H Soluções Digitais', instagram: 'ihsdigital' },

  /** Idade mínima e por quanto tempo o "Tenho 18" fica lembrado no aparelho. */
  idadeMinima: 18,
  lembrarIdadeDias: 30,

  /** Palpite de estado pelo IP (sem GPS). Cada serviço tem 2,5 s; se os dois falharem, a pessoa escolhe. */
  geoTimeoutMs: 2500,

  /**
   * Catálogo por planilha (opcional). Publique a planilha do Google como CSV
   * (Arquivo → Compartilhar → Publicar na Web → CSV) e cole o link aqui.
   * Colunas aceitas: id, preco, rj, mg, sp, es, sc (sim/não). Linhas com id desconhecido são ignoradas.
   * Deixe null para usar só o catalogo.json.
   */
  planilhaCsvUrl: null as string | null,

  /**
   * Quando o catálogo foi atualizado pela última vez (ISO, ex.: '2026-10-04T18:00:00-03:00').
   * Vira o "2 h" do cabeçalho do story, como no Instagram. null = não mostra tempo.
   */
  catalogoAtualizadoEm: '2026-10-04T12:00:00-03:00' as string | null,

  /** Segundos que cada produto fica no story antes de passar sozinho. */
  storySegundos: 6,

  /**
   * Mostra o mercador dando uns tragos no repost. A Lei 9.294/96 (art. 3º) veda propaganda de produtos fumígenos;
   * para a versão oficial, a recomendação é false.
   */
  mercadorTraga: true,
}

export type Config = typeof config
