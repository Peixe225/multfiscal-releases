/**
 * Catálogo de competições que não são ligas (escrito à mão). As ligas viram Competition
 * automaticamente no pipeline (kind "league", a partir de LEAGUES). `id` = slug da ESPN quando
 * existe (bra.copa_do_brazil, uefa.champions…); senão um slug próprio no mesmo estilo.
 *
 * `size` = participantes na SIMULAÇÃO (limitado aos clubes que temos): nem sempre é o tamanho real.
 * `schedule` só para torneios não anuais: primeira edição a simular + intervalo em anos.
 */
import type { Competition, Confed, ConfedCompetitions } from '../../engine/types'

type Cup = [id: string, name: string, country: string, size: number, trophyId: string]
const cups = (rows: Cup[]): Competition[] =>
  rows.map(([id, name, country, size, trophyId]) => ({ id, name, kind: 'domestic_cup', country, size, trophyId }))

/** Estaduais brasileiros: disputados pelos clubes da UF (Club.state). */
type State = [id: string, name: string, uf: string, size: number, trophyId: string]
const estaduais = (rows: State[]): Competition[] =>
  rows.map(([id, name, region, size, trophyId]) => ({ id, name, kind: 'domestic_cup', country: 'BRA', region, size, trophyId }))

export const COMPETITIONS: Competition[] = [
  // ─────────────── copas nacionais ───────────────
  ...cups([
    ['bra.copa_do_brazil', 'Copa do Brasil', 'BRA', 32, 'copa-do-brasil'],
    ['eng.fa', 'Copa da Inglaterra', 'ENG', 64, 'fa-cup'],
    ['eng.league_cup', 'Copa da Liga Inglesa', 'ENG', 64, 'league-cup'],
    ['esp.copa_del_rey', 'Copa do Rei', 'ESP', 32, 'copa-del-rey'],
    ['ita.coppa_italia', 'Copa da Itália', 'ITA', 32, 'coppa-italia'],
    ['ger.dfb_pokal', 'Copa da Alemanha', 'GER', 32, 'dfb-pokal'],
    ['fra.coupe_de_france', 'Copa da França', 'FRA', 32, 'coupe-de-france'],
    ['por.taca.portugal', 'Taça de Portugal', 'POR', 16, 'taca-portugal'],
    ['ned.cup', 'Copa da Holanda', 'NED', 32, 'knvb-beker'],
    ['bel.cup', 'Copa da Bélgica', 'BEL', 16, 'belgian-cup'],
    ['sco.tennents', 'Copa da Escócia', 'SCO', 16, 'scottish-cup'],
    ['tur.cup', 'Copa da Turquia', 'TUR', 16, 'turkish-cup'],
    ['rus.cup', 'Copa da Rússia', 'RUS', 16, 'russian-cup'],
    ['gre.cup', 'Copa da Grécia', 'GRE', 8, 'greek-cup'],
    ['aut.cup', 'Copa da Áustria', 'AUT', 8, 'austrian-cup'],
    ['den.cup', 'Copa da Dinamarca', 'DEN', 8, 'danish-cup'],
    ['sui.cup', 'Copa da Suíça', 'SUI', 8, 'swiss-cup'],
    ['nor.cup', 'Copa da Noruega', 'NOR', 16, 'norwegian-cup'],
    ['swe.cup', 'Copa da Suécia', 'SWE', 16, 'swedish-cup'],
    ['rou.cup', 'Copa da Romênia', 'ROU', 16, 'romanian-cup'],
    ['arg.copa', 'Copa Argentina', 'ARG', 64, 'copa-argentina'],
    ['col.copa', 'Copa da Colômbia', 'COL', 16, 'copa-colombia'],
    ['uru.copa', 'Copa AUF Uruguai', 'URU', 16, 'copa-uruguay'],
    ['chi.copa_chi', 'Copa Chile', 'CHI', 16, 'copa-chile'],
    ['par.copa', 'Copa Paraguai', 'PAR', 8, 'copa-paraguay'],
    ['bol.copa', 'Copa da Bolívia', 'BOL', 16, 'copa-bolivia'],
    ['usa.open', 'U.S. Open Cup', 'USA', 32, 'us-open-cup'],
    ['ksa.kings.cup', 'Copa do Rei Saudita', 'KSA', 16, 'kings-cup'],
    ['jpn.emperors_cup', 'Copa do Imperador', 'JPN', 16, 'emperors-cup'],
    ['chn.fa_cup', 'Copa da China', 'CHN', 16, 'chinese-fa-cup'],
    ['aus.cup', 'Australia Cup', 'AUS', 8, 'australia-cup'],
    ['rsa.cup', 'Copa da África do Sul', 'RSA', 16, 'nedbank-cup'],
  ]),
  ...estaduais([
    ['bra.camp.paulista', 'Campeonato Paulista', 'SP', 16, 'paulista'],
    ['bra.camp.carioca', 'Campeonato Carioca', 'RJ', 12, 'carioca'],
    ['bra.camp.mineiro', 'Campeonato Mineiro', 'MG', 12, 'mineiro'],
    ['bra.camp.gaucho', 'Campeonato Gaúcho', 'RS', 12, 'gaucho'],
    ['bra.camp.paranaense', 'Campeonato Paranaense', 'PR', 12, 'paranaense'],
    ['bra.camp.catarinense', 'Campeonato Catarinense', 'SC', 12, 'catarinense'],
    ['bra.camp.baiano', 'Campeonato Baiano', 'BA', 10, 'baiano'],
    ['bra.camp.pernambucano', 'Campeonato Pernambucano', 'PE', 10, 'pernambucano'],
    ['bra.camp.cearense', 'Campeonato Cearense', 'CE', 10, 'cearense'],
    ['bra.camp.goiano', 'Campeonato Goiano', 'GO', 12, 'goiano'],
    ['bra.camp.paraense', 'Campeonato Paraense', 'PA', 12, 'paraense'],
    ['bra.camp.alagoano', 'Campeonato Alagoano', 'AL', 10, 'alagoano'],
    ['bra.camp.matogrossense', 'Campeonato Mato-Grossense', 'MT', 10, 'mato-grossense'],
  ]),

  // ─────────────── CONMEBOL ───────────────
  { id: 'conmebol.libertadores', name: 'Copa Libertadores', kind: 'continental_primary', confed: 'CONMEBOL', size: 32, trophyId: 'libertadores' },
  { id: 'conmebol.sudamericana', name: 'Copa Sul-Americana', kind: 'continental_secondary', confed: 'CONMEBOL', size: 32, trophyId: 'sudamericana' },
  { id: 'conmebol.recopa', name: 'Recopa Sul-Americana', kind: 'continental_secondary', confed: 'CONMEBOL', size: 2, trophyId: 'recopa', superCup: true },

  // ─────────────── UEFA ───────────────
  { id: 'uefa.champions', name: 'Champions League', kind: 'continental_primary', confed: 'UEFA', size: 36, trophyId: 'champions-league' },
  { id: 'uefa.europa', name: 'Liga Europa', kind: 'continental_secondary', confed: 'UEFA', size: 36, trophyId: 'europa-league' },
  { id: 'uefa.europa.conf', name: 'Conference League', kind: 'continental_tertiary', confed: 'UEFA', size: 36, trophyId: 'conference-league' },
  { id: 'uefa.super_cup', name: 'Supercopa da UEFA', kind: 'continental_secondary', confed: 'UEFA', size: 2, trophyId: 'uefa-super-cup', superCup: true },

  // ─────────────── CONCACAF / AFC / CAF ───────────────
  { id: 'concacaf.champions', name: 'Copa dos Campeões da Concacaf', kind: 'continental_primary', confed: 'CONCACAF', size: 16, trophyId: 'concacaf-champions' },
  { id: 'afc.champions', name: 'Liga dos Campeões da AFC', kind: 'continental_primary', confed: 'AFC', size: 24, trophyId: 'afc-champions' },
  { id: 'afc.cup', name: 'Liga dos Campeões da AFC 2', kind: 'continental_secondary', confed: 'AFC', size: 16, trophyId: 'afc-champions-two' },
  { id: 'caf.champions', name: 'Liga dos Campeões da CAF', kind: 'continental_primary', confed: 'CAF', size: 16, trophyId: 'caf-champions' },
  { id: 'caf.confed', name: 'Copa das Confederações da CAF', kind: 'continental_secondary', confed: 'CAF', size: 16, trophyId: 'caf-confed' },

  // ─────────────── mundiais de clubes ───────────────
  // Mundial de 32 clubes a cada 4 anos (2025 → 2029); Intercontinental anual (dezembro).
  { id: 'fifa.cwc', name: 'Mundial de Clubes da FIFA', kind: 'club_world_cup', size: 32, schedule: { firstYear: 2029, every: 4 }, trophyId: 'club-world-cup' },
  { id: 'fifa.intercontinental_cup', name: 'Copa Intercontinental da FIFA', kind: 'club_world_cup', size: 6, trophyId: 'intercontinental' },

  // ─────────────── seleções ───────────────
  { id: 'fifa.world', name: 'Copa do Mundo', kind: 'world_cup', size: 48, schedule: { firstYear: 2030, every: 4 }, trophyId: 'world-cup' },
  { id: 'conmebol.america', name: 'Copa América', kind: 'national_continental', confed: 'CONMEBOL', size: 16, schedule: { firstYear: 2028, every: 4 }, trophyId: 'copa-america' },
  { id: 'uefa.euro', name: 'Eurocopa', kind: 'national_continental', confed: 'UEFA', size: 24, schedule: { firstYear: 2028, every: 4 }, trophyId: 'euro' },
  { id: 'concacaf.gold', name: 'Copa Ouro da Concacaf', kind: 'national_continental', confed: 'CONCACAF', size: 16, schedule: { firstYear: 2027, every: 2 }, trophyId: 'gold-cup' },
  { id: 'caf.nations', name: 'Copa Africana de Nações', kind: 'national_continental', confed: 'CAF', size: 24, schedule: { firstYear: 2027, every: 2 }, trophyId: 'afcon' },
  { id: 'afc.asian.cup', name: 'Copa da Ásia', kind: 'national_continental', confed: 'AFC', size: 24, schedule: { firstYear: 2027, every: 4 }, trophyId: 'asian-cup' },
  { id: 'ofc.nations', name: 'Copa das Nações da OFC', kind: 'national_continental', confed: 'OFC', size: 8, schedule: { firstYear: 2028, every: 4 }, trophyId: 'ofc-nations-cup' },

  // ─────────────── prêmios (id = AwardId) ───────────────
  { id: 'ballon_dor', name: 'Bola de Ouro', kind: 'award', size: 30, trophyId: 'ballon-dor' },
  { id: 'golden_boot', name: 'Chuteira de Ouro', kind: 'award', size: 10, trophyId: 'golden-boot' },
  { id: 'golden_glove', name: 'Luva de Ouro', kind: 'award', size: 10, trophyId: 'golden-glove' },
  { id: 'the_best', name: 'The Best FIFA', kind: 'award', size: 11, trophyId: 'the-best' },
  { id: 'kopa', name: 'Troféu Kopa', kind: 'award', size: 10, trophyId: 'kopa' },
  { id: 'puskas', name: 'Prêmio Puskás', kind: 'award', size: 11, trophyId: 'puskas' },
  { id: 'league_top_scorer', name: 'Artilheiro da Liga', kind: 'award', size: 5, trophyId: 'league-top-scorer' },
  { id: 'league_best_player', name: 'Craque da Liga', kind: 'award', size: 5, trophyId: 'league-best-player' },
  { id: 'wc_golden_ball', name: 'Bola de Ouro da Copa', kind: 'award', size: 10, trophyId: 'wc-golden-ball' },
  { id: 'wc_golden_boot', name: 'Chuteira de Ouro da Copa', kind: 'award', size: 10, trophyId: 'wc-golden-boot' },
  { id: 'team_of_the_year', name: 'Seleção do Ano', kind: 'award', size: 11, trophyId: 'team-of-the-year' },
]

/** Competições de cada confederação (o motor não precisa adivinhar pelo `kind`). */
export const CONFEDERATIONS: Partial<Record<Confed, ConfedCompetitions>> = {
  CONMEBOL: { primary: 'conmebol.libertadores', secondary: 'conmebol.sudamericana', superCup: 'conmebol.recopa', national: 'conmebol.america' },
  UEFA: { primary: 'uefa.champions', secondary: 'uefa.europa', tertiary: 'uefa.europa.conf', superCup: 'uefa.super_cup', national: 'uefa.euro' },
  CONCACAF: { primary: 'concacaf.champions', national: 'concacaf.gold' },
  AFC: { primary: 'afc.champions', secondary: 'afc.cup', national: 'afc.asian.cup' },
  CAF: { primary: 'caf.champions', secondary: 'caf.confed', national: 'caf.nations' },
  OFC: { national: 'ofc.nations' },
}

/** Logos da ESPN (alternateId) para competições cujo slug não traz logo no índice. */
export const COMPETITION_LOGO_IDS: Record<string, string> = {}
