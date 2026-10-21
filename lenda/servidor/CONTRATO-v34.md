# LENDA · CONTRATO v3.4 (conquistas provadas, desafios de emblema, prévia de link e SEO)

Continua o CONTRATO.md, o CONTRATO-v3.md, o CONTRATO-v32.md e o CONTRATO-v33.md (tudo de lá vale; aqui só o que é novo
ou muda). Cada seção é escrita por quem implementou; toda diferença em relação ao contrato da rodada fica registrada na
seção de quem mudou.

## §A Servidor

Implementado: o lado do servidor dos pedidos (2) conquistas provadas, (4) desafios de emblema e (5a) prévia de link, e o
recálculo das contas no `instalar.php`. Tudo como na v3.3: erro `{"erro","mensagem"}` em pt-BR, JSON `no-store` salvo onde
dito, paginado `{total, pagina, porPagina: 50, itens}`, datas ISO UTC (`em` de emblema com milésimos), IP nunca gravado. A
A.0 é a interface que o jogo e o painel usam (escrita no começo da rodada; o que mudou depois está marcado "a mais").

### A.0 Interface (rotas, campos e ações novas)

Até o `instalar.php` da v3.4 rodar (`_esquema` 33), nada novo aparece e nada quebra (os campos novos simplesmente não vêm).

**Conquistas provadas.** O servidor lê a lista de conquistas da carreira de `HallEntry.career.achievements` (o que o motor
gravou; nada novo é preciso no HallEntry) e só a guarda (`carreiras.conquistas`) quando a carreira é **prova**: Clássico, com
replay, semente sorteada pelo servidor para a conta (`semente_em`), sem `fora_desafio`, sem suspeita (a `revisao` vale) e sem
"não bateu" na verificação (`prova_ok = 0`). Só ids das 87 entram. Provadas da conta = união das carreiras-prova;
`conquistas_usuario` ganha `prova_pk` (a carreira que prova: a verificada, senão a mais antiga), `provada_em` e `origem`
(`aparelho` | `carreira`); nada some (a que deixa de ter prova volta a "não provada"; a provada que o aparelho nunca mandou
entra com `origem = carreira`).
- `GET conquistas.php` e o `POST sincronizar` → `{conquistas: [{id, em, provada, verificada, carreira: <HallEntry.id> | null}],
  provadas, verificadas, naoProvadas, total: 87}` (as contagens só com as 87).
- `POST carreiras.php {acao:"salvar"}` responde também `provasNovas: [ids que esta carreira provou agora]` e
  `emblemasNovos: [{slug, titulo, icone, cor, dificuldade}]`. `C` (lista e salvar) ganha `prova: {conquistas, unicas,
  verificada: true|false|null} | null` (`unicas` = quantas só ela prova: apagar a carreira tira a prova delas).
- Admin (`moderar`): `POST {acao:"prova_verificar", resultados: [{carreira: <carreiras.id>, ok, detalhes? (até 8 KB)}]
  (1 a 50)}` → `{ok, carreiras: [{pk, provaOk}], pulados: [{carreira, motivo: nao_encontrada | sem_prova}], contas:
  {<uid>: {provadas, verificadas, total}}}`. `ok:false` tira a carreira das provas e retira os emblemas que ela deu.
  Salvar a carreira com outro conteúdo zera a verificação dela.
- Admin `GET ?r=provas&usuario=<id>` (ver) → `{usuario: {id, apelido, status}, conquistas: {total, provadas, verificadas,
  naoProvadas, faltamProvar: [ids], faltamVerificar: [ids]}, carreiras: [{pk, carreiraId, jogador, primeiraEm, conquistas:
  [ids], unicas: [ids], essencial, vale, motivo, provaOk, verificacao, links: {resumo, verificar}}], links: {lote:
  "/lenda/#/verificar?conta=<id>"}}` (`essencial` = está num conjunto mínimo de carreiras que cobre as provadas; o lote
  pode verificar só essas). `?r=carreira` ganha `meta.conquistas` (a lista guardada ou null), `meta.prova`,
  `meta.provaOk`, `meta.provaVerificacao` e, a mais, `meta.conquistasV` (a versão das regras: `HallEntry.conquistas.v` do
  jogo da v3.4, 1 sem ele), `meta.champions`, `meta.nClubes`, `meta.mesmoClube`, `meta.copasSelecao` e `meta.paisInicio`
  (os números dos critérios novos que o servidor tirou do HallEntry; a `#/verificar` compara com os refeitos). Os itens
  do `?r=provas` levam `conquistasV` também. `?r=usuario` ganha `conquistasProva: {provadas, verificadas, naoProvadas,
  total}`, `emblemas` e, em cada item de `conquistas`, `provada`, `verificada`, `provaPk`.
- **Todas as conquistas** (§E da v3.3 trocado pela prova): pode ser ativado. Candidato = conta com as 87 **provadas**
  (as do aparelho não contam). `candidato_verificar {ok:true}` só passa com as 87 provadas por carreiras **verificadas**
  (senão `409 sem_prova` com `faltam: [ids]`); quando o `prova_verificar` completa as 87 verificadas, o candidato pendente
  vira `verificada` sozinho. Declarar pede o mesmo. `?eu=1`: `conquistas` = provadas, `conquistasVerificadas`,
  `conquistasTodas` (com as não provadas), `conquistasTotal`. `K.links.verificar` desse candidato =
  `/lenda/#/verificar?conta=<uid>&candidato=<id>`.

**Desafios de emblema.** `desafios.modo` = `primeiro` (o de antes: um vencedor, prêmio) | `emblema` (todo mundo que cumprir
ganha o emblema, na hora, sem verificação; o admin pode retirar). Colunas novas: `modo`, `dificuldade` (`facil | medio |
dificil | lendario` | null), `emblema` (`{icone, cor}`), `home` (vai na faixa da tela inicial).
- Critério (os dois modos): `copas`, `libertadores`, `champions`, `bolasOuro`, `copasPelaSelecao` (1 a 30), `titulos`
  (1 a 500), `gols` (1 a 5.000), `nota` (1 a 100; só nota da versão atual), `clubes` (1 a 40), `temporadasMesmoClube`
  (1 a 30), `nacionalidade` (lista de códigos: a seleção da criação, `replay.identity.nationality`, igual à do fim e na
  lista), ou `{todasConquistas: true}` sozinho. Tudo `>=`, tirado do HallEntry guardado.
- Emblema: carreira-prova (como acima) que cumpre o critério; qualquer carreira provada vale, também as de antes do
  desafio existir (não é corrida), menos as que entraram na conta depois do `fim`. Requisitos de conta valem (os de
  fábrica: nenhum). Um por conta e desafio (`emblemas_usuario`, `UNIQUE(usuario_id, desafio_id)`); retirado não volta
  sozinho.
- `GET desafios.php` → cada desafio ganha `modo`, `dificuldade`, `emblema: {icone, cor} | null`, `home`, `ganharam` (contas
  ativas com o emblema). `?eu=1` → no de emblema, `eu.emblema: {estado: ativo | retirado, em, carreiraId, jogador, motivo} |
  null` e `eu.carreirasQueCumprem` com os motivos de carreira; e no topo `emblemas: [{slug, titulo, icone, cor, dificuldade,
  em, carreiraId, jogador}]` (os da conta, ativos, também de desafio já desligado).
- `perfil.php` ganha `emblemas: [{slug, titulo, icone, cor, dificuldade}]` e `conquistasProvadas`; os itens do `hall.php` e o
  `hall.php?id=` ganham `emblemas: [{slug, icone, cor}]` (até 3, os mais difíceis) e `emblemasTotal`.
- Admin: `D` ganha `modo`, `dificuldade`, `emblema`, `home`, `emblemas: {ativos, retirados}`; `?r=desafio&id=` de emblema
  traz `emblemas` (paginado de `E = {id, estado, em, motivo, retiradoEm, quem, usuario: {id, apelido, status}, carreira:
  {pk, carreiraId, jogador, existe} | null, links | null}`; filtro `estado=ativo|retirado`). `desafio_salvar` aceita
  `modo` (só enquanto ninguém ganhou nem é candidato: senão `409 modo_travado`), `dificuldade`, `emblema`, `home` (erros
  `400 modo | dificuldade | emblema | home`). No de emblema, declarar/reabrir → `409 emblema`. Ações novas (`moderar`):
  `emblema_retirar {id, motivo}` → `{ok, emblema: E}` (`409 ja_retirado`) e `emblema_devolver {id}` → `{ok, emblema: E}`
  (`409 ja_ativo`).
- Ações novas no registro (o painel precisa do nome em pt-BR): `prova_verificar`, `emblema_retirar`, `emblema_devolver`.
- Semeados pelo `instalar.php` (uma vez só; o que o admin mudar ou desligar nunca é mexido): os 10 de
  `v34-desafios-emblema.json`, **ativos**, `modo = emblema`, requisitos `{partidasMin: 0, emailVerificado: false,
  publicadoNoHall: false, top3Perfil: false}`, `home` nos 3 da faixa (noite-de-gala, hexa-e-gloria-eterna,
  tacas-do-rei-emblema). Os 3 da v3.3 continuam desativados.

**Prévia de link** (`api/v.php`, público, HTML): `?id=<HallEntry.id>[&c=<código de quem compartilha>]` (carreira do Hall
público) e `?c=<código>` (perfil) → página com Open Graph/Twitter (`summary_large_image`) e `meta refresh` para
`/lenda/?c=<código>#/resumo?id=<id>&de=comunidade` (ou `#/jogador/<código>`); `&png=1` → a imagem PNG 1200×630 (GD,
cacheada fora do public_html). Carreira fora do Hall, perfil fechado ou inexistente: a prévia genérica do LENDA (200), sem
dado nenhum. O botão de compartilhar do jogo usa `https://oprojeto.online/lenda/api/v.php?id=…&c=…`.

### A.1 Arquivos

- Novos: `api/_provas.php` (carreira-prova, `recalcularProvas`, `?r=provas`, `prova_verificar`, a promoção do candidato
  de todas as conquistas), `api/v.php` (a rota da prévia), `api/_previa.php` (dados, textos, HTML e a imagem GD, a pasta
  de cache), as fontes `api/_fonte-barlow-condensed-500.ttf` e `-700.ttf` (Barlow Condensed, subconjunto latino, convertidas
  de `@fontsource/barlow-condensed` de woff para ttf) com a licença `api/_fonte-OFL.txt` (SIL OFL 1.1), e
  `teste/teste-v34.php` (incluído pelo `teste.php`).
- Mudados: `_schema.sql`, `instalar.php`, `_lib.php` (`LENDA_ESQUEMA = 34`, `esquemaV34()`), `_carreiras.php` (as 87
  `CONQUISTAS_IDS` mudaram para cá; `extrairCampos` tira os números novos, a lista de conquistas e a versão das regras),
  `_desafios.php` (critérios novos, modo emblema, concessão, semeadura, o de todas as conquistas pela prova, rotas novas do
  admin), `carreiras.php`, `conquistas.php`, `desafios.php` (sem mudança de código: o formato vem do `_desafios.php`),
  `perfil.php`, `hall.php`, `admin.php`, `_admin.php` (`PODERES_ACAO`), `_contas.php` (LGPD), `_copias.php` (backup),
  `.htaccess` (só os comentários: o `v.php` passa pelas regras de sempre; as fontes e a licença começam com `_` e ficam
  negadas), `privacidade.html`, `LEIAME.md` (§5e e o teste).
- Testes antigos, só o que o contrato mudou: `_esquema` 33 → 34 (`teste-v32-mod.php`, `teste-v33.php`); `CAMPOS_C` ganha
  `prova` e `CAMPOS_ITEM_HALL` ganha `emblemas` e `emblemasTotal` (`teste.php`, `teste-v3.php`); os itens de
  `conquistas.php` comparados só por `id`/`em` (`teste-v3.php`); `gols` virou critério válido (o caso de critério
  desconhecido do `teste-v33.php` passou a `assistencias`); o desafio de todas as conquistas ativa e só conta as provadas
  (`teste-v33.php` e o §E.7 do `teste-v33-corr.php`, reescritos para a regra nova); o `conferirResposta` do `teste.php` deixa
  o `v.php` fora da conferência de JSON (ele é HTML/PNG; o `teste-v34.php` confere os cabeçalhos dele).

### A.2 Banco (instalar.php)

Uma coluna/índice por linha, coluna nova `NULL` ou com `DEFAULT`, sem `FOREIGN KEY`/`CHECK`; só acrescenta e é idempotente
(de novo: `alteracoes: []`, `v34` tudo 0).

- `carreiras`: `champions`, `n_clubes`, `mesmo_clube` (o clube com mais temporadas, somadas como o resumo junta as
  passagens), `copas_selecao` (as Copas em `summary.national.trophies` com `teamId` = a seleção da criação), `pais_inicio`
  (`replay.identity.nationality`; NULL sem replay), `conquistas` (JSON da lista, só na carreira-prova), `conquistas_v`,
  `prova_ok` (NULL = não verificada, 1 = bateu, 0 = não bateu) e `prova_verificacao` (`{ok, detalhes, motivo, em, quem}`).
- `conquistas_usuario`: `prova_pk`, `provada_em`, `origem` (`aparelho` por padrão: as linhas de antes ficam todas
  "aparelho") e o índice `ix_conquistas_prova`.
- `desafios`: `modo` (`primeiro` por padrão), `dificuldade`, `emblema` (JSON `{icone, cor}`), `home`.
- `emblemas_usuario(id, usuario_id, desafio_id, carreira_pk NULL, carreira_id, jogador, em DATETIME(3), estado
  ativo|retirado, motivo, retirado_em, quem, UNIQUE(usuario_id, desafio_id))` — a carreira e o jogador ficam como foto.
- Depois do schema e do `_esquema = 34`, no orçamento de ~20 s de sempre: (1) os números novos e a lista das carreiras
  guardadas (`champions IS NULL` = ainda não feita; conta em `faltam`); (2) os 10 de emblema, **uma vez só** (a marca
  `_v34_emblemas` em `site_config`); (3) **uma vez** (marca `_v34_recalculo`, que retoma pelo id da conta se o tempo
  acabar), `recalcularProvas` de cada conta com carreira-prova; (4) **uma vez** (marca `_v34_emblemas_lote`), o lote de cada
  desafio de emblema valendo. `faltam` conta também o recálculo e o lote ainda não terminados. A resposta ganha `"v34":
  {carreiras, desafios, contas, provas, emblemas}`.
- **As 2 contas reais:** o que dá para provar fica provado (as carreiras delas salvas depois do deploy da semente do
  servidor, com replay); o resto continua na conta, "não provado". Nenhuma linha de `conquistas_usuario` é apagada nem tem
  a data mudada (o `recalcularProvas` só mexe em `prova_pk`/`provada_em` e insere a provada que faltava).
- Até o instalar rodar (`_esquema` 33): o salvar não grava nada novo nem responde `provasNovas`; `conquistas.php` responde
  como na v3.3; nada de emblema; `?r=provas`, `prova_verificar`, `emblema_*` e os campos novos do `desafio_salvar` → `503
  instalar`. Hall, perfil, desafios e o `v.php` funcionam.
- Backup (`_copias.php`): entra `emblemas_usuario` (substituível); as colunas novas vão junto com as tabelas de sempre.

### A.3 Conquistas provadas (pedido 2)

- **Carreira-prova** (`sqlCarreiraProva`, `motivoProva`): Clássico, `tem_replay`, `semente_em` (a semente do replay saiu do
  servidor para a conta — CONTRATO-v33 §E), sem `fora_desafio`, sem suspeita (menos `revisao`), `prova_ok` não 0. Motivos:
  `imersivo | sem_replay | sem_semente | limite_diario | suspeita | nao_bateu` (frases em `DESAFIO_MOTIVOS`).
