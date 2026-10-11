// Teste minha sorte: ligar ou desligar o jogo no site, com que frequência quem tem conta gira (N giros a cada X dias),
// a chance de cada raridade, os prêmios (cada um com "no jogo" num toque, o selo da raridade e a chance real de sair,
// pela mesma conta do servidor), o teste da animação das 4 raridades, o "Simular giros" (o sorteio de verdade, sem
// gravar nada) e as regras de quem não tem conta. A chance só aparece aqui: o site nunca mostra.
import { useEffect, useMemo, useState } from 'react'
import { ErroApi, mensagemDe } from '../api'
import { Link, Topo } from '../Moldura'
import { caminho } from '../rotas'
import { recado } from '../recado'
import { useRestaurarRolagem, useTitulo } from '../telas/comum'
import { Aviso, Botao, Campo, Carregando, Ic, Numero, TituloTela } from '../ui'
import { ATALHOS_INTERVALO, GIROS_MAX, GIROS_MIN, INTERVALO_MAX, INTERVALO_MIN, giroPorPeriodo, vezesPorPeriodo } from '../../lib/frequencia'
import { CHANCES_PADRAO, INFO_RARIDADE, RARIDADES, type Raridade } from '../../lib/raridade'
import { formatarPct, problemaNasChances, somaDecimos, type Chances } from '../../lib/sorteio'
import * as api from './api'
import { comPremio, estadosNoSite, guardarLoja, useLoja } from './dados'
import { nomeDoPremio } from './premio-ui'
import { SeloRaridade, TesteAnimacao, cenasDasRaridades, chancesDosPremios, textoChance } from './sorte-ui'
import type { LojaAdmin, PremioAdmin, RegrasSorte, SimulacaoSorte } from './tipos'

function motivoFora(p: PremioAdmin, l: LojaAdmin): string | null {
  if (!p.ativo) return 'fora do jogo'
  if (p.noSite) return null
  const ids = [...(p.aplicaA.produtos ?? []), ...(typeof p.valor === 'object' && 'produto' in p.valor ? [p.valor.produto] : [])]
  const foraDoSite = ids.map((id) => l.produtos.find((x) => x.id === id)).find((x) => !x || !x.ativo)
  if (foraDoSite !== undefined) return foraDoSite ? `${foraDoSite.nome} tá fora do site` : 'o produto não existe mais'
  return 'vale em bebida ou numa categoria que não existe'
}

const num = (s: string) => (/^\d{1,3}$/.test(s.trim()) ? Number(s.trim()) : NaN)
/** "12,5" ou "12.5" → 12.5; vazio ou torto → NaN. */
const pct = (s: string) => (/^\s*\d{1,3}([.,]\d+)?\s*%?\s*$/.test(s) ? Number(s.replace('%', '').replace(',', '.').trim()) : NaN)
const textoPct = (n: number) => String(n).replace('.', ',')
type FormChances = Record<Raridade, string>
const formDe = (c: Chances): FormChances => ({ comum: textoPct(c.comum), raro: textoPct(c.raro), epico: textoPct(c.epico), lendario: textoPct(c.lendario) })
const chancesDoForm = (f: FormChances): Record<Raridade, number> => ({ comum: pct(f.comum), raro: pct(f.raro), epico: pct(f.epico), lendario: pct(f.lendario) })
const iguais = (a: Record<Raridade, number>, b: Record<Raridade, number>) => RARIDADES.every((r) => a[r] === b[r])

