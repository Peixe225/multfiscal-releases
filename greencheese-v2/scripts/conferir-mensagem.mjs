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
// - Taxa por bairro (22/10): a do bairro na lista, "a consultar" (fora da lista, marcado "consultar", sem bairro), o
//   modo consulta, o dia de entrega grátis por cima; só a linha da Entrega muda (sacola e guiado), e o estado de uma
//   taxa só fica byte a byte igual; a taxa que vai pro servidor e o "Perguntar a taxa no WhatsApp".
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
// o cupom que entra sozinho no pedido (22/10): a escolha (o que vale e vence primeiro, empate pela raridade) e as recusas
const ca = await carregar('src/lib/cupom-automatico.ts')

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
// o grátis de hoje só com a loja atendendo ainda hoje (o horário de verdade do painel; a revisão de 14/10): fechada até
// amanhã, o pedido só sai amanhã e a mensagem não promete o grátis (fica a taxa); antes de abrir ou aberta, vale. O turno
// que passa da meia-noite atende hoje. O horário de exemplo não conta (fica como sempre foi)
const turno = { horario: { semana: Array.from({ length: 7 }, () => ['10:00', '15:00']), demo: false } }
const sextaBR = (h) => new Date(`2026-10-09T${h}:00-03:00`)
for (const [c, h, esperado, rotulo] of [
  [turno, '15:40', '(taxa R$ 15,50)', 'fechada até amanhã (10h–15h, 15:40)'],
  [turno, '08:30', '(entrega grátis hoje)', 'antes de abrir (10h–15h, 08:30)'],
  [turno, '12:00', '(entrega grátis hoje)', 'aberta (10h–15h, 12:00)'],
  [{ horario: { semana: Array.from({ length: 7 }, () => ['18:00', '02:00']), demo: false } }, '23:00', '(entrega grátis hoje)', 'turno que passa da meia-noite (18h–2h, 23:00)'],
  [{ horario: { semana: turno.horario.semana, demo: true } }, '15:40', '(entrega grátis hoje)', 'horário de exemplo (não conta)'],
]) {
  const e = entregaCom({ ...gratis, ...c }, sextaBR(h))[iEnt]
  if (!e.endsWith(esperado)) problemas.push(`guiado, sexta de entrega grátis, ${rotulo}: "${e}", esperado o fim "${esperado}"`)
}
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
  // fechada até amanhã no dia grátis: não promete o grátis de hoje; antes de abrir, promete
  [{ ...gratis, ...turno }, sextaBR('15:40'), 'Entrega: taxa R$ 15,50'],
  [{ ...gratis, ...turno }, sextaBR('08:30'), 'Entrega: grátis hoje'],
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

