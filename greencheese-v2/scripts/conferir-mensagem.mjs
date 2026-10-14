// Confere a mensagem do pedido (src/lib/mensagem.ts) sem abrir o navegador.
// - Sem cupom, a mensagem tem que ficar byte a byte igual à referência (scripts/mensagem-referencia.txt), gerada
//   ANTES do cupom existir: o formato que a loja já conhece não muda.
// - Com cupom, entra UMA linha só, logo depois de "Subtotal:".
// - Com o código do pedido (GC-XXXXX, o que o painel e o grupo do WhatsApp usam), entra UMA linha logo depois do
//   cabeçalho ("Código: GC-7KD2X"); o resto fica igual (no pedido, com ou sem cupom, e na encomenda).
// - Rateio: a mensagem da vaga reservada (com o código), a de quem entra pelo WhatsApp sem servidor (sem código), a
//   de quem já tem vaga (ja-participa: só o código, sem conta de vagas que o site não sabe) e a da loja fora do ar
//   (a aba sem os rateios, ou a página de um, com o link).
// - Sacola (o caminho direto, 14/10): a mensagem que abre no WhatsApp num toque, sem nome, endereço nem pagamento,
//   byte a byte igual a scripts/mensagem-sacola-referencia.txt; o código, o cupom, o nome da conta e a entrega mudam só a
//   linha deles; e o pedido mínimo pra entrega (src/lib/pedido-minimo.ts): falta, fecha, a consultar e o cupom.
// Uso: node scripts/conferir-mensagem.mjs                     → confere
//      node scripts/conferir-mensagem.mjs --gravar            → (re)grava o modelo da sacola
//      node scripts/conferir-mensagem.mjs --gravar --guiado   → e o do guiado (só quando o formato mudar de propósito)
import { rolldown } from 'rolldown'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const raiz = new URL('../', import.meta.url).pathname
const refArq = join(raiz, 'scripts/mensagem-referencia.txt')
// a mensagem da sacola (o caminho direto, 14/10): um modelo à parte, o do guiado continua o de sempre
const refSacolaArq = join(raiz, 'scripts/mensagem-sacola-referencia.txt')

// empacota mensagem.ts (e o que ele importa) num .mjs temporário; e o pedido mínimo (src/lib/pedido-minimo.ts)
async function carregar(arquivo) {
  const tmp = mkdtempSync(join(tmpdir(), 'gc-mensagem-'))
  const saida = join(tmp, 'm.mjs')
  const pacote = await rolldown({ input: join(raiz, arquivo), logLevel: 'silent' })
  await pacote.write({ file: saida, format: 'esm' })
  await pacote.close()
  const mod = await import(pathToFileURL(saida).href)
  rmSync(tmp, { recursive: true, force: true })
  return mod
}
const m = await carregar('src/lib/mensagem.ts')
const pm = await carregar('src/lib/pedido-minimo.ts')

// pedido de referência fixo: canal RJ, 2 linhas (com combo), nome, endereço, pix
const canal = {
  uf: 'rj',
  nome: 'Rio de Janeiro',
  destaque: 'DELIVERY RJ',
  nomePerfil: 'GREEN CHEESE LTDA',
  cidades: [{ slug: 'rio-de-janeiro', nome: 'Rio de Janeiro' }],
  instagram: 'greencheese_importsrj',
  whatsapp: null,
  horario: { semana: [null, null, null, null, null, null, null], demo: true },
  taxaEntrega: { valor: 10, demo: true },
  entregaGratis: null,
  pagamento: { opcoes: ['pix'], demo: true },
  emblema: 'pao-de-acucar',
}
const jack = { id: 'jack-daniels-old-no7-1l', nome: "Jack Daniel's Old No. 7", tamanho: '1 L', categoria: 'destilados', preco: 149.9, disponivel: {}, demo: false, foto: null, cor: '#000', arte: { tipo: 'garrafa-quadrada', corpo: '#000' } }
const ocb = {
  id: 'seda-ocb-premium-slim',
  nome: 'Seda OCB Premium Slim',
  categoria: 'sedas',
  preco: 9.99,
  combos: [
    { qtd: 2, total: 14.99 },
    { qtd: 3, total: 19.99 },
  ],
  disponivel: {},
  demo: false,
  foto: null,
  cor: '#000',
  arte: { tipo: 'seda', corpo: '#000' },
}
const pedido = {
  canal,
  cidade: 'Rio de Janeiro',
  linhas: [
    { produto: jack, qtd: 1 },
    { produto: ocb, qtd: 4 },
  ],
  nome: 'Ian Teste',
  endereco: 'Rua Barata Ribeiro, 120, apto 201, Copacabana',
  pagamento: 'pix',
  troco: null,
  obs: 'Portão azul',
}

