// Conta: quem tá logado, trocar a senha (derruba os outros aparelhos), sair, e as seções que não cabem na barra
// do celular (Servidor, e as que vierem).
import { useRef, useState, type FormEvent } from 'react'
import { Logo } from '../../arte/Logo'
import * as api from '../api'
import { ErroApi } from '../api'
import { Link, Topo } from '../Moldura'
import { secoes } from '../secoes'
import type { Usuario } from '../tipos'
import { Aviso, Botao, Campo, Ic, TituloTela } from '../ui'
import { useTitulo } from './comum'

type Erros = Partial<Record<'atual' | 'nova' | 'confirma', string>>

function TrocarSenha({ login }: { login: string }) {
  const [v, setV] = useState({ atual: '', nova: '', confirma: '' })
  const [erros, setErros] = useState<Erros>({})
  const [geral, setGeral] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  // trava síncrona: o estado só muda no próximo desenho, e um toque duplo passaria pelos dois
  const trava = useRef(false)
  const form = useRef<HTMLFormElement>(null)
  const mudar = (k: keyof typeof v) => (x: string) => {
    setV((s) => ({ ...s, [k]: x }))
    setOk(false)
    if (erros[k]) setErros((e) => ({ ...e, [k]: undefined }))
  }
  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    if (ocupado) return
    const n: Erros = {
      atual: v.atual ? undefined : 'Põe a senha de agora.',
      nova: v.nova.length < 10 ? 'A senha nova precisa de 10 caracteres ou mais.' : v.nova.length > 72 ? 'Até 72 caracteres.' : v.nova === v.atual ? 'Tem que ser diferente da de agora.' : undefined,
      confirma: v.confirma !== v.nova ? 'As duas senhas não batem.' : undefined,
    }
    setErros(n)
    setGeral(null)
    const primeiro = (Object.keys(n) as (keyof Erros)[]).find((k) => n[k])
    if (primeiro) {
      form.current?.querySelector<HTMLElement>(`[name="${primeiro}"]`)?.focus()
      return
    }
    if (trava.current) return
    trava.current = true
    setOcupado(true)
    try {
      await api.trocarSenha({ atual: v.atual, nova: v.nova })
      setV({ atual: '', nova: '', confirma: '' })
      setOk(true)
    } catch (err) {
      if (err instanceof ErroApi && (err.campo === 'atual' || err.campo === 'nova')) {
        const c = err.campo
        setErros({ [c]: err.message })
        form.current?.querySelector<HTMLElement>(`[name="${c}"]`)?.focus()
      } else setGeral(api.mensagemDe(err))
    } finally {
      trava.current = false
      setOcupado(false)
    }
  }
  return (
    <form ref={form} className="pn-form" onSubmit={enviar} noValidate>
      {/* o login vai junto (escondido) pro gerenciador de senhas saber de quem é a senha nova */}
      <input type="text" name="username" autoComplete="username" value={login} readOnly hidden />
      <Campo id="c-atual" rotulo="Senha de agora" erro={erros.atual}>
        {(a) => <input {...a} name="atual" type="password" className="pn-input" autoComplete="current-password" value={v.atual} onChange={(e) => mudar('atual')(e.target.value)} maxLength={72} />}
      </Campo>
      <Campo id="c-nova" rotulo="Senha nova" erro={erros.nova} dica="10 caracteres ou mais.">
        {(a) => <input {...a} name="nova" type="password" className="pn-input" autoComplete="new-password" value={v.nova} onChange={(e) => mudar('nova')(e.target.value)} maxLength={72} />}
      </Campo>
      <Campo id="c-confirma" rotulo="Repete a senha nova" erro={erros.confirma}>
        {(a) => <input {...a} name="confirma" type="password" className="pn-input" autoComplete="new-password" value={v.confirma} onChange={(e) => mudar('confirma')(e.target.value)} maxLength={72} />}
      </Campo>
      {geral && <Aviso tipo="erro">{geral}</Aviso>}
      {ok && <Aviso tipo="ok">Senha trocada. Os outros aparelhos saíram; este continua conectado.</Aviso>}
      <Botao type="submit" ocupado={ocupado}>
        Trocar a senha
      </Botao>
    </form>
  )
}

export function Conta({ usuario, aoSair }: { usuario: Usuario; aoSair: () => Promise<void> }) {
  useTitulo('Conta')
  const [saindo, setSaindo] = useState(false)
  const fora = secoes.filter((s) => !s.barra)
  return (
    <>
      <Topo titulo={<TituloTela>Conta</TituloTela>} />
      <div className="pn-pagina pn-pagina-estreita">
        <section className="pn-conta-cab" aria-label="Quem tá logado">
          <span className="pn-avatar pn-avatar-aceso pn-avatar-g">
            <Logo tamanho={64} />
          </span>
          <div>
            <p className="pn-conta-nome">{usuario.nome}</p>
            <p className="pn-conta-login">@{usuario.login} · dono da loja</p>
          </div>
        </section>

        {fora.length > 0 && (
          <section className="pn-bloco pn-so-celular" aria-labelledby="h-mais-secoes">
            <h2 id="h-mais-secoes" className="pn-h2">
              Mais do painel
            </h2>
            <ul className="pn-menu">
              {fora.map((s) => (
                <li key={s.id}>
                  <Link href={s.href} className="pn-menu-item toque">
                    <Ic nome={s.icone} tamanho={16} />
                    <span>{s.nome}</span>
                    <Ic nome="chevron-dir" tamanho={16} />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="pn-bloco" aria-labelledby="h-senha">
          <h2 id="h-senha" className="pn-h2">
            Trocar a senha
          </h2>
          <TrocarSenha login={usuario.login} />
        </section>

        <section className="pn-bloco" aria-labelledby="h-sair">
          <h2 id="h-sair" className="pn-h2">
            Sair
          </h2>
          <p className="pn-dica-bloco">Sai só deste aparelho. Pra tirar todos, troca a senha.</p>
          <Botao
            variante="cinza"
            icone="sair"
            ocupado={saindo}
            onClick={async () => {
              setSaindo(true)
              await aoSair()
            }}
          >
            Sair do painel
          </Botao>
        </section>
      </div>
    </>
  )
}
