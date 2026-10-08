// Servidor: o diagnóstico do admin-diagnostico em português de gente (o que precisa de atenção primeiro, depois cada
// conferência), a conferência pela web do que tem que ficar fechado e a cópia do banco pra baixar.
import { useEffect, useRef, useState } from 'react'
import * as api from '../api'
import { bytes } from '../formato'
import { Topo } from '../Moldura'
import type { Diagnostico } from '../tipos'
import { Aviso, Botao, Carregando, Ic, TituloTela } from '../ui'
import { useTitulo } from './comum'

const NOME_WEB: Record<string, string> = {
  api: 'A API responde pelo endereço do site',
  'privado/loja.sqlite': 'O banco não abre pela web',
  'privado/erros.log': 'O registro de erros não abre pela web',
  'nucleo/base.php': 'Os módulos do servidor não abrem pela web',
  'instalacao.php': 'O código de instalação não abre pela web',
  '.htaccess': 'As regras do servidor não abrem pela web',
  'php em uploads/': 'Nada roda na pasta das fotos',
}

/** Detalhes que não travam nada mas valem conferir (sem HTTPS, código de desenvolvimento, foto sem ajuste). */
function detalhes(d: Diagnostico): number {
  return [!d.https, d.instalacao.codigoDev, !(d.extensoes.gd && d.extensoes.webp), !d.extensoes.fileinfo, !d.dados.gravavel, !d.uploads.gravavel].filter(Boolean).length
}

function Item({ ok, nome, sub }: { ok: boolean | null; nome: string; sub?: string }) {
  return (
    <li className={`pn-diag ${ok === true ? 'ok' : ok === false ? 'ruim' : 'talvez'}`}>
      <span className="pn-diag-ic" aria-hidden="true">
        <Ic nome={ok === true ? 'check' : ok === false ? 'atencao' : 'relogio'} tamanho={16} />
      </span>
      <span className="pn-diag-txt">
        <span>{nome}</span>
        {sub && <small>{sub}</small>}
      </span>
      <span className="sr-only">{ok === true ? ': certo' : ok === false ? ': precisa de atenção' : ': não deu pra saber'}</span>
    </li>
  )
}

