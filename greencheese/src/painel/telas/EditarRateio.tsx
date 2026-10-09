// Criar e editar rateio, no molde do "Novo post" do Instagram: produto do catálogo (preenche o nome e usa a arte)
// ou nome livre, foto do celular com prévia, preços (com a economia), vagas, estados, prazos e a prévia do cartão
// como o cliente vê. Salva rascunho ou publica. O que está sendo digitado fica guardado no aparelho até salvar.
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import * as api from '../api'
import { ErroApi } from '../api'
import { ArteRateio, urlImagem } from '../Arte'
import { buscarProdutos, nomeDaCategoria, produtoDoCatalogo, tituloSugerido } from '../catalogo'
import { doCache, guardar } from '../dados'
import { brl, isoParaLocal, lerReais, reaisNoCampo } from '../formato'
import { prepararFoto } from '../imagem'
import { lembrarJson, lidoJson } from '../lembrar'
import { Topo } from '../Moldura'
import { AVISO_PROIBIDO, termoProibido } from '../proibidos'
import { PreviaCartao } from '../rateio-ui'
import { caminho, ir } from '../rotas'
import type { RateioAdmin, RateioCorpo } from '../tipos'
import { Aviso, Botao, Campo, Carregando, Ic, Numero, Pontinhos, TituloTela } from '../ui'
import { avisarNaProxima } from './flash'
import { useTitulo } from './comum'

const UFS: { uf: string; nome: string }[] = [
  { uf: 'rj', nome: 'Rio de Janeiro' },
  { uf: 'mg', nome: 'Minas Gerais' },
  { uf: 'sp', nome: 'São Paulo' },
  { uf: 'es', nome: 'Espírito Santo' },
  { uf: 'sc', nome: 'Santa Catarina' },
]

interface Form {
  produtoId: string | null
  titulo: string
  /** O título veio do produto (trocar de produto troca o título junto). */
  tituloAuto: boolean
  imagem: string | null
  descricao: string
  precoRateio: string
  precoDepois: string
  vagas: string
  limite: string
  ufs: string[]
  previsaoMin: string
  previsaoMax: string
  temPrazo: boolean
  fechaEm: string
  reservaHoras: string
}

type Erros = Partial<Record<string, string>>

const NOVO: Form = {
  produtoId: null,
  titulo: '',
  tituloAuto: false,
  imagem: null,
  descricao: '',
  precoRateio: '',
  precoDepois: '',
  vagas: '10',
  limite: '1',
  ufs: UFS.map((u) => u.uf),
  previsaoMin: '6',
  previsaoMax: '10',
  temPrazo: false,
  fechaEm: '',
  reservaHoras: '24',
}

function doRateio(r: RateioAdmin): Form {
  const p = r.produtoId ? produtoDoCatalogo(r.produtoId) : undefined
  return {
    produtoId: r.produtoId,
    titulo: r.titulo,
    tituloAuto: !!p && tituloSugerido(p) === r.titulo,
    imagem: r.imagem,
    descricao: r.descricao,
    precoRateio: reaisNoCampo(r.precoRateio),
    precoDepois: reaisNoCampo(r.precoDepois),
    vagas: String(r.vagas),
    limite: String(r.limitePorPessoa),
    ufs: r.ufs,
    previsaoMin: String(r.previsaoMin),
    previsaoMax: String(r.previsaoMax),
    temPrazo: !!r.fechaEm,
    fechaEm: isoParaLocal(r.fechaEm),
    reservaHoras: String(r.reservaHoras),
  }
}

const inteiro = (s: string): number | null => (/^\d{1,4}$/.test(s.trim()) ? Number(s.trim()) : null)

