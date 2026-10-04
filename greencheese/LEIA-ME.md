# Green Cheese Imports — site (prévia)

Site único da Green Cheese para todos os estados: catálogo no formato dos stories da marca + pedido guiado que termina com a mensagem pronta no WhatsApp (ou na DM do Instagram) do atendimento certo. Estático, sem servidor, sem banco.

Prévia criada pela I&H Soluções Digitais.

---

## Rodar no computador

Precisa de Node 20 ou mais novo (testado com Node 22).

```bash
cd greencheese
npm install
npm run dev -- --host
```

O terminal mostra dois endereços:

- **Local**: `http://localhost:5173/` (no próprio computador);
- **Network**: `http://192.168.x.x:5173/` — abra esse no celular, na mesma rede Wi-Fi.

Para testar como o cliente chega pela bio de um perfil: `http://localhost:5173/?uf=mg` (ou `rj`, `sp`, `es`, `sc`).

## Gerar o site para publicar

```bash
npm run build
```

O site pronto fica na pasta `dist/`. Ele usa caminhos relativos: funciona em qualquer pasta ou subdomínio, sem regra de servidor.

Para conferir o build antes de subir: `npm run preview` e abra o endereço mostrado.

## Subir na Hostinger (oprojeto.online)

O pacote pronto está em `entrega/greencheese-dist.zip` (é a pasta `dist/` zipada).

1. Entre no **hPanel** da Hostinger → **Sites** → `oprojeto.online` → **Gerenciador de Arquivos**.
2. Abra `public_html/` e crie a pasta **`greencheese`** (o endereço vai ficar `https://oprojeto.online/greencheese/`).
   - Quer na raiz do domínio ou num subdomínio (`greencheese.oprojeto.online`)? Pode: é só subir os arquivos na pasta do subdomínio. Depois troque `urlPublica` em `src/dados/config.ts` e gere o build de novo (esse endereço é usado na imagem de compartilhamento e nos links da bio).
3. Dentro de `greencheese/`, use **Enviar** → escolha `greencheese-dist.zip` → clique com o botão direito no zip → **Extrair**. Confira que o `index.html` ficou direto dentro de `greencheese/` (e não numa subpasta `dist/`).
4. Apague o zip do servidor.
5. Abra `https://oprojeto.online/greencheese/` no celular.

Atualizou alguma coisa? `npm run build`, zipe o conteúdo de `dist/` de novo e repita os passos 3 e 4 (substituindo os arquivos).

> O SSL (https) da Hostinger precisa estar ativo no domínio: a detecção de estado, o CEP e o "copiar pedido" dependem de https.

### Link para a bio de cada perfil

Cada perfil põe na bio o link do próprio estado (é a forma mais confiável de mandar o cliente pro atendimento certo):

| Perfil | Link da bio |
|---|---|
| @greencheese_importsrj | `https://oprojeto.online/greencheese/?uf=rj&cidade=rio-de-janeiro` |
| @greencheese_importsmg | `https://oprojeto.online/greencheese/?uf=mg&cidade=teofilo-otoni` |
| @greencheese_importssp | `https://oprojeto.online/greencheese/?uf=sp` |
| @greencheese_importses | `https://oprojeto.online/greencheese/?uf=es` |
| @greencheese_importssc | `https://oprojeto.online/greencheese/?uf=sc` |

Link direto de um produto (para o adesivo de link do story): `https://oprojeto.online/greencheese/?uf=mg&p=jack-daniels-old-no7-1l` — o id de cada produto está no `catalogo.json`. No site, o botão de compartilhar do story já copia esse link.

Na prévia, o selo **prévia** (canto de cima no celular, barra lateral no computador) abre um painel com esses links e com tudo que ainda falta.

---

## Onde trocar cada coisa

Tudo que o dono muda fica em `src/dados/`. Depois de mexer, rode `npm run build` e suba de novo.

### Número de WhatsApp de cada estado — `src/dados/canais.ts`

Em cada estado, troque `whatsapp: null` pelo número com 55 + DDD + número, só dígitos:

```ts
whatsapp: '5533999998888',
```

Com número, o botão "Enviar no WhatsApp" abre a conversa direto com a loja. Sem número (`null`), o WhatsApp abre para a pessoa escolher o contato, e ao lado tem "Copiar pedido e abrir a DM do Instagram".

