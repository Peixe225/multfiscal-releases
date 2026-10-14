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
