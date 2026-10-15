// Um estado (o canal de atendimento): aparece no site, Instagram, nome do perfil e do destaque, WhatsApp próprio ou
// o da loja, cidades, horário da semana (com madrugada e "repetir nos outros dias"), taxa ou "a confirmar", entrega
// grátis por dia da semana e formas de pagamento. Estado que a loja ainda não tem: o mesmo formulário ativa ele.
// Na edição, só vai o que mudou: o que ninguém mexeu continua como estava (e o que era exemplo continua exemplo).
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import * as apiBase from '../api'
import { ErroApi } from '../api'
import { reaisNoCampo, whatsappBonito } from '../formato'
import { Link, Topo } from '../Moldura'
import { caminho, ir, voltar } from '../rotas'
import { avisarNaProxima } from '../telas/flash'
import { useTitulo } from '../telas/comum'
import { Aviso, Botao, Campo, Carregando, Ic, TituloTela } from '../ui'
import * as api from './api'
import { comEstado, guardarLoja, useLoja } from './dados'
import { DIAS, DIAS_CURTOS, nomeUf, NOMES_UF, PAGAMENTOS } from './nomes'
import type { EstadoAdmin, EstadoCorpo, FormaPagamento, Turno } from './tipos'
import { horaValida, lerInstagram, lerPreco, lerWhatsapp, mascaraHora, normalizarHora, problemaNoTexto, tamanho } from './validar'

interface Dia {
  aberto: boolean
  abre: string
  fecha: string
}

interface Form {
  ativo: boolean
  instagram: string
  nomePerfil: string
  destaque: string
  whatsModo: 'loja' | 'proprio'
  whatsapp: string
  cidades: string[]
  semana: Dia[]
  taxaModo: 'confirmar' | 'valor'
  taxa: string
  gratis: boolean
  gratisDias: number[]
  gratisTexto: string
  pagamentos: FormaPagamento[]
}

type Erros = Partial<Record<string, string>>

const DIA_PADRAO: Dia = { aberto: false, abre: '14:00', fecha: '23:00' }

function doEstado(e: EstadoAdmin): Form {
  return {
    ativo: e.ativo,
    instagram: e.instagram,
    nomePerfil: e.nomePerfil ?? '',
    destaque: e.destaque,
    whatsModo: e.whatsapp ? 'proprio' : 'loja',
    whatsapp: e.whatsapp ? whatsappBonito(e.whatsapp) : '',
    cidades: e.cidades.map((c) => c.nome),
    semana: e.horario.semana.map((t) => (t ? { aberto: true, abre: t[0], fecha: t[1] } : { ...DIA_PADRAO })),
    taxaModo: e.taxaEntrega.valor == null ? 'confirmar' : 'valor',
    taxa: reaisNoCampo(e.taxaEntrega.valor),
    gratis: !!e.entregaGratis,
    gratisDias: e.entregaGratis?.dias ?? [],
    gratisTexto: e.entregaGratis?.texto ?? 'Sextou com entrega grátis!',
    pagamentos: e.pagamento.opcoes,
  }
}

function novo(uf: string): Form {
  return {
    ativo: true,
    instagram: '',
    nomePerfil: '',
    destaque: `DELIVERY ${uf.toUpperCase()}`,
    whatsModo: 'loja',
    whatsapp: '',
    cidades: [],
    semana: Array.from({ length: 7 }, () => ({ ...DIA_PADRAO })),
    taxaModo: 'confirmar',
    taxa: '',
    gratis: false,
    gratisDias: [],
    gratisTexto: 'Sextou com entrega grátis!',
    pagamentos: ['pix', 'dinheiro', 'cartao'],
  }
}

const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

