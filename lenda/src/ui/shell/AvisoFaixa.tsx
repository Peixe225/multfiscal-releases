/**
 * Faixa discreta no topo com o aviso do site (site_config.aviso, editado no painel — servidor/CONTRATO-v3.md
 * §1). Fecha no X e não volta para o mesmo texto neste aparelho; um aviso novo aparece de novo. Fora do site
 * o aviso é sempre null e nada aparece.
 */
import { useEffect, useState } from 'react'
import { Info, TriangleAlert, X } from 'lucide-react'
import { useAcesso } from '@/store/acesso'
import { cx } from '@/ui/primitives'
import './aviso.css'

const CHAVE = 'lenda:aviso-fechado'

/** Assinatura curta do texto (o que foi fechado), sem guardar o texto inteiro. */
export function assinaturaAviso(texto: string): string {
  let h = 2166136261
  for (let i = 0; i < texto.length; i++) h = Math.imul(h ^ texto.charCodeAt(i), 16777619)
  return (h >>> 0).toString(36)
}

const lerFechado = () => {
  try {
    return localStorage.getItem(CHAVE)
  } catch {
    return null
  }
}

export function AvisoFaixa() {
  const aviso = useAcesso((s) => s.aviso)
  const [fechado, setFechado] = useState<string | null>(lerFechado)
  const ass = aviso ? assinaturaAviso(`${aviso.tipo}:${aviso.texto}`) : ''
  useEffect(() => setFechado(lerFechado()), [ass])
  if (!aviso || fechado === ass) return null
  const Ico = aviso.tipo === 'alerta' ? TriangleAlert : Info
  return (
    <div className={cx('lx-aviso', aviso.tipo === 'alerta' && 'lx-aviso--alerta')} role={aviso.tipo === 'alerta' ? 'alert' : 'status'}>
      <Ico className="lx-aviso__i" aria-hidden="true" />
      <p className="lx-aviso__t">{aviso.texto}</p>
      <button
        type="button"
        className="lx-aviso__x"
        aria-label="Fechar aviso"
        onClick={() => {
          setFechado(ass)
          try {
            localStorage.setItem(CHAVE, ass)
          } catch {
            /* sem storage: fecha só agora */
          }
        }}
      >
        <X aria-hidden="true" />
      </button>
    </div>
  )
}
