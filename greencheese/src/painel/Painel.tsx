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
import { Atividade } from './telas/Atividade'
import { Conta } from './telas/Conta'
import { EditarRateio } from './telas/EditarRateio'
import { Rateio } from './telas/Rateio'
import { Rateios } from './telas/Rateios'
import { Resumo } from './telas/Resumo'
import { Servidor } from './telas/Servidor'
// loja
import { Categorias } from './loja/Categorias'
import { Estado } from './loja/Estado'
import { Estados } from './loja/Estados'
import { Loja } from './loja/Loja'
import { Premio } from './loja/Premio'
import { Produto } from './loja/Produto'
import { Produtos } from './loja/Produtos'
import { Sorte } from './loja/Sorte'
import { Stories } from './loja/Stories'
import type { Usuario } from './tipos'
import { Botao, Pontinhos } from './ui'

type Fase = 'carregando' | 'erro' | 'instalar' | 'entrar' | 'dentro'

function Tela({ rota, usuario, sair }: { rota: Rota; usuario: Usuario; sair: () => Promise<void> }) {
  switch (rota.tela) {
    case 'rateios':
      return <Rateios />
    case 'novo':
      return <EditarRateio key="novo" id={null} produtoInicial={rota.produto} />
    case 'rateio':
      return <Rateio key={rota.id} id={rota.id} />
    case 'editar':
      return <EditarRateio key={`editar-${rota.id}`} id={rota.id} />
    case 'atividade':
      return <Atividade />
    case 'conta':
      return <Conta usuario={usuario} aoSair={sair} />
    case 'servidor':
      return <Servidor />
    case 'produtos':
      return <Produtos ver={rota.ver} />
    case 'produto':
      return <Produto key={rota.id} id={rota.id} />
    case 'produto-novo':
      return <Produto key="novo" id={null} />
    case 'loja':
      return <Loja />
    case 'estados':
      return <Estados />
    case 'estado':
      return <Estado key={rota.uf} uf={rota.uf} />
    case 'stories':
      return <Stories uf={rota.uf} />
    case 'categorias':
      return <Categorias />
    case 'sorte':
      return <Sorte />
    case 'premio':
      return <Premio key={rota.id ?? 'novo'} id={rota.id} />
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
  useEffect(() => vigiarTeclado(), [])
  // telas de criar e editar escondem a barra de baixo (como o "Novo post" do Instagram)
  useEffect(() => {
    document.documentElement.classList.toggle('pn-compondo', ['novo', 'editar', 'produto', 'produto-novo', 'estado', 'premio'].includes(rota.tela))
  }, [rota.tela])

  const entrou = (u: Usuario, csrf: string) => {
    api.guardarCsrf(csrf)
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

  return (
    <>
      <Moldura rota={rota}>
        <Tela rota={rota} usuario={usuario} sair={sair} />
      </Moldura>
      <FolhaSessao
        aberta={caiu}
        login={usuario.login}
        aoEntrar={(u, csrf) => {
          setUsuario(u)
          api.voltouASessao(csrf)
        }}
        aoSair={() => void sair()}
      />
    </>
  )
}
