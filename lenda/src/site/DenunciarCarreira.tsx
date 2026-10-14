/**
 * "Denunciar" numa carreira da comunidade (resumo de #/resumo?id=…&de=comunidade): nome ofensivo, trapaça
 * ou outro motivo, com um texto opcional. Precisa estar logado (sem conta, abre o "Entrar"). Uma denúncia por
 * carreira: depois de mandar, o botão vira "Denunciada" neste aparelho.
 */
import { useState, type FormEvent } from 'react'
import { Flag as FlagIcon, Send } from 'lucide-react'
import { Button, Modal, toast } from '@/ui/primitives'
import { codigoDeErro, mensagemDeErro } from './api'
import { Erro } from './campos'
import { useConta } from './conta'
import { denunciar, type MotivoDenuncia } from './hallPublico'
import { armazem } from './medicao'
import { lerIds } from './carreiras'
import { abrirConta } from './ui'
import './site.css'

const CHAVE = 'lenda:denunciadas'
const ls = armazem(() => (typeof window !== 'undefined' ? window.localStorage : undefined))

const MOTIVOS: { v: MotivoDenuncia; t: string; d: string }[] = [
  { v: 'nome', t: 'Nome ofensivo', d: 'O apelido ou o nome do jogador ofende alguém.' },
  { v: 'trapaca', t: 'Trapaça', d: 'Os números parecem impossíveis ou editados.' },
  { v: 'outro', t: 'Outro motivo', d: 'Conte o que aconteceu no campo abaixo.' },
]

export default function DenunciarCarreira({ id, jogador }: { id: string; jogador: string }) {
  const [aberto, setAberto] = useState(false)
  const [feita, setFeita] = useState(() => lerIds(ls, CHAVE).has(id))
  const [motivo, setMotivo] = useState<MotivoDenuncia>('nome')
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const marcar = () => {
    const ids = lerIds(ls, CHAVE)
    ids.add(id)
    ls.set(CHAVE, JSON.stringify([...ids].slice(-300)))
    setFeita(true)
  }
  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    if (motivo === 'outro' && !texto.trim()) {
      setErro('Conte em poucas palavras o que aconteceu.')
      return
    }
    setEnviando(true)
    setErro(null)
    try {
      await denunciar(id, motivo, texto)
      marcar()
      setAberto(false)
      toast.success('Denúncia enviada', 'Obrigado! A moderação vai olhar essa carreira.')
    } catch (err) {
      if (codigoDeErro(err) === 'ja_denunciou') {
        marcar()
        setAberto(false)
        toast.info('Você já denunciou essa carreira', 'Obrigado! A moderação já está sabendo.')
      } else if (codigoDeErro(err) === 'nao_logado') {
        useConta.getState().sessaoExpirou()
        setAberto(false)
        abrirConta({ modo: 'manual', aba: 'entrar' })
      } else setErro(mensagemDeErro(err))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <>
      <Button
        variant="text"
        size="lg"
        icon={FlagIcon}
        disabled={feita}
        onClick={() => {
          if (!useConta.getState().usuario) {
            toast.info('Entre na sua conta para denunciar', 'Assim a moderação sabe que é uma pessoa de verdade.')
            abrirConta({ modo: 'manual', aba: 'entrar' })
            return
          }
          setErro(null)
          setAberto(true)
        }}
      >
        {feita ? 'Denunciada' : 'Denunciar'}
      </Button>
      <Modal open={aberto} onClose={() => setAberto(false)} size="sm" title="Denunciar carreira" description={`O que há de errado com ${jogador}? A moderação do LENDA vai olhar.`} className="sc-modal">
        <form className="sc-form" onSubmit={enviar} noValidate>
          <fieldset className="sc-motivos">
            <legend className="sc-sr">Motivo</legend>
            {MOTIVOS.map((m) => (
              <label key={m.v} className={motivo === m.v ? 'sc-motivo is-on' : 'sc-motivo'}>
                <input type="radio" name="motivo" value={m.v} checked={motivo === m.v} onChange={() => setMotivo(m.v)} />
                <span>
                  <b>{m.t}</b>
                  <small>{m.d}</small>
                </span>
              </label>
            ))}
          </fieldset>
          <label className="sc-field">
            <span className="sc-label">
              Detalhes <small>{motivo === 'outro' ? 'obrigatório' : 'opcional'}</small>
            </span>
            <textarea className="lx-input sc-textarea" rows={3} maxLength={500} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Ex.: o nome é um xingamento" />
          </label>
          {erro && <Erro>{erro}</Erro>}
          <div className="sc-btns">
            <Button type="submit" variant="primary" size="md" icon={Send} loading={enviando}>
              Enviar denúncia
            </Button>
            <Button type="button" variant="ghost" size="md" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      </Modal>
    </>
  )
}
