import { canalDa } from '../dados/canais'
import { config } from '../dados/config'
import { interativoPorId } from '../interativos/registro'
import { ID_SORTE, useEstadoSorte } from '../interativos/sorte/estado'
import { T } from '../interativos/sorte/textos'
import { formatarAte } from '../lib/cupom'
import { useEffect, useRef, useState } from 'react'
import { tirarCupomDoPedido, useCupomNoPedido, useOutrosQueValem } from '../lib/cupom-pedido'
import { venceAntesDeTodos } from '../lib/cupom-automatico'
import type { Cupom } from '../store/conta'
import { fraseDoPremio, nomeCategoria, type Situacao } from '../lib/cupom-uso'
import { raridadeDoRetrato, SeloRaridade } from '../interativos/sorte/SeloRaridade'
import { depoisDoHistorico } from '../lib/historico'
import type { Produto } from '../lib/tipos'
import { cabemMais } from '../lib/estoque'
import { disponivelEm, restamEm } from '../store/catalogo'
import { useLinhasSacola } from '../store/derivados'
import { nomeCidade, useLocal } from '../store/local'
import { useLojaMarca } from '../store/loja'
import { MAX_POR_ITEM, useSacola } from '../store/sacola'
import { useUI, type TelaInterativo } from '../store/ui'
import { Icone } from './comum'
import '../lib/fonte-codigo'
import './CupomSacola.css'

// Cupom na sacola: a linha do cupom aplicado (com a situação dele neste pedido) ou, sem cupom, um convite discreto
// pro "Teste minha sorte". O subtotal nunca muda nem aparece riscado: o desconto é confirmado pela loja no WhatsApp.
// Na linguagem do story do prêmio: o código como o adesivo dele (branco, em pixel) e o destaque em pixel.
// O cupom que vale entra sozinho (22/10, src/lib/cupom-pedido.ts, useCupomAutomatico): a linha diz "Entrou sozinho" e
// deixa trocar (pelos outros que valem, na mesma ordem) ou tirar (aí ele não volta sozinho neste pedido).

const DESCONTO_LOJA = 'desconto confirmado pela loja'

// Teclado e leitor de tela: o chip escolhido ("Usar cupom", "Trocar por") some com a escolha e o foco caía no <body>.
// Quem escolhe marca aqui, e a linha do cupom novo pega o foco no primeiro botão dela (o "Trocar", que diz o código).
let focarLinha = false
function escolheuAqui() {
  focarLinha = true
}

function abrirJogo(tela?: TelaInterativo) {
  useUI.getState().setSacola(false)
  depoisDoHistorico(() => useUI.getState().abrirInterativo(ID_SORTE, tela))
}

export function CupomSacola({ compacta = false }: { compacta?: boolean }) {
  const { cupom, situacao, auto } = useCupomNoPedido()
  if (cupom && situacao) return <CupomAplicado cupom={cupom} exemplo={cupom.demo && config.carimboDeExemplo} situacao={situacao} compacta={compacta} auto={auto} />
  if (compacta) return null
  return <ConviteCupom />
}

/** Carimbo "exemplo" do cupom de demonstração (prévia), como no cartão, no adesivo e na Minha conta. */
function Exemplo() {
  return <span className="carimbo cs-exemplo">{T.exemplo}</span>
}