function validar(f: Form): Erros {
  const e: Erros = {}
  if (!lerInstagram(f.instagram)) e.instagram = 'Põe o @ do Instagram do estado (letras, números, ponto e _).'
  const perfil = f.nomePerfil.trim()
  if (perfil && (tamanho(perfil) < 2 || tamanho(perfil) > 40)) e.nomePerfil = 'Nome do perfil de 2 a 40 letras (ou vazio: aparece só o @).'
  else if (problemaNoTexto(perfil, 'loja')) e.nomePerfil = problemaNoTexto(perfil, 'loja') ?? undefined
  const d = f.destaque.trim()
  if (tamanho(d) < 2 || tamanho(d) > 20) e.destaque = 'Nome do destaque de 2 a 20 letras (ex.: DELIVERY RJ).'
  else if (problemaNoTexto(d, 'loja')) e.destaque = problemaNoTexto(d, 'loja') ?? undefined
  if (f.whatsModo === 'proprio' && !lerWhatsapp(f.whatsapp)) e.whatsapp = 'Esse WhatsApp não fecha. Põe DDD + 9 dígitos (ou usa o da loja).'
  f.semana.forEach((x, i) => {
    if (!x.aberto) return
    if (!horaValida(x.abre) || !horaValida(x.fecha)) e[`dia-${i}`] = `Horário de ${DIAS[i].toLowerCase()} em HH:MM (ex.: 14:00).`
    else if (x.abre === x.fecha) e[`dia-${i}`] = `Em ${DIAS[i].toLowerCase()}, abre e fecha no mesmo horário.`
  })
  if (f.taxaModo === 'valor' && (f.taxa.trim() === '' || lerPreco(f.taxa) == null)) e.taxa = 'Taxa de R$ 0,00 a R$ 100.000,00, ou “A confirmar”.'
  if (f.gratis) {
    if (!f.gratisDias.length) e.gratisDias = 'Escolhe em que dia a entrega é grátis.'
    const t = f.gratisTexto.trim()
    if (tamanho(t) < 2 || tamanho(t) > 40) e.gratisTexto = 'Frase de 2 a 40 letras (ex.: Sextou com entrega grátis!).'
    else if (problemaNoTexto(t)) e.gratisTexto = problemaNoTexto(t) ?? undefined
  }
  if (!f.pagamentos.length) e.pagamentos = 'Escolhe pelo menos uma forma de pagamento.'
  for (const k of Object.keys(e)) if (!e[k]) delete e[k]
  return e
}

/**
 * O nome do destaque cabe inteiro embaixo da bolinha no celular? A fonte e a largura do site (11 px; a bolinha do estado
 * deixa uns 76 px no celular de 344 px). Sem como medir, diz que cabe.
 */
function cabeNaBolinha(texto: string): boolean {
  try {
    const c = document.createElement('canvas').getContext('2d')
    if (!c) return true
    c.font = "400 11px system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    return c.measureText(texto.trim()).width <= 76
  } catch {
    return true
  }
}

function horario(f: Form): Turno[] {
  return f.semana.map((x) => (x.aberto ? [x.abre, x.fecha] : null))
}

/** Só o que mudou (estado novo: tudo). */
function corpo(f: Form, uf: string, antes: Form | null): EstadoCorpo {
  const c: EstadoCorpo = { uf }
  const mudou = (k: keyof Form) => !antes || JSON.stringify(f[k]) !== JSON.stringify(antes[k])
  if (mudou('ativo')) c.ativo = f.ativo
  if (mudou('instagram')) c.instagram = lerInstagram(f.instagram) ?? f.instagram
  if (mudou('nomePerfil')) c.nomePerfil = f.nomePerfil.trim() || null
  if (mudou('destaque')) c.destaque = f.destaque.trim()
  if (mudou('whatsModo') || mudou('whatsapp')) c.whatsapp = f.whatsModo === 'proprio' ? lerWhatsapp(f.whatsapp) : null
  if (mudou('cidades')) c.cidades = f.cidades.map((nome) => ({ nome }))
  // estado novo sem nenhum dia aberto: o horário fica "a confirmar" (o servidor marca como exemplo e o site não mostra)
  if (mudou('semana') && (antes || f.semana.some((x) => x.aberto))) c.horario = horario(f)
  if (mudou('taxaModo') || mudou('taxa')) c.taxa = f.taxaModo === 'valor' ? (lerPreco(f.taxa) ?? null) : null
  if (mudou('gratis') || mudou('gratisDias') || mudou('gratisTexto')) c.entregaGratis = f.gratis ? { dias: [...f.gratisDias].sort(), texto: f.gratisTexto.trim() } : null
  if (mudou('pagamentos')) c.pagamentos = f.pagamentos
  return c
}

