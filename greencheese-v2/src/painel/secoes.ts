// As seções do painel. Cada uma pede a permissão do mapa do servidor (equipe.php) e mora num grupo:
// - principal: o dia a dia (a lateral do computador e do tablet mostra esses);
// - loja e config: as partes da loja e as configurações feitas uma vez, juntas no "Mais";
// - ajuda e conta: o guia do painel e a conta de quem tá logado (também no "Mais").
// A barra de baixo do celular é outra lista, por papel (barraDo): dono = Início · Pedidos · + · Produtos · Mais;
// gerente = Início · Pedidos · + · Estoque · Mais; atendente = Início · Pedidos · Rateios · Mais. O "+" abre a folha
// "Criar" (Novo produto, Novo rateio) com as opções que o papel tem; com uma só, vai direto pra ela.
// Seção nova entra aqui, com a tela dela em Painel.tsx. Só entra o que já funciona.
import { pode } from './permissoes'
import type { Rota } from './rotas'
import { caminho } from './rotas'
import type { Papel, Usuario } from './tipos'

export type Grupo = 'principal' | 'loja' | 'config' | 'ajuda' | 'conta'

export interface Secao {
  id: string
  nome: string
  /** Uma linha do que tem lá (no "Mais"). */
  sub?: string
  href: string
  icone: string
  iconeAtivo: string
  /** Telas que acendem esta seção. */
  telas: Rota['tela'][]
  /** A permissão que a seção pede (a mesma do servidor). */
  permissao: string
  grupo: Grupo
  /** Some pra quem tem essa permissão (o Estoque é o "Produtos" de quem não cuida da loja inteira). */
  semPermissao?: string
  /** Só na lateral (no celular ela é o "+" da barra). */
  soLateral?: boolean
}

