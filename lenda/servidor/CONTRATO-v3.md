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
  `HallEntry.id` aparece uma vez só (se duas contas salvarem o mesmo id, fica a primeira que foi salva — ver §12.1).
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

## 10. Painel (front): o que foi implementado

Nenhuma rota ou campo dos §1–§9 mudou; o painel só lê e escreve o que está no §8.7 (e o `painel.php` de antes).

### 10.1 Arquivos (`painel/`, sobem juntos — o `build:site` já copia a pasta inteira)

`index.html` (CSP `default-src 'self'`, nada embutido), `painel.css`, `nucleo.js` (formatação, rede, avisos,
diálogos, listas), `visao.js`, `usuarios.js`, `moderacao.js`, `sistema.js`, `painel.js` (senha, abas, atalhos) e
`nomes.json` (nomes de clubes, países, troféus, prêmios e conquistas tirados dos dados do jogo, só para exibir;
faltando ou desatualizado, o painel mostra o id). Todo dado do servidor entra por `textContent`/`createElement`.

### 10.2 Endereços e atualização

`#/visao`, `#/usuarios?q=&status=&ordem=&pagina=`, `#/usuario/<id>`, `#/hall?filtro=&q=&pagina=`,
`#/denuncias?status=&pagina=`, `#/conquistas`, `#/indicacoes?status=&pagina=`, `#/config`, `#/testes`,
`#/registro?acao=&alvo=&pagina=` (link compartilhável; voltar do navegador funciona). Ao abrir: `painel.php?so=eu`
decide entre a senha e o painel; um `401` em qualquer pedido volta para a senha e, depois de entrar, para a mesma
aba. `?so=agora` a cada 15 s (aba visível), `admin.php?r=resumo` a cada 60 s e depois de cada ação (contadores da
lateral, estado do site), `painel.php` completo a cada 5 min na Visão geral. Resposta `200` que não é JSON conta
como erro (a página de erro da hospedagem nunca vira "lista vazia").

### 10.3 Decisões

- **Abrir a carreira no jogo**: só para as que estão na fotografia (`posicaoHall`/`noHall`), em outra aba, em
  `../#/resumo?id=<HallEntry.id>&de=comunidade` — o jogo só abre carreira de outro jogador pelo `hall.php?id`. Oculta,
  suspeita ou fora do Hall: o detalhe abre no próprio painel (`r=carreira`: números, clubes, troféus, prêmios,
  denúncias, "Baixar JSON").
- **`bonus.liberaAposPartidas`**: o painel aceita só **3 a 5** (o combinado com o dono); o servidor continua 0–50
  (o Bearer pode usar outro valor). Valor salvo fora da faixa aparece marcado e só precisa ser corrigido para salvar
  mudanças nos bônus. `bonus.indicacao`: um campo por amigo até `maxIndicacoes` (mudar o máximo aumenta ou encurta a
  lista; o novo repete o último valor).
- **Salvar configurações**: manda só as chaves alteradas, sempre com confirmação (lista "de → para"); ligar a
  manutenção, fechar o cadastro ou abrir o Imersivo/a Live a todos vêm com aviso de perigo. Sair da aba com
  alteração não salva pergunta antes. Depois de salvar, desenha com os `valores` que o servidor devolveu.
- **Confirmações**: toda ação de escrita abre um diálogo; erro do servidor aparece dentro dele (que continua aberto
  para corrigir). Excluir conta pede digitar o apelido; apagar carreira pede digitar `APAGAR`.
- **Denúncias**: agrupadas por carreira na página; "Manter no Hall"/"Ocultar" chamam `resolver_denuncia` com uma
  aberta (o servidor fecha todas as abertas da carreira).
- **Exportar CSV**: confere a sessão (`?so=eu`) antes de baixar `r=exportar`, para não salvar a mensagem de erro
  como planilha.
- **Conquistas**: a lista é o catálogo do jogo (`nomes.json`) somado aos ids que vieram do servidor (fora do
  catálogo aparece com o id), ordenável por nome, raridade no jogo, jogadores e primeira vez.
- **Testes** (só o admin): links em outra aba para `#/identidade?modo=imersivo`, `#/imersivo`, `#/live`, `#/kit` e
  `#/hall?seg=comunidade`; o jogo libera porque o navegador tem o cookie do painel (`Path=/lenda/`).

