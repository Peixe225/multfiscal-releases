import { useId, useRef, useState, type FormEvent } from 'react'
import { config } from '../dados/config'
import { T } from '../interativos/sorte/textos'
import { armazenamentoOk, conta as adaptador, useConta } from '../lib/conta'
import { copiarTexto } from '../lib/copiar'
import { celularNoCampo, formatarCelular, normalizarCelular, validarCelular } from '../lib/telefone'
import { linkCompartilhar } from '../lib/url'
import type { Conta } from '../store/conta'
import { useChat } from '../store/chat'
import { useUI } from '../store/ui'
import './FormConta.css'

// Criar conta, entrar e editar: o mínimo de campos (nome + WhatsApp). Promoções desligadas por padrão (opt-in
// separado e datado). Na prévia, tudo fica só neste aparelho e a tela diz isso com todas as letras.

export type ModoForm = 'criar' | 'entrar' | 'editar'

interface Props {
  modo: ModoForm
  /** Tem prêmio esperando (muda o texto e o botão). */
  comPremio?: boolean
  aoSucesso: (c: Conta, modo: ModoForm) => void
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
  const [erroGeral, setErroGeral] = useState<'whatsapp-existe' | 'nao-encontrada' | 'falhou' | null>(null)
  const zapRef = useRef<HTMLInputElement>(null)
  const nomeRef = useRef<HTMLInputElement>(null)

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

  // máscara progressiva; colar com +55, espaço ou traço normaliza. Apagar um caractere da máscara apaga o dígito.
  const mudarZap = (bruto: string) => {
    setErroGeral(null)
    let d = normalizarCelular(bruto)
    if (d === digitos && bruto.length < zap.length) d = d.slice(0, -1)
    setZap(formatarCelular(d))
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
        const r = await adaptador.entrar(digitos)
        if (r.ok) aoSucesso(r.valor, modo)
        else setErroGeral('nao-encontrada')
      } else {
        const r = await adaptador.atualizar({ nome: limparNome(nome), whatsapp: digitos, aceitaPromo: promo })
        if (r.ok) {
          avisar(T.salvo)
          aoSucesso(r.valor, modo)
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
        <h3 id={idTitulo} className="form-titulo form-titulo-p">
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
            onChange={(e) => mudarZap(e.target.value)}
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
