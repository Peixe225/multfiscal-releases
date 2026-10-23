/**
 * Peças dos formulários do site (conta, perfil): campo com rótulo e erro, senha com mostrar/ocultar,
 * seletor de estado, e o ajuste do diálogo quando o teclado do celular abre.
 */
import { useEffect, useId, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'
import { useIsDesktop, useIsTouch } from '@/ui/primitives'
import { UFS } from './conta'

/**
 * Enquanto o diálogo está aberto: a altura do teclado virtual em --sc-kb (o bottom sheet sobe junto) e a altura da janela em
 * --sc-ih (v3.5: a reserva do 92dvh no Safari < 15.4, site.css). E o painel do diálogo (overflow: hidden) nunca fica rolado:
 * o navegador o rola sozinho ao focar um campo com o teclado abrindo, e aí o título, o Fechar e a alça saíam da tela.
 */
export function useTecladoVirtual(ativo: boolean) {
  useEffect(() => {
    if (!ativo || typeof window === 'undefined') return
    const vv = window.visualViewport
    const root = document.documentElement
    const medir = () => {
      root.style.setProperty('--sc-ih', `${Math.round(window.innerHeight)}px`)
      if (!vv) return
      const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))
      root.style.setProperty('--sc-kb', kb > 60 ? `${kb}px` : '0px')
    }
    // o painel rolou (scroll não borbulha: escuta na captura): volta para o topo; quem rola é o corpo
    const travar = (e: Event) => {
      const el = e.target
      if (el instanceof HTMLElement && el.classList.contains('sc-modal') && el.scrollTop) el.scrollTop = 0
    }
    medir()
    vv?.addEventListener('resize', medir)
    vv?.addEventListener('scroll', medir)
    window.addEventListener('resize', medir)
    document.addEventListener('scroll', travar, true)
    return () => {
      vv?.removeEventListener('resize', medir)
      vv?.removeEventListener('scroll', medir)
      window.removeEventListener('resize', medir)
      document.removeEventListener('scroll', travar, true)
      root.style.removeProperty('--sc-kb')
      root.style.removeProperty('--sc-ih')
    }
  }, [ativo])
}

/**
 * Rola SÓ o corpo do diálogo (.lx-dialog__body) até deixar `el` à vista — nunca o painel do sheet, que tem overflow: hidden e
 * que o scrollIntoView também rolava (o cabeçalho sumia e sobrava uma faixa vazia embaixo). Fora de um diálogo, o
 * scrollIntoView de sempre. `bloco`: 'nearest' (só o necessário), 'center' ou 'start'.
 */
export function rolarNoDialogo(el: HTMLElement, bloco: 'nearest' | 'center' | 'start' = 'nearest', o: { suave?: boolean } = {}) {
  const suave = o.suave ?? !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  const behavior: ScrollBehavior = suave ? 'smooth' : 'auto'
  const corpo = el.closest<HTMLElement>('.lx-dialog__body')
  if (!corpo) {
    el.scrollIntoView({ block: bloco, behavior })
    return
  }
  const alvo = posicaoNoCorpo(corpo, el, bloco)
  if (alvo !== null) corpo.scrollTo({ top: alvo, behavior })
  // o painel em volta não rola (se o navegador já o tiver rolado, volta)
  const painel = corpo.parentElement
  if (painel && painel.scrollTop) painel.scrollTop = 0
}

/** Onde o corpo deve ficar (scrollTop) para mostrar `el`; null = já está à vista ('nearest'). Folga de 16 px em cima e 24 embaixo. */
export function posicaoNoCorpo(corpo: HTMLElement, el: HTMLElement, bloco: 'nearest' | 'center' | 'start'): number | null {
  const c = corpo.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  const topo = r.top - c.top + corpo.scrollTop
  const max = Math.max(0, corpo.scrollHeight - corpo.clientHeight)
  const limitar = (y: number) => Math.round(Math.min(max, Math.max(0, y)))
  if (bloco === 'start') return limitar(topo - 12)
  if (bloco === 'center') return limitar(topo - (corpo.clientHeight - r.height) / 2)
  const folgaCima = 16
  const folgaBaixo = 24
  if (r.top < c.top + folgaCima) return limitar(topo - folgaCima)
  if (r.bottom > c.top + corpo.clientHeight - folgaBaixo) return limitar(topo + r.height - corpo.clientHeight + folgaBaixo)
  return null
}

