// Entrada do painel: primeiro acesso (código de instalação + login + senha), entrar, esqueci a senha e a folha que
// aparece por cima quando a sessão cai no meio do trabalho (a tela de trás continua com o que estava digitado).
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Logo, LogoPixel } from '../../arte/Logo'
import * as api from '../api'
import { ErroApi } from '../api'
import { Folha } from '../Folha'
import { lembrar, lido } from '../lembrar'
import type { Usuario } from '../tipos'
import { Aviso, Botao, Campo, Ic } from '../ui'

type Erros = Record<string, string | undefined>

const LOGIN_OK = /^[a-z0-9._-]{3,32}$/

function validarSenha(s: string): string | undefined {
  if (s.length < 10) return 'A senha precisa de 10 caracteres ou mais.'
  if (s.length > 72) return 'Senha até 72 caracteres.'
  return undefined
}

/** Foca o primeiro campo com erro (na ordem do formulário). */
function focarErro(form: HTMLFormElement | null, erros: Erros) {
  const primeiro = Object.keys(erros).find((k) => erros[k])
  if (!primeiro || !form) return
  const el = form.querySelector<HTMLElement>(`[name="${primeiro}"]`)
  el?.focus()
}

/** Campo de senha com "Mostrar". */
function CampoSenha({ id, nome, rotulo, valor, aoMudar, erro, dica, auto, refInput }: { id: string; nome: string; rotulo: string; valor: string; aoMudar: (v: string) => void; erro?: string; dica?: ReactNode; auto: 'current-password' | 'new-password'; refInput?: React.RefObject<HTMLInputElement | null> }) {
  const [ver, setVer] = useState(false)
  return (
    <Campo id={id} rotulo={rotulo} erro={erro} dica={dica}>
      {(aria) => (
        <div className="pn-senha">
          <input
            {...aria}
            ref={refInput}
            name={nome}
            className="pn-input"
            type={ver ? 'text' : 'password'}
            autoComplete={auto}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={valor}
            onChange={(e) => aoMudar(e.target.value)}
            maxLength={72}
          />
          <button type="button" className="pn-senha-ver" aria-pressed={ver} aria-label={ver ? 'Esconder a senha' : 'Mostrar a senha'} aria-controls={id} onClick={() => setVer((v) => !v)}>
            <Ic nome={ver ? 'olho-riscado' : 'olho'} tamanho={16} />
          </button>
        </div>
      )}
    </Campo>
  )
}

function Cabeca({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div className="pn-acesso-cabeca">
      {/* o logo se monta em pixels (como na abertura do site) e assenta no desenho de vetor */}
      <span className="pn-marca">
        <LogoPixel tamanho={88} className="pn-montar" />
        <Logo tamanho={88} className="pn-marca-vetor" />
      </span>
      <h1 className="pn-h1 px">{titulo}</h1>
      {children && <p className="pn-acesso-txt">{children}</p>}
    </div>
  )
}

/** Erro do servidor → campo marcado ou aviso geral. */
function separar(e: unknown, campos: string[], mapa: Record<string, string> = {}): { campo?: string; geral?: string } {
  if (!(e instanceof ErroApi)) return { geral: api.mensagemDe(e) }
  const c = mapa[e.codigo] ?? e.campo
  if (c && campos.includes(c)) return { campo: c }
  return { geral: e.message }
}

// ─── primeiro acesso ─────────────────────────────────────────────────────────────────────────────────────────────

