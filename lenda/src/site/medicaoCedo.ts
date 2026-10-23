/**
 * v3.5 · a visita contada antes de o jogo carregar (celular no 4G lento: o jogo leva segundos para aparecer, e quem
 * desiste olhando a tela de abertura sumia do painel).
 *
 * NÃO é importado pelo jogo: o plugin lenda:medicao-cedo do vite.config.ts empacota este arquivo (só ele e o pedaço da
 * medicao.ts que ele usa, ~3 KB) num <script> embutido no index.html do site, antes da folha de estilo — roda enquanto a
 * página ainda chega, sem esperar CSS nem JavaScript. O build-site.mjs põe o hash dele no script-src da CSP.
 *
 * Faz o mesmo que a medição faria no 1º envio: visitante (localStorage) e sessão (sessionStorage) pelas mesmas funções,
 * e um `view` da tela do endereço para o e.php (fetch com keepalive: segue mesmo se a aba fechar). Deixa tudo em
 * window.__lendaMedicao para o iniciarMedicao do main.tsx continuar a mesma sessão sem mandar o view de novo (e mandar,
 * se este não chegou). Nunca lança erro: se algo falhar aqui, a medição do bundle segue como antes.
 */
import { armazem, botDoNavegador, contextoAgora, montarCorpos, obterVisitante, rotaDoEndereco, tocarSessao, type SementeMedicao } from './medicao'

/** Manda o corpo para o e.php; devolve se chegou (2xx/4xx: o servidor respondeu; 5xx ou rede: não). */
export function enviarCedo(url: string, corpo: string): Promise<boolean> {
  try {
    if (typeof fetch === 'function') {
      return fetch(url, { method: 'POST', body: corpo, headers: { 'Content-Type': 'text/plain' }, credentials: 'same-origin', keepalive: true }).then(
        (r) => r.status < 500,
        () => false,
      )
    }
    const ok = typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(url, new Blob([corpo], { type: 'text/plain' }))
    return Promise.resolve(!!ok)
  } catch {
    return Promise.resolve(false)
  }
}

/** A visita desta página: grava a sessão, manda o 1º view e devolve a semente (null se não deu). */
export function medirCedo(): SementeMedicao | null {
  try {
    const ls = armazem(() => window.localStorage)
    const ss = armazem(() => window.sessionStorage)
    const v = obterVisitante(ls)
    const em = Date.now()
    const { sid, ctx } = tocarSessao(ss, em, contextoAgora)
    const rota = rotaDoEndereco(location.hash)
    const [corpo] = montarCorpos({ v, s: sid, bot: botDoNavegador(), ctx }, [{ t: 'view', m: null, ts: em, d: { rota } }])
    if (!corpo) return null
    const p = enviarCedo(new URL('api/e.php', document.baseURI).href, corpo)
    return { v, s: sid, ctx, em, rota, p }
  } catch {
    return null
  }
}

if (typeof window !== 'undefined' && !window.__lendaMedicao) {
  const s = medirCedo()
  if (s) window.__lendaMedicao = s
}
