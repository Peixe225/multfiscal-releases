// Peças das telas de Equipe e Clientes: os papéis (com o que cada um pode), os estados, o selo do acesso e a senha
// provisória (que aparece uma vez só).
import type { Papel } from '../tipos'
import { BotaoCopiar } from '../pedidos/comum'
import { Ic } from '../ui'
import type { UsuarioAdmin } from './tipos'

export const PAPEIS: { id: Papel; nome: string; pode: string }[] = [
  { id: 'atendente', nome: 'Atendente', pode: 'Pedidos e participantes dos rateios, só dos estados dele. Não mexe nos rateios nem apaga dados.' },
  { id: 'gerente', nome: 'Gerente', pode: 'Pedidos, rateios, participantes e (quando tiver no painel) produtos e estoque, só dos estados dele.' },
  { id: 'dono', nome: 'Dono', pode: 'Tudo: equipe, clientes, avisos no WhatsApp, textos e ajustes da loja, em todos os estados.' },
]

/** Os estados que a loja atende (os mesmos do Criar rateio). */
export const UFS_LOJA: { uf: string; nome: string }[] = [
  { uf: 'rj', nome: 'Rio de Janeiro' },
  { uf: 'mg', nome: 'Minas Gerais' },
  { uf: 'sp', nome: 'São Paulo' },
  { uf: 'es', nome: 'Espírito Santo' },
  { uf: 'sc', nome: 'Santa Catarina' },
]

/** Estados como chips (RJ MG SP ES SC), na ordem do Criar rateio. */
export function EscolherUfs({ valor, aoMudar, rotuloId, erroId }: { valor: string[]; aoMudar: (ufs: string[]) => void; rotuloId: string; erroId?: string }) {
  return (
    <div className="pn-chips" role="group" aria-labelledby={rotuloId} aria-describedby={erroId}>
      {UFS_LOJA.map((u) => {
        const on = valor.includes(u.uf)
        return (
          <button
            key={u.uf}
            id={`ct-uf-${u.uf}`}
            type="button"
            className={`pn-chip-uf px${on ? ' on' : ''}`}
            aria-pressed={on}
            aria-label={u.nome}
            onClick={() => aoMudar(on ? valor.filter((x) => x !== u.uf) : UFS_LOJA.map((x) => x.uf).filter((x) => x === u.uf || valor.includes(x)))}
          >
            {on && <Ic nome="check" tamanho={16} />}
            {u.uf.toUpperCase()}
          </button>
        )
      })}
    </div>
  )
}

/** "Gerente · MG, RJ" · "Dono" */
export function SeloPapel({ u }: { u: Pick<UsuarioAdmin, 'papel' | 'ufs'> }) {
  const nome = PAPEIS.find((p) => p.id === u.papel)?.nome ?? u.papel
  return (
    <span className={`ct-papel ct-papel-${u.papel}`}>
      {nome}
      {u.papel !== 'dono' && u.ufs.length > 0 && <span className="ct-papel-ufs"> · {u.ufs.map((x) => x.toUpperCase()).join(', ')}</span>}
    </span>
  )
}

/** A senha provisória (aparece uma vez só): grande, com copiar, e o que fazer com ela. */
export function SenhaProvisoria({ login, senha }: { login: string; senha: string }) {
  const endereco = `${location.origin}${location.pathname}`
  return (
    <div className="ct-senha">
      <dl className="ct-senha-dados">
        <div>
          <dt>Login</dt>
          <dd className="pn-codigo">{login}</dd>
        </div>
        <div>
          <dt>Senha provisória</dt>
          <dd className="pn-codigo ct-senha-valor">{senha}</dd>
        </div>
      </dl>
      <BotaoCopiar texto={`Painel da Green Cheese: ${endereco}\nLogin: ${login}\nSenha provisória: ${senha}\nNo primeiro acesso o painel pede uma senha nova.`} rotulo="Copiar login e senha" variante="contorno" />
      <p className="pn-dica-bloco">
        Passa pra pessoa por mensagem direta (não em grupo). Ela entra com essa senha e o painel pede uma nova na hora. Essa senha não aparece de novo: se perder, gera outra.
      </p>
    </div>
  )
}