// ── o cupom que entra sozinho (22/10): src/lib/cupom-automatico.ts ─────────────────────────────────────────────────
// quem vale nesta sacola é quem chama (situacaoNoPedido); aqui, a ordem, as recusas e a linha que vai na mensagem
const D = 864e5
const agoraC = Date.UTC(2026, 9, 22, 15)
const kc = (codigo, vence, raridade, ganho = 1) => ({ codigo, validoAte: agoraC + vence * D, ganhoEm: agoraC - ganho * D, retrato: raridade ? { raridade } : {} })
const todos = () => true
const escolha = (lista, vale = todos, recusados = []) => ca.escolherCupomAutomatico(lista, vale, recusados)?.codigo ?? null
const casosCupom = [
  ['nenhum cupom: nada entra', escolha([]), null],
  ['um que vale: entra', escolha([kc('SORTE-AAA3', 5)]), 'SORTE-AAA3'],
  ['o que vence primeiro ganha (o de 2 dias antes do de 5)', escolha([kc('SORTE-AAA3', 5), kc('SORTE-BBB4', 2)]), 'SORTE-BBB4'],
  ['vencendo juntos: o de maior raridade (lendário antes de comum e raro)', escolha([kc('SORTE-BBB4', 2, 'comum'), kc('SORTE-CCC6', 2, 'lendario'), kc('SORTE-DDD7', 2, 'raro')]), 'SORTE-CCC6'],
  ['raridade não passa por cima da validade (o comum que vence antes ganha do lendário)', escolha([kc('SORTE-CCC6', 3, 'lendario'), kc('SORTE-BBB4', 1, 'comum')]), 'SORTE-BBB4'],
  ['cupom de antes da raridade conta como comum (perde pro raro no empate)', escolha([kc('SORTE-EEE8', 2), kc('SORTE-DDD7', 2, 'raro')]), 'SORTE-DDD7'],
  ['empate em tudo: o ganho primeiro', escolha([kc('SORTE-FFF9', 2, 'raro', 1), kc('SORTE-GGG3', 2, 'raro', 3)]), 'SORTE-GGG3'],
  ['o que não vale nesta sacola não entra, mesmo vencendo antes', escolha([kc('SORTE-BBB4', 1), kc('SORTE-AAA3', 5)], (c) => c.codigo !== 'SORTE-BBB4'), 'SORTE-AAA3'],
  ['nenhum vale: nada entra', escolha([kc('SORTE-AAA3', 5)], () => false), null],
  ['o que o cliente tirou não volta sozinho', escolha([kc('SORTE-AAA3', 5)], todos, ['SORTE-AAA3']), null],
  ['tirou: o que ele já tinha naquela hora também não entra no lugar', escolha([kc('SORTE-AAA3', 5), kc('SORTE-BBB4', 2)], todos, ['SORTE-AAA3', 'SORTE-BBB4']), null],
  ['tirou e ganhou outro depois: o novo entra sozinho', escolha([kc('SORTE-AAA3', 5), kc('SORTE-HHH4', 7)], todos, ['SORTE-AAA3']), 'SORTE-HHH4'],
  ['a mesma lista em outra ordem dá o mesmo cupom', escolha([kc('SORTE-DDD7', 2, 'raro'), kc('SORTE-CCC6', 2, 'lendario'), kc('SORTE-BBB4', 2, 'comum')]), 'SORTE-CCC6'],
]
// a linha diz "é o que vence primeiro" só quando o aplicado vem antes de todos os outros que valem (revisão de 22/10: um
// cupom que o cliente tirou pode vencer antes do que entrou sozinho depois)
const antes = (aplicado, outros) => (typeof ca.venceAntesDeTodos === 'function' ? ca.venceAntesDeTodos(aplicado, outros) : 'sem venceAntesDeTodos')
casosCupom.push(
  ['"vence primeiro": o aplicado vence antes dos outros', antes(kc('SORTE-BBB4', 2), [kc('SORTE-AAA3', 5)]), true],
  ['"vence primeiro": não, se outro que vale vence antes (o que o cliente tirou)', antes(kc('SORTE-HHH4', 7), [kc('SORTE-AAA3', 2)]), false],
  ['"vence primeiro": vencendo juntos, o mais raro vem antes', antes(kc('SORTE-CCC6', 2, 'lendario'), [kc('SORTE-BBB4', 2, 'comum')]), true],
  ['"vence primeiro": vencendo juntos, o menos raro não', antes(kc('SORTE-BBB4', 2, 'comum'), [kc('SORTE-CCC6', 2, 'lendario')]), false],
)
for (const [rotulo, veio, esperado] of casosCupom) if (veio !== esperado) problemas.push(`cupom automático: ${rotulo}: esperado ${esperado}, veio ${veio}`)
// o que entrou sozinho vai na mensagem como qualquer cupom: a linha de sempre, nas duas (guiado e sacola)
const auto = ca.escolherCupomAutomatico([{ ...kc('SORTE-K8EA', 5), regra: 'Leva 4 Seda OCB Premium Slim e paga 3' }], todos, [])
const linhaAuto = 'Cupom: SORTE-K8EA — Leva 4 Seda OCB Premium Slim e paga 3 (Teste minha sorte · a loja confirma)'
const doAuto = { codigo: auto.codigo, regra: auto.regra, origem: 'Teste minha sorte', exemplo: false }
if (!m.montarPedido({ ...pedido, cupom: doAuto }).split('\n').includes(linhaAuto)) problemas.push('cupom automático: a mensagem do guiado não levou a linha do cupom')
if (!m.montarPedidoSacola({ ...sacola, cupom: doAuto }).split('\n').includes(linhaAuto)) problemas.push('cupom automático: a mensagem da sacola não levou a linha do cupom')
// ─── a taxa por bairro (22/10) ──────────────────────────────────────────────────────────────────────────────
// o estado que cobra por bairro: a lista aparece no site ('site') ou o cliente consulta ('consulta'). A mensagem diz o
// bairro e a taxa dele, ou "a consultar" (fora da lista, marcado "consultar", sem bairro); o dia de entrega grátis vale
// por cima de tudo; o estado de uma taxa só fica byte a byte o de sempre, com bairro ou sem. Só a linha da Entrega muda.
/** Um caso que quebra (função que não existe, exceção) vira um problema com o nome dele, e os outros seguem. */
const tenta = (rotulo, fn) => {
  try {
    fn()
  } catch (e) {
    problemas.push(`taxa por bairro, ${rotulo}: ${e.message}`)
  }
}
const lista = [
  { nome: 'Copacabana', taxa: 12 },
  { nome: 'Ipanema', taxa: null },
  { nome: 'Leblon', taxa: 0 },
  { nome: 'Centro', cidade: 'Niterói', taxa: 9 },
]
const porBairro = { taxaEntrega: { valor: null, demo: false }, taxaPorBairro: { modo: 'site', bairros: lista } }
const consulta = { taxaEntrega: { valor: null, demo: false }, taxaPorBairro: { modo: 'consulta' } }
const gratisBairro = { ...porBairro, entregaGratis: { dias: [5], texto: 'Sextou com entrega grátis!', demo: false } }
const quinta = new Date(2026, 9, 8, 15)
const sacolaB = (c, bairro, agora = quinta) => m.montarPedidoSacola({ ...sacola, canal: { ...canal, ...c }, bairro, agora })
const guiadoB = (c, bairro, agora = quinta, endereco = pedido.endereco) => m.montarPedido({ ...pedido, canal: { ...canal, ...c }, bairro, agora, endereco })
const iEntS = sa.findIndex((l) => l.startsWith('Entrega:'))
for (const [c, bairro, agora, esperado, rotulo] of [
  [porBairro, 'copacabana', quinta, 'Entrega: Copacabana (taxa R$ 12,00)', 'bairro da lista (o nome como o dono escreveu)'],
  [porBairro, ' COPACABANA ', quinta, 'Entrega: Copacabana (taxa R$ 12,00)', 'maiúscula e espaço não contam'],
  [porBairro, 'Ipanema', quinta, 'Entrega: Ipanema (taxa do bairro a consultar)', 'bairro marcado "consultar"'],
  [porBairro, 'Tijuca', quinta, 'Entrega: Tijuca (taxa do bairro a consultar)', 'fora da lista'],
  [porBairro, 'Leblon', quinta, 'Entrega: Leblon (grátis)', 'bairro com R$ 0'],
  [porBairro, 'Centro', quinta, 'Entrega: Centro (taxa do bairro a consultar)', 'bairro de outra cidade (Niterói) não vale no Rio'],
  [porBairro, '', quinta, 'Entrega: taxa do bairro a consultar', 'sem bairro'],
  [porBairro, null, quinta, 'Entrega: taxa do bairro a consultar', 'sem bairro (null)'],
  // no dia grátis a sacola não mostra o "Teu bairro": o guardado de outra visita não vai na mensagem (revisão de 22/10)
  [gratisBairro, 'Copacabana', sexta, 'Entrega: grátis hoje', 'dia de entrega grátis, com o bairro guardado (que a sacola não mostra nesse dia)'],
  [gratisBairro, '', sexta, 'Entrega: grátis hoje', 'dia de entrega grátis, sem bairro'],
  [gratisBairro, 'Copacabana', quinta, 'Entrega: Copacabana (taxa R$ 12,00)', 'fora do dia grátis'],
  [consulta, 'Copacabana', quinta, 'Entrega: taxa a consultar (bairro Copacabana)', 'o cliente consulta, com bairro'],
  [consulta, '', quinta, 'Entrega: taxa a consultar (depende do bairro)', 'o cliente consulta, sem bairro'],
]) {
  tenta(`sacola, ${rotulo}`, () => {
    const msg = sacolaB(c, bairro, agora).split('\n')
    if (msg[iEntS] !== esperado) problemas.push(`taxa por bairro, sacola, ${rotulo}: veio "${msg[iEntS]}", esperado "${esperado}"`)
    if (msg.filter((l, i) => i !== iEntS).join('\n') !== sa.filter((l, i) => i !== iEntS).join('\n')) problemas.push(`taxa por bairro, sacola, ${rotulo}: outra linha mudou`)
  })
}
// o estado de uma taxa só: o bairro não muda nada (a mensagem de sempre, byte a byte)
tenta('estado de uma taxa só', () => {
  if (sacolaB({}, 'Copacabana', sexta) !== m.montarPedidoSacola({ ...sacola, agora: sexta })) problemas.push('taxa por bairro: no estado de uma taxa só, o bairro mudou a mensagem da sacola')
  if (m.montarPedido({ ...pedido, bairro: 'Copacabana' }) !== sem) problemas.push('taxa por bairro: no estado de uma taxa só, o bairro mudou a mensagem do guiado')
})
// o guiado: o bairro do CEP já tá no endereço (a taxa não repete o nome); o que a pessoa disse fora do endereço vai junto
for (const [c, bairro, agora, endereco, esperado, rotulo] of [
  [porBairro, 'Copacabana', quinta, pedido.endereco, '(taxa do bairro: R$ 12,00)', 'o bairro do CEP, no endereço'],
  [porBairro, 'Copacabana', quinta, 'Rua Barata Ribeiro, 120', '(taxa do bairro Copacabana: R$ 12,00)', 'o bairro fora do endereço'],
  [porBairro, 'Leblon', quinta, 'Rua Dias Ferreira, 50', '(bairro Leblon sem taxa)', 'bairro com R$ 0'],
  [porBairro, 'Tijuca', quinta, 'Rua Conde de Bonfim, 10, Tijuca', '(taxa do bairro a consultar)', 'fora da lista'],
  [porBairro, '', quinta, 'Rua Conde de Bonfim, 10', '(taxa do bairro a consultar)', 'sem bairro'],
  [gratisBairro, 'Copacabana', sexta, pedido.endereco, '(entrega grátis hoje)', 'dia de entrega grátis'],
  [consulta, 'Copacabana', quinta, pedido.endereco, '(taxa a consultar pelo bairro)', 'o cliente consulta'],
  [consulta, 'Tijuca', quinta, 'Rua Conde de Bonfim, 10', '(taxa a consultar pelo bairro Tijuca)', 'o cliente consulta, bairro fora do endereço'],
]) {
  tenta(`guiado, ${rotulo}`, () => {
    const msg = guiadoB(c, bairro, agora, endereco).split('\n')
    if (msg[iEnt] !== `Entrega: ${endereco} ${esperado}`) problemas.push(`taxa por bairro, guiado, ${rotulo}: veio "${msg[iEnt]}", esperado "Entrega: ${endereco} ${esperado}"`)
    const base = m.montarPedido({ ...pedido, endereco }).split('\n')
    if (msg.filter((l, i) => i !== iEnt).join('\n') !== base.filter((l, i) => i !== iEnt).join('\n')) problemas.push(`taxa por bairro, guiado, ${rotulo}: outra linha mudou`)
  })
}
// a taxa que vai pro servidor (o painel guarda; o aviso diz a da tabela): o valor e o texto, sem o bairro
for (const [c, bairro, agora, esperado] of [
  [porBairro, 'Copacabana', quinta, { valor: 12, texto: 'taxa R$ 12,00' }],
  [porBairro, 'Leblon', quinta, { valor: 0, texto: 'grátis' }],
  [porBairro, 'Tijuca', quinta, { valor: null, texto: 'taxa do bairro a consultar' }],
  [gratisBairro, 'Copacabana', sexta, { valor: null, texto: 'grátis hoje' }],
  [consulta, 'Copacabana', quinta, { valor: null, texto: 'taxa a consultar' }],
  [{ taxaEntrega: { valor: 15.5, demo: false } }, 'Copacabana', quinta, { valor: 15.5, texto: 'taxa R$ 15,50' }],
]) {
  tenta(`pro servidor, ${JSON.stringify(esperado)}`, () => {
    const t = m.taxaParaOServidor(m.entregaDoPedido({ ...canal, ...c }, bairro, 'Rio de Janeiro', agora))
    if (JSON.stringify(t) !== JSON.stringify(esperado)) problemas.push(`taxa por bairro: pro servidor, esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(t)}`)
  })
}
// ── revisão de 22/10 (o corretor) ──
// (o código de antes da taxa por bairro não tem o arquivo: cada caso abaixo vira um problema com o nome dele)
const lb = await carregar('src/lib/bairros.ts').catch(() => ({}))
// o estado com mais de uma cidade e o cliente sem cidade: a mensagem acha o bairro como a sugestão mostrou
const es = {
  uf: 'es',
  nome: 'Espírito Santo',
  cidades: [{ slug: 'vila-velha', nome: 'Vila Velha' }, { slug: 'vitoria', nome: 'Vitória' }],
  taxaEntrega: { valor: null, demo: false },
  taxaPorBairro: {
    modo: 'site',
    bairros: [
      { nome: 'Centro', cidade: 'Vitória', taxa: 10 },
      { nome: 'Centro', cidade: 'Vila Velha', taxa: 8 },
      { nome: 'Praia da Costa', cidade: 'Vila Velha', taxa: 9 },
      { nome: 'Jardim da Penha', taxa: 11 },
    ],
  },
}
for (const [bairro, cidade, esperado, rotulo] of [
  ['Praia da Costa', null, 'Entrega: Praia da Costa (taxa R$ 9,00)', 'sem a cidade, o bairro de uma cidade só (a sugestão mostrou R$ 9,00)'],
  ['Centro', null, 'Entrega: Centro (taxa do bairro a consultar)', 'sem a cidade, o "Centro" de duas cidades com taxas diferentes'],
  ['Centro', 'Vitória', 'Entrega: Centro (taxa R$ 10,00)', 'com a cidade escolhida na sugestão (Vitória)'],
  ['Jardim da Penha', null, 'Entrega: Jardim da Penha (taxa R$ 11,00)', 'sem a cidade, o bairro de qualquer cidade'],
]) {
  tenta(`sacola do ES, ${rotulo}`, () => {
    const msg = m.montarPedidoSacola({ ...sacola, canal: { ...canal, ...es }, cidade, bairro, agora: quinta }).split('\n')
    const linha = msg.find((l) => l.startsWith('Entrega:'))
    if (linha !== esperado) problemas.push(`taxa por bairro, sacola do ES, ${rotulo}: veio "${linha}", esperado "${esperado}"`)
  })
}
tenta('a sugestão sem a cidade', () => {
  const s = lb.sugestoesDeBairro(es.taxaPorBairro.bairros, 'Cen', null).map((x) => `${x.nome}·${x.cidade ?? ''}·${x.taxa}`).join(' | ')
  if (s !== 'Centro·Vila Velha·8 | Centro·Vitória·10') problemas.push(`taxa por bairro: a sugestão sem a cidade veio "${s}" (cada "Centro" com a cidade e a taxa dele)`)
})
// o guiado com o CEP de Vila Velha e sem a cidade escolhida: a cidade do CEP acha o "Centro" de Vila Velha
tenta('guiado com a cidade do CEP', () => {
  const endereco = 'Rua Sete de Setembro, 10, Centro, Vila Velha'
  const linha = m.montarPedido({ ...pedido, canal: { ...canal, ...es }, cidade: null, cidadeBairro: 'Vila Velha', bairro: 'Centro', endereco, agora: quinta }).split('\n').find((l) => l.startsWith('Entrega:'))
  if (linha !== `Entrega: ${endereco} (taxa do bairro: R$ 8,00)`) problemas.push(`taxa por bairro, guiado com o CEP de Vila Velha: veio "${linha}"`)
})
// o guiado sem CEP: o bairro escrito no endereço vale mais que o guardado no aparelho
for (const [c, endereco, guardado, esperado, rotulo] of [
  [porBairro, 'Rua Barata Ribeiro, 120, Copacabana', 'Leblon', 'Copacabana', 'o endereço cita outro bairro da lista: ele, e não o guardado'],
  [porBairro, 'Rua Dias Ferreira, 50', 'Leblon', 'Leblon', 'o endereço não cita bairro da lista: o guardado (a mensagem diz o nome)'],
  [porBairro, 'Av. Atlântica, 1702, COPACABANA', 'copacabana', 'copacabana', 'o guardado escrito no endereço'],
  [porBairro, 'Rua Conde de Bonfim, 10', '', null, 'sem guardado e sem bairro da lista no endereço'],
  [consulta, 'Rua Barata Ribeiro, 120, Copacabana', 'Leblon', 'Leblon', 'o cliente consulta (o site não tem a lista): o guardado'],
  [{}, 'Rua Barata Ribeiro, 120, Copacabana', 'Leblon', null, 'estado de uma taxa só: nada'],
]) {
  tenta(`guiado sem CEP, ${rotulo}`, () => {
    const veio = lb.bairroDoEndereco({ ...canal, ...c }, endereco, guardado, 'Rio de Janeiro')
    if (veio !== esperado) problemas.push(`taxa por bairro, guiado sem CEP, ${rotulo}: veio ${JSON.stringify(veio)}, esperado ${JSON.stringify(esperado)}`)
  })
}
tenta('guiado sem CEP, a mensagem', () => {
  const endereco = 'Rua Barata Ribeiro, 120, Copacabana'
  const bairro = lb.bairroDoEndereco({ ...canal, ...porBairro }, endereco, 'Leblon', 'Rio de Janeiro')
  const linha = guiadoB(porBairro, bairro, quinta, endereco).split('\n')[iEnt]
  if (linha !== `Entrega: ${endereco} (taxa do bairro: R$ 12,00)`) problemas.push(`taxa por bairro, guiado sem CEP com o Leblon guardado: veio "${linha}"`)
})
// a hora do toque vai junto da taxa pro servidor (o dia grátis é o do toque, não o da chegada da cópia)
tenta('a hora do toque pro servidor', () => {
  const t = m.taxaParaOServidor(m.entregaDoPedido({ ...canal, ...gratisBairro }, 'Copacabana', 'Rio de Janeiro', sexta), sexta)
  if (JSON.stringify(t) !== JSON.stringify({ valor: null, texto: 'grátis hoje', em: Math.floor(sexta.getTime() / 1000) })) problemas.push(`taxa por bairro: a hora do toque pro servidor veio ${JSON.stringify(t)}`)
})

