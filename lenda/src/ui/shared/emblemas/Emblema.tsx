/**
 * O emblema de um desafio (v3.4, CONTRATO-v34): uma moeda redonda com o ícone e a cor que o servidor manda
 * (`emblema: {icone, cor}`; os ícones são os das conquistas, src/ui/shared/achievements/meta.ts). Usado no Hall da
 * comunidade (ao lado do apelido, pequeno), no perfil público, na Minha conta, em #/desafios e na faixa da tela inicial.
 */
import type { CSSProperties } from 'react'
import { achievementIcon } from '@/ui/shared/achievements/meta'
import './emblema.css'

export interface EmblemaVisual {
  slug: string
  icone: string
  cor: string
  titulo?: string
}

/** Cor do servidor no formato #rrggbb; fora disso, o bronze das conquistas. */
export const corDoEmblema = (c: unknown) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : '#b98652')
/** Ícone do servidor no formato do mapa das conquistas ("circle-dot"…); fora disso, a medalha. */
export const iconeDoEmblema = (i: unknown) => (typeof i === 'string' && /^[a-z0-9-]{1,32}$/.test(i) ? i : 'medal')

/** `size` em px (o círculo inteiro). `rotulo`: o nome vai para leitores de tela e para o title (null = decorativo). */
export function Emblema({ e, size = 20, rotulo, className, style }: { e: Pick<EmblemaVisual, 'icone' | 'cor'> & { titulo?: string }; size?: number; rotulo?: string | null; className?: string; style?: CSSProperties }) {
  const Ico = achievementIcon({ icon: iconeDoEmblema(e.icone) })
  const cor = corDoEmblema(e.cor)
  const nome = rotulo === null ? undefined : (rotulo ?? (e.titulo ? `Emblema: ${e.titulo}` : 'Emblema'))
  return (
    <span
      className={['lx-emblema', className].filter(Boolean).join(' ')}
      style={{ width: size, height: size, ['--emb' as string]: cor, ...style }}
      role={nome ? 'img' : undefined}
      aria-label={nome}
      aria-hidden={nome ? undefined : true}
      title={nome}
    >
      <Ico size={Math.max(9, Math.round(size * 0.52))} strokeWidth={2.3} aria-hidden="true" />
    </span>
  )
}

/** Os emblemas de alguém em fila (no Hall: até 3 e "+N"). */
export function FilaEmblemas({ lista, total, size = 16, max = 3 }: { lista: readonly EmblemaVisual[]; total?: number; size?: number; max?: number }) {
  if (!lista.length) return null
  const mostra = lista.slice(0, max)
  const resto = Math.max(0, (total ?? lista.length) - mostra.length)
  return (
    <span className="lx-emblemas" aria-label={`${total ?? lista.length} ${(total ?? lista.length) === 1 ? 'emblema' : 'emblemas'} de desafios`}>
      {mostra.map((e) => (
        <Emblema key={e.slug} e={e} size={size} rotulo={e.titulo ? `Emblema: ${e.titulo}` : 'Emblema de desafio'} />
      ))}
      {resto > 0 && <span className="lx-emblemas__mais">+{resto}</span>}
    </span>
  )
}
