// Testes do Teste minha sorte no servidor: a frequência do giro com conta, a raridade dos prêmios, as chances e o
// "Simular giros" do painel (chamados pelo scripts/testar-api.mjs, num php -S próprio com o Z-API falso):
// - frequência: N giros a cada X dias (janela de 1, 2, 7 e 30 dias com N = 1 e N = 2), no relógio de teste (X-GC-Agora,
//   só com GC_TESTE=1): o bloqueio, o proximoEm (a meia-noite de Brasília do dia que libera), a frase da recusa, o giro
//   sem conta (girouHoje e proximoComConta) e o guardar com o período (a janela inteira em volta do dia do giro);
// - o sorteio em dois passos: as chances de cada raridade (estatístico, com folga de 5 desvios), a raridade sem prêmio
//   que reparte a chance, 0% que nunca sai, tudo em 0% (todo giro ainda ganha) e o peso dentro da raridade;
// - as chances no painel (soma, ordem, decimais, tipos), a frequência (1–30 dias, 1–5 giros, o nome de antes) e a
//   raridade do prêmio (criar, editar, a Atividade, o GET loja, o retrato do cupom);
// - a migração 103 num banco de antes (os exemplos de fábrica intactos ganham a raridade e entram o épico e o lendário;
//   com um prêmio mudado pelo dono, nada muda);
// - o admin-sorte-simular (dono e gerente, a atendente não; CSRF, Origin, limites; não grava nada; a Atividade).
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gatewayFalso, novoToken } from './testar-api-pedidos.mjs'

/** Cliente HTTP com os dois cookies (painel e conta do site), o csrf do painel e o relógio de teste. */
class Cli {
  constructor(base, ip) {
    this.base = base
    this.ip = ip
    this.painel = null
    this.cliente = null
    this.csrf = null
  }
  async req(rota, { metodo = 'GET', corpo, origem = this.base, query = '', agora, csrf } = {}) {
    const headers = { 'X-GC-IP': this.ip }
    if (origem) headers.Origin = origem
    const cookies = [this.painel && `gc_painel=${this.painel}`, this.cliente && `gc_cliente=${this.cliente}`].filter(Boolean)
    if (cookies.length) headers.Cookie = cookies.join('; ')
    const token = csrf === undefined ? this.csrf : csrf
    if (token && metodo === 'POST') headers['X-CSRF'] = token
    if (agora) headers['X-GC-Agora'] = String(agora)
    let body
    if (corpo !== undefined) {
      body = JSON.stringify(corpo)
      headers['Content-Type'] = 'application/json'
    }
    const r = await fetch(`${this.base}/api/index.php?r=${rota}${query}`, { method: metodo, headers, body, redirect: 'manual' })
    for (const c of r.headers.getSetCookie()) {
      const a = /^gc_painel=([^;]*)/.exec(c)
      if (a) this.painel = a[1] || null
      const b = /^gc_cliente=([^;]*)/.exec(c)
      if (b) this.cliente = b[1] && b[1] !== 'deleted' ? b[1] : null
    }
    const texto = await r.text()
    let json = null
    try {
      json = JSON.parse(texto)
    } catch {
      /* não é JSON */
    }
    if (json?.csrf) this.csrf = json.csrf
    return { status: r.status, json, texto }
  }
  get(rota, opts = {}) {
    return this.req(rota, opts)
  }
  post(rota, corpo, opts = {}) {
    return this.req(rota, { metodo: 'POST', corpo, ...opts })
  }
}

const DIA = 86400
/** Meio-dia de Brasília (15:00 UTC) do dia de `t` mais `d` dias, em segundos. */
const meioDia = (t, d = 0) => Math.floor(t / DIA) * DIA + d * DIA + 15 * 3600
/** A meia-noite de Brasília (03:00 UTC) do dia de `t` mais `d` dias, em ISO. */
const meiaNoiteIso = (t, d) => new Date((Math.floor(t / DIA) + d) * DIA * 1000 + 3 * 3600 * 1000).toISOString().replace('.000Z', 'Z')

