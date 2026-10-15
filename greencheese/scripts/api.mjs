// npm run api: sobe a API de desenvolvimento (php -S + scripts/api-dev.php) em http://127.0.0.1:8090.
// Porta: GC_API_PORTA (o Vite lê a mesma variável pra repassar /api e /uploads). Dados em .dados-dev/ (GC_DADOS e
// GC_UPLOADS trocam). Precisa do PHP 8.1+ com pdo_sqlite (gd e fileinfo para o envio de imagem).
// Código de instalação de desenvolvimento: dev-instalar-greencheese.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const raiz = fileURLToPath(new URL('..', import.meta.url))
const porta = process.env.GC_API_PORTA ?? '8090'
const env = {
  // mais de um pedido ao mesmo tempo (o diagnóstico do painel pede a própria API pela web)
  PHP_CLI_SERVER_WORKERS: '4',
  GC_DADOS: join(raiz, '.dados-dev'),
  GC_UPLOADS: join(raiz, '.dados-dev', 'uploads'),
  ...process.env,
}
const args = [
  '-d', 'display_errors=0',
  '-d', 'upload_max_filesize=8M',
  '-d', 'post_max_size=10M',
  '-S', `127.0.0.1:${porta}`,
  '-t', join(raiz, 'public'),
  join(raiz, 'scripts', 'api-dev.php'),
]
// grupo próprio (fora do Windows): ao sair, o pai e os workers do php -S saem juntos
const grupo = process.platform !== 'win32'
const php = spawn(process.env.PHP ?? 'php', args, { cwd: raiz, env, stdio: 'inherit', detached: grupo })
php.on('error', (e) => {
  console.error(e.code === 'ENOENT' ? 'PHP não encontrado: instale o PHP 8.1+ (ou aponte PHP=/caminho/do/php).' : e.message)
  process.exit(1)
})
console.log(`API de dev em http://127.0.0.1:${porta}/api/index.php?r=rateios · dados em ${env.GC_DADOS}`)
console.log('o Vite (npm run dev / npm run preview) repassa /api e /uploads pra cá · código de instalação: dev-instalar-greencheese')
function parar(sinal) {
  try {
    if (grupo) process.kill(-php.pid, sinal)
    else php.kill(sinal)
  } catch {
    /* já saiu */
  }
}
for (const sinal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sinal, () => parar(sinal))
php.on('exit', (codigo) => process.exit(codigo ?? 0))
