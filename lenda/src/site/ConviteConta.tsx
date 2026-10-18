/**
 * Diálogo de conta: o convite que aparece depois das 5 partidas e o "Entrar / Criar conta" do menu.
 *
 *   abas: Criar conta (apelido, e-mail, senha, aceite; time do coração e estado opcionais)
 *         Já tenho conta (e-mail, senha) → Esqueci a senha (e-mail → código de 6 dígitos + nova senha); "Já recebi um
 *         código" vai direto ao código (o que a equipe do LENDA mandou pelo painel, v3.2 — pedir outro trocaria esse)
 *
 * "Agora não" só existe com obrigatorio=false (o convite volta depois de mais `lembrarACada` partidas).
 * No celular vira bottom sheet e sobe junto com o teclado; o botão fica logo abaixo do último campo.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { CircleCheck, Cloud, Crown, Gift, Info, Plus, Sparkles, Users, X } from 'lucide-react'
import { useAcesso } from '@/store/acesso'
import { Button, Modal, Tabs, toast, useIsDesktop } from '@/ui/primitives'
import { mensagemDeErro } from './api'
import { Campo, CampoSenha, CampoUf, Erro, useTecladoVirtual } from './campos'
import { erroApelido, erroEmail, erroSenha, useConta } from './conta'
import { conviteGuardado } from './indicacao'
import { armazem, track } from './medicao'
import { abrirVerificarEmail, useSiteUi, type AbaConta } from './ui'
import './site.css'

type Tela = AbaConta | 'esqueci' | 'codigo'

const ls = armazem(() => (typeof window !== 'undefined' ? window.localStorage : undefined))

export default function ConviteConta() {
  const d = useSiteUi((s) => s.dialogo)
  const fechar = useSiteUi((s) => s.fechar)
  const regras = useConta((s) => s.regras)
  const partidas = useConta((s) => s.partidas)
  const desktop = useIsDesktop()
  const aberto = d?.tipo === 'conta'
  const convite = aberto && d.modo === 'convite'
  const salvarDepois = aberto ? d.depois?.salvar : undefined
  const podeFechar = !convite || !regras.obrigatorio
  const [tela, setTela] = useState<Tela>(aberto && d.aba ? d.aba : convite ? 'criar' : 'entrar')
  const [emailEsqueci, setEmailEsqueci] = useState('')
  const [codigoJaTinha, setCodigoJaTinha] = useState(false)
  // cadastros fechados pelo painel: só "Entrar" (quem já tem conta continua entrando)
  const cadastroAberto = useAcesso((s) => s.cadastroAberto)
  useTecladoVirtual(aberto)
  useEffect(() => {
    if (!cadastroAberto && tela === 'criar') setTela('entrar')
  }, [cadastroAberto, tela])

  // cada abertura começa na aba pedida (convite e "salvar esta carreira": criar; menu: entrar)
  const abaInicial: Tela = aberto && d.aba ? d.aba : convite || salvarDepois ? 'criar' : 'entrar'
  const chave = aberto ? `${d.modo}:${d.aba ?? ''}:${salvarDepois ?? ''}` : ''
  useEffect(() => {
    if (aberto) setTela(abaInicial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, chave])

  const agoraNao = () => {
    if (!podeFechar) return
    if (convite) {
      useConta.getState().adiarConvite()
      track('gate_fechar', null, { partidas })
    }
    fechar()
  }
  const pronto = (apelido: string, novo: boolean) => {
    fechar()
    toast.success(novo ? `Conta criada. Bem-vindo, ${apelido}!` : `Bem-vindo de volta, ${apelido}!`, salvarDepois ? 'Salvando a carreira na sua conta…' : 'Suas carreiras 90+ agora vão sozinhas para a sua conta.')
    // v3.3: conta nova com o código a caminho — o diálogo de confirmar o e-mail (servidor antigo não manda o campo: nada abre)
    const u = useConta.getState().usuario
    if (novo && u && !u.emailVerificado) abrirVerificarEmail(true)
  }

  const titulo = convite ? (
    <>
      Você já jogou <em>{partidas} partidas!</em>
    </>
  ) : tela === 'esqueci' || tela === 'codigo' ? (
    'Trocar a senha'
  ) : salvarDepois ? (
    'Salve esta carreira na sua conta'
  ) : (
    'Sua conta no LENDA'
  )
  const autoFoco = desktop && !convite

  return (
    <Modal
      open={aberto}
      onClose={agoraNao}
      dismissible={podeFechar}
      hideClose
      size="md"
      className="sc-modal"
      aria-label={convite ? `Você já jogou ${partidas} partidas! Crie sua conta` : 'Conta'}
      footer={
        convite && podeFechar ? (
          <div className="sc-foot" style={{ width: '100%' }}>
            <Button variant="text" size="sm" onClick={agoraNao}>
              Agora não
            </Button>
          </div>
        ) : undefined
      }
    >
      <header className="sc-hero">
        <div className="sc-hero__row">
          <span className="sc-hero__k">
            <Sparkles aria-hidden="true" /> {convite ? 'Conta grátis' : 'LENDA'}
          </span>
          {podeFechar && (
            <button type="button" className="lx-icon-btn lx-icon-btn--sm sc-hero__x" aria-label="Fechar" onClick={agoraNao}>
              <X aria-hidden="true" />
            </button>
          )}
        </div>
        <h2 className="sc-hero__t" id="sc-conta-t">
          {titulo}
        </h2>
        {tela !== 'esqueci' && tela !== 'codigo' && (
          <p className="sc-hero__p">{convite ? 'Crie sua conta grátis em menos de um minuto e nunca mais perca uma carreira.' : 'Entre ou crie sua conta para guardar suas carreiras em qualquer aparelho.'}</p>
        )}
      </header>

      {(tela === 'criar' || tela === 'entrar') && (
        <>
          {(convite || salvarDepois || tela === 'criar') && (
            <ul className="sc-perks" aria-label="Por que criar uma conta">
              <li className="sc-perk">
                <span className="sc-perk__i">
                  <Cloud aria-hidden="true" />
                </span>
                <b>Carreiras e Hall salvos em qualquer aparelho</b>
              </li>
              <li className="sc-perk">
                <span className="sc-perk__i">
                  <Crown aria-hidden="true" />
                </span>
                <b>Pico 90+ vai sozinho para a conta</b>
              </li>
              <li className="sc-perk">
                <span className="sc-perk__i">
                  <Users aria-hidden="true" />
                </span>
                <b>Suas lendas no Hall da comunidade</b>
              </li>
            </ul>
          )}
          {cadastroAberto ? (
            <Tabs
              aria-label="Conta"
              idPrefix="sc-conta"
              className="sc-tabs"
              value={tela}
              onChange={(v) => setTela(v)}
              tabs={[
                { value: 'criar', label: 'Criar conta' },
                { value: 'entrar', label: 'Já tenho conta' },
              ]}
            />
          ) : (
            <p className="sc-ok sc-aviso-cad" role="status">
              <Info aria-hidden="true" />
              <span>Novos cadastros estão fechados no momento. Quem já tem conta entra normalmente.</span>
            </p>
          )}
          <div role="tabpanel" id={`sc-conta-panel-${tela}`} aria-labelledby={cadastroAberto ? `sc-conta-tab-${tela}` : undefined}>
            {tela === 'criar' && cadastroAberto ? <FormCriar autoFoco={autoFoco} onPronto={(a) => pronto(a, true)} /> : <FormEntrar autoFoco={autoFoco} onPronto={(a) => pronto(a, false)} onEsqueci={() => setTela('esqueci')} />}
          </div>
        </>
      )}
      {tela === 'esqueci' && (
        <FormEsqueci
          onEnviado={(email, jaTinha) => {
            setEmailEsqueci(email)
            setCodigoJaTinha(jaTinha)
            setTela('codigo')
          }}
          onVoltar={() => setTela('entrar')}
        />
      )}
      {tela === 'codigo' && <FormCodigo email={emailEsqueci} jaTinha={codigoJaTinha} onPronto={(a) => pronto(a, false)} onVoltar={() => setTela('esqueci')} />}
    </Modal>
  )
}

function useEnvio() {
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const vivo = useRef(true)
  useEffect(
    () => () => {
      vivo.current = false
    },
    [],
  )
  const rodar = async (fn: () => Promise<void>) => {
    if (carregando) return
    setCarregando(true)
    setErro(null)
    try {
      await fn()
    } catch (err) {
      if (vivo.current) setErro(mensagemDeErro(err))
    } finally {
      if (vivo.current) setCarregando(false)
    }
  }
  return { carregando, erro, setErro, rodar }
}

function FormCriar({ autoFoco, onPronto }: { autoFoco: boolean; onPronto: (apelido: string) => void }) {
  const [apelido, setApelido] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [aceite, setAceite] = useState(false)
  const [mais, setMais] = useState(false)
  const [time, setTime] = useState('')
  const [uf, setUf] = useState('')
  const [tentou, setTentou] = useState(false)
  const { carregando, erro, rodar } = useEnvio()
  const [convite] = useState(() => conviteGuardado(ls))
  const eA = tentou ? erroApelido(apelido.trim()) : null
  const eE = tentou ? erroEmail(email) : null
  const eS = tentou ? erroSenha(senha) : null
  const eAc = tentou && !aceite

  const enviar = (e: FormEvent) => {
    e.preventDefault()
    setTentou(true)
    if (erroApelido(apelido.trim()) || erroEmail(email) || erroSenha(senha) || !aceite) {
      // foco no primeiro campo com problema
      const form = e.currentTarget as HTMLFormElement
      window.setTimeout(() => form.querySelector<HTMLElement>('[aria-invalid="true"], .sc-check[data-invalid="true"] input')?.focus(), 0)
      return
    }
    void rodar(async () => {
      const u = await useConta.getState().cadastrar({ apelido, email, senha, timeCoracao: time, uf })
      onPronto(u.apelido)
    })
  }

  return (
    <form className="sc-form" onSubmit={enviar} noValidate aria-busy={carregando}>
      <Campo label="Apelido" aside="aparece no ranking" value={apelido} onChange={(v) => setApelido(v.replace(/^\s+/, '').slice(0, 20))} erro={eA} autoComplete="nickname" autoCapitalize="words" maxLength={20} required enterKeyHint="next" autoFoco={autoFoco} />
      <Campo label="E-mail" type="email" inputMode="email" value={email} onChange={setEmail} erro={eE} autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={190} required enterKeyHint="next" />
      <CampoSenha label="Senha" value={senha} onChange={setSenha} erro={eS} dica="Pelo menos 6 caracteres." novo enterKeyHint="go" />
      <label className="sc-check" data-invalid={eAc ? 'true' : undefined}>
        <input type="checkbox" checked={aceite} onChange={(e) => setAceite(e.target.checked)} aria-invalid={eAc ? true : undefined} required />
        <span>
          Li e aceito a{' '}
          <a href="privacidade.html" target="_blank" rel="noopener">
            Política de Privacidade
          </a>
          .
        </span>
      </label>
      {eAc && <p className="sc-hint" style={{ color: 'var(--nx-negative-soft, #ffc3cd)', marginTop: -6 }}>Para criar a conta, aceite a Política de Privacidade.</p>}
      <button type="button" className="sc-more" aria-expanded={mais} aria-controls="sc-mais" onClick={() => setMais((v) => !v)}>
        <Plus aria-hidden="true" /> Time do coração e estado <span style={{ fontWeight: 600, color: 'var(--text-3)' }}>(opcional)</span>
      </button>
      {mais && (
        <div id="sc-mais" className="sc-row2">
          <Campo label="Time do coração" value={time} onChange={(v) => setTime(v.slice(0, 40))} maxLength={40} autoComplete="off" autoCapitalize="words" placeholder="Ex.: Flamengo" />
          <CampoUf value={uf} onChange={setUf} />
        </div>
      )}
      {erro && <Erro>{erro}</Erro>}
      {convite && (
        <p className="sc-hint sc-hint--convite">
          <Gift aria-hidden="true" /> Você veio pelo convite de um amigo: quando terminar a 1ª carreira com a conta, ele ganha bônus de OVR.
        </p>
      )}
      <Button type="submit" variant="primary" size="lg" block loading={carregando} icon={carregando ? undefined : CircleCheck}>
        {carregando ? 'Criando a conta…' : 'Criar conta'}
      </Button>
    </form>
  )
}

function FormEntrar({ autoFoco, onPronto, onEsqueci }: { autoFoco: boolean; onPronto: (apelido: string) => void; onEsqueci: () => void }) {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [tentou, setTentou] = useState(false)
  const { carregando, erro, rodar } = useEnvio()
  const eE = tentou ? erroEmail(email) : null
  const eS = tentou && !senha ? 'Digite a sua senha.' : null
  const enviar = (e: FormEvent) => {
    e.preventDefault()
    setTentou(true)
    if (erroEmail(email) || !senha) return
    void rodar(async () => {
      const u = await useConta.getState().entrar(email, senha)
      onPronto(u.apelido)
    })
  }
  return (
    <form className="sc-form" onSubmit={enviar} noValidate aria-busy={carregando}>
      <Campo label="E-mail" type="email" inputMode="email" value={email} onChange={setEmail} erro={eE} autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={190} required enterKeyHint="next" autoFoco={autoFoco} />
      <CampoSenha label="Senha" value={senha} onChange={setSenha} erro={eS} enterKeyHint="go" />
      {erro && <Erro>{erro}</Erro>}
      <Button type="submit" variant="primary" size="lg" block loading={carregando}>
        {carregando ? 'Entrando…' : 'Entrar'}
      </Button>
      <button type="button" className="sc-link" onClick={onEsqueci} style={{ justifySelf: 'center' }}>
        Esqueci a senha
      </button>
    </form>
  )
}

function FormEsqueci({ onEnviado, onVoltar }: { onEnviado: (email: string, jaTinha: boolean) => void; onVoltar: () => void }) {
  const [email, setEmail] = useState('')
  const [tentou, setTentou] = useState(false)
  const { carregando, erro, rodar } = useEnvio()
  const eE = tentou ? erroEmail(email) : null
  const enviar = (e: FormEvent) => {
    e.preventDefault()
    setTentou(true)
    if (erroEmail(email)) return
    void rodar(async () => {
      await useConta.getState().esqueci(email)
      onEnviado(email.trim(), false)
    })
  }
  // o código veio por outro caminho (a equipe do LENDA mandou, v3.2): pedir outro trocaria o que chegou
  const jaTenho = () => {
    setTentou(true)
    if (!erroEmail(email)) onEnviado(email.trim(), true)
  }
  return (
    <form className="sc-form" onSubmit={enviar} noValidate aria-busy={carregando}>
      <p className="sc-hero__p">Digite o e-mail da sua conta. Se ele estiver cadastrado, você recebe um código de 6 dígitos (vale por 30 minutos).</p>
      <Campo label="E-mail" type="email" inputMode="email" value={email} onChange={setEmail} erro={eE} autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={190} required enterKeyHint="send" autoFoco />
      {erro && <Erro>{erro}</Erro>}
      <Button type="submit" variant="primary" size="lg" block loading={carregando}>
        {carregando ? 'Enviando…' : 'Enviar código'}
      </Button>
      <div className="sc-links" style={{ justifyContent: 'center' }}>
        <button type="button" className="sc-link" onClick={jaTenho}>
          Já recebi um código
        </button>
        <button type="button" className="sc-link" onClick={onVoltar}>
          Voltar para entrar
        </button>
      </div>
    </form>
  )
}

function FormCodigo({ email, jaTinha, onPronto, onVoltar }: { email: string; jaTinha?: boolean; onPronto: (apelido: string) => void; onVoltar: () => void }) {
  const [codigo, setCodigo] = useState('')
  const [senha, setSenha] = useState('')
  const [tentou, setTentou] = useState(false)
  const { carregando, erro, rodar } = useEnvio()
  const eC = tentou && !/^\d{6}$/.test(codigo) ? 'O código tem 6 números.' : null
  const eS = tentou ? erroSenha(senha) : null
  const enviar = (e: FormEvent) => {
    e.preventDefault()
    setTentou(true)
    if (!/^\d{6}$/.test(codigo) || erroSenha(senha)) return
    void rodar(async () => {
      const u = await useConta.getState().redefinir(email, codigo, senha)
      onPronto(u.apelido)
    })
  }
  return (
    <form className="sc-form" onSubmit={enviar} noValidate aria-busy={carregando}>
      <p className="sc-ok" role="status">
        <CircleCheck aria-hidden="true" />
        {jaTinha ? (
          <span>
            Digite o código de 6 dígitos que chegou em <b>{email}</b> (ele vale por 30 minutos).
          </span>
        ) : (
          <span>
            Se <b>{email}</b> tiver conta, o código chega em instantes. Confira também a caixa de spam.
          </span>
        )}
      </p>
      <Campo
        label="Código de 6 dígitos"
        value={codigo}
        onChange={(v) => setCodigo(v.replace(/\D/g, '').slice(0, 6))}
        erro={eC}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        enterKeyHint="next"
        autoFoco
        style={{ letterSpacing: '.3em', fontWeight: 800 }}
      />
      <CampoSenha label="Nova senha" value={senha} onChange={setSenha} erro={eS} dica="Pelo menos 6 caracteres." novo enterKeyHint="go" />
      {erro && <Erro>{erro}</Erro>}
      <Button type="submit" variant="primary" size="lg" block loading={carregando}>
        {carregando ? 'Trocando…' : 'Trocar a senha e entrar'}
      </Button>
      <div className="sc-links" style={{ justifyContent: 'center' }}>
        <button type="button" className="sc-link" onClick={onVoltar}>
          Não chegou? Pedir outro código
        </button>
      </div>
    </form>
  )
}
