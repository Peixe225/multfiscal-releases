// Clientes: quem tem conta no site (entra com o WhatsApp e o código que o WhatsApp da loja manda). Em cima, se o
// entrar com código está ligado (depende dos Avisos no WhatsApp) com o liga/desliga; depois a busca, o filtro de quem
// aceitou promoções e a lista pra baixar (o Excel abre direto).
import { useEffect, useRef, useState } from 'react'
import * as api from '../api'
import { useDados } from '../dados'
import { plural, relativo, whatsappBonito } from '../formato'
import { Link, Topo } from '../Moldura'
import { caminho, ir } from '../rotas'
import { useRestaurarRolagem, useTitulo } from '../telas/comum'
import { pegarRecado } from '../telas/flash'
import { Aviso, Botao, Carregando, Ic, TituloTela } from '../ui'
import { ajustesClientes, baixarPromocoes, clientes } from './api'
import './estilo'
import type { ClienteLinha, ListaClientes, SituacaoCodigo } from './tipos'

const PASSO = 50

export function Clientes({ promo }: { promo: boolean }) {
  useTitulo('Clientes')
  const [busca, setBusca] = useState('')
  const [termo, setTermo] = useState('')
  const [limite, setLimite] = useState(PASSO)
  useEffect(() => {
    const t = window.setTimeout(() => setTermo(busca.trim()), 300)
    return () => window.clearTimeout(t)
  }, [busca])
  useEffect(() => setLimite(PASSO), [termo, promo])
  const leitura = useDados<ListaClientes>(`clientes:${termo}:${promo}:${limite}`, (s) => clientes({ busca: termo, promo, limite }, s))
  const anterior = useRef<ListaClientes | undefined>(undefined)
  if (leitura.dados) anterior.current = leitura.dados
  const d = leitura.dados ?? anterior.current
  const trocando = !leitura.dados && !!anterior.current
  useRestaurarRolagem(!!d)
  const agora = api.agora()
  const [baixando, setBaixando] = useState(false)
  const [erroBaixar, setErroBaixar] = useState<string | null>(null)
  // o recado de quem apagou uma conta e voltou pra cá
  const [recado] = useState(pegarRecado)

  return (
    <>
      <Topo titulo={<TituloTela>Clientes</TituloTela>} />
      <div className="pn-pagina pn-pagina-estreita">
        {recado && <Aviso tipo="ok">{recado}</Aviso>}
        {d && <Codigo situacao={d.codigo} aoMudar={() => void leitura.recarregar()} />}

        {d && (
          <div className="ct-numeros" role="group" aria-label="Clientes">
            <p>
              <strong className="px">{d.total}</strong> {d.total === 1 ? 'conta' : 'contas'}
            </p>
            <p>
              <strong className="px">{d.comPromo}</strong> {d.comPromo === 1 ? 'aceitou promoções' : 'aceitaram promoções'}
            </p>
          </div>
        )}

        <div className="pn-busca ct-busca">
          <Ic nome="lupa" tamanho={16} />
          <input className="pn-input" type="search" enterKeyHint="search" autoComplete="off" aria-label="Buscar cliente" placeholder="Nome ou WhatsApp" value={busca} maxLength={40} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <div className="pn-filtros" role="group" aria-label="Quais clientes">
          <button type="button" className={`pn-filtro${!promo ? ' on' : ''}`} aria-pressed={!promo} onClick={() => ir(caminho.clientes, true)}>
            Todos
          </button>
          <button type="button" className={`pn-filtro${promo ? ' on' : ''}`} aria-pressed={promo} onClick={() => ir(caminho.clientesPromo, true)}>
            Aceitaram promoções
          </button>
        </div>

        {leitura.erro && (
          <Aviso tipo="erro" acao={<button type="button" className="pn-link-botao" onClick={() => void leitura.recarregar()}>Tentar de novo</button>}>
            {leitura.erro.message}
          </Aviso>
        )}
        {!d && !leitura.erro && <Carregando rotulo="Carregando os clientes…" />}
        {d && (
          <div className={trocando ? 'pd-trocando' : undefined} aria-busy={trocando || undefined}>
            {termo && (
              <p className="pd-achados" role="status">
                {d.clientes.length === 0 ? `Ninguém com “${termo}”.` : `${plural(d.clientes.length, 'cliente', 'clientes')} com “${termo}”.`}
              </p>
            )}
            {d.clientes.length === 0 && !termo && (
              <div className="pd-vazio">
                <Ic nome="clientes" tamanho={48} />
                <p>{promo ? 'Ninguém aceitou receber promoções ainda.' : 'Nenhuma conta ainda. Quem criar conta no site (no Teste minha sorte ou em Minha conta) aparece aqui.'}</p>
              </div>
            )}
            {d.clientes.length > 0 && (
              <ul className="ct-lista">
                {d.clientes.map((c) => (
                  <li key={c.id}>
                    <LinhaCliente c={c} agora={agora} />
                  </li>
                ))}
              </ul>
            )}
            {d.mais && (
              <Botao variante="cinza" largo className="pd-mais" ocupado={trocando} onClick={() => setLimite((n) => Math.min(100, n + PASSO))} disabled={limite >= 100}>
                {limite >= 100 ? 'Busca pelo nome pra achar os mais antigos' : 'Ver mais'}
              </Botao>
            )}
          </div>
        )}

        <section className="pn-bloco ct-promo" aria-labelledby="h-baixar">
          <h2 id="h-baixar" className="pn-h3 pn-h3-colado">
            Lista de promoções
          </h2>
          <p className="pn-dica-bloco">Nome, WhatsApp, estado e quando cada pessoa aceitou receber promoções. Só quem marcou entra. Guarda em lugar seguro: são dados de clientes.</p>
          <Botao
            variante="cinza"
            icone="baixar"
            ocupado={baixando}
            onClick={async () => {
              setBaixando(true)
              setErroBaixar(null)
              try {
                await baixarPromocoes()
              } catch (e) {
                setErroBaixar(api.mensagemDe(e))
              } finally {
                setBaixando(false)
              }
            }}
          >
            Baixar lista (Excel)
          </Botao>
          {erroBaixar && <Aviso tipo="erro">{erroBaixar}</Aviso>}
        </section>
      </div>
    </>
  )
}

