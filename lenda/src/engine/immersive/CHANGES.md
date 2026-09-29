# Modo Imersivo — mudanças no contrato e notas para a UI

Motor: `src/engine/immersive/index.ts` exporta `immersiveEngine`, `createImmersiveEngine(world = worldEngine)`
(o parâmetro tem padrão, então `factory.length === 0`) e `default`. Todas as mudanças abaixo são
**aditivas** (campos/membros opcionais); nada do contrato original mudou de forma.

## 1. Contrato (`src/engine/immersive/types.ts`)

| Onde | Mudança | Uso |
|---|---|---|
| `CalendarItem.result` | `pens?: [n, n]`, `aet?: boolean`, `minutes?: number` | placar dos pênaltis, prorrogação, minutos jogados |
| `CalendarItem` | `month?: number` (1–12), `year?: number` | data aproximada da semana (ausente no bloco de torneios de fim de temporada do calendário brasileiro) |
| `CalendarItem` | `leg?: number`, `legs?: number` | ida/volta de mata-mata |
| `ImmersiveAction` | `{ type: 'auto'; until?: 'next_match' \| 'next_week' \| 'season_end' \| 'decision' \| 'retirement'; maxSteps?: number }` | "simular até…" (IA resolve treino, jogos, coletivas; para em decisões/novas propostas, exceto `retirement`) |
| `ImmersiveEngine` | `validActions?(state)`, `summarize?(data, state)` | ações aceitas agora; resumo no formato do Clássico |
| `ImmersiveState` | `leagueId?: string \| null`, `followers?: number` | liga atual do clube; seguidores nas redes |
| `LiveMatch` | `selectionReason?: string` | por que o técnico escalou/deixou no banco/fora ("No banco: o técnico quer dar minutos ao garoto da base", "Fora dos relacionados: suspenso"…) — mostrar no pré-jogo |
| `ImmersiveEffect` `moment_result` | `optionId?: string`, `penalty?: { shot, keeper }` (`'left' \| 'center' \| 'right'`) | opção efetivamente resolvida; no pênalti, canto da cobrança e do pulo do goleiro |
| `ImmersiveEngine` | `acceptChance?(data, state, offerId, counter)` → `{ accept, improve, walk, ceiling, roundsLeft } \| null` | chances da contraproposta (mesma conta do `counter()`); também exportada como `acceptChance(state, offerId, counter, data?)` e `counterOdds` |

`ImmersiveState.score`/`result.score` e `LiveMatch.score` são sempre **[mandante, visitante]**.
`state.potential` é uma **estimativa de olheiro** (o potencial real fica oculto em `state.engine`).
`state.seasonStats` = só **clube**; seleção vai para `state.national` (e para a `SeasonRecord.national`).

## 2. Mundo (`src/engine/api.ts`, `src/engine/types.ts`, `src/engine/world/**`)

- `UserSeasonContext.fixedResults?: Record<fixtureKey, FixedResult>` — o jogo é simulado normalmente
  (mesmo consumo do rng) e o placar é trocado pelo fixo; mata-mata usa pênaltis/prorrogação do fixo.
  `FixedResult = [h, a] | [h, a, pensH, pensA] | { score, pens?, aet? }`.
- `UserSeasonContext.collectUserFixtures?: true` → `SeasonWorldResult.userFixtures`,
  `userNationalFixtures` (agenda com chave, competição, fase, rodada, ida/volta, agregado anterior,
  prorrogação, força efetiva) e `userLeague` (todos os jogos da fase regular da liga do jogador,
  por rodada, + tabela real de partida na 1ª temporada).
- `UserSeasonContext.agendaOnly?: true` (com `collectUserFixtures`) — pré-simulação rápida (~10–20 ms):
  só a liga do jogador (+ divisões ligadas), as copas/estadual dele, continentais, Mundial/Intercontinental
  e torneios de seleções; pula entressafra/estatísticas/evolução e devolve o `world` de entrada. Agenda
  idêntica à da simulação completa (testado). Não consolidar esse resultado.
