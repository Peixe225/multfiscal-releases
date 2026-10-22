// Um estado (o canal de atendimento), na ordem do dia a dia: horário de entrega (com madrugada e "repetir nos outros
// dias"), taxa (uma pro estado, ou por bairro: a lista de bairros, que aparece no site ou o cliente consulta) ou "a
// confirmar", o pedido mínimo pra entrega (vazio = sem mínimo), entrega grátis por dia da semana, formas de pagamento, cidades, WhatsApp próprio ou o da
// loja e o perfil (Instagram, nome do perfil e do destaque). Por último, separado, o "Tirar [estado] do site", que
// confirma antes (e o recado tem "Desfazer"); estado fora do site tem o "Pôr de volta no site" em cima. Estado que a
// loja ainda não tem: o mesmo formulário ativa ele.
// Na edição, só vai o que mudou: o que ninguém mexeu continua como estava (e o que era exemplo continua exemplo).
// O que tá sendo digitado fica guardado no aparelho até salvar (recarregar ou voltar não perde) e sair com mudança
// pergunta antes (sair.tsx). A cidade digitada sem tocar em "Adicionar" entra ao salvar.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import * as apiBase from '../api'
import { ErroApi } from '../api'
import { Confirmar, type PedidoConfirmacao } from '../Confirmar'
import { brl, reaisNoCampo, whatsappBonito } from '../formato'
import { lembrarJson, lidoJson } from '../lembrar'
import { Link, Topo } from '../Moldura'
import { recado } from '../recado'
import { caminho, ir, voltar } from '../rotas'
import { useAvisarAoSair } from '../sair'
import { useTitulo } from '../telas/comum'
import { Aviso, Botao, Campo, Carregando, Ic, TituloTela } from '../ui'
import * as api from './api'
import { comEstado, guardarLoja, useLoja } from './dados'
import { DIAS, DIAS_CURTOS, nomeUf, NOMES_UF, PAGAMENTOS } from './nomes'
import { Bairros } from './Bairros'
import type { BairroAdmin, EstadoAdmin, EstadoCorpo, FormaPagamento, Turno } from './tipos'
import { horaValida, lerInstagram, lerPreco, lerWhatsapp, mascaraHora, normalizarHora, problemaNoTexto, tamanho } from './validar'

interface Dia {
  aberto: boolean
  abre: string
  fecha: string
}

interface Form {
  ativo: boolean
  instagram: string
  nomePerfil: string
  destaque: string
  whatsModo: 'loja' | 'proprio'
  whatsapp: string
  cidades: string[]
  semana: Dia[]
  taxaModo: 'confirmar' | 'valor'
  taxa: string
  /** A taxa por bairro (22/10): uma taxa pro estado ou por bairro; como o cliente vê; a lista. */
  taxaPor: 'estado' | 'bairro'
  bairrosVer: 'site' | 'consulta'
  bairros: BairroAdmin[]
  /** Pedido mínimo pra entrega (vazio = sem mínimo). O nome é o do campo no servidor: o erro dele cai aqui. */
  pedidoMinimo: string
  gratis: boolean
  gratisDias: number[]
  gratisTexto: string
  pagamentos: FormaPagamento[]
  /** A cidade digitada que ainda não foi pra lista (entra ao salvar, com as mesmas conferências do "Adicionar"). */
  cidadeNova: string
}

type Erros = Partial<Record<string, string>>

const DIA_PADRAO: Dia = { aberto: false, abre: '14:00', fecha: '23:00' }

function doEstado(e: EstadoAdmin): Form {
  return {
    ativo: e.ativo,
    instagram: e.instagram,
    nomePerfil: e.nomePerfil ?? '',
    destaque: e.destaque,
    whatsModo: e.whatsapp ? 'proprio' : 'loja',
    whatsapp: e.whatsapp ? whatsappBonito(e.whatsapp) : '',
    cidades: e.cidades.map((c) => c.nome),
    semana: e.horario.semana.map((t) => (t ? { aberto: true, abre: t[0], fecha: t[1] } : { ...DIA_PADRAO })),
    taxaModo: e.taxaEntrega.valor == null ? 'confirmar' : 'valor',
    taxa: reaisNoCampo(e.taxaEntrega.valor),
    // servidor de antes da migração 107: uma taxa só
    taxaPor: e.taxaPor === 'bairro' ? 'bairro' : 'estado',
    bairrosVer: e.bairrosVer === 'consulta' ? 'consulta' : 'site',
    bairros: e.bairros ?? [],
    pedidoMinimo: reaisNoCampo(e.pedidoMinimo ?? null),
    gratis: !!e.entregaGratis,
    gratisDias: e.entregaGratis?.dias ?? [],
    gratisTexto: e.entregaGratis?.texto ?? 'Sextou com entrega grátis!',
    pagamentos: e.pagamento.opcoes,
    cidadeNova: '',
  }
}

function novo(uf: string): Form {
  return {
    ativo: true,
    instagram: '',
    nomePerfil: '',
    destaque: `DELIVERY ${uf.toUpperCase()}`,
    whatsModo: 'loja',
    whatsapp: '',
    cidades: [],
    semana: Array.from({ length: 7 }, () => ({ ...DIA_PADRAO })),
    taxaModo: 'confirmar',
    taxa: '',
    taxaPor: 'estado',
    bairrosVer: 'site',
    bairros: [],
    pedidoMinimo: '',
    gratis: false,
    gratisDias: [],
    gratisTexto: 'Sextou com entrega grátis!',
    pagamentos: ['pix', 'dinheiro', 'cartao'],
    cidadeNova: '',
  }
}