// "Perguntar a taxa no WhatsApp": a conversa do pedido com a frase pronta
tenta('o "Perguntar" com o bairro', () => {
  const pergunta = m.linkConsultaBairro({ ...canal, ...consulta }, 'Praia da Costa')
  if (pergunta !== `https://wa.me/5533991139036?text=${encodeURIComponent('Oi! Quanto fica a entrega pro bairro Praia da Costa?')}`) problemas.push(`taxa por bairro: o "Perguntar" veio ${pergunta}`)
})
tenta('o "Perguntar" sem bairro', () => {
  if (!decodeURIComponent(m.linkConsultaBairro({ ...canal, ...consulta }, '').split('text=')[1]).endsWith('pro meu bairro?')) problemas.push('taxa por bairro: o "Perguntar" sem bairro')
})

if (problemas.length) {
  console.error(problemas.join('\n\n'))
  process.exit(1)
}
console.log(`cupom automático ok: ${casosCupom.length} casos (o que vence primeiro, a raridade no empate, o que não vale, o que o cliente tirou, o ganho depois, o "é o que vence primeiro" só quando é) e a linha nas duas mensagens:\n${linhaAuto}\n`)
console.log(`taxa por bairro ok: ${m.montarPedidoSacola({ ...sacola, canal: { ...canal, ...porBairro }, bairro: 'copacabana', agora: quinta }).split('\n')[iEntS]} · ${m.montarPedidoSacola({ ...sacola, canal: { ...canal, ...porBairro }, bairro: 'Tijuca', agora: quinta }).split('\n')[iEntS]} · ${m.montarPedidoSacola({ ...sacola, canal: { ...canal, ...consulta }, bairro: 'Copacabana', agora: quinta }).split('\n')[iEntS]} · ${m.montarPedidoSacola({ ...sacola, canal: { ...canal, ...gratisBairro }, bairro: 'Copacabana', agora: sexta }).split('\n')[iEntS]}\n`)
console.log(`sacola ok: igual ao modelo (scripts/mensagem-sacola-referencia.txt); com o código, o cupom, o nome da conta e a entrega como o estado diz:\n${m.montarPedidoSacola({ ...sacola, codigo: 'GC-7KD2X', cupom, nome: 'Ana Souza', canal: { ...canal, taxaEntrega: { valor: 15.5, demo: false } } })}\n\npedido mínimo ok: ${casos.length} casos (falta, fecha, a consultar, cupom)\n`)
console.log(`mensagem ok: sem cupom igual à referência; com a taxa do painel e no dia da entrega grátis, só a Entrega muda (${comTaxa[iEnt]} · ${naSexta}); com cupom, +1 linha depois do Subtotal:\n${com}\n\ncom o código do pedido (+1 linha depois do cabeçalho):\n${codigoECupom.join('\n')}\n\nencomenda com o código:\n${encCom.join('\n')}\n\nrateio (vaga reservada):\n${rateioCom}\n\nrateio (sem servidor):\n${rateioSem}\n\nrateio (já tenho vaga):\n${rateioJa}\n\nrateio (loja fora do ar):\n${foraAba}\n\n${foraPagina}`)
