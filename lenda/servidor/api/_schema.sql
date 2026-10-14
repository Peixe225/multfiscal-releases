-- LENDA · tabelas da medição e das contas (MySQL 8 / MariaDB 10.6+, InnoDB, utf8mb4).
-- Rodado por instalar.php: só CREATE TABLE IF NOT EXISTS, então pode rodar quantas vezes quiser.
-- Datas sempre em UTC (DATETIME); o painel converte para America/Sao_Paulo (UTC-3).
-- Regra deste arquivo: nada de ponto e vírgula dentro de comentário ou texto (o instalar separa por ele), e
-- uma coluna ou índice por linha (o instalar acrescenta em tabela antiga a coluna ou o índice que faltar).
-- Índices largos de propósito: ix_visitas_inicio e ix_eventos_tipo_em cobrem as consultas do painel (sem ler
-- a linha), e ix_visitas_bot acha rápido as poucas sessões de robô para tirar do painel.
-- v3 (CONTRATO-v3.md): colunas novas em usuarios e carreiras e as tabelas site_config, admin_log, hall_foto,
-- hall_foto_clubes, denuncias, conquistas_usuario, indicacoes e bonus. Para atualizar um banco da v2, rode o
-- instalar.php de novo: ele cria o que falta e preenche as colunas novas das contas e carreiras antigas.
-- v3.1 (CONTRATO-v3.md §12): carreiras.resumo_hash, eventos.nota e as tabelas carreiras_moderacao e partidas_vid.

