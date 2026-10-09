import { useEffect, useRef } from 'react'
import { canalDa } from '../dados/canais'
import { ufPorSigla, ufs } from '../dados/ufs'
import { nomeCidade, useLocal } from '../store/local'
import { useCanais, useCanalDa } from '../store/loja'
import { useUI } from '../store/ui'
import { trocarEstado } from '../lib/troca'
import { Avatar } from './comum'
import { Folha } from './Folha'
import { MapaBrasil } from './MapaBrasil'
import './Local.css'

/** Folha de escolha: molde da página de local do Instagram + mapa do Brasil (ajuda a achar) + os 27 estados. */
export function SeletorFolha() {
  const aberto = useUI((s) => s.seletorAberto)
  const setSeletor = useUI((s) => s.setSeletor)
  const { uf, cidade, cidadeInformada, escolher, escolherCidade } = useLocal()
  // os estados da loja agora (o dono ativa outros no painel): a lista de cima e os "outros" acompanham
  const canais = useCanais()
  const canal = useCanalDa(uf)
  const atualNome = uf ? (nomeCidade(canal, cidade, cidadeInformada) ?? ufPorSigla(uf)?.nome) : null
  const fechar = () => setSeletor(false)
  const listaRef = useRef<HTMLDivElement>(null)

  const escolherUf = (s: string) => {
    const c = canalDa(s)
    if (c && c.cidades.length > 1) {
      escolher(s, null, 'manual')
      // fica aberto para escolher a cidade
      requestAnimationFrame(() => listaRef.current?.querySelector<HTMLElement>(`[data-uf="${s}"] .seletor-cidades button`)?.focus())
      return
    }
    // com itens que não têm no novo estado, a confirmação abre por cima
    trocarEstado(s)
    fechar()
  }

  useEffect(() => {
    if (!aberto) return
    // estado atual visível ao abrir
    requestAnimationFrame(() => listaRef.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' }))
  }, [aberto])

  const outros = ufs.filter((u) => !canais.some((c) => c.uf === u.sigla.toLowerCase()))

  return (
    <Folha
      id="seletor"
      aberta={aberto}
      aoFechar={fechar}
      rotulo="Escolher estado e cidade"
      cabecalho={
        <div className="seletor-cab">
          <span className="seletor-cab-titulo">{atualNome ?? 'De onde tu pede?'}</span>
          <span className="seletor-cab-sub legenda">
            {uf ? `${ufPorSigla(uf)?.nome ?? ''}${canal ? ` · @${canal.instagram}` : ' · ainda sem Green Cheese'}` : 'Escolhe o estado e o pedido vai pro atendimento certo'}
          </span>
        </div>
      }
    >
      <div className="seletor" ref={listaRef}>
        <div className="seletor-mapa">
          <MapaBrasil atual={uf} aoTocar={escolherUf} celulaMax={2} />
        </div>

        <h3 className="seletor-titulo">Onde tem Green Cheese</h3>
        <ul>
          {canais.map((c) => {
            const eh = c.uf === uf
            return (
              <li key={c.uf} data-uf={c.uf}>
                <button type="button" className="seletor-linha toque" onClick={() => escolherUf(c.uf)} aria-current={eh} data-foco-inicial={eh ? '' : undefined}>
                  <Avatar tamanho={44} anel={eh} />
                  <span className="seletor-linha-txt">
                    <strong>{c.nome}</strong>
                    <span className="legenda">@{c.instagram}</span>
                    <span className="seletor-cidade">{c.cidades.length ? c.cidades.map((x) => x.nome).join(' · ') : 'cidade a confirmar'}</span>
                  </span>
                  <span className="px px-16 seletor-uf">{c.uf.toUpperCase()}</span>
                </button>
                {eh && c.cidades.length > 1 && (
                  <div className="seletor-cidades" role="group" aria-label={`Cidades em ${c.nome}`}>
                    {c.cidades.map((x) => (
                      <button
                        key={x.slug}
                        type="button"
                        className={`botao ${cidade === x.slug ? 'botao-cheio' : 'botao-contorno'}`}
                        onClick={() => {
                          escolherCidade(x.slug)
                          fechar()
                        }}
                      >
                        {x.nome}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            )
          })}
        </ul>

        <h3 className="seletor-titulo">Outros estados</h3>
        <ul className="seletor-outros">
          {outros.map((u) => (
            <li key={u.sigla}>
              <button type="button" className="seletor-outro toque" onClick={() => escolherUf(u.sigla.toLowerCase())} aria-current={u.sigla.toLowerCase() === uf}>
                <span>{u.nome}</span>
                <span className="legenda">ainda não chegou</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="seletor-privacidade legenda">
          O palpite de estado vem do IP, sem GPS. Serve só pra indicar o atendimento e não fica guardado em servidor da loja.
        </p>
      </div>
    </Folha>
  )
}
