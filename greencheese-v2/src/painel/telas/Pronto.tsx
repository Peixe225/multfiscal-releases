// "Pra deixar a loja pronta": a lista do Resumo até a loja ficar do jeito do dono, calculada do que tá na loja de verdade
// (a loja do painel, os rateios do Resumo, as ilustrações do site) e do que só o servidor sabe (admin-pronto: senha,
// equipe, avisos, cópia). Cada item leva à tela certa e some quando fica feito (ou quando o dono toca em "Pular").
// Mostra os 3 primeiros que faltam; o resto num toque.
import { useState } from 'react'
import * as api from '../api'
import type { Leitura } from '../dados'
import { useIlustracoes } from '../loja/Arte'
import { useLoja } from '../loja/dados'
import type { LojaAdmin } from '../loja/tipos'
import { Link } from '../Moldura'
import { recado } from '../recado'
import { caminho } from '../rotas'
import type { ItemPronto, Pronto, RateioAdmin } from '../tipos'
import { Botao, Ic } from '../ui'
import { useBaixarCopia } from './copia'

interface Item {
  id: ItemPronto
  texto: string
  sub: string
  href?: string
  feito: boolean
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`
const lista = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}` : (xs[0] ?? ''))

/** Os itens, na ordem da tela (com o feito de cada um). null enquanto falta o que ler. */
export function itensPronto(p: Pronto, l: LojaAdmin, rateios: RateioAdmin[], ilustracoes: Record<string, unknown> | null): Item[] {
  const noSite = l.estados.filter((e) => e.ativo)
  const deExemplo = noSite.filter((e) => e.horario.demo || e.taxaEntrega.demo)
  const reais = l.produtos.filter((x) => x.ativo && !x.demo)
  const semPreco = reais.filter((x) => x.preco == null)
  const semFoto = ilustracoes ? reais.filter((x) => !x.foto && !ilustracoes[x.id]) : []
  const exProdutos = l.produtos.filter((x) => x.ativo && x.demo).length
  const exPremios = l.sorte.premios.filter((x) => x.demo).length
  const exRateios = rateios.filter((r) => r.demo).length
  const exemplos = [exProdutos && plural(exProdutos, 'produto', 'produtos'), exPremios && plural(exPremios, 'prêmio', 'prêmios'), exRateios && plural(exRateios, 'rateio', 'rateios')].filter((x): x is string => !!x)
  return [
    { id: 'senha', texto: 'Troca a senha que veio na entrega', sub: 'Uma que só tu sabe (10 caracteres ou mais), em Conta.', href: caminho.conta, feito: p.senhaTrocada },
    {
      id: 'estados',
      texto: 'Horário e taxa de cada estado',
      sub: `${deExemplo.length === 1 ? `${deExemplo[0].nome} ainda tá` : `${lista(deExemplo.map((e) => e.uf.toUpperCase()))} ainda tão`} com horário ou taxa de exemplo: o site mostra “a confirmar”.`,
      href: deExemplo.length === 1 ? caminho.estado(deExemplo[0].uf) : caminho.estados,
      feito: deExemplo.length === 0,
    },
    { id: 'exemplos', texto: 'Apagar os dados de exemplo', sub: `${lista(exemplos)} de exemplo ainda no site (Ajustes da loja › Apagar dados de exemplo).`, href: caminho.loja, feito: exemplos.length === 0 },
    { id: 'precos', texto: 'Preço nos produtos', sub: `${plural(semPreco.length, 'produto no site sem preço', 'produtos no site sem preço')} (aparece “Consultar”).`, href: caminho.produtos, feito: semPreco.length === 0 },
    {
      id: 'fotos',
      texto: 'Fotos dos produtos',
      sub: `${reais.length - semFoto.length} de ${reais.length} com foto ou ilustração; ${semFoto.length === 1 ? 'o outro aparece' : 'os outros aparecem'} com o desenho em pixel.`,
      href: caminho.produtos,
      feito: !!ilustracoes && semFoto.length === 0,
    },
    { id: 'equipe', texto: 'Cadastrar a equipe', sub: 'Um login pra cada pessoa, só nos estados dela (e um 2º dono, que gera tua senha se tu esquecer).', href: caminho.equipe, feito: p.equipe > 0 },
    { id: 'avisos', texto: 'Avisos no WhatsApp', sub: 'Cada pedido vira um aviso no grupo da loja. Quem cuida do site liga uma vez; tu só toca em “Enviar teste”.', href: caminho.avisos, feito: p.avisos.ligado },
    { id: 'copia', texto: 'Baixar a 1ª cópia de segurança', sub: 'Um arquivo com tudo da loja, pra guardar fora do celular.', feito: !!p.copia.ultimaEm },
  ]
}

