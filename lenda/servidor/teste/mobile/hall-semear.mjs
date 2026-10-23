// LENDA v3.5 · suíte mobile · Hall/Desafios/Conquistas — semeia a PILHA LOCAL (nunca a produção) para os testes do celular.
//
//   LENDA_INTEG_BASE=/tmp/lenda-v35-hall node servidor/teste/mobile/hall-semear.mjs
//
// O que faz (tudo pela API do servidor local + SQL do banco local, como o e2e.mjs):
//   1. joga pela tela (computador, ritmo Expresso, sem animação) N carreiras do Clássico sem conta, com sementes fixas e
//      países diferentes (para os filtros de país/clube terem o que mostrar);
//   2. cria 3 contas (conta.php cadastrar), salva e publica no Hall público uma carreira de cada uma (carreiras.php
//      salvar/publicar), confirma o e-mail da 1ª pelo banco e dá a ela uns emblemas de desafio e conquistas;
//   3. pede ao admin a fotografia nova do Hall (atualizar_hall);
//   4. grava em $BASE/hall-semente.json: as HallEntry (para semear o "Suas carreiras" do aparelho), o código do perfil
//      público, as contas (e-mail/senha) e os ids — os testes do celular leem daqui.
import { writeFileSync, existsSync, readFileSync } from 'node:fs'
import { BASE, URL0, admin, aparelho, jogarCarreira, lancar, lerKv, sql, sleep } from '../integracao/lib.mjs'

const SAIDA = `${BASE}/hall-semente.json`
if (existsSync(SAIDA) && !process.argv.includes('--de-novo')) {
  console.log(`já semeado (${SAIDA}); use --de-novo para refazer`)
  process.exit(0)
}
const N = Number(process.env.HALL_CARREIRAS ?? 3)
const PLANO = [
  { semente: [1004, 777], nacao: 'Bolívia', sobrenome: 'MAMANI' },
  { semente: [1011, 777], nacao: 'Brasil', sobrenome: 'FENOMENO' },
  { semente: [1002, 777], nacao: 'Argentina', sobrenome: 'RIQUELMINHO' },
  { semente: [1001, 777], nacao: 'Uruguai', sobrenome: 'MURALHA' },
].slice(0, N)

const browser = await lancar()
const A = await aparelho(browser, 'semeador', { partidas: 0 })
await A.page.goto(URL0)
await A.page.waitForSelector('.ld-modes', { timeout: 60000 })
const entradas = []
for (const p of PLANO) {
  const t0 = Date.now()
  const r = await jogarCarreira(A.page, { ...p, limiteMs: 480_000 })
  const hall = (await lerKv(A.page, 'hall')) ?? []
  const e = hall.find((h) => !entradas.some((x) => x.id === h.id))
  console.log(`  ${r.fim && e ? 'ok' : 'XX'}  carreira ${p.sobrenome} (${p.nacao}) em ${Math.round((Date.now() - t0) / 1000)} s${e ? ` · id ${e.id}` : ''}`)
  if (e) entradas.push(e)
}
await A.ctx.close()
if (!entradas.length) throw new Error('nenhuma carreira terminou')

// contas: cada uma num contexto próprio (cookie de sessão próprio)
const SENHA = 'segredo-forte-123'
const contas = []
const APELIDOS = ['Ian Mobile', 'Bia Celular', 'Zé do Toque', 'Duda Tela']
for (let i = 0; i < entradas.length; i++) {
  const C = await aparelho(browser, `conta${i}`, { partidas: 5 })
  await C.page.goto(URL0)
  await C.page.waitForSelector('.ld-modes', { timeout: 60000 })
  const email = `hall${i}.${Date.now()}@exemplo.com`
  const res = await C.page.evaluate(
    async ({ email, senha, apelido, h }) => {
      const post = async (url, corpo) => {
        const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(corpo) })
        let j = null
        try {
          j = await r.json()
        } catch {}
        return { s: r.status, j }
      }
      const cad = await post('api/conta.php', { acao: 'cadastrar', apelido, email, senha, aceite: true })
      const sal = await post('api/carreiras.php', { acao: 'salvar', carreira: h, como: 'manual' })
      const pub = await post('api/carreiras.php', { acao: 'publicar', id: h.id, sim: true })
      return { cad: cad.s, sal: sal.s, salJ: JSON.stringify(sal.j).slice(0, 200), pub: pub.s, pubJ: JSON.stringify(pub.j).slice(0, 200), uid: cad.j?.usuario?.id ?? null }
    },
    { email, senha: SENHA, apelido: APELIDOS[i], h: entradas[i] },
  )
  console.log(`  ${res.cad === 201 && res.sal < 300 && res.pub < 300 ? 'ok' : 'XX'}  conta ${APELIDOS[i]}: cadastrar ${res.cad} · salvar ${res.sal} ${res.sal >= 300 ? res.salJ : ''} · publicar ${res.pub} ${res.pub >= 300 ? res.pubJ : ''}`)
  const uid = Number(sql(`SELECT id FROM usuarios WHERE email = '${email}'`))
  contas.push({ email, senha: SENHA, apelido: APELIDOS[i], uid, carreira: entradas[i].id })
  await C.ctx.close()
}

// a 1ª conta: e-mail confirmado, emblemas de 4 desafios de emblema e algumas conquistas (o perfil público e o Hall mostram)
const c0 = contas[0]
sql(`UPDATE usuarios SET email_verificado_em = NOW() WHERE id = ${c0.uid}`)
const desafios = sql("SELECT GROUP_CONCAT(id ORDER BY ordem) FROM desafios WHERE modo = 'emblema' AND ativo = 1").split(',').map(Number).filter(Boolean)
const pk0 = Number(sql(`SELECT id FROM carreiras WHERE usuario_id = ${c0.uid} LIMIT 1`)) || 'NULL'
for (const d of desafios.slice(0, 4)) sql(`INSERT IGNORE INTO emblemas_usuario (usuario_id, desafio_id, carreira_pk, carreira_id, jogador, em, estado) VALUES (${c0.uid}, ${d}, ${pk0}, '${c0.carreira}', 'MAMANI', NOW(3), 'ativo')`)
// a 2ª conta: 1 emblema
if (contas[1]) {
  const pk1 = Number(sql(`SELECT id FROM carreiras WHERE usuario_id = ${contas[1].uid} LIMIT 1`)) || 'NULL'
  sql(`INSERT IGNORE INTO emblemas_usuario (usuario_id, desafio_id, carreira_pk, carreira_id, jogador, em, estado) VALUES (${contas[1].uid}, ${desafios[desafios.length - 1]}, ${pk1}, '${contas[1].carreira}', 'FENOMENO', NOW(3), 'ativo')`)
}
const r = await admin({ acao: 'atualizar_hall' })
console.log(`  ${r.status === 200 ? 'ok' : 'XX'}  atualizar_hall ${r.status} ${r.txt.slice(0, 160)}`)
await sleep(500)
const codigo = sql(`SELECT codigo_convite FROM usuarios WHERE id = ${c0.uid}`)
const noHall = sql('SELECT COUNT(*) FROM hall_foto')
console.log(`  ok  hall_foto com ${noHall} carreiras · perfil público #/jogador/${codigo}`)
writeFileSync(SAIDA, JSON.stringify({ entradas, contas, codigo, codigos: contas.map((c) => sql(`SELECT codigo_convite FROM usuarios WHERE id = ${c.uid}`)) }, null, 1))
console.log(`gravado ${SAIDA}`)
await browser.close()
