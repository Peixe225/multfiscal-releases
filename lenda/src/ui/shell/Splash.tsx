/**
 * Loading splash while GameData loads (fades out). Com erro: uma frase em pt-BR para quem joga (a mensagem técnica
 * fica no console; o admin vê com `debug`) e "Tentar de novo", que refaz o carregamento sem recarregar a página.
 */
import { motion } from 'motion/react'
import { RotateCcw, WifiOff } from 'lucide-react'
import { BrandMark } from '@/ui/primitives'

export function Splash({ label = 'Carregando as tabelas de hoje…', error, debug, onRetry }: { label?: string; error?: string | null; debug?: boolean; onRetry?: () => void }) {
  return (
    <motion.div className="lx-splash" initial={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.35 } }} role="status" aria-live="polite">
      <div className="lx-stage lx-stage--brand" aria-hidden="true" />
      <div className="relative grid place-items-center gap-5 text-center px-6 max-w-[420px]">
        <div className="relative grid place-items-center w-[120px] h-[120px]">
          <span className="lx-splash__ring" aria-hidden />
          <span className="lx-splash__ring" style={{ animationDelay: '1.2s' }} aria-hidden />
          <BrandMark size={64} />
        </div>
        <div className="font-display font-black text-[28px] tracking-[.16em] leading-none">LENDA</div>
        {error ? (
          <div className="grid gap-3 place-items-center" role="alert">
            <p className="text-[15px] leading-relaxed text-text m-0 flex items-start gap-2 text-left">
              <WifiOff size={18} className="text-negative flex-none mt-[3px]" aria-hidden />
              <span>Não deu para carregar as tabelas. Confira a internet e toque em Tentar de novo.</span>
            </p>
            {debug && <p className="text-[12px] text-text-3 m-0 break-words font-mono">{error}</p>}
            {onRetry && (
              <button type="button" className="lx-btn lx-btn--primary lx-btn--md" onClick={onRetry}>
                <RotateCcw aria-hidden /> Tentar de novo
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="lx-splash__bar" aria-hidden>
              <i />
            </div>
            <p className="text-[12.5px] font-semibold text-text-3 m-0 tracking-wide">{label}</p>
          </>
        )}
      </div>
    </motion.div>
  )
}
