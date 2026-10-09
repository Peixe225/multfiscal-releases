import { useEffect, useMemo, type MouseEvent } from 'react'
import { PixelArte } from '../../arte/PixelArte'
import { iconesAbas } from '../../arte/pixel/abas'
import { mercadorGarrafa } from '../../arte/pixel/mercador-garrafa'
import { canais, canalDa } from '../../dados/canais'
import { alvoDeSaida } from '../../lib/ambiente'
import { cliqueDeAba, hrefAba } from '../../lib/abas'
import { brl } from '../../lib/formato'
import { useConta } from '../../lib/conta'
import { linkPerfil, linkWhatsApp, linkWhatsAppLoja, montarRateio, montarRateioSemConexao } from '../../lib/mensagem'
import type { Rateio } from '../../lib/rateio-api'
import { nomeCidade, useLocal } from '../../store/local'
import { atualizarMinhasVagas, temVagaAndando } from '../../lib/minhas-vagas'
import { abertoParaEntrar, agoraRateio, carregarRateios, marcarRateiosVistos, useRateio, valeNoEstado, zapDoDono, type VagaGuardada } from '../../store/rateio'
import { useUI } from '../../store/ui'
import { useLojaMarca } from '../../store/loja'
import { Icone } from '../comum'
import { ArteRateio, CartaoRateio } from './CartaoRateio'
import { NOME_VAGA, ateQuando, faixaDias, janelaChegada, statusVisto, vagaAtiva, vagaDoAparelho, vagasTexto } from './util'
import './estilo'

// O corpo da aba Rateio (o título e o "?" moram no pedaço principal, em Abas.tsx): Minhas vagas (só com vaga neste
// aparelho), Abertos, Em andamento e Chegaram. Com a aba à vista e a página em primeiro plano, a lista se atualiza a
// cada minuto (o contador sobe sozinho quando a loja confirma um pagamento) e as vagas a cada 3 min, só se alguma ainda
// pode mudar (o servidor limita o minhas-vagas por IP; ver lib/minhas-vagas.ts).

const MINUTO = 60_000
/** As vagas a cada quantos minutos da lista. */
const VAGAS_A_CADA = 3

/** Link da página de um rateio (Ctrl/⌘/botão do meio abre numa aba nova; o toque simples abre a camada). */
export function hrefRateio(id: string): string {
  const base = hrefAba('rateio')
  return `${base}${base.includes('?') ? '&' : '?'}rateio=${encodeURIComponent(id)}`
}

function abrirPagina(e: MouseEvent<HTMLElement>, id: string) {
  if (!cliqueDeAba(e)) return
  useUI.getState().abrirRateio(id)
}

/** Atualiza lista e vagas enquanto a aba está à vista e a página em primeiro plano. */
function useAtualizarNaAba(ativa: boolean) {
  useEffect(() => {
    if (!ativa) return
    let t = 0
    let tique = 0
    const rodar = () => {
      if (document.visibilityState !== 'visible') return
      void carregarRateios(true)
      tique++
      if (tique % VAGAS_A_CADA === 0 && temVagaAndando()) void atualizarMinhasVagas()
    }
    // voltou pro primeiro plano: a lista e, se alguma vaga ainda anda, as vagas (no máximo 1 vez por minuto)
    const aoVoltar = () => {
      void carregarRateios(true)
      if (temVagaAndando()) void atualizarMinhasVagas()
    }
    const ligar = () => {
      clearInterval(t)
      if (document.visibilityState === 'visible') t = window.setInterval(rodar, MINUTO)
    }
    // ao abrir: a lista só se tiver mais de 1 min (a barra já buscou no tempo ocioso); as vagas, se alguma ainda anda
    // (no máximo 1 vez por minuto, mesmo abrindo e fechando a aba)
    void carregarRateios()
    if (temVagaAndando()) void atualizarMinhasVagas()
    ligar()
    const voltou = () => {
      if (document.visibilityState === 'visible') aoVoltar()
      ligar()
    }
    document.addEventListener('visibilitychange', voltou)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', voltou)
    }
  }, [ativa])
}

