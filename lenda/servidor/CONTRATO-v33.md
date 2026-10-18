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

Implementado: o item 8 inteiro (abas Mensagens e Desafios; e-mail confirmado em Usuários; `partidas_dia_max` nas
Configurações), no padrão das outras abas: pulso, "Precisa de atenção", toasts, ficha no painel lateral, diálogo com
motivo, confirmação digitada, lote, fila ao vivo, temas, modo discreto, celular sem rolagem lateral e CSP sem nada
embutido (texto do servidor só por `textContent`). O painel foi feito direto contra a pilha real: as rotas do §A já
existiam quando ele começou, então o mock não foi preciso.

### C.1 Arquivos

- Novos: `painel/mensagens.js` (aba Mensagens e a ficha da mensagem), `painel/desafios.js` (lista, desafio com os
  candidatos, editor e as decisões), `teste/painel/semente-v33.mjs` (a semente da v3.3) e `teste/painel/v33.mjs` (o teste
  do navegador), este rodado pelo `teste/painel/rodar.sh` depois do `correcoes.mjs`.
- Mudados: `painel/index.html` (os dois scripts, as duas seções e `?v=3.3.0` em todos os arquivos), `nucleo.js` (nomes das
  10 ações novas no `NOMES_ACAO_LOG`, `NOMES_TIPO_SUPORTE`, `NOMES_STATUS_SUPORTE`, `NOMES_ESTADO_CANDIDATO`, as pílulas
  `chipStatusSuporte`/`chipCandidato`/`chipEmailVerificado`, três ícones, `mensagem=` no painel lateral, `rotuloMarcar` na
  barra de lote e o conserto do clique em lista dentro de `<details>`, C.8), `painel.js` (abas, números, pílulas, links do
  "Precisa de atenção", `mensagem=`, "Sair sem salvar?" de qualquer aba), `usuarios.js`, `sistema.js`, `registro.js`,
  `painel.css` (bloco "v3.3" no fim); `teste/painel/painel.mjs` (16 abas, 8 números, 4 colunas no celular) e `rodar.sh`.

### C.2 Abas, pulso e "Precisa de atenção"

- Ordem fixa: Visão geral, Na área, Usuários, **Mensagens**, Hall público, Denúncias, Indicações e bônus, **Desafios**,
  Conquistas, Relatórios, Tempo de jogo, Registro, Saúde, Equipe, Configurações, Testes. As duas novas não têm tecla: 1–9 e
  0 continuam nas mesmas abas de antes.
- Números de ação: 8 (os 6 de antes + **Mensagens novas** = `acao.mensagensNovas` → `#/mensagens?status=nova` e
  **Candidatos a desafio** = `acao.candidatosPendentes` → `#/desafios`), em ouro quando passam de 0. Uma linha de 8 a partir
  de 1280 px; 4 × 2 abaixo disso; no celular, 4 × 2 com o rótulo curto ("Mensagens", "Candidatos").
- Pílulas da lateral: Mensagens = novas, Desafios = candidatos pendentes ou verificados (as duas em ouro, do pulso de 15 s).
- "Precisa de atenção": `suporte_parado` (`{aba:"mensagens", filtro:"nova"}`) → `#/mensagens?status=nova`; `candidatos`
  (`{aba:"desafios"}`) → `#/desafios` (com `id`, `#/desafios?id=`).

### C.3 Mensagens (`#/mensagens`)

- Lista do `?r=suporte`: abre nas **novas**; filtros por situação (Novas, Lidas, Respondidas, Arquivadas, Todas, com as
  `contagens`) e por assunto (com `novasPorTipo` nas novas), busca ao vivo (texto, apelido, protocolo, e-mail inteiro,
  `#id`), páginas, tudo no hash (`status=todas|lida|…`, `tipo=`, `q=`, `pagina=`). Colunas: a mensagem (assunto, protocolo
  e o começo do texto; as novas em negrito), de quem (o apelido leva à ficha da conta; "sem conta" com o e-mail que a pessoa
  deixou; e-mail mascarado no modo discreto), tela do jogo, quando, situação. O e-mail de contato (`contato`) aparece no
  topo com "Copiar".
