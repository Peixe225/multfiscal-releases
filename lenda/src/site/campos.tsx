/**
 * Peças dos formulários do site (conta, perfil): campo com rótulo e erro, senha com mostrar/ocultar,
 * seletor de estado, e o ajuste do diálogo quando o teclado do celular abre.
 */
import { useEffect, useId, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'
import { UFS } from './conta'

/** Altura do teclado virtual em --sc-kb (o bottom sheet sobe junto) enquanto o diálogo está aberto. */
export function useTecladoVirtual(ativo: boolean) {
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!ativo || !vv) return
    const root = document.documentElement
    const medir = () => {
      const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))
      root.style.setProperty('--sc-kb', kb > 60 ? `${kb}px` : '0px')
    }
    medir()
    vv.addEventListener('resize', medir)
    vv.addEventListener('scroll', medir)
    return () => {
      vv.removeEventListener('resize', medir)
      vv.removeEventListener('scroll', medir)
      root.style.removeProperty('--sc-kb')
    }
  }, [ativo])
}

/** Ao focar um campo no celular, ele (e o botão logo abaixo) vão para o meio da área visível. */
export function aoFocarRolar(e: React.FocusEvent<HTMLElement>) {
  const el = e.currentTarget
  if (typeof matchMedia === 'function' && !matchMedia('(max-width: 44.99rem)').matches) return
  window.setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 280)
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

export function CampoSenha({ label, value, onChange, erro, dica, novo, autoFoco, id: idProp, enterKeyHint }: { label: ReactNode; value: string; onChange: (v: string) => void; erro?: string | null; dica?: ReactNode; novo?: boolean; autoFoco?: boolean; id?: string; enterKeyHint?: InputHTMLAttributes<HTMLInputElement>['enterKeyHint'] }) {
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