export function Sorte() {
  useTitulo('Teste minha sorte')
  const leitura = useLoja()
  const l = leitura.dados
  const [regras, setRegras] = useState<{ girosSemConta: string; reservaSemContaHoras: string } | null>(null)
  const [freq, setFreq] = useState<{ dias: string; giros: string; outro: boolean } | null>(null)
  const [chances, setChances] = useState<FormChances | null>(null)
  const [salvando, setSalvando] = useState<null | 'ligado' | 'freq' | 'chances' | 'regras'>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [erroRegra, setErroRegra] = useState<Partial<Record<string, string>>>({})
  const [mexendo, setMexendo] = useState<string | null>(null)
  const [teste, setTeste] = useState(false)
  useRestaurarRolagem(!!l)

  useEffect(() => {
    if (!l) return
    if (!regras) setRegras({ girosSemConta: String(l.sorte.girosSemConta), reservaSemContaHoras: String(l.sorte.reservaSemContaHoras) })
    if (!freq) setFreq({ dias: String(l.sorte.intervaloDias), giros: String(l.sorte.girosPorIntervalo), outro: !ATALHOS_INTERVALO.some((a) => a.dias === l.sorte.intervaloDias) })
    if (!chances) setChances(formDe(l.sorte.chances))
  }, [l, regras, freq, chances])

  const salvarSorte = async (c: Partial<RegrasSorte>, oQue: 'ligado' | 'freq' | 'chances' | 'regras', frase: (s: RegrasSorte) => string, desfazer?: Partial<RegrasSorte>): Promise<void> => {
    setSalvando(oQue)
    setErro(null)
    setErroRegra({})
    try {
      const r = await api.salvarSorte(c)
      const f = (x: LojaAdmin): LojaAdmin => ({ ...x, versao: r.versao, atualizadoEm: r.atualizadoEm, sorte: { ...x.sorte, ...r.sorte } })
      guardarLoja(f)
      leitura.trocar(f)
      setRegras({ girosSemConta: String(r.sorte.girosSemConta), reservaSemContaHoras: String(r.sorte.reservaSemContaHoras) })
      setFreq({ dias: String(r.sorte.intervaloDias), giros: String(r.sorte.girosPorIntervalo), outro: !ATALHOS_INTERVALO.some((a) => a.dias === r.sorte.intervaloDias) })
      setChances(formDe(r.sorte.chances))
      recado(frase(r.sorte), desfazer ? { desfazer: { acao: () => salvarSorte(desfazer, oQue, () => 'Voltou como era.') } } : {})
    } catch (e) {
      if (e instanceof ErroApi && e.campo) setErroRegra({ [e.campo]: e.message })
      else setErro(mensagemDe(e))
    } finally {
      setSalvando(null)
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
      recado(r.premio.ativo ? `${p.titulo}: no jogo.` : `${p.titulo}: fora do jogo.`)
    } catch (e) {
      setErro(mensagemDe(e))
    } finally {
      setMexendo(null)
    }
  }

  const titulo = <TituloTela><span className="pn-txt-longo">Teste minha sorte</span><span className="pn-txt-curto" aria-hidden="true">Sorte</span></TituloTela>
  if (!l || !regras || !freq || !chances) {
    return (
      <>
        <Topo voltar={caminho.mais} titulo={titulo} />
        <div className="pn-pagina">{leitura.erro ? <Aviso tipo="erro">{leitura.erro.message}</Aviso> : <Carregando />}</div>
      </>
    )
  }

  // ─── frequência ───
  const dias = num(freq.dias)
  const giros = num(freq.giros)
  const freqOk = dias >= INTERVALO_MIN && dias <= INTERVALO_MAX && giros >= GIROS_MIN && giros <= GIROS_MAX
  const mudouFreq = dias !== l.sorte.intervaloDias || giros !== l.sorte.girosPorIntervalo
  const fraseFreq = freqOk ? `Cada cliente com conta gira ${vezesPorPeriodo({ intervaloDias: dias, girosPorIntervalo: giros })}.` : 'De 1 a 30 dias e de 1 a 5 giros.'

  // ─── chances ───
  const cForm = chancesDoForm(chances)
  const problema = problemaNasChances(cForm)
  const soma = somaDecimos(Object.fromEntries(RARIDADES.map((r) => [r, Number.isFinite(cForm[r]) ? cForm[r] : 0])))
  const mudouChances = !iguais(cForm, l.sorte.chances)
  const chancesValendo: Chances = !problema ? cForm : l.sorte.chances
  const zeradas = !problema ? RARIDADES.filter((r) => cForm[r] === 0) : []
  const noJogo = l.sorte.premios.filter((p) => p.noSite)
  const porRaridade = Object.fromEntries(RARIDADES.map((r) => [r, noJogo.filter((p) => p.raridade === r).length])) as Record<Raridade, number>

  // ─── regras sem conta ───
  const mudouRegra = num(regras.girosSemConta) !== l.sorte.girosSemConta || num(regras.reservaSemContaHoras) !== l.sorte.reservaSemContaHoras

  return (
    <>
      <Topo
        voltar={caminho.mais}
        titulo={titulo}
        acoes={
          <Link href={caminho.premioNovo} className="pn-botao pn-botao-cheio pn-botao-p pn-so-icone-celular" aria-label="Novo prêmio">
            <Ic nome="mais" tamanho={16} />
            <span className="pn-botao-txt">Prêmio</span>
          </Link>
        }
      />
      <div className="pn-pagina pn-pagina-estreita">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}

        <section className="pn-bloco" aria-labelledby="h-s-jogo">
          <h2 id="h-s-jogo" className="pn-h2">
            No site
          </h2>
          <label className="pn-troca">
            <input type="checkbox" checked={l.sorte.ligado} disabled={salvando === 'ligado'} onChange={(e) => void salvarSorte({ ligado: e.target.checked }, 'ligado', (s) => (s.ligado ? 'Teste minha sorte ligado no site.' : 'Teste minha sorte desligado: some do site inteiro.'), { ligado: !e.target.checked })} />
            <span className="pn-troca-marca" aria-hidden="true" />
            <span>Teste minha sorte no site</span>
          </label>
          <p className="pn-dica-bloco">
            {l.sorte.ligado ? (noJogo.length ? 'Todo giro ganha: primeiro sai a raridade, pela chance dela; depois, um dos prêmios dela.' : 'Sem prêmio no jogo, o Teste minha sorte some do site.') : 'Desligado: some do site inteiro (destaque, barra, sacola).'}
          </p>
        </section>

        <section className="pn-bloco" aria-labelledby="h-s-freq">
          <h2 id="h-s-freq" className="pn-h2">
            Com que frequência
          </h2>
          <p className="pn-dica-bloco">Quantas vezes cada pessoa com conta gira. Conta em dias do calendário, que viram à meia-noite (horário de Brasília).</p>
          <fieldset className="pn-freq">
            <legend className="pn-rotulo">A cada quantos dias</legend>
            <div className="pn-freq-ops">
              {ATALHOS_INTERVALO.map((a) => (
                <label key={a.dias} className="pn-freq-op">
                  <input type="radio" name="freq" checked={!freq.outro && dias === a.dias} onChange={() => setFreq({ ...freq, dias: String(a.dias), outro: false })} />
                  <span>{a.nome}</span>
                </label>
              ))}
              <label className="pn-freq-op">
                <input type="radio" name="freq" checked={freq.outro} onChange={() => setFreq({ ...freq, outro: true })} />
                <span>Outro</span>
              </label>
            </div>
          </fieldset>
          <div className="pn-form pn-freq-campos">
            {freq.outro && (
              <Campo id="s-intervaloDias" rotulo="A cada" erro={erroRegra.intervaloDias} dica="De 1 a 30 dias.">
                {(a) => <Numero aria={a} valor={freq.dias} aoMudar={(v) => setFreq({ ...freq, dias: v })} min={INTERVALO_MIN} max={INTERVALO_MAX} sufixo={dias === 1 ? 'dia' : 'dias'} rotuloMenos="Um dia a menos" rotuloMais="Um dia a mais" />}
              </Campo>
            )}
            <Campo id="s-girosPorIntervalo" rotulo="Giros por vez" erro={erroRegra.girosPorIntervalo} dica="Quantos giros cabem nesse período (1 a 5).">
              {(a) => <Numero aria={a} valor={freq.giros} aoMudar={(v) => setFreq({ ...freq, giros: v })} min={GIROS_MIN} max={GIROS_MAX} rotuloMenos="Um giro a menos" rotuloMais="Um giro a mais" />}
            </Campo>
          </div>
          <p className="pn-freq-frase" aria-live="polite">
            {fraseFreq}
          </p>
          <Botao
            disabled={!mudouFreq || !freqOk}
            ocupado={salvando === 'freq'}
            onClick={() =>
              void salvarSorte({ intervaloDias: dias, girosPorIntervalo: giros }, 'freq', (s) => `Frequência salva: ${giroPorPeriodo(s)} com conta.`, { intervaloDias: l.sorte.intervaloDias, girosPorIntervalo: l.sorte.girosPorIntervalo })
            }
          >
            Salvar a frequência
          </Botao>
        </section>

        <section className="pn-bloco" aria-labelledby="h-s-chances">
          <h2 id="h-s-chances" className="pn-h2">
            Chance de cada raridade
          </h2>
          <p className="pn-dica-bloco">Quanto mais raro, menor a chance. As 4 somam 100%. Raridade sem prêmio no jogo divide a chance dela com as outras.</p>
          <ul className="pn-chances">
            {RARIDADES.map((r) => (
              <li key={r} className={`pn-chance${problema?.raridade === r ? ' pn-campo-erro' : ''}`}>
                <label className="pn-chance-nome" htmlFor={`s-chance-${r}`}>
                  <SeloRaridade raridade={r} />
                  <small>{porRaridade[r] === 0 ? 'nenhum prêmio no jogo' : porRaridade[r] === 1 ? '1 prêmio no jogo' : `${porRaridade[r]} prêmios no jogo`}</small>
                </label>
                <span className="pn-chance-campo">
                  <input
                    id={`s-chance-${r}`}
                    className="pn-input pn-input-num"
                    inputMode="decimal"
                    autoComplete="off"
                    maxLength={5}
                    value={chances[r]}
                    aria-invalid={problema?.raridade === r || undefined}
                    aria-describedby="s-chances-soma"
                    onChange={(e) => setChances({ ...chances, [r]: e.target.value.replace(/[^\d.,]/g, '').slice(0, 5) })}
                  />
                  <span aria-hidden="true">%</span>
                </span>
              </li>
            ))}
          </ul>
          <p id="s-chances-soma" className={`pn-chances-soma${soma === 1000 ? ' ok' : ''}`} aria-live="polite">
            {soma === 1000 ? 'Soma 100%' : soma < 1000 ? `Falta ${formatarPct((1000 - soma) / 10)}` : `Passou ${formatarPct((soma - 1000) / 10)}`}
          </p>
          {problema && soma === 1000 && (
            <p className="pn-erro">
              <Ic nome="atencao" tamanho={16} />
              <span>{problema.erro}</span>
            </p>
          )}
          {erroRegra.chances && (
            <p className="pn-erro">
              <Ic nome="atencao" tamanho={16} />
              <span>{erroRegra.chances}</span>
            </p>
          )}
          {zeradas.length > 0 && (
            <Aviso tipo="info">
              Com 0%, {zeradas.length === 1 ? `os prêmios ${INFO_RARIDADE[zeradas[0]].nome} nunca saem` : `os prêmios ${zeradas.map((r) => INFO_RARIDADE[r].nome).join(' e ')} nunca saem`}.
            </Aviso>
          )}
          <div className="pn-botoes pn-botoes-linha pn-chances-botoes">
            <Botao
              disabled={!mudouChances || !!problema}
              ocupado={salvando === 'chances'}
              onClick={() => void salvarSorte({ chances: cForm }, 'chances', () => 'Chances salvas. O próximo giro já sai com elas.', { chances: l.sorte.chances })}
            >
              Salvar as chances
            </Botao>
            <Botao variante="texto" disabled={iguais(cForm, CHANCES_PADRAO)} onClick={() => setChances(formDe(CHANCES_PADRAO))}>
              Voltar ao padrão (60/25/12/3)
            </Botao>
          </div>
        </section>

        <section className="pn-bloco" aria-labelledby="h-s-premios">
          <div className="pn-bloco-cab">
            <h2 id="h-s-premios" className="pn-h2">
              Prêmios <span className="pn-conta">{l.sorte.premios.length}</span>
            </h2>
            <Botao variante="contorno" icone="olho" className="pn-botao-p" onClick={() => setTeste(true)}>
              Ver as 4 raridades
            </Botao>
          </div>
          <p className="pn-dica-bloco">
            Só acessório (bebida nunca entra). A chance de cada um só aparece aqui{mudouChances && !problema ? ', já com as chances que tu tá mudando (salva lá em cima)' : ''}; num estado sem algum deles, a dos outros sobe.
          </p>
          {l.sorte.premios.length === 0 ? (
            <p className="pn-vazio">Nenhum prêmio. Cria o primeiro no “Novo prêmio”.</p>
          ) : (
            <ListaPremios l={l} chances={chancesValendo} mexendo={mexendo} aoLigar={(p) => void ligarPremio(p)} />
          )}
        </section>

        <SimularGiros l={l} />

        <section className="pn-bloco" aria-labelledby="h-s-regras">
          <h2 id="h-s-regras" className="pn-h2">
            Sem conta
          </h2>
          <p className="pn-dica-bloco">Conta é incentivo, nunca pedágio: sem conta, o primeiro giro é sempre livre.</p>
          <div className="pn-form">
            <Campo id="s-girosSemConta" rotulo="Giros sem conta" erro={erroRegra.girosSemConta} dica="Pra sempre, no aparelho.">
              {(a) => <Numero aria={a} valor={regras.girosSemConta} aoMudar={(v) => setRegras({ ...regras, girosSemConta: v })} min={1} max={3} rotuloMenos="Um giro a menos sem conta" rotuloMais="Um giro a mais sem conta" />}
            </Campo>
            <Campo id="s-reservaSemContaHoras" rotulo="Prêmio sem conta fica guardado" erro={erroRegra.reservaSemContaHoras} dica="Depois disso, quem não guardou perde o prêmio.">
              {(a) => <Numero aria={a} valor={regras.reservaSemContaHoras} aoMudar={(v) => setRegras({ ...regras, reservaSemContaHoras: v })} min={1} max={72} sufixo="horas" rotuloMenos="Uma hora a menos" rotuloMais="Uma hora a mais" />}
            </Campo>
            <Botao
              disabled={!mudouRegra}
              ocupado={salvando === 'regras'}
              onClick={() => void salvarSorte({ girosSemConta: num(regras.girosSemConta), reservaSemContaHoras: num(regras.reservaSemContaHoras) }, 'regras', () => 'Regras salvas.')}
            >
              Salvar as regras
            </Botao>
          </div>
        </section>
      </div>
      {teste && <TesteAnimacao titulo="As 4 raridades" cenas={cenasDasRaridades(l)} aoFechar={() => setTeste(false)} />}
    </>
  )
}