/** Os que ainda faltam (nem feitos nem pulados). */
export function faltamPronto(itens: Item[], p: Pronto): Item[] {
  return itens.filter((i) => !i.feito && !p.pulados.includes(i.id))
}

export function ProntoLista({ leitura, rateios }: { leitura: Leitura<Pronto>; rateios: RateioAdmin[] }) {
  const p = leitura.dados
  const { dados: l } = useLoja()
  const ilustracoes = useIlustracoes()
  const [todos, setTodos] = useState(false)
  const [pulando, setPulando] = useState<ItemPronto | null>(null)
  const copia = useBaixarCopia(leitura)
  if (!p || !l) return null
  const itens = itensPronto(p, l, rateios, ilustracoes)
  const faltam = faltamPronto(itens, p)
  if (!faltam.length) return null
  const feitos = itens.length - faltam.length
  const vis = todos ? faltam : faltam.slice(0, 3)
  const pular = async (i: Item) => {
    if (pulando) return
    setPulando(i.id)
    try {
      const novo = await api.salvarPronto({ pular: { item: i.id, pular: true } })
      leitura.trocar(() => novo)
      recado(`“${i.texto}” saiu da lista.`, {
        desfazer: {
          acao: async () => {
            const volta = await api.salvarPronto({ pular: { item: i.id, pular: false } })
            leitura.trocar(() => volta)
          },
        },
      })
    } catch (e) {
      recado(api.mensagemDe(e), { tipo: 'erro' })
    } finally {
      setPulando(null)
    }
  }
  return (
    <section className="pn-bloco pn-pronto" aria-labelledby="h-pronto">
      <div className="pn-h2-linha">
        <h2 id="h-pronto" className="pn-h2">
          Pra deixar a loja pronta
        </h2>
        <span className="pn-pronto-conta">
          {feitos} de {itens.length} feitos
        </span>
      </div>
      <div className="pn-pronto-barra" aria-hidden="true">
        <i style={{ width: `${Math.round((feitos / itens.length) * 100)}%` }} />
      </div>
      <ul className="pn-pronto-lista">
        {vis.map((i) => (
          <li key={i.id} className="pn-pronto-item">
            {i.href ? (
              <Link href={i.href} className="pn-pronto-link toque">
                <span className="pn-pronto-caixa" aria-hidden="true" />
                <span className="pn-pronto-txt">
                  <strong>{i.texto}</strong>
                  <span>{i.sub}</span>
                </span>
                <Ic nome="chevron-dir" tamanho={16} />
              </Link>
            ) : (
              <div className="pn-pronto-link">
                <span className="pn-pronto-caixa" aria-hidden="true" />
                <span className="pn-pronto-txt">
                  <strong>{i.texto}</strong>
                  <span>{i.sub}</span>
                </span>
                <Botao variante="cinza" className="pn-botao-p" icone="baixar" ocupado={copia.ocupado} onClick={() => void copia.baixar()}>
                  Baixar
                </Botao>
              </div>
            )}
            <button type="button" className="pn-link-botao pn-pronto-pular" disabled={pulando === i.id} aria-label={`Pular: ${i.texto}`} onClick={() => void pular(i)}>
              Pular
            </button>
          </li>
        ))}
      </ul>
      {faltam.length > vis.length && (
        <button type="button" className="pn-link-botao" onClick={() => setTodos(true)}>
          Ver {faltam.length === vis.length + 1 ? 'o outro' : `os outros ${faltam.length - vis.length}`}
        </button>
      )}
      {copia.erro && <p className="pn-erro">{copia.erro.message}</p>}
    </section>
  )
}
