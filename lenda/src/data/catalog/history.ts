/**
 * Histórico real (escrito à mão) para a aba "Mundo", a Bola de Ouro e as comparações.
 * Convenção de temporada (types.ts): `season` = ANO DE INÍCIO. Europa 2025/26 → 2025; Brasil 2025 → 2025;
 * torneios de seleções e Mundial de Clubes disputados no meio do ano T → T-1.
 * `winner` = id do clube ("e819") ou código FIFA da seleção. Em `ballonDor`, `club` = id do clube.
 * Fontes: ESPN (finais e tabelas 2025/26) e pesquisa de 27/09/2026 (docs de pesquisa do projeto).
 */
import type { RealHistory } from '../../engine/types'

export const BALLON_DOR: RealHistory['ballonDor'] = [
  { year: 2008, player: 'Cristiano Ronaldo', nationality: 'POR', club: 'e360' },
  { year: 2009, player: 'Lionel Messi', nationality: 'ARG', club: 'e83' },
  { year: 2010, player: 'Lionel Messi', nationality: 'ARG', club: 'e83' },
  { year: 2011, player: 'Lionel Messi', nationality: 'ARG', club: 'e83' },
  { year: 2012, player: 'Lionel Messi', nationality: 'ARG', club: 'e83' },
  { year: 2013, player: 'Cristiano Ronaldo', nationality: 'POR', club: 'e86' },
  { year: 2014, player: 'Cristiano Ronaldo', nationality: 'POR', club: 'e86' },
  { year: 2015, player: 'Lionel Messi', nationality: 'ARG', club: 'e83' },
  { year: 2016, player: 'Cristiano Ronaldo', nationality: 'POR', club: 'e86' },
  { year: 2017, player: 'Cristiano Ronaldo', nationality: 'POR', club: 'e86' },
  { year: 2018, player: 'Luka Modrić', nationality: 'CRO', club: 'e86' },
  { year: 2019, player: 'Lionel Messi', nationality: 'ARG', club: 'e83' },
  // 2020: não houve entrega (pandemia)
  { year: 2021, player: 'Lionel Messi', nationality: 'ARG', club: 'e160' },
  { year: 2022, player: 'Karim Benzema', nationality: 'FRA', club: 'e86' },
  { year: 2023, player: 'Lionel Messi', nationality: 'ARG', club: 'e20232' },
  { year: 2024, player: 'Rodri', nationality: 'ESP', club: 'e382' },
  { year: 2025, player: 'Ousmane Dembélé', nationality: 'FRA', club: 'e160' },
]

/** Bola de Ouro 2026: cerimônia em 26/10/2026 (London Palladium) — o jogo simula o vencedor. */
export const BALLON_DOR_2026 = {
  year: 2026,
  ceremony: '2026-10-26',
  players: [
    'Jude Bellingham', 'Pau Cubarsí', 'Marc Cucurella', 'Ousmane Dembélé', 'Luis Díaz', 'Bruno Fernandes',
    'Erling Haaland', 'Gabriel Magalhães', 'Harry Kane', 'Achraf Hakimi', 'Lamine Yamal', 'Khvicha Kvaratskhelia',
    'Marquinhos', 'Sadio Mané', 'Lautaro Martínez', 'Kylian Mbappé', 'Nuno Mendes', 'Lionel Messi', 'João Neves',
    'Michael Olise', 'Willian Pacho', 'Julián Quiñones', 'Declan Rice', 'Rodri', 'Fabián Ruiz', 'William Saliba',
    'Ferran Torres', 'Dayot Upamecano', 'Vinícius Júnior', 'Vitinha',
  ],
}

