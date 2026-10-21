/**
 * Versão das regras das conquistas (v3.4, servidor/CONTRATO-v34.md §B). Num arquivo à parte para o store do jogo gravar a
 * versão no HallEntry sem carregar as regras (achievements.ts puxa o motor de legado, que fica fora do pacote inicial).
 * 1 = até a v3.3; 2 = v3.4 (as 7 de CONQUISTAS_MUDARAM[2], em achievements.ts).
 */
export const CONQUISTAS_REGRAS_V = 2
