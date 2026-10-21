/**
 * #/desafios — os desafios do LENDA ("As Taças do Rei" e os outros que o admin criar): o que é preciso, o prêmio (o texto
 * que o admin escreve), o regulamento, o prazo, o vencedor e, para quem está logado, o checklist do que já cumpriu
 * (GET desafios.php e desafios.php?eu=1 — servidor/CONTRATO-v33.md).
 * v3.4 (CONTRATO-v34): os desafios de EMBLEMA (todo jogador que cumprir ganha o emblema) vêm primeiro, num grade compacta:
 * dificuldade, chance aproximada (a calibração da §K.4), quantos já têm e, para quem está logado, "você já tem". Os de
 * prêmio continuam como eram, embaixo. `?d=<slug>` (a faixa da tela inicial) rola até o desafio.
 */
import { useEffect, type ReactNode } from 'react'
import { ArrowRight, BadgeCheck, CalendarClock, CircleCheck, CircleDashed, Crown, Hourglass, LogIn, Mail, MessageSquareText, ScrollText, ShieldCheck, Swords, Trophy, Users } from 'lucide-react'
import { buildHash, navigate, useApp } from '@/store/app'
import { useCareer } from '@/store/career'
import { Button, Skeleton, cx, formatInt } from '@/ui/primitives'
import { useAchievementCatalog } from '@/ui/shell/achievementsRegistry'
import { PlaceholderScreen } from '@/ui/shell/Placeholder'
import { useShellSlots } from '@/ui/shell/slots'
import { TrophyArt } from '@/ui/trophies'
import { useConta } from './conta'
import { ROTULO_ESTADO, carreirasQueContam, itensRequisitos, textoChance, textoCriterio, useDesafios, valendo, type Desafio, type MeuDesafio } from './desafios'
import { dataBr } from './datas'
import { NOME_DIFICULDADE, useEmblemas } from './emblemas'
import { Emblema, FilaEmblemas } from '@/ui/shared/emblemas/Emblema'
import { abrirConta, abrirSuporte, abrirVerificarEmail } from './ui'
import './site.css'
import './v33.css'
import './v34.css'

