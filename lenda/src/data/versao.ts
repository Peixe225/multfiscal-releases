/**
 * Versão do pacote de dados do jogo (src/data/generated/game-data.json), gravada no replay de cada carreira do
 * Clássico (HallEntry.replay.dados — servidor/CONTRATO-v33.md §B). A verificação por replay (#/verificar) avisa
 * quando a carreira foi jogada com outra versão: a diferença nos números pode vir daí, e não de trapaça.
 *
 *   "<data do generatedAt>.<FNV-1a 32 bits do arquivo, em hexadecimal>"
 *
 * É uma constante (nada de ler 1 MB de JSON para saber a versão): mudou o game-data.json (npm run data ou
 * qualquer correção à mão), o teste src/store/replay.test.ts falha e diz o valor novo para pôr aqui.
 */
export const DADOS_VERSAO = '2026-09-28.ff31cb13'
