/**
 * "Minha conta": quem é, desde quando, as estatísticas que o servidor junta (partidas, carreiras salvas,
 * melhor nota, Bolas de Ouro, gols, títulos, tempo jogado, aparelhos), apelido / time do coração / estado
 * editáveis, Sair e Excluir conta (pede a senha).
 * v3.2: o aviso que a moderação deixou para o dono (H11, mostrado uma vez: ao aparecer, vai o "aviso_lido") e a
 * abertura já rolada até "Convide amigos" (o atalho do menu, X3).
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Copy, Crown, ExternalLink, FolderHeart, LogOut, MailWarning, MessageSquareText, Save, ShieldAlert, Swords, Trash } from 'lucide-react'
import { buildHash, navigate } from '@/store/app'
import { Button, Modal, formatInt, toast } from '@/ui/primitives'
import { mensagemDeErro } from './api'
import { Campo, CampoSenha, CampoUf, Erro, nomeUf, useTecladoVirtual } from './campos'
import { erroApelido, useConta, type AvisoConta, type Usuario } from './conta'
import { track } from './medicao'
import { abrirCarreiras, abrirSuporte, useSiteUi } from './ui'
import { linkPerfil } from './indicacao'
import { FormVerificar } from './VerificarEmail'
import { ContatoDireto } from './FaleConosco'
import { lazySite } from '@/ui/shell/lazySite'
import { useDesafios } from './desafios'
import { useEmblemas } from './emblemas'
import { Emblema } from '@/ui/shared/emblemas/Emblema'
import './site.css'
import './v34.css'

/** O cartão de convites vem num pedaço à parte (sem rede, some sem derrubar a conta). */
const ConvideAmigos = lazySite('ConvideAmigos', () => import('./ConvideAmigos'))

/** As datas ficam em ./datas (as telas novas usam sem puxar este diálogo); daqui continuam saindo para quem já importava. */
export { dataBr } from './datas'
import { dataBr } from './datas'

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

  // o aviso da moderação: o que apareceu nesta abertura continua na tela até fechar (o servidor já o apagou)
  const [avisoVisto, setAvisoVisto] = useState<AvisoConta | null>(null)
  useEffect(() => {
    if (!aberto) {
      setAvisoVisto(null)
      return
    }
    const a = usuario?.aviso
    if (!a) return
    setAvisoVisto(a)
    void useConta.getState().avisoLido()
  }, [aberto, usuario?.aviso])

  return (
    <Modal open={aberto} onClose={fechar} title="Minha conta" size="lg" className="sc-modal">
      {usuario && <Corpo u={usuario} aviso={avisoVisto ?? usuario.aviso} excluirAberto={d?.tipo === 'perfil' && !!d.excluir} irPara={aberto && d?.tipo === 'perfil' ? d.secao : undefined} />}
    </Modal>
  )
}

