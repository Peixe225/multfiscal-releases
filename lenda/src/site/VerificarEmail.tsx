/**
 * Confirmar o e-mail (v3.3): o código de 6 dígitos que o servidor manda no cadastro (vale 24 h). Abre sozinho logo depois
 * de criar a conta e pela faixa de Minha conta; "Reenviar código" pede outro (3 a cada 10 min, 10 por dia). Requisito
 * dos desafios — e quem não quiser agora fecha e confirma depois.
 */
import { useEffect, useState, type FormEvent } from 'react'
import { CircleCheck, MailCheck, RotateCcw } from 'lucide-react'
import { Button, Modal, toast } from '@/ui/primitives'
import { codigoDeErro, mensagemDeErro } from './api'
import { Campo, Erro, useTecladoVirtual } from './campos'
import { useConta } from './conta'
import { useSiteUi } from './ui'
import './site.css'
import './v33.css'

export default function VerificarEmail() {
  const d = useSiteUi((s) => s.dialogo)
  const fechar = useSiteUi((s) => s.fechar)
  const usuario = useConta((s) => s.usuario)
  const aberto = d?.tipo === 'verificar' && !!usuario
  useTecladoVirtual(aberto)
  // a conta saiu com o diálogo aberto: fecha
  useEffect(() => {
    if (d?.tipo === 'verificar' && !usuario) fechar()
  }, [d, usuario, fechar])
  const depois = aberto && !!d.depoisDoCadastro
  return (
    <Modal open={aberto} onClose={fechar} size="sm" title="Confirme seu e-mail" className="sc-modal">
      {aberto && usuario && <FormVerificar email={usuario.email} depoisDoCadastro={depois} jaVerificado={usuario.emailVerificado} onPronto={fechar} />}
    </Modal>
  )
}

/** Espera entre dois "Reenviar" (o servidor aceita 3 a cada 10 min). */
const ESPERA_REENVIO_S = 45

export function FormVerificar({ email, depoisDoCadastro, jaVerificado, onPronto, compacto = false }: { email: string; depoisDoCadastro?: boolean; jaVerificado: boolean; onPronto?: () => void; compacto?: boolean }) {
  const [codigo, setCodigo] = useState('')
  const [tentou, setTentou] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [reenviando, setReenviando] = useState(false)
  const [espera, setEspera] = useState(depoisDoCadastro ? ESPERA_REENVIO_S : 0)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  useEffect(() => {
    if (espera <= 0) return
    const t = window.setTimeout(() => setEspera((s) => s - 1), 1000)
    return () => window.clearTimeout(t)
  }, [espera])

  if (jaVerificado) {
    return (
      <div className="sc-form">
        <p className="sc-ok" role="status">
          <CircleCheck aria-hidden="true" />
          <span>
            <b>{email}</b> está confirmado.
          </span>
        </p>
        {onPronto && (
          <div className="sc-btns">
            <Button variant="primary" size="md" onClick={onPronto}>
              Fechar
            </Button>
          </div>
        )}
      </div>
    )
  }

  const eC = tentou && !/^\d{6}$/.test(codigo) ? 'O código tem 6 números.' : null
  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    setTentou(true)
    if (!/^\d{6}$/.test(codigo)) return
    setEnviando(true)
    setErro(null)
    try {
      await useConta.getState().verificarEmail(codigo)
      toast.success('E-mail confirmado', 'Pronto: sua conta já pode valer nos desafios.')
      onPronto?.()
    } catch (err) {
      if (codigoDeErro(err) === 'nao_logado') useConta.getState().sessaoExpirou()
      setErro(codigoDeErro(err) === 'limite' ? 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.' : mensagemDeErro(err))
    } finally {
      setEnviando(false)
    }
  }
  const reenviar = async () => {
    if (espera > 0 || reenviando) return
    setReenviando(true)
    setErro(null)
    setAviso(null)
    try {
      const ja = await useConta.getState().reenviarVerificacao()
      if (ja) {
        toast.success('Seu e-mail já está confirmado')
        onPronto?.()
        return
      }
      setAviso(`Mandamos outro código para ${email}. Ele chega em instantes (confira também o spam).`)
      setEspera(ESPERA_REENVIO_S)
    } catch (err) {
      setErro(codigoDeErro(err) === 'limite' ? 'Você já pediu vários códigos. Espere um pouco antes de pedir outro (até 10 por dia).' : mensagemDeErro(err))
    } finally {
      setReenviando(false)
    }
  }

  return (
    <form className="sc-form" onSubmit={enviar} noValidate aria-busy={enviando}>
      {!compacto && (
        <p className="sv-verif__p">
          <MailCheck aria-hidden="true" />
          <span>
            {depoisDoCadastro ? 'Conta criada! ' : ''}Mandamos um código de 6 dígitos para <b>{email}</b> (vale por 24 horas). Confirmar o e-mail é um dos requisitos para valer nos desafios do LENDA.
          </span>
        </p>
      )}
      <Campo
        label="Código de 6 dígitos"
        value={codigo}
        onChange={(v) => setCodigo(v.replace(/\D/g, '').slice(0, 6))}
        erro={eC}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        enterKeyHint="done"
        autoFoco={!compacto}
        style={{ letterSpacing: '.3em', fontWeight: 800 }}
      />
      {erro && <Erro>{erro}</Erro>}
      {aviso && (
        <p className="sc-ok" role="status">
          <CircleCheck aria-hidden="true" />
          <span>{aviso}</span>
        </p>
      )}
      <div className="sc-btns">
        <Button type="submit" variant="primary" size="md" icon={CircleCheck} loading={enviando}>
          Confirmar e-mail
        </Button>
        <Button type="button" variant="ghost" size="md" icon={RotateCcw} loading={reenviando} disabled={espera > 0} onClick={() => void reenviar()}>
          {espera > 0 ? `Reenviar em ${espera} s` : 'Reenviar código'}
        </Button>
        {onPronto && !compacto && (
          <Button type="button" variant="text" size="md" onClick={onPronto}>
            Depois
          </Button>
        )}
      </div>
    </form>
  )
}
