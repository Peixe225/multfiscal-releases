// A loja do servidor no site (rodada do scripts/revisao.mjs): o GET loja simulado no formato do API.md ("Loja"),
// nascido da semente (public/api/nucleo/semente-loja.json, a loja de um servidor recém-instalado) e mexido como o dono
// mexe no painel. Confere: o story do Início na ordem do dono (só produtos: a rua do celular fica no fim do Início,
// depois da grade) e a rua do fim sumindo quando o dono desliga ela; o
// "RESTAM 2" no card, no story e na página do produto, a quantidade que não passa do que resta e o aviso; o estado
// ativado no painel (BA) no site inteiro, sem a tela de sem atendimento piscar; o WhatsApp próprio do estado e o "o
// mesmo pra todos"; a entrega grátis em mais de um dia; a frase do story; o Teste minha sorte desligado; a loja guardada
// no aparelho com o servidor fora do ar; o 404 sem-loja (volta pra embutida); a resposta torta (ignorada); e o estado
// que sai do site (quem estava nele vê a tela de sem atendimento).
import { readFileSync } from 'node:fs'

/** A loja pública de um servidor recém-instalado (o que o GET loja devolve antes de o dono mexer). */
export function lojaDaSemente() {
  const s = JSON.parse(readFileSync(new URL('../public/api/nucleo/semente-loja.json', import.meta.url), 'utf8'))
  return {
    whatsapp: s.ajustes.whatsapp,
    restamAte: s.ajustes.restamAte,
    ruaNoStory: true,
    textos: s.textos,
    categorias: s.categorias,
    // o que é só do painel (a anotação do dono) não sai no GET loja
    produtos: s.produtos.map(({ obs: _obs, ...p }) => ({ ...p, restam: {} })),
    estados: s.estados,
    stories: {},
    sorte: s.sorte,
  }
}

const ZAP_LOJA = 'https://wa.me/5533991139036?text='
// número de teste (não é da loja): o WhatsApp próprio de MG no painel
const ZAP_MG = '5533988887777'

/**
 * @param {{ browser: import('playwright').Browser, base: string, contexto: Function, conferir: Function, foto: Function,
 *   vigiar: Function, vigiarSemRede: Function, clicar: Function, digitar: Function }} h
 */
