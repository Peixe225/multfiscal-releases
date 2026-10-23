import { regrasSorte } from '../dados/sorte'
import { useContaStore, type Conta, type Cupom, type EstadoConta, type Pendente } from '../store/conta'
import { regrasDaSorte } from '../store/loja'
import { useSacola } from '../store/sacola'
import { armazenamentoOk, calcularGiro, contaAtual, pendenteValido, type AdaptadorConta, type ContaAberta, type ErroCodigo, type GiroInfo } from './conta'
import { definirModo, descobrirModo, esquecerRecursos, modoConta, registrarRestauro } from './conta-modo'
import { contaDaApi, cupomDaApi, diasDaApi, gravarEu, pedirApi, pendenteDaApi, type RespostaApi } from './conta-servidor'
import { diaSP, fimDoDiaSP, premioPorId, statusDo } from './cupom'
import { gerarCodigo, premiosElegiveis, retratoDe, sortear } from './cupom-uso'
import { celularParaGuardar } from './telefone'

// O adaptador da conta em uso (só quem escreve na conta importa isto: o jogo, o formulário, a Minha conta e o
// "Mandei" do pedido; baixa com eles, fora do pedaço principal). A interface está em src/lib/conta.ts.
// Dois adaptadores com os mesmos métodos:
// - contaLocal: conta, cupons e limite só neste aparelho (grava direto no cache 'gc-conta', que aí é a própria fonte);
// - contaServidor: a conta no servidor da loja (entrar com o WhatsApp + código pelo WhatsApp da loja; o servidor
//   sorteia, gera o código do cupom e confere o limite) e o cache só guarda o que a API devolve.
// `conta` (o que as telas usam) escolhe sozinho pelo modo de src/lib/conta-modo.ts (o GET recursos do servidor):
// servidor quando dá, aparelho quando não dá.

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
    return { ok: true, valor: null }
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

/* ───────────────────────── adaptador do servidor (a conta guardada na loja) ───────────────────────── */

/** O segredo deste aparelho pro servidor (o limite de giros conta por ele): nasce no primeiro uso e fica. */
export function aparelho(): string {
  const s = st()
  if (s.aparelho && /^[0-9a-f]{32}$/.test(s.aparelho)) return s.aparelho
  const a = new Uint8Array(16)
  try {
    crypto.getRandomValues(a)
  } catch {
    for (let i = 0; i < 16; i++) a[i] = Math.floor(Math.random() * 256)
  }
  const novo = Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('')
  gravar({ aparelho: novo })
  return novo
}

/** Erro do código no formato da interface (o resto vira 'falhou': a tela diz pra tentar de novo). */
function erroCodigo(r: Extract<RespostaApi<unknown>, { ok: false }>): ErroCodigo {
  if (r.erro === 'codigo-errado' || r.erro === 'codigo-vencido' || r.erro === 'muitas-tentativas' || r.erro === 'sem-envio') return r.erro
  if (r.erro === 'invalido' && r.extra.campo === 'codigo') return 'codigo-errado'
  return 'falhou'
}

/**
 * O que a conta do aparelho leva pro servidor no primeiro login: o nome, as promoções, os cupons que ainda valem e os
 * dias de giro (só se o número é o mesmo da conta do aparelho), mais o prêmio reservado sem conta. undefined = nada.
 */
function dadosParaMigrar(whatsapp: string): { corpo: Record<string, unknown>; conta: string | null; pendente: boolean } | undefined {
  const s = st()
  const agora = Date.now()
  const alvo = s.contas[whatsapp] && whatsapp !== s.servidor ? whatsapp : null
  const local = alvo ? s.contas[alvo] : null
  const pend = s.pendente && !s.pendente.servidor && pendenteValido(s.pendente, s.pendente.interativo, agora) ? s.pendente : null
  if (!local && !pend) return undefined
  const corpo: Record<string, unknown> = { giros: s.giros }
  if (local) {
    corpo.nome = local.conta.nome
    corpo.aceitaPromo = local.conta.aceitaPromo
    corpo.aceitaPromoEm = local.conta.aceitaPromoEm
    corpo.cupons = local.cupons
      .filter((c) => statusDo(c, agora) === 'ativo')
      .map((c) => ({ codigo: c.codigo, interativo: c.interativo, premioId: c.premioId, ganhoEm: c.ganhoEm, validoAte: c.validoAte }))
  }
  if (pend) corpo.pendente = { interativo: pend.interativo, premioId: pend.premioId, sorteadoEm: pend.sorteadoEm, expiraEm: pend.expiraEm }
  return { corpo, conta: alvo, pendente: !!pend }
}

