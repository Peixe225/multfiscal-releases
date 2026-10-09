// Pedidos do site, o mais novo primeiro: "Em aberto" de cara (novo, confirmado e saiu pra entrega), os outros status
// nos filtros, o estado (quando já teve pedido de mais de um) e a busca por código, nome, cidade ou WhatsApp.
import { useEffect, useRef, useState } from 'react'
import * as api from '../api'
import { useDados } from '../dados'
import { plural } from '../formato'
import { Link, Topo } from '../Moldura'
import { caminho, ir } from '../rotas'
import { useRestaurarRolagem, useTitulo } from '../telas/comum'
import { Aviso, Botao, Carregando, Ic, TituloTela } from '../ui'
import { listaPedidos } from './api'
import { LinhaPedido } from './comum'
import './estilo'
import type { FiltroPedidos, ListaPedidos } from './tipos'

const FILTROS: { id: FiltroPedidos; nome: string }[] = [
  { id: 'abertos', nome: 'Em aberto' },
  { id: 'novo', nome: 'Novos' },
  { id: 'confirmado', nome: 'Confirmados' },
  { id: 'saiu', nome: 'Saiu pra entrega' },
  { id: 'entregue', nome: 'Entregues' },
  { id: 'cancelado', nome: 'Cancelados' },
  { id: 'todos', nome: 'Todos' },
]

const VAZIO: Record<FiltroPedidos, string> = {
  abertos: 'Nada em aberto: todo pedido já foi entregue ou cancelado.',
  novo: 'Nenhum pedido novo agora.',
  confirmado: 'Nenhum pedido confirmado esperando sair.',
  saiu: 'Nenhum pedido na rua agora.',
  entregue: 'Nenhum pedido entregue ainda.',
  cancelado: 'Nenhum pedido cancelado.',
  todos: 'Nenhum pedido ainda.',
}

const PASSO_LIMITE = 50
const LIMITE_MAXIMO = 100

