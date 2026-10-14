# Pesquisa das 50 lendas (outubro de 2026)

Dados de carreira levantados e conferidos em duas fontes por lenda (campos `fontes`, `incertos` e `notas` em cada
objeto) para o Hall das Lendas v2. É a base do que está em `src/data/catalog/legends.ts`.

- Um arquivo por lote: `g1-lendas-maiores` (Messi, Cristiano Ronaldo, Pelé), `g2-brasil`, `g3-brasil-argentina`,
  `g4-europa-1`, `g5-europa-2`, `g6-europa-3`.
- Números de quem ainda joga: até 14/10/2026. Messi e Cristiano Ronaldo também são atualizados no site pelo
  `servidor/api/lendas.php` (MessivsRonaldo.app, a cada 6 h).
- Para atualizar: refaça a pesquisa no mesmo formato, compare com estes arquivos e passe para `legends.ts`.
  Mudou a fórmula da Nota de Legado? Suba `LEGACY_VERSION` em `src/engine/legacy/score.ts`.
