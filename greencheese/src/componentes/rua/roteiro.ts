// A coreografia da rua. Um diretor sorteia o próximo cliente (nunca o mesmo duas vezes seguidas) e, entre um e outro,
// o mercador vive: anda até um ponto, para, olha em volta, bebe a Fanta e guarda, faz carinho no gato, espera. Cada
// cliente: entra, chega perto, fala, o mercador responde (abre o casaco), entrega, recebe, o cliente faz a coisa dele
// e sai — e o mercador já volta a viver enquanto ele vai embora. Um cliente por vez; ciclo de ~20 a 35 s.
//
// Tudo em geradores (motor.ts): `yield 300` espera 300 ms do relógio da cena, `yield () => cond` espera a condição.
// Pausar a cena para o relógio, então os roteiros param junto, no meio do que estiverem fazendo.

import type { Lado } from './pacote'
import { FALAS, sortear } from './falas'
import type { Ator, Espera, Motor, Roteiro } from './motor'

export type Cliente = 'skatista' | 'motoboy' | 'mc' | 'turista'
const CLIENTES: readonly Cliente[] = ['skatista', 'motoboy', 'mc', 'turista']

/** A vez de um cliente: onde o mercador atende, para que lado olha, a vida dele antes e se o anterior já foi. */
interface Vez {
  lado: Lado
  ponto: number
  /** Bebeu no interlúdio (não bebe de novo esperando). */
  bebe: boolean
  /** O interlúdio (o mercador vivendo): o cliente já pode vir entrando enquanto ele termina. */
  vida: Roteiro
  /** O cliente de antes já saiu da tela. */
  livre: () => boolean
  /** Story: o cliente já vem entrando (nasce colado na beira da tela e não espera respiro nenhum). */
  jaEntrando: boolean
  /** Story: as pausas entre uma fala e outra encurtam e a saída é a mais curta (cabe no segmento de ~12 s). */
  story: boolean
  /** Story: a fala que o adesivo do pé já diz (o mercador não repete ela no balão). */
  evitar?: string
}

/** No story as pausas da conversa encurtam (os gestos e o andar continuam no tempo deles). */
const pausa = (v: { story: boolean }, ms: number, curta: number) => (v.story ? curta : ms)
/**
 * No story, quanto tempo a fala de um cliente fica na tela antes de o mercador responder (dá para ler): o que encurta é
 * a espera muda, não a fala.
 */
const LER = 1200

/**
 * O saco dos clientes. Quem monta a cena pode guardar o saco: ele dura enquanto o story existir (os quatro passam antes
 * de alguém repetir); a cena só é montada de novo quando a escala ou a orientação do quadro muda.
 */
export interface Saco {
  fila: Cliente[]
  ultimo: Cliente | null
}

export interface OpcoesCena {
  /** Story: começa com um cliente já entrando, para caber um atendimento inteiro no segmento. */
  story?: boolean
  saco?: Saco
  /** Laboratório e testes: quem vem primeiro. */
  primeiro?: Cliente
  /** A fala que o chamado não repete (o story já tem o "Chega mais." no adesivo do pé). */
  evitar?: string
}
type Ato = Generator<Espera, () => boolean, void>

const oposto = (l: Lado): Lado => (l === 'dir' ? 'esq' : 'dir')

/* ───────────── pedacinhos ───────────── */

/** Toca a animação e espera: sem laço, até o fim; com laço, `ms` (ou `vezes` voltas), ou até `ate()`. */
function* anima(m: Motor, a: Ator, anim: string, op: { lado?: Lado; ms?: number; vezes?: number; ate?: () => boolean } = {}): Roteiro {
  m.tocar(a, anim, op.lado)
  const meta = a.folha.anims[anim]
  if (!meta.laco) {
    yield () => a.acabou
    return
  }
  const fim = m.t + (op.ms ?? meta.duracao * (op.vezes ?? 1))
  yield () => m.t >= fim || !!op.ate?.()
}

/** Fora da tela (com folga): quem sai some. No story em pé, a tela é o pedaço do mundo que aparece. */
function fora(m: Motor, a: Ator): boolean {
  const [x0, , x1] = m.caixa(a)
  const v = m.palco.visivel
  return x1 < v.x0 - 2 || x0 > v.x1 + 2
}

/** Espera `cond` ouvindo o toque nele: só aí a reação sai na hora (no story, fora disso o toque passa o story). */
function* ouvindo(a: Ator, cond: () => boolean): Roteiro {
  a.ouve = true
  yield cond
  a.ouve = false
}

/** Reação ao toque (o roteiro chama quando o personagem está livre): a reação dele e volta ao que fazia. */
function* reage(m: Motor, a: Ator, depois: string): Roteiro {
  a.querReagir = false
  const anim = a.folha.anims.reagir ? 'reagir' : 'carinho'
  if (!a.folha.anims[anim]) return
  yield* anima(m, a, anim)
  m.tocar(a, depois)
}

/** Espera `ms` parado (no `parado` dele), atendendo toque. */
function* espera(m: Motor, a: Ator, ms: number, parado = 'parado'): Roteiro {
  const fim = m.t + ms
  if (a.anim !== parado) m.tocar(a, parado)
  while (m.t < fim) {
    yield* ouvindo(a, () => m.t >= fim || a.querReagir)
    if (a.querReagir) {
      yield* reage(m, a, parado)
    }
  }
}

/**
 * Anda até `alvo` com a animação de passo (laço com passo), sem passar dele; com `y`, troca de faixa no caminho.
 * `reage`: toque no meio do caminho para, reage e segue. `chamavel`: o mercador atende o chamado no caminho.
 */
