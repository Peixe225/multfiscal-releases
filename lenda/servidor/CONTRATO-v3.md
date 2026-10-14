# LENDA · servidor v3 — Hall público, conquistas na conta, indicações e bônus, admin completo

Continua `CONTRATO.md` (tudo de lá vale; aqui só o que é novo ou muda). Mesmas regras gerais: JSON, `no-store`
(salvo onde dito), escrita só com Origin válida, erros `{"erro","mensagem"}` em pt-BR, limites em `tentativas`, IP
nunca gravado, datas em UTC, painel em America/Sao_Paulo.

## 1. Configuração do site (no banco, editável no painel)

Tabela `site_config(chave PK, valor TEXT JSON, atualizado_em, atualizado_por)`. O `regras` do arquivo de config
vira só o padrão; o banco manda. Chaves e padrões:

| chave | padrão | o que faz |
|---|---|---|
| `regras` | `{"aposPartidas":5,"obrigatorio":false,"lembrarACada":3}` | convite de conta |
| `imersivo_publico` | `false` | Modo Imersivo aberto a todos (senão: "Em desenvolvimento"; só admin joga) |
| `live_publica` | `false` | Live interativa visível a todos (senão: só admin vê/abre) |
| `aviso` | `null` ou `{"texto":"…","tipo":"info"\|"alerta"}` | faixa no topo do jogo |
| `manutencao` | `false` | tela "Em manutenção" para quem não é admin |
| `bonus` | `{"indicacao":[2,3,5],"compartilhar":2,"liberaAposPartidas":3,"maxIndicacoes":3}` | bônus de OVR |
| `hall_intervalo_min` | `60` (60–180) | de quanto em quanto tempo o Hall público é recalculado |
| `cadastro_aberto` | `true` | fecha novos cadastros (entrar continua) |

`GET conta.php` passa a responder também `"site": {"imersivoPublico", "livePublica", "aviso", "manutencao",
"cadastroAberto", "bonus": {...}}` (sem nada secreto). Cache curto no PHP (APCu se existir; senão leitura direta).

## 2. Administrador

- Sessão de admin = o cookie `lenda_painel` que já existe (ou `Authorization: Bearer`).
- `GET painel.php?so=eu` → `200 {"admin":true}` ou `401`. O jogo usa isso para liberar o que é só do admin
  (Imersivo de teste, Live). Nada de segredo no cliente: o servidor sempre confere.
- `admin.php` (todas as rotas exigem admin; toda ação de escrita vai para `admin_log(id, em, acao, alvo, detalhes JSON)`):

| rota | resposta / efeito |
|---|---|
| `GET ?r=usuarios&q=&status=&ordem=recentes\|partidas\|nota\|tempo&pagina=1` | `{total, pagina, porPagina:50, itens:[{id, apelido, email, criadoEm, ultimoAcesso, status, partidas, carreiras, melhorNota, tempoJogadoMin, origem, indicacoes, bonusDisponiveis}]}` (`q` busca em apelido/e-mail) |
| `GET ?r=usuario&id=` | perfil completo: o `U` do contrato + `status`, `suspensoAte`, `motivo`, carreiras (lista C), conquistas, indicações feitas e recebida, bônus (todos), sessões de login ativas (criada/expira), últimas 50 visitas (início, tempo, origem, aparelho) e últimos 100 eventos |
| `POST {acao:"suspender", id, motivo, dias?}` | `status='suspenso'`, derruba as sessões, esconde as carreiras do Hall público. Sem `dias` = até reativar |
| `POST {acao:"reativar", id}` | volta a `ativo` |
| `POST {acao:"deslogar", id}` | apaga as sessões de login |
| `POST {acao:"renomear", id, apelido}` | troca o apelido (moderação) e atualiza o Hall público |
| `POST {acao:"excluir_usuario", id}` | igual ao `excluir` da conta (LGPD), sem pedir senha |
| `POST {acao:"dar_bonus", id, valor (1–5), motivo}` / `{acao:"tirar_bonus", bonusId}` | bônus manual |
| `GET ?r=hall&filtro=publicas\|ocultas\|suspeitas\|denunciadas&pagina=` | carreiras do Hall público com dono, nota, flags e denúncias |
| `POST {acao:"ocultar_carreira"\|"mostrar_carreira"\|"apagar_carreira", id}` | moderação do Hall (`id` = carreiras.id) |
| `POST {acao:"atualizar_hall"}` | recalcula o Hall público agora |
| `GET ?r=denuncias&pagina=` / `POST {acao:"resolver_denuncia", id, resultado:"ok"\|"ocultar"}` | fila de denúncias |
| `GET ?r=config` / `POST {acao:"config", valores:{chave: valor, …}}` | lê/grava `site_config` (valida cada chave e faixa) |
| `GET ?r=indicacoes&pagina=` | indicações (indicador, indicado, status, quando) |
| `GET ?r=conquistas` | por conquista: quantos jogadores têm |
| `GET ?r=log&pagina=` | registro das ações de admin |
| `GET ?r=exportar&tipo=usuarios` | CSV (`;`, UTF-8 com BOM): id, apelido, e-mail, criado, último acesso, status, partidas, carreiras, origem. Também vai para o log |