export function Instalar({ aoEntrar, jaInstalado }: { aoEntrar: (u: Usuario, csrf: string) => void; jaInstalado: () => void }) {
  const [v, setV] = useState({ codigo: '', nome: '', login: '', senha: '', confirma: '' })
  const [erros, setErros] = useState<Erros>({})
  const [geral, setGeral] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  // trava síncrona: o estado só muda no próximo desenho, e um toque duplo passaria pelos dois
  const trava = useRef(false)
  const form = useRef<HTMLFormElement>(null)
  const mudar = (k: keyof typeof v) => (x: string) => {
    setV((s) => ({ ...s, [k]: x }))
    if (erros[k]) setErros((s) => ({ ...s, [k]: undefined }))
  }

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    if (ocupado) return
    const login = v.login.trim().toLowerCase()
    const novos: Erros = {
      codigo: v.codigo.replace(/[^a-z0-9]/gi, '').length < 8 ? 'Põe o código de instalação inteiro.' : undefined,
      nome: v.nome.trim().length < 2 ? 'Teu nome, pra aparecer no painel.' : undefined,
      login: LOGIN_OK.test(login) ? undefined : 'De 3 a 32: letras minúsculas, números, ponto, traço ou _.',
      senha: validarSenha(v.senha),
      confirma: v.confirma !== v.senha ? 'As duas senhas não batem.' : undefined,
    }
    setErros(novos)
    setGeral(null)
    if (Object.values(novos).some(Boolean)) {
      focarErro(form.current, novos)
      return
    }
    if (trava.current) return
    trava.current = true
    setOcupado(true)
    try {
      const r = await api.instalar({ codigo: v.codigo.trim(), login, nome: v.nome.trim(), senha: v.senha })
      lembrar('login', login)
      aoEntrar(r.usuario, r.csrf)
    } catch (err) {
      if (err instanceof ErroApi && err.codigo === 'ja-instalado') {
        jaInstalado()
        return
      }
      const s = separar(err, ['codigo', 'nome', 'login', 'senha'], { 'codigo-invalido': 'codigo', 'codigo-de-desenvolvimento': 'codigo' })
      if (s.campo) {
        const n = { [s.campo]: (err as ErroApi).message }
        setErros(n)
        focarErro(form.current, n)
      } else setGeral(s.geral ?? null)
    } finally {
      trava.current = false
      setOcupado(false)
    }
  }

  return (
    <main className="pn-acesso">
      <Cabeca titulo="Primeiro acesso">Põe o código de instalação que veio com o painel e cria teu login. O código vale uma vez só.</Cabeca>
      <form ref={form} className="pn-form" onSubmit={enviar} noValidate>
        <Campo id="i-codigo" rotulo="Código de instalação" erro={erros.codigo} dica="4 grupos de 5, ex.: k7m2p-x9q4r-h3d8w-5tnby">
          {(a) => <input {...a} name="codigo" className="pn-input pn-input-codigo" autoComplete="one-time-code" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={v.codigo} onChange={(e) => mudar('codigo')(e.target.value)} maxLength={64} />}
        </Campo>
        <Campo id="i-nome" rotulo="Teu nome" erro={erros.nome}>
          {(a) => <input {...a} name="nome" className="pn-input" autoComplete="name" value={v.nome} onChange={(e) => mudar('nome')(e.target.value)} maxLength={60} />}
        </Campo>
        <Campo id="i-login" rotulo="Login" erro={erros.login} dica="É com ele que tu entra. Letras minúsculas, números, ponto ou traço.">
          {(a) => <input {...a} name="login" className="pn-input" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={v.login} onChange={(e) => mudar('login')(e.target.value.toLowerCase())} maxLength={32} />}
        </Campo>
        <CampoSenha id="i-senha" nome="senha" rotulo="Senha" valor={v.senha} aoMudar={mudar('senha')} erro={erros.senha} auto="new-password" dica="10 caracteres ou mais. Uma frase curta funciona bem." />
        <CampoSenha id="i-confirma" nome="confirma" rotulo="Repete a senha" valor={v.confirma} aoMudar={mudar('confirma')} erro={erros.confirma} auto="new-password" />
        {geral && <Aviso tipo="erro">{geral}</Aviso>}
        <Botao type="submit" largo ocupado={ocupado}>
          Criar acesso
        </Botao>
      </form>
    </main>
  )
}

// ─── entrar e esqueci a senha ────────────────────────────────────────────────────────────────────────────────────

function FormEntrar({ aoEntrar, loginInicial, botao = 'Entrar', focar = true }: { aoEntrar: (u: Usuario, csrf: string) => void; loginInicial?: string; botao?: string; focar?: boolean }) {
  const [login, setLogin] = useState(loginInicial ?? lido('login') ?? '')
  const [senha, setSenha] = useState('')
  const [erros, setErros] = useState<Erros>({})
  const [geral, setGeral] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  // trava síncrona: o estado só muda no próximo desenho, e um toque duplo passaria pelos dois
  const trava = useRef(false)
  const form = useRef<HTMLFormElement>(null)
  const refSenha = useRef<HTMLInputElement>(null)
  const refLogin = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!focar) return
    ;(login ? refSenha : refLogin).current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    if (ocupado) return
    const l = login.trim().toLowerCase()
    const novos: Erros = { login: l ? undefined : 'Põe teu login.', senha: senha ? undefined : 'Põe tua senha.' }
    setErros(novos)
    setGeral(null)
    if (novos.login || novos.senha) {
      focarErro(form.current, novos)
      return
    }
    if (trava.current) return
    trava.current = true
    setOcupado(true)
    try {
      const r = await api.entrar({ login: l, senha })
      lembrar('login', l)
      aoEntrar(r.usuario, r.csrf)
    } catch (err) {
      setGeral(api.mensagemDe(err))
      setSenha('')
      refSenha.current?.focus()
    } finally {
      trava.current = false
      setOcupado(false)
    }
  }

  return (
    <form ref={form} className="pn-form" onSubmit={enviar} noValidate>
      <Campo id="e-login" rotulo="Login" erro={erros.login}>
        {(a) => <input {...a} ref={refLogin} name="login" className="pn-input" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={login} onChange={(e) => setLogin(e.target.value)} maxLength={64} />}
      </Campo>
      <CampoSenha id="e-senha" nome="senha" rotulo="Senha" valor={senha} aoMudar={setSenha} erro={erros.senha} auto="current-password" refInput={refSenha} />
      {geral && <Aviso tipo="erro">{geral}</Aviso>}
      <Botao type="submit" largo ocupado={ocupado}>
        {botao}
      </Botao>
    </form>
  )
}

