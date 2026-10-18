/**
 * Bloco de conta no topo do Menu (só no site): "Entrar / Criar conta" ou o apelido com Minha conta, o atalho
 * "Convide amigos" (com a promessa do bônus de OVR), Minhas carreiras, Salvar a última carreira, Sair e Excluir conta.
 * v3.3: "Desafios" (só com um desafio valendo) e "Fale conosco" (sempre), com ou sem conta.
 */
import { useEffect, useState, type ComponentType } from 'react'
import { ArrowRight, ChevronRight, CloudUpload, FolderHeart, LogIn, LogOut, MessageSquareText, Swords, Trash, UserPlus, type LucideProps } from 'lucide-react'
import { navigate } from '@/store/app'
import { criterioEmFrase, temDesafioAtivo, useDesafios, valendo } from './desafios'
import { toast } from '@/ui/primitives'
import { mensagemDeErro } from './api'
import { escolherUltima, hallComUltima, idsNaConta, lerUltima, useCarreiras } from './carreiras'
import { useConta } from './conta'
import { track } from './medicao'
import { salvarManual } from './salvar'
import { useAcesso } from '@/store/acesso'
import { abrirCarreiras, abrirConta, abrirConvideAmigos, abrirPerfil, abrirSuporte } from './ui'
import { promessaIndicacao, useBonus } from './bonus'
import './site.css'

function Linha({ icon: Ico, titulo, sub, onClick, tom, carregando }: { icon: ComponentType<LucideProps>; titulo: string; sub?: string; onClick: () => void; tom?: 'cta' | 'danger'; carregando?: boolean }) {
  return (
    <button type="button" className={tom ? `sc-row sc-row--${tom}` : 'sc-row'} onClick={onClick} aria-busy={carregando || undefined} disabled={carregando}>
      <span className="sc-row__i">
        <Ico aria-hidden="true" className={carregando ? 'lx-spin' : undefined} />
      </span>
      <span className="sc-row__t">
        <b>{titulo}</b>
        {sub && <span>{sub}</span>}
      </span>
      <ChevronRight className="sc-row__chev" aria-hidden="true" />
    </button>
  )
}

/** v3.3: "Desafios" (só com um valendo) e "Fale conosco", no fim do bloco, com ou sem conta. */
function LinhasV33({ fechar }: { fechar: () => void }) {
  const ativo = useDesafios(temDesafioAtivo)
  const d = useDesafios((s) => s.lista.find((x) => valendo(x)) ?? null)
  // o menu abriu: a lista vem (do cache de 60 s, quase sempre)
  useEffect(() => {
    void useDesafios.getState().carregar()
  }, [])
  return (
    <div className="sc-menu__grid">
      {ativo && d && (
        <Linha
          icon={Swords}
          tom="cta"
          titulo={d.titulo}
          sub={`Desafio valendo: ${criterioEmFrase(d.criterio)}`}
          onClick={() => {
            fechar()
            navigate('/desafios')
          }}
        />
      )}
      <Linha
        icon={MessageSquareText}
        titulo="Fale conosco"
        sub="Dúvida, ideia, problema ou recomendação"
        onClick={() => {
          fechar()
          abrirSuporte()
        }}
      />
    </div>
  )
}

export default function ContaMenu({ fechar }: { fechar: () => void }) {
  const usuario = useConta((s) => s.usuario)
  const cadastroAberto = useAcesso((s) => s.cadastroAberto)
  // já ganhou os bônus de todos os amigos (quando o bonus.php já respondeu nesta abertura)
  const indicacoes = useBonus((s) => s.dados?.indicacoes ?? null)
  const [salvando, setSalvando] = useState(false)
  const [saindo, setSaindo] = useState(false)

  if (!usuario) {
    return (
      <div className="sc-menu">
        <Linha
          icon={LogIn}
          tom="cta"
          titulo={cadastroAberto ? 'Entrar / Criar conta' : 'Entrar'}
          sub="Salve suas carreiras em qualquer aparelho"
          onClick={() => {
            fechar()
            abrirConta({ modo: 'manual' })
          }}
        />
        <LinhasV33 fechar={fechar} />
      </div>
    )
  }

  const promessa = promessaIndicacao()
  const salvarUltima = async () => {
    const { h, perdida } = escolherUltima(hallComUltima(), lerUltima())
    if (perdida) {
      toast.info('A última carreira não está no Hall deste aparelho', 'O Hall guarda as 100 de maior nota. As outras carreiras daqui estão em "Minhas carreiras".', {
        action: { label: 'Ver minhas carreiras', onClick: () => abrirCarreiras('aparelho'), icon: ArrowRight },
      })
      return
    }
    if (!h) {
      toast.info('Nenhuma carreira terminada ainda', 'Jogue até a aposentadoria e ela entra no Hall das Lendas.')
      return
    }
    setSalvando(true)
    try {
      const lista = await useCarreiras
        .getState()
        .carregar()
        .catch(() => null)
      if (idsNaConta(lista).has(h.id)) {
        toast.info('Essa carreira já está na sua conta', `${h.identity.surname} · pico ${h.summary.peakOvr}`)
        return
      }
      await salvarManual(h)
    } catch (err) {
      toast.error('Não deu para salvar na conta', mensagemDeErro(err))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="sc-menu">
      <button
        type="button"
        className="sc-me sc-row"
        onClick={() => {
          fechar()
          abrirPerfil()
        }}
      >
        <span className="sc-avatar" aria-hidden="true">
          {usuario.apelido.trim().charAt(0) || '?'}
        </span>
        <span className="sc-me__t">
          <b>{usuario.apelido}</b>
          <span>{usuario.aviso ? 'Minha conta · 1 aviso da moderação' : `Minha conta · ${usuario.email}`}</span>
        </span>
        {usuario.aviso && <span className="sc-dot" aria-hidden="true" />}
        <ChevronRight className="sc-row__chev" aria-hidden="true" />
      </button>
      {promessa && (
        <Linha
          icon={UserPlus}
          tom="cta"
          titulo="Convide amigos"
          sub={indicacoes && indicacoes.limite > 0 && indicacoes.validas >= indicacoes.limite ? 'Você já ganhou todos os bônus de indicação' : promessa}
          onClick={() => {
            fechar()
            abrirConvideAmigos()
          }}
        />
      )}
      <div className="sc-menu__grid">
        <Linha
          icon={FolderHeart}
          titulo="Minhas carreiras"
          sub="Na conta e neste aparelho"
          onClick={() => {
            fechar()
            abrirCarreiras()
          }}
        />
        <Linha icon={CloudUpload} titulo="Salvar a última carreira" sub="A mais recente do Hall" onClick={salvarUltima} carregando={salvando} />
        <Linha
          icon={LogOut}
          titulo="Sair"
          sub="As carreiras ficam neste aparelho"
          carregando={saindo}
          onClick={async () => {
            setSaindo(true)
            try {
              await useConta.getState().sair()
              track('logout')
            } catch {
              /* saiu neste aparelho de todo jeito */
            }
            setSaindo(false)
            toast.info('Você saiu da conta')
          }}
        />
        <Linha
          icon={Trash}
          tom="danger"
          titulo="Excluir conta"
          sub="Pede a senha para confirmar"
          onClick={() => {
            fechar()
            abrirPerfil(true)
          }}
        />
      </div>
      <LinhasV33 fechar={fechar} />
    </div>
  )
}
