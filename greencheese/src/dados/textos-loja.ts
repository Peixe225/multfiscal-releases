// Textos da loja que aparecem no site fora do pedido guiado: a bio do perfil, a frase do story do Início, o adesivo
// da sacola vazia e as falas do mercador no topo do Mercado. No servidor, o dono troca no painel (Loja → Textos);
// aqui fica a versão que vai embutida no site e que semeia o servidor (scripts/gerar-semente-loja.mjs).
//
// REGRAS
// - Curtos, na voz da loja. Nada de promessa (preço, frete, prazo, "grátis") e nenhuma palavra da lista
//   PALAVRAS_PROIBIDAS de src/dados/sorte.ts: o servidor recusa as mesmas.
// - Sem import neste arquivo: o gerador da semente lê ele direto.

export const textosLoja = {
  /** Bio do perfil, uma linha por item (até 3, como a do Instagram). */
  bio: ['Importados, destilados, sedas, piteiras e acessórios.', 'Quem tiver interesse é só mandar dm'],
  /** Adesivo de texto do story do Início (nos dias de entrega grátis do estado, vale a frase do estado). */
  fraseStory: 'Vem no certo!',
  /** Adesivo da sacola vazia, embaixo do mercador. */
  sacolaVazia: 'Nada aqui ainda. Vem no certo!',
  /** O que o mercador do topo do Mercado fala (uma por toque, na ordem). */
  falasMercado: ['Chega mais.', 'Vem no certo!', 'Quem já usou sabe da qualidade.'],
}

export type TextosLoja = typeof textosLoja
