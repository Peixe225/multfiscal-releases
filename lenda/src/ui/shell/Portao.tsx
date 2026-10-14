/**
 * Telas do que está fechado no site (src/store/acesso.ts): "Página não encontrada" (Live, #/kit), "Em breve"
 * (Modo Imersivo em desenvolvimento), "Em manutenção" e o carregando enquanto o servidor não respondeu. E o
 * selo "Teste · só admin" quando o admin abre algo que ainda não é público. Fora do site nada disto aparece.
 */
import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { ArrowLeft, ArrowRight, Crown, FlaskConical, Mic, RotateCw, SearchX, Sparkles, Swords, Tv2, Users, Wrench } from 'lucide-react'
import { navigate, useApp } from '@/store/app'
import { podeImersivo, podeLive, rotaImersiva, soAdmin, useAcesso, type Portao } from '@/store/acesso'
import { Button, Eyebrow, Skeleton } from '@/ui/primitives'
import { useReducedMotion } from '@/ui/primitives/hooks'
import { PlaceholderScreen } from './Placeholder'
import { useShellSlots } from './slots'
import './portao.css'

/** Quanto o carregando espera a resposta do servidor antes de tratar como "fechado". */
const ESPERA_MAX_MS = 8000

export function PortaoTela({ tipo }: { tipo: Exclude<Portao, 'ok'> }) {
  const route = useApp((s) => s.route)
  const [cansou, setCansou] = useState(false)
  useEffect(() => {
    if (tipo !== 'verificar') return
    setCansou(false)
    const t = window.setTimeout(() => setCansou(true), ESPERA_MAX_MS)
    return () => window.clearTimeout(t)
  }, [tipo, route.path])
  useShellSlots({ sub: tipo === 'manutencao' ? 'MANUTENÇÃO' : '' }, [tipo])
  const efetivo = tipo === 'verificar' && cansou ? (rotaImersiva(route) ? 'em-breve' : 'nao-encontrada') : tipo
  if (efetivo === 'verificar') {
    return (
      <div className="relative z-[1] flex-1 w-full max-w-[720px] mx-auto px-4 sm:px-6 pt-10 grid gap-3 content-start" aria-busy="true" aria-label="Carregando">
        <Skeleton h={160} r={22} />
        <Skeleton h={90} r={22} />
      </div>
    )
  }
  if (efetivo === 'em-breve') return <EmBreve />
  if (efetivo === 'manutencao') return <Manutencao />
  return (
    <PlaceholderScreen
      eyebrow="Erro 404"
      title="Página não encontrada"
      icon={SearchX}
      description="Esse endereço não existe (ou saiu do ar). Que tal escrever a carreira de uma lenda?"
      actions={
        <>
          <Button variant="primary" size="md" iconRight={ArrowRight} onClick={() => navigate('/', { replace: true })}>
            Ir para o início
          </Button>
          <Button variant="ghost" size="md" icon={Crown} onClick={() => navigate('/hall')}>
            Hall das Lendas
          </Button>
        </>
      }
    />
  )
}

const EM_BREVE = [
  { icon: Swords, t: 'Entre em campo nos lances decisivos', d: 'Chute, passe, drible e pênalti: você decide.' },
  { icon: Mic, t: 'Imprensa, redes e vestiário', d: 'Cada resposta muda a sua moral e a torcida.' },
  { icon: Users, t: 'Semana a semana', d: 'Treino, mercado, propostas e a tabela rodada a rodada.' },
]

function EmBreve() {
  const rm = useReducedMotion()
  const rise = (i: number) => (rm ? {} : { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.5, delay: 0.06 * i, ease: [0.16, 1, 0.3, 1] as const } })
  return (
    <main id="conteudo" tabIndex={-1} className="pt-wrap outline-none">
      <motion.section className="pt-card lx-glass" aria-labelledby="pt-breve-h" {...rise(0)}>
        <span className="pt-card__glow" aria-hidden="true" />
        <div className="pt-card__top">
          <span className="pt-ic" aria-hidden="true">
            <Tv2 size={22} />
          </span>
          <span className="pt-pill">
            <Sparkles size={12} aria-hidden /> Em desenvolvimento
          </span>
        </div>
        <Eyebrow>Modo Imersivo</Eyebrow>
        <h1 id="pt-breve-h" className="pt-h1">
          Partida a partida, <span className="lx-metal-text">em breve.</span>
        </h1>
        <p className="pt-lead">Estamos terminando o modo em que você joga cada partida da carreira. Enquanto isso, o Modo Clássico está completo: dos 16 aos 40 anos, com tabelas reais de hoje, Bolas de Ouro e Copas do Mundo.</p>
        <ul className="pt-list">
          {EM_BREVE.map((x, i) => (
            <motion.li key={x.t} {...rise(1 + i)}>
              <span className="pt-list__i" aria-hidden="true">
                <x.icon size={16} />
              </span>
              <span>
                <b>{x.t}</b>
                <small>{x.d}</small>
              </span>
            </motion.li>
          ))}
        </ul>
        <div className="pt-acts">
          <Button variant="primary" size="lg" iconRight={ArrowRight} onClick={() => navigate('/identidade', { replace: true })}>
            Jogar o Modo Clássico
          </Button>
          <Button variant="ghost" size="lg" icon={ArrowLeft} onClick={() => navigate('/', { replace: true })}>
            Voltar ao início
          </Button>
        </div>
      </motion.section>
    </main>
  )
}

function Manutencao() {
  return (
    <PlaceholderScreen
      eyebrow="LENDA"
      title="Em manutenção"
      icon={Wrench}
      description="Estamos ajustando o LENDA para receber todo mundo. Volte em alguns minutos — as carreiras e o Hall das Lendas deste aparelho continuam guardados aqui."
      actions={
        <Button variant="primary" size="md" icon={RotateCw} onClick={() => location.reload()}>
          Tentar de novo
        </Button>
      }
    />
  )
}

/** "Teste · só admin": o admin está numa tela que o público ainda não vê (Modo Imersivo, Live). */
export function SeloAdmin() {
  const route = useApp((s) => s.route)
  const acesso = useAcesso()
  const imm = rotaImersiva(route)
  const live = route.path === '/live'
  const mostra = (imm && podeImersivo(acesso) && soAdmin(acesso, acesso.imersivoPublico)) || (live && podeLive(acesso) && soAdmin(acesso, acesso.livePublica))
  if (!mostra) return null
  return (
    <span className="pt-selo" role="status">
      <FlaskConical size={13} aria-hidden /> Teste · só admin
    </span>
  )
}