## 11. Integração de ponta a ponta: o que foi conferido junto e o que mudou

Nenhuma rota, ação ou campo dos §1–§10 mudou. Pilha local igual à da Hostinger (MariaDB + `php -S` servindo um
`public_html` com o `dist-site` em `lenda/` e a config fora dele, onde o `_lib.php` procura), com vários aparelhos ao
mesmo tempo no navegador (visitante, dono da conta em dois aparelhos, amigo convidado, admin no painel) e uma carga
de jogadores simulados.

### 11.1 Partida terminada chega logo ao servidor (correção no jogo)

- **Problema encontrado:** o `jogo_fim` ia na fila da medição, que sai a cada 10 s. A partida que abre o convite de
  conta (a 5ª) chegava ao `e.php` já com o cookie da conta recém-criada e contava em `partidas_conta` — o bônus de
  indicar/compartilhar liberava uma partida antes das `liberaAposPartidas` "desde o cadastro" (§6). E, com o envio
  atrasado, a tela de criação da próxima carreira podia perguntar ao `bonus.php` antes de o servidor saber da partida
  (o bônus recém-liberado só aparecia uma carreira depois).
- **Decisão (só no jogo: `src/site/medicao.ts`, `conta.ts`, `vigias.ts`, `pontes.ts`):** `jogo_fim` e `partida_fim`
  saem da fila em ~250 ms (`ENVIAR_JA`); antes de `cadastrar`, `entrar` e `redefinir`, o jogo manda o que está na fila
  e espera (no máximo 1,5 s, `enviarAgora`), então a partida de antes do cadastro vai como do visitante; ao terminar uma
  partida com conta, os dados do `bonus.php` em memória vencem, e a tela de criação da carreira do Clássico sempre
  pergunta ao `bonus.php` (um `GET` por carreira nova, só com conta): o bônus que acabou de chegar — amigo que jogou,
  presente do admin, partida que liberou — já aparece, sem esperar o cache de 1 min. O valor que vale continua sendo o
  que o `usar` devolve. O servidor continua igual: `partidas_conta` soma o que o `e.php` recebe com o cookie.
- **Texto** (`src/site/MinhasCarreiras.tsx`): "Tirar do Hall" e "Nenhuma" diziam que a carreira some "na próxima
  atualização, em até 3 h", mas sair do Hall é na hora no servidor (§8.4). Agora: "Sai do Hall da comunidade em poucos
  minutos" (o navegador de quem já abriu o Hall guarda a página por até 5 min). Entrar continua "na próxima atualização".

### 11.2 O que foi conferido de ponta a ponta (`servidor/teste/integracao/`)

- `subir.sh` monta a pilha (banco próprio, segredos aleatórios fora do repositório, `cookie_seguro=false`,
  `email_modo=arquivo`; `ip_cabecalho = HTTP_X_FORWARDED_FOR` aceito só de `127.0.0.1`, para a carga simular jogadores
  em IPs diferentes — na Hostinger o `REMOTE_ADDR` já é o IP real e isso fica vazio).
- `e2e.mjs` (Playwright, 6 aparelhos ao mesmo tempo, carreiras jogadas pela tela com sementes fixas): público sem Live
  nem Imersivo; 5ª partida → convite → conta; salvar pelo botão e sozinha (pico ≥ 90); conquistas subindo e descendo
  noutro aparelho; convite `?c=` → amigo cadastra e joga 1 partida → indicação válida → bônus guardado até a 3ª partida
  do dono → `+2` na carreira nova (OVR 52, 1ª temporada exatamente 2 acima da mesma semente sem bônus, salva sem
  suspeita); compartilhar bloqueado antes, `+2` depois, 1× por dia; Hall público (auto → "Eu escolho", troca, 4ª →
  `409 limite_hall`), "Atualizar Hall agora" no painel, filtro Bolívia/Cruzeiro pela URL e pela tela, resumo completo
  da comunidade, denúncia; no painel: visão geral, usuários, suspender (sai das sessões e do Hall na hora; entrar
  mostra "suspensa"), reativar, renomear (o Hall muda na hora), dar bônus (aparece na criação da carreira), ocultar,
  resolver denúncia, configurações (aviso no jogo; Imersivo aberto ao público e fechado de novo), Testes (Imersivo e
  Live em outra aba, com o selo de admin), CSV e Registro; sem erro de console, sem 5xx, log do PHP vazio.
