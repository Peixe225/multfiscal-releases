/**
 * "Minha conta": quem é, desde quando, as estatísticas que o servidor junta (partidas, carreiras salvas,
 * melhor nota, Bolas de Ouro, gols, títulos, tempo jogado, aparelhos), apelido / time do coração / estado
 * editáveis, Sair e Excluir conta (pede a senha).
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { FolderHeart, LogOut, Save, Trash } from 'lucide-react'
import { navigate } from '@/store/app'
import { Button, Modal, formatInt, toast } from '@/ui/primitives'
import { mensagemDeErro } from './api'
import { Campo, CampoSenha, CampoUf, Erro, nomeUf, useTecladoVirtual } from './campos'
import { erroApelido, useConta, type Usuario } from './conta'
import { track } from './medicao'
import { abrirCarreiras, useSiteUi } from './ui'
import './site.css'

const DIA = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' })
const DIA_HORA = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })

export function dataBr(iso: string | null | undefined, comHora = false): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : (comHora ? DIA_HORA : DIA).format(d)
}

/** "2 h 20 min", "45 min" */
export function tempoJogado(min: number): string {
  const m = Math.max(0, Math.round(min))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r ? `${formatInt(h)} h ${r} min` : `${formatInt(h)} h`
}

const APARELHO: Record<string, string> = { mobile: 'Celular', tablet: 'Tablet', desktop: 'Computador' }

export default function MinhaConta() {
  const d = useSiteUi((s) => s.dialogo)
  const fechar = useSiteUi((s) => s.fechar)
  const usuario = useConta((s) => s.usuario)
  const aberto = d?.tipo === 'perfil' && !!usuario
  useTecladoVirtual(aberto)

  // estatísticas frescas a cada abertura
  useEffect(() => {
    if (aberto) void useConta.getState().carregar()
  }, [aberto])
  // a conta saiu (sessão expirou, excluiu) com o diálogo aberto: fecha
  useEffect(() => {
    if (d?.tipo === 'perfil' && !usuario) fechar()
  }, [d, usuario, fechar])

  return (
    <Modal open={aberto} onClose={fechar} title="Minha conta" size="lg" className="sc-modal">
      {usuario && <Corpo u={usuario} excluirAberto={d?.tipo === 'perfil' && !!d.excluir} />}
    </Modal>
  )
}

function Corpo({ u, excluirAberto }: { u: Usuario; excluirAberto: boolean }) {
  const e = u.estatisticas
  const aparelhos = e.aparelhos.map((a) => APARELHO[a] ?? a).join(' · ') || '—'
  return (
    <>
      <div className="sc-perfil__head">
        <span className="sc-avatar sc-avatar--lg" aria-hidden="true">
          {u.apelido.trim().charAt(0) || '?'}
        </span>
        <div style={{ minWidth: 0 }}>
          <b>{u.apelido}</b>
          <span>{u.email}</span>
          <span>Na conta desde {dataBr(u.criadoEm)}</span>
        </div>
      </div>

      <dl className="sc-stats" aria-label="Suas estatísticas">
        <div className="sc-stat">
          <dt>Partidas</dt>
          <dd className="num">{formatInt(e.partidas)}</dd>
        </div>
        <div className="sc-stat">
          <dt>Carreiras salvas</dt>
          <dd className="num">{formatInt(e.carreirasSalvas)}</dd>
        </div>
        <div className="sc-stat sc-stat--gold">
          <dt>Melhor nota</dt>
          <dd className="num">
            {e.melhorNota ?? '—'}
            {e.melhorJogador && <small>{e.melhorJogador}</small>}
          </dd>
        </div>
        <div className="sc-stat sc-stat--gold">
          <dt>Bolas de Ouro</dt>
          <dd className="num">{formatInt(e.bolasOuro)}</dd>
        </div>
        <div className="sc-stat">
          <dt>Gols</dt>
          <dd className="num">{formatInt(e.gols)}</dd>
        </div>
        <div className="sc-stat">
          <dt>Títulos</dt>
          <dd className="num">{formatInt(e.titulos)}</dd>
        </div>
        <div className="sc-stat">
          <dt>Tempo jogado</dt>
          <dd className="num">{tempoJogado(e.tempoJogadoMin)}</dd>
        </div>
        <div className="sc-stat">
          <dt>Aparelhos</dt>
          <dd style={{ fontSize: 15, fontFamily: 'var(--font-ui)', lineHeight: 1.3, whiteSpace: 'normal' }}>{aparelhos}</dd>
        </div>
      </dl>
      <p className="sc-meta">
        Gols, títulos, Bolas de Ouro e melhor nota somam as carreiras salvas na conta. Primeiro acesso: {dataBr(e.primeiroAcesso, true)} · último: {dataBr(e.ultimoAcesso, true)}
        {u.origem ? ` · chegou por: ${u.origem}` : ''}
      </p>

      <div className="sc-btns" style={{ marginBottom: 6 }}>
        <Button variant="primary" size="md" icon={FolderHeart} onClick={() => abrirCarreiras('conta')}>
          Minhas carreiras
        </Button>
        <BotaoSair />
      </div>

      <h3 className="sc-sec">Seu perfil</h3>
      <FormPerfil u={u} />

      <h3 className="sc-sec">Zona de perigo</h3>
      <Excluir aberto={excluirAberto} />
    </>
  )
}

