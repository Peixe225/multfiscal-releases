import { useEffect, useId, useLayoutEffect, useRef, useState, type ChangeEvent, type CSSProperties, type FormEvent, type KeyboardEvent, type MouseEvent, type Ref, type RefObject } from 'react'
import { canalDa, type Canal } from '../../dados/canais'
import { alvoDeSaida } from '../../lib/ambiente'
import { irParaAba } from '../../lib/abas'
import { useConta } from '../../lib/conta'
import { copiarTexto } from '../../lib/copiar'
import { brl } from '../../lib/formato'
import { depoisDoHistorico } from '../../lib/historico'
import { linkWhatsApp, montarRateio, whatsappDoCanal } from '../../lib/mensagem'
import { movimentoReduzido } from '../../lib/movimento'
import type { FalhaRateio, Rateio } from '../../lib/rateio-api'
import { recuperarPendente } from '../../lib/minhas-vagas'
import { entrarNoRateio, novoToken } from '../../lib/rateio-vagas'
import { celularNoCampo, editarCelular, normalizarCelular, validarCelular } from '../../lib/telefone'
import { useChat } from '../../store/chat'
import { useLocal } from '../../store/local'
import { agoraRateio, carregarRateios, guardarPendente, guardarVaga, pendenteDe, tirarPendente, trocarRateio, useRateio, zapDoDono, type EntradaPendente, type VagaGuardada } from '../../store/rateio'
import { useUI } from '../../store/ui'
import { Icone } from '../comum'
import { NOME_VAGA, ateQuando, contaVagas, guardadaTexto, listaUfs, statusVisto, total, vagaDoAparelho, vagasTexto } from './util'

// Entrar no rateio, na página dele. Com o servidor: nome + WhatsApp (+ estado, cidade quando precisa, quantidade) →
// POST rateio-entrar → a vaga fica reservada na hora, com código, e a tela de "Tá no rateio!" leva pro WhatsApp da
// loja com a mensagem pronta (o Pix aqui no site fica "Em breve", como no pedido). Sem servidor aqui (o arquivo único,
// o zip sem api/): o mesmo formulário vira "Entrar pelo WhatsApp", sem código, e a loja confirma a vaga por lá.
// A resposta do POST pode se perder (3G, hospedagem lenta) DEPOIS de o servidor gravar a vaga: o token vai junto,
// gerado aqui e guardado antes de enviar (EntradaPendente); a nova tentativa usa o mesmo token, e um ja-participa
// pergunta ao minhas-vagas por ele antes de dizer que o WhatsApp já está no rateio. Sem resposta, nada de mandar pro
// WhatsApp sem código de cara: primeiro "tenta de novo" (o servidor nunca dá duas vagas pro mesmo WhatsApp).
// Já tem vaga ativa neste aparelho nesse rateio: mostra a vaga (e, enquanto sobra vaga, deixa entrar com outro
// WhatsApp, pra um amigo; a vaga do amigo fica marcada e não preenche o formulário nem vira "Tua vaga").

const limparNome = (v: string) => v.replace(/\s+/g, ' ').trim()

type CampoErro = 'nome' | 'whatsapp' | 'uf' | 'cidade' | 'quantidade'

/** Fecha a página e leva até "Minhas vagas" na aba Rateio. */
export function verMinhasVagas() {
  useUI.getState().fecharRateio()
  depoisDoHistorico(() => {
    const ir = () => {
      const el = document.getElementById('minhas-vagas')
      if (!el) return
      el.scrollIntoView({ block: 'start', behavior: movimentoReduzido() ? 'auto' : 'smooth' })
      el.focus({ preventScroll: true })
    }
    if (useUI.getState().aba !== 'rateio') {
      irParaAba('rateio', { foco: 'nenhum' })
      window.setTimeout(ir, 120)
    } else requestAnimationFrame(ir)
  })
}

/** Botão do WhatsApp da loja: link montado antes do toque, sem target no celular; "Não abriu?" com cópia e número. */
function BotaoZap({
  canal,
  texto,
  rotulo,
  aoTocar,
  refBotao,
  contorno = false,
}: {
  canal: Canal
  texto: string
  rotulo: string
  aoTocar?: (e: MouseEvent<HTMLAnchorElement>) => void
  refBotao?: Ref<HTMLAnchorElement>
  /** Segunda opção (o principal é outro botão): contorno no lugar do verde cheio. */
  contorno?: boolean
}) {
  const avisar = useUI((s) => s.avisar)
  const [naoAbriu, setNaoAbriu] = useState(false)
  const alvo = alvoDeSaida()
  return (
    <>
      <a
        ref={refBotao}
        className={`botao ${contorno ? 'botao-contorno' : 'botao-cheio'} botao-largo dm-zap rp-zap`}
        href={linkWhatsApp(canal, texto)}
        target={alvo}
        rel="noopener noreferrer"
        onClick={(e) => {
          aoTocar?.(e)
          if (e.defaultPrevented) return
          setNaoAbriu(false)
          if (!alvo) window.setTimeout(() => document.visibilityState === 'visible' && setNaoAbriu(true), 1600)
        }}
      >
        <span>
          <Icone nome="whatsapp" tamanho={20} className="dm-zap-icone" />
          {rotulo}
        </span>
      </a>
      {naoAbriu && (
        <div className="rp-nao-abriu">
          <p>
            Não abriu? Toca de novo, ou copia o texto e manda pro WhatsApp da loja: <span className="dm-numero">{celularNoCampo(whatsappDoCanal(canal))}</span>.
          </p>
          <button type="button" className="dm-chip toque" onClick={() => avisar(copiarTexto(texto) ? 'Copiado.' : 'Segura no texto da mensagem e copia.')}>
            Copiar texto
          </button>
        </div>
      )}
    </>
  )
}