## 3. Contas: mudanças

- `usuarios` ganha `status` (`ativo`/`suspenso`), `suspenso_ate`, `motivo_suspensao`, `codigo_convite` (8 letras/
  números sem ambíguos, único), `hall_publico` (`auto`/`manual`/`nao`, padrão `auto`).
- Suspenso: `entrar` responde `403 {"erro":"suspenso","mensagem":"Sua conta está suspensa…"}`; qualquer rota logada
  idem; `GET conta.php` devolve `usuario: null`.
- Apelido e nome do jogador passam por filtro de palavrões/ofensas pt-BR (lista no servidor, sem acento e sem
  leetspeak simples: 4→a, 3→e, 1→i, 0→o, @→a) e nomes reservados (admin, adm, moderador, lenda, oficial, suporte):
  `400 {"erro":"apelido_proibido"}`. Carreira com nome de jogador proibido não entra no Hall público.
- `conta.php` `perfil` aceita também `hallPublico: "auto"|"manual"|"nao"`.
- `cadastrar` aceita `convite` (código de quem indicou) — ver §6.
- Limites amigos de 4G (CGNAT, muita gente no mesmo IP): cadastrar 30/IP e 200 no site a cada 10 min; entrar 60/IP
  e 5/e-mail; esqueci 20/IP e 3/e-mail.

## 4. Hall público (carreiras dos jogadores no Hall das Lendas)

- Cada conta tem até **3** carreiras no Hall público. `hall_publico = auto`: as 3 de maior nota (versão atual) entre
  as salvas na conta; `manual`: as que o jogador marcou (até 3); `nao`: nenhuma.
- `carreiras` ganha `publica` (0/1, a escolha manual), `oculta` (admin), `suspeita` (motivo ou NULL), `clubes`
  (JSON com os `clubId` de `summary.clubs`), `copas` (Copas do Mundo, de `summary.trophies` `world-cup`), `bonus_ovr`
  (do HallEntry `career.bonusOvr`, 0 sem bônus). Índice `(usuario_id, nota)`.
- `POST carreiras.php {acao:"publicar", id, sim: true|false}` (precisa `hall_publico = manual`; passa o modo para
  manual se estiver em auto e confirma o limite de 3: `409 {"erro":"limite_hall"}`).
- Confere plausibilidade ao salvar (fica `suspeita` e fora do Hall até o admin liberar): temporadas 1–30, pico
  40–99, nota 0–100, gols ≤ 90 × temporadas, Bolas de Ouro ≤ temporadas, títulos ≤ 15 × temporadas, idade final ≤ 45,
  `legacy.v` = versão atual.
- **Fotografia**: tabela `hall_foto` = cópia das carreiras públicas visíveis (de contas ativas, não suspeitas, nota
  na versão atual), com `posicao` geral, refeita no máximo a cada `hall_intervalo_min` (preguiçosa: o primeiro
  pedido depois do prazo refaz, com `GET_LOCK('lenda_hall', 0)` para só um refazer; os outros leem a foto antiga) ou
  pelo admin. Tabela auxiliar `hall_foto_clubes(foto_id, club_id)`.
- `GET hall.php?pais=BOL&clube=<clubId>&pagina=1` (público, sem login; `Cache-Control: public, max-age=300`) →
  `{"atualizadoEm","proximaEm","total","porPagina":50,"itens":[{"id": "<HallEntry.id>","posicao","apelido",
  "jogador","numero","pais","posicaoCampo","nota","picoOvr","temporadas","gols","titulos","bolasOuro","copas",
  "headline","clubes":["e1234",…],"bonusOvr","terminouEm"}]}`. Sem filtro = geral. `pais` = código FIFA.
- `GET hall.php?id=<HallEntry.id>` → `{"carreira": HallEntry, "apelido"}` só se ela está na foto (pública e
  visível); senão `404`. Para abrir o resumo completo da carreira de outro jogador.
- `POST hall.php {acao:"denunciar", id, motivo: "nome"|"trapaca"|"outro", texto?}` (precisa estar logado; 10/conta/dia;
  1 por carreira por conta) → `200 {"ok":true}`. Com 5 denúncias de contas diferentes a carreira fica oculta até o
  admin decidir.

## 5. Conquistas na conta

- Tabela `conquistas_usuario(usuario_id, conquista_id, em, PK(usuario_id, conquista_id))`.
- `GET conquistas.php` (logado) → `{"conquistas":[{"id","em"}]}`.
- `POST conquistas.php {acao:"sincronizar", conquistas:[{id, em}]}` → mescla (união; fica a data mais antiga),
  responde a união. `id` = `^[a-z0-9_.:-]{1,64}$`, até 500 por envio; `em` ISO (data futura vira agora).
- `GET conquistas.php?raridade=1` (público, cache 1 h no servidor e `max-age=3600`) → `{"jogadores": n,
  "porConquista": {"id": n}}` (só contas ativas).

## 6. Indicações e bônus de OVR

