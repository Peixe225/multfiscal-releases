// Força dos clubes (escala OVR 40–92 = OVR que um titular precisa ter).
//
// 1) Clubes cobertos pela EA FC 27: média dos 14 melhores jogadores (cartas base do fut.gg),
//    esticada para a nossa escala: s = 80 + 1.25·(top14 − 80). Assim PSG/Real/Bayern/City ≈ 86–88,
//    meio da Championship ≈ 69, League Two ≈ 58–60.
// 2) + forma na tabela atual: z-score de pontos por jogo dentro da liga, com peso que cresce com o
//    número de jogos disputados (no começo da temporada europeia quase não pesa).
// 3) Clubes sem EA (quase todo o Brasil, parte da América do Sul, Japão, Rússia, África do Sul…):
//    base da liga (média/desvio calibrados à mão ou pelos clubes EA da mesma liga) + prestígio +
//    forma. O Brasileirão A/B e ajustes pontuais vêm fixados em src/data/catalog/clubs.ts.
import { clamp, mean, sd, round1, nameSim, fold } from './util.mjs'
import { nationCode } from './nations.mjs'

export const EA_LEAGUE_COUNTRY = {
  13: 'ENG', 14: 'ENG', 60: 'ENG', 61: 'ENG', 53: 'ESP', 54: 'ESP', 31: 'ITA', 32: 'ITA', 19: 'GER', 20: 'GER',
  16: 'FRA', 17: 'FRA', 10: 'NED', 308: 'POR', 68: 'TUR', 50: 'SCO', 4: 'BEL', 39: 'USA', 341: 'MEX', 350: 'KSA',
  353: 'ARG', 41: 'NOR', 56: 'SWE', 1: 'DEN', 80: 'AUT', 189: 'SUI', 330: 'ROU', 63: 'GRE', 66: 'POL', 83: 'KOR',
  2012: 'CHN', 351: 'AUS', 319: 'CZE', 332: 'UKR', 317: 'CRO', 2210: 'CYP', 2211: 'HUN', 2172: 'UAE', 2274: 'BUL',
  2149: 'IND', 65: 'IRL',
}
/** Países cujos clubes jogam na liga de outro país. */
const COUNTRY_ALSO = { USA: ['CAN'], AUS: ['NZL'], SUI: ['LIE'], ESP: ['AND'], ENG: ['WAL'] }

