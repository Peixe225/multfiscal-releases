// Produto (criar e editar): foto (vira a capa do card e da página do produto no site), nome, tamanho, categoria,
// preço ou "Consultar", combos, variações, onde tem (à venda e estoque por estado), "Combina com", o desenho de
// quando não tem foto e a prévia do card como o cliente vê. O que está sendo digitado fica guardado no aparelho até
// salvar. Na edição, só vai pro servidor o que mudou (a troca rápida feita no outro aparelho não é desfeita).
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ARTES_DE_BEBIDA } from '../../lib/alcool'
import * as apiBase from '../api'
import { ErroApi } from '../api'
import { Confirmar, type PedidoConfirmacao } from '../Confirmar'
import { Folha } from '../Folha'
import { brl, lerReais, reaisNoCampo } from '../formato'
import { prepararFoto } from '../imagem'
import { lembrarJson, lidoJson } from '../lembrar'
import { Topo } from '../Moldura'
import { caminho, ir, voltar } from '../rotas'
import { avisarNaProxima } from '../telas/flash'
import { useTitulo } from '../telas/comum'
import { Aviso, Botao, Campo, Carregando, Ic, Numero, Pontinhos, TituloTela } from '../ui'
import * as api from './api'
import { ArteProduto, NomeProduto, useIlustracoes } from './Arte'
import { comProduto, estadosNoSite, guardarLoja, semProduto, situacao, useLoja } from './dados'
import { ARTES } from './nomes'
import { PreviaCard } from './Previa'
import { lerPreco, pareceAlcool, problemaNoTexto, tamanho } from './validar'
import type { Arte, LojaAdmin, NoEstado, ProdutoAdmin, ProdutoCorpo, TipoArte } from './tipos'

interface FormEstado {
  disponivel: boolean
  contar: boolean
  estoque: string
}

interface Form {
  nome: string
  tamanho: string
  detalhe: string
  descricao: string
  categoria: string
  preco: string
  combos: { qtd: string; total: string }[]
  variacoes: { id?: string; nome: string; preco: string }[]
  foto: string | null
  formato: TipoArte
  cor1: string
  cor2: string
  estados: Record<string, FormEstado>
  combinaCom: string[]
  obs: string
  ativo: boolean
  demo: boolean
}

type Erros = Partial<Record<string, string>>

const GARRAFAS: TipoArte[] = ['garrafa-quadrada', 'garrafa-gin', 'garrafa-conhaque', 'garrafa-licor']
const inteiro = (s: string): number | null => (/^\d{1,5}$/.test(s.trim()) ? Number(s.trim()) : null)

function estadoDoForm(n: NoEstado | undefined): FormEstado {
  return { disponivel: !!n?.disponivel, contar: n?.estoque != null, estoque: n?.estoque != null ? String(n.estoque) : '' }
}

function doProduto(p: ProdutoAdmin, l: LojaAdmin): Form {
  return {
    nome: p.nome,
    tamanho: p.tamanho,
    detalhe: p.detalhe,
    descricao: p.descricao,
    categoria: p.categoria,
    preco: reaisNoCampo(p.preco),
    combos: p.combos.map((c) => ({ qtd: String(c.qtd), total: reaisNoCampo(c.total) })),
    variacoes: p.variacoes.map((v) => ({ id: v.id, nome: v.nome, preco: reaisNoCampo(v.preco) })),
    foto: p.foto,
    formato: p.arte.tipo,
    cor1: p.arte.corpo,
    cor2: (GARRAFAS.includes(p.arte.tipo) ? p.arte.rotulo : p.arte.faixa) ?? '',
    estados: Object.fromEntries(l.estados.map((e) => [e.uf, estadoDoForm(p.estados[e.uf])])),
    combinaCom: p.combinaCom,
    obs: p.obs,
    ativo: p.ativo,
    demo: p.demo,
  }
}

function novo(l: LojaAdmin): Form {
  return {
    nome: '',
    tamanho: '',
    detalhe: '',
    descricao: '',
    categoria: '',
    preco: '',
    combos: [],
    variacoes: [],
    foto: null,
    formato: 'lata',
    cor1: '#a8a8a8',
    cor2: '',
    // produto novo nasce sem estar à venda: o dono liga onde tem (nada de prometer o que não tem)
    estados: Object.fromEntries(l.estados.map((e) => [e.uf, { disponivel: false, contar: false, estoque: '' }])),
    combinaCom: [],
    obs: '',
    ativo: true,
    demo: false,
  }
}

/** A cor do brilho em volta: a principal, ou a segunda quando a principal é quase preta, branca ou cinza. */
function corDoBrilho(cor1: string, cor2: string): string {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const [r, g, b] = rgb(cor1)
  const neutra = Math.max(r, g, b) - Math.min(r, g, b) < 24
  return neutra && /^#[0-9a-f]{6}$/i.test(cor2) ? cor2 : cor1
}

function arteDoForm(f: Form, base: Arte | null): Arte {
  const chave = GARRAFAS.includes(f.formato) ? 'rotulo' : 'faixa'
  const outra = chave === 'rotulo' ? 'faixa' : 'rotulo'
  const a: Arte = { ...(base ?? {}), tipo: f.formato, corpo: f.cor1 }
  delete a[outra]
  if (f.cor2) a[chave] = f.cor2
  else delete a[chave]
  return a
}

