# PUBLICAR — roteiro para uma sessão nova com o conector da Hostinger

Este roteiro é para uma sessão do Claude Code (ou uma pessoa) que vai publicar a `greencheese-v2/` em
**https://greencheese.oprojeto.online/** usando o conector da Hostinger. Siga na ordem. Não pule o ensaio nem a
conferência. Para publicar à mão pelo hPanel, sem o conector, veja o LEIA-ME, "Publicar à mão (hPanel)".

## O que vai pro ar e onde

| O quê | Onde |
|---|---|
| A versão nova (site, painel e servidor PHP) | a branch `claude/keen-ride-4epxve`, pasta `greencheese-v2/` |
| Pasta no servidor | `/home/u785231359/domains/oprojeto.online/public_html/greencheese/` |
| Endereço | `greencheese.oprojeto.online` (subdomínio com SSL, raiz = a pasta acima) |
| Endereço antigo | `oprojeto.online/greencheese/` → o `.htaccess` novo manda pro novo (301 em GET/HEAD, 410 no resto) |
| Conta da hospedagem | usuário `u785231359`, site `oprojeto.online` |

## Regras que nunca quebram

1. **Só se escreve dentro de `public_html/greencheese/`.** O resto do `oprojeto.online` (e o subdomínio
   `atendimento.oprojeto.online`) é de outros projetos: não liste para mexer, não suba, não apague.
2. **Nunca use** `deploy-static-site-archive`, importar arquivo/zip como site, nem nada que substitua a pasta inteira:
   apagaria o banco e as fotos. O caminho é o `scripts/publicar.mjs`, que só manda arquivo por arquivo.
3. **Nada de apagar no servidor.** O envio só cria ou troca arquivos; os de antes ficam (os `assets/` têm hash no nome).
4. **O banco, o log e as fotos nunca sobem**: `api/privado/` (`loja.sqlite`, `-wal`, `-shm`, `erros.log`) e
   `uploads/` (só o `.htaccess` de cada um sobe). O `publicar.mjs` já garante; o ensaio confere.
5. **O código de instalação do servidor fica como está**: `api/instalacao.php` **não** sobe (o do build é o de
   desenvolvimento, e o servidor recusaria o painel). Por isso se publica de uma cópia do build sem esse arquivo.
6. **Credenciais da Hostinger** (url e as duas chaves do upload) só em variável de ambiente, na hora. Nunca em
   arquivo do repositório, nunca no chat, nunca em commit. Valem por pouco tempo.
7. **Antes de publicar, o Ian dá o ok** e confirma que baixou a cópia de segurança do banco (painel → Mais → toque no
   nome do dono → "Baixar cópia de segurança"). Sem isso, pare e pergunte.

## Passo a passo

### 1. Preparar

```bash
cd /home/user/multfiscal-releases            # ou onde o repositório estiver
git fetch origin claude/keen-ride-4epxve && git checkout claude/keen-ride-4epxve && git pull
cd greencheese-v2
npm ci                                       # só aqui, na pasta principal (nunca numa worktree)
```

### 2. Build e testes rápidos

```bash
npm run build
node scripts/testar-htaccess.mjs dist        # tem de terminar em "htaccess ok"
node scripts/conferir-mensagem.mjs           # "mensagem ok"
```

Se der tempo, as baterias completas estão no LEIA-ME (testar-api, testar-painel, celulares, revisao).

### 3. A cópia do build que vai pro ar (sem o código de instalação)

```bash
PUB=$(mktemp -d)/pub && cp -a dist "$PUB" && rm "$PUB/api/instalacao.php"
ls "$PUB/api/instalacao.php" 2>/dev/null && echo "ERRO: o arquivo ainda está lá"
git checkout -- dist && git clean -fdq dist  # o dist/ é versionado: devolve como estava
```

Confira pelo conector que o servidor **já tem** o `api/instalacao.php` dele (se não tiver, pare: o painel do ar
depende dele):
`hosting_files_list-website-and-directories` com `username: u785231359`, `domain: greencheese.oprojeto.online`,
`directory: api`, `max_depth: 1`.

### 4. Saber pra onde voltar

Desde 14/10 (21h59, horário de Brasília), o que está no ar é a `greencheese-v2/` do commit `263a4ad`, com o pedido
rápido (os 130 arquivos do ar conferidos um a um com a cópia publicada; o banco subiu sozinho para as migrações 105 e
209). Se a próxima publicação der errado, voltar é publicar de novo esse commit, do mesmo jeito (build dele, cópia sem
o `api/instalacao.php`, ensaio e envio). Antes dele, estiveram no ar o `a3d7372` (14/10, 13h44, a v2 sem o pedido
rápido) e a pasta `greencheese/` do repositório (commit `f30c143`). A cada publicação, troque o hash desta frase pelo do commit que ficou no ar (passo 9).

