// Derivados do tabaco e cigarro eletrônico não entram no site (Anvisa, RDC 840/2023 e RDC 855/2024): tabaco, vape,
// tabaco aquecido e narguilé, com os nomes do dia a dia. A mesma lista e a mesma conferência do servidor
// (gc_termo_proibido em api/nucleo/validar.php; o scripts/testar-api-loja.mjs confere que as listas batem): o painel
// avisa enquanto o dono digita; quem recusa de verdade é o servidor.
const TERMOS = [
  'backwoods', 'charuto', 'cigarrilha', 'cigarro', 'cigarrete', 'tabaco', 'fumo', 'palheiro', 'swisher',
  'dutch master', 'black & mild', 'black and mild', 'al capone', 'djarum', 'essencia de narguile', 'vape',
  'cigarro eletronico', 'pod descartavel', 'juul', 'ignite', 'elfbar', 'elf bar',
  'narguile', 'arguile', 'hookah', 'nicotina', 'nicotine', 'nic salt', 'iqos', 'lost mary', 'geek bar',
]
/** Só como palavra inteira: 'rape' pegaria "grape", 'pod' pegaria "podium", 'essencia' pegaria "essencial". */
const PALAVRA_INTEIRA = ['rape', 'pod', 'pods', 'essencia', 'essencias', 'heets', 'terea', 'waka', 'oxbar', 'shisha', 'ecig', 'e cig']
/** Número (e símbolo) no lugar da letra (V4PE, P0D, C1GARRO): cada texto é conferido também com cada troca. */
const LEET: Record<string, string>[] = [
  { '4': 'a', '3': 'e', '0': 'o', '1': 'i', '@': 'a', $: 's' },
  { '4': 'a', '3': 'e', '0': 'o', '1': 'l', '@': 'a', $: 's' },
]

function semAcento(texto: string): string {
  const s = texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  return s.replace(/ß/g, 'ss').replace(/æ/g, 'ae').replace(/œ/g, 'oe').replace(/ø/g, 'o').replace(/ª/g, 'a').replace(/º/g, 'o')
}

function normalizar(s: string): string {
  s = s.replace(/&/g, ' & ').replace(/[^a-z0-9&]+/g, ' ')
  return ` ${s.replace(/\s+/g, ' ').trim()} `
}

function termoEm(forma: string): string | null {
  const s = normalizar(forma)
  const colado = s.replace(/ /g, '')
  for (const t of TERMOS) {
    if (s.includes(t)) return t
    if (t.includes(' ') && colado.includes(t.replace(/ /g, ''))) return t
  }
  for (const t of PALAVRA_INTEIRA) if (s.includes(` ${t} `)) return t
  return null
}

/** Primeiro termo proibido no texto, ou null. */
export function termoProibido(texto: string): string | null {
  if (!texto.trim()) return null
  const base = semAcento(texto)
  const formas = new Set([base, ...LEET.map((troca) => base.replace(/[4301@$]/g, (c) => troca[c] ?? c))])
  for (const f of formas) {
    const t = termoEm(f)
    if (t) return t
  }
  return null
}

/** O aviso, sem sermão: o que não entra e o que fazer. */
export const AVISO_PROIBIDO = 'Tabaco e vape não entram no site (regra da Anvisa pra venda online). Troca o nome ou escolhe outro produto.'
