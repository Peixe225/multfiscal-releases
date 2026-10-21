/**
 * Site v3.4 §E (servidor/CONTRATO-v34.md §E): as correções confirmadas do lado do jogo, cada uma com o caso que falhava antes —
 *   E.2 a verificação manda a versão do conteúdo que refez (meta.versao) no prova_verificar;
 *   E.5 o ícone fora do mapa ("constructor") vira a medalha, e o emblema desenha (antes: a tela caía);
 *   E.6 o indexnow.mjs lê o robots.txt da raiz e diz quem está bloqueado (o de hoje bloqueia /lenda/ inteira);
 *   E.8 a carreira-prova que cumpre um desafio de emblema que a conta ainda não tem sobe sozinha (o emblema sai no servidor);
 *   E.9 o link da prévia só vai no compartilhar quando a carreira já está no Hall público (senão, o de convite);
 *   E.10 a faixa da tela inicial: "com emblema" inteiro ou nada; o desafio da 2ª linha fora do Tab;
 *   E.11 as frases das provas: as novas desta carreira ("+2 …") e o total da conta ("Agora são 40 …").
 * A rede é um fetch de mentira; nada sai para a internet.
 */
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Medal } from 'lucide-react'
import { sementeDoPar } from '@/engine/replay'
import { LEGACY_VERSION } from '@/engine/legacy/score'
import type { HallEntry } from '@/store/career'
import { achievementIcon } from '@/ui/shared/achievements/meta'
import { FilaEmblemas, Emblema } from '@/ui/shared/emblemas/Emblema'
import { normalizarCarreira, useCarreiras } from './carreiras'
import { normalizarUsuario, useConta } from './conta'
import { carreiraCumpre, emblemasQueACarreiraDa, normalizarLista, numerosParaCriterio, useDesafios } from './desafios'
import { useEmblemas } from './emblemas'
import { medirFaixa } from './DestaqueDesafio'
import { conferirNoHall, esquecerNoHall, linkDoCompartilhar } from './pontes'
import { lembrarSementeDoServidor } from './provas'
import { mandarProvas, provaDoMeta } from './verificacao'
import { emblemasQueDaria, textoProvasNovas, textoProvasTotal } from './vigias'

const resposta = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } })
function rede(responder: (url: string, metodo: string, corpo: string) => Response | Promise<Response>) {
  const f = vi.fn(async (u: string | URL | Request, init?: RequestInit) => responder(String(u), init?.method ?? 'GET', typeof init?.body === 'string' ? init.body : ''))
  vi.stubGlobal('fetch', f)
  return f
}
const logar = (id = 7) => useConta.setState({ usuario: normalizarUsuario({ id, apelido: 'Teste', email: 'a@b.com', codigoConvite: 'ABCD2345', emailVerificado: true }), lembrado: 'Teste', status: 'pronto' })

afterEach(() => {
  vi.unstubAllGlobals()
  useConta.setState({ usuario: null, lembrado: null })
  useCarreiras.setState({ lista: null })
  useEmblemas.setState({ meus: null, uid: null })
  useDesafios.setState({ status: 'idle', lista: [], buscadoEm: 0, meu: null, meuStatus: 'idle', meuDe: null })
})

// ───────────────────────────── E.2 versão no prova_verificar ─────────────────────────────

describe('§E.2 a verificação manda a versão do conteúdo que refez', () => {
  const V = 'a'.repeat(40)
  it('provaDoMeta lê meta.versao (40 hexadecimais); fora do formato ou ausente, nada', () => {
    expect(provaDoMeta({ prova: true, conquistas: ['hexa'], versao: V }).versao).toBe(V)
    expect(provaDoMeta({ prova: true, conquistas: ['hexa'], versao: 'x' }).versao).toBeUndefined()
    expect(provaDoMeta({ prova: true, conquistas: ['hexa'] })).toEqual({ ehProva: true, provaOk: null, conquistas: ['hexa'] })
  })
  it('mandarProvas leva a `versao` de cada resultado (e não manda o campo quando não há)', async () => {
    const corpos: { resultados: Record<string, unknown>[] }[] = []
    rede((_u, _m, corpo) => {
      corpos.push(JSON.parse(corpo))
      return resposta(200, { ok: true, carreiras: [], pulados: [{ carreira: 11, motivo: 'mudou' }], contas: {} })
    })
    const r = await mandarProvas([{ carreira: 11, ok: true, detalhes: { v: 1 }, versao: V }, { carreira: 12, ok: false, detalhes: {} }])
    expect(corpos[0].resultados[0]).toEqual({ carreira: 11, ok: true, detalhes: { v: 1 }, versao: V })
    expect(corpos[0].resultados[1]).toEqual({ carreira: 12, ok: false, detalhes: {} })
    expect(r.pulados).toEqual([{ carreira: 11, motivo: 'mudou' }])
  })
})

