/**
 * No fim da carreira (#/resumo): "Salvar na minha conta", ou o selo "Salva na sua conta" quando já está.
 * Numa carreira aberta da conta que não está neste aparelho: "Guardar no Hall deste aparelho".
 */
import { useEffect, useState } from 'react'
import { CloudCheck, CloudUpload, HardDriveDownload } from 'lucide-react'
import { useCareer } from '@/store/career'
import { Button, toast } from '@/ui/primitives'
import { mensagemDeErro } from './api'
import { ehTransitoria, guardarNoAparelho, idsNaConta, useCarreiras } from './carreiras'
import { useConta } from './conta'
import { abrirCarreiras, abrirConta } from './ui'
import './site.css'

export default function SalvarNaConta({ careerId, finished, size = 'lg' }: { careerId: string; finished: boolean; size?: 'md' | 'lg' }) {
  // no Hall ou, se o teto do Hall a cortou, a última encerrada nesta janela
  const entry = useCareer((s) => s.finishedCareers.find((h) => h.id === careerId) ?? (s.lastFinished?.id === careerId ? s.lastFinished : null))
  const usuario = useConta((s) => s.usuario)
  const lista = useCarreiras((s) => s.lista)
  const salvando = useCarreiras((s) => !!s.salvando[careerId])
  const [guardando, setGuardando] = useState(false)
  const [, refazer] = useState(0)
  const transitoria = !!entry && ehTransitoria(entry.id)

  useEffect(() => {
    if (usuario && !lista) void useCarreiras.getState().carregar().catch(() => {})
  }, [usuario, lista])

  if (!finished || !entry) return null
  const naConta = idsNaConta(lista).has(careerId)

  if (transitoria) {
    return (
      <Button
        variant="ghost"
        size={size}
        icon={HardDriveDownload}
        loading={guardando}
        onClick={async () => {
          setGuardando(true)
          const ok = await guardarNoAparelho(careerId)
          setGuardando(false)
          refazer((n) => n + 1)
          if (ok) toast.success('No Hall deste aparelho', `${entry.identity.surname} agora aparece no seu Hall das Lendas.`)
          else toast.error('Não deu para guardar', 'O navegador bloqueou o armazenamento.')
        }}
      >
        Guardar no Hall deste aparelho
      </Button>
    )
  }
  if (usuario && naConta) {
    return (
      <button type="button" className={size === 'md' ? 'sc-saved sc-saved--md' : 'sc-saved'} onClick={() => abrirCarreiras('conta')}>
        <CloudCheck aria-hidden="true" /> Salva na sua conta
      </button>
    )
  }
  return (
    <Button
      variant="ghost"
      size={size}
      icon={CloudUpload}
      loading={salvando}
      onClick={async () => {
        if (!useConta.getState().usuario) {
          abrirConta({ modo: 'manual', depois: { salvar: careerId } })
          return
        }
        try {
          await useCarreiras.getState().salvar(entry, 'manual')
          toast.success('Salva na sua conta', `${entry.identity.surname} · pico ${entry.summary.peakOvr}`)
        } catch (err) {
          toast.error('Não deu para salvar na conta', mensagemDeErro(err))
        }
      }}
    >
      Salvar na minha conta
    </Button>
  )
}