/**
 * Ao focar um campo no celular (depois de o teclado abrir): se o campo e o botão de enviar do formulário cabem juntos na área
 * visível do corpo do diálogo, os dois ficam à vista ("Confirmar e-mail" logo abaixo do código); senão, o campo vai para o meio.
 */
export function aoFocarRolar(e: React.FocusEvent<HTMLElement>) {
  const el = e.currentTarget
  if (typeof matchMedia === 'function' && !matchMedia('(max-width: 44.99rem), (pointer: coarse)').matches) return
  window.setTimeout(() => {
    if (!el.isConnected) return
    const corpo = el.closest<HTMLElement>('.lx-dialog__body')
    const botao = (el as HTMLInputElement).form?.querySelector<HTMLElement>('button[type="submit"]')
    if (corpo && botao && corpo.contains(botao)) {
      const alvo = posicaoJuntos(corpo, el, botao)
      if (alvo !== undefined) {
        if (alvo !== null) corpo.scrollTo({ top: alvo, behavior: 'smooth' })
        const painel = corpo.parentElement
        if (painel && painel.scrollTop) painel.scrollTop = 0
        return
      }
    }
    rolarNoDialogo(el, 'center')
  }, 280)
}

/**
 * Onde o corpo deve ficar para mostrar o campo E o botão abaixo dele (folga de 16 px em cima e 12 embaixo): null = os dois já
 * estão à vista; undefined = não cabem juntos (aí só o campo, no meio).
 */
export function posicaoJuntos(corpo: HTMLElement, campo: HTMLElement, botao: HTMLElement): number | null | undefined {
  const c = corpo.getBoundingClientRect()
  const a = campo.getBoundingClientRect()
  const b = botao.getBoundingClientRect()
  const topo = Math.min(a.top, b.top)
  const fim = Math.max(a.bottom, b.bottom)
  if (fim - topo > corpo.clientHeight - 28) return undefined
  const visTopo = c.top + 16
  const visFim = c.top + corpo.clientHeight - 12
  if (topo >= visTopo && fim <= visFim) return null
  const max = Math.max(0, corpo.scrollHeight - corpo.clientHeight)
  const desejado = fim > visFim ? corpo.scrollTop + (fim - visFim) : corpo.scrollTop - (visTopo - topo)
  return Math.round(Math.min(max, Math.max(0, desejado)))
}

/**
 * v3.5: o "Próximo" do teclado (Enter num campo com enterKeyHint="next") passa para o campo seguinte do formulário, em vez de
 * enviar (e acusar erro nos campos que a pessoa ainda nem tocou). No último campo (enterKeyHint "go"/"done"/"send"), envia.
 */
export function enterVaiParaOProximo(e: React.KeyboardEvent<HTMLFormElement>) {
  if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
  const el = e.target as HTMLElement
  if (!(el instanceof HTMLInputElement) || (el.getAttribute('enterkeyhint') ?? '') !== 'next') return
  const campos = [...e.currentTarget.querySelectorAll<HTMLElement>('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([disabled]):not([tabindex="-1"]), select:not([disabled]), textarea:not([disabled])')].filter(
    (x) => x.getClientRects().length > 0,
  )
  const i = campos.indexOf(el)
  const prox = i >= 0 ? campos[i + 1] : undefined
  if (!prox) return
  e.preventDefault()
  prox.focus()
}

/** Foco automático só com mouse e tela larga (no celular, o teclado subiria sozinho e cobriria o resto do diálogo). */
export function useAutoFoco(): boolean {
  const desktop = useIsDesktop()
  const toque = useIsTouch()
  return desktop && !toque
}

export function Erro({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p className="sc-err" id={id} role="alert">
      <TriangleAlert aria-hidden="true" />
      <span>{children}</span>
    </p>
  )
}

type CampoProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
  label: ReactNode
  /** Texto à direita do rótulo ("opcional"). */
  aside?: ReactNode
  value: string
  onChange: (v: string) => void
  erro?: string | null
  dica?: ReactNode
  autoFoco?: boolean
}

