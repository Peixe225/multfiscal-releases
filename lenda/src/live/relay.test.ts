import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WINDOW_ID, acquireLiveLock, captureReady, lockHolder, onLiveCommand, onLiveSim, onLiveStart, releaseLiveLock } from './channel'
import { DEFAULT_LIVE_CONFIG, mergeSyncedConfig, sameSyncedConfig, syncedConfig, useLiveConfig } from './config'
import { configArrived, createSeen, dispatchRelay, firstConfigAction, freshBeats, holderWins, relayUrl, type SyncState } from './relay'

describe('revezamento: regras puras', () => {
  it('a mesma mensagem (BroadcastChannel + ponte) vale uma vez; a lista de vistas não cresce sem fim', () => {
    const seen = createSeen(3)
    expect(seen('a.1')).toBe(true)
    expect(seen('a.1')).toBe(false)
    expect(seen('a.2')).toBe(true)
    expect(seen('a.3')).toBe(true)
    expect(seen('a.4')).toBe(true)
    // a mais antiga saiu da lista
    expect(seen('a.1')).toBe(true)
    expect(seen('a.4')).toBe(false)
  })

  it('duas janelas rodando: fica a que começou antes (empate: menor id); batimento sem "since" usa o horário', () => {
    expect(holderWins({ id: 'b', at: 9, since: 1 }, { id: 'a', at: 9, since: 2 })).toBe(true)
    expect(holderWins({ id: 'a', at: 9, since: 2 }, { id: 'b', at: 9, since: 1 })).toBe(false)
    expect(holderWins({ id: 'a', at: 9, since: 5 }, { id: 'b', at: 9, since: 5 })).toBe(true)
    expect(holderWins({ id: 'x', at: 3 }, { id: 'y', at: 9, since: 4 })).toBe(true)
  })

  it('batimentos válidos: só de outras janelas e mais novos que a validade', () => {
    const list = [{ id: 'eu', at: 100 }, { id: 'obs', at: 95 }, { id: 'velha', at: 10 }, null]
    expect(freshBeats(list, 'eu', 100, 6).map((b) => b.id)).toEqual(['obs'])
  })

  it('configuração que volta da ponte: espera o último envio desta janela voltar; as janelas terminam iguais', () => {
    let s: SyncState = { rev: 0, pending: 2 }
    // P1 mandou X1 e X2; P2 mandou Z no meio: a ponte devolve X1 (r1), Z (r2), X2 (r3)
    let r = configArrived(s, { rev: 1, from: 'p1' }, 'p1')
    expect(r.apply).toBe(false)
    s = r.state
    r = configArrived(s, { rev: 2, from: 'p2' }, 'p1')
    expect(r.apply).toBe(false) // Z ia apagar o que a pessoa acabou de digitar
    s = r.state
    r = configArrived(s, { rev: 3, from: 'p1' }, 'p1')
    expect(r).toEqual({ state: { rev: 3, pending: 0 }, apply: true })
    // repetida ou fora de ordem: nada
    expect(configArrived(r.state, { rev: 3, from: 'p2' }, 'p1').apply).toBe(false)
    expect(configArrived(r.state, { rev: 2, from: 'p2' }, 'p1').apply).toBe(false)
    expect(configArrived(r.state, { rev: 4, from: null }, 'p1').apply).toBe(true)
  })

  it('ao conectar: o painel manda a dele (ponte vazia ou mudança mais nova); a janela da live/OBS adota a da ponte', () => {
    const base = { hasSnapshot: true, snapshotAt: 100, localAt: 50, same: false }
    expect(firstConfigAction({ ...base, capture: true })).toBe('apply')
    expect(firstConfigAction({ ...base, capture: false })).toBe('apply')
    expect(firstConfigAction({ ...base, localAt: 200, capture: false })).toBe('push')
    // a janela da live nunca impõe a dela: espera o painel
    expect(firstConfigAction({ ...base, localAt: 200, capture: true })).toBe('none')
    expect(firstConfigAction({ ...base, hasSnapshot: false, capture: false })).toBe('push')
    expect(firstConfigAction({ ...base, hasSnapshot: false, capture: true })).toBe('none')
    expect(firstConfigAction({ ...base, same: true, capture: false })).toBe('none')
  })

  it('endereço do socket de revezamento', () => {
    expect(relayUrl('ws://localhost:5178/ws')).toBe('ws://localhost:5178/ws?papel=revezamento')
    expect(relayUrl(' ws://127.0.0.1:5179/ws ')).toBe('ws://127.0.0.1:5179/ws?papel=revezamento')
    expect(relayUrl('http://localhost:5178/ws')).toBe('')
    expect(relayUrl('não é endereço')).toBe('')
  })
})

