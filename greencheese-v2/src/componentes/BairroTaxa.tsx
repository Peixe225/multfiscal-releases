// A taxa de entrega por bairro na tela (pedido do Ian em 22/10), em dois lugares: na sacola ("Teu bairro", opcional,
// com a taxa e o total com ela) e no story de atendimento do estado (a busca "Qual a taxa do meu bairro?"). Os dois
// modos do painel:
// - 'site' (aparece no site): o campo sugere os bairros da lista enquanto a pessoa digita; achou, mostra a taxa (e, na
//   sacola, o total com ela); fora da lista ou marcado "consultar", "a consultar" — nunca um valor inventado;
// - 'consulta' (o cliente consulta): o site não mostra valor, só "a taxa depende do bairro" e o botão que abre a
//   conversa do pedido com a frase pronta ("Oi! Quanto fica a entrega pro bairro Copacabana?").
// O bairro digitado fica guardado no aparelho (src/store/bairro.ts) e vai na mensagem do pedido (src/lib/mensagem.ts).
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Canal } from '../dados/canais'
import { alvoDeSaida } from '../lib/ambiente'
import { bairroDigitado, chaveBairro, modoBairro, sugestoesDeBairro, taxaDoBairro } from '../lib/bairros'
import { brl } from '../lib/formato'
import { linkConsultaBairro } from '../lib/mensagem'
import { useBairro, useBairroDa } from '../store/bairro'
import { Icone } from './comum'
import './BairroTaxa.css'

interface Props {
  canal: Canal
  /** A cidade do atendimento (a escolhida, ou a única do estado): o bairro da lista com cidade só vale nela. */
  cidade: string | null
  variante: 'sacola' | 'story'
  /** Sacola: o subtotal da sacola, pro "Total com a entrega". */
  subtotal?: { valor: number; temConsultar: boolean } | null
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
  // achou o bairro (com valor ou "consultar"): a sugestão some
  const exato = t.tipo === 'valor' || (t.tipo === 'consultar' && !!t.bairro && !t.fora)
  const combinam = modo === 'site' && !exato ? sugestoesDeBairro(lista, bairro, cidade, variante === 'story' ? 4 : 5) : []
  const sugestoes = focado ? combinam : []
  const story = variante === 'story'

  const campo = (
    <div className="bt-campo">
      <label htmlFor={id} className="bt-rotulo">
        {story ? (modo === 'site' ? 'Qual a taxa do meu bairro?' : 'Teu bairro') : 'Teu bairro'}
        {(!story || modo === 'consulta') && <span className="bt-opcional"> (opcional)</span>}
      </label>
      <input
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
        onFocus={() => {
          window.clearTimeout(sair.current)
          setFocado(true)
        }}
        // a sugestão tocada chega depois do blur: espera um instante antes de esconder a lista
        onBlur={() => {
          sair.current = window.setTimeout(() => setFocado(false), 180)
          if (bairro !== bairroDigitado(bairro)) definir(canal.uf, bairroDigitado(bairro))
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />
      {sugestoes.length > 0 && (
        <ul ref={listaRef} className="bt-sugestoes" aria-label="Bairros da lista">
          {sugestoes.map((b) => (
            <li key={`${b.cidade ?? ''}|${chaveBairro(b.nome)}`}>
              <button
                type="button"
                className="bt-sugestao toque"
                onClick={() => {
                  setDigitou(true)
                  definir(canal.uf, b.nome)
                  setFocado(false)
                }}
              >
                <span className="bt-sugestao-nome">{b.nome}</span>
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
        <span className="bt-nota">A loja confirma a taxa no atendimento.</span>
      </>
    )
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