// ───────────────────────────── E.5 ícone fora do mapa ─────────────────────────────

describe('§E.5 ícone do emblema fora do mapa', () => {
  it('achievementIcon("constructor") é a medalha (antes: a função Object do protótipo)', () => {
    expect(achievementIcon({ icon: 'constructor' })).toBe(Medal)
    expect(achievementIcon({ icon: 'tostring' })).toBe(Medal)
    expect(achievementIcon({ icon: 'star' })).not.toBe(Medal)
  })
  it('a fila de emblemas do Hall e a moeda desenham com o ícone "constructor" (antes: "Objects are not valid as a React child")', () => {
    const lista = [{ slug: 'x', icone: 'constructor', cor: '#ffffff', titulo: 'X' }]
    expect(() => renderToString(createElement(FilaEmblemas, { lista }))).not.toThrow()
    expect(() => renderToString(createElement(Emblema, { e: { icone: 'constructor', cor: '#ffffff' } }))).not.toThrow()
  })
})

// ───────────────────────────── E.6 robots.txt ─────────────────────────────

describe('§E.6 scripts/indexnow.mjs confere o robots.txt da raiz', () => {
  const caminho = fileURLToPath(new URL('../../scripts/indexnow.mjs', import.meta.url))
  type M = {
    robotsPermite: (txt: string, agente: string, caminho: string) => boolean
    conferirRobots: (site: string, o: { fetch: (u: string) => Promise<Response> }) => Promise<{ url: string; status: number; erro: string | null; bloqueados: { robo: string; caminhos: string[] }[] }>
    pedidoRobots: (site: string) => string
    ROBOS: string[]
  }
  const carregar = () => import(/* @vite-ignore */ caminho) as Promise<M>
  /** O robots.txt de https://oprojeto.online/ hoje (20/10/2026): bloqueado de propósito, o domínio é o de trabalho. */
  const HOJE = ['# HOJE: bloqueado.', 'User-agent: *', 'Disallow: /', '', '# User-agent: *', '# Allow: /', '# Sitemap: https://oprojeto.online/sitemap.xml'].join('\n')
  it('robotsPermite: o de hoje bloqueia /lenda/, o sitemap e o v.php para todos os robôs; com "Allow: /lenda/" no grupo, só a pasta abre', async () => {
    const m = await carregar()
    for (const robo of m.ROBOS) for (const c of ['/lenda/', '/lenda/sitemap.xml', '/lenda/api/v.php']) expect(m.robotsPermite(HOJE, robo, c), `${robo} ${c}`).toBe(false)
    const liberado = HOJE.replace('Disallow: /', 'Disallow: /\nAllow: /lenda/')
    expect(m.robotsPermite(liberado, 'Bingbot', '/lenda/sitemap.xml')).toBe(true)
    expect(m.robotsPermite(liberado, 'Bingbot', '/painel/')).toBe(false)
    // só o card do X: um grupo do Twitterbot (o mais específico vale para ele)
    const soX = `${HOJE}\n\nUser-agent: Twitterbot\nAllow: /lenda/\nDisallow: /\n`
    expect(m.robotsPermite(soX, 'Twitterbot', '/lenda/api/v.php')).toBe(true)
    expect(m.robotsPermite(soX, 'Twitterbot', '/outra/')).toBe(false)
    expect(m.robotsPermite(soX, 'Googlebot', '/lenda/')).toBe(false)
    // sem robots.txt, Disallow vazio, $ e *
    expect(m.robotsPermite('', 'Bingbot', '/lenda/')).toBe(true)
    expect(m.robotsPermite('User-agent: *\nDisallow:\n', 'Bingbot', '/lenda/')).toBe(true)
    expect(m.robotsPermite('User-agent: *\nDisallow: /*.php$\n', 'Bingbot', '/lenda/api/v.php')).toBe(false)
    expect(m.robotsPermite('User-agent: *\nDisallow: /*.php$\n', 'Bingbot', '/lenda/api/v.php?id=1')).toBe(true)
  })
  it('conferirRobots (fetch de mentira) lista os bloqueados e o pedido diz o que acrescentar', async () => {
    const m = await carregar()
    const urls: string[] = []
    const r = await m.conferirRobots('https://oprojeto.online/lenda/', { fetch: async (u) => (urls.push(u), new Response(HOJE, { status: 200 })) })
    expect(urls).toEqual(['https://oprojeto.online/robots.txt'])
    expect(r.bloqueados.map((b) => b.robo)).toEqual(m.ROBOS)
    expect(r.bloqueados.find((b) => b.robo === 'Twitterbot')?.caminhos).toEqual(['/lenda/', '/lenda/sitemap.xml', '/lenda/api/v.php'])
    expect(m.pedidoRobots('https://oprojeto.online/lenda/')).toContain('Allow: /lenda/')
    const sem = await m.conferirRobots('https://oprojeto.online/lenda/', { fetch: async () => new Response('', { status: 404 }) })
    expect(sem.bloqueados).toEqual([])
  })
})