function* anda(m: Motor, a: Ator, alvo: number, anim: string, op: { y?: number; reage?: boolean; chamavel?: Motor } = {}): Roteiro {
  const lado: Lado = alvo === a.x ? a.lado : alvo > a.x ? 'dir' : 'esq'
  const chegou = () => a.x === alvo && (op.y == null || a.y === op.y)
  if (chegou()) return
  const ir = () => {
    a.alvo = alvo
    a.alvoY = op.y ?? null
    m.tocar(a, anim, lado)
  }
  ir()
  while (!chegou()) {
    if (op.reage) a.ouve = true
    yield () => chegou() || (!!op.reage && a.querReagir) || (!!op.chamavel && m.chamado)
    a.ouve = false
    if (chegou()) break
    a.alvo = null
    a.alvoY = null
    if (op.reage && a.querReagir) yield* reage(m, a, anim)
    else if (op.chamavel && m.chamado) yield* atenderChamado(m, a)
    ir()
  }
  a.alvo = null
  a.alvoY = null
}

/** O mercador abre o casaco para quem chamou (o balão e o botão do Mercado já saíram na hora do toque). */
function* atenderChamado(m: Motor, merc: Ator): Roteiro {
  m.chamado = false
  yield* anima(m, merc, 'abrir')
  yield* anima(m, merc, 'mostrar', { ms: 2600 })
  yield* anima(m, merc, 'fechar')
  m.tocar(merc, 'parado')
}

/** Uma batida do mercador sozinho, atendendo o chamado antes. */
function* batida(m: Motor, merc: Ator, b: () => Roteiro): Roteiro {
  if (m.chamado) yield* atenderChamado(m, merc)
  yield* b()
}

/**
 * Distância entre as âncoras para as mãos baterem: o mercador no quadro `evM` de `animM`, o cliente (virado para ele)
 * no `evC` de `animC`. Olhando para a direita, o cliente fica em merc.x + d.
 */
function distancia(m: Motor, animM: string, evM: string, cli: string, animC: string, evC: string): number {
  const fm = m.folha('mercador')
  const fc = m.folha(cli)
  const qm = fm.anims[animM].q.find((q) => q.evento === evM)?.mao
  const qc = fc.anims[animC].q.find((q) => q.evento === evC)?.mao
  if (!qm || !qc) return 44
  return qm[0] - fm.ancora.x + (qc[0] - fc.ancora.x) + 1
}

/** O mercador entrega `item`: tira do casaco, estende, o cliente pega (o item muda de mão no "pega") e guarda. */
function* passar(m: Motor, merc: Ator, cli: Ator, item: string, op: { pegaNaBase?: [number, number] } = {}): Roteiro {
  m.tocar(merc, 'passar')
  yield () => merc.eventos.has('oferece')
  merc.item = item
  m.marcar()
  m.tocar(cli, 'pegar')
  yield () => cli.eventos.has('pega')
  merc.item = null
  cli.item = item
  // a sacola, o motoboy pega por baixo (a mão dele fica mais baixa, sentado na moto); depois, pela alça
  cli.itemPega = op.pegaNaBase ?? null
  m.marcar()
  const i0 = cli.i
  yield () => cli.i !== i0 || cli.acabou
  cli.itemPega = null
  // guardou (o quadro do "guarda" não tem mão: o item some sozinho)
  yield () => cli.acabou && merc.acabou
  cli.item = null
  m.tocar(merc, 'parado')
}

/**
 * O cliente paga: tira a nota, estende; o mercador estende a palma e recebe (a nota muda de mão no "recebe"). Com
 * `soCliente` (story), volta quando o cliente acabou: o mercador termina de guardar a nota sozinho.
 */
function* pagar(m: Motor, merc: Ator, cli: Ator, soCliente = false): Roteiro {
  m.tocar(merc, 'receber')
  // o "paga" dele (710 ms depois do começo) cai no "recebe" do mercador (1000 ms)
  yield 290
  m.tocar(cli, 'pagar')
  cli.item = 'nota'
  yield () => merc.eventos.has('recebe')
  cli.item = null
  merc.item = 'nota'
  m.marcar()
  yield () => !m.quadro(merc).mao
  merc.item = null
  yield () => (soCliente || merc.acabou) && cli.acabou
}

/** Toque de mão em 3 tempos com o MC; a nota passa no aperto (paga no toque). */
function* toque(m: Motor, merc: Ator, mc: Ator): Roteiro {
  m.tocar(merc, 'toque')
  m.tocar(mc, 'toque')
  mc.item = 'nota'
  yield () => mc.eventos.has('toque2')
  mc.item = null
  merc.item = 'nota'
  m.marcar()
  yield () => merc.eventos.has('toque3')
  yield () => !m.quadro(merc).mao
  merc.item = null
  yield () => merc.acabou && mc.acabou
}

/* ───────────── a vida do mercador ───────────── */

function* acenar(m: Motor, merc: Ator): Roteiro {
  yield* anima(m, merc, 'acenar')
  m.tocar(merc, 'parado')
}

/** Quadros do olhar com o rosto de frente (mercador.ts: o 0, o de volta ao meio e o do fim). */
const OLHAR_FRENTE = new Set([0, 4, 8])

/** Olha em volta; com `ate`, para no primeiro quadro de frente depois que `ate()` vale (sem pulo de cabeça). */
function* olhar(m: Motor, merc: Ator, ate?: () => boolean): Roteiro {
  m.tocar(merc, 'olhar')
  yield () => merc.acabou || (!!ate?.() && OLHAR_FRENTE.has(merc.i))
  m.tocar(merc, 'parado')
}

