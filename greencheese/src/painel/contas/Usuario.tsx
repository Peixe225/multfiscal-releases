// Um acesso da equipe: o papel e os estados (editáveis), senha provisória nova, desativar/reativar e o que essa
// pessoa fez (a Atividade só dela).
import { useRef, useState, type FormEvent } from 'react'
import * as api from '../api'
import { ErroApi } from '../api'
import { Confirmar, type PedidoConfirmacao } from '../Confirmar'
import { useDados } from '../dados'
import { dataCompleta, hora, relativo } from '../formato'
import { Link, Topo } from '../Moldura'
import { caminho } from '../rotas'
import { useRestaurarRolagem, useTitulo } from '../telas/comum'
import type { Evento, Papel } from '../tipos'
import { Aviso, Botao, Campo, Carregando, Ic, Linha, TituloTela } from '../ui'
import { eventosDe, redefinirSenha, salvarUsuario, statusUsuario, usuarios } from './api'
import { EscolherUfs, PAPEIS, SeloPapel, SenhaProvisoria } from './comum'
import './estilo'
import type { UsuarioAdmin } from './tipos'

export function Usuario({ login }: { login: string }) {
  const leitura = useDados<{ agora: string; usuarios: UsuarioAdmin[] }>('usuarios', (s) => usuarios(s))
  const u = leitura.dados?.usuarios.find((x) => x.login === login)
  useTitulo(u ? u.nome : 'Equipe')
  useRestaurarRolagem(!!u)
  const [pedido, setPedido] = useState<PedidoConfirmacao | null>(null)
  const [editando, setEditando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const trocar = (novo: UsuarioAdmin) => leitura.trocar((d) => ({ ...d, usuarios: d.usuarios.map((x) => (x.login === novo.login ? novo : x)) }))
  const agora = api.agora()

  if (!leitura.dados) {
    return (
      <>
        <Topo titulo={<TituloTela>Equipe</TituloTela>} voltar={caminho.equipe} />
        <div className="pn-pagina pn-pagina-estreita">{leitura.erro ? <Aviso tipo="erro">{leitura.erro.message}</Aviso> : <Carregando />}</div>
      </>
    )
  }
  if (!u) {
    return (
      <>
        <Topo titulo={<TituloTela>Equipe</TituloTela>} voltar={caminho.equipe} />
        <div className="pn-pagina pn-pagina-estreita">
          <p className="pn-vazio">Esse login não existe mais.</p>
        </div>
      </>
    )
  }

  const novaSenha = () =>
    setPedido({
      titulo: `Senha nova pra ${u.nome}?`,
      texto: 'O painel gera uma senha provisória. Os aparelhos em que essa pessoa está logada saem na hora, e no próximo acesso ela troca a senha.',
      botao: 'Gerar senha provisória',
      acao: async () => {
        const r = await redefinirSenha(u.login)
        trocar(r.usuario)
        return { titulo: 'Senha provisória', conteudo: <SenhaProvisoria login={r.usuario.login} senha={r.senhaProvisoria} /> }
      },
    })
  const mudarAtivo = () =>
    setPedido(
      u.ativo
        ? {
            titulo: `Desativar o acesso de ${u.nome}?`,
            texto: 'A pessoa sai do painel na hora, em todos os aparelhos, e não entra mais. O que ela fez continua na Atividade. Dá pra reativar depois.',
            botao: 'Desativar',
            perigo: true,
            acao: async () => {
              const r = await statusUsuario(u.login, false)
              trocar(r.usuario)
              setAviso('Acesso desativado.')
            },
          }
        : {
            titulo: `Reativar o acesso de ${u.nome}?`,
            texto: 'A pessoa volta a entrar com a senha que tinha. Se ela não lembrar, gera uma senha provisória.',
            botao: 'Reativar',
            acao: async () => {
              const r = await statusUsuario(u.login, true)
              trocar(r.usuario)
              setAviso('Acesso reativado.')
            },
          },
    )

  return (
    <>
      <Topo titulo={<TituloTela>{u.nome}</TituloTela>} voltar={caminho.equipe} />
      <div className="pn-pagina pn-pagina-estreita">
        <section className="pn-bloco" aria-label="Acesso">
          <div className="ct-cab">
            <span className="ct-avatar ct-avatar-g" aria-hidden="true">
              {u.nome.trim()[0]?.toUpperCase() ?? '?'}
            </span>
            <div>
              <p className="ct-cab-nome">{u.nome}</p>
              <p className="ct-linha-meta">
                @{u.login} · <SeloPapel u={u} />
              </p>
            </div>
          </div>
          {aviso && <Aviso tipo="ok">{aviso}</Aviso>}
          {!u.ativo && <Aviso tipo="info">Acesso desativado {u.desativadoEm ? relativo(u.desativadoEm, agora) : ''}: essa pessoa não entra no painel.</Aviso>}
          {u.ativo && u.trocarSenha && <Aviso tipo="info">Ainda não trocou a senha provisória (a pessoa troca no primeiro acesso).</Aviso>}
          <dl className="ct-dados">
            <Linha rotulo="Último acesso">{u.acessoEm ? `${relativo(u.acessoEm, agora)} (${dataCompleta(u.acessoEm)})` : 'nunca entrou'}</Linha>
            <Linha rotulo="Aparelhos logados agora">{u.sessoes}</Linha>
            <Linha rotulo="Senha trocada">{relativo(u.senhaEm, agora)}</Linha>
            <Linha rotulo="Criado">
              {dataCompleta(u.criadoEm)}
              {u.criadoPor ? ` por @${u.criadoPor}` : ''}
            </Linha>
          </dl>
        </section>

        <section className="pn-bloco" aria-labelledby="h-papel">
          <div className="pn-h2-linha">
            <h2 id="h-papel" className="pn-h2">
              Papel e estados
            </h2>
            {!editando && !u.eu && (
              <Botao variante="cinza" icone="editar" className="pn-botao-p" onClick={() => setEditando(true)}>
                Mudar
              </Botao>
            )}
          </div>
          {editando ? (
            <EditarAcesso
              u={u}
              aoFim={(novo) => {
                setEditando(false)
                if (novo) {
                  trocar(novo)
                  setAviso('Acesso salvo. Vale na hora, até no aparelho em que a pessoa já está.')
                }
              }}
            />
          ) : (
            <p className="ct-pode">{PAPEIS.find((p) => p.id === u.papel)?.pode}</p>
          )}
          {u.eu && <p className="pn-dica-bloco">O teu papel quem muda é outro dono (sempre fica pelo menos um).</p>}
        </section>

        {!u.eu && (
          <section className="pn-bloco" aria-labelledby="h-seguranca">
            <h2 id="h-seguranca" className="pn-h2">
              Senha e acesso
            </h2>
            <div className="pn-botoes ct-botoes">
              {u.ativo && (
                <Botao variante="cinza" icone="chave" onClick={novaSenha}>
                  Gerar senha provisória
                </Botao>
              )}
              <Botao variante={u.ativo ? 'perigo' : 'cheio'} icone={u.ativo ? 'atencao' : 'check'} onClick={mudarAtivo}>
                {u.ativo ? 'Desativar acesso' : 'Reativar acesso'}
              </Botao>
            </div>
          </section>
        )}

        <OQueFez login={u.login} />
      </div>
      <Confirmar pedido={pedido} aoFechar={() => setPedido(null)} />
    </>
  )
}

function EditarAcesso({ u, aoFim }: { u: UsuarioAdmin; aoFim: (novo: UsuarioAdmin | null) => void }) {
  const [v, setV] = useState<{ nome: string; papel: Papel; ufs: string[] }>({ nome: u.nome, papel: u.papel, ufs: u.ufs })
  const [erros, setErros] = useState<Partial<Record<'nome' | 'ufs' | 'papel', string>>>({})
  const [geral, setGeral] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const trava = useRef(false)
  const form = useRef<HTMLFormElement>(null)
  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    if (trava.current) return
    const n = {
      nome: v.nome.trim().length < 2 ? 'O nome da pessoa (de 2 a 60 letras).' : undefined,
      ufs: v.papel !== 'dono' && !v.ufs.length ? 'Escolhe pelo menos um estado.' : undefined,
    }
    setErros(n)
    if (n.nome || n.ufs) {
      form.current?.querySelector<HTMLElement>(n.nome ? '[name="nome"]' : '#ct-uf-rj')?.focus()
      return
    }
    trava.current = true
    setOcupado(true)
    setGeral(null)
    try {
      const r = await salvarUsuario({ login: u.login, nome: v.nome.trim(), papel: v.papel, ufs: v.papel === 'dono' ? [] : v.ufs })
      aoFim(r.usuario)
    } catch (err) {
      if (err instanceof ErroApi && (err.campo === 'nome' || err.campo === 'ufs' || err.campo === 'papel')) setErros({ [err.campo]: err.message })
      else setGeral(api.mensagemDe(err))
    } finally {
      trava.current = false
      setOcupado(false)
    }
  }
  return (
    <form ref={form} className="pn-form" onSubmit={enviar} noValidate>
      <Campo id="ct-e-nome" rotulo="Nome" erro={erros.nome}>
        {(a) => <input {...a} name="nome" className="pn-input" maxLength={60} value={v.nome} onChange={(e) => setV((s) => ({ ...s, nome: e.target.value }))} />}
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
      {erros.papel && <Aviso tipo="erro">{erros.papel}</Aviso>}
      {v.papel !== 'dono' && (
        <div className={`pn-campo${erros.ufs ? ' pn-campo-erro' : ''}`}>
          <p id="ct-e-ufs" className="pn-rotulo">
            Estados
          </p>
          <EscolherUfs valor={v.ufs} aoMudar={(ufs) => setV((s) => ({ ...s, ufs }))} rotuloId="ct-e-ufs" erroId={erros.ufs ? 'ct-e-ufs-erro' : undefined} />
          {erros.ufs && (
            <p id="ct-e-ufs-erro" className="pn-erro">
              <Ic nome="atencao" tamanho={16} />
              <span>{erros.ufs}</span>
            </p>
          )}
        </div>
      )}
      {geral && <Aviso tipo="erro">{geral}</Aviso>}
      <div className="pn-botoes">
        <Botao type="submit" ocupado={ocupado}>
          Salvar
        </Botao>
        <Botao variante="texto" onClick={() => aoFim(null)} disabled={ocupado}>
          Cancelar
        </Botao>
      </div>
    </form>
  )
}

