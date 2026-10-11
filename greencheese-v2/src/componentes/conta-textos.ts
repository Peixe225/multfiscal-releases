// Falas da conta do cliente que vieram com a auditoria de 11/10 (o formulário do código e a Minha conta). As de antes
// continuam em src/interativos/sorte/textos.ts (T); estas ficam aqui pra não misturar com as do jogo.
import type { ContaAberta } from '../lib/conta'
import { primeiroNome } from '../lib/conta'

const plural = (n: number, um: string, varios: string) => (n === 1 ? `1 ${um}` : `${n} ${varios}`)

export const TC = {
  // erros do passo do código
  codigoErrado: (restam?: number) =>
    restam != null && restam > 0
      ? `Esse código não confere. ${restam === 1 ? 'Resta 1 tentativa' : `Restam ${restam} tentativas`}.`
      : 'Esse código não confere. Olha de novo no WhatsApp.',
  codigoCurto: 'O código tem 6 números.',
  codigoVencidoNome: 'O código venceu (vale 10 minutos). Pede outro: teu nome fica aqui.',
  semConexao: 'Sem conexão com a loja agora. Confere tua internet e tenta de novo.',
  codigoPausado: 'Entrar com código pelo WhatsApp tá pausado agora. Tua conta fica neste aparelho por enquanto.',
  // logado, trocando o número: a conta continua a da loja, só o código pro número novo não sai agora
  trocarPausado: 'O código pelo WhatsApp tá pausado agora. Tenta trocar o número mais tarde.',
  muitas: 'Muita tentativa seguida. Espera um pouco e tenta de novo.',
  deuErro: 'Deu um erro aqui. Tenta de novo daqui a pouco.',
  // a conta da loja saiu sozinha (apagada em outro aparelho ou pelo painel, 90 dias sem usar)
  sessaoAcabou: 'Tua sessão acabou. Entra de novo com teu WhatsApp: o WhatsApp da loja te manda um código de 6 números.',
  // a conta do aparelho esperando ir pra loja (antes de entrar)
  contaDoAparelhoVai: (nome: string, cupons: number) =>
    cupons > 2
      ? `Tua conta deste aparelho (${nome}, ${cupons} cupons) vai junto, com até 2 cupons: confirma teu WhatsApp com o código que a loja manda.`
      : `Tua conta deste aparelho (${nome}${cupons ? `, ${plural(cupons, 'cupom', 'cupons')}` : ''}) vai junto: confirma teu WhatsApp com o código que a loja manda.`,
}

/**
 * O recado de quando a pessoa entra ou cria a conta pela Minha conta (o jogo tem os dele): oi ou conta criada, o
 * prêmio reservado que virou cupom, os cupons que vieram do aparelho e o prêmio que não entrou (a conta já tinha girado).
 */
export function recadoDeEntrada(r: ContaAberta, criou: boolean): string {
  const nome = primeiroNome(r.conta.nome)
  const partes = [criou ? (nome ? `Conta criada, ${nome}.` : 'Conta criada.') : nome ? `Oi de novo, ${nome}.` : 'Oi de novo.']
  if (r.migracao) {
    const { levou, vieram } = r.migracao
    if (vieram >= levou) partes.push(levou === 1 ? 'O cupom deste aparelho veio junto.' : `Os ${levou} cupons deste aparelho vieram junto.`)
    else if (vieram > 0) partes.push(`Vieram ${vieram} dos ${levou} cupons deste aparelho (entram até 2).`)
    else partes.push(levou === 1 ? 'O cupom deste aparelho não pôde vir pra conta da loja.' : 'Os cupons deste aparelho não puderam vir pra conta da loja.')
  }
  if (r.cupomGuardado) partes.push(`Teu prêmio tá guardado: cupom ${r.cupomGuardado.codigo}.`)
  if (r.pendenteRecusado) partes.push('Tua conta já tinha girado nesse dia: o prêmio desse giro não entra nela.')
  return partes.join(' ')
}
