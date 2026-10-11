// A casca do painel: barra de baixo no celular (Início · Pedidos · + · Produtos · Mais pro dono, cada ícone com o nome
// embaixo), lateral no tablet e no computador (o dia a dia, o "Mais" e a conta), o recado depois de cada ação, a
// pergunta de "mudança não salva" e o topo de cada tela.
import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react'
import { Logo } from '../arte/Logo'
import { Folha } from './Folha'
import { useNovosPedidos, useResumoPedidos } from './pedidos/ResumoPedidos'
import { descreverAcesso, pode, useUsuario } from './permissoes'
import { Recados } from './recado'
import { caminho, ir, voltar as voltarTela, type Rota } from './rotas'
import { PerguntaSair } from './sair'
import { barraDo, lateralDo, opcoesCriar, type OpcaoCriar } from './secoes'
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

/** A folha do "+": Novo produto e Novo rateio (as que o papel tem). Navega depois que a folha sai do histórico. */
function FolhaCriar({ aberta, aoFechar, opcoes }: { aberta: boolean; aoFechar: () => void; opcoes: OpcaoCriar[] }) {
  const [destino, setDestino] = useState<string | null>(null)
  useEffect(() => {
    if (aberta || !destino) return
    const d = destino
    setDestino(null)
    ir(d)
  }, [aberta, destino])
  return (
    <Folha aberta={aberta} aoFechar={aoFechar} titulo="Criar">
      <ul className="pn-criar-opcoes">
        {opcoes.map((o) => (
          <li key={o.id}>
            <a
              href={o.href}
              className="pn-criar-opcao toque"
              onClick={(e) => {
                if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
                e.preventDefault()
                setDestino(o.href)
                aoFechar()
              }}
            >
              <span className="pn-criar-ic" aria-hidden="true">
                <Ic nome={o.icone} tamanho={24} />
              </span>
              <span className="pn-criar-txt">
                <strong>{o.nome}</strong>
                <small>{o.sub}</small>
              </span>
              <Ic nome="chevron-dir" tamanho={16} />
            </a>
          </li>
        ))}
      </ul>
    </Folha>
  )
}

/** "Pedidos" com a bolinha dos novos (o leitor de tela ouve "3 novos"). */
function Bolinha({ n }: { n: number }) {
  if (!n) return null
  return (
    <>
      <span className="pn-bolinha px" aria-hidden="true">
        {n > 99 ? '99+' : n}
      </span>
      <span className="sr-only">, {n === 1 ? '1 novo' : `${n} novos`}</span>
    </>
  )
}

