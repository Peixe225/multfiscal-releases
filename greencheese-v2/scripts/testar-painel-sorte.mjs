// O Teste minha sorte no painel, no navegador e contra o servidor de verdade (roda dentro do scripts/testar-painel.mjs,
// com a página dele já logada como dono, num celular 390×844, depois da loja): "Com que frequência" (os atalhos, o
// "Outro", os giros por vez e a frase pronta; salvar muda o GET loja e o jogo do site passa a dizer "2 giros por
// semana"), "Chance de cada raridade" (a soma ao vivo "Falta"/"Passou", a ordem "quanto mais raro, menor", o aviso do
// 0%, salvar, Desfazer e o "Voltar ao padrão"), a lista de prêmios com a raridade e a chance real (a mesma que o
// servidor calcula no Simular), o Simular giros (as tabelas e a Atividade), o teste da animação em tela cheia ("Ver as
// 4 raridades" e "Testar a animação" no prêmio: as fichas, Repetir, Fechar, Esc, o foco de volta), a raridade do
// prêmio nas 4 fichas e o peso em "Mais detalhes". E no computador (1280×800): os atalhos numa linha e o teste
// cobrindo a tela. axe e prints em cada passo.

const FABRICA = { comum: 60, raro: 25, epico: 12, lendario: 3 }

