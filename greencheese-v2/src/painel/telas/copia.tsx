// A cópia de segurança (o banco inteiro num arquivo): o botão, quando foi a última e o recado depois de baixar. Mora
// em Conta (e no Diagnóstico, pra quem cuida do site); o Resumo lembra quando passa de 7 dias sem cópia.
import { useCallback } from 'react'
import * as api from '../api'
import { useAcao, useDados, type Leitura } from '../dados'
import { recado } from '../recado'
import type { Pronto } from '../tipos'
import { Aviso, Botao } from '../ui'

/** A leitura do admin-pronto (a mesma pra Resumo e Conta: uma alimenta a outra). */
export function usePronto(ligado = true): Leitura<Pronto> {
  return useDados<Pronto>(ligado ? 'pronto' : 'pronto-desligado', (s) => (ligado ? api.pronto(s) : Promise.reject(new Error('sem'))), ligado ? 60_000 : 0)
}

/** Dias desde a última cópia (null = nenhuma). */
export function diasDaCopia(iso: string | null, agora: number): number | null {
  if (!iso) return null
  return Math.max(0, Math.floor((agora - Date.parse(iso)) / 86_400_000))
}

/** "Última cópia: hoje" · "… ontem" · "… há 9 dias" · "Nenhuma cópia ainda". */
export function textoUltimaCopia(iso: string | null, agora: number): string {
  const d = diasDaCopia(iso, agora)
  if (d === null) return 'Nenhuma cópia ainda.'
  return `Última cópia: ${d === 0 ? 'hoje' : d === 1 ? 'ontem' : `há ${d} dias`}.`
}

/** Baixa a cópia, deixa o recado e anota a data na leitura (a lista do Resumo e a Conta mudam na hora). */
export function useBaixarCopia(leitura?: Leitura<Pronto>) {
  const acao = useAcao()
  const baixar = useCallback(
    () =>
      acao.rodar('copia', async () => {
        const nome = await api.baixarBackup()
        recado(`Cópia baixada (${nome}). Guarda fora do celular: tem nome e WhatsApp dos clientes.`)
        leitura?.trocar((p) => ({ ...p, copia: { ultimaEm: new Date(api.agora()).toISOString() } }))
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [acao.rodar, leitura?.trocar],
  )
  return { baixar, ocupado: acao.ocupado === 'copia', erro: acao.erro }
}

/** O bloco "Cópia de segurança" (Conta e Diagnóstico). */
export function BlocoCopia({ leitura, id = 'h-copia' }: { leitura?: Leitura<Pronto>; id?: string }) {
  const { baixar, ocupado, erro } = useBaixarCopia(leitura)
  const ultima = leitura?.dados?.copia.ultimaEm ?? null
  const dias = diasDaCopia(ultima, api.agora())
  return (
    <section className="pn-bloco pn-copia" aria-labelledby={id} id="copia">
      <h2 id={id} className="pn-h2">
        Cópia de segurança
      </h2>
      <p className="pn-dica-bloco">Baixa tudo num arquivo só: produtos, pedidos, clientes, rateios e histórico. Faz toda semana e guarda fora do celular, num lugar seguro: tem nome e WhatsApp dos clientes.</p>
      {leitura?.dados && <p className={`pn-copia-ultima${dias === null || dias >= 7 ? ' pn-urgente' : ''}`}>{textoUltimaCopia(ultima, api.agora())}</p>}
      {erro && <Aviso tipo="erro">{erro.message}</Aviso>}
      {/* pelo api.ts (não um link direto): sessão vencida abre o login e o download recomeça; erro aparece */}
      <Botao icone="baixar" ocupado={ocupado} onClick={() => void baixar()}>
        Baixar cópia de segurança
      </Botao>
      <p className="pn-dica-bloco">A cópia não leva as senhas dos Avisos no WhatsApp: se um dia voltar uma cópia, põe elas de novo em Avisos no WhatsApp.</p>
    </section>
  )
}
