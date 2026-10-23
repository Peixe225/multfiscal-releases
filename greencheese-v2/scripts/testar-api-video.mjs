// Testes da thumb animada no servidor (rodam dentro do scripts/testar-api.mjs, com o dono já instalado): o envio de
// vídeo (admin-video-upload: MP4 e WebM de verdade, gerados com o ffmpeg quando ele existe; o MP4 em pedaços do
// navegador; o MOV do iPhone; o MP4 falso com PHP; o poliglota; o grande demais; o longo demais; sem sessão, sem CSRF,
// Origin de fora e o gerente sem a permissão), o produto com vídeo e capa (validação, GET loja com o ETag mudando,
// admin-loja, cópia do banco), a troca e o "tirar vídeo" limpando os arquivos que saíram de uso (e não o que outro
// ainda usa), o produto apagado levando os dele, o Range do /uploads/ e os três .htaccess de uploads iguais.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** ffmpeg instalado? (só pra gerar os vídeos de teste; o site e o servidor não usam) */
function temFfmpeg() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/** Caixa MP4: tamanho (32 bits) + nome + conteúdo. */
function caixa(tipo, dados) {
  const t = Buffer.alloc(8)
  t.writeUInt32BE(8 + dados.length)
  t.write(tipo, 4, 'latin1')
  return Buffer.concat([t, dados])
}

/** MP4 mínimo de mentira, mas bem formado (ftyp + moov com mvhd + mdat), pra quando não tem ffmpeg. */
export function mp4Montado(segundos = 2, marca = 'isom', tamanho = 4000) {
  const ftyp = caixa('ftyp', Buffer.concat([Buffer.from(marca, 'latin1'), Buffer.from([0, 0, 2, 0]), Buffer.from(`${marca}mp41`, 'latin1')]))
  const mvhd = Buffer.alloc(100)
  mvhd.writeUInt32BE(1000, 12)
  mvhd.writeUInt32BE(Math.round(segundos * 1000), 16)
  return Buffer.concat([ftyp, caixa('moov', caixa('mvhd', mvhd)), caixa('mdat', Buffer.alloc(tamanho, 7))])
}