// ───────────────────────────── E.8 a carreira-prova que dá emblema sobe sozinha ─────────────────────────────

describe('§E.8 a carreira-prova que cumpre um desafio de emblema sobe sozinha', () => {
  const par: [number, number] = [111111, 222222]
  const seed = sementeDoPar(par)
  /** v-otima-01 resumida: pico 89, 2 Bolas de Ouro, 5 Champions, 18 temporadas na Inter, 34 títulos (como no e2e h1). */
  const carreira = (o: Partial<HallEntry> = {}) =>
    ({
      id: `career-${seed}`,
      mode: 'classic',
      engine: 'real',
      identity: { surname: 'BERNARDINI', nationality: 'ITA' },
      replay: { v: 1, seed: par, identity: { nationality: 'ITA' }, pace: 'expressa', picks: [], bonusOvr: 0, dados: '' },
      career: { achievements: ['first_title'] },
      legacy: { score: 72, raw: 72, at: '', v: 2 },
      summary: {
        peakOvr: 89,
        seasons: 18,
        totals: { goals: 410, apps: 600 },
        trophies: [{ trophyId: 'champions-league', count: 5 }, { trophyId: 'serie-a', count: 12 }, { trophyId: 'coppa', count: 17 }],
        awards: [{ award: 'ballon_dor', count: 2 }],
        clubs: [{ clubId: 'inter', seasons: 18 }],
        national: { trophies: [] },
      },
      ...o,
    }) as unknown as HallEntry
  const desafios = {
    desafios: [
      { slug: 'noite-de-gala', titulo: 'Noite de gala', criterio: { bolasOuro: 1, champions: 1 }, ativo: true, modo: 'emblema', emblema: { icone: 'star', cor: '#b98652' } },
      { slug: 'bandeira-do-clube', titulo: 'Bandeira do clube', criterio: { temporadasMesmoClube: 18, titulos: 20 }, ativo: true, modo: 'emblema', emblema: { icone: 'shield', cor: '#b98652' } },
      { slug: 'hexa-e-gloria-eterna', titulo: 'Hexa', criterio: { copas: 1, nacionalidade: ['BRA'], copasPelaSelecao: 1 }, ativo: true, modo: 'emblema' },
      { slug: 'era-de-ouro', titulo: 'Era de ouro', criterio: { bolasOuro: 5, champions: 3 }, ativo: true, modo: 'emblema' },
      { slug: 'premio', titulo: 'Prêmio', criterio: { champions: 1 }, ativo: true, modo: 'primeiro' },
    ],
  }
  beforeEach(() => {
    const m = new Map<string, string>()
    vi.stubGlobal('window', { localStorage: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } })
  })
  it('numerosParaCriterio / carreiraCumpre: a mesma conta do servidor (Champions, Bolas, títulos, temporadas no mesmo clube, a seleção da criação)', () => {
    const n = numerosParaCriterio(carreira())
    expect(n).toMatchObject({ champions: 5, bolasOuro: 2, titulos: 34, temporadasMesmoClube: 18, clubes: 1, gols: 410, nota: 72, paisInicio: 'ITA', paisFim: 'ITA' })
    expect(carreiraCumpre(carreira(), { bolasOuro: 1, champions: 1 })).toBe(true)
    expect(carreiraCumpre(carreira(), { temporadasMesmoClube: 18, titulos: 20 })).toBe(true)
    expect(carreiraCumpre(carreira(), { bolasOuro: 5, champions: 3 })).toBe(false)
    expect(carreiraCumpre(carreira(), { nacionalidade: ['ITA'] })).toBe(true)
    expect(carreiraCumpre(carreira({ identity: { surname: 'X', nationality: 'BRA' } as HallEntry['identity'] }), { nacionalidade: ['ITA'] })).toBe(false)
    expect(carreiraCumpre(carreira(), {})).toBe(false)
    expect(carreiraCumpre(carreira(), { todasConquistas: true })).toBe(false)
    const lista = normalizarLista(desafios)
    expect(emblemasQueACarreiraDa(carreira(), lista, new Set()).map((d) => d.slug)).toEqual(['noite-de-gala', 'bandeira-do-clube'])
    expect(emblemasQueACarreiraDa(carreira(), lista, new Set(['noite-de-gala'])).map((d) => d.slug)).toEqual(['bandeira-do-clube'])
  })
  it('emblemasQueDaria: carreira-prova (semente do servidor), pico 89 e nenhuma conquista nova — ainda assim os 2 emblemas que a conta não tem (antes: ficava no aparelho)', async () => {
    logar(7)
    lembrarSementeDoServidor(7, seed)
    rede((u) => {
      if (u.includes('desafios.php') && u.includes('eu=1')) return resposta(200, { ...desafios, emblemas: [{ slug: 'noite-de-gala', titulo: 'Noite de gala', icone: 'star', cor: '#b98652', dificuldade: 'facil' }] })
      if (u.includes('desafios.php')) return resposta(200, desafios)
      return resposta(404, {})
    })
    // a conta já tem o Noite de gala (o ?eu=1 diz): só o Bandeira do clube faz a carreira subir
    expect(await emblemasQueDaria(carreira(), 7)).toEqual(['bandeira-do-clube'])
    // a semente não é do servidor para esta conta: não
    expect(await emblemasQueDaria(carreira(), 8)).toEqual([])
    // a conta já tem os dois: não
    useEmblemas.setState({ uid: 7, meus: [{ slug: 'noite-de-gala', titulo: '', icone: 'star', cor: '#b98652', dificuldade: null, em: null, carreiraId: null, jogador: null }, { slug: 'bandeira-do-clube', titulo: '', icone: 'shield', cor: '#b98652', dificuldade: null, em: null, carreiraId: null, jogador: null }] })
    expect(await emblemasQueDaria(carreira(), 7)).toEqual([])
  })
  it('sem saber os emblemas da conta (o ?eu=1 falhou): sobe (o servidor decide; salvar de novo é idempotente)', async () => {
    logar(7)
    lembrarSementeDoServidor(7, seed)
    rede((u) => (u.includes('eu=1') ? resposta(500, {}) : u.includes('desafios.php') ? resposta(200, desafios) : resposta(404, {})))
    expect(await emblemasQueDaria(carreira(), 7)).toEqual(['noite-de-gala', 'bandeira-do-clube'])
  })
})