function LinhaCliente({ c, agora }: { c: ClienteLinha; agora: number }) {
  return (
    <Link href={caminho.cliente(c.id)} className="ct-linha toque">
      <span className="ct-avatar" aria-hidden="true">
        {c.nome.trim()[0]?.toUpperCase() ?? '?'}
      </span>
      <span className="ct-linha-txt">
        <span className="ct-linha-topo">
          <strong>{c.nome}</strong>
          {c.aceitaPromo && <span className="pd-tag">Promoções</span>}
        </span>
        <span className="ct-linha-meta">
          {whatsappBonito(c.whatsapp)}
          {c.uf ? ` · ${c.uf.toUpperCase()}` : ''}
        </span>
        <span className="ct-linha-meta">
          {plural(c.pedidos, 'pedido', 'pedidos')} · {plural(c.cuponsAtivos, 'cupom ativo', 'cupons ativos')} · conta criada {relativo(c.criadoEm, agora)}
        </span>
      </span>
      <Ic nome="chevron-dir" tamanho={16} />
    </Link>
  )
}

/** Entrar com código pelo WhatsApp: ligado, desligado pelo dono, ou sem os Avisos no WhatsApp configurados. */
function Codigo({ situacao, aoMudar }: { situacao: SituacaoCodigo; aoMudar: () => void }) {
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const trocar = async (ligar: boolean) => {
    setOcupado(true)
    setErro(null)
    try {
      await ajustesClientes(ligar)
      aoMudar()
    } catch (e) {
      setErro(api.mensagemDe(e))
    } finally {
      setOcupado(false)
    }
  }
  if (!situacao.motor) {
    return (
      <Aviso tipo="info" acao={<Link href={caminho.avisos} className="pn-link-botao">Avisos no WhatsApp</Link>}>
        Pra conta do cliente ficar guardada na loja, liga os Avisos no WhatsApp: é por ali que sai o código de entrada. Até lá, a conta de cada cliente fica só no aparelho dele.
      </Aviso>
    )
  }
  return (
    <div className="ct-codigo">
      <label className="pn-troca">
        <input type="checkbox" checked={!situacao.desligadoPeloDono} disabled={ocupado} onChange={(e) => void trocar(e.target.checked)} />
        <span className="pn-troca-marca" aria-hidden="true" />
        <span>
          Clientes entram com o código pelo WhatsApp
          <small className="ct-codigo-sub">{situacao.ligado ? 'O WhatsApp da loja manda um código de 6 números pra quem entra no site.' : 'Desligado: a conta de cada cliente fica só no aparelho dele.'}</small>
        </span>
      </label>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
    </div>
  )
}
