/* LENDA · painel — moderação: Hall público (carreiras no Hall, suspeitas, denunciadas, ocultas), o detalhe de uma
 * carreira (admin.php?r=carreira, mesmo oculta/suspeita) e a fila de denúncias. */
'use strict';

(function () {
  const LP = window.LP;
  const { h } = LP;

  // ═══ ações numa carreira (aqui, no detalhe do usuário e no detalhe da carreira) ═══════════════
  /** c = {id (carreiras.id), carreiraId (HallEntry.id), jogador, oculta, suspeita, noHall|posicaoHall}. */
  LP.botoesCarreira = function (c, depois, opcoes) {
    const o = opcoes || {};
    const bs = [];
    const escondida = (c.oculta || 0) > 0 || !!c.suspeita;
    if (escondida) {
      bs.push(LP.botao(c.suspeita && !c.oculta ? 'Liberar' : 'Mostrar', () => mostrar(c, depois), { tipo: 'ok', pequeno: !o.grande, icone: 'olho',
        title: 'Volta ao Hall na próxima fotografia' + (c.suspeita ? ' (e libera a suspeita)' : '') }));
    } else {
      bs.push(LP.botao('Ocultar', () => ocultar(c, depois), { tipo: 'fantasma', pequeno: !o.grande, compacto: !o.grande, icone: 'ocultar', title: 'Ocultar: tira do Hall público na hora' }));
    }
    bs.push(LP.botao('Apagar', () => apagar(c, depois), { tipo: 'perigo', pequeno: !o.grande, compacto: !o.grande, icone: 'lixo', title: 'Apagar a carreira' }));
    if ((c.posicaoHall || c.noHall) && c.carreiraId) {
      bs.push(LP.linkJogo('No jogo', '#/resumo?id=' + encodeURIComponent(c.carreiraId) + '&de=comunidade', { tipo: 'fantasma', pequeno: !o.grande, compacto: !o.grande, title: 'Abrir esta carreira no Hall das Lendas do jogo (outra aba)' }));
    }
    return bs;
  };

  async function ocultar(c, depois) {
    const r = await LP.dialogo({
      titulo: 'Ocultar ' + (c.jogador || 'esta carreira') + ' do Hall público?',
      botao: 'Ocultar',
      texto: 'Sai do Hall na hora, para todo mundo. As denúncias abertas dela são fechadas como "ocultar". Dá para mostrar de novo depois.',
      executar: () => LP.adminPost({ acao: 'ocultar_carreira', id: c.id }),
    });
    if (!r) return;
    LP.avisar('Carreira oculta' + (r.denunciasFechadas ? ' · ' + LP.plural(r.denunciasFechadas, 'denúncia fechada', 'denúncias fechadas') : '') + '.');
    LP.atualizarResumo();
    if (depois) depois();
  }
  async function mostrar(c, depois) {
    const textos = [];
    if (c.suspeita) textos.push('Libera a suspeita (' + LP.motivosSuspeita(c.suspeita) + '): você confere que os números são de verdade.');
    textos.push('Volta ao Hall na próxima fotografia (ou use "Atualizar Hall agora"). As denúncias abertas dela são fechadas como "ok".');
    const r = await LP.dialogo({
      titulo: (c.suspeita && !c.oculta ? 'Liberar ' : 'Mostrar ') + (c.jogador || 'esta carreira') + ' no Hall?',
      botao: c.suspeita && !c.oculta ? 'Liberar' : 'Mostrar',
      tipoBotao: 'ok',
      texto: textos,
      executar: () => LP.adminPost({ acao: 'mostrar_carreira', id: c.id }),
    });
    if (!r) return;
    LP.avisar('Pronto: entra no Hall na próxima fotografia.');
    LP.atualizarResumo();
    if (depois) depois();
  }
  async function apagar(c, depois) {
    const r = await LP.dialogo({
      titulo: 'Apagar ' + (c.jogador || 'esta carreira') + '?',
      perigo: true,
      botao: 'Apagar para sempre',
      texto: ['Apaga a carreira da conta do jogador e as denúncias dela. Sai do Hall na hora. Não dá para desfazer (para só esconder, use Ocultar).'],
      digitar: 'APAGAR',
      executar: () => LP.adminPost({ acao: 'apagar_carreira', id: c.id }),
    });
    if (!r) return;
    LP.avisar('Carreira apagada.');
    LP.atualizarResumo();
    if (depois) depois(true);
  }

  function chipsSituacao(c, semPosicao) {
    const chips = [];
    if (c.posicaoHall && semPosicao !== true) chips.push(LP.chip('No Hall #' + LP.inteiro(c.posicaoHall), 'ok'));
    if (c.oculta === 1) chips.push(LP.chip('Oculta (admin)', 'alerta'));
    if (c.oculta === 2) chips.push(LP.chip('Oculta (denúncias)', 'perigo'));
    if (c.suspeita) chips.push(LP.chip('Suspeita: ' + LP.motivosSuspeita(c.suspeita), 'alerta'));
    if (c.denuncias) chips.push(LP.chip(LP.plural(c.denuncias, 'denúncia', 'denúncias'), 'perigo', { semPonto: true }));
    if (c.notaV !== undefined && c.notaV !== 2) chips.push(LP.chip(c.notaV === null ? 'Nota antiga' : 'Nota v' + c.notaV, '', { title: 'Fica fora do Hall até o jogo reenviar com a nota da versão atual' }));
    if (c.modo === 'imersivo') chips.push(LP.chip('Imersivo', 'info', { semPonto: true }));
    if (c.usuario && c.usuario.status === 'suspenso') chips.push(LP.chip('Dono suspenso', 'perigo'));
    if (c.publica) chips.push(LP.chip('Escolhida', 'ouro', { semPonto: true, title: 'O dono marcou esta para o Hall' }));
    return chips.length ? h('span', { class: 'chips' }, chips) : '—';
  }

  // ═══ detalhe da carreira (diálogo largo) ═════════════════════════════════════════════════════
  LP.abrirCarreira = function (pk, opcoes) {
    const o = opcoes || {};
    const caixa = h('div', null, LP.estadoCarregando(6));
    let mudou = false;
    const carregar = async () => {
      try {
        const [d, nomes] = await Promise.all([LP.adminGet('carreira', { id: pk }), LP.nomes()]);
        LP.trocar(caixa, corpoCarreira(d, nomes, (apagada) => {
          mudou = true;
          if (apagada) { LP.fecharDialogo(); return; }
          carregar();
        }));
      } catch (e) {
        if (e && e.status === 401) return;
        LP.trocar(caixa, e && e.status === 404 ? LP.estadoVazio('Carreira não encontrada', 'Ela pode ter sido apagada agora.') : LP.estadoErro(e, carregar));
      }
    };
    carregar();
    LP.dialogo({ titulo: 'Carreira', largo: true, soFechar: true, corpo: caixa }).then(() => { if (mudou && o.aoMudar) o.aoMudar(); });
  };

  function corpoCarreira(d, nomes, depois) {
    const m = d.meta || {};
    const he = d.carreira && typeof d.carreira === 'object' ? d.carreira : {};
    const s = he.summary && typeof he.summary === 'object' ? he.summary : {};
    const idt = he.identity || s.identity || {};
    const tot = s.totals || {};
    const nac = s.national || {};
    const den = Array.isArray(d.denuncias) ? d.denuncias : [];
    const copas = m.copas || 0;
    const pais = nomes.paises[m.pais || idt.nationality] || m.pais || idt.nationality || '—';
    const leg = he.legacy || {};

    const topo = h('div', { class: 'carreira-topo' },
      h('div', { class: 'camisa', 'aria-label': 'Camisa ' + (m.numero || idt.number || '') }, String(m.numero || idt.number || '–')),
      h('div', null,
        h('div', { class: 'perfil-nome' }, h('h2', null, m.jogador || idt.surname || '—'), chipsSituacao(m)),
        h('p', { class: 'texto-2' }, m.headline || s.headline || '')));

    const dados = h('dl', { class: 'perfil-dados' },
      LP.dado('Dono', m.usuario ? h('span', { class: 'chips' }, LP.linkUsuario(m.usuario), m.usuario.status === 'suspenso' ? LP.chip('suspenso', 'perigo') : null) : '—'),
      LP.dado('Modo', (LP.NOMES_MODO[m.modo] || m.modo || '—') + (he.pace ? ' · ritmo ' + he.pace : '')),
      LP.dado('Seleção', pais),
      LP.dado('Posição', m.posicao || idt.position),
      LP.dado('Salva', (m.como === 'auto' ? 'sozinha (pico 90+)' : 'pelo jogador') + ' · ' + LP.dataHoraAno(m.salvaEm)),
      LP.dado('Terminou', m.terminouEm ? LP.dataHoraAno(m.terminouEm) : '—'),
      LP.dado('Nota de Legado', m.notaV === null || m.notaV === undefined ? 'sem versão (antiga)' : 'versão ' + m.notaV + (leg.raw !== undefined ? ' · bruta ' + LP.nf1.format(leg.raw) : '')),
      LP.dado('Id da carreira', h('span', { class: 'chips' }, h('span', { class: 'mono quebra' }, m.carreiraId || he.id || '—'),
        m.carreiraId ? LP.botao('', () => LP.copiar(m.carreiraId), { tipo: 'fantasma', pequeno: true, icone: 'copiar', rotulo: 'Copiar o id', title: 'Copiar o id' }) : null)));

    const L = LP.ladrilho;
    const numeros = h('div', { class: 'carreira-numeros' },
      L('Nota', LP.inteiro(m.nota)),
      L('Pico de OVR', LP.inteiro(m.picoOvr), s.peakOvrAge ? 'aos ' + s.peakOvrAge + ' anos' : ''),
      L('Temporadas', LP.inteiro(m.temporadas)),
      L('Jogos', LP.inteiro(tot.apps)),
      L('Gols', LP.inteiro(m.gols)),
      L('Assistências', LP.inteiro(tot.assists)),
      L('Títulos', LP.inteiro(m.titulos)),
      L('Bolas de Ouro', LP.inteiro(m.bolasOuro)),
      L('Copas do Mundo', LP.inteiro(copas)),
      L('Bônus de OVR', m.bonusOvr ? '+' + m.bonusOvr : '—'),
      L('Seleção', LP.inteiro(nac.apps) + ' j', LP.inteiro(nac.goals) + ' gols'));

    const acoes = h('div', { class: 'cartao-cabeca' },
      h('div', { class: 'botoes' }, LP.botoesCarreira(m, depois, { grande: true })),
      h('div', { class: 'botoes' }, LP.botao('Baixar JSON', () => LP.baixar('carreira-' + (m.carreiraId || m.id) + '.json', JSON.stringify(he, null, 2)), { tipo: 'fantasma', icone: 'arquivo' })));

    // clubes
    const clubes = Array.isArray(s.clubs) ? s.clubs : [];
    const tabClubes = clubes.length ? LP.lista({
      itens: clubes,
      colunas: [
        { rotulo: 'Clube', principal: true, celula: (c) => h('span', { title: c.clubId }, nomes.clubes[c.clubId] || c.clubId || '—') },
        { rotulo: 'Temp.', num: true, celula: (c) => LP.inteiro(c.seasons) },
        { rotulo: 'Jogos', num: true, celula: (c) => LP.inteiro(c.apps) },
        { rotulo: 'Gols', num: true, celula: (c) => LP.inteiro(c.goals) },
        { rotulo: 'Assist.', num: true, celula: (c) => LP.inteiro(c.assists) },
        { rotulo: 'Títulos', num: true, celula: (c) => LP.inteiro(c.trophies) },
        { rotulo: '', celula: (c) => (c.loan ? LP.chip('empréstimo', '', { semPonto: true }) : '') },
      ],
    }) : h('p', { class: 'texto-3' }, 'Sem a lista de clubes.');

    const trofeus = (Array.isArray(s.trophies) ? s.trophies : []).map((t) => LP.chip((nomes.trofeus[t.trophyId] || t.trophyId) + ' ×' + (t.count || 1), t.trophyId === 'world-cup' ? 'ouro' : '', { semPonto: true, title: (t.seasons || []).join(', ') }));
    const premios = (Array.isArray(s.awards) ? s.awards : []).map((a) => LP.chip((nomes.premios[a.award] || a.award) + ' ×' + (a.count || 1), a.award === 'ballon_dor' ? 'ouro' : '', { semPonto: true, title: (a.years || []).join(', ') }));

    const listaDen = den.length ? h('div', null, den.map((x) => h('div', { class: 'denuncia' },
      h('div', { class: 'denuncia-topo' }, h('span', { class: 'chips' }, LP.chip(LP.NOMES_DENUNCIA[x.motivo] || x.motivo, 'perigo', { semPonto: true }), estadoDenuncia(x.status)),
        h('span', { class: 'texto-3' }, 'por ', LP.linkUsuario(x.denunciante), ' · ', LP.relativo(x.criadaEm))),
      x.texto ? h('p', { class: 'denuncia-texto' }, x.texto) : null))) : h('p', { class: 'texto-3' }, 'Nenhuma denúncia.');

    return h('div', { class: 'dialogo-carreira' },
      topo, dados, acoes, numeros,
      h('h3', null, 'Clubes'), tabClubes,
      h('h3', null, 'Troféus'), trofeus.length ? h('div', { class: 'lista-conquistas' }, trofeus) : h('p', { class: 'texto-3' }, 'Nenhum.'),
      h('h3', null, 'Prêmios individuais'), premios.length ? h('div', { class: 'lista-conquistas' }, premios) : h('p', { class: 'texto-3' }, 'Nenhum.'),
      h('h3', null, 'Denúncias'), listaDen);
  }

  function estadoDenuncia(st) {
    if (st === 'aberta') return LP.chip('Aberta', 'alerta');
    if (st === 'ok') return LP.chip('Mantida', 'ok');
    if (st === 'ocultar') return LP.chip('Ocultada', 'perigo');
    return LP.chip(st || '—');
  }

  // ═══ aba Hall público ════════════════════════════════════════════════════════════════════════
  const FILTROS = ['publicas', 'revisao', 'suspeitas', 'denunciadas', 'ocultas', 'todas'];
  const hall = { filtro: 'publicas', q: '', pagina: 1, pedido: 0, corpo: null, info: null, filtros: null, temDados: false, atualizadoEm: null };

  function montarHall(raiz, rota) {
    const q = rota.query;
    hall.filtro = FILTROS.includes(q.filtro) ? q.filtro : 'publicas';
    hall.q = (q.q || '').slice(0, 64);
    hall.pagina = Math.max(1, parseInt(q.pagina, 10) || 1);
    hall.temDados = false;
    hall.corpo = h('div');
    hall.info = h('p', { class: 'texto-3', 'aria-live': 'polite' });
    hall.filtros = h('div');
    desenharFiltros();
    LP.trocar(raiz,
      h('div', { class: 'cartao' }, h('div', { class: 'cartao-cabeca' },
        h('div', null, h('h2', null, 'Fotografia do Hall'), hall.info),
        h('div', { class: 'botoes' },
          LP.botao('Atualizar Hall agora', atualizarHall, { tipo: 'ouro', icone: 'atualizar', title: 'Recalcula o Hall público agora (as carreiras novas e as liberadas entram)' }),
          LP.linkJogo('Ver no jogo', '#/hall?seg=comunidade', { tipo: 'fantasma' })))),
      h('div', { class: 'ferramentas' }, hall.filtros,
        LP.busca('Buscar jogador, apelido ou id da carreira', hall.q, (v) => { hall.q = v; hall.pagina = 1; carregarHall(); })),
      hall.corpo);
    desenharInfo();
    carregarHall();
  }

  function desenharFiltros() {
    const r = LP.resumo || {};
    const c = r.carreiras || {};
    LP.trocar(hall.filtros, LP.segmentos('Filtro', [
      { valor: 'publicas', rotulo: 'No Hall', contador: c.noHall || 0 },
      { valor: 'revisao', rotulo: 'Esperando revisão', contador: c.emRevisao || 0, tipoContador: 'alerta' },
      { valor: 'suspeitas', rotulo: 'Suspeitas', contador: c.suspeitas || 0, tipoContador: 'alerta' },
      { valor: 'denunciadas', rotulo: 'Denunciadas', contador: r.denunciasAbertas || 0, tipoContador: 'perigo' },
      { valor: 'ocultas', rotulo: 'Ocultas', contador: (c.ocultas || 0) + (c.ocultasPorDenuncia || 0) },
      { valor: 'todas', rotulo: 'Todas as salvas' },
    ], hall.filtro, (v) => { hall.filtro = v; hall.pagina = 1; desenharFiltros(); carregarHall(); }));
  }

  function desenharInfo() {
    if (!hall.info) return;
    const r = (LP.resumo && LP.resumo.hall) || {};
    const em = r.atualizadoEm || hall.atualizadoEm;
    if (!em) {
      hall.info.textContent = 'Ainda sem fotografia: o Hall público é montado no primeiro acesso (ou em "Atualizar Hall agora").';
      return;
    }
    const partes = ['Última fotografia ' + LP.dataHora(em) + ' (' + LP.relativo(em) + ')'];
    if (r.proximaEm) partes.push('próxima ' + LP.relativo(r.proximaEm) + ' (' + LP.hora(r.proximaEm) + ')');
    if (r.total !== undefined) partes.push(LP.plural(r.total || 0, 'carreira', 'carreiras'));
    if (r.atualizadoEm && r.proximaEm) {
      const min = Math.round((Date.parse(r.proximaEm) - Date.parse(r.atualizadoEm)) / 60000);
      if (min > 0) partes.push('refaz a cada ' + LP.minutos(min));
    }
    if (r.ms) partes.push('levou ' + LP.inteiro(r.ms) + ' ms');
    hall.info.textContent = partes.join(' · ');
  }
  LP.desenharInfoHall = () => { desenharInfo(); if (hall.filtros && hall.filtros.isConnected) desenharFiltros(); };

  async function carregarHall() {
    const n = ++hall.pedido;
    if (!LP.visivel(hall.corpo)) return;
    LP.trocarQuery('hall', { filtro: hall.filtro === 'publicas' ? '' : hall.filtro, q: hall.q, pagina: hall.pagina > 1 ? hall.pagina : '' });
    if (!hall.temDados) LP.trocar(hall.corpo, LP.estadoCarregando(6));
    else hall.corpo.classList.add('esmaecido');
    try {
      const d = await LP.adminGet('hall', { filtro: hall.filtro, q: hall.q, pagina: hall.pagina });
      if (n !== hall.pedido || !LP.visivel(hall.corpo)) return;
      hall.temDados = true;
      hall.atualizadoEm = d.atualizadoEm || null;
      desenharInfo();
      desenharHall(d);
    } catch (e) {
      if (n !== hall.pedido || (e && e.status === 401) || !LP.visivel(hall.corpo)) return;
      hall.temDados = false;
      LP.trocar(hall.corpo, LP.estadoErro(e, carregarHall));
    } finally {
      if (n === hall.pedido) hall.corpo.classList.remove('esmaecido');
    }
  }

  const VAZIO_HALL = {
    publicas: ['O Hall público está vazio', 'Entram as até 3 melhores carreiras de cada conta (ou as que o jogador escolheu), na próxima fotografia.'],
    revisao: ['Nenhuma carreira esperando revisão', 'Carreiras com nota extraordinária ficam aqui, fora do Hall, até você conferir e liberar (botão "Liberar").'],
    suspeitas: ['Nenhuma carreira suspeita', 'Carreiras com números fora do normal (e as que esperam revisão) ficam aqui, fora do Hall, até você decidir.'],
    denunciadas: ['Nenhuma carreira denunciada', 'Quando alguém denunciar uma carreira do Hall, ela aparece aqui.'],
    ocultas: ['Nenhuma carreira oculta', 'As que você ocultar (ou que 5 denúncias esconderem) aparecem aqui.'],
    todas: ['Nenhuma carreira salva ainda', 'As carreiras salvas nas contas aparecem aqui.'],
  };

  function desenharHall(d) {
    const itens = Array.isArray(d.itens) ? d.itens : [];
    LP.subAba(LP.inteiro(d.total || 0) + ' ' + ({ publicas: 'no Hall', revisao: 'esperando revisão', suspeitas: 'suspeitas', denunciadas: 'denunciadas', ocultas: 'ocultas', todas: 'salvas' }[hall.filtro] || ''));
    if (!itens.length) {
      const [t, x] = hall.q ? ['Nada encontrado', 'Confira a busca: nome do jogador, apelido do dono ou o id da carreira.'] : VAZIO_HALL[hall.filtro];
      LP.trocar(hall.corpo, LP.estadoVazio(t, x));
      return;
    }
    const recarregar = () => carregarHall();
    const tabela = LP.lista({
      itens: itens,
      aoClicar: (c) => LP.abrirCarreira(c.id, { aoMudar: recarregar }),
      rotuloLinha: (c) => 'Abrir a carreira ' + c.jogador,
      colunas: [
        { rotulo: 'Pos.', num: true, celula: (c) => (c.posicaoHall ? LP.inteiro(c.posicaoHall) : '—') },
        { rotulo: 'Jogador', principal: true, celula: (c) => h('div', { class: 'celula-dupla' }, h('span', null, c.jogador || '—'), h('span', null, '#' + c.numero + ' · ' + c.pais + ' · ' + c.posicao)) },
        { rotulo: 'Dono', celula: (c) => LP.linkUsuario(c.usuario) },
        { rotulo: 'Nota', num: true, celula: (c) => LP.inteiro(c.nota) },
        { rotulo: 'Pico', num: true, celula: (c) => LP.inteiro(c.picoOvr) },
        { rotulo: 'Temp.', num: true, celula: (c) => LP.inteiro(c.temporadas) },
        { rotulo: 'Gols', num: true, celula: (c) => LP.inteiro(c.gols) },
        { rotulo: 'Tít.', num: true, celula: (c) => LP.inteiro(c.titulos) },
        { rotulo: 'B. Ouro', num: true, celula: (c) => LP.inteiro(c.bolasOuro) },
        { rotulo: 'Copas', num: true, celula: (c) => LP.inteiro(c.copas) },
        { rotulo: 'Bônus', num: true, celula: (c) => (c.bonusOvr ? '+' + c.bonusOvr : '—') },
        { rotulo: 'Situação', classe: 'situacao', celula: (c) => chipsSituacao(c, true) },
        { rotulo: 'Salva', celula: (c) => LP.quando(c.salvaEm) },
        { rotulo: 'Ações', acoes: true, celula: (c) => LP.botoesCarreira(c, recarregar) },
      ],
    });
    LP.trocar(hall.corpo, tabela, LP.paginacao(d.total || 0, d.pagina || hall.pagina, d.porPagina || 50, (p) => { hall.pagina = p; carregarHall(); window.scrollTo(0, 0); }));
  }

  async function atualizarHall(ev, b) {
    LP.ocupado(b, true);
    try {
      const r = await LP.adminPost({ acao: 'atualizar_hall' }, { tempo: 60000 });
      const e = r.hall || {};
      LP.avisar('Hall atualizado: ' + LP.plural(e.total || 0, 'carreira', 'carreiras') + ' em ' + LP.inteiro(e.ms || 0) + ' ms.');
      if (LP.resumo) LP.resumo.hall = { atualizadoEm: e.em, proximaEm: e.proximaEm, total: e.total, ms: e.ms };
      desenharInfo();
      LP.atualizarResumo();
      carregarHall();
    } catch (e) {
      LP.avisarErro(e);
    } finally {
      LP.ocupado(b, false);
    }
  }

  LP.abas.hall = {
    titulo: 'Hall público',
    sub: '',
    montar: montarHall,
    recarregar: () => carregarHall(),
    focarBusca: true,
  };

  // ═══ aba Denúncias ═══════════════════════════════════════════════════════════════════════════
  const den = { status: 'abertas', pagina: 1, pedido: 0, corpo: null, filtros: null, temDados: false };

  function montarDenuncias(raiz, rota) {
    den.status = rota.query.status === 'todas' ? 'todas' : 'abertas';
    den.pagina = Math.max(1, parseInt(rota.query.pagina, 10) || 1);
    den.temDados = false;
    den.corpo = h('div');
    den.filtros = h('div');
    desenharFiltrosDen();
    LP.trocar(raiz,
      h('p', { class: 'faixa faixa-info' }, 'Com 5 denúncias abertas de contas diferentes, a carreira sai do Hall sozinha até você decidir. "Manter" fecha as denúncias e devolve ao Hall a que elas esconderam; "Ocultar" tira do Hall.'),
      h('div', { class: 'ferramentas' }, den.filtros), den.corpo);
    carregarDen();
  }
  function desenharFiltrosDen() {
    const r = LP.resumo || {};
    LP.trocar(den.filtros, LP.segmentos('Mostrar', [
      { valor: 'abertas', rotulo: 'Abertas', contador: r.denunciasAbertas || 0, tipoContador: 'perigo' },
      { valor: 'todas', rotulo: 'Todas' },
    ], den.status, (v) => { den.status = v; den.pagina = 1; desenharFiltrosDen(); carregarDen(); }));
  }
  LP.desenharFiltrosDenuncias = () => { if (den.filtros && den.filtros.isConnected) desenharFiltrosDen(); };

  async function carregarDen() {
    const n = ++den.pedido;
    if (!LP.visivel(den.corpo)) return;
    LP.trocarQuery('denuncias', { status: den.status === 'abertas' ? '' : den.status, pagina: den.pagina > 1 ? den.pagina : '' });
    if (!den.temDados) LP.trocar(den.corpo, LP.estadoCarregando(5));
    else den.corpo.classList.add('esmaecido');
    try {
      const d = await LP.adminGet('denuncias', { status: den.status, pagina: den.pagina });
      if (n !== den.pedido || !LP.visivel(den.corpo)) return;
      den.temDados = true;
      desenharDen(d);
    } catch (e) {
      if (n !== den.pedido || (e && e.status === 401) || !LP.visivel(den.corpo)) return;
      den.temDados = false;
      LP.trocar(den.corpo, LP.estadoErro(e, carregarDen));
    } finally {
      if (n === den.pedido) den.corpo.classList.remove('esmaecido');
    }
  }

  function desenharDen(d) {
    const itens = Array.isArray(d.itens) ? d.itens : [];
    LP.subAba(LP.inteiro(d.total || 0) + (den.status === 'abertas' ? ' abertas' : ' no total'));
    if (!itens.length) {
      LP.trocar(den.corpo, den.status === 'abertas'
        ? LP.estadoVazio('Nenhuma denúncia aberta', 'Tudo em dia. As novas aparecem aqui (e o número na lateral avisa).')
        : LP.estadoVazio('Nenhuma denúncia ainda', 'Jogadores logados podem denunciar carreiras do Hall público.'));
      return;
    }
    const recarregar = () => { carregarDen(); LP.atualizarResumo(); };
    // Uma caixa por carreira (as denúncias desta página juntas): decidir uma vez fecha todas as abertas dela.
    const grupos = [];
    const porCarreira = {};
    itens.forEach((x) => {
      const k = x.carreira ? 'c' + x.carreira.id : 'd' + x.id;
      if (!porCarreira[k]) { porCarreira[k] = { carreira: x.carreira, itens: [] }; grupos.push(porCarreira[k]); }
      porCarreira[k].itens.push(x);
    });
    const cartoes = grupos.map((g) => {
      const c = g.carreira;
      const aberta = g.itens.find((x) => x.status === 'aberta');
      const abertas = aberta ? aberta.abertasNaCarreira || g.itens.filter((x) => x.status === 'aberta').length : 0;
      const cab = c
        ? h('div', { class: 'chips' },
          h('button', { type: 'button', class: 'link', onclick: () => LP.abrirCarreira(c.id, { aoMudar: recarregar }) }, h('b', null, c.jogador || '—')),
          h('span', { class: 'texto-3' }, 'nota ' + LP.inteiro(c.nota) + ' · de '), LP.linkUsuario(c.dono),
          c.oculta === 1 ? LP.chip('Oculta (admin)', 'alerta') : c.oculta === 2 ? LP.chip('Oculta (denúncias)', 'perigo') : null,
          c.suspeita ? LP.chip('Suspeita', 'alerta') : null)
        : h('span', { class: 'texto-3' }, 'Carreira apagada');
      const lista = g.itens.map((x) => h('div', { class: 'denuncia-item' },
        h('div', { class: 'chips' }, LP.chip(LP.NOMES_DENUNCIA[x.motivo] || x.motivo, 'perigo', { semPonto: true }),
          x.status !== 'aberta' ? estadoDenuncia(x.status) : null,
          h('span', { class: 'texto-3' }, 'por ', LP.linkUsuario(x.denunciante), ' · ', LP.quando(x.criadaEm))),
        x.texto ? h('p', { class: 'denuncia-texto' }, x.texto) : null));
      const acoes = aberta && c
        ? h('div', { class: 'botoes' },
          LP.botao('Ver carreira', () => LP.abrirCarreira(c.id, { aoMudar: recarregar }), { tipo: 'fantasma', pequeno: true, icone: 'olho' }),
          LP.botao('Manter no Hall', () => resolver(aberta, 'ok', recarregar), { tipo: 'ok', pequeno: true, icone: 'check' }),
          LP.botao('Ocultar', () => resolver(aberta, 'ocultar', recarregar), { tipo: 'perigo', pequeno: true, icone: 'ocultar' }))
        : c ? h('div', { class: 'botoes' }, LP.botao('Ver carreira', () => LP.abrirCarreira(c.id, { aoMudar: recarregar }), { tipo: 'fantasma', pequeno: true, icone: 'olho' })) : null;
      return h('article', { class: 'denuncia' },
        h('div', { class: 'denuncia-topo' }, cab, abertas ? LP.chip(LP.plural(abertas, 'aberta', 'abertas') + ' nesta carreira', 'perigo', { semPonto: true }) : null),
        lista,
        acoes ? h('div', { class: 'denuncia-pe' }, h('span', { class: 'texto-3' }, aberta ? 'Decidir aqui fecha todas as abertas desta carreira.' : ''), acoes) : null);
    });
    LP.trocar(den.corpo, h('div', null, cartoes), LP.paginacao(d.total || 0, d.pagina || den.pagina, d.porPagina || 50, (p) => { den.pagina = p; carregarDen(); window.scrollTo(0, 0); }));
  }

  async function resolver(x, resultado, depois) {
    const c = x.carreira || {};
    const n = x.abertasNaCarreira || 1;
    const r = await LP.dialogo(resultado === 'ok' ? {
      titulo: 'Manter ' + (c.jogador || 'a carreira') + ' no Hall?',
      botao: 'Manter',
      tipoBotao: 'ok',
      texto: 'Fecha ' + LP.plural(n, 'denúncia aberta', 'denúncias abertas') + ' desta carreira como "ok". Se as denúncias tinham escondido a carreira, ela volta ao Hall na próxima fotografia.',
      executar: () => LP.adminPost({ acao: 'resolver_denuncia', id: x.id, resultado: 'ok' }),
    } : {
      titulo: 'Ocultar ' + (c.jogador || 'a carreira') + '?',
      perigo: true,
      botao: 'Ocultar',
      texto: 'A carreira sai do Hall na hora e ' + LP.plural(n, 'denúncia aberta é fechada', 'denúncias abertas são fechadas') + '. Dá para mostrar de novo na aba Hall público.',
      executar: () => LP.adminPost({ acao: 'resolver_denuncia', id: x.id, resultado: 'ocultar' }),
    });
    if (!r) return;
    LP.avisar(resultado === 'ok' ? 'Carreira mantida · ' + LP.plural(r.denunciasFechadas || 0, 'denúncia fechada', 'denúncias fechadas') + '.' : 'Carreira oculta · ' + LP.plural(r.denunciasFechadas || 0, 'denúncia fechada', 'denúncias fechadas') + '.');
    if (depois) depois();
  }

  LP.abas.denuncias = {
    titulo: 'Denúncias',
    sub: '',
    montar: montarDenuncias,
    recarregar: () => carregarDen(),
  };
})();
