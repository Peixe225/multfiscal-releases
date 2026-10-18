# LENDA · CONTRATO v3.3 (As Taças do Rei, e-mail verificado, Fale conosco, perfil público)

Continua o CONTRATO.md, o CONTRATO-v3.md e o CONTRATO-v32.md (tudo de lá vale; aqui só o que é novo ou muda). Cada seção
é escrita por quem implementou; toda diferença em relação ao contrato da rodada fica registrada na seção de quem mudou.
O prêmio dos desafios é um texto livre que o admin escreve (campo `premio`); os desafios nascem desativados.

## §A Servidor

Implementado: os itens 1 a 6 do contrato da rodada e as rotas de admin dos itens 2 e 5 (o "Precisa de atenção", o pulso
e a coluna/filtro de e-mail verificado dos itens 2 e 8 do lado do servidor). Erro sempre `{"erro","mensagem"}` em pt-BR;
JSON `no-store` (salvo onde dito); paginado = `{total, pagina, porPagina: 50, itens}`; datas em ISO UTC; o `em` dos
candidatos vem com milésimos (`2026-10-18T12:00:00.123Z`). IP nunca gravado (os limites usam o HMAC diário de sempre).

### A.1 Arquivos

- Novos: `api/suporte.php`, `api/desafios.php`, `api/perfil.php` (rotas), `api/_desafios.php` (critério, requisitos,
  avaliação, candidatos, limite diário, os de fábrica, as rotas `?r=desafios|desafio|suporte` e as ações novas do admin),
  `api/_suporte.php` (Fale conosco do lado do admin), `teste/teste-v33.php` (incluído pelo `teste.php`) e duas amostras
  reais em `teste/amostras/v33/` (`v-intenso-03`, `v-otima-02`; numa subpasta para não mudar o teste antigo que conta as
  amostras).
- Mudados: `_schema.sql`, `instalar.php`, `_lib.php` (`LENDA_ESQUEMA = 33`, `esquemaV33()`, a chave `partidas_dia_max`, a
  limpeza), `_admin.php` (só o `PODERES_ACAO`), `_contas.php` (U, código de confirmação, LGPD), `_carreiras.php` (replay,
  `camposC()`, Libertadores), `_hall.php`/`hall.php` (`perfil`), `carreiras.php`, `conta.php`, `conquistas.php`, `e.php`,
  `admin.php`, `_atencao.php`, `_copias.php` (backup), `.htaccess` (`suporte.php` com `no-store`), `privacidade.html`,
  `LEIAME.md` (§5d e o teste). Nos testes antigos, só o que o contrato mudou: `C.temReplay` e `perfil` nas listas de
  campos, `emailVerificado` no item de Usuários, `_esquema = 33`, o regex do cache público (desafios/perfil), as rotas novas
  no `.htaccess` do Apache e, nos dois testes que contam o `email_log`, tirar antes o e-mail de confirmação do cadastro.

### A.2 Banco (instalar.php)

Uma coluna/índice por linha, coluna nova `NULL` ou com `DEFAULT`, sem `FOREIGN KEY`/`CHECK`; o instalar só acrescenta e é
idempotente (rodar de novo: `alteracoes: []`, `v33: {libertadores: 0, desafios: 0}`).

- `usuarios.email_verificado_em DATETIME NULL` (+ índice). Contas antigas começam não verificadas.
- `carreiras.tem_replay` (0/1), `libertadores` (NULL = carreira de antes da v3.3; o instalar preenche lendo o HallEntry
  guardado, no orçamento de ~20 s de sempre, e conta em `faltam`), `primeira_em` (hora do servidor em que a carreira entrou
  na conta; fica a da primeira vez; NULL = antes da v3.3), `fora_desafio` (`limite_diario` ou NULL; fica a da primeira
  marca) e o índice `(tem_replay, copas)`.
- `verificacoes_email(usuario_id PK, codigo_hash, expira_em, tentativas, criado_em)` — tabela própria (a `redefinicoes`
  tem o e-mail como chave primária e não dá para acrescentar o tipo sem mexer nela).
- `partidas_dia(usuario_id, dia DATE, n, PK(usuario_id, dia))`: todas as partidas contadas da conta no dia de Brasília
  (também as que passaram do limite). Some em 40 dias.
- `mensagens_suporte(id, protocolo UNIQUE, usuario_id NULL, email NULL, tipo, mensagem, pagina, criado_em, status,
  resposta, respondida_em, quem, atualizada_em)`.
- `desafios(id, slug UNIQUE, titulo, descricao, regulamento, premio, criterio, requisitos, ativo, inicio NULL, fim NULL,
  criado_em, vencedor_usuario_id NULL, vencedor_carreira_pk NULL, vencido_em NULL, ordem, atualizado_em, vencedor_candidato)`.
  **Diferença:** `inicio` é NULL até a ativação (NULL = "começa quando for ativado"; `desafio_ativar` grava a hora); e
  `vencedor_candidato` (o id do candidato que venceu) a mais.
