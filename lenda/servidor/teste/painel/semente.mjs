// LENDA · teste do painel: planta uma plataforma de mentira, pelo mesmo caminho do jogo (e.php, conta.php,
// carreiras.php, hall.php, conquistas.php) e do admin (admin.php/equipe.php pelo Bearer), mais 14 dias de visitas
// antigas direto no banco (o e.php só grava o "agora"). Nomes e e-mails inventados (@exemplo.com).
// Grava em $LENDA_PAINEL_BASE/semente.json o que o teste do navegador precisa (ids, a senha provisória da moderadora).
import { readFileSync, writeFileSync } from 'node:fs'
import { BASE, admin, equipe, esc, exigir, pedido, sql, uuid } from './lib.mjs'

const t0 = performance.now()
const AMOSTRAS = new URL('../amostras/', import.meta.url).pathname
const modelos = ['v-intenso-01.json', 'v-mediana-03.json', 'v-otima-06.json'].map((f) => {
  const j = JSON.parse(readFileSync(AMOSTRAS + f, 'utf8'))
  return j?.hall?.[0] ?? j
})

const NOMES = [
  'ReiDoDrible', 'Camisa10', 'Lobo_Azul', 'Fera.Gol', 'Tita Lima', 'Bia Matador', 'Zeca Pé', 'Dudu Raio', 'Nina Bola', 'Caco Muralha',
  'Malu Goleira', 'Joca Tester', 'Criador Rui', 'Canal Narrador', 'Conta Teste', 'Pedrinho', 'Lia Chute', 'Toni Craque', 'Gabi Zaga',
  'Vito Lateral', 'Mesmo1', 'Mesmo2', 'Mesmo3', 'Mesmo4', 'Rafa Meia', 'Juju Ponta', 'Beto Volante', 'Duda Fominha', 'Nando Pivô',
  'Sol Artilheira', 'Kiko Banco', 'Tati Garra',
]
const UFS = ['SP', 'RJ', 'MG', 'BA', 'RS', 'PE', 'CE', 'PR', null]
const TIMES = ['Flamengo', 'Palmeiras', 'Corinthians', 'São Paulo', 'Grêmio', 'Bahia', 'Cruzeiro', null]
const ORIGENS = ['tiktok', 'youtube', 'instagram', 'google', 'direto']

const jog = []
const e = (j, ev, cookie) =>
  pedido('api/e.php', { corpo: { v: j.v, s: j.s, bot: 0, ctx: j.ctx, ev }, texto: true, cookie: cookie ?? j.cookie, ip: j.ip })

// ── 1. jogadores: visita, cadastro (alguns pelo convite do ReiDoDrible; 4 no mesmo aparelho) ──
const vMesmo = uuid()
for (let i = 0; i < NOMES.length; i++) {
  const mesmo = i >= 20 && i <= 23
  const j = {
    i,
    apelido: NOMES[i],
    email: `${NOMES[i].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '')}@exemplo.com`,
    ip: `10.77.${i >> 8}.${(i & 255) + 1}`,
    v: mesmo ? vMesmo : uuid(),
    s: uuid(),
    ctx: { ref: 'tiktok.com', utm: { source: ORIGENS[i % 5] === 'direto' ? undefined : ORIGENS[i % 5], medium: 'video', campaign: i % 2 ? 'v32' : 'lancamento' }, dev: i % 3 ? 'mobile' : 'desktop', lang: 'pt-BR', tela: '390x844' },
  }
  await e(j, [{ t: 'view', m: null, d: { rota: '/' }, ts: Date.now() }, { t: 'hb', p: 0 }], '')
  let convite
  if (i >= 1 && i <= 6) convite = jog[0].codigo
  if (i >= 21 && i <= 23) convite = jog[20].codigo // o mesmo aparelho do indicador: recusada sozinha
  const cad = await pedido('api/conta.php', {
    ip: j.ip,
    corpo: { acao: 'cadastrar', apelido: j.apelido, email: j.email, senha: 'segredo-123', aceite: true, vid: j.v, origem: ORIGENS[i % 5],
      timeCoracao: TIMES[i % TIMES.length], uf: UFS[i % UFS.length], convite },
  })
  exigir(cad, 201, `cadastro de ${j.apelido}`)
  j.cookie = cad.cookie
  j.id = cad.json.usuario.id
  const u = exigir(await admin(null, { r: 'usuario', id: j.id }), 200, 'ficha')
  j.codigo = u.usuario.codigoConvite
  await e(j, [{ t: 'cadastro', m: null }, { t: 'view', m: null, d: { rota: '/carreira' } }, { t: 'jogo_inicio', m: 'classico', d: { ritmo: 'expressa' } }, { t: 'hb', p: 1, m: 'classico' }])
  jog.push(j)
}
// contas mais antigas (a plataforma não nasceu hoje): datas espalhadas, partidas com a conta (os denunciantes 27–31
// precisam de 24 h e 3 partidas para as denúncias valerem) e três sumidas há 40 dias. Ficam de hoje: os indicados do
// ReiDoDrible (1–6) e as do mesmo aparelho (20–23).
for (const j of jog) {
  if ((j.i >= 1 && j.i <= 6) || (j.i >= 20 && j.i <= 23)) continue
  const dias = j.i >= 16 && j.i <= 18 ? 60 : 2 + j.i * 1.5
  const acesso = j.i >= 16 && j.i <= 18 ? 40 : Math.max(0, dias - 2 - (j.i % 4))
  sql(`UPDATE usuarios SET criado_em = UTC_TIMESTAMP() - INTERVAL ${Math.round(dias * 24)} HOUR,
    partidas_conta = ${3 + (j.i % 6)}, partidas = ${8 + (j.i % 11)} WHERE id = ${j.id}`)
  j.acessoH = Math.round(acesso * 24)
}
console.log(`· semente: ${jog.length} contas`)

