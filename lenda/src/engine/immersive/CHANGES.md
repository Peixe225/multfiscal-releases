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

Ação fora de hora: estado igual + `toast` de tom `danger` ("Ação indisponível agora").
`engine.validActions(state)` lista o que vale agora.

Efeitos usados: `toast`, `attribute_up`, `ovr_change`, `match_event`, `key_moment`, `moment_result`,
`trophy`, `award`, `transfer`, `news`, `achievement`, `season_end`, `retired` (nenhum tipo novo).

## 4. Catálogos exportados

`POST_TEMPLATES`, `LIFESTYLE_ITEMS` (os 4 da UI + cobertura, mansão, iate, jatinho, instituto social),
`OUTLETS`, `WEIGHTS` (pesos de OVR por posição), `OUTFIELD_KEYS`, `GK_KEYS`, `attributesFor`,
`marketValueOf`, `GOAL_SCALE`.