function validar(f: Form, p: ProdutoAdmin | null, l: LojaAdmin): Erros {
  const e: Erros = {}
  const nome = f.nome.trim()
  if (tamanho(nome) < 2 || tamanho(nome) > 60) e.nome = 'Nome de 2 a 60 letras.'
  else e.nome = problemaNoTexto(nome, 'loja') ?? undefined
  if (tamanho(f.tamanho) > 20) e.tamanho = 'Tamanho até 20 letras (ex.: 350 ml, 1 L).'
  else e.tamanho = problemaNoTexto(f.tamanho, 'loja') ?? undefined
  if (tamanho(f.detalhe) > 60) e.detalhe = 'Até 60 letras.'
  else e.detalhe = problemaNoTexto(f.detalhe, 'loja') ?? undefined
  if (tamanho(f.descricao) > 300) e.descricao = 'Descrição até 300 letras.'
  else e.descricao = problemaNoTexto(f.descricao, 'loja') ?? undefined
  if (!f.categoria) e.categoria = 'Escolhe a categoria.'
  const preco = lerPreco(f.preco)
  if (preco === undefined) e.preco = 'Preço de R$ 0,00 a R$ 100.000,00, ou vazio pra aparecer “Consultar”.'
  // combos: com o preço da unidade, quantidade sem repetir, mais barato que avulso e subindo com a quantidade
  const combos = f.combos.map((c) => ({ qtd: inteiro(c.qtd), total: lerReais(c.total) }))
  combos.forEach((c, i) => {
    if (c.qtd == null || c.qtd < 2 || c.qtd > 99) e[`combo-${i}`] = 'Combo é de 2 unidades pra cima.'
    else if (c.total == null || c.total <= 0) e[`combo-${i}`] = 'Põe o preço do combo (ex.: 14,99).'
    else if (preco == null) e[`combo-${i}`] = 'Combo precisa do preço da unidade.'
    else if (preco !== undefined && c.total >= c.qtd * preco) e[`combo-${i}`] = `Tem que sair mais barato que ${c.qtd} avulsos (${brl(c.qtd * preco)}).`
  })
  const ordenados = combos.map((c, i) => ({ ...c, i })).filter((c) => c.qtd != null && c.total != null).sort((a, b) => a.qtd! - b.qtd!)
  for (let k = 1; k < ordenados.length; k++) {
    const a = ordenados[k - 1]
    const b = ordenados[k]
    if (a.qtd === b.qtd) e[`combo-${b.i}`] ??= `Dois combos de ${b.qtd}: deixa um só.`
    else if (b.total! <= a.total!) e[`combo-${b.i}`] ??= `O combo de ${b.qtd} tem que custar mais que o de ${a.qtd}.`
  }
  const nomes = new Set<string>()
  f.variacoes.forEach((v, i) => {
    const n = v.nome.trim()
    if (tamanho(n) < 1 || tamanho(n) > 40) e[`var-${i}`] = 'Nome da variação de 1 a 40 letras.'
    else if (nomes.has(n.toLowerCase())) e[`var-${i}`] = `Duas variações “${n}”: deixa uma só.`
    else if (problemaNoTexto(n, 'loja')) e[`var-${i}`] = problemaNoTexto(n, 'loja') ?? undefined
    else if (v.preco.trim() && lerPreco(v.preco) == null) e[`var-${i}`] = 'Preço da variação inválido (ou deixa vazio: vale o do produto).'
    nomes.add(n.toLowerCase())
  })
  for (const [uf, x] of Object.entries(f.estados)) if (x.contar && (inteiro(x.estoque) == null || inteiro(x.estoque)! > 9999)) e[`est-${uf}`] = 'Põe quantas unidades tem (de 0 a 9.999).'
  if (tamanho(f.obs) > 300) e.obs = 'Anotação até 300 letras.'
  // produto que é prêmio do Teste minha sorte não vira bebida
  const cat = l.categorias.find((c) => c.id === f.categoria)
  if (p && p.uso.premios.length && !e.categoria && cat?.bebida) e.categoria = `É do prêmio “${p.uso.premios[0].titulo}”, e bebida não entra em prêmio. Muda o prêmio antes.`
  if (p && p.uso.premios.length && !e.nome && pareceAlcool(nome)) e.nome = `É do prêmio “${p.uso.premios[0].titulo}”, e bebida não entra em prêmio.`
  if (p && p.uso.premios.length && ARTES_DE_BEBIDA.includes(f.formato)) e.arte = `É do prêmio “${p.uso.premios[0].titulo}”, e desenho de bebida não entra em prêmio. Muda o prêmio antes.`
  for (const k of Object.keys(e)) if (!e[k]) delete e[k]
  return e
}