- A lista é a de `HallEntry.career.achievements` (o motor grava; o replay a refaz), só ids das 87, sem repetir; guardada só
  quando a carreira tem replay e semente do servidor (uma suspeita guarda a lista, mas não prova enquanto for suspeita).
  `HallEntry.conquistas.v` (o jogo da v3.4) vira `conquistas_v`; a lista `ids` dele não é lida (a do motor é a que o
  replay confere).
- `recalcularProvas(uid)` — ao salvar e apagar carreira, ao liberar (`mostrar_carreira`, lote), apagar (admin) e
  restaurar uma carreira, no `prova_verificar` e no instalar: para cada conquista das carreiras-prova, `prova_pk` = a
  verificada (senão a que entrou primeiro na conta) e `provada_em` = quando a primeira prova entrou; a conquista provada
  que o aparelho nunca mandou entra (`origem = carreira`, `em` = o fim da carreira); a que perde a prova fica, sem prova.
  Uma escrita por conta de cada vez (trava na linha da conta, como o `sincronizar`).
- Salvar com outro conteúdo zera `prova_ok` (a verificação de antes não vale). A carreira apagada pelo dono deixa de provar
  (a conquista fica). `C.prova = {conquistas, unicas, verificada: true | null} | null` (o "não bateu" já não é prova:
  `null`).

### A.4 Verificação das provas (`prova_verificar`, `?r=provas`)

- `prova_verificar` (poder `moderar`; 1 a 50 resultados; detalhes até 8 KB): carreira que não existe → `pulados`
  `nao_encontrada`; sem lista ou sem replay → `sem_prova`. `ok:false` → `prova_ok = 0` (o motivo vem de
  `detalhes.motivo`, até 200, ou "Não bateu na verificação por replay.") e os emblemas ativos que ela deu são retirados com
  esse motivo. Depois, por conta: `recalcularProvas`, `avaliarDesafiosConta` e a promoção do candidato de todas as
  conquistas. Registro: `prova_verificar` (alvo `usuario:<id>`, ou `provas` com várias contas; `{usuario, carreiras, ok,
  naoBateu, pulados}`, nunca os detalhes).
- `?r=provas` (poder `ver`): todas as carreiras da conta com lista guardada (também as que não valem, com o `motivo` e o
  `motivoTexto`), a mais antiga primeiro. `essencial`: cobertura gulosa das provadas (a que cobre mais das que faltam; no
  empate a verificada). Links: `verificar = /lenda/#/verificar?id=<pk>&prova=1`, `lote = /lenda/#/verificar?conta=<id>`.

### A.5 Todas as conquistas pela prova (o §E.7 da v3.3 trocado)

- Ativar e salvar um ativo com `{todasConquistas: true}` voltam a valer (o `409 sem_prova` dessas duas só existe com o banco
  de antes da v3.4).
- Conta (`conquistasDoDesafio`) = as 87 **provadas**. No lote ao ativar, o `em` real é o maior entre a hora em que a 87ª
  ganhou prova (`emTodasProvadas`), a confirmação do e-mail (quando pedida) e o início. Perdeu uma prova (carreira apagada,
  "não bateu") → `conquistas` é motivo de carreira: o candidato é recusado pelo sistema e volta a pendente quando a conta
  completar de novo.
- `candidato_verificar {ok:true}` e o declarar: `409 sem_prova` com `faltam` (as que não têm prova verificada) enquanto as
  87 não estiverem provadas por carreiras verificadas. `promoverCandidatosConquistas`: quando o `prova_verificar` completa as
  87 verificadas, o candidato pendente (de desafio sem vencedor) vira `verificada` com `verificacao = {ok: true,
  detalhes: {v: 1, provas: true, carreiras: [pks]}, em, quem}` (quem = o admin que verificou). Recusar continua valendo.
- O regulamento guardado do `todas-as-conquistas` de fábrica é o de antes (o instalar não mexe no que existe): o novo de
  partida (`regulamentoPadrao`) fala das conquistas provadas; o admin troca o texto no painel antes de ativar.

### A.6 Desafios de emblema (pedido 4)

- `modo = emblema`: `avaliarDesafiosConta` junta os de emblema valendo e chama `concederEmblemas` (uma consulta das
  carreiras-prova da conta, só se faltar algum emblema): para cada desafio sem emblema da conta, requisitos da conta
  (`motivoContaDesafio`) e a primeira carreira-prova (a que entrou primeiro) que cumpre o critério e não entrou depois do
  `fim` (`motivoCarreiraEmblema`) → `INSERT IGNORE` (só se o desafio ainda está ativo e é de emblema). Idempotente (a chave
  única), também com pedidos ao mesmo tempo; o retirado não volta sozinho. No de todas as conquistas de emblema (permitido,
  não semeado): as 87 provadas, sem carreira.
- `em` = agora; no lote (ativar, salvar um ativo, instalar) = a hora em que a carreira entrou na conta (a hora real).
- Não é corrida: carreira de antes do começo (ou de antes de o desafio existir) vale; o `inicio` só diz desde quando o
  desafio está valendo. Sem candidatos, sem vencedor, sem verificação antes de dar: declarar e reabrir → `409 emblema`.
- Retirado sozinho: carreira com "não bateu" no `prova_verificar` e carreira apagada pela moderação (`apagar_carreira`:
  "A carreira foi apagada pela moderação."). Conta suspensa não ganha (e o emblema dela some do público com ela: perfil 404,
  fora do Hall). Apagar a própria carreira não tira o emblema.
- Os 10 de fábrica (§K.4, `v34-desafios-emblema.json`, em `desafiosEmblemaDeFabrica()` no código — o JSON fica fora do
  repositório): ativos, `inicio` = a hora do instalar, prêmio vazio, requisitos `{partidasMin: 0, emailVerificado: false,
  publicadoNoHall: false, top3Perfil: false}` (`requisitosEmblema`), `dificuldade`, `emblema`, `ordem` 10–100 e `home` em
  noite-de-gala, hexa-e-gloria-eterna e tacas-do-rei-emblema; o regulamento de partida de emblema com a frase da chance da
  calibração ("sai em cerca de 1 de cada 12 carreiras de quem joga para isso e em 1 de cada 24 de quem escolhe ao acaso").
  As Taças do Rei de emblema (`tacas-do-rei-emblema`, lendário) é um deles; o `tacas-do-rei` de prêmio continua desativado.

### A.7 Critérios novos (os dois modos)

| Chave | De onde (HallEntry guardado) | Coluna |
|---|---|---|
| `copas`, `libertadores` | como na v3.3 | `copas`, `libertadores` |
| `champions` | `summary.trophies[trophyId=champions-league].count` | `champions` |
| `bolasOuro` | `summary.awards[award=ballon_dor].count` | `bolas_ouro` |
| `titulos` | soma de `summary.trophies[].count` | `titulos` |
| `gols` | `summary.totals.goals` ("mais de 1.000" = 1001) | `gols` |
| `nota` | `legacy.score` com `legacy.v` = a versão atual (2) | `nota`, `nota_v` |
| `clubes` | clubes diferentes de `summary.clubs` (até 40) | `n_clubes` |
| `temporadasMesmoClube` | o maior `summary.clubs[].seasons` (somado por clube) | `mesmo_clube` |
| `nacionalidade` | `replay.identity.nationality` na lista **e** igual a `identity.nationality` | `pais_inicio`, `pais` |
| `copasPelaSelecao` | `summary.national.trophies` com Copa do Mundo e `teamId` = a seleção da criação | `copas_selecao` |

`lerCriterio` confere tudo (`400 criterio`; `nacionalidade` = lista de 1 a 30 códigos `[A-Z]{2,4}`); critério com chave da
v3.4 num banco de antes → `503 instalar` no salvar e "ninguém cumpre" na avaliação (nunca um 500). O regulamento de partida
descreve o critério em palavras (`descreverCriterio`: "2 Champions League e 100 gols").

### A.8 O que o jogo lê

- `desafios.php` (público, 60 s) e `?eu=1`: como na A.0; o `?eu=1` de emblema traz `emblema` e `candidato: null`; o de
  todas as conquistas, `conquistas` (provadas), `conquistasVerificadas`, `conquistasTodas`, `conquistasTotal`. Os emblemas
  da conta (no topo do `?eu=1`, no perfil e no Hall) vêm os mais difíceis antes (lendário → fácil), depois os mais antigos;
  valem também os de desafio desligado (a conta ganhou).
- `perfil.php`: `emblemas`, `conquistasProvadas` e, a mais, os itens de `carreiras` no formato dos do `hall.php` (com
  `emblemas` e `emblemasTotal`, como o contrato da v3.3 pede: "no formato dos itens do hall.php").
- `carreiras.php` salvar: `provasNovas` e `emblemasNovos` (só com o banco da v3.4).

### A.9 Admin (rotas, ações, poderes, registro)

- GET (`ver`): `?r=provas`; `?r=desafio&id=` de emblema → `{desafio: D, candidatos: paginado vazio, emblemas: paginado de
  E}` (mais novos primeiro); `?r=desafios` com `D.emblemas`; `?r=usuario` com `conquistasProva`, `emblemas` (`E` +
  `desafio: {id, slug, titulo}`, até 100) e as conquistas com `provada`, `verificada`, `provaPk`, `origem` (a mais); `?r=carreira` com
  a prova e os emblemas que a carreira deu (`meta.emblemas: [{id, estado, desafio}]`, a mais); `?r=conquistas` com
  `provadas` por conquista (a mais).
- POST (`moderar`): `prova_verificar`, `emblema_retirar` (motivo obrigatório, até 200: o jogador vê no `?eu=1`),
  `emblema_devolver` (motivo opcional). `desafio_ativar` de emblema responde também `emblemasNovos` (= `candidatosNovos`:
  quantas contas ganharam agora). Registro: `prova_verificar`, `emblema_retirar`, `emblema_devolver` (alvo `desafio:<id>`
  nos de emblema), as três em `ACOES_LOG_COM_CONTA` (LGPD). O painel (§C) dá nome em pt-BR às três no
  `LP.NOMES_ACAO_LOG` (o `teste/painel/correcoes.mjs` §8 confere toda ação que o servidor grava), por exemplo "Verificou
  provas", "Retirou emblema" e "Devolveu emblema".

### A.10 Prévia de link (`api/v.php`, pedido 5a)

- Público, sem login, sem escrita no banco salvo o teto de imagens novas (600 a cada 10 min no site, `previa-gerar`;
  passou, a imagem genérica). Só GET/HEAD (POST → `405`). Nunca 500: erro do banco ou do GD vira a prévia genérica (a
  imagem sem GD → `404 text/plain`).
- **Carreira** (`?id=<HallEntry.id>`): só a que está na fotografia do Hall público agora e passa no filtro do
  `hall.php?id=` (visível, conta ativa no Hall, "Eu escolho" marcada). Título "`<JOGADOR>` · Nota de Legado N · LENDA",
  descrição com o headline, Bolas de Ouro, Copas, títulos, temporadas, "Carreira de `<apelido>`, a Nª do Hall das
  Lendas". Destino: `/lenda/?c=<código>#/resumo?id=<id>&de=comunidade` (o `c` é o de quem compartilhou, se veio).
- **Perfil** (`?c=<código>`): as regras do `perfil.php` (Hall "não" ou suspensa = genérica). Título "`<apelido>` no LENDA
  · melhor nota N", descrição com as carreiras no Hall, conquistas (provadas) e emblemas; destino
  `/lenda/?c=<código>#/jogador/<código>`.
- **Genérica**: "LENDA · jogo de carreira de futebol online grátis" (o destino leva o `c`, se veio).
- HTML: `lang="pt-BR"`, `<title>`, `description`, `robots noindex, follow`, `canonical` = a própria URL, Open Graph
  (`type website`, `site_name`, `locale pt_BR`, `title`, `description`, `url`, `image` + `type/width/height/alt`), Twitter
  (`summary_large_image`) e `meta http-equiv="refresh" content="0; url=…"` (sem script: o CSP do site não muda) e um link
  "Abrir no LENDA". `Cache-Control: public, max-age=300`, `X-Robots-Tag: noindex`, `nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`. A URL das imagens é absoluta (a primeira `origens` da config) e leva
  `h` = um hash do conteúdo (a imagem muda de URL quando a carreira ou a posição muda).
- Imagem (`&png=1`): 1200×630 PNG desenhado com o GD + FreeType (fundo escuro, LENDA em ouro, o nome grande, o anel da
  nota, quatro números, o rodapé com o apelido e "oprojeto.online/lenda · jogue grátis"); `public, max-age=86400`. Cache em
  disco fora do `public_html`: `lenda-cache/previas/` ao lado do arquivo de config (ou `cache_pasta` da config; um
  `.htaccess` que nega tudo em `lenda-cache/`, por garantia); sem pasta gravável fora da web, desenha a cada pedido. O nome
  do arquivo leva o número da conta (`c<uid>-<hash>-v1.png`, `p<uid>-…`): excluir a conta apaga as dela. Arquivos com mais
  de 30 dias (e acima de 5.000) saem numa limpeza de ~2% dos desenhos.

### A.11 LGPD e privacidade

Excluir a conta apaga os emblemas e as imagens das prévias dela (as provas saem com as carreiras e as conquistas). As
linhas do registro de `prova_verificar`, `emblema_retirar` e `emblema_devolver` que citam a conta ficam só com a ação, a
data e o id. A política fala das conquistas provadas, dos emblemas (o motivo da retirada), do perfil e do Hall com
emblemas, da prévia de link (o que o cartão mostra, só o que o Hall já mostra) e do prazo das imagens (30 dias).

### A.12 Testes

`teste/teste-v34.php` (incluído pelo `teste.php` depois do `teste-v33-corr.php`): banco e semeadura (uma vez só; o que o
admin mudou fica; o apagado não volta), as 87 iguais às do jogo, conquistas provadas (aparelho = não provada; carreira-prova
com ids inventados e repetidos; Imersivo, sem semente e suspeita não provam; a provada que o aparelho não mandou entra; a
verificada vira a prova; conteúdo novo zera a verificação; "não bateu" e apagar não apagam nada), `C.prova` com `unicas`,
`?r=provas` (essencial, motivo, faltam, links, `conquistasV`), `?r=carreira` (lista e números novos), `prova_verificar`
(leitor 403, jogador 401, 11 entradas erradas → 400, pulados, contas, registro), o de todas as conquistas pela prova
(do aparelho não contam; 50 não bastam; 87 provadas → candidato; `sem_prova` com `faltam`; verificado sozinho no lote;
vencedor), emblemas (dados na hora com `emblemasNovos`; idempotente; sem semente não ganha, com o motivo no `?eu=1`; o
`?eu=1` com o topo e `eu.emblema`; `ganharam`; nacionalidade + Copa pela seleção, quem trocou de seleção, gols > 1.000,
nota da versão atual e de outra versão, clubes e temporadas no mesmo clube; perfil e Hall com os emblemas; D, E e o filtro;
retirar/devolver com poderes, motivo e 409; "não bateu" e apagado pela moderação retiram; conta suspensa não ganha;
`desafio_salvar` de emblema, 11 entradas erradas → 400, `modo_travado`, reabrir → `409 emblema`; lote ao ativar com a hora
real; um de prêmio com critério novo), a prévia (HTML com OG/Twitter/refresh e cabeçalhos; sem e-mail; PNG 1200×630 no
disco fora do public_html, a segunda vez do disco; perfil; oculta, Hall fechado, inexistente, suspensa = genérica; 9
entradas estranhas; POST 405), LGPD (emblemas, registro), backup, o `.htaccess` no Apache, todos os `_*.php` da api
carregados juntos num processo (nenhuma função declarada duas vezes: o `excluir_usuario` carrega o `_previa.php` junto
com o resto do admin), nenhum 500 nas rotas novas, o banco sem o instalar da v3.4 e o recálculo das contas no instalar.

