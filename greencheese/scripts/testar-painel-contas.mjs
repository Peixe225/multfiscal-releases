// Contas no navegador (Chromium do Playwright) contra o PHP de verdade, num php -S próprio com o Z-API falso (o código
// de entrada sai por ele). Chamado do fim do scripts/testar-painel.mjs; também roda sozinho:
//   node scripts/testar-painel-contas.mjs <pasta-do-build>   (termina com "contas no navegador ok")
// Painel: o dono cria a gerente e a atendente (senha provisória que aparece uma vez), a troca obrigatória no primeiro
// acesso (o servidor recusa o resto até trocar), cada papel vê só as seções e as ações dele e só os estados dele
// (Sem acesso, rateio sem Editar/passos pra atendente, pedido de outro estado recusado), o dono vê o que cada um fez,
// desativa (a sessão cai na hora), reativa e gera senha nova. Clientes: lista, busca, CSV das promoções, baixa de cupom,
// apagar conta, desligar/ligar o código.
// Site (celular): entrar com o WhatsApp e o código (número sem conta pede o nome), Minha conta com pedidos, endereços
// (guardar, apagar, o do pedido entra sozinho) e o pedido guiado oferecendo o endereço guardado; o Teste minha sorte
// sorteado no servidor (giro sem conta → reserva do aparelho → entrar guarda o cupom; 1 por dia com conta); a conta do
// aparelho indo pro servidor no primeiro login (nome e cupom); sair; apagar (LGPD); sem o código ligado, a conta volta
// a ser só do aparelho. Em cada tela: axe, sem rolagem lateral; prints dos 4 tamanhos com GC_PRINTS.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer as servidorNet } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gatewayFalso, pedidoValido } from './testar-api-pedidos.mjs'

const raiz = fileURLToPath(new URL('..', import.meta.url))
const TAMANHOS = [
  [360, 740],
  [390, 844],
  [430, 932],
  [1440, 900],
]

const livre = () =>
  new Promise((res) => {
    const s = servidorNet().listen(0, '127.0.0.1', () => {
      const pt = s.address().port
      s.close(() => res(pt))
    })
  })

/**
 * @param {{ browser: import('playwright').Browser, build: string, ok: (c: unknown, m: string) => boolean,
 *   axe: (p: import('playwright').Page, nome: string) => Promise<void>, erros: string[], prints: string | null }} a
 */