function BotaoSair() {
  const [carregando, setCarregando] = useState(false)
  return (
    <Button
      variant="ghost"
      size="md"
      icon={LogOut}
      loading={carregando}
      onClick={async () => {
        setCarregando(true)
        try {
          await useConta.getState().sair()
          track('logout')
          toast.info('Você saiu da conta', 'Suas carreiras continuam neste aparelho.')
        } catch {
          toast.info('Você saiu da conta neste aparelho')
        } finally {
          setCarregando(false)
          useSiteUi.getState().fechar()
        }
      }}
    >
      Sair
    </Button>
  )
}

function FormPerfil({ u }: { u: Usuario }) {
  const [apelido, setApelido] = useState(u.apelido)
  const [time, setTime] = useState(u.timeCoracao ?? '')
  const [uf, setUf] = useState(u.uf ?? '')
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  // o servidor mandou valores novos (outra aba, recarga): mostra os de lá
  useEffect(() => {
    setApelido(u.apelido)
    setTime(u.timeCoracao ?? '')
    setUf(u.uf ?? '')
  }, [u.apelido, u.timeCoracao, u.uf])
  const mudou = apelido.trim() !== u.apelido || time.trim() !== (u.timeCoracao ?? '') || uf !== (u.uf ?? '')
  const eA = erroApelido(apelido.trim())
  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    if (!mudou || carregando) return
    if (eA) {
      setErro(eA)
      return
    }
    setCarregando(true)
    setErro(null)
    try {
      await useConta.getState().perfil({ apelido: apelido.trim(), timeCoracao: time, uf })
      toast.success('Perfil salvo')
    } catch (err) {
      setErro(mensagemDeErro(err))
    } finally {
      setCarregando(false)
    }
  }
  return (
    <form className="sc-form" onSubmit={enviar} noValidate>
      <Campo label="Apelido" value={apelido} onChange={(v) => setApelido(v.slice(0, 20))} maxLength={20} autoComplete="nickname" erro={apelido.trim() !== u.apelido && eA ? eA : null} />
      <div className="sc-row2">
        <Campo label="Time do coração" aside="opcional" value={time} onChange={(v) => setTime(v.slice(0, 40))} maxLength={40} autoComplete="off" placeholder="Ex.: Flamengo" />
        <CampoUf value={uf} onChange={setUf} aside={uf ? undefined : 'opcional'} />
      </div>
      {!mudou && (u.timeCoracao || u.uf) && (
        <p className="sc-hint">
          {[u.timeCoracao, nomeUf(u.uf)].filter(Boolean).join(' · ')}
        </p>
      )}
      {erro && <Erro>{erro}</Erro>}
      <div className="sc-btns">
        <Button type="submit" variant="ghost" size="md" icon={Save} loading={carregando} disabled={!mudou}>
          Salvar alterações
        </Button>
      </div>
    </form>
  )
}

function Excluir({ aberto }: { aberto: boolean }) {
  const [confirmar, setConfirmar] = useState(aberto)
  const [senha, setSenha] = useState('')
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const caixa = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (aberto) setConfirmar(true)
  }, [aberto])
  useEffect(() => {
    if (confirmar) caixa.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [confirmar])
  if (!confirmar) {
    return (
      <Button variant="text" size="sm" icon={Trash} onClick={() => setConfirmar(true)}>
        Excluir minha conta
      </Button>
    )
  }
  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    if (!senha) {
      setErro('Digite a sua senha para confirmar.')
      return
    }
    setCarregando(true)
    setErro(null)
    try {
      await useConta.getState().excluir(senha)
      useSiteUi.getState().fechar()
      toast.info('Conta excluída', 'Apagamos sua conta e as carreiras salvas nela. As deste aparelho continuam aqui.')
      navigate('/')
    } catch (err) {
      setErro(mensagemDeErro(err))
      setCarregando(false)
    }
  }
  return (
    <div ref={caixa} className="sc-confirm">
      <p>
        <b>Excluir a conta apaga tudo dela, para sempre:</b> o perfil, as estatísticas e as carreiras salvas na conta. O Hall das Lendas deste aparelho continua aqui.
      </p>
      <form className="sc-form" onSubmit={enviar} noValidate>
        <CampoSenha label="Sua senha" value={senha} onChange={setSenha} autoFoco enterKeyHint="done" />
        {erro && <Erro>{erro}</Erro>}
        <div className="sc-btns">
          <Button type="submit" variant="danger" size="md" icon={Trash} loading={carregando}>
            Excluir para sempre
          </Button>
          <Button type="button" variant="ghost" size="md" onClick={() => (setConfirmar(false), setSenha(''), setErro(null))}>
            Cancelar
          </Button>
        </div>
      </form>
    </div>
  )
}
