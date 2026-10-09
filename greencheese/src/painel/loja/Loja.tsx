// Loja: a porta das partes da loja (produtos, estados, stories do Início, categorias, Teste minha sorte) e os ajustes
// que valem pro site todo: o WhatsApp da loja (e se todos os estados usam ele), o "restam X", os textos da loja
// (bio do perfil, frase do story, sacola vazia, falas do mercador) e o "apagar dados de exemplo".
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ErroApi, mensagemDe } from '../api'
import { Confirmar, type PedidoConfirmacao } from '../Confirmar'
import { whatsappBonito } from '../formato'
import { Link, Topo } from '../Moldura'
import { caminho } from '../rotas'
import { useRestaurarRolagem, useTitulo } from '../telas/comum'
import { Aviso, Botao, Campo, Carregando, Ic, Numero, TituloTela } from '../ui'
import * as api from './api'
import { contagens, estadosNoSite, guardarLoja, useLoja } from './dados'
import type { LojaAdmin, PlanoExemplos } from './tipos'
import { lerWhatsapp, problemaNoTexto, tamanho } from './validar'

interface Form {
  whatsapp: string
  mesmo: boolean
  restamLigado: boolean
  restamAte: string
  bio: string[]
  fraseStory: string
  sacolaVazia: string
  falas: string[]
}

type Erros = Partial<Record<string, string>>

function doServidor(l: LojaAdmin): Form {
  return {
    whatsapp: whatsappBonito(l.ajustes.whatsapp),
    mesmo: l.ajustes.mesmoWhatsappParaTodos,
    restamLigado: l.ajustes.restamAte != null,
    restamAte: String(l.ajustes.restamAte ?? 5),
    bio: [...l.textos.bio, '', '', ''].slice(0, 3),
    fraseStory: l.textos.fraseStory,
    sacolaVazia: l.textos.sacolaVazia,
    falas: [...l.textos.falasMercado, '', '', '', '', ''].slice(0, 5),
  }
}

function validar(f: Form): Erros {
  const e: Erros = {}
  if (!lerWhatsapp(f.whatsapp)) e.whatsapp = 'Esse WhatsApp não fecha. Põe DDD + 9 dígitos.'
  const n = /^\d{1,2}$/.test(f.restamAte) ? Number(f.restamAte) : 0
  if (f.restamLigado && (n < 1 || n > 99)) e.restamAte = 'De 1 a 99 unidades.'
  const bio = f.bio.map((x) => x.trim()).filter(Boolean)
  if (!bio.length) e.bio = 'A bio tem de 1 a 3 linhas.'
  else if (bio.some((x) => tamanho(x) > 80)) e.bio = 'Cada linha até 80 letras.'
  else if (tamanho(bio.join('\n')) > 150) e.bio = 'A bio inteira até 150 letras (como a do Instagram).'
  else e.bio = problemaNoTexto(bio.join(' · '), true) ?? undefined
  if (tamanho(f.fraseStory) < 2 || tamanho(f.fraseStory) > 28) e.fraseStory = 'A frase do story de 2 a 28 letras.'
  else e.fraseStory = problemaNoTexto(f.fraseStory, true) ?? undefined
  if (tamanho(f.sacolaVazia) < 2 || tamanho(f.sacolaVazia) > 48) e.sacolaVazia = 'O texto da sacola vazia de 2 a 48 letras.'
  else e.sacolaVazia = problemaNoTexto(f.sacolaVazia, true) ?? undefined
  const falas = f.falas.map((x) => x.trim()).filter(Boolean)
  if (!falas.length) e.falas = 'Pelo menos 1 fala do mercador.'
  else if (falas.some((x) => tamanho(x) > 32)) e.falas = 'Cada fala até 32 letras (cabe no balão).'
  else e.falas = problemaNoTexto(falas.join(' · '), true) ?? undefined
  for (const k of Object.keys(e)) if (!e[k]) delete e[k]
  return e
}

