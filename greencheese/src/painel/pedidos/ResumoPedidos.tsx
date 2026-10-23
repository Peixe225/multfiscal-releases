// Bloco dos pedidos no Resumo: os novos (até 5, o mais novo primeiro), quantos estão em andamento e, quando é o caso,
// os avisos no grupo que não foram ou estão desligados. O número de novos também vai pra frase de cima do Resumo
// (useNovosPedidos), sem outra ida ao servidor.
import { useEffect, useSyncExternalStore } from 'react'
import * as api from '../api'
import { useDados } from '../dados'
import { plural } from '../formato'
import { Link } from '../Moldura'
import { caminho } from '../rotas'
import { Ic } from '../ui'
import { resumoPedidos } from './api'
import { LinhaPedido } from './comum'
import './estilo'
import type { ResumoPedidos as TResumo } from './tipos'

let novos = 0
const ouvintes = new Set<() => void>()
function assinar(f: () => void) {
  ouvintes.add(f)
  return () => {
    ouvintes.delete(f)
  }
}

/** Quantos pedidos novos o bloco do Resumo achou (0 até ele carregar). */
export function useNovosPedidos(): number {
  return useSyncExternalStore(assinar, () => novos)
}

export function ResumoPedidos() {
  const leitura = useDados<TResumo>('pedidos-resumo', (s) => resumoPedidos(s))
  const d = leitura.dados
  useEffect(() => {
    if (!d || d.novos === novos) return
    novos = d.novos
    ouvintes.forEach((f) => f())
  }, [d])
  // sem resposta (servidor sem a rota, rede): o Resumo segue sem o bloco
  if (!d) return null
  const agora = api.agora()
  // avisos no grupo: só pra quem cuida deles (o dono); pros outros o servidor manda null
  const a = d.avisos
  return (
    <section className="pn-bloco pd-resumo-novos" aria-labelledby="h-pedidos-novos">
      <div className="pn-h2-linha">
        <h2 id="h-pedidos-novos" className="pn-h2">
          Pedidos novos {d.novos > 0 && <span className="pn-conta">{d.novos}</span>}
        </h2>
        <Link href={caminho.pedidos} className="pn-link">
          Ver pedidos
        </Link>
      </div>
      {d.novos === 0 ? (
        <p className="pn-vazio">
          <Ic nome="check" tamanho={16} />{' '}
          {d.emAndamento > 0 ? `Nenhum novo. ${plural(d.emAndamento, 'pedido', 'pedidos')} em andamento.` : 'Nenhum pedido novo. Quando alguém fechar um pedido pelo site, aparece aqui.'}
        </p>
      ) : (
        <>
          <ul className="pd-lista">
            {d.ultimos.map((p) => (
              <li key={p.id}>
                <LinhaPedido p={p} agora={agora} />
              </li>
            ))}
          </ul>
          {d.novos > d.ultimos.length && (
            <Link href={caminho.pedidosDe('novo', null)} className="pn-link">
              Ver os {d.novos} novos
            </Link>
          )}
          {d.emAndamento > 0 && <p className="pd-resumo-zero">E {plural(d.emAndamento, 'pedido', 'pedidos')} em andamento.</p>}
        </>
      )}
      {a && a.ligado && a.falhas > 0 && (
        <Link href={caminho.avisos} className="pd-resumo-alerta toque">
          <Ic nome="atencao" tamanho={16} />
          <span>{plural(a.falhas, 'aviso no grupo não foi', 'avisos no grupo não foram')} (7 dias)</span>
          <Ic nome="chevron-dir" tamanho={16} />
        </Link>
      )}
      {a && !a.ligado && (
        <p className="pd-resumo-zero">
          Aviso no grupo do WhatsApp desligado.{' '}
          <Link href={caminho.avisos} className="pn-link">
            Ligar
          </Link>
        </p>
      )}
    </section>
  )
}
