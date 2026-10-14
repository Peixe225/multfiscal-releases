/* LENDA · painel — Usuários: lista (busca, status, ordem, páginas, exportar CSV) e o detalhe de cada conta com as
 * ações de moderação (suspender, reativar, deslogar, renomear, dar/tirar bônus, excluir). Fala com ../api/admin.php. */
'use strict';

(function () {
  const LP = window.LP;
  const { h } = LP;

  const ORDENS = [
    { valor: 'recentes', rotulo: 'Mais recentes' },
    { valor: 'acesso', rotulo: 'Último acesso' },
    { valor: 'partidas', rotulo: 'Mais partidas' },
    { valor: 'nota', rotulo: 'Melhor nota' },
    { valor: 'tempo', rotulo: 'Mais tempo jogado' },
  ];
  const STATUS = [
    { valor: '', rotulo: 'Todos' },
    { valor: 'ativo', rotulo: 'Ativos' },
    { valor: 'suspenso', rotulo: 'Suspensos' },
  ];
  const APELIDO_RE = /^[\p{L}\p{N}_.\- ]{2,20}$/u;

  // ═══ lista ═════════════════════════════════════════════════════════════════════════════════
  const lista = { q: '', status: '', ordem: 'recentes', pagina: 1, pedido: 0, corpo: null, temDados: false };

  function montarLista(raiz, rota) {
    const q = rota.query;
    lista.q = (q.q || '').slice(0, 100);
    lista.status = q.status === 'ativo' || q.status === 'suspenso' ? q.status : '';
    lista.ordem = ORDENS.some((o) => o.valor === q.ordem) ? q.ordem : 'recentes';
    lista.pagina = Math.max(1, parseInt(q.pagina, 10) || 1);
    lista.temDados = false;
    lista.corpo = h('div');
    LP.trocar(raiz,
      h('div', { class: 'ferramentas' },
        LP.busca('Buscar por apelido, e-mail, id ou código de convite', lista.q, (v) => { lista.q = v; lista.pagina = 1; carregar(); }),
        LP.selecao('Status', STATUS, lista.status, (v) => { lista.status = v; lista.pagina = 1; carregar(); }),
        LP.selecao('Ordem', ORDENS, lista.ordem, (v) => { lista.ordem = v; lista.pagina = 1; carregar(); })),
      lista.corpo);
    LP.acoesAba(LP.botao('Exportar CSV', exportar, { icone: 'baixar', tipo: 'fantasma', title: 'Baixa todas as contas numa planilha (fica no Registro)' }));
    carregar();
  }

  function queryLista() {
    return { q: lista.q, status: lista.status, ordem: lista.ordem === 'recentes' ? '' : lista.ordem, pagina: lista.pagina > 1 ? lista.pagina : '' };
  }

  async function carregar() {
    const n = ++lista.pedido;
    if (!LP.visivel(lista.corpo)) return;
    LP.trocarQuery('usuarios', queryLista());
    LP.ultimaListaUsuarios = location.hash;
    if (!lista.temDados) LP.trocar(lista.corpo, LP.estadoCarregando(6));
    else lista.corpo.classList.add('esmaecido');
    try {
      const d = await LP.adminGet('usuarios', { q: lista.q, status: lista.status, ordem: lista.ordem, pagina: lista.pagina });
      if (n !== lista.pedido || !LP.visivel(lista.corpo)) return;
      lista.temDados = true;
      desenharLista(d);
    } catch (e) {
      if (n !== lista.pedido || (e && e.status === 401) || !LP.visivel(lista.corpo)) return;
      lista.temDados = false;
      LP.trocar(lista.corpo, LP.estadoErro(e, carregar));
    } finally {
      if (n === lista.pedido) lista.corpo.classList.remove('esmaecido');
    }
  }

  function desenharLista(d) {
    const itens = Array.isArray(d.itens) ? d.itens : [];
    const total = d.total || 0;
    LP.subAba(LP.inteiro(total) + (total === 1 ? ' conta' : ' contas') + (lista.q || lista.status ? ' com esse filtro' : ''));
    if (!itens.length) {
      const filtrado = lista.q || lista.status;
      LP.trocar(lista.corpo, LP.estadoVazio(filtrado ? 'Nenhum usuário encontrado' : 'Nenhuma conta ainda',
        filtrado ? 'Confira a busca: apelido, e-mail, id (número) ou código de convite.' : 'As contas aparecem aqui assim que os jogadores se cadastrarem.',
        filtrado ? LP.botao('Limpar filtros', () => { location.hash = '#/usuarios'; }, { tipo: 'fantasma' }) : null));
      return;
    }
    const tabela = LP.lista({
      itens: itens,
      aoClicar: (u) => { location.hash = LP.usuarioHash(u.id); },
      rotuloLinha: (u) => 'Abrir ' + u.apelido,
      colunas: [
        { rotulo: 'Usuário', principal: true, classe: 'celula-larga', celula: (u) => h('div', { class: 'celula-dupla' },
          h('span', null, u.apelido), h('span', null, u.email + ' · #' + u.id)) },
        { rotulo: 'Status', celula: (u) => LP.chipStatus(u.status) },
        { rotulo: 'Criada', celula: (u) => LP.quando(u.criadoEm) },
        { rotulo: 'Último acesso', celula: (u) => LP.quando(u.ultimoAcesso) },
        { rotulo: 'Partidas', num: true, celula: (u) => LP.inteiro(u.partidas) },
        { rotulo: 'Carreiras', num: true, celula: (u) => LP.inteiro(u.carreiras) },
        { rotulo: 'Melhor nota', num: true, celula: (u) => (u.melhorNota === null || u.melhorNota === undefined ? '—' : LP.inteiro(u.melhorNota)) },
        { rotulo: 'Tempo', num: true, celula: (u) => LP.minutos(u.tempoJogadoMin) },
        { rotulo: 'Origem', celula: (u) => LP.origemCurta(u.origem) },
        { rotulo: 'Indicações', num: true, celula: (u) => LP.inteiro(u.indicacoes) },
        { rotulo: 'Bônus', num: true, celula: (u) => (u.bonusDisponiveis ? LP.chip('+' + u.bonusDisponiveis + (u.bonusDisponiveis === 1 ? ' bônus' : ' bônus'), 'ouro', { semPonto: true, title: 'Bônus que dá para usar agora' }) : '—') },
      ],
    });
    LP.trocar(lista.corpo, tabela, LP.paginacao(total, d.pagina || lista.pagina, d.porPagina || 50, (p) => { lista.pagina = p; carregar(); window.scrollTo(0, 0); }));
  }

  async function exportar(ev, b) {
    LP.ocupado(b, true);
    try {
      await LP.painelGet('?so=eu'); // a sessão ainda vale? (senão o "arquivo" seria a mensagem de erro)
      const a = h('a', { href: LP.API_ADMIN + '?r=exportar&tipo=usuarios', download: '', class: 'so-celular' });
      document.body.appendChild(a);
      a.click();
      a.remove();
      LP.avisar('A planilha (CSV) está baixando. A exportação fica anotada no Registro.', 'info');
    } catch (e) {
      LP.avisarErro(e);
    } finally {
      LP.ocupado(b, false);
    }
  }

  LP.abas.usuarios = {
    titulo: 'Usuários',
    sub: '',
    montar: montarLista,
    recarregar: () => carregar(),
    focarBusca: true,
  };

  // ═══ detalhe ═══════════════════════════════════════════════════════════════════════════════
  const det = { id: 0, pedido: 0, raiz: null, u: null };

  function voltar() {
    const a = h('a', { href: LP.ultimaListaUsuarios || '#/usuarios', class: 'voltar' }, LP.icone('voltar'), 'Usuários');
    return a;
  }

  function montarDetalhe(raiz, rota) {
    det.raiz = raiz;
    det.id = parseInt(rota.partes[1], 10) || 0;
    det.u = null;
    LP.trocar(raiz, voltar(), LP.estadoCarregando(8));
    carregarDetalhe();
  }

  async function carregarDetalhe() {
    const n = ++det.pedido;
    if (!det.id) {
      LP.trocar(det.raiz, voltar(), LP.estadoVazio('Usuário não encontrado', 'O endereço não tem um id válido.'));
      return;
    }
    if (!LP.visivel(det.raiz)) return;
    if (det.u) det.raiz.classList.add('esmaecido');
    try {
      const [d, nomes] = await Promise.all([LP.adminGet('usuario', { id: det.id }), LP.nomes()]);
      if (n !== det.pedido || !LP.visivel(det.raiz)) return;
      if (!d.usuario) throw new LP.ErroApi(500, 'formato', 'Resposta sem o usuário.');
      const rolagem = window.scrollY;
      const primeira = !det.u;
      det.u = d.usuario;
      desenharDetalhe(det.u, nomes);
      if (!primeira) window.scrollTo(0, rolagem);
    } catch (e) {
      if (n !== det.pedido || (e && e.status === 401) || !LP.visivel(det.raiz)) return;
      if (e && e.status === 404) {
        LP.tituloAba('Usuário');
        LP.trocar(det.raiz, voltar(), LP.estadoVazio('Usuário não encontrado', 'A conta pode ter sido excluída.', h('a', { href: '#/usuarios', class: 'botao' }, 'Ver todos os usuários')));
      } else {
        LP.trocar(det.raiz, voltar(), LP.estadoErro(e, carregarDetalhe));
      }
    } finally {
      if (n === det.pedido) det.raiz.classList.remove('esmaecido');
    }
  }
  function recarregarDetalhe() {
    carregarDetalhe();
    LP.atualizarResumo();
  }

  function secao(id, titulo, extra, botoes, conteudo, larga) {
    return h('section', { class: 'cartao ancora' + (larga ? ' larga' : ''), id: id, 'aria-labelledby': id + '-t' },
      h('div', { class: 'cartao-cabeca' }, h('h2', { id: id + '-t' }, titulo, extra ? h('span', { class: 'texto-3' }, extra) : null),
        botoes ? h('div', { class: 'botoes' }, botoes) : null),
      h('div', null, conteudo));
  }

  function desenharDetalhe(u, nomes) {
    const s = u.estatisticas || {};
    const suspenso = u.status === 'suspenso';
    LP.tituloAba('Usuário');
    LP.subAba(u.apelido + ' · conta #' + u.id + ' · criada ' + LP.relativo(u.criadoEm));
    const cfgBonus = (LP.resumo && LP.resumo.site && LP.resumo.site.bonus) || null;
    const faltam = cfgBonus ? Math.max(0, (cfgBonus.liberaAposPartidas || 0) - (u.partidasConta || 0)) : null;
    const sessoes = Array.isArray(u.sessoes) ? u.sessoes : [];

    // ── perfil + ações ──
    const acoes = [
      suspenso ? LP.botao('Reativar', () => reativar(u), { tipo: 'ok', icone: 'reativar' }) : LP.botao('Suspender', () => suspender(u), { tipo: 'perigo', icone: 'bloquear' }),
      LP.botao('Deslogar' + (sessoes.length ? ' (' + sessoes.length + ')' : ''), () => deslogar(u, sessoes.length), { tipo: 'fantasma', icone: 'sair', title: 'Encerra as sessões de login em todos os aparelhos' }),
      LP.botao('Renomear', () => renomear(u), { tipo: 'fantasma', icone: 'lapis' }),
      LP.botao('Dar bônus', () => darBonus(u), { tipo: 'fantasma', icone: 'presente' }),
      LP.botao('Excluir conta', () => excluir(u), { tipo: 'perigo', icone: 'lixo' }),
    ];
    const codigo = u.codigoConvite ? h('span', { class: 'chips' }, h('span', { class: 'mono' }, u.codigoConvite),
      LP.botao('', () => LP.copiar(location.origin + location.pathname.replace(/painel\/.*$/, '') + '?c=' + u.codigoConvite), { tipo: 'fantasma', pequeno: true, icone: 'copiar', rotulo: 'Copiar o link de convite', title: 'Copiar o link de convite' })) : '—';
    const perfil = h('section', { class: 'cartao' },
      h('div', { class: 'perfil' },
        h('div', null,
          h('div', { class: 'perfil-nome' }, h('h2', null, u.apelido), LP.chipStatus(u.status),
            LP.chip('Hall: ' + (LP.NOMES_HALL_PUBLICO[u.hallPublico] || u.hallPublico || '—'), 'info', { semPonto: true, title: 'Como as carreiras desta conta entram no Hall público' })),
          h('dl', { class: 'perfil-dados' },
            LP.dado('E-mail', u.email),
            LP.dado('ID', '#' + u.id),
            LP.dado('Criada em', LP.dataHoraAno(u.criadoEm)),
            LP.dado('Último acesso', s.ultimoAcesso ? LP.quando(s.ultimoAcesso) : '—'),
            LP.dado('Primeiro acesso', s.primeiroAcesso ? LP.dataHoraAno(s.primeiroAcesso) : '—'),
            LP.dado('Origem', LP.origem(u.origem)),
            LP.dado('Time do coração', u.timeCoracao),
            LP.dado('Estado', u.uf === 'EX' ? 'Fora do Brasil' : u.uf),
            LP.dado('Aparelhos', (s.aparelhos || []).map(LP.aparelho).join(', ')),
            LP.dado('Código de convite', codigo))),
        h('div', { class: 'perfil-acoes' }, acoes)),
      suspenso ? h('p', { class: 'faixa faixa-perigo' }, 'Conta suspensa ' + (u.suspensoAte ? 'até ' + LP.dataHoraAno(u.suspensoAte) : 'até você reativar') +
        (u.motivo ? '. Motivo: ' + u.motivo : '') + '. Não consegue entrar e as carreiras estão fora do Hall público.') : null);

    // ── números ──
    const den = u.denuncias || {};
    const conq = Array.isArray(u.conquistas) ? u.conquistas : [];
    const L = LP.ladrilho;
    const numeros = h('div', { class: 'ladrilhos ladrilhos-pequenos' },
      L('Partidas', LP.inteiro(s.partidas), 'no total (aparelho e conta)'),
      L('Com a conta', LP.inteiro(u.partidasConta), u.bonusLiberado ? 'bônus liberados' : faltam !== null ? 'faltam ' + faltam + ' para liberar os bônus' : 'bônus ainda bloqueados'),
      L('Carreiras salvas', LP.inteiro(s.carreirasSalvas), (u.carreiras || []).filter((c) => c.noHall).length + ' no Hall público'),
      L('Melhor nota', s.melhorNota === null || s.melhorNota === undefined ? '—' : LP.inteiro(s.melhorNota), s.melhorJogador || ''),
      L('Bolas de Ouro', LP.inteiro(s.bolasOuro), 'somando as carreiras salvas'),
      L('Gols', LP.num(s.gols), LP.inteiro(s.titulos) + ' títulos'),
      L('Tempo jogado', LP.minutos(s.tempoJogadoMin), 'com a aba visível'),
      L('Conquistas', LP.inteiro(conq.length), 'na conta'),
      L('Denúncias', LP.inteiro(den.recebidas), 'recebidas · ' + LP.inteiro(den.feitas) + ' feitas'));

    // ── atalhos para as seções ──
    const ir = (id) => () => { const alvo = document.getElementById(id); if (alvo) alvo.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    const subnav = h('nav', { class: 'sub-nav', 'aria-label': 'Seções do usuário' },
      [['u-carreiras', 'Carreiras'], ['u-bonus', 'Bônus'], ['u-indicacoes', 'Indicações'], ['u-conquistas', 'Conquistas'], ['u-sessoes', 'Sessões'], ['u-visitas', 'Visitas'], ['u-eventos', 'Eventos']]
        .map(([id, t]) => h('a', { href: '#/usuario/' + u.id, onclick: (ev) => { ev.preventDefault(); ir(id)(); } }, t)));

    const grade = h('div', { class: 'grade-detalhe' },
      secaoCarreiras(u),
      secaoBonus(u, cfgBonus, faltam),
      secaoIndicacoes(u, cfgBonus),
      secaoConquistas(conq, nomes),
      secaoSessoes(u, sessoes),
      secaoVisitas(u.visitas || []),
      secaoEventos(u.eventos || []));

    LP.trocar(det.raiz, voltar(), perfil, numeros, subnav, grade);
  }

  function chipsCarreira(c) {
    const chips = [];
    if (c.noHall) chips.push(LP.chip('No Hall', 'ok'));
    if (c.publica) chips.push(LP.chip('Escolhida', 'ouro', { title: 'O jogador marcou esta para o Hall' }));
    if (c.oculta === 1) chips.push(LP.chip('Oculta (admin)', 'alerta'));
    if (c.oculta === 2) chips.push(LP.chip('Oculta (denúncias)', 'perigo'));
    if (c.suspeita) chips.push(LP.chip('Suspeita: ' + motivosSuspeita(c.suspeita), 'alerta', { title: 'Fica fora do Hall até você liberar (Mostrar)' }));
    if (c.notaV !== null && c.notaV !== undefined && c.notaV !== 2) chips.push(LP.chip('Nota antiga (v' + c.notaV + ')', '', { title: 'O jogo reenvia com a nota recalculada quando o dono abrir' }));
    if (c.notaV === null) chips.push(LP.chip('Nota antiga', '', { title: 'Gravada antes da versão 2 da Nota de Legado' }));
    return chips.length ? h('span', { class: 'chips' }, chips) : '—';
  }
  function motivosSuspeita(s) {
    return String(s || '').split(',').map((m) => LP.NOMES_SUSPEITA[m.trim()] || m.trim()).filter(Boolean).join(', ');
  }
  LP.motivosSuspeita = motivosSuspeita;

  function secaoCarreiras(u) {
    const cs = Array.isArray(u.carreiras) ? u.carreiras : [];
    const conteudo = cs.length ? LP.lista({
      itens: cs,
      aoClicar: (c) => LP.abrirCarreira(c.pk, { aoMudar: recarregarDetalhe }),
      rotuloLinha: (c) => 'Abrir a carreira ' + c.jogador,
      colunas: [
        { rotulo: 'Jogador', principal: true, celula: (c) => h('div', { class: 'celula-dupla' }, h('span', null, c.jogador || '—'),
          h('span', null, '#' + c.numero + ' · ' + c.pais + ' · ' + c.posicao + ' · ' + (LP.NOMES_MODO[c.modo] || c.modo))) },
        { rotulo: 'Nota', num: true, celula: (c) => LP.inteiro(c.nota) },
        { rotulo: 'Pico', num: true, celula: (c) => LP.inteiro(c.picoOvr) },
        { rotulo: 'Temp.', num: true, celula: (c) => LP.inteiro(c.temporadas) },
        { rotulo: 'Gols', num: true, celula: (c) => LP.inteiro(c.gols) },
        { rotulo: 'Títulos', num: true, celula: (c) => LP.inteiro(c.titulos) },
        { rotulo: 'B. Ouro', num: true, celula: (c) => LP.inteiro(c.bolasOuro) },
        { rotulo: 'Copas', num: true, celula: (c) => LP.inteiro(c.copas) },
        { rotulo: 'Bônus', num: true, celula: (c) => (c.bonusOvr ? '+' + c.bonusOvr : '—') },
        { rotulo: 'Hall', classe: 'situacao', celula: chipsCarreira },
        { rotulo: 'Salva', celula: (c) => h('span', { class: 'chips' }, h('span', { class: 'selo' + (c.como === 'auto' ? ' selo-auto' : '') }, c.como === 'auto' ? 'auto' : 'manual'), LP.quando(c.salvaEm)) },
        { rotulo: 'Ações', acoes: true, celula: (c) => LP.botoesCarreira({ id: c.pk, carreiraId: c.id, jogador: c.jogador, oculta: c.oculta, suspeita: c.suspeita, noHall: c.noHall }, recarregarDetalhe) },
      ],
    }) : LP.estadoVazio('Nenhuma carreira salva', 'Carreiras com pico 90+ sobem sozinhas; as outras, quando o jogador salva.');
    return secao('u-carreiras', 'Carreiras', cs.length ? LP.inteiro(cs.length) + ' salvas' : '', null, conteudo, true);
  }

  function refBonus(b) {
    const ref = String(b.ref || '');
    let m = /^indicacao:(\d+)$/.exec(ref);
    if (m) return 'Indicação #' + m[1];
    m = /^dia:(\d{4})-(\d{2})-(\d{2})$/.exec(ref);
    if (m) return 'Compartilhou em ' + m[3] + '/' + m[2];
    return ref || '—';
  }

  function secaoBonus(u, cfg, faltam) {
    const bs = Array.isArray(u.bonus) ? u.bonus : [];
    const estadoTxt = u.bonusLiberado ? 'liberados' : faltam !== null ? 'bloqueados: faltam ' + faltam + (faltam === 1 ? ' partida' : ' partidas') : 'bloqueados';
    const conteudo = bs.length ? LP.lista({
      itens: bs.slice().reverse(),
      colunas: [
        { rotulo: 'Valor', principal: true, celula: (b) => h('b', null, '+' + b.valor + ' de OVR') },
        { rotulo: 'Origem', celula: (b) => LP.NOMES_ORIGEM_BONUS[b.origem] || b.origem },
        { rotulo: 'Motivo / ref.', classe: 'quebra', celula: (b) => refBonus(b) },
        { rotulo: 'Criado', celula: (b) => LP.quando(b.criadoEm) },
        { rotulo: 'Situação', celula: (b) => (b.usadoEm
          ? h('span', { title: b.carreiraId ? 'Na carreira ' + b.carreiraId : '' }, 'Usado ' + LP.relativo(b.usadoEm))
          : b.disponivel ? LP.chip('Disponível', 'ok') : LP.chip('Guardado', 'alerta', { title: 'Fica disponível quando a conta liberar os bônus (partidas com a conta)' })) },
        { rotulo: 'Ações', acoes: true, celula: (b) => (b.usadoEm ? null : LP.botao('Tirar', () => tirarBonus(u, b), { tipo: 'perigo', pequeno: true, icone: 'menos' })) },
      ],
    }) : LP.estadoVazio('Nenhum bônus', 'Indicações válidas, o compartilhar do dia e os bônus que você der aparecem aqui.');
    return secao('u-bonus', 'Bônus de OVR', estadoTxt, LP.botao('Dar bônus', () => darBonus(u), { tipo: 'fantasma', pequeno: true, icone: 'presente' }), conteudo, true);
  }

  function secaoIndicacoes(u, cfg) {
    const ind = u.indicacoes || {};
    const feitas = Array.isArray(ind.feitas) ? ind.feitas : [];
    const rec = ind.recebida;
    const chipInd = (st) => LP.chip(LP.NOMES_STATUS_INDICACAO[st] || st, st === 'valida' ? 'ok' : st === 'recusada' ? 'perigo' : 'alerta');
    const recebida = rec
      ? h('p', { class: 'chips' }, 'Veio pelo convite de ', LP.linkUsuario(rec.indicador), chipInd(rec.status),
        rec.motivo ? h('span', { class: 'texto-3' }, LP.NOMES_MOTIVO_INDICACAO[rec.motivo] || rec.motivo) : null,
        h('span', { class: 'texto-3' }, LP.relativo(rec.criadaEm)))
      : h('p', { class: 'texto-3' }, 'Não veio pelo convite de ninguém.');
    const regras = cfg ? 'Bônus por amigo: ' + (cfg.indicacao || []).slice(0, Math.max(1, cfg.maxIndicacoes || 0)).map((v) => '+' + v).join(', ') + ' (até ' + cfg.maxIndicacoes + ')' : '';
    const tabela = feitas.length ? LP.lista({
      itens: feitas.slice().reverse(),
      colunas: [
        { rotulo: 'Amigo', principal: true, celula: (i) => LP.linkUsuario(i.indicado) },
        { rotulo: 'Status', celula: (i) => chipInd(i.status) },
        { rotulo: 'Motivo', celula: (i) => (i.motivo ? LP.NOMES_MOTIVO_INDICACAO[i.motivo] || i.motivo : '—') },
        { rotulo: 'Criada', celula: (i) => LP.quando(i.criadaEm) },
        { rotulo: 'Validada', celula: (i) => (i.validadaEm ? LP.quando(i.validadaEm) : '—') },
        { rotulo: 'Ações', acoes: true, celula: (i) => (i.status === 'recusada' ? null : LP.botao('Recusar', () => LP.recusarIndicacao(i, recarregarDetalhe), { tipo: 'perigo', pequeno: true })) },
      ],
    }) : h('p', { class: 'texto-3' }, 'Ainda não indicou ninguém.');
    return secao('u-indicacoes', 'Indicações', feitas.length ? LP.inteiro(feitas.filter((i) => i.status === 'valida').length) + ' válidas de ' + feitas.length : '', null,
      [h('h3', null, 'Recebida'), recebida, h('h3', null, 'Feitas'), regras ? h('p', { class: 'texto-3' }, regras) : null, tabela], true);
  }

  function secaoConquistas(conq, nomes) {
    const lista = conq.slice().sort((a, b) => String(a.em).localeCompare(String(b.em)));
    const conteudo = lista.length
      ? h('div', { class: 'lista-conquistas' }, lista.map((c) => {
        const n = nomes.conquistas[c.id];
        const tipo = n && n.r === 'lendaria' ? 'ouro' : n && n.r === 'epica' ? 'info' : '';
        return LP.chip(n ? n.t : c.id, tipo, { semPonto: true, title: (n ? n.d + ' · ' : '') + c.id + ' · ' + LP.dataHoraAno(c.em) });
      }))
      : h('p', { class: 'texto-3' }, 'Nenhuma conquista sincronizada com a conta ainda.');
    return secao('u-conquistas', 'Conquistas', lista.length ? LP.inteiro(lista.length) : '', null, conteudo);
  }

  function secaoSessoes(u, sessoes) {
    const conteudo = sessoes.length ? LP.lista({
      itens: sessoes,
      colunas: [
        { rotulo: 'Entrou', principal: true, celula: (s) => LP.dataHoraAno(s.criadaEm) },
        { rotulo: 'Renovada', celula: (s) => (s.renovadaEm ? LP.quando(s.renovadaEm) : '—') },
        { rotulo: 'Expira', celula: (s) => LP.dataHoraAno(s.expiraEm) },
      ],
    }) : h('p', { class: 'texto-3' }, 'Nenhuma sessão de login ativa (não está logado em nenhum aparelho).');
    return secao('u-sessoes', 'Sessões ativas', sessoes.length ? LP.inteiro(sessoes.length) : '',
      sessoes.length ? LP.botao('Deslogar de todos', () => deslogar(u, sessoes.length), { tipo: 'fantasma', pequeno: true, icone: 'sair' }) : null, conteudo);
  }

  function secaoVisitas(vs) {
    const conteudo = vs.length ? LP.lista({
      itens: vs,
      colunas: [
        { rotulo: 'Início', principal: true, celula: (v) => LP.dataHoraAno(v.inicio) },
        { rotulo: 'Tempo', num: true, celula: (v) => LP.duracao(v.tempoS) },
        { rotulo: 'Origem', celula: (v) => LP.origemCurta(v.origem) },
        { rotulo: 'Aparelho', celula: (v) => h('span', { class: 'chips' }, LP.aparelho(v.aparelho), v.bot ? LP.chip('robô/teste', 'alerta') : null) },
      ],
    }) : h('p', { class: 'texto-3' }, 'Nenhuma visita ligada à conta.');
    return secao('u-visitas', 'Últimas visitas', vs.length ? 'as ' + vs.length + ' mais recentes' : '', null, conteudo);
  }

  function dadosEvento(e) {
    const d = e.dados || {};
    const partes = [];
    if (d.rota) partes.push('tela ' + d.rota);
    if (d.ritmo) partes.push('ritmo ' + d.ritmo);
    if (d.nota !== undefined) partes.push('nota ' + d.nota);
    if (d.pico !== undefined) partes.push('pico ' + d.pico);
    if (d.temporadas !== undefined) partes.push(d.temporadas + ' temporadas');
    if (d.resultado) partes.push(String(d.resultado));
    if (d.placar) partes.push(String(d.placar));
    if (d.gols !== undefined) partes.push(d.gols + ' gols');
    if (d.partidas !== undefined) partes.push(d.partidas + ' partidas');
    if (d.acao) partes.push(String(d.acao));
    return partes.join(' · ');
  }

  function secaoEventos(es) {
    const conteudo = es.length ? LP.lista({
      itens: es,
      colunas: [
        { rotulo: 'Quando', principal: true, celula: (e) => LP.dataHoraAno(e.em) },
        { rotulo: 'Evento', celula: (e) => LP.NOMES_EVENTO[e.tipo] || e.tipo },
        { rotulo: 'Modo', celula: (e) => (e.modo ? LP.NOMES_MODO[e.modo] || e.modo : '—') },
        { rotulo: 'Detalhes', classe: 'quebra', celula: dadosEvento },
      ],
    }) : h('p', { class: 'texto-3' }, 'Nenhum evento ligado à conta.');
    return secao('u-eventos', 'Últimos eventos', es.length ? 'os ' + es.length + ' mais recentes' : '', null, conteudo);
  }

  // ── ações ──────────────────────────────────────────────────────────────────────────────────
  async function suspender(u) {
    const r = await LP.dialogo({
      titulo: 'Suspender ' + u.apelido + '?',
      perigo: true,
      botao: 'Suspender conta',
      texto: 'A pessoa sai de todos os aparelhos, não consegue entrar e as carreiras dela saem do Hall público na hora.',
      campos: [
        { nome: 'motivo', rotulo: 'Motivo (a pessoa vê ao tentar entrar)', tipo: 'textarea', maxlength: 200, linhas: 2, placeholder: 'Ex.: apelido ofensivo, trapaça no Hall…' },
        { nome: 'dias', rotulo: 'Por quantos dias', tipo: 'numero', min: 1, max: 3650, placeholder: 'vazio = até você reativar',
          atalhos: [{ rotulo: '1 dia', valor: 1 }, { rotulo: '7 dias', valor: 7 }, { rotulo: '30 dias', valor: 30 }, { rotulo: 'Sem prazo', valor: null }],
          ajuda: 'Sem número: fica suspensa até você reativar.' },
      ],
      executar: (v) => LP.adminPost({ acao: 'suspender', id: u.id, motivo: v.motivo || null, dias: v.dias }),
    });
    if (!r) return;
    LP.avisar(u.apelido + ' suspenso' + (r.suspensoAte ? ' até ' + LP.dataHoraAno(r.suspensoAte) : ' até reativar') + ' · ' + plural(r.sessoesEncerradas || 0, 'sessão encerrada', 'sessões encerradas') + '.');
    recarregarDetalhe();
  }
  async function reativar(u) {
    const r = await LP.dialogo({
      titulo: 'Reativar ' + u.apelido + '?',
      botao: 'Reativar conta',
      tipoBotao: 'ok',
      texto: 'A pessoa volta a entrar normalmente. As carreiras voltam ao Hall público na próxima fotografia (ou em "Atualizar Hall agora").',
      executar: () => LP.adminPost({ acao: 'reativar', id: u.id }),
    });
    if (!r) return;
    LP.avisar(u.apelido + ' reativado.');
    recarregarDetalhe();
  }
  async function deslogar(u, n) {
    const r = await LP.dialogo({
      titulo: 'Deslogar ' + u.apelido + ' de todos os aparelhos?',
      botao: 'Deslogar',
      texto: (n ? 'Encerra ' + plural(n, 'sessão de login ativa', 'sessões de login ativas') + '. ' : 'Não há sessão ativa agora. ') + 'A conta continua ativa: a pessoa pode entrar de novo com a senha.',
      executar: () => LP.adminPost({ acao: 'deslogar', id: u.id }),
    });
    if (!r) return;
    LP.avisar(plural(r.sessoesEncerradas || 0, 'sessão encerrada', 'sessões encerradas') + '.');
    recarregarDetalhe();
  }
  async function renomear(u) {
    const r = await LP.dialogo({
      titulo: 'Renomear ' + u.apelido,
      botao: 'Trocar apelido',
      texto: 'Para moderação (apelido ofensivo, enganoso…). O Hall público já mostra o novo na hora.',
      campos: [{ nome: 'apelido', rotulo: 'Novo apelido', valor: u.apelido, maxlength: 20, obrigatorio: true,
        ajuda: '2 a 20 caracteres: letras, números, espaço e _ . -',
        validar: (v) => (APELIDO_RE.test(v) ? (v === u.apelido ? 'É o mesmo apelido de agora.' : null) : 'Use de 2 a 20 caracteres: letras, números, espaço e _ . -') }],
      executar: (v) => LP.adminPost({ acao: 'renomear', id: u.id, apelido: v.apelido }),
    });
    if (!r) return;
    LP.avisar('Apelido trocado para ' + (r.apelido || '') + '.');
    recarregarDetalhe();
  }
  async function darBonus(u) {
    const r = await LP.dialogo({
      titulo: 'Dar bônus de OVR para ' + u.apelido,
      botao: 'Dar bônus',
      texto: 'O bônus do admin vale na hora (não espera as partidas de liberação) e é usado na próxima carreira do Clássico.',
      campos: [
        { nome: 'valor', rotulo: 'Valor', tipo: 'opcoes', valor: 2, opcoes: [1, 2, 3, 4, 5].map((n) => ({ valor: n, rotulo: '+' + n })) },
        { nome: 'motivo', rotulo: 'Motivo (fica guardado no bônus e no Registro)', maxlength: 100, obrigatorio: true, placeholder: 'Ex.: compensação por erro, sorteio da live…' },
      ],
      executar: (v) => LP.adminPost({ acao: 'dar_bonus', id: u.id, valor: v.valor, motivo: v.motivo }),
    });
    if (!r) return;
    LP.avisar('Bônus dado para ' + u.apelido + '.');
    recarregarDetalhe();
  }
  async function tirarBonus(u, b) {
    const r = await LP.dialogo({
      titulo: 'Tirar o bônus de +' + b.valor + '?',
      perigo: true,
      botao: 'Tirar bônus',
      texto: [b.origem === 'indicacao' ? 'É bônus de indicação: a indicação ligada a ele vira recusada (não conta de novo).' : 'O bônus some da conta de ' + u.apelido + '.',
        'Bônus já usado numa carreira não dá para tirar.'],
      executar: () => LP.adminPost({ acao: 'tirar_bonus', bonusId: b.id }),
    });
    if (!r) return;
    LP.avisar('Bônus tirado.');
    recarregarDetalhe();
  }
  async function excluir(u) {
    const r = await LP.dialogo({
      titulo: 'Excluir a conta de ' + u.apelido + '?',
      perigo: true,
      botao: 'Excluir para sempre',
      texto: ['Apaga a conta, as carreiras salvas, as conquistas, os bônus, as indicações feitas, as denúncias feitas e o lugar no Hall (LGPD). As visitas ficam anônimas.',
        'Não dá para desfazer.'],
      digitar: u.apelido,
      executar: () => LP.adminPost({ acao: 'excluir_usuario', id: u.id }),
    });
    if (!r) return;
    LP.avisar('Conta excluída.');
    LP.atualizarResumo();
    location.hash = LP.ultimaListaUsuarios || '#/usuarios';
  }
  /** Recusar uma indicação (usado aqui e na aba Indicações). */
  LP.recusarIndicacao = async function (i, depois) {
    const r = await LP.dialogo({
      titulo: 'Recusar esta indicação?',
      perigo: true,
      botao: 'Recusar',
      texto: 'Ela deixa de contar para o indicador e o bônus dela é tirado (se ainda não foi usado).',
      executar: () => LP.adminPost({ acao: 'recusar_indicacao', id: i.id }),
    });
    if (!r) return;
    LP.avisar(r.bonusTirado ? 'Indicação recusada e bônus tirado.' : 'Indicação recusada.');
    if (depois) depois();
  };

  function plural(n, um, varios) { return LP.inteiro(n) + ' ' + (n === 1 ? um : varios); }
  LP.plural = plural;

  LP.abas.usuario = {
    titulo: 'Usuário',
    sub: '',
    menu: 'usuarios',
    montar: montarDetalhe,
    recarregar: () => carregarDetalhe(),
  };
})();