### 5. Ensaio (nada sobe)

```bash
PUBLICAR_SECO=1 PUBLICAR_DIST="$PUB" node scripts/publicar.mjs greencheese
```

Leia a lista inteira. Tem de valer tudo isto:
- todo caminho começa com `greencheese/`;
- nenhum `.sqlite`, `.log`, `-wal` ou `-shm`;
- de `api/privado/`, só `.htaccess` e `index.html`; de `uploads/`, só `.htaccess`;
- **não** aparece `api/instalacao.php`;
- a ordem é `.htaccess` primeiro e os `index.html` por último.

### 6. Publicar

Gere as credenciais com `hosting_files_generate-upload-url` (`username: u785231359`, `domain: oprojeto.online` — o
site principal; o script põe o `greencheese/` na frente de cada arquivo). Ponha a resposta só em variáveis:

```bash
export HOSTINGER_UPLOAD_URL='<url>' HOSTINGER_AUTH='<auth_key>' HOSTINGER_AUTH_REST='<rest_auth_key>'
PUBLICAR_DIST="$PUB" node scripts/publicar.mjs greencheese
unset HOSTINGER_UPLOAD_URL HOSTINGER_AUTH HOSTINGER_AUTH_REST
```

Tem de terminar em `publicado: N arquivos em /greencheese/`. Se cair no meio, rode de novo o mesmo comando (cada
envio troca o arquivo; repetir não estraga). Credencial vencida: gere outra.

### 7. Conferir no ar

```bash
B=https://greencheese.oprojeto.online
curl -s -o /dev/null -w "%{http_code}\n" $B/                                   # 200
curl -s $B/api/index.php?r=loja | head -c 300                                  # {"ok":true,... e a loja
curl -s -o /dev/null -w "%{http_code}\n" $B/api/privado/loja.sqlite            # 403
curl -s -o /dev/null -w "%{http_code}\n" $B/api/instalacao.php                 # 403
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" https://oprojeto.online/greencheese/   # 301 → o endereço novo
```

O primeiro acesso roda sozinho as migrações novas do banco (103 raridade dos prêmios, 104 material de 11/10 e as que
vierem depois, como a 105 do pedido mínimo e a 106, que devolve pro desenho do site os 4 produtos do material de 11/10).
Confira no `GET loja`: os prêmios do Teste minha sorte têm `raridade` e o Jack Daniel's Tennessee Apple e a Fanta Maçã
da China aparecem (só no RJ, sem preço). Depois da 106, nenhum produto aponta pra mídia de fábrica (`produtos/`), a não
ser que o dono tenha escolhido; foto e vídeo do dono (`uploads/`) continuam:

```bash
curl -s $B/api/index.php?r=loja | node -e 'let t="";process.stdin.on("data",d=>t+=d).on("end",()=>{const l=JSON.parse(t).loja;for(const id of ["fanta-ghost-face-punch","hennessy-very-special","jack-daniels-tennessee-apple","fanta-maca-china"]){const p=l.produtos.find(x=>x.id===id);console.log(id,p?.foto,p?.video??"-")}})'
# o certo: null - nos 4 (ou o caminho uploads/… que o dono pôs)
```

Peça ao Ian para abrir o painel → **Diagnóstico** (tudo tem de dar "fechado" e a lista de avisos vazia) e fazer um
pedido de teste pelo celular, pelo link da bio.

### 8. Se algo der errado

- **O site não abre ou o painel quebrou:** publique de novo a versão de antes (passo 4), com o mesmo cuidado (sem o
  `api/instalacao.php`). O banco continua bom: as migrações só acrescentam coluna e linha, e o código de antes ignora o
  que é novo. A 106 não volta com o código de antes: ela fica anotada e os 4 do material de 11/10 continuam no desenho
  (o site de antes mostra o que o banco diz). Pra pôr a foto de fábrica de novo num deles, é pelo painel (ou uma
  migração nova).
- **O banco estragou** (raro): no hPanel, apague `api/privado/loja.sqlite-wal` e `loja.sqlite-shm` e suba a cópia de
  segurança do Ian como `api/privado/loja.sqlite`.
- **O endereço antigo não redireciona:** confira se o `.htaccess` da pasta subiu (é o primeiro da lista).

### 9. Fechar

Conte ao Ian o que subiu (quantos arquivos e o hash do commit), o que as conferências deram, e o que ele precisa testar
no celular. Atualize a frase do passo 4 com o commit que ficou no ar.
Não deixe credencial em nenhum arquivo. Nada de commit com o build (`dist/` volta como estava).
