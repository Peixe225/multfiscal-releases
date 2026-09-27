# LENDA — Arquitetura

Simulador de carreira de futebol (pt-BR). Web app estático: **React 19 + TypeScript + Vite 8 + Tailwind v4 + motion + zustand**.

- **Modo Clássico (MVP)** — a carreira no estilo do Copero (decisões por período, tabela por idade, vitrine de troféus), mas **200% melhor**. Tema visual **"Noite de Final"** (`data-theme="noite"`).
- **Modo Imersivo (fase 2)** — a mesma carreira jogada partida a partida (lances interativos, calendário, imprensa, redes sociais, contratos). Tema visual **"Transmissão"** (`data-theme="transmissao"`).

## 1. O que torna o Clássico melhor que o Copero

| Copero | LENDA |
|---|---|
| Títulos, acesso e rebaixamento sorteados por "reputação" | **O mundo inteiro é simulado**: cada liga é jogada rodada a rodada, e acesso/rebaixamento sai da tabela final |
| Sem dados atuais | A temporada 2026 **começa da tabela REAL de hoje (27/09/2026)** e dos jogos restantes reais. Libertadores, Sul-Americana, Copa do Brasil e Champions continuam do ponto real em que estão |
| Bola de Ouro é um sorteio | Ranking anual com **craques reais** (notas EA FC 27) que envelhecem e se aposentam, mais novas gerações |
| Copa do Mundo por idade | **Calendário real**: Copa 2030/2034…, Copa América, Euro, Mundial de Clubes 2029…, com chaveamento exibido |
| Uma linha a cada período | **Uma linha por temporada**, com posição na liga, ↑ACESSO / ↓REBAIXADO, artilharia e pódio da Bola de Ouro |
| Sem abas | Abas **Carreira · Temporada** (tabela da liga com zonas e copas) **· Prêmios** (ranking da Bola de Ouro) **· Mundo** (campeões do ano) |
| Carreira não é salva | **Salvar/continuar**, Hall da Fama das carreiras anteriores e conquistas locais para todos |
| Resumo simples | Resumo com gráfico de OVR, clubes, seleção, títulos, prêmios, comparações com lendas reais e card para compartilhar (PNG) |
| 25 eventos, 20 conquistas | Os mesmos eventos reescritos, mais os novos, e **40+ conquistas** |
| Animações não podem ser puladas | Revelação animada que dá para pular, com opção de som e atalhos de teclado |

## 2. Estrutura de pastas

```
lenda/
  docs/                  este arquivo + design/ (specs, temas, snippets, SVGs de troféu)
  scripts/               pipeline de dados (Node ≥22, roda com `npm run data`)
    build-data.mjs       orquestra: busca ESPN/fut.gg → gera src/data/generated + public/*
    lib/*.mjs
  public/
    crests/              atlas de escudos por liga (<leagueId>.webp) — ver CrestRef
    leagues/             logos de ligas/competições (.webp)
    flags/4x3/           bandeiras (subset do flag-icons)
  src/
    engine/
      types.ts           CONTRATO de tipos (não quebrar; mudanças só aditivas)
      api.ts             CONTRATO entre mundo ↔ carreira
      rng.ts             PRNG determinístico (FNV-1a + xorshift/mulberry), sub-streams por chave
      world/             motor do mundo (implementa WorldEngine)
      career/            motor da carreira do modo Clássico
      immersive/         (fase 2)
    data/
      generated/         JSON gerado pelo pipeline (não editar à mão)
      catalog/           catálogos escritos à mão (países pt-BR, ligas meta, competições, troféus)
      index.ts           carrega GameData (import dinâmico) + índices (clubById, leagueById…)
    ui/
      theme/             tokens, temas, fontes
      primitives/        Crest, Flag, TrophyArt, OvrBadge, Money, EffectChip, Button, Tabs, Modal, Tooltip, CountUp
      trophies/          arte SVG de troféus (componentes)
      classic/           telas do modo Clássico
      immersive/         (fase 2)
      shared/            landing, Ligas ao vivo, Hall da Fama, conquistas
    store/               zustand: app (tela atual), career (estado + persistência)
    App.tsx, main.tsx
```

**Dono por pasta.** Cada agente de implementação só edita a própria pasta. `types.ts` e `api.ts` aceitam apenas **acréscimos**. `package.json` só muda com autorização explícita no prompt.

## 3. Convenções

- **Textos da UI em pt-BR.** Identificadores no código em inglês.
- O motor é **puro e determinístico**. Nada de `Math.random`/`Date.now` dentro de `src/engine/**`: use `rng.ts` com sub-streams nomeados (ex.: `${seed}:season:2027:bra.1`).
- Moeda sempre em **euros** (valor de mercado no estilo do Copero: `€100K`, `€5.5M`, `€45M`).
- **Calendário.** `season` é o ano de início. Ligas de ano civil (BRA, ARG, MLS…) mostram "2026"; ligas europeias mostram "2026/27". Torneios de seleção e Mundial de Clubes do ano T encerram a temporada T-1. A Bola de Ouro do ano T premia a temporada T-1.
- **Idade.** O jogador tem 16 anos na temporada 2026 (nasceu em 2010), então idade = 16 + (season − 2026).
- **OVR tiers**: bronze <70, prata 70–79, ouro 80–89, lenda 90+. Detalhes em `docs/design/DESIGN-SPEC-noite.md`.
- Testes com **vitest** (`npm test`) em `src/**/*.test.ts`. Tipos com `npm run typecheck` (TypeScript 7).

## 4. Pipeline de dados (resumo)

Fontes: ESPN (tabelas, times, cores, escudos, jogos restantes, copas em andamento), fut.gg (notas EA FC 27 para força de elenco e estrelas) e catálogos próprios (nomes pt-BR, coeficientes de liga, vagas continentais, troféus). Saída: `src/data/generated/game-data.json` (tipo `GameData`), atlas de escudos, logos e bandeiras. Rosters completos ficam num arquivo separado para o modo Imersivo.

## 5. Fluxo do modo Clássico

1. **Landing**: escolha do modo e do ritmo (Intensa 1 · Normal 2 · Expressa 3 temporadas por decisão), continuar carreira salva.
2. **Identidade**: sobrenome, número, pé, nacionalidade, posição.
3. **Oferta de base**: 3 clubes reais do país.
4. **Loop**: cada decisão aplica efeitos, depois simula N temporadas. Cada temporada roda `world.simulateSeason`, depois a carreira gera as estatísticas do jogador, depois `world.computeAwards`, e por fim a revelação animada mostra linha, números, troféus, OVR e a celebração.
5. **Fim**: aposentadoria (voluntária, forçada ou aos 40), tela "Sua carreira chegou ao fim", resumo, card, Hall da Fama e conquistas.

## 6. Referências

- Engenharia reversa do Copero (mecânicas, eventos, probabilidades, UI): relatórios `ref-*.md` no scratchpad da sessão (não versionados).
- Design: `docs/design/DESIGN-SPEC-noite.md` (Clássico) e `docs/design/DESIGN-SPEC-transmissao.md` (Imersivo), com os temas CSS e os snippets.
