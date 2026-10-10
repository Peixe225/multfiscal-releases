// Um cliente: os dados da conta (com as promoções e a data), os endereços, os cupons (a loja dá baixa ou desfaz),
// os pedidos e as vagas de rateio do WhatsApp dele, e o apagar dados (o pedido de exclusão que chegou pela conversa).
import { useState } from 'react'
import * as api from '../api'
import { Confirmar, type PedidoConfirmacao } from '../Confirmar'
import { useDados } from '../dados'
import { dataCompleta, relativo, whatsappBonito } from '../formato'
import { Link, Topo } from '../Moldura'
import { LinhaPedido } from '../pedidos/comum'
import { caminho, ir } from '../rotas'
import { useRestaurarRolagem, useTitulo } from '../telas/comum'
import { avisarNaProxima } from '../telas/flash'
import { Aviso, Botao, Carregando, Ic, Linha, TituloTela } from '../ui'
import { apagarCliente, cliente, cupomUsado } from './api'
import './estilo'
import type { CupomCliente, DetalheCliente, EnderecoCliente } from './tipos'

const STATUS_VAGA: Record<string, string> = { reservado: 'Reservada', confirmado: 'Paga', expirado: 'Venceu', cancelado: 'Cancelada', entregue: 'Entregue' }

function textoEndereco(e: EnderecoCliente): string {
  const lugar = [e.cidade, e.uf.toUpperCase()].filter(Boolean).join('/')
  const base = e.cep ? `${e.rua}${e.numero ? `, ${e.numero}` : ''}${e.bairro ? ` — ${e.bairro}` : ''}` : e.livre
  return `${base}${lugar ? ` · ${lugar}` : ''}`
}

