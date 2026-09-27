/** Loading splash while GameData loads (fades out). */
import { motion } from 'motion/react'
import { BrandMark } from '@/ui/primitives'

export function Splash({ label = 'Carregando as tabelas de hoje…', error, onRetry }: { label?: string; error?: string | null; onRetry?: () => void }) {
  return (
    <motion.div className="lx-splash" initial={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.35 } }} role="status" aria-live="polite">
      <div className="lx-stage lx-stage--brand" aria-hidden="true" />
      <div className="relative grid place-items-center gap-5 text-center px-6">
        <div className="relative grid place-items-center w-[120px] h-[120px]">
          <span className="lx-splash__ring" aria-hidden />
          <span className="lx-splash__ring" style={{ animationDelay: '1.2s' }} aria-hidden />
          <BrandMark size={64} />
        </div>
        <div className="font-display font-black text-[28px] tracking-[.16em] leading-none">LENDA</div>
        {error ? (
          <div className="grid gap-3 place-items-center">
            <p className="text-[13.5px] text-negative m-0">Não foi possível carregar os dados. {error}</p>
            {onRetry && (
              <button type="button" className="lx-btn lx-btn--ghost lx-btn--sm" onClick={onRetry}>
                Tentar de novo
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
