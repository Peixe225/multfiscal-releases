// Tipos do gerador da semente da loja (o vite.config.ts confere a semente no build).
export const ARQUIVO_SEMENTE: string
export function montarSemente(): Promise<Record<string, unknown>>
export function textoDaSemente(): Promise<string>
/** null = em dia; senão, a frase do problema. */
export function conferirSemente(): Promise<string | null>
