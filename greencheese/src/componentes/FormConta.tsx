import { useId, useLayoutEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react'
import { config } from '../dados/config'
import { T } from '../interativos/sorte/textos'
import { armazenamentoOk, useConta, type ContaAberta } from '../lib/conta'
import { conta as adaptador } from '../lib/conta-adaptador'
import { copiarTexto } from '../lib/copiar'
import { celularNoCampo, editarCelular, mascararCelular, normalizarCelular, validarCelular } from '../lib/telefone'
import { linkCompartilhar } from '../lib/url'
import { useChat } from '../store/chat'
import { useUI } from '../store/ui'
import './FormConta.css'

// Criar conta, entrar e editar: o mínimo de campos (nome + WhatsApp). Promoções desligadas por padrão (opt-in
// separado e datado). Na prévia, tudo fica só neste aparelho e a tela diz isso com todas as letras.
// Entrar é em dois passos (número → código do WhatsApp). O adaptador local não manda código: a tela pula o 2º passo.
// Na versão oficial o adaptador do servidor manda, e o campo do código aparece sem mexer aqui.

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
}

const limparNome = (v: string) => v.replace(/\s+/g, ' ').trim()

export function FormConta({ modo, comPremio = false, aoSucesso, aoTrocarModo, aoCancelar, idTitulo }: Props) {
  const atual = useConta()
  const nomeChat = useChat((s) => s.respostas.nome)
  const avisar = useUI((s) => s.avisar)
  const uid = useId()
  const [nome, setNome] = useState(() => (modo === 'editar' ? (atual?.nome ?? '') : limparNome(nomeChat)))
  const [zap, setZap] = useState(() => (modo === 'editar' && atual ? celularNoCampo(atual.whatsapp) : ''))
  const [promo, setPromo] = useState(() => (modo === 'editar' ? !!atual?.aceitaPromo : false))
  const [tentou, setTentou] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erroGeral, setErroGeral] = useState<'whatsapp-existe' | 'nao-encontrada' | 'codigo-errado' | 'muitas-tentativas' | 'falhou' | null>(null)
  // entrar, 2º passo: o código chegou no WhatsApp (só com o adaptador do servidor)
  const [codigoEnviado, setCodigoEnviado] = useState(false)
  const [codigo, setCodigo] = useState('')
  const zapRef = useRef<HTMLInputElement>(null)
  const nomeRef = useRef<HTMLInputElement>(null)
  const codigoRef = useRef<HTMLInputElement>(null)
  // onde o cursor do WhatsApp fica depois de remascarar (o React põe no fim quando troca o valor)
  const cursorZap = useRef<number | null>(null)
  useLayoutEffect(() => {
    const el = zapRef.current
    const c = cursorZap.current
    cursorZap.current = null
    if (el && c != null && document.activeElement === el) el.setSelectionRange(c, c)
  }, [zap])
  useLayoutEffect(() => {
    if (codigoEnviado) codigoRef.current?.focus()
  }, [codigoEnviado])

  const digitos = normalizarCelular(zap)
  const erroNome = modo !== 'entrar' && limparNome(nome).length < 2 ? T.erroNome : null
  const erroZap = validarCelular(digitos)
  const mostraNome = tentou && !!erroNome
  const mostraZap = tentou && !!erroZap

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
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
    e.preventDefault()
    zapRef.current?.focus()
  }

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    setTentou(true)
    if (erroNome) {
      nomeRef.current?.focus()
      return
    }
    if (erroZap) {
      zapRef.current?.focus()
      return
    }
    setEnviando(true)
    setErroGeral(null)
    try {
      if (modo === 'criar') {
        const r = await adaptador.criar({ nome: limparNome(nome), whatsapp: digitos, aceitaPromo: promo })
        if (r.ok) aoSucesso(r.valor, modo)
        else if (r.erro === 'whatsapp-existe') setErroGeral('whatsapp-existe')
        else setErroGeral('falhou')
      } else if (modo === 'entrar') {
        if (!codigoEnviado) {
          const p = await adaptador.pedirCodigo(digitos)
          if (!p.ok) {
            setErroGeral(p.erro)
            return
          }
          if (p.valor.enviado) {
            setCodigoEnviado(true)
            return
          }
        } else if (!codigo.trim()) {
          codigoRef.current?.focus()
          return
        }
        const r = await adaptador.confirmarCodigo(digitos, codigoEnviado ? codigo.trim() : null)
        if (r.ok) aoSucesso(r.valor, modo)
        else setErroGeral(r.erro)
      } else {
        const r = await adaptador.atualizar({ nome: limparNome(nome), whatsapp: digitos, aceitaPromo: promo })
        if (r.ok) {
          avisar(T.salvo)
          aoSucesso({ conta: r.valor, cupomGuardado: null }, modo)
        } else if (r.erro === 'whatsapp-existe') setErroGeral('whatsapp-existe')
        else setErroGeral('falhou')
      }
    } finally {
      setEnviando(false)
    }
  }

  const titulo = modo === 'criar' ? T.criaTuaConta : modo === 'entrar' ? T.entrar : T.teusDados
  const rotuloBotao = modo === 'criar' ? (comPremio ? T.criarEGuardar : T.criarConta) : modo === 'entrar' ? T.entrar : T.salvar
  const servidor = adaptador.modo === 'servidor'

  return (
    <form className={`form-conta form-${modo}`} onSubmit={enviar} noValidate>
      {modo === 'editar' ? (
        <h3 id={idTitulo} className="form-titulo form-titulo-p" tabIndex={-1}>
          {titulo}
        </h3>
      ) : (
        <h2 id={idTitulo} className="form-titulo" tabIndex={-1} data-foco-jogo>
          {titulo}
        </h2>
      )}
      {modo === 'criar' && <p className="form-sub">{comPremio ? T.subComPremio : T.subSemPremio}</p>}

      {modo !== 'entrar' && (
        <div className="form-campo">
          <label htmlFor={`${uid}-nome`}>{T.teuNome}</label>
          <input
            ref={nomeRef}
            id={`${uid}-nome`}
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder={T.nomePlaceholder}
            autoComplete="name"
            maxLength={60}
            aria-invalid={mostraNome}
            aria-describedby={mostraNome ? `${uid}-enome` : undefined}
            enterKeyHint="next"
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
            readOnly={codigoEnviado}
            placeholder={T.zapPlaceholder}
            inputMode="tel"
            type="tel"
            autoComplete="tel-national"
            maxLength={24}
            aria-invalid={mostraZap}
            aria-describedby={mostraZap ? `${uid}-ezap` : undefined}
            enterKeyHint={modo === 'entrar' ? 'go' : 'done'}
          />
        </div>
        {mostraZap && (
          <p id={`${uid}-ezap`} className="form-erro">
            {erroZap}
          </p>
        )}
      </div>

      {modo === 'entrar' && codigoEnviado && (
        <div className="form-campo">
          <label htmlFor={`${uid}-cod`}>{T.codigoZap}</label>
          <p id={`${uid}-lcod`} className="legenda">
            {T.codigoEnviado(mascararCelular(`55${digitos}`))}
          </p>
          <input
            ref={codigoRef}
            id={`${uid}-cod`}
            value={codigo}
            onChange={(e) => {
              setErroGeral(null)
              setCodigo(e.target.value.replace(/[^0-9a-z]/gi, '').slice(0, 8))
            }}
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-describedby={`${uid}-lcod`}
            aria-invalid={erroGeral === 'codigo-errado'}
            enterKeyHint="go"
          />
          <button
            type="button"
            className="botao-texto toque form-trocar"
            onClick={() => {
              setCodigoEnviado(false)
              setCodigo('')
              setErroGeral(null)
              zapRef.current?.focus()
            }}
          >
            {T.trocarNumero}
          </button>
        </div>
      )}

      {modo !== 'entrar' && (
        <div className="form-check">
          <input id={`${uid}-promo`} type="checkbox" checked={promo} onChange={(e) => setPromo(e.target.checked)} aria-describedby={`${uid}-lpromo`} />
          <label htmlFor={`${uid}-promo`}>{T.promo}</label>
          <p id={`${uid}-lpromo`} className="legenda">
            {T.promoLegenda}
            {config.modoPrevia && T.promoPrevia}
          </p>
        </div>
      )}

      {modo === 'criar' && (
        <>
          <p className="form-linha">{T.mais18}</p>
          <p className="form-linha legenda">{T.privacidade}</p>
        </>
      )}

      {erroGeral === 'whatsapp-existe' && (
        <div className="form-alerta" role="alert">
          <p>{T.zapExiste}</p>
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
      {erroGeral === 'codigo-errado' && (
        <p className="form-alerta" role="alert">
          {T.codigoErrado}
        </p>
      )}
      {erroGeral === 'muitas-tentativas' && (
        <p className="form-alerta" role="alert">
          {T.muitasTentativas}
        </p>
      )}
      {erroGeral === 'falhou' && (
        <p className="form-alerta" role="alert">
          {T.erroGuardar}
        </p>
      )}

      <div className="form-acoes">
        <button type="submit" className="botao botao-cheio botao-largo" disabled={enviando && servidor}>
          {enviando && servidor ? T.guardando : rotuloBotao}
        </button>
        {modo === 'criar' && aoTrocarModo && (
          <button type="button" className="botao-texto toque" onClick={() => aoTrocarModo('entrar')}>
            {T.jaTenhoConta}
          </button>
        )}
        {modo === 'entrar' && aoTrocarModo && (
          <button type="button" className="botao-texto toque" onClick={() => aoTrocarModo('criar')}>
            {T.criarConta}
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
