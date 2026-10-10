import { copiarTexto } from '../lib/copiar'
import { linkCompartilhar } from '../lib/url'
import { produtoPorId, disponivelEm } from '../store/catalogo'
import { useChat } from '../store/chat'
import { useLocal } from '../store/local'
import { useSacola } from '../store/sacola'
import { useUI } from '../store/ui'
import { Icone } from './comum'

/**
 * Responder ao story do hero: põe o produto que está passando na sacola e abre o chat respondendo a ele.
 * Sem produto (produto indisponível, story vazio), abre o pedido guiado geral.
 */
export function useResponderStory(): () => void {
  const heroProduto = useUI((s) => s.heroProduto)
  const uf = useLocal((s) => s.uf)
  return () => {
    const p = produtoPorId(heroProduto)
    const abrir = useChat.getState().abrir
    if (p && uf && disponivelEm(p, uf)) {
      const sacola = useSacola.getState()
      if (!sacola.itens.some((i) => i.id === p.id)) sacola.adicionar(p.id, p.variacoes?.[0]?.id ?? null, 1)
      abrir('pedido', { respondendo: [p.id] })
    } else abrir('pedido')
  }
}

/**
 * A linha de resposta do story do hero, no pé do quadro (celular), como no visualizador de stories do Instagram:
 * "Enviar mensagem…" e o aviãozinho de compartilhar. Só no Início; as outras abas pedem pela sacola, pela página do
 * produto, pelo perfil e pela encomenda.
 */
export function RespostaStory({ produtoId }: { produtoId: string | null }) {
  const responder = useResponderStory()
  const avisar = useUI((s) => s.avisar)
  const produto = produtoPorId(produtoId)
  const compartilhar = () => {
    const link = produto ? linkCompartilhar({ p: produto.id }) : linkCompartilhar({})
    const titulo = produto ? `${produto.nome} · Green Cheese` : 'Green Cheese Imports'
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> }
    if (typeof nav.share === 'function') {
      nav.share({ title: titulo, url: link }).catch(() => undefined)
      return
    }
    // sem produto (o story da rua, ou nenhum à venda) o link é o da loja
    avisar(copiarTexto(link) ? (produto ? 'Link do produto copiado.' : 'Link da loja copiado.') : 'Não deu pra copiar.')
  }
  return (
    <div className="hero-resposta">
      <button type="button" className="barra-pilula toque" onClick={responder}>
        Enviar mensagem…
      </button>
      <button
        type="button"
        className="icone-botao toque hero-compartilhar"
        onClick={compartilhar}
        aria-label={produto ? `Compartilhar ${produto.nome}` : 'Compartilhar a Green Cheese'}
      >
        <Icone nome="enviar" tamanho={24} />
      </button>
    </div>
  )
}