export default function DesafiosTela() {
  useShellSlots({ sub: '', center: <span className="sm-topbar-t">Desafios</span>, stage: { preset: 'legend' } }, [])
  const status = useDesafios((s) => s.status)
  const lista = useDesafios((s) => s.lista)
  const meu = useDesafios((s) => s.meu)
  const meuStatus = useDesafios((s) => s.meuStatus)
  const usuario = useConta((s) => s.usuario)
  const contaPronta = useConta((s) => s.status === 'pronto')

  useEffect(() => {
    void useDesafios.getState().carregar()
  }, [])
  useEffect(() => {
    if (usuario) void useDesafios.getState().carregarMeu(true)
  }, [usuario?.id])

  const alvo = useApp((s) => s.route.query.d)
  // v3.4: os de emblema (valendo) em cima; os de prêmio (ativos ou já vencidos) embaixo, como eram
  const emblemas = lista.filter((d) => d.modo === 'emblema' && (valendo(d) || (d.ativo && !!d.inicio && Date.parse(d.inicio) > Date.now())))
  const visiveis = lista.filter((d) => d.modo !== 'emblema').sort((a, b) => Number(valendo(b)) - Number(valendo(a)))
  // veio da faixa da tela inicial (?d=<slug>): rola até ele
  useEffect(() => {
    if (!alvo || !emblemas.length) return
    const el = document.getElementById(`d-${alvo}`)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.classList.add('is-alvo')
    const t = window.setTimeout(() => el.classList.remove('is-alvo'), 2400)
    return () => {
      window.clearTimeout(t)
      el.classList.remove('is-alvo')
    }
  }, [alvo, emblemas.length])
  if ((status === 'idle' || status === 'carregando') && !lista.length) {
    return (
      <main id="conteudo" tabIndex={-1} className="sv-page outline-none" aria-busy="true" aria-label="Carregando os desafios">
        <Skeleton h={120} r={22} />
        <Skeleton h={320} r={22} />
      </main>
    )
  }
  if (!visiveis.length && !emblemas.length) {
    return (
      <PlaceholderScreen
        eyebrow="Desafios"
        title={status === 'erro' ? 'Não deu para carregar os desafios' : 'Nenhum desafio valendo agora'}
        icon={Swords}
        description={status === 'erro' ? 'Confira a internet e tente de novo em instantes.' : 'Quando um desafio começar, ele aparece aqui e na tela inicial. Enquanto isso, jogue carreiras: as partidas com a conta já contam.'}
        actions={
          <>
            <Button variant="primary" size="md" iconRight={ArrowRight} onClick={() => navigate('/identidade')}>
              Começar uma carreira
            </Button>
            {status === 'erro' && (
              <Button variant="ghost" size="md" onClick={() => void useDesafios.getState().carregar(true)}>
                Tentar de novo
              </Button>
            )}
          </>
        }
      />
    )
  }
  return (
    <main id="conteudo" tabIndex={-1} className="sv-page outline-none">
      <header className="sv-head">
        <span className="sv-head__k">
          <Swords aria-hidden="true" /> Desafios do LENDA
        </span>
        {emblemas.length ? (
          <>
            <h1 className="sv-head__t">Desafios</h1>
            <p className="sv-head__p">Cumpra o desafio numa carreira do Modo Clássico começada com a conta aberta e ganhe o emblema: ele fica no seu perfil e ao lado do seu apelido no Hall. Todo mundo que cumprir ganha.</p>
          </>
        ) : (
          <>
            <h1 className="sv-head__t">Seja o primeiro</h1>
            <p className="sv-head__p">Cada desafio tem um vencedor só: a primeira conta que cumprir tudo, com a carreira conferida pela equipe do LENDA.</p>
          </>
        )}
      </header>
      {emblemas.length > 0 && <SecaoEmblemas lista={emblemas} meu={meu} logado={!!usuario} contaPronta={contaPronta} />}
      {visiveis.length > 0 && emblemas.length > 0 && (
        <>
          <h2 className="s4-premio-h">Desafios com prêmio</h2>
          <p className="sv-head__p">Cada um tem um vencedor só: a primeira conta que cumprir tudo, com a carreira conferida pela equipe do LENDA.</p>
        </>
      )}
      {visiveis.map((d) => (
        <CartaoDesafio key={d.slug} d={d} meu={meu?.[d.slug] ?? null} logado={!!usuario} contaPronta={contaPronta} meuCarregando={meuStatus === 'carregando'} />
      ))}
      <p className="sv-rodape">
        <MessageSquareText aria-hidden="true" />
        <span>
          Ficou com dúvida sobre as regras?{' '}
          <button type="button" className="sc-link" onClick={() => abrirSuporte('duvida')}>
            Fale conosco
          </button>
        </span>
      </p>
    </main>
  )
}

const PESO_DIFICULDADE = { facil: 0, medio: 1, dificil: 2, lendario: 3 } as const

/** v3.4: os desafios de emblema, numa grade compacta. */
function SecaoEmblemas({ lista, meu, logado, contaPronta }: { lista: readonly Desafio[]; meu: Record<string, MeuDesafio> | null; logado: boolean; contaPronta: boolean }) {
  const meus = useEmblemas((s) => s.meus)
  const ordenados = [...lista].sort((a, b) => (a.dificuldade ? PESO_DIFICULDADE[a.dificuldade] : 9) - (b.dificuldade ? PESO_DIFICULDADE[b.dificuldade] : 9))
  const tenho = new Set((meus ?? []).map((e) => e.slug))
  const meusAqui = (meus ?? []).filter((e) => lista.some((d) => d.slug === e.slug))
  return (
    <section className="sv-bloco" aria-labelledby="s4-emb-h">
      <div className="s4-emb-head">
        <h2 id="s4-emb-h">Ganhe emblemas</h2>
        {logado ? (
          meus && (
            <span className="s4-emb-meus">
              {meusAqui.length ? <FilaEmblemas lista={meusAqui} size={18} max={6} /> : null}
              Você tem {meusAqui.length} de {lista.length}
            </span>
          )
        ) : (
          contaPronta && (
            <Button variant="ghost" size="sm" icon={LogIn} onClick={() => abrirConta({ modo: 'manual', aba: 'criar' })}>
              Criar conta para ganhar
            </Button>
          )
        )}
        <p>A chance é a de quem joga para isso (o plano certo para cada desafio, medido em mais de 69 mil carreiras simuladas); jogando ao acaso é bem menor.</p>
      </div>
      <ul className="s4-embs">
        {ordenados.map((d) => (
          <CartaoEmblema key={d.slug} d={d} meu={meu?.[d.slug] ?? null} tem={tenho.has(d.slug) || meu?.[d.slug]?.emblema?.estado === 'ativo'} logado={logado} />
        ))}
      </ul>
    </section>
  )
}

