/**
 * @ e hashtags da rede social: o mesmo slug do motor (os seus posts saem como @gabigoljunior10),
 * hashtag em CamelCase sem acento nem espaço (#GabigolJunior10) e torcedor sem "Seu/Dona/Tia" no @.
 */
import type { ImmersiveState } from '@/engine/immersive/types'
import { slug } from '@/engine/immersive/util'

/** Hashtag em CamelCase: "Gabigol Júnior" → "GabigolJunior"; siglas ficam ("Athletico-PR" → "AthleticoPR"). */
export const hashTag = (x: string) =>
  x
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => (w.length <= 3 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join('')

/** O seu @ é o mesmo dos seus posts (o motor usa o número da inscrição, não o da camisa atual). */
export const userHandle = (s: Pick<ImmersiveState, 'identity'>) => `@${slug(s.identity.surname)}${s.identity.number}`

/** @ de torcedor fictício: vem do nome, não do tratamento ("Dona Cida" → @cida_…). */
export const fanHandle = (name: string, tail: string) => `@${slug(name.replace(/^(Seu|Dona|Tia|Tio)\s+/, '').split(' ')[0])}_${tail}`

export { slug }