- Link de convite: `https://oprojeto.online/lenda/?c=<codigo_convite>` (o jogo guarda o código em
  `localStorage['lenda:convite']` na primeira visita com `?c=`, por 30 dias, e manda no `cadastrar`).
- `indicacoes(id, indicador_id, indicado_id UNIQUE, criada_em, status 'pendente'|'valida'|'recusada', motivo,
  validada_em)`. No cadastro com código válido: recusada se for a própria conta, se o `vid` do cadastro já é de um
  aparelho ligado ao indicador (`visitantes_usuarios`) ou se o indicador está suspenso. O indicado vale
  (`valida`) quando termina a 1ª partida (Clássico) depois do cadastro (evento `jogo_fim` ligado à conta, ou
  `conta.php acao=partidas` com n ≥ 1 e eventos que confirmem).
- `bonus(id, usuario_id, valor, origem 'indicacao'|'compartilhar'|'admin', ref, criado_em, usado_em, carreira_id)`.
- Regras (de `site_config.bonus`):
  - Indicações: a 1ª válida dá `+2`, a 2ª `+3`, a 3ª `+5`; no máximo `maxIndicacoes` (3) na vida da conta.
  - Compartilhar o card final de uma carreira: `+2`, no máximo 1 por dia (data de Brasília).
  - **Todos os bônus de compartilhar e indicar só são liberados depois de `liberaAposPartidas` (3) partidas
    terminadas desde o cadastro.** Indicação validada antes disso fica guardada e o bônus é creditado quando liberar;
    compartilhar antes disso não dá bônus.
- `GET bonus.php` (logado) → `{"liberado": bool, "faltamPartidas": n, "disponiveis":[{"id","valor","origem",
  "criadoEm"}], "usados": n, "indicacoes":{"validas","pendentes","limite","proximoValor"}, "compartilharHoje":
  bool, "codigoConvite", "linkConvite"}`.
- `POST bonus.php {acao:"usar", carreiraId}` → marca o bônus disponível mais antigo como usado nessa carreira e
  responde `{"valor": n}` (ou `{"valor": 0}` sem bônus). Um bônus por carreira; repetir com o mesmo `carreiraId`
  devolve o mesmo valor (idempotente).
- `POST bonus.php {acao:"compartilhei", carreiraId}` → `{"ganhou": 0|2, "motivo"?: "ja_hoje"|"bloqueado"}`.
- No jogo: ao começar uma carreira do Clássico, com conta e bônus disponível, a tela de criação mostra "Bônus de
  OVR: +3 (indicação)" com opção de usar agora (padrão: usar). O motor recebe `bonusOvr` e o jogador fica N pontos de
  OVR acima do normal durante a carreira inteira (o `CareerState` guarda `bonusOvr`; o resumo e o Hall mostram
  "+N de bônus").

## 7. Painel (front)

O painel atual (números) continua igual e ganha abas: **Visão geral** (o de hoje), **Usuários** (tabela com busca,
filtros e ordem; detalhe com todas as ações do §2), **Hall público** (moderação: suspeitas, denunciadas, ocultas;
abrir, ocultar, mostrar, apagar; "Atualizar Hall agora"), **Conquistas** (raridade), **Indicações e bônus**,
**Configurações** (todas as chaves do §1, com validação), **Testes** (abrir o Imersivo e a Live em outra aba, só para
o admin) e **Registro** (log). Tudo escapado (nada de `innerHTML` com dado de usuário), CSP `default-src 'self'`.

## 8. Servidor: o que foi implementado (detalhes que valem sobre o resumo acima)

Nomes de rotas, ações e campos dos §1–§7 não mudaram; aqui estão os campos a mais e as decisões dos pontos que o
resumo deixava em aberto. Para publicar: suba os arquivos novos de `api/` e rode o `instalar.php` de novo (ver
LEIAME).

### 8.1 Arquivos novos

`api/hall.php`, `api/conquistas.php`, `api/bonus.php`, `api/admin.php` (rotas) e `api/_palavras.php` (lista do filtro),
`api/_contas.php`, `api/_carreiras.php`, `api/_hall.php`, `api/_bonus.php` (módulos; o `.htaccess` nega `_*`, e cada
um responde 404 se for chamado direto). `bonus.php` e `admin.php` saem com `no-store` também pelo `.htaccess`;
`hall.php` e `conquistas.php` definem o próprio cache (como o `lendas.php`).

### 8.2 Conta (`conta.php`)

- `GET` → `{"usuario": U|null, "regras": {...}, "site": {"imersivoPublico", "livePublica", "aviso", "manutencao",
  "cadastroAberto", "bonus": {"indicacao":[2,3,5],"compartilhar":2,"liberaAposPartidas":3,"maxIndicacoes":3}}}`.
  `regras` agora vem de `site_config.regras` (o arquivo de config é só o padrão).
- `U` ganha `"hallPublico": "auto"|"manual"|"nao"` e `"codigoConvite": "ABCD2345"` (contas antigas ganham o código na
  primeira leitura).