const sem = m.montarPedido(pedido)
// a sacola: as mesmas linhas, sem nome, endereço nem pagamento (o cliente manda na conversa)
const sacola = { canal, cidade: 'Rio de Janeiro', linhas: pedido.linhas }
const semSacola = m.montarPedidoSacola(sacola)

if (process.argv.includes('--gravar')) {
  // o do guiado só se o formato dele mudou de propósito (--guiado); o da sacola nasce aqui
  if (process.argv.includes('--guiado')) writeFileSync(refArq, sem)
  writeFileSync(refSacolaArq, semSacola)
  console.log(`modelo da sacola gravado em scripts/mensagem-sacola-referencia.txt:\n${semSacola}`)
  process.exit(0)
}

const problemas = []
if (!existsSync(refArq)) problemas.push('falta scripts/mensagem-referencia.txt (rode com --gravar antes de mexer no formato)')
else if (readFileSync(refArq, 'utf8') !== sem) problemas.push(`sem cupom, a mensagem mudou:\n--- referência\n${readFileSync(refArq, 'utf8')}\n--- agora\n${sem}`)

const cupom = { codigo: 'SORTE-AB12', regra: 'Leva 4 Seda OCB Premium Slim e paga 3', origem: 'Teste minha sorte', exemplo: true }
const com = m.montarPedido({ ...pedido, cupom })
const a = sem.split('\n')
const b = com.split('\n')
const iSub = a.findIndex((l) => l.startsWith('Subtotal:'))
const esperada = 'Cupom: SORTE-AB12 — Leva 4 Seda OCB Premium Slim e paga 3 (Teste minha sorte · exemplo · a loja confirma)'
if (b.length !== a.length + 1) problemas.push(`com cupom, eram ${a.length + 1} linhas e vieram ${b.length}`)
if (b[iSub + 1] !== esperada) problemas.push(`com cupom, a linha depois do Subtotal veio "${b[iSub + 1]}"`)
const semALinha = [...b.slice(0, iSub + 1), ...b.slice(iSub + 2)].join('\n')
if (semALinha !== sem) problemas.push('com cupom, alguma outra linha mudou')
const oficial = m.montarPedido({ ...pedido, cupom: { ...cupom, exemplo: false } }).split('\n')[iSub + 1]
if (oficial !== 'Cupom: SORTE-AB12 — Leva 4 Seda OCB Premium Slim e paga 3 (Teste minha sorte · a loja confirma)') problemas.push(`linha oficial veio "${oficial}"`)
// o subtotal nunca é recalculado com o cupom
if (a[iSub] !== b[iSub]) problemas.push('o subtotal mudou com o cupom')

