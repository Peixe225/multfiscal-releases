/**
 * Catálogo dos criativos gravados: junta o .json de cada vídeo com o que a carreira teve de verdade
 * (Hall), para escrever legendas e montar a galeria.
 *
 *   node scripts/gravar/catalogo.mjs saida/ [https://oprojeto.online/lenda/criativos/]
 *
 * Escreve saida/_catalogo.json (lista com fatos de cada vídeo) — as legendas entram depois em
 * saida/_legendas.json ({ nome: { titulo, resumo, gancho, legenda, hashtags } }).
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { clubeNome, paisNome, tacaNome } from './comum.mjs'

const dir = process.argv[2]
const URL_BASE = process.argv[3] || 'https://oprojeto.online/lenda/criativos/'
const POS = { CA: 'Centroavante', PE: 'Ponta esquerda', PD: 'Ponta direita', MEI: 'Meia-atacante', MC: 'Meio-campista', VOL: 'Volante', LE: 'Lateral esquerdo', LD: 'Lateral direito', ZAG: 'Zagueiro', GOL: 'Goleiro', ME: 'Meia esquerda', MD: 'Meia direita' }
const PREMIO = { ballon_dor: 'Bola de Ouro', the_best: 'The Best', golden_boot: 'Chuteira de Ouro', golden_glove: 'Luva de Ouro', wc_golden_ball: 'Bola de Ouro da Copa', league_top_scorer: 'Artilheiro da liga', league_best_player: 'Melhor da liga', kopa: 'Troféu Kopa', puskas: 'Prêmio Puskás' }
const ORDEM = { extraordinaria: 0, otima: 1, boa: 2, mediana: 3, ruim: 4, pessima: 5, live: 6, imersivo: 7, hall: 8, compilacao: 9 }

const lista = []
for (const f of readdirSync(dir).filter((f) => /\.json$/.test(f) && !f.startsWith('_'))) {
  const m = JSON.parse(readFileSync(join(dir, f), 'utf8'))
  if (!m.ok) continue
  const nome = f.replace(/\.json$/, '')
  const e = m.hall?.[0]
  const s = e?.summary
  const idn = e?.identity ?? m.identity
  const mp4 = join(dir, `${nome}.mp4`)
  const item = {
    nome, tipo: m.tipo, faixa: m.faixa ?? m.tipo, formato: m.formato, duracao: Math.round(m.segundos ?? 0),
    fluidez: m.recebidos && m.segundos ? Math.round(m.recebidos / m.segundos) : null,
    mb: existsSync(mp4) ? +(statSync(mp4).size / 1e6).toFixed(1) : null,
    url: URL_BASE + `${nome}.mp4`, corte: existsSync(join(dir, `${nome}-corte.mp4`)) ? URL_BASE + `${nome}-corte.mp4` : null,
    capa: existsSync(join(dir, `${nome}.jpg`)) ? URL_BASE + `${nome}.jpg` : null,
    marcas: m.marcas ?? [],
  }
  if (s) {
    Object.assign(item, {
      nota: e.legacy?.score ?? null, jogador: idn.surname, numero: idn.number, pais: paisNome(idn.nationality), posicao: POS[idn.position] ?? idn.position, ritmo: m.pace ?? e.pace,
      headline: s.headline, temporadas: s.seasons, idadeFim: e.career?.age, motivoFim: e.retiredReason, auge: s.peakOvr, jogos: s.totals.apps, gols: s.totals.goals, assist: s.totals.assists,
      clubes: s.clubs.filter((c) => !c.loan).map((c) => `${clubeNome(c.clubId)} (${c.seasons} temp.)`),
      titulos: s.trophies.map((t) => `${tacaNome(t.trophyId)}${t.count > 1 ? ` ×${t.count}` : ''}`), totalTitulos: s.trophies.reduce((a, t) => a + t.count, 0),
      premios: s.awards.map((a) => `${PREMIO[a.award] ?? a.award}${a.count > 1 ? ` ×${a.count}` : ''}`),
      selecao: s.national ? { jogos: s.national.caps ?? s.national.apps ?? 0, gols: s.national.goals ?? 0 } : null,
      comparacoes: s.comparisons.slice(0, 3),
    })
  } else if (m.identity) Object.assign(item, { jogador: m.identity.surname, numero: m.identity.number, pais: paisNome(m.identity.nationality), posicao: POS[m.identity.position] ?? m.identity.position })
  lista.push(item)
}
// legendas (scripts de legenda escrevem saida/_legendas.json); {jogador}, {nota}… viram os dados reais
const LEG = existsSync(join(dir, '_legendas.json')) ? JSON.parse(readFileSync(join(dir, '_legendas.json'), 'utf8')) : {}
const TIER = (n) => (n >= 90 ? 'Imortal' : n >= 75 ? 'Lenda' : n >= 60 ? 'Craque' : n >= 45 ? 'Ídolo' : n >= 25 ? 'Profissional' : 'Promessa')
for (const i of lista) {
  const l = LEG[i.nome]
  if (!l) continue
  const v = { jogador: i.jogador, nota: i.nota, tier: i.nota != null ? TIER(i.nota) : null, headline: i.headline, pais: i.pais, posicao: i.posicao, gols: i.gols, titulos: i.totalTitulos }
  const encher = (t) => String(t ?? '').replace(/\{(\w+)\}/g, (m, k) => (v[k] != null && v[k] !== '' ? String(v[k]) : m))
  for (const k of ['titulo', 'gancho', 'resumo', 'legenda', 'hashtags', 'ideia']) if (l[k]) i[k] = encher(l[k])
  if (i.nota != null) i.tier = TIER(i.nota)
  const sobrou = ['titulo', 'gancho', 'resumo', 'legenda'].filter((k) => /\{\w+\}/.test(i[k] ?? ''))
  if (sobrou.length) console.warn(`aviso: ${i.nome} ainda tem marcador em ${sobrou.join(', ')}`)
}
lista.sort((a, b) => (ORDEM[a.faixa] ?? 9) - (ORDEM[b.faixa] ?? 9) || (b.nota ?? 0) - (a.nota ?? 0) || a.nome.localeCompare(b.nome))
writeFileSync(join(dir, '_catalogo.json'), JSON.stringify(lista, null, 1))
console.log(`${lista.length} vídeos no catálogo`)
for (const i of lista) console.log(i.nome.padEnd(24), String(i.nota ?? '').padStart(3), (i.headline ?? '').padEnd(38), `${i.duracao}s`, `${i.fluidez ?? '?'}fps`, `${i.mb}MB`)
