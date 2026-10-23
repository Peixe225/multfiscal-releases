/**
 * Faixas discretas no topo com os avisos do site (editados no painel — servidor/CONTRATO-v3.md §1 e CONTRATO-v32 §A.5):
 * o `aviso` único de sempre e, desde a v3.2 (N14), a lista `avisos` com público (todos, só logados, só visitantes) e
 * validade. Cada um fecha no X e não volta para o mesmo texto neste aparelho; um aviso novo aparece de novo; o que vence
 * some sozinho. Fora do site não há aviso e nada aparece.
 */
import { useEffect, useMemo, useState } from 'react'
import { Info, TriangleAlert, X } from 'lucide-react'
import { avisosVisiveis, proximoVencimento, useAcesso, type AvisoSite } from '@/store/acesso'
import { cx, useMediaQuery } from '@/ui/primitives'
import './aviso.css'

const CHAVE = 'lenda:aviso-fechado'
/** Celular (em pé ou deitado): a mesma consulta dos avisos (toasts) do jogo. */
const CELULAR = '(max-width: 44.99rem), (max-height: 32.5rem)'
/** Quantas assinaturas de avisos fechados ficam guardadas (as mais antigas saem). */
const FECHADOS_MAX = 30

/** Assinatura curta do texto (o que foi fechado), sem guardar o texto inteiro. */
export function assinaturaAviso(texto: string): string {
  let h = 2166136261
  for (let i = 0; i < texto.length; i++) h = Math.imul(h ^ texto.charCodeAt(i), 16777619)
  return (h >>> 0).toString(36)
}

export const assinaturaDe = (a: AvisoSite) => assinaturaAviso(`${a.tipo}:${a.texto}`)

/** O que está guardado: uma assinatura só (v3, o aviso único) ou a lista (v3.2). Nunca lança. */
export function lerFechados(bruto: string | null): string[] {
  if (!bruto) return []
  if (!bruto.startsWith('[')) return [bruto]
  try {
    const l = JSON.parse(bruto) as unknown
    return Array.isArray(l) ? l.filter((x): x is string => typeof x === 'string').slice(-FECHADOS_MAX) : []
  } catch {
    return []
  }
}

/** Guarda mais um fechado (sem repetir, no máximo FECHADOS_MAX). */
export function comFechado(lista: readonly string[], ass: string): string[] {
  return [...lista.filter((x) => x !== ass), ass].slice(-FECHADOS_MAX)
}

const ler = (): string[] => {
  try {
    return lerFechados(localStorage.getItem(CHAVE))
  } catch {
    return []
  }
}

export function AvisoFaixa() {
  const aviso = useAcesso((s) => s.aviso)
  const avisos = useAcesso((s) => s.avisos)
  const logado = useAcesso((s) => s.logado)
  const [fechados, setFechados] = useState<string[]>(ler)
  // o próximo que vence some na hora certa, sem recarregar (no máximo um relógio por vez)
  const [agora, setAgora] = useState(() => Date.now())
  useEffect(() => {
    const fim = proximoVencimento(avisos, agora)
    if (fim === null) return
    const t = window.setTimeout(() => setAgora(Date.now()), Math.min(3_600_000, Math.max(1000, fim - Date.now() + 500)))
    return () => window.clearTimeout(t)
  }, [avisos, agora])
  const lista = useMemo(() => avisosVisiveis({ aviso, avisos: avisos ?? [], logado }, agora), [aviso, avisos, logado, agora])
  const assinaturas = lista.map(assinaturaDe).join('|')
  // outra aba fechou (ou chegou aviso novo): relê o que está fechado
  useEffect(() => setFechados(ler()), [assinaturas])
  const abertos = lista.filter((a) => !fechados.includes(assinaturaDe(a)))
  // v3.5 · no celular, um aviso por vez (o próximo aparece quando este fecha): três faixas empilhadas tomavam ~130 px e,
  // deitado (390 px de altura), empurravam o "Começar carreira" para fora da primeira tela. O "+N" diz que há mais.
  const celular = useMediaQuery(CELULAR)
  if (!abertos.length) return null
  const mostrar = celular ? abertos.slice(0, 1) : abertos
  const depois = abertos.length - mostrar.length
  const fechar = (a: AvisoSite) => {
    const novo = comFechado(fechados, assinaturaDe(a))
    setFechados(novo)
    try {
      localStorage.setItem(CHAVE, JSON.stringify(novo))
    } catch {
      /* sem storage: fecha só agora */
    }
  }
  return (
    <div className="lx-avisos">
      {mostrar.map((a) => {
        const Ico = a.tipo === 'alerta' ? TriangleAlert : Info
        return (
          <div key={assinaturaDe(a)} className={cx('lx-aviso', a.tipo === 'alerta' && 'lx-aviso--alerta')} role={a.tipo === 'alerta' ? 'alert' : 'status'}>
            <Ico className="lx-aviso__i" aria-hidden="true" />
            <p className="lx-aviso__t">{a.texto}</p>
            {depois > 0 && (
              <span className="lx-aviso__mais" title={`Mais ${depois} ${depois === 1 ? 'aviso' : 'avisos'}`}>
                +{depois}
              </span>
            )}
            <button type="button" className="lx-aviso__x" aria-label="Fechar aviso" onClick={() => fechar(a)}>
              <X aria-hidden="true" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
