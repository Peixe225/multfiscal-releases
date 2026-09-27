/**
 * Achievement catalogue registry. The achievements team calls registerAchievementCatalog(list)
 * (e.g. from their module) and the shell (top-bar counter, toasts) reads it from here.
 */
import { create } from 'zustand'
import type { Achievement } from '@/engine/types'
import { MOCK_ACHIEVEMENTS } from '@/ui/classic/mock/mockAchievements'

export const useAchievementCatalog = create<{ list: Achievement[] }>()(() => ({ list: MOCK_ACHIEVEMENTS }))

export function registerAchievementCatalog(list: Achievement[]) {
  if (Array.isArray(list) && list.length) useAchievementCatalog.setState({ list })
}

export const achievementById = (id: string) => useAchievementCatalog.getState().list.find((a) => a.id === id)