describe('configuração entre o painel e o OBS', () => {
  it('a chave do Euler Stream e o endereço da ponte ficam em cada janela', () => {
    const local = { ...DEFAULT_LIVE_CONFIG, signKey: 'segredo', bridgeUrl: 'ws://localhost:5179/ws' }
    const out = syncedConfig(local) as Record<string, unknown>
    expect(out.signKey).toBeUndefined()
    expect(out.bridgeUrl).toBeUndefined()
    const merged = mergeSyncedConfig(local, { ...out, voteSeconds: 40, signKey: 'outra', bridgeUrl: 'ws://x/ws' })
    expect(merged.voteSeconds).toBe(40)
    expect(merged.signKey).toBe('segredo')
    expect(merged.bridgeUrl).toBe('ws://localhost:5179/ws')
  })

  it('só entram campos conhecidos e do tipo certo; presentes repetidos ficam numa opção só', () => {
    const merged = mergeSyncedConfig(DEFAULT_LIVE_CONFIG, { voteSeconds: '40', simAuto: 'sim', likesGoal: Number.NaN, creator: 'votacao', extra: 1, giftBindings: ['Rose', 'Rosa', 'GG', ''] })
    expect(merged.voteSeconds).toBe(DEFAULT_LIVE_CONFIG.voteSeconds)
    expect(merged.simAuto).toBe(DEFAULT_LIVE_CONFIG.simAuto)
    expect(merged.likesGoal).toBe(DEFAULT_LIVE_CONFIG.likesGoal)
    expect(merged.creator).toBe('votacao')
    expect((merged as unknown as Record<string, unknown>).extra).toBeUndefined()
    expect(merged.giftBindings).toEqual(['Rose', '', 'GG', ''])
    expect(sameSyncedConfig(DEFAULT_LIVE_CONFIG, { ...DEFAULT_LIVE_CONFIG, signKey: 'x' })).toBe(true)
    expect(sameSyncedConfig(DEFAULT_LIVE_CONFIG, { ...DEFAULT_LIVE_CONFIG, voteSeconds: 99 })).toBe(false)
  })

  it('mudança feita na tela marca a hora; a que chega da ponte entra sem voltar para ela', () => {
    useLiveConfig.setState({ config: { ...DEFAULT_LIVE_CONFIG, signKey: 'minha' }, editedAt: 0 })
    // painel conectando: a ponte tem uma configuração mais nova → vale a da ponte (sem mexer na chave)
    dispatchRelay({ type: 'config', first: true, rev: 7, at: 1000, config: { ...syncedConfig(DEFAULT_LIVE_CONFIG), creator: 'votacao', voteSeconds: 33 } })
    let s = useLiveConfig.getState()
    expect(s.config.creator).toBe('votacao')
    expect(s.config.voteSeconds).toBe(33)
    expect(s.config.signKey).toBe('minha')
    expect(s.editedAt).toBe(1000)
    // outra janela mudou de novo (rev 8); a mesma rev repetida não volta nada
    dispatchRelay({ type: 'config', rev: 8, at: 2000, from: 'outra', config: { ...syncedConfig(s.config), voteSeconds: 45 } })
    expect(useLiveConfig.getState().config.voteSeconds).toBe(45)
    dispatchRelay({ type: 'config', rev: 8, at: 2000, from: 'outra', config: { ...syncedConfig(s.config), voteSeconds: 12 } })
    expect(useLiveConfig.getState().config.voteSeconds).toBe(45)
    // mudança na tela: hora nova (é ela que vai para a ponte na próxima conexão)
    useLiveConfig.getState().set({ voteSeconds: 50 })
    s = useLiveConfig.getState()
    expect(s.editedAt).toBeGreaterThan(2000)
    // reconectou e a ponte ainda tem a velha: o painel não adota a velha (manda a dele)
    dispatchRelay({ type: 'config', first: true, rev: 8, at: 2000, config: { ...syncedConfig(s.config), voteSeconds: 45 } })
    expect(useLiveConfig.getState().config.voteSeconds).toBe(50)
  })
})

