// Leitura das telas: guarda a última resposta de cada uma (voltar de tela desenha na hora e confere por trás),
// atualiza sozinho a cada 30 s com a aba à vista e ao voltar pra ela (a reserva do site aparece sem recarregar).
import { useCallback, useEffect, useRef, useState } from 'react'
import { ErroApi } from './api'

const cache = new Map<string, unknown>()

export function limparCache(): void {
  cache.clear()
}

export function guardar<T>(chave: string, dados: T): void {
  cache.set(chave, dados)
}

export function doCache<T>(chave: string): T | undefined {
  return cache.get(chave) as T | undefined
}

interface Estado<T> {
  dados: T | undefined
  erro: ErroApi | null
  carregando: boolean
}

export interface Leitura<T> extends Estado<T> {
  /** Busca de novo (silencioso = sem apagar o que já está na tela). */
  recarregar: () => Promise<void>
  /** Troca os dados na tela e no cache (resposta de uma ação: o servidor já devolve o novo). */
  trocar: (f: (d: T) => T) => void
}

export function useDados<T>(chave: string, buscar: (sinal: AbortSignal) => Promise<T>, intervalo = 30_000): Leitura<T> {
  const [estado, setEstado] = useState<Estado<T>>(() => ({ dados: cache.get(chave) as T | undefined, erro: null, carregando: !cache.has(chave) }))
  const buscarRef = useRef(buscar)
  buscarRef.current = buscar
  const emCurso = useRef<AbortController | null>(null)
  const chaveRef = useRef(chave)

  const recarregar = useCallback(async () => {
    if (emCurso.current) return
    const ctrl = new AbortController()
    emCurso.current = ctrl
    const k = chave
    try {
      const d = await buscarRef.current(ctrl.signal)
      if (ctrl.signal.aborted || chaveRef.current !== k) return
      cache.set(k, d)
      setEstado({ dados: d, erro: null, carregando: false })
    } catch (e) {
      if (ctrl.signal.aborted || chaveRef.current !== k) return
      const erro = e instanceof ErroApi ? e : new ErroApi('erro', 'Deu erro aqui. Tenta de novo.')
      setEstado((s) => ({ dados: s.dados, erro, carregando: false }))
    } finally {
      if (emCurso.current === ctrl) emCurso.current = null
    }
  }, [chave])

  useEffect(() => {
    chaveRef.current = chave
    setEstado({ dados: cache.get(chave) as T | undefined, erro: null, carregando: !cache.has(chave) })
    void recarregar()
    const visivel = () => {
      if (document.visibilityState === 'visible') void recarregar()
    }
    const t = intervalo > 0 ? window.setInterval(visivel, intervalo) : 0
    document.addEventListener('visibilitychange', visivel)
    window.addEventListener('online', visivel)
    return () => {
      window.clearInterval(t)
      document.removeEventListener('visibilitychange', visivel)
      window.removeEventListener('online', visivel)
      emCurso.current?.abort()
      emCurso.current = null
    }
  }, [chave, intervalo, recarregar])

  const trocar = useCallback(
    (f: (d: T) => T) => {
      setEstado((s) => {
        if (s.dados === undefined) return s
        const d = f(s.dados)
        cache.set(chave, d)
        return { ...s, dados: d }
      })
    },
    [chave],
  )

  return { ...estado, recarregar, trocar }
}

/** Ação com trava: um toque só por vez (sem envio duplo) e o erro pronto pra mostrar. */
export function useAcao() {
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [erro, setErro] = useState<ErroApi | null>(null)
  const trava = useRef(false)
  const vivo = useRef(true)
  useEffect(() => {
    vivo.current = true
    return () => {
      vivo.current = false
    }
  }, [])
  const rodar = useCallback(async <R,>(nome: string, f: () => Promise<R>): Promise<R | undefined> => {
    if (trava.current) return undefined
    trava.current = true
    setOcupado(nome)
    setErro(null)
    try {
      return await f()
    } catch (e) {
      if (vivo.current) setErro(e instanceof ErroApi ? e : new ErroApi('erro', 'Deu erro aqui. Tenta de novo.'))
      return undefined
    } finally {
      trava.current = false
      if (vivo.current) setOcupado(null)
    }
  }, [])
  return { ocupado, erro, setErro, rodar }
}