/** A lista de prêmios: o selo da raridade, o nome do site, a chance real de sair e o "no jogo" num toque. */
function ListaPremios({ l, chances, mexendo, aoLigar }: { l: LojaAdmin; chances: Chances; mexendo: string | null; aoLigar: (p: PremioAdmin) => void }) {
  const reais = useMemo(() => chancesDosPremios(l.sorte.premios, chances), [l.sorte.premios, chances])
  return (
    <ul className="pn-lista-premios">
      {l.sorte.premios.map((p) => {
        const fora = motivoFora(p, l)
        const chance = reais.get(p.id) ?? 0
        return (
          <li key={p.id} className={`pn-premio${p.noSite ? '' : ' pn-premio-fora'}`} data-raridade={p.raridade}>
            <Link href={caminho.premio(p.id)} className="pn-premio-link toque">
              <span className="pn-premio-txt">
                <strong className="px">{nomeDoPremio(p, l)}</strong>
                <span className="pn-premio-linha">
                  <SeloRaridade raridade={p.raridade} />
                  <span className="pn-premio-chance">{p.noSite ? textoChance(chance) : fora}</span>
                </span>
                <span>
                  vale {p.validadeDias} {p.validadeDias === 1 ? 'dia' : 'dias'}
                  {p.demo && <span className="carimbo">exemplo</span>}
                </span>
              </span>
              <Ic nome="chevron-dir" tamanho={16} />
            </Link>
            <label className="pn-troca pn-troca-p pn-premio-troca">
              <input type="checkbox" checked={p.ativo} disabled={mexendo === p.id} onChange={() => aoLigar(p)} />
              <span className="pn-troca-marca" aria-hidden="true" />
              <span className="sr-only">{p.titulo} no jogo</span>
            </label>
          </li>
        )
      })}
    </ul>
  )
}