/** "Pagar com Pix aqui no site" com o carimbo EM BREVE: explica e devolve o foco pro WhatsApp, sem sair do site. */
function PixEmBreve({ zap }: { zap: RefObject<HTMLAnchorElement | null> }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    const a = zap.current
    if (!n || !a) return
    a.focus({ preventScroll: true })
    a.scrollIntoView({ block: 'nearest', behavior: movimentoReduzido() ? 'auto' : 'smooth' })
    a.classList.remove('dm-realce')
    void a.offsetWidth // recomeça o realce a cada toque
    a.classList.add('dm-realce')
    const t = window.setTimeout(() => a.classList.remove('dm-realce'), 1800)
    return () => clearTimeout(t)
  }, [n, zap])
  return (
    <>
      <button type="button" className="botao botao-contorno botao-largo dm-pix toque" onClick={() => setN((x) => x + 1)}>
        <Icone nome="pix" tamanho={20} />
        Pagar com Pix aqui no site
        <span className="carimbo dm-embreve">Em breve</span>
      </button>
      {n > 0 && (
        <p key={n} className="dm-bolha dm-loja rp-pix-resposta" role="status">
          O Pix aqui no site chega em breve, e aí tua vaga confirma sozinha. Por enquanto, fecha no WhatsApp: a loja te passa a chave Pix lá.
        </p>
      )}
    </>
  )
}

/** Mensagem que vai pro WhatsApp, à vista (como o resumo do pedido guiado). */
function Mensagem({ texto }: { texto: string }) {
  return (
    <pre className="rp-mensagem" aria-label="Mensagem que vai pro WhatsApp">
      {texto}
    </pre>
  )
}

/** "Tá no rateio!": código, até quando a vaga fica guardada e o caminho do pagamento. */
function Confirmacao({ vaga, rateio }: { vaga: VagaGuardada; rateio: Rateio }) {
  const avisar = useUI((s) => s.avisar)
  const titulo = useRef<HTMLHeadingElement>(null)
  const zap = useRef<HTMLAnchorElement>(null)
  const canal = canalDa(vaga.uf)!
  const texto = montarRateio({ canal, cidade: vaga.cidade, titulo: vaga.titulo || rateio.titulo, quantidade: vaga.quantidade, precoRateio: vaga.precoRateio, total: vaga.total, codigo: vaga.codigo, nome: vaga.nome, whatsapp: vaga.whatsapp })
  const ate = vaga.expiraEm ? ateQuando(vaga.expiraEm, agoraRateio()) : null
  useLayoutEffect(() => {
    titulo.current?.focus({ preventScroll: true })
    titulo.current?.scrollIntoView({ block: 'center', behavior: 'auto' })
  }, [])
  return (
    <div className="rp-feito">
      <p className="sr-only" role="status" aria-live="polite">
        Tá no rateio! Código {vaga.codigo}. {ate ? `${guardadaTexto(vaga.quantidade)} até ${ate}.` : ''}
      </p>
      <div className="rp-feito-topo">
        <span className="rp-festa" aria-hidden="true">
          {Array.from({ length: 12 }, (_, i) => (
            <i key={i} style={{ '--k': i } as CSSProperties} />
          ))}
        </span>
        <h2 ref={titulo} className="rp-feito-titulo px" tabIndex={-1}>
          Tá no rateio!
        </h2>
      </div>
      <div className="rp-codigo">
        <span className="rp-codigo-rot">Teu código</span>
        <strong className="rp-codigo-valor px">{vaga.codigo}</strong>
        <button type="button" className="rp-copiar toque" onClick={() => avisar(copiarTexto(vaga.codigo) ? 'Código copiado.' : 'Não deu pra copiar. Anota aí.')} aria-label={`Copiar o código ${vaga.codigo}`}>
          <Icone nome="copiar" tamanho={16} />
          Copiar
        </button>
      </div>
      <p className="rp-feito-txt">
        {vagasTexto(vaga.quantidade)} · {brl(vaga.total)}.{' '}
        {ate ? (
          <>
            {guardadaTexto(vaga.quantidade)} até <strong>{ate}</strong>.
          </>
        ) : (
          `${guardadaTexto(vaga.quantidade)} enquanto a loja confirma.`
        )}{' '}
        Fecha o pagamento com a loja no WhatsApp pra confirmar.
      </p>
      <Mensagem texto={texto} />
      <div className="rp-acoes">
        <BotaoZap canal={canal} texto={texto} rotulo="Fechar pagamento no WhatsApp" refBotao={zap} />
        <PixEmBreve zap={zap} />
      </div>
      <button type="button" className="botao-texto toque rp-minhas" onClick={verMinhasVagas}>
        Ver minhas vagas
      </button>
    </div>
  )
}

