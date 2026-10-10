import { soDigitos } from './formato'
import { buscarJson } from './rede'

export interface Endereco {
  cep: string
  uf: string // sigla minúscula
  cidade: string
  bairro: string
  rua: string
}

interface BrasilApi {
  cep: string
  state: string
  city: string
  neighborhood?: string
  street?: string
}

interface ViaCep {
  erro?: boolean | string
  cep?: string
  uf?: string
  localidade?: string
  bairro?: string
  logradouro?: string
}

/** BrasilAPI e, se falhar, ViaCEP. null = CEP não encontrado. Lança erro só se os dois serviços estiverem fora. */
export async function buscarCep(cepBruto: string): Promise<Endereco | null> {
  const cep = soDigitos(cepBruto)
  if (cep.length !== 8) return null
  let algumRespondeu = false
  try {
    const j = await buscarJson<BrasilApi>(`https://brasilapi.com.br/api/cep/v2/${cep}`, 4000)
    algumRespondeu = true
    if (j.state && j.city) {
      return { cep, uf: j.state.toLowerCase(), cidade: j.city, bairro: j.neighborhood ?? '', rua: j.street ?? '' }
    }
  } catch (e) {
    // 404 da BrasilAPI = CEP não existe; ainda assim confere no ViaCEP
    if (e instanceof Error && e.message.includes('404')) algumRespondeu = true
  }
  try {
    const j = await buscarJson<ViaCep>(`https://viacep.com.br/ws/${cep}/json/`, 4000)
    algumRespondeu = true
    if (!j.erro && j.uf && j.localidade) {
      return { cep, uf: j.uf.toLowerCase(), cidade: j.localidade, bairro: j.bairro ?? '', rua: j.logradouro ?? '' }
    }
  } catch {
    /* fora do ar */
  }
  if (!algumRespondeu) throw new Error('cep-indisponivel')
  return null
}