const QUANTOS = [100, 1000, 10000]

/** Simular giros: o servidor roda o sorteio de verdade N vezes, sem gravar nada, e mostra o esperado e o que saiu. */
function SimularGiros({ l }: { l: LojaAdmin }) {
  const estados = estadosNoSite(l)
  const [uf, setUf] = useState('')
  const [quantos, setQuantos] = useState(1000)
  const [r, setR] = useState<SimulacaoSorte | null>(null)
  const [rodando, setRodando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const nome = (id: string) => {
    const p = l.sorte.premios.find((x) => x.id === id)
    return p ? nomeDoPremio(p, l) : id
  }
  const simular = async () => {
    setRodando(true)
    setErro(null)
    try {
      const x = await api.simularSorte(quantos, uf || null)
      setR(x)
      recado(`Simulou ${x.giros.toLocaleString('pt-BR')} giros${x.uf ? ` em ${x.uf.toUpperCase()}` : ''}.`)
    } catch (e) {
      setErro(mensagemDe(e))
    } finally {
      setRodando(false)
    }
  }
  return (
    <section className="pn-bloco" aria-labelledby="h-s-simular">
      <h2 id="h-s-simular" className="pn-h2">
        Simular giros
      </h2>
      <p className="pn-dica-bloco">O servidor roda o sorteio de verdade quantas vezes tu quiser, sem contar giro nem criar cupom, e mostra o que saiu perto do esperado.</p>
      <div className="pn-form pn-simular-form">
        <div className="pn-dupla">
          <Campo id="s-sim-uf" rotulo="Estado">
            {(a) => (
              <select {...a} className="pn-input pn-select" value={uf} onChange={(e) => setUf(e.target.value)}>
                <option value="">Todos</option>
                {estados.map((e) => (
                  <option key={e.uf} value={e.uf}>
                    {e.nome}
                  </option>
                ))}
              </select>
            )}
          </Campo>
          <Campo id="s-sim-quantos" rotulo="Quantos giros">
            {(a) => (
              <select {...a} className="pn-input pn-select" value={quantos} onChange={(e) => setQuantos(Number(e.target.value))}>
                {QUANTOS.map((q) => (
                  <option key={q} value={q}>
                    {q.toLocaleString('pt-BR')}
                  </option>
                ))}
              </select>
            )}
          </Campo>
        </div>
        <Botao variante="contorno" icone="giro" ocupado={rodando} onClick={() => void simular()}>
          Simular {quantos.toLocaleString('pt-BR')} giros
        </Botao>
      </div>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {r && (
        <div className="pn-simulado" aria-live="polite">
          {r.desligado && <Aviso tipo="info">O jogo tá desligado: assim sairia com ele ligado.</Aviso>}
          {r.todosOsEstados && <Aviso tipo="info">{r.foraDoSite ? 'Esse estado não tá no site' : 'Nenhum prêmio vale nesse estado'}: o giro sorteia entre todos, como aqui.</Aviso>}
          <table className="pn-tabela-sim">
            <caption className="sr-only">Resultado de {r.giros} giros simulados</caption>
            <thead>
              <tr>
                <th scope="col">Raridade</th>
                <th scope="col">Esperado</th>
                <th scope="col">Saiu</th>
              </tr>
            </thead>
            <tbody>
              {r.raridades.map((x) => (
                <tr key={x.raridade} className="pn-sim-rar">
                  <th scope="row">
                    <SeloRaridade raridade={x.raridade} />
                    {x.premios === 0 && <small> · sem prêmio</small>}
                  </th>
                  <td>{formatarPct(x.esperado)}</td>
                  <td>
                    {formatarPct(x.saiuPct)} <small>({x.saiu.toLocaleString('pt-BR')})</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="pn-tabela-sim">
            <caption className="sr-only">Por prêmio</caption>
            <thead>
              <tr>
                <th scope="col">Prêmio</th>
                <th scope="col">Esperado</th>
                <th scope="col">Saiu</th>
              </tr>
            </thead>
            <tbody>
              {r.premios.map((x) => (
                <tr key={x.id}>
                  <th scope="row">
                    <SeloRaridade raridade={x.raridade} so />
                    <span className="pn-sim-nome">{nome(x.id)}</span>
                  </th>
                  <td>{formatarPct(x.esperado)}</td>
                  <td>
                    {formatarPct(x.saiuPct)} <small>({x.saiu.toLocaleString('pt-BR')})</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