- `hall-prazo.mjs`: fotografia vencida (61 min) → o 1º pedido recebe a anterior na hora e a nova entra logo depois;
  `hall_intervalo_min` 180 → próxima em 3 h; 30 → `400 config_invalida`.
- `carga.mjs`: 50 jogadores ao mesmo tempo (medição, cadastro, partidas, 2 carreiras cada, conquistas, bônus,
  compartilhar, Hall com filtros, raridade) e o admin refazendo o Hall no meio: nenhum 5xx, nenhum erro, todos os
  bônus e carreiras no banco.

### 11.3 Limites e moderação: o que mudou e o que fica para o dono decidir

- **Teto de cadastros do site inteiro** (`cadastrar-todos`, 200 a cada 10 min, `conta.php`). **Corrigido no servidor
  (sem mudar o número do contrato):** ele contava todo pedido de `cadastrar`, inclusive os inválidos — 210 pedidos ruins
  de 7 IPs (30 cada, dentro do limite por IP) fechavam o cadastro de todo mundo por 10 min (conferido na pilha:
  `teste/integracao/teto-cadastro.mjs`). Agora o teto do site só conta o cadastro que passou na validação (apelido,
  e-mail, senha, aceite); o inválido continua contando no limite por IP (30). **Em aberto:** num pico de vídeo o teto
  ainda limita a ~1.200 contas/h, e cadastros válidos com e-mails inventados ainda o gastam; se o painel mostrar 429 em
  cadastro, subir o número (ex.: 1.000) é uma linha no `conta.php`. O `entrar` não tem teto do site (só por IP e por
  e-mail).
- **Denúncias**: 5 contas diferentes escondem uma carreira do Hall até o admin decidir (`oculta = 2`). Com contas
  recém-criadas isso é fácil de abusar contra o topo do Hall. Sugestão: só contar denúncias de contas com algumas
  partidas na conta (`partidas_conta`) — e o painel já mostra a fila para decidir rápido.
- **Medição e bônus vêm do jogo**: `jogo_fim`/`partida_fim` são eventos do cliente (como antes). Os bônus têm teto
  (+2/+3/+5 por amigo até 3, +2 por dia), a carreira com bônus precisa do `usar` casado e o Hall mostra o bônus.

## 12. Correções da revisão de segurança e robustez (v3.1)

Nenhum nome de rota, ação ou campo dos §1–§11 mudou; o que muda são regras (e alguns campos e tabelas a mais). Para
publicar: subir `api/` e `painel/` inteiros e rodar o `instalar.php` até `"faltam": 0` (ele cria as tabelas e colunas
novas e preenche o que falta). **Rode logo depois de subir**: até lá o `e.php` e o `carreiras.php` dão erro (usam as
colunas novas).

### 12.1 Hall público: a carreira é de quem salvou primeiro

- **Ataque:** o `hall.php?id` entrega o HallEntry inteiro; outra conta copiava, subia a nota e tomava o lugar (a regra
  "fica a de melhor posição" do §8.4 premiava a cópia).
- **Agora:** na fotografia e no `noHall` (`idsNoHall`), uma carreira só entra se nenhuma outra conta tem a mesma
  (`carreira_id`) gravada antes e visível — **fica a primeira que foi salva** (`ROW_NUMBER … ORDER BY id`), mesmo que
  o admin libere a cópia.
- No `salvar`, a carreira (mesmo `HallEntry.id` **ou o mesmo resumo** com outro id) que outra conta já tem vira
  `suspeita: copia` (fora do Hall até o admin liberar). Um aparelho dividido por duas contas cai na mesma fila (as 90+
  do aparelho sobem para as duas), o que não faz mal.
- `carreiras.resumo_hash` (coluna nova, `sha1` do `summary` em JSON) e os índices `ix_carreiras_carreira`
  (`carreira_id`) e `ix_carreiras_resumo`.

### 12.2 Plausibilidade (§8.3): faixas novas, textos e revisão

- `bolas` agora é Bolas de Ouro > temporadas − 1 (nunca na 1ª temporada); `copas` (novo) = Copas do Mundo >
  ⌈temporadas/4⌉ + 1; `nota` também quando nota ≥ 80 com pico < 85 (nas carreiras reais toda nota 77+ tem pico 91+).
