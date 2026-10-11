// Como usar o painel: o guia rápido que a loja recebe na entrega, dentro do próprio painel. As tarefas mais comuns,
// cada uma em 2 a 4 passos e com o botão que leva à tela. Só aparecem as que o papel de quem tá logado faz.
import { Link, Topo } from '../Moldura'
import { pode, useUsuario } from '../permissoes'
import { caminho } from '../rotas'
import type { Usuario } from '../tipos'
import { Ic, TituloTela } from '../ui'
import { RodapePainel } from './Mais'
import { useTitulo } from './comum'

interface Tarefa {
  id: string
  titulo: string
  passos: string[]
  botao: string
  href: string
  /** Quem vê essa tarefa. */
  pode: (u: Usuario | null) => boolean
}

const dono = (u: Usuario | null) => pode('loja', u)

const TAREFAS: Tarefa[] = [
  {
    id: 'preco',
    titulo: 'Mudar o preço de um produto',
    passos: ['Toca em Produtos (na barra de baixo) e busca o produto.', 'Toca no produto, troca o preço e toca em Salvar.', 'Pronto: o site já mostra o preço novo.'],
    botao: 'Abrir Produtos',
    href: caminho.produtos,
    pode: dono,
  },
  {
    id: 'acabou',
    titulo: 'Marcar que acabou (esgotado)',
    passos: [
      'Em Produtos, toca no estado lá em cima (ex.: MG).',
      'Desliga o “À venda” do produto: ele sai do site só naquele estado.',
      'Contando o estoque (− e +), quando chega a 0 ele sai sozinho e volta quando tu põe mais.',
    ],
    botao: 'Abrir Produtos',
    href: caminho.produtos,
    pode: dono,
  },
  {
    id: 'acabou-estoque',
    titulo: 'Marcar que acabou (esgotado)',
    passos: ['Toca em Estoque (na barra de baixo).', 'Desliga o “À venda” do produto, ou usa o − e + do estoque: chegou a 0, sai do site sozinho.', 'Errou? Toca em “Desfazer” no recado que aparece embaixo.'],
    botao: 'Abrir Estoque',
    href: caminho.estoque,
    pode: (u) => pode('produtos', u) && !pode('loja', u),
  },
  {
    id: 'foto',
    titulo: 'Trocar a foto de um produto',
    passos: ['Em Produtos, abre o produto.', 'Toca em “Trocar foto” e escolhe da galeria (produto em fundo preto fica melhor no site).', 'Toca em Salvar.'],
    botao: 'Abrir Produtos',
    href: caminho.produtos,
    pode: dono,
  },
  {
    id: 'produto-novo',
    titulo: 'Cadastrar um produto novo',
    passos: ['Toca no + da barra e em “Novo produto”.', 'Põe a foto, o nome, a categoria e o preço.', 'Em “Onde tem”, liga os estados onde tem e toca em “Criar produto”.'],
    botao: 'Novo produto',
    href: caminho.produtoNovo,
    pode: dono,
  },
  {
    id: 'pedido',
    titulo: 'Confirmar um pedido',
    passos: ['Toca em Pedidos (a bolinha mostra quantos são novos).', 'Abre o pedido e toca em “Confirmar pedido”.', 'Toca em “Abrir no WhatsApp”: a mensagem pro cliente já vem escrita, é só mandar.'],
    botao: 'Abrir Pedidos',
    href: caminho.pedidos,
    pode: (u) => pode('pedidos', u),
  },
  {
    id: 'rateio',
    titulo: 'Criar um rateio e confirmar o pagamento',
    passos: [
      'Toca no + e em “Novo rateio”: escolhe o produto, o preço, as vagas e toca em “Publicar no site”.',
      'Quando o Pix cair, toca em “Confirmar pagamento” na pessoa (no Início ou no rateio).',
      'Toca em “Avisar no WhatsApp” pra mandar a confirmação pronta.',
    ],
    botao: 'Novo rateio',
    href: caminho.novo,
    pode: (u) => pode('rateios', u),
  },
  {
    id: 'pagamento',
    titulo: 'Confirmar o pagamento de um rateio',
    passos: ['No Início, em “Esperando pagamento”, toca em “Confirmar pagamento” quando o Pix cair.', 'Toca em “Avisar no WhatsApp” pra mandar a confirmação pronta.'],
    botao: 'Abrir Rateios',
    href: caminho.rateios,
    pode: (u) => pode('participantes', u) && !pode('rateios', u),
  },
  {
    id: 'horario',
    titulo: 'Mudar o horário e a taxa de entrega',
    passos: ['No Início, toca em “Horário e taxa” e escolhe o estado.', 'O horário de cada dia fica em cima; logo depois vem a taxa (ou “A confirmar”).', 'Toca em Salvar: o site já mostra.'],
    botao: 'Abrir Estados',
    href: caminho.estados,
    pode: dono,
  },
  {
    id: 'gratis',
    titulo: 'Pôr entrega grátis num dia',
    passos: ['Abre o estado (Início › Horário e taxa).', 'Liga “Tem dia com entrega grátis”, escolhe os dias e a frase do dia.', 'Toca em Salvar: nesse dia o site mostra a frase.'],
    botao: 'Abrir Estados',
    href: caminho.estados,
    pode: dono,
  },
  {
    id: 'stories',
    titulo: 'Trocar os produtos dos stories',
    passos: ['No Início, toca em Stories e escolhe o estado.', 'Toca em “Escolher produtos” e põe os que vão passar, na ordem.', 'Toca em Salvar. Sem nenhum escolhido, o story mostra os à venda sozinho.'],
    botao: 'Abrir Stories',
    href: caminho.stories,
    pode: dono,
  },
  {
    id: 'equipe',
    titulo: 'Dar acesso pra alguém da equipe',
    passos: [
      'Mais › Equipe › “Novo acesso”.',
      'Põe o nome, o papel (gerente ou atendente) e os estados, e toca em “Criar acesso”.',
      'Toca em “Copiar login e senha” e manda pra pessoa no privado. Esqueceu a senha? Abre a pessoa e toca em “Gerar senha provisória”.',
    ],
    botao: 'Abrir Equipe',
    href: caminho.equipe,
    pode: (u) => pode('equipe', u),
  },
  {
    id: 'copia',
    titulo: 'Fazer a cópia de segurança',
    passos: ['Mais › Conta › “Baixar cópia de segurança” (o Início lembra quando passa de 7 dias).', 'Guarda o arquivo fora do celular (no teu e-mail ou no Drive): tem nome e WhatsApp dos clientes.'],
    botao: 'Abrir Conta',
    href: caminho.conta,
    pode: (u) => pode('servidor', u),
  },
  {
    id: 'aviso',
    titulo: 'O aviso do WhatsApp não chegou',
    passos: [
      'O Início avisa quando um aviso no grupo não foi: toca nele.',
      'Lê o porquê e faz o que ele diz (às vezes é só ligar de novo o WhatsApp do número que avisa).',
      'Toca em “Mandar de novo”. Os pedidos continuam no painel e no WhatsApp da loja mesmo sem o aviso.',
    ],
    botao: 'Abrir Avisos',
    href: caminho.avisos,
    pode: (u) => pode('avisos', u),
  },
]

