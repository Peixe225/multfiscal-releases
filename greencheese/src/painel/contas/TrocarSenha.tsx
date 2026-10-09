// Primeiro acesso com a senha provisória (o dono criou o login ou gerou uma senha nova): o painel só abre depois que
// a pessoa escolhe a senha dela. O servidor recusa qualquer outra coisa até lá (403 trocar-senha).
import { useRef, useState, type FormEvent } from 'react'
import * as api from '../api'
import { ErroApi } from '../api'
import { descreverAcesso } from '../permissoes'
import { CampoSenha, Cabeca } from '../telas/Acesso'
import type { Usuario } from '../tipos'
import { Aviso, Botao } from '../ui'

type Erros = Partial<Record<'atual' | 'nova' | 'confirma', string>>

export function TrocarSenhaObrigatoria({ usuario, aoTrocar, aoSair }: { usuario: Usuario; aoTrocar: (u: Usuario) => void; aoSair: () => void }) {
  const [v, setV] = useState({ atual: '', nova: '', confirma: '' })
  const [erros, setErros] = useState<Erros>({})
  const [geral, setGeral] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const trava = useRef(false)
  const form = useRef<HTMLFormElement>(null)
  const mudar = (k: keyof typeof v) => (x: string) => {
    setV((s) => ({ ...s, [k]: x }))
    if (erros[k]) setErros((e) => ({ ...e, [k]: undefined }))
  }
  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    if (trava.current) return
    const n: Erros = {
      atual: v.atual ? undefined : 'Põe a senha provisória que o dono te passou.',
      nova: v.nova.length < 10 ? 'A senha nova precisa de 10 caracteres ou mais.' : v.nova.length > 72 ? 'Até 72 caracteres.' : v.nova === v.atual ? 'Tem que ser diferente da provisória.' : undefined,
      confirma: v.confirma !== v.nova ? 'As duas senhas não batem.' : undefined,
    }
    setErros(n)
    setGeral(null)
    const primeiro = (Object.keys(n) as (keyof Erros)[]).find((k) => n[k])
    if (primeiro) {
      form.current?.querySelector<HTMLElement>(`[name="${primeiro}"]`)?.focus()
      return
    }
    trava.current = true
    setOcupado(true)
    try {
      const r = await api.trocarSenha({ atual: v.atual, nova: v.nova })
      aoTrocar({ ...usuario, ...r.usuario, trocarSenha: false })
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
    <main className="pn-acesso">
      <Cabeca titulo={`Oi, ${usuario.nome.split(' ')[0]}`}>
        Teu acesso ao painel ({descreverAcesso(usuario)}) tá com a senha provisória. Escolhe a tua pra entrar.
      </Cabeca>
      <form ref={form} className="pn-form" onSubmit={enviar} noValidate>
        <input type="text" name="username" autoComplete="username" value={usuario.login} readOnly hidden />
        <CampoSenha id="t-atual" nome="atual" rotulo="Senha provisória" valor={v.atual} aoMudar={mudar('atual')} erro={erros.atual} auto="current-password" />
        <CampoSenha id="t-nova" nome="nova" rotulo="Senha nova" valor={v.nova} aoMudar={mudar('nova')} erro={erros.nova} dica="10 caracteres ou mais. Só tu sabe ela." auto="new-password" />
        <CampoSenha id="t-confirma" nome="confirma" rotulo="Repete a senha nova" valor={v.confirma} aoMudar={mudar('confirma')} erro={erros.confirma} auto="new-password" />
        {geral && <Aviso tipo="erro">{geral}</Aviso>}
        <Botao type="submit" largo ocupado={ocupado}>
          Salvar e entrar
        </Botao>
        <Botao variante="texto" largo onClick={aoSair} disabled={ocupado}>
          Sair
        </Botao>
      </form>
    </main>
  )
}
