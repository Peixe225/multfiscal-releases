import { useEffect, useId, useLayoutEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react'
import { T } from '../interativos/sorte/textos'
import { armazenamentoOk, letrasDoNome, limparNome, pendenteValido, useConta, type ContaAberta, type DetalheErro } from '../lib/conta'
import { conta as adaptador } from '../lib/conta-adaptador'
import { descobrirModo, modoConta as modoContaAgora, modoDescoberto, sessaoCaiuNestaVisita, useModoConta } from '../lib/conta-modo'
import { copiarTexto } from '../lib/copiar'
import { celularNoCampo, editarCelular, mascararCelular, normalizarCelular, validarCelular } from '../lib/telefone'
import { statusDo } from '../lib/cupom'
import { linkCompartilhar } from '../lib/url'
import { useChat } from '../store/chat'
import { useContaStore } from '../store/conta'
import { useUI } from '../store/ui'
import { TC } from './conta-textos'
import './FormConta.css'

// Criar conta, entrar e editar: o mínimo de campos (nome + WhatsApp). Promoções desligadas por padrão (opt-in
// separado e datado). Dois jeitos, conforme o modo da conta (src/lib/conta-modo.ts):
// - no aparelho: tudo fica só aqui e a tela diz isso com todas as letras; entrar não pede código;
// - no servidor da loja: o WhatsApp da loja manda um código de 6 números pra provar que o número é da pessoa. Criar e
//   entrar são o mesmo caminho (número → código; número novo pede o nome depois do código), e trocar o WhatsApp da
//   conta também pede o código, que vai pro número novo. A conta do aparelho vai junto no primeiro login.
// O passo do código fica guardado na aba (sessionStorage, 10 min, sem o código): recarregou a página ou o navegador do
// Instagram voltou do WhatsApp recarregando, a tela volta no passo do código com o número (o código que chegou vale) e
// com o nome que já estava escrito. Recarregou no passo do nome (número novo): volta no passo do código pedindo o nome
// junto, com o campo do nome aberto (o código não fica guardado: a pessoa digita de novo o que chegou).

export type ModoForm = 'criar' | 'entrar' | 'editar'

interface Props {
  modo: ModoForm
  /** Tem prêmio esperando (muda o texto e o botão). */
  comPremio?: boolean
  aoSucesso: (r: ContaAberta, modo: ModoForm) => void
  aoTrocarModo?: (m: 'criar' | 'entrar') => void
  aoCancelar?: () => void
  /** id do h2 (o jogo foca nele ao trocar de tela). */
  idTitulo?: string
  /** Título em h3 (dentro de outra folha, como a Minha conta). */
  tituloMenor?: boolean
  /**
   * A loja desligou o código (ou bateu o teto) no meio do caminho e a conta voltou pro aparelho: quem está numa tela que
   * só existe com o código (a Minha conta sem conta) fecha e avisa com essa frase. Sem isto, o erro aparece no formulário.
   */
  aoPausar?: (frase: string) => void
}

type TipoErro =
  | 'whatsapp-existe'
  | 'nao-encontrada'
  | 'codigo-errado'
  | 'codigo-curto'
  | 'codigo-vencido'
  | 'codigo-vencido-nome'
  | 'muitas-tentativas'
  | 'sem-envio'
  | 'pausado'
  | 'rede'
  | 'invalido'
  | 'nome-invalido'
  | 'falhou'
type Erro = { tipo: TipoErro; detalhe?: DetalheErro }

/** O passo do formulário: os dados; o código que chegou no WhatsApp; o nome (número novo, depois do código). */
type Passo = 'dados' | 'codigo' | 'nome'

/** Pausa entre um código e outro (a mesma do servidor). */
const PAUSA_CODIGO = 60
/** Quanto vale o código (o mesmo do servidor): o passo guardado na aba não passa disso. */
const VALE_CODIGO_MS = 10 * 60_000
const CHAVE_PASSO = 'gc-conta-passo'

/** O passo do código guardado na aba (sem o código: só o que a pessoa digitou antes dele e quando ele saiu). */
interface PassoGuardado {
  modo: 'criar' | 'entrar'
  zap: string
  nome: string
  promo: boolean
  enviadoEm: number
  nomePedido: boolean
}

export function lerPassoGuardado(): PassoGuardado | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(CHAVE_PASSO) ?? 'null') as PassoGuardado | null
    if (!v || (v.modo !== 'criar' && v.modo !== 'entrar') || typeof v.zap !== 'string' || typeof v.enviadoEm !== 'number') return null
    const idade = Date.now() - v.enviadoEm
    return idade >= 0 && idade < VALE_CODIGO_MS ? v : null
  } catch {
    return null
  }
}