export async function rodadaLoja({ browser, base, contexto, conferir, foto, vigiar, vigiarSemRede, clicar, digitar }) {
  // o dia da semana de Brasília (o fuso do navegador do teste e o da loja): perto da meia-noite UTC o container já
  // está no dia seguinte e a entrega grátis "de hoje" não bateria
  const hoje = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' }).format(new Date()))
  const loja = lojaDaSemente()
  const est = (uf) => loja.estados.find((e) => e.uf === uf)
  const prod = (id) => loja.produtos.find((p) => p.id === id)
  // o dono no painel: BA ativada (Salvador, só Pix, emblema de pino), OCB contada em MG (restam 2), story de MG
  // escolhido, WhatsApp próprio em MG, entrega grátis de SP em dois dias (hoje e amanhã) e a frase do story nova
  loja.estados.push({
    uf: 'ba',
    nome: 'Bahia',
    destaque: 'DELIVERY BA',
    nomePerfil: null,
    cidades: [{ slug: 'salvador', nome: 'Salvador' }],
    instagram: 'greencheese_importsba',
    whatsapp: null,
    horario: { semana: [null, null, null, null, null, null, null], demo: true },
    taxaEntrega: { valor: null, demo: false },
    entregaGratis: null,
    pagamento: { opcoes: ['pix'], demo: false },
    emblema: 'generico',
  })
  for (const p of loja.produtos) p.disponivel.ba = ['seda-ocb-premium-slim', 'isqueiro-clipper', 'piteira-de-papel-raw'].includes(p.id)
  prod('seda-ocb-premium-slim').restam = { mg: 2 }
  loja.stories = { mg: ['piteira-de-papel-raw', 'seda-ocb-premium-slim'] }
  est('mg').whatsapp = ZAP_MG
  est('sp').entregaGratis = { diaSemana: hoje, dias: [hoje, (hoje + 1) % 7], texto: 'Entrega grátis no fim de semana!', demo: false }
  loja.textos = { ...loja.textos, fraseStory: 'Vem que tem!' }

  const servidor = { modo: 'ok', versao: 7, em: new Date(Date.now() - 3 * 60_000).toISOString(), loja, pedidos: 0 }
  const responder = (route) => {
    if (servidor.modo === 'fora') return route.fulfill({ status: 502, contentType: 'text/html', body: 'Bad gateway' })
    if (servidor.modo === 'sem-loja') return route.fulfill({ status: 404, json: { ok: false, erro: 'sem-loja', mensagem: 'A loja ainda não foi montada no servidor.' } })
    if (servidor.modo === 'torto') return route.fulfill({ json: { ok: true, versao: 999, atualizadoEm: new Date().toISOString(), loja: { estados: [] } } })
    servidor.pedidos++
    return route.fulfill({ json: { ok: true, versao: servidor.versao, atualizadoEm: servidor.em, loja: servidor.loja }, headers: { 'Cache-Control': 'no-cache', ETag: `"${servidor.versao}"` } })
  }
  const guardada = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('gc-loja') || 'null')?.versao ?? null)
  /** Espera a condição na página (a loja troca num respiro do navegador, depois de chegar). */
  const esperar = (page, f, arg, ms = 6000) => page.waitForFunction(f, arg, { timeout: ms }).then(() => true, () => false)

  const ctx = await contexto(browser, { width: 390, height: 844 })
  await ctx.route(/\/api\/index\.php\?r=loja(&|$)/, responder)
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('gc-idade', JSON.stringify(Date.now() + 864e5))
      sessionStorage.setItem('gc-abertura', '1')
      sessionStorage.setItem('gc-dica-hero', '1')
    } catch {
      /* ignora */
    }
  })
  const page = await ctx.newPage()
  // o 502 e o 404 que a rodada provoca no fim aparecem no console como falha de rede (o resto não pode ter erro)
  vigiarSemRede(page, 'loja')

  // ── MG: a loja do servidor troca a embutida ──
  await page.goto(`${base}?uf=mg`)
  conferir(await esperar(page, () => JSON.parse(localStorage.getItem('gc-loja') || 'null')?.versao === 7), 'loja: a resposta do servidor fica guardada no aparelho (gc-loja, versão 7)')
  conferir(
    await esperar(page, () => document.querySelectorAll('.hero-barras .story-barra').length === 2 && !document.querySelector('.hero .rua, .hero .rua-vaga') && !!document.querySelector('.vista-inicio .rua-fim .rua-vaga')),
    'loja: MG, story do Início com os 2 escolhidos pelo dono (2 barrinhas, sem a rua) e a rua no fim do Início',
  )
  const nomes = []
  for (let i = 0; i < 3; i++) {
    nomes.push(await page.evaluate(() => document.querySelector('.hero-palco .sq-nome')?.textContent ?? '?'))
    await page.locator('.hero-quadro').first().click({ position: { x: 370, y: 300 } })
    await page.waitForTimeout(700)
  }
  conferir(JSON.stringify(nomes) === JSON.stringify(['Piteira de papel RAW', 'Seda OCB Premium Slim', 'Piteira de papel RAW']), `loja: a ordem do dono, dando a volta (${nomes.join(' → ')})`)
  // de volta na OCB (o 2º, depois de dar a volta): o adesivo do estoque no story do Início
  conferir((await page.locator('.hero-palco .sq-restam').textContent().catch(() => null)) === 'RESTAM 2', 'loja: "RESTAM 2" no story do Início')
  await foto(page, 'loja-01-story-restam')
  const frase = (await page.locator('.hero-frase .adesivo-texto').textContent())?.trim()
  conferir(frase === (est('mg').entregaGratis?.dias.includes(hoje) ? est('mg').entregaGratis.texto : 'Vem que tem!'), `loja: a frase do story é a do painel (ou a da entrega grátis de hoje): "${frase}"`)

  // o card da grade
  const card = page.locator('.vista-inicio .card').filter({ hasText: 'Seda OCB Premium Slim' }).first()
  await card.scrollIntoViewIfNeeded()
  await page.waitForTimeout(600)
  conferir((await card.locator('.sq-restam').textContent().catch(() => null)) === 'RESTAM 2', 'loja: "RESTAM 2" no card da grade')
  conferir(/restam 2\. Abrir story/.test((await card.locator('button').first().getAttribute('aria-label')) ?? ''), 'loja: o card diz "restam 2" pro leitor de tela')
  conferir((await page.locator('.vista-inicio .card').filter({ hasText: 'Isqueiro Clipper' }).locator('.sq-restam').count()) === 0, 'loja: sem estoque contado, sem adesivo')
  await foto(page, 'loja-02-card-restam')

  // a página do produto: "Só restam 2", a quantidade não passa do que resta, e avisa
  await page.goto(`${base}?uf=mg&produto=seda-ocb-premium-slim`)
  await page.locator('.pp-disp-restam').waitFor({ timeout: 6000 }).catch(() => {})
  conferir((await page.locator('.pp-disp-restam').textContent().catch(() => null)) === 'Só restam 2 unidades', 'loja: página do produto com "Só restam 2 unidades"')
  conferir((await page.locator('.pp-restam .adesivo-restam').textContent().catch(() => null)) === 'RESTAM 2', 'loja: o adesivo "RESTAM 2" na arte da página')
  conferir(await page.getByRole('radio', { name: /3 por R\$ 19,99/ }).isDisabled().catch(() => false), 'loja: o combo de 3 apaga (só restam 2)')
  const mais = page.locator('.pp-qtd').getByRole('button', { name: 'Mais um' })
  await mais.click()
  conferir(await mais.isDisabled(), 'loja: o "+" para no 2')
  await page.getByRole('button', { name: /Pôr na sacola/ }).click()
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: /Pôr na sacola/ }).click()
  conferir(await esperar(page, () => /As 2 que restam aqui já tão na tua sacola/.test(document.querySelector('.aviso')?.textContent ?? '')), 'loja: com as 2 na sacola, adicionar de novo só avisa')
  await foto(page, 'loja-03-produto-restam')
  const naSacola = await page.evaluate(() => JSON.parse(localStorage.getItem('gc-sacola') || 'null')?.state?.itens ?? [])
  conferir(naSacola.length === 1 && naSacola[0].qtd === 2, `loja: a sacola ficou com 2 (${JSON.stringify(naSacola)})`)

  // o pedido de MG fecha no WhatsApp próprio de MG
  const fecharPedido = async () => {
    await page.goto(`${base}?uf=mg`)
    await page.waitForTimeout(1200)
    await page.locator('.barra-abas [data-aba="sacola"]').click()
    await page.getByRole('button', { name: 'Fazer pedido' }).click()
    await page.waitForTimeout(700)
    await clicar(page, 'Isso')
    await clicar(page, 'Tá certo')
    await digitar(page, 'Ian Teste')
    await digitar(page, '39800000')
    await page.waitForTimeout(500)
    await digitar(page, '120')
    await clicar(page, 'Pix')
    await digitar(page, 'Portão azul')
    await page.waitForTimeout(500)
    return page.getByRole('link', { name: 'Fechar pedido no WhatsApp' }).getAttribute('href')
  }
  let zap = await fecharPedido()
  conferir(zap?.startsWith(`https://wa.me/${ZAP_MG}?text=`), `loja: o pedido de MG fecha no WhatsApp próprio de MG (${zap?.slice(0, 40)}…)`)
  conferir(/^2x Seda OCB Premium Slim — R\$ 14,99$/m.test(decodeURIComponent(zap?.split('text=')[1] ?? '')), 'loja: a mensagem leva as 2 que restam, no combo')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)

  // ── SP: entrega grátis em mais de um dia (a frase fica nos produtos) ──
  await page.goto(`${base}?uf=sp`)
  await esperar(page, () => JSON.parse(localStorage.getItem('gc-loja') || 'null')?.versao === 7 && !!document.querySelector('.hero-palco .sq-nome'))
  conferir(await esperar(page, () => document.querySelector('.hero-frase .adesivo-texto')?.textContent?.trim() === 'Entrega grátis no fim de semana!'), 'loja: SP com entrega grátis hoje e amanhã: a frase dela no story')

  // ── BA: estado ativado no painel (primeira visita, sem nada guardado) ──
  const ba = await ctx.newPage()
  vigiarSemRede(ba, 'loja-ba')
  await ba.addInitScript(() => {
    if (!sessionStorage.getItem('gc-limpo')) {
      localStorage.removeItem('gc-loja')
      localStorage.removeItem('gc-local')
      sessionStorage.setItem('gc-limpo', '1')
    }
  })
  let semAtendimento = false
  await ba.goto(`${base}?uf=ba`)
  // a tela de sem atendimento nunca pisca enquanto a loja do servidor chega
  for (let i = 0; i < 12; i++) {
    if (await ba.locator('.sem').count()) semAtendimento = true
    await ba.waitForTimeout(150)
  }
  conferir(!semAtendimento, 'loja: BA (ativada no painel) nunca mostra "ainda não chegou aí" enquanto a loja chega')
  conferir(await esperar(ba, () => document.querySelector('.hero .story-cab-nome')?.textContent === 'greencheese_importsba'), 'loja: BA com o story do perfil dela')
  conferir((await ba.locator('.hero-cab-local').textContent().catch(() => ''))?.includes('Salvador'), 'loja: BA com a cidade cadastrada (Salvador, a única)')
  await foto(ba, 'loja-04-ba-inicio')
  conferir(/@greencheese_importsba/.test((await ba.locator('.vista-inicio .faixa').textContent()) ?? ''), 'loja: o @ da BA na faixa')
  await ba.getByRole('button', { name: 'DELIVERY BA: atendimento, horário e entrega' }).first().click()
  await ba.locator('.info-emblema').waitFor({ timeout: 5000 }).catch(() => {})
  conferir((await ba.locator('.info-emblema').count()) === 1, 'loja: o story do estado da BA com o emblema de pino')
  await foto(ba, 'loja-05-ba-info')
  await ba.keyboard.press('Escape')
  await ba.waitForTimeout(500)
  await ba.locator('[data-aba="estados"]:visible').first().click()
  await ba.locator('.vista:not([hidden]) #estados').waitFor({ timeout: 5000 })
  await ba.waitForTimeout(800)
  const lista = await ba.locator('.vista:not([hidden]) .pe-contas-lista').first().textContent()
  conferir(/greencheese_importsba/.test(lista ?? ''), 'loja: Por estado com o perfil da BA')
  await foto(ba, 'loja-06-ba-por-estado')
  conferir(/greencheese_importsba/.test((await ba.locator('.rodape').textContent()) ?? ''), 'loja: o rodapé com o @ da BA')

  // ── a loja muda de novo: o Teste minha sorte desligado, "o mesmo WhatsApp pra todos", a rua desligada ──
  servidor.versao = 8
  servidor.em = new Date().toISOString()
  servidor.loja = { ...loja, ruaNoStory: false, estados: loja.estados.map((e) => ({ ...e, whatsapp: null })), sorte: { ...loja.sorte, ligado: false } }
  await page.goto(`${base}?uf=mg&jogo=sorte`)
  conferir(await esperar(page, () => JSON.parse(localStorage.getItem('gc-loja') || 'null')?.versao === 8), 'loja: a versão nova chega e fica guardada')
  conferir(
    await esperar(page, () => !document.querySelector('.barra-abas [data-aba="sorte"]') && !document.querySelector('.vista-inicio .rua-fim, .vista-inicio .rua-vaga, .vista-inicio .rua') && !!document.querySelector('.hero-palco .sq-nome')),
    'loja: Teste minha sorte desligado (some da barra) e a rua desligada: o fim do Início do celular sem a rua',
  )
  conferir(!(await page.locator('.casca').count()) && !new URL(page.url()).searchParams.has('jogo'), 'loja: ?jogo=sorte com o jogo desligado: nada abre e o parâmetro sai')
  conferir((await page.locator('.hero-palco .sq-nome').textContent()) === 'Piteira de papel RAW', 'loja: o story começa no 1º do dono')
  {
    // a rua desligada: no fim do Início, a grade e logo o rodapé
    const fim = await page.evaluate(() => {
      const g = document.querySelector('.vista-inicio .catalogo-inicio')?.getBoundingClientRect()
      const r = document.querySelector('.rodape')?.getBoundingClientRect()
      return g && r ? Math.round(r.top - g.bottom) : null
    })
    conferir(fim != null && fim >= -1 && fim <= 2, `loja: sem a rua, o rodapé vem logo depois da grade (${fim} px)`)
  }
  await foto(page, 'loja-07-sem-rua-sem-sorte')
  zap = await fecharPedido()
  conferir(zap?.startsWith(ZAP_LOJA), `loja: "o mesmo WhatsApp pra todos": o pedido de MG fecha no da loja (${zap?.slice(0, 40)}…)`)
  await page.keyboard.press('Escape')

  // ── servidor fora do ar: a loja guardada vale (BA continua no site, sem esperar) ──
  servidor.modo = 'fora'
  await ba.goto(`${base}?uf=ba`)
  await ba.waitForTimeout(400)
  conferir((await ba.locator('.sem').count()) === 0 && (await ba.locator('.hero .story-cab-nome').textContent().catch(() => '')) === 'greencheese_importsba', 'loja: servidor fora do ar: a loja guardada no aparelho abre na hora (BA no site)')
  // resposta torta: ignorada
  servidor.modo = 'torto'
  await ba.reload()
  await ba.waitForTimeout(1500)
  conferir((await guardada(ba)) === 8 && (await ba.locator('.sem').count()) === 0, 'loja: resposta torta do servidor não troca nada (fica a versão 8)')

  // loja guardada por outro build (o formato velho, só a resposta crua) com o servidor fora: a primeira tela sai com a
  // embutida, a guardada é conferida no pedaço à parte e entra (a BA volta sem a tela de sem atendimento piscar)
  servidor.modo = 'fora'
  await ba.evaluate((l) => localStorage.setItem('gc-loja', JSON.stringify({ formato: 1, versao: 6, atualizadoEm: new Date().toISOString(), loja: l })), loja)
  await ba.reload()
  let piscou = false
  for (let i = 0; i < 10; i++) {
    if (await ba.locator('.sem').count()) piscou = true
    await ba.waitForTimeout(150)
  }
  conferir(!piscou && (await esperar(ba, () => document.querySelector('.hero .story-cab-nome')?.textContent === 'greencheese_importsba')), 'loja: guardada por outro build, com o servidor fora: conferida de novo e a BA abre (sem "ainda não chegou aí")')
  conferir(await esperar(ba, () => JSON.parse(localStorage.getItem('gc-loja') || 'null')?.formato === 2), 'loja: a guardada é regravada já conferida por este build')
  // guardada (já conferida) por outro build: abre a primeira tela na hora e é conferida de novo por este
  await ba.evaluate(() => {
    const g = JSON.parse(localStorage.getItem('gc-loja'))
    localStorage.setItem('gc-loja', JSON.stringify({ ...g, build: 'outro-build' }))
  })
  await ba.reload()
  await ba.waitForTimeout(300)
  conferir((await ba.locator('.hero .story-cab-nome').textContent().catch(() => '')) === 'greencheese_importsba', 'loja: guardada por outro build: a pronta abre a primeira tela na hora (BA)')
  conferir(await esperar(ba, () => JSON.parse(localStorage.getItem('gc-loja') || 'null')?.build !== 'outro-build'), 'loja: e é conferida de novo e regravada por este build')

  // ── a BA sai do site: quem estava nela vê a tela de sem atendimento ──
  servidor.modo = 'ok'
  servidor.versao = 9
  servidor.loja = { ...servidor.loja, estados: servidor.loja.estados.filter((e) => e.uf !== 'ba') }
  await ba.reload()
  conferir(await esperar(ba, () => !!document.querySelector('.sem')), 'loja: estado tirado do site: quem tava nele vê "ainda não chegou aí"')
  await foto(ba, 'loja-08-ba-saiu')

  // ── 404 sem-loja (painel ainda não instalado): volta pra embutida e esquece a guardada ──
  servidor.modo = 'sem-loja'
  await page.goto(`${base}?uf=mg`)
  conferir(await esperar(page, () => localStorage.getItem('gc-loja') === null), 'loja: 404 sem-loja apaga a loja guardada')
  // a rua volta pro fim do Início do celular, o story volta pro automático (8 barrinhas, só produtos) e a Sorte pra barra
  conferir(
    await esperar(page, () => !!document.querySelector('.vista-inicio .rua-fim .rua-vaga') && document.querySelectorAll('.hero-barras .story-barra').length === 8 && !document.querySelector('.hero .rua') && !!document.querySelector('.barra-abas [data-aba="sorte"]')),
    'loja: 404 sem-loja: volta pra embutida (a rua no fim do Início e a Sorte de volta)',
  )
  conferir(servidor.pedidos >= 4, `loja: o site perguntou a loja a cada abertura (${servidor.pedidos} pedidos)`)
  await ctx.close()
}
