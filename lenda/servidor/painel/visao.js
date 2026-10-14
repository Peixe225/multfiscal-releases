/* LENDA · painel — Visão geral: os números de antes (../api/painel.php), iguais, mais o resumo da plataforma
 * (admin.php?r=resumo, desenhado pelo painel.js). Sem biblioteca: os gráficos são SVG feitos à mão. */
'use strict';

(function () {
  const LP = window.LP;
  const $ = LP.$;
  const { h, num, nf1, duracao, pct, diaCurto, diaLongo, dataHora } = LP;

  const estado = { periodo: '7', bots: false, dados: null, carregando: false, timerTudo: 0, ligado: false, montada: false };

  // ── preferências do aparelho (só conveniência) ──────────────────────────────────────────────
  function lerPref() {
    try {
      const p = JSON.parse(localStorage.getItem('lenda:painel') || '{}');
      if (['hoje', '7', '30'].includes(p.periodo)) estado.periodo = p.periodo;
      estado.bots = p.bots === true;
    } catch (e) { /* sem armazenamento: fica o padrão */ }
  }
  function gravarPref() {
    try {
      const atual = JSON.parse(localStorage.getItem('lenda:painel') || '{}');
      atual.periodo = estado.periodo;
      atual.bots = estado.bots;
      localStorage.setItem('lenda:painel', JSON.stringify(atual));
    } catch (e) { /* ok */ }
  }

  function consulta() {
    const hoje = LP.hojeSp();
    const de = estado.periodo === 'hoje' ? hoje : LP.diasAntes(hoje, estado.periodo === '30' ? 29 : 6);
    return '?de=' + de + '&ate=' + hoje + '&bots=' + (estado.bots ? '1' : '0');
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
      const d = await LP.painelGet(consulta());
      if (!d || !d.periodo) throw new LP.ErroApi(500, 'formato', 'Não consegui carregar os números agora. Tento de novo em instantes.');
      aviso('');
      estado.dados = d;
      desenhar(d);
    } catch (e) {
      if (e && e.status === 401) return;
      aviso(e && e.status === 0 ? 'Sem conexão com o servidor. Tento de novo em instantes.' : LP.mensagem(e));
      if (!estado.dados) desenhar(vazio());
    } finally {
      estado.carregando = false;
      $('conteudo').classList.remove('carregando');
    }
  }

  // Resposta vazia (para desenhar zeros quando o servidor não respondeu).
  function vazio() {
    const hoje = LP.hojeSp();
    const n = estado.periodo === 'hoje' ? 1 : estado.periodo === '30' ? 30 : 7;
    const dias = [];
    for (let i = n - 1; i >= 0; i--) dias.push({ dia: LP.diasAntes(hoje, i), visitantes: 0, sessoes: 0, jogaram: 0, fins: 0, cadastros: 0, tempoMedioS: 0 });
    const zeroModo = { classico: 0, imersivo: 0, live: 0 };
    return {
      agora: null,
      periodo: { de: dias[0].dia, ate: hoje, visitantes: 0, novos: 0, sessoes: 0, tempoMedioS: 0, tempoTotalH: 0, jogaram: 0,
        inicios: zeroModo, fins: zeroModo, partidasImersivo: 0, cadastros: 0, logins: 0, gate: { vistos: 0, fechados: 0, cadastrosDepois: 0 } },
      dias: dias, horas: Array.from({ length: 24 }, (_, hr) => ({ hora: hr, sessoes: 0 })), origens: [], dispositivos: [],
      funil: ['Visitaram', 'Começaram um jogo', 'Terminaram um jogo', '5 partidas', 'Criaram conta'].map((e) => ({ etapa: e, n: 0 })),
      notas: { media: null, melhor: null }, ultimosCadastros: [],
      contas: { total: 0, novas: 0, comCarreira: 0, carreiras: { auto: 0, manual: 0, total: 0, noPeriodo: { auto: 0, manual: 0 } }, melhores: [] },
    };
  }

  // ── desenho ─────────────────────────────────────────────────────────────────────────────────
  function desenhar(d) {
    if (d.agora) LP.mostrarAgora(d.agora);
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
    barras($('origens'), (d.origens || []).map((o) => ({ nome: LP.origem(o.origem), n: o.sessoes, extra: pct(o.sessoes, totalSess) })),
      null, 'Sem sessões no período.');
    barras($('dispositivos'), (d.dispositivos || []).map((o) => ({ nome: LP.aparelho(o.dispositivo), n: o.sessoes, extra: pct(o.sessoes, totalSess) })),
      null, 'Sem sessões no período.');
    graficoHoras($('grafico-horas'), d.horas || []);
    desenharContas(d.contas || {}, d.ultimosCadastros || [], p);
  }

  /** Online/jogando agora: os cartões grandes da visão geral (a lateral o painel.js atualiza). */
  LP.desenharAgoraVisao = function (a) {
    $('online').textContent = num(a.online || 0);
    $('jogando').textContent = num(a.jogando || 0);
    if (a.atualizadoEm) $('atualizado').textContent = 'Atualizado às ' + LP.hora(a.atualizadoEm, true);
  };

  /** Resumo da plataforma (admin.php?r=resumo): ladrilhos com link para cada aba. */
  LP.desenharPlataforma = function (r) {
    const box = $('ladrilhos-plataforma');
    if (!box) return;
    LP.limpar(box);
    if (!r) {
      box.appendChild(h('p', { class: 'vazio' }, 'Resumo da plataforma indisponível agora.'));
      return;
    }
    const u = r.usuarios || {};
    const c = r.carreiras || {};
    const ind = r.indicacoes || {};
    const b = r.bonus || {};
    const hall = r.hall || {};
    const den = r.denunciasAbertas || 0;
    const susp = c.suspeitas || 0;
    const rev = c.emRevisao || 0;
    const mails = r.emailsBarrados || {};
    [
      LP.ladrilho('Contas', num(u.total), num(u.novosHoje) + ' hoje · ' + num(u.novos7Dias) + ' em 7 dias', { href: '#/usuarios' }),
      LP.ladrilho('Suspensas', num(u.suspensos), num(u.ativos) + ' ativas', { href: '#/usuarios?status=suspenso' }),
      LP.ladrilho('No Hall público', num(c.noHall), hall.atualizadoEm ? 'foto ' + LP.relativo(hall.atualizadoEm) + (hall.proximaEm ? ' · próxima ' + LP.relativo(hall.proximaEm) : '') : 'ainda sem fotografia', { href: '#/hall' }),
      LP.ladrilho('Denúncias abertas', num(den), num(c.ocultasPorDenuncia) + ' escondidas por denúncia', { href: '#/denuncias', classe: den ? 'ladrilho-perigo' : '' }),
      LP.ladrilho('Esperando revisão', num(rev), 'nota ' + num(c.revisaoNota || 90) + '+ só entra no Hall depois de você liberar', { href: '#/hall?filtro=revisao', classe: rev ? 'ladrilho-alerta' : '' }),
      LP.ladrilho('Carreiras suspeitas', num(susp), num(c.ocultas) + ' ocultas pelo admin', { href: '#/hall?filtro=suspeitas', classe: susp ? 'ladrilho-alerta' : '' }),
      LP.ladrilho('Carreiras salvas', num(c.total), 'em todas as contas', { href: '#/hall?filtro=todas' }),
      LP.ladrilho('Indicações', num(ind.validas), num(ind.pendentes) + ' pendentes · ' + num(ind.recusadas) + ' recusadas', { href: '#/indicacoes' }),
      LP.ladrilho('Bônus de OVR', num(b.naoUsados), 'esperando uso · ' + num(b.usados) + ' usados', { href: '#/indicacoes' }),
      // o teto de e-mails (a cota de envio da hospedagem) segurou códigos de troca de senha: só aparece se aconteceu
      mails.total ? LP.ladrilho('E-mails de senha segurados', num(mails.total), 'pelo teto do site · último ' + LP.relativo(mails.ultimoEm), { classe: 'ladrilho-alerta' }) : null,
    ].filter(Boolean).forEach((x) => box.appendChild(x));
  };

  function porModo(m) {
    m = m || {};
    return ['classico', 'imersivo', 'live'].map((k) => LP.NOMES_MODO[k] + ' ' + num(m[k] || 0)).join(' · ');
  }
  function somaModos(m) { m = m || {}; return (m.classico || 0) + (m.imersivo || 0) + (m.live || 0); }

  function desenharLadrilhos(p, notas) {
    const box = $('ladrilhos');
    LP.limpar(box);
    const g = p.gate || {};
    const L = LP.ladrilho;
    [
      L('Visitantes', num(p.visitantes), num(p.novos) + ' novos'),
      L('Novos', num(p.novos), pct(p.novos, p.visitantes) + ' dos visitantes'),
      L('Sessões', num(p.sessoes), p.visitantes ? nf1.format(p.sessoes / p.visitantes) + ' por visitante' : ''),
      L('Tempo médio', duracao(p.tempoMedioS), 'por sessão, com a aba visível'),
      L('Tempo total', nf1.format(p.tempoTotalH || 0) + ' h', 'somando todas as sessões'),
      L('Jogaram', num(p.jogaram), pct(p.jogaram, p.visitantes) + ' dos visitantes'),
      L('Jogos iniciados', num(somaModos(p.inicios)), porModo(p.inicios)),
      L('Jogos terminados', num(somaModos(p.fins)), porModo(p.fins)),
      L('Partidas no Imersivo', num(p.partidasImersivo), 'partidas jogadas até o fim'),
      L('Nota média', notas.media === null || notas.media === undefined ? '—' : num(notas.media),
        notas.melhor === null || notas.melhor === undefined ? 'nas carreiras terminadas' : 'melhor: ' + num(notas.melhor)),
      L('Cadastros', num(p.cadastros), num(p.logins) + ' logins'),
      L('Viram o convite de conta', num(g.vistos), num(g.fechados) + ' fecharam · ' + num(g.cadastrosDepois) + ' criaram conta depois'),
    ].forEach((c) => box.appendChild(c));
  }

  // Barras horizontais (funil, origens, aparelhos). max: base da escala (null = o maior valor).
  function barras(box, itens, max, textoVazio) {
    LP.limpar(box);
    if (!itens.length) {
      box.appendChild(h('p', { class: 'vazio' }, textoVazio));
      return;
    }
    const base = max || Math.max(1, ...itens.map((i) => i.n || 0));
    itens.forEach((i) => {
      const nome = h('div', { class: 'barra-nome', title: i.nome }, i.nome);
      const cheia = h('div', { class: 'barra-cheia' });
      cheia.style.width = (base ? Math.min(100, ((i.n || 0) / base) * 100) : 0) + '%';
      const valor = h('div', { class: 'barra-valor' }, num(i.n || 0));
      if (i.extra) valor.appendChild(h('small', null, i.extra));
      box.appendChild(h('div', { class: 'barra-linha' }, nome, h('div', { class: 'barra-trilho' }, cheia), valor));
    });
  }
  LP.barras = barras;

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
  function coluna(x, y, w, hh, cls) {
    if (hh <= 0) return null;
    const r = Math.min(4, w / 2, hh);
    const d = 'M' + x + ',' + (y + hh) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y + 'H' + (x + w - r) +
      'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + hh) + 'Z';
    return LP.svg('path', { d: d, class: cls });
  }

  // Dica (tooltip): valores primeiro, nomes depois.
  function mostrarDica(alvo, titulo, linhas) {
    const dica = $('dica');
    LP.limpar(dica);
    dica.appendChild(h('div', { class: 'dica-titulo' }, titulo));
    linhas.forEach((l) => {
      const row = h('div', { class: 'dica-linha' });
      if (l.cor) { const t = h('i', { class: 'dica-traco' }); t.style.background = l.cor; row.appendChild(t); }
      row.appendChild(h('b', null, l.valor));
      row.appendChild(h('span', null, l.nome));
      dica.appendChild(row);
    });
    dica.hidden = false;
    const r = alvo.getBoundingClientRect();
    const w = dica.offsetWidth;
    const hh = dica.offsetHeight;
    let x = r.left + r.width / 2 - w / 2;
    x = Math.max(8, Math.min(window.innerWidth - w - 8, x));
    let y = r.top - hh - 8;
    if (y < 8) y = r.bottom + 8;
    dica.style.left = x + 'px';
    dica.style.top = y + 'px';
  }
  let ativo = null;
  function esconderDica() {
    $('dica').hidden = true;
    if (ativo) { ativo.fundo.classList.remove('faixa-ativa'); ativo.g.classList.remove('grupo-ativo'); ativo = null; }
  }
  LP.esconderDica = esconderDica;
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
  const svg = LP.svg;

  // Colunas agrupadas por dia: visitantes e jogaram (um eixo só).
  function graficoDias(box, dias) {
    LP.limpar(box);
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
      t.textContent = LP.compacto(v);
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
    linhaBase(s, m, W, alt);
    box.appendChild(s);
  }
  function linhaBase(s, m, W, alt) { // linha de base por cima das colunas
    s.appendChild(svg('line', { x1: m.e, x2: W - m.d, y1: m.c + alt + 0.5, y2: m.c + alt + 0.5, class: 'grade' }));
  }

  function graficoHoras(box, horas) {
    LP.limpar(box);
    const W = Math.max(260, box.clientWidth || 500);
    const H = box.clientHeight || 170;
    const m = { e: 30, d: 4, c: 8, b: 22 };
    const larg = W - m.e - m.d;
    const alt = H - m.c - m.b;
    const max = Math.max(0, ...horas.map((x) => x.sessoes || 0));
    const esc = escala(max, 3);
    const s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Sessões por hora do dia' });
    for (let v = 0; v <= esc.topo + 1e-9; v += esc.passo) {
      const y = m.c + alt - (v / esc.topo) * alt;
      s.appendChild(svg('line', { x1: m.e, x2: W - m.d, y1: Math.round(y) + 0.5, y2: Math.round(y) + 0.5, class: 'grade' }));
      const t = svg('text', { x: m.e - 6, y: y + 4, 'text-anchor': 'end', class: 'eixo-texto' });
      t.textContent = LP.compacto(v);
      s.appendChild(t);
    }
    const faixa = larg / 24;
    const bw = Math.max(2, Math.min(24, faixa - 2));
    const c = cores();
    horas.forEach((x, i) => {
      const x0 = m.e + i * faixa;
      const altura = ((x.sessoes || 0) / esc.topo) * alt;
      const fundo = svg('rect', { x: x0, y: m.c, width: faixa, height: alt, class: 'alvo', tabindex: 0,
        'aria-label': x.hora + 'h: ' + (x.sessoes || 0) + ' sessões' });
      const g = svg('g', {});
      const col = coluna(x0 + (faixa - bw) / 2, m.c + alt - altura, bw, altura, 'serie-1');
      if (col) g.appendChild(col);
      ligarAlvo(fundo, g, () => ({
        titulo: String(x.hora).padStart(2, '0') + 'h–' + String(x.hora).padStart(2, '0') + 'h59 (Brasília)',
        linhas: [{ cor: c.s1, valor: num(x.sessoes), nome: 'sessões' }],
      }));
      s.appendChild(fundo);
      s.appendChild(g);
      if (i % (larg < 400 ? 6 : 3) === 0) {
        const t = svg('text', { x: x0 + faixa / 2, y: H - 6, 'text-anchor': 'middle', class: 'eixo-texto' });
        t.textContent = x.hora + 'h';
        s.appendChild(t);
      }
    });
    linhaBase(s, m, W, alt);
    box.appendChild(s);
  }

  function linhaTabela(tabela, celulas, cab) {
    const tr = h('tr');
    celulas.forEach((c) => {
      const td = h(cab ? 'th' : 'td', { class: c.num ? 'num' : null });
      if (c.no) td.appendChild(c.no); else td.textContent = c.t === undefined ? '' : String(c.t);
      tr.appendChild(td);
    });
    tabela.appendChild(tr);
  }

  function tabelaDias(dias) {
    const t = $('tabela-dias');
    LP.limpar(t);
    linhaTabela(t, [{ t: 'Dia' }, { t: 'Visitantes', num: 1 }, { t: 'Jogaram', num: 1 }, { t: 'Sessões', num: 1 }, { t: 'Terminados', num: 1 },
      { t: 'Cadastros', num: 1 }, { t: 'Tempo médio', num: 1 }], true);
    dias.slice().reverse().forEach((d) => linhaTabela(t, [{ t: diaLongo(d.dia) }, { t: num(d.visitantes), num: 1 }, { t: num(d.jogaram), num: 1 },
      { t: num(d.sessoes), num: 1 }, { t: num(d.fins), num: 1 }, { t: num(d.cadastros), num: 1 }, { t: duracao(d.tempoMedioS), num: 1 }]));
  }

  function desenharContas(c, ultimos, p) {
    const box = $('ladrilhos-contas');
    LP.limpar(box);
    const cs = c.carreiras || {};
    const np = cs.noPeriodo || {};
    const L = LP.ladrilho;
    [
      L('Contas', num(c.total), num(c.comCarreira) + ' com carreira salva'),
      L('Novas no período', num(c.novas), p.visitantes ? pct(c.novas, p.visitantes) + ' dos visitantes' : ''),
      L('Carreiras salvas', num(cs.total), 'automáticas ' + num(cs.auto) + ' · manuais ' + num(cs.manual)),
      L('Salvas no período', num((np.auto || 0) + (np.manual || 0)), 'automáticas ' + num(np.auto) + ' · manuais ' + num(np.manual)),
    ].forEach((x) => box.appendChild(x));

    const tm = $('tabela-melhores');
    LP.limpar(tm);
    const melhores = c.melhores || [];
    if (!melhores.length) {
      linhaTabela(tm, [{ t: 'Nenhuma carreira salva ainda.' }]);
    } else {
      linhaTabela(tm, [{ t: '#' }, { t: 'Conta' }, { t: 'Jogador' }, { t: 'Nota', num: 1 }, { t: 'Pico', num: 1 }, { t: 'Modo' }, { t: 'Salva' }], true);
      melhores.forEach((m, i) => {
        const selo = h('span', { class: 'selo' + (m.como === 'auto' ? ' selo-auto' : '') }, m.como === 'auto' ? 'auto' : 'manual');
        linhaTabela(tm, [{ t: i + 1 }, { t: m.apelido }, { t: m.jogador }, { t: num(m.nota), num: 1 }, { t: num(m.picoOvr), num: 1 },
          { t: LP.NOMES_MODO[m.modo] || m.modo }, { no: selo }]);
      });
    }

    const tc = $('tabela-cadastros');
    LP.limpar(tc);
    if (!ultimos.length) {
      linhaTabela(tc, [{ t: 'Nenhum cadastro ainda.' }]);
    } else {
      linhaTabela(tc, [{ t: 'Apelido' }, { t: 'Quando' }, { t: 'Origem' }], true);
      ultimos.forEach((u) => linhaTabela(tc, [{ t: u.apelido }, { t: dataHora(u.em) }, { t: LP.origem(u.origem) }]));
    }
  }

  // ── controles ───────────────────────────────────────────────────────────────────────────────
  function marcarPeriodo() {
    document.querySelectorAll('[data-periodo]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.periodo === estado.periodo)));
    $('incluir-bots').checked = estado.bots;
  }

  function ligarControles() {
    if (estado.ligado) return;
    estado.ligado = true;
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
    let espera = 0;
    window.addEventListener('resize', () => {
      clearTimeout(espera);
      espera = setTimeout(() => {
        if (estado.dados && estado.montada) {
          graficoDias($('grafico-dias'), estado.dados.dias || []);
          graficoHoras($('grafico-horas'), estado.dados.horas || []);
        }
      }, 150);
    });
    window.addEventListener('scroll', esconderDica, { passive: true });
    document.addEventListener('pointerdown', (e) => { if (!(e.target instanceof Element) || !e.target.closest('.alvo')) esconderDica(); });
  }

  LP.abas.visao = {
    titulo: 'Visão geral',
    sub: 'Visitantes, jogos e contas · números ao vivo a cada 15 s',
    montar: function () {
      ligarControles();
      estado.montada = true;
      if (LP.resumo) LP.desenharPlataforma(LP.resumo);
      if (estado.dados) {
        // volta para a aba: redesenha já (os gráficos precisam da largura de agora) e busca de novo
        desenhar(estado.dados);
      }
      carregarTudo();
      clearInterval(estado.timerTudo);
      estado.timerTudo = setInterval(() => { if (!document.hidden) carregarTudo(); }, 5 * 60000);
    },
    sair: function () {
      estado.montada = false;
      clearInterval(estado.timerTudo);
      estado.timerTudo = 0;
      esconderDica();
    },
    recarregar: function () { carregarTudo(); },
    esquecer: function () { estado.dados = null; },
  };
})();