export const secoes: Secao[] = [
  { id: 'resumo', nome: 'Início', href: caminho.resumo, icone: 'casa', iconeAtivo: 'casa-cheia', telas: ['resumo'], permissao: 'resumo', grupo: 'principal' },
  { id: 'pedidos', nome: 'Pedidos', sub: 'Os pedidos do site, do novo ao entregue', href: caminho.pedidos, icone: 'pedido', iconeAtivo: 'pedido-cheio', telas: ['pedidos', 'pedido'], permissao: 'pedidos', grupo: 'principal' },
  { id: 'produtos', nome: 'Produtos', sub: 'Preço, foto, estoque e onde tem', href: caminho.produtos, icone: 'sacola', iconeAtivo: 'sacola-cheia', telas: ['produtos', 'produto', 'produto-novo'], permissao: 'loja', grupo: 'principal' },
  { id: 'estoque', nome: 'Estoque', sub: 'À venda e quantas unidades, nos teus estados', href: caminho.estoque, icone: 'estoque', iconeAtivo: 'estoque', telas: ['estoque'], permissao: 'produtos', semPermissao: 'loja', grupo: 'principal' },
  { id: 'rateios', nome: 'Rateios', sub: 'Os abertos, os a caminho e os encerrados', href: caminho.rateios, icone: 'caixa', iconeAtivo: 'caixa-cheia', telas: ['rateios', 'rateio', 'editar'], permissao: 'rateios-ver', grupo: 'principal' },
  { id: 'novo', nome: 'Criar rateio', href: caminho.novo, icone: 'criar', iconeAtivo: 'criar-cheio', telas: ['novo'], permissao: 'rateios', grupo: 'principal', soLateral: true },
  { id: 'atividade', nome: 'Histórico', sub: 'Tudo que aconteceu, com quem fez', href: caminho.atividade, icone: 'relogio', iconeAtivo: 'relogio', telas: ['atividade'], permissao: 'atividade', grupo: 'principal' },
  // as partes da loja (só o dono)
  { id: 'estados', nome: 'Estados', sub: 'Horário, taxa, entrega grátis, cidades e WhatsApp', href: caminho.estados, icone: 'pin', iconeAtivo: 'pin', telas: ['estados', 'estado'], permissao: 'loja', grupo: 'loja' },
  { id: 'stories', nome: 'Stories do Início', sub: 'Os produtos que passam no story de cada estado', href: caminho.stories, icone: 'estrela', iconeAtivo: 'estrela', telas: ['stories'], permissao: 'loja', grupo: 'loja' },
  { id: 'sorte', nome: 'Teste minha sorte', sub: 'Com que frequência gira, prêmios e chances', href: caminho.sorte, icone: 'dichavador', iconeAtivo: 'dichavador', telas: ['sorte', 'premio'], permissao: 'loja', grupo: 'loja' },
  { id: 'loja', nome: 'Ajustes da loja', sub: 'WhatsApp do pedido, “restam X”, textos e dados de exemplo', href: caminho.loja, icone: 'loja', iconeAtivo: 'loja-cheia', telas: ['loja'], permissao: 'loja', grupo: 'loja' },
  // o que se configura uma vez (Equipe primeiro: é o que mais se abre daqui)
  { id: 'equipe', nome: 'Equipe', sub: 'Logins de gerente e atendente, senha provisória', href: caminho.equipe, icone: 'equipe', iconeAtivo: 'equipe-cheia', telas: ['equipe', 'usuario'], permissao: 'equipe', grupo: 'config' },
  { id: 'avisos', nome: 'Avisos no WhatsApp', sub: 'Cada pedido vira um aviso no grupo da loja', href: caminho.avisos, icone: 'sino', iconeAtivo: 'sino-cheio', telas: ['avisos'], permissao: 'avisos', grupo: 'config' },
  { id: 'clientes', nome: 'Clientes', sub: 'Contas do site, lista de promoções e o código pelo WhatsApp', href: caminho.clientes, icone: 'clientes', iconeAtivo: 'clientes-cheio', telas: ['clientes', 'cliente'], permissao: 'clientes', grupo: 'config' },
  { id: 'categorias', nome: 'Categorias', sub: 'As bolinhas do Início e a ordem delas', href: caminho.categorias, icone: 'tudo', iconeAtivo: 'tudo', telas: ['categorias'], permissao: 'loja', grupo: 'config' },
  { id: 'textos', nome: 'Textos do pedido', sub: 'As falas do chat que monta o pedido', href: caminho.textos, icone: 'balao', iconeAtivo: 'balao-cheio', telas: ['textos'], permissao: 'textos', grupo: 'config' },
  { id: 'servidor', nome: 'Diagnóstico', sub: 'Pra quem cuida do site: o servidor por dentro', href: caminho.servidor, icone: 'servidor', iconeAtivo: 'servidor-cheio', telas: ['servidor'], permissao: 'servidor', grupo: 'config' },
  // ajuda e a conta
  { id: 'ajuda', nome: 'Como usar o painel', sub: 'As tarefas do dia a dia, passo a passo', href: caminho.ajuda, icone: 'interrogacao', iconeAtivo: 'interrogacao', telas: ['ajuda'], permissao: 'conta', grupo: 'ajuda' },
  { id: 'conta', nome: 'Conta', sub: 'Tua senha, a cópia de segurança e sair', href: caminho.conta, icone: 'conta', iconeAtivo: 'conta', telas: ['conta'], permissao: 'conta', grupo: 'conta' },
]

/** As seções que o papel de quem está logado pode abrir. */
export function secoesDo(u: Usuario | null): Secao[] {
  return secoes.filter((s) => pode(s.permissao, u) && !(s.semPermissao && pode(s.semPermissao, u)))
}

/** A seção que tem essa tela (pra saber se o papel pode abrir). */
export function secaoDaTela(tela: Rota['tela']): Secao | undefined {
  return secoes.find((s) => s.telas.includes(tela))
}

// ─── a barra de baixo (celular) ─────────────────────────────────────────────────────────────────────────────────

export interface OpcaoCriar {
  id: 'produto' | 'rateio'
  nome: string
  sub: string
  href: string
  icone: string
}

