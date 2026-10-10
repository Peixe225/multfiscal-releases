// As falas do pedido guiado no painel: onde cada uma aparece (na língua do dono), os grupos da tela e os valores de
// exemplo da prévia do balão. O texto de sempre, os tipos e os marcadores moram em src/dados/textos-pedido.ts (o
// mesmo arquivo do site); o tipo Record<ChaveTexto, …> faz o build parar se uma fala nova ficar sem rótulo aqui.
import type { ChaveTexto } from '../../dados/textos-pedido'

export const ROTULO_FALA: Record<ChaveTexto, string> = {
  'local.semEstado': 'Pergunta o estado (quando o site ainda não sabe)',
  'local.semEstado.encomenda': 'Encomenda de quem está num estado sem atendimento',
  'local.outroEstado': 'Botão: outro estado',
  'local.qualCidade': 'Pergunta a cidade (estado com mais de uma)',
  'local.confirmar': 'Confirma o atendimento',
  'local.confirmar.encomenda': 'Confirma o atendimento da encomenda',
  'local.fechado': 'Avisa que a loja tá fechada agora',
  'local.sim': 'Botão: confirmar o atendimento',
  'local.sim.encomenda': 'Botão: confirmar o atendimento da encomenda',
  'local.trocarCidade': 'Botão: trocar a cidade',
  'local.trocarEstado': 'Botão: trocar o estado',
  'local.trocarAtendimento': 'Botão: trocar o atendimento (encomenda)',
  'cidade.pergunta': 'Pergunta a cidade (estado ainda sem lista de cidades)',
  'cidade.dica': 'Escrito dentro do campo da cidade',
  'cidade.erro': 'Erro: cidade em branco',

  'sacola.fora': 'Os itens da sacola não tem no estado',
  'sacola.vazia': 'Sacola vazia',
  'sacola.verMercado': 'Botão: ver o Mercado',
  'sacola.encomendar': 'Botão: fazer encomenda',
  'sacola.confere': 'Pede pra conferir a sacola',
  'sacola.certo': 'Botão: a sacola tá certa',
  'sacola.mexer': 'Botão: mexer na sacola',
  'sacola.quero': 'O cliente pediu 1 produto pelo story',
  'sacola.queroVarios': 'O cliente pediu vários produtos pelo story',

  'nome.pergunta': 'Pergunta o nome',
  'nome.dica': 'Escrito dentro do campo do nome',
  'nome.erro': 'Erro: nome em branco',

  'endereco.pergunta': 'Pergunta onde entrega (pede o CEP)',
  'endereco.semCep': 'Botão: seguir sem CEP',
  'endereco.dica': 'Escrito dentro do campo do CEP',
  'endereco.erro': 'Erro: CEP incompleto',
  'cep.procurando': 'Enquanto procura o CEP',
  'cep.naoAchei': 'CEP não encontrado',
  'cep.foraDoAr': 'O serviço de CEP não respondeu',
  'cep.outroEstado': 'O CEP é de outro estado',
  'cep.trocar': 'Botão: trocar pro estado do CEP',
  'cep.esseMesmo': 'Botão: manter o CEP',
  'cep.outro': 'Botão: digitar outro CEP',
  'cep.digitar': 'Botão: digitar o endereço',
  'numero.pergunta': 'Pergunta número e complemento',
  'numero.dica': 'Escrito dentro do campo do número',
  'numero.erro': 'Erro: número em branco',
  'rua.cepDaCidade': 'CEP da cidade inteira: pede rua e bairro',
  'rua.pergunta': 'Pede o endereço completo (sem CEP)',
  'rua.dica': 'Escrito dentro do campo do endereço',
  'rua.erro': 'Erro: endereço incompleto',

  'pagamento.pergunta': 'Pergunta como vai pagar',
  'troco.pergunta': 'Pergunta o troco',
  'troco.sem': 'Botão: sem troco',
  'troco.dica': 'Escrito dentro do campo do troco',
  'troco.erro': 'Erro: valor do troco',
  'troco.resposta': 'Resposta do cliente com o troco',

  'obs.pergunta': 'Pergunta se tem observação',
  'obs.sem': 'Botão: sem observação',
  'obs.dica': 'Escrito dentro do campo da observação',

  'resumo.pedido': 'Mostra o pedido montado',
  'resumo.fechar': 'Chama pra fechar no WhatsApp',
  'resumo.naoAbriu': 'Quando o WhatsApp não abre',
  'resumo.copiar': 'Botão: copiar o texto do pedido',
  'resumo.prontoNoZap': 'Logo depois de tocar no WhatsApp',
  'resumo.jaMandou': 'Na volta pro site: já mandou?',
  'resumo.marca': 'Pede pra marcar a loja no story',
  'resumo.mandei': 'Botão: mandei',
  'resumo.naoConsegui': 'Botão: não consegui',
  'resumo.mudarEndereco': 'Botão: mudar endereço',
  'resumo.mudarPagamento': 'Botão: mudar pagamento',
  'resumo.mudarObs': 'Botão: mudar observação',
  'duvida.instagram': 'Link pra dúvida (Instagram do estado)',

  'cupom.vale': 'Cupom aplicado no pedido',
  'cupom.naoVale': 'Cupom que não vale nesse pedido',
  'cupom.sugerir': 'Oferece um cupom que o cliente guardou',
  'cupom.usar': 'Botão: usar cupom',
  'cupom.sem': 'Botão: sem cupom',
  'cupom.tirar': 'Botão: tirar cupom',

  'pix.comPix': 'Pix no site (em breve), pagando com Pix',
  'pix.outroPagamento': 'Pix no site (em breve), com outro pagamento',
  'pix.trocar': 'Botão: trocar pra Pix',
  'pix.trocou': 'Depois de trocar pra Pix',

  'enc.produto': 'Pergunta o produto da encomenda',
  'enc.produto.dica': 'Escrito dentro do campo do produto',
  'enc.produto.erro': 'Erro: produto em branco',
  'enc.produto.proibido': 'Erro: tabaco ou vape (Anvisa)',
  'enc.qtd': 'Pergunta a quantidade',
  'enc.qtd.dica': 'Escrito dentro do campo da quantidade',
  'enc.qtd.erro': 'Erro: quantidade em branco',
  'enc.ref': 'Pede link ou descrição do produto',
  'enc.ref.pular': 'Botão: pular o link',
  'enc.ref.dica': 'Escrito dentro do campo do link',
  'enc.ref.sem': 'Resposta do cliente sem link',
  'enc.resumo': 'Mostra a encomenda montada',
  'enc.mudarProduto': 'Botão: mudar produto',
  'enc.mudarQtd': 'Botão: mudar quantidade',
  'enc.mudarNome': 'Botão: mudar nome',
}