// a entrega que o painel pôs: com a taxa de exemplo é "taxa a confirmar" (a referência); com taxa de verdade, o valor;
// no dia da entrega grátis, "entrega grátis hoje". Só a linha da Entrega muda.
const sexta = new Date(2026, 9, 9, 15)
const iEnt = a.findIndex((l) => l.startsWith('Entrega:'))
const entregaCom = (c, agora = sexta) => m.montarPedido({ ...pedido, canal: { ...canal, ...c }, agora }).split('\n')
const comTaxa = entregaCom({ taxaEntrega: { valor: 15.5, demo: false } })
if (comTaxa[iEnt] !== 'Entrega: Rua Barata Ribeiro, 120, apto 201, Copacabana (taxa R$ 15,50)') problemas.push(`entrega com a taxa do painel veio "${comTaxa[iEnt]}"`)
if (comTaxa.filter((l, i) => i !== iEnt).join('\n') !== a.filter((l, i) => i !== iEnt).join('\n')) problemas.push('com a taxa do painel, outra linha mudou')
const gratis = { taxaEntrega: { valor: 15.5, demo: false }, entregaGratis: { dias: [2, 5], texto: 'Terça e sexta sem taxa!', demo: false } }
const naSexta = entregaCom(gratis)[iEnt]
if (naSexta !== 'Entrega: Rua Barata Ribeiro, 120, apto 201, Copacabana (entrega grátis hoje)') problemas.push(`entrega no dia grátis veio "${naSexta}"`)
const naQuinta = entregaCom(gratis, new Date(2026, 9, 8, 15))[iEnt]
if (naQuinta !== 'Entrega: Rua Barata Ribeiro, 120, apto 201, Copacabana (taxa R$ 15,50)') problemas.push(`entrega fora do dia grátis veio "${naQuinta}"`)
if (entregaCom({ taxaEntrega: { valor: null, demo: false } })[iEnt] !== a[iEnt]) problemas.push('taxa "a confirmar" de verdade não ficou "taxa a confirmar"')
// taxa R$ 0,00 do painel: a entrega não tem taxa ("entrega grátis"), nunca "taxa R$ 0,00"; só a linha da Entrega muda
const taxaZero = entregaCom({ taxaEntrega: { valor: 0, demo: false } })
if (taxaZero[iEnt] !== 'Entrega: Rua Barata Ribeiro, 120, apto 201, Copacabana (entrega grátis)') problemas.push(`entrega com taxa R$ 0,00 veio "${taxaZero[iEnt]}"`)
if (taxaZero.filter((l, i) => i !== iEnt).join('\n') !== a.filter((l, i) => i !== iEnt).join('\n')) problemas.push('com a taxa R$ 0,00, outra linha mudou')
// o dia da entrega grátis é o de Brasília, com o aparelho em qualquer fuso: sexta 23:30 de Brasília (sábado 02:30 UTC)
// ainda é o dia grátis; sábado 00:30 de Brasília (sexta à noite em Manaus) já não é
const tzAntes = process.env.TZ
for (const tz of ['America/Sao_Paulo', 'UTC', 'Asia/Tokyo', 'America/Manaus', 'Pacific/Kiritimati']) {
  process.env.TZ = tz
  const sextaNoite = entregaCom(gratis, new Date('2026-10-09T23:30:00-03:00'))[iEnt]
  const sabadoCedo = entregaCom(gratis, new Date('2026-10-10T00:30:00-03:00'))[iEnt]
  if (!sextaNoite.endsWith('(entrega grátis hoje)')) problemas.push(`aparelho em ${tz}, sexta 23:30 de Brasília: "${sextaNoite}"`)
  if (!sabadoCedo.endsWith('(taxa R$ 15,50)')) problemas.push(`aparelho em ${tz}, sábado 00:30 de Brasília: "${sabadoCedo}"`)
}
if (tzAntes === undefined) delete process.env.TZ
else process.env.TZ = tzAntes
// variação com preço próprio não herda o combo do produto (o combo foi pensado pro preço dele); a sem preço herda
const ocbVar = { ...ocb, variacoes: [{ id: 'comum', nome: 'Comum' }, { id: 'premium', nome: 'Premium', preco: 50 }] }
const linhaVar = (variacaoId, qtd) => m.montarPedido({ ...pedido, linhas: [{ produto: ocbVar, qtd, variacaoId }] }).split('\n').find((l) => /^\d+x /.test(l))
if (linhaVar('premium', 2) !== '2x Seda OCB Premium Slim (Premium) — R$ 100,00') problemas.push(`variação Premium × 2 veio "${linhaVar('premium', 2)}"`)
if (linhaVar('premium', 3) !== '3x Seda OCB Premium Slim (Premium) — R$ 150,00') problemas.push(`variação Premium × 3 veio "${linhaVar('premium', 3)}"`)
if (linhaVar('comum', 3) !== '3x Seda OCB Premium Slim (Comum) — R$ 19,99') problemas.push(`variação sem preço × 3 veio "${linhaVar('comum', 3)}"`)
// tamanho é opcional (painel → Produto): sem ele (vazio do painel ou ausente do catálogo), o nome vai sozinho, sem
// espaço nem " · " sobrando; e sem preço, "preço a consultar" (nunca um valor inventado)
const semTamanho = { id: 'fanta-maca-china', nome: 'Fanta Maçã da China', categoria: 'bebidas', preco: null, disponivel: {}, demo: false, foto: null, cor: '#000', arte: { tipo: 'lata-alta', corpo: '#000' } }
for (const [rotulo, prod] of [['ausente', semTamanho], ['vazio', { ...semTamanho, tamanho: '' }]]) {
  const msg = m.montarPedido({ ...pedido, linhas: [{ produto: prod, qtd: 1 }] }).split('\n')
  const linha = msg.find((l) => /^\d+x /.test(l))
  if (linha !== '1x Fanta Maçã da China — preço a consultar') problemas.push(`produto sem tamanho (${rotulo}) veio "${linha}"`)
  if (msg.some((l) => / · $| ·  | {2,}—|\s$/.test(l))) problemas.push(`produto sem tamanho (${rotulo}): sobrou separador ou espaço: ${JSON.stringify(msg)}`)
  const sub = msg.find((l) => l.startsWith('Subtotal:'))
  if (sub !== 'Subtotal: a consultar') problemas.push(`produto sem preço: o subtotal veio "${sub}"`)
}
if (m.nomeNaMensagem({ produto: { ...semTamanho, tamanho: '' }, qtd: 1 }) !== 'Fanta Maçã da China') problemas.push('nomeNaMensagem com tamanho vazio deixou sobra')

