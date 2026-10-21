/**
 * Correções da v3.3 (servidor/CONTRATO-v33.md §E), lado do site: cada `it` é um achado confirmado e falhava antes.
 *
 *   - E.3: o candidato pendente/verificado que deixou de valer (Hall fechado, fora das 3) diz o motivo em vez de "Em
 *     verificação";
 *   - E.6: a semente da carreira pedida ao servidor (POST carreiras.php {acao: "semente"}) só com a conta;
 *   - E.11: o checklist só fica verde com uma carreira que conta (sem replay, sem a semente do servidor ou fora do limite
 *     não contam para nada);
 *   - E.1: o que o servidor fez com o candidato depois da verificação que bateu (ele recusa a carreira que não cumpre mais)
 *     chega na tela.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { carreirasQueContam, normalizarDesafio, normalizarMeu, type Desafio, type MeuDesafio } from './desafios'
import { Checklist } from './DesafiosTela'
import { useConta } from './conta'
import { parDaResposta, pedirSementeCarreira } from './pontes'
import { mandarResultado, numerosDoServidor } from './verificacao'

const resposta = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } })
function rede(responder: (url: string, metodo: string, corpo: string) => Response | Promise<Response>) {
  const f = vi.fn(async (u: string | URL | Request, init?: RequestInit) => responder(String(u), init?.method ?? 'GET', typeof init?.body === 'string' ? init.body : ''))
  vi.stubGlobal('fetch', f)
  return f
}

afterEach(() => {
  vi.unstubAllGlobals()
  useConta.setState({ usuario: null })
})

const desafio = normalizarDesafio({
  slug: 'tacas-do-rei',
  titulo: 'As Taças do Rei',
  descricao: '',
  regulamento: '1. Uma conta por pessoa.',
  premio: 'Texto do admin',
  criterio: { copas: 1, libertadores: 2 },
  requisitos: { partidasMin: 30, emailVerificado: true, publicadoNoHall: true, top3Perfil: true },
  ativo: true,
  inicio: '2026-10-01T00:00:00Z',
  fim: null,
  vencedor: null,
  pendentes: 0,
}) as Desafio

const carreira = (motivo: string | null, extra: Record<string, unknown> = {}) => ({
  carreiraId: 'career-x',
  jogador: 'REI',
  publicada: true,
  noTop3: true,
  temReplay: motivo !== 'sem_replay',
  vale: motivo === null,
  motivo,
  motivoTexto: motivo ? `frase de ${motivo}` : null,
  ...extra,
})

const meuCom = (cs: unknown[], candidato: unknown = null): MeuDesafio =>
  normalizarMeu({ partidas: 40, partidasMin: 30, emailVerificado: true, partidasHoje: 2, partidasDiaMax: 100, carreirasQueCumprem: cs, candidato }) as MeuDesafio

/** Os itens do checklist: [texto, marca] (a marca vai no texto escondido: cumprido / esperando / falta). */
function itens(meu: MeuDesafio): [string, string][] {
  const html = renderToStaticMarkup(createElement(Checklist, { d: desafio, meu }))
  return [...html.matchAll(/<li class="sv-item[^"]*"[^>]*>([\s\S]*?)<\/li>/g)].map((m) => {
    const t = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    return [t.split(' (')[0], /\(cumprido\)/.test(t) ? 'ok' : /\(esperando\)/.test(t) ? 'espera' : 'falta']
  })
}

describe('§E.11 · o checklist só conta a carreira que vale', () => {
  it('carreira sem replay (no Hall e entre as 3): o critério, o Hall e o top 3 NÃO ficam verdes (antes: os 5 itens verdes)', () => {
    const m = meuCom([carreira('sem_replay')])
    expect(carreirasQueContam(m.carreirasQueCumprem)).toEqual([])
    const it = itens(m)
    expect(it.find(([t]) => t.startsWith('1 Copa do Mundo'))?.[1]).toBe('falta')
    expect(it.find(([t]) => t.startsWith('A carreira publicada'))?.[1]).toBe('espera')
    expect(it.find(([t]) => t.startsWith('A carreira entre as 3'))?.[1]).toBe('espera')
    // o porquê aparece no próprio item do critério
    expect(renderToStaticMarkup(createElement(Checklist, { d: desafio, meu: m }))).toMatch(/REI não vale: frase de sem_replay/)
    // partidas e e-mail continuam valendo por si
    expect(it.find(([t]) => t.startsWith('Partidas com a conta'))?.[1]).toBe('ok')
  })

  it('sem a semente do servidor ou fora do limite do dia: também não conta', () => {
    for (const motivo of ['sem_semente', 'limite_diario', 'imersivo', 'antes_do_inicio', 'suspeita']) {
      expect(carreirasQueContam(meuCom([carreira(motivo)]).carreirasQueCumprem), motivo).toEqual([])
    }
  })

  it('a que só espera o Hall conta para o critério (e o item do Hall fica em falta); a que vale deixa tudo verde', () => {
    const fora = meuCom([carreira('nao_publicada', { publicada: false, noTop3: false })])
    expect(carreirasQueContam(fora.carreirasQueCumprem).length).toBe(1)
    const a = itens(fora)
    expect(a.find(([t]) => t.startsWith('1 Copa do Mundo'))?.[1]).toBe('ok')
    expect(a.find(([t]) => t.startsWith('A carreira publicada'))?.[1]).toBe('falta')
    const vale = itens(meuCom([carreira(null)]))
    expect(vale.length).toBe(5)
    expect(vale.every(([, marca]) => marca === 'ok')).toBe(true)
  })
})

