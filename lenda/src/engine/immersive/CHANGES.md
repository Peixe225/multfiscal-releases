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
| `ImmersiveEngine` | `liveTable(data, state, tournament?)` | liga de Apertura/Clausura: a tabela de um torneio (0/1); sem o parâmetro, a do torneio em curso. O Balanço mostra as duas (somam a tabela anual do mundo) |
| `ContractOffer` | `rounds?: number` | rodadas no início da negociação (paciência e pips depois de recarregar a página) |
| `ImmersiveState` | `pressLog?: { itemId, total, start, answers[] } \| null` | coletiva em andamento: relações no começo e respostas (tom + `newsId`) — o medidor e o card de fechamento sobrevivem a recarregar; `null` ao pular |
| `KeyMoment` | `suggested?: string` | opção recomendada (maior valor esperado, sem sorteio): é a que o `match_timeout` resolve — marcar como "Padrão" |
| `SeasonRecord` | `spans?: SeasonSpan[]` | temporada dividida entre clubes: a parte de cada um (jogos, gols, assist., minutos, posição); títulos pelo `teamId` |

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

## QA do Modo Imersivo (temporada completa pela UI) — aditivo
- `ImmersiveEngine.trainingPreview?(data, state, focus, intensity)` → `TrainingPreviewInfo` (`focus` efetivo,
  `gains[]` com `value`/`to`/`progressBefore`/`progress` 0–1, `fitnessAfter`, `fitnessDelta`, `injuryRisk`). Mesma conta
  do `train` (extraída em `trainPoints`), rodada em cópias de atributos/XP: o ganho é determinístico, então a UI mostra
  o progresso até o próximo ponto em vez de uma "chance" inventada (a prévia antiga dizia 63–92% e nada subia).
- `MatchEvent.shootout?: true` nas cobranças da disputa de pênaltis (`recordKick`): não são gols do jogo — a UI
  contava os pênaltis da disputa no placar ao vivo, na lista de autores e no craque do jogo.
- Correções de comportamento (sem mudar o contrato):
  - Oferta da base: o card mostra o contrato que é assinado (3 anos, €24K — antes "5 anos, €20K").
  - Boas-vindas da diretoria e manchete da assinatura saem na semana em que a temporada começa (antes "há 38 sem.").
  - "O técnico prometeu a sua estreia hoje" agora entra sempre (era 92%).
  - Trocas: escalação em campo/banco por lado (`LiveMem.xi`/`bench`) — ninguém sai duas vezes, quem acabou de
    entrar não sai, o jogador entra na vaga de um titular e sai para um reserva de verdade; nomes únicos no
    elenco e sem repetir nomes do seu time no adversário quando dá. `xi`/`bench`/`fromBench` (opcionais) nascem
    no `createLive`; save antigo no meio da partida monta a escalação na hora (`lineup()`).
  - Texto do resultado do lance segue o lance narrado (defesa × para fora × trave; passe que vira defesa × chute
    para fora com um sorteio só).
  - Dicas da coletiva nunca mostram "−0" (efeito pequeno sai só com o sinal).
  - `roundMoney`: passo de €1K abaixo de €100K (contraproposta de €25K sobre €20K virava €30K, acima do teto).
  - Item de premiação: "Premiação da temporada 2026" (era "Premiação 2027").
  - Narração com o artigo certo do time (`fixArticles` em match.ts, sobre `artigo()`/`countryArt()` de util.ts):
    "GOL da Ponte Preta", "na Juventus", "da Argentina", "de Portugal", "dos Estados Unidos"; `withArt` dá o
    artigo também a seleções; "Juventude" volta a ser masculino. Convocação: "da seleção do Brasil" (era
    "da Brasil"). Textos de contrato/carreira também ("Bem-vindo à Ponte Preta", "renova com a Juventus",
    "Proposta da Chapecoense expirou", "capitão da Roma").
  - Toast do treino com o nome do atributo ("+1 Finalização"; era "+1 shooting") — `ATTR_NAME` em player.ts.
  - Pênalti: a narração segue o canto (goleiro no canto certo = defesa; canto errado = por cima/na trave) e bate
    com o texto do resultado; pênalti contra que sai para fora não conta defesa do goleiro.
  - Empréstimo: o salário da proposta (negociável) vale durante o empréstimo; o do clube dono volta ao fim
    (`mem.loan.parentSalary`).
  - Frase "amplia a vibração da torcida" (gol que não ampliava nada) trocada.