// ── 2. carreiras (HallEntry de verdade, com nota e números variados) ──
const carreiras = []
async function salvar(j, k, ajuste) {
  const m = modelos[(j.i + k) % modelos.length]
  const h = structuredClone(m)
  h.id = ajuste.id ?? `career-painel-${j.i}-${k}`
  if (h.career) h.career.id = h.id
  h.summary.semente = ajuste.copia ? undefined : h.id
  h.identity = { ...(h.identity ?? {}), surname: ajuste.nome ?? h.identity?.surname ?? 'JOGADOR' }
  if (h.summary.identity) h.summary.identity = { ...h.summary.identity, surname: h.identity.surname }
  if (h.career?.identity) h.career.identity = { ...h.career.identity, surname: h.identity.surname }
  h.legacy = { score: ajuste.nota, raw: ajuste.nota * 0.6, at: new Date().toISOString(), v: 2 }
  h.summary.legacyScore = ajuste.nota
  if (ajuste.pico) h.summary.peakOvr = ajuste.pico
  if (ajuste.gols) h.summary.totals = { ...h.summary.totals, goals: ajuste.gols }
  const r = await pedido('api/carreiras.php', { ip: j.ip, cookie: j.cookie, corpo: { acao: 'salvar', carreira: h, como: (h.summary.peakOvr ?? 0) >= 90 ? 'auto' : 'manual' } })
  exigir(r, [200, 201], `salvar carreira de ${j.apelido}`)
  const pk = Number(sql(`SELECT id FROM carreiras WHERE usuario_id = ${j.id} AND carreira_id = '${esc(h.id)}'`))
  carreiras.push({ pk, hid: h.id, dono: j.i, nome: h.identity.surname, nota: ajuste.nota })
  return pk
}
const SOBRENOMES = ['SILVA', 'ROCHA', 'ARAÚJO', 'MENDES', 'CARVALHO', 'BARROS', 'PINTO', 'FREITAS', 'MOURA', 'TEIXEIRA', 'CASTRO', 'NUNES',
  'VIEIRA', 'LOPES', 'REIS', 'CAMPOS', 'DIAS', 'RAMOS']
for (let i = 0; i < 18; i++) {
  await salvar(jog[i], 0, { nome: SOBRENOMES[i], nota: 30 + ((i * 7) % 55) })
  if (i % 3 === 0) await salvar(jog[i], 1, { nome: SOBRENOMES[(i + 5) % 18] + ' JR', nota: 25 + ((i * 5) % 40) })
}
// esperando revisão (nota alta), números impossíveis (gols) e cópia de outra conta
const pkRevisao = await salvar(jog[24], 0, { nome: 'FENÔMENO', nota: 94, pico: 96 })
const pkGols = await salvar(jog[25], 0, { nome: 'GOLEADOR', nota: 70, pico: 92, gols: 9000 })
await salvar(jog[26], 0, { id: 'career-painel-3-0', nome: 'ARAÚJO', nota: 51, copia: true })
console.log(`· semente: ${carreiras.length} carreiras`)

