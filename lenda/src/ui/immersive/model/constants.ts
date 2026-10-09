/**
 * Modo Imersivo — constantes compartilhadas pela UI e pelo motor de exemplo (mock):
 * rótulos de atributos, focos de treino, intensidades, modelos de post e tons da coletiva.
 */
import type { AttributeKey, CalendarKind, KeyMomentSituation, PressQuestion, TrainingFocus } from '@/engine/immersive/types'

export const OUTFIELD_KEYS = ['pace', 'shooting', 'passing', 'dribbling', 'defending', 'physical'] as const
export const GK_KEYS = ['diving', 'handling', 'reflexes', 'positioning', 'kicking'] as const

export const ATTR_LABEL: Record<AttributeKey, { label: string; short: string }> = {
  pace: { label: 'Velocidade', short: 'VEL' },
  shooting: { label: 'Finalização', short: 'FIN' },
  passing: { label: 'Passe', short: 'PAS' },
  dribbling: { label: 'Drible', short: 'DRI' },
  defending: { label: 'Defesa', short: 'DEF' },
  physical: { label: 'Físico', short: 'FIS' },
  diving: { label: 'Elasticidade', short: 'ELA' },
  handling: { label: 'Firmeza', short: 'FIR' },
  reflexes: { label: 'Reflexo', short: 'REF' },
  positioning: { label: 'Posicionamento', short: 'POS' },
  kicking: { label: 'Reposição', short: 'REP' },
}

export type Intensity = 'leve' | 'normal' | 'intensa'

export interface FocusMeta {
  label: string
  /** Chave do ícone (mapeada para lucide na UI). */
  icon: 'target' | 'send' | 'zap' | 'dumbbell' | 'shield' | 'hand' | 'brain' | 'bed' | 'heart'
  /** Atributos que o foco treina (linha). */
  attrs: AttributeKey[]
  /** Atributos do goleiro. */
  gkAttrs: AttributeKey[]
  desc: string
  /** Só goleiros / só jogadores de linha. */
  only?: 'gk' | 'outfield'
  /** Bônus fora dos atributos (texto curto para a prévia). */
  extra?: string
}

export const TRAINING_FOCUS: Record<TrainingFocus, FocusMeta> = {
  finishing: { label: 'Finalização', icon: 'target', attrs: ['shooting', 'dribbling'], gkAttrs: [], desc: 'Chutes, cabeceio e frieza na área.', only: 'outfield' },
  passing: { label: 'Passe', icon: 'send', attrs: ['passing', 'dribbling'], gkAttrs: ['kicking'], desc: 'Visão de jogo, lançamentos e enfiadas.' },
  dribbling: { label: 'Drible', icon: 'zap', attrs: ['dribbling', 'pace'], gkAttrs: [], desc: 'Condução, arranque e 1 contra 1.', only: 'outfield' },
  physical: { label: 'Físico', icon: 'dumbbell', attrs: ['physical', 'pace'], gkAttrs: ['diving'], desc: 'Força, explosão e resistência.' },
  defending: { label: 'Defesa', icon: 'shield', attrs: ['defending', 'physical'], gkAttrs: [], desc: 'Marcação, bote e antecipação.', only: 'outfield' },
  goalkeeping: { label: 'Goleiro', icon: 'hand', attrs: [], gkAttrs: ['reflexes', 'handling', 'positioning'], desc: 'Reflexo, encaixe e saídas do gol.', only: 'gk' },
  tactical: { label: 'Tático', icon: 'brain', attrs: ['passing', 'defending'], gkAttrs: ['positioning'], desc: 'Posicionamento e entrosamento.', extra: 'Técnico +' },
  rest: { label: 'Descanso', icon: 'bed', attrs: [], gkAttrs: [], desc: 'Folga para recarregar corpo e cabeça.', extra: 'Moral +' },
  recovery: { label: 'Recuperação', icon: 'heart', attrs: [], gkAttrs: [], desc: 'Fisioterapia, gelo e sono regrado.', extra: 'Energia ++' },
}

export const FOCUS_ORDER: TrainingFocus[] = ['finishing', 'passing', 'dribbling', 'physical', 'defending', 'goalkeeping', 'tactical', 'recovery', 'rest']

export const INTENSITY: Record<Intensity, { label: string; gain: number; fitness: number; injury: number; sharp: number }> = {
  leve: { label: 'Leve', gain: 0.55, fitness: -3, injury: 0, sharp: 2 },
  normal: { label: 'Normal', gain: 1, fitness: -8, injury: 0.01, sharp: 4 },
  intensa: { label: 'Intensa', gain: 1.55, fitness: -15, injury: 0.045, sharp: 6 },
}

/** Recuperação física (energia) por foco sem carga. */
export const RECOVERY_GAIN: Partial<Record<TrainingFocus, number>> = { rest: 22, recovery: 30 }

// ───────────────────────── rede social ─────────────────────────

export type PostContext = 'any' | 'win' | 'loss' | 'draw' | 'goal'

export interface PostTemplate {
  id: string
  label: string
  /** Texto final (o motor pode trocar {club}/{rival}/{n}). */
  text: string
  tone: 'positive' | 'negative' | 'neutral'
  when: PostContext[]
  /** Efeito esperado (dica na UI). */
  hint: string
}