export function Cliente({ id }: { id: number }) {
  const leitura = useDados<DetalheCliente>(`cliente:${id}`, (s) => cliente(id, s))
  const d = leitura.dados
  useTitulo(d ? d.cliente.nome : 'Cliente')
  useRestaurarRolagem(!!d)
  const [pedido, setPedido] = useState<PedidoConfirmacao | null>(null)
  const agora = api.agora()

  if (!d) {
    return (
      <>
        <Topo titulo={<TituloTela>Cliente</TituloTela>} voltar={caminho.clientes} />
        <div className="pn-pagina pn-pagina-estreita">
          {leitura.erro ? (
            <Aviso tipo="erro" acao={<button type="button" className="pn-link-botao" onClick={() => void leitura.recarregar()}>Tentar de novo</button>}>
              {leitura.erro.codigo === 'nao-encontrado' ? 'Esse cliente não existe mais (a conta foi apagada).' : leitura.erro.message}
            </Aviso>
          ) : (
            <Carregando />
          )}
        </div>
      </>
    )
  }
  const c = d.cliente
  const trocarCupom = (k: CupomCliente) => leitura.trocar((x) => ({ ...x, cupons: x.cupons.map((y) => (y.codigo === k.codigo ? k : y)) }))
  const baixa = (k: CupomCliente) =>
    setPedido(
      k.usadoEm
        ? {
            titulo: `Desfazer a baixa do ${k.codigo}?`,
            texto: 'O cupom volta a valer pro cliente (se ainda estiver no prazo).',
            botao: 'Desfazer a baixa',
            acao: async () => trocarCupom((await cupomUsado(k.codigo, false)).cupom),
          }
        : {
            titulo: `Dar baixa no ${k.codigo}?`,
            texto: 'Marca o cupom como usado: ele sai dos cupons ativos do cliente.',
            botao: 'Dar baixa',
            acao: async () => trocarCupom((await cupomUsado(k.codigo, true)).cupom),
          },
    )
  const apagar = () =>
    setPedido({
      titulo: `Apagar a conta de ${c.nome}?`,
      texto: 'Some a conta, os endereços e os cupons. Os pedidos e as vagas de rateio continuam (cada um tem o "Apagar os dados" dele). Não dá pra desfazer.',
      botao: 'Apagar a conta',
      perigo: true,
      acao: async () => {
        await apagarCliente(c.id)
        avisarNaProxima('Conta apagada.')
        ir(caminho.clientes, true)
      },
    })

  return (
    <>
      <Topo titulo={<TituloTela>{c.nome}</TituloTela>} voltar={caminho.clientes} />
      <div className="pn-pagina pn-pagina-estreita">
        <section className="pn-bloco" aria-label="Conta">
          <dl className="ct-dados">
            <Linha rotulo="WhatsApp">
              <a className="pn-link-botao" href={`https://wa.me/${c.whatsapp}`} target="_blank" rel="noopener noreferrer">
                {whatsappBonito(c.whatsapp)}
              </a>
            </Linha>
            <Linha rotulo="Promoções">{c.aceitaPromo ? `aceitou ${c.aceitaPromoEm ? `em ${dataCompleta(c.aceitaPromoEm)}` : ''}` : 'não aceitou'}</Linha>
            <Linha rotulo="Estado">{c.uf ? c.uf.toUpperCase() : '—'}</Linha>
            <Linha rotulo="Conta criada">
              {dataCompleta(c.criadoEm)}
              {c.origem === 'aparelho' ? ' (veio da conta do aparelho)' : ''}
            </Linha>
            <Linha rotulo="Confirmou 18 anos">{dataCompleta(c.confirmou18Em)}</Linha>
            <Linha rotulo="Último acesso">{c.acessoEm ? relativo(c.acessoEm, agora) : '—'}</Linha>
            <Linha rotulo="Giros no Teste minha sorte">{d.giros}</Linha>
          </dl>
        </section>

        <section className="pn-bloco" aria-labelledby="h-cupons">
          <h2 id="h-cupons" className="pn-h2">
            Cupons
          </h2>
          {d.cupons.length === 0 && <p className="pn-vazio">Nenhum cupom.</p>}
          {d.cupons.length > 0 && (
            <ul className="ct-cupons">
              {d.cupons.map((k) => {
                const vencido = !k.usadoEm && Date.parse(k.validoAte) < agora
                return (
                  <li key={k.codigo} className="ct-cupom">
                    <div className="ct-cupom-txt">
                      <span className="pn-codigo">{k.codigo}</span>
                      <span>{k.retrato.regra}</span>
                      <small>
                        {k.usadoEm ? `Usado ${relativo(k.usadoEm, agora)}` : vencido ? 'Venceu' : `Vale até ${dataCompleta(k.validoAte)}`}
                        {k.origem === 'aparelho' ? ' · veio do aparelho' : ''}
                        {k.demo ? ' · exemplo' : ''}
                      </small>
                    </div>
                    {(k.usadoEm || !vencido) && (
                      <Botao variante="cinza" className="pn-botao-p" onClick={() => baixa(k)}>
                        {k.usadoEm ? 'Desfazer' : 'Dar baixa'}
                      </Botao>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="pn-bloco" aria-labelledby="h-pedidos-cliente">
          <h2 id="h-pedidos-cliente" className="pn-h2">
            Pedidos
          </h2>
          {d.pedidos.length === 0 && <p className="pn-vazio">Nenhum pedido com essa conta ou esse WhatsApp.</p>}
          {d.pedidos.length > 0 && (
            <ul className="pd-lista">
              {d.pedidos.map((p) => (
                <li key={p.id}>
                  <LinhaPedido p={p} agora={agora} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="pn-bloco" aria-labelledby="h-vagas-cliente">
          <h2 id="h-vagas-cliente" className="pn-h2">
            Vagas em rateios
          </h2>
          {d.vagas.length === 0 && <p className="pn-vazio">Nenhuma vaga com esse WhatsApp.</p>}
          {d.vagas.length > 0 && (
            <ul className="pn-menu">
              {d.vagas.map((v) => (
                <li key={v.id}>
                  <Link href={caminho.rateio(v.rateio)} className="pn-menu-item toque">
                    <Ic nome="caixa" tamanho={16} />
                    <span>
                      {v.rateioTitulo} · <span className="pn-codigo">{v.codigo}</span>
                      <small className="ct-sub"> {STATUS_VAGA[v.status] ?? v.status}</small>
                    </span>
                    <Ic nome="chevron-dir" tamanho={16} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="pn-bloco" aria-labelledby="h-enderecos-cliente">
          <h2 id="h-enderecos-cliente" className="pn-h2">
            Endereços
          </h2>
          {d.enderecos.length === 0 && <p className="pn-vazio">Nenhum endereço guardado.</p>}
          {d.enderecos.length > 0 && (
            <ul className="ct-enderecos">
              {d.enderecos.map((e) => (
                <li key={e.id}>
                  {e.apelido && <strong>{e.apelido}: </strong>}
                  {textoEndereco(e)}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="pn-bloco" aria-labelledby="h-lgpd-cliente">
          <h2 id="h-lgpd-cliente" className="pn-h2">
            Apagar a conta (LGPD)
          </h2>
          <p className="pn-dica-bloco">Quando o cliente pedir pra apagar os dados dele. O próprio cliente também apaga em Minha conta, no site.</p>
          <Botao variante="perigo" icone="lixo" onClick={apagar}>
            Apagar a conta
          </Botao>
        </section>
      </div>
      <Confirmar pedido={pedido} aoFechar={() => setPedido(null)} />
    </>
  )
}