function* beber(m: Motor, merc: Ator): Roteiro {
  yield* anima(m, merc, 'beber')
  m.tocar(merc, 'parado')
}

function* respirar(m: Motor, merc: Ator, ms: number, ate?: () => boolean): Roteiro {
  yield* anima(m, merc, 'parado', { ms, ate: () => m.chamado || !!ate?.() })
}

/** Anda até um lugar de passeio (sempre de volta à faixa do meio). */
function* passear(m: Motor, merc: Ator, alvo: number): Roteiro {
  yield* anda(m, merc, alvo, 'andar', { y: m.chao.meio, chamavel: m })
  m.tocar(merc, 'parado')
}

/** Vai até os engradados e faz carinho no gato (o gato empina a cabeça no "carinho"). */
function* carinho(m: Motor, merc: Ator, gato: Ator): Roteiro {
  const L = m.lugar
  const lado: Lado = L.engradado > merc.x ? 'dir' : 'esq'
  const alvo = L.engradado + (lado === 'dir' ? -26 : 26)
  yield* anda(m, merc, alvo, 'andar', { y: m.chao.meio, chamavel: m })
  merc.lado = lado
  gato.querReagir = false
  yield* anima(m, merc, 'carinho')
  m.tocar(merc, 'parado')
}

/**
 * Entre um cliente e outro: anda até um ponto, para, olha em volta, bebe a lata (sempre que não bebeu na última
 * vez), espera. Termina no ponto de atender, virado para o lado de onde o cliente vem. No story, uma coisa só entre
 * olhar quem foi e voltar ao ponto: a lata, o carinho no gato ou um respiro.
 */
function* interludio(
  m: Motor,
  merc: Ator,
  gato: Ator,
  ponto: number,
  lado: Lado,
  op: { curto: boolean; bebe: boolean; carinho: boolean; acenou: boolean; story: boolean },
): Roteiro {
  const L = m.lugar
  m.fase = 'vida'
  if (!op.curto) {
    // primeiro olha o cliente ir embora (ou acena, se ainda não acenou): ninguém atravessa ninguém
    m.mercadorLivre = true
    yield* batida(m, merc, () => (!op.acenou && m.rand() < 0.4 ? acenar(m, merc) : olhar(m, merc)))
    if (op.story) {
      if (op.bebe) yield* batida(m, merc, () => beber(m, merc))
      else if (op.carinho) yield* batida(m, merc, () => carinho(m, merc, gato))
      else yield* batida(m, merc, () => respirar(m, merc, 800))
    } else {
      // primeiro anda (passeio ou carinho no gato), depois para e olha, depois bebe
      const longe = L.passeio.filter((x) => Math.abs(x - merc.x) > 18)
      if (op.carinho) yield* batida(m, merc, () => carinho(m, merc, gato))
      else if (longe.length) yield* batida(m, merc, () => passear(m, merc, longe[Math.floor(m.rand() * longe.length)]))
      if (m.rand() < 0.6) yield* batida(m, merc, () => olhar(m, merc))
      if (op.bebe) yield* batida(m, merc, () => beber(m, merc))
      else yield* batida(m, merc, () => respirar(m, merc, 1600))
    }
  }
  m.mercadorLivre = true
  // a caminho do ponto: o cliente que anda devagar já pode vir entrando
  m.fase = 'rumo'
  yield* batida(m, merc, () => passear(m, merc, ponto))
  if (m.chamado) yield* atenderChamado(m, merc)
  m.mercadorLivre = false
  m.fase = 'ponto'
  merc.lado = lado
  m.tocar(merc, 'parado')
  if (m.sexta && m.rand() < 0.5) m.falar(merc, FALAS.sextou, 1600)
}

/**
 * O mercador espera o cliente chegar, vivendo (respira, olha, às vezes bebe); o chamado vem antes. Chegou, ele para de
 * respirar na hora e de olhar no próximo quadro de frente: o cliente não fica parado esperando a vez de falar. A lata
 * (2,4 s, sem como parar no meio) só sai com o cliente ainda fora da tela (`longe`), e o cliente só entra depois que
 * ele guardou a lata (`bebendo`, na entrada de cada ato). Com o cliente já entrando (story), ele só respira: o
 * primeiro quadro da rua é o mesmo em todo aparelho (o pôster).
 */
function* esperarCliente(m: Motor, merc: Ator, chegou: () => boolean, podeBeber: boolean, longe: () => boolean, soRespira = false): Roteiro {
  m.mercadorLivre = true
  let bebeu = !podeBeber || soRespira
  while (!chegou()) {
    if (m.chamado) {
      yield* atenderChamado(m, merc)
      continue
    }
    if (soRespira) {
      yield* respirar(m, merc, 2360, chegou)
      continue
    }
    const r = m.rand()
    if (!bebeu && r < 0.35 && longe()) {
      bebeu = true
      yield* beber(m, merc)
    } else if (r < 0.6) yield* olhar(m, merc, chegou)
    else yield* respirar(m, merc, 2360, chegou)
  }
  if (m.chamado) yield* atenderChamado(m, merc)
  m.mercadorLivre = false
  m.fase = 'ato'
  m.tocar(merc, 'parado')
}

/* ───────────── os clientes ───────────── */

/** O mercador está com a lata na mão (o cliente espera ele guardar para entrar). */
const bebendo = (merc: Ator) => merc.anim === 'beber' && !merc.acabou

/**
 * Onde o cliente entra: fora da tela, do lado para onde o mercador olha. Já entrando (story), colado na beira: o quadro
 * inteiro ainda fora (o primeiro quadro da rua é o pôster), mas aparece no primeiro passo.
 */
