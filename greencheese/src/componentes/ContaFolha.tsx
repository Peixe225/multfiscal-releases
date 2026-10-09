import { useEffect, useRef, useState } from 'react'
import { config } from '../dados/config'
import { interativoPorId, interativosEmBreve } from '../interativos/registro'
import { Regras } from '../interativos/sorte/Regras'
import { ID_SORTE, useEstadoSorte, usarNoPedido } from '../interativos/sorte/estado'
import { T } from '../interativos/sorte/textos'
import { primeiroNome, useConta, useCupons, type CupomComStatus } from '../lib/conta'
import { conta as adaptador } from '../lib/conta-adaptador'
import { useModoConta } from '../lib/conta-modo'
import { useContaStore } from '../store/conta'
import { formatarDiaMes, formatarEspera } from '../lib/cupom'
import { fraseDoPremio, nomeDoPremio } from '../lib/cupom-uso'
import { AdesivoCodigo, AdesivoContagem, BolhaPremio } from '../interativos/sorte/Adesivos'
import { Condicoes, listaCondicoes } from '../interativos/sorte/Condicoes'
import { depoisDoHistorico } from '../lib/historico'
import { mascararCelular } from '../lib/telefone'
import { useLocal } from '../store/local'
import { useSacola } from '../store/sacola'
import { useUI } from '../store/ui'
import { Icone } from './comum'
import { Folha } from './Folha'
import { FormConta } from './FormConta'
import { SecaoEnderecos, SecaoMeusDados, SecaoPedidos, SecaoVagas, useAtualizarConta } from './ContaServidor'
import './ContaFolha.css'

// "Minha conta": cupons guardados, giro de hoje, próximos interativos e os dados. Com a conta no aparelho, tudo fica
// só aqui. Com a conta na loja (modo servidor), também os pedidos, as vagas de rateio, os endereços e o arquivo com
// os dados; e a folha abre sem conta pra entrar (WhatsApp + código).

export function ContaFolha() {
  const aberta = useUI((s) => s.contaAberta)
  const setConta = useUI((s) => s.setConta)
  const conta = useConta()
  const servidor = useModoConta() === 'servidor'
  const fechar = () => setConta(false)
  // sem conta só abre pra entrar na conta da loja; com a conta do aparelho, saiu ou apagou com a folha aberta: fecha
  const ativa = aberta && (!!conta || servidor)
  useEffect(() => {
    if (aberta && !conta && !servidor) setConta(false)
  }, [aberta, conta, servidor, setConta])
  return (
    <Folha id="conta" aberta={ativa} aoFechar={fechar} rotulo="Minha conta" cabecalho={<span>{T.minhaConta}</span>}>
      {conta ? <Conteudo fechar={fechar} /> : servidor ? <Entrar /> : null}
    </Folha>
  )
}

/** Sem conta, no modo servidor: entrar (ou criar) com o WhatsApp e o código, dentro da folha. */
function Entrar() {
  const [modo, setModo] = useState<'entrar' | 'criar'>('entrar')
  const raiz = useRef<HTMLDivElement>(null)
  useEffect(() => {
    raiz.current?.querySelector<HTMLElement>('.form-titulo')?.focus()
  }, [modo])
  return (
    <div ref={raiz} className="conta conta-entrar">
      <FormConta key={modo} modo={modo} tituloMenor aoSucesso={() => undefined} aoTrocarModo={setModo} />
    </div>
  )
}