export async function testarSorte(t) {
  const { parte, ok, igual, erro, raiz, tmp, PHP, subirPhp, portaLivre, derrubar, portaPrincipal } = t
  const falso = await gatewayFalso()
  const porta = process.env.GC_TESTE_PORTA ? portaPrincipal + 8 : await portaLivre()
  const dados = join(tmp, 'sorte')
  const filho = await subirPhp(porta, { GC_TESTE: '1', GC_DADOS: dados, GC_UPLOADS: join(dados, 'up'), GC_ZAPI_BASE: `http://127.0.0.1:${falso.porta}/zapi` }, [
    '-t', join(raiz, 'public'), join(raiz, 'scripts', 'api-dev.php'),
  ])
  const base = `http://127.0.0.1:${porta}`
  let ipN = 0
  const novo = () => new Cli(base, `198.20.${ipN % 250}.${Math.floor(ipN++ / 250) + 1}`)
  let numero = 0
  const whats = () => `(31) 9${String(81000000 + numero++).padStart(8, '0')}`
  const guardado = (w) => `55${w.replace(/\D/g, '')}`
  const ultimoCodigo = (w) => {
    const q = [...falso.recebidos].reverse().find((x) => JSON.parse(x.corpo || '{}').phone === guardado(w))
    return /\*(\d{6})\*/.exec(JSON.parse(q?.corpo ?? '{}').message ?? '')?.[1] ?? null
  }
  // os dias do teste: daqui a 60 dias (longe do relógio de verdade), cada cenário num pedaço do calendário
  const T0 = meioDia(Math.floor(Date.now() / 1000), 60)
  const semente = JSON.parse(readFileSync(join(raiz, 'public/api/nucleo/semente-loja.json'), 'utf8'))
  const raridadeDaSemente = Object.fromEntries(semente.sorte.premios.map((p) => [p.id, p.raridade]))

  try {
    const dono = novo()
    await dono.post('admin-instalar', { codigo: 'dev-instalar-greencheese', login: 'dono', nome: 'Dono da Loja', senha: 'senha-forte-123' })
    await dono.post('admin-avisos-salvar', { motor: 'zapi', zapi: { instancia: '3C5A0B1D2E3F', token: 'TOKENZAPI0123456789' }, destino: { tipo: 'grupo', valor: '120363012345678901' } })
    await dono.post('admin-clientes-ajustes', { tetoHora: 1000, tetoDia: 10000 })
    const regras = (c) => dono.post('admin-sorte-salvar', c)
    const pub = async () => (await novo().get('loja')).json.loja
    const eventos = async () => (await dono.get('admin-eventos')).json.eventos
    const temEvento = async (acao, texto, msg) => {
      const ev = await eventos()
      ok(ev.some((e) => e.acao === acao && e.texto === texto), `${msg}: "${texto}" na Atividade (veio ${JSON.stringify(ev.filter((e) => e.acao === acao).slice(0, 3).map((e) => e.texto))})`)
    }
    /** Conta nova (com o código pelo WhatsApp falso), num aparelho novo, no dia `quando`. */
    const contaNova = async (quando) => {
      const c = novo()
      const ap = novoToken()
      const z = whats()
      await c.post('cliente-codigo', { whatsapp: z }, { agora: quando })
      const e = await c.post('cliente-entrar', { whatsapp: z, codigo: ultimoCodigo(z), nome: 'Giro Teste', aparelho: ap }, { agora: quando })
      if (e.status !== 201) throw new Error(`conta não criou: ${e.status} ${e.texto.slice(0, 200)}`)
      return { c, ap, z }
    }
    const girar = (k, quando, ap = k.ap) => k.c.post('cliente-girar', { interativo: 'sorte', uf: 'mg', aparelho: ap }, { agora: quando })
    const info = async (k, quando, ap = k.ap) => (await k.c.get('cliente-giro', { query: `&interativo=sorte&aparelho=${ap}`, agora: quando })).json?.giro

    // ─── GET loja e as regras ───────────────────────────────────────────────────────────────────────────────────
    parte('sorte: regras no GET loja (frequência, chances, raridade)')
    {
      const l = await pub()
      igual(l.sorte.regras, { girosSemConta: 1, intervaloDias: 1, girosPorIntervalo: 1, girosPorDiaComConta: 1, reservaSemContaHoras: 24, chances: { comum: 60, raro: 25, epico: 12, lendario: 3 } }, 'de fábrica: 1 giro a cada 1 dia, chances 60/25/12/3 (e o girosPorDiaComConta pro JS velho)')
      igual(Object.fromEntries(l.sorte.premios.map((p) => [p.id, p.raridade])), raridadeDaSemente, 'cada prêmio com a raridade da semente')
      igual(Object.values(raridadeDaSemente).sort(), ['comum', 'comum', 'comum', 'epico', 'lendario', 'raro', 'raro'], 'os exemplos de fábrica: os 10% e o 4 por 3 comuns, o 15% e o brinde raros, um épico e um lendário')
      ok(l.sorte.premios.filter((p) => ['epico', 'lendario'].includes(p.raridade)).every((p) => p.demo === true && p.tipo === 'desconto-percentual'), 'o épico e o lendário são de exemplo (demo) e só desconto em acessório')
    }

    parte('sorte: frequência no painel (validação)')
    {
      for (const [corpo, campo] of [
        [{ intervaloDias: 0 }, 'intervaloDias'], [{ intervaloDias: 31 }, 'intervaloDias'], [{ intervaloDias: 1.5 }, 'intervaloDias'], [{ intervaloDias: 'sete' }, 'intervaloDias'],
        [{ girosPorIntervalo: 0 }, 'girosPorIntervalo'], [{ girosPorIntervalo: 6 }, 'girosPorIntervalo'], [{ girosPorIntervalo: null }, 'girosPorIntervalo'], [{ girosPorDiaComConta: 9 }, 'girosPorDiaComConta'],
      ]) {
        const x = await regras(corpo)
        erro(x, 400, 'invalido', `frequência: recusa ${JSON.stringify(corpo)}`)
        igual(x.json?.campo, campo, `campo (${JSON.stringify(corpo)})`)
      }
      const x = await regras({ intervaloDias: 7, girosPorIntervalo: 2 })
      igual([x.status, x.json?.sorte?.intervaloDias, x.json?.sorte?.girosPorIntervalo, x.json?.sorte?.girosPorDiaComConta], [200, 7, 2, 2], '2 giros por semana')
      igual([(await pub()).sorte.regras.intervaloDias, (await pub()).sorte.regras.girosPorIntervalo], [7, 2], 'o site recebe')
      await temEvento('sorte-regras', 'Mudou a frequência do Teste minha sorte: 2 giros por semana com conta', 'a frequência na Atividade')
      igual((await regras({ girosPorDiaComConta: 3 })).json?.sorte?.girosPorIntervalo, 3, 'o nome de antes (girosPorDiaComConta) muda o girosPorIntervalo')
      igual((await regras({ intervaloDias: 30, girosPorIntervalo: 1 })).status, 200, '1 por mês')
      await temEvento('sorte-regras', 'Mudou a frequência do Teste minha sorte: 1 giro por mês com conta', '1 por mês na Atividade')
      await regras({ intervaloDias: 1, girosPorIntervalo: 1 })
    }

    parte('sorte: chances no painel (soma, ordem, decimais, tipos)')
    {
      const c = (comum, raro, epico, lendario) => ({ comum, raro, epico, lendario })
      for (const [chances, msg, raridade] of [
        [c(60, 25, 12, 2), /somam 100% \(agora dão 99%\)/, undefined],
        [c(60, 25, 12, 4), /agora dão 101%/, undefined],
        [c(40, 45, 12, 3), /Raro não pode passar de Comum/, 'raro'],
        [c(60, 15, 22, 3), /Épico não pode passar de Raro/, 'epico'],
        [c(60, 25, 7, 8), /Lendário não pode passar de Épico/, 'lendario'],
        [c(60.05, 24.95, 12, 3), /até 1 casa/, 'comum'],
        [c('60', 25, 12, 3), /tem que ser um número/, 'comum'],
        [c(60, true, 12, 3), /tem que ser um número/, 'raro'],
        [c(60, 25, null, 3), /tem que ser um número/, 'epico'],
        [c(103, -3, 0, 0), /vai de 0% a 100%/, 'comum'],
        [{ comum: 60, raro: 25, epico: 15 }, /tem que ser um número/, 'lendario'],
        [{ ...c(60, 25, 12, 3), mitico: 0 }, /4 raridades/, undefined],
        [[60, 25, 12, 3], /4 raridades/, undefined],
        ['60/25/12/3', /4 raridades/, undefined],
      ]) {
        const x = await regras({ chances })
        erro(x, 400, 'invalido', `chances: recusa ${JSON.stringify(chances)}`)
        igual(x.json?.campo, 'chances', `campo chances (${JSON.stringify(chances)})`)
        ok(msg.test(x.json?.mensagem ?? ''), `mensagem clara (${x.json?.mensagem})`)
        igual(x.json?.raridade, raridade, `a raridade do erro (${JSON.stringify(chances)})`)
      }
      igual((await pub()).sorte.regras.chances, c(60, 25, 12, 3), 'nada recusado mudou as chances')
      const y = await regras({ chances: c(62.5, 25, 10, 2.5) })
      igual([y.status, y.json?.sorte?.chances], [200, c(62.5, 25, 10, 2.5)], 'com 1 casa decimal')
      igual((await pub()).sorte.regras.chances, c(62.5, 25, 10, 2.5), 'o site recebe')
      await temEvento('sorte-regras', 'Mudou as chances das raridades: Comum 62,5%, Raro 25%, Épico 10%, Lendário 2,5%', 'as chances na Atividade')
      igual((await regras({ chances: c(70, 30, 0, 0) })).status, 200, '0% pode (aqueles prêmios nunca saem)')
      igual((await regras({ chances: c(25, 25, 25, 25) })).status, 200, 'tudo igual pode (cada uma menor ou igual à anterior)')
      await regras({ chances: c(60, 25, 12, 3) })
    }

    // ─── frequência do giro com conta ───────────────────────────────────────────────────────────────────────────
    /**
     * Um cenário: a conta gira nos dias `giros` (deslocamento a partir de D0, ao meio-dia de Brasília) e depois tenta no
     * dia `bloqueado` (409, com o proximoEm no dia `libera`) e no dia `libera` (gira, 1 minuto depois da meia-noite).
     */
    const cenario = async (inicio, { X, N, giros, bloqueado, libera, msg }) => {
      igual((await regras({ intervaloDias: X, girosPorIntervalo: N })).status, 200, `regras: ${N} a cada ${X} dias`)
      const k = await contaNova(meioDia(inicio, 0) - 3600)
      for (const d of giros) igual((await girar(k, meioDia(inicio, d))).status, 200, `${N} a cada ${X}: gira no dia ${d}`)
      const r = await girar(k, meioDia(inicio, bloqueado))
      erro(r, 409, 'sem-giro', `${N} a cada ${X}: no dia ${bloqueado}, não`)
      igual([r.json?.giro?.motivo, r.json?.giro?.proximoEm], ['ja-girou-hoje', meiaNoiteIso(meioDia(inicio, 0), libera)], `${N} a cada ${X}: libera à meia-noite do dia ${libera}`)
      if (msg) ok(msg.test(r.json?.mensagem ?? ''), `${N} a cada ${X}: a frase fala do período (${r.json?.mensagem})`)
      igual((await info(k, meioDia(inicio, bloqueado))).proximoEm, meiaNoiteIso(meioDia(inicio, 0), libera), `${N} a cada ${X}: o GET cliente-giro diz o mesmo dia`)
      const virada = meioDia(inicio, libera) - 12 * 3600 + 60
      igual((await info(k, virada - 120)).disponivel, false, `${N} a cada ${X}: 1 minuto antes da meia-noite, ainda não`)
      igual((await girar(k, virada)).status, 200, `${N} a cada ${X}: 1 minuto depois da meia-noite do dia ${libera}, gira`)
      return k
    }
    parte('sorte: 1 giro a cada 1 dia (o de sempre)')
    {
      const k = await cenario(T0, { X: 1, N: 1, giros: [0], bloqueado: 0, libera: 1 })
      const r = await girar(k, meioDia(T0, 1) + 60)
      igual(r.json?.mensagem, 'Teu giro de hoje já foi. Volta amanhã.', 'a frase de sempre')
      // o sem conta (aparelho novo): girou hoje e a conta que nascer aqui gira amanhã
      const anon = novo()
      const ap = novoToken()
      igual((await anon.post('cliente-girar', { interativo: 'sorte', uf: 'mg', aparelho: ap }, { agora: meioDia(T0, 0) })).status, 200, 'sem conta: gira')
      const g = await anon.post('cliente-girar', { interativo: 'sorte', uf: 'mg', aparelho: ap }, { agora: meioDia(T0, 0) + 60 })
      igual([g.json?.giro?.motivo, g.json?.giro?.girouHoje, g.json?.giro?.proximoComConta], ['sem-conta-ja-girou', true, meiaNoiteIso(meioDia(T0, 0), 1)], 'sem conta: girouHoje e a conta daqui gira amanhã (proximoComConta)')
      igual(g.json?.mensagem, 'O giro deste aparelho já foi. Cria a conta pra girar todo dia.', 'a frase de sempre (sem conta)')
      const g2 = await anon.get('cliente-giro', { query: `&interativo=sorte&aparelho=${ap}`, agora: meioDia(T0, 1) })
      igual([g2.json?.giro?.girouHoje, 'proximoComConta' in (g2.json?.giro ?? {})], [false, false], 'no dia seguinte: o giro sem conta não segura mais a conta')
    }
    parte('sorte: 2 giros a cada 1 dia')
    await cenario(meioDia(T0, 3), { X: 1, N: 2, giros: [0, 0], bloqueado: 0, libera: 1, msg: /^Teus giros de hoje já foram\. O próximo libera amanhã\.$/ })
    parte('sorte: 1 giro a cada 2 dias')
    await cenario(meioDia(T0, 6), { X: 2, N: 1, giros: [0], bloqueado: 1, libera: 2, msg: /^Teu giro já foi\. O próximo libera amanhã\.$/ })
    parte('sorte: 2 giros a cada 2 dias')
    {
      const ini = meioDia(T0, 10)
      const k = await cenario(ini, { X: 2, N: 2, giros: [0, 1], bloqueado: 1, libera: 2 })
      // girou no dia 1 e no dia 2 (o de agora): no dia 2, a janela [1, 2] tá cheia, libera no dia 1 + 2 = 3
      const r = await girar(k, meioDia(ini, 2) + 60)
      igual(r.json?.giro?.proximoEm, meiaNoiteIso(ini, 3), '2 a cada 2: com giros nos dias 1 e 2, libera no dia 3 (o giro que segura a janela + 2)')
    }
    parte('sorte: 1 giro por semana')
    {
      const ini = meioDia(T0, 15)
      await cenario(ini, { X: 7, N: 1, giros: [0], bloqueado: 6, libera: 7 })
      const k = await contaNova(meioDia(ini, 20))
      await girar(k, meioDia(ini, 20))
      const r = await girar(k, meioDia(ini, 22))
      const libera = new Date((meioDia(ini, 27) - 15 * 3600) * 1000)
      const semana = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][libera.getUTCDay()]
      const dm = `${String(libera.getUTCDate()).padStart(2, '0')}/${String(libera.getUTCMonth() + 1).padStart(2, '0')}`
      igual(r.json?.mensagem, `Teu giro já foi. O próximo libera ${semana}, ${dm}.`, 'a frase diz o dia que libera (dia da semana e data)')
    }
    parte('sorte: 2 giros por semana')
    {
      const ini = meioDia(T0, 45)
      const k = await cenario(ini, { X: 7, N: 2, giros: [0, 3], bloqueado: 5, libera: 7 })
      // no dia 7 girou (a janela [1, 7] tinha só o do dia 3); no dia 8, a janela [2, 8] tem o 3 e o 7: libera no 3 + 7 = 10
      const r = await girar(k, meioDia(ini, 8))
      igual([r.status, r.json?.giro?.proximoEm], [409, meiaNoiteIso(ini, 10)], '2 por semana: com giros nos dias 3 e 7, no dia 8 não, e libera no dia 10')
    }
    parte('sorte: 1 giro por mês')
    await cenario(meioDia(T0, 70), { X: 30, N: 1, giros: [0], bloqueado: 29, libera: 30 })
    parte('sorte: 2 giros por mês')
    await cenario(meioDia(T0, 120), { X: 30, N: 2, giros: [0, 10], bloqueado: 20, libera: 30 })

    parte('sorte: sem conta com a frequência (girouHoje e proximoComConta)')
    {
      await regras({ intervaloDias: 7, girosPorIntervalo: 1 })
      const anon = novo()
      const ap = novoToken()
      const ini = meioDia(T0, 170)
      await anon.post('cliente-girar', { interativo: 'sorte', uf: 'mg', aparelho: ap }, { agora: ini })
      const g = (await anon.get('cliente-giro', { query: `&interativo=sorte&aparelho=${ap}`, agora: meioDia(ini, 3) })).json?.giro
      igual([g?.motivo, g?.girouHoje, g?.proximoComConta], ['sem-conta-ja-girou', true, meiaNoiteIso(ini, 7)], '1 por semana: 3 dias depois, o giro sem conta ainda conta e a conta daqui gira no dia 7')
      const g2 = (await anon.post('cliente-girar', { interativo: 'sorte', uf: 'mg', aparelho: ap }, { agora: meioDia(ini, 3) })).json
      igual(g2?.mensagem, 'O giro deste aparelho já foi. Cria a conta pra girar 1 vez por semana.', 'a frase do sem conta fala da frequência')
      const g3 = (await anon.get('cliente-giro', { query: `&interativo=sorte&aparelho=${ap}`, agora: meioDia(ini, 7) })).json?.giro
      igual([g3?.girouHoje, 'proximoComConta' in (g3 ?? {})], [false, false], 'no dia 7: não segura mais')
      // a conta criada nesse aparelho no dia 3 não gira (o giro sem conta do dia 0 conta na janela dela)
      const z = whats()
      await anon.post('cliente-codigo', { whatsapp: z }, { agora: meioDia(ini, 3) })
      const e = await anon.post('cliente-entrar', { whatsapp: z, codigo: ultimoCodigo(z), nome: 'Conta Nova', aparelho: ap }, { agora: meioDia(ini, 3) })
      igual(e.status, 201, 'cria a conta no aparelho que girou')
      const r = await anon.post('cliente-girar', { interativo: 'sorte', uf: 'mg', aparelho: ap }, { agora: meioDia(ini, 3) + 60 })
      igual([r.status, r.json?.giro?.proximoEm], [409, meiaNoiteIso(ini, 7)], 'a conta nova no aparelho que girou sem conta: libera no dia 7')
    }

    parte('sorte: guardar o giro sem conta com o período')
    {
      await regras({ intervaloDias: 7, girosPorIntervalo: 1 })
      const ini = meioDia(T0, 200)
      const k = await contaNova(ini - 3600)
      igual((await girar(k, ini)).status, 200, 'a conta gira no dia 0')
      // girou sem a conta num aparelho novo no dia 3 e tenta guardar na conta: a janela de 7 dias já tem o do dia 0
      const semCookie = novo()
      const ap3 = novoToken()
      igual((await semCookie.post('cliente-girar', { interativo: 'sorte', uf: 'mg', aparelho: ap3 }, { agora: meioDia(ini, 3) })).status, 200, 'sem a conta, num aparelho novo, no dia 3')
      const g = await k.c.post('cliente-guardar', { interativo: 'sorte', aparelho: ap3 }, { agora: meioDia(ini, 3) + 60 })
      erro(g, 409, 'ja-girou-hoje', 'guardar o giro do dia 3 numa conta que girou no dia 0 (1 por semana): recusa')
      igual(g.json?.mensagem, 'Tua conta já tinha girado nesse período: o prêmio desse giro não entra nela. É 1 giro por semana por conta.', 'a frase fala do período, não de "hoje"')
      // no dia 7 (fora da janela do dia 0), o giro sem conta guardado entra e conta como o giro do dia 7
      const ap7 = novoToken()
      await semCookie.post('cliente-girar', { interativo: 'sorte', uf: 'mg', aparelho: ap7 }, { agora: meioDia(ini, 7) })
      const g7 = await k.c.post('cliente-guardar', { interativo: 'sorte', aparelho: ap7 }, { agora: meioDia(ini, 7) + 60 })
      igual([g7.status, typeof g7.json?.cupom?.codigo], [200, 'string'], 'no dia 7 o giro guardado entra')
      const depois = await girar(k, meioDia(ini, 7) + 120)
      igual([depois.status, depois.json?.giro?.proximoEm], [409, meiaNoiteIso(ini, 14)], 'e conta como o giro do dia 7 da conta (libera no dia 14)')
      // a janela olha também pra frente do dia do giro guardado: girou sem conta no dia 20 e a conta girou no dia 21
      const ap20 = novoToken()
      await semCookie.post('cliente-girar', { interativo: 'sorte', uf: 'mg', aparelho: ap20 }, { agora: meioDia(ini, 20) + 3600 * 8 })
      igual((await girar(k, meioDia(ini, 21) - 3600 * 6)).status, 200, 'a conta gira no dia 21 (de manhã)')
      erro(await k.c.post('cliente-guardar', { interativo: 'sorte', aparelho: ap20 }, { agora: meioDia(ini, 21) - 3600 * 5 }), 409, 'ja-girou-hoje', 'guardar o giro do dia 20 com a conta girando no dia 21: a janela [15, 21] passaria de 1')
      // com 2 por semana, o mesmo cabe
      await regras({ intervaloDias: 7, girosPorIntervalo: 2 })
      const ap30 = novoToken()
      await semCookie.post('cliente-girar', { interativo: 'sorte', uf: 'mg', aparelho: ap30 }, { agora: meioDia(ini, 30) })
      igual((await girar(k, meioDia(ini, 30) + 60)).status, 200, '2 por semana: a conta gira no dia 30')
      igual((await k.c.post('cliente-guardar', { interativo: 'sorte', aparelho: ap30 }, { agora: meioDia(ini, 30) + 120 })).status, 200, '2 por semana: o giro sem conta do dia 30 cabe (2 na janela)')
      // e com 1 por dia (o de sempre), a mesma frase de antes
      await regras({ intervaloDias: 1, girosPorIntervalo: 1 })
      const ap40 = novoToken()
      await girar(k, meioDia(ini, 40))
      await semCookie.post('cliente-girar', { interativo: 'sorte', uf: 'mg', aparelho: ap40 }, { agora: meioDia(ini, 40) + 60 })
      const g40 = await k.c.post('cliente-guardar', { interativo: 'sorte', aparelho: ap40 }, { agora: meioDia(ini, 40) + 120 })
      igual(g40.json?.mensagem, 'Tua conta já tinha girado no dia desse giro: o prêmio dele não entra nela. É 1 giro por dia por conta.', '1 por dia: a frase de sempre')
    }

    // ─── raridade dos prêmios ───────────────────────────────────────────────────────────────────────────────────
    parte('sorte: raridade do prêmio (painel, GET loja, cupom)')
    {
      const base1 = {
        tipo: 'desconto-percentual', valor: 20, titulo: 'Vinte no isqueiro', descricao: 'O isqueiro mais em conta.', regra: '20% de desconto no Isqueiro Clipper',
        aplicaA: { produtos: ['isqueiro-clipper'] }, validadeDias: 5,
      }
      for (const raridade of ['mitico', '', 3, null, 'Épico']) {
        const x = await dono.post('admin-premio-salvar', { ...base1, raridade })
        erro(x, 400, 'invalido', `raridade que não existe (${JSON.stringify(raridade)})`)
        igual(x.json?.campo, 'raridade', 'campo raridade')
      }
      let x = await dono.post('admin-premio-salvar', base1)
      igual([x.status, x.json?.premio?.raridade, x.json?.premio?.peso], [201, 'comum', 1], 'prêmio novo sem raridade nem peso: comum, peso 1')
      x = await dono.post('admin-premio-salvar', { id: 'vinte-no-isqueiro', raridade: 'epico' })
      igual([x.status, x.json?.premio?.raridade], [200, 'epico'], 'muda só a raridade')
      await temEvento('premio-editado', 'Mudou o prêmio "Vinte no isqueiro" pra Épico', 'a raridade na Atividade')
      igual((await pub()).sorte.premios.find((p) => p.id === 'vinte-no-isqueiro')?.raridade, 'epico', 'o site recebe a raridade')
      x = await dono.post('admin-premio-salvar', { id: 'vinte-no-isqueiro', peso: 3 })
      igual([x.json?.premio?.raridade, x.json?.premio?.peso], ['epico', 3], 'editar o peso não mexe na raridade')
      const y = await dono.post('admin-premio-salvar', { ...base1, titulo: 'Trinta no isqueiro', valor: 30, regra: '30% de desconto no Isqueiro Clipper', raridade: 'lendario', peso: 2 })
      igual([y.status, y.json?.premio?.raridade], [201, 'lendario'], 'cria já lendário')
      await temEvento('premio-criado', 'Criou o prêmio "Trinta no isqueiro" (Lendário)', 'criar com raridade na Atividade')
      // o cupom guarda a raridade do dia (o retrato) e a mostra
      await regras({ chances: { comum: 0, raro: 0, epico: 0, lendario: 100 }, intervaloDias: 1, girosPorIntervalo: 1 }).then((r) => igual(r.status, 400, '0/0/0/100 não vale (lendário não passa do épico)'))
      await regras({ chances: { comum: 25, raro: 25, epico: 25, lendario: 25 } })
      const k = await contaNova(meioDia(T0, 260))
      let cupom = null
      for (let d = 0; d < 12 && !cupom; d++) {
        const g = await girar(k, meioDia(T0, 260 + d))
        if (['epico', 'lendario'].includes(g.json?.cupom?.retrato?.raridade)) cupom = g.json.cupom
      }
      ok(!!cupom, 'girou até sair um épico ou lendário (25% cada)')
      if (cupom) {
        igual(cupom.raridade, cupom.retrato.raridade, `o cupom diz a raridade do dia (${cupom.raridade})`)
        const raridadeDoPremio = (await pub()).sorte.premios.find((p) => p.id === cupom.premioId)?.raridade
        igual(cupom.raridade, raridadeDoPremio, 'a mesma do prêmio')
        await dono.post('admin-premio-salvar', { id: cupom.premioId, raridade: 'comum' })
        const eu = await k.c.get('cliente-eu', { agora: meioDia(T0, 266) })
        igual(eu.json?.cupons?.find((q) => q.codigo === cupom.codigo)?.raridade, cupom.raridade, 'mudar a raridade do prêmio depois não muda a do cupom (o retrato)')
        await dono.post('admin-premio-salvar', { id: cupom.premioId, raridade: raridadeDoPremio })
      }
      await dono.post('admin-premio-apagar', { id: 'vinte-no-isqueiro' })
      await dono.post('admin-premio-apagar', { id: 'trinta-no-isqueiro' })
      await regras({ chances: { comum: 60, raro: 25, epico: 12, lendario: 3 } })
    }

    // ─── o sorteio ──────────────────────────────────────────────────────────────────────────────────────────────
    parte('sorte: o sorteio em dois passos (estatístico)')
    {
      const mods = ['base', 'banco', 'validar', 'limite', 'sessao', 'rateio', 'pedido-migracoes', 'pedido', 'avisos', 'textos', 'contas-migracoes', 'equipe', 'clientes', 'sorte']
        .map((m) => `require '${raiz}public/api/nucleo/${m}.php';`).join(' ')
      const rodar = (lista, chances, n) =>
        JSON.parse(execFileSync(PHP, ['-r', `define('GC_API', '1'); ${mods}
          $l = json_decode($argv[1], true); $c = json_decode($argv[2], true); $n = (int) $argv[3]; $saiu = [];
          for ($i = 0; $i < $n; $i++) { $p = gc_sortear($l, $c); $saiu[$p['id']] = ($saiu[$p['id']] ?? 0) + 1; }
          echo json_encode(['saiu' => $saiu, 'esperado' => gc_sorteio_chances($l, $c)]);`, JSON.stringify(lista), JSON.stringify(chances), String(n)], { encoding: 'utf8', env: { ...process.env, GC_DADOS: join(tmp, 'sorte-cli') } }))
      const p = (id, raridade, peso = 1) => ({ id, raridade, peso, titulo: id })
      const conferir = (nome, r, n) => {
        for (const [id, esp] of Object.entries(r.esperado)) {
          const saiu = (r.saiu[id] ?? 0) / n
          const folga = 5 * Math.sqrt((esp * (1 - esp)) / n) + 0.002
          ok(Math.abs(saiu - esp) <= folga, `${nome}: ${id} esperado ${(esp * 100).toFixed(2)}%, saiu ${(saiu * 100).toFixed(2)}% (folga ${(folga * 100).toFixed(2)})`)
        }
      }
      const N = 200000
      const quatro = [p('c1', 'comum', 3), p('c2', 'comum', 1), p('r1', 'raro'), p('e1', 'epico'), p('l1', 'lendario')]
      let r = rodar(quatro, { comum: 60, raro: 25, epico: 12, lendario: 3 }, N)
      igual(Object.fromEntries(Object.entries(r.esperado).map(([k, v]) => [k, Math.round(v * 10000) / 100])), { c1: 45, c2: 15, r1: 25, e1: 12, l1: 3 }, 'esperado: 60% comum (3:1 pelo peso), 25 raro, 12 épico, 3 lendário')
      conferir('as 4 raridades', r, N)
      // sem épico na lista: os 12% se repartem na proporção (60:25:3)
      r = rodar([p('c1', 'comum'), p('r1', 'raro'), p('l1', 'lendario')], { comum: 60, raro: 25, epico: 12, lendario: 3 }, N)
      igual(Object.fromEntries(Object.entries(r.esperado).map(([k, v]) => [k, Math.round(v * 1e4) / 1e4])), { c1: Math.round((60 / 88) * 1e4) / 1e4, r1: Math.round((25 / 88) * 1e4) / 1e4, l1: Math.round((3 / 88) * 1e4) / 1e4 }, 'raridade vazia: a chance dela se reparte entre as outras, na proporção')
      conferir('sem épico', r, N)
      // 0% nunca sai
      r = rodar(quatro, { comum: 70, raro: 30, epico: 0, lendario: 0 }, 20000)
      ok(!r.saiu.e1 && !r.saiu.l1 && r.esperado.e1 === 0 && r.esperado.l1 === 0, 'raridade em 0%: aqueles prêmios nunca saem')
      conferir('épico e lendário em 0%', r, 20000)
      // só sobraram prêmios de raridades em 0%: todo giro ainda ganha, pelo peso
      r = rodar([p('e1', 'epico', 1), p('l1', 'lendario', 3)], { comum: 100, raro: 0, epico: 0, lendario: 0 }, 40000)
      igual([r.esperado.e1, r.esperado.l1], [0.25, 0.75], 'tudo em 0% no que sobrou: todo giro ganha, pelo peso (1:3)')
      conferir('tudo em 0%', r, 40000)
      // prêmio sem raridade é comum
      r = rodar([{ id: 'velho', peso: 1, titulo: 'x' }, p('r1', 'raro')], { comum: 60, raro: 25, epico: 12, lendario: 3 }, N)
      igual(Math.round(r.esperado.velho * 1e4) / 1e4, Math.round((60 / 85) * 1e4) / 1e4, 'prêmio sem raridade conta como comum')
      conferir('sem raridade', r, N)
    }

    // ─── simular giros ──────────────────────────────────────────────────────────────────────────────────────────
    parte('sorte: simular giros no painel')
    {
      const contar = () => JSON.parse(execFileSync(PHP, ['-r', '$d = new PDO("sqlite:" . $argv[1]); echo json_encode([(int) $d->query("SELECT COUNT(*) FROM giros")->fetchColumn(), (int) $d->query("SELECT COUNT(*) FROM cupons")->fetchColumn(), (int) $d->query("SELECT valor FROM ajustes WHERE chave = \'loja.versao\'")->fetchColumn()]);', join(dados, 'loja.sqlite')], { encoding: 'utf8' }))
      const antes = contar()
      const s = await dono.post('admin-sorte-simular', { giros: 10000, uf: 'mg' })
      igual(s.status, 200, 'o dono simula 10.000 giros em MG')
      igual(Object.keys(s.json ?? {}).sort(), ['chances', 'desligado', 'foraDoSite', 'giros', 'ok', 'premios', 'raridades', 'todosOsEstados', 'uf'], 'a resposta: giros, uf, chances, por prêmio e por raridade')
      igual(s.json?.premios?.reduce((n, x) => n + x.saiu, 0), 10000, 'saíram 10.000 prêmios (todo giro ganha)')
      igual(s.json?.raridades?.map((x) => x.raridade), ['comum', 'raro', 'epico', 'lendario'], 'as 4 raridades, da mais comum pra mais rara')
      const somaEsp = s.json?.premios?.reduce((n, x) => n + x.esperado, 0)
      ok(Math.abs(somaEsp - 100) < 0.05, `o esperado soma 100% (${somaEsp})`)
      for (const x of s.json?.raridades ?? []) {
        const esp = x.esperado / 100
        const folga = 5 * Math.sqrt((esp * (1 - esp)) / 10000) * 100 + 0.2
        ok(Math.abs(x.saiuPct - x.esperado) <= folga, `simular: ${x.raridade} esperado ${x.esperado}%, saiu ${x.saiuPct}%`)
      }
      igual(s.json?.raridades?.map((x) => x.esperado), [60, 25, 12, 3], 'em MG tem as 4 raridades: 60/25/12/3')
      igual(contar(), antes, 'simular não grava nada (giros, cupons, versão da loja)')
      await temEvento('sorte-simulada', 'Simulou 10.000 giros em MG', 'simular na Atividade')
      // no RJ não tem épico nem lendário (os produtos não estão à venda lá): a chance deles se reparte
      const rj = await dono.post('admin-sorte-simular', { giros: 1000, uf: 'rj' })
      igual(rj.json?.raridades?.map((x) => x.premios), [1, 2, 0, 0], 'no RJ: 1 comum e 2 raros')
      igual(rj.json?.raridades?.map((x) => x.esperado), [70.59, 29.41, 0, 0], 'no RJ: o comum e o raro dividem 60:25')
      igual((await dono.post('admin-sorte-simular', { giros: 100 })).json?.premios?.length, 7, 'sem estado: os 7 prêmios da loja')
      igual((await dono.post('admin-sorte-simular', { giros: 100, uf: 'ba' })).json?.todosOsEstados, true, 'estado fora do site: sorteia entre todos (como o giro) e avisa')
      // estado do site sem nenhum prêmio que valha lá: tira o 4 por 3 (o único do RJ que não é raro) e os raros do jogo
      for (const id of ['ocb-4-por-3', 'piteira-vidro-15', 'brinde-piteira-papel']) await dono.post('admin-premio-salvar', { id, ativo: false })
      const vazio = await dono.post('admin-sorte-simular', { giros: 100, uf: 'rj' })
      igual([vazio.json?.todosOsEstados, vazio.json?.premios?.length], [true, 4], 'estado do site sem prêmio que valha lá: sorteia entre todos os que valem (como o giro) e avisa')
      for (const id of ['ocb-4-por-3', 'piteira-vidro-15', 'brinde-piteira-papel']) await dono.post('admin-premio-salvar', { id, ativo: true })
      for (const [corpo, campo] of [[{ giros: 99 }, 'giros'], [{ giros: 10001 }, 'giros'], [{ giros: 'mil' }, 'giros'], [{}, 'giros'], [{ giros: 100, uf: 'xx' }, 'uf']]) {
        const x = await dono.post('admin-sorte-simular', corpo)
        erro(x, 400, 'invalido', `simular: recusa ${JSON.stringify(corpo)}`)
        igual(x.json?.campo, campo, `campo (${JSON.stringify(corpo)})`)
      }
      erro(await dono.post('admin-sorte-simular', { giros: 100 }, { csrf: null }), 403, 'csrf', 'simular sem X-CSRF')
      erro(await dono.post('admin-sorte-simular', { giros: 100 }, { origem: 'https://golpe.example' }), 403, 'origem', 'simular com Origin de fora')
      erro(await dono.get('admin-sorte-simular'), 405, 'metodo', 'simular só aceita POST')
      erro(await novo().post('admin-sorte-simular', { giros: 100 }), 401, 'sem-sessao', 'simular sem sessão')
      // desligado: simula mesmo assim (testa antes de ligar)
      await regras({ ligado: false })
      const d = await dono.post('admin-sorte-simular', { giros: 100, uf: 'mg' })
      igual([d.status, d.json?.desligado, d.json?.premios?.reduce((n, x) => n + x.saiu, 0)], [200, true, 100], 'com o jogo desligado, simula do mesmo jeito (e diz que tá desligado)')
      await regras({ ligado: true })
    }

    parte('sorte: permissões (gerente simula nos estados dele, atendente nem simula nem muda)')
    {
      const criar = async (login, papel, ufs) => {
        const r = await dono.post('admin-usuario-salvar', { novo: true, login, nome: login, papel, ufs })
        const c = novo()
        await c.post('admin-entrar', { login, senha: r.json?.senhaProvisoria })
        await c.post('admin-senha', { atual: r.json?.senhaProvisoria, nova: `senha-de-${login}-1` })
        return c
      }
      const gerente = await criar('gerente.mg', 'gerente', ['mg'])
      const atendente = await criar('atende.mg', 'atendente', ['mg'])
      igual((await gerente.post('admin-sorte-simular', { giros: 100, uf: 'mg' })).status, 200, 'o gerente simula em MG')
      igual((await gerente.post('admin-sorte-simular', { giros: 100 })).status, 200, 'o gerente simula sem estado (a lista de prêmios, que ele já lê)')
      const fora = await gerente.post('admin-sorte-simular', { giros: 100, uf: 'rj' })
      igual([fora.status, fora.json?.erro, fora.json?.motivo], [403, 'sem-permissao', 'estado'], 'e não no RJ (não é dele)')
      erro(await gerente.post('admin-sorte-salvar', { intervaloDias: 7 }), 403, 'sem-permissao', 'o gerente não muda a frequência')
      erro(await gerente.post('admin-sorte-salvar', { chances: { comum: 50, raro: 30, epico: 15, lendario: 5 } }), 403, 'sem-permissao', 'nem as chances')
      erro(await gerente.post('admin-premio-salvar', { id: 'ocb-4-por-3', raridade: 'lendario' }), 403, 'sem-permissao', 'nem a raridade do prêmio')
      erro(await atendente.post('admin-sorte-simular', { giros: 100, uf: 'mg' }), 403, 'sem-permissao', 'a atendente não simula')
      erro(await atendente.post('admin-sorte-salvar', { intervaloDias: 7 }), 403, 'sem-permissao', 'a atendente não muda a frequência')
      erro(await atendente.post('admin-premio-salvar', { id: 'ocb-4-por-3', raridade: 'raro' }), 403, 'sem-permissao', 'nem a raridade')
      const ev = (await gerente.get('admin-eventos')).json?.eventos ?? []
      ok(ev.some((e) => e.acao === 'sorte-simulada' && e.texto === 'Simulou 100 giros em MG' && e.usuario === 'gerente.mg'), 'a simulação do gerente na Atividade dele')
      // limite por IP: 60 simulações por hora
      const ip = await criar('gerente.ip', 'gerente', ['mg'])
      let ultimo
      for (let i = 0; i < 61; i++) ultimo = await ip.post('admin-sorte-simular', { giros: 100 })
      erro(ultimo, 429, 'muitas-tentativas', '61ª simulação do mesmo IP na hora')
    }
  } finally {
    derrubar(filho)
    falso.srv.close()
  }

  // ─── migração 103 num banco de antes ──────────────────────────────────────────────────────────────────────────
  parte('sorte: migração 103 num banco de antes (os exemplos de fábrica)')
  {
    const modulos = ['base', 'banco', 'validar', 'limite', 'sessao', 'rateio', 'exemplos', 'publico', 'painel', 'upload', 'diagnostico', 'loja-migracoes', 'loja', 'loja-validar', 'loja-painel', 'pedido-migracoes', 'pedido', 'avisos', 'textos', 'contas-migracoes', 'equipe', 'clientes', 'sorte', 'painel-dono']
      .map((m) => `require '${raiz}public/api/nucleo/${m}.php';`).join(' ')
    // a semente de antes da raridade: os 5 exemplos de fábrica, sem raridade, e as regras de antes
    const antiga = JSON.parse(JSON.stringify(semente))
    antiga.sorte.premios = antiga.sorte.premios.filter((p) => !['bandeja-25', 'dichavador-40'].includes(p.id)).map(({ raridade, ...p }) => p)
    antiga.sorte.regras = { girosSemConta: 1, girosPorDiaComConta: 1, reservaSemContaHoras: 24 }
    const arqSemente = join(tmp, 'semente-antiga.json')
    writeFileSync(arqSemente, JSON.stringify(antiga))
    /** Um banco como os do ar antes da 103: todas as migrações menos ela, o dono e a loja da semente antiga (sem a coluna). */
    const bancoDeAntes = (nome, mudar = '') => {
      const dir = join(tmp, nome)
      mkdirSync(dir, { recursive: true })
      execFileSync(PHP, ['-r', `define('GC_API', '1'); ${modulos}
        $db = new PDO('sqlite:' . $argv[1] . '/loja.sqlite');
        $db->exec('CREATE TABLE migracoes (numero INTEGER PRIMARY KEY, aplicada_em INTEGER NOT NULL)');
        foreach (gc_migracoes() as $n => $m) { if ($n === 103) continue; is_string($m) ? $db->exec($m) : $m($db); $db->prepare('INSERT INTO migracoes VALUES (?, ?)')->execute([$n, time()]); }
        $t = time();
        $db->prepare("INSERT INTO usuarios (login, nome, senha_hash, papel, criado_em, senha_em) VALUES ('dono', 'Dono', ?, 'dono', ?, ?)")->execute([password_hash('senha-forte-123', PASSWORD_DEFAULT), $t, $t]);
        gc_loja_semear($db, json_decode(file_get_contents($argv[2]), true));
        ${mudar}`, dir, arqSemente], { encoding: 'utf8', env: { ...process.env, GC_DADOS: dir } })
      return dir
    }
    /** Abre o banco com o código de agora (roda a 103) e devolve os prêmios, a versão e os eventos da 103. */
    const abrir = (dir) =>
      JSON.parse(execFileSync(PHP, ['-r', `define('GC_API', '1'); ${modulos}
        gc_db();
        echo json_encode([
          'premios' => gc_todos('SELECT id, raridade, demo, ativo FROM loja_premios ORDER BY ordem, id'),
          'versao' => (int) gc_ajuste('loja.versao'),
          'eventos' => array_column(gc_todos("SELECT acao FROM eventos WHERE acao = 'sorte-raridades'"), 'acao'),
          'publicos' => array_map(static fn ($p) => [$p['id'], $p['raridade']], gc_loja_publica()['sorte']['premios']),
          'regras' => gc_loja_publica()['sorte']['regras'],
        ]);`], { encoding: 'utf8', env: { ...process.env, GC_DADOS: dir } }))
    const a = abrir(bancoDeAntes('m103-fabrica'))
    igual(a.premios.map((p) => [p.id, p.raridade]), semente.sorte.premios.map((p) => [p.id, p.raridade]), 'os 5 de fábrica intactos: cada um com a raridade da semente e entram o épico e o lendário de exemplo, no fim')
    ok(a.premios.slice(5).every((p) => Number(p.demo) === 1 && Number(p.ativo) === 1), 'os 2 novos são de exemplo e no jogo')
    igual([a.versao, a.eventos], [2, ['sorte-raridades']], 'a versão da loja sobe (o site lê de novo) e fica na Atividade')
    igual(a.regras, { girosSemConta: 1, intervaloDias: 1, girosPorIntervalo: 1, girosPorDiaComConta: 1, reservaSemContaHoras: 24, chances: { comum: 60, raro: 25, epico: 12, lendario: 3 } }, 'as regras de antes viram 1 giro a cada 1 dia, com as chances de fábrica')
    // o dono tinha mudado um prêmio (o peso da OCB): nada muda, todos comuns, sem exemplo novo
    const b = abrir(bancoDeAntes('m103-mudado', `$db->exec("UPDATE loja_premios SET peso = 31 WHERE id = 'ocb-4-por-3'");`))
    igual([b.premios.length, [...new Set(b.premios.map((p) => p.raridade))], b.versao, b.eventos], [5, ['comum'], 1, []], 'com um prêmio mudado pelo dono: todos comuns, nenhum exemplo novo, nada na Atividade')
    // o dono tinha tirado um exemplo do jogo, ou apagado um: também não mexe
    const c = abrir(bancoDeAntes('m103-fora', `$db->exec("UPDATE loja_premios SET ativo = 0 WHERE id = 'bandeja-10'");`))
    igual([c.premios.length, [...new Set(c.premios.map((p) => p.raridade))]], [5, ['comum']], 'com um exemplo fora do jogo: não mexe')
    const d = abrir(bancoDeAntes('m103-apagado', `$db->exec("DELETE FROM loja_premios WHERE id = 'bandeja-10'");`))
    igual([d.premios.length, [...new Set(d.premios.map((p) => p.raridade))]], [4, ['comum']], 'com um exemplo apagado: não mexe (nem traz ele de volta)')
    // o dono com prêmios próprios (apagou os exemplos e criou o dele): fica comum
    const e = abrir(bancoDeAntes('m103-proprio', `$db->exec("DELETE FROM loja_premios"); $db->exec("INSERT INTO loja_premios (id, tipo, valor, titulo, descricao, regra, aplica_a, como_usar, peso, validade_dias, ativo, demo, ordem, criado_em, atualizado_em) VALUES ('meu', 'desconto-percentual', '5', 'Meu', 'Meu prêmio.', '5% na seda', '{\\"categorias\\":[\\"sedas\\"]}', '', 1, 7, 1, 0, 0, 1, 1)");`))
    igual(e.premios.map((p) => [p.id, p.raridade]), [['meu', 'comum']], 'prêmio próprio do dono: comum')
    igual(e.publicos, [['meu', 'comum']], 'e o GET loja diz comum')
    // rodar de novo não faz nada (a 103 roda uma vez)
    igual(abrir(join(tmp, 'm103-fabrica')).premios.length, 7, 'abrir de novo não insere de novo')
  }
}