describe('trava e comandos pela ponte (OBS ↔ painel)', () => {
  const T0 = 1_800_000_000_000
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
  })
  afterEach(() => {
    releaseLiveLock()
    for (const id of ['obs1', 'obs2', 'janela1']) {
      dispatchRelay({ type: 'beat-clear', key: 'lock', id })
      dispatchRelay({ type: 'beat-clear', key: 'janela', id })
    }
    vi.useRealTimers()
  })

  it('a live rodando no OBS segura a trava: esta janela não roda; o batimento vence com a validade', () => {
    dispatchRelay({ type: 'beat', key: 'lock', beat: { id: 'obs1', at: T0, since: T0 - 5000, where: 'obs', summary: { status: 'demo', paused: true } } })
    expect(lockHolder()?.where).toBe('obs')
    expect(lockHolder()?.summary?.paused).toBe(true)
    expect(acquireLiveLock()).toBe(false)
    vi.setSystemTime(T0 + 6500)
    expect(lockHolder()).toBeNull()
    expect(acquireLiveLock()).toBe(true)
  })

  it('a janela que fecha (ou solta) a trava some na hora', () => {
    dispatchRelay({ type: 'beat', key: 'lock', beat: { id: 'obs1', at: T0, since: T0 } })
    expect(lockHolder()?.id).toBe('obs1')
    dispatchRelay({ type: 'beat-clear', key: 'lock', id: 'obs1' })
    expect(lockHolder()).toBeNull()
  })

  it('duas rodando ao mesmo tempo (começaram antes de se ver): só uma continua', () => {
    expect(acquireLiveLock()).toBe(true)
    // o OBS começou depois: esta janela continua e o OBS é que sai
    vi.setSystemTime(T0 + 1000)
    dispatchRelay({ type: 'beat', key: 'lock', beat: { id: 'obs1', at: T0 + 1000, since: T0 + 500 } })
    expect(lockHolder()).toBeNull()
    expect(acquireLiveLock()).toBe(true)
    // outra começou ANTES desta: esta sai
    dispatchRelay({ type: 'beat', key: 'lock', beat: { id: 'obs2', at: T0 + 1000, since: T0 - 100 } })
    expect(lockHolder()?.id).toBe('obs2')
    expect(acquireLiveLock()).toBe(false)
    // e não volta sozinha enquanto a outra estiver rodando
    vi.setSystemTime(T0 + 2000)
    dispatchRelay({ type: 'beat', key: 'lock', beat: { id: 'obs2', at: T0 + 2000, since: T0 - 100 } })
    expect(acquireLiveLock()).toBe(false)
  })

  it('janela pronta: com a do Chrome e a do OBS esperando, o começo vai para a do OBS', () => {
    dispatchRelay({ type: 'beat', key: 'janela', beat: { id: 'janela1', at: T0, where: 'janela' } })
    expect(captureReady()?.id).toBe('janela1')
    dispatchRelay({ type: 'beat', key: 'janela', beat: { id: 'obs1', at: T0 - 1000, where: 'obs' } })
    expect(captureReady()?.id).toBe('obs1')
    // um batimento desta própria janela (repetido pela ponte) não conta
    dispatchRelay({ type: 'beat', key: 'janela', beat: { id: WINDOW_ID, at: T0, where: 'obs' } })
    expect(captureReady()?.id).toBe('obs1')
  })

  it('janela pronta no OBS leva a carreira salva lá (o painel oferece "Continuar" com ela)', () => {
    dispatchRelay({ type: 'beat', key: 'janela', beat: { id: 'obs2', at: T0, where: 'obs', career: 'GABI FUT' } })
    expect(captureReady()).toMatchObject({ id: 'obs2', where: 'obs', career: 'GABI FUT' })
  })

  it('comandos, começo e testes chegam uma vez só (BroadcastChannel + ponte) e só o começo endereçado vale', () => {
    const cmds: string[] = []
    const starts: string[] = []
    const sims: string[] = []
    const off = [onLiveCommand((c) => cmds.push(c)), onLiveStart((m) => starts.push(m)), onLiveSim((e) => sims.push(e.type))]
    const msg = { cmd: 'pause', mid: 'p1.1', from: 'p1' }
    dispatchRelay({ type: 'relay', msg })
    dispatchRelay({ type: 'relay', msg })
    dispatchRelay({ type: 'relay', msg: { cmd: 'stop', mid: `${WINDOW_ID}.99`, from: WINDOW_ID } })
    dispatchRelay({ type: 'relay', msg: { cmd: 'start', mode: 'new', to: 'outra', mid: 'p1.2', from: 'p1' } })
    dispatchRelay({ type: 'relay', msg: { cmd: 'start', mode: 'new', to: WINDOW_ID, mid: 'p1.3', from: 'p1' } })
    dispatchRelay({ type: 'relay', msg: { sim: { type: 'chat', user: { id: 'voce.teste', name: 'Você' }, text: '1', at: 0 }, mid: 'p1.4', from: 'p1' } })
    dispatchRelay({ type: 'relay', msg: { cmd: 'apagar-tudo', mid: 'p1.5', from: 'p1' } })
    off.forEach((f) => f())
    expect(cmds).toEqual(['pause'])
    expect(starts).toEqual(['new'])
    expect(sims).toEqual(['chat'])
  })
})