- `nome` passa a valer para **todo texto que o resumo mostra da carreira de outra pessoa**: `identity.surname`,
  `career.identity.surname`, `summary.headline`, `summary.comparisons`, `retiredReason`, a fase dos torneios da seleção,
  os 3 primeiros da Bola de Ouro de cada ano (`career.world`) e os ids que aparecem como texto quando o jogo não os
  conhece (troféu, clube, competição). Também vira `nome` o nome do jogador com letra fora de A-Z, À-ÿ e Latim
  Estendido-A (`Ł`, `Ž`…), espaço, `' . -` (ex.: `ɑ`, `р` cirílico).
- `dados` (novo): `career.identity.surname`/`nationality` diferentes dos de `identity` (no jogo são o mesmo objeto).
- `revisao` (novo, só quando não há outro motivo): **nota ≥ 90** (config `hall_revisao_nota` no arquivo de config,
  padrão 90; 101 desliga). A carreira extraordinária entra no Hall depois do `mostrar_carreira` do admin ("Liberar").
  `GET admin.php?r=hall&filtro=revisao` (filtro novo, da maior nota para a menor) e `r=resumo` →
  `carreiras.emRevisao` e `carreiras.revisaoNota` (campos novos). No painel: aba "Esperando revisão".
- A suspeita é conferida quando a carreira entra ou quando **qualquer coisa nela muda** (antes: só os números). Salvar
  de novo exatamente a mesma carreira mantém a decisão anterior (inclusive a liberação do admin).
- `suspeita` guarda até 64 caracteres (os motivos separados por vírgula).
- Depois: portar para o PHP o cálculo da nota (`src/engine/legacy/score.ts`, que usa também `career.seasons` e
  `national`) e marcar `nota` quando a do cliente diferir em mais de 1.

### 12.3 Filtro de palavrões e apelido (§8.2)

- O texto é transliterado antes de comparar (`Transliterator 'Any-Latin; Latin-ASCII; Lower()'` do intl; sem ele,
  `Normalizer FORM_KC`): `ｐｕｔａ`, `ᴘᴜᴛᴀ`, `viadø`, `pıroca`, `kʀʟ` viram `puta`, `viado`, `piroca`, `krl`.
- Nomes reservados também com `l` no lugar de `I` (`ADMlN`, `Oflcial`).
- Apelido: NFC primeiro e depois só `A-Z a-z À-Ö Ø-ö ø-ÿ 0-9 _ . -` e espaço (antes `\p{Latin}`, que aceitava
  versalete, largura total e IPA). Nome com acento decomposto continua passando (é guardado composto).
- Todos os títulos "Lenda do / Ídolo da <clube>" dos ~1.000 clubes do jogo passam no filtro (teste no `rodar.sh`).

### 12.4 Moderação que sobrevive ao "apagar" (§8.3, §8.7)

- Tabela nova `carreiras_moderacao(usuario_id, carreira_id, resumo_hash, oculta, em)`, só com ids e o hash do resumo
  (LGPD). Gravada no `ocultar_carreira`, no `apagar_carreira` do admin (o aparelho do dono subiria de novo), no
  `resolver_denuncia ocultar` e quando as denúncias escondem (`oculta = 2`); apagada no `mostrar_carreira` e no
  `resolver_denuncia ok` de uma escondida pelas denúncias.
- No `salvar`, uma carreira que entra na conta com o mesmo `carreira_id` ou o mesmo `resumo_hash` de uma decisão
  guardada **nasce com aquele `oculta`**. O `apagar` do dono continua apagando a carreira de verdade (nada de exclusão
  lógica: seria guardar a carreira contra a vontade dele).
- O `excluir` da conta (e o `excluir_usuario`) apagam também essa tabela. O `instalar.php` grava a decisão das
  carreiras que já estavam ocultas.

### 12.5 Denúncias (§8.4)

- Para chegar a `oculta = 2`, contam só as denúncias abertas de contas **criadas há mais de 24 h e com
  `partidas_conta` ≥ 3**; as outras ficam na fila do painel.
