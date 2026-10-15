/**
 * "Minhas carreiras": aba "Na conta" (lista do servidor: abrir no resumo, apagar, pôr/tirar do Hall público) e aba
 * "Neste aparelho" (Hall local que não está na conta: abrir, salvar na conta).
 * v3.2 (X2): cada carreira da conta mostra onde está no Hall público — "No Hall público", "Entra em breve" (rev3),
 * "Em revisão: entra no Hall assim que for conferida", "Fora do Hall: <motivo>" ou "Privada" —, com o texto do servidor
 * (seloHall).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Cloud, CloudUpload, Crown, Eye, FolderOpen, HardDrive, LogIn, RefreshCw, ShieldAlert, Sparkles, Star, StarOff, Trash, Tv2, Users } from 'lucide-react'
import { navigate } from '@/store/app'
import { useCareer } from '@/store/career'
import { Button, Flag, Modal, OvrPill, Segmented, Tabs, formatInt, toast } from '@/ui/primitives'
import { codigoDeErro, mensagemDeErro } from './api'
import {
  abrirCarreiraDaConta,
  avisoAoPublicar,
  ehTransitoria,
  estrelaDoHall,
  HALL_PUBLICO_MAX,
  idsNaConta,
  idsNoHallPublico,
  nesteAparelho,
  PICO_AUTO,
  removidasNoAparelho,
  resumoLocal,
  seloHall,
  useCarreiras,
  type CarreiraConta,
} from './carreiras'
import { ChipHall } from './SeloHall'
import { useConta, type ModoHallPublico } from './conta'
import { salvarManual } from './salvar'
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
  return <ListaDaConta lista={lista} modo={usuario.hallPublico} apelido={usuario.apelido} />
}

/** Hall público: as 3 melhores sozinhas, as que o jogador escolhe, ou nenhuma — e o aviso do que fica público. */
function ListaDaConta({ lista, modo, apelido }: { lista: CarreiraConta[]; modo: ModoHallPublico; apelido: string }) {
  const noHall = useMemo(() => idsNoHallPublico(lista, modo), [lista, modo])
  const [mudando, setMudando] = useState(false)
  const mudarModo = async (m: ModoHallPublico) => {
    if (m === modo || mudando) return
    setMudando(true)
    try {
      // "eu escolho" vindo do automático: o servidor já marca as 3 que estavam no Hall (nada some de surpresa)
      await useConta.getState().perfil({ hallPublico: m })
      void useCarreiras.getState().carregar(true).catch(() => {})
      // sair do Hall é na hora no servidor (quem já abriu o Hall guarda a página por até 5 min); entrar, na próxima foto
      toast.success(
        m === 'auto' ? 'As 3 melhores vão para o Hall sozinhas' : m === 'manual' ? 'Você escolhe quais vão para o Hall' : 'Nenhuma carreira sua no Hall público',
        m === 'nao' ? 'Elas saem do Hall da comunidade em poucos minutos.' : 'O Hall da comunidade é atualizado a cada 1–3 h.',
      )
    } catch (err) {
      toast.error('Não deu para mudar', mensagemDeErro(err))
    } finally {
      setMudando(false)
    }
  }
  // marcada para o Hall: no "eu escolho", a estrela do jogador (mesmo esperando a revisão); no automático, as que estão lá
  const marcadas = useMemo(() => (modo === 'manual' ? new Set(lista.filter((c) => c.publica).map((c) => c.id)) : noHall), [lista, modo, noHall])
  const alternar = async (c: CarreiraConta) => {
    const sim = !marcadas.has(c.id)
    const quer = sim ? [...marcadas, c.id] : [...marcadas].filter((id) => id !== c.id)
    if (quer.length > HALL_PUBLICO_MAX) {
      toast.info(`Até ${HALL_PUBLICO_MAX} carreiras no Hall público`, 'Tire uma das que estão lá para pôr esta.')
      return
    }
    try {
      // no automático, mexer em uma passa para "eu escolho" mantendo as outras que estavam no Hall (o servidor faz)
      const nova = await useCarreiras.getState().publicar(c.id, sim)
      // o toast segue o `hall` que o servidor devolveu: nada de prometer o Hall a uma carreira que continua fora
      const a = avisoAoPublicar(c.jogador, sim, nova ? nova.hall : c.hall)
      if (a.tipo === 'info') toast.info(a.titulo, a.texto)
      else toast.success(a.titulo, a.texto)
    } catch (err) {
      toast.error('Não deu para mudar o Hall público', codigoDeErro(err) === 'cheio' || codigoDeErro(err) === 'limite_hall' ? `Até ${HALL_PUBLICO_MAX} carreiras no Hall público. Tire uma para pôr outra.` : mensagemDeErro(err))
    }
  }
  return (
    <>
      <section className="sc-hp" aria-labelledby="sc-hp-h">
        <div className="sc-hp__h">
          <span className="sc-hp__i" aria-hidden="true">
            <Users />
          </span>
          <div className="min-w-0">
            <b id="sc-hp-h">Hall público</b>
            <span>
              {noHall.size}/{HALL_PUBLICO_MAX} no Hall da comunidade
            </span>
          </div>
        </div>
        <Segmented<ModoHallPublico>
          size="sm"
          value={modo}
          onChange={(m) => void mudarModo(m)}
          aria-label="Quais carreiras vão para o Hall público"
          options={[
            { value: 'auto', label: 'As 3 melhores' },
            { value: 'manual', label: 'Eu escolho' },
            { value: 'nao', label: 'Nenhuma' },
          ]}
        />
        <p className="sc-hp__aviso">
          <Eye aria-hidden="true" />
          <span>
            {modo === 'nao' ? 'Nenhuma carreira sua aparece para os outros jogadores.' : modo === 'auto' ? 'As 3 de maior nota entram sozinhas no Hall das Lendas da comunidade. ' : `Marque até ${HALL_PUBLICO_MAX} com a estrela. `}
            {modo !== 'nao' && (
              <>
                Fica <b>público</b> para todo mundo: o seu apelido (<b>{apelido}</b>), o nome do jogador e os números da carreira (nota, títulos, gols, clubes, país). O e-mail e o resto da conta nunca aparecem.
              </>
            )}
          </span>
        </p>
      </section>
      <p className="sc-bar">
        <span>Mais recentes primeiro. Abrir mostra o resumo completo da carreira.</span>
      </p>
      <div className="sc-list">
        {lista.map((c) => (
          <Cartao key={c.id} c={c} naConta hall={{ dentro: noHall.has(c.id), marcada: marcadas.has(c.id), modo, alternar: () => alternar(c) }} />
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
  // removidas pela moderação (o servidor recusou com 409 apagada): o selo avisa; salvar de novo só se o admin liberar.
  // Relido quando a lista muda ou um salvar termina (a recusa chega no fim dele)
  const salvando = useCarreiras((s) => s.salvando)
  const removidas = useMemo(() => removidasNoAparelho(), [lista, salvando])
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
          <Cartao key={c.id} c={c} removida={removidas.has(c.id)} />
        ))}
      </div>
    </>
  )
}

