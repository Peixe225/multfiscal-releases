# OmniChannel 2 em PHP: arquitetura e convenções

O backend PHP implementa **o mesmo contrato HTTP** do app Python
(`omnichannel/app`): mesmas rotas, métodos, JSON, códigos de status e mensagens.
O front (`app/web`) é um só para os dois servidores. Quando houver dúvida sobre
um comportamento, **o código Python é a especificação** (rotas em `app/api`,
regras em `app/servicos`, formatos em `app/schemas.py` e `app/serializacao.py`).

Alvo: PHP 8.1+ (produção roda 8.5), PDO com MySQL/MariaDB (produção) ou SQLite
(desenvolvimento e testes), sem composer, sem `exec`, sem processo longo.

## Pastas

```
php/.htaccess           se o DocumentRoot for php/, reescreve tudo para public/
php/public/             DocumentRoot: index.php (front controller) e .htaccess
php/app/                código (namespace OmniChannel\..., autoload PSR-4 próprio)
  Nucleo/               Aplicacao, Roteador, Requisicao, Resposta, Validador,
                        ErroHttp, Config, Datas, Json, Texto, Log, Cors, Estaticos
  Nucleo/Http/          Cliente HTTP dos provedores (curl ou roteiro de teste)
  Banco/                Banco (PDO), Esquema, Migracao, Migracoes/M*.php
  Auth/                 Token, Senhas, Auth (guardas), Atendentes, Rotas
  Eventos/              Eventos (fila de tempo real), Rotas
  Instalacao/           Seed
  Tarefas/              tarefas do cron (uma classe por arquivo)
  Api/                  rotas das demais áreas (uma classe por arquivo)
php/dados/              criado em execução: anexos, logs, travas (nunca público)
php/config.php          gerado na instalação; NUNCA versionado (config.exemplo.php é o modelo)
php/console.php         CLI: esquema | semear [--demo] | hash-senha | rotas
php/cron.php            roda as tarefas de app/Tarefas (cron a cada minuto)
php/tests/rodar.php     testes de unidade PHP (só locais)
```

## Como adicionar uma rota

Crie `app/Api/<Area>.php` (ou `app/<Modulo>/Rotas.php`). Ela é descoberta
sozinha; não há arquivo central para editar.

```php
<?php
declare(strict_types=1);

namespace OmniChannel\Api;

use OmniChannel\Auth\Auth;
use OmniChannel\Banco\Banco;
use OmniChannel\Eventos\Eventos;
use OmniChannel\Nucleo\{ErroHttp, Requisicao, Resposta, Roteador, Validador};

final class Etiquetas
{
    public static function registrar(Roteador $r): void
    {
        $r->get('/api/etiquetas', [self::class, 'listar']);
        $r->post('/api/etiquetas', [self::class, 'criar'], status: 201);
        $r->delete('/api/etiquetas/{etiqueta_id:int}', [self::class, 'apagar'], status: 204);
    }

    public static function criar(Requisicao $req): array
    {
        Auth::admin($req);                               // 401/403 como no Python
        $v = Validador::corpo($req);                     // 422 se não for objeto JSON
        $nome = $v->texto('nome', min: 1, max: 60);
        $cor = $v->texto('cor', max: 9, obrigatorio: false, padrao: '#6b7cff');
        $v->validar();
        try {
            $id = Banco::inserir('etiquetas', ['nome' => $nome, 'cor' => $cor]);
        } catch (\PDOException $e) {
            if (Banco::eUnicidade($e)) {
                throw ErroHttp::conflito('etiqueta ja existe');
            }
            throw $e;
        }
        return ['id' => $id, 'nome' => $nome, 'cor' => $cor];
    }

    public static function apagar(Requisicao $req, array $p): void
    {
        Auth::admin($req);
        if (Banco::executar('DELETE FROM etiquetas WHERE id = ?', [$p['etiqueta_id']]) === 0) {
            throw ErroHttp::naoEncontrado('etiqueta nao encontrada');
        }
    }
}
```

- Padrões de rota: `{x}` (texto), `{x:int}` (inteiro; "abc" vira 422 como no
  FastAPI), `{x:caminho}` (resto do caminho). Literais vencem parâmetros
  (`/api/canais/tipos` antes de `/api/canais/{canal_id:int}`).
- A ação recebe `(Requisicao $req, array $parametros)`; os parâmetros também
  ficam em `$req->rota` / `$req->parametro('x')`.
- Retorno: `array`/objeto vira JSON com o status da rota (padrão 200; passe
  `status: 201` ou `status: 204`). Para outro status, cabeçalho ou arquivo,
  devolva uma `Resposta` (`Resposta::json($d, 202)`, `Resposta::arquivo(...)`,
  `Resposta::vazia()`).
