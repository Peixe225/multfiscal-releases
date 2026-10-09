import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
  whatsappDoCanal,
} from '../lib/mensagem'
import type { Pedaco } from '../dados/textos-pedido'
import { atualizarFalas, primeiroNome, useFala } from '../lib/falas'
import { enviarPedido, type CorpoPedido } from '../lib/pedido-envio'
import { itensDoPedido } from '../lib/pedido-itens'
import { termoProibido } from '../painel/proibidos'
import { movimentoReduzido } from '../lib/movimento'
import { celularNoCampo } from '../lib/telefone'
import { useConta, useCupons, useAgora, useEnderecosDaConta } from '../lib/conta'
import { conta as adaptador } from '../lib/conta-adaptador'
import { useConferirCupom, useCupomNoPedido } from '../lib/cupom-pedido'
import { linhaCupom, nomeCategoria, nomeCurto, nomeDoPremio, situacaoNoPedido, type Situacao } from '../lib/cupom-uso'
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
  // tocou em "Fechar no WhatsApp" agora (se a página recarregou na volta do WhatsApp, o resumo só pergunta "Já mandou?")
  const [enviouAqui, setEnviouAqui] = useState(false)
  const enviadoEm = useChat((s) => s.enviadoEm)
  const marcarEnviado = useChat((s) => s.marcarEnviado)
  const recomecar = useChat((s) => s.recomecar)
  const conta = useConta()
  const enderecosConta = useEnderecosDaConta()
  const avisar = useUI((s) => s.avisar)
  const { cupom, situacao: situacaoCupom } = useCupomNoPedido()
  const cupons = useCupons()
  const agora = useAgora()
  // as falas da loja (as trocas do dono no painel, ou as de sempre) e o código do pedido que vai na mensagem
  const { t, p: falaEmPedacos } = useFala()
  const codigoPedido = useChat((s) => s.pedido)
  const marcarPedidoEnviado = useChat((s) => s.marcarPedidoEnviado)
  useEffect(() => {
    if (aberto) void atualizarFalas()
  }, [aberto])
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

  const endereco = respostas.rua
    ? `${respostas.rua}${respostas.numero ? `, ${respostas.numero}` : ''}${respostas.bairro ? `, ${respostas.bairro}` : ''}${canal && canal.cidades.length === 0 && respostas.cidadeCep ? `, ${respostas.cidadeCep}` : ''}`
    : respostas.enderecoLivre

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
        codigo: codigoPedido.codigo,
      })
    }
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
      codigo: codigoPedido.codigo,
    })
  }, [canal, cidade, modo, respostas, pedido, cupomOk, endereco, codigoPedido.codigo])

  // o pedido mudou depois de ir pro servidor (outro endereço, outra sacola): código novo, que substitui o de antes.
  // Antes de pintar: o link do WhatsApp nunca sai com o código velho numa mensagem nova
  const noResumo = passo === 'resumo' || passo === 'enc-resumo'
  useLayoutEffect(() => {
    if (!noResumo || !mensagem) return
    const { pedido: atual, trocarCodigo } = useChat.getState()
    if (atual.enviada !== null && atual.enviada !== mensagem) trocarCodigo()
  }, [noResumo, mensagem])

  /** A cópia estruturada do pedido, do jeito que a mensagem mostra (vai pro servidor no toque do WhatsApp). */
  function corpoDoPedido(): CorpoPedido | null {
    if (!canal || !mensagem) return null
    const base = {
      codigo: codigoPedido.codigo,
      token: codigoPedido.token,
      tipo: modo,
      uf: canal.uf,
      cidade: cidade ?? '',
      nome: respostas.nome.trim(),
      whatsapp: conta?.whatsapp ?? '',
      mensagem,
      site: '' as const,
      substitui: codigoPedido.substitui,
    }
    if (modo === 'encomenda') {
      return { ...base, encomenda: { produto: respostas.encProduto.trim(), quantidade: respostas.encQtd.trim(), referencia: respostas.encRef.trim() } }
    }
    const comRua = !!respostas.rua
    return {
      ...base,
      ...itensDoPedido(pedido),
      cupom: cupomOk ? { codigo: cupomOk.codigo, regra: cupomOk.retrato.regra, origem: 'Teste minha sorte' } : null,
      entrega: {
        endereco: endereco.trim(),
        rua: comRua ? respostas.rua : '',
        numero: comRua ? respostas.numero : '',
        bairro: comRua ? respostas.bairro : '',
        cep: respostas.cep,
        cidade: respostas.cep ? respostas.cidadeCep : '',
        uf: respostas.cep ? respostas.ufCep : '',
      },
      pagamento: respostas.pagamento,
      troco: respostas.pagamento === 'dinheiro' ? respostas.troco : null,
      obs: respostas.obs.trim(),
    }
  }

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
    // o {nome} das falas é só o primeiro nome
    const chamar = primeiroNome(nome)
    // com conta, o nome da conta já vem sugerido (o passo não é pulado)
    const sugestaoNome = nome || conta?.nome.trim() || ''
    switch (p) {
      case 'local': {
        if (!canal) {
          return {
            perguntas: [t(modo === 'encomenda' ? 'local.semEstado.encomenda' : 'local.semEstado')],
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
              ...(modo === 'pedido' ? [{ rotulo: t('local.outroEstado'), acao: () => setSeletor(true) }] : []),
            ],
            resposta: canal ? lugar : null,
          }
        }
        if (canal === canalSite && canal.cidades.length > 1 && !local.cidade) {
          return {
            perguntas: [t('local.qualCidade', { uf: canal.uf.toUpperCase(), estado: canal.nome })],
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
        const doLocal = { lugar, cidade: cidade ?? canal.nome, uf: canal.uf.toUpperCase(), estado: canal.nome }
        const sim = t(modo === 'encomenda' ? 'local.sim.encomenda' : 'local.sim')
        return {
          perguntas: [
            t(modo === 'encomenda' ? 'local.confirmar.encomenda' : 'local.confirmar', doLocal),
            ...(!sit.aberto && (config.carimboDeExemplo || !canal.horario.demo)
              ? [
                  <span key="h">
                    {t('local.fechado', { horario: sit.texto })} <Demo ativo={canal.horario.demo} />
                  </span>,
                ]
              : []),
          ],
          chips: [
            {
              rotulo: sim,
              acao: () => {
                if (canal === canalSite && !local.confirmado) local.confirmar()
                resp({}, 'local', depoisDoLocal(canal))
              },
            },
            {
              // o seletor abre na lista de estados: "cidade" só quando o canal tem mais de uma
              rotulo: t(canal === canalSite ? (canal.cidades.length > 1 ? 'local.trocarCidade' : 'local.trocarEstado') : 'local.trocarAtendimento'),
              acao: () => (canal === canalSite ? setSeletor(true) : resp({ canalEnc: '' }, 'local', 'local')),
            },
          ],
          resposta: `${sim} — ${lugar}`,
        }
      }
      case 'cidade':
        return {
          perguntas: [t('cidade.pergunta', { uf: canal?.uf.toUpperCase() ?? '', estado: canal?.nome ?? '' })],
          campo: {
            placeholder: t('cidade.dica'),
            autoComplete: 'address-level2',
            max: 60,
            inicial: local.cidadeInformada ?? '',
            validar: (v) => (v.trim().length < 2 ? t('cidade.erro') : null),
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
              fora.length ? t('sacola.fora', { onde: cidade ?? canal?.nome ?? 'teu estado' }) : t('sacola.vazia'),
            ],
            chips: [
              {
                rotulo: t('sacola.verMercado'),
                acao: () => {
                  fechar()
                  setTimeout(() => rolarPara('#catalogo', -70), 320)
                },
              },
              { rotulo: t('sacola.encomendar'), acao: () => abrir('encomenda') },
            ],
          }
        }
        return {
          perguntas: [
            t('sacola.confere'),
            <div className="dm-cartao" key="sacola">
              <ListaSacola compacta />
            </div>,
          ],
          chips: [
            { rotulo: t('sacola.certo'), acao: () => resp({}, 'sacola', 'nome') },
            { rotulo: t('sacola.mexer'), acao: () => setSacola(true) },
          ],
          resposta: t('sacola.certo'),
        }
      }
      case 'nome':
      case 'enc-nome':
        return {
          perguntas: [t('nome.pergunta')],
          chips: sugestaoNome ? [{ rotulo: sugestaoNome, acao: () => resp({ nome: sugestaoNome }, p, p === 'nome' ? 'endereco' : 'enc-resumo') }] : undefined,
          campo: {
            placeholder: t('nome.dica'),
            autoComplete: 'name',
            max: 60,
            validar: (v) => (v.trim().length < 2 ? t('nome.erro') : null),
            enviar: (v) => resp({ nome: v.trim() }, p, p === 'nome' ? 'endereco' : 'enc-resumo'),
          },
          resposta: nome,
        }
      case 'endereco': {
        const temAnterior = respostas.rua && respostas.numero && respostas.ufCep === canal?.uf
        const chips: Chip[] = []
        // os endereços guardados na conta da loja, do estado do atendimento (até 3; o mesmo da resposta de antes não repete)
        const anterior = temAnterior ? `${respostas.cep}|${respostas.numero}` : respostas.enderecoLivre
        for (const e of enderecosConta.filter((x) => x.uf === canal?.uf && (x.cep ? `${x.cep}|${x.numero}` : x.livre) !== anterior).slice(0, 3)) {
          const linha = e.cep ? `${e.rua}, ${e.numero}` : e.livre
          chips.push({
            rotulo: e.apelido ? `${e.apelido}: ${linha}` : linha,
            acao: () =>
              e.cep
                ? resp({ cep: e.cep, rua: e.rua, numero: e.numero, bairro: e.bairro, cidadeCep: e.cidade, ufCep: e.uf, enderecoLivre: '' }, 'endereco', 'pagamento')
                : resp({ cep: '', rua: '', numero: '', bairro: '', enderecoLivre: e.livre }, 'endereco', 'pagamento'),
          })
        }
        if (temAnterior) {
          chips.push({ rotulo: `${respostas.rua}, ${respostas.numero}`, acao: () => resp({}, 'endereco', 'pagamento') })
        } else if (respostas.cep && respostas.ufCep === canal?.uf) {
          chips.push({ rotulo: `CEP ${formatarCep(respostas.cep)}`, acao: () => resp({}, 'endereco', respostas.rua ? 'numero' : 'rua') })
        } else if (respostas.enderecoLivre && !respostas.cep) {
          chips.push({ rotulo: respostas.enderecoLivre, acao: () => resp({}, 'endereco', 'pagamento') })
        }
        chips.push({ rotulo: t('endereco.semCep'), acao: () => resp({ cep: '', rua: '', bairro: '', numero: '' }, 'endereco', 'rua') })
        return {
          perguntas: [t('endereco.pergunta', { nome: chamar })],
          chips,
          campo: {
            placeholder: t('endereco.dica'),
            modo: 'numeric',
            autoComplete: 'postal-code',
            max: 9,
            mascara: formatarCep,
            validar: (v) => (soDigitos(v).length !== 8 ? t('endereco.erro') : null),
            enviar: (v) => void enviarCep(v),
          },
          resposta: respostas.cep ? formatarCep(respostas.cep) : t('endereco.semCep'),
        }
      }
      case 'numero':
        return {
          perguntas: [
            t('numero.pergunta', {
              endereco: `${respostas.rua}${respostas.bairro ? `, ${respostas.bairro}` : ''}`,
              cidade: respostas.cidadeCep,
              uf: respostas.ufCep.toUpperCase(),
            }),
          ],
          campo: {
            placeholder: t('numero.dica'),
            autoComplete: 'address-line2',
            max: 60,
            inicial: respostas.numero,
            validar: (v) => (!v.trim() ? t('numero.erro') : null),
            enviar: (v) => resp({ numero: v.trim() }, 'numero', 'pagamento'),
          },
          resposta: respostas.numero,
        }
      case 'rua':
        return {
          perguntas: [respostas.cep && !respostas.rua ? t('rua.cepDaCidade', { cidade: respostas.cidadeCep }) : t('rua.pergunta')],
          campo: {
            placeholder: t('rua.dica'),
            autoComplete: 'street-address',
            max: 140,
            inicial: respostas.enderecoLivre,
            validar: (v) => (v.trim().length < 6 ? t('rua.erro') : null),
            enviar: (v) => resp({ enderecoLivre: v.trim(), rua: '', numero: '' }, 'rua', 'pagamento'),
          },
          resposta: respostas.enderecoLivre,
        }
      case 'pagamento': {
        const opcoes = canal?.pagamento.opcoes ?? (['pix', 'dinheiro', 'cartao'] as FormaPagamento[])
        return {
          perguntas: [
            <span key="p">
              {t('pagamento.pergunta', { nome: chamar })} <Demo ativo={!!canal?.pagamento.demo} />
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
          perguntas: [t('troco.pergunta')],
          chips: [{ rotulo: t('troco.sem'), acao: () => resp({ troco: null }, 'troco', 'obs') }],
          campo: {
            placeholder: t('troco.dica'),
            modo: 'decimal',
            max: 10,
            validar: (v) => {
              const n = Number(v.replace(/[^\d,.]/g, '').replace(',', '.'))
              return !Number.isFinite(n) || n <= 0 ? t('troco.erro') : null
            },
            enviar: (v) => resp({ troco: Number(v.replace(/[^\d,.]/g, '').replace(',', '.')) }, 'troco', 'obs'),
          },
          resposta: respostas.troco ? t('troco.resposta', { valor: brl(respostas.troco) }) : t('troco.sem'),
        }
      case 'obs':
        return {
          perguntas: [t('obs.pergunta', { nome: chamar })],
          chips: [{ rotulo: t('obs.sem'), acao: () => resp({ obs: '' }, 'obs', 'resumo') }],
          campo: {
            placeholder: t('obs.dica'),
            max: 200,
            inicial: respostas.obs,
            enviar: (v) => resp({ obs: v.trim() }, 'obs', 'resumo'),
          },
          resposta: respostas.obs || t('obs.sem'),
        }
      case 'enc-produto':
        return {
          perguntas: [t('enc.produto')],
          campo: {
            placeholder: t('enc.produto.dica'),
            max: 120,
            inicial: respostas.encProduto,
            // tabaco e vape a loja não traz (Anvisa): nem chega no WhatsApp
            validar: (v) => (v.trim().length < 2 ? t('enc.produto.erro') : termoProibido(v) ? t('enc.produto.proibido') : null),
            enviar: (v) => resp({ encProduto: v.trim() }, 'enc-produto', 'enc-qtd'),
          },
          resposta: respostas.encProduto,
        }
      case 'enc-qtd':
        return {
          perguntas: [t('enc.qtd')],
          chips: ['1', '2', '3', '6', '12'].map((q) => ({ rotulo: q, acao: () => resp({ encQtd: q }, 'enc-qtd', 'enc-ref') })),
          campo: {
            placeholder: t('enc.qtd.dica'),
            max: 30,
            validar: (v) => (!v.trim() ? t('enc.qtd.erro') : null),
            enviar: (v) => resp({ encQtd: v.trim() }, 'enc-qtd', 'enc-ref'),
          },
          resposta: respostas.encQtd,
        }
      case 'enc-ref':
        return {
          perguntas: [t('enc.ref')],
          chips: [{ rotulo: t('enc.ref.pular'), acao: () => resp({ encRef: '' }, 'enc-ref', 'enc-nome') }],
          campo: {
            placeholder: t('enc.ref.dica'),
            max: 300,
            inicial: respostas.encRef,
            validar: (v) => (termoProibido(v) ? t('enc.produto.proibido') : null),
            enviar: (v) => resp({ encRef: v.trim() }, 'enc-ref', 'enc-nome'),
          },
          resposta: respostas.encRef || t('enc.ref.sem'),
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
          {/* o chat é só pedido: dúvida de outro tipo vai pra DM do estado (sem estado, a primeira pergunta já é ele) */}
          {canal && (
            <a className="dm-duvida" href={linkDM(canal)} target={alvoDeSaida()} rel="noopener noreferrer">
              <Icone nome="instagram" tamanho={16} className="dm-duvida-icone" />
              {desenhar(falaEmPedacos('duvida.instagram', { instagram: `@${canal.instagram}` }), {
                instagram: (v) => <span className="dm-duvida-arroba">{v}</span>,
              })}
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
            <p className="dm-bolha dm-eu">{t(produtosCitados.length > 1 ? 'sacola.queroVarios' : 'sacola.quero')}</p>
          </div>
        )}

        {/* o troco só aparece no dinheiro (o "Trocar pra Pix" do resumo muda o pagamento sem mexer nos passos feitos) */}
        {feitos.filter((p) => p !== 'troco' || respostas.pagamento === 'dinheiro').map((p) => {
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
            {buscandoCep && <BolhaLoja>{t('cep.procurando')}</BolhaLoja>}
            {avisoCep?.tipo === 'nao-achei' && <BolhaLoja>{t('cep.naoAchei')}</BolhaLoja>}
            {avisoCep?.tipo === 'fora-do-ar' && <BolhaLoja>{t('cep.foraDoAr')}</BolhaLoja>}
            {avisoCep?.tipo === 'outra-uf' && (
              <BolhaLoja>{t('cep.outroEstado', { cidade: avisoCep.end.cidade, uf: avisoCep.end.uf.toUpperCase(), ufAtendimento: canal?.uf.toUpperCase() ?? '' })}</BolhaLoja>
            )}
            <Chips
              chips={
                avisoCep?.tipo === 'outra-uf'
                  ? [
                      ...(canalDa(avisoCep.end.uf)
                        ? [
                            {
                              rotulo: t('cep.trocar', { uf: avisoCep.end.uf.toUpperCase() }),
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
                      { rotulo: t('cep.esseMesmo'), acao: () => aplicarCep(avisoCep.end) },
                      { rotulo: t('cep.outro'), acao: () => setAvisoCep(null) },
                    ]
                  : avisoCep?.tipo === 'nao-achei' || avisoCep?.tipo === 'fora-do-ar'
                    ? [{ rotulo: t('cep.digitar'), acao: () => resp({ cep: '', rua: '', bairro: '', numero: '' }, 'endereco', 'rua') }]
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
            pagamento={respostas.pagamento}
            nome={primeiroNome(respostas.nome)}
            enviadoEm={enviadoEm}
            enviouAqui={enviouAqui}
            aoEnviar={() => {
              setEnviouAqui(true)
              marcarEnviado(Date.now())
              // a cópia do pedido vai pro servidor da loja junto com o toque (sem segurar o link do WhatsApp)
              const corpo = corpoDoPedido()
              if (corpo) {
                enviarPedido(corpo)
                marcarPedidoEnviado(mensagem)
              }
            }}
            naoConsegui={() => marcarEnviado(null)}
            // "Trocar pra Pix" da resposta do Pix em breve: muda o pagamento sem refazer os passos
            trocarPraPix={() => useChat.setState((st) => ({ respostas: { ...st.respostas, pagamento: 'pix', troco: null } }))}
            editar={(p) => voltarPara(p)}
            cupom={
              modo === 'pedido' && cupom && situacaoCupom
                ? { codigo: cupom.codigo, titulo: nomeDoPremio(cupom.retrato), situacao: situacaoCupom, exemplo: cupom.demo && config.carimboDeExemplo }
                : null
            }
            sugerido={sugerido ? { codigo: sugerido.codigo, titulo: nomeDoPremio(sugerido.retrato), exemplo: sugerido.demo && config.carimboDeExemplo } : null}
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

/** Os pedaços de uma fala na tela; o marcador com cara própria (o @ que encolhe, o código em pixel) vira o elemento dele. */
function desenhar(pedacos: Pedaco[], estilos: Record<string, (valor: string) => ReactNode> = {}): ReactNode[] {
  return pedacos.map((x, i) => ('texto' in x ? x.texto : <Fragment key={i}>{estilos[x.marcador]?.(x.valor) ?? x.valor}</Fragment>))
}

const codigoPixel = (v: string) => <span className="px px-16">{v}</span>

function Chips({ chips }: { chips: Chip[] }) {
  if (!chips.length) return null
  return (
    <div className="dm-chips" role="group" aria-label="Respostas rápidas">
      {chips.map((c, i) => (
        <button key={`${i}·${c.rotulo}`} type="button" className="dm-chip toque" onClick={c.acao}>
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
  pagamento,
  nome,
  enviadoEm,
  enviouAqui,
  aoEnviar,
  naoConsegui,
  trocarPraPix,
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
  /** Forma de pagamento escolhida no pedido (a resposta do "Pix em breve" muda quando não é Pix). */
  pagamento: FormaPagamento | null
  /** Primeiro nome de quem pede (marcador {nome} das falas). */
  nome: string
  enviadoEm: number | null
  enviouAqui: boolean
  aoEnviar: () => void
  naoConsegui: () => void
  /** Muda o pagamento pra Pix ali mesmo, sem sair do resumo. */
  trocarPraPix: () => void
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
  const { t, p } = useFala()
  const [naoAbriu, setNaoAbriu] = useState(false)
  // "Sem cupom" esconde a pergunta até sair do resumo
  const [semCupom, setSemCupom] = useState(false)
  // "Pagar com Pix aqui no site" ainda não existe: cada toque (n) mostra a resposta da loja. Com Pix escolhido, o foco
  // volta pro WhatsApp. Com outro pagamento (era), a loja oferece "Trocar pra Pix" e o WhatsApp só ganha o foco depois
  // da troca: ninguém manda o pedido no cartão achando que vai pagar no Pix.
  const [pix, setPix] = useState<{ n: number; era: FormaPagamento | null; trocou: boolean } | null>(null)
  const zap = useRef<HTMLAnchorElement>(null)
  const respostaPix = useRef<HTMLDivElement>(null)
  const aceitaPix = canal.pagamento.opcoes.includes('pix')
  const cupomOk = cupom?.situacao.tipo === 'ok'
  const numero = celularNoCampo(whatsappDoCanal(canal))
  // no celular o link troca de app sem nova aba; no computador ou dentro de iframe, nova aba
  const alvo = alvoDeSaida()
  const tocou = () => {
    aoEnviar()
    setNaoAbriu(false)
    if (!alvo) {
      window.setTimeout(() => {
        if (document.visibilityState === 'visible') setNaoAbriu(true)
      }, 1600)
    }
  }

  // depois do toque no Pix (sem sair do site): oferecendo a troca, a resposta entra à vista e o foco vai pro "Trocar pra
  // Pix"; com Pix, o WhatsApp e a resposta entram à vista e o WhatsApp ganha o foco e o realce
  useEffect(() => {
    const caixa = respostaPix.current
    const a = zap.current
    if (!pix || !caixa || !a) return
    if (pix.era !== 'pix' && !pix.trocou) {
      mostrarNaFolha(caixa, caixa)
      caixa.querySelector<HTMLButtonElement>('.dm-chip')?.focus({ preventScroll: true })
      return
    }
    mostrarNaFolha(a, caixa)
    a.focus({ preventScroll: true })
    a.classList.remove('dm-realce')
    void a.offsetWidth // recomeça o realce a cada toque
    a.classList.add('dm-realce')
    const t = window.setTimeout(() => a.classList.remove('dm-realce'), 1800)
    return () => clearTimeout(t)
  }, [pix])

  return (
    <div className="dm-troca dm-atual">
      <BolhaLoja>{t(encomenda ? 'enc.resumo' : 'resumo.pedido', { nome })}</BolhaLoja>
      <pre className="dm-mensagem" aria-label="Mensagem que vai pro WhatsApp">
        {mensagem}
      </pre>
      {cupom && cupomOk && (
        <BolhaLoja>
          {desenhar(p('cupom.vale', { cupom: cupom.codigo }), { cupom: codigoPixel })}
          {cupom.exemplo && <> <span className="carimbo">exemplo</span></>}
        </BolhaLoja>
      )}
      {cupom && !cupomOk && !enviadoEm && (
        <>
          <BolhaLoja>{desenhar(p('cupom.naoVale', { cupom: cupom.codigo, motivo: motivoCurto(cupom.situacao, lugar) }), { cupom: codigoPixel })}</BolhaLoja>
          <Chips
            chips={[
              { rotulo: t('cupom.tirar'), acao: tirarCupom },
              { rotulo: t('sacola.mexer'), acao: mexerSacola },
            ]}
          />
        </>
      )}
      {!cupom && sugerido && !semCupom && !enviadoEm && (
        <>
          <BolhaLoja>
            {desenhar(p('cupom.sugerir', { cupom: sugerido.codigo, premio: sugerido.titulo }), { cupom: codigoPixel })}
            {sugerido.exemplo && <> <span className="carimbo">exemplo</span></>}
          </BolhaLoja>
          <Chips
            chips={[
              { rotulo: t('cupom.usar'), acao: () => aplicarCupom(sugerido.codigo) },
              { rotulo: t('cupom.sem'), acao: () => setSemCupom(true) },
            ]}
          />
        </>
      )}
      <BolhaLoja>{t('resumo.fechar', { nome })}</BolhaLoja>
      <div className="dm-acoes">
        {/* ícone dentro do texto: se a linha quebrar (fonte grande no aparelho), ele vai junto da primeira palavra.
            Celular estreito: a encomenda lê "Fechar no WhatsApp" (o "encomenda" sai do nome acessível também) */}
        <a ref={zap} className="botao botao-cheio botao-largo dm-zap" href={linkWhatsApp(canal, mensagem)} target={alvo} rel="noopener noreferrer" onClick={tocou}>
          <span>
            <Icone nome="whatsapp" tamanho={20} className="dm-zap-icone" />
            Fechar {encomenda ? <span className="dm-zap-meio">encomenda </span> : 'pedido '}no WhatsApp
          </span>
        </a>
        {/* encomenda ainda não tem preço: o Pix não se aplica */}
        {!encomenda && aceitaPix && (
          <button
            type="button"
            className="botao botao-contorno botao-largo dm-pix toque"
            onClick={() => setPix((p) => ({ n: (p?.n ?? 0) + 1, era: pagamento, trocou: false }))}
          >
            <Icone nome="pix" tamanho={20} />
            Pagar com Pix aqui no site
            <span className="carimbo dm-embreve">Em breve</span>
          </button>
        )}
      </div>
      {pix && (
        <div key={pix.n} ref={respostaPix} className="dm-resposta-pix">
          {pix.era === 'pix' ? (
            <BolhaLoja>{t('pix.comPix')}</BolhaLoja>
          ) : (
            <>
              <BolhaLoja>{t('pix.outroPagamento')}</BolhaLoja>
              {pix.trocou ? (
                <>
                  <p className="dm-bolha dm-eu">{t('pix.trocar')}</p>
                  <BolhaLoja>{t('pix.trocou')}</BolhaLoja>
                </>
              ) : (
                <Chips
                  chips={[
                    {
                      rotulo: t('pix.trocar'),
                      acao: () => {
                        trocarPraPix()
                        setPix((p) => p && { ...p, trocou: true })
                      },
                    },
                  ]}
                />
              )}
            </>
          )}
        </div>
      )}
      {naoAbriu && (
        <>
          <BolhaLoja>{desenhar(p('resumo.naoAbriu', { numero }), { numero: (v) => <span className="dm-numero">{v}</span> })}</BolhaLoja>
          <Chips
            chips={[
              {
                rotulo: t('resumo.copiar'),
                acao: () => avisar(copiarTexto(mensagem) ? 'Copiado.' : 'Segura no texto do pedido e copia.'),
              },
            ]}
          />
        </>
      )}
      {enviadoEm && (
        <>
          {/* com o "Não abriu?" na tela, não dá pra dizer que a mensagem já tá no WhatsApp */}
          <BolhaLoja>{t(enviouAqui && !naoAbriu ? 'resumo.prontoNoZap' : 'resumo.jaMandou')}</BolhaLoja>
          <BolhaLoja>{t('resumo.marca', { instagram: `@${canal.instagram}` })}</BolhaLoja>
          <Chips
            chips={[
              { rotulo: t('resumo.mandei'), acao: mandei },
              { rotulo: t('resumo.naoConsegui'), acao: naoConsegui },
            ]}
          />
        </>
      )}
      {!enviadoEm && (
        <Chips
          chips={
            encomenda
              ? [
                  { rotulo: t('enc.mudarProduto'), acao: () => editar('enc-produto') },
                  { rotulo: t('enc.mudarQtd'), acao: () => editar('enc-qtd') },
                  { rotulo: t('enc.mudarNome'), acao: () => editar('enc-nome') },
                ]
              : [
                  { rotulo: t('resumo.mudarEndereco'), acao: () => editar('endereco') },
                  { rotulo: t('resumo.mudarPagamento'), acao: () => editar('pagamento') },
                  { rotulo: t('resumo.mudarObs'), acao: () => editar('obs') },
                  ...(cupom && cupomOk ? [{ rotulo: t('cupom.tirar'), acao: tirarCupom }] : []),
                ]
          }
        />
      )}
    </div>
  )
}

/** Rola o corpo da folha o mínimo pra mostrar do topo de `de` ao fim de `ate`; se não couber, `de` fica no topo. */
function mostrarNaFolha(de: HTMLElement, ate: HTMLElement) {
  const corpo = de.closest<HTMLElement>('.folha-corpo')
  if (!corpo) return
  const base = corpo.getBoundingClientRect().top - corpo.scrollTop
  const folga = 16
  const topo = de.getBoundingClientRect().top - base - folga
  const fim = ate.getBoundingClientRect().bottom - base + folga
  const agora = corpo.scrollTop
  const h = corpo.clientHeight
  const alvo = fim - topo > h || topo < agora ? topo : fim > agora + h ? fim - h : agora
  if (Math.abs(alvo - agora) > 1) corpo.scrollTo({ top: alvo, behavior: movimentoReduzido() ? 'auto' : 'smooth' })
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
