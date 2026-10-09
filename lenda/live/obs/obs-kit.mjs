#!/usr/bin/env node
/**
 * Kit do OBS do LENDA: põe o perfil e a coleção de cenas do LENDA no OBS Studio e prepara cada live.
 * Quem chama são os .bat da pasta live (Windows):
 *
 *   node live/obs/obs-kit.mjs instalar       INSTALAR-OBS.bat: copia o perfil "LENDA" (pasta live/obs/LENDA) e a
 *                                            coleção de cenas "LENDA Live" para o OBS, com cópia do que já existia
 *   node live/obs/obs-kit.mjs preparar       LIVE-OBS.bat: OBS fechado, @ da live, URL do servidor e chave de
 *                                            transmissão do TikTok, começar a transmitir sozinho ou não
 *   node live/obs/obs-kit.mjs usuario        escreve o @ salvo (o LIVE-OBS.bat passa para a ponte: --usuario)
 *   node live/obs/obs-kit.mjs ponte-aberta   sai com 0 quando já tem uma ponte na porta 5178
 *   node live/obs/obs-kit.mjs abrir-obs      espera a ponte servir /obs e abre o OBS no perfil e na cena do LENDA
 *
 *   preparar e abrir-obs aceitam --demo: sem @, sem chave e sem transmitir (o público de teste da ponte).
 *
 * A chave de transmissão é segredo (quem tem a chave transmite na sua conta). Ela só é gravada no service.json
 * do perfil LENDA do OBS, o arquivo onde o próprio OBS guarda a chave; nunca aparece inteira na tela e não vai
 * para a pasta do LENDA. O lenda/.cache/obs-launcher.cfg guarda só o @, a escolha de transmitir sozinho e onde
 * o OBS está (quando foi preciso mostrar).
 *
 * Formatos conferidos no código do OBS 30.2, 31.1, 32.2 e 33 (pré-lançamento):
 *   - perfil = pasta em basic/profiles com basic.ini (nome em [General] Name); a chave fica no service.json;
 *   - coleção de cenas = qualquer .json em basic/scenes (nome no campo "name");
 *   - o OBS só lê perfis e coleções quando abre e regrava tudo quando fecha: por isso ele precisa estar fechado;
 *   - a pasta é %APPDATA%\obs-studio, ou <OBS>\config\obs-studio no modo portátil, e no OBS 31+ o
 *     [Locations] do global.ini pode mudar onde ficam perfis e cenas.
 */
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import http from 'node:http'
import readline from 'node:readline'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const WIN = process.platform === 'win32'

const PROFILE = 'LENDA'
const COLLECTION = 'LENDA Live'
const SCENE = 'LENDA Live'
/** O nome que o próprio OBS daria ao arquivo da coleção "LENDA Live" (espaço vira _). */
const COLLECTION_FILE = 'LENDA_Live.json'
const KIT_COLLECTION = path.join(HERE, 'LENDA Live.json')
const KIT_PROFILE = path.join(HERE, PROFILE)
/**
 * A fonte de navegador do OBS (LENDA Live.json) aponta para http://localhost:5178/obs. LENDA_LIVE_PORT (a
 * mesma variável da ponte) muda a porta, e aí o endereço da fonte precisa mudar junto.
 */
const DEFAULT_PORT = 5178
const PORT = Number(process.env.LENDA_LIVE_PORT) || DEFAULT_PORT
const CFG_FILE = path.join(ROOT, '.cache', 'obs-launcher.cfg')
const OBS_DOWNLOAD = 'https://obsproject.com/pt-br/download'
/** O OBS no modo portátil: um destes arquivos na pasta dele (frontend/obs-main.cpp). */
const PORTABLE_FLAGS = ['portable_mode', 'obs_portable_mode', 'portable_mode.txt', 'obs_portable_mode.txt']

