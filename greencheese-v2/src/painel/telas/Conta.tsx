// Conta: quem tá logado, a cópia de segurança (o dono), o que fazer se esquecer a senha (um 2º dono e o código pelo
// WhatsApp da loja), trocar a senha (derruba os outros aparelhos) e sair. O resto do painel mora no "Mais".
import { useRef, useState, type FormEvent } from 'react'
import { Logo } from '../../arte/Logo'
import * as api from '../api'
import { ErroApi } from '../api'
import { Link, Topo } from '../Moldura'
import { descreverAcesso, pode } from '../permissoes'
import { recado } from '../recado'
import { caminho } from '../rotas'
import type { Usuario } from '../tipos'
import { Aviso, Botao, Ic, TituloTela } from '../ui'
import { CampoSenha } from './Acesso'
import { BlocoCopia, usePronto } from './copia'
import { RodapePainel } from './Mais'
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
      <CampoSenha id="c-atual" nome="atual" rotulo="Senha de agora" valor={v.atual} aoMudar={mudar('atual')} erro={erros.atual} auto="current-password" />
      <CampoSenha id="c-nova" nome="nova" rotulo="Senha nova" valor={v.nova} aoMudar={mudar('nova')} erro={erros.nova} auto="new-password" dica="10 caracteres ou mais." />
      <CampoSenha id="c-confirma" nome="confirma" rotulo="Repete a senha nova" valor={v.confirma} aoMudar={mudar('confirma')} erro={erros.confirma} auto="new-password" />
      {geral && <Aviso tipo="erro">{geral}</Aviso>}
      {ok && <Aviso tipo="ok">Senha trocada. Os outros aparelhos saíram; este continua conectado.</Aviso>}
      <Botao type="submit" ocupado={ocupado}>
        Trocar a senha
      </Botao>
    </form>
  )
}

/** Se tu esquecer a senha: um 2º dono (gera a provisória em Equipe) e o código pelo WhatsApp da loja; por último, o
 * código de instalação novo com quem cuida do site. */
function SenhaEsquecida({ leitura }: { leitura: ReturnType<typeof usePronto> }) {
  const d = leitura.dados
  const [mexendo, setMexendo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  if (!d) return null
  const r = d.recuperacao
  const trocar = async (ligado: boolean) => {
    if (mexendo) return
    setMexendo(true)
    setErro(null)
    try {
      const novo = await api.salvarPronto({ recuperarPeloWhatsapp: ligado })
      leitura.trocar(() => novo)
      recado(ligado ? 'Ligado: o “Esqueci a senha” manda o código pro WhatsApp da loja.' : 'Desligado: o código pelo WhatsApp da loja não sai mais.', {
        desfazer: { acao: () => void trocar(!ligado) },
      })
    } catch (e) {
      setErro(api.mensagemDe(e))
    } finally {
      setMexendo(false)
    }
  }
  return (
    <section className="pn-bloco pn-senha-esquecida" aria-labelledby="h-esqueci">
      <h2 id="h-esqueci" className="pn-h2">
        Se tu esquecer a senha
      </h2>
      <ul className="pn-plano-senha">
        <li className={d.outrosDonos.length ? 'feito' : ''}>
          <Ic nome={d.outrosDonos.length ? 'check' : 'equipe'} tamanho={16} />
          {d.outrosDonos.length ? (
            <span>
              <strong>{d.outrosDonos.map((x) => x.nome.split(' ')[0]).join(' e ')}</strong> também {d.outrosDonos.length === 1 ? 'é dono' : 'são donos'}: gera uma senha provisória pra ti em Equipe.
            </span>
          ) : (
            <span>
              Só tu é dono. Cadastra um segundo dono (sócio ou gerente de confiança): se tu esquecer a senha, ele gera uma provisória pra ti.{' '}
              <Link href={caminho.equipeNovoDono} className="pn-link pn-link-dentro">
                Cadastrar um 2º dono
              </Link>
            </span>
          )}
        </li>
        <li className={r.disponivel && r.ligado ? 'feito' : ''}>
          <Ic nome={r.disponivel && r.ligado ? 'check' : 'whatsapp'} tamanho={16} />
          {r.disponivel ? (
            <span>
              {r.ligado ? `O “Esqueci a senha” manda um código pro WhatsApp da loja, ${r.para}.` : 'O código pelo WhatsApp da loja tá desligado.'} Desliga se outras pessoas usam esse celular.
            </span>
          ) : (
            <span>
              Com os Avisos no WhatsApp ligados, o “Esqueci a senha” manda um código pro WhatsApp da loja.{' '}
              {pode('avisos') && (
                <Link href={caminho.avisos} className="pn-link pn-link-dentro">
                  Avisos no WhatsApp
                </Link>
              )}
            </span>
          )}
        </li>
        <li>
          <Ic nome="chave" tamanho={16} />
          <span>Se nada disso der: quem cuida do site gera um código de instalação novo.</span>
        </li>
      </ul>
      {r.disponivel && (
        <label className="pn-troca">
          <input type="checkbox" checked={r.ligado} disabled={mexendo} onChange={(e) => void trocar(e.target.checked)} />
          <span className="pn-troca-marca" aria-hidden="true" />
          <span>Código no WhatsApp da loja</span>
        </label>
      )}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
    </section>
  )
}

export function Conta({ usuario, aoSair }: { usuario: Usuario; aoSair: () => Promise<void> }) {
  useTitulo('Conta')
  const [saindo, setSaindo] = useState(false)
  // a cópia de segurança e a senha esquecida são do dono (gerente e atendente resolvem a senha com ele)
  const dono = pode('servidor', usuario)
  const pronto = usePronto(dono)
  return (
    <>
      <Topo voltar={caminho.mais} titulo={<TituloTela>Conta</TituloTela>} />
      <div className="pn-pagina pn-pagina-estreita">
        <section className="pn-conta-cab" aria-label="Quem tá logado">
          <span className="pn-avatar pn-avatar-aceso pn-avatar-g">
            <Logo tamanho={64} />
          </span>
          <div>
            <p className="pn-conta-nome">{usuario.nome}</p>
            <p className="pn-conta-login">
              @{usuario.login} · {descreverAcesso(usuario)}
            </p>
          </div>
        </section>

        {dono && <BlocoCopia leitura={pronto} />}
        {dono && <SenhaEsquecida leitura={pronto} />}

        <section className="pn-bloco" aria-labelledby="h-senha">
          <h2 id="h-senha" className="pn-h2">
            Trocar a senha
          </h2>
          {!dono && <p className="pn-dica-bloco">Esqueceu a senha? O dono gera uma provisória pra ti em Equipe.</p>}
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
        <RodapePainel />
      </div>
    </>
  )
}
