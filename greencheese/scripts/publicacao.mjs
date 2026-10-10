// O que o publicar.mjs (pela API da Hostinger) e o empacotar.mjs (zip pra publicar à mão) dividem: a lista de
// arquivos do build, o que nunca sai daqui (banco, log, envios), a ordem de subida e a recusa do código de
// instalação de desenvolvimento.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/** Hash do código de desenvolvimento ("dev-instalar-greencheese") que vem no repositório (público, como o código). */
export const HASH_DEV = '$2y$11$8QwjE.8.tGP3ZAMJzPiX1u73rD6ewa1ZARkzACWdGCY97Ts8NYKjq'
// o código como o servidor compara (só letras e números minúsculos)
const CODIGO_DEV = 'devinstalargreencheese'

export function listar(dir) {
  return readdirSync(dir).flatMap((n) => {
    const c = join(dir, n)
    return statSync(c).isDirectory() ? listar(c) : [c]
  })
}

/** Caminho relativo ao build, sempre com "/". */
export const relativo = (dist, f) => relative(dist, f).split('\\').join('/')

// O que nunca sobe: dados do servidor (banco, log) e envios do painel. De api/privado/ só o .htaccess e o index.html
// vazio; de uploads/, só o .htaccess. Banco, diário do SQLite e log também não sobem de nenhuma outra pasta. (O Vite
// copia public/ inteiro pro build: um banco ou uma foto esquecidos em public/ iriam junto.)
export function foraDaPublicacao(r) {
  if (r.startsWith('api/privado/')) return !['api/privado/.htaccess', 'api/privado/index.html'].includes(r)
  if (r.startsWith('uploads/')) return r !== 'uploads/.htaccess'
  return /\.(sqlite|sqlite-wal|sqlite-shm|sqlite-journal|db|log)(\.\d+)?$/i.test(r) || /(^|\/)\.envio-/.test(r)
}

// Ordem: .htaccess de todas as pastas primeiro (nada fica aberto nem um instante), depois a API (módulos antes do
// index.php), os assets, o resto, o painel e, por último, os index.html (nunca fica um index apontando para
// arquivo que ainda não subiu; o do site é o último de todos).
export function peso(r) {
  if (r.endsWith('.htaccess')) return 0
  if (r.startsWith('api/')) return r === 'api/index.php' ? 2 : 1
  if (r.startsWith('assets/')) return 3
  if (r.startsWith('painel/')) return r.endsWith('index.html') ? 6 : 5
  if (r === 'index.html') return 8
  if (r.endsWith('index.html')) return 7
  return 4
}

export const ordenar = (lista) => [...lista].sort((a, b) => peso(a) - peso(b) || (a < b ? -1 : a > b ? 1 : 0))

/**
 * O api/instalacao.php do build ainda é o de desenvolvimento? Com ele, qualquer um que leu o repositório instalaria o
 * painel no ar. Confere a marca "// DEV", o hash conhecido e, com o PHP, o próprio código (um hash novo do mesmo
 * código de dev também é pego): apagar o comentário não adianta. O servidor no ar confere de novo pelo hash.
 * @returns {string | null} o motivo da recusa, ou null (código de verdade, ou build sem a API)
 */
export function instalacaoDeDev(dist) {
  const arq = join(dist, 'api', 'instalacao.php')
  if (!existsSync(arq)) return null
  const txt = readFileSync(arq, 'utf8')
  if (/^\/\/ DEV/m.test(txt)) return 'ainda tem o hash de desenvolvimento (marcado // DEV)'
  const hash = /^return '(\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53})';/m.exec(txt)?.[1]
  if (!hash) return 'está sem o hash do código de instalação'
  if (hash === HASH_DEV) return 'ainda tem o hash de desenvolvimento (sem a marca // DEV, mas é o mesmo hash)'
  try {
    const r = execFileSync(process.env.PHP ?? 'php', ['-r', 'echo password_verify($argv[1], $argv[2]) ? "dev" : "ok";', CODIGO_DEV, hash], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    if (r === 'dev') return 'ainda tem um hash do código de desenvolvimento (dev-instalar-greencheese)'
  } catch {
    // sem PHP aqui: valeram a marca e o hash conhecido
  }
  return null
}