// ───────────────────────── tela e teclado ─────────────────────────
const say = (...lines) => console.log(lines.map((l) => (l ? `  ${l}` : '')).join('\n'))
const ok = (t) => console.log(`\n  ✔ ${t}`)
const warn = (t) => console.log(`\n  ⚠ ${t}`)
const fail = (t) => console.log(`\n  ✖ ${t}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function title(t) {
  console.log(['', `  ┌${'─'.repeat(58)}┐`, `  │${`  LENDA · ${t}`.padEnd(58)}│`, `  └${'─'.repeat(58)}┘`].join('\n'))
}

/** Limpa a janela (a chave de transmissão não fica na tela depois de colada). */
function clearScreen() {
  if (process.stdout.isTTY) console.clear()
}

class Cancelado extends Error {}

/**
 * Linhas do teclado no modo normal do console: o Windows cuida da edição, e colar (Ctrl+V ou botão direito
 * do mouse) funciona como no Prompt de Comando.
 */
let rl = null
let inputClosed = false
const queued = []
const waiting = []
function nextLine() {
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, terminal: false })
    rl.on('line', (l) => (waiting.length ? waiting.shift()(l) : queued.push(l)))
    rl.on('close', () => {
      inputClosed = true
      while (waiting.length) waiting.shift()(null)
    })
  }
  if (queued.length) return Promise.resolve(queued.shift())
  if (inputClosed) return Promise.resolve(null)
  return new Promise((resolve) => waiting.push(resolve))
}

async function ask(question) {
  process.stdout.write(question)
  const line = await nextLine()
  if (line == null) {
    process.stdout.write('\n')
    throw new Cancelado()
  }
  return line.replace(/^\uFEFF/, '').trim()
}

async function askYesNo(question, byDefault) {
  for (;;) {
    const a = (await ask(question)).toLowerCase()
    if (!a) return byDefault
    if (/^(s|sim|y|yes)$/.test(a)) return true
    if (/^(n|nao|não|no)$/.test(a)) return false
    say('Responda s (sim) ou n (não).')
  }
}

/** Tira as aspas que o Windows põe ao arrastar um arquivo para a janela. */
const unquote = (s) => String(s ?? '').trim().replace(/^"+|"+$/g, '').trim()

// ───────────────────────── arquivos ─────────────────────────
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    return null
  }
}

/** O OBS grava "\" como "\\" e quebras de linha como \n nos .ini (libobs/util/config-file.c). */
const unescapeIni = (v) => v.replace(/\\(\\|n|r)/g, (_, c) => (c === 'n' ? '\n' : c === 'r' ? '\r' : '\\'))

/** .ini do OBS → { Seção: { Chave: valor } } (null se não existe). */
function readIni(file) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
  const out = {}
  let section = null
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/)) {
    const line = raw.trim()
    if (!line || line[0] === '#' || line[0] === ';') continue
    const head = /^\[(.+)\]$/.exec(line)
    if (head) {
      section = out[head[1]] ??= {}
      continue
    }
    const eq = line.indexOf('=')
    if (section && eq > 0) section[line.slice(0, eq).trim()] = unescapeIni(line.slice(eq + 1))
  }
  return out
}

const exists = (p) => {
  try {
    fs.statSync(p)
    return true
  } catch {
    return false
  }
}

/** Grava por um arquivo temporário: um erro no meio nunca deixa o OBS com meio arquivo. */
function writeFileSafe(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.lenda-tmp`
  fs.writeFileSync(tmp, data)
  fs.renameSync(tmp, file)
}

/** Move arquivo ou pasta (também de um disco para outro). */
function moveTo(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  try {
    fs.renameSync(src, dst)
  } catch (err) {
    if (err?.code !== 'EXDEV') throw err
    fs.cpSync(src, dst, { recursive: true })
    fs.rmSync(src, { recursive: true, force: true })
  }
}

const samePath = (a, b) => (WIN ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b))

function sameContent(file, buf) {
  try {
    return fs.readFileSync(file).equals(buf)
  } catch {
    return false
  }
}

/** 2026-10-09_19-58-03 (hora local). */
function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}

// ───────────────────────── escolhas salvas (sem segredos) ─────────────────────────
/**
 * "@MeuPerfil", " meuperfil ", "https://www.tiktok.com/@MeuPerfil/live" → "meuperfil" (igual à ponte:
 * o @ do TikTok é sempre minúsculo).
 */
