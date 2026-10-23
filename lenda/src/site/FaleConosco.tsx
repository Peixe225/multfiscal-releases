/**
 * "Fale conosco" (v3.3): dúvida, ideia, problema, recomendação ou outro assunto, com ou sem conta, e o e-mail de contato
 * para quem prefere escrever direto. Aberto pelo menu e por Minha conta (abrirSuporte()).
 *
 * Sem conta, o e-mail é obrigatório (é por ele que a resposta chega). O campo "site" é a isca para robôs: fica fora da
 * tela e do teclado; preenchido, o servidor descarta a mensagem sem avisar.
 */
import { useEffect, useState, type FormEvent } from 'react'
import { CircleCheck, Copy, Mail, MessageSquareText, Send } from 'lucide-react'
import { Button, Modal, toast } from '@/ui/primitives'
import { codigoDeErro, mensagemDeErro } from './api'
import { Campo, Erro, aoFocarRolar, useAutoFoco, useTecladoVirtual } from './campos'
import { useConta } from './conta'
import { EMAIL_CONTATO, MENSAGEM_MAX, TIPOS_SUPORTE, enviarSuporte, erroPedido, type TipoSuporte } from './suporte'
import { useSiteUi } from './ui'
import { buildHash, useApp } from '@/store/app'
import './site.css'
import './v33.css'

/** A rota do jogo de agora, como texto curto (até 120 letras). */
export function paginaAtual(): string {
  try {
    const r = useApp.getState().route
    return buildHash(r.path, r.query).slice(1, 121)
  } catch {
    return ''
  }
}

export default function FaleConosco() {
  const d = useSiteUi((s) => s.dialogo)
  const fechar = useSiteUi((s) => s.fechar)
  const aberto = d?.tipo === 'suporte'
  useTecladoVirtual(aberto)
  const assunto = aberto ? d.assunto : undefined
  return (
    <Modal open={aberto} onClose={fechar} size="md" title="Fale conosco" description="Dúvida, ideia, problema ou recomendação: a equipe do LENDA lê todas as mensagens." className="sc-modal">
      {aberto && <Corpo assunto={assunto} fechar={fechar} />}
    </Modal>
  )
}

/**
 * v3.5: o rascunho da mensagem fica guardado enquanto a página está aberta (o voltar do Android, um toque fora ou a troca de
 * rota fecham o diálogo; reabrindo, o texto continua lá). Sai quando a mensagem é enviada.
 */
let rascunho = ''