/** Nomes da EA que não batem por similaridade (licenças, apelidos) → id ESPN. */
export const EA_ALIASES = {
  'Lombardia FC': '110',
  'Milano FC': '103',
  'Bergamo Calcio': '105',
  'Man Utd': '360',
  'Spurs': '367',
  "Nott'm Forest": '393',
  'Newcastle Utd': '361',
  OL: '167',
  OM: '176',
  LOSC: '166',
  PSG: '160',
  'FCSM': '272',
  'Havre AC': '3236',
  'Stade Brestois 29': '6997',
  'M\'gladbach': '268',
  'Fürth ': '3070',
  'Leverkusen': '131',
  'Frankfurt': '125',
  'Heidenheim': '6418',
  'SV Werder Bremen': '137',
  'FC Bayern München': '132',
  'R. Union St.-G.': '5807',
  'Sp. Charleroi': '3616',
  'SK Beveren': '13450',
  'RAAL La Louvière': '131235',
  'Royal Antwerp FC': '17544',
  'Sint-Truiden': '936',
  'RC Deportivo': '90',
  'R. Racing Club': '87',
  'R. Sporting': '3788',
  'R. Oviedo': '92',
  'R. Valladolid CF': '95',
  'Real Sociedad B': '20983',
  'Celta Fortuna': '131858',
  'Celta': '85',
  'D. Alavés': '96',
  'Athletic Club': '93',
  'Atlético de Madrid': '1068',
  'Boro': '369',
  'Wolves': '380',
  'Sheffield Utd': '398',
  'Sheffield Wed': '399',
  'Charlton Ath': '372',
  'Cambridge Utd': '351',
  'Oxford United': '311',
  'MK Dons': '390',
  'AFC Wimbledon': '3802',
  'Rotherham Utd': '402',
  'Whitecaps FC': '9727',
  'Sounders FC': '9726',
  'New England': '189',
  'SJ Earthquakes': '191',
  'Red Bulls': '190',
  'Philadelphia': '10739',
  'Sporting KC': '186',
  'St. Louis CITY SC': '21812',
  'Club Guadalajara': '219',
  'Club Tigres': '232',
  'Pumas': '233',
  'Atlético de SL': '15720',
  'Toluca FC': '223',
  'Club América': '227',
  'CF Cruz Azul': '218',
  'FC Juárez': '17851',
  'Al Qadsiah': '22022',
  'Diriyah': '131746',
  'Abha': '21833',
  'Argentinos Jrs.': '3',
  'Rosario Central ': '17',
  'Defensa': '8950',
  'Ind. Rivadavia': '9744',
  'Dep. Riestra': '17702',
  'Central Córdoba': '11989',
  'Gimnasia Mendoza': '11972',
  'Unión': '20',
  'Estudiantes RC': '19685',
  'Estudiantes': '8',
  'Instituto': '2975',
  'Sarmiento': '10158',
  'Racing Club': '15',
  'Barracas Central': '10060',
  'Talleres': '19',
  // CONMEBOL (ligas "Libertadores/Sudamericana" da EA)
  'Peñarol': '2683',
  'Nacional|1003': '2684',
  'Cerro Porteño': '2671',
  'IDV': '17086',
  'Indep. Santa Fe': '5488',
  'Junior': '4815',
  'LDU Quito': '4816',
  'Universitario': '2685',
  'Deportes Tolima': '5489',
  'Indep. Medellín': '2690',
  'Sporting Cristal': '2673',
  'Libertad': '2670',
  'Barcelona SC': '2686',
  'Bolívar': '2681',
  'Coquimbo Unido': '8186',
  'Cusco FC': '11995',
  'UCV FC': '10094',
  'Dep. La Guaira': '17090',
  'Always Ready': '19425',
  'Botafogo': '6086',
  'Olimpia': '2675',
  'América de Cali': '8109',
  'Millonarios': '5484',
  'Cienciano': '3372',
  'Juventud': '8416',
  'Recoleta': '22517',
  'City Torque': '19002',
  'Puerto Cabello': '18995',
  'Palestino': '4422',
  'Audax Italiano': '4138',
  'Dep. Cuenca': '4812',
  'Macará': '18439',
  "O'Higgins": '6072',
  'Carabobo FC': '6037',
  'Boston River': '9999',
  'Caracas FC': '4811',
  'Blooming': '6047',
  'Alianza Atlético': '5267',
  'Ind. Petrolero': '20889',
  // extras
  'Ferencvárosi TC': '622',
  'PFC Ludogorets': '13018',
  'Al Ain FC': '7128',
  'Omonia FC': '617',
  'APOEL FC': '2497',
  'Slavia Praha': '494',
  'Sparta Praha': '433',
  'Viktoria Plzeň': '11706',
  'Jeonbuk Hyundai': '7119',
  'Ulsan HD FC': '7120',
  'Daejeon Hana': '133171',
  'Lech Poznań': '2990',
  'Jagiellonia': '11505',
  'Raków': '21005',
  'Melb. Victory': '5328',
  'WS Wanderers': '13696',
  'Well. Phoenix': '8352',
  'Central Coast': '5325',
  'Beijing FC': '2052',
  'Shanghai Port FC': '15515',
  'Dalian Yingbo': '22537',
  'Qingdao W. Coast': '22198',
  'SZ Peng City': '22199',
  'Wuhan Three Towns': '21506',
  'Tianjin JMT FC': '8239',
  'Zhejiang Pro': '18203',
  'Univ. Craiova': '8089',
  'FC Univ. Cluj': '8091',
  'FC Rapid 1923': '545',
  'FC Dinamo 1948': '2496',
  'CFR 1907 Cluj': '5260',
  'SC Oțelul Galați': '2942',
  'FK Csíkszereda': '21032',
  'SV Oberbank Ried': '3759',
  'SC Austria': '21540',
  'WSG Tirol': '18794',
  'Grazer AK': '21846',
  'SCR Altach': '4405',
  'FK Austria Wien': '1382',
  'SK Rapid': '519',
  'HamKam Fotball': '21380',
  'KFUM-Kameratene': '22165',
  'Vålerenga Fotball': '2791',
  'GC Zürich': '492',
  'Lausanne-Sport': '11551',
  'BSC Young Boys': '2722',
  'FC Basel 1893': '989',
  'Brommapojkarna': '8221',
  'Örgryte IS': '131552',
  'IK Sirius': '8547',
  'Çorum FK': '132334',
  'Amed': '132335',
  'Başakşehir': '7914',
  'Gençlerbirliği': '996',
  'Rizespor': '7656',
  'Olympiacos FC': '435',
  'PAOK FC': '605',
  'N.E.C. Nijmegen': '147',
  'Go Ahead Eagles': '3706',
}