- Erros novos: `403 suspenso` (entrar, redefinir e qualquer rota logada; a mensagem traz a data e o motivo),
  `403 cadastro_fechado` (`cadastro_aberto = false`; entrar continua), `400 apelido_proibido`, `400 hall_invalido`.
- Apelido: além do formato antigo, só letras do alfabeto latino (com acento): letra de outro alfabeto que parece
  latina ("а" cirílico) passaria pelo filtro. O admin (`renomear`) pode usar nome reservado, mas não palavrão.
- `perfil` com `hallPublico: "manual"` vindo de outro modo e nenhuma carreira marcada: marca as 3 que já estavam no
  Hall (nada some sem o jogador pedir). `"nao"` tira as carreiras da conta da fotografia na hora.
- Suspensão com `suspenso_ate` vencido conta como ativa (o `entrar` limpa o status).
- `cadastrar` com `convite` de código que não existe: o cadastro segue normal, sem indicação.
- `partidas` (n ≥ 1): acerta `usuarios.partidas_conta` pelos eventos ligados à conta depois do cadastro e confere a
  indicação pendente (§8.6).
- `excluir` (e `admin excluir_usuario`) apagam também conquistas, bônus, indicações feitas, denúncias feitas e o lugar
  no Hall; a indicação recebida fica com `indicado_id = NULL` (o bônus do amigo continua dele).

### 8.3 Carreiras (`carreiras.php`)

- `C` ganha `"publica": bool` (escolha manual), `"noHall": bool` (entra no Hall público nas regras de agora: modo da
  conta, as 3 melhores ou as marcadas, visível, nota da versão atual) e `"bonusOvr": n`.
- `GET` (lista) ganha `"hallPublico": "auto"|"manual"|"nao"` e `"hallMax": 3`.
- `publicar` → `200 {"carreira": C, "hallPublico": "manual"}`; carreira de outra conta ou inexistente: `404`; `sim`
  que não é booleano: `400 dados`; 60 por conta a cada 10 min. Vindo de `auto`, a conta passa a `manual` já com as 3
  que o automático mostrava; vindo de `nao`, passa a `manual` só com esta (com `sim: false` em `nao`, nada muda). O
  limite de 3 é conferido depois disso: `409 limite_hall` desfaz tudo (o modo não muda).
- Plausibilidade: `suspeita` guarda os motivos separados por vírgula (`temporadas`, `pico`, `nota`, `gols`, `bolas`,
  `titulos`, `idade`, `bonus`, `nome`). `bonus` = `career.bonusOvr > 0` sem um bônus usado nesta carreira com o mesmo
  valor (`bonus.php usar`); `nome` = nome do jogador com palavrão/ofensa. É conferida quando a carreira entra ou quando
  os números dela mudam; salvar de novo com os mesmos números mantém a decisão anterior (inclusive a liberação do
  admin). **Decisão:** `legacy.v` diferente de `2` não vira suspeita (não é trapaça, é carreira antiga): ela só fica
  fora do Hall pela coluna `nota_v` até o jogo reenviar com a nota recalculada.
- `apagar` tira a carreira do Hall na hora e apaga as denúncias dela.

### 8.4 Hall público (`hall.php`)

- Lista: `GET hall.php?pais=&clube=&pagina=` → `{"atualizadoEm", "proximaEm", "total", "pagina", "porPagina": 50,
  "filtro": {"pais": "BOL"|null, "clube": "e1234"|null}, "itens": [item…]}`. `item` = o do §4 mais `"posicaoGeral"`:
  **`posicao` é a posição dentro do filtro** (1 = a melhor da Bolívia), `posicaoGeral` a do Hall inteiro. `pais`: 2 a 4
  letras (maiúsculo); `clube`: `[A-Za-z0-9_-]{1,16}`; fora disso `400 filtro`. Os dois filtros juntos valem (lendas da
  Bolívia que passaram pelo Cruzeiro). `atualizadoEm`/`proximaEm` = `null` antes da primeira fotografia.
- `GET hall.php?id=` → `{"carreira": HallEntry, "apelido", "posicao"}` (`posicao` = geral). Só se ela está na
  fotografia **e** continua visível agora (carreira não oculta/suspeita, conta ativa e sem "não aparecer"); senão `404`.
- Respostas `200` com `Cache-Control: public, max-age=300`; erros com `no-store`.
- Ordem do Hall (dentro da conta e no geral): nota, pico de OVR, Bolas de Ouro, títulos, gols, a salva primeiro. Cada
  `HallEntry.id` aparece uma vez só (se duas contas salvarem o mesmo id, fica a de melhor posição).
- Entram só carreiras do **Clássico** enquanto `imersivo_publico = false` (as de teste do admin no Imersivo não vazam).
- Fotografia: o primeiro pedido depois de `hall_intervalo_min` **responde com a fotografia anterior e refaz logo depois
  da resposta** (no LiteSpeed/FPM o visitante não espera; a primeira fotografia de todas é feita antes de responder),
  com `GET_LOCK('lenda_hall:<banco>', 0)` (o nome do banco vai junto porque o servidor de banco é dividido) para só um
  refazer; a leitura das carreiras é sem trava de linha (quem salva não espera) e a troca é numa transação (quem lê vê a
  anterior até o fim). Estado em `site_config._hall_foto`
  (`{em, total, ms, msLeitura, por}`). **Tirar do Hall é na hora** (ocultar, apagar, suspender, denúncias, "não
  aparecer", tirar a publicação, carreira que virou suspeita, excluir conta); **entrar é na próxima fotografia** (ou
  no "Atualizar Hall agora").
