// Peças pequenas do painel: ícone em pixel, campo com rótulo e erro ligados, aviso, carregando e botões.
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { PixelArte } from '../arte/PixelArte'
import { grade } from './icones'

export function Ic({ nome, tamanho = 24, titulo, className }: { nome: string; tamanho?: number; titulo?: string; className?: string }) {
  const g = grade(nome)
  if (!g) return null
  return <PixelArte grade={g} tamanho={tamanho} titulo={titulo} className={className} />
}

interface PropsAria {
  id: string
  'aria-invalid'?: true
  'aria-describedby'?: string
}

/** Campo com rótulo em cima, dica e erro embaixo, ligados ao controle (aria-describedby). */
export function Campo({
  id,
  rotulo,
  erro,
  dica,
  lado,
  className,
  children,
}: {
  id: string
  rotulo: ReactNode
  erro?: string | null
  dica?: ReactNode
  /** Algo à direita do rótulo (contador de letras, "opcional"). */
  lado?: ReactNode
  className?: string
  children: (aria: PropsAria) => ReactNode
}) {
  // com erro, a dica sai (o erro já diz o que fazer; as duas juntas repetiam a mesma regra)
  const mostrarDica = !!dica && !erro
  const desc = [erro ? `${id}-erro` : null, mostrarDica ? `${id}-dica` : null].filter(Boolean).join(' ')
  return (
    <div className={`pn-campo${erro ? ' pn-campo-erro' : ''}${className ? ` ${className}` : ''}`}>
      <div className="pn-rotulo-linha">
        <label htmlFor={id} className="pn-rotulo">
          {rotulo}
        </label>
        {lado}
      </div>
      {children({ id, ...(erro ? { 'aria-invalid': true as const } : {}), ...(desc ? { 'aria-describedby': desc } : {}) })}
      {erro && (
        <p id={`${id}-erro`} className="pn-erro">
          <Ic nome="atencao" tamanho={16} />
          <span>{erro}</span>
        </p>
      )}
      {mostrarDica && (
        <p id={`${id}-dica`} className="pn-dica">
          {dica}
        </p>
      )}
    </div>
  )
}

/** Aviso na tela. tipo 'erro' anuncia na hora (role=alert); 'ok' e 'info' entram como status. */
export function Aviso({ tipo = 'info', children, acao, className }: { tipo?: 'erro' | 'ok' | 'info'; children: ReactNode; acao?: ReactNode; className?: string }) {
  return (
    <div className={`pn-aviso pn-aviso-${tipo}${className ? ` ${className}` : ''}`} role={tipo === 'erro' ? 'alert' : 'status'}>
      <span className="pn-aviso-icone" aria-hidden="true">
        <Ic nome={tipo === 'erro' ? 'atencao' : tipo === 'ok' ? 'check' : 'sino'} tamanho={16} />
      </span>
      <div className="pn-aviso-texto">{children}</div>
      {acao && <div className="pn-aviso-acao">{acao}</div>}
    </div>
  )
}

/** Três pixels piscando em degrau (a casca do site). */
export function Pontinhos({ rotulo = 'Carregando…' }: { rotulo?: string }) {
  return (
    <span className="pn-pontinhos" role="status">
      <i aria-hidden="true" />
      <i aria-hidden="true" />
      <i aria-hidden="true" />
      <span className="sr-only">{rotulo}</span>
    </span>
  )
}

export function Carregando({ rotulo }: { rotulo?: string }) {
  return (
    <div className="pn-carregando">
      <Pontinhos rotulo={rotulo} />
    </div>
  )
}

/** Botão que mostra quando está trabalhando (e não aceita outro toque até terminar). */
export function Botao({
  ocupado = false,
  variante = 'cheio',
  largo = false,
  icone,
  children,
  className,
  disabled,
  ...resto
}: ButtonHTMLAttributes<HTMLButtonElement> & { ocupado?: boolean; variante?: 'cheio' | 'cinza' | 'contorno' | 'texto' | 'perigo'; largo?: boolean; icone?: string }) {
  return (
    <button
      type="button"
      {...resto}
      className={`pn-botao pn-botao-${variante}${largo ? ' pn-botao-largo' : ''}${ocupado ? ' pn-ocupado' : ''}${className ? ` ${className}` : ''}`}
      disabled={disabled}
      aria-disabled={ocupado || undefined}
      aria-busy={ocupado || undefined}
      onClick={ocupado ? (e) => e.preventDefault() : resto.onClick}
    >
      {icone && !ocupado && <Ic nome={icone} tamanho={16} />}
      {ocupado && <Pontinhos rotulo="Trabalhando…" />}
      <span className="pn-botao-txt">{children}</span>
    </button>
  )
}

/** Título da tela: recebe o foco quando a tela troca (o leitor de tela anuncia onde está). */
export function TituloTela({ children, className, focar = true }: { children: ReactNode; className?: string; focar?: boolean }) {
  const ref = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (!focar) return
    // só depois de uma navegação (não rouba o foco de quem abriu o painel agora)
    if (document.activeElement && document.activeElement !== document.body) ref.current?.focus({ preventScroll: true })
  }, [focar])
  return (
    <h1 ref={ref} tabIndex={-1} className={`pn-h1 px${className ? ` ${className}` : ''}`}>
      {children}
    </h1>
  )
}

/** Linha "rótulo · valor" das listas de detalhes. */
export function Linha({ rotulo, children }: { rotulo: ReactNode; children: ReactNode }) {
  return (
    <div className="pn-linha">
      <dt>{rotulo}</dt>
      <dd>{children}</dd>
    </div>
  )
}
