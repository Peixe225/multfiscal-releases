import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { config } from '../dados/config'
import { Logo, LogoPixel } from '../arte/Logo'
import { liberarArtesRealistas } from '../arte/realista/carregar'
import { gravar, ler } from '../lib/armazenamento'
import { movimentoReduzido } from '../lib/movimento'
import { useLocal } from '../store/local'
import { Icone } from './comum'
import { AdesivoLocal, useTextoLocal } from './Local'
import './Abertura.css'

const CHAVE_IDADE = 'gc-idade'

export function idadeLembrada(): boolean {
  const ate = ler<number>(CHAVE_IDADE, 0)
  return typeof ate === 'number' && ate > Date.now()
}

function lembrarIdade() {
  gravar(CHAVE_IDADE, Date.now() + config.lembrarIdadeDias * 86400000)
}

type Fase = 'logo' | 'idade' | 'local'

/**
 * Abertura (uma vez por visita, pulável): é um story de 3 quadros.
 * 1) o logo se monta em pixels e a tesoura dá um corte; 2) a tesoura recorta o adesivo de enquete "Tem 18 anos ou mais?";
 * 3) o adesivo de localização cola com o estado detectado e voa até o topo.
 */
export function Abertura({ aoTerminar, aoSair }: { aoTerminar: () => void; aoSair: () => void }) {
  const jaTem18 = useRef(idadeLembrada()).current
  const fases: Fase[] = jaTem18 ? ['logo', 'local'] : ['logo', 'idade', 'local']
  const [fase, setFase] = useState<Fase>('logo')
  const [escolha, setEscolha] = useState<'sim' | 'nao' | null>(null)
  const [logoPronto, setLogoPronto] = useState(false)
  const reduz = movimentoReduzido()
  const raiz = useRef<HTMLDivElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const pixels = useRef<HTMLDivElement>(null)
  const adesivo = useRef<HTMLDivElement>(null)
  const { texto, procurando } = useTextoLocal()
  const detectando = useLocal((s) => s.detectando)
  const barras = useRef<(HTMLElement | null)[]>([])
  const saindo = useRef(false)

  const indice = fases.indexOf(fase)

  // saiu do logo: o quadro agora é parado (+18 ou local), hora boa pra baixar as ilustrações dos produtos
  useEffect(() => {
    if (fase !== 'logo') liberarArtesRealistas()
  }, [fase])

  const terminar = useCallback(() => {
    if (saindo.current) return
    saindo.current = true
    const el = raiz.current
    const a = adesivo.current?.querySelector('.adesivo-local')
    const destino = document.querySelector('.topo-local .adesivo-local, .lateral .adesivo-local') as HTMLElement | null
    if (!el || reduz) {
      aoTerminar()
      return
    }
    const tl = gsap.timeline({ onComplete: aoTerminar })
    if (a && destino) {
      const r = a.getBoundingClientRect()
      const d = destino.getBoundingClientRect()
      if (d.width > 0) {
        tl.to(a, { x: d.left - r.left, y: d.top - r.top, scale: d.width / r.width, rotate: 0, duration: 0.5, ease: 'power3.inOut', transformOrigin: '0 0' }, 0)
      }
    }
    tl.to(el.querySelector('.abertura-fundo'), { opacity: 0, duration: 0.4, ease: 'none' }, 0.1)
    tl.to(el.querySelectorAll('.abertura-some'), { opacity: 0, duration: 0.2, ease: 'steps(2)' }, 0)
  }, [aoTerminar, reduz])

  // quadro 1: o logo se monta bloco a bloco (cada passo acende por opacity) → vira o vetor → a tesoura corta
  useLayoutEffect(() => {
    if (fase !== 'logo') return
    const passos = pixels.current?.querySelectorAll('[data-ordem]')
    if (reduz || !passos?.length) {
      setLogoPronto(true)
      return
    }
    const tl = gsap.timeline({ onComplete: () => setLogoPronto(true) })
    tl.fromTo(passos, { opacity: 0 }, { opacity: 1, duration: 0.01, stagger: 0.032, ease: 'none' })
    return () => {
      tl.kill()
    }
  }, [fase, reduz])

  useLayoutEffect(() => {
    if (!logoPronto || fase !== 'logo') return
    const h = host.current
    if (!h) return
    if (reduz) {
      const t = setTimeout(() => setFase(fases[1]), 500)
      return () => clearTimeout(t)
    }
    const a = h.querySelector('.logo-lamina-a')
    const b = h.querySelector('.logo-lamina-b')
    const tl = gsap.timeline({ onComplete: () => setFase(fases[1]) })
    tl.to(pixels.current, { opacity: 0, duration: 0.2, ease: 'steps(2)' }, 0)
    tl.fromTo(h, { opacity: 0 }, { opacity: 1, duration: 0.2, ease: 'steps(2)' }, 0)
    if (a && b) {
      // o corte: as lâminas fecham e abrem, duas vezes
      tl.to(a, { rotate: 14, duration: 0.09, ease: 'steps(2)', yoyo: true, repeat: 3 }, 0.25)
      tl.to(b, { rotate: -14, duration: 0.09, ease: 'steps(2)', yoyo: true, repeat: 3 }, 0.25)
    }
    tl.to({}, { duration: 0.15 })
    return () => {
      tl.kill()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logoPronto, fase])

  // quadro 2: a tesoura percorre o tracejado e o adesivo de enquete descola
  useLayoutEffect(() => {
    if (fase !== 'idade' || !raiz.current) return
    const q = raiz.current.querySelector('.abertura-idade')
    if (!q) return
    if (reduz) return
    const tl = gsap.timeline()
    tl.fromTo(q.querySelector('.abertura-pergunta'), { opacity: 0 }, { opacity: 1, duration: 0.24, ease: 'steps(3)' })
    tl.fromTo(q.querySelector('.abertura-recorte'), { opacity: 0 }, { opacity: 1, duration: 0.1, ease: 'steps(1)' }, 0.1)
    tl.fromTo(q.querySelector('.abertura-tesoura'), { x: 0 }, { x: () => (q.querySelector('.abertura-recorte') as HTMLElement).offsetWidth - 24, duration: 0.5, ease: 'steps(10)' }, 0.15)
    tl.fromTo(q.querySelector('.enquete'), { opacity: 0, y: 6, rotate: 0 }, { opacity: 1, y: -6, rotate: -3, duration: 0.3, ease: 'power3.out' }, 0.62)
    tl.to(q.querySelector('.abertura-recorte'), { opacity: 0, duration: 0.1, ease: 'steps(1)' }, 0.62)
    tl.to(q.querySelector('.abertura-tesoura'), { opacity: 0, duration: 0.1, ease: 'steps(1)' }, 0.66)
    return () => {
      tl.kill()
    }
  }, [fase, reduz])

  // quadro 3: o adesivo cola com pop e, depois, voa até o topo
  useLayoutEffect(() => {
    if (fase !== 'local') return
    const a = adesivo.current?.querySelector('.adesivo-local')
    if (a && !reduz) gsap.fromTo(a, { scale: 0, rotate: -12 }, { scale: 1, rotate: -4, duration: 0.42, ease: 'back.out(2.2)' })
  }, [fase, reduz])

  useEffect(() => {
    if (fase !== 'local') return
    // espera o palpite de IP (até o limite dele) para o adesivo cair com o estado; nunca segura mais que ~1,6 s
    const espera = detectando ? 1600 : 900
    const t = setTimeout(terminar, espera)
    return () => clearTimeout(t)
  }, [fase, detectando, terminar])

  // barrinhas: a do quadro atual enche (a do +18 só enche quando a pessoa responde)
  useEffect(() => {
    barras.current.forEach((b, k) => {
      if (!b) return
      gsap.killTweensOf(b)
      if (k < indice) gsap.set(b, { scaleX: 1 })
      else if (k > indice) gsap.set(b, { scaleX: 0 })
      else if (fase === 'idade') gsap.set(b, { scaleX: escolha ? 1 : 0 })
      else gsap.fromTo(b, { scaleX: 0 }, { scaleX: 1, duration: reduz ? 0 : fase === 'logo' ? 1.4 : 1, ease: 'none' })
    })
  }, [indice, fase, escolha, reduz])

  const responder = (v: 'sim' | 'nao') => {
    if (escolha) return
    setEscolha(v)
    const op = raiz.current?.querySelector(`.enquete-opcao[data-v="${v}"] .enquete-cheio`)
    const seguir = () => {
      if (v === 'sim') {
        lembrarIdade()
        setFase('local')
      } else aoSair()
    }
    if (op && !reduz) gsap.to(op, { scaleX: 1, duration: 0.3, ease: 'steps(6)', onComplete: () => setTimeout(seguir, 140) })
    else seguir()
  }

  const pular = () => {
    if (fase === 'idade') return
    if (!jaTem18 && fase === 'logo') {
      setLogoPronto(true)
      setFase('idade')
      return
    }
    terminar()
  }

  return (
    <div ref={raiz} className="abertura" role="dialog" aria-modal="true" aria-label="Green Cheese Imports" onClick={(e) => {
      if ((e.target as HTMLElement).closest('button, a')) return
      if (fase === 'logo' && logoPronto) setFase(fases[1])
      else if (fase === 'local') terminar()
    }}>
      <div className="abertura-fundo" />
      <div className="abertura-barras abertura-some" aria-hidden="true">
        {fases.map((f, k) => (
          <span key={f} className="story-barra">
            <i ref={(el) => { barras.current[k] = el }} />
          </span>
        ))}
      </div>
      <button type="button" className="abertura-pular icone-botao toque abertura-some" onClick={pular} aria-label={fase === 'idade' ? 'Responda para entrar' : 'Pular abertura'} disabled={fase === 'idade'}>
        <Icone nome="fechar" tamanho={20} />
      </button>

      {fase === 'logo' && (
        <div className="abertura-logo abertura-some">
          <div ref={pixels} className="abertura-pixels" aria-hidden="true">
            <LogoPixel tamanho="100%" />
          </div>
          <div ref={host} className="abertura-vetor" style={{ opacity: reduz ? 1 : 0 }}>
            <Logo tamanho="100%" titulo="Green Cheese Imports" />
          </div>
        </div>
      )}

      {fase === 'idade' && (
        <div className="abertura-idade abertura-some">
          <div className="abertura-marca">
            <Logo tamanho={56} />
          </div>
          <p className="abertura-pergunta px">TEM 18 ANOS OU MAIS?</p>
          <div className="abertura-corte">
            <span className="abertura-recorte" aria-hidden="true" />
            <span className="abertura-tesoura" aria-hidden="true">
              <Icone nome="tesoura" tamanho={24} />
            </span>
            <div className="enquete abertura-enquete" role="group" aria-label="Tem 18 anos ou mais?">
              <p className="enquete-pergunta">Tem 18 anos ou mais?</p>
              <div className="enquete-opcoes">
                <button type="button" data-v="sim" className={`enquete-opcao toque ${escolha === 'sim' ? 'escolhida' : ''}`} onClick={() => responder('sim')} autoFocus>
                  <span className="enquete-cheio" />
                  <span>Tenho</span>
                </button>
                <button type="button" data-v="nao" className={`enquete-opcao toque ${escolha === 'nao' ? 'escolhida' : ''}`} onClick={() => responder('nao')}>
                  <span className="enquete-cheio" />
                  <span>Não tenho</span>
                </button>
              </div>
            </div>
          </div>
          <p className="abertura-nota legenda">A gente lembra por {config.lembrarIdadeDias} dias neste aparelho.</p>
        </div>
      )}

      {fase === 'local' && (
        <div className="abertura-local">
          <div className="abertura-marca abertura-some">
            <Logo tamanho={56} />
          </div>
          <div ref={adesivo} className="abertura-adesivo">
            <AdesivoLocal texto={texto} procurando={procurando} tamanho="g" inclinacao={-4} />
          </div>
          <p className="abertura-nota abertura-some legenda">{procurando ? 'Achando o atendimento mais perto…' : 'Vem no certo!'}</p>
        </div>
      )}
    </div>
  )
}

/** "Não tenho": tela no molde do aviso de conteúdo sensível do Instagram, com dither no lugar do desfoque. */
export function Saida({ voltar }: { voltar: () => void }) {
  return (
    <div className="saida" role="dialog" aria-modal="true" aria-labelledby="saida-titulo">
      <Icone nome="olho-riscado" tamanho={64} />
      <h1 id="saida-titulo" className="saida-titulo">
        Aqui é só pra maiores de 18.
      </h1>
      <p className="saida-txt legenda">A Green Cheese vende bebida alcoólica e acessórios. A venda é proibida para menores de 18 anos.</p>
      <button type="button" className="saida-voltar" onClick={voltar}>
        Errei, voltar
      </button>
    </div>
  )
}