- `desafio_candidatos(id, desafio_id, chave, carreira_pk NULL, carreira_id, jogador, copas, libertadores, usuario_id,
  em DATETIME(3), estado, verificacao, motivo, decidido_em, quem)`. **Diferença:** a unicidade é `UNIQUE(desafio_id, chave)`
  com `chave = c<carreiras.id>` (desafio de carreira: um candidato por carreira) ou `u<usuarios.id>` (todas as conquistas:
  um por conta) — um `UNIQUE(desafio_id, carreira_pk)` deixaria várias linhas com `carreira_pk` NULL. A foto da carreira
  (id do HallEntry, jogador, Copas, Libertadores) fica no candidato para o painel ainda mostrar se ela for apagada.
- Semeados (`INSERT IGNORE` pelo slug; o que o admin mudou nunca é mexido), **desativados e com `premio` vazio**:
  `tacas-do-rei` ({copas:3, libertadores:2}), `tacas-do-rei-copas` ({copas:3}) e `todas-as-conquistas`
  ({todasConquistas:true}); requisitos `{partidasMin:30, emailVerificado:true, publicadoNoHall:true, top3Perfil:true}` (no
  de conquistas, `publicadoNoHall` e `top3Perfil` vêm `false`: não há carreira). Cada um com um regulamento de partida
  (o que vale e os requisitos, sem nada sobre o prêmio), que o admin edita.
- `site_config._esquema = 33`. **Até o instalar rodar** (`_esquema` 32), as rotas do jogo não tocam em nada novo: salvar
  carreira, conta, Hall e medição seguem como na v3.2; `suporte.php`, `verificar_email` e `reenviar_verificacao` respondem
  `503 indisponivel`; `desafios.php` responde `{desafios: []}`; as telas novas do admin, `503 instalar`.
- Backup e cópias (`_copias.php`): entram `desafios`, `desafio_candidatos` e `mensagens_suporte` (o "substituir" os
  regrava); ficam de fora os códigos e as partidas por dia. Restaurar um desafio vencido por uma conta excluída depois da
  cópia traz o desafio sem o vencedor.

### A.3 E-mail verificado (item 1)

- `U.emailVerificado: bool` (em toda resposta com U).
- `cadastrar` grava um código de 6 dígitos (24 h; no banco só o HMAC de `conta|e-mail|código`: trocar o e-mail invalida o
  código) e manda o e-mail **depois de responder** (`terminarResposta`; `email_log.tipo = verificacao`). Teto do site para
  esses e-mails: 200 a cada 10 min e 2.000 por dia; passou, o cadastro sai sem o e-mail (o jogador pede outro).
- `POST conta.php {acao:"verificar_email", codigo}` (texto de 6 dígitos ou número) → `200 {usuario:U}` (já verificada:
  `200` sem mudar nada) | `400 codigo_invalido` (formato, errado, vencido, de outro e-mail ou gasto: 5 erros por código) |
  `429 limite` (10 tentativas a cada 10 min por conta) | `401`/`403 suspenso`. Confirmar avalia os desafios da conta.
- `POST conta.php {acao:"reenviar_verificacao"}` → `200 {ok:true}` (código novo; o anterior deixa de valer) | `200 {ok:true,
  jaVerificado:true}` (sem e-mail) | `429 limite` (3 a cada 10 min e 10 por dia por conta, e o teto do site).
- Trocar o e-mail: não há rota que troque o e-mail da conta; o HMAC preso ao e-mail faz o código antigo não valer se um
  dia houver. Quem trocar o e-mail (código novo) tem de zerar `email_verificado_em` junto.
- Admin: `POST {acao:"reenviar_verificacao", id}` (poder `usuarios`) → `{ok, enviado, para: "jo***@…"}` (`email_log.tipo =
  admin_verif`) | `409 ja_verificado` | `404`; 3 por conta a cada 10 min. `?r=usuarios` traz `emailVerificado` em cada
  item, o filtro `verificado=1|0` e `contagens.verificado: {sim, nao}`; `?r=usuario` traz `emailVerificado`,
  `emailVerificadoEm`, `desafios` (as candidaturas: `{id, estado, em, motivo, carreiraPk, jogador, desafio:{id, slug,
  titulo}}`) e `mensagens` (`{id, protocolo, tipo, status, criadoEm}`).

### A.4 Fale conosco (item 2)

- `GET suporte.php` → `{email: "contato@oprojeto.online" (o email_remetente da config), tipos: [{id, nome}], min: 10,
  max: 2000}` (a mais: o jogo mostra o e-mail e os tipos sem fixar nada).
- `POST suporte.php {tipo: duvida|ideia|problema|recomendacao|outro, mensagem (10 a 2000, quebras de linha ficam),
  email? (obrigatório sem conta; com conta é ignorado e a coluna fica NULL), pagina? (até 120), site?}` →
  `201 {ok:true, protocolo: "8 letras"}`. `site` preenchido = isca: `201` igual, nada gravado. Erros: `400 tipo`,
  `mensagem_curta`, `mensagem_longa`, `email_invalido`, `json`; `403 origem` (Origin e JSON como nas outras rotas); `429
  limite`. Limites: 5 a cada 10 min por IP (HMAC diário), 20 por dia por conta, 300 a cada 10 min no site.
  **Diferença:** só contam no limite as mensagens que passaram na conferência (um erro de digitação não gasta a vez; a isca
  conta).
