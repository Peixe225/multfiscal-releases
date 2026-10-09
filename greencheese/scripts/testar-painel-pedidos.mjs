// Pedidos, avisos no WhatsApp e textos do pedido guiado no painel, no navegador (Chromium do Playwright) contra o PHP de
// verdade. Chamado do fim do scripts/testar-painel.mjs; também roda sozinho (sobe o PHP e o preview do build):
//   node scripts/testar-painel-pedidos.mjs <pasta-do-build>   (termina com "pedidos no painel ok")
// Fluxo: pedidos chegam como o site manda (POST pedido) → Resumo conta os novos → lista (Em aberto, estado, busca) →
// pedido por dentro (itens, entrega, a mensagem com o código) → confirmar (toque duplo = 1 passo) → WhatsApp de quem
// pediu → anotação → saiu → entregue → desfazer → apagar os dados (LGPD); cancelar e reabrir; encomenda com o link do
// cliente. Avisos: webhook contra um servidor falso (assinatura HMAC do teste, segredo que nunca volta pro navegador,
// falha registrada e "Mandar de novo"), o Z-API com os campos conferidos antes de salvar. Textos: busca, editor com a
// prévia, marcador que não existe, promessa de prazo e tabaco recusados, salvar (o site recebe pelo GET com ETag) e
// voltar ao padrão. Em cada tela: axe, 320 px sem rolagem lateral e os prints dos 4 tamanhos (GC_PRINTS).
import { createHmac } from 'node:crypto'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { encomendaValida, pedidoValido } from './testar-api-pedidos.mjs'

/** Servidor falso do webhook: guarda o que chegou e responde o status de agora. */
async function servidorFalso() {
  const s = { chegou: [], status: 200 }
  const srv = createServer((req, res) => {
    let corpo = ''
    req.on('data', (c) => (corpo += c))
    req.on('end', () => {
      s.chegou.push({ caminho: req.url, cab: req.headers, corpo })
      res.writeHead(s.status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(s.status < 300 ? { ok: true } : { erro: 'falhou de propósito' }))
    })
  })
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok))
  s.porta = srv.address().port
  s.fechar = () => new Promise((ok) => srv.close(ok))
  return s
}

/**
 * Elementos que passam da borda da tela fora de um trilho que rola de lado (os filtros): o html corta o que sobra
 * (overflow-x: clip), então o scrollWidth não acusa, mas o texto sairia cortado.
 */
const cortados = (p) =>
  p.evaluate(() => {
    const noTrilho = (el) => {
      for (let e = el.parentElement; e; e = e.parentElement) if (/^(auto|scroll)$/.test(getComputedStyle(e).overflowX)) return true
      return false
    }
    return [...document.querySelectorAll('body *')]
      .filter((el) => {
        const b = el.getBoundingClientRect()
        return b.width > 1 && b.height > 1 && (b.right > innerWidth + 0.5 || b.left < -0.5) && !noTrilho(el)
      })
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ').join('.')} "${(el.textContent ?? '').trim().slice(0, 30)}"`)
  })

const esperar = async (cond, ms = 8000) => {
  const fim = Date.now() + ms
  while (Date.now() < fim) {
    if (await cond()) return true
    await new Promise((r) => setTimeout(r, 120))
  }
  return false
}

/**
 * @param {{ browser: import('playwright').Browser, novoContexto: (w: number, h: number, celular?: boolean) => Promise<import('playwright').BrowserContext>,
 *   BASE: string, ok: (c: unknown, m: string) => boolean, print: (p: import('playwright').Page, nome: string, cheia?: boolean) => Promise<void>,
 *   axe: (p: import('playwright').Page, nome: string) => Promise<void>, lateral: (p: import('playwright').Page) => Promise<boolean>,
 *   erros: string[], login: string, senha: string, nome: string, prints: string | null }} a
 */