- Lote (poder `usuarios`): "Marcar como lida", "Arquivar", "Voltar para nova" (`suporte_lote`), com o resumo dos pulados.
- Fila ao vivo: com o filtro das novas na página 1, o `filas.mensagens` do pulso traz a nova sozinha (ou o aviso "N
  mensagens novas — clique para ver" se a pessoa estiver no meio de algo), como nas Denúncias.
- Ficha no painel lateral (`mensagem=<id>`, em qualquer aba; Esc fecha): assunto, situação, de quem, e-mail (com
  "mostrar" e "copiar"), quando, tela, protocolo, quem mexeu por último, o texto inteiro (quebras de linha mantidas) e a
  resposta já mandada. **Abrir uma nova marca como lida** (`suporte_status`, só com o poder `usuarios`), com a faixa "Era
  nova: ficou como lida ao abrir · Voltar para nova". **Responder**: três respostas prontas (só o começo do texto), campo
  de até 4.000, e o diálogo com a **prévia do e-mail** como a pessoa vai receber (olá com o apelido, a resposta, a
  assinatura e a mensagem original citada com o protocolo) antes de mandar `suporte_responder`. Saiu: toast com o e-mail
  mascarado e a mensagem fica respondida; não saiu (`enviado: false`): toast de erro, a resposta continua no campo e a ficha
  mostra "Resposta guardada (o e-mail não saiu)". O rascunho da resposta fica na memória da aba (fechar a ficha não perde).
  Situação: Marcar como lida, Voltar para nova, Arquivar / Desarquivar; "Ver no Registro" e "Ficha da conta". Sem o poder
  `usuarios` (Moderador, Leitor): só lê, sem lote, e abrir não marca nada.

### C.4 Desafios (`#/desafios`)

- **Lista**: ladrilhos (valendo agora, candidatos esperando, partidas por dia que contam → Configurações, conquistas no
  jogo) e um cartão por desafio: situação (Valendo, Começa em…, Desativado, Encerrado, Tem vencedor), endereço, descrição,
  o que vale ("3 Copas do Mundo + 2 Libertadores numa carreira do Clássico" / "Todas as 87 conquistas na conta"),
  requisitos em pílulas, o **prêmio = o texto do admin** (vazio: "o jogo mostra 'O prêmio deste desafio será anunciado
  aqui'"), o prazo, as contagens de candidatos e o vencedor; botões "Ver N candidatos" (em ouro quando há), "Editar",
  "Ativar"/"Desativar". No cabeçalho, "Criar desafio" e "Ver no jogo" (`../#/desafios`).
- **Ativar/Desativar** (`desafio_ativar`): diálogo com a lista do que vai valer, o aviso de prêmio ou regulamento vazio e de
  que, sem início, ele começa agora (carreira salva antes não vale); o toast diz quantos candidatos nasceram.
- **Desafio** (`#/desafios?id=N[&estado=]`): a ficha inteira (regulamento abre e fecha), o cartão do vencedor (conta,
  carreira, hora em que cumpriu, quando foi declarado; conta excluída = "excluída (LGPD)") e os **candidatos na ordem do
  `em`**, com filtro por estado e contagens: posição, a marca "O primeiro que ainda conta" (`primeiro`), a conta (tipo,
  suspensa, e-mail não confirmado, partidas), a carreira (jogador → ficha da carreira, Copas, Libertadores, nota, com/sem
  replay, apagada), a hora com milésimos em Brasília, quem decidiu, e a **verificação**: "Bateu" / "Não bateu" com o motivo,
  a tabela guardado × refeito dos 9 números com a linha diferente marcada, as outras diferenças (semente, taças, seleção,
  replay), os avisos e o aviso de versão dos dados diferente. Botões: **"Verificar no jogo"** (o `links.verificar`, em outra
  aba; em ouro no pendente, "Verificar de novo" depois), "Abrir a carreira" (`links.resumo`), "Recusar" (motivo
  obrigatório que o jogador vê, com chips), **"Declarar vencedor"** (só verificado, só o primeiro, poder `config`) e, com
  vencedor, "Reabrir (tirar o vencedor)" com motivo. A lista se refaz sozinha quando o painel volta a ficar visível (a pessoa
  verificou na aba do jogo) e quando o número de candidatos do pulso muda.
- **Declarar vencedor**: confirmação forte — o diálogo confere (verificado no jogo, o primeiro, conta ativa, e-mail
  confirmado, carreira na conta), explica o que acontece (o jogo mostra para todos, ninguém mais vira candidato, o aviso
  em Minha conta) e o botão só libera com o **apelido digitado**.
- **Editor** (`#/desafios?id=N&parte=editar`, `#/desafios?parte=novo`): título, endereço (sai do título no novo; não muda
  depois), descrição, critério (Taças numa carreira: Copas e Libertadores de 0 a 30, pelo menos uma; ou Todas as
  conquistas; travado com vencedor), requisitos (partidas mínimas e os três sim/não; os dois de carreira somem no de
  conquistas), prêmio (texto livre até 2.000), regulamento (até 20.000; vazio no novo = o servidor escreve o de partida),
  início e fim (dia em Brasília, com "Limpar"), ordem, e a **prévia** do cartão. Barra "N alterações não salvas: …" com
  Descartar/Salvar; o erro de cada campo aparece depois de mexer nele (ou ao tentar salvar) e o do servidor vai para o campo
  certo (`slug_em_uso` → endereço, `vencido` → critério). O diálogo de salvar avisa quando o desafio está valendo (o servidor
  reavalia), quando o início é antecipado, quando um requisito afrouxa e quando o prêmio muda num desafio ativo. Sair com
  alteração pede "Sair sem salvar?".

### C.5 Usuários

- Filtros "E-mail confirmado" / "E-mail não confirmado" (`verificado=1|0`, com `contagens.verificado`), a coluna
  **E-mail** (Confirmado / Não confirmado; só aparece com o servidor da v3.3) e, nas não confirmadas, o botão compacto
  "Reenviar confirmação".
- Ficha: a pílula do e-mail, "E-mail confirmado" com a data, a ação **"Reenviar a confirmação do e-mail"**
  (`reenviar_verificacao`: confirm com o e-mail mascarado, toast com o `para`; `409 ja_verificado` vira aviso), o cartão
  **Desafios** (as candidaturas, `desafios`: desafio → `#/desafios?id=`, carreira → ficha, estado, hora, motivo) e o bloco
  **Fale conosco** (`mensagens`: protocolo → a mensagem aberta por cima das Mensagens). O diálogo de excluir a conta cita as
  mensagens e as candidaturas.

### C.6 Configurações e Registro

- Configurações → cartão **Desafios**: "Partidas por dia que contam na conta" (`partidas_dia_max`, de 10 a 10.000, com o
  texto do que acontece e o link para os desafios), só quando o servidor manda a chave. Baixar o limite entra nos avisos do
  diálogo de salvar.
- Registro: nome em pt-BR das 10 ações novas; alvo `desafio:<id>` → o desafio, `suporte:<id>` → a mensagem, `suporte`
  (lote) → Mensagens; os detalhes novos com nome (desafio, campos, candidatos novos, candidato, carreira, bateu,
  situação); E-mails com os tipos `verificacao`, `admin_verif` e `suporte`; `partidas_dia_max` com nome nas mudanças de
  configuração.

### C.7 Testes e prints

- `teste/painel/v33.mjs` (pelo `rodar.sh`, na mesma pilha, depois do `painel.mjs` e do `correcoes.mjs`): a semente
  (`semente-v33.mjs`) cadastra contas de verdade, manda 8 mensagens pelo `suporte.php` (com e sem conta, duas com mais de
  24 h, uma com HTML), ativa os dois desafios das Taças com um prêmio de teste e salva carreiras reais (amostra v33) com 3
  Copas, 2 Libertadores e o replay real da fila gravada, que viram candidatas sozinhas. O teste confere, pelo navegador:
  números e pílulas do pulso, os dois alertas novos, as abas sem tecla, filtros e contagens, o HTML do jogador como texto, a
  ficha (lida ao abrir, voltar para nova, resposta pronta, prévia, e-mail no arquivo e no `email_log`, Registro sem o texto
  nem o e-mail), lote, fila ao vivo, e-mail confirmado (filtro, coluna, reenviar com `email_log` e registro, candidaturas e
  mensagens na ficha), `partidas_dia_max` (fora da faixa, salvar, baixar com aviso), desafios (ativar com os avisos,
  candidatos na ordem do `em`, milésimos, bateu/não bateu com a linha marcada, os links do jogo, "Declarar" travado no que não
  é o primeiro, recusar com motivo obrigatório, declarar com o apelido digitado e o aviso na conta, reabrir), editor (criar
  com o regulamento de partida, editar mandando só o prêmio — o início fica igual —, início vazio barrado num ativo, "Sair
  sem salvar?", endereço repetido), Registro, CSP, nenhum erro de JavaScript, o papel Moderador (lê, não responde, não marca
  como lida, não cria nem declara, verifica no jogo) e o celular (sem rolagem lateral nas 9 telas novas, botões de 40 px,
  ficha em tela cheia). Também a corrida que apareceu no desenvolvimento: a recarga do desafio pedida pelo pulso que chega
  depois de abrir o editor não desenha por cima dele (o teste atrasa a resposta de propósito). O `v33.mjs` zera o contador
  de entradas no painel do IP de teste (a pilha já entrou muitas vezes no `painel.mjs` e no `correcoes.mjs`) e a conta Dono
  entra uma vez só (a sessão é reaproveitada nos outros aparelhos).
- Resultado (pilha real, `bash servidor/teste/painel/rodar.sh`, banco `lenda_v33_painel`, porta 8920): **PAINEL: PASSOU**
  — `painel.mjs` 129 ok, `correcoes.mjs` 72 ok, `v33.mjs` 132 ok, nenhuma falha, nenhum erro de PHP. Prints (1440 e 390,
  revisados; as telas novas também nos temas Claro e Alto contraste) com `LENDA_PRINTS`: as abas em `<pasta>/` e as telas da
  v3.3 em `<pasta>/v33/` (mensagens, todas, desafios, os dois desafios com candidatos, editor, novo, não confirmados, ficha
  da mensagem, diálogo da resposta, ficha da conta com as candidaturas, partidas por dia, diálogo do vencedor).

### C.8 Diferenças em relação ao contrato da rodada

1. Sem mock: as rotas reais do §A já existiam; tudo foi feito e testado contra a pilha real (`lenda_v33_painel`, porta
   8920).
2. "Número de novas no pulso" virou também um número de ação (e o de candidatos): 8 números em vez de 6.
3. Abrir uma mensagem nova a marca como lida (um `suporte_status` por abertura, só com o poder `usuarios`).
4. Não há rota de uma mensagem só: a ficha busca `?r=suporte&q=<protocolo>` (ou `q=#<id>` vindo do endereço) e acha a linha
   pelo id.
5. Desafio de todas as conquistas: não há carreira para refazer no jogo, então o candidato pendente tem "Conferi as
   conquistas", que manda `candidato_verificar {id, resultado: {ok: true, detalhes: {v: 1, manual: true, conquistas: true}}}`
   (a ficha mostra "Conferido pela equipe"); sem isso esse desafio nunca teria um verificado para declarar.
6. O editor manda só os campos que mudaram (assim o início gravado na ativação, com hora, nunca é trocado pelo 00:00 do
   dia sem querer) e não deixa esvaziar o início de um desafio ativo.
7. "Declarar vencedor" fica travado quando o candidato verificado não é o `primeiro` (o servidor responderia `409
   ha_anterior`).
8. Conserto geral no `nucleo.js`: numa lista dentro de `<details>` (blocos recolhíveis da ficha da conta) o clique na linha
   era ignorado; agora só um controle da própria linha (link, botão, caixa) impede abrir.
9. Pedido opcional ao servidor (não bloqueia nada): `GET admin.php?r=suporte&id=` (uma mensagem só) deixaria a ficha
   independente da busca do item 4.

## §R Raridade

Estudo feito com o motor e os dados reais do Modo Clássico, fora do navegador: **35.613 carreiras** (31.923 sorteadas
e 3.690 de um experimento condicional), ~22 h de CPU. Relatório completo (tabelas por política, seleção, ritmo,
posição, bônus, a tabela das 87 conquistas e o método): `v33-raridade.md`, entregue fora do repositório. Nada em
`src/` mudou.

### R.1 Arquivos e como repetir

- `scripts/estudos/raridade-motor.ts`: importa o motor real (`src/engine/career/default`, `src/engine/world`) e
  joga uma carreira com a semente do navegador (`a0.toString(36) + a1.toString(36)`), a identidade, o ritmo e uma
  política de escolha; devolve Copas, Libertadores, campeões de cada Copa do mundo simulado, conquistas, nota etc.
  Políticas: `aleatoria`, `gananciosa` (o clube mais forte onde joga; nos eventos, o maior valor esperado pelas chances
  do cartão), `cacador` (a gananciosa + clube sul-americano na Libertadores até ter 2, seleção sempre), `oraculo`
  (prova cada opção antes de escolher) e as de alvo (`mochileiro`, `sulamericano`, `fiel`, `europeu`, `artilheiro`).
- `scripts/estudos/raridade.mjs`: empacota o motor com o rolldown numa pasta temporária, reparte em workers, grava uma
  linha JSON por carreira (retoma de onde parou) e analisa:
  `node scripts/estudos/raridade.mjs simular --plano padrao,alvos,alvos2,extra,bonus,oraculo,sementes --saida <pasta> --workers 4`,
  depois `--plano condicional`, `analisar` e `tabela-conquistas`. `--n 100` roda 10% (~35 min). A pasta de saída fica
  fora do repositório; nada disso entra no site.

### R.2 Números (sem bônus de OVR, salvo onde dito)

| | Carreiras | 3+ Copas | 2+ Libertadores | 2 Copas + 2 Lib. | 3 Copas + 2 Lib. |
|---|---:|---:|---:|---:|---:|
| Todas as políticas | 27.123 | 6 (1 em 4.500) | 12,6% | 26 (1 em 1.040) | 0 |
| Aleatória | 5.240 | 0 | 2,7% | 0 | 0 |
| Caçador (o jogador dedicado) | 13.240 | 2 | 22,0% | 23 | 0 |
| Argentino caçador (o melhor plano) | 6.560 | 2 (1 em 3.300) | 22,8% | 19 (1 em 345) | 0 |
| Espanhol guloso (o melhor para "só Copas") | 3.610 | 2 (1 em 1.800) | 0,7% | 0 | 0 |
| Caçador com +2 / +5 de bônus | 2.000 | 2 | 34% | 13 | **2** (1 em 1.000) |

- **A Copa é o gargalo.** No mundo do jogo a Espanha ganha 18,7% das Copas, a França 13,4%, a Inglaterra 11,1%, a
  Argentina 10,1% e o Brasil 6,2%; o jogador só soma um pouco à força da seleção e precisa ser convocado (o
  argentino caçador não vai a nenhuma Copa em 54% das carreiras). As Copas ganhas caem aos 23 (20%), 27 (38%), 31
  (30%), 35 (10%) e 39 anos (2%); aos 19 (2030), nenhuma.
- **3 Copas + 2 Libertadores** (a marca do Pelé): nenhuma sem bônus. Estimativa para o melhor plano: P(3 Copas)
  (1 em 2.600 a 3.300) × P(2 Libertadores | 2+ Copas) (0,41) ≈ **1 em 6.000 a 8.000 carreiras**.
- Ritmo e posição quase não mudam a chance por carreira; o Expressa é ~3× mais rápido que o Intenso, então é o que o
  jogador dedicado usa. Bônus de +5 dobra a chance de 1 Copa e multiplica por 3–4 a de 2. O oráculo tem ~3× a chance
  do caçador nas coisas raras.
- O mundo vem da semente só no começo: as mesmas sementes com políticas diferentes dão o mesmo campeão em 100% das
  Copas de 2030, 93% de 2034, 49% de 2038 e 6–18% das seguintes.

### R.3 Quantas carreiras e quanto tempo

Média = 1/p carreiras (metade consegue até 0,69/p; 90% até 2,3/p). Tempo por carreira (das gravações de
`scripts/gravar`): Expressa ~1 min pulando as animações, ~2,5 min com elas. 100 carreiras por dia é o teto que conta
(≈ 1h40 por dia no Expressa). Melhor plano, sem bônus, um jogador sozinho:

| Critério | 1 carreira em | Dias a 100/dia | Dias a 50/dia |
|---|---:|---:|---:|
| 2 Copas + 2 Libertadores | 345 (220–530) | 3,5 | 7 |
| 2 Copas + 3 Libertadores | 1.312 (550–3.000) | 13 | 26 |
| 3 Copas | 1.800–3.300 | 18–33 | 36–66 |
| 3 Copas + 2 Libertadores | ~6.000–8.000 | 60–80 | 120–160 |

É uma corrida: com J jogadores dedicados, o primeiro acerto sai em ~1/J desse tempo. O requisito de 30 partidas não
pesa. **Entre as 3 do perfil:** quem jogou 1.000 carreiras tem a 3ª maior nota por volta de 90, e a carreira de 2 Copas
+ 2 Libertadores tem nota mediana 83; no modo automático ela muitas vezes fica de fora (o jogador precisa do "Eu
escolho").

### R.4 As 87 conquistas

**Não dá para ter as 87.** "Nômade" (clubes das 6 confederações) é impossível: os clubes que se pode assinar são os
das 52 ligas simuladas, de 5 confederações (não há liga da Oceania; Auckland FC e Wellington Phoenix jogam a liga
australiana, AFC). Em 31.923 carreiras o máximo foi 5. Outras 7 não saíram nenhuma vez (Só o Pelé, De Ushuaia a
Darién, Mochileiro, Além do Rei, Fora da curva, Máquina de gols, Reescreveu a história; o mais perto: 7 países
sul-americanos, 23 clubes, 3 Copas, 1.030 gols, 0,886 gol por jogo, 5 recordes). Na conta, um jogador junta 70
conquistas em ~230–1.460 carreiras, **72 em ~580–2.190**, 75 em ~2.700–4.300 e 78 em ~13.000; o teto prático é 78–79.

### R.5 Riscos (para quem cuida do §A e do §B)

1. **A semente é escolhida no navegador** (`randomSeed()` com o `crypto.getRandomValues` da página, que se troca pelo
   console). O motor é público e determinístico: quem souber programar acha, por fora, uma carreira que cumpre o
   critério (~12 min de um núcleo para 2 Copas + 2 Libertadores, ~45 min para 2 + 3, 4–5 h para 3 + 2), joga com a
   semente fixada e a verificação por replay **bate**. Recomendação: **semente emitida pelo servidor** (no início da
   carreira logada; guardada com a conta e a hora; uma por início, dentro do limite do dia) e só vale para desafio a
   carreira cujo `replay.seed` foi emitido para aquela conta, uma vez, antes do início. Sem isso, nenhum critério é
   seguro para prêmio.
2. Mesmo com a semente do servidor, dá para "voltar no tempo" (copiar o IndexedDB, ou provar as opções por fora): ~3×
   mais rápido (o oráculo). O limite de 100 por dia por conta segura isso; várias contas multiplicam o limite.
3. Bônus de OVR: o regulamento deve dizer se carreira com bônus vale (o estudo recomenda que valha: vem de compartilhar
   e indicar, e cada conta tem poucos).
4. As duas carreiras de 3 Copas + 2 Libertadores achadas (com bônus) ficaram só nos arquivos do estudo, fora do
   repositório: com a semente do navegador, elas bastariam para "vencer". Servem de teste do `#/verificar` depois.

### R.6 Recomendação de critério (difícil, mas 1 a 3 semanas para um jogador dedicado)

- **Principal "As Taças do Rei": `{copas: 2, libertadores: 3}`** — cinco taças, como as 3 + 2 do Pelé, trocando uma
  Copa por uma Libertadores porque a Copa é o gargalo: ~13 dias no teto, ~4 semanas a 50 por dia.
- **Secundário: `{copas: 2, libertadores: 2}`** — ~3,5 dias no teto, ~1 semana a 50 por dia; está contido no
  principal, então sai primeiro e anima a corrida.
- `{copas: 3, libertadores: 2}` (o da rodada) fica como desafio lendário (2–3 meses para um jogador; 1–2 semanas com
  5–10 disputando). `{copas: 3}` sozinho é mais difícil que o principal recomendado: se for usado, como principal.
- **Não ativar `todas-as-conquistas`** (ninguém ganha). Para um desafio de coleção de 1–3 semanas, "o primeiro a 72
  conquistas" — precisa de um critério novo no servidor (`{conquistas: n}`), que hoje não existe.
- Os desafios nascem desativados com os critérios da rodada; o admin troca o critério e o título no painel
  (`desafio_salvar`) antes de ativar.

### R.7 Diferenças em relação ao contrato da rodada

1. O estudo mediu, além das políticas pedidas (aleatória e gananciosa), o caçador (o plano das Taças do Rei), o
   oráculo, o bônus de OVR, políticas de alvo para as conquistas e um experimento de sementes; e chegou a 35.613
   carreiras (o pedido era 20 mil).
2. A recomendação muda o critério da rodada (3 + 2 e 3 Copas): com os números medidos, eles levam de 1 a 3 meses
   para um jogador dedicado, não 1 a 3 semanas.

## §I Integração (conferência das seções, desencontros consertados e testes de ponta a ponta)

Feito depois que os quatro agentes pararam: conferi a §A, a §B, a §C e a §R entre si e contra o contrato da rodada
(rotas, ações, campos, poderes, links), consertei os desencontros no lado certo e rodei tudo contra a pilha real.

### I.1 Desencontros consertados

| o quê | onde estava errado | o que mudou |
|---|---|---|
| O recado do vencedor ("Parabéns! Você venceu o desafio “…”", §A.7) chegava no jogo como **"Aviso da moderação"** (ícone de alerta), no menu como "Minha conta · 1 aviso da moderação" e no lembrete como "Um aviso sobre o Hall público — a moderação deixou um recado" | entre §A e §B: o `aviso_conta` (v3.2) é o mesmo campo para os dois recados e o jogo só conhecia o da moderação | §A: `U.aviso` ganha `tipo: "desafio" \| "moderacao"` (`_contas.php`; `desafio` = começa com `LENDA_AVISO_VENCEDOR`, a constante nova do `_lib.php` que o `avisoVencedor()` usa). §B: `AvisoConta.tipo` (`conta.ts`; servidor sem o campo decide pelo começo do texto); Minha conta mostra "Você venceu um desafio!" em ouro com a coroa (`.sc-avisoconta.is-desafio`), o menu "Minha conta · você venceu um desafio!" e o lembrete é um toast de ouro "Você venceu um desafio!". O da moderação fica como era |
| Confirmar o e-mail pelo "Confirmar" do checklist de `#/desafios`: o servidor avalia a conta na hora e a candidatura nasce (§A.3), mas o checklist do jogo só marcava o e-mail e continuava sem "Em verificação" até recarregar a tela | §B (`desafios.ts`) | quando a conta logada passa a `emailVerificado` com o checklist já carregado, o jogo pede o `?eu=1` de novo (teste novo no `v33.test.ts`; no e2e, "Em verificação" aparece sem recarregar) |
| Regulamento de partida de um desafio de 1 Copa: "…uma carreira com **1 Copas do Mundo**…" | §A (`regulamentoPadrao`) | "1 Copa do Mundo" (o painel e o jogo já faziam o singular) |
| `#/desafios` de um desafio que já tem vencedor (e não tem fim): o prazo dizia "sem data para acabar: vale até alguém vencer" | §B (`DesafiosTela.tsx`) | com vencedor, essa frase sai (o cartão do vencedor já diz quando) |

Conferido e igual nos dois lados (sem mudança): o `links.verificar` do `?r=desafio` (`/lenda/#/verificar?id=PK&candidato=ID`)
é o que a rota do jogo lê e o que o "Verificar no jogo" do painel abre (na mesma origem, com a sessão do painel); o
`?r=carreira` (meta.temReplay, candidatos) que a `#/verificar` lê; `candidato_verificar {id | carreira, resultado}`;
o `desafios.php` (lista, `encerrado`, vencedor e vencedor excluído) e o `?eu=1` aninhado em `eu` com `motivoTexto`; o
`perfil` nos itens do `hall.php` e do `hall.php?id=`; o `perfil.php` (404 = "Perfil não encontrado"); o `suporte.php`
(tipos, limites, isca, `pagina`); `verificar_email`/`reenviar_verificacao` (mensagens em pt-BR do `codigo_invalido` e do
`429`); `partidas_dia_max` nas Configurações; os nomes pt-BR das 10 ações novas do registro (`NOMES_ACAO_LOG`); as 87
conquistas iguais nos dois lados; os 3 de fábrica desativados e com prêmio vazio. Nada no código, nos textos ou nos
testes diz o que o prêmio é: é o texto livre do admin.

### I.2 Testes acrescentados ou mudados

- `teste/integracao/e2e.mjs` — as etapas antigas que a v3.3 muda: o cadastro do A (b1) abre "Confirme seu e-mail" e o A
  confirma com o código lido do e-mail do modo arquivo (código errado antes: erro em pt-BR); o B (c1) fecha com
  "Depois"; o pulso tem 8 números (d2) e o celular passa pelas 16 abas (f10). Etapas novas **g1–g14** (ver I.3).
- `teste/integracao/lib.mjs` — `jogarFila(page, fila)`: joga pela tela uma carreira REAL de `scripts/gravar/filas/`
  (a semente fixada como no `jogarCarreira`, a identidade e o ritmo da fila e o mesmo cartão `#ck-opt-<idx>` em cada
  decisão; cada clique espera o replay do estado ter as escolhas anteriores, para nunca clicar duas vezes na mesma
  decisão); `emailsPara()` e `codigoDoEmail()` (os e-mails do modo arquivo e o código de 6 dígitos).
- `teste/integracao/atualizar.php` — sabe de que versão parte (`_esquema` de antes; o publicado é a v3.2): espera o
  `_esquema` desta árvore, aceita só a troca do número do `_esquema` em `site_config`, espera a sessão do painel da v3.2
  continuar valendo (a da v3 deixa de valer, como antes) e manda o motivo no `ocultar_carreira` (a v3.2 pede). Para a
  v3.3 confere também: contas de antes sem o e-mail confirmado (`U.emailVerificado: false`), as Libertadores preenchidas
  nas carreiras guardadas (sem replay e sem `primeira_em`: não valem para desafio), os 3 desafios de fábrica desativados
  e com prêmio vazio, `desafios.php` vazio, Fale conosco e o perfil público da conta de antes.
- `teste/teste-v33.php` (+1: `U.aviso.tipo = "desafio"` do vencedor) e `teste/teste-v32-mod.php` (o aviso da moderação
  continua `tipo: "moderacao"`); `src/site/v33.test.ts` (+1: o tipo do aviso, com e sem o campo do servidor) e
  `src/site/v32.test.ts` (o `normalizarAvisoConta` devolve o `tipo`).
- `LEIAME.md` (integração): as etapas da v3.3 do `e2e.mjs` e o `LENDA_ATUALIZAR_REF` com o commit publicado.

### I.3 O que o e2e confere da v3.3 (etapas g, pela tela, com vários aparelhos)

- **g1** os 3 desafios de fábrica desativados (critério, requisitos, prêmio vazio no banco); `desafios.php` vazio; sem
  destaque na tela inicial, sem linha no menu; `#/desafios` "Nenhum desafio valendo agora".
- **g2–g3** Fale conosco sem conta (o e-mail é obrigatório; grava o e-mail e a tela de onde veio) e com conta (pela Minha
  conta; sem e-mail na linha); no painel, "Mensagens novas" no pulso, as duas na lista (HTML como texto), abrir marca como
  lida, prévia do e-mail com o protocolo, a resposta sai pelo `enviarEmail` para o e-mail que o visitante deixou
  (arquivo do teste + `email_log` tipo `suporte`; o Registro sem o texto).
- **g4–g5** o desafio de teste criado no editor do painel (1 Copa + 2 Libertadores, 2 partidas, prêmio de teste),
  desativado (o público não vê), ativado com o aviso "começa agora"; o público vê só ele (os 3 de fábrica continuam fora):
  destaque com o prêmio, linha no menu, `#/desafios` com selo, critério, os 4 requisitos e o regulamento de partida.
- **g6** o jogador R cria a conta pelo "Criar conta para participar" ("Depois" no código), joga uma carreira qualquer
  e a fila real `v-otima-04` pelos cliques (12 de 12 escolhas): HallEntry `career-<semente>`, o replay com as mesmas
  escolhas da fila, 1 Copa e 2 Libertadores; salva pelo botão (`tem_replay`, dentro do limite, depois do início); sem o
  e-mail confirmado ainda não é candidato.
- **g7** o checklist mostra o que falta (só o e-mail); "Confirmar" com o código do e-mail → a candidatura nasce no
  servidor (`em` com milésimos) e o checklist mostra "Em verificação" sem recarregar.
- **g8** HallEntry adulterada pela API: a carreira da fila com outro id e sem o replay é salva (`temReplay: false`) e
  não vira candidata (`?eu=1`: `sem_replay` com a frase); outra carreira de verdade, com o replay dela e +1 Copa e
  +2 Libertadores no resumo, vira candidata pendente depois da verdadeira.
- **g9** no painel, os 2 candidatos na ordem do `em` (a verdadeira marcada como a primeira); "Verificar no jogo" abre o
  `#/verificar` em outra aba: a verdadeira "Bateu" e é registrada sozinha (`verificada`, `verificacao.ok = true`); a
  adulterada "Não bateu" com as linhas de Copas e Libertadores marcadas, nada é mandado sem o clique, e o "Registrar: não
  bateu" a recusa com o motivo; o painel mostra "Bateu"/"Não bateu"; o jogador vê "Verificada".
- **g10** `partidas_dia_max = 10` pelas Configurações; com 10 partidas no dia, a 11ª (jogada pela tela) conta no dia mas
  não soma em `partidas_conta`; a carreira salva nesse dia, mesmo cumprindo o critério, fica `limite_diario` e não vira
  candidata; o checklist diz "valem até 10 por dia (hoje: 11)" e o motivo.
- **g11** "Declarar vencedor" com a confirmação forte (o apelido digitado): banco, `aviso_conta` e o registro; o R vê o
  lembrete de ouro "Você venceu um desafio!", o menu e a Minha conta de vitória (não "aviso da moderação"); o público
  (aparelho novo) não vê mais o destaque e vê "Tem vencedor" com o apelido (link ao perfil, "Venceu: …"); celular sem
  rolagem lateral.
- **g12** o link do perfil em Minha conta (copiar); aberto no celular de outra pessoa: apelido, as carreiras do Hall,
  quem abre fica com o código de convite; a carreira abre o resumo da comunidade e "Carreira de …" volta ao perfil; o
  apelido no Hall da comunidade abre o perfil; `perfil.php` com `desafiosVencidos`; perfil de quem fechou o Hall = 404
  e "Perfil não encontrado".
- **g13** Usuários com o filtro "E-mail não confirmado" (só o B), "Reenviar confirmação" (e-mail novo, `admin_verif`), e
  o B confirma com o código novo pela faixa de Minha conta.
- **g14** o Registro com as ações novas em pt-BR.

### I.4 Resultados (rodada final, com todos os arquivos desta árvore)

Pilha: o MariaDB compartilhado (`/run/mysqld/mysqld.sock`), bases em `/srv/lenda-v33-integ*` (755), portas 8930–8938,
bancos `lenda_v33_integ*` (apagados no fim).

- `servidor/teste/rodar.sh` **completo** (com as cargas, o Apache/.htaccess e o teste do painel pelo navegador):
  **PASSOU — 1542 verificações** (a v3.3: 148) e **PAINEL: PASSOU** — `painel.mjs` 129 ok, `correcoes.mjs` 72 ok,
  `v33.mjs` 132 ok, nenhuma falha, log do PHP limpo.
- `npx tsc --noEmit -p .`: limpo. `npx vitest run`: **570 ok** (2 pulados, como antes), 47 arquivos.
- `npm run build:site`: ok, 765 arquivos (20,8 MB).
- `teste/integracao/e2e.mjs` inteiro (v3 + v3.2 + as etapas g da v3.3), contra o `dist-site/` desta árvore:
  **PASSOU — 346 verificações, 0 falhas** (~14 min), nenhum erro de console, nenhum 5xx, nenhuma violação de CSP, log do PHP vazio.
- `teste/integracao/atualizar.sh` com `LENDA_ATUALIZAR_REF=80a8d2a` (o v3.2 publicado): **PASSOU — 25 verificações**
  (`_esquema` 32 → 33; nenhuma das 53 linhas de antes mudou; o instalar não altera nada na 2ª vez; a sessão do jogador e a
  do painel continuam).
- Rodadas que falharam antes (o que era): no e2e, só o teste — as linhas da v3.3 no menu e a parte da conta chegam num
  pedaço à parte (o teste contava cedo demais) e o `getByText('E-mail confirmado')` pegava primeiro o regulamento
  escondido no `<details>` fechado; e o checklist sem "Em verificação" depois de confirmar o e-mail, que era do produto
  (I.1). No `atualizar.sh`, o `ocultar_carreira` sem motivo, que a v3.2 recusa (teste).
- Intermitente, fora da v3.3: numa das cinco rodadas inteiras do e2e, a aba do B parou na tela de identidade depois do
  `#/kit` da etapa f7 (v3.2, tester) e não seguiu mais as navegações (a f7 e a g13, que usa a mesma aba, falharam). Não se
  repetiu nas outras quatro rodadas nem em três voltas de uma sonda com a mesma sequência (entrar, `#/identidade`,
  recarregar, Imersivo do tester, `#/kit` → "Página não encontrada"). O `etapa()` do e2e agora registra o endereço de cada
  aparelho quando uma etapa falha, para a próxima vez dizer onde a aba estava.
- Prints revisados (1366/1440 e 390): `scratchpad/v33-prints/integ/e2e/` (`g*`: código do cadastro, Fale conosco,
  Mensagens e a prévia da resposta, editor e lista de Desafios, destaque e `#/desafios`, a fila no fim, checklist antes
  e depois de confirmar, `#/verificar` que bate e que não bate, candidatos no painel, limite diário, declarar,
  vencedor no painel, lembrete e Minha conta do vencedor, `#/desafios` com vencedor no celular, perfil público no
  celular, Usuários não confirmados, faixa de Minha conta, Registro) e `scratchpad/v33-prints/integ/painel/` (as abas do
  painel em 1440 e 390, pelo `rodar.sh`).

### I.5 Pendências (para o dono decidir antes de ativar um desafio com prêmio)

1. **Semente escolhida no aparelho (R.5) — bloqueia prêmio.** A verificação por replay prova que a carreira é a que o
   motor dá para aquela semente e aquelas escolhas, mas a semente sai do `crypto.getRandomValues` da página, que se troca
   pelo console. Com o motor público, quem programa acha por fora uma carreira que cumpre o critério e joga com a semente
   fixada: a verificação **bate**. Não é desencontro entre as seções (o contrato da rodada não pedia), então não foi
   feito nesta rodada. Recomendação da §R: semente emitida pelo servidor no início da carreira logada (guardada com a
   conta e a hora, uma por início, dentro do limite do dia) e só vale para desafio a carreira cujo `replay.seed` foi
   emitido para aquela conta antes do início. Até lá, os desafios devem ficar desativados (é como nascem).
2. **"Todas as conquistas" é impossível hoje (R.4):** a "Nômade" pede clubes das 6 confederações e o jogo só tem ligas
   de 5. Não ativar `todas-as-conquistas` (ou mudar a conquista, ou criar um critério `{conquistas: n}`).
3. **Critérios (R.6):** 3 Copas + 2 Libertadores leva de 2 a 3 meses para um jogador dedicado; para 1 a 3 semanas, a §R
   recomenda `{copas: 2, libertadores: 3}` (principal) e `{copas: 2, libertadores: 2}` (secundário). O admin troca no
   editor do painel antes de ativar; o regulamento deve dizer se carreira com bônus de OVR vale.
4. Opcional (C.8 #9): `GET admin.php?r=suporte&id=` (a ficha da mensagem hoje acha a linha pela busca).
5. Deploy (não feito aqui): subir `api/`, `painel/` e o `dist-site/` como de costume e rodar o `instalar.php` (só
   acrescenta; testado por cima do v3.2 publicado, I.4). Sem commit, push nem deploy nesta rodada.

## §E Correções (achados confirmados da revisão de fraude e de uso)

Uma linha por achado: a causa, o que mudou e o teste que falhava antes. Testes novos: `servidor/teste/teste-v33-corr.php`
(incluído pelo `teste.php` depois do `teste-v33.php`), `src/store/v33corr.test.ts` e `src/site/v33corr.test.ts`; nos
testes antigos, só o que o contrato mudou (abaixo, E.4).

### E.1 Tabela

| # | achado | causa | correção | teste (falhava antes) |
|---|---|---|---|---|
| 1 | Candidato "foto": o forjado segura o "primeiro" e vence com a carreira de verdade (0 Copas) num desafio de 1 + 2 | o candidato nascia com a foto (Copas, Libertadores, `em`) e nada conferia de novo: o salvar só voltava `verificada`→`pendente`, o `candidato_verificar` e o `desafio_declarar_vencedor` não liam a carreira guardada nem o critério | `motivoCandidato()` (`_desafios.php`) confere o candidato com a linha de AGORA de `carreiras` e o critério de AGORA (e os requisitos e o Hall): no salvar com conteúdo novo (`candidatosCarreiraMudou`, em qualquer desafio sem vencedor), a cada `avaliarDesafiosConta`, no `candidato_verificar` (bateu mas não cumpre → `recusada`, "Bateu no replay, mas não vale: …") e no declarar, na mesma transação (`409 nao_cumpre` com `motivo` e `recusado`). Motivo da carreira (`DESAFIO_MOTIVOS_CARREIRA`) → recusado pelo sistema; se voltar a cumprir, volta a `pendente` com a hora de então (`garantirCandidato`; a recusa da equipe nunca muda). Salvar de novo com **outro replay** (o mesmo id, outras escolhas) é outra carreira: o `em` do candidato e o `primeira_em` recomeçam. A foto (Copas, Libertadores, jogador) acompanha a carreira | `teste-v33-corr.php` E.1 |
| 2 | Contagem de taça com `count` negativo: o servidor grava 3 Copas, o replay refaz 1 e a verificação bate | `extrairCampos` cortava cada `count` em [0, 10.000] e somava; o `numerosDoResumo` somava cru (−2 cancelava +2); a `#/verificar` não comparava com os números do servidor | servidor: contagem de taça ou prêmio que não é inteiro de 0 a 10.000 (negativa, fração, texto, item que não é objeto) deixa a carreira suspeita (`dados`), e suspeita (menos a `revisao`) não vale para desafio (motivo `suspeita`). Jogo: `contagem()` lê como o servidor, `contagensInvalidas()` vira a diferença `contagem`, e a verificação recebe os números que o servidor gravou (`servidor`, do `meta` do `?r=carreira`) e acusa `servidor` quando diferem dos da carreira guardada | `teste-v33-corr.php` E.4; `src/store/v33corr.test.ts` §E.4 |
| 3 | `replay.bonusOvr` sem conferência: +10 de OVR sem bônus nenhum, verificação batendo | o servidor só lia `career.bonusOvr` (e só ele ia contra a tabela `bonus`); o motor refazia com o do replay | servidor: `bonus_ovr` = o maior entre `career.bonusOvr` e `replay.bonusOvr`, e os dois têm de ser iguais e no formato (senão `bonus`); o bônus continua conferido contra a tabela `bonus` (usado nesta carreira, com o mesmo valor). `BONUS_OVR_MAX` = 10, o do motor (o painel e o bônus dão até +10; replay com mais sai do HallEntry). Jogo: diferença `bonus` quando o do replay ≠ o da carreira ≠ o do servidor | `teste-v33-corr.php` E.5; `src/store/v33corr.test.ts` §E.5 |
| 4 | Limite de 100 partidas/dia só para quem joga logado: gera carreiras deslogado e entra só para salvar | a carreira salva não tinha ligação com um início contado pelo servidor | **semente sorteada pelo servidor** (a recomendação da R.5 #1/I.5 #1): `POST carreiras.php {acao:"semente"}` → `{semente:[a0,a1] \| null, id:"career-…", motivo: null \| "limite_diario", hoje, max}`, uma por início, até `partidas_dia_max` por dia de Brasília (`sementes_carreira`, 40 dias); o jogo pede ao começar a carreira do Clássico com a conta (`src/store/sementeCarreira.ts` + `src/site/pontes.ts`; espera até 2,5 s, sem resposta usa a do aparelho). O salvar grava `carreiras.semente_em` = quando a semente (o texto do replay) saiu para a conta; sem ela, motivo `sem_semente`; sorteada antes do começo do desafio, `antes_do_inicio` | `teste-v33-corr.php` E.6; `src/store/v33corr.test.ts` §E.6; `src/site/v33corr.test.ts` §E.6 |
| 5 | "Todas as conquistas" decidido pelo que o aparelho manda, com "Conferi as conquistas" que não confere nada | as conquistas vêm só do cliente, sem prova | o desafio de critério `todasConquistas` não pode ser ativado (`desafio_ativar` e `desafio_salvar` de um ativo → `409 sem_prova`), nem verificado com "bateu" nem ter vencedor (`409 sem_prova`); o painel tira o "Conferi as conquistas", trava o "Ativar" com o porquê e avisa no candidato. Recusar continua valendo | `teste-v33-corr.php` E.7 |
| 6 | Poucos IPs cadastrando contas esgotam a cota global de e-mails: ninguém recebe o código nem consegue reenviar | um teto único (`verif-todos`) para o e-mail automático do cadastro e para o "Reenviar código" | baldes (`_contas.php`): cadastro 120/10 min e 1.200/dia no site, 15/10 min por IP (HMAC) e 20/10 min por domínio (fora os grandes provedores); "Reenviar código" 40 e 400 (+10/10 min por IP); "Reenviar código" de quem já jogou (5+ partidas) outros 40 e 400. Total = a cota de antes. "Precisa de atenção": `emails_cota` (≥ 80% `acao`, cheio `grave`) | `teste-v33-corr.php` E.8 |
| 7 | Ativar com início no passado: todos nascem no mesmo instante, na ordem do id da conta | `avaliarDesafioTodos` percorria por `usuario_id` e o `em` era o `agoraMs()` da iteração | no lote, as contas vão na ordem da carreira mais antiga e o `em` é a hora real conhecida: a maior entre `primeira_em`, a confirmação do e-mail (quando pedida) e o início do desafio (`emReal`) | `teste-v33-corr.php` E.9 |
| 8 | (= 2, lente de uso) `[{count:3},{count:-2}]` numa carreira real: candidata, verificada e vencedora | igual ao 2 | igual ao 2 | `src/store/v33corr.test.ts` §E.4 (a fila real `v-otima-04`) |
| 9 | (= 3, lente de uso) bônus apagado do career, +10 no replay | igual ao 3 | igual ao 3 | `src/store/v33corr.test.ts` §E.5 |
| 10 | Candidato "foto" ao salvar de novo (A) e ao mudar o critério de um desafio valendo (B) | igual ao 1; e o `desafio_salvar` não mexia nos candidatos que já existiam | (A) igual ao 1; (B) mudar critério, requisitos ou prazo confere todos os pendentes/verificados (`reavaliarCandidatosDesafio`: "O desafio mudou: …"; a resposta traz `candidatosRecusados`); voltar a regra faz o recusado pelo sistema voltar | `teste-v33-corr.php` E.1 e E.2 |
| 11 | Requisitos só no nascimento: Hall fechado depois, perfil 404 e vencedor declarado | o declarar só olhava conta suspensa/excluída e carreira existente | o declarar roda as mesmas regras (`motivoCandidato`: requisitos, Hall, top 3) → `409 nao_cumpre` (sem recusar: é da conta, a hora fica). O `?eu=1` traz `candidato.vale`, `motivoAgora` e `motivoAgoraTexto` (a tela mostra "Não vale agora" com a frase); o painel, `K.valeAgora {ok, motivo, texto}` e o "Declarar vencedor" travado com o motivo | `teste-v33-corr.php` E.3; `src/site/v33corr.test.ts` §E.3 |
| 12 | `#/verificar` com os dados de hoje: toda carreira antiga "não bate" depois de uma atualização dos dados | não havia os dados de cada versão; a diferença de versão só virava aviso e a tela oferecia recusar | o build publica `dados/<DADOS_VERSAO>.json` (`scripts/build-site.mjs`; o deploy só acrescenta — não apague a pasta); a `#/verificar` refaz com a versão da carreira (conferida pelo hash do nome; `dadosParaVerificar`). Sem ela, a diferença só nos números refeitos é **inconclusiva** (`Verificacao.conclusao`): nada é mandado e a tela não oferece "Registrar: não bateu"; as diferenças que não dependem dos dados (semente, contagem, bônus, números do servidor) continuam "não bateu" | `src/store/v33corr.test.ts` §E.10 |
| 13 | Checklist verde com carreira que não vale (sem replay etc.) | os itens usavam qualquer carreira de `carreirasQueCumprem` | `carreirasQueContam()` (`desafios.ts`): só as que valem ou só esperam o Hall deixam o critério, o Hall e o top 3 verdes; a que não vale põe o motivo no item do critério (`CarreiraQueCumpre.motivoCodigo`) | `src/site/v33corr.test.ts` §E.11 |
| 14 | (= 4, lente de uso) a carreira salva não tinha ligação com as partidas contadas | igual ao 4 | igual ao 4: o limite do dia vale para as sementes (100 carreiras que contam por dia, como diz a R.3) | `teste-v33-corr.php` E.6 |

### E.2 Contrato que mudou (em relação às §A e §B)

- **§A.2 Banco:** `carreiras.semente_em DATETIME(3) NULL` e a tabela `sementes_carreira(id, usuario_id, semente, dia, emitida_em,
  UNIQUE(usuario_id, semente))`. Quem rodou o instalar da v3.3 antes destas correções roda de novo (só acrescenta).
  Backup: as sementes ficam de fora (como os códigos e as partidas por dia). LGPD: excluir a conta apaga as dela; somem em
  40 dias (a carreira guarda `semente_em`).
- **§A.3:** o teto dos e-mails de confirmação vira os baldes do E.1 #6.
- **§A.6:** `BONUS_OVR_MAX` 20 → 10 (replay com `bonusOvr` > 10 sai do HallEntry). Plausibilidade: `bonus` também quando
  `career.bonusOvr` ≠ `replay.bonusOvr`; `dados` também com contagem de taça/prêmio fora de 0 a 10.000.
- **§A.7:** "Carreira que vale" ganha a semente sorteada pelo servidor para a conta depois do início (`sem_semente`,
  `antes_do_inicio`) e sem suspeita (`suspeita`; a `revisao` vale). Motivos novos no `?eu=1`: `sem_semente`, `suspeita`.
  `candidato` do `?eu=1` ganha `vale`, `motivoAgora`, `motivoAgoraTexto`; `K` ganha `valeAgora`; `candidato_verificar`
  responde `candidatos: [{id, estado, motivo, valeAgora}]`; `desafio_salvar` responde `candidatosRecusados`; códigos novos
  `409 nao_cumpre` (declarar: `{motivo, recusado}`) e `409 sem_prova` (ativar, salvar um ativo, verificar com ok e
  declarar o de todas as conquistas). O regulamento de fábrica diz que a carreira tem de ser começada com a conta aberta
  (a semente sorteada pelo servidor) e que o limite do dia vale para as carreiras começadas.
- **§B.3:** `verificarCarreira(…, {servidor, dadosUsados})`; `Verificacao.conclusao` (`bateu | nao_bateu | inconclusiva`) e
  `dados.usada/exata`; diferenças novas `contagem`, `bonus`, `servidor`; `resultado.detalhes` ganha `conclusao`,
  `dadosUsados`, `dadosExatos`. Só "bateu" é mandado sozinho; "inconclusiva" não manda nada.
- **§B.4:** a criação da carreira do Clássico com a conta espera a semente do servidor (até 2,5 s; "Começando…" no botão).

### E.3 Decisões e o que fica para o dono

1. Requisito que falha depois (Hall fechado, fora das 3, conta suspensa, e-mail) **não** recusa o candidato sozinho: ele
   fica "não vale agora" com a hora guardada, e o declarar responde `409 nao_cumpre` enquanto durar. Assim uma ocultação
   por denúncias (ou um Hall fechado por um dia) não tira o lugar de ninguém; o admin recusa com o motivo quando for o
   caso. Só o que é da carreira (critério, replay, semente, limite, suspeita, prazo, apagada) recusa sozinho.
2. Com o mesmo replay e outro resumo (a mesma carreira, números corrigidos), o `em` fica: a carreira que o replay prova
   já estava na conta. Com outro replay, recomeça. O candidato recusado pelo sistema que volta a cumprir (outra carreira,
   ou a mesma corrigida) volta para `pendente` com o `em` da hora em que voltou, nunca com um `em` mais antigo (nem o do
   lote, nem o de antes da recusa).
3. Viés conhecido do lote (E.1 #7): a hora em que a conta chegou às partidas mínimas e a da publicação no Hall não ficam
   guardadas; o `em` do lote usa a entrada da carreira, a confirmação do e-mail e o início. Não use início retroativo
   num desafio com prêmio.
4. A semente do servidor impede escolher a semente por fora; ainda dá para provar as escolhas de uma semente sorteada
   (copiar o IndexedDB, o "oráculo" da R.5 #2): o limite de carreiras por dia é o que segura isso.
5. Bônus de OVR: carreira com bônus vale se o bônus foi o que a conta ganhou e usou nela (a tabela `bonus`). Se o
   regulamento deve aceitar carreira com bônus é decisão do dono (R.5 #3).
6. A verificação "inconclusiva" (carreira de uma versão dos dados que não está em `dados/`) fica para o admin decidir no
   painel. As carreiras jogadas antes do primeiro deploy com a pasta `dados/` só verificam com a versão de hoje.

### E.4 Testes antigos que mudaram (só o que o contrato mudou)

- `teste/teste-v33.php`: as contas de `v33Conta` ganham a semente do replay das filas como sorteada pelo servidor (o
  `salvarC` do `teste-v3.php` chama `v33AntesDeSalvar`, que só existe com o `teste-v33.php` carregado; o salvar em paralelo
  grava a semente antes); `v33Ativar` também envelhece a semente sorteada no mesmo segundo; o teto do "Reenviar código" é
  o balde `verif-ped` (40), não o `verif-todos` (200); o desafio de todas as conquistas é ligado direto no banco (o
  `desafio_ativar` dele agora é `409 sem_prova`, conferido); o `?r=carreira` procura o candidato pelo slug (o do lote com
  início no passado nasce com a hora real e pode vir antes) e o `{carreira: pk}` do `candidato_verificar` confere só `id` e
  `estado` dos itens (a resposta ganhou `motivo` e `valeAgora`).
- `teste/teste-v32-integ.php`: espera o `email_log` do "esqueci" pelo SMTP (ele é gravado depois do QUIT, um instante
  depois da mensagem chegar na caixa; corrida do teste que apareceu numa rodada desta correção).
- `teste/painel/semente-v33.mjs`: grava a semente do replay real como sorteada para as contas que salvam carreira.
  `teste/painel/v33.mjs`: o "Ativar" do de todas as conquistas travado (e o `409 sem_prova`); o diálogo de ativar é
  conferido num desafio de teste criado e apagado ali.
- `teste/integracao/lib.mjs`: com a semente fixada pelo teste (`jogarCarreira` com `o.semente` e `jogarFila`), a resposta
  do `{acao: "semente"}` é trocada pelo par do teste e o banco grava que foi ele o sorteado para a conta
  (`fixarSementeDoServidor`).
- `src/site/v33.test.ts`: o normalizador do `?eu=1` traz também `motivoCodigo`.

### E.5 Resultados (rodada final, com todos os arquivos desta árvore)

Pilha: o MariaDB compartilhado (`/run/mysqld/mysqld.sock`), bases em `/srv/lenda-v33-corr*` (755), portas 8960–8967,
bancos `lenda_v33_corr*` (apagados no fim).

- `servidor/teste/rodar.sh` **completo** (com as cargas, o Apache/.htaccess e o teste do painel pelo navegador):
  **PASSOU — 1583 verificações** (as da §E em `teste/teste-v33-corr.php`, seções §E.1 a §E.9) e **PAINEL: PASSOU** —
  `painel.mjs` 129 ok, `correcoes.mjs` 72 ok, `v33.mjs` 135 ok, nenhuma falha, log do PHP sem aviso nem erro.
- `npx tsc --noEmit -p .`: limpo. `npx vitest run`: **585 ok** (2 pulados, como antes), 49 arquivos; os novos:
  `src/store/v33corr.test.ts` (7, com carreiras reais das filas jogadas pelo store) e `src/site/v33corr.test.ts` (8).
- `npm run build:site`: ok, 766 arquivos, com `dados/<versão>.json` (os dados do jogo desta versão, que o `#/verificar`
  usa para refazer as carreiras jogadas com ela).
- `teste/integracao/e2e.mjs` inteiro, contra o build desta árvore: **PASSOU — 346 verificações, 0 falhas** (~15 min);
  o instalar na pilha de antes acrescentou só `carreiras: coluna semente_em` (e a tabela nova); nenhum erro de console,
  nenhum 5xx, nenhuma violação de CSP.
- `teste/integracao/atualizar.sh` (o v3.2 publicado → esta árvore): **PASSOU — 25 verificações** (nenhuma linha de antes
  mudou; o instalar não altera nada na 2ª vez; as sessões de antes continuam).
- Rodadas que falharam antes: uma do produto — o candidato recusado pelo sistema que voltava a cumprir no lote nascia
  com um `em` mais antigo que o original (agora é a hora em que voltou, E.3 #2). As outras, do teste: as carreiras dos
  testes antigos sem a semente sorteada (o gancho `v33AntesDeSalvar`); o `candidatos[0]` do `?r=carreira` e uma
  comparação estrita com os campos novos; o §E.9 contando candidatos de outras contas; a corrida do `email_log` do SMTP
  (`teste-v32-integ.php`); e no `v33.mjs` o `#/desafios` pedido de novo sem sair da aba (o mesmo hash não recarrega a
  lista, e o desafio de teste recém-criado não aparecia).


## §F Rodada final (tudo de novo, numa pilha nova, com todos os arquivos desta árvore)

Nada foi mudado no código nem nos testes nesta rodada: tudo passou na primeira volta. Pilha: o MariaDB compartilhado
(`/run/mysqld/mysqld.sock`), bases em `/srv/lenda-v33-final*` (755, apagadas no fim), portas 8970–8979, bancos
`lenda_v33_final*` (apagados no fim); cada `php -S` encerrado pelo PID.

- `servidor/teste/rodar.sh` **completo** (com as cargas, o Apache/.htaccess na 8971 e o teste do painel pelo navegador na
  8976): **PASSOU — 1583 verificações** e **PAINEL: PASSOU** — `painel.mjs` 129 ok, `correcoes.mjs` 72 ok, `v33.mjs`
  135 ok, 0 falhas; log do PHP sem aviso nem erro; 100 mil eventos e a carga de 2.000 contas / 8.000 carreiras dentro dos
  tempos.
- `npx tsc --noEmit -p .`: limpo. `npx vitest run`: **585 ok, 2 pulados** (49 arquivos passaram, 2 pulados).
- `npm run build:site`: ok, **766 arquivos (21,94 MB)** em `dist-site/`, com `dados/2026-09-28.ff31cb13.json`.
  `dist-site/api/` (31 arquivos, com o `.htaccess`) e `dist-site/privacidade.html` iguais byte a byte aos de `servidor/`;
  `dist-site/painel/` igual ao `servidor/painel/` menos o `nomes.json`, que o build refaz dos dados do jogo a cada vez e
  só difere no `geradoEm` (o conteúdo — clubes, países, troféus, prêmios e conquistas — é o mesmo). Nenhum arquivo de
  teste, `.md`, `.log`, `_config*.php`, chave ou segredo no `dist-site/`.
- Pilha nova do `subir.sh` (porta 8978, banco `lenda_v33_final_integ`): os 3 desafios de fábrica (`tacas-do-rei`,
  `tacas-do-rei-copas`, `todas-as-conquistas`) com `ativo = 0`, `inicio`/`fim` NULL, **`premio` vazio**, nenhum candidato;
  `desafios.php` → `{"desafios":[]}`; o `instalar.php` de novo → `alteracoes: []`, `v33: {libertadores: 0, desafios: 0}`.
- `teste/integracao/e2e.mjs` **inteiro** (v3 + v3.2 + as etapas g1–g14 da v3.3), contra o `dist-site/` deste build:
  **PASSOU — 346 ok, 0 falhas** (875 s); CSP do painel sem violação, console sem erro, nenhuma resposta 5xx, log de erros
  do PHP vazio.
- A mais: `teste/integracao/atualizar.sh` (`LENDA_ATUALIZAR_REF=80a8d2a`, o v3.2 publicado → esta árvore, porta 8979):
  **PASSOU — 25 verificações** (nenhuma linha de antes mudou; o instalar não altera nada na 2ª vez; as contas de antes sem
  o e-mail confirmado; os desafios de fábrica desativados e com o prêmio vazio).
- Pendências para o dono continuam as da I.5 (#2 a #5) e da E.3; a I.5 #1 (semente escolhida no aparelho) foi resolvida
  pela semente sorteada pelo servidor (E.1 #4). Sem commit, push nem deploy.