const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

function validar(f: Form): Erros {
  const e: Erros = {}
  if (!lerInstagram(f.instagram)) e.instagram = 'Põe o @ do Instagram do estado (letras, números, ponto e _).'
  const perfil = f.nomePerfil.trim()
  if (perfil && (tamanho(perfil) < 2 || tamanho(perfil) > 40)) e.nomePerfil = 'Nome do perfil de 2 a 40 letras (ou vazio: aparece só o @).'
  else if (problemaNoTexto(perfil, 'loja')) e.nomePerfil = problemaNoTexto(perfil, 'loja') ?? undefined
  const d = f.destaque.trim()
  if (tamanho(d) < 2 || tamanho(d) > 20) e.destaque = 'Nome do destaque de 2 a 20 letras (ex.: DELIVERY RJ).'
  else if (problemaNoTexto(d, 'loja')) e.destaque = problemaNoTexto(d, 'loja') ?? undefined
  if (f.whatsModo === 'proprio' && !lerWhatsapp(f.whatsapp)) e.whatsapp = 'Esse WhatsApp não fecha. Põe DDD + 9 dígitos (ou usa o da loja).'
  f.semana.forEach((x, i) => {
    if (!x.aberto) return
    if (!horaValida(x.abre) || !horaValida(x.fecha)) e[`dia-${i}`] = `Horário de ${DIAS[i].toLowerCase()} em HH:MM (ex.: 14:00).`
    else if (x.abre === x.fecha) e[`dia-${i}`] = `Em ${DIAS[i].toLowerCase()}, abre e fecha no mesmo horário.`
  })
  if (f.taxaPor === 'bairro') {
    // a taxa única fica guardada como tá (o painel não manda); a lista é conferida no "Adicionar" e no servidor
  } else if (f.taxaModo === 'valor' && (f.taxa.trim() === '' || lerPreco(f.taxa) == null)) e.taxa = 'Taxa de R$ 0,01 a R$ 100.000,00, ou “A confirmar”.'
  else if (f.taxaModo === 'valor' && lerPreco(f.taxa) === 0) e.taxa = 'Taxa R$ 0,00: pra entregar sem taxa, liga “Entrega grátis” nos dias que valem (logo aqui embaixo).'
  if (f.pedidoMinimo.trim() !== '') {
    const m = lerPreco(f.pedidoMinimo)
    if (m == null || m > 1000) e.pedidoMinimo = 'Pedido mínimo de R$ 0,01 a R$ 1.000,00, ou vazio (sem mínimo).'
  }
  if (f.gratis) {
    if (!f.gratisDias.length) e.gratisDias = 'Escolhe em que dia a entrega é grátis.'
    const t = f.gratisTexto.trim()
    if (tamanho(t) < 2 || tamanho(t) > 40) e.gratisTexto = 'Frase de 2 a 40 letras (ex.: Sextou com entrega grátis!).'
    else if (problemaNoTexto(t)) e.gratisTexto = problemaNoTexto(t) ?? undefined
  }
  if (!f.pagamentos.length) e.pagamentos = 'Escolhe pelo menos uma forma de pagamento.'
  for (const k of Object.keys(e)) if (!e[k]) delete e[k]
  return e
}

/** A cidade nova serve? (o mesmo do "Adicionar"): null = serve. */
function problemaNaCidade(n: string, cidades: string[]): string | null {
  if (!n) return 'Escreve o nome da cidade.'
  if (tamanho(n) < 2 || tamanho(n) > 60) return 'Nome da cidade de 2 a 60 letras.'
  const problema = problemaNoTexto(n, 'loja')
  if (problema) return problema
  if (cidades.some((c) => slug(c) === slug(n))) return `“${n}” já tá na lista.`
  if (cidades.length >= 30) return 'Até 30 cidades.'
  return null
}

const limparCidade = (s: string) => s.trim().replace(/\s+/g, ' ')

/**
 * O nome do destaque cabe inteiro embaixo da bolinha no celular? A fonte e a largura do site (11 px; a bolinha do estado
 * deixa uns 76 px no celular de 344 px). Sem como medir, diz que cabe.
 */
function cabeNaBolinha(texto: string): boolean {
  try {
    const c = document.createElement('canvas').getContext('2d')
    if (!c) return true
    c.font = "400 11px system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    return c.measureText(texto.trim()).width <= 76
  } catch {
    return true
  }
}

function horario(f: Form): Turno[] {
  return f.semana.map((x) => (x.aberto ? [x.abre, x.fecha] : null))
}

