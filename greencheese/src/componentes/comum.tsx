import type { CSSProperties, ReactNode } from 'react'
import { config } from '../dados/config'
import { Logo } from '../arte/Logo'
import { PixelArte } from '../arte/PixelArte'
import { icones } from '../arte/pixel/grades'
import { iconesExtras } from '../arte/pixel/extras'

export function Icone({ nome, tamanho = 24, titulo, className, style }: { nome: string; tamanho?: number; titulo?: string; className?: string; style?: CSSProperties }) {
  const g = icones[nome] ?? iconesExtras[nome]
  if (!g) return null
  return <PixelArte grade={g} tamanho={tamanho} titulo={titulo} className={className} style={style} />
}

/** Avatar do perfil: o logo no círculo preto, com o anel do Instagram (branco, folga preta; `cor` troca o do anel). */
export function Avatar({ tamanho = 32, anel = true, cor = 'var(--branco)', className }: { tamanho?: number; anel?: boolean; cor?: string; className?: string }) {
  const folga = tamanho >= 64 ? 4 : 2
  const traco = tamanho >= 64 ? 2 : 1.5
  return (
    <span
      className={`avatar ${className ?? ''}`}
      style={{
        width: tamanho,
        height: tamanho,
        padding: anel ? folga + traco : 0,
        boxShadow: anel ? `inset 0 0 0 ${traco}px ${cor}` : undefined,
      }}
      aria-hidden="true"
    >
      <Logo tamanho={Math.max(8, tamanho - 2 * (anel ? folga + traco : 0))} />
    </span>
  )
}

/** Marca "demo" ao lado de um valor de demonstração — só aparece na prévia. */
export function Demo({ ativo }: { ativo: boolean }) {
  if (!ativo || !config.carimboDeExemplo) return null
  return (
    <span className="carimbo" title="Valor de demonstração: trocar pelo dado real em src/dados">
      demo
    </span>
  )
}

/** "agora", "12 min", "2 h", "3 d", "1 sem" — como o Instagram mostra. */
export function tempoRelativo(iso: string, agora = Date.now()): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return 'agora'
  const s = Math.max(0, (agora - t) / 1000)
  if (s < 60) return 'agora'
  if (s < 3600) return `${Math.floor(s / 60)} min`
  if (s < 86400) return `${Math.floor(s / 3600)} h`
  if (s < 604800) return `${Math.floor(s / 86400)} d`
  return `${Math.floor(s / 604800)} sem`
}

/**
 * Há quanto tempo o catálogo foi "postado". Sem data real, não mostra nada (não finge recência). Story vive 24 h: com
 * mais de um dia o rótulo some, em vez de "4 d" ou "1 sem" (cara de loja parada).
 */
export function tempoDoCatalogo(agora = Date.now()): string | null {
  const t = config.catalogoAtualizadoEm ? Date.parse(config.catalogoAtualizadoEm) : NaN
  if (!Number.isFinite(t) || agora - t >= 86400000) return null
  return tempoRelativo(config.catalogoAtualizadoEm!, agora)
}

/** Linha de cabeçalho do story: avatar, @, tempo. */
export function CabecalhoStory({ instagram, rotulo, extra }: { instagram: string | null; rotulo?: string; extra?: ReactNode }) {
  return (
    <div className="cab-story">
      <Avatar tamanho={32} />
      <span className="cab-story-nome">{rotulo ?? instagram ?? 'Green Cheese Imports'}</span>
      {tempoDoCatalogo() && <span className="cab-story-tempo">{tempoDoCatalogo()}</span>}
      {extra}
    </div>
  )
}

/** Inclinação fixa por id (entre -4° e 4°), como adesivo colado à mão. */
export function inclinacao(id: string, max = 4): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return ((Math.abs(h) % (max * 20 + 1)) / 10 - max) || -1.5
}