function CupomAplicado({ cupom, exemplo, situacao, compacta, auto }: { cupom: Cupom; exemplo: boolean; situacao: Situacao; compacta: boolean; auto: boolean }) {
  const { codigo, retrato } = cupom
  const adicionar = useSacola((s) => s.adicionar)
  const aplicar = useSacola((s) => s.aplicarCupom)
  const avisar = useUI((s) => s.avisar)
  // os outros cupons da conta que valem neste pedido: o "Trocar" mostra eles
  const outros = useOutrosQueValem()
  const [trocando, setTrocando] = useState(false)
  // abriu o "Trocar por": a lista entra à vista (ela abre embaixo, perto do rodapé fixo) e o foco vai pro 1º cupom
  const trocar = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!trocando || !trocar.current) return
    const reduzido = matchMedia('(prefers-reduced-motion: reduce)').matches
    trocar.current.scrollIntoView({ block: 'nearest', behavior: reduzido ? 'auto' : 'smooth' })
    trocar.current.querySelector<HTMLButtonElement>('.cs-chip')?.focus({ preventScroll: true })
  }, [trocando])
  // escolheu um cupom (aqui no "Trocar por" ou no "Usar cupom"): o foco vem pro primeiro botão da linha nova
  const raiz = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!focarLinha || compacta) return
    focarLinha = false
    const id = requestAnimationFrame(() => raiz.current?.querySelector<HTMLButtonElement>('.cs-acoes button')?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(id)
  }, [codigo, compacta])
  const { todas } = useLinhasSacola()
  const { uf, cidade, cidadeInformada } = useLocal()
  const canal = canalDa(uf)
  const lugar = nomeCidade(canal, cidade, cidadeInformada) ?? canal?.nome ?? 'teu estado'
  const { destaque, alvo } = fraseDoPremio(retrato)
  const linha = (
    <p className="cs-linha">
      <span className="sr-only">Cupom </span>
      <span className="cs-adesivo px">{codigo}</span>
      <span className="sr-only">: </span>
      <span className="cs-premio">
        <span className="cs-destaque px">{destaque}</span> {alvo} <SeloRaridade raridade={raridadeDoRetrato(retrato)} />
        {exemplo && (
          <>
            {' '}
            <Exemplo />
          </>
        )}
      </span>
    </p>
  )
  if (compacta) {
    if (situacao.tipo !== 'ok') return null
    return (
      <div className="cupom-sacola compacta">
        {linha}
        <p className="legenda cs-nota">{DESCONTO_LOJA}</p>
      </div>
    )
  }
  // O "Tirar" some com o toque (a linha vira o "Usar cupom", o convite do jogo ou nada) e o foco caía no <body>
  // (revisão da junção, 22/10): vai pro primeiro botão do que entrou no lugar e, sem nenhum, pra folha da sacola
  const tirar = () => {
    const lista = raiz.current?.parentElement ?? null
    const folha = raiz.current?.closest<HTMLElement>('.folha') ?? null
    tirarCupomDoPedido()
    requestAnimationFrame(() => {
      const a = document.activeElement
      if (a && a !== document.body && a.isConnected) return
      ;(lista?.querySelector<HTMLElement>('.cupom-sacola .cs-chip, .cupom-sacola.cs-convite') ?? folha)?.focus({ preventScroll: true })
    })
  }
  const botaoTirar = (
    <button type="button" className="cs-botao toque" onClick={tirar} aria-label={`Tirar o cupom ${codigo}`}>
      {T.tirar}
    </button>
  )
  // "Pôr mais N" só quando as N cabem: o "restam X" do estado e os 99 da linha. Não cabendo, nada de botão (pôr menos
  // não faz o cupom valer, e o que passa do estoque ficaria guardado no aparelho sem ir no pedido)
  const cabem = (p: Produto, variacao: string | null): number => {
    const linha = todas.find((l) => l.produto.id === p.id && l.item.variacao === variacao)?.qtd ?? 0
    const estoque = cabemMais(p.id, uf)
    return Math.min(estoque ?? Infinity, MAX_POR_ITEM - linha)
  }
  const por = (p: Produto, qtd: number, rotulo: string) => {
    if (!disponivelEm(p, uf)) return false
    const variacao = todas.find((l) => l.produto.id === p.id)?.item.variacao ?? p.variacoes?.[0]?.id ?? null
    if (cabem(p, variacao) < qtd) return false
    return (
      <button type="button" className="cs-botao toque" onClick={() => adicionar(p.id, variacao, qtd)}>
        {rotulo}
      </button>
    )
  }
  /** "Só restam 2 aqui: esse cupom precisa de 4." (o estoque não fecha o cupom) */
  const naoCabe = (p: Produto, precisa: number): string | null => {
    const restam = restamEm(p, uf)
    if (restam == null || restam >= precisa || !disponivelEm(p, uf)) return null
    return `${restam === 1 ? 'Só resta 1' : `Só restam ${restam}`} em ${lugar}: esse cupom precisa de ${precisa}.`
  }

  let texto: string
  let acao = botaoTirar
  switch (situacao.tipo) {
    case 'ok':
      return (
        <div ref={raiz} className="cupom-sacola cs-ok">
          <div className="cs-txt">
            {linha}
            {/* "é o que vence primeiro" só quando é mesmo (um cupom que o cliente tirou antes pode vencer antes) */}
            <p className="legenda cs-nota">{auto ? `Entrou sozinho${outros.length && venceAntesDeTodos(cupom, outros) ? ': é o que vence primeiro' : ''} · ${DESCONTO_LOJA}` : DESCONTO_LOJA}</p>
          </div>
          <div className="cs-acoes">
            {outros.length > 0 && (
              <button type="button" className="cs-botao toque" aria-expanded={trocando} onClick={() => setTrocando((t) => !t)} aria-label={`Trocar o cupom ${codigo}`}>
                Trocar
              </button>
            )}
            {botaoTirar}
          </div>
          {trocando && outros.length > 0 && (
            <div ref={trocar} className="cs-trocar">
              <p className="cs-rot">Trocar por</p>
              <ChipsCupons
                cupons={outros}
                aoEscolher={(c) => {
                  escolheuAqui()
                  aplicar(c.codigo)
                  setTrocando(false)
                  avisar(T.cupomAplicado(c.codigo))
                }}
              />
            </div>
          )}
        </div>
      )
    case 'falta-produto':
      if (situacao.produto) {
        texto = naoCabe(situacao.produto, situacao.precisa) ?? `Vale pra ${situacao.produto.nome}. Põe na sacola pra valer.`
        acao = por(situacao.produto, situacao.precisa, situacao.precisa > 1 ? `Pôr ${situacao.precisa} na sacola` : 'Pôr na sacola') || botaoTirar
      } else {
        const cat = nomeCategoria(situacao.categoria)
        texto = `Vale em pedido com ${cat}. Põe uma ${cat} na sacola pra valer.`
      }
      break
    case 'qtd-insuficiente': {
      const falta = situacao.precisa - situacao.tem
      const nome = situacao.produto?.nome ?? nomeCategoria(situacao.categoria)
      texto = (situacao.produto && naoCabe(situacao.produto, situacao.precisa)) || `Pra valer, são ${situacao.precisa} ${nome} (tem ${situacao.tem}).`
      if (situacao.produto) acao = por(situacao.produto, falta, `Pôr mais ${falta}`) || botaoTirar
      break
    }
    case 'indisponivel-aqui':
      // estado sem atendimento: não é falta de estoque, a loja não chega lá (sem "agora", que promete que vai ter)
      texto = canal
        ? `${situacao.produto?.nome ?? 'O produto do cupom'} não tem em ${lugar} agora. O cupom fica guardado.`
        : 'A Green Cheese ainda não chegou no teu estado. O cupom fica guardado.'
      break
    case 'fora-do-catalogo':
      texto = 'Esse produto saiu do Mercado. Fala com a loja.'
      break
    default:
      return null
  }
  return (
    <div ref={raiz} className="cupom-sacola cs-aviso">
      <div className="cs-txt">
        {linha}
        <p className="cs-nota">{texto}</p>
      </div>
      <div className="cs-acoes">
        {acao}
        {acao !== botaoTirar && botaoTirar}
      </div>
    </div>
  )
}