export interface GrupoFalas {
  nome: string
  /** O começo das chaves desse grupo. */
  prefixos: string[]
}

export const GRUPOS_FALAS: GrupoFalas[] = [
  { nome: 'Começo: estado e cidade', prefixos: ['local.', 'cidade.'] },
  { nome: 'Sacola', prefixos: ['sacola.'] },
  { nome: 'Nome', prefixos: ['nome.'] },
  { nome: 'Endereço e CEP', prefixos: ['endereco.', 'cep.', 'numero.', 'rua.'] },
  { nome: 'Pagamento e troco', prefixos: ['pagamento.', 'troco.'] },
  { nome: 'Observação', prefixos: ['obs.'] },
  { nome: 'Pedido montado e WhatsApp', prefixos: ['resumo.', 'duvida.'] },
  { nome: 'Cupom', prefixos: ['cupom.'] },
  { nome: 'Pix no site (em breve)', prefixos: ['pix.'] },
  { nome: 'Encomenda', prefixos: ['enc.'] },
]

/** Valores de exemplo da prévia (o site troca pelo dado de quem tá pedindo). */
export const EXEMPLO_MARCADOR: Record<string, string> = {
  nome: 'Ian',
  uf: 'MG',
  estado: 'Minas Gerais',
  cidade: 'Teófilo Otoni',
  lugar: 'Teófilo Otoni (MG)',
  horario: 'Fechado · abre 18h',
  onde: 'Teófilo Otoni',
  endereco: 'Rua Doutor Manoel Esteves, Centro',
  ufAtendimento: 'MG',
  valor: 'R$ 100,00',
  numero: '(33) 99113-9036',
  instagram: '@greencheese_importsmg',
  cupom: 'SORTE-K8EA',
  motivo: 'falta 1 OCB',
  premio: 'LEVA 4 PAGA 3 · Seda OCB Premium Slim',
}

/** O que cada marcador vira (o chip do editor). */
export const NOME_MARCADOR: Record<string, string> = {
  nome: 'primeiro nome do cliente',
  uf: 'sigla do estado',
  estado: 'nome do estado',
  cidade: 'cidade',
  lugar: 'cidade e estado',
  horario: 'horário da loja agora',
  onde: 'cidade (ou estado)',
  endereco: 'rua e bairro do CEP',
  ufAtendimento: 'estado do atendimento',
  valor: 'valor do troco',
  numero: 'WhatsApp da loja',
  instagram: '@ do Instagram do estado',
  cupom: 'código do cupom',
  motivo: 'por que o cupom não vale',
  premio: 'o prêmio do cupom',
}
