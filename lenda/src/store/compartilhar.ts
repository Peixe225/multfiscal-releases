/**
 * Ponte do "Compartilhar" do card da carreira com o site (src/site), sem o resto do jogo importar o site:
 * o link que vai junto (com o código de convite do jogador) e o aviso de que o compartilhamento deu certo
 * (bônus de OVR — servidor/CONTRATO-v3.md §6). Fora do site fica `null` e o card funciona como sempre.
 */
export interface PonteCompartilhar {
  /**
   * O link do jogo para pôr no compartilhamento, já pronto (sem esperar a rede: o Web Share precisa do clique). v3.4: com
   * `carreiraId` (a carreira do card), o link da prévia (api/v.php: o cartão com o resumo dela nas redes).
   */
  link(carreiraId?: string | null): string | null
  /**
   * O card apareceu: o site já busca o código de convite (o link fica pronto antes do clique). v3.4 §E: com `carreiraId`, confere
   * também se a carreira já está no Hall público (só então o link é o da prévia); `propria` = false: a carreira é de outro
   * jogador (o resumo da comunidade, que veio do Hall público).
   */
  preparar(carreiraId?: string | null, propria?: boolean): void
  /** Compartilhou de verdade (o Web Share resolveu ou o link foi copiado) uma carreira encerrada deste jogador. */
  compartilhou(carreiraId: string, como: 'share' | 'link'): void
}

export const pontes: { compartilhar: PonteCompartilhar | null } = { compartilhar: null }