/** O que o "+" cria pra esse papel: produto (quem cuida da loja) e rateio (quem mexe nos rateios). */
export function opcoesCriar(u: Usuario | null): OpcaoCriar[] {
  const out: OpcaoCriar[] = []
  if (pode('loja', u)) out.push({ id: 'produto', nome: 'Novo produto', sub: 'Foto, nome, preço e onde tem', href: caminho.produtoNovo, icone: 'sacola' })
  if (pode('rateios', u)) out.push({ id: 'rateio', nome: 'Novo rateio', sub: 'Compra junta: vagas, preço e prazo', href: caminho.novo, icone: 'caixa' })
  return out
}

export interface ItemBarra {
  id: string
  nome: string
  icone: string
  iconeAtivo: string
  telas: Rota['tela'][]
  /** Link; sem href é o "+" (abre a folha Criar). */
  href?: string
}

/** Telas que acendem o "Mais" (tudo que não tem item próprio na barra). */
function telasDoMais(itens: ItemBarra[]): Rota['tela'][] {
  const naBarra = new Set(itens.flatMap((i) => i.telas))
  return [...secoes.flatMap((s) => s.telas), 'mais' as const].filter((t) => !naBarra.has(t))
}

const ITENS_BARRA: Record<Papel, string[]> = {
  dono: ['resumo', 'pedidos', 'criar', 'produtos', 'mais'],
  gerente: ['resumo', 'pedidos', 'criar', 'estoque', 'mais'],
  atendente: ['resumo', 'pedidos', 'rateios', 'mais'],
}

/** A barra de baixo do celular pra esse papel (no máximo 5, com nome embaixo de cada ícone). */
export function barraDo(u: Usuario | null): ItemBarra[] {
  const papel: Papel = u?.papel ?? 'dono'
  const minhas = secoesDo(u)
  const criar = opcoesCriar(u)
  const itens: ItemBarra[] = []
  for (const id of ITENS_BARRA[papel]) {
    if (id === 'criar') {
      if (criar.length === 1) itens.push({ id: 'criar', nome: 'Criar', icone: 'criar', iconeAtivo: 'criar-cheio', telas: criar[0].id === 'rateio' ? ['novo'] : ['produto-novo'], href: criar[0].href })
      else if (criar.length > 1) itens.push({ id: 'criar', nome: 'Criar', icone: 'criar', iconeAtivo: 'criar-cheio', telas: ['novo', 'produto-novo'] })
      continue
    }
    if (id === 'mais') continue
    const s = minhas.find((x) => x.id === id)
    if (s) itens.push({ id: s.id, nome: s.nome, icone: s.icone, iconeAtivo: s.iconeAtivo, telas: s.telas.filter((t) => !itens.some((i) => i.telas.includes(t))), href: s.href })
  }
  itens.push({ id: 'mais', nome: 'Mais', icone: 'menu', iconeAtivo: 'menu', telas: telasDoMais(itens), href: caminho.mais })
  return itens.slice(0, 5)
}

/** O que vai no "Mais", na ordem dos grupos (as que já estão na barra ficam de fora). */
export function maisDo(u: Usuario | null): { grupo: Grupo; titulo: string; secoes: Secao[] }[] {
  const naBarra = new Set(barraDo(u).map((i) => i.id))
  const minhas = secoesDo(u).filter((s) => !s.soLateral && !naBarra.has(s.id) && s.id !== 'resumo')
  const titulos: [Grupo, string][] = [
    ['principal', 'Dia a dia'],
    ['loja', 'Loja'],
    ['config', 'Configurações da loja'],
    ['ajuda', 'Ajuda'],
    ['conta', 'Tua conta'],
  ]
  return titulos.map(([grupo, titulo]) => ({ grupo, titulo, secoes: minhas.filter((s) => s.grupo === grupo) })).filter((g) => g.secoes.length > 0)
}

/** A lateral (computador e tablet): o dia a dia, o "Mais" e a conta. */
export function lateralDo(u: Usuario | null): { principais: Secao[]; mais: Rota['tela'][] } {
  const principais = secoesDo(u).filter((s) => s.grupo === 'principal')
  const nasPrincipais = new Set(principais.flatMap((s) => s.telas))
  const mais = [...secoes.flatMap((s) => s.telas), 'mais' as const].filter((t) => !nasPrincipais.has(t) && t !== 'conta')
  return { principais, mais }
}
