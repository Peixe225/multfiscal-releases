/**
 * <Button variant="primary" size="lg" iconRight={ArrowRight}>Começar carreira</Button>
 * <Button variant="gold" size="xl">Continuar</Button>
 * <Button variant="ghost" size="sm" icon={Save} loading>Salvando</Button>
 * <Button href="#/hall" variant="outline">Hall da Fama</Button>      // renders <a>
 * <IconButton label="Som" icon={Volume2} pressed={sound} dot />
 */
import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ComponentType, type ReactNode } from 'react'
import { LoaderCircle, type LucideProps } from 'lucide-react'
import { cx } from './cx'
import { sfx, type SfxName } from '@/ui/shell/sfx'

export type ButtonVariant = 'primary' | 'gold' | 'ghost' | 'outline' | 'text' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl'
type IconType = ComponentType<LucideProps>

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'lx-btn--primary',
  gold: 'lx-btn--gold',
  ghost: 'lx-btn--ghost',
  outline: 'lx-btn--outline',
  text: 'lx-btn--text',
  danger: 'lx-btn--danger-soft',
}
const SIZE: Record<ButtonSize, string> = { sm: 'lx-btn--sm', md: 'lx-btn--md', lg: '', xl: 'lx-btn--xl' }

interface CommonProps {
  variant?: ButtonVariant
  /** sm 38 · md 44 · lg 50 (default) · xl 56 */
  size?: ButtonSize
  icon?: IconType
  iconRight?: IconType
  /** Fully rounded (pill) instead of r14. */
  pill?: boolean
  block?: boolean
  loading?: boolean
  /** Keyboard hint shown on desktop (e.g. "Enter"). */
  kbd?: string
  /** Sound on press (default 'click'; false = silent). */
  sfx?: SfxName | false
  children?: ReactNode
}

export type ButtonProps = CommonProps & ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined }
export type LinkButtonProps = CommonProps & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }

function inner({ icon: Ico, iconRight: IcoR, loading, kbd, children }: CommonProps) {
  return (
    <>
      {loading ? <LoaderCircle className="lx-spin" aria-hidden /> : Ico ? <Ico aria-hidden /> : null}
      {children != null && <span className="truncate">{children}</span>}
      {IcoR && !loading && <IcoR aria-hidden />}
      {kbd && (
        <kbd className="lx-kbd" aria-hidden="true">
          {kbd}
        </kbd>
      )}
    </>
  )
}

export const Button = forwardRef<HTMLButtonElement | HTMLAnchorElement, ButtonProps | LinkButtonProps>(function Button(props, ref) {
  const { variant = 'ghost', size = 'lg', icon, iconRight, pill, block, loading, kbd, sfx: sound = 'click', className, children, ...rest } = props
  const cls = cx('lx-btn', VARIANT[variant], SIZE[size], pill && 'lx-btn--pill', block && 'lx-btn--block', loading && 'is-loading', className)
  const content = inner({ icon, iconRight, loading, kbd, children })
  if ('href' in rest && rest.href != null) {
    const { onClick, ...a } = rest as AnchorHTMLAttributes<HTMLAnchorElement>
    return (
      <a
        ref={ref as React.Ref<HTMLAnchorElement>}
        className={cls}
        {...a}
        onClick={(e) => {
          if (sound) sfx.play(sound)
          onClick?.(e)
        }}
      >
        {content}
      </a>
    )
  }
  const { onClick, type = 'button', disabled, ...b } = rest as ButtonHTMLAttributes<HTMLButtonElement>
  return (
    <button
      ref={ref as React.Ref<HTMLButtonElement>}
      type={type}
      className={cls}
      disabled={disabled}
      aria-busy={loading || undefined}
      {...b}
      onClick={(e) => {
        if (loading) return
        if (sound) sfx.play(sound)
        onClick?.(e)
      }}
    >
      {content}
    </button>
  )
})

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Accessible name (also the tooltip). Required. */
  label: string
  icon: IconType
  /** Toggle state (aria-pressed). */
  pressed?: boolean
  /** Amber notification dot. */
  dot?: boolean
  /** Small counter under the icon ("12/48"). */
  count?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  sfx?: SfxName | false
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon: Ico, pressed, dot, count, size = 'md', sfx: sound = 'tap', className, onClick, type = 'button', title, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={title ?? label}
      aria-pressed={pressed}
      className={cx('lx-icon-btn', size === 'lg' && 'lx-icon-btn--lg', size === 'sm' && 'lx-icon-btn--sm', className)}
      style={{ position: 'relative' }}
      onClick={(e) => {
        if (sound) sfx.play(sound)
        onClick?.(e)
      }}
      {...rest}
    >
      <Ico aria-hidden />
      {dot && <span className="lx-icon-btn__dot" aria-hidden="true" />}
      {count != null && <span className="lx-icon-btn__count num">{count}</span>}
    </button>
  )
})
