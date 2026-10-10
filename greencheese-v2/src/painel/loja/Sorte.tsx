// Teste minha sorte: ligar ou desligar o jogo no site, as regras (giros sem conta, giros por dia com conta, quanto
// tempo o prêmio de quem não tem conta fica guardado) e os prêmios, cada um com "no jogo" num toque e a chance de
// sair (só aqui: o site nunca mostra).
import { useEffect, useState } from 'react'
import { ErroApi, mensagemDe } from '../api'
import { Link, Topo } from '../Moldura'
import { caminho } from '../rotas'
import { pegarRecado } from '../telas/flash'
import { useRestaurarRolagem, useTitulo } from '../telas/comum'
import { Aviso, Botao, Campo, Carregando, Ic, Numero, TituloTela } from '../ui'
import * as api from './api'
import { comPremio, guardarLoja, useLoja } from './dados'
import { nomeDoPremio } from './premio-ui'
import type { LojaAdmin, PremioAdmin, RegrasSorte } from './tipos'

function motivoFora(p: PremioAdmin, l: LojaAdmin): string | null {
  if (!p.ativo) return 'fora do jogo'
  if (p.noSite) return null
  const ids = [...(p.aplicaA.produtos ?? []), ...(typeof p.valor === 'object' && 'produto' in p.valor ? [p.valor.produto] : [])]
  const foraDoSite = ids.map((id) => l.produtos.find((x) => x.id === id)).find((x) => !x || !x.ativo)
  if (foraDoSite !== undefined) return foraDoSite ? `${foraDoSite.nome} tá fora do site` : 'o produto não existe mais'
  return 'vale em bebida ou numa categoria que não existe'
}