// o código do pedido: UMA linha logo depois do cabeçalho, e mais nada muda (com e sem cupom)
const comCodigo = m.montarPedido({ ...pedido, codigo: 'GC-7KD2X' }).split('\n')
if (comCodigo.length !== a.length + 1 || comCodigo[1] !== 'Código: GC-7KD2X') problemas.push(`com código, a 2ª linha veio "${comCodigo[1]}"`)
if ([comCodigo[0], ...comCodigo.slice(2)].join('\n') !== sem) problemas.push('com código, alguma outra linha mudou')
const codigoECupom = m.montarPedido({ ...pedido, cupom, codigo: 'GC-7KD2X' }).split('\n')
if ([codigoECupom[0], ...codigoECupom.slice(2)].join('\n') !== com || codigoECupom[1] !== 'Código: GC-7KD2X') problemas.push('com código e cupom, a mensagem não é a do cupom com a linha do código')
const enc = { canal, cidade: 'Rio de Janeiro', produto: 'Fanta de uva japonesa', quantidade: '2', referencia: 'https://exemplo.com/fanta', nome: 'Ian Teste' }
const encSem = m.montarEncomenda(enc)
const encSemEsperada = ['ENCOMENDA GREEN CHEESE — RJ / Rio de Janeiro', 'Produto: Fanta de uva japonesa', 'Quantidade: 2', 'Link/descrição: https://exemplo.com/fanta', 'Nome: Ian Teste'].join('\n')
if (encSem !== encSemEsperada) problemas.push(`encomenda sem código veio:\n${encSem}`)
const encCom = m.montarEncomenda({ ...enc, codigo: 'GC-7KD2X' }).split('\n')
if (encCom[1] !== 'Código: GC-7KD2X' || [encCom[0], ...encCom.slice(2)].join('\n') !== encSem) problemas.push(`encomenda com código veio:\n${encCom.join('\n')}`)