function validar(f: Form, r: RateioAdmin | null): Erros {
  const e: Erros = {}
  const t = f.titulo.trim()
  if (t.length < 3) e.titulo = 'Dá um nome com 3 letras ou mais.'
  else if (t.length > 80) e.titulo = 'Nome até 80 letras.'
  else if (termoProibido(t)) e.titulo = AVISO_PROIBIDO
  if (f.descricao.length > 400) e.descricao = 'Descrição até 400 letras.'
  else if (termoProibido(f.descricao)) e.descricao = AVISO_PROIBIDO
  const preco = lerReais(f.precoRateio)
  // o servidor aceita de R$ 0,01 a R$ 100.000,00
  if (preco == null || preco <= 0) e.precoRateio = 'Põe o preço da vaga (ex.: 14,90).'
  else if (preco > 100000) e.precoRateio = 'Até R$ 100.000,00 a vaga.'
  if (f.precoDepois.trim()) {
    const d = lerReais(f.precoDepois)
    if (d == null) e.precoDepois = 'Preço inválido (ex.: 19,90), ou deixa vazio.'
    else if (d > 100000) e.precoDepois = 'Até R$ 100.000,00 (ou deixa vazio).'
    else if (preco != null && d <= preco) e.precoDepois = 'Tem que ser mais que o preço no rateio (senão não compensa entrar).'
  }
  const v = inteiro(f.vagas)
  const ocupadas = r ? r.confirmadas + r.reservadas : 0
  if (v == null || v < 1 || v > 1000) e.vagas = 'Vagas de 1 a 1000.'
  else if (v < ocupadas) e.vagas = `Já tem ${ocupadas} ocupadas: não dá pra deixar menos.`
  const l = inteiro(f.limite)
  if (l == null || l < 1) e.limite = 'Pelo menos 1 por pessoa.'
  else if (v != null && l > v) e.limite = 'Não pode passar do número de vagas.'
  if (!f.ufs.length) e.ufs = 'Escolhe pelo menos um estado.'
  const a = inteiro(f.previsaoMin)
  const b = inteiro(f.previsaoMax)
  if (a == null || a < 1 || a > 90) e.previsaoMin = 'De 1 a 90 dias.'
  if (b == null || b < 1 || b > 120) e.previsaoMax = 'Até 120 dias.'
  else if (a != null && b < a) e.previsaoMax = 'Tem que ser igual ou maior que o primeiro.'
  if (f.temPrazo) {
    const t2 = f.fechaEm ? Date.parse(`${f.fechaEm}:00-03:00`) : NaN
    const mudou = !r || isoParaLocal(r.fechaEm) !== f.fechaEm
    if (!Number.isFinite(t2)) e.fechaEm = 'Escolhe o dia e a hora.'
    else if (mudou && t2 <= api.agora()) e.fechaEm = 'Essa data já passou.'
  }
  const h = inteiro(f.reservaHoras)
  if (h == null || h < 1 || h > 168) e.reservaHoras = 'De 1 a 168 horas (7 dias).'
  return e
}

function corpo(f: Form, id: string | null, status?: 'rascunho' | 'aberto'): RateioCorpo {
  return {
    ...(id ? { id } : {}),
    titulo: f.titulo.trim(),
    descricao: f.descricao.trim(),
    produtoId: f.produtoId,
    imagem: f.imagem,
    precoRateio: lerReais(f.precoRateio) ?? 0,
    precoDepois: f.precoDepois.trim() ? lerReais(f.precoDepois) : null,
    vagas: inteiro(f.vagas) ?? 0,
    limitePorPessoa: inteiro(f.limite) ?? 1,
    ufs: f.ufs,
    previsaoMin: inteiro(f.previsaoMin) ?? 6,
    previsaoMax: inteiro(f.previsaoMax) ?? 10,
    // sem fuso = horário de Brasília (API.md)
    fechaEm: f.temPrazo && f.fechaEm ? f.fechaEm : null,
    reservaHoras: inteiro(f.reservaHoras) ?? 24,
    ...(status && !id ? { status } : {}),
  }
}

function Reais({ aria, valor, aoMudar, name, placeholder }: { aria: { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string }; valor: string; aoMudar: (v: string) => void; name: string; placeholder?: string }) {
  return (
    <div className="pn-reais">
      <span aria-hidden="true">R$</span>
      <input {...aria} name={name} className="pn-input" inputMode="decimal" autoComplete="off" placeholder={placeholder} value={valor} onChange={(e) => aoMudar(e.target.value.replace(/[^\d,.]/g, '').slice(0, 10))} onBlur={() => {
        const n = lerReais(valor)
        if (n != null) aoMudar(reaisNoCampo(n))
      }} />
    </div>
  )
}