/** Agrupa as cartas EA por clube (clube + liga EA), juntando grupos minúsculos ao grupo principal. */
export function groupEaClubs(players) {
  const g = new Map()
  for (const p of players) {
    if (!p.club) continue
    const k = `${p.club}|${p.leagueEaId}`
    if (!g.has(k)) g.set(k, { club: p.club, leagueEaId: p.leagueEaId, players: [] })
    g.get(k).players.push(p)
  }
  const byName = new Map()
  for (const x of g.values()) {
    const cur = byName.get(x.club)
    if (!cur || cur.players.length < x.players.length) byName.set(x.club, x)
  }
  for (const x of g.values()) {
    const main = byName.get(x.club)
    if (main !== x && x.players.length < 4) {
      main.players.push(...x.players)
      x.players = []
    }
  }
  const out = []
  for (const x of g.values()) {
    if (x.players.length < 4) continue
    let country = EA_LEAGUE_COUNTRY[x.leagueEaId]
    if (!country) {
      const c = {}
      for (const p of x.players) {
        const n = nationCode(p.nation)
        if (n) c[n] = (c[n] || 0) + 1
      }
      country = Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0]
    }
    x.players.sort((a, b) => b.ovr - a.ovr)
    const top = x.players.slice(0, 14).map((p) => p.ovr)
    while (top.length < 14) top.push(top[top.length - 1] - 2)
    out.push({ ...x, country, top14: mean(top) })
  }
  return out
}

/**
 * Associa clubes EA a clubes ESPN (candidatos: [{id, country, names:[]}]).
 * Retorna Map(espnId → eaClub) e a lista de não associados.
 */
export function matchEaClubs(eaClubs, candidates) {
  const byId = new Map(candidates.map((c) => [c.id, c]))
  const pairs = []
  for (const ea of eaClubs) {
    const alias = EA_ALIASES[`${ea.club}|${ea.leagueEaId}`] ?? EA_ALIASES[ea.club]
    if (alias && byId.has(alias)) {
      pairs.push({ ea, id: alias, sim: 2 })
      continue
    }
    const countries = [ea.country, ...(COUNTRY_ALSO[ea.country] || [])]
    for (const c of candidates) {
      if (!countries.includes(c.country)) continue
      let best = 0
      for (const n of c.names) best = Math.max(best, nameSim(ea.club, n))
      if (best >= 0.7) pairs.push({ ea, id: c.id, sim: best })
    }
  }
  pairs.sort((a, b) => b.sim - a.sim || b.ea.players.length - a.ea.players.length)
  const usedEa = new Set()
  const out = new Map()
  for (const p of pairs) {
    if (usedEa.has(p.ea) || out.has(p.id)) continue
    usedEa.add(p.ea)
    out.set(p.id, { ...p.ea, sim: p.sim })
  }
  const unmatched = eaClubs.filter((e) => !usedEa.has(e))
  return { matched: out, unmatched }
}

export const eaToScale = (top14) => 80 + 1.25 * (top14 - 80)

