// "Tem mudança não salva": o mecanismo comum das telas de formulário (Estado, Ajustes da loja, Prêmio, Categoria e,
// na próxima passada, Produto). A tela diz se mexeu e, se quiser, como salvar e como descartar (o rascunho guardado
// no aparelho sai junto); o voltar do topo, os links e o voltar do Android perguntam antes de sair:
//   [Salvar] [Descartar] [Continuar editando]
// Uso: const { liberar } = useAvisarAoSair(mexeu, { salvar: () => salvar({ ficar: true }), descartar })
//   - salvar devolve true quando salvou (aí o painel segue pra onde a pessoa ia); false = ficou na tela (com o erro);
//   - liberar() antes de a própria tela navegar depois de salvar (senão ela perguntaria de novo).
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Folha } from './Folha'
import { definirGuarda, depoisDaVolta, type Guarda } from './rotas'
import { Botao } from './ui'

interface Pergunta {
  seguir: () => void
  salvar?: () => Promise<boolean>
  descartar?: () => void
}

let pergunta: Pergunta | null = null
const ouvintes = new Set<() => void>()
function definir(p: Pergunta | null) {
  pergunta = p
  ouvintes.forEach((f) => f())
}
function assinar(f: () => void) {
  ouvintes.add(f)
  return () => {
    ouvintes.delete(f)
  }
}

/**
 * Pergunta já (sem navegação no meio): pra folha de edição que vai fechar com mudança (Categoria). seguir() fecha a
 * folha; salvar devolve true quando salvou.
 */
export function perguntarSair(p: { seguir: () => void; salvar?: () => Promise<boolean>; descartar?: () => void }): void {
  definir(p)
}

export interface OpcoesSair {
  /** Salva sem sair da tela; true = salvou. Sem ela, a folha não oferece "Salvar". */
  salvar?: () => Promise<boolean>
  /** O que fazer ao descartar (ex.: apagar o rascunho do aparelho). */
  descartar?: () => void
}

export function useAvisarAoSair(mexeu: boolean, opcoes: OpcoesSair = {}): { liberar: () => void } {
  const mexeuRef = useRef(mexeu)
  mexeuRef.current = mexeu
  const opRef = useRef(opcoes)
  opRef.current = opcoes
  const liberado = useRef(false)
  // mexeu de novo depois de liberar (salvou com erro e seguiu editando): volta a perguntar
  useEffect(() => {
    if (!mexeu) liberado.current = false
  }, [mexeu])
  useEffect(() => {
    const g: Guarda = {
      mexeu: () => mexeuRef.current && !liberado.current,
      perguntar: (seguir) => definir({ seguir, salvar: opRef.current.salvar, descartar: opRef.current.descartar }),
    }
    definirGuarda(g)
    return () => {
      definirGuarda(null, g)
      if (pergunta) definir(null)
    }
  }, [])
  return {
    liberar: () => {
      liberado.current = true
    },
  }
}

/** A folha da pergunta (a Moldura põe uma só). */
export function PerguntaSair() {
  const p = useSyncExternalStore(assinar, () => pergunta)
  // o que fazer depois que a folha sair (e o voltar dela no histórico terminar)
  const [depois, setDepois] = useState<(() => void) | null>(null)
  useEffect(() => {
    if (p || !depois) return
    const f = depois
    setDepois(null)
    const espera = depoisDaVolta()
    if (espera) void espera.then(f)
    else f()
  }, [p, depois])
  const fechar = (f?: () => void) => {
    if (f) setDepois(() => f)
    definir(null)
  }
  return (
    <Folha
      aberta={!!p}
      aoFechar={() => fechar()}
      papel="alertdialog"
      titulo="Tem mudança não salva"
      sub="Se sair agora, o que tu mudou nessa tela não vai pro site."
      rodape={
        p && (
          <div className="pn-botoes">
            {p.salvar && (
              <Botao
                largo
                onClick={() => {
                  const { salvar, seguir } = p
                  fechar(() => {
                    const aqui = location.hash
                    void salvar!().then((ok) => {
                      if (ok && location.hash === aqui) seguir()
                    })
                  })
                }}
              >
                Salvar
              </Botao>
            )}
            <Botao
              variante="cinza"
              largo
              onClick={() => {
                const { descartar, seguir } = p
                fechar(() => {
                  descartar?.()
                  seguir()
                })
              }}
            >
              Descartar
            </Botao>
            <Botao variante="texto" largo onClick={() => fechar()}>
              Continuar editando
            </Botao>
          </div>
        )
      }
    >
      <div className="pn-folha-pad" />
    </Folha>
  )
}
