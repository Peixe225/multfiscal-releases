/**
 * Catálogo de troféus (escrito à mão). `id` é referenciado por League.trophyId e
 * Competition.trophyId. `art` = chave da arte em src/ui/trophies/svg (arquivos que existem hoje:
 * world-cup, ballon-dor, golden-boot, champions-league, libertadores, brasileirao, copa-do-brasil,
 * copa-america, laliga, estadual). Os demais usam um id descritivo (kebab) para uma arte futura;
 * enquanto ela não existir, a UI cai na arte genérica da `family` com `metal`/`accent`.
 */
import type { Trophy, TrophyFamily } from '../../engine/types'

type T = [id: string, name: string, art: string | undefined, metal: Trophy['metal'], accent: `#${string}`]

const make = (family: TrophyFamily, rows: T[]): Trophy[] =>
  rows.map(([id, name, art, metal, accent]) => ({ id, name, family, ...(art ? { art } : {}), metal, accent }))

export const TROPHIES: Trophy[] = [
  // ─────────────── seleções ───────────────
  ...make('world_cup', [['world-cup', 'Copa do Mundo', 'world-cup', 'gold', '#1f7a3a']]),
  ...make('national_continental', [
    ['copa-america', 'Copa América', 'copa-america', 'silver', '#c8a13a'],
    ['euro', 'Eurocopa', 'euro', 'silver', '#1d3b8f'],
    ['afcon', 'Copa Africana de Nações', 'afcon', 'gold', '#1f7a3a'],
    ['gold-cup', 'Copa Ouro da Concacaf', 'gold-cup', 'gold', '#1d3b8f'],
    ['asian-cup', 'Copa da Ásia', 'asian-cup', 'silver', '#8a1538'],
    ['ofc-nations-cup', 'Copa das Nações da OFC', 'cup-generic', 'silver', '#0b6aa2'],
  ]),

  // ─────────────── mundiais de clubes ───────────────
  ...make('club_world_cup', [
    ['club-world-cup', 'Mundial de Clubes da FIFA', 'club-world-cup', 'gold', '#1d3b8f'],
    ['intercontinental', 'Copa Intercontinental da FIFA', 'intercontinental', 'gold', '#7a1f2b'],
  ]),

  // ─────────────── continentais ───────────────
  ...make('continental_primary', [
    ['champions-league', 'Liga dos Campeões da UEFA', 'champions-league', 'silver', '#0b1f5c'],
    ['libertadores', 'Copa Libertadores', 'libertadores', 'silver', '#c8a13a'],
    ['concacaf-champions', 'Copa dos Campeões da Concacaf', 'cup-generic', 'silver', '#1d3b8f'],
    ['afc-champions', 'Liga dos Campeões da AFC', 'cup-generic', 'silver', '#8a1538'],
    ['caf-champions', 'Liga dos Campeões da CAF', 'cup-generic', 'gold', '#1f7a3a'],
  ]),
  ...make('continental_secondary', [
    ['europa-league', 'Liga Europa', 'europa-league', 'silver', '#f26a1b'],
    ['sudamericana', 'Copa Sul-Americana', 'sudamericana', 'gold', '#0b3d91'],
    ['recopa', 'Recopa Sul-Americana', 'recopa', 'silver', '#c8a13a'],
    ['uefa-super-cup', 'Supercopa da UEFA', 'cup-generic', 'silver', '#0b1f5c'],
    ['afc-champions-two', 'Liga dos Campeões da AFC 2', 'cup-generic', 'silver', '#b5892b'],
    ['caf-confed', 'Copa das Confederações da CAF', 'cup-generic', 'gold', '#b5892b'],
  ]),
  ...make('continental_tertiary', [['conference-league', 'Liga Conferência', 'conference-league', 'silver', '#1fa04a']]),

  // ─────────────── ligas ───────────────
  ...make('league', [
    ['brasileirao', 'Brasileirão', 'brasileirao', 'gold', '#1f7a3a'],
    ['serie-b-brasil', 'Série B', 'serie-b-brasil', 'silver', '#1f7a3a'],
    ['premier-league', 'Premier League', 'premier-league', 'silver', '#3d195b'],
    ['championship', 'Championship', 'championship', 'silver', '#1d3b8f'],
    ['league-one', 'League One', 'league-generic', 'silver', '#c8102e'],
    ['league-two', 'League Two', 'league-generic', 'bronze', '#1d3b8f'],
    ['laliga', 'LaLiga', 'laliga', 'silver', '#ff4b44'],
    ['laliga-2', 'LaLiga Hypermotion', 'league-generic', 'silver', '#2f4bdb'],
    ['serie-a', 'Serie A', 'serie-a', 'silver', '#0b3d91'],
    ['serie-b-italia', 'Serie B Italiana', 'league-generic', 'silver', '#1fa04a'],
    ['bundesliga', 'Bundesliga', 'bundesliga', 'silver', '#d20515'],
    ['2-bundesliga', '2. Bundesliga', 'league-generic', 'silver', '#d20515'],
    ['ligue-1', 'Ligue 1', 'ligue-1', 'silver', '#091c3e'],
    ['ligue-2', 'Ligue 2', 'league-generic', 'silver', '#e2001a'],
    ['primeira-liga', 'Liga Portugal', 'primeira-liga', 'silver', '#0b6aa2'],
    ['eredivisie', 'Eredivisie', 'eredivisie', 'silver', '#f36c21'],
    ['eerste-divisie', 'Eerste Divisie', 'league-generic', 'silver', '#f36c21'],
    ['pro-league-belgium', 'Pro League Belga', 'league-generic', 'silver', '#c8102e'],
    ['scottish-premiership', 'Premiership Escocesa', 'league-generic', 'silver', '#5b2d8e'],
    ['scottish-championship', 'Championship Escocesa', 'league-generic', 'silver', '#1d3b8f'],
    ['super-lig', 'Süper Lig', 'super-lig', 'gold', '#e30a17'],
    ['russian-premier-league', 'Premier League Russa', 'league-generic', 'silver', '#0039a6'],
    ['greek-super-league', 'Super League Grega', 'league-generic', 'silver', '#0d5eaf'],
    ['austrian-bundesliga', 'Bundesliga Austríaca', 'league-generic', 'silver', '#ed2939'],
    ['danish-superliga', 'Superliga Dinamarquesa', 'league-generic', 'silver', '#c60c30'],
    ['swiss-super-league', 'Super League Suíça', 'league-generic', 'silver', '#d52b1e'],
    ['eliteserien', 'Eliteserien', 'league-generic', 'silver', '#ba0c2f'],
    ['allsvenskan', 'Allsvenskan', 'league-generic', 'silver', '#006aa7'],
    ['liga-1-romania', 'Liga I Romena', 'league-generic', 'silver', '#002b7f'],
    ['liga-profesional', 'Liga Profesional Argentina', 'liga-profesional', 'silver', '#75aadb'],
    ['primera-nacional', 'Primera Nacional', 'league-generic', 'silver', '#75aadb'],
    ['primera-b-metro', 'Primera B Metropolitana', 'league-generic', 'bronze', '#75aadb'],
    ['liga-colombia', 'Liga Colombiana', 'league-generic', 'silver', '#fcd116'],
    ['liga-uruguay', 'Campeonato Uruguaio', 'league-generic', 'silver', '#5cbfeb'],
    ['liga-chile', 'Campeonato Chileno', 'league-generic', 'silver', '#d52b1e'],
    ['liga-paraguay', 'Campeonato Paraguaio', 'league-generic', 'silver', '#d52b1e'],
    ['liga-peru', 'Liga 1 Peruana', 'league-generic', 'silver', '#d91023'],
    ['ligapro-ecuador', 'LigaPro Equatoriana', 'league-generic', 'silver', '#ffd100'],
    ['liga-bolivia', 'Campeonato Boliviano', 'league-generic', 'silver', '#007934'],
    ['liga-venezuela', 'Liga FUTVE', 'league-generic', 'silver', '#8a1538'],
    ['liga-mx', 'Liga MX', 'liga-mx', 'gold', '#006847'],
    ['liga-expansion', 'Liga de Expansión MX', 'league-generic', 'silver', '#006847'],
    ['mls-cup', 'MLS Cup', 'mls-cup', 'silver', '#1c2a5c'],
    ['liga-costa-rica', 'Campeonato Costa-riquenho', 'league-generic', 'silver', '#ce1126'],
    ['liga-honduras', 'Liga Nacional de Honduras', 'league-generic', 'silver', '#0073cf'],
    ['liga-guatemala', 'Liga Nacional da Guatemala', 'league-generic', 'silver', '#4997d0'],
    ['liga-el-salvador', 'Campeonato Salvadorenho', 'league-generic', 'silver', '#0047ab'],
    ['saudi-pro-league', 'Saudi Pro League', 'saudi-pro-league', 'gold', '#006c35'],
    ['j1-league', 'J1 League', 'league-generic', 'silver', '#bc002d'],
    ['chinese-super-league', 'Superliga Chinesa', 'league-generic', 'gold', '#de2910'],
    ['a-league', 'A-League', 'league-generic', 'silver', '#ffcd00'],
    ['south-african-premiership', 'Premiership Sul-Africana', 'league-generic', 'gold', '#007749'],
  ]),

  // ─────────────── copas nacionais ───────────────
  ...make('domestic_cup', [
    ['copa-do-brasil', 'Copa do Brasil', 'copa-do-brasil', 'gold', '#1f7a3a'],
    ['fa-cup', 'Copa da Inglaterra', 'fa-cup', 'silver', '#c8102e'],
    ['league-cup', 'Copa da Liga Inglesa', 'cup-generic', 'silver', '#1fa04a'],
    ['copa-del-rey', 'Copa do Rei', 'cup-generic', 'silver', '#c60b1e'],
    ['coppa-italia', 'Copa da Itália', 'coppa-italia', 'silver', '#1f4fa8'],
    ['dfb-pokal', 'Copa da Alemanha', 'dfb-pokal', 'silver', '#d20515'],
    ['coupe-de-france', 'Copa da França', 'coupe-de-france', 'silver', '#1c2a5c'],
    ['taca-portugal', 'Taça de Portugal', 'taca-portugal', 'silver', '#b0102b'],
    ['knvb-beker', 'Copa da Holanda', 'cup-generic', 'silver', '#f36c21'],
    ['belgian-cup', 'Copa da Bélgica', 'cup-generic', 'silver', '#c8102e'],
    ['scottish-cup', 'Copa da Escócia', 'cup-generic', 'silver', '#0b1f4b'],
    ['turkish-cup', 'Copa da Turquia', 'cup-generic', 'silver', '#e30a17'],
    ['russian-cup', 'Copa da Rússia', 'cup-generic', 'silver', '#0039a6'],
    ['greek-cup', 'Copa da Grécia', 'cup-generic', 'silver', '#0d5eaf'],
    ['austrian-cup', 'Copa da Áustria', 'cup-generic', 'silver', '#ed2939'],
    ['danish-cup', 'Copa da Dinamarca', 'cup-generic', 'silver', '#c60c30'],
    ['swiss-cup', 'Copa da Suíça', 'cup-generic', 'silver', '#d52b1e'],
    ['norwegian-cup', 'Copa da Noruega', 'cup-generic', 'silver', '#ba0c2f'],
    ['swedish-cup', 'Copa da Suécia', 'cup-generic', 'silver', '#006aa7'],
    ['romanian-cup', 'Copa da Romênia', 'cup-generic', 'silver', '#002b7f'],
    ['copa-argentina', 'Copa Argentina', 'copa-argentina', 'gold', '#75aadb'],
    ['copa-colombia', 'Copa da Colômbia', 'cup-generic', 'silver', '#fcd116'],
    ['copa-uruguay', 'Copa AUF Uruguai', 'cup-generic', 'silver', '#5cbfeb'],
    ['copa-chile', 'Copa Chile', 'cup-generic', 'silver', '#d52b1e'],
    ['copa-paraguay', 'Copa Paraguai', 'cup-generic', 'silver', '#d52b1e'],
    ['copa-bolivia', 'Copa da Bolívia', 'cup-generic', 'silver', '#007934'],
    ['us-open-cup', 'U.S. Open Cup', 'cup-generic', 'silver', '#1c2a5c'],
    ['kings-cup', 'Copa do Rei Saudita', 'cup-generic', 'gold', '#006c35'],
    ['emperors-cup', 'Copa do Imperador', 'cup-generic', 'silver', '#bc002d'],
    ['chinese-fa-cup', 'Copa da China', 'cup-generic', 'gold', '#de2910'],
    ['australia-cup', 'Australia Cup', 'cup-generic', 'silver', '#ffcd00'],
    ['nedbank-cup', 'Copa da África do Sul', 'cup-generic', 'gold', '#007749'],
    // estaduais brasileiros
    ['paulista', 'Campeonato Paulista', 'estadual', 'gold', '#111111'],
    ['carioca', 'Campeonato Carioca', 'estadual', 'gold', '#0b3d91'],
    ['mineiro', 'Campeonato Mineiro', 'estadual', 'gold', '#c8102e'],
    ['gaucho', 'Campeonato Gaúcho', 'estadual', 'gold', '#1f7a3a'],
    ['paranaense', 'Campeonato Paranaense', 'estadual', 'gold', '#1f7a3a'],
    ['catarinense', 'Campeonato Catarinense', 'estadual', 'gold', '#c8102e'],
    ['baiano', 'Campeonato Baiano', 'estadual', 'gold', '#0b3d91'],
    ['pernambucano', 'Campeonato Pernambucano', 'estadual', 'gold', '#c8102e'],
    ['cearense', 'Campeonato Cearense', 'estadual', 'gold', '#1f7a3a'],
    ['goiano', 'Campeonato Goiano', 'estadual', 'gold', '#1f7a3a'],
    ['paraense', 'Campeonato Paraense', 'estadual', 'gold', '#0b3d91'],
    ['alagoano', 'Campeonato Alagoano', 'estadual', 'gold', '#c8102e'],
    ['mato-grossense', 'Campeonato Mato-Grossense', 'estadual', 'gold', '#1f7a3a'],
  ]),

  // ─────────────── prêmios individuais ───────────────
  ...make('award', [
    ['ballon-dor', 'Bola de Ouro', 'ballon-dor', 'gold', '#c8a13a'],
    ['golden-boot', 'Chuteira de Ouro', 'golden-boot', 'gold', '#c8a13a'],
    ['golden-glove', 'Luva de Ouro', 'golden-glove', 'gold', '#1d3b8f'],
    ['the-best', 'The Best FIFA', 'the-best', 'gold', '#0b1f5c'],
    ['kopa', 'Troféu Kopa', 'kopa', 'gold', '#c8102e'],
    ['puskas', 'Prêmio Puskás', 'puskas', 'gold', '#0b6aa2'],
    ['league-top-scorer', 'Artilheiro da Liga', 'golden-boot', 'silver', '#8a8f9c'],
    ['league-best-player', 'Craque da Liga', undefined, 'gold', '#8a8f9c'],
    ['wc-golden-ball', 'Bola de Ouro da Copa', 'ballon-dor', 'gold', '#1f7a3a'],
    ['wc-golden-boot', 'Chuteira de Ouro da Copa', 'golden-boot', 'gold', '#1f7a3a'],
    ['team-of-the-year', 'Seleção do Ano', undefined, 'silver', '#8a8f9c'],
  ]),
]