function Corpo({ assunto, fechar }: { assunto?: TipoSuporte; fechar: () => void }) {
  const autoFoco = useAutoFoco()
  const usuario = useConta((s) => s.usuario)
  const logado = !!usuario
  const [tipo, setTipo] = useState<TipoSuporte>(assunto ?? 'duvida')
  const [mensagem, setMensagemAgora] = useState(() => rascunho)
  const setMensagem = (v: string) => {
    rascunho = v
    setMensagemAgora(v)
  }
  const [email, setEmail] = useState('')
  const [isca, setIsca] = useState('')
  const [tentou, setTentou] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [protocolo, setProtocolo] = useState<string | null | undefined>(undefined)
  // a tela do jogo por baixo do diálogo (vai junto: ajuda a entender o problema), ex.: "/resumo?id=career-…&de=comunidade"
  const [pagina] = useState(() => paginaAtual())
  useEffect(() => {
    if (assunto) setTipo(assunto)
  }, [assunto])

  const pedido = { tipo, mensagem, email, pagina, site: isca }
  const problema = tentou ? erroPedido(pedido, logado) : null
  const restam = MENSAGEM_MAX - mensagem.trim().length

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    setTentou(true)
    const p = erroPedido(pedido, logado)
    if (p) {
      setErro(null)
      return
    }
    setEnviando(true)
    setErro(null)
    try {
      const r = await enviarSuporte(pedido, logado)
      rascunho = ''
      setProtocolo(r.protocolo)
    } catch (err) {
      if (codigoDeErro(err) === 'nao_logado') useConta.getState().sessaoExpirou()
      setErro(codigoDeErro(err) === 'limite' ? 'Você mandou várias mensagens seguidas. Espere alguns minutos e tente de novo (ou escreva para o e-mail abaixo).' : mensagemDeErro(err))
    } finally {
      setEnviando(false)
    }
  }

  if (protocolo !== undefined) {
    return (
      <div className="sc-form" role="status">
        <p className="sc-ok">
          <CircleCheck aria-hidden="true" />
          <span>
            <b>Mensagem enviada. Obrigado!</b>
            {protocolo ? (
              <>
                {' '}
                Protocolo <b className="sv-protocolo">{protocolo}</b>.
              </>
            ) : null}{' '}
            {logado ? `A resposta chega no e-mail da sua conta (${usuario?.email}).` : `A resposta chega em ${email.trim()}.`}
          </span>
        </p>
        <div className="sc-btns">
          <Button variant="primary" size="md" onClick={fechar}>
            Fechar
          </Button>
          <Button
            variant="ghost"
            size="md"
            icon={MessageSquareText}
            onClick={() => {
              setProtocolo(undefined)
              setMensagem('')
              setTentou(false)
            }}
          >
            Mandar outra
          </Button>
        </div>
        <ContatoDireto />
      </div>
    )
  }

  return (
    <form className="sc-form" onSubmit={enviar} noValidate aria-busy={enviando}>
      <fieldset className="sv-tipos">
        <legend className="sc-label">Assunto</legend>
        {TIPOS_SUPORTE.map((t) => (
          <label key={t.valor} className={tipo === t.valor ? 'sv-tipo is-on' : 'sv-tipo'} title={t.dica}>
            <input type="radio" name="sv-tipo" value={t.valor} checked={tipo === t.valor} onChange={() => setTipo(t.valor)} />
            <span>{t.rotulo}</span>
          </label>
        ))}
      </fieldset>
      <p className="sc-hint" style={{ marginTop: -6 }}>
        {TIPOS_SUPORTE.find((t) => t.valor === tipo)?.dica}
      </p>
      <label className="sc-field">
        <span className="sc-label">
          Mensagem <small aria-live="polite">{restam < 200 ? `${Math.max(0, restam)} letras sobrando` : 'de 10 a 2000 letras'}</small>
        </span>
        <textarea
          className="lx-input sc-textarea"
          rows={5}
          maxLength={MENSAGEM_MAX + 50}
          value={mensagem}
          onChange={(e) => setMensagem(e.target.value)}
          placeholder={tipo === 'problema' ? 'O que aconteceu? Em que tela? Se der, diga o aparelho e o navegador.' : 'Escreva aqui'}
          aria-invalid={tentou && !!problema && /mensagem|letras/i.test(problema) ? true : undefined}
          onFocus={aoFocarRolar}
          /* só no computador (v3.5): no celular o teclado subia sozinho e escondia o "Assunto" antes da escolha */
          {...(autoFoco ? { 'data-autofocus': true } : {})}
        />
      </label>
      {!logado && (
        <Campo
          label="Seu e-mail"
          aside="para a resposta chegar"
          type="email"
          inputMode="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={190}
          erro={tentou && problema && /e-mail/i.test(problema) ? problema : null}
        />
      )}
      {/* isca para robôs: fora da tela, do teclado e do leitor de tela */}
      <div className="sv-isca" aria-hidden="true">
        <label>
          Site
          <input type="text" name="site" tabIndex={-1} autoComplete="off" value={isca} onChange={(e) => setIsca(e.target.value)} />
        </label>
      </div>
      {tentou && problema && !/e-mail/i.test(problema) && <Erro>{problema}</Erro>}
      {erro && <Erro>{erro}</Erro>}
      <div className="sc-btns">
        <Button type="submit" variant="primary" size="md" icon={Send} loading={enviando}>
          Enviar mensagem
        </Button>
        <Button type="button" variant="ghost" size="md" onClick={fechar}>
          Cancelar
        </Button>
      </div>
      <ContatoDireto />
    </form>
  )
}

/** O e-mail de contato, com "copiar" (nem todo celular tem um app de e-mail configurado). */
export function ContatoDireto({ compacto = false }: { compacto?: boolean }) {
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(EMAIL_CONTATO)
      toast.success('E-mail copiado', EMAIL_CONTATO)
    } catch {
      toast.info('Nosso e-mail', EMAIL_CONTATO)
    }
  }
  return (
    <p className={compacto ? 'sv-contato is-compacto' : 'sv-contato'}>
      <Mail aria-hidden="true" />
      <span>
        Prefere e-mail? Escreva para{' '}
        <a href={`mailto:${EMAIL_CONTATO}`} className="sv-contato__a">
          {EMAIL_CONTATO}
        </a>
      </span>
      <button type="button" className="sv-contato__copiar" onClick={() => void copiar()} aria-label={`Copiar o e-mail ${EMAIL_CONTATO}`}>
        <Copy aria-hidden="true" />
      </button>
    </p>
  )
}