describe('§E.3 · o candidato que deixou de valer diz o motivo', () => {
  it('pendente com vale = false: "Não vale agora" e a frase (antes: "Em verificação: sua carreira cumpriu tudo")', () => {
    const m = meuCom([carreira('nao_publicada', { publicada: false })], { estado: 'pendente', motivo: null, em: '2026-10-18T10:00:00.123Z', carreiraId: 'career-x', vale: false, motivoAgora: 'nao_publicada', motivoAgoraTexto: 'Publique esta carreira no Hall das Lendas.' })
    expect(m.candidato).toMatchObject({ estado: 'pendente', vale: false, motivoAgora: 'Publique esta carreira no Hall das Lendas.' })
    const html = renderToStaticMarkup(createElement(Checklist, { d: desafio, meu: m }))
    expect(html).toMatch(/Não vale agora/)
    expect(html).toMatch(/Publique esta carreira no Hall das Lendas\./)
    expect(html).not.toMatch(/cumpriu tudo e está na fila/)
    // o que vale continua "em verificação"; servidor sem o campo: como antes
    const ok = renderToStaticMarkup(createElement(Checklist, { d: desafio, meu: meuCom([carreira(null)], { estado: 'pendente', vale: true }) }))
    expect(ok).toMatch(/cumpriu tudo e está na fila/)
    expect(meuCom([], { estado: 'pendente' }).candidato?.vale).toBeNull()
  })
})

describe('§E.6 · a semente da carreira pedida ao servidor', () => {
  it('sem conta: nem pede (null); com conta: POST carreiras.php {acao: "semente"} e devolve o par', async () => {
    const f = rede(() => resposta(200, { semente: [123, 4_000_000_000], id: 'career-x', motivo: null }))
    expect(await pedirSementeCarreira()).toBeNull()
    expect(f).not.toHaveBeenCalled()
    useConta.setState({ usuario: { id: 7, apelido: 'Rei' } as never })
    expect(await pedirSementeCarreira()).toEqual([123, 4_000_000_000])
    expect(String(f.mock.calls[0][0])).toMatch(/\/api\/carreiras\.php$/)
    expect(JSON.parse(String(f.mock.calls[0][1]?.body))).toEqual({ acao: 'semente' })
  })

  it('limite do dia (semente null), servidor antigo (400/503), sem rede ou par estranho: null (a carreira usa a do aparelho)', async () => {
    useConta.setState({ usuario: { id: 7, apelido: 'Rei' } as never })
    rede(() => resposta(200, { semente: null, motivo: 'limite_diario' }))
    expect(await pedirSementeCarreira()).toBeNull()
    rede(() => resposta(400, { erro: 'acao', mensagem: 'Ação desconhecida.' }))
    expect(await pedirSementeCarreira()).toBeNull()
    rede(() => resposta(503, { erro: 'indisponivel' }))
    expect(await pedirSementeCarreira()).toBeNull()
    rede(() => Promise.reject(new TypeError('Failed to fetch')))
    expect(await pedirSementeCarreira()).toBeNull()
    expect([parDaResposta([1, 2]), parDaResposta([1]), parDaResposta([-1, 2]), parDaResposta([1, 2 ** 32]), parDaResposta(['1', 2]), parDaResposta(null)]).toEqual([[1, 2], null, null, null, null, null])
  })
})

describe('§E.1 · a resposta do candidato_verificar chega na tela', () => {
  it('bateu, mas o servidor recusou (a carreira guardada não cumpre mais): mandarResultado devolve o estado e o motivo', async () => {
    rede(() => resposta(200, { ok: true, candidatos: [{ id: 7, estado: 'recusada', motivo: 'Bateu no replay, mas não vale: A carreira guardada não cumpre o critério do desafio.', valeAgora: { ok: false } }, { id: 'x' }] }))
    const feitos = await mandarResultado({ id: 7 }, { ok: true, detalhes: { v: 1 } })
    expect(feitos).toEqual([{ id: 7, estado: 'recusada', motivo: 'Bateu no replay, mas não vale: A carreira guardada não cumpre o critério do desafio.' }])
  })

  it('os números do servidor no meta (os que decidem o critério) vão para a verificação', () => {
    expect(numerosDoServidor({ copas: 3, libertadores: 2, titulos: 16, bolasOuro: 1, picoOvr: 91, gols: 431, temporadas: 24, bonusOvr: 0 })).toEqual({
      copas: 3,
      libertadores: 2,
      titulos: 16,
      bolasOuro: 1,
      pico: 91,
      gols: 431,
      temporadas: 24,
      bonusOvr: 0,
      // v3.4 (CONTRATO-v34): os números dos critérios novos e a lista de conquistas; o servidor de antes não manda
      champions: null,
      clubes: null,
      mesmoClube: null,
      copasSelecao: null,
      conquistas: null,
    })
    // servidor antigo (sem libertadores): esse número não entra na conta
    expect(numerosDoServidor({ copas: 1 }).libertadores).toBeNull()
  })
})
