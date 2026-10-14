/**
 * Raiz do site (montada pelo AppShell só com VITE_SITE=1): liga a medição e as regras de conta
 * (./vigias) e mostra os diálogos de conta, perfil e carreiras quando abertos.
 */
import { useEffect, useState } from 'react'
import { toast } from '@/ui/primitives'
import { lazySite, precarregarSite } from '@/ui/shell/lazySite'
import { iniciarSite } from './vigias'
import { useSiteUi } from './ui'

/** O pedaço do diálogo não veio (sem rede): fecha e avisa, em vez de derrubar o jogo. */
const semRede = () => {
  useSiteUi.getState().fechar()
  toast.error('Sem conexão', 'Tente de novo quando a internet voltar.', { key: 'site-sem-rede' })
}

const ConviteConta = lazySite('ConviteConta', () => import('./ConviteConta'), { aoFalhar: semRede })
const MinhaConta = lazySite('MinhaConta', () => import('./MinhaConta'), { aoFalhar: semRede })
const MinhasCarreiras = lazySite('MinhasCarreiras', () => import('./MinhasCarreiras'), { aoFalhar: semRede })

/** Monta o diálogo na primeira abertura e o mantém (a animação de saída roda). `desmontar`: depois de uma falha. */
function useMontado(aberto: boolean): [boolean, () => void] {
  const [m, setM] = useState(false)
  useEffect(() => {
    if (aberto) setM(true)
  }, [aberto])
  return [m || aberto, () => setM(false)]
}

export default function SiteRoot() {
  const tipo = useSiteUi((s) => s.dialogo?.tipo ?? null)
  const [conta, tirarConta] = useMontado(tipo === 'conta')
  const [perfil, tirarPerfil] = useMontado(tipo === 'perfil')
  const [carreiras, tirarCarreiras] = useMontado(tipo === 'carreiras')

  useEffect(() => {
    iniciarSite()
    // os pedaços que o menu, o convite, os diálogos e o fim de carreira usam já vão chegando, sem atrasar a
    // primeira tela (e sem rede depois, eles já estão aqui)
    const t = window.setTimeout(() => {
      precarregarSite('ContaMenu', () => import('./ContaMenu'))
      precarregarSite('ConviteConta', () => import('./ConviteConta'))
      precarregarSite('MinhaConta', () => import('./MinhaConta'))
      precarregarSite('MinhasCarreiras', () => import('./MinhasCarreiras'))
      precarregarSite('SalvarNaConta', () => import('./SalvarNaConta'))
    }, 2500)
    return () => window.clearTimeout(t)
  }, [])

  // cada diálogo no seu próprio lazySite: carregar um não esconde o outro; um que falhou sai e, na próxima
  // abertura, monta de novo (com um import novo)
  return (
    <>
      {conta && <ConviteConta aoFalhar={tirarConta} />}
      {perfil && <MinhaConta aoFalhar={tirarPerfil} />}
      {carreiras && <MinhasCarreiras aoFalhar={tirarCarreiras} />}
    </>
  )
}
