// Conta do cliente (Teste minha sorte e os próximos interativos).
//
// modo 'local' (prévia): a conta, os cupons e o limite de giros ficam só neste aparelho (localStorage). Nada vai pra
// servidor nenhum. modo 'servidor' (versão oficial): o adaptador de src/lib/conta.ts passa a falar com a API da loja
// (PHP + MySQL na Hostinger), que sorteia, gera o código, guarda os cupons e valida o limite. Ver PENDENCIAS.md.
export const configConta = {
  modo: 'local' as 'local' | 'servidor',
}
