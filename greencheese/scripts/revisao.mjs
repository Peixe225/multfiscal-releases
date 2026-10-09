// Revisão por screenshots (seção 10 do briefing) + teste do fluxo até o link do WhatsApp da loja (RJ e MG, pedido e
// encomenda), o Pix "em breve", as dúvidas na DM do estado, a navegação em abas (Início | Mercado | Rateio | Por
// estado), as sequências de voltar, os links diretos (?aba=mercado e o velho ?aba=catalogo), o Início (destaques e grade,
// sem o fim da aba Mercado), a rua viva (no celular, só no fim do Início, depois da grade e antes do rodapé, e o 1º
// story é de produto; no computador embaixo do perfil, em escala inteira, na matriz de desktop): no celular ela não
// monta nem baixa na primeira tela; aparece, o rAF dela para em cada pausa (o botão, fora da tela, camada por cima, aba
// escondida), fica parada com movimento reduzido, o mercador chamado oferece o Mercado; o Mercado com o mercador no
// topo; as falas da rua sem palavra proibida;
// as setas da linha de destaques no computador, o atalho antigo home2/, o axe em cada aba e os pontos de referência.
// Conta no servidor (simulada como no API.md): a conta do aparelho espera o número e vai junto no primeiro login;
// Minha conta com pedidos, vagas e endereços da loja.
// Rateio: a aba abre, o cartão com o contador, o "?" abre o como funciona (que rola pelo teclado em 320×568), o
// formulário valida, a confirmação leva pro WhatsApp com a mensagem certa (o botão cabe em 320), sem servidor vira
// "Entrar pelo WhatsApp", a resposta perdida pede pra tentar de novo com o mesmo token (servidor que guarda o token
// devolve a mesma vaga; o que ignora dá ja-participa com o código, sem vaga inventada), servidor fora do ar, lento
// (~4 s) ou com JSON torto mostra "Sem conexão" com "Entrar pelo WhatsApp" e nunca os exemplos, rateio fora da lista com
// o GET falhando não "sai do ar", a vaga do "Entrar com outro WhatsApp" não preenche o formulário nem vira "Tua vaga",
// sem vaga sobrando não tem formulário pra amigo e o sem-vagas com 0 trava o envio, as setas do estado limpam a cidade e
// o selo da lateral usa o 2 redesenhado. A API do rateio é simulada como no contrato do API.md; nas outras rodadas ela
// responde como "sem servidor" (HTML no lugar de JSON, sem erro no console). A loja do servidor (o GET loja simulado,
// mexido como o dono mexe no painel) tem a rodada dela em scripts/revisao-loja.mjs.
// Uso: npm run dev (em outro terminal) e depois: node scripts/revisao.mjs [rodada] [url-base]
// GC_LOJA_REAL=1: o GET loja vai pro servidor de verdade (o resto da API continua simulado).
// IP e CEP são simulados para o resultado ser repetível.
process.env.PLAYWRIGHT_BROWSERS_PATH ??= '/opt/pw-browsers'
const { chromium } = await import(new URL('../node_modules/playwright/index.mjs', import.meta.url).href)
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rodadaLoja } from './revisao-loja.mjs'

const rodada = process.argv[2] ?? 'r1'
const base = process.argv[3] ?? 'http://localhost:5173/'
const dir = new URL(`../revisao/${rodada}/`, import.meta.url).pathname
mkdirSync(dir, { recursive: true })

/** axe-core (não é dependência do projeto): AXE=caminho, ou <tmp>/<pasta>/axe/node_modules/axe-core, ou o node_modules. */
function acharAxe() {
  if (process.env.AXE) return process.env.AXE
  try {
    for (const d of readdirSync(tmpdir())) {
      const c = join(tmpdir(), d, 'axe/node_modules/axe-core/axe.min.js')
      if (existsSync(c)) return c
    }
  } catch {
    /* sem acesso ao tmp */
  }
  const local = new URL('../node_modules/axe-core/axe.min.js', import.meta.url).pathname
  return existsSync(local) ? local : ''
}
const AXE = acharAxe()

const erros = []
const relatorio = []

// O pedido e a encomenda fecham no WhatsApp da loja (config.whatsappPedidos), o mesmo em todos os estados
const ZAP = 'https://wa.me/5533991139036?text='
const dmDo = (uf) => `https://ig.me/m/greencheese_imports${uf}`

// As mensagens do WhatsApp não podem mudar (só a linha "Entrega:", que traz o endereço do CEP simulado)
const REFERENCIA = {
  mg: "PEDIDO GREEN CHEESE — MG / Teófilo Otoni\n1x Jack Daniel's Old No. 7 1 L — R$ 149,90\n3x Seda OCB Premium Slim — R$ 19,99\nSubtotal: R$ 169,89\nEntrega: …\nPagamento: Pix\nNome: Ian Teste\nObs.: Portão azul",
  rj: "PEDIDO GREEN CHEESE — RJ / Rio de Janeiro\n1x Jack Daniel's Old No. 7 1 L — R$ 149,90\n3x Seda OCB Premium Slim — R$ 19,99\nSubtotal: R$ 169,89\nEntrega: …\nPagamento: Pix\nNome: Ian Teste\nObs.: Portão azul",
}
// A linha do código do pedido (GC-XXXXX, nasce no aparelho) vem logo depois do cabeçalho: o resto não muda
const LINHA_CODIGO = /^Código: GC-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/
function conferirMensagem(uf, texto) {
  const linhas = texto.split('\n')
  if (!LINHA_CODIGO.test(linhas[1] ?? '')) erros.push(`[mensagem ${uf}] sem a linha do código (Código: GC-XXXXX) logo depois do cabeçalho: "${linhas[1] ?? ''}"`)
  const semEntrega = linhas.filter((_, i) => i !== 1 || !LINHA_CODIGO.test(linhas[1])).join('\n').replace(/^Entrega: .*$/m, 'Entrega: …')
  if (semEntrega !== REFERENCIA[uf]) erros.push(`[mensagem ${uf}] mudou:\n--- referência\n${REFERENCIA[uf]}\n--- agora\n${semEntrega}`)
  else relatorio.push(`mensagem ${uf}: igual à referência (mais a linha do código)`)
}

async function contexto(browser, viewport, opts = {}) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: viewport.width < 600 ? 3 : 1,
    hasTouch: viewport.width < 600,
    isMobile: viewport.width < 600,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    reducedMotion: opts.reduzir ? 'reduce' : 'no-preference',
  })
  await ctx.route(/ipwho\.is/, (r) => r.fulfill({ json: { success: true, country_code: 'BR', region: opts.ipRegiao ?? 'Minas Gerais', region_code: opts.ipUf ?? 'MG' } }))
  await ctx.route(/geojs\.io/, (r) => r.fulfill({ json: { country_code: 'BR', region: opts.ipRegiao ?? 'Minas Gerais' } }))
  await ctx.route(/brasilapi\.com\.br\/api\/cep/, (r) => {
    const cep = r.request().url().split('/').pop()
    if (cep.startsWith('398')) return r.fulfill({ json: { cep, state: 'MG', city: 'Teófilo Otoni', neighborhood: 'Centro', street: 'Rua Doutor Manoel Esteves' } })
    if (cep.startsWith('2')) return r.fulfill({ json: { cep, state: 'RJ', city: 'Rio de Janeiro', neighborhood: 'Copacabana', street: 'Rua Barata Ribeiro' } })
    if (cep.startsWith('01')) return r.fulfill({ json: { cep, state: 'SP', city: 'São Paulo', neighborhood: 'Sé', street: 'Praça da Sé' } })
    return r.fulfill({ status: 404, json: { message: 'not found' } })
  })
  await ctx.route(/viacep\.com\.br/, (r) => r.fulfill({ json: { erro: true } }))
  if (opts.rateio) await apiRateio(ctx)
  else await ctx.route('**/api/index.php**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>sem servidor</title>' }))
  // GC_LOJA_REAL=1: a loja vem do servidor de verdade (PHP ligado e painel instalado; sem mexer, é a mesma da semente)
  if (process.env.GC_LOJA_REAL) await ctx.route(/\/api\/index\.php\?r=loja(&|$)/, (r) => r.continue())
  if (opts.semDica) await ctx.addInitScript(() => sessionStorage.setItem('gc-dica-hero', '1'))
  return ctx
}

/** API do rateio simulada (o contrato do API.md): lista, rateio avulso, entrar (vaga reservada) e minhas vagas. */
async function apiRateio(ctx) {
  const agora = new Date().toISOString()
  const base = {
    descricao: '',
    imagem: null,
    status: 'aberto',
    aceitaEntradas: true,
    previsaoMin: 6,
    previsaoMax: 10,
    fechaEm: null,
    fechadoEm: null,
    pedidoEm: null,
    chegouEm: null,
    reservaHoras: 24,
    demo: true,
    atualizadoEm: agora,
  }
  const rateios = [
    { ...base, id: 'arizona-green-tea', titulo: 'Arizona Green Tea 680 ml', produtoId: 'arizona-green-tea', precoRateio: 14.9, precoDepois: 19.9, vagas: 24, confirmadas: 14, reservadas: 3, disponiveis: 7, limitePorPessoa: 6, ufs: ['rj', 'mg', 'sp', 'es'] },
    { ...base, id: 'dichavador-metal-4-partes', titulo: 'Dichavador de metal 4 partes 55 mm', produtoId: 'dichavador-metal-4-partes', precoRateio: 44.9, precoDepois: 59.9, vagas: 10, confirmadas: 8, reservadas: 1, disponiveis: 1, limitePorPessoa: 2, ufs: ['mg', 'sp', 'es', 'sc'] },
  ]
  const vagas = []
  const naoAchei = { status: 404, json: { ok: false, erro: 'nao-encontrado', mensagem: 'Não achei.' } }
  await ctx.route('**/api/index.php**', async (route) => {
    const u = new URL(route.request().url())
    const r = u.searchParams.get('r')
    // o servidor de agora também responde o recursos (API.md, "Contas dos clientes"): aqui, sem o código pelo WhatsApp
    if (r === 'recursos') return route.fulfill({ json: { ok: true, contas: { codigo: false, sessao: false } } })
    if (r === 'rateios') return route.fulfill({ json: { ok: true, agora, rateios } })
    if (r === 'rateio') {
      const x = rateios.find((y) => y.id === u.searchParams.get('id'))
      return x ? route.fulfill({ json: { ok: true, rateio: x } }) : route.fulfill(naoAchei)
    }
    if (r === 'minhas-vagas') {
      const tokens = (u.searchParams.get('t') ?? '').split(',')
      return route.fulfill({ json: { ok: true, participacoes: vagas.filter((v) => tokens.includes(v.token)) } })
    }
    if (r === 'rateio-entrar') {
      const c = JSON.parse(route.request().postData() ?? '{}')
      const x = rateios.find((y) => y.id === c.rateio)
      if (!x) return route.fulfill(naoAchei)
      if (c.site) return route.fulfill({ status: 400, json: { ok: false, erro: 'invalido', campo: 'nome', mensagem: 'Confere.' } })
      const v = {
        codigo: 'RAT-K8EA',
        token: '0123456789abcdef0123456789abcdef',
        rateio: x.id,
        titulo: x.titulo,
        quantidade: c.quantidade,
        total: Math.round(c.quantidade * x.precoRateio * 100) / 100,
        status: 'reservado',
        expiraEm: new Date(Date.now() + 864e5).toISOString(),
        criadoEm: agora,
        confirmadoEm: null,
        rateioStatus: 'aberto',
      }
      vagas.push(v)
      x.reservadas += c.quantidade
      x.disponiveis -= c.quantidade
      return route.fulfill({ status: 201, json: { ok: true, participacao: v, rateio: x } })
    }
    // a loja: sem servidor dela aqui, o site segue com a embutida (com GC_LOJA_REAL, a rota de lá vem antes)
    if (r === 'loja') return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>sem servidor</title>' })
    return route.fulfill(naoAchei)
  })
}

function vigiar(page, nome) {
  page.on('console', (m) => {
    if (m.type() === 'error') erros.push(`[${nome}] console: ${m.text()}`)
  })
  page.on('pageerror', (e) => erros.push(`[${nome}] pageerror: ${e.message}`))
}

/** Como o vigiar, mas sem o "Failed to load resource" das falhas de rede que o próprio teste provoca. */
function vigiarSemRede(page, nome) {
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) erros.push(`[${nome}] console: ${m.text()}`)
  })
  page.on('pageerror', (e) => erros.push(`[${nome}] pageerror: ${e.message}`))
}

async function foto(page, nome, cheia = false) {
  await page.waitForTimeout(250)
  // página inteira: o card fora da tela pula a pintura (content-visibility: auto); na foto, todos pintam
  const estilo = cheia ? await page.addStyleTag({ content: '.grade > .card { content-visibility: visible !important }' }) : null
  if (estilo) await page.waitForTimeout(300)
  await page.screenshot({ path: `${dir}${nome}.png`, fullPage: cheia })
  if (estilo) await estilo.evaluate((e) => e.remove())
  relatorio.push(nome)
}

/**
 * O Início acaba na grade (a caixa de encomenda por último) e no rodapé; no celular, a rua viva fica entre os dois
 * (pedido do Ian em 09/10). Destaques com as abas primeiro, o fio e os filtros; sem busca, sem o Teste minha sorte e o
 * repost do fim da aba Catálogo, sem os ids dela.
 */
async function conferirInicio(page, nome) {
  await page.locator('.vista-inicio .catalogo-inicio .grade').waitFor({ state: 'attached', timeout: 6000 }).catch(() => {})
  const r = await page.evaluate(() => {
    const v = document.querySelector('.vista[data-vista="inicio"]')
    const grade = v?.querySelector('.catalogo-inicio .grade')
    const rodape = document.querySelector('.rodape')
    const nav = v?.querySelector('.destaques-inicio nav')
    const fio = v?.querySelector('.destaques-inicio .destaques-fio')
    const filtros = v?.querySelector('.destaques-inicio [role="group"]')
    const rua = v?.querySelector('.rua-fim .rua-vaga')?.getBoundingClientRect()
    return {
      celular: matchMedia('(max-width: 899px)').matches,
      grade: !!grade,
      caixaNoFim: !!grade?.lastElementChild?.classList.contains('card-caixa'),
      rodapeLogo: grade && rodape ? rodape.getBoundingClientRect().top - grade.getBoundingClientRect().bottom : null,
      // a rua do fim (celular): quanto depois da grade ela começa e quanto depois dela o rodapé começa
      rua: rua && grade && rodape ? { depoisDaGrade: rua.top - grade.getBoundingClientRect().bottom, rodape: rodape.getBoundingClientRect().top - rua.bottom } : null,
      destaques: !!(nav && fio && filtros && nav.compareDocumentPosition(fio) & 4 && fio.compareDocumentPosition(filtros) & 4),
      fimCatalogo: !!v?.querySelector('.aba-fim, .reposts, .adesivos-interativos'),
      ids: !!v?.querySelector('#catalogo, #catalogo-titulo'),
      busca: !!v?.querySelector('.busca, .chip-disp'),
    }
  })
  conferir(r.grade && r.caixaNoFim, `${nome}: Início com a grade e a caixa de encomenda por último`)
  if (r.celular) {
    conferir(
      !!r.rua && r.rua.depoisDaGrade >= -1 && r.rua.depoisDaGrade <= 100 && r.rua.rodape >= -1 && r.rua.rodape <= 40,
      `${nome}: a rua no fim do Início, logo depois da grade e logo antes do rodapé (${JSON.stringify(r.rua)})`,
    )
  } else {
    conferir(!r.rua, `${nome}: no computador, nada de rua no fim do Início (ela mora embaixo do perfil)`)
    conferir(r.rodapeLogo != null && r.rodapeLogo >= -1 && r.rodapeLogo <= 120, `${nome}: o rodapé vem logo depois da grade (${r.rodapeLogo == null ? '?' : Math.round(r.rodapeLogo)} px)`)
  }
  conferir(r.destaques, `${nome}: destaques do Início com as abas, o fio e os filtros, nessa ordem`)
  conferir(!r.fimCatalogo && !r.ids && !r.busca, `${nome}: Início sem Teste minha sorte/repost do fim, sem os ids e a busca da aba Catálogo`)
}

async function passarAbertura(page) {
  const tenho = page.getByRole('button', { name: 'Tenho', exact: true })
  await tenho.waitFor({ timeout: 8000 })
  await tenho.click()
  // sem ?uf, o palpite de IP é confirmado no quadro do local da própria abertura ("Você está em …?" [Sim | Trocar])
  const sim = page.locator('.abertura .enquete').getByRole('button', { name: 'Sim', exact: true })
  await Promise.race([
    page.locator('.abertura').waitFor({ state: 'detached', timeout: 8000 }),
    sim.waitFor({ timeout: 8000 }).then(() => sim.click()).catch(() => {}),
  ])
  await page.locator('.abertura').waitFor({ state: 'detached', timeout: 8000 })
  await page.waitForTimeout(400)
}