function Conteudo({ fechar }: { fechar: () => void }) {
  const conta = useConta()!
  const cupons = useCupons()
  const r = useEstadoSorte()
  const avisar = useUI((s) => s.avisar)
  const [editando, setEditando] = useState(false)
  const [apagando, setApagando] = useState(false)
  // a conta aberta é a da loja (não só do aparelho)
  const naLoja = useContaStore((s) => !!s.servidor && s.servidor === s.atual)
  // o botão tocado some com a troca de tela: o foco vai pro que entrou (sem isto cairia no <body>)
  const raiz = useRef<HTMLDivElement>(null)
  const focarAlvo = useRef<string | null>(null)
  const trocar = (f: () => void, alvo: string) => {
    focarAlvo.current = alvo
    f()
  }
  useEffect(() => {
    const alvo = focarAlvo.current
    if (!alvo) return
    focarAlvo.current = null
    raiz.current?.querySelector<HTMLElement>(alvo)?.focus({ preventScroll: false })
  }, [editando, apagando])
  const ativos = cupons.filter((c) => c.status === 'ativo')
  const emBreve = interativosEmBreve()
  // estado sem atendimento (ou sem prêmio): o jogo não abre, então nada de "Girar" aqui
  useLocal((s) => s.uf)
  const jogoAtivo = interativoPorId(ID_SORTE)?.ativo() ?? false

  const girar = () => {
    fechar()
    depoisDoHistorico(() => useUI.getState().abrirInterativo(ID_SORTE))
  }

  return (
    <div ref={raiz} className="conta">
      <section className="conta-oi">
        <p className="conta-nome" data-foco-inicial tabIndex={-1}>
          {T.oi(primeiroNome(conta.nome))}
        </p>
        <p className="legenda">{T.zapLegenda(mascararCelular(conta.whatsapp))}</p>
      </section>

      <p className="conta-aviso">{naLoja ? T.avisoContaServidor : T.avisoContaLocal}</p>

      {jogoAtivo && (
        <section className="conta-secao" aria-labelledby="conta-giro">
          <h3 id="conta-giro" className="conta-titulo">
            {T.giroDeHoje}
          </h3>
          {r.giro.disponivel ? (
            <div className="conta-giro">
              <p>{T.liberadoHoje}</p>
              <button type="button" className="botao botao-cheio" onClick={girar}>
                <Icone nome="dichavador" tamanho={16} />
                {T.girarDichavador}
              </button>
            </div>
          ) : (
            <p className="conta-giro-txt">{T.usadoHoje(r.giro.motivo === 'ja-girou-hoje' ? formatarEspera(r.giro.proximoEm - r.agora) : 'amanhã')}</p>
          )}
        </section>
      )}

      <section className="conta-secao" aria-labelledby="conta-cupons">
        <h3 id="conta-cupons" className="conta-titulo">
          {T.teusCupons(ativos.length)}
        </h3>
        {cupons.length === 0 ? (
          <div className="conta-vazio">
            <p>{T.vazio}</p>
            {jogoAtivo && r.giro.disponivel && (
              <button type="button" className="botao botao-contorno" onClick={girar}>
                {T.girar}
              </button>
            )}
          </div>
        ) : (
          <ul className="conta-cupons">
            {cupons.map((c) => (
              <li key={c.codigo}>
                <Ingresso c={c} fechar={fechar} agora={r.agora} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {naLoja && (
        <>
          <AtualizarConta />
          <SecaoPedidos />
          <SecaoVagas fechar={fechar} />
          <SecaoEnderecos />
        </>
      )}

      {emBreve.length > 0 && (
        <section className="conta-secao" aria-labelledby="conta-proximos">
          <h3 id="conta-proximos" className="conta-titulo">
            {T.proximos}
          </h3>
          <ul className="conta-proximos">
            {emBreve.map((i) => (
              <li key={i.id} className="conta-travado">
                <span className="conta-travado-bola" aria-hidden="true">
                  <Icone nome="cadeado" tamanho={16} />
                </span>
                <span className="conta-travado-rot">???</span>
                <span className="carimbo">{T.emBreve}</span>
              </li>
            ))}
          </ul>
          <p className="legenda">{T.vemMais}</p>
        </section>
      )}

      <section className="conta-secao" aria-labelledby="conta-dados">
        {editando ? (
          <FormConta
            modo="editar"
            idTitulo="conta-dados"
            aoSucesso={() => trocar(() => setEditando(false), '[data-conta-editar]')}
            aoCancelar={() => trocar(() => setEditando(false), '[data-conta-editar]')}
          />
        ) : (
          <>
            <h3 id="conta-dados" className="conta-titulo">
              {T.teusDados}
            </h3>
            <dl className="conta-dados">
              <div>
                <dt className="sr-only">{T.teuNome}</dt>
                <dd>{conta.nome}</dd>
              </div>
              <div>
                <dt className="sr-only">{T.teuZap}</dt>
                <dd>{mascararCelular(conta.whatsapp)}</dd>
              </div>
              <div>
                <dt className="sr-only">Promoções</dt>
                <dd>{T.promoLigadas(conta.aceitaPromo)}</dd>
              </div>
            </dl>
            <button type="button" className="botao botao-contorno" data-conta-editar onClick={() => trocar(() => setEditando(true), '#conta-dados')}>
              {T.editar}
            </button>
          </>
        )}
      </section>

      <section className="conta-secao conta-sair">
        <button
          type="button"
          className="botao botao-contorno botao-largo"
          onClick={async () => {
            await adaptador.sair()
            avisar(T.saiu)
            fechar()
          }}
        >
          {T.sair}
        </button>
        <p className="legenda">{naLoja ? T.sairLegendaServidor : T.sairLegenda}</p>
        {!apagando ? (
          <button type="button" className="botao-texto toque" data-conta-apagar onClick={() => trocar(() => setApagando(true), '[data-conta-pergunta]')}>
            {naLoja ? T.apagarContaServidor : T.apagarConta}
          </button>
        ) : (
          <div className="conta-apagar" role="group" aria-label={naLoja ? T.apagarContaServidor : T.apagarConta}>
            <p tabIndex={-1} data-conta-pergunta>
              {naLoja ? T.apagarPerguntaServidor : T.apagarPergunta}
            </p>
            <div className="conta-apagar-botoes">
              <button
                type="button"
                className="botao botao-cheio"
                onClick={async () => {
                  const res = await adaptador.apagar()
                  if (!res.ok) {
                    avisar(T.naoApagou)
                    return
                  }
                  avisar(naLoja ? T.apagadaServidor : T.apagada)
                  fechar()
                }}
              >
                {T.apagar}
              </button>
              <button type="button" className="botao botao-contorno" onClick={() => trocar(() => setApagando(false), '[data-conta-apagar]')}>
                {T.cancelar}
              </button>
            </div>
          </div>
        )}
      </section>

      {naLoja && <SecaoMeusDados />}

      <section className="conta-secao">
        <Regras rotulo={T.regras} />
      </section>
    </div>
  )
}

/** Relê a conta da loja quando a Minha conta abre (sem desenho). */
function AtualizarConta() {
  useAtualizarConta()
  return null
}

/**
 * Cupom no molde do story do prêmio (cartão escuro): a bolinha de story dos Melhores amigos com o produto (anel cinza
 * quando já foi usado ou venceu, como story visto), o destaque em pixel, o adesivo do código (tocar copia) e o da
 * contagem da validade; as condições fechadas no "Ver condições".
 */
function Ingresso({ c, fechar, agora }: { c: CupomComStatus; fechar: () => void; agora: number }) {
  const aplicado = useSacola((s) => s.cupom === c.codigo)
  const tirar = useSacola((s) => s.tirarCupom)
  // o produto do herói: no brinde, o que vem de brinde (o mesmo "Ver produto" do story)
  const { destaque, alvo: nome, produto: alvo } = fraseDoPremio(c.retrato)
  const exemplo = c.demo && config.carimboDeExemplo
  const ativo = c.status === 'ativo'
  const condicoes = listaCondicoes({ regra: c.retrato.regra, comoUsar: c.retrato.comoUsar, validade: null })
  return (
    <article className={`ingresso ingresso-${c.status}`} aria-label={`Cupom ${c.codigo}: ${nomeDoPremio(c.retrato)}`}>
      <div className="ingresso-topo">
        <BolhaPremio produto={alvo} tamanho={56} vista={!ativo} />
        <p className="ingresso-titulo">
          <span className="ingresso-destaque px">{destaque}</span>
          <span className="sr-only">: </span>
          <span className="ingresso-alvo">{nome}</span>
        </p>
        {exemplo && <span className="ingresso-exemplo carimbo">{T.exemplo}</span>}
      </div>
      <div className="ingresso-adesivos">
        <AdesivoCodigo codigo={c.codigo} apagado={!ativo} />
        {ativo && <AdesivoContagem validoAte={c.validoAte} agora={agora} />}
        {c.status === 'usado' && <span className="ingresso-carimbo px">{T.usado(formatarDiaMes(c.usadoEm ?? agora))}</span>}
        {c.status === 'vencido' && <span className="ingresso-carimbo px">{T.venceu}</span>}
      </div>
      <Condicoes
        className="ingresso-cond"
        itens={condicoes}
        lado={
          alvo && (
            <button
              type="button"
              className="ingresso-link toque"
              onClick={() => {
                // a página do produto fica abaixo das folhas: a conta sai do histórico primeiro
                fechar()
                depoisDoHistorico(() => useUI.getState().abrirPagina(alvo.id, 'link'))
              }}
            >
              {T.verProduto}
            </button>
          )
        }
      />
      {(ativo || c.status === 'encerrado') && (
        <div className="ingresso-acao">
          {ativo &&
            (aplicado ? (
              <>
                <span className="ingresso-na-sacola">{T.naSacola}</span>
                <button type="button" className="botao botao-contorno ingresso-botao" onClick={tirar}>
                  {T.tirar}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="botao botao-cheio ingresso-botao"
                onClick={() => {
                  fechar()
                  usarNoPedido(c.codigo)
                }}
              >
                {T.usarNoPedido}
              </button>
            ))}
          {c.status === 'encerrado' && <span className="legenda">{T.encerrado}</span>}
        </div>
      )}
    </article>
  )
}
