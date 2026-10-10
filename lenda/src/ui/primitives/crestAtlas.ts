/**
 * Crest atlas bookkeeping: public/crests/<atlas> is a grid of `cell`px squares, `cols` columns.
 * Each atlas is probed once (Image()) so <Crest> can show the fallback badge when the file is
 * missing or still loading — no broken backgrounds.
 */
import { useSyncExternalStore } from 'react'
import type { CrestRef } from '@/engine/types'

/**
 * Pasta dos atlas. No site público (scripts/build-site.mjs) ela leva a versão no caminho — crests/<hash>/,
 * hash do conteúdo de todos os atlas, passado em VITE_CRESTS_V: o nome do arquivo (bra.1.webp) é fixo, mas a
 * ordem dos escudos dentro dele segue a tabela do dia em que os dados foram gerados, e o índice de cada clube
 * mora no JS (que tem hash). Com a pasta versionada, um atlas velho guardado no navegador ou no CDN nunca
 * é desenhado com os índices novos (escudo trocado, sem erro nenhum). Nos outros builds: crests/, como sempre.
 * O crestStyle de src/data/index.ts monta o mesmo caminho.
 */
const CRESTS_DIR = import.meta.env.VITE_CRESTS_V ? `crests/${import.meta.env.VITE_CRESTS_V}/` : 'crests/'

export const crestConfig = { cols: 8, cell: 128, base: `${import.meta.env.BASE_URL ?? './'}${CRESTS_DIR}` }

export function configureCrests(c: { cols?: number; cell?: number; base?: string }) {
  if (c.cols) crestConfig.cols = c.cols
  if (c.cell) crestConfig.cell = c.cell
  if (c.base) crestConfig.base = c.base
}

type Status = 'loading' | 'ok' | 'error'
interface AtlasInfo {
  status: Status
  w: number
  h: number
}
const atlases = new Map<string, AtlasInfo>()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function atlasUrl(atlas: string): string {
  return /^(https?:|data:|\/)/.test(atlas) ? atlas : crestConfig.base + atlas
}

function probe(atlas: string): AtlasInfo {
  let info = atlases.get(atlas)
  if (info) return info
  info = { status: 'loading', w: 0, h: 0 }
  atlases.set(atlas, info)
  if (typeof Image === 'undefined') return info
  const img = new Image()
  img.decoding = 'async'
  img.onload = () => {
    atlases.set(atlas, { status: 'ok', w: img.naturalWidth, h: img.naturalHeight })
    emit()
  }
  img.onerror = () => {
    atlases.set(atlas, { status: 'error', w: 0, h: 0 })
    emit()
  }
  img.src = atlasUrl(atlas)
  return info
}

export function useAtlas(atlas: string | undefined): AtlasInfo | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => (atlas ? probe(atlas) : null),
    () => null,
  )
}

/** CSS for one crest cell rendered at `size` px (background sprite). */
export function crestSpriteStyle(ref: CrestRef, size: number, info?: AtlasInfo | null): React.CSSProperties {
  const { cols, cell } = crestConfig
  const scale = size / cell
  const col = ref.index % cols
  const row = Math.floor(ref.index / cols)
  // use the real atlas width when known (atlases may have fewer columns on the last row only)
  const atlasW = info && info.w ? info.w : cols * cell
  const atlasH = info && info.h ? info.h : (row + 1) * cell
  return {
    width: size,
    height: size,
    backgroundImage: `url("${atlasUrl(ref.atlas)}")`,
    backgroundSize: `${atlasW * scale}px ${atlasH * scale}px`,
    backgroundPosition: `${-col * size}px ${-row * size}px`,
  }
}
