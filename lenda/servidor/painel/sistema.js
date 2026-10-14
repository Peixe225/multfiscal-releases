/* LENDA · painel — Conquistas (raridade), Indicações e bônus, Configurações do site (site_config), Testes (só o
 * admin: Imersivo, Live) e Registro (admin_log). */
'use strict';

(function () {
  const LP = window.LP;
  const { h } = LP;

  // ═══ Conquistas ══════════════════════════════════════════════════════════════════════════════
  const ORDEM_RARIDADE = { comum: 1, rara: 2, epica: 3, lendaria: 4 };
  const conq = { pedido: 0, corpo: null, tabela: null, itens: null, jogadores: 0, q: '', raridade: '', ordem: { chave: 'jogadores', dir: 'desc' } };

  function montarConquistas(raiz) {
    conq.corpo = h('div');
    conq.tabela = h('div');
    conq.itens = null;
    LP.trocar(raiz, conq.corpo);
    LP.trocar(conq.corpo, LP.estadoCarregando(6));
    carregarConquistas();
  }

  async function carregarConquistas() {
    const n = ++conq.pedido;
    try {
      const [d, nomes] = await Promise.all([LP.adminGet('conquistas'), LP.nomes()]);
      if (n !== conq.pedido || !LP.visivel(conq.corpo)) return;
      const porId = {};
      (Array.isArray(d.itens) ? d.itens : []).forEach((x) => { porId[x.id] = x; });
      const todos = Object.keys(Object.assign({}, nomes.conquistas, porId));
      conq.jogadores = d.jogadores || 0;
      conq.itens = todos.map((id) => {
        const x = porId[id] || {};
        const nm = nomes.conquistas[id];
        return { id: id, nome: nm ? nm.t : id, descricao: nm ? nm.d : '', raridade: nm ? nm.r : '', jogadores: x.jogadores || 0, pct: x.pct || 0, primeiraEm: x.primeiraEm || null, conhecida: !!nm };
      });
      desenharConquistas();
    } catch (e) {
      if (n !== conq.pedido || (e && e.status === 401)) return;
      LP.trocar(conq.corpo, LP.estadoErro(e, carregarConquistas));
    }
  }

  function desenharConquistas() {
    const itens = conq.itens || [];
    const desbloqueadas = itens.filter((x) => x.jogadores > 0);
    const porJog = desbloqueadas.slice().sort((a, b) => b.jogadores - a.jogadores);
    const comum = porJog[0];
    const rara = porJog[porJog.length - 1];
    LP.subAba(LP.inteiro(itens.length) + ' conquistas no jogo · ' + LP.inteiro(conq.jogadores) + ' jogadores com pelo menos uma');
    const L = LP.ladrilho;
    const ladrilhos = h('div', { class: 'ladrilhos espaco-baixo' },
      L('Jogadores', LP.inteiro(conq.jogadores), 'contas ativas com pelo menos uma'),
      L('Já desbloqueadas', LP.inteiro(desbloqueadas.length), 'de ' + LP.inteiro(itens.length) + ' no jogo'),
      L('Ninguém tem ainda', LP.inteiro(itens.length - desbloqueadas.length), 'as mais difíceis'),
      L('A mais comum', comum ? comum.nome : '—', comum ? LP.pct(comum.jogadores, conq.jogadores) + ' dos jogadores' : ''),
      L('A mais rara (com dono)', rara ? rara.nome : '—', rara ? LP.plural(rara.jogadores, 'jogador', 'jogadores') : ''));
    const ferramentas = h('div', { class: 'ferramentas' },
      LP.busca('Buscar conquista', conq.q, (v) => { conq.q = v.toLowerCase(); desenharTabelaConquistas(); }),
      LP.selecao('Raridade no jogo', [{ valor: '', rotulo: 'Todas' }].concat(Object.keys(LP.NOMES_RARIDADE).map((k) => ({ valor: k, rotulo: LP.NOMES_RARIDADE[k] }))), conq.raridade,
        (v) => { conq.raridade = v; desenharTabelaConquistas(); }));
    LP.trocar(conq.corpo, ladrilhos, h('section', { class: 'cartao' },
      h('div', { class: 'cartao-cabeca' }, h('h2', null, 'Raridade de verdade'), h('span', { class: 'texto-3' }, 'quantos jogadores têm cada conquista · a raridade pública (no jogo) é recalculada a cada 1 h')),
      ferramentas, conq.tabela));
    desenharTabelaConquistas();
  }

  function desenharTabelaConquistas() {
    const q = conq.q;
    let itens = (conq.itens || []).filter((x) => (!conq.raridade || x.raridade === conq.raridade) &&
      (!q || x.nome.toLowerCase().includes(q) || x.id.toLowerCase().includes(q) || x.descricao.toLowerCase().includes(q)));
    const { chave, dir } = conq.ordem;
    const val = (x) => (chave === 'nome' ? x.nome.toLowerCase() : chave === 'raridade' ? ORDEM_RARIDADE[x.raridade] || 0 : chave === 'primeira' ? x.primeiraEm || '9999' : x.jogadores); // 'jogadores' e 'pct' dão a mesma ordem
    itens = itens.slice().sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      const c = va < vb ? -1 : va > vb ? 1 : a.nome.localeCompare(b.nome);
      return dir === 'asc' ? c : -c;
    });
    if (!itens.length) {
      LP.trocar(conq.tabela, LP.estadoVazio('Nenhuma conquista com esse filtro', ''));
      return;
    }
    const max = Math.max(1, ...itens.map((x) => x.jogadores));
    LP.trocar(conq.tabela, LP.lista({
      itens: itens,
      ordem: conq.ordem,
      aoOrdenar: (k) => {
        conq.ordem = { chave: k, dir: conq.ordem.chave === k ? (conq.ordem.dir === 'asc' ? 'desc' : 'asc') : k === 'nome' || k === 'primeira' ? 'asc' : 'desc' };
        desenharTabelaConquistas();
      },
      colunas: [
        { rotulo: 'Conquista', principal: true, ordenar: 'nome', classe: 'quebra', celula: (x) => h('div', { class: 'celula-dupla', title: x.descricao },
          h('span', null, x.nome), h('span', null, x.descricao || x.id)) },
        { rotulo: 'No jogo', ordenar: 'raridade', celula: (x) => (x.raridade ? LP.chip(LP.NOMES_RARIDADE[x.raridade] || x.raridade, x.raridade === 'lendaria' ? 'ouro' : x.raridade === 'epica' ? 'info' : x.raridade === 'rara' ? 'ok' : '', { semPonto: true }) : LP.chip('fora do catálogo', '', { semPonto: true })) },
        { rotulo: 'Jogadores', num: true, ordenar: 'jogadores', celula: (x) => LP.inteiro(x.jogadores) },
        { rotulo: '% dos jogadores', num: true, ordenar: 'pct', celula: (x) => {
          const b = h('span', { class: 'mini-barra', 'aria-hidden': 'true' }, h('i'));
          b.firstChild.style.width = Math.round((x.jogadores / max) * 100) + '%';
          return h('span', null, b, conq.jogadores ? LP.pct(x.jogadores, conq.jogadores) : '—');
        } },
        { rotulo: 'Primeira vez', ordenar: 'primeira', celula: (x) => (x.primeiraEm ? LP.quando(x.primeiraEm) : '—') },
      ],
    }));
  }

  LP.abas.conquistas = { titulo: 'Conquistas', sub: '', montar: montarConquistas, recarregar: () => carregarConquistas(), focarBusca: true };

  // ═══ Indicações e bônus ══════════════════════════════════════════════════════════════════════
  const STATUS_IND = ['', 'pendente', 'valida', 'recusada'];
  const ind = { status: '', pagina: 1, pedido: 0, corpo: null, topo: null, temDados: false };

  function montarIndicacoes(raiz, rota) {
    ind.status = STATUS_IND.includes(rota.query.status) ? rota.query.status : '';
    ind.pagina = Math.max(1, parseInt(rota.query.pagina, 10) || 1);
    ind.temDados = false;
    ind.topo = h('div');
    ind.corpo = h('div');
    const filtros = h('div');
    const desenharFiltros = () => LP.trocar(filtros, LP.segmentos('Status', [
      { valor: '', rotulo: 'Todas' }, { valor: 'pendente', rotulo: 'Pendentes' }, { valor: 'valida', rotulo: 'Válidas' }, { valor: 'recusada', rotulo: 'Recusadas' },
    ], ind.status, (v) => { ind.status = v; ind.pagina = 1; desenharFiltros(); carregarInd(); }));
    desenharFiltros();
    LP.trocar(raiz, ind.topo, h('section', { class: 'cartao' },
      h('div', { class: 'cartao-cabeca' }, h('h2', null, 'Indicações'), h('span', { class: 'texto-3' }, 'quem convidou quem · vale quando o amigo termina a 1ª carreira do Clássico')),
      h('div', { class: 'ferramentas' }, filtros), ind.corpo));
    desenharTopoInd();
    carregarInd();
  }

  function desenharTopoInd() {
    if (!ind.topo || !ind.topo.isConnected) return;
    const r = LP.resumo || {};
    const i = r.indicacoes || {};
    const b = r.bonus || {};
    const cfg = (r.site && r.site.bonus) || null;
    const L = LP.ladrilho;
    const regras = cfg
      ? h('section', { class: 'cartao' },
        h('div', { class: 'cartao-cabeca' }, h('h2', null, 'Regras em vigor'), h('a', { href: '#/config', class: 'botao-fantasma botao-pequeno' }, 'Mudar em Configurações')),
        h('ul', { class: 'texto-2' },
          h('li', null, 'Amigo que entra pelo link e termina a 1ª carreira: ' + (cfg.indicacao || []).slice(0, Math.max(1, cfg.maxIndicacoes || 0)).map((v, k) => (k + 1) + 'º +' + v).join(', ') + ' de OVR (até ' + cfg.maxIndicacoes + ' amigos).'),
          h('li', null, 'Compartilhar o card final de uma carreira: +' + cfg.compartilhar + ' de OVR, 1 vez por dia.'),
          h('li', null, 'Todos os bônus de compartilhar e de indicar só liberam depois de ' + LP.plural(cfg.liberaAposPartidas, 'partida', 'partidas') + ' terminadas com a conta (até lá ficam guardados).'),
          h('li', null, 'Bônus dado pelo admin vale na hora.')))
      : null;
    LP.trocar(ind.topo, h('div', { class: 'ladrilhos espaco-baixo' },
      L('Válidas', LP.inteiro(i.validas), 'deram bônus ao indicador', { href: '#/indicacoes?status=valida' }),
      L('Pendentes', LP.inteiro(i.pendentes), 'o amigo ainda não terminou a 1ª carreira', { href: '#/indicacoes?status=pendente' }),
      L('Recusadas', LP.inteiro(i.recusadas), 'mesmo aparelho, própria conta, limite…', { href: '#/indicacoes?status=recusada' }),
      L('Bônus esperando uso', LP.inteiro(b.naoUsados), 'em todas as contas'),
      L('Bônus usados', LP.inteiro(b.usados), 'em carreiras do Clássico')), regras);
  }
  LP.desenharTopoIndicacoes = desenharTopoInd;

  async function carregarInd() {
    const n = ++ind.pedido;
    if (!LP.visivel(ind.corpo)) return;
    LP.trocarQuery('indicacoes', { status: ind.status, pagina: ind.pagina > 1 ? ind.pagina : '' });
    if (!ind.temDados) LP.trocar(ind.corpo, LP.estadoCarregando(5));
    else ind.corpo.classList.add('esmaecido');
    try {
      const d = await LP.adminGet('indicacoes', { status: ind.status, pagina: ind.pagina });
      if (n !== ind.pedido || !LP.visivel(ind.corpo)) return;
      ind.temDados = true;
      desenharInd(d);
    } catch (e) {
      if (n !== ind.pedido || (e && e.status === 401) || !LP.visivel(ind.corpo)) return;
      ind.temDados = false;
      LP.trocar(ind.corpo, LP.estadoErro(e, carregarInd));
    } finally {
      if (n === ind.pedido) ind.corpo.classList.remove('esmaecido');
    }
  }

  function desenharInd(d) {
    const itens = Array.isArray(d.itens) ? d.itens : [];
    LP.subAba(LP.inteiro(d.total || 0) + (ind.status ? ' ' + (LP.NOMES_STATUS_INDICACAO[ind.status] || '').toLowerCase() + 's' : ' indicações'));
    if (!itens.length) {
      LP.trocar(ind.corpo, LP.estadoVazio(ind.status ? 'Nenhuma indicação com esse status' : 'Nenhuma indicação ainda', 'Cada conta tem um link de convite em "Minha conta → Convide amigos".'));
      return;
    }
    const chipSt = (st) => LP.chip(LP.NOMES_STATUS_INDICACAO[st] || st, st === 'valida' ? 'ok' : st === 'recusada' ? 'perigo' : 'alerta');
    const recarregar = () => { carregarInd(); LP.atualizarResumo(); };
    LP.trocar(ind.corpo, LP.lista({
      itens: itens,
      colunas: [
        { rotulo: 'Indicador', principal: true, celula: (x) => h('span', { class: 'chips' }, LP.linkUsuario(x.indicador), h('span', { class: 'texto-3' }, '→'), LP.linkUsuario(x.indicado)) },
        { rotulo: 'Status', celula: (x) => chipSt(x.status) },
        { rotulo: 'Motivo', celula: (x) => (x.motivo ? LP.NOMES_MOTIVO_INDICACAO[x.motivo] || x.motivo : '—') },
        { rotulo: 'Criada', celula: (x) => LP.quando(x.criadaEm) },
        { rotulo: 'Validada', celula: (x) => (x.validadaEm ? LP.quando(x.validadaEm) : '—') },
        { rotulo: 'Bônus', celula: (x) => (x.bonus ? h('span', { class: 'chips' }, h('b', null, '+' + x.bonus.valor), x.bonus.usado ? LP.chip('usado', '', { semPonto: true }) : LP.chip('não usado', 'ouro', { semPonto: true })) : '—') },
        { rotulo: 'Ações', acoes: true, celula: (x) => (x.status === 'recusada' ? null : LP.botao('Recusar', () => LP.recusarIndicacao(x, recarregar), { tipo: 'perigo', pequeno: true })) },
      ],
    }), LP.paginacao(d.total || 0, d.pagina || ind.pagina, d.porPagina || 50, (p) => { ind.pagina = p; carregarInd(); window.scrollTo(0, 0); }));
  }

  LP.abas.indicacoes = { titulo: 'Indicações e bônus', sub: '', montar: montarIndicacoes, recarregar: () => { carregarInd(); LP.atualizarResumo(); } };

  // ═══ Configurações ═══════════════════════════════════════════════════════════════════════════
  const CHAVES = ['manutencao', 'cadastro_aberto', 'imersivo_publico', 'live_publica', 'aviso', 'regras', 'bonus', 'hall_intervalo_min'];
  const NOMES_CHAVE = {
    manutencao: 'Manutenção', cadastro_aberto: 'Cadastro aberto', imersivo_publico: 'Modo Imersivo público', live_publica: 'Live pública',
    aviso: 'Aviso no topo', regras: 'Convite de conta', bonus: 'Bônus de OVR', hall_intervalo_min: 'Intervalo do Hall',
  };
  const cfg = { valores: null, padroes: {}, atualizados: {}, form: null, raiz: null, barra: null, erros: {}, itens: {}, rascunhoAviso: '', pedido: 0 };
  const copia = (x) => JSON.parse(JSON.stringify(x === undefined ? null : x));
  const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  function montarConfig(raiz) {
    cfg.raiz = raiz;
    cfg.valores = null;
    LP.trocar(raiz, LP.estadoCarregando(8));
    carregarConfig();
  }

  async function carregarConfig() {
    const n = ++cfg.pedido;
    try {
      const d = await LP.adminGet('config');
      if (n !== cfg.pedido || !LP.visivel(cfg.raiz)) return;
      cfg.valores = d.valores || {};
      cfg.padroes = d.padroes || {};
      cfg.atualizados = d.atualizados || {};
      cfg.form = copia(cfg.valores);
      cfg.rascunhoAviso = cfg.form.aviso ? cfg.form.aviso.texto : '';
      desenharConfig();
    } catch (e) {
      if (n !== cfg.pedido || (e && e.status === 401)) return;
      LP.trocar(cfg.raiz, LP.estadoErro(e, carregarConfig));
    }
  }

  function mudadas() {
    if (!cfg.valores || !cfg.form) return [];
    return CHAVES.filter((k) => !igual(cfg.form[k], cfg.valores[k]));
  }
  LP.configSujo = () => mudadas().length > 0;

  function meta(chave) {
    const a = cfg.atualizados[chave];
    const partes = [];
    if (a && a.em) partes.push('alterado ' + LP.relativo(a.em) + (a.por ? ' (' + (a.por === 'token' ? 'script' : a.por) + ')' : ''));
    if (chave in cfg.padroes) partes.push('padrão: ' + textoValor(chave, cfg.padroes[chave]));
    return h('p', { class: 'config-meta' }, partes.join(' · '));
  }
  function textoValor(chave, v) {
    if (v === null || v === undefined) return chave === 'aviso' ? 'sem aviso' : '—';
    if (typeof v === 'boolean') return v ? 'ligado' : 'desligado';
    if (chave === 'hall_intervalo_min') return LP.minutos(v);
    if (chave === 'regras') return 'após ' + v.aposPartidas + ', lembra a cada ' + v.lembrarACada + (v.obrigatorio ? ', obrigatório' : '');
    if (chave === 'bonus') return (v.indicacao || []).map((x) => '+' + x).join('/') + ' por amigo (até ' + v.maxIndicacoes + '), +' + v.compartilhar + ' ao compartilhar, libera após ' + v.liberaAposPartidas;
    if (chave === 'aviso') return '"' + v.texto + '" (' + v.tipo + ')';
    return JSON.stringify(v);
  }

  /** Item com interruptor (chave booleana; ou um booleano dentro de uma chave, com ler/gravar). */
  function itemInterruptor(chave, rotulo, ajuda, opcoes) {
    const o = opcoes || {};
    const ler = o.ler || (() => !!cfg.form[chave]);
    const gravar = o.gravar || ((v) => { cfg.form[chave] = v; });
    const entrada = h('input', { type: 'checkbox', role: 'switch', checked: ler(), 'aria-label': rotulo });
    const txt = h('span', { class: 'estado-txt' }, entrada.checked ? 'Ligado' : 'Desligado');
    entrada.addEventListener('change', () => {
      gravar(entrada.checked);
      txt.textContent = entrada.checked ? 'Ligado' : 'Desligado';
      atualizarBarra();
    });
    const item = h('div', { class: 'config-item', 'data-chave': chave },
      h('div', null, h('span', { class: 'rotulo-item' }, rotulo), o.semMeta ? null : meta(chave)),
      h('label', { class: 'interruptor' + (o.perigo ? ' perigo' : '') }, entrada, h('span', { class: 'trilho', 'aria-hidden': 'true' }), txt),
      h('p', { class: 'ajuda' }, ajuda),
      o.semMeta ? null : erroDe(chave));
    if (!o.semMeta) cfg.itens[chave] = item;
    return item;
  }
  function erroDe(caminho) {
    const p = h('p', { class: 'erro-campo', role: 'alert', hidden: true });
    cfg.erros[caminho] = p;
    return p;
  }
  /** Campo de número inteiro (caminho: 'regras.aposPartidas'), com faixa. */
  function campoNumero(caminho, rotulo, min, max, unidade, aoMudar) {
    const [k, sub, idx] = caminho.split('.');
    const ler = () => (sub === undefined ? cfg.form[k] : idx !== undefined ? cfg.form[k][sub][Number(idx)] : cfg.form[k][sub]);
    const gravar = (v) => {
      if (sub === undefined) cfg.form[k] = v;
      else if (idx !== undefined) cfg.form[k][sub][Number(idx)] = v;
      else cfg.form[k][sub] = v;
    };
    const id = 'cfg-' + caminho.replace(/\./g, '-');
    const entrada = h('input', { type: 'number', id: id, min: min, max: max, step: 1, inputmode: 'numeric', 'data-caminho': caminho });
    entrada.value = String(ler());
    entrada.addEventListener('input', () => {
      const t = entrada.value.trim();
      const n = Number(t);
      gravar(t !== '' && Number.isInteger(n) ? n : t);
      if (aoMudar) aoMudar();
      atualizarBarra();
    });
    return h('div', { class: 'campo' },
      h('label', { class: 'rotulo', for: id }, rotulo),
      h('span', { class: 'numero-campo' }, entrada, unidade ? h('span', null, unidade) : null),
      erroDe(caminho));
  }

  function cartao(titulo, sub, filhos, larga) {
    return h('section', { class: 'cartao' + (larga ? ' larga' : '') },
      h('div', { class: 'cartao-cabeca' }, h('h2', null, titulo), sub ? h('span', { class: 'texto-3' }, sub) : null), filhos);
  }

  function desenharConfig() {
    cfg.erros = {};
    cfg.itens = {};
    const f = cfg.form;
    LP.subAba('Vale para quem abrir ou recarregar o jogo (cache de até 10 s no servidor).');

    // ── site ──
    const site = cartao('Site', 'para todo mundo', [
      itemInterruptor('manutencao', 'Em manutenção', 'Quem não é admin vê a tela "Em manutenção" e não joga; você continua jogando. O servidor não bloqueia nada: uma carreira terminando agora continua sendo salva.', { perigo: true }),
      itemInterruptor('cadastro_aberto', 'Cadastro aberto', 'Desligado: some o "Criar conta" e o convite das 5 partidas não abre. Quem já tem conta continua entrando.'),
    ]);

    // ── só admin ──
    const admin = cartao('Em teste (só você)', 'deixe desligado até publicar', [
      itemInterruptor('imersivo_publico', 'Modo Imersivo aberto a todos', 'Desligado: o público vê "Em desenvolvimento" e só você joga (aba Testes). Carreiras do Imersivo não entram no Hall público enquanto estiver desligado.', { perigo: true }),
      itemInterruptor('live_publica', 'Live interativa visível a todos', 'Desligado: a Live some do menu, da tela inicial e do rodapé, e #/live dá "Página não encontrada" para quem não é admin.', { perigo: true }),
    ]);

    // ── aviso ──
    const ligado = h('input', { type: 'checkbox', role: 'switch', checked: !!f.aviso, 'aria-label': 'Mostrar aviso' });
    const txtLigado = h('span', { class: 'estado-txt' }, f.aviso ? 'Ligado' : 'Desligado');
    const texto = h('textarea', { id: 'cfg-aviso-texto', maxlength: 200, rows: 2, placeholder: 'Ex.: Hoje às 20h tem live no TikTok! Venha jogar junto.' });
    texto.value = f.aviso ? f.aviso.texto : cfg.rascunhoAviso;
    const contador = h('span', { class: 'texto-3' });
    let tipoAtual = f.aviso ? f.aviso.tipo : 'info';
    const tipos = h('div');
    const previa = h('div', { class: 'previa-aviso', 'aria-label': 'Prévia do aviso' });
    const corpoAviso = h('div', { class: 'campo' });
    const desenharTipos = () => LP.trocar(tipos, LP.segmentos('Tipo do aviso', [{ valor: 'info', rotulo: 'Informação' }, { valor: 'alerta', rotulo: 'Alerta' }], tipoAtual,
      (v) => { tipoAtual = v; desenharTipos(); sincronizarAviso(); }));
    const sincronizarAviso = () => {
      const t = texto.value.trim();
      cfg.rascunhoAviso = texto.value;
      cfg.form.aviso = ligado.checked ? { texto: t, tipo: tipoAtual } : null;
      txtLigado.textContent = ligado.checked ? 'Ligado' : 'Desligado';
      contador.textContent = texto.value.length + '/200';
      corpoAviso.hidden = !ligado.checked;
      previa.className = 'previa-aviso ' + tipoAtual;
      LP.trocar(previa, h('span', null, t || 'O texto do aviso aparece aqui.'), h('span', { class: 'x', 'aria-hidden': 'true' }, '×'));
      atualizarBarra();
    };
    ligado.addEventListener('change', sincronizarAviso);
    texto.addEventListener('input', sincronizarAviso);
    desenharTipos();
    LP.anexar(corpoAviso, [
      h('label', { class: 'rotulo', for: 'cfg-aviso-texto' }, 'Texto (1 a 200 caracteres)'), texto, h('div', { class: 'cartao-cabeca' }, tipos, contador),
      h('span', { class: 'rotulo' }, 'Prévia (faixa no topo do jogo; o jogador fecha no X)'), previa]);
    const itemAviso = h('div', { class: 'config-item coluna', 'data-chave': 'aviso' },
      h('div', { class: 'cartao-cabeca' }, h('div', null, h('span', { class: 'rotulo-item' }, 'Mostrar um aviso no topo do jogo'), meta('aviso')),
        h('label', { class: 'interruptor' }, ligado, h('span', { class: 'trilho', 'aria-hidden': 'true' }), txtLigado)),
      corpoAviso, erroDe('aviso'));
    cfg.itens.aviso = itemAviso;
    const aviso = cartao('Aviso', 'faixa no topo, para todos (nunca na live)', [itemAviso]);
    sincronizarAviso();

    // ── convite de conta ──
    const obrig = itemInterruptor('regras', 'Conta obrigatória', 'Ligado: o convite não tem "Agora não" (a pessoa precisa criar conta ou entrar para seguir jogando).',
      { semMeta: true, ler: () => !!cfg.form.regras.obrigatorio, gravar: (v) => { cfg.form.regras.obrigatorio = v; } });
    const itemRegras = h('div', { class: 'config-item coluna', 'data-chave': 'regras' },
      h('div', null, h('span', { class: 'rotulo-item' }, 'Quando o convite de conta aparece'), meta('regras')),
      h('div', { class: 'campo-linha' },
        campoNumero('regras.aposPartidas', 'Depois de', 1, 100, 'partidas'),
        campoNumero('regras.lembrarACada', 'Se fechar, volta depois de mais', 1, 100, 'partidas')),
      erroDe('regras'));
    cfg.itens.regras = itemRegras;
    const regras = cartao('Convite de conta', 'cadastro / entrar', [itemRegras, obrig]);

    // ── bônus ──
    const caixaInd = h('div', { class: 'trio' });
    // Ao abrir mostra a lista como está (depois do último valor, o servidor repete o último); só quando você muda
    // "Até quantos amigos" a lista cresce ou encurta para ter um valor por amigo.
    const desenharInd = (ajustar) => {
      const b = cfg.form.bonus;
      if (ajustar && Number.isInteger(b.maxIndicacoes) && b.maxIndicacoes >= 1) {
        const n = Math.min(10, b.maxIndicacoes);
        while (b.indicacao.length < n) b.indicacao.push(b.indicacao[b.indicacao.length - 1] ?? 0);
        b.indicacao.length = n;
      }
      LP.trocar(caixaInd, b.indicacao.map((_, i) => campoNumero('bonus.indicacao.' + i, (i + 1) + 'º amigo', 0, 10, 'OVR')));
    };
    desenharInd(false);
    const itemBonus = h('div', { class: 'config-item coluna', 'data-chave': 'bonus' },
      h('div', null, h('span', { class: 'rotulo-item' }, 'Indicar amigos'), meta('bonus')),
      h('p', { class: 'ajuda' }, 'O amigo entra pelo link de convite, cria conta e termina a 1ª carreira do Clássico: quem indicou ganha o bônus na próxima carreira.'),
      caixaInd,
      h('div', { class: 'campo-linha' },
        campoNumero('bonus.maxIndicacoes', 'Até quantos amigos', 0, 10, 'amigos', () => desenharInd(true)),
        campoNumero('bonus.compartilhar', 'Compartilhar o card final (1x por dia)', 0, 10, 'OVR')),
      h('div', { class: 'campo-linha' },
        campoNumero('bonus.liberaAposPartidas', 'Liberar os bônus de indicar e compartilhar depois de', 3, 5, 'partidas com a conta')),
      h('p', { class: 'ajuda' }, 'O combinado: de 3 a 5 partidas depois de criar a conta. Antes disso, indicação validada fica guardada e compartilhar não dá bônus. Bônus que você der vale na hora.'),
      erroDe('bonus'));
    cfg.itens.bonus = itemBonus;
    const bonus = cartao('Bônus de OVR', '+N de OVR na próxima carreira do Clássico', [itemBonus]);

    // ── Hall ──
    const faixa = h('input', { type: 'range', min: 60, max: 180, step: 5, 'aria-label': 'Intervalo do Hall em minutos' });
    faixa.value = String(f.hall_intervalo_min);
    const numeroHall = campoNumero('hall_intervalo_min', 'Minutos', 60, 180, 'min', () => {
      if (Number.isInteger(cfg.form.hall_intervalo_min)) faixa.value = String(cfg.form.hall_intervalo_min);
      txtHall.textContent = textoIntervalo();
    });
    const txtHall = h('span', { class: 'texto-2' });
    const textoIntervalo = () => (Number.isInteger(cfg.form.hall_intervalo_min) ? 'a cada ' + LP.minutos(cfg.form.hall_intervalo_min) : '');
    txtHall.textContent = textoIntervalo();
    faixa.addEventListener('input', () => {
      cfg.form.hall_intervalo_min = Number(faixa.value);
      const e = numeroHall.querySelector('input');
      e.value = faixa.value;
      txtHall.textContent = textoIntervalo();
      atualizarBarra();
    });
    const presets = h('div', { class: 'atalhos-dias' }, [60, 90, 120, 180].map((m) => LP.botao(LP.minutos(m), () => {
      cfg.form.hall_intervalo_min = m;
      faixa.value = String(m);
      numeroHall.querySelector('input').value = String(m);
      txtHall.textContent = textoIntervalo();
      atualizarBarra();
    }, { tipo: 'fantasma', pequeno: true })));
    const itemHall = h('div', { class: 'config-item coluna', 'data-chave': 'hall_intervalo_min' },
      h('div', null, h('span', { class: 'rotulo-item' }, 'Recalcular o Hall público'), meta('hall_intervalo_min')),
      h('div', { class: 'faixa-range' }, faixa, txtHall), presets, numeroHall,
      h('p', { class: 'ajuda' }, 'De 1 h a 3 h. O Hall das Lendas é refeito no primeiro acesso depois desse prazo (um pedido só refaz; os outros veem a foto anterior). Para refazer agora: Hall público → Atualizar Hall agora.'));
    cfg.itens.hall_intervalo_min = itemHall;
    const hall = cartao('Hall público', 'até 3 carreiras por conta', [itemHall]);

    cfg.barra = h('div', { class: 'barra-salvar', hidden: true, role: 'region', 'aria-label': 'Alterações não salvas' },
      h('span', { class: 'texto-2', id: 'cfg-resumo' }),
      h('div', { class: 'botoes' },
        LP.botao('Descartar', descartar, { tipo: 'fantasma' }),
        LP.botao('Salvar', salvar, { tipo: 'ouro', icone: 'check' })));

    LP.trocar(cfg.raiz, h('div', { class: 'config-grade' }, site, admin, aviso, regras, bonus, hall), cfg.barra);
    atualizarBarra();
  }

  /** Erros de validação (os mesmos limites do servidor; liberaAposPartidas: 3 a 5, o combinado). */
  function validar() {
    const f = cfg.form;
    const e = {};
    const int = (v, a, b) => Number.isInteger(v) && v >= a && v <= b;
    if (!int(f.regras.aposPartidas, 1, 100)) e['regras.aposPartidas'] = 'De 1 a 100.';
    if (!int(f.regras.lembrarACada, 1, 100)) e['regras.lembrarACada'] = 'De 1 a 100.';
    f.bonus.indicacao.forEach((v, i) => { if (!int(v, 0, 10)) e['bonus.indicacao.' + i] = 'De 0 a 10.'; });
    if (!int(f.bonus.maxIndicacoes, 0, 10)) e['bonus.maxIndicacoes'] = 'De 0 a 10.';
    if (!int(f.bonus.compartilhar, 0, 10)) e['bonus.compartilhar'] = 'De 0 a 10.';
    if (!int(f.bonus.liberaAposPartidas, 3, 5)) e['bonus.liberaAposPartidas'] = 'De 3 a 5 partidas.';
    if (!int(f.hall_intervalo_min, 60, 180)) e.hall_intervalo_min = 'De 60 a 180 minutos.';
    if (f.aviso && (!f.aviso.texto || f.aviso.texto.length > 200)) e.aviso = 'Escreva o texto do aviso (1 a 200 caracteres) ou desligue o aviso.';
    return e;
  }

  function atualizarBarra() {
    if (!cfg.barra) return;
    const m = mudadas();
    const erros = validar();
    for (const k in cfg.erros) {
      const msg = erros[k];
      cfg.erros[k].hidden = !msg;
      cfg.erros[k].textContent = msg || '';
      const entrada = document.getElementById('cfg-' + k.replace(/\./g, '-'));
      if (entrada) entrada.setAttribute('aria-invalid', msg ? 'true' : 'false');
    }
    for (const k in cfg.itens) cfg.itens[k].classList.toggle('mudou', m.includes(k));
    cfg.barra.hidden = m.length === 0;
    document.body.classList.toggle('com-barra', m.length > 0); // os avisos sobem para não cobrir o "Salvar"
    const t = document.getElementById('cfg-resumo');
    if (t) t.textContent = m.length ? LP.plural(m.length, 'alteração não salva', 'alterações não salvas') + ': ' + m.map((k) => NOMES_CHAVE[k]).join(', ') : '';
  }

  function descartar() {
    cfg.form = copia(cfg.valores);
    cfg.rascunhoAviso = cfg.form.aviso ? cfg.form.aviso.texto : '';
    desenharConfig();
  }

  async function salvar(ev, botao) {
    const m = mudadas();
    if (!m.length) return;
    const erros = validar();
    const comErro = Object.keys(erros).filter((k) => m.includes(k.split('.')[0]));
    if (comErro.length) {
      LP.avisar('Corrija os campos marcados antes de salvar.', 'erro');
      const e = document.getElementById('cfg-' + comErro[0].replace(/\./g, '-'));
      if (e) e.focus();
      return;
    }
    const v = cfg.valores;
    const f = cfg.form;
    const riscos = [];
    if (!v.manutencao && f.manutencao) riscos.push('Ligar a manutenção: quem não é admin vê "Em manutenção" e não joga.');
    if (v.cadastro_aberto && !f.cadastro_aberto) riscos.push('Fechar novos cadastros (quem tem conta continua entrando).');
    if (!v.imersivo_publico && f.imersivo_publico) riscos.push('Abrir o Modo Imersivo para todo mundo (hoje ele é "Em desenvolvimento").');
    if (!v.live_publica && f.live_publica) riscos.push('Mostrar a Live interativa para todo mundo (hoje só você vê).');
    const linhas = h('ul', { class: 'texto-2' }, m.map((k) => h('li', null, h('b', null, NOMES_CHAVE[k] + ': '), textoValor(k, v[k]) + ' → ' + textoValor(k, f[k]))));
    const r = await LP.dialogo({
      titulo: riscos.length ? 'Atenção: mudanças que todo mundo vê' : 'Salvar ' + LP.plural(m.length, 'alteração', 'alterações') + '?',
      perigo: riscos.length > 0,
      botao: 'Salvar',
      texto: riscos.length ? riscos.map((x) => h('p', { class: 'faixa faixa-alerta' }, x)) : [],
      corpo: linhas,
      executar: () => {
        const valores = {};
        m.forEach((k) => { valores[k] = f[k]; });
        return LP.adminPost({ acao: 'config', valores: valores });
      },
    });
    if (!r) return;
    LP.avisar('Configurações salvas. Vale para quem abrir ou recarregar o jogo.');
    // O servidor devolve os valores em vigor: desenha já com eles (sem reler e sem corrida com um clique logo depois).
    const agora = new Date().toISOString();
    m.forEach((k) => { cfg.atualizados[k] = { em: agora, por: 'painel' }; });
    cfg.valores = r.valores && typeof r.valores === 'object' ? r.valores : Object.assign({}, cfg.valores, copia(f));
    cfg.form = copia(cfg.valores);
    cfg.rascunhoAviso = cfg.form.aviso ? cfg.form.aviso.texto : cfg.rascunhoAviso;
    desenharConfig();
    LP.atualizarResumo();
  }

  LP.abas.config = {
    titulo: 'Configurações',
    sub: '',
    montar: montarConfig,
    recarregar: () => { if (!LP.configSujo()) carregarConfig(); },
    podeSair: () => !LP.configSujo(),
    sair: () => { cfg.valores = null; cfg.form = null; document.body.classList.remove('com-barra'); },
  };

  // ═══ Testes (só o admin) ═════════════════════════════════════════════════════════════════════
  function montarTestes(raiz) {
    const site = (LP.resumo && LP.resumo.site) || null;
    const st = (publico, abertoTxt, fechadoTxt) => (site === null ? LP.chip('carregando…', '', { semPonto: true }) : publico ? LP.chip(abertoTxt, 'alerta') : LP.chip(fechadoTxt, 'ok'));
    const conferir = LP.botao('Conferir agora', async (ev, b) => {
      LP.ocupado(b, true);
      try {
        await LP.painelGet('?so=eu');
        LP.avisar('Confirmado: este navegador está como admin. O jogo libera o Imersivo e a Live aqui.');
      } catch (e) {
        LP.avisarErro(e);
      } finally {
        LP.ocupado(b, false);
      }
    }, { tipo: 'fantasma', icone: 'check' });
    LP.trocar(raiz,
      h('p', { class: 'faixa faixa-info' }, 'Os botões abrem o jogo em outra aba. O que é só seu abre porque este navegador tem o cookie do painel (vale 12 h, só aqui). Para ver o jogo como o público vê, use uma janela anônima.'),
      h('div', { class: 'grade-testes' },
        h('section', { class: 'cartao' },
          h('h2', null, 'Modo Imersivo', st(site && site.imersivoPublico, 'Aberto a todos', 'Público: "Em desenvolvimento"')),
          h('p', { class: 'texto-2' }, 'Base de teste: jogue e teste aqui à vontade até publicar. Carreiras do Imersivo não entram no Hall público enquanto ele estiver fechado.'),
          h('div', { class: 'botoes' },
            LP.linkJogo('Nova carreira no Imersivo', '#/identidade?modo=imersivo', { tipo: 'ouro', icone: 'jogar' }),
            LP.linkJogo('Continuar a carreira', '#/imersivo', { tipo: 'fantasma' }))),
        h('section', { class: 'cartao' },
          h('h2', null, 'Live interativa (TikTok)', st(site && site.livePublica, 'Visível a todos', 'Só você vê')),
          h('p', { class: 'texto-2' }, 'Para o público ela some do menu, da tela inicial e do rodapé, e #/live mostra "Página não encontrada".'),
          h('div', { class: 'botoes' }, LP.linkJogo('Abrir a Live', '#/live', { tipo: 'ouro', icone: 'jogar' }))),
        h('section', { class: 'cartao' },
          h('h2', null, 'Outras telas'),
          h('p', { class: 'texto-2' }, 'Design kit (só admin no site) e o Hall das Lendas com as carreiras da comunidade.'),
          h('div', { class: 'botoes' },
            LP.linkJogo('Design kit', '#/kit', { tipo: 'fantasma' }),
            LP.linkJogo('Hall da comunidade', '#/hall?seg=comunidade', { tipo: 'fantasma' }),
            LP.linkJogo('Jogo (início)', '#/', { tipo: 'fantasma' }))),
        h('section', { class: 'cartao' },
          h('h2', null, 'Este navegador'),
          h('p', { class: 'texto-2' }, 'Confere com o servidor se o cookie do painel ainda vale (o jogo pergunta a mesma coisa).'),
          h('div', { class: 'botoes' }, conferir, h('a', { href: '#/config', class: 'botao-fantasma' }, 'Mudar o que é público')))));
  }
  LP.abas.testes = { titulo: 'Testes', sub: 'Só você vê: Modo Imersivo (em desenvolvimento) e Live interativa', montar: montarTestes, recarregar: () => {} };

  // ═══ Registro ════════════════════════════════════════════════════════════════════════════════
  const reg = { acao: '', alvo: '', pagina: 1, pedido: 0, corpo: null, temDados: false };

  function montarRegistro(raiz, rota) {
    reg.acao = LP.NOMES_ACAO_LOG[rota.query.acao] ? rota.query.acao : '';
    reg.alvo = (rota.query.alvo || '').slice(0, 80);
    reg.pagina = Math.max(1, parseInt(rota.query.pagina, 10) || 1);
    reg.temDados = false;
    reg.corpo = h('div');
    const alvo = h('input', { type: 'search', placeholder: 'Alvo: usuario:12, carreira:55, config, hall…', 'aria-label': 'Filtrar por alvo', 'data-busca': '1', maxlength: 80 });
    alvo.value = reg.alvo;
    const aplicar = LP.debounce(() => { reg.alvo = alvo.value.trim(); reg.pagina = 1; carregarReg(); }, 400);
    alvo.addEventListener('input', aplicar);
    LP.trocar(raiz,
      h('div', { class: 'ferramentas' },
        LP.selecao('Ação', [{ valor: '', rotulo: 'Todas' }].concat(Object.keys(LP.NOMES_ACAO_LOG).map((k) => ({ valor: k, rotulo: LP.NOMES_ACAO_LOG[k] }))), reg.acao,
          (v) => { reg.acao = v; reg.pagina = 1; carregarReg(); }),
        h('div', { class: 'busca' }, LP.icone('busca'), alvo, h('kbd', { 'aria-hidden': 'true' }, '/'))),
      reg.corpo);
    carregarReg();
  }

  async function carregarReg() {
    const n = ++reg.pedido;
    if (!LP.visivel(reg.corpo)) return;
    LP.trocarQuery('registro', { acao: reg.acao, alvo: reg.alvo, pagina: reg.pagina > 1 ? reg.pagina : '' });
    if (!reg.temDados) LP.trocar(reg.corpo, LP.estadoCarregando(6));
    else reg.corpo.classList.add('esmaecido');
    try {
      const d = await LP.adminGet('log', { acao: reg.acao, alvo: reg.alvo, pagina: reg.pagina });
      if (n !== reg.pedido || !LP.visivel(reg.corpo)) return;
      reg.temDados = true;
      desenharReg(d);
    } catch (e) {
      if (n !== reg.pedido || (e && e.status === 401) || !LP.visivel(reg.corpo)) return;
      reg.temDados = false;
      LP.trocar(reg.corpo, LP.estadoErro(e, carregarReg));
    } finally {
      if (n === reg.pedido) reg.corpo.classList.remove('esmaecido');
    }
  }

  function valorCurto(v) {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'boolean') return v ? 'sim' : 'não';
    if (typeof v === 'object') { const s = JSON.stringify(v); return s.length > 140 ? s.slice(0, 137) + '…' : s; }
    const s = String(v);
    return s.length > 140 ? s.slice(0, 137) + '…' : s;
  }
  function detalhesLog(x) {
    const d = x.detalhes && typeof x.detalhes === 'object' ? x.detalhes : {};
    const partes = [];
    Object.keys(d).forEach((k) => {
      if (k === 'via') return;
      const v = d[k];
      let txt;
      if (x.acao === 'config' && v && typeof v === 'object' && 'para' in v) txt = textoValor(k, v.de) + ' → ' + textoValor(k, v.para);
      else txt = valorCurto(v);
      partes.push(h('span', null, h('b', null, (x.acao === 'config' ? NOMES_CHAVE[k] || k : k) + ': '), txt));
    });
    const caixa = h('div', { class: 'detalhes-log' });
    partes.forEach((p, i) => { if (i) caixa.appendChild(document.createTextNode(' · ')); caixa.appendChild(p); });
    return partes.length ? caixa : '—';
  }
  function alvoLog(a) {
    const s = String(a || '');
    let m = /^usuario:(\d+)$/.exec(s);
    if (m) return h('a', { href: LP.usuarioHash(m[1]), class: 'link-discreto' }, 'usuário #' + m[1]);
    m = /^carreira:(\d+)$/.exec(s);
    if (m) { const pk = Number(m[1]); return h('button', { type: 'button', class: 'link', onclick: () => LP.abrirCarreira(pk) }, 'carreira #' + m[1]); }
    m = /^indicacao:(\d+)$/.exec(s);
    if (m) return 'indicação #' + m[1];
    return s || '—';
  }

  function desenharReg(d) {
    const itens = Array.isArray(d.itens) ? d.itens : [];
    LP.subAba(LP.inteiro(d.total || 0) + ' ações registradas' + (reg.acao || reg.alvo ? ' com esse filtro' : ''));
    if (!itens.length) {
      LP.trocar(reg.corpo, LP.estadoVazio(reg.acao || reg.alvo ? 'Nada com esse filtro' : 'Nenhuma ação ainda', 'Tudo o que você muda pelo painel (ou por script) fica anotado aqui.'));
      return;
    }
    LP.trocar(reg.corpo, LP.lista({
      itens: itens,
      colunas: [
        { rotulo: 'Quando', principal: true, celula: (x) => h('span', { title: LP.dataHoraAno(x.em) }, LP.dataHoraAno(x.em)) },
        { rotulo: 'Ação', celula: (x) => h('b', null, LP.NOMES_ACAO_LOG[x.acao] || x.acao) },
        { rotulo: 'Alvo', celula: (x) => alvoLog(x.alvo) },
        { rotulo: 'Detalhes', classe: 'quebra', celula: detalhesLog },
        { rotulo: 'Via', celula: (x) => (x.detalhes && x.detalhes.via === 'token' ? 'script' : x.detalhes && x.detalhes.via ? x.detalhes.via : '—') },
      ],
    }), LP.paginacao(d.total || 0, d.pagina || reg.pagina, d.porPagina || 50, (p) => { reg.pagina = p; carregarReg(); window.scrollTo(0, 0); }));
  }

  LP.abas.registro = { titulo: 'Registro', sub: '', montar: montarRegistro, recarregar: () => carregarReg(), focarBusca: true };
})();
