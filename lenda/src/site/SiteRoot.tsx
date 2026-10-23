/**
 * Raiz do site (montada pelo AppShell só com VITE_SITE=1): liga a medição e as regras de conta
 * (./vigias) e mostra os diálogos de conta, perfil e carreiras quando abertos.
 */
import { useEffect, useState } from 'react'
import { toast } from '@/ui/primitives'
import { lazySite, precarregarSite } from '@/ui/shell/lazySite'
import { iniciarSite } from './vigias'
import { useSiteUi } from './ui'
import { depoisDaAbertura, economizandoDados, ehFalhaDeRede, resumoDoErro } from './abertura'
import { track } from './medicao'

/**
 * Um diálogo do site caiu: fecha e avisa, em vez de derrubar o jogo. Sem rede (o pedaço não veio, ou o aparelho está
 * offline): "Sem conexão". Erro de JS ao desenhar (um bug, não a internet): "Algo deu errado" e um evento de erro para a
 * medição (v3.5: antes tudo virava "Sem conexão", com a internet funcionando).
 */
export function aoFalharDialogo(qual: string) {
  return (e: unknown) => {
    useSiteUi.getState().fechar()
    if (ehFalhaDeRede(e)) {
      toast.error('Sem conexão', 'Tente de novo quando a internet voltar.', { key: 'site-sem-rede' })
      return
    }
    toast.error('Algo deu errado', 'Recarregue a página.', { key: 'site-erro', action: { label: 'Recarregar', onClick: () => location.reload() } })
    track('erro', null, { onde: qual, msg: resumoDoErro(e) })
  }
}

const ConviteConta = lazySite('ConviteConta', () => import('./ConviteConta'), { aoFalhar: aoFalharDialogo('ConviteConta') })
const MinhaConta = lazySite('MinhaConta', () => import('./MinhaConta'), { aoFalhar: aoFalharDialogo('MinhaConta') })
const MinhasCarreiras = lazySite('MinhasCarreiras', () => import('./MinhasCarreiras'), { aoFalhar: aoFalharDialogo('MinhasCarreiras') })
const FaleConosco = lazySite('FaleConosco', () => import('./FaleConosco'), { aoFalhar: aoFalharDialogo('FaleConosco') })
const VerificarEmail = lazySite('VerificarEmail', () => import('./VerificarEmail'), { aoFalhar: aoFalharDialogo('VerificarEmail') })

/** Monta o diálogo na primeira abertura e o mantém (a animação de saída roda). `desmontar`: depois de uma falha. */
function useMontado(aberto: boolean): [boolean, () => void] {
  const [m, setM] = useState(false)
  useEffect(() => {
    if (aberto) setM(true)
  }, [aberto])
  return [m || aberto, () => setM(false)]
}

/**
 * Os pedaços que o menu, o convite, os diálogos e o fim de carreira usam: chegam depois de o jogo aparecer e o navegador
 * sossegar (no 4G lento eles disputavam a rede com a primeira tela), primeiro o menu e o convite das 5 partidas, depois o
 * resto. Com "economia de dados" ligada, nada (cada um vem quando for aberto). Devolve o cancelar.
 */
export function precarregarDialogos(): () => void {
  if (economizandoDados()) return () => {}
  let parar2 = () => {}
  const menu = () => import('./ContaMenu')
  const convite = () => import('./ConviteConta')
  const parar1 = depoisDaAbertura(() => {
    precarregarSite('ContaMenu', menu)
    precarregarSite('ConviteConta', convite)
    // o import() repetido não baixa de novo: só espera os dois chegarem (ou falharem) para pedir o resto
    void Promise.allSettled([menu(), convite()]).then(() => {
      parar2 = depoisDaAbertura(
        () => {
          precarregarSite('MinhaConta', () => import('./MinhaConta'))
          precarregarSite('MinhasCarreiras', () => import('./MinhasCarreiras'))
          precarregarSite('SalvarNaConta', () => import('./SalvarNaConta'))
          precarregarSite('ConvideAmigos', () => import('./ConvideAmigos'))
          precarregarSite('DenunciarCarreira', () => import('./DenunciarCarreira'))
          precarregarSite('VerificarEmail', () => import('./VerificarEmail'))
        },
        { reservaMs: 1500 },
      )
    })
  })
  return () => {
    parar1()
    parar2()
  }
}

export default function SiteRoot() {
  const tipo = useSiteUi((s) => s.dialogo?.tipo ?? null)
  const [conta, tirarConta] = useMontado(tipo === 'conta')
  const [perfil, tirarPerfil] = useMontado(tipo === 'perfil')
  const [carreiras, tirarCarreiras] = useMontado(tipo === 'carreiras')
  const [suporte, tirarSuporte] = useMontado(tipo === 'suporte')
  const [verificar, tirarVerificar] = useMontado(tipo === 'verificar')

  useEffect(() => {
    iniciarSite()
    return precarregarDialogos()
  }, [])

  // cada diálogo no seu próprio lazySite: carregar um não esconde o outro; um que falhou sai e, na próxima
  // abertura, monta de novo (com um import novo)
  return (
    <>
      {conta && <ConviteConta aoFalhar={tirarConta} />}
      {perfil && <MinhaConta aoFalhar={tirarPerfil} />}
      {carreiras && <MinhasCarreiras aoFalhar={tirarCarreiras} />}
      {suporte && <FaleConosco aoFalhar={tirarSuporte} />}
      {verificar && <VerificarEmail aoFalhar={tirarVerificar} />}
    </>
  )
}