export function Pedidos({ status, uf }: { status: FiltroPedidos | null; uf: string | null }) {
  useTitulo('Pedidos')
  const filtro: FiltroPedidos = status ?? 'abertos'
  const [busca, setBusca] = useState('')
  const [termo, setTermo] = useState('')
  const [limite, setLimite] = useState(PASSO_LIMITE)
  // a busca vai pro servidor quando a pessoa para de digitar
  useEffect(() => {
    const t = window.setTimeout(() => setTermo(busca.trim()), 300)
    return () => window.clearTimeout(t)
  }, [busca])
  useEffect(() => setLimite(PASSO_LIMITE), [filtro, uf, termo])

  const leitura = useDados<ListaPedidos>(`pedidos:${filtro}:${uf ?? ''}:${termo}:${limite}`, (s) => listaPedidos({ status: filtro, uf, busca: termo, limite }, s))
  // trocando de filtro (ou buscando), a lista de antes fica na tela até a nova chegar
  const anterior = useRef<ListaPedidos | undefined>(undefined)
  if (leitura.dados) anterior.current = leitura.dados
  const d = leitura.dados ?? anterior.current
  const trocando = !leitura.dados && !!anterior.current
  useRestaurarRolagem(!!d)
  const agora = api.agora()

  const irPara = (s: FiltroPedidos, u: string | null) => ir(caminho.pedidosDe(s === 'abertos' ? null : s, u), true)
  const ufs = d?.ufs ?? []
  const total = d?.contagem.todos ?? 0

  return (
    <>
      <Topo
        titulo={<TituloTela>Pedidos</TituloTela>}
        acoes={
          <Link href={caminho.avisos} className="pn-botao pn-botao-cinza pn-botao-p">
            <Ic nome="sino" tamanho={16} />
            <span className="pn-botao-txt">Avisos</span>
          </Link>
        }
      />
      <div className="pn-pagina pn-pagina-estreita pd-pedidos">
        <div className="pd-busca-linha">
          <div className="pn-busca">
            <Ic nome="lupa" tamanho={16} />
            <input className="pn-input" type="search" enterKeyHint="search" autoComplete="off" aria-label="Buscar pedido" placeholder="Código, nome, cidade ou WhatsApp" value={busca} maxLength={40} onChange={(e) => setBusca(e.target.value)} />
          </div>
          {(ufs.length > 1 || uf) && (
            <select className="pn-input pn-select" aria-label="Estado" value={uf ?? ''} onChange={(e) => irPara(filtro, e.target.value || null)}>
              <option value="">Todos os estados</option>
              {ufs.map((u) => (
                <option key={u} value={u}>
                  {u.toUpperCase()}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="pn-filtros" role="group" aria-label="Status do pedido">
          {/* status sem nenhum pedido sai da fila de filtros (menos o escolhido, o "Em aberto" e o "Todos") */}
          {FILTROS.filter((f) => !d || f.id === filtro || f.id === 'abertos' || f.id === 'todos' || d.contagem[f.id] > 0).map((f) => (
            <button key={f.id} type="button" className={`pn-filtro${filtro === f.id ? ' on' : ''}`} aria-pressed={filtro === f.id} onClick={() => irPara(f.id, uf)}>
              {f.nome}
              {d && <span className="pn-filtro-n"> {d.contagem[f.id]}</span>}
            </button>
          ))}
        </div>

        {leitura.erro && (
          <Aviso tipo="erro" acao={<button type="button" className="pn-link-botao" onClick={() => void leitura.recarregar()}>Tentar de novo</button>}>
            {leitura.erro.message}
          </Aviso>
        )}
        {!d && !leitura.erro && <Carregando rotulo="Carregando os pedidos…" />}

        {d && (
          <div className={trocando ? 'pd-trocando' : undefined} aria-busy={trocando || undefined}>
            {termo && (
              <p className="pd-achados" role="status">
                {d.pedidos.length === 0 ? `Nada com “${termo}”.` : `${plural(d.pedidos.length, 'pedido', 'pedidos')} com “${termo}”${d.mais ? ' (os mais novos)' : ''}.`}
              </p>
            )}
            {d.pedidos.length === 0 && !termo &&
              (total === 0 && !uf ? (
                <div className="pd-vazio">
                  <Ic nome="pedido" tamanho={48} />
                  <p>Nenhum pedido ainda. Quando alguém fechar um pedido pelo site, ele aparece aqui na hora, com o código GC-… que vai na mensagem do WhatsApp.</p>
                </div>
              ) : (
                <p className="pn-vazio">
                  <Ic nome="check" tamanho={16} /> {VAZIO[filtro]}
                </p>
              ))}
            {d.pedidos.length > 0 && (
              <ul className="pd-lista">
                {d.pedidos.map((p) => (
                  <li key={p.id}>
                    <LinhaPedido p={p} agora={agora} />
                  </li>
                ))}
              </ul>
            )}
            {d.mais &&
              (limite < LIMITE_MAXIMO ? (
                <Botao variante="cinza" largo className="pd-mais" ocupado={trocando} onClick={() => setLimite(LIMITE_MAXIMO)}>
                  Ver mais antigos
                </Botao>
              ) : (
                <p className="pn-dica-bloco pd-mais">Mostrando os {LIMITE_MAXIMO} mais novos. Pra achar um mais antigo, busca pelo código ou pelo nome.</p>
              ))}
          </div>
        )}

        <section className="pn-bloco pd-ajustes" aria-labelledby="h-ajustes-pedido">
          <h2 id="h-ajustes-pedido" className="pn-h3 pn-h3-colado">
            Ajustes dos pedidos
          </h2>
          <ul className="pn-menu">
            <li>
              <Link href={caminho.avisos} className="pn-menu-item toque">
                <Ic nome="sino" tamanho={16} />
                <span>Avisos no WhatsApp</span>
                <Ic nome="chevron-dir" tamanho={16} />
              </Link>
            </li>
            <li>
              <Link href={caminho.textos} className="pn-menu-item toque">
                <Ic nome="balao" tamanho={16} />
                <span>Textos do pedido</span>
                <Ic nome="chevron-dir" tamanho={16} />
              </Link>
            </li>
          </ul>
        </section>
      </div>
    </>
  )
}
