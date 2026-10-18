/**
 * #/verificar?id=<carreiras.id>[&candidato=<id>] — a verificação por replay de uma candidata a desafio (só o admin: a
 * rota é fechada para o público em src/store/acesso.ts e o servidor só responde com a sessão do painel).
 *
 * Busca a carreira (admin.php?r=carreira), joga de novo a partir do replay, sem tela nem animação (src/engine/verificar.ts),
 * compara pico, nota, gols, títulos, Copas, Libertadores, Bolas de Ouro (e jogos, temporadas, taça por taça) e manda
 * o resultado com candidato_verificar. Bateu: manda sozinho (o candidato fica "verificado"; declarar o vencedor continua
 * no painel, com a confirmação forte). Não bateu: mostra as diferenças e só manda com o clique (o servidor recusa o
 * candidato com o motivo).
 * §E: compara também os números que o servidor gravou (meta) e o bônus do replay; refaz com a versão dos dados com que a
 * carreira foi jogada (dados/<versão>.json); sem ela, uma diferença só nos números refeitos é "inconclusiva" e a tela não
 * oferece recusar. Com a verificação que bate, o servidor ainda pode recusar (a carreira guardada não cumpre mais o
 * desafio): a tela mostra o que ele fez.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, CircleCheck, CircleX, ExternalLink, FileSearch, RotateCcw, Send, ShieldAlert, TriangleAlert } from 'lucide-react'
import { navigate, useApp } from '@/store/app'
import { computeLegacy } from '@/store/career'
import { useData } from '@/store/data'
import { LEGACY_VERSION } from '@/engine/legacy/score'
import type { Verificacao } from '@/engine/verificar'
import { Button, Skeleton, cx, formatInt, toast } from '@/ui/primitives'
import { PlaceholderScreen } from '@/ui/shell/Placeholder'
import { useShellSlots } from '@/ui/shell/slots'
import { ErroApi, mensagemDeErro } from './api'
import { alvoDoResultado, buscarCarreiraAdmin, dadosParaVerificar, mandarResultado, type CandidatoFeito, type CarreiraParaVerificar } from './verificacao'
import { ROTULO_ESTADO } from './desafios'
import './site.css'
import './v33.css'

type Fase =
  | { f: 'buscando' }
  | { f: 'erro'; titulo: string; texto: string; tentar: boolean }
  | { f: 'rodando'; passo: number; total: number }
  | { f: 'pronta'; v: Verificacao }

type Envio = { s: 'nada' } | { s: 'mandando' } | { s: 'mandado'; ok: boolean; feitos: CandidatoFeito[] } | { s: 'falhou'; texto: string }

export default function VerificarTela() {
  const query = useApp((s) => s.route.query)
  const id = query.id ?? ''
  const candidato = query.candidato
  useShellSlots({ sub: '', center: <span className="sm-topbar-t">Verificação por replay · só o admin</span>, stage: { preset: 'legend' } }, [])
  if (!/^\d{1,10}$/.test(id) && !/^career-[0-9a-z]{2,20}$/.test(id)) {
    return (
      <PlaceholderScreen eyebrow="Verificação por replay" title="Falta a carreira" icon={FileSearch} description="Abra a verificação pelo painel: aba Desafios → candidato → “Verificar no jogo”." actions={<BotaoPainel />} />
    )
  }
  return <Verificar key={`${id}:${candidato ?? ''}`} id={id} candidato={candidato} />
}

function BotaoPainel() {
  return (
    <Button variant="ghost" size="md" icon={ExternalLink} href="./painel/#desafios" target="_blank" rel="noopener">
      Abrir o painel
    </Button>
  )
}

/** Devolve o controle ao navegador entre as decisões (a barra de progresso anda e a aba não trava). */
const respirar = () => new Promise<void>((r) => setTimeout(r, 0))