export function Campo({ label, aside, value, onChange, erro, dica, autoFoco, id: idProp, ...input }: CampoProps) {
  const auto = useId()
  const id = idProp ?? `sc${auto.replace(/:/g, '')}`
  const descr = [erro ? `${id}-e` : null, dica ? `${id}-d` : null].filter(Boolean).join(' ') || undefined
  return (
    <div className="sc-field">
      <label className="sc-label" htmlFor={id}>
        <span>{label}</span>
        {aside && <small>{aside}</small>}
      </label>
      <span className="lx-input sc-input" data-invalid={erro ? 'true' : undefined}>
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={erro ? true : undefined}
          aria-describedby={descr}
          onFocus={aoFocarRolar}
          {...(autoFoco ? { 'data-autofocus': true } : {})}
          {...input}
        />
      </span>
      {dica && !erro && (
        <p className="sc-hint" id={`${id}-d`}>
          {dica}
        </p>
      )}
      {erro && (
        <p className="sc-hint" id={`${id}-e`} style={{ color: 'var(--nx-negative-soft, #ffc3cd)' }}>
          {erro}
        </p>
      )}
    </div>
  )
}

export function CampoSenha({ label, value, onChange, erro, dica, novo, autoFoco, id: idProp, enterKeyHint, onBlur }: { label: ReactNode; value: string; onChange: (v: string) => void; erro?: string | null; dica?: ReactNode; novo?: boolean; autoFoco?: boolean; id?: string; enterKeyHint?: InputHTMLAttributes<HTMLInputElement>['enterKeyHint']; onBlur?: () => void }) {
  const [ver, setVer] = useState(false)
  const auto = useId()
  const id = idProp ?? `sc${auto.replace(/:/g, '')}`
  const descr = [erro ? `${id}-e` : null, dica ? `${id}-d` : null].filter(Boolean).join(' ') || undefined
  return (
    <div className="sc-field">
      <label className="sc-label" htmlFor={id}>
        <span>{label}</span>
      </label>
      <span className="lx-input sc-input" data-invalid={erro ? 'true' : undefined}>
        <input
          id={id}
          type={ver ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={novo ? 'new-password' : 'current-password'}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          minLength={6}
          maxLength={72}
          required
          enterKeyHint={enterKeyHint}
          aria-invalid={erro ? true : undefined}
          aria-describedby={descr}
          onFocus={aoFocarRolar}
          onBlur={onBlur}
          {...(autoFoco ? { 'data-autofocus': true } : {})}
        />
        <button type="button" className="sc-input__btn" aria-pressed={ver} aria-controls={id} onClick={() => setVer((v) => !v)}>
          {ver ? 'Ocultar' : 'Mostrar'}
          <span className="sc-sr"> a senha</span>
        </button>
      </span>
      {dica && !erro && (
        <p className="sc-hint" id={`${id}-d`}>
          {dica}
        </p>
      )}
      {erro && (
        <p className="sc-hint" id={`${id}-e`} style={{ color: 'var(--nx-negative-soft, #ffc3cd)' }}>
          {erro}
        </p>
      )}
    </div>
  )
}

const NOME_UF: Record<string, string> = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo',
  GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba',
  PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul',
  RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins',
}
export const nomeUf = (uf: string | null | undefined) => (uf === 'EX' ? 'Fora do Brasil' : uf ? (NOME_UF[uf] ?? uf) : null)

export function CampoUf({ value, onChange, label = 'Estado', aside }: { value: string; onChange: (v: string) => void; label?: ReactNode; aside?: ReactNode }) {
  const auto = useId()
  const id = `sc${auto.replace(/:/g, '')}`
  return (
    <div className="sc-field">
      <label className="sc-label" htmlFor={id}>
        <span>{label}</span>
        {aside && <small>{aside}</small>}
      </label>
      <span className="lx-input sc-input">
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)} onFocus={aoFocarRolar}>
          <option value="">Prefiro não dizer</option>
          {UFS.map((u) => (
            <option key={u} value={u}>
              {NOME_UF[u]} ({u})
            </option>
          ))}
          <option value="EX">Fora do Brasil</option>
        </select>
      </span>
    </div>
  )
}