/** Troca de aba pela barra do celular ou pela lateral do desktop e espera a vista aparecer. */
async function irAba(page, aba) {
  await page.locator(`[data-aba="${aba}"]:visible`).first().click()
  const alvo = aba === 'catalogo' ? '#catalogo, #catalogo-titulo' : aba === 'estados' ? '#estados' : aba === 'rateio' ? '#rateio-titulo' : '.hero, .sem'
  await page.locator(`.vista:not([hidden]) :is(${alvo})`).first().waitFor({ state: 'visible', timeout: 6000 })
  await page.waitForTimeout(300)
}
const abaAberta = (page) => page.evaluate(() => document.querySelector('.vista:not([hidden])')?.dataset.vista ?? null)
function conferir(cond, msg) {
  if (!cond) erros.push(msg)
  else relatorio.push(`ok: ${msg}`)
}
async function voltar(page) {
  await page.goBack({ waitUntil: 'commit' }).catch(() => {})
  await page.waitForTimeout(700)
}

async function clicar(page, nome) {
  await page.getByRole('button', { name: nome, exact: true }).last().click()
  await page.waitForTimeout(250)
}

async function digitar(page, texto) {
  const campo = page.locator('.dm-entrada input')
  await campo.fill(texto)
  await page.locator('.dm-entrada').evaluate((f) => f.requestSubmit())
  await page.waitForTimeout(300)
}