- Chave determinística: `competição|fase|mandante|visitante` (+`#n` se repetir).
- `UserSeasonContext.immersiveRules?: true` — regras de calendário do imersivo (o motor sempre manda):
  pontos corridos com mando alternado (método do círculo com inversão nas rodadas ímpares e folga na
  posição fixa; interzonais/extras escolhem o mando por quem vem de fora) → nenhum clube de nenhuma
  liga com mais de 3 jogos seguidos no mesmo mando (a maioria ≤ 2); Clausura = espelho do Apertura e
  cada torneio (com seus play-offs) num sub-stream próprio do rng — os resultados fixos do Apertura
  não redesenham o Clausura. Sem o campo, o Clássico fica idêntico.
- `UserAwardEntry.leagueGoals?` — gols do jogador na liga (o imersivo conta jogo a jogo) para artilharia/craque da liga.
- Sem esses campos o mundo é **idêntico** ao do Clássico (testado); fixar cada jogo no próprio placar
  previsto também deixa o mundo idêntico (o jogo de volta com placar fixo "ensaia" a prorrogação/pênaltis
  para consumir o rng igual). `strength.ts` não foi tocado.

## 3. Fluxo e ações válidas

`newCareer` devolve `pendingDecision` = **oferta de base** (`kind: 'academy'`, 3 clubes) e calendário vazio
(`nextItem` = null até a escolha — diferente do mock, que já nasce num clube).
`decision_choose` assina e monta a 1ª temporada (2026 começa na semana da data do snapshot, com o
campeonato em andamento).

| Situação | Ações aceitas |
|---|---|
| `pendingDecision` | `decision_choose` (+ `inbox_read`, `buy`, `social_post`, `offer_respond`) |
| `live.phase === 'pre'` | `match_start` (`accept: false` recusa o banco), `match_sim`/`advance` (dá o pontapé), `match_finish` (simula tudo) |
| `live` rolando, sem lance | `match_sim` / `advance` (até o próximo lance-chave, intervalo, prorrogação, pênalti do jogador ou fim), `match_sub_request` (em campo), `match_finish` |
| `live.pendingMoment` | `match_choose` (`minigame.side` em pênalti; `minigame.timing` 0–1, ideal ≈ 0,62), `match_timeout` (opção mais segura), `match_finish` |
| `live.phase === 'full_time'` | `match_finish` ou `advance` (fecha o jogo, grava o resultado no mundo) |
| `press` aberto | `press_answer` (uma pergunta por vez; ao zerar, conclui o item), `press_skip` (mídia −4) |
| item `training` | `train` ou `advance` (foco automático) |
| item `match`/`national_match` | `advance` ou `match_start` → cria `live` em `pre` com titular/banco/fora decidido |
| item `press` | `advance` abre as perguntas; `press_skip` |
| item `story` | a decisão aparece ao **chegar** no item (`pendingDecision`); semana calma = pulado sozinho |
| item `transfer_window` | propostas chegam ao **chegar**; `advance` fecha a janela (sem clube: assina a melhor) |
| item `national_callup` | convocação decidida ao **chegar** (amistosos/eliminatórias entram no calendário); `advance` |
| item `season_end` | `advance`: simula a temporada de verdade, SeasonRecord, prêmios, evolução → efeitos `trophy`, `season_end`, `achievement` |
| item `awards` | `advance`: efeitos `award` e abre a próxima temporada (ou aposenta aos 40) |
| sempre | `inbox_read`, `buy` (ids em `LIFESTYLE_ITEMS`), `social_post` (ids em `POST_TEMPLATES`, iguais aos da UI), `offer_respond` (fora de partida), `retire` (34+), `auto` |

Ação fora de hora ou com dados inválidos: o dispatch devolve **o mesmo objeto de estado** recebido
(`result.state === state`, nada muda, nem contadores internos — os sorteios futuros não mudam) + um
único `toast` de tom `danger` ("Ação indisponível agora"). Exceção inesperada no motor: idem, com o
toast "Erro interno: ação ignorada".
`engine.validActions(state)` lista os TIPOS aceitos agora — são exatamente as mesmas guardas do
dispatch (testado estado a estado em `audit.test.ts`); o conteúdo (id de opção, proposta, template)
ainda é validado no dispatch. `auto` vale sempre (fora aposentado): se houver decisão/lance/coletiva
pendente, a IA resolve e segue; para em decisões e propostas NOVAS (exceto `until: 'retirement'`).
`retire`: a partir dos 34 anos, em qualquer estado fora de partida (inclusive com coletiva ou decisão
abertas). `offer_respond`: com propostas e fora de partida (também durante coletiva/decisão).

