/**
 * Arte de card de evento da carreira.
 *
 *   <EventArt art="training_extra-accept" className="h-40" />
 *
 * `art` é a chave de arte da opção/decisão (`${eventKey}-${optionKey}`, ver ./photos.ts).
 * Com foto: `object-fit: cover`, gradiente escuro por cima (o texto do card respira), vinheta e
 * grão sutil — no raio `--radius-lg` do tema Noite. Sem foto (ou se ela falhar): ilustração de
 * reserva com gradiente do tema + ícone lucide. `children` é desenhado por cima (título, chips…).
 */
import { useState, type CSSProperties, type ReactNode } from 'react'
import {
  Banknote,
  BookOpen,
  Clapperboard,
  Crown,
  Dumbbell,
  Flag,
  HeartPulse,
  Heart,
  Mic,
  PenLine,
  Plane,
  Shirt,
  Smartphone,
  Sparkles,
  Stethoscope,
  TreePalm,
  Trophy,
  Users,
  PenTool,
  type LucideIcon,
} from 'lucide-react'
import { photoFor, themeFor, type PhotoTheme } from './photos'

export interface EventArtProps {
  /** Chave de arte do card (`${eventKey}-${optionKey}`, "retirement", "injury-continue"…). */
  art: string
  className?: string
  style?: CSSProperties
  /** Texto alternativo; sem ele a imagem é decorativa. */
  alt?: string
  /** Proporção do quadro quando o pai não fixa a altura (padrão 16/9). */
  ratio?: number | string
  /** `object-position` da foto (padrão "center"). */
  position?: string
  /** Cor do clube para um brilho discreto no canto (hex/rgb/var()). */
  tint?: string
  /** Código FIFA do jogador — libera fotos específicas por seleção. */
  nationality?: string
  /** Sal para variar a foto entre carreiras (mantém o determinismo). */
  salt?: string | number
  /** Carrega sem lazy (card acima da dobra). */
  priority?: boolean
  children?: ReactNode
}

/** Grão (feTurbulence) em data URI — leve e sem requisição. */
const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .5  0 0 0 0 .5  0 0 0 0 .5  0 0 0 .9 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")"

const SHADE =
  'linear-gradient(180deg, rgba(7,8,12,.06) 0%, rgba(7,8,12,.22) 40%, rgba(7,8,12,.62) 72%, rgba(7,8,12,.9) 100%)'
const VIGNETTE = 'radial-gradient(140% 100% at 50% 35%, transparent 55%, rgba(0,0,0,.45) 100%)'

/** Ilustração de reserva: [ícone, cor A, cor B] por tema. */
const FALLBACK: Record<PhotoTheme | 'default', [LucideIcon, string, string]> = {
  injury: [HeartPulse, '#5b1a24', '#1a0c12'],
  training: [Dumbbell, '#16432c', '#0b1a13'],
  rest: [TreePalm, '#0f4a55', '#0a1a22'],
  press: [Mic, '#2c2f45', '#0f1018'],
  phone: [Smartphone, '#3b2257', '#120c1d'],
  contract: [PenLine, '#4a3a17', '#15110a'],
  crowd: [Users, '#1d3a5c', '#0b1320'],
  celebration: [Trophy, '#5a4210', '#17120a'],
  locker: [Shirt, '#21345a', '#0c1220'],
  national: [Flag, '#1f4d35', '#0b1811'],
  airport: [Plane, '#24425e', '#0c141d'],
  money: [Banknote, '#2f4f1c', '#0e160a'],
  doctor: [Stethoscope, '#1d4a4f', '#0b1719'],
  tattoo: [PenTool, '#4b2140', '#160b14'],
  school: [BookOpen, '#4a3320', '#150f0b'],
  family: [Heart, '#57283a', '#180c12'],
  tv: [Clapperboard, '#3a2a55', '#110c1a'],
  captain: [Crown, '#5a4513', '#16110a'],
  default: [Sparkles, '#2a2e3d', '#0e1016'],
}

