// A foto e a thumb animada do produto (painel → Produto). A foto escolhida abre o Estúdio da foto (fica no estilo do
// site: sem fundo, no meio, com a cor acertada); "Ajustar a foto" abre o Estúdio com a foto já salva. A thumb animada
// abre o Estúdio do vídeo: trecho de até 6 s, o mesmo estilo e a capa. Os Estúdios são um pedaço à parte (só baixam
// quando o dono usa).
import { lazy, Suspense, useRef, useState, type ReactNode } from 'react'
import * as apiBase from '../api'
import { urlImagem } from '../Arte'
import { prepararFoto } from '../imagem'
import { Aviso, Ic, Pontinhos } from '../ui'
import { ArteProduto } from './Arte'
import type { FotoPronta } from '../estudio/Estudio'
import type { VideoPronto } from '../estudio/EstudioVideo'

const EstudioFoto = lazy(() => import('../estudio/Estudio').then((m) => ({ default: m.EstudioFoto })))
const EstudioVideo = lazy(() => import('../estudio/EstudioVideo').then((m) => ({ default: m.EstudioVideo })))

const TIPOS_FOTO = /^image\/(jpeg|png|webp)$/

interface FotoProps {
  foto: string | null
  nome: string
  preco: number | null
  cor: string
  /** Foto nova (e a cor que ela sugere pro halo; null = a de antes). */
  aoMudar: (foto: string | null, cor: string | null) => void
  previa: ReactNode
  semFoto: string
}

/**
 * A foto do produto: escolhida, abre o Estúdio (o celular trata e sobe a pronta pelo admin-upload); vira a capa do card
 * no site. Do lado, o card como o cliente vê (no computador ele fica na coluna da prévia).
 */
export function FotoProduto({ foto, nome, preco, cor, aoMudar, previa, semFoto }: FotoProps) {
  const [falha, setFalha] = useState<string | null>(null)
  const [estudio, setEstudio] = useState<{ arquivo: Blob; original: File | null } | null>(null)
  const [abrindo, setAbrindo] = useState(false)
  const entrada = useRef<HTMLInputElement>(null)
  const escolher = (f: File | undefined) => {
    if (entrada.current) entrada.current.value = ''
    if (!f) return
    setFalha(null)
    if (!TIPOS_FOTO.test(f.type)) {
      setFalha('Manda foto em JPG, PNG ou WebP.')
      return
    }
    setEstudio({ arquivo: f, original: f })
  }
  // "Ajustar a foto": a salva volta pro Estúdio (a de antes do Estúdio, de fundo claro, é o caso comum)
  const ajustar = async () => {
    if (!foto || abrindo) return
    setFalha(null)
    setAbrindo(true)
    try {
      const r = await fetch(urlImagem(foto), { credentials: 'same-origin' })
      if (!r.ok) throw new Error()
      setEstudio({ arquivo: await r.blob(), original: null })
    } catch {
      setFalha('Não deu pra abrir a foto salva. Confere a internet e tenta de novo.')
    } finally {
      setAbrindo(false)
    }
  }
  const subir = async (blob: Blob, nomeArquivo: string, andou: (f: number) => void) => (await apiBase.enviarImagem(blob, nomeArquivo, andou)).imagem
  return (
    <div className="pn-foto pn-foto-produto">
      <div className="pn-foto-card">{previa}</div>
      <div className="pn-foto-lado">
        <p className="pn-dica-bloco">{foto ? 'No site, o preto da foto some no preto da página. Foto de fundo claro? “Ajustar a foto” tira o fundo.' : semFoto}</p>
        <div className="pn-foto-acoes">
          <label className="pn-botao pn-botao-cinza">
            <Ic nome="camera" tamanho={16} />
            <span className="pn-botao-txt">{foto ? 'Trocar foto' : 'Enviar foto'}</span>
            <input ref={entrada} id="p-foto" name="foto" type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => escolher(e.target.files?.[0])} />
          </label>
          {foto && (
            <button type="button" className={`pn-botao pn-botao-cinza${abrindo ? ' pn-ocupado' : ''}`} onClick={() => void ajustar()} aria-busy={abrindo || undefined}>
              {abrindo ? <Pontinhos rotulo="Abrindo a foto…" /> : <Ic nome="editar" tamanho={16} />}
              <span className="pn-botao-txt">Ajustar a foto</span>
            </button>
          )}
          {foto && (
            <button type="button" className="pn-botao pn-botao-texto" onClick={() => aoMudar(null, null)}>
              <span className="pn-botao-txt">Tirar foto</span>
            </button>
          )}
        </div>
        {falha && <Aviso tipo="erro">{falha}</Aviso>}
      </div>
      {estudio && (
        <Suspense fallback={null}>
          <EstudioFoto
            arquivo={estudio.arquivo}
            nome={nome}
            preco={preco}
            cor={cor}
            aoFechar={() => setEstudio(null)}
            aoUsar={async (f: FotoPronta, andou) => {
              const caminho = await subir(f.blob, f.nome, andou)
              aoMudar(caminho, f.cor)
              setEstudio(null)
            }}
            aoUsarOriginal={
              estudio.original
                ? async (andou) => {
                    const pronta = await prepararFoto(estudio.original as File)
                    const caminho = await subir(pronta.blob, pronta.nome, andou)
                    aoMudar(caminho, null)
                    setEstudio(null)
                  }
                : null
            }
          />
        </Suspense>
      )}
    </div>
  )
}

