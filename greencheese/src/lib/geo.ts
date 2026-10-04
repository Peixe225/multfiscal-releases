import { ufPorSigla, ufPorTexto } from '../dados/ufs'
import { buscarJson } from './rede'

export interface Palpite {
  uf: string // sigla minúscula
  fonte: 'ipwho.is' | 'geojs'
}

interface IpWho {
  success?: boolean
  country_code?: string
  region?: string
  region_code?: string
}

interface GeoJs {
  country_code?: string
  region?: string
}

async function porIpWho(ms: number): Promise<Palpite | null | 'fora'> {
  const j = await buscarJson<IpWho>('https://ipwho.is/?fields=success,country_code,region,region_code&lang=pt-BR', ms)
  if (j.success === false) throw new Error('ipwho')
  if (j.country_code && j.country_code !== 'BR') return 'fora'
  const uf = ufPorSigla(j.region_code) ?? ufPorTexto(j.region)
  if (!uf) throw new Error('ipwho-sem-uf')
  return { uf: uf.sigla.toLowerCase(), fonte: 'ipwho.is' }
}

async function porGeoJs(ms: number): Promise<Palpite | null | 'fora'> {
  const j = await buscarJson<GeoJs>('https://get.geojs.io/v1/ip/geo.json', ms)
  if (j.country_code && j.country_code !== 'BR') return 'fora'
  const uf = ufPorTexto(j.region)
  if (!uf) throw new Error('geojs-sem-uf')
  return { uf: uf.sigla.toLowerCase(), fonte: 'geojs' }
}

/**
 * Palpite de estado pelo IP, sem pedir GPS. ipwho.is (region_code) é o principal e geojs (region = nome do estado)
 * a reserva. Os dois saem juntos para caber no orçamento de `ms` no total: vale o ipwho.is; se ele falhar, o geojs.
 * Fora do Brasil ou sem resposta: null (a pessoa escolhe).
 * Palpite de IP erra (principalmente em rede móvel): quem chama SEMPRE pede confirmação.
 */
export async function palpitePorIp(ms: number): Promise<Palpite | null> {
  const reserva = porGeoJs(ms).catch(() => null)
  try {
    const r = await porIpWho(ms)
    return r === 'fora' ? null : r
  } catch {
    const r = await reserva
    return r === 'fora' ? null : r
  }
}
