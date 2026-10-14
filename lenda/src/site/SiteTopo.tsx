/**
 * Atalho discreto na barra do topo do Hall das Lendas: "Minhas carreiras na conta" (só no site).
 */
import { FolderHeart } from 'lucide-react'
import type { RoutePath } from '@/store/app'
import { Button, IconButton, useMediaQuery } from '@/ui/primitives'
import { abrirCarreiras } from './ui'

export default function SiteTopo({ path }: { path: RoutePath }) {
  const largo = useMediaQuery('(min-width: 64rem)')
  if (path !== '/hall') return null
  if (!largo) return <IconButton label="Minhas carreiras na conta" icon={FolderHeart} onClick={() => abrirCarreiras('conta')} />
  return (
    <Button variant="ghost" size="sm" icon={FolderHeart} onClick={() => abrirCarreiras('conta')}>
      Minhas carreiras na conta
    </Button>
  )
}
