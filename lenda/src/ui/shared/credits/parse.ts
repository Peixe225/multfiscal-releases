/**
 * Lê as tabelas de docs/CREDITOS.md (fonte única dos créditos) para a tela #/creditos.
 *
 *   §1 Troféus:  | `arquivo` | [foto](url) | autor | [licença](url) ou texto | notas |
 *   §2 Eventos:  | `arquivo` | autor | id do Unsplash | o que a foto mostra |
 */

export interface TrophyPhotoCredit {
  /** "world-cup.webp" (em public/trophies/). */
  file: string
  /** Título do arquivo no Wikimedia Commons. */
  title: string
  url?: string
  author: string
  license: string
  licenseUrl?: string
  notes?: string
}

export interface EventPhotoCredit {
  /** "injury-1.webp" (em public/photos/). */
  file: string
  author: string
  unsplashId: string
  /** O que a foto mostra. */
  shows?: string
}

export interface ParsedCredits {
  trophies: TrophyPhotoCredit[]
  photos: EventPhotoCredit[]
}

const LINK = /^\[(.+?)\]\((.+)\)$/

function link(cell: string): { text: string; url?: string } {
  const m = LINK.exec(cell.trim())
  return m ? { text: m[1].trim(), url: m[2].trim() } : { text: cell.trim() }
}

const plain = (s: string) => s.replace(/`/g, '').replace(/\*\*/g, '').trim()

/** Linhas de dados das tabelas de uma seção (ignora cabeçalho e separador). */
function rows(section: string): string[][] {
  const out: string[][] = []
  for (const line of section.split('\n')) {
    const t = line.trim()
    if (!t.startsWith('| `')) continue
    const cells = t.slice(1, t.endsWith('|') ? -1 : undefined).split(' | ').map((c) => c.trim())
    out.push(cells)
  }
  return out
}

/** Seção "## n. …" do markdown. */
function section(md: string, n: number): string {
  const parts = md.split(/\n## /)
  return parts.find((p) => p.startsWith(`${n}.`)) ?? ''
}

export function parseCredits(md: string): ParsedCredits {
  const text = md.replace(/\r\n/g, '\n')
  const trophies: TrophyPhotoCredit[] = rows(section(text, 1)).flatMap((c) => {
    if (c.length < 4) return []
    const photo = link(c[1])
    const lic = link(c[3])
    return [{ file: plain(c[0]), title: photo.text, url: photo.url, author: plain(c[2]), license: plain(lic.text), licenseUrl: lic.url, notes: plain(c[4] ?? '') || undefined }]
  })
  const photos: EventPhotoCredit[] = rows(section(text, 2)).flatMap((c) => (c.length < 3 ? [] : [{ file: plain(c[0]), author: plain(c[1]), unsplashId: plain(c[2]), shows: plain(c[3] ?? '') || undefined }]))
  return { trophies, photos }
}