function corpo(f: Form, p: ProdutoAdmin | null): ProdutoCorpo {
  const c: ProdutoCorpo = {
    nome: f.nome.trim(),
    tamanho: f.tamanho.trim(),
    detalhe: f.detalhe.trim(),
    descricao: f.descricao.trim(),
    categoria: f.categoria,
    preco: lerPreco(f.preco) ?? null,
    combos: f.combos.map((x) => ({ qtd: inteiro(x.qtd) ?? 0, total: lerReais(x.total) ?? 0 })),
    variacoes: f.variacoes.map((v) => ({ ...(v.id ? { id: v.id } : {}), nome: v.nome.trim(), preco: v.preco.trim() ? (lerPreco(v.preco) ?? null) : null })),
    combinaCom: f.combinaCom,
    foto: f.foto,
    obs: f.obs.trim(),
    ativo: f.ativo,
    demo: f.demo,
  }
  // o desenho só vai quando mudou (o dos produtos de antes tem cores que o formulário não mostra)
  const base = p?.arte ?? null
  const arte = arteDoForm(f, base)
  if (!p || JSON.stringify(arte) !== JSON.stringify(base)) {
    c.arte = arte
    c.cor = corDoBrilho(f.cor1, f.cor2)
  }
  // estados: só os que mudaram
  const estados: Record<string, NoEstado> = {}
  for (const [uf, x] of Object.entries(f.estados)) {
    const n: NoEstado = { disponivel: x.disponivel, estoque: x.contar ? (inteiro(x.estoque) ?? 0) : null }
    const antes = p?.estados[uf] ?? { disponivel: false, estoque: null }
    if (!p || n.disponivel !== antes.disponivel || n.estoque !== antes.estoque) estados[uf] = n
  }
  if (Object.keys(estados).length) c.estados = estados
  return p ? { id: p.id, ...c } : c
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

function Reais({ id, valor, aoMudar, placeholder, rotulo, erro }: { id: string; valor: string; aoMudar: (v: string) => void; placeholder?: string; rotulo: string; erro?: boolean }) {
  return (
    <div className="pn-reais">
      <span aria-hidden="true">R$</span>
      <input
        id={id}
        name={id}
        className="pn-input"
        inputMode="decimal"
        autoComplete="off"
        placeholder={placeholder}
        aria-label={rotulo}
        aria-invalid={erro || undefined}
        value={valor}
        onChange={(e) => aoMudar(e.target.value.replace(/[^\d,.]/g, '').slice(0, 10))}
        onBlur={() => {
          const n = lerReais(valor)
          if (n != null) aoMudar(reaisNoCampo(n))
        }}
      />
    </div>
  )
}

/**
 * A foto do produto: sobe pelo admin-upload (o celular reduz antes) e vira a capa do card no site. Do lado, o card como
 * o cliente vê (no computador ele fica na coluna da prévia).
 */
function FotoProduto({ foto, aoMudar, previa, semFoto }: { foto: string | null; aoMudar: (f: string | null) => void; previa: ReactNode; semFoto: string }) {
  const [andamento, setAndamento] = useState<number | null>(null)
  const [falha, setFalha] = useState<string | null>(null)
  const entrada = useRef<HTMLInputElement>(null)
  const escolher = async (f: File | undefined) => {
    if (!f || andamento !== null) return
    setFalha(null)
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) {
      setFalha('Manda foto em JPG, PNG ou WebP.')
      return
    }
    setAndamento(0)
    try {
      const pronta = await prepararFoto(f)
      const r = await apiBase.enviarImagem(pronta.blob, pronta.nome, (x) => setAndamento(x))
      aoMudar(r.imagem)
    } catch (e) {
      setFalha(apiBase.mensagemDe(e))
    } finally {
      setAndamento(null)
      if (entrada.current) entrada.current.value = ''
    }
  }
  return (
    <div className="pn-foto pn-foto-produto">
      <div className="pn-foto-card">{previa}</div>
      <div className="pn-foto-lado">
        <p className="pn-dica-bloco">{foto ? 'No site, o preto da foto some no preto da página: produto em fundo preto fica melhor.' : semFoto}</p>
        {andamento !== null && (
          <div className="pn-foto-andamento-linha" role="status">
            <Pontinhos rotulo="Subindo a foto…" />
            <span className="pn-foto-barra" aria-hidden="true">
              <i style={{ transform: `scaleX(${andamento})` }} />
            </span>
            <span>{Math.round(andamento * 100)}%</span>
          </div>
        )}
        <div className="pn-foto-acoes">
          <label className={`pn-botao pn-botao-cinza${andamento !== null ? ' pn-ocupado' : ''}`}>
            <Ic nome="camera" tamanho={16} />
            <span className="pn-botao-txt">{foto ? 'Trocar foto' : 'Enviar foto'}</span>
            <input ref={entrada} id="p-foto" name="foto" type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={andamento !== null} onChange={(e) => void escolher(e.target.files?.[0])} />
          </label>
          {foto && andamento === null && (
            <button type="button" className="pn-botao pn-botao-texto" onClick={() => aoMudar(null)}>
              <span className="pn-botao-txt">Tirar foto</span>
            </button>
          )}
        </div>
        {falha && <Aviso tipo="erro">{falha}</Aviso>}
      </div>
    </div>
  )
}