function entrada(m: Motor, lado: Lado, folga: number, jaEntrando = false, quem?: string): number {
  const v = m.palco.visivel
  if (jaEntrando && quem) {
    const f = m.folha(quem)
    // ele olha para o mercador: entrando pela direita, olha para a esquerda (e vice-versa)
    return lado === 'dir' ? v.x1 + (f.w - f.ancora.x) + 1 : v.x0 - (f.w - f.ancora.x) - 1
  }
  return lado === 'dir' ? v.x1 + folga : v.x0 - folga
}

/**
 * Story: o mercador responde quando a fala do cliente (a última, agora) deu tempo de ler, sem parar o que está fazendo.
 * Se chamaram ele nesse meio-tempo, fica o balão do chamado.
 */
function responder(m: Motor, merc: Ator, texto: string, ms: number) {
  const em = m.t + LER
  m.lancar(
    (function* (): Roteiro {
      yield () => m.t >= em
      if (!m.baloes.some((b) => b.ator === merc.id)) m.falar(merc, texto, ms)
    })(),
  )
}

/**
 * Story: antes de o cliente abrir a conversa, a fala que está na tela (o "Sextou!" do mercador chegando ao ponto, o
 * chamado) fica pelo menos LER: ele não fala por cima dela antes de dar para ler.
 */
function* vez(m: Motor, v: { story: boolean }): Roteiro {
  const b = m.baloes[0]
  if (!v.story || !b) return
  const ate = b.de + LER
  yield () => m.t >= ate || !m.baloes.length
}

/** Roda um roteiro em paralelo e devolve quando ele acabou. */
function emParalelo(m: Motor, gen: Roteiro): () => boolean {
  const h = m.lancar(gen)
  return () => !h.vivo()
}

function* atoSkatista(m: Motor, merc: Ator, v: Vez): Ato {
  const { lado, bebe } = v
  const d = distancia(m, 'passar', 'oferece', 'skatista', 'pegar', 'pega')
  const xc = v.ponto + (lado === 'dir' ? d : -d)
  const sk = m.criar('skatista', { x: entrada(m, lado, 30, v.jaEntrando, 'skatista'), y: m.chao.meio, lado: oposto(lado), sombra: true, anim: 'parado', prof: m.chao.meio + 0.2, visivel: false })
  const FREIO = 13
  let chegou = false
  m.lancar(
    (function* (): Roteiro {
      // chega rápido: só depois que o mercador parou no ponto (e um respiro; já entrando, sem respiro)
      yield () => m.fase === 'ponto' && v.livre()
      if (!v.jaEntrando) yield 300 + Math.round(m.rand() * 1200)
      yield () => !bebendo(merc)
      sk.visivel = true
      yield* anda(m, sk, xc + (lado === 'dir' ? FREIO : -FREIO), 'rodar', { reage: true })
      sk.alvo = xc
      yield* anima(m, sk, 'frear')
      sk.alvo = null
      m.tocar(sk, 'parado')
      chegou = true
    })(),
  )
  yield* v.vida
  yield* esperarCliente(m, merc, () => chegou, !bebe, () => !sk.visivel, v.jaEntrando)
  yield* vez(m, v)
  m.falar(sk, sortear(FALAS.skatista.pedir, m.rand), 1900)
  const oferta = sortear(falasSem(FALAS.mercador.oferecer, v.evitar), m.rand)
  if (v.story) {
    // no story ele já abre o casaco ouvindo e responde quando a pergunta deu tempo de ler
    responder(m, merc, oferta, 1500)
    yield* espera(m, sk, 300)
  } else {
    yield* espera(m, sk, 1500)
    m.falar(merc, oferta, 1500)
  }
  yield* anima(m, merc, 'abrir')
  m.tocar(merc, 'mostrar')
  m.tocar(sk, 'apontar')
  // no story o mercador já fecha o casaco enquanto ele baixa o braço
  yield () => sk.acabou || (v.story && sk.i >= 5)
  if (sk.acabou) m.tocar(sk, 'parado')
  else
    m.lancar(
      (function* (): Roteiro {
        yield () => sk.acabou
        m.tocar(sk, 'parado')
      })(),
    )
  yield* anima(m, merc, 'fechar')
  yield* passar(m, merc, sk, 'seda')
  if (!v.story) yield* espera(m, sk, 250)
  // no story ele não espera o mercador guardar a nota: o "valeu" dele (um balão só, que dá tempo de ler) já saindo
  yield* pagar(m, merc, sk, v.story)
  m.tocar(sk, 'parado')
  if (!v.story) {
    m.falar(merc, sortear(FALAS.mercador.agradecer, m.rand), 1500)
    m.tocar(merc, 'aprovar')
    yield* espera(m, sk, 600)
  }
  m.falar(sk, sortear(FALAS.skatista.valeu, m.rand), 1300)
  // sai: volta por onde veio ou segue em frente; seguindo, desce para a beira da calçada enquanto sobe e rema (passa
  // na frente do mercador, mais perto de quem olha, como a moto) e só dá o ollie depois de passar por ele. No story,
  // volta por onde veio, já saindo enquanto o mercador termina o joia, e o "valeu" vai com ele até o fim do tempo dele
  const sair = function* (): Roteiro {
    if (!v.story) {
      yield* espera(m, sk, 500)
      m.calar(sk)
    }
    const segue = !v.story && m.rand() < 0.5
    if (!segue) sk.lado = lado
    sk.prof = m.chao.meio + 0.6
    if (segue) sk.alvoY = m.chao.beira
    yield* anima(m, sk, 'subir')
    if (!v.story) yield* anima(m, sk, 'remar', { vezes: 2 })
    if (segue) {
      const passou = () => {
        const [mx0, , mx1] = m.caixa(merc)
        const [sx0, , sx1] = m.caixa(sk)
        return sk.lado === 'dir' ? sx0 > mx1 + 2 : sx1 < mx0 - 2
      }
      m.tocar(sk, 'rodar')
      while (!passou() && !fora(m, sk)) {
        yield () => passou() || fora(m, sk) || sk.querReagir
        if (sk.querReagir && !passou()) sk.querReagir = false
      }
    }
    yield* anima(m, sk, 'ollie')
    m.tocar(sk, 'rodar')
    while (!fora(m, sk)) {
      yield* ouvindo(sk, () => fora(m, sk) || sk.querReagir)
      if (sk.querReagir) {
        yield* reage(m, sk, 'rodar')
      }
    }
    m.remover(sk)
  }
  const saiu = v.story ? emParalelo(m, sair()) : null
  if (v.story) {
    // o mercador termina de guardar a nota e faz o joia para ele
    yield () => merc.acabou
    m.tocar(merc, 'aprovar')
  }
  yield () => merc.acabou
  m.tocar(merc, 'parado')
  return saiu ?? emParalelo(m, sair())
}