- Erros: lance `ErroHttp` (`naoAutorizado`, `proibido`, `naoEncontrado`,
  `conflito`, `grandeDemais`, `invalido` (422 com frase), `indisponivel`) ou
  `new ErroHttp(400, 'frase')`. Sai `{"detail": "frase"}`. A frase é a MESMA
  do Python (inclusive sem acento onde o Python não tem).
- Validação: `Validador::corpo($req)` / `::consulta($req)` / `::formulario($req)`,
  métodos `texto`, `email`, `opcao`, `inteiro`, `booleano`, `objeto`, `lista`,
  `tem()` (PATCH: o campo veio?), `falhar()` (regra própria) e `validar()`
  (lança 422 `{"detail": [{"type","loc","msg","input"}]}` com todos os problemas).
  Campo opcional aceita `null` (como `str | None = None`).
- Requisição: `$req->json()`, `jsonObjeto()`, `corpoBruto()` (assinatura de
  webhook), `consulta('x')`, `consultaLista('x')`, `cabecalho('x-sessao')`,
  `arquivo('arquivo')` (`ArquivoEnviado`: `nome`, `tipo()`, `tamanho`,
  `dados()`, `tipoDetectado()`), `campo('conteudo')` (multipart),
  `tokenBearer()`, `urlBase()`.
- Autenticação: `Auth::atendente($req)`, `Auth::admin($req)`,
  `Auth::atendenteDeArquivo($req)` (aceita `?token=`). Devolvem a linha do
  atendente já tipada. Saída de atendente: SEMPRE `Atendentes::saida($linha)`
  (nunca expõe `senha_hash`).

## Banco

- Conexão: `Banco::conexao()` (PDO) — mas prefira os atalhos:
  `Banco::um($sql, $p)`, `todos`, `valor`, `executar` (linhas afetadas),
  `inserir($tabela, $dados)` (devolve id), `atualizar($tabela, $dados, 'id = ?', [$id])`,
  `transacao(fn () => ...)` (aninhável; rollback em exceção).
- SEMPRE parâmetros. SQL portável entre MySQL e SQLite: nada de `INSERT OR
  IGNORE`, `ON DUPLICATE KEY`, `RETURNING`, `ILIKE`, funções de data. Datas
  são calculadas no PHP e comparadas como texto.
- Tipos na leitura variam por driver: converta sempre (`(int)`, `(bool)`) ao
  montar a saída.
- Arrays/objetos em `inserir/atualizar` viram JSON (colunas `credenciais`,
  `metadados`, `assinatura`). Para ler: `Json::ler($linha['credenciais'], [])`.
  Para devolver `{}` vazio na API: `Json::objeto($array)`.
- Datas: grave `Datas::agoraBanco()` (UTC, `Y-m-d H:i:s.u`); devolva
  `Datas::iso($linha['criada_em'])` → `"2026-09-23T15:44:48.123456Z"` (idêntico
  ao pydantic; sem fração quando zero). Janela: `Datas::haHoras(24)`.
- Unicidade violada: `catch (\PDOException $e) { if (Banco::eUnicidade($e)) ... }`.
- Colunas limitadas (ex.: `conversas.previa` VARCHAR(200)): o MySQL em modo
  estrito recusa texto maior; corte antes (`Texto::resumir`).

### Esquema e migrações

As tabelas são as de `app/models.py` com os mesmos nomes (um SQLite criado aqui
abre no Python), mais `atendentes.setor`, `mensagens.assinatura` (JSON
`{"nome", "setor"}` gravado no envio) e `fila_eventos`. Para mudar o esquema,
crie `app/Banco/Migracoes/M<AAAAMMDD>_<HHMM>_<Descricao>.php` implementando
`Migracao` (use os marcadores `{ID}`, `{DATA}`, `{BOOL}`, `{TEXTO}`, `{JSON}`,
`{BIN}` e os ajudantes `criarTabela`, `criarIndice`, `adicionarColuna`, que são
idempotentes). Nunca edite migração publicada. O esquema é conferido a cada
requisição por uma marca em `dados/esquema.ok` (barato) e aplicado sob trava
quando aparece migração nova; `php console.php esquema` força.

## Tempo real (eventos por consulta)

A hospedagem não segura conexão longa. Cada evento é uma linha em
`fila_eventos`; o painel consulta a cada ~2 s:

```php
Banco::transacao(function () use (...) {
    // ... grava a mensagem ...
    Eventos::publicar('mensagem.nova', $mensagemSaida, $contatoId);
    Eventos::publicar('conversa.atualizada', $conversaSaida, $contatoId);
});
```

- Tipos e `dados` iguais aos do SSE do Python (`mensagem.nova`,
  `mensagem.status`, `conversa.atualizada`, ...; `dados` = MensagemSaida /
  ConversaSaida). Passe o `contato_id` dono do evento: é por ele que o widget filtra.
