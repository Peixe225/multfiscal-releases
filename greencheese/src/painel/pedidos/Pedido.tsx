// O pedido por dentro: o status em passos (novo → confirmado → saiu pra entrega → entregue, ou cancelado), com o
// próximo passo num botão e a mensagem pronta pro cliente em cada um; quem pediu, os itens (ou a encomenda), a
// entrega e o pagamento, a mensagem que foi pro WhatsApp, a anotação da loja, o aviso no grupo e o apagar dos dados.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import * as api from '../api'
import { Confirmar, type PedidoConfirmacao } from '../Confirmar'
import { useAcao, useDados } from '../dados'
import { brl, dia, diaMes, hora, quando, whatsappBonito } from '../formato'
import { linkWhats } from '../mensagens'
import { Link, Topo } from '../Moldura'
import { usePode } from '../permissoes'
import { caminho } from '../rotas'
import { useRestaurarRolagem, useTitulo } from '../telas/comum'
import { Aviso, Botao, Campo, Carregando, Ic, Linha, TituloTela } from '../ui'
import { celularNoCampo, conferirCelular, mascaraCelular } from '../whats'
import { apagarDadosPedido, pedido as lerPedido, reenviarAviso, salvarPedido, statusPedido } from './api'
import { BotaoCopiar, ListaAvisos, SeloPedido, nomeStatus } from './comum'
import './estilo'
import { mensagemDoPasso, ROTULO_AVISO } from './mensagens'
import type { EnvioAviso, PedidoAdmin, PedidoLinha, StatusPedido } from './tipos'

interface Dados {
  agora: string
  pedido: PedidoAdmin
  mesmoCodigo: PedidoLinha[]
  avisos: EnvioAviso[]
}

const ORDEM: StatusPedido[] = ['novo', 'confirmado', 'saiu', 'entregue']
const DATA: Record<StatusPedido, (p: PedidoAdmin) => string | null> = {
  novo: (p) => p.criadoEm,
  confirmado: (p) => p.confirmadoEm,
  saiu: (p) => p.saiuEm,
  entregue: (p) => p.entregueEm,
  cancelado: (p) => p.canceladoEm,
}
const NOME_PAGAMENTO = { pix: 'Pix', dinheiro: 'Dinheiro', cartao: 'Cartão na entrega' } as const

/** "18h30" (hoje) · "08/10" */
function curto(iso: string, agora: number): string {
  return dia(iso, agora) === 'hoje' ? hora(iso) : diaMes(iso)
}

function Passos({ p, agora }: { p: PedidoAdmin; agora: number }) {
  const cancelado = p.status === 'cancelado'
  const atual = ORDEM.indexOf(p.status)
  return (
    <ol className={`pn-tempo pd-tempo${cancelado ? ' pn-tempo-cancelado' : ''}`} aria-label={`Passos ${p.tipo === 'encomenda' ? 'da encomenda' : 'do pedido'}`}>
      {ORDEM.map((s, i) => {
        const d = DATA[s](p)
        const feito = cancelado ? !!d : i <= atual
        const aqui = i === atual
        return (
          <li key={s} className={`${feito ? 'feito' : ''}${aqui ? ' atual' : ''}`} aria-current={aqui ? 'step' : undefined}>
            <span className="pn-tempo-ponto" aria-hidden="true" />
            <span className="pn-tempo-nome">{s === 'novo' ? (p.tipo === 'encomenda' ? 'Recebida' : 'Recebido') : nomeStatus(s, p.tipo)}</span>
            <span className="pn-tempo-dia">{d && feito ? curto(d, agora) : ' '}</span>
            {!feito && <span className="sr-only"> (ainda não)</span>}
          </li>
        )
      })}
    </ol>
  )
}