/** Rola até a seção pedida quando ela aparecer (o cartão de convites vem num pedaço à parte), no máximo ~2 s. */
function useRolarAte(id: string | null) {
  useEffect(() => {
    if (!id) return
    let tentativas = 0
    let t = 0
    const tentar = () => {
      const el = document.getElementById(id)
      // espera o cartão (não o esqueleto): a altura dele é a que vale para rolar certo
      if (el && (el.nextElementSibling?.matches('.sc-conv') || tentativas > 12)) {
        el.scrollIntoView({ block: 'start', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
        el.focus({ preventScroll: true })
        return
      }
      if (tentativas++ < 25) t = window.setTimeout(tentar, 80)
    }
    t = window.setTimeout(tentar, 60)
    return () => window.clearTimeout(t)
  }, [id])
}

function Corpo({ u, aviso, excluirAberto, irPara }: { u: Usuario; aviso: AvisoConta | null; excluirAberto: boolean; irPara?: 'convite' }) {
  const e = u.estatisticas
  const aparelhos = e.aparelhos.map((a) => APARELHO[a] ?? a).join(' · ') || '—'
  useRolarAte(irPara === 'convite' ? 'sc-convite-h' : null)
  return (
    <>
      {aviso && (
        <div className={aviso.tipo === 'desafio' ? 'sc-avisoconta is-desafio' : 'sc-avisoconta'} role="status">
          {aviso.tipo === 'desafio' ? <Crown aria-hidden="true" /> : <ShieldAlert aria-hidden="true" />}
          <div className="min-w-0">
            <b>{aviso.tipo === 'desafio' ? 'Você venceu um desafio!' : 'Aviso da moderação'}</b>
            <p>{aviso.texto}</p>
            <small>{aviso.em ? `${dataBr(aviso.em, true)} · ` : ''}este aviso aparece só uma vez</small>
          </div>
        </div>
      )}
      {!u.emailVerificado && (
        <div className="sv-faixa" role="status">
          <div className="sv-faixa__h">
            <MailWarning aria-hidden="true" />
            <div>
              <b>Confirme o seu e-mail</b>
              <span>Digite o código de 6 dígitos que mandamos para {u.email} (se não achar, veja o spam). Confirmar é um dos requisitos para valer nos desafios.</span>
            </div>
          </div>
          <FormVerificar email={u.email} jaVerificado={false} compacto />
        </div>
      )}
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

      <MeusEmblemas />

      <h3 id="sc-convite-h" className="sc-sec sc-sec--alvo" tabIndex={-1}>
        Indicações e bônus de OVR
      </h3>
      <ConvideAmigos />

      <h3 className="sc-sec">Seu perfil público</h3>
      <LinkPerfil u={u} />

      <h3 className="sc-sec">Seu perfil</h3>
      <FormPerfil u={u} />

      <h3 className="sc-sec">Fale conosco</h3>
      <div className="sc-btns" style={{ marginBottom: 8 }}>
        <Button variant="ghost" size="md" icon={MessageSquareText} onClick={() => abrirSuporte()}>
          Mandar dúvida, ideia ou problema
        </Button>
      </div>
      <ContatoDireto compacto />

      <h3 className="sc-sec">Zona de perigo</h3>
      <Excluir aberto={excluirAberto} />
    </>
  )
}

/**
 * v3.4: os emblemas dos desafios que a conta ganhou (do desafios.php?eu=1, pedido ao abrir a Minha conta se ainda não veio).
 * Servidor sem emblemas (antes da v3.4): a seção não aparece.
 */
function MeusEmblemas() {
  const meus = useEmblemas((s) => s.meus)
  useEffect(() => {
    if (useEmblemas.getState().meus === null) void useDesafios.getState().carregarMeu()
  }, [])
  if (meus === null) return null
  return (
    <>
      <h3 className="sc-sec">Seus emblemas</h3>
      {meus.length ? (
        <ul className="s4-meus" aria-label="Emblemas dos desafios">
          {meus.map((e) => (
            <li key={e.slug} title={e.em ? `Desde ${dataBr(e.em)}${e.jogador ? ` · com ${e.jogador}` : ''}` : undefined}>
              <Emblema e={e} size={22} rotulo={null} />
              <span>{e.titulo || 'Desafio'}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="sc-hint">Nenhum emblema ainda. Cumpra um desafio numa carreira do Modo Clássico começada com a conta e ele aparece aqui, no seu perfil e no Hall.</p>
      )}
      <div className="sc-btns" style={{ margin: '8px 0 6px' }}>
        <Button
          variant="ghost"
          size="sm"
          icon={Swords}
          onClick={() => {
            useSiteUi.getState().fechar()
            navigate('/desafios')
          }}
        >
          Ver os desafios
        </Button>
      </div>
    </>
  )
}

/** O link do perfil público (v3.3): …/lenda/?c=CÓDIGO#/jogador/CÓDIGO, com copiar e abrir. */
function LinkPerfil({ u }: { u: Usuario }) {
  const link = linkPerfil(u.codigoConvite)
  if (!link || !u.codigoConvite) return <p className="sc-hint">O link do seu perfil aparece aqui assim que a conta tiver um código de convite.</p>
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(link)
      toast.success('Link do perfil copiado', 'Quem abrir vê as suas carreiras do Hall e ainda chega como seu convidado.')
    } catch {
      toast.info('Link do seu perfil', link)
    }
  }
  return (
    <div className="sv-perfil-link">
      <p>
        {u.hallPublico === 'nao'
          ? 'Seu perfil está fechado: você escolheu não aparecer no Hall público (mude em “Minhas carreiras”). Quem abrir o link vê “perfil não encontrado”.'
          : 'Mostra o seu apelido, as conquistas e as até 3 carreiras suas no Hall público. É o mesmo código do convite: quem chega por ele também conta como seu convidado.'}
      </p>
      <span className="lx-input">
        <input readOnly value={link} aria-label="Link do seu perfil público" onFocus={(e) => e.currentTarget.select()} />
      </span>
      <div className="sc-btns">
        <Button variant="primary" size="md" icon={Copy} onClick={() => void copiar()}>
          Copiar o link
        </Button>
        <Button
          variant="ghost"
          size="md"
          icon={ExternalLink}
          href={buildHash('/jogador', { codigo: u.codigoConvite })}
          onClick={() => useSiteUi.getState().fechar()}
        >
          Ver meu perfil
        </Button>
      </div>
    </div>
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