- Admin (`?r=suporte`, poder `ver`): `?status=nova|lida|respondida|arquivada&tipo=&q=&pagina=` (q procura no texto, no
  apelido, no protocolo, no e-mail exato e no id) → paginado, mais novas primeiro, `itens: [{id, protocolo, tipo, mensagem,
  pagina, criadoEm, status, resposta, respondidaEm, atualizadaEm, quem: {codigo, nome}|null, usuario: {id, apelido}|null,
  email (o da conta, ou o deixado por quem não estava logado), comConta}]`, `contagens: {nova, lida, respondida,
  arquivada}`, `novasPorTipo`, `contato`.
- `POST suporte_status {id, status}` → `{ok, status}`; `suporte_lote {ids (1 a 100), status}` → `{ok, feitos, pulados:
  [{id, motivo: nao_encontrada|ja_estava}]}`; `suporte_responder {id, resposta (até 4.000)}` → manda pelo `enviarEmail`
  (tipo `suporte`, no `email_log`) a resposta com a mensagem original citada e o protocolo, e marca `respondida` →
  `{ok, enviado, status, para: "jo***@…"}`; não saiu: a resposta fica guardada e o status não muda (`enviado: false`); sem
  e-mail → `409 sem_email`; 5 respostas por mensagem a cada 10 min. Poder `usuarios` (o papel Suporte tem). No registro,
  nunca o texto nem o e-mail.
- "Precisa de atenção": `suporte_parado` (nível `acao`, mensagens `nova` há mais de 24 h, link `{aba: "mensagens", filtro:
  "nova"}`). Pulso (`painel.php?so=agora`): `acao.mensagensNovas` e `filas.mensagens` (md5 das 100 novas mais recentes).
- Mensagens com mais de 12 meses saem na limpeza leve. Excluir a conta apaga as dela e as que a pessoa mandou sem entrar
  com o mesmo e-mail.

### A.5 Limite de partidas por dia (item 3)

- Config `partidas_dia_max` (padrão 100, de 10 a 10.000; `config_invalida` fora disso).
- Cada partida contada pelo `e.php` (as pareadas de sempre) soma em `partidas_dia` do dia de Brasília; com `n` acima do
  limite ela **não** soma em `partidas_conta` (o resto da medição segue igual).
- Carreira salva num dia em que a conta passou do limite fica com `fora_desafio = limite_diario` e não vale para desafio.
  **A mais:** vale também o dia em que ela terminou (`finishedAt`), quando é um dia passado: jogar 300 partidas à noite e
  salvar depois da meia-noite não escapa. A marca não sai ao salvar de novo.

### A.6 Replay (item 4)

- O servidor guarda o HallEntry inteiro (com `replay`). Confere: `{v:1, seed:[a0, a1] (inteiros de 0 a 2^32-1), identity
  (objeto até 2 KB), pace ([a-z_-], até 16), picks: lista de até 600 {id (até 80), kind ([a-z0-9_-], até 24), idx (-1 a
  999), pen (null, texto até 16 ou número), n (0 a 999)}, bonusOvr (0 a 20), dados (texto de 1 a 64, sem controle)}` e o
  tamanho do replay (até 64 KB em JSON). Chaves a mais são aceitas. **Diferença:** replay fora do formato, grande demais
  ou numa carreira do Imersivo **sai do HallEntry** antes de guardar e a carreira é salva sem ele (`temReplay: false`):
  a carreira nunca é recusada por causa do replay.
- `C.temReplay: bool` (lista, salvar, publicar e a ficha do admin). `?r=carreira` (o que o `#/verificar` lê) traz
  `meta.temReplay`, `meta.libertadores` e `candidatos: [{id, estado, em, desafio: {id, slug, titulo}}]` dessa carreira.

### A.7 Desafios (item 5)

- **Avaliação** (`avaliarDesafiosConta`): ao salvar, publicar e apagar carreira, ao sincronizar conquistas, ao confirmar o
  e-mail, ao mudar o modo do Hall (perfil), a cada partida que soma na conta (`e.php`) e quando o admin libera uma
  carreira (`mostrar_carreira`/lote), reativa a conta ou a devolve ao Hall. Ao ativar (ou salvar o critério, os requisitos
  ou o prazo de um desafio valendo), o servidor avalia todas as contas que podem cumprir (por até 10 s). Só desafio ativo,
  sem vencedor e dentro do prazo (`inicio <= agora < fim`); o candidato nasce `pendente` com `em` = hora do servidor (com
  milésimos) em que a conta cumpriu tudo; "o primeiro" = menor `em` (empate: menor id).
