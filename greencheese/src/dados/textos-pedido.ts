// Falas do pedido guiado (o DM da loja), com o texto de sempre. O dono troca cada uma no painel (Textos do pedido);
// o servidor guarda só o que ele trocou (GET r=pedido-textos) e, sem servidor, vale o daqui.
// Marcadores entre chaves ({nome}, {uf}, {lugar}…) viram o dado da hora ({nome} = o primeiro nome); cada fala só aceita
// os da lista dela.
// {instagram} já vem com o @ (um "@" escrito logo antes dele não dobra).
// A mensagem que vai pro WhatsApp (src/lib/mensagem.ts) NÃO está aqui: o formato dela é combinado com a loja.
// Depois de mexer aqui: node scripts/gerar-textos-pedido.mjs (gera a lista que o servidor confere).
// Regras de sempre: frase curta, no tom da loja; nada de prometer prazo, frete ou preço (a loja confirma no WhatsApp).

export type TipoTexto = 'fala' | 'resposta' | 'botao' | 'dica' | 'erro'

export interface DefTexto {
  /** O texto de sempre. */
  padrao: string
  /** fala = balão da loja; resposta = balão da pessoa; botao = resposta rápida; dica = dentro do campo; erro = embaixo do campo. */
  tipo: TipoTexto
  /** Marcadores que valem nessa fala. */
  marcadores?: readonly string[]
}

/** Tamanho máximo de cada tipo (o servidor confere o mesmo). */
export const MAXIMO_TEXTO: Record<TipoTexto, number> = { fala: 280, resposta: 80, botao: 40, dica: 60, erro: 120 }

/**
 * Promessas que nenhuma fala pode fazer (sem acento, palavra inteira): prazo, frete e afins a loja combina no WhatsApp.
 * A mesma lista de GC_TERMOS_PROMESSA (public/api/nucleo/textos.php); o gerar-textos-pedido.mjs confere as duas.
 */
export const PROMESSAS = [
  'frete', 'gratis', 'gratuito', 'gratuita', 'prazo', 'garantido', 'garantida', 'garantimos', 'garantia', 'minutos',
  'em ate', 'na hora', 'expresso', 'expressa', 'hoje mesmo', 'entrega hoje', 'chega hoje', 'entregamos hoje',
] as const