function* atoMotoboy(m: Motor, merc: Ator, v: Vez): Ato {
  const { lado } = v
  yield* v.vida
  // o mercador vai até o meio-fio esperar a moto (quem estava antes já foi)
  m.mercadorLivre = true
  // já entrando (story), um respiro curto: o primeiro quadro é o dele parado, o mesmo do pôster
  yield* batida(m, merc, () => respirar(m, merc, v.jaEntrando ? 200 : 600))
  while (!v.livre()) yield* batida(m, merc, () => respirar(m, merc, 800))
  yield* anda(m, merc, merc.x + (lado === 'dir' ? 4 : -4), 'andar', { y: m.chao.beira, chamavel: m })
  m.mercadorLivre = false
  m.fase = 'ato'
  merc.lado = lado
  m.tocar(merc, 'parado')
  const d = distancia(m, 'passar', 'oferece', 'motoboy', 'pegar', 'pega')
  const xc = merc.x + (lado === 'dir' ? d : -d)
  const mb = m.criar('motoboy', { x: entrada(m, lado, 40, v.jaEntrando, 'motoboy'), y: m.chao.moto, lado: oposto(lado), sombra: true, anim: 'parado' })
  const FREIO = 13
  yield* anda(m, mb, xc + (lado === 'dir' ? FREIO : -FREIO), 'chegar')
  mb.alvo = xc
  yield* anima(m, mb, 'encostar')
  mb.alvo = null
  yield* espera(m, mb, pausa(v, 350, 200))
  yield* anima(m, mb, 'abrirViseira')
  yield* vez(m, v)
  m.falar(mb, sortear(FALAS.motoboy.pedir, m.rand), 1700)
  const entrega = sortear(FALAS.mercador.entregar, m.rand)
  if (v.story) {
    // no story o mercador já tira a sacola com o pedido ainda na tela e responde quando deu tempo de ler
    responder(m, merc, entrega, 1300)
    yield 900
  } else {
    yield 1300
    m.falar(merc, entrega, 1300)
    yield 300
  }
  // a sacola pela alça (pega 4,1); o motoboy, sentado, pega por baixo (4,10)
  yield* passar(m, merc, mb, 'sacola', { pegaNaBase: [4, 10] })
  yield* anima(m, mb, 'fecharViseira')
  m.falar(merc, sortear(FALAS.mercador.motoboy, m.rand), 1500)
  m.tocar(merc, 'acenar')
  yield* anima(m, mb, 'reagir')
  mb.querReagir = false
  m.falar(mb, sortear(FALAS.motoboy.valeu, m.rand), 1200)
  yield pausa(v, 800, 350)
  const saiu = emParalelo(
    m,
    (function* (): Roteiro {
      // segue em frente, passando na frente do mercador (a moto está mais perto de quem olha). No story volta por onde
      // veio, com o "valeu" indo junto até o fim do tempo do balão (sem passar por cima do rosto do mercador)
      if (v.story) mb.lado = lado
      else m.calar(mb)
      yield* anima(m, mb, 'sair')
      m.tocar(mb, 'chegar')
      yield () => fora(m, mb)
      m.remover(mb)
    })(),
  )
  yield () => merc.acabou
  m.tocar(merc, 'parado')
  return saiu
}

