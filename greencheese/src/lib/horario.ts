import type { Canal, Turno } from '../dados/canais'

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

function min(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + (m || 0)
}

function hora(hhmm: string): string {
  const [h, m] = hhmm.split(':')
  return m === '00' ? `${Number(h)}h` : `${Number(h)}h${m}`
}

export interface Situacao {
  aberto: boolean
  texto: string
}

/** "Aberto agora · até 3h" / "Fechado · abre 14h" — considera turno que atravessa a meia-noite. */
export function situacao(canal: Canal, agora = new Date()): Situacao {
  const semana = canal.horario.semana
  const dia = agora.getDay()
  const m = agora.getHours() * 60 + agora.getMinutes()
  const hoje = semana[dia]
  const ontem = semana[(dia + 6) % 7]
  // turno de ontem que vira a madrugada de hoje
  if (ontem) {
    const [a, f] = ontem
    if (min(f) <= min(a) && m < min(f)) return { aberto: true, texto: `Aberto agora · até ${hora(f)}` }
  }
  if (hoje) {
    const [a, f] = hoje
    const cruza = min(f) <= min(a)
    if (m >= min(a) && (cruza || m < min(f))) return { aberto: true, texto: `Aberto agora · até ${hora(f)}` }
    if (m < min(a)) return { aberto: false, texto: `Fechado · abre ${hora(a)}` }
  }
  for (let i = 1; i <= 7; i++) {
    const d = (dia + i) % 7
    const t = semana[d]
    if (t) return { aberto: false, texto: `Fechado · abre ${i === 1 ? 'amanhã' : DIAS[d]} ${hora(t[0])}` }
  }
  return { aberto: false, texto: 'Fechado' }
}

/** Resumo em uma linha: "seg–qui 14h–0h · sex–sáb 14h–3h · dom 15h–23h". */
export function resumoHorario(canal: Canal): string {
  const s = canal.horario.semana
  const fmt = (t: Turno) => (t ? `${hora(t[0])}–${hora(t[1])}` : 'fechado')
  const ordem = [1, 2, 3, 4, 5, 6, 0]
  const grupos: { de: number; ate: number; txt: string }[] = []
  for (const d of ordem) {
    const txt = fmt(s[d])
    const ult = grupos[grupos.length - 1]
    if (ult && ult.txt === txt) ult.ate = d
    else grupos.push({ de: d, ate: d, txt })
  }
  return grupos
    .map((g) => `${DIAS_CURTOS[g.de]}${g.de !== g.ate ? `–${DIAS_CURTOS[g.ate]}` : ''} ${g.txt}`)
    .join(' · ')
}

export function ehDiaDeEntregaGratis(canal: Canal, agora = new Date()): boolean {
  return !!canal.entregaGratis && canal.entregaGratis.dias.includes(agora.getDay())
}

const NO_DIA = ['no domingo', 'na segunda', 'na terça', 'na quarta', 'na quinta', 'na sexta', 'no sábado']

/**
 * Os dias da entrega grátis ditos como a loja fala: "na sexta", "na sexta e no sábado", "de sexta a domingo",
 * "de segunda a sexta", "todo dia". A semana começa na segunda (o fim de semana fica junto).
 */
export function diasDaEntregaGratis(dias: readonly number[]): string {
  const ordem = [1, 2, 3, 4, 5, 6, 0].filter((d) => dias.includes(d))
  if (ordem.length === 7) return 'todo dia'
  if (!ordem.length) return ''
  const seguidos = ordem.every((d, i) => i === 0 || [1, 2, 3, 4, 5, 6, 0].indexOf(d) === [1, 2, 3, 4, 5, 6, 0].indexOf(ordem[i - 1]) + 1)
  if (seguidos && ordem.length >= 3) return `de ${DIAS[ordem[0]]} a ${DIAS[ordem[ordem.length - 1]]}`
  const ditos = ordem.map((d) => NO_DIA[d])
  return ditos.length === 1 ? ditos[0] : `${ditos.slice(0, -1).join(', ')} e ${ditos[ditos.length - 1]}`
}

const DIAS_PLURAL = ['domingos', 'segundas', 'terças', 'quartas', 'quintas', 'sextas', 'sábados']

/**
 * Fora do dia da promoção: "Entrega grátis às sextas.", "Entrega grátis de sexta a domingo." (no dia, quem mostra é o
 * texto do canal, "Sextou…").
 */
export function entregaGratisNoDia(canal: Canal): string | null {
  const dias = canal.entregaGratis?.dias ?? []
  if (!dias.length) return null
  if (dias.length === 1) return `Entrega grátis ${dias[0] === 0 || dias[0] === 6 ? 'aos' : 'às'} ${DIAS_PLURAL[dias[0]]}.`
  return `Entrega grátis ${diasDaEntregaGratis(dias)}.`
}
