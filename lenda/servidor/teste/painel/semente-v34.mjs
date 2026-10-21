// LENDA · teste do painel (v3.4): planta o que a aba Desafios (emblemas) e a ficha da conta (conquistas provadas,
// emblemas) precisam, pelo mesmo caminho do jogo (conta.php, conquistas.php, carreiras.php) e do admin (admin.php pelo
// Bearer). Roda depois da semente da v3.3 (as contas dela já ganharam o emblema das Taças do Rei: 3 Copas + 2 Libertadores).
//   · Galáctico (BRA): carreira-prova com 3 Champions e 5 Bolas de Ouro (Noite de gala, Era de ouro e, pela Copa do Brasil,
//     Hexa e Glória Eterna), conferida no replay (prova_verificar ok); mais 3 conquistas só do aparelho (não provadas).
//   · Andarilho: carreira-prova com 12 clubes e 20+ títulos (Andarilho campeão) que NÃO bateu no replay: o emblema sai sozinho.
//   · Bandeira: 18 temporadas no mesmo clube (Bandeira do clube), sem verificação.
//   · Sem Semente: a mesma carreira do Galáctico, mas sem a semente do servidor: não prova nada e não ganha emblema.
//   · Colecionador: uma carreira-prova com as 87 conquistas na lista (o servidor guarda o que o motor gravou), e-mail
//     confirmado e 40 partidas: vira candidato ao desafio de todas as conquistas quando ele é ativado (no teste).
//   · O emblema das Taças do Rei da conta "Taça Um" (v3.3) é retirado pela equipe, com o motivo (o filtro "Retirados").
// Nomes e e-mails inventados (@exemplo.com). semearV34() devolve os ids; sozinho (node semente-v34.mjs), grava semente-v34.json.
import { readFileSync, writeFileSync } from 'node:fs'
import { BASE, admin, esc, exigir, pedido, sql, uuid } from './lib.mjs'

const AMOSTRA = new URL('../amostras/v33/v-intenso-03.json', import.meta.url).pathname
const FILA = new URL('../../../scripts/gravar/filas/classico.json', import.meta.url).pathname
const NOMES = new URL('../../painel/nomes.json', import.meta.url).pathname
export const MOTIVO_RETIRADA = 'Teste do painel: emblema retirado pela equipe.'

let n = 0
async function contaNova(apelido) {
  const ip = `10.44.${(++n) >> 8}.${(n & 255) + 1}`
  const email = `v34-${apelido.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '.')}-${Date.now().toString(36)}@exemplo.com`
  const r = await pedido('api/conta.php', { ip, corpo: { acao: 'cadastrar', apelido, email, senha: 'segredo-v34-1', aceite: true, vid: uuid() } })
  exigir(r, 201, `cadastro de ${apelido}`)
  return { id: r.json.usuario.id, apelido, email, cookie: r.cookie, ip }
}
const fila = () => JSON.parse(readFileSync(FILA, 'utf8'))
/** O replay de uma carreira real gravada (a i-ésima da fila), no formato do contrato. */
function replayReal(i) {
  const f = fila()[i % fila().length]
  return { v: 1, seed: [f.a0, f.a1], identity: f.identity, pace: f.pace, picks: f.picks.map((p) => ({ id: p.id, kind: p.kind, idx: p.idx, pen: p.pen, n: p.n })), bonusOvr: 0, dados: 'lenda-dados-teste-painel' }
}
/** A semente da i-ésima da fila, como sorteada pelo servidor para a conta (CONTRATO-v33 §E: é o que faz a carreira valer). */
function sementeDoServidor(conta, i) {
  const f = fila()[i % fila().length]
  sql(`INSERT IGNORE INTO sementes_carreira (usuario_id, semente, dia, emitida_em) VALUES (${conta.id}, '${f.a0.toString(36) + f.a1.toString(36)}', UTC_DATE(), UTC_TIMESTAMP(3))`)
}
/** HallEntry real (amostra v33, BRA) com o replay real i e o que cada conta precisa (mudar(h) mexe no resumo). */
function hallEntry(id, nome, i, mudar, conquistas) {
  const j = JSON.parse(readFileSync(AMOSTRA, 'utf8'))
  const h = j.hall ? j.hall[0] : j
  h.id = id
  if (h.career) h.career.id = id
  h.legacy = { score: 84, raw: 50.4, at: new Date().toISOString(), v: 2 }
  h.summary.legacyScore = 84
  h.identity = { ...(h.identity ?? {}), surname: nome }
  if (h.summary.identity) h.summary.identity = { ...h.summary.identity, surname: nome }
  if (h.career?.identity) h.career.identity = { ...h.career.identity, surname: nome }
  h.replay = replayReal(i)
  // a seleção da criação (a do replay) é a do fim: a do jogador da amostra
  h.replay.identity = { ...h.replay.identity, nationality: h.identity.nationality }
  if (conquistas && h.career) h.career.achievements = conquistas
  h.conquistas = { v: 2 }
  if (mudar) mudar(h)
  return h
}
async function salvar(conta, h) {
  const r = await pedido('api/carreiras.php', { ip: conta.ip, cookie: conta.cookie, corpo: { acao: 'salvar', carreira: h, como: 'manual' } })
  exigir(r, [200, 201], `salvar a carreira de ${conta.apelido}`)
  return { pk: Number(sql(`SELECT id FROM carreiras WHERE usuario_id = ${conta.id} AND carreira_id = '${esc(h.id)}'`)), resp: r.json }
}