- **Carreira que vale:** cumpre o critério (`copas >=`, `libertadores >=`, tirados do HallEntry guardado), do Clássico, com
  replay, sem `fora_desafio`, e entrou na conta (`primeira_em`) depois do início (e antes do fim) do desafio. **A mais:** a
  carreira salva antes do início não vale (`antes_do_inicio`). Requisitos: conta ativa, `partidas_conta >= partidasMin`,
  e-mail confirmado; `publicadoNoHall` = aparece no Hall público pelas regras de agora (não oculta, não suspeita, nota da
  versão atual, conta no Hall e, no "Eu escolho", marcada); `top3Perfil` = entre as 3 que o perfil mostra. **Diferença:** a
  carreira de nota alta que só espera a revisão do admin (`suspeita = revisao`) conta como publicada (ela entra no Hall
  quando for conferida; o admin confere a carreira de qualquer jeito antes de declarar o vencedor).
- **Todas as conquistas:** as 87 do jogo (`CONQUISTAS_IDS` em `_desafios.php`, iguais às de
  `src/engine/career/achievements.ts`: o teste confere) em `conquistas_usuario`; ids inventados não contam.
- `GET desafios.php` (público, `Cache-Control: public, max-age=60`, sem escrita no banco) → `{desafios: [{slug, titulo,
  descricao, regulamento, premio, criterio, requisitos, ativo, inicio, fim, encerrado, vencedor, pendentes}]}`. Só os
  ativos e os que já têm vencedor (o rascunho desativado não aparece). `encerrado` (a mais) = vencido ou depois do fim.
  `vencedor: {apelido, jogador, carreiraId, perfil (código do perfil), em (o do candidato), declaradoEm} | null`; conta do
  vencedor excluída: `{apelido: null, jogador: null, carreiraId: null, perfil: null, em: null, declaradoEm, excluido: true}`.
  `pendentes` = candidatos pendentes ou verificados.
- `GET desafios.php?eu=1` (logado: `401` sem sessão, `403 suspenso`; `no-store`; 120 a cada 10 min por conta) → a mesma
  lista, cada desafio com `eu: {partidas (partidas_conta), partidasMin, emailVerificado, partidasHoje, partidasDiaMax,
  conquistas?, conquistasTotal? (no de conquistas), carreirasQueCumprem: [{carreiraId, jogador, publicada, noTop3,
  temReplay, vale, motivo, motivoTexto}] (até 20), candidato: {estado, motivo, em, carreiraId} | null}`. `motivo`:
  `imersivo | sem_replay | limite_diario | antes_do_inicio | depois_do_fim | nao_publicada | fora_do_top3 | null`
  (`motivoTexto` = a frase pronta). O candidato mostrado é o melhor da conta (vencedora > verificada > pendente > recusada).
- Admin (GET com `ver`): `?r=desafios` → `{itens: [D], partidasDiaMax, conquistasTotal}`; `?r=desafio&id=&estado=&pagina=`
  → `{desafio: D, candidatos: paginado de K}` na ordem do `em`. `D = {id, slug, titulo, descricao, regulamento, premio,
  criterio, requisitos, ativo, inicio, fim, criadoEm, atualizadoEm, ordem, valendo, encerrado, vencedor: {candidatoId,
  usuario: {id, apelido}|null, carreira: {pk, carreiraId, jogador}|null, em, declaradoEm, excluido}|null, candidatos:
  {pendente, verificada, recusada, vencedora, total}}`. `K = {id, estado, em, motivo, decididoEm, quem, verificacao,
  primeiro (o primeiro que ainda conta), usuario: {id, apelido, status, tipo, emailVerificado, partidasConta}, carreira:
  {pk, carreiraId, jogador, copas, libertadores, existe, nota, temReplay}|null, links: {resumo: "/lenda/#/resumo?id=PK&de=
  admin", verificar: "/lenda/#/verificar?id=PK&candidato=ID"}|null}` (sem links quando a carreira não existe mais).
- `POST desafio_salvar {id?, slug (só ao criar: 3 a 40, [a-z0-9-], sem "--"), titulo (3 a 80), descricao? (até 400),
  regulamento? (até 20.000, com quebras de linha), premio? (texto livre até 2.000), criterio, requisitos?, inicio?, fim?
  ("AAAA-MM-DD" em Brasília: o início às 00:00, o fim às 23:59:59; ou ISO com hora; null), ordem? (0 a 999)}` → `201`
  (novo, desativado, com o regulamento de partida se não veio) ou `200` (só os campos mandados mudam) `{ok, desafio: D,
  candidatosNovos}`. Erros: `slug`, `titulo`, `descricao`, `regulamento`, `premio`, `criterio` (`{copas?: 1..30,
  libertadores?: 1..30}` ou `{todasConquistas: true}` sozinho), `requisitos`, `datas` (inválida ou fim antes do início),
  `ordem` (400); `slug_em_uso`, `vencido` (critério de um desafio que já tem vencedor) (409); `404`.
