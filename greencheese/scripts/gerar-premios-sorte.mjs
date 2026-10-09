// Gera public/api/nucleo/premios-sorte.json a partir de src/dados/sorte.ts e do catálogo: a semente dos prêmios do
// Teste minha sorte que o servidor sorteia enquanto o painel da loja não cuida deles (premios-semente.php). Cada prêmio
// leva os estados onde ele vale (produto disponível lá, como premiosElegiveis do site) e as mesmas recusas do site:
// produto ou categoria que não existe, prêmio em bebida ou destilado (álcool nunca é prêmio), peso, validade, valor e
// as palavras de PALAVRAS_PROIBIDAS.
// Uso: node scripts/gerar-premios-sorte.mjs              → (re)grava o JSON
//      node scripts/gerar-premios-sorte.mjs --conferir   → só confere que o JSON está em dia (sai 1 se não estiver)
import { rolldown } from 'rolldown'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const raiz = new URL('../', import.meta.url).pathname
const destino = join(raiz, 'public/api/nucleo/premios-sorte.json')

async function carregar(arquivo) {
  const tmp = mkdtempSync(join(tmpdir(), 'gc-premios-'))
  const saida = join(tmp, 'm.mjs')
  const pacote = await rolldown({ input: join(raiz, arquivo), logLevel: 'silent' })
  await pacote.write({ file: saida, format: 'esm' })
  await pacote.close()
  const m = await import(pathToFileURL(saida).href)
  rmSync(tmp, { recursive: true, force: true })
  return m
}

const { premios, PALAVRAS_PROIBIDAS } = await carregar('src/dados/sorte.ts')
const { config } = await carregar('src/dados/config.ts')
const { ufsAtendidas } = await carregar('src/dados/canais.ts')
const catalogo = JSON.parse(readFileSync(join(raiz, 'src/dados/catalogo.json'), 'utf8'))

const semAcento = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const PROIBIDAS = PALAVRAS_PROIBIDAS.map(semAcento)
const FORA = new Set(['bebidas', 'destilados'])
// com os exemplos desligados, produto de exemplo some do catálogo (e o prêmio que depende dele também)
const produtos = catalogo.produtos.filter((p) => config.dadosDeExemplo || !p.demo)
const porId = new Map(produtos.map((p) => [p.id, p]))
const categorias = new Set(catalogo.categorias.map((c) => c.id))

const problemas = []
const saida = []
const ids = new Set()
for (const p of premios) {
  const erro = (m) => problemas.push(`${p.id}: ${m}`)
  if (!p.id || ids.has(p.id)) erro('id vazio ou repetido')
  ids.add(p.id)
  const alvos = p.aplicaA.produtos ?? []
  const cats = p.aplicaA.categorias ?? []
  if (!alvos.length && !cats.length) erro('aplicaA sem produto nem categoria')
  for (const id of alvos) {
    const x = catalogo.produtos.find((y) => y.id === id)
    if (!x) erro(`produto "${id}" não existe no catalogo.json`)
    else if (FORA.has(x.categoria)) erro(`produto "${id}" é de ${x.categoria} (álcool e bebida nunca são prêmio)`)
  }
  for (const c of cats) {
    if (!categorias.has(c)) erro(`categoria "${c}" não existe`)
    if (FORA.has(c)) erro(`categoria "${c}" não pode ter prêmio`)
  }
  if (!(p.peso > 0)) erro('peso precisa ser maior que 0')
  if (!Number.isInteger(p.validadeDias) || p.validadeDias < 1 || p.validadeDias > 30) erro('validadeDias vai de 1 a 30')
  if (p.tipo === 'desconto-percentual' && !(p.valor >= 1 && p.valor <= 50)) erro('percentual vai de 1 a 50')
  if (p.tipo === 'leve-x-pague-y' && !(p.valor.leve > p.valor.pague && p.valor.pague >= 1)) erro('leve precisa ser maior que pague')
  if (p.tipo === 'brinde') {
    const x = catalogo.produtos.find((y) => y.id === p.valor.produto)
    if (!x) erro(`brinde "${p.valor.produto}" não existe`)
    else if (FORA.has(x.categoria)) erro(`brinde "${p.valor.produto}" é de ${x.categoria}`)
  }
  for (const campo of [p.titulo, p.descricao, p.regra, p.comoUsar ?? '']) {
    const t = semAcento(campo)
    const w = PROIBIDAS.find((x) => new RegExp(`(^|[^a-z0-9])${x}`).test(t))
    if (w) erro(`palavra fora da lista ("${w}")`)
  }
  // o prêmio só vale com todos os produtos dele no catálogo de agora (como premiosValidos do site)
  if (!config.dadosDeExemplo && p.demo) continue
  if (alvos.some((id) => !porId.has(id)) || (p.tipo === 'brinde' && !porId.has(p.valor.produto))) continue
  // estados onde dá pra usar: algum produto do prêmio disponível lá (e o brinde também)
  const ufs = ufsAtendidas.filter((uf) => {
    const alvo = produtos.some((x) => (alvos.includes(x.id) || cats.includes(x.categoria)) && x.disponivel?.[uf])
    if (!alvo) return false
    return p.tipo !== 'brinde' || !!porId.get(p.valor.produto)?.disponivel?.[uf]
  })
  saida.push({
    id: p.id,
    tipo: p.tipo,
    valor: p.valor,
    titulo: p.titulo,
    descricao: p.descricao,
    regra: p.regra,
    aplicaA: Object.fromEntries(Object.entries(p.aplicaA).filter(([, v]) => Array.isArray(v) && v.length)),
    ...(p.comoUsar ? { comoUsar: p.comoUsar } : {}),
    peso: p.peso,
    validadeDias: p.validadeDias,
    demo: !!p.demo,
    ufs,
  })
}
if (problemas.length) {
  console.error(problemas.join('\n'))
  process.exit(1)
}

const json = `${JSON.stringify(
  {
    _leia: 'Gerado de src/dados/sorte.ts e do catálogo por scripts/gerar-premios-sorte.mjs. Não edite à mão.',
    ufsAtendidas,
    premios: saida,
  },
  null,
  2,
)}\n`

if (process.argv.includes('--conferir')) {
  const atual = existsSync(destino) ? readFileSync(destino, 'utf8') : ''
  if (atual !== json) {
    console.error('premios-sorte.json está velho: rode node scripts/gerar-premios-sorte.mjs')
    process.exit(1)
  }
  console.log('premios-sorte.json em dia')
} else {
  writeFileSync(destino, json)
  console.log(`premios-sorte.json: ${saida.length} prêmios`)
}
