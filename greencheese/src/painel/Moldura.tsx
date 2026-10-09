// A casca do painel: lateral no computador (no molde do instagram.com), barra de baixo no celular (Resumo,
// Rateios, Criar no meio, Atividade e Conta) e o topo de cada tela.
import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from 'react'
import { Logo } from '../arte/Logo'
import { useUsuario } from './permissoes'
import { ir, voltar as voltarTela, type Rota } from './rotas'
import { barraDo, secoesDo, type Secao } from './secoes'
import { Ic } from './ui'

/** Link interno: entra no histórico do painel (Ctrl/⌘ + clique ainda abre em outra aba). */
export function Link({ href, onClick, trocar, ...resto }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; trocar?: boolean }) {
  const aoClicar = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e)
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    ir(href, trocar)
  }
  return <a href={href} onClick={aoClicar} {...resto} />
}

function ativa(s: Secao, rota: Rota): boolean {
  return s.telas.includes(rota.tela)
}

function IconeSecao({ s, acesa, tamanho }: { s: Secao; acesa: boolean; tamanho: number }) {
  if (s.id === 'conta') {
    return (
      <span className={`pn-avatar${acesa ? ' pn-avatar-aceso' : ''}`} style={{ width: tamanho, height: tamanho }}>
        <Logo tamanho={acesa ? tamanho - 6 : tamanho - 2} />
      </span>
    )
  }
  return <Ic nome={acesa ? s.iconeAtivo : s.icone} tamanho={tamanho} />
}

function Lateral({ rota }: { rota: Rota }) {
  const usuario = useUsuario()
  return (
    <nav className="pn-lateral" aria-label="Seções do painel">
      <Link href="#/" className="pn-lateral-marca" aria-label="Green Cheese · Painel, ir pro resumo">
        <Logo tamanho={40} />
        <span className="pn-lateral-marca-txt">
          <span className="px">Painel</span>
          <small>Green Cheese</small>
        </span>
      </Link>
      <ul>
        {secoesDo(usuario).map((s) => {
          const acesa = ativa(s, rota)
          return (
            <li key={s.id}>
              <Link href={s.href} className={`pn-lateral-item toque${acesa ? ' ativa' : ''}${s.id === 'novo' ? ' pn-lateral-criar' : ''}`} aria-current={acesa ? 'page' : undefined}>
                <IconeSecao s={s} acesa={acesa} tamanho={24} />
                <span>{s.nome}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

function Barra({ rota }: { rota: Rota }) {
  const usuario = useUsuario()
  return (
    <nav className="pn-barra" aria-label="Seções do painel">
      {barraDo(usuario).map((s) => {
          const acesa = ativa(s, rota)
          return (
            <Link key={s.id} href={s.href} className={`pn-barra-item${acesa ? ' ativa' : ''}`} aria-current={acesa ? 'page' : undefined} aria-label={s.nome}>
              <IconeSecao s={s} acesa={acesa} tamanho={s.id === 'conta' ? 30 : 32} />
            </Link>
          )
        })}
    </nav>
  )
}

export function Moldura({ rota, children }: { rota: Rota; children: ReactNode }) {
  return (
    <div className="pn-app">
      <a className="pn-pular" href="#conteudo" onClick={(e) => {
        e.preventDefault()
        document.getElementById('conteudo')?.focus()
      }}>
        Pular pro conteúdo
      </a>
      <Lateral rota={rota} />
      <main id="conteudo" className="pn-principal" tabIndex={-1}>
        {children}
      </main>
      <Barra rota={rota} />
    </div>
  )
}

/** Topo da tela: voltar (quando é tela de dentro), título e ações à direita. */
export function Topo({ titulo, voltar, acoes, marca = false }: { titulo: ReactNode; voltar?: string; acoes?: ReactNode; marca?: boolean }) {
  return (
    <header className="pn-topo">
      {voltar ? (
        <button type="button" className="icone-botao pn-voltar" onClick={() => voltarTela(voltar)} aria-label="Voltar">
          <Ic nome="seta-esq" tamanho={16} />
        </button>
      ) : marca ? (
        <span className="pn-topo-marca" aria-hidden="true">
          <Logo tamanho={32} />
        </span>
      ) : null}
      <div className="pn-topo-titulo">{titulo}</div>
      {acoes && <div className="pn-topo-acoes">{acoes}</div>}
    </header>
  )
}
