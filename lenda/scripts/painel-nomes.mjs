#!/usr/bin/env node
/**
 * nomes.json do painel do administrador (servidor/painel/nomes.json): os nomes em pt-BR que o painel mostra no lugar
 * dos ids — clubes, países, troféus, prêmios individuais e conquistas (título, raridade, descrição). Tudo sai dos
 * dados do jogo, então o painel nunca fica com um nome velho:
 *   · clubes, países e troféus: src/data/generated/game-data.json (o `npm run data`);
 *   · prêmios: o AWARD_NAME de src/ui/classic/summary/model.ts (o mesmo texto do Resumo de carreira);
 *   · conquistas: o ACHIEVEMENTS de src/engine/career/achievements.ts (carregado pelo vite, sem compilar o jogo).
 *
 * O build do site (scripts/build-site.mjs) chama gerarNomesPainel() e grava em dist-site/painel/nomes.json.
 * Uso à mão (atualiza a cópia do repositório, que o teste do painel usa): node scripts/painel-nomes.mjs [saída]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = fileURLToPath(new URL('..', import.meta.url))

/** O objeto literal `export const AWARD_NAME: … = { chave: 'texto', … }` do model.ts (só pares chave: 'texto'). */
function lerPremios(arquivo) {
  const fonte = readFileSync(arquivo, 'utf8')
  const ini = fonte.indexOf('export const AWARD_NAME')
  if (ini < 0) throw new Error('AWARD_NAME não encontrado em ' + arquivo)
  const corpo = fonte.slice(fonte.indexOf('{', ini) + 1, fonte.indexOf('}', ini))
  const out = {}
  for (const m of corpo.matchAll(/^\s*([a-z_]+)\s*:\s*(['"])(.*?)\2\s*,?\s*$/gm)) out[m[1]] = m[3]
  if (!Object.keys(out).length) throw new Error('AWARD_NAME vazio em ' + arquivo)
  return out
}

/** As conquistas do motor do jogo (o vite carrega o TypeScript com os aliases do projeto). */
async function lerConquistas() {
  const { runnerImport } = await import('vite')
  const { module: m } = await runnerImport('/src/engine/career/achievements.ts', {
    root: raiz,
    configFile: false,
    logLevel: 'error',
    resolve: { alias: { '@': join(raiz, 'src') } },
  })
  const lista = Array.isArray(m.ACHIEVEMENTS) ? m.ACHIEVEMENTS : []
  if (!lista.length) throw new Error('ACHIEVEMENTS vazio')
  const out = {}
  for (const a of lista) out[a.id] = { t: a.title, r: a.rarity, d: a.description }
  return out
}

/** Monta o nomes.json; com `saida`, grava o arquivo. Devolve as contagens. */
export async function gerarNomesPainel(opcoes = {}) {
  const dados = JSON.parse(readFileSync(join(raiz, 'src', 'data', 'generated', 'game-data.json'), 'utf8'))
  const mapa = (lista, k, v) => Object.fromEntries((Array.isArray(lista) ? lista : []).map((x) => [x[k], x[v]]))
  const nomes = {
    geradoEm: new Date().toISOString(),
    clubes: mapa(dados.clubs, 'id', 'name'),
    paises: mapa(dados.countries, 'code', 'name'),
    trofeus: mapa(dados.trophies, 'id', 'name'),
    premios: lerPremios(join(raiz, 'src', 'ui', 'classic', 'summary', 'model.ts')),
    conquistas: await lerConquistas(),
  }
  const contagem = Object.fromEntries(Object.entries(nomes).filter(([k]) => k !== 'geradoEm').map(([k, v]) => [k, Object.keys(v).length]))
  for (const [k, n] of Object.entries(contagem)) if (!n) throw new Error(`nomes.json do painel sem ${k}`)
  if (opcoes.saida) writeFileSync(opcoes.saida, JSON.stringify(nomes))
  return contagem
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const saida = resolve(process.argv[2] || join(raiz, 'servidor', 'painel', 'nomes.json'))
  const c = await gerarNomesPainel({ saida })
  console.log(`nomes.json do painel → ${saida}: ${Object.entries(c).map(([k, n]) => `${n} ${k}`).join(', ')}`)
}
