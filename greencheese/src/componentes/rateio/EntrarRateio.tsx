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
import { entrarNoRateio } from '../../lib/rateio-vagas'
import { celularNoCampo, editarCelular, normalizarCelular, validarCelular } from '../../lib/telefone'
import { useChat } from '../../store/chat'
import { useLocal } from '../../store/local'
import { agoraRateio, carregarRateios, guardarVaga, trocarRateio, useRateio, type VagaGuardada } from '../../store/rateio'
import { useUI } from '../../store/ui'
import { Icone } from '../comum'
import { NOME_VAGA, ateQuando, contaVagas, listaUfs, statusVisto, total, vagaAtiva, vagasTexto } from './util'

// Entrar no rateio, na página dele. Com o servidor: nome + WhatsApp (+ estado, cidade quando precisa, quantidade) →
// POST rateio-entrar → a vaga fica reservada na hora, com código, e a tela de "Tá no rateio!" leva pro WhatsApp da
// loja com a mensagem pronta (o Pix aqui no site fica "Em breve", como no pedido). Sem servidor (zip, servidor fora
// do ar): o mesmo formulário vira "Entrar pelo WhatsApp", sem código, e a loja confirma a vaga por lá.
// Já tem vaga ativa neste aparelho nesse rateio: mostra a vaga (e deixa entrar com outro WhatsApp, pra um amigo).

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
function BotaoZap({ canal, texto, rotulo, aoTocar, refBotao }: { canal: Canal; texto: string; rotulo: string; aoTocar?: (e: MouseEvent<HTMLAnchorElement>) => void; refBotao?: Ref<HTMLAnchorElement> }) {
  const avisar = useUI((s) => s.avisar)
  const [naoAbriu, setNaoAbriu] = useState(false)
  const alvo = alvoDeSaida()
  return (
    <>
      <a
        ref={refBotao}
        className="botao botao-cheio botao-largo dm-zap rp-zap"
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
        Tá no rateio! Código {vaga.codigo}. {ate ? `Tua vaga fica guardada até ${ate}.` : ''}
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
        {vagasTexto(vaga.quantidade)} · {brl(vaga.total)}. {ate ? <>Tua vaga fica guardada até <strong>{ate}</strong>.</> : 'Tua vaga fica guardada enquanto a loja confirma.'} Fecha o pagamento com a loja no WhatsApp pra confirmar.
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

/** A vaga que este aparelho já tem nesse rateio. */
function TuaVaga({ vaga, rateio, outra }: { vaga: VagaGuardada; rateio: Rateio; outra: () => void }) {
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
        {status === 'expirado' && ' — a vaga voltou'}
        {status === 'reservado' && vaga.expiraEm && <span className="mv-linha"> · guardada até {ateQuando(vaga.expiraEm, agora)}</span>}
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
        <button type="button" className="botao-texto toque" onClick={outra}>
          Entrar com outro WhatsApp
        </button>
      </div>
    </section>
  )
}

interface Props {
  rateio: Rateio
  /** 'servidor': reserva com código; 'sem-servidor': entra pelo WhatsApp. */
  modo: 'servidor' | 'sem-servidor'
}

export function EntrarRateio({ rateio, modo }: Props) {
  const vagas = useRateio((s) => s.vagas)
  const agora = agoraRateio()
  const minha = vagas.find((v) => v.rateio === rateio.id && vagaAtiva(v, agora))
  const [outra, setOutra] = useState(false)
  const [feita, setFeita] = useState<VagaGuardada | null>(null)
  if (feita) return <Confirmacao vaga={feita} rateio={rateio} />
  if (minha && !outra) return <TuaVaga vaga={minha} rateio={rateio} outra={() => setOutra(true)} />
  return <Formulario rateio={rateio} modo={modo} aoEntrar={setFeita} focarAoAbrir={outra} />
}

/** Mensagem curta e humana para cada erro do servidor (o campo, quando é de um campo). */
function textoDoErro(e: FalhaRateio, r: Rateio, uf: string | null): string {
  switch (e.erro) {
    case 'nao-encontrado':
      return 'Esse rateio saiu do ar.'
    case 'fora-do-estado':
      return `Esse rateio não vale pra ${uf?.toUpperCase() ?? 'esse estado'}. Vale pra ${listaUfs(r.ufs)}.`
    case 'rateio-fechado':
      return 'Esse rateio não aceita mais entrada: fechou ou o prazo acabou.'
    case 'sem-vagas':
      return e.disponiveis ? `Só ${e.disponiveis === 1 ? 'sobrou 1 vaga' : `sobraram ${e.disponiveis} vagas`}. A quantidade já foi ajustada: é só mandar de novo.` : 'Lotou: as vagas acabaram de ser pegas.'
    case 'limite-por-pessoa':
      return `Cada WhatsApp pega até ${vagasTexto(e.limite ?? r.limitePorPessoa)} nesse rateio.`
    case 'ja-participa':
      return `Esse WhatsApp já está nesse rateio${e.codigo ? ` (código ${e.codigo})` : ''}.`
    case 'muitas-tentativas':
      return 'Muita tentativa seguida. Espera uns minutos e tenta de novo.'
    case 'sem-servidor':
      return 'Não deu pra reservar agora. Entra pelo WhatsApp que a loja confirma tua vaga por lá.'
    default:
      return 'Deu ruim do lado da loja. Tenta de novo em instantes ou entra pelo WhatsApp.'
  }
}

function Formulario({ rateio: r, modo, aoEntrar, focarAoAbrir }: { rateio: Rateio; modo: Props['modo']; aoEntrar: (v: VagaGuardada) => void; focarAoAbrir: boolean }) {
  const uid = useId()
  const conta = useConta()
  const ultima = useRateio((s) => s.vagas[0])
  const nomeChat = useChat((s) => s.respostas.nome)
  const ufSite = useLocal((s) => s.uf)
  const cidadeSite = useLocal((s) => s.cidade)
  const informadaSite = useLocal((s) => s.cidadeInformada)
  const ufsComLoja = r.ufs.filter((u) => canalDa(u))
  const [uf, setUf] = useState<string | null>(() => (ufSite && ufsComLoja.includes(ufSite) ? ufSite : ufsComLoja.length === 1 ? ufsComLoja[0] : null))
  // "Entrar com outro WhatsApp" (pra um amigo): começa em branco; senão, vem da conta ou da última vaga
  const [nome, setNome] = useState(() => (focarAoAbrir ? '' : (conta?.nome ?? ultima?.nome ?? limparNome(nomeChat ?? ''))))
  const [zap, setZap] = useState(() => (focarAoAbrir ? '' : conta ? celularNoCampo(conta.whatsapp) : ultima ? celularNoCampo(ultima.whatsapp) : ''))
  const [cidade, setCidade] = useState(() => (ufSite === uf ? (informadaSite ?? '') : ''))
  const [cidadeLista, setCidadeLista] = useState<string | null>(() => (ufSite === uf ? cidadeSite : null))
  const [qtd, setQtd] = useState(1)
  const [armadilha, setArmadilha] = useState('')
  const [tentou, setTentou] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<FalhaRateio | null>(null)
  // o servidor disse quantas sobraram (sem-vagas) ou qual o limite: o seletor de quantidade obedece
  const [tetoServidor, setTetoServidor] = useState<number | null>(null)
  const [semServidor, setSemServidor] = useState(modo === 'sem-servidor')
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
    if (modo === 'sem-servidor') setSemServidor(true)
  }, [modo])

  const canal = canalDa(uf)
  const cidades = canal?.cidades ?? []
  const precisaCidadeTexto = !!canal && cidades.length === 0
  const precisaCidadeLista = cidades.length > 1
  const teto = Math.max(1, Math.min(r.limitePorPessoa, r.disponiveis || 1, tetoServidor ?? Infinity))
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
  // erro de campo que veio do servidor (invalido + campo)
  const erroServidorCampo = erro?.erro === 'invalido' && erro.campo && ['nome', 'whatsapp', 'uf', 'quantidade'].includes(erro.campo) ? (erro.campo as CampoErro) : null
  const mostra = (c: CampoErro) => (tentou && erros[c]) || (erroServidorCampo === c ? (erro?.mensagem ?? 'Confere esse campo.') : null)
  const primeiroErro = (['nome', 'whatsapp', 'uf', 'cidade'] as CampoErro[]).find((c) => erros[c])

  const texto = canal
    ? montarRateio({ canal, cidade: cidadeNome, titulo: r.titulo, quantidade: q, precoRateio: r.precoRateio, nome: nomeLimpo || '…', whatsapp: digitos })
    : ''

  const focar = (c: CampoErro) => {
    const el = refs[c].current
    if (!el) return
    if (el instanceof HTMLInputElement) el.focus()
    else el.querySelector<HTMLElement>('[aria-checked="true"], button')?.focus()
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

  const proximo = (prox: CampoErro) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
    e.preventDefault()
    focar(prox)
  }

  const mostrarAlerta = () =>
    requestAnimationFrame(() => {
      alerta.current?.scrollIntoView({ block: 'nearest', behavior: movimentoReduzido() ? 'auto' : 'smooth' })
      alerta.current?.querySelector<HTMLElement>('a, button')?.focus({ preventScroll: true })
    })

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    setTentou(true)
    if (primeiroErro) {
      focar(primeiroErro)
      return
    }
    if (enviando || !uf || !canal) return
    setEnviando(true)
    setErro(null)
    const resp = await entrarNoRateio({
      rateio: r.id,
      nome: nomeLimpo,
      whatsapp: `55${digitos}`,
      uf,
      ...(cidadeNome && cidades.length !== 1 ? { cidade: cidadeNome } : cidades.length === 1 ? { cidade: cidades[0].nome } : {}),
      quantidade: q,
      site: armadilha,
    })
    setEnviando(false)
    if (resp.ok) {
      if (resp.rateio) trocarRateio(resp.rateio)
      const vaga: VagaGuardada = { ...resp.participacao, nome: nomeLimpo, whatsapp: `55${digitos}`, uf, cidade: cidadeNome, precoRateio: r.precoRateio }
      guardarVaga(vaga)
      aoEntrar(vaga)
      return
    }
    setErro(resp)
    // o contador do cartão pode estar velho: busca a lista de novo
    if (['sem-vagas', 'rateio-fechado', 'nao-encontrado', 'limite-por-pessoa'].includes(resp.erro)) void carregarRateios(true)
    if (resp.erro === 'sem-servidor') {
      setSemServidor(true)
      mostrarAlerta()
      return
    }
    if (resp.erro === 'sem-vagas' && resp.disponiveis != null) {
      setTetoServidor(Math.max(1, resp.disponiveis))
      if (resp.disponiveis > 0) setQtd(resp.disponiveis)
    }
    if (resp.erro === 'limite-por-pessoa' && resp.limite) {
      setTetoServidor(resp.limite)
      setQtd(resp.limite)
    }
    if (resp.erro === 'invalido' && resp.campo && resp.campo in refs) {
      focar(resp.campo as CampoErro)
      return
    }
    if (resp.erro === 'fora-do-estado') {
      focar('uf')
      return
    }
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

  const erroGeral = erro && erro.erro !== 'invalido' ? textoDoErro(erro, r, uf) : null
  const travado = erro?.erro === 'rateio-fechado' || erro?.erro === 'nao-encontrado' || (erro?.erro === 'sem-vagas' && erro.disponiveis === 0)
  const idTotal = `${uid}-total`

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
              onClick={() => {
                if (erro) setErro(null)
                if (u !== uf) {
                  setUf(u)
                  setCidade(u === ufSite ? (informadaSite ?? '') : '')
                  setCidadeLista(u === ufSite ? cidadeSite : null)
                }
              }}
              onKeyDown={(e) => {
                // setas andam entre as opções, como num grupo de rádio
                const i = ufsComLoja.indexOf(u)
                const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
                if (!d) return
                e.preventDefault()
                const prox = ufsComLoja[(i + d + ufsComLoja.length) % ufsComLoja.length]
                setUf(prox)
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
        {teto > 1 ? (
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
        <p id={idTotal} className="rp-total" aria-live="polite">
          <span className="rp-total-conta">{contaVagas(q, r.precoRateio)} =</span> <strong className="rp-total-valor px px-20">{brl(total(q, r.precoRateio))}</strong>
          {mostra('quantidade') && <span className="form-erro"> {mostra('quantidade')}</span>}
        </p>
      </div>

      {/* armadilha pra robô: fora da tela, fora do Tab e do leitor de tela; gente nunca preenche */}
      <div className="rp-armadilha" aria-hidden="true">
        <label htmlFor={`${uid}-site`}>Site</label>
        <input id={`${uid}-site`} name="site" tabIndex={-1} autoComplete="off" value={armadilha} onChange={(e) => setArmadilha(e.target.value)} />
      </div>

      <p className="rp-privacidade legenda">Teu nome e WhatsApp servem só pra loja confirmar tua vaga.</p>

      {erroGeral && (
        <div ref={alerta} className="form-alerta rp-alerta" role="alert">
          <p>{erroGeral}</p>
          {erro?.erro === 'ja-participa' && (
            <div className="rp-alerta-acoes">
              {vagasTemCodigo(erro.codigo) && (
                <button type="button" className="botao botao-contorno toque" onClick={verMinhasVagas}>
                  Ver minhas vagas
                </button>
              )}
              {canal && erro.codigo && (
                <a
                  className="botao botao-contorno toque"
                  href={linkWhatsApp(canal, montarRateio({ canal, cidade: cidadeNome, titulo: r.titulo, quantidade: q, precoRateio: r.precoRateio, codigo: erro.codigo, nome: nomeLimpo, whatsapp: digitos }))}
                  target={alvoDeSaida()}
                  rel="noopener noreferrer"
                >
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
          {modo === 'servidor' && (
            <button type="submit" className="botao-texto toque" disabled={enviando}>
              Tentar reservar de novo
            </button>
          )}
        </div>
      ) : (
        <div className="rp-envio">
          <button type="submit" className="botao botao-cheio botao-largo rp-reservar" disabled={enviando || travado} aria-describedby={idTotal}>
            {enviando ? 'Reservando…' : q > 1 ? `Reservar minhas ${q} vagas` : 'Reservar minha vaga'}
          </button>
          <p className="rp-honesto legenda">Depois tu fecha o pagamento com a loja no WhatsApp.</p>
        </div>
      )}
    </form>
  )
}

function vagasTemCodigo(codigo: string | undefined): boolean {
  return !!codigo && useRateio.getState().vagas.some((v) => v.codigo === codigo)
}