function guardarPasso(p: PassoGuardado | null) {
  try {
    if (p) sessionStorage.setItem(CHAVE_PASSO, JSON.stringify(p))
    else sessionStorage.removeItem(CHAVE_PASSO)
  } catch {
    /* sem armazenamento: recarregar volta pro começo */
  }
}

export function FormConta({ modo, comPremio = false, aoSucesso, aoTrocarModo, aoCancelar, idTitulo, tituloMenor = false, aoPausar }: Props) {
  const atual = useConta()
  const modoConta = useModoConta()
  const servidor = modoConta === 'servidor'
  const nomeChat = useChat((s) => s.respostas.nome)
  // a conta do aparelho esperando ir pro servidor: o número já vem no campo
  const paraMigrar = useContaStore((s) => (s.paraMigrar ? (s.contas[s.paraMigrar] ?? null) : null))
  // o prêmio reservado no aparelho (girou sem conta antes de a loja ligar as contas): vai junto e ocupa uma das 2 vagas
  const pendenteDoAparelho = useContaStore((s) => (s.pendente && !s.pendente.servidor ? s.pendente : null))
  const avisar = useUI((s) => s.avisar)
  const uid = useId()
  // o passo do código que ficou guardado na aba (recarregou no meio): volta nele, com o número e o nome
  const [volta] = useState(() => {
    if (modo === 'editar' || (modoDescoberto() && modoContaAgora() !== 'servidor')) return null
    const g = lerPassoGuardado()
    return g && g.modo === modo ? g : null
  })
  const [nome, setNome] = useState(() => (modo === 'editar' ? (atual?.nome ?? '') : volta ? volta.nome : (paraMigrar?.conta.nome ?? limparNome(nomeChat))))
  const [zap, setZap] = useState(() =>
    modo === 'editar' && atual ? celularNoCampo(atual.whatsapp) : volta ? celularNoCampo(volta.zap) : paraMigrar ? celularNoCampo(paraMigrar.conta.whatsapp) : '',
  )
  const [promo, setPromo] = useState(() => (modo === 'editar' ? !!atual?.aceitaPromo : volta ? volta.promo : !!paraMigrar?.conta.aceitaPromo))
  const [tentou, setTentou] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erroGeral, setErroGeral] = useState<Erro | null>(null)
  // o servidor recusou o nome (a frase dele, no campo do nome)
  const [nomeRecusado, setNomeRecusado] = useState<string | null>(null)
  const [passo, setPasso] = useState<Passo>(volta ? 'codigo' : 'dados')
  const [codigo, setCodigo] = useState('')
  const [enviadoEm, setEnviadoEm] = useState(volta?.enviadoEm ?? 0)
  // número sem conta no entrar: o servidor já pediu o nome (ele fica na tela até o fim, mesmo se precisar de outro código)
  const [nomePedido, setNomePedido] = useState(volta?.nomePedido ?? false)
  const [agora, setAgora] = useState(() => Date.now())
  const zapRef = useRef<HTMLInputElement>(null)
  const nomeRef = useRef<HTMLInputElement>(null)
  const codigoRef = useRef<HTMLInputElement>(null)
  // trava síncrona: o estado só muda no próximo desenho, e um toque duplo passaria pelos dois
  const trava = useRef(false)
  // onde o cursor do WhatsApp fica depois de remascarar (o React põe no fim quando troca o valor)
  const cursorZap = useRef<number | null>(null)
  useLayoutEffect(() => {
    const el = zapRef.current
    const c = cursorZap.current
    cursorZap.current = null
    if (el && c != null && document.activeElement === el) el.setSelectionRange(c, c)
  }, [zap])
  useLayoutEffect(() => {
    if (passo === 'codigo') codigoRef.current?.focus()
    if (passo === 'nome') nomeRef.current?.focus()
  }, [passo])
  // o modo da conta (o servidor responde uma vez por visita): o formulário já abre sabendo
  useEffect(() => {
    void descobrirModo()
  }, [])
  // o nome escrito depois do código (ou corrigido no passo do código) entra no passo guardado: recarregar não perde
  useEffect(() => {
    if (modo === 'editar' || passo === 'dados') return
    const g = lerPassoGuardado()
    if (g && g.modo === modo && g.zap === normalizarCelular(zap) && (g.nome !== limparNome(nome) || g.promo !== promo)) guardarPasso({ ...g, nome: limparNome(nome), promo })
  }, [modo, passo, nome, promo, zap])
  // "Mandar outro código" libera depois de 1 min (o relógio só anda no passo do código)
  useEffect(() => {
    if (passo !== 'codigo') return
    const t = window.setInterval(() => setAgora(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [passo])

  const digitos = normalizarCelular(zap)
  // nome: no criar e no editar; no entrar, só quando o número é novo (passo 'nome', e depois dele)
  const pedeNome = modo !== 'entrar' || passo === 'nome' || nomePedido
  // as letras contadas como o servidor conta (um emoji é 1): "🔥" sozinho não passa aqui nem lá
  const erroNome = pedeNome && letrasDoNome(nome) < 2 ? T.erroNome : pedeNome ? nomeRecusado : null
  const erroZap = validarCelular(digitos)
  const mostraNome = tentou && !!erroNome
  const mostraZap = tentou && !!erroZap && passo === 'dados'
  const trocandoNumero = modo === 'editar' && !!atual && servidor && `55${digitos}` !== atual.whatsapp
  const faltaEsperar = Math.max(0, PAUSA_CODIGO - Math.floor((agora - enviadoEm) / 1000))

  if (!armazenamentoOk && modo !== 'editar') {
    return (
      <div className="form-conta form-sem-armazenamento">
        <h2 id={idTitulo} className="form-titulo" tabIndex={-1} data-foco-jogo>
          {modo === 'entrar' ? T.entrar : T.criaTuaConta}
        </h2>
        <p>{T.semArmazenamento}</p>
        <button
          type="button"
          className="botao botao-contorno"
          onClick={() => avisar(copiarTexto(linkCompartilhar({ jogo: 'sorte' })) ? T.linkCopiado : 'Não deu pra copiar o link.')}
        >
          {T.copiarLink}
        </button>
      </div>
    )
  }

  // máscara progressiva com o cursor no lugar (ver editarCelular): corrigir um dígito no meio corrige ele mesmo
  const mudarZap = (e: ChangeEvent<HTMLInputElement>) => {
    setErroGeral(null)
    const el = e.target
    const tipo = (e.nativeEvent as InputEvent).inputType ?? ''
    const r = editarCelular(zap, el.value, el.selectionStart ?? el.value.length, tipo)
    if (r.valor === zap) {
      // nada mudou (12º dígito): o React devolve o valor ao campo depois deste evento; o cursor volta em seguida
      queueMicrotask(() => el.setSelectionRange(r.cursor, r.cursor))
      return
    }
    cursorZap.current = r.cursor
    setZap(r.valor)
  }

  // "Próximo" do teclado no nome: vai pro WhatsApp sem enviar (e sem acusar erro num campo que nem foi tocado); no
  // passo do código, vai pro código (o WhatsApp fica travado), ou envia se ele já está escrito
  const proximoNoNome = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing || passo === 'nome') return
    if (passo === 'codigo' && codigo.replace(/\D/g, '').length === 6) return
    e.preventDefault()
    ;(passo === 'codigo' ? codigoRef : zapRef).current?.focus()
  }

  /** Mostra o erro do adaptador (a loja pausou o código: quem abriu decide, ou o formulário mostra). */
  const mostrarErro = (tipo: TipoErro, detalhe?: DetalheErro) => {
    if (tipo === 'nome-invalido') {
      // o servidor não aceitou o nome: o erro fica no campo, com o foco nele (o código continua valendo)
      setNomeRecusado(detalhe?.mensagem ?? TC.nomeRecusado)
      setTentou(true)
      requestAnimationFrame(() => nomeRef.current?.focus())
      return
    }
    if (tipo === 'pausado' && aoPausar) {
      guardarPasso(null)
      aoPausar(detalhe?.mensagem ?? TC.codigoPausado)
      return
    }
    setErroGeral({ tipo, detalhe })
  }

  /** O passo do código fica guardado na aba (recarregar volta nele). */
  const lembrarPasso = (em: number, pediuNome: boolean) => {
    if (modo === 'editar') return
    guardarPasso({ modo, zap: digitos, nome: limparNome(nome), promo, enviadoEm: em, nomePedido: pediuNome })
  }

  /**
   * Pede o código pro número (passo 1). 'codigo' = foi pelo WhatsApp (a tela pede o código); 'direto' = não precisa
   * (a conta do aparelho); null = não deu (o erro já está na tela).
   */
  const pedirCodigo = async (motivo: 'entrar' | 'criar' | 'trocar'): Promise<'codigo' | 'direto' | null> => {
    const p = await adaptador.pedirCodigo(digitos, motivo)
    if (!p.ok) {
      mostrarErro(p.erro, p.detalhe)
      return null
    }
    if (!p.valor.enviado) return 'direto'
    // o limite do número bateu, mas o código que já chegou no WhatsApp ainda vale: vai pro passo do código
    if (p.valor.jaValendo) avisar(T.codigoJaValendo)
    const em = Date.now()
    setCodigo('')
    setEnviadoEm(em)
    setAgora(em)
    setPasso('codigo')
    lembrarPasso(em, nomePedido)
    return 'codigo'
  }

  const concluir = (r: ContaAberta, m: ModoForm) => {
    guardarPasso(null)
    aoSucesso(r, m)
  }

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    if (trava.current) return
    setTentou(true)
    if (erroNome) {
      nomeRef.current?.focus()
      return
    }
    if (erroZap) {
      zapRef.current?.focus()
      return
    }
    const cod = codigo.replace(/\D/g, '')
    if (passo === 'codigo' && cod.length !== 6) {
      setErroGeral({ tipo: 'codigo-curto' })
      codigoRef.current?.focus()
      return
    }
    trava.current = true
    setEnviando(true)
    setErroGeral(null)
    try {
      if (modo === 'criar') {
        if (servidor && passo === 'dados') {
          await pedirCodigo('criar')
          return
        }
        const r = await adaptador.criar({ nome: limparNome(nome), whatsapp: digitos, aceitaPromo: promo, codigo: passo === 'codigo' ? cod : undefined })
        if (r.ok) concluir(r.valor, r.valor.jaTinha ? 'entrar' : modo)
        else if (r.erro === 'precisa-codigo') await pedirCodigo('criar') // o servidor respondeu depois que a tela abriu
        else if (r.erro === 'invalido' || r.erro === 'sem-armazenamento') mostrarErro('falhou')
        else {
          mostrarErro(r.erro, r.detalhe)
          if (r.erro !== 'nome-invalido') codigoRef.current?.select()
        }
      } else if (modo === 'entrar') {
        if (passo === 'dados' && (await pedirCodigo('entrar')) !== 'direto') return
        const comNome = passo === 'nome' || nomePedido
        const r = await adaptador.confirmarCodigo(digitos, passo === 'dados' ? null : cod, comNome ? { nome: limparNome(nome), aceitaPromo: promo } : undefined)
        // criou quando o servidor diz que a conta nasceu agora (com o nome digitado, ou com o da conta do aparelho)
        if (r.ok) concluir(r.valor, r.valor.jaTinha === false ? 'criar' : 'entrar')
        else if (r.erro === 'precisa-nome') {
          // número novo: pede o nome (sem acusar erro num campo que acabou de aparecer)
          setTentou(false)
          setPasso('nome')
          setNomePedido(true)
          lembrarPasso(enviadoEm, true)
        } else if (r.erro === 'codigo-vencido' && passo === 'nome') {
          // o código venceu enquanto a pessoa escrevia o nome (10 min): volta pro passo do código com o nome na tela e o
          // "Mandar outro código" ali (antes ficava um "pede outro" sem botão pra pedir)
          setPasso('codigo')
          setCodigo('')
          setAgora(Date.now())
          setErroGeral({ tipo: 'codigo-vencido-nome' })
        } else {
          mostrarErro(r.erro, r.detalhe)
          if (r.erro !== 'nome-invalido') codigoRef.current?.select()
        }
      } else {
        if (trocandoNumero && passo === 'dados') {
          await pedirCodigo('trocar')
          return
        }
        const r = await adaptador.atualizar({ nome: limparNome(nome), whatsapp: digitos, aceitaPromo: promo, codigo: passo === 'codigo' ? cod : undefined })
        if (r.ok) {
          avisar(T.salvo)
          concluir({ conta: r.valor, cupomGuardado: null }, modo)
        } else if (r.erro === 'precisa-codigo') await pedirCodigo('trocar')
        else if (r.erro === 'invalido') mostrarErro('falhou')
        else mostrarErro(r.erro, r.detalhe)
      }
    } finally {
      trava.current = false
      setEnviando(false)
    }
  }

  const voltarProNumero = () => {
    setPasso('dados')
    setCodigo('')
    setErroGeral(null)
    setNomePedido(false)
    guardarPasso(null)
    requestAnimationFrame(() => zapRef.current?.focus())
  }

  const outroCodigo = async () => {
    if (trava.current || faltaEsperar > 0) return
    trava.current = true
    setEnviando(true)
    setErroGeral(null)
    try {
      const p = await adaptador.pedirCodigo(digitos, modo === 'editar' ? 'trocar' : modo)
      if (!p.ok) mostrarErro(p.erro, p.detalhe)
      else {
        const em = Date.now()
        setCodigo('')
        setEnviadoEm(em)
        setAgora(em)
        lembrarPasso(em, nomePedido)
        avisar(p.valor.jaValendo ? T.codigoJaValendo : T.outroCodigoFoi)
        codigoRef.current?.focus()
      }
    } finally {
      trava.current = false
      setEnviando(false)
    }
  }

  const titulo = passo === 'nome' || (modo === 'entrar' && nomePedido) ? T.primeiraVez : modo === 'criar' ? T.criaTuaConta : modo === 'entrar' ? T.entrar : T.teusDados
  const rotuloBotao =
    passo === 'codigo'
      ? modo === 'editar'
        ? T.confirmarNumero
        : modo === 'criar' || nomePedido
          ? comPremio
            ? T.criarEGuardar
            : T.criarConta
          : T.entrar
      : passo === 'nome'
        ? comPremio
          ? T.criarEGuardar
          : T.criarConta
        : modo === 'criar'
          ? servidor
            ? T.receberCodigo
            : comPremio
              ? T.criarEGuardar
              : T.criarConta
          : modo === 'entrar'
            ? servidor
              ? T.receberCodigo
              : T.entrar
            : trocandoNumero
              ? T.receberCodigo
              : T.salvar
  const noCodigo = passo === 'codigo'
  const erroCodigo = !!erroGeral && ['codigo-errado', 'codigo-curto', 'codigo-vencido', 'codigo-vencido-nome'].includes(erroGeral.tipo)
  // a conta do aparelho leva só os cupons que ainda valem (os vencidos e os usados ficam), e o prêmio reservado nela
  const cuponsQueVao = paraMigrar ? paraMigrar.cupons.filter((c) => statusDo(c, agora) === 'ativo').length : 0
  const premioVai = !!paraMigrar && !!pendenteDoAparelho && pendenteValido(pendenteDoAparelho, pendenteDoAparelho.interativo, agora)
  // dados travados enquanto confere o código (trocar número volta pro passo 1)
  const travado = passo !== 'dados'
  const mostraCheck = modo !== 'entrar' || passo === 'nome' || nomePedido

  return (
    <form className={`form-conta form-${modo}`} onSubmit={enviar} noValidate>
      {modo === 'editar' || tituloMenor ? (
        <h3 id={idTitulo} className="form-titulo form-titulo-p" tabIndex={-1}>
          {titulo}
        </h3>
      ) : (
        <h2 id={idTitulo} className="form-titulo" tabIndex={-1} data-foco-jogo>
          {titulo}
        </h2>
      )}
      {modo === 'criar' && passo === 'dados' && <p className="form-sub">{comPremio ? T.subComPremio : T.subSemPremio}</p>}
      {modo === 'entrar' && passo === 'dados' && servidor && (
        <p className="form-sub">{paraMigrar ? TC.contaDoAparelhoVai(paraMigrar.conta.nome, cuponsQueVao, premioVai) : sessaoCaiuNestaVisita() ? TC.sessaoAcabou : T.entrarSub}</p>
      )}
      {(passo === 'nome' || (noCodigo && nomePedido)) && <p className="form-sub">{T.primeiraVezSub}</p>}

      {pedeNome && (
        <div className="form-campo">
          <label htmlFor={`${uid}-nome`}>{T.teuNome}</label>
          <input
            ref={nomeRef}
            id={`${uid}-nome`}
            value={nome}
            onChange={(e) => {
              setNome(e.target.value)
              setNomeRecusado(null)
            }}
            // o número fica travado no passo do código (o código é dele); o nome não (recarregou no passo do nome, o
            // código venceu enquanto escrevia, o servidor recusou o nome): só no editar, que confirma o número novo
            readOnly={noCodigo && modo === 'editar'}
            placeholder={T.nomePlaceholder}
            autoComplete="name"
            maxLength={60}
            aria-invalid={mostraNome}
            aria-describedby={mostraNome ? `${uid}-enome` : undefined}
            enterKeyHint={passo === 'nome' ? 'go' : 'next'}
            onKeyDown={proximoNoNome}
          />
          {mostraNome && (
            <p id={`${uid}-enome`} className="form-erro">
              {erroNome}
            </p>
          )}
        </div>
      )}

      <div className="form-campo">
        <label htmlFor={`${uid}-zap`}>{T.teuZap}</label>
        <div className="form-zap">
          <span className="form-ddi" aria-hidden="true">
            +55
          </span>
          <input
            ref={zapRef}
            id={`${uid}-zap`}
            value={zap}
            onChange={mudarZap}
            readOnly={travado}
            placeholder={T.zapPlaceholder}
            inputMode="tel"
            type="tel"
            autoComplete="tel-national"
            maxLength={24}
            aria-invalid={mostraZap}
            aria-describedby={mostraZap ? `${uid}-ezap` : trocandoNumero && passo === 'dados' ? `${uid}-lzap` : undefined}
            enterKeyHint={modo === 'entrar' ? 'go' : 'done'}
          />
        </div>
        {mostraZap && (
          <p id={`${uid}-ezap`} className="form-erro">
            {erroZap}
          </p>
        )}
        {trocandoNumero && passo === 'dados' && (
          <p id={`${uid}-lzap`} className="legenda">
            {T.trocarNumeroLegenda}
          </p>
        )}
      </div>

      {noCodigo && (
        <div className="form-campo">
          <label htmlFor={`${uid}-cod`}>{T.codigoZap}</label>
          <p id={`${uid}-lcod`} className="legenda">
            {T.codigoEnviado(mascararCelular(`55${digitos}`))}
          </p>
          <input
            ref={codigoRef}
            id={`${uid}-cod`}
            className="form-codigo"
            value={codigo}
            onChange={(e) => {
              setErroGeral(null)
              setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))
            }}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            aria-describedby={erroCodigo ? `${uid}-lcod ${uid}-ecod` : `${uid}-lcod`}
            aria-invalid={erroCodigo}
            enterKeyHint="go"
          />
          <div className="form-codigo-acoes">
            <button type="button" className="botao-texto toque form-trocar" onClick={voltarProNumero}>
              {T.trocarNumero}
            </button>
            <button type="button" className="botao-texto toque form-trocar" onClick={() => void outroCodigo()} disabled={faltaEsperar > 0 || enviando} aria-disabled={faltaEsperar > 0 || enviando}>
              {faltaEsperar > 0 ? T.outroCodigoEm(faltaEsperar) : T.outroCodigo}
            </button>
          </div>
        </div>
      )}

      {mostraCheck && (
        <div className="form-check">
          <input id={`${uid}-promo`} type="checkbox" checked={promo} disabled={noCodigo && modo === 'editar'} onChange={(e) => setPromo(e.target.checked)} aria-describedby={`${uid}-lpromo`} />
          <label htmlFor={`${uid}-promo`}>{T.promo}</label>
          <p id={`${uid}-lpromo`} className="legenda">
            {T.promoLegenda}
            {!servidor && T.promoLocal}
          </p>
        </div>
      )}

      {(modo === 'criar' || passo === 'nome' || nomePedido) && (
        <>
          <p className="form-linha">{T.mais18}</p>
          <p className="form-linha legenda">{servidor ? T.privacidadeServidor : T.privacidade}</p>
        </>
      )}

      {erroGeral?.tipo === 'whatsapp-existe' && (
        <div className="form-alerta" role="alert">
          <p>{servidor ? T.zapExisteServidor : T.zapExiste}</p>
          {modo === 'criar' && aoTrocarModo && (
            <button type="button" className="botao botao-contorno" onClick={() => aoTrocarModo('entrar')}>
              {T.entrar}
            </button>
          )}
        </div>
      )}
      {erroGeral?.tipo === 'nao-encontrada' && (
        <div className="form-alerta" role="alert">
          <p>{T.naoEncontrada}</p>
          {aoTrocarModo && (
            <button type="button" className="botao botao-contorno" onClick={() => aoTrocarModo('criar')}>
              {T.criarAqui}
            </button>
          )}
        </div>
      )}
      {erroGeral && erroGeral.tipo !== 'whatsapp-existe' && erroGeral.tipo !== 'nao-encontrada' && (
        <p id={`${uid}-ecod`} className="form-alerta" role="alert">
          {fraseDoErro(erroGeral, servidor, modo)}
        </p>
      )}

      <div className="form-acoes">
        <button type="submit" className="botao botao-cheio botao-largo" disabled={enviando} aria-disabled={enviando}>
          {enviando ? (noCodigo || passo === 'nome' || !servidor ? T.guardando : T.mandandoCodigo) : rotuloBotao}
        </button>
        {modo === 'criar' && passo === 'dados' && aoTrocarModo && (
          <button type="button" className="botao-texto toque" onClick={() => aoTrocarModo('entrar')}>
            {T.jaTenhoConta}
          </button>
        )}
        {modo === 'entrar' && passo === 'dados' && aoTrocarModo && (
          <button type="button" className="botao-texto toque" onClick={() => aoTrocarModo('criar')}>
            {T.criarConta}
          </button>
        )}
        {passo === 'nome' && (
          <button type="button" className="botao-texto toque" onClick={voltarProNumero}>
            {T.trocarNumero}
          </button>
        )}
        {modo === 'editar' && aoCancelar && (
          <button type="button" className="botao botao-contorno botao-largo" onClick={aoCancelar}>
            {T.cancelar}
          </button>
        )}
      </div>
    </form>
  )
}

/** A frase de cada erro (a do servidor quando ele manda uma pronta pro caso: limites e código pausado). */
function fraseDoErro(e: Erro, servidor: boolean, modo: ModoForm): string {
  switch (e.tipo) {
    case 'codigo-errado':
      return TC.codigoErrado(e.detalhe?.restam)
    case 'codigo-curto':
      return TC.codigoCurto
    case 'codigo-vencido':
      return T.codigoVencido
    case 'codigo-vencido-nome':
      return TC.codigoVencidoNome
    case 'muitas-tentativas':
      return e.detalhe?.mensagem ?? TC.muitas
    case 'sem-envio':
      return T.semEnvio
    case 'pausado':
      return modo === 'editar' ? TC.trocarPausado : (e.detalhe?.mensagem ?? TC.codigoPausado)
    case 'rede':
      return TC.semConexao
    case 'invalido':
      return T.zapNaoFecha
    default:
      return servidor ? TC.deuErro : T.erroGuardar
  }
}