/** As partes da loja, cada uma com o resumo de agora. */
function Portas({ l }: { l: LojaAdmin }) {
  const c = contagens(l)
  const noSite = estadosNoSite(l)
  const escolhidos = noSite.filter((e) => l.stories[e.uf]?.length).map((e) => e.uf.toUpperCase())
  const premiosNoJogo = l.sorte.premios.filter((p) => p.noSite).length
  const itens = [
    { href: caminho.produtos, icone: 'sacola', nome: 'Produtos', sub: `${c.noSite} no site${c.esgotados ? ` · ${c.esgotados} esgotado${c.esgotados === 1 ? '' : 's'}` : ''}${c.fora ? ` · ${c.fora} fora` : ''}` },
    { href: caminho.estados, icone: 'pin', nome: 'Estados', sub: noSite.length ? `No site: ${noSite.map((e) => e.uf.toUpperCase()).join(' · ')}` : 'Nenhum no site' },
    { href: caminho.stories, icone: 'estrela', nome: 'Stories do Início', sub: escolhidos.length ? `Escolhidos em ${escolhidos.join(', ')}; o resto no automático` : 'Todos no automático (os à venda no estado)' },
    { href: caminho.categorias, icone: 'tudo', nome: 'Categorias', sub: l.categorias.map((x) => x.curto).join(' · ') },
    { href: caminho.sorte, icone: 'dichavador', nome: 'Teste minha sorte', sub: l.sorte.ligado ? `${premiosNoJogo === 1 ? '1 prêmio' : `${premiosNoJogo} prêmios`} no jogo` : 'Desligado' },
  ]
  return (
    <ul className="pn-menu pn-portas">
      {itens.map((x) => (
        <li key={x.href}>
          <Link href={x.href} className="pn-menu-item toque">
            <Ic nome={x.icone} tamanho={24} />
            <span className="pn-porta-txt">
              <strong>{x.nome}</strong>
              <small>{x.sub}</small>
            </span>
            <Ic nome="chevron-dir" tamanho={16} />
          </Link>
        </li>
      ))}
    </ul>
  )
}

function textoDoPlano(p: PlanoExemplos): string[] {
  const linhas: string[] = []
  if (p.produtos.length) linhas.push(`${p.produtos.length === 1 ? '1 produto' : `${p.produtos.length} produtos`}: ${p.produtos.map((x) => x.nome).join(', ')}`)
  if (p.desativar.length) linhas.push(`Saem do site (têm histórico de verdade): ${p.desativar.map((x) => x.nome).join(', ')}`)
  if (p.premios.length) linhas.push(`${p.premios.length === 1 ? '1 prêmio' : `${p.premios.length} prêmios`} do Teste minha sorte: ${p.premios.map((x) => x.titulo).join(', ')}`)
  for (const r of p.rateios) linhas.push(`O rateio “${r.titulo}”${r.pessoas ? ` com ${r.pessoas === 1 ? '1 pessoa' : `${r.pessoas} pessoas`} dentro (os dados delas saem junto)` : ''}`)
  return linhas
}

