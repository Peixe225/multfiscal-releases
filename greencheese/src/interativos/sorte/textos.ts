// A copy do "Teste minha sorte" (pt-BR informal, "tu/teu"): a das entradas do site está em textos-entrada.ts (pedaço
// principal) e entra aqui por inteiro; o resto baixa com o jogo, o formulário e a Minha conta.
// Nunca: "sorteio", "grátis", "frete", prazo, chance em %, valor de desconto calculado, nem as palavras de
// PALAVRAS_PROIBIDAS (src/dados/sorte.ts). Em dev, a lista é conferida aqui embaixo.
import { PALAVRAS_PROIBIDAS } from '../../dados/sorte'
import { TE } from './textos-entrada'

export const T = {
  ...TE,
  legendaCasca: (instagram: string | null) => `interativo · ${instagram ? `@${instagram}` : 'Green Cheese'}`,
  carregando: 'carregando…',

  // convite
  sub: 'Gira a tampa do dichavador. Dentro tem um beck bolado, e no beck, teu cupom.',
  adesivoGira: 'Gira a tampa',
  legendaCelular: 'Gira a tampa',
  legendaDesktop: 'Arrasta em círculo, usa a roda do mouse ou segura Espaço',
  botaoGirar: 'Girar',
  ariaGirar: 'Girar a tampa um quarto de volta',
  limites: 'Sem conta: 1 giro. Com conta: 1 giro por dia.',
  verRegras: 'O que pode sair? · Regras',
  contaLocal: 'Por enquanto, a conta fica só neste aparelho.',

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
  saiuBolado: 'Saiu bolado.',
  soPapel: 'Só papel e sorte.',
  vivoSaiu: (titulo: string, regra: string, exemplo: boolean) => `Saiu: ${titulo}. ${regra}.${exemplo ? ' Prêmio de exemplo.' : ''}`,

  // cartão: o prêmio é o herói (destaque + produto + 1 linha de apoio); as condições ficam no "Ver condições"
  faixaCartao: 'GREEN CHEESE',
  deuSorte: 'DEU SORTE!',
  verProduto: 'Ver produto',
  verCondicoes: 'Ver condições',
  fecharCondicoes: 'Fechar condições',
  condValidadeSemConta: (dias: number) => `Vale ${dias} ${dias === 1 ? 'dia' : 'dias'} depois de guardado, em 1 pedido.`,
  condValidadeGuardado: (ate: string) => `Vale até ${ate}, em 1 pedido.`,
  condUmPorPedido: '1 cupom por pedido. Não soma com outro cupom.',
  condEstado: 'Só com o produto disponível no teu estado.',
  condLoja: 'A loja confirma no WhatsApp: o site não mexe no subtotal.',
  codigo: 'Código',
  codigoMascarado: 'Código liberado quando tu guarda o prêmio',
  copiar: 'Copiar',
  copiado: 'Código copiado.',
  naoCopiou: 'Não deu pra copiar. Segura no código e copia.',

  // prêmio sem conta
  esperando: 'TEU PRÊMIO TÁ ESPERANDO',
  soNomeZap: 'Só nome e WhatsApp.',
  reservado: (ate: string) => `Sem conta, ele fica guardado neste aparelho até ${ate}. Depois some.`,
  agoraNao: 'Agora não',
  avisoAgoraNao: (ate: string) => `Teu prêmio fica guardado aqui até ${ate}.`,

  // prêmio com conta
  usarAgora: 'Usar agora',
  verCuponsN: (n: number) => `Ver meus cupons (${n})`,
  naConta: 'Tá na tua conta. Amanhã tem outro giro.',

  // guardado
  faixaPremio: (titulo: string) => `Teu prêmio: ${titulo}`,
  guardado: 'GUARDADO',
  fechou: (nome: string) => (nome ? `Fechou, ${nome}. Teu cupom tá guardado.` : 'Fechou. Teu cupom tá guardado.'),
  valeAte: (ate: string) => `Vale até ${ate}.`,
  vivoGuardado: (codigo: string, ate: string) => `Código ${codigo}. Vale até ${ate}.`,
  voltaAmanha: 'Volta amanhã pra girar de novo. Vem no certo!',
  contaCriada: (nome: string) => (nome ? `Conta criada, ${nome}.` : 'Conta criada.'),
  giroLiberado: 'Teu giro de hoje tá liberado.',
  proximoAmanha: 'Teu próximo giro libera amanhã.',
  entrou: (nome: string) => (nome ? `Oi de novo, ${nome}.` : 'Oi de novo.'),

  // espera
  proximoGiro: 'PRÓXIMO GIRO',
  ariaProximo: 'Próximo giro amanhã, depois da meia-noite',
  hojeJaFoi: 'Hoje já foi. Amanhã tem mais.',
  hojeSaiu: 'Hoje saiu:',
  avisoLiberou: 'Teu giro de hoje tá liberado',

  // bloqueado
  premioVenceu: (dia: string) => `O prêmio de ${dia} venceu.`,
  vantagens: 'Com conta: 1 giro por dia, cupons guardados e teu nome já no pedido.',
  jaTenhoConta: 'Já tenho conta',

  // regras
  regras: 'Regras',
  /** `dias`: a validade, quando todos os prêmios têm a mesma (src/dados/sorte.ts); null = cada cupom diz a dele. */
  regrasLista: (dias: number | null) => [
    'Todo giro ganha.',
    'Sem conta: 1 giro. Com conta: 1 giro por dia (vira à meia-noite, horário de Brasília).',
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

  // conta (formulário)
  criaTuaConta: 'Cria tua conta',
  subComPremio: 'Só nome e WhatsApp. O prêmio fica guardado, tu gira 1 vez por dia e teu nome já vai no pedido.',
  subSemPremio: 'Só nome e WhatsApp. Com conta: 1 giro por dia, cupons guardados e teu nome já no pedido.',
  teuNome: 'Teu nome',
  nomePlaceholder: 'Como a loja te chama',
  erroNome: 'Escreve teu nome.',
  teuZap: 'Teu WhatsApp',
  zapPlaceholder: '(21) 99999-9999',
  promo: 'Quero receber promoções da Green Cheese no WhatsApp',
  promoLegenda: 'Opcional. Dá pra desligar quando quiser em Minha conta.',
  promoLocal: ' (por enquanto, nada é enviado)',
  mais18: 'Ao criar a conta, tu confirma que tem 18 anos ou mais.',
  privacidade:
    'Teu nome e WhatsApp servem só pra guardar teus cupons e adiantar teu pedido. Por enquanto, a conta fica só neste aparelho: nada vai pra servidor da loja.',
  criarEGuardar: 'Criar conta e guardar prêmio',
  guardando: 'Guardando…',
  zapExiste: 'Esse WhatsApp já tem conta neste aparelho.',
  entrar: 'Entrar',
  codigoZap: 'Código que chegou no teu WhatsApp',
  codigoEnviado: (mascarado: string) => `Mandamos um código pro WhatsApp ${mascarado}.`,
  codigoErrado: 'Esse código não confere. Olha de novo no WhatsApp.',
  muitasTentativas: 'Muitas tentativas. Espera uns minutos e tenta de novo.',
  trocarNumero: 'Trocar número',
  naoEncontrada: 'Esse WhatsApp não tem conta neste aparelho. Na prévia, a conta só existe no aparelho onde foi criada.',
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

  // minha conta
  minhaConta: 'Minha conta',
  oi: (nome: string) => `Oi, ${nome}`,
  zapLegenda: (mascarado: string) => `WhatsApp ${mascarado}`,
  avisoContaLocal:
    'Por enquanto, a conta fica só neste aparelho. Abriu pelo Instagram? Ela fica no navegador do Instagram. Limpar os dados do navegador apaga tudo.',
  giroDeHoje: 'Giro de hoje',
  liberadoHoje: 'Teu giro de hoje tá liberado',
  girarDichavador: 'Girar o dichavador',
  usadoHoje: (espera: string) => `Hoje já foi. Próximo giro ${espera}.`,
  teusCupons: (n: number) => `Teus cupons (${n})`,
  valeAteFalta: (ate: string, falta: string) => `Vale até ${ate} · ${falta}`,
  naSacola: 'Na sacola ✓',
  tirar: 'Tirar',
  usado: (dia: string) => `USADO ${dia}`,
  venceu: 'VENCEU',
  encerrado: 'Exemplo da prévia, encerrado',
  vazio: 'Nenhum cupom ainda. Gira o dichavador e o prêmio fica guardado aqui.',
  proximos: 'Próximos interativos',
  emBreve: 'em breve',
  vemMais: 'Vem mais coisa aí.',
  teusDados: 'Teus dados',
  promoLigadas: (sim: boolean) => `Promoções no WhatsApp: ${sim ? 'ligadas' : 'desligadas'}`,
  editar: 'Editar',
  sair: 'Sair',
  sairLegenda: 'Pra entrar de novo, usa o mesmo WhatsApp neste aparelho.',
  apagarConta: 'Apagar minha conta deste aparelho',
  apagarPergunta: 'Apagar conta e cupons deste aparelho? Não dá pra desfazer. O giro de hoje continua usado.',
  apagar: 'Apagar',
  apagada: 'Conta apagada deste aparelho.',
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