// ───────────────────────────── E.9 link da prévia só com a carreira no Hall ─────────────────────────────

describe('§E.9 o link da prévia só quando a carreira já está no Hall público', () => {
  beforeEach(() => esquecerNoHall())
  const C = (id: string, estado: string) => normalizarCarreira({ id, hall: { estado } })!
  it('a carreira do jogador fora do Hall (entra_na_proxima, revisao) ou ainda sem saber: o link de convite; no_hall: o da prévia', async () => {
    logar()
    const o = (carreiraId: string) => ({ carreiraId, codigo: 'ABCD2345', logado: true })
    expect(linkDoCompartilhar(o('career-1a2b'))).toMatch(/\/lenda\/\?c=ABCD2345$/)
    useCarreiras.setState({ lista: [C('career-1a2b', 'entra_na_proxima'), C('career-rev', 'revisao'), C('career-no', 'no_hall')], carregadaEm: Date.now() })
    for (const id of ['career-1a2b', 'career-rev', 'career-no']) await conferirNoHall(id, true)
    expect(linkDoCompartilhar(o('career-1a2b'))).not.toMatch(/v\.php/)
    expect(linkDoCompartilhar(o('career-rev'))).not.toMatch(/v\.php/)
    expect(linkDoCompartilhar(o('career-no'))).toMatch(/api\/v\.php\?id=career-no&c=ABCD2345$/)
    // sem conta: nunca a prévia
    expect(linkDoCompartilhar({ ...o('career-no'), logado: false })).not.toMatch(/v\.php/)
  })
  it('a lista da conta velha (mais de 5 s) ou que não veio: pede de novo o carreiras.php (nunca o hall.php: nada de 404 no console)', async () => {
    logar()
    const f = rede((u) => (u.includes('carreiras.php') ? resposta(200, { carreiras: [{ id: 'career-1a2b', notaV: LEGACY_VERSION, hall: { estado: 'no_hall' } }], limite: 200, hallPublico: 'auto' }) : resposta(404, {})))
    useCarreiras.setState({ lista: [C('career-1a2b', 'entra_na_proxima')], carregadaEm: Date.now() - 120_000 })
    await conferirNoHall('career-1a2b', true)
    const urls = f.mock.calls.map((c) => String(c[0]))
    expect(urls[0]).toMatch(/api\/carreiras\.php$/)
    expect(urls.some((u) => u.includes('hall.php'))).toBe(false)
    expect(linkDoCompartilhar({ carreiraId: 'career-1a2b', codigo: 'ABCD2345', logado: true })).toMatch(/v\.php\?id=career-1a2b/)
  })
  it('a carreira de outro jogador (o resumo da comunidade, que veio do Hall público): o link da prévia, sem pedido nenhum', async () => {
    logar()
    const f = rede(() => resposta(404, {}))
    await conferirNoHall('career-alheia', false)
    expect(f).not.toHaveBeenCalled()
    expect(linkDoCompartilhar({ carreiraId: 'career-alheia', codigo: 'ABCD2345', logado: true })).toMatch(/v\.php\?id=career-alheia/)
  })
})

