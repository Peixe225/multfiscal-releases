/**
 * Modal dialog on desktop (≥ 720px), bottom sheet on phones. Focus trap, Esc, backdrop click,
 * scroll lock, focus restore, app root made `inert` while open. Sheet: drag the handle down to close.
 *
 *   <Modal open={open} onClose={close} title="Conquistas" description="12 de 48 desbloqueadas" size="lg"
 *     footer={<Button variant="primary" onClick={close}>Fechar</Button>}>
 *     …
 *   </Modal>
 *   <Sheet …/>   // always a bottom sheet     <Dialog …/>   // always centred
 */
import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useDragControls } from 'motion/react'
import { X } from 'lucide-react'
import { cx } from './cx'
import { useIsDesktop, useReducedMotion } from './hooks'
import { sfx } from '@/ui/shell/sfx'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  description?: ReactNode
  /** Optional element before the title (icon tile, trophy). */
  media?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  mode?: 'auto' | 'dialog' | 'sheet'
  /** false: Esc/backdrop/drag don't close (forced choices). */
  dismissible?: boolean
  hideClose?: boolean
  /** Accessible name when there is no visible title. */
  'aria-label'?: string
  initialFocusRef?: RefObject<HTMLElement | null>
  className?: string
  bodyClassName?: string
}

let lockCount = 0
function lockApp(on: boolean) {
  const root = document.getElementById('root')
  lockCount += on ? 1 : -1
  const locked = lockCount > 0
  document.documentElement.style.overflow = locked ? 'hidden' : ''
  if (root) {
    if (locked) root.setAttribute('inert', '')
    else root.removeAttribute('inert')
  }
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

/** Open modals, innermost last: only the top one answers Esc / Tab that reach the document. */
const stack: object[] = []

export function Modal(props: ModalProps) {
  const { open } = props
  return typeof document === 'undefined' ? null : createPortal(<AnimatePresence>{open && <ModalInner key="m" {...props} />}</AnimatePresence>, document.body)
}

export const Dialog = (p: Omit<ModalProps, 'mode'>) => <Modal {...p} mode="dialog" />
export const Sheet = (p: Omit<ModalProps, 'mode'>) => <Modal {...p} mode="sheet" />

function ModalInner({ onClose, title, description, media, children, footer, size = 'md', mode = 'auto', dismissible = true, hideClose, initialFocusRef, className, bodyClassName, ...rest }: ModalProps) {
  const desktop = useIsDesktop()
  const rm = useReducedMotion()
  const sheet = mode === 'sheet' || (mode === 'auto' && !desktop)
  const panel = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descId = useId()
  const drag = useDragControls()
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const dismissRef = useRef(dismissible)
  dismissRef.current = dismissible

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    lockApp(true)
    sfx.play('whoosh')
    const t = requestAnimationFrame(() => {
      const target = initialFocusRef?.current ?? panel.current?.querySelector<HTMLElement>('[data-autofocus]') ?? panel.current
      target?.focus({ preventScroll: true })
    })
    return () => {
      cancelAnimationFrame(t)
      lockApp(false)
      prev?.focus?.({ preventScroll: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Focus can fall out of the panel (the focused button unmounts → <body>): the panel's own onKeyDown
  // never sees the key then. Esc still closes the top modal, and Tab brings focus back inside.
  useEffect(() => {
    const me = {}
    stack.push(me)
    const onDocKey = (e: KeyboardEvent) => {
      const el = panel.current
      const lost = !document.activeElement || document.activeElement === document.body
      if (stack[stack.length - 1] !== me || !el || !lost) return
      if (e.key === 'Escape' && dismissRef.current) {
        e.preventDefault()
        closeRef.current()
      } else if (e.key === 'Tab') {
        e.preventDefault()
        const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => x.offsetParent !== null)
        ;((e.shiftKey ? items[items.length - 1] : items[0]) ?? el).focus()
      }
    }
    document.addEventListener('keydown', onDocKey)
    return () => {
      document.removeEventListener('keydown', onDocKey)
      stack.splice(stack.indexOf(me), 1)
    }
  }, [])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && dismissible) {
      e.stopPropagation()
      closeRef.current()
    }
    if (e.key !== 'Tab' || !panel.current) return
    const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement)
    if (!items.length) {
      e.preventDefault()
      return
    }
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  const ease = [0.16, 1, 0.3, 1] as const
  const head = (title || !hideClose || media) && (
    <div className="lx-dialog__head" onPointerDown={sheet && dismissible ? (e) => drag.start(e) : undefined} style={sheet ? { touchAction: 'none' } : undefined}>
      {media && <div className="flex-none">{media}</div>}
      <div className="min-w-0 flex-1">
        {title && (
          <h2 id={titleId} className="lx-dialog__title">
            {title}
          </h2>
        )}
        {description && (
          <p id={descId} className="lx-dialog__desc">
            {description}
          </p>
        )}
      </div>
      {!hideClose && (
        <button type="button" className="lx-icon-btn lx-icon-btn--sm flex-none" aria-label="Fechar" onClick={() => closeRef.current()} style={{ position: 'relative' }}>
          <X aria-hidden />
        </button>
      )}
    </div>
  )

  const body = (
    <>
      {sheet && (
        <div className="pt-1 pb-0.5" onPointerDown={dismissible ? (e) => drag.start(e) : undefined} style={{ touchAction: 'none', cursor: 'grab' }}>
          <div className="lx-sheet__handle" aria-hidden="true" />
        </div>
      )}
      {head}
      <div className={cx('lx-dialog__body', bodyClassName)}>{children}</div>
      {footer && <div className="lx-dialog__foot">{footer}</div>}
    </>
  )

  const aria = {
    role: 'dialog' as const,
    'aria-modal': true,
    'aria-labelledby': title ? titleId : undefined,
    'aria-describedby': description ? descId : undefined,
    'aria-label': title ? undefined : rest['aria-label'],
    tabIndex: -1,
    onKeyDown,
  }

  return (
    <>
      <motion.div
        className="lx-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={() => dismissible && closeRef.current()}
        aria-hidden="true"
      />
      {sheet ? (
        <div className="lx-sheet-wrap">
          <motion.div
            ref={panel}
            {...aria}
            className={cx('lx-sheet', className)}
            initial={rm ? { opacity: 0 } : { y: '100%' }}
            animate={rm ? { opacity: 1 } : { y: 0 }}
            exit={rm ? { opacity: 0 } : { y: '100%', transition: { duration: 0.24, ease: [0.4, 0, 1, 1] } }}
            transition={rm ? { duration: 0.15 } : { type: 'spring', stiffness: 380, damping: 38, mass: 0.9 }}
            drag={dismissible ? 'y' : false}
            dragListener={false}
            dragControls={drag}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.05, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 110 || info.velocity.y > 650) closeRef.current()
            }}
          >
            {body}
          </motion.div>
        </div>
      ) : (
        <div className="lx-dialog-wrap">
          <motion.div
            ref={panel}
            {...aria}
            className={cx('lx-dialog', `lx-dialog--${size}`, className)}
            initial={rm ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={rm ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 8, transition: { duration: 0.16 } }}
            transition={{ duration: 0.28, ease }}
          >
            {body}
          </motion.div>
        </div>
      )}
    </>
  )
}
