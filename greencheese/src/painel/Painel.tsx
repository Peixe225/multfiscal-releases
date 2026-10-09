// O painel do dono: pergunta a sessão ao servidor e abre a tela certa (primeiro acesso, entrar ou o painel).
// Dentro, a sessão que cai no meio do trabalho abre o login por cima, sem tirar a tela do lugar.
import { useCallback, useEffect, useState } from 'react'
import { Logo } from '../arte/Logo'
import { vigiarTeclado } from '../lib/ambiente'
import * as api from './api'
import { limparCache } from './dados'
import { Moldura } from './Moldura'
import { ir, useRota, type Rota } from './rotas'
import { Entrar, FolhaSessao, Instalar } from './telas/Acesso'
// pedidos, avisos no WhatsApp e textos do pedido guiado
import { Avisos } from './pedidos/Avisos'
import { Pedido } from './pedidos/Pedido'
import { Pedidos } from './pedidos/Pedidos'
import { Textos } from './pedidos/Textos'
// equipe e clientes (as contas)
import { Cliente } from './contas/Cliente'
import { Clientes } from './contas/Clientes'
import { Equipe } from './contas/Equipe'
import { TrocarSenhaObrigatoria } from './contas/TrocarSenha'
import { Usuario as TelaUsuario } from './contas/Usuario'
import { definirUsuario, pode } from './permissoes'
import { caminho } from './rotas'
import { secaoDaTela } from './secoes'
import { Atividade } from './telas/Atividade'
import { Conta } from './telas/Conta'
import { EditarRateio } from './telas/EditarRateio'
import { Rateio } from './telas/Rateio'
import { Rateios } from './telas/Rateios'
import { Resumo } from './telas/Resumo'
import { Servidor } from './telas/Servidor'
import type { Usuario } from './tipos'
import { Botao, Ic, Pontinhos } from './ui'
import { Link, Topo } from './Moldura'

type Fase = 'carregando' | 'erro' | 'instalar' | 'entrar' | 'dentro'

/** Tela que o papel de quem está logado não abre (link guardado, papel mudado): diz e leva pro Resumo. */
function SemAcesso() {
  return (
    <>
      <Topo titulo={<h1 className="pn-h1 px">Sem acesso</h1>} />
      <div className="pn-pagina pn-pagina-estreita ct-sem-acesso">
        <p className="pn-vazio">
          <Ic nome="cadeado" tamanho={16} /> Teu acesso não abre essa parte do painel. Se precisar, fala com o dono da loja.
        </p>
        <Link href={caminho.resumo} className="pn-botao pn-botao-cinza">
          <span className="pn-botao-txt">Ir pro Resumo</span>
        </Link>
      </div>
    </>
  )
}

function Tela({ rota, usuario, sair }: { rota: Rota; usuario: Usuario; sair: () => Promise<void> }) {
  // o servidor recusa de qualquer jeito (403 sem-permissao); aqui a tela nem abre
  const secao = secaoDaTela(rota.tela)
  if (secao && !pode(secao.permissao, usuario)) return <SemAcesso />
  // editar fica na seção dos rateios (que o atendente vê), mas pede a permissão de mexer
  if (rota.tela === 'editar' && !pode('rateios', usuario)) return <SemAcesso />
  switch (rota.tela) {
    // equipe e clientes
    case 'equipe':
      return <Equipe />
    case 'usuario':
      return <TelaUsuario key={rota.login} login={rota.login} />
    case 'clientes':
      return <Clientes promo={rota.promo} />
    case 'cliente':
      return <Cliente key={rota.id} id={rota.id} />
    // pedidos, avisos no WhatsApp e textos do pedido guiado
    case 'pedidos':
      return <Pedidos status={rota.status} uf={rota.uf} />
    case 'pedido':
      return <Pedido key={rota.id} id={rota.id} />
    case 'avisos':
      return <Avisos />
    case 'textos':
      return <Textos />
    case 'rateios':
      return <Rateios />
    case 'novo':
      return <EditarRateio key="novo" id={null} produtoInicial={rota.produto} />
    case 'rateio':
      return <Rateio key={rota.id} id={rota.id} />
    case 'editar':
      return <EditarRateio key={`editar-${rota.id}`} id={rota.id} />
    case 'atividade':
      return <Atividade quem={rota.quem} />
    case 'conta':
      return <Conta usuario={usuario} aoSair={sair} />
    case 'servidor':
      return <Servidor />
    default:
      return <Resumo nome={usuario.nome} />
  }
}