/** Grava a resposta do entrar no cache e devolve a conta aberta. */
function abriuNoServidor(d: Record<string, unknown>, migrou: ReturnType<typeof dadosParaMigrar>): ContaAberta | null {
  const guardado = cupomDaApi(d.cupomGuardado)
  const extra: Partial<EstadoConta> = {}
  const s = st()
  if (migrou?.pendente || guardado || s.pendente?.servidor) extra.pendente = null
  if (migrou?.conta && s.paraMigrar === migrou.conta) extra.paraMigrar = null
  // a conta do aparelho que foi junto sai do cache (a do servidor entra no lugar, com o mesmo número)
  const conta = gravarEu(d, extra)
  if (!conta) return null
  if (migrou?.conta && migrou.conta !== conta.whatsapp) {
    gravar((x) => {
      const contas = { ...x.contas }
      delete contas[migrou.conta!]
      return { contas }
    })
  }
  definirModo('servidor')
  esquecerRecursos()
  return { conta, cupomGuardado: guardado, jaTinha: d.criada === false, ...(d.pendenteRecusado === 'ja-girou-hoje' ? { pendenteRecusado: 'ja-girou-hoje' as const } : {}) }
}

/** A conta do servidor sai deste aparelho (sair, apagar): o cache esquece ela, o cupom aplicado sai da sacola. */
function largarContaDoServidor() {
  gravar((s) => {
    const contas = { ...s.contas }
    if (s.servidor) delete contas[s.servidor]
    return { contas, atual: s.atual === s.servidor ? null : s.atual, servidor: null, enderecos: [] }
  })
  useSacola.getState().tirarCupom()
  esquecerRecursos()
}

/** Troca um cupom da conta do servidor no cache (pelo código). */
function trocarCupomServidor(c: Cupom) {
  gravar((s) => {
    const w = s.servidor
    if (!w || !s.contas[w]) return {}
    const lista = s.contas[w].cupons
    const cupons = lista.some((x) => x.codigo === c.codigo) ? lista.map((x) => (x.codigo === c.codigo ? c : x)) : [c, ...lista]
    return { contas: { ...s.contas, [w]: { ...s.contas[w], cupons } } }
  })
}

function giroDaApi(x: unknown): GiroInfo | null {
  const g = x as Record<string, unknown> | null
  if (!g || typeof g.disponivel !== 'boolean') return null
  if (g.disponivel) return { disponivel: true }
  if (g.motivo === 'ja-girou-hoje') {
    const t = typeof g.proximoEm === 'string' ? Date.parse(g.proximoEm) : NaN
    return { disponivel: false, motivo: 'ja-girou-hoje', proximoEm: Number.isFinite(t) ? t : Date.now() + 3600_000 }
  }
  return { disponivel: false, motivo: 'sem-conta-ja-girou', girouHoje: g.girouHoje === true }
}

