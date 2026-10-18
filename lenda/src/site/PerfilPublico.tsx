/**
 * #/jogador/<código> — o perfil público de um jogador (GET perfil.php?c= — servidor/CONTRATO-v33.md): apelido, desde
 * quando joga, conquistas, as até 3 carreiras dele no Hall público (cada uma abre o resumo da comunidade) e os desafios
 * que venceu. O link é o mesmo código do convite (…/lenda/?c=CÓDIGO#/jogador/CÓDIGO), então quem chega pelo perfil de
 * alguém também chega como convidado dele.
 */
import { useEffect } from 'react'
import { ArrowLeft, ArrowRight, Copy, Crown, Medal, RotateCcw, Share2, UserRound, Users } from 'lucide-react'
import { navigate, useApp } from '@/store/app'
import { Button, Flag, OvrPill, Skeleton, formatInt, toast } from '@/ui/primitives'
import { PlaceholderScreen } from '@/ui/shell/Placeholder'
import { useShellSlots } from '@/ui/shell/slots'
import { useConta } from './conta'
import { dataBr } from './datas'
import { useDesafios } from './desafios'
import { linkPerfil } from './indicacao'
import { usePerfis } from './perfil'
import './site.css'
import './v33.css'

export default function PerfilPublico() {
  const codigo = useApp((s) => s.route.query.codigo ?? '')
  const aberto = usePerfis((s) => s.perfis[codigo])
  const meu = useConta((s) => s.usuario?.codigoConvite === codigo && !!codigo)
  const desafios = useDesafios((s) => s.lista)
  useShellSlots({ sub: '', center: <span className="sm-topbar-t">Perfil do jogador</span>, stage: { preset: 'legend' } }, [])
  useEffect(() => {
    void usePerfis.getState().abrir(codigo)
  }, [codigo])
  useEffect(() => {
    if (aberto?.status === 'pronto' && aberto.perfil.desafiosVencidos.length) void useDesafios.getState().carregar()
  }, [aberto])

  if (!aberto || aberto.status === 'carregando') {
    return (
      <main id="conteudo" tabIndex={-1} className="sv-page outline-none" aria-busy="true" aria-label="Carregando o perfil">
        <Skeleton h={110} r={22} />
        <Skeleton h={260} r={22} />
      </main>
    )
  }
  if (aberto.status === 'erro') {
    return (
      <PlaceholderScreen
        eyebrow="Perfil do jogador"
        title={aberto.naoEncontrado ? 'Perfil não encontrado' : 'Não deu para carregar o perfil'}
        icon={UserRound}
        description={aberto.naoEncontrado ? 'Esse jogador não tem perfil público (o link pode estar errado, ou ele escolheu não aparecer no Hall).' : 'Confira a internet e tente de novo em instantes.'}
        actions={
          <>
            <Button variant="primary" size="md" icon={ArrowLeft} onClick={() => navigate('/hall', { query: { seg: 'comunidade' } })}>
              Hall da comunidade
            </Button>
            {!aberto.naoEncontrado && (
              <Button variant="ghost" size="md" icon={RotateCcw} onClick={() => void usePerfis.getState().abrir(codigo, true)}>
                Tentar de novo
              </Button>
            )}
          </>
        }
      />
    )
  }

  const p = aberto.perfil
  const link = linkPerfil(p.codigo)
  const compartilhar = async () => {
    if (!link) return
    try {
      if (navigator.share) {
        await navigator.share({ title: `${p.apelido} no LENDA`, text: `As lendas de ${p.apelido} no LENDA`, url: link })
        return
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return
    }
    try {
      await navigator.clipboard.writeText(link)
      toast.success('Link copiado', link)
    } catch {
      toast.info('Link do perfil', link)
    }
  }
  const nomeDesafio = (slug: string) => desafios.find((d) => d.slug === slug)?.titulo ?? (slug.startsWith('tacas-do-rei') ? 'As Taças do Rei' : slug === 'todas-as-conquistas' ? 'Todas as conquistas' : slug)

  return (
    <main id="conteudo" tabIndex={-1} className="sv-page outline-none">
      <header className="sv-perfil">
        <span className="sc-avatar sc-avatar--lg" aria-hidden="true">
          {p.apelido.trim().charAt(0) || '?'}
        </span>
        <div className="sv-perfil__t">
          <h1>{p.apelido}</h1>
          <span>
            {p.desde ? `Joga desde ${dataBr(p.desde)}` : 'Jogador do LENDA'}
            {meu ? ' · este é o seu perfil' : ''}
          </span>
        </div>
        {link && (
          <Button variant="ghost" size="md" icon={typeof navigator !== 'undefined' && 'share' in navigator ? Share2 : Copy} onClick={() => void compartilhar()}>
            Compartilhar
          </Button>
        )}
      </header>

      <dl className="sc-stats sv-perfil__nums">
        <div className="sc-stat sc-stat--gold">
          <dt>Conquistas</dt>
          <dd className="num">{formatInt(p.conquistas)}</dd>
        </div>
        <div className="sc-stat">
          <dt>No Hall público</dt>
          <dd className="num">{p.carreiras.length}</dd>
        </div>
        <div className="sc-stat sc-stat--gold">
          <dt>Desafios vencidos</dt>
          <dd className="num">{p.desafiosVencidos.length}</dd>
        </div>
        <div className="sc-stat">
          <dt>Melhor nota</dt>
          <dd className="num">{p.carreiras.length ? Math.max(...p.carreiras.map((c) => c.nota)) : '—'}</dd>
        </div>
      </dl>

      {p.desafiosVencidos.length > 0 && (
        <ul className="sv-vencidos" aria-label="Desafios vencidos">
          {p.desafiosVencidos.map((s) => (
            <li key={s}>
              <Crown aria-hidden="true" /> Venceu: <b>{nomeDesafio(s)}</b>
            </li>
          ))}
        </ul>
      )}

      <h2 className="sc-sec">Carreiras no Hall das Lendas</h2>
      {p.carreiras.length ? (
        <ul className="sc-list sv-perfil__lista">
          {p.carreiras.map((c) => (
            <li key={c.id}>
              <button type="button" className="sc-card sv-carreira" onClick={() => navigate('/resumo', { query: { id: c.id, de: 'comunidade' } })} aria-label={`${c.jogador}: nota ${c.nota}, pico ${c.picoOvr}. Abrir o resumo`}>
                <span className="sc-card__top">
                  <span className="sc-card__ovr">
                    <OvrPill ovr={c.picoOvr} size="sm" />
                    <small>pico</small>
                  </span>
                  <span className="sc-card__id">
                    <b>{c.jogador}</b>
                    <span>
                      {c.pais && <Flag code={c.pais} h={11} decorative />} {c.pais} · {c.temporadas} temp.
                      {c.posicao ? ` · ${c.posicao}º no Hall` : ''}
                    </span>
                  </span>
                  <span className="sc-card__nota">
                    <b className="num">{c.nota}</b>
                    <small>nota</small>
                  </span>
                </span>
                {c.headline && <span className="sc-card__hl">{c.headline}</span>}
                <dl className="sc-card__nums">
                  <div>
                    <dd className="num">{formatInt(c.gols)}</dd>
                    <dt>Gols</dt>
                  </div>
                  <div>
                    <dd className="num">{formatInt(c.titulos)}</dd>
                    <dt>Títulos</dt>
                  </div>
                  <div className="is-gold">
                    <dd className="num">{formatInt(c.copas)}</dd>
                    <dt>Copas</dt>
                  </div>
                  <div className="is-gold">
                    <dd className="num">{formatInt(c.bolasOuro)}</dd>
                    <dt>Bolas</dt>
                  </div>
                </dl>
                <span className="sv-carreira__go">
                  Ver o resumo <ArrowRight aria-hidden="true" />
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="sc-empty">
          <Medal aria-hidden="true" />
          <b>Nenhuma carreira no Hall público ainda</b>
          <p>{meu ? 'As suas 3 melhores carreiras da conta aparecem aqui (ou as que você marcar em Minhas carreiras).' : 'Quando ele publicar carreiras no Hall das Lendas, elas aparecem aqui.'}</p>
        </div>
      )}
      <div className="sc-btns sv-acoes">
        <Button variant="ghost" size="md" icon={Users} onClick={() => navigate('/hall', { query: { seg: 'comunidade' } })}>
          Hall da comunidade
        </Button>
        {!meu && (
          <Button variant="primary" size="md" iconRight={ArrowRight} onClick={() => navigate('/identidade')}>
            Jogar o LENDA
          </Button>
        )}
      </div>
    </main>
  )
}