// rateio, no padrão do pedido: a vaga reservada (com o código) e, sem servidor, o pedido pra entrar (sem código)
const mg = { ...canal, uf: 'mg', nome: 'Minas Gerais', cidades: [{ slug: 'teofilo-otoni', nome: 'Teófilo Otoni' }], instagram: 'greencheese_importsmg' }
const vaga = { canal: mg, cidade: 'Teófilo Otoni', titulo: 'Arizona Green Tea 680 ml', quantidade: 2, precoRateio: 14.9, codigo: 'RAT-K8EA', nome: 'Ian Teste', whatsapp: '5533991234567' }
const rateioCom = m.montarRateio(vaga)
const rateioComEsperada = [
  'RATEIO GREEN CHEESE — MG / Teófilo Otoni',
  'Arizona Green Tea 680 ml — 2 vagas × R$ 14,90 = R$ 29,80',
  'Código: RAT-K8EA',
  'Nome: Ian Teste',
  'WhatsApp: (33) 99123-4567',
  'Quero confirmar minha vaga e pagar.',
].join('\n')
if (rateioCom !== rateioComEsperada) problemas.push(`rateio com código veio:\n${rateioCom}`)
const rateioSem = m.montarRateio({ ...vaga, quantidade: 1, codigo: null, whatsapp: '(33) 99123-4567' })
const rateioSemEsperada = ['RATEIO GREEN CHEESE — MG / Teófilo Otoni', 'Arizona Green Tea 680 ml — 1 vaga × R$ 14,90 = R$ 14,90', 'Nome: Ian Teste', 'WhatsApp: (33) 99123-4567', 'Quero entrar no rateio.'].join('\n')
if (rateioSem !== rateioSemEsperada) problemas.push(`rateio sem servidor veio:\n${rateioSem}`)
// ja-participa: o servidor só devolve o código; a mensagem não inventa quantidade nem total
const rateioJa = m.montarRateio({ ...vaga, quantidade: null, codigo: 'RAT-MURN' })
const rateioJaEsperada = ['RATEIO GREEN CHEESE — MG / Teófilo Otoni', 'Arizona Green Tea 680 ml', 'Código: RAT-MURN', 'Nome: Ian Teste', 'WhatsApp: (33) 99123-4567', 'Já tenho vaga nesse rateio. Quero conferir e pagar.'].join('\n')
if (rateioJa !== rateioJaEsperada) problemas.push(`rateio "já tenho vaga" veio:\n${rateioJa}`)
// o total que o servidor devolve (somado em centavos) vale mais que a conta do site
if (!m.montarRateio({ ...vaga, quantidade: 3, total: 44.7 }).includes('3 vagas × R$ 14,90 = R$ 44,70')) problemas.push('rateio: o total do servidor não entrou na mensagem')

// loja fora do ar: a aba sem os rateios (com e sem estado escolhido) e a página de um rateio (com o link)
const foraAba = m.montarRateioSemConexao(mg, 'Teófilo Otoni')
if (foraAba !== 'RATEIO GREEN CHEESE — MG / Teófilo Otoni\nQuero entrar num rateio. Quais estão abertos?') problemas.push(`rateio fora do ar (aba) veio:\n${foraAba}`)
if (m.montarRateioSemConexao(null) !== 'RATEIO GREEN CHEESE\nQuero entrar num rateio. Quais estão abertos?') problemas.push('rateio fora do ar sem estado: cabeçalho errado')
const foraPagina = m.montarRateioSemConexao(mg, 'Teófilo Otoni', 'https://oprojeto.online/greencheese/?aba=rateio&rateio=arizona-green-tea')
if (foraPagina !== 'RATEIO GREEN CHEESE — MG / Teófilo Otoni\nQuero entrar nesse rateio: https://oprojeto.online/greencheese/?aba=rateio&rateio=arizona-green-tea') problemas.push(`rateio fora do ar (página) veio:\n${foraPagina}`)
if (!m.linkWhatsAppLoja(null, 'x').startsWith('https://wa.me/5533991139036?text=')) problemas.push('rateio fora do ar sem estado: não foi pro WhatsApp da loja')