/** Os cupons pra escolher, como a linha do cupom aplicado: o código no adesivo e o destaque em pixel. */
function ChipsCupons({ cupons, aoEscolher }: { cupons: Cupom[]; aoEscolher: (c: Cupom) => void }) {
  return (
    <>
      {cupons.map((c) => {
        const { destaque, alvo } = fraseDoPremio(c.retrato)
        return (
          <button key={c.codigo} type="button" className="cs-chip toque" onClick={() => aoEscolher(c)}>
            <span className="cs-adesivo px">{c.codigo}</span>
            <span className="sr-only">: </span>
            <span className="cs-premio">
              <span className="cs-destaque px">{destaque}</span> {alvo} <SeloRaridade raridade={raridadeDoRetrato(c.retrato)} />
              {c.demo && config.carimboDeExemplo && (
                <>
                  {' '}
                  <Exemplo />
                </>
              )}
            </span>
          </button>
        )
      })}
    </>
  )
}

/** Sem cupom aplicado: os cupons guardados (até 3) ou um convite pro jogo, conforme o estado da pessoa. */
function ConviteCupom() {
  const r = useEstadoSorte()
  const aplicar = useSacola((s) => s.aplicarCupom)
  const setConta = useUI((s) => s.setConta)
  const avisar = useUI((s) => s.avisar)
  const uf = useLocal((s) => s.uf)
  // a loja trocou (o jogo desligado no painel, estado que saiu): o convite redesenha
  useLojaMarca()
  const ativo = interativoPorId(ID_SORTE)?.ativo() ?? false
  // cupom só serve onde a loja atende (fora da área o caminho é a encomenda, que não leva cupom)
  if (r.conta && r.ativos.length && canalDa(uf)) {
    return (
      <div className="cupom-sacola cs-usar">
        <p className="cs-rot">Usar cupom</p>
        <div className="cs-chips">
          <ChipsCupons
            cupons={r.ativos.slice(0, 3)}
            aoEscolher={(c) => {
              escolheuAqui()
              aplicar(c.codigo)
              avisar(T.cupomAplicado(c.codigo))
            }}
          />
          <button type="button" className="cs-ver toque" onClick={() => setConta(true)}>
            ver todos
          </button>
        </div>
      </div>
    )
  }
  if (!ativo) return null
  let texto: string | null = null
  let tela: TelaInterativo | undefined
  if (r.estado === 'A') texto = 'Testa tua sorte: pode sair cupom pra esse pedido'
  else if (r.estado === 'B' && r.pendente) {
    texto = `Teu prêmio tá guardado até ${formatarAte(r.pendente.expiraEm, r.agora)} · Guardar`
    tela = 'cadastro'
  } else if (r.estado === 'D') texto = 'Giro de hoje liberado'
  if (!texto) return null
  return (
    <button type="button" className="cupom-sacola cs-convite toque" onClick={() => abrirJogo(tela)}>
      <Icone nome="dichavador" tamanho={24} />
      <span>{texto}</span>
      <span className="cs-seta" aria-hidden="true">
        ›
      </span>
    </button>
  )
}
