// LENDA · teste do painel (v3.3): planta o que as abas Mensagens e Desafios precisam, pelo mesmo caminho do jogo
// (conta.php, suporte.php, carreiras.php) e do admin (admin.php pelo Bearer): mensagens do Fale conosco com e sem conta
// (algumas com mais de 24 h, para o "Precisa de atenção"), contas com o e-mail confirmado e 30+ partidas, e carreiras do
// Clássico com 3 Copas e 2 Libertadores e o replay de uma carreira real gravada (scripts/gravar/filas/classico.json), que
// viram candidatas sozinhas quando os desafios de fábrica são ativados. O prêmio é um texto de teste. Nomes e e-mails
// inventados (@exemplo.com). semearV33() devolve os ids; rodando sozinho (node semente-v33.mjs), grava semente-v33.json.
import { readFileSync, writeFileSync } from 'node:fs'
import { BASE, admin, esc, exigir, pedido, sql, uuid } from './lib.mjs'

const AMOSTRA = new URL('../amostras/v33/v-intenso-03.json', import.meta.url).pathname
const FILA = new URL('../../../scripts/gravar/filas/classico.json', import.meta.url).pathname
export const PREMIO_TESTE = 'Kit do LENDA com camisa autografada (texto de teste do painel).'

let n = 0
/** Conta nova (cada uma com o seu IP): {id, apelido, email, cookie, ip}. */
export async function contaNova(apelido) {
  const ip = `10.33.${(++n) >> 8}.${(n & 255) + 1}`
  const email = `v33-${apelido.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '.')}-${Date.now().toString(36)}@exemplo.com`
  const r = await pedido('api/conta.php', { ip, corpo: { acao: 'cadastrar', apelido, email, senha: 'segredo-v33-1', aceite: true, vid: uuid() } })
  exigir(r, 201, `cadastro de ${apelido}`)
  return { id: r.json.usuario.id, apelido, email, cookie: r.cookie, ip }
}

/** O replay de uma carreira real gravada, no formato do contrato (sem o title das escolhas). */
function replayReal(i = 0) {
  const fila = JSON.parse(readFileSync(FILA, 'utf8'))
  const f = fila[i % fila.length]
  return { v: 1, seed: [f.a0, f.a1], identity: f.identity, pace: f.pace, picks: f.picks.map((p) => ({ id: p.id, kind: p.kind, idx: p.idx, pen: p.pen, n: p.n })), bonusOvr: 0, dados: 'lenda-dados-teste-painel' }
}

/** HallEntry real (amostra v33) com exatamente `copas` Copas e `lib` Libertadores; replay real ou nenhum. */
function hallEntry(id, nome, copas, lib, comReplay, nota = 80) {
  const j = JSON.parse(readFileSync(AMOSTRA, 'utf8'))
  const h = j.hall ? j.hall[0] : j
  h.id = id
  if (h.career) h.career.id = id
  h.legacy = { score: nota, raw: nota * 0.6, at: new Date().toISOString(), v: 2 }
  h.summary.legacyScore = nota
  h.identity = { ...(h.identity ?? {}), surname: nome }
  if (h.summary.identity) h.summary.identity = { ...h.summary.identity, surname: nome }
  if (h.career?.identity) h.career.identity = { ...h.career.identity, surname: nome }
  const tr = (h.summary.trophies || []).filter((t) => t.trophyId !== 'world-cup' && t.trophyId !== 'libertadores')
  if (copas) tr.push({ trophyId: 'world-cup', count: copas, seasons: [2033, 2037, 2041, 2045].slice(0, copas) })
  if (lib) tr.push({ trophyId: 'libertadores', count: lib, seasons: [2030, 2031, 2034].slice(0, lib) })
  h.summary.trophies = tr
  if (comReplay) h.replay = replayReal(0)
  return h
}

async function salvarCarreira(j, h) {
  const r = await pedido('api/carreiras.php', { ip: j.ip, cookie: j.cookie, corpo: { acao: 'salvar', carreira: h, como: 'manual' } })
  exigir(r, [200, 201], `salvar a carreira de ${j.apelido}`)
  return Number(sql(`SELECT id FROM carreiras WHERE usuario_id = ${j.id} AND carreira_id = '${esc(h.id)}'`))
}