export function Sorte() {
  useTitulo('Teste minha sorte')
  const leitura = useLoja()
  const l = leitura.dados
  const [regras, setRegras] = useState<{ girosSemConta: string; girosPorDiaComConta: string; reservaSemContaHoras: string } | null>(null)
  const [salvandoRegras, setSalvandoRegras] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [erroRegra, setErroRegra] = useState<Partial<Record<keyof RegrasSorte, string>>>({})
  const [ok, setOk] = useState<string | null>(null)
  const [recado, setRecado] = useState(pegarRecado)
  const [mexendo, setMexendo] = useState<string | null>(null)
  useRestaurarRolagem(!!l)

  useEffect(() => {
    if (l && !regras) setRegras({ girosSemConta: String(l.sorte.girosSemConta), girosPorDiaComConta: String(l.sorte.girosPorDiaComConta), reservaSemContaHoras: String(l.sorte.reservaSemContaHoras) })
  }, [l, regras])

  const salvarSorte = async (c: Partial<RegrasSorte>, frase: string) => {
    setSalvandoRegras(true)
    setErro(null)
    setErroRegra({})
    setOk(null)
    try {
      const r = await api.salvarSorte(c)
      const f = (x: LojaAdmin): LojaAdmin => ({ ...x, versao: r.versao, atualizadoEm: r.atualizadoEm, sorte: { ...x.sorte, ...r.sorte } })
      guardarLoja(f)
      leitura.trocar(f)
      setRegras({ girosSemConta: String(r.sorte.girosSemConta), girosPorDiaComConta: String(r.sorte.girosPorDiaComConta), reservaSemContaHoras: String(r.sorte.reservaSemContaHoras) })
      setOk(frase)
    } catch (e) {
      if (e instanceof ErroApi && e.campo) setErroRegra({ [e.campo]: e.message })
      else setErro(mensagemDe(e))
    } finally {
      setSalvandoRegras(false)
    }
  }

  const ligarPremio = async (p: PremioAdmin) => {
    if (mexendo) return
    setMexendo(p.id)
    setErro(null)
    try {
      const r = await api.salvarPremio({ id: p.id, ativo: !p.ativo })
      guardarLoja((x) => comPremio(x, r.premio, r))
      leitura.trocar((x) => comPremio(x, r.premio, r))
    } catch (e) {
      setErro(mensagemDe(e))
    } finally {
      setMexendo(null)
    }
  }

  if (!l || !regras) {
    return (
      <>
        <Topo voltar={caminho.loja} titulo={<TituloTela>Teste minha sorte</TituloTela>} />
        <div className="pn-pagina">{leitura.erro ? <Aviso tipo="erro">{leitura.erro.message}</Aviso> : <Carregando />}</div>
      </>
    )
  }
  const noJogo = l.sorte.premios.filter((p) => p.noSite)
  const soma = noJogo.reduce((s, p) => s + p.peso, 0)
  const num = (s: string) => (/^\d{1,3}$/.test(s) ? Number(s) : NaN)
  const mudouRegra = num(regras.girosSemConta) !== l.sorte.girosSemConta || num(regras.girosPorDiaComConta) !== l.sorte.girosPorDiaComConta || num(regras.reservaSemContaHoras) !== l.sorte.reservaSemContaHoras

  return (
    <>
      <Topo
        voltar={caminho.loja}
        titulo={<TituloTela>Teste minha sorte</TituloTela>}
        acoes={
          <Link href={caminho.premioNovo} className="pn-botao pn-botao-cheio pn-botao-p pn-so-icone-celular">
            <Ic nome="mais" tamanho={16} />
            <span className="pn-botao-txt">Novo prêmio</span>
          </Link>
        }
      />
      <div className="pn-pagina pn-pagina-estreita">
        {recado && (
          <Aviso tipo="ok" acao={<button type="button" className="icone-botao" aria-label="Fechar o recado" onClick={() => setRecado(null)}><Ic nome="fechar" tamanho={16} /></button>}>
            {recado}
          </Aviso>
        )}
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {ok && <Aviso tipo="ok">{ok}</Aviso>}

        <section className="pn-bloco" aria-labelledby="h-s-jogo">
          <h2 id="h-s-jogo" className="pn-h2">
            No site
          </h2>
          <label className="pn-troca">
            <input type="checkbox" checked={l.sorte.ligado} disabled={salvandoRegras} onChange={(e) => void salvarSorte({ ligado: e.target.checked }, e.target.checked ? 'Teste minha sorte ligado no site.' : 'Teste minha sorte desligado: some do site inteiro.')} />
            <span className="pn-troca-marca" aria-hidden="true" />
            <span>Teste minha sorte no site</span>
          </label>
          <p className="pn-dica-bloco">
            {l.sorte.ligado ? (noJogo.length ? 'Todo giro ganha: sai um dos prêmios no jogo, pela chance de cada um.' : 'Sem prêmio no jogo, o Teste minha sorte some do site.') : 'Desligado: some do site inteiro (destaque, barra, sacola).'}
          </p>
        </section>

        <section className="pn-bloco" aria-labelledby="h-s-premios">
          <h2 id="h-s-premios" className="pn-h2">
            Prêmios <span className="pn-conta">{l.sorte.premios.length}</span>
          </h2>
          <p className="pn-dica-bloco">Só acessório (bebida nunca entra). A chance de cada um só aparece aqui.</p>
          {l.sorte.premios.length === 0 ? (
            <p className="pn-vazio">Nenhum prêmio. Cria o primeiro no “Novo prêmio”.</p>
          ) : (
            <ul className="pn-lista-premios">
              {l.sorte.premios.map((p) => {
                const fora = motivoFora(p, l)
                const chance = p.noSite && soma ? Math.round((p.peso / soma) * 100) : null
                return (
                  <li key={p.id} className={`pn-premio${p.noSite ? '' : ' pn-premio-fora'}`}>
                    <Link href={caminho.premio(p.id)} className="pn-premio-link toque">
                      <span className="pn-premio-txt">
                        <strong className="px">{nomeDoPremio(p, l)}</strong>
                        <span>
                          {chance != null ? `sai em ~${chance}% dos giros` : fora} · vale {p.validadeDias} {p.validadeDias === 1 ? 'dia' : 'dias'}
                        </span>
                        {p.demo && <span className="carimbo">exemplo</span>}
                      </span>
                      <Ic nome="chevron-dir" tamanho={16} />
                    </Link>
                    <label className="pn-troca pn-troca-p pn-premio-troca">
                      <input type="checkbox" checked={p.ativo} disabled={mexendo === p.id} onChange={() => void ligarPremio(p)} />
                      <span className="pn-troca-marca" aria-hidden="true" />
                      <span className="sr-only">{p.titulo} no jogo</span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="pn-bloco" aria-labelledby="h-s-regras">
          <h2 id="h-s-regras" className="pn-h2">
            Regras
          </h2>
          <p className="pn-dica-bloco">Conta é incentivo, nunca pedágio: sem conta, o primeiro giro é sempre livre.</p>
          <div className="pn-form">
            <Campo id="s-girosSemConta" rotulo="Giros sem conta" erro={erroRegra.girosSemConta} dica="Pra sempre, no aparelho.">
              {(a) => <Numero aria={a} valor={regras.girosSemConta} aoMudar={(v) => setRegras({ ...regras, girosSemConta: v })} min={1} max={3} rotuloMenos="Um giro a menos sem conta" rotuloMais="Um giro a mais sem conta" />}
            </Campo>
            <Campo id="s-girosPorDiaComConta" rotulo="Giros por dia com conta" erro={erroRegra.girosPorDiaComConta} dica="Vira à meia-noite (horário de Brasília).">
              {(a) => <Numero aria={a} valor={regras.girosPorDiaComConta} aoMudar={(v) => setRegras({ ...regras, girosPorDiaComConta: v })} min={1} max={5} rotuloMenos="Um giro a menos por dia" rotuloMais="Um giro a mais por dia" />}
            </Campo>
            <Campo id="s-reservaSemContaHoras" rotulo="Prêmio sem conta fica guardado" erro={erroRegra.reservaSemContaHoras} dica="Depois disso, quem não guardou perde o prêmio.">
              {(a) => <Numero aria={a} valor={regras.reservaSemContaHoras} aoMudar={(v) => setRegras({ ...regras, reservaSemContaHoras: v })} min={1} max={72} sufixo="horas" rotuloMenos="Uma hora a menos" rotuloMais="Uma hora a mais" />}
            </Campo>
            <Botao
              disabled={!mudouRegra}
              ocupado={salvandoRegras}
              onClick={() =>
                void salvarSorte({ girosSemConta: num(regras.girosSemConta), girosPorDiaComConta: num(regras.girosPorDiaComConta), reservaSemContaHoras: num(regras.reservaSemContaHoras) }, 'Regras salvas.')
              }
            >
              Salvar as regras
            </Botao>
          </div>
        </section>
      </div>
    </>
  )
}
