// Clientes: quem tem conta no site (entra com o WhatsApp e o código que o WhatsApp da loja manda). Em cima, se o
// entrar com código está ligado (depende dos Avisos no WhatsApp) com o liga/desliga; depois a busca, o filtro de quem
// aceitou promoções e a lista pra baixar (o Excel abre direto).
import { useEffect, useRef, useState } from 'react'
import * as api from '../api'
import { useDados } from '../dados'
import { hora, plural, relativo, whatsappBonito } from '../formato'
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
      await ajustesClientes({ codigo: ligar })
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
          <small className="ct-codigo-sub">
            {situacao.ligado
              ? 'O WhatsApp da loja manda um código de 6 números pra quem entra no site.'
              : situacao.teto?.pausadoAte && !situacao.desligadoPeloDono
                ? 'Pausado pelo teto de códigos (aqui embaixo): volta sozinho.'
                : 'Desligado: a conta de cada cliente fica só no aparelho dele.'}
          </small>
        </span>
      </label>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {situacao.teto && <Teto teto={situacao.teto} desligado={situacao.desligadoPeloDono} aoMudar={aoMudar} />}
    </div>
  )
}

/**
 * O teto de códigos da loja inteira: protege o WhatsApp da loja (o mesmo dos avisos do grupo) de quem pede código pro
 * número dos outros. Batido, o entrar com código pausa sozinho até liberar.
 */
function Teto({ teto, desligado, aoMudar }: { teto: NonNullable<SituacaoCodigo['teto']>; desligado: boolean; aoMudar: () => void }) {
  const [porHora, setPorHora] = useState(String(teto.hora))
  const [porDia, setPorDia] = useState(String(teto.dia))
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [salvo, setSalvo] = useState(false)
  useEffect(() => {
    setPorHora(String(teto.hora))
    setPorDia(String(teto.dia))
  }, [teto.hora, teto.dia])
  const mudou = porHora !== String(teto.hora) || porDia !== String(teto.dia)
  const salvar = async () => {
    const h = Number(porHora)
    const d = Number(porDia)
    if (!Number.isInteger(h) || h < 1 || h > 1000) return setErro('Por hora: de 1 a 1000 códigos.')
    if (!Number.isInteger(d) || d < 1 || d > 10000) return setErro('Por dia: de 1 a 10000 códigos.')
    if (d < h) return setErro('O teto do dia não pode ser menor que o da hora.')
    setOcupado(true)
    setErro(null)
    try {
      await ajustesClientes({ tetoHora: h, tetoDia: d })
      setSalvo(true)
      aoMudar()
    } catch (e) {
      setErro(api.mensagemDe(e))
    } finally {
      setOcupado(false)
    }
  }
  return (
    <div className="ct-teto">
      {teto.pausadoAte && !desligado && (
        <Aviso tipo="erro">
          Pausado: a loja chegou no teto de códigos ({teto.usadosHora} na última hora, {teto.usadosDia} nas últimas 24 h). Volta sozinho às {hora(teto.pausadoAte)}; até lá, a conta de cada cliente fica no aparelho dele.
        </Aviso>
      )}
      <p className="ct-codigo-sub">
        Teto da loja inteira (protege o WhatsApp da loja de quem pede código pro número dos outros). Saíram {teto.usadosHora} na última hora e {teto.usadosDia} nas últimas 24 h.
      </p>
      <div className="ct-teto-campos">
        <label className="ct-teto-campo">
          <span>Por hora</span>
          <input className="pn-input" type="number" inputMode="numeric" min={1} max={1000} value={porHora} onChange={(e) => (setPorHora(e.target.value), setSalvo(false))} />
        </label>
        <label className="ct-teto-campo">
          <span>Por dia</span>
          <input className="pn-input" type="number" inputMode="numeric" min={1} max={10000} value={porDia} onChange={(e) => (setPorDia(e.target.value), setSalvo(false))} />
        </label>
        <Botao variante="cinza" ocupado={ocupado} disabled={!mudou} onClick={() => void salvar()}>
          Salvar o teto
        </Botao>
      </div>
      {salvo && !mudou && <p className="ct-codigo-sub" role="status">Teto salvo.</p>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
    </div>
  )
}
