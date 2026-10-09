/// <reference types="vite/client" />

/** true só no arquivo único da prévia (scripts/arquivo-unico.mjs): lá não tem servidor da loja. */
declare const __ARQUIVO_UNICO__: boolean

/** O pôster da rua (vite.config.ts): o quadro 0 da rua, PNG de paleta a 1 px por pixel da arte. */
declare module 'virtual:rua-poster' {
  /** O mundo em pé do story do celular (176 × 281), no pedaço principal. */
  export const posterEmPe: string
}
declare module 'virtual:rua-poster-faixa' {
  /** A faixa do story do celular deitado (220 × 92), num pedaço à parte (só quem deita baixa). */
  export const posterFaixa: string
}
