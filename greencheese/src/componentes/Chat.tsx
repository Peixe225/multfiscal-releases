import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { canais, canalDa, type Canal, type FormaPagamento } from '../dados/canais'
import { ProdutoVisual } from '../arte/ProdutoVisual'
import { buscarCep, type Endereco } from '../lib/cep'
import { alvoDeSaida } from '../lib/ambiente'
import { config } from '../dados/config'
import { situacao } from '../lib/horario'
import { copiarTexto } from '../lib/copiar'
import { brl, formatarCep, soDigitos } from '../lib/formato'
import {
  NOME_PAGAMENTO,
  linkDM,
  linkPerfil,
  linkWhatsApp,
  montarEncomenda,
  montarPedido,
} from '../lib/mensagem'
import { useConta, useCupons, useAgora } from '../lib/conta'
import { conta as adaptador } from '../lib/conta-adaptador'
import { useConferirCupom, useCupomNoPedido } from '../lib/cupom-pedido'
import { linhaCupom, nomeCategoria, nomeCurto, situacaoNoPedido, type Situacao } from '../lib/cupom-uso'
import { rolarPara } from '../lib/rolagem'
import { produtoPorId } from '../store/catalogo'
import { useChat, type Passo, type Respostas } from '../store/chat'
import { useLinhasSacola } from '../store/derivados'
import { nomeCidade, useLocal } from '../store/local'
import { useSacola } from '../store/sacola'
import { useUI } from '../store/ui'
import { Avatar, Demo, Icone } from './comum'
import { Folha } from './Folha'
import { ListaSacola } from './Sacola'
import './Chat.css'

interface Chip {
  rotulo: string
  acao: () => void
}

interface Campo {
  placeholder: string
  modo?: 'text' | 'numeric' | 'tel' | 'decimal'
  autoComplete?: string
  max?: number
  inicial?: string
  mascara?: (v: string) => string
  validar?: (v: string) => string | null
  enviar: (v: string) => void
}

interface Def {
  perguntas: ReactNode[]
  chips?: Chip[]
  campo?: Campo
  /** Texto da bolha enviada quando o passo já foi respondido. */
  resposta?: string | null
}

type AvisoCep = { tipo: 'outra-uf'; end: Endereco } | { tipo: 'nao-achei' } | { tipo: 'fora-do-ar' } | null

