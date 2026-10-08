// Minhas vagas: o status de cada vaga guardada neste aparelho, perguntado ao servidor (baixa com a aba Rateio). Vão
// junto os tokens das entradas sem resposta (o POST que demorou): se o servidor gravou, a vaga aparece.
import type { Participacao } from './rateio-api'
import { buscarMinhasVagas } from './rateio-vagas'
import { apararVagas, marcarServidorVisto, useRateio, type EntradaPendente, type VagaGuardada } from '../store/rateio'

let buscandoVagas: Promise<void> | null = null

/** A participação que o servidor devolveu + o que a pessoa preencheu na entrada pendente. */
function vagaDaPendente(p: Participacao, e: EntradaPendente): VagaGuardada {
  return { ...p, titulo: p.titulo || e.titulo, token: e.token, nome: e.nome, whatsapp: e.whatsapp, uf: e.uf, cidade: e.cidade, precoRateio: e.precoRateio }
}

/** Junta o que veio do servidor nas vagas guardadas e transforma as pendentes achadas em vagas. */
function juntar(participacoes: Participacao[]) {
  useRateio.setState((s) => {
    const vagas = s.vagas.map((v) => {
      const p = participacoes.find((x) => (x.token ? x.token === v.token : x.codigo === v.codigo))
      // o token é do aparelho: nunca troca pelo que veio (pode vir vazio)
      return p ? { ...v, ...p, token: v.token } : v
    })
    const achadas: VagaGuardada[] = []
    const pendentes = s.pendentes.filter((e) => {
      const p = participacoes.find((x) => x.token === e.token)
      if (!p) return true
      if (!vagas.some((v) => v.codigo === p.codigo)) achadas.push(vagaDaPendente(p, e))
      return false
    })
    return { vagas: achadas.length ? apararVagas([...achadas, ...vagas]) : vagas, pendentes, servidorVisto: true }
  })
}

/** GET minhas-vagas: atualiza o status de cada vaga guardada (sem servidor, fica o que já estava). */
export function atualizarMinhasVagas(): Promise<void> {
  if (buscandoVagas) return buscandoVagas
  const s = useRateio.getState()
  // até 20 por pedido (o limite da API): as pendentes primeiro (são poucas e só servem se forem perguntadas)
  const tokens = [...s.pendentes.map((p) => p.token), ...s.vagas.map((v) => v.token)].filter(Boolean)
  if (!tokens.length) return Promise.resolve()
  buscandoVagas = (async () => {
    const r = await buscarMinhasVagas(tokens)
    if (!r.ok) {
      if (r.erro !== 'sem-servidor' && r.erro !== 'fora-do-ar') marcarServidorVisto()
      return
    }
    juntar(r.participacoes)
  })().finally(() => {
    buscandoVagas = null
  })
  return buscandoVagas
}

/**
 * A entrada pendente virou vaga? Pergunta ao servidor só pelo token dela (a resposta do POST se perdeu, ou o servidor
 * disse ja-participa). Achou: guarda a vaga e devolve; senão, null.
 */
export async function recuperarPendente(e: EntradaPendente): Promise<VagaGuardada | null> {
  const r = await buscarMinhasVagas([e.token])
  if (!r.ok) return null
  const p = r.participacoes.find((x) => x.token === e.token)
  if (!p) return null
  juntar([p])
  return useRateio.getState().vagas.find((v) => v.codigo === p.codigo) ?? vagaDaPendente(p, e)
}
