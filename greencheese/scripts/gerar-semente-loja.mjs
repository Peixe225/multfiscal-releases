// Semente da loja no servidor: lê src/dados (catálogo, canais, config, prêmios do Teste minha sorte e os textos da
// loja) e grava public/api/nucleo/semente-loja.json. O servidor nasce com ela: na instalação do painel e, num banco já
// instalado, numa migração (a 101). Depois de semeada, quem manda na loja é o painel; mexer em src/dados muda só o que
// vai embutido no site (a reserva quando o servidor não responde) e a semente de um banco novo.
// Uso: node scripts/gerar-semente-loja.mjs             (grava)
//      node scripts/gerar-semente-loja.mjs --conferir  (só confere: sai com erro se a semente estiver velha)
// O build (vite.config.ts, plugin sementeEmDia) e o scripts/testar-api.mjs conferem também.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const raiz = fileURLToPath(new URL('..', import.meta.url))
export const ARQUIVO_SEMENTE = `${raiz}public/api/nucleo/semente-loja.json`

/** Lê um .ts de src/dados (sem import dentro: o gerador tira os tipos e roda), sem depender da versão do Node. */
async function lerTs(relativo) {
  const { transformWithOxc } = await import('vite')
  const arquivo = `${raiz}${relativo}`
  const { code } = await transformWithOxc(readFileSync(arquivo, 'utf8'), arquivo, { lang: 'ts' })
  if (/^\s*import\s/m.test(code)) throw new Error(`${relativo} importa outro arquivo: a semente só lê arquivo de dado sem import`)
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
}

const so = (o, chaves) => Object.fromEntries(chaves.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]))

/** A semente, montada de src/dados. Erro claro se algo não fecha (categoria que não existe, número torto…). */
export async function montarSemente() {
  const catalogo = JSON.parse(readFileSync(`${raiz}src/dados/catalogo.json`, 'utf8'))
  const { canaisEmbutidos: canais } = await lerTs('src/dados/canais.ts')
  const { config } = await lerTs('src/dados/config.ts')
  const { premios, regrasSorte } = await lerTs('src/dados/sorte.ts')
  const { textosLoja } = await lerTs('src/dados/textos-loja.ts')

  const categorias = catalogo.categorias.map((c) => ({ id: c.id, nome: c.nome, curto: c.curto, icone: c.icone, bebida: c.bebida === true }))
  const ids = new Set(categorias.map((c) => c.id))
  const produtos = catalogo.produtos.map((p) => {
    if (!ids.has(p.categoria)) throw new Error(`produto ${p.id}: categoria "${p.categoria}" não existe`)
    return {
      id: p.id,
      nome: p.nome,
      tamanho: p.tamanho ?? '',
      detalhe: p.detalhe ?? '',
      descricao: p.descricao ?? '',
      categoria: p.categoria,
      preco: p.preco ?? null,
      combos: (p.combos ?? []).map((c) => ({ qtd: c.qtd, total: c.total })),
      variacoes: (p.variacoes ?? []).map((v) => so(v, ['id', 'nome', 'preco'])),
      combinaCom: p.combinaCom ?? [],
      disponivel: p.disponivel,
      foto: p.foto ?? null,
      cor: p.cor,
      arte: p.arte,
      demo: p.demo === true,
      obs: p.obs ?? '',
    }
  })
  const estados = canais.map((c) => {
    if (c.whatsapp !== null && !/^55\d{2}9\d{8}$/.test(c.whatsapp)) throw new Error(`canal ${c.uf}: WhatsApp "${c.whatsapp}" não é 55 + DDD + 9 dígitos`)
    return {
      uf: c.uf,
      destaque: c.destaque,
      nomePerfil: c.nomePerfil,
      instagram: c.instagram,
      whatsapp: c.whatsapp,
      cidades: c.cidades.map((x) => ({ slug: x.slug, nome: x.nome })),
      horario: { semana: c.horario.semana, demo: c.horario.demo },
      taxaEntrega: { valor: c.taxaEntrega.valor, demo: c.taxaEntrega.demo },
      entregaGratis: c.entregaGratis ? { dias: [...c.entregaGratis.dias], texto: c.entregaGratis.texto, demo: c.entregaGratis.demo } : null,
      pagamento: { opcoes: c.pagamento.opcoes, demo: c.pagamento.demo },
      emblema: c.emblema,
    }
  })
  return {
    _leia: 'Gerado por scripts/gerar-semente-loja.mjs a partir de src/dados (não edite à mão). É a loja com que o servidor nasce; depois, quem manda é o painel.',
    formato: 1,
    ajustes: {
      whatsapp: config.whatsappPedidos,
      // o mesmo pra todos enquanto nenhum estado tem número próprio
      mesmoWhatsappParaTodos: canais.every((c) => c.whatsapp === null),
      restamAte: config.restamAte,
    },
    textos: textosLoja,
    categorias,
    produtos,
    estados,
    stories: {},
    sorte: {
      ligado: true,
      regras: {
        girosSemConta: regrasSorte.girosSemConta,
        girosPorDiaComConta: regrasSorte.girosPorDiaComConta,
        reservaSemContaHoras: regrasSorte.reservaSemContaHoras,
      },
      premios: premios.map((p) => so(p, ['id', 'tipo', 'valor', 'titulo', 'descricao', 'regra', 'aplicaA', 'comoUsar', 'peso', 'validadeDias', 'demo'])),
    },
  }
}

export async function textoDaSemente() {
  return `${JSON.stringify(await montarSemente(), null, 2)}\n`
}

/** null = em dia; senão, a frase do problema. */
export async function conferirSemente() {
  let atual = ''
  try {
    atual = readFileSync(ARQUIVO_SEMENTE, 'utf8')
  } catch {
    return 'falta public/api/nucleo/semente-loja.json: rode node scripts/gerar-semente-loja.mjs'
  }
  return atual === (await textoDaSemente()) ? null : 'a semente da loja (public/api/nucleo/semente-loja.json) está velha: mudou algo em src/dados. Rode node scripts/gerar-semente-loja.mjs'
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--conferir')) {
    const erro = await conferirSemente()
    console.log(erro ?? 'semente em dia')
    process.exit(erro ? 1 : 0)
  }
  const texto = await textoDaSemente()
  writeFileSync(ARQUIVO_SEMENTE, texto)
  const s = JSON.parse(texto)
  console.log(`semente gravada: ${s.categorias.length} categorias, ${s.produtos.length} produtos, ${s.estados.length} estados, ${s.sorte.premios.length} prêmios`)
}
