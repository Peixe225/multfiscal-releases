import { configConta } from '../dados/conta'
import { regrasSorte } from '../dados/sorte'
import { useContaStore, type Conta, type Cupom, type EstadoConta } from '../store/conta'
import { regrasDaSorte } from '../store/loja'
import { useSacola } from '../store/sacola'
import { armazenamentoOk, calcularGiro, contaAtual, pendenteValido, type AdaptadorConta, type ContaAberta } from './conta'
import { diaSP, fimDoDiaSP, premioPorId, statusDo } from './cupom'
import { gerarCodigo, premiosElegiveis, retratoDe, sortear } from './cupom-uso'
import { celularParaGuardar } from './telefone'

// O adaptador da conta em uso (só quem escreve na conta importa isto: o jogo, o formulário, a Minha conta e o
// "Mandei" do pedido; baixa com eles, fora do pedaço principal). A interface está em src/lib/conta.ts.
// Hoje (prévia) vale o adaptador local: grava direto no cache 'gc-conta', que aqui é a própria fonte.

// quanto tempo o prêmio de quem girou sem conta fica guardado (as regras do painel, ou as de src/dados/sorte.ts)
const reservaMs = () => regrasDaSorte().reservaSemContaHoras * 3600 * 1000

function codigosDoAparelho(s: EstadoConta): Set<string> {
  const out = new Set<string>()
  for (const c of Object.values(s.contas)) for (const k of c.cupons) out.add(k.codigo)
  return out
}

