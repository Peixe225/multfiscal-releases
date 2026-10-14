-- LENDA · tabelas da medição e das contas (MySQL 8 / MariaDB 10.6+, InnoDB, utf8mb4).
-- Rodado por instalar.php: só CREATE TABLE IF NOT EXISTS, então pode rodar quantas vezes quiser.
-- Datas sempre em UTC (DATETIME); o painel converte para America/Sao_Paulo (UTC-3).
-- Regra deste arquivo: nada de ponto e vírgula dentro de comentário ou texto (o instalar separa por ele), e
-- uma coluna ou índice por linha (o instalar acrescenta em tabela antiga a coluna ou o índice que faltar).
-- Índices largos de propósito: ix_visitas_inicio e ix_eventos_tipo_em cobrem as consultas do painel (sem ler
-- a linha), e ix_visitas_bot acha rápido as poucas sessões de robô para tirar do painel.

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
  PRIMARY KEY (id),
  UNIQUE KEY uq_usuarios_email (email),
  KEY ix_usuarios_criado (criado_em)
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
  PRIMARY KEY (id),
  UNIQUE KEY uq_carreiras_usuario_carreira (usuario_id, carreira_id),
  KEY ix_carreiras_usuario_salva (usuario_id, salva_em),
  KEY ix_carreiras_nota (nota)
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
  PRIMARY KEY (id),
  KEY ix_eventos_em_tipo (em, tipo),
  KEY ix_eventos_tipo_em (tipo, em, modo, vid, sid),
  KEY ix_eventos_sid (sid),
  KEY ix_eventos_vid_tipo (vid, tipo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