export const TEXTOS_PEDIDO = {
  // começo: o atendimento (estado e cidade)
  'local.semEstado': { padrao: 'De qual estado você pede?', tipo: 'fala' },
  'local.semEstado.encomenda': { padrao: 'A Green Cheese ainda não chegou no teu estado. Pra qual atendimento vai a encomenda?', tipo: 'fala' },
  'local.outroEstado': { padrao: 'Outro estado', tipo: 'botao' },
  'local.qualCidade': { padrao: 'Teu pedido vai pra Green Cheese {uf}. Qual cidade?', tipo: 'fala', marcadores: ['uf', 'estado'] },
  'local.confirmar': { padrao: 'Teu pedido vai pro atendimento de {lugar}, certo?', tipo: 'fala', marcadores: ['lugar', 'cidade', 'uf', 'estado'] },
  'local.confirmar.encomenda': { padrao: 'A encomenda vai pro atendimento de {lugar}. Pode ser?', tipo: 'fala', marcadores: ['lugar', 'cidade', 'uf', 'estado'] },
  'local.fechado': { padrao: '{horario}. Pode montar o pedido: a resposta vem quando abrir.', tipo: 'fala', marcadores: ['horario'] },
  'local.sim': { padrao: 'Isso', tipo: 'botao' },
  'local.sim.encomenda': { padrao: 'Pode', tipo: 'botao' },
  'local.trocarCidade': { padrao: 'Trocar cidade', tipo: 'botao' },
  'local.trocarEstado': { padrao: 'Trocar estado', tipo: 'botao' },
  'local.trocarAtendimento': { padrao: 'Trocar atendimento', tipo: 'botao' },
  'cidade.pergunta': { padrao: 'A Green Cheese {uf} ainda tá fechando a lista de cidades. Qual a tua cidade?', tipo: 'fala', marcadores: ['uf', 'estado'] },
  'cidade.dica': { padrao: 'Tua cidade…', tipo: 'dica' },
  'cidade.erro': { padrao: 'Escreve o nome da cidade.', tipo: 'erro' },

  // sacola
  'sacola.fora': { padrao: 'Os itens da tua sacola não tão disponíveis em {onde}.', tipo: 'fala', marcadores: ['onde'] },
  'sacola.vazia': { padrao: 'Tua sacola tá vazia.', tipo: 'fala' },
  'sacola.verMercado': { padrao: 'Ver o Mercado', tipo: 'botao' },
  'sacola.encomendar': { padrao: 'Fazer encomenda', tipo: 'botao' },
  'sacola.confere': { padrao: 'Confere a sacola:', tipo: 'fala' },
  'sacola.certo': { padrao: 'Tá certo', tipo: 'botao' },
  'sacola.mexer': { padrao: 'Mexer na sacola', tipo: 'botao' },
  'sacola.quero': { padrao: 'Quero esse', tipo: 'resposta' },
  'sacola.queroVarios': { padrao: 'Quero esses', tipo: 'resposta' },

  // nome
  'nome.pergunta': { padrao: 'Teu nome?', tipo: 'fala' },
  'nome.dica': { padrao: 'Teu nome…', tipo: 'dica' },
  'nome.erro': { padrao: 'Escreve teu nome.', tipo: 'erro' },

  // endereço e CEP
  'endereco.pergunta': { padrao: 'Onde entrega? Manda o CEP que o endereço se completa.', tipo: 'fala', marcadores: ['nome'] },
  'endereco.semCep': { padrao: 'Sem CEP', tipo: 'botao' },
  'endereco.dica': { padrao: 'CEP (só números)', tipo: 'dica' },
  'endereco.erro': { padrao: 'O CEP tem 8 números.', tipo: 'erro' },
  'cep.procurando': { padrao: 'Procurando o CEP…', tipo: 'fala' },
  'cep.naoAchei': { padrao: 'Não achei esse CEP. Confere os números ou segue sem CEP.', tipo: 'fala' },
  'cep.foraDoAr': { padrao: 'O serviço de CEP não respondeu agora. Dá pra digitar o endereço.', tipo: 'fala' },
  'cep.outroEstado': { padrao: 'Esse CEP é de {cidade}/{uf}. O atendimento escolhido é o de {ufAtendimento}.', tipo: 'fala', marcadores: ['cidade', 'uf', 'ufAtendimento'] },
  'cep.trocar': { padrao: 'Trocar pra Green Cheese {uf}', tipo: 'botao', marcadores: ['uf'] },
  'cep.esseMesmo': { padrao: 'É esse mesmo', tipo: 'botao' },
  'cep.outro': { padrao: 'Outro CEP', tipo: 'botao' },
  'cep.digitar': { padrao: 'Digitar endereço', tipo: 'botao' },
  'numero.pergunta': { padrao: '{endereco} — {cidade}/{uf}. Número e complemento?', tipo: 'fala', marcadores: ['endereco', 'cidade', 'uf'] },
  'numero.dica': { padrao: 'Ex.: 120, apto 201', tipo: 'dica' },
  'numero.erro': { padrao: 'Manda o número (ou "s/n").', tipo: 'erro' },
  'rua.cepDaCidade': { padrao: 'Esse CEP é de {cidade} inteira. Manda rua, número e bairro.', tipo: 'fala', marcadores: ['cidade'] },
  'rua.pergunta': { padrao: 'Manda o endereço: rua, número e bairro.', tipo: 'fala' },
  'rua.dica': { padrao: 'Rua, número, bairro', tipo: 'dica' },
  'rua.erro': { padrao: 'Falta coisa: rua, número e bairro.', tipo: 'erro' },

  // pagamento e troco
  'pagamento.pergunta': { padrao: 'Como vai pagar?', tipo: 'fala', marcadores: ['nome'] },
  'troco.pergunta': { padrao: 'Troco pra quanto?', tipo: 'fala' },
  'troco.sem': { padrao: 'Sem troco', tipo: 'botao' },
  'troco.dica': { padrao: 'Ex.: 100', tipo: 'dica' },
  'troco.erro': { padrao: 'Só o valor, tipo 100 ou 50,00.', tipo: 'erro' },
  'troco.resposta': { padrao: 'Troco pra {valor}', tipo: 'resposta', marcadores: ['valor'] },

  // observação
  'obs.pergunta': { padrao: 'Alguma observação? Ponto de referência, portão, horário…', tipo: 'fala', marcadores: ['nome'] },
  'obs.sem': { padrao: 'Sem observação', tipo: 'botao' },
  'obs.dica': { padrao: 'Observação…', tipo: 'dica' },

  // resumo e o WhatsApp
  'resumo.pedido': { padrao: 'Pedido montado. Confere:', tipo: 'fala', marcadores: ['nome'] },
  'resumo.fechar': { padrao: 'Agora é só fechar no WhatsApp da loja. Vem no certo!', tipo: 'fala', marcadores: ['nome'] },
  'resumo.naoAbriu': { padrao: 'Não abriu? Toca de novo no botão, ou copia o texto e manda pro WhatsApp da loja: {numero}.', tipo: 'fala', marcadores: ['numero'] },
  'resumo.copiar': { padrao: 'Copiar texto', tipo: 'botao' },
  'resumo.prontoNoZap': { padrao: 'Mensagem pronta no WhatsApp. Quem aperta enviar é você.', tipo: 'fala' },
  'resumo.jaMandou': { padrao: 'Já mandou o pedido?', tipo: 'fala' },
  'resumo.marca': { padrao: 'Chegou? Marca {instagram} no story.', tipo: 'fala', marcadores: ['instagram'] },
  'resumo.mandei': { padrao: 'Mandei', tipo: 'botao' },
  'resumo.naoConsegui': { padrao: 'Não consegui', tipo: 'botao' },
  'resumo.mudarEndereco': { padrao: 'Mudar endereço', tipo: 'botao' },
  'resumo.mudarPagamento': { padrao: 'Mudar pagamento', tipo: 'botao' },
  'resumo.mudarObs': { padrao: 'Mudar obs.', tipo: 'botao' },
  'duvida.instagram': { padrao: 'Outra dúvida? Chama a {instagram} no Instagram', tipo: 'fala', marcadores: ['instagram'] },

  // cupom
  'cupom.vale': { padrao: 'Cupom {cupom} no pedido: desconto confirmado pela loja no WhatsApp.', tipo: 'fala', marcadores: ['cupom'] },
  'cupom.naoVale': { padrao: 'O cupom {cupom} não vale pra esse pedido ({motivo}). Vai sem cupom?', tipo: 'fala', marcadores: ['cupom', 'motivo'] },
  'cupom.sugerir': { padrao: 'Tu tem o cupom {cupom} ({premio}). Usa nesse pedido?', tipo: 'fala', marcadores: ['cupom', 'premio'] },
  'cupom.usar': { padrao: 'Usar cupom', tipo: 'botao' },
  'cupom.sem': { padrao: 'Sem cupom', tipo: 'botao' },
  'cupom.tirar': { padrao: 'Tirar cupom', tipo: 'botao' },

  // Pix no site (em breve)
  'pix.comPix': { padrao: 'O Pix direto no site chega em breve. Por enquanto, fecha no WhatsApp: a loja te passa a chave Pix lá.', tipo: 'fala' },
  'pix.outroPagamento': { padrao: 'O Pix direto no site chega em breve. Quer pagar com Pix? Troca o pagamento aqui e fecha no WhatsApp: a loja te passa a chave lá.', tipo: 'fala' },
  'pix.trocar': { padrao: 'Trocar pra Pix', tipo: 'botao' },
  'pix.trocou': { padrao: 'Pronto, pagamento no Pix. Agora fecha no WhatsApp: a chave vem lá.', tipo: 'fala' },

  // encomenda
  'enc.produto': { padrao: 'Não achou? A Green Cheese importa. Qual produto você quer?', tipo: 'fala' },
  'enc.produto.dica': { padrao: 'Ex.: Fanta de uva japonesa', tipo: 'dica' },
  'enc.produto.erro': { padrao: 'Escreve o produto.', tipo: 'erro' },
  'enc.produto.proibido': { padrao: 'Esse a Green Cheese não traz: a Anvisa não deixa vender pela internet.', tipo: 'erro' },
  'enc.qtd': { padrao: 'Quantas unidades?', tipo: 'fala' },
  'enc.qtd.dica': { padrao: 'Outra quantidade…', tipo: 'dica' },
  'enc.qtd.erro': { padrao: 'Quantas?', tipo: 'erro' },
  'enc.ref': { padrao: 'Tem link ou descrição? Marca, sabor, tamanho… pode colar o link.', tipo: 'fala' },
  'enc.ref.pular': { padrao: 'Pular', tipo: 'botao' },
  'enc.ref.dica': { padrao: 'Link ou descrição…', tipo: 'dica' },
  'enc.ref.sem': { padrao: 'Sem link', tipo: 'resposta' },
  'enc.resumo': { padrao: 'Encomenda montada. Confere:', tipo: 'fala', marcadores: ['nome'] },
  'enc.mudarProduto': { padrao: 'Mudar produto', tipo: 'botao' },
  'enc.mudarQtd': { padrao: 'Mudar quantidade', tipo: 'botao' },
  'enc.mudarNome': { padrao: 'Mudar nome', tipo: 'botao' },
} as const satisfies Record<string, DefTexto>

