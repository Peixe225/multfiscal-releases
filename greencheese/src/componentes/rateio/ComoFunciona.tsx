import { useUI, type ComoFuncionaRateio } from '../../store/ui'
import { Folha } from '../Folha'
import { faixaDias } from './util'
import './estilo'

// O "?" do Rateio: como funciona, em passos curtos. As horas da reserva e a previsão são as do rateio de onde a folha
// abriu (da aba, as de sempre: 24 h e de 6 a 10 dias). O que a loja ainda não definiu (não lotou, devolução) não vira
// promessa: a loja chama no WhatsApp pra combinar.

const PADRAO: ComoFuncionaRateio = { reservaHoras: 24, previsaoMin: 6, previsaoMax: 10 }

export function ComoFuncionaFolha() {
  const c = useUI((s) => s.comoFunciona)
  const fechar = useUI((s) => s.fecharComoFunciona)
  // a folha sai animando depois de fechar: guarda os números da última abertura
  const n = c ?? ultimo
  if (c) ultimo = c
  const passos: { titulo: string; texto: string }[] = [
    { titulo: 'Entra com nome e WhatsApp.', texto: 'Escolhe quantas vagas quer. Cada vaga é uma unidade do produto.' },
    {
      titulo: `Tua vaga fica guardada por ${n.reservaHoras} h.`,
      texto: 'Nesse tempo tu fecha o pagamento com a loja no WhatsApp. O Pix aqui no site chega em breve, e aí a vaga confirma sozinha.',
    },
    { titulo: 'O contador mostra as vagas pagas.', texto: '8/10 quer dizer 8 vagas pagas de 10. As reservadas aparecem do lado, até o pagamento cair.' },
    { titulo: 'O pedido do rateio é feito depois que fecham as vagas.', texto: 'Lotou, a loja faz o pedido do lote inteiro.' },
    { titulo: `Chega ${faixaDias(n)} depois que fechar.`, texto: 'É a previsão de cada rateio. Chegou, a loja te chama pra entregar.' },
    { titulo: 'Por que sai mais barato?', texto: 'A loja compra junto, de uma vez, e repassa o preço. Depois que chega, o mesmo produto sai mais caro.' },
  ]
  return (
    <Folha id="como-funciona" aberta={!!c} aoFechar={fechar} rotulo="Como funciona o rateio" cabecalho="Como funciona o rateio" className="folha-como" rotuloCorpo="Passos do rateio">
      <ol className="como-lista">
        {passos.map((p, i) => (
          <li key={p.titulo} className="como-passo">
            <span className="como-num px" aria-hidden="true">
              {i + 1}
            </span>
            <p>
              <strong>{p.titulo}</strong> {p.texto}
            </p>
          </li>
        ))}
      </ol>
      <p className="como-se-nao">
        <strong>E se não lotar?</strong> A loja te chama no WhatsApp pra combinar.
      </p>
    </Folha>
  )
}

let ultimo: ComoFuncionaRateio = PADRAO