function textoDoMomento(p: PedidoAdmin, agora: number): string {
  const enc = p.tipo === 'encomenda'
  const em = (iso: string | null) => (iso ? ` ${quando(iso, agora)}` : '')
  switch (p.status) {
    case 'novo':
      return enc
        ? 'Encomenda nova. Vê se dá pra trazer, responde no WhatsApp (a conversa tem o código) e confirma aqui.'
        : 'Pedido novo. Responde no WhatsApp da loja (a conversa tem o código) e confirma aqui quando fechar.'
    case 'confirmado':
      return enc ? 'Confirmada. Quando chegar e sair pra entrega, marca aqui.' : 'Confirmado. Quando sair pra entrega, marca aqui.'
    case 'saiu':
      return `Saiu pra entrega${em(p.saiuEm)}. Marca entregue quando chegar.`
    case 'entregue':
      return `Entregue${em(p.entregueEm)}.`
    case 'cancelado':
      return `Cancelad${enc ? 'a' : 'o'}${em(p.canceladoEm)}.${p.proximos.includes('novo') ? ' Se foi engano, dá pra reabrir.' : ''}`
  }
}

function botaoDoPasso(para: StatusPedido, enc: boolean): string {
  if (para === 'confirmado') return enc ? 'Confirmar encomenda' : 'Confirmar pedido'
  if (para === 'saiu') return 'Saiu pra entrega'
  return 'Marcar entregue'
}

/** "Rua X, 120 — Centro · CEP 39800-000 · Teófilo Otoni/MG" (sem CEP: o que a pessoa digitou). */
function enderecoTexto(e: PedidoAdmin['entrega']): string {
  if (e.rua) {
    let s = e.rua + (e.numero ? `, ${e.numero}` : '') + (e.bairro ? ` — ${e.bairro}` : '')
    if (/^\d{8}$/.test(e.cep)) s += ` · CEP ${e.cep.slice(0, 5)}-${e.cep.slice(5)}`
    if (e.cidade) s += ` · ${e.cidade}${e.uf ? `/${e.uf.toUpperCase()}` : ''}`
    return s
  }
  return e.endereco
}

function pagamentoTexto(p: PedidoAdmin): string {
  if (!p.pagamento) return 'a combinar'
  if (p.pagamento === 'dinheiro') return `Dinheiro (${p.troco != null ? `troco pra ${brl(p.troco)}` : 'sem troco'})`
  return NOME_PAGAMENTO[p.pagamento]
}

/** Linha de valor comprido (endereço, observação): o rótulo em cima e o texto embaixo, alinhado à esquerda. */
function LinhaLonga({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="pn-linha pd-linha-longa">
      <dt>{rotulo}</dt>
      <dd>{children}</dd>
    </div>
  )
}

/** O link que o cliente mandou na encomenda: clicável só se for http(s) de verdade (e sem passar quem abriu). */
function Referencia({ texto }: { texto: string }) {
  let url: URL | null = null
  try {
    url = /^https?:\/\/\S+$/i.test(texto.trim()) ? new URL(texto.trim()) : null
  } catch {
    url = null
  }
  if (!url || !/^https?:$/.test(url.protocol)) return <span className="pd-quebra">{texto}</span>
  return (
    <a className="pd-ligado pd-quebra" href={url.href} target="_blank" rel="noopener noreferrer nofollow">
      {url.hostname.replace(/^www\./, '')}
      <span className="sr-only"> (abre o link que o cliente mandou)</span>
    </a>
  )
}