export type ChaveTexto = keyof typeof TEXTOS_PEDIDO

/** Marcadores que valem numa fala ([] = nenhum). */
export function marcadoresDe(chave: ChaveTexto): readonly string[] {
  const d: DefTexto = TEXTOS_PEDIDO[chave]
  return d.marcadores ?? []
}

/** Pedaços da fala: texto solto e marcadores com o valor da hora (a tela decide como desenhar cada marcador). */
export type Pedaco = { texto: string } | { marcador: string; valor: string }

// um "@" logo antes do {instagram} não dobra (o valor já vem com ele)
const MARCADOR = /@?\{([a-zA-Z]+)\}/g

export function pedacosDaFala(texto: string, valores: Record<string, string | null | undefined>): Pedaco[] {
  const out: Pedaco[] = []
  let ultimo = 0
  for (const m of texto.matchAll(MARCADOR)) {
    const nome = m[1]
    const i = m.index ?? 0
    // o "@" só some antes do {instagram}; antes de outro marcador, ele fica no texto
    const inicio = m[0].startsWith('@') && nome !== 'instagram' ? i + 1 : i
    if (inicio > ultimo) out.push({ texto: texto.slice(ultimo, inicio) })
    out.push({ marcador: nome, valor: valores[nome] ?? '' })
    ultimo = i + m[0].length
  }
  if (ultimo < texto.length) out.push({ texto: texto.slice(ultimo) })
  return out
}