export async function fluxoPedidos(a) {
  const { browser, novoContexto, BASE, ok, print, axe, lateral, erros, login, senha, prints } = a
  const primeiro = a.nome.split(' ')[0]
  const webhook = await servidorFalso()
  const site = (rota, corpo) =>
    fetch(`${BASE}/api/index.php?r=${rota}`, { method: corpo ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: corpo ? JSON.stringify(corpo) : undefined })
  const entrar = async (p) => {
    await p.goto(`${BASE}/painel/`)
    await p.getByLabel('Login').fill(login)
    await p.getByLabel('Senha', { exact: true }).fill(senha)
    await p.getByRole('button', { name: 'Entrar', exact: true }).click()
    await p.getByText(`Oi, ${primeiro}.`).waitFor()
  }
  const ctxs = []
  try {
    // ─── pedidos chegando como o site manda ───────────────────────────────────────────────────────────────────────
    const A = pedidoValido()
    const B = pedidoValido({
      uf: 'rj',
      cidade: 'Rio de Janeiro',
      nome: 'Fernanda Melo',
      whatsapp: '(21) 97777-1111',
      pagamento: 'dinheiro',
      troco: 200,
      obs: '',
      entrega: { endereco: 'Rua Barata Ribeiro, 300, bloco 2, Copacabana', rua: '', numero: '', bairro: '', cep: '', cidade: '', uf: '' },
      itens: [
        { produtoId: 'seda-ocb-premium-slim', nome: 'Seda OCB Premium Slim', variacao: null, qtd: 4, precoUnit: 9.99, total: 29.98, combo: '3 por R$ 19,99 + 1 avulsa' },
        { produtoId: null, nome: 'Isqueiro Clipper (cor sortida)', variacao: null, qtd: 1, precoUnit: null, total: null, combo: null },
      ],
      subtotal: 29.98,
      subtotalTexto: 'R$ 29,98 + itens a consultar',
      cupom: { codigo: 'SORTE-K8EA', regra: 'LEVA 4 PAGA 3 · Seda OCB Premium Slim', origem: 'Teste minha sorte' },
    })
    const C = encomendaValida()
    for (const x of [A, B, C]) {
      const r = await site('pedido', x)
      ok(r.status === 201, `pedido ${x.codigo} (${x.tipo}, ${x.uf.toUpperCase()}) chegou pelo POST pedido`)
    }

    // ─── Resumo ───────────────────────────────────────────────────────────────────────────────────────────────────
    const ctx = await novoContexto(390, 844)
    ctxs.push(ctx)
    const p = await ctx.newPage()
    p.on('pageerror', (e) => erros.push(`pedidos: ${e.message}`))
    await entrar(p)
    await p.getByRole('heading', { name: /^Pedidos novos/ }).waitFor()
    await p.waitForFunction(() => /Tem 3 pedidos novos/.test(document.querySelector('.pn-oi')?.textContent ?? ''), null, { timeout: 8000 }).catch(() => {})
    ok(/Tem 3 pedidos novos/.test(await p.locator('.pn-oi').innerText()), `resumo: a frase de cima conta os pedidos novos ("${(await p.locator('.pn-oi').innerText()).trim()}")`)
    const linhas = await p.locator('.pd-resumo-novos .pd-linha').allInnerTexts()
    ok(linhas.length === 3 && linhas[0].includes(C.codigo) && linhas[2].includes(A.codigo), 'resumo: os 3 novos, o mais novo primeiro (a encomenda por último que chegou)')
    ok(/Aviso no grupo do WhatsApp desligado/.test(await p.locator('.pd-resumo-novos').innerText()), 'resumo: avisa que o aviso no grupo tá desligado, com o "Ligar"')
    await axe(p, 'resumo com pedidos')
    await print(p, 'pedidos-resumo')

    // ─── lista ────────────────────────────────────────────────────────────────────────────────────────────────────
    await p.getByRole('link', { name: 'Ver pedidos' }).click()
    await p.getByRole('heading', { name: 'Pedidos', exact: true }).waitFor()
    await p.locator('.pd-lista .pd-linha').first().waitFor()
    const aberto = p.getByRole('button', { name: /^Em aberto/ })
    ok((await aberto.getAttribute('aria-pressed')) === 'true' && /3/.test(await aberto.innerText()), 'lista: abre no "Em aberto" (3)')
    ok((await p.getByRole('button', { name: /^Confirmados/ }).count()) === 0, 'lista: status sem pedido sai dos filtros')
    const ufs = await p.getByLabel('Estado').locator('option').allInnerTexts()
    ok(ufs.join() === 'Todos os estados,MG,RJ', `lista: filtro de estado com os que tiveram pedido (${ufs.join(', ')})`)
    await p.getByLabel('Estado').selectOption('rj')
    await p.waitForFunction(() => location.hash.includes('uf=rj') && document.querySelectorAll('.pd-lista .pd-linha').length === 2, null, { timeout: 8000 }).catch(() => {})
    ok((await p.locator('.pd-lista .pd-linha').count()) === 2 && p.url().includes('uf=rj'), 'lista: só RJ (2) e o estado fica no endereço')
    await p.getByLabel('Estado').selectOption('')
    await p.getByLabel('Buscar pedido').fill(A.codigo.slice(3))
    await p.waitForFunction((c) => document.querySelectorAll('.pd-lista .pd-linha').length === 1 && document.querySelector('.pd-lista')?.textContent?.includes(c), A.codigo, { timeout: 8000 }).catch(() => {})
    ok((await p.locator('.pd-lista .pd-linha').count()) === 1, 'lista: a busca acha pelo código sem o "GC-"')
    await p.getByLabel('Buscar pedido').fill('')
    await p.locator('.pd-lista .pd-linha').nth(2).waitFor()
    await axe(p, 'lista de pedidos')
    await print(p, 'pedidos-lista')

    // ─── pedido por dentro ────────────────────────────────────────────────────────────────────────────────────────
    await p.locator('.pd-linha', { hasText: A.codigo }).click()
    await p.getByRole('heading', { name: `Pedido ${A.codigo}` }).waitFor()
    const det = await p.locator('.pd-detalhe').innerText()
    ok(/R\$ 169,89/.test(det) && /combo 3 por R\$ 19,99/.test(det) && /CEP 39800-000/.test(det) && /Portão azul/.test(det) && /Pix/.test(det), 'pedido: itens com o combo, subtotal, endereço com CEP, Pix e a observação')
    ok((await p.getByRole('link', { name: /Ver no mapa/ }).count()) === 1, 'pedido: "Ver no mapa" do endereço')
    await p.getByText('Ver a mensagem', { exact: true }).click()
    ok((await p.locator('.pd-msg').innerText()).includes(`Código: ${A.codigo}`), 'pedido: a mensagem do WhatsApp guardada, com a linha do código')
    const zap1 = await p.locator('.pd-zap a').getAttribute('href')
    ok(zap1.startsWith('https://wa.me/?text=') && decodeURIComponent(zap1).includes(A.codigo), 'pedido sem o WhatsApp do cliente: o botão abre o WhatsApp pra escolher a conversa, com o código na mensagem')
    await axe(p, 'pedido novo')
    await print(p, 'pedidos-detalhe-novo')
    // toque duplo no "Confirmar pedido": um passo só
    let status = 0
    p.on('request', (r) => r.url().includes('admin-pedido-status') && status++)
    await p.getByRole('button', { name: 'Confirmar pedido' }).evaluate((el) => {
      el.click()
      el.click()
    })
    await p.getByRole('heading', { name: 'Status: confirmado' }).waitFor()
    await p.waitForTimeout(400)
    ok(status === 1, `toque duplo no "Confirmar pedido": ${status} pedido ao servidor`)
    ok((await p.locator('.pd-zap-msg').innerText()).includes('tá confirmado ✅'), 'confirmado: a mensagem pronta muda pro passo novo')
    // WhatsApp de quem pediu (veio na conversa)
    await p.getByRole('button', { name: 'Guardar o WhatsApp de quem pediu' }).click()
    await p.getByLabel('WhatsApp de quem pediu').fill('3312')
    await p.getByRole('button', { name: 'Salvar', exact: true }).click()
    ok(/Falta número/.test(await p.locator('#pd-whats-erro').innerText().catch(() => '')), 'WhatsApp incompleto: diz o que falta, sem ir pro servidor')
    await p.getByLabel('WhatsApp de quem pediu').fill('(33) 99876-5432')
    await p.getByRole('button', { name: 'Salvar', exact: true }).click()
    await p.locator('.pd-zap a[href^="https://wa.me/5533998765432"]').waitFor()
    ok((await p.locator('.pd-zap a').innerText()).includes('Avisar que confirmou'), 'com o WhatsApp guardado, o botão abre a conversa dele: "Avisar que confirmou"')
    // anotação
    await p.getByRole('textbox', { name: 'Anotação da loja' }).fill('Tocar a campainha do fundo')
    await p.getByRole('button', { name: 'Salvar a anotação' }).click()
    await p.getByText('Anotação salva.').waitFor()
    ok(true, 'anotação salva')
    // saiu → entregue (o botão do passo seguinte espera um instante: o toque duplo não pula dois passos)
    const passo = async (nome, titulo) => {
      await p.waitForFunction(() => !document.querySelector('.pd-acoes .pn-botao[aria-busy="true"]'), null, { timeout: 5000 })
      await p.getByRole('button', { name: nome, exact: true }).click()
      await p.getByRole('heading', { name: titulo }).waitFor()
    }
    await passo('Saiu pra entrega', 'Status: saiu pra entrega')
    await passo('Marcar entregue', 'Status: entregue')
    ok((await p.locator('.pd-zap a').innerText()).includes('Agradecer no WhatsApp'), 'entregue: "Agradecer no WhatsApp" com a mensagem pronta')
    await p.getByRole('button', { name: 'Desfazer a entrega' }).click()
    await p.getByRole('alertdialog').getByRole('button', { name: 'Desfazer a entrega' }).click()
    await p.getByRole('heading', { name: 'Status: saiu pra entrega' }).waitFor()
    ok(true, 'desfazer a entrega (com confirmação) volta pra "saiu pra entrega"')
    await passo('Marcar entregue', 'Status: entregue')
    await print(p, 'pedidos-detalhe-entregue', true)
    // apagar os dados (LGPD)
    await p.getByRole('button', { name: 'Apagar os dados (LGPD)' }).click()
    await p.getByRole('alertdialog').getByRole('button', { name: 'Apagar os dados' }).click()
    await p.getByText('Os dados de quem pediu foram apagados (LGPD).').waitFor()
    const apagado = await p.locator('.pd-detalhe').innerText()
    ok(/Dados apagados/.test(apagado) && !apagado.includes('Portão azul') && !apagado.includes('Tocar a campainha') && /R\$ 169,89/.test(apagado), 'apagar os dados: nome, endereço, observação e anotação saem; itens e valores ficam')

    // cancelar e reabrir (B)
    await p.goto(`${BASE}/painel/#/pedidos?status=todos`)
    await p.locator('.pd-linha', { hasText: B.codigo }).click()
    await p.getByRole('heading', { name: `Pedido ${B.codigo}` }).waitFor()
    const detB = await p.locator('.pd-detalhe').innerText()
    ok(/troco pra R\$ 200,00/.test(detB) && /SORTE-K8EA/.test(detB) && /a consultar/.test(detB) && /Copacabana/.test(detB), 'pedido B: dinheiro com troco, cupom, item a consultar e o endereço sem CEP')
    ok((await p.locator('.pd-zap a').getAttribute('href')).startsWith('https://wa.me/5521977771111'), 'pedido B: com o WhatsApp que veio do site, o botão já abre a conversa')
    await p.getByRole('button', { name: 'Cancelar o pedido' }).click()
    await axe(p, 'confirmar o cancelamento')
    await p.getByRole('alertdialog').getByRole('button', { name: 'Cancelar o pedido' }).click()
    await p.getByRole('heading', { name: 'Status: cancelado' }).waitFor()
    ok((await p.locator('.pd-zap a').innerText()).includes('Avisar que cancelou'), 'cancelado: a mensagem pronta do cancelamento')
    await p.getByRole('button', { name: 'Reabrir', exact: true }).click()
    await p.getByRole('alertdialog').getByRole('button', { name: 'Reabrir' }).click()
    await p.getByRole('heading', { name: 'Status: novo' }).waitFor()
    ok(true, 'reabrir (com confirmação) volta pra novo')

    // encomenda (C): o produto, a quantidade e o link do cliente (sem passar quem abriu)
    await p.goto(`${BASE}/painel/#/pedidos`)
    await p.locator('.pd-linha', { hasText: C.codigo }).click()
    await p.getByRole('heading', { name: `Encomenda ${C.codigo}` }).waitFor()
    const ref = p.locator('.pd-detalhe a[href="https://exemplo.com/fanta"]')
    ok((await ref.count()) === 1 && (await ref.getAttribute('rel')) === 'noopener noreferrer nofollow' && (await p.getByText('Fanta de uva japonesa').count()) > 0, 'encomenda: produto, quantidade e o link do cliente (noopener, noreferrer, nofollow)')
    ok((await p.getByRole('button', { name: 'Confirmar encomenda' }).count()) === 1, 'encomenda: "Confirmar encomenda"')
    await axe(p, 'encomenda')
    await print(p, 'pedidos-encomenda')

    // ─── avisos no WhatsApp ───────────────────────────────────────────────────────────────────────────────────────
    await p.goto(`${BASE}/painel/#/avisos`)
    await p.getByRole('heading', { name: 'Avisos no WhatsApp' }).waitFor()
    await p.locator('.pd-situacao').waitFor()
    ok(/Desligado/.test(await p.locator('.pd-situacao').innerText()), 'avisos: começa desligado')
    await axe(p, 'avisos desligado')
    await print(p, 'avisos-desligado')
    // Z-API: os campos são conferidos antes de ir pro servidor
    await p.getByRole('radio', { name: /^Z-API/ }).check()
    await p.getByRole('button', { name: 'Salvar', exact: true }).click()
    ok((await p.evaluate(() => document.activeElement?.id)) === 'av-zapi-instancia' && /Falta o ID da instância/.test(await p.locator('#av-zapi-instancia-erro').innerText()), 'Z-API sem instância: o erro no campo e o foco nele')
    await p.getByLabel('ID da instância').fill('3C4F2A9B8E')
    await p.getByLabel('Token da instância').fill('token123456')
    await p.getByRole('button', { name: 'Salvar', exact: true }).click()
    ok((await p.evaluate(() => document.activeElement?.id)) === 'av-destino' && /ID do grupo/.test(await p.locator('#av-destino-erro').innerText()), 'Z-API sem o grupo: pede o ID do grupo')
    await axe(p, 'avisos z-api com erro')
    await print(p, 'avisos-zapi-erro')
    // webhook contra o servidor falso
    await p.getByRole('radio', { name: /^Webhook/ }).check()
    await p.getByLabel('Endereço do webhook').fill(`http://127.0.0.1:${webhook.porta}/gancho`)
    await p.getByRole('button', { name: 'Gerar', exact: true }).click()
    const segredo = await p.getByLabel('Segredo', { exact: true }).inputValue()
    ok(/^[A-Za-z0-9_-]{32}$/.test(segredo), 'webhook: "Gerar" põe um segredo forte no campo (pra copiar antes de salvar)')
    const [resp] = await Promise.all([p.waitForResponse((r) => r.url().includes('admin-avisos-salvar')), p.getByRole('button', { name: 'Salvar', exact: true }).click()])
    const corpoSalvo = await resp.text()
    await p.getByText(/^Salvo\. Os avisos saem pelo Webhook/).waitFor()
    ok(!corpoSalvo.includes(segredo) && !corpoSalvo.includes('/gancho'), 'salvar: o segredo e o caminho do webhook não voltam pro navegador')
    ok((await p.locator('.pd-guardado').first().innerText()).includes(`•••${segredo.slice(-4)}`), `o painel mostra só o final do segredo (•••${segredo.slice(-4)})`)
    const leitura = await p.evaluate(async () => (await fetch('../api/index.php?r=admin-avisos')).text())
    ok(!leitura.includes(segredo) && !leitura.includes('/gancho'), 'GET admin-avisos: segredo nunca volta inteiro')
    // teste: chega no servidor falso, assinado
    await p.getByRole('button', { name: 'Enviar teste' }).click()
    await p.getByText(/^A mensagem de teste saiu pelo Webhook/).waitFor({ timeout: 15000 })
    const teste = webhook.chegou.at(-1)
    const assinatura = teste ? createHmac('sha256', segredo).update(teste.corpo).digest('hex') : ''
    ok(!!teste && teste.caminho === '/gancho' && teste.cab['x-gc-assinatura'] === assinatura && JSON.parse(teste.corpo).tipo === 'teste', 'teste: o webhook recebe { tipo: "teste", … } com a assinatura HMAC do segredo')
    await p.locator('.pd-envio', { hasText: 'Mensagem de teste' }).first().waitFor()
    ok(/Enviado/.test(await p.locator('.pd-envio', { hasText: 'Mensagem de teste' }).first().innerText()), 'histórico: a mensagem de teste "Enviado"')
    // pedido novo com o webhook fora do ar: o aviso falha, fica no histórico e vai de novo pelo painel
    webhook.status = 500
    const D = pedidoValido({ nome: 'Carlos Pereira' })
    ok((await site('pedido', D)).status === 201, 'pedido D chegou com o webhook fora do ar')
    ok(await esperar(() => webhook.chegou.some((x) => x.corpo.includes(D.codigo))), 'o aviso do pedido D tentou sair (depois da resposta do site)')
    await p.reload()
    const linhaD = p.locator('.pd-envio', { hasText: `Pedido ${D.codigo}` })
    await linhaD.waitFor()
    ok(/Não foi \(1 tentativa\)/.test(await linhaD.innerText()) && /HTTP 500|500/.test(await linhaD.innerText()), `histórico: o aviso que não foi, com o porquê (${(await linhaD.innerText()).replace(/\s+/g, ' ').slice(0, 120)})`)
    await axe(p, 'avisos com falha')
    await print(p, 'avisos-falha', true)
    webhook.status = 200
    await linhaD.getByRole('button', { name: /Mandar de novo/ }).click()
    await p.waitForFunction((c) => [...document.querySelectorAll('.pd-envio')].some((e) => e.textContent.includes(`Pedido ${c}`) && /Enviado/.test(e.textContent)), D.codigo, { timeout: 15000 })
    ok(true, '"Mandar de novo": o aviso vai e fica "Enviado"')
    const doGrupo = JSON.parse(webhook.chegou.at(-1).corpo)
    ok(doGrupo.tipo === 'pedido' && doGrupo.texto.startsWith(`*NOVO PEDIDO* · #${D.codigo}`) && /Painel: http:\/\/127\.0\.0\.1:\d+\/painel\/#\/pedido\/\d+/.test(doGrupo.texto) && doGrupo.dados?.pedido?.codigo === D.codigo, 'o webhook recebe o texto do grupo (com o link do painel) e o pedido inteiro')
    // o Resumo mostra o aviso que não foi enquanto ele não sai? (agora saiu: nada de alerta)
    await p.goto(`${BASE}/painel/#/`)
    await p.getByRole('heading', { name: /^Pedidos novos/ }).waitFor()
    ok((await p.locator('.pd-resumo-alerta').count()) === 0, 'resumo: sem alerta de aviso depois que ele foi')

    // ─── textos do pedido ─────────────────────────────────────────────────────────────────────────────────────────
    await p.goto(`${BASE}/painel/#/textos`)
    await p.getByRole('heading', { name: 'Textos do pedido' }).waitFor()
    await p.locator('.pd-grupo').first().waitFor()
    ok((await p.locator('.pd-grupo[open]').count()) === 0 && (await p.locator('.pd-grupo').count()) === 10, 'textos: 10 grupos, fechados')
    await axe(p, 'textos')
    await print(p, 'textos-lista')
    await p.getByLabel('Buscar fala').fill('atendimento')
    await p.locator('.pd-grupo[open] .pd-fala').first().waitFor()
    ok((await p.locator('.pd-grupo[open]').count()) >= 1, 'textos: a busca abre os grupos com o que achou')
    const versao0 = (await site('pedido-textos')).headers.get('etag')
    await p.locator('.pd-fala', { hasText: 'Confirma o atendimento' }).first().click()
    const folha = p.getByRole('dialog', { name: 'Confirma o atendimento' })
    await folha.waitFor()
    ok((await folha.locator('.pd-editor-previa').innerText()).includes('Teófilo Otoni (MG)'), 'editor: a prévia com o exemplo no marcador')
    const campo = folha.getByLabel('Texto', { exact: true })
    await campo.fill('Vai pro atendimento de {bairro}?')
    ok(/\{bairro\} não existe aqui/.test(await folha.locator('.pn-erro').innerText()), 'editor: marcador que não existe é recusado na hora')
    await campo.fill('Entrega hoje mesmo em {lugar}?')
    ok(/Sem promessa de prazo ou frete/.test(await folha.locator('.pn-erro').innerText()), 'editor: promessa de prazo recusada')
    await campo.fill('Cigarro em {lugar}?')
    ok(/Tabaco e vape/.test(await folha.locator('.pn-erro').innerText()), 'editor: tabaco recusado')
    await campo.fill('Bora fechar o pedido em ')
    await folha.getByRole('button', { name: /\{lugar\}/ }).click()
    await campo.press('End')
    await campo.pressSequentially('?')
    ok((await campo.inputValue()) === 'Bora fechar o pedido em {lugar}?', `editor: o marcador entra com um toque (${await campo.inputValue()})`)
    ok((await folha.locator('.pd-editor-previa').innerText()).includes('Bora fechar o pedido em Teófilo Otoni (MG)?'), 'editor: a prévia acompanha')
    await axe(p, 'editor de fala')
    await print(p, 'textos-editor')
    await folha.getByRole('button', { name: 'Salvar', exact: true }).click()
    await p.getByText(/^Fala trocada/).waitFor()
    ok((await p.getByRole('button', { name: /^Trocadas/ }).innerText()).includes('1'), 'textos: "Trocadas 1"')
    const pub = await site('pedido-textos')
    const pubJson = await pub.json()
    const versao1 = pub.headers.get('etag')
    ok(pubJson.textos['local.confirmar'] === 'Bora fechar o pedido em {lugar}?' && versao1 && versao1 !== versao0, 'o site recebe a fala trocada pelo GET pedido-textos, com versão nova')
    const igual = await fetch(`${BASE}/api/index.php?r=pedido-textos`, { headers: { 'If-None-Match': versao1 } })
    ok(igual.status === 304, 'GET pedido-textos com a mesma versão: 304')
    await p.locator('.pd-fala', { hasText: 'Confirma o atendimento' }).first().click()
    await folha.waitFor()
    await folha.getByRole('button', { name: 'Voltar ao padrão' }).click()
    await p.getByText('Voltou ao texto de sempre.').waitFor()
    ok(Object.keys((await (await site('pedido-textos')).json()).textos).length === 0, 'voltar ao padrão: o site volta pro texto de sempre')

    // ─── Atividade ────────────────────────────────────────────────────────────────────────────────────────────────
    await p.goto(`${BASE}/painel/#/atividade`)
    await p.getByRole('heading', { name: 'Hoje' }).waitFor()
    const atividade = await p.locator('.pn-eventos').first().innerText()
    ok(atividade.includes(`Confirmou o pedido ${A.codigo}`) && atividade.includes('Ajustou os avisos no WhatsApp') && atividade.includes('do pedido guiado'), 'Atividade: pedidos, avisos e falas na linha do tempo')

    // ─── 320 px e os 4 tamanhos ───────────────────────────────────────────────────────────────────────────────────
    const lista = await (await p.evaluate(async () => (await fetch('../api/index.php?r=admin-pedidos&status=todos')).text()))
    const ids = JSON.parse(lista).pedidos.map((x) => x.id)
    const telas = [
      ['resumo', '#/'],
      ['lista', '#/pedidos'],
      ['detalhe', `#/pedido/${ids.at(-2)}`],
      // a encomenda, sem o WhatsApp de quem pediu (o botão de guardar o número)
      ['encomenda', `#/pedido/${ids.at(-3)}`],
      ['avisos', '#/avisos'],
      ['textos', '#/textos'],
    ]
    await ctx.close()
    for (const [w, h] of [[320, 568], [360, 740], [390, 844], [430, 932], [1440, 900]]) {
      const c = await novoContexto(w, h, w < 900)
      ctxs.push(c)
      const q = await c.newPage()
      q.on('pageerror', (e) => erros.push(`pedidos ${w}: ${e.message}`))
      await entrar(q)
      let todas = true
      for (const [nome, rota] of telas) {
        await q.goto(`${BASE}/painel/${rota}`)
        await q.locator('.pn-carregando').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {})
        await q.waitForTimeout(500)
        if (!(await lateral(q))) {
          todas = false
          ok(false, `${w}×${h} ${rota}: rolagem lateral`)
        }
        const fora = await cortados(q)
        if (fora.length) {
          todas = false
          ok(false, `${w}×${h} ${rota}: passa da borda (cortado): ${fora.slice(0, 4).join(' · ')}`)
        }
        if (prints && w !== 320) await q.screenshot({ path: join(prints, `pedidos-${nome}-${w}x${h}.png`), fullPage: true })
      }
      if (w === 320) {
        // o editor de fala também cabe
        await q.goto(`${BASE}/painel/#/textos`)
        await q.getByLabel('Buscar fala').fill('troco')
        await q.locator('.pd-grupo[open] .pd-fala').first().click()
        await q.getByRole('dialog').waitFor()
        await q.waitForTimeout(300)
        const cabe = await q.evaluate(() => {
          const corpo = document.querySelector('.pn-folha-corpo')
          return !!corpo && corpo.scrollWidth <= corpo.clientWidth + 0.5 && document.documentElement.scrollWidth <= innerWidth + 0.5
        })
        ok(cabe && (await cortados(q)).length === 0, '320 px: o editor de fala não rola pro lado nem corta nada')
      }
      ok(todas, `${w}×${h}: pedidos, pedido, avisos e textos sem rolagem lateral e sem nada cortado na borda`)
      await c.close()
    }
  } finally {
    for (const c of ctxs) await c.close().catch(() => {})
    await webhook.fechar()
  }
}

