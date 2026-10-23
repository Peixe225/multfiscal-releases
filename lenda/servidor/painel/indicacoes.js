/* LENDA · painel — Indicações e bônus: a fila de indicações com sinais antifraude e recusa em lote
 * (admin.php?r=indicacoes, indicacoes_lote), os grupos de contas no mesmo aparelho (?r=multicontas) e a lista global
 * de bônus com "tirar" em lote (?r=bonus, tirar_bonus_lote: X5). */
'use strict';

(function () {
  const LP = window.LP;
  const { h } = LP;

  const PARTES = ['', 'pendente', 'valida', 'recusada', 'suspeitas', 'aparelho', 'bonus'];
  const ind = { status: '', indicador: '', pagina: 1, corpo: null, topo: null, filtros: null, temDados: false, itens: [], marcados: new Set(), lote: null, tabela: null, fila: null,
    bonus: { estado: 'abertos', origem: '' } };

  function montar(raiz, rota) {
    const q = rota.query;
    ind.status = PARTES.includes(q.status) ? q.status : '';
    ind.indicador = /^\d{1,10}$/.test(q.indicador || '') ? q.indicador : '';
    ind.pagina = Math.max(1, parseInt(q.pagina, 10) || 1);
    ind.bonus = { estado: ['abertos', 'usados', 'todos'].includes(q.estado) ? q.estado : 'abertos', origem: ['indicacao', 'compartilhar', 'admin'].includes(q.origem) ? q.origem : '' };
    ind.temDados = false;
    ind.marcados = new Set();
    ind.fila = null;
    ind.topo = h('div');
    ind.corpo = h('div');
    ind.filtros = h('div');
    LP.trocar(raiz, ind.topo, h('div', { class: 'ferramentas' }, ind.filtros), ind.corpo);
    desenharFiltros();
    desenharTopo();
    carregar();
  }

  function desenharFiltros() {
    if (!ind.filtros || !ind.filtros.isConnected) return;
    const r = LP.resumo || {};
    const i = r.indicacoes || {};
    const b = r.bonus || {};
    const ac = (LP.agora && LP.agora.acao) || {};
    const base = r.base || {};
    // no lugar (pulso, resumo, clique): o chip continua o mesmo e o foco do teclado fica nele
    LP.trocarSegmentos(ind.filtros, 'Mostrar', [
      { valor: '', rotulo: 'Todas' },
      { valor: 'pendente', rotulo: 'Pendentes', contador: ac.indicacoesPendentes !== undefined ? ac.indicacoesPendentes : i.pendentes, tipoContador: 'alerta' },
      { valor: 'valida', rotulo: 'Válidas', contador: i.validas },
      { valor: 'recusada', rotulo: 'Recusadas', contador: i.recusadas },
      { valor: 'suspeitas', rotulo: 'Suspeitas', title: 'Com sinal grave: mesmo aparelho do indicador ou série de 5+ em 24 h' },
      { valor: 'aparelho', rotulo: 'Mesmo aparelho', contador: base.multicontas || 0, tipoContador: base.multicontas ? 'alerta' : '' },
      { valor: 'bonus', rotulo: 'Bônus', contador: b.naoUsados, title: 'Todos os bônus de OVR, com "tirar" em lote' },
    ], ind.status, (v) => { ind.status = v; ind.indicador = ''; ind.pagina = 1; ind.marcados.clear(); ind.fila = null; ind.temDados = false; desenharFiltros(); carregar(); });
  }

  function desenharTopo() {
    if (!ind.topo || !ind.topo.isConnected) return;
    const r = LP.resumo || {};
    const i = r.indicacoes || {};
    const b = r.bonus || {};
    const cfg = (r.site && r.site.bonus) || null;
    // data-foco: o resumo de 60 s redesenha o topo e o foco do teclado volta para o mesmo ladrilho (ou para o "Regras")
    const L = (rot, val, extra, o) => { const x = LP.ladrilho(rot, val, extra, o); x.dataset.foco = rot; return x; };
    const regras = cfg
      ? h('details', { class: 'cartao cartao-secundario espaco-baixo', dataset: { foco: 'regras' } },
        h('summary', null, 'Regras em vigor', h('a', { href: '#/config', class: 'botao-fantasma botao-pequeno' }, 'Mudar em Configurações')),
        h('ul', { class: 'texto-2' },
          h('li', null, 'Amigo que entra pelo link e termina a 1ª carreira: ' + (cfg.indicacao || []).slice(0, Math.max(1, cfg.maxIndicacoes || 0)).map((v, k) => (k + 1) + 'º +' + v).join(', ') + ' de OVR (até ' + cfg.maxIndicacoes + ' amigos).'),
          h('li', null, 'Compartilhar o card final de uma carreira: +' + cfg.compartilhar + ' de OVR, 1 vez por dia.'),
          h('li', null, 'Os bônus de compartilhar e de indicar só liberam depois de ' + LP.plural(cfg.liberaAposPartidas, 'partida', 'partidas') + ' terminadas com a conta (até lá ficam guardados).'),
          h('li', null, 'Bônus dado pela equipe vale na hora.')))
      : null;
    const aberto = !!(regras && ind.topo.querySelector('details[open]'));
    if (aberto) regras.open = true;
    LP.trocarNoLugar(ind.topo, h('div', { class: 'ladrilhos espaco-baixo' },
      L('Válidas', LP.inteiro(i.validas), 'deram bônus ao indicador', { href: '#/indicacoes?status=valida' }),
      L('Pendentes', LP.inteiro(i.pendentes), 'o amigo ainda não terminou a 1ª carreira', { href: '#/indicacoes?status=pendente' }),
      L('Recusadas', LP.inteiro(i.recusadas), 'mesmo aparelho, própria conta, limite…', { href: '#/indicacoes?status=recusada' }),
      L('Bônus esperando uso', LP.inteiro(b.naoUsados), 'em todas as contas', { href: '#/indicacoes?status=bonus' }),
      L('Bônus usados', LP.inteiro(b.usados), 'em carreiras do Clássico', { href: '#/indicacoes?status=bonus&estado=usados' })), regras);
  }

  async function carregar(silencioso, novos) {
    if (!LP.visivel(ind.corpo)) return null;
    const qs = { status: ind.status, indicador: ind.indicador, pagina: ind.pagina > 1 ? ind.pagina : '' };
    if (ind.status === 'bonus') Object.assign(qs, { estado: ind.bonus.estado === 'abertos' ? '' : ind.bonus.estado, origem: ind.bonus.origem });
    LP.trocarQuery('indicacoes', qs);
    if (!silencioso) {
      ind.fila = LP.filaDoPulso('indicacoes');
      if (!ind.temDados) LP.trocar(ind.corpo, LP.estadoCarregando(5));
      else ind.corpo.classList.add('esmaecido');
    }
    try {
      let d;
      const sinal = { sinal: LP.unico(silencioso ? 'indicacoes-pulso' : 'indicacoes') };
      const st = ind.status;
      if (st === 'aparelho') d = await LP.adminGet('multicontas', { pagina: ind.pagina }, sinal);
      else if (st === 'bonus') d = await LP.adminGet('bonus', { estado: ind.bonus.estado, origem: ind.bonus.origem, pagina: ind.pagina }, sinal);
      else d = await LP.adminGet('indicacoes', { status: st, indicador: ind.indicador, pagina: ind.pagina }, sinal);
      // a resposta de uma parte que já não está na tela não se desenha (nem com a forma de outra)
      if (!LP.visivel(ind.corpo) || st !== ind.status) return null;
      ind.corpo.classList.remove('esmaecido');
      if (silencioso) return d;
      ind.temDados = true;
      LP.esconderNovidade();
      if (ind.status === 'aparelho') desenharAparelhos(d);
      else if (ind.status === 'bonus') desenharBonus(d);
      else desenharIndicacoes(d, novos);
      return d;
    } catch (e) {
      if (LP.cancelado(e)) return null;
      ind.corpo.classList.remove('esmaecido');
      if (silencioso || (e && e.status === 401) || !LP.visivel(ind.corpo)) return null;
      ind.temDados = false;
      LP.trocar(ind.corpo, LP.estadoErro(e, () => carregar()));
      return null;
    }
  }

  // ── indicações ──
  const chipSt = (st) => LP.chip(LP.NOMES_STATUS_INDICACAO[st] || st, st === 'valida' ? 'ok' : st === 'recusada' ? 'perigo' : 'alerta');
  function desenharIndicacoes(d, novos) {
    const itens = Array.isArray(d.itens) ? d.itens : [];
    ind.itens = itens;
    const nome = { pendente: 'pendentes', valida: 'válidas', recusada: 'recusadas', suspeitas: 'suspeitas' }[ind.status] || 'indicações';
    LP.subAba(LP.inteiro(d.total || 0) + ' ' + nome + (ind.indicador ? ' deste indicador' : ''));
    const filtroIndicador = ind.indicador ? h('p', { class: 'faixa faixa-info' }, 'Só as indicações feitas pela conta #' + ind.indicador + '. ',
      LP.linkUsuario({ id: Number(ind.indicador), apelido: 'Abrir a ficha' }), ' · ', h('a', { href: '#/indicacoes' }, 'Ver todas')) : null;
    if (!itens.length) {
      document.body.classList.remove('com-lote');
      LP.trocar(ind.corpo, filtroIndicador, LP.estadoVazio(ind.status === 'suspeitas' ? 'Nenhuma indicação suspeita' : ind.status ? 'Nenhuma indicação com esse filtro' : 'Nenhuma indicação ainda',
        ind.status === 'suspeitas' ? 'É o que se espera.' : 'Cada conta tem um link de convite em "Minha conta → Convide amigos".'));
      return;
    }
    const recarregar = () => carregar();
    const comLote = LP.pode('bonus');
    const lote = comLote ? LP.barraLote({
      itens: () => ind.itens,
      pode: (x) => x.status !== 'recusada',
      marcados: ind.marcados,
      nome: ['indicação', 'indicações', 'f'],
      rotulo: (x) => (x.indicador && x.indicador.apelido) + ' → ' + (x.indicado && x.indicado.apelido),
      aoMudar: () => { if (ind.tabela) ind.tabela.sincronizarSelecao(); },
      acoes: [{ rotulo: (n) => 'Recusar ' + (n ? LP.plural(n, 'indicação', 'indicações') : 'marcadas'), tipo: 'perigo', icone: 'x', executar: (ids) => recusarLote(ids) }],
    }) : null;
    ind.lote = lote;
    ind.tabela = LP.lista({
      itens: itens,
      novos: novos,
      selecao: comLote ? { marcados: ind.marcados, pode: (x) => x.status !== 'recusada', aoMudar: () => lote.atualizar() } : null,
      rotuloLinha: (x) => 'Indicação ' + ((x.indicado && x.indicado.apelido) || x.id),
      colunas: [
        { rotulo: 'Indicador → indicado', principal: true, celula: (x) => h('span', { class: 'chips' }, LP.linkUsuario(x.indicador), h('span', { class: 'texto-3' }, '→'), LP.linkUsuario(x.indicado)) },
        { rotulo: 'Status', celula: (x) => chipSt(x.status) },
        { rotulo: 'Motivo', celula: (x) => (x.motivo ? LP.NOMES_MOTIVO_INDICACAO[x.motivo] || x.motivo : '—') },
        { rotulo: 'Sinais', classe: 'sinais-celula', celula: LP.celulaSinais },
        { rotulo: 'Criada', celula: (x) => LP.quando(x.criadaEm) },
        { rotulo: 'Validada', celula: (x) => (x.validadaEm ? LP.quando(x.validadaEm) : '—') },
        { rotulo: 'Bônus', celula: (x) => (x.bonus ? h('span', { class: 'chips' }, h('b', null, '+' + x.bonus.valor), x.bonus.usado ? LP.chip('usado', '', { semPonto: true }) : LP.chip('não usado', 'ouro', { semPonto: true })) : '—') },
        { rotulo: 'Ações', acoes: true, celula: (x) => (x.status === 'recusada' || !LP.pode('bonus') ? null : LP.botao('Recusar', () => LP.recusarIndicacao(x, () => { LP.depoisDeAgir(); recarregar(); }), { tipo: 'perigo', pequeno: true })) },
      ],
    });
    LP.trocarNoLugar(ind.corpo, filtroIndicador, lote ? lote.no : null, ind.tabela, LP.paginacao(d.total || 0, d.pagina || ind.pagina, d.porPagina || 50, (p) => { ind.pagina = p; ind.marcados.clear(); carregar(); LP.rolarParaAba(); }));
    if (lote) lote.atualizar();
  }

  async function recusarLote(ids) {
    const n = ids.length;
    const r = await LP.dialogoMotivo({
      titulo: 'Recusar ' + LP.plural(n, 'indicação', 'indicações'),
      perigo: true,
      botao: 'Recusar ' + LP.plural(n, 'indicação', 'indicações'),
      gerundio: 'Recusando…',
      chips: LP.MOTIVOS_INDICACAO,
      texto: n === 1 ? 'Ela deixa de contar para o indicador e o bônus dela é tirado (se já foi usado numa carreira, fica).'
        : 'Elas deixam de contar para os indicadores e os bônus delas são tirados (os já usados numa carreira ficam).',
      executar: (v) => LP.adminPost({ acao: 'indicacoes_lote', ids: ids.map(Number), operacao: 'recusar', motivo: v.motivo }),
    });
    if (!r) return;
    const feitos = r.recusadas || [];
    LP.avisar(LP.resumoLote(feitos.length, r.pulados, ['recusada', 'recusadas'], LP.PULOS) + (r.bonusTirados ? ' · ' + LP.plural(r.bonusTirados, 'bônus tirado', 'bônus tirados') : '') + '.');
    feitos.forEach((id) => ind.marcados.delete(String(id)));
    LP.marcarFeitos('indicacao', feitos);
    LP.depoisDeAgir();
    LP.sumirLinhas(ind.corpo, feitos, () => carregar());
  }

  // ── mesmo aparelho (P1-9) ──
  function desenharAparelhos(d) {
    const itens = Array.isArray(d.itens) ? d.itens : [];
    document.body.classList.remove('com-lote');
    LP.subAba(LP.plural(d.total || 0, 'grupo de contas no mesmo aparelho', 'grupos de contas no mesmo aparelho'));
    const ajuda = LP.ajuda('Contas que entraram pelo mesmo aparelho (o identificador anônimo do navegador). Família e amigos dividem aparelho; o sinal grave é quando elas se indicaram entre si. "Está tudo certo" some com o aviso até entrar uma conta nova no grupo.');
    const refazer = LP.botao('Recalcular agora', async () => {
      try {
        const r2 = await LP.adminGet('multicontas', { atualizar: 1, pagina: ind.pagina });
        desenharAparelhos(r2);
        LP.avisar('Grupos recalculados.');
      } catch (e) { LP.avisarErro(e); }
    }, { tipo: 'fantasma', pequeno: true, icone: 'atualizar', gerundio: 'Recalculando…' });
    const cab = h('div', { class: 'cartao-cabeca espaco-baixo' }, h('span', { class: 'texto-3' }, d.calculadoEm ? 'Calculado ' + LP.relativo(d.calculadoEm) + ' (refeito a cada 10 min)' : ''), refazer);
    if (!itens.length) { LP.trocar(ind.corpo, ajuda, cab, LP.estadoVazio('Nenhum aparelho com várias contas', 'É o que se espera.')); return; }
    const cartoes = itens.map((g) => {
      const contas = Array.isArray(g.contas) ? g.contas : [];
      const dispensar = g.dispensado
        ? h('span', { class: 'chips' }, LP.chip('Dispensado', '', { semPonto: true }), LP.botao('Reabrir', async () => {
          try { await LP.adminPost({ acao: 'alerta_reabrir', chave: g.chave }); LP.depoisDeAgir(); carregar(); } catch (e) { LP.avisarErro(e); }
        }, { tipo: 'fantasma', pequeno: true, gerundio: 'Reabrindo…' }))
        : LP.botao('Está tudo certo', async () => {
          if (!LP.confirmar('Some até entrar uma conta nova neste aparelho. Confirmar?')) return;
          try {
            await LP.adminPost({ acao: 'alerta_dispensar', chave: g.chave });
            LP.avisar('Grupo dispensado. Volta sozinho se entrar uma conta nova.');
            LP.depoisDeAgir();
            carregar();
          } catch (e) { LP.avisarErro(e); }
        }, { tipo: 'fantasma', pequeno: true, icone: 'check', gerundio: 'Dispensando…' });
      return h('article', { class: 'cartao-grupo' + (g.seIndicaram ? ' se-indicaram' : ''), dataset: { id: g.chave } },
        h('div', { class: 'denuncia-topo' },
          h('span', { class: 'chips' }, h('b', null, LP.plural(contas.length, 'conta', 'contas')), h('span', { class: 'texto-3 mono' }, 'aparelho ' + g.aparelho),
            g.seIndicaram ? h('span', { class: 'sinal sinal-grave' }, '⚠ se indicaram entre si') : null,
            g.ultimaVisita ? h('span', { class: 'texto-3' }, 'última visita ' + LP.relativo(g.ultimaVisita)) : null),
          dispensar),
        LP.lista({
          itens: contas,
          aoClicar: (c) => LP.abrirConta(c.id),
          rotuloLinha: (c) => 'Abrir ' + c.apelido,
          colunas: [
            { rotulo: 'Conta', principal: true, celula: (c) => LP.linkUsuario(c) },
            { rotulo: 'Situação', celula: (c) => LP.chipStatus(c.status) },
            { rotulo: 'Partidas', num: true, celula: (c) => LP.inteiro(c.partidas) },
            { rotulo: 'Criada', celula: (c) => LP.quando(c.criadoEm) },
          ],
        }));
    });
    LP.trocar(ind.corpo, ajuda, cab, h('div', null, cartoes), LP.paginacao(d.total || 0, d.pagina || ind.pagina, d.porPagina || 50, (p) => { ind.pagina = p; carregar(); LP.rolarParaAba(); }));
  }

  // ── bônus (X5) ──
  function desenharBonus(d) {
    const itens = Array.isArray(d.itens) ? d.itens : [];
    ind.itens = itens;
    const res = d.resumo || {};
    LP.subAba(LP.plural(d.total || 0, 'bônus', 'bônus') + ' · +' + LP.inteiro(res.valor || 0) + ' de OVR no total · ' + LP.inteiro(res.abertos || 0) + ' sem usar');
    const filtros = h('div', { class: 'ferramentas' },
      LP.segmentos('Estado', [{ valor: 'abertos', rotulo: 'Sem usar' }, { valor: 'usados', rotulo: 'Usados' }, { valor: 'todos', rotulo: 'Todos' }], ind.bonus.estado,
        (v) => { ind.bonus.estado = v; ind.pagina = 1; ind.marcados.clear(); carregar(); }),
      LP.segmentos('Origem', [{ valor: '', rotulo: 'Toda origem' }, { valor: 'indicacao', rotulo: 'Indicação' }, { valor: 'compartilhar', rotulo: 'Compartilhar' }, { valor: 'admin', rotulo: 'Equipe' }], ind.bonus.origem,
        (v) => { ind.bonus.origem = v; ind.pagina = 1; ind.marcados.clear(); carregar(); }));
    if (!itens.length) {
      document.body.classList.remove('com-lote');
      LP.trocar(ind.corpo, filtros, LP.estadoVazio('Nenhum bônus com esse filtro', 'Indicações válidas, o compartilhar do dia e os bônus da equipe aparecem aqui.'));
      return;
    }
    const comLote = LP.pode('bonus');
    const pode = (b) => !b.usadoEm;
    const lote = comLote ? LP.barraLote({
      itens: () => ind.itens,
      pode: pode,
      marcados: ind.marcados,
      nome: ['bônus', 'bônus', 'm'],
      rotulo: (b) => (b.usuario && b.usuario.apelido) || '',
      aoMudar: () => { if (ind.tabela) ind.tabela.sincronizarSelecao(); },
      acoes: [{ rotulo: (n) => 'Tirar ' + (n ? LP.plural(n, 'bônus', 'bônus') : 'marcados'), tipo: 'perigo', icone: 'menos', executar: (ids) => tirarLote(ids) }],
    }) : null;
    ind.lote = lote;
    ind.tabela = LP.lista({
      itens: itens,
      selecao: comLote ? { marcados: ind.marcados, pode: pode, aoMudar: () => lote.atualizar() } : null,
      rotuloLinha: (b) => 'Bônus de ' + ((b.usuario && b.usuario.apelido) || '#' + b.id),
      colunas: [
        { rotulo: 'Conta', principal: true, celula: (b) => LP.linkUsuario(b.usuario) },
        { rotulo: 'Valor', num: true, celula: (b) => h('b', null, '+' + b.valor) },
        { rotulo: 'Origem', celula: (b) => LP.NOMES_ORIGEM_BONUS[b.origem] || b.origem },
        { rotulo: 'Motivo / ref.', classe: 'quebra', celula: (b) => LP.refBonus ? LP.refBonus(b) : b.ref || '—' },
        { rotulo: 'Criado', celula: (b) => LP.quando(b.criadoEm) },
        { rotulo: 'Situação', celula: (b) => (b.usadoEm ? h('span', { title: b.carreiraId ? 'Na carreira ' + b.carreiraId : '' }, 'Usado ' + LP.relativo(b.usadoEm)) : b.disponivel ? LP.chip('Disponível', 'ok') : LP.chip('Guardado', 'alerta', { title: 'Libera depois das partidas com a conta' })) },
        { rotulo: 'Ações', acoes: true, celula: (b) => (b.usadoEm || !LP.pode('bonus') ? null : LP.botao('Tirar', () => LP.tirarBonus(b, b.usuario && b.usuario.apelido, () => { LP.depoisDeAgir(); carregar(); }), { tipo: 'perigo', pequeno: true, icone: 'menos' })) },
      ],
    });
    LP.trocar(ind.corpo, filtros, lote ? lote.no : null, ind.tabela, LP.paginacao(d.total || 0, d.pagina || ind.pagina, d.porPagina || 50, (p) => { ind.pagina = p; ind.marcados.clear(); carregar(); LP.rolarParaAba(); }));
    if (lote) lote.atualizar();
  }
  async function tirarLote(ids) {
    const n = ids.length;
    const r = await LP.dialogoMotivo({
      titulo: 'Tirar ' + LP.plural(n, 'bônus', 'bônus'),
      perigo: true,
      botao: 'Tirar ' + LP.plural(n, 'bônus', 'bônus'),
      gerundio: 'Tirando…',
      chips: [{ rotulo: 'Indicação falsa' }, { rotulo: 'Dado por engano' }, { rotulo: 'Mesmo aparelho' }, { rotulo: 'Outro', vazio: true }],
      texto: 'Os de indicação deixam a indicação recusada. Bônus já usado numa carreira fica (é pulado).',
      executar: (v) => LP.adminPost({ acao: 'tirar_bonus_lote', ids: ids.map(Number), motivo: v.motivo }),
    });
    if (!r) return;
    const feitos = r.feitos || [];
    LP.avisar(LP.resumoLote(feitos.length, r.pulados, ['bônus tirado', 'bônus tirados'], LP.PULOS) + '.');
    feitos.forEach((id) => ind.marcados.delete(String(id)));
    LP.depoisDeAgir();
    LP.sumirLinhas(ind.corpo, feitos, () => carregar());
  }

  /** P1-13: a fila de pendentes mudou noutro lugar. */
  async function fila(a) {
    if (!a.filas || ind.status !== 'pendente' || ind.pagina > 1 || ind.indicador) return;
    const novo = a.filas.indicacoes;
    if (novo === ind.fila) return;
    ind.fila = novo;
    const d = await carregar(true);
    if (!d) return;
    LP.atualizarFila({
      raiz: ind.corpo,
      antes: ind.itens.map((x) => x.id),
      depois: (d.itens || []).map((x) => x.id),
      marcados: ind.marcados,
      tipo: 'indicacao',
      rotuloNovos: (n) => LP.plural(n, 'indicação nova', 'indicações novas') + ' — clique para ver',
      redesenhar: (novos) => desenharIndicacoes(d, novos),
      recarregar: (novos) => carregar(false, novos),
      aoMudarSelecao: () => { if (ind.lote) ind.lote.atualizar(); },
    });
  }

  LP.abas.indicacoes = {
    titulo: 'Indicações e bônus',
    sub: '',
    montar: montar,
    recarregar: () => { carregar(); LP.atualizarResumo(); },
    sair: () => { document.body.classList.remove('com-lote'); },
    aoResumo: () => { desenharTopo(); desenharFiltros(); },
    aoPulso: (a) => { desenharFiltros(); fila(a); },
    aoMudarFora: () => carregar(),
    desmarcar: (ids) => ids.forEach((id) => ind.marcados.delete(String(id))),
  };
})();
