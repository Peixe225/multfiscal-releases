// Avisos no WhatsApp: por onde saem (desligado, Z-API, Evolution ou webhook), quem recebe, o que avisa, o teste e o
// histórico (com o que não foi e o "Mandar de novo"). Os segredos nunca voltam do servidor: aqui só aparece o final
// (•••1234), e campo de segredo em branco mantém o guardado.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import * as api from '../api'
import { useAcao, useDados } from '../dados'
import { plural } from '../formato'
import { Topo } from '../Moldura'
import { useRestaurarRolagem, useTitulo } from '../telas/comum'
import { Aviso, Botao, Campo, Carregando, Ic, TituloTela } from '../ui'
import { celularNoCampo, conferirCelular, mascaraCelular } from '../whats'
import { avisos as lerAvisos, reenviarAviso, salvarAvisos, testarAvisos } from './api'
import { diaHora, ListaAvisos } from './comum'
import './estilo'
import type { ConfigAvisos, CorpoAvisos, DadosAvisos, EnvioAviso, EventoAviso, Motor, SituacaoAvisos } from './tipos'

const NOME_MOTOR: Record<Motor, string> = { nenhum: 'Desligado', zapi: 'Z-API', evolution: 'Evolution API', webhook: 'Webhook' }

const MOTORES: { id: Motor; sub: string }[] = [
  { id: 'nenhum', sub: 'Nada vai pro grupo.' },
  { id: 'zapi', sub: 'Um número de WhatsApp conectado no Z-API manda o aviso pro grupo da loja.' },
  { id: 'evolution', sub: 'A mesma ideia, com um servidor da Evolution (teu ou contratado).' },
  { id: 'webhook', sub: 'Pra quem já usa n8n, Make ou outro automatizador: a loja manda o aviso e ele faz o resto.' },
]

const EVENTOS: { id: EventoAviso; nome: string; sub: string }[] = [
  { id: 'pedido', nome: 'Pedido novo', sub: 'Cada pedido fechado pelo site, com itens, entrega e pagamento.' },
  { id: 'encomenda', nome: 'Encomenda', sub: 'Pedido de um produto que a loja ainda não tem.' },
  { id: 'rateio-reserva', nome: 'Reserva de rateio', sub: 'Alguém entrou num rateio pelo site (esperando o pagamento).' },
  { id: 'rateio-pago', nome: 'Pagamento de rateio', sub: 'Pagamento confirmado aqui no painel, com o placar.' },
]

type Segredo = { novo: string; apagar: boolean }
const SEGREDO: Segredo = { novo: '', apagar: false }

interface Form {
  motor: Motor
  destinoTipo: 'grupo' | 'numero'
  destinoValor: string
  zapiInstancia: string
  zapiToken: Segredo
  zapiClient: Segredo
  evoUrl: string
  evoInstancia: string
  evoApikey: Segredo
  whUrl: Segredo
  whSegredo: Segredo
  eventos: Record<EventoAviso, boolean>
}

function formDe(c: ConfigAvisos): Form {
  return {
    motor: c.motor,
    destinoTipo: c.destino.tipo,
    destinoValor: c.destino.tipo === 'numero' ? celularNoCampo(c.destino.valor) : c.destino.valor,
    zapiInstancia: c.zapi.instancia,
    zapiToken: SEGREDO,
    zapiClient: SEGREDO,
    evoUrl: c.evolution.url,
    evoInstancia: c.evolution.instancia,
    evoApikey: SEGREDO,
    whUrl: SEGREDO,
    whSegredo: SEGREDO,
    eventos: { ...c.eventos },
  }
}

/** '' = fica o guardado; null = apaga; texto = troca. */
const segredo = (s: Segredo): string | null => (s.apagar ? null : s.novo.trim())

function corpoDe(f: Form): CorpoAvisos {
  return {
    motor: f.motor,
    destino: { tipo: f.destinoTipo, valor: f.destinoValor.trim() },
    zapi: { instancia: f.zapiInstancia.trim(), token: segredo(f.zapiToken), clientToken: segredo(f.zapiClient) },
    evolution: { url: f.evoUrl.trim(), instancia: f.evoInstancia.trim(), apikey: segredo(f.evoApikey) },
    webhook: { url: segredo(f.whUrl), segredo: segredo(f.whSegredo) },
    eventos: f.eventos,
  }
}

