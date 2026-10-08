// Incluir quem entrou pela DM (ou corrigir os dados de alguém): nome, WhatsApp, estado, cidade, vagas, observação
// e, ao incluir, se já pagou (aí o contador já sobe). Mesmas regras de vaga do site; o estado o dono escolhe.
import { useRef, useState, type FormEvent } from 'react'
import * as api from '../api'
import { ErroApi } from '../api'
import { ufs as todasUfs } from '../../dados/ufs'
import { Folha } from '../Folha'
import { brl } from '../formato'
import type { Participante, RateioAdmin } from '../tipos'
import { Aviso, Botao, Campo, Numero } from '../ui'
import { celularNoCampo, conferirCelular, digitosCelular, mascaraCelular } from '../whats'

type Erros = Partial<Record<string, string>>

export function FormPessoa({
  aberta,
  rateio,
  pessoa,
  aoFechar,
  aoSalvar,
}: {
  aberta: boolean
  rateio: RateioAdmin
  /** Editar essa pessoa (sem ela, inclui). */
  pessoa: Participante | null
  aoFechar: () => void
  aoSalvar: (r: { participante: Participante; rateio: RateioAdmin }, incluiu: boolean) => void
}) {
  return aberta ? <Form rateio={rateio} pessoa={pessoa} aoFechar={aoFechar} aoSalvar={aoSalvar} /> : null
}