function novoId(): string {
  try {
    if (crypto.randomUUID) return crypto.randomUUID()
  } catch {
    /* reserva abaixo */
  }
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function nomeLimpo(nome: string): string {
  return nome.replace(/\s+/g, ' ').trim().slice(0, 60)
}

/** Cria o cupom do prêmio na conta aberta (o código nasce aqui). */
function criarCupom(s: EstadoConta, interativo: string, premioId: string, agora: number): Cupom | null {
  const p = premioPorId(premioId)
  if (!p) return null
  return {
    codigo: gerarCodigo(regrasSorte.prefixo, codigosDoAparelho(s)),
    interativo,
    premioId,
    retrato: retratoDe(p),
    demo: p.demo,
    ganhoEm: agora,
    validoAte: fimDoDiaSP(agora, p.validadeDias),
  }
}

/* ───────────────────────── adaptador local (prévia) ───────────────────────── */

const st = () => useContaStore.getState()
const gravar = (parcial: Partial<EstadoConta> | ((s: EstadoConta) => Partial<EstadoConta>)) => useContaStore.setState(parcial)

/** Relê o que está gravado (outra aba pode ter girado ou guardado). */
async function reler() {
  await useContaStore.persist.rehydrate()
}

/** Aplica um cupom na conta aberta (substitui pelo código). */
function trocarCupom(codigo: string, f: (c: Cupom) => Cupom) {
  gravar((s) => {
    const atual = contaAtual(s)
    if (!atual || !s.atual) return {}
    return { contas: { ...s.contas, [s.atual]: { ...atual, cupons: atual.cupons.map((c) => (c.codigo === codigo ? f(c) : c)) } } }
  })
}

/** Criou conta ou entrou com prêmio reservado e ainda válido: guarda na hora. Devolve o cupom guardado. */
async function guardarPendente(): Promise<Cupom | null> {
  const p = st().pendente
  if (!p || !pendenteValido(p, p.interativo, Date.now())) return null
  const r = await contaLocal.salvarCupom(p.interativo)
  return r.ok ? r.valor : null
}

async function abrir(whatsapp: string, conta: Conta): Promise<ContaAberta> {
  gravar({ atual: whatsapp })
  return { conta, cupomGuardado: await guardarPendente() }
}

export const contaLocal: AdaptadorConta = {
  modo: 'local',

  async criar(d) {
    if (!armazenamentoOk) return { ok: false, erro: 'sem-armazenamento' }
    await reler()
    const whatsapp = celularParaGuardar(d.whatsapp)
    const nome = nomeLimpo(d.nome)
    if (!whatsapp || nome.length < 2) return { ok: false, erro: 'invalido' }
    if (st().contas[whatsapp]) return { ok: false, erro: 'whatsapp-existe' }
    const agora = Date.now()
    const conta: Conta = {
      id: novoId(),
      nome,
      whatsapp,
      aceitaPromo: d.aceitaPromo,
      aceitaPromoEm: d.aceitaPromo ? agora : null,
      confirmou18Em: agora,
      criadaEm: agora,
    }
    gravar((s) => ({ contas: { ...s.contas, [whatsapp]: { conta, cupons: [] } } }))
    return { ok: true, valor: await abrir(whatsapp, conta) }
  },

  // Na prévia a conta só existe neste aparelho: quem está com ele na mão é o dono. Não manda código nenhum.
  async pedirCodigo(whatsappTexto) {
    await reler()
    const whatsapp = celularParaGuardar(whatsappTexto)
    if (!whatsapp || !st().contas[whatsapp]) return { ok: false, erro: 'nao-encontrada' }
    return { ok: true, valor: { enviado: false } }
  },

  async confirmarCodigo(whatsappTexto) {
    await reler()
    const whatsapp = celularParaGuardar(whatsappTexto)
    const achada = whatsapp ? st().contas[whatsapp] : undefined
    if (!whatsapp || !achada) return { ok: false, erro: 'nao-encontrada' }
    return { ok: true, valor: await abrir(whatsapp, achada.conta) }
  },

  async sair() {
    gravar({ atual: null })
    useSacola.getState().tirarCupom()
  },

  async apagar() {
    gravar((s) => {
      if (!s.atual) return {}
      const contas = { ...s.contas }
      delete contas[s.atual]
      return { contas, atual: null }
    })
    useSacola.getState().tirarCupom()
  },

  async atualizar(d) {
    await reler()
    const s = st()
    const atual = contaAtual(s)
    if (!atual || !s.atual) return { ok: false, erro: 'invalido' }
    const nome = d.nome != null ? nomeLimpo(d.nome) : atual.conta.nome
    if (nome.length < 2) return { ok: false, erro: 'invalido' }
    const whatsapp = d.whatsapp != null ? celularParaGuardar(d.whatsapp) : atual.conta.whatsapp
    if (!whatsapp) return { ok: false, erro: 'invalido' }
    if (whatsapp !== s.atual && s.contas[whatsapp]) return { ok: false, erro: 'whatsapp-existe' }
    const aceita = d.aceitaPromo ?? atual.conta.aceitaPromo
    const conta: Conta = {
      ...atual.conta,
      nome,
      whatsapp,
      aceitaPromo: aceita,
      aceitaPromoEm: aceita ? (atual.conta.aceitaPromo ? atual.conta.aceitaPromoEm : Date.now()) : null,
    }
    const contas = { ...s.contas }
    delete contas[s.atual]
    contas[whatsapp] = { ...atual, conta }
    gravar({ contas, atual: whatsapp })
    return { ok: true, valor: conta }
  },

  async giroDisponivel(interativo) {
    await reler()
    return calcularGiro(st(), interativo, Date.now())
  },

  async girar(interativo, ctx) {
    // 1) relê e confere: duas abas não giram duas vezes
    await reler()
    const agora = Date.now()
    if (!calcularGiro(st(), interativo, agora).disponivel) return { ok: false, erro: 'sem-giro' }
    // 2) sorteia só entre os prêmios que valem no estado
    const premio = sortear(premiosElegiveis(ctx.uf))
    if (!premio) return { ok: false, erro: 'sem-premio' }
    // 3) grava o dia do giro (do aparelho)
    const hoje = diaSP(agora)
    gravar((s) => ({ giros: { ...s.giros, [interativo]: [...(s.giros[interativo] ?? []), hoje].slice(-30) } }))
    // 4) com conta, o cupom já nasce guardado; sem conta, fica reservado 24 h (sem código)
    const s = st()
    if (contaAtual(s) && s.atual) {
      const cupom = criarCupom(s, interativo, premio.id, agora)
      if (cupom) {
        const conta = s.atual
        gravar((x) => ({ contas: { ...x.contas, [conta]: { ...x.contas[conta], cupons: [...x.contas[conta].cupons, cupom] } }, pendente: null }))
      }
      return { ok: true, valor: { premioId: premio.id, cupom } }
    }
    gravar({ pendente: { interativo, premioId: premio.id, sorteadoEm: agora, expiraEm: agora + reservaMs() } })
    return { ok: true, valor: { premioId: premio.id, cupom: null } }
  },

  async salvarCupom(interativo) {
    await reler()
    const s = st()
    const agora = Date.now()
    if (!contaAtual(s) || !s.atual) return { ok: false, erro: 'sem-conta' }
    const p = s.pendente
    if (!p || p.interativo !== interativo) return { ok: false, erro: 'sem-pendente' }
    if (agora >= p.expiraEm) return { ok: false, erro: 'pendente-vencido' }
    const cupom = criarCupom(s, interativo, p.premioId, agora)
    if (!cupom) return { ok: false, erro: 'sem-pendente' }
    const conta = s.atual
    gravar((x) => ({ contas: { ...x.contas, [conta]: { ...x.contas[conta], cupons: [...x.contas[conta].cupons, cupom] } }, pendente: null }))
    return { ok: true, valor: cupom }
  },

  async usarCupom(codigo) {
    await reler()
    const atual = contaAtual(st())
    const c = atual?.cupons.find((x) => x.codigo === codigo)
    if (!c) return { ok: false, erro: 'nao-encontrado' }
    if (c.usadoEm) return { ok: false, erro: 'ja-usado' }
    const agora = Date.now()
    if (statusDo(c, agora) !== 'ativo') return { ok: false, erro: 'vencido' }
    const usado = { ...c, usadoEm: agora }
    trocarCupom(codigo, () => usado)
    return { ok: true, valor: usado }
  },
}

/**
 * O adaptador em uso. Na versão oficial, configConta.modo = 'servidor' liga o adaptador da API da loja (mesmos
 * métodos; descrito no PENDENCIAS.md), que grava no cache 'gc-conta' o que a API devolve. Enquanto ele não existe,
 * segue o local.
 */
export const conta: AdaptadorConta = contaLocal
if (import.meta.env.DEV && configConta.modo !== conta.modo) console.warn('[conta] o adaptador do servidor ainda não existe: segue o local')