/** "fecha às 3h da madrugada de sábado" quando fecha depois da meia-noite. */
function madrugada(x: Dia, i: number): string | null {
  if (!x.aberto || !horaValida(x.abre) || !horaValida(x.fecha) || x.fecha >= x.abre) return null
  const [h, m] = x.fecha.split(':').map(Number)
  return `Fecha ${h === 0 && m === 0 ? 'à meia-noite' : `às ${h}h${m ? String(m).padStart(2, '0') : ''} da madrugada`} de ${DIAS[(i + 1) % 7].toLowerCase()}.`
}

/** Hora em texto com máscara (o campo de hora do navegador vira "02:00 PM" em aparelho em inglês). */
function Hora({ id, valor, rotulo, aoMudar }: { id?: string; valor: string; rotulo: string; aoMudar: (v: string) => void }) {
  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      maxLength={5}
      placeholder="00:00"
      className="pn-input pn-hora"
      aria-label={rotulo}
      value={valor}
      onChange={(e) => aoMudar(mascaraHora(e.target.value))}
      onBlur={(e) => {
        const n = normalizarHora(e.target.value)
        if (n !== e.target.value) aoMudar(n)
      }}
    />
  )
}

function Secao({ titulo, id, children, dica }: { titulo: string; id: string; children: ReactNode; dica?: ReactNode }) {
  return (
    <section className="pn-form-secao" aria-labelledby={id}>
      <h2 id={id} className="pn-h2">
        {titulo}
      </h2>
      {dica && <p className="pn-dica-bloco">{dica}</p>}
      {children}
    </section>
  )
}

