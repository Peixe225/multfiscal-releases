/**
 * Hall das Lendas — filtros (país e clube) e as carreiras da comunidade (Hall público, só no site).
 *
 *   <FiltroBar filtro={f} onChange={setF} />            país (seleção) e clube (busca com escudo)
 *   <StatusComunidade pg={pg} />                         "Atualizado às 14:05 · próxima atualização às 15:05"
 *   <LinhaComunidade c={c} rank={3} />                   linha do ranking geral (selo "Comunidade", "Destaque", "+N de bônus")
 *   <MelhorDaComunidade c={c} />                         "Melhor da comunidade" no herói do Hall sem filtro
 *   <FiltroHero … />                                     "Lendas · Bolívia · Cruzeiro": contagem e pódio do filtro
 *
 * Abrir uma carreira da comunidade leva ao resumo completo (#/resumo?id=…&de=comunidade), que o site busca
 * no servidor sem misturar com o Hall deste aparelho.
 */
import { FilaEmblemas } from '@/ui/shared/emblemas/Emblema'
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { ArrowRight, CloudOff, Crown, Globe, RefreshCw, Search, Shield, Star, Users, X } from 'lucide-react'
import { REAL_LEGENDS } from '@/engine/legacy'
import { navigate } from '@/store/app'
import { useData, useClub, useCountry } from '@/store/data'
import { proximaVencida, type CarreiraComunidade, type FiltroHall, type PaginasComunidade } from '@/store/comunidade'
import { Button, Crest, Eyebrow, Flag, OvrBadge, POSITION_LABEL, cx, formatInt } from '@/ui/primitives'
import { CategoryGlyph, EntryAvatar, entryName } from './parts'
import { buscarClubes, filtroAtivo, horaBr, type LinhaMista } from './filtros'

// ───────────────────────── filtros ─────────────────────────

/** Nome do país pelo código FIFA (URS = União Soviética, que não existe mais no jogo). */
export function useNomePais(code: string | undefined): string {
  const c = useCountry(code)
  if (!code) return ''
  return code === 'URS' ? 'União Soviética' : (c?.name ?? code)
}

const collator = new Intl.Collator('pt-BR', { sensitivity: 'base' })

