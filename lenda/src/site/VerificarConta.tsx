/**
 * #/verificar?conta=<usuarios.id>[&candidato=<id>] — v3.4 (CONTRATO-v34 §A.0/§B): verifica em lote as carreiras-prova de
 * uma conta (as que provam as conquistas dela). Só o admin (a rota é fechada como a #/verificar de sempre).
 *
 * Lê admin.php?r=provas&usuario=<id>, joga de novo cada carreira escolhida (a mesma verificação da #/verificar?id=: números,
 * taças, semente, bônus, lista de conquistas) e manda os resultados com prova_verificar. As que bateram vão sozinhas; as
 * que não bateram esperam o clique (tirar a prova retira as conquistas que só ela provava e os emblemas que ela deu); as
 * inconclusivas (outra versão dos dados) não vão. Com as 87 provadas por carreiras verificadas, o servidor passa o candidato
 * do desafio "todas as conquistas" para "verificada" sozinho.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CircleCheck, CircleX, ExternalLink, FileSearch, ListChecks, RotateCcw, Send, ShieldAlert, Square, TriangleAlert } from 'lucide-react'
import { computeLegacy } from '@/store/career'
import { useData } from '@/store/data'
import { LEGACY_VERSION } from '@/engine/legacy/score'
import type { Verificacao } from '@/engine/verificar'
import { Button, Segmented, Skeleton, cx, formatInt, toast } from '@/ui/primitives'
import { PlaceholderScreen } from '@/ui/shell/Placeholder'
import { ErroApi, mensagemDeErro } from './api'
import { buscarCarreiraAdmin, buscarProvasConta, carreirasDoLote, dadosParaVerificar, mandarProvas, type CarreiraProva, type ProvasConta, type ResultadoProva } from './verificacao'
import './site.css'
import './v33.css'
import './v34.css'

type Modo = 'essenciais' | 'faltam' | 'todas'
type EstadoLinha = 'fila' | 'rodando' | 'bateu' | 'nao_bateu' | 'inconclusiva' | 'sem' | 'erro'
interface Linha {
  estado: EstadoLinha
  texto: string | null
  v: Verificacao | null
  /** O que o servidor gravou depois (true/false), ou null = ainda não mandado. */
  mandado: boolean | null
  /** §E: a versão do conteúdo que foi refeito (meta.versao): vai junto no prova_verificar. */
  versao?: string | null
}

const ROTULO_LINHA: Record<EstadoLinha, string> = {
  fila: 'Na fila',
  rodando: 'Verificando…',
  bateu: 'Bateu',
  nao_bateu: 'Não bateu',
  inconclusiva: 'Inconclusiva',
  sem: 'Não dá para verificar',
  erro: 'Erro',
}

const respirar = () => new Promise<void>((r) => setTimeout(r, 0))