export function VistaRateio() {
  const ativa = useUI((s) => s.aba === 'rateio')
  const uf = useLocal((s) => s.uf)
  // os estados e os produtos vêm da loja (canalDa e o catálogo, lidos na hora): redesenha quando ela troca
  useLojaMarca()
  const rateios = useRateio((s) => s.rateios)
  const fonte = useRateio((s) => s.fonte)
  const vagas = useRateio((s) => s.vagas)
  const conta = useConta()
  const dono = zapDoDono(vagas, conta?.whatsapp)
  useAtualizarNaAba(ativa)

  const grupos = useMemo(() => {
    const minhas = new Set(vagas.map((v) => v.rateio))
    const relevante = (r: Rateio) => valeNoEstado(r, uf) || minhas.has(r.id)
    const abertos = rateios.filter((r) => r.status === 'aberto')
    return {
      // os que valem no estado primeiro (na ordem do servidor); os de outro estado por último, apagados
      abertos: [...abertos.filter((r) => valeNoEstado(r, uf)), ...abertos.filter((r) => !valeNoEstado(r, uf))],
      andamento: rateios.filter((r) => ['fechado', 'pedido', 'caminho', 'chegou'].includes(r.status) && relevante(r)),
      chegaram: rateios.filter((r) => r.status === 'encerrado' && relevante(r)),
    }
  }, [rateios, vagas, uf])

  // os abertos vistos na aba: o selo "novo" do destaque do Início some
  useEffect(() => {
    if (ativa) marcarRateiosVistos(rateios.filter((r) => abertoParaEntrar(r, uf)).map((r) => r.id))
  }, [ativa, rateios, uf])

  const nada = !grupos.abertos.length && !grupos.andamento.length && !grupos.chegaram.length
  return (
    <div className="rv">
      {vagas.length > 0 && <MinhasVagas vagas={vagas} rateios={rateios} />}
      {fonte === 'carregando' || fonte === 'nada' ? (
        <p className="rv-buscando legenda" role="status">
          Buscando os rateios…
        </p>
      ) : fonte === 'fora-do-ar' && nada ? (
        <SemConexao />
      ) : nada ? (
        <Vazio />
      ) : (
        <>
          {grupos.abertos.length > 0 && (
            <section className="rv-secao" aria-labelledby="rv-abertos">
              <h2 id="rv-abertos" className="rv-titulo">
                {/* o número é de quantos dá pra entrar agora (o mesmo do selo da barra), não de quantos estão abertos */}
                Abertos <span className="rv-conta">{grupos.abertos.filter((r) => abertoParaEntrar(r, uf)).length || ''}</span>
              </h2>
              {!grupos.abertos.some((r) => valeNoEstado(r, uf)) && <p className="rv-nota legenda">Nenhum aberto pro teu estado agora.</p>}
              <ul className="rv-grade">
                {grupos.abertos.map((r, i) => (
                  <li key={r.id}>
                    <CartaoRateio rateio={r} uf={uf} hrefEntrar={hrefRateio(r.id)} aoEntrar={(e) => abrirPagina(e, r.id)} codigo={codigoAtivo(vagas, r.id, dono)} prioridade={i === 0} />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {!grupos.abertos.length && <Vazio curto />}
          {grupos.andamento.length > 0 && (
            <section className="rv-secao" aria-labelledby="rv-andamento">
              <h2 id="rv-andamento" className="rv-titulo">
                Em andamento
              </h2>
              <ul className="rv-grade">
                {grupos.andamento.map((r) => (
                  <li key={r.id}>
                    <CartaoRateio rateio={r} uf={uf} />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {grupos.chegaram.length > 0 && (
            <section className="rv-secao" aria-labelledby="rv-chegaram">
              <h2 id="rv-chegaram" className="rv-titulo">
                Chegaram
              </h2>
              <ul className="rv-chegaram">
                {grupos.chegaram.map((r) => (
                  <li key={r.id} className="rv-chegou">
                    <span className="rv-mini" aria-hidden="true">
                      <ArteRateio rateio={r} largura={48} />
                    </span>
                    <span className="rv-chegou-txt">
                      <strong>{r.titulo}</strong>
                      <span className="legenda">
                        {r.vagas} vagas a {brl(r.precoRateio)}
                        {r.chegouEm ? ` · chegou dia ${new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }).format(Date.parse(r.chegouEm))}` : ''}
                      </span>
                    </span>
                    <span className="rv-selo-p px">ENTREGUE</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}

/** Código da vaga ativa deste aparelho num rateio (reservada no prazo ou confirmada; a do dono antes da de um amigo). */
function codigoAtivo(vagas: VagaGuardada[], id: string, dono: string | null): string | null {
  return vagaDoAparelho(vagas, id, agoraRateio(), dono)?.codigo ?? null
}

/**
 * O servidor da loja existe e não respondeu (lento, fora do ar, ~4 s sem resposta): diz isso, deixa tentar de novo e
 * abre o caminho pelo WhatsApp (a loja passa os rateios abertos). Nunca os rateios de exemplo no lugar dos de verdade,
 * nem formulário pra rateio que não dá pra conferir.
 */
function SemConexao() {
  const buscando = useRateio((s) => s.buscandoLista)
  const { uf, cidade, cidadeInformada } = useLocal()
  const canal = canalDa(uf)
  const texto = montarRateioSemConexao(canal, nomeCidade(canal, cidade, cidadeInformada))
  const tentar = () => {
    if (!buscando) void carregarRateios(true)
  }
  return (
    <section className="rv-vazio rv-vazio-curto rv-sem-conexao" aria-labelledby="rv-sem-t">
      <h2 id="rv-sem-t" className="rv-vazio-titulo">
        Sem conexão com a loja agora
      </h2>
      <p className="legenda" role="status">
        {buscando ? 'Tentando falar com a loja…' : 'Os rateios aparecem aqui assim que a conexão voltar.'}
      </p>
      <p className="legenda">Quer entrar num rateio agora? Chama a loja no WhatsApp, que ela te passa os abertos.</p>
      <div className="rv-sem-acoes">
        <a className="botao botao-cheio toque rv-sem-zap" href={linkWhatsAppLoja(canal, texto)} target={alvoDeSaida()} rel="noopener noreferrer">
          <Icone nome="whatsapp" tamanho={16} />
          Entrar pelo WhatsApp
        </a>
        <button type="button" className="botao botao-contorno toque" onClick={tentar} aria-disabled={buscando || undefined}>
          Tentar de novo
        </button>
      </div>
    </section>
  )
}

/** Nenhum rateio aberto: honesto, com o mercador e o Instagram do estado. */
function Vazio({ curto = false }: { curto?: boolean }) {
  const uf = useLocal((s) => s.uf)
  const canal = canalDa(uf) ?? canais[0]
  return (
    <section className={`rv-vazio${curto ? ' rv-vazio-curto' : ''}`} aria-labelledby="rv-vazio-t">
      {!curto && (
        <span className="rv-vazio-arte" aria-hidden="true">
          <PixelArte grade={mercadorGarrafa} tamanho={132} ancora="base" />
        </span>
      )}
      <h2 id="rv-vazio-t" className="rv-vazio-titulo">
        Nenhum rateio aberto agora
      </h2>
      <p className="legenda">Quando a loja abrir o próximo, ele aparece aqui e nos stories.</p>
      <a className="botao botao-contorno toque rv-vazio-ig" href={linkPerfil(canal.instagram)} target="_blank" rel="noopener noreferrer">
        <Icone nome="instagram" tamanho={16} />
        Fica de olho no @{canal.instagram}
      </a>
    </section>
  )
}

/** Minhas vagas: o que este aparelho reservou, com o status que o servidor devolve. */
function MinhasVagas({ vagas, rateios }: { vagas: VagaGuardada[]; rateios: Rateio[] }) {
  const agora = agoraRateio()
  // as que ainda andam primeiro, depois as mais novas
  const lista = [...vagas].sort((a, b) => Number(vagaAtiva(b, agora)) - Number(vagaAtiva(a, agora)) || Date.parse(b.criadoEm) - Date.parse(a.criadoEm))
  return (
    <section className="rv-secao rv-minhas" id="minhas-vagas" aria-labelledby="rv-minhas" tabIndex={-1}>
      <h2 id="rv-minhas" className="rv-titulo">
        Minhas vagas
      </h2>
      <ul className="mv-lista">
        {lista.map((v) => (
          <LinhaVaga key={v.codigo} vaga={v} rateio={rateios.find((r) => r.id === v.rateio)} agora={agora} />
        ))}
      </ul>
    </section>
  )
}

/** O que a pessoa lê sobre o andamento do rateio, quando a vaga está paga. */
function andamento(v: VagaGuardada, r: Rateio | undefined): string | null {
  switch (v.rateioStatus) {
    case 'aberto':
      return v.status === 'confirmado' ? 'Paga. Quando o rateio fechar, a loja faz o pedido.' : null
    case 'fechado':
      return 'O rateio fechou. Agora a loja faz o pedido.'
    case 'pedido':
      return `Pedido feito. Previsão de chegada: ${r ? (janelaChegada(r) ?? `${faixaDias(r)} depois que fechou`) : 'alguns dias depois que fechou'}.`
    case 'caminho':
      return 'A caminho.'
    case 'chegou':
      return 'Chegou! A loja te chama pra entregar.'
    case 'cancelado':
      return 'O rateio foi cancelado. A loja te chama no WhatsApp pra combinar.'
    default:
      return null
  }
}

function LinhaVaga({ vaga: v, rateio, agora }: { vaga: VagaGuardada; rateio: Rateio | undefined; agora: number }) {
  const status = statusVisto(v, agora)
  const canal = canalDa(v.uf)
  const reservada = status === 'reservado'
  const varias = v.quantidade > 1
  const linha =
    status === 'reservado'
      ? v.expiraEm
        ? `${varias ? 'guardadas' : 'guardada'} até ${ateQuando(v.expiraEm, agora)}`
        : 'esperando a loja'
      : status === 'confirmado'
        ? null
        : status === 'expirado'
          ? varias
            ? 'as vagas voltaram'
            : 'a vaga voltou'
          : null
  const mais = status === 'confirmado' || status === 'entregue' ? andamento(v, rateio) : v.rateioStatus === 'cancelado' ? andamento(v, rateio) : null
  const msg = canal
    ? montarRateio({ canal, cidade: v.cidade, titulo: v.titulo, quantidade: v.quantidade, precoRateio: v.precoRateio, total: v.total, codigo: v.codigo, nome: v.nome, whatsapp: v.whatsapp })
    : null
  return (
    <li className="mv">
      <span className="mv-arte" aria-hidden="true">
        {rateio ? <ArteRateio rateio={rateio} largura={48} /> : <PixelArte grade={iconesAbas.caixa} tamanho={32} />}
      </span>
      <div className="mv-txt">
        <p className="mv-titulo">{v.titulo}</p>
        <p className="mv-dados">
          <span className="px mv-codigo">{v.codigo}</span> · {vagasTexto(v.quantidade)} · {brl(v.total)}
          {/* a vaga feita pelo "Entrar com outro WhatsApp": de quem é */}
          {v.paraOutro && ` · de ${v.nome}`}
        </p>
        <p className={`mv-status mv-${status}`}>
          <i className="mv-ponto" aria-hidden="true" />
          <strong>{NOME_VAGA[status]}</strong>
          {status === 'confirmado' && ' ✅'}
          {linha && <span className="mv-linha">{status === 'expirado' ? ' — ' : ' · '}{linha}</span>}
        </p>
        {mais && <p className="mv-mais">{mais}</p>}
        {status === 'expirado' && rateio && abertoParaEntrar(rateio, null) && (
          <a className="mv-de-novo toque" href={hrefRateio(rateio.id)} onClick={(e) => abrirPagina(e, rateio.id)}>
            Entrar de novo
          </a>
        )}
      </div>
      {reservada && msg && canal && (
        <a className="botao botao-cheio mv-zap" href={linkWhatsApp(canal, msg)} target={alvoDeSaida()} rel="noopener noreferrer">
          <Icone nome="whatsapp" tamanho={16} />
          Pagar no WhatsApp
        </a>
      )}
    </li>
  )
}