export function Ajuda() {
  useTitulo('Como usar o painel')
  const usuario = useUsuario()
  const tarefas = TAREFAS.filter((t) => t.pode(usuario))
  return (
    <>
      <Topo voltar={caminho.mais} titulo={<TituloTela>Como usar o painel</TituloTela>} />
      <div className="pn-pagina pn-pagina-estreita pn-ajuda">
        <p className="pn-dica-bloco">O que mais se faz no dia a dia, passo a passo. Toca na tarefa pra ver os passos; o botão leva direto pra tela.</p>
        <ul className="pn-ajuda-lista">
          {tarefas.map((t) => (
            <li key={t.id}>
              <details className="pn-ajuda-item" id={`ajuda-${t.id}`}>
                <summary>
                  <span>{t.titulo}</span>
                  <Ic nome="chevron-baixo" tamanho={16} />
                </summary>
                <ol>
                  {t.passos.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ol>
                <Link href={t.href} className="pn-botao pn-botao-cinza pn-botao-p">
                  <span className="pn-botao-txt">{t.botao}</span>
                  <Ic nome="chevron-dir" tamanho={16} />
                </Link>
              </details>
            </li>
          ))}
        </ul>
        <section className="pn-bloco" aria-labelledby="h-ajuda-senha">
          <h2 id="h-ajuda-senha" className="pn-h2">
            Se esquecer a senha
          </h2>
          <p className="pn-dica-bloco">
            {pode('equipe', usuario)
              ? 'Na tela de entrar, toca em “Esqueci a senha”. Com outro dono cadastrado, ele gera uma senha provisória pra ti em Equipe; com os Avisos no WhatsApp ligados, dá pra mandar um código pro WhatsApp da loja. Em Conta tu vê como tá o teu.'
              : 'Pede pro dono da loja: em Equipe, ele gera uma senha provisória pra ti.'}
          </p>
        </section>
        <RodapePainel />
      </div>
    </>
  )
}
