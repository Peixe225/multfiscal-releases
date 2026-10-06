import { gravarSessao, lerSessao } from './armazenamento'

// Duas versões da home em teste com o dono da loja:
//   Home 1 (atual): o Início termina no story + perfil + rodapé; catálogo e estados em abas.
//   Home 2: a mesma coisa e, no Início, o "Teste minha sorte" com o mercador (card ao lado do perfil no computador;
//   rosto na barra, passo no story e balão no celular).
// Aprovar a Home 2 = trocar HOME_PADRAO para 2. Recusar = ver "Abas e Home 2" no LEIA-ME.md.

export type Home = 1 | 2

export const HOME_PADRAO: Home = 1

const CHAVE = 'gc-home'

/**
 * Home pedida na URL, do jeito que vier digitada: ?home=2, ?home2, ?Home2, ?HOME=2 (o mesmo para 1). A URL fica
 * no formato certo (?home=2), sem a chave digitada, para o recarregar e os links copiados seguirem iguais.
 */
function homeDaURL(): string | null {
  try {
    const q = new URLSearchParams(location.search)
    let pedida: string | null = null
    let reescrever = false
    for (const k of [...q.keys()]) {
      const atalho = /^home-?([12])$/i.exec(k)
      if (atalho) {
        pedida = atalho[1]
        q.delete(k)
        reescrever = true
      } else if (/^home$/i.test(k)) {
        const v = (q.get(k) ?? '').trim()
        if (v === '1' || v === '2') pedida = v
        if (k !== 'home') {
          q.delete(k)
          reescrever = true
        }
      }
    }
    if (reescrever && pedida) {
      q.set('home', pedida)
      history.replaceState(history.state, '', `${location.pathname}?${q}${location.hash}`)
    }
    return pedida
  } catch {
    return null
  }
}

/**
 * Home desta visita: a pedida na URL (?home=2, ou um atalho como ?home2) manda e fica lembrada na sessão, para as
 * abas e o recarregar seguirem nela; sem pedido, a última escolhida nesta sessão; senão, a padrão.
 */
export function homeDaEntrada(): Home {
  const pedida = homeDaURL()
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