function EditarWhats({ p, aoSalvar }: { p: PedidoAdmin; aoSalvar: (p: PedidoAdmin) => void }) {
  const [aberto, setAberto] = useState(false)
  const [valor, setValor] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const acao = useAcao()
  const campo = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (aberto) campo.current?.focus()
  }, [aberto])
  if (!aberto) {
    return (
      <Botao
        variante="texto"
        icone={p.whatsapp ? 'editar' : 'mais'}
        className="pn-botao-p pd-editar-whats"
        onClick={() => {
          setValor(p.whatsapp ? celularNoCampo(p.whatsapp) : '')
          setErro(null)
          acao.setErro(null)
          setAberto(true)
        }}
      >
        {p.whatsapp ? (
          'Trocar o WhatsApp'
        ) : (
          <>
            Guardar o WhatsApp<span className="sr-only"> de quem pediu</span>
          </>
        )}
      </Botao>
    )
  }
  const salvar = async (e: FormEvent) => {
    e.preventDefault()
    const problema = valor.trim() ? conferirCelular(valor) : null
    if (problema) {
      setErro(problema)
      campo.current?.focus()
      return
    }
    const r = await acao.rodar('whats', () => salvarPedido({ id: p.id, whatsapp: valor.trim() ? valor : '' }))
    if (r) {
      aoSalvar(r.pedido)
      setAberto(false)
    }
  }
  const doServidor = acao.erro?.campo === 'whatsapp' ? acao.erro.message : null
  return (
    <form className="pn-form pd-form" onSubmit={salvar} noValidate>
      <Campo id="pd-whats" rotulo="WhatsApp de quem pediu" erro={erro ?? doServidor} dica="Tá na conversa do pedido, no WhatsApp da loja. DDD + número. Em branco tira.">
        {(a) => (
          <input
            {...a}
            ref={campo}
            name="whatsapp"
            className="pn-input"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            value={valor}
            onChange={(e) => {
              setValor(mascaraCelular(e.target.value))
              setErro(null)
            }}
          />
        )}
      </Campo>
      {acao.erro && !doServidor && <Aviso tipo="erro">{acao.erro.message}</Aviso>}
      <div className="pd-acoes-linha">
        <Botao type="submit" ocupado={acao.ocupado === 'whats'}>
          Salvar
        </Botao>
        <Botao variante="texto" onClick={() => setAberto(false)} disabled={acao.ocupado === 'whats'}>
          Cancelar
        </Botao>
      </div>
    </form>
  )
}

function Nota({ p, aoSalvar }: { p: PedidoAdmin; aoSalvar: (p: PedidoAdmin) => void }) {
  // o texto é desta tela: a atualização de 30 s não apaga o que o dono tá digitando
  const [texto, setTexto] = useState(p.nota)
  const [salvo, setSalvo] = useState(false)
  const acao = useAcao()
  const mudou = texto.trim() !== p.nota
  const salvar = async () => {
    const r = await acao.rodar('nota', () => salvarPedido({ id: p.id, nota: texto.trim() }))
    if (r) {
      aoSalvar(r.pedido)
      setTexto(r.pedido.nota)
      setSalvo(true)
    }
  }
  const erro = acao.erro?.campo === 'nota' ? acao.erro.message : null
  return (
    <div className="pn-form">
      <div className="pn-h2-linha pd-nota-cab">
        <h2 id="h-nota" className="pn-h2">
          Anotação da loja
        </h2>
        <span className="pn-contagem" aria-hidden="true">
          {texto.length}/500
        </span>
      </div>
      <div className={`pn-campo${erro ? ' pn-campo-erro' : ''}`}>
        <textarea
          id="pd-nota"
          name="nota"
          className="pn-input pn-texto"
          aria-labelledby="h-nota"
          aria-describedby={erro ? 'pd-nota-erro' : 'pd-nota-dica'}
          aria-invalid={erro ? true : undefined}
          rows={3}
          maxLength={500}
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value)
            setSalvo(false)
          }}
        />
        {erro ? (
          <p id="pd-nota-erro" className="pn-erro">
            <Ic nome="atencao" tamanho={16} />
            <span>{erro}</span>
          </p>
        ) : (
          <p id="pd-nota-dica" className="pn-dica">
            Só aparece aqui no painel (até 500 letras). Ex.: tocar a campainha do fundo.
          </p>
        )}
      </div>
      {acao.erro && acao.erro.campo !== 'nota' && <Aviso tipo="erro">{acao.erro.message}</Aviso>}
      <div className="pd-acoes-linha">
        <Botao variante="cinza" ocupado={acao.ocupado === 'nota'} disabled={!mudou && acao.ocupado !== 'nota'} onClick={() => void salvar()}>
          Salvar a anotação
        </Botao>
        <span className="pd-salvo" role="status">
          {salvo && !mudou ? 'Anotação salva.' : ''}
        </span>
      </div>
    </div>
  )
}