// ── 3. Hall público, denúncias (5 numa carreira fora do topo: ela sai do Hall sozinha) ──
exigir(await admin({ acao: 'atualizar_hall' }), 200, 'atualizar_hall')
const foto = sql('SELECT id, carreira_pk, carreira_id FROM hall_foto ORDER BY id').split('\n').map((l) => l.split('\t'))
const naFoto = (pos) => foto.find((f) => Number(f[0]) === pos)
const ultima = foto[foto.length - 1]
const denunciar = (j, hid, motivo, texto) => pedido('api/hall.php', { ip: j.ip, cookie: j.cookie, corpo: { acao: 'denunciar', id: hid, motivo, texto } })
for (const k of [27, 28, 29, 30, 31]) exigir(await denunciar(jog[k], ultima[2], 'nome', 'Nome com palavrão no jogador'), 200, 'denúncia (5)')
const d2 = naFoto(4)
exigir(await denunciar(jog[27], d2[2], 'trapaca', 'Impossível fazer tantos gols'), 200, 'denúncia trapaça')
exigir(await denunciar(jog[28], d2[2], 'trapaca', null), 200, 'denúncia trapaça 2')
const d3 = naFoto(7)
exigir(await denunciar(jog[29], d3[2], 'outro', 'Carreira repetida de outro jogador'), 200, 'denúncia outro')
// a mesma conta denunciando muita coisa em 24 h (sinal leve "denunciante em massa")
for (const pos of [2, 3, 5, 6, 8]) {
  const f = naFoto(pos)
  if (f) await denunciar(jog[31], f[2], 'trapaca', null)
}
console.log(`· semente: ${sql("SELECT COUNT(*) FROM denuncias")} denúncias`)

// ── 4. decisões do admin (Bearer): ocultar, apagar (lixeira), suspender, tipos, nota, tirar do Hall, bônus, e-mail ──
const pkOcultar = carreiras.find((c) => c.dono === 6).pk
exigir(await admin({ acao: 'ocultar_carreira', id: pkOcultar, motivo: 'Nome ofensivo no jogador' }), 200, 'ocultar')
const pkApagar = carreiras.find((c) => c.dono === 7).pk
exigir(await admin({ acao: 'apagar_carreira', id: pkApagar, motivo: 'Repetida / spam' }), 200, 'apagar')
exigir(await admin({ acao: 'suspender', id: jog[8].id, motivo: 'Apelido ofensivo', dias: 7 }), 200, 'suspender 7 dias')
exigir(await admin({ acao: 'suspender', id: jog[10].id, motivo: 'Trapaça no Hall repetida' }), 200, 'suspender')
exigir(await admin({ acao: 'mudar_tipo', id: jog[11].id, tipo: 'tester' }), 200, 'tester')
exigir(await admin({ acao: 'mudar_tipo', id: jog[12].id, tipo: 'criador' }), 200, 'criador')
exigir(await admin({ acao: 'mudar_tipo', id: jog[13].id, tipo: 'oficial' }), 200, 'oficial')
exigir(await admin({ acao: 'mudar_tipo', id: jog[14].id, tipo: 'teste' }), 200, 'teste')
exigir(await admin({ acao: 'nota', id: jog[3].id, texto: 'Pediu ajuda pelo direct em 12/10.\nConferir as carreiras com nota alta.' }), 200, 'nota')
exigir(await admin({ acao: 'bloquear_hall', id: jog[15].id, sim: true, motivo: 'Insiste em publicar carreira com nome proibido' }), 200, 'bloquear_hall')
for (let k = 0; k < 10; k++) exigir(await admin({ acao: 'dar_bonus', id: jog[k].id, valor: 1 + (k % 5), motivo: k % 2 ? 'Sorteio da live' : 'Compensação por erro' }), 200, 'dar_bonus')
exigir(await admin({ acao: 'enviar_redefinicao', id: jog[16].id }), 200, 'enviar_redefinicao')
exigir(await admin({ acao: 'destacar_carreira', id: Number(naFoto(1)[1]), sim: true }), 200, 'destaque')
// avisos no jogo e o aviso único
exigir(await admin({ acao: 'config', valores: {
  aviso: { texto: 'Hoje às 20h tem live no TikTok! Venha jogar junto.', tipo: 'info' },
  avisos: [
    { texto: 'Bem-vindo ao LENDA! Crie a sua conta e entre no Hall.', tipo: 'info', publico: 'visitantes', ate: null },
    { texto: 'Manutenção rápida no domingo de manhã.', tipo: 'alerta', publico: 'todos', ate: '2026-12-31' },
  ],
} }), 200, 'config avisos')
// conquistas sincronizadas
const CONQ = ['first_title', 'league_top_scorer', 'king_of_america', 'apps_500', 'globetrotter', 'never_relegated', 'libertadores', 'ballon_dor', 'world_champion', 'goals_300']
for (let i = 0; i < 20; i++) {
  await pedido('api/conquistas.php', { ip: jog[i].ip, cookie: jog[i].cookie, corpo: { acao: 'sincronizar', conquistas: CONQ.slice(0, 1 + (i % CONQ.length)).map((id) => ({ id, em: '2026-10-12T12:00:00Z' })) } })
}

