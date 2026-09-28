/**
 * PLACEHOLDER (foundation) — Modo Imersivo (fase 2). Rendered under <html data-lx-theme="transmissao">.
 * Contract: default export, no props. Route "#/imersivo".
 */
export default function ImmersiveComingSoon() {
  return (
    <main id="conteudo" tabIndex={-1} className="relative z-[1] flex-1 grid place-items-center px-4 py-12">
      <div className="lx-plate lx-plate--glass lx-edge w-full max-w-[640px] p-6 sm:p-8">
        <span className="lx-kicker">Modo Imersivo · em breve</span>
        <h1 className="lx-t-display mt-2 mb-0">Jogue partida a partida</h1>
        <p className="lx-t-body mt-3 mb-0">
          Entre em campo nos lances decisivos, fale com a imprensa, negocie contratos e dispute cada rodada — com grafismo de transmissão de TV.
        </p>
        <div className="flex flex-wrap gap-3 mt-6">
          <a className="lx-btn lx-btn--primary" href="#/identidade">
            <span>Jogar o Clássico</span>
          </a>
          <a className="lx-btn lx-btn--ghost" href="#/">
            <span>Voltar</span>
          </a>
        </div>
      </div>
    </main>
  )
}