function Recuperar({ aoEntrar, voltar }: { aoEntrar: (u: Usuario, csrf: string) => void; voltar: () => void }) {
  const [v, setV] = useState({ codigo: '', login: lido('login') ?? '', senha: '', confirma: '' })
  const [erros, setErros] = useState<Erros>({})
  const [geral, setGeral] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  // trava síncrona: o estado só muda no próximo desenho, e um toque duplo passaria pelos dois
  const trava = useRef(false)
  const form = useRef<HTMLFormElement>(null)
  const mudar = (k: keyof typeof v) => (x: string) => {
    setV((s) => ({ ...s, [k]: x }))
    if (erros[k]) setErros((s) => ({ ...s, [k]: undefined }))
  }
  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    if (ocupado) return
    const login = v.login.trim().toLowerCase()
    const novos: Erros = {
      codigo: v.codigo.replace(/[^a-z0-9]/gi, '').length < 8 ? 'Põe o código novo inteiro.' : undefined,
      login: !login || LOGIN_OK.test(login) ? undefined : 'Login de 3 a 32: letras minúsculas, números, ponto ou traço.',
      senha: validarSenha(v.senha),
      confirma: v.confirma !== v.senha ? 'As duas senhas não batem.' : undefined,
    }
    setErros(novos)
    setGeral(null)
    if (Object.values(novos).some(Boolean)) {
      focarErro(form.current, novos)
      return
    }
    if (trava.current) return
    trava.current = true
    setOcupado(true)
    try {
      const r = await api.recuperar({ codigo: v.codigo.trim(), senha: v.senha, ...(login ? { login } : {}) })
      lembrar('login', r.usuario.login)
      aoEntrar(r.usuario, r.csrf)
    } catch (err) {
      const s = separar(err, ['codigo', 'login', 'senha'], { 'codigo-invalido': 'codigo', 'codigo-usado': 'codigo' })
      if (s.campo) {
        const n = { [s.campo]: (err as ErroApi).message }
        setErros(n)
        focarErro(form.current, n)
      } else setGeral(s.geral ?? null)
    } finally {
      trava.current = false
      setOcupado(false)
    }
  }
  return (
    <main className="pn-acesso">
      <Cabeca titulo="Senha nova">Pede um código de instalação novo pra quem cuida do site (o primeiro não vale de novo). Com ele, tu escolhe outra senha e todo aparelho conectado sai.</Cabeca>
      <form ref={form} className="pn-form" onSubmit={enviar} noValidate>
        <Campo id="r-codigo" rotulo="Código novo" erro={erros.codigo}>
          {(a) => <input {...a} name="codigo" className="pn-input pn-input-codigo" autoComplete="one-time-code" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={v.codigo} onChange={(e) => mudar('codigo')(e.target.value)} maxLength={64} />}
        </Campo>
        <Campo id="r-login" rotulo="Login" erro={erros.login}>
          {(a) => <input {...a} name="login" className="pn-input" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={v.login} onChange={(e) => mudar('login')(e.target.value.toLowerCase())} maxLength={32} />}
        </Campo>
        <CampoSenha id="r-senha" nome="senha" rotulo="Senha nova" valor={v.senha} aoMudar={mudar('senha')} erro={erros.senha} auto="new-password" dica="10 caracteres ou mais." />
        <CampoSenha id="r-confirma" nome="confirma" rotulo="Repete a senha nova" valor={v.confirma} aoMudar={mudar('confirma')} erro={erros.confirma} auto="new-password" />
        {geral && <Aviso tipo="erro">{geral}</Aviso>}
        <Botao type="submit" largo ocupado={ocupado}>
          Trocar a senha e entrar
        </Botao>
        <button type="button" className="pn-link-botao" onClick={voltar}>
          Lembrei a senha
        </button>
      </form>
    </main>
  )
}

export function Entrar({ aoEntrar }: { aoEntrar: (u: Usuario, csrf: string) => void }) {
  const [esqueci, setEsqueci] = useState(false)
  if (esqueci) return <Recuperar aoEntrar={aoEntrar} voltar={() => setEsqueci(false)} />
  return (
    <main className="pn-acesso">
      <Cabeca titulo="Painel da loja">Entra com teu login pra cuidar dos rateios.</Cabeca>
      <FormEntrar aoEntrar={aoEntrar} />
      <button type="button" className="pn-link-botao" onClick={() => setEsqueci(true)}>
        Esqueci a senha
      </button>
    </main>
  )
}

/** Sessão caiu no meio do trabalho: entra de novo aqui mesmo e o que estava em andamento continua. */
export function FolhaSessao({ aberta, login, aoEntrar, aoSair }: { aberta: boolean; login?: string; aoEntrar: (u: Usuario, csrf: string) => void; aoSair: () => void }) {
  return (
    <Folha aberta={aberta} aoFechar={() => {}} preso semFechar titulo="Tua sessão acabou" sub="Entra de novo pra continuar. O que tu tava fazendo fica aqui, do jeito que estava.">
      <div className="pn-folha-pad">
        <FormEntrar aoEntrar={aoEntrar} loginInicial={login} botao="Entrar e continuar" />
        <button type="button" className="pn-link-botao" onClick={aoSair}>
          Sair do painel
        </button>
      </div>
    </Folha>
  )
}
