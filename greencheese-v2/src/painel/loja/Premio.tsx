// Prêmio do Teste minha sorte (criar e editar), com a conferência ao vivo das regras do site (src/lib/cupom.ts): só
// acessório (bebida e categoria de bebida nunca), percentual de 1 a 50, leva mais que paga, validade de 1 a 30 dias,
// peso > 0 e nenhuma palavra da lista. A raridade em 4 fichas coloridas, com a chance real de sair (a mesma conta do
// servidor, com os outros prêmios no jogo); o peso dentro da raridade fica em "Mais detalhes". A prévia é o story do
// prêmio como a pessoa vê, e "Testar a animação" abre a revelação do site por cima (sem contar giro).
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ErroApi, mensagemDe } from '../api'
import { Confirmar, type PedidoConfirmacao } from '../Confirmar'
import { Topo } from '../Moldura'
import { caminho, ir, voltar } from '../rotas'
import { useAvisarAoSair } from '../sair'
import { avisarNaProxima } from '../telas/flash'
import { useTitulo } from '../telas/comum'
import { Aviso, Botao, Campo, Carregando, Ic, Numero, TituloTela } from '../ui'
import * as api from './api'
import { lembrar, lido } from '../lembrar'
import { INFO_RARIDADE } from '../../lib/raridade'
import { chancesReais } from '../../lib/sorteio'
import { ArteProduto, NomeProduto } from './Arte'
import { comPremio, estadosNoSite, guardarLoja, nomeCompleto, useLoja } from './dados'
import { fraseDoPremio, PreviaPremio } from './premio-ui'
import { FichasRaridade, SeloRaridade, TesteAnimacao, cenaDoPremio, foraDoSite, textoChance } from './sorte-ui'
import type { LojaAdmin, PremioAdmin, PremioCorpo, ProdutoAdmin, Raridade, TipoPremio, ValorPremio } from './tipos'
import { bebidaPeloProduto, problemaNoTexto, tamanho } from './validar'

interface Form {
  tipo: TipoPremio
  percentual: string
  leve: string
  pague: string
  brinde: string
  brindeQtd: string
  produtos: string[]
  categorias: string[]
  titulo: string
  descricao: string
  regra: string
  comoUsar: string
  peso: string
  validadeDias: string
  raridade: Raridade
  ativo: boolean
  demo: boolean
}

type Erros = Partial<Record<string, string>>
const n = (s: string): number | null => (/^\d{1,4}$/.test(s.trim()) ? Number(s.trim()) : null)

function doPremio(p: PremioAdmin): Form {
  const v = p.valor
  return {
    tipo: p.tipo,
    percentual: typeof v === 'number' ? String(v) : '10',
    leve: typeof v === 'object' && 'leve' in v ? String(v.leve) : '4',
    pague: typeof v === 'object' && 'pague' in v ? String(v.pague) : '3',
    brinde: typeof v === 'object' && 'produto' in v ? v.produto : '',
    brindeQtd: typeof v === 'object' && 'qtd' in v ? String(v.qtd) : '1',
    produtos: p.aplicaA.produtos ?? [],
    categorias: p.aplicaA.categorias ?? [],
    titulo: p.titulo,
    descricao: p.descricao,
    regra: p.regra,
    comoUsar: p.comoUsar ?? '',
    peso: String(p.peso),
    validadeDias: String(p.validadeDias),
    raridade: p.raridade,
    ativo: p.ativo,
    demo: p.demo,
  }
}

const NOVO: Form = {
  tipo: 'desconto-percentual',
  percentual: '10',
  leve: '4',
  pague: '3',
  brinde: '',
  brindeQtd: '1',
  produtos: [],
  categorias: [],
  titulo: '',
  descricao: '',
  regra: '',
  comoUsar: '',
  peso: '1',
  validadeDias: '7',
  raridade: 'comum',
  ativo: true,
  demo: false,
}

