/// <reference types="vite/client" />

/** true só no arquivo único da prévia (scripts/arquivo-unico.mjs): lá não tem servidor da loja. */
declare const __ARQUIVO_UNICO__: boolean

/** A hora do build (vite.config.ts): a marca do build que guardou a loja no aparelho (src/store/loja.ts). */
declare const __BUILD_TIME__: string
