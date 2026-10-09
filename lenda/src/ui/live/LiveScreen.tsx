/**
 * #/live — configuração da live interativa (TikTok LIVE) · #/live?tela=palco — palco da votação.
 *
 * Passo a passo na própria tela: conectar (ponte do LENDA, TikFinity ou simulador), regras de votação
 * (comentários, presentes por opção, pontos por moeda), carreira automática, testes e como transmitir.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowRight, Check, CircleAlert, Copy, Gift, MessageSquare, MonitorPlay, Pause, Play, Plug, Radio, Sparkles, Square, Unplug, Wand2 } from 'lucide-react'
import { navigate, useApp } from '@/store/app'
import { selectHasActiveCareer, useCareer } from '@/store/career'
import { newLegendNow, requestStart } from '@/live/autopilot'
import { CAPTURE_WINDOW_NAME, captureReady, isCaptureWindow, isObsView, lockHolder, markCaptureWindow, sendLiveCommand, sendLiveStart, type LiveSummary, type StartMode } from '@/live/channel'
import { LIVE_SANDBOXED, bindingConflict, useLiveConfig, useLiveSession, type CreatorMode, type LiveConfig, type NameMode } from '@/live/config'
import { bridgeJoin, bridgeLeave, cleanTikTokUser } from '@/live/connection'
import { giftCatalog, giftEmoji, giftLabel } from '@/live/gifts'
import { simChat, simGift, type SimTarget } from '@/live/simulator'
import { useLive } from '@/live/store'
import type { LiveSource } from '@/live/types'
import { Button, Segmented, Switch, cx, toast } from '@/ui/primitives'
import { useShellSlots } from '@/ui/shell/slots'
import { FeedText, Legend } from './LiveHud'
import { LiveStage } from './LiveStage'
import { GiftIcon, NEW_LEGEND_LABEL, OPTION_COLORS, confirmNewLegend, useNow, whereLabel } from './bits'
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

/**
 * Campo numérico: enquanto a pessoa digita, só salva valores válidos (digitar "50" passa por "5", que é
 * menor que o mínimo — limitar a cada tecla virava "100"); ao sair do campo, ajusta para o intervalo.
 */
function NumberInput({ value, onChange, min, max, step = 1, suffix }: { value: number; onChange: (n: number) => void; min: number; max: number; step?: number; suffix?: string }) {
  const [txt, setTxt] = useState(String(value))
  const focused = useRef(false)
  // valor mudou por fora (outra aba, restaurar padrão): mostra — mas não atropela quem está digitando
  useEffect(() => {
    if (!focused.current) setTxt(String(value))
  }, [value])
  const commit = () => {
    const n = Number(txt)
    const c = txt.trim() === '' || !Number.isFinite(n) ? value : Math.min(max, Math.max(min, Math.round(n)))
    if (c !== value) onChange(c)
    setTxt(String(c))
  }
  return (
    <span className="lx-input lv-num">
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={step}
        value={txt}
        onFocus={() => {
          focused.current = true
        }}
        onChange={(e) => {
          const v = e.target.value
          setTxt(v)
          const n = Number(v)
          if (v.trim() !== '' && Number.isInteger(n) && n >= min && n <= max) onChange(n)
        }}
        onBlur={() => {
          focused.current = false
          commit()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
        }}
      />
      {suffix && <span className="lv-num__s">{suffix}</span>}
    </span>
  )
}

function StatusLine() {
  const status = useLive((s) => s.status)
  const source = useLive((s) => s.source)
  const tone = status.state === 'connected' || status.state === 'demo' ? 'ok' : status.state === 'error' || status.state === 'offline' ? 'bad' : 'wait'
  const label: Record<string, string> = {
    idle: 'Desconectado',
    connecting: 'Conectando…',
    connected: `Conectado${status.user ? ` em @${status.user}` : ''}`,
    offline: 'Esperando a live',
    error: 'Sem conexão',
    // "npm run live:demo": a ponte manda um público de teste (não é a live de verdade)
    demo: source === 'ponte' ? 'Demonstração da ponte' : 'Simulador ligado',
  }
  return (
    <div className={cx('lv-status', `is-${tone}`)} role="status">
      <span className="lv-status__dot" aria-hidden="true" />
      <b>{label[status.state] ?? status.state}</b>
      {status.message && <span>{status.message}</span>}
    </div>
  )
}