function Form({ rateio, pessoa, aoFechar, aoSalvar }: { rateio: RateioAdmin; pessoa: Participante | null; aoFechar: () => void; aoSalvar: (r: { participante: Participante; rateio: RateioAdmin }, incluiu: boolean) => void }) {
  const [v, setV] = useState({
    nome: pessoa?.nome ?? '',
    whatsapp: pessoa ? celularNoCampo(pessoa.whatsapp) : '',
    uf: pessoa?.uf ?? rateio.ufs[0] ?? 'mg',
    cidade: pessoa?.cidade ?? '',
    quantidade: pessoa?.quantidade ?? 1,
    observacao: pessoa?.observacao ?? '',
    pagou: false,
  })
  const [erros, setErros] = useState<Erros>({})
  const [geral, setGeral] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  // trava síncrona: o estado só muda no próximo desenho, e um toque duplo passaria pelos dois
  const trava = useRef(false)
  const form = useRef<HTMLFormElement>(null)
  const nomeRef = useRef<HTMLInputElement>(null)
  const mudar = <K extends keyof typeof v>(k: K, x: (typeof v)[K]) => {
    setV((s) => ({ ...s, [k]: x }))
    if (erros[k]) setErros((e) => ({ ...e, [k]: undefined }))
  }
  const max = Math.max(1, rateio.limitePorPessoa)

  const enviar = async (e?: FormEvent) => {
    e?.preventDefault()
    if (ocupado) return
    const novos: Erros = {
      nome: v.nome.trim().length < 2 ? 'Põe o nome (2 letras ou mais).' : undefined,
      whatsapp: conferirCelular(v.whatsapp) ?? undefined,
      cidade: v.cidade.length > 60 ? 'Cidade até 60 letras.' : undefined,
      observacao: v.observacao.length > 500 ? 'Observação até 500 letras.' : undefined,
    }
    setErros(novos)
    setGeral(null)
    const primeiro = Object.keys(novos).find((k) => novos[k])
    if (primeiro) {
      form.current?.querySelector<HTMLElement>(`[name="${primeiro}"]`)?.focus()
      return
    }
    if (trava.current) return
    trava.current = true
    setOcupado(true)
    try {
      const r = await api.salvarParticipante({
        ...(pessoa ? { id: pessoa.id } : { rateio: rateio.id, status: v.pagou ? 'confirmado' : 'reservado' }),
        nome: v.nome.trim(),
        whatsapp: digitosCelular(v.whatsapp),
        uf: v.uf,
        cidade: v.cidade.trim(),
        quantidade: v.quantidade,
        observacao: v.observacao.trim(),
      })
      aoSalvar(r, !pessoa)
    } catch (err) {
      if (err instanceof ErroApi && err.campo && ['nome', 'whatsapp', 'uf', 'cidade', 'quantidade', 'observacao'].includes(err.campo)) {
        const c = err.campo
        setErros({ [c]: err.message })
        form.current?.querySelector<HTMLElement>(`[name="${c}"]`)?.focus()
      } else setGeral(api.mensagemDe(err))
    } finally {
      trava.current = false
      setOcupado(false)
    }
  }

  const outras = todasUfs.map((u) => u.sigla.toLowerCase()).filter((u) => !rateio.ufs.includes(u))
  return (
    <Folha
      aberta
      aoFechar={aoFechar}
      preso={ocupado}
      focoInicial={nomeRef}
      titulo={pessoa ? `Editar ${pessoa.codigo}` : 'Incluir no rateio'}
      sub={pessoa ? undefined : 'Pra quem entrou pela DM ou pelo WhatsApp. A pessoa entra com código, igual a quem entra pelo site.'}
      rodape={
        <Botao largo ocupado={ocupado} onClick={() => void enviar()}>
          {pessoa ? 'Salvar' : v.pagou ? `Incluir com ${v.quantidade === 1 ? 'a vaga paga' : 'as vagas pagas'}` : 'Incluir com reserva'}
        </Botao>
      }
    >
      <form ref={form} className="pn-folha-pad pn-form" onSubmit={(e) => void enviar(e)} noValidate>
        <Campo id="p-nome" rotulo="Nome" erro={erros.nome}>
          {(a) => <input {...a} ref={nomeRef} name="nome" className="pn-input" autoComplete="off" maxLength={60} value={v.nome} onChange={(e) => mudar('nome', e.target.value)} />}
        </Campo>
        <Campo id="p-whatsapp" rotulo="WhatsApp" erro={erros.whatsapp} dica="Com DDD. Pode colar do jeito que veio.">
          {(a) => <input {...a} name="whatsapp" className="pn-input" type="tel" inputMode="tel" autoComplete="off" placeholder="(33) 99999-9999" value={v.whatsapp} onChange={(e) => mudar('whatsapp', mascaraCelular(e.target.value))} />}
        </Campo>
        <div className="pn-dupla">
          <Campo id="p-uf" rotulo="Estado" erro={erros.uf}>
            {(a) => (
              <select {...a} name="uf" className="pn-input pn-select" value={v.uf} onChange={(e) => mudar('uf', e.target.value)}>
                <optgroup label="Onde o rateio vale">
                  {rateio.ufs.map((u) => (
                    <option key={u} value={u}>
                      {u.toUpperCase()}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Outros estados">
                  {outras.map((u) => (
                    <option key={u} value={u}>
                      {u.toUpperCase()}
                    </option>
                  ))}
                </optgroup>
              </select>
            )}
          </Campo>
          <Campo id="p-cidade" rotulo="Cidade" erro={erros.cidade} lado={<span className="pn-opcional">opcional</span>}>
            {(a) => <input {...a} name="cidade" className="pn-input" autoComplete="off" maxLength={60} value={v.cidade} onChange={(e) => mudar('cidade', e.target.value)} />}
          </Campo>
        </div>
        <Campo id="p-quantidade" rotulo="Vagas" erro={erros.quantidade} dica={`No máximo ${max} por pessoa · ${brl(v.quantidade * (pessoa?.precoUnit ?? rateio.precoRateio))}`}>
          {(a) => <Numero aria={a} valor={String(v.quantidade)} aoMudar={(s) => mudar('quantidade', Math.min(max, Math.max(1, Number(s) || 1)))} min={1} max={max} rotuloMenos="Uma vaga a menos" rotuloMais="Uma vaga a mais" />}
        </Campo>
        <Campo id="p-observacao" rotulo="Observação" erro={erros.observacao} lado={<span className="pn-opcional">opcional</span>}>
          {(a) => <textarea {...a} name="observacao" className="pn-input pn-texto" rows={2} maxLength={500} placeholder="Ex.: pagou no Pix às 14h" value={v.observacao} onChange={(e) => mudar('observacao', e.target.value)} />}
        </Campo>
        {!pessoa && (
          <fieldset className="pn-opcoes">
            <legend className="pn-rotulo">Já pagou?</legend>
            <label className="pn-opcao">
              <input type="radio" name="pagou" checked={!v.pagou} onChange={() => mudar('pagou', false)} />
              <span className="pn-opcao-marca" aria-hidden="true" />
              <span>
                <strong>Ainda não</strong>
                <small>Fica reservado por {rateio.reservaHoras} h, esperando o pagamento.</small>
              </span>
            </label>
            <label className="pn-opcao">
              <input type="radio" name="pagou" checked={v.pagou} onChange={() => mudar('pagou', true)} />
              <span className="pn-opcao-marca" aria-hidden="true" />
              <span>
                <strong>Já pagou</strong>
                <small>Confirma agora e o contador sobe.</small>
              </span>
            </label>
          </fieldset>
        )}
        {geral && <Aviso tipo="erro">{geral}</Aviso>}
        <button type="submit" className="sr-only" tabIndex={-1}>
          Salvar
        </button>
      </form>
    </Folha>
  )
}
