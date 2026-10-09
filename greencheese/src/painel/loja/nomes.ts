// Os nomes que o painel mostra pro que o servidor guarda em código: formato do desenho, ícone da categoria, forma de
// pagamento, dia da semana e as 27 UFs. As listas são as mesmas do servidor (nucleo/loja.php).
import type { FormaPagamento, TipoArte } from './tipos'

export const ARTES: { tipo: TipoArte; nome: string }[] = [
  { tipo: 'lata', nome: 'Lata' },
  { tipo: 'lata-alta', nome: 'Lata alta' },
  { tipo: 'garrafa-quadrada', nome: 'Garrafa quadrada (uísque)' },
  { tipo: 'garrafa-gin', nome: 'Garrafa de gin' },
  { tipo: 'garrafa-conhaque', nome: 'Garrafa de conhaque' },
  { tipo: 'garrafa-licor', nome: 'Garrafa de licor' },
  { tipo: 'seda', nome: 'Livreto de seda' },
  { tipo: 'piteira-vidro', nome: 'Piteira de vidro' },
  { tipo: 'piteira-papel', nome: 'Piteira de papel' },
  { tipo: 'cuia', nome: 'Cuia' },
  { tipo: 'dichavador', nome: 'Dichavador' },
  { tipo: 'isqueiro', nome: 'Isqueiro' },
  { tipo: 'bandeja', nome: 'Bandeja' },
]

/** Ícones da bolinha da categoria (os do site). */
export const ICONES: { id: string; nome: string }[] = [
  { id: 'lata', nome: 'Lata' },
  { id: 'garrafa', nome: 'Garrafa' },
  { id: 'seda', nome: 'Seda' },
  { id: 'piteira', nome: 'Piteira' },
  { id: 'cuia', nome: 'Cuia' },
  { id: 'dichavador', nome: 'Dichavador' },
  { id: 'tesoura', nome: 'Tesoura' },
  { id: 'sacola', nome: 'Sacola' },
  { id: 'estrela', nome: 'Estrela' },
]

export const PAGAMENTOS: { id: FormaPagamento; nome: string }[] = [
  { id: 'pix', nome: 'Pix' },
  { id: 'dinheiro', nome: 'Dinheiro' },
  { id: 'cartao', nome: 'Cartão' },
]

/** Domingo = 0 … sábado = 6 (como no site). */
export const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
export const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

export const NOMES_UF: Record<string, string> = {
  ac: 'Acre', al: 'Alagoas', ap: 'Amapá', am: 'Amazonas', ba: 'Bahia', ce: 'Ceará', df: 'Distrito Federal',
  es: 'Espírito Santo', go: 'Goiás', ma: 'Maranhão', mt: 'Mato Grosso', ms: 'Mato Grosso do Sul', mg: 'Minas Gerais',
  pa: 'Pará', pb: 'Paraíba', pr: 'Paraná', pe: 'Pernambuco', pi: 'Piauí', rj: 'Rio de Janeiro', rn: 'Rio Grande do Norte',
  rs: 'Rio Grande do Sul', ro: 'Rondônia', rr: 'Roraima', sc: 'Santa Catarina', sp: 'São Paulo', se: 'Sergipe', to: 'Tocantins',
}

/** As 27, em ordem alfabética do nome (a lista de "ativar outro estado"). */
export const UFS_TODAS = Object.keys(NOMES_UF).sort((a, b) => NOMES_UF[a].localeCompare(NOMES_UF[b], 'pt-BR'))

export const nomeUf = (uf: string) => NOMES_UF[uf] ?? uf.toUpperCase()