/** Escolha do produto: busca no catálogo (preenche o nome e usa a arte) ou nome livre. */
function EscolhaProduto({ produtoId, aoEscolher }: { produtoId: string | null; aoEscolher: (id: string | null) => void }) {
  const [busca, setBusca] = useState('')
  const [abrindo, setAbrindo] = useState(!produtoId)
  const [todos, setTodos] = useState(false)
  const idLista = useId()
  const p = produtoId ? produtoDoCatalogo(produtoId) : undefined
  const todosOsProdutos = useMemo(() => buscarProdutos(''), [])
  // sem busca, os 6 primeiros (o resto num toque); com busca, até 8
  const achados = useMemo(() => (busca ? buscarProdutos(busca).slice(0, 8) : todos ? todosOsProdutos : todosOsProdutos.slice(0, 6)), [busca, todos, todosOsProdutos])
  if (p && !abrindo) {
    return (
      <div className="pn-produto-escolhido">
        <ArteRateio produtoId={p.id} imagem={null} largura={48} />
        <span className="pn-produto-txt">
          <strong>{tituloSugerido(p)}</strong>
          <span>
            {nomeDaCategoria(p.categoria)} · {p.preco != null ? `${brl(p.preco)} na loja` : 'preço na loja: consultar'}
          </span>
        </span>
        <button type="button" className="pn-botao pn-botao-cinza pn-botao-p" onClick={() => setAbrindo(true)}>
          <span className="pn-botao-txt">Trocar</span>
        </button>
      </div>
    )
  }
  return (
    <div className="pn-produto-busca">
      <div className="pn-busca">
        <Ic nome="lupa" tamanho={16} />
        <input
          id="r-produto"
          name="produtoId"
          type="search"
          className="pn-input"
          placeholder="Busca: Arizona, dichavador…"
          aria-label="Buscar produto do catálogo"
          aria-controls={idLista}
          autoComplete="off"
          enterKeyHint="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.preventDefault()
          }}
        />
      </div>
      <ul id={idLista} className="pn-produtos" aria-label="Produtos do catálogo">
        {achados.map((x) => (
          <li key={x.id}>
            <button
              type="button"
              className={`pn-produto toque${x.id === produtoId ? ' escolhido' : ''}`}
              aria-pressed={x.id === produtoId}
              onClick={() => {
                aoEscolher(x.id)
                setAbrindo(false)
                setBusca('')
              }}
            >
              <ArteRateio produtoId={x.id} imagem={null} largura={32} halo={false} />
              <span className="pn-produto-txt">
                <strong>{tituloSugerido(x)}</strong>
                <span>{nomeDaCategoria(x.categoria)}</span>
              </span>
              {x.preco != null && <span className="pn-produto-preco">{brl(x.preco)}</span>}
            </button>
          </li>
        ))}
        {achados.length === 0 && <li className="pn-produtos-nada">Nada com “{busca}” no catálogo. Usa o nome livre aqui embaixo.</li>}
      </ul>
      {!busca && !todos && todosOsProdutos.length > achados.length && (
        <button type="button" className="pn-botao pn-botao-texto pn-produtos-todos" onClick={() => setTodos(true)}>
          <span className="pn-botao-txt">Ver o catálogo inteiro ({todosOsProdutos.length})</span>
        </button>
      )}
      <div className="pn-produto-livre">
        {produtoId && (
          <button type="button" className="pn-link-botao" onClick={() => setAbrindo(false)}>
            Manter {p ? tituloSugerido(p) : 'o produto'}
          </button>
        )}
        <button
          type="button"
          className="pn-link-botao"
          onClick={() => {
            aoEscolher(null)
            setAbrindo(false)
            setBusca('')
            requestAnimationFrame(() => document.getElementById('r-titulo')?.focus())
          }}
        >
          Não tá no catálogo: nome livre
        </button>
      </div>
    </div>
  )
}