/** Chave secreta: escondida (a página de configuração pode acabar na tela da live); "mostrar" por 1 clique. */
function SecretInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false)
  return (
    <span className="lx-input lv-secret">
      <input type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} spellCheck={false} autoComplete="off" data-1p-ignore data-lpignore="true" />
      {value && (
        <button type="button" className="lv-secret__btn" aria-pressed={show} onClick={() => setShow((v) => !v)}>
          {show ? 'esconder' : 'mostrar'}
        </button>
      )}
    </span>
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
              <input value={cfg.username} onChange={(e) => set({ username: cleanTikTokUser(e.target.value) })} placeholder="seuperfil" autoComplete="off" autoCapitalize="none" spellCheck={false} />
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
              No Windows, dê dois cliques em <code>live/INICIAR-LIVE.bat</code> (ele instala o que falta sozinho). Em outro sistema, rode <code>npm install</code> e depois <code>npm run live -- --abrir</code> na pasta <code>lenda</code>.
            </li>
            <li>
              A ponte abre este painel numa janela própria do Chrome/Edge, já na fonte TikTok, em <code>{cfg.bridgeUrl.replace(/^ws(s?):\/\//, 'http$1://').replace(/\/ws\/?$/, '')}</code>. As configurações e as carreiras ficam nessa janela.
            </li>
            <li>Comece a live no TikTok (LIVE Studio ou celular), digite o @ acima e clique em Conectar. A ponte só entra quando a live já está no ar — se ainda não estiver, ela tenta de novo sozinha.</li>
          </ol>
          <button type="button" className="lv-adv" aria-expanded={adv} onClick={() => setAdv((a) => !a)}>
            {adv ? 'Esconder opções avançadas' : 'Opções avançadas'}
          </button>
          {adv && (
            <>
              <Field label="Endereço da ponte" hint="A ponte ajusta sozinha. Mude só se usar a ponte por fora (npm run dev).">
                <span className="lx-input">
                  <input value={cfg.bridgeUrl} onChange={(e) => set({ bridgeUrl: e.target.value.trim() })} spellCheck={false} />
                </span>
              </Field>
              <Field label="Chave do Euler Stream (opcional)" hint="A conexão usa o serviço de assinatura gratuito do Euler Stream; uma chave aumenta os limites em lives grandes. Ela fica escondida para não aparecer na transmissão.">
                <SecretInput value={cfg.signKey} onChange={(v) => set({ signKey: v.trim() })} placeholder="deixe vazio para o plano gratuito" />
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
  const choose = (gift: string) => {
    const bindings = useLiveConfig.getState().config.giftBindings
    const j = bindingConflict(bindings, index, gift)
    setBinding(index, gift)
    // o mesmo presente não vale para duas opções: a outra opção fica com o presente que era desta
    if (j >= 0)
      toast.info(
        `${giftLabel(gift)} agora é da opção ${index + 1}`,
        bindings[index] ? `A opção ${j + 1} ficou com ${giftLabel(bindings[index])}.` : `A opção ${j + 1} ficou sem presente (só comentário).`,
      )
  }
  return (
    <label className="lv-bind" style={{ ['--oc' as string]: OPTION_COLORS[index] }}>
      <b className="lv-bind__n">{index + 1}</b>
      <GiftIcon name={binding} size={22} />
      <span className="lx-input lv-select">
        <select value={binding} onChange={(e) => choose(e.target.value)} aria-label={`Presente da opção ${index + 1}`}>
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

/** Limite de caracteres de um comentário no chat do TikTok. */
const PIN_MAX = 150
const pinLength = (t: string) => Array.from(t).length

/** A primeira versão que cabe em PIN_MAX (as seguintes são mais curtas). */
const fitPin = (...versions: string[]) => versions.find((v) => pinLength(v) <= PIN_MAX) ?? versions[versions.length - 1]

/** Os dois textos para fixar no chat: como votar e quem cria a próxima lenda (cada um até 150 caracteres). */
function pinnedTexts(cfg: LiveConfig): { votes: string; creator: string } {
  const bound = cfg.giftBindings.slice(0, 4).map((g, i) => (g ? { g, n: i + 1 } : null)).filter((x): x is { g: string; n: number } => !!x)
  const named = bound.map(({ g, n }) => `${giftEmoji(g)} ${giftLabel(g)}=${n}`).join(' ')
  // só o nome: é o que a pessoa procura no painel de presentes do TikTok
  const names = bound.map(({ g, n }) => `${giftLabel(g)}=${n}`).join(' ')
  const short = bound.map(({ g, n }) => (giftEmoji(g) === '🎁' ? `${giftLabel(g)}=${n}` : `${giftEmoji(g)}=${n}`)).join(' ')
  const how = cfg.commentVotes ? 'Comente o número da opção para votar' : 'Mande o presente da opção para votar'
  const others = cfg.unboundGiftsFollowComment && cfg.pointsPerCoin > 0 ? 'Outros presentes valem para o número que você comentar' : ''
  const coin = cfg.pointsPerCoin > 0 ? `1 moeda = ${cfg.pointsPerCoin} voto${cfg.pointsPerCoin === 1 ? '' : 's'}` : ''
  const join = (...p: string[]) => p.filter(Boolean).join(' · ')
  const votes = fitPin(
    join(`🗳️ O CHAT DECIDE A CARREIRA! ${how}`, named, others, coin),
    join(`🗳️ ${how}`, named, others, coin),
    join(`🗳️ ${how}`, names, others, coin),
    join(`🗳️ ${how}`, names, others),
    join(`🗳️ ${how}`, short, others, coin),
    join(`🗳️ ${how}`, short, others),
    join(`🗳️ ${how}`, short),
  )
  const cmds = 'o vencedor digita: !criar Nome, País, Posição'
  const creator =
    cfg.creator === 'disputa'
      ? fitPin(`👑 Na disputa, quem doar mais cria a próxima lenda — ${cmds}`, `👑 Quem doar mais na disputa cria a próxima lenda: !criar Nome, País, Posição`)
      : cfg.creator === 'apoiador'
        ? fitPin(`👑 Quem mais doar na carreira cria a próxima lenda, digitando no chat: !criar Nome, País, Posição`, `👑 Maior apoiador da carreira cria a próxima lenda: !criar Nome, País, Posição`)
        : cfg.nameMode === 'apoiador'
          ? `👑 O maior apoiador dá nome à próxima lenda${cfg.identityVote ? ' e o chat vota posição e nacionalidade' : ''}`
          : cfg.identityVote
            ? '👑 O chat vota posição e nacionalidade da próxima lenda'
            : '👑 O chat decide cada escolha da carreira'
  return { votes, creator }
}

function PinBox({ label, text }: { label: string; text: string }) {
  const [ok, setOk] = useState(false)
  const n = pinLength(text)
  return (
    <div className="lv-pin">
      <span className="lv-pin__head">
        <span className="lx-label">{label}</span>
        <span className={cx('lv-pin__count tabular-nums', n > PIN_MAX && 'is-over')} title="O chat do TikTok aceita até 150 caracteres por comentário">
          {n}/{PIN_MAX}
        </span>
      </span>
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

function PinnedText() {
  const cfg = useLiveConfig((s) => s.config)
  const { votes, creator } = useMemo(() => pinnedTexts(cfg), [cfg])
  return (
    <div className="lv-pins is-wide">
      <span className="lv-field__hint">Textos para fixar no chat — um de cada vez (o TikTok aceita até 150 caracteres por comentário):</span>
      <div className="lv-pins__grid">
        <PinBox label="Como votar" text={votes} />
        <PinBox label="Próxima lenda" text={creator} />
      </div>
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
        <Switch
          checked={cfg.unboundGiftsFollowComment}
          onChange={(v) => set({ unboundGiftsFollowComment: v })}
          label="Outros presentes seguem o comentário"
          description="Presente que não é de opção vale para o número que a pessoa comentar nesta votação (fica guardado até ela comentar)"
        />
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

/** Teste de um botão: entrou na live desta janela ou foi para a janela da live (painel). */
type SentLog = (label: string, target: SimTarget) => void

function CreatorTests({ remote, log }: { remote: LiveSummary | null; log: SentLog }) {
  const local = useLive((s) => s.creation)
  const phase = remote ? remote.creation?.phase : local?.phase
  const winner = remote ? remote.creation?.winner : local?.winner?.user
  if (!phase) return null
  if (phase === 'bidding')
    return (
      <div className="lv-tests">
        <b className="lv-tests__k">Disputa aberta:</b>
        <Button variant="ghost" size="sm" onClick={() => log('Lance de 30 moedas', simGift('Doughnut'))}>
          <GiftIcon name="Doughnut" size={16} /> Dar lance (30 moedas)
        </Button>
      </div>
    )
  if (!winner) return null
  return (
    <div className="lv-tests">
      <b className="lv-tests__k">Como @{winner.id}:</b>
      {['!nome GABIGOL', '!pais Argentina', '!posicao goleiro', '!criar Fenômeno, Brasil, atacante', '!ok'].map((t) => (
        <Button key={t} variant="ghost" size="sm" onClick={() => log(`@${winner.id}: ${t}`, simChat(t, winner))}>
          {t}
        </Button>
      ))}
    </div>
  )
}

function TestSection() {
  const bindings = useLiveConfig((s) => s.config.giftBindings)
  const real = useLiveConfig((s) => !LIVE_SANDBOXED && s.config.source !== 'simulador')
  const round = useLive((s) => s.round)
  const feed = useLive((s) => s.feed)
  const now = useNow(true, 1000)
  // a live roda em outra janela (ou no OBS): os testes vão para ela (pelo canal entre janelas ou pela
  // ponte) — o resultado aparece lá
  const holder = lockHolder(now)
  const remote = holder?.summary ?? null
  const there = whereLabel(holder)
  const [sent, setSent] = useState<{ id: number; text: string }[]>([])
  const log: SentLog = (label, target) => {
    if (target === 'remote') setSent((l) => [{ id: Date.now() + Math.random(), text: label }, ...l].slice(0, 6))
  }
  const open = remote ? !!(remote.round || remote.creation) : !!round
  return (
    <Section n={4} title="Testar votos" icon={Gift}>
      <p className="lv-note">
        {remote
          ? `A live está rodando ${there.at}: estes botões mandam o teste para lá (veja o resultado lá). Não vão para o TikTok.`
          : 'Botões de teste (não vão para o TikTok). Funcionam durante uma votação — inicie o modo live e use aqui ou no simulador.'}
        {real && ' Numa live de verdade, o teste conta voto, mas não vira apoiador nem lance.'}
      </p>
      {remote ? (
        <p className="lv-tests__k">
          {remote.round ? `Votação aberta ${there.at}: ${remote.round} (${remote.secondsLeft ?? 0} s)` : remote.creation ? (remote.creation.phase === 'bidding' ? `Disputa aberta ${there.at}` : `Criação da lenda ${there.at}`) : `Nenhuma votação aberta ${there.at} agora.`}
        </p>
      ) : (
        round && <Legend round={round} />
      )}
      <CreatorTests remote={remote} log={log} />
      <div className={cx('lv-tests', !open && 'is-idle')}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="lv-test" style={{ ['--oc' as string]: OPTION_COLORS[i] }}>
            <b>{i + 1}</b>
            <Button variant="ghost" size="sm" onClick={() => log(`Comentar “${i + 1}”`, simChat(String(i + 1)))}>
              Comentar “{i + 1}”
            </Button>
            {bindings[i] && (
              <Button variant="ghost" size="sm" onClick={() => log(giftLabel(bindings[i]), simGift(bindings[i]))}>
                <GiftIcon name={bindings[i]} size={16} /> {giftLabel(bindings[i])}
              </Button>
            )}
          </div>
        ))}
        <Button variant="ghost" size="sm" onClick={() => log('Galáxia (1.000 moedas)', simGift('Galaxy'))}>
          <GiftIcon name="Galaxy" size={16} /> Galáxia (1.000)
        </Button>
      </div>
      {remote ? (
        sent.length > 0 && (
          <ul className="lv-log" aria-label={`Testes enviados ${there.to}`}>
            {sent.map((f) => (
              <li key={f.id}>
                Enviado {there.to}: <b>{f.text}</b>
              </li>
            ))}
          </ul>
        )
      ) : (
        feed.length > 0 && (
          <ul className="lv-log" aria-label="Últimos eventos">
            {feed.slice(0, 6).map((f) => (
              <li key={f.id}>
                <FeedText item={f} />
              </li>
            ))}
          </ul>
        )
      )}
    </Section>
  )
}

function StreamSection() {
  const safeArea = useLiveConfig((s) => s.config.safeArea)
  const bridgeUrl = useLiveConfig((s) => s.config.bridgeUrl)
  const set = useLiveConfig((s) => s.set)
  const obsUrl = `${bridgeUrl.replace(/^ws(s?):\/\//, 'http$1://').replace(/\/ws\/?$/, '')}/obs`
  return (
    <Section n={5} title="Transmitir no TikTok" icon={MonitorPlay}>
      <ol className="lv-steps">
        <li>
          Abra o <b>TikTok LIVE Studio</b> no PC e crie uma cena <b>vertical</b> (9:16).
        </li>
        <li>
          Clique em <b>Abrir janela da live (9:16)</b>, no topo desta página: o jogo abre numa janela em pé (540×960), pronta e esperando. No LIVE Studio, adicione uma fonte <b>Captura de janela</b> e escolha essa janela.
        </li>
        <li>
          Comece a live. Com ela no ar, clique em <b>Iniciar modo live</b> (ou <b>Continuar</b> a carreira salva) no topo desta página: o jogo começa na janela da live. Fixe no chat o texto de como votar.
        </li>
        <li>Use esta aba como painel de controle: pausar, encerrar a votação ou a disputa, nova lenda e parar. Os comandos e os botões de teste vão para a janela da live.</li>
      </ol>
      {!LIVE_SANDBOXED && (
        <p className="lv-note">
          <MonitorPlay size={16} aria-hidden="true" />
          <span>
            Transmite pelo <b>OBS</b>? O <code>live/INSTALAR-OBS.bat</code> põe no OBS a cena pronta, e o <code>live/LIVE-OBS.bat</code> abre tudo em cada live. À mão: no lugar da janela da live, adicione uma fonte <b>Navegador</b> com o endereço <code>{obsUrl}</code> e tamanho <b>1080×1920</b> (ou 720×1280). Com a ponte aberta, este painel comanda a live do OBS do mesmo jeito: começar, pausar, testes e as configurações daqui valem lá.
          </span>
        </p>
      )}
      <Switch
        checked={safeArea}
        onChange={(v) => set({ safeArea: v })}
        label="Área segura do TikTok"
        description="Na janela da live (9:16), a faixa fica abaixo do nome e dos espectadores no topo, e as opções e os votos ficam acima do chat e dos presentes, que o TikTok desenha por cima da parte de baixo."
      />
      <p className="lv-note">
        Siga as regras de LIVE do TikTok: os presentes só influenciam as escolhas do jogo — não prometa prêmios, dinheiro ou vantagens fora da live em troca de presentes.
      </p>
    </Section>
  )
}

function ControlBar() {
  const on = useLiveSession((s) => s.on)
  const paused = useLiveSession((s) => s.paused)
  const stop = useLiveSession((s) => s.stop)
  const creator = useLiveConfig((s) => s.config.creator)
  const active = useCareer(selectHasActiveCareer)
  const state = useCareer((s) => s.state)
  const now = useNow(true, 1000)
  const other = useMemo(() => lockHolder(now), [now])
  // janela da live aberta e esperando: os botões de começar mandam o começo para ela
  const ready = useMemo(() => (on || other ? null : captureReady(now)), [now, on, other])
  const [sent, setSent] = useState<{ at: number; where: ReturnType<typeof whereLabel> }>({ at: 0, where: whereLabel(null) })
  const starting = !other && !on && now - sent.at < 6000
  // a live rodava em outra janela e parou (ou esta aba voltou ao foco): relê carreira e Hall antes de
  // oferecer "Continuar" — a memória desta aba pode estar velha
  const otherOn = !!other
  const hadOther = useRef(otherOn)
  useEffect(() => {
    if (hadOther.current && !otherOn) void useCareer.getState().reload()
    hadOther.current = otherOn
  }, [otherOn])
  useEffect(() => {
    const onFocus = () => {
      if (!useLiveSession.getState().on) void useCareer.getState().reload()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])
  const openWindow = () => {
    const url = `${location.origin}${location.pathname}#/live?tela=palco&janela=1`
    const w = window.open(url, CAPTURE_WINDOW_NAME, 'popup=yes,width=540,height=960')
    if (!w) toast.error('O navegador bloqueou a janela', 'Libere pop-ups para este endereço e tente de novo.')
    else w.focus()
  }
  // live pronta no OBS: o OBS é outro navegador, com as carreiras dele — "Continuar" e a confirmação da nova
  // lenda seguem a carreira salva lá (vem no batimento), não a deste painel
  const careerName = ready?.where === 'obs' ? ready.career : active ? state?.identity.surname : undefined
  const begin = (mode: StartMode) => {
    if (mode === 'new' && careerName && !confirmNewLegend(careerName)) return
    if (ready) {
      sendLiveStart(mode, ready.id)
      setSent({ at: Date.now(), where: whereLabel(ready) })
      return
    }
    requestStart(mode)
  }
  const sum = other?.summary
  const otherAt = whereLabel(other).at
  const readyAt = whereLabel(ready).at
  const closeLabel = sum?.creation ? (sum.creation.phase === 'bidding' ? 'Encerrar disputa' : 'Encerrar criação') : 'Encerrar votação'
  const otherText = sum
    ? [
        `Rodando ${otherAt}`,
        sum.paused && 'pausado',
        sum.creation
          ? sum.creation.phase === 'bidding'
            ? `disputa (${sum.creation.secondsLeft}s)`
            : `criação${sum.creation.winner ? ` por @${sum.creation.winner.id}` : ''} (${sum.creation.secondsLeft}s)`
          : sum.round && `votação: ${sum.round} (${sum.secondsLeft ?? 0}s)`,
      ]
        .filter(Boolean)
        .join(' · ')
    : `Rodando ${otherAt}`
  return (
    <div className="lv-ctrl lx-glass lx-top-light">
      <div className="lv-ctrl__txt">
        <span className="lv-ctrl__k">
          <Radio size={14} aria-hidden="true" /> Modo live
        </span>
        <b>
          {other
            ? otherText
            : starting
              ? `Começando ${sent.where.at}…`
              : on
                ? paused
                  ? 'Ligado · votações pausadas'
                  : 'Ligado · o chat está no controle'
                : ready
                  ? ready.where === 'obs'
                    ? 'Live pronta no OBS · esperando você começar'
                    : 'Janela da live aberta · esperando você começar'
                  : 'Desligado'}
        </b>
        <span>
          {ready && !starting
            ? `Com a live no ar, clique em Iniciar modo live (ou Continuar): o jogo começa ${readyAt}.`
            : 'O chat decide cada escolha do Modo Clássico. Você pode pausar a qualquer momento.'}
        </span>
      </div>
      <div className="lv-ctrl__btns">
        {other ? (
          <>
            <Button variant="ghost" icon={sum?.paused ? Play : Pause} onClick={() => sendLiveCommand(sum?.paused ? 'resume' : 'pause')}>
              {sum?.paused ? 'Retomar' : 'Pausar'}
            </Button>
            <Button variant="ghost" disabled={!sum?.round && !sum?.creation} onClick={() => sendLiveCommand('close-vote')}>
              {closeLabel}
            </Button>
            <Button
              variant="ghost"
              icon={Sparkles}
              disabled={sum?.stage === 'identity'}
              onClick={() => {
                if (confirmNewLegend(sum?.career)) sendLiveCommand('new-legend')
              }}
            >
              {NEW_LEGEND_LABEL[creator]}
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
            <Button variant="ghost" icon={paused ? Play : Pause} onClick={() => useLiveSession.getState().setPaused(!paused)}>
              {paused ? 'Retomar' : 'Pausar'}
            </Button>
            <Button
              variant="ghost"
              icon={Sparkles}
              onClick={() => {
                if (confirmNewLegend(active ? state?.identity.surname : null)) newLegendNow()
              }}
            >
              {NEW_LEGEND_LABEL[creator]}
            </Button>
            <Button variant="danger" icon={Square} onClick={() => stop()}>
              Sair do modo live
            </Button>
          </>
        ) : (
          <>
            {!LIVE_SANDBOXED && (
              <Button variant="ghost" icon={MonitorPlay} onClick={openWindow}>
                {ready && ready.where !== 'obs' ? 'Mostrar janela da live' : 'Abrir janela da live (9:16)'}
              </Button>
            )}
            {careerName && (
              <Button variant="ghost" icon={Play} disabled={starting} onClick={() => begin('continue')}>
                Continuar {careerName}
              </Button>
            )}
            <Button variant="primary" icon={careerName ? Sparkles : Play} disabled={starting} onClick={() => begin('new')}>
              {careerName ? NEW_LEGEND_LABEL[creator] : 'Iniciar modo live'}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Janela da live antes de começar (é o que a captura do LIVE Studio / o OBS mostra): "a live vai começar" para
 * o público. O painel (a aba de configurações) manda o começo; os botões daqui só aparecem com o mouse em cima.
 */
function CaptureReady() {
  const creator = useLiveConfig((s) => s.config.creator)
  const active = useCareer(selectHasActiveCareer)
  const state = useCareer((s) => s.state)
  const now = useNow(true, 1000)
  const other = lockHolder(now)
  const obs = isObsView()
  return (
    <main id="conteudo" className="lv-stage lv-ready" tabIndex={-1}>
      <div className="lv-stage__card lx-glass lx-top-light">
        <div className="lv-stage__idle">
          <Radio size={32} aria-hidden="true" />
          <h1 className="lv-stage__t">{other ? `A live está rodando ${other.where === 'obs' ? 'no OBS' : 'em outra janela'}` : 'A live já vai começar!'}</h1>
          {!other && (
            <p className="lv-stage__how">
              {creator === 'disputa'
                ? 'Prepare os presentes: quem doar mais na disputa cria a próxima lenda.'
                : creator === 'apoiador'
                  ? 'Quem mais doar na carreira cria a próxima lenda.'
                  : 'O chat vai decidir cada escolha da carreira.'}
            </p>
          )}
          {!other && (
            // controles do streamer: escondidos para o público, aparecem ao passar o mouse (ou com o teclado)
            <div className="lv-ready__ctrl">
              <p className="lv-stage__empty">
                {obs ? (
                  <>
                    Pronta no OBS. Para começar, clique em <b>Iniciar modo live</b> no painel da live (a janela de configurações) — ou aqui, pelo <b>Interagir</b> do OBS:
                  </>
                ) : (
                  <>
                    Janela pronta para a <b>Captura de janela</b> do LIVE Studio. Para começar, clique em <b>Iniciar modo live</b> na aba de configurações — ou aqui:
                  </>
                )}
              </p>
              <div className="lv-actions" style={{ justifyContent: 'center', marginTop: 10 }}>
                {active && state && (
                  <Button variant="ghost" icon={Play} onClick={() => requestStart('continue')}>
                    Continuar {state.identity.surname}
                  </Button>
                )}
                <Button
                  variant="primary"
                  icon={active ? Sparkles : Play}
                  onClick={() => {
                    if (!active || confirmNewLegend(state?.identity.surname)) requestStart('new')
                  }}
                >
                  {active ? NEW_LEGEND_LABEL[creator] : 'Iniciar modo live'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}

const HERO_CREATOR: Record<CreatorMode, string> = {
  disputa: 'Antes de cada carreira, quem doar mais na disputa cria a próxima lenda.',
  apoiador: 'Quem mais doar na carreira cria a próxima lenda.',
  votacao: 'O chat também vota como vai ser a próxima lenda.',
}

function LiveSetup() {
  const creator = useLiveConfig((s) => s.config.creator)
  const heroText = `O chat comanda a carreira: cada decisão vira uma votação — vale comentar o número da opção ou mandar o presente dela. ${HERO_CREATOR[creator]}`
  return (
    <main id="conteudo" className="lv-setup" tabIndex={-1}>
      <header className="lv-setup__hero">
        <span className="lx-eyebrow">TikTok LIVE</span>
        <h1>Live interativa</h1>
        <p>{heroText}</p>
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
  const { tela, iniciar, janela } = frozen.current
  const on = useLiveSession((s) => s.on)
  useShellSlots({ sub: 'LIVE' }, [])
  // janela aberta por "Abrir janela da live": fica PRONTA, sem começar — o streamer começa quando estiver
  // no ar (pelo painel, que manda o começo para cá, ou pelos botões da própria janela)
  useEffect(() => {
    if (!iniciar && !janela) return
    markCaptureWindow()
    navigate('/live', { query: { tela: tela ?? 'palco' }, replace: true })
  }, [iniciar, janela, tela])
  void route
  if (tela === 'palco') return !on && isCaptureWindow() ? <CaptureReady /> : <LiveStage />
  return <LiveSetup />
}

export default LiveScreen