/** WebM mínimo bem formado (cabeçalho EBML com DocType, Segment de tamanho desconhecido, Tracks e um Cluster). */
function webmMontado(doc = 'webm') {
  const d = Buffer.from(doc, 'latin1')
  const cab = Buffer.concat([Buffer.from([0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x80 | d.length]), d])
  return Buffer.concat([
    Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x80 | cab.length]), cab,
    Buffer.from([0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
    Buffer.from([0x15, 0x49, 0xa9, 0x66, 0x83, 0x2a, 0xd7, 0xb1]),
    Buffer.from([0x16, 0x54, 0xae, 0x6b, 0x80]),
    Buffer.from([0x1f, 0x43, 0xb6, 0x75, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
    Buffer.alloc(3000, 3),
  ])
}

/** Os vídeos de teste: os de verdade (ffmpeg) ou os montados à mão. */
function videosDeTeste(pasta) {
  mkdirSync(pasta, { recursive: true })
  const real = temFfmpeg()
  const sai = (nome) => join(pasta, nome)
  if (real) {
    const ff = (args) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args], { stdio: 'pipe' })
    const fonte = ['-f', 'lavfi', '-i', 'testsrc2=size=240x426:rate=24']
    ff([...fonte, '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', sai('a.mp4')])
    ff([...fonte, '-t', '2', '-c:v', 'libvpx', '-b:v', '300k', sai('a.webm')])
    // como o navegador grava (MediaRecorder): MP4 em pedaços, sem a duração no mvhd
    ff([...fonte, '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', sai('pedacos.mp4')])
    // o do iPhone: QuickTime (.mov), marca 'qt  '
    ff([...fonte, '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-f', 'mov', sai('iphone.mov')])
    ff(['-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=10', '-t', '12', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', sai('longo.mp4')])
    ff([...fonte, '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', sai('b.mp4')])
  } else {
    writeFileSync(sai('a.mp4'), mp4Montado(2))
    writeFileSync(sai('a.webm'), webmMontado())
    writeFileSync(sai('pedacos.mp4'), mp4Montado(0))
    writeFileSync(sai('iphone.mov'), mp4Montado(2, 'qt  '))
    writeFileSync(sai('longo.mp4'), mp4Montado(12))
    writeFileSync(sai('b.mp4'), mp4Montado(1, 'mp42'))
  }
  return { real, ler: (nome) => readFileSync(sai(nome)) }
}

export async function testarVideo(t) {
  const { ok, igual, erro, parte, dono, site, Cliente, base, raiz, PHP, tmp, uploads, png, crua, chaves } = t
  const v = videosDeTeste(join(tmp, 'videos'))
  const enviar = (buf, nome, tipo = 'video/mp4', cli = dono, opts = {}) => {
    const f = new FormData()
    f.append('video', new Blob([buf], { type: tipo }), nome)
    return cli.post('admin-video-upload', f, opts)
  }
  const imagem = async (cor = [200, 30, 40, 255]) => {
    const f = new FormData()
    f.append('imagem', new Blob([png(36, 64, cor)], { type: 'image/png' }), 'capa.png')
    return (await dono.post('admin-upload', f)).json.imagem
  }
  const noDisco = (caminho) => existsSync(join(uploads, caminho.replace(/^uploads\//, '')))
  const lojaPub = async () => site().get('loja')
  const prodPub = (r, id) => r.json.loja.produtos.find((p) => p.id === id)

  parte(`vídeo: envio (admin-video-upload)${v.real ? ', com vídeos do ffmpeg' : ', com vídeos montados (sem ffmpeg)'}`)
  const mp4 = await enviar(v.ler('a.mp4'), 'thumb.mp4')
  igual(mp4.status, 201, 'MP4 (H.264) enviado')
  igual(chaves(mp4.json), ['bytes', 'ok', 'segundos', 'tipo', 'video'], '{ video, tipo, bytes, segundos }')
  ok(/^uploads\/[0-9a-f]{24}\.mp4$/.test(mp4.json.video ?? ''), `nome aleatório .mp4 (${mp4.json.video})`)
  igual([mp4.json.tipo, mp4.json.bytes], ['video/mp4', v.ler('a.mp4').length], 'tipo pelo conteúdo e o tamanho')
  ok(Math.abs(mp4.json.segundos - 2) < 0.2, `a duração do mvhd (${mp4.json.segundos} s)`)
  ok(noDisco(mp4.json.video) && readFileSync(join(uploads, mp4.json.video.slice(8))).equals(v.ler('a.mp4')), 'o arquivo é o enviado, byte a byte (vídeo não é recodificado)')
  const webm = await enviar(v.ler('a.webm'), 'thumb.webm', 'video/webm')
  igual(webm.status, 201, 'WebM enviado')
  ok(/^uploads\/[0-9a-f]{24}\.webm$/.test(webm.json.video ?? '') && webm.json.tipo === 'video/webm', `vira .webm (${webm.json.video})`)
  const frag = await enviar(v.ler('pedacos.mp4'), 'gravado.mp4')
  igual([frag.status, frag.json?.tipo], [201, 'video/mp4'], 'MP4 em pedaços (como o MediaRecorder grava) entra')
  const mov = await enviar(v.ler('iphone.mov'), 'IMG_0001.MOV', 'video/quicktime')
  ok(mov.status === 201 && mov.json.video.endsWith('.mp4'), `MOV do iPhone (marca qt) entra como .mp4 (${mov.status} ${mov.json?.video})`)
  // o nome e o tipo que o navegador manda não valem: o WebM chamado de .mp4 sai .webm
  const trocado = await enviar(v.ler('a.webm'), 'mentira.mp4', 'video/mp4')
  ok(trocado.status === 201 && trocado.json.video.endsWith('.webm'), 'o tipo vem do conteúdo, não do nome')

  parte('vídeo: o que não entra')
  erro(await enviar(Buffer.from('<?php system($_GET["c"]); ?>\n'.repeat(20)), 'video.mp4'), 415, 'tipo-invalido', 'MP4 falso: um PHP com nome de .mp4')
  const comFtyp = Buffer.concat([mp4Montado(1).subarray(0, 24), Buffer.from('<?php echo "x"; ?>'.repeat(10))])
  erro(await enviar(comFtyp, 'cabeca.mp4'), 415, 'tipo-invalido', 'cabeçalho de MP4 e o resto PHP (caixas tortas)')
  erro(await enviar(Buffer.concat([v.ler('a.mp4'), Buffer.from('<?php system($_GET["c"]); ?>')]), 'poli.mp4'), 415, 'tipo-invalido', 'poliglota: MP4 de verdade com PHP colado no fim')
  // o poliglota caprichado: o PHP numa caixa "free" (o MP4 continua bem formado): a varredura pega
  const livre = (txt) => Buffer.concat([v.ler('a.mp4'), caixa('free', Buffer.from(txt))])
  erro(await enviar(livre('<?php system($_GET["c"]); ?>'), 'poli2.mp4'), 415, 'tipo-invalido', 'poliglota: PHP escondido numa caixa free')
  erro(await enviar(livre('<html><script>alert(1)</script></html>'), 'poli3.mp4'), 415, 'tipo-invalido', 'poliglota: página com script escondida numa caixa free')
  erro(await enviar(Buffer.concat([v.ler('a.webm'), Buffer.from('<!DOCTYPE html><body onload=alert(1)>')]), 'poli.webm', 'video/webm'), 415, 'tipo-invalido', 'poliglota: WebM com página no fim')
  erro(await enviar(webmMontado('matroska'), 'mkv.webm', 'video/webm'), 415, 'tipo-invalido', 'Matroska que não é WebM (DocType)')
  erro(await enviar(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypxxxx'), Buffer.alloc(12), caixa('mdat', Buffer.alloc(100))]), 'marca.mp4'), 415, 'tipo-invalido', 'ftyp com marca desconhecida')
  erro(await enviar(png(20, 20), 'foto.mp4'), 415, 'tipo-invalido', 'imagem com nome de vídeo')
  const grande = await enviar(mp4Montado(3, 'isom', 7 * 1048576), 'grande.mp4')
  erro(grande, 413, 'grande-demais', 'maior que 6 MB')
  igual(grande.json?.limite, 6 * 1048576, 'limite de 6 MB no erro')
  const longo = await enviar(v.ler('longo.mp4'), 'longo.mp4')
  erro(longo, 413, 'video-longo', 'vídeo de 12 s (a thumb tem até 6)')
  erro(await dono.post('admin-video-upload', new FormData()), 400, 'invalido', 'sem arquivo')
  erro(await enviar(v.ler('a.mp4'), 'a.mp4', 'video/mp4', new Cliente()), 401, 'sem-sessao', 'sem sessão')
  erro(await enviar(v.ler('a.mp4'), 'a.mp4', 'video/mp4', dono, { csrf: null }), 403, 'csrf', 'sem CSRF')
  erro(await enviar(v.ler('a.mp4'), 'a.mp4', 'video/mp4', dono, { origem: 'https://golpe.example' }), 403, 'origem', 'Origin de fora')
  erro(await dono.get('admin-video-upload'), 405, 'metodo', 'só POST')
  // o gerente sobe foto (permissão "imagens"), mas o vídeo é só de quem mexe no produto ("loja", o dono)
  {
    const g = await dono.post('admin-usuario-salvar', { novo: true, login: 'gerente.video', nome: 'Gerente Video', papel: 'gerente', ufs: ['mg'] })
    igual(g.status, 201, 'criou um gerente pra testar a permissão')
    const ger = new Cliente()
    await ger.post('admin-entrar', { login: 'gerente.video', senha: g.json.senhaProvisoria })
    igual((await ger.post('admin-senha', { atual: g.json.senhaProvisoria, nova: 'senha-do-gerente-video' })).status, 200, 'o gerente trocou a senha provisória')
    erro(await enviar(v.ler('a.mp4'), 'a.mp4', 'video/mp4', ger), 403, 'sem-permissao', 'gerente: vídeo é da permissão "loja"')
    const f = new FormData()
    f.append('imagem', new Blob([png(10, 10)], { type: 'image/png' }), 'a.png')
    igual((await ger.post('admin-upload', f)).status, 201, 'e a foto ele sobe (permissão "imagens", como antes)')
    erro(await ger.post('admin-produto-salvar', { id: 'seda-ocb-premium-slim', video: mp4.json.video }), 403, 'sem-permissao', 'nem põe vídeo no produto')
  }
  const ev = (await dono.get('admin-eventos')).json.eventos
  ok(ev.some((e) => e.acao === 'video-enviado' && e.texto === 'Enviou um vídeo (thumb animada)' && e.usuario === 'dono'), 'o envio na Atividade')

  parte('vídeo: o /uploads/ serve o vídeo (com Range)')
  {
    const g = await crua(`/${mp4.json.video}`)
    igual([g.status, g.headers.get('content-type'), g.headers.get('accept-ranges'), g.headers.get('x-content-type-options')], [200, 'video/mp4', 'bytes', 'nosniff'], 'MP4 abre como video/mp4')
    await g.arrayBuffer()
    const r = await fetch(`${base}/${mp4.json.video}`, { headers: { Range: 'bytes=0-99' } })
    const tam = v.ler('a.mp4').length
    igual([r.status, r.headers.get('content-range'), (await r.arrayBuffer()).byteLength], [206, `bytes 0-99/${tam}`, 100], 'Range: 206 com o pedaço pedido')
    const w = await crua(`/${webm.json.video}`)
    igual([w.status, w.headers.get('content-type')], [200, 'video/webm'], 'WebM abre como video/webm')
    await w.arrayBuffer()
    igual((await crua('/uploads/aaaaaaaaaaaa.mp4')).status, 404, 'vídeo que não existe: 404')
    igual((await crua('/uploads/thumb.mp4.php')).status, 403, '.php disfarçado: 403')
  }

  parte('vídeo: no produto (validação, GET loja, ETag)')
  const capa = await imagem()
  const r0 = await lojaPub()
  const etag0 = r0.headers.get('etag')
  ok(!('video' in prodPub(r0, 'seda-ocb-premium-slim')) && !('capa' in prodPub(r0, 'seda-ocb-premium-slim')), 'produto sem vídeo: os campos nem vão (o JSON de quem não tem fica igual)')
  erro(await dono.post('admin-produto-salvar', { id: 'seda-ocb-premium-slim', video: mp4.json.video }), 400, 'invalido', 'vídeo sem capa')
  igual((await dono.post('admin-produto-salvar', { id: 'seda-ocb-premium-slim', video: mp4.json.video })).json.campo, 'capa', 'o erro aponta a capa')
  erro(await dono.post('admin-produto-salvar', { id: 'seda-ocb-premium-slim', video: 'uploads/abcdef1234567890abcdef12.mp4', capa }), 400, 'invalido', 'vídeo que não existe')
  erro(await dono.post('admin-produto-salvar', { id: 'seda-ocb-premium-slim', video: capa, capa }), 400, 'invalido', 'imagem no lugar do vídeo')
  erro(await dono.post('admin-produto-salvar', { id: 'seda-ocb-premium-slim', video: '../api/privado/loja.sqlite', capa }), 400, 'invalido', 'caminho de fora')
  erro(await dono.post('admin-produto-salvar', { id: 'seda-ocb-premium-slim', video: mp4.json.video, capa: webm.json.video }), 400, 'invalido', 'vídeo no lugar da capa')
  const s1 = await dono.post('admin-produto-salvar', { id: 'seda-ocb-premium-slim', video: mp4.json.video, capa })
  igual(s1.status, 200, 'vídeo e capa salvos no produto')
  igual([s1.json.produto.video, s1.json.produto.capa], [mp4.json.video, capa], 'o produto do painel traz os dois')
  const r1 = await lojaPub()
  igual([prodPub(r1, 'seda-ocb-premium-slim').video, prodPub(r1, 'seda-ocb-premium-slim').capa], [mp4.json.video, capa], 'o GET loja (o site) leva o vídeo e a capa')
  ok(r1.headers.get('etag') !== etag0, 'o ETag mudou (o site pega a loja nova)')
  igual((await fetch(`${base}/api/index.php?r=loja`, { headers: { 'If-None-Match': etag0 } })).status, 200, 'com o ETag velho: 200 com a loja nova')
  igual((await fetch(`${base}/api/index.php?r=loja`, { headers: { 'If-None-Match': r1.headers.get('etag') } })).status, 304, 'com o novo: 304')
  const adm = (await dono.get('admin-loja')).json.loja.produtos.find((p) => p.id === 'seda-ocb-premium-slim')
  igual([adm.video, adm.capa], [mp4.json.video, capa], 'admin-loja também')
  // salvar de novo sem mudar nada não apaga nada
  igual((await dono.post('admin-produto-salvar', { id: 'seda-ocb-premium-slim', preco: 9.99 })).status, 200, 'editar outro campo mantém o vídeo')
  ok(noDisco(mp4.json.video) && noDisco(capa), 'os arquivos continuam lá')

  parte('vídeo: cópia do banco leva o vídeo e a capa')
  {
    const r = await fetch(`${base}/api/index.php?r=admin-backup`, { headers: { Cookie: `gc_painel=${dono.cookie}`, 'X-GC-IP': dono.ip } })
    igual(r.status, 200, 'cópia do banco')
    const arq = join(tmp, 'copia-video.sqlite')
    writeFileSync(arq, Buffer.from(await r.arrayBuffer()))
    const linha = JSON.parse(execFileSync(PHP, ['-r', '$d = new PDO("sqlite:" . $argv[1]); echo json_encode($d->query("SELECT video, capa FROM loja_produtos WHERE id = \'seda-ocb-premium-slim\'")->fetch(PDO::FETCH_ASSOC));', arq], { encoding: 'utf8' }))
    igual(linha, { video: mp4.json.video, capa }, 'a cópia tem as colunas e os valores')
  }

  parte('vídeo: trocar e tirar limpam os arquivos')
  {
    const capa2 = await imagem([30, 30, 200, 255])
    const s2 = await dono.post('admin-produto-salvar', { id: 'seda-ocb-premium-slim', video: webm.json.video, capa: capa2 })
    igual([s2.status, s2.json.produto.video], [200, webm.json.video], 'trocou o vídeo')
    ok(!noDisco(mp4.json.video) && !noDisco(capa), 'o vídeo e a capa de antes saíram da pasta')
    ok(noDisco(webm.json.video) && noDisco(capa2), 'os novos ficaram')
    const r2 = await lojaPub()
    igual(prodPub(r2, 'seda-ocb-premium-slim').video, webm.json.video, 'o site recebe o novo')
    const s3 = await dono.post('admin-produto-salvar', { id: 'seda-ocb-premium-slim', video: null, capa: null })
    igual([s3.status, s3.json.produto.video, s3.json.produto.capa], [200, null, null], 'tirou o vídeo')
    ok(!noDisco(webm.json.video) && !noDisco(capa2), 'o vídeo e a capa saíram da pasta')
    const r3 = await lojaPub()
    ok(!('video' in prodPub(r3, 'seda-ocb-premium-slim')) && r3.headers.get('etag') !== r2.headers.get('etag'), 'o GET loja sem o vídeo, com outro ETag')
    // tirar o vídeo leva a capa junto (capa sozinha não fica)
    const capa3 = await imagem()
    await dono.post('admin-produto-salvar', { id: 'seda-ocb-premium-slim', video: frag.json.video, capa: capa3 })
    igual((await dono.post('admin-produto-salvar', { id: 'seda-ocb-premium-slim', video: null })).json.produto.capa, null, 'sem vídeo, sem capa')
    ok(!noDisco(capa3) && !noDisco(frag.json.video), 'e os dois saíram')
  }

  parte('vídeo: arquivo que outro ainda usa fica')
  {
    // a mesma imagem como foto do produto e do rateio: trocar a foto do produto não tira a do rateio
    const comum = await imagem([10, 200, 90, 255])
    igual((await dono.post('admin-rateio-salvar', { id: 'arizona-green-tea', imagem: comum })).status, 200, 'o rateio usa a imagem')
    igual((await dono.post('admin-produto-salvar', { id: 'seda-ocb-premium-slim', foto: comum })).status, 200, 'o produto usa a mesma')
    igual((await dono.post('admin-produto-salvar', { id: 'seda-ocb-premium-slim', foto: null })).status, 200, 'o produto tira a foto')
    ok(noDisco(comum), 'a imagem continua (o rateio usa)')
    // a foto trocada que ninguém mais usa sai
    const f1 = await imagem([1, 2, 3, 255])
    const f2 = await imagem([4, 5, 6, 255])
    await dono.post('admin-produto-salvar', { id: 'seda-ocb-premium-slim', foto: f1 })
    await dono.post('admin-produto-salvar', { id: 'seda-ocb-premium-slim', foto: f2 })
    ok(!noDisco(f1) && noDisco(f2), 'a foto trocada sai da pasta, a nova fica')
    await dono.post('admin-produto-salvar', { id: 'seda-ocb-premium-slim', foto: null })
    ok(!noDisco(f2), 'tirar a foto também limpa')
  }

  parte('vídeo: a thumb animada de fábrica (produtos/, no build do site)')
  {
    // desde 15/10 o Hennessy vem da semente no desenho do site, sem a thumb de fábrica (pedido do Ian: os 4 do material
    // de 11/10 no mesmo padrão do resto); salvar de novo (o painel manda o que tem) passa e não muda nada
    const h = (await dono.get('admin-loja')).json.loja.produtos.find((p) => p.id === 'hennessy-very-special')
    igual([h.foto, h.video, h.capa], [null, null, null], 'o Hennessy vem sem foto, sem vídeo e sem capa (o desenho do site)')
    ok(!('video' in ((await lojaPub()).json.loja.produtos.find((p) => p.id === 'hennessy-very-special') ?? {})), 'o GET loja não leva thumb animada no Hennessy')
    const v0 = (await lojaPub()).json.versao
    const sh = await dono.post('admin-produto-salvar', { id: 'hennessy-very-special', video: h.video, capa: h.capa, foto: h.foto })
    igual([sh.status, sh.json.versao], [200, v0], 'salvar de novo sem vídeo passa e não muda nada')
    const fabrica = { video: 'produtos/hennessy-very-special.mp4', capa: 'produtos/hennessy-very-special-capa.webp' }
    ok(readFileSync(join(raiz, 'public', fabrica.video)).length > 1000 && readFileSync(join(raiz, 'public', fabrica.capa)).length > 1000, 'os arquivos de fábrica continuam no build (public/produtos/), sem produto ligado')
    // se o dono quiser a thumb de fábrica de volta no Hennessy, é dele: o caminho de fábrica vale, e sobe a versão
    const volta = await dono.post('admin-produto-salvar', { id: 'hennessy-very-special', ...fabrica })
    igual([volta.status, volta.json.produto?.video, volta.json.produto?.capa, volta.json.versao], [200, fabrica.video, fabrica.capa, v0 + 1], 'o dono pode pôr a thumb de fábrica de volta no Hennessy (a versão sobe)')
    igual((await dono.post('admin-produto-salvar', { id: 'hennessy-very-special', ...fabrica })).json.versao, v0 + 1, 'salvar de novo com o vídeo de fábrica passa e não muda nada')
    igual((await dono.post('admin-produto-salvar', { id: 'hennessy-very-special', video: null })).json.produto.video, null, 'e tirar de novo (o Hennessy volta pro desenho)')
    // outro produto pode usar uma de fábrica; caminho torto não passa
    const so = (video, capa) => dono.post('admin-produto-salvar', { id: 'cuia-de-silicone-raw', video, capa })
    igual((await so('produtos/hennessy-very-special.mp4', 'produtos/hennessy-very-special-capa.webp')).status, 200, 'vídeo e capa de fábrica num produto')
    for (const [video, capa, nome, campo] of [
      ['produtos/../api/privado/loja.mp4', 'produtos/hennessy-very-special-capa.webp', 'vídeo de fábrica com ../'],
      ['produtos/sub/x.mp4', 'produtos/hennessy-very-special-capa.webp', 'vídeo de fábrica em subpasta'],
      ['produtos/x.php', 'produtos/hennessy-very-special-capa.webp', 'vídeo de fábrica .php'],
      ['produtos/X.mp4', 'produtos/hennessy-very-special-capa.webp', 'vídeo de fábrica com maiúscula'],
      ['produtos/x.mp4.php', 'produtos/hennessy-very-special-capa.webp', 'vídeo de fábrica .mp4.php'],
      ['produtos/hennessy-very-special.mp4', 'produtos/x.svg', 'capa de fábrica .svg'],
      ['produtos/hennessy-very-special.mp4', 'produtos/../x.webp', 'capa de fábrica com ../'],
      ['produtos/hennessy-very-special.mp4', 'https://golpe.example/x.webp', 'capa de fora'],
      ['https://golpe.example/x.mp4', 'produtos/hennessy-very-special-capa.webp', 'vídeo de fora'],
      // nome certo, mas o arquivo não está no build (o site ficava com a mídia quebrada e caía no desenho)
      ['produtos/nao-existe.mp4', 'produtos/hennessy-very-special-capa.webp', 'vídeo de fábrica que não está no build', 'video'],
      ['produtos/hennessy-very-special.mp4', 'produtos/nao-existe-capa.webp', 'capa de fábrica que não está no build', 'capa'],
      ['produtos/hennessy-very-special.mp4', 'produtos/hennessy_capa.webp', 'capa de fábrica com _ (o .htaccess de produtos/ recusa)', 'capa'],
      ['produtos/hennessy-very-special.mp4', 'produtos/hennessy.capa.webp', 'capa de fábrica com ponto no meio', 'capa'],
    ]) {
      const r = await so(video, capa)
      erro(r, 400, 'invalido', nome)
      if (campo) igual(r.json?.campo, campo, `${nome}: o erro é do campo ${campo}`)
    }
    igual((await so(null, null)).json.produto.video, null, 'tirar o vídeo de fábrica do produto')
    ok(readFileSync(join(raiz, 'public', fabrica.video)).length > 1000, 'tirar a de fábrica não apaga nada do build (o servidor só limpa uploads/)')
  }

  parte('vídeo: produto apagado leva o vídeo, a capa e a foto')
  {
    const capaN = await imagem()
    const fotoN = await imagem([9, 9, 9, 255])
    const n = await dono.post('admin-produto-salvar', { nome: 'Isqueiro com vídeo', categoria: 'acessorios', foto: fotoN, video: mov.json.video, capa: capaN })
    igual(n.status, 201, 'produto novo com foto e vídeo')
    igual((await dono.post('admin-produto-apagar', { id: n.json.produto.id })).status, 200, 'apagou')
    ok(!noDisco(mov.json.video) && !noDisco(capaN) && !noDisco(fotoN), 'os três arquivos saíram')
  }

  parte('vídeo: os três .htaccess de uploads iguais')
  {
    const constante = execFileSync(PHP, ['-r', 'define("GC_API", 1); require $argv[1]; echo GC_HTACCESS_UPLOADS;', join(raiz, 'public/api/nucleo/upload.php')], { encoding: 'utf8' })
    igual(constante, readFileSync(join(raiz, 'public/uploads/.htaccess'), 'utf8'), 'GC_HTACCESS_UPLOADS = public/uploads/.htaccess')
    igual(readFileSync(join(uploads, '.htaccess'), 'utf8'), constante, 'o que o servidor grava em uploads/ é o mesmo')
    ok(/FilesMatch "\^\[a-z0-9\]\{8,64\}\\\.\(webp\|jpe\?g\|png\|mp4\|webm\)\$"/.test(constante) && constante.includes('AddType video/mp4 .mp4') && constante.includes('AddType video/webm .webm'), 'aceita só os nomes gerados .mp4/.webm, com o tipo certo')
    const dev = readFileSync(join(raiz, 'scripts/api-dev.php'), 'utf8')
    ok(dev.includes("'mp4' => 'video/mp4'") && dev.includes('HTTP_RANGE'), 'o roteador de desenvolvimento imita (tipo e Range)')
  }
}