function normUser(u) {
  const s = String(u ?? '').trim()
  const link = s.match(/tiktok\.com\/@([^/?#\s]+)/i)
  return (link ? link[1] : s).replace(/^@+/, '').replace(/\s+/g, '').toLowerCase()
}
const validUser = (u) => /^[a-z0-9._]{1,40}$/.test(u)

function readCfg() {
  const cfg = { usuario: '', transmitir: false, obs: '' }
  let text = ''
  try {
    text = fs.readFileSync(CFG_FILE, 'utf8')
  } catch {
    return cfg
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([a-z]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (!m) continue
    if (m[1] === 'usuario') cfg.usuario = validUser(normUser(m[2])) ? normUser(m[2]) : ''
    else if (m[1] === 'transmitir') cfg.transmitir = /^(s|sim|1|true)$/i.test(m[2])
    else if (m[1] === 'obs') cfg.obs = m[2]
  }
  return cfg
}

function writeCfg(cfg) {
  const lines = [
    '# LENDA - escolhas do LIVE-OBS.bat. Sem segredos: a chave de transmissao fica so no OBS.',
    `usuario=${cfg.usuario}`,
    `transmitir=${cfg.transmitir ? 's' : 'n'}`,
    ...(cfg.obs ? [`obs=${cfg.obs}`] : []),
    '',
  ]
  writeFileSafe(CFG_FILE, lines.join('\r\n'))
}

// ───────────────────────── onde está o OBS ─────────────────────────
/** Instalação do OBS a partir de qualquer pedaço do caminho: a pasta, a bin\64bit ou o obs64.exe. */
function obsAt(p) {
  // o DisplayIcon do registro vem como "…\obs64.exe,0"
  let s = unquote(p).replace(/,\s*-?\d+$/, '')
  if (!s) return null
  if (/\.exe$/i.test(s)) s = path.dirname(s)
  if (/[\\/]bin[\\/]64bit[\\/]?$/i.test(s)) s = path.resolve(s, '..', '..')
  const exe = path.join(s, 'bin', '64bit', 'obs64.exe')
  try {
    return fs.statSync(exe).isFile() ? { root: path.resolve(s), exe } : null
  } catch {
    return null
  }
}

function regValue(key, name, view) {
  const r = spawnSync('reg', ['query', key, ...(name ? ['/v', name] : ['/ve']), view], { encoding: 'utf8', windowsHide: true })
  if (r.error || r.status !== 0 || !r.stdout) return ''
  const m = /REG_(?:EXPAND_)?SZ[ \t]+(.+?)[ \t]*$/m.exec(r.stdout)
  return m ? m[1] : ''
}

/** Bibliotecas da Steam (o OBS da Steam pode estar em outro disco). */
function steamPlaces() {
  const steams = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles].filter(Boolean).map((p) => path.join(p, 'Steam'))
  const libs = new Set(steams)
  for (const s of steams) {
    let vdf = ''
    try {
      vdf = fs.readFileSync(path.join(s, 'steamapps', 'libraryfolders.vdf'), 'utf8')
    } catch {
      continue
    }
    for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libs.add(m[1].replace(/\\\\/g, '\\'))
  }
  return [...libs].map((l) => path.join(l, 'steamapps', 'common', 'OBS Studio'))
}

/** Procura o OBS: LENDA_OBS, o lugar salvo, o registro do instalador, as pastas padrão e a Steam. */
function findObs(cfg) {
  const tries = [() => process.env.LENDA_OBS, () => cfg.obs]
  if (WIN) {
    for (const view of ['/reg:64', '/reg:32']) {
      tries.push(() => regValue('HKLM\\SOFTWARE\\OBS Studio', '', view))
      tries.push(() => regValue('HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\OBS Studio', 'DisplayIcon', view))
    }
    for (const base of [process.env.ProgramW6432, process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) if (base) tries.push(() => path.join(base, 'obs-studio'))
    if (process.env.USERPROFILE) tries.push(() => path.join(process.env.USERPROFILE, 'scoop', 'apps', 'obs-studio', 'current'))
    tries.push(...steamPlaces().map((p) => () => p))
  }
  for (const t of tries) {
    const found = obsAt(t())
    if (found) return found
  }
  return null
}

/** Destino de um atalho .lnk (arrastar o atalho da Área de Trabalho também vale). */
function shortcutTarget(p) {
  const s = unquote(p)
  if (!WIN || !/\.lnk$/i.test(s)) return ''
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', '(New-Object -ComObject WScript.Shell).CreateShortcut($env:LENDA_ATALHO).TargetPath'], {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, LENDA_ATALHO: s },
  })
  return r.status === 0 ? r.stdout.trim() : ''
}

async function findObsAsking(cfg) {
  const found = findObs(cfg)
  if (found) {
    say('', `OBS Studio: ${found.root}`)
    return found
  }
  fail('Não achei o OBS Studio neste computador.')
  say('', `Ainda não tem? Baixe em ${OBS_DOWNLOAD}, instale, abra uma vez e feche.`, 'Já tem? Arraste para esta janela o obs64.exe (ou o atalho do OBS da Área de Trabalho) e aperte Enter.', 'Para sair, só aperte Enter.')
  for (;;) {
    const a = await ask('  > ')
    if (!a) return null
    const o = obsAt(shortcutTarget(a) || a)
    if (o) {
      cfg.obs = o.root
      writeCfg(cfg)
      ok(`Achei: ${o.root} (fica salvo para as próximas vezes).`)
      return o
    }
    say('Não achei o obs64.exe nesse lugar. Tente de novo, ou aperte Enter para sair.')
  }
}

/** O OBS está aberto? (null: não deu para saber) */
function obsRunning() {
  if (!WIN) return false
  const r = spawnSync('tasklist', ['/FI', 'IMAGENAME eq obs64.exe', '/NH', '/FO', 'CSV'], { encoding: 'utf8', windowsHide: true })
  if (r.error || r.status !== 0) return null
  return /"obs64\.exe"/i.test(r.stdout)
}

async function waitObsClosed(why) {
  while (obsRunning()) {
    warn('O OBS está aberto. Feche o OBS: menu Arquivo > Encerrar OBS. Se ele estiver só no ícone perto')
    say('do relógio, clique nele com o botão direito e escolha Encerrar OBS.', why)
    await ask('  Depois de fechar, aperte Enter aqui. ')
  }
}

/** As pastas de configuração que o OBS usa (OBSApp.cpp: GetAppConfigPath, [Locations]). */
function obsPaths(obs) {
  const portable = !!obs && PORTABLE_FLAGS.some((f) => exists(path.join(obs.root, f)))
  const appConfig = portable ? path.join(obs.root, 'config') : process.env.APPDATA
  if (!appConfig) return null
  const globalIni = path.join(appConfig, 'obs-studio', 'global.ini')
  const global = readIni(globalIni) ?? {}
  // OBS 31+: [Locations] em global.ini muda onde ficam perfis e cenas (a pasta precisa existir; no modo
  // portátil o OBS ignora)
  const place = (key) => {
    const v = portable ? '' : global.Locations?.[key]
    return v && exists(v) ? v : appConfig
  }
  return {
    portable,
    base: path.join(appConfig, 'obs-studio'),
    global,
    userIni: path.join(place('Configuration'), 'obs-studio', 'user.ini'),
    profiles: path.join(place('Profiles'), 'obs-studio', 'basic', 'profiles'),
    scenes: path.join(place('SceneCollections'), 'obs-studio', 'basic', 'scenes'),
  }
}

/**
 * O OBS já abriu uma vez? Na primeira vez ele oferece o assistente de configuração, que trocaria a tela em
 * pé do perfil LENDA por uma deitada: só instalamos depois disso (FirstRun no user.ini do 31+ ou no
 * global.ini do 30; LastVersion no global.ini).
 */
function obsWasOpened(loc) {
  const yes = (v) => /^(true|1)$/i.test(String(v ?? ''))
  const user = readIni(loc.userIni) ?? {}
  return Boolean(loc.global.General?.LastVersion || yes(loc.global.General?.FirstRun) || yes(user.General?.FirstRun))
}

/** Pastas de perfil com esse nome ([General] Name, sem diferenciar maiúsculas, como o OBS 30). */
function profileDirs(loc, name) {
  let dirs = []
  try {
    dirs = fs.readdirSync(loc.profiles, { withFileTypes: true }).filter((d) => d.isDirectory())
  } catch {
    return []
  }
  return dirs
    .map((d) => path.join(loc.profiles, d.name))
    .filter((dir) => {
      const ini = readIni(path.join(dir, 'basic.ini'))
      return !!ini && (ini.General?.Name || path.basename(dir)).toLowerCase() === name.toLowerCase()
    })
}

/** Arquivos de coleção de cenas com esse nome (campo "name"; sem ele, o nome do arquivo). */
function collectionFiles(loc, name) {
  let files = []
  try {
    files = fs.readdirSync(loc.scenes, { withFileTypes: true }).filter((d) => d.isFile() && d.name.endsWith('.json'))
  } catch {
    return []
  }
  return files
    .map((d) => path.join(loc.scenes, d.name))
    .filter((f) => {
      const j = readJson(f)
      const n = (j && typeof j.name === 'string' && j.name) || path.basename(f, '.json')
      return n.toLowerCase() === name.toLowerCase()
    })
}

/** A pasta do perfil LENDA instalada (a padrão, se houver mais de uma). */
function lendaProfileDir(loc) {
  const dirs = profileDirs(loc, PROFILE)
  return dirs.find((d) => samePath(d, path.join(loc.profiles, PROFILE))) ?? dirs[0] ?? null
}

// ───────────────────────── servidor e chave (service.json do OBS) ─────────────────────────
const looksLikeServer = (s) => /^rtmps?:\/\/[^\s/]+/i.test(s)

/** Servidor e chave do service.json, quando valem (o modelo do kit vem sem). */
function streamOf(svc) {
  const st = svc?.type === 'rtmp_custom' && svc.settings && typeof svc.settings === 'object' ? svc.settings : {}
  const server = typeof st.server === 'string' && looksLikeServer(st.server.trim()) ? st.server.trim() : ''
  const key = typeof st.key === 'string' ? st.key.trim() : ''
  return { server, key, ok: !!server && !!key }
}

/** Só o fim da chave: o bastante para reconhecer, sem mostrar o segredo. */
const maskKey = (k) => (k.length > 8 ? `••••••••${k.slice(-4)}` : '••••') + ` (${k.length} caracteres)`

/** Muitas chaves do TikTok trazem a validade escrita: "…?expire=1760040000&sign=…" (segundos). */
function keyExpiry(key) {
  const m = /[?&]expire=(\d{10})(?:&|$)/.exec(key)
  return m ? new Date(Number(m[1]) * 1000) : null
}
const when = (d) => `${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} de ${d.toLocaleDateString('pt-BR')}`

function writeService(file, svc, server, key) {
  const old = svc && typeof svc === 'object' && !Array.isArray(svc) ? svc : {}
  const settings = old.type === 'rtmp_custom' && old.settings && typeof old.settings === 'object' ? old.settings : {}
  const next = { ...old, type: 'rtmp_custom', settings: { ...settings, server, key, use_auth: false, bwtest: false } }
  writeFileSafe(file, `${JSON.stringify(next, null, 4)}\n`)
}

// ───────────────────────── instalar ─────────────────────────
async function instalar() {
  title('Instalar no OBS')
  const cfg = readCfg()
  const obs = await findObsAsking(cfg)
  if (!obs) {
    say('', 'Nada mudou. Instale o OBS e abra o INSTALAR-OBS.bat de novo.')
    return 1
  }
  await waitObsClosed('O OBS regrava o perfil e as cenas quando fecha; com ele aberto, a instalação se perderia.')
  const loc = obsPaths(obs)
  if (!loc) {
    fail('Não achei a pasta de configurações do Windows (%APPDATA%).')
    return 1
  }
  if (!obsWasOpened(loc)) {
    fail('O OBS ainda não foi aberto neste computador (neste usuário do Windows).')
    say('', 'Abra o OBS uma vez, feche ou responda o assistente de configuração e feche o OBS.', 'Depois abra o INSTALAR-OBS.bat de novo.')
    return 1
  }

  let kitCollection, kitIni, kitService
  try {
    kitCollection = fs.readFileSync(KIT_COLLECTION)
    kitIni = fs.readFileSync(path.join(KIT_PROFILE, 'basic.ini'))
    kitService = fs.readFileSync(path.join(KIT_PROFILE, 'service.json'))
    JSON.parse(kitCollection.toString('utf8'))
    JSON.parse(kitService.toString('utf8'))
  } catch {
    fail('Os arquivos do kit (pasta lenda\\live\\obs) estão faltando ou quebrados. Baixe o LENDA de novo.')
    return 1
  }

  const profileDir = path.join(loc.profiles, PROFILE)
  const iniPath = path.join(profileDir, 'basic.ini')
  const servicePath = path.join(profileDir, 'service.json')
  const collectionPath = path.join(loc.scenes, COLLECTION_FILE)
  // outro perfil/coleção com o mesmo nome em outro arquivo: o OBS usaria só um dos dois
  const otherProfiles = profileDirs(loc, PROFILE).filter((d) => !samePath(d, profileDir))
  const otherCollections = collectionFiles(loc, COLLECTION).filter((f) => !samePath(f, collectionPath))
  const hasIni = exists(iniPath)
  const hasCollection = exists(collectionPath)
  const duplicates = otherProfiles.length + otherCollections.length

  if (hasIni && hasCollection && !duplicates && sameContent(iniPath, kitIni) && sameContent(collectionPath, kitCollection)) {
    ok('O LENDA já está instalado no OBS, igual ao kit. Nada mudou.')
    nextStepsAfterInstall(loc, null)
    return 0
  }
  if (hasIni || hasCollection || duplicates) {
    say(
      '',
      'O OBS já tem o perfil "LENDA" e/ou a coleção de cenas "LENDA Live" (talvez com mudanças suas,',
      'como uma câmera). Instalar de novo volta para os originais do LENDA; o que existe hoje vai para',
      'uma cópia de segurança. O URL do servidor e a chave salvos pelo LIVE-OBS.bat continuam no perfil.',
    )
    if (!(await askYesNo('  Instalar de novo? (S/n) ', true))) {
      say('', 'Tudo bem: nada mudou.')
      return 0
    }
  }

  const backup = path.join(loc.base, 'lenda-copias', stamp())
  let backedUp = false
  const keep = (src, rel, move = false) => {
    const dst = path.join(backup, rel)
    if (move) moveTo(src, dst)
    else {
      fs.mkdirSync(path.dirname(dst), { recursive: true })
      fs.copyFileSync(src, dst)
    }
    backedUp = true
  }
  if (hasIni) keep(iniPath, path.join('perfil LENDA', 'basic.ini'))
  if (hasCollection) keep(collectionPath, path.join('cenas', COLLECTION_FILE))
  for (const f of otherCollections) keep(f, path.join('cenas', path.basename(f)), true)
  for (const d of otherProfiles) keep(d, path.join('perfis', path.basename(d)), true)

  writeFileSafe(iniPath, kitIni)
  // o service.json do perfil é onde o LIVE-OBS.bat guarda o servidor e a chave: fica como está (sem cópia —
  // a chave não se espalha). Outro tipo de serviço (Twitch, YouTube…) sai para a cópia de segurança.
  const svc = readJson(servicePath)
  if (svc?.type !== 'rtmp_custom') {
    if (exists(servicePath)) keep(servicePath, path.join('perfil LENDA', 'service.json'), true)
    writeFileSafe(servicePath, kitService)
  }
  writeFileSafe(collectionPath, kitCollection)

  ok('Pronto: o LENDA está instalado no OBS.')
  nextStepsAfterInstall(loc, backedUp ? backup : null)
  return 0
}

function nextStepsAfterInstall(loc, backup) {
  say(
    '',
    'O OBS ganhou:',
    `  • o perfil "${PROFILE}": tela em pé 1080×1920, transmite em 720×1280 a 30 quadros por segundo`,
    `  • a coleção de cenas "${COLLECTION}": a cena "${SCENE}" (o jogo) e a cena "Intervalo"`,
    `    (em ${loc.profiles} e ${loc.scenes})`,
  )
  if (backup) say(`Cópia de segurança do que existia antes: ${backup}`)
  say(
    '',
    'Em cada live, abra o live\\LIVE-OBS.bat: ele pede o URL do servidor e a chave de transmissão do',
    'TikTok, liga a ponte e abre o OBS já no perfil e na cena do LENDA.',
    'Para voltar às suas cenas de sempre no OBS, use os menus Perfil e Coleção de cenas.',
  )
}

// ───────────────────────── preparar a live ─────────────────────────
async function preparar(demo) {
  title(demo ? 'Live com OBS (demonstração)' : 'Live com OBS')
  const cfg = readCfg()
  const obs = await findObsAsking(cfg)
  if (!obs) {
    say('', 'Instale o OBS e rode o INSTALAR-OBS.bat antes do LIVE-OBS.bat.')
    return 1
  }
  const loc = obsPaths(obs)
  const profileDir = loc && lendaProfileDir(loc)
  if (!profileDir || !collectionFiles(loc, COLLECTION).length) {
    fail('O LENDA ainda não está instalado no OBS.')
    say('', 'Abra primeiro o live\\INSTALAR-OBS.bat (só uma vez) e depois o LIVE-OBS.bat de novo.')
    return 1
  }
  await waitObsClosed('O LIVE-OBS.bat abre ele de novo daqui a pouco, já no perfil e na cena do LENDA.')

  if (demo) {
    say('', 'Modo demonstração: a ponte gera um público de teste e o OBS abre sem transmitir.', 'Não precisa de @ nem de chave.')
    return 0
  }

  say(
    '',
    'Deixe aberta no navegador a página de transmissão do TikTok (tiktok.com no computador, botão',
    'LIVE / Go LIVE, que abre o LIVE Producer). É lá que aparecem o URL do servidor e a chave.',
  )

  // ── @ da live ──
  say('', `Seu @ do TikTok, igual ao link do perfil (tiktok.com/@seuperfil).`)
  for (;;) {
    const a = await ask(cfg.usuario ? `  Enter = @${cfg.usuario}  > ` : '  (Enter = pular: você conecta pelo painel)  > ')
    if (!a) break
    const u = normUser(a)
    if (validUser(u)) {
      cfg.usuario = u
      break
    }
    say('Esse @ não parece um perfil do TikTok: use só o que vem depois do @ no link do perfil.')
  }

  // ── servidor e chave ──
  const servicePath = path.join(profileDir, 'service.json')
  const svc = readJson(servicePath)
  const saved = streamOf(svc)
  let server = ''
  say('', '1/2  URL do servidor (Server URL). Começa com rtmp://')
  for (;;) {
    const a = unquote(await ask(saved.server ? `  Enter = ${saved.server}  > ` : '  > '))
    if (!a && saved.server) {
      server = saved.server
      break
    }
    if (!a) {
      say('', 'Sem o URL do servidor e a chave, o OBS abre só para você testar: ele não transmite.')
      if (await askYesNo('  Abrir o OBS assim mesmo? (s/N) ', false)) break
      say('', 'Então cole o URL do servidor:')
      continue
    }
    if (looksLikeServer(a)) {
      server = a
      break
    }
    say(/^\S+$/.test(a) && !a.includes('://') ? 'Isso parece a chave, não o URL do servidor. O URL começa com rtmp://' : 'Isso não parece o URL do servidor: ele começa com rtmp:// (ou rtmps://).')
  }

  let key = ''
  if (server) {
    clearScreen()
    title('Live com OBS')
    say(
      '',
      '2/2  Chave de transmissão (Stream Key)',
      'Cole com Ctrl+V ou com o botão direito do mouse e aperte Enter. A chave some da tela em seguida.',
      'Nunca mostre a chave na live: quem tem a chave transmite na sua conta.',
    )
    for (;;) {
      const a = unquote(await ask(saved.key ? `  Enter = continuar com a chave salva ${maskKey(saved.key)}  > ` : '  > '))
      if (!a && saved.key) {
        key = saved.key
        break
      }
      if (!a) {
        say('Cole a chave (ou feche esta janela para desistir).')
        continue
      }
      if (/^rtmps?:\/\//i.test(a)) {
        say('Isso é o URL do servidor. Agora cole a chave de transmissão.')
        continue
      }
      if (/\s/.test(a)) {
        say('A chave não tem espaços. Copie de novo pelo botão de copiar do TikTok.')
        continue
      }
      key = a
      break
    }
    clearScreen()
    title('Live com OBS')
    if (saved.key && key === saved.key && server !== saved.server) say('', 'Servidor novo com a chave antiga: confira se os dois são da mesma live.')
  }

  // ── começar a transmitir sozinho? ──
  let start = false
  const expiry = key ? keyExpiry(key) : null
  const expired = !!expiry && expiry.getTime() < Date.now()
  if (server && key) {
    if (expired) {
      warn(`Pelo que vem escrito na chave, ela venceu às ${when(expiry)}.`)
      say('Se o OBS não conseguir transmitir, copie uma chave nova no TikTok e abra o LIVE-OBS.bat de novo.')
    }
    say('', 'O OBS deve começar a transmitir sozinho assim que abrir?', 'Responda s se a página de transmissão do TikTok já está aberta esperando o sinal.')
    start = await askYesNo(`  (s/n, Enter = ${cfg.transmitir ? 's' : 'n'})  > `, cfg.transmitir)
    cfg.transmitir = start
  }

  // ── grava: a chave só no OBS; o resto no .cache do LENDA ──
  if (server && key && (server !== saved.server || key !== saved.key || svc?.type !== 'rtmp_custom')) writeService(servicePath, svc, server, key)
  writeCfg(cfg)

  ok('Tudo pronto para abrir o OBS:')
  say(
    `  @ da live:             ${cfg.usuario ? `@${cfg.usuario}` : '(conecte pelo painel)'}`,
    `  Servidor:              ${server || '(nenhum: o OBS abre só para testar)'}`,
    `  Chave:                 ${key ? maskKey(key) : '(nenhuma)'}${expiry && !expired ? `, vale até ${when(expiry)}` : expired ? ', VENCIDA' : ''}`,
    `  Transmitir sozinho:    ${server && key ? (start ? (expired ? 'não (a chave venceu)' : 'sim') : 'não') : 'não'}`,
    '',
    'O servidor e a chave ficam só no OBS (perfil LENDA, Configurações > Transmissão).',
  )
  return 0
}

// ───────────────────────── ponte ─────────────────────────
function portOpen(port, timeout = 1500) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port })
    const done = (v) => {
      s.destroy()
      resolve(v)
    }
    s.setTimeout(timeout, () => done(false))
    s.once('connect', () => done(true))
    s.once('error', () => done(false))
  })
}