- `POST denunciar`: logado; `id` = `HallEntry.id` que está na fotografia (senão `404`); `motivo` fora da lista: `400
  motivo`; a própria carreira: `400 propria`; repetir na mesma carreira: `200 {"ok":true}` sem contar de novo; 10 por
  conta por dia (`429`). Com 5 denúncias **abertas** de contas diferentes, `carreiras.oculta = 2` (escondida pelas
  denúncias; `1` = pelo admin) e sai do Hall. As denúncias da mesma carreira entram uma de cada vez (trava da linha da
  carreira): 5 ao mesmo tempo também escondem. Quem já denunciou uma carreira não denuncia de novo, nem depois de o
  admin resolver.

### 8.5 Conquistas (`conquistas.php`)

- `sincronizar` → `{"conquistas":[{id, em}]}` (a união, a mais antiga primeiro). `conquistas` que não é lista: `400
  dados`; mais de 500: `400 dados`; id fora do formato: ignorado (as outras entram); `em` ruim, sem `em` ou no futuro:
  agora; antes de 2025-01-01: 2025-01-01. No máximo 500 conquistas por conta; 60 envios por conta a cada 10 min.
- `?raridade=1` → `{"jogadores", "porConquista": {id: n}, "atualizadoEm"}`. `jogadores` = contas ativas com pelo menos
  uma conquista. Ids com palavrão ficam fora (a resposta é pública). Calculada no máximo 1 vez por hora (estado em
  `site_config._raridade`, com trava); `Cache-Control: public, max-age=3600`.

### 8.6 Indicações e bônus (`bonus.php`)

- `usuarios.partidas_conta` (coluna nova): partidas terminadas com a conta ligada (o `e.php` soma cada `jogo_fim` do
  Clássico/Imersivo e cada `partida_fim` gravados com o cookie; o `conta.php partidas` acerta pelo maior entre isso e
  os eventos). `liberado` = `partidas_conta >= liberaAposPartidas`.
- Indicação: no cadastro com código válido nasce `pendente`, ou `recusada` com `motivo` `propria_conta`,
  `mesmo_aparelho` (o `vid` do cadastro tem visita ou vínculo com o indicador), `suspenso` ou `limite` (o indicador já
  tem `maxIndicacoes` válidas). Vale no primeiro `jogo_fim` do Clássico do indicado (ou no `conta.php partidas` que
  achar um nos eventos); se o aparelho dessa partida é do indicador: `recusada mesmo_aparelho`.
- Ao validar, o bônus do indicador é criado na hora (`origem 'indicacao'`, `ref 'indicacao:<id>'`, valor
  `indicacao[k]`, k = válidas antes desta); ele só fica **disponível** quando o indicador estiver liberado (até lá
  aparece em `guardados`). Bônus do admin valem sempre.
- `GET bonus.php` → `{"liberado", "faltamPartidas", "disponiveis":[{id, valor, origem, criadoEm}], "guardados":[…],
  "usados": n, "indicacoes": {"validas", "pendentes", "limite", "proximoValor"}, "compartilharHoje": bool,
  "compartilharValor": 2, "codigoConvite", "linkConvite"}`. **`compartilharHoje` = ainda dá para ganhar o bônus de
  compartilhar hoje** (liberado e ainda não ganhou hoje). `proximoValor` = 0 no limite.
- `usar` → `{"valor": n, "origem": "indicacao"|"compartilhar"|"admin"}` ou `{"valor": 0}`. Sem bônus, nada fica
  guardado (chamar de novo depois de ganhar um bônus usa o novo). `carreiraId` inválido: `400 id`. 60 por conta a cada
  10 min (junto com `compartilhei`).
- `compartilhei` → `{"ganhou": n}` ou `{"ganhou": 0, "motivo": "ja_hoje"|"bloqueado"}` (`bloqueado` também com
  `compartilhar = 0`). O dia é o de Brasília (`ref 'dia:YYYY-MM-DD'`).
- O jogo deve gravar `career.bonusOvr` com o valor que o `usar` respondeu: a carreira salva com `bonusOvr` sem o bônus
  usado nela fica `suspeita: bonus` (fora do Hall).

### 8.7 Admin (`admin.php`)

Sem admin: `401 nao_logado` em tudo. POST: JSON sempre; com o cookie, `Origin` do site (CSRF); com o Bearer, sem
`Origin`. Corpo até 64 KB. Paginado = `{"total", "pagina", "porPagina": 50, "itens"}`. Toda escrita grava
`admin_log` (`detalhes` em JSON com `via`: `painel`|`token`); `excluir_usuario` grava só o id (LGPD).