function Lateral({ rota, aoCriar }: { rota: Rota; aoCriar: () => void }) {
  const usuario = useUsuario()
  const novos = useNovosPedidos()
  const { principais, mais } = lateralDo(usuario)
  const criar = opcoesCriar(usuario)
  const maisAceso = mais.includes(rota.tela)
  const contaAcesa = rota.tela === 'conta'
  return (
    <nav className="pn-lateral" aria-label="Seções do painel">
      <Link href="#/" className="pn-lateral-marca" aria-label="Green Cheese · Painel, ir pro início">
        <Logo tamanho={40} />
        <span className="pn-lateral-marca-txt">
          <span className="px">Painel</span>
          <small>Green Cheese</small>
        </span>
      </Link>
      <ul>
        {principais.map((s) => {
          const acesa = s.telas.includes(rota.tela)
          if (s.id === 'novo') {
            // o "+" da lateral: a mesma folha da barra (Novo produto, Novo rateio) ou direto pro único que tem
            if (criar.length > 1)
              return (
                <li key="criar">
                  <button type="button" className={`pn-lateral-item pn-lateral-criar toque${['novo', 'produto-novo'].includes(rota.tela) ? ' ativa' : ''}`} aria-haspopup="dialog" onClick={aoCriar}>
                    <Ic nome="criar" tamanho={24} />
                    <span>Criar</span>
                  </button>
                </li>
              )
          }
          return (
            <li key={s.id}>
              <Link href={s.href} className={`pn-lateral-item toque${acesa ? ' ativa' : ''}${s.id === 'novo' ? ' pn-lateral-criar' : ''}`} aria-current={acesa ? 'page' : undefined}>
                <Ic nome={acesa ? s.iconeAtivo : s.icone} tamanho={24} />
                <span>{s.nome}</span>
                {s.id === 'pedidos' && <Bolinha n={novos} />}
              </Link>
            </li>
          )
        })}
        <li>
          <Link href={caminho.mais} className={`pn-lateral-item toque${maisAceso ? ' ativa' : ''}`} aria-current={rota.tela === 'mais' ? 'page' : undefined}>
            <Ic nome="menu" tamanho={24} />
            <span>Mais</span>
          </Link>
        </li>
      </ul>
      {usuario && (
        <Link href={caminho.conta} className={`pn-lateral-conta toque${contaAcesa ? ' ativa' : ''}`} aria-current={contaAcesa ? 'page' : undefined}>
          <span className={`pn-avatar${contaAcesa ? ' pn-avatar-aceso' : ''}`} style={{ width: 32, height: 32 }}>
            <Logo tamanho={contaAcesa ? 26 : 30} />
          </span>
          <span className="pn-lateral-conta-txt">
            <strong>{usuario.nome.split(' ')[0]}</strong>
            <small>Conta · {descreverAcesso(usuario)}</small>
          </span>
        </Link>
      )}
    </nav>
  )
}

function Barra({ rota, aoCriar }: { rota: Rota; aoCriar: () => void }) {
  const usuario = useUsuario()
  const novos = useNovosPedidos()
  return (
    <nav className="pn-barra" aria-label="Seções do painel">
      {barraDo(usuario).map((s) => {
        const acesa = s.telas.includes(rota.tela)
        const dentro = (
          <>
            <span className="pn-barra-ic">
              <Ic nome={acesa ? s.iconeAtivo : s.icone} tamanho={24} />
              {s.id === 'pedidos' && novos > 0 && (
                <span className="pn-bolinha px" aria-hidden="true">
                  {novos > 99 ? '99+' : novos}
                </span>
              )}
            </span>
            <span className="pn-barra-nome">{s.nome}</span>
            {s.id === 'pedidos' && novos > 0 && <span className="sr-only">, {novos === 1 ? '1 novo' : `${novos} novos`}</span>}
          </>
        )
        if (!s.href)
          return (
            <button key={s.id} type="button" className={`pn-barra-item${acesa ? ' ativa' : ''}`} aria-haspopup="dialog" onClick={aoCriar}>
              {dentro}
            </button>
          )
        return (
          <Link key={s.id} href={s.href} className={`pn-barra-item${acesa ? ' ativa' : ''}`} aria-current={acesa ? 'page' : undefined}>
            {dentro}
          </Link>
        )
      })}
    </nav>
  )
}

export function Moldura({ rota, children }: { rota: Rota; children: ReactNode }) {
  const usuario = useUsuario()
  const [criando, setCriando] = useState(false)
  // a bolinha dos pedidos novos (na barra e na lateral) se atualiza sozinha em qualquer tela
  useResumoPedidos(pode('pedidos', usuario), 60_000)
  return (
    <div className="pn-app">
      <a className="pn-pular" href="#conteudo" onClick={(e) => {
        e.preventDefault()
        document.getElementById('conteudo')?.focus()
      }}>
        Pular pro conteúdo
      </a>
      <Lateral rota={rota} aoCriar={() => setCriando(true)} />
      <main id="conteudo" className="pn-principal" tabIndex={-1}>
        {children}
      </main>
      <Barra rota={rota} aoCriar={() => setCriando(true)} />
      <FolhaCriar aberta={criando} aoFechar={() => setCriando(false)} opcoes={opcoesCriar(usuario)} />
      <Recados />
      <PerguntaSair />
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