// ───────────────────────────── E.10 a faixa da tela inicial ─────────────────────────────

describe('§E.10 a faixa da tela inicial: nada cortado, nada escondido no Tab', () => {
  /** Um DOM de mentira só com o que o medirFaixa lê (a medida real é a do navegador: o e2e e o Playwright conferem). */
  function faixa(o: { frase: { scroll: number; client: number } | null; tops: number[] }) {
    const classes = (l: Set<string>) => ({ add: (c: string) => void l.add(c), remove: (c: string) => void l.delete(c), toggle: (c: string, f: boolean) => void (f ? l.add(c) : l.delete(c)), contains: (c: string) => l.has(c) })
    const botoes = o.tops.map((t) => {
      const cl = new Set<string>()
      const at = new Map<string, string>()
      return { offsetTop: t, classList: classes(cl), cls: cl, at, set tabIndex(v: number) { at.set('tabindex', String(v)) }, setAttribute: (k: string, v: string) => void at.set(k, v), removeAttribute: (k: string) => void at.delete(k) }
    })
    const navCl = new Set<string>()
    const frase = o.frase ? { scrollWidth: o.frase.scroll, clientWidth: o.frase.client, getClientRects: () => [1] } : { scrollWidth: 0, clientWidth: 0, getClientRects: () => [] }
    const nav = { classList: classes(navCl), querySelector: () => frase, querySelectorAll: () => botoes }
    return { nav: nav as unknown as HTMLElement, navCl, botoes }
  }
  it('no celular, "com emblema" que não coube inteiro (18 de 85 px, em 320 px) sai; inteiro, fica', () => {
    const f = faixa({ frase: { scroll: 85, client: 18 }, tops: [0, 0, 0] })
    medirFaixa(f.nav)
    expect(f.navCl.has('is-curta')).toBe(true)
    const g = faixa({ frase: { scroll: 85, client: 85 }, tops: [0, 0, 0] })
    medirFaixa(g.nav)
    expect(g.navCl.has('is-curta')).toBe(false)
  })
  it('no computador, o 3º desafio que desceu para a 2ª linha (escondida) sai do Tab e do leitor de tela; de volta à 1ª, volta', () => {
    const f = faixa({ frase: null, tops: [4, 4, 40] })
    medirFaixa(f.nav)
    expect(f.botoes.map((b) => b.cls.has('is-fora'))).toEqual([false, false, true])
    expect(f.botoes[2].at.get('tabindex')).toBe('-1')
    expect(f.botoes[2].at.get('aria-hidden')).toBe('true')
    expect(f.botoes[0].at.has('tabindex')).toBe(false)
    f.botoes[2].offsetTop = 4
    medirFaixa(f.nav)
    expect(f.botoes[2].cls.has('is-fora')).toBe(false)
    expect(f.botoes[2].at.has('tabindex')).toBe(false)
    expect(f.botoes[2].at.has('aria-hidden')).toBe(false)
  })
})

// ───────────────────────────── E.11 as frases das provas ─────────────────────────────

describe('§E.11 as frases das provas: as novas e o total', () => {
  it('"+2 conquistas provadas na conta" (as desta carreira) × "Agora são 40 conquistas provadas na conta" (o total)', () => {
    expect(textoProvasNovas(2)).toBe('+2 conquistas provadas na conta')
    expect(textoProvasNovas(1)).toBe('+1 conquista provada na conta')
    expect(textoProvasTotal(40)).toBe('Agora são 40 conquistas provadas na conta')
    expect(textoProvasTotal(1)).toBe('Agora é 1 conquista provada na conta')
    expect(textoProvasNovas(2)).not.toBe(textoProvasTotal(2))
  })
})