/** "Combina com" (a página do produto sugere): até 8 outros produtos, escolhidos numa folha com busca. */
function EscolherCombina({ l, proprio, ids, aoMudar }: { l: LojaAdmin; proprio: string | null; ids: string[]; aoMudar: (ids: string[]) => void }) {
  const [aberta, setAberta] = useState(false)
  const [busca, setBusca] = useState('')
  const porId = new Map(l.produtos.map((p) => [p.id, p]))
  const outros = l.produtos.filter((p) => p.id !== proprio && p.ativo && (!busca || p.nome.toLowerCase().includes(busca.toLowerCase())))
  return (
    <>
      {ids.length > 0 ? (
        <ul className="pn-escolhidos" aria-label="Combina com">
          {ids.map((id) => {
            const p = porId.get(id)
            return (
              <li key={id} className="pn-escolhido">
                {p && <ArteProduto produto={p} largura={24} halo={false} />}
                <span>{p?.nome ?? id}</span>
                <button type="button" className="icone-botao" aria-label={`Tirar ${p?.nome ?? id}`} onClick={() => aoMudar(ids.filter((x) => x !== id))}>
                  <Ic nome="fechar" tamanho={16} />
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="pn-dica-bloco">Nenhum. A página do produto sugere esses embaixo do “Adicionar à sacola”.</p>
      )}
      <Botao variante="cinza" icone="mais" onClick={() => setAberta(true)} disabled={ids.length >= 8}>
        Escolher
      </Botao>
      <Folha
        aberta={aberta}
        aoFechar={() => setAberta(false)}
        titulo="Combina com"
        sub={`${ids.length} de 8`}
        larga
        rodape={
          <Botao largo onClick={() => setAberta(false)}>
            Pronto
          </Botao>
        }
      >
        <div className="pn-folha-pad">
          <div className="pn-busca">
            <Ic nome="lupa" tamanho={16} />
            <input type="search" className="pn-input" placeholder="Buscar produto" aria-label="Buscar produto" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
          <ul className="pn-lista-marcar">
            {outros.map((p) => {
              const on = ids.includes(p.id)
              return (
                <li key={p.id}>
                  <label className="pn-marcar">
                    <input type="checkbox" checked={on} disabled={!on && ids.length >= 8} onChange={() => aoMudar(on ? ids.filter((x) => x !== p.id) : [...ids, p.id])} />
                    <span className="pn-marcar-caixa" aria-hidden="true">
                      {on && <Ic nome="check" tamanho={16} />}
                    </span>
                    <ArteProduto produto={p} largura={24} halo={false} />
                    <span>
                      <NomeProduto p={p} />
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        </div>
      </Folha>
    </>
  )
}

export function Produto({ id }: { id: string | null }) {
  useTitulo(id ? 'Editar produto' : 'Novo produto')
  const leitura = useLoja(0)
  const l = leitura.dados
  const p = id && l ? (l.produtos.find((x) => x.id === id) ?? null) : null
  const chaveRascunho = `produto:${id ?? 'novo'}`
  const [f, setF] = useState<Form | null>(null)
  const [voltouRascunho, setVoltouRascunho] = useState(false)
  const [erros, setErros] = useState<Erros>({})
  const [geral, setGeral] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [previaUf, setPreviaUf] = useState<string | null>(null)
  const [confirmacao, setConfirmacao] = useState<PedidoConfirmacao | null>(null)
  const trava = useRef(false)
  const inicial = useRef<string | null>(null)
  const base = useRef<string | null>(null)
  const ilustracoes = useIlustracoes()
  const idDesenho = useId()

  // abre o formulário uma vez, quando a loja chega (e o rascunho guardado neste aparelho, se for do mesmo produto)
  useEffect(() => {
    if (f || !l) return
    if (id && !p) return
    const limpo = p ? doProduto(p, l) : novo(l)
    inicial.current = JSON.stringify(limpo)
    base.current = p?.atualizadoEm ?? null
    const guardado = lidoJson<{ form: Form; base: string | null }>(chaveRascunho)
    if (guardado && guardado.base === base.current && JSON.stringify(guardado.form) !== inicial.current) {
      setF({ ...limpo, ...guardado.form, estados: { ...limpo.estados, ...guardado.form.estados } })
      setVoltouRascunho(true)
    } else {
      if (guardado) lembrarJson(chaveRascunho, null)
      setF(limpo)
    }
    setPreviaUf(estadosNoSite(l)[0]?.uf ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [l, p, id])

  useEffect(() => {
    if (!f) return
    const t = window.setTimeout(() => lembrarJson(chaveRascunho, JSON.stringify(f) === inicial.current ? null : { form: f, base: base.current }), 300)
    return () => window.clearTimeout(t)
  }, [f, chaveRascunho])

  const mudar = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF((s) => (s ? { ...s, [k]: v } : s))
    if (erros[k as string]) setErros((e) => ({ ...e, [k]: undefined }))
  }

  const focar = (campo: string) => {
    const mapa: Record<string, string> = { combos: 'p-combo-qtd-0', variacoes: 'p-var-0', estados: `p-est-${Object.keys(f?.estados ?? {})[0] ?? ''}`, combinaCom: 's-combina', arte: 's-desenho', cor: 's-desenho' }
    const alvo = mapa[campo] ?? (campo.startsWith('combo-') ? `p-combo-qtd-${campo.slice(6)}` : campo.startsWith('var-') ? `p-var-${campo.slice(4)}` : campo.startsWith('est-') ? `p-est-n-${campo.slice(4)}` : `p-${campo}`)
    const el = document.getElementById(alvo)
    el?.focus()
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  const salvar = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!f || !l || salvando) return
    const novos = validar(f, p, l)
    setErros(novos)
    setGeral(null)
    const primeiro = Object.keys(novos)[0]
    if (primeiro) {
      focar(primeiro)
      return
    }
    if (trava.current) return
    trava.current = true
    setSalvando(true)
    try {
      const r = await api.salvarProduto(corpo(f, p))
      lembrarJson(chaveRascunho, null)
      guardarLoja((x) => comProduto(x, r.produto, r))
      avisarNaProxima(p ? `${r.produto.nome}: salvo. O site já mostra.` : `${r.produto.nome} criado. ${Object.values(r.produto.estados).some((x) => x?.disponivel) ? 'Já tá no site.' : 'Liga os estados onde tem pra aparecer à venda.'}`)
      if (p) voltar(caminho.produtos)
      else ir(caminho.produtos, true)
    } catch (err) {
      if (err instanceof ErroApi && err.campo) {
        const uf = typeof err.dados.uf === 'string' ? err.dados.uf : null
        const c = err.campo === 'combos' ? `combo-${Number(err.dados.indice ?? 0)}` : err.campo === 'variacoes' ? `var-${Number(err.dados.indice ?? 0)}` : err.campo === 'estados' && uf ? `est-${uf}` : err.campo
        setErros({ [c]: err.message })
        focar(c)
      } else setGeral(apiBase.mensagemDe(err))
    } finally {
      trava.current = false
      setSalvando(false)
    }
  }

  const pedirApagar = () => {
    if (!p) return
    setConfirmacao({
      titulo: `Apagar ${p.nome}?`,
      texto: 'Sai do site e do painel de vez. Pra só esconder, desliga o “Aparece no site”.',
      botao: 'Apagar produto',
      perigo: true,
      acao: async () => {
        const r = await api.apagarProduto(p.id)
        lembrarJson(chaveRascunho, null)
        guardarLoja((x) => semProduto(x, p.id, r))
        avisarNaProxima(`${p.nome} apagado.`)
        ir(caminho.produtos, true)
      },
    })
  }

  const titulo = <TituloTela>{id ? 'Editar produto' : 'Novo produto'}</TituloTela>
  if (leitura.erro && !l) {
    return (
      <>
        <Topo voltar={caminho.produtos} titulo={titulo} />
        <div className="pn-pagina">
          <Aviso tipo="erro" acao={<button type="button" className="pn-link-botao" onClick={() => void leitura.recarregar()}>Tentar de novo</button>}>
            {leitura.erro.message}
          </Aviso>
        </div>
      </>
    )
  }
  if (l && id && !p) {
    return (
      <>
        <Topo voltar={caminho.produtos} titulo={titulo} />
        <div className="pn-pagina">
          <Aviso tipo="info">Esse produto não existe mais (foi apagado em outro aparelho?).</Aviso>
        </div>
      </>
    )
  }
  if (!f || !l) {
    return (
      <>
        <Topo voltar={caminho.produtos} titulo={titulo} />
        <Carregando />
      </>
    )
  }

  const preco = lerPreco(f.preco)
  const estados = l.estados
  const cat = l.categorias.find((c) => c.id === f.categoria)
  const temIlustracao = !!(p && ilustracoes?.[p.id])
  const arte = arteDoForm(f, p?.arte ?? null)
  const corBrilho = p && JSON.stringify(arte) === JSON.stringify(p.arte) ? p.cor : corDoBrilho(f.cor1, f.cor2)
  const previaEst = previaUf ? f.estados[previaUf] : undefined
  const previaNo: NoEstado | null = previaEst ? { disponivel: previaEst.disponivel, estoque: previaEst.contar ? (inteiro(previaEst.estoque) ?? 0) : null } : null
  const previaP = { id: p?.id ?? 'novo', nome: f.nome.trim(), cor: corBrilho, arte, foto: f.foto, preco: preco ?? null, detalhe: f.detalhe }
  const sit = previaUf && previaNo ? situacao({ ...(p ?? ({} as ProdutoAdmin)), ativo: f.ativo, estados: { [previaUf]: previaNo } } as ProdutoAdmin, previaUf, l.ajustes.restamAte) : null
  const restam = sit === 'acabando' ? (previaNo?.estoque ?? null) : null

  return (
    <>
      <Topo voltar={caminho.produtos} titulo={titulo} />
      <form className="pn-pagina pn-editar pn-editar-produto" onSubmit={(e) => void salvar(e)} noValidate>
        <div className="pn-editar-form">
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
                    const limpo = p ? doProduto(p, l) : novo(l)
                    inicial.current = JSON.stringify(limpo)
                    setF(limpo)
                  }}
                >
                  {p ? 'Desfazer mudanças' : 'Começar do zero'}
                </button>
              }
            >
              Continuando de onde tu parou (ficou guardado neste aparelho).
            </Aviso>
          )}

          <Secao titulo="Foto" id="s-foto" dica="Vira a capa do produto no site: o card da grade, o story e a página dele.">
            <FotoProduto
              foto={f.foto}
              aoMudar={(v) => mudar('foto', v)}
              previa={<PreviaCard p={previaP} situacao={!f.ativo ? 'desligado' : sit} restam={restam} largura={132} />}
              semFoto={temIlustracao ? 'Sem foto, o site mostra a ilustração do produto (essa do lado).' : 'Sem foto, o site mostra o desenho em pixel (o formato e as cores ficam em “Desenho”, lá embaixo).'}
            />
          </Secao>

          <Secao titulo="Produto" id="s-produto">
            <Campo id="p-nome" rotulo="Nome" erro={erros.nome} lado={<span className="pn-contagem">{tamanho(f.nome)}/60</span>}>
              {(a) => <input {...a} name="nome" className="pn-input" autoComplete="off" maxLength={60} placeholder="Ex.: Fanta Ghost Face Punch" value={f.nome} onChange={(e) => mudar('nome', e.target.value)} />}
            </Campo>
            <div className="pn-dupla">
              <Campo id="p-tamanho" rotulo="Tamanho" erro={erros.tamanho} lado={<span className="pn-opcional">opcional</span>}>
                {(a) => <input {...a} name="tamanho" className="pn-input" autoComplete="off" maxLength={20} placeholder="350 ml" value={f.tamanho} onChange={(e) => mudar('tamanho', e.target.value)} />}
              </Campo>
              <Campo id="p-categoria" rotulo="Categoria" erro={erros.categoria}>
                {(a) => (
                  <select {...a} name="categoria" className="pn-input pn-select" value={f.categoria} onChange={(e) => mudar('categoria', e.target.value)}>
                    <option value="">Escolhe</option>
                    {l.categorias.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                  </select>
                )}
              </Campo>
            </div>
            <Campo id="p-detalhe" rotulo="Linha de baixo" erro={erros.detalhe} dica="Aparece embaixo do nome no story e na página (ex.: Lata 350 ml · importada)." lado={<span className="pn-opcional">opcional</span>}>
              {(a) => <input {...a} name="detalhe" className="pn-input" autoComplete="off" maxLength={60} value={f.detalhe} onChange={(e) => mudar('detalhe', e.target.value)} />}
            </Campo>
            <Campo id="p-descricao" rotulo="Descrição" erro={erros.descricao} dica="1 ou 2 frases do produto, na página dele. Sem promessa de preço, frete ou prazo." lado={<span className="pn-contagem">{tamanho(f.descricao)}/300</span>}>
              {(a) => <textarea {...a} name="descricao" className="pn-input pn-texto" rows={3} maxLength={300} value={f.descricao} onChange={(e) => mudar('descricao', e.target.value)} />}
            </Campo>
          </Secao>

          <Secao titulo="Preço" id="s-preco">
            <Campo id="p-preco" rotulo="Preço da unidade" erro={erros.preco} dica="Vazio = aparece “Consultar” no site (nunca inventa preço).">
              {(a) => <Reais id={a.id} rotulo="Preço da unidade" erro={!!a['aria-invalid']} valor={f.preco} aoMudar={(v) => mudar('preco', v)} placeholder="Consultar" />}
            </Campo>
            <h3 className="pn-h3 pn-h3-colado">Combos</h3>
            <p className="pn-dica-bloco">Ex.: 2 por R$ 14,99. A sacola do site aplica o melhor preço sozinha.</p>
            {f.combos.map((c, i) => {
              const q = inteiro(c.qtd)
              const t = lerReais(c.total)
              const eco = q && t != null && preco != null ? q * preco - t : null
              return (
                <div key={i} className={`pn-linha-combo${erros[`combo-${i}`] ? ' pn-campo-erro' : ''}`}>
                  <input
                    id={`p-combo-qtd-${i}`}
                    className="pn-input pn-input-num"
                    inputMode="numeric"
                    aria-label={`Combo ${i + 1}: quantidade`}
                    value={c.qtd}
                    onChange={(e) => mudar('combos', f.combos.map((x, j) => (j === i ? { ...x, qtd: e.target.value.replace(/\D/g, '').slice(0, 2) } : x)))}
                  />
                  <span className="pn-linha-combo-por">por</span>
                  <Reais id={`p-combo-total-${i}`} rotulo={`Combo ${i + 1}: preço`} valor={c.total} aoMudar={(v) => mudar('combos', f.combos.map((x, j) => (j === i ? { ...x, total: v } : x)))} placeholder="14,99" />
                  <button type="button" className="icone-botao" aria-label={`Tirar o combo ${i + 1}`} onClick={() => mudar('combos', f.combos.filter((_, j) => j !== i))}>
                    <Ic nome="lixo" tamanho={16} />
                  </button>
                  {erros[`combo-${i}`] ? (
                    <p className="pn-erro pn-linha-combo-msg">
                      <Ic nome="atencao" tamanho={16} />
                      <span>{erros[`combo-${i}`]}</span>
                    </p>
                  ) : (
                    eco != null && eco > 0 && <p className="pn-dica pn-linha-combo-msg">Economiza {brl(Math.round(eco * 100) / 100)} no combo.</p>
                  )}
                </div>
              )
            })}
            {f.combos.length < 5 && (
              <Botao variante="cinza" icone="mais" onClick={() => mudar('combos', [...f.combos, { qtd: String(Math.max(2, ...f.combos.map((c) => (inteiro(c.qtd) ?? 1) + 1))), total: '' }])}>
                Adicionar combo
              </Botao>
            )}
          </Secao>

          <Secao titulo="Variações" id="s-variacoes" dica="Sabor, tamanho ou modelo (ex.: Flat · 6 mm e Slim · 7 mm). O cliente escolhe na página do produto.">
            {f.variacoes.map((v, i) => (
              <div key={v.id ?? `n${i}`} className={`pn-linha-var${erros[`var-${i}`] ? ' pn-campo-erro' : ''}`}>
                <input id={`p-var-${i}`} className="pn-input" aria-label={`Variação ${i + 1}: nome`} maxLength={40} placeholder="Nome" value={v.nome} onChange={(e) => mudar('variacoes', f.variacoes.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)))} />
                <Reais id={`p-var-preco-${i}`} rotulo={`Variação ${i + 1}: preço (opcional)`} valor={v.preco} aoMudar={(x) => mudar('variacoes', f.variacoes.map((y, j) => (j === i ? { ...y, preco: x } : y)))} placeholder="mesmo" />
                <button type="button" className="icone-botao" aria-label={`Tirar a variação ${v.nome || i + 1}`} onClick={() => mudar('variacoes', f.variacoes.filter((_, j) => j !== i))}>
                  <Ic nome="lixo" tamanho={16} />
                </button>
                {erros[`var-${i}`] && (
                  <p className="pn-erro pn-linha-combo-msg">
                    <Ic nome="atencao" tamanho={16} />
                    <span>{erros[`var-${i}`]}</span>
                  </p>
                )}
              </div>
            ))}
            {f.variacoes.length < 12 && (
              <Botao variante="cinza" icone="mais" onClick={() => mudar('variacoes', [...f.variacoes, { nome: '', preco: '' }])}>
                Adicionar variação
              </Botao>
            )}
          </Secao>

          <Secao titulo="Onde tem" id="s-estados" dica="À venda em cada estado. Contando o estoque, chegou a 0 sai do site sozinho e volta quando tu põe mais.">
            <ul className="pn-onde">
              {estados.map((e) => {
                const x = f.estados[e.uf] ?? { disponivel: false, contar: false, estoque: '' }
                const set = (n: Partial<FormEstado>) => mudar('estados', { ...f.estados, [e.uf]: { ...x, ...n } })
                const erro = erros[`est-${e.uf}`]
                return (
                  <li key={e.uf} className={`pn-onde-item${e.ativo ? '' : ' pn-onde-fora'}`}>
                    <label className="pn-troca" htmlFor={`p-est-${e.uf}`}>
                      <input id={`p-est-${e.uf}`} type="checkbox" checked={x.disponivel} onChange={(ev) => set({ disponivel: ev.target.checked })} />
                      <span className="pn-troca-marca" aria-hidden="true" />
                      <span className="pn-onde-nome">
                        <span className="px">{e.uf.toUpperCase()}</span> {e.nome}
                        {!e.ativo && <small> · fora do site</small>}
                        <span className="sr-only">: à venda</span>
                      </span>
                    </label>
                    <label className="pn-marcar pn-onde-contar">
                      <input type="checkbox" checked={x.contar} onChange={(ev) => set({ contar: ev.target.checked, estoque: ev.target.checked && !x.estoque ? '0' : x.estoque })} />
                      <span className="pn-marcar-caixa" aria-hidden="true">
                        {x.contar && <Ic nome="check" tamanho={16} />}
                      </span>
                      <span>
                        Contar estoque<span className="sr-only"> em {e.nome}</span>
                      </span>
                    </label>
                    {x.contar && (
                      <div className="pn-onde-n">
                        <Numero
                          aria={{ id: `p-est-n-${e.uf}`, 'aria-label': `Unidades em ${e.nome}`, ...(erro ? { 'aria-invalid': true as const, 'aria-describedby': `p-est-n-${e.uf}-erro` } : {}) }}
                          valor={x.estoque}
                          aoMudar={(v) => set({ estoque: v })}
                          min={0}
                          max={9999}
                          sufixo="un."
                          rotuloMenos={`Menos um no estoque de ${e.nome}`}
                          rotuloMais={`Mais um no estoque de ${e.nome}`}
                        />
                        {erro && (
                          <p id={`p-est-n-${e.uf}-erro`} className="pn-erro">
                            <Ic nome="atencao" tamanho={16} />
                            <span>{erro}</span>
                          </p>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
            {erros.estados && <Aviso tipo="erro">{erros.estados}</Aviso>}
          </Secao>

          <Secao titulo="Combina com" id="s-combina">
            <EscolherCombina l={l} proprio={p?.id ?? null} ids={f.combinaCom} aoMudar={(v) => mudar('combinaCom', v)} />
          </Secao>

          <Secao titulo="Desenho" id="s-desenho" dica={f.foto ? 'Com foto, o desenho só aparece no chiado que o site faz antes de mostrar a foto.' : temIlustracao ? 'Esse produto tem a ilustração do site: o formato e as cores daqui só valem se ela sair.' : 'Sem foto, é esse desenho em pixel que aparece no site.'}>
            <div className="pn-desenho">
              <ArteProduto produto={{ id: `${p?.id ?? 'novo'}-desenho`, nome: f.nome, cor: corBrilho, arte, foto: null }} largura={72} />
              <div className="pn-desenho-campos">
                <Campo id={`${idDesenho}-formato`} rotulo="Formato" erro={erros.arte}>
                  {(a) => (
                    <select {...a} className="pn-input pn-select" value={f.formato} onChange={(e) => mudar('formato', e.target.value as TipoArte)}>
                      {ARTES.map((x) => (
                        <option key={x.tipo} value={x.tipo}>
                          {x.nome}
                        </option>
                      ))}
                    </select>
                  )}
                </Campo>
                <div className="pn-cores">
                  <label className="pn-cor">
                    <input type="color" value={f.cor1} onChange={(e) => mudar('cor1', e.target.value)} />
                    <span>Cor principal</span>
                  </label>
                  <label className="pn-cor">
                    <input type="color" value={f.cor2 || '#ffffff'} onChange={(e) => mudar('cor2', e.target.value)} />
                    <span>{GARRAFAS.includes(f.formato) ? 'Rótulo' : 'Faixa'}</span>
                  </label>
                  {f.cor2 && (
                    <button type="button" className="pn-link-botao" onClick={() => mudar('cor2', '')}>
                      Sem {GARRAFAS.includes(f.formato) ? 'rótulo' : 'faixa'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </Secao>

          <Secao titulo="No site" id="s-site">
            <label className="pn-troca">
              <input type="checkbox" checked={f.ativo} onChange={(e) => mudar('ativo', e.target.checked)} />
              <span className="pn-troca-marca" aria-hidden="true" />
              <span>Aparece no site</span>
            </label>
            <p className="pn-dica-bloco">{f.ativo ? 'Desligado, o produto some do site (a grade, o story e o Teste minha sorte) e fica guardado aqui.' : 'Fora do site: só tu vê. Liga pra voltar.'}</p>
            <label className="pn-troca">
              <input type="checkbox" checked={f.demo} onChange={(e) => mudar('demo', e.target.checked)} />
              <span className="pn-troca-marca" aria-hidden="true" />
              <span>Produto de exemplo</span>
            </label>
            {f.demo && <p className="pn-dica-bloco">Sai junto quando tu apagar os dados de exemplo (Loja).</p>}
            <Campo id="p-obs" rotulo="Anotação só tua" erro={erros.obs} dica="Não aparece no site (ex.: visto no story de MG, preço a confirmar)." lado={<span className="pn-contagem">{tamanho(f.obs)}/300</span>}>
              {(a) => <textarea {...a} name="obs" className="pn-input pn-texto" rows={2} maxLength={300} value={f.obs} onChange={(e) => mudar('obs', e.target.value)} />}
            </Campo>
            {p && (
              <div className="pn-apagar">
                {p.podeApagar ? (
                  <Botao variante="perigo" icone="lixo" onClick={pedirApagar}>
                    Apagar produto
                  </Botao>
                ) : (
                  <p className="pn-dica-bloco">
                    Não dá pra apagar: tem histórico ({[...p.uso.rateios.map((r) => `rateio “${r.titulo}”`), ...p.uso.premios.map((x) => `prêmio “${x.titulo}”`)].join(', ')}). Pra sumir do site, desliga o “Aparece no site”.
                  </p>
                )}
              </div>
            )}
          </Secao>
        </div>

        <aside className="pn-editar-previa" aria-labelledby="h-previa-p">
          <h2 id="h-previa-p" className="pn-h2">
            Como fica no site
          </h2>
          {estadosNoSite(l).length > 1 && (
            <div className="pn-filtros pn-previa-ufs" role="group" aria-label="Ver como fica em">
              {estadosNoSite(l).map((e) => (
                <button key={e.uf} type="button" className={`pn-filtro px${previaUf === e.uf ? ' on' : ''}`} aria-pressed={previaUf === e.uf} aria-label={`Como fica em ${e.nome}`} onClick={() => setPreviaUf(e.uf)}>
                  {e.uf.toUpperCase()}
                </button>
              ))}
            </div>
          )}
          <div className="pn-previa-card">
            <PreviaCard p={previaP} situacao={!f.ativo ? 'desligado' : sit} restam={restam} />
          </div>
          <p className="pn-dica-bloco pn-previa-legenda-p">
            {!f.ativo ? 'Fora do site: não aparece pra ninguém.' : previaUf ? `Em ${l.estados.find((e) => e.uf === previaUf)?.nome}: ${sit === 'acabando' ? `à venda, com “restam ${restam}”` : sit === 'disponivel' ? 'à venda' : sit === 'esgotado' ? 'esgotado (0 no estoque)' : 'indisponível'}.` : ''}
            {cat?.bebida === false && ' Pode ser prêmio do Teste minha sorte.'}
          </p>
        </aside>

        <div className="pn-editar-pe">
          {geral && <Aviso tipo="erro">{geral}</Aviso>}
          {/* editando sem mudar nada: o botão espera (como no estado) */}
          <Botao type="submit" largo ocupado={salvando} disabled={!!p && JSON.stringify(f) === inicial.current}>
            {p ? 'Salvar' : 'Criar produto'}
          </Botao>
        </div>
      </form>
      <Confirmar pedido={confirmacao} aoFechar={() => setConfirmacao(null)} />
    </>
  )
}
