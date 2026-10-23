/**
 * "Convide amigos" (Minha conta): o link de convite (copiar / compartilhar), o progresso das indicações
 * (+2, +3, +5 de OVR, até 3 amigos), o que falta para liberar os bônus e os bônus guardados para as próximas
 * carreiras. Dados do GET bonus.php (servidor/CONTRATO-v3.md §6).
 */
import { useEffect, useState } from 'react'
import { Check, Copy, Gift, Hourglass, Lock, MessageCircle, RefreshCw, Share2, Sparkles, UserPlus } from 'lucide-react'
import { Button, cx, toast } from '@/ui/primitives'
import { bonusDoSite } from './acesso'
import { degrausIndicacao, ROTULO_ORIGEM, textoFaltam, useBonus } from './bonus'
import { track } from './medicao'
import './site.css'

/** O "Mandar no WhatsApp": https://wa.me/?text=… (abre o app no celular e o WhatsApp Web no computador). */
export const linkWhatsApp = (texto: string) => `https://wa.me/?text=${encodeURIComponent(texto)}`

export default function ConvideAmigos() {
  const dados = useBonus((s) => s.dados)
  const carregando = useBonus((s) => s.carregando)
  const erro = useBonus((s) => s.erro)
  const [copiado, setCopiado] = useState<'copiar' | 'compartilhar' | null>(null)
  useEffect(() => {
    void useBonus.getState().carregar(true)
  }, [])

  if (!dados) {
    if (erro && !carregando)
      return (
        <section className="sc-conv" aria-label="Convide amigos">
          <p className="sc-conv__erro">{erro}</p>
          <Button variant="ghost" size="sm" icon={RefreshCw} onClick={() => void useBonus.getState().carregar(true)}>
            Tentar de novo
          </Button>
        </section>
      )
    return <div className="sc-sk sc-conv__sk" aria-busy="true" aria-label="Carregando os convites" />
  }

  const regras = bonusDoSite()
  const degraus = degrausIndicacao(dados)
  const link = dados.linkConvite
  const total = dados.disponiveis.reduce((a, b) => a + b.valor, 0)
  const texto = 'Bora ver quem faz a maior lenda do futebol? Joga o LENDA comigo:'
  /** `de`: o botão tocado (é ele que vira "Copiado"); pelo Compartilhar sem a folha do aparelho, avisa onde colar. */
  const copiar = async (de: 'copiar' | 'compartilhar' = 'copiar') => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopiado(de)
      window.setTimeout(() => setCopiado(null), 2600)
      // v3.5: dentro do TikTok/WhatsApp (WebView do Android, sem navigator.share) o "Compartilhar" copiava em silêncio
      if (de === 'compartilhar') toast.success('Link copiado!', 'Cole no WhatsApp, no Direct ou onde quiser.', { key: 'convite-copiado' })
      track('compartilhar', null, { acao: de === 'compartilhar' ? 'convite_copiar_share' : 'convite_copiar', rota: '/conta' })
    } catch {
      toast.info('Copie o link', link, { duration: 9000 })
    }
  }
  const compartilhar = async () => {
    if (!link) return
    const data: ShareData = { title: 'LENDA', text: texto, url: link }
    if (!navigator.share || (navigator.canShare && !navigator.canShare(data))) return copiar('compartilhar')
    try {
      await navigator.share(data)
      track('compartilhar', null, { acao: 'convite_ok', rota: '/conta' })
    } catch (err) {
      if ((err as DOMException)?.name !== 'AbortError') void copiar('compartilhar')
    }
  }

  return (
    <section className="sc-conv" aria-labelledby="sc-conv-h">
      <div className="sc-conv__top">
        <span className="sc-conv__i" aria-hidden="true">
          <UserPlus />
        </span>
        <div className="min-w-0">
          <h3 id="sc-conv-h">Convide amigos</h3>
          <p>
            Cada amigo que criar a conta pelo seu link e terminar a 1ª carreira vale OVR extra na sua próxima: {regras.indicacao.slice(0, regras.maxIndicacoes).map((v) => `+${v}`).join(', ')} (até {regras.maxIndicacoes} amigos).
          </p>
        </div>
      </div>

      {link && (
        <div className="sc-conv__link">
          <input className="lx-input" readOnly value={link} aria-label="Seu link de convite" onFocus={(e) => e.currentTarget.select()} />
          <div className="sc-btns">
            <Button variant="primary" size="sm" icon={copiado === 'compartilhar' ? Check : Share2} onClick={compartilhar}>
              {copiado === 'compartilhar' ? 'Link copiado' : 'Compartilhar'}
            </Button>
            <Button variant="ghost" size="sm" icon={copiado === 'copiar' ? Check : Copy} onClick={() => void copiar('copiar')}>
              {copiado === 'copiar' ? 'Copiado' : 'Copiar'}
            </Button>
            {/* v3.5: o wa.me abre o WhatsApp de dentro do TikTok e do Instagram, onde o navigator.share não existe */}
            <Button
              variant="ghost"
              size="sm"
              icon={MessageCircle}
              href={linkWhatsApp(`${texto} ${link}`)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => track('compartilhar', null, { acao: 'convite_whatsapp', rota: '/conta' })}
            >
              Mandar no WhatsApp
            </Button>
          </div>
        </div>
      )}

      <ol className="sc-degraus" aria-label={`Amigos: ${dados.indicacoes.validas} de ${dados.indicacoes.limite}`}>
        {degraus.map((d, i) => (
          <li key={i} className={cx('sc-degrau', `is-${d.estado}`)}>
            <span className="sc-degrau__v num">+{d.valor}</span>
            <span className="sc-degrau__e">
              {d.estado === 'ganho' ? <Check aria-hidden="true" /> : d.estado === 'esperando' ? <Hourglass aria-hidden="true" /> : null}
              {d.estado === 'ganho' ? 'Ganho' : d.estado === 'esperando' ? 'Jogando a 1ª' : `${i + 1}º amigo`}
            </span>
          </li>
        ))}
      </ol>
      <p className="sc-conv__meta">
        <b className="num">
          {dados.indicacoes.validas}/{dados.indicacoes.limite}
        </b>{' '}
        amigos{dados.indicacoes.pendentes ? ` · ${dados.indicacoes.pendentes} ainda jogando a 1ª carreira` : ''}
        {dados.indicacoes.validas >= dados.indicacoes.limite ? ' · você já ganhou todos os bônus de indicação' : dados.indicacoes.proximoValor ? ` · próximo: +${dados.indicacoes.proximoValor}` : ''}
      </p>

      {!dados.liberado && (
        <p className="sc-conv__lock">
          <Lock aria-hidden="true" />
          <span>
            Os bônus liberam depois de {regras.liberaAposPartidas} partidas com a conta: <b>{textoFaltam(dados.faltamPartidas)}</b>. Amigos que entrarem antes ficam guardados e o bônus cai quando liberar.
          </span>
        </p>
      )}

      <div className="sc-conv__bonus">
        <div>
          <Gift aria-hidden="true" />
          <span>
            {dados.guardados.length > 0 && (
              <>
                <b>+{dados.guardados.reduce((a, b) => a + b.valor, 0)} esperando liberar</b> ({dados.guardados.map((b) => `+${b.valor} ${ROTULO_ORIGEM[b.origem]}`).join(' · ')}).{' '}
              </>
            )}
            {dados.disponiveis.length ? (
              <>
                <b>
                  +{total} de OVR guardado{dados.disponiveis.length > 1 ? ` em ${dados.disponiveis.length} bônus` : ''}
                </b>{' '}
                ({dados.disponiveis.map((b) => `+${b.valor} ${ROTULO_ORIGEM[b.origem]}`).join(' · ')}) — um por carreira, na criação da próxima do Clássico.
              </>
            ) : dados.guardados.length ? null : (
              'Nenhum bônus guardado agora.'
            )}
            {dados.usados ? ` Já usou ${dados.usados}.` : ''}
          </span>
        </div>
        <div>
          <Sparkles aria-hidden="true" />
          <span>
            Compartilhar o card final de uma carreira: <b>+{dados.compartilharValor}</b>, uma vez por dia
            {!dados.liberado ? '.' : dados.compartilharHoje ? ' — o de hoje ainda está disponível.' : ' — o de hoje já é seu.'}
          </span>
        </div>
      </div>
    </section>
  )
}