export function Loja() {
  useTitulo('Loja')
  const leitura = useLoja()
  const l = leitura.dados
  const [f, setF] = useState<Form | null>(null)
  const antes = useRef<string | null>(null)
  const versao = useRef<number | null>(null)
  const [erros, setErros] = useState<Erros>({})
  const [geral, setGeral] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [conferindo, setConferindo] = useState(false)
  const [confirmacao, setConfirmacao] = useState<PedidoConfirmacao | null>(null)
  useRestaurarRolagem(!!l)

  // o formulário segue o servidor enquanto ninguém mexeu nele (mudou em outro aparelho: atualiza)
  useEffect(() => {
    if (!l) return
    const limpo = doServidor(l)
    const atual = f ? JSON.stringify(f) : null
    if (!f || atual === antes.current || versao.current === null) {
      setF(limpo)
      antes.current = JSON.stringify(limpo)
    }
    versao.current = l.versao
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [l?.versao])

  const mudar = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF((s) => (s ? { ...s, [k]: v } : s))
    setOk(null)
    if (erros[k as string]) setErros((e) => ({ ...e, [k]: undefined }))
  }
  const mexeu = !!f && JSON.stringify(f) !== antes.current

  const salvar = async (ev?: FormEvent) => {
    ev?.preventDefault()
    if (!f || !l || salvando) return
    const e = validar(f)
    setErros(e)
    setGeral(null)
    const primeiro = Object.keys(e)[0]
    if (primeiro) {
      const id = primeiro === 'bio' ? 'l-bio-0' : primeiro === 'falas' ? 'l-fala-0' : `l-${primeiro}`
      const el = document.getElementById(id)
      el?.focus()
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      return
    }
    setSalvando(true)
    try {
      const r = await api.salvarLoja({
        whatsapp: lerWhatsapp(f.whatsapp) ?? undefined,
        mesmoWhatsappParaTodos: f.mesmo,
        restamAte: f.restamLigado ? Number(f.restamAte) : null,
        textos: {
          bio: f.bio.map((x) => x.trim()).filter(Boolean),
          fraseStory: f.fraseStory.trim(),
          sacolaVazia: f.sacolaVazia.trim(),
          falasMercado: f.falas.map((x) => x.trim()).filter(Boolean),
        },
      })
      const novo = (x: LojaAdmin): LojaAdmin => ({ ...x, versao: r.versao, atualizadoEm: r.atualizadoEm, ajustes: r.ajustes, textos: r.textos })
      guardarLoja(novo)
      leitura.trocar(novo)
      const limpo = doServidor(novo(l))
      setF(limpo)
      antes.current = JSON.stringify(limpo)
      setOk('Salvo. O site já mostra.')
    } catch (err) {
      if (err instanceof ErroApi && err.campo) {
        const c = err.campo === 'falasMercado' ? 'falas' : err.campo
        setErros({ [c]: err.message })
      } else setGeral(mensagemDe(err))
    } finally {
      setSalvando(false)
    }
  }

  const apagarExemplos = async () => {
    if (conferindo) return
    setConferindo(true)
    setGeral(null)
    try {
      const { plano } = await api.exemplos(true)
      const linhas = textoDoPlano(plano)
      if (!linhas.length) {
        setOk('Não tem mais nada de exemplo.')
        return
      }
      setConfirmacao({
        titulo: 'Apagar os dados de exemplo?',
        texto: 'Sai de vez (não volta):',
        detalhes: (
          <ul className="pn-plano">
            {linhas.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        ),
        botao: 'Apagar os de exemplo',
        perigo: true,
        acao: async () => {
          await api.exemplos(false)
          await leitura.recarregar()
          setOk('Dados de exemplo apagados. O site já não mostra.')
        },
      })
    } catch (e) {
      setGeral(mensagemDe(e))
    } finally {
      setConferindo(false)
    }
  }

  const proprios = l ? l.estados.filter((e) => e.whatsapp) : []
  return (
    <>
      <Topo titulo={<TituloTela>Loja</TituloTela>} />
      <div className="pn-pagina pn-pagina-estreita pn-loja">
        {leitura.erro && !l && <Aviso tipo="erro">{leitura.erro.message}</Aviso>}
        {!l && !leitura.erro && <Carregando />}
        {l && f && (
          <>
            <section className="pn-bloco" aria-label="Partes da loja">
              <Portas l={l} />
            </section>

            <form onSubmit={(ev) => void salvar(ev)} noValidate>
              <section className="pn-bloco" aria-labelledby="h-l-whats">
                <h2 id="h-l-whats" className="pn-h2">
                  WhatsApp do pedido
                </h2>
                <Campo id="l-whatsapp" rotulo="WhatsApp da loja" erro={erros.whatsapp} dica="Onde o pedido guiado fecha (o cliente só vê no último passo).">
                  {(a) => <input {...a} name="whatsapp" className="pn-input" type="tel" inputMode="tel" autoComplete="off" value={f.whatsapp} onChange={(e) => mudar('whatsapp', e.target.value)} />}
                </Campo>
                <label className="pn-troca">
                  <input id="l-mesmo" type="checkbox" checked={f.mesmo} onChange={(e) => mudar('mesmo', e.target.checked)} />
                  <span className="pn-troca-marca" aria-hidden="true" />
                  <span>O mesmo WhatsApp pra todos os estados</span>
                </label>
                <p className="pn-dica-bloco">
                  {f.mesmo
                    ? proprios.length
                      ? `Ligado: o número próprio de ${proprios.map((e) => e.uf.toUpperCase()).join(', ')} fica guardado e não vale agora.`
                      : 'Ligado: todo pedido fecha nesse número.'
                    : proprios.length
                      ? `Desligado: ${proprios.map((e) => `${e.uf.toUpperCase()} fecha no ${whatsappBonito(e.whatsapp!)}`).join(', ')}; o resto, no da loja.`
                      : 'Desligado: cada estado pode ter um número próprio (Estados). Hoje nenhum tem, então todos fecham no da loja.'}
                </p>
              </section>

              <section className="pn-bloco" aria-labelledby="h-l-restam">
                <h2 id="h-l-restam" className="pn-h2">
                  “Restam X”
                </h2>
                <label className="pn-troca">
                  <input id="l-restam" type="checkbox" checked={f.restamLigado} onChange={(e) => mudar('restamLigado', e.target.checked)} />
                  <span className="pn-troca-marca" aria-hidden="true" />
                  <span>Mostrar “restam X” quando tá acabando</span>
                </label>
                {f.restamLigado && (
                  <Campo id="l-restamAte" rotulo="A partir de" erro={erros.restamAte} dica="Só nos produtos com o estoque contado (Produtos → escolhe o estado → Contar estoque).">
                    {(a) => <Numero aria={a} valor={f.restamAte} aoMudar={(v) => mudar('restamAte', v.slice(0, 2))} min={1} max={99} sufixo="ou menos" rotuloMenos="Uma unidade a menos" rotuloMais="Uma unidade a mais" />}
                  </Campo>
                )}
              </section>

              <section className="pn-bloco" aria-labelledby="h-l-textos">
                <h2 id="h-l-textos" className="pn-h2">
                  Textos da loja
                </h2>
                <p className="pn-dica-bloco">Curtos, na voz da loja. Sem promessa (grátis, frete, prazo) e sem gíria da lista do site.</p>
                <div className={`pn-campo${erros.bio ? ' pn-campo-erro' : ''}`}>
                  <div className="pn-rotulo-linha">
                    <label className="pn-rotulo" htmlFor="l-bio-0">
                      Bio do perfil
                    </label>
                    <span className="pn-contagem">até 3 linhas</span>
                  </div>
                  <div className="pn-linhas">
                    {f.bio.map((x, i) => (
                      <input key={i} id={`l-bio-${i}`} className="pn-input" maxLength={80} aria-label={i ? `Bio do perfil, linha ${i + 1}` : undefined} aria-describedby={erros.bio ? 'l-bio-erro' : undefined} placeholder={i ? 'opcional' : ''} value={x} onChange={(e) => mudar('bio', f.bio.map((y, j) => (j === i ? e.target.value : y)))} />
                    ))}
                  </div>
                  {erros.bio && (
                    <p id="l-bio-erro" className="pn-erro">
                      <Ic nome="atencao" tamanho={16} />
                      <span>{erros.bio}</span>
                    </p>
                  )}
                </div>
                <Campo id="l-fraseStory" rotulo="Frase do story do Início" erro={erros.fraseStory} dica="O adesivo de texto do story (no dia de entrega grátis do estado, vale a frase dele)." lado={<span className="pn-contagem">{tamanho(f.fraseStory)}/28</span>}>
                  {(a) => <input {...a} name="fraseStory" className="pn-input" maxLength={28} value={f.fraseStory} onChange={(e) => mudar('fraseStory', e.target.value)} />}
                </Campo>
                <Campo id="l-sacolaVazia" rotulo="Sacola vazia" erro={erros.sacolaVazia} dica="Embaixo do mercador, quando a sacola tá vazia." lado={<span className="pn-contagem">{tamanho(f.sacolaVazia)}/48</span>}>
                  {(a) => <input {...a} name="sacolaVazia" className="pn-input" maxLength={48} value={f.sacolaVazia} onChange={(e) => mudar('sacolaVazia', e.target.value)} />}
                </Campo>
                <div className={`pn-campo${erros.falas ? ' pn-campo-erro' : ''}`}>
                  <div className="pn-rotulo-linha">
                    <label className="pn-rotulo" htmlFor="l-fala-0">
                      Falas do mercador
                    </label>
                    <span className="pn-contagem">no topo do Mercado, uma por toque</span>
                  </div>
                  <div className="pn-linhas">
                    {f.falas.map((x, i) => (
                      <input key={i} id={`l-fala-${i}`} className="pn-input" maxLength={32} aria-label={i ? `Fala ${i + 1}` : undefined} aria-describedby={erros.falas ? 'l-falas-erro' : undefined} placeholder={i ? 'opcional' : ''} value={x} onChange={(e) => mudar('falas', f.falas.map((y, j) => (j === i ? e.target.value : y)))} />
                    ))}
                  </div>
                  {erros.falas && (
                    <p id="l-falas-erro" className="pn-erro">
                      <Ic nome="atencao" tamanho={16} />
                      <span>{erros.falas}</span>
                    </p>
                  )}
                </div>
              </section>

              {(mexeu || ok || geral) && (
                <div className="pn-editar-pe pn-pe-fixo">
                  {geral && <Aviso tipo="erro">{geral}</Aviso>}
                  {ok && !mexeu && <Aviso tipo="ok">{ok}</Aviso>}
                  {mexeu && (
                    <div className="pn-botoes pn-botoes-linha">
                      <Botao
                        variante="cinza"
                        onClick={() => {
                          setF(doServidor(l))
                          setErros({})
                        }}
                        disabled={salvando}
                      >
                        Desfazer
                      </Botao>
                      <Botao type="submit" ocupado={salvando}>
                        Salvar
                      </Botao>
                    </div>
                  )}
                </div>
              )}
            </form>

            <section className="pn-bloco" aria-labelledby="h-l-exemplo">
              <h2 id="h-l-exemplo" className="pn-h2">
                Dados de exemplo
              </h2>
              <p className="pn-dica-bloco">Os produtos, prêmios e rateios marcados como exemplo (os que vieram pra mostrar o site). Quando a loja tiver os de verdade, tira todos de uma vez.</p>
              <Botao variante="perigo" icone="lixo" ocupado={conferindo} onClick={() => void apagarExemplos()}>
                Apagar dados de exemplo
              </Botao>
            </section>
          </>
        )}
      </div>
      <Confirmar pedido={confirmacao} aoFechar={() => setConfirmacao(null)} />
    </>
  )
}