// ─── sozinho: sobe o PHP (pasta de dados temporária) e o preview do build ─────────────────────────────────────────
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { spawn } = await import('node:child_process')
  const { existsSync, mkdtempSync, rmSync } = await import('node:fs')
  const { createServer: servidorNet } = await import('node:net')
  const { tmpdir } = await import('node:os')
  const { resolve } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const raiz = fileURLToPath(new URL('..', import.meta.url))
  const build = process.argv[2] ? resolve(process.argv[2]) : null
  if (!build || !existsSync(join(build, 'painel', 'index.html'))) {
    console.error('uso: node scripts/testar-painel-pedidos.mjs <pasta-do-build> (com painel/index.html)')
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
  const livre = () =>
    new Promise((res) => {
      const s = servidorNet().listen(0, '127.0.0.1', () => {
        const pt = s.address().port
        s.close(() => res(pt))
      })
    })
  const portaPhp = process.env.GC_TESTE_PORTA ? Number(process.env.GC_TESTE_PORTA) : await livre()
  const portaSite = process.env.GC_TESTE_PORTA ? portaPhp + 1 : await livre()
  const BASE = `http://127.0.0.1:${portaSite}`
  const dados = mkdtempSync(join(tmpdir(), 'gc-painel-pedidos-'))
  const filhos = []
  const derrubar = () => filhos.forEach((f) => {
    try {
      process.kill(-f.pid, 'SIGTERM')
    } catch {
      /* já saiu */
    }
  })
  process.on('exit', derrubar)
  filhos.push(spawn(process.env.PHP ?? 'php', ['-d', 'display_errors=0', '-S', `127.0.0.1:${portaPhp}`, '-t', join(raiz, 'public'), join(raiz, 'scripts', 'api-dev.php')], { env: { ...process.env, PHP_CLI_SERVER_WORKERS: '4', GC_DADOS: dados, GC_UPLOADS: join(dados, 'uploads') }, stdio: 'ignore', detached: true }))
  filhos.push(spawn(process.execPath, [join(raiz, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--outDir', build, '--port', String(portaSite), '--strictPort', '--host', '127.0.0.1'], { cwd: raiz, env: { ...process.env, GC_API_PORTA: String(portaPhp) }, stdio: 'ignore', detached: true }))
  for (let i = 0; i < 150; i++) {
    if (await fetch(`${BASE}/api/index.php?r=admin-sessao`).then((r) => r.ok, () => false)) break
    await new Promise((r) => setTimeout(r, 100))
  }
  const inst = await fetch(`${BASE}/api/index.php?r=admin-instalar`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify({ codigo: 'dev-instalar-greencheese', nome: 'Dono da Green', login: 'dono', senha: 'senha-forte-123' }) })
  ok(inst.status === 201, 'painel instalado pra rodada')
  const browser = await chromium.launch()
  const erros = []
  const novoContexto = async (w, h, celular = true) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: celular ? 3 : 1, isMobile: celular, hasTouch: celular, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' })
    await ctx.route('https://wa.me/**', (r) => r.fulfill({ body: 'whatsapp' }))
    return ctx
  }
  const print = async (p, nome, cheia = false) => {
    if (PRINTS) await p.screenshot({ path: join(PRINTS, `${nome}.png`), fullPage: cheia })
  }
  const axe = async (p, nome) => {
    if (!AXE) return
    await p.addScriptTag({ path: AXE })
    const v = await p.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations.map((x) => `${x.id} (${x.nodes.length}: ${x.nodes.map((n) => n.target.join(' ')).join(', ').slice(0, 200)})`))
    ok(v.length === 0, `axe ${nome}: ${v.join(', ') || '0 violações'}`)
  }
  const lateral = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 0.5)
  try {
    await fluxoPedidos({ browser, novoContexto, BASE, ok, print, axe, lateral, erros, login: 'dono', senha: 'senha-forte-123', nome: 'Dono da Green', prints: PRINTS })
  } catch (e) {
    ok(false, `exceção: ${e.stack}`)
    for (const c of browser.contexts()) for (const pg of c.pages()) if (PRINTS) await pg.screenshot({ path: join(PRINTS, `falha-pedidos-${Date.now()}.png`) }).catch(() => {})
  } finally {
    await browser.close()
    derrubar()
    rmSync(dados, { recursive: true, force: true })
  }
  ok(erros.length === 0, `sem erro de JavaScript na página (${erros.join(' | ') || 'nenhum'})`)
  console.log(falhas ? `${falhas} problema(s) em ${checagens} checagens` : `${checagens} checagens · pedidos no painel ok`)
  process.exit(falhas ? 1 : 0)
}