/** A fala com os marcadores trocados pelos valores (texto puro). */
export function preencher(texto: string, valores: Record<string, string | null | undefined>): string {
  return pedacosDaFala(texto, valores)
    .map((p) => ('texto' in p ? p.texto : p.valor))
    .join('')
}

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** O texto como o servidor guarda: espaços juntados, sem quebra de linha nem caractere invisível. */
export function limparFala(texto: string): string {
  return texto
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Confere uma fala nova do jeito do servidor (gc_texto_pedido_conferir): tamanho do tipo, só os marcadores daquela
 * fala, nenhuma chave sobrando e nada de promessa. Tabaco o painel confere à parte (a lista mora em proibidos.ts).
 * null = pode salvar; senão, a frase pra mostrar.
 */
export function problemaDaFala(chave: ChaveTexto, bruto: string): string | null {
  const d: DefTexto = TEXTOS_PEDIDO[chave]
  const t = limparFala(bruto)
  if (!t) return 'Escreve alguma coisa (ou volta ao padrão).'
  const max = MAXIMO_TEXTO[d.tipo]
  if ([...t].length > max) return `Até ${max} letras aqui.`
  const validos = d.marcadores ?? []
  for (const m of t.matchAll(/\{([^{}]*)\}/g)) {
    if (!validos.includes(m[1])) {
      return `{${m[1]}} não existe aqui. ${validos.length ? `Dá pra usar: ${validos.map((v) => `{${v}}`).join(', ')}.` : 'Essa fala não tem marcador.'}`
    }
  }
  if (/[{}]/.test(t.replace(/\{[^{}]*\}/g, ''))) return 'Sobrou uma chave { ou }: os marcadores vão assim, {nome}.'
  const s = ` ${semAcento(t).replace(/[^a-z0-9]+/g, ' ').trim()} `
  const promessa = PROMESSAS.find((p) => s.includes(` ${p} `))
  if (promessa) return `Sem promessa de prazo ou frete ("${promessa}"): a loja combina isso no WhatsApp.`
  return null
}
