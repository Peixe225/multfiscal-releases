import { canais, canalDa } from '../dados/canais'
import { config } from '../dados/config'
import { ehDiaDeEntregaGratis, situacao } from '../lib/horario'
import { irParaAba } from '../lib/abas'
import { linkPerfil } from '../lib/mensagem'
import { useCatalogo } from '../store/catalogo'
import { useChat } from '../store/chat'
import { useDisponiveis } from '../store/derivados'
import { nomeCidade, useLocal } from '../store/local'
import { Avatar, Demo } from './comum'
import { useUI } from '../store/ui'
import './Perfil.css'

/** Cabeçalho de perfil do Instagram do estado atual — com contagens tiradas do catálogo, nunca seguidores inventados. */
export function Perfil({ variante = 'celular' }: { variante?: 'celular' | 'desktop' }) {
  const { uf, cidade, cidadeInformada } = useLocal()
  const canal = canalDa(uf)
  const total = useCatalogo((s) => s.produtos.length)
  const disp = useDisponiveis().length
  const abrirChat = useChat((s) => s.abrir)
  const setSeletor = useUI((s) => s.setSeletor)
  const cid = nomeCidade(canal, cidade, cidadeInformada)
  const sit = canal ? situacao(canal) : null
  const sextou = canal && ehDiaDeEntregaGratis(canal) ? canal.entregaGratis : null
  const titulo = canal ? `Green Cheese Imports — ${cid ?? canal.nome}` : 'Green Cheese Imports'

  return (
    <section className={`perfil perfil-${variante}`} aria-label="Perfil da Green Cheese no seu estado">
      <div className="perfil-topo">
        <Avatar tamanho={variante === 'desktop' ? 150 : 86} />
        <dl className="perfil-numeros">
          <div>
            <dt className="sr-only">Produtos</dt>
            <dd>
              <strong>{total}</strong> produtos
            </dd>
          </div>
          {canal ? (
            <div>
              <dt className="sr-only">Disponíveis aqui</dt>
              <dd>
                <strong>{disp}</strong> disponíveis<span className="perfil-aqui"> aqui</span>
              </dd>
            </div>
          ) : (
            <div>
              <dt className="sr-only">Perfis</dt>
              <dd>
                <strong>{canais.length + 1}</strong> perfis
              </dd>
            </div>
          )}
          <div>
            <dt className="sr-only">Estados</dt>
            <dd>
              <strong>{canais.length}</strong> estados
            </dd>
          </div>
        </dl>
      </div>
      <h1 className="sr-only" tabIndex={-1}>
        {titulo}
      </h1>
      <p className="perfil-nome">{canal ? (canal.nomePerfil ?? canal.instagram) : 'Green Cheese Imports'}</p>
      <p className="perfil-arroba legenda">{canal ? `@${canal.instagram}` : 'RJ · MG · SP · ES · SC'}</p>
      {canal && <p className="perfil-categoria legenda">Delivery · {canal.cidades.length ? canal.cidades.map((c) => c.nome).join(' · ') : canal.nome}</p>}
      <div className="perfil-bio">
        <p>Importados, destilados, sedas, piteiras e acessórios.</p>
        <p>Quem tiver interesse é só mandar dm</p>
        {sextou && <p className="perfil-sextou">{sextou.texto}</p>}
        {/* horário de exemplo sem carimbo não aparece: ninguém lê "fechado" num horário que a loja não passou */}
        {sit && (config.carimboDeExemplo || !canal?.horario.demo) && (
          <p className="perfil-horario">
            <span className={`perfil-luz ${sit.aberto ? 'on' : ''}`} aria-hidden="true" />
            {sit.texto} <Demo ativo={!!canal?.horario.demo} />
          </p>
        )}
      </div>
      <div className="perfil-botoes">
        <button type="button" className="botao botao-cinza perfil-botao toque" onClick={() => abrirChat('pedido')}>
          Enviar mensagem
        </button>
        {canal ? (
          <a className="botao botao-cinza perfil-botao toque" href={linkPerfil(canal.instagram)} target="_blank" rel="noopener noreferrer">
            Ver no Instagram
          </a>
        ) : (
          <button type="button" className="botao botao-cinza perfil-botao toque" onClick={() => setSeletor(true)}>
            Escolher estado
          </button>
        )}
      </div>
      {/* a home termina no story: o próprio perfil leva à loja (o "Ver loja" do Instagram Shopping) */}
      <button type="button" className="botao botao-cinza perfil-botao perfil-loja toque" onClick={() => irParaAba('catalogo')}>
        Ver loja
      </button>
    </section>
  )
}
