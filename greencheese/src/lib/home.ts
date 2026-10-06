import { gravarSessao, lerSessao } from './armazenamento'
import { lerParametros } from './url'

// Duas versões da home em teste com o dono da loja:
//   Home 1 (atual): o Início termina no story + perfil + rodapé; catálogo e estados em abas.
//   Home 2: a mesma coisa e, no Início, o "Teste minha sorte" com o mercador (card ao lado do perfil no computador;
//   rosto na barra, passo no story e balão no celular).
// Aprovar a Home 2 = trocar HOME_PADRAO para 2. Recusar = ver "Abas e Home 2" no LEIA-ME.md.

export type Home = 1 | 2

export const HOME_PADRAO: Home = 1

const CHAVE = 'gc-home'

/** Atalho digitado à mão: ?home2 (ou ?home1) vale como ?home=2 (ou ?home=1), e a URL fica no formato certo. */
function atalhoDigitado(): string | null {
  try {
    const q = new URLSearchParams(location.search)
    const v = q.has('home2') ? '2' : q.has('home1') ? '1' : null
    if (!v) return null
    q.delete('home2')
    q.delete('home1')
    q.set('home', v)
    history.replaceState(history.state, '', `${location.pathname}?${q}${location.hash}`)
    return v
  } catch {
    return null
  }
}

/**
 * Home desta visita: ?home=2 ou ?home=1 (ou o atalho ?home2) manda e fica lembrado na sessão, para as abas e o
 * recarregar seguirem nela; sem parâmetro, a última escolhida nesta sessão; senão, a padrão.
 */
export function homeDaEntrada(): Home {
  const pedida = lerParametros().home ?? atalhoDigitado()
  if (pedida === '1' || pedida === '2') {
    gravarSessao(CHAVE, pedida)
    return pedida === '2' ? 2 : 1
  }
  const lembrada = lerSessao(CHAVE)
  if (lembrada === '1' || lembrada === '2') return lembrada === '2' ? 2 : 1
  return HOME_PADRAO
}

/** Lembra a escolha na sessão (o painel da prévia troca de home sem recarregar). */
export function lembrarHome(h: Home) {
  gravarSessao(CHAVE, String(h))
}

/** Valor do ?home= que a URL deve ter: só quando a home não é a padrão. */
export function homeNaURL(h: Home): string | null {
  return h === HOME_PADRAO ? null : String(h)
}
