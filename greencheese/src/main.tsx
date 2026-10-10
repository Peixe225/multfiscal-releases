import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/pixelify-sans/400.css'
import '@fontsource/pixelify-sans/500.css'
import './estilos/base.css'
// o 2 e o 5 redesenhados na grade da Pixelify (lá o 5 vira S e o 2 vira Z): os contadores da barra e da lateral (rateios
// abertos, sacola, cupons) e, depois, o prêmio e o rateio. ~1,3 KB comprimido, só os dois dígitos
import './interativos/sorte/digitos.css'
import { App } from './App'
import { carregarArtesRealistas } from './arte/realista/carregar'
import { vigiarEstoqueDaSacola } from './lib/estoque'
import { lerParametros } from './lib/url'
import { useChat } from './store/chat'
import { useLocal } from './store/local'
import { iniciarLoja } from './store/loja'

// já fica na fila; o download em si espera liberarArtesRealistas() (ver carregar.ts)
carregarArtesRealistas().catch(() => {})

// a loja do servidor: a primeira tela já sai com a embutida (ou a guardada no aparelho) e a pergunta ao servidor vai
// no primeiro respiro (na hora, se o estado do link ou o salvo, ou o produto do link direto, não está nela); com o
// pedido aberto, a volta pra aba não troca a loja debaixo da pessoa
const link = lerParametros()
iniciarLoja({ pedidoAberto: () => useChat.getState().aberto, ufPedida: link.uf ?? useLocal.getState().uf, produtosPedidos: [link.p, link.produto] })
// a sacola nunca passa do "restam X" do estado (ajusta na abertura, quando a loja muda e quando troca de estado)
vigiarEstoqueDaSacola()

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