/** Foto do celular (ou do computador), com prévia e andamento do envio. */
function EnvioFoto({ imagem, aoMudar, erro, temProduto, aria }: { imagem: string | null; aoMudar: (img: string | null) => void; erro?: string; temProduto: boolean; aria: { 'aria-describedby'?: string } }) {
  const [local, setLocal] = useState<string | null>(null)
  const [andamento, setAndamento] = useState<number | null>(null)
  const [falha, setFalha] = useState<string | null>(null)
  const entrada = useRef<HTMLInputElement>(null)
  useEffect(() => () => {
    if (local) URL.revokeObjectURL(local)
  }, [local])

  const escolher = async (f: File | undefined) => {
    if (!f || andamento !== null) return
    setFalha(null)
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) {
      setFalha('Manda foto em JPG, PNG ou WebP.')
      return
    }
    const url = URL.createObjectURL(f)
    setLocal(url)
    setAndamento(0)
    try {
      const pronta = await prepararFoto(f)
      const r = await api.enviarImagem(pronta.blob, pronta.nome, (x) => setAndamento(x))
      aoMudar(r.imagem)
      setLocal(null)
    } catch (e) {
      setFalha(api.mensagemDe(e))
      setLocal(null)
    } finally {
      setAndamento(null)
      if (entrada.current) entrada.current.value = ''
    }
  }

  const mostrar = local ?? (imagem ? urlImagem(imagem) : null)
  return (
    <div className="pn-foto">
      {mostrar ? (
        <div className="pn-foto-previa">
          <img src={mostrar} alt="Foto do rateio" />
          {andamento !== null && (
            <div className="pn-foto-andamento" role="status">
              <Pontinhos rotulo="Subindo a foto…" />
              <span className="pn-foto-barra" aria-hidden="true">
                <i style={{ transform: `scaleX(${andamento})` }} />
              </span>
              <span>Subindo {Math.round(andamento * 100)}%</span>
            </div>
          )}
        </div>
      ) : (
        <div className="pn-foto-vazia">
          <Ic nome="camera" tamanho={32} />
          <span>{temProduto ? 'Sem foto, o site usa a arte do produto.' : 'Sem foto, o site mostra a caixa de importação.'}</span>
        </div>
      )}
      <div className="pn-foto-acoes">
        <label className={`pn-botao pn-botao-cinza${andamento !== null ? ' pn-ocupado' : ''}`}>
          <Ic nome="camera" tamanho={16} />
          <span className="pn-botao-txt">{imagem ? 'Trocar foto' : 'Enviar foto'}</span>
          <input
            {...aria}
            ref={entrada}
            id="r-imagem"
            name="imagem"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            disabled={andamento !== null}
            onChange={(e) => void escolher(e.target.files?.[0])}
          />
        </label>
        {imagem && andamento === null && (
          <button type="button" className="pn-botao pn-botao-texto" onClick={() => aoMudar(null)}>
            <span className="pn-botao-txt">Tirar foto</span>
          </button>
        )}
      </div>
      {(falha || erro) && <Aviso tipo="erro">{falha ?? erro}</Aviso>}
    </div>
  )
}

function Secao({ titulo, children, id }: { titulo: string; children: ReactNode; id: string }) {
  return (
    <section className="pn-form-secao" aria-labelledby={id}>
      <h2 id={id} className="pn-h2">
        {titulo}
      </h2>
      {children}
    </section>
  )
}