### Payloads validados (inválido = recusado, estado igual)

| Ação | Regras |
|---|---|
| `train` | `focus` ∈ finishing, passing, dribbling, physical, defending, goalkeeping, tactical, rest, recovery; `intensity` ∈ leve, normal, intensa (ausente = normal). A escolha do jogador vira o padrão do treino automático (a IA nunca herda o descanso dela). |
| `match_choose` | `optionId` string. Lance comum: tem de ser uma das `pendingMoment.options[].id`. `minigame.timing` (se enviado) número em [0, 1] (ideal 0,62: +15%; ~0,07 de erro ≈ neutro; longe, até −50%). |
| `match_choose` em **pênalti** (`minigame: 'penalty_kick'` ou `'penalty_save'`) | o lado vem de `minigame.side` — `'left' \| 'center' \| 'right'` (aceita sinônimos: esquerda/esq, meio/centro/middle, direita/dir, ou 0/1/2) — e **vence** o `optionId`; sem `side`, vale o `optionId` (`pen_left`/`pen_center`/`pen_right` ou `dive_left`/`stay`/`dive_right`); `side` irreconhecível = recusado. Lados sempre na visão da câmera atrás do batedor (também quando o jogador é o goleiro). O efeito `moment_result` traz `optionId` resolvido e `penalty: { shot, keeper }`. Exemplo: `{ type: 'match_choose', optionId: 'pen_right', minigame: { side: 'right' } }`. |
| `match_timeout` | escolhe a opção segura (maior chance, nunca uma com risco de cartão ≥ 50% se houver outra). |
| `match_sub_request` | só com o jogador em campo, sem lance pendente, fora de pênaltis/pré/fim. |
| `offer_respond` | `response` ∈ accept, reject, counter. `counter.salary` número finito > 0; `counter.years` inteiro 1–5 (empréstimo: igual ao da proposta); `counter.role` ∈ Promessa, Reserva, Rotação, Titular. O clube tem teto de salário (≈ 1,2–1,5× a oferta original); acima dele nunca aceita, "melhorar" fica cada vez menos provável quanto maior o pedido e nunca passa do teto. Use `engine.acceptChance(...)` para mostrar as chances. |
| `social_post` | `templateId` em `POST_TEMPLATES`. Na mesma semana cada post rende metade do anterior; a partir do 3º, mídia −; "Foco no treino" mexe com o técnico no máx. 1× a cada 4 semanas e cada vez menos na temporada. |
| `buy` | `itemId` em `LIFESTYLE_ITEMS` e saldo suficiente; repetir a compra rende cada vez menos moral/imagem. |

Efeitos usados: `toast`, `attribute_up`, `ovr_change`, `match_event`, `key_moment`, `moment_result`,
`trophy`, `award`, `transfer`, `news`, `achievement`, `season_end`, `retired` (nenhum tipo novo).

## 4. Catálogos exportados

`POST_TEMPLATES`, `LIFESTYLE_ITEMS` (os 4 da UI + cobertura, mansão, iate, jatinho, instituto social),
`OUTLETS`, `WEIGHTS` (pesos de OVR por posição), `OUTFIELD_KEYS`, `GK_KEYS`, `attributesFor`,
`marketValueOf`, `GOAL_SCALE`.

## 5. Auditoria (correções)

