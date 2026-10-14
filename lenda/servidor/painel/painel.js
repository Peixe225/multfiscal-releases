/* LENDA · painel de números (só administrador). Fala com ../api/painel.php (cookie lenda_painel).
 * Sem biblioteca: os gráficos são SVG feitos à mão. Todo texto vindo do servidor entra por textContent. */
'use strict';

(function () {
  const API = '../api/painel.php';
  const SVG = 'http://www.w3.org/2000/svg';
  const FUSO_MS = 3 * 3600 * 1000; // America/Sao_Paulo = UTC-3 fixo
  const $ = (id) => document.getElementById(id);

  const estado = { periodo: '7', bots: false, dados: null, carregando: false, timerAgora: 0, timerTudo: 0 };

  // ── preferências do aparelho (só conveniência) ──────────────────────────────────────────────
  function lerPref() {
    try {
      const p = JSON.parse(localStorage.getItem('lenda:painel') || '{}');
      if (['hoje', '7', '30'].includes(p.periodo)) estado.periodo = p.periodo;
      estado.bots = p.bots === true;
    } catch (e) { /* sem armazenamento: fica o padrão */ }
  }
  function gravarPref() {
    try { localStorage.setItem('lenda:painel', JSON.stringify({ periodo: estado.periodo, bots: estado.bots })); } catch (e) { /* ok */ }
  }

  // ── formatação ──────────────────────────────────────────────────────────────────────────────
  const nf = new Intl.NumberFormat('pt-BR');
  const nf1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
  function num(n) {
    n = Number(n) || 0;
    if (Math.abs(n) >= 100000) return nf1.format(n / 1000) + ' mil';
    return nf.format(n);
  }
  function compacto(n) {
    n = Number(n) || 0;
    if (n >= 1000000) return nf1.format(n / 1000000) + ' mi';
    if (n >= 1000) return nf1.format(n / 1000) + ' mil';
    return nf.format(n);
  }
  function duracao(s) {
    s = Math.round(Number(s) || 0);
    if (s < 60) return s + ' s';
    const m = Math.floor(s / 60);
    const r = s % 60;
    if (m < 60) return r ? m + ' min ' + r + ' s' : m + ' min';
    const h = Math.floor(m / 60);
    return h + ' h ' + (m % 60) + ' min';
  }
  function pct(a, b) {
    if (!b) return '—';
    const v = (a / b) * 100;
    return (v >= 10 || v === 0 ? Math.round(v) : nf1.format(v)) + '%';
  }
  function diaCurto(iso) { // "2026-10-14" → "14/10"
    const p = String(iso).split('-');
    return p.length === 3 ? p[2] + '/' + p[1] : String(iso);
  }
  function diaLongo(iso) {
    const d = new Date(iso + 'T12:00:00Z');
    if (isNaN(d)) return String(iso);
    return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' });
  }
  function dataHora(iso) { // UTC ISO → "14/10 09:30" em Brasília
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const b = new Date(d.getTime() - FUSO_MS);
    const dd = String(b.getUTCDate()).padStart(2, '0');
    const mm = String(b.getUTCMonth() + 1).padStart(2, '0');
    const hh = String(b.getUTCHours()).padStart(2, '0');
    const mi = String(b.getUTCMinutes()).padStart(2, '0');
    return dd + '/' + mm + ' ' + hh + ':' + mi;
  }
  function hojeSp() { return new Date(Date.now() - FUSO_MS).toISOString().slice(0, 10); }
  function diasAntes(iso, n) { return new Date(Date.parse(iso + 'T00:00:00Z') - n * 86400000).toISOString().slice(0, 10); }
  const NOMES_MODO = { classico: 'Clássico', imersivo: 'Imersivo', live: 'Live' };
  const NOMES_ORIGEM = { tiktok: 'TikTok', youtube: 'YouTube', instagram: 'Instagram', google: 'Google', direto: 'Direto (link ou digitado)' };
  const NOMES_APARELHO = { mobile: 'Celular', desktop: 'Computador', tablet: 'Tablet', outro: 'Outro' };

  // ── DOM ─────────────────────────────────────────────────────────────────────────────────────
  function el(tag, cls, texto) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (texto !== undefined && texto !== null) e.textContent = String(texto);
    return e;
  }
  function svg(tag, attrs) {
    const e = document.createElementNS(SVG, tag);
    for (const k in attrs) e.setAttribute(k, String(attrs[k]));
    return e;
  }
  function limpar(no) { while (no.firstChild) no.removeChild(no.firstChild); }

  // ── rede ────────────────────────────────────────────────────────────────────────────────────
  async function pedir(qs) {
    const r = await fetch(API + (qs || ''), { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
    if (r.status === 401) return { status: 401, json: null };
    let json = null;
    try { json = await r.json(); } catch (e) { json = null; }
    return { status: r.status, json: json };
  }
  async function enviar(corpo) {
    const r = await fetch(API, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(corpo),
    });
    let json = null;
    try { json = await r.json(); } catch (e) { json = null; }
    return { status: r.status, json: json };
  }

  function consulta() {
    const hoje = hojeSp();
    const de = estado.periodo === 'hoje' ? hoje : diasAntes(hoje, estado.periodo === '30' ? 29 : 6);
    return '?de=' + de + '&ate=' + hoje + '&bots=' + (estado.bots ? '1' : '0');
  }

  // ── telas ───────────────────────────────────────────────────────────────────────────────────
  function mostrarEntrar(msg) {
    pararTimers();
    $('tela-painel').hidden = true;
    $('tela-entrar').hidden = false;
    const e = $('erro-entrar');
    e.hidden = !msg;
    e.textContent = msg || '';
    $('senha').value = '';
    $('senha').focus();
  }
  function mostrarPainel() {
    $('tela-entrar').hidden = true;
    $('tela-painel').hidden = false;
  }
  function aviso(msg) {
    const a = $('aviso');
    a.hidden = !msg;
    a.textContent = msg || '';
  }

  async function carregarTudo() {
    if (estado.carregando) return;
    estado.carregando = true;
    $('conteudo').classList.add('carregando');
    try {
      const r = await pedir(consulta());
      if (r.status === 401) { mostrarEntrar(''); return; }
      mostrarPainel();
      if (r.status !== 200 || !r.json || !r.json.periodo) {
        aviso((r.json && r.json.mensagem) || 'Não consegui carregar os números agora. Tento de novo em instantes.');
        if (!estado.dados) desenhar(vazio());
        return;
      }
      aviso('');
      estado.dados = r.json;
      desenhar(r.json);
      agendar();
    } catch (e) {
      mostrarPainel();
      aviso('Sem conexão com o servidor. Tento de novo em instantes.');
      if (!estado.dados) desenhar(vazio());
    } finally {
      estado.carregando = false;
      $('conteudo').classList.remove('carregando');
    }
  }

  async function carregarAgora() {
    if (document.hidden) return;
    try {
      const r = await pedir('?so=agora');
      if (r.status === 401) { mostrarEntrar('A sessão do painel acabou. Entre de novo.'); return; }
      if (r.status === 200 && r.json && r.json.agora) desenharAgora(r.json.agora);
    } catch (e) { /* tenta no próximo ciclo */ }
  }

  function pararTimers() {
    clearInterval(estado.timerAgora);
    clearInterval(estado.timerTudo);
    estado.timerAgora = estado.timerTudo = 0;
  }
  function agendar() {
    if (estado.timerAgora) return;
    estado.timerAgora = setInterval(carregarAgora, 15000);
    estado.timerTudo = setInterval(() => { if (!document.hidden) carregarTudo(); }, 5 * 60000);
  }

  // Resposta vazia (para desenhar zeros quando o servidor não respondeu).
  function vazio() {
    const hoje = hojeSp();
    const n = estado.periodo === 'hoje' ? 1 : estado.periodo === '30' ? 30 : 7;
    const dias = [];
    for (let i = n - 1; i >= 0; i--) dias.push({ dia: diasAntes(hoje, i), visitantes: 0, sessoes: 0, jogaram: 0, fins: 0, cadastros: 0, tempoMedioS: 0 });
    const zeroModo = { classico: 0, imersivo: 0, live: 0 };
    return {
      agora: { online: 0, jogando: 0, atualizadoEm: null },
      periodo: { de: dias[0].dia, ate: hoje, visitantes: 0, novos: 0, sessoes: 0, tempoMedioS: 0, tempoTotalH: 0, jogaram: 0,
        inicios: zeroModo, fins: zeroModo, partidasImersivo: 0, cadastros: 0, logins: 0, gate: { vistos: 0, fechados: 0, cadastrosDepois: 0 } },
      dias: dias, horas: Array.from({ length: 24 }, (_, h) => ({ hora: h, sessoes: 0 })), origens: [], dispositivos: [],
      funil: ['Visitaram', 'Começaram um jogo', 'Terminaram um jogo', '5 partidas', 'Criaram conta'].map((e) => ({ etapa: e, n: 0 })),
      notas: { media: null, melhor: null }, ultimosCadastros: [],
      contas: { total: 0, novas: 0, comCarreira: 0, carreiras: { auto: 0, manual: 0, total: 0, noPeriodo: { auto: 0, manual: 0 } }, melhores: [] },
    };
  }

  // ── desenho ─────────────────────────────────────────────────────────────────────────────────
  function desenhar(d) {
    desenharAgora(d.agora || {});
    const p = d.periodo || {};
    $('periodo-texto').textContent = p.de === p.ate ? diaLongo(p.de) : diaCurto(p.de) + ' a ' + diaCurto(p.ate);
    $('sem-dados').hidden = (p.visitantes || 0) > 0;
    desenharLadrilhos(p, d.notas || {});
    graficoDias($('grafico-dias'), d.dias || []);
    tabelaDias(d.dias || []);
    barras($('funil'), (d.funil || []).map((f, i, todos) => ({
      nome: f.etapa, n: f.n, extra: i === 0 ? '' : pct(f.n, todos[i - 1].n) + ' da anterior',
    })), (d.funil && d.funil[0] && d.funil[0].n) || 0, 'Sem visitas no período.');
    const totalSess = p.sessoes || 0;
    barras($('origens'), (d.origens || []).map((o) => ({ nome: NOMES_ORIGEM[o.origem] || o.origem, n: o.sessoes, extra: pct(o.sessoes, totalSess) })),
      null, 'Sem sessões no período.');
    barras($('dispositivos'), (d.dispositivos || []).map((o) => ({ nome: NOMES_APARELHO[o.dispositivo] || o.dispositivo, n: o.sessoes, extra: pct(o.sessoes, totalSess) })),
      null, 'Sem sessões no período.');
    graficoHoras($('grafico-horas'), d.horas || []);
    desenharContas(d.contas || {}, d.ultimosCadastros || [], p);
  }

  function desenharAgora(a) {
    $('online').textContent = num(a.online || 0);
    $('jogando').textContent = num(a.jogando || 0);
    const t = a.atualizadoEm ? dataHora(a.atualizadoEm).split(' ')[1] : '';
    if (t) {
      const b = new Date(new Date(a.atualizadoEm).getTime() - FUSO_MS);
      $('atualizado').textContent = 'Atualizado às ' + t + ':' + String(b.getUTCSeconds()).padStart(2, '0');
    }
  }

  function ladrilho(rotulo, valor, extra) {
    const c = el('div', 'ladrilho');
    c.appendChild(el('div', 'ladrilho-rotulo', rotulo));
    c.appendChild(el('div', 'ladrilho-valor' + (String(valor).length > 8 ? ' ladrilho-valor-longo' : ''), valor));
    if (extra) c.appendChild(el('div', 'ladrilho-extra', extra));
    return c;
  }
  function porModo(m) {
    m = m || {};
    return ['classico', 'imersivo', 'live'].map((k) => NOMES_MODO[k] + ' ' + num(m[k] || 0)).join(' · ');
  }
  function somaModos(m) { m = m || {}; return (m.classico || 0) + (m.imersivo || 0) + (m.live || 0); }

  function desenharLadrilhos(p, notas) {
    const box = $('ladrilhos');
    limpar(box);
    const g = p.gate || {};
    [
      ladrilho('Visitantes', num(p.visitantes), num(p.novos) + ' novos'),
      ladrilho('Novos', num(p.novos), pct(p.novos, p.visitantes) + ' dos visitantes'),
      ladrilho('Sessões', num(p.sessoes), p.visitantes ? nf1.format(p.sessoes / p.visitantes) + ' por visitante' : ''),
      ladrilho('Tempo médio', duracao(p.tempoMedioS), 'por sessão, com a aba visível'),
      ladrilho('Tempo total', nf1.format(p.tempoTotalH || 0) + ' h', 'somando todas as sessões'),
      ladrilho('Jogaram', num(p.jogaram), pct(p.jogaram, p.visitantes) + ' dos visitantes'),
      ladrilho('Jogos iniciados', num(somaModos(p.inicios)), porModo(p.inicios)),
      ladrilho('Jogos terminados', num(somaModos(p.fins)), porModo(p.fins)),
      ladrilho('Partidas no Imersivo', num(p.partidasImersivo), 'partidas jogadas até o fim'),
      ladrilho('Nota média', notas.media === null || notas.media === undefined ? '—' : num(notas.media),
        notas.melhor === null || notas.melhor === undefined ? 'nas carreiras terminadas' : 'melhor: ' + num(notas.melhor)),
      ladrilho('Cadastros', num(p.cadastros), num(p.logins) + ' logins'),
      ladrilho('Viram o convite de conta', num(g.vistos), num(g.fechados) + ' fecharam · ' + num(g.cadastrosDepois) + ' criaram conta depois'),
    ].forEach((c) => box.appendChild(c));
  }

  // Barras horizontais (funil, origens, aparelhos). max: base da escala (null = o maior valor).
  function barras(box, itens, max, textoVazio) {
    limpar(box);
    if (!itens.length) {
      box.appendChild(el('p', 'vazio', textoVazio));
      return;
    }
    const base = max || Math.max(1, ...itens.map((i) => i.n || 0));
    itens.forEach((i) => {
      const linha = el('div', 'barra-linha');
      const nome = el('div', 'barra-nome', i.nome);
      nome.title = i.nome;
      const trilho = el('div', 'barra-trilho');
      const cheia = el('div', 'barra-cheia');
      cheia.style.width = (base ? Math.min(100, ((i.n || 0) / base) * 100) : 0) + '%';
      trilho.appendChild(cheia);
      const valor = el('div', 'barra-valor', num(i.n || 0));
      if (i.extra) valor.appendChild(el('small', null, i.extra));
      linha.appendChild(nome);
      linha.appendChild(trilho);
      linha.appendChild(valor);
      box.appendChild(linha);
    });
  }

  // Escala "redonda" para o eixo Y.
  function escala(max, passos) {
    if (max <= 0) return { topo: 4, passo: 1 };
    const bruto = max / passos;
    const mag = Math.pow(10, Math.floor(Math.log10(bruto)));
    const n = bruto / mag;
    const passo = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
    const p = Math.max(1, passo);
    return { topo: Math.ceil(max / p) * p, passo: p };
  }

  // Coluna com ponta de cima arredondada (4px) e base reta.
  function coluna(x, y, w, h, cls) {
    if (h <= 0) return null;
    const r = Math.min(4, w / 2, h);
    const d = 'M' + x + ',' + (y + h) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y + 'H' + (x + w - r) +
      'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + h) + 'Z';
    return svg('path', { d: d, class: cls });
  }

  // Dica (tooltip): valores primeiro, nomes depois.
  function mostrarDica(alvo, titulo, linhas) {
    const dica = $('dica');
    limpar(dica);
    dica.appendChild(el('div', 'dica-titulo', titulo));
    linhas.forEach((l) => {
      const row = el('div', 'dica-linha');
      if (l.cor) { const t = el('i', 'dica-traco'); t.style.background = l.cor; row.appendChild(t); }
      row.appendChild(el('b', null, l.valor));
      row.appendChild(el('span', null, l.nome));
      dica.appendChild(row);
    });
    dica.hidden = false;
    const r = alvo.getBoundingClientRect();
    const w = dica.offsetWidth;
    const h = dica.offsetHeight;
    let x = r.left + r.width / 2 - w / 2;
    x = Math.max(8, Math.min(window.innerWidth - w - 8, x));
    let y = r.top - h - 8;
    if (y < 8) y = r.bottom + 8;
    dica.style.left = x + 'px';
    dica.style.top = y + 'px';
  }
  let ativo = null;
  function esconderDica() {
    $('dica').hidden = true;
    if (ativo) { ativo.fundo.classList.remove('faixa-ativa'); ativo.g.classList.remove('grupo-ativo'); ativo = null; }
  }
  // Área de toque/foco do tamanho da faixa inteira (maior que a coluna). No mouse: passar por cima; no
  // celular: tocar (some ao tocar fora); no teclado: Tab.
  function ligarAlvo(fundo, g, conteudo) {
    const ativar = () => {
      esconderDica();
      ativo = { fundo: fundo, g: g };
      fundo.classList.add('faixa-ativa');
      g.classList.add('grupo-ativo');
      const c = conteudo();
      mostrarDica(fundo, c.titulo, c.linhas);
    };
    fundo.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') ativar(); });
    fundo.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') esconderDica(); });
    fundo.addEventListener('click', ativar);
    fundo.addEventListener('focus', ativar);
    fundo.addEventListener('blur', esconderDica);
  }

  function cores() {
    const cs = getComputedStyle(document.documentElement);
    return { s1: cs.getPropertyValue('--serie-1').trim(), s2: cs.getPropertyValue('--serie-2').trim() };
  }

  // Colunas agrupadas por dia: visitantes e jogaram (um eixo só).
  function graficoDias(box, dias) {
    limpar(box);
    const W = Math.max(280, box.clientWidth || 600);
    const H = box.clientHeight || 240;
    const m = { e: 34, d: 6, c: 10, b: 24 };
    const larg = W - m.e - m.d;
    const alt = H - m.c - m.b;
    const max = Math.max(0, ...dias.map((d) => Math.max(d.visitantes || 0, d.jogaram || 0)));
    const esc = escala(max, 4);
    const s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Visitantes e jogadores por dia' });
    for (let v = 0; v <= esc.topo + 1e-9; v += esc.passo) {
      const y = m.c + alt - (v / esc.topo) * alt;
      s.appendChild(svg('line', { x1: m.e, x2: W - m.d, y1: Math.round(y) + 0.5, y2: Math.round(y) + 0.5, class: 'grade' }));
      const t = svg('text', { x: m.e - 6, y: y + 4, 'text-anchor': 'end', class: 'eixo-texto' });
      t.textContent = compacto(v);
      s.appendChild(t);
    }
    const n = Math.max(1, dias.length);
    const faixa = larg / n;
    const bw = Math.max(2, Math.min(24, (faixa - 6) / 2 - 1));
    const passoRotulo = Math.ceil(n / Math.max(1, Math.floor(larg / 46)));
    const c = cores();
    dias.forEach((d, i) => {
      const x0 = m.e + i * faixa;
      const cx = x0 + faixa / 2;
      const g = svg('g', {});
      const fundo = svg('rect', { x: x0, y: m.c, width: faixa, height: alt, class: 'alvo', tabindex: 0,
        'aria-label': diaLongo(d.dia) + ': ' + (d.visitantes || 0) + ' visitantes, ' + (d.jogaram || 0) + ' jogaram' });
      const hv = ((d.visitantes || 0) / esc.topo) * alt;
      const hj = ((d.jogaram || 0) / esc.topo) * alt;
      const c1 = coluna(cx - bw - 1, m.c + alt - hv, bw, hv, 'serie-1');
      const c2 = coluna(cx + 1, m.c + alt - hj, bw, hj, 'serie-2');
      if (c1) g.appendChild(c1);
      if (c2) g.appendChild(c2);
      ligarAlvo(fundo, g, () => ({ titulo: diaLongo(d.dia), linhas: [
        { cor: c.s1, valor: num(d.visitantes), nome: 'visitantes' },
        { cor: c.s2, valor: num(d.jogaram), nome: 'jogaram' },
        { valor: num(d.sessoes), nome: 'sessões' },
        { valor: num(d.fins), nome: 'jogos terminados' },
        { valor: num(d.cadastros), nome: 'cadastros' },
        { valor: duracao(d.tempoMedioS), nome: 'tempo médio' },
      ] }));
      s.appendChild(fundo);
      s.appendChild(g);
      if (i % passoRotulo === 0 || n <= 8) {
        const t = svg('text', { x: cx, y: H - 6, 'text-anchor': 'middle', class: 'eixo-texto' });
        t.textContent = diaCurto(d.dia);
        s.appendChild(t);
      }
    });
    g0(s, m, W, alt);
    box.appendChild(s);
  }
  function g0(s, m, W, alt) { // linha de base por cima das colunas
    s.appendChild(svg('line', { x1: m.e, x2: W - m.d, y1: m.c + alt + 0.5, y2: m.c + alt + 0.5, class: 'grade' }));
  }

  function graficoHoras(box, horas) {
    limpar(box);
    const W = Math.max(260, box.clientWidth || 500);
    const H = box.clientHeight || 170;
    const m = { e: 30, d: 4, c: 8, b: 22 };
    const larg = W - m.e - m.d;
    const alt = H - m.c - m.b;
    const max = Math.max(0, ...horas.map((h) => h.sessoes || 0));
    const esc = escala(max, 3);
    const s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Sessões por hora do dia' });
    for (let v = 0; v <= esc.topo + 1e-9; v += esc.passo) {
      const y = m.c + alt - (v / esc.topo) * alt;
      s.appendChild(svg('line', { x1: m.e, x2: W - m.d, y1: Math.round(y) + 0.5, y2: Math.round(y) + 0.5, class: 'grade' }));
      const t = svg('text', { x: m.e - 6, y: y + 4, 'text-anchor': 'end', class: 'eixo-texto' });
      t.textContent = compacto(v);
      s.appendChild(t);
    }
    const faixa = larg / 24;
    const bw = Math.max(2, Math.min(24, faixa - 2));
    const c = cores();
    horas.forEach((h, i) => {
      const x0 = m.e + i * faixa;
      const altura = ((h.sessoes || 0) / esc.topo) * alt;
      const fundo = svg('rect', { x: x0, y: m.c, width: faixa, height: alt, class: 'alvo', tabindex: 0,
        'aria-label': h.hora + 'h: ' + (h.sessoes || 0) + ' sessões' });
      const g = svg('g', {});
      const col = coluna(x0 + (faixa - bw) / 2, m.c + alt - altura, bw, altura, 'serie-1');
      if (col) g.appendChild(col);
      ligarAlvo(fundo, g, () => ({
        titulo: String(h.hora).padStart(2, '0') + 'h–' + String(h.hora).padStart(2, '0') + 'h59 (Brasília)',
        linhas: [{ cor: c.s1, valor: num(h.sessoes), nome: 'sessões' }],
      }));
      s.appendChild(fundo);
      s.appendChild(g);
      if (i % (larg < 400 ? 6 : 3) === 0) {
        const t = svg('text', { x: x0 + faixa / 2, y: H - 6, 'text-anchor': 'middle', class: 'eixo-texto' });
        t.textContent = h.hora + 'h';
        s.appendChild(t);
      }
    });
    g0(s, m, W, alt);
    box.appendChild(s);
  }

  function linhaTabela(tabela, celulas, cab) {
    const tr = el('tr');
    celulas.forEach((c) => {
      const td = el(cab ? 'th' : 'td', c.num ? 'num' : null);
      if (c.no) td.appendChild(c.no); else td.textContent = c.t === undefined ? '' : String(c.t);
      tr.appendChild(td);
    });
    tabela.appendChild(tr);
  }

  function tabelaDias(dias) {
    const t = $('tabela-dias');
    limpar(t);
    linhaTabela(t, [{ t: 'Dia' }, { t: 'Visitantes', num: 1 }, { t: 'Jogaram', num: 1 }, { t: 'Sessões', num: 1 }, { t: 'Terminados', num: 1 },
      { t: 'Cadastros', num: 1 }, { t: 'Tempo médio', num: 1 }], true);
    dias.slice().reverse().forEach((d) => linhaTabela(t, [{ t: diaLongo(d.dia) }, { t: num(d.visitantes), num: 1 }, { t: num(d.jogaram), num: 1 },
      { t: num(d.sessoes), num: 1 }, { t: num(d.fins), num: 1 }, { t: num(d.cadastros), num: 1 }, { t: duracao(d.tempoMedioS), num: 1 }]));
  }

  function desenharContas(c, ultimos, p) {
    const box = $('ladrilhos-contas');
    limpar(box);
    const cs = c.carreiras || {};
    const np = cs.noPeriodo || {};
    [
      ladrilho('Contas', num(c.total), num(c.comCarreira) + ' com carreira salva'),
      ladrilho('Novas no período', num(c.novas), p.visitantes ? pct(c.novas, p.visitantes) + ' dos visitantes' : ''),
      ladrilho('Carreiras salvas', num(cs.total), 'automáticas ' + num(cs.auto) + ' · manuais ' + num(cs.manual)),
      ladrilho('Salvas no período', num((np.auto || 0) + (np.manual || 0)), 'automáticas ' + num(np.auto) + ' · manuais ' + num(np.manual)),
    ].forEach((x) => box.appendChild(x));

    const tm = $('tabela-melhores');
    limpar(tm);
    const melhores = c.melhores || [];
    if (!melhores.length) {
      linhaTabela(tm, [{ t: 'Nenhuma carreira salva ainda.' }]);
    } else {
      linhaTabela(tm, [{ t: '#' }, { t: 'Conta' }, { t: 'Jogador' }, { t: 'Nota', num: 1 }, { t: 'Pico', num: 1 }, { t: 'Modo' }, { t: 'Salva' }], true);
      melhores.forEach((m, i) => {
        const selo = el('span', 'selo' + (m.como === 'auto' ? ' selo-auto' : ''), m.como === 'auto' ? 'auto' : 'manual');
        linhaTabela(tm, [{ t: i + 1 }, { t: m.apelido }, { t: m.jogador }, { t: num(m.nota), num: 1 }, { t: num(m.picoOvr), num: 1 },
          { t: NOMES_MODO[m.modo] || m.modo }, { no: selo }]);
      });
    }

    const tc = $('tabela-cadastros');
    limpar(tc);
    if (!ultimos.length) {
      linhaTabela(tc, [{ t: 'Nenhum cadastro ainda.' }]);
    } else {
      linhaTabela(tc, [{ t: 'Apelido' }, { t: 'Quando' }, { t: 'Origem' }], true);
      ultimos.forEach((u) => linhaTabela(tc, [{ t: u.apelido }, { t: dataHora(u.em) }, { t: NOMES_ORIGEM[u.origem] || u.origem }]));
    }
  }

  // ── controles ───────────────────────────────────────────────────────────────────────────────
  function marcarPeriodo() {
    document.querySelectorAll('[data-periodo]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.periodo === estado.periodo)));
    $('incluir-bots').checked = estado.bots;
  }

  function iniciar() {
    lerPref();
    marcarPeriodo();
    document.querySelectorAll('[data-periodo]').forEach((b) => b.addEventListener('click', () => {
      estado.periodo = b.dataset.periodo;
      gravarPref();
      marcarPeriodo();
      carregarTudo();
    }));
    $('incluir-bots').addEventListener('change', (e) => {
      estado.bots = e.target.checked;
      gravarPref();
      carregarTudo();
    });
    $('form-entrar').addEventListener('submit', async (e) => {
      e.preventDefault();
      const botao = $('botao-entrar');
      botao.disabled = true;
      try {
        const r = await enviar({ acao: 'entrar', senha: $('senha').value });
        if (r.status === 200) {
          $('senha').value = '';
          $('erro-entrar').hidden = true;
          await carregarTudo();
        } else {
          mostrarEntrar((r.json && r.json.mensagem) || 'Não deu para entrar.');
        }
      } catch (err) {
        mostrarEntrar('Sem conexão com o servidor.');
      } finally {
        botao.disabled = false;
      }
    });
    $('botao-sair').addEventListener('click', async () => {
      try { await enviar({ acao: 'sair' }); } catch (e) { /* sai mesmo assim */ }
      estado.dados = null;
      mostrarEntrar('');
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && estado.dados) carregarAgora(); });
    let espera = 0;
    window.addEventListener('resize', () => {
      clearTimeout(espera);
      espera = setTimeout(() => {
        if (estado.dados) {
          graficoDias($('grafico-dias'), estado.dados.dias || []);
          graficoHoras($('grafico-horas'), estado.dados.horas || []);
        }
      }, 150);
    });
    window.addEventListener('scroll', esconderDica, { passive: true });
    document.addEventListener('pointerdown', (e) => { if (!(e.target instanceof Element) || !e.target.closest('.alvo')) esconderDica(); });
    carregarTudo();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
