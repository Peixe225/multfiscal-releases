/**
 * "Minhas carreiras": aba "Na conta" (lista do servidor: abrir no resumo, apagar) e aba "Neste aparelho"
 * (Hall local que não está na conta: abrir, salvar na conta).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Cloud, CloudUpload, Crown, FolderOpen, HardDrive, LogIn, RefreshCw, Sparkles, Trash, Tv2 } from 'lucide-react'
import { navigate } from '@/store/app'
import { useCareer } from '@/store/career'
import { Button, Flag, Modal, OvrPill, Tabs, formatInt, toast } from '@/ui/primitives'
import { mensagemDeErro } from './api'
import {
  abrirCarreiraDaConta,
  ehTransitoria,
  idsNaConta,
  nesteAparelho,
  PICO_AUTO,
  resumoLocal,
  useCarreiras,
  type CarreiraConta,
} from './carreiras'
import { useConta } from './conta'
import { dataBr } from './MinhaConta'
import { abrirConta, useSiteUi, type AbaCarreiras } from './ui'
import './site.css'

export default function MinhasCarreiras() {
  const d = useSiteUi((s) => s.dialogo)
  const fechar = useSiteUi((s) => s.fechar)
  const aberto = d?.tipo === 'carreiras'
  const usuario = useConta((s) => s.usuario)
  const [aba, setAba] = useState<AbaCarreiras>('conta')
  const lista = useCarreiras((s) => s.lista)
  const limite = useCarreiras((s) => s.limite)
  const hall = useCareer((s) => s.finishedCareers)
  const locais = useMemo(() => nesteAparelho(hall.filter((h) => !ehTransitoria(h.id)), idsNaConta(lista)), [hall, lista])

  useEffect(() => {
    if (!aberto) return
    setAba(d.aba ?? (usuario ? 'conta' : 'aparelho'))
    if (usuario) void useCarreiras.getState().carregar(true).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto])

  return (
    <Modal open={aberto} onClose={fechar} title="Minhas carreiras" description={usuario ? `Conta de ${usuario.apelido}` : 'Entre para guardar suas carreiras em qualquer aparelho'} size="xl" className="sc-modal">
      <Tabs
        aria-label="Onde estão as carreiras"
        idPrefix="sc-carr"
        className="sc-tabs"
        value={aba}
        onChange={setAba}
        tabs={[
          { value: 'conta', label: 'Na conta', icon: Cloud, badge: usuario && lista ? `${lista.length}/${limite}` : undefined },
          { value: 'aparelho', label: 'Neste aparelho', icon: HardDrive, badge: locais.length ? String(locais.length) : undefined },
        ]}
      />
      <div role="tabpanel" id={`sc-carr-panel-${aba}`} aria-labelledby={`sc-carr-tab-${aba}`}>
        {aba === 'conta' ? <NaConta /> : <NoAparelho />}
      </div>
    </Modal>
  )
}

function NaConta() {
  const usuario = useConta((s) => s.usuario)
  const lista = useCarreiras((s) => s.lista)
  const carregando = useCarreiras((s) => s.carregando)
  const erro = useCarreiras((s) => s.erro)
  if (!usuario) {
    return (
      <div className="sc-empty">
        <Cloud aria-hidden="true" />
        <b>Suas carreiras em qualquer aparelho</b>
        <p>Com uma conta, as carreiras de pico {PICO_AUTO}+ vão sozinhas para lá, e as outras você salva com um toque.</p>
        <Button variant="primary" size="md" icon={LogIn} onClick={() => abrirConta({ modo: 'manual' })}>
          Entrar / Criar conta
        </Button>
      </div>
    )
  }
  if (erro && !lista) {
    return (
      <div className="sc-empty">
        <Cloud aria-hidden="true" />
        <b>Não deu para carregar</b>
        <p>{erro}</p>
        <Button variant="ghost" size="md" icon={RefreshCw} loading={carregando} onClick={() => void useCarreiras.getState().carregar(true).catch(() => {})}>
          Tentar de novo
        </Button>
      </div>
    )
  }
  if (!lista) {
    return (
      <div className="sc-list" aria-busy="true" aria-label="Carregando">
        <div className="sc-sk" />
        <div className="sc-sk" />
        <div className="sc-sk" />
      </div>
    )
  }
  if (!lista.length) {
    return (
      <div className="sc-empty">
        <FolderOpen aria-hidden="true" />
        <b>Nenhuma carreira na conta ainda</b>
        <p>Termine uma carreira com pico {PICO_AUTO}+ e ela aparece aqui sozinha. As outras você salva pela aba "Neste aparelho" ou no fim da carreira.</p>
      </div>
    )
  }
  return (
    <>
      <p className="sc-bar">
        <span>Mais recentes primeiro. Abrir mostra o resumo completo da carreira.</span>
      </p>
      <div className="sc-list">
        {lista.map((c) => (
          <Cartao key={c.id} c={c} naConta />
        ))}
      </div>
    </>
  )
}

function NoAparelho() {
  const hall = useCareer((s) => s.finishedCareers)
  const lista = useCarreiras((s) => s.lista)
  const usuario = useConta((s) => s.usuario)
  const locais = useMemo(() => nesteAparelho(hall.filter((h) => !ehTransitoria(h.id)), idsNaConta(lista)).map(resumoLocal), [hall, lista])
  if (!hall.length) {
    return (
      <div className="sc-empty">
        <HardDrive aria-hidden="true" />
        <b>Nenhuma carreira terminada neste aparelho</b>
        <p>Jogue até a aposentadoria: a carreira entra no Hall das Lendas e aparece aqui.</p>
        <Button
          variant="primary"
          size="md"
          onClick={() => {
            useSiteUi.getState().fechar()
            navigate('/identidade')
          }}
        >
          Começar uma carreira
        </Button>
      </div>
    )
  }
  if (!locais.length) {
    return (
      <div className="sc-empty">
        <Sparkles aria-hidden="true" />
        <b>Tudo salvo</b>
        <p>Todas as carreiras do Hall deste aparelho já estão na sua conta.</p>
      </div>
    )
  }
  return (
    <>
      <p className="sc-bar">
        <span>{usuario ? 'Carreiras do Hall deste aparelho que ainda não estão na conta.' : 'Carreiras do Hall deste aparelho. Entre na conta para guardá-las.'}</span>
      </p>
      <div className="sc-list">
        {locais.map((c) => (
          <Cartao key={c.id} c={c} />
        ))}
      </div>
    </>
  )
}

function Cartao({ c, naConta }: { c: CarreiraConta; naConta?: boolean }) {
  const salvando = useCarreiras((s) => !!s.salvando[c.id])
  const [abrindo, setAbrindo] = useState(false)
  const [confirmar, setConfirmar] = useState(false)
  const [apagando, setApagando] = useState(false)
  const lenda = c.picoOvr >= PICO_AUTO
  // a confirmação aparece no lugar dos botões: o foco vai para "Cancelar" e, ao cancelar, volta ao "Apagar"
  const cancelar = useRef<HTMLButtonElement>(null)
  const apagarBtn = useRef<HTMLButtonElement>(null)
  const jaConfirmou = useRef(false)
  useEffect(() => {
    if (confirmar) cancelar.current?.focus({ preventScroll: true })
    else if (jaConfirmou.current) apagarBtn.current?.focus({ preventScroll: true })
    jaConfirmou.current = confirmar
  }, [confirmar])

  const abrir = async () => {
    setAbrindo(true)
    try {
      await abrirCarreiraDaConta(c.id)
      useSiteUi.getState().fechar()
    } catch (err) {
      toast.error('Não deu para abrir a carreira', mensagemDeErro(err))
    } finally {
      setAbrindo(false)
    }
  }
  const salvar = async () => {
    if (!useConta.getState().usuario) {
      abrirConta({ modo: 'manual', depois: { salvar: c.id } })
      return
    }
    const h = useCareer.getState().finishedCareers.find((x) => x.id === c.id)
    if (!h) return
    try {
      await useCarreiras.getState().salvar(h, 'manual')
      toast.success('Salva na sua conta', `${c.jogador} · pico ${c.picoOvr}`)
    } catch (err) {
      toast.error('Não deu para salvar na conta', mensagemDeErro(err))
    }
  }
  const apagar = async () => {
    setApagando(true)
    try {
      await useCarreiras.getState().apagar(c.id)
      toast.info('Carreira apagada da conta', useCareer.getState().finishedCareers.some((h) => h.id === c.id && !ehTransitoria(h.id)) ? 'Ela continua no Hall deste aparelho.' : undefined)
    } catch (err) {
      toast.error('Não deu para apagar', mensagemDeErro(err))
      setApagando(false)
    }
  }

  return (
    <article className={lenda ? 'sc-card sc-card--lenda' : 'sc-card'} aria-label={`${c.jogador}, pico ${c.picoOvr}`}>
      <div className="sc-card__top">
        <span className="sc-card__ovr">
          <OvrPill ovr={c.picoOvr} />
          <small>Pico</small>
        </span>
        <div className="sc-card__id">
          <b>{c.jogador}</b>
          <span>
            {c.pais && <Flag code={c.pais} h={12} decorative />}
            {c.pais} · #{c.numero} · {c.posicao}
          </span>
        </div>
        <span className="sc-card__nota" title="Nota de Legado (0 a 100)">
          <b className="num">{c.nota ?? '—'}</b>
          <small>Nota</small>
        </span>
      </div>
      {c.headline && <p className="sc-card__hl">{c.headline}</p>}
      <dl className="sc-card__nums">
        <div>
          <dt>Temp.</dt>
          <dd className="num">{formatInt(c.temporadas)}</dd>
        </div>
        <div>
          <dt>Gols</dt>
          <dd className="num">{formatInt(c.gols)}</dd>
        </div>
        <div>
          <dt>Títulos</dt>
          <dd className="num">{formatInt(c.titulos)}</dd>
        </div>
        <div className={c.bolasOuro ? 'is-gold' : undefined}>
          <dt>Bolas</dt>
          <dd className="num">{formatInt(c.bolasOuro)}</dd>
        </div>
      </dl>
      <div className="sc-card__meta">
        <span className="sc-chip">
          {c.modo === 'imersivo' ? <Tv2 aria-hidden="true" /> : <Crown aria-hidden="true" />}
          {c.modo === 'imersivo' ? 'Imersivo' : 'Clássico'}
        </span>
        {naConta && c.como && (
          <span className={c.como === 'auto' ? 'sc-chip sc-chip--auto' : 'sc-chip'} title={c.como === 'auto' ? 'Foi para a conta sozinha (pico 90+)' : 'Você salvou'}>
            {c.como === 'auto' ? 'Automática' : 'Manual'}
          </span>
        )}
        <span>{naConta ? `Salva em ${dataBr(c.salvaEm)}` : `Terminou em ${dataBr(c.terminouEm)}`}</span>
      </div>
      {confirmar ? (
        <div className="sc-confirm" role="group" aria-label="Confirmar">
          <p>
            Apagar <b>{c.jogador}</b> da conta? Se ela estiver no Hall deste aparelho, continua lá.
          </p>
          <div className="sc-btns">
            <Button variant="danger" size="sm" icon={Trash} loading={apagando} onClick={apagar}>
              Apagar
            </Button>
            <Button ref={cancelar} variant="ghost" size="sm" onClick={() => setConfirmar(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <div className="sc-card__acts">
          <Button variant="primary" size="sm" icon={FolderOpen} loading={abrindo} onClick={abrir}>
            Abrir
          </Button>
          {naConta ? (
            <Button ref={apagarBtn} variant="ghost" size="sm" icon={Trash} onClick={() => setConfirmar(true)} aria-label={`Apagar ${c.jogador} da conta`}>
              Apagar
            </Button>
          ) : (
            <Button variant="ghost" size="sm" icon={CloudUpload} loading={salvando} onClick={salvar}>
              Salvar na conta
            </Button>
          )}
        </div>
      )}
    </article>
  )
}