export const WORLD_CUP: RealHistory['worldCup'] = [
  { year: 1930, champion: 'URU', runnerUp: 'ARG', score: '4–2', host: 'URU' },
  { year: 1934, champion: 'ITA', runnerUp: 'CZE', score: '2–1 (prorr.)', host: 'ITA' },
  { year: 1938, champion: 'ITA', runnerUp: 'HUN', score: '4–2', host: 'FRA' },
  { year: 1950, champion: 'URU', runnerUp: 'BRA', score: '2–1', host: 'BRA' },
  { year: 1954, champion: 'GER', runnerUp: 'HUN', score: '3–2', host: 'SUI' },
  { year: 1958, champion: 'BRA', runnerUp: 'SWE', score: '5–2', host: 'SWE' },
  { year: 1962, champion: 'BRA', runnerUp: 'CZE', score: '3–1', host: 'CHI' },
  { year: 1966, champion: 'ENG', runnerUp: 'GER', score: '4–2 (prorr.)', host: 'ENG' },
  { year: 1970, champion: 'BRA', runnerUp: 'ITA', score: '4–1', host: 'MEX' },
  { year: 1974, champion: 'GER', runnerUp: 'NED', score: '2–1', host: 'GER' },
  { year: 1978, champion: 'ARG', runnerUp: 'NED', score: '3–1 (prorr.)', host: 'ARG' },
  { year: 1982, champion: 'ITA', runnerUp: 'GER', score: '3–1', host: 'ESP' },
  { year: 1986, champion: 'ARG', runnerUp: 'GER', score: '3–2', host: 'MEX' },
  { year: 1990, champion: 'GER', runnerUp: 'ARG', score: '1–0', host: 'ITA' },
  { year: 1994, champion: 'BRA', runnerUp: 'ITA', score: '0–0 (3–2 pên.)', host: 'USA' },
  { year: 1998, champion: 'FRA', runnerUp: 'BRA', score: '3–0', host: 'FRA' },
  { year: 2002, champion: 'BRA', runnerUp: 'GER', score: '2–0', host: 'KOR/JPN' },
  { year: 2006, champion: 'ITA', runnerUp: 'FRA', score: '1–1 (5–3 pên.)', host: 'GER' },
  { year: 2010, champion: 'ESP', runnerUp: 'NED', score: '1–0 (prorr.)', host: 'RSA' },
  { year: 2014, champion: 'GER', runnerUp: 'ARG', score: '1–0 (prorr.)', host: 'BRA' },
  { year: 2018, champion: 'FRA', runnerUp: 'CRO', score: '4–2', host: 'RUS' },
  { year: 2022, champion: 'ARG', runnerUp: 'FRA', score: '3–3 (4–2 pên.)', host: 'QAT' },
  { year: 2026, champion: 'ESP', runnerUp: 'ARG', score: '1–0 (prorr.)', host: 'USA/MEX/CAN' },
]

type W = [season: number, winner: string]
const w = (rows: W[]) => rows.map(([season, winner]) => ({ season, winner }))