/** Só o que mudou (estado novo: tudo). */
function corpo(f: Form, uf: string, antes: Form | null): EstadoCorpo {
  const c: EstadoCorpo = { uf }
  const mudou = (k: keyof Form) => !antes || JSON.stringify(f[k]) !== JSON.stringify(antes[k])
  // o "Aparece no site" de um estado que já existe vai sozinho (Tirar do site / Pôr de volta); o novo nasce no site
  if (!antes) c.ativo = true
  if (mudou('instagram')) c.instagram = lerInstagram(f.instagram) ?? f.instagram
  if (mudou('nomePerfil')) c.nomePerfil = f.nomePerfil.trim() || null
  if (mudou('destaque')) c.destaque = f.destaque.trim()
  if (mudou('whatsModo') || mudou('whatsapp')) c.whatsapp = f.whatsModo === 'proprio' ? lerWhatsapp(f.whatsapp) : null
  if (mudou('cidades')) c.cidades = f.cidades.map((nome) => ({ nome }))
  // estado novo sem nenhum dia aberto: o horário fica "a confirmar" (o servidor marca como exemplo e o site não mostra)
  if (mudou('semana') && (antes || f.semana.some((x) => x.aberto))) c.horario = horario(f)
  if (mudou('taxaModo') || mudou('taxa')) c.taxa = f.taxaModo === 'valor' ? (lerPreco(f.taxa) ?? null) : null
  // a taxa por bairro: só o que mudou (o servidor mantém o resto)
  if (mudou('taxaPor')) c.taxaPor = f.taxaPor
  if (mudou('bairrosVer')) c.bairrosVer = f.bairrosVer
  if (mudou('bairros')) c.bairros = f.bairros.map((b) => ({ nome: b.nome, ...(b.cidade ? { cidade: b.cidade } : {}), taxa: b.taxa }))
  // vazio ou R$ 0 = sem mínimo (o servidor guarda null)
  if (mudou('pedidoMinimo')) c.pedidoMinimo = f.pedidoMinimo.trim() ? (lerPreco(f.pedidoMinimo) || null) : null
  if (mudou('gratis') || mudou('gratisDias') || mudou('gratisTexto')) c.entregaGratis = f.gratis ? { dias: [...f.gratisDias].sort(), texto: f.gratisTexto.trim() } : null
  if (mudou('pagamentos')) c.pagamentos = f.pagamentos
  return c
}

/** "fecha às 3h da madrugada de sábado" quando fecha depois da meia-noite. */
function madrugada(x: Dia, i: number): string | null {
  if (!x.aberto || !horaValida(x.abre) || !horaValida(x.fecha) || x.fecha >= x.abre) return null
  const [h, m] = x.fecha.split(':').map(Number)
  return `Fecha ${h === 0 && m === 0 ? 'à meia-noite' : `às ${h}h${m ? String(m).padStart(2, '0') : ''} da madrugada`} de ${DIAS[(i + 1) % 7].toLowerCase()}.`
}

/** Hora em texto com máscara (o campo de hora do navegador vira "02:00 PM" em aparelho em inglês). */
function Hora({ id, valor, rotulo, aoMudar }: { id?: string; valor: string; rotulo: string; aoMudar: (v: string) => void }) {
  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      maxLength={5}
      placeholder="00:00"
      className="pn-input pn-hora"
      aria-label={rotulo}
      value={valor}
      onChange={(e) => aoMudar(mascaraHora(e.target.value))}
      onBlur={(e) => {
        const n = normalizarHora(e.target.value)
        if (n !== e.target.value) aoMudar(n)
      }}
    />
  )
}

function Secao({ titulo, id, children, dica }: { titulo: string; id: string; children: ReactNode; dica?: ReactNode }) {
  return (
    <section className="pn-form-secao" aria-labelledby={id}>
      <h2 id={id} className="pn-h2">
        {titulo}
      </h2>
      {dica && <p className="pn-dica-bloco">{dica}</p>}
      {children}
    </section>
  )
}