function CartaoEmblema({ d, meu, tem, logado }: { d: Desafio; meu: MeuDesafio | null; tem: boolean; logado: boolean }) {
  const chance = textoChance(d.slug)
  const e = meu?.emblema ?? null
  const retirado = e?.estado === 'retirado'
  // a carreira que cumpre mas não vale (sem a semente do servidor, sem replay, limite do dia...): diz por quê
  const naoVale = !tem && meu ? meu.carreirasQueCumprem.find((c) => c.vale === false) : undefined
  const comecaDepois = !!d.inicio && Date.parse(d.inicio) > Date.now()
  return (
    <li id={`d-${d.slug}`} className={cx('s4-emb', tem && 'is-tem', logado && !tem && 'is-off')}>
      {d.emblema && <Emblema e={{ ...d.emblema, titulo: d.titulo }} size={40} rotulo={`Emblema: ${d.titulo}`} />}
      <div className="s4-emb__top">
        <h3>{d.titulo}</h3>
        {d.dificuldade && <span className={`s4-dif s4-dif--${d.dificuldade}`}>{NOME_DIFICULDADE[d.dificuldade]}</span>}
        {tem && (
          <span className="s4-tem">
            <BadgeCheck aria-hidden="true" /> Você já tem
          </span>
        )}
      </div>
      <p className="s4-emb__p">{d.descricao || textoCriterio(d.criterio)}</p>
      <p className="s4-emb__m">
        {comecaDepois && <span>Começa em {dataBr(d.inicio!)}</span>}
        {chance && (
          <span title="Chance por carreira de quem joga para este desafio (calibração do LENDA)">
            Chance: <b>{chance}</b>
          </span>
        )}
        {d.ganharam !== null && <span>{d.ganharam === 0 ? 'Ninguém tem ainda' : d.ganharam === 1 ? '1 jogador tem' : `${formatInt(d.ganharam)} jogadores têm`}</span>}
        {tem && e?.em && <span>Desde {dataBr(e.em)}{e.jogador ? ` · com ${e.jogador}` : ''}</span>}
        {d.fim && !comecaDepois && <span>Até {dataBr(d.fim, true)}</span>}
      </p>
      {retirado && <p className="s4-emb__x">O emblema foi retirado pela equipe{e?.motivo ? `: ${e.motivo}` : '.'}</p>}
      {naoVale && (
        <p className="s4-emb__x">
          {naoVale.jogador} cumpre, mas não vale: {naoVale.motivo ?? 'a carreira não foi começada com a conta (a semente do servidor).'}
        </p>
      )}
    </li>
  )
}

function Selo({ d }: { d: Desafio }) {
  if (d.vencedor) return <span className="sv-selo is-fim">Tem vencedor</span>
  if (valendo(d)) return <span className="sv-selo is-on">Valendo</span>
  if (d.ativo && d.inicio && Date.parse(d.inicio) > Date.now()) return <span className="sv-selo">Começa em {dataBr(d.inicio)}</span>
  return <span className="sv-selo is-fim">Encerrado</span>
}

