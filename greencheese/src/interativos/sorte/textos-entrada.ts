// A copy do "Teste minha sorte" que as entradas do site usam (destaque, lateral, adesivo do feed, sacola).
// Fica no pedaço principal; o resto da copy (jogo, formulário, Minha conta) está em textos.ts, que baixa com o jogo.
// Mesmas regras de textos.ts (pt-BR informal, "tu/teu", sem as palavras de PALAVRAS_PROIBIDAS).

export const TE = {
  titulo: 'Teste minha sorte',
  tituloPx: 'TESTE MINHA SORTE',
  curto: 'Sorte',
  curtoPremio: 'Prêmio',
  pergunta: 'Tá com sorte hoje?',
  todoGiroGanha: 'Todo giro ganha.',
  guardar: 'Guardar meu prêmio',
  giroJaFoi: 'Teu giro já foi.',
  criaAmanha: 'Cria tua conta pra girar de novo amanhã.',
  criaAgora: 'Cria tua conta e gira de novo agora.',
  criarConta: 'Criar conta',
  girar: 'Girar',
  usarNoPedido: 'Usar no pedido',
  verCupons: 'Ver meus cupons',
  cupomAplicado: (codigo: string) => `Cupom ${codigo} no pedido.`,
  exemplo: 'exemplo',
} as const