export const contaServidor: AdaptadorConta = {
  modo: 'servidor',

  async criar(d) {
    if (!d.codigo) return { ok: false, erro: 'precisa-codigo' }
    const whatsapp = celularParaGuardar(d.whatsapp)
    if (!whatsapp || nomeLimpo(d.nome).length < 2) return { ok: false, erro: 'invalido' }
    const r = await contaServidor.confirmarCodigo(whatsapp, d.codigo, { nome: nomeLimpo(d.nome), aceitaPromo: d.aceitaPromo })
    if (r.ok) return r
    return { ok: false, erro: r.erro === 'precisa-nome' || r.erro === 'nao-encontrada' ? 'invalido' : r.erro }
  },

  async pedirCodigo(whatsappTexto, motivo = 'entrar') {
    const whatsapp = celularParaGuardar(whatsappTexto)
    if (!whatsapp) return { ok: false, erro: 'invalido' }
    // o segredo deste aparelho: se a conta já entrou aqui, o limite do número fica só deste aparelho (quem pede código pro
    // número dos outros não trava a dona)
    const r = await pedirApi('cliente-codigo', { metodo: 'POST', corpo: { whatsapp, motivo: motivo === 'trocar' ? 'trocar' : 'entrar', aparelho: aparelho(), site: '' } })
    if (r.ok) return { ok: true, valor: { enviado: true } }
    // limite do número, mas o código que já chegou no WhatsApp ainda vale (valem os 2 últimos): vai pro passo do código
    if (r.erro === 'muitas-tentativas' && r.extra.codigoValendo === true) return { ok: true, valor: { enviado: true, jaValendo: true } }
    if (r.erro === 'sem-codigo') {
      // a loja desligou o código no meio do caminho: a conta volta pro aparelho
      definirModo('local')
      esquecerRecursos()
    }
    if (r.erro === 'invalido' && r.extra.campo === 'whatsapp') return { ok: false, erro: 'invalido' }
    return { ok: false, erro: erroCodigo(r) }
  },

  async confirmarCodigo(whatsappTexto, codigo, extra) {
    const whatsapp = celularParaGuardar(whatsappTexto)
    if (!whatsapp || !codigo) return { ok: false, erro: 'codigo-errado' }
    const migrar = dadosParaMigrar(whatsapp)
    const corpo: Record<string, unknown> = { whatsapp, codigo, aparelho: aparelho() }
    if (extra?.nome) corpo.nome = extra.nome
    if (extra?.aceitaPromo != null) corpo.aceitaPromo = extra.aceitaPromo
    if (migrar) corpo.migrar = migrar.corpo
    const r = await pedirApi<Record<string, unknown>>('cliente-entrar', { metodo: 'POST', corpo })
    if (!r.ok) return { ok: false, erro: erroCodigo(r) }
    // número sem conta: o código continua valendo e a pessoa manda de novo com o nome
    if (r.dados.precisaNome === true) return { ok: false, erro: 'precisa-nome' }
    const aberta = abriuNoServidor(r.dados, migrar)
    return aberta ? { ok: true, valor: aberta } : { ok: false, erro: 'falhou' }
  },

  async sair() {
    await pedirApi('cliente-sair', { metodo: 'POST', corpo: {} })
    largarContaDoServidor()
  },

  async apagar() {
    const r = await pedirApi('cliente-apagar', { metodo: 'POST', corpo: { confirmar: true } })
    if (!r.ok && r.erro !== 'sem-sessao') return { ok: false, erro: 'falhou' }
    largarContaDoServidor()
    return { ok: true, valor: null }
  },

  async atualizar(d) {
    const s = st()
    const atual = contaAtual(s)
    if (!atual) return { ok: false, erro: 'invalido' }
    const corpo: Record<string, unknown> = {}
    if (d.nome != null) corpo.nome = nomeLimpo(d.nome)
    if (d.aceitaPromo != null) corpo.aceitaPromo = d.aceitaPromo
    if (d.whatsapp != null) {
      const w = celularParaGuardar(d.whatsapp)
      if (!w) return { ok: false, erro: 'invalido' }
      if (w !== atual.conta.whatsapp) {
        if (!d.codigo) return { ok: false, erro: 'precisa-codigo' }
        corpo.whatsapp = w
        corpo.codigo = d.codigo
      }
    }
    const r = await pedirApi<{ conta: unknown }>('cliente-atualizar', { metodo: 'POST', corpo })
    if (!r.ok) {
      if (r.erro === 'whatsapp-existe') return { ok: false, erro: 'whatsapp-existe' }
      if (r.erro === 'invalido' && r.extra.campo !== 'codigo') return { ok: false, erro: 'invalido' }
      return { ok: false, erro: erroCodigo(r) }
    }
    const conta = contaDaApi(r.dados.conta)
    if (!conta) return { ok: false, erro: 'falhou' }
    gravar((x) => {
      const contas = { ...x.contas }
      const antes = x.servidor ? contas[x.servidor] : undefined
      if (x.servidor) delete contas[x.servidor]
      contas[conta.whatsapp] = { conta, cupons: antes?.cupons ?? [] }
      return { contas, atual: conta.whatsapp, servidor: conta.whatsapp }
    })
    return { ok: true, valor: conta }
  },

  async giroDisponivel(interativo) {
    const r = await pedirApi<{ giro: unknown; pendente: unknown; dias: unknown }>('cliente-giro', { params: { interativo, aparelho: aparelho() } })
    if (!r.ok) return calcularGiro(st(), interativo, Date.now())
    const dias = Array.isArray(r.dados.dias) ? diasDaApi({ [interativo]: r.dados.dias })[interativo] : []
    const pendente = pendenteDaApi(r.dados.pendente)
    gravar((s) => ({ giros: { ...s.giros, [interativo]: dias }, pendente: pendente ?? (s.pendente?.servidor || !s.atual ? null : s.pendente) }))
    return giroDaApi(r.dados.giro) ?? calcularGiro(st(), interativo, Date.now())
  },

  async girar(interativo, ctx) {
    const r = await pedirApi<{ premioId: unknown; cupom: unknown; pendente: unknown; dias: unknown }>('cliente-girar', {
      metodo: 'POST',
      corpo: { interativo, uf: ctx.uf ?? '', aparelho: aparelho() },
      ms: 20_000,
    })
    if (!r.ok) return { ok: false, erro: r.erro === 'sem-premio' ? 'sem-premio' : 'sem-giro' }
    const premioId = typeof r.dados.premioId === 'string' ? r.dados.premioId : ''
    const cupom = cupomDaApi(r.dados.cupom)
    const pendente: Pendente | null = pendenteDaApi(r.dados.pendente)
    const dias = Array.isArray(r.dados.dias) ? diasDaApi({ [interativo]: r.dados.dias })[interativo] : []
    gravar((s) => ({ giros: { ...s.giros, [interativo]: dias }, pendente: cupom ? null : pendente }))
    if (cupom) trocarCupomServidor(cupom)
    return { ok: true, valor: { premioId, cupom } }
  },

  async salvarCupom(interativo) {
    const r = await pedirApi<{ cupom: unknown }>('cliente-guardar', { metodo: 'POST', corpo: { interativo, aparelho: aparelho() } })
    if (!r.ok) return { ok: false, erro: r.erro === 'sem-sessao' ? 'sem-conta' : r.erro === 'pendente-vencido' || r.erro === 'ja-girou-hoje' ? r.erro : 'sem-pendente' }
    const cupom = cupomDaApi(r.dados.cupom)
    if (!cupom) return { ok: false, erro: 'sem-pendente' }
    gravar({ pendente: null })
    trocarCupomServidor(cupom)
    return { ok: true, valor: cupom }
  },

  async usarCupom(codigo) {
    const r = await pedirApi<{ cupom: unknown }>('cliente-cupom-usar', { metodo: 'POST', corpo: { codigo } })
    const cupom = cupomDaApi(r.ok ? r.dados.cupom : r.extra.cupom)
    if (cupom) trocarCupomServidor(cupom)
    if (r.ok && cupom) return { ok: true, valor: cupom }
    if (!r.ok && r.erro === 'ja-usado') return { ok: false, erro: 'ja-usado' }
    if (!r.ok && r.erro === 'vencido') return { ok: false, erro: 'vencido' }
    return { ok: false, erro: 'nao-encontrado' }
  },
}

