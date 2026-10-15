/* LENDA · painel — Relatórios prontos com CSV (admin.php?r=relatorio, P1-11) e Tempo de jogo (?r=tempo, A11: total,
 * por dia, por modo, ranking e as sessões de um jogador). Também o gráfico de colunas por dia usado no Registro (A9). */
'use strict';

(function () {
  const LP = window.LP;
  const { h } = LP;

  /** Colunas por dia (SVG próprio, com dica por toque/teclado). series: [{chave, nome, classe: 'serie-1'|'serie-2', fmt}]. */
  LP.graficoColunas = function (box, dias, series, opcoes) {
    const o = opcoes || {};
    LP.limpar(box);
    const W = Math.max(280, box.clientWidth || 600);
    const H = box.clientHeight || 200;
    const m = { e: 40, d: 6, c: 10, b: 24 };
    const larg = W - m.e - m.d;
    const alt = H - m.c - m.b;
    const un = o.unidade || 1;
    const max = Math.max(0, ...dias.map((d) => Math.max(...series.map((s) => Number(d[s.chave]) || 0)))) / un;
    const passos = 4;
    let topo = 4;
    let passo = 1;
    if (max > 0) {
      const bruto = max / passos;
      const mag = Math.pow(10, Math.floor(Math.log10(bruto)));
      const nn = bruto / mag;
      passo = Math.max(1, (nn <= 1 ? 1 : nn <= 2 ? 2 : nn <= 2.5 ? 2.5 : nn <= 5 ? 5 : 10) * mag);
      topo = Math.ceil(max / passo) * passo;
    }
    topo *= un;
    passo *= un;
    const svg = LP.svg('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': o.rotulo || 'Gráfico por dia' });
    for (let v = 0; v <= topo + 1e-9; v += passo) {
      const y = m.c + alt - (v / topo) * alt;
      svg.appendChild(LP.svg('line', { x1: m.e, x2: W - m.d, y1: Math.round(y) + 0.5, y2: Math.round(y) + 0.5, class: 'grade' }));
      const t = LP.svg('text', { x: m.e - 6, y: y + 4, 'text-anchor': 'end', class: 'eixo-texto' });
      t.textContent = v === 0 ? '0' : o.eixo ? o.eixo(v) : LP.compacto(v);
      svg.appendChild(t);
    }
    const n = Math.max(1, dias.length);
    const faixa = larg / n;
    const bw = Math.max(2, Math.min(22, (faixa - 6) / series.length - 1));
    const passoRotulo = Math.ceil(n / Math.max(1, Math.floor(larg / 46)));
    dias.forEach((d, i) => {
      const x0 = m.e + i * faixa;
      const cx = x0 + faixa / 2;
      const fundo = LP.svg('rect', { x: x0, y: m.c, width: faixa, height: alt, class: 'alvo', tabindex: 0,
        'aria-label': LP.diaLongo(d.dia) + ': ' + series.map((s) => (s.fmt ? s.fmt(d[s.chave]) : LP.inteiro(d[s.chave])) + ' ' + s.nome).join(', ') });
      const g = LP.svg('g', {});
      series.forEach((s, k) => {
        const v = Number(d[s.chave]) || 0;
        const hh = (v / topo) * alt;
        if (hh <= 0) return;
        const x = cx - (series.length * (bw + 1)) / 2 + k * (bw + 1);
        const y = m.c + alt - hh;
        const r = Math.min(4, bw / 2, hh);
        g.appendChild(LP.svg('path', { class: s.classe, d: 'M' + x + ',' + (y + hh) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y + 'H' + (x + bw - r) + 'Q' + (x + bw) + ',' + y + ' ' + (x + bw) + ',' + (y + r) + 'V' + (y + hh) + 'Z' }));
      });
      const titulo = h('title');
      titulo.textContent = fundo.getAttribute('aria-label');
      fundo.appendChild(titulo);
      svg.appendChild(fundo);
      svg.appendChild(g);
      if (i % passoRotulo === 0 || n <= 8) {
        const t = LP.svg('text', { x: cx, y: H - 6, 'text-anchor': 'middle', class: 'eixo-texto' });
        t.textContent = LP.diaCurto(d.dia);
        svg.appendChild(t);
      }
    });
    svg.appendChild(LP.svg('line', { x1: m.e, x2: W - m.d, y1: m.c + alt + 0.5, y2: m.c + alt + 0.5, class: 'grade' }));
    box.appendChild(svg);
  };

  // ═══ Relatórios (P1-11) ══════════════════════════════════════════════════════════════════════
  const RELATORIOS = [
    ['nunca_jogaram', 'Nunca jogaram'], ['sumidos30', 'Sumidos há 30 dias'], ['engajados', 'Mais engajados'], ['sem_carreira', 'Sem carreira'],
    ['nunca_no_hall', 'Nunca no Hall'], ['suspensos', 'Suspensos'], ['indicadores', 'Quem mais indicou'], ['bonus_parado', 'Bônus parado'],
    ['testers', 'Testers'], ['base', 'Base inteira'],
  ];
  const rel = { tipo: 'nunca_jogaram', conta: '', pagina: 1, corpo: null, filtros: null, d: null };

  function montarRelatorios(raiz, rota) {
    const q = rota.query;
    rel.tipo = RELATORIOS.some((r) => r[0] === q.tipo) ? q.tipo : 'nunca_jogaram';
    rel.conta = ['jogador', 'tester', 'criador', 'oficial', 'teste'].includes(q.conta) ? q.conta : '';
    rel.pagina = Math.max(1, parseInt(q.pagina, 10) || 1);
    rel.d = null;
    rel.corpo = h('div');
    rel.filtros = h('div');
    LP.trocar(raiz, h('div', { class: 'filtros-chips', role: 'group', 'aria-label': 'Relatórios' }, RELATORIOS.map(([k, t]) => {
      const b = h('button', { type: 'button', class: 'chip-filtro', 'aria-pressed': String(k === rel.tipo), dataset: { tipo: k } }, t);
      b.addEventListener('click', () => {
        rel.tipo = k;
        rel.pagina = 1;
        raiz.querySelectorAll('[data-tipo]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.tipo === k)));
        carregarRel();
      });
      return b;
    })), rel.filtros, rel.corpo);
    carregarRel();
  }

  async function carregarRel() {
    if (!LP.visivel(rel.corpo)) return;
    LP.trocarQuery('relatorios', { tipo: rel.tipo, conta: rel.conta, pagina: rel.pagina > 1 ? rel.pagina : '' });
    if (!rel.d) LP.trocar(rel.corpo, LP.estadoCarregando(6)); else rel.corpo.classList.add('esmaecido');
    try {
      const d = await LP.adminGet('relatorio', { tipo: rel.tipo, conta: rel.conta, pagina: rel.pagina }, { sinal: LP.unico('relatorio') });
      if (!LP.visivel(rel.corpo)) return;
      rel.d = d;
      rel.corpo.classList.remove('esmaecido');
      desenharRel(d);
    } catch (e) {
      if (LP.cancelado(e)) return;
      rel.corpo.classList.remove('esmaecido');
      if ((e && e.status === 401) || !LP.visivel(rel.corpo)) return;
      rel.d = null;
      LP.trocar(rel.corpo, LP.estadoErro(e, carregarRel));
    }
  }

  function desenharRel(d) {
    const itens = Array.isArray(d.itens) ? d.itens : [];
    const pt = d.porTipo || {};
    LP.subAba((d.titulo || '') + ' · ' + LP.inteiro(d.total || 0) + ' de ' + LP.plural(d.base || 0, 'conta', 'contas'));
    LP.trocar(rel.filtros, h('div', { class: 'ferramentas' },
      LP.segmentos('Tipo de conta', [{ valor: '', rotulo: 'Todo tipo' }].concat(['jogador', 'tester', 'criador', 'oficial', 'teste'].map((t) => ({ valor: t, rotulo: LP.NOMES_TIPO_CONTA[t], contador: pt[t] }))), rel.conta,
        (v) => { rel.conta = v; rel.pagina = 1; carregarRel(); }),
      h('span', { class: 'espaco' }),
      itens.length && LP.pode('exportar') ? LP.botao('Baixar CSV', async () => {
        try {
          await LP.baixarDoServidor(LP.urlAdmin('relatorio', { tipo: rel.tipo, conta: rel.conta, csv: 1 }));
          LP.avisar('O CSV com ' + LP.plural(d.total || 0, 'conta', 'contas') + ' está baixando. Fica anotado no Registro.', 'info');
        } catch (e) { LP.avisarErro(e); }
      }, { tipo: 'fantasma', icone: 'baixar', gerundio: 'Preparando…' }) : null),
    LP.ajuda(d.porque || ''));
    if (!itens.length) { LP.trocar(rel.corpo, LP.estadoVazio('Ninguém neste relatório. É uma boa notícia.', rel.conta ? 'Com o filtro de tipo de conta.' : '')); return; }
    LP.trocar(rel.corpo, h('p', { class: 'texto-3 espaco-baixo' }, LP.inteiro(d.total || 0) + ' de ' + LP.plural(d.base || 0, 'conta', 'contas') + (d.total > (d.porPagina || 100) ? ' · a tela mostra ' + (d.porPagina || 100) + ' por página; o CSV traz todas' : '')),
      LP.lista({
        itens: itens,
        aoClicar: (u) => LP.abrirConta(u.id),
        rotuloLinha: (u) => 'Abrir ' + u.apelido,
        colunas: [
          { rotulo: 'Conta', principal: true, classe: 'celula-larga', celula: (u) => h('div', { class: 'celula-dupla' }, h('span', null, u.apelido, LP.chipTipo(u.tipo)), h('span', null, LP.email(u.email), ' · #' + u.id)) },
          { rotulo: 'Situação', celula: (u) => LP.chipStatus(u.status) },
          { rotulo: 'Criada', celula: (u) => LP.quando(u.criadoEm) },
          { rotulo: 'Último acesso', celula: (u) => h('span', null, LP.quando(u.ultimoAcesso), u.diasSemAcesso ? h('span', { class: 'texto-3' }, ' · ' + LP.plural(u.diasSemAcesso, 'dia', 'dias')) : null) },
          { rotulo: 'Partidas', num: true, celula: (u) => LP.inteiro(u.partidas) },
          { rotulo: 'Carreiras', num: true, celula: (u) => LP.inteiro(u.carreiras) },
          { rotulo: 'Indicações válidas', num: true, celula: (u) => LP.inteiro(u.indicacoesValidas) },
          { rotulo: 'Bônus abertos', num: true, celula: (u) => LP.inteiro(u.bonusAbertos) },
        ],
      }),
      LP.paginacao(d.total || 0, d.pagina || rel.pagina, d.porPagina || 100, (p) => { rel.pagina = p; carregarRel(); window.scrollTo(0, 0); }));
  }

  LP.abas.relatorios = { titulo: 'Relatórios', sub: '', montar: montarRelatorios, recarregar: () => carregarRel() };

  // ═══ Tempo de jogo (A11) ═════════════════════════════════════════════════════════════════════
  const JANELAS = [['semana', 'Esta semana'], ['passada', 'Semana passada'], ['mes', 'Este mês'], ['d30', 'Últimos 30 dias'], ['tudo', 'Tudo']];
  const GRUPOS = [['jogadores', 'Jogadores'], ['todos', 'Todos'], ['testes', 'Contas de teste']];
  const tp = { jan: 'semana', grupo: 'jogadores', usuario: '', corpo: null, filtros: null, d: null };

  function montarTempo(raiz, rota) {
    const q = rota.query;
    tp.jan = JANELAS.some((j) => j[0] === q.jan) ? q.jan : 'semana';
    tp.grupo = GRUPOS.some((g) => g[0] === q.grupo) ? q.grupo : 'jogadores';
    tp.usuario = /^\d{1,10}$/.test(q.usuario || '') ? q.usuario : '';
    tp.d = null;
    tp.filtros = h('div', { class: 'ferramentas' });
    tp.corpo = h('div');
    LP.trocar(raiz, tp.filtros, tp.corpo);
    desenharFiltrosTempo();
    carregarTempo();
  }
  function desenharFiltrosTempo() {
    LP.trocar(tp.filtros,
      LP.segmentos('Período', JANELAS.map(([v, r]) => ({ valor: v, rotulo: r })), tp.jan, (v) => { tp.jan = v; desenharFiltrosTempo(); carregarTempo(); }),
      LP.segmentos('Quem', GRUPOS.map(([v, r]) => ({ valor: v, rotulo: r, title: v === 'jogadores' ? 'Sem as contas tester, teste e oficial (os visitantes sem conta entram)' : v === 'testes' ? 'Só as contas tester, teste e oficial' : '' })), tp.grupo,
        (v) => { tp.grupo = v; desenharFiltrosTempo(); carregarTempo(); }),
      h('span', { class: 'espaco' }),
      LP.pode('exportar') ? LP.botao('Baixar CSV', async () => {
        try {
          await LP.baixarDoServidor(LP.urlAdmin('tempo', { jan: tp.jan, grupo: tp.grupo, csv: 1 }));
          LP.avisar('O CSV do ranking está baixando. Fica anotado no Registro.', 'info');
        } catch (e) { LP.avisarErro(e); }
      }, { tipo: 'fantasma', icone: 'baixar', gerundio: 'Preparando…' }) : null);
  }
  async function carregarTempo() {
    if (!LP.visivel(tp.corpo)) return;
    LP.trocarQuery('tempo', { jan: tp.jan === 'semana' ? '' : tp.jan, grupo: tp.grupo === 'jogadores' ? '' : tp.grupo, usuario: tp.usuario });
    if (!tp.d) LP.trocar(tp.corpo, LP.estadoCarregando(6)); else tp.corpo.classList.add('esmaecido');
    try {
      const d = await LP.adminGet('tempo', { jan: tp.jan, grupo: tp.grupo, usuario: tp.usuario }, { sinal: LP.unico('tempo') });
      if (!LP.visivel(tp.corpo)) return;
      tp.d = d;
      tp.corpo.classList.remove('esmaecido');
      desenharTempo(d);
    } catch (e) {
      if (LP.cancelado(e)) return;
      tp.corpo.classList.remove('esmaecido');
      if ((e && e.status === 401) || !LP.visivel(tp.corpo)) return;
      tp.d = null;
      LP.trocar(tp.corpo, LP.estadoErro(e, carregarTempo));
    }
  }
  function desenharTempo(d) {
    const t = d.total || {};
    LP.subAba((d.de ? LP.data(d.de) : 'desde o começo') + ' a ' + LP.data(d.ate || new Date().toISOString()) + ' · ' + (GRUPOS.find((g) => g[0] === tp.grupo) || [0, ''])[1].toLowerCase());
    const L = LP.ladrilho;
    const ladr = h('div', { class: 'ladrilhos espaco-baixo' },
      L('Tempo com o jogo aberto', LP.tempo(t.ativoS), 'aba visível'),
      L('Jogando', LP.tempo(t.jogandoS), LP.pct(t.jogandoS || 0, t.ativoS || 0) + ' do tempo aberto'),
      L('Sessões', LP.inteiro(t.sessoes), 'de 30 s ou mais'),
      L('Média por sessão', LP.duracao(t.mediaS), 'das sessões de 30 s ou mais'),
      L('Contas', LP.inteiro(t.jogadores), 'com pelo menos uma sessão'),
      L('Aparelhos', LP.inteiro(t.aparelhos), 'visitantes diferentes'));
    const grafico = h('div', { class: 'grafico' });
    const cDia = h('section', { class: 'cartao' }, h('div', { class: 'cartao-cabeca' }, h('h2', null, 'Por dia'),
      h('div', { class: 'legenda', 'aria-hidden': 'true' }, h('span', null, h('i', { class: 'chave chave-1' }), 'Jogo aberto'), h('span', null, h('i', { class: 'chave chave-2' }), 'Jogando'))), grafico);
    const modos = h('div', { class: 'barras' });
    const cModo = h('section', { class: 'cartao' }, h('h2', null, 'Por modo'), h('p', { class: 'texto-3' }, 'Tempo jogando em cada modo.'), modos);
    const rk = Array.isArray(d.ranking) ? d.ranking : [];
    const cRank = h('section', { class: 'cartao' }, h('h2', null, 'Quem mais jogou ', h('span', { class: 'texto-3' }, 'clique para ver as sessões')), rk.length ? LP.lista({
      itens: rk,
      aoClicar: (u) => { tp.usuario = String(u.id); carregarTempo(); },
      rotuloLinha: (u) => 'Ver as sessões de ' + u.apelido,
      colunas: [
        { rotulo: 'Conta', principal: true, celula: (u) => h('span', { class: 'chips' }, LP.linkUsuario(u), LP.chipTipo(u.tipo)) },
        { rotulo: 'Jogo aberto', num: true, celula: (u) => LP.tempo(u.ativoS) },
        { rotulo: 'Jogando', num: true, celula: (u) => LP.tempo(u.jogandoS) },
        { rotulo: 'Sessões', num: true, celula: (u) => LP.inteiro(u.sessoes) },
      ],
    }) : LP.estadoVazio('Ninguém com conta jogou neste período', ''));
    let cSess = null;
    if (tp.usuario && Array.isArray(d.sessoes)) {
      const quem = rk.find((u) => String(u.id) === tp.usuario);
      cSess = h('section', { class: 'cartao' }, h('div', { class: 'cartao-cabeca' }, h('h2', null, 'Sessões de ', quem ? LP.linkUsuario(quem) : '#' + tp.usuario),
        LP.botao('Fechar', () => { tp.usuario = ''; carregarTempo(); }, { tipo: 'fantasma', pequeno: true, icone: 'x' })),
      d.sessoes.length ? LP.lista({
        itens: d.sessoes,
        colunas: [
          { rotulo: 'Início', principal: true, celula: (s) => LP.dataHoraAno(s.inicio) },
          { rotulo: 'Jogo aberto', num: true, celula: (s) => LP.duracao(s.ativoS) },
          { rotulo: 'Jogando', num: true, celula: (s) => LP.duracao(s.jogandoS) },
          { rotulo: 'Modo', celula: (s) => (s.modo ? LP.NOMES_MODO[s.modo] || s.modo : '—') },
          { rotulo: 'Aparelho', celula: (s) => LP.aparelho(s.aparelho) },
          { rotulo: 'Origem', celula: (s) => LP.origemCurta(s.origem) },
        ],
      }) : h('p', { class: 'texto-3' }, 'Nenhuma sessão neste período.'));
    }
    LP.trocar(tp.corpo, LP.ajuda(d.regua || 'Conta só com a aba do jogo visível (batimento a cada 15 s).'), ladr, cSess, cDia, h('div', { class: 'duas-colunas alinhar-topo' }, cModo, cRank));
    const pd = Array.isArray(d.porDia) ? d.porDia : [];
    if (pd.length) LP.graficoColunas(grafico, pd, [{ chave: 'ativoS', nome: 'com o jogo aberto', classe: 'serie-1', fmt: LP.tempo }, { chave: 'jogandoS', nome: 'jogando', classe: 'serie-2', fmt: LP.tempo }], { rotulo: 'Tempo por dia', unidade: pd.some((x) => x.ativoS >= 7200) ? 3600 : 60, eixo: (v) => (v >= 3600 ? LP.nf1.format(v / 3600) + ' h' : Math.round(v / 60) + ' min') });
    else LP.trocar(grafico, h('p', { class: 'vazio' }, 'Sem tempo registrado no período.'));
    if (LP.barras) LP.barras(modos, (d.porModo || []).map((m) => ({ nome: LP.NOMES_MODO[m.modo] || m.modo, n: m.jogandoS || 0, valor: LP.tempo(m.jogandoS), extra: LP.plural(m.sessoes || 0, 'sessão', 'sessões') })), null, 'Ninguém jogou neste período.');
  }
  LP.abas.tempo = { titulo: 'Tempo de jogo', sub: '', montar: montarTempo, recarregar: () => carregarTempo() };
})();