function Criterio({ d }: { d: Desafio }) {
  const c = d.criterio
  return (
    <div className="sv-crit">
      {c.copas ? (
        <span className="sv-crit__i">
          <TrophyArt id="world-cup" size={54} title="Copa do Mundo" />
          <b className="num">{c.copas}×</b>
          <small>Copa do Mundo</small>
        </span>
      ) : null}
      {c.libertadores ? (
        <span className="sv-crit__i">
          <TrophyArt id="libertadores" size={54} title="Copa Libertadores" />
          <b className="num">{c.libertadores}×</b>
          <small>Libertadores</small>
        </span>
      ) : null}
      {c.todasConquistas ? (
        <span className="sv-crit__i">
          <span className="sv-crit__ico" aria-hidden="true">
            <Crown />
          </span>
          <b>Todas</b>
          <small>as conquistas</small>
        </span>
      ) : null}
      <p className="sv-crit__t">{textoCriterio(c)}</p>
    </div>
  )
}

type Marca = 'ok' | 'falta' | 'espera'

function Item({ marca, children, acao }: { marca: Marca; children: ReactNode; acao?: ReactNode }) {
  const Ico = marca === 'ok' ? CircleCheck : marca === 'espera' ? Hourglass : CircleDashed
  return (
    <li className={`sv-item is-${marca}`}>
      <Ico aria-hidden="true" />
      <span className="sv-item__t">{children}</span>
      {acao}
      <span className="sc-sr">{marca === 'ok' ? ' (cumprido)' : marca === 'espera' ? ' (esperando)' : ' (falta)'}</span>
    </li>
  )
}

function CartaoDesafio({ d, meu, logado, contaPronta, meuCarregando }: { d: Desafio; meu: MeuDesafio | null; logado: boolean; contaPronta: boolean; meuCarregando: boolean }) {
  const reqs = itensRequisitos(d.requisitos)
  return (
    <article className={cx('sv-desafio', valendo(d) && 'is-valendo')} aria-labelledby={`sv-d-${d.slug}`}>
      <div className="sv-desafio__top">
        <h2 id={`sv-d-${d.slug}`}>{d.titulo}</h2>
        <Selo d={d} />
      </div>
      {d.descricao && <p className="sv-desafio__p">{d.descricao}</p>}
      <Criterio d={d} />

      <div className="sv-premio">
        <Trophy aria-hidden="true" />
        <div>
          <b>Prêmio</b>
          <p>{d.premio || 'O prêmio deste desafio será anunciado aqui.'}</p>
        </div>
      </div>

      <p className="sv-prazo">
        <CalendarClock aria-hidden="true" />
        <span>
          {d.inicio ? `Desde ${dataBr(d.inicio)}` : 'Começa quando for ativado'}
          {/* com vencedor, o desafio já acabou: "vale até alguém vencer" não cabe mais */}
          {d.fim ? ` · até ${dataBr(d.fim, true)}` : d.vencedor ? '' : ' · sem data para acabar: vale até alguém vencer'}
          {d.pendentes > 0 && !d.vencedor ? ` · ${formatInt(d.pendentes)} ${d.pendentes === 1 ? 'carreira em verificação' : 'carreiras em verificação'}` : ''}
        </span>
      </p>

      {d.vencedor && <Vencedor d={d} />}
      {!d.vencedor && d.encerrado && (
        <p className="sv-prazo">
          <Hourglass aria-hidden="true" />
          <span>O prazo deste desafio acabou{d.pendentes > 0 ? ': as carreiras que chegaram a tempo ainda estão em verificação.' : '.'}</span>
        </p>
      )}

      {!d.vencedor && !d.encerrado && (
        <section className="sv-check" aria-label="O que é preciso">
          <h3 className="sc-sec">{logado ? 'Sua situação' : 'O que é preciso'}</h3>
          {logado ? (
            meu ? (
              <Checklist d={d} meu={meu} />
            ) : meuCarregando ? (
              <Skeleton h={120} r={14} />
            ) : (
              <ul className="sv-itens">
                {reqs.map((r) => (
                  <Item key={r.chave} marca="falta">
                    {r.texto}
                  </Item>
                ))}
              </ul>
            )
          ) : (
            <>
              <ul className="sv-itens">
                <Item marca="falta">{textoCriterio(d.criterio)}</Item>
                {reqs.map((r) => (
                  <Item key={r.chave} marca="falta">
                    {r.texto}
                  </Item>
                ))}
              </ul>
              {contaPronta && (
                <Button variant="primary" size="md" icon={LogIn} onClick={() => abrirConta({ modo: 'manual', aba: 'criar' })}>
                  Criar conta para participar
                </Button>
              )}
            </>
          )}
        </section>
      )}

      {d.regulamento && (
        <details className="sv-regul">
          <summary>
            <ScrollText aria-hidden="true" /> Regulamento
          </summary>
          <div className="sv-regul__t">{d.regulamento}</div>
        </details>
      )}
    </article>
  )
}

