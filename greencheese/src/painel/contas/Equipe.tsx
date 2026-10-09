// Equipe: quem entra no painel e o que cada um pode. O dono cria o acesso (a senha provisória aparece uma vez e a
// pessoa troca no primeiro acesso), muda o papel e os estados, gera senha nova, desativa e vê o que cada um fez.
import { useRef, useState, type FormEvent } from 'react'
import * as api from '../api'
import { ErroApi } from '../api'
import { useDados } from '../dados'
import { Folha } from '../Folha'
import { relativo } from '../formato'
import { Link, Topo } from '../Moldura'
import { caminho } from '../rotas'
import { useRestaurarRolagem, useTitulo } from '../telas/comum'
import type { Papel } from '../tipos'
import { Aviso, Botao, Campo, Carregando, Ic, TituloTela } from '../ui'
import { salvarUsuario, usuarios } from './api'
import { EscolherUfs, PAPEIS, SeloPapel, SenhaProvisoria } from './comum'
import './estilo'
import type { UsuarioAdmin } from './tipos'

export function Equipe() {
  useTitulo('Equipe')
  const leitura = useDados<{ agora: string; usuarios: UsuarioAdmin[] }>('usuarios', (s) => usuarios(s))
  const [novo, setNovo] = useState(false)
  useRestaurarRolagem(!!leitura.dados)
  const lista = leitura.dados?.usuarios ?? []
  const ativos = lista.filter((u) => u.ativo)
  const desativados = lista.filter((u) => !u.ativo)
  const agora = api.agora()
  return (
    <>
      <Topo
        titulo={<TituloTela>Equipe</TituloTela>}
        acoes={
          <Botao variante="cinza" icone="incluir-pessoa" className="pn-botao-p" onClick={() => setNovo(true)}>
            Novo acesso
          </Botao>
        }
      />
      <div className="pn-pagina pn-pagina-estreita">
        <p className="pn-dica-bloco ct-intro">Cada pessoa entra com o login dela, e o painel mostra só o que o papel dela pode. Tudo que alguém faz fica na Atividade com o login de quem fez.</p>
        {leitura.erro && (
          <Aviso tipo="erro" acao={<button type="button" className="pn-link-botao" onClick={() => void leitura.recarregar()}>Tentar de novo</button>}>
            {leitura.erro.message}
          </Aviso>
        )}
        {!leitura.dados && !leitura.erro && <Carregando rotulo="Carregando a equipe…" />}
        {ativos.length > 0 && (
          <ul className="ct-lista" aria-label="Acessos ativos">
            {ativos.map((u) => (
              <li key={u.login}>
                <LinhaUsuario u={u} agora={agora} />
              </li>
            ))}
          </ul>
        )}
        {desativados.length > 0 && (
          <section className="pn-bloco" aria-labelledby="h-desativados">
            <h2 id="h-desativados" className="pn-h3 pn-h3-colado">
              Desativados
            </h2>
            <ul className="ct-lista">
              {desativados.map((u) => (
                <li key={u.login}>
                  <LinhaUsuario u={u} agora={agora} />
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="pn-bloco" aria-labelledby="h-papeis">
          <h2 id="h-papeis" className="pn-h3 pn-h3-colado">
            O que cada papel pode
          </h2>
          <dl className="ct-papeis">
            {PAPEIS.map((p) => (
              <div key={p.id}>
                <dt>{p.nome}</dt>
                <dd>{p.pode}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
      <FolhaNovoAcesso
        aberta={novo}
        aoFechar={() => setNovo(false)}
        aoCriar={(u) => leitura.trocar((d) => ({ ...d, usuarios: [...d.usuarios.filter((x) => x.login !== u.login), u] }))}
      />
    </>
  )
}

function LinhaUsuario({ u, agora }: { u: UsuarioAdmin; agora: number }) {
  return (
    <Link href={caminho.usuario(u.login)} className={`ct-linha toque${u.ativo ? '' : ' ct-linha-off'}`}>
      <span className="ct-avatar" aria-hidden="true">
        {u.nome.trim()[0]?.toUpperCase() ?? '?'}
      </span>
      <span className="ct-linha-txt">
        <span className="ct-linha-topo">
          <strong>{u.nome}</strong>
          {u.eu && <span className="pd-tag">Tu</span>}
        </span>
        <span className="ct-linha-meta">
          @{u.login} · <SeloPapel u={u} />
        </span>
        <span className="ct-linha-meta">
          {!u.ativo
            ? 'Acesso desativado'
            : u.trocarSenha
              ? 'Ainda não trocou a senha provisória'
              : u.acessoEm
                ? `Último acesso ${relativo(u.acessoEm, agora)}`
                : 'Nunca entrou'}
        </span>
      </span>
      <Ic nome="chevron-dir" tamanho={16} />
    </Link>
  )
}

type Erros = Partial<Record<'nome' | 'login' | 'ufs', string>>

/** "Ana Souza" → "ana.souza" (a sugestão de login; a pessoa troca se quiser). */
function loginDoNome(nome: string): string {
  const base = nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  return (base.length > 1 ? `${base[0]}.${base[base.length - 1]}` : (base[0] ?? '')).slice(0, 32)
}

function FolhaNovoAcesso({ aberta, aoFechar, aoCriar }: { aberta: boolean; aoFechar: () => void; aoCriar: (u: UsuarioAdmin) => void }) {
  const [v, setV] = useState<{ nome: string; login: string; papel: Papel; ufs: string[] }>({ nome: '', login: '', papel: 'atendente', ufs: [] })
  const [loginMexido, setLoginMexido] = useState(false)
  const [erros, setErros] = useState<Erros>({})
  const [geral, setGeral] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [criado, setCriado] = useState<{ login: string; senha: string } | null>(null)
  const trava = useRef(false)
  const form = useRef<HTMLFormElement>(null)
  const fechar = () => {
    aoFechar()
    // limpa depois de fechar (a próxima abre em branco)
    window.setTimeout(() => {
      setV({ nome: '', login: '', papel: 'atendente', ufs: [] })
      setLoginMexido(false)
      setErros({})
      setGeral(null)
      setCriado(null)
    }, 0)
  }
  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    if (trava.current) return
    const login = v.login.trim().toLowerCase()
    const n: Erros = {
      nome: v.nome.trim().length < 2 ? 'O nome da pessoa (de 2 a 60 letras).' : undefined,
      login: /^[a-z0-9][a-z0-9._-]{2,31}$/.test(login) ? undefined : 'De 3 a 32: letras minúsculas, números, ponto, traço ou _.',
      ufs: v.papel !== 'dono' && v.ufs.length === 0 ? 'Escolhe pelo menos um estado.' : undefined,
    }
    setErros(n)
    setGeral(null)
    const primeiro = (Object.keys(n) as (keyof Erros)[]).find((k) => n[k])
    if (primeiro) {
      form.current?.querySelector<HTMLElement>(primeiro === 'ufs' ? '#ct-uf-rj' : `[name="${primeiro}"]`)?.focus()
      return
    }
    trava.current = true
    setOcupado(true)
    try {
      const r = await salvarUsuario({ novo: true, login, nome: v.nome.trim(), papel: v.papel, ufs: v.papel === 'dono' ? [] : v.ufs })
      aoCriar(r.usuario)
      setCriado({ login: r.usuario.login, senha: r.senhaProvisoria ?? '' })
    } catch (err) {
      if (err instanceof ErroApi && (err.campo === 'login' || err.campo === 'nome' || err.campo === 'ufs')) {
        const c = err.campo
        setErros({ [c]: err.message })
        form.current?.querySelector<HTMLElement>(c === 'ufs' ? '#ct-uf-rj' : `[name="${c}"]`)?.focus()
      } else setGeral(api.mensagemDe(err))
    } finally {
      trava.current = false
      setOcupado(false)
    }
  }
  if (criado) {
    return (
      <Folha
        aberta={aberta}
        aoFechar={fechar}
        titulo="Acesso criado"
        rodape={
          <Botao variante="texto" largo onClick={fechar}>
            Pronto
          </Botao>
        }
      >
        <div className="pn-folha-pad">
          <SenhaProvisoria login={criado.login} senha={criado.senha} />
        </div>
      </Folha>
    )
  }
  return (
    <Folha
      aberta={aberta}
      aoFechar={fechar}
      preso={ocupado}
      titulo="Novo acesso"
      sub="A senha provisória aparece depois de criar."
      rodape={
        <Botao type="submit" form="ct-form-novo" largo ocupado={ocupado}>
          Criar acesso
        </Botao>
      }
    >
      <form id="ct-form-novo" ref={form} className="pn-form pn-folha-pad" onSubmit={enviar} noValidate>
        <Campo id="ct-nome" rotulo="Nome" erro={erros.nome}>
          {(a) => (
            <input
              {...a}
              name="nome"
              className="pn-input"
              autoComplete="off"
              maxLength={60}
              value={v.nome}
              onChange={(e) => {
                const nome = e.target.value
                setV((s) => ({ ...s, nome, login: loginMexido ? s.login : loginDoNome(nome) }))
                if (erros.nome) setErros((x) => ({ ...x, nome: undefined }))
              }}
            />
          )}
        </Campo>
        <Campo id="ct-login" rotulo="Login" erro={erros.login} dica="É com ele que a pessoa entra. Letras minúsculas, números, ponto ou traço.">
          {(a) => (
            <input
              {...a}
              name="login"
              className="pn-input"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={32}
              value={v.login}
              onChange={(e) => {
                setLoginMexido(true)
                setV((s) => ({ ...s, login: e.target.value.toLowerCase() }))
                if (erros.login) setErros((x) => ({ ...x, login: undefined }))
              }}
            />
          )}
        </Campo>
        <fieldset className="pn-opcoes">
          <legend className="pn-rotulo">Papel</legend>
          {PAPEIS.map((p) => (
            <label key={p.id} className="pn-opcao">
              <input type="radio" name="papel" value={p.id} checked={v.papel === p.id} onChange={() => setV((s) => ({ ...s, papel: p.id }))} />
              <span className="pn-opcao-marca" aria-hidden="true" />
              <span>
                {p.nome}
                <small>{p.pode}</small>
              </span>
            </label>
          ))}
        </fieldset>
        {v.papel !== 'dono' && (
          <div className={`pn-campo${erros.ufs ? ' pn-campo-erro' : ''}`}>
            <p id="ct-ufs-rotulo" className="pn-rotulo">
              Estados
            </p>
            <EscolherUfs
              valor={v.ufs}
              aoMudar={(ufs) => {
                setV((s) => ({ ...s, ufs }))
                if (erros.ufs) setErros((x) => ({ ...x, ufs: undefined }))
              }}
              rotuloId="ct-ufs-rotulo"
              erroId={erros.ufs ? 'ct-ufs-erro' : undefined}
            />
            {erros.ufs ? (
              <p id="ct-ufs-erro" className="pn-erro">
                <Ic nome="atencao" tamanho={16} />
                <span>{erros.ufs}</span>
              </p>
            ) : (
              <p className="pn-dica">Só os pedidos, rateios e participantes desses estados aparecem pra essa pessoa.</p>
            )}
          </div>
        )}
        {geral && <Aviso tipo="erro">{geral}</Aviso>}
      </form>
    </Folha>
  )
}