function PaisSelect({ value, onChange }: { value: string | undefined; onChange: (v: string | undefined) => void }) {
  const countries = useData((s) => s.data?.countries)
  const opts = useMemo(() => {
    const list = (countries ?? []).map((c) => ({ code: c.code, name: c.name }))
    // seleções das lendas que não existem mais no jogo (União Soviética)
    for (const l of REAL_LEGENDS) if (!list.some((c) => c.code === l.nationality)) list.push({ code: l.nationality, name: l.nationality === 'URS' ? 'União Soviética' : l.nationality })
    return list.sort((a, b) => collator.compare(a.name, b.name))
  }, [countries])
  const id = useId()
  return (
    <label className="hl-fsel" htmlFor={id}>
      <span className="hl-fsel__ic" aria-hidden="true">
        {value ? <Flag code={value === 'URS' ? null : value} iso2={value === 'URS' ? 'ru' : undefined} h={14} w={19} decorative /> : <Globe size={15} />}
      </span>
      <span className="sr-only">País (seleção)</span>
      <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">Todos os países</option>
        {opts.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  )
}

function ClubeBusca({ value, onChange }: { value: string | undefined; onChange: (v: string | undefined) => void }) {
  const clubs = useData((s) => s.data?.clubs)
  const club = useClub(value)
  const [q, setQ] = useState('')
  const [aberto, setAberto] = useState(false)
  const [ativo, setAtivo] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const caixa = useRef<HTMLDivElement>(null)
  const listId = useId()
  // celular: com o teclado aberto a janela visível encolhe; a lista cabe no que sobra (ou abre para cima)
  const [lugar, setLugar] = useState<{ max: number; acima: boolean } | null>(null)
  const medir = useCallback(() => {
    const el = caixa.current
    if (!el || typeof window === 'undefined') return
    setLugar(lugarDaLista(el.getBoundingClientRect(), window.visualViewport ?? null, window.innerHeight))
  }, [])
  // clubes das lendas primeiro no empate (quem busca "real" quer o Real Madrid)
  const prioridade = useMemo(() => new Set(REAL_LEGENDS.flatMap((l) => l.clubs.map((c) => c.clubId).filter((x): x is string => !!x))), [])
  const achados = useMemo(() => (clubs ? buscarClubes(clubs, q, 8, prioridade) : []), [clubs, q, prioridade])
  useEffect(() => setAtivo(0), [q])

  // os hooks ficam antes do retorno do chip (com o clube escolhido, a busca não aparece)
  const mostra = !club && aberto && q.trim().length > 0
  useEffect(() => {
    if (!mostra || typeof window === 'undefined') return
    medir()
    const vv = window.visualViewport
    vv?.addEventListener('resize', medir)
    vv?.addEventListener('scroll', medir)
    window.addEventListener('scroll', medir, { passive: true })
    return () => {
      vv?.removeEventListener('resize', medir)
      vv?.removeEventListener('scroll', medir)
      window.removeEventListener('scroll', medir)
    }
  }, [mostra, medir])
  /** No toque: quando o teclado abre (a janela visível encolhe), o campo sobe para o topo — a lista abre à vista. */
  const subirCampo = () => {
    if (typeof window === 'undefined' || !window.matchMedia?.('(pointer: coarse), (max-width: 44.99rem)').matches) return
    const vv = window.visualViewport
    // o teclado pode abrir antes ou depois dos 450 ms: sobe nas duas vezes (cada resize da janela visível conta)
    const ir = () => {
      if (document.activeElement !== input.current) return
      caixa.current?.scrollIntoView({ block: 'start', behavior: 'auto' })
      window.setTimeout(medir, 60)
    }
    vv?.addEventListener('resize', ir)
    window.setTimeout(ir, 450)
    window.setTimeout(() => vv?.removeEventListener('resize', ir), 1500)
  }
  if (club) {
    return (
      <span className="hl-fchip">
        <Crest club={club} size={18} decorative />
        <b>{club.name}</b>
        <button type="button" aria-label={`Tirar o filtro do clube ${club.name}`} onClick={() => (onChange(undefined), setQ(''), window.setTimeout(() => input.current?.focus(), 0))}>
          <X size={14} aria-hidden />
        </button>
      </span>
    )
  }
  const escolher = (id: string) => {
    onChange(id)
    setQ('')
    setAberto(false)
  }
  const teclas = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!achados.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setAberto(true)
      setAtivo((i) => (i + 1) % achados.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setAtivo((i) => (i - 1 + achados.length) % achados.length)
    } else if (e.key === 'Enter' && aberto) {
      e.preventDefault()
      escolher(achados[ativo].id)
    } else if (e.key === 'Escape') setAberto(false)
  }
  return (
    <div className="hl-fsearch" ref={caixa}>
      <span className="hl-fsel__ic" aria-hidden="true">
        <Search size={15} />
      </span>
      <input
        ref={input}
        type="search"
        role="combobox"
        aria-label="Clube"
        aria-expanded={mostra}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={mostra && achados[ativo] ? `${listId}-${achados[ativo].id}` : undefined}
        placeholder="Buscar clube"
        value={q}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => (setQ(e.target.value), setAberto(true))}
        onFocus={() => {
          setAberto(true)
          subirCampo()
        }}
        onBlur={() => window.setTimeout(() => setAberto(false), 150)}
        onKeyDown={teclas}
      />
      {mostra && (
        <ul id={listId} role="listbox" className={cx('hl-fsearch__list', lugar?.acima && 'is-acima')} style={lugar ? ({ ['--hl-lista-max' as string]: `${lugar.max}px` } as CSSProperties) : undefined} aria-label="Clubes">
          {achados.length ? (
            achados.map((c, i) => (
              <li key={c.id} id={`${listId}-${c.id}`} role="option" aria-selected={i === ativo} className={cx(i === ativo && 'is-on')} onMouseDown={(e) => (e.preventDefault(), escolher(c.id))} onMouseEnter={() => setAtivo(i)}>
                <Crest club={c} size={22} decorative />
                <span className="min-w-0">
                  <b>{c.name}</b>
                  <small>
                    <Flag code={c.country} h={9} decorative /> {c.country}
                  </small>
                </span>
              </li>
            ))
          ) : (
            <li className="hl-fsearch__none" role="presentation">
              Nenhum clube com “{q.trim()}”
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

/**
 * Onde a lista de clubes cabe: embaixo do campo, até o fim da janela visível (o teclado encolhe a janela no celular);
 * se embaixo sobrar menos de 140 px e em cima couber mais, abre para cima. Altura entre 48 e 320 px.
 */
export function lugarDaLista(campo: { top: number; bottom: number }, vv: { height: number; offsetTop: number } | null, janela: number): { max: number; acima: boolean } {
  const altura = vv?.height ?? janela
  const topo = vv?.offsetTop ?? 0
  const abaixo = topo + altura - campo.bottom - 14
  const acima = campo.top - topo - 14
  // no mínimo uma opção (48 px), mesmo com pouco espaço (deitado, com o teclado: ~226 px de janela)
  const lim = (n: number) => Math.round(Math.max(48, Math.min(320, n)))
  if (abaixo >= 140 || abaixo >= acima) return { max: lim(abaixo), acima: false }
  return { max: lim(acima), acima: true }
}

export function FiltroBar({ filtro, onChange }: { filtro: FiltroHall; onChange: (f: FiltroHall) => void }) {
  return (
    <div className="hl-filtros" role="search" aria-label="Filtrar o Hall por país e por clube">
      <span className="hl-filtros__lbl">Lendas por</span>
      <PaisSelect value={filtro.pais} onChange={(pais) => onChange({ ...filtro, pais })} />
      <ClubeBusca value={filtro.clube} onChange={(clube) => onChange({ ...filtro, clube })} />
      {filtroAtivo(filtro) && (
        <button type="button" className="hl-filtros__limpar" onClick={() => onChange({})}>
          <X size={14} aria-hidden /> Limpar filtros
        </button>
      )}
    </div>
  )
}

// ───────────────────────── comunidade ─────────────────────────

/** "Atualizado às 14:05 · próxima atualização às 15:05". */
export function StatusComunidade({ pg, onRetry }: { pg: PaginasComunidade | undefined; onRetry?: () => void }) {
  if (!pg) return null
  if (pg.status === 'carregando' && !pg.itens.length)
    return (
      <p className="hl-cstatus" aria-live="polite">
        <span className="hl-cstatus__dot is-busy" aria-hidden="true" /> Carregando o Hall da comunidade…
      </p>
    )
  if (pg.status === 'erro' && !pg.itens.length)
    return (
      <p className="hl-cstatus is-err" role="status">
        <CloudOff size={14} aria-hidden />
        {pg.semRede ? 'Sem internet: mostrando as lendas e as carreiras deste aparelho.' : 'O Hall da comunidade não carregou agora.'}
        {onRetry && (
          <button type="button" className="hl-link" onClick={onRetry}>
            Tentar de novo
          </button>
        )}
      </p>
    )
  const a = horaBr(pg.atualizadoEm)
  const p = horaBr(pg.proximaEm)
  // a hora da próxima já passou (o servidor está refazendo a fotografia agora): nada de "às 14:05" às 14:30
  const vencida = proximaVencida(pg.proximaEm)
  return (
    <p className="hl-cstatus">
      <span>
        <span className="hl-cstatus__dot" aria-hidden="true" />
        Comunidade: <b className="num">{formatInt(pg.total)}</b> {pg.total === 1 ? 'carreira' : 'carreiras'}
        {a ? ` · Atualizado às ${a}` : ''}
        {vencida ? ' · atualizando agora' : p ? ` · próxima atualização às ${p}` : ''}
      </span>
    </p>
  )
}

export const ComunidadeAvatar = memo(function ComunidadeAvatar({ c, size = 36 }: { c: Pick<CarreiraComunidade, 'picoOvr' | 'pais'>; size?: number }) {
  return (
    <span className="hl-rav hl-cav">
      <OvrBadge ovr={c.picoOvr || 60} size={size} sheen={false} aura={false} label={false} />
      {c.pais && (
        <span className="hl-cav__flag">
          <Flag code={c.pais} h={Math.round(size * 0.32)} decorative />
        </span>
      )}
    </span>
  )
})

function ComCrests({ ids, max = 4, size = 16 }: { ids: string[]; max?: number; size?: number }) {
  return (
    <span className="hl-crests">
      {ids.slice(0, max).map((id) => (
        <ComCrest key={id} id={id} size={size} />
      ))}
      {ids.length > max && <span className="hl-crests__more">+{ids.length - max}</span>}
    </span>
  )
}
function ComCrest({ id, size }: { id: string; size: number }) {
  const club = useClub(id)
  return club ? <Crest club={club} size={size} decorative /> : null
}

function ComTrofeus({ c, size = 22 }: { c: CarreiraComunidade; size?: number }) {
  const items: ['ballonDor' | 'worldCups', number][] = [
    ['ballonDor', c.bolasOuro],
    ['worldCups', c.copas],
  ]
  const on = items.filter(([, n]) => n > 0)
  if (!on.length) return <span className="hl-kt hl-kt--none">—</span>
  return (
    <span className="hl-kt">
      {on.map(([id, n]) => (
        <span key={id} className="hl-kt__i" title={`${n}× ${id === 'ballonDor' ? 'Bola de Ouro' : 'Copa do Mundo'}`}>
          <CategoryGlyph id={id} size={size} />
          <b>{n}</b>
        </span>
      ))}
    </span>
  )
}

export const abrirComunidade = (id: string) => navigate('/resumo', { query: { id, de: 'comunidade' } })
/** O perfil público do dono de uma carreira da comunidade (v3.3, só no site): #/jogador/<código>. */
export const abrirPerfilPublico = (codigo: string) => navigate('/jogador', { query: { codigo } })

export function SeloComunidade({ c }: { c: Pick<CarreiraComunidade, 'bonusOvr'> & Partial<Pick<CarreiraComunidade, 'destaque'>> }) {
  return (
    <>
      <span className="hl-runtag hl-runtag--com">Comunidade</span>
      {c.destaque && (
        <span className="hl-runtag hl-runtag--destaque" title="Escolhida pela moderação como destaque do Hall da comunidade">
          Destaque
        </span>
      )}
      {c.bonusOvr > 0 && <span className="hl-runtag hl-runtag--bonus">+{c.bonusOvr} de bônus</span>}
    </>
  )
}

/** "Melhor da comunidade" (a 1ª do Hall público), no pé do herói do Hall sem filtro: abre o resumo dela. */
export function MelhorDaComunidade({ c }: { c: CarreiraComunidade }) {
  return (
    <button type="button" className="hl-melhorcom" onClick={() => abrirComunidade(c.id)} aria-label={`Melhor da comunidade: ${c.jogador}, de ${c.apelido}, nota ${c.nota}. Abrir o resumo`}>
      <span className="hl-melhorcom__l">
        <Users size={13} aria-hidden /> Melhor da comunidade
      </span>
      <ComunidadeAvatar c={c} size={30} />
      <span className="hl-melhorcom__who">
        <b>
          {c.jogador}
          {c.destaque && (
            <span className="hl-runtag hl-runtag--destaque">
              <Star size={9} aria-hidden /> Destaque
            </span>
          )}
          {c.bonusOvr > 0 && <span className="hl-runtag hl-runtag--bonus">+{c.bonusOvr} de bônus</span>}
        </b>
        <small>
          de {c.apelido} · {c.temporadas} temp. · {formatInt(c.gols)} gols
        </small>
      </span>
      <span className="hl-melhorcom__nota num">{c.nota}</span>
      <ArrowRight size={15} className="hl-melhorcom__go" aria-hidden />
    </button>
  )
}

export function LinhaComunidade({ c, rank, style }: { c: CarreiraComunidade; rank: number; style?: CSSProperties }) {
  return (
    <button type="button" role="row" className={cx('hl-row is-com', rank <= 3 && `is-top${rank}`)} style={style} onClick={() => abrirComunidade(c.id)} aria-label={`${rank}º ${c.jogador}, carreira de ${c.apelido} na comunidade, nota ${c.nota}`}>
      <span role="cell" className="hl-row__pos">
        {rank}
      </span>
      <span role="cell" className="hl-row__who">
        <ComunidadeAvatar c={c} />
        <span className="hl-row__name">
          <b>
            {c.jogador}
            <SeloComunidade c={c} />
          </b>
          <small>
            {/* v3.5: o apelido não é mais um alvo dentro da linha (no celular ele quebrava bem no meio dela, onde o dedo
                cai, e o toque ia para o perfil em vez do resumo). A linha inteira abre o resumo, que leva ao perfil
                em "Carreira de <apelido>". */}
            <span className="hl-com__dono">
              <Users size={11} aria-hidden /> {c.apelido}
              {/* v3.4: os emblemas de desafio do dono, pequenos (até 3 e "+N") */}
              {c.emblemas?.length ? <FilaEmblemas lista={c.emblemas} total={c.emblemasTotal} size={13} /> : null}
            </span>
            <span className="hl-dot" />
            <span>{POSITION_LABEL[c.posicaoCampo as keyof typeof POSITION_LABEL] ?? c.posicaoCampo}</span>
            <span className="hl-dot" />
            <span>{c.temporadas} temp.</span>
            <span className="hl-dot hl-hide-sm" />
            <ComCrests ids={c.clubes} />
          </small>
        </span>
      </span>
      <span role="cell" className="hl-col-kt">
        <ComTrofeus c={c} />
      </span>
      <span role="cell" className="hl-col-n num">
        {formatInt(c.gols)}
      </span>
      <span role="cell" className="hl-col-n num">
        {formatInt(c.titulos)}
      </span>
      <span role="cell" className="hl-col-n num" title="Prêmios individuais: veja no resumo da carreira">
        —
      </span>
      <span role="cell" className="hl-col-nota">
        <span className="hl-bar" aria-hidden="true">
          <i style={{ transform: `scaleX(${Math.max(0, Math.min(100, c.nota)) / 100})` }} />
        </span>
        <b className="num">{c.nota}</b>
      </span>
    </button>
  )
}

/** Linhas de espera do ranking da comunidade. */
export function LinhasCarregando({ n = 4 }: { n?: number }) {
  return (
    <div className="hl-csk" aria-busy="true" aria-label="Carregando a comunidade">
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className="hl-csk__row" />
      ))}
    </div>
  )
}

export function ComunidadeVazia({ filtro, pg, onRetry }: { filtro: FiltroHall; pg: PaginasComunidade | undefined; onRetry?: () => void }) {
  if (pg?.status === 'erro') {
    return (
      <div className="hl-cempty" role="status">
        <CloudOff size={22} aria-hidden />
        <b>{pg.semRede ? 'Sem internet' : 'Não deu para carregar a comunidade'}</b>
        <p>{pg.semRede ? 'Quando a conexão voltar, as carreiras dos outros jogadores aparecem aqui.' : 'O servidor não respondeu agora. Tente de novo em instantes.'}</p>
        {onRetry && (
          <Button variant="ghost" size="sm" icon={RefreshCw} onClick={onRetry}>
            Tentar de novo
          </Button>
        )}
      </div>
    )
  }
  return (
    <div className="hl-cempty" role="status">
      <Users size={22} aria-hidden />
      <b>{filtroAtivo(filtro) ? 'Ninguém da comunidade com esse filtro ainda' : 'O Hall da comunidade está começando'}</b>
      <p>Termine uma carreira com a sua conta: as suas 3 melhores (ou as que você escolher) entram aqui, contra as de todo mundo.</p>
      <Button variant="primary" size="sm" iconRight={ArrowRight} onClick={() => navigate('/identidade')}>
        Começar uma carreira
      </Button>
    </div>
  )
}

// ───────────────────────── herói do filtro ─────────────────────────

function NomeClube({ id }: { id: string }) {
  const club = useClub(id)
  return (
    <span className="hl-fhero__tag">
      {club ? <Crest club={club} size={26} decorative /> : <Shield size={20} aria-hidden />}
      {club?.name ?? id}
    </span>
  )
}

function NomePais({ code }: { code: string }) {
  const nome = useNomePais(code)
  return (
    <span className="hl-fhero__tag">
      <Flag code={code === 'URS' ? null : code} iso2={code === 'URS' ? 'ru' : undefined} h={22} w={30} decorative />
      {nome}
    </span>
  )
}

/** Quem está no topo do filtro (lendas reais, as suas carreiras e as da comunidade, misturadas pela nota). */
export function FiltroHero({ filtro, linhas, lendas, suas, comunidade, carregando, onOpen }: { filtro: FiltroHall; linhas: LinhaMista[]; lendas: number; suas: number; comunidade: number | null; carregando: boolean; onOpen: (l: LinhaMista) => void }) {
  const top = linhas.slice(0, 3)
  const partes = [`${lendas} ${lendas === 1 ? 'lenda real' : 'lendas reais'}`, `${suas} ${suas === 1 ? 'carreira sua' : 'carreiras suas'}`]
  if (comunidade !== null) partes.push(`${formatInt(comunidade)} da comunidade`)
  return (
    <section className="hl-fhero lx-glass" aria-labelledby="hl-fhero-h">
      <Eyebrow>Lendas por nacionalidade e clube</Eyebrow>
      <h2 id="hl-fhero-h" className="hl-fhero__t">
        {filtro.pais && <NomePais code={filtro.pais} />}
        {filtro.pais && filtro.clube && <span className="hl-fhero__x" aria-hidden="true">·</span>}
        {filtro.clube && <NomeClube id={filtro.clube} />}
      </h2>
      <p className="hl-fhero__s">
        {partes.join(' · ')}
        {carregando ? ' · carregando a comunidade…' : ''}
      </p>
      {top.length ? (
        <ol className="hl-fpod">
          {top.map((l, i) => (
            <li key={l.kind === 'rank' ? l.row.entry.id : l.c.id}>
              <button type="button" className={cx('hl-fpod__b', `is-p${i + 1}`)} onClick={() => onOpen(l)}>
                <span className="hl-fpod__n num">{l.rank}º</span>
                {l.kind === 'rank' ? <EntryAvatar entry={l.row.entry} size={40} /> : <ComunidadeAvatar c={l.c} size={40} />}
                <span className="hl-fpod__who">
                  <b>{l.kind === 'rank' ? entryName(l.row.entry) : l.c.jogador}</b>
                  <small>{l.kind === 'comunidade' ? `Comunidade · ${l.c.apelido}` : l.row.entry.kind === 'run' ? `Sua carreira nº ${l.row.entry.runNo}` : 'Lenda real'}</small>
                </span>
                <span className="hl-fpod__nota num">{l.kind === 'rank' ? l.row.entry.score : l.c.nota}</span>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <div className="hl-cempty hl-cempty--inline">
          <Crown size={20} aria-hidden />
          <b>Ninguém neste filtro ainda</b>
          <p>Nenhuma das 50 lendas reais (nem carreira daqui{comunidade !== null ? ' ou da comunidade' : ''}) passa nesse filtro. A primeira pode ser a sua.</p>
          <Button variant="primary" size="sm" iconRight={ArrowRight} onClick={() => navigate('/identidade')}>
            Começar uma carreira
          </Button>
        </div>
      )}
    </section>
  )
}
