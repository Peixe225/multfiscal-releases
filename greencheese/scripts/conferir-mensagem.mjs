// Confere a mensagem do pedido (src/lib/mensagem.ts) sem abrir o navegador.
// - Sem cupom, a mensagem tem que ficar byte a byte igual à referência (scripts/mensagem-referencia.txt), gerada
//   ANTES do cupom existir: o formato que a loja já conhece não muda.
// - Com cupom, entra UMA linha só, logo depois de "Subtotal:".
// - Rateio: a mensagem da vaga reservada (com o código), a de quem entra pelo WhatsApp sem servidor (sem código), a
//   de quem já tem vaga (ja-participa: só o código, sem conta de vagas que o site não sabe) e a da loja fora do ar
//   (a aba sem os rateios, ou a página de um, com o link).
// Uso: node scripts/conferir-mensagem.mjs            → confere
//      node scripts/conferir-mensagem.mjs --gravar   → (re)grava a referência (só quando o formato mudar de propósito)
import { rolldown } from 'rolldown'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const raiz = new URL('../', import.meta.url).pathname
const refArq = join(raiz, 'scripts/mensagem-referencia.txt')

// empacota mensagem.ts (e o que ele importa) num .mjs temporário
const tmp = mkdtempSync(join(tmpdir(), 'gc-mensagem-'))
const saida = join(tmp, 'mensagem.mjs')
const pacote = await rolldown({ input: join(raiz, 'src/lib/mensagem.ts'), logLevel: 'silent' })
await pacote.write({ file: saida, format: 'esm' })
await pacote.close()
const m = await import(pathToFileURL(saida).href)
rmSync(tmp, { recursive: true, force: true })

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

if (process.argv.includes('--gravar')) {
  writeFileSync(refArq, sem)
  console.log(`referência gravada em scripts/mensagem-referencia.txt:\n${sem}`)
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

if (problemas.length) {
  console.error(problemas.join('\n\n'))
  process.exit(1)
}
console.log(`mensagem ok: sem cupom igual à referência; com cupom, +1 linha depois do Subtotal:\n${com}\n\nrateio (vaga reservada):\n${rateioCom}\n\nrateio (sem servidor):\n${rateioSem}\n\nrateio (já tenho vaga):\n${rateioJa}\n\nrateio (loja fora do ar):\n${foraAba}\n\n${foraPagina}`)