Testes antigos acertados para as regras novas (só onde o contrato da v3.4 muda o resultado): `teste.php` (`C.prova` nos
campos de `C`; o `v.php` responde HTML/PNG público, fora da conferência "JSON + no-store"), `teste-v3.php` (itens do Hall
com `emblemas`/`emblemasTotal`; as conquistas da conta conferidas pelos ids), `teste-v32-mod.php` e `teste-v33.php`
(`_esquema` 34; o perfil conta também as conquistas que as carreiras-prova puseram na conta; o de todas as conquistas
ativa e as do aparelho não fazem candidato), `teste-v33-corr.php` §E.7 (ativar → 200; candidato antigo sem prova →
`409 sem_prova` com as 87 em `faltam`).

Resultado (20/10/2026, `rodar.sh` completo, com as cargas e o navegador): servidor **PASSOU: 1659 verificações** (79 da
v3.4; a rápida, `LENDA_TESTE_SEM_CARGA=1`, 1606). Teste do painel pelo navegador: `painel` 129 ok; `correções do painel`
71 ok e 1 falha; `painel v3.3` 132 ok e 3 falhas — as 4 são as da A.14 (os 13 cartões em vez de 3, "2 valendo e 1
desativado", o ativar do de todas as conquistas que agora dá 200 e o nome de `prova_verificar` no `LP.NOMES_ACAO_LOG`),
do agente do painel.

### A.13 Decisões e diferenças em relação ao contrato da rodada

1. A lista de conquistas vem de `HallEntry.career.achievements` (o que o motor grava e o replay refaz), não de um campo
   novo; o `HallEntry.conquistas` do jogo da v3.4 só dá a versão das regras (`conquistas_v`).
2. Carreira-prova pede também "sem `fora_desafio`, sem suspeita e sem não bateu" (como a carreira que vale para desafio),
   além da semente do servidor e do replay do pedido.
3. "Provada" não é "verificada": a carreira-prova prova sozinha (é o que o jogo mostra como provada e o que dá emblema);
   verificada = o admin refez no jogo e bateu. O desafio de todas as conquistas pede as duas (o candidato nasce com as 87
   provadas; o "bateu" e o vencedor, só com as 87 verificadas).
4. Emblema é dado sem verificação antes (o pedido diz "concedido sozinho"); a proteção é a carreira-prova (semente do
   servidor + replay) e a retirada automática quando a carreira não bate ou é apagada pela moderação.
5. Os desafios de emblema de fábrica entram uma vez só (a marca `_v34_emblemas`), não "o que faltar pelo slug" como os da
   v3.3: o que o admin um dia apagar direto no banco não volta (e os testes antigos, que apagam os que não são da v3.3,
   continuam valendo sem mudança). O recálculo e o lote do instalar também rodam uma vez (com as marcas `_v34_recalculo` e
   `_v34_emblemas_lote`; apague a marca para rodar de novo: é idempotente).
6. Emblema não é corrida: vale carreira de antes do começo do desafio (e de antes de ele existir); só a que entrou depois
   do `fim` não vale. O de todas as conquistas de prêmio conta as provas de qualquer época (a coleção é da conta), com o
   `em` = a hora em que a 87ª ganhou prova, nunca antes do início.
7. A mais: `D.home`/`home` no `desafio_salvar` (a faixa da Home), `dificuldade` exposta, `ganharam` só de contas ativas,
   `?r=desafio` de emblema com `emblemas` paginado, `emblemasTotal`, `conquistasV`, os números dos critérios novos no
   `?r=carreira`, `origem` nas conquistas da ficha e `provadas` no `?r=conquistas`.
8. Prévia: carreira fora do Hall, perfil fechado ou link inexistente respondem a prévia **genérica com 200** (não 404): o
   link continua levando ao jogo e os robôs das redes mostram o cartão do LENDA. A página não tem script (o `meta refresh`
   leva ao jogo) e é `noindex` (o SEO é da página do jogo e do sitemap, §B).
9. As imagens guardam o número da conta no nome do arquivo para a LGPD (excluir apaga), nunca na URL (a URL leva só um
   hash).
10. O `perfil.php` passou a mandar `emblemas`/`emblemasTotal` também em cada item de `carreiras` (o formato dos itens do
    `hall.php`, que o teste da v3.3 confere).

### A.14 O que a v3.4 do servidor muda de propósito no que o painel testa

O servidor da v3.4 muda três coisas que o teste do painel pelo navegador (`teste/painel/**`, do agente do painel) conferia
com as regras da v3.3. Não são defeitos; o painel e o teste dele acompanham:

1. **A aba Desafios não tem mais só os 3 de fábrica**: o `instalar.php` semeia os 10 de emblema ativos (A.6). O
   `teste/painel/v33.mjs` §5a espera `3` cartões e "2 valendo e 1 desativado" → passam a ser 13 (os 10 de emblema
   "Valendo"); o cartão de emblema não tem prêmio nem candidatos (mostra `D.emblemas`).
2. **O de todas as conquistas pode ser ativado** (A.5, o §E da v3.3 trocado pela prova): `desafio_ativar` → `200`, não mais
   `409 sem_prova`; o botão "Ativar" desse desafio não precisa mais ficar travado. O `409 sem_prova` agora é do
   `candidato_verificar {ok: true}` sem as 87 verificadas (com `faltam`).
3. **Três ações novas no registro** (`prova_verificar`, `emblema_retirar`, `emblema_devolver`, A.9): o
   `teste/painel/correcoes.mjs` §8 cobra o nome em pt-BR de toda ação que o servidor grava no `LP.NOMES_ACAO_LOG`.

## §B Jogo

Implementado: o pedido (1) inteiro, o lado do jogo dos pedidos (2) conquistas provadas, (4) desafios de emblema e (5a) prévia
de link, e o (5b) SEO inteiro. Tudo o que é do site fica atrás do `VITE_SITE=1` (fora do site nada disso entra no bundle). A
abertura do jogo não ganhou pedido nem peso: a faixa dos desafios é pedida como o destaque da v3.3 (1,8 s depois de pintar +
`requestIdleCallback`), as provadas só quando a tela de conquistas abre (ou quando uma carreira acaba), e o pacote inicial
ficou em 199,8 KB gzip (antes 200,4 KB). Servidor antigo (sem os campos da v3.4), sem rede ou sem conta: nada quebra — sem
faixa, sem "provada/não provada", o compartilhar com o link de sempre.

### B.1 Arquivos

- Novos: `src/engine/career/regrasVersao.ts` (`CONQUISTAS_REGRAS_V`, à parte para o store não puxar as regras),
  `src/site/provas.ts` (semente do servidor lembrada, carreira-prova, provadas), `src/site/emblemas.ts` (emblemas e o aviso),
  `src/site/VerificarConta.tsx` (verificação em lote), `src/site/v34.css` (prefixo `s4-`), `src/ui/shared/emblemas/Emblema.tsx`
  e `emblema.css` (a moeda do emblema, também no Hall), `scripts/indexnow.mjs`. Testes: `src/engine/career/__tests__/
  achievements-v34.test.ts`, `src/store/v34.test.ts`, `src/site/v34.test.ts`.
- Mudados: `engine/career/achievements.ts` e `index.ts`, `engine/verificar.ts`, `store/career.ts` (`HallEntry.conquistas`),
  `store/conquistasSite.ts`, `store/comunidade.ts`, `store/compartilhar.ts`, `ui/shared/achievements/AchievementsDialog.tsx`
  e `achievements.css`, `ui/shared/hall/Comunidade.tsx`, `ui/classic/summary/ShareCard.tsx` e `SummaryScreen.tsx`; no site:
  `conquistas.ts`, `carreiras.ts`, `vigias.ts`, `pontes.ts`, `desafios.ts`, `DesafiosTela.tsx`, `DestaqueDesafio.tsx`,
  `ContaMenu.tsx`, `MinhaConta.tsx`, `MinhasCarreiras.tsx`, `PerfilPublico.tsx`, `perfil.ts`, `hallPublico.ts`,
  `indicacao.ts`, `verificacao.ts`, `VerificarTela.tsx`; `scripts/build-site.mjs`. O `index.html` e o `vite.config.ts` não
  mudaram (o SEO entra pelo build do site).
- Testes antigos, só o que o contrato mudou: `engine/legacy/__tests__/legacy.test.ts` ("Além do Rei" passou a pedir a
  carreira encerrada: saiu da lista do "ainda jogando" e entrou na do "encerrada") e `site/v33corr.test.ts` (o
  `numerosDoServidor` traz os números novos, `null` no servidor de antes).

### B.2 Regras das conquistas (pedido 1)

As 7 da §K.2, com a descrição e a regra do `v34-conquistas-novas.json` (os ids são os mesmos; nada do aparelho é apagado: a
conquista que alguém já tinha continua):

| id | Antes | Agora |
|---|---|---|
| `only_pele` Só o Pelé | 3 Copas e mais de 1.000 gols | 2 Copas e mais de 800 gols |
| `ushuaia_to_darien` De Ushuaia a Darién | 10 países da América do Sul | 9 países |
| `baldosero` Mochileiro | 24 clubes | 23 clubes |
| `world_cup_4` Além do Rei | 4 Copas | 2 Copas + Nota de Legado maior que a de Pelé (carreira encerrada) |
| `goals_1300` Fora da curva | 1.300 gols | 1.050 gols |
| `records_10` Reescreveu a história | 10 recordes | 6 recordes |
| `legacy_95` Legado imortal | nota 95 | nota 94 |

- `CONQUISTAS_REGRAS_V = 2` (1 = até a v3.3), `CONQUISTAS_MUDARAM[2]` (as 7) e `REGRAS_ANTIGAS[1]` (as regras de antes).
  `detectAchievements(s)` — o que o motor chama — usa só as de agora; `detectAchievements(s, {regras: 1})` troca as 7 pela
  regra antiga e só a verificação por replay usa. O motor não mudou: nenhum número de carreira muda, só a lista de conquistas.
- Conferido com `scripts/estudos/conferir-v34.mjs` (o pacote do motor montado do `src/` desta árvore × o pacote do estudo):
  **OK — 160 carreiras jogadas de novo, motor igual, as 80 de regra igual iguais, as 7 regras novas batendo com a calibração**
  (only_pele 9, ushuaia_to_darien 4, baldosero 5, world_cup_4 17, goals_1300 12, records_10 11, legacy_95 23 carreiras que
  cumprem).

### B.3 Conquistas provadas (pedido 2, lado do jogo)

- **A lista de cada carreira** é o `HallEntry.career.achievements` (o motor junta decisão a decisão; já subia para a conta).
  **A mais:** `HallEntry.conquistas = {v: 2}` em toda carreira encerrada a partir da v3.4 (a versão das regras; o servidor
  grava em `carreiras.conquistas_v`). Diferença do rascunho: sem `ids` (o servidor lê `career.achievements`, A.13 #1).
- **A semente do servidor fica lembrada no aparelho**: o `pedirSementeCarreira` (pontes.ts) guarda a semente que o servidor
  sorteou para a conta em `localStorage['lenda:sementes-servidor'] = {uid, s: [...]}` (últimas 600; outra conta no aparelho
  começa outra lista). A carreira é "prova" para o jogo quando é do Clássico, do motor real, com replay, `id = career-<semente
  do replay>` e essa semente está na lista da conta. Quem decide de verdade é o servidor (A.3).
- **Sobe sozinha como prova**: ao terminar, logado, a carreira-prova que tem alguma conquista que a conta ainda não tem
  PROVADA vai para a conta (`salvar`, `como: "auto"`, o mesmo das 90+). Para saber as provadas, o jogo lê `GET
  conquistas.php` (`provada`, `verificada`, `carreira`; no máximo 1 vez por minuto; o `sincronizar` também traz). Ao entrar na
  conta, as do aparelho nessas condições sobem junto com as 90+ (uma carreira por conquista que falta). A conta que não
  respondeu a tempo (servidor lento): a carreira-prova espera na fila, como a 90+.
- **Avisos discretos**: `provasNovas` do salvar → "Salva na sua conta · pico 97 · 41 conquistas provadas na conta" (ou "3
  conquistas provadas na conta" quando subiu só como prova); `emblemasNovos` → o toast dourado do emblema (B.5).
- **Tela de conquistas**: logado e com servidor da v3.4, uma linha embaixo das raridades — "✓ 41 provadas na conta · ◌ 6 não
  provadas · (i)" (o (i) explica as duas em duas frases) —, em cada desbloqueada o selo "Provada" (verde) ou "Não provada"
  (tracejado), e na grade um escudinho verde nas provadas. Sem conta ou com servidor antigo: como antes.
- **Minhas carreiras**: o selo "Prova de N" e, ao apagar a que é a única prova de algumas, o aviso "elas voltam a não
  provadas (e um emblema que dependa dela pode sair)" (`C.prova.unicas`).
- **Desafio de todas as conquistas**: o checklist diz "Conquistas provadas: X de 87 · Y já conferidas · Z com as não
  provadas" (`conquistas`, `conquistasVerificadas`, `conquistasTodas` do `?eu=1`).

### B.4 Verificação por replay (pedido 2)

- **A lista de conquistas entra na conferência** (`compararConquistas`): as refeitas são as que o motor junta no replay; as
  aceitas, as guardadas que saem no replay com as regras de agora **ou** com as de antes (`detectAchievements(estadoFinal,
  {regras: 1})`: a carreira jogada antes da v3.4 guardou a lista com a regra antiga). Conquista guardada que não sai → a
  diferença `conquistas` (não bate; com os dados de outra versão do jogo, inconclusiva, como os números); a que o replay dá e
  a lista não tem → só aviso (a carreira só prova menos); id que o jogo não conhece → aviso (o servidor ignora); a lista que
  o servidor guardou (`meta.conquistas`) com algo fora da carreira guardada → `servidor` (não bate, definitivo).
- **Os números dos critérios novos**: Champions, clubes, temporadas no mesmo clube e Copas pela seleção da criação, com a
  mesma conta do servidor (clubId no formato, até 40; temporadas de 0 a 999 somadas por clube; Copa sem `minor` e com o
  `teamId` da seleção do replay), comparados guardado × refeito e com os do servidor (`meta.champions`, `nClubes`,
  `mesmoClube`, `copasSelecao`); a tabela da tela ganhou as 4 linhas. `resultado.detalhes.conquistas = {regras, aceitas,
  faltam, sobram}`.
- **Uma carreira** (`#/verificar?id=…`, também com o `&prova=1` dos links do §A): a carreira-prova (`meta.prova`/
  `meta.conquistas`) recebe o resultado por `prova_verificar` — sozinho quando bate, com o clique "Registrar: não bateu (tira a
  prova)" quando não bate; a tela mostra "Conquistas: 41 de 41 saem no replay" e o bloco "Prova de conquistas na conta" com o
  link do lote.
- **Em lote** `#/verificar?conta=<id>[&candidato=<id>]` (só o admin, como a de sempre): lê `?r=provas`, mostra a conta
  (provadas, conferidas, só no aparelho, o que falta conferir) e as carreiras-prova (conquistas, as que só ela prova,
  essencial, o que o servidor tem gravado), e verifica as **essenciais que ainda não bateram** ao abrir (ou "Não
  verificadas" / "Todas"), uma a uma, com a versão dos dados de cada carreira e a barra "Carreira 3 de 12 · decisão 7 de 24"
  ("Parar" interrompe). As que bateram vão juntas num `prova_verificar` (até 50 por pedido); as que não bateram esperam o
  clique "Registrar as que não bateram"; as inconclusivas não vão. Com as 87 provadas e conferidas, o servidor passa o
  candidato do desafio de todas as conquistas para "verificada" sozinho (A.5).

### B.5 Desafios de emblema (pedido 4, lado do jogo)

- **O que o jogo lê** (A.0/A.8): `modo` (`emblema` | `primeiro`; sem o campo = `primeiro`), `dificuldade`, `emblema {icone,
  cor}` (ícone fora do mapa das conquistas → medalha; cor fora de `#rrggbb` → bronze), `home`, `ganharam`, os critérios novos
  (com os tetos do §A) e, no `?eu=1`, `eu.emblema` e a lista `emblemas` do topo. O de emblema nunca tem vencedor na tela.
- **A chance aproximada** vem da tabela da §K.4 pelo slug (`CHANCE_EMBLEMA`, "~1 em 12 carreiras", o plano dedicado); o
  desafio criado pelo admin não mostra número. O critério vira uma frase ("jogador brasileiro, a Copa pela própria seleção, 2
  Libertadores e 1 Bola de Ouro numa mesma carreira"; "3 Copas do Mundo e mais de 1.000 gols numa mesma carreira").
- **Faixa da tela inicial** (no lugar do destaque grande quando não há desafio de **prêmio** valendo; o destaque e a linha do
  menu da v3.3 ficaram só para os de prêmio): uma linha só, "DESAFIOS · [emblema] Noite de gala · [emblema] Hexa e Glória
  Eterna · Ver todos →", com os marcados `home` primeiro; só entram os que cabem inteiros (nada de nome cortado); no celular,
  os três emblemas, "Desafios com emblema" e "Ver todos". Cada um abre `#/desafios?d=<slug>` (a tela rola até ele e o
  destaca); "Ver todos" abre `#/desafios`. Sem desafio de emblema valendo, sem resposta do servidor ou servidor antigo: nada.
  Logado e com o emblema, um ✓ ao lado do nome. No menu, sem desafio de prêmio valendo: a linha discreta "Desafios · 10
  desafios valendo: cumpra numa carreira e ganhe o emblema".
- **`#/desafios`**: com desafios de emblema, o título vira "Desafios" ("Todo mundo que cumprir ganha") e vem a seção "Ganhe
  emblemas" — uma grade de cartões compactos (2 colunas no computador, 1 no celular), do fácil ao lendário: o emblema, nome,
  dificuldade, descrição, "Chance: ~1 em 12 carreiras", quantos jogadores têm e, logado, "Você já tem" (desde quando e com qual
  jogador), "Você tem 2 de 10" no topo, o emblema retirado pela equipe com o motivo e "SILVA cumpre, mas não vale: …" (a carreira
  sem a semente do servidor etc.). Sem conta: "Criar conta para ganhar" (um botão só). Os de prêmio continuam embaixo, como
  eram ("Desafios com prêmio").
- **Aviso de emblema novo**: o toast dourado "Emblema novo: Noite de gala · Ganho com VALDEZ…" (ou "2 emblemas novos: …"),
  com "Ver desafios" — na hora, pelo `emblemasNovos` do salvar, e ao ler o `?eu=1` para os que este aparelho ainda não avisou
  (uma vez por emblema por aparelho; um emblema que o aparelho nunca viu só avisa se for dos últimos 7 dias).
- **Onde o emblema aparece**: Minha conta ("Seus emblemas", com "Ver os desafios"; a seção só aparece com o servidor da
  v3.4), o perfil público ("Emblemas dos desafios", e "N provadas" embaixo do número de conquistas), o Hall da comunidade (até
  3 moedinhas de 13 px ao lado do apelido e "+N", `emblemasTotal`) e `#/desafios`. A ordem é a do servidor (o mais difícil
  primeiro).

### B.6 Prévia de link (pedido 5a, lado do jogo)

- O Compartilhar e o "Copiar link" do card da carreira usam `<pasta do jogo>api/v.php?id=<HallEntry.id>&c=<código de quem
  compartilha>` quando há conta (também no resumo de uma carreira da comunidade: o `c` é o de quem compartilha); sem conta, o
  link de sempre (a carreira não está no servidor). O "Compartilhar" do perfil público usa `api/v.php?c=<código>`.
- O link do perfil em Minha conta continua o canônico (`?c=…#/jogador/…`, o que o e2e da v3.3 confere).

### B.7 SEO (pedido 5b)

- Pelo `scripts/build-site.mjs`, só no `dist-site/` (nada fora de `/lenda/`, nenhum robots.txt): `<title>` "LENDA · Jogo de
  carreira de futebol online grátis", a descrição de 157 caracteres ("Jogo de carreira de futebol online e grátis, em
  português: …"), o mesmo texto no Open Graph/Twitter, `keywords`, `robots index, follow, max-image-preview:large`, o JSON-LD
  de `VideoGame` (nome, descrição, url, imagem, pt-BR, gêneros, plataformas, `isAccessibleForFree`, `offers` de preço 0, sem
  nota nem avaliação inventada) e um `<noscript>` com o que é o jogo em texto (para robô sem JavaScript).
- **CSP**: o JSON-LD é `<script type="application/ld+json">`, que o navegador não executa e a CSP não alcança — ele fica fora
  dos hashes do `script-src` (o `INLINE_RE` pula esse tipo). Conferido no Chromium com a CSP do `.htaccess`: nenhuma violação,
  o JSON-LD lido, o jogo abre. O `.htaccess` ganhou `.xml` e `.txt` nos tipos.
- `dist-site/sitemap.xml`: só as páginas de verdade da pasta (`/lenda/` e `/lenda/privacidade.html`, com `lastmod` do build);
  as rotas com `#` não são páginas para os buscadores.
- IndexNow: `dist-site/<chave>.txt` com a chave (a chave é **pública** por definição — o protocolo exige o arquivo no site —,
  fixa em `scripts/indexnow.mjs`, `LENDA_INDEXNOW_KEY` troca). `node scripts/indexnow.mjs [--seco] [--conferir] [--url …]
  [--motores bing,yandex,indexnow]`: avisa Bing e Yandex das URLs do `dist-site/sitemap.xml`, com o `keyLocation` em `/lenda/`
  (só endereços dentro de `/lenda/` vão no pedido); `--conferir` confere antes se a chave está publicada; `--seco` só mostra.
  O build confere o JSON-LD, o título, o sitemap e o arquivo da chave (falha se faltar). Depois do deploy: `node
  scripts/indexnow.mjs --conferir`.

### B.8 Testes e resultados

- `npx tsc --noEmit -p .`: limpo. `npx vitest run`: **626 ok, 2 pulados** (52 arquivos passaram, 2 pulados; antes 585). Novos:
  `achievements-v34.test.ts` (as 7 na beira, a versão, as regras de antes, a pureza), `store/v34.test.ts` (carreiras reais das
  filas pelo store: a lista no HallEntry, a verificação que bate, a conquista forjada que não bate, a tirada que só avisa, o
  id desconhecido, a lista do servidor diferente, os 4 números novos adulterados, a regra de antes aceita) e
  `site/v34.test.ts` (provadas, semente lembrada, carreira-prova, salvar com `provasNovas`/`emblemasNovos`, desafios de
  emblema, as 10 frases, chance, faixa, `?eu=1` com e sem a lista do topo, aviso uma vez, Hall, perfil, `linkPrevia`, o
  compartilhar, lote e `prova_verificar` em pedidos de 50, o meta do `?r=carreira`, o `indexnow.mjs` com um fetch de mentira —
  nada sai para a internet — e os textos sem promessa de dinheiro).
- `npm run build:site`: ok (SEO, sitemap e chave conferidos pelo próprio build).
- No navegador (pilha local do `subir.sh` com este build, porta 9010, banco `lenda_v34_jogo`, Playwright): **PASSOU — 59
  verificações**: a faixa (2 desafios inteiros no computador, os emblemas no celular, uma linha de 44 px, sem nome cortado, sem
  rolagem lateral), o clique que rola até o desafio, `#/desafios` com os 10, as 4 dificuldades, a chance e "Criar conta para
  ganhar", a linha do menu, a faixa que some sem resposta do `desafios.php`; uma conta nova jogando pelos cliques a fila
  real `v-extraordinaria-01` com a semente do servidor: o aparelho lembra a semente, a carreira sobe sozinha e o servidor guarda
  a mesma lista do HallEntry (41), `conquistas_v = 2`, 41 provadas, os emblemas Noite de gala e Era de ouro dados, o aviso, "Você
  já tem", "41 provadas na conta" e o selo "Provada", "Seus emblemas", o "Copiar link" com `api/v.php?id=…&c=…` (e o `v.php`
  respondendo o Open Graph e o refresh), o emblema ao lado do apelido no Hall da comunidade, o perfil com os emblemas, o
  celular logado; e o admin (painel com a senha do arquivo): o lote `#/verificar?conta=` bate e o servidor grava `prova_ok =
  1` com as 41 conferidas, e a `#/verificar?id=` mostra "Conquistas: 41 de 41 saem no replay". Nenhum erro de console, nenhum
  5xx.
- Prints revisados (celular 390 e computador 1440) em `scratchpad/v34-prints/jogo/`: `home-1440`, `home-390`,
  `home-logado-390`, `desafios-1440`, `desafios-390`, `desafios-alvo-*`, `desafios-logado-1440`, `desafios-logado-390`,
  `conquistas-provadas-1440`, `minha-conta-emblemas-1440`, `perfil-emblemas-1440`, `hall-emblema-1440`,
  `fim-carreira-prova-1440`, `verificar-lote-1440`, `verificar-uma-1440`.

### B.9 Decisões e diferenças em relação ao contrato da rodada

1. A lista das conquistas é o `career.achievements` que já existia (o servidor lê dele); o campo novo do HallEntry só leva a
   versão das regras (`conquistas: {v: 2}`).
2. A verificação aceita, numa conquista guardada, a regra de agora **ou** a de antes da mudança (avaliada no estado final do
   replay): a carreira jogada antes da v3.4 não "deixa de bater" por causa da regra nova, e uma lista forjada continua não
   batendo (a regra de antes também é conferida no replay).
3. O jogo só manda sozinho para a conta a carreira que **ele** sabe que começou com a semente do servidor (lembrada no
   aparelho): a carreira de semente do aparelho não provaria nada e só ocuparia lugar na conta. Aparelho com a lembrança
   apagada: a carreira não sobe sozinha como prova (o botão de salvar continua; o servidor decide do mesmo jeito).
4. O destaque grande e a linha do menu da v3.3 ficaram só para desafio de **prêmio** valendo; os de emblema têm a faixa
   discreta e a linha "Desafios" do menu. Com um de prêmio valendo, o destaque dele aparece no lugar da faixa (nunca os dois).
5. Na faixa, "2 ou 3 desafios": entram os que cabem inteiros (no computador, 2 com o nome; no celular, os 3 emblemas sem o
   nome, que vai no `aria-label` e no `title`).
6. A chance de cada desafio na tela vem da tabela da §K.4 no jogo (o servidor só escreve a frase no regulamento).
7. A mais: o selo "Prova de N" e o aviso ao apagar a única prova (Minhas carreiras); "N provadas" no perfil; os números dos
   critérios novos na verificação; o "Parar" do lote.

### B.10 Pendências (para o servidor e a integração)

1. **Servidor**: o `desafios.php?eu=1` ainda não manda a lista `emblemas` no topo (A.0/A.8 prometem; o `desafios.php` só
   responde `{desafios}`). O jogo cobre: sem a lista, monta os emblemas da conta com os `eu.emblema` ativos de cada desafio
   (fica de fora só o emblema de um desafio já desligado). Quando o servidor mandar, vale a dele.
2. **e2e da v3.3** (`teste/integracao/e2e.mjs`): com os 10 de emblema ativos de fábrica, a etapa g1 ("`desafios.php` vazio,
   sem destaque, sem linha no menu, 'Nenhum desafio valendo agora'") deixa de valer — agora há a faixa, a linha "Desafios" e
   a seção de emblemas; as etapas do desafio de prêmio (g4–g11) continuam (o destaque e a linha dele são os mesmos).
3. Depois do deploy: `node scripts/indexnow.mjs --conferir` (avisa Bing e Yandex) e mandar o `sitemap.xml` no Bing Webmaster
   / Google Search Console da propriedade `https://oprojeto.online/lenda/` (o robots.txt da raiz não é nosso).

## §C Painel

Implementado: o lado do painel dos pedidos (2) conquistas provadas e (4) desafios de emblema, no padrão das outras abas
(ficha no painel lateral, diálogo com motivo e chips, toasts, lista que vira cartões no celular, paginação, filtros no
endereço, "Sair sem salvar?", temas, celular sem rolagem lateral, CSP sem nada embutido: o texto do servidor só por
`textContent` e a cor do emblema pelo CSSOM, nunca `style=""`). Feito contra mock primeiro (as respostas do §A trocadas no
navegador) e depois contra a pilha real. Com o servidor de antes (sem `modo`, sem `conquistasProva`, sem `emblemas`), o
painel fica exatamente como na v3.3.

### C.1 Arquivos

- Novos: `painel/emblemas.js` (a moeda do emblema como o jogo desenha, os 38 ícones do mapa das conquistas do jogo com os
  traços do lucide — ISC, gerados do `lucide-react` do projeto —, os nomes da dificuldade, as 8 cores prontas e o seletor
  de ícone e cor do editor), `teste/painel/semente-v34.mjs`, `teste/painel/mock-v34.mjs` (o teste contra mock) e
  `teste/painel/v34.mjs` (o teste contra a pilha real), os dois rodados pelo `teste/painel/rodar.sh` depois do `v33.mjs`.
- Mudados: `painel/desafios.js` (o tipo emblema inteiro), `usuarios.js` (a ficha da conta), `moderacao.js` (a ficha da
  carreira), `sistema.js` (a coluna "Provadas" em Conquistas), `registro.js` (nomes dos detalhes novos e o alvo `provas`),
  `nucleo.js` (os 3 nomes no `LP.NOMES_ACAO_LOG`), `painel.css` (bloco "v3.4" no fim), `index.html` (o `emblemas.js` e
  `?v=3.4.0` em todos os arquivos) e `nomes.json` (refeito com `node scripts/painel-nomes.mjs`: as descrições das 7
  conquistas que mudaram; o build do site refaz de qualquer jeito). Testes antigos, só o que o §A.14 mudou:
  `teste/painel/v33.mjs` (13 cartões em Desafios, o de todas as conquistas ativa, o "Prêmio" escolhido no editor) e o
  `rodar.sh` (os dois testes novos).

### C.2 Desafios (`#/desafios`)

- **Lista**: com desafio de emblema, dois grupos — "Desafios com emblema" (todo mundo que cumprir ganha · N valendo · N na
  faixa da tela inicial) e "Desafios com prêmio" (como na v3.3). O cartão do emblema: a moeda (ícone e cor do servidor;
  ícone fora do mapa = medalha e cor fora de `#rrggbb` = bronze, como o jogo), o título, a situação, o endereço, a pílula da
  dificuldade (fácil bronze, médio prata, difícil ouro, lendário lilás), "Na faixa da tela inicial", a descrição, o que
  vale, os requisitos ("Sem requisito de conta" + "Carreira-prova (semente do servidor + replay)"), a **chance da
  calibração** (§K.3/§K.4) só nos de fábrica e só enquanto o critério for o de fábrica, o prazo e "Ganharam: N contas com
  o emblema · M retirados"; botões "Ver quem ganhou (N)", "Editar", "Ativar/Desativar". Ladrilhos: Valendo agora (N de
  emblema · M com prêmio), **Emblemas dados** (os ativos; "N desafios com dono · M retirados"), Candidatos esperando (nos
  de prêmio), Partidas por dia, Conquistas no jogo. No cabeçalho, **"Criar desafio de emblema"** e "Criar com prêmio".
- **O critério em palavras**, com as chaves novas: "1 Champions League + 1 Bola de Ouro numa carreira do Clássico",
  "3 Copas do Mundo + mais de 1.000 gols" (`gols: 1001`), "2 Copas do Mundo (1 pela própria seleção)", "Nota de Legado 92
  ou mais", "18 temporadas no mesmo clube", e a seleção pelo nome do `nomes.json` ("· seleção: Brasil (a mesma do começo
  ao fim)"); o de todas as conquistas, "Todas as 87 conquistas provadas na conta".
- **Ativar** um de emblema: o diálogo diz que toda conta com uma carreira-prova que cumpre ganha agora (também as carreiras
  que já estão nas contas: não é corrida) e o toast diz quantas ganharam (`emblemasNovos`). Desativar: quem ganhou continua
  com o emblema.
- **Quem ganhou** (`#/desafios?id=N[&estado=ativo|retirado][&pagina=]`, o desafio de emblema): a ficha com a moeda grande,
  a dificuldade, "Na faixa / Fora da faixa da tela inicial", "Todo mundo que cumprir ganha", a calibração; "Ver no jogo"
  abre `#/desafios?d=<slug>`. Embaixo, os E do `?r=desafio` (mais novos primeiro, paginados de 50), com o filtro Todos /
  Com o emblema / Retirados e as contagens de `D.emblemas`: a conta (→ ficha; "Conta suspensa" marcada), a carreira (→
  ficha da carreira; "Carreira apagada" sem os links do jogo), quando ganhou (o `title` com milésimos), a situação (o
  retirado com o motivo, quando e quem — "Sistema" no não bateu) e as ações "Abrir a carreira" (`links.resumo`),
  "Verificar no jogo" (`links.verificar`, `&prova=1`), **"Tirar"** (`emblema_retirar`: motivo obrigatório que o jogador
  vê, com chips; o diálogo diz que não volta sozinho) e **"Devolver"** (`emblema_devolver`, motivo opcional; o diálogo
  lembra o motivo da retirada). O 409 do servidor (`ja_retirado`, `ja_ativo`) aparece no diálogo.
- **Editor** (`#/desafios?parte=novo&modo=emblema`, `#/desafios?parte=novo` = com prêmio, como na v3.3, e
  `#/desafios?id=N&parte=editar`): o **Tipo** (Emblema · todo mundo que cumprir ganha / Prêmio · o primeiro que cumprir;
  travado, com o porquê, quando alguém já é candidato ou ganhou — o `409 modo_travado` vai para o campo); no de emblema, o
  cartão **Emblema** (a moeda de prévia em 3 tamanhos, os 38 ícones em grade, as 8 cores prontas e "Outra" com o seletor de
  cor, a **dificuldade** — escolher uma troca a cor de partida pela dela — e o interruptor **"Na faixa da tela inicial"**) e
  sem o prêmio; o **critério** "Números numa carreira" com as 10 chaves (Copas, Copas pela própria seleção, Libertadores,
  Champions, Bolas de Ouro, títulos, gols, nota, clubes, temporadas no mesmo clube, cada uma de 0 ao teto do §A.0) e a
  **seleção** (a lista dos países do jogo ou o código digitado, em pílulas com ×; "a da criação tem de ser a do fim"), ou
  "Todas as conquistas" (o texto novo: só as provadas contam). Os requisitos de partida mudam com o tipo enquanto ninguém
  mexeu neles (emblema: nenhum; prêmio: os da v3.3). A prévia acompanha (moeda, dificuldade, faixa, "Quem ganha: todo mundo
  que cumprir"). O `desafio_salvar` leva só o que mudou: no novo, o `modo` sempre, e no de emblema `emblema {icone, cor}`,
  `dificuldade` (se escolhida) e `home` (se ligada), nunca `premio`; ao editar, cada campo novo só se mudou. O diálogo de
  salvar avisa, num ativo, que o emblema muda para quem já tem e que mudar o critério dá o emblema a quem passar a cumprir.
- **Todas as conquistas** (v3.4): "Ativar" liberado (com o servidor de antes continua travado, §E da v3.3); o candidato
  (sem carreira) tem **"Verificar as provas no jogo"** (`links.verificar` = `#/verificar?conta=<uid>&candidato=<id>`, o
  lote do jogo) e a faixa "quando as 87 estiverem provadas por carreiras que bateram no replay, o candidato vira
  'verificado' sozinho"; o verificado pode ser declarado vencedor (o servidor confere as 87 verificadas). O bloco da
  verificação mostra "Verificado pelas carreiras-prova" (`detalhes.provas`) e a tabela guardado × refeito ganhou os números
  novos (Champions, clubes, temporadas no mesmo clube, Copas pela seleção) e a diferença "Conquistas".

### C.3 Ficha da conta (Usuários)

- Números: "Conquistas: 41 · 38 provadas · 38 conferidas" e "Emblemas: 3 dos desafios (· N retirados)".
- **Emblemas** (cartão, `u.emblemas`): a moeda (o ícone, a cor e a dificuldade vêm da lista dos desafios, guardada 60 s —
  o `?r=usuario` só manda `{id, slug, titulo}` do desafio), o desafio (→ `#/desafios?id=`), a carreira, quando ganhou, a
  situação (o retirado com a moeda apagada e o motivo) e "Verificar no jogo", "Tirar", "Devolver". Sem emblema: "Nenhum
  emblema ainda" e "Ver os desafios".
- **Conquistas** (cartão, com `u.conquistasProva`): "N provadas de 87 · V conferidas · M só do aparelho", a barra das 87
  (conferidas, provadas sem conferir, só do aparelho) com a legenda, a explicação de provada × conferida, o botão
  **"Verificar as provas no jogo"** (`../#/verificar?conta=<id>`, outra aba; em ouro quando há provada sem conferir; ao
  voltar para o painel a ficha se refaz), "Ver as conquistas da conta" (os grupos Provadas e conferidas / Provadas, ainda
  não conferidas / Só do aparelho / Faltam provar para as 87, cada pílula com a descrição, a data e a carreira que prova; a
  provada leva à ficha dessa carreira) e **"Carreiras-prova da conta"** (o `?r=provas` só quando abre: cada carreira com a
  lista guardada, se vale — ou "Não vale: <motivoTexto>" —, "Essencial", quantas conquistas, as que só ela prova, a
  verificação — Bateu / Não bateu com o motivo / Não verificada —, "regras de antes da v3.4" no `conquistasV = 1`, e
  "Verificar no jogo" / "Abrir"). Na tabela Carreiras, a pílula "Prova de N conquistas" (as `provaPk` dela).
- Excluir a conta cita os emblemas, as provas e as imagens das prévias.

### C.4 Ficha da carreira, Conquistas e Registro

- **Ficha da carreira** (`?r=carreira`): o cartão "Conquistas e desafios" — "Prova das conquistas" / "Lista guardada, mas
  não prova" / "Não é carreira-prova", "Bateu no replay" / "Não bateu no replay" (com o motivo) / "Não verificada",
  "Regras de antes da v3.4", os números do servidor (Champions, clubes diferentes, temporadas no mesmo clube, Copas pela
  própria seleção, a seleção da criação — e a do fim, se trocou), as conquistas guardadas (abre e fecha), os emblemas que
  ela deu (→ o desafio) e as candidaturas (os `candidatos` que o servidor já mandava), com "Verificar no jogo" (`&prova=1`)
  e "Verificar as provas da conta".
- **Conquistas**: a coluna "Provadas" (contas com a conquista provada; ordena), só com o servidor da v3.4.
- **Registro**: "Verificou provas" (`prova_verificar`), "Retirou emblema", "Devolveu emblema" (o `correcoes.mjs` §8 cobra
  todos); os detalhes novos com nome (emblema, não bateram, candidatos recusados, estado, não cumpre) e o alvo `provas`
  (várias contas num pedido).
- Poderes: tirar/devolver e "Verificar …" pedem `moderar`; criar, editar, ativar pedem `config` (como a v3.3); ler, `ver`.

### C.5 Testes e prints

- `teste/painel/mock-v34.mjs` (contra mock: o login, o pulso e o resto são os da pilha; `?r=desafios`, `desafio`,
  `usuario`, `provas` e as ações `desafio_salvar`, `emblema_retirar`, `emblema_devolver` respondidos no navegador, nada no
  banco muda): o servidor de antes (a lista, o "Ativar" travado do de todas as conquistas, o editor só com Copas e
  Libertadores, a ficha de sempre), os casos de borda (ícone fora do mapa, cor estragada, `gols: 1001`, as seleções pelo
  nome, as Copas pela própria seleção juntas, a chance só no critério de fábrica, 120 emblemas em páginas — a página 2 e o
  filtro pedidos ao servidor —, conta suspensa, carreira apagada, retirado pelo sistema, o 409 no diálogo, devolver sem
  motivo), a ficha com as três situações (a barra, os grupos, a carreira que prova, as carreiras-prova que não valem, a do
  "não bateu", as essenciais, as regras de antes, o `?r=provas` só ao abrir), o editor (o que vai no `desafio_salvar`, os
  tetos, o código de seleção estranho, a cor que acompanha a dificuldade, a faixa) e o celular.
- `teste/painel/v34.mjs` (pilha real, com o `semente-v34.mjs`: contas que salvam carreiras com a semente do servidor e o
  replay real das filas — o servidor dá os emblemas sozinho —, uma que não bateu no `prova_verificar`, uma sem semente, uma
  com as 87 na lista e um emblema retirado pela equipe): a lista (10 + 3, os grupos, as moedas, os 3 da faixa, as 4
  dificuldades, "Emblemas dados" e "N contas com o emblema" = o banco), quem ganhou (os links do jogo, a sem semente fora,
  tirar com o chip e devolver no banco e no registro, o retirado pelo "não bateu" e o da equipe), o editor (criar um de
  emblema pela tela e conferir a linha do banco, ativar com "N contas ganharam" = o banco, mudar só o ícone = `campos:
  emblema`, o tipo travado), o de todas as conquistas (ativa, o Colecionador candidato, o link do lote), a ficha da conta
  (emblemas, os números = o banco, o lote, os grupos, a carreira-prova "Bateu" e essencial, "Prova de N", tirar e devolver
  pela ficha, a conta sem semente), a ficha da carreira, a coluna Provadas = o banco, o Registro, a moderadora e o celular.
- Resultado (pilha real do `bash servidor/teste/painel/rodar.sh`, banco `lenda_v34_painel_c`, porta 9022, base em `/srv`):
  **PAINEL: PASSOU** — `painel.mjs` 129 ok, `correcoes.mjs` 72 ok, `v33.mjs` 135 ok, `mock-v34.mjs` 63 ok, `v34.mjs` 85 ok,
  nenhuma falha, nenhum erro de JavaScript, nenhuma violação de CSP, nenhum 5xx, o log de erros do PHP vazio. Bancos
  apagados e processos encerrados pelo PID no fim.
- Prints (1440 e 390, revisados; também nos temas Claro e Alto contraste), com `LENDA_PRINTS_V34`, em
  `scratchpad/v34-prints/painel/`: `desafios`, `emblema-noite-de-gala`, `emblema-hexa-com-retirado`,
  `emblema-hexa-retirados`, `emblema-editar`, `emblema-novo`, `conquistas-provadas`, `dialogo-tirar`, `ficha-emblemas`,
  `ficha-conquistas-provadas`, `ficha-carreira-prova`, `ficha-carreira-nao-bateu` e `tema-claro-*`/`tema-alto-*`
  (desafios, editor, ficha).

### C.6 Decisões e diferenças em relação ao contrato da rodada

1. **Mock + pilha real**: o servidor da v3.4 já existia; o "mock primeiro" virou o `mock-v34.mjs`, que troca só as
   respostas das rotas novas no navegador — é ele que cobre o servidor de antes e os casos que o banco do teste não tem.
2. O endereço de sempre `#/desafios?parte=novo` continua abrindo o de **prêmio** (o e2e da v3.3 e os links antigos não
   mudam); o de emblema é `&modo=emblema`, com o botão próprio "Criar desafio de emblema" (em ouro) na lista. Para a
   integração: no `teste/integracao/e2e.mjs` g4, só a contagem "os 3 de fábrica" deixa de valer (são 13 cartões, A.14;
   os de prêmio são `article.cartao-desafio[data-modo="primeiro"]`); os ids dos campos (`#dz-titulo`, `#dz-copas`,
   `#dz-libertadores`, `#dz-partidasMin`, `#dz-premio`…) e o botão "Ativar" do cartão são os de antes.
3. O ícone, a cor e a dificuldade dos emblemas da ficha da conta vêm da lista dos desafios (`?r=desafios`, guardada 60 s):
   o `?r=usuario` manda só `{id, slug, titulo}` do desafio. Pedido opcional ao servidor (não bloqueia nada): mandar também
   `emblema` e `dificuldade` em `E.desafio` do `?r=usuario` — o painel já lê de lá quando vier.
4. O seletor de ícone oferece só os 38 do mapa das conquistas do jogo (`src/ui/shared/achievements/meta.ts`, sem o apelido
   `goat`); um ícone de fora salvo direto no banco aparece como a medalha, como no jogo.
5. A chance da calibração (§K) aparece nos cartões de fábrica só enquanto o critério for o de fábrica (`CALIBRACAO` no
   `desafios.js`; mudou o critério, o número não vale mais e some).
6. A mais: a coluna "Provadas" em Conquistas, o cartão "Conquistas e desafios" na ficha da carreira, "Prova de N
   conquistas" nas carreiras da conta, a barra das 87, o grupo "Faltam provar para as 87", a ficha que se refaz ao voltar do
   lote do jogo, e o `nomes.json` refeito com as descrições novas.
7. O teste antigo `v33.mjs` mudou só no que o §A.14 manda (13 cartões, o de todas as conquistas ativa e desativa de
   novo para não mexer no resto) e num clique no "Prêmio" do editor (inofensivo: o novo já abre no de prêmio).

## §K Calibração

Estudo com o motor e os dados reais do Clássico, fora do navegador: **69.120 carreiras** (29.520 da v3.3 + 39.600 novas,
~19 h de CPU em 4 processos). Relatório completo: `v34-calibracao.md` (fora do repositório); limites novos em
`v34-conquistas-novas.json` e emblemas em `v34-desafios-emblema.json`. Nada em `src/` mudou.

### K.1 Por que só 78–79 das 87 saíam

Hoje 82 das 87 já saíram alguma vez e 5 nunca saíram (De Ushuaia a Darién, Mochileiro, Além do Rei, Fora da curva,
Reescreveu a história); o colecionador dedicado para em 82. As marcas vêm do futebol real ou pedem que tudo dê certo em
todas as temporadas (4 Copas: no máximo 3 Copas; 1.300 gols: no máximo 1.193 gols; 10 recordes: no máximo 9 recordes; 24
clubes: no máximo 23 clubes; 10 países sul-americanos: no máximo 9 países). Mais raras que 1 em 1.500 para o jogador
dedicado (plano dedicado de cada uma):

| Conquista | Hoje (plano dedicado) | Vezes em todas | O mais perto |
|---|---:|---:|---|
| De Ushuaia a Darién | 0 em 6.800 (sul-americano no Intenso) | 0 | 9 países (de 10) |
| Mochileiro | 0 em 3.000 (mochileiro no Intenso) | 0 | 23 clubes (de 24) |
| Além do Rei | 0 em 5.250 (artilheiro na Europa, atacante espanhol, francês ou inglês) | 0 | 3 Copas |
| Fora da curva | 0 em 5.125 (goleador ou recordista brasileiro, atacante) | 0 | 1.193 gols |
| Reescreveu a história | 0 em 6.800 (sul-americano no Intenso) | 0 | 9 recordes |
| Só o Pelé | 1 em 5.250 (artilheiro na Europa, atacante espanhol, francês ou inglês) | 1 | com 3 Copas, no máximo 1.098 gols; com mais de 1.000 gols, no máximo 3 Copa(s) |
| Legado imortal | 1 em 1.750 (artilheiro na Europa, atacante espanhol, francês ou inglês) | 10 | nota 96 |
| Acima de todos | 1 em 1.750 (artilheiro na Europa, atacante espanhol, francês ou inglês) | 8 | 0 lenda(s) acima |

### K.2 Limites novos (o agente do jogo aplica; o motor não muda)

| Conquista | Agora | Chance nova (plano dedicado) | Antes, no mesmo plano |
|---|---|---:|---:|
| Só o Pelé (`only_pele`) | Ganhe duas Copas do Mundo e marque mais de 800 gols — no futebol de verdade, só o Pelé conseguiu. `worldCups(c) >= 2 && c.goals > 800` | 1 em 1.313 (4 em 5.250, artilheiro na Europa, atacante espanhol, francês ou inglês) | 1 em 5.250 |
| De Ushuaia a Darién (`ushuaia_to_darien`) | Jogue em clubes de nove países diferentes da América do Sul. `new Set(c.seasons.filter((r) => r.confed === 'CONMEBOL').map((r) => r.country)).size >= 9` | 1 em 1.174 (4 em 4.695, sul-americano no Intenso, goleiro) | 0 |
| Mochileiro (`baldosero`) | Jogue por 23 clubes diferentes, trocando de clube quase toda temporada (no Modo Clássico, só no ritmo Intenso). `clubsOf(c).size >= 23` | 1 em 600 (5 em 3.000, mochileiro no Intenso) | 0 |
| Além do Rei (`world_cup_4`) | Ganhe duas Copas do Mundo e encerre a carreira com Nota de Legado maior que a de Pelé. `c.finished && worldCups(c) >= 2 && beats(c, 'pele')` | 1 em 750 (7 em 5.250, artilheiro na Europa, atacante espanhol, francês ou inglês) | 0 |
| Fora da curva (`goals_1300`) | Marque 1.050 gols na carreira. `c.goals >= 1050` | 1 em 456 (4 em 1.825, goleador colombiano, atacante) | 0 |
| Reescreveu a história (`records_10`) | Quebre seis recordes históricos do futebol real. `c.legacy().historic.length >= 6` | 1 em 854 (6 em 5.125, goleador ou recordista brasileiro, atacante) | 0 |
| Legado imortal (`legacy_95`) | Encerre a carreira com Nota de Legado 94 ou mais. `c.finished && c.legacy().score >= 94` | 1 em 690 (6 em 4.138, caçador argentino, atacante) | 1 em 2.069 |

Com os limites novos, o jogador dedicado (100 carreiras por dia) junta as 87 em **3.874 carreiras na mediana = 39 dias
(~5,5 semanas)**; 25%–75%: 31–50 dias; 90% em até 60 dias. Chegam por último: Futebol completo, De Ushuaia a Darién,
Sete orelhudas, GOAT, Só o Pelé.

### K.3 Desafio do Rei

| Critério | Por carreira (melhor plano) | 1 jogador: dias (média / metade / 90%) | 10 jogadores |
|---|---:|---:|---:|
| 3 Copas + 2 Libertadores (o Desafio do Rei) | 1 em 9.577 | 95,8 / 66,4 / 220,5 | 9,6 / 6,6 / 22,1 |
| 3 Copas + 1 Libertadores | 1 em 5.945 | 59,4 / 41,2 / 136,9 | 5,9 / 4,1 / 13,7 |
| 3 Copas | 1 em 1.050 | 10,5 / 7,3 / 24,2 | 1,1 / 0,7 / 2,4 |
| 2 Copas + 3 Libertadores | 1 em 833 | 8,3 / 5,8 / 19,2 | 0,8 / 0,6 / 1,9 |
| 2 Copas + 2 Libertadores | 1 em 350 | 3,5 / 2,4 / 8,1 | 0,4 / 0,2 / 0,8 |
| 2 Copas | 1 em 69 | 0,7 / 0,5 / 1,6 | 0,1 / 0,0 / 0,2 |
| 1 Copa + 2 Libertadores | 1 em 28 | 0,3 / 0,2 / 0,6 | 0,0 / 0,0 / 0,1 |

### K.4 Desafios de emblema (critério conferido no HallEntry guardado)

| Desafio | Dificuldade | Critério | Dedicado | Ao acaso |
|---|---|---|---:|---:|
| Noite de gala (`noite-de-gala`) ★ | Fácil | `{"bolasOuro": 1, "champions": 1}` | 1 em 12 | 1 em 24 |
| Andarilho campeão (`andarilho-campeao`) | Fácil | `{"clubes": 12, "titulos": 20}` | 1 em 11 | 1 em 74 |
| Bandeira do clube (`bandeira-do-clube`) | Fácil | `{"temporadasMesmoClube": 18, "titulos": 20}` | 1 em 9 | 1 em 417 |
| Hexa e Glória Eterna (`hexa-e-gloria-eterna`) ★ | Médio | `{"copas": 1, "libertadores": 2, "bolasOuro": 1, "nacionalidade": ["BRA"], "copasPelaSelecao": 1}` | 1 em 66 | 0 |
| Era de ouro (`era-de-ouro`) | Médio | `{"bolasOuro": 5, "champions": 3}` | 1 em 79 | 1 em 287 |
| Artilheiro do mundo (`artilheiro-do-mundo`) | Médio | `{"gols": 800, "copas": 1}` | 1 em 114 | 1 em 7.740 |
| Bi do mundo, bi da América (`bi-do-mundo-bi-da-america`) | Difícil | `{"copas": 2, "libertadores": 2}` | 1 em 350 | 0 |
| Imortal (`imortal`) | Difícil | `{"copas": 2, "nota": 92}` | 1 em 583 | 0 |
| As Taças do Rei (`tacas-do-rei-emblema`) ★ | Lendário | `{"copas": 3, "libertadores": 2}` | ~1 em 9.577 | 0 |
| Mil gols e o tri (`mil-gols-e-o-tri`) | Lendário | `{"copas": 3, "gols": 1001}` | 1 em 5.250 | 0 |

★ = sugestão para a faixa da Home. Chaves novas de critério (além de `copas` e `libertadores`): `champions`,
`bolasOuro`, `titulos`, `gols`, `nota`, `clubes`, `temporadasMesmoClube`, `nacionalidade` (lista; a seleção da criação e
a do fim iguais) e `copasPelaSelecao`; de onde sai cada uma está no relatório (§4). Recomendação: a `#/verificar` passa
a comparar também `clubes`, `temporadasMesmoClube` e a seleção da criação.

### K.5 Decisões e diferenças em relação ao contrato da rodada

1. Amostra: 69.120 carreiras sem bônus nem oráculo (o pedido era 20 mil): as 29.520 da v3.3 e 39.600 novas, todas com o
   MESMO pacote do motor (montado uma vez do `src/` de hoje e conferido byte a byte; `raridade.mjs pacote` /
   `--pacote`). Ordem e tamanhos dos lotes mudaram no meio para medir primeiro o que decidia os limites (o goleiro
   sul-americano, o artilheiro na Europa, o recordista e o mochileiro); o lote do nômade da 2ª versão foi cortado (a
   Nômade já sai com o mochileiro marroquino).
2. "Jogador dedicado" = o plano dedicado de cada conquista (política + seleção + posição pelo que a conquista pede): o
   caçador para Copas + Libertadores (Desafio do Rei, GOAT, Futebol completo), o goleador colombiano para gols e média,
   o artilheiro na Europa para 3 Copas, Chuteiras e nota, o goleiro sul-americano que troca de país para De Ushuaia a
   Darién, o mochileiro para clubes. Não é só o caçador: com ele sozinho várias conquistas nunca sairiam.
3. Mudam as 7 que ficam abaixo de 1 em 1.500 nesse plano (as 6 da lista do dono e a Legado imortal, que com a amostra
   toda ficou em 1 em 1.750 no artilheiro na Europa, atacante espanhol, francês ou inglês). Ficam como estão, entre 1 em
   300 e 1 em 1.500: GOAT 1 em 1.495 no caçador argentino, meio-campo (no limite da faixa), Futebol completo 1 em 828 no
   caçador argentino, atacante, Sete orelhudas 1 em 915 no guloso espanhol, Tri, como Pelé 1 em 1.050 no artilheiro na
   Europa, atacante espanhol, francês ou inglês e Máquina de gols 1 em 365 no goleador colombiano, atacante. São as que
   chegam por último na coleção. **Exceção:** Acima de todos fica em 1 em 1.750 no artilheiro na Europa, atacante
   espanhol, francês ou inglês, um pouco abaixo da faixa, porque não há limite menor que mantenha o sentido (é a maior
   nota do Hall; "no máximo uma lenda acima" já seria outra conquista) — sai junto com a nota 95 do mesmo plano.
4. Nômade: já pede 5 confederações no jogo (mudou na v3.3); sai em 1 em 54 no mochileiro marroquino no Intenso. Não
   muda.
5. Além do Rei deixa de ser "4 Copas" (nunca saiu; 3 Copas com a nota acima da do Pelé saiu uma vez) e passa a ser 2
   Copas + Nota de Legado maior que a de Pelé (o "além do Rei" vira o legado). Só o Pelé passa a 2 Copas e mais de 800
   gols (no futebol real, só o Pelé tem as duas marcas); a regra antiga vira o emblema lendário "Mil gols e o tri".
6. De Ushuaia a Darién: a regra foi fixada antes da 2ª amostra do goleiro (9 países se ficasse em 1 em 1.500 ou mais,
   senão 8). Ficou em 9 (8 seria ~1 em 110, fácil demais).
7. Desafio do Rei: 3 Copas + 2 Libertadores é raro demais para a contagem direta (2 carreiras em todo o estudo); a
   chance vem da decomposição P(2 Copas) × P(3ª | 2) × P(2 Libertadores | 2 Copas), com a faixa conservadora (produto
   dos limites).
8. Emblemas: chaves novas de critério; `nacionalidade` exige a seleção da criação e a do fim iguais (quem trocou de
   seleção não vale) e `copasPelaSelecao` conta só as Copas da seleção da criação; "mais de 1.000 gols" = `gols: 1001`
   (o servidor compara com ≥). Dificuldade pela chance do plano dedicado; a de quem joga ao acaso vai junto.
9. Coleção: simulação do colecionador sobre as carreiras do estudo (escolhe o plano com mais conquistas esperadas entre
   as que faltam; a chance que guia a escolha é encolhida para a média, para não premiar a sorte de um grupo pequeno; as
   conquistas saem juntas como saíram na carreira sorteada).
10. Conferência contra o código: uma CÓPIA da árvore com as regras novas no `achievements.ts` (o `src/` não foi tocado),
    empacotada (`raridade.mjs pacote --motor`) e jogada de novo com `scripts/estudos/conferir-v34.mjs`: 160 carreiras
    jogadas de novo nos dois pacotes (todas as do estudo que cumprem alguma regra nova, mais as que ficam a um passo e
    sorteadas), 0 diferenças: motor igual, as 80 conquistas de regra igual iguais e as 7 regras novas batendo com a
    calibração (51 carreiras cumprindo alguma). O agente do jogo pode rodar o mesmo script depois de aplicar as regras
    (o `--novo` passa a ser o pacote do `src/`).

## §I Integração (conferência das seções, desencontros consertados e testes de ponta a ponta)

Feito depois que o servidor, o jogo e o painel pararam: conferi a §A, a §B, a §C e a §K entre si e contra o pedido da
rodada (rotas, campos, ações, poderes, links, textos), consertei os desencontros no lado certo e rodei tudo contra a pilha
real (o `dist-site/` desta árvore + o servidor PHP + MariaDB + o painel, vários aparelhos no Chromium).

### I.1 Desencontros consertados

| o quê | onde estava errado | o que mudou |
|---|---|---|
| A **cópia de segurança restaurada** ("completar") trazia de volta uma carreira-prova apagada pelo dono, mas as conquistas da conta continuavam "não provadas" (o `completar` não mexe nas linhas de `conquistas_usuario` que já existem, então o `prova_pk` ficava vazio até a conta salvar outra carreira) | §A (`_copias.php`) | `restaurarCopia` junta as contas que têm carreira-prova (com lista de conquistas) no arquivo e, depois da transação, roda `contaMudouProvas` em cada uma (carrega o `_desafios.php`: o `equipe.php` não carregava). No e2e (f8): a AMIGAO do B volta e prova de novo as 13 conquistas dela |
| **Restaurar da lixeira** (`restaurar_carreira`) devolvia a carreira sem as colunas da v3.3 (`tem_replay`, `libertadores`, `primeira_em`, `fora_desafio`, `semente_em`) e da v3.4 (`conquistas`, `champions`, `n_clubes`, `mesmo_clube`, `copas_selecao`, `pais_inicio`, `conquistas_v`, `prova_ok`, `prova_verificacao`): a carreira restaurada deixava de provar as conquistas da conta e de valer para desafio, embora o `restaurar_carreira` já refizesse as provas (achado no banco do e2e, etapa f6: a MURALHA restaurada voltou com `champions` e `conquistas` nulos) | §A (`_moderacao.php`) | `COLUNAS_RESTAURAR_V33` e `COLUNAS_RESTAURAR_V34` entram no INSERT (só com o banco da versão e quando a linha guardada na lixeira as tem; a `linha` já era a linha inteira). O emblema retirado quando ela foi apagada não volta sozinho (o admin devolve). Teste novo no `teste-v34.php` |
| A **prévia de link** (`v.php`) não tinha ícone: quem abre o link (antes do `meta refresh`) fazia o navegador pedir `/favicon.ico` na raiz do domínio — que é de outro site (no e2e, um 404 no console) | §A (`_previa.php`) | `<link rel="icon" type="image/svg+xml" href="<site>/lenda/favicon.svg">` no HTML da prévia |
| `#/desafios`, cartão de emblema com "X cumpre, mas não vale: …" ou "O emblema foi retirado pela equipe: …": a frase caía na coluna de 44 px do emblema (uma palavra por linha) e esticava o cartão vizinho | §B (`v34.css`) | `.s4-emb__x { grid-column: 2 }` e `.s4-emb { align-content: start }` (print `h5-E-adulterada-nao-vale`) |
| `?r=usuario`: cada emblema da conta levava só `{id, slug, titulo}` do desafio (o painel tirava o ícone, a cor e a dificuldade da lista dos desafios, guardada 60 s — §C.6 #3) | §A (`admin.php`) | `E.desafio` ganha `emblema {icone, cor}` e `dificuldade` (o painel já usa quando vem). Teste novo no `teste-v34.php` |

Já resolvidos antes da integração (conferido, sem mudança): o topo `emblemas` do `desafios.php?eu=1` (§B.10 #1: o servidor
passou a mandar na rodada 3 dele; o jogo usa o do servidor e só monta pelos `eu.emblema` quando falta); as 4 falhas do teste
do painel da §A.12/§A.14 (o agente do painel acertou o `v33.mjs` e o `LP.NOMES_ACAO_LOG`; o `rodar.sh` completo passa).
Conferido e igual nos três lados: os links do lote (`/lenda/#/verificar?conta=<id>`, o `../#/verificar?conta=` do painel, o
`&candidato=` do de todas as conquistas, `&prova=1` da carreira); `?r=provas`, `prova_verificar` (pedidos de até 50) e o
`?r=carreira` com `meta.conquistas`/`meta.prova`/números novos; `C.prova`, `provasNovas` e `emblemasNovos` do salvar;
`conquistas.php` (`provada`, `verificada`, `carreira`, contagens só das 87); `hall.php`/`perfil.php` com `emblemas`,
`emblemasTotal` e `conquistasProvadas`; os nomes pt-BR de `prova_verificar`, `emblema_retirar`, `emblema_devolver`; o link
de compartilhar `api/v.php?id=…&c=…` (com conta) e o do perfil; o `sitemap.xml` (só `/lenda/` e a política) e o arquivo da
chave do IndexNow no `dist-site/`; nenhum `robots.txt` no build.

### I.2 Testes acrescentados ou mudados

- `teste/integracao/e2e.mjs` — o que a v3.4 muda nas etapas de antes (todas continuam): **b3** o aparelho que perdeu a
  lembrança da semente do servidor (§B.9 #3) salva pelo botão e a carreira prova do mesmo jeito (o servidor guardou a lista
  igual à do HallEntry, `conquistas_v` 2, as conquistas com `prova_pk` = ela); **b4** o texto compartilhado leva o link da
  prévia (`api/v.php?id=<carreira>&c=<convite>`); **c2/b6/g6/g10** o fim da carreira espera o que as sementes fixas
  mandam: 90+ ou carreira-prova com conquista nova sobe sozinha ("auto"), senão o botão (`fimDaCarreira`; a do limite do
  dia que sobe sozinha não prova nada); **f8** apagada pelo dono a carreira deixa de provar e, de volta pela cópia, prova de
  novo; **g1** os 3 de prêmio desativados + os 10 de emblema valendo, a faixa da tela inicial (2 inteiros e "Ver todos", uma
  linha de 44 px, nenhum nome cortado, "Noite de gala" primeiro), a linha "10 desafios valendo" do menu, `#/desafios` com
  os 10 e "Criar conta para ganhar", e, desligados os 10 pelo admin, a faixa some e volta o "Nenhum desafio valendo agora"
  (religados depois); **g4** 13 cartões no painel (3 de prêmio); **g5** com um de prêmio valendo, o destaque no lugar da
  faixa (nunca os dois); **g11** com vencedor, o destaque some e a faixa volta. Etapas novas **h1–h7** (I.3).
- `teste/integracao/atualizar.php` — saindo da v3.3 publicada para a v3.4 (`LENDA_ATUALIZAR_REF=1f6fab4`): a Antiga Dois
  salva na v3.3 uma carreira começada com a semente que o servidor sorteou para ela, com o replay (como as 2 contas reais
  depois do deploy da v3.3); depois do instalar novo: a lista de conquistas guardada, as conquistas dela na conta como
  provadas (`origem carreira`), os emblemas que ela cumpre dados pelo lote do instalar (Noite de gala e Era de ouro), as do
  aparelho da Antiga Um como estavam ("não provadas"), os 10 de emblema ativos e os 3 de prêmio desativados, a 2ª
  instalação com `v34` tudo 0, `conquistas.php` e `desafios.php?eu=1` das sessões de antes — e, como sempre, nenhuma linha
  de antes sumiu nem mudou.
- `teste/teste-v34.php` (+2): o `?r=usuario` com o emblema e a dificuldade em `E.desafio`; restaurar da lixeira devolve
  `tem_replay`, `semente_em`, a lista e os números novos e a carreira volta a provar (os emblemas retirados não voltam).
- `LEIAME.md` (integração): as etapas da v3.4 do `e2e.mjs` e o que o `atualizar.sh` confere saindo da v3.3.

### I.3 O que o e2e confere da v3.4 (etapas h, pela tela)

- **h1** o jogador E cria a conta pelo menu ("Depois" no código) e joga pelos cliques a fila real `v-otima-01` (Expresso,
  centroavante italiano, 8 de 8 escolhas; pico **89**, 2 Bolas de Ouro, 5 Champions, 18 temporadas na Inter, 34 títulos): o
  aparelho lembra que a semente veio do servidor; a carreira **sobe sozinha só como prova** ("auto" sem ser 90+); o servidor
  guarda a lista igual à do HallEntry (18), as 18 ficam provadas na conta e o servidor **dá sozinho** os 2 emblemas fáceis
  que ela cumpre (Noite de gala e Bandeira do clube, `carreira_pk` = ela); o aviso dourado "2 emblemas novos" e "18
  conquistas provadas na conta"; o fim mostra "Salva na sua conta".
- **h2** `#/desafios` com "Você já tem" nos 2 (com o jogador), "Você tem 2 de 10"; a faixa com o ✓ e "você já tem o
  emblema" no `aria-label`; "Seus emblemas" na Minha conta; a tela de conquistas "18 provadas na conta · 0 não provadas" e o
  selo "Provada"; `?eu=1` com o topo `emblemas` e `eu.emblema`; `conquistas.php` com a carreira de cada provada.
- **h3** depois de atualizar o Hall: `hall.php` com os emblemas e `emblemasTotal`, as 2 moedinhas ao lado do apelido no
  Hall da comunidade, o perfil público com os emblemas e "18 provadas", `perfil.php` igual.
- **h4** "Copiar link" do resumo → `api/v.php?id=<carreira>&c=<convite>`; a prévia: 200 HTML, cache de 5 min, `noindex`,
  `og:title` "BERNARDINI · Nota de Legado 72 · LENDA", a descrição com as Bolas de Ouro, os títulos, as temporadas e o
  apelido (sem e-mail), Twitter `summary_large_image`, `og:image` absoluta 1200×630, o `meta refresh` para
  `<site>/lenda/?c=<convite>#/resumo?id=…&de=comunidade` (endereço absoluto), sem script, com o ícone do LENDA; a imagem PNG 1200×630 com cache de 1
  dia, guardada em `lenda-cache/previas/` fora do `public_html` com o número da conta no nome, a segunda vez igual (do
  disco); um celular novo abre o link e chega no resumo da comunidade já como convidado; a prévia do perfil; o id que não
  existe dá a genérica (200); POST → 405.
- **h5** HallEntry adulterada pela API, com 5 Bolas de Ouro a mais (cumpre o Era de ouro): **sem replay** e com o replay
  de verdade mas **com uma semente que o servidor não sorteou** → as duas são salvas, mas `C.prova` null, nenhuma prova,
  nenhum emblema; `?eu=1` diz `sem_replay` e `sem_semente` e `#/desafios` "BERNARDINI cumpre, mas não vale: …".
- **h6** uma 2ª carreira de verdade (semente do servidor, replay) e a mesma com o resumo adulterado: o servidor não refaz
  a carreira, então **o Era de ouro sai na hora** (§A.13 #4); o admin abre a ficha da conta → "Verificar as provas no jogo"
  (`../#/verificar?conta=`) → o lote verifica as essenciais, depois "Todas": a de verdade **bate** e é registrada sozinha
  (`prova_ok = 1`), a adulterada **não bate** e espera o clique; "Registrar as que não bateram" → `prova_ok = 0`, o Era de
  ouro **retirado** com o motivo das diferenças, a conta fica com os 2 de verdade e as 18 conquistas conferidas; o perfil
  sem o retirado; o jogador vê o motivo no `?eu=1`; de volta ao painel (visibilitychange) a ficha se refaz sozinha ("18
  provadas de 87 · 18 conferidas"); o Registro com "Verificou provas".
- **h7** `index.html` com o título de busca, a descrição e o JSON-LD `VideoGame`; `sitemap.xml` só com as 2 páginas de
  `/lenda/`; `/lenda/<chave>.txt` com a chave; nenhum `robots.txt` no build; `scripts/indexnow.mjs --seco` com o
  `keyLocation` em `/lenda/` e as URLs do sitemap, nada mandado.

### I.4 Resultados (rodada final, com todos os arquivos desta árvore)

Pilha: o MariaDB compartilhado (`/run/mysqld/mysqld.sock`), bases em `/srv/lenda-v34-integ*` (755), portas 9030–9038,
bancos `lenda_v34_integ*` (apagados no fim).

- `servidor/teste/rodar.sh` **completo** (com as cargas, o Apache/.htaccess e o teste do painel pelo navegador, com
  `LENDA_PRINTS`): **PASSOU — 1661 verificações** (a v3.4: 81, as 79 da §A.12 e as 2 da I.2) e **PAINEL: PASSOU** —
  `painel.mjs` 129 ok, `correcoes.mjs` 72 ok, `v33.mjs` 135 ok, `mock-v34.mjs` 63 ok, `v34.mjs` 85 ok, nenhuma falha. A
  rápida (`LENDA_TESTE_SEM_CARGA=1`): **PASSOU — 1608**.
- `npx tsc --noEmit -p .`: limpo. `npx vitest run`: **626 ok, 2 pulados** (52 arquivos, 2 pulados).
- `npm run build:site`: ok, 782 arquivos (22,25 MB), com o SEO, o `sitemap.xml` e a chave do IndexNow conferidos pelo build.
- `teste/integracao/e2e.mjs` inteiro (v3 + v3.2 + v3.3 + as etapas h da v3.4), contra o `dist-site/` desta árvore:
  **PASSOU — 433 verificações, 0 falhas** (~17 min; antes 346), nenhum erro de console, nenhum 5xx, nenhuma violação de
  CSP no painel, log do PHP vazio.
- `teste/integracao/atualizar.sh` com `LENDA_ATUALIZAR_REF=1f6fab4` (a v3.3 publicada, com o e-mail de contato novo):
  **PASSOU — 28 verificações** (`_esquema` 33 → 34; nenhuma das 64 linhas de antes mudou nas colunas antigas; a carreira-prova
  salva na v3.3 prova as conquistas dela e dá os 2 emblemas pelo lote do instalar; a 2ª instalação não refaz nada).
- Rodadas que falharam antes (o que era): no e2e, a 1ª rodada inteira deu 426 ok e 7 falhas — 3 do produto (o ícone da
  prévia, o cartão espremido e, achado no banco do e2e, a lixeira e a cópia que não devolviam a prova; I.1) e 4 do teste
  (I.5 #4); no `atualizar.sh`, 1 do teste (as contagens só das 87 e um `??` que tratava `null` como ausente).
- Prints revisados (1440/1366 e 390): `scratchpad/v34-prints/integ/` (`g1-F-home-faixa`, `g1-F-desafios-emblemas`,
  `g1-C-desafios-vazio`, `g5-V-destaque`, `g11-W-desafios-vencedor`, `h1-E-fim-carreira-prova-emblemas`,
  `h2-E-desafios-voce-ja-tem`, `h2-E-home-faixa-com-emblema`, `h2-E-minha-conta-emblemas`, `h2-E-conquistas-provadas`,
  `h3-C2-hall-emblemas`, `h3-C2-perfil-emblemas`, `h4-previa-carreira` — a imagem da prévia —, `h4-Q-link-abre-o-resumo`,
  `h5-E-adulterada-nao-vale`, `h6-painel-ficha-provas`, `h6-jogo-lote-nao-bateu`, `h6-painel-ficha-depois-do-lote` e os de
  antes) e `scratchpad/v34-prints/integ/painel/` (todas as abas do painel em 1440 e 390, pelo `rodar.sh`).

### I.5 Decisões e diferenças em relação ao pedido da rodada

1. **"Uma HallEntry adulterada não ganha emblema nem prova"** vale como está para a adulterada sem replay e para a de
   semente que o servidor não sorteou (h5). A carreira de verdade (semente do servidor + replay) com o resumo adulterado
   **ganha o emblema na hora** e o perde na verificação em lote (h6): o servidor não refaz a carreira (o motor só roda no
   navegador), e o pedido diz "concedido sozinho" (§A.13 #4). Se o dono preferir que o emblema só apareça depois da
   conferência, é uma regra nova (um "emblema verificado"), não um conserto — fica como pendência (I.6).
2. O ✓ da faixa da tela inicial aparece quando a sessão já leu os emblemas da conta (Minha conta, `#/desafios` ou o salvar
   que deu o emblema): a tela inicial não faz um pedido a mais com a conta só para o ✓ (o `desafios.php` da faixa é o
   público, com cache de 60 s; nada pode atrasar a abertura do jogo). O teste volta à tela inicial na mesma sessão.
3. O `restaurar_carreira` passou a devolver também as colunas da v3.3 (o replay, as Libertadores, a hora de entrada e a da
   semente): elas faltavam desde a v3.3 e, sem elas, a carreira restaurada não valia para desafio — consertado junto,
   porque é a mesma linha.
4. Testes que mudaram por causa do produto (não do teste): f8 (a restauração que não devolvia a prova), f6/teste-v34 (a
   lixeira), h4 (o ícone da prévia), h5 (o cartão espremido). Por causa do teste: o destino absoluto do `meta refresh`, o
   `<meta … />` do `index.html`, o `robots.txt` (o `php -S` responde o `index.html` para arquivo que não existe), a saída
   do `indexnow.mjs --seco`, o `.sv-perfil__nums` do perfil e a ficha do painel, que só se refaz no `visibilitychange`
   (o Chromium sem tela não troca de aba sozinho); no `atualizar.php`, as contagens do `conquistas.php` (só as 87:
   `first_goal`/`golden_ball` não estão entre elas).

### I.6 Pendências (para o dono)

1. Deploy (não feito aqui): subir `api/`, `painel/` e o `dist-site/` como de costume e rodar o `instalar.php` uma vez (só
   acrescenta; testado por cima da v3.3 publicada, I.4): ele semeia os 10 desafios de emblema **ativos** e recalcula as 2
   contas reais (o que elas têm de carreira-prova fica provado e dá os emblemas que cumpre; o resto continua na conta como
   "não provado"). Depois: `node scripts/indexnow.mjs --conferir` e mandar o `sitemap.xml` no Bing Webmaster e no Google
   Search Console da propriedade `https://oprojeto.online/lenda/`.
2. Verificar em lote as carreiras-prova das 2 contas reais pelo painel (ficha → "Verificar as provas no jogo") assim que o
   deploy terminar: os emblemas já saem sem a conferência (I.5 #1).
3. Opcional: "emblema verificado" (I.5 #1), se o dono quiser que nenhum emblema apareça antes da conferência.
4. Sem commit, push nem deploy nesta rodada.

## §E Correções (achados confirmados na revisão da v3.4)

Cada achado confirmado (lentes fraude-segurança e correção-uso), o que mudou e o teste que falhava antes. Servidor:
`teste/teste-v34-corr.php` (incluído pelo `teste.php` depois do `teste-v34.php`); jogo: `src/site/v34corr.test.ts`; no navegador,
o roteiro do §E.12. Banco `lenda_v34_corr*`, portas 9060–9069.

1. **Apagar a carreira-prova antes da verificação deixava o emblema para sempre** (alta; `carreiras.php` apagar). Agora o
   emblema que ela deu só fica se ela já **bateu** na verificação (`prova_ok = 1`, a A.6 vale para essa); o de uma carreira
   ainda não verificada passa para outra carreira-prova da conta que cumpra (`emblemasSemACarreira`) ou sai pelo sistema
   ("A carreira foi apagada antes de ser verificada."). Salva de novo (a semente ainda é do servidor), ela volta a ser prova,
   aparece no `?r=provas` e o emblema volta com ela — sempre com uma carreira que o admin pode verificar. A mais (o mesmo
   buraco por outro caminho): salvar de novo com um conteúdo que **não cumpre mais** (ex.: 1.001 → 900 gols) confere os
   emblemas que ela deu (o daquele desafio passa para outra ou sai pelo sistema). Teste §E.1.
2. **O `prova_verificar ok:true` selava o conteúdo salvo depois do GET do admin** (média; `_provas.php`). O `?r=carreira` manda
   `meta.versao` (sha1 do HallEntry guardado); o jogo devolve `versao` em cada resultado (uma carreira e o lote, que guarda a
   versão de cada linha) e o servidor confere com a linha travada (`FOR UPDATE`, o salvar espera): outra versão → `pulados:
   [{carreira, motivo: "mudou"}]`, nada gravado; a tela diz "O dono salvou esta carreira de novo… verifique de novo". `versao`
   fora de 40 hexadecimais → `400 resultados`. Sem `versao` (pedido feito à mão, os scripts de teste) vale o conteúdo de agora,
   como antes — o jogo sempre manda. Teste §E.2 + vitest.
3. **O "não bateu" não ficava** (média). Tabela nova `provas_nao_bateu (usuario_id, semente, carreira_id, em, verificacao)`
   (só `CREATE TABLE IF NOT EXISTS`; o instalar só acrescenta; entra no backup e sai com a conta na LGPD): o `ok:false` guarda
   a semente do replay da carreira; a carreira salva com essa semente — a mesma de novo com 1 byte diferente, apagar e salvar,
   o mesmo replay com outro id — nasce `prova_ok = 0` com a verificação do admin, até um `ok:true` de uma carreira dessa
   semente tirar a linha ("até um admin liberar"). Reforço: salvar com outro conteúdo só zera um 0 quando a semente mudou.
   Banco sem a tabela: como antes (nunca 500). Teste §E.3.
4. **"id + espaços" desenhava uma imagem nova por variação** (média; `_previa.php`/`v.php`). O `v.php` trata id com espaço nas
   pontas como inexistente (a genérica) e a `previaCarreira` usa daí em diante o `carreira_id` do banco (chave do arquivo,
   `q`, destino); teto novo de desenhos por quem pede (`PREVIA_GERAR_IP = 60` a cada 10 min, pelo código do IP de sempre, que
   some em ~20 min — o IP nunca é gravado), além dos 600 do site. A genérica no lugar de uma carreira ou de um perfil que não
   está no Hall (ou do teto cheio) sai com `Cache-Control: public, max-age=60` (antes 300 a página e 86400 a imagem), para os
   robôs das redes pedirem de novo logo. Teste §E.4.
5. **Ícone "constructor" derrubava as telas** (baixa). Servidor: `lerEmblema` aceita só os 38 de `DESAFIO_ICONES` (os do mapa
   das conquistas, sem `goat`; outro → `400 emblema`) e `emblemaDe` devolve `medal` para o gravado fora do mapa. Jogo:
   `achievementIcon` busca só nas chaves do próprio mapa (`hasOwnProperty`). Painel (`emblemas.js`): idem no
   `iconeEmblema`/`iconeEmblemaValido`. Teste §E.5 + vitest (o `renderToString` da `FilaEmblemas` com "constructor").
6. **O robots.txt da raiz bloqueia `/lenda/` inteira** (alta, **decisão do dono**). Hoje `https://oprojeto.online/robots.txt`
   tem `User-agent: *` + `Disallow: /` de propósito ("domínio de trabalho"). Enquanto for assim, o SEO do 5b (título,
   JSON-LD, sitemap, IndexNow) não indexa nada e o X não mostra o card da prévia (o Twitterbot obedece); o WhatsApp não é
   afetado. Nada aqui mexe no arquivo (é de outro site). Registrado no `LEIAME.md` §5e (passo 5, com as linhas a pedir:
   `Allow: /lenda/` no grupo do `*` e, se quiser, `Sitemap: https://oprojeto.online/lenda/sitemap.xml`; só o card do X: um
   grupo `User-agent: Twitterbot` com `Allow: /lenda/` e `Disallow: /`) e no `build-site.mjs`. O `indexnow.mjs --conferir`
   passa a ler o robots.txt da raiz (`robotsPermite`, `conferirRobots`: Googlebot, Bingbot, YandexBot, Twitterbot,
   facebookexternalhit em `/lenda/`, `/lenda/sitemap.xml` e `/lenda/api/v.php`) e avisa quem está bloqueado e o que pedir. As
   pendências B.10 #3 e I.6 #1 dependem disso. Teste: vitest (com o robots.txt de hoje).
7. **Retirada automática sem olhar outra carreira** (média; `_desafios.php`). `retirarEmblemasDaCarreira` (não bateu, apagada
   pela moderação) passa o emblema para outra carreira-prova da conta que cumpra o desafio (a que entrou primeiro; o `em` fica);
   sem nenhuma, retira com `quem = 'sistema'`. O `concederEmblemas` faz voltar o retirado **pelo sistema** quando uma
   carreira-prova da conta cumpre (com a carreira nova, `em` de agora, sem motivo; vai no `emblemasNovos`); o tirado à mão pela
   equipe (`emblema_retirar`) nunca volta sozinho. Muda a regra da A.0/A.6 ("retirado não volta sozinho" vale só para o da
   equipe) e o I.1 da lixeira: restaurar a carreira apagada pela moderação devolve os emblemas que o sistema tinha tirado (o
   teste antigo do `teste-v34.php` foi acertado para isso). Teste §E.7.
8. **A carreira-prova que dá emblema ficava no aparelho** (média; `vigias.ts`). O `salvarSozinha` e o `sincronizarAoEntrar`
   mandam também a carreira-prova que cumpre algum desafio de emblema valendo cujo emblema a conta ainda não tem
   (`emblemasQueDaria`: a lista pública e os emblemas da conta que a sessão já leu, senão o `?eu=1`; sem saber, sobe — o
   servidor decide e o salvar é idempotente). O critério é conferido no jogo com a mesma conta do servidor
   (`numerosParaCriterio`, `carreiraCumpre`, `emblemasQueACarreiraDa` em `desafios.ts`; a nota sem olhar a versão dos pesos: o
   salvar manda a de agora). Os módulos dos desafios só carregam no fim de uma carreira-prova (import dinâmico): nada na
   abertura do jogo. Teste: vitest + o roteiro do §E.12.
9. **O link da prévia saía antes de a carreira estar no Hall** (média; `pontes.ts`). O link de compartilhar é o da prévia só
   quando a carreira já está no Hall público: o `preparar(carreiraId)` do card (a ponte ganhou o parâmetro) confere pelo C da
   conta (`no_hall`) ou pelo `hall.php?id=` (público, cache do navegador); antes da resposta, fora do Hall, sem conta ou sem
   rede: o link de convite de sempre. O e2e b4 (carreira que acabou de entrar na conta) passa a esperar o link de convite
   quando o `hall.php?id=` dela responde 404; o h4 (depois do Hall atualizado) continua com o da prévia. Teste: vitest.
10. **A faixa da Home cortava a frase no celular e escondia o 3º desafio só da vista** (baixa; `DestaqueDesafio.tsx`,
    `v34.css`). `medirFaixa` (ao abrir e a cada mudança de largura, `ResizeObserver`; sem ele, como antes): no celular,
    "com emblema" sai inteira ou não sai (`.s4-faixa.is-curta`: fica "Desafios", os 3 emblemas e "Ver todos"; de 320 a ~388
    px); no computador, o desafio que desceu para a 2ª linha escondida ganha `tabindex=-1`, `aria-hidden` e `visibility:
    hidden`. Diferença da B.5: abaixo de ~388 px a frase é só "Desafios". Teste: vitest + o roteiro do §E.12 (320, 360, 375,
    390, 1440).
11. **"N conquistas provadas na conta" com dois sentidos** (baixa; `vigias.ts`). As desta carreira: "+2 conquistas provadas na
    conta" (`textoProvasNovas`; no 90+, "… · +2 conquistas provadas na conta (40 no total)"); o total da conta: "Agora são 40
    conquistas provadas na conta" (`textoProvasTotal`). Diferença da B.3 (as frases). Teste: vitest.
12. **Roteiro no navegador** (pilha do `subir.sh` com o build desta árvore; o roteiro fica fora do repositório, no scratchpad
    da rodada): a faixa em 320, 360, 375, 390, 412, 560, 1024 e 1440 px (E.10); uma conta com as 87 provadas por uma carreira
    antiga joga pela tela a fila real `v-otima-01` (pico 89, nenhuma conquista nova, cumpre Noite de gala e Bandeira do clube)
    e a carreira sobe sozinha e ganha os 2 emblemas (E.8); o "Copiar link" dela fora do Hall (convite) e, refeita a
    fotografia, no Hall (a prévia com o cartão) (E.9); uma conta com 5 provadas joga a fila `v-otima-05` e o aviso diz "+17
    conquistas provadas na conta … Agora são 22 conquistas provadas na conta" (E.11).

Testes antigos acertados (o produto mudou, não o teste): `teste-v34.php` — restaurar da lixeira devolve os emblemas que o
sistema tirou (§E.7) e o `D.emblemas`/`?r=desafio` contam o retirado pelo apagar sem verificação da seção 2 (§E.1);
`src/site/v34.test.ts` — o Compartilhar só leva a prévia com a carreira no Hall (§E.9); `teste/integracao/e2e.mjs` b4 — a
carreira que acabou de entrar na conta leva o link de convite quando o `hall.php?id=` dela responde 404 (§E.9).

Decisões: (a) no §E.1, a carreira **verificada** apagada pelo dono mantém o emblema (A.6), e nenhuma carreira verificada perde
emblema por ser apagada; (b) no §E.2, a `versao` é opcional no pedido para não quebrar quem chama à mão — o caminho do jogo
manda sempre; (c) no §E.9 o "logo depois de terminar" vai com o link de convite (o cartão do LENDA): aceitar no `v.php` a
carreira que ainda não está na fotografia mostraria nas redes o que o Hall ainda não mostra (A.10/A.11) e o destino
(`#/resumo?…&de=comunidade`) não abriria até a próxima fotografia; (d) o "não bateu" guardado pela semente (não pelo id), porque
o mesmo replay sob outro id era a variante mais barata.

Resultados (21/10/2026; MariaDB compartilhado; bancos `lenda_v34_corr*`, portas 9060–9068, bases em `/srv/lenda-v34-corr*`,
tudo apagado no fim):

- **Antes das correções** (uma cópia do servidor com as correções desfeitas, os testes de agora): `rodar.sh` rápido **FALHOU —
  22 de 1637**, todas nas verificações novas do `teste-v34-corr.php` (§E.1 a §E.7) e na do restaurar da lixeira (§E.7).
- `servidor/teste/rodar.sh` **completo** (cargas, Apache/.htaccess, painel pelo navegador): **PASSOU — 1690 verificações**
  (29 do `teste-v34-corr.php`); **PAINEL: PASSOU** — `painel.mjs` 129, `correcoes.mjs` 72, `v33.mjs` 135, `mock-v34.mjs` 63,
  `v34.mjs` 85, nenhuma falha.
- `npx tsc --noEmit -p .` limpo; `npx vitest run` **641 ok, 2 pulados** (53 arquivos; `v34corr.test.ts` com 15); `npm run
  build:site` ok (o pacote inicial não mudou: o código novo dos desafios está no pedaço dos desafios, carregado no fim de uma
  carreira-prova).
- Roteiro do §E.12 no navegador: **PASSOU — 19 verificações**, nenhum erro de console.
- `teste/integracao/e2e.mjs` inteiro: **PASSOU — 433 ok, 0 falhas** (na 1ª rodada, feita junto com outras suítes na mesma
  máquina, f7 e g13 falharam por tempo no aparelho do B — a tela da criação não trocou de rota; repetido sozinho, passou, e o
  f7 isolado passou 3 de 3); `teste/integracao/atualizar.sh` saindo da v3.3 publicada (`LENDA_ATUALIZAR_REF=1f6fab4`):
  **PASSOU — 28**.

Pendências (para o dono): o robots.txt da raiz (§E.6, decisão dele); `candidato_verificar` (desafios de prêmio, hoje
desativados) não leva a `versao` do §E.2 — o mesmo cuidado vale se um desafio de prêmio for ativado.

## §F Rodada final (21/10/2026, todos os arquivos desta árvore, depois do §E)

Pilha nova: o MariaDB compartilhado (`/run/mysqld/mysqld.sock`), base `/srv/lenda-v34-final` (755), portas 9070–9079
(`rodar.sh`: 9070, Apache 9071, concorrência 9074, painel 9076; `e2e`: 9078; `atualizar.sh`: 9079), bancos
`lenda_v34_final*`. Uma suíte por vez (sem outra carga na máquina). Nada precisou de conserto nesta rodada.

- `npx tsc --noEmit -p .`: limpo (código 0).
- `npx vitest run`: **641 ok, 2 pulados** (53 arquivos ok, 2 pulados: os estudos `BALANCE=1` e `LEGACY_REACH=1`, só sob
  pedido).
- `npm run build:site`: ok, **782 arquivos, 22,27 MB** (api/ 37 arquivos, painel/ 18, `privacidade.html`, `dados/2026-09-28.ff31cb13.json`
  da verificação por replay, `sitemap.xml` com as 2 páginas públicas e a chave do IndexNow `d94ea45c….txt`); título
  "LENDA · Jogo de carreira de futebol online grátis", a descrição e 1 JSON-LD no `index.html`.
- `servidor/teste/rodar.sh` **completo** (cargas, Apache/.htaccess, painel pelo navegador): **PASSOU — 1690 verificações**;
  **PAINEL: PASSOU** — `painel.mjs` 129, `correcoes.mjs` 72, `v33.mjs` 135, `mock-v34.mjs` 63, `v34.mjs` 85, 0 falhas.
- `teste/integracao/e2e.mjs` inteiro (pilha nova do `subir.sh` com o `dist-site/` desta árvore): **PASSOU — 433 ok, 0
  falhas** (1.002 s), sem erro de console, sem 5xx, sem violação de CSP no painel, log do PHP vazio.
- `teste/integracao/atualizar.sh` saindo da v3.3 publicada (`LENDA_ATUALIZAR_REF=1f6fab4`): **PASSOU — 28**.
- `node scripts/indexnow.mjs --seco`: as 2 URLs, nada mandado.
- `dist-site/` conferido: `api/` igual a `servidor/api/` (`diff -r` vazio); `painel/` igual a `servidor/painel/` menos o
  `geradoEm` do `nomes.json`, que o build refaz de propósito (o resto do arquivo é igual); nenhum teste, `_config*`, `.md`,
  `.env`, log nem segredo; sem `robots.txt` (o da raiz é de outro site). A prévia guardou o cache em `lenda-cache/previas/`,
  ao lado da config, fora do `public_html`.
- Limpeza: bancos `lenda_v34_*` apagados; os `php -S`, o Apache e o Chromium encerrados pelo PID (os scripts e o do `e2e`
  pelo `php.pid`); as pastas das pilhas apagadas (ficaram só os logs em `/srv/lenda-v34-final/`).