// ── 5. tentativas erradas de entrar no painel (vão para Registro → Segurança) ──
for (const ip of ['10.88.0.1', '10.88.0.2', '10.88.0.3']) {
  await pedido('api/painel.php', { ip, corpo: { acao: 'entrar', senha: 'senha-errada-de-teste' } })
}

// ── 6. equipe: uma moderadora (senha provisória sorteada, mostrada uma vez) ──
const mod = exigir(await equipe({ acao: 'equipe_criar', email: 'moderadora@exemplo.com', nome: 'Moderadora Bia', papel: 'moderador' }), 201, 'equipe_criar')

// ── 7. 14 dias de visitas antigas (para os gráficos da Visão geral e o Tempo de jogo) ──
const linhas = []
const evs = []
const agora = Date.now()
const dt = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
let semente = 7
const rnd = () => ((semente = (semente * 1103515245 + 12345) % 2147483648) / 2147483648)
for (let d = 13; d >= 0; d--) {
  const n = 18 + Math.round(rnd() * 22) + (13 - d)
  for (let k = 0; k < n; k++) {
    const ini = agora - d * 86400000 - Math.round(rnd() * 20 * 3600000) - 3600000
    const ativo = 30 + Math.round(rnd() * 1500)
    const jogS = Math.round(ativo * rnd() * 0.8)
    const conta = rnd() < 0.35 ? jog[Math.floor(rnd() * jog.length)] : null
    const sid = uuid()
    const vid = conta ? conta.v : uuid()
    const o = ORIGENS[Math.floor(rnd() * 5)]
    const modo = rnd() < 0.8 ? 'classico' : 'imersivo'
    linhas.push(`('${sid}','${vid}',${conta ? conta.id : 'NULL'},'${dt(ini)}','${dt(ini + ativo * 1000)}',${ativo},NULL,'${o}',${o === 'direto' ? 'NULL' : `'${o}'`},'video','${rnd() < 0.5 ? 'v32' : 'lancamento'}','${rnd() < 0.7 ? 'mobile' : 'desktop'}','pt-BR','390x844',0,3,'/carreira','${modo}',${jogS})`)
    if (jogS > 0) {
      evs.push(`('${sid}','${vid}','jogo_inicio','${modo}',NULL,'${dt(ini + 20000)}',NULL)`)
      if (rnd() < 0.7) evs.push(`('${sid}','${vid}','jogo_fim','${modo}','{"nota":${20 + Math.round(rnd() * 60)}}','${dt(ini + jogS * 1000)}',${20 + Math.round(rnd() * 60)})`)
    }
  }
}
sql(`INSERT INTO visitas (sid, vid, usuario_id, inicio, ultimo, ativo_s, jogando_ate, origem, utm_source, utm_medium, utm_campaign, dispositivo, idioma, tela, bot, eventos, rota, modo_atual, jogando_s) VALUES ${linhas.join(',')}`)
sql(`INSERT INTO eventos (sid, vid, tipo, modo, dados, em, nota) VALUES ${evs.join(',')}`)

// o último acesso só no fim: cada pedido com o cookie da conta (salvar, denunciar, conquistas) o põe em "agora"
for (const j of jog) if (j.acessoH !== undefined) sql(`UPDATE usuarios SET ultimo_acesso = UTC_TIMESTAMP() - INTERVAL ${j.acessoH} HOUR WHERE id = ${j.id}`)

// ── 8. caches: mesmo aparelho e "Precisa de atenção" calculados ──
exigir(await admin(null, { r: 'multicontas', atualizar: '1' }), 200, 'multicontas')
const at = exigir(await admin(null, { r: 'atencao', atualizar: '1' }), 200, 'atencao')

const lixeira = Number(sql(`SELECT id FROM lixeira_carreiras WHERE carreira_pk = ${pkApagar}`))
writeFileSync(`${BASE}/semente.json`, JSON.stringify({
  contas: Object.fromEntries(jog.map((j) => [j.apelido, { id: j.id, email: j.email, ip: j.ip, v: j.v, s: j.s, cookie: j.cookie }])),
  carreiras, pkRevisao, pkGols, pkOcultar, pkApagar, lixeira,
  denunciada5: Number(ultima[1]), moderadora: { email: 'moderadora@exemplo.com', senha: mod.senha, id: mod.id },
}, null, 1))
console.log(`· semente: pronta em ${((performance.now() - t0) / 1000).toFixed(1)} s · ${linhas.length} visitas antigas · ${at.alertas.length} alertas: ${at.alertas.map((a) => a.chave.split(':')[0]).join(', ')}`)