export function EditarRateio({ id, produtoInicial }: { id: string | null; produtoInicial?: string | null }) {
  useTitulo(id ? 'Editar rateio' : 'Novo rateio')
  const chaveRascunho = `rascunho:${id ?? 'novo'}`
  const [rateio, setRateio] = useState<RateioAdmin | null>(() => (id ? (doCache<{ rateio: RateioAdmin }>(`participantes:${id}`)?.rateio ?? null) : null))
  const [erroCarga, setErroCarga] = useState<string | null>(null)
  const [f, setF] = useState<Form | null>(null)
  const [voltouRascunho, setVoltouRascunho] = useState(false)
  const [erros, setErros] = useState<Erros>({})
  const [geral, setGeral] = useState<string | null>(null)
  const [salvando, setSalvando] = useState<'rascunho' | 'aberto' | 'salvar' | null>(null)
  // trava síncrona: o estado só muda no próximo desenho, e um toque duplo passaria pelos dois
  const trava = useRef(false)
  const form = useRef<HTMLFormElement>(null)
  // o formulário como abriu: rascunho só existe quando alguém mudou alguma coisa
  const inicial = useRef<string | null>(null)

  // carrega o rateio (edição) e o rascunho guardado neste aparelho
  useEffect(() => {
    let vivo = true
    const iniciar = (r: RateioAdmin | null) => {
      const p = produtoInicial ? produtoDoCatalogo(produtoInicial) : undefined
      const limpo: Form = r ? doRateio(r) : p ? { ...NOVO, produtoId: p.id, titulo: tituloSugerido(p), tituloAuto: true, precoDepois: reaisNoCampo(p.preco) } : NOVO
      inicial.current = JSON.stringify(limpo)
      const guardado = lidoJson<{ form: Form; base: string | null }>(chaveRascunho)
      if (guardado && guardado.base === (r?.atualizadoEm ?? null) && JSON.stringify({ ...NOVO, ...guardado.form }) !== inicial.current) {
        setF({ ...NOVO, ...guardado.form })
        setVoltouRascunho(true)
      } else {
        if (guardado) lembrarJson(chaveRascunho, null)
        setF(limpo)
      }
    }
    if (!id) {
      iniciar(null)
      return
    }
    api.rateio(id).then(
      (x) => {
        if (!vivo) return
        setRateio(x.rateio)
        iniciar(x.rateio)
      },
      (e) => vivo && setErroCarga(api.mensagemDe(e)),
    )
    return () => {
      vivo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // guarda o que está sendo digitado (sessão caiu, aba fechou, bateria acabou: volta daqui)
  useEffect(() => {
    if (!f) return
    const t = window.setTimeout(() => lembrarJson(chaveRascunho, JSON.stringify(f) === inicial.current ? null : { form: f, base: rateio?.atualizadoEm ?? null }), 300)
    return () => window.clearTimeout(t)
  }, [f, chaveRascunho, rateio?.atualizadoEm])

  const mudar = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF((s) => (s ? { ...s, [k]: v, ...(k === 'titulo' ? { tituloAuto: false } : {}) } : s))
    const campo = k === 'limite' ? 'limite' : k
    if (erros[campo]) setErros((e) => ({ ...e, [campo]: undefined }))
  }

  const escolherProduto = (pid: string | null) => {
    setF((s) => {
      if (!s) return s
      const p = pid ? produtoDoCatalogo(pid) : undefined
      const titulo = p && (s.tituloAuto || !s.titulo.trim()) ? tituloSugerido(p) : !p && s.tituloAuto ? '' : s.titulo
      const precoDepois = p && !s.precoDepois.trim() && p.preco != null ? reaisNoCampo(p.preco) : s.precoDepois
      return { ...s, produtoId: pid, titulo, tituloAuto: !!p && titulo === tituloSugerido(p), precoDepois }
    })
    setErros((e) => ({ ...e, titulo: undefined, produtoId: undefined }))
  }

  const descartar = () => {
    lembrarJson(chaveRascunho, null)
    setVoltouRascunho(false)
    setErros({})
    const limpo = rateio ? doRateio(rateio) : NOVO
    inicial.current = JSON.stringify(limpo)
    setF(limpo)
  }

  const salvar = async (modo: 'rascunho' | 'aberto' | 'salvar', e?: FormEvent) => {
    e?.preventDefault()
    if (!f || salvando) return
    const novos = validar(f, rateio)
    setErros(novos)
    setGeral(null)
    const primeiro = Object.keys(novos).find((k) => novos[k])
    if (primeiro) {
      focar(primeiro)
      return
    }
    if (trava.current) return
    trava.current = true
    setSalvando(modo)
    try {
      let r = (await api.salvarRateio(corpo(f, rateio?.id ?? null, modo === 'salvar' ? undefined : modo))).rateio
      // rascunho que já existia e foi publicado agora: salva e abre
      if (rateio && rateio.status === 'rascunho' && modo === 'aberto') r = (await api.statusRateio(r.id, 'aberto')).rateio
      lembrarJson(chaveRascunho, null)
      guardar(`participantes:${r.id}`, { rateio: r, participantes: doCache<{ participantes: unknown[] }>(`participantes:${r.id}`)?.participantes ?? [] })
      avisarNaProxima(
        modo === 'aberto' ? (rateio?.status === 'aberto' ? 'Mudanças salvas. Já tão no site.' : 'Publicado! Já tá na aba Rateio do site. Copia o link e manda no story.') : modo === 'rascunho' ? 'Rascunho salvo. Só tu vê; publica quando quiser.' : 'Mudanças salvas.',
      )
      ir(caminho.rateio(r.id), true)
    } catch (err) {
      if (err instanceof ErroApi && err.campo) {
        const c = err.campo === 'limitePorPessoa' ? 'limite' : err.campo
        const msg = err.codigo === 'proibido' ? AVISO_PROIBIDO : err.message
        setErros({ [c]: msg })
        focar(c)
      } else setGeral(api.mensagemDe(err))
    } finally {
      trava.current = false
      setSalvando(null)
    }
  }

  const focar = (campo: string) => {
    const mapa: Record<string, string> = { produtoId: 'r-produto', limite: 'r-limite', ufs: 'r-uf-rj', fechaEm: 'r-fechaEm', imagem: 'r-imagem' }
    const el = document.getElementById(mapa[campo] ?? `r-${campo}`)
    el?.focus()
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  const voltarPara = id ? caminho.rateio(id) : caminho.rateios
  if (erroCarga) {
    return (
      <>
        <Topo voltar={voltarPara} titulo={<TituloTela>Editar rateio</TituloTela>} />
        <div className="pn-pagina">
          <Aviso tipo="erro">{erroCarga}</Aviso>
        </div>
      </>
    )
  }
  if (!f) {
    return (
      <>
        <Topo voltar={voltarPara} titulo={<TituloTela>{id ? 'Editar rateio' : 'Novo rateio'}</TituloTela>} />
        <Carregando />
      </>
    )
  }
  if (rateio && ['encerrado', 'cancelado'].includes(rateio.status)) {
    return (
      <>
        <Topo voltar={voltarPara} titulo={<TituloTela>Editar rateio</TituloTela>} />
        <div className="pn-pagina">
          <Aviso tipo="info">Rateio {rateio.status} não edita mais.</Aviso>
        </div>
      </>
    )
  }

  const preco = lerReais(f.precoRateio)
  const depois = lerReais(f.precoDepois)
  const eco = preco != null && depois != null && depois > preco ? depois - preco : null
  const ocupadas = rateio ? rateio.confirmadas + rateio.reservadas : 0
  const tabacoTitulo = termoProibido(f.titulo)
  const tabacoDesc = termoProibido(f.descricao)
  const publicado = !!rateio && rateio.status !== 'rascunho'
  const previa = {
    titulo: f.titulo.trim(),
    produtoId: f.produtoId,
    imagem: f.imagem,
    precoRateio: preco ?? 0,
    precoDepois: depois,
    vagas: inteiro(f.vagas) ?? 0,
    confirmadas: rateio?.confirmadas ?? 0,
    reservadas: rateio?.reservadas ?? 0,
    disponiveis: Math.max(0, (inteiro(f.vagas) ?? 0) - ocupadas),
    ufs: f.ufs,
    previsaoMin: inteiro(f.previsaoMin) ?? 6,
    previsaoMax: inteiro(f.previsaoMax) ?? 10,
    fechaEm: f.temPrazo && f.fechaEm ? new Date(Date.parse(`${f.fechaEm}:00-03:00`)).toISOString() : null,
    status: rateio?.status ?? ('rascunho' as const),
    descricao: f.descricao.trim(),
  }

  return (
    <>
      <Topo voltar={voltarPara} titulo={<TituloTela>{id ? 'Editar rateio' : 'Novo rateio'}</TituloTela>} />
      <form ref={form} className="pn-pagina pn-editar" onSubmit={(e) => void salvar(publicado ? 'salvar' : 'aberto', e)} noValidate>
        <div className="pn-editar-form">
          {voltouRascunho && (
            <Aviso
              tipo="info"
              acao={
                <button type="button" className="pn-link-botao" onClick={descartar}>
                  {rateio ? 'Desfazer mudanças' : 'Começar do zero'}
                </button>
              }
            >
              Continuando de onde tu parou (ficou guardado neste aparelho).
            </Aviso>
          )}

          <Secao titulo="Produto" id="s-produto">
            <EscolhaProduto produtoId={f.produtoId} aoEscolher={escolherProduto} />
            <Campo id="r-titulo" rotulo="Nome do rateio" erro={erros.titulo ?? (tabacoTitulo ? AVISO_PROIBIDO : undefined)} lado={<span className="pn-contagem">{f.titulo.length}/80</span>}>
              {(a) => <input {...a} name="titulo" className="pn-input" autoComplete="off" maxLength={80} placeholder="Ex.: Arizona Green Tea 680 ml" value={f.titulo} onChange={(e) => mudar('titulo', e.target.value)} />}
            </Campo>
          </Secao>

          <Secao titulo="Foto" id="s-foto">
            <p id="r-imagem-dica" className="pn-dica-bloco">
              Opcional. Do celular mesmo: a gente ajusta o tamanho. A foto aparece no lugar da arte.
            </p>
            <EnvioFoto imagem={f.imagem} aoMudar={(v) => mudar('imagem', v)} erro={erros.imagem} temProduto={!!f.produtoId} aria={{ 'aria-describedby': 'r-imagem-dica' }} />
          </Secao>

          <Secao titulo="Preço" id="s-preco">
            <div className="pn-dupla">
              <Campo id="r-precoRateio" rotulo="No rateio" erro={erros.precoRateio}>
                {(a) => <Reais aria={a} name="precoRateio" valor={f.precoRateio} aoMudar={(v) => mudar('precoRateio', v)} placeholder="14,90" />}
              </Campo>
              <Campo id="r-precoDepois" rotulo="Quando chegar" erro={erros.precoDepois}>
                {(a) => <Reais aria={a} name="precoDepois" valor={f.precoDepois} aoMudar={(v) => mudar('precoDepois', v)} placeholder="opcional" />}
              </Campo>
            </div>
            {eco != null && preco != null && depois != null ? (
              <p className="pn-economia">
                <strong>Economia de {brl(eco)}</strong> por vaga ({Math.round((eco / depois) * 100)}% mais barato do que quando chegar).
              </p>
            ) : (
              <p className="pn-dica-bloco">Com o preço de quando chegar, o site mostra quanto a galera economiza entrando agora.</p>
            )}
            {publicado && rateio && rateio.totais.participacoes > 0 && <p className="pn-dica-bloco">Quem já entrou continua com o preço de quando entrou.</p>}
          </Secao>

          <Secao titulo="Vagas" id="s-vagas">
            <div className="pn-dupla">
              <Campo id="r-vagas" rotulo="Total de vagas" erro={erros.vagas}>
                {(a) => <Numero aria={a} valor={f.vagas} aoMudar={(v) => mudar('vagas', v)} min={Math.max(1, ocupadas)} max={1000} rotuloMenos="Menos uma vaga" rotuloMais="Mais uma vaga" />}
              </Campo>
              <Campo id="r-limite" rotulo="Por pessoa" erro={erros.limite}>
                {(a) => <Numero aria={a} valor={f.limite} aoMudar={(v) => mudar('limite', v)} min={1} max={Math.max(1, inteiro(f.vagas) ?? 1)} rotuloMenos="Diminuir o limite por pessoa" rotuloMais="Aumentar o limite por pessoa" />}
              </Campo>
            </div>
            <p className="pn-dica-bloco">
              1 vaga = 1 unidade. "Por pessoa" é o máximo que um WhatsApp pega nesse rateio.{ocupadas ? ` Já tem ${ocupadas} ocupada${ocupadas === 1 ? '' : 's'}.` : ''}
            </p>
          </Secao>

          <Secao titulo="Onde vale" id="s-ufs">
            <div className={`pn-campo${erros.ufs ? ' pn-campo-erro' : ''}`}>
              <div className="pn-chips" role="group" aria-labelledby="s-ufs" aria-describedby={erros.ufs ? 'r-ufs-erro' : undefined}>
                {UFS.map((u) => {
                  const on = f.ufs.includes(u.uf)
                  return (
                    <button
                      key={u.uf}
                      id={`r-uf-${u.uf}`}
                      type="button"
                      className={`pn-chip-uf px${on ? ' on' : ''}`}
                      aria-pressed={on}
                      aria-label={u.nome}
                      onClick={() => mudar('ufs', on ? f.ufs.filter((x) => x !== u.uf) : UFS.map((x) => x.uf).filter((x) => x === u.uf || f.ufs.includes(x)))}
                    >
                      {on && <Ic nome="check" tamanho={16} />}
                      {u.uf.toUpperCase()}
                    </button>
                  )
                })}
              </div>
              {erros.ufs && (
                <p id="r-ufs-erro" className="pn-erro">
                  <Ic nome="atencao" tamanho={16} />
                  <span>{erros.ufs}</span>
                </p>
              )}
            </div>
          </Secao>

          <Secao titulo="Prazos" id="s-prazos">
            <h3 className="pn-h3 pn-h3-colado">Previsão de chegada</h3>
            <div className="pn-dupla">
              <Campo id="r-previsaoMin" rotulo="No mínimo" erro={erros.previsaoMin}>
                {(a) => <Numero aria={a} valor={f.previsaoMin} aoMudar={(v) => mudar('previsaoMin', v)} min={1} max={90} sufixo="dias" rotuloMenos="Um dia a menos (mínimo)" rotuloMais="Um dia a mais (mínimo)" />}
              </Campo>
              <Campo id="r-previsaoMax" rotulo="No máximo" erro={erros.previsaoMax}>
                {(a) => <Numero aria={a} valor={f.previsaoMax} aoMudar={(v) => mudar('previsaoMax', v)} min={1} max={120} sufixo="dias" rotuloMenos="Um dia a menos (máximo)" rotuloMais="Um dia a mais (máximo)" />}
              </Campo>
            </div>
            <p className="pn-dica-bloco">Dias contados de quando fecha. No site: “Previsão: de {f.previsaoMin || '…'} a {f.previsaoMax || '…'} dias depois que fechar.”</p>

            <label className="pn-troca">
              <input type="checkbox" checked={f.temPrazo} onChange={(e) => mudar('temPrazo', e.target.checked)} />
              <span className="pn-troca-marca" aria-hidden="true" />
              <span>Tem prazo pra entrar</span>
            </label>
            {f.temPrazo ? (
              <Campo id="r-fechaEm" rotulo="Fecha as entradas em" erro={erros.fechaEm} dica="Horário de Brasília. Se lotar antes, fecha antes.">
                {(a) => <input {...a} name="fechaEm" type="datetime-local" className="pn-input" value={f.fechaEm} min={isoParaLocal(new Date(api.agora()).toISOString())} onChange={(e) => mudar('fechaEm', e.target.value)} />}
              </Campo>
            ) : (
              <p className="pn-dica-bloco">Sem prazo: fecha quando lotar.</p>
            )}

            <Campo id="r-reservaHoras" rotulo="A reserva segura a vaga por" erro={erros.reservaHoras} dica="Quem entra pelo site tem esse tempo pra pagar. Depois, a vaga volta pra lista.">
              {(a) => <Numero aria={a} valor={f.reservaHoras} aoMudar={(v) => mudar('reservaHoras', v)} min={1} max={168} sufixo="horas" rotuloMenos="Uma hora a menos" rotuloMais="Uma hora a mais" />}
            </Campo>
          </Secao>

          <Secao titulo="Descrição" id="s-descricao">
            <Campo id="r-descricao" rotulo="O que vem (opcional)" erro={erros.descricao ?? (tabacoDesc ? AVISO_PROIBIDO : undefined)} lado={<span className="pn-contagem">{f.descricao.length}/400</span>}>
              {(a) => <textarea {...a} name="descricao" className="pn-input pn-texto" rows={3} maxLength={400} placeholder="Ex.: Chá verde gelado da AriZona, na lata alta de 680 ml. Importado." value={f.descricao} onChange={(e) => mudar('descricao', e.target.value)} />}
            </Campo>
          </Secao>
        </div>

        <aside className="pn-editar-previa" aria-labelledby="h-previa">
          <h2 id="h-previa" className="pn-h2">
            Como fica no site
          </h2>
          <PreviaCartao r={previa} />
        </aside>

        <div className="pn-editar-pe">
          {geral && <Aviso tipo="erro">{geral}</Aviso>}
          <div className="pn-botoes pn-botoes-linha">
            {publicado ? (
              <Botao type="submit" largo ocupado={salvando === 'salvar'} disabled={!!salvando && salvando !== 'salvar'}>
                Salvar mudanças
              </Botao>
            ) : (
              <>
                <Botao variante="cinza" largo ocupado={salvando === 'rascunho'} disabled={!!salvando && salvando !== 'rascunho'} onClick={() => void salvar('rascunho')}>
                  <span className="pn-txt-longo">Salvar rascunho</span>
                  <span className="pn-txt-curto" aria-hidden="true">
                    Rascunho
                  </span>
                </Botao>
                <Botao type="submit" largo ocupado={salvando === 'aberto'} disabled={!!salvando && salvando !== 'aberto'}>
                  <span className="pn-txt-longo">Publicar no site</span>
                  <span className="pn-txt-curto" aria-hidden="true">
                    Publicar
                  </span>
                </Botao>
              </>
            )}
          </div>
        </div>
      </form>
    </>
  )
}
