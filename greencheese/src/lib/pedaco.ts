/**
 * Baixa um pedaço à parte (import dinâmico) tentando de novo antes de desistir (a rede do celular oscila). O navegador
 * guarda a falha de um import() e não busca o mesmo endereço outra vez: a nova tentativa vai no endereço do pedaço (que
 * vem na mensagem do erro, no Chrome e no Firefox) com um ?tentativa= no fim.
 */
export function tentar<M>(carregar: () => Promise<M>, vezes = 3, n = 1): Promise<M> {
  return carregar().catch((erro: unknown) => {
    if (n >= vezes) return Promise.reject(erro)
    const url = String((erro as Error)?.message ?? '').match(/https?:\/\/\S+?\.js/)?.[0]
    const deNovo = url ? () => import(/* @vite-ignore */ `${url}?tentativa=${Date.now()}`) as Promise<M> : carregar
    return new Promise<M>((ok, falha) => setTimeout(() => tentar(deNovo, vezes, n + 1).then(ok, falha), 700 * n))
  })
}
