// Produto (criar e editar). Em cima, o básico, que é o que o dono mais mexe: a foto (vira a capa do card e da página do
// produto no site; o Estúdio deixa ela no estilo do site) e a thumb animada (MidiaProduto.tsx), nome, categoria, preço
// ou "Consultar" e onde tem (à venda e estoque por estado), com o Salvar fixo embaixo. O resto mora em "Mais
// detalhes": tamanho, linha de baixo, descrição, combos, variações, "Combina com", o desenho de quando não tem foto, no
// site sim/não, exemplo, anotação e apagar. O card do lado da foto mostra o estado do filtro da lista (ou o primeiro
// onde tá à venda) e diz qual é. O produto novo já nasce à venda no estado do filtro e o botão diz onde vai à venda.
// O que está sendo digitado fica guardado no aparelho até salvar, e sair com mudança pergunta antes (useAvisarAoSair).
// O erro de um campo some assim que ele fica certo. Na edição, só vai pro servidor o que mudou (a troca rápida feita
// no outro aparelho não é desfeita).
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ARTES_DE_BEBIDA } from '../../lib/alcool'
import * as apiBase from '../api'
import { ErroApi } from '../api'
import { Confirmar, type PedidoConfirmacao } from '../Confirmar'
import { Folha } from '../Folha'
import { brl, lerReais, reaisNoCampo } from '../formato'
import { lembrar, lembrarJson, lido, lidoJson } from '../lembrar'
import { Topo } from '../Moldura'
import { recado } from '../recado'
import { caminho, ir, voltar } from '../rotas'
import { useAvisarAoSair } from '../sair'
import { useTitulo } from '../telas/comum'
import { Aviso, Botao, Campo, Carregando, Ic, Numero, TituloTela } from '../ui'
import * as api from './api'
import { ArteProduto, NomeProduto, useIlustracoes } from './Arte'
import { comProduto, estadosNoSite, guardarLoja, semProduto, situacao, useLoja } from './dados'
import { FotoProduto, VideoProduto } from './MidiaProduto'
import { ARTES } from './nomes'
import { PreviaCard } from './Previa'
import { lerPreco, pareceAlcool, problemaNoTexto, tamanho } from './validar'
import type { Arte, EstadoAdmin, LojaAdmin, NoEstado, ProdutoAdmin, ProdutoCorpo, TipoArte } from './tipos'

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
  /** A cor do brilho que a foto do Estúdio sugeriu (null = a do desenho, como antes). */
  corFoto: string | null
  /** Thumb animada: o vídeo e a capa (os dois ou nenhum). */
  video: string | null
  capa: string | null
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
    corFoto: null,
    video: p.video ?? null,
    capa: p.capa ?? null,
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

