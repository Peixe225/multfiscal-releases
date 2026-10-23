// O recado depois de cada ação, sempre no mesmo lugar: embaixo, logo acima da barra (no computador, embaixo no meio da
// área da direita), por 6 s (8 s quando tem "Desfazer"), um de cada vez. Para de contar com o dedo/mouse em cima ou com
// o foco dentro (dá tempo de tocar no "Desfazer"), e o leitor de tela lê na hora. Quem salvou e muda de tela chama
// recado() antes de navegar: ele continua aparecendo na tela seguinte. O recado de uma ação de antes (a troca na lista)
// sai quando a pessoa vai pra outra tela.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useRota } from './rotas'
import { Ic, Pontinhos } from './ui'

export interface Desfazer {
  /** Texto do botão (padrão "Desfazer"). */
  rotulo?: string
  acao: () => void | Promise<void>
}

export interface Recado {
  id: number
  texto: string
  tipo: 'ok' | 'erro' | 'info'
  desfazer?: Desfazer
}

let atual: Recado | null = null
let contador = 0
let criadoEm = 0
const ouvintes = new Set<() => void>()
const avisar = () => ouvintes.forEach((f) => f())

/** Mostra o recado (troca o que estiver na tela). */
export function recado(texto: string, opcoes: { tipo?: Recado['tipo']; desfazer?: Desfazer } = {}): void {
  atual = { id: ++contador, texto, tipo: opcoes.tipo ?? 'ok', desfazer: opcoes.desfazer }
  criadoEm = Date.now()
  avisar()
}

/**
 * Mudou de tela: o recado de quem salvou e mudou de tela agora segue pra tela nova; o de uma ação de antes, e o que tem
 * "Desfazer" (a troca na lista), fica pra trás, em vez de cobrir a tela seguinte.
 */
const SEGUE_POR_MS = 1500

/** Tira o recado da tela (ex.: a ação que ele descreve foi desfeita por outro caminho). */
export function tirarRecado(): void {
  atual = null
  avisar()
}

function assinar(f: () => void) {
  ouvintes.add(f)
  return () => {
    ouvintes.delete(f)
  }
}

export function useRecado(): Recado | null {
  return useSyncExternalStore(assinar, () => atual)
}

/** O recado na tela (a Moldura põe um só, pra todas as telas). */
export function Recados() {
  const r = useRecado()
  const rota = useRota()
  const [parado, setParado] = useState(false)
  const [desfazendo, setDesfazendo] = useState(false)
  const caixa = useRef<HTMLDivElement>(null)
  const telaAntes = useRef(rota)
  useEffect(() => {
    if (telaAntes.current === rota) return
    telaAntes.current = rota
    // o "Desfazer" é da tela onde a ação aconteceu: esse recado nunca segue
    if (atual && (atual.desfazer || Date.now() - criadoEm > SEGUE_POR_MS)) tirarRecado()
  }, [rota])
  useEffect(() => {
    // recado novo começa a contar do zero: o dedo que tocou no "Desfazer" do anterior (e sumiu junto com ele, sem o
    // pointerleave) não pode deixar este parado pra sempre
    setDesfazendo(false)
    setParado(false)
  }, [r?.id])
  useEffect(() => {
    if (!r || parado || desfazendo) return
    const t = window.setTimeout(() => {
      if (atual?.id === r.id) tirarRecado()
    }, r.desfazer ? 8000 : 6000)
    return () => window.clearTimeout(t)
  }, [r, parado, desfazendo])
  return (
    <div className="pn-recados" aria-live={r?.tipo === 'erro' ? 'assertive' : 'polite'} aria-atomic="true">
      {r && (
        <div
          ref={caixa}
          key={r.id}
          className={`pn-recado pn-recado-${r.tipo}`}
          onPointerEnter={() => setParado(true)}
          onPointerLeave={() => setParado(false)}
          onFocus={() => setParado(true)}
          onBlur={(e) => {
            if (!caixa.current?.contains(e.relatedTarget as Node | null)) setParado(false)
          }}
        >
          <span className="pn-recado-ic" aria-hidden="true">
            <Ic nome={r.tipo === 'erro' ? 'atencao' : r.tipo === 'ok' ? 'check' : 'sino'} tamanho={16} />
          </span>
          <p className="pn-recado-txt">{r.texto}</p>
          {r.desfazer && (
            <button
              type="button"
              className="pn-recado-acao"
              disabled={desfazendo}
              onClick={async () => {
                if (desfazendo) return
                setDesfazendo(true)
                const id = r.id
                try {
                  await r.desfazer?.acao()
                } finally {
                  // a ação de desfazer costuma deixar o recado dela; se não deixou, este sai
                  if (atual?.id === id) tirarRecado()
                }
              }}
            >
              {desfazendo ? <Pontinhos rotulo="Desfazendo…" /> : (r.desfazer.rotulo ?? 'Desfazer')}
            </button>
          )}
          <button type="button" className="icone-botao pn-recado-x" aria-label="Fechar o recado" onClick={() => tirarRecado()}>
            <Ic nome="fechar" tamanho={16} />
          </button>
        </div>
      )}
    </div>
  )
}