function Vencedor({ d }: { d: Desafio }) {
  const v = d.vencedor!
  return (
    <div className="sv-vencedor">
      <Crown aria-hidden="true" />
      <div>
        <b>
          Vencedor:{' '}
          {v.perfil ? (
            <a href={buildHash('/jogador', { codigo: v.perfil })} className="sv-link">
              {v.apelido}
            </a>
          ) : (
            v.apelido
          )}
        </b>
        <span>
          {v.jogador ? `com ${v.jogador}` : ''}
          {v.em ? `${v.jogador ? ' · ' : ''}${dataBr(v.em)}` : ''}
        </span>
      </div>
      {v.carreiraId && (
        <Button variant="ghost" size="sm" iconRight={ArrowRight} onClick={() => navigate('/resumo', { query: { id: v.carreiraId!, de: 'comunidade' } })}>
          Ver a carreira
        </Button>
      )}
    </div>
  )
}

/** O checklist do jogador logado (exportado para o teste: src/site/v33corr.test.ts). */
export function Checklist({ d, meu }: { d: Desafio; meu: MeuDesafio }) {
  const usuario = useConta((s) => s.usuario)
  const total = useAchievementCatalog((s) => s.list.length)
  const locais = useCareer((s) => Object.keys(s.achievements).length)
  const r = d.requisitos
  const cumpre = meu.carreirasQueCumprem
  // §E: só as que contam (valem, ou só esperam o Hall) deixam o critério, o Hall e o top 3 verdes; uma sem replay, sem a
  // semente do servidor, do Imersivo ou fora do limite do dia não conta para nada
  const contam = carreirasQueContam(cumpre)
  const naoValem = !contam.length && cumpre.length > 0
  const conquistas = d.criterio.todasConquistas
  const emailOk = meu.emailVerificado || !!usuario?.emailVerificado
  const cand = meu.candidato
  // §E: o pendente/verificado que deixou de cumprir algo (a carreira saiu do Hall, das 3 do perfil...) diz o quê
  const candNaoVale = !!cand && (cand.estado === 'pendente' || cand.estado === 'verificada') && cand.vale === false
  return (
    <>
      {cand && (
        <p className={cx('sv-cand-meu', `is-${cand.estado}`, candNaoVale && 'is-recusada')} role="status">
          <ShieldCheck aria-hidden="true" />
          <span>
            <b>{candNaoVale ? 'Não vale agora' : ROTULO_ESTADO[cand.estado]}</b>
            {candNaoVale
              ? `Sua candidatura está guardada, mas falta uma coisa: ${cand.motivoAgora ?? 'confira os itens abaixo.'} Enquanto isso, ela não pode ser declarada vencedora.`
              : cand.estado === 'pendente'
                ? 'Sua carreira cumpriu tudo e está na fila de verificação da equipe do LENDA.'
                : cand.estado === 'verificada'
                  ? 'Sua carreira foi conferida. Falta a equipe declarar o vencedor.'
                  : cand.estado === 'vencedora'
                    ? 'Você venceu este desafio! A equipe do LENDA entra em contato pelo e-mail da conta.'
                    : (cand.motivo ?? 'A carreira não valeu para este desafio.')}
          </span>
        </p>
      )}
      <ul className="sv-itens">
        {conquistas ? (
          <Item marca={meu.conquistas != null && meu.conquistasTotal != null && meu.conquistas >= meu.conquistasTotal ? 'ok' : 'falta'}>
            {/* v3.4: contam as PROVADAS (por carreiras do Clássico começadas com a conta) */}
            {meu.conquistasTodas != null ? 'Conquistas provadas' : 'Conquistas'}: <b className="num">{formatInt(meu.conquistas ?? locais)}</b> de <b className="num">{formatInt(meu.conquistasTotal ?? total)}</b>
            {meu.conquistas == null ? <small> (neste aparelho)</small> : null}
            {meu.conquistasTodas != null ? (
              <small>
                {' '}
                · {formatInt(meu.conquistasVerificadas ?? 0)} já conferidas · {formatInt(meu.conquistasTodas)} com as não provadas
              </small>
            ) : null}
          </Item>
        ) : (
          <Item marca={contam.length ? 'ok' : 'falta'}>
            {textoCriterio(d.criterio)}
            {contam.length ? <small> · {contam.map((c) => c.jogador).join(', ')}</small> : null}
            {naoValem ? (
              <small>
                {' '}
                · {cumpre[0].jogador} não vale: {cumpre[0].motivo ?? 'veja abaixo'}
              </small>
            ) : null}
          </Item>
        )}
        {r.partidasMin > 0 && (
          <Item marca={meu.partidas >= meu.partidasMin ? 'ok' : 'falta'}>
            Partidas com a conta: <b className="num">{formatInt(Math.min(meu.partidas, meu.partidasMin))}</b> de <b className="num">{formatInt(meu.partidasMin)}</b>
            {meu.partidasDiaMax ? <small> · valem até {formatInt(meu.partidasDiaMax)} por dia{meu.partidasHoje != null ? ` (hoje: ${formatInt(meu.partidasHoje)})` : ''}</small> : null}
          </Item>
        )}
        {r.emailVerificado && (
          <Item
            marca={emailOk ? 'ok' : 'falta'}
            acao={
              !emailOk ? (
                <Button variant="ghost" size="sm" icon={Mail} onClick={() => abrirVerificarEmail()}>
                  Confirmar
                </Button>
              ) : undefined
            }
          >
            E-mail da conta confirmado
          </Item>
        )}
        {!conquistas && r.publicadoNoHall && (
          <Item marca={!contam.length ? 'espera' : contam.some((c) => c.publicada) ? 'ok' : 'falta'}>
            A carreira publicada no Hall das Lendas
            {!contam.length ? <small> · quando tiver uma carreira que cumpra</small> : null}
          </Item>
        )}
        {!conquistas && r.top3Perfil && (
          <Item marca={!contam.length ? 'espera' : contam.some((c) => c.noTop3) ? 'ok' : 'falta'}>
            A carreira entre as 3 do seu perfil público
            {!contam.length ? <small> · quando tiver uma carreira que cumpra</small> : null}
          </Item>
        )}
      </ul>
      {!conquistas && cumpre.length > 0 && (
        <ul className="sv-cumpre" aria-label="Suas carreiras que cumprem o desafio">
          {cumpre.map((c) => (
            <li key={c.carreiraId}>
              <b>{c.jogador}</b>
              <span className={c.publicada ? 'sc-chip sc-chip--ok' : 'sc-chip sc-chip--warn'}>
                <Users aria-hidden="true" /> {c.publicada ? 'No Hall' : 'Fora do Hall'}
              </span>
              <span className={c.noTop3 ? 'sc-chip sc-chip--ok' : 'sc-chip sc-chip--warn'}>{c.noTop3 ? 'No seu perfil' : 'Fora das 3 do perfil'}</span>
              {c.temReplay === false && <span className="sc-chip sc-chip--warn">Sem replay</span>}
              {c.motivo && <small>{c.motivo}</small>}
            </li>
          ))}
        </ul>
      )}
      {!conquistas && !cumpre.length && <p className="sc-hint">Jogue carreiras no Modo Clássico com a conta aberta: a que cumprir o desafio aparece aqui, e a conferência é feita pela equipe do LENDA.</p>}
    </>
  )
}
