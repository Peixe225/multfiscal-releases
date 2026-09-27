import type { Achievement } from '@/engine/types'

/** Placeholder achievements catalogue (the real one ships with the achievements team). */
export const MOCK_ACHIEVEMENTS: Achievement[] = [
  { id: 'primeiro-titulo', title: 'Primeira taça', description: 'Conquiste o seu primeiro título como profissional.', icon: 'trophy', rarity: 'comum' },
  { id: 'acesso', title: 'Subiu!', description: 'Conquiste um acesso de divisão.', icon: 'arrow-up', rarity: 'comum' },
  { id: 'primeira-convocacao', title: 'Vestiu a amarelinha', description: 'Seja convocado para a seleção.', icon: 'flag', rarity: 'comum' },
  { id: 'heroi-da-final', title: 'Herói da final', description: 'Converta o pênalti decisivo de uma final.', icon: 'target', rarity: 'rara' },
  { id: 'centenario', title: 'Centenário', description: 'Marque 100 gols na carreira.', icon: 'goal', rarity: 'rara' },
  { id: 'lenda-90', title: 'Lenda', description: 'Alcance OVR 90.', icon: 'sparkles', rarity: 'epica' },
  { id: 'bola-de-ouro', title: 'Bola de Ouro', description: 'Vença a Bola de Ouro.', icon: 'award', rarity: 'epica' },
  { id: 'campeao-do-mundo', title: 'Campeão do Mundo', description: 'Vença a Copa do Mundo com a sua seleção.', icon: 'globe', rarity: 'lendaria' },
  { id: 'hat-trick-bola', title: 'Tricampeão', description: 'Vença três Bolas de Ouro.', icon: 'crown', rarity: 'lendaria', hidden: true },
  { id: 'fim-de-carreira', title: 'Pendurou as chuteiras', description: 'Termine uma carreira completa.', icon: 'flag', rarity: 'comum' },
  { id: 'rodado', title: 'Rodado', description: 'Jogue por 5 clubes diferentes.', icon: 'plane', rarity: 'rara' },
  { id: 'um-clube', title: 'Um clube só', description: 'Jogue a carreira inteira por um único clube.', icon: 'heart', rarity: 'lendaria', hidden: true },
]