describe('ponte: revezamento (live/revezamento.mjs)', () => {
  type Hub = {
    add(ws: unknown): void
    remove(ws: unknown): void
    message(ws: unknown, m: unknown): void
    snapshot(): { rev: number; at: number; config: Record<string, unknown> } | null
  }
  let tmp = ''
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lenda-rev-'))
  })
  afterEach(() => {
    vi.useRealTimers()
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  async function hub(file = path.join(tmp, 'live-config.json')) {
    const mod = (await import(/* @vite-ignore */ '../../live/revezamento.mjs' as string)) as {
      createRelayHub(o: { file?: string; send: (ws: unknown, m: unknown) => void }): Hub
      isRelayRequest(req: { url?: string }): boolean
      obsPage(): string
    }
    const inbox = new Map<unknown, Record<string, unknown>[]>()
    const send = (ws: unknown, m: unknown) => inbox.get(ws)?.push(typeof m === 'string' ? JSON.parse(m) : (m as Record<string, unknown>))
    const h = mod.createRelayHub({ file, send })
    const client = () => {
      const ws = {}
      inbox.set(ws, [])
      h.add(ws)
      return { ws, got: inbox.get(ws)!, clear: () => inbox.get(ws)!.splice(0) }
    }
    return { h, client, mod }
  }

  it('reconhece o socket de revezamento e serve a página do OBS (540×960 ampliado)', async () => {
    const { mod } = await hub()
    expect(mod.isRelayRequest({ url: '/ws?papel=revezamento' })).toBe(true)
    expect(mod.isRelayRequest({ url: '/ws' })).toBe(false)
    const html = mod.obsPage()
    expect(html).toContain('src="/#/live?tela=palco&janela=1&obs=1"')
    expect(html).toContain('name="lenda-obs"')
    expect(html).toMatch(/Math\.min\(w \/ 540, h \/ 960\)/)
    expect(html).not.toContain('will-change')
  })

  it('repassa comandos e batimentos às outras páginas; quem conecta depois recebe a configuração e quem roda', async () => {
    const { h, client } = await hub()
    const painel = client()
    expect(painel.got.map((m) => m.type)).toEqual(['hello', 'config'])
    expect(painel.got[1]).toMatchObject({ first: true, config: null })
    const obs = client()
    painel.clear()
    obs.clear()
    h.message(painel.ws, { type: 'relay', msg: { cmd: 'pause', mid: 'p.1', from: 'p' } })
    expect(obs.got).toEqual([{ type: 'relay', msg: { cmd: 'pause', mid: 'p.1', from: 'p' } }])
    expect(painel.got).toEqual([]) // sem eco para quem mandou
    const beat = { id: 'obs1', at: Date.now(), since: Date.now(), where: 'obs' }
    h.message(obs.ws, { type: 'beat', key: 'lock', beat })
    h.message(obs.ws, { type: 'beat', key: 'qualquer', beat })
    expect(painel.got).toEqual([{ type: 'beat', key: 'lock', beat }])
    // configuração: volta para todos com rev, sem a chave do Euler Stream
    h.message(painel.ws, { type: 'config', from: 'p', at: 123, config: { voteSeconds: 30, signKey: 'segredo', bridgeUrl: 'ws://x', giftBindings: ['Rose', 'GG'] } })
    const cfg = { type: 'config', rev: 1, at: 123, from: 'p', config: { voteSeconds: 30, giftBindings: ['Rose', 'GG'] } }
    expect(painel.got.at(-1)).toEqual(cfg)
    expect(obs.got.at(-1)).toEqual(cfg)
    // uma página nova: configuração guardada + quem está rodando
    const outro = client()
    expect(outro.got).toEqual([{ type: 'hello', version: 1, relay: true }, { type: 'config', first: true, rev: 1, at: 123, config: cfg.config }, { type: 'beat', key: 'lock', beat }])
    // o OBS fechou: a trava dele some para todos
    painel.clear()
    h.remove(obs.ws)
    expect(painel.got).toEqual([{ type: 'beat-clear', key: 'lock', id: 'obs1' }])
    const depois = client()
    expect(depois.got.map((m) => m.type)).toEqual(['hello', 'config'])
  })

  it('guarda a configuração no disco e começa com ela na próxima vez', async () => {
    vi.useFakeTimers()
    const file = path.join(tmp, 'sub', 'live-config.json')
    const a = await hub(file)
    const p = a.client()
    a.h.message(p.ws, { type: 'config', from: 'p', at: 500, config: { creator: 'votacao', signKey: 'segredo' } })
    a.h.message(p.ws, { type: 'config', from: 'p', at: 600, config: { creator: 'apoiador' } })
    vi.advanceTimersByTime(400)
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
    expect(saved).toEqual({ rev: 2, at: 600, config: { creator: 'apoiador' } })
    vi.useRealTimers()
    const b = await hub(file)
    expect(b.h.snapshot()).toEqual({ rev: 2, at: 600, config: { creator: 'apoiador' } })
    expect(b.client().got[1]).toEqual({ type: 'config', first: true, rev: 2, at: 600, config: { creator: 'apoiador' } })
  })
})
