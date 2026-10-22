// A taxa de entrega por bairro na tela (pedido do Ian em 22/10), em dois lugares: na sacola ("Teu bairro", opcional,
// com a taxa e o total com ela) e no story de atendimento do estado (a busca "Qual a taxa do meu bairro?"). Os dois
// modos do painel:
// - 'site' (aparece no site): o campo sugere os bairros da lista enquanto a pessoa digita; achou, mostra a taxa (e, na
//   sacola, o total com ela); fora da lista ou marcado "consultar", "a consultar" — nunca um valor inventado;
// - 'consulta' (o cliente consulta): o site não mostra valor, só "a taxa depende do bairro" e o botão que abre a
//   conversa do pedido com a frase pronta ("Oi! Quanto fica a entrega pro bairro Copacabana?").
// O bairro digitado fica guardado no aparelho (src/store/bairro.ts) e vai na mensagem do pedido (src/lib/mensagem.ts).
// No estado com mais de uma cidade, sem a cidade do cliente, a sugestão mostra a cidade de cada bairro ("Centro ·
// Vitória") e a escolha diz a cidade pro site (a mesma conta da mensagem e do servidor: nunca sugere um bairro que
// depois sai "a consultar"). Teclado: ↓ e ↑ andam pela sugestão, Enter escolhe, Esc volta pro campo.
import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react'
import type { BairroTaxa as Bairro, Canal } from '../dados/canais'
import { alvoDeSaida } from '../lib/ambiente'
import { bairroDigitado, chaveBairro, modoBairro, sugestoesDeBairro, taxaDoBairro } from '../lib/bairros'
import { brl } from '../lib/formato'
import { linkConsultaBairro } from '../lib/mensagem'
import { minimoDoCanal } from '../lib/pedido-minimo'
import { useBairro, useBairroDa } from '../store/bairro'
import { useLocal } from '../store/local'
import { Icone } from './comum'
import './BairroTaxa.css'

interface Props {
  canal: Canal
  /** A cidade do atendimento (a escolhida, ou a única do estado): o bairro da lista com cidade só vale nela. */
  cidade: string | null
  variante: 'sacola' | 'story'
  /** Sacola: o subtotal da sacola, pro "Total com a entrega" (comCupom: um cupom vale no pedido, e o total é sem o desconto). */
  subtotal?: { valor: number; temConsultar: boolean; comCupom?: boolean } | null
  /** Story: a pessoa tá mexendo no campo (o story pausa enquanto ela digita ou lê a resposta). */
  aoMexer?: (mexendo: boolean) => void
}

