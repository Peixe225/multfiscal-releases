// "Mais": tudo que não está na barra de baixo, agrupado (o dia a dia, as partes da loja, as configurações que se fazem
// uma vez, o guia e a conta), com o nome de quem tá logado em cima e o rodapé da loja embaixo.
import { Logo } from '../../arte/Logo'
import { Link, Topo } from '../Moldura'
import { descreverAcesso, useUsuario } from '../permissoes'
import { caminho } from '../rotas'
import { maisDo } from '../secoes'
import { Ic, TituloTela } from '../ui'
import { useTitulo } from './comum'

/** O rodapé discreto do Mais e da Conta. */
export function RodapePainel() {
  return <p className="pn-rodape-painel">© 2026 Green Cheese Imports · painel por I&amp;H Soluções Digitais</p>
}

export function Mais() {
  useTitulo('Mais')
  const usuario = useUsuario()
  const grupos = maisDo(usuario)
  return (
    <>
      <Topo titulo={<TituloTela>Mais</TituloTela>} />
      <div className="pn-pagina pn-pagina-estreita pn-tela-mais">
        {usuario && (
          <Link href={caminho.conta} className="pn-mais-quem toque">
            <span className="pn-avatar pn-avatar-aceso" style={{ width: 48, height: 48 }}>
              <Logo tamanho={42} />
            </span>
            <span className="pn-mais-quem-txt">
              <strong>{usuario.nome}</strong>
              <small>
                @{usuario.login} · {descreverAcesso(usuario)}
              </small>
              <small>Tua senha, a cópia de segurança e sair</small>
            </span>
            <Ic nome="chevron-dir" tamanho={16} />
          </Link>
        )}
        {grupos.map((g) => (
          <section key={g.grupo} className="pn-bloco pn-mais-grupo" aria-labelledby={`h-mais-${g.grupo}`}>
            <h2 id={`h-mais-${g.grupo}`} className="pn-h2">
              {g.titulo}
            </h2>
            {g.grupo === 'config' && <p className="pn-dica-bloco">O que se ajusta uma vez (ou quase nunca).</p>}
            <ul className="pn-menu">
              {g.secoes.map((s) => (
                <li key={s.id}>
                  <Link href={s.href} className="pn-menu-item pn-mais-item toque">
                    <Ic nome={s.icone} tamanho={24} />
                    <span className="pn-porta-txt">
                      <strong>{s.nome}</strong>
                      {s.sub && <small>{s.sub}</small>}
                    </span>
                    <Ic nome="chevron-dir" tamanho={16} />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <RodapePainel />
      </div>
    </>
  )
}