- **Calendário**: nova pré-simulação ao fim de TODA fase de mata-mata (vitória ou derrota — fases
  seguintes previstas, Intercontinental/Mundial que dependiam do título e a copa de baixo se ajustam),
  de grupos, e de cada torneio da liga (Apertura/Clausura, com a liga rodada a rodada recoletada).
  Nada que ainda não foi jogado é descartado ao refazer o calendário (itens na mesma semana/ordem
  ficam); fase revelada com semana de gabarito já passada vai para depois do ponto atual (ida e volta
  com ≥ 1 semana); cada partida visível fica gravada na semana escolhida (não pula de semana depois).
  Congestionamento: ≤ 3 jogos por semana (procura semana com ≤ 1 jogo nas 3 seguintes); rodadas
  duplas da liga preferem semanas sem copa; 1ª temporada começando no meio do torneio estende o
  torneio em vez de empilhar rodadas. Testado: 0 jogos órfãos e 0 jogos "só do mundo" em eng.1, uru.1,
  mex.1, bra.1 (2 temporadas cada) e em arg.1, col.1, usa.1, mex.2, esp.1, ven.1, eng.2, par.1, hon.1.
- **Tabela ao vivo** de liga com dois torneios: só o torneio atual.
- **Transferência entre calendários**: clube de ano civil acertado na janela de meio da temporada
  europeia → apresentação na pré-temporada seguinte (`deferredJoin`); eliminações zeradas ao trocar de
  clube; títulos só de competições em que o jogador entrou em campo pelo clube (0 jogos = 0 títulos).
- **Escalação**: garoto da base (≤ 17: meta ≈ 42% dos jogos saindo do banco; 18–19: 30%) — na 1ª
  temporada europeia ≈ 14–18 jogos; goleiro da base estreia em jogos menores de copa; rodízio de copa
  para quem está fora; motivo em `LiveMatch.selectionReason`.
- **Lances**: λ de fundo descontado só pela conversão esperada da jogada que o lance substitui (a
  mesma opção que a IA "esperta" escolheria) → jogando bem o time sofre/marca ≈ o λ do mundo.
  Falta tática 58% (amarelo 75%), IA segura/tempo esgotado evitam cartão; suspensão por amarelos por
  competição (5 na liga, 3 nas copas). Opções dominadas recalibradas (1×1 rolar, cabeçada, falta
  direta, chute de longe); pênalti com os três lados ≈ 70% (goleiro fica no meio 28% e se adapta ao
  histórico do jogador). Jogo único com "vantagem do empate" vai para pênaltis (igual ao mundo).
- **Mídia**: tons da coletiva todos com custo (humilde: moral −1, torcida − em jogo grande).
- **Treino**: intensa +70% de ganho (−13 de energia); folga sem necessidade custa técnico e ritmo.
- **Eventos**: mudança de posição mantém o OVR (−2 prometido), 6 mini-eventos novos, todas as opções
  com contrapartida, mesmo mini-evento no máx. 1× a cada 2 temporadas; prioridade liga × continental
  vale na temporada (e na seguinte se vier na reta final). Lesão nova nunca encurta a atual.
- **Outros**: gols de liga reais nos prêmios, salário de 52 semanas, seleção pesa minutos no clube
  (até −8), lesões ≈ 2,5%/jogo, narração com partículas nos nomes (Van de Ven, De Bruyne, Le Fée) e
  mais variações de cartão/substituição (substituições duplas).
- **Não alterado (fora do escopo do motor)**: persistência da UI (`src/store/immersive.ts` grava o
  estado inteiro a cada ação — sugestão: debounce e mundo em chave separada, ele só muda no fim da
  temporada); formatos dos estaduais nos dados do mundo; itens já jogados de uma troca entre
  calendários diferentes ficam na semana 0 do calendário novo (mês/ano originais preservados).

## Postura em campo (aditivo)
- `ImmersiveAction`: `match_start` aceita `posture?`; nova ação `match_posture { posture }` (pré-jogo e bola rolando, fora dos pênaltis e sem lance pendente).
- `LiveMatch.posture?: MatchPosture` (`'ataque' | 'equilibrada' | 'poupar'`).
- `setPosture` (match.ts): "pedir a bola" cria até 2 lances decisivos a mais no tempo que resta; "poupar" corta um (sempre sobra ao menos um); saldo por partida limitado a −1…+2. Desgaste por minuto ×1,3 (pedir a bola) / ×0,7 (poupar).