/** A vaga que este aparelho já tem nesse rateio. `outra` só quando ainda dá pra entrar (sobra vaga, no prazo). */
function TuaVaga({ vaga, rateio, outra }: { vaga: VagaGuardada; rateio: Rateio; outra: (() => void) | null }) {
  const agora = agoraRateio()
  const status = statusVisto(vaga, agora)
  const canal = canalDa(vaga.uf)
  const zap = useRef<HTMLAnchorElement>(null)
  const texto = canal
    ? montarRateio({ canal, cidade: vaga.cidade, titulo: vaga.titulo || rateio.titulo, quantidade: vaga.quantidade, precoRateio: vaga.precoRateio, total: vaga.total, codigo: vaga.codigo, nome: vaga.nome, whatsapp: vaga.whatsapp })
    : null
  return (
    <section className="rp-tua" aria-labelledby="rp-tua-t">
      <h2 id="rp-tua-t" className="rp-secao-titulo">
        Tua vaga
      </h2>
      <p className="rp-tua-linha">
        <span className="px rp-tua-codigo">{vaga.codigo}</span> · {vagasTexto(vaga.quantidade)} · {brl(vaga.total)}
      </p>
      <p className={`mv-status mv-${status}`}>
        <i className="mv-ponto" aria-hidden="true" />
        <strong>{NOME_VAGA[status]}</strong>
        {status === 'confirmado' && ' ✅'}
        {status === 'expirado' && (vaga.quantidade > 1 ? ' — as vagas voltaram' : ' — a vaga voltou')}
        {status === 'reservado' && vaga.expiraEm && (
          <span className="mv-linha">
            {' '}
            · {vaga.quantidade > 1 ? 'guardadas' : 'guardada'} até {ateQuando(vaga.expiraEm, agora)}
          </span>
        )}
      </p>
      {status === 'reservado' && canal && texto && (
        <div className="rp-acoes">
          <BotaoZap canal={canal} texto={texto} rotulo="Fechar pagamento no WhatsApp" refBotao={zap} />
          <PixEmBreve zap={zap} />
        </div>
      )}
      {status === 'confirmado' && <p className="legenda">Paga e confirmada. Quando o rateio fechar, a loja faz o pedido.</p>}
      <div className="rp-tua-mais">
        <button type="button" className="botao-texto toque" onClick={verMinhasVagas}>
          Ver minhas vagas
        </button>
        {outra && (
          <button type="button" className="botao-texto toque" onClick={outra}>
            Entrar com outro WhatsApp
          </button>
        )}
      </div>
    </section>
  )
}

interface Props {
  rateio: Rateio
  /** 'servidor': reserva com código; 'sem-servidor': entra pelo WhatsApp. */
  modo: 'servidor' | 'sem-servidor'
  /** Aceita entrada agora (aberto, no prazo, sobrando vaga, no estado): só aí tem "Entrar com outro WhatsApp". */
  podeEntrar: boolean
}

export function EntrarRateio({ rateio, modo, podeEntrar }: Props) {
  const vagas = useRateio((s) => s.vagas)
  const conta = useConta()
  const minha = vagaDoAparelho(vagas, rateio.id, agoraRateio(), zapDoDono(vagas, conta?.whatsapp))
  const [outra, setOutra] = useState(false)
  const [feita, setFeita] = useState<VagaGuardada | null>(null)
  if (feita) return <Confirmacao vaga={feita} rateio={rateio} />
  if (minha && !outra) return <TuaVaga vaga={minha} rateio={rateio} outra={podeEntrar ? () => setOutra(true) : null} />
  return <Formulario rateio={rateio} modo={modo} aoEntrar={setFeita} paraOutro={outra} />
}

/** O que o formulário sabe além do erro: quantas tentativas ficaram sem resposta e se o ja-participa é da vaga perdida. */
interface ContextoErro {
  semResposta: number
  /** ja-participa logo depois de uma tentativa sem resposta: a vaga é quase certo desta pessoa. */
  perdida: boolean
}

/** Mensagem curta e humana para cada erro do servidor (o campo, quando é de um campo). */
function textoDoErro(e: FalhaRateio, r: Rateio, uf: string | null, ctx: ContextoErro): string {
  switch (e.erro) {
    case 'invalido':
      // só chega aqui sem campo do formulário (o rateio, a armadilha, um campo novo): a frase do servidor, ou a nossa
      return e.mensagem ?? 'Não deu pra reservar: confere os dados e tenta de novo.'
    case 'nao-encontrado':
      return 'Esse rateio saiu do ar.'
    case 'fora-do-estado': {
      const UF = uf?.toUpperCase()
      // a lista do aparelho pode estar velha (ainda dizendo que vale pra esse estado): vale o que o servidor mandou
      if (e.ufs?.length) return `Esse rateio não vale pra ${UF ?? 'esse estado'}. Vale pra ${listaUfs(e.ufs)}.`
      if (uf && r.ufs.includes(uf)) return `Esse rateio não vale mais pra ${UF}.`
      return `Esse rateio não vale pra ${UF ?? 'esse estado'}. Vale pra ${listaUfs(r.ufs)}.`
    }
    case 'rateio-fechado':
      return 'Esse rateio não aceita mais entrada: fechou ou o prazo acabou.'
    case 'sem-vagas':
      return e.disponiveis ? `Só ${e.disponiveis === 1 ? 'sobrou 1 vaga' : `sobraram ${e.disponiveis} vagas`}. A quantidade já foi ajustada: é só mandar de novo.` : 'Lotou: as vagas acabaram de ser pegas.'
    case 'limite-por-pessoa':
      return `Cada WhatsApp pega até ${vagasTexto(e.limite ?? r.limitePorPessoa)} nesse rateio.`
    case 'ja-participa':
      return ctx.perdida
        ? `Tua vaga ficou guardada${e.codigo ? ` (código ${e.codigo})` : ''}, mas a resposta da loja se perdeu no caminho. Fala com a loja pra confirmar e pagar.`
        : `Esse WhatsApp já está nesse rateio${e.codigo ? ` (código ${e.codigo})` : ''}.`
    case 'muitas-tentativas':
      return 'Muita tentativa seguida. Espera uns minutos e tenta de novo.'
    case 'sem-servidor':
    case 'fora-do-ar':
      return ctx.semResposta >= 2
        ? 'Ainda sem resposta da loja. Tenta de novo daqui a pouco ou entra pelo WhatsApp: se a vaga já tiver ficado guardada, a loja acha ela pelo teu número.'
        : 'A conexão caiu antes da resposta da loja, e a vaga pode ter ficado guardada. Tenta de novo que a gente confere: o mesmo WhatsApp nunca pega vaga duas vezes.'
    default:
      return 'Deu ruim do lado da loja. Tenta de novo em instantes.'
  }
}

