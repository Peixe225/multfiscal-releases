import { useEffect, useId, useLayoutEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react'
import { T } from '../interativos/sorte/textos'
import { armazenamentoOk, useConta, type ContaAberta } from '../lib/conta'
import { conta as adaptador } from '../lib/conta-adaptador'
import { descobrirModo, useModoConta } from '../lib/conta-modo'
import { copiarTexto } from '../lib/copiar'
import { celularNoCampo, editarCelular, mascararCelular, normalizarCelular, validarCelular } from '../lib/telefone'
import { linkCompartilhar } from '../lib/url'
import { useChat } from '../store/chat'
import { useContaStore } from '../store/conta'
import { useUI } from '../store/ui'
import './FormConta.css'

// Criar conta, entrar e editar: o mínimo de campos (nome + WhatsApp). Promoções desligadas por padrão (opt-in
// separado e datado). Dois jeitos, conforme o modo da conta (src/lib/conta-modo.ts):
// - no aparelho: tudo fica só aqui e a tela diz isso com todas as letras; entrar não pede código;
// - no servidor da loja: o WhatsApp da loja manda um código de 6 números pra provar que o número é da pessoa. Criar e
//   entrar são o mesmo caminho (número → código; número novo pede o nome depois do código), e trocar o WhatsApp da
//   conta também pede o código, que vai pro número novo. A conta do aparelho vai junto no primeiro login.

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
}

type Erro =
  | 'whatsapp-existe'
  | 'nao-encontrada'
  | 'codigo-errado'
  | 'codigo-vencido'
  | 'muitas-tentativas'
  | 'sem-envio'
  | 'invalido'
  | 'falhou'

/** O passo do formulário: os dados; o código que chegou no WhatsApp; o nome (número novo, depois do código). */
type Passo = 'dados' | 'codigo' | 'nome'

const limparNome = (v: string) => v.replace(/\s+/g, ' ').trim()
/** Pausa entre um código e outro (a mesma do servidor). */
const PAUSA_CODIGO = 60

