/**
 * "Abrir no jogo" do painel (X4, CONTRATO-v32 §A.7): #/resumo?id=<carreiras.id>&de=admin lê
 * GET admin.php?r=carreira&id=<pk> (ou &carreiraId=<HallEntry.id>), que só responde com a sessão do painel. O jogo só
 * pede isso depois de o painel.php?so=eu dizer que este navegador é do admin; para o público a rota continua a de sempre.
 *
 *   iniciarResumoAdmin()   // uma vez (vigias): registra o abrir no store
 */
import { useResumoAdmin, type CarreiraAdmin, type MetaAdmin, type SinalAdmin } from '@/store/resumoAdmin'
import { api, ErroApi } from './api'
import { hallEntryValido } from './carreiras'

/** Carreiras abertas guardadas na memória (cada uma pesa dezenas de KB). */
const ABERTAS_MAX = 6

const int = (v: unknown, padrao = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : padrao)
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '')

/** O `meta` da resposta, conferido campo a campo (o que vier estranho fica no neutro). */
export function normalizarMetaAdmin(x: unknown): MetaAdmin | null {
  const m = x as Record<string, unknown> | null
  if (!m || typeof m !== 'object') return null
  const u = (m.usuario ?? {}) as Record<string, unknown>
  const mod = m.moderacao as { em?: unknown; motivo?: unknown } | null | undefined
  const oculta = int(m.oculta)
  const sinais = (Array.isArray(m.sinais) ? m.sinais : [])
    .map((s): SinalAdmin | null => {
      const o = s as Record<string, unknown> | null
      if (!o || typeof o.texto !== 'string' || !o.texto) return null
      return { nivel: o.nivel === 'grave' ? 'grave' : 'leve', codigo: str(o.codigo, 40), texto: str(o.texto, 160) }
    })
    .filter((s): s is SinalAdmin => !!s)
  return {
    pk: Math.max(0, int(m.id)),
    apelido: str(u.apelido, 20) || 'Jogador',
    usuarioId: Math.max(0, int(u.id)),
    contaSuspensa: u.status === 'suspenso',
    hallBloqueado: u.hallBloqueado === true,
    modo: str(m.modo, 12) || 'classico',
    nota: Math.max(0, Math.min(100, int(m.nota))),
    oculta: oculta === 1 || oculta === 2 ? oculta : 0,
    suspeita: typeof m.suspeita === 'string' && m.suspeita ? m.suspeita.slice(0, 64) : null,
    denunciasAbertas: Math.max(0, int(m.denuncias)),
    posicaoHall: typeof m.posicaoHall === 'number' && Number.isFinite(m.posicaoHall) ? Math.round(m.posicaoHall) : null,
    destaque: m.destaque === true,
    publica: m.publica === true,
    moderacao: mod && typeof mod === 'object' ? { em: typeof mod.em === 'string' ? mod.em : null, motivo: typeof mod.motivo === 'string' && mod.motivo ? mod.motivo.slice(0, 200) : null } : null,
    sinais,
  }
}

/** O endereço do pedido: só dígitos = carreiras.id; o resto (o id do HallEntry) vai como carreiraId. */
export function queryResumoAdmin(id: string): Record<string, string> {
  return /^\d{1,10}$/.test(id) ? { r: 'carreira', id } : { r: 'carreira', carreiraId: id.slice(0, 64) }
}

function guardar(id: string, v: CarreiraAdmin) {
  useResumoAdmin.setState((s) => {
    const { [id]: _, ...resto } = s.abertas
    const ids = Object.keys(resto)
    for (const velho of ids.slice(0, Math.max(0, ids.length - (ABERTAS_MAX - 1)))) delete resto[velho]
    return { abertas: { ...resto, [id]: v } }
  })
}

async function abrir(id: string) {
  const ja = useResumoAdmin.getState().abertas[id]
  if (ja && (ja.status === 'pronta' || ja.status === 'carregando')) return
  guardar(id, { status: 'carregando' })
  try {
    const r = await api<{ meta?: unknown; carreira?: unknown }>('admin.php', { query: queryResumoAdmin(id), tempo: 20_000 })
    const meta = normalizarMetaAdmin(r.meta)
    if (!hallEntryValido(r.carreira) || !meta) throw new ErroApi('servidor', 200, 'Essa carreira veio incompleta do servidor.')
    guardar(id, { status: 'pronta', entry: r.carreira, meta })
  } catch (err) {
    const e = err instanceof ErroApi ? err : null
    const motivo = e && (e.status === 401 || e.status === 403) ? 'sessao' : e?.status === 404 ? 'nao_encontrada' : 'rede'
    const mensagem =
      motivo === 'sessao'
        ? 'A sessão do painel acabou neste navegador. Entre no painel de novo e use "Abrir no jogo".'
        : motivo === 'nao_encontrada'
          ? 'Essa carreira não existe mais (foi apagada ou a conta foi excluída).'
          : (e?.message ?? 'Não deu para carregar essa carreira agora.')
    guardar(id, { status: 'erro', motivo, mensagem })
  }
}

let iniciado = false
export function iniciarResumoAdmin() {
  if (iniciado) return
  iniciado = true
  useResumoAdmin.setState({ abrir: (id) => void abrir(id) })
}
