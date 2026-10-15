# LENDA · CONTRATO v3.2 (painel completo)

Especificação base: o mapa do painel de referência (P0, P1, P2) e o CONTRATO-v3.md. Cada seção é escrita por quem
implementou; toda diferença em relação ao mapa fica registrada na seção de quem mudou.

## §A Servidor: moderação, jogadores, Hall, análise

Implementado: P0-1, P0-2 (campos do pulso), P0-3, P0-4, P1-3 (lado do Registro), P1-4, P1-5, P1-6, P1-7, P1-8, P1-9,
P1-10, P1-11, P1-12, P1-13 (lado do servidor), H11, H12, H14/A8, A9, A10, A11, A14, N12, N14, U9, U15, O6, S17, S22 e
os extras X1, X2, X5 e X9 (e.php). O A4 (`painel.php&utm=1`) e o filtro das contas de teste nos números (P1-6) estão
no `painel.php` (§B.7), com o `idsContasTeste()` daqui. Erro sempre `{"erro","mensagem"}` em pt-BR (alguns com campos
a mais, ditos abaixo); JSON `no-store`; paginado = `{total, pagina, porPagina: 50, itens}`; datas em ISO UTC
(`2026-10-14T12:00:00Z`). Toda escrita grava `admin_log` pelo `registrarAdmin()` do §B (com `quem` e `ip_dia`).

### A.1 Arquivos

- Novos (nunca servidos, `.htaccess` nega `_*.php`): `api/_atencao.php` ("Precisa de atenção", pulso, mesmo aparelho,
  `idsContasTeste()`, cache curto, `aoRegistrarAdmin()`), `api/_moderacao.php` (motivo, lote, sinais, lixeira, aviso ao
  autor, indicações e bônus item a item), `api/_relatorios.php` (relatórios, tempo de jogo, feed, CSV),
  `api/_celular.php` (aviso no celular por ntfy/Telegram).
- Mudados: `admin.php` (rotas abaixo), `e.php`, `carreiras.php`, `conta.php`, `hall.php`, `_carreiras.php`,
  `_hall.php`, `_contas.php`, `instalar.php`, `_schema.sql` (tudo menos o bloco "-- admin" do §B), `privacidade.html`;
  no `_lib.php`, só o que não é de admin: `enviarEmail()` com o registro, `limpezaTalvez()`, as chaves novas da config,
  `siteConfig()`/`esquemaV32()`/`siteConfigPainel()` e `sitePublico()`.
- Testes: `teste/teste-v32-mod.php` (incluído pelo `teste.php`). Nos testes antigos, só o que o contrato mudou: as
  chamadas de `ocultar/apagar_carreira`, `resolver_denuncia ocultar`, `suspender`, `tirar_bonus`, `recusar_indicacao`
  ganharam `motivo` e `excluir_usuario` o `confirma`; os campos novos nas listas (`CAMPOS_C` + `hall`,
  `CAMPOS_ITEM_HALL` + `destaque`, item do `?r=usuarios` + `tipo, hallBloqueado, temNota`, `site` + `avisos`); o
  `atualizados.por` da config (agora `a<id>`); a carreira apagada pelo admin que o aparelho sobe de novo (agora `409
  apagada`; a mesma carreira com outro id ainda volta oculta).

### A.2 Banco (`_schema.sql`; o `instalar.php` acrescenta, nunca apaga)

- `usuarios`: `tipo` (`jogador`|`tester`|`criador`|`oficial`|`teste`, padrão `jogador`), `tipo_em`, `hall_bloqueado`
  (0/1), `nota_admin` (500), `nota_admin_em`, `nota_admin_por` (`a<id>`|`token`), `aviso_conta` (300),
  `aviso_conta_em`; índices `ix_usuarios_tipo (tipo, criado_em)` e `ix_usuarios_acesso (ultimo_acesso)`.
- `carreiras`: `motivo_admin` (200), `moderada_em`, `destaque` (0/1). O `salvar` do jogador não mexe nelas.
- `visitas`: `rota` (24), `modo_atual`, `jogando_s`; índice `ix_visitas_usuario_vid (usuario_id, vid)`.
- `indicacoes`: `ix_indicacoes_status (status, criada_em)`. `admin_log`: `quem`, `ip_dia`, `ix_admin_log_acao (acao,
  em)`, `ix_admin_log_quem (quem, em)` (pedido do §B). `hall_foto`: `destaque`.
- Tabelas novas: `lixeira_carreiras` e `email_log`, como no MAPA.
- `site_config._esquema = 32`: gravado no fim do `instalar.php`. **Sem ele** (arquivos novos subidos e o instalar ainda
  não rodou) o jogo continua como na v3.1: o `e.php` grava a visita sem as colunas novas, `carreiras.php`/`hall.php`/
  `conta.php` não usam coluna nem tabela nova, e as telas novas do painel respondem `503 instalar` (S22).
- Estado interno em `site_config` (chaves com `_`, fora da tela de config e do backup): `_atencao` (último cálculo dos
  alertas), `_alertas_lidos` (dispensas `{chave: {em, por}}`, até 500), `_multicontas` (grupos de aparelho, 10 min),
  `_esquema`.

### A.3 O que muda nas rotas que já existiam (muda o contrato, P0-4)

| ação | agora |
|---|---|
| `ocultar_carreira {id, motivo, avisar?, avisoMotivo?}` | `motivo` 1–200 obrigatório (`400 motivo` "Escreva o motivo: ele fica no registro."; maior que 200 ou que não é texto: `400 motivo`). Grava `motivo_admin` e `moderada_em` |
| `apagar_carreira {id, motivo, avisar?, avisoMotivo?}` | `motivo` obrigatório; a cópia vai para a lixeira (A.5) → `{ok, denunciasFechadas, lixeiraId}` |
| `mostrar_carreira {id, motivo?}` | grava `moderada_em`; `motivo_admin` = o motivo, ou NULL sem ele |
| `resolver_denuncia {id, resultado, motivo?, avisar?, avisoMotivo?}` | `motivo` obrigatório com `resultado: "ocultar"`; com `ok` grava só a hora (e o motivo, se veio) |
| `suspender {id, motivo, dias?}` | `motivo` obrigatório (`400 motivo`); os `dias` continuam conferidos antes (`400 dias`) |
| `excluir_usuario {id, confirma, motivo?}` | `confirma` = o apelido (sem diferenciar maiúsculas, sem espaços nas pontas), senão `400 confirma` "Digite o apelido da conta para confirmar."; `motivo` ∈ `pedido_titular, abuso, teste, outro` (padrão `outro`; fora: `400 motivo`) e é o único dado no registro além do id |
| `tirar_bonus {bonusId, motivo}`, `recusar_indicacao {id, motivo}` | `motivo` obrigatório |
| `reativar {id, motivo?}` | aceita `motivo` (vai para o registro) |
| `GET ?r=hall`, `?r=carreira`, `?r=usuario` | carreiras com `moderacao: {em, motivo}\|null` e `destaque`; `?r=hall` e `?r=carreira` com `sinais`/`seguro` (A.4) e `usuario.hallBloqueado` |
| `GET ?r=hall&filtro=` | aceita também `destaques`; `denunciadas` = com denúncia aberta ou `oculta = 2` |
| `GET ?r=denuncias` | itens com `sinais`, `seguro` e `carreira.posicaoHall`; as abertas da mais nova para a mais antiga (`criada_em`), `status=todas` por id |
| `GET ?r=indicacoes` | itens com `sinais`/`seguro`; `status` aceita também `suspeitas` (com sinal grave, sem as recusadas); `indicador=<id>`; ordem `criada_em` desc |
| `GET ?r=usuarios` | itens com `tipo`, `hallBloqueado`, `temNota`; filtros e `contagens` (P1-12, A.4); `ordem=acesso` = `ultimo_acesso` desc (as sem acesso no fim) |
| `GET ?r=usuario` | + `tipoEm, hallBloqueado, notaAdmin, avisoPendente, mesmoAparelho, tempo, acesso, lixeira` (A.4) |
| `GET ?r=log` | itens `{id, em, acao, alvo, quem: {codigo, nome}\|null, ipDia (6), grave, detalhes}` (o `itemRegistroAdmin()` do §B); filtros `quem`, `q`, `de`, `ate`, `porDia` |
| `GET ?r=config` | `valores` sem o estado interno; `atualizados.{chave}.por` = quem gravou (`a<id>`/`token`) + `porNome`; campo novo `celular: {ntfy: bool, telegram: bool}` |
| `GET ?r=resumo` | campos novos em A.4 |
| `GET ?r=carreira` | também por `carreiraId=<HallEntry.id>` (a mais antiga com esse id), para o X4 |

### A.4 GET `admin.php` (todas pedem o poder `ver`; as exceções estão escritas)

- `?r=atencao[&atualizar=1]` (P0-1) → `{geradoEm, alertas: [{chave, nivel: grave|acao|leve, texto, n, desde: ISO|null,
  link: {aba, filtro?, id?}, dispensavel}], dispensados: [{chave, texto, em, por}]}`, graves primeiro, depois ação, depois
  leves. Recalculado no máximo a cada 60 s; `atualizar=1` força; qualquer escrita do admin apaga o cálculo
  (`aoRegistrarAdmin`). Regras (texto exato do MAPA): `denuncias_abertas` (grave com a mais antiga > 48 h),
  `ocultas_denuncia`, `suspeitas`, `serie:<sha1(indicador,dia)>` (dispensável), `mesmo_aparelho`,
  `multi:<sha1(ids)>` (3+ contas; grave se se indicaram; dispensável; até 10), `painel_tentativas` (≥ 30 na janela de
  `painel-todos:todos`), `bonus_admin` (≥ 10 `dar_bonus` em 24 h), **`abuso:<sha1(quem,dia)>`** (S17: ≥ 10
  `excluir_usuario`/`apagar_carreira` em 24 h pela mesma pessoa; grave, dispensável), `hall_atrasado`,
  `medicao_parada`, `manutencao`, `cadastro_fechado`, `aviso_velho` (`aviso` ou um dos `avisos` sem validade, no ar há
  mais de 3 dias), `sem_conta_admin` (nenhuma conta pessoal ativa: `admin_contas.da_config = 0`), `backup_velho`
  (último `backup`/`backup_guardar` há mais de 7 dias, ou nenhum, com contas), `emails_falhando` (≥ 5 em 24 h).
  `link.aba` = as chaves das abas do painel: `hall` (filtros `denunciadas`, `suspeitas`, `atualizar`), `indicacoes`
  (`indicador` + `id`, `recusada`, `aparelho`), `registro` (`seguranca`, `dar_bonus`, `emails`, `quem` + `id`),
  `config` (`conta`, `backup`), `saude`. Uma regra cuja tabela ainda não existe fica de fora (não derruba as outras).
- `?r=agora[&bots=1]` (P1-4) → `{total, comConta, jogando, atualizadoEm, itens: [{sessao (8), conta: {id, apelido}|null,
  rota, onde, modo, jogando, entrouEm, vistoEm, tempoS, aparelho, origem, bot}]}`; último batimento há até 60 s; as com
  conta primeiro; até 200. `onde`: `/` Menu, `/carreira` Clássico, `/imersivo` Imersivo, `/identidade` Criando o
  jogador, `/hall` Hall das Lendas, `/resumo` Resumo de carreira, `/conquistas` Conquistas, `/conta` Minha conta,
  `/live` Live (também com sub-rota: `/resumo/x` = Resumo de carreira); o resto, "Outra tela". Nunca o IP.
- `?r=lixeira&pagina=` (P1-8) → paginado de `{id, carreiraPk, carreiraId, usuario: {id, apelido}|null, jogador, nota,
  motivo, apagadaEm, apagadaPor, apagadaPorNome, expiraEm, temCopia}`, da que vence por último para a primeira.
- `?r=multicontas&pagina=[&atualizar=1]` (P1-9) → paginado de `{chave, aparelho (8), aparelhos (vids com o mesmo
  grupo), contas: [{id, apelido, criadoEm, status, partidas}], seIndicaram, ultimaVisita, dispensado}` +
  `calculadoEm`. Cache de 10 min (`atualizar=1` refaz); os 2.000 aparelhos com mais contas.
- `?r=emails&email=&pagina=` (P1-10) → paginado de `{id, em, para (mascarado), tipo (esqueci|admin_redef|outro), via
  (mail|arquivo), ok, detalhe}` + `resumo: {envios24h, falhas24h, via, ultimoOkEm}`; `email` exato vira o HMAC.
- `?r=relatorio&tipo=&conta=&pagina=[&csv=1]` (P1-11) → `{tipo, titulo, porque, total, base, porTipo, pagina,
  porPagina: 100, itens: [{id, apelido, email, tipo, status, criadoEm, ultimoAcesso, diasSemAcesso, partidas,
  carreiras, indicacoesValidas, bonusAbertos}]}`. `tipo`: `nunca_jogaram`, `sumidos30`, `engajados`, `sem_carreira`,
  `nunca_no_hall`, `suspensos`, `indicadores`, `bonus_parado`, `testers`, `base` (`400 tipo` com `{tipos}`); `conta` =
  tipo de conta (`400 conta`); `base` = contas do tipo (ou todas). `csv=1` (poder do `relatorio_csv` = exportar): CSV
  `;` com BOM, `lenda-<tipo com hífen>-AAAA-MM-DD.csv`, todas as linhas, registro `exportar {tipo: "relatorio:<tipo>",
  conta, linhas}`.
- `?r=tempo&jan=semana|passada|mes|d30|tudo&grupo=jogadores|todos|testes[&usuario=id][&csv=1]` (A11) → `{jan, grupo,
  de, ate, regua, total: {ativoS, jogandoS, sessoes (de 30 s ou mais), jogadores (contas), aparelhos, mediaS},
  porDia: [{dia, ativoS, jogandoS, sessoes}], porModo: [{modo, jogandoS, sessoes}], ranking: [{id, apelido, tipo,
  ativoS, jogandoS, sessoes}] (50)}` (+ `sessoes: [{inicio, ultimo, ativoS, jogandoS, modo, aparelho, origem}]` com
  `usuario`). Semana = desde segunda 00:00 em Brasília. `jogadores` = sem as contas `tester`/`teste`/`oficial` (os
  visitantes sem conta entram); `testes` = só elas; `todos`; robô nunca. `csv=1` (poder do `tempo_csv` = exportar): o
  ranking inteiro. `400 filtro`.
- `?r=eventos&tipo=cadastro|login|jogo_fim|compartilhar&dias=30&pagina=` (A14) → paginado de `{id, em, tipo, modo,
  dados, conta: {id, apelido}|null, aparelho (8)}` + `tipo`, `dias` (1–90); `400 tipo`.
- `?r=bonus&estado=abertos|usados|todos&origem=indicacao|compartilhar|admin&usuario=&pagina=` (X5) → paginado de `{id,
  usuario: {id, apelido}|null, valor, origem, ref, criadoEm, usadoEm, carreiraId, disponivel}` (o mais novo primeiro) +
  `resumo: {valor, abertos}`; `400 filtro`.
- `?r=seguranca&pagina=&acao=` → o mesmo do `equipe.php?r=seguranca` (`respostaSeguranca()` do §B), poder `sistema`.
- `?r=usuarios` ganhou (P1-12): `tipo=`, `hall=bloqueado|nao|publico`, `convite=1`, `denunciado=1`, `sumido=<dias
  1–3650>`, `nota=1`, `sem=time|uf`, e `q` aceita `#id`; valor fora disso é ignorado. A resposta ganha `contagens:
  {status: {ativo, suspenso}, tipo: {jogador, tester, criador, oficial, teste}, hall: {bloqueado, nao, publico},
  convite, denunciado, sumido (30 dias), nota, sem: {time, uf}}` (cache de 60 s em APCu, apagado em toda escrita).
- `?r=usuario&id=` ganhou: `tipoEm`, `hallBloqueado`, `notaAdmin: {texto, em, por, porNome}|null`, `avisoPendente:
  {texto, em}|null`, `mesmoAparelho: [{id, apelido}]` (até 20), `tempo: {semana, semanaPassada, total, porModo:
  {modo: jogandoS}}` (U9, segundos), `acesso: {status, suspensoAte, sessoes, ultimoLogin, bloqueioEntrar: {tentativas,
  limite: 5, bloqueado}, redefinicaoPendente: {expiraEm, tentativas}|null}` (U15; nunca pede nem testa a senha),
  `lixeira: [item da lixeira]`; nas carreiras, `hall` (X2), `destaque` e `moderacao`.
- `?r=resumo` ganhou: `usuarios.ativos7`, `ativos30`, `nuncaJogaram`, `porTipo`; `carreiras.destaques`, `lixeira`;
  `moderacao: {esperaMaisAntigaH, mediaH, medianaH, decididas30d}` (denúncias: da aberta mais antiga; da criação à
  decisão nos últimos 30 dias) e `moderacaoIndicacoes` (o mesmo para as indicações); `base: {suspensas, foraDoHall,
  naoAparecem, multicontas (do cache)|null, multicontasEm, semTime, semUf, comNota, testers}` (A10: cada número abre
  `?r=usuarios` com `status=suspenso`, `hall=bloqueado`, `hall=nao`, a aba de mesmo aparelho, `sem=time`, `sem=uf`,
  `nota=1`, `tipo=tester`); `site.avisos`.