function* atoMC(m: Motor, merc: Ator, v: Vez): Ato {
  const { lado, bebe } = v
  const d = distancia(m, 'toque', 'toque1', 'mc', 'toque', 'toque1')
  const xc = v.ponto + (lado === 'dir' ? d : -d)
  const mc = m.criar('mc', { x: entrada(m, lado, 24, v.jaEntrando, 'mc'), y: m.chao.meio, lado: oposto(lado), sombra: true, anim: 'parado', prof: m.chao.meio + 0.2, visivel: false })
  let chegou = false
  m.lancar(
    (function* (): Roteiro {
      // vem no beat enquanto o mercador volta para o ponto
      yield () => (m.fase === 'rumo' || m.fase === 'ponto') && v.livre() && !bebendo(merc)
      mc.visivel = true
      yield* anda(m, mc, xc, 'chegar', { reage: true })
      m.tocar(mc, 'parado')
      chegou = true
    })(),
  )
  yield* v.vida
  yield* esperarCliente(m, merc, () => chegou, !bebe, () => !mc.visivel, v.jaEntrando)
  yield* vez(m, v)
  m.falar(mc, sortear(FALAS.mc.chegar, m.rand), 1600)
  yield* espera(m, mc, pausa(v, 1200, LER))
  m.falar(merc, sortear(FALAS.mercador.mc, m.rand), 1200)
  yield* espera(m, mc, pausa(v, 600, 100))
  yield* toque(m, merc, mc)
  m.tocar(merc, 'parado')
  m.falar(mc, sortear(FALAS.mc.pedir, m.rand), 1600)
  yield* espera(m, mc, pausa(v, 1300, LER))
  m.falar(merc, sortear(FALAS.mercador.entregar, m.rand), 1200)
  // pega a Arizona e fica com ela erguida (o último quadro do pegar segura a lata na altura do rosto)
  yield* passar(m, merc, mc, 'lataArizona')
  m.falar(mc, sortear(FALAS.mc.valeu, m.rand), 1400)
  // volta por onde veio, dançando (não atravessa o mercador); no story, já saindo enquanto o mercador ri (uma volta de
  // dança e sai no passo do beat), com o "valeu" indo junto até o fim do tempo do balão
  const sair = function* (): Roteiro {
    if (!v.story) {
      yield 300
      m.calar(mc)
    }
    mc.lado = lado
    m.tocar(mc, 'sair')
    let passo = 'sair'
    if (v.story) {
      const fim = m.t + mc.folha.anims.sair.duracao
      yield () => m.t >= fim || fora(m, mc)
      passo = 'chegar'
      m.tocar(mc, passo)
    }
    while (!fora(m, mc)) {
      yield* ouvindo(mc, () => fora(m, mc) || mc.querReagir)
      if (mc.querReagir) yield* reage(m, mc, passo)
    }
    m.remover(mc)
  }
  const saiu = v.story ? emParalelo(m, sair()) : null
  yield* anima(m, merc, 'rir')
  m.tocar(merc, 'parado')
  return saiu ?? emParalelo(m, sair())
}

function* atoTurista(m: Motor, merc: Ator, v: Vez): Ato {
  const { lado, bebe } = v
  const d = distancia(m, 'passar', 'oferece', 'turista', 'pegar', 'pega')
  const xc = v.ponto + (lado === 'dir' ? d : -d)
  const tu = m.criar('turista', { x: entrada(m, lado, 24, v.jaEntrando, 'turista'), y: m.chao.meio, lado: oposto(lado), sombra: true, anim: 'parado', prof: m.chao.meio + 0.2, visivel: false })
  let chegou = false
  m.lancar(
    (function* (): Roteiro {
      // anda de pato, devagar: entra enquanto o mercador ainda volta para o ponto
      yield () => (m.fase === 'rumo' || m.fase === 'ponto') && v.livre() && !bebendo(merc)
      tu.visivel = true
      // lendo o mapa, quase esbarra: abaixa o mapa, se assusta, guarda o mapa
      yield* anda(m, tu, xc, 'chegar', { reage: true })
      yield* anima(m, tu, 'espantar')
      m.tocar(tu, 'parado')
      chegou = true
    })(),
  )
  yield* v.vida
  yield* esperarCliente(m, merc, () => chegou, !bebe, () => !tu.visivel, v.jaEntrando)
  yield* vez(m, v)
  m.falar(tu, sortear(FALAS.turista.pedir, m.rand), 1900)
  yield* espera(m, tu, pausa(v, 1500, LER))
  m.falar(merc, sortear(falasSem(FALAS.mercador.turista, v.evitar), m.rand), 1400)
  yield* anima(m, merc, 'abrir')
  m.tocar(merc, 'mostrar')
  yield* espera(m, tu, 300)
  // a foto do mercador de casaco aberto (o flash estoura na lente)
  yield* anima(m, tu, 'foto')
  m.tocar(tu, 'parado')
  yield* anima(m, merc, 'fechar')
  m.tocar(merc, 'parado')
  m.falar(tu, sortear(FALAS.turista.piteira, m.rand), 1600)
  yield* espera(m, tu, pausa(v, 1200, 700))
  yield* passar(m, merc, tu, 'piteira')
  yield* espera(m, tu, 200)
  yield* pagar(m, merc, tu)
  m.tocar(tu, 'parado')
  m.falar(tu, sortear(FALAS.turista.valeu, m.rand), 1400)
  yield* espera(m, tu, pausa(v, 700, LER))
  m.falar(merc, sortear(FALAS.mercador.agradecer, m.rand), 1400)
  yield* anima(m, merc, 'aprovar')
  m.tocar(merc, 'parado')
  return emParalelo(
    m,
    (function* (): Roteiro {
      // sai feliz por onde veio (não atravessa o mercador)
      m.calar(tu)
      tu.lado = lado
      m.tocar(tu, 'sair')
      while (!fora(m, tu)) {
        yield* ouvindo(tu, () => fora(m, tu) || tu.querReagir)
        if (tu.querReagir) yield* reage(m, tu, 'sair')
      }
      m.remover(tu)
    })(),
  )
}

const ATOS: Record<Cliente, (m: Motor, merc: Ator, v: Vez) => Ato> = {
  skatista: atoSkatista,
  motoboy: atoMotoboy,
  mc: atoMC,
  turista: atoTurista,
}

/* ───────────── efeitos dos eventos ───────────── */

/** Pontos de onde saem os efeitos, no quadro olhando para a direita. */
const LENTE = { foto: [31, 21], reagir: [31, 18] } as const
const TRASEIRA_MOTO = [3, 47] as const
const FONE_MC = [10, 14] as const

/** Um efeito em (x, y), subindo `sobe` px, passaria por cima do letreiro (a marca da loja na cena)? */
function sobreLetreiro(m: Motor, efeito: string, x: number, y: number, sobe: number): boolean {
  const l = m.ator('letreiro')
  if (!l) return false
  const [lx0, ly0, lx1, ly1] = m.caixa(l)
  const f = m.folha(efeito)
  return x < lx1 && x + f.w > lx0 && y - sobe < ly1 && y + f.h > ly0
}