- `POST desafio_ativar {id, ativo}` → `{ok, desafio: D, candidatosNovos}` (ativar sem início grava o início = agora).
- `POST candidato_verificar {id | carreira (pk: todos os candidatos dela que não venceram), resultado: {ok, detalhes?
  (objeto até 8 KB)}}` → `{ok, candidatos: [{id, estado}]}`: `ok` → `verificada`; não bateu → `recusada` com o motivo
  `detalhes.motivo` (até 200) ou "Não bateu na verificação pelo jogo.". A verificação guardada: `{ok, detalhes, em, quem}`.
  Vale para pendente, verificada e recusada (refazer); `409 vencedora`, `409 carreira_apagada`, `404`, `400 resultado`.
- `POST candidato_recusar {id, motivo (obrigatório, até 200; o jogador vê)}` → `{ok, estado}` | `409 vencedora`.
- `POST desafio_declarar_vencedor {candidatoId}` → `{ok, desafio: D}`. Numa transação com trava no desafio (e no
  candidato e na conta): só `verificada` (`409 nao_verificada`), sem vencedor ainda (`409 ja_tem_vencedor`), sem candidato
  anterior (`em` menor) pendente ou verificado (`409 ha_anterior` com `anterior`), conta existente e não suspensa
  (`409 conta_excluida | conta_suspensa`), carreira existente (`409 carreira_apagada`). Grava o vencedor, o candidato vira
  `vencedora` e a conta ganha o `aviso_conta` ("Parabéns! Você venceu o desafio “…”. A equipe do LENDA vai falar com você
  pelo e-mail da conta."). Registro: `desafio_vencedor`. Depois do vencedor ninguém mais vira candidato daquele desafio.
- `POST desafio_reabrir {id, motivo}` (a mais: o motivo é obrigatório) → tira o vencedor; o candidato volta a `verificada`
  e o aviso de vencedor ainda não lido some | `409 sem_vencedor`.
- O dono salva de novo uma carreira verificada com outro conteúdo → o candidato volta a `pendente` (a verificação de antes
  não vale); apaga a carreira → candidato pendente/verificado vira `recusada` ("A carreira foi apagada da conta.").
- Poderes (`PODERES_ACAO`): `suporte_status`, `suporte_responder`, `suporte_lote` e `reenviar_verificacao` = `usuarios`;
  `candidato_verificar` e `candidato_recusar` = `moderar`; `desafio_salvar`, `desafio_ativar`, `desafio_declarar_vencedor`
  e `desafio_reabrir` = `config` (o dono tem todos; nenhum poder novo foi criado). Tudo com `registrarAdmin`
  (`desafio_salvar`, `desafio_ativar`, `candidato_verificar`, `candidato_recusar`, `desafio_vencedor`, `desafio_reabrir`,
  `suporte_status`, `suporte_responder`, `suporte_lote`, `reenviar_verificacao`).
- "Precisa de atenção": `candidatos` (nível `acao`, candidatos pendentes/verificados, link `{aba: "desafios"}`). Pulso:
  `acao.candidatosPendentes`.
- **Ações novas no registro** (`admin_log.acao`; o painel precisa do nome em pt-BR de cada uma no `NOMES_ACAO_LOG`, o teste
  do painel confere): `reenviar_verificacao`, `desafio_salvar`, `desafio_ativar`, `candidato_verificar`, `candidato_recusar`,
  `desafio_vencedor` (a ação `desafio_declarar_vencedor` grava com este nome), `desafio_reabrir`, `suporte_status`,
  `suporte_lote`, `suporte_responder`. Alvos: `usuario:<id>`, `desafio:<id>`, `suporte:<id>` (e `suporte` no lote).

### A.8 Perfil público (item 6)

- `GET perfil.php?c=CODIGO` (o código de convite; maiúsculas ou minúsculas; público, `Cache-Control: public,
  max-age=120`; 300 a cada 10 min por IP) → `{codigo, apelido, desde (criado_em), conquistas (quantas na conta), carreiras:
  [até 3, as dela na fotografia do Hall público, no formato dos itens do hall.php], desafiosVencidos: [slug], link
  ("https://oprojeto.online/lenda/?c=CODIGO#/jogador/CODIGO")}`. Conta com `hallPublico: "nao"`, suspensa, ou código que
  não existe → `404 nao_encontrado`. Conta tirada do Hall pelo admin: o perfil abre, sem carreiras.
- Itens do `hall.php` e o `hall.php?id=` ganham `perfil: "CODIGO" | null` (para o apelido levar ao perfil).

### A.9 LGPD

Excluir a conta (pelo jogador ou pelo admin) apaga: as mensagens do Fale conosco dela (e as mandadas sem conta com o
mesmo e-mail), as candidaturas, o código de confirmação e as partidas por dia; o desafio que ela venceu continua vencido,
sem o vencedor (`vencedor.excluido`). As linhas do registro do admin das ações novas que citam a conta (`"usuario": id`)
ficam só com a ação, a data e o id (`ACOES_LOG_COM_CONTA`). A política (`privacidade.html`) fala dos dados novos, do perfil
público, do vencedor público, dos prazos (código 24 h, mensagens 12 meses, partidas por dia 40 dias) e dos e-mails que o
site manda.

### A.10 Testes

`teste/teste-v33.php` (147 verificações; incluído pelo `teste.php`): sucesso, 401/403 por papel em todas as rotas e ações
novas, entradas erradas (nenhum 500), limites, concorrência (dois candidatos salvos ao mesmo tempo: só o primeiro `em`
vence; quatro declarações ao mesmo tempo: uma só), LGPD, carreira forjada sem replay que não vira candidata, limite diário,
perfil privado = 404 e o banco sem o instalar da v3.3. HallEntry reais (`v-intenso-01`, `v33/v-intenso-03`, `v33/v-otima-02`) e o
replay de uma carreira real gravada (`scripts/gravar/filas/classico.json`).

## §B Jogo

Implementado: o item 7 inteiro e o lado do jogo do item 4 (o replay gravado durante a carreira do Clássico). Tudo o que é
do site fica atrás do `VITE_SITE=1` (fora do site — build local, claude.ai, PC da live — as rotas novas nem existem e o
código não entra no bundle). Nada novo é pedido na abertura do jogo: a tela inicial só pede `desafios.php` depois de
pintar e o navegador sossegar (1,8 s + `requestIdleCallback`), o menu pede ao abrir, e cada tela nova é um pedaço à parte
(`lazySite`/`lazy`). Servidor antigo (sem as rotas da v3.3), sem rede ou sem conta: nada quebra — sem desafio, sem
destaque, sem faixa de e-mail (U sem `emailVerificado` = confirmado), perfil "não encontrado".

### B.1 Arquivos

- Novos: `src/engine/replay.ts` (formato, gravar, conferir), `src/engine/verificar.ts` (jogar de novo e comparar; só a
  tela do admin carrega), `src/data/versao.ts` (`DADOS_VERSAO`), `src/site/desafios.ts`, `suporte.ts`, `perfil.ts`,
  `verificacao.ts`, `datas.ts`, `DesafiosTela.tsx`, `PerfilPublico.tsx`, `VerificarTela.tsx`, `FaleConosco.tsx`,
  `VerificarEmail.tsx`, `DestaqueDesafio.tsx`, `v33.css` (prefixo `sv-`). Testes: `src/store/replay.test.ts` e
  `src/site/v33.test.ts`.
- Mudados: `engine/types.ts` (`CareerState.replay`), `store/career.ts` (gravação do replay e `HallEntry.replay`),
  `store/app.ts` (rotas), `store/acesso.ts` (`#/verificar` só do admin), `store/comunidade.ts` (`perfil`),
  `ui/shell/routes.tsx` e `TopBar.tsx`, `ui/shared/landing/LandingScreen.tsx` (o destaque), `ui/shared/hall/Comunidade.tsx`
  e `hall.css` (apelido → perfil), `ui/classic/summary/SummaryScreen.tsx` e `summary.css` ("Carreira de <apelido>" →
  perfil); no site: `conta.ts`, `api.ts` (mensagens dos erros novos), `ui.ts`, `SiteRoot.tsx`, `ContaMenu.tsx`,
  `MinhaConta.tsx`, `ConviteConta.tsx`, `vigias.ts` (tela de agora), `hallPublico.ts`, `indicacao.ts` (`linkPerfil`).

### B.2 Replay (item 4, lado do jogo)

- `HallEntry.replay = {v: 1, seed: [a0, a1], identity, pace, picks: [{id, kind, idx, pen, n}], bonusOvr, dados}`, no
  nível de cima do HallEntry (não vai duplicado em `career`), exatamente o formato das filas de `scripts/gravar/filas/`
  (sem o `title`):
  - `seed`: os dois números do `crypto.getRandomValues(new Uint32Array(2))` do `randomSeed()` (a semente da carreira é
    `a0.toString(36) + a1.toString(36)` e o id do HallEntry, `career-<semente>`); o `randomSeed` lembra o par de cada
    semente sorteada na janela, e sem ele o par sai da própria semente (`parDaSemente`: qualquer corte que refaça o texto dá
    a mesma carreira).
  - `identity`: a da **criação**, como o motor a deixou (sobrenome cortado em 15, número de 1 a 99). A do HallEntry é a do
    fim (a carreira pode trocar de seleção ou de posição).
  - `picks`: uma por decisão, na ordem: `id` da opção (o que o motor recebe), `kind` da decisão, `idx` = posição do cartão
    (`#ck-opt-<idx>`), `pen` = canto do pênalti decisivo (`left|center|right`) ou `null`, `n` = quantas opções havia.
  - `bonusOvr`: o bônus como o motor o guardou (0 sem bônus). `dados`: `DADOS_VERSAO` = `"<data do generatedAt>.<FNV-1a do
    game-data.json>"` (hoje `2026-09-28.ff31cb13`), constante no código (nada de ler 1 MB para saber a versão); o
    `replay.test.ts` recalcula do arquivo e falha dizendo o valor novo quando o arquivo muda.
- Gravado pelo store do Clássico (`useCareer`): `start()` cria o replay só com o motor real (não no de exemplo, nem em
  fixture) e `choose()` acrescenta a escolha no estado **novo** (o anterior, que a revelação anima, fica como estava). Fica
  em `CareerState.replay` (vai junto para o IndexedDB a cada jogada, na mesma gravação do estado: nunca pela metade) e o
  motor nunca lê: só copia. No fim, `addToHall` põe em `HallEntry.replay`. O HallEntry inteiro já sobe para a conta
  (`carreiras.php`), então o servidor recebe o replay sem mudança na rota.
- Sem replay: carreira começada antes da atualização (o estado salvo não tem, e nunca ganha um pela metade), do Imersivo,
  do motor de exemplo, da semente de reserva do `Math.random` (sem `crypto`). Começou numa versão dos dados e continuou em
  outra (deploy no meio da carreira): `dados` vira `"<antiga>><nova>"` e a verificação avisa.
- Nenhuma carreira muda: o teste joga carreiras reais das filas pelo store (o mesmo caminho do navegador, com o
  `getRandomValues` devolvendo a semente da fila) e confere que o replay gravado é igual ao da fila e que pico, Bolas de Ouro,
  títulos, gols, jogos, idade e motivo do fim são os do `esperado` da fila (a nota da fila é da versão 1 dos pesos, de antes
  do Hall v2, e não entra). Padrão: 6 carreiras (os três ritmos, empréstimo, volta de empréstimo, fim de ciclo, lesão e o
  pênalti decisivo); `LENDA_REPLAY_TODAS=1` joga as 45.
- Tamanho: ~2 KB numa carreira do Intenso (24 escolhas).

### B.3 Verificação por replay (`#/verificar`, item 7)

- Rota `#/verificar?id=<carreiras.id>[&candidato=<id>]` (também aceita o `career-…` no `id`). Fechada como o `#/kit`: só o
  admin (o `painel.php?so=eu` confirma o cookie do painel; nem a conta de testes abre; o público vê "Página não
  encontrada"), e `rotaDeAdmin` faz o jogo perguntar ao servidor ao entrar nela. É o formato do `links.verificar` do §A.7.
- Fluxo: `GET admin.php?r=carreira` (o HallEntry, o `meta` e os `candidatos`) → carrega o motor real e os dados →
  `verificarCarreira` (sem tela nem animação; entre as decisões devolve o controle ao navegador e a barra mostra "decisão
  N de M") → compara → manda `candidato_verificar`.
- Compara (guardado × refeito, os mesmos números que o servidor tira do HallEntry): **Copas do Mundo, Libertadores, Bolas
  de Ouro, títulos, gols, pico de OVR, Nota de Legado** e, a mais, jogos e temporadas, taça por taça (uma taça trocada por
  outra deixa o total igual), a semente (o id do HallEntry tem de ser `career-<semente do replay>`), a seleção e a posição
  do fim e se o replay andou inteiro (toda escolha existia na decisão e a carreira acabou junto com a última). A nota só
  entra quando a guardada é da versão atual dos pesos (`legacy.v === LEGACY_VERSION`). Sem replay, do Imersivo ou com o
  replay estragado: "Não dá para verificar" com o motivo.
- Para quem vai: o `candidato` do link → `{id}`; sem ele, `{carreira: pk}` (todos os candidatos dela que não venceram);
  sem candidato nenhum, a verificação fica só na tela.
- **Bateu**: manda sozinho (`resultado.ok = true`) e mostra "Registrado no painel". **Não bateu**: mostra as diferenças
  (linha marcada na tabela) e só manda com o clique em "Registrar: não bateu (recusa o candidato)", porque o servidor
  recusa o candidato. `resultado.detalhes` (< 4 KB): `{v: 1, motivo (até 200, o que vai para o motivo da recusa: "Não
  bateu na verificação pelo jogo. Copas do Mundo: 3 → 2"), diferencas: [{campo, guardado, refeito}], guardado, refeito,
  passos, divergencia, avisos, dadosCarreira, dadosJogo, ms}`. A versão dos dados diferente aparece como aviso ("uma
  diferença pode vir daí, e não de trapaça").
- Botões: abrir o resumo da carreira (`#/resumo?id=…&de=admin`), verificar de novo, abrir o painel. Sessão do painel
  vencida: "Entre no painel de novo".

### B.4 Telas do site

- **`#/desafios`** (pública): cada desafio ativo ou já vencido (os valendo primeiro) com título, descrição, selo (Valendo /
  Começa em / Encerrado / Tem vencedor), o critério com a arte das taças, o **prêmio = o texto do admin** (vazio: "O prêmio
  deste desafio será anunciado aqui"), o prazo, quantas carreiras estão em verificação, o regulamento (abre e fecha) e o
  vencedor (apelido → perfil, jogador, "Ver a carreira"). Logado: o checklist do `desafios.php?eu=1` (critério com as
  carreiras que cumprem, partidas X de 30 com o limite do dia, e-mail confirmado com o botão "Confirmar", publicada no
  Hall, entre as 3 do perfil, as carreiras que cumprem com o que falta — `motivoTexto` — e o estado da candidatura:
  em verificação, verificada, vencedora ou "Não valeu" com o motivo). No de todas as conquistas: X de 87. Sem conta: os
  requisitos e "Criar conta para participar". A lista fica 60 s em memória (o servidor manda `max-age=60`).
- **Destaque na tela inicial e linha no menu**: só com um desafio valendo (ativo, já começou, sem vencedor, no prazo):
  "Duas Copas (teste) · Desafio valendo: … O primeiro leva: <prêmio>." → `#/desafios`.
- **E-mail verificado**: depois do cadastro (conta nova com `emailVerificado: false`) abre "Confirme seu e-mail" (código
  de 6 dígitos, "Reenviar código" com espera de 45 s, "Depois"); Minha conta mostra a faixa com o código e o reenviar
  enquanto não confirmar; o checklist dos desafios tem o "Confirmar". `verificar_email` / `reenviar_verificacao` como no
  §A.3 (`codigo_invalido` e `429` com a mensagem em pt-BR; `jaVerificado` marca a conta).
- **Fale conosco** (menu, com ou sem conta, e Minha conta): assunto (Dúvida, Ideia, Problema, Recomendação, Outro
  assunto), mensagem de 10 a 2000, e-mail obrigatório sem conta (logado não vai), `pagina` = a tela de onde abriu, a isca
  `site` (campo fora da tela, do teclado e do leitor de tela, mandado como veio) e o e-mail `contato@oprojeto.online`
  (link e "copiar") no formulário e na confirmação, que mostra o protocolo.
- **Perfil público** `#/jogador/<código>` (o link `…/lenda/?c=CÓDIGO#/jogador/CÓDIGO`, então quem abre chega como
  convidado): apelido, desde, conquistas, as carreiras do Hall (cada uma abre o resumo da comunidade), desafios vencidos,
  melhor nota e "Compartilhar"; 404 = "Perfil não encontrado". O perfil fica 2 min em memória.
- **Apelido → perfil**: no Hall da comunidade o apelido da linha abre o perfil (o resto da linha continua abrindo o
  resumo) e, no resumo de uma carreira da comunidade, o chip "Carreira de <apelido>" é o link do perfil (o `perfil` dos
  itens e do `hall.php?id=`).
- **Minha conta**: "Seu perfil público" com o link, "Copiar o link" e "Ver meu perfil" (com `hallPublico: "nao"` explica
  que o perfil está fechado), a faixa do e-mail e "Fale conosco".
- Medição: a tela de agora ganha `/fale-conosco` e `/conta/verificar` (no formato do `e.php`); as rotas novas vão como
  `/desafios`, `/jogador`, `/verificar`.

### B.5 Testes

- `src/store/replay.test.ts`: a versão dos dados; a semente (2.000 pares); o formato conferido; as carreiras das filas
  pelo store (replay igual ao da fila e os números do `esperado`); a verificação de cada uma bate e acusa, no campo certo,
  gols, pico, nota, Copas, Libertadores, Bolas de Ouro, taça trocada, escolha a menos e a semente de outra carreira;
  carreira com bônus de OVR; sem replay / Imersivo / estragado; motor de exemplo e estado antigo sem replay.
- `src/site/v33.test.ts`: rotas e portão do `#/verificar`, e-mail verificado, Fale conosco, desafios (normalização,
  valendo, `?eu=1` nos dois formatos, cache, servidor antigo, troca de conta), perfil, e o fluxo da tela de verificação
  com uma carreira real de fila e o fetch de mentira (bate → `candidato_verificar {id, resultado}`; Copas adulteradas →
  não bate, com o motivo).
- No navegador (pilha local `subir.sh`, porta 8910, Playwright): 79 verificações, do Fale conosco sem conta ao candidato
  verificado e depois recusado pela adulteração no banco, passando por destaque, menu, cadastro com o código do e-mail,
  carreira 90+ que sobe sozinha com o replay, checklist, perfil, apelido do Hall, uma carreira jogada pelos cliques que
  verifica e o celular sem rolagem lateral.

### B.6 Diferenças em relação ao contrato da rodada

1. A verificação compara também jogos, temporadas, taça por taça, a semente e a seleção/posição do fim (o contrato pedia
   os 7 números); a nota só entra com os pesos da mesma versão.
2. Só a verificação que bate é mandada sozinha; a que não bate espera o clique do admin (o servidor recusa o candidato).
3. A rota aceita `&candidato=<id>`; sem ele manda por `{carreira: pk}` (§A.7).
4. `replay.dados` com duas versões (`"a>b"`) quando a carreira atravessou um deploy que mudou os dados.
5. Destaque e linha do menu só com desafio **valendo**; o desafio encerrado ou vencido continua em `#/desafios`.
6. O módulo do replay entra num pedaço próprio de ~1 KB (gzip), pré-carregado em paralelo pelo `index.html` (como o da
   versão da nota); o resto (verificação, telas) só carrega quando usado.

## §C Painel

## §R Raridade
