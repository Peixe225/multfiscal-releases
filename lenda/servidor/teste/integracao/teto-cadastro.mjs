// Teto de cadastros do site inteiro (cadastrar-todos, 1.500 a cada 10 min): pedidos de cadastro INVÁLIDOS, de IPs
// diferentes (até 30 por IP, dentro do limite de cada um), não podem gastar o teto do site — senão uns poucos IPs
// fechariam o cadastro de todo mundo. Depois deles, um cadastro válido de outro IP tem de entrar (201).
// (Antes da correção no conta.php: 150 × 400, 60 × 429 e o válido recebia 429.) Uso: node teto-cadastro.mjs
import { URL0, ORIGEM } from './lib.mjs'

const post = (corpo, ip) =>
  fetch(`${URL0}api/conta.php`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGEM, 'X-Forwarded-For': ip }, body: JSON.stringify(corpo) })
const st = {}
for (let i = 0; i < 210; i++) {
  const ip = `10.99.${Math.floor(i / 30)}.${i % 30}`
  const r = await post({ acao: 'cadastrar', apelido: 'x', email: 'invalido', senha: '1', aceite: true }, ip)
  st[r.status] = (st[r.status] ?? 0) + 1
}
console.log('210 cadastros inválidos (7 IPs, 30 cada):', JSON.stringify(st))
const ok = await post({ acao: 'cadastrar', apelido: 'Pessoa Real', email: `real${Date.now()}@exemplo.com`, senha: 'segredo-123', aceite: true }, '10.98.0.1')
console.log('depois, um cadastro válido de outro IP:', ok.status, (await ok.text()).slice(0, 80))
const passou = st[400] === 210 && ok.status === 201
console.log(passou ? 'TETO: PASSOU' : 'TETO: FALHOU')
process.exit(passou ? 0 : 1)
