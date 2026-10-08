// Minhas vagas: o status de cada vaga guardada neste aparelho, perguntado ao servidor (baixa com a aba Rateio).
import { buscarMinhasVagas } from './rateio-vagas'
import { useRateio } from '../store/rateio'

let buscandoVagas: Promise<void> | null = null

/** GET minhas-vagas: atualiza o status de cada vaga guardada (sem servidor, fica o que já estava). */
export function atualizarMinhasVagas(): Promise<void> {
  if (buscandoVagas) return buscandoVagas
  const tokens = useRateio.getState().vagas.map((v) => v.token).filter(Boolean)
  if (!tokens.length) return Promise.resolve()
  buscandoVagas = (async () => {
    const r = await buscarMinhasVagas(tokens)
    if (!r.ok) return
    useRateio.setState((s) => ({
      vagas: s.vagas.map((v) => {
        const p = r.participacoes.find((x) => (x.token ? x.token === v.token : x.codigo === v.codigo))
        // o token é do aparelho: nunca troca pelo que veio (pode vir vazio)
        return p ? { ...v, ...p, token: v.token } : v
      }),
    }))
  })().finally(() => {
    buscandoVagas = null
  })
  return buscandoVagas
}