function efeitos(m: Motor, a: Ator, ev: string) {
  const [cx, cy] = m.canto(a)
  const xDo = (x: number) => cx + (a.lado === 'dir' ? x : a.folha.w - 1 - x)
  if (a.id === 'turista' && ev === 'flash') {
    const [lx, ly] = a.anim === 'foto' ? LENTE.foto : LENTE.reagir
    m.efeito('flash', xDo(lx) - 5, cy + ly - 5)
  } else if (a.id === 'motoboy' && ev === 'arranca') {
    // as linhas ficam no chão onde a moto arrancou e somem; a ponta encosta na traseira
    const tx = xDo(TRASEIRA_MOTO[0])
    m.efeito('velocidade', a.lado === 'dir' ? tx - 16 : tx + 1, cy + TRASEIRA_MOTO[1] - 3, a.lado)
  } else if (a.id === 'mc' && ev === 'nota') {
    const nota = m.rand() < 0.5 ? 'colcheia' : 'semicolcheia'
    const x = xDo(FONE_MC[0]) - 2
    const y = cy + FONE_MC[1] - 6
    // perto da porta a nota não sai: subindo (1 px a cada 110 ms por 900 ms) ela passaria por cima do GC em neon
    if (!sobreLetreiro(m, nota, x, y, Math.ceil(900 / 110))) m.efeito(nota, x, y, 'dir', 110, 900)
  } else if (a.id === 'mercador' && ev === 'carinho') {
    const gato = m.ator('gato')
    if (gato)
      m.lancar(
        (function* (): Roteiro {
          yield* anima(m, gato, 'carinho')
          m.tocar(gato, 'parado')
        })(),
      )
  }
}

/* ───────────── o diretor ───────────── */

function embaralhar<T>(lista: readonly T[], rand: () => number): T[] {
  const l = [...lista]
  for (let i = l.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[l[i], l[j]] = [l[j], l[i]]
  }
  return l
}

function* diretor(m: Motor, merc: Ator, gato: Ator, op: OpcoesCena): Roteiro {
  const L = m.lugar
  const saco: Saco = op.saco ?? { fila: [], ultimo: null }
  let bebeu = false
  let carinhou = false
  let primeira = true
  let saiu: () => boolean = () => true
  while (true) {
    // saco embaralhado: os quatro passam antes de alguém voltar, e nunca o mesmo duas vezes seguidas
    if (!saco.fila.length) saco.fila = embaralhar(CLIENTES, m.rand)
    const fila = saco.fila
    if (primeira && op.primeiro) {
      const i = fila.indexOf(op.primeiro)
      fila.unshift(i >= 0 ? fila.splice(i, 1)[0] : op.primeiro)
    }
    // na primeira, um que chega rápido (o turista andando de pato leva uns segundos para entrar); no story, o skatista
    // ou o motoboy, os que cabem com folga nos ~12 s do segmento em todo celular (o MC e o turista vêm depois), e
    // nunca o último da cena de antes (o saco continua): a regra de não repetir não empurra ele para o fim
    else if (primeira && op.story) {
      const rapido = (c: Cliente) => (c === 'skatista' || c === 'motoboy') && c !== saco.ultimo
      const i = fila.findIndex(rapido)
      if (i > 0) fila.unshift(fila.splice(i, 1)[0])
      else if (i < 0) fila.unshift(saco.ultimo === 'skatista' ? 'motoboy' : saco.ultimo === 'motoboy' ? 'skatista' : m.rand() < 0.5 ? 'skatista' : 'motoboy')
    } else if (primeira && fila[0] === 'turista') fila.push(fila.shift()!)
    if (fila[0] === saco.ultimo && fila.length > 1) fila.push(fila.shift()!)
    const cliente = fila.shift()!
    const anterior = saco.ultimo
    saco.ultimo = cliente
    const lado: Lado = primeira ? 'dir' : m.rand() < 0.5 ? 'dir' : 'esq'
    const ponto = lado === 'dir' ? L.pontoEsq : L.pontoDir
    // bebe a Fanta uma vez sim, outra não (e às vezes esperando o cliente, quando não bebeu antes)
    const bebe: boolean = !primeira && !bebeu
    // carinho no gato no máximo uma vez sim, outra não
    const carinho: boolean = !primeira && !carinhou && m.rand() < 0.6
    // o motoboy sai com o aceno do mercador: não acena de novo
    const story = !!op.story
    const vida = interludio(m, merc, gato, ponto, lado, { curto: primeira, bebe, carinho, acenou: anterior === 'motoboy', story })
    // story: o primeiro já vem entrando (o segmento tem ~12 s para um atendimento inteiro)
    const jaEntrando = primeira && story
    bebeu = bebe
    carinhou = carinho
    primeira = false
    // o próximo só entra quando o de antes saiu da tela: um cliente por vez
    const antes = saiu
    saiu = yield* ATOS[cliente](m, merc, { lado, ponto, bebe, vida, livre: antes, jaEntrando, story, evitar: op.evitar })
  }
}

/** O gato nos engradados: parado, e no toque empina a cabeça (o mesmo carinho). */
function* vidaDoGato(m: Motor, gato: Ator): Roteiro {
  while (true) {
    yield* ouvindo(gato, () => gato.querReagir)
    gato.querReagir = false
    if (gato.anim === 'carinho' && !gato.acabou) continue
    yield* anima(m, gato, 'carinho')
    m.tocar(gato, 'parado')
  }
}

/* ───────────── montagem ───────────── */