function Cartao({ c, naConta, hall, removida }: { c: CarreiraConta; naConta?: boolean; hall?: { dentro: boolean; marcada: boolean; modo: ModoHallPublico; alternar: () => Promise<void> }; removida?: boolean }) {
  const [alternando, setAlternando] = useState(false)
  const salvando = useCarreiras((s) => !!s.salvando[c.id])
  const [abrindo, setAbrindo] = useState(false)
  const [confirmar, setConfirmar] = useState(false)
  const [apagando, setApagando] = useState(false)
  const lenda = c.picoOvr >= PICO_AUTO
  // v3.2: o que o servidor diz do Hall público (só na conta; o aparelho não sabe)
  const selo = naConta ? seloHall(c.hall) : null
  // a estrela some quando a moderação tirou ou a conferência segura a carreira (e com "Nenhuma no Hall"), e quando ela
  // está fora por uma regra que a estrela não muda (Imersivo, nota antiga…), a não ser que esteja marcada (para tirar)
  const podeMarcar = selo ? estrelaDoHall(c.hall, !!hall?.marcada) : !c.oculta && !c.suspeita
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
    await salvarManual(h)
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
        {!!c.bonusOvr && <span className="sc-chip sc-chip--auto">+{c.bonusOvr} de bônus</span>}
        {selo ? (
          <ChipHall selo={selo} />
        ) : (
          <>
            {hall && c.oculta && (
              <span className="sc-chip sc-chip--warn" title="A moderação tirou do Hall público">
                <ShieldAlert aria-hidden="true" /> Fora do Hall (moderação)
              </span>
            )}
            {hall && !c.oculta && c.suspeita && (
              <span className="sc-chip sc-chip--warn" title="Os números estão em análise: fica fora do Hall público até a moderação liberar">
                <ShieldAlert aria-hidden="true" /> Em análise
              </span>
            )}
            {hall && hall.dentro && (
              <span className="sc-chip sc-chip--ok" title="Aparece no Hall das Lendas da comunidade">
                <Users aria-hidden="true" /> No Hall público
              </span>
            )}
          </>
        )}
        {removida && (
          <span className="sc-chip sc-chip--warn" title="A moderação removeu esta carreira da sua conta: ela não sobe sozinha de novo">
            <ShieldAlert aria-hidden="true" /> Removida pela moderação
          </span>
        )}
        <span>{naConta ? `Salva em ${dataBr(c.salvaEm)}` : `Terminou em ${dataBr(c.terminouEm)}`}</span>
      </div>
      {selo?.texto && <p className={`sc-card__hall is-${selo.tom}`}>{selo.texto}</p>}
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
          {naConta && hall && hall.modo !== 'nao' && podeMarcar && (
            <Button
              variant="ghost"
              size="sm"
              icon={hall.marcada ? StarOff : Star}
              loading={alternando}
              aria-pressed={hall.marcada}
              onClick={async () => {
                setAlternando(true)
                await hall.alternar()
                setAlternando(false)
              }}
            >
              {hall.marcada ? 'Tirar do Hall' : 'Pôr no Hall'}
            </Button>
          )}
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