| rota | resposta |
|---|---|
| `GET ?r=resumo` (extra) | `{usuarios:{total, ativos, suspensos, novosHoje, novos7Dias}, carreiras:{total, noHall, suspeitas, ocultas, ocultasPorDenuncia}, denunciasAbertas, indicacoes:{pendentes, validas, recusadas}, bonus:{naoUsados, usados}, hall:{atualizadoEm, proximaEm, total, ms}, site}` |
| `GET ?r=usuarios` | paginado; `ordem` também aceita `acesso`; `q` busca apelido, e-mail, id (número) e código de convite; `status` = `ativo`\|`suspenso`. Itens como no §2 (`bonusDisponiveis` = os que dá para usar agora) |
| `GET ?r=usuario&id=` | `{"usuario": U + {status, suspensoAte, motivo, partidasConta, bonusLiberado, carreiras:[C + {pk, oculta, suspeita, copas}], conquistas:[{id, em}], indicacoes:{feitas:[{id, indicado:{id, apelido}\|null, status, motivo, criadaEm, validadaEm}], recebida:{id, indicador:{id, apelido}, status, motivo, criadaEm, validadaEm}\|null}, bonus:[{id, valor, origem, ref, criadoEm, usadoEm, carreiraId, disponivel}], sessoes:[{criadaEm, expiraEm, renovadaEm}], visitas:[{inicio, tempoS, origem, aparelho, bot}], eventos:[{em, tipo, modo, dados}], denuncias:{feitas, recebidas}}}`; `404 nao_encontrado` |
| `GET ?r=hall&filtro=publicas\|ocultas\|suspeitas\|denunciadas\|todas&q=&pagina=` | paginado + `filtro`, `atualizadoEm`; item = `{id (carreiras.id), carreiraId, usuario:{id, apelido, status}, modo, jogador, numero, pais, posicao, nota, notaV, picoOvr, temporadas, gols, titulos, bolasOuro, copas, bonusOvr, headline, como, publica, oculta: 0\|1\|2, suspeita: "motivos"\|null, denuncias (abertas), posicaoHall\|null, salvaEm, terminouEm}`. `q` busca jogador, apelido ou HallEntry.id |
| `GET ?r=carreira&id=<carreiras.id>` (extra) | `{"meta": item do ?r=hall, "denuncias": [{id, motivo, texto, criadaEm, status, denunciante:{id, apelido}}], "carreira": HallEntry}` (abrir qualquer carreira, mesmo oculta/suspeita) |
| `GET ?r=denuncias&status=abertas\|todas&pagina=` | paginado; item = `{id, motivo, texto, criadaEm, status: aberta\|ok\|ocultar, resolvidaEm, denunciante:{id, apelido}, carreira:{id, carreiraId, jogador, nota, oculta, suspeita, dono:{id, apelido}}\|null, abertasNaCarreira}` |
| `GET ?r=config` | `{"valores": {chave: valor em vigor}, "padroes": {...}, "atualizados": {chave: {em, por}}}` |
| `GET ?r=indicacoes&status=&pagina=` | paginado; item = `{id, indicador:{id, apelido}, indicado:{id, apelido}\|null, status, motivo, criadaEm, validadaEm, bonus:{valor, usado}\|null}` |
| `GET ?r=conquistas` | `{"jogadores", "itens": [{id, jogadores, pct, primeiraEm}]}` (da mais comum à mais rara) |
| `GET ?r=log&acao=&alvo=&pagina=` | paginado; item = `{id, em, acao, alvo, detalhes}`; `alvo` = `usuario:12`, `carreira:55`, `indicacao:3`, `config`, `hall`, `usuarios` |
| `GET ?r=exportar&tipo=usuarios` | CSV `;` com BOM, `text/csv`, `attachment; filename="lenda-usuarios-AAAA-MM-DD.csv"`; datas em Brasília (`AAAA-MM-DD HH:MM`); célula de texto entre aspas e, se começa com `= + - @` (ou tab/CR), com `'` na frente |
| `POST suspender {id, motivo?, dias?}` | `{ok, sessoesEncerradas, status, suspensoAte, motivo}`; `dias` 1–3650 (`400 dias`) |
| `POST reativar {id}` | `{ok, status, suspensoAte, motivo}` (volta ao Hall na próxima fotografia) |
| `POST deslogar {id}` | `{ok, sessoesEncerradas}` |
| `POST renomear {id, apelido}` | `{ok, apelido}`; atualiza a fotografia na hora |
| `POST excluir_usuario {id}` | `{ok}` |
| `POST dar_bonus {id, valor 1–5, motivo}` | `{ok, bonusId}`; `motivo` (até 100) obrigatório e guardado em `bonus.ref`; `400 valor`/`400 motivo` |
| `POST tirar_bonus {bonusId}` | `{ok}`; já usado: `409 usado`; de indicação: a indicação vira `recusada` (`motivo 'admin'`) |
| `POST recusar_indicacao {id}` (extra) | `{ok, bonusTirado}`: recusa e tira o bônus dela se ainda não foi usado |
| `POST ocultar_carreira {id}` | `oculta = 1`, fecha as denúncias abertas como `ocultar`, sai do Hall na hora → `{ok, denunciasFechadas}` |
| `POST mostrar_carreira {id}` | `oculta = 0` **e `suspeita = NULL` (liberar)**, fecha as denúncias abertas como `ok`; volta na próxima fotografia |
| `POST apagar_carreira {id}` | apaga a carreira e as denúncias dela |
| `POST atualizar_hall` | `{ok, hall: {em, total, ms, msLeitura, por, proximaEm}}`; outro refazendo: `409 ocupado` (espera até 10 s) |
| `POST resolver_denuncia {id, resultado}` | fecha todas as abertas da carreira com o resultado; `ok` devolve ao Hall a que as denúncias esconderam (`oculta 2 → 0`); `ocultar` → `oculta = 1` |
| `POST config {valores}` | valida tudo antes de gravar: `400 config_invalida` com `"chave"` e a mensagem; grava numa transação → `{ok, valores}` |

