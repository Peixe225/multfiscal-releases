/**
 * As regras das conquistas raras para a calibração da v3.4 (servidor/CONTRATO-v34.md §K), em cima dos números crus que o
 * scripts/estudos/raridade-motor.ts grava por carreira. Usado pela análise (calibracao-v34.mjs) e pela conferência contra o
 * código do jogo (conferir-v34.mjs). `r.hoje` = o Set das conquistas que o motor de hoje deu à carreira.
 */
export const v34 = (f) => (r) => (r.v34 ? f(r) : null)

/**
 * As famílias de limite novo de cada conquista rara (a grade) e o predicado. `pred(params)` → (r) → true/false/null
 * (null = a carreira não tem o número: as da v3.3 não têm Chuteiras, recordes, nota bruta…). `check(params)` = a
 * condição no formato do src/engine/career/achievements.ts (para o agente do jogo).
 */
export const FAMILIAS = {
  only_pele: {
    grade: [[3, 1000], [3, 800], [3, 700], [3, 600], [3, 500], [2, 1000], [2, 900], [2, 800], [2, 750], [2, 700], [2, 600]].map(([copas, gols]) => ({ copas, gols })),
    pred: ({ copas, gols }) => (r) => r.copas >= copas && r.gols > gols,
    check: ({ copas, gols }) => `worldCups(c) >= ${copas} && c.goals > ${gols}`,
  },
  ushuaia_to_darien: {
    grade: [{ paises: 10 }, { paises: 9 }, { paises: 8 }, { paises: 7 }, { paises: 6 }, { paises: 8, libertadores: 1 }, { paises: 7, libertadores: 1 }, { paises: 7, libertadores: 2 }, { paises: 6, libertadores: 2 }, { paises: 6, libertadores: 3 }],
    pred: ({ paises, libertadores = 0 }) => (r) => r.paisesSul >= paises && r.lib >= libertadores,
    check: ({ paises, libertadores = 0 }) =>
      `new Set(c.seasons.filter((r) => r.confed === 'CONMEBOL').map((r) => r.country)).size >= ${paises}${libertadores ? ` && lib(c) >= ${libertadores}` : ''}`,
  },
  nomad: {
    grade: [5, 4].map((confederacoes) => ({ confederacoes })),
    pred: ({ confederacoes }) => (r) => r.confeds >= confederacoes,
    check: ({ confederacoes }) => `new Set(c.seasons.map((r) => r.confed).filter(Boolean)).size >= ${confederacoes}`,
  },
  baldosero: {
    grade: [24, 23, 22, 21, 20].map((clubes) => ({ clubes })),
    pred: ({ clubes }) => (r) => r.clubes >= clubes,
    check: ({ clubes }) => `clubsOf(c).size >= ${clubes}`,
  },
  world_cup_4: {
    grade: [
      { tipo: 'copas', copas: 4 },
      { tipo: 'copas_maior_que_pele', copas: 3 },
      { tipo: 'copas_maior_que_pele', copas: 2 },
      { tipo: 'copas_libertadores', copas: 2, total: 5 },
      { tipo: 'copas_continentais', copas: 2, total: 4 },
    ],
    pred: (q) => {
      if (q.tipo === 'copas') return (r) => r.copas >= q.copas
      if (q.tipo === 'copas_maior_que_pele') return (r) => r.copas >= q.copas && r.hoje.has('beat_pele')
      if (q.tipo === 'copas_libertadores') return (r) => r.copas >= q.copas && r.copas + r.lib >= q.total
      return v34((r) => r.copas >= q.copas && r.copas + r.nacCont >= q.total)
    },
    check: (q) =>
      q.tipo === 'copas'
        ? `worldCups(c) >= ${q.copas}`
        : q.tipo === 'copas_maior_que_pele'
          ? `c.finished && worldCups(c) >= ${q.copas} && beats(c, 'pele')`
          : q.tipo === 'copas_libertadores'
            ? `worldCups(c) >= ${q.copas} && worldCups(c) + lib(c) >= ${q.total}`
            : `worldCups(c) >= ${q.copas} && worldCups(c) + count(c, kind('national_continental')) >= ${q.total}`,
  },
  goals_1300: {
    grade: [...[1300, 1200, 1150, 1100, 1075, 1050, 1025].map((gols) => ({ gols })), { gols: 1000, media: 0.85 }, { gols: 1000, media: 0.8 }],
    pred: ({ gols, media = 0 }) => (r) => r.gols >= gols && (!media || (r.jogos >= 300 && r.gols / r.jogos >= media)),
    check: ({ gols, media = 0 }) => `c.goals >= ${gols}${media ? ` && gpgAtEnd(c) >= ${media}` : ''}`,
  },
  goals_1000: { grade: [1000].map((gols) => ({ gols })), pred: ({ gols }) => (r) => r.gols >= gols, check: ({ gols }) => `c.goals >= ${gols}` },
  gpg_09: {
    grade: [0.9, 0.88, 0.86, 0.85].map((media) => ({ media, jogos: 300 })),
    pred: ({ media, jogos }) => (r) => r.jogos >= jogos && r.gols / r.jogos >= media,
    check: ({ media }) => `gpgAtEnd(c) >= ${media}`,
  },
  records_10: {
    grade: [10, 9, 8, 7, 6].map((recordes) => ({ recordes })),
    pred: ({ recordes }) => v34((r) => r.rec >= recordes),
    check: ({ recordes }) => `c.legacy().historic.length >= ${recordes}`,
  },
  records_5: { grade: [5].map((recordes) => ({ recordes })), pred: ({ recordes }) => v34((r) => r.rec >= recordes), check: ({ recordes }) => `c.legacy().historic.length >= ${recordes}` },
  net_terror: { grade: [6].map((chuteiras) => ({ chuteiras })), pred: ({ chuteiras }) => v34((r) => r.bot >= chuteiras), check: ({ chuteiras }) => `c.wins('golden_boot') >= ${chuteiras}` },
  golden_boot_7: { grade: [7].map((chuteiras) => ({ chuteiras })), pred: ({ chuteiras }) => v34((r) => r.bot >= chuteiras), check: ({ chuteiras }) => `c.wins('golden_boot') >= ${chuteiras}` },
  legacy_95: { grade: [95, 94, 93].map((nota) => ({ nota })), pred: ({ nota }) => (r) => r.nota >= nota, check: ({ nota }) => `c.finished && c.legacy().score >= ${nota}` },
  beat_all: { grade: [0, 1].map((lendasAcima) => ({ lendasAcima })), pred: ({ lendasAcima }) => v34((r) => r.acima <= lendasAcima), check: ({ lendasAcima }) => `c.finished && legendsAbove(c) <= ${lendasAcima}` },
  world_cup_3: { grade: [3].map((copas) => ({ copas })), pred: ({ copas }) => (r) => r.copas >= copas, check: ({ copas }) => `worldCups(c) >= ${copas}` },
  goat: {
    grade: [
      [1, 2, 8, 4],
      [1, 2, 6, 3],
      [1, 1, 8, 4],
      [1, 1, 6, 3],
    ].map(([copas, continentais, bolas, champions]) => ({ copas, continentais, bolas, champions })),
    // títulos continentais de seleção: as carreiras da v3.3 só sabem se houve 1 (a conquista "Campeão continental")
    pred: (q) => (r) => {
      if (!(r.copas >= q.copas && r.bolas >= q.bolas && r.ucl >= q.champions)) return false
      if (r.v34) return r.nacCont >= q.continentais
      const tem1 = r.hoje.has('continental_national')
      if (q.continentais <= 1) return tem1 || q.continentais <= 0
      if (!tem1) return false
      // v3.3: só se sabe se houve 1 título continental; com a GOAT do motor (que pede 2) sabe-se que houve 2
      return r.hoje.has('goat') ? true : null
    },
    check: (q) => `worldCups(c) >= ${q.copas} && count(c, kind('national_continental')) >= ${q.continentais} && c.wins('ballon_dor') >= ${q.bolas} && ucl(c) >= ${q.champions}`,
  },
  ucl_7: { grade: [7].map((champions) => ({ champions })), pred: ({ champions }) => (r) => r.ucl >= champions, check: ({ champions }) => `ucl(c) >= ${champions}` },
}

/**
 * Conferência: com os parâmetros de HOJE, o predicado de cada família tem de dar o mesmo que o motor deu (as conquistas
 * gravadas pela carreira) — assim a medição com o limite novo é a mesma conta que o jogo faz.
 */
export const HOJE_PARAMS = {
  only_pele: { copas: 3, gols: 1000 },
  ushuaia_to_darien: { paises: 10 },
  nomad: { confederacoes: 5 },
  baldosero: { clubes: 24 },
  world_cup_4: { tipo: 'copas', copas: 4 },
  goals_1300: { gols: 1300 },
  goals_1000: { gols: 1000 },
  gpg_09: { media: 0.9, jogos: 300 },
  records_10: { recordes: 10 },
  records_5: { recordes: 5 },
  net_terror: { chuteiras: 6 },
  golden_boot_7: { chuteiras: 7 },
  legacy_95: { nota: 95 },
  beat_all: { lendasAcima: 0 },
  world_cup_3: { copas: 3 },
  goat: { copas: 1, continentais: 2, bolas: 8, champions: 4 },
  ucl_7: { champions: 7 },
}

