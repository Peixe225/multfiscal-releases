/**
 * LENDA custom icons (1.9px stroke, 24 grid — same metrics as lucide) for football things
 * lucide lacks. They accept the same props as lucide icons, so they can be passed anywhere
 * an `icon={…}` prop is expected.
 *
 *   <BallIcon size={14} />  <BootIcon />  <ShirtIcon />  <PitchIcon />  <LoanIcon />  <StadiumIcon />
 *   <WhistleIcon />  <CardsIcon />  <GlovesIcon />  <MedalIcon />  <FootIcon />
 *   <Icon icon={Trophy} size={16} label="Títulos" />   // wrapper: decorative unless `label`
 */
import { forwardRef, type ComponentType } from 'react'
import type { LucideProps } from 'lucide-react'

function make(name: string, body: React.ReactNode) {
  const C = forwardRef<SVGSVGElement, LucideProps>(function LxIcon({ size = 24, strokeWidth = 1.9, color = 'currentColor', className, ...rest }, ref) {
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden={rest['aria-label'] ? undefined : true}
        {...rest}
      >
        {body}
      </svg>
    )
  })
  C.displayName = name
  return C as unknown as ComponentType<LucideProps>
}

export const BallIcon = make('BallIcon', (
  <>
    <circle cx="12" cy="12" r="10" />
    <path d="m12 7.2 4.2 3-1.6 4.8H9.4L7.8 10.2z" />
    <path d="M12 7.2V2.3M16.2 10.2l4.6-1.5M14.6 15l2.9 4M9.4 15l-2.9 4M7.8 10.2 3.2 8.7" />
  </>
))
export const BootIcon = make('BootIcon', (
  <>
    <path d="M3.5 5.5h5.2l1 3.6 3.3 2.1 5.4 1.3a3 3 0 0 1 2.3 2.9v1.1H3.5z" />
    <path d="M6 16.5v2.2M10 16.5v2.2M17 16.5v2.2" />
  </>
))
export const ShirtIcon = make('ShirtIcon', <path d="M20.4 3.5 16 2a4 4 0 0 1-8 0L3.6 3.5a2 2 0 0 0-1.3 2.2l.6 3.5a1 1 0 0 0 1 .8H6v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V10h2.2a1 1 0 0 0 1-.8l.5-3.5a2 2 0 0 0-1.3-2.2z" />)
export const PitchIcon = make('PitchIcon', (
  <>
    <rect x="2.5" y="4.5" width="19" height="15" rx="2" />
    <path d="M12 4.5v15" />
    <circle cx="12" cy="12" r="2.6" />
    <path d="M2.5 9h2.6v6H2.5M21.5 9h-2.6v6h2.6" />
  </>
))
export const LoanIcon = make('LoanIcon', (
  <>
    <path d="m15 10 5 5-5 5" />
    <path d="M4 4v7a4 4 0 0 0 4 4h12" />
  </>
))
export const StadiumIcon = make('StadiumIcon', (
  <>
    <ellipse cx="12" cy="12" rx="10" ry="6" />
    <ellipse cx="12" cy="12" rx="5" ry="2.6" />
    <path d="M2 12v3c0 3.3 4.5 6 10 6s10-2.7 10-6v-3" />
  </>
))
export const WhistleIcon = make('WhistleIcon', (
  <>
    <path d="M2 12a6 6 0 0 0 11.3 2.8L22 11V7h-9.6A6 6 0 0 0 2 12z" />
    <circle cx="8" cy="12" r="1.5" />
  </>
))
export const CardsIcon = make('CardsIcon', (
  <>
    <rect x="3" y="6" width="12" height="15" rx="2" />
    <path d="M8 3h11a2 2 0 0 1 2 2v13" />
  </>
))
export const GlovesIcon = make('GlovesIcon', (
  <>
    <path d="M7 21v-3.5L4.2 13a2 2 0 0 1 .6-2.6l.4-.3V5.5a1.5 1.5 0 0 1 3 0V9V4a1.5 1.5 0 0 1 3 0v5V4.5a1.5 1.5 0 0 1 3 0V10V6.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-2 5v2" />
    <path d="M7 18h9" />
  </>
))
export const MedalIcon = make('MedalIcon', (
  <>
    <path d="M7.2 15 2.7 7.1a2 2 0 0 1 .1-2.2l1.6-2.1A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.1a2 2 0 0 1 .1 2.2L16.8 15" />
    <path d="M11 12 5.1 2.2M13 12l5.9-9.8M8 7h8" />
    <circle cx="12" cy="17" r="5" />
    <path d="M12 18v-2h-.5" />
  </>
))
export const FootIcon = make('FootIcon', (
  <>
    <path d="M8 3c-2.5 0-4 2.5-4 6 0 2.5 1 4 1 6.5S4 21 7 21s3-2.5 3-5-.5-4 .5-6.5S10.5 3 8 3z" />
    <path d="M15 3.5h.01M18 5h.01M20 8h.01M20.5 11.5h.01" />
  </>
))
export const CleanSheetIcon = make('CleanSheetIcon', (
  <>
    <path d="M3 20V6h18v14" />
    <path d="M3 10h18M7 6v14M17 6v14M11 6v14" opacity=".45" />
    <path d="m9 14 2 2 4-4" />
  </>
))

/** Decorative-by-default wrapper; pass `label` to expose it to assistive tech. */
export function Icon({ icon: Ico, size = 18, label, strokeWidth, className, style }: { icon: ComponentType<LucideProps>; size?: number; label?: string; strokeWidth?: number; className?: string; style?: React.CSSProperties }) {
  return label ? (
    <Ico size={size} strokeWidth={strokeWidth} className={className} style={style} role="img" aria-label={label} />
  ) : (
    <Ico size={size} strokeWidth={strokeWidth} className={className} style={style} aria-hidden />
  )
}