function valorDo(f: Form): ValorPremio {
  if (f.tipo === 'desconto-percentual') return n(f.percentual) ?? 0
  if (f.tipo === 'leve-x-pague-y') return { leve: n(f.leve) ?? 0, pague: n(f.pague) ?? 0 }
  return { produto: f.brinde, qtd: n(f.brindeQtd) ?? 1 }
}

/** Produto que pode virar prêmio: no ar, fora de categoria de bebida, sem desenho de bebida e sem nome de bebida alcoólica. */
function acessorio(p: ProdutoAdmin, l: LojaAdmin): boolean {
  return !l.categorias.find((c) => c.id === p.categoria)?.bebida && !bebidaPeloProduto(p)
}

function validar(f: Form, l: LojaAdmin): Erros {
  const e: Erros = {}
  if (f.tipo === 'desconto-percentual') {
    const x = n(f.percentual)
    if (x == null || x < 1 || x > 50) e.valor = 'Desconto de 1% a 50%.'
  } else if (f.tipo === 'leve-x-pague-y') {
    const a = n(f.leve)
    const b = n(f.pague)
    if (a == null || b == null || a < 2 || a > 20 || b < 1 || a <= b) e.valor = 'Leva tem que ser mais que paga (ex.: leva 4, paga 3).'
  } else {
    const b = l.produtos.find((p) => p.id === f.brinde)
    const q = n(f.brindeQtd)
    if (!b) e.valor = 'Escolhe o produto que vai de brinde.'
    else if (!acessorio(b, l)) e.valor = `“${b.nome}” é bebida: prêmio só em acessório.`
    else if (q == null || q < 1 || q > 10) e.valor = 'Brinde de 1 a 10 unidades.'
  }
  if (!f.produtos.length && !f.categorias.length) e.aplicaA = 'Escolhe em que produto ou categoria o prêmio vale.'
  for (const id of f.produtos) {
    const p = l.produtos.find((x) => x.id === id)
    if (!p) e.aplicaA = 'Produto não encontrado.'
    else if (!acessorio(p, l)) e.aplicaA = `“${p.nome}” é bebida: prêmio só em acessório.`
  }
  for (const id of f.categorias) if (l.categorias.find((c) => c.id === id)?.bebida) e.aplicaA = 'Categoria de bebida não pode ter prêmio.'
  const textos: [keyof Form, number, number, string][] = [
    ['titulo', 2, 60, 'Nome interno de 2 a 60 letras.'],
    ['descricao', 2, 40, 'A linha de apoio de 2 a 40 letras (até 28 cabe numa linha no celular).'],
    ['regra', 2, 120, 'A regra de 2 a 120 letras (é a frase que vai no WhatsApp).'],
    ['comoUsar', 0, 160, 'Como usar até 160 letras.'],
  ]
  for (const [k, min, max, msg] of textos) {
    const t = String(f[k]).trim()
    if (tamanho(t) < min || tamanho(t) > max) e[k] = msg
    else e[k] = problemaNoTexto(t, true) ?? undefined
  }
  const peso = n(f.peso)
  if (peso == null || peso < 1 || peso > 1000) e.peso = 'Peso de 1 a 1000 (dentro da raridade: quanto maior, mais sai).'
  const v = n(f.validadeDias)
  if (v == null || v < 1 || v > 30) e.validadeDias = 'Validade de 1 a 30 dias.'
  for (const k of Object.keys(e)) if (!e[k]) delete e[k]
  return e
}