export function FormConta({ modo, comPremio = false, aoSucesso, aoTrocarModo, aoCancelar, idTitulo, tituloMenor = false }: Props) {
  const atual = useConta()
  const modoConta = useModoConta()
  const servidor = modoConta === 'servidor'
  const nomeChat = useChat((s) => s.respostas.nome)
  // a conta do aparelho esperando ir pro servidor: o número já vem no campo
  const paraMigrar = useContaStore((s) => (s.paraMigrar ? (s.contas[s.paraMigrar] ?? null) : null))
  const avisar = useUI((s) => s.avisar)
  const uid = useId()
  const [nome, setNome] = useState(() => (modo === 'editar' ? (atual?.nome ?? '') : (paraMigrar?.conta.nome ?? limparNome(nomeChat))))
  const [zap, setZap] = useState(() => (modo === 'editar' && atual ? celularNoCampo(atual.whatsapp) : paraMigrar ? celularNoCampo(paraMigrar.conta.whatsapp) : ''))
  const [promo, setPromo] = useState(() => (modo === 'editar' ? !!atual?.aceitaPromo : !!paraMigrar?.conta.aceitaPromo))
  const [tentou, setTentou] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erroGeral, setErroGeral] = useState<Erro | null>(null)
  const [passo, setPasso] = useState<Passo>('dados')
  const [codigo, setCodigo] = useState('')
  const [enviadoEm, setEnviadoEm] = useState(0)
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
  // "Mandar outro código" libera depois de 1 min (o relógio só anda no passo do código)
  useEffect(() => {
    if (passo !== 'codigo') return
    const t = window.setInterval(() => setAgora(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [passo])

  const digitos = normalizarCelular(zap)
  // nome: no criar e no editar; no entrar, só quando o número é novo (passo 'nome')
  const pedeNome = modo !== 'entrar' || passo === 'nome'
  const erroNome = pedeNome && limparNome(nome).length < 2 ? T.erroNome : null
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

  // "Próximo" do teclado no nome: vai pro WhatsApp sem enviar (e sem acusar erro num campo que nem foi tocado)
  const proximoNoNome = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing || passo === 'nome') return
    e.preventDefault()
    zapRef.current?.focus()
  }

  /**
   * Pede o código pro número (passo 1). 'codigo' = foi pelo WhatsApp (a tela pede o código); 'direto' = não precisa
   * (a conta do aparelho); null = não deu (o erro já está na tela).
   */
  const pedirCodigo = async (motivo: 'entrar' | 'criar' | 'trocar'): Promise<'codigo' | 'direto' | null> => {
    const p = await adaptador.pedirCodigo(digitos, motivo)
    if (!p.ok) {
      setErroGeral(p.erro)
      return null
    }
    if (!p.valor.enviado) return 'direto'
    // o limite do número bateu, mas o código que já chegou no WhatsApp ainda vale: vai pro passo do código
    if (p.valor.jaValendo) avisar(T.codigoJaValendo)
    setCodigo('')
    setEnviadoEm(Date.now())
    setAgora(Date.now())
    setPasso('codigo')
    return 'codigo'
  }

  const concluir = (r: ContaAberta, m: ModoForm) => {
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
      setErroGeral('codigo-errado')
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
        else if (r.erro === 'whatsapp-existe' || r.erro === 'codigo-errado' || r.erro === 'codigo-vencido' || r.erro === 'muitas-tentativas' || r.erro === 'sem-envio') setErroGeral(r.erro)
        else setErroGeral('falhou')
      } else if (modo === 'entrar') {
        if (passo === 'dados' && (await pedirCodigo('entrar')) !== 'direto') return
        const r = await adaptador.confirmarCodigo(
          digitos,
          passo === 'dados' ? null : cod,
          passo === 'nome' ? { nome: limparNome(nome), aceitaPromo: promo } : undefined,
        )
        if (r.ok) concluir(r.valor, passo === 'nome' && !r.valor.jaTinha ? 'criar' : 'entrar')
        else if (r.erro === 'precisa-nome') {
          // número novo: pede o nome (sem acusar erro num campo que acabou de aparecer)
          setTentou(false)
          setPasso('nome')
        }
        else setErroGeral(r.erro)
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
        else if (r.erro === 'invalido') setErroGeral('falhou')
        else setErroGeral(r.erro)
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
    requestAnimationFrame(() => zapRef.current?.focus())
  }

  const outroCodigo = async () => {
    if (trava.current || faltaEsperar > 0) return
    trava.current = true
    setEnviando(true)
    setErroGeral(null)
    try {
      const p = await adaptador.pedirCodigo(digitos, modo === 'editar' ? 'trocar' : modo)
      if (!p.ok) setErroGeral(p.erro)
      else {
        setCodigo('')
        setEnviadoEm(Date.now())
        setAgora(Date.now())
        avisar(p.valor.jaValendo ? T.codigoJaValendo : T.outroCodigoFoi)
        codigoRef.current?.focus()
      }
    } finally {
      trava.current = false
      setEnviando(false)
    }
  }

  const titulo = passo === 'nome' ? T.primeiraVez : modo === 'criar' ? T.criaTuaConta : modo === 'entrar' ? T.entrar : T.teusDados
  const rotuloBotao =
    passo === 'codigo'
      ? modo === 'editar'
        ? T.confirmarNumero
        : modo === 'criar'
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
  // dados travados enquanto confere o código (trocar número volta pro passo 1)
  const travado = passo !== 'dados'
  const mostraCheck = modo !== 'entrar' || passo === 'nome'

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
      {modo === 'entrar' && passo === 'dados' && servidor && <p className="form-sub">{paraMigrar ? T.contaDoAparelhoVai(paraMigrar.conta.nome, paraMigrar.cupons.length) : T.entrarSub}</p>}
      {passo === 'nome' && <p className="form-sub">{T.primeiraVezSub}</p>}

      {pedeNome && (
        <div className="form-campo">
          <label htmlFor={`${uid}-nome`}>{T.teuNome}</label>
          <input
            ref={nomeRef}
            id={`${uid}-nome`}
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            readOnly={noCodigo}
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
            aria-describedby={`${uid}-lcod`}
            aria-invalid={erroGeral === 'codigo-errado' || erroGeral === 'codigo-vencido'}
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

      {(modo === 'criar' || passo === 'nome') && (
        <>
          <p className="form-linha">{T.mais18}</p>
          <p className="form-linha legenda">{servidor ? T.privacidadeServidor : T.privacidade}</p>
        </>
      )}

      {erroGeral === 'whatsapp-existe' && (
        <div className="form-alerta" role="alert">
          <p>{servidor ? T.zapExisteServidor : T.zapExiste}</p>
          {modo === 'criar' && aoTrocarModo && (
            <button type="button" className="botao botao-contorno" onClick={() => aoTrocarModo('entrar')}>
              {T.entrar}
            </button>
          )}
        </div>
      )}
      {erroGeral === 'nao-encontrada' && (
        <div className="form-alerta" role="alert">
          <p>{T.naoEncontrada}</p>
          {aoTrocarModo && (
            <button type="button" className="botao botao-contorno" onClick={() => aoTrocarModo('criar')}>
              {T.criarAqui}
            </button>
          )}
        </div>
      )}
      {(erroGeral === 'codigo-errado' || erroGeral === 'codigo-vencido') && (
        <p className="form-alerta" role="alert">
          {erroGeral === 'codigo-vencido' ? T.codigoVencido : T.codigoErrado}
        </p>
      )}
      {erroGeral === 'muitas-tentativas' && (
        <p className="form-alerta" role="alert">
          {T.muitasTentativas}
        </p>
      )}
      {erroGeral === 'sem-envio' && (
        <p className="form-alerta" role="alert">
          {T.semEnvio}
        </p>
      )}
      {erroGeral === 'invalido' && (
        <p className="form-alerta" role="alert">
          {T.zapNaoFecha}
        </p>
      )}
      {erroGeral === 'falhou' && (
        <p className="form-alerta" role="alert">
          {T.erroGuardar}
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