export const CHAMPIONS: RealHistory['champions'] = {
  // ── continentais ──
  'conmebol.libertadores': w([[2021, 'e2029'], [2022, 'e819'], [2023, 'e3445'], [2024, 'e6086'], [2025, 'e819']]),
  'conmebol.sudamericana': w([[2021, 'e3458'], [2022, 'e17086'], [2023, 'e4816'], [2024, 'e15'], [2025, 'e12']]),
  'conmebol.recopa': w([[2022, 'e2029'], [2023, 'e17086'], [2024, 'e3445'], [2025, 'e15'], [2026, 'e12']]),
  'uefa.champions': w([[2021, 'e86'], [2022, 'e382'], [2023, 'e86'], [2024, 'e160'], [2025, 'e160']]),
  'uefa.europa': w([[2021, 'e125'], [2022, 'e243'], [2023, 'e105'], [2024, 'e367'], [2025, 'e362']]),
  'uefa.europa.conf': w([[2021, 'e104'], [2022, 'e371'], [2023, 'e435'], [2024, 'e363'], [2025, 'e384']]),
  'uefa.super_cup': w([[2022, 'e86'], [2023, 'e382'], [2024, 'e86'], [2025, 'e160'], [2026, 'e160']]),
  'concacaf.champions': w([[2021, 'e9726'], [2022, 'e228'], [2023, 'e234'], [2024, 'e218'], [2025, 'e223']]),
  'afc.champions': w([[2022, 'e3385'], [2023, 'e7128'], [2024, 'e8346'], [2025, 'e8346']]),
  'caf.champions': w([[2021, 'e8625'], [2022, 'e10207'], [2023, 'e10207'], [2024, 'e20220'], [2025, 'e7084']]),
  'fifa.cwc': w([[2021, 'e363'], [2022, 'e86'], [2023, 'e382'], [2024, 'e363']]),
  'fifa.intercontinental_cup': w([[2024, 'e86'], [2025, 'e160']]),
  // ── seleções ──
  'conmebol.america': w([[2020, 'ARG'], [2023, 'ARG']]),
  'uefa.euro': w([[2020, 'ITA'], [2023, 'ESP']]),
  'concacaf.gold': w([[2020, 'USA'], [2022, 'MEX'], [2024, 'MEX']]),
  // Copa Africana 2025: Senegal venceu em campo; a CAF deu o título a Marrocos (W.O.) em 17/03/2026.
  'caf.nations': w([[2021, 'SEN'], [2023, 'CIV'], [2025, 'MAR']]),
  'afc.asian.cup': w([[2018, 'QAT'], [2023, 'QAT']]),
  // ── ligas ──
  'bra.1': w([[2021, 'e7632'], [2022, 'e2029'], [2023, 'e2029'], [2024, 'e6086'], [2025, 'e819']]),
  'bra.2': w([[2021, 'e6086'], [2022, 'e2022'], [2023, 'e3457'], [2024, 'e2674'], [2025, 'e3456']]),
  'eng.1': w([[2021, 'e382'], [2022, 'e382'], [2023, 'e382'], [2024, 'e364'], [2025, 'e359']]),
  'eng.2': w([[2021, 'e370'], [2022, 'e379'], [2023, 'e375'], [2024, 'e357'], [2025, 'e388']]),
  'esp.1': w([[2021, 'e86'], [2022, 'e83'], [2023, 'e86'], [2024, 'e83'], [2025, 'e83']]),
  'esp.2': w([[2023, 'e17534'], [2024, 'e1538'], [2025, 'e87']]),
  'ita.1': w([[2021, 'e103'], [2022, 'e114'], [2023, 'e110'], [2024, 'e114'], [2025, 'e110']]),
  'ita.2': w([[2023, 'e115'], [2024, 'e3997'], [2025, 'e17530']]),
  'ger.1': w([[2021, 'e132'], [2022, 'e132'], [2023, 'e131'], [2024, 'e132'], [2025, 'e132']]),
  'ger.2': w([[2023, 'e270'], [2024, 'e122'], [2025, 'e133']]),
  'fra.1': w([[2021, 'e160'], [2022, 'e160'], [2023, 'e160'], [2024, 'e160'], [2025, 'e160']]),
  'fra.2': w([[2023, 'e172'], [2024, 'e273'], [2025, 'e170']]),
  'por.1': w([[2021, 'e437'], [2022, 'e1929'], [2023, 'e2250'], [2024, 'e2250'], [2025, 'e437']]),
  'ned.1': w([[2021, 'e139'], [2022, 'e148'], [2023, 'e148'], [2024, 'e148'], [2025, 'e148']]),
  'bel.1': w([[2021, 'e570'], [2022, 'e17544'], [2023, 'e570'], [2024, 'e5807'], [2025, 'e570']]),
  'sco.1': w([[2021, 'e256'], [2022, 'e256'], [2023, 'e256'], [2024, 'e256'], [2025, 'e256']]),
  'tur.1': w([[2021, 'e997'], [2022, 'e432'], [2023, 'e432'], [2024, 'e432'], [2025, 'e432']]),
  'rus.1': w([[2021, 'e2533'], [2022, 'e2533'], [2023, 'e2533'], [2024, 'e11336'], [2025, 'e2533']]),
  'gre.1': w([[2021, 'e435'], [2022, 'e887'], [2023, 'e605'], [2024, 'e435'], [2025, 'e887']]),
  'aut.1': w([[2021, 'e2790'], [2022, 'e2790'], [2023, 'e3746'], [2024, 'e3746'], [2025, 'e4411']]),
  'den.1': w([[2021, 'e909'], [2022, 'e909'], [2023, 'e572'], [2024, 'e909'], [2025, 'e7853']]),
  'sui.1': w([[2021, 'e3019'], [2022, 'e2722'], [2023, 'e2722'], [2024, 'e989']]),
  'nor.1': w([[2021, 'e2980'], [2022, 'e2715'], [2023, 'e2980'], [2024, 'e2980'], [2025, 'e510']]),
  'swe.1': w([[2021, 'e2720'], [2022, 'e7834'], [2023, 'e2720'], [2024, 'e2720'], [2025, 'e20301']]),
  // Argentina: dois torneios por ano desde 2025 (Apertura e Clausura).
  'arg.1': w([[2021, 'e16'], [2022, 'e5'], [2023, 'e16'], [2024, 'e21'], [2025, 'e7764'], [2025, 'e8'], [2026, 'e4']]),
  'chi.1': w([[2021, 'e885'], [2022, 'e2688'], [2023, 'e4134'], [2024, 'e2688'], [2025, 'e8186']]),
  'bol.1': w([[2025, 'e19425']]),
  // México: Apertura (ano T) + Clausura (ano T+1) = temporada T.
  'mex.1': w([[2021, 'e216'], [2021, 'e216'], [2022, 'e234'], [2022, 'e232'], [2023, 'e227'], [2023, 'e227'], [2024, 'e227'], [2024, 'e223'], [2025, 'e223'], [2025, 'e218']]),
  'usa.1': w([[2021, 'e17606'], [2022, 'e18966'], [2023, 'e183'], [2024, 'e187'], [2025, 'e20232']]),
  'ksa.1': w([[2021, 'e929'], [2022, 'e2276'], [2023, 'e929'], [2024, 'e2276'], [2025, 'e817']]),
  'jpn.1': w([[2021, 'e7112'], [2022, 'e7116'], [2023, 'e7477'], [2024, 'e7477'], [2025, 'e7115']]),
  'chn.1': w([[2021, 'e7521'], [2022, 'e21506'], [2023, 'e15515'], [2024, 'e15515'], [2025, 'e15515']]),
  'rsa.1': w([[2021, 'e7084'], [2022, 'e7084'], [2023, 'e7084'], [2024, 'e7084'], [2025, 'e7085']]),
  // ── copas nacionais ──
  'bra.copa_do_brazil': w([[2021, 'e7632'], [2022, 'e819'], [2023, 'e2026'], [2024, 'e819'], [2025, 'e874']]),
  'eng.fa': w([[2021, 'e364'], [2022, 'e382'], [2023, 'e360'], [2024, 'e384'], [2025, 'e382']]),
  'eng.league_cup': w([[2021, 'e364'], [2022, 'e360'], [2023, 'e364'], [2024, 'e361'], [2025, 'e382']]),
  'esp.copa_del_rey': w([[2021, 'e244'], [2022, 'e86'], [2023, 'e93'], [2024, 'e83'], [2025, 'e89']]),
  'ita.coppa_italia': w([[2021, 'e110'], [2022, 'e110'], [2023, 'e111'], [2024, 'e107'], [2025, 'e110']]),
  'ger.dfb_pokal': w([[2021, 'e11420'], [2022, 'e11420'], [2023, 'e131'], [2024, 'e134'], [2025, 'e132']]),
  'fra.coupe_de_france': w([[2021, 'e165'], [2022, 'e179'], [2023, 'e160'], [2024, 'e160'], [2025, 'e175']]),
  'por.taca.portugal': w([[2021, 'e437'], [2022, 'e437'], [2023, 'e437'], [2024, 'e2250'], [2025, 'e21615']]),
  'ned.cup': w([[2021, 'e148'], [2022, 'e148'], [2023, 'e142'], [2024, 'e3706'], [2025, 'e140']]),
  'sco.tennents': w([[2021, 'e257'], [2022, 'e256'], [2023, 'e256'], [2024, 'e263'], [2025, 'e256']]),
  'arg.copa': w([[2021, 'e5'], [2022, 'e10374'], [2023, 'e8'], [2024, 'e11989'], [2025, 'e9744']]),
  'usa.open': w([[2022, 'e12011'], [2023, 'e6077'], [2024, 'e18966'], [2025, 'e18986']]),
  'bra.camp.paulista': w([[2025, 'e874'], [2026, 'e2029']]),
  'bra.camp.carioca': w([[2025, 'e819'], [2026, 'e819']]),
}
