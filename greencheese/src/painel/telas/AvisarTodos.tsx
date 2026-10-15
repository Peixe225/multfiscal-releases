// Avisar todo mundo de um passo do rateio (fechou, pedido feito, a caminho, chegou, cancelado): um link do WhatsApp
// por pessoa, cada um com a mensagem pronta e o nome dela. O dono toca um por um; quem já foi avisado fica marcado
// (neste aparelho), pra não perder a conta no meio.
import { useState } from 'react'
import { agora } from '../api'
import { Folha } from '../Folha'
import { whatsappBonito } from '../formato'
import { lembrarJson, lidoJson } from '../lembrar'
import { linkWhats, mensagemDoPasso, quemAvisar } from '../mensagens'
import { NOME_STATUS } from '../rateio-ui'
import type { Participante, RateioAdmin, StatusRateio } from '../tipos'
import { Botao, Ic } from '../ui'
import { NOME_VAGA } from '../vaga'

const chave = (r: RateioAdmin, passo: StatusRateio) => `avisos:${r.id}:${passo}`

const TITULO: Partial<Record<StatusRateio, string>> = {
  fechado: 'Avisar que fechou',
  pedido: 'Avisar do pedido feito',
  caminho: 'Avisar que tá a caminho',
  chegou: 'Avisar que chegou',
  cancelado: 'Avisar do cancelamento',
}

/** Quantos já foram avisados desse passo (neste aparelho). */
export function avisados(r: RateioAdmin, passo: StatusRateio, lista: Participante[]): number {
  const feitos = new Set(lidoJson<number[]>(chave(r, passo)) ?? [])
  return quemAvisar(passo, lista).filter((p) => feitos.has(p.id)).length
}

export function AvisarTodos({ passo, rateio, participantes, aoFechar }: { passo: StatusRateio | null; rateio: RateioAdmin; participantes: Participante[]; aoFechar: () => void }) {
  return passo ? <Lista passo={passo} rateio={rateio} participantes={participantes} aoFechar={aoFechar} /> : null
}

function Lista({ passo, rateio, participantes, aoFechar }: { passo: StatusRateio; rateio: RateioAdmin; participantes: Participante[]; aoFechar: () => void }) {
  const lista = quemAvisar(passo, participantes)
  const [feitos, setFeitos] = useState<number[]>(() => lidoJson<number[]>(chave(rateio, passo)) ?? [])
  const marcar = (id: number) => {
    setFeitos((f) => {
      if (f.includes(id)) return f
      const n = [...f, id]
      lembrarJson(chave(rateio, passo), n)
      return n
    })
  }
  const n = lista.filter((p) => feitos.includes(p.id)).length
  const exemplo = lista[0] ? mensagemDoPasso(passo, lista[0], rateio, agora()) : null
  return (
    <Folha
      aberta
      larga
      aoFechar={aoFechar}
      titulo={TITULO[passo] ?? `Avisar: ${NOME_STATUS[passo].toLowerCase()}`}
      sub={lista.length ? `${n} de ${lista.length} avisados. Toca em cada um: o WhatsApp abre com a mensagem pronta, é só mandar.` : 'Ninguém pra avisar nesse passo.'}
      rodape={
        <Botao largo variante={n === lista.length ? 'cheio' : 'cinza'} onClick={aoFechar}>
          {n === lista.length ? 'Pronto, todo mundo avisado' : 'Termino depois'}
        </Botao>
      }
    >
      <div className="pn-folha-pad">
        <div className="pn-avisos-barra" aria-hidden="true">
          <i style={{ transform: `scaleX(${lista.length ? n / lista.length : 0})` }} />
        </div>
        {exemplo && (
          <details className="pn-msg-exemplo">
            <summary>Ver a mensagem</summary>
            <p>{exemplo}</p>
          </details>
        )}
        <ul className="pn-avisos">
          {lista.map((p) => {
            const feito = feitos.includes(p.id)
            const texto = mensagemDoPasso(passo, p, rateio, agora()) ?? ''
            return (
              <li key={p.id} className={feito ? 'feito' : undefined}>
                <span className="pn-avisos-txt">
                  <strong>{p.nome}</strong>
                  <span>
                    <span className="pn-codigo">{p.codigo}</span> · {NOME_VAGA[p.status]} · {whatsappBonito(p.whatsapp)}
                  </span>
                </span>
                <a
                  className={`pn-botao ${feito ? 'pn-botao-contorno' : 'pn-botao-cheio'} pn-botao-p`}
                  href={linkWhats(p.whatsapp, texto)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => marcar(p.id)}
                >
                  <Ic nome={feito ? 'check' : 'whatsapp'} tamanho={16} />
                  <span className="pn-botao-txt">{feito ? 'Avisado' : 'Avisar'}</span>
                  <span className="sr-only">
                    {' '}
                    {p.nome}
                    {feito ? ' de novo' : ''} (abre o WhatsApp)
                  </span>
                </a>
              </li>
            )
          })}
        </ul>
      </div>
    </Folha>
  )
}
