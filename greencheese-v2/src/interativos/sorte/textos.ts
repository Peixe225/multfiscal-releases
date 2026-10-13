// A copy do "Teste minha sorte" (pt-BR informal, "tu/teu"): a das entradas do site está em textos-entrada.ts (pedaço
// principal) e entra aqui por inteiro; o resto baixa com o jogo, o formulário e a Minha conta.
// Nunca: "sorteio", "grátis", "frete", prazo, chance em %, valor de desconto calculado, nem as palavras de
// PALAVRAS_PROIBIDAS (src/dados/sorte.ts). Em dev, a lista é conferida aqui embaixo.
import { PALAVRAS_PROIBIDAS } from '../../dados/sorte'
import { calcularGiro } from '../../lib/conta'
import { diaSP, formatarLibera } from '../../lib/cupom'
import { diaQueLibera, giroPorPeriodo, umPorDia, vezesPorPeriodo } from '../../lib/frequencia'
import { agoraLoja } from '../../lib/relogio'
import { useContaStore } from '../../store/conta'
import { regrasDaSorte } from '../../store/loja'
import { TE } from './textos-entrada'

// os números das regras vêm do painel (Teste minha sorte → Com que frequência; sem servidor, os de src/dados/sorte.ts):
// os textos que citam a frequência ("1 giro por dia", "1 giro por semana") e o dia que libera ("amanhã", "sábado,
// 17/10") leem na hora (getter), e as telas continuam usando T.limites etc. do jeito de sempre. Com 1 giro por dia, os
// textos são os de sempre (com "hoje" e "amanhã").
const giros = (n: number) => (n === 1 ? '1 giro' : `${n} giros`)
/** "1 giro por dia" · "1 giro por semana" · "2 giros a cada 3 dias" */
const frequencia = () => giroPorPeriodo(regrasDaSorte())
const umPorDiaAgora = () => umPorDia(regrasDaSorte())
const porDia = () => regrasDaSorte().intervaloDias === 1
/** O próximo giro da conta (ou da conta que nascer neste aparelho), em ms, pelo cache da conta; null = liberado. */
function proximoGiro(): number | null {
  const g = calcularGiro(useContaStore.getState(), 'sorte', agoraLoja())
  return g.disponivel ? null : g.motivo === 'ja-girou-hoje' ? g.proximoEm : (g.proximoComConta ?? null)
}
/** "amanhã" · "sábado, 17/10" (o dia que libera o próximo giro); sem bloqueio, "amanhã". */
function diaDoProximo(): string {
  const ms = proximoGiro()
  return ms == null ? 'amanhã' : diaQueLibera(diaSP(ms), diaSP(agoraLoja()))
}
/** "Cria tua conta pra girar de novo amanhã." · "… de novo domingo, 18/10." (o mesmo do adesivo do Início, estado.ts) */
function criaNoDia(): string {
  const dia = diaDoProximo()
  return dia === 'amanhã' ? TE.criaAmanha : `Cria tua conta pra girar de novo ${dia}.`
}