export function EventArt({
  art,
  className,
  style,
  alt,
  ratio = '16 / 9',
  position = 'center',
  tint,
  nationality,
  salt,
  priority,
  children,
}: EventArtProps) {
  const src = photoFor(art, { nationality, salt })
  const [failed, setFailed] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<string | null>(null)
  const showPhoto = !!src && failed !== src
  const theme = themeFor(art)
  const [Icon, c1, c2] = FALLBACK[theme ?? 'default']

  return (
    <div
      className={['lx-event-art', className].filter(Boolean).join(' ')}
      data-art={art}
      style={{
        position: 'relative',
        overflow: 'hidden',
        isolation: 'isolate',
        borderRadius: 'var(--radius-lg, 20px)',
        aspectRatio: typeof ratio === 'number' ? String(ratio) : ratio,
        background: showPhoto
          ? 'var(--surface-2, #12141b)'
          : `radial-gradient(120% 90% at 78% 18%, ${c1} 0%, transparent 62%), linear-gradient(160deg, ${c1} 0%, ${c2} 70%)`,
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.06)',
        ...style,
      }}
    >
      {showPhoto ? (
        <img
          src={src}
          alt={alt ?? ''}
          aria-hidden={alt ? undefined : true}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(src)}
          onError={() => setFailed(src)}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: position,
            filter: 'saturate(.9) contrast(1.05)',
            opacity: loaded === src ? 1 : 0,
            transform: loaded === src ? 'scale(1)' : 'scale(1.03)',
            transition: 'opacity 420ms ease-out, transform 900ms cubic-bezier(.2,.7,.2,1)',
            zIndex: -3,
          }}
        />
      ) : (
        <FallbackArt Icon={Icon} label={alt} />
      )}

      {tint && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: -2,
            background: `radial-gradient(90% 80% at 0% 100%, ${tint} 0%, transparent 65%)`,
            mixBlendMode: 'soft-light',
            opacity: 0.75,
            pointerEvents: 'none',
          }}
        />
      )}

      {/* gradiente de leitura + vinheta */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: -2,
          background: showPhoto ? `${SHADE}, ${VIGNETTE}` : VIGNETTE,
          pointerEvents: 'none',
        }}
      />
      {/* grão */}
      <div
        aria-hidden
        className="lx-event-art__grain"
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: -1,
          backgroundImage: GRAIN,
          backgroundSize: '160px 160px',
          mixBlendMode: 'overlay',
          opacity: showPhoto ? 0.16 : 0.22,
          pointerEvents: 'none',
        }}
      />
      {children}
    </div>
  )
}

function FallbackArt({ Icon, label }: { Icon: LucideIcon; label?: string }) {
  return (
    <div
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ position: 'absolute', inset: 0, zIndex: -3, pointerEvents: 'none' }}
    >
      {/* pinstripe diagonal do tema */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'repeating-linear-gradient(125deg, rgba(255,255,255,.035) 0 1px, transparent 1px 9px)',
        }}
      />
      {/* ícone grande, sangrando para fora do quadro */}
      <Icon
        strokeWidth={1.1}
        style={{
          position: 'absolute',
          right: '-6%',
          top: '50%',
          width: '62%',
          height: 'auto',
          maxHeight: '130%',
          transform: 'translateY(-50%) rotate(-8deg)',
          color: 'rgba(255,255,255,.07)',
        }}
      />
      {/* ícone de destaque */}
      <Icon
        strokeWidth={1.6}
        style={{
          position: 'absolute',
          left: '50%',
          top: '44%',
          width: 'clamp(28px, 22%, 72px)',
          height: 'auto',
          transform: 'translate(-50%, -50%)',
          color: 'rgba(255,255,255,.82)',
          filter: 'drop-shadow(0 6px 18px rgba(0,0,0,.45))',
        }}
      />
    </div>
  )
}