function horaAgora(): string {
  const d = new Date()
  return `Hoje ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function ChatFolha() {
  const chat = useChat()
  const { aberto, modo, passo, feitos, respostas, respondendo, respondendoDe, fechar, responder, voltarPara, abrir } = chat
  const local = useLocal()
  const { pedido, fora, todas } = useLinhasSacola()
  const limparSacola = useSacola((s) => s.limpar)
  const setSeletor = useUI((s) => s.setSeletor)
  const setSacola = useUI((s) => s.setSacola)
  const fim = useRef<HTMLDivElement>(null)
  const [buscandoCep, setBuscandoCep] = useState(false)
  const [avisoCep, setAvisoCep] = useState<AvisoCep>(null)
  const [tipoEnvio, setTipoEnvio] = useState<'whats' | 'dm' | null>(null)
  const enviadoEm = useChat((s) => s.enviadoEm)
  const marcarEnviado = useChat((s) => s.marcarEnviado)
  const recomecar = useChat((s) => s.recomecar)
  const conta = useConta()
  const avisar = useUI((s) => s.avisar)
  const { cupom, situacao: situacaoCupom } = useCupomNoPedido()
  const cupons = useCupons()
  const agora = useAgora()
  // o cupom só entra na mensagem quando vale nesse pedido (encomenda nunca leva cupom)
  const cupomOk = modo === 'pedido' && cupom && situacaoCupom?.tipo === 'ok' ? cupom : null
  // sem cupom aplicado: um cupom guardado que vale nesse pedido, pra perguntar se usa
  const sugerido =
    modo === 'pedido' && !cupom ? (cupons.find((c) => c.status === 'ativo' && situacaoNoPedido(c, todas, local.uf, agora).tipo === 'ok') ?? null) : null
  useConferirCupom(aberto && passo === 'resumo')

  // Canal: no pedido é o estado do site; na encomenda de quem está fora da área, é o escolhido no chat.
  const canalSite = canalDa(local.uf)
  const canal: Canal | undefined = modo === 'encomenda' && !canalSite ? canalDa(respostas.canalEnc) : canalSite
  const cidade = canal === canalSite ? nomeCidade(canal, local.cidade, local.cidadeInformada) : null
  const lugar = canal ? `${cidade ?? canal.nome} (${canal.uf.toUpperCase()})` : ''

  const resp = (dados: Partial<Respostas>, p: Passo, proximo: Passo) => {
    setAvisoCep(null)
    responder(p, dados, proximo)
  }

  const precisaCidade = (c: Canal | undefined) => !!c && c.cidades.length === 0 && !local.cidadeInformada
  const depoisDoLocal = (c: Canal | undefined): Passo => {
    if (modo === 'encomenda') return 'enc-produto'
    return precisaCidade(c) ? 'cidade' : 'sacola'
  }

  const mensagem = useMemo(() => {
    if (!canal) return ''
    if (modo === 'encomenda') {
      return montarEncomenda({
        canal,
        cidade,
        produto: respostas.encProduto,
        quantidade: respostas.encQtd,
        referencia: respostas.encRef,
        nome: respostas.nome,
      })
    }
    const endereco = respostas.rua
      ? `${respostas.rua}${respostas.numero ? `, ${respostas.numero}` : ''}${respostas.bairro ? `, ${respostas.bairro}` : ''}${canal.cidades.length === 0 && respostas.cidadeCep ? `, ${respostas.cidadeCep}` : ''}`
      : respostas.enderecoLivre
    return montarPedido({
      canal,
      cidade,
      linhas: pedido,
      nome: respostas.nome,
      endereco,
      pagamento: respostas.pagamento,
      troco: respostas.troco,
      obs: respostas.obs,
      cupom: cupomOk ? linhaCupom(cupomOk, 'Teste minha sorte', cupomOk.demo && config.carimboDeExemplo) : undefined,
    })
  }, [canal, cidade, modo, respostas, pedido, cupomOk])

  // sobe para a última mensagem a cada passo (rola o corpo da folha, não a página: a pergunta e as opções ficam à vista
  // mesmo num celular baixo)
  useEffect(() => {
    if (!aberto) return
    const rolar = () => {
      const corpo = fim.current?.closest<HTMLElement>('.folha-corpo')
      if (corpo) corpo.scrollTop = corpo.scrollHeight
    }
    const raf = requestAnimationFrame(rolar)
    // ao abrir, a folha monta o conteúdo um quadro depois e ainda está subindo: rola de novo quando ela assenta
    const t = window.setTimeout(rolar, 480)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(t)
    }
  }, [aberto, passo, feitos.length, buscandoCep, avisoCep, enviadoEm])

  async function enviarCep(v: string) {
    if (!canal) return
    setBuscandoCep(true)
    setAvisoCep(null)
    try {
      const end = await buscarCep(v)
      if (!end) {
        setAvisoCep({ tipo: 'nao-achei' })
        return
      }
      if (end.uf !== canal.uf) {
        setAvisoCep({ tipo: 'outra-uf', end })
        return
      }
      aplicarCep(end)
    } catch {
      setAvisoCep({ tipo: 'fora-do-ar' })
    } finally {
      setBuscandoCep(false)
    }
  }

  function aplicarCep(end: Endereco) {
    if (canal && canal.cidades.length === 0) local.informarCidade(end.cidade)
    resp(
      { cep: end.cep, rua: end.rua, bairro: end.bairro, cidadeCep: end.cidade, ufCep: end.uf, enderecoLivre: '' },
      'endereco',
      end.rua ? 'numero' : 'rua',
    )
  }

  function def(p: Passo): Def {
    const nome = respostas.nome.trim()
    // com conta, o nome da conta já vem sugerido (o passo não é pulado)
    const sugestaoNome = nome || conta?.nome.trim() || ''
    switch (p) {
      case 'local': {
        if (!canal) {
          return {
            perguntas: [modo === 'encomenda' ? 'A Green Cheese ainda não chegou no teu estado. Pra qual atendimento vai a encomenda?' : 'De qual estado você pede?'],
            chips: [
              ...canais.map((c) => ({
                rotulo: `${c.uf.toUpperCase()} · ${c.cidades[0]?.nome ?? c.nome}`,
                acao: () => {
                  if (modo === 'encomenda' && local.uf && !canalSite) resp({ canalEnc: c.uf }, 'local', 'enc-produto')
                  else {
                    local.escolher(c.uf, null, 'manual')
                    resp({}, 'local', modo === 'encomenda' ? 'enc-produto' : c.cidades.length === 0 ? 'cidade' : 'sacola')
                  }
                },
              })),
              ...(modo === 'pedido' ? [{ rotulo: 'Outro estado', acao: () => setSeletor(true) }] : []),
            ],
            resposta: canal ? lugar : null,
          }
        }
        if (canal === canalSite && canal.cidades.length > 1 && !local.cidade) {
          return {
            perguntas: [`Teu pedido vai pra Green Cheese ${canal.uf.toUpperCase()}. Qual cidade?`],
            chips: canal.cidades.map((c) => ({
              rotulo: c.nome,
              acao: () => {
                local.escolherCidade(c.slug)
                resp({}, 'local', depoisDoLocal(canal))
              },
            })),
            resposta: lugar,
          }
        }
        const sit = situacao(canal)
        return {
          perguntas: [
            modo === 'encomenda'
              ? `A encomenda vai pro atendimento de ${lugar}. Pode ser?`
              : `Teu pedido vai pro atendimento de ${lugar}, certo?`,
            ...(!sit.aberto && (config.carimboDeExemplo || !canal.horario.demo)
              ? [
                  <span key="h">
                    {sit.texto}. Pode montar o pedido: a resposta vem quando abrir. <Demo ativo={canal.horario.demo} />
                  </span>,
                ]
              : []),
          ],
          chips: [
            {
              rotulo: modo === 'encomenda' ? 'Pode' : 'Isso',
              acao: () => {
                if (canal === canalSite && !local.confirmado) local.confirmar()
                resp({}, 'local', depoisDoLocal(canal))
              },
            },
            {
              // o seletor abre na lista de estados: "cidade" só quando o canal tem mais de uma
              rotulo: canal === canalSite ? (canal.cidades.length > 1 ? 'Trocar cidade' : 'Trocar estado') : 'Trocar atendimento',
              acao: () => (canal === canalSite ? setSeletor(true) : resp({ canalEnc: '' }, 'local', 'local')),
            },
          ],
          resposta: `${modo === 'encomenda' ? 'Pode' : 'Isso'} — ${lugar}`,
        }
      }
      case 'cidade':
        return {
          perguntas: [`A Green Cheese ${canal?.uf.toUpperCase() ?? ''} ainda tá fechando a lista de cidades. Qual a tua cidade?`],
          campo: {
            placeholder: 'Tua cidade…',
            autoComplete: 'address-level2',
            max: 60,
            inicial: local.cidadeInformada ?? '',
            validar: (v) => (v.trim().length < 2 ? 'Escreve o nome da cidade.' : null),
            enviar: (v) => {
              local.informarCidade(v.trim())
              resp({}, 'cidade', 'sacola')
            },
          },
          resposta: local.cidadeInformada,
        }
      case 'sacola': {
        if (pedido.length === 0) {
          return {
            perguntas: [
              fora.length
                ? `Os itens da tua sacola não tão disponíveis em ${cidade ?? canal?.nome ?? 'teu estado'}.`
                : 'Tua sacola tá vazia.',
            ],
            chips: [
              {
                rotulo: 'Ver o catálogo',
                acao: () => {
                  fechar()
                  setTimeout(() => rolarPara('#catalogo', -70), 320)
                },
              },
              { rotulo: 'Fazer encomenda', acao: () => abrir('encomenda') },
            ],
          }
        }
        return {
          perguntas: [
            'Confere a sacola:',
            <div className="dm-cartao" key="sacola">
              <ListaSacola compacta />
            </div>,
          ],
          chips: [
            { rotulo: 'Tá certo', acao: () => resp({}, 'sacola', 'nome') },
            { rotulo: 'Mexer na sacola', acao: () => setSacola(true) },
          ],
          resposta: 'Tá certo',
        }
      }
      case 'nome':
      case 'enc-nome':
        return {
          perguntas: ['Teu nome?'],
          chips: sugestaoNome ? [{ rotulo: sugestaoNome, acao: () => resp({ nome: sugestaoNome }, p, p === 'nome' ? 'endereco' : 'enc-resumo') }] : undefined,
          campo: {
            placeholder: 'Teu nome…',
            autoComplete: 'name',
            max: 60,
            validar: (v) => (v.trim().length < 2 ? 'Escreve teu nome.' : null),
            enviar: (v) => resp({ nome: v.trim() }, p, p === 'nome' ? 'endereco' : 'enc-resumo'),
          },
          resposta: nome,
        }
      case 'endereco': {
        const temAnterior = respostas.rua && respostas.numero && respostas.ufCep === canal?.uf
        const chips: Chip[] = []
        if (temAnterior) {
          chips.push({ rotulo: `${respostas.rua}, ${respostas.numero}`, acao: () => resp({}, 'endereco', 'pagamento') })
        } else if (respostas.cep && respostas.ufCep === canal?.uf) {
          chips.push({ rotulo: `CEP ${formatarCep(respostas.cep)}`, acao: () => resp({}, 'endereco', respostas.rua ? 'numero' : 'rua') })
        } else if (respostas.enderecoLivre && !respostas.cep) {
          chips.push({ rotulo: respostas.enderecoLivre, acao: () => resp({}, 'endereco', 'pagamento') })
        }
        chips.push({ rotulo: 'Sem CEP', acao: () => resp({ cep: '', rua: '', bairro: '', numero: '' }, 'endereco', 'rua') })
        return {
          perguntas: ['Onde entrega? Manda o CEP que o endereço se completa.'],
          chips,
          campo: {
            placeholder: 'CEP (só números)',
            modo: 'numeric',
            autoComplete: 'postal-code',
            max: 9,
            mascara: formatarCep,
            validar: (v) => (soDigitos(v).length !== 8 ? 'O CEP tem 8 números.' : null),
            enviar: (v) => void enviarCep(v),
          },
          resposta: respostas.cep ? formatarCep(respostas.cep) : 'Sem CEP',
        }
      }
      case 'numero':
        return {
          perguntas: [`${respostas.rua}${respostas.bairro ? `, ${respostas.bairro}` : ''} — ${respostas.cidadeCep}/${respostas.ufCep.toUpperCase()}. Número e complemento?`],
          campo: {
            placeholder: 'Ex.: 120, apto 201',
            autoComplete: 'address-line2',
            max: 60,
            inicial: respostas.numero,
            validar: (v) => (!v.trim() ? 'Manda o número (ou "s/n").' : null),
            enviar: (v) => resp({ numero: v.trim() }, 'numero', 'pagamento'),
          },
          resposta: respostas.numero,
        }
      case 'rua':
        return {
          perguntas: [respostas.cep && !respostas.rua ? `Esse CEP é de ${respostas.cidadeCep} inteira. Manda rua, número e bairro.` : 'Manda o endereço: rua, número e bairro.'],
          campo: {
            placeholder: 'Rua, número, bairro',
            autoComplete: 'street-address',
            max: 140,
            inicial: respostas.enderecoLivre,
            validar: (v) => (v.trim().length < 6 ? 'Falta coisa: rua, número e bairro.' : null),
            enviar: (v) => resp({ enderecoLivre: v.trim(), rua: '', numero: '' }, 'rua', 'pagamento'),
          },
          resposta: respostas.enderecoLivre,
        }
      case 'pagamento': {
        const opcoes = canal?.pagamento.opcoes ?? (['pix', 'dinheiro', 'cartao'] as FormaPagamento[])
        return {
          perguntas: [
            <span key="p">
              Como vai pagar? <Demo ativo={!!canal?.pagamento.demo} />
            </span>,
          ],
          chips: opcoes.map((o) => ({
            rotulo: NOME_PAGAMENTO[o],
            acao: () => resp({ pagamento: o, troco: o === 'dinheiro' ? respostas.troco : null }, 'pagamento', o === 'dinheiro' ? 'troco' : 'obs'),
          })),
          resposta: respostas.pagamento ? NOME_PAGAMENTO[respostas.pagamento] : null,
        }
      }
      case 'troco':
        return {
          perguntas: ['Troco pra quanto?'],
          chips: [{ rotulo: 'Sem troco', acao: () => resp({ troco: null }, 'troco', 'obs') }],
          campo: {
            placeholder: 'Ex.: 100',
            modo: 'decimal',
            max: 10,
            validar: (v) => {
              const n = Number(v.replace(/[^\d,.]/g, '').replace(',', '.'))
              return !Number.isFinite(n) || n <= 0 ? 'Só o valor, tipo 100 ou 50,00.' : null
            },
            enviar: (v) => resp({ troco: Number(v.replace(/[^\d,.]/g, '').replace(',', '.')) }, 'troco', 'obs'),
          },
          resposta: respostas.troco ? `Troco pra ${brl(respostas.troco)}` : 'Sem troco',
        }
      case 'obs':
        return {
          perguntas: ['Alguma observação? Ponto de referência, portão, horário…'],
          chips: [{ rotulo: 'Sem observação', acao: () => resp({ obs: '' }, 'obs', 'resumo') }],
          campo: {
            placeholder: 'Observação…',
            max: 200,
            inicial: respostas.obs,
            enviar: (v) => resp({ obs: v.trim() }, 'obs', 'resumo'),
          },
          resposta: respostas.obs || 'Sem observação',
        }
      case 'enc-produto':
        return {
          perguntas: ['Não achou? A Green Cheese importa. Qual produto você quer?'],
          campo: {
            placeholder: 'Ex.: Fanta de uva japonesa',
            max: 120,
            inicial: respostas.encProduto,
            validar: (v) => (v.trim().length < 2 ? 'Escreve o produto.' : null),
            enviar: (v) => resp({ encProduto: v.trim() }, 'enc-produto', 'enc-qtd'),
          },
          resposta: respostas.encProduto,
        }
      case 'enc-qtd':
        return {
          perguntas: ['Quantas unidades?'],
          chips: ['1', '2', '3', '6', '12'].map((q) => ({ rotulo: q, acao: () => resp({ encQtd: q }, 'enc-qtd', 'enc-ref') })),
          campo: {
            placeholder: 'Outra quantidade…',
            max: 30,
            validar: (v) => (!v.trim() ? 'Quantas?' : null),
            enviar: (v) => resp({ encQtd: v.trim() }, 'enc-qtd', 'enc-ref'),
          },
          resposta: respostas.encQtd,
        }
      case 'enc-ref':
        return {
          perguntas: ['Tem link ou descrição? Marca, sabor, tamanho… pode colar o link.'],
          chips: [{ rotulo: 'Pular', acao: () => resp({ encRef: '' }, 'enc-ref', 'enc-nome') }],
          campo: {
            placeholder: 'Link ou descrição…',
            max: 300,
            inicial: respostas.encRef,
            enviar: (v) => resp({ encRef: v.trim() }, 'enc-ref', 'enc-nome'),
          },
          resposta: respostas.encRef || 'Sem link',
        }
      case 'resumo':
      case 'enc-resumo':
      default:
        return { perguntas: [] }
    }
  }

  const atual = def(passo)
  const ehResumo = passo === 'resumo' || passo === 'enc-resumo'
  const produtosCitados = respondendo.map((id) => produtoPorId(id)).filter((p) => !!p)

  const cabecalho = (
    <div className="dm-cab">
      <Avatar tamanho={28} anel={false} />
      <span className="dm-cab-txt">
        <strong>Pedido guiado</strong>
        {/* o aviso de que as respostas são automáticas vem primeiro: no celular estreito, quem perde as reticências é o @ */}
        <span className="legenda">respostas automáticas{canal ? ` · @${canal.instagram}` : ''}</span>
      </span>
    </div>
  )

  const ultimaPergunta = atual.perguntas.length ? atual.perguntas : []

  return (
    <Folha
      id="chat"
      aberta={aberto}
      aoFechar={fechar}
      rotulo="Pedido guiado"
      cabecalho={cabecalho}
      className="folha-chat"
      rodape={
        !ehResumo && atual.campo ? (
          <EntradaDM key={passo} campo={atual.campo} desativado={buscandoCep} />
        ) : !ehResumo ? (
          <p className="dm-dica legenda">Toca numa opção ali em cima</p>
        ) : undefined
      }
    >
      <div className="dm" aria-live="polite" aria-relevant="additions">
        <div className="dm-perfil">
          <Avatar tamanho={88} />
          <strong>{canal?.nomePerfil ?? 'Green Cheese Imports'}</strong>
          <span className="legenda">{canal ? `${canal.instagram} · Instagram` : 'RJ · MG · SP · ES · SC'}</span>
          {canal && (
            <a className="botao botao-cinza dm-ver-perfil" href={linkPerfil(canal.instagram)} target="_blank" rel="noopener noreferrer">
              Ver perfil
            </a>
          )}
        </div>
        <p className="dm-hora legenda">{horaAgora()}</p>

        {produtosCitados.length > 0 && modo === 'pedido' && (
          <div className="dm-citado">
            <span className="legenda dm-citado-rot">{respondendoDe === 'pagina' ? 'Você pediu pela página do produto' : 'Você respondeu ao story'}</span>
            <div className="dm-citado-pilha">
              {produtosCitados.slice(0, 3).map((p, i) => (
                <div key={p.id} className="dm-citado-quadro" style={{ transform: `translateX(${-i * 14}px) rotate(${i * 3}deg)`, zIndex: 3 - i }}>
                  <ProdutoVisual produto={p} largura={54} revelar={false} prioridade />
                </div>
              ))}
            </div>
            <p className="dm-bolha dm-eu">Quero esse{produtosCitados.length > 1 ? 's' : ''}</p>
          </div>
        )}

        {feitos.map((p) => {
          const d = def(p)
          return (
            <div key={p} className="dm-troca">
              {d.perguntas.map((q, i) => (
                <BolhaLoja key={i}>{q}</BolhaLoja>
              ))}
              {d.resposta && (
                <button type="button" className="dm-bolha dm-eu dm-editavel" onClick={() => voltarPara(p)} aria-label={`${d.resposta}. Tocar para mudar`}>
                  {d.resposta}
                </button>
              )}
            </div>
          )
        })}

        {!ehResumo && (
          <div className="dm-troca dm-atual">
            {ultimaPergunta.map((q, i) => (
              <BolhaLoja key={i}>{q}</BolhaLoja>
            ))}
            {buscandoCep && <BolhaLoja>Procurando o CEP…</BolhaLoja>}
            {avisoCep?.tipo === 'nao-achei' && <BolhaLoja>Não achei esse CEP. Confere os números ou segue sem CEP.</BolhaLoja>}
            {avisoCep?.tipo === 'fora-do-ar' && <BolhaLoja>O serviço de CEP não respondeu agora. Dá pra digitar o endereço.</BolhaLoja>}
            {avisoCep?.tipo === 'outra-uf' && (
              <BolhaLoja>
                Esse CEP é de {avisoCep.end.cidade}/{avisoCep.end.uf.toUpperCase()}. O atendimento escolhido é o de {canal?.uf.toUpperCase()}.
              </BolhaLoja>
            )}
            <Chips
              chips={
                avisoCep?.tipo === 'outra-uf'
                  ? [
                      ...(canalDa(avisoCep.end.uf)
                        ? [
                            {
                              rotulo: `Trocar pra Green Cheese ${avisoCep.end.uf.toUpperCase()}`,
                              acao: () => {
                                const end = avisoCep.end
                                local.escolher(end.uf, null, 'manual')
                                if (canalDa(end.uf)?.cidades.length === 0) local.informarCidade(end.cidade)
                                setAvisoCep(null)
                                // o CEP fica guardado para reaproveitar no passo do endereço
                                useChat.setState((st) => ({
                                  respostas: { ...st.respostas, cep: end.cep, rua: end.rua, bairro: end.bairro, cidadeCep: end.cidade, ufCep: end.uf, numero: '' },
                                }))
                                voltarPara('local')
                              },
                            },
                          ]
                        : []),
                      { rotulo: 'É esse mesmo', acao: () => aplicarCep(avisoCep.end) },
                      { rotulo: 'Outro CEP', acao: () => setAvisoCep(null) },
                    ]
                  : avisoCep?.tipo === 'nao-achei' || avisoCep?.tipo === 'fora-do-ar'
                    ? [{ rotulo: 'Digitar endereço', acao: () => resp({ cep: '', rua: '', bairro: '', numero: '' }, 'endereco', 'rua') }]
                    : (atual.chips ?? [])
              }
            />
          </div>
        )}

        {ehResumo && canal && (
          <Resumo
            canal={canal}
            mensagem={mensagem}
            encomenda={modo === 'encomenda'}
            enviadoEm={enviadoEm}
            tipoEnvio={tipoEnvio}
            aoEnviar={(t) => {
              setTipoEnvio(t)
              marcarEnviado(Date.now())
            }}
            naoConsegui={() => marcarEnviado(null)}
            editar={(p) => voltarPara(p)}
            cupom={
              modo === 'pedido' && cupom && situacaoCupom
                ? { codigo: cupom.codigo, titulo: cupom.retrato.titulo, situacao: situacaoCupom, exemplo: cupom.demo && config.carimboDeExemplo }
                : null
            }
            sugerido={sugerido ? { codigo: sugerido.codigo, titulo: sugerido.retrato.titulo, exemplo: sugerido.demo && config.carimboDeExemplo } : null}
            lugar={cidade ?? canal.nome}
            aplicarCupom={(c) => useSacola.getState().aplicarCupom(c)}
            tirarCupom={() => useSacola.getState().tirarCupom()}
            mexerSacola={() => setSacola(true)}
            mandei={async () => {
              if (modo === 'pedido') {
                // a mensagem levou o cupom: marca como usado (na versão oficial, quem dá baixa é a loja)
                if (cupomOk) {
                  const codigo = cupomOk.codigo
                  await adaptador.usarCupom(codigo)
                  useSacola.getState().tirarCupom()
                  avisar(`Cupom ${codigo} marcado como usado.`)
                }
                useSacola.getState().guardarUltimo()
                limparSacola()
              }
              recomecar()
              fechar()
            }}
          />
        )}
        <div ref={fim} className="dm-fim" />
      </div>
    </Folha>
  )
}

function BolhaLoja({ children }: { children: ReactNode }) {
  return <div className="dm-bolha dm-loja">{children}</div>
}

function Chips({ chips }: { chips: Chip[] }) {
  if (!chips.length) return null
  return (
    <div className="dm-chips" role="group" aria-label="Respostas rápidas">
      {chips.map((c) => (
        <button key={c.rotulo} type="button" className="dm-chip toque" onClick={c.acao}>
          {c.rotulo}
        </button>
      ))}
    </div>
  )
}

/** Campo no molde do Direct: pílula cinza, "Enviar" aparece quando há texto. */
function EntradaDM({ campo, desativado }: { campo: Campo; desativado?: boolean }) {
  const [v, setV] = useState(campo.inicial ?? '')
  const [erro, setErro] = useState<string | null>(null)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    // no celular, não abrir o teclado sozinho por cima das opções; no desktop, foca
    if (window.matchMedia('(pointer: fine)').matches) ref.current?.focus({ preventScroll: true })
  }, [])
  const enviar = () => {
    const e = campo.validar?.(v) ?? null
    setErro(e)
    if (e) return
    campo.enviar(v)
  }
  return (
    <form
      className="dm-entrada"
      onSubmit={(e) => {
        e.preventDefault()
        enviar()
      }}
    >
      {erro && (
        <p className="dm-erro" role="alert">
          {erro}
        </p>
      )}
      <div className="dm-entrada-pilula">
        <input
          ref={ref}
          value={v}
          onChange={(e) => {
            setErro(null)
            setV(campo.mascara ? campo.mascara(e.target.value) : e.target.value)
          }}
          placeholder={campo.placeholder}
          aria-label={campo.placeholder}
          inputMode={campo.modo === 'tel' ? 'tel' : campo.modo === 'numeric' ? 'numeric' : campo.modo === 'decimal' ? 'decimal' : 'text'}
          autoComplete={campo.autoComplete ?? 'off'}
          maxLength={campo.max}
          enterKeyHint="send"
          disabled={desativado}
          onFocus={() => {
            // o teclado do celular sobe a folha: mantém a última mensagem à vista
            setTimeout(() => document.querySelector('.dm-fim')?.scrollIntoView({ block: 'end' }), 320)
          }}
        />
        {v.trim() && (
          <button type="submit" className="dm-enviar" disabled={desativado}>
            Enviar
          </button>
        )}
      </div>
    </form>
  )
}

function Resumo({
  canal,
  mensagem,
  encomenda,
  enviadoEm,
  tipoEnvio,
  aoEnviar,
  naoConsegui,
  editar,
  mandei,
  cupom,
  sugerido,
  lugar,
  aplicarCupom,
  tirarCupom,
  mexerSacola,
}: {
  canal: Canal
  mensagem: string
  encomenda: boolean
  enviadoEm: number | null
  tipoEnvio: 'whats' | 'dm' | null
  aoEnviar: (v: 'whats' | 'dm') => void
  naoConsegui: () => void
  editar: (p: Passo) => void
  mandei: () => void
  /** Cupom aplicado e a situação dele nesse pedido (só no pedido; encomenda nunca leva cupom). */
  cupom: { codigo: string; titulo: string; situacao: Situacao; exemplo: boolean } | null
  /** Cupom guardado que vale nesse pedido, quando nenhum está aplicado. */
  sugerido: { codigo: string; titulo: string; exemplo: boolean } | null
  lugar: string
  aplicarCupom: (codigo: string) => void
  tirarCupom: () => void
  mexerSacola: () => void
}) {
  const avisar = useUI((s) => s.avisar)
  const [naoAbriu, setNaoAbriu] = useState(false)
  // "Sem cupom" esconde a pergunta até sair do resumo
  const [semCupom, setSemCupom] = useState(false)
  const cupomOk = cupom?.situacao.tipo === 'ok'
  const semNumero = !canal.whatsapp
  // no celular o link troca de app sem nova aba; no computador ou dentro de iframe, nova aba
  const alvo = alvoDeSaida()
  const tocou = (t: 'whats' | 'dm') => {
    aoEnviar(t)
    setNaoAbriu(false)
    if (!alvo) {
      window.setTimeout(() => {
        if (document.visibilityState === 'visible') setNaoAbriu(true)
      }, 1600)
    }
  }
  return (
    <div className="dm-troca dm-atual">
      <BolhaLoja>{encomenda ? 'Encomenda montada. Confere:' : 'Pedido montado. Confere:'}</BolhaLoja>
      <pre className="dm-mensagem" aria-label="Mensagem que vai pro WhatsApp">
        {mensagem}
      </pre>
      {cupom && cupomOk && (
        <BolhaLoja>
          Cupom <span className="px px-16">{cupom.codigo}</span> no pedido: desconto confirmado pela loja no WhatsApp.
          {cupom.exemplo && <> <span className="carimbo">exemplo</span></>}
        </BolhaLoja>
      )}
      {cupom && !cupomOk && !enviadoEm && (
        <>
          <BolhaLoja>
            O cupom <span className="px px-16">{cupom.codigo}</span> não vale pra esse pedido ({motivoCurto(cupom.situacao, lugar)}). Vai sem cupom?
          </BolhaLoja>
          <Chips
            chips={[
              { rotulo: 'Tirar cupom', acao: tirarCupom },
              { rotulo: 'Mexer na sacola', acao: mexerSacola },
            ]}
          />
        </>
      )}
      {!cupom && sugerido && !semCupom && !enviadoEm && (
        <>
          <BolhaLoja>
            Tu tem o cupom <span className="px px-16">{sugerido.codigo}</span> ({sugerido.titulo}). Usa nesse pedido?
            {sugerido.exemplo && <> <span className="carimbo">exemplo</span></>}
          </BolhaLoja>
          <Chips
            chips={[
              { rotulo: 'Usar cupom', acao: () => aplicarCupom(sugerido.codigo) },
              { rotulo: 'Sem cupom', acao: () => setSemCupom(true) },
            ]}
          />
        </>
      )}
      <BolhaLoja>Agora é só enviar. Vem no certo!</BolhaLoja>
      {semNumero && (
        <BolhaLoja>
          O WhatsApp da Green Cheese {canal.uf.toUpperCase()} ainda não tá no site: o WhatsApp vai pedir pra escolher o contato. Ou manda pela DM. <Demo ativo={semNumero} />
        </BolhaLoja>
      )}
      <div className="dm-acoes">
        <a className="botao botao-cheio botao-largo" href={linkWhatsApp(canal, mensagem)} target={alvo} rel="noopener noreferrer" onClick={() => tocou('whats')}>
          <Icone nome="whatsapp" tamanho={20} />
          Enviar no WhatsApp
        </a>
        <a
          className="botao botao-contorno botao-largo"
          href={linkDM(canal)}
          target={alvo}
          rel="noopener noreferrer"
          onClick={() => {
            // cópia síncrona, dentro do toque, antes de sair para o Instagram
            const ok = copiarTexto(mensagem)
            avisar(ok ? 'Pedido copiado. Cola na DM.' : 'Não deu pra copiar: segura no texto do pedido e copia.')
            tocou('dm')
          }}
        >
          <Icone nome="copiar" tamanho={20} />
          Copiar {encomenda ? 'encomenda' : 'pedido'} e abrir a DM do Instagram
        </a>
      </div>
      {naoAbriu && (
        <>
          <BolhaLoja>Não abriu? Toca de novo no botão, ou copia o texto e manda pela DM.</BolhaLoja>
          <Chips
            chips={[
              {
                rotulo: 'Copiar texto',
                acao: () => avisar(copiarTexto(mensagem) ? 'Copiado.' : 'Segura no texto do pedido e copia.'),
              },
            ]}
          />
        </>
      )}
      {enviadoEm && (
        <>
          <BolhaLoja>
            {tipoEnvio === 'dm'
              ? 'Pedido copiado. Na DM, cola e envia.'
              : tipoEnvio === 'whats'
                ? 'Mensagem pronta no WhatsApp. Quem aperta enviar é você.'
                : 'Já mandou o pedido?'}
          </BolhaLoja>
          <BolhaLoja>Chegou? Marca @{canal.instagram} no story.</BolhaLoja>
          <Chips
            chips={[
              { rotulo: 'Mandei', acao: mandei },
              { rotulo: 'Não consegui', acao: naoConsegui },
            ]}
          />
        </>
      )}
      {!enviadoEm && (
        <Chips
          chips={
            encomenda
              ? [
                  { rotulo: 'Mudar produto', acao: () => editar('enc-produto') },
                  { rotulo: 'Mudar quantidade', acao: () => editar('enc-qtd') },
                  { rotulo: 'Mudar nome', acao: () => editar('enc-nome') },
                ]
              : [
                  { rotulo: 'Mudar endereço', acao: () => editar('endereco') },
                  { rotulo: 'Mudar pagamento', acao: () => editar('pagamento') },
                  { rotulo: 'Mudar obs.', acao: () => editar('obs') },
                  ...(cupom && cupomOk ? [{ rotulo: 'Tirar cupom', acao: tirarCupom }] : []),
                ]
          }
        />
      )}
    </div>
  )
}

/** Por que o cupom aplicado não vale: "falta 1 OCB" · "faltam 2 OCB" · "não tem em Teófilo Otoni" · "precisa de seda". */
function motivoCurto(s: Situacao, lugar: string): string {
  switch (s.tipo) {
    case 'qtd-insuficiente': {
      const n = s.precisa - s.tem
      return `${n === 1 ? 'falta' : 'faltam'} ${n} ${s.produto ? nomeCurto(s.produto) : nomeCategoria(s.categoria)}`
    }
    case 'falta-produto':
      return s.produto ? `precisa de ${s.precisa > 1 ? `${s.precisa} ` : ''}${nomeCurto(s.produto)}` : `precisa de ${nomeCategoria(s.categoria)}`
    case 'indisponivel-aqui':
      return `não tem em ${lugar}`
    case 'fora-do-catalogo':
      return 'saiu do catálogo'
    case 'vencido':
      return 'venceu'
    default:
      return 'não vale mais'
  }
}