export const T = {
  ...TE,
  legendaCasca: (instagram: string | null) => `interativo · ${instagram ? `@${instagram}` : 'Green Cheese'}`,
  carregando: 'carregando…',

  // convite
  sub: 'Gira a tampa do dichavador. Lá dentro tem um story dos Melhores amigos, só pra ti.',
  adesivoGira: 'Gira a tampa',
  legendaCelular: 'Gira a tampa',
  legendaDesktop: 'Arrasta em círculo, usa a roda do mouse ou segura Espaço',
  botaoGirar: 'Girar',
  ariaGirar: 'Girar a tampa um quarto de volta',
  get limites() {
    return `Sem conta: ${giros(regrasDaSorte().girosSemConta)}. Com conta: ${frequencia()}.`
  },
  verRegras: 'O que pode sair? · Regras',
  contaLocal: 'Por enquanto, a conta fica só neste aparelho.',
  contaServidor: 'A conta fica guardada na loja: entra com teu WhatsApp em qualquer aparelho.',

  // girando
  porQuartos: (q: number) =>
    q <= 1 ? 'Gira a tampa' : q <= 3 ? 'Isso. Mais 1 volta e meia' : q <= 5 ? 'Metade. Mais 1 volta' : q === 6 ? 'Mais meia' : q === 7 ? 'Força!' : 'Abriu!',
  parado: 'Não para não, falta pouco.',
  zonaMorta: 'Gira pela borda da tampa',
  ariaTampa: 'Tampa do dichavador',
  valorTampa: (q: number) => `${q} de 8 quartos de volta`,
  vivoMetade: 'Metade. Continua.',
  vivoAbriu: 'Abriu!',
  erroGiro: 'Não deu pra girar agora. Tenta de novo.',
  segmentos: ['Girar', 'Abrir', 'Prêmio'] as const,

  // revelação
  vivoSaiu: (titulo: string, regra: string, exemplo: boolean) => `Saiu: ${titulo}. ${regra}.${exemplo ? ' Prêmio de exemplo.' : ''}`,

  // story do prêmio: o prêmio é o herói (destaque + produto + 1 linha de apoio); as condições ficam no "Ver condições"
  melhoresAmigos: 'Melhores amigos',
  agora: 'agora',
  deuSorte: 'DEU SORTE!',
  verProduto: 'Ver produto',
  // o rótulo não muda ao abrir (o estado fica no aria-expanded e na seta): a linha não pula em 320 px
  verCondicoes: 'Ver condições',
  condicoes: 'Condições do prêmio',
  condValidadeSemConta: (dias: number) => `Vale ${dias} ${dias === 1 ? 'dia' : 'dias'} depois de guardado.`,
  condValidadeGuardado: (ate: string) => `Vale até ${ate}.`,
  condReserva: (ate: string) => `Sem conta, o prêmio fica guardado neste aparelho até ${ate}. Depois some.`,
  condUmPorPedido: 'Vale em 1 pedido. Não soma com outro cupom.',
  condEstado: 'Só com o produto disponível no teu estado.',
  condLoja: 'A loja confirma no WhatsApp: o subtotal do site não muda.',
  // adesivo do código (como o de link) e adesivo de contagem
  codigoTrancado: 'Guarda pra liberar o código',
  ariaCopiar: (codigo: string) => `Copiar o código ${codigo}`,
  copiadoAdesivo: 'COPIADO',
  copiado: 'Código copiado.',
  naoCopiou: 'Não deu pra copiar. Segura no código e copia.',
  valeAte: (ate: string) => `Vale até ${ate}`,
  valeDepois: 'Vale depois de guardar',
  dias: 'dias',
  dia: 'dia',
  venceHoje: 'vence hoje',
  contagemGuardado: (ate: string, falta: string) => `Vale até ${ate}, ${falta}.`,
  contagemAntes: (dias: number) => `Vale ${dias} ${dias === 1 ? 'dia' : 'dias'} depois de guardar.`,

  // prêmio sem conta
  esperando: (ate: string) => `Teu prêmio espera até ${ate}.`,
  soNomeZap: 'Só nome e WhatsApp.',
  agoraNao: 'Agora não',
  avisoAgoraNao: (ate: string) => `Teu prêmio fica guardado aqui até ${ate}.`,

  // prêmio com conta
  usarAgora: 'Usar agora',
  verCuponsN: (n: number) => `Ver meus cupons (${n})`,
  get naConta() {
    return umPorDiaAgora() ? 'Tá na tua conta. Amanhã tem mais.' : `Tá na tua conta. O próximo giro libera ${diaDoProximo()}.`
  },
  get naContaMaisHoje() {
    return porDia() ? 'Tá na tua conta. Ainda tem giro hoje.' : 'Tá na tua conta. Ainda dá pra girar de novo.'
  },

  // guardado
  faixaPremio: (titulo: string) => `Teu prêmio: ${titulo}`,
  fechou: (nome: string) => (nome ? `Fechou, ${nome}. Tá guardado.` : 'Fechou. Tá guardado.'),
  vivoGuardado: (codigo: string, ate: string) => `Código ${codigo}. Vale até ${ate}.`,
  contaCriada: (nome: string) => (nome ? `Conta criada, ${nome}.` : 'Conta criada.'),
  get giroLiberado() {
    return porDia() ? 'Teu giro de hoje tá liberado.' : 'Teu giro tá liberado.'
  },
  get proximoAmanha() {
    return `Teu próximo giro libera ${diaDoProximo()}.`
  },
  entrou: (nome: string) => (nome ? `Oi de novo, ${nome}.` : 'Oi de novo.'),

  // espera
  proximoGiro: 'Próximo giro',
  get ariaProximo() {
    return `Próximo giro ${diaDoProximo()}, depois da meia-noite`
  },
  get hojeJaFoi() {
    if (umPorDiaAgora()) return 'Hoje já foi. Amanhã tem mais.'
    const n = regrasDaSorte().girosPorIntervalo
    return `${n === 1 ? 'Teu giro já foi' : `Teus ${n} giros já foram`}. O próximo libera ${diaDoProximo()}.`
  },
  get hojeSaiu() {
    return porDia() ? 'Hoje saiu:' : 'No último giro saiu:'
  },
  get avisoLiberou() {
    return porDia() ? 'Teu giro de hoje tá liberado' : 'Teu giro tá liberado'
  },

  // bloqueado
  premioVenceu: (dia: string) => `O prêmio de ${dia} venceu.`,
  get vantagens() {
    return `Com conta: ${frequencia()}, cupons guardados e teu nome já no pedido.`
  },
  // girou sem conta e o giro ainda conta na janela de quem criar a conta aqui: "amanhã" ou o dia (a frequência do painel)
  get criaAmanha() {
    return criaNoDia()
  },
  // "cria e gira agora" só quando a conta que nascer aqui gira na hora; se os giros sem conta deste aparelho já enchem a
  // janela dela (2 giros por semana e o aparelho girou 2 vezes), o dia que libera — nunca promete giro que não vem
  get criaAgora() {
    return proximoGiro() == null ? TE.criaAgora : criaNoDia()
  },
  jaTenhoConta: 'Já tenho conta',

  // regras
  regras: 'Regras',
  /** `dias`: a validade, quando todos os prêmios têm a mesma (src/dados/sorte.ts); null = cada cupom diz a dele. */
  regrasLista: (dias: number | null) => [
    'Todo giro ganha.',
    porDia()
      ? `Sem conta: ${giros(regrasDaSorte().girosSemConta)}. Com conta: ${frequencia()} (vira à meia-noite, horário de Brasília).`
      : `Sem conta: ${giros(regrasDaSorte().girosSemConta)}. Com conta: ${frequencia()} (os dias viram à meia-noite, horário de Brasília).`,
    dias != null
      ? `O cupom vale ${dias} ${dias === 1 ? 'dia' : 'dias'} depois de guardado, 1 vez, em 1 pedido.`
      : 'O cupom vale até a data escrita nele, 1 vez, em 1 pedido.',
    '1 cupom por pedido. Não soma com outro cupom.',
    'Só nos produtos do cupom, se tiver no teu estado.',
    'O desconto não entra no subtotal do site: a loja confirma no WhatsApp.',
  ],
  oQuePodeSair: 'O que pode sair',
  mudaPorEstado: 'Muda conforme o estado.',
  regrasLocal: 'Por enquanto, a conta e o limite de giros ficam só neste aparelho.',
  regrasServidor: 'A conta, os cupons e o limite de giros ficam guardados na loja.',

  // conta (formulário)
  criaTuaConta: 'Cria tua conta',
  get subComPremio() {
    return `Só nome e WhatsApp. O prêmio fica guardado, tu gira ${vezesPorPeriodo(regrasDaSorte())} e teu nome já vai no pedido.`
  },
  get subSemPremio() {
    return `Só nome e WhatsApp. Com conta: ${frequencia()}, cupons guardados e teu nome já no pedido.`
  },
  teuNome: 'Teu nome',
  nomePlaceholder: 'Como a loja te chama',
  erroNome: 'Escreve teu nome.',
  teuZap: 'Teu WhatsApp',
  zapPlaceholder: '(21) 99999-9999',
  promo: 'Quero receber promoções da Green Cheese no WhatsApp',
  promoLegenda: 'Opcional. Dá pra desligar quando quiser em Minha conta.',
  promoLocal: ' Por enquanto, nada é enviado.',
  mais18: 'Ao criar a conta, tu confirma que tem 18 anos ou mais.',
  privacidade:
    'Teu nome e WhatsApp servem só pra guardar teus cupons e já pôr teu nome no pedido. Por enquanto, a conta fica só neste aparelho: o WhatsApp dela não vai pra loja.',
  privacidadeServidor:
    'Teu nome e WhatsApp servem só pra guardar teus cupons, teus endereços e adiantar teu pedido. A conta fica guardada na loja e tu apaga quando quiser, em Minha conta.',
  criarEGuardar: 'Criar conta e guardar prêmio',
  guardando: 'Guardando…',
  zapExiste: 'Esse WhatsApp já tem conta neste aparelho.',
  zapExisteServidor: 'Esse WhatsApp já tem outra conta aqui.',
  zapNaoFecha: 'Esse WhatsApp não fecha. Confere o DDD e os 9 números.',
  entrar: 'Entrar',
  entrarSub: 'Põe teu WhatsApp: o WhatsApp da loja te manda um código de 6 números.',
  contaDoAparelhoVai: (nome: string, cupons: number) =>
    `Tua conta deste aparelho (${nome}${cupons ? `, ${cupons === 1 ? '1 cupom' : `${cupons} cupons`}` : ''}) vai junto: confirma teu WhatsApp com o código que a loja manda.`,
  receberCodigo: 'Receber o código',
  mandandoCodigo: 'Mandando o código…',
  codigoZap: 'Código que chegou no teu WhatsApp',
  codigoEnviado: (mascarado: string) => `Mandamos um código pro WhatsApp ${mascarado}.`,
  codigoErrado: 'Esse código não confere. Olha de novo no WhatsApp.',
  codigoVencido: 'Esse código não vale mais. Pede outro.',
  semEnvio: 'Não deu pra mandar o código agora. Tenta de novo daqui a pouco.',
  outroCodigo: 'Mandar outro código',
  outroCodigoEm: (s: number) => `Outro código em ${s} s`,
  outroCodigoFoi: 'Mandamos outro código.',
  codigoJaValendo: 'Já tem código valendo pra esse número: usa o último que chegou no teu WhatsApp.',
  confirmarNumero: 'Confirmar o número novo',
  trocarNumeroLegenda: 'Pra trocar, a loja manda um código pro número novo.',
  primeiraVez: 'Primeira vez por aqui',
  primeiraVezSub: 'Esse WhatsApp ainda não tem conta. Põe teu nome pra criar.',
  muitasTentativas: 'Muitas tentativas. Espera uns minutos e tenta de novo.',
  trocarNumero: 'Trocar número',
  naoEncontrada: 'Esse WhatsApp não tem conta neste aparelho. Por enquanto, a conta só existe no aparelho onde foi criada.',
  criarAqui: 'Criar conta aqui',
  salvar: 'Salvar',
  cancelar: 'Cancelar',
  salvo: 'Dados salvos.',
  semArmazenamento:
    'Esse navegador não tá deixando guardar nada (aba anônima ou dados bloqueados). Abre o site no Chrome ou no Safari pra ter conta. O prêmio de agora não vai junto.',
  copiarLink: 'Copiar link',
  linkCopiado: 'Link copiado.',
  erroGuardar: 'Não deu pra guardar agora. Tenta de novo.',
  premioVencidoAoGuardar: 'Esse prêmio já tinha vencido. A conta foi criada.',
  get premioContaJaGirou() {
    return `Tua conta já tinha girado ${porDia() ? 'nesse dia' : 'nesse período'}: o prêmio desse giro não entra nela. É ${frequencia()} por conta.`
  },

  // minha conta
  minhaConta: 'Minha conta',
  oi: (nome: string) => `Oi, ${nome}`,
  zapLegenda: (mascarado: string) => `WhatsApp ${mascarado}`,
  avisoContaLocal:
    'Por enquanto, a conta fica só neste aparelho. Abriu pelo Instagram? Ela fica no navegador do Instagram. Limpar os dados do navegador apaga tudo.',
  avisoContaServidor: 'Tua conta fica guardada na loja: entra com teu WhatsApp em qualquer aparelho.',
  get giroDeHoje() {
    return porDia() ? 'Giro de hoje' : 'Teu giro'
  },
  get liberadoHoje() {
    return porDia() ? 'Teu giro de hoje tá liberado' : 'Teu giro tá liberado'
  },
  girarDichavador: 'Girar o dichavador',
  // `espera`: a contagem que a tela já tem ("em 14 h"); passou de 24 h (a frequência do painel), o dia que libera
  usadoHoje: (espera: string) => {
    if (umPorDiaAgora()) return `Hoje já foi. Próximo giro ${espera}.`
    const ms = proximoGiro()
    return `Teu giro já foi. Próximo giro ${ms == null ? espera : formatarLibera(ms, agoraLoja())}.`
  },
  teusCupons: (n: number) => `Teus cupons (${n})`,
  naSacola: 'Na sacola ✓',
  tirar: 'Tirar',
  usado: (dia: string) => `USADO ${dia}`,
  venceu: 'VENCEU',
  encerrado: 'Exemplo encerrado',
  vazio: 'Nenhum cupom ainda. Gira o dichavador e o prêmio fica guardado aqui.',
  proximos: 'Próximos interativos',
  emBreve: 'em breve',
  vemMais: 'Vem mais coisa aí.',
  teusDados: 'Teus dados',
  promoLigadas: (sim: boolean) => `Promoções no WhatsApp: ${sim ? 'ligadas' : 'desligadas'}`,
  editar: 'Editar',
  sair: 'Sair',
  sairLegenda: 'Pra entrar de novo, usa o mesmo WhatsApp neste aparelho.',
  sairLegendaServidor: 'Pra entrar de novo, é só teu WhatsApp e o código que a loja manda.',
  apagarConta: 'Apagar minha conta deste aparelho',
  apagarContaServidor: 'Apagar minha conta',
  get apagarPergunta() {
    return `Apagar conta e cupons deste aparelho? Não dá pra desfazer. ${porDia() ? 'O giro de hoje continua usado.' : 'Os giros que tu já deu continuam contando.'}`
  },
  get apagarPerguntaServidor() {
    return `Apagar tua conta, teus cupons e teus endereços? Não dá pra desfazer. Teus pedidos continuam com a loja, e ${porDia() ? 'o giro de hoje continua usado.' : 'os giros que tu já deu continuam contando.'}`
  },
  apagar: 'Apagar',
  apagada: 'Conta apagada deste aparelho.',
  apagadaServidor: 'Conta apagada.',
  naoApagou: 'Não deu pra apagar agora. Tenta de novo.',
  saiu: 'Tu saiu da conta.',
} as const

// Em dev, a copy passa pela mesma lista dos prêmios (sem acento, sem caixa, no começo de palavra).
if (import.meta.env.DEV) {
  const sem = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const lista = PALAVRAS_PROIBIDAS.map(sem)
  const textos: string[] = []
  for (const v of Object.values(T)) {
    if (typeof v === 'string') textos.push(v)
    else if (Array.isArray(v)) textos.push(...v)
    else if (typeof v === 'function') textos.push(String((v as (...a: unknown[]) => unknown)('x', 'y', true)))
  }
  for (const t of textos) {
    const w = lista.find((p) => new RegExp(`(^|[^a-z0-9])${p}`).test(sem(t)))
    if (w) console.warn(`[sorte] copy com palavra fora da lista ("${w}"): ${t}`)
  }
}