/** Código HTTP da ponte nesse caminho (0: não respondeu). */
function probe(pathname, timeout = 3000) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: pathname, timeout }, (res) => {
      res.resume()
      resolve(res.statusCode ?? 0)
    })
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve(0))
  })
}

/**
 * Espera a ponte servir a página do OBS. A ponte reserva a porta e só então compila o jogo (enquanto compila,
 * não responde): quando /obs responde, o jogo está pronto. O OBS não tenta de novo uma página que falhou, por
 * isso ele só abre depois.
 */
async function waitBridge(maxMs = 15 * 60_000) {
  const t0 = Date.now()
  let note = t0
  for (;;) {
    const st = await probe('/obs')
    if (st >= 200 && st < 400) return 'ok'
    if (st === 404 && (await probe('/')) === 200) return 'antiga'
    if (Date.now() - t0 > maxMs) return 'demorou'
    if (Date.now() - note > 30_000) {
      note = Date.now()
      say(`… ainda esperando (${Math.round((Date.now() - t0) / 60_000)} min). Veja na janela preta da ponte ("LENDA - Live interativa") se apareceu algum erro.`)
    }
    await sleep(2000)
  }
}

// ───────────────────────── abrir o OBS ─────────────────────────
async function abrirObs(demo) {
  const cfg = readCfg()
  const obs = findObs(cfg)
  if (!obs) {
    fail('Não achei o OBS Studio. Abra o LIVE-OBS.bat de novo para indicar onde ele está.')
    return 1
  }
  say('', `Esperando a ponte ligar em http://localhost:${PORT} …`, 'Na primeira vez (e depois de atualizar o LENDA) ela instala e compila o jogo: pode levar alguns minutos.')
  const bridge = await waitBridge()
  if (bridge === 'antiga') {
    fail(`A ponte aberta na porta ${PORT} é de uma versão do LENDA sem a página do OBS.`)
    say('', 'Feche a janela preta da ponte, atualize o LENDA e abra o LIVE-OBS.bat de novo.')
    return 1
  }
  if (bridge !== 'ok') {
    fail(`A ponte não respondeu em http://localhost:${PORT}/obs.`)
    say('', 'Veja o erro na janela preta da ponte ("LENDA - Live interativa"), resolva e abra o LIVE-OBS.bat de novo.', 'O OBS não foi aberto: sem a ponte, a fonte do jogo ficaria preta.')
    return 1
  }
  ok('A ponte está no ar.')
  if (PORT !== DEFAULT_PORT) warn(`A ponte está na porta ${PORT} (LENDA_LIVE_PORT): no OBS, troque o URL da fonte "Jogo LENDA" para http://localhost:${PORT}/obs.`)

  const loc = obsPaths(obs)
  const profileDir = loc && lendaProfileDir(loc)
  const stream = streamOf(profileDir ? readJson(path.join(profileDir, 'service.json')) : null)
  const expiry = stream.key ? keyExpiry(stream.key) : null
  const startStreaming = !demo && cfg.transmitir && stream.ok && !(expiry && expiry.getTime() < Date.now())

  if (obsRunning()) {
    warn('O OBS já está aberto: não abri outro.')
    say(`Confira nele o perfil "${PROFILE}" (menu Perfil), a coleção "${COLLECTION}" (menu Coleção de cenas) e a cena "${SCENE}".`)
  } else {
    // o OBS acha os arquivos dele a partir da pasta bin\64bit: precisa abrir de dentro dela
    const args = ['--profile', PROFILE, '--collection', COLLECTION, '--scene', SCENE, ...(startStreaming ? ['--startstreaming'] : [])]
    const started = await new Promise((resolve) => {
      let child
      try {
        child = spawn(obs.exe, args, { cwd: path.dirname(obs.exe), detached: true, stdio: 'ignore' })
      } catch {
        return resolve(false)
      }
      child.once('spawn', () => {
        child.unref()
        resolve(true)
      })
      child.once('error', () => resolve(false))
    })
    if (!started) {
      fail(`Não consegui abrir o OBS (${obs.exe}).`)
      say('', `Abra o OBS você mesmo e escolha o perfil "${PROFILE}" (menu Perfil) e a coleção "${COLLECTION}" (menu Coleção de cenas).`)
      return 1
    }
    ok(startStreaming ? 'Abri o OBS no perfil e na cena do LENDA. Ele já começa a transmitir.' : 'Abri o OBS no perfil e na cena do LENDA.')
  }

  if (demo) {
    say(
      '',
      'Modo demonstração: nada vai para o TikTok. No painel da live, clique em "Iniciar modo live" e veja',
      'o público de teste jogar dentro do OBS. Para parar, feche a janela da ponte.',
    )
    return 0
  }
  say(
    '',
    'Agora:',
    '1. No painel da live (a janela do Chrome/Edge que a ponte abriu), confira o @ em "1. Conexão".',
    '   Não clique em "Abrir janela da live (9:16)": com o OBS, a live roda dentro do OBS.',
    '2. No OBS, a cena "LENDA Live" mostra "A live já vai começar!", e o painel mostra "Live pronta no OBS".',
    startStreaming ? '3. O OBS já está transmitindo (o botão mostra "Interromper transmissão").' : '3. No OBS, clique em "Iniciar transmissão".',
    '4. Na página de transmissão do TikTok, espere a prévia aparecer e, se a página pedir, clique para',
    '   entrar ao vivo (Go LIVE).',
    '5. No painel, clique em "Iniciar modo live" (ou "Continuar"): o jogo começa no OBS.',
    '',
    'Para terminar: "Parar" no painel, encerre a LIVE no TikTok e só então "Interromper transmissão" no OBS.',
  )
  return 0
}

// ───────────────────────── comandos ─────────────────────────
const [command, ...rest] = process.argv.slice(2)
const demo = rest.includes('--demo')
const commands = {
  instalar,
  preparar: () => preparar(demo),
  'abrir-obs': () => abrirObs(demo),
  usuario: () => {
    const u = readCfg().usuario
    if (u) console.log(u)
    return 0
  },
  'ponte-aberta': async () => ((await portOpen(PORT)) ? 0 : 1),
}

try {
  const run = commands[command]
  if (!run) {
    console.log(`\n  Uso: node live/obs/obs-kit.mjs ${Object.keys(commands).join(' | ')} [--demo]\n  (os .bat da pasta live chamam por você)\n`)
    process.exitCode = 2
  } else {
    process.exitCode = await run()
  }
} catch (err) {
  if (err instanceof Cancelado) {
    say('', 'Cancelado.')
  } else {
    // a mensagem de um erro de arquivo traz só o caminho, nunca o conteúdo (a chave)
    fail(`Algo deu errado: ${err?.message ?? err}`)
  }
  process.exitCode = 1
} finally {
  rl?.close()
}