export async function semearV34() {
  const t0 = performance.now()
  const idDe = (slug) => Number(sql(`SELECT id FROM desafios WHERE slug = '${slug}'`))
  const nomes = JSON.parse(readFileSync(NOMES, 'utf8'))
  const todas = Object.keys(nomes.conquistas)
  const clubes = Object.keys(nomes.clubes).slice(0, 40)

  const G = await contaNova('Galáctico')
  const A = await contaNova('Andarilho')
  const B = await contaNova('Bandeira')
  const S = await contaNova('Sem Semente')
  const K = await contaNova('Colecionador')
  sql(`UPDATE usuarios SET email_verificado_em = UTC_TIMESTAMP(), partidas_conta = 40 WHERE id IN (${G.id}, ${A.id}, ${B.id}, ${K.id})`)
  sementeDoServidor(G, 1)
  sementeDoServidor(A, 2)
  sementeDoServidor(B, 3)
  sementeDoServidor(K, 4)
  // Galáctico: as conquistas da amostra (as do motor) e mais 3 que vieram só do aparelho
  const amostra = JSON.parse(readFileSync(AMOSTRA, 'utf8'))
  const daAmostra = ((amostra.hall ? amostra.hall[0] : amostra).career.achievements || []).filter((x) => todas.includes(x))
  const doAparelho = todas.filter((x) => !daAmostra.includes(x)).slice(0, 3)
  const hoje = Date.now()
  exigir(await pedido('api/conquistas.php', { ip: G.ip, cookie: G.cookie, corpo: { acao: 'sincronizar', conquistas: doAparelho.map((id, i) => ({ id, em: new Date(hoje - (i + 2) * 86400000).toISOString() })) } }), 200, 'sincronizar do aparelho')

  // ── carreiras ──
  const champions = (h) => {
    h.summary.trophies = (h.summary.trophies || []).filter((t) => t.trophyId !== 'champions-league').concat([{ trophyId: 'champions-league', count: 3, seasons: [2038, 2039, 2043] }])
    h.summary.awards = (h.summary.awards || []).map((a) => (a.award === 'ballon_dor' ? { ...a, count: 5, years: [2036, 2041, 2042, 2044, 2045] } : a))
  }
  const g = await salvar(G, hallEntry('career-v34-painel-galactico', 'GALACTICO', 1, champions))
  const a = await salvar(A, hallEntry('career-v34-painel-andarilho', 'ANDARILHO', 2, (h) => {
    h.summary.clubs = clubes.slice(0, 12).map((clubId, i) => ({ clubId, seasons: 2, apps: 60, goals: 30 + i, assists: 10, trophies: 2, loan: false }))
  }))
  const b = await salvar(B, hallEntry('career-v34-painel-bandeira', 'BANDEIRA', 3, (h) => {
    h.summary.clubs = [{ clubId: clubes[20], seasons: 19, apps: 700, goals: 400, assists: 150, trophies: 30, loan: false }, { clubId: clubes[21], seasons: 2, apps: 40, goals: 10, assists: 5, trophies: 1, loan: false }]
  }))
  const s = await salvar(S, hallEntry('career-v34-painel-semsemente', 'SEMSEMENTE', 1, champions))
  const k = await salvar(K, hallEntry('career-v34-painel-colecionador', 'COLECIONADOR', 4, null, todas))

  // ── verificação das provas: a do Galáctico bateu; a do Andarilho não (o emblema dela sai sozinho) ──
  const conquistasG = JSON.parse(sql(`SELECT conquistas FROM carreiras WHERE id = ${g.pk}`) || '[]')
  exigirOk(await admin({ acao: 'prova_verificar', resultados: [
    { carreira: g.pk, ok: true, detalhes: { v: 1, motivo: null, diferencas: [], passos: 24, avisos: [], conquistas: { regras: 2, aceitas: conquistasG.length, faltam: [], sobram: [] }, ms: 2310 } },
    { carreira: a.pk, ok: false, detalhes: { v: 1, motivo: 'Não bateu na verificação por replay. Clubes diferentes: 12 → 9', diferencas: [{ campo: 'clubes', guardado: 12, refeito: 9 }], passos: 24, avisos: [], ms: 2050 } },
  ] }), 'prova_verificar')

  // ── a equipe tira o emblema das Taças do Rei de uma conta da v3.3 (o filtro "Retirados") ──
  const dTacasE = idDe('tacas-do-rei-emblema')
  const umaTaca = Number(sql(`SELECT e.id FROM emblemas_usuario e JOIN usuarios u ON u.id = e.usuario_id WHERE e.desafio_id = ${dTacasE} AND u.apelido = 'Taça Um'`) || 0)
  if (umaTaca) exigirOk(await admin({ acao: 'emblema_retirar', id: umaTaca, motivo: MOTIVO_RETIRADA }), 'emblema_retirar')

  const emb = (uid, slug) => sql(`SELECT IFNULL(MAX(e.estado), '-') FROM emblemas_usuario e JOIN desafios d ON d.id = e.desafio_id WHERE e.usuario_id = ${uid} AND d.slug = '${slug}'`)
  const r = {
    contas: { G, A, B, S, K }, carreiras: { G: g.pk, A: a.pk, B: b.pk, S: s.pk, K: k.pk }, doAparelho, retiradoTacas: umaTaca,
    desafios: Object.fromEntries(['noite-de-gala', 'andarilho-campeao', 'bandeira-do-clube', 'hexa-e-gloria-eterna', 'era-de-ouro', 'tacas-do-rei-emblema', 'todas-as-conquistas', 'tacas-do-rei'].map((x) => [x, idDe(x)])),
    emblemas: { G: { gala: emb(G.id, 'noite-de-gala'), era: emb(G.id, 'era-de-ouro'), hexa: emb(G.id, 'hexa-e-gloria-eterna') }, A: emb(A.id, 'andarilho-campeao'), B: emb(B.id, 'bandeira-do-clube'), S: emb(S.id, 'noite-de-gala') },
  }
  console.log(`· semente v3.4: 5 contas, ${sql('SELECT COUNT(*) FROM emblemas_usuario')} emblemas (${sql("SELECT COUNT(*) FROM emblemas_usuario WHERE estado = 'retirado'")} retirados), `
    + `${sql('SELECT COUNT(*) FROM carreiras WHERE conquistas IS NOT NULL')} carreiras com a lista em ${((performance.now() - t0) / 1000).toFixed(1)} s · Galáctico ${JSON.stringify(r.emblemas.G)}, Andarilho ${r.emblemas.A}, Bandeira ${r.emblemas.B}, Sem Semente ${r.emblemas.S}`)
  return r
}
function exigirOk(r, oque) { if (r.status !== 200) throw new Error(`${oque}: ${r.status} ${r.txt.slice(0, 300)}`) }

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await semearV34()
  writeFileSync(`${BASE}/semente-v34.json`, JSON.stringify(r, null, 1))
}