// ─── a mensagem da sacola (o caminho direto) ─────────────────────────────────────────────────────────────────
// sem cupom, sem código e sem nome: byte a byte igual ao modelo; o endereço vai na conversa (a última linha, sempre)
if (!existsSync(refSacolaArq)) problemas.push('falta scripts/mensagem-sacola-referencia.txt (rode com --gravar)')
else if (readFileSync(refSacolaArq, 'utf8') !== semSacola) problemas.push(`sacola: a mensagem mudou:\n--- referência\n${readFileSync(refSacolaArq, 'utf8')}\n--- agora\n${semSacola}`)
const sa = semSacola.split('\n')
if (sa[0] !== a[0]) problemas.push(`sacola: o cabeçalho não é o do guiado ("${sa[0]}")`)
if (sa.at(-1) !== 'Endereço: mando aqui na conversa' || sa.at(-1) !== m.LINHA_ENDERECO_SACOLA) problemas.push(`sacola: a última linha veio "${sa.at(-1)}"`)
if (sa.some((l) => /^(Pagamento|Nome|Obs\.):/.test(l))) problemas.push('sacola: sem nome, pagamento nem obs. (o site não pergunta)')
if (!sa.includes('4x Seda OCB Premium Slim — R$ 29,98 (combo 3 por R$ 19,99 + 1 avulsa)')) problemas.push(`sacola: o combo como a sacola mostra não veio (${sa[2]})`)
if (!sa.includes("1x Jack Daniel's Old No. 7 1 L — R$ 149,90")) problemas.push('sacola: a linha sem combo mudou')
if (sa.find((l) => l.startsWith('Subtotal:')) !== a[iSub]) problemas.push('sacola: o subtotal não é o mesmo do guiado (com os combos)')
if (sa.find((l) => l.startsWith('Entrega:')) !== 'Entrega: taxa a confirmar') problemas.push(`sacola: com a taxa de exemplo, a entrega veio "${sa.find((l) => l.startsWith('Entrega:'))}"`)
// o código: UMA linha logo depois do cabeçalho
const sCod = m.montarPedidoSacola({ ...sacola, codigo: 'GC-7KD2X' }).split('\n')
if (sCod[1] !== 'Código: GC-7KD2X' || [sCod[0], ...sCod.slice(2)].join('\n') !== semSacola) problemas.push(`sacola com código veio:\n${sCod.join('\n')}`)
// o cupom que vale: a mesma linha do guiado, logo depois do Subtotal; o subtotal nunca muda
const sCup = m.montarPedidoSacola({ ...sacola, cupom }).split('\n')
const sSub = sa.findIndex((l) => l.startsWith('Subtotal:'))
if (sCup[sSub + 1] !== esperada || [...sCup.slice(0, sSub + 1), ...sCup.slice(sSub + 2)].join('\n') !== semSacola) problemas.push(`sacola com cupom veio:\n${sCup.join('\n')}`)
// o nome que a conta já tem: "Nome:" antes do endereço; vazio ou só espaço não vira linha
const sNome = m.montarPedidoSacola({ ...sacola, nome: ' Ana Souza ' }).split('\n')
if (sNome.at(-2) !== 'Nome: Ana Souza' || sNome.at(-1) !== m.LINHA_ENDERECO_SACOLA || sNome.length !== sa.length + 1) problemas.push(`sacola com o nome da conta veio:\n${sNome.join('\n')}`)
if (m.montarPedidoSacola({ ...sacola, nome: '   ' }) !== semSacola) problemas.push('sacola: nome em branco virou linha')
// a entrega como o estado diz: a taxa do painel, a grátis do dia, a taxa 0 (grátis), a confirmar — sem inventar
const sEnt = (c, agora = sexta) => m.montarPedidoSacola({ ...sacola, canal: { ...canal, ...c }, agora }).split('\n').find((l) => l.startsWith('Entrega:'))
for (const [c, agora, esperado] of [
  [{ taxaEntrega: { valor: 15.5, demo: false } }, sexta, 'Entrega: taxa R$ 15,50'],
  [gratis, sexta, 'Entrega: grátis hoje'],
  [gratis, new Date(2026, 9, 8, 15), 'Entrega: taxa R$ 15,50'],
  [{ taxaEntrega: { valor: 0, demo: false } }, sexta, 'Entrega: grátis'],
  [{ taxaEntrega: { valor: null, demo: false } }, sexta, 'Entrega: taxa a confirmar'],
]) {
  if (sEnt(c, agora) !== esperado) problemas.push(`sacola: a entrega (${JSON.stringify(c).slice(0, 60)}) veio "${sEnt(c, agora)}", esperado "${esperado}"`)
}
// sem preço: "preço a consultar" (nunca um valor), e o subtotal diz que tem item a consultar
const sCons = m.montarPedidoSacola({ ...sacola, linhas: [{ produto: jack, qtd: 1 }, { produto: semTamanho, qtd: 2 }] }).split('\n')
if (!sCons.includes('2x Fanta Maçã da China — preço a consultar') || !sCons.includes('Subtotal: R$ 149,90 + itens a consultar')) problemas.push(`sacola com item a consultar veio:\n${sCons.join('\n')}`)
// a variação com preço próprio não herda o combo (como no guiado), e o combo não aparece nela
const sVar = m.montarPedidoSacola({ ...sacola, linhas: [{ produto: ocbVar, qtd: 2, variacaoId: 'premium' }] }).split('\n')
if (!sVar.includes('2x Seda OCB Premium Slim (Premium) — R$ 100,00')) problemas.push(`sacola: variação de preço próprio veio:\n${sVar.join('\n')}`)
// e o guiado continua byte a byte o de sempre (o modelo dele, lá em cima)
if (m.montarPedido(pedido) !== readFileSync(refArq, 'utf8')) problemas.push('o pedido guiado mudou')

