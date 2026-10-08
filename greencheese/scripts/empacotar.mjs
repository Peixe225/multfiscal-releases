// Pacote pra publicar à mão (hPanel → Gerenciador de Arquivos → Extrair): o build zipado com as MESMAS regras do
// publicar.mjs (publicacao.mjs). Recusa o código de instalação de desenvolvimento e deixa de fora banco, log e envios:
// o Vite copia public/ inteiro pro build, e um loja.sqlite ou uma foto esquecidos ali, extraídos no ar, iam
// sobrescrever os de verdade. Os atalhos Home2/ e HOME2/ não vão (só mudam a caixa e colidem no Windows e no macOS):
// esses só o publicar.mjs sobe.
// Uso: npm run build && node scripts/empacotar.mjs [saida.zip]   (padrão: entrega/greencheese-dist.zip)
// EMPACOTAR_DIST=<pasta> troca a pasta do build (padrão: dist/).
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateRawSync } from 'node:zlib'
import { foraDaPublicacao, instalacaoDeDev, listar, ordenar, relativo } from './publicacao.mjs'

const dist = process.env.EMPACOTAR_DIST ? resolve(process.env.EMPACOTAR_DIST) : fileURLToPath(new URL('../dist/', import.meta.url))
const saida = resolve(process.argv[2] ?? fileURLToPath(new URL('../entrega/greencheese-dist.zip', import.meta.url)))

const dev = instalacaoDeDev(dist)
if (dev) {
  console.error(`recusado: o api/instalacao.php do build ${dev}.`)
  console.error('rode "php scripts/codigo-instalacao.php", depois "npm run build", e empacote de novo.')
  process.exit(1)
}

const tudo = listar(dist).map((f) => relativo(dist, f))
const fora = tudo.filter(foraDaPublicacao)
const dentro = ordenar(tudo.filter((r) => !foraDaPublicacao(r)))

// data e hora no formato do ZIP (MS-DOS, hora local, de 2 em 2 s)
function dos(d) {
  const ano = Math.max(1980, d.getFullYear())
  return { hora: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dia: ((ano - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() }
}

// ZIP sem dependência: cabeçalho local + dados de cada entrada, depois o diretório central e o fim
const locais = []
const central = []
let posicao = 0
function entrada(nome, dados, quando, pasta) {
  const n = Buffer.from(nome, 'utf8')
  const comprimido = pasta ? dados : deflateRawSync(dados, { level: 9 })
  const guardado = pasta || comprimido.length >= dados.length
  const corpo = guardado ? dados : comprimido
  const crc = crc32(dados) >>> 0
  const { hora, dia } = dos(quando)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(0x0800, 6) // nomes em UTF-8
  local.writeUInt16LE(guardado ? 0 : 8, 8)
  local.writeUInt16LE(hora, 10)
  local.writeUInt16LE(dia, 12)
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(corpo.length, 18)
  local.writeUInt32LE(dados.length, 22)
  local.writeUInt16LE(n.length, 26)
  const c = Buffer.alloc(46)
  c.writeUInt32LE(0x02014b50, 0)
  c.writeUInt16LE((3 << 8) | 20, 4) // feito no Unix (as permissões abaixo valem)
  c.writeUInt16LE(20, 6)
  c.writeUInt16LE(0x0800, 8)
  c.writeUInt16LE(guardado ? 0 : 8, 10)
  c.writeUInt16LE(hora, 12)
  c.writeUInt16LE(dia, 14)
  c.writeUInt32LE(crc, 16)
  c.writeUInt32LE(corpo.length, 20)
  c.writeUInt32LE(dados.length, 24)
  c.writeUInt16LE(n.length, 28)
  c.writeUInt32LE((((pasta ? 0o40755 : 0o100644) << 16) | (pasta ? 0x10 : 0)) >>> 0, 38)
  c.writeUInt32LE(posicao, 42)
  locais.push(local, n, corpo)
  central.push(c, n)
  posicao += local.length + n.length + corpo.length
}

const pastas = new Set()
for (const r of dentro) {
  // a pasta antes do primeiro arquivo dela (tem extrator que não cria pasta sozinho)
  const partes = r.split('/').slice(0, -1)
  for (let i = 1; i <= partes.length; i++) {
    const p = `${partes.slice(0, i).join('/')}/`
    if (!pastas.has(p)) {
      pastas.add(p)
      entrada(p, Buffer.alloc(0), statSync(join(dist, p)).mtime, true)
    }
  }
  entrada(r, readFileSync(join(dist, r)), statSync(join(dist, r)).mtime, false)
}
const tamCentral = central.reduce((s, b) => s + b.length, 0)
const fim = Buffer.alloc(22)
fim.writeUInt32LE(0x06054b50, 0)
fim.writeUInt16LE(dentro.length + pastas.size, 8)
fim.writeUInt16LE(dentro.length + pastas.size, 10)
fim.writeUInt32LE(tamCentral, 12)
fim.writeUInt32LE(posicao, 16)
mkdirSync(dirname(saida), { recursive: true })
writeFileSync(saida, Buffer.concat([...locais, ...central, fim]))

for (const r of fora) console.log(`fica fora: ${r}`)
console.log(`pacote: ${saida} · ${dentro.length} arquivos${fora.length ? ` · ${fora.length} de fora` : ''}`)
