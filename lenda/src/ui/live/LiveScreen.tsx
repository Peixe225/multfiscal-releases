/**
 * #/live — configuração da live interativa (TikTok LIVE) · #/live?tela=palco — palco da votação.
 *
 * Passo a passo na própria tela: conectar (ponte do LENDA, TikFinity ou simulador), regras de votação
 * (comentários, presentes por opção, pontos por moeda), carreira automática, testes e como transmitir.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowRight, Check, CircleAlert, Copy, Gift, MessageSquare, MonitorPlay, Play, Plug, Radio, RotateCcw, Square, Unplug, Wand2 } from 'lucide-react'
import { navigate, useApp } from '@/store/app'
import { selectHasActiveCareer, useCareer } from '@/store/career'
import { newLegendNow } from '@/live/autopilot'
import { lockHolder, sendLiveCommand } from '@/live/channel'
import { LIVE_SANDBOXED, useLiveConfig, useLiveSession, type CreatorMode, type NameMode } from '@/live/config'
import { bridgeJoin, bridgeLeave } from '@/live/connection'
import { giftCatalog, giftLabel } from '@/live/gifts'
import { simChat, simGift } from '@/live/simulator'
import { useLive } from '@/live/store'
import type { LiveSource } from '@/live/types'
import { Button, Segmented, Switch, cx, toast } from '@/ui/primitives'
import { useShellSlots } from '@/ui/shell/slots'
import { FeedText, Legend } from './LiveHud'
import { LiveStage } from './LiveStage'
import { GiftIcon, OPTION_COLORS, howToVote, useNow } from './bits'
import './live.css'

function Section({ n, title, icon: Icon, children, aside }: { n: number; title: string; icon: typeof Plug; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="lv-sec lx-glass" aria-labelledby={`lv-sec-${n}`}>
      <header className="lv-sec__head">
        <span className="lv-sec__n">{n}</span>
        <Icon size={18} aria-hidden="true" />
        <h2 id={`lv-sec-${n}`}>{title}</h2>
        {aside}
      </header>
      <div className="lv-sec__body">{children}</div>
    </section>
  )
}

function Field({ label, hint, children, wide }: { label: string; hint?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <label className={cx('lv-field', wide && 'is-wide')}>
      <span className="lx-label">{label}</span>
      {children}
      {hint && <span className="lv-field__hint">{hint}</span>}
    </label>
  )
}

function NumberInput({ value, onChange, min, max, step = 1, suffix }: { value: number; onChange: (n: number) => void; min: number; max: number; step?: number; suffix?: string }) {
  const [txt, setTxt] = useState(String(value))
  useEffect(() => setTxt(String(value)), [value])
  return (
    <span className="lx-input lv-num">
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={step}
        value={txt}
        onChange={(e) => {
          setTxt(e.target.value)
          const n = Number(e.target.value)
          if (Number.isFinite(n) && e.target.value !== '') onChange(Math.min(max, Math.max(min, n)))
        }}
        onBlur={() => setTxt(String(value))}
      />
      {suffix && <span className="lv-num__s">{suffix}</span>}
    </span>
  )
}

function StatusLine() {
  const status = useLive((s) => s.status)
  const tone = status.state === 'connected' || status.state === 'demo' ? 'ok' : status.state === 'error' || status.state === 'offline' ? 'bad' : 'wait'
  const label: Record<string, string> = { idle: 'Desconectado', connecting: 'Conectando…', connected: `Conectado${status.user ? ` em @${status.user}` : ''}`, offline: 'Perfil offline', error: 'Sem conexão', demo: 'Simulador ligado' }
  return (
    <div className={cx('lv-status', `is-${tone}`)} role="status">
      <span className="lv-status__dot" aria-hidden="true" />
      <b>{label[status.state] ?? status.state}</b>
      {status.message && <span>{status.message}</span>}
    </div>
  )
}

function ConnectionSection() {
  const cfg = useLiveConfig((s) => s.config)
  const set = useLiveConfig((s) => s.set)
  const status = useLive((s) => s.status)
  const [adv, setAdv] = useState(false)
  const sources: { value: LiveSource; label: string; hint: string }[] = [
    { value: 'ponte', label: 'TikTok (ponte do LENDA)', hint: 'Conecta direto na sua live pelo @' },
    { value: 'tikfinity', label: 'TikFinity', hint: 'Usa a API WebSocket do TikFinity' },
    { value: 'simulador', label: 'Simulador', hint: 'Público de teste, sem estar ao vivo' },
  ]
  return (
    <Section n={1} title="Conexão com a live" icon={Plug} aside={<StatusLine />}>
      {LIVE_SANDBOXED && (
        <p className="lv-note is-warn">
          <CircleAlert size={16} aria-hidden="true" />
          <span>
            Aqui dentro do claude.ai o navegador não deixa a página falar com programas do seu computador, então <b>só o simulador funciona</b>. Para a live de verdade, rode o LENDA no seu PC com <code>npm run live</code> (ou o <code>INICIAR-LIVE.bat</code>): o passo a passo está no arquivo <code>lenda/live/LEIAME.md</code>.
          </span>
        </p>
      )}
      <Segmented
        aria-label="Fonte dos eventos"
        value={LIVE_SANDBOXED ? 'simulador' : cfg.source}
        onChange={(v) => set({ source: v })}
        full
        options={sources.map((s) => ({ value: s.value, label: s.label, hint: s.hint, disabled: LIVE_SANDBOXED && s.value !== 'simulador' }))}
      />
      {!LIVE_SANDBOXED && cfg.source === 'ponte' && (
        <div className="lv-grid">
          <Field label="@ do perfil que vai fazer a live" hint="O mesmo da URL: tiktok.com/@seuperfil/live">
            <span className="lx-input">
              <span className="lv-at">@</span>
              <input value={cfg.username} onChange={(e) => set({ username: e.target.value.replace(/^@/, '').trim() })} placeholder="seuperfil" autoComplete="off" spellCheck={false} />
            </span>
          </Field>
          <div className="lv-actions">
            <Button variant="primary" icon={Plug} disabled={!cfg.username || status.state === 'connecting'} onClick={() => bridgeJoin(cfg.username)}>
              Conectar
            </Button>
            <Button variant="ghost" icon={Unplug} onClick={() => bridgeLeave()}>
              Desconectar
            </Button>
          </div>
          <ol className="lv-steps is-wide">
            <li>
              No seu PC, dentro da pasta <code>lenda</code>, rode <code>npm install</code> (só na primeira vez) e depois <code>npm run live</code> — no Windows, dê dois cliques em <code>live/INICIAR-LIVE.bat</code>.
            </li>
            <li>
              A ponte abre o jogo em <code>http://localhost:5178</code>. Use esta mesma página por esse endereço.
            </li>
            <li>Comece a live no TikTok (LIVE Studio ou celular), digite o @ acima e clique em Conectar. A ponte só entra quando a live já está no ar.</li>
          </ol>
          <button type="button" className="lv-adv" aria-expanded={adv} onClick={() => setAdv((a) => !a)}>
            {adv ? 'Esconder opções avançadas' : 'Opções avançadas'}
          </button>
          {adv && (
            <>
              <Field label="Endereço da ponte" hint="Mude só se trocou a porta (npm run live -- --porta 5178).">
                <span className="lx-input">
                  <input value={cfg.bridgeUrl} onChange={(e) => set({ bridgeUrl: e.target.value.trim() })} spellCheck={false} />
                </span>
              </Field>
              <Field label="Chave do Euler Stream (opcional)" hint="A conexão usa o serviço de assinatura gratuito do Euler Stream; uma chave aumenta os limites em lives grandes.">
                <span className="lx-input">
                  <input value={cfg.signKey} onChange={(e) => set({ signKey: e.target.value.trim() })} placeholder="deixe vazio para o plano gratuito" spellCheck={false} autoComplete="off" />
                </span>
              </Field>
            </>
          )}
        </div>
      )}
      {!LIVE_SANDBOXED && cfg.source === 'tikfinity' && (
        <div className="lv-grid">
          <Field label="Endereço WebSocket do TikFinity" hint="No TikFinity: Configurações → API/WebSocket. O padrão é ws://localhost:21213/" wide>
            <span className="lx-input">
              <input value={cfg.tikfinityUrl} onChange={(e) => set({ tikfinityUrl: e.target.value.trim() })} spellCheck={false} />
            </span>
          </Field>
          <p className="lv-note is-wide">
            O TikFinity precisa estar aberto e conectado na sua live. Os eventos chegam no formato do TikTok-Live-Connector, o mesmo que a ponte do LENDA usa.
          </p>
        </div>
      )}
      {(LIVE_SANDBOXED || cfg.source === 'simulador') && (
        <div className="lv-grid">
          <Switch checked={cfg.simAuto} onChange={(v) => set({ simAuto: v })} label="Público automático" description="Espectadores de teste comentam números, mandam rosas e curtem" />
          <Field label="Movimento do público">
            <Segmented
              aria-label="Velocidade do simulador"
              size="sm"
              value={String(cfg.simSpeed) as '1' | '2' | '3'}
              onChange={(v) => set({ simSpeed: Number(v) as 1 | 2 | 3 })}
              options={[
                { value: '1', label: 'Calmo' },
                { value: '2', label: 'Animado' },
                { value: '3', label: 'Lotado' },
              ]}
            />
          </Field>
        </div>
      )}
    </Section>
  )
}

function GiftSelect({ index }: { index: number }) {
  const binding = useLiveConfig((s) => s.config.giftBindings[index] ?? '')
  const setBinding = useLiveConfig((s) => s.setBinding)
  const catalog = useLive((s) => s.catalog)
  const list = useMemo(() => giftCatalog(catalog), [catalog])
  const known = list.some((g) => g.name === binding)
  return (
    <label className="lv-bind" style={{ ['--oc' as string]: OPTION_COLORS[index] }}>
      <b className="lv-bind__n">{index + 1}</b>
      <GiftIcon name={binding} size={22} />
      <span className="lx-input lv-select">
        <select value={binding} onChange={(e) => setBinding(index, e.target.value)} aria-label={`Presente da opção ${index + 1}`}>
          <option value="">Sem presente (só comentário)</option>
          {!known && binding && <option value={binding}>{giftLabel(binding)}</option>}
          {list.map((g) => (
            <option key={g.id} value={g.name}>
              {giftLabel(g.name)} · {g.coins} {g.coins === 1 ? 'moeda' : 'moedas'}
            </option>
          ))}
        </select>
      </span>
    </label>
  )
}

function PinnedText() {
  const cfg = useLiveConfig((s) => s.config)
  const text = useMemo(
    () =>
      `🗳️ O CHAT DECIDE A CARREIRA! ${howToVote(4)}. ` +
      (cfg.creator === 'disputa'
        ? 'Na disputa, quem doar mais cria a próxima lenda: !nome, !pais e !posicao 👑'
        : cfg.creator === 'apoiador'
          ? 'Quem mais doar na carreira cria a próxima lenda: !nome, !pais e !posicao 👑'
          : 'Maior apoiador dá nome à próxima lenda 👑'),
    [cfg],
  )
  const [ok, setOk] = useState(false)
  return (
    <div className="lv-pin is-wide">
      <span className="lx-label">Texto para fixar no chat</span>
      <p>{text}</p>
      <Button
        variant="ghost"
        size="sm"
        icon={ok ? Check : Copy}
        onClick={() => {
          void navigator.clipboard
            ?.writeText(text)
            .then(() => {
              setOk(true)
              setTimeout(() => setOk(false), 1600)
            })
            .catch(() => toast.info('Copie manualmente', 'O navegador bloqueou a área de transferência.'))
        }}
      >
        {ok ? 'Copiado' : 'Copiar'}
      </Button>
    </div>
  )
}

function RulesSection() {
  const cfg = useLiveConfig((s) => s.config)
  const set = useLiveConfig((s) => s.set)
  return (
    <Section n={2} title="Como o chat vota" icon={MessageSquare}>
      <div className="lv-grid">
        <Field label="Tempo de cada votação">
          <NumberInput value={cfg.voteSeconds} min={10} max={120} onChange={(v) => set({ voteSeconds: v })} suffix="segundos" />
        </Field>
        <Field label="Cada moeda de presente vale" hint="1 Rosa = 1 moeda. Com 10, uma rosa vale 10 comentários.">
          <NumberInput value={cfg.pointsPerCoin} min={0} max={1000} onChange={(v) => set({ pointsPerCoin: v })} suffix="votos" />
        </Field>
        <Switch checked={cfg.commentVotes} onChange={(v) => set({ commentVotes: v })} label="Comentário vale voto" description="Comentar 1, 2, 3 ou 4 = 1 voto por pessoa (dá para mudar de ideia)" />
        <Switch checked={cfg.unboundGiftsFollowComment} onChange={(v) => set({ unboundGiftsFollowComment: v })} label="Outros presentes seguem o comentário" description="Presente que não é de opção vai para o número que a pessoa comentou" />
        <Switch checked={cfg.extendOnTie} onChange={(v) => set({ extendOnTie: v })} label="Prorrogar empate" description="Empate no fim do tempo ganha mais 10 segundos (uma vez)" />
        <Field label="Presente que decide na hora" hint="Um presente desse valor (ou maior) encerra a votação na hora.">
          <span className="lx-input lv-select">
            <select value={String(cfg.instantWinCoins)} onChange={(e) => set({ instantWinCoins: Number(e.target.value) })}>
              <option value="0">Desligado</option>
              <option value="99">99 moedas ou mais</option>
              <option value="299">299 moedas ou mais (Corgi)</option>
              <option value="1000">1.000 moedas ou mais (Galáxia)</option>
              <option value="5000">5.000 moedas ou mais</option>
            </select>
          </span>
        </Field>
        <div className="lv-binds is-wide">
          <span className="lx-label">Presente de cada opção</span>
          <div className="lv-binds__grid">
            {[0, 1, 2, 3].map((i) => (
              <GiftSelect key={i} index={i} />
            ))}
          </div>
          <span className="lv-field__hint">A lista real de presentes da sua sala (com imagem e preço) aparece aqui quando a ponte conecta na live.</span>
        </div>
        <PinnedText />
      </div>
    </Section>
  )
}

function AutoSection() {
  const cfg = useLiveConfig((s) => s.config)
  const set = useLiveConfig((s) => s.set)
  return (
    <Section n={3} title="Carreira automática" icon={Wand2}>
      <div className="lv-grid">
        <Field label="Ritmo da carreira" hint="Expresso = menos decisões por carreira (lives curtas).">
          <Segmented
            aria-label="Ritmo"
            size="sm"
            value={cfg.pace}
            onChange={(v) => set({ pace: v })}
            options={[
              { value: 'expressa', label: 'Expresso' },
              { value: 'normal', label: 'Normal' },
              { value: 'intensa', label: 'Intenso' },
            ]}
          />
        </Field>
        <Field label="Quem cria a nova lenda" hint={cfg.creator === 'disputa' ? 'Antes de cada carreira abre uma disputa: quem doar mais nesse tempo escolhe nome, nacionalidade e posição pelo chat.' : cfg.creator === 'apoiador' ? 'Quem mais doou na carreira que acabou escolhe nome, nacionalidade e posição pelo chat.' : 'O chat vota posição e nacionalidade; o nome segue a opção abaixo.'} wide>
          <Segmented
            aria-label="Quem cria a nova lenda"
            size="sm"
            full
            value={cfg.creator}
            onChange={(v) => set({ creator: v as CreatorMode })}
            options={[
              { value: 'disputa', label: 'Disputa de doações' },
              { value: 'apoiador', label: 'Maior apoiador' },
              { value: 'votacao', label: 'Votação do chat' },
            ]}
          />
        </Field>
        {cfg.creator === 'disputa' && (
          <>
            <Field label="Tempo da disputa">
              <NumberInput value={cfg.bidSeconds} min={10} max={180} onChange={(v) => set({ bidSeconds: v })} suffix="segundos" />
            </Field>
            <Field label="Mínimo para vencer a disputa">
              <NumberInput value={cfg.minBidCoins} min={1} max={100000} onChange={(v) => set({ minBidCoins: v })} suffix="moedas" />
            </Field>
          </>
        )}
        {cfg.creator !== 'votacao' && (
          <Field label="Tempo para o vencedor criar" hint="Comandos no chat: !nome, !pais, !posicao ou !criar Nome, País, Posição.">
            <NumberInput value={cfg.createSeconds} min={20} max={300} onChange={(v) => set({ createSeconds: v })} suffix="segundos" />
          </Field>
        )}
        <Switch
          checked={cfg.identityVote}
          onChange={(v) => set({ identityVote: v })}
          label={cfg.creator === 'votacao' ? 'Chat vota posição e nacionalidade' : 'Chat vota o que o criador não escolher'}
          description={cfg.creator === 'votacao' ? 'Votação antes de cada carreira' : 'Se o vencedor não preencher a tempo (ou ninguém doar), o chat decide'}
        />
        <Field label={cfg.creator === 'votacao' ? 'Nome da lenda' : 'Nome quando ninguém cria'}>
          <Segmented
            aria-label="Nome da lenda"
            size="sm"
            value={cfg.nameMode}
            onChange={(v) => set({ nameMode: v as NameMode })}
            options={[
              { value: 'apoiador', label: 'Maior apoiador' },
              { value: 'fixo', label: 'Fixo' },
              { value: 'aleatorio', label: 'Aleatório' },
            ]}
          />
        </Field>
        {cfg.nameMode === 'fixo' ? (
          <Field label="Nome fixo">
            <span className="lx-input lx-input--name">
              <input value={cfg.fixedName} maxLength={15} onChange={(e) => set({ fixedName: e.target.value })} placeholder="SOBRENOME" />
            </span>
          </Field>
        ) : cfg.nameMode === 'apoiador' ? (
          <p className="lv-note">O apelido de quem mais mandou presentes vira o nome na camisa (com filtro de palavrões; se não der, sai um sobrenome aleatório).</p>
        ) : (
          <span />
        )}
        <Field label="Comemoração de título na tela">
          <NumberInput value={cfg.celebrationSeconds} min={2} max={30} onChange={(v) => set({ celebrationSeconds: v })} suffix="segundos" />
        </Field>
        <Field label="Próxima carreira começa em" hint="0 = espera você clicar em “Nova lenda”.">
          <NumberInput value={cfg.nextCareerSeconds} min={0} max={300} onChange={(v) => set({ nextCareerSeconds: v })} suffix="segundos" />
        </Field>
        <Field label="Termômetro da torcida" hint="Curtidas para encher o termômetro (efeito na tela).">
          <NumberInput value={cfg.likesGoal} min={50} max={100000} step={50} onChange={(v) => set({ likesGoal: v })} suffix="curtidas" />
        </Field>
      </div>
    </Section>
  )
}

function CreatorTests() {
  const creation = useLive((s) => s.creation)
  if (!creation) return null
  if (creation.phase === 'bidding')
    return (
      <div className="lv-tests">
        <b className="lv-tests__k">Disputa aberta:</b>
        <Button variant="ghost" size="sm" onClick={() => simGift('Doughnut')}>
          <GiftIcon name="Doughnut" size={16} /> Dar lance (30 moedas)
        </Button>
      </div>
    )
  const w = creation.winner?.user
  if (!w) return null
  return (
    <div className="lv-tests">
      <b className="lv-tests__k">Como @{w.id}:</b>
      {['!nome GABIGOL', '!pais Argentina', '!posicao goleiro', '!criar Fenômeno, Brasil, atacante'].map((t) => (
        <Button key={t} variant="ghost" size="sm" onClick={() => simChat(t, w)}>
          {t}
        </Button>
      ))}
    </div>
  )
}

function TestSection() {
  const bindings = useLiveConfig((s) => s.config.giftBindings)
  const round = useLive((s) => s.round)
  const feed = useLive((s) => s.feed)
  return (
    <Section n={4} title="Testar votos" icon={Gift}>
      <p className="lv-note">Botões de teste locais (não vão para o TikTok). Funcionam durante uma votação — inicie o modo live e use aqui ou no simulador.</p>
      {round && <Legend round={round} />}
      <CreatorTests />
      <div className="lv-tests">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="lv-test" style={{ ['--oc' as string]: OPTION_COLORS[i] }}>
            <b>{i + 1}</b>
            <Button variant="ghost" size="sm" onClick={() => simChat(String(i + 1))}>
              Comentar “{i + 1}”
            </Button>
            {bindings[i] && (
              <Button variant="ghost" size="sm" onClick={() => simGift(bindings[i])}>
                <GiftIcon name={bindings[i]} size={16} /> {giftLabel(bindings[i])}
              </Button>
            )}
          </div>
        ))}
        <Button variant="ghost" size="sm" onClick={() => simGift('Galaxy')}>
          <GiftIcon name="Galaxy" size={16} /> Galáxia (1.000)
        </Button>
      </div>
      {feed.length > 0 && (
        <ul className="lv-log" aria-label="Últimos eventos">
          {feed.slice(0, 6).map((f) => (
            <li key={f.id}>
              <FeedText item={f} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function StreamSection() {
  return (
    <Section n={5} title="Transmitir no TikTok" icon={MonitorPlay}>
      <ol className="lv-steps">
        <li>
          Abra o <b>TikTok LIVE Studio</b> no PC e crie uma cena <b>vertical</b> (9:16).
        </li>
        <li>
          Clique em <b>Abrir janela da live</b> abaixo: ela abre o jogo numa janela no formato em pé (540×960). No LIVE Studio, adicione uma fonte <b>Captura de janela</b> e escolha essa janela.
        </li>
        <li>
          Clique em <b>Iniciar modo live</b> nessa janela (ou aqui) e comece a live. Fixe no chat o texto de como votar.
        </li>
        <li>Use esta aba como painel de controle: pausar, encerrar votação, nova lenda. Os comandos vão para a janela da live.</li>
      </ol>
      <p className="lv-note">
        Siga as regras de LIVE do TikTok: os presentes só influenciam as escolhas do jogo — não prometa prêmios, dinheiro ou vantagens fora da live em troca de presentes.
      </p>
    </Section>
  )
}

function ControlBar() {
  const on = useLiveSession((s) => s.on)
  const paused = useLiveSession((s) => s.paused)
  const start = useLiveSession((s) => s.start)
  const stop = useLiveSession((s) => s.stop)
  const active = useCareer(selectHasActiveCareer)
  const state = useCareer((s) => s.state)
  const now = useNow(true, 2000)
  const other = useMemo(() => lockHolder(now), [now])
  const openWindow = () => {
    const url = `${location.origin}${location.pathname}#/live?tela=palco&iniciar=1`
    const w = window.open(url, 'lenda-live', 'popup=yes,width=540,height=960')
    if (!w) toast.error('O navegador bloqueou a janela', 'Libere pop-ups para este endereço e tente de novo.')
  }
  return (
    <div className="lv-ctrl lx-glass lx-top-light">
      <div className="lv-ctrl__txt">
        <span className="lv-ctrl__k">
          <Radio size={14} aria-hidden="true" /> Modo live
        </span>
        <b>{other ? `Rodando em outra janela${other.summary?.paused ? ' · pausado' : ''}${other.summary?.round ? ` · votação: ${other.summary.round} (${other.summary.secondsLeft ?? 0}s)` : ''}` : on ? (paused ? 'Ligado · votações pausadas' : 'Ligado · o chat está no controle') : 'Desligado'}</b>
        <span>O chat decide cada escolha do Modo Clássico. Você pode pausar a qualquer momento.</span>
      </div>
      <div className="lv-ctrl__btns">
        {other ? (
          <>
            <Button variant="ghost" icon={other.summary?.paused ? Play : RotateCcw} onClick={() => sendLiveCommand(other.summary?.paused ? 'resume' : 'pause')}>
              {other.summary?.paused ? 'Retomar' : 'Pausar'}
            </Button>
            <Button variant="ghost" onClick={() => sendLiveCommand('close-vote')}>
              Encerrar votação
            </Button>
            <Button variant="ghost" onClick={() => sendLiveCommand('new-legend')}>
              Nova lenda
            </Button>
            <Button variant="danger" icon={Square} onClick={() => sendLiveCommand('stop')}>
              Parar
            </Button>
          </>
        ) : on ? (
          <>
            <Button variant="primary" iconRight={ArrowRight} onClick={() => navigate(active ? '/carreira' : '/live', active ? {} : { query: { tela: 'palco' } })}>
              Voltar para o jogo
            </Button>
            <Button variant="danger" icon={Square} onClick={() => stop()}>
              Sair do modo live
            </Button>
          </>
        ) : (
          <>
            {!LIVE_SANDBOXED && (
              <Button variant="ghost" icon={MonitorPlay} onClick={openWindow}>
                Abrir janela da live (9:16)
              </Button>
            )}
            {active && state ? (
              <>
                <Button
                  variant="ghost"
                  onClick={() => {
                    start()
                    navigate('/carreira')
                  }}
                >
                  Continuar {state.identity.surname}
                </Button>
                <Button
                  variant="primary"
                  icon={Play}
                  onClick={() => {
                    start()
                    newLegendNow()
                  }}
                >
                  Nova lenda votada pelo chat
                </Button>
              </>
            ) : (
              <Button
                variant="primary"
                icon={Play}
                onClick={() => {
                  start()
                  navigate('/live', { query: { tela: 'palco' } })
                }}
              >
                Iniciar modo live
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function LiveSetup() {
  return (
    <main id="conteudo" className="lv-setup" tabIndex={-1}>
      <header className="lv-setup__hero">
        <span className="lx-eyebrow">TikTok LIVE</span>
        <h1>Live interativa</h1>
        <p>O chat comanda a carreira: cada decisão vira uma votação com comentários e presentes. Rosinha no 1, TikTok no 2… e o maior apoiador dá nome à próxima lenda.</p>
      </header>
      <ControlBar />
      <ConnectionSection />
      <RulesSection />
      <AutoSection />
      <TestSection />
      <StreamSection />
    </main>
  )
}

export function LiveScreen() {
  const route = useApp((s) => s.route)
  // durante a animação de saída (a rota já é outra) a tela fica como estava: trocar o conteúdo aqui
  // monta componentes animados dentro de uma página que está saindo e trava a troca de página
  const frozen = useRef(route.query)
  if (route.path === '/live') frozen.current = route.query
  const { tela, iniciar } = frozen.current
  useShellSlots({ sub: 'LIVE' }, [])
  // janela aberta por "Abrir janela da live": já entra no modo live
  useEffect(() => {
    if (!iniciar) return
    if (!lockHolder()) useLiveSession.getState().start()
    navigate('/live', { query: { tela: tela ?? 'palco' }, replace: true })
  }, [iniciar, tela])
  void route
  return tela === 'palco' ? <LiveStage /> : <LiveSetup />
}

export default LiveScreen