/** O que essa pessoa fez no painel (os últimos 100), do mais novo pro mais velho. */
function OQueFez({ login }: { login: string }) {
  const leitura = useDados<{ eventos: Evento[] }>(`eventos-de:${login}`, (s) => eventosDe(login, s), 60_000)
  const lista = leitura.dados?.eventos ?? []
  const agora = api.agora()
  return (
    <section className="pn-bloco" aria-labelledby="h-fez">
      <div className="pn-h2-linha">
        <h2 id="h-fez" className="pn-h2">
          O que fez
        </h2>
        {lista.length > 8 && (
          <Link href={caminho.atividadeDe(login)} className="pn-link-botao">
            Ver tudo
          </Link>
        )}
      </div>
      {leitura.erro && <Aviso tipo="erro">{leitura.erro.message}</Aviso>}
      {!leitura.dados && !leitura.erro && <Carregando />}
      {leitura.dados && lista.length === 0 && <p className="pn-vazio">Nada ainda.</p>}
      {lista.length > 0 && (
        <ul className="pn-eventos">
          {lista.slice(0, 8).map((e) => (
            <li key={e.id}>
              <div className="pn-evento">
                <span className="pn-evento-ic pn-evento-painel" aria-hidden="true">
                  <Ic nome="conta" tamanho={16} />
                </span>
                <span className="pn-evento-txt">
                  <span>{e.texto}</span>
                  <small>
                    <time dateTime={e.em}>{relativo(e.em, agora) === 'agora' ? 'agora' : `${relativo(e.em, agora)}, ${hora(e.em)}`}</time>
                  </small>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