export const POST_TEMPLATES: PostTemplate[] = [
  { id: 'obrigado_torcida', label: '“Obrigado, torcida!”', text: 'Obrigado, torcida! Vocês empurraram a gente do começo ao fim. Juntos! 💚', tone: 'positive', when: ['win', 'goal', 'any'], hint: 'Torcida +' },
  { id: 'foto_gol', label: 'Foto do gol', text: 'Esse vai pro quadro. Primeiro de muitos? ⚽🔥 #{club}', tone: 'positive', when: ['goal'], hint: 'Seguidores ++' },
  { id: 'provocar_rival', label: 'Provocar o rival', text: 'Tem gente que fala demais durante a semana… no campo a conversa é outra. 🤫', tone: 'negative', when: ['win', 'goal'], hint: 'Torcida ++ · Imprensa −' },
  { id: 'foco_treino', label: 'Foco no treino', text: 'Cabeça no próximo jogo. Treino, descanso e trabalho. 💪', tone: 'neutral', when: ['any', 'draw', 'loss'], hint: 'Técnico +' },
  { id: 'pedir_desculpas', label: 'Pedir desculpas', text: 'Hoje não deu. Assumo minha parte e a gente volta mais forte. Desculpa, torcida.', tone: 'neutral', when: ['loss'], hint: 'Torcida + · Moral −' },
  { id: 'mirar_titulo', label: 'Mirar o título', text: 'Ninguém aqui veio para ser coadjuvante. O objetivo é um só: taça. 🏆', tone: 'positive', when: ['win', 'any'], hint: 'Imprensa + · Pressão ▲' },
  { id: 'familia', label: 'Post com a família', text: 'Tudo por eles. Obrigado por estarem sempre comigo. ❤️', tone: 'positive', when: ['any'], hint: 'Moral +' },
  { id: 'silencio', label: 'Ficar em silêncio', text: '', tone: 'neutral', when: ['any', 'loss', 'draw', 'win', 'goal'], hint: 'Sem efeito' },
]

// ───────────────────────── coletiva ─────────────────────────

export type Tone = PressQuestion['answers'][number]['tone']
export const TONE_LABEL: Record<Tone, string> = { humilde: 'Humilde', confiante: 'Confiante', provocador: 'Provocador', evasivo: 'Evasivo' }
/** Classe de cor do tema (.lx-tone[data-tone]). */
export const TONE_CSS: Record<Tone, string> = { humilde: 'humilde', confiante: 'confiante', provocador: 'polemico', evasivo: 'evasivo' }

// ───────────────────────── calendário ─────────────────────────

export const KIND_LABEL: Record<CalendarKind, string> = {
  training: 'Treino',
  match: 'Jogo',
  national_match: 'Seleção',
  press: 'Coletiva',
  story: 'Evento',
  transfer_window: 'Janela',
  national_callup: 'Convocação',
  season_end: 'Fim de temporada',
  awards: 'Premiação',
}

export const SITUATION_LABEL: Record<KeyMomentSituation, string> = {
  shot: 'Finalização',
  one_on_one: 'Cara a cara',
  dribble: 'Drible',
  pass: 'Passe',
  through_ball: 'Enfiada',
  cross: 'Cruzamento',
  header: 'Cabeceio',
  free_kick: 'Falta',
  penalty: 'Pênalti',
  tackle: 'Desarme',
  interception: 'Interceptação',
  block: 'Bloqueio',
  save: 'Defesa',
  penalty_save: 'Pênalti contra',
}

/** Veículos de mídia FICTÍCIOS (nunca marcas reais). */
export const OUTLETS = ['LENDA TV', 'Rádio Arquibancada', 'Diário da Bola', 'Portal Camisa 10', 'Jornal do Gramado', 'Canal Resenha'] as const
export const OUTLET_SHORT: Record<string, string> = {
  'LENDA TV': 'LTV',
  'Rádio Arquibancada': 'ARQ',
  'Diário da Bola': 'DB',
  'Portal Camisa 10': 'C10',
  'Jornal do Gramado': 'JG',
  'Canal Resenha': 'RES',
}

/** Itens de estilo de vida (ação `buy`). */
export const LIFESTYLE_ITEMS = [
  { id: 'relogio', name: 'Relógio de grife', price: 25_000, morale: 2 },
  { id: 'viagem', name: 'Viagem nas férias', price: 60_000, morale: 5 },
  { id: 'carro', name: 'Carro esportivo', price: 140_000, morale: 4 },
  { id: 'casa-pais', name: 'Casa para os pais', price: 450_000, morale: 9 },
] as const

/** Arte SVG de um prêmio individual (ids do motor com "_" → arquivos com "-"; genérica se faltar). */
const PRIZE_SVGS = new Set(['ballon-dor', 'golden-boot', 'golden-glove', 'kopa', 'league-best-player', 'league-top-scorer', 'puskas', 'team-of-the-year', 'the-best', 'wc-golden-ball', 'wc-golden-boot'])
export const prizeArt = (award: string) => {
  const id = award.replace(/_/g, '-')
  return PRIZE_SVGS.has(id) ? id : 'award-generic'
}
