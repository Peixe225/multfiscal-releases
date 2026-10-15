/* LENDA · painel — Usuários: lista com busca ao vivo, filtros com contagem, ordem pelos cabeçalhos, páginas e CSV
 * (admin.php?r=usuarios); e a ficha de cada conta no painel lateral (?r=usuario, aberta pelo hash conta=<id> em
 * qualquer aba), com as ações de moderação (suspender, reativar, deslogar, renomear, tipo de conta, anotação interna,
 * tirar do Hall, código de troca de senha, bônus, excluir). */
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
  const TIPOS = ['jogador', 'tester', 'criador', 'oficial', 'teste'];
  const APELIDO_RE = /^[\p{L}\p{N}_.\- ]{2,20}$/u;
  const MOTIVOS_SUSPENDER = [
    { rotulo: 'Apelido ofensivo', aviso: 'nome' }, { rotulo: 'Trapaça no Hall', aviso: 'trapaca' },
    { rotulo: 'Várias contas / spam', aviso: 'repetida' }, { rotulo: 'Pedido do jogador', aviso: 'pedido' }, { rotulo: 'Outro', aviso: 'outro', vazio: true },
  ];
  // os filtros que a API aceita (P1-12): um valor por dimensão
  const FILTROS = ['status', 'tipo', 'hall', 'convite', 'denunciado', 'sumido', 'nota', 'sem'];

  // ═══ lista ═════════════════════════════════════════════════════════════════════════════════
  const lista = { q: '', f: {}, ordem: 'recentes', pagina: 1, corpo: null, filtros: null, busca: null, selOrdem: null, temDados: false, contagens: null, ultima: null };

  function montarLista(raiz, rota) {
    const q = rota.query;
    lista.q = (q.q || '').slice(0, 100);
    lista.f = {};
    FILTROS.forEach((k) => { if (q[k]) lista.f[k] = String(q[k]).slice(0, 12); });
    lista.ordem = ORDENS.some((o) => o.valor === q.ordem) ? q.ordem : 'recentes';
    lista.pagina = Math.max(1, parseInt(q.pagina, 10) || 1);
    lista.temDados = false;
    lista.corpo = h('div');
    lista.filtros = h('div', { class: 'filtros-chips', role: 'group', 'aria-label': 'Filtros' });
    lista.busca = LP.busca('Buscar por apelido, e-mail, #id ou código de convite', lista.q, (v) => { lista.q = v; lista.pagina = 1; carregar(); });
    const ordem = LP.selecao('Ordem', ORDENS, lista.ordem, (v) => { lista.ordem = v; lista.pagina = 1; carregar(); });
    lista.selOrdem = ordem.querySelector('select');
    LP.trocar(raiz,
      LP.ajuda('A lista conta todas as contas (inclusive as de teste). Clique numa linha para abrir a ficha ao lado; os filtros se somam.'),
      h('div', { class: 'ferramentas' }, lista.busca, ordem),
      lista.filtros, lista.corpo);
    desenharFiltros();
    if (LP.pode('exportar')) {
      LP.acoesAba(LP.botao('Exportar CSV', async (ev, b) => {
        try {
          await LP.baixarDoServidor(LP.urlAdmin('exportar', { tipo: 'usuarios' }));
          LP.avisar('A planilha (CSV) está baixando. A exportação fica anotada no Registro.', 'info');
        } catch (e) { LP.avisarErro(e); }
      }, { icone: 'baixar', tipo: 'fantasma', gerundio: 'Preparando…', title: 'Baixa todas as contas numa planilha (fica no Registro)' }));
    }
    carregar();
  }

  // Os chips são feitos uma vez e atualizados no lugar (o clique e cada carregamento só mudam o aria-pressed e os
  // contadores): o foco do teclado fica no chip apertado.
  function chipFiltro(rotulo, chave, valor, n, titulo) {
    const b = h('button', { type: 'button', class: 'chip-filtro', 'aria-pressed': String(lista.f[chave] === valor), title: titulo, dataset: { valor: chave + '=' + valor } }, rotulo);
    b.contar = (x) => {
      let c = b.querySelector('.contador');
      if (x === undefined || x === null) { if (c) c.remove(); return; }
      if (!c) { c = h('span', { class: 'contador' }); b.appendChild(c); }
      c.textContent = LP.inteiro(x);
    };
    b.contar(n);
    b.marcar = () => b.setAttribute('aria-pressed', String(lista.f[chave] === valor));
    b.addEventListener('click', () => {
      if (lista.f[chave] === valor) delete lista.f[chave]; else lista.f[chave] = valor;
      lista.pagina = 1;
      desenharFiltros();
      carregar();
    });
    return b;
  }
  function desenharFiltros() {
    const c = lista.contagens || {};
    const st = c.status || {};
    const tp = c.tipo || {};
    const hl = c.hall || {};
    const sem = c.sem || {};
    const algum = Object.keys(lista.f).length > 0;
    const ja = lista.filtros.querySelectorAll('.chip-filtro');
    if (ja.length) {
      const n = {
        'status=ativo': st.ativo, 'status=suspenso': st.suspenso, 'hall=bloqueado': hl.bloqueado, 'hall=nao': hl.nao, 'denunciado=1': c.denunciado,
        'convite=1': c.convite, 'sumido=30': c.sumido, 'nota=1': c.nota, 'sem=time': sem.time, 'sem=uf': sem.uf,
      };
      TIPOS.forEach((t) => { n['tipo=' + t] = tp[t]; });
      ja.forEach((b) => {
        if (!b.marcar) { b.setAttribute('aria-pressed', String(!algum)); return; } // "Todos"
        b.marcar();
        b.contar(n[b.dataset.valor]);
      });
      return;
    }
    const todos = h('button', { type: 'button', class: 'chip-filtro', 'aria-pressed': String(!algum), dataset: { valor: 'todos' } }, 'Todos');
    todos.addEventListener('click', () => { lista.f = {}; lista.pagina = 1; desenharFiltros(); carregar(); });
    LP.trocar(lista.filtros, todos,
      chipFiltro('Ativos', 'status', 'ativo', st.ativo),
      chipFiltro('Suspensos', 'status', 'suspenso', st.suspenso),
      TIPOS.filter((t) => t !== 'jogador').map((t) => chipFiltro(LP.NOMES_TIPO_CONTA[t] + 's', 'tipo', t, tp[t], LP.AJUDA_TIPO_CONTA[t])),
      chipFiltro('Fora do Hall', 'hall', 'bloqueado', hl.bloqueado, 'Tiradas do Hall público pela moderação'),
      chipFiltro('Não aparecem no Hall', 'hall', 'nao', hl.nao, 'O próprio jogador escolheu não aparecer'),
      chipFiltro('Com denúncia aberta', 'denunciado', '1', c.denunciado),
      chipFiltro('Veio por convite', 'convite', '1', c.convite),
      chipFiltro('Sumidos há 30 dias', 'sumido', '30', c.sumido),
      chipFiltro('Com anotação', 'nota', '1', c.nota),
      chipFiltro('Sem time', 'sem', 'time', sem.time),
      chipFiltro('Sem UF', 'sem', 'uf', sem.uf));
  }

  function queryLista() {
    return Object.assign({ q: lista.q, ordem: lista.ordem === 'recentes' ? '' : lista.ordem, pagina: lista.pagina > 1 ? lista.pagina : '' }, lista.f);
  }

  async function carregar() {
    if (!LP.visivel(lista.corpo)) return;
    LP.trocarQuery('usuarios', queryLista());
    // a ordem pelo cabeçalho da coluna e pelo seletor são a mesma: os dois mostram a de agora
    if (lista.selOrdem && lista.selOrdem.value !== lista.ordem) lista.selOrdem.value = lista.ordem;
    if (!lista.temDados) LP.trocar(lista.corpo, LP.estadoCarregando(6));
    else lista.corpo.classList.add('esmaecido');
    if (lista.q) lista.busca.estado('buscando…');
    try {
      const d = await LP.adminGet('usuarios', Object.assign({ q: lista.q, ordem: lista.ordem, pagina: lista.pagina }, lista.f), { sinal: LP.unico('usuarios') });
      if (!LP.visivel(lista.corpo)) return;
      lista.temDados = true;
      lista.contagens = d.contagens || lista.contagens;
      desenharFiltros();
      desenharLista(d);
      lista.corpo.classList.remove('esmaecido');
    } catch (e) {
      if (LP.cancelado(e)) return;
      lista.corpo.classList.remove('esmaecido');
      if ((e && e.status === 401) || !LP.visivel(lista.corpo)) return;
      lista.temDados = false;
      lista.busca.estado('');
      LP.trocar(lista.corpo, LP.estadoErro(e, carregar));
    }
  }

  function celulaUsuario(u) {
    return h('div', { class: 'celula-dupla' },
      h('span', null, u.apelido, u.temNota ? h('span', { class: 'icone-nota', title: 'Tem anotação interna' }, LP.icone('nota')) : null, LP.chipTipo(u.tipo)),
      h('span', { class: 'linha-email' }, LP.email(u.email), h('span', { class: 'sem-quebra' }, ' · #' + u.id)));
  }

  function desenharLista(d) {
    const itens = Array.isArray(d.itens) ? d.itens : [];
    const total = d.total || 0;
    const filtrado = lista.q || Object.keys(lista.f).length;
    lista.busca.estado(lista.q ? LP.plural(total, 'encontrada', 'encontradas') : '');
    LP.subAba(LP.plural(total, 'conta', 'contas') + (filtrado ? ' com esse filtro' : ''));
    if (!itens.length) {
      LP.trocar(lista.corpo, LP.estadoVazio(filtrado ? 'Ninguém com estes filtros' : 'Nenhuma conta ainda',
        filtrado ? 'Confira a busca: apelido, e-mail, #id ou código de convite.' : 'As contas aparecem aqui assim que os jogadores se cadastrarem.',
        filtrado ? LP.botao('Limpar filtros', () => { location.hash = '#/usuarios'; }, { tipo: 'fantasma' }) : null));
      return;
    }
    const ordem = { chave: lista.ordem, dir: 'desc' };
    const tabela = LP.lista({
      itens: itens,
      aoClicar: (u) => LP.abrirConta(u.id),
      rotuloLinha: (u) => 'Abrir ' + u.apelido,
      ordem: ordem,
      aoOrdenar: (k) => { lista.ordem = k; lista.pagina = 1; carregar(); },
      colunas: [
        { rotulo: 'Usuário', principal: true, classe: 'celula-larga', celula: celulaUsuario },
        { rotulo: 'Situação', classe: 'situacao', celula: (u) => h('span', { class: 'chips' }, LP.chipStatus(u.status), u.hallBloqueado ? LP.chip('fora do Hall', 'tracejado', { semPonto: true }) : null) },
        { rotulo: 'Criada', ordenar: 'recentes', celula: (u) => LP.quando(u.criadoEm) },
        { rotulo: 'Último acesso', ordenar: 'acesso', celula: (u) => LP.quando(u.ultimoAcesso) },
        { rotulo: 'Partidas', num: true, ordenar: 'partidas', celula: (u) => LP.inteiro(u.partidas) },
        { rotulo: 'Carreiras', num: true, celula: (u) => LP.inteiro(u.carreiras) },
        { rotulo: 'Melhor nota', num: true, ordenar: 'nota', celula: (u) => (u.melhorNota === null || u.melhorNota === undefined ? '—' : LP.inteiro(u.melhorNota)) },
        { rotulo: 'Tempo', num: true, ordenar: 'tempo', celula: (u) => LP.minutos(u.tempoJogadoMin) },
        { rotulo: 'Origem', celula: (u) => LP.origemCurta(u.origem) },
        { rotulo: 'Indicações', num: true, celula: (u) => LP.inteiro(u.indicacoes) },
        { rotulo: 'Bônus', num: true, celula: (u) => (u.bonusDisponiveis ? LP.chip('+' + u.bonusDisponiveis, 'ouro', { semPonto: true, title: 'Bônus que dá para usar agora' }) : '—') },
        { rotulo: 'Ações', acoes: true, celula: (u) => (LP.pode('usuarios') ? LP.botao('Anotar', (ev, b) => { anotarDialogo(u, b); }, { tipo: 'fantasma', pequeno: true, icone: 'nota', compacto: true, title: u.temNota ? 'Ver ou mudar a anotação interna' : 'Escrever uma anotação interna' }) : null) },
      ],
    });
    LP.trocar(lista.corpo, tabela, LP.paginacao(total, d.pagina || lista.pagina, d.porPagina || 50, (p) => { lista.pagina = p; carregar(); window.scrollTo(0, 0); }));
  }

  /**
   * "Anotar" na lista: o mesmo cartão da ficha, num diálogo (Esc fecha, o foco volta para o botão). O botão fica
   * travado ("Abrindo…") só enquanto a anotação atual é lida: o segundo clique não abre outro diálogo por cima.
   */
  async function anotarDialogo(u, botao) {
    if (botao && botao.getAttribute('aria-busy') === 'true') return;
    let atual = null;
    LP.ocupado(botao, true, 'Abrindo…');
    try {
      const d = await LP.adminGet('usuario', { id: u.id });
      atual = d.usuario && d.usuario.notaAdmin;
    } catch (e) { LP.avisarErro(e); return; } finally { if (botao) LP.ocupado(botao, false); }
    if (LP.dialogoAberto()) return;
    const r = await LP.dialogo({
      titulo: 'Anotação interna · ' + u.apelido,
      texto: 'Só a equipe vê. Até 500 caracteres e 10 linhas; deixe vazio para apagar. Não escreva senha nem documento.',
      botao: 'Salvar',
      gerundio: 'Salvando…',
      campos: [{ nome: 'texto', tipo: 'textarea', linhas: 5, maxlength: 500, valor: atual ? atual.texto : '', ajudaContador: 'deixe vazio para apagar',
        ajuda: atual ? 'Escrita por ' + (atual.porNome || atual.por || '—') + ' em ' + LP.dataHoraAno(atual.em) : '' }],
      executar: (v) => LP.adminPost({ acao: 'nota', id: u.id, texto: v.texto }),
    });
    if (!r) return;
    LP.avisar(r.nota ? 'Anotação salva na conta de ' + u.apelido + '.' : 'Anotação apagada.');
    carregar();
  }

  LP.abas.usuarios = {
    titulo: 'Usuários',
    sub: '',
    montar: montarLista,
    recarregar: () => carregar(),
  };
  LP.recarregarListaUsuarios = () => { if (LP.visivel(lista.corpo)) carregar(); };

  // ═══ ficha da conta (painel lateral) ═══════════════════════════════════════════════════════
  const det = { id: 0, corpo: null, u: null, pedido: 0 };

  LP.abrirFichaConta = function (id) {
    det.id = parseInt(id, 10) || 0;
    det.u = null;
    det.corpo = LP.gaveta.abrir('conta', id, 'Conta #' + id);
    if (!det.corpo) return;
    LP.trocar(det.corpo, LP.estadoCarregando(8));
    carregarFicha();
  };

  /**
   * O ?r=usuario da v3.2 devolve o `tipo`. Só um servidor anterior (sem o campo) cai aqui: o painel lê o tipo do item
   * da lista (?r=usuarios&q=<e-mail>, que já tem `tipo`).
   */
  async function tipoDaLista(u) {
    try {
      const l = await LP.adminGet('usuarios', { q: u.email, porPagina: 5 });
      const item = (l.itens || []).find((x) => x.id === u.id);
      if (item && item.tipo) return item.tipo;
    } catch (e) { /* sem a lista, fica o que o `tester` diz */ }
    return u.tester ? 'tester' : 'jogador';
  }

  async function carregarFicha() {
    const n = ++det.pedido;
    const corpo = det.corpo;
    if (!det.id) {
      LP.trocar(corpo, LP.estadoVazio('Conta não encontrada', 'O endereço não tem um id válido.'));
      return;
    }
    if (det.u) corpo.classList.add('esmaecido');
    try {
      const [d, nomes] = await Promise.all([LP.adminGet('usuario', { id: det.id }), LP.nomes()]);
      if (n !== det.pedido || !corpo.isConnected) return;
      if (!d.usuario) throw new LP.ErroApi(500, 'formato', 'Resposta sem o usuário.');
      if (d.usuario.tipo == null) d.usuario.tipo = await tipoDaLista(d.usuario);
      if (n !== det.pedido || !corpo.isConnected) return;
      const rolagem = corpo.scrollTop;
      det.u = d.usuario;
      desenharFicha(det.u, nomes);
      corpo.scrollTop = rolagem;
    } catch (e) {
      if (n !== det.pedido || (e && e.status === 401) || !corpo.isConnected) return;
      if (e && e.status === 404) {
        LP.gaveta.titulo('Conta');
        LP.trocar(corpo, LP.estadoVazio('Conta não encontrada', 'Ela pode ter sido excluída.'));
      } else {
        LP.trocar(corpo, LP.estadoErro(e, carregarFicha));
      }
    } finally {
      if (n === det.pedido) corpo.classList.remove('esmaecido');
    }
  }
  /** Depois de uma ação na ficha: ela, a lista de baixo, os números e os alertas. */
  function depois() {
    carregarFicha();
    LP.depoisDeAgir();
    LP.recarregarListaUsuarios();
    const m = LP.abas[LP.rota().aba];
    if (m && m.aoMudarFora) m.aoMudarFora();
  }
  LP.recarregarFicha = () => { if (det.corpo && det.corpo.isConnected) carregarFicha(); };

  function cartao(id, titulo, extra, botoes, conteudo) {
    return h('section', { class: 'cartao ancora', id: id, 'aria-labelledby': id + '-t' },
      h('div', { class: 'cartao-cabeca' }, h('h2', { id: id + '-t' }, titulo, extra ? h('span', { class: 'texto-3' }, extra) : null),
        botoes ? h('div', { class: 'botoes' }, botoes) : null),
      h('div', null, conteudo));
  }
  function secundario(titulo, extra, conteudo, aberto) {
    return h('details', { class: 'cartao cartao-secundario', open: !!aberto },
      h('summary', null, h('span', null, titulo, extra ? h('span', { class: 'texto-3' }, ' · ' + extra) : null)), conteudo);
  }

  function desenharFicha(u, nomes) {
    const s = u.estatisticas || {};
    const suspenso = u.status === 'suspenso';
    LP.gaveta.titulo(u.apelido + ' · #' + u.id);
    const cfgBonus = (LP.resumo && LP.resumo.site && LP.resumo.site.bonus) || null;
    const faltam = cfgBonus ? Math.max(0, (cfgBonus.liberaAposPartidas || 0) - (u.partidasConta || 0)) : null;
    const sessoes = Array.isArray(u.sessoes) ? u.sessoes : [];
    const mesmo = Array.isArray(u.mesmoAparelho) ? u.mesmoAparelho : [];
    const den = u.denuncias || {};

    // ── perfil ──
    const codigo = u.codigoConvite ? h('span', { class: 'chips' }, h('span', { class: 'mono' }, u.codigoConvite),
      LP.botao('', (ev, b) => LP.copiar(location.origin + location.pathname.replace(/painel\/.*$/, '') + '?c=' + u.codigoConvite, b), { tipo: 'fantasma', pequeno: true, icone: 'copiar', rotulo: 'Copiar o link de convite', title: 'Copiar o link de convite' })) : '—';
    const perfil = h('section', { class: 'cartao perfil' },
      h('div', { class: 'perfil-nome' }, h('h2', null, u.apelido), LP.chipStatus(u.status, u.suspensoAte), LP.chipTipo(u.tipo),
        u.hallBloqueado ? LP.chip('Fora do Hall (moderação)', 'tracejado', { semPonto: true }) : LP.chip('Hall: ' + (LP.NOMES_HALL_PUBLICO[u.hallPublico] || u.hallPublico || '—'), 'info', { semPonto: true, title: 'Como as carreiras desta conta entram no Hall público (escolha do jogador)' })),
      h('dl', { class: 'perfil-dados' },
        LP.dado('E-mail', LP.email(u.email), { largo: true }),
        LP.dado('ID', '#' + u.id),
        LP.dado('Criada em', LP.dataHoraAno(u.criadoEm)),
        LP.dado('Último acesso', s.ultimoAcesso ? LP.quando(s.ultimoAcesso) : '—'),
        LP.dado('Primeiro acesso', s.primeiroAcesso ? LP.dataHoraAno(s.primeiroAcesso) : '—'),
        LP.dado('Origem', LP.origem(u.origem)),
        LP.dado('Time do coração', u.timeCoracao),
        LP.dado('Estado', u.uf === 'EX' ? 'Fora do Brasil' : u.uf),
        LP.dado('Aparelhos', (s.aparelhos || []).map(LP.aparelho).join(', ')),
        LP.dado('Código de convite', codigo)),
      suspenso ? h('p', { class: 'faixa faixa-perigo' }, 'Conta suspensa ' + (u.suspensoAte ? 'até ' + LP.dataHoraAno(u.suspensoAte) : 'até alguém reativar') +
        (u.motivo ? '. Motivo: ' + u.motivo : '') + '. Não entra e as carreiras estão fora do Hall público.') : null,
      u.avisoPendente ? h('p', { class: 'faixa faixa-info' }, 'Aviso ainda não lido pelo jogador (Minha conta): "' + u.avisoPendente.texto + '" · ' + LP.relativo(u.avisoPendente.em)) : null,
      mesmo.length ? h('p', { class: 'faixa faixa-alerta' }, 'Mesmo aparelho que: ', mesmo.map((x, i) => [i ? ', ' : '', LP.linkUsuario(x)]),
        ' · ', h('a', { href: '#/indicacoes?status=aparelho' }, 'ver grupos')) : null);

    // ── ações ──
    const acoes = [];
    if (LP.pode('usuarios')) {
      acoes.push(suspenso ? LP.botao('Reativar', () => reativar(u), { tipo: 'ok', icone: 'reativar' }) : LP.botao('Suspender', () => suspender(u), { tipo: 'perigo', icone: 'bloquear' }));
      acoes.push(LP.botao('Deslogar' + (sessoes.length ? ' (' + sessoes.length + ')' : ''), () => deslogar(u, sessoes.length), { tipo: 'fantasma', icone: 'sair', title: 'Encerra as sessões de login em todos os aparelhos' }));
      acoes.push(LP.botao('Mandar código de troca de senha', (ev, b) => mandarCodigo(u, b), { tipo: 'fantasma', icone: 'envelope', gerundio: 'Mandando…', title: 'Manda o código de 6 dígitos (vale 30 min) para o e-mail da conta. Ninguém vê o código.' }));
    }
    if (LP.pode('moderar')) {
      acoes.push(LP.botao('Renomear', () => renomear(u), { tipo: 'fantasma', icone: 'lapis' }));
      acoes.push(u.hallBloqueado ? LP.botao('Devolver ao Hall', () => bloquearHall(u, false), { tipo: 'ok', icone: 'olho' }) : LP.botao('Tirar do Hall público', () => bloquearHall(u, true), { tipo: 'fantasma', icone: 'ocultar', title: 'A conta continua jogando; só não aparece no Hall' }));
    }
    if (LP.pode('bonus')) acoes.push(LP.botao('Dar bônus', () => darBonus(u), { tipo: 'fantasma', icone: 'presente' }));
    acoes.push(h('a', { href: LP.hash('registro', { alvo: 'usuario:' + u.id }), class: 'botao-fantasma', title: 'Tudo o que a equipe fez nesta conta' }, LP.icone('arquivo'), h('span', null, 'Ver no Registro')));
    if (LP.pode('excluir')) acoes.push(LP.botao('Excluir conta', () => excluir(u), { tipo: 'perigo', icone: 'lixo' }));
    const cAcoes = h('section', { class: 'cartao' }, h('div', { class: 'perfil-acoes' }, acoes));

    // ── tipo de conta (P1-6) ──
    const sel = h('select', { 'aria-label': 'Tipo de conta', disabled: !LP.pode('usuarios') });
    TIPOS.forEach((t) => sel.appendChild(h('option', { value: t, selected: (u.tipo || 'jogador') === t }, LP.NOMES_TIPO_CONTA[t])));
    const ajudaTipo = h('p', { class: 'ajuda' }, LP.AJUDA_TIPO_CONTA[u.tipo || 'jogador'] + (u.tipoEm ? ' Desde ' + LP.dataHoraAno(u.tipoEm) + '.' : ''));
    let tipoAtual = u.tipo || 'jogador';
    sel.addEventListener('change', async () => {
      const novo = sel.value;
      const antes = tipoAtual;
      const extra = novo === 'tester' ? ' Ela passa a abrir o Imersivo e a Live.' : antes === 'tester' ? ' Ela deixa de abrir o Imersivo e a Live.' : '';
      if (!LP.confirmar('Mudar @' + u.apelido + ' para ' + LP.NOMES_TIPO_CONTA[novo].toLowerCase() + '?' + extra)) { sel.value = antes; return; }
      sel.disabled = true;
      try {
        await LP.adminPost({ acao: 'mudar_tipo', id: u.id, tipo: novo });
        tipoAtual = novo;
        sel.disabled = false;
        ajudaTipo.textContent = LP.AJUDA_TIPO_CONTA[novo];
        LP.avisar('@' + u.apelido + ' agora é ' + LP.NOMES_TIPO_CONTA[novo].toLowerCase() + '.');
        depois();
      } catch (e) { sel.value = antes; sel.disabled = false; LP.avisarErro(e); }
    });
    const cTipo = cartao('u-tipo', 'Tipo de conta', '', null, [h('div', { class: 'tipo-conta' }, sel), ajudaTipo]);

    // ── anotação interna (P1-5) ──
    const nota = u.notaAdmin;
    const txt = h('textarea', { rows: 5, maxlength: 500, 'aria-label': 'Anotação interna', placeholder: 'Ex.: pediu ajuda pelo direct; conferir as carreiras com nota alta.', disabled: !LP.pode('usuarios') });
    txt.value = nota ? nota.texto : '';
    const contNota = h('span', { class: 'texto-3' });
    const atualizarCont = () => { contNota.textContent = txt.value.length + '/500 · deixe vazio para apagar'; };
    txt.addEventListener('input', atualizarCont);
    atualizarCont();
    const salvarNota = LP.botao('Salvar', async () => {
      try {
        const r = await LP.adminPost({ acao: 'nota', id: u.id, texto: txt.value });
        LP.avisar(r.nota ? 'Anotação salva. Só a equipe vê.' : 'Anotação apagada.');
        depois();
      } catch (e) { LP.avisarErro(e); }
    }, { tipo: 'ouro', pequeno: true, gerundio: 'Salvando…', disabled: !LP.pode('usuarios') });
    const cNota = cartao('u-nota', 'Anotação interna', '· só a equipe vê', null, h('div', { class: 'nota-interna' }, txt,
      h('div', { class: 'rodape-nota' }, h('span', { class: 'texto-3' }, nota ? 'Escrita por ' + (nota.porNome || nota.por || '—') + ' em ' + LP.dataHoraAno(nota.em) : 'Sem anotação.'), contNota, salvarNota)));

    // ── números ──
    const conq = Array.isArray(u.conquistas) ? u.conquistas : [];
    const L = LP.ladrilho;
    const tp = u.tempo || {};
    const numeros = h('div', { class: 'ladrilhos ladrilhos-pequenos' },
      L('Partidas', LP.inteiro(s.partidas), 'no total (aparelho e conta)'),
      L('Com a conta', LP.inteiro(u.partidasConta), u.bonusLiberado ? 'bônus liberados' : faltam !== null ? 'faltam ' + faltam + ' para liberar os bônus' : 'bônus ainda bloqueados'),
      L('Carreiras salvas', LP.inteiro(s.carreirasSalvas), (u.carreiras || []).filter((c) => c.noHall).length + ' no Hall público'),
      L('Melhor nota', s.melhorNota === null || s.melhorNota === undefined ? '—' : LP.inteiro(s.melhorNota), s.melhorJogador || ''),
      L('Esta semana', LP.tempo(tp.semana), 'com a aba visível'),
      L('Semana passada', LP.tempo(tp.semanaPassada), 'total: ' + LP.tempo(tp.total)),
      L('Conquistas', LP.inteiro(conq.length), 'na conta'),
      L('Denúncias', LP.inteiro(den.recebidas), 'recebidas · ' + LP.inteiro(den.feitas) + ' feitas'));
    const porModo = tp.porModo && typeof tp.porModo === 'object' ? Object.keys(tp.porModo).filter((k) => tp.porModo[k] > 0) : [];
    const modos = porModo.length ? h('p', { class: 'texto-3' }, 'Jogando por modo: ' + porModo.map((k) => (LP.NOMES_MODO[k] || k) + ' ' + LP.tempo(tp.porModo[k])).join(' · ')) : null;

    LP.trocar(det.corpo, perfil, cAcoes, numeros, modos, cTipo, cNota,
      secaoCarreiras(u),
      secaoLixeira(u),
      secaoBonus(u, cfgBonus, faltam),
      secaoIndicacoes(u, cfgBonus),
      secaoAcesso(u, sessoes),
      secundario('Conquistas', LP.inteiro(conq.length), secaoConquistas(conq, nomes)),
      secundario('Últimas visitas', (u.visitas || []).length ? 'as ' + u.visitas.length + ' mais recentes' : '', secaoVisitas(u.visitas || [])),
      secundario('Últimos eventos', (u.eventos || []).length ? 'os ' + u.eventos.length + ' mais recentes' : '', secaoEventos(u.eventos || [])));
  }

  /** X2: onde a carreira está em relação ao Hall (a mesma régua que o jogador vê em Minhas carreiras). */
  function chipHall(c) {
    const e = c.hall && c.hall.estado;
    const m = c.hall && c.hall.motivo;
    if (!e) return null;
    const mapa = { no_hall: ['No Hall', 'ok'], revisao: ['Em revisão', 'alerta'], suspeita: ['Suspeita', 'alerta'], oculta: ['Oculta', ''], fora: ['Fora do Hall', 'tracejado'], privada: ['Privada', ''] };
    const [t, cor] = mapa[e] || [e, ''];
    return LP.chip(t, cor, { title: m || '', semPonto: e === 'fora' });
  }
  function chipsCarreira(c) {
    const chips = [chipHall(c)];
    if (c.publica) chips.push(LP.chip('Escolhida', 'ouro', { title: 'O jogador marcou esta para o Hall', semPonto: true }));
    if (c.destaque) chips.push(LP.chip('Destaque', 'ouro', { semPonto: true }));
    if (c.oculta === 1) chips.push(LP.chip('Oculta (moderação)', ''));
    if (c.oculta === 2) chips.push(LP.chip('Oculta (denúncias)', 'perigo'));
    if (c.suspeita) chips.push(LP.chip('Suspeita: ' + LP.motivosSuspeita(c.suspeita), 'alerta', { title: 'Fica fora do Hall até alguém liberar' }));
    if (c.notaV !== null && c.notaV !== undefined && c.notaV !== 2) chips.push(LP.chip('Nota antiga (v' + c.notaV + ')', '', { title: 'O jogo reenvia com a nota recalculada quando o dono abrir' }));
    const ok = chips.filter(Boolean);
    return ok.length ? h('span', { class: 'chips' }, ok) : '—';
  }

  function secaoCarreiras(u) {
    const cs = Array.isArray(u.carreiras) ? u.carreiras : [];
    const conteudo = cs.length ? LP.lista({
      itens: cs,
      chave: (c) => c.pk,
      aoClicar: (c) => LP.abrirCarreira(c.pk),
      rotuloLinha: (c) => 'Abrir a carreira ' + c.jogador,
      colunas: [
        { rotulo: 'Jogador', principal: true, celula: (c) => h('div', { class: 'celula-dupla' }, h('span', null, c.jogador || '—'),
          h('span', null, '#' + c.numero + ' · ' + c.pais + ' · ' + c.posicao + ' · ' + (LP.NOMES_MODO[c.modo] || c.modo))) },
        { rotulo: 'Nota', num: true, celula: (c) => LP.inteiro(c.nota) },
        { rotulo: 'Pico', num: true, celula: (c) => LP.inteiro(c.picoOvr) },
        { rotulo: 'Temp.', num: true, celula: (c) => LP.inteiro(c.temporadas) },
        { rotulo: 'Gols', num: true, celula: (c) => LP.inteiro(c.gols) },
        { rotulo: 'Bônus', num: true, celula: (c) => (c.bonusOvr ? '+' + c.bonusOvr : '—') },
        { rotulo: 'Hall', classe: 'situacao', celula: chipsCarreira },
        { rotulo: 'Decisão', classe: 'quebra', celula: (c) => (c.moderacao ? h('span', { class: 'texto-3' }, (c.moderacao.motivo || 'sem motivo escrito') + ' · ' + LP.relativo(c.moderacao.em)) : '—') },
        { rotulo: 'Salva', celula: (c) => h('span', { class: 'chips' }, h('span', { class: 'selo' + (c.como === 'auto' ? ' selo-auto' : '') }, c.como === 'auto' ? 'auto' : 'manual'), LP.quando(c.salvaEm)) },
        { rotulo: 'Ações', acoes: true, celula: (c) => LP.botoesCarreira({ id: c.pk, carreiraId: c.id, jogador: c.jogador, oculta: c.oculta, suspeita: c.suspeita, noHall: c.noHall, destaque: c.destaque, usuario: { id: u.id, apelido: u.apelido } }, depois) },
      ],
    }) : LP.estadoVazio('Nenhuma carreira salva', 'Carreiras com pico 90+ sobem sozinhas; as outras, quando o jogador salva.');
    return cartao('u-carreiras', 'Carreiras', cs.length ? LP.inteiro(cs.length) + ' salvas' : '', null, conteudo);
  }

  function secaoLixeira(u) {
    const ls = Array.isArray(u.lixeira) ? u.lixeira : [];
    if (!ls.length) return null;
    return cartao('u-lixeira', 'Na lixeira', LP.plural(ls.length, 'carreira apagada', 'carreiras apagadas'), null, LP.lista({
      itens: ls,
      colunas: [
        { rotulo: 'Jogador', principal: true, celula: (x) => h('div', { class: 'celula-dupla' }, h('span', null, x.jogador || '—'), h('span', null, 'nota ' + LP.inteiro(x.nota))) },
        { rotulo: 'Motivo', classe: 'quebra', celula: (x) => x.motivo || '—' },
        { rotulo: 'Apagada', celula: (x) => LP.quando(x.apagadaEm) },
        { rotulo: 'Cópia', celula: (x) => (x.temCopia ? 'some ' + LP.relativo(x.expiraEm) : LP.chip('venceu: só a marca', '', { semPonto: true })) },
        { rotulo: 'Ações', acoes: true, celula: (x) => (LP.botoesLixeira ? LP.botoesLixeira(x, depois) : null) },
      ],
    }));
  }

  function refBonus(b) {
    const ref = String(b.ref || '');
    let m = /^indicacao:(\d+)$/.exec(ref);
    if (m) return 'Indicação #' + m[1];
    m = /^dia:(\d{4})-(\d{2})-(\d{2})$/.exec(ref);
    if (m) return 'Compartilhou em ' + m[3] + '/' + m[2];
    return ref || '—';
  }
  LP.refBonus = refBonus;

  function secaoBonus(u, cfg, faltam) {
    const bs = Array.isArray(u.bonus) ? u.bonus : [];
    const estadoTxt = u.bonusLiberado ? 'liberados' : faltam !== null ? 'bloqueados: faltam ' + LP.plural(faltam, 'partida', 'partidas') : 'bloqueados';
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
        { rotulo: 'Ações', acoes: true, celula: (b) => (b.usadoEm || !LP.pode('bonus') ? null : LP.botao('Tirar', () => LP.tirarBonus(b, u.apelido, depois), { tipo: 'perigo', pequeno: true, icone: 'menos' })) },
      ],
    }) : LP.estadoVazio('Nenhum bônus', 'Indicações válidas, o compartilhar do dia e os bônus da equipe aparecem aqui.');
    return cartao('u-bonus', 'Bônus de OVR', estadoTxt, LP.pode('bonus') ? LP.botao('Dar bônus', () => darBonus(u), { tipo: 'fantasma', pequeno: true, icone: 'presente' }) : null, conteudo);
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
        { rotulo: 'Ações', acoes: true, celula: (i) => (i.status === 'recusada' || !LP.pode('bonus') ? null : LP.botao('Recusar', () => LP.recusarIndicacao(i, depois), { tipo: 'perigo', pequeno: true })) },
      ],
    }) : h('p', { class: 'texto-3' }, 'Ainda não indicou ninguém.');
    return secundario('Indicações', feitas.length ? LP.inteiro(feitas.filter((i) => i.status === 'valida').length) + ' válidas de ' + feitas.length : '',
      [h('h3', null, 'Recebida'), recebida, h('h3', null, 'Feitas'), regras ? h('p', { class: 'texto-3' }, regras) : null, tabela,
        feitas.length ? h('p', null, h('a', { href: '#/indicacoes?indicador=' + u.id }, 'Ver na aba Indicações →')) : null], !!rec || feitas.length > 0);
  }

  /** U15: por que esta conta não entra? (nunca pede nem testa a senha do jogador) + as sessões ativas. */
  function secaoAcesso(u, sessoes) {
    const a = u.acesso || {};
    const b = a.bloqueioEntrar || {};
    const r = a.redefinicaoPendente;
    const itens = [
      [a.status !== 'suspenso', a.status === 'suspenso' ? 'Suspensa' + (a.suspensoAte ? ' até ' + LP.dataHoraAno(a.suspensoAte) : ' (sem prazo)') + ': não entra.' : 'Conta ativa.'],
      [!b.bloqueado, b.bloqueado ? 'Entrada travada: ' + LP.plural(b.tentativas || 0, 'senha errada', 'senhas erradas') + ' nos últimos minutos (limite ' + (b.limite || 5) + '). Libera sozinha em até 10 min.' : (b.tentativas ? LP.plural(b.tentativas, 'senha errada', 'senhas erradas') + ' recentes (limite ' + (b.limite || 5) + ').' : 'Sem senha errada recente.')],
      [true, r ? 'Código de troca de senha pedido: vale até ' + LP.hora(r.expiraEm) + ' (' + LP.plural(r.tentativas || 0, 'tentativa', 'tentativas') + ').' : 'Nenhum código de troca de senha valendo.'],
      [true, LP.plural(a.sessoes || 0, 'aparelho logado', 'aparelhos logados') + (a.ultimoLogin ? ' · último login ' + LP.relativo(a.ultimoLogin) : '') + '.'],
    ];
    const lista = h('ul', { class: 'lista-checagem' }, itens.map(([ok, t]) => h('li', null, h('span', { class: ok ? 'sim' : 'nao', 'aria-hidden': 'true' }, ok ? '✓' : '✗'), h('span', null, t))));
    const tabela = sessoes.length ? LP.lista({
      itens: sessoes,
      colunas: [
        { rotulo: 'Entrou', principal: true, celula: (s) => LP.dataHoraAno(s.criadaEm) },
        { rotulo: 'Renovada', celula: (s) => (s.renovadaEm ? LP.quando(s.renovadaEm) : '—') },
        { rotulo: 'Expira', celula: (s) => LP.dataHoraAno(s.expiraEm) },
      ],
    }) : null;
    const problema = a.status === 'suspenso' || b.bloqueado;
    return secundario('Diagnóstico de entrada', 'por que não entra?', [lista,
      h('p', { class: 'ajuda' }, 'Nunca peça a senha do jogador. Esqueceu? Use "Mandar código de troca de senha".'),
      tabela ? h('h3', null, 'Sessões ativas') : null, tabela], problema);
  }

  function secaoConquistas(conq, nomes) {
    const lista = conq.slice().sort((a, b) => String(a.em).localeCompare(String(b.em)));
    return lista.length
      ? h('div', { class: 'lista-conquistas' }, lista.map((c) => {
        const n = nomes.conquistas[c.id];
        const tipo = n && n.r === 'lendaria' ? 'ouro' : n && n.r === 'epica' ? 'info' : '';
        return LP.chip(n ? n.t : c.id, tipo, { semPonto: true, title: (n ? n.d + ' · ' : '') + c.id + ' · ' + LP.dataHoraAno(c.em) });
      }))
      : h('p', { class: 'texto-3' }, 'Nenhuma conquista sincronizada com a conta ainda.');
  }

  function secaoVisitas(vs) {
    return vs.length ? LP.lista({
      itens: vs,
      colunas: [
        { rotulo: 'Início', principal: true, celula: (v) => LP.dataHoraAno(v.inicio) },
        { rotulo: 'Tempo', num: true, celula: (v) => LP.duracao(v.tempoS) },
        { rotulo: 'Origem', celula: (v) => LP.origemCurta(v.origem) },
        { rotulo: 'Aparelho', celula: (v) => h('span', { class: 'chips' }, LP.aparelho(v.aparelho), v.bot ? LP.chip('robô/teste', 'alerta') : null) },
      ],
    }) : h('p', { class: 'texto-3' }, 'Nenhuma visita ligada à conta.');
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
  LP.dadosEvento = dadosEvento;

  function secaoEventos(es) {
    return es.length ? LP.lista({
      itens: es,
      colunas: [
        { rotulo: 'Quando', principal: true, celula: (e) => LP.dataHoraAno(e.em) },
        { rotulo: 'Evento', celula: (e) => LP.NOMES_EVENTO[e.tipo] || e.tipo },
        { rotulo: 'Modo', celula: (e) => (e.modo ? LP.NOMES_MODO[e.modo] || e.modo : '—') },
        { rotulo: 'Detalhes', classe: 'quebra', celula: dadosEvento },
      ],
    }) : h('p', { class: 'texto-3' }, 'Nenhum evento ligado à conta.');
  }

  // ── ações ──────────────────────────────────────────────────────────────────────────────────
  async function suspender(u) {
    const r = await LP.dialogo({
      titulo: 'Suspender @' + u.apelido,
      perigo: true,
      botao: 'Suspender conta',
      gerundio: 'Suspendendo…',
      texto: 'A pessoa sai de todos os aparelhos, não consegue entrar e as carreiras dela saem do Hall público na hora.',
      campos: [
        { nome: 'dias', rotulo: 'Por quanto tempo', tipo: 'numero', min: 1, max: 3650, placeholder: 'vazio = até reativar', valor: 7,
          atalhos: [{ rotulo: '1 dia', valor: 1 }, { rotulo: '3 dias', valor: 3 }, { rotulo: '7 dias', valor: 7 }, { rotulo: '30 dias', valor: 30 }, { rotulo: 'Até reativar', valor: null }] },
        { nome: 'motivo', rotulo: 'Motivo (fica no registro; o jogador vê ao tentar entrar)', tipo: 'motivo', obrigatorio: true, maxlength: 200, chips: MOTIVOS_SUSPENDER },
      ],
      executar: (v) => LP.adminPost({ acao: 'suspender', id: u.id, motivo: v.motivo, dias: v.dias }),
    });
    if (!r) return;
    LP.avisar('@' + u.apelido + ' suspenso' + (r.suspensoAte ? ' até ' + LP.dataHoraAno(r.suspensoAte) : ' até reativar') + ' · ' + LP.plural(r.sessoesEncerradas || 0, 'sessão encerrada', 'sessões encerradas') + '. As carreiras saíram do Hall.');
    depois();
  }
  async function reativar(u) {
    const r = await LP.dialogo({
      titulo: 'Reativar @' + u.apelido,
      botao: 'Reativar conta',
      gerundio: 'Reativando…',
      tipoBotao: 'ok',
      texto: 'A pessoa volta a entrar normalmente. As carreiras voltam ao Hall público na próxima fotografia (ou em "Atualizar Hall agora").',
      campos: [{ nome: 'motivo', rotulo: 'Motivo (opcional, fica no registro)', tipo: 'motivo', chips: false, maxlength: 200 }],
      executar: (v) => LP.adminPost({ acao: 'reativar', id: u.id, motivo: v.motivo || null }),
    });
    if (!r) return;
    LP.avisar('@' + u.apelido + ' reativado. Volta ao Hall na próxima fotografia.');
    depois();
  }
  async function deslogar(u, n) {
    const r = await LP.dialogo({
      titulo: 'Deslogar @' + u.apelido + ' de todos os aparelhos?',
      botao: 'Deslogar',
      gerundio: 'Deslogando…',
      texto: (n ? 'Encerra ' + LP.plural(n, 'sessão de login ativa', 'sessões de login ativas') + '. ' : 'Não há sessão ativa agora. ') + 'A conta continua ativa: a pessoa pode entrar de novo com a senha.',
      executar: () => LP.adminPost({ acao: 'deslogar', id: u.id }),
    });
    if (!r) return;
    LP.avisar(LP.plural(r.sessoesEncerradas || 0, 'sessão encerrada', 'sessões encerradas') + '.');
    depois();
  }
  async function renomear(u) {
    const r = await LP.dialogo({
      titulo: 'Renomear @' + u.apelido,
      botao: 'Trocar apelido',
      gerundio: 'Trocando…',
      texto: 'Para moderação (apelido ofensivo, enganoso…). O Hall público já mostra o novo na hora.',
      campos: [{ nome: 'apelido', rotulo: 'Novo apelido', valor: u.apelido, maxlength: 20, obrigatorio: true,
        ajuda: '2 a 20 caracteres: letras, números, espaço e _ . -',
        validar: (v) => (APELIDO_RE.test(v) ? (v === u.apelido ? 'É o mesmo apelido de agora.' : null) : 'Use de 2 a 20 caracteres: letras, números, espaço e _ . -') }],
      executar: (v) => LP.adminPost({ acao: 'renomear', id: u.id, apelido: v.apelido }),
    });
    if (!r) return;
    LP.avisar('Apelido trocado para ' + (r.apelido || '') + '.');
    depois();
  }
  async function darBonus(u) {
    const r = await LP.dialogo({
      titulo: 'Dar bônus de OVR para @' + u.apelido,
      botao: 'Dar bônus',
      gerundio: 'Dando…',
      texto: 'O bônus da equipe vale na hora (não espera as partidas de liberação) e é usado na próxima carreira do Clássico.',
      campos: [
        { nome: 'valor', rotulo: 'Valor', tipo: 'opcoes', valor: 2, opcoes: [1, 2, 3, 4, 5].map((n) => ({ valor: n, rotulo: '+' + n })) },
        { nome: 'motivo', rotulo: 'Motivo (fica guardado no bônus e no Registro)', maxlength: 100, obrigatorio: true, placeholder: 'Ex.: compensação por erro, sorteio da live…' },
      ],
      executar: (v) => LP.adminPost({ acao: 'dar_bonus', id: u.id, valor: v.valor, motivo: v.motivo }),
    });
    if (!r) return;
    LP.avisar('Bônus dado para @' + u.apelido + '. Vale na próxima carreira do Clássico.');
    depois();
  }
  /** Tirar um bônus (aqui, na lista global de bônus e na aba Indicações). Motivo obrigatório. */
  LP.tirarBonus = async function (b, apelido, aoTerminar) {
    const r = await LP.dialogoMotivo({
      titulo: 'Tirar o bônus de +' + b.valor + (apelido ? ' de @' + apelido : ''),
      perigo: true,
      botao: 'Tirar bônus',
      gerundio: 'Tirando…',
      chips: [{ rotulo: 'Indicação falsa' }, { rotulo: 'Dado por engano' }, { rotulo: 'Mesmo aparelho' }, { rotulo: 'Outro', vazio: true }],
      texto: [b.origem === 'indicacao' ? 'É bônus de indicação: a indicação ligada a ele vira recusada (não conta de novo).' : 'O bônus some da conta.', 'Bônus já usado numa carreira não dá para tirar.'],
      executar: (v) => LP.adminPost({ acao: 'tirar_bonus', bonusId: b.id, motivo: v.motivo }),
    });
    if (!r) return;
    LP.avisar('Bônus de +' + b.valor + ' tirado' + (apelido ? ' de @' + apelido : '') + '.');
    if (aoTerminar) aoTerminar();
  };
  async function bloquearHall(u, sim) {
    const r = sim
      ? await LP.dialogoMotivo({
        titulo: 'Tirar @' + u.apelido + ' do Hall público',
        botao: 'Tirar do Hall',
        gerundio: 'Tirando…',
        texto: 'A conta continua jogando e salvando, mas nenhuma carreira dela aparece no Hall público (saem na hora). O jogador vê "Sua conta não pode publicar no Hall público."',
        executar: (v) => LP.adminPost({ acao: 'bloquear_hall', id: u.id, sim: true, motivo: v.motivo }),
      })
      : await LP.dialogoMotivo({
        titulo: 'Devolver @' + u.apelido + ' ao Hall público',
        botao: 'Devolver ao Hall',
        gerundio: 'Devolvendo…',
        tipoBotao: 'ok',
        obrigatorio: false,
        chips: false,
        texto: 'As carreiras dela voltam na próxima fotografia do Hall (ou em "Atualizar Hall agora").',
        executar: (v) => LP.adminPost({ acao: 'bloquear_hall', id: u.id, sim: false, motivo: v.motivo }),
      });
    if (!r) return;
    LP.avisar(sim ? '@' + u.apelido + ' saiu do Hall público.' : '@' + u.apelido + ' volta ao Hall na próxima fotografia.');
    depois();
  }
  async function mandarCodigo(u) {
    if (u.status === 'suspenso') { LP.avisar('A conta está suspensa: reative antes de mandar o código.', 'erro'); return; }
    if (!LP.confirmar('Mandar o código de troca de senha para ' + LP.mascarar(u.email) + '? Vale 30 min. Ninguém da equipe vê o código.')) return;
    try {
      const r = await LP.adminPost({ acao: 'enviar_redefinicao', id: u.id });
      if (r.enviado) LP.avisar('Código mandado para ' + (r.para || LP.mascarar(u.email)) + ' (aceito pelo servidor de e-mail; pode cair no spam). Vale 30 min.');
      else LP.avisar('O servidor não aceitou o e-mail para ' + (r.para || LP.mascarar(u.email)) + '. Veja Registro → E-mails.', 'erro');
      depois();
    } catch (e) { LP.avisarErro(e); }
  }
  async function excluir(u) {
    const corpo = h('div', null,
      h('p', { class: 'texto-2' }, 'Some de vez (LGPD):'),
      h('ul', { class: 'lista-some' },
        h('li', null, 'a conta e o login em todos os aparelhos;'),
        h('li', null, 'as carreiras salvas e o lugar no Hall público;'),
        h('li', null, 'as conquistas, os bônus e as indicações feitas;'),
        h('li', null, 'as denúncias feitas, a anotação interna e a lixeira dela.')),
      h('p', { class: 'faixa faixa-perigo' }, 'Não dá para desfazer. As visitas ficam, sem ligação com ninguém.'));
    const r = await LP.dialogo({
      titulo: 'Excluir a conta de @' + u.apelido,
      perigo: true,
      botao: 'Excluir para sempre',
      gerundio: 'Excluindo…',
      corpo: corpo,
      campos: [{ nome: 'motivo', rotulo: 'Motivo (só ele vai para o registro, além do número da conta)', tipo: 'selecao', valor: 'pedido_titular',
        opcoes: [{ valor: 'pedido_titular', rotulo: 'Pedido do titular (LGPD)' }, { valor: 'abuso', rotulo: 'Abuso' }, { valor: 'teste', rotulo: 'Conta de teste' }, { valor: 'outro', rotulo: 'Outro' }] }],
      digitar: u.apelido,
      digitarLivre: true,
      executar: (v) => LP.adminPost({ acao: 'excluir_usuario', id: u.id, confirma: v.confirma, motivo: v.motivo }),
    });
    if (!r) return;
    LP.avisar('Conta de @' + u.apelido + ' excluída.');
    LP.gaveta.fechar();
    LP.depoisDeAgir();
    LP.recarregarListaUsuarios();
  }
  /** Recusar uma indicação (aqui e na aba Indicações). Motivo obrigatório. */
  LP.MOTIVOS_INDICACAO = [{ rotulo: 'Mesmo aparelho' }, { rotulo: 'Conta falsa' }, { rotulo: 'Indicou a si mesmo' }, { rotulo: 'Série suspeita' }, { rotulo: 'Outro', vazio: true }];
  LP.recusarIndicacao = async function (i, aoTerminar) {
    const r = await LP.dialogoMotivo({
      titulo: 'Recusar a indicação de ' + ((i.indicado && i.indicado.apelido) ? '@' + i.indicado.apelido : 'uma conta'),
      perigo: true,
      botao: 'Recusar',
      gerundio: 'Recusando…',
      chips: LP.MOTIVOS_INDICACAO,
      texto: 'Ela deixa de contar para o indicador e o bônus dela é tirado (se ainda não foi usado).',
      executar: (v) => LP.adminPost({ acao: 'recusar_indicacao', id: i.id, motivo: v.motivo }),
    });
    if (!r) return;
    LP.avisar(r.bonusTirado ? 'Indicação recusada e bônus tirado.' : 'Indicação recusada.');
    LP.marcarFeitos('indicacao', [i.id]);
    if (aoTerminar) aoTerminar();
  };
})();
