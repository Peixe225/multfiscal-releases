/**
 * Põe os criativos (catálogo + miniaturas) dentro do guia de lançamento.
 *
 *   node scripts/gravar/guia-dados.mjs saida/ guia.html [https://oprojeto.online/lenda/criativos/]
 *
 * Troca o conteúdo de <script id="dados-criativos" type="application/json">…</script> pela lista dos
 * vídeos, com a miniatura de cada um embutida (data: URI — a página do claude.ai não carrega imagem de fora).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const [dir, guia, base = 'https://oprojeto.online/lenda/criativos/'] = process.argv.slice(2)
const cat = JSON.parse(readFileSync(join(dir, '_catalogo.json'), 'utf8'))
const itens = cat.map((i) => {
  const mini = join(dir, `${i.nome}-mini.jpg`)
  return {
    nome: i.nome, titulo: i.titulo ?? i.nome, faixa: i.faixa, formato: i.formato, duracao: i.duracao,
    nota: i.nota ?? null, tier: i.tier ?? null, headline: i.headline ?? null, jogador: i.jogador ?? null, pais: i.pais ?? null, posicao: i.posicao ?? null,
    resumo: i.resumo ?? '', gancho: i.gancho ?? '', legenda: i.legenda ?? '', hashtags: i.hashtags ?? '', ideia: i.ideia ?? '',
    url: base + `${i.nome}.mp4`, corte: i.corte ? base + `${i.nome}-corte.mp4` : null, mb: i.mb,
    thumb: existsSync(mini) ? `data:image/jpeg;base64,${readFileSync(mini).toString('base64')}` : '',
    marcas: (i.marcas ?? []).map(({ t, o, i: n, escolha }) => ({ t, o, ...(n != null ? { i: n } : {}), ...(escolha ? { escolha } : {}) })),
  }
})
const html = readFileSync(guia, 'utf8')
const re = /(<script id="dados-criativos" type="application\/json">)([\s\S]*?)(<\/script>)/
if (!re.test(html)) throw new Error('o guia não tem <script id="dados-criativos" type="application/json">')
const json = JSON.stringify(itens).replace(/</g, '\\u003c')
writeFileSync(guia, html.replace(re, (_, a, _b, c) => a + json + c))
console.log(`${itens.length} criativos no guia (${(json.length / 1e6).toFixed(2)} MB de dados)`)
