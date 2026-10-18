/** Datas do site em pt-BR, no fuso de Brasília ("14/10/2026", "14/10/2026 09:30"). Sem data válida: "—". */
const DIA = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' })
const DIA_HORA = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })

export function dataBr(iso: string | null | undefined, comHora = false): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : (comHora ? DIA_HORA : DIA).format(d)
}