async function fluxoPedido(page, uf, cep, nomeArq) {
  // monta a sacola pela aba Catálogo: Jack com 1; depois a seda OCB com 3 (combo)
  await irAba(page, 'catalogo')
  await page.getByRole('button', { name: /Jack Daniel's.*Abrir story/ }).click()
  await page.waitForTimeout(900)
  await page.getByRole('button', { name: 'Pôr na sacola' }).click()
  await page.waitForTimeout(900)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(700)
  await page.getByRole('button', { name: /Seda OCB Premium Slim.*Abrir story/ }).click()
  await page.waitForTimeout(900)
  const tres = page.getByRole('radio', { name: /3 por/ })
  if (await tres.count()) await tres.click()
  await page.getByRole('button', { name: 'Pôr na sacola' }).click()
  await page.waitForTimeout(900)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(700)
  // sacola (aba da barra no celular, item da lateral no desktop)
  await page.locator('.barra-abas [data-aba="sacola"]:visible, .lateral-item:has-text("Sacola"):visible').first().click()
  await page.waitForTimeout(700)
  await foto(page, `${nomeArq}-sacola`)
  await page.getByRole('button', { name: 'Fazer pedido' }).click()
  await page.waitForTimeout(700)
  // chat
  await clicar(page, 'Isso')
  await clicar(page, 'Tá certo')
  await digitar(page, 'Ian Teste')
  await digitar(page, cep)
  await page.waitForTimeout(500)
  await digitar(page, '120, apto 201')
  await clicar(page, 'Pix')
  await digitar(page, 'Portão azul')
  await page.waitForTimeout(500)
  await foto(page, `${nomeArq}-chat-resumo`)
  const href = await page.getByRole('link', { name: 'Fechar pedido no WhatsApp' }).getAttribute('href')
  conferir(href?.startsWith(ZAP), `${uf}: "Fechar pedido no WhatsApp" abre o WhatsApp da loja (${href?.slice(0, 48)}…)`)
  const texto = decodeURIComponent(href.split('text=')[1] ?? '')
  conferirMensagem(uf, texto)
  // a DM saiu do fechamento: nenhum outro link de saída nas ações do resumo
  conferir((await page.locator('.dm-acoes a').count()) === 1, `${uf}: no resumo, o WhatsApp é o único link (sem "Copiar pedido e abrir a DM")`)
  // dúvida fora do pedido: o começo da conversa aponta pra DM do estado
  const duvida = await page.locator('.dm-duvida').getAttribute('href')
  conferir(duvida === dmDo(uf), `${uf}: "Outra dúvida?" do chat abre a DM do estado (${duvida})`)
  // Pix no site: em breve. Tocar não sai do site, a loja responde e o foco volta pro WhatsApp
  const antes = page.url()
  const abas = page.context().pages().length
  await page.getByRole('button', { name: /Pagar com Pix aqui no site/ }).click()
  await page.waitForTimeout(600)
  const pix = await page.evaluate(() => ({
    bolha: [...document.querySelectorAll('.dm-resposta-pix .dm-loja')].map((e) => e.textContent).join(' '),
    foco: document.activeElement?.textContent?.trim() ?? '',
    realce: !!document.querySelector('.dm-zap.dm-realce'),
  }))
  conferir(/Pix direto no site chega em breve/.test(pix.bolha), `${uf}: Pix em breve responde no chat ("${pix.bolha.slice(0, 60)}…")`)
  conferir(pix.foco === 'Fechar pedido no WhatsApp' && pix.realce, `${uf}: depois do Pix, foco e realce no WhatsApp (${pix.foco})`)
  conferir(page.url() === antes && page.context().pages().length === abas, `${uf}: o Pix em breve não sai do site`)
  await foto(page, `${nomeArq}-chat-pix-em-breve`)
  if (uf === 'mg') await pixComOutroPagamento(page, uf, nomeArq)
  return { uf, href, texto }
}

/** Pix em breve com pagamento no cartão: a loja oferece "Trocar pra Pix"; o WhatsApp só ganha o foco depois da troca. */
async function pixComOutroPagamento(page, uf, nomeArq) {
  const pagamentoNoZap = () =>
    page.locator('.dm-zap').evaluate((a) => decodeURIComponent(a.getAttribute('href').split('text=')[1] ?? '').match(/^Pagamento: .*$/m)?.[0] ?? '')
  await clicar(page, 'Mudar pagamento')
  await clicar(page, 'Cartão na entrega')
  await digitar(page, 'Portão azul')
  await page.waitForTimeout(500)
  conferir((await pagamentoNoZap()) === 'Pagamento: Cartão na entrega', `${uf}: no cartão, o WhatsApp leva "Pagamento: Cartão na entrega"`)
  await page.getByRole('button', { name: /Pagar com Pix aqui no site/ }).click()
  await page.waitForTimeout(700)
  const antes = await page.evaluate(() => ({
    bolha: [...document.querySelectorAll('.dm-resposta-pix .dm-loja')].map((e) => e.textContent).join(' '),
    foco: document.activeElement?.textContent?.trim() ?? '',
    realce: !!document.querySelector('.dm-zap.dm-realce'),
  }))
  conferir(/Troca o pagamento aqui/.test(antes.bolha), `${uf}: Pix em breve no cartão oferece a troca ("${antes.bolha.slice(0, 70)}…")`)
  conferir(antes.foco === 'Trocar pra Pix' && !antes.realce, `${uf}: no cartão, o foco vai pro "Trocar pra Pix", sem realçar o WhatsApp (${antes.foco})`)
  await foto(page, `${nomeArq}-chat-pix-cartao`)
  await clicar(page, 'Trocar pra Pix')
  await page.waitForTimeout(700)
  const depois = await page.evaluate(() => ({
    foco: document.activeElement?.textContent?.trim() ?? '',
    realce: !!document.querySelector('.dm-zap.dm-realce'),
    resumo: document.querySelector('.dm-mensagem')?.textContent ?? '',
  }))
  conferir((await pagamentoNoZap()) === 'Pagamento: Pix' && /Pagamento: Pix/.test(depois.resumo), `${uf}: "Trocar pra Pix" muda o pagamento no resumo e no WhatsApp`)
  conferir(depois.foco === 'Fechar pedido no WhatsApp' && depois.realce, `${uf}: depois da troca, foco e realce no WhatsApp (${depois.foco})`)
  const href = await page.locator('.dm-zap').getAttribute('href')
  conferirMensagem(uf, decodeURIComponent(href.split('text=')[1] ?? ''))
  await foto(page, `${nomeArq}-chat-pix-trocou`)
}

/** Encomenda até o resumo: fecha no mesmo WhatsApp, sem Pix (ainda não tem preço). */
async function fluxoEncomenda(page, uf, nomeArq) {
  await clicar(page, 'Pode')
  await digitar(page, 'Fanta de uva japonesa')
  await clicar(page, '2')
  await clicar(page, 'Pular')
  await digitar(page, 'Ian Teste')
  await page.waitForTimeout(500)
  await foto(page, `${nomeArq}-encomenda-resumo`)
  const href = await page.getByRole('link', { name: 'Fechar encomenda no WhatsApp' }).getAttribute('href')
  const texto = decodeURIComponent(href?.split('text=')[1] ?? '')
  conferir(href?.startsWith(ZAP) && texto.startsWith(`ENCOMENDA GREEN CHEESE — ${uf.toUpperCase()}`), `${uf}: "Fechar encomenda no WhatsApp" abre o WhatsApp da loja com a encomenda`)
  conferir(!(await page.getByRole('button', { name: /Pix/ }).count()), `${uf}: encomenda sem o Pix em breve`)
  // celular estreito: "Fechar no WhatsApp" numa linha só, com o ícone colado no texto
  await page.setViewportSize({ width: 320, height: 568 })
  await page.waitForTimeout(400)
  const zap = page.getByRole('link', { name: 'Fechar no WhatsApp', exact: true })
  // uma linha = 52 px de altura (duas passam de 56)
  const m = await zap
    .evaluate((a) => ({ h: Math.round(a.getBoundingClientRect().height), sw: document.documentElement.scrollWidth }))
    .catch(() => null)
  conferir(m && m.h <= 54 && m.sw <= 320, `${uf}: em 320 px, "Fechar no WhatsApp" numa linha (${JSON.stringify(m)})`)
  await zap.scrollIntoViewIfNeeded().catch(() => {})
  await foto(page, `${nomeArq}-encomenda-320`)
  await page.setViewportSize({ width: 390, height: 844 })
}

/** Nenhum wa.me fora do último passo do pedido: o WhatsApp só aparece no fechamento. */
async function semZapForaDoFechamento(page, nome) {
  const n = await page.evaluate(() => document.querySelectorAll('a[href*="wa.me"]').length)
  conferir(n === 0, `${nome}: nenhum link do WhatsApp fora do fechamento do pedido (${n})`)
}

/** axe em cada aba (0 violações). */
async function axeNasAbas(page, nome) {
  if (!AXE || !existsSync(AXE)) return relatorio.push("axe: axe-core não encontrado (AXE=caminho), pulei")
  await page.addScriptTag({ path: AXE })
  for (const aba of ['inicio', 'catalogo', 'rateio', 'estados']) {
    if ((await abaAberta(page)) !== aba) await irAba(page, aba)
    await page.waitForTimeout(400)
    const v = await page.evaluate(async () => {
      const r = await window.axe.run(document, { resultTypes: ['violations'] })
      return r.violations.map((x) => `${x.id}: ${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`)
    })
    if (v.length) erros.push(`[axe ${nome} ${aba}] ${v.join('; ')}`)
    else relatorio.push(`axe ${nome} ${aba}: 0 violações`)
  }
}

/** Pontos de referência e regiões que o leitor de tela anuncia (árvore de acessibilidade do Chromium). */
async function pontosDeReferencia(page) {
  const cdp = await page.context().newCDPSession(page)
  const { nodes } = await cdp.send('Accessibility.getFullAXTree')
  await cdp.detach()
  return nodes.filter((n) => !n.ignored && /^(region|navigation|main|contentinfo|complementary|banner)$/.test(n.role?.value ?? '')).map((n) => `${n.role.value}:${n.name?.value ?? ''}`)
}

const browser = await chromium.launch()

// ---------- celular 390×844 ----------
{
  const ctx = await contexto(browser, { width: 390, height: 844 })
  const page = await ctx.newPage()
  vigiar(page, 'cel')
  await page.goto(base)
  await page.waitForTimeout(700)
  await foto(page, 'cel-01-abertura-logo')
  await page.getByRole('button', { name: 'Tenho', exact: true }).waitFor({ timeout: 8000 })
  await page.waitForTimeout(900)
  await foto(page, 'cel-02-abertura-18')
  await page.getByRole('button', { name: 'Tenho', exact: true }).click()
  // o palpite de IP (MG) é perguntado no quadro do local da abertura, embaixo do adesivo — não na home
  const simAbertura = page.locator('.abertura .enquete').getByRole('button', { name: 'Sim', exact: true })
  await simAbertura.waitFor({ timeout: 8000 })
  await page.waitForTimeout(500)
  await foto(page, 'cel-03-abertura-adesivo')
  await simAbertura.click()
  await page.locator('.abertura').waitFor({ state: 'detached', timeout: 8000 })
  await page.waitForTimeout(600)
  await foto(page, 'cel-04-hero-palpite-ip')
  await page.waitForTimeout(500)
  await foto(page, 'cel-05-hero-confirmado')
  conferir(
    (await page.locator('.vista-inicio .hero-palco .sq-nome').count()) === 1 && (await page.locator('.vista-inicio .hero .rua, .vista-inicio .hero .rua-vaga, .rua-story').count()) === 0,
    'cel: o 1º story do Início é de produto (a rua fica no fim do Início)',
  )
  await page.evaluate(() => document.querySelector('.vista:not([hidden]) .so-celular .perfil')?.scrollIntoView({ block: 'center' }))
  await page.waitForTimeout(600)
  await foto(page, 'cel-06-perfil')
  await conferirInicio(page, 'cel')
  {
    // o story só com produtos; o perfil logo depois da faixa dos @; a rua viva só no fim do Início (uma vaga, com o
    // título pequeno); mercador de repost, só no topo do Mercado
    const r = await page.evaluate(() => {
      const v = document.querySelector('.vista[data-vista="inicio"]')
      const caixa = (s) => v?.querySelector(s)?.getBoundingClientRect() ?? null
      const faixa = caixa('.faixa')
      const perfil = caixa('.so-celular .perfil')
      return {
        barras: v?.querySelectorAll('.hero-barras .story-barra').length ?? 0,
        vagas: v?.querySelectorAll('.rua-vaga').length ?? 0,
        noFim: v?.querySelectorAll('.rua-fim .rua-vaga').length ?? 0,
        titulo: v?.querySelector('.rua-fim h2')?.textContent?.trim() ?? null,
        colado: faixa && perfil ? Math.round(perfil.top - faixa.bottom) : null,
        repost: v?.querySelectorAll('.repost-figura').length ?? 0,
      }
    })
    conferir(
      r.barras >= 2 && r.vagas === 1 && r.noFim === 1 && !!r.titulo && r.colado != null && r.colado >= 0 && r.colado <= 40 && !r.repost,
      `cel: o story de produtos, o perfil colado na faixa dos @, a rua viva só no fim do Início e sem mercador de repost (${JSON.stringify(r)})`,
    )
  }
  await page.locator('.vista-inicio .so-celular .perfil-loja').click()
  await page.waitForTimeout(1200)
  await foto(page, 'cel-06b-destaques')
  await foto(page, 'cel-16-home-inteira', true)
  await page.evaluate(() => window.scrollTo(0, 0))
  conferir((await pontosDeReferencia(page)).includes('region:Início'), 'cel: a vista do Início é a região "Início"')
  conferir(!/confirmar|importsvv/i.test((await page.locator('.vista-inicio .faixa').textContent()) ?? ''), 'cel: a faixa dos @ só com os perfis confirmados')
  await irAba(page, 'catalogo')
  const refs = await pontosDeReferencia(page)
  conferir(!refs.includes('region:Início') && refs.includes('region:Mercado'), `cel: na aba Mercado, nenhuma região "Início" vazia para o leitor de tela (${refs.join(', ')})`)
  await foto(page, 'cel-07-catalogo')
  await page.evaluate(() => window.scrollBy(0, 900))
  await page.waitForTimeout(800)
  await foto(page, 'cel-08-catalogo-indisponivel')
  await page.getByRole('button', { name: /Piteira de vidro RAW.*Abrir story/ }).click().catch(() => {})
  await page.waitForTimeout(1200)
  await foto(page, 'cel-09-story-indisponivel')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(700)
  await page.getByRole('button', { name: /Gin Tanqueray.*Abrir story/ }).click()
  await page.waitForTimeout(1300)
  await foto(page, 'cel-10-story-produto')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(700)
  conferir((await abaAberta(page)) === 'catalogo', 'cel: fechar o story continua no Catálogo')
  // "Avisar quando chegar" vai pra DM do Instagram do estado (não pro WhatsApp da loja)
  const avisar = await page.locator('.vista:not([hidden]) .card-avisar').first().getAttribute('href')
  conferir(avisar === dmDo('mg'), `cel: "Avisar quando chegar" abre a DM do estado (${avisar})`)
  await semZapForaDoFechamento(page, 'cel catálogo')
  // destaque do estado: o último quadro é o das dúvidas, com a DM do estado
  // (o rótulo embaixo da bolinha é curto, "T. OTONI"; o nome inteiro fica no aria-label)
  await page.locator('.vista:not([hidden]) .destaque[aria-label^="TEÓFILO OTONI"]').first().click()
  await page.waitForTimeout(900)
  for (let k = 0; k < 5; k++) {
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(250)
  }
  await page.waitForTimeout(400)
  await foto(page, 'cel-10b-destaque-duvidas')
  const dmInfo = await page.locator('.story a', { hasText: 'Chamar na DM' }).getAttribute('href').catch(() => null)
  conferir(dmInfo === dmDo('mg'), `cel: quadro "Dúvidas" do destaque do estado abre a DM (${dmInfo})`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(700)
  const mg = await fluxoPedido(page, 'mg', '39800001', 'cel-11-mg')
  relatorio.push({ mg })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  await irAba(page, 'estados')
  await page.waitForTimeout(1300)
  await foto(page, 'cel-12-por-estado')
  await semZapForaDoFechamento(page, 'cel por estado')
  await irAba(page, 'inicio')
  await semZapForaDoFechamento(page, 'cel início')
  // rodapé: a dúvida vai pra DM do estado; perfil a confirmar fora da lista pública
  const rodapeDm = await page.locator('.rodape .rodape-dm').getAttribute('href').catch(() => null)
  conferir(rodapeDm === dmDo('mg'), `cel: rodapé "Outra dúvida? Chama a @… na DM" abre a DM do estado (${rodapeDm})`)
  const perfis = await page.locator('.rodape .rodape-perfis a').allTextContents()
  conferir(perfis.length === 5 && perfis.every((t) => /^@greencheese_imports(rj|mg|sp|es|sc)$/.test(t.trim())), `cel: rodapé lista só os 5 perfis dos estados (${perfis.join(', ')})`)
  await axeNasAbas(page, 'cel')
  await ctx.close()
}

// ---------- RJ pelo link da bio ----------
{
  const ctx = await contexto(browser, { width: 390, height: 844 })
  const page = await ctx.newPage()
  vigiar(page, 'rj')
  await page.goto(`${base}?uf=rj`)
  await passarAbertura(page)
  await foto(page, 'cel-13-rj-hero')
  // OCB e Jack no RJ
  const rj = await fluxoPedido(page, 'rj', '22041001', 'cel-14-rj')
  relatorio.push({ rj })
  await ctx.close()
}

// ---------- encomenda (MG): fecha no mesmo WhatsApp, sem Pix ----------
{
  const ctx = await contexto(browser, { width: 390, height: 844 })
  const page = await ctx.newPage()
  vigiar(page, 'encomenda')
  await page.goto(`${base}?uf=mg&chat=encomenda`)
  await passarAbertura(page)
  await page.locator('[aria-modal="true"][aria-label="Pedido guiado"]').waitFor({ timeout: 8000 })
  await page.waitForTimeout(700)
  await fluxoEncomenda(page, 'mg', 'cel-14b-mg')
  await ctx.close()
}

// ---------- pedido no servidor (API.md, "Pedidos"): a cópia que sai no toque do WhatsApp (sem segurar o link), a
// mensagem exata com o código, a fila no aparelho até o servidor confirmar, o código novo quando o pedido muda depois
// de mandar (com o de antes no "substitui"), as falas que o dono trocou no painel e o tabaco recusado na encomenda ----
{
  const ctx = await contexto(browser, { width: 390, height: 844 })
  const recebidos = []
  let falas = 0
  await ctx.route('**/api/index.php?r=pedido*', async (route) => {
    const req = route.request()
    const r = new URL(req.url()).searchParams.get('r')
    if (r === 'pedido-textos') {
      falas++
      const versao = '"t-revisao"'
      return route.fulfill({ status: 200, headers: { ETag: versao }, json: { ok: true, versao, textos: { 'nome.pergunta': 'Como a loja te chama?', 'obs.pergunta': 'Algum recado pra entrega, {nome}?' } } })
    }
    if (r === 'pedido' && req.method() === 'POST') {
      let c = null
      try {
        c = JSON.parse(req.postData() ?? '')
      } catch {
        c = null
      }
      recebidos.push({ c, via: req.resourceType() })
      return route.fulfill({ status: 201, json: { ok: true, pedido: { codigo: c?.codigo, tipo: c?.tipo, status: 'novo', criadoEm: new Date().toISOString() } } })
    }
    return route.fallback()
  })
  // o toque no WhatsApp fica no site (o envio sai do mesmo jeito; aqui não tem WhatsApp pra abrir)
  await ctx.addInitScript(() => {
    document.addEventListener('click', (e) => {
      if (e.target instanceof Element && e.target.closest('a[href*="wa.me"]')) e.preventDefault()
    }, true)
  })
  const page = await ctx.newPage()
  vigiar(page, 'pedido-servidor')
  await page.goto(`${base}?uf=mg`)
  await passarAbertura(page)
  await fluxoPedido(page, 'mg', '39800001', 'cel-17-servidor')
  const bolhas = (await page.locator('.dm-loja').allTextContents()).join(' | ')
  conferir(falas > 0 && bolhas.includes('Como a loja te chama?') && bolhas.includes('Algum recado pra entrega, Ian?'), `pedido: o chat usa as falas que o dono trocou no painel, com o {nome} no primeiro nome (GET pedido-textos ${falas}×)`)
  const zap = page.getByRole('link', { name: 'Fechar pedido no WhatsApp' })
  const texto1 = decodeURIComponent((await zap.getAttribute('href')).split('text=')[1] ?? '')
  const cod1 = texto1.split('\n')[1]?.replace('Código: ', '')
  await zap.click()
  for (let k = 0; k < 40 && !recebidos.length; k++) await page.waitForTimeout(100)
  const a = recebidos[0]?.c
  const seda = a?.itens?.find((i) => i.qtd === 3)
  conferir(
    !!a && a.codigo === cod1 && a.mensagem === texto1 && a.tipo === 'pedido' && a.uf === 'mg' && a.nome === 'Ian Teste' && a.itens?.length === 2 && seda?.combo === '3 por R$ 19,99' && a.subtotal === 169.89 && a.pagamento === 'pix' && a.obs === 'Portão azul' && (a.entrega?.cep ?? '').replace(/\D/g, '') === '39800001' && a.site === '' && a.substitui === null && /^[0-9a-f]{32}$/.test(a.token ?? ''),
    `pedido: o toque no WhatsApp manda o pedido pro servidor — código, itens com o combo, subtotal, entrega, pagamento e a mensagem exata (${recebidos[0]?.via ?? 'nada chegou'})`,
  )
  const pendentes = () => page.evaluate(() => JSON.parse(localStorage.getItem('gc-pedidos') ?? '[]').length)
  const naFila = await pendentes()
  // a volta pro site (a aba à vista de novo) manda de novo o que o servidor ainda não confirmou; o mesmo código e token
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  for (let k = 0; k < 60 && ((await pendentes()) > 0 || recebidos.length < 2); k++) await page.waitForTimeout(100)
  const b = recebidos[1]?.c
  conferir(naFila === (recebidos[0]?.via === 'ping' ? 1 : 0) && (await pendentes()) === 0 && b?.codigo === a?.codigo && b?.token === a?.token, `pedido: a cópia fica no aparelho até o servidor confirmar e vai de novo com o mesmo código e token (${naFila} na fila, depois ${await pendentes()})`)
  // mudou depois de mandar: código novo na mensagem, e o novo diz qual substitui
  await clicar(page, 'Não consegui')
  await clicar(page, 'Mudar obs.')
  await digitar(page, 'Portão verde')
  await page.waitForTimeout(500)
  const texto2 = decodeURIComponent((await zap.getAttribute('href')).split('text=')[1] ?? '')
  const cod2 = texto2.split('\n')[1]?.replace('Código: ', '')
  conferir(LINHA_CODIGO.test(texto2.split('\n')[1] ?? '') && cod2 !== cod1 && /^Obs\.: Portão verde$/m.test(texto2), `pedido: mudou depois de mandar → código novo na mensagem (${cod1} → ${cod2})`)
  // como se o envio do de antes tivesse falhado: a cópia dele ainda esperando na fila do aparelho
  await page.evaluate((corpo) => localStorage.setItem('gc-pedidos', JSON.stringify([{ corpo, criado: Date.now(), tentativas: 1, proxima: 0 }])), a)
  const n = recebidos.length
  await zap.click()
  for (let k = 0; k < 40 && recebidos.length === n; k++) await page.waitForTimeout(100)
  const c = recebidos[n]?.c
  conferir(c?.codigo === cod2 && c?.mensagem === texto2 && c?.substitui?.codigo === cod1 && c?.substitui?.token === a?.token && c?.token !== a?.token, `pedido: o novo vai com o de antes no "substitui" (${c?.substitui?.codigo ?? '?'} → ${c?.codigo ?? '?'})`)
  // o mudado tira da fila a cópia do de antes: ela não vai mais sozinha (chegaria depois do novo e viraria outro pedido)
  const filaDepois = await page.evaluate(() => JSON.parse(localStorage.getItem('gc-pedidos') ?? '[]').map((p) => p.corpo.codigo))
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await page.waitForTimeout(1500)
  const foiDeNovo = recebidos.slice(n + 1).filter((x) => x.c?.codigo === cod1).length
  conferir(!filaDepois.includes(cod1) && foiDeNovo === 0, `pedido: o mudado tira da fila a cópia do de antes que não tinha chegado (fila: ${filaDepois.join(', ') || 'vazia'}; o de antes foi de novo ${foiDeNovo}×)`)
  await foto(page, 'cel-17-servidor-trocou')
  await ctx.close()
  // encomenda: tabaco e vape recusados no chat, com a fala da Anvisa (aparelho novo: neste, o toque no WhatsApp faz a
  // próxima visita reabrir o pedido, a volta do WhatsApp)
  const ctx2 = await contexto(browser, { width: 390, height: 844 })
  const pg = await ctx2.newPage()
  vigiar(pg, 'encomenda-tabaco')
  await pg.goto(`${base}?uf=mg&chat=encomenda`)
  await passarAbertura(pg)
  await pg.locator('[aria-modal="true"][aria-label="Pedido guiado"]').waitFor({ timeout: 8000 })
  await pg.waitForTimeout(700)
  await clicar(pg, 'Pode')
  await digitar(pg, 'Cigarro de palha')
  const recusa = (await pg.locator('.dm-erro').allTextContents()).join(' ')
  conferir(/a Anvisa não deixa vender pela internet/.test(recusa), `encomenda: tabaco recusado no chat (${recusa.trim() || 'sem aviso'})`)
  await foto(pg, 'cel-17-servidor-encomenda-tabaco')
  await ctx2.close()
}

// ---------- troco: o chat guarda em centavos e no teto do servidor (o que o chat aceita, o servidor aceita igual) ----------
{
  const ctx = await contexto(browser, { width: 390, height: 844 })
  const recebidos = []
  await ctx.route('**/api/index.php?r=pedido', async (route) => {
    const req = route.request()
    if (req.method() !== 'POST') return route.fallback()
    let c = null
    try {
      c = JSON.parse(req.postData() ?? '')
    } catch {
      c = null
    }
    recebidos.push(c)
    return route.fulfill({ status: 201, json: { ok: true, pedido: { codigo: c?.codigo, tipo: c?.tipo, status: 'novo', criadoEm: new Date().toISOString() } } })
  })
  await ctx.addInitScript(() => {
    document.addEventListener('click', (e) => {
      if (e.target instanceof Element && e.target.closest('a[href*="wa.me"]')) e.preventDefault()
    }, true)
  })
  const page = await ctx.newPage()
  vigiar(page, 'troco')
  await page.goto(`${base}?uf=mg`)
  await passarAbertura(page)
  await irAba(page, 'catalogo')
  await page.getByRole('button', { name: /Jack Daniel's.*Abrir story/ }).click()
  await page.waitForTimeout(900)
  await page.getByRole('button', { name: 'Pôr na sacola' }).click()
  await page.waitForTimeout(900)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(700)
  await page.locator('.barra-abas [data-aba="sacola"]:visible, .lateral-item:has-text("Sacola"):visible').first().click()
  await page.waitForTimeout(700)
  await page.getByRole('button', { name: 'Fazer pedido' }).click()
  await page.waitForTimeout(700)
  await clicar(page, 'Isso')
  await clicar(page, 'Tá certo')
  await digitar(page, 'Ian Teste')
  await digitar(page, '39800001')
  await page.waitForTimeout(500)
  await digitar(page, '120')
  await clicar(page, 'Dinheiro')
  await digitar(page, '250.000')
  const acima = (await page.locator('.dm-erro').allTextContents()).join(' ')
  conferir(/Só o valor/.test(acima), `troco: acima do teto do servidor (R$ 250.000) o chat não aceita (${acima.trim() || 'aceitou'})`)
  await digitar(page, '50,555')
  await digitar(page, 'Portão azul')
  await page.waitForTimeout(500)
  const zap = page.getByRole('link', { name: 'Fechar pedido no WhatsApp' })
  const texto = decodeURIComponent((await zap.getAttribute('href')).split('text=')[1] ?? '')
  await zap.click()
  for (let k = 0; k < 40 && !recebidos.length; k++) await page.waitForTimeout(100)
  conferir(/^Pagamento: Dinheiro \(troco pra R\$\s50,56\)$/m.test(texto) && recebidos[0]?.troco === 50.56 && recebidos[0]?.pagamento === 'dinheiro', `troco: "50,555" vira R$ 50,56 na mensagem e na cópia do pedido (${recebidos[0]?.troco ?? 'nada chegou'})`)
  await foto(page, 'cel-17-troco')
  await ctx.close()
}

// ---------- estado sem atendimento ----------
{
  const ctx = await contexto(browser, { width: 390, height: 844 })
  const page = await ctx.newPage()
  vigiar(page, 'ba')
  await page.goto(`${base}?uf=ba`)
  await passarAbertura(page)
  await foto(page, 'cel-15-sem-atendimento')
  conferir((await page.locator('.barra-abas a, .barra-abas button').count()) === 4, 'ba: 4 abas (sem a Sorte)')
  await irAba(page, 'catalogo')
  await foto(page, 'cel-15b-sem-atendimento-catalogo')
  conferir((await page.locator('.sem-entrega').count()) === 1, 'ba: Catálogo mostra "Esse estado ainda não tem entrega."')
  await ctx.close()
}

// ---------- voltar entre abas e camadas, links diretos ----------
{
  const nova = async (url, nome) => {
    const ctx = await contexto(browser, { width: 390, height: 844 })
    const page = await ctx.newPage()
    vigiar(page, nome)
    await page.goto('about:blank')
    await page.goto(url)
    await passarAbertura(page)
    return { ctx, page }
  }
  {
    const { ctx, page } = await nova(`${base}?uf=mg`, 'voltar-1')
    await irAba(page, 'catalogo')
    await page.getByRole('button', { name: /Seda OCB Premium Slim.*Abrir story/ }).click()
    await page.waitForTimeout(1000)
    await voltar(page)
    conferir(!(await page.locator('.story').count()) && (await abaAberta(page)) === 'catalogo', 'voltar: fecha o story e fica no Catálogo')
    await voltar(page)
    conferir((await abaAberta(page)) === 'inicio', 'voltar: Catálogo → Início')
    await voltar(page)
    conferir(page.url() === 'about:blank', 'voltar: do Início sai do site')
    await ctx.close()
  }
  {
    const { ctx, page } = await nova(`${base}?uf=mg`, 'voltar-2')
    await irAba(page, 'catalogo')
    await irAba(page, 'estados')
    await page.evaluate(() => {
      const bt = [...document.querySelectorAll('.vista[data-vista="estados"] button')].find((e) => /Rio de Janeiro|\bRJ\b/.test(e.getAttribute('aria-label') || e.textContent || ''))
      bt?.click()
    })
    await page.waitForTimeout(900)
    conferir((await abaAberta(page)) === 'inicio', 'voltar: escolher RJ em Por estado leva ao Início')
    await voltar(page)
    conferir((await abaAberta(page)) === 'estados' && page.url().includes('uf=rj'), 'voltar: Início → Por estado (já em RJ)')
    await voltar(page)
    conferir((await abaAberta(page)) === 'catalogo', 'voltar: Por estado → Catálogo')
    await ctx.close()
  }
  {
    // trocar de estado com uma camada aberta (o chat continua) na aba Por estado: a ida ao Início espera o chat fechar
    // (a entrada da aba nunca entra por cima da entrada do chat). Pelo X e pelo voltar.
    for (const modo of ['x', 'voltar']) {
      const { ctx, page } = await nova(`${base}?uf=mg`, `estado-com-chat-${modo}`)
      await irAba(page, 'estados')
      // abre o pedido guiado pela aba (o botão de pedido do estado atual, "Pedir aqui" hoje)
      const bt = page.locator('.vista:not([hidden]) button', { hasText: /Pedir aqui|Pedir em MG|Fazer pedido/ }).first()
      if (await bt.count()) await bt.click()
      await page.waitForTimeout(900)
      const chatAberto = await page.locator('[aria-modal="true"][aria-label="Pedido guiado"]').count()
      if (!chatAberto) {
        relatorio.push(`aviso: estado-com-chat-${modo}: a aba Por estado não tem botão de pedido; caso pulado`)
        await ctx.close()
        continue
      }
      await page.getByRole('button', { name: 'Trocar estado' }).last().click()
      await page.waitForTimeout(900)
      await page.locator('[aria-modal="true"][aria-label^="Escolher estado"]').getByRole('button', { name: /Rio de Janeiro/ }).first().click()
      await page.waitForTimeout(1200)
      const st = await page.evaluate(() => history.state)
      conferir((await abaAberta(page)) === 'estados' && st?.gc === 'chat', `estado com chat (${modo}): o chat continua por cima de Por estado, sem entrada de aba por cima dele`)
      if (modo === 'x') {
        await page.locator('[aria-modal="true"][aria-label="Pedido guiado"] button[aria-label^="Fechar"]').first().click()
        await page.waitForTimeout(1200)
      } else await voltar(page)
      conferir((await abaAberta(page)) === 'inicio' && page.url().includes('uf=rj'), `estado com chat (${modo}): fechar o chat leva ao Início (RJ)`)
      await voltar(page)
      conferir((await abaAberta(page)) === 'estados' && !(await page.locator('.folha').count()), `estado com chat (${modo}): voltar cai em Por estado, sem reabrir o chat`)
      await ctx.close()
    }
  }
  {
    const { ctx, page } = await nova(`${base}?uf=mg&aba=inicio`, 'link-inicio')
    conferir((await abaAberta(page)) === 'inicio' && !page.url().includes('aba='), 'link: ?aba=inicio abre o Início e sai da URL')
    await ctx.close()
  }
  {
    const { ctx, page } = await nova(`${base}?uf=mg&aba=catalogo`, 'link-catalogo')
    conferir((await abaAberta(page)) === 'catalogo', 'link: ?aba=catalogo (link velho) abre o Mercado')
    await voltar(page)
    conferir(page.url() === 'about:blank', 'link: ?aba=catalogo, voltar sai do site')
    await ctx.close()
  }
  {
    const { ctx, page } = await nova(`${base}?uf=mg&aba=mercado`, 'link-mercado')
    conferir((await abaAberta(page)) === 'catalogo' && (await page.locator('.vista:not([hidden]) h1').first().textContent())?.trim() === 'Mercado', 'link: ?aba=mercado abre o Mercado')
    await irAba(page, 'inicio')
    await irAba(page, 'catalogo')
    conferir(new URL(page.url()).searchParams.get('aba') === 'mercado', `link: a aba Mercado escreve ?aba=mercado (${page.url()})`)
    await ctx.close()
  }
  {
    const { ctx, page } = await nova(`${base}?uf=mg&aba=estados`, 'link-estados')
    conferir((await abaAberta(page)) === 'estados', 'link: ?aba=estados abre Por estado')
    await ctx.close()
  }
  {
    const { ctx, page } = await nova(`${base}?uf=mg&aba=catalogo&produto=jack-daniels-old-no7-1l`, 'link-produto')
    await page.waitForTimeout(900)
    await foto(page, 'cel-18-link-produto-catalogo')
    await voltar(page)
    conferir((await abaAberta(page)) === 'catalogo' && !page.url().includes('produto='), 'link: ?aba=catalogo&produto=, voltar fecha no Catálogo')
    await ctx.close()
  }
  {
    const { ctx, page } = await nova(`${base}?uf=mg`, 'voltar-sacola')
    await irAba(page, 'catalogo')
    await page.locator('.barra-abas [data-aba="sacola"]').click()
    await page.waitForTimeout(700)
    await page.getByRole('button', { name: 'Fazer pedido' }).click().catch(() => {})
    await page.waitForTimeout(800)
    for (let k = 0; k < 3 && (await page.locator('.folha').count()); k++) await voltar(page)
    conferir(!(await page.locator('.folha').count()) && (await abaAberta(page)) === 'catalogo', 'voltar: sacola → pedido, uma camada por vez, fica no Catálogo')
    await ctx.close()
  }
}

// ---------- links velhos da Home 2: home2/ (Home2/ e HOME2/ sobem pelo publicar.mjs), ?home=2, ?Home2 ----------
// abrem a home de sempre, com o resto do link e sem as chaves home*
{
  for (const pasta of ['home2']) {
    const r = await fetch(new URL(`${pasta}/index.html`, base)).catch(() => null)
    const html = r?.ok ? await r.text() : ''
    // script só de arquivo (a CSP bloqueia script em linha) e o meta refresh para quem está sem JavaScript
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    conferir(
      scripts.length === 1 && /src="[^"]*ir\.js"/.test(scripts[0][1]) && !scripts[0][2].trim() && /<noscript><meta http-equiv="refresh"[^>]*url=\.\.\/"/.test(html),
      `${pasta}/index.html: script de arquivo + meta refresh de reserva para ../`,
    )
  }
  const ctx = await contexto(browser, { width: 390, height: 844 })
  const page = await ctx.newPage()
  vigiar(page, 'atalho-h2')
  for (const [entrada, espera] of [
    ['home2/?uf=rj&aba=catalogo', { uf: 'rj', aba: 'catalogo' }],
    ['home2/', {}],
    ['?Home2&uf=rj', { uf: 'rj' }],
    ['?HOME=2', {}],
    ['?home=1&uf=mg', { uf: 'mg' }],
  ]) {
    await page.goto(new URL(entrada, base).href)
    await page.locator('.app').waitFor({ state: 'attached', timeout: 15000 })
    await page.waitForTimeout(300)
    const r = await page.evaluate(() => ({
      home: document.querySelector('.app')?.getAttribute('data-home'),
      pasta: location.pathname,
      q: Object.fromEntries(new URLSearchParams(location.search)),
    }))
    const ok =
      r.home == null &&
      !/home2/i.test(r.pasta) &&
      Object.entries(espera).every(([k, v]) => r.q[k] === v) &&
      !Object.keys(r.q).some((k) => /^home/i.test(k))
    conferir(ok, `link velho ${entrada}: home de sempre${Object.keys(espera).length ? ', ' + Object.keys(espera).join('/') + ' mantidos' : ''}, sem home* na URL (${JSON.stringify(r)})`)
  }
  await ctx.close()
}

// ---------- navegador do Instagram apertado (360×560) ----------
{
  const ctx = await contexto(browser, { width: 360, height: 560 })
  const page = await ctx.newPage()
  vigiar(page, 'ig')
  await page.goto(`${base}?uf=mg`)
  await passarAbertura(page)
  await foto(page, 'ig-01-hero')
  await irAba(page, 'catalogo')
  await page.getByRole('button', { name: /Seda OCB Premium Slim.*Abrir story/ }).click()
  await page.waitForTimeout(1300)
  await foto(page, 'ig-02-story-combo')
  await ctx.close()
}

// ---------- desktop 1440×900 ----------
{
  const ctx = await contexto(browser, { width: 1440, height: 900 })
  const page = await ctx.newPage()
  vigiar(page, 'desk')
  await page.goto(base)
  await page.waitForTimeout(700)
  await foto(page, 'desk-01-abertura')
  await passarAbertura(page)
  await foto(page, 'desk-02-hero-palpite')
  await irAba(page, 'catalogo')
  await page.waitForTimeout(900)
  await foto(page, 'desk-03-catalogo')
  await page.getByRole('button', { name: /Jack Daniel's.*Abrir story/ }).click()
  await page.waitForTimeout(1300)
  await foto(page, 'desk-04-story')
  await page.getByRole('button', { name: 'Pôr na sacola' }).click()
  await page.waitForTimeout(900)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(700)
  await page.locator('.lateral-item:has-text("Sacola")').click()
  await page.waitForTimeout(700)
  await foto(page, 'desk-05-sacola')
  await page.getByRole('button', { name: 'Fazer pedido' }).click()
  await page.waitForTimeout(800)
  await foto(page, 'desk-06-chat')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  await irAba(page, 'estados')
  await page.waitForTimeout(1300)
  await foto(page, 'desk-07-por-estado')
  await axeNasAbas(page, 'desk')
  await page.goto(`${base}?uf=ba`)
  await page.waitForTimeout(1500)
  await foto(page, 'desk-08-sem-atendimento')
  await ctx.close()
}

// ---------- lateral: Buscar e Catálogo ativos; foco ao voltar ao Início ----------
{
  const ctx = await contexto(browser, { width: 1440, height: 900 })
  const page = await ctx.newPage()
  vigiar(page, 'lateral-ativo')
  await page.goto(`${base}?uf=mg`)
  await passarAbertura(page)
  const ativo = () => page.evaluate(() => [...document.querySelectorAll('.lateral [aria-current="page"]')].map((e) => e.textContent.trim()))
  await page.locator('.lateral [data-aba="buscar"]').click()
  await page.waitForTimeout(900)
  await page.keyboard.type('jack')
  await page.waitForTimeout(300)
  conferir(JSON.stringify(await ativo()) === '["Buscar"]', 'lateral: Buscar ativo com a busca em uso')
  await page.locator('.lateral [data-aba="catalogo"]').click()
  await page.waitForTimeout(700)
  conferir(JSON.stringify(await ativo()) === '["Mercado"]', 'lateral: tocar em Mercado depois de buscar deixa Mercado ativo')
  // Início pelo teclado: o foco vai para o título do perfil e o Tab seguinte cai nos botões dele (a rua vem depois)
  await page.locator('.lateral [data-aba="inicio"]').focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(900)
  await page.keyboard.press('Tab')
  const foco = await page.evaluate(() => {
    const a = document.activeElement
    return { perfil: !!a?.closest('.hero-loja .perfil'), rua: !!a?.closest('.rua'), txt: (a?.textContent ?? '').trim().slice(0, 30) }
  })
  conferir(foco.perfil && !foco.rua, `Início pelo teclado: o Tab cai no perfil antes da rua (${foco.txt})`)
  // Mercado pelo teclado: o foco cai no título "Mercado" (o mercador do topo vem depois dele no DOM) e o Tab seguinte, no
  // mercador
  await page.locator('.lateral [data-aba="catalogo"]').focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(900)
  const focoMercado = await page.evaluate(() => ({ id: document.activeElement?.id, txt: (document.activeElement?.textContent ?? '').trim().slice(0, 30) }))
  await page.keyboard.press('Tab')
  const depoisMercado = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
  conferir(focoMercado.id === 'catalogo-titulo' && focoMercado.txt === 'Mercado' && depoisMercado === 'Mercador: abrir o casaco', `Mercado pelo teclado: o foco no título e o Tab seguinte no mercador (${JSON.stringify(focoMercado)} → ${depoisMercado})`)
  await page.locator('.lateral [data-aba="inicio"]').click()
  await page.waitForTimeout(900)
  // Ver loja (computador): desce até os destaques do Início e o foco vai junto
  await page.locator('.hero-loja .perfil-loja').click()
  await page.waitForTimeout(1500)
  const loja = await page.evaluate(() => ({ topo: Math.round(document.querySelector('.vista-inicio .destaques-inicio').getBoundingClientRect().top), foco: document.activeElement?.id }))
  conferir(loja.topo >= 0 && loja.topo <= 80 && loja.foco === 'inicio-loja-titulo', `Ver loja (computador): destaques no alto (${loja.topo} px) e foco na loja (${loja.foco})`)
  await foto(page, 'desk-09-ver-loja')
  await ctx.close()
}

// ---------- notebook baixo com a enquete de local: a lateral rola até Por estado ----------
for (const [w, h] of [[1280, 650], [1366, 657]]) {
  const ctx = await contexto(browser, { width: w, height: h })
  const page = await ctx.newPage()
  vigiar(page, `lateral-baixa-${w}`)
  await page.goto(base)
  await passarAbertura(page)
  const l = await page.evaluate(() => {
    const e = document.querySelector('.lateral')
    return { rola: e.scrollHeight > e.clientHeight, ov: getComputedStyle(e).overflowY, prevent: e.hasAttribute('data-lenis-prevent') }
  })
  conferir(!l.rola || (l.ov === 'auto' && l.prevent), `lateral ${w}x${h}: passa da tela e rola (overflow ${l.ov}, roda do mouse na lateral)`)
  await page.mouse.move(110, h - 80)
  for (let k = 0; k < 6; k++) {
    await page.mouse.wheel(0, 120)
    await page.waitForTimeout(60)
  }
  await page.waitForTimeout(700)
  const fim = await page.evaluate(() => {
    const b = (s) => document.querySelector(s)?.getBoundingClientRect().bottom ?? 0
    return { estados: b('.lateral [data-aba="estados"]'), previa: b('.lateral-previa'), h: innerHeight }
  })
  conferir(fim.estados <= fim.h + 1 && fim.previa <= fim.h + 1, `lateral ${w}x${h}: rolando a lateral, Por estado aparece`)
  await foto(page, `desk-lateral-baixa-${w}x${h}`)
  await ctx.close()
}

// ---------- axe no celular estreito e no computador largo (mercador em 5× ao lado do perfil) ----------
for (const vp of [{ width: 320, height: 568 }, { width: 1920, height: 1080 }]) {
  const ctx = await contexto(browser, vp)
  const page = await ctx.newPage()
  vigiar(page, `axe-${vp.width}`)
  await page.goto(`${base}?uf=mg`)
  await passarAbertura(page)
  await axeNasAbas(page, `${vp.width < 900 ? 'cel' : 'desk'} ${vp.width}`)
  await ctx.close()
}

// ---------- matriz de desktop: Início com a rua viva embaixo do perfil (+ Mercado e Por estado) ----------
// altura cheia da tela e a área útil de verdade (menos a barra do navegador): 1366×657, 1280×650, 1536×730, 1440×790.
// De 1200 em diante, [perfil e rua | story]; de 900 a 1199 o hero empilha (story em cima, perfil e rua embaixo). A rua
// sempre à vista no computador, em escala inteira, sem cobrir o perfil, o story, as setas nem a lateral
const TAMANHOS = [
  [900, 800],
  [1024, 768],
  [1100, 800],
  [1200, 900],
  [1200, 650],
  [1240, 800],
  [1240, 700],
  [1280, 720],
  [1280, 800],
  [1280, 650],
  [1280, 1024],
  [1300, 1000],
  [1366, 768],
  [1366, 657],
  [1440, 900],
  [1440, 790],
  [1440, 720],
  [1536, 864],
  [1536, 730],
  [1920, 1080],
  [1920, 720],
]
for (const [w, h] of TAMANHOS) {
  const nome = `desk-${w}x${h}`
  const ctx = await contexto(browser, { width: w, height: h })
  const page = await ctx.newPage()
  vigiar(page, nome)
  await page.goto(`${base}?uf=mg`)
  await page.getByRole('button', { name: 'Tenho', exact: true }).click()
  await page.locator('.abertura').waitFor({ state: 'detached', timeout: 8000 })
  // a rua monta no respiro depois da abertura (abaixo de 1200 ela fica embaixo do story: rola até ela)
  await page.locator('.hero-loja .rua[data-rua]').waitFor({ timeout: 10000 }).catch(() => {})
  const foraDaTela = await page.evaluate(() => {
    const e = document.querySelector('.hero-loja .rua-vaga')
    return !!e && e.getBoundingClientRect().bottom > innerHeight
  })
  if (foraDaTela) await page.evaluate(() => document.querySelector('.hero-loja .rua-vaga').scrollIntoView({ block: 'center' }))
  for (let k = 0; k < 60 && (await page.locator('.hero-loja .rua').getAttribute('data-rua').catch(() => null)) !== 'rodando'; k++) await page.waitForTimeout(100)
  const ruaEstado = await page.locator('.hero-loja .rua').getAttribute('data-rua').catch(() => null)
  if (foraDaTela) await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(500)
  const c = await page.evaluate(() => {
    const r = (s) => {
      const e = document.querySelector(s)
      const b = e?.getBoundingClientRect()
      return b && b.width ? { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height } : null
    }
    const textos = [...document.querySelectorAll('.hero-desktop-perfil *')].filter((e) => !e.children.length && e.getClientRects().length && e.textContent.trim())
    const tela = document.querySelector('.hero-loja .rua-tela')
    return {
      rua: r('.hero-loja .rua-vaga'),
      ruaPx: tela ? tela.getBoundingClientRect().height / tela.height : null,
      perfil: r('.hero-desktop-perfil .perfil'),
      story: r('.hero-quadro'),
      hero: r('.vista-inicio .hero'),
      setaE: r('.hero-seta-esq'),
      setaD: r('.hero-seta-dir'),
      lateral: r('.lateral'),
      textoPerfil: textos.length ? Math.min(...textos.map((e) => e.getBoundingClientRect().left)) : null,
      sorteNoHero: /Teste minha sorte|Tá com sorte|Todo giro ganha/i.test(document.querySelector('.vista-inicio .hero')?.textContent ?? ''),
      empilhado: !!document.querySelector('.vista-inicio .hero.hero-empilhado'),
      storyAntes: (() => {
        const st = document.querySelector('.vista-inicio .hero-story')
        const lj = document.querySelector('.vista-inicio .hero-loja')
        return !!(st && lj && st.compareDocumentPosition(lj) & 4)
      })(),
      alto: innerHeight,
      larg: document.documentElement.scrollWidth > innerWidth,
    }
  })
  const cruza = (a, b) => a && b && a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1
  const nomes = ['rua', 'perfil', 'story', 'setaE', 'setaD', 'lateral']
  for (let i = 0; i < nomes.length; i++) for (let j = i + 1; j < nomes.length; j++) if (cruza(c[nomes[i]], c[nomes[j]])) erros.push(`[${nome}] ${nomes[i]} por cima de ${nomes[j]}`)
  // o story nunca encolhe por causa da rua: 330 px ou mais, a não ser que a altura da janela (16:9) não deixe
  const minimo = Math.min(330, Math.floor(((h - 120) * 9) / 16) - 2)
  conferir(!!c.story && c.story.w >= minimo, `${nome}: story com ${c.story ? Math.round(c.story.w) : 0} px (>= ${minimo})`)
  conferir(!c.larg, `${nome}: sem rolagem lateral`)
  if (c.lateral && c.textoPerfil != null) conferir(c.textoPerfil >= c.lateral.r - 1, `${nome}: texto do perfil fora da lateral (${Math.round(c.textoPerfil)} >= ${Math.round(c.lateral.r)})`)
  conferir(!c.sorteNoHero, `${nome}: nada do Teste minha sorte no topo do Início`)
  conferir(!!c.rua && ruaEstado === 'rodando', `${nome}: a rua viva no Início do computador, andando à vista (${ruaEstado})`)
  if (c.rua) {
    conferir(c.ruaPx != null && Math.abs(c.ruaPx - Math.round(c.ruaPx)) < 0.01 && c.ruaPx >= 2 && c.ruaPx <= 5, `${nome}: rua em escala inteira de 2× a 5× (${c.ruaPx})`)
    conferir(!!c.perfil && c.rua.t >= c.perfil.b - 1, `${nome}: a rua embaixo do perfil (${Math.round(c.rua.t)} / ${c.perfil ? Math.round(c.perfil.b) : '?'})`)
  }
  // arranjo por largura: de 900 a 1199 empilhado (story em cima); de 1200 em diante, perfil e rua ao lado do story
  if (w < 1200) conferir(c.empilhado && c.storyAntes, `${nome}: story em cima, perfil e rua embaixo`)
  else {
    conferir(!c.empilhado && !c.storyAntes, `${nome}: perfil e rua ao lado do story`)
    // lado a lado, a rua não empurra nada: o story inteiro (até o VER PRODUTO) e a rua inteira (a calçada, o pé do
    // mercador e a moto no asfalto) na primeira tela, e o hero com a altura de antes da rua (janela até 900), então os
    // destaques e o catálogo ficam onde ficavam
    conferir(!foraDaTela && !!c.rua && c.rua.b <= c.alto + 1, `${nome}: a rua inteira na primeira tela (${c.rua ? Math.round(c.rua.b) : '?'} <= ${c.alto})`)
    conferir(!!c.story && c.story.b <= c.alto + 1, `${nome}: o story inteiro na primeira tela (${c.story ? Math.round(c.story.b) : '?'} <= ${c.alto})`)
    conferir(!!c.hero && c.hero.h <= Math.min(c.alto, 900) + 1, `${nome}: o hero não cresce com a rua (${c.hero ? Math.round(c.hero.h) : '?'} <= ${Math.min(c.alto, 900)})`)
  }
  await conferirInicio(page, nome)
  await foto(page, nome, true)
  await irAba(page, 'catalogo')
  await foto(page, `${nome}-catalogo`, true)
  await irAba(page, 'estados')
  await foto(page, `${nome}-estados`, true)
  await ctx.close()
}

// ---------- destaques do Início no computador: setas nas pontas quando a linha não cabe; Shift + roda anda de lado ----
for (const [w, h] of [[1024, 768], [1440, 900]]) {
  const ctx = await contexto(browser, { width: w, height: h })
  const page = await ctx.newPage()
  vigiar(page, `setas-${w}`)
  await page.goto(`${base}?uf=mg`)
  await passarAbertura(page)
  await page.locator('.vista-inicio .catalogo-inicio .grade').waitFor({ state: 'attached', timeout: 6000 }).catch(() => {})
  const topo = await page.evaluate(() => document.querySelector('.vista-inicio .destaques-moldura').getBoundingClientRect().top + scrollY)
  await page.mouse.move(w / 2, 300)
  await page.mouse.wheel(0, topo - 200)
  await page.waitForTimeout(1500)
  const linha = () =>
    page.evaluate(() => {
      const d = document.querySelector('.vista-inicio .destaques-inicio')
      const m = d.parentElement
      return { sl: Math.round(d.scrollLeft), sobra: d.scrollWidth - d.clientWidth, esq: !!m.querySelector('.destaques-seta-esq'), dir: !!m.querySelector('.destaques-seta-dir') }
    })
  const a = await linha()
  if (a.sobra > 0) {
    conferir(a.dir && !a.esq, `setas ${w}: a linha não cabe (${a.sobra} px) e só a seta da direita aparece`)
    await foto(page, `desk-11-destaques-setas-${w}`)
    await page.locator('.destaques-seta-dir').click()
    await page.waitForTimeout(900)
    const b = await linha()
    conferir(b.sl >= b.sobra - 1 && b.esq && !b.dir, `setas ${w}: a seta leva ao fim da linha (${b.sl}/${b.sobra}) e troca de lado`)
    await page.locator('.destaques-seta-esq').click()
    await page.waitForTimeout(900)
    const box = await page.locator('.vista-inicio .destaques-inicio').boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + 40)
    const y0 = await page.evaluate(() => scrollY)
    await page.keyboard.down('Shift')
    await page.mouse.wheel(0, 200)
    await page.keyboard.up('Shift')
    await page.waitForTimeout(700)
    const c = await linha()
    const y1 = await page.evaluate(() => scrollY)
    conferir(c.sl > 0 && Math.abs(y1 - y0) < 2, `setas ${w}: Shift + roda anda a linha de lado (${c.sl} px) sem descer a página`)
  } else conferir(!a.esq && !a.dir, `setas ${w}: a linha cabe inteira e fica sem setas`)
  await ctx.close()
}

// ---------- Mercado: o mercador no topo (o dono da banca), o mouse abre o casaco na hora; movimento reduzido, parado ----
for (const reduzir of [false, true]) {
  const ctx = await contexto(browser, { width: 1440, height: 900 }, { reduzir })
  const page = await ctx.newPage()
  vigiar(page, `mercado-topo${reduzir ? '-reduzido' : ''}`)
  await page.goto(`${base}?uf=mg&aba=mercado`)
  await passarAbertura(page)
  const fig = page.locator('.vista:not([hidden]) .mercado-topo .mercado-dono')
  await fig.waitFor({ timeout: 5000 })
  const m = await page.evaluate(() => {
    const v = document.querySelector('.vista[data-vista="catalogo"]')
    const topo = v?.querySelector('.mercado-topo')
    const busca = v?.querySelector('.busca')
    return {
      antesDaBusca: !!topo && !!busca && topo.getBoundingClientRect().bottom <= busca.getBoundingClientRect().top + 1,
      mercadores: v?.querySelectorAll('.repost-figura').length ?? 0,
      fala: v?.querySelector('.mercado-fala')?.textContent?.trim(),
      titulo: v?.querySelector('h1')?.textContent?.trim(),
    }
  })
  conferir(m.antesDaBusca && m.mercadores === 1 && m.fala === 'Chega mais.' && m.titulo === 'Mercado', `Mercado: o mercador no topo, uma vez só, recebendo ("Chega mais.") (${JSON.stringify(m)})`)
  // espera a parte parada (nenhuma camada da apresentação à vista) e passa o mouse
  const visivel = (s) => page.evaluate((s) => [...document.querySelectorAll(`.mercado-dono ${s}`)].some((e) => getComputedStyle(e).visibility === 'visible' && getComputedStyle(e).display !== 'none'), s)
  for (let k = 0; k < 150 && (await visivel('.repost-quadro')); k++) await page.waitForTimeout(100)
  await page.mouse.move(5, 5)
  await fig.hover()
  await page.waitForTimeout(300)
  const abriu = await visivel('.q-aberto, .q-meio')
  if (reduzir) conferir(!abriu, 'Mercado com movimento reduzido: o mercador fica parado (o mouse não anima)')
  else conferir(abriu, 'Mercado: o mouse em cima do mercador abre o casaco na hora')
  await fig.click()
  conferir((await page.locator('.mercado-fala').textContent())?.trim() !== 'Chega mais.', 'Mercado: tocar no mercador muda a fala')
  await foto(page, `desk-10-mercado-topo${reduzir ? '-reduzido' : ''}`)
  await ctx.close()
}

// ---------- rateio: aba, cartão, "?", formulário, confirmação, WhatsApp; sem servidor ----------
{
  const ctx = await contexto(browser, { width: 390, height: 844 }, { rateio: true })
  const page = await ctx.newPage()
  vigiar(page, 'rateio')
  await page.goto(`${base}?uf=mg`)
  await passarAbertura(page)
  await irAba(page, 'rateio')
  await page.locator('.vista[data-vista="rateio"] .rt').first().waitFor({ timeout: 8000 }).catch(() => {})
  const aba = await page.evaluate(() => ({
    foco: document.activeElement?.id,
    url: location.search,
    cartoes: document.querySelectorAll('.vista[data-vista="rateio"] .rt').length,
    contador: document.querySelector('[data-rateio="arizona-green-tea"] .rt-contador-num')?.textContent,
    reservadas: document.querySelector('[data-rateio="arizona-green-tea"] .rt-contador-res')?.textContent,
    pagos: document.querySelectorAll('[data-rateio="arizona-green-tea"] .rt-blocos .rt-pago').length,
    selo: document.querySelector('.barra-abas [data-aba="rateio"]')?.getAttribute('aria-label'),
  }))
  conferir(aba.foco === 'rateio-titulo' && aba.url.includes('aba=rateio'), `rateio: a aba abre pela barra e o foco vai pro título (${aba.foco})`)
  conferir(aba.cartoes === 2 && aba.contador === '14/24' && aba.reservadas === '+3 reservadas' && aba.pagos === 14, `rateio: cartão com o contador "14/24" e "+3 reservadas" (${JSON.stringify(aba)})`)
  conferir(aba.selo === 'Rateio: 2 abertos', `rateio: selo da barra com os abertos (${aba.selo})`)
  await foto(page, 'rateio-01-aba')
  await page.getByRole('button', { name: 'Como funciona o rateio' }).first().click()
  await page.waitForTimeout(700)
  const como = (await page.locator('.folha[aria-label="Como funciona o rateio"]').textContent().catch(() => '')) ?? ''
  conferir(/pedido do rateio é feito depois que fecham as vagas/.test(como) && /de 6 a 10 dias/.test(como), 'rateio: o "?" abre o como funciona (pedido depois que fecham as vagas, de 6 a 10 dias)')
  await foto(page, 'rateio-02-como-funciona')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(600)
  await page.locator('[data-rateio="arizona-green-tea"] .rt-entrar').click()
  await page.waitForTimeout(900)
  conferir(page.url().includes('rateio=arizona-green-tea') && (await page.evaluate(() => document.activeElement?.id)) === 'rp-titulo', 'rateio: a página abre com link próprio e o foco no título')
  await page.locator('.rp-reservar').click()
  await page.waitForTimeout(300)
  const erros1 = await page.locator('.rp-form .form-erro').count()
  conferir(erros1 >= 2 && (await page.evaluate(() => document.activeElement?.getAttribute('autocomplete'))) === 'name', `rateio: o formulário valida (${erros1} erros, foco no nome)`)
  await page.getByLabel('Teu nome').fill('Ian Teste')
  await page.getByLabel('Teu WhatsApp').fill('33991234567')
  await page.getByRole('button', { name: 'Mais uma vaga' }).click()
  await foto(page, 'rateio-03-formulario')
  await page.locator('.rp-reservar').click()
  await page.waitForTimeout(1200)
  const cf = await page.evaluate(() => ({
    titulo: document.activeElement?.textContent,
    vivo: document.querySelector('.rp-feito [role="status"]')?.textContent ?? '',
    href: document.querySelector('.rp-feito .rp-zap')?.getAttribute('href') ?? '',
  }))
  const msg = decodeURIComponent(cf.href.split('text=')[1] ?? '')
  const esperada = ['RATEIO GREEN CHEESE — MG / Teófilo Otoni', 'Arizona Green Tea 680 ml — 2 vagas × R$ 14,90 = R$ 29,80', 'Código: RAT-K8EA', 'Nome: Ian Teste', 'WhatsApp: (33) 99123-4567', 'Quero confirmar minha vaga e pagar.'].join('\n')
  conferir(cf.titulo === 'Tá no rateio!' && /Código RAT-K8EA/.test(cf.vivo), 'rateio: confirmação "Tá no rateio!" com o código, anunciada pro leitor de tela')
  conferir(cf.href.startsWith(ZAP) && msg === esperada, `rateio: "Fechar pagamento no WhatsApp" com a mensagem pronta (${msg.split('\n').join(' | ')})`)
  await foto(page, 'rateio-04-confirmacao')
  await page.getByRole('button', { name: /Pagar com Pix aqui no site/ }).click()
  await page.waitForTimeout(600)
  conferir(
    await page.evaluate(() => !!document.activeElement?.classList.contains('rp-zap') && /chega em breve/.test(document.querySelector('.rp-pix-resposta')?.textContent ?? '')),
    'rateio: Pix em breve explica e devolve o foco pro WhatsApp',
  )
  await voltar(page)
  const mv = (await page.locator('#minhas-vagas').textContent().catch(() => '')) ?? ''
  conferir(!(await page.locator('.rp').count()) && /RAT-K8EA/.test(mv) && /Esperando pagamento/.test(mv), 'rateio: voltar fecha a página e "Minhas vagas" mostra a reserva')
  await foto(page, 'rateio-05-minhas-vagas')
  await axeNasAbas(page, 'rateio')
  await ctx.close()
}
{
  // sem servidor (o contexto padrão responde HTML): exemplos com o contador em 0 e "Entrar pelo WhatsApp", sem código
  const ctx = await contexto(browser, { width: 390, height: 844 })
  const page = await ctx.newPage()
  vigiar(page, 'rateio-sem-servidor')
  await page.goto(`${base}?uf=mg&aba=rateio&rateio=arizona-green-tea`)
  await passarAbertura(page)
  await page.locator('.rp .rp-form').waitFor({ timeout: 8000 }).catch(() => {})
  await page.getByLabel('Teu nome').fill('Ian Teste')
  await page.getByLabel('Teu WhatsApp').fill('33991234567')
  const r = await page.evaluate(() => ({
    contador: document.querySelector('.rp .rt-contador-num')?.textContent,
    reservar: !!document.querySelector('.rp-reservar'),
    href: document.querySelector('.rp-form .rp-zap')?.getAttribute('href') ?? '',
    alerta: !!document.querySelector('.rp [role="alert"]'),
  }))
  const msg = decodeURIComponent(r.href.split('text=')[1] ?? '')
  conferir(
    r.contador === '0/24' && !r.reservar && !r.alerta && r.href.startsWith(ZAP) && msg.endsWith('\nQuero entrar no rateio.') && !msg.includes('Código:'),
    `rateio sem servidor: exemplo com 0/24 e "Entrar pelo WhatsApp" sem código (${msg.split('\n').join(' | ')})`,
  )
  await foto(page, 'rateio-06-sem-servidor')
  await ctx.close()
}
{
  // a resposta do POST se perde depois de o servidor gravar: nada de WhatsApp sem código de cara, "Tentar de novo" com o
  // mesmo token; na nova tentativa a vaga sai
  const ctx = await contexto(browser, { width: 390, height: 844 }, { rateio: true })
  let perder = true
  const tokens = []
  await ctx.route('**/api/index.php?r=rateio-entrar', async (route) => {
    tokens.push(JSON.parse(route.request().postData() ?? '{}').token)
    if (!perder) return route.fallback()
    await route.abort('connectionreset')
  })
  const page = await ctx.newPage()
  vigiarSemRede(page, 'rateio-resposta-perdida')
  await page.goto(`${base}?uf=mg&aba=rateio&rateio=arizona-green-tea`)
  await passarAbertura(page)
  await page.locator('.rp .rp-form').waitFor({ timeout: 8000 }).catch(() => {})
  await page.getByLabel('Teu nome').fill('Ian Teste')
  await page.getByLabel('Teu WhatsApp').fill('33991234567')
  await page.locator('.rp-reservar').click()
  await page.waitForTimeout(1200)
  const r1 = await page.evaluate(() => ({
    alerta: document.querySelector('.rp-alerta')?.textContent ?? '',
    botao: document.querySelector('.rp-reservar')?.textContent,
    zap: !!document.querySelector('.rp-envio .rp-zap'),
    foco: !!document.activeElement?.closest('.rp-alerta'),
  }))
  conferir(/pode ter ficado guardada/.test(r1.alerta) && r1.botao === 'Tentar de novo' && !r1.zap && r1.foco, `rateio: resposta perdida pede pra tentar de novo, sem WhatsApp sem código (${JSON.stringify(r1)})`)
  await foto(page, 'rateio-07-resposta-perdida')
  perder = false
  await page.locator('.rp-reservar').click()
  await page.waitForTimeout(1200)
  const titulo = await page.evaluate(() => document.querySelector('.rp-feito-titulo')?.textContent)
  conferir(titulo === 'Tá no rateio!' && tokens.length === 2 && /^[0-9a-f]{32}$/.test(tokens[0] ?? '') && tokens[0] === tokens[1], `rateio: a nova tentativa vai com o mesmo token e reserva (${titulo}, ${tokens.map((t) => t?.slice(0, 6)).join(' = ')})`)
  await ctx.close()
}
{
  // servidor que existe e não responde (5xx da hospedagem): "Sem conexão", nunca os exemplos no lugar dos de verdade
  const ctx = await contexto(browser, { width: 390, height: 844 })
  await ctx.route('**/api/index.php**', (r) => r.fulfill({ status: 502, contentType: 'text/html', body: 'Bad gateway' }))
  const page = await ctx.newPage()
  vigiarSemRede(page, 'rateio-fora-do-ar')
  await page.goto(`${base}?uf=mg&aba=rateio`)
  await passarAbertura(page)
  await page.locator('.rv-sem-conexao, .vista[data-vista="rateio"] .rt').first().waitFor({ timeout: 8000 }).catch(() => {})
  const r = await page.evaluate(() => ({
    aviso: document.querySelector('.rv-sem-conexao h2')?.textContent,
    cartoes: document.querySelectorAll('.vista[data-vista="rateio"] .rt').length,
    zap: decodeURIComponent(document.querySelector('.rv-sem-conexao a.rv-sem-zap')?.getAttribute('href')?.split('text=')[1] ?? ''),
    href: document.querySelector('.rv-sem-conexao a.rv-sem-zap')?.getAttribute('href') ?? '',
  }))
  conferir(r.aviso === 'Sem conexão com a loja agora' && r.cartoes === 0, `rateio: servidor fora do ar mostra "Sem conexão", sem exemplos (${JSON.stringify({ aviso: r.aviso, cartoes: r.cartoes })})`)
  conferir(r.href.startsWith(ZAP) && r.zap === 'RATEIO GREEN CHEESE — MG / Teófilo Otoni\nQuero entrar num rateio. Quais estão abertos?', `rateio: fora do ar, "Entrar pelo WhatsApp" pro WhatsApp da loja (${r.zap.split('\n').join(' | ')})`)
  await foto(page, 'rateio-08-fora-do-ar')
  await ctx.close()
}
{
  // servidor lento (a lista leva 7 s): o aviso com o WhatsApp aparece por volta dos 4 s e a lista entra no lugar dele
  const ctx = await contexto(browser, { width: 390, height: 844 }, { rateio: true })
  await ctx.route('**/api/index.php?r=rateios', async (route) => {
    await new Promise((ok) => setTimeout(ok, 7000))
    return route.fallback()
  })
  const page = await ctx.newPage()
  vigiarSemRede(page, 'rateio-lento')
  await page.goto(`${base}?uf=mg&aba=rateio`)
  const t0 = Date.now()
  await passarAbertura(page)
  const aviso = await page.locator('.rv-sem-conexao a.rv-sem-zap').waitFor({ timeout: 6500 }).then(() => Date.now() - t0).catch(() => null)
  await foto(page, 'rateio-09-lento')
  await page.locator('.vista[data-vista="rateio"] .rt').first().waitFor({ timeout: 12000 }).catch(() => {})
  const depois = await page.evaluate(() => ({ cartoes: document.querySelectorAll('.vista[data-vista="rateio"] .rt').length, aviso: !!document.querySelector('.rv-sem-conexao') }))
  conferir(aviso != null && depois.cartoes === 2 && !depois.aviso, `rateio: lista lenta mostra o aviso com o WhatsApp (${aviso} ms) e depois os rateios no lugar (${JSON.stringify(depois)})`)
  await ctx.close()
}
{
  // a resposta se perde DEPOIS de o servidor gravar. Servidor que segue o token do aparelho (acréscimo compatível do
  // API.md): a nova tentativa, com o mesmo token, devolve a MESMA participação (200) e sai o "Tá no rateio!" com o mesmo
  // código; o servidor fica com uma participação só e a vaga aparece em Minhas vagas
  const ctx = await contexto(browser, { width: 390, height: 844 }, { rateio: true })
  const gravadas = []
  await ctx.route('**/api/index.php?r=rateio-entrar', async (route) => {
    const c = JSON.parse(route.request().postData() ?? '{}')
    const mesma = gravadas.find((v) => v.token === c.token && v.rateio === c.rateio)
    if (mesma) return route.fulfill({ status: 200, json: { ok: true, participacao: mesma, rateio: null } })
    gravadas.push({ codigo: 'RAT-T0KN', token: c.token, rateio: c.rateio, titulo: 'Arizona Green Tea 680 ml', quantidade: c.quantidade, total: Math.round(c.quantidade * 1490) / 100, status: 'reservado', expiraEm: new Date(Date.now() + 864e5).toISOString(), criadoEm: new Date().toISOString(), confirmadoEm: null, rateioStatus: 'aberto' })
    // gravou e a resposta não chegou
    return route.abort('connectionreset')
  })
  const page = await ctx.newPage()
  vigiarSemRede(page, 'rateio-perdida-token')
  await page.goto(`${base}?uf=mg&aba=rateio&rateio=arizona-green-tea`)
  await passarAbertura(page)
  await page.locator('.rp .rp-form').waitFor({ timeout: 8000 }).catch(() => {})
  await page.getByLabel('Teu nome').fill('Ian Teste')
  await page.getByLabel('Teu WhatsApp').fill('33991234567')
  await page.locator('.rp-reservar').click()
  await page.locator('.rp-alerta').waitFor({ timeout: 8000 }).catch(() => {})
  await page.locator('.rp-reservar').click()
  await page.locator('.rp-feito').waitFor({ timeout: 8000 }).catch(() => {})
  const cf = await page.evaluate(() => ({ titulo: document.querySelector('.rp-feito-titulo')?.textContent, codigo: document.querySelector('.rp-codigo-valor')?.textContent }))
  await foto(page, 'rateio-10-perdida-token')
  await voltar(page)
  const mv = (await page.locator('#minhas-vagas').textContent().catch(() => '')) ?? ''
  conferir(cf.titulo === 'Tá no rateio!' && cf.codigo === 'RAT-T0KN' && gravadas.length === 1 && /RAT-T0KN/.test(mv) && /Esperando pagamento/.test(mv), `rateio: resposta perdida + servidor que guarda o token → a mesma vaga na 2ª tentativa, uma participação só, em Minhas vagas (${JSON.stringify({ ...cf, gravadas: gravadas.length })})`)
  await ctx.close()
}
{
  // o mesmo, com um servidor que ignora o token (gera o dele): a nova tentativa recebe ja-participa com o código. A tela
  // mostra o código e "Falar com a loja" (só o código, sem conta de vagas), não guarda vaga com quantidade inventada, e
  // a lista recarrega (o contador conta a vaga)
  const ctx = await contexto(browser, { width: 390, height: 844 }, { rateio: true })
  let vez = 0
  let listas = 0
  await ctx.route('**/api/index.php?r=rateios', (route) => {
    listas++
    return route.fallback()
  })
  await ctx.route('**/api/index.php?r=rateio-entrar', async (route) => {
    vez++
    if (vez === 1) return route.abort('connectionreset')
    return route.fulfill({ status: 409, json: { ok: false, erro: 'ja-participa', mensagem: 'Esse WhatsApp já está nesse rateio.', codigo: 'RAT-MURN' } })
  })
  const page = await ctx.newPage()
  vigiarSemRede(page, 'rateio-perdida-sem-token')
  await page.goto(`${base}?uf=mg&aba=rateio&rateio=arizona-green-tea`)
  await passarAbertura(page)
  await page.locator('.rp .rp-form').waitFor({ timeout: 8000 }).catch(() => {})
  await page.getByLabel('Teu nome').fill('Ian Teste')
  await page.getByLabel('Teu WhatsApp').fill('33991234567')
  await page.locator('.rp-reservar').click()
  await page.locator('.rp-alerta').waitFor({ timeout: 8000 }).catch(() => {})
  const antes = listas
  await page.locator('.rp-reservar').click()
  await page.waitForTimeout(1500)
  const r = await page.evaluate(() => ({
    alerta: document.querySelector('.rp-alerta p')?.textContent ?? '',
    msg: decodeURIComponent(document.querySelector('.rp-alerta a[href*="wa.me"]')?.getAttribute('href')?.split('text=')[1] ?? ''),
    feito: !!document.querySelector('.rp-feito'),
    guardada: (JSON.parse(localStorage.getItem('gc-rateio') || '{}').state?.vagas ?? []).some((v) => v.codigo === 'RAT-MURN'),
  }))
  const esperada = ['RATEIO GREEN CHEESE — MG / Teófilo Otoni', 'Arizona Green Tea 680 ml', 'Código: RAT-MURN', 'Nome: Ian Teste', 'WhatsApp: (33) 99123-4567', 'Já tenho vaga nesse rateio. Quero conferir e pagar.'].join('\n')
  conferir(
    /Tua vaga ficou guardada \(código RAT-MURN\)/.test(r.alerta) && r.msg === esperada && !r.feito && !r.guardada && listas > antes,
    `rateio: resposta perdida + servidor que ignora o token → o código com "Falar com a loja" (só o código), nada inventado, lista recarregada (${JSON.stringify({ ...r, msg: r.msg.split('\n').join(' | '), listas: listas - antes })})`,
  )
  await foto(page, 'rateio-11-perdida-sem-token')
  await ctx.close()
}
{
  // "Entrar com outro WhatsApp" (pra um amigo): a vaga dele não preenche o formulário do próximo rateio nem vira "Tua vaga"
  const ctx = await contexto(browser, { width: 390, height: 844 }, { rateio: true })
  let n = 0
  await ctx.route('**/api/index.php?r=rateio-entrar', async (route) => {
    const c = JSON.parse(route.request().postData() ?? '{}')
    n++
    const v = { codigo: n === 1 ? 'RAT-D0N0' : 'RAT-AM1G', token: (n === 1 ? 'a' : 'b').repeat(32), rateio: c.rateio, titulo: 'Arizona Green Tea 680 ml', quantidade: c.quantidade, total: 14.9 * c.quantidade, status: 'reservado', expiraEm: new Date(Date.now() + 864e5).toISOString(), criadoEm: new Date().toISOString(), confirmadoEm: null, rateioStatus: 'aberto' }
    return route.fulfill({ status: 201, json: { ok: true, participacao: v, rateio: null } })
  })
  const page = await ctx.newPage()
  vigiar(page, 'rateio-amigo')
  await page.goto(`${base}?uf=mg&aba=rateio&rateio=arizona-green-tea`)
  await passarAbertura(page)
  await page.locator('.rp .rp-form').waitFor({ timeout: 8000 }).catch(() => {})
  await page.getByLabel('Teu nome').fill('Ian Dono')
  await page.getByLabel('Teu WhatsApp').fill('33991110000')
  await page.locator('.rp-reservar').click()
  await page.locator('.rp-feito').waitFor({ timeout: 8000 }).catch(() => {})
  await voltar(page)
  await page.locator('[data-rateio="arizona-green-tea"] .rt-entrar').click()
  await page.getByRole('button', { name: 'Entrar com outro WhatsApp' }).click()
  await page.getByLabel('Teu nome').fill('Amigo Fulano')
  await page.getByLabel('Teu WhatsApp').fill('33992220000')
  await page.locator('.rp-reservar').click()
  await page.locator('.rp-feito').waitFor({ timeout: 8000 }).catch(() => {})
  await voltar(page)
  await page.locator('[data-rateio="dichavador-metal-4-partes"] .rt-entrar').click()
  await page.locator('.rp .rp-form').waitFor({ timeout: 8000 }).catch(() => {})
  const pre = await page.evaluate(() => ({ nome: document.querySelector('.rp-form input[autocomplete="name"]')?.value, zap: document.querySelector('.rp-form input[type="tel"]')?.value }))
  await voltar(page)
  await page.locator('[data-rateio="arizona-green-tea"] .rt-entrar').click()
  await page.locator('.rp-tua').waitFor({ timeout: 8000 }).catch(() => {})
  const tua = (await page.locator('.rp-tua-linha').textContent().catch(() => '')) ?? ''
  conferir(pre.nome === 'Ian Dono' && pre.zap === '(33) 99111-0000' && /RAT-D0N0/.test(tua), `rateio: a vaga do amigo não preenche o próximo formulário nem vira "Tua vaga" (${JSON.stringify(pre)} | ${tua})`)
  await ctx.close()
}

{
  // sem vaga sobrando (o dichavador tinha 1 e eu peguei): o cartão segue com "Tu tá nesse rateio" e a página não oferece
  // "Entrar com outro WhatsApp"; e o sem-vagas com 0 trava o envio com "Vagas tomadas" (nunca "Só sobrou 1 vaga")
  const ctx = await contexto(browser, { width: 390, height: 844 }, { rateio: true })
  const page = await ctx.newPage()
  vigiarSemRede(page, 'rateio-lotado')
  await page.goto(`${base}?uf=mg&aba=rateio&rateio=dichavador-metal-4-partes`)
  await passarAbertura(page)
  await page.locator('.rp .rp-form').waitFor({ timeout: 8000 }).catch(() => {})
  await page.getByLabel('Teu nome').fill('Ian Dono')
  await page.getByLabel('Teu WhatsApp').fill('33991110000')
  await page.locator('.rp-reservar').click()
  await page.locator('.rp-feito').waitFor({ timeout: 8000 }).catch(() => {})
  await voltar(page)
  const cartao = (await page.locator('[data-rateio="dichavador-metal-4-partes"] .rt-adesivos').textContent().catch(() => '')) ?? ''
  await page.locator('[data-rateio="dichavador-metal-4-partes"] .rt-entrar').click().catch(() => {})
  await page.locator('.rp-tua').waitFor({ timeout: 8000 }).catch(() => {})
  const outro = await page.getByRole('button', { name: 'Entrar com outro WhatsApp' }).count()
  conferir(/Tu tá nesse rateio/.test(cartao) && /RAT-K8EA/.test(cartao) && outro === 0, `rateio: sem vaga sobrando, o cartão segue com "Tu tá nesse rateio" e a página fica sem "Entrar com outro WhatsApp" (${cartao.replace(/\s+/g, ' ').slice(0, 90)} | outro=${outro})`)
  await voltar(page)
  // sem-vagas com 0 no Arizona (o servidor sabe antes da lista)
  await ctx.route('**/api/index.php?r=rateio-entrar', (route) => route.fulfill({ status: 409, json: { ok: false, erro: 'sem-vagas', mensagem: 'As vagas acabaram.', disponiveis: 0 } }))
  await page.locator('[data-rateio="arizona-green-tea"] .rt-entrar').click()
  await page.locator('.rp .rp-form').waitFor({ timeout: 8000 }).catch(() => {})
  await page.locator('.rp-reservar').click()
  await page.locator('.rp-alerta').waitFor({ timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(800)
  const lot = await page.evaluate(() => ({
    qtd: document.querySelector('.rp-form .rp-uma')?.textContent ?? '',
    botao: document.querySelector('.rp-reservar')?.textContent,
    travado: !!document.querySelector('.rp-reservar')?.disabled,
    alerta: document.querySelector('.rp-alerta p')?.textContent ?? '',
  }))
  conferir(/Vagas tomadas/.test(lot.qtd) && !/Só sobrou/.test(lot.qtd) && lot.botao === 'Vagas tomadas' && lot.travado && /Lotou/.test(lot.alerta), `rateio: sem-vagas com 0 → "Vagas tomadas" e o envio travado, sem "Só sobrou 1 vaga" (${JSON.stringify(lot)})`)
  await foto(page, 'rateio-12-vagas-tomadas')
  await ctx.close()
}
{
  // "Como funciona" numa tela baixa (320×568): abre com o foco no corpo, que rola pelo teclado (End leva ao fim, onde fica
  // o "E se não lotar?"), e o axe não acha região rolável sem foco
  const ctx = await contexto(browser, { width: 320, height: 568 }, { rateio: true })
  const page = await ctx.newPage()
  vigiar(page, 'rateio-como-320')
  await page.goto(`${base}?uf=mg&aba=rateio`)
  await passarAbertura(page)
  await page.locator('.vista[data-vista="rateio"] .rt').first().waitFor({ timeout: 8000 }).catch(() => {})
  await page.getByRole('button', { name: 'Como funciona o rateio' }).first().click()
  await page.waitForTimeout(900)
  const antes = await page.evaluate(() => {
    const c = document.querySelector('.folha-como .folha-corpo')
    return { foco: document.activeElement === c, rola: !!c && c.scrollHeight > c.clientHeight + 4 }
  })
  await page.keyboard.press('End')
  await page.waitForTimeout(500)
  const fim = await page.evaluate(() => {
    const c = document.querySelector('.folha-como .folha-corpo')
    return c ? Math.round(c.scrollTop + c.clientHeight - c.scrollHeight) : null
  })
  let axe = 'sem axe-core'
  if (AXE && existsSync(AXE)) {
    await page.addScriptTag({ path: AXE })
    axe = (await page.evaluate(async () => (await window.axe.run(document.querySelector('.folha-como'), { resultTypes: ['violations'] })).violations.map((x) => x.id))).join(',') || '0'
  }
  conferir(antes.foco && antes.rola && fim != null && fim >= -2 && (axe === '0' || axe === 'sem axe-core'), `rateio: "Como funciona" em 320×568 rola pelo teclado (End chega ao fim) e o axe dá ${axe} (${JSON.stringify({ ...antes, fim })})`)
  await foto(page, 'rateio-13-como-320')
  await ctx.close()
}
{
  // estado pelas setas (grupo de rádio): a cidade digitada pro estado de antes não vai junto (ES "Vila Velha" → SP vazio)
  const ctx = await contexto(browser, { width: 390, height: 844 }, { rateio: true, ipUf: 'ES', ipRegiao: 'Espírito Santo' })
  const page = await ctx.newPage()
  vigiar(page, 'rateio-setas-uf')
  await page.goto(`${base}?uf=es&aba=rateio&rateio=arizona-green-tea`)
  await passarAbertura(page)
  await page.locator('.rp .rp-form').waitFor({ timeout: 8000 }).catch(() => {})
  await page.getByLabel('Tua cidade').fill('Vila Velha')
  await page.locator('.rp-chip[aria-checked="true"]').focus()
  await page.keyboard.press('ArrowLeft')
  await page.waitForTimeout(250)
  const r = await page.evaluate(() => ({
    uf: document.querySelector('.rp-chip[aria-checked="true"]')?.textContent,
    foco: document.activeElement?.textContent,
    cidade: document.querySelector('.rp-form input[autocomplete="address-level2"]')?.value ?? null,
  }))
  conferir(r.uf === 'SP' && r.foco === 'SP' && r.cidade === '', `rateio: trocar o estado pelas setas limpa a cidade do estado de antes (${JSON.stringify(r)})`)
  await ctx.close()
}
{
  // rateio fora da lista (criado depois dela): o GET rateio que falha (502) não é "saiu do ar" (abre com o WhatsApp e o
  // link do rateio); só nao-encontrado é
  const textoDe = async (id, rota) => {
    const ctx = await contexto(browser, { width: 390, height: 844 }, { rateio: true })
    if (rota) await ctx.route(rota, (route) => route.fulfill({ status: 502, contentType: 'text/html', body: 'Bad gateway' }))
    const page = await ctx.newPage()
    vigiarSemRede(page, `rateio-avulso-${id}`)
    await page.goto(`${base}?uf=mg&aba=rateio&rateio=${id}`)
    await passarAbertura(page)
    await page.locator('.rp-vazio p:not([role="status"])').first().waitFor({ timeout: 12000 }).catch(() => {})
    await page.waitForTimeout(400)
    const r = {
      txt: ((await page.locator('.rp-vazio').textContent().catch(() => '')) ?? '').replace(/\s+/g, ' '),
      zap: decodeURIComponent((await page.locator('.rp-vazio a[href*="wa.me"]').getAttribute('href').catch(() => '')) ?? ''),
    }
    if (rota) await foto(page, 'rateio-14-avulso-falhou')
    await ctx.close()
    return r
  }
  const falhou = await textoDe('rateio-novo', /api\/index\.php\?r=rateio&id=rateio-novo/)
  const saiu = await textoDe('rateio-que-saiu', null)
  conferir(/Não deu pra abrir esse rateio agora/.test(falhou.txt) && /rateio=rateio-novo/.test(falhou.zap) && /não tá mais no ar/.test(saiu.txt), `rateio: GET rateio com 502 → "Não deu pra abrir esse rateio agora" com o WhatsApp; nao-encontrado → "não tá mais no ar" (${falhou.txt.slice(0, 70)} | ${saiu.txt.slice(0, 50)})`)
}
{
  // 320 px: "Fechar pagamento no WhatsApp" quebra a linha em vez de cortar (a fonte do aparelho pode ser mais larga que a
  // métrica do Arial), e a confirmação não rola de lado
  const ctx = await contexto(browser, { width: 320, height: 568 }, { rateio: true })
  const page = await ctx.newPage()
  vigiar(page, 'rateio-320')
  await page.goto(`${base}?uf=mg&aba=rateio&rateio=arizona-green-tea`)
  await passarAbertura(page)
  await page.locator('.rp .rp-form').waitFor({ timeout: 8000 }).catch(() => {})
  await page.getByLabel('Teu nome').fill('Ian Teste')
  await page.getByLabel('Teu WhatsApp').fill('33991234567')
  await page.locator('.rp-reservar').click()
  await page.locator('.rp-feito').waitFor({ timeout: 8000 }).catch(() => {})
  await page.locator('.rp-feito .rp-zap').scrollIntoViewIfNeeded().catch(() => {})
  const r = await page.evaluate(() => {
    const a = document.querySelector('.rp-feito .rp-zap')
    const t = a?.querySelector('span')
    // o texto (span) dentro da largura útil do botão; o scrollWidth do botão conta o anel do realce (::before, 5 px pra fora)
    if (!a) return null
    const st = getComputedStyle(a)
    const util = a.clientWidth - parseFloat(st.paddingLeft) - parseFloat(st.paddingRight)
    const texto = t?.getBoundingClientRect().width ?? 0
    return { texto: Math.round(texto), util: Math.round(util), cabe: texto <= util + 0.5, alto: Math.round(a.getBoundingClientRect().height), lado: document.documentElement.scrollWidth > innerWidth }
  })
  conferir(!!r && r.cabe && r.alto >= 44 && !r.lado, `rateio 320: "Fechar pagamento no WhatsApp" cabe (quebra a linha se precisar) e nada rola de lado (${JSON.stringify(r)})`)
  await foto(page, 'rateio-15-confirmacao-320')
  await ctx.close()
}
{
  // computador: o selo com os abertos na lateral usa o 2 e o 5 redesenhados; e o rodapé diz que uma cópia das vagas fica
  // no aparelho
  const ctx = await contexto(browser, { width: 1280, height: 800 }, { rateio: true })
  const page = await ctx.newPage()
  vigiar(page, 'rateio-lateral')
  await page.goto(`${base}?uf=mg`)
  await passarAbertura(page)
  await page.locator('.lateral-contador').first().waitFor({ timeout: 8000 }).catch(() => {})
  const r = await page.evaluate(() => ({
    selo: document.querySelector('.lateral-contador')?.textContent,
    fonte: getComputedStyle(document.querySelector('.lateral-contador') ?? document.body).fontFamily,
    rodape: /uma cópia das tuas vagas fica neste aparelho/.test(document.querySelector('.rodape')?.textContent ?? ''),
  }))
  conferir(r.selo === '2' && /GC Digitos/.test(r.fonte) && r.rodape, `rateio: selo da lateral com o 2 redesenhado e o rodapé com a cópia das vagas no aparelho (${JSON.stringify(r)})`)
  await ctx.close()
}
{
  // servidor que responde em JSON, mesmo torto (ok sem a lista) ou com erro (500 em JSON): nunca os exemplos no lugar dos
  // de verdade ("Sem conexão" com o WhatsApp)
  for (const [caso, resposta] of [
    ['json-torto', { status: 200, json: { ok: true, agora: new Date().toISOString() } }],
    ['json-500', { status: 500, json: { ok: false, erro: 'erro-interno', mensagem: 'Deu ruim.' } }],
  ]) {
    const ctx = await contexto(browser, { width: 390, height: 844 })
    await ctx.route('**/api/index.php**', (route) => route.fulfill(resposta))
    const page = await ctx.newPage()
    vigiarSemRede(page, `rateio-${caso}`)
    await page.goto(`${base}?uf=mg&aba=rateio`)
    await passarAbertura(page)
    await page.locator('.rv-sem-conexao, .vista[data-vista="rateio"] .rt').first().waitFor({ timeout: 8000 }).catch(() => {})
    const r = await page.evaluate(() => ({ aviso: !!document.querySelector('.rv-sem-conexao a.rv-sem-zap'), cartoes: document.querySelectorAll('.vista[data-vista="rateio"] .rt').length }))
    conferir(r.aviso && r.cartoes === 0, `rateio: servidor com ${caso} → "Sem conexão" com o WhatsApp, nunca os exemplos (${JSON.stringify(r)})`)
    await ctx.close()
  }
}

// ---------- a rua viva ----------
/**
 * Conta só as voltas do requestAnimationFrame do relógio da rua (o laço com o acumulador, motor.ts); o resto da página
 * (story, GSAP) tem os rAF dele.
 */
function contarVoltasDaRua() {
  const raf = window.requestAnimationFrame.bind(window)
  window.__voltas = 0
  window.requestAnimationFrame = (cb) => {
    if (!String(cb).includes('acum')) return raf(cb)
    return raf((t) => {
      window.__voltas++
      cb(t)
    })
  }
}

// No celular, a rua no fim do Início, depois da grade e antes do rodapé (pedido do Ian em 09/10): na primeira tela ela
// nem monta nem baixa (a vaga já guarda a altura); rolando até ela, o pedaço baixa e ela anda; o rAF para com o botão,
// fora da tela, com a sacola por cima e com a aba escondida; movimento reduzido, a foto. No computador, a faixa embaixo
// do perfil: aparece, para fora da tela e no botão. Nos dois, o mercador chamado pelo teclado abre o "Ver o Mercado",
// que leva à aba Mercado.
for (const [w, h, reduzir] of [[390, 844, false], [390, 844, true], [1280, 800, false], [1280, 800, true]]) {
  const cel = w < 900
  const nome = `rua-${cel ? 'fim-' : ''}${w}${reduzir ? '-reduzido' : ''}`
  const ctx = await contexto(browser, { width: w, height: h }, { reduzir })
  await ctx.addInitScript(contarVoltasDaRua)
  const page = await ctx.newPage()
  vigiar(page, nome)
  await page.goto(`${base}?uf=mg`)
  await passarAbertura(page)
  const baixada = () => page.evaluate(() => performance.getEntriesByType('resource').some((e) => /\/Rua-[^/]*\.js|elenco\.worker/.test(e.name)))
  if (cel) {
    // a primeira tela não paga nada pela rua do fim: nem montada nem baixada, com a altura dela já guardada
    await page.locator('.vista-inicio .catalogo-inicio .grade').waitFor({ state: 'attached', timeout: 6000 }).catch(() => {})
    await page.waitForTimeout(1500)
    const antes = await page.evaluate(() => ({
      montada: document.querySelectorAll('.vista-inicio .rua').length,
      vaga: Math.round(document.querySelector('.vista-inicio .rua-fim .rua-vaga')?.getBoundingClientRect().height ?? 0),
      noHero: document.querySelectorAll('.vista-inicio .hero .rua, .vista-inicio .hero .rua-vaga').length,
    }))
    const b = await baixada()
    conferir(!antes.montada && !b && !antes.noHero && antes.vaga >= 150 && antes.vaga <= 190, `${nome}: na primeira tela a rua do fim nem monta nem baixa e a vaga já guarda a altura (${JSON.stringify({ ...antes, baixada: b })})`)
  }
  const rua = page.locator('.vista:not([hidden]) .rua')
  const paraARua = () => page.evaluate(() => document.querySelector('.vista:not([hidden]) .rua-vaga').scrollIntoView({ block: 'center' }))
  await paraARua()
  await rua.waitFor({ state: 'attached', timeout: 10000 })
  for (let k = 0; k < 60 && !['rodando', 'foto'].includes(await rua.getAttribute('data-rua')); k++) await page.waitForTimeout(100)
  const estado = await rua.getAttribute('data-rua')
  conferir(estado === (reduzir ? 'foto' : 'rodando'), `${nome}: a rua ${reduzir ? 'vira uma foto (movimento reduzido)' : 'anda à vista'} (${estado})`)
  conferir((await page.locator('.vista:not([hidden]) .rua-tela[aria-hidden="true"]').count()) === 1 && (await rua.getAttribute('aria-label')) === 'A rua da loja', `${nome}: canvas decorativo e grupo com rótulo curto`)
  if (cel) {
    // o título pequeno em cima (um h2 de verdade, pro leitor de tela) e a rua sem rolagem lateral, de ponta a ponta
    const t = await page.evaluate(() => {
      const s = document.querySelector('.vista-inicio .rua-fim')
      const vaga = s?.querySelector('.rua-vaga')?.getBoundingClientRect()
      return { titulo: s?.querySelector('h2')?.textContent?.trim(), rotulo: s?.getAttribute('aria-labelledby'), larg: document.documentElement.scrollWidth > innerWidth, borda: vaga ? [Math.round(vaga.left), Math.round(vaga.right - innerWidth)] : null }
    })
    conferir(!!t.titulo && t.rotulo === 'rua-fim-titulo' && !t.larg && JSON.stringify(t.borda) === '[0,0]', `${nome}: o título pequeno em cima e a rua de ponta a ponta, sem rolagem lateral (${JSON.stringify(t)})`)
    await foto(page, `${nome}-1`)
  }
  // desenho de verdade no canvas (não ficou preto)
  const cores = await page.evaluate(() => {
    const c = document.querySelector('.vista:not([hidden]) .rua-tela')
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    const s = new Set()
    for (let i = 0; i < d.length; i += 4 * 7) s.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2])
    return s.size
  })
  conferir(cores > 6, `${nome}: a rua desenhada no canvas (${cores} cores)`)
  const quadro = () => page.evaluate(() => document.querySelector('.vista:not([hidden]) .rua-tela').toDataURL())
  const voltas = () => page.evaluate(() => window.__voltas)
  /** Voltas do rAF da rua em 1 s (depois de 300 ms para assentar). */
  const porSegundo = async () => {
    await page.waitForTimeout(300)
    const a = await voltas()
    await page.waitForTimeout(1000)
    return (await voltas()) - a
  }
  if (reduzir) {
    const a = await quadro()
    await page.waitForTimeout(2500)
    conferir(a === (await quadro()), `${nome}: com movimento reduzido nada anda (o mesmo quadro)`)
    conferir(!(await page.locator('.rua-pausa').count()), `${nome}: sem botão de pausar (nada se mexe)`)
    conferir((await porSegundo()) <= 1, `${nome}: com movimento reduzido, sem rAF da rua`)
  } else {
    const rAF = {}
    rAF.vista = await porSegundo()
    // botão de pausar: alvo de 44 px, pausa e continua
    const pausa = page.locator('.vista:not([hidden]) .rua-pausa')
    const bb = await pausa.boundingBox()
    conferir(!!bb && bb.width >= 44 && bb.height >= 44, `${nome}: botão de pausar com alvo de 44 px (${bb ? `${bb.width}×${bb.height}` : '?'})`)
    await pausa.click()
    rAF.pausada = await porSegundo()
    conferir((await rua.getAttribute('data-rua')) === 'parada' && (await pausa.getAttribute('aria-label')) === 'Continuar a rua', `${nome}: pausar para a rua`)
    await pausa.click()
    await page.waitForTimeout(200)
    conferir((await rua.getAttribute('data-rua')) === 'rodando', `${nome}: continuar volta a andar`)
    // fora da tela o relógio para (no celular a rua mora no fim: fora da tela é lá em cima; no computador, embaixo)
    await page.evaluate((cel) => window.scrollTo(0, cel ? 0 : document.documentElement.scrollHeight), cel)
    await page.waitForTimeout(600)
    rAF.foraDaTela = await porSegundo()
    conferir((await rua.getAttribute('data-rua')) === 'parada', `${nome}: fora da tela a rua para`)
    await paraARua()
    await page.waitForTimeout(400)
    conferir((await rua.getAttribute('data-rua')) === 'rodando', `${nome}: de volta à vista, a rua anda`)
    if (cel) {
      // camada por cima (a sacola) e a aba do navegador escondida
      await page.locator('.barra-abas [data-aba="sacola"]').click()
      await page.waitForTimeout(500)
      rAF.sacola = await porSegundo()
      const comSacola = (await rua.getAttribute('data-rua')) === 'parada'
      await page.keyboard.press('Escape')
      await page.waitForTimeout(700)
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
        document.dispatchEvent(new Event('visibilitychange'))
      })
      rAF.abaEscondida = await porSegundo()
      const escondida = (await rua.getAttribute('data-rua')) === 'parada'
      await page.evaluate(() => {
        delete document.visibilityState
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await page.waitForTimeout(400)
      conferir(comSacola && escondida && (await rua.getAttribute('data-rua')) === 'rodando', `${nome}: com a sacola por cima e com a aba escondida a rua para; depois, anda`)
    }
    relatorio.push(`${nome}: rAF da rua por segundo — ${Object.entries(rAF).map(([k, v]) => `${k} ${v}`).join(', ')}`)
    const { vista, ...parada } = rAF
    conferir(vista >= 30 && Object.values(parada).every((v) => v <= 3), `${nome}: o rAF da rua só roda à vista e tocando (${JSON.stringify(rAF)})`)
    await paraARua()
    await page.waitForTimeout(400)
  }
  // chamar o mercador pelo teclado: o botão focável abre o balão e o adesivo "Ver o Mercado", que leva à aba Mercado
  const botao = page.locator('.vista:not([hidden]) .rua-mercador')
  await botao.focus()
  await page.keyboard.press('Enter')
  // o balão do chamado sai na hora; no meio de um atendimento a fala seguinte do roteiro pode tomar o lugar dele logo
  // depois (um balão por vez): o que vale é ele ter aparecido. As falas vistas nos primeiros 400 ms
  const bal = new Set()
  for (let k = 0; k < 8; k++) {
    for (const t of await page.locator('.vista:not([hidden]) .rua-balao[data-ator="mercador"]').allTextContents()) bal.add(t)
    await page.waitForTimeout(50)
  }
  const cta = page.locator('.vista:not([hidden]) .rua-cta')
  conferir((await cta.count()) === 1 && [...bal].some((t) => /Chega mais|Vem no certo|Quem já usou/.test(t)), `${nome}: chamar o mercador abre o balão e o "Ver o Mercado" (${[...bal].join(' | ')})`)
  // o leitor de tela ouve o que de fato acontece: livre, ele abre o casaco; atendendo, abre no fim do atendimento; na
  // foto (movimento reduzido), só oferece
  const aviso = (await page.locator('.vista:not([hidden]) .rua [aria-live]').textContent())?.trim()
  const avisoCerto = reduzir ? aviso === 'O mercador ofereceu o Mercado.' : /^O mercador ofereceu o Mercado( e abre o casaco\.|\. Ele abre o casaco assim que terminar o atendimento\.)$/.test(aviso ?? '')
  conferir(avisoCerto, `${nome}: o aviso do chamado diz o que acontece na cena (${aviso})`)
  const cb = await cta.boundingBox()
  conferir(!!cb && cb.height >= 44, `${nome}: "Ver o Mercado" com alvo de 44 px (${cb ? Math.round(cb.height) : '?'})`)
  await foto(page, `${nome}-chamado`)
  await page.keyboard.press('Tab')
  conferir(await cta.evaluate((e) => e === document.activeElement), `${nome}: o Tab seguinte cai no "Ver o Mercado"`)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(800)
  conferir((await abaAberta(page)) === 'catalogo', `${nome}: "Ver o Mercado" abre a aba Mercado`)
  await ctx.close()
}

// ---------- conta no servidor (simulada, o contrato do API.md "Contas dos clientes"): a loja guarda as contas, a do
// aparelho espera o número ser confirmado e vai junto no primeiro login (nome, promoções, cupom que vale); Minha conta
// com pedidos, vagas e endereços do servidor; sem erro no console, axe e sem rolagem lateral em 320 ----------
{
  /** axe na página como ela está (a folha aberta por cima). */
  const axeNaPagina = async (page, nome) => {
    if (!AXE || !existsSync(AXE)) return relatorio.push('axe: axe-core não encontrado (AXE=caminho), pulei')
    await page.addScriptTag({ path: AXE })
    const v = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations.map((x) => `${x.id}: ${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`))
    if (v.length) erros.push(`[axe ${nome}] ${v.join('; ')}`)
    else relatorio.push(`axe ${nome}: 0 violações`)
  }
  const agora = Date.now()
  const iso = (t) => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z')
  const zap = '5533977712345'
  const retrato = { titulo: '4 por 3 na OCB', regra: 'Leva 4 Seda OCB Premium Slim e paga 3', aplicaA: { produtos: ['seda-ocb-premium-slim'] }, comoUsar: 'Põe 4 na sacola e usa o cupom.', tipo: 'leve-x-pague-y', valor: { leve: 4, pague: 3 } }
  const local = {
    state: {
      contas: { [zap]: { conta: { id: 'local-1', nome: 'Bia do Aparelho', whatsapp: zap, aceitaPromo: true, aceitaPromoEm: agora - 864e5, confirmou18Em: agora - 864e5, criadaEm: agora - 864e5 }, cupons: [{ codigo: 'SORTE-K8EA', interativo: 'sorte', premioId: 'ocb-4-por-3', retrato, demo: true, ganhoEm: agora - 864e5, validoAte: agora + 5 * 864e5 }] } },
      atual: zap,
      giros: {},
      pendente: null,
      vistos: [],
    },
    version: 1,
  }
  for (const vp of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
    const nome = `conta-servidor-${vp.width}`
    const ctx = await contexto(browser, vp)
    await ctx.addInitScript((s) => {
      localStorage.setItem('gc-idade', JSON.stringify(Date.now() + 864e5))
      sessionStorage.setItem('gc-abertura', '1')
      if (!localStorage.getItem('gc-conta')) localStorage.setItem('gc-conta', s)
    }, JSON.stringify(local))
    const pedidos = []
    let sessao = false
    let entrou = null
    const eu = () => ({
      conta: { id: '7', nome: 'Bia do Aparelho', whatsapp: zap, aceitaPromo: true, aceitaPromoEm: iso(agora - 864e5), confirmou18Em: iso(agora), criadaEm: iso(agora) },
      cupons: [{ codigo: 'SORTE-K8EA', interativo: 'sorte', premioId: 'ocb-4-por-3', retrato, demo: true, ganhoEm: iso(agora - 864e5), validoAte: iso(agora + 5 * 864e5), usadoEm: null, origem: 'aparelho' }],
      enderecos: [{ id: 1, apelido: 'Casa', cep: '39800000', rua: 'Rua Doutor Manoel Esteves', numero: '120, apto 201', bairro: 'Centro', cidade: 'Teófilo Otoni', uf: 'mg', livre: '', usadoEm: iso(agora) }],
      dias: {},
    })
    // a rota de cima ganha das de baixo: tudo que não é conta segue "sem servidor"
    await ctx.route('**/api/index.php**', async (route) => {
      const u = new URL(route.request().url())
      const r = u.searchParams.get('r')
      const corpo = route.request().postData() ? JSON.parse(route.request().postData()) : {}
      pedidos.push(r)
      if (r === 'recursos') return route.fulfill({ json: { ok: true, contas: { codigo: true, sessao } } })
      if (r === 'cliente-codigo') return route.fulfill({ json: { ok: true, enviado: true, para: '(33) 9••••-2345', expiraEm: iso(agora + 6e5), reenviarEm: iso(agora + 6e4) } })
      if (r === 'cliente-entrar') {
        entrou = corpo
        if (corpo.codigo !== '482913') return route.fulfill({ status: 403, json: { ok: false, erro: 'codigo-errado', mensagem: 'Código errado.', restam: 4 } })
        sessao = true
        return route.fulfill({ status: 201, json: { ok: true, ...eu(), criada: true, cupomGuardado: null, migrados: 1, pendente: null } })
      }
      if (r === 'cliente-eu') return sessao ? route.fulfill({ json: { ok: true, agora: iso(agora), ...eu() } }) : route.fulfill({ status: 401, json: { ok: false, erro: 'sem-sessao', mensagem: 'Entra de novo.' } })
      if (r === 'cliente-pedidos')
        return route.fulfill({ json: { ok: true, pedidos: [{ codigo: 'GC-K8EA2', tipo: 'pedido', status: 'saiu', uf: 'mg', cidade: 'Teófilo Otoni', resumo: '3x Seda OCB Premium Slim', unidades: 3, subtotalTexto: 'R$ 19,99', criadoEm: iso(agora - 36e5), atualizadoEm: iso(agora - 6e5) }] } })
      if (r === 'cliente-vagas')
        return route.fulfill({ json: { ok: true, vagas: [{ codigo: 'RAT-K8EA', rateio: 'arizona-green-tea', titulo: 'Arizona Green Tea 680 ml', quantidade: 2, total: 29.8, status: 'confirmado', expiraEm: null, criadoEm: iso(agora - 864e5), rateioStatus: 'aberto' }] } })
      if (r === 'cliente-giro') return route.fulfill({ json: { ok: true, agora: iso(agora), giro: { disponivel: true }, pendente: null, dias: [] } })
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>sem servidor</title>' })
    })
    const page = await ctx.newPage()
    vigiar(page, nome)
    await page.goto(`${base}?uf=mg&aba=estados`)
    const tua = page.locator('.pe-conta-tua button')
    await tua.waitFor({ timeout: 10000 })
    await page.waitForFunction(() => /Entrar com teu WhatsApp/.test(document.querySelector('.pe-conta-tua')?.textContent ?? ''), null, { timeout: 8000 }).catch(() => {})
    conferir(/Entrar com teu WhatsApp/.test(await tua.innerText()), `${nome}: com a loja guardando as contas, Por estado oferece entrar (a conta do aparelho espera o número)`)
    await tua.scrollIntoViewIfNeeded()
    await tua.click()
    const f = page.locator('.conta-entrar')
    await f.waitFor()
    conferir((await f.getByLabel('Teu WhatsApp').inputValue()).replace(/\D/g, '') === zap.slice(2), `${nome}: o número da conta do aparelho já vem no campo`)
    conferir(/Bia do Aparelho, 1 cupom/.test(await f.innerText()), `${nome}: avisa que a conta do aparelho (nome e cupom) vai junto`)
    await axeNaPagina(page, `${nome} entrar`)
    await f.locator('button[type=submit]').click()
    await f.locator('.form-codigo').waitFor()
    conferir(/9••••-2345/.test(await f.innerText()), `${nome}: diz pra qual número o código foi (mascarado)`)
    await foto(page, `${nome}-codigo`)
    await f.locator('.form-codigo').fill('482913')
    await f.locator('button[type=submit]').click()
    await page.locator('.conta-oi').waitFor({ timeout: 8000 })
    conferir(entrou?.migrar?.nome === 'Bia do Aparelho' && entrou.migrar.cupons?.[0]?.codigo === 'SORTE-K8EA' && entrou.migrar.aceitaPromo === true && /^[0-9a-f]{32}$/.test(entrou.aparelho ?? ''), `${nome}: o entrar leva a conta do aparelho (nome, promoções, cupom) e o segredo do aparelho`)
    await page.locator('.cs-pedido').first().waitFor({ timeout: 6000 })
    const t = await page.locator('.conta').innerText()
    conferir(/GC-K8EA2/.test(t) && /Saiu pra entrega/.test(t), `${nome}: Minha conta com o pedido e o andamento que a loja deu`)
    conferir(/RAT-K8EA/.test(t) && /Confirmada/.test(t), `${nome}: Minha conta com a vaga do rateio`)
    conferir(/Casa:/.test(t) && /SORTE-K8EA/.test(t), `${nome}: endereço guardado e o cupom que veio do aparelho`)
    const cache = await page.evaluate(() => JSON.parse(localStorage.getItem('gc-conta') ?? '{}').state)
    conferir(cache?.servidor === '5533977712345' && !cache.paraMigrar, `${nome}: o cache passa a ser o da conta do servidor`)
    conferir(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 0.5), `${nome}: Minha conta sem rolagem lateral`)
    await axeNaPagina(page, `${nome} minha conta`)
    await foto(page, `${nome}-minha-conta`)
    await ctx.close()
  }
}

// ---------- pedido guiado só no teclado (computador): a cada passo respondido, o foco continua dentro do chat (o
// chip ou o campo que respondeu some; o foco não pode cair no <body> e o Tab seguinte ir pra página de trás). Na
// busca do CEP o campo desliga: o foco espera na folha (um Enter a mais não escolhe "Sem CEP") ----------
{
  const resposta = (ph) =>
    /cep/i.test(ph) ? '39800000' : /nome/i.test(ph) ? 'Ian Teste' : /quant/i.test(ph) ? '2' : /link|descri/i.test(ph) ? 'https://exemplo.com/fanta' : /rua/i.test(ph) ? 'Rua Doutor Manoel Esteves, 120, Centro' : /obs/i.test(ph) ? 'Portão azul' : 'Fanta de uva japonesa'
  /** Responde cada passo só com o teclado até o resumo; devolve onde o foco saiu do chat (ou null) e o caminho. */
  async function percorrer(page) {
    const passos = []
    for (let i = 0; i < 16; i++) {
      const f = await page.evaluate(() => {
        const a = document.activeElement
        return { dentro: !!a?.closest('.folha-chat'), body: !a || a === document.body, tag: a?.tagName ?? '', chip: !!a?.classList.contains('dm-chip'), txt: (a?.textContent ?? '').trim().slice(0, 24), ph: a?.getAttribute('placeholder') ?? '', zap: !!document.querySelector('.folha-chat .dm-zap') }
      })
      passos.push(`${f.tag}${f.chip ? `(${f.txt})` : ''}${f.ph ? `[${f.ph}]` : ''}`)
      if (!f.dentro) return { fora: `${f.body ? 'BODY' : f.tag} no passo ${i + 1}`, chegou: false, passos }
      if (f.zap) return { fora: null, chegou: true, passos }
      if (f.tag === 'INPUT') {
        await page.keyboard.type(resposta(f.ph))
        await page.keyboard.press('Enter')
      } else if (f.chip) await page.keyboard.press('Enter')
      else await page.keyboard.press('Tab')
      await page.waitForTimeout(f.ph && /cep/i.test(f.ph) ? 2500 : 700)
    }
    return { fora: null, chegou: false, passos }
  }
  const ctx = await contexto(browser, { width: 1280, height: 800 })
  const page = await ctx.newPage()
  vigiarSemRede(page, 'teclado-chat')
  const folha = page.locator('[aria-modal="true"][aria-label="Pedido guiado"]')
  // a encomenda (só campos e o "Pode")
  await page.goto(`${base}?uf=mg&chat=encomenda`)
  await passarAbertura(page)
  await folha.waitFor({ timeout: 8000 })
  await page.waitForTimeout(700)
  const enc = await percorrer(page)
  conferir(!enc.fora && enc.chegou, `teclado-chat: encomenda, o foco fica no chat do 1º passo ao resumo (${enc.fora ?? enc.passos.join(' → ')})`)
  if (enc.chegou) {
    await page.keyboard.press('Tab')
    conferir(await page.evaluate(() => !!document.activeElement?.closest('.folha-chat')), 'teclado-chat: no resumo da encomenda, o Tab segue dentro do chat')
  }
  // o pedido ("Isso" e "Tá certo" seguidos, o CEP procurado, o pagamento)
  await page.goto(`${base}?uf=mg&cidade=teofilo-otoni&produto=seda-ocb-premium-slim`)
  await page.getByRole('button', { name: /Pôr na sacola/ }).click()
  await page.waitForTimeout(600)
  await page.goto(`${base}?uf=mg&cidade=teofilo-otoni&chat=pedido`)
  await folha.waitFor({ timeout: 8000 })
  await page.waitForTimeout(700)
  const ped = await percorrer(page)
  conferir(!ped.fora && ped.chegou && ped.passos.some((x) => x === 'BUTTON(Isso)') && ped.passos.some((x) => x === 'BUTTON(Tá certo)'), `teclado-chat: pedido, o foco fica no chat do 1º passo ao resumo (${ped.fora ?? ped.passos.join(' → ')})`)
  conferir(!ped.passos.some((x) => x === 'BUTTON(Sem CEP)'), 'teclado-chat: na busca do CEP o foco não cai no "Sem CEP"')
  await foto(page, 'teclado-chat-resumo')
  await ctx.close()
}

// ---------- as falas da rua: nenhuma palavra da lista PALAVRAS_PROIBIDAS (src/dados/sorte.ts) ----------
{
  const raiz = new URL('../src/', import.meta.url)
  const sorte = readFileSync(new URL('dados/sorte.ts', raiz), 'utf8')
  const lista = [...(sorte.match(/PALAVRAS_PROIBIDAS = \[([\s\S]*?)\]/)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1])
  const falas = readFileSync(new URL('componentes/rua/falas.ts', raiz), 'utf8')
  const textos = [...falas.replace(/^\s*\/\/.*$/gm, '').matchAll(/'([^']+)'/g)].map((m) => m[1].toLowerCase())
  const achou = lista.filter((p) => textos.some((t) => new RegExp(`(^|[^a-zà-ú])${p}([^a-zà-ú]|$)`).test(t)))
  conferir(lista.length > 10 && textos.length > 20 && !achou.length, `rua: as falas sem palavra proibida (${achou.join(', ') || `${textos.length} falas`})`)
}

// ---------- a loja do servidor no site (scripts/revisao-loja.mjs) ----------
await rodadaLoja({ browser, base, contexto, conferir, foto, vigiar, vigiarSemRede, clicar, digitar })

await browser.close()
writeFileSync(`${dir}relatorio.json`, JSON.stringify({ erros, relatorio }, null, 2))
console.log(JSON.stringify({ erros, relatorio: relatorio.filter((r) => typeof r !== 'string' || !r.startsWith('ok:')) }, null, 2))
console.log(erros.length ? `${erros.length} problema(s)` : 'sem problemas')