Faixas da config: `regras.aposPartidas`/`lembrarACada` 1–100; `bonus.indicacao` lista de 1–10 valores 0–10,
`compartilhar` 0–10, `liberaAposPartidas` 0–50, `maxIndicacoes` 0–10; `hall_intervalo_min` 60–180; `aviso` = `null`
ou `{texto 1–200, tipo info|alerta}`; os outros, booleanos. **Decisão:** `manutencao` é só para o jogo mostrar a tela;
o servidor não bloqueia nada (uma carreira terminando nessa hora continua sendo salva).

### 8.8 `painel.php?so=eu`

`200 {"admin":true}` ou `401 nao_logado`, sem tocar no banco (só confere o cookie/Bearer).

### 8.9 Tabelas (o que o `_schema.sql` tem a mais que o §1–§6)

`usuarios.partidas_conta`; índices `uq_usuarios_convite`, `ix_usuarios_status`; `carreiras.oculta` vai de 0 a 2;
índices `ix_carreiras_usuario_nota`, `ix_carreiras_suspeita`, `ix_carreiras_oculta`; `hall_foto(id = posição geral,
carreira_pk, carreira_id UNIQUE, usuario_id, apelido, jogador, numero, pais, posicao_campo, nota, pico_ovr, temporadas,
gols, titulos, bolas_ouro, copas, headline, clubes, bonus_ovr, terminou_em)`, `hall_foto_clubes PK(club_id, foto_id)`;
`denuncias(id, carreira_pk, usuario_id, motivo, texto, criada_em, status 'aberta'|'ok'|'ocultar', resolvida_em,
UNIQUE(carreira_pk, usuario_id))`; `site_config.valor` é `MEDIUMTEXT`; `indicacoes.indicado_id` aceita `NULL`.

## 9. Jogo (cliente): o que foi implementado e as decisões dos pontos em aberto

Tudo só no build do site (`VITE_SITE=1`, `src/site/*` por import dinâmico); o build local e o do claude.ai ficam como
antes (tudo aberto, sem servidor). Nenhum nome de rota ou campo dos §1–§8 mudou.

### 9.1 Público × admin

- Padrão **fechado**: até o `GET conta.php` responder (ou se ele falhar), Live e Imersivo valem como "só admin".
- `GET painel.php?so=eu` só é pedido quando faz diferença — rota fechada aberta (`#/live`, `#/imersivo`,
  `#/identidade?modo=imersivo`, `#/kit`), site em manutenção, ou este navegador já foi confirmado como admin antes
  (`localStorage['lenda:admin']`, só uma dica para perguntar; quem decide é o servidor). Um "não" é perguntado de
  novo no máximo a cada 30 s. Com muita gente jogando, o público não soma um pedido por visita.
- Público: Live some do menu, da tela inicial e do rodapé; `#/live` e `#/kit` mostram "Página não encontrada";
  o Imersivo aparece "Em desenvolvimento" (cartão desabilitado, sem link) e `#/imersivo`/`?modo=imersivo` mostram a
  tela "Em breve"; `?fixture=` (estados de exemplo) não carrega. Admin: tudo abre, com o selo "Teste · só admin"
  (nunca no palco da live nem com a live ligada, que vão para a transmissão) e o menu ganha "Painel do admin" e
  "Modo Imersivo (teste)". Um modo live que tinha ficado ligado na aba de quem não é admin é desligado.
- `aviso`: faixa no topo (fecha no X; o mesmo texto não volta neste aparelho; nunca na live). `manutencao`: tela
  "Em manutenção" sem a barra do topo, para quem não é admin (o servidor não bloqueia nada — §8.7).
  `cadastroAberto = false`: some a aba "Criar conta" e o convite das 5 partidas não abre.

### 9.2 Hall público no Hall das Lendas

- Filtros na URL (link compartilhável): `#/hall?pais=BOL&clube=e2022&seg=comunidade` (`seg`: todos · runs · lendas ·
  comunidade). País = `<select>` das seleções; clube = busca com escudo (sem acento; clubes das lendas primeiro). O
  filtro vale para as 50 lendas (`nationality`, `clubs[].clubId`), para as carreiras do aparelho (identidade e todos
  os clubes das temporadas) e para a comunidade (o servidor filtra; o jogo confere de novo).