/**
 * O que o chamado fez: `agora` (ele está livre: abre o casaco assim que termina o gesto), `depois` (está atendendo:
 * abre no fim do atendimento) ou `foto` (movimento reduzido: só o balão; ele já está de casaco aberto na foto).
 */
export type Chamado = 'agora' | 'depois' | 'foto'

export interface Cena {
  merc: Ator
  /** Toque ou teclado no mercador: o balão sai na hora; o casaco abre quando ele puder. */
  chamar(longo: boolean): Chamado
  /**
   * Toque na cena (px da grade): quem foi tocado reage. Devolve o id, ou null. `soNaHora` (story): só vale quem reage
   * agora; ocupado (pegando, pagando), o toque não fica na fila e devolve null (o story passa).
   */
  tocar(x: number, y: number, folga: number, soNaHora?: boolean): string | null
}

/**
 * Uma lista de falas sem a que o adesivo do story já diz (no balão, seria eco). A mesma lista a cada vez (o sortear
 * lembra a última dita de cada lista).
 */
const semEco = new Map<string, readonly string[]>()
function falasSem(lista: readonly string[], evitar?: string): readonly string[] {
  if (!evitar || !lista.includes(evitar)) return lista
  const chave = `${lista.join('|')}#${evitar}`
  let l = semEco.get(chave)
  if (!l) {
    const sem = lista.filter((f) => f !== evitar)
    l = sem.length ? sem : lista
    semEco.set(chave, l)
  }
  return l
}

/** As falas do chamado: a longa só onde o balão cabe em duas linhas. */
const CHAMADO_LONGO: readonly string[] = [...FALAS.mercador.chamado, ...FALAS.mercador.chamadoLongo]
const falasDoChamado = (longo: boolean, evitar?: string) => falasSem(longo ? CHAMADO_LONGO : FALAS.mercador.chamado, evitar)

/**
 * A rua parada: o cenário que mexe, o gato nos engradados e o mercador no ponto da esquerda, olhando para a direita,
 * no quadro 0 de cada um. É o primeiro quadro da rua viva (e da foto) e, no build, o pôster do story.
 */
export function montarElenco(m: Motor): { merc: Ator; gato: Ator } {
  const L = m.lugar
  m.montarCenario()
  const ladoGato: Lado = L.engradado > L.porta ? 'esq' : 'dir'
  const gato = m.criar('gato', { x: L.engradado + (ladoGato === 'esq' ? 1 : -1), y: m.chao.fundo - 20, prof: m.chao.fundo + 0.1, lado: ladoGato, anim: 'parado' })
  const merc = m.criar('mercador', { x: L.pontoEsq, y: m.chao.meio, sombra: true, anim: 'parado', prof: m.chao.meio + 0.1 })
  return { merc, gato }
}

/** A rua viva: cenário, mercador, gato e o diretor. */
export function montarCena(m: Motor, op: OpcoesCena = {}): Cena {
  const { merc, gato } = montarElenco(m)
  m.aoEvento = (a, ev) => efeitos(m, a, ev)
  m.lancar(diretor(m, merc, gato, op))
  m.lancar(vidaDoGato(m, gato))
  return {
    merc,
    chamar(longo) {
      m.falar(merc, sortear(falasDoChamado(longo, op.evitar), m.rand), 3200)
      // guardado sempre: livre, ele atende no próximo respiro; atendendo, no começo da vida depois do cliente
      // (interludio e motoboy passam por batida/atenderChamado antes de qualquer outra coisa)
      const livre = m.mercadorLivre
      m.chamado = true
      return livre ? 'agora' : 'depois'
    },
    tocar(x, y, folga, soNaHora = false) {
      const a = m.quemEsta(x, y, folga)
      if (!a) return null
      if (a.id === 'mercador') {
        this.chamar(false)
        return a.id
      }
      // o gato no meio do carinho não ouve (o roteiro dele descarta o toque)
      if (soNaHora && (!a.ouve || (a.anim === 'carinho' && !a.acabou))) return null
      a.querReagir = true
      return a.id
    },
  }
}

/**
 * Movimento reduzido: a rua vira uma foto — o mercador de casaco aberto atendendo o skatista, que aponta "esse aí",
 * o gato nos engradados e o letreiro aceso. Ninguém anda.
 */
export function montarRetrato(m: Motor, op: Pick<OpcoesCena, 'evitar'> = {}): Cena {
  const L = m.lugar
  // o quadro 0 de cada um: letreiro aceso, luz firme
  const { merc } = montarElenco(m)
  m.pose(merc, 'mostrar', 0, 'dir')
  const d = distancia(m, 'passar', 'oferece', 'skatista', 'pegar', 'pega')
  const sk = m.criar('skatista', { x: L.pontoEsq + d, y: m.chao.meio, sombra: true, lado: 'esq', prof: m.chao.meio + 0.2 })
  const ap = sk.folha.anims.apontar.q.findIndex((q) => q.evento === 'aponta')
  m.pose(sk, 'apontar', Math.max(0, ap), 'esq')
  // a foto já vem com o "Chega mais." dele (o relógio não anda: o balão fica); no story, que tem o "Chega mais." no
  // adesivo do pé, com a outra fala
  m.falar(merc, falasDoChamado(false, op.evitar)[0], 60_000)
  return {
    merc,
    chamar(longo) {
      m.falar(merc, sortear(falasDoChamado(longo, op.evitar), m.rand), 60_000)
      return 'foto'
    },
    tocar(x, y, folga) {
      const a = m.quemEsta(x, y, folga)
      if (a?.id === 'mercador') this.chamar(false)
      return a?.id ?? null
    },
  }
}
