// Raridade dos prêmios do Teste minha sorte (pedido do Ian em 11/10): todo prêmio tem uma raridade, a raridade tem uma
// cor e uma chance, e a animação da fumaça cresce com ela (quanto mais raro, mais viajada). Este arquivo é o contrato
// entre o servidor (sorte.php, loja.php), o painel (Teste minha sorte) e o site (a revelação e o story do prêmio):
// os ids, as cores e as chances de fábrica moram só aqui (o PHP repete os ids e as chances, em sorte.php).
//
// A lógica do sorteio: primeiro a raridade, pela chance dela entre as raridades que têm algum prêmio valendo no
// estado (a chance das que estão vazias se reparte entre as outras, na proporção); depois o prêmio, pelo peso dele
// dentro da raridade. A chance só aparece no painel; no site, só a raridade (nome e cor).
//
// Cores: nada de verde (é só do anel dos Melhores amigos, DECISOES 13) e nada de paleta rasta.

export type Raridade = 'comum' | 'raro' | 'epico' | 'lendario'

/** Da mais comum pra mais rara. */
export const RARIDADES: readonly Raridade[] = ['comum', 'raro', 'epico', 'lendario']

export interface InfoRaridade {
  /** Como aparece na tela ("Lendário"). */
  nome: string
  /** O carimbo em pixel no prêmio ("LENDÁRIO"). */
  carimbo: string
  /** Cor principal (selo, brilho do prêmio, aro). */
  cor: string
  /** Tom claro (reflexo, texto em fundo escuro). */
  clara: string
  /** Tom escuro (contorno, sombra). */
  escura: string
  /** Chance de fábrica, em % (as 4 somam 100). */
  chance: number
}

export const INFO_RARIDADE: Record<Raridade, InfoRaridade> = {
  comum: { nome: 'Comum', carimbo: 'COMUM', cor: '#b8c4cc', clara: '#e8eef2', escura: '#55626b', chance: 60 },
  raro: { nome: 'Raro', carimbo: 'RARO', cor: '#35a7ff', clara: '#b4e0ff', escura: '#0b4f8a', chance: 25 },
  epico: { nome: 'Épico', carimbo: 'ÉPICO', cor: '#ff3fa4', clara: '#ffbfe0', escura: '#8a0f52', chance: 12 },
  lendario: { nome: 'Lendário', carimbo: 'LENDÁRIO', cor: '#ffc53d', clara: '#fff1b8', escura: '#9a6a00', chance: 3 },
}

/** As chances de fábrica (% por raridade). */
export const CHANCES_PADRAO: Readonly<Record<Raridade, number>> = {
  comum: INFO_RARIDADE.comum.chance,
  raro: INFO_RARIDADE.raro.chance,
  epico: INFO_RARIDADE.epico.chance,
  lendario: INFO_RARIDADE.lendario.chance,
}

export function ehRaridade(v: unknown): v is Raridade {
  return typeof v === 'string' && (RARIDADES as readonly string[]).includes(v)
}

/** A raridade do prêmio; prêmio sem raridade (os de antes de 11/10) é comum. */
export function raridadeDe(p: { raridade?: unknown } | null | undefined): Raridade {
  return p && ehRaridade(p.raridade) ? p.raridade : 'comum'
}

/** 0 (comum) a 3 (lendário): a escala da animação. */
export function nivelRaridade(r: Raridade): number {
  return RARIDADES.indexOf(r)
}