function corpo(f: Form, id: string | null): PremioCorpo {
  return {
    ...(id ? { id } : {}),
    tipo: f.tipo,
    valor: valorDo(f),
    aplicaA: { ...(f.produtos.length ? { produtos: f.produtos } : {}), ...(f.categorias.length ? { categorias: f.categorias } : {}) },
    titulo: f.titulo.trim(),
    descricao: f.descricao.trim(),
    regra: f.regra.trim(),
    comoUsar: f.comoUsar.trim(),
    peso: n(f.peso) ?? 1,
    validadeDias: n(f.validadeDias) ?? 7,
    raridade: f.raridade,
    ativo: f.ativo,
    demo: f.demo,
  }
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

const TIPOS: { tipo: TipoPremio; nome: string; sub: string }[] = [
  { tipo: 'desconto-percentual', nome: 'Desconto', sub: '15% OFF num produto ou categoria' },
  { tipo: 'leve-x-pague-y', nome: 'Leva mais, paga menos', sub: 'Leva 4, paga 3' },
  { tipo: 'brinde', nome: 'Brinde', sub: 'Um produto de presente no pedido' },
]

export function Premio({ id }: { id: string | null }) {
  useTitulo(id ? 'Editar prêmio' : 'Novo prêmio')
  const leitura = useLoja(0)
  const l = leitura.dados
  const p = id && l ? (l.sorte.premios.find((x) => x.id === id) ?? null) : null
  const [f, setF] = useState<Form | null>(null)
  const [erros, setErros] = useState<Erros>({})
  const [geral, setGeral] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [tocou, setTocou] = useState<Set<string>>(new Set())
  const [confirmacao, setConfirmacao] = useState<PedidoConfirmacao | null>(null)
  const [teste, setTeste] = useState(false)
  // "Mais detalhes" (o peso dentro da raridade): lembra se ficou aberto
  const [detalhes, setDetalhesBruto] = useState(() => lido('premio-detalhes') === '1')
  const setDetalhes = (v: boolean) => {
    setDetalhesBruto(v)
    lembrar('premio-detalhes', v ? '1' : null)
  }
  const trava = useRef(false)
  const inicial = useRef<string | null>(null)

  useEffect(() => {
    if (f || !l) return
    if (id && !p) return
    const limpo = p ? doPremio(p) : NOVO
    inicial.current = JSON.stringify(limpo)
    setF(limpo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [l, p])

  // sair com mudança pergunta antes (o salvar mora lá embaixo, depois das telas de espera: vai por referência)
  const salvarRef = useRef<(ev?: FormEvent, ficar?: boolean) => Promise<boolean>>(async () => false)
  const { liberar } = useAvisarAoSair(!!f && JSON.stringify(f) !== inicial.current, { salvar: () => salvarRef.current(undefined, true) })

  const titulo = <TituloTela>{id ? 'Editar prêmio' : 'Novo prêmio'}</TituloTela>
  if (l && id && !p) {
    return (
      <>
        <Topo voltar={caminho.sorte} titulo={titulo} />
        <div className="pn-pagina">
          <Aviso tipo="info">Esse prêmio não existe mais.</Aviso>
        </div>
      </>
    )
  }
  if (!f || !l) {
    return (
      <>
        <Topo voltar={caminho.sorte} titulo={titulo} />
        <div className="pn-pagina">{leitura.erro ? <Aviso tipo="erro">{leitura.erro.message}</Aviso> : <Carregando />}</div>
      </>
    )
  }

  // conferência ao vivo: mostra o erro do campo depois que a pessoa mexeu nele (ou tentou salvar)
  const aoVivo = validar(f, l)
  const erroDe = (k: string) => erros[k] ?? (tocou.has(k) ? aoVivo[k] : undefined)
  const mudar = <K extends keyof Form>(k: K, v: Form[K], campo: string = k) => {
    setF((s) => (s ? { ...s, [k]: v } : s))
    setTocou((t) => new Set(t).add(campo))
    if (erros[campo]) setErros((e) => ({ ...e, [campo]: undefined }))
  }
  const aplicaA = { produtos: f.produtos, categorias: f.categorias }
  // o prêmio dito do jeito do site (sem alvo: '' no lugar do nome interno)
  const vivo = fraseDoPremio({ tipo: f.tipo, valor: valorDo(f), titulo: '', aplicaA }, l)
  // a chance real de sair: os prêmios no jogo, com este do jeito que tá no formulário no lugar dele (a mesma conta do
  // servidor: a raridade pela chance dela entre as que têm prêmio, depois o peso dentro dela)
  const noJogo = l.sorte.premios.filter((x) => x.noSite && x.id !== p?.id)
  // não sai agora? Desligado ("Esse prêmio pode sair"), ou o que ele vale tá fora do site (o mesmo motivo da lista da
  // Sorte, com o que tá no formulário: "Bandeja RAW pequena tá fora do site")
  const foraAgora = f.ativo ? foraDoSite({ aplicaA, valor: valorDo(f) }, l) : null
  const esteNoJogo = f.ativo && !foraAgora
  const comEste = esteNoJogo ? [...noJogo, { id: '__este', peso: n(f.peso) ?? 1, raridade: f.raridade }] : noJogo
  const chanceEste = esteNoJogo ? (chancesReais(comEste, l.sorte.chances).get(comEste[comEste.length - 1]) ?? 0) : 0
  const mesmaRaridade = noJogo.filter((x) => x.raridade === f.raridade).length
  const acessorios = l.produtos.filter((x) => x.ativo && acessorio(x, l))
  const categorias = l.categorias.filter((c) => !c.bebida)
  const insta = estadosNoSite(l)[0]?.instagram ?? 'greencheese_imports'

  const salvar = async (ev?: FormEvent, ficar = false): Promise<boolean> => {
    ev?.preventDefault()
    if (salvando || !f || !l) return false
    const e = validar(f, l)
    setErros(e)
    setGeral(null)
    const primeiro = Object.keys(e)[0]
    if (primeiro) {
      const alvo = primeiro === 'valor' ? (f.tipo === 'brinde' ? 'pr-brinde' : f.tipo === 'leve-x-pague-y' ? 'pr-leve' : 'pr-percentual') : primeiro === 'aplicaA' ? 's-pr-vale' : `pr-${primeiro}`
      // o peso mora em "Mais detalhes": abre antes de levar o foco
      const abrir = primeiro === 'peso' && !detalhes
      if (abrir) setDetalhes(true)
      window.setTimeout(() => {
        const el = document.getElementById(alvo)
        el?.focus()
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }, abrir ? 50 : 0)
      return false
    }
    if (trava.current) return false
    trava.current = true
    setSalvando(true)
    try {
      const r = await api.salvarPremio(corpo(f, p?.id ?? null))
      guardarLoja((x) => comPremio(x, r.premio, r))
      avisarNaProxima(p ? `Prêmio salvo.${r.premio.noSite ? ' Já vale no jogo.' : ''}` : `Prêmio criado.${r.premio.noSite ? ' Já tá no jogo.' : ''}`)
      liberar()
      if (!ficar) {
        if (p) voltar(caminho.sorte)
        else ir(caminho.sorte, true)
      }
      return true
    } catch (err) {
      if (err instanceof ErroApi && err.campo) {
        setErros({ [err.campo]: err.message })
        if (err.campo === 'peso') setDetalhes(true)
      } else setGeral(mensagemDe(err))
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
      titulo: 'Apagar esse prêmio?',
      texto: 'Sai do jogo de vez. Quem já ganhou e guardou continua com o cupom.',
      botao: 'Apagar prêmio',
      perigo: true,
      acao: async () => {
        await api.apagarPremio(p.id)
        await leitura.recarregar()
        avisarNaProxima('Prêmio apagado.')
        liberar()
        ir(caminho.sorte, true)
      },
    })
  }

  return (
    <>
      <Topo voltar={caminho.sorte} titulo={titulo} />
      <form className="pn-pagina pn-editar" onSubmit={(e) => void salvar(e)} noValidate>
        <div className="pn-editar-form">
          {/* no celular a prévia fica lá embaixo: aqui em cima o prêmio muda junto com o formulário */}
          <p className="pn-destaque-vivo" aria-live="polite">
            <span className="px">{vivo.destaque}</span>
            <span>{vivo.alvo || 'escolhe em “Vale em”'}</span>
          </p>
          <Secao titulo="O prêmio" id="s-pr-tipo">
            <fieldset className="pn-opcoes">
              <legend className="sr-only">Tipo do prêmio</legend>
              {TIPOS.map((t) => (
                <label key={t.tipo} className="pn-opcao">
                  <input type="radio" name="tipo" checked={f.tipo === t.tipo} onChange={() => mudar('tipo', t.tipo, 'valor')} />
                  <span className="pn-opcao-marca" aria-hidden="true" />
                  <span>
                    {t.nome}
                    <small>{t.sub}</small>
                  </span>
                </label>
              ))}
            </fieldset>
            {f.tipo === 'desconto-percentual' && (
              <Campo id="pr-percentual" rotulo="Desconto" erro={erroDe('valor')}>
                {(a) => <Numero aria={a} valor={f.percentual} aoMudar={(v) => mudar('percentual', v, 'valor')} min={1} max={50} sufixo="%" rotuloMenos="Um por cento a menos" rotuloMais="Um por cento a mais" />}
              </Campo>
            )}
            {f.tipo === 'leve-x-pague-y' && (
              <>
                <div className="pn-dupla">
                  <Campo id="pr-leve" rotulo="Leva">
                    {(a) => <Numero aria={a} valor={f.leve} aoMudar={(v) => mudar('leve', v, 'valor')} min={2} max={20} rotuloMenos="Leva um a menos" rotuloMais="Leva um a mais" />}
                  </Campo>
                  <Campo id="pr-pague" rotulo="Paga">
                    {(a) => <Numero aria={a} valor={f.pague} aoMudar={(v) => mudar('pague', v, 'valor')} min={1} max={19} rotuloMenos="Paga um a menos" rotuloMais="Paga um a mais" />}
                  </Campo>
                </div>
                {erroDe('valor') && (
                  <p className="pn-erro">
                    <Ic nome="atencao" tamanho={16} />
                    <span>{erroDe('valor')}</span>
                  </p>
                )}
              </>
            )}
            {f.tipo === 'brinde' && (
              <div className="pn-dupla pn-dupla-larga">
                <Campo id="pr-brinde" rotulo="Vai de brinde" erro={erroDe('valor')}>
                  {(a) => (
                    <select {...a} className="pn-input pn-select" value={f.brinde} onChange={(e) => mudar('brinde', e.target.value, 'valor')}>
                      <option value="">Escolhe o produto</option>
                      {acessorios.map((x) => (
                        <option key={x.id} value={x.id}>
                          {nomeCompleto(x)}
                        </option>
                      ))}
                    </select>
                  )}
                </Campo>
                <Campo id="pr-brindeQtd" rotulo="Quantos">
                  {(a) => <Numero aria={a} valor={f.brindeQtd} aoMudar={(v) => mudar('brindeQtd', v, 'valor')} min={1} max={10} rotuloMenos="Um a menos" rotuloMais="Um a mais" />}
                </Campo>
              </div>
            )}
          </Secao>

          <Secao titulo="Raridade" id="s-pr-raridade" dica="Quanto mais raro, menos sai e mais caprichada é a animação. A chance de cada raridade fica em Teste minha sorte.">
            <FichasRaridade id="pr-raridade" valor={f.raridade} aoMudar={(r) => mudar('raridade', r)} />
            <p className="pn-chance-este" aria-live="polite">
              {esteNoJogo ? (
                <>
                  <SeloRaridade raridade={f.raridade} />
                  <span>
                    Sai <strong>{textoChance(chanceEste)}</strong> dos giros
                    {l.sorte.chances[f.raridade] === 0 ? ' (essa raridade tá com 0%)' : mesmaRaridade ? `, dividindo o ${INFO_RARIDADE[f.raridade].nome} com ${mesmaRaridade === 1 ? 'mais 1 prêmio' : `mais ${mesmaRaridade} prêmios`}` : ''}.
                  </span>
                </>
              ) : foraAgora ? (
                <span>Não sai agora: {foraAgora}.</span>
              ) : (
                <span>Fora do jogo: não sai até voltar pro jogo.</span>
              )}
            </p>
            {erroDe('raridade') && (
              <p className="pn-erro">
                <Ic nome="atencao" tamanho={16} />
                <span>{erroDe('raridade')}</span>
              </p>
            )}
            <Botao variante="contorno" icone="olho" className="pn-testar-anim" onClick={() => setTeste(true)}>
              Testar a animação
            </Botao>
          </Secao>

          <Secao titulo="Vale em" id="s-pr-vale" dica="O produto (ou a categoria) que tem que estar no pedido. Só acessório: bebida nunca entra.">
            <div className={`pn-campo${erroDe('aplicaA') ? ' pn-campo-erro' : ''}`}>
              <p className="pn-rotulo">Produtos</p>
              <ul className="pn-lista-marcar pn-lista-marcar-curta">
                {acessorios.map((x) => {
                  const on = f.produtos.includes(x.id)
                  return (
                    <li key={x.id}>
                      <label className="pn-marcar">
                        <input type="checkbox" checked={on} onChange={() => mudar('produtos', on ? f.produtos.filter((y) => y !== x.id) : [...f.produtos, x.id], 'aplicaA')} />
                        <span className="pn-marcar-caixa" aria-hidden="true">
                          {on && <Ic nome="check" tamanho={16} />}
                        </span>
                        <ArteProduto produto={x} largura={24} halo={false} />
                        <span>
                          <NomeProduto p={x} />
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
              <p className="pn-rotulo pn-rotulo-espaco">Ou a categoria inteira</p>
              <div className="pn-pagamentos">
                {categorias.map((c) => {
                  const on = f.categorias.includes(c.id)
                  return (
                    <label key={c.id} className="pn-marcar">
                      <input type="checkbox" checked={on} onChange={() => mudar('categorias', on ? f.categorias.filter((y) => y !== c.id) : [...f.categorias, c.id], 'aplicaA')} />
                      <span className="pn-marcar-caixa" aria-hidden="true">
                        {on && <Ic nome="check" tamanho={16} />}
                      </span>
                      <span>{c.nome}</span>
                    </label>
                  )
                })}
              </div>
              {erroDe('aplicaA') && (
                <p className="pn-erro">
                  <Ic nome="atencao" tamanho={16} />
                  <span>{erroDe('aplicaA')}</span>
                </p>
              )}
            </div>
          </Secao>

          <Secao titulo="Textos" id="s-pr-textos" dica="Na voz da loja. Sem promessa (grátis, frete, prazo) nem as palavras da lista do site.">
            <Campo id="pr-descricao" rotulo="Linha de apoio" erro={erroDe('descricao')} dica="1 linha no story, embaixo do prêmio (até 28 letras cabe no celular)." lado={<span className="pn-contagem">{tamanho(f.descricao)}/40</span>}>
              {(a) => <input {...a} name="descricao" className="pn-input" maxLength={40} placeholder="Uma OCB por conta da sorte." value={f.descricao} onChange={(e) => mudar('descricao', e.target.value)} />}
            </Campo>
            <Campo id="pr-regra" rotulo="Regra" erro={erroDe('regra')} dica="A frase completa: vai na linha do cupom no WhatsApp e no “Ver condições”." lado={<span className="pn-contagem">{tamanho(f.regra)}/120</span>}>
              {(a) => <input {...a} name="regra" className="pn-input" maxLength={120} placeholder="Leva 4 Seda OCB Premium Slim e paga 3" value={f.regra} onChange={(e) => mudar('regra', e.target.value)} />}
            </Campo>
            <Campo id="pr-comoUsar" rotulo="Como usar" erro={erroDe('comoUsar')} lado={<span className="pn-opcional">opcional</span>}>
              {(a) => <input {...a} name="comoUsar" className="pn-input" maxLength={160} placeholder="Põe 4 na sacola e usa o cupom." value={f.comoUsar} onChange={(e) => mudar('comoUsar', e.target.value)} />}
            </Campo>
            <Campo id="pr-titulo" rotulo="Nome interno" erro={erroDe('titulo')} dica="Só no painel (no site o prêmio aparece como o destaque + o produto)." lado={<span className="pn-contagem">{tamanho(f.titulo)}/60</span>}>
              {(a) => <input {...a} name="titulo" className="pn-input" maxLength={60} placeholder="4 por 3 na OCB" value={f.titulo} onChange={(e) => mudar('titulo', e.target.value)} />}
            </Campo>
          </Secao>

          <Secao titulo="Validade" id="s-pr-validade">
            <Campo id="pr-validadeDias" rotulo="Vale por" erro={erroDe('validadeDias')} dica="Conta de quando a pessoa guarda.">
              {(a) => <Numero aria={a} valor={f.validadeDias} aoMudar={(v) => mudar('validadeDias', v)} min={1} max={30} sufixo="dias" rotuloMenos="Um dia a menos" rotuloMais="Um dia a mais" />}
            </Campo>
          </Secao>

          <Secao titulo="No jogo" id="s-pr-jogo">
            <label className="pn-troca">
              <input type="checkbox" checked={f.ativo} onChange={(e) => mudar('ativo', e.target.checked)} />
              <span className="pn-troca-marca" aria-hidden="true" />
              <span>Esse prêmio pode sair</span>
            </label>
            <label className="pn-troca">
              <input type="checkbox" checked={f.demo} onChange={(e) => mudar('demo', e.target.checked)} />
              <span className="pn-troca-marca" aria-hidden="true" />
              <span>Prêmio de exemplo</span>
            </label>
          </Secao>

          {/* ── o ajuste fino, em "Mais detalhes" ── */}
          <div className={`pn-detalhes${detalhes ? ' aberto' : ''}`}>
            <button type="button" className="pn-detalhes-botao toque" aria-expanded={detalhes} aria-controls="pr-detalhes" onClick={() => setDetalhes(!detalhes)}>
              <span className="pn-detalhes-txt">
                <strong>Mais detalhes</strong>
                <small>{erroDe('peso') && !detalhes ? 'Tem coisa pra arrumar aqui' : `Peso dentro da raridade: ${f.peso || '1'}${p ? ' · apagar' : ''}`}</small>
              </span>
              <Ic nome={detalhes ? 'chevron-cima' : 'chevron-baixo'} tamanho={16} />
            </button>
          </div>
          {detalhes && (
            <div id="pr-detalhes" className="pn-detalhes-corpo">
              <Secao titulo="Peso dentro da raridade" id="s-pr-peso" dica="Só faz diferença quando tem mais de um prêmio na mesma raridade: peso 2 sai o dobro de um prêmio de peso 1.">
                <Campo id="pr-peso" rotulo="Peso" erro={erroDe('peso')}>
                  {(a) => <Numero aria={a} valor={f.peso} aoMudar={(v) => mudar('peso', v)} min={1} max={1000} rotuloMenos="Peso menor" rotuloMais="Peso maior" />}
                </Campo>
              </Secao>
              {p && (
                <div className="pn-apagar">
                  <Botao variante="perigo" icone="lixo" onClick={pedirApagar}>
                    Apagar prêmio
                  </Botao>
                </div>
              )}
            </div>
          )}
        </div>

        <aside className="pn-editar-previa" aria-labelledby="h-pr-previa">
          <h2 id="h-pr-previa" className="pn-h2">
            Como aparece
          </h2>
          <div className="pn-previa-card">
            <PreviaPremio p={{ tipo: f.tipo, valor: valorDo(f), titulo: f.titulo, aplicaA, descricao: f.descricao.trim() }} l={l} instagram={insta} />
          </div>
          <p className="pn-dica-bloco">O story do prêmio, quando o dichavador abre. O código e a validade entram nos adesivos de baixo.</p>
        </aside>

        <div className="pn-editar-pe">
          {geral && <Aviso tipo="erro">{geral}</Aviso>}
          <Botao type="submit" largo ocupado={salvando} disabled={!!p && JSON.stringify(f) === inicial.current}>
            {p ? 'Salvar' : 'Criar prêmio'}
          </Botao>
        </div>
      </form>
      <Confirmar pedido={confirmacao} aoFechar={() => setConfirmacao(null)} />
      {teste && <TesteAnimacao cenas={[cenaDoPremio({ tipo: f.tipo, valor: valorDo(f), titulo: f.titulo, aplicaA, raridade: f.raridade }, l)]} aoFechar={() => setTeste(false)} />}
    </>
  )
}