CREATE TABLE IF NOT EXISTS usuarios (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  email         VARCHAR(190) NOT NULL,
  apelido       VARCHAR(32)  NOT NULL,
  senha_hash    VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  criado_em     DATETIME     NOT NULL,
  ultimo_login  DATETIME     NULL,
  ultimo_acesso DATETIME     NULL,
  origem        VARCHAR(64)  NOT NULL DEFAULT 'direto',
  aceite_em     DATETIME     NOT NULL,
  time_coracao  VARCHAR(40)  NULL,
  uf            CHAR(2)      CHARACTER SET ascii COLLATE ascii_bin NULL,
  partidas      INT UNSIGNED NOT NULL DEFAULT 0,
  status           VARCHAR(10)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ativo',
  suspenso_ate     DATETIME     NULL,
  motivo_suspensao VARCHAR(200) NULL,
  codigo_convite   CHAR(8)      CHARACTER SET ascii COLLATE ascii_bin NULL,
  hall_publico     VARCHAR(6)   CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'auto',
  partidas_conta   INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_usuarios_email (email),
  UNIQUE KEY uq_usuarios_convite (codigo_convite),
  KEY ix_usuarios_criado (criado_em),
  KEY ix_usuarios_status (status, suspenso_ate)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessoes_login (
  token_sha256 CHAR(64)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  usuario_id   INT UNSIGNED NOT NULL,
  criada_em    DATETIME     NOT NULL,
  expira_em    DATETIME     NOT NULL,
  renovada_em  DATETIME     NOT NULL,
  PRIMARY KEY (token_sha256),
  KEY ix_sessoes_usuario (usuario_id),
  KEY ix_sessoes_expira (expira_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS carreiras (
  id           INT UNSIGNED      NOT NULL AUTO_INCREMENT,
  usuario_id   INT UNSIGNED      NOT NULL,
  carreira_id  VARCHAR(64)       CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  modo         VARCHAR(10)       CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'classico',
  jogador      VARCHAR(40)       NOT NULL DEFAULT '',
  numero       SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  pais         VARCHAR(8)        NOT NULL DEFAULT '',
  posicao      VARCHAR(8)        NOT NULL DEFAULT '',
  nota         SMALLINT          NOT NULL DEFAULT 0,
  nota_v       SMALLINT          NULL DEFAULT NULL,
  pico_ovr     SMALLINT          NOT NULL DEFAULT 0,
  temporadas   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  gols         INT UNSIGNED      NOT NULL DEFAULT 0,
  titulos      INT UNSIGNED      NOT NULL DEFAULT 0,
  bolas_ouro   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  headline     VARCHAR(120)      NOT NULL DEFAULT '',
  como         VARCHAR(6)        CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'manual',
  dados        MEDIUMBLOB        NOT NULL,
  tamanho      INT UNSIGNED      NOT NULL DEFAULT 0,
  terminou_em  DATETIME          NULL,
  salva_em     DATETIME          NOT NULL,
  publica      TINYINT(1)        NOT NULL DEFAULT 0,
  oculta       TINYINT UNSIGNED  NOT NULL DEFAULT 0,
  suspeita     VARCHAR(64)       CHARACTER SET ascii COLLATE ascii_bin NULL,
  clubes       TEXT              CHARACTER SET ascii COLLATE ascii_bin NULL,
  copas        SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  bonus_ovr    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  resumo_hash  CHAR(40)          CHARACTER SET ascii COLLATE ascii_bin NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_carreiras_usuario_carreira (usuario_id, carreira_id),
  KEY ix_carreiras_usuario_salva (usuario_id, salva_em),
  KEY ix_carreiras_nota (nota),
  KEY ix_carreiras_usuario_nota (usuario_id, nota),
  KEY ix_carreiras_suspeita (suspeita),
  KEY ix_carreiras_oculta (oculta),
  KEY ix_carreiras_carreira (carreira_id),
  KEY ix_carreiras_resumo (resumo_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS visitantes_usuarios (
  vid        CHAR(36)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  usuario_id INT UNSIGNED NOT NULL,
  ligado_em  DATETIME     NOT NULL,
  PRIMARY KEY (vid),
  KEY ix_vu_usuario (usuario_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS redefinicoes (
  email       VARCHAR(190)     NOT NULL,
  codigo_hash CHAR(64)         CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expira_em   DATETIME         NOT NULL,
  tentativas  TINYINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tentativas (
  chave  VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  janela INT UNSIGNED NOT NULL,
  n      INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (chave, janela),
  KEY ix_tentativas_janela (janela)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS visitas (
  sid          CHAR(36)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  vid          CHAR(36)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  usuario_id   INT UNSIGNED NULL,
  inicio       DATETIME     NOT NULL,
  ultimo       DATETIME     NOT NULL,
  ativo_s      INT UNSIGNED NOT NULL DEFAULT 0,
  jogando_ate  DATETIME     NULL,
  origem       VARCHAR(64)  NOT NULL DEFAULT 'direto',
  utm_source   VARCHAR(64)  NULL,
  utm_medium   VARCHAR(64)  NULL,
  utm_campaign VARCHAR(100) NULL,
  dispositivo  VARCHAR(10)  CHARACTER SET ascii COLLATE ascii_bin NULL,
  idioma       VARCHAR(16)  CHARACTER SET ascii COLLATE ascii_bin NULL,
  tela         VARCHAR(12)  CHARACTER SET ascii COLLATE ascii_bin NULL,
  bot          TINYINT(1)   NOT NULL DEFAULT 0,
  eventos      INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (sid),
  KEY ix_visitas_inicio (inicio, bot, vid, ativo_s, origem, dispositivo),
  KEY ix_visitas_ultimo (ultimo),
  KEY ix_visitas_vid (vid, inicio),
  KEY ix_visitas_usuario (usuario_id),
  KEY ix_visitas_bot (bot, inicio)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS eventos (
  id    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sid   CHAR(36)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  vid   CHAR(36)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tipo  VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  modo  VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NULL,
  dados TEXT        NULL,
  em    DATETIME    NOT NULL,
  nota  SMALLINT    NULL,
  PRIMARY KEY (id),
  KEY ix_eventos_em_tipo (em, tipo),
  KEY ix_eventos_tipo_em (tipo, em, modo, vid, sid),
  KEY ix_eventos_sid (sid),
  KEY ix_eventos_vid_tipo (vid, tipo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── v3 ──────────────────────────────────────────────────────────────────────────────────────────

-- Configuração do site editável no painel (valor em JSON). Chaves com _ na frente são estado interno
-- (ex.: _hall_foto, _raridade) e não aparecem na tela de configurações.
CREATE TABLE IF NOT EXISTS site_config (
  chave          VARCHAR(40)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  valor          MEDIUMTEXT   NOT NULL,
  atualizado_em  DATETIME     NOT NULL,
  atualizado_por VARCHAR(20)  NULL,
  PRIMARY KEY (chave)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tudo o que o administrador muda (e as exportações).
CREATE TABLE IF NOT EXISTS admin_log (
  id       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  em       DATETIME     NOT NULL,
  acao     VARCHAR(40)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  alvo     VARCHAR(80)  NULL,
  detalhes TEXT         NULL,
  PRIMARY KEY (id),
  KEY ix_admin_log_em (em),
  KEY ix_admin_log_alvo (alvo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Fotografia do Hall público: id = posição geral (1 = melhor), refeita de hora em hora (hall_intervalo_min).
CREATE TABLE IF NOT EXISTS hall_foto (
  id            INT UNSIGNED      NOT NULL,
  carreira_pk   INT UNSIGNED      NOT NULL,
  carreira_id   VARCHAR(64)       CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  usuario_id    INT UNSIGNED      NOT NULL,
  apelido       VARCHAR(32)       NOT NULL,
  jogador       VARCHAR(40)       NOT NULL DEFAULT '',
  numero        SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  pais          VARCHAR(8)        NOT NULL DEFAULT '',
  posicao_campo VARCHAR(8)        NOT NULL DEFAULT '',
  nota          SMALLINT          NOT NULL DEFAULT 0,
  pico_ovr      SMALLINT          NOT NULL DEFAULT 0,
  temporadas    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  gols          INT UNSIGNED      NOT NULL DEFAULT 0,
  titulos       INT UNSIGNED      NOT NULL DEFAULT 0,
  bolas_ouro    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  copas         SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  headline      VARCHAR(120)      NOT NULL DEFAULT '',
  clubes        TEXT              CHARACTER SET ascii COLLATE ascii_bin NULL,
  bonus_ovr     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  terminou_em   DATETIME          NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hall_foto_carreira (carreira_id),
  KEY ix_hall_foto_pais (pais, id),
  KEY ix_hall_foto_usuario (usuario_id),
  KEY ix_hall_foto_pk (carreira_pk)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Clubes de cada carreira da fotografia (filtro por clube na ordem da posição geral).
CREATE TABLE IF NOT EXISTS hall_foto_clubes (
  foto_id INT UNSIGNED NOT NULL,
  club_id VARCHAR(16)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (club_id, foto_id),
  KEY ix_hall_foto_clubes_foto (foto_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Denúncias de carreiras do Hall público (uma por carreira por conta).
CREATE TABLE IF NOT EXISTS denuncias (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  carreira_pk  INT UNSIGNED NOT NULL,
  usuario_id   INT UNSIGNED NOT NULL,
  motivo       VARCHAR(10)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  texto        VARCHAR(300) NULL,
  criada_em    DATETIME     NOT NULL,
  status       VARCHAR(10)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'aberta',
  resolvida_em DATETIME     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_denuncias_carreira_usuario (carreira_pk, usuario_id),
  KEY ix_denuncias_status (status, criada_em),
  KEY ix_denuncias_usuario (usuario_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Conquistas de cada conta (a data mais antiga em que foi conseguida).
CREATE TABLE IF NOT EXISTS conquistas_usuario (
  usuario_id   INT UNSIGNED NOT NULL,
  conquista_id VARCHAR(64)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  em           DATETIME     NOT NULL,
  PRIMARY KEY (usuario_id, conquista_id),
  KEY ix_conquistas_conquista (conquista_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Indicações: quem convidou quem. indicado_id fica NULL se a conta indicada for excluída.
CREATE TABLE IF NOT EXISTS indicacoes (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  indicador_id INT UNSIGNED NOT NULL,
  indicado_id  INT UNSIGNED NULL,
  criada_em    DATETIME     NOT NULL,
  status       VARCHAR(10)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pendente',
  motivo       VARCHAR(40)  CHARACTER SET ascii COLLATE ascii_bin NULL,
  validada_em  DATETIME     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_indicacoes_indicado (indicado_id),
  KEY ix_indicacoes_indicador (indicador_id, status),
  KEY ix_indicacoes_criada (criada_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bônus de OVR para a próxima carreira (indicação, compartilhar ou dado pelo admin).
CREATE TABLE IF NOT EXISTS bonus (
  id          INT UNSIGNED      NOT NULL AUTO_INCREMENT,
  usuario_id  INT UNSIGNED      NOT NULL,
  valor       SMALLINT UNSIGNED NOT NULL,
  origem      VARCHAR(12)       CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ref         VARCHAR(100)      NULL,
  criado_em   DATETIME          NOT NULL,
  usado_em    DATETIME          NULL,
  carreira_id VARCHAR(64)       CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  PRIMARY KEY (id),
  KEY ix_bonus_usuario (usuario_id, usado_em, criado_em),
  KEY ix_bonus_carreira (usuario_id, carreira_id),
  KEY ix_bonus_ref (usuario_id, origem, ref)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── v3.1 ────────────────────────────────────────────────────────────────────────────────────────

-- Decisão de moderação de uma carreira (oculta 1 = pelo admin, 2 = pelas denúncias), fora da linha que o dono pode
-- apagar: salvar de novo o mesmo HallEntry (ou o mesmo resumo com outro id) volta escondido. Só ids e o hash do
-- resumo, nada da carreira. Some junto com a conta (excluir).
CREATE TABLE IF NOT EXISTS carreiras_moderacao (
  usuario_id  INT UNSIGNED     NOT NULL,
  carreira_id VARCHAR(64)      CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  resumo_hash CHAR(40)         CHARACTER SET ascii COLLATE ascii_bin NULL,
  oculta      TINYINT UNSIGNED NOT NULL,
  em          DATETIME         NOT NULL,
  PRIMARY KEY (usuario_id, carreira_id),
  KEY ix_moderacao_resumo (usuario_id, resumo_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Partidas terminadas por aparelho (jogo_fim do Clássico/Imersivo + partida_fim), somadas pelo e.php: o funil
-- "5 partidas" do painel lê daqui em vez de agrupar a tabela eventos inteira.
CREATE TABLE IF NOT EXISTS partidas_vid (
  vid           CHAR(36)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  n             INT UNSIGNED NOT NULL DEFAULT 0,
  atualizado_em DATETIME     NOT NULL,
  PRIMARY KEY (vid),
  KEY ix_partidas_vid_n (n)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
