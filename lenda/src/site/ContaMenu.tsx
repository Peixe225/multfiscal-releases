/**
 * Bloco de conta no topo do Menu (só no site): "Entrar / Criar conta" ou o apelido com Minha conta,
 * Minhas carreiras, Salvar a última carreira, Sair e Excluir conta.
 */
import { useState, type ComponentType } from 'react'
import { ArrowRight, ChevronRight, CloudUpload, FolderHeart, LogIn, LogOut, Trash, type LucideProps } from 'lucide-react'
import { toast } from '@/ui/primitives'
import { mensagemDeErro } from './api'
import { escolherUltima, hallComUltima, idsNaConta, lerUltima, useCarreiras } from './carreiras'
import { useConta } from './conta'
import { track } from './medicao'
import { salvarManual } from './salvar'
import { useAcesso } from '@/store/acesso'
import { abrirCarreiras, abrirConta, abrirPerfil } from './ui'
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

export default function ContaMenu({ fechar }: { fechar: () => void }) {
  const usuario = useConta((s) => s.usuario)
  const cadastroAberto = useAcesso((s) => s.cadastroAberto)
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
      </div>
    )
  }

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
          <span>Minha conta · {usuario.email}</span>
        </span>
        <ChevronRight className="sc-row__chev" aria-hidden="true" />
      </button>
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
    </div>
  )
}