interface VideoProps {
  video: string | null
  capa: string | null
  nome: string
  preco: number | null
  cor: string
  aoMudar: (v: { video: string; capa: string } | null) => void
}

/** Vídeo que o painel aceita escolher (o Estúdio confere de novo se o navegador abre). */
const TIPOS_VIDEO = /^video\/(mp4|quicktime|webm|x-m4v)$|^image\/gif$/

/** A thumb animada: um vídeo curto do celular vira o vídeo do card no site (no estilo da foto, sobre preto). */
export function VideoProduto({ video, capa, nome, preco, cor, aoMudar }: VideoProps) {
  const [falha, setFalha] = useState<string | null>(null)
  const [arquivo, setArquivo] = useState<File | null>(null)
  const entrada = useRef<HTMLInputElement>(null)
  const escolher = (f: File | undefined) => {
    if (entrada.current) entrada.current.value = ''
    if (!f) return
    setFalha(null)
    if (!TIPOS_VIDEO.test(f.type) && !/\.(mp4|mov|m4v|webm|gif)$/i.test(f.name)) {
      setFalha('Manda um vídeo (MP4, MOV ou WebM).')
      return
    }
    setArquivo(f)
  }
  return (
    <div className="pn-foto pn-foto-produto pn-video-produto">
      <div className="pn-foto-card">
        {video && capa ? (
          <ArteProduto produto={{ id: 'thumb', nome, cor, arte: { tipo: 'lata', corpo: cor }, foto: null, video, capa }} largura={96} />
        ) : (
          <span className="pn-video-vazio" aria-hidden="true">
            <Ic nome="play" tamanho={24} />
          </span>
        )}
      </div>
      <div className="pn-foto-lado">
        <p className="pn-dica-bloco">
          {video ? 'No site, o card do produto, o story e a página tocam esse vídeo (sem som, em volta).' : 'Um vídeo curto do produto (girando, mostrando a embalagem) vira a thumb animada do card no site. De 3 a 6 segundos.'}
        </p>
        <div className="pn-foto-acoes">
          <label className="pn-botao pn-botao-cinza">
            <Ic nome="play" tamanho={16} />
            <span className="pn-botao-txt">{video ? 'Trocar vídeo' : 'Thumb animada'}</span>
            <input ref={entrada} id="p-video" name="video" type="file" accept="video/mp4,video/quicktime,video/webm,video/x-m4v,.mp4,.mov,.webm,.m4v,image/gif" className="sr-only" onChange={(e) => escolher(e.target.files?.[0])} />
          </label>
          {video && (
            <button type="button" className="pn-botao pn-botao-texto" onClick={() => aoMudar(null)}>
              <span className="pn-botao-txt">Tirar vídeo</span>
            </button>
          )}
        </div>
        {falha && <Aviso tipo="erro">{falha}</Aviso>}
      </div>
      {arquivo && (
        <Suspense fallback={null}>
          <EstudioVideo
            arquivo={arquivo}
            nome={nome}
            preco={preco}
            cor={cor}
            aoFechar={() => setArquivo(null)}
            aoUsar={async (v: VideoPronto, andou) => {
              // a capa primeiro (imagem pequena), depois o vídeo; a barra anda nos dois
              const c = await apiBase.enviarImagem(v.capa, v.nomeCapa, (f) => andou(f * 0.15))
              const r = await apiBase.enviarVideo(v.video, v.nomeVideo, (f) => andou(0.15 + f * 0.85))
              aoMudar({ video: r.video, capa: c.imagem })
              setArquivo(null)
            }}
          />
        </Suspense>
      )}
    </div>
  )
}
