/**
 * Shell slots — screens customise the persistent top bar and ambient stage without owning them.
 *
 *   useShellSlots({ sub: 'NOVA CARREIRA', center: <Steps/>, actions: <IconButton …/>, stage: { preset: 'duo', colors } })
 *
 * Values are applied while the calling screen is mounted and reset on unmount.
 * `topbar: false` hides the bar (immersive celebrations, full-bleed screens).
 */
import { useEffect, type ReactNode } from 'react'
import { create } from 'zustand'
import type { ClubColors, ClubLike } from '@/ui/theme/club'
import type { StagePreset } from '@/ui/primitives/Stage'

export interface ShellSlots {
  /** Brand sub-label (CLÁSSICO, NOVA CARREIRA…). */
  sub?: string
  /** Middle area (session pill, steps, nav). */
  center?: ReactNode
  /** Right cluster; replaces the default buttons when set. */
  actions?: ReactNode
  /** Extra buttons prepended to the default right cluster. */
  extraActions?: ReactNode
  /** Hide the top bar. */
  topbar?: boolean
  /** 60 (default) · 72 landing · 62 identity */
  height?: 60 | 62 | 72
  stage?: { preset?: StagePreset; club?: ClubLike; colors?: ClubColors; hidden?: boolean }
}

interface SlotStore {
  slots: ShellSlots
  owner: symbol | null
  set(owner: symbol, s: ShellSlots): void
  clear(owner: symbol): void
}

export const useSlotStore = create<SlotStore>()((set, get) => ({
  slots: {},
  owner: null,
  set: (owner, slots) => set({ owner, slots }),
  clear: (owner) => {
    if (get().owner === owner) set({ owner: null, slots: {} })
  },
}))

export function useShellSlots(slots: ShellSlots, deps: unknown[] = []) {
  useEffect(() => {
    const owner = Symbol('slots')
    useSlotStore.getState().set(owner, slots)
    return () => useSlotStore.getState().clear(owner)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