export function BairroTaxa({ canal, cidade, variante, subtotal, aoMexer }: Props) {
  const modo = modoBairro(canal)
  const bairro = useBairroDa(canal.uf)
  const definir = useBairro((s) => s.definir)
  const [focado, setFocado] = useState(false)
  const sair = useRef(0)
  useEffect(() => () => window.clearTimeout(sair.current), [])
  const campoRef = useRef<HTMLInputElement>(null)
  const blocoRef = useRef<HTMLDivElement>(null)
  // o story para enquanto a pessoa digita e lê a resposta (o bairro guardado de outra visita não prende o story)
  const [digitou, setDigitou] = useState(false)
  const mexendo = focado || (digitou && !!bairroDigitado(bairro))
  useEffect(() => {
    aoMexer?.(mexendo)
  }, [mexendo, aoMexer])
  // a sugestão aparece embaixo do campo: na sacola, a folha rola até ela (o rodapé com o botão não cobre a lista)
  const listaRef = useRef<HTMLUListElement>(null)
  const temLista = focado && bairroDigitado(bairro).length > 0
  useEffect(() => {
    if (!temLista || variante !== 'sacola') return
    const id = window.requestAnimationFrame(() => listaRef.current?.scrollIntoView({ block: 'nearest' }))
    return () => window.cancelAnimationFrame(id)
  }, [temLista, bairro, variante])
  if (!modo) return null

  const id = `bairro-${variante}`
  const t = taxaDoBairro(canal, bairro, cidade)
  const lista = canal.taxaPorBairro?.modo === 'site' ? canal.taxaPorBairro.bairros : []
  // o mesmo bairro em mais de uma cidade, com taxas diferentes, e o cliente sem cidade: as opções ficam à vista
  const opcoes = t.tipo === 'consultar' ? (t.opcoes ?? null) : null
  // achou o bairro (com valor ou "consultar"): a sugestão some
  const exato = t.tipo === 'valor' || (t.tipo === 'consultar' && !!t.bairro && !t.fora && !opcoes)
  const combinam = modo === 'site' && !exato ? sugestoesDeBairro(lista, bairro, cidade, variante === 'story' ? 4 : 5) : []
  const sugestoes = focado || opcoes ? combinam : []
  const story = variante === 'story'
  // a cidade junto do nome só quando o estado tem mais de uma e o cliente ainda não disse a dele
  const comCidade = canal.cidades.length > 1 && !cidade

  const escolher = (b: Bairro, peloTeclado: boolean) => {
    setDigitou(true)
    definir(canal.uf, b.nome)
    // o bairro de uma cidade, sem a cidade do cliente: a escolha diz a cidade pro site (o cabeçalho do pedido, a taxa
    // da mensagem e a do servidor passam a ser dessa cidade)
    if (b.cidade && !cidade) {
      const c = canal.cidades.find((x) => chaveBairro(x.nome) === chaveBairro(b.cidade ?? ''))
      if (c) useLocal.getState().escolherCidade(c.slug)
    }
    setFocado(false)
    // pelo teclado o foco volta pro campo (o botão escolhido some); no toque, não (o teclado do celular não reabre)
    if (peloTeclado) window.requestAnimationFrame(() => campoRef.current?.focus())
  }
  // a lista some quando o foco sai do bloco (o campo e a sugestão), não quando passa do campo pra sugestão (Tab)
  const aoSairDoCampo = (e: FocusEvent<HTMLDivElement>) => {
    const pra = e.relatedTarget as Node | null
    if (pra && e.currentTarget.contains(pra)) return
    // o toque na sugestão chega depois do blur (e sem relatedTarget no iPhone): espera um instante antes de esconder
    window.clearTimeout(sair.current)
    sair.current = window.setTimeout(() => setFocado(false), pra ? 0 : 180)
  }
  const botoes = () => [...(blocoRef.current?.querySelectorAll<HTMLButtonElement>('.bt-sugestao') ?? [])]
  const andar = (e: KeyboardEvent, de: number) => {
    const bs = botoes()
    if (e.key === 'ArrowDown' && bs.length) {
      e.preventDefault()
      bs[Math.min(de + 1, bs.length - 1)]?.focus()
    } else if (e.key === 'ArrowUp' && de >= 0) {
      e.preventDefault()
      if (de === 0) campoRef.current?.focus()
      else bs[de - 1]?.focus()
    } else if (e.key === 'Escape' && de >= 0) {
      e.preventDefault()
      e.stopPropagation()
      campoRef.current?.focus()
    }
  }

  const campo = (
    <div
      ref={blocoRef}
      className="bt-campo"
      onFocus={() => {
        window.clearTimeout(sair.current)
        setFocado(true)
      }}
      onBlur={aoSairDoCampo}
    >
      <label htmlFor={id} className="bt-rotulo">
        {story ? (modo === 'site' ? 'Qual a taxa do meu bairro?' : 'Teu bairro') : 'Teu bairro'}
        {(!story || modo === 'consulta') && <span className="bt-opcional"> (opcional)</span>}
      </label>
      <input
        ref={campoRef}
        id={id}
        className="bt-input"
        type="text"
        inputMode="text"
        autoComplete="off"
        autoCapitalize="words"
        enterKeyHint="done"
        maxLength={60}
        placeholder={lista[0] ? `Ex.: ${lista[0].nome}` : 'Ex.: Centro'}
        value={bairro}
        aria-describedby={`${id}-res`}
        onChange={(e) => {
          setDigitou(true)
          definir(canal.uf, e.target.value)
        }}
        onBlur={() => {
          if (bairro !== bairroDigitado(bairro)) definir(canal.uf, bairroDigitado(bairro))
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            // um bairro só na sugestão: o Enter escolhe ele; senão, só fecha o teclado
            if (sugestoes.length === 1) {
              e.preventDefault()
              escolher(sugestoes[0], true)
            } else (e.target as HTMLInputElement).blur()
          } else andar(e, -1)
        }}
      />
      {sugestoes.length > 0 && (
        <ul ref={listaRef} className="bt-sugestoes" aria-label={opcoes ? `${opcoes[0].nome}: escolhe a tua cidade` : 'Bairros da lista'}>
          {sugestoes.map((b, i) => (
            <li key={`${b.cidade ?? ''}|${chaveBairro(b.nome)}`}>
              <button type="button" className="bt-sugestao toque" onClick={(e) => escolher(b, e.detail === 0)} onKeyDown={(e) => andar(e, i)}>
                <span className="bt-sugestao-nome">
                  {b.nome}
                  {comCidade && b.cidade && <span className="bt-sugestao-cidade"> · {b.cidade}</span>}
                </span>
                <span className="sr-only">: </span>
                <span className="bt-sugestao-taxa">{b.taxa == null ? 'consultar' : b.taxa === 0 ? 'sem taxa' : brl(b.taxa)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  // a resposta (o leitor de tela ouve quando muda)
  const minimo = minimoDoCanal(canal)
  let resposta: ReactNode = null
  if (t.tipo === 'valor') {
    const total = subtotal && (subtotal.valor > 0 || !subtotal.temConsultar) ? Math.round((subtotal.valor + t.valor) * 100) / 100 : null
    resposta = story ? (
      <>
        <span className="bt-grande px">{t.valor === 0 ? `${t.bairro}: sem taxa` : `${t.bairro}: ${brl(t.valor)}`}</span>
        <span className="bt-nota">A loja confirma no atendimento.</span>
      </>
    ) : (
      <>
        <span className="bt-linha">
          {t.valor === 0 ? (
            <>Entrega grátis no bairro {t.bairro}.</>
          ) : (
            <>
              Taxa do bairro {t.bairro}: <strong className="px">{brl(t.valor)}</strong>
            </>
          )}
        </span>
        {total != null && (
          <span className="bt-total">
            <span>Total com a entrega</span>
            <span className="px px-24">
              <span className="bt-total-valor">{brl(total)}</span>
              {subtotal?.temConsultar ? ' + itens a consultar' : ''}
            </span>
          </span>
        )}
        {/* o total com a taxa passa do mínimo, mas o mínimo conta só os produtos: a tela diz, pro "Faltam" de baixo não
            parecer conta errada */}
        {total != null && minimo != null && subtotal != null && subtotal.valor < minimo && (
          <span className="bt-nota bt-nota-minimo">O pedido mínimo de {brl(minimo)} conta só os produtos, sem a taxa.</span>
        )}
        <span className="bt-nota">
          {total != null && subtotal?.comCupom ? 'Sem o desconto do cupom: a loja confirma a taxa e o desconto no atendimento.' : 'A loja confirma a taxa no atendimento.'}
        </span>
      </>
    )
  } else if (opcoes) {
    // o mesmo bairro em mais de uma cidade, com taxas diferentes: a pessoa escolhe a dela (as opções ficam à vista)
    resposta = <span className="bt-linha">{opcoes[0].nome} tem taxa diferente em cada cidade: escolhe a tua aqui embaixo.</span>
  } else if (t.tipo === 'consultar' && t.bairro && !(t.fora && sugestoes.length)) {
    // fora da lista só depois que a pessoa para de digitar um começo que ainda acha bairro ("Ipa" → Ipanema)
    resposta = t.fora ? (
      <span className="bt-linha">O bairro {t.bairro} não tá na lista: a taxa vem {story ? 'na resposta do atendimento' : 'no atendimento'}.</span>
    ) : story ? (
      <span className="bt-grande px">{t.bairro}: a consultar</span>
    ) : (
      <span className="bt-linha">Taxa do bairro {t.bairro}: a consultar no atendimento.</span>
    )
  }

  return (
    <div className={`bairro-taxa bt-${variante}${modo === 'consulta' ? ' bt-consulta' : ''}`}>
      {story ? (
        <p className="info-grande px">{modo === 'site' ? 'Taxa por bairro' : 'A taxa depende do bairro'}</p>
      ) : (
        <p className="bt-cabeca">Entrega: a taxa depende do bairro.</p>
      )}
      {campo}
      <p id={`${id}-res`} className="bt-resposta" role="status">
        {resposta}
      </p>
      {modo === 'consulta' && (
        <>
          <a
            className={`botao ${story ? 'botao-cheio' : 'botao-contorno'} bt-perguntar`}
            href={linkConsultaBairro(canal, bairro)}
            target={alvoDeSaida()}
            rel="noopener noreferrer"
            aria-label={`Perguntar a taxa ${bairroDigitado(bairro) ? `do bairro ${bairroDigitado(bairro)}` : 'do meu bairro'} no WhatsApp`}
          >
            <Icone nome="whatsapp" tamanho={18} />
            Perguntar no WhatsApp
          </a>
          {!story && <p className="bt-nota">Ou fecha o pedido: a loja passa a taxa na conversa.</p>}
        </>
      )}
    </div>
  )
}
