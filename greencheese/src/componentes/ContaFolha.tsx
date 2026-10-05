import { useEffect, useState } from 'react'
import { TONS_PAPEL } from '../arte/realista/beck'
import { config } from '../dados/config'
import { interativosEmBreve } from '../interativos/registro'
import { Regras } from '../interativos/sorte/Regras'
import { ID_SORTE, useEstadoSorte } from '../interativos/sorte/estado'
import { T } from '../interativos/sorte/textos'
import { conta as adaptador, primeiroNome, useConta, useCupons, type CupomComStatus } from '../lib/conta'
import { copiarTexto } from '../lib/copiar'
import { alvosDo, formatarDiaMes, formatarEspera, formatarFalta, formatarValidade, valePra } from '../lib/cupom'
import { depoisDoHistorico } from '../lib/historico'
import { mascararCelular } from '../lib/telefone'
import { useSacola } from '../store/sacola'
import { useUI } from '../store/ui'
import { Icone } from './comum'
import { Folha } from './Folha'
import { FormConta } from './FormConta'
import './ContaFolha.css'

// "Minha conta": cupons guardados, giro de hoje, próximos interativos e os dados. Na prévia, tudo só neste aparelho.

export function ContaFolha() {
  const aberta = useUI((s) => s.contaAberta)
  const setConta = useUI((s) => s.setConta)
  const conta = useConta()
  const fechar = () => setConta(false)
  // sem conta não abre (as entradas nem aparecem); saiu ou apagou com a folha aberta: fecha
  const ativa = aberta && !!conta
  useEffect(() => {
    if (aberta && !conta) setConta(false)
  }, [aberta, conta, setConta])
  return (
    <Folha id="conta" aberta={ativa} aoFechar={fechar} rotulo="Minha conta" cabecalho={<span>{T.minhaConta}</span>}>
      {conta && <Conteudo fechar={fechar} />}
    </Folha>
  )
}

function Conteudo({ fechar }: { fechar: () => void }) {
  const conta = useConta()!
  const cupons = useCupons()
  const r = useEstadoSorte()
  const avisar = useUI((s) => s.avisar)
  const [editando, setEditando] = useState(false)
  const [apagando, setApagando] = useState(false)
  const ativos = cupons.filter((c) => c.status === 'ativo')
  const emBreve = interativosEmBreve()

  const girar = () => {
    fechar()
    depoisDoHistorico(() => useUI.getState().abrirInterativo(ID_SORTE))
  }

  return (
    <div className="conta">
      <section className="conta-oi">
        <p className="conta-nome" data-foco-inicial tabIndex={-1}>
          {T.oi(primeiroNome(conta.nome))}
        </p>
        <p className="legenda">{T.zapLegenda(mascararCelular(conta.whatsapp))}</p>
      </section>

      {config.modoPrevia && <p className="conta-aviso">{T.avisoPreviaConta}</p>}

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

      <section className="conta-secao" aria-labelledby="conta-cupons">
        <h3 id="conta-cupons" className="conta-titulo">
          {T.teusCupons(ativos.length)}
        </h3>
        {cupons.length === 0 ? (
          <div className="conta-vazio">
            <p>{T.vazio}</p>
            {r.giro.disponivel && (
              <button type="button" className="botao botao-contorno" onClick={girar}>
                {T.girar}
              </button>
            )}
          </div>
        ) : (
          <ul className="conta-cupons">
            {cupons.map((c) => (
              <li key={c.codigo}>
                <Ingresso c={c} fechar={fechar} agora={r.agora} avisar={avisar} />
              </li>
            ))}
          </ul>
        )}
      </section>

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
          <FormConta modo="editar" idTitulo="conta-dados" aoSucesso={() => setEditando(false)} aoCancelar={() => setEditando(false)} />
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
            <button type="button" className="botao botao-contorno" onClick={() => setEditando(true)}>
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
        <p className="legenda">{T.sairLegenda}</p>
        {!apagando ? (
          <button type="button" className="botao-texto toque" onClick={() => setApagando(true)}>
            {T.apagarConta}
          </button>
        ) : (
          <div className="conta-apagar" role="group" aria-label={T.apagarConta}>
            <p>{T.apagarPergunta}</p>
            <div className="conta-apagar-botoes">
              <button
                type="button"
                className="botao botao-cheio"
                onClick={async () => {
                  await adaptador.apagar()
                  avisar(T.apagada)
                  fechar()
                }}
              >
                {T.apagar}
              </button>
              <button type="button" className="botao botao-contorno" onClick={() => setApagando(false)}>
                {T.cancelar}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="conta-secao">
        <Regras rotulo={T.regras} />
      </section>
    </div>
  )
}

/** Cupom no formato de ingresso de papel (a cor do papel do prêmio). */
function Ingresso({ c, fechar, agora, avisar }: { c: CupomComStatus; fechar: () => void; agora: number; avisar: (t: string) => void }) {
  const aplicado = useSacola((s) => s.cupom === c.codigo)
  const aplicar = useSacola((s) => s.aplicarCupom)
  const tirar = useSacola((s) => s.tirarCupom)
  const tons = TONS_PAPEL[c.retrato.papel]
  const alvo = alvosDo(c.retrato)[0]
  const exemplo = c.demo && config.modoPrevia
  const ativo = c.status === 'ativo'
  return (
    <article className={`ingresso ingresso-${c.status}`} style={{ ['--papel' as string]: ativo ? tons.base : '#3a3a3a', ['--papel-escuro' as string]: tons.escuro }} aria-label={`Cupom ${c.codigo}: ${c.retrato.titulo}`}>
      <div className="ingresso-topo">
        <span className="ingresso-codigo px px-20">{c.codigo}</span>
        <button type="button" className="ingresso-copiar toque" onClick={() => avisar(copiarTexto(c.codigo) ? T.copiado : T.naoCopiou)} aria-label={`${T.copiar} o código ${c.codigo}`}>
          <Icone nome="copiar" tamanho={16} />
          {T.copiar}
        </button>
      </div>
      <p className="ingresso-titulo">{c.retrato.titulo}</p>
      <p className="ingresso-regra">{c.retrato.regra}</p>
      {ativo && <p className="ingresso-val">{T.valeAteFalta(formatarValidade(c.validoAte), formatarFalta(c.validoAte, agora))}</p>}
      <p className="ingresso-val">
        {T.valePra(valePra(c.retrato))}
        {alvo && (
          <>
            {' '}
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
          </>
        )}
      </p>
      {c.retrato.comoUsar && <p className="ingresso-como">{c.retrato.comoUsar}</p>}
      <div className="ingresso-acao">
        {c.status === 'ativo' &&
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
                aplicar(c.codigo)
                avisar(T.cupomAplicado(c.codigo))
                fechar()
                depoisDoHistorico(() => useUI.getState().setSacola(true))
              }}
            >
              {T.usarNoPedido}
            </button>
          ))}
        {c.status === 'usado' && <span className="ingresso-carimbo px">{T.usado(formatarDiaMes(c.usadoEm ?? agora))}</span>}
        {c.status === 'vencido' && <span className="ingresso-carimbo px">{T.venceu}</span>}
        {c.status === 'encerrado' && <span className="legenda">{T.encerrado}</span>}
      </div>
      {exemplo && <span className="ingresso-exemplo carimbo">{T.exemplo}</span>}
    </article>
  )
}