/** Base (média, desvio) para clubes SEM EA em ligas pouco ou nada cobertas pela EA. */
export const LEAGUE_BASE = {
  'bra.1': [73, 2.5],
  'bra.2': [66, 1.5],
  'arg.2': [62, 2],
  'arg.3': [56, 1.8],
  'col.1': [64, 2.2],
  'uru.1': [61.5, 2.2],
  'chi.1': [63, 2.2],
  'par.1': [63, 2.2],
  'per.1': [61, 2.2],
  'ecu.1': [63, 2.2],
  'bol.1': [58.5, 2.2],
  'ven.1': [58.5, 2],
  'mex.2': [60, 1.8],
  'crc.1': [60, 2.5],
  'hon.1': [57, 2.3],
  'gua.1': [55, 2.2],
  'slv.1': [53, 2.2],
  'jpn.1': [69, 2.3],
  'rus.1': [68, 2.5],
  'rsa.1': [62, 2.5],
  'ned.2': [60, 2],
  'sco.2': [56, 2],
  'gre.1': [64, 2.2],
}

/**
 * Calcula a força de todos os clubes.
 * clubs: [{ id, leagueId, meta(ClubMeta), table?:{played, points}, ea?:{top14} }]
 * leagues: Map(leagueId → League)
 */
export function computeStrengths(clubs, leagues) {
  const byLeague = new Map()
  for (const c of clubs) {
    if (!byLeague.has(c.leagueId)) byLeague.set(c.leagueId, [])
    byLeague.get(c.leagueId).push(c)
  }
  for (const [lid, list] of byLeague) {
    // z de pontos por jogo
    const withGames = list.filter((c) => c.table && c.table.played > 0)
    const ppg = withGames.map((c) => c.table.points / c.table.played)
    const mP = mean(ppg)
    const sP = sd(ppg) || 1
    const gp = withGames.length ? mean(withGames.map((c) => c.table.played)) : 0
    for (const c of list) c._z = c.table && c.table.played > 0 ? clamp((c.table.points / c.table.played - mP) / sP, -2.5, 2.5) : 0

    // EA → escala
    for (const c of list) if (c.ea) c._ea = eaToScale(c.ea.top14)
    const eaVals = list.filter((c) => c._ea !== undefined).map((c) => c._ea)
    const coverage = eaVals.length / list.length
    let [bMean, bSd] = LEAGUE_BASE[lid] || []
    if (bMean === undefined) {
      if (eaVals.length >= 3) {
        // clubes sem EA numa liga coberta tendem a ser os mais fracos dela
        bMean = mean(eaVals) - 0.6 * (sd(eaVals) || 2)
        bSd = sd(eaVals) || 2
      } else {
        const coef = leagues.get(lid)?.coefficient ?? 0.4
        bMean = 50 + 30 * coef
        bSd = 2.5
      }
    }
    const prest = list.map((c) => c.meta?.prestige).filter((x) => x !== undefined)
    const mPr = prest.length ? mean(prest) : 0
    const sPr = sd(prest) || 1
    const wFormEA = Math.min(1, gp / 25) * 0.9 // pontos de OVR por z
    const wFormNo = Math.min(1, gp / 20)
    for (const c of list) {
      let s
      if (c.meta?.strength !== undefined) {
        s = c.meta.strength
        c.strengthSource = 'manual'
      } else if (c._ea !== undefined) {
        s = c._ea + wFormEA * c._z
        c.strengthSource = 'ea'
      } else {
        const zPr = c.meta?.prestige !== undefined ? clamp((c.meta.prestige - mPr) / sPr, -2, 2.5) : -0.3
        s = bMean + bSd * (0.5 * zPr + 0.6 * wFormNo * c._z)
        c.strengthSource = 'formula'
      }
      c.strength = round1(clamp(s, 40, 92))
    }
    void coverage
  }
  return clubs
}

/** Prestígio padrão para clubes sem prestígio no catálogo. */
export function defaultPrestige(strength, coefficient, tier) {
  const p = (strength - 60) / 7 + (coefficient - 0.5) * 2 - (tier - 1) * 0.5
  return clamp(Math.round(p * 2) / 2, 0, 3)
}

export { fold }