export function Painel() {
  const [fase, setFase] = useState<Fase>('carregando')
  const [erro, setErro] = useState<string | null>(null)
  const [usuario, setUsuario] = useState<Usuario | null>(null)
  const [caiu, setCaiu] = useState(false)
  const rota = useRota()

  const iniciar = useCallback(async () => {
    setFase('carregando')
    setErro(null)
    try {
      const s = await api.sessao()
      if (!s.instalado) setFase('instalar')
      else if (!s.usuario || !s.csrf) setFase('entrar')
      else {
        api.guardarCsrf(s.csrf)
        definirUsuario(s.usuario)
        setUsuario(s.usuario)
        setFase('dentro')
      }
    } catch (e) {
      setErro(api.mensagemDe(e))
      setFase('erro')
    }
  }, [])

  useEffect(() => {
    void iniciar()
  }, [iniciar])
  useEffect(() => api.assinarSessao(setCaiu), [])
  // o dono pode mudar o papel ou os estados de quem está logado: ao voltar pro painel, confere de novo
  useEffect(() => {
    if (fase !== 'dentro') return
    const conferir = () => {
      if (document.visibilityState !== 'visible') return
      void api
        .sessao()
        .then((s) => {
          if (s.usuario) {
            definirUsuario(s.usuario)
            setUsuario(s.usuario)
          }
        })
        .catch(() => {})
    }
    document.addEventListener('visibilitychange', conferir)
    return () => document.removeEventListener('visibilitychange', conferir)
  }, [fase])
  useEffect(() => vigiarTeclado(), [])
  // telas de criar e editar escondem a barra de baixo (como o "Novo post" do Instagram)
  useEffect(() => {
    document.documentElement.classList.toggle('pn-compondo', rota.tela === 'novo' || rota.tela === 'editar')
  }, [rota.tela])

  const entrou = (u: Usuario, csrf: string) => {
    api.guardarCsrf(csrf)
    definirUsuario(u)
    setUsuario(u)
    setFase('dentro')
  }

  const sair = useCallback(async () => {
    try {
      await api.sair()
    } catch {
      /* sem rede ou sessão já caída: sai igual deste aparelho */
    }
    api.guardarCsrf(null)
    api.largouASessao()
    limparCache()
    setCaiu(false)
    definirUsuario(null)
    setUsuario(null)
    setFase('entrar')
    ir('#/', true)
  }, [])

  if (fase === 'carregando') {
    return (
      <div className="pn-abrindo">
        <Logo tamanho={72} />
        <Pontinhos rotulo="Abrindo o painel…" />
      </div>
    )
  }
  if (fase === 'erro') {
    return (
      <main className="pn-acesso">
        <div className="pn-acesso-cabeca">
          <Logo tamanho={72} />
          <h1 className="pn-h1 px">Sem conexão</h1>
          <p className="pn-acesso-txt" role="alert">
            {erro}
          </p>
        </div>
        <Botao largo onClick={() => void iniciar()}>
          Tentar de novo
        </Botao>
      </main>
    )
  }
  if (fase === 'instalar') return <Instalar aoEntrar={entrou} jaInstalado={() => setFase('entrar')} />
  if (fase === 'entrar' || !usuario) return <Entrar aoEntrar={entrou} />
  // senha provisória (o dono criou o acesso ou gerou uma nova): só entra depois de escolher a dela
  if (usuario.trocarSenha)
    return (
      <TrocarSenhaObrigatoria
        usuario={usuario}
        aoTrocar={(u) => {
          definirUsuario(u)
          setUsuario(u)
          ir('#/', true)
        }}
        aoSair={() => void sair()}
      />
    )

  return (
    <>
      <Moldura rota={rota}>
        <Tela rota={rota} usuario={usuario} sair={sair} />
      </Moldura>
      <FolhaSessao
        aberta={caiu}
        login={usuario.login}
        aoEntrar={(u, csrf) => {
          definirUsuario(u)
          setUsuario(u)
          api.voltouASessao(csrf)
        }}
        aoSair={() => void sair()}
      />
    </>
  )
}