/** Produto novo: à venda só no estado do filtro da lista (uf), se tiver um; sem filtro, em nenhum (nada de prometer). */
function novo(l: LojaAdmin, uf: string | null): Form {
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
    corFoto: null,
    video: null,
    capa: null,
    formato: 'lata',
    cor1: '#a8a8a8',
    cor2: '',
    estados: Object.fromEntries(l.estados.map((e) => [e.uf, { disponivel: e.uf === uf, contar: false, estoque: '' }])),
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
    video: f.video,
    capa: f.video ? f.capa : null,
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
  // a cor que a foto do Estúdio sugeriu vai pro brilho (o halo do site); tirou a foto, o brilho volta pro desenho
  if (f.corFoto && f.foto) c.cor = f.corFoto
  else if (p && p.foto && !f.foto) c.cor = corDoBrilho(f.cor1, f.cor2)
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

/** Os grupos de erro: combo-0 e combo-1 são do grupo "combo"; est-mg é do "est". */
const grupoDoErro = (k: string) => k.replace(/-(\d+|[a-z]{2})$/, '')

/** Os campos que moram em "Mais detalhes": o erro num deles abre a seção antes de levar o foco. */
const EM_DETALHES = new Set(['tamanho', 'detalhe', 'descricao', 'combo', 'combos', 'var', 'variacoes', 'combinaCom', 'arte', 'cor', 'obs'])

/** "MG", "MG e SP", "3 estados". */
function listaUfs(ufs: string[]): string {
  const u = ufs.map((x) => x.toUpperCase())
  if (u.length <= 1) return u[0] ?? ''
  if (u.length === 2) return `${u[0]} e ${u[1]}`
  return `${u.length} estados`
}

/** O que tem em "Mais detalhes", numa linha (embaixo do botão que abre). */
function resumoDetalhes(f: Form): string {
  const tem: string[] = []
  if (f.tamanho.trim()) tem.push(f.tamanho.trim())
  if (f.descricao.trim() || f.detalhe.trim()) tem.push('descrição')
  if (f.combos.length) tem.push(f.combos.length === 1 ? '1 combo' : `${f.combos.length} combos`)
  if (f.variacoes.length) tem.push(f.variacoes.length === 1 ? '1 variação' : `${f.variacoes.length} variações`)
  if (f.combinaCom.length) tem.push(`combina com ${f.combinaCom.length}`)
  if (f.obs.trim()) tem.push('anotação')
  if (!f.ativo) tem.push('fora do site')
  if (f.demo) tem.push('exemplo')
  return tem.length ? tem.join(' · ') : 'Tamanho, descrição, combos, variações, desenho, anotação'
}

export function Produto({ id, ufNovo = null }: { id: string | null; ufNovo?: string | null }) {
  useTitulo(id ? 'Editar produto' : 'Novo produto')
  const leitura = useLoja(0)
  const l = leitura.dados
  const p = id && l ? (l.produtos.find((x) => x.id === id) ?? null) : null
  const chaveRascunho = `produto:${id ?? 'novo'}`
  const [f, setF] = useState<Form | null>(null)
  const [voltouRascunho, setVoltouRascunho] = useState(false)
  /** Os erros do último "Salvar" (conferidos de novo a cada mudança: o que ficou certo some na hora). */
  const [erros, setErros] = useState<Erros>({})
  /** O erro que o servidor devolveu (some quando o campo dele muda). */
  const [erroServidor, setErroServidor] = useState<Erros>({})
  const [geral, setGeral] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [previaEscolhida, setPreviaEscolhida] = useState<string | null>(null)
  const [detalhes, setDetalhesBruto] = useState(() => lido('produto-detalhes') === '1')
  const [confirmacao, setConfirmacao] = useState<PedidoConfirmacao | null>(null)
  const trava = useRef(false)
  const inicial = useRef<string | null>(null)
  const base = useRef<string | null>(null)
  const ilustracoes = useIlustracoes()
  const idDesenho = useId()
  const setDetalhes = (v: boolean) => {
    setDetalhesBruto(v)
    lembrar('produto-detalhes', v ? '1' : null)
  }

  // o estado do filtro da lista de Produtos (o do link do "Novo", ou o último lembrado), se ainda tá no site
  const ufsSite = l ? estadosNoSite(l).map((e) => e.uf) : []
  const ufFiltroBruto = ufNovo ?? lido('produtos-uf')
  const ufFiltro = ufFiltroBruto && ufsSite.includes(ufFiltroBruto) ? ufFiltroBruto : null

  // abre o formulário uma vez, quando a loja chega (e o rascunho guardado neste aparelho, se for do mesmo produto)
  useEffect(() => {
    if (f || !l) return
    if (id && !p) return
    const limpo = p ? doProduto(p, l) : novo(l, ufFiltro)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [l, p, id])

  useEffect(() => {
    if (!f) return
    const t = window.setTimeout(() => lembrarJson(chaveRascunho, JSON.stringify(f) === inicial.current ? null : { form: f, base: base.current }), 300)
    return () => window.clearTimeout(t)
  }, [f, chaveRascunho])

  const mudar = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF((s) => (s ? { ...s, [k]: v } : s))
    // o erro do servidor sai quando o campo dele muda (combos leva os combo-N; variações, os var-N; onde tem, os est-UF)
    const prefixo = k === 'combos' ? 'combo-' : k === 'variacoes' ? 'var-' : k === 'estados' ? 'est-' : null
    setErroServidor((e) => {
      const n = Object.fromEntries(Object.entries(e).filter(([c]) => c !== k && !(prefixo && c.startsWith(prefixo))))
      return Object.keys(n).length === Object.keys(e).length ? e : n
    })
  }

  const focar = (campo: string) => {
    const mapa: Record<string, string> = { combos: 'p-combo-qtd-0', variacoes: 'p-var-0', estados: `p-est-${Object.keys(f?.estados ?? {})[0] ?? ''}`, combinaCom: 's-combina', arte: `${idDesenho}-formato`, cor: `${idDesenho}-formato` }
    const alvo = mapa[campo] ?? (campo.startsWith('combo-') ? `p-combo-qtd-${campo.slice(6)}` : campo.startsWith('var-') ? `p-var-${campo.slice(4)}` : campo.startsWith('est-') ? `p-est-n-${campo.slice(4)}` : `p-${campo}`)
    const levar = () => {
      const el = document.getElementById(alvo)
      el?.focus()
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
    // o campo tá em "Mais detalhes" fechado: abre e leva o foco depois que ele aparece
    if (EM_DETALHES.has(grupoDoErro(campo)) && !detalhes) {
      setDetalhes(true)
      requestAnimationFrame(() => requestAnimationFrame(levar))
    } else levar()
  }

  // sair com mudança não salva pergunta antes (Salvar · Descartar · Continuar editando); descartar apaga o rascunho
  const mexeu = !!f && JSON.stringify(f) !== inicial.current
  const salvarRef = useRef<(e?: FormEvent, ficar?: boolean) => Promise<boolean>>(async () => false)
  const { liberar } = useAvisarAoSair(mexeu, { salvar: () => salvarRef.current(undefined, true), descartar: () => lembrarJson(chaveRascunho, null) })

  const salvar = async (e?: FormEvent, ficar = false): Promise<boolean> => {
    e?.preventDefault()
    if (!f || !l || salvando) return false
    const novos = validar(f, p, l)
    setErros(novos)
    setErroServidor({})
    setGeral(null)
    const primeiro = Object.keys(novos)[0]
    if (primeiro) {
      focar(primeiro)
      return false
    }
    if (trava.current) return false
    trava.current = true
    setSalvando(true)
    try {
      const r = await api.salvarProduto(corpo(f, p))
      lembrarJson(chaveRascunho, null)
      inicial.current = JSON.stringify(f)
      guardarLoja((x) => comProduto(x, r.produto, r))
      const onde = estadosNoSite(l)
        .map((x) => x.uf)
        .filter((uf) => r.produto.estados[uf]?.disponivel)
      recado(
        p
          ? `${r.produto.nome}: salvo. O site já mostra.`
          : onde.length
            ? `${r.produto.nome} criado e à venda em ${listaUfs(onde)}. O site já mostra.`
            : `${r.produto.nome} criado, sem estar à venda: liga os estados em “Onde tem” pra aparecer no site.`,
      )
      liberar()
      if (!ficar) {
        if (p) voltar(caminho.produtos)
        else ir(caminho.produtos, true)
      }
      return true
    } catch (err) {
      if (err instanceof ErroApi && err.campo) {
        const uf = typeof err.dados.uf === 'string' ? err.dados.uf : null
        const c = err.campo === 'combos' ? `combo-${Number(err.dados.indice ?? 0)}` : err.campo === 'variacoes' ? `var-${Number(err.dados.indice ?? 0)}` : err.campo === 'estados' && uf ? `est-${uf}` : err.campo
        setErroServidor({ [c]: err.message })
        focar(c)
      } else setGeral(apiBase.mensagemDe(err))
      return false
    } finally {
      trava.current = false
      setSalvando(false)
    }
  }
  salvarRef.current = salvar

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
        recado(`${p.nome} apagado.`)
        liberar()
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

  // os erros à vista: os do último "Salvar" que ainda valem (com a frase de agora) e o do servidor
  const vivos = validar(f, p, l)
  const gruposComErro = new Set(Object.keys(erros).map(grupoDoErro))
  const erroDe = (k: string): string | undefined => (gruposComErro.has(grupoDoErro(k)) ? vivos[k] : undefined) ?? erroServidor[k]
  const erroEmDetalhes = [...Object.keys(vivos).filter((k) => gruposComErro.has(grupoDoErro(k))), ...Object.keys(erroServidor)].some((k) => EM_DETALHES.has(grupoDoErro(k)))

  const preco = lerPreco(f.preco)
  const estados = l.estados
  const noSite = estadosNoSite(l)
  const cat = l.categorias.find((c) => c.id === f.categoria)
  const temIlustracao = !!(p && ilustracoes?.[p.id])
  const arte = arteDoForm(f, p?.arte ?? null)
  const corBrilho = f.corFoto && f.foto ? f.corFoto : p && JSON.stringify(arte) === JSON.stringify(p.arte) ? p.cor : corDoBrilho(f.cor1, f.cor2)
  // o card mostra: o estado que a pessoa escolheu ali, o do filtro da lista, o primeiro onde tá à venda ou o 1º do site
  const ufsAVenda = noSite.map((e) => e.uf).filter((uf) => f.estados[uf]?.disponivel)
  const previaUf = (previaEscolhida && ufsSite.includes(previaEscolhida) ? previaEscolhida : null) ?? ufFiltro ?? ufsAVenda[0] ?? ufsSite[0] ?? null
  const previaEstado = previaUf ? noSite.find((e) => e.uf === previaUf) : undefined
  const previaEst = previaUf ? f.estados[previaUf] : undefined
  const previaNo: NoEstado | null = previaEst ? { disponivel: previaEst.disponivel, estoque: previaEst.contar ? (inteiro(previaEst.estoque) ?? 0) : null } : null
  const previaP = { id: p?.id ?? 'novo', nome: f.nome.trim(), cor: corBrilho, arte, foto: f.foto, video: f.video, capa: f.capa, preco: preco ?? null, detalhe: f.detalhe }
  const sit = previaUf && previaNo ? situacao({ ...(p ?? ({} as ProdutoAdmin)), ativo: f.ativo, estados: { [previaUf]: previaNo } } as ProdutoAdmin, previaUf, l.ajustes.restamAte) : null
  const restam = sit === 'acabando' ? (previaNo?.estoque ?? null) : null
  const situacaoPrevia = !f.ativo ? 'desligado' : sit
  const fraseSituacao = !f.ativo ? 'fora do site' : sit === 'acabando' ? `à venda, com “restam ${restam}”` : sit === 'disponivel' ? 'à venda' : sit === 'esgotado' ? 'esgotado (0 no estoque)' : 'fora de venda'
  // o botão do produto novo diz onde ele vai à venda
  const botaoCriar = ufsAVenda.length ? `Criar e pôr à venda em ${listaUfs(ufsAVenda)}` : 'Criar sem pôr à venda'

  /** "Em MG ▾" debaixo do card: de qual estado é o que o card mostra (e troca). */
  const seletorPrevia =
    previaUf && previaEstado ? (
      noSite.length > 1 ? (
        <label className="pn-previa-em">
          <span className="sr-only">O card mostra como fica em</span>
          <select className="pn-input pn-select pn-previa-em-sel px" value={previaUf} onChange={(e) => setPreviaEscolhida(e.target.value)}>
            {noSite.map((e) => (
              <option key={e.uf} value={e.uf}>
                Em {e.uf.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="pn-previa-em pn-previa-em-txt px">Em {previaUf.toUpperCase()}</p>
      )
    ) : null

  const linhaOnde = (e: EstadoAdmin) => {
    const x = f.estados[e.uf] ?? { disponivel: false, contar: false, estoque: '' }
    const set = (n: Partial<FormEstado>) => mudar('estados', { ...f.estados, [e.uf]: { ...x, ...n } })
    const erro = erroDe(`est-${e.uf}`)
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
  }

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
                    setErroServidor({})
                    setPreviaEscolhida(null)
                    const limpo = p ? doProduto(p, l) : novo(l, ufFiltro)
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
          {!f.ativo && <Aviso tipo="info">Fora do site: só tu vê esse produto. Pra voltar, liga o “Aparece no site” em Mais detalhes.</Aviso>}

          {/* ── o básico ── */}
          <Secao titulo="Foto" id="s-foto">
            <FotoProduto
              foto={f.foto}
              nome={f.nome.trim()}
              preco={preco ?? null}
              cor={corBrilho}
              aoMudar={(foto, cor) => setF((s) => (s ? { ...s, foto, corFoto: foto ? cor : null } : s))}
              previa={
                <>
                  <PreviaCard p={previaP} situacao={situacaoPrevia} restam={restam} largura={124} />
                  {seletorPrevia}
                </>
              }
              semFoto={temIlustracao ? 'Sem foto, vale a ilustração do site (a do card).' : 'Sem foto, vale o desenho em pixel (Mais detalhes › Desenho).'}
            />
            <VideoProduto
              compacto
              video={f.video}
              capa={f.capa}
              nome={f.nome.trim()}
              preco={preco ?? null}
              cor={corBrilho}
              aoMudar={(v) => setF((s) => (s ? { ...s, video: v?.video ?? null, capa: v?.capa ?? null } : s))}
            />
          </Secao>

          <Secao titulo="Nome e preço" id="s-produto">
            <Campo id="p-nome" rotulo="Nome" erro={erroDe('nome')} lado={<span className="pn-contagem">{tamanho(f.nome)}/60</span>}>
              {(a) => <input {...a} name="nome" className="pn-input" autoComplete="off" maxLength={60} placeholder="Ex.: Fanta Ghost Face Punch" value={f.nome} onChange={(e) => mudar('nome', e.target.value)} />}
            </Campo>
            <div className="pn-dupla pn-dupla-basico">
              <Campo id="p-categoria" rotulo="Categoria" erro={erroDe('categoria')}>
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
              <Campo id="p-preco" rotulo="Preço" erro={erroDe('preco')} dica="Vazio = “Consultar” no site.">
                {(a) => <Reais id={a.id} rotulo="Preço da unidade" erro={!!a['aria-invalid']} valor={f.preco} aoMudar={(v) => mudar('preco', v)} placeholder="Consultar" />}
              </Campo>
            </div>
          </Secao>

          <Secao
            titulo="Onde tem"
            id="s-estados"
            dica={ufsAVenda.length ? `À venda em ${listaUfs(ufsAVenda)}. Contando o estoque, chegou a 0 sai do site sozinho e volta quando tu põe mais.` : 'Liga os estados onde tem: sem nenhum, o produto fica fora de venda no site.'}
          >
            <ul className="pn-onde">{estados.map(linhaOnde)}</ul>
            {erroDe('estados') && <Aviso tipo="erro">{erroDe('estados')}</Aviso>}
          </Secao>

          {/* ── o resto, em "Mais detalhes" ── */}
          <div className={`pn-detalhes${detalhes ? ' aberto' : ''}`}>
            <button type="button" className="pn-detalhes-botao toque" aria-expanded={detalhes} aria-controls="p-detalhes" onClick={() => setDetalhes(!detalhes)}>
              <span className="pn-detalhes-txt">
                <strong>Mais detalhes</strong>
                <small>{erroEmDetalhes && !detalhes ? 'Tem coisa pra arrumar aqui' : resumoDetalhes(f)}</small>
              </span>
              <Ic nome={detalhes ? 'chevron-cima' : 'chevron-baixo'} tamanho={16} />
            </button>
          </div>
          {detalhes && (
            <div id="p-detalhes" className="pn-detalhes-corpo">
              <Secao titulo="Detalhes" id="s-detalhes">
                <Campo id="p-tamanho" rotulo="Tamanho" erro={erroDe('tamanho')} dica="Ex.: 350 ml, 1 L, 55 mm. Vai junto do nome na mensagem do pedido." lado={<span className="pn-opcional">opcional</span>}>
                  {(a) => <input {...a} name="tamanho" className="pn-input" autoComplete="off" maxLength={20} value={f.tamanho} onChange={(e) => mudar('tamanho', e.target.value)} />}
                </Campo>
                <Campo id="p-detalhe" rotulo="Linha de baixo" erro={erroDe('detalhe')} dica="Aparece embaixo do nome no story e na página (ex.: Lata 350 ml · importada)." lado={<span className="pn-opcional">opcional</span>}>
                  {(a) => <input {...a} name="detalhe" className="pn-input" autoComplete="off" maxLength={60} value={f.detalhe} onChange={(e) => mudar('detalhe', e.target.value)} />}
                </Campo>
                <Campo id="p-descricao" rotulo="Descrição" erro={erroDe('descricao')} dica="1 ou 2 frases do produto, na página dele. Sem promessa de preço, frete ou prazo." lado={<span className="pn-contagem">{tamanho(f.descricao)}/300</span>}>
                  {(a) => <textarea {...a} name="descricao" className="pn-input pn-texto" rows={3} maxLength={300} value={f.descricao} onChange={(e) => mudar('descricao', e.target.value)} />}
                </Campo>
              </Secao>

              <Secao titulo="Combos" id="s-combos" dica="Ex.: 2 por R$ 14,99. A sacola do site aplica o melhor preço sozinha.">
                {f.combos.map((c, i) => {
                  const q = inteiro(c.qtd)
                  const t = lerReais(c.total)
                  const eco = q && t != null && preco != null ? q * preco - t : null
                  const erro = erroDe(`combo-${i}`)
                  return (
                    <div key={i} className={`pn-linha-combo${erro ? ' pn-campo-erro' : ''}`}>
                      <input
                        id={`p-combo-qtd-${i}`}
                        className="pn-input pn-input-num"
                        inputMode="numeric"
                        aria-label={`Combo ${i + 1}: quantidade`}
                        value={c.qtd}
                        onChange={(e) => mudar('combos', f.combos.map((x, j) => (j === i ? { ...x, qtd: e.target.value.replace(/\D/g, '').slice(0, 2) } : x)))}
                      />
                      <span className="pn-linha-combo-por">por</span>
                      <Reais id={`p-combo-total-${i}`} rotulo={`Combo ${i + 1}: preço`} valor={c.total} aoMudar={(v) => mudar('combos', f.combos.map((x, j) => (j === i ? { ...x, total: v } : x)))} />
                      <button type="button" className="icone-botao" aria-label={`Tirar o combo ${i + 1}`} onClick={() => mudar('combos', f.combos.filter((_, j) => j !== i))}>
                        <Ic nome="lixo" tamanho={16} />
                      </button>
                      {erro ? (
                        <p className="pn-erro pn-linha-combo-msg">
                          <Ic nome="atencao" tamanho={16} />
                          <span>{erro}</span>
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

              <Secao titulo="Variações" id="s-variacoes" dica="Sabor, tamanho ou modelo (ex.: Flat · 6 mm e Slim · 7 mm). O cliente escolhe na página do produto. Preço vazio = o do produto.">
                {f.variacoes.map((v, i) => {
                  const erro = erroDe(`var-${i}`)
                  return (
                    <div key={v.id ?? `n${i}`} className={`pn-linha-var${erro ? ' pn-campo-erro' : ''}`}>
                      <input id={`p-var-${i}`} className="pn-input" aria-label={`Variação ${i + 1}: nome`} maxLength={40} placeholder="Nome" value={v.nome} onChange={(e) => mudar('variacoes', f.variacoes.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)))} />
                      <Reais id={`p-var-preco-${i}`} rotulo={`Variação ${i + 1}: preço (opcional)`} valor={v.preco} aoMudar={(x) => mudar('variacoes', f.variacoes.map((y, j) => (j === i ? { ...y, preco: x } : y)))} />
                      <button type="button" className="icone-botao" aria-label={`Tirar a variação ${v.nome || i + 1}`} onClick={() => mudar('variacoes', f.variacoes.filter((_, j) => j !== i))}>
                        <Ic nome="lixo" tamanho={16} />
                      </button>
                      {erro && (
                        <p className="pn-erro pn-linha-combo-msg">
                          <Ic nome="atencao" tamanho={16} />
                          <span>{erro}</span>
                        </p>
                      )}
                    </div>
                  )
                })}
                {f.variacoes.length < 12 && (
                  <Botao variante="cinza" icone="mais" onClick={() => mudar('variacoes', [...f.variacoes, { nome: '', preco: '' }])}>
                    Adicionar variação
                  </Botao>
                )}
              </Secao>

              <Secao titulo="Combina com" id="s-combina">
                <EscolherCombina l={l} proprio={p?.id ?? null} ids={f.combinaCom} aoMudar={(v) => mudar('combinaCom', v)} />
              </Secao>

              <Secao titulo="Desenho" id="s-desenho" dica={f.foto ? 'Com foto, o desenho só aparece no chiado que o site faz antes de mostrar a foto.' : temIlustracao ? 'Esse produto tem a ilustração do site: o formato e as cores daqui só valem se ela sair.' : 'Sem foto, é esse desenho em pixel que aparece no site.'}>
                <div className="pn-desenho">
                  <ArteProduto produto={{ id: `${p?.id ?? 'novo'}-desenho`, nome: f.nome, cor: corBrilho, arte, foto: null }} largura={72} />
                  <div className="pn-desenho-campos">
                    <Campo id={`${idDesenho}-formato`} rotulo="Formato" erro={erroDe('arte')}>
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
                <Campo id="p-obs" rotulo="Anotação só tua" erro={erroDe('obs')} dica="Não aparece no site (ex.: visto no story de MG, preço a confirmar)." lado={<span className="pn-contagem">{tamanho(f.obs)}/300</span>}>
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
          )}
        </div>

        <aside className="pn-editar-previa" aria-labelledby="h-previa-p">
          <h2 id="h-previa-p" className="pn-h2">
            Como fica no site
          </h2>
          {noSite.length > 1 && (
            <div className="pn-filtros pn-previa-ufs" role="group" aria-label="Ver como fica em">
              {noSite.map((e) => (
                <button key={e.uf} type="button" className={`pn-filtro px${previaUf === e.uf ? ' on' : ''}`} aria-pressed={previaUf === e.uf} aria-label={`Como fica em ${e.nome}`} onClick={() => setPreviaEscolhida(e.uf)}>
                  {e.uf.toUpperCase()}
                </button>
              ))}
            </div>
          )}
          <div className="pn-previa-card">
            <PreviaCard p={previaP} situacao={situacaoPrevia} restam={restam} />
          </div>
          <p className="pn-dica-bloco pn-previa-legenda-p">
            {!f.ativo ? 'Fora do site: não aparece pra ninguém.' : previaEstado ? `Em ${previaEstado.nome}: ${fraseSituacao}.` : ''}
            {cat?.bebida === false && ' Pode ser prêmio do Teste minha sorte.'}
          </p>
        </aside>

        <div className="pn-editar-pe">
          {geral && <Aviso tipo="erro">{geral}</Aviso>}
          {/* editando sem mudar nada: o botão espera (como no estado) */}
          <Botao type="submit" largo ocupado={salvando} disabled={!!p && !mexeu}>
            {p ? 'Salvar' : botaoCriar}
          </Botao>
        </div>
      </form>
      <Confirmar pedido={confirmacao} aoFechar={() => setConfirmacao(null)} />
    </>
  )
}