/** Segredo forte pro webhook (fica no campo pra copiar antes de salvar). */
function gerarSegredo(): string {
  const b = new Uint8Array(24)
  crypto.getRandomValues(b)
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// os campos que o servidor pode recusar (ErroApi.campo) → o id na tela, na ordem da tela (o foco vai pro primeiro errado)
const CAMPOS: Record<string, string> = {
  motor: 'av-motor',
  'zapi.instancia': 'av-zapi-instancia',
  'zapi.token': 'av-zapi-token',
  'zapi.clientToken': 'av-zapi-client',
  'evolution.url': 'av-evo-url',
  'evolution.instancia': 'av-evo-instancia',
  'evolution.apikey': 'av-evo-apikey',
  'webhook.url': 'av-wh-url',
  'webhook.segredo': 'av-wh-segredo',
  destino: 'av-destino',
}

// o campo do formulário → o nome que o servidor usa (pra limpar o erro certo enquanto digita)
const CAMPO_DO_FORM: Partial<Record<keyof Form, string>> = {
  zapiInstancia: 'zapi.instancia',
  zapiToken: 'zapi.token',
  zapiClient: 'zapi.clientToken',
  evoUrl: 'evolution.url',
  evoInstancia: 'evolution.instancia',
  evoApikey: 'evolution.apikey',
  whUrl: 'webhook.url',
  whSegredo: 'webhook.segredo',
  destinoTipo: 'destino',
  destinoValor: 'destino',
}

type Erros = Partial<Record<string, string>>

/** "•••1234" (ou "•••" quando o guardado é curto demais pra mostrar o final); null = não tem. */
function finalDe(guardado: string | null): string | null {
  return guardado === null ? null : `•••${guardado}`
}

/** O que falta antes de mandar pro servidor (o servidor confere tudo de novo). */
function conferir(f: Form, c: ConfigAvisos): Erros {
  const e: Erros = {}
  const novoOuGuardado = (s: Segredo, guardado: string | null) => (s.apagar ? '' : s.novo.trim() || (guardado !== null ? 'guardado' : ''))
  if (f.motor === 'zapi') {
    if (!f.zapiInstancia.trim()) e['zapi.instancia'] = 'Falta o ID da instância do Z-API.'
    else if (!/^[A-Za-z0-9]{6,64}$/.test(f.zapiInstancia.trim())) e['zapi.instancia'] = 'O ID da instância é só letra e número (tá no painel do Z-API).'
    if (!novoOuGuardado(f.zapiToken, c.zapi.token)) e['zapi.token'] = 'Falta o token da instância do Z-API.'
  }
  if (f.motor === 'evolution') {
    if (!f.evoUrl.trim()) e['evolution.url'] = 'Falta o endereço da Evolution.'
    else if (!/^https?:\/\/\S+$/i.test(f.evoUrl.trim())) e['evolution.url'] = 'Põe o endereço com https:// na frente.'
    if (!f.evoInstancia.trim()) e['evolution.instancia'] = 'Falta o nome da instância.'
    if (!novoOuGuardado(f.evoApikey, c.evolution.apikey)) e['evolution.apikey'] = 'Falta a apikey.'
  }
  if (f.motor === 'webhook') {
    if (!(f.whUrl.apagar ? '' : f.whUrl.novo.trim() || (c.webhook.temUrl ? 'guardado' : ''))) e['webhook.url'] = 'Falta o endereço do webhook.'
    else if (f.whUrl.novo.trim() && !/^https?:\/\/\S+$/i.test(f.whUrl.novo.trim())) e['webhook.url'] = 'Põe o endereço com https:// na frente.'
    const s = f.whSegredo.novo.trim()
    if (!novoOuGuardado(f.whSegredo, c.webhook.segredo)) e['webhook.segredo'] = 'Falta o segredo do webhook (toca em Gerar).'
    else if (s && (s.length < 16 || /\s/.test(s))) e['webhook.segredo'] = 'O segredo vai sem espaço, com 16 caracteres ou mais.'
  }
  if (f.motor === 'zapi' || f.motor === 'evolution') {
    const v = f.destinoValor.trim()
    if (!v) e.destino = f.destinoTipo === 'grupo' ? 'Falta o ID do grupo que recebe os avisos.' : 'Falta o número que recebe os avisos.'
    else if (f.destinoTipo === 'numero') {
      const p = conferirCelular(v)
      if (p) e.destino = p
    } else if (!/^\d{10,25}(-\d{6,12})?$/.test(v.replace(/(@g\.us|-group)$/i, ''))) e.destino = 'ID do grupo só com números (o que vem antes de "@g.us" ou "-group").'
  }
  return e
}

function Situacao({ s, agora }: { s: SituacaoAvisos; agora: number }) {
  return (
    <section className={`pd-situacao${s.ligado ? ' pd-situacao-on' : ''}`} aria-label="Situação dos avisos">
      <span className="pd-situacao-ic" aria-hidden="true">
        <Ic nome={s.ligado ? (s.falhas ? 'atencao' : 'sino-cheio') : 'sino'} tamanho={16} />
      </span>
      <span className="pd-situacao-txt">
        <strong>{s.ligado ? `Ligado · ${NOME_MOTOR[s.motor]}` : 'Desligado'}</strong>
        {s.ligado ? (
          <>
            <span>{s.ultimoEnviado ? `Último aviso que saiu: ${diaHora(s.ultimoEnviado, agora)}.` : 'Nenhum aviso saiu ainda. Toca em “Enviar teste”.'}</span>
            {s.falhas > 0 && <span>{plural(s.falhas, 'aviso não foi', 'avisos não foram')} nos últimos 7 dias: confere o histórico.</span>}
            {s.naFila > 0 && <span>{plural(s.naFila, 'aviso na fila', 'avisos na fila')}.</span>}
          </>
        ) : (
          <span>Os pedidos continuam chegando no WhatsApp da loja e aqui no painel. Ligando, cada pedido também vira um aviso no grupo da loja.</span>
        )}
      </span>
    </section>
  )
}

function CampoSegredo({
  id,
  rotulo,
  guardado,
  valor,
  aoMudar,
  dica,
  erro,
  opcional = false,
  gerar = false,
}: {
  id: string
  rotulo: string
  /** Como mostrar o guardado ("•••1234", ou o endereço mascarado); null = não tem. */
  guardado: string | null
  valor: Segredo
  aoMudar: (s: Segredo) => void
  dica?: string
  erro?: string
  opcional?: boolean
  gerar?: boolean
}) {
  const tem = guardado !== null
  const texto = valor.apagar ? `O guardado (${guardado}) sai quando salvar.` : tem ? `Guardado: ${guardado}. Em branco, fica ele.${dica ? ` ${dica}` : ''}` : dica
  // o final curto vai também do lado do rótulo (o endereço inteiro não cabe ali: fica só na dica)
  const curto = tem && (guardado ?? '').length <= 12
  return (
    <div className="pd-segredo">
      <Campo
        id={id}
        rotulo={rotulo}
        erro={erro}
        dica={texto}
        lado={
          curto ? (
            <span className="pd-guardado" aria-hidden="true">
              guardado <strong>{guardado}</strong>
            </span>
          ) : opcional ? (
            <span className="pn-opcional">opcional</span>
          ) : undefined
        }
      >
        {(a) => (
          <div className="pd-segredo-linha">
            <input
              {...a}
              name={id}
              className="pn-input"
              type="text"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={valor.novo}
              disabled={valor.apagar}
              onChange={(e) => aoMudar({ novo: e.target.value, apagar: false })}
            />
            {gerar && !valor.apagar && (
              <Botao variante="cinza" onClick={() => aoMudar({ novo: gerarSegredo(), apagar: false })}>
                Gerar
              </Botao>
            )}
          </div>
        )}
      </Campo>
      {tem && (
        <button type="button" className="pn-link-botao pd-apagar-guardado" onClick={() => aoMudar({ novo: '', apagar: !valor.apagar })}>
          {valor.apagar ? 'Não apagar o guardado' : 'Apagar o guardado'}
          <span className="sr-only"> ({rotulo})</span>
        </button>
      )}
    </div>
  )
}

function ComoLigar({ motor }: { motor: Motor }) {
  if (motor === 'nenhum') return null
  return (
    <details className="pd-detalhes pd-como">
      <summary>Como ligar {motor === 'webhook' ? 'o webhook' : `pela ${motor === 'zapi' ? 'Z-API' : 'Evolution'}`}</summary>
      {motor === 'zapi' && (
        <ol>
          <li>No Z-API, cria uma instância e conecta o WhatsApp que vai mandar os avisos (lendo o QR Code com o celular).</li>
          <li>Copia o ID e o token da instância pra cá. Se a conta tiver o token de segurança ligado, copia o Client-Token também.</li>
          <li>Põe esse número no grupo da loja e copia o ID do grupo (o número que vem antes de “-group”).</li>
          <li>Salva e toca em “Enviar teste”: a mensagem tem que chegar no grupo.</li>
        </ol>
      )}
      {motor === 'evolution' && (
        <ol>
          <li>Na Evolution, cria uma instância e conecta o WhatsApp que vai mandar os avisos.</li>
          <li>Copia pra cá o endereço do servidor, o nome da instância e a apikey.</li>
          <li>Põe esse número no grupo da loja e copia o ID do grupo (o que vem antes de “@g.us”).</li>
          <li>Salva e toca em “Enviar teste”: a mensagem tem que chegar no grupo.</li>
        </ol>
      )}
      {motor === 'webhook' && (
        <ol>
          <li>No automatizador (n8n, Make…), cria um fluxo que começa com um webhook e copia o endereço dele pra cá.</li>
          <li>Toca em “Gerar” no segredo e copia o mesmo segredo pro fluxo, antes de salvar.</li>
          <li>
            A loja manda um POST em JSON com <code>tipo</code>, <code>texto</code> (a mensagem pronta) e <code>dados</code> (o pedido inteiro), e o cabeçalho <code>X-GC-Assinatura</code>: o HMAC-SHA256 do
            corpo com o segredo, em hexadecimal. O fluxo confere a assinatura e manda o texto pro WhatsApp.
          </li>
          <li>Salva e toca em “Enviar teste”.</li>
        </ol>
      )}
    </details>
  )
}

export function Avisos() {
  useTitulo('Avisos no WhatsApp')
  const leitura = useDados<DadosAvisos>('avisos', (s) => lerAvisos(s))
  const d = leitura.dados
  useRestaurarRolagem(!!d)
  const [f, setF] = useState<Form | null>(null)
  const [erros, setErros] = useState<Erros>({})
  const [recado, setRecado] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  const [soFalhas, setSoFalhas] = useState(false)
  const salvar = useAcao()
  const teste = useAcao()
  const reenvio = useAcao()
  const form = useRef<HTMLFormElement>(null)
  // o formulário nasce dos ajustes salvos (e renasce depois de salvar); a atualização de 30 s não mexe no que tá digitado
  useEffect(() => {
    if (d && f === null) setF(formDe(d.config))
  }, [d, f])

  if (leitura.erro && !d) {
    return (
      <>
        <Topo titulo={<TituloTela>Avisos no WhatsApp</TituloTela>} />
        <div className="pn-pagina pn-pagina-estreita">
          <Aviso tipo="erro" acao={<button type="button" className="pn-link-botao" onClick={() => void leitura.recarregar()}>Tentar de novo</button>}>
            {leitura.erro.message}
          </Aviso>
        </div>
      </>
    )
  }
  if (!d || !f) {
    return (
      <>
        <Topo titulo={<TituloTela>Avisos no WhatsApp</TituloTela>} />
        <Carregando rotulo="Carregando os avisos…" />
      </>
    )
  }

  const c = d.config
  const agora = api.agora()
  const salvo = JSON.stringify(corpoDe(formDe(c)))
  const mexeu = JSON.stringify(corpoDe(f)) !== salvo
  const mudar = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF((x) => (x ? { ...x, [k]: v } : x))
    setRecado(null)
    const campo = CAMPO_DO_FORM[k] ?? k
    if (erros[campo]) setErros((e) => ({ ...e, [campo]: undefined }))
    if (salvar.erro?.campo === campo) salvar.setErro(null)
  }
  const focar = (campo: string) => {
    const el = CAMPOS[campo] ? form.current?.querySelector<HTMLElement>(`#${CAMPOS[campo]}`) : null
    ;(el?.matches('input, select, textarea') ? el : el?.querySelector<HTMLElement>('input'))?.focus()
  }

  const aoSalvar = async (e: FormEvent) => {
    e.preventDefault()
    setRecado(null)
    const n = conferir(f, c)
    setErros(n)
    const primeiro = Object.keys(CAMPOS).find((k) => n[k])
    if (primeiro) {
      focar(primeiro)
      return
    }
    const r = await salvar.rodar('salvar', () => salvarAvisos(corpoDe(f)))
    if (r) {
      leitura.trocar((x) => ({ ...x, config: r.config, situacao: r.situacao }))
      setF(formDe(r.config))
      setRecado({ tipo: 'ok', texto: r.config.motor === 'nenhum' ? 'Salvo. Os avisos no grupo tão desligados.' : `Salvo. Os avisos saem pelo ${NOME_MOTOR[r.config.motor]}: toca em “Enviar teste” pra conferir.` })
    }
  }
  // erro do servidor no salvar: no campo certo (ou embaixo, quando não é de um campo)
  const erroSalvar = salvar.erro
  const campoServidor = erroSalvar?.campo && CAMPOS[erroSalvar.campo] ? erroSalvar.campo : null
  const errosVisiveis: Erros = campoServidor ? { ...erros, [campoServidor]: erros[campoServidor] ?? erroSalvar?.message } : erros

  const aoTestar = async () => {
    setRecado(null)
    const r = await teste.rodar('teste', () => testarAvisos())
    if (r) {
      leitura.trocar((x) => ({ ...x, envios: [r.envio, ...x.envios.filter((e) => e.id !== r.envio.id)] }))
      void leitura.recarregar()
      setRecado(
        r.envio.status === 'enviado'
          ? { tipo: 'ok', texto: `A mensagem de teste saiu pelo ${NOME_MOTOR[c.motor]}. Confere se chegou ${c.destino.tipo === 'numero' ? 'no número' : 'no grupo'}.` }
          : { tipo: 'erro', texto: `O teste não foi: ${r.envio.erro || 'o serviço não respondeu.'}` },
      )
    }
  }

  const aoReenviar = (e: EnvioAviso) =>
    void reenvio.rodar(`r-${e.id}`, async () => {
      const r = await reenviarAviso(e.id)
      leitura.trocar((x) => ({ ...x, envios: x.envios.map((a) => (a.id === r.envio.id ? r.envio : a)) }))
      void leitura.recarregar()
    })
  const reenviando = reenvio.ocupado ? Number(reenvio.ocupado.slice(2)) : null

  const falhas = d.envios.filter((e) => e.status === 'falhou')
  const lista = soFalhas ? falhas : d.envios
  const podeTestar = c.motor !== 'nenhum'

  return (
    <>
      <Topo titulo={<TituloTela>Avisos no WhatsApp</TituloTela>} />
      <div className="pn-pagina pn-pagina-estreita pd-avisos">
        <Situacao s={d.situacao} agora={agora} />

        <form ref={form} className="pd-form-avisos" onSubmit={aoSalvar} noValidate>
          <section className="pn-bloco" aria-labelledby="h-motor">
            <fieldset className="pn-opcoes" id="av-motor">
              <legend id="h-motor" className="pn-h2">
                Por onde o aviso sai
              </legend>
              {MOTORES.map((m) => (
                <label key={m.id} className="pn-opcao">
                  <input type="radio" name="motor" checked={f.motor === m.id} onChange={() => mudar('motor', m.id)} />
                  <span className="pn-opcao-marca" aria-hidden="true" />
                  <span>
                    <strong>{NOME_MOTOR[m.id]}</strong>
                    <small>{m.sub}</small>
                  </span>
                </label>
              ))}
            </fieldset>
          </section>

          {f.motor !== 'nenhum' && (
            <section className="pn-bloco pn-form" aria-labelledby="h-conexao">
              <h2 id="h-conexao" className="pn-h2">
                Conexão com {f.motor === 'webhook' ? 'o webhook' : `a ${NOME_MOTOR[f.motor]}`}
              </h2>
              {f.motor === 'zapi' && (
                <>
                  <Campo id="av-zapi-instancia" rotulo="ID da instância" erro={errosVisiveis['zapi.instancia']} dica="Letras e números, na tela da instância no Z-API.">
                    {(a) => <input {...a} name="zapiInstancia" className="pn-input" type="text" autoComplete="off" autoCapitalize="off" spellCheck={false} value={f.zapiInstancia} onChange={(e) => mudar('zapiInstancia', e.target.value)} />}
                  </Campo>
                  <CampoSegredo id="av-zapi-token" rotulo="Token da instância" guardado={finalDe(c.zapi.token)} valor={f.zapiToken} aoMudar={(s) => mudar('zapiToken', s)} erro={errosVisiveis['zapi.token']} />
                  <CampoSegredo id="av-zapi-client" rotulo="Client-Token (token de segurança da conta)" guardado={finalDe(c.zapi.clientToken)} valor={f.zapiClient} aoMudar={(s) => mudar('zapiClient', s)} erro={errosVisiveis['zapi.clientToken']} opcional dica="Só se estiver ligado no Z-API." />
                </>
              )}
              {f.motor === 'evolution' && (
                <>
                  <Campo id="av-evo-url" rotulo="Endereço do servidor" erro={errosVisiveis['evolution.url']} dica="Com https:// na frente. Ex.: https://evolution.tualoja.com.br">
                    {(a) => <input {...a} name="evoUrl" className="pn-input" type="url" inputMode="url" autoComplete="off" autoCapitalize="off" spellCheck={false} value={f.evoUrl} onChange={(e) => mudar('evoUrl', e.target.value)} />}
                  </Campo>
                  <Campo id="av-evo-instancia" rotulo="Nome da instância" erro={errosVisiveis['evolution.instancia']}>
                    {(a) => <input {...a} name="evoInstancia" className="pn-input" type="text" autoComplete="off" autoCapitalize="off" spellCheck={false} value={f.evoInstancia} onChange={(e) => mudar('evoInstancia', e.target.value)} />}
                  </Campo>
                  <CampoSegredo id="av-evo-apikey" rotulo="Apikey" guardado={finalDe(c.evolution.apikey)} valor={f.evoApikey} aoMudar={(s) => mudar('evoApikey', s)} erro={errosVisiveis['evolution.apikey']} />
                </>
              )}
              {f.motor === 'webhook' && (
                <>
                  <CampoSegredo
                    id="av-wh-url"
                    rotulo="Endereço do webhook"
                    guardado={c.webhook.temUrl ? c.webhook.url : null}
                    valor={f.whUrl}
                    aoMudar={(s) => mudar('whUrl', s)}
                    erro={errosVisiveis['webhook.url']}
                    dica={c.webhook.temUrl ? undefined : 'Com https:// na frente (o endereço do começo do fluxo).'}
                  />
                  <CampoSegredo id="av-wh-segredo" rotulo="Segredo" guardado={finalDe(c.webhook.segredo)} valor={f.whSegredo} aoMudar={(s) => mudar('whSegredo', s)} erro={errosVisiveis['webhook.segredo']} gerar dica="16 caracteres ou mais. O mesmo vai no automatizador." />
                </>
              )}
              <ComoLigar motor={f.motor} />
            </section>
          )}

          {(f.motor === 'zapi' || f.motor === 'evolution') && (
            <section className="pn-bloco pn-form" aria-labelledby="h-destino">
              <h2 id="h-destino" className="pn-h2">
                Quem recebe
              </h2>
              <fieldset className="pn-opcoes">
                <legend className="pn-rotulo">Mandar pra</legend>
                <label className="pn-opcao">
                  <input type="radio" name="destinoTipo" checked={f.destinoTipo === 'grupo'} onChange={() => mudar('destinoTipo', 'grupo')} />
                  <span className="pn-opcao-marca" aria-hidden="true" />
                  <span>
                    <strong>Um grupo</strong>
                    <small>O grupo da loja (o número conectado tem que estar nele).</small>
                  </span>
                </label>
                <label className="pn-opcao">
                  <input type="radio" name="destinoTipo" checked={f.destinoTipo === 'numero'} onChange={() => mudar('destinoTipo', 'numero')} />
                  <span className="pn-opcao-marca" aria-hidden="true" />
                  <span>
                    <strong>Um número</strong>
                    <small>Só uma pessoa recebe (o teu WhatsApp, por exemplo).</small>
                  </span>
                </label>
              </fieldset>
              {f.destinoTipo === 'grupo' ? (
                <Campo id="av-destino" rotulo="ID do grupo" erro={errosVisiveis.destino} dica={`Só os números (com o traço, se tiver). Pode colar com o “${f.motor === 'zapi' ? '-group' : '@g.us'}” do fim: a loja tira.`}>
                  {(a) => <input {...a} name="destinoValor" className="pn-input" type="text" inputMode="numeric" autoComplete="off" spellCheck={false} value={f.destinoValor} onChange={(e) => mudar('destinoValor', e.target.value)} />}
                </Campo>
              ) : (
                <Campo id="av-destino" rotulo="WhatsApp que recebe" erro={errosVisiveis.destino} dica="DDD + número.">
                  {(a) => <input {...a} name="destinoValor" className="pn-input" type="tel" inputMode="tel" autoComplete="off" value={f.destinoValor} onChange={(e) => mudar('destinoValor', mascaraCelular(e.target.value))} />}
                </Campo>
              )}
            </section>
          )}

          {f.motor !== 'nenhum' && (
            <section className="pn-bloco" aria-labelledby="h-eventos">
              <fieldset className="pn-opcoes">
                <legend id="h-eventos" className="pn-h2">
                  O que avisa
                </legend>
                {EVENTOS.map((ev) => (
                  <label key={ev.id} className="pn-troca pd-evento">
                    <input type="checkbox" checked={f.eventos[ev.id]} onChange={(e) => mudar('eventos', { ...f.eventos, [ev.id]: e.target.checked })} />
                    <span className="pn-troca-marca" aria-hidden="true" />
                    <span className="pd-evento-txt">
                      <strong>{ev.nome}</strong>
                      <small>{ev.sub}</small>
                    </span>
                  </label>
                ))}
              </fieldset>
            </section>
          )}

          <div className="pd-salvar">
            {erroSalvar && !campoServidor && <Aviso tipo="erro">{erroSalvar.message}</Aviso>}
            {teste.erro && <Aviso tipo="erro">{teste.erro.message}</Aviso>}
            {recado && <Aviso tipo={recado.tipo}>{recado.texto}</Aviso>}
            <div className="pd-acoes-linha">
              <Botao type="submit" ocupado={salvar.ocupado === 'salvar'}>
                Salvar
              </Botao>
              {podeTestar && (
                <Botao variante="cinza" icone="enviar" ocupado={teste.ocupado === 'teste'} disabled={mexeu && teste.ocupado !== 'teste'} onClick={() => void aoTestar()}>
                  Enviar teste
                </Botao>
              )}
            </div>
            {podeTestar && mexeu && <p className="pn-dica-bloco">O teste usa o que tá salvo: salva antes de testar.</p>}
          </div>
        </form>

        <section className="pn-bloco pd-historico" aria-labelledby="h-historico">
          <div className="pn-h2-linha">
            <h2 id="h-historico" className="pn-h2">
              Histórico
            </h2>
            {falhas.length > 0 && (
              <button type="button" className={`pn-filtro${soFalhas ? ' on' : ''}`} aria-pressed={soFalhas} onClick={() => setSoFalhas((v) => !v)}>
                Só os que não foram <span className="pn-filtro-n">{falhas.length}</span>
              </button>
            )}
          </div>
          {reenvio.erro && <Aviso tipo="erro">{reenvio.erro.message}</Aviso>}
          {lista.length === 0 ? (
            <p className="pn-vazio">{soFalhas ? 'Nenhum aviso falhou.' : 'Nenhum aviso ainda. Os últimos 50 aparecem aqui, com o que não foi e o porquê.'}</p>
          ) : (
            <ListaAvisos envios={lista} agora={agora} ocupado={reenviando} aoReenviar={aoReenviar} />
          )}
        </section>
      </div>
    </>
  )
}