export async function fluxoSorte({ p, BASE, ok, print, axe, browser }) {
  const loja = async () => (await (await fetch(`${BASE}/api/index.php?r=loja`)).json()).loja
  const versao = async () => (await (await fetch(`${BASE}/api/index.php?r=loja`)).json()).versao
  const esperar = async (cond, ms = 10000) => {
    const fim = Date.now() + ms
    while (Date.now() < fim) {
      if (await cond().catch(() => false)) return true
      await new Promise((r) => setTimeout(r, 150))
    }
    return false
  }
  // rola até a seção, logo abaixo do topo fixo do painel
  const ir = async (sel) => {
    await p.evaluate((s) => {
      const el = document.querySelector(s)
      if (el) scrollBy(0, el.getBoundingClientRect().top - (document.querySelector('.pn-topo')?.getBoundingClientRect().bottom ?? 0) - 12)
    }, sel)
    await p.waitForTimeout(250)
  }
  const recado = () => p.locator('.pn-recados').innerText().catch(() => '')
  const frase = () => p.locator('.pn-freq-frase').innerText()
  const freqMarcada = () => p.locator('label.pn-freq-op').filter({ has: p.locator('input:checked') }).innerText()
  const op = (nome) => p.locator('label.pn-freq-op').filter({ hasText: new RegExp(`^${nome}$`) })
  const salvarFreq = p.getByRole('button', { name: 'Salvar a frequência' })
  const salvarChances = p.getByRole('button', { name: 'Salvar as chances' })
  const soma = () => p.locator('#s-chances-soma').innerText()
  const chance = (r) => p.locator(`#s-chance-${r}`)
  const porChances = async (c) => {
    for (const [r, v] of Object.entries(c)) await chance(r).fill(String(v).replace('.', ','))
  }

  await p.goto(`${BASE}/painel/#/loja/sorte`)
  await p.getByRole('heading', { name: 'Com que frequência' }).waitFor({ timeout: 20000 })
  const secoes = (await p.locator('.pn-pagina h2').allInnerTexts()).map((x) => x.replace(/\s+\d+$/, '').trim())
  ok(secoes.join(' · ') === 'No site · Com que frequência · Chance de cada raridade · Prêmios · Simular giros · Sem conta', `Sorte: as seções na ordem (${secoes.join(' · ')})`)

  // ─── com que frequência ───────────────────────────────────────────────────────────────────────────────────────
  const atalhos = (await p.locator('label.pn-freq-op').allInnerTexts()).map((x) => x.trim())
  ok(atalhos.join(' · ') === 'Todo dia · A cada 2 dias · A cada 3 dias · 1x por semana · A cada 15 dias · 1x por mês · Outro', `frequência: os atalhos em botões (${atalhos.join(' · ')})`)
  ok((await freqMarcada()) === 'Todo dia' && (await frase()) === 'Cada cliente com conta gira 1 vez por dia.', `de fábrica: "Todo dia" marcado e a frase pronta (${await frase()})`)
  ok(await salvarFreq.isDisabled(), 'sem mudança, "Salvar a frequência" fica apagado')
  const alturas = await p.locator('label.pn-freq-op > span').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)))
  ok(alturas.every((h) => h >= 48), `os botões da frequência grandes pro dedo (${alturas.join(', ')} px)`)
  await op('1x por semana').tap()
  ok((await frase()) === 'Cada cliente com conta gira 1 vez por semana.', `1x por semana: a frase muda na hora (${await frase()})`)
  await p.getByRole('button', { name: 'Um giro a mais', exact: true }).tap()
  ok((await frase()) === 'Cada cliente com conta gira 2 vezes por semana.' && (await p.locator('#s-girosPorIntervalo').inputValue()) === '2', `+1 giro: "2 vezes por semana" (${await frase()})`)
  await ir('#h-s-freq')
  await axe(p, 'sorte: frequência')
  await print(p, 'sorte-frequencia')
  await salvarFreq.tap()
  ok(await esperar(async () => /Frequência salva: 2 giros por semana com conta\./.test(await recado())), `salvou: o recado diz a frequência (${await recado()})`)
  ok(await esperar(async () => {
    const r = (await loja()).sorte.regras
    return r.intervaloDias === 7 && r.girosPorIntervalo === 2 && r.girosPorDiaComConta === 2
  }), 'o GET loja (o que o site lê) passa a 2 giros a cada 7 dias')
  ok(await salvarFreq.isDisabled(), 'salvo: o botão apaga de novo')

  // o jogo do site fala da semana (a frase vem do mesmo src/lib/frequencia.ts)
  {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' })
    await c.addInitScript(() => {
      try {
        localStorage.setItem('gc-idade', JSON.stringify(Date.now() + 864e5))
        sessionStorage.setItem('gc-abertura', '1')
      } catch {
        /* ignora */
      }
    })
    await c.route(/ipwho|geojs/, (r) => r.fulfill({ json: { success: true, country_code: 'BR', region: 'Minas Gerais', region_code: 'MG' } }))
    const s = await c.newPage()
    const errosSite = []
    s.on('pageerror', (e) => errosSite.push(e.message))
    await s.goto(`${BASE}/?uf=mg&jogo=sorte`)
    const rodape = (await s
      .waitForFunction(() => /Com conta:/.test(document.querySelector('.casca .sorte-rodape')?.textContent ?? ''), undefined, { timeout: 12000 })
      .then(() => true, () => false))
      ? ((await s.locator('.casca .sorte-rodape').first().textContent()) ?? '')
      : ''
    ok(rodape.includes('Com conta: 2 giros por semana.') && !/por dia/.test(rodape), `site: o jogo diz "Com conta: 2 giros por semana." (${rodape.slice(0, 100)})`)
    ok(!errosSite.length, `site: sem erro no console (${errosSite.join(' | ') || 'nenhum'})`)
    await c.close()
  }

  // "Outro": de 1 a 30 dias
  await op('Outro').tap()
  const aCada = p.locator('#s-intervaloDias')
  await aCada.waitFor()
  await aCada.fill('10')
  ok((await frase()) === 'Cada cliente com conta gira 2 vezes a cada 10 dias.', `Outro (10 dias): a frase (${await frase()})`)
  await aCada.fill('31')
  ok((await frase()) === 'De 1 a 30 dias e de 1 a 5 giros.' && (await salvarFreq.isDisabled()), '31 dias: a frase diz o limite e o Salvar apaga')
  await aCada.fill('10')
  await ir('#h-s-freq')
  await print(p, 'sorte-frequencia-outro')
  await salvarFreq.tap()
  ok(await esperar(async () => (await loja()).sorte.regras.intervaloDias === 10), 'Outro (a cada 10 dias): salvo no servidor')
  // volta pro de sempre (o resto do teste e do site conta com 1 por dia)
  await op('Todo dia').tap()
  await p.getByRole('button', { name: 'Um giro a menos', exact: true }).tap()
  ok((await frase()) === 'Cada cliente com conta gira 1 vez por dia.', 'Todo dia, 1 giro: a frase de sempre')
  await salvarFreq.tap()
  ok(await esperar(async () => {
    const r = (await loja()).sorte.regras
    return r.intervaloDias === 1 && r.girosPorIntervalo === 1
  }), 'de volta a 1 giro por dia no servidor')
  ok(await esperar(async () => (await freqMarcada()) === 'Todo dia'), 'e "Todo dia" marcado de novo')

  // ─── chance de cada raridade ──────────────────────────────────────────────────────────────────────────────────
  await ir('#h-s-chances')
  const nomes = (await p.locator('.pn-chance-nome .pn-rar').allInnerTexts()).map((x) => x.trim())
  ok(nomes.join(' · ') === 'Comum · Raro · Épico · Lendário', `as 4 raridades com a cor e o nome (${nomes.join(' · ')})`)
  const cores = await p.locator('.pn-chance-nome .pn-rar-bola').evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor))
  ok(new Set(cores).size === 4, `cada raridade com a sua cor (${cores.join(' · ')})`)
  ok((await soma()) === 'Soma 100%' && (await chance('comum').inputValue()) === '60' && (await salvarChances.isDisabled()), 'de fábrica: 60/25/12/3, "Soma 100%" e o Salvar apagado')
  await chance('raro').fill('30')
  ok((await soma()) === 'Passou 5%' && (await salvarChances.isDisabled()), `raro 30: "Passou 5%" ao vivo e não salva (${await soma()})`)
  await print(p, 'sorte-chances-passou')
  await chance('comum').fill('50')
  ok((await soma()) === 'Falta 5%', `comum 50: "Falta 5%" (${await soma()})`)
  await chance('comum').fill('55')
  ok((await soma()) === 'Soma 100%' && (await salvarChances.isEnabled()), '55/30/12/3: fecha 100% e o Salvar acende')
  // a ordem: raro não passa do comum
  await porChances({ comum: 15, raro: 70 })
  const erroOrdem = p.locator('.pn-erro').filter({ hasText: 'Quanto mais raro, menor a chance: Raro não pode passar de Comum.' })
  ok((await erroOrdem.isVisible()) && (await chance('raro').getAttribute('aria-invalid')) === 'true' && (await salvarChances.isDisabled()), 'raro acima do comum: a frase clara, o campo do Raro marcado e o Salvar apagado')
  await print(p, 'sorte-chances-ordem')
  // 0%: pode, com o aviso
  await porChances({ comum: 70, raro: 30, epico: 0, lendario: 0 })
  ok(await p.getByText('Com 0%, os prêmios Épico e Lendário nunca saem.').isVisible(), '0% no Épico e no Lendário: pode, com o aviso de que nunca saem')
  const lendarioNaLista = p.locator('.pn-premio[data-raridade="lendario"] .pn-premio-chance').first()
  ok((await lendarioNaLista.innerText()) === 'não sai', `a lista já mostra a chance com o que tá na tela: o lendário "não sai" (${await lendarioNaLista.innerText()})`)
  await p.getByRole('button', { name: /Voltar ao padrão/ }).tap()
  ok((await soma()) === 'Soma 100%' && (await chance('epico').inputValue()) === '12' && (await salvarChances.isDisabled()), '"Voltar ao padrão": 60/25/12/3 de novo (igual ao salvo: nada pra salvar)')
  // salvar 62,5/25/10/2,5 (uma casa decimal) e desfazer pelo recado
  await porChances({ comum: 62.5, raro: 25, epico: 10, lendario: 2.5 })
  await axe(p, 'sorte: chances')
  await print(p, 'sorte-chances-ok')
  await salvarChances.tap()
  ok(await esperar(async () => /Chances salvas\. O próximo giro já sai com elas\./.test(await recado())), 'salvou as chances: o recado')
  ok(await esperar(async () => JSON.stringify((await loja()).sorte.regras.chances) === JSON.stringify({ comum: 62.5, raro: 25, epico: 10, lendario: 2.5 })), 'o GET loja com 62,5/25/10/2,5')
  await p.locator('.pn-recados').getByRole('button', { name: 'Desfazer' }).tap()
  ok(await esperar(async () => JSON.stringify((await loja()).sorte.regras.chances) === JSON.stringify(FABRICA)), '"Desfazer": volta pra 60/25/12/3 no servidor')
  ok(await esperar(async () => (await chance('comum').inputValue()) === '60'), 'e os campos voltam junto')

  // ─── prêmios: a raridade e a chance real ──────────────────────────────────────────────────────────────────────
  await ir('#h-s-premios')
  const linhas = await p.locator('.pn-premio').evaluateAll((els) =>
    els.map((e) => ({
      raridade: e.getAttribute('data-raridade'),
      selo: e.querySelector('.pn-premio-linha .pn-rar')?.textContent?.trim() ?? '',
      chance: e.querySelector('.pn-premio-chance')?.textContent?.trim() ?? '',
      fora: e.classList.contains('pn-premio-fora'),
      nome: e.querySelector('strong')?.textContent?.trim() ?? '',
    })),
  )
  const NOME = { comum: 'Comum', raro: 'Raro', epico: 'Épico', lendario: 'Lendário' }
  ok(linhas.length >= 7 && linhas.every((x) => NOME[x.raridade] === x.selo), `cada prêmio com o selo da raridade (${linhas.map((x) => x.selo).join(', ')})`)
  ok(['comum', 'raro', 'epico', 'lendario'].every((r) => linhas.some((x) => x.raridade === r)), 'tem prêmio das 4 raridades (os exemplos de fábrica)')
  ok(linhas.filter((x) => !x.fora).every((x) => /^1 em \d+ · \d+(,\d+)?%$/.test(x.chance)), `a chance real em "1 em N · X%" (${linhas.map((x) => x.chance).join(' | ')})`)
  const somaLista = linhas.filter((x) => !x.fora).reduce((s, x) => s + Number(x.chance.split('· ')[1].replace('%', '').replace(',', '.')), 0)
  ok(Math.abs(somaLista - 100) < 0.6, `as chances da lista somam 100% (${somaLista.toFixed(2)}%)`)
  await ir('#h-s-premios')
  await print(p, 'sorte-premios')

  // ─── simular giros ────────────────────────────────────────────────────────────────────────────────────────────
  await ir('#h-s-simular')
  const versaoAntes = await versao()
  ok((await p.locator('#s-sim-uf').inputValue()) === '' && (await p.locator('#s-sim-quantos').inputValue()) === '1000', 'Simular: "Todos" e 1.000 de começo')
  await p.locator('#s-sim-quantos').selectOption('10000')
  await p.getByRole('button', { name: 'Simular 10.000 giros' }).tap()
  await p.locator('.pn-simulado').waitFor()
  ok(await esperar(async () => /Simulou 10\.000 giros\./.test(await recado())), `Simular: o recado (${await recado()})`)
  const tab = (i) =>
    p.locator('.pn-simulado table').nth(i).locator('tbody tr').evaluateAll((trs) =>
      trs.map((tr) => {
        const td = tr.querySelectorAll('td')
        const n = (s) => Number((s ?? '').replace('%', '').replace(/\./g, '').replace(',', '.'))
        return {
          nome: tr.querySelector('th')?.textContent?.trim() ?? '',
          esperado: n(td[0]?.textContent?.trim()),
          saiuPct: n(td[1]?.childNodes[0]?.textContent?.trim()),
          saiu: n(td[1]?.querySelector('small')?.textContent?.replace(/[()]/g, '')),
        }
      }),
    )
  const rars = await tab(0)
  const prems = await tab(1)
  ok(rars.length === 4 && rars.map((x) => x.nome.replace(/ · .*/, '')).join(',') === 'Comum,Raro,Épico,Lendário', `Simular: a tabela das 4 raridades (${rars.map((x) => x.nome).join(', ')})`)
  ok(rars.reduce((s, x) => s + x.saiu, 0) === 10000 && prems.reduce((s, x) => s + x.saiu, 0) === 10000, 'Simular: 10.000 giros contados, por raridade e por prêmio')
  ok(rars.every((x) => Math.abs(x.saiuPct - x.esperado) < 2), `Simular: o que saiu perto do esperado (${rars.map((x) => `${x.nome} ${x.esperado}/${x.saiuPct}`).join(' · ')})`)
  // a chance real da lista (conta do painel) é a mesma do servidor (o "Esperado" do Simular com todos os estados)
  const lista = linhas.filter((x) => !x.fora)
  const iguais = lista.every((x) => {
    const linha = prems.find((y) => y.nome.endsWith(x.nome))
    return linha && Math.abs(linha.esperado - Number(x.chance.split('· ')[1].replace('%', '').replace(',', '.'))) < 0.051
  })
  ok(iguais && prems.length === lista.length, `a chance real da lista é a mesma do servidor (${lista.map((x) => `${x.nome}: ${x.chance}`).join(' | ')})`)
  await ir('#h-s-simular')
  await axe(p, 'sorte: simular')
  await print(p, 'sorte-simular')
  // num estado
  await p.locator('#s-sim-uf').selectOption('mg')
  await p.locator('#s-sim-quantos').selectOption('1000')
  await p.getByRole('button', { name: 'Simular 1.000 giros' }).tap()
  ok(await esperar(async () => /Simulou 1\.000 giros em MG\./.test(await recado())), 'Simular em MG: o recado com o estado')
  ok((await versao()) === versaoAntes, `Simular não mexe na loja (a versão continua ${versaoAntes})`)

  // ─── o teste da animação: as 4 raridades ──────────────────────────────────────────────────────────────────────
  const verQuatro = p.getByRole('button', { name: 'Ver as 4 raridades' })
  await verQuatro.tap()
  const tela = p.locator('.pn-folha-tela')
  await tela.waitFor()
  const palco = tela.locator('.pn-teste-palco')
  const fichas = tela.locator('.pn-teste-rars button')
  ok((await fichas.count()) === 4 && (await fichas.nth(0).getAttribute('aria-pressed')) === 'true' && (await palco.getAttribute('data-raridade')) === 'comum', 'Ver as 4 raridades: abre por cima no Comum, com as 4 fichas')
  ok(await esperar(async () => (await palco.locator(':scope > *').count()) > 0 && (await palco.getByText('Abrindo a animação…').count()) === 0 && (await palco.locator('.pn-teste-erro').count()) === 0), 'a revelação do site abre no palco (baixada só agora)')
  ok((await p.evaluate(() => document.activeElement?.textContent?.trim())) === 'Repetir', 'o foco vai pro Repetir')
  const caixa = await tela.boundingBox()
  ok(!!caixa && caixa.y <= 1 && caixa.height >= 840 && caixa.width >= 389, `em tela cheia no celular (${JSON.stringify(caixa)})`)
  ok(/Não conta giro nem cria cupom/.test(await tela.innerText()), 'diz que não conta giro nem cria cupom')
  await axe(p, 'sorte: teste da animação')
  await print(p, 'sorte-teste-4-raridades')
  await fichas.nth(3).tap()
  ok((await palco.getAttribute('data-raridade')) === 'lendario' && (await fichas.nth(3).getAttribute('aria-pressed')) === 'true', 'a ficha do Lendário troca a cena')
  await tela.getByRole('button', { name: 'Repetir' }).tap()
  ok(await esperar(async () => (await palco.locator(':scope > *').count()) > 0 && (await palco.locator('.pn-teste-erro').count()) === 0), 'Repetir: a revelação de novo')
  await print(p, 'sorte-teste-lendario')
  await p.keyboard.press('Escape')
  await tela.waitFor({ state: 'detached' })
  ok(await esperar(async () => (await p.evaluate(() => document.activeElement?.textContent?.trim())) === 'Ver as 4 raridades'), 'Esc fecha e o foco volta pro "Ver as 4 raridades"')
  ok((await versao()) === versaoAntes, 'o teste da animação não mexe em nada (a versão da loja continua a mesma)')

  // ─── o prêmio: a raridade nas fichas, a chance dele, o peso em "Mais detalhes" e o teste ──────────────────────
  await p.goto(`${BASE}/painel/#/loja/sorte/premio/bandeja-25`)
  await p.getByRole('heading', { name: 'Raridade', exact: true }).waitFor()
  const marcada = () => p.locator('#pr-raridade input:checked').getAttribute('value')
  ok((await marcada()) === 'epico', 'o prêmio de exemplo Épico abre com a ficha Épico marcada')
  const linhaChance = () => p.locator('.pn-chance-este').innerText()
  ok(/^Épico\s*Sai 1 em \d+ · [\d,]+% dos giros/.test(await linhaChance()), `a chance dele na tela (${await linhaChance()})`)
  ok((await p.locator('#pr-peso').count()) === 0 && /Peso dentro da raridade: 1/.test(await p.getByRole('button', { name: /^Mais detalhes/ }).innerText()), 'o peso fica em "Mais detalhes", fechado, dizendo o peso (1)')
  await ir('#s-pr-raridade')
  await axe(p, 'prêmio: raridade')
  await print(p, 'sorte-premio-raridade')
  const antes = await linhaChance()
  await p.locator('label.pn-ficha-rar').filter({ hasText: 'Lendário' }).tap()
  ok((await marcada()) === 'lendario' && (await linhaChance()) !== antes && /^Lendário/.test(await linhaChance()), `trocar pra Lendário: a chance muda na hora (${await linhaChance()})`)
  await p.getByRole('button', { name: /^Mais detalhes/ }).tap()
  ok((await p.locator('#pr-peso').inputValue()) === '1', '"Mais detalhes": o peso 1')
  await p.getByRole('button', { name: 'Testar a animação' }).tap()
  await tela.waitFor()
  ok((await palco.getAttribute('data-raridade')) === 'lendario' && (await tela.locator('.pn-teste-rars').count()) === 0, '"Testar a animação": a cena do prêmio com a raridade da tela (Lendário, ainda sem salvar), sem fichas')
  ok(await esperar(async () => (await palco.locator(':scope > *').count()) > 0 && (await palco.locator('.pn-teste-erro').count()) === 0), 'a revelação abre com o prêmio dele')
  await print(p, 'sorte-premio-teste')
  await tela.locator('.pn-teste-botoes').getByRole('button', { name: 'Fechar', exact: true }).tap()
  await tela.waitFor({ state: 'detached' })
  ok(await esperar(async () => (await p.evaluate(() => document.activeElement?.textContent?.trim())) === 'Testar a animação'), 'Fechar: o foco volta pro "Testar a animação"')
  await p.getByRole('button', { name: 'Salvar', exact: true }).tap()
  await p.getByRole('heading', { name: 'Com que frequência' }).waitFor()
  ok(await esperar(async () => (await loja()).sorte.premios.find((x) => x.id === 'bandeja-25')?.raridade === 'lendario'), 'salvou: o GET loja com o prêmio Lendário')
  ok((await p.locator('.pn-premio').filter({ hasText: /25% OFF/ }).first().getAttribute('data-raridade')) === 'lendario' || (await p.locator('.pn-premio[data-raridade="lendario"]').count()) === 2, 'a lista mostra os 2 Lendários')
  // volta pra Épico (o exemplo de fábrica)
  await p.goto(`${BASE}/painel/#/loja/sorte/premio/bandeja-25`)
  await p.getByRole('heading', { name: 'Raridade', exact: true }).waitFor()
  await p.locator('label.pn-ficha-rar').filter({ hasText: 'Épico' }).tap()
  await p.getByRole('button', { name: 'Salvar', exact: true }).tap()
  await p.getByRole('heading', { name: 'Com que frequência' }).waitFor()
  ok(await esperar(async () => (await loja()).sorte.premios.find((x) => x.id === 'bandeja-25')?.raridade === 'epico'), 'de volta a Épico')

  // ─── a Atividade em palavras ──────────────────────────────────────────────────────────────────────────────────
  await p.goto(`${BASE}/painel/#/atividade`)
  await p.getByRole('heading', { name: 'Hoje' }).waitFor()
  const atividade = await p.locator('.pn-eventos').first().innerText()
  for (const t of ['Mudou a frequência do Teste minha sorte: 2 giros por semana com conta', 'Mudou as chances das raridades: Comum 62,5%, Raro 25%, Épico 10%, Lendário 2,5%', 'Simulou 10.000 giros', 'Simulou 1.000 giros em MG', 'pra Lendário']) {
    ok(atividade.includes(t), `Atividade: "${t}"`)
  }

  // ─── no computador ────────────────────────────────────────────────────────────────────────────────────────────
  {
    const c = await browser.newContext({ viewport: { width: 1280, height: 800 }, storageState: await p.context().storageState(), locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' })
    const d = await c.newPage()
    await d.goto(`${BASE}/painel/#/loja/sorte`)
    await d.getByRole('heading', { name: 'Com que frequência' }).waitFor({ timeout: 20000 })
    const topos = await d.locator('label.pn-freq-op').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)))
    ok(topos.slice(0, 4).every((t) => t === topos[0]) && topos[4] > topos[0], `computador: os atalhos 4 por linha (${topos.join(', ')})`)
    ok(await d.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 0.5), 'computador: sem rolagem lateral')
    await axe(d, 'sorte: computador')
    await print(d, 'sorte-computador', true)
    await d.getByRole('button', { name: 'Ver as 4 raridades' }).click()
    const t = d.locator('.pn-folha-tela')
    await t.waitFor()
    const cx = await t.boundingBox()
    const visivel = await d.evaluate(() => [document.documentElement.clientWidth, innerHeight])
    ok(!!cx && cx.x <= 0.5 && cx.y <= 0.5 && cx.width >= visivel[0] - 20 && cx.height >= visivel[1] - 0.5, `computador: o teste cobre a tela (só a calha da barra de rolagem fica de fora: ${JSON.stringify(cx)} em ${visivel.join('×')})`)
    await print(d, 'sorte-computador-teste')
    await d.keyboard.press('Escape')
    await t.waitFor({ state: 'detached' })
    ok(true, 'computador: Esc fecha o teste')
    await c.close()
  }
}
