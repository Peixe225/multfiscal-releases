/* LENDA · painel — moderação: Hall público (no Hall, em revisão, suspeitas, denunciadas, ocultas, destaques, todas,
 * lixeira), com sinais, ações em lote e a fila ao vivo; a ficha da carreira no painel lateral (admin.php?r=carreira,
 * mesmo oculta/suspeita; carreira=<pk> no hash); e a fila de Denúncias agrupada por carreira. */
'use strict';

(function () {
  const LP = window.LP;
  const { h } = LP;

  const PULOS = { nao_encontrada: 'não encontrada', ja_estava: 'já estava assim', sem_abertas: 'sem denúncia aberta', ja_recusada: 'já recusada', bonus_usado: 'bônus já usado', nao_encontrado: 'não encontrado', usado: 'já usado' };
  LP.PULOS = PULOS;

  // ═══ ações numa carreira (aqui, na ficha da conta e na ficha da carreira) ═══════════════════
  /** c = {id (carreiras.id), carreiraId, jogador, oculta, suspeita, noHall|posicaoHall, destaque, usuario}. */
  LP.botoesCarreira = function (c, depois, opcoes) {
    const o = opcoes || {};
    const bs = [];
    const p = { pequeno: !o.grande, compacto: !o.grande };
    if (LP.pode('moderar')) {
      const escondida = (c.oculta || 0) > 0 || !!c.suspeita;
      if (escondida) {
        bs.push(LP.botao(c.suspeita && !c.oculta ? 'Liberar' : 'Mostrar', () => mostrar(c, depois), { tipo: 'ok', pequeno: !o.grande, icone: 'olho',
          title: 'Volta ao Hall na próxima fotografia' + (c.suspeita ? ' (e libera a suspeita)' : '') }));
      } else {
        bs.push(LP.botao('Ocultar', () => ocultar(c, depois), Object.assign({ tipo: 'fantasma', icone: 'ocultar', title: 'Ocultar: tira do Hall público na hora (dá para desfazer)' }, p)));
      }
      if (o.grande || c.destaque || c.posicaoHall || c.noHall) {
        // travado durante o pedido: o duplo clique não manda dois POST (nem duas linhas no Registro)
        bs.push(LP.botao(c.destaque ? 'Tirar destaque' : 'Destacar', () => destacar(c, !c.destaque, depois), Object.assign({ tipo: 'fantasma', icone: 'estrela',
          gerundio: c.destaque ? 'Tirando…' : 'Destacando…', title: c.destaque ? 'Tira o selo "Destaque" do Hall' : 'Põe o selo "Destaque" no Hall público' }, p)));
      }
      bs.push(LP.botao('Apagar', () => apagar(c, depois), Object.assign({ tipo: 'perigo', icone: 'lixo', title: 'Apagar (vai para a lixeira por 30 dias)' }, p)));
    }
    bs.push(LP.linkAbrirNoJogo(c.id, { pequeno: !o.grande, compacto: !o.grande }));
    return bs;
  };

  const nomeCarreira = (c) => (c.jogador || 'esta carreira') + (c.usuario && c.usuario.apelido ? ' (@' + c.usuario.apelido + ')' : '');
  async function ocultar(c, depois) {
    const r = await LP.dialogoMotivo({
      titulo: 'Ocultar a carreira ' + nomeCarreira(c),
      botao: 'Ocultar',
      gerundio: 'Ocultando…',
      avisar: true,
      texto: 'Sai do Hall na hora, para todo mundo. As denúncias abertas dela são fechadas como "ocultar". Dá para mostrar de novo depois.',
      executar: (v) => LP.adminPost({ acao: 'ocultar_carreira', id: c.id, motivo: v.motivo, avisar: v.avisar || undefined, avisoMotivo: v.avisar ? v.avisoMotivo : undefined }),
    });
    if (!r) return;
    LP.avisar('Carreira ocultada' + (r.denunciasFechadas ? ' · ' + LP.plural(r.denunciasFechadas, 'denúncia fechada', 'denúncias fechadas') : '') + '. Ela saiu do Hall agora.');
    LP.marcarFeitos('carreira', [c.id]);
    LP.depoisDeAgir();
    if (depois) depois();
  }
  async function mostrar(c, depois) {
    const textos = [];
    if (c.suspeita) textos.push('Libera a suspeita (' + LP.motivosSuspeita(c.suspeita) + '): você confere que os números são de verdade.');
    textos.push('Volta ao Hall na próxima fotografia (ou use "Atualizar Hall agora"). As denúncias abertas dela são fechadas como "ok".');
    const r = await LP.dialogoMotivo({
      titulo: (c.suspeita && !c.oculta ? 'Liberar ' : 'Mostrar ') + nomeCarreira(c),
      botao: c.suspeita && !c.oculta ? 'Liberar' : 'Mostrar',
      gerundio: c.suspeita && !c.oculta ? 'Liberando…' : 'Mostrando…',
      tipoBotao: 'ok',
      obrigatorio: false,
      chips: [{ rotulo: 'Conferi os números' }, { rotulo: 'Denúncia improcedente' }, { rotulo: 'Engano da moderação' }, { rotulo: 'Outro', vazio: true }],
      texto: textos,
      executar: (v) => LP.adminPost({ acao: 'mostrar_carreira', id: c.id, motivo: v.motivo || undefined }),
    });
    if (!r) return;
    LP.avisar('Pronto: ' + (c.jogador || 'a carreira') + ' entra no Hall na próxima fotografia.');
    LP.marcarFeitos('carreira', [c.id]);
    LP.depoisDeAgir();
    if (depois) depois();
  }
  async function apagar(c, depois) {
    const r = await LP.dialogoMotivo({
      titulo: 'Apagar a carreira ' + nomeCarreira(c),
      perigo: true,
      botao: 'Apagar',
      gerundio: 'Apagando…',
      avisar: true,
      texto: [h('p', { class: 'faixa faixa-alerta' }, 'Prefira Ocultar: dá para desfazer na hora.'),
        'Apagar tira a carreira da conta e do Hall, guarda uma cópia na lixeira por 30 dias (dá para restaurar) e impede que o jogador salve a mesma carreira de novo pelo aparelho.'],
      executar: (v) => LP.adminPost({ acao: 'apagar_carreira', id: c.id, motivo: v.motivo, avisar: v.avisar || undefined, avisoMotivo: v.avisar ? v.avisoMotivo : undefined }),
    });
    if (!r) return;
    LP.avisar('Carreira apagada e guardada na lixeira por 30 dias' + (r.denunciasFechadas ? ' · ' + LP.plural(r.denunciasFechadas, 'denúncia fechada', 'denúncias fechadas') : '') + '.');
    LP.marcarFeitos('carreira', [c.id]);
    LP.depoisDeAgir();
    if (LP.gaveta.aberta() && LP.gaveta.aberta().tipo === 'carreira' && LP.gaveta.aberta().id === String(c.id)) LP.gaveta.fechar();
    if (depois) depois(true);
  }
  async function destacar(c, sim, depois) {
    try {
      await LP.adminPost({ acao: 'destacar_carreira', id: c.id, sim: sim });
      LP.avisar(sim ? (c.jogador || 'A carreira') + ' ganhou o selo "Destaque" no Hall.' : 'Destaque tirado.');
      if (depois) depois();
    } catch (e) { LP.avisarErro(e); }
  }

  /** Restaurar / liberar reenvio de um item da lixeira (aqui e na ficha da conta). */
  LP.botoesLixeira = function (x, depois) {
    if (!LP.pode('moderar')) return null;
    return [
      x.temCopia ? LP.botao('Restaurar (oculta)', async (ev, b) => {
        if (!LP.confirmar('Restaurar ' + (x.jogador || 'a carreira') + '? Ela volta para a conta como oculta: você decide depois se mostra.')) return;
        try {
          const r = await LP.adminPost({ acao: 'restaurar_carreira', id: x.id });
          LP.avisar('Carreira restaurada (oculta). Abra e use "Mostrar" se ela pode voltar ao Hall.');
          LP.depoisDeAgir();
          if (depois) depois();
          if (r && r.pk) LP.abrirCarreira(r.pk);
        } catch (e) { LP.avisarErro(e); }
      }, { tipo: 'fantasma', pequeno: true, icone: 'restaurar', gerundio: 'Restaurando…' }) : null,
      LP.botao('Liberar reenvio', async () => {
        if (!LP.confirmar('Liberar o reenvio de ' + (x.jogador || 'a carreira') + '? A cópia some e o jogador pode salvar a mesma carreira de novo (ela volta como uma carreira qualquer).')) return;
        try {
          await LP.adminPost({ acao: 'liberar_reenvio', id: x.id });
          LP.avisar('Reenvio liberado.');
          LP.depoisDeAgir();
          if (depois) depois();
        } catch (e) { LP.avisarErro(e); }
      }, { tipo: 'fantasma', pequeno: true, gerundio: 'Liberando…' }),
    ];
  };

  function chipsSituacao(c, semPosicao) {
    const chips = [];
    if (c.posicaoHall && semPosicao !== true) chips.push(LP.chip('No Hall #' + LP.inteiro(c.posicaoHall), 'ok'));
    if (c.destaque) chips.push(LP.chip('Destaque', 'ouro', { semPonto: true }));
    if (c.oculta === 1) chips.push(LP.chip('Oculta (moderação)', ''));
    if (c.oculta === 2) chips.push(LP.chip('Oculta (denúncias)', 'perigo'));
    if (c.suspeita) chips.push(LP.chip(c.suspeita === 'revisao' ? 'Em revisão' : 'Suspeita: ' + LP.motivosSuspeita(c.suspeita), 'alerta'));
    if (c.denuncias) chips.push(LP.chip(LP.plural(c.denuncias, 'denúncia', 'denúncias'), 'perigo', { semPonto: true }));
    if (c.notaV !== undefined && c.notaV !== 2) chips.push(LP.chip(c.notaV === null ? 'Nota antiga' : 'Nota v' + c.notaV, '', { title: 'Fica fora do Hall até o jogo reenviar com a nota da versão atual' }));
    if (c.modo === 'imersivo') chips.push(LP.chip('Imersivo', 'info', { semPonto: true }));
    if (c.usuario && c.usuario.status === 'suspenso') chips.push(LP.chip('Dono suspenso', 'perigo'));
    if (c.usuario && c.usuario.hallBloqueado) chips.push(LP.chip('Dono fora do Hall', 'tracejado', { semPonto: true }));
    if (c.publica) chips.push(LP.chip('Escolhida', 'ouro', { semPonto: true, title: 'O dono marcou esta para o Hall' }));
    return chips.length ? h('span', { class: 'chips' }, chips) : '—';
  }

  // ═══ ficha da carreira (painel lateral) ═════════════════════════════════════════════════════
  const fc = { pk: 0, corpo: null, pedido: 0 };
  LP.abrirFichaCarreira = function (pk) {
    fc.pk = parseInt(pk, 10) || 0;
    fc.corpo = LP.gaveta.abrir('carreira', pk, 'Carreira #' + pk);
    if (!fc.corpo) return;
    LP.trocar(fc.corpo, LP.estadoCarregando(8));
    carregarFichaCarreira();
  };
  async function carregarFichaCarreira() {
    const n = ++fc.pedido;
    const corpo = fc.corpo;
    try {
      const [d, nomes] = await Promise.all([LP.adminGet('carreira', { id: fc.pk }), LP.nomes()]);
      if (n !== fc.pedido || !corpo.isConnected) return;
      const rol = corpo.scrollTop;
      LP.trocar(corpo, corpoCarreira(d, nomes, (apagada) => {
        if (apagada) return;
        carregarFichaCarreira();
        const m = LP.abas[LP.rota().aba];
        if (m && m.aoMudarFora) m.aoMudarFora();
      }));
      corpo.scrollTop = rol;
    } catch (e) {
      if (n !== fc.pedido || (e && e.status === 401) || !corpo.isConnected) return;
      LP.trocar(corpo, e && e.status === 404 ? LP.estadoVazio('Carreira não encontrada', 'Ela pode ter sido apagada agora (veja a lixeira no Hall público).') : LP.estadoErro(e, carregarFichaCarreira));
    }
  }

  function corpoCarreira(d, nomes, depois) {
    const m = d.meta || {};
    const he = d.carreira && typeof d.carreira === 'object' ? d.carreira : {};
    const s = he.summary && typeof he.summary === 'object' ? he.summary : {};
    const idt = he.identity || s.identity || {};
    const tot = s.totals || {};
    const nac = s.national || {};
    const den = Array.isArray(d.denuncias) ? d.denuncias : [];
    const pais = nomes.paises[m.pais || idt.nationality] || m.pais || idt.nationality || '—';
    const leg = he.legacy || {};
    LP.gaveta.titulo((m.jogador || 'Carreira') + ' · #' + (m.id || fc.pk));

    const topo = h('section', { class: 'cartao' }, h('div', { class: 'carreira-topo' },
      h('div', { class: 'camisa', 'aria-label': 'Camisa ' + (m.numero || idt.number || '') }, String(m.numero || idt.number || '–')),
      h('div', null,
        h('div', { class: 'perfil-nome' }, h('h2', null, m.jogador || idt.surname || '—'), chipsSituacao(m)),
        h('p', { class: 'texto-2' }, m.headline || s.headline || ''))));
    const sinais = LP.sinais(m, { semRecolher: false });
    const cSinais = sinais.graves || sinais.leves ? h('section', { class: 'cartao' }, h('h2', null, 'Sinais automáticos'), h('div', { class: 'celula-sinais' }, sinais.graves, sinais.leves)) : null;
    const moder = m.moderacao ? h('p', { class: 'moderacao-nota' }, h('b', null, 'Última decisão: '), (m.moderacao.motivo || 'sem motivo escrito') + ' · ' + LP.dataHoraAno(m.moderacao.em)) : null;

    const dados = h('dl', { class: 'perfil-dados' },
      LP.dado('Dono', m.usuario ? h('span', { class: 'chips' }, LP.linkUsuario(m.usuario), m.usuario.status === 'suspenso' ? LP.chip('suspenso', 'perigo') : null) : '—'),
      LP.dado('Modo', (LP.NOMES_MODO[m.modo] || m.modo || '—') + (he.pace ? ' · ritmo ' + he.pace : '')),
      LP.dado('Seleção', pais),
      LP.dado('Posição', m.posicao || idt.position),
      LP.dado('Salva', (m.como === 'auto' ? 'sozinha (pico 90+)' : 'pelo jogador') + ' · ' + LP.dataHoraAno(m.salvaEm)),
      LP.dado('Terminou', m.terminouEm ? LP.dataHoraAno(m.terminouEm) : '—'),
      LP.dado('Nota de Legado', m.notaV === null || m.notaV === undefined ? 'sem versão (antiga)' : 'versão ' + m.notaV + (leg.raw !== undefined ? ' · bruta ' + LP.nf1.format(leg.raw) : '')),
      LP.dado('Id da carreira', h('span', { class: 'chips' }, h('span', { class: 'mono quebra' }, m.carreiraId || he.id || '—'),
        m.carreiraId ? LP.botao('', (ev, b) => LP.copiar(m.carreiraId, b), { tipo: 'fantasma', pequeno: true, icone: 'copiar', rotulo: 'Copiar o id', title: 'Copiar o id' }) : null)));

    const acoes = h('section', { class: 'cartao' }, h('div', { class: 'perfil-acoes' }, LP.botoesCarreira(m, depois, { grande: true }),
      LP.botao('Baixar JSON', () => LP.baixar('carreira-' + (m.carreiraId || m.id) + '.json', JSON.stringify(he, null, 2)), { tipo: 'fantasma', icone: 'arquivo' })), moder);

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
      L('Copas do Mundo', LP.inteiro(m.copas || 0)),
      L('Bônus de OVR', m.bonusOvr ? '+' + m.bonusOvr : '—'),
      L('Seleção', LP.inteiro(nac.apps) + ' j', LP.inteiro(nac.goals) + ' gols'));

    const clubes = Array.isArray(s.clubs) ? s.clubs : [];
    const tabClubes = clubes.length ? LP.lista({
      itens: clubes,
      colunas: [
        { rotulo: 'Clube', principal: true, celula: (c) => h('span', { title: c.clubId }, nomes.clubes[c.clubId] || c.clubId || '—') },
        { rotulo: 'Temp.', num: true, celula: (c) => LP.inteiro(c.seasons) },
        { rotulo: 'Jogos', num: true, celula: (c) => LP.inteiro(c.apps) },
        { rotulo: 'Gols', num: true, celula: (c) => LP.inteiro(c.goals) },
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

    return [topo, cSinais, acoes, h('section', { class: 'cartao' }, dados), numeros,
      h('details', { class: 'cartao cartao-secundario', open: den.some((x) => x.status === 'aberta') }, h('summary', null, 'Denúncias · ' + den.length), listaDen),
      h('details', { class: 'cartao cartao-secundario' }, h('summary', null, 'Clubes · ' + clubes.length), tabClubes),
      h('details', { class: 'cartao cartao-secundario' }, h('summary', null, 'Troféus e prêmios'),
        trofeus.length ? h('div', { class: 'lista-conquistas' }, trofeus) : h('p', { class: 'texto-3' }, 'Nenhum troféu.'),
        h('h3', null, 'Prêmios individuais'), premios.length ? h('div', { class: 'lista-conquistas' }, premios) : h('p', { class: 'texto-3' }, 'Nenhum.'))];
  }

  function estadoDenuncia(st) {
    if (st === 'aberta') return LP.chip('Aberta', 'alerta');
    if (st === 'ok') return LP.chip('Mantida', 'ok');
    if (st === 'ocultar') return LP.chip('Ocultada', 'perigo');
    return LP.chip(st || '—');
  }

  // ═══ aba Hall público ════════════════════════════════════════════════════════════════════════
  const FILTROS = ['publicas', 'revisao', 'suspeitas', 'denunciadas', 'ocultas', 'destaques', 'todas', 'lixeira'];
  const NOMES_FILTRO = { publicas: 'no Hall', revisao: 'em revisão', suspeitas: 'suspeitas', denunciadas: 'denunciadas', ocultas: 'ocultas', destaques: 'em destaque', todas: 'salvas', lixeira: 'na lixeira' };
  const hall = { filtro: 'publicas', q: '', pagina: 1, corpo: null, info: null, filtros: null, busca: null, temDados: false, atualizadoEm: null, itens: [], marcados: new Set(), lote: null, fila: null, tabela: null };

  function montarHall(raiz, rota) {
    const q = rota.query;
    hall.filtro = FILTROS.includes(q.filtro) ? q.filtro : 'publicas';
    hall.q = (q.q || '').slice(0, 64);
    hall.pagina = Math.max(1, parseInt(q.pagina, 10) || 1);
    hall.temDados = false;
    hall.itens = [];
    hall.marcados = new Set();
    hall.fila = null;
    hall.corpo = h('div');
    hall.info = h('p', { class: 'texto-3', 'aria-live': 'polite' });
    hall.filtros = h('div');
    hall.busca = LP.busca('Buscar jogador, apelido do dono ou id da carreira', hall.q, (v) => { hall.q = v; hall.pagina = 1; carregarHall(); }, { maxlength: 64 });
    desenharFiltros();
    LP.trocar(raiz,
      h('div', { class: 'cartao espaco-baixo' }, h('div', { class: 'cartao-cabeca' },
        h('div', null, h('h2', null, 'Fotografia do Hall'), hall.info),
        h('div', { class: 'botoes' },
          LP.pode('moderar') ? LP.botao('Atualizar Hall agora', atualizarHall, { tipo: 'ouro', icone: 'atualizar', gerundio: 'Atualizando…', title: 'Recalcula o Hall público agora (as carreiras novas e as liberadas entram)' }) : null,
          LP.linkJogo('Ver no jogo', '#/hall?seg=comunidade', { tipo: 'fantasma' })))),
      h('div', { class: 'ferramentas' }, hall.filtros), h('div', { class: 'ferramentas' }, hall.busca),
      hall.corpo);
    desenharInfo();
    carregarHall();
  }

  function desenharFiltros() {
    const r = LP.resumo || {};
    const c = r.carreiras || {};
    const ac = (LP.agora && LP.agora.acao) || {};
    // no lugar (pulso de 15 s, resumo de 60 s, clique): o chip continua o mesmo e o foco do teclado fica nele
    LP.trocarSegmentos(hall.filtros, 'Filtro', [
      { valor: 'publicas', rotulo: 'No Hall', contador: c.noHall || 0 },
      { valor: 'revisao', rotulo: 'Em revisão', contador: c.emRevisao || 0, tipoContador: 'alerta' },
      { valor: 'suspeitas', rotulo: 'Suspeitas', contador: ac.suspeitas !== undefined ? ac.suspeitas : c.suspeitas || 0, tipoContador: 'alerta' },
      { valor: 'denunciadas', rotulo: 'Denunciadas', contador: (ac.denunciasAbertas !== undefined ? ac.denunciasAbertas : r.denunciasAbertas) || 0, tipoContador: 'perigo' },
      { valor: 'ocultas', rotulo: 'Ocultas', contador: (c.ocultas || 0) + (c.ocultasPorDenuncia || 0) },
      { valor: 'destaques', rotulo: 'Destaques', contador: c.destaques || 0 },
      { valor: 'todas', rotulo: 'Todas as salvas' },
      { valor: 'lixeira', rotulo: 'Lixeira', contador: c.lixeira || 0 },
    ], hall.filtro, (v) => { hall.filtro = v; hall.pagina = 1; hall.marcados.clear(); hall.temDados = false; hall.fila = null; desenharFiltros(); carregarHall(); });
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
    if (r.ms) partes.push('levou ' + LP.inteiro(r.ms) + ' ms');
    hall.info.textContent = partes.join(' · ');
  }

  /** silencioso: só busca (o pulso compara); novos: as que chegaram na fila ao vivo, desenhadas em ouro. */
  async function carregarHall(silencioso, novos) {
    if (!LP.visivel(hall.corpo)) return null;
    LP.trocarQuery('hall', { filtro: hall.filtro === 'publicas' ? '' : hall.filtro, q: hall.q, pagina: hall.pagina > 1 ? hall.pagina : '' });
    if (!silencioso) {
      // a fila "de antes" é a do último pulso: o que mudar depois deste carregamento aparece no pulso seguinte
      hall.fila = LP.filaDoPulso(hall.filtro === 'denunciadas' ? 'denuncias' : hall.filtro === 'suspeitas' ? 'suspeitas' : '');
      if (!hall.temDados) LP.trocar(hall.corpo, LP.estadoCarregando(6));
      else hall.corpo.classList.add('esmaecido');
    }
    try {
      const filtro = hall.filtro;
      const lixeira = filtro === 'lixeira';
      // a busca do pulso tem a sua chave: não cancela o carregamento que a tela pediu (nem o contrário)
      const sinal = { sinal: LP.unico(silencioso ? 'hall-pulso' : 'hall') };
      const d = lixeira ? await LP.adminGet('lixeira', { pagina: hall.pagina }, sinal)
        : await LP.adminGet('hall', { filtro: filtro, q: hall.q, pagina: hall.pagina }, sinal);
      // a resposta de um filtro que já não está na tela (trocou no meio do caminho) não se desenha
      if (!LP.visivel(hall.corpo) || filtro !== hall.filtro) return null;
      hall.corpo.classList.remove('esmaecido');
      if (silencioso) return d;
      hall.temDados = true;
      hall.atualizadoEm = d.atualizadoEm || hall.atualizadoEm;
      desenharInfo();
      hall.busca.hidden = lixeira;
      LP.esconderNovidade(); // a lista acabou de ser refeita: o "N novas — clique para ver" já não vale
      if (lixeira) desenharLixeira(d); else desenharHall(d, novos);
      return d;
    } catch (e) {
      if (LP.cancelado(e)) return null;
      hall.corpo.classList.remove('esmaecido');
      if (silencioso || (e && e.status === 401) || !LP.visivel(hall.corpo)) return null;
      hall.temDados = false;
      hall.busca.estado('');
      LP.trocar(hall.corpo, LP.estadoErro(e, () => carregarHall()));
      return null;
    }
  }

  const VAZIO_HALL = {
    publicas: ['O Hall público está vazio', 'Entram as até 3 melhores carreiras de cada conta (ou as que o jogador escolheu), na próxima fotografia.'],
    revisao: ['Nenhuma carreira esperando revisão', 'Carreiras com nota extraordinária ficam aqui, fora do Hall, até alguém conferir e liberar.'],
    suspeitas: ['Nenhuma carreira suspeita', 'É o que se espera. Carreiras com números fora do normal ficam aqui, fora do Hall, até alguém decidir.'],
    denunciadas: ['Nenhuma denúncia aberta', 'É o que se espera. Quando alguém denunciar uma carreira do Hall, ela aparece aqui.'],
    ocultas: ['Nenhuma carreira oculta', 'As que a moderação ocultar (ou que 5 denúncias esconderem) aparecem aqui.'],
    destaques: ['Nenhuma carreira em destaque', 'Use "Destacar" numa carreira do Hall para pôr o selo "Destaque".'],
    todas: ['Nenhuma carreira salva ainda', 'As carreiras salvas nas contas aparecem aqui.'],
  };

  function desenharHall(d, novos) {
    const itens = Array.isArray(d.itens) ? d.itens : [];
    hall.itens = itens;
    hall.ultimoTotal = d.total || 0;
    LP.subAba(LP.inteiro(d.total || 0) + ' ' + (NOMES_FILTRO[hall.filtro] || ''));
    hall.busca.estado(hall.q ? LP.plural(d.total || 0, 'encontrada', 'encontradas') : '');
    if (!itens.length) {
      const [t, x] = hall.q ? ['Nada encontrado', 'Confira a busca: nome do jogador, apelido do dono ou o id da carreira.'] : VAZIO_HALL[hall.filtro];
      document.body.classList.remove('com-lote');
      LP.trocar(hall.corpo, LP.estadoVazio(t, x));
      return;
    }
    const recarregar = () => carregarHall();
    const comLote = LP.pode('moderar');
    const lote = comLote ? LP.barraLote({
      itens: () => hall.itens,
      marcados: hall.marcados,
      nome: ['carreira', 'carreiras', 'f'],
      rotulo: (c) => c.jogador,
      aoMudar: () => { if (hall.tabela) hall.tabela.sincronizarSelecao(); },
      acoes: acoesLote(),
    }) : null;
    hall.lote = lote;
    hall.tabela = LP.lista({
      itens: itens,
      novos: novos,
      aoClicar: (c) => LP.abrirCarreira(c.id),
      rotuloLinha: (c) => 'Abrir a carreira ' + c.jogador,
      selecao: comLote ? { marcados: hall.marcados, aoMudar: () => lote.atualizar() } : null,
      colunas: [
        { rotulo: 'Pos.', num: true, celula: (c) => (c.posicaoHall ? LP.inteiro(c.posicaoHall) : '—') },
        { rotulo: 'Jogador', principal: true, celula: (c) => h('div', { class: 'celula-dupla' }, h('span', null, c.jogador || '—'), h('span', null, '#' + c.numero + ' · ' + c.pais + ' · ' + c.posicao)) },
        { rotulo: 'Dono', celula: (c) => LP.linkUsuario(c.usuario) },
        { rotulo: 'Nota', num: true, celula: (c) => h('div', { class: 'celula-dupla celula-nota' }, h('span', null, LP.inteiro(c.nota)), h('span', null, 'pico ' + LP.inteiro(c.picoOvr))) },
        { rotulo: 'Temp.', num: true, celula: (c) => LP.inteiro(c.temporadas) },
        { rotulo: 'Gols', num: true, celula: (c) => LP.inteiro(c.gols) },
        { rotulo: 'B. Ouro', num: true, celula: (c) => LP.inteiro(c.bolasOuro) },
        { rotulo: 'Sinais', classe: 'sinais-celula', celula: LP.celulaSinais },
        // a data em que foi salva vai embaixo da situação (a tabela cabe em 1440 sem rolar de lado)
        // (as denúncias já vêm no chip "N denúncias" da situação)
        { rotulo: 'Situação', classe: 'situacao', celula: (c) => h('div', { class: 'celula-situacao' }, chipsSituacao(c, true), h('span', { class: 'texto-3 pequeno' }, 'salva ', LP.quando(c.salvaEm))) },
        { rotulo: 'Ações', acoes: true, celula: (c) => LP.botoesCarreira(c, recarregar) },
      ],
    });
    LP.trocarNoLugar(hall.corpo, lote ? lote.no : null, hall.tabela, LP.paginacao(d.total || 0, d.pagina || hall.pagina, d.porPagina || 50, (p) => { hall.pagina = p; hall.marcados.clear(); carregarHall(); window.scrollTo(0, 0); }));
    if (lote) lote.atualizar();
  }

  /** Ações em lote de cada filtro (apagar não existe em lote, de propósito). */
  function acoesLote() {
    const f = hall.filtro;
    const ocultarLote = {
      rotulo: (n) => 'Ocultar ' + (n ? LP.plural(n, 'carreira', 'carreiras') : 'marcadas'), tipo: 'perigo', icone: 'ocultar',
      executar: (ids) => loteCarreiras(ids, 'ocultar'),
    };
    if (f === 'denunciadas') {
      return [
        { rotulo: (n) => 'Ocultar ' + (n ? LP.plural(n, 'carreira', 'carreiras') : 'marcadas'), tipo: 'perigo', icone: 'ocultar', executar: (ids) => loteDenuncias(ids, 'ocultar') },
        { rotulo: (n) => 'Manter: denúncia improcedente' + (n ? ' (' + n + ')' : ''), tipo: 'ok', icone: 'check', executar: (ids) => loteDenuncias(ids, 'ok') },
      ];
    }
    if (f === 'suspeitas' || f === 'revisao' || f === 'ocultas') {
      return [f === 'ocultas' ? null : ocultarLote,
        { rotulo: (n) => (f === 'ocultas' ? 'Mostrar ' : 'Liberar ') + (n ? LP.plural(n, 'carreira', 'carreiras') : 'marcadas'), tipo: 'ok', icone: 'olho', executar: (ids) => loteCarreiras(ids, 'mostrar') }].filter(Boolean);
    }
    return [ocultarLote];
  }
  LP.loteHallAcoes = acoesLote;

  async function loteCarreiras(ids, operacao) {
    const n = ids.length;
    const ocultarOp = operacao === 'ocultar';
    const r = await LP.dialogoMotivo({
      titulo: (ocultarOp ? 'Ocultar ' : hall.filtro === 'ocultas' ? 'Mostrar ' : 'Liberar ') + LP.plural(n, 'carreira', 'carreiras'),
      perigo: ocultarOp,
      tipoBotao: ocultarOp ? 'perigo' : 'ok',
      botao: (ocultarOp ? 'Ocultar ' : hall.filtro === 'ocultas' ? 'Mostrar ' : 'Liberar ') + LP.plural(n, 'carreira', 'carreiras'),
      gerundio: ocultarOp ? 'Ocultando…' : 'Liberando…',
      obrigatorio: ocultarOp,
      avisar: ocultarOp,
      chips: ocultarOp ? undefined : [{ rotulo: 'Conferi os números' }, { rotulo: 'Engano da moderação' }, { rotulo: 'Outro', vazio: true }],
      texto: ocultarOp ? 'Vai ocultar ' + LP.plural(n, 'carreira', 'carreiras') + '. ' + (n === 1 ? 'Ela sai' : 'Elas saem') + ' do Hall na hora (dá para mostrar de novo depois).'
        : (n === 1 ? 'Volta' : 'Voltam') + ' ao Hall na próxima fotografia (ou em "Atualizar Hall agora").',
      executar: (v) => LP.adminPost({ acao: 'carreiras_lote', ids: ids.map(Number), operacao: operacao, motivo: v.motivo || undefined, avisar: v.avisar || undefined, avisoMotivo: v.avisar ? v.avisoMotivo : undefined }),
    });
    if (!r) return;
    terminarLote(r.feitos || [], r.pulados, ocultarOp ? ['ocultada', 'ocultadas'] : ['liberada', 'liberadas'], r.denunciasFechadas);
  }
  async function loteDenuncias(ids, resultado) {
    const n = ids.length;
    const ocultarOp = resultado === 'ocultar';
    const r = await LP.dialogoMotivo({
      titulo: ocultarOp ? 'Ocultar ' + LP.plural(n, 'carreira denunciada', 'carreiras denunciadas') : 'Manter ' + LP.plural(n, 'carreira', 'carreiras') + ' no Hall',
      perigo: ocultarOp,
      tipoBotao: ocultarOp ? 'perigo' : 'ok',
      botao: ocultarOp ? 'Ocultar ' + LP.plural(n, 'carreira', 'carreiras') : 'Manter ' + LP.plural(n, 'carreira', 'carreiras'),
      gerundio: ocultarOp ? 'Ocultando…' : 'Fechando…',
      obrigatorio: ocultarOp,
      avisar: ocultarOp,
      chips: ocultarOp ? undefined : [{ rotulo: 'Denúncia improcedente' }, { rotulo: 'Conferi os números' }, { rotulo: 'Outro', vazio: true }],
      texto: ocultarOp ? (n === 1 ? 'A carreira sai do Hall na hora e as denúncias abertas dela são fechadas como "ocultar".' : 'As carreiras saem do Hall na hora e as denúncias abertas delas são fechadas como "ocultar".')
        : 'As denúncias abertas são fechadas como "ok"; ' + (n === 1 ? 'se ela estava escondida por denúncia, volta' : 'as escondidas por denúncia voltam') + ' ao Hall na próxima fotografia.',
      executar: (v) => LP.adminPost({ acao: 'resolver_denuncias_lote', carreiras: ids.map(Number), resultado: resultado, motivo: v.motivo || undefined, avisar: v.avisar || undefined, avisoMotivo: v.avisar ? v.avisoMotivo : undefined }),
    });
    if (!r) return;
    terminarLote(r.carreiras || [], r.pulados, ocultarOp ? ['ocultada', 'ocultadas'] : ['mantida', 'mantidas'], r.denunciasFechadas);
  }
  LP.loteDenuncias = loteDenuncias;
  function terminarLote(feitos, pulados, verbos, fechadas) {
    LP.avisar(LP.resumoLote(feitos.length, pulados, verbos, PULOS) + (fechadas ? ' · ' + LP.plural(fechadas, 'denúncia fechada', 'denúncias fechadas') : '') + '.');
    feitos.forEach((id) => hall.marcados.delete(String(id)));
    // antes do pulso que a ação pede: estas saíram por decisão desta aba (não "em outra aba")
    LP.marcarFeitos('carreira', feitos);
    LP.depoisDeAgir();
    const m = LP.abas[LP.rota().aba];
    if (m && m.desmarcar) m.desmarcar(feitos);
    const raiz = m && m.raizLote ? m.raizLote() : hall.corpo;
    LP.sumirLinhas(raiz, feitos, () => { if (m && m.aoMudarFora) m.aoMudarFora(); });
  }
  LP.terminarLote = terminarLote;

  function desenharLixeira(d) {
    const itens = Array.isArray(d.itens) ? d.itens : [];
    LP.subAba(LP.plural(d.total || 0, 'carreira na lixeira', 'carreiras na lixeira'));
    hall.busca.estado('');
    document.body.classList.remove('com-lote');
    const ajuda = LP.ajuda('Carreiras apagadas pela moderação ficam 30 dias com cópia (dá para restaurar como oculta). Depois fica só a marca, que impede o jogador de salvar a mesma carreira de novo; "Liberar reenvio" tira a marca.');
    if (!itens.length) { LP.trocar(hall.corpo, ajuda, LP.estadoVazio('A lixeira está vazia', 'Nenhuma carreira apagada pela moderação.')); return; }
    const recarregar = () => carregarHall();
    LP.trocar(hall.corpo, ajuda, LP.lista({
      itens: itens,
      colunas: [
        { rotulo: 'Jogador', principal: true, celula: (x) => h('div', { class: 'celula-dupla' }, h('span', null, x.jogador || '—'), h('span', null, 'nota ' + LP.inteiro(x.nota))) },
        { rotulo: 'Dono', celula: (x) => LP.linkUsuario(x.usuario) },
        { rotulo: 'Motivo', classe: 'quebra', celula: (x) => x.motivo || '—' },
        { rotulo: 'Apagada em', celula: (x) => LP.quando(x.apagadaEm) },
        { rotulo: 'por', celula: (x) => x.apagadaPorNome || x.apagadaPor || '—' },
        { rotulo: 'Cópia', celula: (x) => (x.temCopia ? 'some ' + LP.relativo(x.expiraEm) : LP.chip('venceu: só a marca', '', { semPonto: true })) },
        { rotulo: 'Ações', acoes: true, celula: (x) => LP.botoesLixeira(x, recarregar) },
      ],
    }), LP.paginacao(d.total || 0, d.pagina || hall.pagina, d.porPagina || 50, (p) => { hall.pagina = p; carregarHall(); window.scrollTo(0, 0); }));
  }

  async function atualizarHall() {
    try {
      const r = await LP.adminPost({ acao: 'atualizar_hall' }, { tempo: 60000 });
      const e = r.hall || {};
      LP.avisar('Hall atualizado: ' + LP.plural(e.total || 0, 'carreira', 'carreiras') + ' em ' + LP.inteiro(e.ms || 0) + ' ms.');
      if (LP.resumo) LP.resumo.hall = { atualizadoEm: e.em, proximaEm: e.proximaEm, total: e.total, ms: e.ms };
      desenharInfo();
      LP.depoisDeAgir();
      carregarHall();
    } catch (e) {
      LP.avisarErro(e);
    }
  }

  /** P1-13: a fila aberta mudou noutro lugar (pulso). */
  async function filaHall(a) {
    const nome = hall.filtro === 'denunciadas' ? 'denuncias' : hall.filtro === 'suspeitas' ? 'suspeitas' : null;
    if (!nome || !a.filas || hall.q || hall.pagina > 1) return;
    const novo = a.filas[nome];
    if (novo === hall.fila) return;
    hall.fila = novo;
    const d = await carregarHall(true);
    if (!d) return;
    LP.atualizarFila({
      raiz: hall.corpo,
      antes: hall.itens.map((x) => x.id),
      depois: (d.itens || []).map((x) => x.id),
      marcados: hall.marcados,
      tipo: 'carreira',
      rotuloNovos: (n) => nome === 'denuncias' ? LP.plural(n, 'carreira denunciada nova', 'carreiras denunciadas novas') + ' — clique para ver' : LP.plural(n, 'suspeita nova', 'suspeitas novas') + ' — clique para ver',
      redesenhar: (novos) => desenharHall(d, novos),
      recarregar: (novos) => carregarHall(false, novos),
      aoMudarSelecao: () => { if (hall.lote) hall.lote.atualizar(); },
    });
  }

  LP.abas.hall = {
    titulo: 'Hall público',
    sub: '',
    montar: montarHall,
    recarregar: () => carregarHall(),
    sair: () => { document.body.classList.remove('com-lote'); },
    aoPulso: (a) => { desenharFiltros(); filaHall(a); },
    aoResumo: () => { desenharInfo(); if (hall.filtros && hall.filtros.isConnected) desenharFiltros(); },
    aoMudarFora: () => carregarHall(),
  };

  // ═══ aba Denúncias (a fila, agrupada por carreira) ═══════════════════════════════════════════
  const den = { status: 'abertas', pagina: 1, corpo: null, filtros: null, temDados: false, grupos: [], marcados: new Set(), lote: null, fila: null, caixas: [] };

  function montarDenuncias(raiz, rota) {
    den.status = rota.query.status === 'todas' ? 'todas' : 'abertas';
    den.pagina = Math.max(1, parseInt(rota.query.pagina, 10) || 1);
    den.temDados = false;
    den.marcados = new Set();
    den.fila = null;
    den.corpo = h('div');
    den.filtros = h('div');
    LP.trocar(raiz,
      LP.ajuda('Com 5 denúncias abertas de contas com mais de 24 h e 3 partidas, a carreira sai do Hall sozinha até alguém decidir (menos as 10 primeiras do Hall). "Manter" fecha as denúncias e devolve ao Hall a que elas esconderam; "Ocultar" tira do Hall. Decidir fecha todas as abertas da carreira.'),
      h('div', { class: 'ferramentas' }, den.filtros), den.corpo);
    desenharFiltrosDen();
    carregarDen();
  }
  function desenharFiltrosDen() {
    if (!den.filtros || !den.filtros.isConnected) return;
    const ac = (LP.agora && LP.agora.acao) || {};
    const r = LP.resumo || {};
    LP.trocarSegmentos(den.filtros, 'Mostrar', [
      { valor: 'abertas', rotulo: 'Abertas', contador: (ac.denunciasAbertas !== undefined ? ac.denunciasAbertas : r.denunciasAbertas) || 0, tipoContador: 'perigo' },
      { valor: 'todas', rotulo: 'Todas' },
    ], den.status, (v) => { den.status = v; den.pagina = 1; den.marcados.clear(); den.fila = null; desenharFiltrosDen(); carregarDen(); });
  }

  async function carregarDen(silencioso, novos) {
    if (!LP.visivel(den.corpo)) return null;
    LP.trocarQuery('denuncias', { status: den.status === 'abertas' ? '' : den.status, pagina: den.pagina > 1 ? den.pagina : '' });
    if (!silencioso) {
      den.fila = LP.filaDoPulso('denuncias');
      if (!den.temDados) LP.trocar(den.corpo, LP.estadoCarregando(5));
      else den.corpo.classList.add('esmaecido');
    }
    try {
      const d = await LP.adminGet('denuncias', { status: den.status, pagina: den.pagina }, { sinal: LP.unico(silencioso ? 'denuncias-pulso' : 'denuncias') });
      if (!LP.visivel(den.corpo)) return null;
      den.corpo.classList.remove('esmaecido');
      if (silencioso) return d;
      den.temDados = true;
      LP.esconderNovidade();
      desenharDen(d, novos);
      return d;
    } catch (e) {
      if (LP.cancelado(e)) return null;
      den.corpo.classList.remove('esmaecido');
      if (silencioso || (e && e.status === 401) || !LP.visivel(den.corpo)) return null;
      den.temDados = false;
      LP.trocar(den.corpo, LP.estadoErro(e, () => carregarDen()));
      return null;
    }
  }

  function agrupar(itens) {
    const grupos = [];
    const por = {};
    itens.forEach((x) => {
      const k = x.carreira ? String(x.carreira.id) : 'd' + x.id;
      if (!por[k]) { por[k] = { id: k, carreira: x.carreira, itens: [], sinais: [], seguro: true }; grupos.push(por[k]); }
      const g = por[k];
      g.itens.push(x);
      (x.sinais || []).forEach((s) => { if (!g.sinais.some((y) => y.codigo === s.codigo)) g.sinais.push(s); });
      g.seguro = g.seguro && x.seguro !== false;
    });
    return grupos;
  }

  function desenharDen(d, novos) {
    const itens = Array.isArray(d.itens) ? d.itens : [];
    LP.subAba(LP.inteiro(d.total || 0) + (den.status === 'abertas' ? ' abertas' : ' no total'));
    den.grupos = agrupar(itens);
    if (!itens.length) {
      document.body.classList.remove('com-lote');
      LP.trocar(den.corpo, den.status === 'abertas'
        ? LP.estadoVazio('Nenhuma denúncia aberta', 'É o que se espera. As novas aparecem aqui sozinhas (e o número lá em cima avisa).')
        : LP.estadoVazio('Nenhuma denúncia ainda', 'Jogadores logados podem denunciar carreiras do Hall público.'));
      return;
    }
    const recarregar = () => carregarDen();
    const abertas = (g) => g.carreira && g.itens.some((x) => x.status === 'aberta');
    const comLote = LP.pode('moderar') && den.status === 'abertas';
    den.caixas = [];
    const sincronizar = () => den.caixas.forEach((c) => { c.checked = den.marcados.has(c.dataset.id); c.closest('.denuncia').classList.toggle('marcada', c.checked); });
    const lote = comLote ? LP.barraLote({
      itens: () => den.grupos.filter(abertas),
      marcados: den.marcados,
      nome: ['carreira', 'carreiras', 'f'],
      rotulo: (g) => (g.carreira && g.carreira.jogador) || '',
      aoMudar: sincronizar,
      acoes: [
        { rotulo: (n) => 'Ocultar ' + (n ? LP.plural(n, 'carreira', 'carreiras') : 'marcadas'), tipo: 'perigo', icone: 'ocultar', executar: (ids) => LP.loteDenuncias(ids, 'ocultar') },
        { rotulo: (n) => 'Manter: improcedente' + (n ? ' (' + n + ')' : ''), tipo: 'ok', icone: 'check', executar: (ids) => LP.loteDenuncias(ids, 'ok') },
      ],
    }) : null;
    den.lote = lote;
    const cartoes = den.grupos.map((g) => {
      const c = g.carreira;
      const aberta = g.itens.find((x) => x.status === 'aberta');
      const nAbertas = aberta ? aberta.abertasNaCarreira || g.itens.filter((x) => x.status === 'aberta').length : 0;
      let caixa = null;
      if (comLote && abertas(g)) {
        caixa = h('input', { type: 'checkbox', 'aria-label': 'Marcar ' + ((c && c.jogador) || 'carreira'), dataset: { id: g.id } });
        caixa.checked = den.marcados.has(g.id);
        caixa.addEventListener('change', () => { if (caixa.checked) den.marcados.add(g.id); else den.marcados.delete(g.id); caixa.closest('.denuncia').classList.toggle('marcada', caixa.checked); lote.atualizar(); });
        den.caixas.push(caixa);
      }
      const cab = c
        ? h('div', { class: 'chips' },
          caixa ? h('label', { class: 'alvo-caixa' }, caixa) : null,
          LP.linkCarreira(c.id, h('b', null, c.jogador || '—')),
          h('span', { class: 'texto-3' }, 'nota ' + LP.inteiro(c.nota) + (c.posicaoHall ? ' · ' + c.posicaoHall + 'º no Hall' : '') + ' · de '), LP.linkUsuario(c.dono),
          c.oculta === 1 ? LP.chip('Oculta (moderação)', '') : c.oculta === 2 ? LP.chip('Oculta (denúncias)', 'perigo') : null,
          c.suspeita ? LP.chip('Suspeita', 'alerta') : null)
        : h('span', { class: 'texto-3' }, 'Carreira apagada');
      const sinais = LP.sinais(g);
      const lista = g.itens.map((x) => h('div', { class: 'denuncia-item' },
        h('div', { class: 'chips' }, LP.chip(LP.NOMES_DENUNCIA[x.motivo] || x.motivo, 'perigo', { semPonto: true }),
          x.status !== 'aberta' ? estadoDenuncia(x.status) : null,
          h('span', { class: 'texto-3' }, 'por ', LP.linkUsuario(x.denunciante), ' · ', LP.quando(x.criadaEm))),
        x.texto ? h('p', { class: 'denuncia-texto' }, x.texto) : null));
      const acoes = aberta && c && LP.pode('moderar')
        ? h('div', { class: 'botoes' },
          LP.botao('Ver carreira', () => LP.abrirCarreira(c.id), { tipo: 'fantasma', pequeno: true, icone: 'olho' }),
          LP.botao('Manter no Hall', () => resolver(aberta, 'ok', recarregar), { tipo: 'ok', pequeno: true, icone: 'check' }),
          LP.botao('Ocultar', () => resolver(aberta, 'ocultar', recarregar), { tipo: 'perigo', pequeno: true, icone: 'ocultar' }))
        : c ? h('div', { class: 'botoes' }, LP.botao('Ver carreira', () => LP.abrirCarreira(c.id), { tipo: 'fantasma', pequeno: true, icone: 'olho' })) : null;
      const art = h('article', { class: 'denuncia' + (novos && novos.has(g.id) ? ' novo' : '') + (den.marcados.has(g.id) ? ' marcada' : ''), dataset: { id: g.id } },
        h('div', { class: 'denuncia-topo' }, cab, nAbertas ? LP.chip(LP.plural(nAbertas, 'aberta', 'abertas') + ' nesta carreira', 'perigo', { semPonto: true }) : null),
        sinais.graves, sinais.leves,
        lista,
        acoes ? h('div', { class: 'denuncia-pe' }, h('span', { class: 'texto-3' }, aberta ? 'Decidir aqui fecha todas as abertas desta carreira.' : ''), acoes) : null);
      return art;
    });
    LP.trocarNoLugar(den.corpo, lote ? lote.no : null, h('div', null, cartoes), LP.paginacao(d.total || 0, d.pagina || den.pagina, d.porPagina || 50, (p) => { den.pagina = p; den.marcados.clear(); carregarDen(); window.scrollTo(0, 0); }));
    if (lote) lote.atualizar();
  }

  async function resolver(x, resultado, depois) {
    const c = x.carreira || {};
    const n = x.abertasNaCarreira || 1;
    const ok = resultado === 'ok';
    let jaDecidida = null;
    const r = await LP.dialogoMotivo({
      titulo: ok ? 'Manter ' + (c.jogador || 'a carreira') + ' no Hall' : 'Ocultar ' + (c.jogador || 'a carreira'),
      perigo: !ok,
      tipoBotao: ok ? 'ok' : 'perigo',
      botao: ok ? 'Manter' : 'Ocultar',
      gerundio: ok ? 'Fechando…' : 'Ocultando…',
      obrigatorio: !ok,
      avisar: !ok,
      chips: ok ? [{ rotulo: 'Denúncia improcedente' }, { rotulo: 'Conferi os números' }, { rotulo: 'Outro', vazio: true }] : undefined,
      texto: ok
        ? 'Fecha ' + LP.plural(n, 'denúncia aberta', 'denúncias abertas') + ' desta carreira como "ok". Se as denúncias tinham escondido a carreira, ela volta ao Hall na próxima fotografia.'
        : 'A carreira sai do Hall na hora e ' + LP.plural(n, 'denúncia aberta é fechada', 'denúncias abertas são fechadas') + '. Dá para mostrar de novo no Hall público.',
      executar: async (v) => {
        try {
          return await LP.adminPost({ acao: 'resolver_denuncia', id: x.id, resultado: resultado, motivo: v.motivo || undefined, avisar: v.avisar || undefined, avisoMotivo: v.avisar ? v.avisoMotivo : undefined });
        } catch (e) {
          // rev3 (§E.7): outra pessoa (ou outra aba) decidiu antes e nada mudou: fecha o diálogo e mostra a lista de agora
          if (e && e.status === 409 && e.codigo === 'ja_decidida') { jaDecidida = e; return {}; }
          throw e;
        }
      },
    });
    if (!r) return;
    if (jaDecidida) {
      LP.avisar(LP.mensagem(jaDecidida).replace(/\s*Atualize a lista[^.]*\.?\s*$/, '') + ' A lista foi atualizada.', 'info', 7000);
      LP.depoisDeAgir();
      if (depois) depois();
      return;
    }
    LP.avisar((ok ? 'Carreira mantida' : 'Carreira ocultada') + ' · ' + LP.plural(r.denunciasFechadas || 0, 'denúncia fechada', 'denúncias fechadas') + '.');
    if (c.id) LP.marcarFeitos('carreira', [c.id]);
    LP.depoisDeAgir();
    if (depois) depois();
  }

  async function filaDen(a) {
    if (!a.filas || den.status !== 'abertas' || den.pagina > 1) return;
    const novo = a.filas.denuncias;
    if (novo === den.fila) return;
    den.fila = novo;
    const d = await carregarDen(true);
    if (!d) return;
    LP.atualizarFila({
      raiz: den.corpo,
      antes: den.grupos.map((g) => g.id),
      depois: agrupar(d.itens || []).map((g) => g.id),
      marcados: den.marcados,
      tipo: 'carreira',
      rotuloNovos: (n) => LP.plural(n, 'carreira denunciada nova', 'carreiras denunciadas novas') + ' — clique para ver',
      redesenhar: (novos) => desenharDen(d, novos),
      recarregar: (novos) => carregarDen(false, novos),
      aoMudarSelecao: () => { if (den.lote) den.lote.atualizar(); },
    });
  }

  LP.abas.denuncias = {
    titulo: 'Denúncias',
    sub: '',
    montar: montarDenuncias,
    recarregar: () => carregarDen(),
    sair: () => { document.body.classList.remove('com-lote'); },
    aoPulso: (a) => { desenharFiltrosDen(); filaDen(a); },
    aoMudarFora: () => carregarDen(),
    raizLote: () => den.corpo,
    desmarcar: (ids) => ids.forEach((id) => den.marcados.delete(String(id))),
  };
})();
