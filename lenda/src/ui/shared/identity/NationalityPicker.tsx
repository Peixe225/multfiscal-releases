/** 02 Nacionalidade — search (accent-insensitive, FIFA code), popular chips, featured-first 2-column list. */
import { memo, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { Check, Globe2, Search, X } from 'lucide-react'
import type { Country } from '@/engine/types'
import { Flag, Kbd, useHotkey, useIsTouch } from '@/ui/primitives'
import { sfx } from '@/ui/shell/sfx'
import { countryLists, nationLine, POPULAR, searchCountries } from './countries'

export interface NationalityPickerProps {
  countries: Country[]
  value: string | null
  onChange: (code: string) => void
  searchRef?: RefObject<HTMLInputElement | null>
  autoFocusSearch?: boolean
}

export const NationalityPicker = memo(function NationalityPicker({ countries, value, onChange, searchRef, autoFocusSearch }: NationalityPickerProps) {
  const [q, setQ] = useState('')
  const touch = useIsTouch()
  const localRef = useRef<HTMLInputElement>(null)
  const inputRef = searchRef ?? localRef
  const gridRef = useRef<HTMLDivElement>(null)
  const lists = useMemo(() => countryLists(countries), [countries])
  const results = useMemo(() => (q.trim() ? searchCountries(countries, q) : null), [countries, q])
  const byCode = useMemo(() => new Map(countries.map((c) => [c.code, c])), [countries])
  const selected = value ? byCode.get(value) : undefined
  const popular = POPULAR.filter((c) => c !== value)
    .map((c) => byCode.get(c))
    .filter((c): c is Country => !!c)
    .slice(0, 4)

  useHotkey('/', (e) => {
    e.preventDefault()
    inputRef.current?.focus()
  })

  const pick = (c: Country) => {
    if (c.code !== value) sfx.play('tap')
    onChange(c.code)
  }

  // roving focus over the visible radios (←/→ ±1, ↑/↓ ±2 columns, Home/End)
  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement
    if (t.getAttribute('role') !== 'radio') return
    const all = [...(gridRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [])]
    const i = all.indexOf(t as HTMLButtonElement)
    if (i < 0) return
    const cols = getComputedStyle(t.parentElement!).gridTemplateColumns.split(' ').length || 1
    const step: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }
    let j = -1
    if (e.key in step) j = Math.max(0, Math.min(all.length - 1, i + step[e.key]))
    else if (e.key === 'Home') j = 0
    else if (e.key === 'End') j = all.length - 1
    else return
    e.preventDefault()
    all[j]?.focus()
    all[j]?.scrollIntoView({ block: 'nearest' })
  }

  const row = (c: Country, i: number, tabbable: boolean) => {
    const on = c.code === value
    return (
      <button
        key={c.code}
        type="button"
        role="radio"
        aria-checked={on}
        tabIndex={tabbable ? 0 : -1}
        className="id-ct"
        onClick={() => pick(c)}
        data-i={i}
      >
        <Flag code={c.code} iso2={c.iso2} h={24} w={32} radius={4} decorative />
        <span className="id-ct__name">{c.name}</span>
        {on && (
          <span className="id-ct__chk" aria-hidden="true">
            <Check size={13} strokeWidth={3.2} />
          </span>
        )}
      </button>
    )
  }

  const visible = results ?? [...lists.featured, ...lists.others]
  const tabCode = visible.some((c) => c.code === value) ? value : visible[0]?.code

  return (
    <>
      <div className="id-search">
        <Search size={16} className="id-search__ic" aria-hidden />
        <label className="lx-input">
          <span className="sr-only">Buscar país</span>
          <input
            ref={inputRef}
            type="search"
            inputMode="search"
            autoComplete="off"
            spellCheck={false}
            placeholder="Buscar país"
            value={q}
            autoFocus={autoFocusSearch}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results?.[0]) {
                e.preventDefault()
                pick(results[0])
              } else if (e.key === 'Escape' && q) {
                e.preventDefault()
                e.stopPropagation()
                setQ('')
              } else if (e.key === 'ArrowDown') {
                e.preventDefault()
                gridRef.current?.querySelector<HTMLButtonElement>('[role="radio"]')?.focus()
              }
            }}
            aria-controls="id-nation-list"
            aria-describedby="id-nation-help"
          />
          {q ? (
            <button type="button" className="grid place-items-center w-7 h-7 -mr-1.5 rounded-[8px] text-text-3 hover:text-text hover:bg-surface-2" aria-label="Limpar busca" onClick={() => { setQ(''); inputRef.current?.focus() }}>
              <X size={15} aria-hidden />
            </button>
          ) : (
            !touch && <Kbd>/</Kbd>
          )}
        </label>
        <span id="id-nation-help" className="sr-only">
          Digite o nome do país ou o código FIFA, por exemplo BRA. Enter escolhe o primeiro resultado.
        </span>
      </div>

      {!results && popular.length > 0 && (
        <div className="id-pop no-scrollbar" role="group" aria-label="Populares">
          <span className="id-pop__lbl">Populares</span>
          {popular.map((c) => (
            <button key={c.code} type="button" onClick={() => pick(c)}>
              <Flag code={c.code} iso2={c.iso2} h={13} w={18} decorative />
              {c.name}
            </button>
          ))}
        </div>
      )}
      {results && <div className="h-3" />}

      <div className="id-list">
        <div className="id-list__scroll" id="id-nation-list" ref={gridRef} role="radiogroup" aria-label="Nacionalidade" onKeyDown={onGridKey}>
          {results ? (
            results.length ? (
              <>
                <div className="id-list__sec" aria-live="polite">
                  {results.length} {results.length === 1 ? 'resultado' : 'resultados'}
                </div>
                <div className="id-grid">{results.map((c, i) => row(c, i, c.code === tabCode))}</div>
              </>
            ) : (
              <div className="id-empty" role="status">
                <Globe2 size={22} className="mx-auto mb-2 opacity-70" aria-hidden />
                Nenhum país encontrado nessa busca.
              </div>
            )
          ) : (
            <>
              <div className="id-grid">{lists.featured.map((c, i) => row(c, i, c.code === tabCode))}</div>
              <div className="id-list__sec">Todos os países · A–Z</div>
              <div className="id-grid">{lists.others.map((c, i) => row(c, lists.featured.length + i, c.code === tabCode))}</div>
            </>
          )}
        </div>
      </div>
      <div className="id-nation-line" aria-live="polite">
        {selected && (
          <>
            <Flag code={selected.code} iso2={selected.iso2} h={12} w={16} decorative />
            <span className="truncate">{nationLine(selected)}</span>
          </>
        )}
      </div>
    </>
  )
})