- Ranking geral: as carreiras da comunidade entram pela nota (empate: Bolas de Ouro → Copas → títulos → gols; tudo
  igual, as do aparelho e as lendas na frente), com o selo "Comunidade", o apelido do dono e "+N de bônus". Uma
  carreira que também está no Hall deste aparelho aparece uma vez só (como a daqui). Segmento "Comunidade": as
  páginas de 50 sob demanda ("Carregar mais"), com a posição dentro do filtro.
- Cache em memória por filtro: 5 min e nunca depois de `proximaEm`; um pedido por filtro de cada vez; reintento
  (1 s, 2 s, ±25%) só em falha de rede/5xx; sem rede, o Hall segue com as lendas e as carreiras do aparelho e
  tenta de novo quando a internet volta. Os pedidos de lista e de `?id=` usam o cache do navegador (`max-age=300`).
- Abrir uma da comunidade: `#/resumo?id=<HallEntry.id>&de=comunidade` (GET `hall.php?id=`), com "Carreira de
  <apelido>", "Denunciar" (logado; sem conta abre o "Entrar") e sem "Salvar na conta"/bônus de compartilhar. A
  carreira fica só na memória (no máximo 12 abertas) e nunca entra no Hall do aparelho.
- "Minhas carreiras" → "Na conta": painel "Hall público" com o modo (As 3 melhores · Eu escolho · Nenhuma →
  `perfil hallPublico`), o aviso do que fica público (apelido, nome do jogador, números) e, por carreira, "No Hall
  público" (`C.noHall`) e "Pôr no Hall"/"Tirar do Hall" (`publicar`). Mais de 3: aviso antes de pedir.

### 9.3 Conquistas na conta

- Entrar/criar conta: todas as do aparelho vão em `sincronizar` (pedaços de 500) e a união desce. Abrir o jogo já
  logado: `GET conquistas.php` no máximo a cada 10 min por aparelho (`localStorage['lenda:conquistas-lidas']`), e só
  sobe o que faltar lá. Sempre depois de o jogo ler o IndexedDB (senão "as do aparelho" estariam vazias).
- Conquista nova, com conta: fila em `localStorage['lenda:conquistas-fila']` (`{uid, itens}` — de uma conta só),
  envio 3 s depois (junta várias), reintento com espera crescente (até 6 vezes, teto 2 min), ao voltar a internet e
  ao esconder a aba. As que descem entram sem "nova" e sem toast, com `context: "Da sua conta"`.
- Raridade: `?raridade=1` ao abrir a tela de conquistas (cache 1 h); "12% dos jogadores" só com 5+ jogadores.

### 9.4 Convite, compartilhar e bônus de OVR

- `?c=`: o primeiro código válido (4–16 letras/números) fica 30 dias em `localStorage['lenda:convite']` (outro link
  não troca), sai da barra de endereço e vai no `cadastrar`; depois do cadastro é apagado.
- "Minha conta" → "Convide amigos": link (Compartilhar com `navigator.share` / Copiar), degraus +2/+3/+5 (ganho ·
  jogando a 1ª · livre), o que falta para liberar, `guardados` e `disponiveis`.
- Card final: o texto compartilhado leva o link com o código (`U.codigoConvite` ou `bonus.php`). Só carreira
  encerrada **do próprio jogador**: depois que o `navigator.share` resolve (ou do "Copiar link"), `compartilhei` →
  "+2 de OVR na próxima carreira!", "o de hoje já é seu" ou "ainda bloqueado: faltam N partidas". Sem rede, fica em
  `localStorage['lenda:compartilhei-pendente']` (12 h) e vai quando a internet voltar ou ao entrar.
- Criação da carreira do Clássico: com conta e bônus disponível, "Bônus de OVR: +N (origem)" com "usar" ligado.
  Ao começar: semente nova → `usar {carreiraId: "career-<semente>"}` (o mesmo id do HallEntry; reintento 3x, é
  idempotente) → `newCareer(…, { bonusOvr })`. Sem rede: a carreira começa sem bônus (ele continua guardado).
- Motor: `CareerState.bonusOvr` (1–10; ausente = 0), OVR inicial `50 + N` e o mesmo desenvolvimento — o jogador fica
  N acima a carreira inteira (papel, propostas, convocação e prêmios leem esse OVR). Sem bônus a carreira é idêntica
  à de antes. Resumo, card e Hall mostram "+N de bônus".

### 9.5 Salvar carreira (mais robusto, mesmas regras)

Pico ≥ 90 continua salvando sozinho (`auto`) e as outras pelo botão (`manual`). O salvar sozinho tenta 3 vezes com
espera crescente; o que não subiu (sem rede) fica na fila do aparelho — `lenda:carreiras-pendentes` (auto) e
`lenda:carreiras-pendentes-manual` (botão) — e sobe sozinho ao abrir o jogo e quando a internet volta.