function Verificar({ id, candidato }: { id: string; candidato?: string }) {
  const [fase, setFase] = useState<Fase>({ f: 'buscando' })
  const [c, setC] = useState<CarreiraParaVerificar | null>(null)
  const [envio, setEnvio] = useState<Envio>({ s: 'nada' })
  const vez = useRef(0)

  const mandar = useCallback(
    async (v: Verificacao, car: CarreiraParaVerificar) => {
      const alvo = alvoDoResultado(car.candidatos, candidato, car.meta.pk)
      if (!alvo) return
      setEnvio({ s: 'mandando' })
      try {
        const { resultadoParaServidor } = await import('@/engine/verificar')
        const feitos = await mandarResultado(alvo, resultadoParaServidor(v))
        setEnvio({ s: 'mandado', ok: v.ok, feitos })
        // §E: bateu, mas o servidor recusou (a carreira guardada não cumpre mais o critério de agora)
        const recusou = v.ok && feitos.some((k) => k.estado === 'recusada')
        if (recusou) toast.info('Bateu, mas o servidor recusou', feitos.find((k) => k.estado === 'recusada')?.motivo ?? 'A carreira guardada não cumpre mais o desafio.')
        else toast.success(v.ok ? 'Verificação registrada no painel' : 'Resultado registrado: candidato recusado', v.ok ? 'O candidato ficou “verificado”. Declarar o vencedor é no painel.' : 'O motivo vai junto (as diferenças desta tela).')
        // os estados novos dos candidatos
        void buscarCarreiraAdmin(id)
          .then((n) => setC((x) => (x ? { ...x, candidatos: n.candidatos } : n)))
          .catch(() => {})
      } catch (err) {
        setEnvio({ s: 'falhou', texto: err instanceof ErroApi && (err.status === 401 || err.status === 403) ? 'A sessão do painel acabou (ou o seu papel não pode verificar). Entre no painel de novo.' : mensagemDeErro(err) })
      }
    },
    [candidato, id],
  )

  const rodar = useCallback(async () => {
    const minha = ++vez.current
    setFase({ f: 'buscando' })
    setEnvio({ s: 'nada' })
    let car: CarreiraParaVerificar
    try {
      car = await buscarCarreiraAdmin(id)
    } catch (err) {
      if (minha !== vez.current) return
      const e = err instanceof ErroApi ? err : null
      if (e && (e.status === 401 || e.status === 403)) setFase({ f: 'erro', titulo: 'Entre no painel de novo', texto: 'A sessão do painel acabou neste navegador. Entre no painel e use “Verificar no jogo” outra vez.', tentar: false })
      else if (e?.status === 404) setFase({ f: 'erro', titulo: 'Carreira não encontrada', texto: 'Essa carreira não existe mais (foi apagada ou a conta foi excluída).', tentar: false })
      else setFase({ f: 'erro', titulo: 'Não deu para carregar', texto: mensagemDeErro(err), tentar: true })
      return
    }
    if (minha !== vez.current) return
    setC(car)
    try {
      const [{ careerEngine }, { verificarCarreira }, hoje] = await Promise.all([import('@/engine/career/default'), import('@/engine/verificar'), useData.getState().load()])
      if (useData.getState().source !== 'real') throw new Error('O jogo carregou os dados de exemplo: a verificação precisa dos dados reais.')
      setFase({ f: 'rodando', passo: 0, total: 0 })
      // §E: os dados da versão com que a carreira foi jogada (sem ela, os de hoje, e a verificação diz que não são os mesmos)
      const dadosCarreira = (car.entry as { replay?: { dados?: unknown } }).replay?.dados
      const d = await dadosParaVerificar(typeof dadosCarreira === 'string' ? dadosCarreira : '', hoje)
      const v = await verificarCarreira(careerEngine, d.data, car.entry, computeLegacy, {
        servidor: car.servidor,
        dadosUsados: d.versao,
        versaoNota: LEGACY_VERSION,
        ceder: async (passo, total) => {
          if (minha === vez.current) setFase({ f: 'rodando', passo, total })
          await respirar()
        },
      })
      if (minha !== vez.current) return
      setFase({ f: 'pronta', v })
      // bateu: registra sozinho; não bateu (ou não deu para verificar): espera o clique
      if (v.ok) void mandar(v, car)
    } catch (err) {
      if (minha !== vez.current) return
      setFase({ f: 'erro', titulo: 'O motor não rodou', texto: String((err as Error)?.message ?? err).slice(0, 240), tentar: true })
    }
  }, [id, mandar])

  useEffect(() => {
    void rodar()
    return () => {
      vez.current++
    }
  }, [rodar])

  if (fase.f === 'erro') {
    return (
      <PlaceholderScreen
        eyebrow="Verificação por replay"
        title={fase.titulo}
        icon={ShieldAlert}
        description={fase.texto}
        actions={
          <>
            <BotaoPainel />
            {fase.tentar && (
              <Button variant="primary" size="md" icon={RotateCcw} onClick={() => void rodar()}>
                Tentar de novo
              </Button>
            )}
          </>
        }
      />
    )
  }

  const h = c?.entry
  const alvo = c ? alvoDoResultado(c.candidatos, candidato, c.meta.pk) : null
  return (
    <main id="conteudo" tabIndex={-1} className="sv-page outline-none">
      <header className="sv-head">
        <span className="sv-head__k">
          <FileSearch aria-hidden="true" /> Verificação por replay
        </span>
        {h ? (
          <h1 className="sv-head__t">
            {h.identity?.surname ?? '—'} <small>de {c?.meta.apelido}</small>
          </h1>
        ) : (
          <Skeleton h={34} r={10} />
        )}
        <p className="sv-head__p">O jogo joga esta carreira de novo, decisão por decisão, a partir da semente e das escolhas gravadas, e compara com o que está salvo na conta.</p>
      </header>

      {(fase.f === 'buscando' || fase.f === 'rodando') && <Progresso fase={fase} />}

      {fase.f === 'pronta' && c && (
        <>
          <Veredito v={fase.v} />
          <Tabela v={fase.v} />
          <Notas v={fase.v} />
        </>
      )}

      {c && (
        <section className="sv-bloco" aria-labelledby="sv-cand-h">
          <h2 id="sv-cand-h" className="sc-sec">
            Candidaturas desta carreira
          </h2>
          {c.candidatos.length ? (
            <ul className="sv-cands">
              {c.candidatos.map((k) => (
                <li key={k.id} className={cx('sv-cand', candidato === String(k.id) && 'is-alvo')}>
                  <b>{k.desafio.titulo}</b>
                  <span className={`sv-estado is-${k.estado}`}>{ROTULO_ESTADO[k.estado]}</span>
                  <small>
                    candidato nº {k.id}
                    {candidato === String(k.id) ? ' · o do link' : ''}
                  </small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="sc-hint">Esta carreira não é candidata a nenhum desafio agora: a verificação fica só nesta tela.</p>
          )}
          {fase.f === 'pronta' && alvo && <EnvioResultado v={fase.v} envio={envio} onMandar={() => c && void mandar(fase.v, c)} />}
        </section>
      )}

      <div className="sc-btns sv-acoes">
        <Button variant="ghost" size="md" icon={ArrowLeft} onClick={() => navigate('/resumo', { query: { id: String(c?.meta.pk || id), de: 'admin' } })} disabled={!c}>
          Abrir o resumo da carreira
        </Button>
        <Button variant="ghost" size="md" icon={RotateCcw} onClick={() => void rodar()} disabled={fase.f === 'buscando' || fase.f === 'rodando'}>
          Verificar de novo
        </Button>
        <BotaoPainel />
      </div>
    </main>
  )
}

function Progresso({ fase }: { fase: Extract<Fase, { f: 'buscando' | 'rodando' }> }) {
  const pct = fase.f === 'rodando' && fase.total ? Math.round((fase.passo / fase.total) * 100) : 0
  return (
    <div className="sv-prog" role="status" aria-live="polite">
      <span>{fase.f === 'buscando' ? 'Buscando a carreira no servidor…' : fase.total ? `Jogando de novo: decisão ${fase.passo} de ${fase.total}` : 'Carregando o motor do jogo…'}</span>
      <span className="sv-prog__bar" aria-hidden="true">
        <i style={{ width: `${pct}%` }} />
      </span>
    </div>
  )
}

function Veredito({ v }: { v: Verificacao }) {
  if (v.conclusao === 'inconclusiva')
    return (
      <p className="sv-veredito is-nao">
        <TriangleAlert aria-hidden="true" />
        <span>
          <b>Inconclusiva: outra versão dos dados do jogo</b>
          {v.motivo ? `${v.motivo} ` : ''}A carreira foi jogada com a versão {v.dados.carreira.replace('>', ' e depois ')} dos dados, e o jogo não tem como refazê-la com os
          mesmos dados (refez com a {v.dados.usada}). Os números refeitos não provam trapaça: confira à mão e decida no painel.
        </span>
      </p>
    )
  if (v.motivo)
    return (
      <p className="sv-veredito is-nao">
        <TriangleAlert aria-hidden="true" />
        <span>
          <b>Não dá para verificar</b>
          {v.motivo}
        </span>
      </p>
    )
  return v.ok ? (
    <p className="sv-veredito is-ok">
      <CircleCheck aria-hidden="true" />
      <span>
        <b>Bateu: é a mesma carreira</b>O replay deu exatamente os números guardados ({v.passos} decisões, {(v.ms / 1000).toFixed(1)} s).
      </span>
    </p>
  ) : (
    <p className="sv-veredito is-nao">
      <CircleX aria-hidden="true" />
      <span>
        <b>Não bateu</b>
        {v.diferencas.length === 1 ? 'Um número' : `${v.diferencas.length} números`} da carreira guardada não {v.diferencas.length === 1 ? 'é' : 'são'} o que o motor dá com este replay.
      </span>
    </p>
  )
}

const LINHAS: { campo: keyof NonNullable<Verificacao['guardado']>; rotulo: string; destaque?: boolean }[] = [
  { campo: 'copas', rotulo: 'Copas do Mundo', destaque: true },
  { campo: 'libertadores', rotulo: 'Libertadores', destaque: true },
  { campo: 'bolasOuro', rotulo: 'Bolas de Ouro' },
  { campo: 'titulos', rotulo: 'Títulos' },
  { campo: 'gols', rotulo: 'Gols' },
  { campo: 'pico', rotulo: 'Pico de OVR' },
  { campo: 'nota', rotulo: 'Nota de Legado' },
  { campo: 'jogos', rotulo: 'Jogos' },
  { campo: 'temporadas', rotulo: 'Temporadas' },
]

function Tabela({ v }: { v: Verificacao }) {
  if (!v.guardado) return null
  const g = v.guardado
  const r = v.refeito
  return (
    <div className="sv-tabela" role="table" aria-label="Guardado × refeito">
      <div className="sv-tr sv-tr--h" role="row">
        <span role="columnheader">Número</span>
        <span role="columnheader">Guardado</span>
        <span role="columnheader">Refeito</span>
        <span role="columnheader" className="sc-sr">
          Igual?
        </span>
      </div>
      {LINHAS.map((l) => {
        const a = g[l.campo]
        const b = r ? r[l.campo] : null
        const igual = r ? a === b : null
        return (
          <div key={l.campo} className={cx('sv-tr', l.destaque && 'is-destaque', igual === false && 'is-dif')} role="row">
            <span role="cell">{l.rotulo}</span>
            <span role="cell" className="num">
              {a == null ? '—' : formatInt(a)}
            </span>
            <span role="cell" className="num">
              {b == null ? '—' : formatInt(b)}
            </span>
            <span role="cell" aria-label={igual === null ? 'sem comparação' : igual ? 'igual' : 'diferente'}>
              {igual === null ? '·' : igual ? <CircleCheck className="sv-ok" aria-hidden="true" /> : <CircleX className="sv-x" aria-hidden="true" />}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function Notas({ v }: { v: Verificacao }) {
  const outras = v.diferencas.filter((d) => !LINHAS.some((l) => l.campo === d.campo))
  const dadosMudaram = !!v.dados.carreira && v.dados.carreira !== v.dados.agora
  if (!outras.length && !dadosMudaram && !v.avisos.length) return null
  return (
    <ul className="sv-notas">
      {outras.map((d) => (
        <li key={`${d.campo}:${d.rotulo}`} className="is-dif">
          <b>{d.rotulo}:</b> guardado {String(d.guardado ?? '—')} · refeito {String(d.refeito ?? '—')}
        </li>
      ))}
      {dadosMudaram && (
        <li>
          <b>Versão dos dados:</b> a carreira foi jogada com {v.dados.carreira.replace('>', ' e depois ')}; este jogo está com {v.dados.agora}
          {v.dados.exata ? ` (refeita com a ${v.dados.usada}, a mesma da carreira).` : `. Refeita com a ${v.dados.usada}: uma diferença só nos números refeitos pode vir daí, e não de trapaça.`}
        </li>
      )}
      {v.avisos.map((a) => (
        <li key={a}>{a}</li>
      ))}
    </ul>
  )
}

function EnvioResultado({ v, envio, onMandar }: { v: Verificacao; envio: Envio; onMandar: () => void }) {
  if (envio.s === 'mandando') return <p className="sc-hint">Registrando no painel…</p>
  if (envio.s === 'mandado') {
    // §E: o que o servidor fez de fato (com a verificação que bateu, ele recusa a carreira guardada que não cumpre mais)
    const recusado = envio.feitos.find((k) => k.estado === 'recusada')
    if (envio.ok && recusado)
      return (
        <p className="sc-err" role="status">
          Bateu no replay, mas o servidor recusou o candidato: {recusado.motivo ?? 'a carreira guardada não cumpre mais o desafio.'}
        </p>
      )
    return (
      <p className="sc-ok" role="status">
        <CircleCheck aria-hidden="true" />
        <span>{envio.ok ? 'Registrado no painel: o candidato ficou “verificado”.' : 'Registrado no painel: o candidato foi recusado, com as diferenças como motivo.'}</span>
      </p>
    )
  }
  if (v.conclusao === 'inconclusiva')
    return (
      <div className="sv-envio">
        {envio.s === 'falhou' && <p className="sc-err">{envio.texto}</p>}
        <p className="sc-hint">Nada foi mandado: uma verificação inconclusiva não recusa o candidato. Confira a carreira à mão (o resumo abre abaixo) e, se for o caso, recuse no painel com o motivo.</p>
      </div>
    )
  return (
    <div className="sv-envio">
      {envio.s === 'falhou' && <p className="sc-err">{envio.texto}</p>}
      {v.ok ? (
        <Button variant="primary" size="md" icon={Send} onClick={onMandar}>
          Registrar no painel
        </Button>
      ) : (
        <>
          <p className="sc-hint">Nada foi mandado ainda. Registrar recusa o candidato (o motivo vai com as diferenças desta tela); ele pode ser reavaliado no painel.</p>
          <Button variant="danger" size="md" icon={Send} onClick={onMandar}>
            Registrar: não bateu (recusa o candidato)
          </Button>
        </>
      )}
    </div>
  )
}