function Cidades({ cidades, nova, aoMudarNova, aoMudar, erro }: { cidades: string[]; nova: string; aoMudarNova: (v: string) => void; aoMudar: (c: string[]) => void; erro?: string }) {
  const [falha, setFalha] = useState<string | null>(null)
  const campo = useRef<HTMLInputElement>(null)
  const adicionar = () => {
    const n = limparCidade(nova)
    const p = problemaNaCidade(n, cidades)
    if (p) {
      setFalha(p)
      if (!n) campo.current?.focus()
      return
    }
    aoMudar([...cidades, n])
    aoMudarNova('')
    setFalha(null)
    campo.current?.focus()
  }
  return (
    <div className="pn-cidades">
      {cidades.length > 0 ? (
        <ul className="pn-escolhidos" aria-label="Cidades atendidas">
          {cidades.map((c) => (
            <li key={slug(c)} className="pn-escolhido">
              <Ic nome="pin" tamanho={16} />
              <span>{c}</span>
              <button type="button" className="icone-botao" aria-label={`Tirar ${c}`} onClick={() => aoMudar(cidades.filter((x) => x !== c))}>
                <Ic nome="fechar" tamanho={16} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="pn-dica-bloco">Nenhuma ainda: o pedido pergunta a cidade pro cliente.</p>
      )}
      <div className={`pn-cidade-nova${falha || erro ? ' pn-campo-erro' : ''}`}>
        <label className="sr-only" htmlFor="e-cidade-nova">
          Cidade nova
        </label>
        <input
          ref={campo}
          id="e-cidade-nova"
          className="pn-input"
          placeholder="Ex.: Niterói"
          autoComplete="off"
          maxLength={60}
          value={nova}
          aria-describedby={falha || erro ? 'e-cidade-erro' : 'e-cidade-dica'}
          onChange={(e) => {
            aoMudarNova(e.target.value)
            setFalha(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              adicionar()
            }
          }}
        />
        <Botao variante="cinza" icone="mais" onClick={adicionar}>
          Adicionar
        </Botao>
      </div>
      {falha || erro ? (
        <p id="e-cidade-erro" className="pn-erro">
          <Ic nome="atencao" tamanho={16} />
          <span>{falha ?? erro}</span>
        </p>
      ) : (
        <p id="e-cidade-dica" className="pn-dica">
          {nova.trim() ? `“${limparCidade(nova)}” entra na lista quando tu salvar.` : 'Escreve e toca em Adicionar (ou só salva: a cidade digitada entra junto).'}
        </p>
      )}
    </div>
  )
}

export function Estado({ uf }: { uf: string }) {
  const leitura = useLoja(0)
  const l = leitura.dados
  const e = l?.estados.find((x) => x.uf === uf) ?? null
  const nome = NOMES_UF[uf] ? nomeUf(uf) : null
  useTitulo(nome ?? 'Estado')
  const chaveRascunho = `estado:${uf}`
  const [f, setF] = useState<Form | null>(null)
  // o que tá no servidor (null = estado novo) e o formulário limpo (o que conta como "não mexeu")
  const antes = useRef<Form | null>(null)
  const limpo = useRef<string | null>(null)
  const [erros, setErros] = useState<Erros>({})
  const [geral, setGeral] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [voltouRascunho, setVoltouRascunho] = useState(false)
  const [confirmacao, setConfirmacao] = useState<PedidoConfirmacao | null>(null)
  const [noSite, setNoSite] = useState<'tirando' | 'pondo' | null>(null)
  const trava = useRef(false)

  // abre o formulário uma vez, quando a loja chega (e o rascunho deste aparelho, se ninguém mudou o estado desde ele)
  useEffect(() => {
    if (f || !l) return
    const base = e ? doEstado(e) : novo(uf)
    antes.current = e ? base : null
    limpo.current = JSON.stringify(base)
    const guardado = lidoJson<{ form: Form; base: string }>(chaveRascunho)
    if (guardado && guardado.base === limpo.current && JSON.stringify(guardado.form) !== limpo.current) {
      setF({ ...base, ...guardado.form, ativo: base.ativo })
      setVoltouRascunho(true)
    } else {
      if (guardado) lembrarJson(chaveRascunho, null)
      setF(base)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [l, e])

  const mexeu = !!f && JSON.stringify(f) !== limpo.current
  // o rascunho no aparelho (some quando volta a ficar igual ao do servidor)
  useEffect(() => {
    if (!f || limpo.current === null) return
    const t = window.setTimeout(() => lembrarJson(chaveRascunho, JSON.stringify(f) === limpo.current ? null : { form: f, base: limpo.current }), 300)
    return () => window.clearTimeout(t)
  }, [f, chaveRascunho])

  const mudar = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF((s) => (s ? { ...s, [k]: v } : s))
    if (erros[k as string]) setErros((x) => ({ ...x, [k]: undefined }))
  }
  const mudarDia = (i: number, d: Partial<Dia>) => {
    setF((s) => (s ? { ...s, semana: s.semana.map((x, j) => (j === i ? { ...x, ...d } : x)) } : s))
    if (erros[`dia-${i}`]) setErros((x) => ({ ...x, [`dia-${i}`]: undefined }))
  }

  // salvar: com ficar (a pergunta de "mudança não salva"), salva e não sai da tela; true = salvou
  const salvar = async (ev?: FormEvent, ficar = false): Promise<boolean> => {
    ev?.preventDefault()
    if (!f || salvando) return false
    // a hora que ficou no meio (Enter sem sair do campo) vai no formato certo; a cidade digitada entra na lista
    const semana = f.semana.map((x) => ({ ...x, abre: normalizarHora(x.abre), fecha: normalizarHora(x.fecha) }))
    let fn: Form = JSON.stringify(semana) === JSON.stringify(f.semana) ? f : { ...f, semana }
    const cidade = limparCidade(f.cidadeNova)
    const n = validar(fn)
    if (cidade) {
      const p = problemaNaCidade(cidade, fn.cidades)
      if (p) n.cidades = p
      else fn = { ...fn, cidades: [...fn.cidades, cidade], cidadeNova: '' }
    }
    if (fn !== f) setF(fn)
    setErros(n)
    setGeral(null)
    const primeiro = Object.keys(n)[0]
    if (primeiro) {
      const id = primeiro.startsWith('dia-') ? `e-abre-${primeiro.slice(4)}` : primeiro === 'gratisDias' ? 'e-gratis-0' : primeiro === 'pagamentos' ? 'e-pag-pix' : primeiro === 'cidades' ? 'e-cidade-nova' : `e-${primeiro}`
      const el = document.getElementById(id)
      el?.focus()
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      return false
    }
    if (trava.current) return false
    trava.current = true
    setSalvando(true)
    try {
      const r = await api.salvarEstado(corpo(fn, uf, antes.current))
      guardarLoja((x) => comEstado(x, r.estado, r))
      leitura.trocar((x) => comEstado(x, r.estado, r))
      lembrarJson(chaveRascunho, null)
      const novoForm = doEstado(r.estado)
      antes.current = novoForm
      limpo.current = JSON.stringify(novoForm)
      setF(novoForm)
      setVoltouRascunho(false)
      recado(e ? `${r.estado.nome}: salvo. O site já mostra.` : `${r.estado.nome} ativado no site. Agora liga os produtos que tem lá (Produtos → ${uf.toUpperCase()}).`)
      if (!ficar) {
        liberar()
        if (e) voltar(caminho.estados)
        else ir(caminho.estados, true)
      }
      return true
    } catch (err) {
      if (err instanceof ErroApi && err.campo) {
        const c = err.campo === 'horario' ? `dia-${Number(err.dados.dia ?? 0)}` : err.campo === 'entregaGratis' ? 'gratisTexto' : err.campo
        // a lista de bairros: o servidor diz qual (o índice na lista que foi)
        const qual = err.campo === 'bairros' && typeof err.dados.indice === 'number' ? fn.bairros[err.dados.indice] : undefined
        const msg = err.codigo === 'proibido' ? (c === 'bairros' && err.dados.lista === 'palavras' ? err.message : 'Tabaco e vape não entram no site (regra da Anvisa pra venda online).') : err.message
        setErros({ [c]: qual && !msg.includes(qual.nome) ? `${qual.nome}: ${msg}` : msg })
        if (c === 'bairros') document.getElementById('e-bairros')?.focus()
      } else setGeral(apiBase.mensagemDe(err))
      return false
    } finally {
      trava.current = false
      setSalvando(false)
    }
  }

  const { liberar } = useAvisarAoSair(mexeu, {
    salvar: () => salvar(undefined, true),
    descartar: () => lembrarJson(chaveRascunho, null),
  })

  /** Tirar do site / pôr de volta: vai sozinho (o resto do formulário continua como tá). */
  const mudarNoSite = async (ativo: boolean): Promise<void> => {
    if (noSite || !nome) return
    setNoSite(ativo ? 'pondo' : 'tirando')
    try {
      const r = await api.salvarEstado({ uf, ativo })
      guardarLoja((x) => comEstado(x, r.estado, r))
      leitura.trocar((x) => comEstado(x, r.estado, r))
      if (antes.current) antes.current = { ...antes.current, ativo }
      const base = limpo.current ? (JSON.parse(limpo.current) as Form) : null
      if (base) limpo.current = JSON.stringify({ ...base, ativo })
      setF((x) => (x ? { ...x, ativo } : x))
      recado(ativo ? `${nome} voltou pro site.` : `${nome} saiu do site: quem é de ${uf.toUpperCase()} vê “ainda não chegou aí”.`, {
        desfazer: { acao: () => mudarNoSite(!ativo).catch(() => {}) },
      })
    } finally {
      setNoSite(null)
    }
  }

  const pedirTirar = () =>
    setConfirmacao({
      titulo: `Tirar ${nome} do site?`,
      texto: (
        <p>
          Quem é de {uf.toUpperCase()} passa a ver “A Green Cheese ainda não chegou aí”, e {nome} some da escolha de estado, do “Por estado” e da faixa dos @. Os dados ficam guardados: dá pra pôr de volta depois.
        </p>
      ),
      botao: `Tirar ${nome} do site`,
      perigo: true,
      acao: () => mudarNoSite(false),
    })

  const titulo = <TituloTela>{nome ?? 'Estado'}</TituloTela>
  if (!nome) {
    return (
      <>
        <Topo voltar={caminho.estados} titulo={titulo} />
        <div className="pn-pagina">
          <Aviso tipo="info">Esse estado não existe.</Aviso>
        </div>
      </>
    )
  }
  if (leitura.erro && !l) {
    return (
      <>
        <Topo voltar={caminho.estados} titulo={titulo} />
        <div className="pn-pagina">
          <Aviso tipo="erro">{leitura.erro.message}</Aviso>
        </div>
      </>
    )
  }
  if (!f || !l) {
    return (
      <>
        <Topo voltar={caminho.estados} titulo={titulo} />
        <Carregando />
      </>
    )
  }
  const mesmo = l.ajustes.mesmoWhatsappParaTodos
  const taxaZero = f.taxaModo === 'valor' && f.taxa.trim() !== '' && lerPreco(f.taxa) === 0
  const minimoLido = f.pedidoMinimo.trim() ? lerPreco(f.pedidoMinimo) : null
  const minimoNoCampo = minimoLido != null && minimoLido > 0 && minimoLido <= 1000 ? minimoLido : null

  return (
    <>
      <Topo voltar={caminho.estados} titulo={titulo} />
      <form className="pn-pagina pn-pagina-estreita pn-editar pn-editar-so" onSubmit={(x) => void salvar(x)} noValidate>
        <div className="pn-editar-form">
          {!e && (
            <Aviso tipo="info">
              {nome} ainda não tá no site. Preenche o Instagram e o pagamento e ativa: o resto pode ficar “a confirmar”.
            </Aviso>
          )}
          {e && !f.ativo && (
            <Aviso
              tipo="info"
              acao={
                <Botao variante="cinza" className="pn-botao-p" ocupado={noSite === 'pondo'} onClick={() => void mudarNoSite(true).catch((err) => recado(apiBase.mensagemDe(err), { tipo: 'erro' }))}>
                  Pôr de volta no site
                </Botao>
              }
            >
              {nome} tá fora do site. Os dados ficam guardados.
            </Aviso>
          )}
          {voltouRascunho && (
            <Aviso
              tipo="info"
              acao={
                <button
                  type="button"
                  className="pn-link-botao"
                  onClick={() => {
                    lembrarJson(chaveRascunho, null)
                    setVoltouRascunho(false)
                    setErros({})
                    setF(limpo.current ? (JSON.parse(limpo.current) as Form) : null)
                  }}
                >
                  Desfazer mudanças
                </button>
              }
            >
              Continuando de onde tu parou (ficou guardado neste aparelho).
            </Aviso>
          )}

          <Secao titulo="Horário de entrega" id="s-e-horario" dica="Fechar depois da meia-noite vale: das 14:00 às 03:00 é até as 3h da madrugada do dia seguinte.">
            {e?.horario.demo && <Aviso tipo="info">Esse horário é de exemplo: o site não mostra até tu salvar o de verdade.</Aviso>}
            <ul className="pn-semana">
              {f.semana.map((x, i) => {
                const erro = erros[`dia-${i}`]
                const nota = madrugada(x, i)
                return (
                  <li key={i} className={`pn-dia-linha${x.aberto ? '' : ' fechado'}${erro ? ' pn-campo-erro' : ''}`}>
                    <label className="pn-troca pn-troca-p pn-dia-nome">
                      <input type="checkbox" checked={x.aberto} onChange={(v) => mudarDia(i, { aberto: v.target.checked })} />
                      <span className="pn-troca-marca" aria-hidden="true" />
                      <span>
                        {/* em 320 o dia vira "Seg" pra hora caber do lado (o leitor de tela lê o nome inteiro) */}
                        <span className="pn-txt-longo">{DIAS[i]}</span>
                        <span className="pn-txt-curto" aria-hidden="true">
                          {DIAS_CURTOS[i][0].toUpperCase() + DIAS_CURTOS[i].slice(1)}
                        </span>
                        <span className="sr-only">: entrega</span>
                      </span>
                    </label>
                    {x.aberto ? (
                      <span className="pn-dia-horas">
                        <Hora id={`e-abre-${i}`} rotulo={`${DIAS[i]}: abre às`} valor={x.abre} aoMudar={(v) => mudarDia(i, { abre: v })} />
                        <span aria-hidden="true">às</span>
                        <Hora rotulo={`${DIAS[i]}: fecha às`} valor={x.fecha} aoMudar={(v) => mudarDia(i, { fecha: v })} />
                      </span>
                    ) : (
                      <span className="pn-dia-fechado">Sem entrega</span>
                    )}
                    {(erro || nota) && (
                      <p className={erro ? 'pn-erro pn-dia-msg' : 'pn-dica pn-dia-msg'}>
                        {erro && <Ic nome="atencao" tamanho={16} />}
                        <span>{erro ?? nota}</span>
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
            <Botao
              variante="cinza"
              icone="copiar"
              onClick={() => {
                const i = [1, 2, 3, 4, 5, 6, 0].find((d) => f.semana[d].aberto)
                if (i == null) return
                const d = f.semana[i]
                mudar('semana', f.semana.map(() => ({ ...d })))
              }}
              disabled={!f.semana.some((x) => x.aberto)}
            >
              Repetir o de {DIAS_CURTOS[[1, 2, 3, 4, 5, 6, 0].find((d) => f.semana[d].aberto) ?? 1]} em todos<span className="pn-txt-longo"> os dias</span>
            </Botao>
          </Secao>

          <Secao titulo="Taxa de entrega" id="s-e-taxa">
            {/* a taxa por bairro (pedido do Ian em 22/10): uma taxa pro estado (o de sempre) ou por bairro */}
            <fieldset className="pn-opcoes">
              <legend className="sr-only">Como cobra a taxa de entrega</legend>
              <label className="pn-opcao">
                <input type="radio" name="taxaPor" checked={f.taxaPor === 'estado'} onChange={() => mudar('taxaPor', 'estado')} />
                <span className="pn-opcao-marca" aria-hidden="true" />
                <span>
                  Uma taxa pro estado
                  <small>a mesma pra todo bairro</small>
                </span>
              </label>
              <label className="pn-opcao">
                <input type="radio" name="taxaPor" checked={f.taxaPor === 'bairro'} onChange={() => mudar('taxaPor', 'bairro')} />
                <span className="pn-opcao-marca" aria-hidden="true" />
                <span>
                  Por bairro
                  <small>cada bairro com a sua (bom pra cidade grande)</small>
                </span>
              </label>
            </fieldset>
            {f.taxaPor === 'estado' ? (
              <>
                {e?.taxaEntrega.demo && <Aviso tipo="info">Essa taxa é de exemplo: o site mostra “a confirmar” até tu salvar a de verdade.</Aviso>}
                <fieldset className="pn-opcoes">
                  <legend className="sr-only">Taxa de entrega</legend>
                  <label className="pn-opcao">
                    <input type="radio" name="taxaModo" checked={f.taxaModo === 'confirmar'} onChange={() => mudar('taxaModo', 'confirmar')} />
                    <span className="pn-opcao-marca" aria-hidden="true" />
                    <span>
                      A confirmar
                      <small>a loja passa no WhatsApp</small>
                    </span>
                  </label>
                  <label className="pn-opcao">
                    <input type="radio" name="taxaModo" checked={f.taxaModo === 'valor'} onChange={() => mudar('taxaModo', 'valor')} />
                    <span className="pn-opcao-marca" aria-hidden="true" />
                    <span>Um valor fixo</span>
                  </label>
                </fieldset>
                {f.taxaModo === 'valor' && (
                  <Campo id="e-taxa" rotulo="Taxa" erro={erros.taxa}>
                    {(a) => (
                      <div className="pn-reais">
                        <span aria-hidden="true">R$</span>
                        <input {...a} name="taxa" className="pn-input" inputMode="decimal" autoComplete="off" placeholder="10,00" value={f.taxa} onChange={(x) => mudar('taxa', x.target.value.replace(/[^\d,.]/g, '').slice(0, 10))} />
                      </div>
                    )}
                  </Campo>
                )}
                {taxaZero && !erros.taxa && (
                  <Aviso
                    tipo="info"
                    acao={
                      <Botao
                        variante="cinza"
                        className="pn-botao-p"
                        onClick={() => {
                          setF((s) => (s ? { ...s, taxaModo: 'confirmar', taxa: '', gratis: true } : s))
                          window.requestAnimationFrame(() => document.getElementById('e-gratis-0')?.focus())
                        }}
                      >
                        Ligar entrega grátis
                      </Botao>
                    }
                  >
                    Taxa R$ 0? Liga a “Entrega grátis” nos dias que valem: nesses dias o site mostra a frase do dia.
                  </Aviso>
                )}
              </>
            ) : (
              <>
                <p id="e-bairros-ver-rot" className="pn-rotulo pn-rotulo-espaco">
                  Como o cliente vê
                </p>
                <fieldset className="pn-opcoes" aria-labelledby="e-bairros-ver-rot">
                  <label className="pn-opcao">
                    <input type="radio" name="bairrosVer" checked={f.bairrosVer === 'site'} onChange={() => mudar('bairrosVer', 'site')} />
                    <span className="pn-opcao-marca" aria-hidden="true" />
                    <span>
                      Aparece no site
                      <small>o cliente acha a taxa do bairro dele (no atendimento e na sacola)</small>
                    </span>
                  </label>
                  <label className="pn-opcao">
                    <input type="radio" name="bairrosVer" checked={f.bairrosVer === 'consulta'} onChange={() => mudar('bairrosVer', 'consulta')} />
                    <span className="pn-opcao-marca" aria-hidden="true" />
                    <span>
                      O cliente consulta
                      <small>o site diz “a taxa depende do bairro” e o botão abre o WhatsApp com a pergunta pronta</small>
                    </span>
                  </label>
                </fieldset>
                <Bairros
                  bairros={f.bairros}
                  cidades={f.cidades}
                  ver={f.bairrosVer}
                  erro={erros.bairros}
                  aoMudar={(b) => {
                    mudar('bairros', b)
                    if (erros.bairros) setErros((x) => ({ ...x, bairros: undefined }))
                  }}
                />
              </>
            )}
          </Secao>

          <Secao titulo="Pedido mínimo pra entrega" id="s-e-minimo" dica="Vazio = sem mínimo. A conta é sobre os produtos da sacola (com os combos), antes da taxa de entrega e do desconto do cupom.">
            <Campo
              id="e-pedidoMinimo"
              rotulo="Valor mínimo"
              erro={erros.pedidoMinimo}
              lado={<span className="pn-opcional">opcional</span>}
              dica={
                minimoNoCampo != null
                  ? `No site, o “Fechar pedido no WhatsApp” fica travado até a sacola chegar em ${brl(minimoNoCampo)}, dizendo quanto falta.`
                  : 'Sem mínimo: qualquer pedido fecha.'
              }
            >
              {(a) => (
                <div className="pn-reais">
                  <span aria-hidden="true">R$</span>
                  <input
                    {...a}
                    name="pedidoMinimo"
                    className="pn-input"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="20,00"
                    value={f.pedidoMinimo}
                    onChange={(x) => mudar('pedidoMinimo', x.target.value.replace(/[^\d,.]/g, '').slice(0, 10))}
                  />
                </div>
              )}
            </Campo>
          </Secao>

          <Secao titulo="Entrega grátis" id="s-e-gratis">
            <label className="pn-troca">
              <input id="e-gratis" type="checkbox" checked={f.gratis} onChange={(x) => mudar('gratis', x.target.checked)} />
              <span className="pn-troca-marca" aria-hidden="true" />
              <span>Tem dia com entrega grátis</span>
            </label>
            {f.gratis && (
              <>
                <div className={`pn-campo${erros.gratisDias ? ' pn-campo-erro' : ''}`}>
                  <p id="e-gratis-rot" className="pn-rotulo">
                    Em que dia
                  </p>
                  <div className="pn-dias" role="group" aria-labelledby="e-gratis-rot" aria-describedby={erros.gratisDias ? 'e-gratis-erro' : undefined}>
                    {DIAS_CURTOS.map((d, i) => {
                      const on = f.gratisDias.includes(i)
                      return (
                        <button key={d} id={`e-gratis-${i}`} type="button" className={`pn-chip-uf${on ? ' on' : ''}`} aria-pressed={on} aria-label={DIAS[i]} onClick={() => mudar('gratisDias', on ? f.gratisDias.filter((x) => x !== i) : [...f.gratisDias, i])}>
                          {d}
                        </button>
                      )
                    })}
                  </div>
                  {erros.gratisDias && (
                    <p id="e-gratis-erro" className="pn-erro">
                      <Ic nome="atencao" tamanho={16} />
                      <span>{erros.gratisDias}</span>
                    </p>
                  )}
                </div>
                <Campo id="e-gratisTexto" rotulo="Frase do dia" erro={erros.gratisTexto} dica="Aparece no perfil e no story do Início nesse dia." lado={<span className="pn-contagem">{tamanho(f.gratisTexto)}/40</span>}>
                  {(a) => <input {...a} name="gratisTexto" className="pn-input" autoComplete="off" maxLength={40} value={f.gratisTexto} onChange={(x) => mudar('gratisTexto', x.target.value)} />}
                </Campo>
              </>
            )}
          </Secao>

          <Secao titulo="Pagamento" id="s-e-pag">
            <div className={`pn-campo${erros.pagamentos ? ' pn-campo-erro' : ''}`}>
              <div className="pn-pagamentos" role="group" aria-label="Formas de pagamento" aria-describedby={erros.pagamentos ? 'e-pag-erro' : undefined}>
                {PAGAMENTOS.map((x) => {
                  const on = f.pagamentos.includes(x.id)
                  return (
                    <label key={x.id} className="pn-marcar">
                      <input id={`e-pag-${x.id}`} type="checkbox" checked={on} onChange={() => mudar('pagamentos', on ? f.pagamentos.filter((y) => y !== x.id) : PAGAMENTOS.map((y) => y.id).filter((y) => y === x.id || f.pagamentos.includes(y)))} />
                      <span className="pn-marcar-caixa" aria-hidden="true">
                        {on && <Ic nome="check" tamanho={16} />}
                      </span>
                      <span>{x.nome}</span>
                    </label>
                  )
                })}
              </div>
              {erros.pagamentos && (
                <p id="e-pag-erro" className="pn-erro">
                  <Ic nome="atencao" tamanho={16} />
                  <span>{erros.pagamentos}</span>
                </p>
              )}
            </div>
          </Secao>

          <Secao titulo="Cidades" id="s-e-cidades" dica="Com mais de uma, o site pergunta a cidade.">
            <Cidades
              cidades={f.cidades}
              nova={f.cidadeNova}
              aoMudarNova={(v) => {
                mudar('cidadeNova', v)
                if (erros.cidades) setErros((x) => ({ ...x, cidades: undefined }))
              }}
              aoMudar={(c) => {
                mudar('cidades', c)
                if (erros.cidades) setErros((x) => ({ ...x, cidades: undefined }))
              }}
              erro={erros.cidades}
            />
          </Secao>

          <Secao titulo="WhatsApp do pedido" id="s-e-whats">
            {mesmo && (
              <Aviso tipo="info">
                Hoje todos os estados fecham no WhatsApp da loja, {whatsappBonito(l.ajustes.whatsapp)}. O número daqui fica guardado e vale quando tu desligar “o mesmo pra todos” nos{' '}
                <Link href={caminho.loja} className="pn-link pn-link-dentro">
                  Ajustes da loja
                </Link>
                .
              </Aviso>
            )}
            <fieldset className="pn-opcoes">
              <legend className="sr-only">WhatsApp do pedido</legend>
              <label className="pn-opcao">
                <input type="radio" name="whatsModo" checked={f.whatsModo === 'loja'} onChange={() => mudar('whatsModo', 'loja')} />
                <span className="pn-opcao-marca" aria-hidden="true" />
                <span>
                  O da loja
                  <small>{whatsappBonito(l.ajustes.whatsapp)}</small>
                </span>
              </label>
              <label className="pn-opcao">
                <input type="radio" name="whatsModo" checked={f.whatsModo === 'proprio'} onChange={() => mudar('whatsModo', 'proprio')} />
                <span className="pn-opcao-marca" aria-hidden="true" />
                <span>
                  Um próprio pra {nome}
                  <small>o pedido daqui fecha nele</small>
                </span>
              </label>
            </fieldset>
            {f.whatsModo === 'proprio' && (
              <Campo id="e-whatsapp" rotulo={`WhatsApp de ${nome}`} erro={erros.whatsapp} dica="Celular com DDD (ex.: 21 99999-8888).">
                {(a) => <input {...a} name="whatsapp" className="pn-input" type="tel" inputMode="tel" autoComplete="off" placeholder="(21) 99999-8888" value={f.whatsapp} onChange={(x) => mudar('whatsapp', x.target.value)} />}
              </Campo>
            )}
          </Secao>

          <Secao titulo="Perfil" id="s-e-perfil">
            <Campo id="e-instagram" rotulo="Instagram do estado" erro={erros.instagram} dica="As dúvidas e o “Avisar quando chegar” vão pra DM dele.">
              {(a) => (
                <div className="pn-arroba">
                  <span aria-hidden="true">@</span>
                  <input {...a} name="instagram" className="pn-input" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="greencheese_imports" value={f.instagram} onChange={(x) => mudar('instagram', x.target.value)} />
                </div>
              )}
            </Campo>
            <Campo id="e-nomePerfil" rotulo="Nome do perfil" erro={erros.nomePerfil} dica="O nome que aparece no perfil do Instagram (vazio: só o @)." lado={<span className="pn-opcional">opcional</span>}>
              {(a) => <input {...a} name="nomePerfil" className="pn-input" autoComplete="off" maxLength={40} placeholder="GREEN CHEESE LTDA" value={f.nomePerfil} onChange={(x) => mudar('nomePerfil', x.target.value)} />}
            </Campo>
            <Campo
              id="e-destaque"
              rotulo="Nome do destaque"
              erro={erros.destaque}
              dica={
                cabeNaBolinha(f.destaque)
                  ? 'A bolinha do estado nos destaques do Início (abre o atendimento).'
                  : 'No celular, esse nome passa da bolinha e o fim vira “…” (como no Instagram). Umas 11 letras cabem inteiras (ex.: DELIVERY RJ).'
              }
              lado={<span className="pn-contagem">{tamanho(f.destaque)}/20</span>}
            >
              {(a) => <input {...a} name="destaque" className="pn-input" autoComplete="off" maxLength={20} value={f.destaque} onChange={(x) => mudar('destaque', x.target.value)} />}
            </Campo>
          </Secao>

          {e && f.ativo && (
            <section className="pn-form-secao pn-perigo-zona" aria-labelledby="s-e-tirar">
              <h2 id="s-e-tirar" className="pn-h2">
                Tirar do site
              </h2>
              <p className="pn-dica-bloco">O estado some do site e quem é de lá vê “ainda não chegou aí”. Os dados ficam guardados pra pôr de volta.</p>
              <Botao variante="perigo" icone="atencao" ocupado={noSite === 'tirando'} onClick={pedirTirar}>
                Tirar {nome} do site
              </Botao>
            </section>
          )}
        </div>

        <div className="pn-editar-pe">
          {geral && <Aviso tipo="erro">{geral}</Aviso>}
          <Botao type="submit" largo ocupado={salvando} disabled={!!e && !mexeu}>
            {e ? 'Salvar' : `Ativar ${nome}`}
          </Botao>
        </div>
      </form>
      <Confirmar pedido={confirmacao} aoFechar={() => setConfirmacao(null)} />
    </>
  )
}
