// O "beck bolado" do Teste minha sorte: um tubo de seda enrolado, e só isso. Em pé: ponta torcida em cima,
// piteira embaixo. viewBox 0 0 60 240.
// Regras (ver PALAVRAS_PROIBIDAS em src/dados/sorte.ts): nada saindo do tubo, sem folha, broto, fumaça, ponta acesa
// ou cinza; piteira de papel cru com o "M" à vista na boca, nunca cor de cortiça (lê como cigarro).
// Papel pela marca do prêmio: branco (OCB) ou natural (RAW). As 3 partes são <g data-parte> para a revelação
// animar cada uma (a piteira cai, a torcida desenrosca, o tubo vira a faixa de cola do cartão).
import { PadraoFibras } from './papel-livreto'

export type Papel = 'branco' | 'natural'

/** Tons do papel: claro (reflexo), base e escuro (bordas do cilindro). O cartão do prêmio usa os mesmos. */
export const TONS_PAPEL: Record<Papel, { claro: string; base: string; escuro: string; fibra: number; finas: boolean }> = {
  branco: { claro: '#fdfdfb', base: '#f1f1ee', escuro: '#d7d7d2', fibra: 0.22, finas: true },
  natural: { claro: '#f3e6cf', base: '#e6d4b4', escuro: '#c9b08a', fibra: 0.8, finas: false },
}

const PITEIRA = { claro: '#f3ead6', base: '#e9dcc0', escuro: '#c8b48c', traco: '#a8936a' }

// tubo levemente cônico: boca (piteira) com d = 26, ponta com 1,35d ≈ 35, comprimento ~6,8d
const TUBO = 'M12.5 37Q30 32.5 47.5 37L43 212Q30 216.5 17 212Z'
const TORCIDA = 'M12.6 37.5C13.6 27 21 19.5 26.4 12.6L30.6 3.6L34.4 11.4C38.6 18.4 46.4 27.2 47.4 37.5Q30 33 12.6 37.5Z'
const PITEIRA_LADO = 'M17 196Q30 199.5 43 196L43 212Q30 216.5 17 212Z'

export function Beck({ id, papel = 'natural' }: { id: string; papel?: Papel }) {
  const t = TONS_PAPEL[papel]
  const u = (s: string) => `${id}-${s}`
  return (
    <svg viewBox="0 0 60 240" width="100%" height="100%" aria-hidden="true" focusable="false" overflow="visible">
      <defs>
        <linearGradient id={u('cil')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={t.escuro} />
          <stop offset="0.12" stopColor={t.base} />
          <stop offset="0.26" stopColor={t.claro} />
          <stop offset="0.36" stopColor={t.claro} />
          <stop offset="0.55" stopColor={t.base} />
          <stop offset="0.82" stopColor={t.escuro} />
          <stop offset="0.94" stopColor={t.base} />
          <stop offset="1" stopColor={t.escuro} />
        </linearGradient>
        <linearGradient id={u('pit')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={PITEIRA.escuro} />
          <stop offset="0.28" stopColor={PITEIRA.claro} />
          <stop offset="0.6" stopColor={PITEIRA.base} />
          <stop offset="1" stopColor={PITEIRA.escuro} />
        </linearGradient>
        <PadraoFibras id={u('fib')} escura="#6b5636" clara="#ffffff" forca={t.fibra} finas={t.finas} />
        <clipPath id={u('ct')}>
          <path d={TUBO} />
        </clipPath>
      </defs>

      <g data-parte="tubo">
        <path d={TUBO} fill={`url(#${u('cil')})`} />
        <path d={TUBO} fill={`url(#${u('fib')})`} />
        {/* costura do papel enrolado, a 12° e quase sumida */}
        <g clipPath={`url(#${u('ct')})`}>
          <path d="M50 40L14 210" stroke="#000" strokeWidth="0.9" opacity="0.08" />
        </g>
      </g>

      <g data-parte="ponta">
        <path d={TORCIDA} fill={`url(#${u('cil')})`} />
        <path d={TORCIDA} fill={`url(#${u('fib')})`} />
        {/* 3 dobras da torcida, fechada */}
        <g fill="none" stroke={t.escuro} strokeLinecap="round">
          <path d="M16 34C19 26 24 18 29.4 9" strokeWidth="1.1" opacity="0.9" />
          <path d="M25 35.5C27 27 29 18 31.4 7" strokeWidth="1" opacity="0.8" />
          <path d="M40 34.5C37 26 34.6 18 32.6 9" strokeWidth="1" opacity="0.7" />
        </g>
        <path d="M21 31C23 24 26.5 18 29.6 12" fill="none" stroke="#fff" strokeWidth="0.9" opacity="0.6" strokeLinecap="round" />
      </g>

      <g data-parte="piteira">
        <path d={PITEIRA_LADO} fill={`url(#${u('cil')})`} />
        <path d={PITEIRA_LADO} fill={`url(#${u('pit')})`} opacity="0.55" />
        <path d="M17 196Q30 199.5 43 196" fill="none" stroke={t.escuro} strokeWidth="0.7" opacity="0.7" />
        {/* boca: o papel cru dobrado em "M" à vista */}
        <ellipse cx="30" cy="212.2" rx="13" ry="3.9" fill={PITEIRA.base} stroke={PITEIRA.escuro} strokeWidth="0.8" />
        <path d="M19.5 212.6L23 210L26.4 214.4L30 209.7L33.6 214.4L37 210L40.5 212.6" fill="none" stroke={PITEIRA.traco} strokeWidth="0.9" strokeLinejoin="round" />
      </g>
    </svg>
  )
}