/** Uma mensagem pelo Fale conosco (com cookie = da conta; sem, com o e-mail). Devolve {id, protocolo}. */
async function mensagem(o) {
  const ip = `10.34.${(++n) >> 8}.${(n & 255) + 1}`
  const corpo = { tipo: o.tipo, mensagem: o.mensagem, pagina: o.pagina }
  if (!o.conta) corpo.email = o.email
  const r = await pedido('api/suporte.php', { ip, cookie: o.conta ? o.conta.cookie : undefined, corpo })
  exigir(r, 201, `mensagem (${o.tipo})`)
  const id = Number(sql(`SELECT id FROM mensagens_suporte WHERE protocolo = '${esc(r.json.protocolo)}'`))
  return { id, protocolo: r.json.protocolo }
}

export async function semearV33() {
  const t0 = performance.now()
  const idDe = (slug) => Number(sql(`SELECT id FROM desafios WHERE slug = '${slug}'`))
  // ── contas: A, B e C cumprem tudo (e-mail confirmado, 40 partidas); Sem Código não confirmou o e-mail ──
  const A = await contaNova('Taça Um')
  const B = await contaNova('Taça Dois')
  const C = await contaNova('Taça Três')
  const semCodigo = await contaNova('Sem Código')
  const falante = await contaNova('Fala Muito')
  for (const j of [A, B, C]) sql(`UPDATE usuarios SET email_verificado_em = UTC_TIMESTAMP(), partidas_conta = 40 WHERE id = ${j.id}`)
  sql(`UPDATE usuarios SET partidas_conta = 12 WHERE id = ${semCodigo.id}`)

  // ── Fale conosco: com e sem conta, todos os assuntos; duas com mais de 24 h (o alerta); uma com HTML (vira texto) ──
  const m = {}
  m.duvida = await mensagem({ conta: falante, tipo: 'duvida', pagina: '/hall', mensagem: 'Como faço para a minha carreira aparecer no Hall das Lendas?\nJá salvei duas e nenhuma apareceu.' })
  m.ideia = await mensagem({ conta: A, tipo: 'ideia', pagina: '/carreira', mensagem: 'Seria legal poder escolher o número da camisa no meio da carreira, quando troca de clube.' })
  m.problema = await mensagem({ email: 'visitante.um@exemplo.com', tipo: 'problema', pagina: '/carreira', mensagem: 'O jogo travou na decisão do pênalti na final da Copa. Recarreguei e voltou para a temporada anterior.' })
  m.html = await mensagem({ email: 'visitante.dois@exemplo.com', tipo: 'outro', pagina: '/', mensagem: 'Teste de texto com <img src=x onerror="window.__xss=1"> e <b>negrito</b> que tem de aparecer como texto.' })
  m.recomendacao = await mensagem({ conta: B, tipo: 'recomendacao', pagina: '/desafios', mensagem: 'Recomendo mostrar no desafio quantas partidas faltam para eu poder participar. ' + 'Fica mais claro assim. '.repeat(20) })
  m.lida = await mensagem({ conta: falante, tipo: 'problema', pagina: '/conta', mensagem: 'Não chegou o e-mail com o código para confirmar a conta.' })
  m.respondida = await mensagem({ email: 'visitante.tres@exemplo.com', tipo: 'duvida', pagina: '/', mensagem: 'O jogo é de graça mesmo? Tem versão para celular?' })
  m.arquivada = await mensagem({ conta: C, tipo: 'outro', pagina: '/', mensagem: 'Só passando para dizer que o jogo é muito bom!' })
  sql(`UPDATE mensagens_suporte SET criado_em = UTC_TIMESTAMP() - INTERVAL 30 HOUR WHERE id IN (${m.duvida.id}, ${m.problema.id})`)
  sql(`UPDATE mensagens_suporte SET criado_em = UTC_TIMESTAMP() - INTERVAL 50 HOUR WHERE id IN (${m.lida.id}, ${m.respondida.id}, ${m.arquivada.id})`)
  exigir(await admin({ acao: 'suporte_status', id: m.lida.id, status: 'lida' }), 200, 'suporte_status lida')
  exigir(await admin({ acao: 'suporte_responder', id: m.respondida.id, resposta: 'É de graça, sim! Funciona no navegador do celular e do computador.' }), 200, 'suporte_responder')
  exigir(await admin({ acao: 'suporte_status', id: m.arquivada.id, status: 'arquivada' }), 200, 'suporte_status arquivada')

  // ── desafios de fábrica: prêmio de teste, prazo e ativos (as Taças e as 3 Copas); o de conquistas fica desativado ──
  const dTacas = idDe('tacas-do-rei')
  const dCopas = idDe('tacas-do-rei-copas')
  const dConq = idDe('todas-as-conquistas')
  exigir(await admin({ acao: 'desafio_salvar', id: dTacas, premio: PREMIO_TESTE, fim: '2026-12-31' }), 200, 'desafio_salvar')
  exigir(await admin({ acao: 'desafio_ativar', id: dTacas, ativo: true }), 200, 'ativar Taças do Rei')
  exigir(await admin({ acao: 'desafio_ativar', id: dCopas, ativo: true }), 200, 'ativar as 3 Copas')
  // o início é a hora da ativação: as carreiras salvas no mesmo segundo podiam empatar com ele
  await new Promise((r) => setTimeout(r, 1100))

  // ── carreiras: A (3 Copas + 2 Lib.) antes de B (o mesmo), C só com 3 Copas, Sem Código (e-mail não confirmado) ──
  const pkA = await salvarCarreira(A, hallEntry('career-v33-painel-a', 'PRIMEIRO', 3, 2, true))
  await new Promise((r) => setTimeout(r, 30))
  const pkB = await salvarCarreira(B, hallEntry('career-v33-painel-b', 'SEGUNDO', 3, 2, true))
  await new Promise((r) => setTimeout(r, 30))
  const pkC = await salvarCarreira(C, hallEntry('career-v33-painel-c', 'TERCEIRO', 3, 0, true))
  await salvarCarreira(semCodigo, hallEntry('career-v33-painel-d', 'SEMCODIGO', 3, 2, true))
  const cand = (d, pk) => Number(sql(`SELECT id FROM desafio_candidatos WHERE desafio_id = ${d} AND carreira_pk = ${pk}`) || 0)
  const kA = cand(dTacas, pkA)
  const kB = cand(dTacas, pkB)
  const kAc = cand(dCopas, pkA)
  const kBc = cand(dCopas, pkB)
  const kCc = cand(dCopas, pkC)
  if (!kA || !kB || !kAc || !kBc || !kCc) throw new Error(`os candidatos não nasceram: A=${kA} B=${kB} Ac=${kAc} Bc=${kBc} Cc=${kCc} · ${sql('SELECT desafio_id, carreira_pk, estado FROM desafio_candidatos')}`)
  // A bateu na verificação pelo jogo; B não bateu (as Copas refeitas deram 2): o detalhe no formato que o jogo manda
  const numeros = (copas) => ({ copas, libertadores: 2, bolasOuro: 3, titulos: 31, gols: 612, pico: 91, nota: 80, jogos: 801, temporadas: 24 })
  exigir(await admin({ acao: 'candidato_verificar', id: kA, resultado: { ok: true, detalhes: { v: 1, motivo: null, diferencas: [], guardado: numeros(3), refeito: numeros(3), passos: 24, divergencia: null, avisos: [], dadosCarreira: 'lenda-dados-teste-painel', dadosJogo: 'lenda-dados-teste-painel', ms: 2140 } } }), 200, 'verificar A')
  exigir(await admin({ acao: 'candidato_verificar', id: kB, resultado: { ok: false, detalhes: { v: 1, motivo: 'Não bateu na verificação pelo jogo. Copas do Mundo: 3 → 2', diferencas: [{ campo: 'copas', guardado: 3, refeito: 2 }], guardado: numeros(3), refeito: numeros(2), passos: 24, divergencia: null, avisos: [], dadosCarreira: 'lenda-dados-teste-painel', dadosJogo: 'lenda-dados-teste-painel', ms: 1980 } } }), 200, 'verificar B')
  exigir(await admin(null, { r: 'atencao', atualizar: '1' }), 200, 'atencao')
  const r = {
    contas: { A, B, C, semCodigo, falante }, mensagens: m, desafios: { tacas: dTacas, copas: dCopas, conquistas: dConq },
    carreiras: { A: pkA, B: pkB, C: pkC }, candidatos: { A: kA, B: kB, Ac: kAc, Bc: kBc, Cc: kCc },
  }
  console.log(`· semente v3.3: ${Object.keys(m).length} mensagens, 2 desafios ativos, ${sql('SELECT COUNT(*) FROM desafio_candidatos')} candidatos em ${((performance.now() - t0) / 1000).toFixed(1)} s`)
  return r
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await semearV33()
  writeFileSync(`${BASE}/semente-v33.json`, JSON.stringify(r, null, 1))
}
