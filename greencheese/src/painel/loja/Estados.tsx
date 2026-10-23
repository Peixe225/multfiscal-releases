// Estados: os perfis que a loja atende (WhatsApp, Instagram, cidades, horário, taxa, entrega grátis e pagamento de
// cada um) e "Ativar outro estado" entre as 27 UFs. Estado fora do site guarda tudo e volta com um toque.
import { useState } from 'react'
import { brl, whatsappBonito } from '../formato'
import { Link, Topo } from '../Moldura'
import { caminho, ir } from '../rotas'
import { pegarRecado } from '../telas/flash'
import { useRestaurarRolagem, useTitulo } from '../telas/comum'
import { Aviso, Botao, Carregando, Ic, TituloTela } from '../ui'
import { useLoja } from './dados'
import { nomeUf, UFS_TODAS } from './nomes'
import type { EstadoAdmin, LojaAdmin } from './tipos'

function resumoDoEstado(e: EstadoAdmin, l: LojaAdmin): string {
  const whats = l.ajustes.mesmoWhatsappParaTodos || !e.whatsapp ? 'WhatsApp da loja' : `WhatsApp ${whatsappBonito(e.whatsapp)}`
  const taxa = e.taxaEntrega.valor == null || e.taxaEntrega.demo ? 'taxa a confirmar' : `taxa ${brl(e.taxaEntrega.valor)}`
  const cidades = e.cidades.length ? e.cidades.map((c) => c.nome).join(', ') : 'cidade a perguntar'
  return `${cidades} · ${whats} · ${taxa}`
}

function LinhaEstado({ e, l }: { e: EstadoAdmin; l: LojaAdmin }) {
  return (
    <li>
      <Link href={caminho.estado(e.uf)} className="pn-est-linha toque">
        <span className={`pn-est-uf px${e.ativo ? '' : ' pn-est-uf-fora'}`} aria-hidden="true">
          {e.uf.toUpperCase()}
        </span>
        <span className="pn-est-txt">
          <strong>{e.nome}</strong>
          <span>@{e.instagram}</span>
          <span>{resumoDoEstado(e, l)}</span>
        </span>
        <Ic nome="chevron-dir" tamanho={16} />
      </Link>
    </li>
  )
}

export function Estados() {
  useTitulo('Estados')
  const leitura = useLoja()
  const l = leitura.dados
  const [recado, setRecado] = useState(pegarRecado)
  const [novo, setNovo] = useState('')
  useRestaurarRolagem(!!l)
  const noSite = l?.estados.filter((e) => e.ativo) ?? []
  const fora = l?.estados.filter((e) => !e.ativo) ?? []
  const livres = l ? UFS_TODAS.filter((uf) => !l.estados.some((e) => e.uf === uf)) : []
  return (
    <>
      <Topo voltar={caminho.loja} titulo={<TituloTela>Estados</TituloTela>} />
      <div className="pn-pagina pn-pagina-estreita">
        {recado && (
          <Aviso tipo="ok" acao={<button type="button" className="icone-botao" aria-label="Fechar o recado" onClick={() => setRecado(null)}><Ic nome="fechar" tamanho={16} /></button>}>
            {recado}
          </Aviso>
        )}
        {leitura.erro && <Aviso tipo="erro">{leitura.erro.message}</Aviso>}
        {!l && !leitura.erro && <Carregando />}
        {l && (
          <>
            <section className="pn-bloco" aria-labelledby="h-est-site">
              <h2 id="h-est-site" className="pn-h2">
                No site <span className="pn-conta">{noSite.length}</span>
              </h2>
              <p className="pn-dica-bloco">
                {l.ajustes.mesmoWhatsappParaTodos ? `Todos fecham o pedido no WhatsApp da loja, ${whatsappBonito(l.ajustes.whatsapp)}.` : 'Cada estado fecha o pedido no WhatsApp dele (ou no da loja, quando não tem um próprio).'}{' '}
                <Link href={caminho.loja} className="pn-link pn-link-dentro">
                  Mudar na Loja
                </Link>
              </p>
              <ul className="pn-lista-est">
                {noSite.map((e) => (
                  <LinhaEstado key={e.uf} e={e} l={l} />
                ))}
              </ul>
            </section>
            {fora.length > 0 && (
              <section className="pn-bloco" aria-labelledby="h-est-fora">
                <h2 id="h-est-fora" className="pn-h2">
                  Fora do site <span className="pn-conta">{fora.length}</span>
                </h2>
                <p className="pn-dica-bloco">Guardados com tudo. Abre e liga “Aparece no site” pra voltar.</p>
                <ul className="pn-lista-est">
                  {fora.map((e) => (
                    <LinhaEstado key={e.uf} e={e} l={l} />
                  ))}
                </ul>
              </section>
            )}
            <section className="pn-bloco" aria-labelledby="h-est-novo">
              <h2 id="h-est-novo" className="pn-h2">
                Ativar outro estado
              </h2>
              <p className="pn-dica-bloco">O estado novo entra com o emblema de pino, horário e taxa “a confirmar” e nenhum produto à venda ainda: tu liga os produtos depois.</p>
              <form
                className="pn-est-novo"
                onSubmit={(ev) => {
                  ev.preventDefault()
                  if (novo) ir(caminho.estado(novo))
                }}
              >
                <label className="sr-only" htmlFor="est-novo">
                  Estado
                </label>
                <select id="est-novo" className="pn-input pn-select" value={novo} onChange={(ev) => setNovo(ev.target.value)}>
                  <option value="">Escolhe o estado</option>
                  {livres.map((uf) => (
                    <option key={uf} value={uf}>
                      {nomeUf(uf)} ({uf.toUpperCase()})
                    </option>
                  ))}
                </select>
                <Botao type="submit" disabled={!novo}>
                  Continuar
                </Botao>
              </form>
            </section>
          </>
        )}
      </div>
    </>
  )
}