- `?r=log` ganhou: `quem=` (`a<id>`, `token`), `q=` (texto nos detalhes, até 60, `%` e `_` escapados), `de=`/`ate=`
  (dias de Brasília) e `porDia=<1–90>` → campo `porDia: [{dia, n}]` (sem as ações de entrar/sair do painel).
- Sinais (P0-3) — `sinais: [{nivel: grave|leve, codigo, texto}]` (graves primeiro) e `seguro` (nenhum grave):
  carreiras: `suspeita:<motivo>` (grave; `suspeita:revisao` é leve; textos do MAPA, mais `copias` "Copas do Mundo demais
  para as temporadas" e `copia` "A mesma carreira já foi salva por outra conta"), `muitas_denuncias` (3+ abertas),
  `reincidente` (outra carreira oculta pelo admin, já suspenso ou suspenso agora), `topo_hall` (≤ 20ª), `conta_nova`
  (leve), `trapaca_plausivel` (leve); na fila de denúncias, também `denunciante_em_massa` (leve, 5+ em 24 h).
  Indicações: `mesmo_aparelho` e `serie_24h` (graves), `sem_partida` e `conta_recente` (leves).

### A.5 POST `admin.php` (o poder de cada ação vem do `PODERES_ACAO` do §B; 403 antes de olhar o resto do pedido)

| ação | corpo → resposta |
|---|---|
| `alerta_dispensar` | `{chave}` (`^[a-z_]{2,20}(:[0-9a-f]{8,40})?$`, e no último cálculo: senão `400 chave`; não dispensável: `400 nao_dispensavel`) → `{ok}`. Volta sozinho quando a chave muda (caso novo). Registro sem o texto (pode ter apelido) |
| `alerta_reabrir` | `{chave}` → `{ok}` (idempotente) |
| `carreiras_lote` | `{ids: [1–100 inteiros, repetidos saem], operacao: ocultar\|mostrar, motivo (obrigatório em ocultar), avisar?, avisoMotivo?}` → `{ok, feitos: [pk], pulados: [{id, motivo: nao_encontrada\|ja_estava}], denunciasFechadas}`. Cada carreira na sua transação; sai do Hall uma vez no fim; uma linha `ocultar_carreira`/`mostrar_carreira` `{lote: true, motivo}` por carreira + `carreiras_lote`. `400 ids`, `400 operacao` (apagar não existe em lote), `400 motivo` |
| `resolver_denuncias_lote` | `{carreiras: [pk…], resultado: ok\|ocultar, motivo (obrigatório em ocultar), avisar?, avisoMotivo?}` → `{ok, carreiras: [pk feitas], denunciasFechadas, pulados: [{id, motivo: sem_abertas}]}`; `400 resultado` |
| `indicacoes_lote` | `{ids, operacao: "recusar", motivo}` → `{ok, recusadas: [ids], bonusTirados, pulados: [{id, motivo: nao_encontrada\|ja_recusada\|bonus_usado}]}` (no lote, a de bônus já usado fica como está) |
| `tirar_bonus_lote` (X5) | `{ids: [bonusId…], motivo}` → `{ok, feitos: [ids], pulados: [{id, motivo: nao_encontrado\|usado}]}`; uma linha `tirar_bonus {lote: true}` por bônus + `tirar_bonus_lote` |
| `nota` | `{id, texto}`: até 500 caracteres e 10 linhas (a quebra de linha fica; controle sai; espaços juntados); vazio apaga → `{ok, nota: {texto, em, por, porNome}\|null}`; `400 texto`. Registro `nota`/`nota_apagada` só com `{tamanho}` |
| `mudar_tipo` | `{id, tipo, motivo?}` → `{ok, tipo, antes}`; `400 tipo`; grava `tipo_em`; registro `{de, para, motivo}` |
| `bloquear_hall` | `{id, sim: bool, motivo (obrigatório com sim)}` → `{ok, hallBloqueado}`; com `sim`, as carreiras saem da fotografia na hora; sem, voltam na próxima |
| `restaurar_carreira` | `{id (da lixeira)}` → `{ok, pk}` (o mesmo `carreiras.id` de antes, se livre): volta com `oculta = 1` e o motivo; `404`; `409 sem_copia` (venceu); `409 ja_existe` |
| `liberar_reenvio` | `{id (da lixeira)}` → `{ok}`: apaga a marca (e a cópia) e a decisão guardada daquela carreira: o jogador salva de novo e ela volta como uma carreira qualquer; `404` |
| `enviar_redefinicao` | `{id}` → `{ok, enviado, para: "jo***@gmail.com"}`: código de 6 dígitos, 30 min (o mesmo do "Esqueci a senha"); o código nunca vem na resposta nem vai para o registro; 3 por conta a cada 10 min (`429`); conta suspensa: `409 suspensa` |
| `destacar_carreira` (H12) | `{id, sim: bool}` → `{ok, destaque}`; o selo muda na fotografia na hora; `404`; `400 dados` |
| `testar_aviso` (O6) | `{}` → `{ok, enviado, canais: {ntfy: bool\|null, telegram: bool\|null}}` (null = canal não configurado); sem canal: `409 sem_aviso` |
| `avisar` (H11) | nas ações que escondem (`ocultar_carreira`, `apagar_carreira`, `carreiras_lote` ocultar, `resolver_denuncia(s_lote)` ocultar): `avisar: true` + `avisoMotivo: nome\|trapaca\|repetida\|pedido\|outro` (padrão `outro`; fora: `400 aviso`) grava `usuarios.aviso_conta` = "Uma carreira sua (<jogador>) saiu do Hall público por: <nome ofensivo\|números impossíveis\|carreira repetida\|pedido seu\|não seguir as regras do Hall>. Se achar que foi engano, escreva para contato@oprojeto.online." (nunca o motivo escrito pelo admin) |

`config` aceita as chaves novas: `hall_revisao_nota` (X1, inteiro 50–101; padrão = `hall_revisao_nota` do arquivo
de config, 90; 101 desliga; vale para as carreiras salvas daqui em diante), `avisos` (N14, lista de até 5 `{texto
1–200, tipo: info|alerta, publico: todos|logados|visitantes, ate: "AAAA-MM-DD" (fim do dia em Brasília) ou ISO ou
null}`; volta com `ate` em ISO) e `aviso_celular` (O6, `{denuncia: bool, picoOnline: 0–100000}`, 0 = desligado).

### A.6 Pulso (`painel.php?so=agora`, função `pulsoAdmin()`)

`agora.acao: {denunciasAbertas, ocultasPorDenuncia, suspeitas, indicacoesPendentes, contasHoje}` (uma consulta; hoje =
desde 00:00 de Brasília), `agora.alertas: {grave, acao}|null` (do último cálculo do `?r=atencao`, sem os dispensados;
`null` se ele tem mais de 5 min — o pulso nunca recalcula) e `agora.filas: {denuncias, suspeitas, indicacoes}` (md5 dos
ids das 100 mais antigas de cada fila; mudou o hash, a lista aberta mudou). Cache de 5 s em APCu, apagado em toda
escrita do admin.

### A.7 Jogo (o que o §D consome)

- `GET carreiras.php`: cada C ganha `hall: {estado, motivo?}` (X2) — `no_hall` (sem motivo) · `revisao` "Em revisão:
  entra no Hall assim que for conferida." · `suspeita` ("Esta carreira já foi salva por outra conta." / "Um nome ou texto
  desta carreira não é permitido no Hall." / "Os dados desta carreira não abriram direito." / "Os números desta carreira
  esperam a conferência da moderação.") · `oculta` ("A moderação tirou esta carreira do Hall público." / "Esta carreira
  está em análise depois de denúncias.") · `fora` ("Sua conta não pode publicar no Hall público." / "As carreiras do
  Imersivo ainda não entram no Hall público." / "A nota desta carreira é de uma versão antiga do jogo." / "Você
  escolheu outras carreiras para o Hall." / "Só as 3 melhores carreiras de cada conta entram no Hall." / "Outra conta já
  mostra esta mesma carreira no Hall.") · `privada` "Você escolheu não aparecer no Hall público.". O C do `salvar` e do
  `publicar` também traz o `hall`. Os textos nunca dizem o que a conferência olha nem o que a moderação escreveu.
- `carreiras.php salvar` de uma carreira apagada pela moderação → `409 apagada` "Esta carreira foi removida pela
  moderação." (tratar como final: tirar da fila `lenda:carreiras-pendentes` e não tentar de novo).
- `carreiras.php publicar {sim: true}` com a conta tirada do Hall → `403 hall_bloqueado` "Sua conta não pode publicar
  no Hall público." (tirar, `sim: false`, continua valendo); `C.noHall` sai `false`.
- `GET conta.php`: `U.tester: bool` (P1-6: abre o Imersivo e a Live com o selo "Teste", sem "Painel do admin" nem
  `#/kit`) e `U.aviso: {texto, em}|null` (H11: mostrar uma vez em Minha conta) → `POST conta.php {acao: "aviso_lido"}`
  → `{ok}` apaga (`401` sem conta). `site.avisos: [{texto, tipo, publico, ate}]` só os valendo e do público de quem
  pediu (visitante × logado), além do `site.aviso` de sempre.
- `hall.php`: cada item ganha `destaque: bool` (H12, selo "Destaque").
- `e.php` (X9): `view` com `d.rota` em `^/[a-z0-9/_-]{0,23}$` grava a tela em `visitas.rota`; `hb` com `m` em
  `classico|imersivo|live` grava `visitas.modo_atual`; o tempo dos batimentos com `p: 1` soma em `visitas.jogando_s`.
  Nada muda no cliente.
- X4: `#/resumo?id=<carreiras.id>&de=admin` lê `GET admin.php?r=carreira&id=<pk>` (só com a sessão do painel) →
  `{meta, denuncias, carreira: HallEntry}`; também `?r=carreira&carreiraId=<HallEntry.id>`.

### A.8 Arquivo de config (novas chaves, opcionais; nunca vão para o banco nem para o painel)

- `aviso_ntfy` = URL do tópico (ex.: `https://ntfy.sh/<tópico-secreto>`) e/ou `aviso_telegram` = `['token' => '<do
  bot>', 'chat' => '<id do chat>']`: o aviso no celular (O6). Denúncia nova: no máximo 1 aviso a cada 10 min (a que
  esconde uma carreira por 5 denúncias sempre avisa), depois de responder ao jogador; pico de gente online: o `e.php`
  confere no máximo a cada 10 min e avisa no máximo 1 vez por hora. Timeout de 3 s, falha calada. Os textos são do
  servidor (nada escrito por jogador vai para o celular). No LEIAME (§3, o exemplo da config) acrescentei só as duas
  linhas comentadas dessas chaves.
- `hall_revisao_nota` continua valendo como padrão da revisão (X1).

### A.9 LGPD

- `excluirUsuario()` (conta e admin) apaga também `lixeira_carreiras` da conta, os `email_log` com `para_hash =
  quemEmail(email)` e os caches `_atencao`/`_multicontas`; a anotação interna e o aviso estão na linha de `usuarios`.
- `limpezaTalvez()`: esvazia a cópia das carreiras da lixeira vencida (30 dias; a marca fica) e apaga o `email_log` de
  mais de 90 dias. O IP nunca é gravado; o `email_log` guarda o HMAC e a máscara do endereço. A política de privacidade
  foi atualizada (lixeira, anotação, código mandado pela administração, 90 dias de registro de e-mails, aviso).
- No registro: a anotação só com `{tamanho}`; o código de troca de senha nunca; `alerta_dispensar` sem o texto; o
  `excluir_usuario` só com o motivo da lista.

### A.10 Desempenho (teste com a carga do `rodar.sh`: 2.000 contas, 8.000 carreiras, 4.000 visitas)

`?r=atencao&atualizar=1` ~15 ms, `?r=resumo` ~22 ms, `?r=usuarios` com as contagens ~15 ms, pulso ~10 ms (melhor de 5,
pelo HTTP). As listas sem filtro saem pela ordem do índice (`FORCE INDEX FOR ORDER BY` quando o banco, com poucas
linhas, escolheria filesort): usuários (recentes, último acesso, por tipo), registro (todos, por ação, por quem),
e-mails, lixeira, bônus, denúncias, indicações, feed e o relatório "nunca jogaram" — conferidas por EXPLAIN no teste.

### A.11 Diferenças em relação ao MAPA

1. **Lixeira × `carreiras_moderacao`**: o `apagar_carreira` continua gravando a decisão guardada (v3.1), então a mesma
   carreira com **outro id** (mesmo resumo) volta oculta; o mesmo id recebe `409 apagada`. `liberar_reenvio` apaga
   também essa decisão (a carreira volta como uma qualquer). `restaurar_carreira` usa o mesmo `carreiras.id`.
2. `mostrar_carreira` sem motivo zera o `motivo_admin` (o MAPA só dizia "se vier").
3. `resolver_denuncias_lote` devolve `carreiras` como a lista dos pk feitos (o MAPA não dizia se era lista ou número);
   `indicacoes_lote` devolve `recusadas` como lista de ids e `bonusTirados` como número.
4. Códigos de erro novos: `nao_dispensavel`, `aviso`, `apagada`, `hall_bloqueado`, `sem_copia`, `ja_existe`,
   `suspensa`, `sem_aviso`, `texto`, `tipo`, `conta`, `filtro`, `ids`, `operacao`, `instalar` (do §B).
5. Ações e rotas a mais: `tirar_bonus_lote`, `?r=bonus` (X5), `destacar_carreira` (H12), `testar_aviso` (O6),
   `aviso_lido` no `conta.php` (H11), `?r=hall&filtro=destaques`, `?r=carreira&carreiraId=`, `?r=usuarios&sem=`,
   `?r=indicacoes&status=suspeitas&indicador=`, `?r=multicontas&atualizar=1`.
6. Colunas a mais: `usuarios.aviso_conta_em` (data do aviso); `ix_usuarios_tipo` é `(tipo, criado_em)` (a lista por
   tipo sem filesort); `hall_foto.destaque` (o selo sai da fotografia).
7. S22 pelo `site_config._esquema` (o jogo não quebra antes do instalar) além do `503 instalar` no painel.
8. O texto do dispensado vem do cálculo de agora (a dispensa guarda só `{em, por}`, sem apelido).
9. O `?r=seguranca` daqui é o do §B (`respostaSeguranca`), poder `sistema`.
10. `hall_revisao_nota` aceita 50–101 no painel (o arquivo de config continua aceitando qualquer valor ≥ 1 como padrão).
11. Tempo de jogo: `sessoes` conta as de 30 s ou mais; o grupo `testes` inclui `tester` (o MAPA não definia).
12. O feed (A14) olha os últimos `dias` (padrão 30, até 90), em ordem de `em`.

### A.12 Testes (`teste/teste-v32-mod.php`, ~230 verificações)

401 sem admin em todas as rotas e ações novas e 403 por papel (moderador, leitor); motivo e confirmação; sinais; lote
com entradas ruins e concorrência (dois lotes iguais ao mesmo tempo, duas dispensas ao mesmo tempo, dois lotes de
indicações); todas as regras do "Precisa de atenção", a dispensa que volta, o limite de 500; pulso e filas; Na área
pelo `e.php`; anotação, tipo (e os números do painel sem as contas de teste), tirar do Hall, X2, aviso ao autor; tempo e
acesso na ficha; lixeira (apagar, reenvio barrado, restaurar, ja_existe, vencida pela limpeza, sem_copia, liberar);
mesmo aparelho; código de troca de senha e e-mails; os 10 relatórios e o CSV; filtros e contagens; bônus; registro;
tempo de jogo; feed; tempos da moderação; destaque; X1; avisos; aviso no celular com um receptor de verdade (ntfy de
teste); banco sem instalar (S22); LGPD pela conta e pelo admin; os módulos novos nunca servidos (php -S e Apache);
tipos estranhos em todos os campos (nenhum 500); e, com a carga, o desempenho e os EXPLAIN. Correção feita no §B (uma
linha): `nomesQuem()` repetia o mesmo id no `IN (...)` quando várias linhas tinham o mesmo `quem` (HY093 → 500 no
registro).

## §B Servidor: acesso, sessões, PIN, equipe, Saúde, backup

Implementado: P1-1, P1-2, P1-3, P1-14, P1-15, S1, S7, S11, S12, S13, S14, S18, O3, O4 (e as falhas X9 do acesso).
Erro sempre `{"erro", "mensagem"}` em pt-BR; JSON com `no-store`; toda escrita vai para o `admin_log`.

### B.1 Arquivos

- `api/_admin.php` (novo; incluído no fim do `_lib.php`, então toda rota tem): Bearer, cookie e sessões do painel,
  papéis, poderes, hierarquia, `exigirAdmin()`, `exigirAdminAcao()`, `adminAtual()`, `registrarAdmin()`, presença,
  recados não lidos e o bloco Segurança. As funções de admin que estavam no `_lib.php` (`cabecalhoAutorizacao`,
  `tokenAdminValido`, `assinaturaPainel`, `cookiePainelValido`, `adminLogado`, `exigirAdmin`, `exigirEscritaAdmin`,
  `registrarAdmin`) mudaram para cá.
- `api/equipe.php` (novo): equipe, papéis, recados, sessões, Segurança, Saúde, backup e cópias.
- `api/_copias.php` (novo): backup, cópias no servidor e restauração. `api/_saude.php` (novo): Saúde e o leitor do
  `_schema.sql` em modo de só conferir (`saudeLerSchema()`, `saudeSchemaFaltando()`; o `instalar.php` pode usar).
- `api/painel.php`: a entrada reescrita (contas, etapas, PIN), o pulso (`?so=agora`) com o `pulsoAdmin()` do §A, a
  presença e os recados, e nos números o P1-6 (contas `teste`/`oficial` fora, via `idsContasTeste()` do §A) e o A4
  (`&utm=1`).
- `api/_schema.sql`: o bloco do fim "-- admin: contas, sessões, papéis, recados". `api/.htaccess`: `equipe.php` na
  lista das rotas sem cache.
- `teste/teste-v32-acesso.php` (incluído pelo `teste.php`, depois do `teste-v32-mod.php`). No `teste.php`: o formato do
  cookie do painel (agora `<token>.<exp>.<hmac>`, 8 h, SameSite=Strict) e a lista de tabelas esperadas, que passou a
  vir do `_schema.sql` (cada rodada acrescenta tabelas sem mexer no teste; as 18 da v3.1 continuam conferidas).

### B.2 Funções para as outras rotas

| função | o que faz |
|---|---|
| `exigirAdmin(?string $poder = null): array` | sem admin: `401 nao_logado` "Entre com a senha do painel."; com `$poder` que o papel não tem: `403 sem_poder` "O seu papel não permite esta ação." (`{poder}` a mais) e registra `negado` (alvo = o poder) |
| `exigirAdminAcao(string $acao): array` | o poder de `PODERES_ACAO[$acao]` (B.3); ação fora do mapa: só nível de dono; recusa = `403 sem_poder` + `negado` (alvo = a ação, `detalhes {acao, poder}`) |
| `adminAtual(): ?array` | o admin do pedido (sessão pronta no banco ou Bearer), lido uma vez por pedido |
| `registrarAdmin(string $acao, ?string $alvo, array $detalhes = [], ?string $quem = null)` | grava `quem` (`a<id>`, `token` ou `sistema`; `$quem` força, `''` = ninguém, para a tentativa de entrar) e `ip_dia` (16 primeiros do `quemIp()`, nunca o IP); `detalhes.via` continua `painel`\|`token`\|`sistema`; sem as colunas `quem`/`ip_dia` (instalar pendente) grava sem elas; chama `aoRegistrarAdmin($acao)` se o `_atencao.php` estiver carregado |
| `exigirEscritaAdmin(array\|string\|null $adm = null)` | JSON sempre; com sessão (cookie), também o `Origin` do site (`403 origem`) |
| `temPoder(array $adm, string $poder): bool`, `adminLogado(): ?string` | `adminLogado()` = compatibilidade da v3 (`painel`\|`token`\|null) |
| `respostaSeguranca(int $pagina, ?string $acao = null): array` | o corpo do `?r=seguranca` (B.6); o `admin.php?r=seguranca` do §A chama esta |
| `eFaltaDeSchema(Throwable): bool`, `erroInstalar(): never` | tabela/coluna que ainda não existe → `503 instalar` "Falta atualizar o banco: rode o instalar.php (LEIAME §5) e tente de novo." |
| `presencaEquipe(): array`, `recadosNaoLidos(array $adm): int` | para o pulso |

Array do admin: `{id: ?int, nome, papel, papelNome, quem: "a<id>"|"token", via: "sessao"|"token", email, nivel,
poderes: [...], daConfig: bool, temPin: bool}` (+ `sessao`, o sha256 da sessão, só para uso interno; nunca vai numa
resposta). O Bearer: `{id: null, nome: "Token (script)", papel: "dono", quem: "token", via: "token", nivel: 1000}`.

### B.3 Poderes, papéis e hierarquia

Poderes: `ver` · `moderar` · `usuarios` · `excluir` · `bonus` · `config` · `exportar` · `equipe` · `sistema`.

| papel (de fábrica) | nível | poderes |
|---|---|---|
| `dono` | 100 | todos |
| `moderador` | 60 | ver, moderar |
| `suporte` | 40 | ver, usuarios |
| `leitor` | 20 | ver |

Conta da senha do arquivo: papel dono, nível 101. Bearer: dono, nível 1000. Papel personalizado (`admin_papeis`):
sempre com `ver`; o nível sai dos poderes e nunca chega ao dono (70 com `equipe` ou `sistema`; 50 com `moderar`,
`usuarios`, `excluir`, `bonus` ou `config`; 25 o resto). Os de fábrica não mudam nem são sobrescritos.

`PODERES_ACAO` (o mapa único; POST do `admin.php` e do `equipe.php` e os GET que pedem mais que `ver`):

- `ver`: alerta_dispensar, alerta_reabrir, recado_lido, recado_apagar (só o autor ou quem tem `equipe`),
  sessao_encerrar (as minhas; as dos outros pedem `equipe` e a hierarquia), GET papeis, GET recados
- `moderar`: renomear, ocultar_carreira, mostrar_carreira, apagar_carreira, resolver_denuncia, atualizar_hall,
  carreiras_lote, resolver_denuncias_lote, bloquear_hall, restaurar_carreira, liberar_reenvio, destacar_carreira
- `usuarios`: suspender, reativar, deslogar, nota, mudar_tipo, enviar_redefinicao
- `excluir`: excluir_usuario
- `bonus`: dar_bonus, tirar_bonus, tirar_bonus_lote, recusar_indicacao, indicacoes_lote
- `config`: config, testar_aviso
- `exportar`: GET exportar, GET relatorio_csv, GET tempo_csv
- `equipe`: GET equipe, GET sessoes, equipe_criar, equipe_papel, equipe_ativar, equipe_zerar_pin, zerar_pin,
  equipe_senha, equipe_excluir, papel_salvar, papel_apagar, recado_criar
- `sistema`: GET seguranca, GET saude, GET backup, GET copias, GET copia, backup_guardar, backup_restaurar (este
  também exige nível de dono)

Hierarquia (uma função, `podeMexer()`/`podeDar()`, em todas as ações de equipe): ninguém mexe em si mesmo pela equipe
(use Minha conta) nem em quem está no mesmo nível ou acima (`403 hierarquia`, registrado como `negado`); ninguém dá
papel igual ou acima do seu, nem papel com poder que não tem — menos o dono, que pode nomear outro dono; um dono zera
o PIN de outro dono (esqueceu), mas não desativa, rebaixa nem exclui outro dono (isso é da conta da senha do arquivo
ou do Bearer); o último dono ativo não sai (`409 ultimo_dono`; a conta da senha do arquivo conta enquanto houver
senha na config); papel em uso não se apaga (`409 em_uso`, `{emUso}`).

### B.4 Cookie e sessões

- Cookie `lenda_painel` = `<token 43 car. base64url>.<exp>.<hmac>`, `HttpOnly`, `SameSite=Strict`, `Path=/lenda/`,
  `Secure` (config). No banco (`admin_sessoes`) só o sha256 do token. HMAC com `segredo|admin_senha_hash`: trocar a
  senha do arquivo derruba todas as sessões do painel (a alavanca de emergência de sempre).
- Sessão pronta: 8 h contadas da entrada (as trocas de token não renovam) e cai com 2 h sem uso; `visto_em` é
  atualizado no máximo a cada 60 s. Etapa intermediária (`pin`, `criar_pin`, `trocar_senha`): 10 min, assinada com
  outra etiqueta (não abre rota nenhuma, nem o `?so=eu`). Token novo a cada etapa e ao trocar a senha.
- `GET painel.php?so=eu` continua sem banco: confere só a assinatura e o prazo do cookie da sessão pronta (ou o Bearer)
  → `{admin: true}` ou `401`. Uma sessão encerrada no servidor ainda passa aqui até vencer (no máximo 8 h); as rotas de
  admin conferem o banco.
- Sessões vencidas saem do banco na entrada seguinte (e na hora em que alguém tenta usá-las).

### B.5 `painel.php`: entrada e Minha conta

Todo POST: JSON e `Origin` do site (`403 origem`), também com o Bearer.

| pedido | resposta |
|---|---|
| `GET ?so=modo` (sem login) | `{modo: "contas"\|"senha"\|"desligado"}`: `contas` = existe conta pessoal ativa (a tela mostra o campo E-mail, que pode ficar vazio para a senha do arquivo); `senha` = só a senha do arquivo; `desligado` = nem senha no arquivo nem conta |
| `POST {acao:"entrar", email?, senha}` | `200 {ok, etapa: "pronto"\|"pin"\|"criar_pin"\|"trocar_senha", restam? (na etapa pin), avisos?: ["criar_pin","crie_conta"], aviso?}`. Sem e-mail = senha do arquivo → conta Dono (criada na primeira entrada). Erros: `503 painel_desligado` "Painel desligado: defina a senha do painel no arquivo de config (LEIAME §2)."; `401 credenciais` (conta inexistente, desativada, senha errada: a mesma mensagem — "E-mail ou senha não conferem." no modo contas, "Senha incorreta." no modo senha); `429 limite` (10 por IP a cada 10 min; teto do site 50 senhas erradas a cada 10 min, que só barra os IPs que erraram; 5 erros por e-mail a cada 30 min) |
| `POST {acao:"conferir_pin", pin}` (etapa pin) | `200 {ok, etapa}`; `400 pin_formato`; `401 pin` "PIN incorreto. Restam N tentativa(s)." `{restam}`; `429 pin_travado` "PIN bloqueado. Tente de novo em até 10 minutos." (3 erros a cada 10 min por conta) |
| `POST {acao:"criar_pin", pin, repetir, senha?}` | na etapa `criar_pin`; ou na sessão pronta de quem ainda não tem PIN (a conta Dono), aí com `senha` (a do arquivo) para um cookie copiado não trancar o dono do lado de fora → `200 {ok, etapa: "pronto", avisos}`; `400 pin_formato` "O PIN tem 6 dígitos (só números)." / `pin_diferente` / `pin_fraco` "Esse PIN é fácil de adivinhar. Escolha outro." (todos iguais, sequência crescente ou decrescente); `401 credenciais`; `409 tem_pin` |
| `POST {acao:"trocar_senha", nova}` (etapa trocar_senha) | `200 {ok, etapa}`; `400 senha` (12+ caracteres, diferente da provisória); derruba as outras sessões da conta |
| `POST {acao:"criar_conta", email, nome, senha}` | só da sessão da conta Dono (senha do arquivo) e enquanto não há conta pessoal → `201 {ok, id, entrar: true}`: cria a conta pessoal dona (senha própria, 12+) e encerra a sessão atual (a próxima entrada é com o e-mail e cria o PIN). `403 so_senha_do_arquivo`; `409 ja_tem_conta`; `409 email_em_uso`; `400 email`/`nome`/`senha` |
| `POST {acao:"minha_senha", atual, nova}` | `200 {ok, sessoesEncerradas}` (as outras sessões caem; esta ganha token novo); `401 credenciais` + registro `minha_senha_falha`; `400 senha`; `409 use_conta` na conta Dono (a senha é a do arquivo); `400 conta` com o Bearer; `429` com 5 erros em 10 min |
| `POST {acao:"sair"}` | `200 {ok}`: apaga a linha e o cookie; registra `painel_sair` |
| `POST {acao:"sair_todos"}` | `200 {ok, encerradas}`: as outras sessões da mesma conta |
| `GET ?so=sessao` | sessão pronta: `{etapa: "pronto", via, modo, quem: {id, nome, email, papel, papelNome, nivel, daConfig, temPin}, poderes: [...], expiraEm, avisos, sessoes: [{id (12 hex), criadaEm, vistoEm, expiraEm, aparelho, etapa, atual}]}`; etapa intermediária: `{etapa, expiraEm, quem: {nome}, restam?}`; vencida: `401 etapa_expirou`; sem: `401 nao_logado`. Também dispara a cópia diária (B.8) depois de responder |

Registro: `painel_entrar` (alvo `admin:<id>`, `{aparelho}`), `painel_falha` (`{motivo: senha|senha_arquivo|inexistente|inativa}`,
sem o e-mail nem a senha digitados), `painel_limite` (uma vez por janela de 10 min, `{limite: ip|site|email}`),
`painel_pin_errado`, `painel_pin_travado`, `pin_definido`, `senha_trocada`, `minha_senha`, `minha_senha_falha`,
`criar_conta`, `painel_sair`, `sair_todos`, `negado`.

### B.6 `equipe.php`

GET (poder entre parênteses):

| rota | resposta |
|---|---|
| `?r=equipe` (equipe) | `{itens: [{id, nome, email, papel, papelNome, nivel, ativo, temPin, trocarSenha, daConfig, criadoEm, ultimoAcesso, senhaEm, online, podeMexer, eu}], eu: {id, nivel, papel}, donosAtivos, modo}` |
| `?r=papeis` (ver) | `{fabrica: [{chave, nome, descricao, poderes, nivel, fabrica: true, emUso, possoDar}], personalizados: [... fabrica: false], poderes: [{chave, texto}]}` |
| `?r=recados` (ver) | `{itens: [{id, titulo, texto (com quebras de linha), tom: nota\|aviso\|urgente, para: [{id, nome}]\|null, fixo, ate, criadoEm, por: {id, nome}, lido, podeApagar}], naoLidos}` (os em vigor, para mim; quem tem `equipe` vê todos) |
| `?r=sessoes` (equipe) | `{itens: [{id (12 hex), admin: {id, nome, papel}, etapa, criadaEm, vistoEm, expiraEm, aparelho, atual}]}` |
| `?r=seguranca&pagina=&acao=` (sistema) | paginado de 50 das linhas `painel_falha, painel_limite, painel_pin_errado, painel_pin_travado, negado, minha_senha_falha, painel_entrar, painel_sair, minha_senha, sair_todos, pin_definido, senha_trocada, sessao_encerrar, criar_conta, etapa_expirou`; `acao` filtra uma delas (`400 acao` fora da lista). Item `{id, em, acao, alvo, quem: {codigo, nome}\|null, ipDia (6), grave, detalhes}`; `resumo: {falhas24h, limites24h, negados24h, tentativasAgora, sessoesAtivas}` |
| `?r=saude` (sistema, também Bearer) | B.9 |
| `?r=backup[&medicao=1]` (sistema) | o arquivo `lenda-backup-AAAA-MM-DD_HHMM.json.gz` (`application/gzip`, em fluxo); registra `backup {linhas, medicao}` |
| `?r=copias` (sistema) | `{pasta: {ok, motivo}, maximo, itens: [{arquivo, tipo: diaria\|manual\|antes\|outro, em, bytes}], diaria: {dia, em, ok, arquivo?}\|null}` (nunca o caminho no servidor) |
| `?r=copia&arquivo=` (sistema) | o arquivo da cópia (`application/gzip`); `404 nao_encontrada` |

POST `{acao, ...}` (JSON; com sessão, `Origin` do site):

| ação | corpo → resposta |
|---|---|
| `equipe_criar` | `{email, nome, papel, senha?}` → `201 {ok, id, sorteada, senha?}`: sem `senha`, sorteia 14 caracteres sem 0/O/1/l/I (`random_int`) e devolve **só nesta resposta**; a pessoa troca no 1º acesso (`trocar_senha`) e cria o PIN. `409 email_em_uso`; `400 email`/`nome`/`papel`/`senha`; `403 hierarquia` |
| `equipe_papel` | `{adminId, papel}` → `{ok, papel}`; `409 ultimo_dono` |
| `equipe_ativar` | `{adminId, ativo: bool}` → `{ok, ativo, sessoesEncerradas}` (desativar derruba as sessões); `409 ultimo_dono` |
| `equipe_zerar_pin` / `zerar_pin` | `{adminId}` → `{ok, sessoesEncerradas}`: o PIN some e a pessoa cria outro na próxima entrada. Com o Bearer zera qualquer um (inclusive a conta Dono) |
| `equipe_senha` | `{adminId, senha?}` → `{ok, sorteada, senha?, sessoesEncerradas}`: senha provisória (mostrada uma vez); `409 senha_do_arquivo` na conta Dono |
| `equipe_excluir` | `{adminId}` → `{ok}`; o registro guarda `{copia: {nome, email mascarado, papel, criadoEm, ultimoAcesso}}`, sem hash; `409 conta_da_config`; `409 ultimo_dono` |
| `papel_salvar` | `{chave (^[a-z][a-z0-9_]{2,19}$), nome (2–40), descricao?, poderes: [...]}` → `{ok, papel: {chave, nome, descricao, poderes, nivel}}`; `400 papel_fixo`/`chave`/`nome`/`poderes`; `403 hierarquia` |
| `papel_apagar` | `{chave}` → `{ok}`; `409 em_uso`; `400 papel_fixo`; `404` |
| `recado_criar` | `{titulo (1–90), texto? (até 600, 12 linhas), tom?: nota\|aviso\|urgente, para?: [adminId…] (até 30; vazio = todos), fixo?: bool, ate?: "AAAA-MM-DD" (fim do dia em Brasília, até 1 ano)}` → `201 {ok, id}` |
| `recado_lido` | `{id}` → `{ok}` (recibo de leitura: não vai para o registro) |
| `recado_apagar` | `{id}` → `{ok}`; só quem escreveu ou quem tem `equipe` (`403 sem_poder`) |
| `sessao_encerrar` | `{sessao: 12 hex}` → `{ok, atual}`; a de outra pessoa pede `equipe` e a hierarquia |
| `backup_guardar` | `{medicao?: bool}` → `{ok, arquivo, bytes, linhas, contagem}`; `503 copias` (sem pasta fora do public_html); `409 ocupado` |
| `backup_restaurar` | `{arquivo (nome de uma cópia da lista), modo: completar\|substituir, confirma: "RESTAURAR"}` → `{ok, modo, antes (a cópia "antes" guardada), geradoEm, contagem, gravadas, puladas}`; `400 modo`/`confirma`; `404 nao_encontrada`; `400 copia_estragada` "A cópia não pode ser restaurada: <motivo>. Nada foi mudado."; `403 sem_poder` sem nível de dono; `413 grande` (> 1 GB) |

### B.7 Pulso e números (`painel.php`, poder `ver`)

- `GET ?so=agora` → `{agora: {online, jogando, atualizadoEm, acao, alertas, filas, equipe: [{nome, papel, eu}],
  recadosNaoLidos}}`. `acao`/`alertas`/`filas` vêm do `pulsoAdmin()` do §A (P0-2, P1-13; `null` enquanto o banco da
  v3.2 não está instalado); `equipe` = quem da equipe usou o painel nos últimos 3 min (S13; a faixa aparece com 2+).
- `GET ?de=&ate=&bots=0[&utm=1]`: como antes. Sem "incluir robôs/testes", as visitas das contas `teste` e `oficial` e
  os eventos delas ficam de fora (P1-6; campo novo `semContasTeste` = quantas contas saíram). Com `&utm=1`, campo
  `campanhas: {source, medium, campaign}`, cada um com até 6 `{valor, visitas, visitantes, contas, partidas}`
  (`contas` = contas que entraram numa visita da campanha; `partidas` = `jogo_fim` dessas visitas) (A4).

### B.8 Backup, cópias no servidor e restauração

- Formato (download e cópias): JSON em gzip, escrito em pedaços (cada um um membro gzip), com **um registro por linha**
  (continua JSON válido): `{versao: 1, geradoEm, medicao, binarios: {carreiras: ["dados"]}, tabelas: {…}, contagem: {…}}`.
  Lido numa leitura consistente do banco (`START TRANSACTION WITH CONSISTENT SNAPSHOT`, sem travar quem escreve).
- Entra: `usuarios`, `carreiras` (`dados` em base64), `conquistas_usuario`, `indicacoes`, `bonus`, `denuncias`,
  `carreiras_moderacao`, `partidas_vid`, `visitantes_usuarios`, `site_config` (só a config; o estado interno, com `_`,
  fica de fora), `lixeira_carreiras` (sem `dados`), `admin_log` (90 dias), `admin_contas` (sem `senha_hash` nem
  `pin_hash`), `admin_papeis`, `admin_recados`; com `medicao=1`, `visitas` e `eventos` dos últimos 30 dias. Fica de
  fora: `sessoes_login`, `admin_sessoes`, `redefinicoes`, `tentativas`, a fotografia do Hall (refeita) e o arquivo de
  config. O arquivo tem e-mails e os hashes de senha dos jogadores: guardar fora do servidor (LGPD).
- Pasta das cópias: `lenda-copias/` ao lado do arquivo de config (ou `backup_pasta` da config, caminho absoluto), 0700,
  com um `.htaccess` que nega tudo; recusada se ficar dentro do `public_html` (`DOCUMENT_ROOT` ou a pasta do jogo).
  Arquivos `lenda-copia-AAAAMMDD-HHMMSS-<microssegundos>-<diaria|manual|antes>-<8 hex>.json.gz` (hora de Brasília), 0600, gravados num temporário e
  renomeados. No máximo 10 (`copias_max`, 1–30); uma diária na primeira carga do painel no dia (`?so=sessao`, depois de
  responder; `copias_diaria => false` desliga), registrada como `backup_guardar {tipo: "diaria"}` com quem `sistema`.
- Restaurar: só um nome que está na listagem da pasta (regex `^[a-z0-9][a-z0-9._-]{0,120}\.json\.gz$`, sem link
  simbólico, `realpath` conferido; um backup baixado pode ser posto lá pelo Gerenciador de Arquivos). Antes de tudo
  confere o arquivo inteiro (versão, tabelas, cada registro, binários, a contagem do fim); depois guarda a cópia
  "antes" do estado atual (protegida da rotação); então, numa transação: `completar` só acrescenta o que falta
  (`INSERT IGNORE`); `substituir` apaga e regrava as tabelas de dados que o arquivo traz. Em qualquer modo: o
  `admin_log`, a equipe e a medição só completam; a equipe volta **desativada, sem senha e sem PIN** (quem cuida da
  equipe dá uma senha provisória), a conta da senha do arquivo não é restaurada; colunas que o banco não tem são
  ignoradas; tabelas fora da lista (sessões etc.) são ignoradas; contas de jogador que o admin excluiu
  (`admin_log excluir_usuario`) não voltam, nem o que era delas. Depois: as sessões de contas que sumiram caem, os
  caches internos saem e a fotografia do Hall é refeita (`por: "restaurar"`). Registro `backup_restaurar {arquivo,
  modo, antes, gravadas, puladas}` ou `backup_restaurar_recusado`.

### B.9 Saúde (`equipe.php?r=saude`)

`{php: {versao, extensoes: {pdo_mysql, mbstring, intl, zlib, apcu}}, banco: {ok, versao, fuso}, schema: {faltam:
[{tabela} | {tabela, coluna} | {tabela, indice}]}, config: {segredo, senhaPainel, token, origens (número), emailRemetente,
emailModo: mail|arquivo|smtp|outro, cookieSeguro, ipCabecalho, contasPainel}, hall: {em, total, ms, atrasado}|null,
medicao: {ultimaVisita, visitas1h}, email: {falhas24h|null}, copias: {ok, motivo, quantas, ultima, ultimaDiaria}, dados:
{contas, carreiras, noHall, denunciasAbertas}, problemas: [{codigo, grave, texto, resolver}], tudoCerto, horaServidor}`.
Só sim/não, contagens e textos fixos: nenhum segredo, hash, valor da config ou caminho de arquivo.

### B.10 Tabelas (bloco "-- admin" do `_schema.sql`)

`admin_contas(id, email UNIQUE, nome, senha_hash, pin_hash, papel, ativo, trocar_senha, da_config, criado_em,
criado_por, senha_em, pin_em, ultimo_acesso, KEY (papel, ativo))`, `admin_sessoes(token_sha256 PK, admin_id, etapa,
criada_em, expira_em, visto_em, aparelho, KEY admin_id, expira_em, visto_em)`, `admin_papeis(chave PK, nome, descricao,
poderes, criado_em)`, `admin_recados(id, titulo, texto, tom, para, fixo, ate, criado_em, criado_por, lidos)`. As
colunas `admin_log.quem`/`ip_dia` e os índices estão na tabela do §A. Nada de IP em lugar nenhum.

### B.11 Diferenças em relação ao MAPA

1. **A senha do arquivo de config continua entrando** (o MAPA S3 a desligava depois da primeira conta): sem e-mail, ela
   entra na conta "Dono" de emergência (`admin_contas.da_config = 1`, e-mail vazio, nível 101), criada na primeira
   entrada. Não há sessão `admin_id = 0`. Para essa conta o PIN é opcional (aviso `criar_pin`; criado, passa a ser
   pedido em toda entrada) e `criar_pin` na sessão pronta pede a senha de novo. Contas pessoais: PIN obrigatório.
2. Poderes com os nomes do enunciado (`usuarios`, `excluir`, `sistema` no lugar de `contas` e `backup`); `suporte` =
   ver + usuarios; `excluir_usuario` pede `excluir` (só dono, de fábrica).
3. Saúde, backup, cópias, Segurança e `zerar_pin` ficam no `equipe.php` (o MAPA punha no `admin.php`; o
   `admin.php?r=seguranca` do §A responde o mesmo). `zerar_pin` = `equipe_zerar_pin`.
4. `modo = contas` quando há conta pessoal ativa (não "admin_contas não vazia", porque a conta Dono sempre existe).
5. `criar_conta` só da sessão da conta Dono e enquanto não há conta pessoal; não desliga a senha do arquivo.
6. Hierarquia com os níveis de B.3 (Bearer 1000, conta da senha do arquivo 101), papéis personalizados com nível tirado
   dos poderes e sem poder que quem cria não tem; o dono nomeia outro dono e zera o PIN de outro dono.
7. Colunas a mais: `admin_contas.da_config`, `pin_em`, índice `ix_admin_contas_papel`; `admin_sessoes.ix_admin_sessoes_visto`.
8. O PIN é guardado como `password_hash(HMAC(segredo, "pin|<id>|<pin>"))`: só o banco não basta para testar os 10⁶ PINs.
9. O limite por e-mail (`painel-e`, 5 a cada 30 min) conta só os erros (com a senha certa a pessoa entra várias vezes).
10. Códigos de erro novos: `pin_formato`, `pin_diferente`, `tem_pin`, `etapa`, `hierarquia`, `ultimo_dono`, `em_uso`,
    `papel_fixo`, `conta_da_config`, `senha_do_arquivo`, `so_senha_do_arquivo`, `copias`, `copia_estragada`, `instalar`.
11. `?so=sessao` também responde na etapa intermediária (para a tela continuar de onde parou).
12. O backup leva também `carreiras_moderacao`, `partidas_vid`, `admin_papeis` e `admin_recados`, e o formato tem um
    registro por linha (para restaurar sem carregar tudo na memória).
13. `recado_lido` não vai para o registro (é recibo de leitura, não ação).
14. Restaurar pede `confirma: "RESTAURAR"` e nível de dono (além do `sistema`). **Limite conhecido (LGPD):** contas que
    o próprio jogador excluiu depois da cópia voltam ao restaurar (a exclusão pelo jogador não deixa rastro, de
    propósito); por isso o painel deve avisar e o LEIAME pede para restaurar só cópias recentes.
15. O POST do `painel.php` sempre pede o `Origin` (o Bearer não escreve por ele; os scripts usam `admin.php`/`equipe.php`).
16. A4: `contas` de cada campanha = contas que entraram numa visita dela (não "contas criadas").

### B.12 Para o painel (§C)

- Entrada: `GET ?so=modo` decide os campos; `desligado` mostra só a frase. Depois de `entrar`, seguir `etapa`
  (`pin` → `conferir_pin`; `criar_pin` → `criar_pin`; `trocar_senha` → `trocar_senha`) até `pronto`; num reload,
  `GET ?so=sessao` diz em que etapa parou. `401 etapa_expirou` volta para a entrada.
- `avisos` da sessão: `criar_pin` (faixa "Cadastre o seu PIN", com a senha do arquivo) e `crie_conta` (faixa "Você
  está entrando com a senha única. Crie a sua conta").
- Esconder os botões pelos `poderes` do `?so=sessao`; o servidor barra mesmo assim (`403 sem_poder` com `poder`).
- Senha provisória (`equipe_criar`/`equipe_senha` com `sorteada: true`): mostrar uma vez, com "Copiar".
- Restaurar: avisar que contas excluídas pelo próprio jogador depois da cópia voltam.
- O LEIAME (§5c, que o dono segue no deploy) cita estes nomes de tela: "Configurações → Minha conta → Criar PIN" (com a
  faixa "Cadastre o seu PIN"), "Minha conta → Criar a minha conta", as abas Equipe, Saúde e Registro → Segurança e, em
  Configurações → Backup, "Baixar backup", "Guardar cópia agora" e a lista de cópias com "Restaurar". Se a tela usar
  outros nomes, registre na §C para o LEIAME acompanhar.
- S18 (ver × disparar) no meu lado: segredo nenhum volta numa resposta (senha, PIN, hash, valor da config); a senha
  provisória aparece uma vez, só para quem a gerou; backup e cópias (que têm e-mails e hashes de senha dos jogadores)
  pedem `sistema`, e restaurar, nível de dono.

## §C Painel

Implementado na tela (`servidor/painel/`): o §0 inteiro (nada saiu da Visão geral), os ajustes do §0.1, P0-1, P0-2,
P0-3, P0-4, P1-1 a P1-15 (a parte de tela), os P2 S1, S7, S11/S12, S13, S14, S17 (linha grave da atenção), S18 (a tela
só dispara), S22 (cartão "Falta atualizar o banco"), N13, N14 (vários avisos), U9, U15, H11, H12, H14/A8, A4, A9, A10,
A11, A14, O3/O4, O6 (configuração e "Testar aviso"), todos os padrões do (c) e os extras **X1** (revisão do Hall em
Configurações), **X4** ("Abrir no jogo"), **X5** (lista geral de bônus com tirar em lote), **X7**
(`scripts/painel-nomes.mjs`) e **X8** (teste funcional pelo navegador). Feito contra a pilha real desde o começo (as
rotas do §A e do §B já respondiam), sem mock. Sem framework: JS puro em `window.LP`, todo texto por `textContent`
(`h()`), nenhum `onclick`/`style=` no HTML (delegação por `data-acao`, CSSOM), CSP `script-src 'self'; style-src 'self'`.

### C.1 Arquivos

- `painel/index.html`: o esqueleto (CSP e `noindex` como antes, `color-scheme: dark light`): a entrada (formulários
  `#form-entrar`, `#form-pin`, `#form-criar-pin`, `#form-trocar-senha` e a frase do painel desligado), a lateral com as
  abas, o topo (selo "atualizado às", quem sou, números de ação), as faixas, "Precisa de atenção", os recados, o
  cabeçalho da aba, a Visão geral (com os mesmos ids de antes) e uma `<section>` vazia por aba; `#gaveta` (ficha),
  `#novidade` (aviso flutuante da fila) e `#avisos` (toasts).
- `painel/tema.js`: no `<head>`, sem `defer`: aplica `data-tema` e `data-discreto` antes do primeiro desenho.
- `painel/nucleo.js` (formatos, `h()`, ícones, botões que travam com gerúndio, diálogo, toasts, lista/tabela que vira
  cartão, paginação, busca ao vivo, barra de lote, fila ao vivo, rota/hash, ficha lateral, rede com `AbortController`),
  `painel.js` (abas, pulso, atenção, faixas, recados, entrada com PIN, roteador, atalhos), `visao.js`, `area.js`,
  `usuarios.js` (lista e ficha da conta), `moderacao.js` (Hall, lixeira, Denúncias, ficha da carreira),
  `indicacoes.js` (indicações, mesmo aparelho, bônus), `relatorios.js` (Relatórios e Tempo de jogo), `registro.js`,
  `equipe.js`, `sistema.js` (Conquistas, Configurações, Testes, Saúde), `painel.css`, `nomes.json` (gerado, X7).
- `scripts/painel-nomes.mjs` (X7): monta o `nomes.json` (clubes, países, troféus do `game-data.json`; prêmios do
  `AWARD_NAME`; conquistas do `ACHIEVEMENTS`, pelo `runnerImport` do vite). O `build-site.mjs` chama e grava em
  `dist-site/painel/nomes.json` a cada build; `node scripts/painel-nomes.mjs` atualiza a cópia do repositório.
- `teste/painel/` (X8): `rodar.sh` (pilha própria: banco, config com segredos sorteados, `php -S`, `instalar.php`),
  `semente.mjs` (32 contas, 27 carreiras de verdade, denúncias, indicações em série e no mesmo aparelho, lixeira,
  bônus, e-mails, moderadora com senha provisória, 14 dias de visitas), `painel.mjs` (Playwright), `lib.mjs`. Uma linha
  no `teste/rodar.sh` chama o `teste/painel/rodar.sh` quando há Chromium (`LENDA_TESTE_SEM_NAVEGADOR=1` pula; porta
  `LENDA_TESTE_PORTA + 6`, banco `<banco>_painel`).

### C.2 O que o painel lê e manda (exatamente)

| rota | o painel usa |
|---|---|
| `GET painel.php?so=modo` | `modo` (`contas` mostra o campo E-mail; `desligado` mostra só a frase "Painel desligado…") |
| `POST painel.php` `entrar {email?, senha}` → `conferir_pin {pin}` / `criar_pin {pin, repetir[, senha]}` / `trocar_senha {nova}` | segue `etapa` até `pronto`; `restam` no PIN errado ("Restam N tentativas"); erros pelo `erro`/`mensagem` (`pin_fraco`, `pin_diferente`, `pin_formato`, `pin_travado`, `credenciais`, `limite`, `senha`, `painel_desligado`); `401 etapa_expirou` volta para a entrada |
| `GET painel.php?so=sessao` | `etapa`, `quem.{nome, papelNome, daConfig, temPin}`, `poderes` (esconde botões e tranca abas), `avisos` (`criar_pin`, `crie_conta` → faixas), `sessoes` (Minha conta → Aparelhos), `expiraEm` |
| `POST painel.php` `criar_conta`, `minha_senha`, `sair`, `sair_todos` | Minha conta |
| `GET painel.php?so=agora` (a cada 15 s, pausa com a aba escondida) | `online`, `jogando`, `atualizadoEm`, `acao.{denunciasAbertas, ocultasPorDenuncia, suspeitas, indicacoesPendentes, contasHoje}`, `alertas.{grave, acao}` (pílula da Visão geral; mudou → refaz a atenção), `filas.{denuncias, suspeitas, indicacoes}` (P1-13), `equipe[{nome, papel, eu}]` (faixa com 2+), `recadosNaoLidos` |
| `GET painel.php?de=&ate=&bots=&utm=1` | o de antes (§0) + `campanhas.{source, medium, campaign}[{valor, visitas, contas, partidas}]` e `semContasTeste` (rodapé) |
| `GET painel.php?so=eu` | antes de baixar um arquivo (sessão viva) |
| `GET admin.php?r=resumo` (60 s) | `site` (chips da lateral, Configurações), `usuarios.{total, hoje, semana, suspensos, ativos7, ativos30, nuncaJogaram, porTipo}`, `carreiras.{…, destaques, lixeira}`, `indicacoes`, `bonus`, `moderacao`/`moderacaoIndicacoes.{esperaMaisAntigaH, mediaH, medianaH, decididas30d}`, `base.*` (8 números clicáveis), `hall.{atualizadoEm, total, ms}`, `regras` |
| `GET admin.php?r=atencao[&atualizar=1]` (60 s e quando o pulso muda) | `alertas[{chave, nivel, texto, desde, link.{aba, filtro, id}, dispensavel}]`, `dispensados[{chave, texto, em}]`, `geradoEm`; `POST alerta_dispensar`/`alerta_reabrir {chave}` |
| `GET admin.php?r=agora[&bots=1]` | `itens[{sessao, conta, onde, modo, jogando, entrouEm, vistoEm, tempoS, aparelho, origem}]`, `total`, `comConta`, `jogando` |
| `GET admin.php?r=usuarios` (+ `q, status, tipo, hall, convite, denunciado, sumido, nota, sem, ordem, pagina`) e `?r=exportar&tipo=usuarios` | itens (com `tipo`, `hallBloqueado`, `temNota`), `total` (o "N encontradas"), `contagens` (números dos filtros) |
| `GET admin.php?r=usuario&id=` | tudo do A.4 (perfil, `acesso`, `tempo`, `notaAdmin`, `avisoPendente`, `mesmoAparelho`, carreiras com `hall`/`destaque`/`moderacao`, lixeira, bônus, indicações, sessões, conquistas, visitas, eventos). `tipo` (acrescentado na integração, §E.1; sem ele — servidor antigo — o painel lê o tipo do item de `?r=usuarios&q=<e-mail>`, ver C.6) |
| `GET admin.php?r=hall&filtro=publicas\|revisao\|suspeitas\|denunciadas\|ocultas\|destaques\|todas&q=&pagina=`, `?r=lixeira`, `?r=carreira&id=`, `?r=denuncias&status=`, `?r=conquistas` | itens com `sinais`/`seguro` (lote e sinais), `moderacao` ("Última decisão"), `posicaoHall`, `destaque`; `atualizadoEm` (fotografia) |
| `GET admin.php?r=indicacoes&status=&indicador=`, `?r=multicontas[&atualizar=1]`, `?r=bonus&estado=&origem=` | itens com `sinais`/`seguro`; grupos com `chave`, `seIndicaram`, `dispensado`, `calculadoEm`; bônus com `disponivel`, `resumo` |
| `GET admin.php?r=relatorio&tipo=&conta=[&csv=1]`, `?r=tempo&jan=&grupo=[&usuario=][&csv=1]`, `?r=log` (+ `acao, alvo, quem, q, de, ate, porDia=14`), `?r=emails&email=`, `?r=eventos&tipo=&dias=`, `?r=config` | como no A.4 |
| `POST admin.php` | `suspender {id, motivo, dias?}`, `reativar {id, motivo?}`, `deslogar`, `renomear {id, apelido}`, `excluir_usuario {id, motivo (pedido_titular\|abuso\|teste\|outro), confirma: apelido}`, `nota {id, texto}`, `mudar_tipo {id, tipo}`, `bloquear_hall {id, sim, motivo}`, `enviar_redefinicao {id}`, `dar_bonus {id, valor, motivo}`, `tirar_bonus {bonusId, motivo}`, `tirar_bonus_lote {ids, motivo}`, `ocultar_carreira`/`apagar_carreira {id, motivo, avisar?, avisoMotivo?}`, `mostrar_carreira {id, motivo?}`, `destacar_carreira {id, sim}`, `carreiras_lote`, `resolver_denuncia {id, resultado, motivo?, avisar?, avisoMotivo?}`, `resolver_denuncias_lote`, `restaurar_carreira`, `liberar_reenvio`, `recusar_indicacao {id, motivo}`, `indicacoes_lote {ids, operacao: "recusar", motivo}`, `atualizar_hall`, `config {valores}` (com `hall_revisao_nota`, `avisos`, `aviso_celular`), `testar_aviso`, `alerta_dispensar`/`alerta_reabrir` |
| `GET equipe.php?r=equipe\|papeis\|recados\|sessoes\|seguranca\|saude\|copias`; `?r=backup[&medicao=1]`, `?r=copia&arquivo=` (download) | como no B.6 / B.9 |
| `POST equipe.php` | `equipe_criar`, `equipe_papel`, `equipe_ativar`, `equipe_zerar_pin`, `equipe_senha`, `equipe_excluir`, `papel_salvar`, `papel_apagar`, `recado_criar`, `recado_lido`, `recado_apagar`, `sessao_encerrar {sessao}`, `backup_guardar`, `backup_restaurar {arquivo, modo, confirma: "RESTAURAR"}` |

Erro do servidor: o toast mostra a `mensagem` (fica até o ×); no diálogo, vai para o campo do `chave`/`erro` (`motivo`,
`confirma`, `texto`, `apelido`, `senha`…); `403 origem` → "Pedido recusado (origem)…"; `403 sem_poder` → "Sem
permissão para isso (papel X)"; `503 instalar` → "Falta atualizar o banco (rode o instalar.php)"; 401 → volta para a
entrada. Campo ausente (servidor antigo) = a seção não aparece.

### C.3 Endereço (o estado fica no hash)

`#/<aba>?<filtros>`, trocado com `history.replaceState` (recarregar dá a mesma tela; trocar de aba zera os filtros).
Abas, na ordem fixa e com atalho: `visao` 1, `area` 2, `usuarios` 3, `hall` 4, `denuncias` 5, `indicacoes` 6,
`conquistas` 7, `relatorios` 8, `tempo` 9, `registro` 0, `saude`, `equipe`, `config`, `testes`; aba desconhecida →
Visão geral; sem o poder (`sistema` para Saúde, `equipe` para Equipe), cadeado e estado vazio. Filtros: `area`
(`ver=conta|jogando`, `bots=1`), `usuarios` (`q`, `status`, `tipo`, `hall`, `convite`, `denunciado`, `sumido`, `nota`,
`sem`, `ordem`, `pagina`), `hall` (`filtro`, `q`, `pagina`), `denuncias` (`status=todas`, `pagina`), `indicacoes`
(`status=pendente|valida|recusada|suspeitas|aparelho|bonus`, `indicador`, `estado`, `origem`, `pagina`), `relatorios`
(`tipo`, `conta`, `pagina`), `tempo` (`jan`, `grupo`, `usuario`), `registro` (`parte=seguranca|emails|jogadores`,
`acao`, `alvo`, `quem`, `q`, `de`, `ate`, `email`, `tipo`, `dias`, `pagina`), `config` e `equipe` (`parte`). A ficha
abre por cima de qualquer aba com **`conta=<id>`** ou **`carreira=<pk>`** ("← Voltar para <aba>" e Esc tiram só esse
parâmetro). O endereço antigo `#/usuario/<id>` vira `#/usuarios?conta=<id>`. No navegador, só
`localStorage['lenda:painel'] = {periodo, bots, tema, discreto}` (com `try/catch`).

### C.4 Nomes de tela (os que o LEIAME cita)

Batem com o B.12: faixa **"Cadastre o seu PIN"** com o link **"Configurações → Minha conta → Criar PIN"**; faixa "Você
está entrando com a senha única. Crie a sua conta…" com **"Minha conta → Criar a minha conta"**; abas **Equipe**,
**Saúde**, **Registro** (sub-abas Ações, **Segurança**, E-mails, Jogadores); **Configurações → Backup** com
**"Baixar backup"**, **"Guardar cópia agora"** e a lista "Cópias no servidor" com **"Baixar"** e **"Restaurar"**. Outros
nomes: Configurações tem as partes Site, Minha conta e Backup; Equipe tem Pessoas, Papéis, Sessões e Recados; o botão
de criar pessoa é "Pôr alguém na equipe"; a senha provisória aparece em "Senha provisória de X · vale uma entrada" com
"Copiar senha".

### C.5 Como cada padrão do (c) ficou

- **Topo em toda aba**: selo "atualizado às HH:MM:SS" (vermelho "sem conexão com o servidor" depois de 3 falhas),
  números de ação (6, piscam 1,4 s ao mudar, levam à lista; 3 × 2 no celular), faixas, "Precisa de atenção" (grave ⚠
  vermelho, ação ouro, leve ·; "Está tudo certo" com `confirm()` nas dispensáveis; "N dispensados" recolhido com
  "Reabrir"), recados (borda do tom, × marca como lido só para quem fechou), toasts.
- **Pílulas** nas abas: Visão geral (alertas graves, vermelho), Na área (online, verde), Usuários (contas de hoje),
  Hall público (denúncias abertas + escondidas por denúncia), Denúncias, Indicações (pendentes); invertem na aba aberta.
- **Toasts**: embaixo no centro; sucesso ✓ some em 8 s; erro ! fica até o × (`role="alert"`); no máximo 3 na tela.
- **Botões**: travam durante o pedido com o gerúndio ("Ocultando…"); `confirm()` para o simples e reversível (dispensar
  alerta, tipo de conta — volta ao anterior se cancelar, mandar código); `<dialog>` com motivo para o destrutivo
  (motivos rápidos em chips, contador N/200, "Avisar o autor" onde esconde carreira); excluir conta: lista do que
  some, motivo da lista e o apelido digitado (sem diferenciar maiúsculas, como o servidor); restaurar cópia: digitar
  RESTAURAR.
- **Busca ao vivo**: `type=search`, atalho `/`, 300 ms, 2 letras (ou `#id`/dígitos), estado em versalete ("digite 2+
  letras", "buscando…", "N encontradas" do `total`), pedido anterior cancelado, o campo nunca é redesenhado.
- **Filas ao vivo** (Denúncias, Hall suspeitas/denunciadas, Indicações pendentes): a marca da fila do pulso é guardada
  ao carregar; mudou → busca em silêncio; com caixa marcada, campo em foco ou diálogo aberto, nada se redesenha: o que
  saiu fica apagado com "Resolvido em outra aba" e some em 4 s, e o aviso flutuante "N novas — clique para ver"
  aparece; livre, redesenha no lugar com as novas em fundo ouro por 0,9 s.
- **Lote**: caixa por linha e no cabeçalho; "Marcar os N sem alerta" (só `seguro`), "Marcar todos, inclusive os N com
  alerta" (`confirm()` que lista os sinais graves), "Desmarcar"; botões de ação com o número; a seleção sobrevive às
  atualizações; as feitas somem com fade; o resumo diz quantas foram puladas e por quê. Barra fixa no rodapé do
  celular (com a área segura); lá, com algo marcado, ficam só "Desmarcar" e as ações.
- **Fichas** no painel lateral (até 560 px; tela cheia no celular), o secundário em `<details>`; tabelas que viram
  cartões abaixo de 720 px de largura do contêiner; datas relativas com a hora de Brasília no `title`; paginação
  numérica (primeira, última, 2 vizinhas, reticências, `aria-current`, `aria-disabled`); estados vazios com frase.
- **Aparência**: Original, Claro e Alto contraste (só tokens em `html[data-tema]`), atalho T, botão "Aparência";
  **modo discreto** ligado por padrão (atalho M, botão "Discreto"): e-mail `jo***@gmail.com` com "mostrar" por linha.
- **Atalhos**: `/` busca, 1–9 e 0 abas, R recarrega a aba, T tema, M discreto, ? lista, Esc fecha (ignorados dentro de
  campo).
- **Celular**: gutter de 16 px, sem rolagem lateral da página (conferido em todas as abas pelo X8), abas roláveis,
  alvos de 40 px, diálogo `min(460px, 100vw − 32px)` com `max-height: 90dvh`, caixas do PIN menores abaixo de 420 px.
- **Acessibilidade**: `aria-current` na aba, foco volta ao botão que abriu o diálogo ou a ficha, `aria-label` nos ×,
  `prefers-reduced-motion` desliga pulso, tremor e fades.

### C.6 Diferenças em relação ao MAPA

1. Estado no hash como `#/<aba>?k=v` (o painel já usava rotas assim), não `#aba=…&id=12`; a ficha usa `conta=` e
   `carreira=` (não `id=`), para abrir por cima de qualquer aba e nunca colidir com outro filtro. O "← voltar" tira
   só esse parâmetro (os filtros de origem ficam).
2. **Denúncias continua aba própria** (5) além do filtro "Denunciadas" do Hall; são 14 abas (as do N1 + Denúncias,
   Tempo de jogo, Registro, Equipe), Backup é uma parte de Configurações e Segurança uma sub-aba do Registro (como o
   MAPA pediu).
3. Toasts: até 3 ao mesmo tempo (sai o sucesso mais velho; erro só sai no ×), em vez de um só; há também o de
   "info" (tema, CSV baixando), que some em 8 s como o de sucesso.
4. Apagar carreira pede motivo, mas não a palavra digitada: ela vai para a lixeira por 30 dias e dá para restaurar
   (o diálogo diz "Prefira Ocultar"). Digitação forte ficou para excluir conta (apelido) e restaurar cópia
   (RESTAURAR), que não voltam.
5. A ficha da conta não trazia `tipo` no `?r=usuario` (§A, A.4): o painel lia do item de `?r=usuarios&q=<e-mail>`.
   Resolvido na integração (§E.1): o servidor manda `tipo` e o pedido a mais só acontece com um servidor antigo.
6. Lote também no Hall "No Hall", "Ocultas", "Destaques" e "Todas" (ocultar ou mostrar), e na lista de bônus (X5),
   além das filas do MAPA.
7. Sinais leves ficam recolhidos ("N sinais leves") em todas as listas e cartões; graves sempre à vista.
8. Na ficha do Hall, a coluna "Salva" virou uma segunda linha em "Situação" e o pico de OVR uma segunda linha em
   "Nota" (a tabela inteira cabe em 1440 sem rolar de lado); as denúncias da carreira aparecem no chip "N denúncias".
9. "Precisa de atenção" fica em toda aba (como pede o P0-1) e também no celular; os leves aparecem em cinza, sem
   botão.
10. O modo discreto também esconde o e-mail na lista da Equipe e na ficha; o "mostrar" vale só para aquela linha e
    some ao recarregar.
11. Pílula a mais na aba Usuários (contas novas hoje, do `acao.contasHoje`) e na aba Denúncias (abertas), além das
    quatro do P1-4.
12. Testers: além do tipo na ficha, a aba Testes tem a lista dos testers com "Marcar como tester" (busca) e "Tirar".
13. Painel desligado (S1): a tela de entrada mostra só a frase do servidor (sem formulário).
14. O X4 aponta para `../#/resumo?id=<carreiras.id>&de=admin` (o pk, como no §D), no Hall, na ficha da carreira e nas
    carreiras da ficha da conta.
15. O `nomes.json` do repositório é gerado pelo `node scripts/painel-nomes.mjs` (o do build sai sempre novo).
16. Recados: × por pessoa (recibo `recado_lido`), "Apagar" só para quem escreveu ou tem `equipe`; sem edição.
17. Restaurar cópia: além do RESTAURAR digitado, o diálogo avisa que contas excluídas pelo próprio jogador depois da
    cópia voltam (B.11 item 14) e oferece `completar` como padrão.

### C.7 Testes (X8: `teste/painel/painel.mjs`, 127 verificações, ~90 s)

Pilha real (php -S + MariaDB + `instalar.php` + semente pela API), Chromium do Playwright, 1440 e 390 px: entrada
(campo E-mail no modo contas, senha errada, PIN fraco recusado, PIN criado, PIN errado "Restam 2", PIN certo); pulso,
6 números, selo, atenção com os textos do §A; Visão geral sem perder nada do §0 (12 ladrilhos, gráfico, funil,
campanhas, contas, saúde da base, tempo de resposta); ordem das abas, aba desconhecida, `aria-current`; busca ao vivo
("digite 2+ letras", "1 encontrada", foco, `q=`), filtros com contagem e no hash; discreto e M; ficha pelo hash, nota
com quebra de linha, tipo com `confirm()` (e voltar ao cancelar), X4; suspender (motivo obrigatório, chips, prazo),
código de troca de senha na suspensa, reativar; excluir (apelido digitado, no banco, motivo da lista, `400 confirma`
do servidor), toast de erro que fica; Hall: sinais, "marcar só os sem alerta", lote com confirm, ocultar com motivo e
aviso ao autor (banco), última decisão, apagar → lixeira → restaurar; fila ao vivo com uma denúncia feita por outra
conta no meio do teste; lote de denúncias e de indicações; mesmo aparelho e "Está tudo certo"; X5; Na área; relatório
e CSV (BOM e `;`); tempo de jogo; registro (filtro, detalhes, Segurança, e-mails); Saúde; X1 gravado no banco; equipe
(senha provisória de 14 sem 0/O/1/l/I, Copiar → Copiado), recado; CSP sem violação e nenhum erro de JavaScript; temas
e discreto depois de recarregar; a moderadora (senha provisória → senha nova → PIN; Equipe e Saúde com cadeado; sem
Excluir/Suspender; `403` do servidor; recado e ×); celular: números 3 × 2, nenhuma aba com rolagem lateral, ficha em
tela cheia, botões da ficha com 40 px. Com `LENDA_PRINTS=<pasta>`, tira os prints de cada aba (1440 e 390) antes.

## §D Jogo

Implementado no cliente (`src/`): X2, X3, X4, X6, H11, H12, N14 (lista de avisos), P1-4 (a tela de agora na medição),
o lado do jogo do P1-6 (conta de testes), do P1-7 (`403 hall_bloqueado`), do P1-8 (`409 apagada`), do P1-10 ("Já recebi
um código") e do A5/P2 (origem "convite" para o link `?c=`). Tudo só no build do site (`VITE_SITE=1`), nos pedaços
carregados sob demanda; **campo ausente = sem selo** (servidor antigo, sem rede ou instalar pendente: o jogo segue como
na v3.1). Nada disto pede nada a mais na abertura do jogo: os campos novos vêm nos mesmos `GET conta.php` e
`GET carreiras.php` de sempre.

### D.1 Arquivos

- Novos: `src/store/resumoAdmin.ts` (ponte do X4 entre o site e o Resumo; `estadoAdmin()`), `src/site/resumoAdmin.ts`
  (busca no `admin.php`), `src/site/SeloHall.tsx` (o selo do Hall público, usado por Minhas carreiras e pelo rodapé do
  resumo), `src/site/v32.test.ts` (27 testes).
- Mudados: `src/store/acesso.ts` (`tester`, `avisos`, `logado`, `emTeste()`, `rotaDeAdmin()`, `avisosVisiveis()`,
  `proximoVencimento()`), `src/store/comunidade.ts` (`destaque`), `src/site/{acesso,api,bonus,carreiras,conta,ContaMenu,
  ConviteConta,hallPublico,medicao,MinhaConta,MinhasCarreiras,salvar,SalvarNaConta,ui,vigias}.ts(x)`, `site.css`,
  `src/ui/shell/{AvisoFaixa,MenuDialog,TopBar,Portao}.tsx` e `aviso.css`, `src/ui/shared/landing/LandingScreen.tsx`,
  `src/ui/shared/hall/{HallScreen,Comunidade,RunDetail}.tsx` e `hall.css`, `src/ui/classic/summary/SummaryScreen.tsx` e
  `summary.css`, `src/ui/primitives/Modal.tsx` (correção achada no teste: Menu → Minha conta deixava o foco no painel
  do Menu, que ainda saía, e o Esc não fechava a Minha conta em ~3 de 4 vezes; agora só o modal de cima trata Esc/Tab,
  mesmo com o foco fora dele); nos testes antigos só os ajudantes (`v3.test.ts`: o `Acesso` ganhou 3 campos; `filtros.test.ts`:
  `destaque`).

### D.2 O que o jogo lê e manda (exatamente)

| rota | o jogo usa |
|---|---|
| `GET carreiras.php` (e o C do `salvar`/`publicar`) | `C.hall: {estado: no_hall\|revisao\|suspeita\|oculta\|fora\|privada, motivo?}` (estado desconhecido = sem selo; motivo cortado em 160). Com `hall` em alguma carreira, "quem está no Hall" passa a ser `estado = no_hall` (o `noHall`/as 3 de maior nota ficam para o servidor antigo) |
| `POST carreiras.php {acao:"salvar"}` → `409 apagada` | final: sai de `lenda:carreiras-pendentes` e `lenda:carreiras-pendentes-manual`, entra em **`localStorage['lenda:carreiras-removidas']`** (chave nova, até 300 ids) e nunca mais sobe sozinha (nem ao entrar, nem na fila, nem na troca de versão da nota). O botão "Salvar na conta" ainda tenta (se o admin usou `liberar_reenvio`, salva e tira a marca). Ao entrar, a removida é pulada e as outras 90+ seguem |
| `POST carreiras.php {acao:"publicar"}` → `403 hall_bloqueado` | toast com a mensagem do servidor (texto padrão no `api.ts`, se vier sem) |
| `GET conta.php` | `U.tester` (só `true` vale), `U.aviso: {texto (até 300), em}\|null`, `site.avisos: [{texto, tipo, publico, ate}]` (até 5; item com público estranho ou sem texto sai; `ate` que não é data vira "sem fim") |
| `POST conta.php {acao:"aviso_lido"}` | mandado assim que a Minha conta mostra o aviso (falha de rede: calado, volta na próxima abertura) |
| `GET hall.php` | `itens[].destaque` (só `true` vale). `hall.php?id=`: lê `destaque` se um dia vier (hoje o selo do resumo sai da página da lista já carregada) |
| `GET painel.php?so=eu` | também ao entrar em `#/resumo?…&de=admin` (no máximo a cada 3 s, mesmo depois de um "não"; nas rotas fechadas segue a cada 30 s) |
| `GET admin.php?r=carreira&id=<pk>` / `&carreiraId=<HallEntry.id>` | só depois do `so=eu` dizer admin. `id` só com dígitos = `carreiras.id`; senão vai como `carreiraId`. Usa `meta.{id, usuario.{id, apelido, status, hallBloqueado}, nota, oculta, suspeita, denuncias, posicaoHall, destaque, publica, moderacao.{em, motivo}, sinais[]}` e `carreira` (HallEntry). `401/403` → "Entre no painel de novo"; `404` → "Carreira não encontrada" |
| `POST e.php` | `view` com `d.rota` = a tela de agora: a rota do jogo ou, com o diálogo aberto por cima, **`/conta`** (Minha conta), **`/conta/carreiras`** (Minhas carreiras), **`/conta/entrar`** (entrar/criar conta) e **`/conquistas`**; numa sessão nova sem `view` no lote (aba 30 min no fundo), um `view` da tela de agora vai na frente (um por sessão). O `hb` não mudou: `m` só com `p: 1` (jogando), para o "Tempo de jogo por modo" não contar tela parada |
| `ctx.utm` da visita | link de convite `?c=<código>` sem `utm_source` → `utm_source = "convite"`, `utm_medium = "indicacao"` (o "De onde vieram" e a A4 separam os convites; o `origem` do cadastro também sai "convite") |

### D.3 Telas

- **X2** Minhas carreiras → Na conta: chip "No Hall público" (verde) · "Em revisão" (azul) · "Fora do Hall" (ouro quando
  é a moderação/conferência, cinza quando é escolha ou regra) · "Privada", e embaixo a frase do servidor: "Em revisão:
  entra no Hall assim que for conferida", "Fora do Hall: <motivo>" (1ª letra do motivo em minúscula), "Você escolheu não
  aparecer no Hall público.". A estrela some em `oculta`/`suspeita`/`privada`; no "Eu escolho" ela segue o `publica` (dá
  para marcar a que está em revisão). No resumo da própria carreira, o mesmo selo + frase ao lado de "Salva na sua conta"
  (a lista é relida se tiver mais de 1 min). Aviso discreto: o toast "Salva na sua conta" de uma carreira que foi para a
  revisão ganha "Em revisão: entra no Hall público assim que for conferida." (e o do lote ao entrar, "Uma delas está em
  revisão…"). Aba Neste aparelho: chip "Removida pela moderação".
- **X3** Menu (logado): linha de destaque "Convide amigos · +2, +3 e +5 de OVR na sua próxima carreira" (das regras do
  `site.bonus`; some com `maxIndicacoes = 0`; "Você já ganhou todos os bônus de indicação" quando for o caso) → abre a
  Minha conta rolada até "Indicações e bônus de OVR" (`#sc-convite-h`, com foco).
- **X4** `#/resumo?id=…&de=admin`: faixa "Visão do admin" (estado: oculta / escondida por denúncias / em revisão /
  suspeita / conta suspensa / conta fora do Hall / Nº no Hall público / fora do Hall; denúncias abertas; nota; motivo
  guardado com a data; sinais graves) + o resumo completo, sem Salvar, sem Denunciar, sem bônus de compartilhar e sem
  entrar no Hall do aparelho. Botão "Abrir no painel" → **`./painel/#/hall?carreira=<pk>`** (§C: é o `LP.hashGaveta`
  de hoje; se mudar, avise). Para quem não é admin: o resumo de sempre ("Carreira não encontrada").
- **X6** Ficha (RunDetail) de uma carreira deste aparelho: "+N de bônus" ao lado de "Carreira nº". Herói do Hall sem
  filtro: linha "Melhor da comunidade" (a 1ª do Hall público: jogador, dono, Destaque, bônus, nota) que abre o resumo dela.
- **H11** Minha conta: cartão "Aviso da moderação" no topo (texto do servidor, data, "este aviso aparece só uma vez");
  menu: "Minha conta · 1 aviso da moderação" com um ponto; ao abrir o jogo com aviso pendente, um toast "Um aviso sobre
  o Hall público" com "Ver" (some quando a Minha conta abre).
- **H12** Selo "Destaque" (ouro) na linha da comunidade, no "Melhor da comunidade" e no resumo da carreira da comunidade.
- **N14** Faixas empilhadas no topo: o `aviso` de sempre + os da lista que valem para quem está ali (logado × visitante,
  conferido de novo no aparelho, porque a conta pode entrar ou sair sem recarregar) e não venceram (um relógio tira o que
  vence); alerta primeiro; cada uma fecha no X e não volta para o mesmo texto (`localStorage['lenda:aviso-fechado']`
  virou uma lista JSON de até 30 assinaturas; a assinatura única da v3 continua valendo). Nunca na Live.
- **P1-6** Conta de testes: Live e Modo Imersivo abertos como para o admin, com "Teste · liberado para a sua conta de
  testes" no menu e "Teste · conta de testes" no selo da tela; sem "Painel do admin", sem `#/kit`/`?fixture=` e sem passar
  pela manutenção.
- **P1-10** Entrar → Esqueci a senha: "Já recebi um código" vai direto para o código + nova senha (pedir outro trocaria o
  que a equipe mandou pelo painel).

### D.4 Diferenças em relação ao MAPA e à §A

1. A §A.7 diz "Nada muda no cliente" no `e.php`; mudou pouco e de propósito: os `view` dos diálogos (`/conta`,
   `/conta/carreiras`, `/conta/entrar`, `/conquistas`, que o `onde` do `?r=agora` já traduz) e o `view` da sessão nova. O
   `hb` continua sem rota (o servidor só lê a do `view`) e com `m` só jogando.
2. A5 (P2 no MAPA): a origem "convite" do link `?c=` é marcada no jogo (utm), sem mudar o servidor.
3. A conta de testes não passa pela manutenção nem abre o `#/kit` (o MAPA só dizia "sem Painel e sem #/kit").
4. H11: o aviso é dado como lido quando aparece (não num botão "Entendi"): "mostra uma vez" mesmo se a pessoa fechar o
   diálogo sem ler até o fim; o lembrete (toast + ponto no menu) é a mais.
5. X2: o tom do selo separa castigo (ouro) de escolha/regra (cinza); a estrela do "Eu escolho" usa o `publica`.
6. Pedido à §A (opcional, não bloqueia): `destaque` também no `GET hall.php?id=` (o jogo já lê, se vier).

### D.5 Verificação

`npx tsc --noEmit -p .` limpo; `npx vitest run` 518 testes (27 novos em `src/site/v32.test.ts`: selos e textos do Hall,
`409 apagada` ao entrar e no botão, conta de testes e a ordem tester → config, `aviso_lido`, avisos por público e prazo,
fechados antigos e novos, Destaque, promessa do convite, `de=admin` (rota, pedido, meta, 401/404), tela de agora,
sessão nova e utm do convite); `npm run build:site` ok (também o build normal, sem nada do site). De ponta a ponta
(build do site + PHP + MariaDB próprios, Chromium, 50 verificações, sem erro no console): avisos de visitante × logado × vencido, conta criada com 2 carreiras 90+ (uma em
revisão, com o toast), selos em Minhas carreiras, ocultar com aviso → lembrete, cartão e `aviso_conta` apagado, "Fora
do Hall: a moderação tirou…", Convide amigos rolado, Melhor da comunidade com Destaque, "+2 de bônus" na ficha, selo no
resumo, apagar → `409` → removida sem fila, conta de testes, `visitas.rota = /conta` e "Minha conta" no `?r=agora`,
"Abrir no jogo" sem e com a sessão do painel (oculta, pelo HallEntry.id, inexistente) e o Hall do aparelho do admin
intacto, e a aba nova aberta direto no link do painel; mais prints no celular (390 px). O e2e da v3
(`teste/integracao/e2e.mjs`) contra este jogo: todas as etapas do jogo (a–d4: público, conta pelo convite, salvar pelo
botão e sozinha, indicação, bônus, conquistas, 2º aparelho, Hall público, filtros, denúncia) passam; as 9 falhas são todas
das etapas do painel (d2, e2–e7), que usam os seletores e as ações do painel da v3 (sem `motivo`) — é do §C atualizar.

## §E Integração (conferência das seções, correções e testes de ponta a ponta)

Feito depois que os quatro agentes pararam: conferi a §A, a §B, a §C e a §D entre si e contra o MAPA (rotas, ações,
campos, poderes), consertei os desencontros no lado errado, acrescentei o O7 (que era P2 da (b) e ficou sem dono) e
rodei tudo contra a pilha real.

### E.1 Desencontros consertados

| o quê | onde estava errado | o que mudou |
|---|---|---|
| `?r=usuario` sem `tipo` (C.6 #5, pendência do painel) | §A (`admin.php`) | `usuario.tipo` (`jogador`\|`tester`\|`criador`\|`oficial`\|`teste`) na ficha. Só na resposta do admin: o `U` do `conta.php` continua só com `tester`. O contorno do painel (pedido a mais ao `?r=usuarios`) fica só para servidor antigo |
| `hall.php?id=` sem `destaque` (D.4 #6) | §A (`hall.php`) | `{carreira, apelido, posicao, destaque}`; `destaque` só com o banco da v3.2 (S22: antes do instalar, `false`) |
| `tirar_bonus {id}` na tabela da C.2 | texto da §C | o painel já mandava `bonusId`, como a §A: só o texto foi corrigido |
| carreira em revisão (nota alta, X1) aparecendo no "Precisa de atenção" como "carreira suspeita" | §A (`_atencao.php`) | regra nova **`revisao`** (ação, não dispensável): "N carreira(s) de nota alta espera(m) a sua revisão para entrar no Hall", `link {aba: hall, filtro: revisao}`; a regra `suspeitas` passa a contar só `suspeita <> 'revisao'`. O número de ação `acao.suspeitas` do pulso e o filtro "Suspeitas" do Hall continuam como no MAPA (todas, inclusive a revisão). No painel, o `linkAlerta` aceita `filtro: revisao` |
| restaurar cópia: o toast dizia "0 linhas gravadas" | §C (`sistema.js`) | o `backup_restaurar` (§B) devolve `gravadas` **por tabela** (`{usuarios: 0, carreiras: 1, …}`) e `puladas` como número; o painel tratava os dois como número. Agora soma e diz quais tabelas: "1 linha gravada (carreiras 1)" |
| diálogo: o aviso "Escreva o motivo" ficava vermelho depois de escolher o motivo rápido | §C (`nucleo.js`) | o erro de um campo some quando o campo muda (`input`/`change`); volta no próximo envio, se ainda estiver errado |

Conferido e igual nos dois lados (sem mudança): todas as ações do `admin.php` e do `equipe.php` que o painel manda
existem e estão no `PODERES_ACAO`; os campos do pulso (`acao`, `alertas`, `filas`, `equipe`, `recadosNaoLidos`); o
hash da ficha (`#/hall?carreira=<pk>`, que o "Abrir no painel" do jogo usa) e o link do X4 (`../#/resumo?id=<pk>&de=admin`,
que o jogo lê como `carreiras.id`); os estados do `C.hall` (os seis do §A.7 = o `EstadoHall` do jogo); `aviso_lido`,
`U.tester`, `U.aviso` e `site.avisos`; os nomes de tela que o LEIAME §5c cita.

### E.2 O7 · e-mail pelo SMTP da caixa (era P2 da (b); nenhum agente fez)

- Config (só no arquivo, nunca no banco nem no painel): `'email_modo' => 'smtp'` e `'smtp' => ['host' =>
  'smtp.hostinger.com', 'porta' => 587, 'usuario' => <a caixa>, 'senha' => <a senha da caixa>, 'seguranca' =>
  'starttls'|'ssl' (padrão: ssl na 465), 'cafile' => <só para teste>]`.
- `enviarSmtp()` no `_lib.php` (o `enviarEmail()` escolhe pelo modo): STARTTLS obrigatório na 587 (sem ele, não manda: a
  senha não sai sem criptografia), certificado conferido (`verify_peer`, `verify_peer_name`, TLS 1.2+), AUTH PLAIN (ou
  LOGIN), corpo em base64 (não depende do 8BITMIME), `Message-ID`/`Date`, timeout de 10 s para conectar e 15 s por
  resposta. `true` = a caixa aceitou (250 depois do DATA).
- `email_log.via = 'smtp'`; a falha grava o passo e o código do servidor ("smtp AUTH: 535 …", "smtp STARTTLS: o
  certificado do servidor não conferiu", "smtp: falta host, usuário ou senha na config"), nunca o usuário nem a senha
  (nem em base64). Não vai para o log do PHP (fica no Registro → E-mails e no alerta `emails_falhando`, como a do `mail()`).
- `?r=emails` → `resumo.via: mail|arquivo|smtp`; Registro → E-mails mostra "SMTP · a caixa de e-mail, com senha e TLS",
  "Como saiu: SMTP da caixa", "aceito pela caixa" e tira o aviso de spam do `mail()`.
- Saúde: problemas `smtp_config` (grave: modo smtp sem host/usuário/senha) e `smtp_openssl` (grave: PHP sem openssl), com o
  "como resolver"; nada da caixa na resposta.
- LEIAME: as linhas do exemplo de config (§3) e o passo 9 do §5c (como ligar e conferir).

### E.3 Testes acrescentados

- `teste/teste-v32-integ.php` (incluído pelo `teste.php` depois do `teste-v32-acesso.php`, 19 verificações): o O7 contra
  `teste/smtp-falso.php` (servidor SMTP de mentira com STARTTLS de verdade, certificado sorteado na rodada pelo openssl do
  PHP, porta livre escolhida por ele): o código do "Esqueci a senha" chega pela caixa e troca a senha, `enviar_redefinicao`
  com `enviado: true`, `?r=emails` e Saúde no modo smtp, senha da caixa errada, certificado que não confere (nada é
  entregue), config incompleta; a senha da caixa entra na lista de "vazamentos"; o `tipo` do `?r=usuario`; o `destaque`
  do `hall.php?id=` (false → true na hora → false); a regra `revisao` do "Precisa de atenção".
- `teste/integracao/e2e.mjs` reescrito no lado do painel (o da v3 usava os seletores e as ações sem motivo do painel
  antigo) e com as etapas da v3.2 — ver E.4.
- `teste/integracao/carga-painel.mjs` (novo): o `carga.mjs` com o painel aberto num navegador, pulsando — ver E.4.
- `teste/integracao/atualizar.sh` + `atualizar.php` (novos): o deploy por cima do que está no ar (o `servidor/` de
  `LENDA_ATUALIZAR_REF`, padrão `HEAD` = a v3 publicada): dados de verdade pela API de antes (3 contas pelo convite,
  medição, 3 carreiras, conquistas, Hall, denúncia, carreira oculta, bônus, aviso, cookie do painel); os arquivos novos
  por cima; `instalar.php` duas vezes. Confere: a 1ª acrescenta (só ADD/CREATE, nada de DROP/MODIFY/CHANGE), a 2ª não
  muda nada, `_esquema = 32`; **cada linha de cada tabela de antes continua igual** nas colunas que já existiam (menos
  `tentativas`, que muda a cada pedido); a sessão do jogador continua; `carreiras.php` com o `hall` certo (oculta,
  revisão); salvar depois; o `e.php` do cliente de antes; o cookie antigo do painel deixa de valer (401) e a senha de
  sempre entra criando a conta Dono; resumo, atenção, ficha, Saúde (`faltam: []`) e Registro com os dados de antes.
- `teste/integracao/subir.sh` e `lib.mjs`: o socket do MariaDB vem de `LENDA_INTEG_SOCK` (padrão o de sempre) e vai
  para o `segredos.env` (o compartilhado `/run/mysqld/mysqld.sock` estava fora do ar nesta máquina).

### E.4 Resultados (rodada final, com todos os arquivos desta árvore)

Pilha: MariaDB 10.11 só da integração (porta 8829, o compartilhado estava fora do ar), `php -S`, o `dist-site/` do
`npm run build:site` desta árvore (o `api/` e o `painel/` dele iguais aos de `servidor/`), Chromium do Playwright.

- `npx tsc --noEmit -p .`: 0 erros · `npx vitest run`: 45 arquivos, 518 testes ok (2 pulados de antes) ·
  `npm run build:site`: ok (`painel/nomes.json`: 1039 clubes, 211 países, 129 troféus, 11 prêmios, 87 conquistas).
- `servidor/teste/rodar.sh` completo (com as cargas: 2.000 contas, 8.000 carreiras, 100 mil eventos): **PASSOU, 1303
  verificações** (as 1284 de antes + as 19 do `teste-v32-integ.php`), e o teste do painel pelo navegador (X8, chamado
  pelo `rodar.sh`): **127 ok, 0 falha** (prints de todas as abas em 1440 e 390). Com 2.000 contas: atenção recalculada
  14 ms, resumo 20 ms, pulso 8 ms, mesmo aparelho 28 ms; 16 listas sem filesort.
- `atualizar.sh` (a v3 publicada → esta árvore): **PASSOU, 18 verificações**, 73 linhas de 18 tabelas guardadas, 49
  conferidas uma a uma (as 24 de `tentativas` mudam a cada pedido), instalar idempotente.
- `integracao/e2e.mjs` (pilha nova do `subir.sh`, o jogo jogado pela tela em 6 aparelhos): **PASSOU, 228 ok, 0 falha**
  (635 s), sem erro de console, sem 5xx, sem violação de CSP no painel, log do PHP vazio. As etapas da v3.2: a senha de
  sempre criando a conta Dono ("Senha incorreta." antes; faixa "Cadastre o seu PIN"); PIN fácil recusado, PIN criado,
  sair (a sessão sai do banco) e entrar com o PIN ("Restam 2" no errado); "Convide amigos" no menu (+2, +3 e +5) abrindo a
  Minha conta em "Indicações e bônus de OVR" com o foco; duas carreiras de nota 93 em revisão, "Em revisão: entra no Hall
  assim que for conferida" em Minhas carreiras (celular, sem rolagem lateral); "Precisa de atenção" com "1 denúncia
  aberta (a mais antiga há …)" e "2 carreiras de nota alta esperam a sua revisão para entrar no Hall", números ao vivo e
  o link para o filtro; liberar em lote ("Liberar 2 carreiras", "2 liberadas", uma linha por carreira + a do lote; a do
  "Eu escolho" vira "fora: você escolheu outras carreiras"); suspender sem motivo barrado e com motivo; renomear, dar
  bônus, nota interna com quebra de linha (o registro só com o tamanho; nunca vai ao jogador); ocultar sem motivo barrado,
  com o chip "Nome ofensivo" e "Avisar o autor" → "Fora do Hall: a moderação tirou esta carreira do Hall público." em
  Minhas carreiras, o lembrete "Um aviso sobre o Hall público" ao abrir o jogo, "Minha conta · 1 aviso da moderação" no
  menu, o cartão "Aviso da moderação" uma vez (apagado no servidor); denúncia mantida; "Abrir no jogo" a carreira oculta
  como admin (faixa "Visão do admin · Oculta pela moderação · Motivo guardado: Nome ofensivo", sem Salvar nem Denunciar)
  e o público no mesmo endereço ("Carreira não encontrada", `admin.php` 401); apagar → lixeira, o aparelho do dono
  recebendo `409 apagada`, restaurar com o mesmo id e oculta; tester (Imersivo com "Teste · conta de testes", Live
  liberada, `#/kit` fechado); configurações com o aviso de risco e o X1 (95 → 90 no banco); CSV de contas e do relatório
  "engajados" (BOM, `;`, registrado); Registro (as ações com "quem" = Dono) e Segurança (senha errada, PIN errado, PIN
  criado); backup baixado (JSON em gzip, equipe sem senha nem PIN, sem sessões), "Guardar cópia agora", o baixado posto
  na pasta das cópias e restaurado com RESTAURAR digitado depois de o B apagar uma carreira ("1 linha gravada (carreiras
  1)", a carreira de volta); moderadora (provisória de 14 sem 0/O/1/l/I → senha → PIN; sem Excluir nem Suspender; Equipe
  com cadeado; `excluir_usuario` → `403 sem_poder` e o `negado` com quem tentou); celular com as 14 abas sem rolagem
  lateral e a ficha em tela cheia; "Sair de todos os outros" derrubando a sessão do celular (`401` e volta para a
  entrada) e mantendo a do computador; tema claro que fica depois de recarregar.
- `integracao/carga-painel.mjs 50` (depois do e2e, na mesma pilha): **PASSOU**. 50 jogadores em 75 s, 2.815 pedidos,
  nenhum 5xx; com o painel aberto passeando pelas abas e pulsando (o de 15 s e mais um a cada 2 s): 79 pulsos, todos 200,
  mediana 15 ms, p95 24 ms (o máximo, 1,4 s, foi durante a rajada de cadastros, que gastam o `password_hash`). Custo de
  um pulso no banco (sem APCu, o pior caso): 12–13 consultas; com o banco cheio (10.807 carreiras, 30.058 visitas), 211
  linhas lidas, 9 varridas e 11 ms — pelos índices (com tabelas pequenas o banco prefere ler tudo, por isso a medição com
  o banco cheio).

Problemas que eram do teste (consertados no teste): o `e2e.mjs` da v3 usava o painel antigo (seletores e ações sem
motivo); o menu do jogo só mostra o aviso da moderação na próxima abertura (o teste recarrega, como o jogador); "VISÃO DO
ADMIN" vem em maiúsculas pelo CSS; o diálogo de conta do jogo põe o foco no 1º campo ~30 ms depois de aparecer e o robô
digitava antes (a senha caía no e-mail; nenhuma pessoa digita nessa janela: o diálogo e o campo aparecem juntos, ~0,4 s
depois do clique); no `carga-painel.mjs`, com tabelas pequenas o banco prefere ler tudo (a medição passou a ser com o
banco cheio); no `atualizar.php`, o `s` da medição tem de ser UUID.

### E.5 Fora desta rodada

- "Leitura de dado sensível registrada" (tabela (d) do MAPA, P2 "pouco"): não está na (b); o "mostrar" do e-mail e o
  "Baixar JSON" da carreira não vão para o registro. Fica para quando a equipe crescer.
- TOTP no lugar do PIN (o MAPA marca como evolução).
- Itens da seção (e) do MAPA.

### E.6 Observações para o deploy

- Ordem: subir `api/` e `painel/` inteiros (o `dist-site/` do `npm run build:site` já leva), rodar o `instalar.php` na
  hora (até lá o jogo segue como na v3.1 e as telas novas do painel dão `503 instalar`), entrar com a senha de sempre e
  cadastrar o PIN (LEIAME §5c). Os cookies antigos do painel deixam de valer (todo mundo entra de novo uma vez).
- Antes de convidar alguém para a equipe, crie a sua conta pessoal (Minha conta → "Criar a minha conta"): ela só aparece
  enquanto não há conta pessoal; depois, a conta Dono cria outra conta de dono pela aba Equipe.
- Sem APCu no PHP (como no `php -S` do teste), o pulso vai ao banco a cada 15 s por aba aberta; o custo medido está no
  E.4.
- O MariaDB compartilhado desta máquina (`/run/mysqld/mysqld.sock`, PID 1358) já estava fora do ar; não mexi nele.
  Todos os testes rodaram num MariaDB só da integração (porta 8829), encerrado pelo PID no fim.

### E.7 Correções da revisão 3 · servidor (achados confirmados; cada um com teste em `teste/teste-v32-corr.php`)

Uma linha por achado: o que estava errado → o que mudou. O teste de cada um falhava antes (o mesmo cenário do achado).

| # | achado | correção |
|---|---|---|
| 1 | quem tem `equipe` (nível 70) zerava o PIN e dava senha provisória a um papel de nível 50 com poderes que ele não tem, e entrava como ele | `podeAssumir()` (`_admin.php`): além do `podeMexer`, os poderes do alvo têm de estar todos entre os de quem age; vale em `equipe_senha`, `equipe_zerar_pin`/`zerar_pin` e `equipe_ativar {ativo: true}` → `403 hierarquia` + `negado`. Desativar, mudar papel (o `podeDar` já barra), excluir e encerrar sessão seguem só o nível. `GET ?r=equipe` ganha `podeAssumir` por pessoa |
| 2 | `papel_salvar` reescrevia um papel que já existe no nível de quem age (ou com poder que ele não tem) e rebaixava quem o usa | papel existente: nível `>=` o de quem age ou poder que ele não tem → `403 hierarquia` ("Esse papel está no seu nível ou acima." / "Esse papel tem poderes que você não tem."), registrado como `negado` (as recusas do papel novo também viram `negado`) |
| 3 | `conferir_pin` lia o limite, conferia e só depois somava: pedidos juntos testavam ~10 PINs | soma antes de conferir (`somarLimite('painel-pin')` > 3 → `429 pin_travado` sem `password_verify`); o acerto apaga a chave como antes |
| 4 | excluir a conta deixava no `admin_log` o motivo escrito e o jogador das linhas `apagar_carreira` (lixeira/liberada) e `recusar_indicacao` | `limparRegistroDaConta()` (`_contas.php`): alvos `usuario:`, `carreira:` das carreiras e da lixeira dela, `indicacao:` (indicadora ou indicada) e as linhas das ações que citam o id nos detalhes (`usuario`/`indicador`/`indicado`) → `{via, excluido: true}` |
| 5 | a recusa do SMTP ("550 5.1.1 <endereço>: …") ia inteira para o `email_log.detalhe` e o `?r=emails` | `semEmails()` (`_lib.php`): todo texto com cara de e-mail vira a máscara (`ti***@exemplo.com`), também o destinatário em base64; aplicado ao gravar (`registrarEmail`) e ao mostrar (`?r=emails`, para as linhas de antes). `smtp-falso.php` recusa `recusado*@…` como o Postfix |
| 6 | o limite de 5 senhas por e-mail a cada 30 min era lido antes e somado depois: pedidos juntos (IPs diferentes) testavam 10–12 | reserva antes de conferir (`somarLimite('painel-e', …, 1800)` > 5 → `429`); quem acerta devolve a reserva (`n = n − 1` na mesma janela), então não se trava sozinho |
| 7 | o `password_verify` do e-mail inexistente usava um bcrypt fixo de custo 12; no PHP 8.1–8.3 (custo 10) levava ~4× e mostrava quem é da equipe | `hashParaTempoIgual()` (`painel.php`): o hash de uma conta de verdade (o custo em uso); sem nenhuma, um bcrypt fixo com o custo de fábrica da versão do PHP (10 até o 8.3, 12 no 8.4) |
| 8 | a restauração (completar/substituir) trazia de volta a conta que o próprio jogador excluiu (só pulava as do `excluir_usuario` do admin) | tabela nova **`contas_excluidas`** (`usuario_id` PK, `em`, `via` titular\|admin; sem e-mail nem apelido), gravada no `excluirUsuario()` (titular e admin); o `restaurarCopia` pula esses ids (e os do registro, para as de antes) e a tabela vai no backup (só completa). `privacidade.html` diz quanto tempo ficam as cópias do servidor e que a conta excluída nunca volta; o aviso de LGPD do LEIAME §8 saiu |
| 9 | o backup paginava chave composta com `(a, b) > (?, ?)`, que lê o índice desde o começo a cada lote (quadrático: 1 milhão de conquistas ~75 s) | `depoisDaChave()` (`_copias.php`): forma expandida `(a > ? OR (a = ? AND b > ?))`, lida como faixa (um lote depois de 25 mil contas lê ~1.000 linhas) |
| 10 | carreira APAGADA pela moderação: outra conta (a segunda do aparelho) salvava o mesmo HallEntry e ele voltava ao Hall (apagar protegia menos que ocultar) | `lixeira_carreiras.resumo_hash` (coluna e índices novos; o `apagarCarreiraAdmin` grava, o `instalar.php` preenche as de antes pela `linha`) e `copiaDeApagada()` na plausibilidade: mesmo `carreira_id` ou mesmo resumo na lixeira de outra conta → suspeita `copia` |
| 11 | "substituir" apagava a `lixeira_carreiras` e regravava sem a cópia: "Restaurar (oculta)" dizia "venceu" | o backup leva a lixeira **com** `dados` (base64, como carreiras: `binarios.lixeira_carreiras`); no "substituir" a lixeira é regravada linha a linha (`ON DUPLICATE KEY UPDATE`), mantendo a cópia do banco quando o arquivo não a traz (backup de antes) e a linha é a mesma; o que entrou depois da cópia sai. `409 sem_copia` separa "venceu (30 dias)" de "não veio na restauração do backup" |
| 12 | dois admins na mesma denúncia: o segundo ("Manter", tela velha) recebia 200, trocava o motivo guardado e reescrevia a denúncia fechada | `resolver_denuncia` com a denúncia já fechada e nenhuma outra aberta → **`409 ja_decidida`** `{estado: {oculta, resultado, em}}`, nada muda; não reescreve mais o status de denúncia fechada; "ok" numa carreira escondida pelo admin (`oculta = 1`) fecha a denúncia sem mexer no motivo de quem escondeu |
| 13 | `?r=tempo&jan=tudo` fazia 4 varreduras inteiras de `visitas` a cada abertura (~27 s com 1,5 milhão) | resposta guardada em `site_config._tempo:<jan>:<grupo>` (tudo: 10 min ou 4× `painel_cache_s`; mês/30 dias: 3 min ou 2×; semana na hora; `painel_cache_s = 0` desliga; com `usuario=` ou CSV, sempre na hora), um pedido recalcula de cada vez (trava `lenda_tempo`), por dia e por modo numa passada só. Resposta ganha **`geradoEm`**. O ranking guardado cita apelidos: o `excluirUsuario()` apaga os guardados (`_tempo:*` e `_painel:*`) junto com a conta |
| 14 | com conta `teste`/`oficial`, o filtro `usuario_id NOT IN (…)` tirava a cobertura do `ix_visitas_inicio` (~75% mais lento) | `painel.php` filtra por `sid NOT IN (SELECT sid FROM visitas WHERE usuario_id IN (…))`: o `sid` (PK) está em todo índice secundário, a consulta do período continua só no índice; nenhum índice novo |
| 15 | X2: "No Hall público" sem estar na fotografia (o `hall.php?id` dava 404) e "Em revisão: entra no Hall assim que for conferida" em carreira que não entraria | estado novo **`entra_na_proxima`** `{motivo: "Entra no Hall público na próxima atualização (por volta das HH:MM)."}` (entra pelas regras de agora, ainda não está na `hall_foto`); `no_hall` só na fotografia; `revisao` só promete quando, conferida, ela estaria entre as que a conta mostra (`idsNoHallConferidas`), senão "Em revisão: a moderação confere as notas altas antes do Hall." (`C.noHall` continua como antes) |
| 16 | escondida pelas denúncias (`oculta = 2`) que o dono apagou e salvou de novo ficava sem denúncia e sem saída no lote ("sem_abertas") | `resolver_denuncias_lote` decide também a carreira com `oculta = 2` sem denúncia aberta ("ok" devolve e apaga a decisão guardada; "ocultar" → 1) |
| 17 | três números para "Suspeitas" (pulso, alerta, lista) e a lista mostrava as já escondidas pelo admin | `?r=hall&filtro=suspeitas` = `suspeita IS NOT NULL AND oculta = 0` (o mesmo do pulso e da marca da fila; o alerta `suspeitas` + o `revisao` somam o pulso); as escondidas ficam em "Ocultas". O `?r=resumo.carreiras.suspeitas` (ladrilho "Carreiras suspeitas" da Visão geral, que abre essa lista) também passa a contar só `oculta = 0` |
| 18 | `visitas.modo_atual` = último modo, e o "por modo" punha todo o tempo da sessão nele (Clássico → Imersivo = tudo no Imersivo); no Menu o selo do último modo ficava | colunas novas `visitas.jogando_classico_s`, `jogando_imersivo_s`, `jogando_live_s` (o `e.php` divide o tempo jogando pelos batimentos de cada modo); batimento com `m` null/ausente (Menu) põe `modo_atual = NULL` (modo desconhecido é ignorado); `?r=tempo.porModo` e `?r=usuario.tempo.porModo` leem as colunas (visitas de antes: o `modo_atual` leva tudo, como antes) e só trazem modos com tempo > 0 |
| 19 | `GROUP_CONCAT` dos grupos de aparelho cortava em ~146 contas no MySQL 8 (1024) e o último id saía pela metade | `bd()` dá `SESSION group_concat_max_len = 1048576` na mesma linha do `SET NAMES`; o `gruposMulticontas` relê os ids do aparelho quando a contagem não bate ou a lista é longa |

O que muda para o painel (§C) e o jogo (§D) — campos novos são opcionais (servidor antigo = sem eles):
- Jogo: `C.hall.estado` pode vir **`entra_na_proxima`** (com `motivo`); o `EstadoHall`/`seloHall` do jogo ainda não o conhece (sem o estado, o selo não aparece). Sugestão: rótulo "Entra em breve", `tom: 'ok'`, texto = o `motivo`; ela não conta como "no Hall" no `idsNoHallPublico`.
- Painel: o chip do X2 na ficha (`usuarios.js`, `chipHall`) mostra `entra_na_proxima` cru: rótulo sugerido "Entra em breve" (`ok`), `title` = o `motivo`. `409 ja_decidida` no `resolver_denuncia` (toast com a `mensagem` e recarregar a fila); `podeAssumir` em `?r=equipe` (esconder "Senha provisória", "Zerar PIN" e "Reativar" quando `false`; o servidor recusa com `403 hierarquia` de qualquer jeito); `geradoEm` no `?r=tempo`; `porModo` sem as linhas zeradas; o lote de denúncias aceita a `oculta = 2` sem denúncia.
- Banco (`_schema.sql`, o `instalar.php` só acrescenta; `_esquema` continua 32): `contas_excluidas`, `lixeira_carreiras.resumo_hash` + `ix_lixeira_carreira_id` + `ix_lixeira_resumo`, `visitas.jogando_classico_s`/`jogando_imersivo_s`/`jogando_live_s` (`NOT NULL DEFAULT 0`).
- Alterado de propósito num teste antigo: `teste-v32-acesso.php` "…e reativa" — o gerente (sem `moderar`) agora recebe `403 hierarquia` ao reativar a moderadora; quem reativa é a dona.
- Teste que oscilava (não é achado): os limites contam em janelas de 10 min do relógio, e um teste que caía na virada (ex.: "com ip_cabecalho: endereços do mesmo /64…", a 11ª senha dava 401 em vez de 429) via o contador recomeçar no meio. O `resetarLimites()`/`resetarLimitesCurtos()` do `teste.php` agora espera a janela nova quando faltam menos de 20 s.
- Resultado (rodada final desta correção, `rodar.sh` completo com as cargas, Apache e o painel pelo navegador): **PASSOU, 1379 verificações** (100 no `teste-v32-corr.php`), painel **127 ok** e correções do painel **72 ok**, 0 falha.

### E.8 Correções da revisão 3 · painel e jogo (achados confirmados; cada um com teste em `teste/painel/correcoes.mjs`, que o `teste/painel/rodar.sh` roda na mesma pilha depois do `painel.mjs`, ou em `src/site/v32.test.ts`)

Uma linha por achado: o que estava errado → o que mudou. O teste de cada um reproduz o cenário do achado e falhava antes.

| # | achado | correção |
|---|---|---|
| 1 | fila ao vivo: o clique no aviso "N novas — clique para ver" e o redesenho de 4 s desenhavam a resposta guardada no pulso (a carreira já decidida voltava aberta, com os botões, e o subtítulo velho), os 4 s não conferiam de novo se o admin ficou ocupado e voltavam à rolagem antiga, e o `#novidade` era um só (o recado trocava o aviso da fila) | `LP.atualizarFila({…, recarregar(novos)})`: o clique no aviso e o fim dos 4 s buscam a lista de novo (`carregarDen`/`carregarHall`/`carregar(false, novos)`), nunca a resposta guardada; os 4 s conferem `LP.ocupadoAgora` de novo (ocupado → só o aviso); `LP.trocarNoLugar` guarda a rolagem do momento da troca; `LP.novidade(texto, aoClicar, origem)` tem um item por origem (`fila` × `recados`, `LP.esconderNovidade(origem)`), e a lista refeita tira o aviso da fila |
| 2 | depois de uma ação desta aba (lote ou individual), "N itens resolvidos em outra aba ou aparelho" e o selo "Resolvido em outra aba" (o pulso pedido pela ação chegava antes do fade de 450 ms) | `LP.marcarFeitos(tipo, ids)` (vale 60 s) no fim de toda ação de Hall, Denúncias e Indicações; o `atualizarFila` não conta em `sairam` os ids feitos aqui (`LP.feitosAqui`) |
| 3 | o pulso de 15 s e o resumo de 60 s recriavam os chips de filtro (Hall, Denúncias, Indicações) e a Na área refazia filtros, caixa e tabela: o foco do teclado ia para o BODY; o clique num chip (Usuários, Hall) também | `LP.trocarSegmentos`: com os mesmos valores, só `aria-pressed` e o texto dos contadores mudam (o botão é o mesmo); os chips de Usuários são atualizados no lugar; a Na área faz chips e caixa uma vez e troca a tabela com `LP.trocarNoLugar` + `LP.guardarFoco` (linha por `data-id`, chip por `data-valor`, parte por `data-foco`) |
| 4 | Indicações → Mesmo aparelho: "Está tudo certo" num grupo de 2 contas (ou fora dos 10 do "Precisa de atenção") dava sempre `400 chave` | servidor (`_atencao.php`, `dispensarAlerta`): chave `multi:` que não está no cálculo da atenção vale se for de um grupo do `gruposMulticontas()`; o painel não muda (o botão continua em todo cartão, como pede o P1-9) |
| 5 | Configurações → Bônus de OVR: o trio "1º/2º/3º amigo" passava do cartão em 360 px (362 > 360) e 320 px (336 > 320) | `.trio > .campo { min-width: 0 }`, `.trio .numero-campo` flexível (`min-width: 0`, `max-width: 100%`) e o campo com `flex: 1 1 56px; max-width: 92px` (sem largura fixa); 360 e 320 px sem rolagem lateral |
| 6 | Minhas carreiras: a estrela "Pôr no Hall" e o toast "Aparece na próxima atualização do Hall, em até 3 h." para carreira "fora" que nunca entra (Imersivo, nota antiga) | servidor: `hall.porque` no "fora" (`bloqueada` · `imersivo` · `versao` · `duplicada` não mudam com a estrela; `escolha` · `limite` mudam); jogo: `estrelaDoHall(h, marcada)` esconde a estrela nos quatro primeiros (fica para tirar uma já marcada) e `avisoAoPublicar(jogador, sim, hallDevolvido)` usa o `hall` que o publicar devolve (fora → toast "info" com o motivo, nunca a promessa) |
| 7 | botões sem trava no pedido: dois cliques em "Anotar" abriam dois diálogos e "Destacar" mandava dois POST (e duas linhas no Registro); o mesmo em "Zerar PIN", "Encerrar" sessão, "Marcar como lido"/"Apagar" recado, "Apagar" papel e "Tirar" tester | `gerundio` em todos ("Abrindo…", "Destacando…"/"Tirando…", "Zerando…", "Encerrando…", "Marcando…", "Apagando…", "Tirando…"): o `LP.botao` trava enquanto a Promise não termina |
| 8 | Usuários: ordenar pelo cabeçalho mudava a lista e o hash, e o seletor "Ordem" ficava com o valor antigo | a referência do select fica em `lista.selOrdem` e todo `carregar()` põe nele a ordem de agora |
| 9 | "Precisa de atenção" redesenhado a cada 60 s (e a cada pulso com alerta mudado): o "N dispensados" aberto fechava e o foco se perdia | o mesmo conteúdo (chaves, níveis, textos, dispensados) só troca a hora do subtítulo; conteúdo novo redesenha guardando o `open` do `<details>` e o foco (`data-foco` por alerta e por dispensado) |
| 10 | recado "Fixo" saía do topo depois do × como os outros (a caixa prometia "não sai do topo quando alguém lê") | o topo mostra os fixos lidos ou não; o fixo não tem ×: tem "Marcar como lido" (só a leitura, ele continua no topo) e, lido, fica sem botão |
| 11 | aba Testes: a lista de testers sem a coluna "Desde" (P1-6: Quem, Desde, Tirar) | servidor: `tipoEm` no item do `?r=usuarios`; painel: coluna "Desde" (`LP.quando(u.tipoEm)`) |
| 12 | 1024–1280 px: a 1ª coluna das tabelas largas saía da tela com a rolagem lateral e os rótulos dos números de ação saíam cortados ("Denúncias a…") | modo tabela: `position: sticky; left: 0` com o fundo do cartão na coluna principal (e na caixa de marcar, com a principal logo depois); `.numero-acao span` quebra em duas linhas (`white-space: normal`) |
| 13 | (a) Registro mostrava "copia_baixar" cru; (b) Equipe → Sessões mostrava a etapa crua; (c) o "Quem" do Registro pedia o código interno "a1 (pessoa) ou token"; (d) busca, raridade e ordem de Conquistas fora do hash | (a) `copia_baixar: 'Baixou cópia do servidor'` em `LP.NOMES_ACAO_LOG` (o teste confere toda ação gravada por `registrarAdmin` nos .php); (b) `LP.NOMES_ETAPA`/`LP.etapa` ("digitando a senha", "digitando o PIN", "criando o PIN", "trocando a senha provisória"); (c) "Quem" virou select com as pessoas da equipe pelo nome e "Script (token)", e o nome em cada linha é um link que filtra; (d) `q`, `raridade`, `ordem` e `dir` de Conquistas no hash (voltam ao recarregar) |

Depois de reler a §E.7 (correções do servidor), o lado do cliente acompanha (testes no `correcoes.mjs` bloco 8b e no `v32.test.ts`):
- Jogo: `C.hall.estado` **`entra_na_proxima`** entra no `EstadoHall`: selo "Entra em breve" (`tom: 'ok'`, texto = o `motivo` com a hora), estrela como no "no_hall", toast do publicar com o `motivo`. **Diferença em relação à sugestão da §E.7**: ela **conta** no `idsNoHallPublico` (o "N/3 no Hall da comunidade" e a estrela marcada no automático), porque é uma das que a conta mostra pelas regras de agora; sem isso, no automático a estrela aparecia vazia e tocá-la tentava pôr de novo uma carreira que já entra.
- Painel: o chip do X2 na ficha mostra "Entra em breve" (`ok`, `title` = o `motivo`); `409 ja_decidida` no `resolver_denuncia` fecha o diálogo, mostra "Essa denúncia já foi decidida (…). A lista foi atualizada." e busca a fila de novo; `podeAssumir: false` em `?r=equipe` esconde "Senha provisória", "Zerar PIN" e "Ativar" (campo ausente = pode, servidor antigo). O `geradoEm` do `?r=tempo` vai no subtítulo do Tempo de jogo ("· números das HH:MM": o "tudo" fica guardado até 10 min).

### E.9 Rodada final da v3.2 (depois das correções da revisão 3)

Tudo rodado de novo com a árvore de agora, no MariaDB compartilhado (`/run/mysqld/mysqld.sock`, de pé de novo nesta
máquina), bancos `lenda_v32_final_*`, portas 8880–8889. No fim, os bancos foram apagados e os processos encerrados pelo PID.

- `npx tsc --noEmit -p .`: 0 erros · `npx vitest run`: 45 arquivos ok (2 pulados), **521 testes ok** (2 pulados) ·
  `npm run build:site`: ok (737 arquivos, 20,54 MB; `api/` 26 arquivos, `painel/` 15; `painel/nomes.json`: 1039 clubes,
  211 países, 129 troféus, 11 prêmios, 87 conquistas). O `api/` e o `painel/` do `dist-site/` são iguais aos de
  `servidor/` (`diff -r` vazio; o `servidor/painel/nomes.json` recebeu o do build, que só mudava o `geradoEm`), sem
  `_config*`, teste, `.md`, `.log`, `.env` nem chave.
- `servidor/teste/rodar.sh` completo (com as cargas: 2.000 contas, 8.000 carreiras, 100 mil eventos; Apache; o painel pelo
  navegador): **PASSOU, 1379 verificações**; painel (X8) **127 ok, 0 falha**; correções do painel **72 ok, 0 falha**.
- `integracao/e2e.mjs` inteiro, com as etapas da v3.2 (pilha nova do `subir.sh`, banco `lenda_v32_final_e2e`, porta 8888):
  **PASSOU, 230 ok, 0 falha** (647 s); console sem erro, nenhum 5xx, CSP do painel sem violação, log do PHP vazio.
- `integracao/carga-painel.mjs 50` (depois do e2e, na mesma pilha): **PASSOU**. 50 jogadores em 75 s, 2.815 pedidos,
  nenhum erro nem 5xx; 79 pulsos durante a carga, todos 200, mediana 15 ms, p95 354 ms (limite 800 ms), máximo 1,6 s
  (na rajada de cadastros); 12–13 consultas por pulso; com o banco cheio (10.807 carreiras, 30.058 visitas), 211 linhas
  lidas, 9 varridas e 11 ms por pulso.

Consertado nesta rodada (só nos testes; nada do que vai para o site mudou):
- `teste/integracao/e2e.mjs`, etapa f2: esperava "Em revisão: entra no Hall assim que for conferida." também na carreira
  do A, que está no "Eu escolho" com as 3 já escolhidas; pela correção §E.7 #15 o servidor não promete essa entrada
  ("Em revisão: a moderação confere as notas altas antes do Hall."). A 1ª rodada deu 226 ok e essas 2 falhas. A etapa
  agora confere os dois lados: a do A sem a promessa (GET `carreiras.php` e Minhas carreiras no celular) e a do B
  (automático, 1 carreira) com a promessa (GET e Minhas carreiras).
- `teste/rodar.sh`: com o `LENDA_TESTE_BASE` dentro de uma pasta que o `www-data` não atravessa (ex.: uma pasta 700 do
  root), o Apache respondia 403 a tudo e 13 verificações do `.htaccess` "falhavam" sem culpa das regras (1ª rodada: 1366
  de 1379). Agora, quando o `www-data` não chega no `$BASE`, a cópia do Apache vai para uma pasta própria em `/tmp`
  (`lenda-teste-apache.*`, apagada no fim) e o script avisa isso na saída.