// ─── o pedido mínimo pra entrega (src/lib/pedido-minimo.ts) ─────────────────────────────────────────────────
const comMin = (v) => ({ ...canal, pedidoMinimo: v })
const sit = (c, linhas, cup = null) => pm.situacaoMinimo(c, linhas, cup)
const so = (produto, qtd, variacaoId) => [{ produto, qtd, variacaoId }]
const casos = [
  ['sem mínimo no estado', sit(canal, so(ocb, 1)), { tipo: 'sem' }],
  ['mínimo null', sit(comMin(null), so(ocb, 1)), { tipo: 'sem' }],
  ['mínimo 0 (o servidor nunca manda, mas não trava)', sit(comMin(0), so(ocb, 1)), { tipo: 'sem' }],
  ['R$ 9,99 num mínimo de R$ 20', sit(comMin(20), so(ocb, 1)), { tipo: 'falta', minimo: 20, falta: 10.01, subtotal: 9.99 }],
  ['o combo conta (2 por R$ 14,99): falta R$ 5,01', sit(comMin(20), so(ocb, 2)), { tipo: 'falta', minimo: 20, falta: 5.01, subtotal: 14.99 }],
  ['3 por R$ 19,99: falta 1 centavo', sit(comMin(20), so(ocb, 3)), { tipo: 'falta', minimo: 20, falta: 0.01, subtotal: 19.99 }],
  ['exatamente o mínimo fecha', sit(comMin(19.99), so(ocb, 3)), { tipo: 'ok', minimo: 19.99 }],
  ['passou do mínimo', sit(comMin(20), [{ produto: jack, qtd: 1 }]), { tipo: 'ok', minimo: 20 }],
  ['item a consultar e o resto abaixo: não trava, a loja confere', sit(comMin(20), [{ produto: ocb, qtd: 1 }, { produto: semTamanho, qtd: 1 }]), { tipo: 'conferir', minimo: 20, motivo: 'consultar' }],
  ['item a consultar e o resto já passa: fecha', sit(comMin(20), [{ produto: jack, qtd: 1 }, { produto: semTamanho, qtd: 1 }]), { tipo: 'ok', minimo: 20 }],
  ['só itens a consultar: a loja confere', sit(comMin(20), so(semTamanho, 3)), { tipo: 'conferir', minimo: 20, motivo: 'consultar' }],
  ['a variação de preço próprio (R$ 50) passa', sit(comMin(20), so(ocbVar, 1, 'premium')), { tipo: 'ok', minimo: 20 }],
  ['sacola vazia com mínimo: falta tudo', sit(comMin(20), []), { tipo: 'falta', minimo: 20, falta: 20, subtotal: 0 }],
]
// o cupom: a conta é sobre o subtotal sem o desconto; se o desconto poderia levar pra baixo do mínimo, a loja confere
const ocb40 = { tipo: 'desconto-percentual', valor: 40, aplicaA: { produtos: ['seda-ocb-premium-slim'] } }
const jack10 = { tipo: 'desconto-percentual', valor: 10, aplicaA: { produtos: ['jack-daniels-old-no7-1l'] } }
const leva4 = { tipo: 'leve-x-pague-y', valor: { leve: 4, pague: 3 }, aplicaA: { produtos: ['seda-ocb-premium-slim'] } }
const brinde = { tipo: 'brinde', valor: { produto: 'seda-ocb-premium-slim', qtd: 1 }, aplicaA: { categorias: ['destilados'] } }
casos.push(
  ['cupom de 40% que leva R$ 29,98 pra baixo de R$ 20: a loja confere', sit(comMin(20), so(ocb, 4), ocb40), { tipo: 'conferir', minimo: 20, motivo: 'cupom' }],
  ['cupom de 10% num pedido bem acima: fecha', sit(comMin(20), [{ produto: jack, qtd: 1 }], jack10), { tipo: 'ok', minimo: 20 }],
  ['cupom num item que não tá na sacola: fecha', sit(comMin(20), [{ produto: jack, qtd: 1 }], ocb40), { tipo: 'ok', minimo: 20 }],
  ['leva 4 paga 3 que poderia levar R$ 29,98 a R$ 19,99: a loja confere', sit(comMin(20), so(ocb, 4), leva4), { tipo: 'conferir', minimo: 20, motivo: 'cupom' }],
  ['leva 4 paga 3 com 3 unidades (não vale ainda): só o subtotal', sit(comMin(19.99), so(ocb, 3), leva4), { tipo: 'ok', minimo: 19.99 }],
  ['brinde de um produto que tá na sacola: a loja confere', sit(comMin(155), [{ produto: jack, qtd: 1 }, { produto: ocb, qtd: 1 }], brinde), { tipo: 'conferir', minimo: 155, motivo: 'cupom' }],
  ['cupom abaixo do mínimo: falta (o cupom nunca ajuda a chegar)', sit(comMin(20), so(ocb, 1), ocb40), { tipo: 'falta', minimo: 20, falta: 10.01, subtotal: 9.99 }],
)
for (const [rotulo, veio, esperado] of casos) {
  if (JSON.stringify(veio) !== JSON.stringify(esperado)) problemas.push(`mínimo: ${rotulo}: esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(veio)}`)
}
if (pm.minimoDoCanal(comMin(20)) !== 20 || pm.minimoDoCanal(canal) !== null || pm.minimoDoCanal(null) !== null) problemas.push('minimoDoCanal não leu o mínimo do estado')