## QA v5 (motor) — aditivo
- `KeyMoment.suggested?: string`: a opção recomendada (maior valor esperado em gols — finalizar, passe que vira
  gol, gols evitados — sem sorteio). `match_timeout` resolve exatamente ela (antes: a de maior % bruto, quase sempre
  o passe "seguro", e um atacante de 86–89 fazia 4–5 gols por temporada sem responder). A UI deve marcar esta como
  "Padrão" (hoje marca a de maior %). O detalhe do passe mostra a chance da jogada inteira virar gol
  ("Passe · gol em 14%" = acerto do passe × conversão), comparável com o "Gol 28%" das finalizações.
- Chances de gol por situação: cara a cara com base ≈ 30% (≈ 40% para um atacante de nível, ≈ 50% para um craque,
  ≈ 25% aos 16 anos); chute da entrada da área ≈ 10–16%; cabeceio ≈ 12–20%. A qualidade pesa mais no topo
  (acima de 85, cada ponto vale o dobro) e o cara a cara ficou mais raro no sorteio dos lances. Médias de
  temporada (IA): atacante comum de clube médio ~0,45 gol/jogo (era 0,44); craque no Real ~0,6 (era 0,45).
- `SeasonRecord.spans?: SeasonSpan[]` (types.ts): temporada dividida entre clubes (transferência/empréstimo no
  meio) traz a parte de cada clube (jogos, gols, assistências, minutos, posição na liga). `stats`/`clubId` seguem
  sendo o total e o clube do fim da temporada; `summarize` agora atribui jogos/gols/títulos por parte (título pelo
  `TrophyWin.teamId`). `SeasonClubSpan` (memória) ganhou `loan`/`goals`/`assists`/`minutes`.
- `buildPress(data, s, item, leaguePos, leagueSize)`; `MatchSummary.scorers?`; exportados `selectionPreview`,
  `stagePhrase` (match.ts), `safestOption` (index.ts), `clubStreak`/`fanTails` (media.ts), `pl` (util.ts).
- Comportamento (sem mudar o contrato):
  - Cartões por jogador: 2º amarelo expulsa ("Segundo amarelo…"); expulso sai da escalação (time com um a menos,
    nunca mais aparece na narração); amarelo e vermelho direto nunca no mesmo minuto; cartão sai de qualquer um em
    campo (≈ 0,1 expulsão por jogo).
  - Nota final (resultado, jogo sem sofrer gol) aplicada no apito (`finishRegulation`), uma vez só: a tela de fim de
    jogo mostra a mesma nota gravada na carreira.
  - Escalação extraída em `selection()`: coletiva pré-jogo só para quem está relacionado (fora/lesionado/suspenso →
    recado "Coletiva sem você" da assessoria). 1ª temporada na base: banco desde a 1ª rodada e estreia garantida no
    1º jogo; o plano de minutos da base não vale em jogo grande (importância ≥ 0,7 ou quartas em diante).
  - Play-off de liga só aparece na agenda com a fase regular (do torneio) encerrada — e com o confronto da tabela real.
  - Salto para o encerramento (semana 62): só as 2 primeiras semanas contam como semanas sem jogo (o ritmo não zera).
  - Fim de empréstimo com o contrato do clube dono vencido: livre no mercado ("terminou durante o empréstimo");
    "Sem renovação" nunca sai para contrato já vencido.
  - "Simular": decisão aberta → opção de menor risco (nunca a "mala preta"); para em propostas novas, em janela com
    propostas e antes de uma proposta vencer (toast). Até a aposentadoria a IA segue sorteando.
  - Coletivas: 3 variantes por pergunta e tom, perguntas de contexto (tabela, rebaixamento, acesso, sequência,
    resultado anterior, volta de lesão, idade, reta final), sem repetir pergunta em 4 semanas; uma manchete por
    coletiva (a resposta mais quente) e sem manchete repetida; notícias de tabela (liderança, zona de rebaixamento,
    G-k/acesso, sequências) e de fim de temporada (título, acesso, rebaixamento, posição final).
  - Narração do lance pela opção escolhida (colocado/forte/cara a cara/drible no goleiro/de longe/cabeceio/falta;
    tabela com o companheiro; cruzamento termina de cabeça); "pediu para sair" só fala em cansaço com a energia
    baixa; abertura "… pela 31ª rodada"; pênaltis com o placar do vencedor primeiro; dupla substituição = dois eventos.
  - Artigos: tabela explícita para as 211 seleções ("da África do Sul", "de Aruba", "das Bermudas"); `artigo()` usa
    o `clubArticle` do Clássico ("da Cremonese", "da Juve Stabia"); "Argentino Q.." vira "Argentino Q.".
  - Rede social: frases sem repetir nos últimos posts, com placar/adversário/autor do gol, "três pontos" só na liga,
    torcedor com @ na língua do país do clube, "com urgência"; posts de torcedores da temporada passada saem na
    virada; "1 gol na temporada". Propostas: "{Clube} oferece €61K/ano por 5 anos para você ser titular."
