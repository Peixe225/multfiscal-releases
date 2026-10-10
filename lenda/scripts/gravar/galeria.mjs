/**
 * Página da galeria de criativos (vai para a hospedagem junto com os vídeos).
 *
 *   node scripts/gravar/galeria.mjs saida/      → saida/index.html
 *
 * Lê saida/_catalogo.json e, se existir, saida/_legendas.json. Página única, sem dependências,
 * com os vídeos carregando só quando alguém aperta o play (preload="none").
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
const cat = JSON.parse(readFileSync(join(dir, '_catalogo.json'), 'utf8'))
const leg = existsSync(join(dir, '_legendas.json')) ? JSON.parse(readFileSync(join(dir, '_legendas.json'), 'utf8')) : {}
const dados = cat.map((i) => ({ ...i, ...(leg[i.nome] ?? {}), url: `${i.nome}.mp4`, corte: i.corte ? `${i.nome}-corte.mp4` : null, capa: i.capa ? `${i.nome}.jpg` : null }))
const json = JSON.stringify(dados).replace(/</g, '\\u003c')

const GALERIA_JS = `const D = JSON.parse(document.getElementById('dados').textContent)
const FX = [['todos','Todos'],['extraordinaria','Extraordinárias'],['otima','Ótimas'],['boa','Boas'],['mediana','Medianas'],['ruim','Ruins'],['pessima','Péssimas'],['live','Live'],['imersivo','Imersivo'],['hall','Hall'],['compilacao','Compilação'],['vertical','Verticais'],['horizontal','Horizontais']]
const NOME = {extraordinaria:'Extraordinária',otima:'Ótima',boa:'Boa',mediana:'Mediana',ruim:'Ruim',pessima:'Péssima',live:'Live',imersivo:'Imersivo',hall:'Hall',compilacao:'Compilação'}
let filtro = 'todos'
const chips = document.getElementById('chips'), grid = document.getElementById('grid'), toast = document.getElementById('toast')
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))
const mmss = (s) => Math.floor(s/60) + ':' + String(Math.round(s%60)).padStart(2,'0')
const OQ = {inicio:'Início',criacao:'Criação do jogador',carreira:'Começa a carreira',decisao:'Decisão',titulo:'Título!',fim:'Fim de carreira',resumo:'Resumo',nota:'Nota de Legado',card:'Card final',disputa:'Disputa pela criação',nasce:'Nasce uma lenda',votacao:'Votação do chat',hall:'Hall',ranking:'Ranking',filtro:'Filtro',categorias:'Categorias','suas-carreiras':'Suas carreiras',ficha:'Ficha da carreira',lenda:'Ficha da lenda',lance:'Lance decisivo',penalti:'Pênalti',intervalo:'Intervalo','fim-jogo':'Fim de jogo','pre-jogo':'Pré-jogo',treino:'Treino'}
function avisar(t){toast.textContent=t;toast.classList.add('on');clearTimeout(avisar.t);avisar.t=setTimeout(()=>toast.classList.remove('on'),1800)}
function chipsRender(){chips.innerHTML=FX.filter(([k])=>k==='todos'||D.some(i=>i.faixa===k||i.formato===k)).map(([k,l])=>'<button class="chip" aria-pressed="'+(k===filtro)+'" data-k="'+k+'">'+l+' <span style="opacity:.6">'+(k==='todos'?D.length:D.filter(i=>i.faixa===k||i.formato===k).length)+'</span></button>').join('')}
function render(){
  chipsRender()
  const L = D.filter(i=>filtro==='todos'||i.faixa===filtro||i.formato===filtro)
  if(!L.length){grid.innerHTML='<p class="vazio">Nenhum vídeo nesta categoria.</p>';return}
  grid.innerHTML = L.map((i,ix)=>{
    const titulo = i.titulo || (i.jogador ? i.jogador + ' · ' + (i.headline||'') : NOME[i.faixa]||i.nome)
    const meta = [NOME[i.faixa], i.formato==='vertical'?'9:16':'16:9', mmss(i.duracao), i.mb?i.mb+' MB':''].filter(Boolean).join(' · ')
    const fatos = i.jogador ? esc(i.pais)+' · '+esc(i.posicao)+' · '+(i.gols??0)+' gols · '+(i.totalTitulos??0)+' títulos' : ''
    const legenda = [i.legenda, i.hashtags].filter(Boolean).join('\\n\\n')
    return '<article class="card '+(i.formato==='horizontal'?'h':'')+'">'+
      '<div class="vid"><video controls preload="none" playsinline '+(i.capa?'poster="'+esc(i.capa)+'"':'')+' src="'+esc(i.url)+'"></video>'+
      '<div class="badge">'+(i.nota!=null?'<span class="pill n">Nota '+i.nota+'</span>':'')+'<span class="pill">'+esc(NOME[i.faixa]||i.faixa)+'</span></div></div>'+
      '<div class="body"><h2 class="t">'+esc(titulo)+'</h2><div class="meta">'+esc(meta)+'</div>'+(fatos?'<div class="meta">'+fatos+'</div>':'')+
      (i.gancho?'<div class="hook"><b>Gancho:</b> '+esc(i.gancho)+'</div>':'')+
      (i.resumo?'<div class="meta">'+esc(i.resumo)+'</div>':'')+
      '<details><summary>Marcas para editar ('+(i.marcas||[]).length+')</summary><ol>'+(i.marcas||[]).map(m=>'<li>'+mmss(m.t)+' — '+esc(OQ[m.o]||m.o)+(m.escolha?': '+esc(m.escolha):'')+'</li>').join('')+'</ol></details>'+
      (legenda?'<details><summary>Legenda e hashtags</summary><div class="leg">'+esc(legenda)+'</div></details>':'')+
      '<div class="row"><a class="btn p" href="'+esc(i.url)+'" download>Baixar original</a>'+(i.corte?'<a class="btn" href="'+esc(i.corte)+'" download>Corte rápido</a>':'')+(legenda?'<button class="btn" data-copiar="'+ix+'">Copiar legenda</button>':'')+'</div></div></article>'
  }).join('')
  grid.querySelectorAll('[data-copiar]').forEach(b=>b.addEventListener('click',async()=>{const i=L[+b.dataset.copiar];const t=[i.legenda,i.hashtags].filter(Boolean).join('\\n\\n');try{await navigator.clipboard.writeText(t);avisar('Legenda copiada')}catch{avisar('Selecione e copie o texto da legenda')}}))
}
chips.addEventListener('click',e=>{const b=e.target.closest('.chip');if(!b)return;filtro=b.dataset.k;render()})
// um vídeo tocando por vez
document.addEventListener('play',e=>{document.querySelectorAll('video').forEach(v=>{if(v!==e.target)v.pause()})},true)
render()
`

const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#07080c">
<title>LENDA · Criativos</title>
<link rel="icon" type="image/svg+xml" href="../favicon.svg">
<style>
:root{--bg:#07080c;--bg2:#0e1018;--card:#12141d;--line:#232736;--fg:#f4f5f8;--mut:#9aa0b4;--gold:#e8c66a;--gold2:#b8902f;--ok:#4cc38a;--bad:#e5484d;color-scheme:dark}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:inherit}
.wrap{max-width:1280px;margin:0 auto;padding:28px 16px 64px}
header{display:flex;flex-wrap:wrap;gap:16px;align-items:end;justify-content:space-between;margin-bottom:20px}
h1{font:800 clamp(28px,5vw,44px)/1.05 system-ui;letter-spacing:-.02em;margin:0}
h1 b{color:var(--gold)}
.sub{color:var(--mut);margin:6px 0 0;max-width:62ch}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0 22px}
.chip{border:1px solid var(--line);background:var(--bg2);color:var(--fg);padding:8px 14px;border-radius:999px;cursor:pointer;font:600 13px system-ui}
.chip[aria-pressed=true]{background:var(--gold);color:#1a1405;border-color:var(--gold)}
.chip:focus-visible,.btn:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;overflow:hidden;display:flex;flex-direction:column;min-width:0}
.card.h{grid-column:span 2}
@media (max-width:620px){.card.h{grid-column:auto}}
.vid{position:relative;background:#000;aspect-ratio:9/16}
.card.h .vid{aspect-ratio:16/9}
video{width:100%;height:100%;display:block;object-fit:contain;background:#000}
.badge{position:absolute;left:10px;top:10px;display:flex;gap:6px;flex-wrap:wrap;pointer-events:none}
.pill{font:700 11px system-ui;letter-spacing:.06em;text-transform:uppercase;padding:4px 8px;border-radius:999px;background:rgba(7,8,12,.78);border:1px solid rgba(255,255,255,.14)}
.pill.n{background:var(--gold);color:#1a1405;border-color:transparent}
.body{padding:14px 14px 16px;display:flex;flex-direction:column;gap:8px;flex:1}
.t{font:750 16px/1.25 system-ui;margin:0}
.meta{color:var(--mut);font-size:13px}
.hook{font-size:13px;background:var(--bg2);border:1px dashed var(--line);border-radius:10px;padding:8px 10px}
.hook b{color:var(--gold)}
.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:auto}
.btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);background:var(--bg2);color:var(--fg);border-radius:10px;padding:8px 11px;font:600 13px system-ui;cursor:pointer;text-decoration:none}
.btn.p{background:var(--fg);color:#0b0c10;border-color:var(--fg)}
details{font-size:13px;color:var(--mut)}
details summary{cursor:pointer;color:var(--fg)}
details ol{margin:8px 0 0;padding-left:18px}
.leg{white-space:pre-wrap;background:var(--bg2);border-radius:10px;padding:8px 10px;margin-top:6px;color:var(--fg)}
.vazio{color:var(--mut);padding:40px 0;text-align:center}
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--fg);color:#0b0c10;padding:10px 16px;border-radius:999px;font:700 14px system-ui;opacity:0;transition:opacity .2s;pointer-events:none}
.toast.on{opacity:1}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style>
</head>
<body>
<div class="wrap">
<header>
  <div>
    <h1>LENDA · <b>criativos</b></h1>
    <p class="sub">Arquivos brutos para editar e postar. Verticais 1080×1920 (TikTok, Reels, Shorts) e horizontais 1920×1080 (YouTube), H.264 30 fps, sem áudio. Cada um tem um <b>corte rápido</b> pronto e as marcas de tempo para editar.</p>
  </div>
  <a class="btn" href="../" target="_blank" rel="noopener">Abrir o jogo ↗</a>
</header>
<div class="chips" role="group" aria-label="Filtrar vídeos" id="chips"></div>
<div class="grid" id="grid"></div>
</div>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script id="dados" type="application/json">${json}</script>
<script src="galeria.js"></script>
</body>
</html>
`
writeFileSync(join(dir, 'index.html'), html)
// o JS fica num arquivo à parte: a CSP de /lenda/ (script-src 'self' + hash do jogo) bloqueia <script> embutido
writeFileSync(join(dir, 'galeria.js'), GALERIA_JS)
console.log(`galeria: ${dados.length} vídeos → ${join(dir, 'index.html')}`)