- Publique DENTRO da transação do dado (evento e dado entram juntos).
- `GET /api/eventos/desde?depois=<id>&limite=<n>` (token por cabeçalho ou
  `?token=`) → `{"eventos": [{"id","tipo","dados"}], "ultimo": <id>}`. Sem
  `depois`: só o cursor atual. Lacuna recente de id (transação ainda aberta no
  MySQL) segura o cursor por até 3 s, para não perder evento.
- Widget: `Eventos::desdeDoVisitante($depois, $contatoId, $limite)` já filtra
  (só `mensagem.nova` de saída do próprio contato, sem nota interna); a rota
  `GET /api/widget/eventos/desde?depois=&token=<sessão>` usa
  `Eventos\Rotas::cursor($req)` para ler os parâmetros.
- Retenção de 48 h: poda oportunista na publicação e tarefa `PodarEventos`.
- `GET /saude` responde `"eventos": "consulta"` (o Python responde `"stream"`).

## Provedores externos (HTTP)

Adaptadores falam com Meta/Telegram/etc. só por `Nucleo\Http\Cliente::pedir()`
(opções `json`, `form`, `multipart`, `corpo`, `cabecalhos`, `query`, `timeout`,
`auth`). Falha de rede lança `ErroTransporte`; status de erro não lança
(confira `$r->ok()`, `$r->json()`). Em teste, `Cliente::definirTransporte()`
troca o transporte.

**Provedor falso da suíte de contrato**: com `OMNI_TESTE_PROVEDOR=<arquivo.json>`
E `modo_sandbox` ligado, as chamadas vão para `TransporteRoteirado`:

```json
{"respostas": [
  {"metodo": "POST", "url_contem": "api.telegram.org", "status": 200, "json": {"ok": true}},
  {"url_contem": "graph.facebook.com/v", "corpo_base64": "iVBOR...", "cabecalhos": {"Content-Type": "image/png"}},
  {"url_contem": "lento.example", "erro_rede": "timeout"}
]}
```

Primeira regra que casar responde (`metodo`/`url_contem` opcionais; corpo por
`json`, `corpo` ou `corpo_base64`); sem regra, 404 `{"erro": ...}`. Cada chamada
é anotada em `<arquivo>.chamadas.jsonl` (`metodo`, `url`, `cabecalhos` em
minúsculas, `corpo`, `corpo_base64`). O app Python precisa aceitar o mesmo
arquivo em `app/canais/http.py`.

## Tarefas periódicas

Classe em `app/Tarefas/<Nome>.php` com `public const INTERVALO = <s>` e
`public static function executar(): string`. O `cron.php` (chamado a cada
minuto) respeita o intervalo, impede sobreposição com trava e registra erros
no log. `php cron.php <Nome>` roda uma tarefa na hora.

## Segurança (checklist de toda rota)

- consultas parametrizadas; nomes de tabela/coluna nunca do usuário;
- segredo (senha, token de provedor, app secret) nunca volta ao navegador;
- `password_hash` para senhas; `hash_equals` para token/assinatura;
- uploads guardados em `pasta_dados` e servidos pela API
  (`Resposta::arquivo`, que força download e `CSP: sandbox` em HTML/SVG);
- CORS só em `/api/widget/*` e `/widget.js`; o painel ganha
  `frame-ancestors 'self'`; toda resposta leva `nosniff`; `/api/*` sai com
  `Cache-Control: no-store`;
- erro inesperado vira 500 `{"detail": "erro interno do servidor"}` e o
  detalhe vai para `dados/logs/` (nunca para a resposta).

## Testes

- Unidade (PHP): `php php/tests/rodar.php` (arquivos `*Teste.php` devolvem
  `['nome' => fn () => ...]`; cada teste recebe SQLite em memória novo;
  aviso ou depreciação do PHP é falha).
- Contrato (HTTP, os dois servidores): em `omnichannel/`,
  `../.venv/bin/python -m pytest contrato -q` (Python) e
  `OMNI_CONTRATO_ALVO=php ../.venv/bin/python -m pytest contrato -q` (PHP).
  Ver `contrato/conftest.py` para fixtures (`cliente`, `cabecalho_admin`,
  `cabecalho_atendente`, `login_admin`, `canal_webchat`/`_whatsapp`/
  `_telegram`/`_email`, `provedor`) e `contrato/utilitarios.py`
  (`exigir_rota`, `unico`, `token_forjado`, `data_com_fuso`, `criar_canal`).
- Desenvolvimento: `../.venv/bin/python scripts/rodar_php_local.py` sobe o PHP
  em http://127.0.0.1:8601 com SQLite e dados de exemplo.