- As **10 primeiras do Hall geral** nunca saem só pelas denúncias: elas sinalizam e quem oculta é o admin.
- `limitar('denunciar-ip', quemIp(), 5)` por janela de 10 min (cabe na promessa de "código do IP por até 20 min";
  nada de HMAC de IP guardado na denúncia).
- O teto do dia (`dia-denunciar`, 10) é conferido só depois de achar a carreira e ver que a denúncia não é repetida:
  repetir não gasta.

### 12.6 Partidas "com a conta" (§8.6) e os tetos do `e.php`

- **Ataque:** um POST com 3 `jogo_fim` liberava os bônus em 22 ms; 3 contas "amigas" com um `jogo_fim` cada davam
  +2/+3/+5; 100 `partida_fim` num pedido somavam 100.
- **Agora**, `usuarios.partidas_conta` só soma no `e.php` (na mesma transação que grava o evento) quando o `jogo_fim`
  do Clássico se junta ao **último `jogo_inicio` do mesmo aparelho (`vid`) e modo de pelo menos 20 s antes** (nos
  últimos 30 dias) e nenhum outro fim veio depois desse início (1 fim por início; um início perdido ou um fim inventado
  lá atrás não atrapalham as partidas seguintes); no máximo **1 partida por aparelho a cada 20 s** e 1 por envio. O
  Imersivo (`jogo_fim` e `partida_fim`, esta com um `jogo_inicio` do Imersivo nos últimos 180 dias) só conta com
  `imersivo_publico` ligado.
- O `conta.php partidas` **não acerta mais `partidas_conta` pelos eventos** (deixaria um `jogo_fim` inventado contar);
  ele só confere a indicação pendente.
- Indicação (§8.6): vale quando o indicado termina uma partida do Clássico **que conta**, num aparelho que não é do
  indicador, e já tem **≥ 180 s de jogo** (soma de `ativo_s`, que o servidor já limita ao tempo real). Sem os 3 min,
  fica pendente e é conferida de novo na próxima partida, no `conta.php partidas` e a cada minuto de jogo a mais numa
  sessão logada (um `SELECT` pela chave única, só no batimento que passa de um minuto). Sem comparação de IP (amigos
  na mesma Wi-Fi valem; a política só usa o código do IP por 20 min). Cadastro com convite e sem `vid`: a checagem de
  aparelho fica para a partida (o `vid` dela).
- **Tetos do `e.php`:** `jogo_inicio`, `jogo_fim`, `partida_fim`, `cadastro` e `login` ficam fora do teto por IP
  (1.500/10 min) e do teto de 3.000 por sessão — que ficam para `view`, `gate_*`, `compartilhar` e `logout` — e têm
  teto próprio de **20 por sessão a cada 10 min**. A 301ª sessão nova do IP em 10 min: em vez de 429, o envio que
  traz início/fim de partida entra (sem `ctx` e só com esses eventos); o resto continua 429.
- No jogo, `jogo_inicio` também sai da fila em ~250 ms (como os fins): o servidor só conta o fim que chega 20 s
  depois do início.

### 12.7 Tetos do site inteiro (§3, §11.3)

- `cadastrar-todos`: **1.500 a cada 10 min** (era 200; ~9.000 contas por hora num pico de vídeo) e, novo, 5 contas
  por aparelho (`vid`) a cada 10 min.