if (problemas.length) {
  console.error(problemas.join('\n\n'))
  process.exit(1)
}
console.log(`sacola ok: igual ao modelo (scripts/mensagem-sacola-referencia.txt); com o código, o cupom, o nome da conta e a entrega como o estado diz:\n${m.montarPedidoSacola({ ...sacola, codigo: 'GC-7KD2X', cupom, nome: 'Ana Souza', canal: { ...canal, taxaEntrega: { valor: 15.5, demo: false } } })}\n\npedido mínimo ok: ${casos.length} casos (falta, fecha, a consultar, cupom)\n`)
console.log(`mensagem ok: sem cupom igual à referência; com a taxa do painel e no dia da entrega grátis, só a Entrega muda (${comTaxa[iEnt]} · ${naSexta}); com cupom, +1 linha depois do Subtotal:\n${com}\n\ncom o código do pedido (+1 linha depois do cabeçalho):\n${codigoECupom.join('\n')}\n\nencomenda com o código:\n${encCom.join('\n')}\n\nrateio (vaga reservada):\n${rateioCom}\n\nrateio (sem servidor):\n${rateioSem}\n\nrateio (já tenho vaga):\n${rateioJa}\n\nrateio (loja fora do ar):\n${foraAba}\n\n${foraPagina}`)
