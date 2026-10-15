// O Teste minha sorte no site com a frequência do painel e o relógio adiantado (roda dentro do
// scripts/testar-painel-contas.mjs, no PHP dele com GC_TESTE=1 e o Z-API falso, com a conta no servidor): o relógio do
// servidor vai no X-GC-Agora (e no Date do GET loja, que acerta a hora da loja no site) e o do navegador no page.clock.
// - 2 giros por semana e 2 giros sem conta: o aparelho gira nos dias 0 e 1 (o 2º depois de a reserva do 1º vencer,
//   em 24 h) e, no dia 3, o jogo bloqueado não promete "gira de novo agora": diz o dia em que a conta criada ali gira (o
//   dia 0 + 7, o mesmo do adesivo "Pra jogar" do Mercado), e criar a conta confirma o mesmo dia;
// - 2 giros por semana e 1 giro sem conta: o aparelho gira 1 vez; no dia 3 a conta criada ali gira na hora, e o jogo
//   diz "Cria tua conta e gira de novo agora.".

const DIA = 86400
const SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
/** "domingo, 18/10": o dia (em Brasília) de `t` (segundos). */
const diaDe = (t) => {
  const d = new Date((t - 3 * 3600) * 1000)
  return `${SEMANA[d.getUTCDay()]}, ${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * @param {{ BASE: string, ok: (c: unknown, m: string) => boolean, contexto: Function, pagina: Function,
 *   dono: (rota: string, corpo?: unknown) => Promise<{ status: number, json: any }>, print: Function,
 *   esperarCodigo: (w: string, antes: number) => Promise<string | null>, falso: { recebidos: unknown[] } }} h
 */
export async function fluxoSiteSorte(h) {
  const { BASE, ok, contexto, pagina, dono, print, esperarCodigo, falso } = h
  // o dia 0: amanhã, ao meio-dia de Brasília (15:00 UTC). Perto de hoje de propósito: o servidor é o mesmo do resto do
  // teste, e um pedido com o relógio muito na frente faz a faxina de lá (entrar apaga as sessões vencidas até "agora")
  // derrubar as sessões de verdade; com no máximo 4 dias, nada do resto vence (a sessão da conta dura 90 dias). Os
  // giros daqui não se misturam com os outros: aparelho, IP e WhatsApp próprios
  const T0 = Math.floor(Date.now() / 1000 / DIA) * DIA + DIA + 15 * 3600
  let ipN = 0

  /** Um aparelho novo com o relógio na mão: `ir(t)` muda a hora do servidor e do navegador. */
  async function aparelho(nome) {
    const ctx = await contexto(390, 844, { site: true })
    const estado = { agora: T0, ip: `198.18.40.${++ipN}` }
    // a idade respondida vale pelo relógio do navegador, que vai estar dias na frente
    await ctx.addInitScript((ate) => localStorage.setItem('gc-idade', JSON.stringify(ate)), (T0 + 60 * DIA) * 1000)
    await ctx.route('**/api/index.php*', async (route) => {
      const headers = { ...route.request().headers(), 'x-gc-agora': String(estado.agora), 'x-gc-ip': estado.ip }
      if (/[?&]r=loja\b/.test(route.request().url())) {
        const resp = await route.fetch({ headers })
        return route.fulfill({ response: resp, headers: { ...resp.headers(), date: new Date(estado.agora * 1000).toUTCString() } })
      }
      return route.continue({ headers })
    })
    const p = await pagina(ctx, nome)
    await p.clock.install({ time: estado.agora * 1000 })
    const ir = async (t) => {
      estado.agora = t
      await p.clock.setSystemTime(t * 1000)
    }
    return { ctx, p, ir }
  }
  const girar = async (p) => {
    await p.goto(`${BASE}/?uf=mg&jogo=sorte`)
    const tampa = p.locator('.sorte [role="slider"]').first()
    await tampa.waitFor({ timeout: 15000 })
    await p.waitForTimeout(800)
    await tampa.focus()
    for (let i = 0; i < 8; i++) {
      await p.keyboard.press('ArrowRight')
      await p.waitForTimeout(220)
    }
    // a revelação na fumaça vai até ~9 s no lendário, e com o relógio falso do Playwright o quadro anda mais devagar
    // (o comum, que leva ~6,8 s, passou de 9 s): espera o story sair da fumaça com folga
    await p.locator('.story-premio:not([inert])').waitFor({ timeout: 30000 })
    await p.waitForTimeout(1500)
  }
  /** Abre o jogo e devolve o texto do bloqueado (vazio se não bloqueou). */
  const bloqueado = async (p) => {
    await p.goto(`${BASE}/?uf=mg&jogo=sorte`)
    const ok = await p
      .waitForFunction(() => /Teu giro já foi\./.test(document.querySelector('.sorte .sorte-bloco')?.textContent ?? ''), undefined, { timeout: 15000 })
      .then(() => true, () => false)
    return ok ? (await p.locator('.sorte .sorte-bloco').first().innerText()).replace(/\s+/g, ' ').trim() : ''
  }

  try {
    // ─── 2 por semana, 2 giros sem conta: o aparelho encheu a janela de quem criar a conta ali ──────────────────────
    ok((await dono('admin-sorte-salvar', { intervaloDias: 7, girosPorIntervalo: 2, girosSemConta: 2 })).status === 200, 'site sorte: o dono põe 2 giros por semana e 2 sem conta')
    const libera = diaDe(T0 + 7 * DIA)
    {
      const { p, ir } = await aparelho('sorte-semana')
      await girar(p)
      // com o prêmio reservado, o jogo mostra a reserva: o 2º giro sem conta vem depois de ela vencer (24 h)
      await ir(T0 + DIA + 3600)
      await girar(p)
      await ir(T0 + 3 * DIA)
      const txt = await bloqueado(p)
      ok(txt.includes(`Cria tua conta pra girar de novo ${libera}.`) && !/gira de novo agora/.test(txt), `site sorte: 2 por semana, girou sem conta nos dias 0 e 1; no dia 3 o jogo diz o dia (${libera}), sem prometer giro agora (${txt.slice(0, 160)})`)
      await print(p, 'contas-390-sorte-bloqueado-semana')
      // o adesivo "Pra jogar" do fim do Mercado, no mesmo estado, diz o mesmo dia
      await p.goto(`${BASE}/?uf=mg&aba=mercado`)
      const adesivo = await p
        .waitForFunction((d) => (document.querySelector('.adesivos-interativos')?.textContent ?? '').includes(`Cria tua conta pra girar de novo ${d}.`), libera, { timeout: 12000 })
        .then(() => true, () => false)
      ok(adesivo, `site sorte: o adesivo do Mercado diz o mesmo dia (${libera}: ${(await p.locator('.adesivos-interativos').first().textContent().catch(() => '')) ?? ''})`)
      // criar a conta ali: a conta confirma o mesmo dia (o servidor segura até lá)
      await p.goto(`${BASE}/?uf=mg&jogo=sorte`)
      await p.getByRole('button', { name: 'Criar conta' }).first().click()
      await p.getByLabel('Teu nome').waitFor()
      const zap = '(31) 99555-0101'
      await p.getByLabel('Teu nome').fill('Relógio Teste')
      await p.getByLabel('Teu WhatsApp').fill(zap)
      const antes = falso.recebidos.length
      await p.locator('.form-acoes .botao-cheio').click()
      await p.locator('.form-codigo').waitFor()
      await p.locator('.form-codigo').fill((await esperarCodigo(zap, antes)) ?? '')
      await p.locator('.form-acoes .botao-cheio').click()
      const criou = await p
        .waitForFunction((d) => (document.querySelector('.sorte')?.textContent ?? '').includes(`Teu próximo giro libera ${d}.`), libera, { timeout: 12000 })
        .then(() => true, () => false)
      ok(criou, `site sorte: a conta criada ali confirma "Teu próximo giro libera ${libera}." (${(await p.locator('.sorte').innerText()).replace(/\s+/g, ' ').slice(0, 140)})`)
    }

    // ─── 2 por semana, 1 giro sem conta: a conta criada ali gira na hora ───────────────────────────────────────────
    ok((await dono('admin-sorte-salvar', { girosSemConta: 1 })).status === 200, 'site sorte: 1 giro sem conta')
    {
      const { p, ir } = await aparelho('sorte-semana-1')
      await girar(p)
      await ir(T0 + 3 * DIA)
      const txt = await bloqueado(p)
      ok(txt.includes('Cria tua conta e gira de novo agora.'), `site sorte: 2 por semana, girou 1 vez sem conta; no dia 3 a conta criada ali gira na hora, e o jogo diz isso (${txt.slice(0, 160)})`)
    }
  } finally {
    // de volta às regras de fábrica (o resto do teste conta com 1 por dia e 1 sem conta) e sem a conta criada aqui (o
    // resto do teste conta as contas em Clientes)
    await dono('admin-sorte-salvar', { intervaloDias: 1, girosPorIntervalo: 1, girosSemConta: 1 })
    for (const c of (await dono(`admin-clientes&busca=${encodeURIComponent('Relógio Teste')}`)).json?.clientes ?? []) await dono('admin-cliente-apagar', { id: c.id })
  }
}