export default function VerificarConta({ uid, candidato }: { uid: string; candidato?: string }) {
  const [p, setP] = useState<ProvasConta | null>(null)
  const [erro, setErro] = useState<{ titulo: string; texto: string; tentar: boolean } | null>(null)
  const [modo, setModo] = useState<Modo>('essenciais')
  const [linhas, setLinhas] = useState<Record<number, Linha>>({})
  const [rodando, setRodando] = useState<{ i: number; n: number; passo: number; total: number } | null>(null)
  const [enviando, setEnviando] = useState(false)
  const vez = useRef(0)
  const iniciou = useRef(false)

  const carregar = useCallback(async () => {
    setErro(null)
    try {
      const r = await buscarProvasConta(uid)
      setP(r)
      return r
    } catch (err) {
      const e = err instanceof ErroApi ? err : null
      if (e && (e.status === 401 || e.status === 403)) setErro({ titulo: 'Entre no painel de novo', texto: 'A sessão do painel acabou neste navegador (ou o seu papel não pode ver as provas). Entre no painel e abra a verificação de novo.', tentar: false })
      else if (e?.status === 404) setErro({ titulo: 'Conta não encontrada', texto: 'Essa conta não existe mais (ou foi excluída).', tentar: false })
      else setErro({ titulo: 'Não deu para carregar as provas', texto: mensagemDeErro(err), tentar: true })
      return null
    }
  }, [uid])

  const lote = useMemo(() => (p ? carreirasDoLote(p, modo) : []), [p, modo])

  const VAZIA: Linha = { estado: 'fila', texto: null, v: null, mandado: null }
  const marcar = (pk: number, l: Partial<Linha>) => setLinhas((x) => ({ ...x, [pk]: { ...VAZIA, ...(x[pk] ?? {}), ...l } }))

  /** Manda os resultados (os que bateram sozinhos; os que não bateram só com `incluirNao`). */
  const mandar = useCallback(
    async (lista: { c: CarreiraProva; v: Verificacao; versao?: string | null }[]) => {
      if (!lista.length) return
      setEnviando(true)
      try {
        const { resultadoParaServidor } = await import('@/engine/verificar')
        const resultados: ResultadoProva[] = lista.map(({ c, v, versao }) => {
          const r = resultadoParaServidor(v)
          return { carreira: c.pk, ok: r.ok, detalhes: r.detalhes, versao: versao ?? null }
        })
        const r = await mandarProvas(resultados, Number(uid))
        for (const k of r.carreiras) marcar(k.pk, { mandado: k.provaOk ?? null })
        for (const k of r.pulados)
          marcar(k.carreira, {
            texto:
              k.motivo === 'mudou'
                ? 'O dono salvou esta carreira de novo depois da verificação: nada foi gravado. Verifique de novo.'
                : k.motivo === 'sem_prova'
                  ? 'O servidor não conta mais esta carreira como prova.'
                  : 'O servidor não achou esta carreira.',
          })
        const conta = r.conta
        toast.success(
          lista.every((x) => x.v.ok) ? `${formatInt(lista.length)} ${lista.length === 1 ? 'prova verificada' : 'provas verificadas'}` : 'Resultados registrados',
          conta ? `A conta tem ${formatInt(conta.verificadas)} de ${formatInt(conta.total)} conquistas provadas e conferidas.` : 'O painel já mostra o resultado.',
        )
        await carregar()
      } catch (err) {
        toast.error('Não deu para registrar', err instanceof ErroApi && (err.status === 401 || err.status === 403) ? 'A sessão do painel acabou. Entre no painel de novo.' : mensagemDeErro(err))
      } finally {
        setEnviando(false)
      }
    },
    [uid, carregar],
  )

  const rodar = useCallback(
    async (alvo: CarreiraProva[]) => {
      const minha = ++vez.current
      if (!alvo.length) return
      for (const c of alvo) marcar(c.pk, { estado: 'fila', texto: null, v: null, mandado: null })
      setRodando({ i: 0, n: alvo.length, passo: 0, total: 0 })
      let motor: { careerEngine: typeof import('@/engine/career/default').careerEngine; verificarCarreira: typeof import('@/engine/verificar').verificarCarreira }
      let hoje: Awaited<ReturnType<ReturnType<typeof useData.getState>['load']>>
      try {
        const [m1, m2, d] = await Promise.all([import('@/engine/career/default'), import('@/engine/verificar'), useData.getState().load()])
        if (useData.getState().source !== 'real') throw new Error('O jogo carregou os dados de exemplo: a verificação precisa dos dados reais.')
        motor = { careerEngine: m1.careerEngine, verificarCarreira: m2.verificarCarreira }
        hoje = d
      } catch (err) {
        setRodando(null)
        setErro({ titulo: 'O motor não rodou', texto: String((err as Error)?.message ?? err).slice(0, 240), tentar: true })
        return
      }
      const bateram: { c: CarreiraProva; v: Verificacao; versao: string | null }[] = []
      for (let i = 0; i < alvo.length; i++) {
        if (minha !== vez.current) return
        const c = alvo[i]
        marcar(c.pk, { estado: 'rodando' })
        setRodando({ i: i + 1, n: alvo.length, passo: 0, total: 0 })
        try {
          const car = await buscarCarreiraAdmin(String(c.pk))
          const dadosCarreira = (car.entry as { replay?: { dados?: unknown } }).replay?.dados
          const d = await dadosParaVerificar(typeof dadosCarreira === 'string' ? dadosCarreira : '', hoje)
          const v = await motor.verificarCarreira(motor.careerEngine, d.data, car.entry, computeLegacy, {
            servidor: car.servidor,
            dadosUsados: d.versao,
            versaoNota: LEGACY_VERSION,
            ceder: async (passo, total) => {
              if (minha === vez.current) setRodando({ i: i + 1, n: alvo.length, passo, total })
              await respirar()
            },
          })
          if (minha !== vez.current) return
          const estado: EstadoLinha = v.ok ? 'bateu' : v.motivo && v.conclusao !== 'inconclusiva' && !v.refeito ? 'sem' : v.conclusao === 'inconclusiva' ? 'inconclusiva' : 'nao_bateu'
          const texto = v.ok ? null : v.motivo ?? v.diferencas.map((x) => `${x.rotulo}: ${x.guardado ?? '—'} → ${x.refeito ?? '—'}`).join('; ').slice(0, 240)
          // §E: a versão do conteúdo que foi refeito vai junto (o dono pode salvar outro enquanto o lote roda)
          const versao = car.prova.versao ?? null
          marcar(c.pk, { estado, texto, v, versao })
          if (v.ok) bateram.push({ c, v, versao })
        } catch (err) {
          if (minha !== vez.current) return
          marcar(c.pk, { estado: 'erro', texto: err instanceof ErroApi && err.status === 404 ? 'A carreira não existe mais.' : mensagemDeErro(err) })
        }
        await respirar()
      }
      if (minha !== vez.current) return
      setRodando(null)
      // as que bateram vão sozinhas (como na #/verificar de uma carreira); as outras esperam o clique
      await mandar(bateram)
    },
    [mandar],
  )

  useEffect(() => {
    let vivo = true
    void carregar().then((r) => {
      // abriu pelo link (do painel): verifica já as essenciais que faltam
      if (!vivo || !r || iniciou.current) return
      iniciou.current = true
      void rodar(carreirasDoLote(r, 'essenciais'))
    })
    return () => {
      vivo = false
      vez.current++
    }
  }, [carregar, rodar])

  if (erro && !p)
    return (
      <PlaceholderScreen
        eyebrow="Verificação em lote"
        title={erro.titulo}
        icon={ShieldAlert}
        description={erro.texto}
        actions={
          <>
            <Button variant="ghost" size="md" icon={ExternalLink} href="./painel/" target="_blank" rel="noopener">
              Abrir o painel
            </Button>
            {erro.tentar && (
              <Button variant="primary" size="md" icon={RotateCcw} onClick={() => void carregar()}>
                Tentar de novo
              </Button>
            )}
          </>
        }
      />
    )

  const naoBateram = Object.entries(linhas)
    .filter(([, l]) => l.estado === 'nao_bateu' && l.v && l.mandado === null)
    .map(([pk, l]) => ({ c: p?.carreiras.find((k) => k.pk === Number(pk)), v: l.v!, versao: l.versao ?? null }))
    .filter((x): x is { c: CarreiraProva; v: Verificacao; versao: string | null } => !!x.c)
  const k = p?.conquistas
  const pct = rodando ? Math.round((((rodando.i - 1) + (rodando.total ? rodando.passo / rodando.total : 0)) / rodando.n) * 100) : 0

  return (
    <main id="conteudo" tabIndex={-1} className="sv-page outline-none">
      <header className="sv-head">
        <span className="sv-head__k">
          <ListChecks aria-hidden="true" /> Verificação em lote · carreiras-prova
        </span>
        {p ? (
          <h1 className="sv-head__t">
            {p.usuario.apelido} <small>conta nº {p.usuario.id}</small>
          </h1>
        ) : (
          <Skeleton h={34} r={10} />
        )}
        <p className="sv-head__p">Cada carreira do Clássico começada com a conta prova as conquistas que desbloqueou. Aqui o jogo joga de novo as carreiras-prova, uma a uma, e confere números e conquistas.</p>
      </header>

      {k && (
        <div className="s4-lote__nums" role="group" aria-label="Conquistas da conta">
          <span>
            <b className="num">{formatInt(k.provadas)}</b> provadas de {formatInt(k.total)}
          </span>
          <span>
            <b className="num">{formatInt(k.verificadas)}</b> conferidas
          </span>
          <span>
            <b className="num">{formatInt(k.naoProvadas)}</b> só no aparelho
          </span>
          {candidato && <span className="s4-lote__cand">Candidato nº {candidato} (todas as conquistas)</span>}
        </div>
      )}
      {k && k.faltamVerificar.length > 0 && (
        <p className="sc-hint">
          Faltam conferir: {k.faltamVerificar.slice(0, 30).join(', ')}
          {k.faltamVerificar.length > 30 ? '…' : ''}
        </p>
      )}

      {p && (
        <div className="s4-lote__barra">
          <Segmented<Modo>
            size="sm"
            value={modo}
            onChange={setModo}
            aria-label="Quais carreiras verificar"
            options={[
              { value: 'essenciais', label: 'Essenciais' },
              { value: 'faltam', label: 'Não verificadas' },
              { value: 'todas', label: 'Todas' },
            ]}
          />
          {rodando ? (
            <Button variant="ghost" size="md" icon={Square} onClick={() => (vez.current++, setRodando(null))}>
              Parar
            </Button>
          ) : (
            <Button variant="primary" size="md" icon={FileSearch} onClick={() => void rodar(lote)} disabled={!lote.length || enviando}>
              {lote.length ? `Verificar ${formatInt(lote.length)} ${lote.length === 1 ? 'carreira' : 'carreiras'}` : 'Nada a verificar'}
            </Button>
          )}
        </div>
      )}

      {rodando && (
        <div className="sv-prog" role="status" aria-live="polite">
          <span>
            Carreira {rodando.i} de {rodando.n}
            {rodando.total ? ` · decisão ${rodando.passo} de ${rodando.total}` : ' · buscando no servidor…'}
          </span>
          <span className="sv-prog__bar" aria-hidden="true">
            <i style={{ width: `${pct}%` }} />
          </span>
        </div>
      )}

      {naoBateram.length > 0 && !rodando && (
        <div className="sv-envio">
          <p className="sc-hint">
            {naoBateram.length === 1 ? 'Uma carreira não bateu.' : `${naoBateram.length} carreiras não bateram.`} Nada foi mandado delas ainda: registrar tira a prova (as conquistas que só ela provava voltam a “não provadas”) e retira os emblemas que ela deu.
          </p>
          <Button variant="danger" size="md" icon={Send} loading={enviando} onClick={() => void mandar(naoBateram)}>
            Registrar as que não bateram
          </Button>
        </div>
      )}

      {p ? (
        p.carreiras.length ? (
          <ul className="s4-lote" aria-label="Carreiras-prova da conta">
            {p.carreiras.map((c) => {
              const l = linhas[c.pk]
              const estado = l?.estado
              const servidor = l?.mandado ?? c.provaOk
              return (
                <li key={c.pk} className={cx('s4-lote__i', estado && `is-${estado}`, lote.some((x) => x.pk === c.pk) && 'is-lote')}>
                  <span className="s4-lote__ico" aria-hidden="true">
                    {estado === 'bateu' ? <CircleCheck /> : estado === 'nao_bateu' || estado === 'erro' ? <CircleX /> : estado === 'inconclusiva' || estado === 'sem' ? <TriangleAlert /> : <FileSearch />}
                  </span>
                  <span className="s4-lote__t">
                    <b>{c.jogador}</b>
                    <small>
                      {formatInt(c.conquistas.length)} conquistas{c.unicas.length ? ` · ${formatInt(c.unicas.length)} só ela prova` : ''}
                      {c.essencial ? ' · essencial' : ''}
                      {!c.vale && c.motivo ? ` · não vale: ${c.motivo}` : ''}
                    </small>
                    {l?.texto && <small className="s4-lote__x">{l.texto}</small>}
                  </span>
                  <span className="s4-lote__e">
                    {estado && <span className={cx('sv-estado', estado === 'bateu' ? 'is-verificada' : estado === 'nao_bateu' || estado === 'erro' ? 'is-recusada' : 'is-pendente')}>{ROTULO_LINHA[estado]}</span>}
                    <span className={cx('sv-estado', servidor === true ? 'is-verificada' : servidor === false ? 'is-recusada' : '')} title="O que está gravado no servidor">
                      {servidor === true ? 'Conferida' : servidor === false ? 'Tirada das provas' : 'Não conferida'}
                    </span>
                    <a className="sv-link" href={`#/verificar?id=${c.pk}`}>
                      abrir
                    </a>
                  </span>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="sc-hint">Esta conta não tem carreira-prova ainda: as conquistas dela vieram só do aparelho.</p>
        )
      ) : (
        <Skeleton h={220} r={18} />
      )}

      <div className="sc-btns sv-acoes">
        <Button variant="ghost" size="md" icon={RotateCcw} onClick={() => void carregar()} disabled={!!rodando}>
          Atualizar a lista
        </Button>
        <Button variant="ghost" size="md" icon={ExternalLink} href={`./painel/#/usuarios?conta=${uid}`} target="_blank" rel="noopener">
          Ficha da conta no painel
        </Button>
      </div>
    </main>
  )
}