/** Erros que dizem que a lista do aparelho está velha (contador, estados, prazo, uma vaga que entrou): busca de novo. */
const RECARREGA = ['sem-vagas', 'rateio-fechado', 'nao-encontrado', 'limite-por-pessoa', 'fora-do-estado', 'invalido', 'ja-participa']

function Formulario({ rateio: r, modo, aoEntrar, paraOutro }: { rateio: Rateio; modo: Props['modo']; aoEntrar: (v: VagaGuardada) => void; paraOutro: boolean }) {
  const uid = useId()
  const conta = useConta()
  // o dono do aparelho: a vaga mais nova que não foi feita pra um amigo (a do amigo nunca preenche o formulário)
  const dono = useRateio((s) => s.vagas.find((v) => !v.paraOutro))
  const zapDono = useRateio((s) => zapDoDono(s.vagas, conta?.whatsapp))
  const focarAoAbrir = paraOutro
  const nomeChat = useChat((s) => s.respostas.nome)
  const ufSite = useLocal((s) => s.uf)
  const cidadeSite = useLocal((s) => s.cidade)
  const informadaSite = useLocal((s) => s.cidadeInformada)
  const ufsComLoja = r.ufs.filter((u) => canalDa(u))
  const [uf, setUf] = useState<string | null>(() => (ufSite && ufsComLoja.includes(ufSite) ? ufSite : ufsComLoja.length === 1 ? ufsComLoja[0] : null))
  // "Entrar com outro WhatsApp" (pra um amigo): começa em branco; senão, vem da conta ou da última vaga do dono
  const [nome, setNome] = useState(() => (focarAoAbrir ? '' : (conta?.nome ?? dono?.nome ?? limparNome(nomeChat ?? ''))))
  const [zap, setZap] = useState(() => (focarAoAbrir ? '' : conta ? celularNoCampo(conta.whatsapp) : dono ? celularNoCampo(dono.whatsapp) : ''))
  const [cidade, setCidade] = useState(() => (ufSite === uf ? (informadaSite ?? '') : ''))
  const [cidadeLista, setCidadeLista] = useState<string | null>(() => (ufSite === uf ? cidadeSite : null))
  const [qtd, setQtd] = useState(1)
  const [armadilha, setArmadilha] = useState('')
  const [tentou, setTentou] = useState(false)
  const [enviando, setEnviando] = useState(false)
  // o POST passou de 5 s: avisa que a conexão está lenta (o limite é 20 s)
  const [lento, setLento] = useState(false)
  const enviandoRef = useRef(false)
  const [erro, setErro] = useState<FalhaRateio | null>(null)
  // tentativas seguidas sem resposta (tempo esgotado, rede caída); a 2ª oferece o WhatsApp
  const [semResposta, setSemResposta] = useState(0)
  const [perdida, setPerdida] = useState(false)
  // o servidor disse quantas sobraram (sem-vagas, pode ser 0) ou qual o limite: o seletor de quantidade obedece, até a
  // lista do aparelho mudar (aí vale a dela: uma reserva vencida devolve vaga)
  const [tetoServidor, setTetoServidor] = useState<{ n: number; disponiveis: number; limite: number } | null>(null)
  const semServidor = modo === 'sem-servidor'
  const [foiPeloZap, setFoiPeloZap] = useState(false)
  const refs = {
    nome: useRef<HTMLInputElement>(null),
    whatsapp: useRef<HTMLInputElement>(null),
    uf: useRef<HTMLDivElement>(null),
    cidade: useRef<HTMLInputElement>(null),
    quantidade: useRef<HTMLDivElement>(null),
  }
  const alerta = useRef<HTMLDivElement>(null)
  const cursorZap = useRef<number | null>(null)
  useLayoutEffect(() => {
    const el = refs.whatsapp.current
    const c = cursorZap.current
    cursorZap.current = null
    if (el && c != null && document.activeElement === el) el.setSelectionRange(c, c)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zap])
  useEffect(() => {
    if (focarAoAbrir) refs.nome.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focarAoAbrir])
  useEffect(() => {
    if (!enviando) return
    const t = window.setTimeout(() => setLento(true), 5000)
    return () => {
      clearTimeout(t)
      setLento(false)
    }
  }, [enviando])

  const canal = canalDa(uf)
  const cidades = canal?.cidades ?? []
  const precisaCidadeTexto = !!canal && cidades.length === 0
  const precisaCidadeLista = cidades.length > 1
  // sem nenhuma vaga sobrando (a lista ou o servidor disse 0): "Vagas tomadas" e o envio trava, nunca "Só sobrou 1 vaga"
  const tetoSrv = tetoServidor && tetoServidor.disponiveis === r.disponiveis && tetoServidor.limite === r.limitePorPessoa ? tetoServidor.n : Infinity
  const tetoBruto = Math.min(r.limitePorPessoa, r.disponiveis, tetoSrv)
  const lotado = !semServidor && tetoBruto <= 0
  const teto = Math.max(1, tetoBruto)
  const q = Math.min(qtd, teto)
  const digitos = normalizarCelular(zap)
  const nomeLimpo = limparNome(nome)
  const cidadeNome = cidades.length === 1 ? cidades[0].nome : precisaCidadeLista ? (cidades.find((c) => c.slug === cidadeLista)?.nome ?? null) : limparNome(cidade) || null
  const erros: Partial<Record<CampoErro, string>> = {}
  if (nomeLimpo.length < 2) erros.nome = 'Põe teu nome (2 letras ou mais).'
  else if (nomeLimpo.length > 60) erros.nome = 'Nome até 60 letras.'
  const erroZap = validarCelular(digitos)
  if (erroZap) erros.whatsapp = erroZap
  if (!uf) erros.uf = 'Escolhe teu estado.'
  if (precisaCidadeTexto && (!cidadeNome || cidadeNome.length < 2)) erros.cidade = 'Qual tua cidade?'
  if (precisaCidadeLista && !cidadeNome) erros.cidade = 'Escolhe tua cidade.'
  // erro de campo que veio do servidor (invalido + um campo deste formulário); invalido sem campo daqui vira alerta
  const erroServidorCampo = erro?.erro === 'invalido' && erro.campo && erro.campo in refs ? (erro.campo as CampoErro) : null
  const mostra = (c: CampoErro) => (tentou && erros[c]) || (erroServidorCampo === c ? (erro?.mensagem ?? 'Confere esse campo.') : null)
  const primeiroErro = (['nome', 'whatsapp', 'uf', 'cidade'] as CampoErro[]).find((c) => erros[c])

  const texto = canal
    ? montarRateio({ canal, cidade: cidadeNome, titulo: r.titulo, quantidade: q, precoRateio: r.precoRateio, nome: nomeLimpo || '…', whatsapp: digitos })
    : ''

  /** Põe o foco no campo; false se o campo não está na tela (ex.: quantidade com 1 vaga só). */
  const focar = (c: CampoErro): boolean => {
    const el = refs[c].current
    if (!el) return false
    if (el instanceof HTMLInputElement) el.focus()
    else (el.querySelector<HTMLElement>('[aria-checked="true"]') ?? el.querySelector<HTMLElement>('button:not(:disabled)'))?.focus()
    return el.contains(document.activeElement)
  }

  const mudarZap = (e: ChangeEvent<HTMLInputElement>) => {
    if (erro) setErro(null)
    const el = e.target
    const tipo = (e.nativeEvent as InputEvent).inputType ?? ''
    const res = editarCelular(zap, el.value, el.selectionStart ?? el.value.length, tipo)
    if (res.valor === zap) {
      queueMicrotask(() => el.setSelectionRange(res.cursor, res.cursor))
      return
    }
    cursorZap.current = res.cursor
    setZap(res.valor)
  }

  /** Troca o estado: a cidade digitada ou escolhida era do estado de antes (volta a do site, se for o dele). */
  const escolherUf = (u: string) => {
    if (erro) setErro(null)
    if (u === uf) return
    setUf(u)
    setCidade(u === ufSite ? (informadaSite ?? '') : '')
    setCidadeLista(u === ufSite ? cidadeSite : null)
  }

  const proximo = (prox: CampoErro) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
    e.preventDefault()
    focar(prox)
  }

  // o alerta aparece e leva o foco: pro 1º botão dele ou, sem botão, pra ele mesmo (nunca solto no <body>). Pelo
  // efeito, depois do commit que pôs o alerta na tela (um requestAnimationFrame às vezes chegava antes dele)
  const [alertaPedido, setAlertaPedido] = useState(0)
  const mostrarAlerta = () => setAlertaPedido((n) => n + 1)
  useEffect(() => {
    const a = alerta.current
    if (!alertaPedido || !a) return
    a.scrollIntoView({ block: 'nearest', behavior: movimentoReduzido() ? 'auto' : 'smooth' })
    ;(a.querySelector<HTMLElement>('a, button') ?? a).focus({ preventScroll: true })
  }, [alertaPedido])

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    if (enviandoRef.current) return
    setTentou(true)
    if (primeiroErro) {
      focar(primeiroErro)
      return
    }
    if (!uf || !canal) return
    const whatsapp = `55${digitos}`
    // a mesma pessoa no mesmo rateio, de novo (a resposta anterior se perdeu?): o mesmo token
    const antes = pendenteDe(r.id, whatsapp)
    const pend: EntradaPendente = {
      token: antes?.token ?? novoToken(),
      rateio: r.id,
      titulo: r.titulo,
      nome: nomeLimpo,
      whatsapp,
      uf,
      cidade: cidadeNome,
      quantidade: q,
      precoRateio: r.precoRateio,
      criadoEm: antes?.criadoEm ?? Date.now(),
      semResposta: antes?.semResposta,
      ...(paraOutro && whatsapp !== zapDono ? { paraOutro: true } : {}),
    }
    guardarPendente(pend)
    enviandoRef.current = true
    setEnviando(true)
    setErro(null)
    setPerdida(false)
    const resp = await entrarNoRateio({
      rateio: r.id,
      nome: nomeLimpo,
      whatsapp,
      uf,
      ...(cidadeNome && cidades.length !== 1 ? { cidade: cidadeNome } : cidades.length === 1 ? { cidade: cidades[0].nome } : {}),
      quantidade: q,
      site: armadilha,
      token: pend.token,
    })
    // ja-participa com uma entrada deste aparelho no caminho: a vaga pode ser ela (o servidor que guarda o token do
    // aparelho devolve no minhas-vagas). Achou: é a confirmação de sempre
    const achada = !resp.ok && resp.erro === 'ja-participa' ? await recuperarPendente(pend) : null
    enviandoRef.current = false
    setEnviando(false)
    if (resp.ok || achada) {
      setSemResposta(0)
      if (resp.ok && resp.rateio) trocarRateio(resp.rateio)
      const vaga: VagaGuardada = resp.ok ? { ...resp.participacao, nome: nomeLimpo, whatsapp, uf, cidade: cidadeNome, precoRateio: r.precoRateio, ...(pend.paraOutro ? { paraOutro: true } : {}) } : achada!
      guardarVaga(vaga)
      aoEntrar(vaga)
      if (!resp.ok) void carregarRateios(true)
      return
    }
    setErro(resp)
    if (resp.erro === 'sem-servidor' || resp.erro === 'fora-do-ar') {
      // sem resposta: não dá pra saber se gravou. O token fica (a próxima tentativa e as "Minhas vagas" perguntam)
      guardarPendente({ ...pend, semResposta: true })
      setSemResposta((n) => n + 1)
      mostrarAlerta()
      return
    }
    setSemResposta(0)
    if (resp.erro === 'ja-participa') {
      // o token deste aparelho não achou nada: um servidor que guarda o token devolveria a vaga desta entrada (200), então
      // ela é de outro jeito (outro aparelho, a loja pelo painel, ou um servidor que ignora o token). A tela mostra o
      // código e manda falar com a loja; nada de guardar vaga com quantidade que o site não sabe
      setPerdida(!!antes?.semResposta)
      tirarPendente(pend.token)
    }
    // o contador, os estados ou o prazo do cartão podem estar velhos (ou uma vaga entrou): busca a lista de novo
    // (invalido só sem campo daqui)
    if (RECARREGA.includes(resp.erro) && !(resp.erro === 'invalido' && resp.campo && resp.campo in refs)) void carregarRateios(true)
    // o teto que o servidor disse vale pra lista de agora (quando ela mudar, vale a dela)
    if (resp.erro === 'sem-vagas' && resp.disponiveis != null) {
      setTetoServidor({ n: Math.max(0, resp.disponiveis), disponiveis: r.disponiveis, limite: r.limitePorPessoa })
      if (resp.disponiveis > 0) setQtd(resp.disponiveis)
    }
    if (resp.erro === 'limite-por-pessoa' && resp.limite) {
      setTetoServidor({ n: resp.limite, disponiveis: r.disponiveis, limite: r.limitePorPessoa })
      setQtd(resp.limite)
    }
    if (resp.erro === 'invalido' && resp.campo && resp.campo in refs) {
      if (!focar(resp.campo as CampoErro)) mostrarAlerta()
      return
    }
    if (resp.erro === 'fora-do-estado' && focar('uf')) return
    mostrarAlerta()
  }

  // sem servidor: o envio é o próprio link do WhatsApp (montado antes do toque); com erro no formulário, segura o link
  const tocarZap = (ev: MouseEvent<HTMLAnchorElement>) => {
    setTentou(true)
    if (primeiroErro) {
      ev.preventDefault()
      focar(primeiroErro)
      return
    }
    setFoiPeloZap(true)
  }

  const incerto = erro?.erro === 'sem-servidor' || erro?.erro === 'fora-do-ar'
  const erroGeral = erro && !erroServidorCampo ? textoDoErro(erro, r, uf, { semResposta, perdida }) : null
  // sem-vagas com 0 já trava pelo `lotado` (que solta sozinho se a lista mostrar vaga de novo)
  const travado = lotado || erro?.erro === 'rateio-fechado' || erro?.erro === 'nao-encontrado'
  const idTotal = `${uid}-total`
  // ja-participa: a mensagem leva só o código (quantas vagas e quanto, quem sabe é a loja; o formulário pode estar
  // com outra quantidade)
  const textoJa =
    canal && erro?.erro === 'ja-participa' && erro.codigo
      ? montarRateio({ canal, cidade: cidadeNome, titulo: r.titulo, quantidade: null, precoRateio: r.precoRateio, codigo: erro.codigo, nome: nomeLimpo, whatsapp: digitos })
      : null

  return (
    <form className="rp-form" onSubmit={enviar} noValidate aria-labelledby={`${uid}-t`}>
      <h2 id={`${uid}-t`} className="rp-secao-titulo">
        Entrar no rateio
      </h2>

      <div className="form-campo">
        <label htmlFor={`${uid}-nome`}>Teu nome</label>
        <input
          ref={refs.nome}
          id={`${uid}-nome`}
          value={nome}
          onChange={(e) => {
            if (erro) setErro(null)
            setNome(e.target.value)
          }}
          placeholder="Como a loja te chama"
          autoComplete="name"
          maxLength={60}
          aria-invalid={!!mostra('nome')}
          aria-describedby={mostra('nome') ? `${uid}-enome` : undefined}
          enterKeyHint="next"
          onKeyDown={proximo('whatsapp')}
        />
        {mostra('nome') && (
          <p id={`${uid}-enome`} className="form-erro">
            {mostra('nome')}
          </p>
        )}
      </div>

      <div className="form-campo">
        <label htmlFor={`${uid}-zap`}>Teu WhatsApp</label>
        <div className="form-zap">
          <span className="form-ddi" aria-hidden="true">
            +55
          </span>
          <input
            ref={refs.whatsapp}
            id={`${uid}-zap`}
            value={zap}
            onChange={mudarZap}
            placeholder="(33) 99999-9999"
            inputMode="tel"
            type="tel"
            autoComplete="tel-national"
            maxLength={24}
            aria-invalid={!!mostra('whatsapp')}
            aria-describedby={mostra('whatsapp') ? `${uid}-ezap` : undefined}
            enterKeyHint="done"
          />
        </div>
        {mostra('whatsapp') && (
          <p id={`${uid}-ezap`} className="form-erro">
            {mostra('whatsapp')}
          </p>
        )}
      </div>

      <div className="form-campo">
        <span className="rp-rotulo" id={`${uid}-luf`}>
          Teu estado
        </span>
        <div ref={refs.uf} className="rp-chips" role="radiogroup" aria-labelledby={`${uid}-luf`} aria-describedby={mostra('uf') ? `${uid}-euf` : undefined}>
          {ufsComLoja.map((u) => (
            <button
              key={u}
              type="button"
              role="radio"
              aria-checked={uf === u}
              className={`rp-chip px toque${uf === u ? ' sel' : ''}`}
              aria-label={canalDa(u)?.nome ?? u.toUpperCase()}
              onClick={() => escolherUf(u)}
              onKeyDown={(e) => {
                // setas andam entre as opções, como num grupo de rádio (e trocam a cidade junto, como o clique)
                const i = ufsComLoja.indexOf(u)
                const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
                if (!d) return
                e.preventDefault()
                const prox = ufsComLoja[(i + d + ufsComLoja.length) % ufsComLoja.length]
                escolherUf(prox)
                ;(e.currentTarget.parentElement?.children[ufsComLoja.indexOf(prox)] as HTMLElement | undefined)?.focus()
              }}
              tabIndex={uf === u || (!uf && u === ufsComLoja[0]) ? 0 : -1}
            >
              {u.toUpperCase()}
            </button>
          ))}
        </div>
        {mostra('uf') && (
          <p id={`${uid}-euf`} className="form-erro">
            {mostra('uf')}
          </p>
        )}
        {canal && cidades.length === 1 && <p className="legenda rp-cidade-fixa">Entrega em {cidades[0].nome}.</p>}
      </div>

      {precisaCidadeTexto && (
        <div className="form-campo">
          <label htmlFor={`${uid}-cid`}>Tua cidade</label>
          <input
            ref={refs.cidade}
            id={`${uid}-cid`}
            value={cidade}
            onChange={(e) => setCidade(e.target.value)}
            placeholder="Ex.: Vila Velha"
            autoComplete="address-level2"
            maxLength={60}
            aria-invalid={!!mostra('cidade')}
            aria-describedby={mostra('cidade') ? `${uid}-ecid` : undefined}
          />
          {mostra('cidade') && (
            <p id={`${uid}-ecid`} className="form-erro">
              {mostra('cidade')}
            </p>
          )}
        </div>
      )}
      {precisaCidadeLista && (
        <div className="form-campo">
          <span className="rp-rotulo" id={`${uid}-lcid`}>
            Tua cidade
          </span>
          <div className="rp-chips" role="radiogroup" aria-labelledby={`${uid}-lcid`}>
            {cidades.map((c) => (
              <button key={c.slug} type="button" role="radio" aria-checked={cidadeLista === c.slug} className={`rp-chip rp-chip-texto toque${cidadeLista === c.slug ? ' sel' : ''}`} onClick={() => setCidadeLista(c.slug)}>
                {c.nome}
              </button>
            ))}
          </div>
          {mostra('cidade') && <p className="form-erro">{mostra('cidade')}</p>}
        </div>
      )}

      <div className="form-campo">
        <span className="rp-rotulo" id={`${uid}-lqtd`}>
          Quantas vagas
        </span>
        {lotado ? (
          <p className="rp-uma legenda" role="status">
            Vagas tomadas: não sobrou nenhuma agora. Se alguém não pagar no prazo, a vaga volta pro rateio.
          </p>
        ) : teto > 1 ? (
          <div className="rp-qtd-linha">
            <div ref={refs.quantidade} className="ad-qtd rp-qtd" role="group" aria-labelledby={`${uid}-lqtd`} aria-describedby={idTotal}>
              <button type="button" className="icone-botao toque" onClick={() => setQtd(Math.max(1, q - 1))} aria-label="Menos uma vaga" disabled={q <= 1}>
                <Icone nome="menos" tamanho={16} />
              </button>
              <span className="px px-20" aria-live="polite">
                {q}
              </span>
              <button type="button" className="icone-botao toque" onClick={() => setQtd(Math.min(teto, q + 1))} aria-label="Mais uma vaga" disabled={q >= teto}>
                <Icone nome="mais" tamanho={16} />
              </button>
            </div>
            <p className="rp-teto legenda">até {vagasTexto(teto)} por pessoa{r.disponiveis < r.limitePorPessoa ? ' (o que sobrou)' : ''}</p>
          </div>
        ) : (
          <p className="rp-uma legenda">{r.limitePorPessoa === 1 ? '1 vaga por pessoa nesse rateio.' : 'Só sobrou 1 vaga.'}</p>
        )}
        {!lotado && (
          <p id={idTotal} className="rp-total" aria-live="polite">
            <span className="rp-total-conta">{contaVagas(q, r.precoRateio)} =</span> <strong className="rp-total-valor px px-20">{brl(total(q, r.precoRateio))}</strong>
            {mostra('quantidade') && <span className="form-erro"> {mostra('quantidade')}</span>}
          </p>
        )}
      </div>

      {/* armadilha pra robô: fora da tela, fora do Tab e do leitor de tela; gente nunca preenche */}
      <div className="rp-armadilha" aria-hidden="true">
        <label htmlFor={`${uid}-site`}>Site</label>
        <input id={`${uid}-site`} name="site" tabIndex={-1} autoComplete="off" value={armadilha} onChange={(e) => setArmadilha(e.target.value)} />
      </div>

      <p className="rp-privacidade legenda">Teu nome e WhatsApp servem só pra loja confirmar tua vaga.</p>

      {erroGeral && (
        <div ref={alerta} className="form-alerta rp-alerta" role="alert" tabIndex={-1}>
          <p>{erroGeral}</p>
          {erro?.erro === 'ja-participa' && (
            <div className="rp-alerta-acoes">
              {vagasTemCodigo(erro.codigo) && (
                <button type="button" className="botao botao-contorno toque" onClick={verMinhasVagas}>
                  Ver minhas vagas
                </button>
              )}
              {canal && textoJa && (
                <a className="botao botao-contorno toque" href={linkWhatsApp(canal, textoJa)} target={alvoDeSaida()} rel="noopener noreferrer">
                  <Icone nome="whatsapp" tamanho={16} />
                  Falar com a loja
                </a>
              )}
            </div>
          )}
          {(erro?.erro === 'rateio-fechado' || erro?.erro === 'nao-encontrado' || (erro?.erro === 'sem-vagas' && !erro.disponiveis)) && (
            <button type="button" className="botao botao-contorno toque" onClick={() => useUI.getState().fecharRateio()}>
              Ver os outros rateios
            </button>
          )}
        </div>
      )}

      {semServidor ? (
        <div className="rp-envio">
          {canal ? (
            <BotaoZap canal={canal} texto={texto} rotulo="Entrar pelo WhatsApp" aoTocar={tocarZap} />
          ) : (
            <button type="button" className="botao botao-cheio botao-largo" onClick={() => focar('uf')}>
              Escolhe teu estado
            </button>
          )}
          <p className="rp-honesto legenda">{foiPeloZap ? 'Mensagem pronta no WhatsApp. Quem aperta enviar é tu; a loja confirma tua vaga por lá.' : 'A loja confirma tua vaga pelo WhatsApp.'}</p>
        </div>
      ) : (
        <div className="rp-envio">
          {/* durante o envio o botão segue focável (aria-disabled): desabilitar jogava o foco pro <body> */}
          <button type="submit" className="botao botao-cheio botao-largo rp-reservar" disabled={travado} aria-disabled={enviando || undefined} aria-describedby={lotado ? undefined : idTotal}>
            {lotado ? 'Vagas tomadas' : enviando ? 'Reservando…' : incerto ? 'Tentar de novo' : q > 1 ? `Reservar minhas ${q} vagas` : 'Reservar minha vaga'}
          </button>
          {enviando && lento ? (
            <p className="rp-honesto legenda" role="status">
              Tá demorando: a conexão tá lenta. Segura aí.
            </p>
          ) : (
            <p className="rp-honesto legenda">Depois tu fecha o pagamento com a loja no WhatsApp.</p>
          )}
          {/* duas tentativas sem resposta: o WhatsApp vira a segunda opção (a loja acha a vaga pelo número, se gravou) */}
          {incerto && semResposta >= 2 && canal && !enviando && <BotaoZap canal={canal} texto={texto} rotulo="Entrar pelo WhatsApp" aoTocar={tocarZap} contorno />}
        </div>
      )}
    </form>
  )
}

function vagasTemCodigo(codigo: string | undefined): boolean {
  return !!codigo && useRateio.getState().vagas.some((v) => v.codigo === codigo)
}