export async function fluxoContas(a) {
  const { browser, build, ok, axe, erros, prints } = a
  const falso = await gatewayFalso()
  const portaPhp = process.env.GC_TESTE_PORTA_CONTAS ? Number(process.env.GC_TESTE_PORTA_CONTAS) : await livre()
  const portaSite = process.env.GC_TESTE_PORTA_CONTAS_SITE ? Number(process.env.GC_TESTE_PORTA_CONTAS_SITE) : await livre()
  const BASE = `http://127.0.0.1:${portaSite}`
  const dados = mkdtempSync(join(tmpdir(), 'gc-contas-nav-'))
  const filhos = []
  const derrubar = () =>
    filhos.forEach((f) => {
      try {
        process.kill(-f.pid, 'SIGTERM')
      } catch {
        /* já saiu */
      }
    })
  process.on('exit', derrubar)
  filhos.push(
    spawn(process.env.PHP ?? 'php', ['-d', 'display_errors=0', '-S', `127.0.0.1:${portaPhp}`, '-t', join(raiz, 'public'), join(raiz, 'scripts', 'api-dev.php')], {
      env: { ...process.env, PHP_CLI_SERVER_WORKERS: '4', GC_TESTE: '1', GC_ZAPI_BASE: `http://127.0.0.1:${falso.porta}/zapi`, GC_DADOS: dados, GC_UPLOADS: join(dados, 'uploads') },
      stdio: 'ignore',
      detached: true,
    }),
  )
  filhos.push(
    spawn(process.execPath, [join(raiz, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--outDir', build, '--port', String(portaSite), '--strictPort', '--host', '127.0.0.1'], {
      cwd: raiz,
      env: { ...process.env, GC_API_PORTA: String(portaPhp), VITE_CONFIG_NATIVE_IGNORE_WARNING: 'true' },
      stdio: 'ignore',
      detached: true,
    }),
  )
  for (let i = 0; i < 150; i++) {
    if (await fetch(`${BASE}/api/index.php?r=admin-sessao`).then((r) => r.ok, () => false)) break
    await new Promise((r) => setTimeout(r, 100))
  }

  // ─── ajudas ──────────────────────────────────────────────────────────────────────────────────────────────────────
  const print = async (p, nome, cheia = false) => {
    if (prints) await p.screenshot({ path: join(prints, `${nome}.png`), fullPage: cheia })
  }
  const lateral = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 0.5)
  const ctxs = []
  async function contexto(w = 390, h = 844, extra = {}) {
    const movel = w < 900
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: movel ? 3 : 1, isMobile: movel, hasTouch: movel, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', acceptDownloads: true })
    ctxs.push(ctx)
    await ctx.route('https://wa.me/**', (r) => r.fulfill({ body: 'whatsapp' }))
    await ctx.route(/ipwho|geojs/, (r) => r.fulfill({ json: { success: true, country_code: 'BR', region: 'Minas Gerais', region_code: 'MG', city: 'Teófilo Otoni' } }))
    await ctx.route(/brasilapi\.com\.br\/api\/cep/, (r) => {
      const cep = r.request().url().split('/').pop()
      if (cep.startsWith('398')) return r.fulfill({ json: { cep, state: 'MG', city: 'Teófilo Otoni', neighborhood: 'Centro', street: 'Rua Doutor Manoel Esteves' } })
      return r.fulfill({ status: 404, json: { message: 'not found' } })
    })
    await ctx.route(/viacep\.com\.br/, (r) => r.fulfill({ json: { erro: true } }))
    if (extra.site) {
      // site: sem a abertura (idade e local já respondidos)
      await ctx.addInitScript(() => {
        localStorage.setItem('gc-idade', JSON.stringify(Date.now() + 864e5))
        sessionStorage.setItem('gc-abertura', '1')
      })
    }
    if (extra.init) await ctx.addInitScript(extra.init.f, extra.init.arg)
    return ctx
  }
  const pagina = async (ctx, nome) => {
    const p = await ctx.newPage()
    p.on('pageerror', (e) => erros.push(`contas ${nome}: ${e.message}`))
    // erro no console: só os que o próprio teste provoca (recusas de propósito) passam
    p.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource: the server responded with a status of (401|403|404|409|429)/.test(m.text())) erros.push(`contas ${nome} console: ${m.text()}`)
    })
    return p
  }
  const entrarPainel = async (p, login, senha) => {
    await p.goto(`${BASE}/painel/`)
    await p.getByLabel('Login').fill(login)
    await p.getByLabel('Senha', { exact: true }).fill(senha)
    await p.getByRole('button', { name: 'Entrar', exact: true }).click()
  }
  // pedido do painel por fora da tela (com a sessão e o csrf dela): o que o servidor faz quando a tela nem oferece
  const api = (p, rota, corpo) =>
    p.evaluate(
      async ([rota, corpo]) => {
        const csrf = corpo ? (await (await fetch('../api/index.php?r=admin-sessao', { credentials: 'same-origin' })).json()).csrf : null
        const r = await fetch(`../api/index.php?r=${rota}`, { method: corpo ? 'POST' : 'GET', headers: corpo ? { 'Content-Type': 'application/json', 'X-CSRF': csrf ?? '' } : {}, body: corpo ? JSON.stringify(corpo) : undefined, credentials: 'same-origin' })
        return { status: r.status, json: await r.json().catch(() => null) }
      },
      [rota, corpo],
    )
  const apiSite = (p, rota, corpo) =>
    p.evaluate(
      async ([rota, corpo]) => {
        const r = await fetch(`./api/index.php?r=${rota}`, { method: corpo ? 'POST' : 'GET', headers: corpo ? { 'Content-Type': 'application/json' } : {}, body: corpo ? JSON.stringify(corpo) : undefined, credentials: 'same-origin' })
        return { status: r.status, json: await r.json().catch(() => null) }
      },
      [rota, corpo],
    )
  const guardado = (w) => `55${w.replace(/\D/g, '')}`
  /** O último código que o Z-API falso recebeu pra esse número. */
  const ultimoCodigo = (w) => {
    const q = [...falso.recebidos].reverse().find((x) => JSON.parse(x.corpo || '{}').phone === guardado(w))
    return /\*(\d{6})\*/.exec(JSON.parse(q?.corpo ?? '{}').message ?? '')?.[1] ?? null
  }
  const esperarCodigo = async (w, antes) => {
    for (let i = 0; i < 60; i++) {
      const c = ultimoCodigo(w)
      if (c && falso.recebidos.length > antes) return c
      await new Promise((r) => setTimeout(r, 100))
    }
    return null
  }
  const site = (rota, corpo) => fetch(`${BASE}/api/index.php?r=${rota}`, { method: corpo ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: corpo ? JSON.stringify(corpo) : undefined })

  try {
    // ─── loja de pé: dono, Z-API (falso) e pedidos de MG e RJ ─────────────────────────────────────────────────────
    let cookie = ''
    let csrf = ''
    const dono = async (rota, corpo) => {
      const r = await fetch(`${BASE}/api/index.php?r=${rota}`, { method: corpo ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Origin: BASE, Cookie: cookie, ...(csrf ? { 'X-CSRF': csrf } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined })
      for (const c of r.headers.getSetCookie()) {
        const m = /^gc_painel=([^;]*)/.exec(c)
        if (m) cookie = `gc_painel=${m[1]}`
      }
      const j = await r.json().catch(() => null)
      if (j?.csrf) csrf = j.csrf
      return { status: r.status, json: j }
    }
    ok((await dono('admin-instalar', { codigo: 'dev-instalar-greencheese', login: 'dono', nome: 'Dono da Green', senha: 'senha-forte-123' })).status === 201, 'contas: painel instalado')
    ok((await dono('admin-avisos-salvar', { motor: 'zapi', zapi: { instancia: '3C5A0B1D2E3F', token: 'TOKENZAPI0123456789' }, destino: { tipo: 'grupo', valor: '120363012345678901' } })).json?.ok, 'contas: Avisos no WhatsApp ligados (Z-API falso)')
    const pedMG = pedidoValido({ nome: 'Pedido de Minas' })
    const pedRJ = pedidoValido({ uf: 'rj', cidade: 'Rio de Janeiro', nome: 'Pedido do Rio', entrega: { endereco: 'Rua Barata Ribeiro, 300, Copacabana', rua: '', numero: '', bairro: '', cep: '', cidade: '', uf: '' } })
    for (const x of [pedMG, pedRJ]) ok((await site('pedido', x)).status === 201, `contas: pedido ${x.uf.toUpperCase()} chegou`)
    const idRJ = (await dono('admin-pedidos', null)).json?.pedidos?.find((x) => x.codigo === pedRJ.codigo)?.id

    // ─── painel: o dono cria os acessos ────────────────────────────────────────────────────────────────────────────
    const cD = await contexto(390, 844)
    const pD = await pagina(cD, 'dono')
    await entrarPainel(pD, 'dono', 'senha-forte-123')
    await pD.getByText('Oi, Dono.').waitFor()
    await pD.goto(`${BASE}/painel/#/conta`)
    await pD.getByRole('link', { name: 'Equipe' }).first().click()
    await pD.getByRole('heading', { name: 'Equipe', level: 1 }).waitFor()
    await pD.locator('.ct-linha').first().waitFor()
    ok((await pD.locator('.ct-linha').count()) === 1, 'equipe: só o dono no começo')
    await pD.getByRole('button', { name: 'Novo acesso' }).click()
    const folha = pD.getByRole('dialog', { name: 'Novo acesso' })
    await folha.waitFor()
    await folha.getByRole('button', { name: 'Criar acesso' }).click()
    ok(/O nome da pessoa/.test(await folha.innerText()), 'novo acesso: sem nome, diz o que falta')
    await folha.getByLabel('Nome').fill('Carla Mendes')
    ok((await folha.getByLabel('Login').inputValue()) === 'carla.mendes', 'novo acesso: sugere o login pelo nome (carla.mendes)')
    await folha.getByRole('radio', { name: /^Gerente/ }).check()
    await folha.getByRole('button', { name: 'Criar acesso' }).click()
    ok(/Escolhe pelo menos um estado/.test(await folha.innerText()), 'novo acesso: gerente sem estado, pede o estado')
    await folha.getByRole('button', { name: 'Minas Gerais' }).click()
    ok((await folha.getByRole('button', { name: 'Minas Gerais' }).getAttribute('aria-pressed')) === 'true', 'novo acesso: o chip do estado fica marcado (aria-pressed)')
    await axe(pD, 'novo acesso')
    await print(pD, 'contas-390-novo-acesso')
    await folha.getByRole('button', { name: 'Criar acesso' }).click()
    const criado = pD.getByRole('dialog', { name: 'Acesso criado' })
    await criado.waitFor()
    const senhaCarla = (await criado.locator('.ct-senha-valor').innerText()).trim()
    ok(/^[a-hj-km-np-z2-9]{4}-[a-hj-km-np-z2-9]{4}-[a-hj-km-np-z2-9]{4}$/.test(senhaCarla), `acesso criado: a senha provisória aparece uma vez (${senhaCarla})`)
    ok((await criado.getByRole('button', { name: 'Copiar login e senha' }).count()) === 1, 'acesso criado: botão de copiar login e senha')
    await print(pD, 'contas-390-acesso-criado')
    await criado.getByRole('button', { name: 'Pronto' }).click()
    await pD.getByRole('button', { name: 'Novo acesso' }).click()
    await folha.getByLabel('Nome').fill('Bruno Lima')
    await folha.getByLabel('Login').fill('bruno.rj')
    await folha.getByRole('button', { name: 'Rio de Janeiro' }).click()
    await folha.getByRole('button', { name: 'Criar acesso' }).click()
    await criado.waitFor()
    const senhaBruno = (await criado.locator('.ct-senha-valor').innerText()).trim()
    await criado.getByRole('button', { name: 'Pronto' }).click()
    await pD.waitForTimeout(300)
    const linhas = await pD.locator('.ct-linha').allInnerTexts()
    ok(linhas.length === 3 && linhas.some((t) => /Carla Mendes[\s\S]*Gerente · MG[\s\S]*Ainda não trocou a senha provisória/.test(t)) && linhas.some((t) => /Bruno Lima[\s\S]*Atendente · RJ/.test(t)), 'equipe: os dois novos com papel, estado e "ainda não trocou a senha"')

    // ─── a gerente: troca obrigatória e o que ela vê ───────────────────────────────────────────────────────────────
    const cG = await contexto(390, 844)
    const pG = await pagina(cG, 'gerente')
    await entrarPainel(pG, 'carla.mendes', senhaCarla)
    await pG.getByRole('heading', { name: 'Oi, Carla' }).waitFor()
    ok((await pG.getByLabel('Senha provisória', { exact: true }).count()) === 1, 'gerente: no primeiro acesso, o painel pede a senha nova antes de tudo')
    ok((await api(pG, 'admin-resumo')).json?.erro === 'trocar-senha', 'gerente: com a senha provisória, o servidor recusa o resto (403 trocar-senha)')
    await pG.goto(`${BASE}/painel/#/pedidos`)
    await pG.waitForTimeout(400)
    ok((await pG.getByLabel('Senha provisória', { exact: true }).count()) === 1, 'gerente: mudar a URL não passa da troca de senha')
    await axe(pG, 'troca obrigatória')
    await print(pG, 'contas-390-troca-obrigatoria')
    await pG.getByLabel('Senha provisória', { exact: true }).fill(senhaCarla)
    await pG.getByLabel('Senha nova', { exact: true }).fill('curta')
    await pG.getByLabel('Repete a senha nova').fill('curta')
    await pG.getByRole('button', { name: 'Salvar e entrar' }).click()
    ok(/10 caracteres/.test(await pG.locator('main, body').first().innerText()), 'gerente: senha curta recusada')
    await pG.getByLabel('Senha nova', { exact: true }).fill('senha-da-carla-1')
    await pG.getByLabel('Repete a senha nova').fill('senha-da-carla-1')
    await pG.getByRole('button', { name: 'Salvar e entrar' }).click()
    await pG.getByText('Oi, Carla.').waitFor()
    await pG.locator('.pd-resumo-novos .pd-linha').first().waitFor()
    const barraG = await pG.locator('.pn-barra a').allInnerTexts().catch(() => [])
    const lateralG = await pG.evaluate(() => [...document.querySelectorAll('.pn-barra a, .pn-lateral a')].map((a) => a.getAttribute('aria-label') || a.textContent.trim()))
    ok(!lateralG.some((t) => /Equipe|Clientes|Avisos|Textos|Servidor/.test(t)), `gerente: sem Equipe, Clientes, Avisos, Textos e Servidor no menu (${lateralG.join(', ') || barraG.join(', ')})`)
    const novosG = await pG.locator('.pd-resumo-novos .pd-linha').allInnerTexts()
    ok(novosG.length === 1 && novosG[0].includes(pedMG.codigo), 'gerente: o Resumo mostra só o pedido de MG')
    ok(!/Aviso no grupo/.test(await pG.locator('.pd-resumo-novos').innerText()), 'gerente: sem o alerta dos avisos no grupo (é do dono)')
    await axe(pG, 'resumo da gerente')
    await pG.goto(`${BASE}/painel/#/equipe`)
    await pG.getByRole('heading', { name: 'Sem acesso' }).waitFor()
    ok(true, 'gerente: Equipe por link dá "Sem acesso"')
    await print(pG, 'contas-390-sem-acesso')
    await pG.goto(`${BASE}/painel/#/pedido/${idRJ}`)
    await pG.waitForTimeout(800)
    ok(/outro estado/.test(await pG.locator('.pn-pagina').innerText()), 'gerente: pedido do RJ por link é recusado (é de outro estado)')
    await pG.goto(`${BASE}/painel/#/pedidos`)
    await pG.locator('.pd-linha').first().waitFor()
    ok((await pG.getByRole('link', { name: 'Avisos', exact: true }).count()) === 0 && (await pG.getByText('Ajustes dos pedidos').count()) === 0, 'gerente: Pedidos sem o atalho dos Avisos e dos Textos')
    await pG.goto(`${BASE}/painel/#/rateio/arizona-green-tea`)
    await pG.getByRole('heading', { name: /Arizona/ }).waitFor()
    ok((await pG.getByRole('link', { name: 'Editar' }).count()) === 1, 'gerente: rateio com Editar')

    // ─── o atendente: só pedidos e participantes do RJ ─────────────────────────────────────────────────────────────
    const cA = await contexto(390, 844)
    const pA = await pagina(cA, 'atendente')
    await entrarPainel(pA, 'bruno.rj', senhaBruno)
    await pA.getByLabel('Senha provisória', { exact: true }).fill(senhaBruno)
    await pA.getByLabel('Senha nova', { exact: true }).fill('senha-do-bruno-1')
    await pA.getByLabel('Repete a senha nova').fill('senha-do-bruno-1')
    await pA.getByRole('button', { name: 'Salvar e entrar' }).click()
    await pA.getByText('Oi, Bruno.').waitFor()
    await pA.locator('.pd-resumo-novos .pd-linha').first().waitFor()
    const novosA = await pA.locator('.pd-resumo-novos .pd-linha').allInnerTexts()
    ok(novosA.length === 1 && novosA[0].includes(pedRJ.codigo), 'atendente: o Resumo mostra só o pedido do RJ')
    ok((await pA.getByRole('link', { name: 'Criar rateio' }).count()) === 0, 'atendente: sem Criar rateio')
    await pA.goto(`${BASE}/painel/#/rateio/arizona-green-tea`)
    await pA.getByRole('heading', { name: /Arizona/ }).waitFor()
    const det = await pA.locator('.pn-pagina').innerText()
    ok((await pA.getByRole('link', { name: 'Editar' }).count()) === 0 && (await pA.getByRole('button', { name: /Fechar agora|Fechar o rateio|Cancelar o rateio|Apagar o rateio/ }).count()) === 0, 'atendente: rateio sem Editar, sem passos, sem cancelar/apagar')
    ok(/Mudar o status do rateio é com o gerente ou o dono/.test(det), 'atendente: diz quem muda o status')
    ok((await pA.getByRole('button', { name: 'Incluir' }).count()) === 1, 'atendente: inclui participante')
    await axe(pA, 'rateio do atendente')
    await print(pA, 'contas-390-rateio-atendente', true)
    await pA.goto(`${BASE}/painel/#/rateio/arizona-green-tea/editar`)
    await pA.getByRole('heading', { name: 'Sem acesso' }).waitFor()
    ok(true, 'atendente: editar rateio por link dá "Sem acesso"')
    await pA.goto(`${BASE}/painel/#/pedido/${idRJ}`)
    await pA.getByRole('heading', { name: new RegExp(pedRJ.codigo) }).waitFor()
    ok((await pA.getByRole('heading', { name: 'Aviso no grupo' }).count()) === 0, 'atendente: pedido sem o bloco dos avisos no grupo')
    ok((await api(pA, 'admin-rateio-status', { id: 'arizona-green-tea', status: 'fechado' })).json?.erro === 'sem-permissao', 'atendente: o servidor recusa mudar o status do rateio (403 sem-permissao)')
    await pA.goto(`${BASE}/painel/#/atividade`)
    await pA.getByText('O que tu fez no painel').waitFor()
    const evA = await pA.locator('.pn-eventos').innerText()
    ok(/Trocou a senha provisória/.test(evA) && !/Carla|carla/.test(evA), 'atendente: a Atividade mostra só o que ele fez')

    // ─── o dono: o que cada um fez, desativar, reativar, senha nova ────────────────────────────────────────────────
    await pD.goto(`${BASE}/painel/#/equipe/carla.mendes`)
    await pD.getByRole('heading', { name: 'Carla Mendes', level: 1 }).waitFor()
    await pD.getByRole('heading', { name: 'O que fez' }).waitFor()
    await pD.waitForFunction(() => /Trocou a senha provisória/.test(document.body.innerText), null, { timeout: 6000 }).catch(() => {})
    ok(/Trocou a senha provisória/.test(await pD.locator('.pn-pagina').innerText()), 'dono: vê o que a gerente fez (trocou a senha provisória)')
    await axe(pD, 'acesso da gerente')
    await print(pD, 'contas-390-usuario', true)
    await pD.getByRole('button', { name: 'Desativar acesso' }).click()
    await pD.getByRole('alertdialog', { name: /Desativar o acesso de Carla/ }).getByRole('button', { name: 'Desativar' }).click()
    await pD.getByText('Acesso desativado.').waitFor()
    ok((await api(pG, 'admin-resumo')).status === 401, 'desativar: a sessão da gerente cai na hora')
    await entrarPainel(pG, 'carla.mendes', 'senha-da-carla-1')
    await pG.waitForTimeout(800)
    ok(/desativad/i.test(await pG.locator('body').innerText()), 'desativar: a gerente não entra mais (acesso desativado)')
    await pD.getByRole('button', { name: 'Reativar acesso' }).click()
    await pD.getByRole('alertdialog', { name: /Reativar o acesso de Carla/ }).getByRole('button', { name: 'Reativar' }).click()
    await pD.getByText('Acesso reativado.').waitFor()
    await pD.getByRole('button', { name: 'Gerar senha provisória' }).click()
    await pD.getByRole('alertdialog', { name: /Senha nova pra Carla/ }).getByRole('button', { name: 'Gerar senha provisória' }).click()
    const senhaNova = (await pD.getByRole('dialog', { name: 'Senha provisória' }).locator('.ct-senha-valor').innerText()).trim()
    ok(/^[a-hj-km-np-z2-9]{4}(-[a-hj-km-np-z2-9]{4}){2}$/.test(senhaNova) && senhaNova !== senhaCarla, 'senha nova: provisória nova, diferente da primeira')
    await pD.getByRole('dialog', { name: 'Senha provisória' }).getByRole('button', { name: 'Pronto' }).click()
    await entrarPainel(pG, 'carla.mendes', senhaNova)
    await pG.getByLabel('Senha provisória', { exact: true }).waitFor()
    ok(true, 'senha nova: a gerente entra com ela e troca de novo')
    await pD.goto(`${BASE}/painel/#/atividade?quem=carla.mendes`)
    await pD.getByRole('heading', { name: 'Atividade de @carla.mendes' }).waitFor()
    ok(/Só o que @carla\.mendes fez/.test(await pD.locator('.pn-pagina').innerText()), 'dono: a Atividade filtrada por pessoa')

    // ─── site: entrar com o código (número sem conta pede o nome) ──────────────────────────────────────────────────
    const ZAP = '(33) 98811-2233'
    const cS = await contexto(390, 844, { site: true })
    const pS = await pagina(cS, 'site')
    await pS.goto(`${BASE}/?uf=mg&aba=estados`)
    const tua = pS.locator('.pe-conta-tua button')
    await tua.waitFor({ timeout: 10000 })
    await pS.waitForFunction(() => /Entrar com teu WhatsApp/.test(document.querySelector('.pe-conta-tua')?.textContent ?? ''), null, { timeout: 8000 }).catch(() => {})
    ok(/Entrar com teu WhatsApp/.test(await tua.innerText()), 'site: com o código ligado, Por estado oferece "Entrar com teu WhatsApp"')
    await tua.click()
    const entrar = pS.locator('.conta-entrar')
    await entrar.waitFor()
    await axe(pS, 'site: entrar')
    let antes = falso.recebidos.length
    await entrar.getByLabel('Teu WhatsApp').fill(ZAP)
    await entrar.locator('button[type=submit]').click()
    await entrar.locator('.form-codigo').waitFor()
    const cod1 = await esperarCodigo(ZAP, antes)
    ok(/^\d{6}$/.test(cod1 ?? ''), `site: o código chegou pelo WhatsApp da loja (${cod1})`)
    const msg = JSON.parse(falso.recebidos[falso.recebidos.length - 1].corpo).message
    ok(/é teu código pra entrar na Green Cheese\. Vale por 10 minutos/.test(msg) && /a loja nunca pede esse código/.test(msg), 'site: a mensagem do código diz a validade e que a loja nunca pede ele')
    ok((await entrar.getByRole('button', { name: /Mandar outro código|Outro código em/ }).count()) === 1, 'site: "mandar outro código" (com espera de 1 min)')
    await axe(pS, 'site: código')
    await print(pS, 'contas-390-site-codigo')
    await entrar.locator('.form-codigo').fill(cod1 === '000000' ? '111111' : '000000')
    await entrar.locator('button[type=submit]').click()
    await entrar.locator('.form-alerta, .form-erro').first().waitFor()
    ok(/errad|não confere|tentativa/i.test(await entrar.innerText()), 'site: código errado avisa (e diz quantas tentativas restam)')
    await entrar.locator('.form-codigo').fill(cod1)
    await entrar.locator('button[type=submit]').click()
    await entrar.getByLabel('Teu nome').waitFor()
    ok(/Primeira vez por aqui/.test(await entrar.innerText()), 'site: número sem conta pede o nome (o mesmo código vale)')
    await print(pS, 'contas-390-site-nome')
    await entrar.getByLabel('Teu nome').fill('Marina Costa')
    await entrar.locator('label', { hasText: 'Quero receber promoções' }).click()
    await entrar.locator('button[type=submit]').click()
    await pS.locator('.conta-oi').waitFor({ timeout: 8000 })
    ok(/Marina/.test(await pS.locator('.conta-oi').innerText()), 'site: conta criada e aberta (Minha conta)')
    const eu = await apiSite(pS, 'cliente-eu')
    ok(eu.json?.conta?.whatsapp === guardado(ZAP) && eu.json?.conta?.aceitaPromo === true, 'site: a sessão gc_cliente vale (cliente-eu com a conta e as promoções)')
    const ck = (await cS.cookies()).find((c) => c.name === 'gc_cliente')
    ok(ck && ck.httpOnly && ck.sameSite === 'Lax' && ck.expires - Date.now() / 1000 > 89 * 86400, 'site: cookie gc_cliente HttpOnly, SameSite=Lax, 90 dias')
    await axe(pS, 'site: minha conta')
    await print(pS, 'contas-390-site-minha-conta')
    const conta = pS.locator('.conta')
    const textoConta = await conta.innerText()
    ok(/Meus pedidos/.test(textoConta) && /Meus endereços/.test(textoConta) && /Minhas vagas de rateio/.test(textoConta) && /Baixar meus dados/.test(textoConta), 'site: Minha conta com pedidos, endereços, vagas e baixar meus dados')

    // endereço guardado na conta → o pedido guiado oferece
    await conta.getByRole('button', { name: 'Adicionar endereço' }).click()
    await conta.getByLabel('Nome do endereço (opcional)').fill('Casa')
    await conta.getByLabel('CEP').fill('39800-000')
    await conta.getByLabel('Rua').waitFor()
    await pS.waitForFunction(() => [...document.querySelectorAll('.conta input')].some((i) => i.value === 'Rua Doutor Manoel Esteves'), null, { timeout: 6000 }).catch(() => {})
    await conta.getByLabel('Número e complemento').fill('120, apto 201')
    await conta.getByRole('button', { name: 'Guardar endereço' }).click()
    await conta.getByText(/Casa/).first().waitFor()
    ok(/Rua Doutor Manoel Esteves, 120, apto 201/.test(await conta.innerText()), 'site: endereço guardado pelo CEP (rua do CEP + número)')
    await print(pS, 'contas-390-site-endereco')
    const sd = await apiSite(pS, 'cliente-eu')
    ok(sd.json?.enderecos?.length === 1 && sd.json.enderecos[0].apelido === 'Casa', 'site: o endereço ficou no servidor')
    // pedido guiado: o endereço guardado vira um chip no passo do endereço
    await pS.keyboard.press('Escape')
    await pS.waitForTimeout(600)
    await pS.goto(`${BASE}/?uf=mg&aba=catalogo`)
    await pS.getByRole('button', { name: /Seda OCB Premium Slim.*Abrir story/ }).click()
    await pS.waitForTimeout(900)
    await pS.getByRole('button', { name: 'Pôr na sacola' }).click()
    await pS.waitForTimeout(900)
    await pS.keyboard.press('Escape')
    await pS.waitForTimeout(700)
    await pS.locator('.barra-abas [data-aba="sacola"]:visible, .lateral-item:has-text("Sacola"):visible').first().click()
    await pS.waitForTimeout(700)
    await pS.getByRole('button', { name: 'Fazer pedido' }).click()
    await pS.waitForTimeout(700)
    const clicar = async (nome) => {
      await pS.getByRole('button', { name: nome, exact: true }).last().click()
      await pS.waitForTimeout(300)
    }
    const digitar = async (t) => {
      await pS.locator('.dm-entrada input').fill(t)
      await pS.locator('.dm-entrada').evaluate((f) => f.requestSubmit())
      await pS.waitForTimeout(350)
    }
    await clicar('Isso')
    await clicar('Tá certo')
    // o nome da conta vem como sugestão
    const sug = pS.getByRole('button', { name: 'Marina Costa', exact: true })
    ok((await sug.count()) >= 1, 'pedido guiado: sugere o nome da conta')
    await sug.last().click()
    await pS.waitForTimeout(400)
    const chipCasa = pS.getByRole('button', { name: /^Casa: Rua Doutor Manoel Esteves, 120, apto 201$/ })
    ok((await chipCasa.count()) === 1, 'pedido guiado: oferece o endereço guardado na conta ("Casa: …")')
    await print(pS, 'contas-390-site-chat-endereco')
    await chipCasa.click()
    await pS.waitForTimeout(400)
    await clicar('Pix')
    await digitar('Sem observação')
    await pS.waitForTimeout(500)
    const zap = pS.getByRole('link', { name: 'Fechar pedido no WhatsApp' })
    const href = await zap.getAttribute('href')
    ok(/Rua Doutor Manoel Esteves/.test(decodeURIComponent(href ?? '')), 'pedido guiado: a mensagem sai com o endereço guardado')
    await zap.scrollIntoViewIfNeeded()
    await pS.waitForTimeout(500)
    await zap.click()
    await pS.waitForTimeout(1500)
    // o toque abre o WhatsApp (nesta aba): volta pro site pra perguntar
    if (!pS.url().startsWith(BASE)) await pS.goto(`${BASE}/?uf=mg`)
    const meus = await apiSite(pS, 'cliente-pedidos')
    ok(meus.json?.pedidos?.length === 1, 'pedido com a conta aberta: entra em "Meus pedidos"')
    const pedConta = (await dono('admin-pedidos', null)).json?.pedidos?.find((x) => x.nome === 'Marina Costa')
    ok(pedConta?.whatsapp === guardado(ZAP), 'pedido com a conta aberta: o WhatsApp da conta vai junto pro painel')
    await pS.goto(`${BASE}/?uf=mg&aba=estados`)
    // quem volta do WhatsApp encontra o pedido guiado perguntando se mandou: fecha ele
    const chat = pS.getByRole('dialog', { name: 'Pedido guiado' })
    if (await chat.waitFor({ timeout: 3000 }).then(() => true, () => false)) {
      await pS.keyboard.press('Escape')
      await chat.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {})
    }
    await pS.locator('.pe-conta-tua button').click()
    await pS.locator('.cs-pedido').first().waitFor({ timeout: 8000 })
    const pedTela = await pS.locator('.cs-pedido').first().innerText()
    ok(pedTela.includes(pedConta?.codigo ?? 'x') && /Recebido/.test(pedTela), `Minha conta: o pedido aparece com o código e o andamento ("${pedTela.replace(/\s+/g, ' ').slice(0, 60)}")`)
    await print(pS, 'contas-390-site-meus-pedidos')
    await pS.keyboard.press('Escape')

    // ─── Teste minha sorte no servidor ─────────────────────────────────────────────────────────────────────────────
    // giro sem conta (outro aparelho): o servidor sorteia e reserva pro aparelho; entrar guarda o cupom
    const ZAP2 = '(31) 99123-4567'
    const cJ = await contexto(390, 844, { site: true })
    const pJ = await pagina(cJ, 'sorte')
    await pJ.goto(`${BASE}/?uf=mg&jogo=sorte`)
    await pJ.locator('.sorte [role="slider"]').first().waitFor({ timeout: 15000 })
    await pJ.waitForTimeout(800)
    await pJ.locator('.sorte [role="slider"]').first().focus()
    for (let i = 0; i < 8; i++) {
      await pJ.keyboard.press('ArrowRight')
      await pJ.waitForTimeout(220)
    }
    await pJ.locator('.story-premio').waitFor({ timeout: 10000 })
    await pJ.waitForTimeout(3500)
    const aparelhoJ = await pJ.evaluate(() => JSON.parse(localStorage.getItem('gc-conta') ?? '{}').state?.aparelho ?? null)
    const giroJ = await apiSite(pJ, `cliente-giro&interativo=sorte&aparelho=${aparelhoJ}`)
    ok(giroJ.json?.pendente?.premioId && giroJ.json?.giro?.disponivel === false, `sorte sem conta: o servidor sorteou e reservou pro aparelho (${giroJ.json?.pendente?.premioId})`)
    await print(pJ, 'contas-390-sorte-premio')
    await pJ.locator('.sorte-pe .botao-cheio').click()
    await pJ.waitForTimeout(700)
    await pJ.getByLabel('Teu nome').fill('Júlia Andrade')
    await pJ.getByLabel('Teu WhatsApp').fill(ZAP2)
    antes = falso.recebidos.length
    await pJ.locator('.form-acoes .botao-cheio').click()
    await pJ.locator('.form-codigo').waitFor()
    const cod2 = await esperarCodigo(ZAP2, antes)
    await pJ.locator('.form-codigo').fill(cod2 ?? '')
    await pJ.locator('.form-acoes .botao-cheio').click()
    await pJ.waitForFunction(() => /SORTE-[A-Z0-9]{4}/.test(document.querySelector('.sorte')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => {})
    const euJ = await apiSite(pJ, `cliente-eu&aparelho=${aparelhoJ}`)
    const cupomJ = euJ.json?.cupons?.[0]
    ok(euJ.json?.cupons?.length === 1 && /^SORTE-[A-Z0-9]{4}$/.test(cupomJ?.codigo ?? '') && cupomJ.premioId === giroJ.json.pendente.premioId, `sorte: criar a conta guarda o prêmio reservado como cupom (${cupomJ?.codigo})`)
    ok(new RegExp(cupomJ?.codigo ?? 'x').test(await pJ.locator('.sorte').innerText()), 'sorte: o cupom com o código aparece no jogo')
    await pJ.waitForTimeout(1500) // o cadeado do adesivo abre e mostra o código
    await print(pJ, 'contas-390-sorte-guardado')
    const giroDepois = await apiSite(pJ, `cliente-giro&interativo=sorte&aparelho=${aparelhoJ}`)
    ok(giroDepois.json?.giro?.disponivel === false && giroDepois.json.giro.motivo === 'ja-girou-hoje', 'sorte: com conta, 1 giro por dia (o de hoje já foi)')
    ok((await apiSite(pJ, 'cliente-girar', { interativo: 'sorte', uf: 'mg', aparelho: aparelhoJ })).json?.erro === 'sem-giro', 'sorte: girar de novo hoje é recusado pelo servidor')

    // ─── a conta do aparelho vai pro servidor no primeiro login ────────────────────────────────────────────────────
    const ZAP3 = '(33) 99777-1234'
    const agora = Date.now()
    const local = {
      state: {
        contas: {
          [guardado(ZAP3)]: {
            conta: { id: 'local-1', nome: 'Bia do Aparelho', whatsapp: guardado(ZAP3), aceitaPromo: true, aceitaPromoEm: agora - 864e5, confirmou18Em: agora - 864e5, criadaEm: agora - 864e5 },
            cupons: [
              {
                codigo: 'SORTE-K8EA',
                interativo: 'sorte',
                premioId: 'ocb-4-por-3',
                retrato: { titulo: '4 por 3 na OCB', regra: 'Leva 4 Seda OCB Premium Slim e paga 3', aplicaA: { produtos: ['seda-ocb-premium-slim'] }, comoUsar: 'Põe 4 na sacola e usa o cupom.', tipo: 'leve-x-pague-y', valor: { leve: 4, pague: 3 } },
                demo: true,
                ganhoEm: agora - 864e5,
                validoAte: agora + 5 * 864e5,
              },
            ],
          },
        },
        atual: guardado(ZAP3),
        giros: {},
        pendente: null,
        vistos: [],
      },
      version: 1,
    }
    const cM = await contexto(390, 844, { site: true, init: { f: (s) => localStorage.setItem('gc-conta', s), arg: JSON.stringify(local) } })
    const pM = await pagina(cM, 'migrar')
    await pM.goto(`${BASE}/?uf=mg&aba=estados`)
    const tuaM = pM.locator('.pe-conta-tua button')
    await tuaM.waitFor({ timeout: 10000 })
    await pM.waitForFunction(() => /Entrar com teu WhatsApp/.test(document.querySelector('.pe-conta-tua')?.textContent ?? ''), null, { timeout: 8000 }).catch(() => {})
    ok(/Entrar com teu WhatsApp/.test(await tuaM.innerText()), 'migração: com a loja guardando contas, a conta do aparelho espera a confirmação do número')
    await tuaM.click()
    const entrarM = pM.locator('.conta-entrar')
    await entrarM.waitFor()
    ok((await entrarM.getByLabel('Teu WhatsApp').inputValue()).replace(/\D/g, '') === ZAP3.replace(/\D/g, ''), 'migração: o número da conta do aparelho já vem no campo')
    ok(/Bia do Aparelho|1 cupom/.test(await entrarM.innerText()), 'migração: avisa que a conta do aparelho vai junto')
    await print(pM, 'contas-390-migracao')
    antes = falso.recebidos.length
    await entrarM.locator('button[type=submit]').click()
    await entrarM.locator('.form-codigo').waitFor()
    await entrarM.locator('.form-codigo').fill((await esperarCodigo(ZAP3, antes)) ?? '')
    await entrarM.locator('button[type=submit]').click()
    await pM.locator('.conta-oi').waitFor({ timeout: 8000 })
    const euM = await apiSite(pM, 'cliente-eu')
    ok(euM.json?.conta?.nome === 'Bia do Aparelho' && euM.json?.conta?.aceitaPromo === true, 'migração: a conta nasce no servidor com o nome e as promoções do aparelho (sem pedir o nome)')
    ok(euM.json?.cupons?.some((k) => k.codigo === 'SORTE-K8EA' && k.origem === 'aparelho'), 'migração: o cupom que valia veio junto, com o mesmo código')
    ok(/SORTE-K8EA/.test(await pM.locator('.conta').innerText()), 'migração: o cupom aparece em Minha conta')
    const cache = await pM.evaluate(() => JSON.parse(localStorage.getItem('gc-conta') ?? '{}').state)
    ok(cache?.servidor && !cache.paraMigrar && Object.keys(cache.contas ?? {}).length === 1, 'migração: o cache do aparelho fica só com a conta do servidor')

    // ─── painel: Clientes ─────────────────────────────────────────────────────────────────────────────────────────
    await pD.goto(`${BASE}/painel/#/clientes`)
    await pD.locator('.ct-linha').first().waitFor()
    const nums = await pD.locator('.ct-numeros').innerText()
    ok(/3\s+contas/.test(nums) && /2\s+aceitaram promoções/.test(nums), `clientes: 3 contas, 2 com promoções (${nums.replace(/\s+/g, ' ')})`)
    await axe(pD, 'clientes')
    await pD.getByLabel('Buscar cliente').fill('bia')
    await pD.waitForFunction(() => document.querySelectorAll('.ct-linha').length === 1, null, { timeout: 6000 }).catch(() => {})
    ok((await pD.locator('.ct-linha').count()) === 1 && /Bia do Aparelho/.test(await pD.locator('.ct-linha').innerText()), 'clientes: busca pelo nome')
    const baixa = pD.waitForEvent('download')
    await pD.getByRole('button', { name: 'Baixar lista (Excel)' }).click()
    const arq = await baixa
    const csv = readFileSync(await arq.path())
    ok(csv[0] === 0xef && csv[1] === 0xbb && csv[2] === 0xbf && /^Nome;WhatsApp;Estado;Aceitou promoções em;Conta criada em/.test(csv.subarray(3).toString('utf8')), 'clientes: CSV das promoções pro Excel (BOM e cabeçalho)')
    ok(!/Júlia/.test(csv.toString('utf8')) && /Marina Costa/.test(csv.toString('utf8')), 'clientes: no CSV, só quem aceitou promoções')
    await pD.locator('.ct-linha').first().click()
    await pD.getByRole('heading', { name: 'Bia do Aparelho', level: 1 }).waitFor()
    ok(/veio do aparelho/.test(await pD.locator('.pn-pagina').innerText()), 'cliente: o cupom marcado como "veio do aparelho"')
    await pD.getByRole('button', { name: 'Dar baixa' }).click()
    await pD.getByRole('alertdialog', { name: /Dar baixa no SORTE-K8EA/ }).getByRole('button', { name: 'Dar baixa' }).click()
    await pD.getByRole('button', { name: 'Desfazer' }).waitFor()
    ok((await apiSite(pM, 'cliente-eu')).json?.cupons?.find((k) => k.codigo === 'SORTE-K8EA')?.usadoEm, 'cliente: a baixa do cupom chega na conta do cliente')
    await axe(pD, 'cliente')
    await print(pD, 'contas-390-cliente', true)
    await pD.getByRole('button', { name: 'Apagar a conta' }).click()
    await pD.getByRole('alertdialog', { name: /Apagar a conta de Bia/ }).getByRole('button', { name: 'Apagar a conta' }).click()
    await pD.getByText('Conta apagada.').waitFor()
    ok((await apiSite(pM, 'cliente-eu')).status === 401, 'cliente apagado pelo painel: a sessão dele no site cai')

    // ─── site: sair e apagar (LGPD) ──────────────────────────────────────────────────────────────────────────────
    await pS.goto(`${BASE}/?uf=mg&aba=estados`)
    await pS.locator('.pe-conta-tua button').click()
    await pS.locator('.conta-oi').waitFor()
    await pS.getByRole('button', { name: 'Sair', exact: true }).click()
    await pS.waitForTimeout(800)
    ok((await apiSite(pS, 'cliente-eu')).status === 401 && !(await cS.cookies()).some((c) => c.name === 'gc_cliente' && c.value && c.value !== 'deleted'), 'site: sair apaga a sessão')
    await pJ.goto(`${BASE}/?uf=mg&aba=estados`)
    await pJ.locator('.pe-conta-tua button').click()
    await pJ.locator('.conta-oi').waitFor()
    await pJ.getByRole('button', { name: 'Apagar minha conta' }).click()
    await pJ.getByRole('button', { name: 'Apagar', exact: true }).last().click()
    await pJ.waitForTimeout(1000)
    ok((await apiSite(pJ, 'cliente-eu')).status === 401, 'site: apagar minha conta (LGPD) tira a conta e a sessão')
    ok(!(await dono('admin-clientes', null)).json?.clientes?.some((c) => c.nome === 'Júlia Andrade'), 'site: a conta apagada some do painel')

    // ─── sem o código: a conta volta a ser só do aparelho ──────────────────────────────────────────────────────────
    await pD.goto(`${BASE}/painel/#/clientes`)
    const troca = pD.getByRole('checkbox', { name: /Clientes entram com o código pelo WhatsApp/ })
    // o liga/desliga é desenhado por cima do checkbox: toca no rótulo, como a pessoa faz
    const tocarTroca = () => pD.locator('.ct-codigo label').click()
    ok(await troca.isChecked(), 'clientes: o código pelo WhatsApp começa ligado')
    await tocarTroca()
    await pD.waitForFunction(() => /Desligado/.test(document.querySelector('.ct-codigo')?.textContent ?? ''), null, { timeout: 6000 }).catch(() => {})
    ok((await (await site('recursos')).json()).contas?.codigo === false, 'código desligado no painel: o servidor avisa o site (recursos)')
    const cL = await contexto(390, 844, { site: true })
    const pL = await pagina(cL, 'local')
    await pL.goto(`${BASE}/?uf=mg&aba=estados`)
    await pL.waitForTimeout(2500)
    ok(!/Entrar com teu WhatsApp/.test((await pL.locator('.pe-conta-tua').innerText().catch(() => '')) ?? ''), 'sem o código: o site não oferece entrar pelo WhatsApp (a conta fica no aparelho)')
    await tocarTroca()
    await pD.waitForFunction(() => !/Desligado/.test(document.querySelector('.ct-codigo')?.textContent ?? ''), null, { timeout: 6000 }).catch(() => {})
    ok((await (await site('recursos')).json()).contas?.codigo === true, 'código ligado de novo')

    // ─── 4 tamanhos: rolagem lateral e prints ─────────────────────────────────────────────────────────────────────
    for (const [w, h] of TAMANHOS) {
      const c = await contexto(w, h)
      const p = await pagina(c, `painel ${w}`)
      await entrarPainel(p, 'dono', 'senha-forte-123')
      await p.getByText('Oi, Dono.').waitFor()
      let todas = true
      for (const [rota, nome] of [['#/equipe', 'equipe'], ['#/equipe/bruno.rj', 'usuario'], ['#/clientes', 'clientes'], ['#/atividade?quem=bruno.rj', 'atividade-de']]) {
        await p.goto(`${BASE}/painel/${rota}`)
        await p.waitForTimeout(700)
        if (!(await lateral(p))) {
          todas = false
          ok(false, `${w}×${h} ${rota}: rolagem lateral`)
        }
        await print(p, `contas-${w}-${nome}`, true)
      }
      ok(todas, `${w}×${h}: Equipe, acesso, Clientes e Atividade sem rolagem lateral`)
      await c.close()
      const s = await contexto(w, h, { site: true })
      const q = await pagina(s, `site ${w}`)
      await q.goto(`${BASE}/?uf=mg&aba=estados`)
      const b = q.locator('.pe-conta-tua button, .lateral [data-conta]:visible').first()
      await b.waitFor({ timeout: 10000 })
      await q.waitForTimeout(800)
      await q.locator('.pe-conta-tua button').scrollIntoViewIfNeeded().catch(() => {})
      await q.locator('.pe-conta-tua button').click()
      await q.locator('.conta-entrar').waitFor()
      ok(await lateral(q), `${w}×${h}: entrar no site sem rolagem lateral`)
      await print(q, `contas-${w}-site-entrar`)
      await s.close()
    }
  } catch (e) {
    // o print de onde parou, antes de fechar as páginas
    if (prints) for (const c of ctxs) for (const pg of c.pages()) await pg.screenshot({ path: join(prints, `falha-contas-${Date.now()}.png`) }).catch(() => {})
    throw e
  } finally {
    for (const c of ctxs) await c.close().catch(() => {})
    await new Promise((r) => falso.srv.close(r))
    derrubar()
    rmSync(dados, { recursive: true, force: true })
  }
}