export function Pedido({ id }: { id: number }) {
  const leitura = useDados<Dados>(`pedido:${id}`, (s) => lerPedido(id, s))
  const acao = useAcao()
  const acaoAviso = useAcao()
  // apagar os dados (LGPD) é com gerente e dono; os avisos no grupo, só com o dono
  const apagaDados = usePode('pedidos-dados')
  const veAvisos = usePode('avisos')
  const [confirmacao, setConfirmacao] = useState<PedidoConfirmacao | null>(null)
  const [anuncio, setAnuncio] = useState('')
  // logo depois de um passo, o botão do próximo espera um instante (o toque duplo não pula dois passos)
  const [esfriando, setEsfriando] = useState(false)
  const relogio = useRef(0)
  useEffect(() => () => window.clearTimeout(relogio.current), [])
  const d = leitura.dados
  const enc = d?.pedido.tipo === 'encomenda'
  useTitulo(d ? `${enc ? 'Encomenda' : 'Pedido'} ${d.pedido.codigo}` : 'Pedido')
  useRestaurarRolagem(!!d)

  if (leitura.erro && !d) {
    const sumiu = leitura.erro.codigo === 'nao-encontrado'
    return (
      <>
        <Topo voltar={caminho.pedidos} titulo={<TituloTela>Pedido</TituloTela>} />
        <div className="pn-pagina">
          <Aviso
            tipo="erro"
            acao={
              sumiu ? (
                <Link className="pn-link" href={caminho.pedidos}>
                  Ver os pedidos
                </Link>
              ) : (
                <button type="button" className="pn-link-botao" onClick={() => void leitura.recarregar()}>
                  Tentar de novo
                </button>
              )
            }
          >
            {sumiu ? 'Esse pedido não existe.' : leitura.erro.message}
          </Aviso>
        </div>
      </>
    )
  }
  if (!d) {
    return (
      <>
        <Topo voltar={caminho.pedidos} titulo={<TituloTela>Pedido</TituloTela>} />
        <Carregando rotulo="Carregando o pedido…" />
      </>
    )
  }

  const p = d.pedido
  const agora = api.agora()
  const trocar = (novo: PedidoAdmin) => leitura.trocar((x) => ({ ...x, pedido: novo }))
  const atual = ORDEM.indexOf(p.status)
  const proximo = atual >= 0 && atual < ORDEM.length - 1 && p.proximos.includes(ORDEM[atual + 1]) ? ORDEM[atual + 1] : null
  const anterior = atual > 0 && p.proximos.includes(ORDEM[atual - 1]) ? ORDEM[atual - 1] : null
  const podeCancelar = p.proximos.includes('cancelado')
  const podeReabrir = p.status === 'cancelado' && p.proximos.includes('novo')
  const podeApagar = apagaDados && (p.status === 'entregue' || p.status === 'cancelado') && !p.dadosApagados
  const oPedido = enc ? 'a encomenda' : 'o pedido'
  const msg = mensagemDoPasso(p)

  const anunciar = (para: StatusPedido) => setAnuncio(`${enc ? 'Encomenda' : 'Pedido'} ${p.codigo}: ${nomeStatus(para, p.tipo).toLowerCase()}. A mensagem pro cliente tá logo abaixo.`)

  const avancar = (para: StatusPedido) =>
    void acao.rodar('status', async () => {
      const r = await statusPedido(p.id, para)
      trocar(r.pedido)
      anunciar(para)
      setEsfriando(true)
      window.clearTimeout(relogio.current)
      relogio.current = window.setTimeout(() => setEsfriando(false), 1200)
    })

  const mudarCom = (c: Omit<PedidoConfirmacao, 'acao'>, para: StatusPedido) =>
    setConfirmacao({
      ...c,
      acao: async () => {
        const r = await statusPedido(p.id, para)
        trocar(r.pedido)
        anunciar(para)
      },
    })

  const pedirCancelar = () =>
    mudarCom(
      {
        titulo: enc ? 'Cancelar a encomenda?' : 'Cancelar o pedido?',
        texto: <p>Sai da lista “Em aberto”. Quem pediu não é avisado sozinho: depois aparece a mensagem pronta pra tu mandar.</p>,
        botao: enc ? 'Cancelar a encomenda' : 'Cancelar o pedido',
        perigo: true,
      },
      'cancelado',
    )

  const pedirVoltar = (para: StatusPedido) =>
    mudarCom(
      {
        titulo: p.status === 'entregue' ? 'Desfazer a entrega?' : `Voltar pra ${nomeStatus(para, p.tipo).toLowerCase()}?`,
        texto: <p>Use se tocou no passo errado. A data do passo desfeito sai.</p>,
        botao: p.status === 'entregue' ? 'Desfazer a entrega' : 'Voltar',
      },
      para,
    )

  const pedirReabrir = () =>
    mudarCom(
      {
        titulo: enc ? 'Reabrir a encomenda?' : 'Reabrir o pedido?',
        texto: <p>Volta pra {enc ? 'nova' : 'novo'} e recomeça os passos.</p>,
        botao: 'Reabrir',
      },
      'novo',
    )

  const pedirApagar = () =>
    setConfirmacao({
      titulo: 'Apagar os dados?',
      texto: (
        <p>
          Nome, WhatsApp, endereço, observação, anotação e a mensagem {enc ? 'dessa encomenda' : 'desse pedido'} somem pra sempre (é o pedido de exclusão da LGPD), junto com o
          texto do aviso no grupo. Itens, valores e datas ficam nas contas da loja.
        </p>
      ),
      botao: 'Apagar os dados',
      perigo: true,
      acao: async () => {
        const r = await apagarDadosPedido(p.id)
        leitura.trocar((x) => ({ ...x, pedido: r.pedido }))
        void leitura.recarregar()
      },
    })

  const reenviar = (e: EnvioAviso) =>
    void acaoAviso.rodar(`aviso-${e.id}`, async () => {
      const r = await reenviarAviso(e.id)
      leitura.trocar((x) => ({ ...x, avisos: x.avisos.map((a) => (a.id === r.envio.id ? r.envio : a)) }))
    })
  const avisoOcupado = acaoAviso.ocupado ? Number(acaoAviso.ocupado.slice(6)) : null

  const de = p.cidade ? `${p.cidade} (${p.uf.toUpperCase()})` : p.uf.toUpperCase()
  const endereco = enderecoTexto(p.entrega)

  return (
    <>
      <Topo voltar={caminho.pedidos} titulo={<TituloTela>{`${enc ? 'Encomenda' : 'Pedido'} ${p.codigo}`}</TituloTela>} />
      <div className="pn-pagina pd-detalhe">
        {leitura.erro && <Aviso tipo="erro">{leitura.erro.message}</Aviso>}
        <span className="sr-only" role="status">
          {anuncio}
        </span>

        <div className="pd-col-esq">
          <div className="pd-cab">
            <p className="pd-cab-nome">{p.nome}</p>
            <div className="pd-cab-linha">
              <SeloPedido status={p.status} tipo={p.tipo} />
              {enc && <span className="pd-tag">Encomenda</span>}
              <span className="pn-codigo">{p.codigo}</span>
            </div>
            <p className="pd-cab-sub">
              {de} · chegou {quando(p.criadoEm, agora)}
            </p>
          </div>

          {p.substituidoPor && (
            <Aviso
              tipo="info"
              className="pd-recado"
              acao={
                <Link className="pn-link" href={caminho.pedido(p.substituidoPor.id)}>
                  Abrir o {p.substituidoPor.codigo}
                </Link>
              }
            >
              O cliente mudou {oPedido} depois de mandar: vale o {p.substituidoPor.codigo}. Esse fica só de registro.
            </Aviso>
          )}
          {p.substitui && (
            <p className="pn-nota">
              Veio do mesmo aparelho depois do{' '}
              <Link className="pd-ligado" href={caminho.pedido(p.substitui.id)}>
                {p.substitui.codigo}
              </Link>{' '}
              (o cliente mudou e mandou de novo). Confere o de antes.
            </p>
          )}
          {d.mesmoCodigo.length > 0 && (
            <Aviso tipo="info" className="pd-recado">
              Tem outro pedido com o código {p.codigo}, de outro aparelho:{' '}
              {d.mesmoCodigo.map((o, i) => (
                <span key={o.id}>
                  {i > 0 && ', '}
                  <Link className="pd-ligado" href={caminho.pedido(o.id)}>
                    {o.nome}
                  </Link>
                </span>
              ))}
              . Confere o nome na conversa antes de responder.
            </Aviso>
          )}
          {p.dadosApagados && (
            <Aviso tipo="info" className="pd-recado">
              Os dados de quem pediu foram apagados (LGPD). Ficaram os itens, os valores e as datas.
            </Aviso>
          )}

          <section className="pn-bloco pd-status-bloco" aria-labelledby="h-status">
            <h2 id="h-status" className="pn-h2">
              Status: {nomeStatus(p.status, p.tipo).toLowerCase()}
            </h2>
            <Passos p={p} agora={agora} />
            <p className="pn-passo-txt">{textoDoMomento(p, agora)}</p>
            {acao.erro && !acao.ocupado && (
              <Aviso tipo="erro" acao={<button type="button" className="pn-link-botao" onClick={() => void leitura.recarregar()}>Atualizar</button>}>
                {acao.erro.message}
              </Aviso>
            )}
            {(proximo || podeReabrir) && (
              <div className="pd-acoes">
                {proximo && (
                  <Botao largo ocupado={acao.ocupado === 'status' || esfriando} onClick={() => avancar(proximo)}>
                    {botaoDoPasso(proximo, enc)}
                  </Botao>
                )}
                {podeReabrir && (
                  <Botao largo variante="cinza" onClick={pedirReabrir}>
                    Reabrir
                  </Botao>
                )}
              </div>
            )}

            {!p.dadosApagados && !p.substituidoPor && (
              <div className="pd-zap">
                <p className="pd-zap-rot">Mensagem pronta pra quem pediu</p>
                <p className="pd-zap-msg">
                  {/* o código não quebra no meio ("GC-" numa linha, o resto na outra) */}
                  {msg.split(/(GC-[A-Z0-9]{5})/).map((t, i) =>
                    i % 2 ? (
                      <span key={i} className="pd-sem-quebra">
                        {t}
                      </span>
                    ) : (
                      t
                    ),
                  )}
                </p>
                <div className="pd-acoes-linha">
                  <a className="pn-botao pn-botao-contorno" href={p.whatsapp ? linkWhats(p.whatsapp, msg) : `https://wa.me/?text=${encodeURIComponent(msg)}`} target="_blank" rel="noopener noreferrer">
                    <Ic nome="whatsapp" tamanho={16} />
                    <span className="pn-botao-txt">{p.whatsapp ? ROTULO_AVISO[p.status] : 'Abrir no WhatsApp'}</span>
                    <span className="sr-only">{p.whatsapp ? ` (abre a conversa com ${p.nome})` : ' (tu escolhe a conversa)'}</span>
                  </a>
                  <BotaoCopiar texto={msg} variante="texto" className="pd-copiar" />
                </div>
                {!p.whatsapp && <p className="pn-dica-bloco pd-zap-dica">O site não sabia o WhatsApp de quem pediu: escolhe a conversa do pedido (ela tem o código {p.codigo}). Guardando o número em “Quem pediu”, o botão já abre direto.</p>}
              </div>
            )}
          </section>

          <section className="pn-bloco" aria-labelledby="h-quem">
            <h2 id="h-quem" className="pn-h2">
              Quem pediu
            </h2>
            <dl className="pn-lista-det">
              <Linha rotulo="Nome">{p.nome}</Linha>
              <Linha rotulo="WhatsApp">
                {p.whatsapp ? (
                  <a className="pd-ligado" href={`https://wa.me/${p.whatsapp}`} target="_blank" rel="noopener noreferrer">
                    {whatsappBonito(p.whatsapp)}
                    <span className="sr-only"> (abre o WhatsApp)</span>
                  </a>
                ) : (
                  <span className="pd-sem">{p.dadosApagados ? 'apagado' : 'o site não sabia'}</span>
                )}
              </Linha>
              <Linha rotulo="Atendimento">{de}</Linha>
            </dl>
            {!p.dadosApagados && <EditarWhats p={p} aoSalvar={trocar} />}
          </section>
        </div>

        <div className="pd-col-dir">
          {enc && p.encomenda ? (
            <section className="pn-bloco" aria-labelledby="h-encomenda">
              <h2 id="h-encomenda" className="pn-h2">
                Encomenda
              </h2>
              <dl className="pn-lista-det">
                <LinhaLonga rotulo="Produto">
                  <span className="pd-quebra">{p.encomenda.produto}</span>
                </LinhaLonga>
                <Linha rotulo="Quantidade">{p.encomenda.quantidade}</Linha>
                {p.encomenda.referencia && (
                  <LinhaLonga rotulo="Link ou descrição">
                    <Referencia texto={p.encomenda.referencia} />
                  </LinhaLonga>
                )}
              </dl>
            </section>
          ) : (
            <section className="pn-bloco" aria-labelledby="h-itens">
              <h2 id="h-itens" className="pn-h2">
                Itens
              </h2>
              <ul className="pd-itens">
                {p.itens.map((i, n) => (
                  <li key={n}>
                    <span>
                      <span className="pd-item-qtd">{i.qtd}x</span>
                      {i.nome}
                    </span>
                    <span className="pd-item-valor">{i.total != null ? brl(i.total) : 'a consultar'}</span>
                    <span className="pd-item-sub">
                      {i.precoUnit != null ? `${brl(i.precoUnit)} cada` : 'preço a consultar'}
                      {i.combo ? ` · combo ${i.combo}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="pd-total">
                <span>Subtotal</span>
                <span>{p.subtotalTexto || (p.subtotal != null ? brl(p.subtotal) : 'a consultar')}</span>
              </p>
              {p.cupom && (
                <p className="pd-cupom">
                  Cupom <span className="pn-codigo">{p.cupom.codigo}</span>
                  {p.cupom.regra ? ` · ${p.cupom.regra}` : ''}. Confere antes de dar o desconto (o subtotal é sem ele).
                </p>
              )}
              <p className="pn-dica-bloco pd-sem-taxa">Sem a taxa de entrega: a loja combina no WhatsApp.</p>
            </section>
          )}

          <section className="pn-bloco" aria-labelledby="h-entrega">
            <h2 id="h-entrega" className="pn-h2">
              {enc ? 'Entrega' : 'Entrega e pagamento'}
            </h2>
            <dl className="pn-lista-det">
              <LinhaLonga rotulo="Endereço">
                {endereco ? (
                  <>
                    <span className="pd-quebra">{endereco}</span>
                    <a className="pd-ligado pd-mapa" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(endereco)}`} target="_blank" rel="noopener noreferrer">
                      Ver no mapa
                      <span className="sr-only"> (abre o Google Maps)</span>
                    </a>
                  </>
                ) : (
                  <span className="pd-sem">{p.dadosApagados ? 'apagado' : 'a combinar no WhatsApp'}</span>
                )}
              </LinhaLonga>
              {!enc && <Linha rotulo="Pagamento">{pagamentoTexto(p)}</Linha>}
              {p.observacao && (
                <LinhaLonga rotulo="Observação">
                  <span className="pd-quebra">{p.observacao}</span>
                </LinhaLonga>
              )}
            </dl>
          </section>

          {p.mensagem && (
            <section className="pn-bloco" aria-labelledby="h-msg">
              <h2 id="h-msg" className="pn-h2">
                Mensagem do WhatsApp
              </h2>
              <p className="pn-dica-bloco">O texto que o site montou pro WhatsApp, com o código {p.codigo} (o cliente pode ter mexido antes de mandar).</p>
              <details className="pd-detalhes">
                <summary>Ver a mensagem</summary>
                <pre className="pd-msg">{p.mensagem}</pre>
              </details>
              <BotaoCopiar texto={p.mensagem} rotulo="Copiar a mensagem" variante="texto" className="pn-botao-p" />
            </section>
          )}

          {!p.dadosApagados && (
            <section className="pn-bloco" aria-labelledby="h-nota">
              <Nota key={p.id} p={p} aoSalvar={trocar} />
            </section>
          )}

          {veAvisos && (
          <section className="pn-bloco" aria-labelledby="h-avisos">
            <div className="pn-h2-linha">
              <h2 id="h-avisos" className="pn-h2">
                Aviso no grupo
              </h2>
              <Link href={caminho.avisos} className="pn-link">
                Avisos no WhatsApp
              </Link>
            </div>
            {acaoAviso.erro && <Aviso tipo="erro">{acaoAviso.erro.message}</Aviso>}
            {d.avisos.length === 0 ? (
              <p className="pn-vazio">Sem aviso no grupo {enc ? 'pra essa encomenda' : 'pra esse pedido'}: quando {enc ? 'ela' : 'ele'} chegou, esse aviso tava desligado.</p>
            ) : (
              <ListaAvisos envios={d.avisos} agora={agora} ocupado={avisoOcupado} aoReenviar={reenviar} comPedido={false} />
            )}
          </section>
          )}

          {(anterior || podeCancelar || podeApagar) && (
            <section className="pn-bloco" aria-labelledby="h-mais">
              <h2 id="h-mais" className="pn-h2">
                Mais
              </h2>
              <div className="pn-botoes pd-mais-botoes">
                {anterior && (
                  <Botao variante="cinza" largo onClick={() => pedirVoltar(anterior)}>
                    {p.status === 'entregue' ? 'Desfazer a entrega' : `Voltar pra ${nomeStatus(anterior, p.tipo).toLowerCase()}`}
                  </Botao>
                )}
                {podeCancelar && (
                  <Botao variante="perigo" largo onClick={pedirCancelar}>
                    {enc ? 'Cancelar a encomenda' : 'Cancelar o pedido'}
                  </Botao>
                )}
                {podeApagar && (
                  <Botao variante="texto" largo icone="lixo" onClick={pedirApagar}>
                    Apagar os dados (LGPD)
                  </Botao>
                )}
              </div>
              {apagaDados && !podeApagar && !p.dadosApagados && <p className="pn-dica-bloco">Pra apagar os dados de quem pediu (LGPD), {oPedido} tem que estar entregue ou cancelad{enc ? 'a' : 'o'}.</p>}
            </section>
          )}
        </div>
      </div>
      <Confirmar pedido={confirmacao} aoFechar={() => setConfirmacao(null)} />
    </>
  )
}