- `esqueci`: os tetos do site (40 a cada 10 min e 300 por dia, a cota de envio da hospedagem) só somam quando um
  e-mail **vai mesmo sair** (a conta existe e não há código recente). Estourado: `200 {"ok":true}` do mesmo jeito,
  sem mandar (não revela nada). O servidor anota em `site_config._esqueci_teto` (`{em, n}`) e o
  `GET admin.php?r=resumo` mostra em `emailsBarrados {total, ultimoEm}` (campo novo; no painel, o quadro "E-mails de
  senha segurados", que só aparece quando aconteceu). E-mail inventado não gasta a cota. O limite por e-mail por dia
  (5) continua antes de procurar a conta.
- Login do painel: o `painel-todos` (50 a cada 10 min) só soma **senha errada** e, estourado, bloqueia só os IPs que
  já erraram nesta janela (`painel-erro:<ip>`): o dono, de um IP limpo e com a senha certa, entra no meio de um ataque.
  O limite de 10 por IP continua. A senha do painel deve ser longa e aleatória.

### 12.8 Hall: sair é na hora, também no "Eu escolho" e no Imersivo (§8.4)

- `perfil` com qualquer `hallPublico`: as carreiras da conta que o modo novo não mostra saem da fotografia na hora
  (antes só no `nao`); as que entram, na próxima fotografia.
- `hall.php?id` e a limpeza da fotografia conferem também `hall_publico = 'manual'` → `publica = 1` e, com o Imersivo
  fechado, o modo da carreira.
- `config` com `imersivo_publico` de `true` para `false`: as carreiras do Imersivo saem da fotografia na hora e ela é
  refeita (`admin_log` → `"hall": "refeito"`).

### 12.9 Custo por pedido com muita gente (§8.2, painel)

- `GET conta.php`: `estatisticas.partidas = max(partidas, partidas_conta)` (antes contava os eventos da vida inteira
  da conta a cada abertura do jogo). Limite leve: 300 por conta a cada 10 min.
- `painel.php`: a resposta do período fica guardada por `painel_cache_s` (arquivo de config, padrão 90 s; 0 desliga)
  em `site_config._painel:<de>:<ate>:<bots>`, com trava (`lenda_painel`) para só um recalcular; o `agora` é sempre na
  hora; campo novo `geradoEm`. O funil "5 partidas" lê a tabela nova `partidas_vid(vid, n, atualizado_em)` (o `e.php`
  soma; o `instalar.php` preenche a partir dos eventos na primeira vez) em vez de agrupar a tabela `eventos` inteira; a
  nota do `jogo_fim` vai para a coluna nova `eventos.nota` (as linhas de antes continuam lidas do JSON).

### 12.10 LGPD: registro do admin

- No `excluirUsuario`, na mesma transação, as linhas do `admin_log` com alvo `usuario:<id>` e `carreira:<pk>` (das
  carreiras da conta) ficam só com `{"via", "excluido": true}`: continua registrado que a ação aconteceu e quando, sem
  apelido nem motivo escrito. A política de privacidade diz isso.

### 12.11 Jogo (cliente)

- **Carreira 90+ que não subiu ao entrar:** se o `GET carreiras.php` falhar logo depois de entrar/criar a conta
  (5xx, demora, sem rede), as 90+ do aparelho e a do botão vão para a fila (`lenda:carreiras-pendentes(-manual)`); no
  laço, uma falha de rede põe a atual e as que faltam na fila (um 409/413 não). A fila tenta de novo na mesma sessão
  com espera crescente (30 s, 1 min, 2 min… até 6 vezes; um 503 não dispara o evento `online`), ao voltar a internet e
  ao abrir o jogo já logado (o `aoEntrar('sessao')` agora chama o reenvio). O reenvio **não** sobe toda 90+ que falta
  na conta (ressuscitaria a apagada em outro aparelho): só as da fila.
- **Conta que não respondeu:** o `GET conta.php` que falha (por rede ou 5xx) num aparelho que já entrou tenta de novo
  sozinho (2 s, 4 s, 8 s… até 2 min, 6 vezes) e no `online`; quando responde, o `aoEntrar('sessao')` dispara o resto.
  Nessa espera, a 90+ que termina vai para a fila e uma conquista nova faz a próxima leitura da conta ser na hora (sem
  a espera de 10 min).
- **Bônus de OVR sem resposta:** o `usar` tenta 2 vezes de até 7 s (o botão mostra "Confirmando bônus…"). Sem
  resposta, a carreira **não** começa sozinha: "Não deu para confirmar o bônus" com "Tentar de novo" (o mesmo
  `career-<semente>`, idempotente) e "Começar sem bônus" (outra semente e o aviso de falar com o suporte se o bônus
  sumir). Num 401 (ou conta suspensa), a sessão sai e o aviso pede para entrar de novo (o bônus não foi gasto). O
  servidor não "devolve" bônus de carreira salva com `bonusOvr 0` (o valor vem do cliente: seria bônus infinito).
- **Manutenção:** o convite de conta das 5 partidas não abre por cima da tela "Em manutenção".
- **Hall da comunidade:** com a próxima atualização no passado (o servidor responde a fotografia anterior e refaz logo
  depois), mostra "atualizando agora" e busca o mesmo filtro de novo em 20–30 s com `cache: 'no-cache'` (no máximo 3
  vezes seguidas).