No mesmo arquivo: cidades atendidas (`cidades`), horário (`horario`), taxa de entrega (`taxaEntrega`), formas de pagamento (`pagamento`) e o "Sextou com entrega grátis!" de MG (`entregaGratis`). Quando trocar um valor de demonstração pelo real, mude também `demo: true` para `demo: false`.

Estado com mais de uma cidade: liste todas em `cidades` — o site pergunta a cidade.

### Produto, preço e disponibilidade — `src/dados/catalogo.json`

Cada produto:

```json
{
  "id": "jack-daniels-old-no7-1l",
  "nome": "Jack Daniel's Old No. 7",
  "tamanho": "1 L",
  "categoria": "destilados",
  "preco": 149.9,
  "disponivel": { "rj": true, "mg": true, "sp": true, "es": false, "sc": true },
  "demo": false,
  "foto": null
}
```

- **Preço**: número com ponto (`149.9`). Sem preço: `null` → aparece "Consultar" (nunca inventar).
- **Combo** (ex.: 2 por R$ 14,99): `"combos": [{ "qtd": 2, "total": 14.99 }, { "qtd": 3, "total": 19.99 }]` — a sacola aplica o melhor preço sozinha.
- **Variações** (ex.: piteira flat/slim): `"variacoes": [{ "id": "flat", "nome": "Flat · 6 mm × 3,5 cm" }]`.
- **Disponível/indisponível**: `true`/`false` por estado. Indisponível continua aparecendo, em cinza, com "Avisar quando chegar".
- **Produto novo**: copie um bloco parecido, troque o `id` (sem espaço e sem acento) e os dados. A arte em pixel vem de `arte` (tipo e cores) até ter foto.
- **`demo: true`** = produto de exemplo. Ele só aparece na prévia; com `modoPrevia: false` some do site.

### Foto dos produtos

1. Ponha os prints/fotos em `referencias/` e liste em `scripts/recortes.json` qual arquivo é de qual produto.
2. `npm run recortar` → as fotos saem em `public/produtos/*.webp` e o catálogo passa a usar.

A foto passa pelo mesmo tratamento em dither do resto do site.

### Disponibilidade pelo celular (opcional) — planilha do Google

Crie uma planilha com as colunas `id, preco, rj, mg, sp, es, sc` (disponível = `sim`/`não`), publique em **Arquivo → Compartilhar → Publicar na Web → CSV** e cole o link em `planilhaCsvUrl` no `src/dados/config.ts`. O site lê a planilha toda vez que abre; se ela falhar, usa o `catalogo.json`.

### Tirar do modo prévia — `src/dados/config.ts`

`modoPrevia: false` tira o selo "prévia", o crédito da I&H no rodapé, as marcas "demo"/"exemplo", os produtos de exemplo e o `noindex` (o Google passa a poder indexar).

### Outras peças

- Logo: `src/arte/Logo.tsx` (SVG). Favicon: `public/favicon.svg`.
- Imagem de compartilhamento (WhatsApp/Instagram): `npm run og` com o `npm run dev` rodando → `public/og.png` e `public/apple-touch-icon.png`.
- Revisão por screenshots: `npm run revisao` com o dev rodando → `revisao/<rodada>/`.

## O que o site faz

- Abertura em formato de story com a pergunta +18 (lembrada por 30 dias) e o adesivo de localização.
- Estado do cliente nesta ordem: link da bio (`?uf=`), escolha salva, palpite pelo IP (sempre pergunta "É daí?"), escolha manual com os 27 estados.
- Catálogo por estado com disponível/indisponível, categorias como destaques, busca, "Só DISPONÍVEL ✅".
- Story do produto com barrinhas, toque nas laterais, segurar para pausar, arrastar para baixo para fechar, setas e Esc no teclado.
- Sacola com combo automático, pedido guiado em formato de DM (CEP preenche o endereço), mensagem pronta para o WhatsApp do estado ou para a DM.
- Encomenda ("Não achou? A Green Cheese importa."), "Avisar quando chegar", todos os Instagrams, mapa em blocos.
- Sacola e respostas ficam salvas no aparelho; o botão voltar do Android fecha a camada aberta.

Derivados do tabaco não entram no site (Anvisa, RDC 840/2023, art. 6º).