function Cidades({ cidades, aoMudar, erro }: { cidades: string[]; aoMudar: (c: string[]) => void; erro?: string }) {
  const [nova, setNova] = useState('')
  const [falha, setFalha] = useState<string | null>(null)
  const campo = useRef<HTMLInputElement>(null)
  const adicionar = () => {
    const n = nova.trim().replace(/\s+/g, ' ')
    if (!n) {
      setFalha('Escreve o nome da cidade.')
      campo.current?.focus()
      return
    }
    if (tamanho(n) < 2 || tamanho(n) > 60) {
      setFalha('Nome da cidade de 2 a 60 letras.')
      return
    }
    const problema = problemaNoTexto(n, 'loja')
    if (problema) {
      setFalha(problema)
      return
    }
    if (cidades.some((c) => slug(c) === slug(n))) {
      setFalha(`“${n}” já tá na lista.`)
      return
    }
    if (cidades.length >= 30) {
      setFalha('Até 30 cidades.')
      return
    }
    aoMudar([...cidades, n])
    setNova('')
    setFalha(null)
    campo.current?.focus()
  }
  return (
    <div className="pn-cidades">
      {cidades.length > 0 ? (
        <ul className="pn-escolhidos" aria-label="Cidades atendidas">
          {cidades.map((c) => (
            <li key={slug(c)} className="pn-escolhido">
              <Ic nome="pin" tamanho={16} />
              <span>{c}</span>
              <button type="button" className="icone-botao" aria-label={`Tirar ${c}`} onClick={() => aoMudar(cidades.filter((x) => x !== c))}>
                <Ic nome="fechar" tamanho={16} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="pn-dica-bloco">Nenhuma ainda: o pedido pergunta a cidade pro cliente.</p>
      )}
      <div className={`pn-cidade-nova${falha || erro ? ' pn-campo-erro' : ''}`}>
        <label className="sr-only" htmlFor="e-cidade-nova">
          Cidade nova
        </label>
        <input
          ref={campo}
          id="e-cidade-nova"
          className="pn-input"
          placeholder="Ex.: Niterói"
          autoComplete="off"
          maxLength={60}
          value={nova}
          aria-describedby={falha || erro ? 'e-cidade-erro' : undefined}
          onChange={(e) => {
            setNova(e.target.value)
            setFalha(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              adicionar()
            }
          }}
        />
        <Botao variante="cinza" icone="mais" onClick={adicionar}>
          Adicionar
        </Botao>
      </div>
      {(falha || erro) && (
        <p id="e-cidade-erro" className="pn-erro">
          <Ic nome="atencao" tamanho={16} />
          <span>{falha ?? erro}</span>
        </p>
      )}
    </div>
  )
}

export function Estado({ uf }: { uf: string }) {
  const leitura = useLoja(0)
  const l = leitura.dados
  const e = l?.estados.find((x) => x.uf === uf) ?? null
  const nome = NOMES_UF[uf] ? nomeUf(uf) : null
  useTitulo(nome ?? 'Estado')
  const [f, setF] = useState<Form | null>(null)
  const antes = useRef<Form | null>(null)
  const [erros, setErros] = useState<Erros>({})
  const [geral, setGeral] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const trava = useRef(false)

  useEffect(() => {
    if (f || !l) return
    const limpo = e ? doEstado(e) : novo(uf)
    antes.current = e ? limpo : null
    setF(limpo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [l, e])

  const mudar = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF((s) => (s ? { ...s, [k]: v } : s))
    if (erros[k as string]) setErros((x) => ({ ...x, [k]: undefined }))
  }
  const mudarDia = (i: number, d: Partial<Dia>) => {
    setF((s) => (s ? { ...s, semana: s.semana.map((x, j) => (j === i ? { ...x, ...d } : x)) } : s))
    if (erros[`dia-${i}`]) setErros((x) => ({ ...x, [`dia-${i}`]: undefined }))
  }
  const mexeu = useMemo(() => !!f && (!antes.current || JSON.stringify(f) !== JSON.stringify(antes.current)), [f])

  const salvar = async (ev?: FormEvent) => {
    ev?.preventDefault()
    if (!f || salvando) return
    // a hora que ficou no meio (Enter sem sair do campo) vai no formato certo
    const semana = f.semana.map((x) => ({ ...x, abre: normalizarHora(x.abre), fecha: normalizarHora(x.fecha) }))
    const fn = JSON.stringify(semana) === JSON.stringify(f.semana) ? f : { ...f, semana }
    if (fn !== f) setF(fn)
    const n = validar(fn)
    setErros(n)
    setGeral(null)
    const primeiro = Object.keys(n)[0]
    if (primeiro) {
      const id = primeiro.startsWith('dia-') ? `e-abre-${primeiro.slice(4)}` : primeiro === 'gratisDias' ? 'e-gratis-0' : primeiro === 'pagamentos' ? 'e-pag-pix' : `e-${primeiro}`
      const el = document.getElementById(id)
      el?.focus()
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      return
    }
    if (trava.current) return
    trava.current = true
    setSalvando(true)
    try {
      const r = await api.salvarEstado(corpo(fn, uf, antes.current))
      guardarLoja((x) => comEstado(x, r.estado, r))
      avisarNaProxima(e ? `${r.estado.nome}: salvo. O site já mostra.` : `${r.estado.nome} ativado no site. Agora liga os produtos que tem lá (Produtos → ${uf.toUpperCase()}).`)
      if (e) voltar(caminho.estados)
      else ir(caminho.estados, true)
    } catch (err) {
      if (err instanceof ErroApi && err.campo) {
        const c = err.campo === 'horario' ? `dia-${Number(err.dados.dia ?? 0)}` : err.campo === 'entregaGratis' ? 'gratisTexto' : err.campo
        setErros({ [c]: err.codigo === 'proibido' ? 'Tabaco e vape não entram no site (regra da Anvisa pra venda online).' : err.message })
      } else setGeral(apiBase.mensagemDe(err))
    } finally {
      trava.current = false
      setSalvando(false)
    }
  }

  const titulo = <TituloTela>{nome ?? 'Estado'}</TituloTela>
  if (!nome) {
    return (
      <>
        <Topo voltar={caminho.estados} titulo={titulo} />
        <div className="pn-pagina">
          <Aviso tipo="info">Esse estado não existe.</Aviso>
        </div>
      </>
    )
  }
  if (leitura.erro && !l) {
    return (
      <>
        <Topo voltar={caminho.estados} titulo={titulo} />
        <div className="pn-pagina">
          <Aviso tipo="erro">{leitura.erro.message}</Aviso>
        </div>
      </>
    )
  }
  if (!f || !l) {
    return (
      <>
        <Topo voltar={caminho.estados} titulo={titulo} />
        <Carregando />
      </>
    )
  }
  const mesmo = l.ajustes.mesmoWhatsappParaTodos

  return (
    <>
      <Topo voltar={caminho.estados} titulo={titulo} />
      <form className="pn-pagina pn-pagina-estreita pn-editar pn-editar-so" onSubmit={(x) => void salvar(x)} noValidate>
        <div className="pn-editar-form">
          {!e && (
            <Aviso tipo="info">
              {nome} ainda não tá no site. Preenche o Instagram e o pagamento e ativa: o resto pode ficar “a confirmar”.
            </Aviso>
          )}
          {e && (
            <Secao titulo="No site" id="s-e-site">
              <label className="pn-troca">
                <input id="e-ativo" type="checkbox" checked={f.ativo} onChange={(x) => mudar('ativo', x.target.checked)} />
                <span className="pn-troca-marca" aria-hidden="true" />
                <span>Aparece no site</span>
              </label>
              <p className="pn-dica-bloco">{f.ativo ? 'Desligado, o estado some do site (a escolha de estado, o “Por estado”, a faixa dos @) e os dados ficam guardados.' : 'Fora do site. Liga pra voltar.'}</p>
            </Secao>
          )}

          <Secao titulo="Perfil" id="s-e-perfil">
            <Campo id="e-instagram" rotulo="Instagram do estado" erro={erros.instagram} dica="As dúvidas e o “Avisar quando chegar” vão pra DM dele.">
              {(a) => (
                <div className="pn-arroba">
                  <span aria-hidden="true">@</span>
                  <input {...a} name="instagram" className="pn-input" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="greencheese_imports" value={f.instagram} onChange={(x) => mudar('instagram', x.target.value)} />
                </div>
              )}
            </Campo>
            <Campo id="e-nomePerfil" rotulo="Nome do perfil" erro={erros.nomePerfil} dica="O nome que aparece no perfil do Instagram (vazio: só o @)." lado={<span className="pn-opcional">opcional</span>}>
              {(a) => <input {...a} name="nomePerfil" className="pn-input" autoComplete="off" maxLength={40} placeholder="GREEN CHEESE LTDA" value={f.nomePerfil} onChange={(x) => mudar('nomePerfil', x.target.value)} />}
            </Campo>
            <Campo
              id="e-destaque"
              rotulo="Nome do destaque"
              erro={erros.destaque}
              dica={
                cabeNaBolinha(f.destaque)
                  ? 'A bolinha do estado nos destaques do Início (abre o atendimento).'
                  : 'No celular, esse nome passa da bolinha e o fim vira “…” (como no Instagram). Umas 11 letras cabem inteiras (ex.: DELIVERY RJ).'
              }
              lado={<span className="pn-contagem">{tamanho(f.destaque)}/20</span>}
            >
              {(a) => <input {...a} name="destaque" className="pn-input" autoComplete="off" maxLength={20} value={f.destaque} onChange={(x) => mudar('destaque', x.target.value)} />}
            </Campo>
          </Secao>

          <Secao titulo="WhatsApp do pedido" id="s-e-whats">
            {mesmo && (
              <Aviso tipo="info">
                Hoje todos os estados fecham no WhatsApp da loja, {whatsappBonito(l.ajustes.whatsapp)}. O número daqui fica guardado e vale quando tu desligar “o mesmo pra todos” na{' '}
                <Link href={caminho.loja} className="pn-link pn-link-dentro">
                  Loja
                </Link>
                .
              </Aviso>
            )}
            <fieldset className="pn-opcoes">
              <legend className="sr-only">WhatsApp do pedido</legend>
              <label className="pn-opcao">
                <input type="radio" name="whatsModo" checked={f.whatsModo === 'loja'} onChange={() => mudar('whatsModo', 'loja')} />
                <span className="pn-opcao-marca" aria-hidden="true" />
                <span>
                  O da loja
                  <small>{whatsappBonito(l.ajustes.whatsapp)}</small>
                </span>
              </label>
              <label className="pn-opcao">
                <input type="radio" name="whatsModo" checked={f.whatsModo === 'proprio'} onChange={() => mudar('whatsModo', 'proprio')} />
                <span className="pn-opcao-marca" aria-hidden="true" />
                <span>
                  Um próprio pra {nome}
                  <small>o pedido daqui fecha nele</small>
                </span>
              </label>
            </fieldset>
            {f.whatsModo === 'proprio' && (
              <Campo id="e-whatsapp" rotulo={`WhatsApp de ${nome}`} erro={erros.whatsapp} dica="Celular com DDD (ex.: 21 99999-8888).">
                {(a) => <input {...a} name="whatsapp" className="pn-input" type="tel" inputMode="tel" autoComplete="off" placeholder="(21) 99999-8888" value={f.whatsapp} onChange={(x) => mudar('whatsapp', x.target.value)} />}
              </Campo>
            )}
          </Secao>

          <Secao titulo="Cidades" id="s-e-cidades" dica="Com mais de uma, o site pergunta a cidade.">
            <Cidades cidades={f.cidades} aoMudar={(c) => mudar('cidades', c)} erro={erros.cidades} />
          </Secao>

          <Secao titulo="Horário de entrega" id="s-e-horario" dica="Fechar depois da meia-noite vale: das 14:00 às 03:00 é até as 3h da madrugada do dia seguinte.">
            {e?.horario.demo && <Aviso tipo="info">Esse horário é de exemplo: o site não mostra até tu salvar o de verdade.</Aviso>}
            <ul className="pn-semana">
              {f.semana.map((x, i) => {
                const erro = erros[`dia-${i}`]
                const nota = madrugada(x, i)
                return (
                  <li key={i} className={`pn-dia-linha${x.aberto ? '' : ' fechado'}${erro ? ' pn-campo-erro' : ''}`}>
                    <label className="pn-troca pn-troca-p pn-dia-nome">
                      <input type="checkbox" checked={x.aberto} onChange={(v) => mudarDia(i, { aberto: v.target.checked })} />
                      <span className="pn-troca-marca" aria-hidden="true" />
                      <span>
                        {/* em 320 o dia vira "Seg" pra hora caber do lado (o leitor de tela lê o nome inteiro) */}
                        <span className="pn-txt-longo">{DIAS[i]}</span>
                        <span className="pn-txt-curto" aria-hidden="true">
                          {DIAS_CURTOS[i][0].toUpperCase() + DIAS_CURTOS[i].slice(1)}
                        </span>
                        <span className="sr-only">: entrega</span>
                      </span>
                    </label>
                    {x.aberto ? (
                      <span className="pn-dia-horas">
                        <Hora id={`e-abre-${i}`} rotulo={`${DIAS[i]}: abre às`} valor={x.abre} aoMudar={(v) => mudarDia(i, { abre: v })} />
                        <span aria-hidden="true">às</span>
                        <Hora rotulo={`${DIAS[i]}: fecha às`} valor={x.fecha} aoMudar={(v) => mudarDia(i, { fecha: v })} />
                      </span>
                    ) : (
                      <span className="pn-dia-fechado">Sem entrega</span>
                    )}
                    {(erro || nota) && (
                      <p className={erro ? 'pn-erro pn-dia-msg' : 'pn-dica pn-dia-msg'}>
                        {erro && <Ic nome="atencao" tamanho={16} />}
                        <span>{erro ?? nota}</span>
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
            <Botao
              variante="cinza"
              icone="copiar"
              onClick={() => {
                const i = [1, 2, 3, 4, 5, 6, 0].find((d) => f.semana[d].aberto)
                if (i == null) return
                const d = f.semana[i]
                mudar('semana', f.semana.map(() => ({ ...d })))
              }}
              disabled={!f.semana.some((x) => x.aberto)}
            >
              Repetir o de {DIAS_CURTOS[[1, 2, 3, 4, 5, 6, 0].find((d) => f.semana[d].aberto) ?? 1]} em todos<span className="pn-txt-longo"> os dias</span>
            </Botao>
          </Secao>

          <Secao titulo="Taxa de entrega" id="s-e-taxa">
            {e?.taxaEntrega.demo && <Aviso tipo="info">Essa taxa é de exemplo: o site mostra “a confirmar” até tu salvar a de verdade.</Aviso>}
            <fieldset className="pn-opcoes">
              <legend className="sr-only">Taxa de entrega</legend>
              <label className="pn-opcao">
                <input type="radio" name="taxaModo" checked={f.taxaModo === 'confirmar'} onChange={() => mudar('taxaModo', 'confirmar')} />
                <span className="pn-opcao-marca" aria-hidden="true" />
                <span>
                  A confirmar
                  <small>a loja passa no WhatsApp</small>
                </span>
              </label>
              <label className="pn-opcao">
                <input type="radio" name="taxaModo" checked={f.taxaModo === 'valor'} onChange={() => mudar('taxaModo', 'valor')} />
                <span className="pn-opcao-marca" aria-hidden="true" />
                <span>Um valor fixo</span>
              </label>
            </fieldset>
            {f.taxaModo === 'valor' && (
              <Campo id="e-taxa" rotulo="Taxa" erro={erros.taxa}>
                {(a) => (
                  <div className="pn-reais">
                    <span aria-hidden="true">R$</span>
                    <input {...a} name="taxa" className="pn-input" inputMode="decimal" autoComplete="off" placeholder="10,00" value={f.taxa} onChange={(x) => mudar('taxa', x.target.value.replace(/[^\d,.]/g, '').slice(0, 10))} />
                  </div>
                )}
              </Campo>
            )}
          </Secao>

          <Secao titulo="Entrega grátis" id="s-e-gratis">
            <label className="pn-troca">
              <input id="e-gratis" type="checkbox" checked={f.gratis} onChange={(x) => mudar('gratis', x.target.checked)} />
              <span className="pn-troca-marca" aria-hidden="true" />
              <span>Tem dia com entrega grátis</span>
            </label>
            {f.gratis && (
              <>
                <div className={`pn-campo${erros.gratisDias ? ' pn-campo-erro' : ''}`}>
                  <p id="e-gratis-rot" className="pn-rotulo">
                    Em que dia
                  </p>
                  <div className="pn-dias" role="group" aria-labelledby="e-gratis-rot" aria-describedby={erros.gratisDias ? 'e-gratis-erro' : undefined}>
                    {DIAS_CURTOS.map((d, i) => {
                      const on = f.gratisDias.includes(i)
                      return (
                        <button key={d} id={`e-gratis-${i}`} type="button" className={`pn-chip-uf${on ? ' on' : ''}`} aria-pressed={on} aria-label={DIAS[i]} onClick={() => mudar('gratisDias', on ? f.gratisDias.filter((x) => x !== i) : [...f.gratisDias, i])}>
                          {d}
                        </button>
                      )
                    })}
                  </div>
                  {erros.gratisDias && (
                    <p id="e-gratis-erro" className="pn-erro">
                      <Ic nome="atencao" tamanho={16} />
                      <span>{erros.gratisDias}</span>
                    </p>
                  )}
                </div>
                <Campo id="e-gratisTexto" rotulo="Frase do dia" erro={erros.gratisTexto} dica="Aparece no perfil e no story do Início nesse dia." lado={<span className="pn-contagem">{tamanho(f.gratisTexto)}/40</span>}>
                  {(a) => <input {...a} name="gratisTexto" className="pn-input" autoComplete="off" maxLength={40} value={f.gratisTexto} onChange={(x) => mudar('gratisTexto', x.target.value)} />}
                </Campo>
              </>
            )}
          </Secao>

          <Secao titulo="Pagamento" id="s-e-pag">
            <div className={`pn-campo${erros.pagamentos ? ' pn-campo-erro' : ''}`}>
              <div className="pn-pagamentos" role="group" aria-label="Formas de pagamento" aria-describedby={erros.pagamentos ? 'e-pag-erro' : undefined}>
                {PAGAMENTOS.map((x) => {
                  const on = f.pagamentos.includes(x.id)
                  return (
                    <label key={x.id} className="pn-marcar">
                      <input id={`e-pag-${x.id}`} type="checkbox" checked={on} onChange={() => mudar('pagamentos', on ? f.pagamentos.filter((y) => y !== x.id) : PAGAMENTOS.map((y) => y.id).filter((y) => y === x.id || f.pagamentos.includes(y)))} />
                      <span className="pn-marcar-caixa" aria-hidden="true">
                        {on && <Ic nome="check" tamanho={16} />}
                      </span>
                      <span>{x.nome}</span>
                    </label>
                  )
                })}
              </div>
              {erros.pagamentos && (
                <p id="e-pag-erro" className="pn-erro">
                  <Ic nome="atencao" tamanho={16} />
                  <span>{erros.pagamentos}</span>
                </p>
              )}
            </div>
          </Secao>
        </div>

        <div className="pn-editar-pe">
          {geral && <Aviso tipo="erro">{geral}</Aviso>}
          <Botao type="submit" largo ocupado={salvando} disabled={!!e && !mexeu}>
            {e ? 'Salvar' : `Ativar ${nome}`}
          </Botao>
        </div>
      </form>
    </>
  )
}