/** Sessão viva sem a conta no cache (o navegador limpou o armazenamento e o cookie ficou): busca a conta de volta. */
let restaurando = false
export async function restaurarDoServidor(): Promise<void> {
  if (restaurando || st().servidor) return
  restaurando = true
  try {
    const r = await pedirApi<Record<string, unknown>>('cliente-eu', { params: { aparelho: aparelho() } })
    if (r.ok) gravarEu(r.dados)
  } finally {
    restaurando = false
  }
}
registrarRestauro(() => void restaurarDoServidor())

/* ───────────────────────── o adaptador em uso: o do servidor quando dá, o do aparelho quando não ───────────────────────── */

function escolhido(): AdaptadorConta {
  return modoConta() === 'servidor' ? contaServidor : contaLocal
}

/**
 * O que as telas usam. Cada método espera o servidor dizer o modo (uma vez por visita, guardado; sem servidor, na
 * hora) e chama o adaptador certo.
 */
export const conta: AdaptadorConta = {
  get modo() {
    return modoConta()
  },
  criar: async (d) => (await descobrirModo(), escolhido().criar(d)),
  pedirCodigo: async (w, m) => (await descobrirModo(), escolhido().pedirCodigo(w, m)),
  confirmarCodigo: async (w, c, e) => (await descobrirModo(), escolhido().confirmarCodigo(w, c, e)),
  sair: async () => (await descobrirModo(), escolhido().sair()),
  apagar: async () => (await descobrirModo(), escolhido().apagar()),
  atualizar: async (d) => (await descobrirModo(), escolhido().atualizar(d)),
  giroDisponivel: async (i) => (await descobrirModo(), escolhido().giroDisponivel(i)),
  girar: async (i, ctx) => (await descobrirModo(), escolhido().girar(i, ctx)),
  salvarCupom: async (i) => (await descobrirModo(), escolhido().salvarCupom(i)),
  usarCupom: async (c) => (await descobrirModo(), escolhido().usarCupom(c)),
}