export function Servidor() {
  useTitulo('Servidor')
  const [d, setD] = useState<Diagnostico | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [conferindo, setConferindo] = useState(false)
  // trava síncrona: o estado só muda no próximo desenho, e um toque duplo passaria pelos dois
  const trava = useRef(false)
  const conferir = async () => {
    if (conferindo) return
    if (trava.current) return
    trava.current = true
    setConferindo(true)
    setErro(null)
    try {
      setD(await api.diagnostico())
    } catch (e) {
      setErro(api.mensagemDe(e))
    } finally {
      trava.current = false
      setConferindo(false)
    }
  }
  useEffect(() => {
    void conferir()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <Topo titulo={<TituloTela>Servidor</TituloTela>} acoes={<Botao variante="cinza" className="pn-botao-p pn-so-icone-estreito" icone="giro" ocupado={conferindo} onClick={() => void conferir()}>Conferir de novo</Botao>} />
      <div className="pn-pagina pn-pagina-estreita">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {!d && !erro && <Carregando rotulo="Conferindo o servidor…" />}
        {d && (
          <>
            <section className={`pn-diag-cab ${d.avisos.length ? 'ruim' : 'ok'}`} aria-labelledby="h-diag">
              <Ic nome={d.avisos.length ? 'atencao' : 'check'} tamanho={32} />
              <div>
                <h2 id="h-diag" className="pn-h2">
                  {d.avisos.length ? (d.avisos.length === 1 ? '1 coisa pra olhar' : `${d.avisos.length} coisas pra olhar`) : detalhes(d) ? 'Funcionando' : 'Tudo certo'}
                </h2>
                <p className="pn-dica-bloco">
                  {!d.avisos.length && detalhes(d) ? `${detalhes(d) === 1 ? '1 detalhe' : `${detalhes(d)} detalhes`} pra conferir aqui embaixo · ` : ''}API {d.versaoApi} · PHP {d.php.versao} · banco {bytes(d.dados.bancoBytes)}
                </p>
              </div>
            </section>
            {d.avisos.length > 0 && (
              <ul className="pn-avisos-diag">
                {d.avisos.map((a) => (
                  <li key={a}>
                    <Aviso tipo="erro">{a}</Aviso>
                  </li>
                ))}
              </ul>
            )}

            <section className="pn-bloco" aria-labelledby="h-fechado">
              <h2 id="h-fechado" className="pn-h2">
                Fechado pra quem não deve
              </h2>
              {d.web.testado ? (
                <ul className="pn-diags">
                  {d.web.itens.map((i) => (
                    <Item key={i.nome} ok={i.ok} nome={NOME_WEB[i.nome] ?? i.nome} sub={i.ok === false ? `ABERTO (${i.status}): confere o .htaccess dessa pasta` : i.ok === null ? 'Não deu pra saber' : undefined} />
                  ))}
                </ul>
              ) : (
                <p className="pn-dica-bloco">Não deu pra testar pela web ({d.web.motivo}).</p>
              )}
            </section>

            <section className="pn-bloco" aria-labelledby="h-pecas">
              <h2 id="h-pecas" className="pn-h2">
                Peças do servidor
              </h2>
              <ul className="pn-diags">
                <Item ok={d.php.ok} nome={`PHP ${d.php.versao}`} sub={d.php.ok ? undefined : 'Precisa do 8.1 ou mais novo (hPanel → Configuração do PHP).'} />
                <Item ok={d.extensoes.pdo_sqlite} nome={`Banco SQLite ${d.extensoes.sqlite}`} />
                <Item ok={d.dados.gravavel} nome="Pasta de dados grava" sub={d.dados.diario === 'wal' ? undefined : `Diário ${d.dados.diario} (o certo é wal)`} />
                <Item ok={d.uploads.gravavel} nome="Pasta das fotos grava" sub={`${d.uploads.arquivos} foto${d.uploads.arquivos === 1 ? '' : 's'} · ${bytes(d.uploads.bytes)}`} />
                <Item ok={d.extensoes.gd && d.extensoes.webp} nome="Ajuste das fotos (GD com WebP)" sub={d.extensoes.gd ? (d.extensoes.webp ? undefined : 'Sem WebP: as fotos ficam em JPG/PNG.') : 'Sem GD: as fotos sobem do jeito que vieram.'} />
                <Item ok={d.extensoes.fileinfo} nome="Conferência do tipo de arquivo" />
                <Item ok={d.https} nome={d.https ? 'HTTPS ligado' : 'Sem HTTPS'} sub={d.https ? undefined : d.instalacao.codigoDev ? 'Normal no computador de quem faz o site.' : 'Liga o SSL no hPanel: sem ele, a senha do painel viaja aberta.'} />
                <Item ok={!d.instalacao.codigoDev} nome={d.instalacao.codigoDev ? 'Código de instalação de desenvolvimento' : 'Código de instalação de verdade'} sub={d.instalacao.codigoDev ? 'Normal no computador de quem faz o site; no ar, gera o de verdade.' : undefined} />
                <Item ok nome={`Foto de até ${d.limites.envioMaximoTexto}`} sub={`upload_max_filesize ${d.limites.upload_max_filesize} · post_max_size ${d.limites.post_max_size}`} />
              </ul>
            </section>

            <section className="pn-bloco" aria-labelledby="h-copia">
              <h2 id="h-copia" className="pn-h2">
                Cópia do banco
              </h2>
              <p className="pn-dica-bloco">Baixa tudo num arquivo só (rateios, participantes, histórico). Faz toda semana e guarda fora do celular, num lugar seguro: tem nome e WhatsApp dos clientes.</p>
              <a className="pn-botao pn-botao-cinza" href={api.urlBackup()} download>
                <Ic nome="baixar" tamanho={16} />
                <span className="pn-botao-txt">Baixar cópia do banco</span>
              </a>
            </section>
          </>
        )}
      </div>
    </>
  )
}