// sozinho: node scripts/testar-painel-contas.mjs <pasta-do-build>
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const build = process.argv[2] ? resolve(process.argv[2]) : null
  if (!build || !existsSync(join(build, 'painel', 'index.html'))) {
    console.error('uso: node scripts/testar-painel-contas.mjs <pasta-do-build> (com painel/index.html)')
    process.exit(1)
  }
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers'
  const { chromium } = await import('playwright')
  const AXE = process.env.GC_AXE ?? (existsSync('/tmp/claude-0/axe/node_modules/axe-core/axe.min.js') ? '/tmp/claude-0/axe/node_modules/axe-core/axe.min.js' : null)
  const PRINTS = process.env.GC_PRINTS ?? null
  let falhas = 0
  let checagens = 0
  const ok = (cond, msg) => {
    checagens++
    if (!cond) falhas++
    console.log(`${cond ? '✓' : '✗'} ${msg}`)
    return cond
  }
  const axe = async (p, nome) => {
    if (!AXE) return
    await p.addScriptTag({ path: AXE })
    const v = await p.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations.map((x) => `${x.id} (${x.nodes.length}: ${x.nodes.map((n) => n.target.join(' ')).join(', ').slice(0, 200)})`))
    ok(v.length === 0, `axe ${nome}: ${v.join(', ') || '0 violações'}`)
  }
  const browser = await chromium.launch()
  const erros = []
  try {
    await fluxoContas({ browser, build, ok, axe, erros, prints: PRINTS })
  } catch (e) {
    ok(false, `exceção: ${e.stack}`)
  } finally {
    await browser.close()
  }
  ok(erros.length === 0, `sem erro de JavaScript na página (${erros.join(' | ') || 'nenhum'})`)
  console.log(falhas ? `${falhas} problema(s) em ${checagens} checagens` : `${checagens} checagens · contas no navegador ok`)
  process.exit(falhas ? 1 : 0)
}
