/* LENDA · painel — Conquistas (raridade de verdade), Configurações (Site: site_config; Minha conta: senha, PIN, criar a
 * conta, aparelhos; Backup: baixar, cópias no servidor e restaurar), Testes (Imersivo, Live, testers) e Saúde
 * (equipe.php?r=saude). */
'use strict';

(function () {
  const LP = window.LP;
  const { h } = LP;

  // ═══ Conquistas ══════════════════════════════════════════════════════════════════════════════
  const ORDEM_RARIDADE = { comum: 1, rara: 2, epica: 3, lendaria: 4 };
  const conq = { pedido: 0, corpo: null, tabela: null, itens: null, jogadores: 0, q: '', raridade: '', ordem: { chave: 'jogadores', dir: 'desc' } };

  // a busca, a raridade e a ordem ficam no hash (#/conquistas?q=&raridade=&ordem=&dir=): recarregar volta igual
  const ORDENS_CONQ = ['nome', 'raridade', 'jogadores', 'pct', 'primeira'];
  const dirPadrao = (k) => (k === 'nome' || k === 'primeira' ? 'asc' : 'desc');
  function lerRotaConquistas(rota) {
    const q = (rota && rota.query) || {};
    conq.q = String(q.q || '').trim().slice(0, 100);
    conq.raridade = Object.prototype.hasOwnProperty.call(LP.NOMES_RARIDADE, q.raridade) ? q.raridade : '';
    const chave = ORDENS_CONQ.includes(q.ordem) ? q.ordem : 'jogadores';
    conq.ordem = { chave: chave, dir: q.dir === 'asc' || q.dir === 'desc' ? q.dir : dirPadrao(chave) };
  }
  function gravarRotaConquistas() {
    const k = conq.ordem.chave;
    LP.trocarQuery('conquistas', { q: conq.q, raridade: conq.raridade, ordem: k === 'jogadores' ? '' : k, dir: conq.ordem.dir === dirPadrao(k) ? '' : conq.ordem.dir });
  }
  function montarConquistas(raiz, rota) {
    lerRotaConquistas(rota);
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
      LP.busca('Buscar conquista', conq.q, (v) => { conq.q = v; gravarRotaConquistas(); desenharTabelaConquistas(); }, { min: 1 }),
      LP.selecao('Raridade no jogo', [{ valor: '', rotulo: 'Todas' }].concat(Object.keys(LP.NOMES_RARIDADE).map((k) => ({ valor: k, rotulo: LP.NOMES_RARIDADE[k] }))), conq.raridade,
        (v) => { conq.raridade = v; gravarRotaConquistas(); desenharTabelaConquistas(); }));
    LP.trocar(conq.corpo, ladrilhos, h('section', { class: 'cartao' },
      h('div', { class: 'cartao-cabeca' }, h('h2', null, 'Raridade de verdade'), h('span', { class: 'texto-3' }, 'quantos jogadores têm cada conquista · a raridade pública (no jogo) é recalculada a cada 1 h')),
      ferramentas, conq.tabela));
    desenharTabelaConquistas();
  }
  function desenharTabelaConquistas() {
    const q = conq.q.toLowerCase();
    let itens = (conq.itens || []).filter((x) => (!conq.raridade || x.raridade === conq.raridade) &&
      (!q || x.nome.toLowerCase().includes(q) || x.id.toLowerCase().includes(q) || x.descricao.toLowerCase().includes(q)));
    const { chave, dir } = conq.ordem;
    const val = (x) => (chave === 'nome' ? x.nome.toLowerCase() : chave === 'raridade' ? ORDEM_RARIDADE[x.raridade] || 0 : chave === 'primeira' ? x.primeiraEm || '9999' : x.jogadores);
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
        conq.ordem = { chave: k, dir: conq.ordem.chave === k ? (conq.ordem.dir === 'asc' ? 'desc' : 'asc') : dirPadrao(k) };
        gravarRotaConquistas();
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
  LP.abas.conquistas = { titulo: 'Conquistas', sub: '', montar: montarConquistas, recarregar: () => carregarConquistas() };

  // ═══ Configurações ═══════════════════════════════════════════════════════════════════════════
  const CHAVES = ['manutencao', 'cadastro_aberto', 'imersivo_publico', 'live_publica', 'aviso', 'avisos', 'regras', 'bonus', 'hall_intervalo_min', 'hall_revisao_nota', 'aviso_celular', 'partidas_dia_max'];
  const NOMES_CHAVE = {
    manutencao: 'Manutenção', cadastro_aberto: 'Cadastro aberto', imersivo_publico: 'Modo Imersivo público', live_publica: 'Live pública',
    aviso: 'Aviso no topo', avisos: 'Avisos no jogo', regras: 'Convite de conta', bonus: 'Bônus de OVR', hall_intervalo_min: 'Intervalo do Hall',
    hall_revisao_nota: 'Revisão do Hall', aviso_celular: 'Aviso no celular', partidas_dia_max: 'Partidas por dia',
  };
  const PARTES_CFG = [['site', 'Site'], ['conta', 'Minha conta'], ['backup', 'Backup']];
  const cfg = { parte: 'site', valores: null, padroes: {}, atualizados: {}, celular: {}, form: null, raiz: null, corpo: null, barra: null, erros: {}, itens: {}, rascunhoAviso: '', pedido: 0 };
  const copia = (x) => JSON.parse(JSON.stringify(x === undefined ? null : x));
  const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  function montarConfig(raiz, rota) {
    cfg.raiz = raiz;
    cfg.parte = PARTES_CFG.some((p) => p[0] === rota.query.parte) ? rota.query.parte : 'site';
    cfg.valores = null;
    cfg.corpo = h('div');
    const chips = h('div', { class: 'filtros-chips partes', role: 'group', 'aria-label': 'Partes das configurações' }, PARTES_CFG.map(([k, t]) => {
      const trancada = k === 'backup' && !LP.pode('sistema');
      const b = h('button', { type: 'button', class: 'chip-filtro', 'aria-pressed': String(k === cfg.parte), disabled: trancada, title: trancada ? 'O seu papel não abre o backup' : null }, t);
      b.addEventListener('click', () => { location.hash = LP.hash('config', k === 'site' ? {} : { parte: k }); });
      return b;
    }));
    LP.trocar(raiz, chips, cfg.corpo);
    if (cfg.parte === 'conta') montarMinhaConta();
    else if (cfg.parte === 'backup') montarBackup();
    else { LP.trocar(cfg.corpo, LP.estadoCarregando(8)); carregarConfig(); }
  }

  async function carregarConfig() {
    const n = ++cfg.pedido;
    try {
      const d = await LP.adminGet('config');
      if (n !== cfg.pedido || !LP.visivel(cfg.corpo)) return;
      cfg.valores = d.valores || {};
      cfg.padroes = d.padroes || {};
      cfg.atualizados = d.atualizados || {};
      cfg.celular = d.celular || {};
      cfg.form = copia(cfg.valores);
      if (!Array.isArray(cfg.form.avisos)) cfg.form.avisos = [];
      if (!cfg.form.aviso_celular) cfg.form.aviso_celular = { denuncia: false, picoOnline: 0 };
      cfg.rascunhoAviso = cfg.form.aviso ? cfg.form.aviso.texto : '';
      desenharConfig();
    } catch (e) {
      if (n !== cfg.pedido || (e && e.status === 401)) return;
      LP.trocar(cfg.corpo, LP.estadoErro(e, carregarConfig));
    }
  }

  function mudadas() {
    if (!cfg.valores || !cfg.form) return [];
    return CHAVES.filter((k) => k in cfg.valores && !igual(cfg.form[k], cfg.valores[k]));
  }
  LP.configSujo = () => cfg.parte === 'site' && mudadas().length > 0;

  function meta(chave) {
    const a = cfg.atualizados[chave];
    const partes = [];
    if (a && a.em) partes.push('alterado ' + LP.relativo(a.em) + (a.porNome || a.por ? ' por ' + (a.por === 'token' ? 'script' : a.porNome || a.por) : ''));
    if (chave in cfg.padroes) partes.push('padrão: ' + textoValor(chave, cfg.padroes[chave]));
    return h('p', { class: 'config-meta' }, partes.join(' · '));
  }
  function textoValor(chave, v) {
    if (v === null || v === undefined) return chave === 'aviso' ? 'sem aviso' : '—';
    if (typeof v === 'boolean') return v ? 'ligado' : 'desligado';
    if (chave === 'hall_intervalo_min') return LP.minutos(v);
    if (chave === 'hall_revisao_nota') return v >= 101 ? 'desligada' : 'nota ' + v + ' ou mais';
    if (chave === 'regras') return 'após ' + v.aposPartidas + ', lembra a cada ' + v.lembrarACada + (v.obrigatorio ? ', obrigatório' : '');
    if (chave === 'bonus') return (v.indicacao || []).map((x) => '+' + x).join('/') + ' por amigo (até ' + v.maxIndicacoes + '), +' + v.compartilhar + ' ao compartilhar, libera após ' + v.liberaAposPartidas;
    if (chave === 'aviso') return '"' + v.texto + '" (' + v.tipo + ')';
    if (chave === 'avisos') return Array.isArray(v) && v.length ? LP.plural(v.length, 'aviso', 'avisos') : 'nenhum';
    if (chave === 'aviso_celular') return (v.denuncia ? 'denúncia nova' : 'sem denúncia') + ' · ' + (v.picoOnline ? 'pico de ' + v.picoOnline + ' online' : 'sem pico');
    if (chave === 'partidas_dia_max') return LP.plural(v, 'partida', 'partidas') + ' por dia';
    return String(v);
  }

  function itemInterruptor(chave, rotulo, ajuda, opcoes) {
    const o = opcoes || {};
    const ler = o.ler || (() => !!cfg.form[chave]);
    const gravar = o.gravar || ((v) => { cfg.form[chave] = v; });
    const entrada = h('input', { type: 'checkbox', role: 'switch', checked: ler(), 'aria-label': rotulo, disabled: !LP.pode('config') });
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
  function campoNumero(caminho, rotulo, min, max, unidade, aoMudar) {
    const [k, sub, idx] = caminho.split('.');
    const ler = () => (sub === undefined ? cfg.form[k] : idx !== undefined ? cfg.form[k][sub][Number(idx)] : cfg.form[k][sub]);
    const gravar = (v) => {
      if (sub === undefined) cfg.form[k] = v;
      else if (idx !== undefined) cfg.form[k][sub][Number(idx)] = v;
      else cfg.form[k][sub] = v;
    };
    const id = 'cfg-' + caminho.replace(/\./g, '-');
    const entrada = h('input', { type: 'number', id: id, min: min, max: max, step: 1, inputmode: 'numeric', 'data-caminho': caminho, disabled: !LP.pode('config') });
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

  /** "2026-12-31T02:59:59Z" → "2026-12-31" (o dia em Brasília), para o campo de data. */
  const diaDeIso = (iso) => (iso ? new Date(Date.parse(iso) - LP.FUSO_MS).toISOString().slice(0, 10) : '');

  function desenharConfig() {
    cfg.erros = {};
    cfg.itens = {};
    const f = cfg.form;
    LP.subAba('Vale para quem abrir ou recarregar o jogo (cache de até 10 s no servidor).' + (LP.pode('config') ? '' : ' O seu papel só vê.'));

    const site = cartao('Site', 'para todo mundo', [
      itemInterruptor('manutencao', 'Em manutenção', 'Quem não é da equipe vê a tela "Em manutenção" e não joga; a equipe continua jogando. Uma carreira terminando agora continua sendo salva.', { perigo: true }),
      itemInterruptor('cadastro_aberto', 'Cadastro aberto', 'Desligado: some o "Criar conta" e o convite das 5 partidas não abre. Quem já tem conta continua entrando.'),
    ]);
    const admin = cartao('Em teste (só a equipe)', 'deixe desligado até publicar', [
      itemInterruptor('imersivo_publico', 'Modo Imersivo aberto a todos', 'Desligado: o público vê "Em desenvolvimento" e só a equipe e os testers jogam (aba Testes). Carreiras do Imersivo não entram no Hall público enquanto estiver desligado.', { perigo: true }),
      itemInterruptor('live_publica', 'Live interativa visível a todos', 'Desligado: a Live some do menu, da tela inicial e do rodapé, e #/live dá "Página não encontrada" para quem não é da equipe.', { perigo: true }),
    ]);

    // aviso único
    const ligado = h('input', { type: 'checkbox', role: 'switch', checked: !!f.aviso, 'aria-label': 'Mostrar aviso', disabled: !LP.pode('config') });
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
      h('span', { class: 'rotulo' }, 'Prévia (faixa no topo do jogo; o jogador fecha no ×)'), previa]);
    const itemAviso = h('div', { class: 'config-item coluna', 'data-chave': 'aviso' },
      h('div', { class: 'cartao-cabeca' }, h('div', null, h('span', { class: 'rotulo-item' }, 'Mostrar um aviso no topo do jogo'), meta('aviso')),
        h('label', { class: 'interruptor' }, ligado, h('span', { class: 'trilho', 'aria-hidden': 'true' }), txtLigado)),
      corpoAviso, erroDe('aviso'));
    cfg.itens.aviso = itemAviso;

    // N14: vários avisos com público e validade
    const listaAvisos = h('div', { class: 'campo' });
    const desenharAvisos = () => {
      const agora = new Date().toISOString();
      LP.trocar(listaAvisos, f.avisos.map((a, i) => {
        const t = h('textarea', { maxlength: 200, rows: 2, 'aria-label': 'Texto do aviso ' + (i + 1) });
        t.value = a.texto || '';
        t.addEventListener('input', () => { a.texto = t.value; atualizarBarra(); });
        const tipo = h('select', { 'aria-label': 'Tipo do aviso ' + (i + 1) }, ['info', 'alerta'].map((v) => h('option', { value: v, selected: a.tipo === v }, v === 'info' ? 'Informação' : 'Alerta')));
        tipo.addEventListener('change', () => { a.tipo = tipo.value; atualizarBarra(); });
        const pub = h('select', { 'aria-label': 'Público do aviso ' + (i + 1) }, [['todos', 'Todo mundo'], ['logados', 'Só quem tem conta'], ['visitantes', 'Só visitantes']].map(([v, r]) => h('option', { value: v, selected: (a.publico || 'todos') === v }, r)));
        pub.addEventListener('change', () => { a.publico = pub.value; atualizarBarra(); });
        const ate = h('input', { type: 'date', 'aria-label': 'Vale até (aviso ' + (i + 1) + ')' });
        ate.value = /^\d{4}-\d{2}-\d{2}$/.test(a.ate || '') ? a.ate : diaDeIso(a.ate);
        ate.addEventListener('change', () => { a.ate = ate.value || null; atualizarBarra(); });
        const venceu = a.ate && String(a.ate).length > 10 && a.ate < agora;
        return h('div', { class: 'aviso-item' + (venceu ? ' venceu' : '') },
          h('div', { class: 'cartao-cabeca' }, h('b', null, 'Aviso ' + (i + 1), venceu ? LP.chip('venceu', '', { semPonto: true }) : null),
            LP.botao('Apagar', () => { f.avisos.splice(i, 1); desenharAvisos(); atualizarBarra(); }, { tipo: 'perigo', pequeno: true, icone: 'lixo', disabled: !LP.pode('config') })),
          t, h('div', { class: 'campo-linha' }, h('label', { class: 'campo' }, h('span', { class: 'rotulo' }, 'Tipo'), tipo), h('label', { class: 'campo' }, h('span', { class: 'rotulo' }, 'Para quem'), pub),
            h('label', { class: 'campo' }, h('span', { class: 'rotulo' }, 'Vale até (vazio = sem fim)'), ate)));
      }), f.avisos.length < 5 && LP.pode('config') ? LP.botao('Acrescentar aviso', () => { f.avisos.push({ texto: '', tipo: 'info', publico: 'todos', ate: null }); desenharAvisos(); atualizarBarra(); }, { tipo: 'fantasma', pequeno: true, icone: 'mais' }) : null);
    };
    desenharAvisos();
    const itemAvisos = h('div', { class: 'config-item coluna', 'data-chave': 'avisos' },
      h('div', null, h('span', { class: 'rotulo-item' }, 'Avisos com público e validade (até 5)'), meta('avisos')),
      h('p', { class: 'ajuda' }, 'Aparecem no jogo além do aviso do topo, só para o público escolhido e até o fim do dia marcado (Brasília).'),
      listaAvisos, erroDe('avisos'));
    cfg.itens.avisos = itemAvisos;
    const aviso = cartao('Avisos no jogo', 'faixas para os jogadores (nunca na live)', [itemAviso, itemAvisos], true);
    sincronizarAviso();

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

    const caixaInd = h('div', { class: 'trio' });
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
      h('p', { class: 'ajuda' }, 'O combinado: de 3 a 5 partidas depois de criar a conta. Antes disso, indicação validada fica guardada e compartilhar não dá bônus. Bônus que a equipe der vale na hora.'),
      erroDe('bonus'));
    cfg.itens.bonus = itemBonus;
    const bonus = cartao('Bônus de OVR', '+N de OVR na próxima carreira do Clássico', [itemBonus]);

    // Hall: intervalo e revisão (X1)
    const faixa = h('input', { type: 'range', min: 60, max: 180, step: 5, 'aria-label': 'Intervalo do Hall em minutos', disabled: !LP.pode('config') });
    faixa.value = String(f.hall_intervalo_min);
    const txtHall = h('span', { class: 'texto-2' });
    const textoIntervalo = () => (Number.isInteger(cfg.form.hall_intervalo_min) ? 'a cada ' + LP.minutos(cfg.form.hall_intervalo_min) : '');
    const numeroHall = campoNumero('hall_intervalo_min', 'Minutos', 60, 180, 'min', () => {
      if (Number.isInteger(cfg.form.hall_intervalo_min)) faixa.value = String(cfg.form.hall_intervalo_min);
      txtHall.textContent = textoIntervalo();
    });
    txtHall.textContent = textoIntervalo();
    faixa.addEventListener('input', () => {
      cfg.form.hall_intervalo_min = Number(faixa.value);
      numeroHall.querySelector('input').value = faixa.value;
      txtHall.textContent = textoIntervalo();
      atualizarBarra();
    });
    const presets = h('div', { class: 'atalhos-dias' }, [60, 90, 120, 180].map((m) => LP.botao(LP.minutos(m), () => {
      cfg.form.hall_intervalo_min = m;
      faixa.value = String(m);
      numeroHall.querySelector('input').value = String(m);
      txtHall.textContent = textoIntervalo();
      atualizarBarra();
    }, { tipo: 'fantasma', pequeno: true, disabled: !LP.pode('config') })));
    const itemHall = h('div', { class: 'config-item coluna', 'data-chave': 'hall_intervalo_min' },
      h('div', null, h('span', { class: 'rotulo-item' }, 'Recalcular o Hall público'), meta('hall_intervalo_min')),
      h('div', { class: 'faixa-range' }, faixa, txtHall), presets, numeroHall,
      h('p', { class: 'ajuda' }, 'De 1 h a 3 h. O Hall das Lendas é refeito no primeiro acesso depois desse prazo. Para refazer agora: Hall público → Atualizar Hall agora.'));
    cfg.itens.hall_intervalo_min = itemHall;
    const txtRev = h('p', { class: 'texto-2' });
    const textoRev = () => { const v = cfg.form.hall_revisao_nota; txtRev.textContent = !Number.isInteger(v) ? '' : v >= 101 ? 'Revisão desligada: toda carreira plausível entra direto.' : 'Carreiras com nota ' + v + ' ou mais esperam a conferência (Hall público → Em revisão).'; };
    const numeroRev = campoNumero('hall_revisao_nota', 'Nota a partir da qual a carreira espera revisão', 50, 101, '(101 desliga)', textoRev);
    textoRev();
    const itemRev = h('div', { class: 'config-item coluna', 'data-chave': 'hall_revisao_nota' },
      h('div', null, h('span', { class: 'rotulo-item' }, 'Revisão antes do Hall'), meta('hall_revisao_nota')),
      numeroRev, txtRev,
      h('p', { class: 'ajuda' }, 'Vale para as carreiras salvas daqui em diante. O padrão vem do arquivo de config (hall_revisao_nota).'));
    cfg.itens.hall_revisao_nota = itemRev;
    const hall = cartao('Hall público', 'até 3 carreiras por conta', [itemHall, itemRev]);

    // O6: aviso no celular
    const cel = cfg.celular || {};
    const canais = [cel.ntfy ? 'ntfy' : null, cel.telegram ? 'Telegram' : null].filter(Boolean);
    const itemCel = h('div', { class: 'config-item coluna', 'data-chave': 'aviso_celular' },
      h('div', null, h('span', { class: 'rotulo-item' }, 'Aviso no celular'), meta('aviso_celular')),
      h('p', { class: 'ajuda' }, canais.length ? 'Canais configurados no arquivo de config: ' + canais.join(' e ') + '.' : 'Nenhum canal configurado: ponha aviso_ntfy ou aviso_telegram no arquivo de config (LEIAME §2).'),
      itemInterruptor('aviso_celular', 'Avisar quando chega denúncia nova', 'No máximo 1 aviso a cada 10 min (a que esconde uma carreira por 5 denúncias sempre avisa).',
        { semMeta: true, ler: () => !!cfg.form.aviso_celular.denuncia, gravar: (v) => { cfg.form.aviso_celular.denuncia = v; } }),
      campoNumero('aviso_celular.picoOnline', 'Avisar quando houver mais de (0 desliga)', 0, 100000, 'pessoas online'),
      h('div', { class: 'botoes' }, LP.botao('Testar aviso', async () => {
        try {
          const r = await LP.adminPost({ acao: 'testar_aviso' });
          LP.avisar(r.enviado ? 'Aviso de teste mandado. Confira o celular.' : 'O aviso de teste não saiu: confira o canal no arquivo de config.', r.enviado ? 'ok' : 'erro');
        } catch (e) { LP.avisarErro(e); }
      }, { tipo: 'fantasma', pequeno: true, icone: 'sino', gerundio: 'Mandando…', disabled: !canais.length || !LP.pode('config') })),
      erroDe('aviso_celular'));
    cfg.itens.aviso_celular = itemCel;
    const celular = cartao('Aviso no celular', 'ntfy ou Telegram', [itemCel]);

    // v3.3: limite de partidas por dia que contam na conta (e para os desafios); só com o servidor da v3.3
    let partidasDia = null;
    if ('partidas_dia_max' in cfg.valores) {
      const txtLimite = h('p', { class: 'texto-2' });
      const textoLimite = () => {
        const v = cfg.form.partidas_dia_max;
        txtLimite.textContent = Number.isInteger(v) && v >= 10 ? 'Cada conta soma até ' + LP.plural(v, 'partida', 'partidas') + ' por dia (Brasília) em "partidas com a conta"; as de depois não somam, e carreira salva num dia em que a conta passou do limite não vale para desafio.' : '';
      };
      const itemLimite = h('div', { class: 'config-item coluna', 'data-chave': 'partidas_dia_max' },
        h('div', null, h('span', { class: 'rotulo-item' }, 'Partidas por dia que contam na conta'), meta('partidas_dia_max')),
        campoNumero('partidas_dia_max', 'Limite por conta e por dia', 10, 10000, 'partidas', textoLimite), txtLimite,
        h('p', { class: 'ajuda' }, 'Um freio contra robô e contra jogar sem parar para cumprir os requisitos dos desafios. O resto da medição (visitas, tempo de jogo) segue igual.'),
        h('p', null, h('a', { href: '#/desafios', class: 'botao-fantasma botao-pequeno' }, 'Ver os desafios')));
      cfg.itens.partidas_dia_max = itemLimite;
      textoLimite();
      partidasDia = cartao('Desafios', 'partidas por dia', [itemLimite]);
    }

    cfg.barra = h('div', { class: 'barra-salvar', hidden: true, role: 'region', 'aria-label': 'Alterações não salvas' },
      h('span', { class: 'texto-2', id: 'cfg-resumo' }),
      h('div', { class: 'botoes' },
        LP.botao('Descartar', descartar, { tipo: 'fantasma' }),
        LP.botao('Salvar', salvar, { tipo: 'ouro', icone: 'check' })));

    LP.trocar(cfg.corpo, h('div', { class: 'config-grade' }, site, admin, aviso, regras, bonus, hall, partidasDia, celular), cfg.barra);
    atualizarBarra();
  }

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
    if ('hall_revisao_nota' in cfg.valores && !int(f.hall_revisao_nota, 50, 101)) e.hall_revisao_nota = 'De 50 a 100 (101 desliga a revisão).';
    if (f.aviso && (!f.aviso.texto || f.aviso.texto.length > 200)) e.aviso = 'Escreva o texto do aviso (1 a 200 caracteres) ou desligue o aviso.';
    if (Array.isArray(f.avisos) && f.avisos.some((a) => !String(a.texto || '').trim() || String(a.texto).length > 200)) e.avisos = 'Cada aviso precisa de um texto de 1 a 200 caracteres (ou apague o vazio).';
    if (f.aviso_celular && !int(f.aviso_celular.picoOnline, 0, 100000)) e['aviso_celular.picoOnline'] = 'De 0 (desligado) a 100.000.';
    if ('partidas_dia_max' in cfg.valores && !int(f.partidas_dia_max, 10, 10000)) e.partidas_dia_max = 'De 10 a 10.000 partidas.';
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
    document.body.classList.toggle('com-barra', m.length > 0);
    const t = document.getElementById('cfg-resumo');
    if (t) t.textContent = m.length ? LP.plural(m.length, 'alteração não salva', 'alterações não salvas') + ': ' + m.map((k) => NOMES_CHAVE[k]).join(', ') : '';
  }
  function descartar() {
    cfg.form = copia(cfg.valores);
    if (!Array.isArray(cfg.form.avisos)) cfg.form.avisos = [];
    if (!cfg.form.aviso_celular) cfg.form.aviso_celular = { denuncia: false, picoOnline: 0 };
    cfg.rascunhoAviso = cfg.form.aviso ? cfg.form.aviso.texto : '';
    desenharConfig();
  }
  async function salvar() {
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
    if (!v.manutencao && f.manutencao) riscos.push('Ligar a manutenção: quem não é da equipe vê "Em manutenção" e não joga.');
    if (v.cadastro_aberto && !f.cadastro_aberto) riscos.push('Fechar novos cadastros (quem tem conta continua entrando).');
    if (!v.imersivo_publico && f.imersivo_publico) riscos.push('Abrir o Modo Imersivo para todo mundo (hoje ele é "Em desenvolvimento").');
    if (!v.live_publica && f.live_publica) riscos.push('Mostrar a Live interativa para todo mundo (hoje só a equipe vê).');
    if (m.includes('hall_revisao_nota') && f.hall_revisao_nota >= 101) riscos.push('Desligar a revisão: carreiras com nota altíssima entram direto no Hall.');
    if (m.includes('partidas_dia_max') && f.partidas_dia_max < v.partidas_dia_max) riscos.push('Baixar o limite de partidas por dia: quem passar do novo limite hoje deixa de somar partidas e as carreiras salvas hoje por essas contas ficam fora dos desafios.');
    const linhas = h('ul', { class: 'texto-2' }, m.map((k) => h('li', null, h('b', null, NOMES_CHAVE[k] + ': '), textoValor(k, v[k]) + ' → ' + textoValor(k, f[k]))));
    const r = await LP.dialogo({
      titulo: riscos.length ? 'Atenção: mudanças que todo mundo vê' : 'Salvar ' + LP.plural(m.length, 'alteração', 'alterações') + '?',
      perigo: riscos.length > 0,
      botao: 'Salvar',
      gerundio: 'Salvando…',
      texto: riscos.length ? riscos.map((x) => h('p', { class: 'faixa faixa-alerta' }, x)) : [],
      corpo: linhas,
      executar: () => {
        const valores = {};
        m.forEach((k) => {
          valores[k] = k === 'avisos' ? f[k].map((a) => ({ texto: String(a.texto || '').trim(), tipo: a.tipo, publico: a.publico || 'todos', ate: a.ate || null })) : f[k];
        });
        return LP.adminPost({ acao: 'config', valores: valores });
      },
    });
    if (!r) return;
    LP.avisar('Configurações salvas. Vale para quem abrir ou recarregar o jogo.');
    const agora = new Date().toISOString();
    m.forEach((k) => { cfg.atualizados[k] = { em: agora, porNome: (LP.sessao && LP.sessao.quem && LP.sessao.quem.nome) || 'você' }; });
    cfg.valores = r.valores && typeof r.valores === 'object' ? r.valores : Object.assign({}, cfg.valores, copia(f));
    cfg.form = copia(cfg.valores);
    if (!Array.isArray(cfg.form.avisos)) cfg.form.avisos = [];
    if (!cfg.form.aviso_celular) cfg.form.aviso_celular = { denuncia: false, picoOnline: 0 };
    cfg.rascunhoAviso = cfg.form.aviso ? cfg.form.aviso.texto : cfg.rascunhoAviso;
    desenharConfig();
    LP.depoisDeAgir();
  }

  // ── Minha conta (P1-1, P1-2) ──
  async function montarMinhaConta() {
    LP.trocar(cfg.corpo, LP.estadoCarregando(5));
    const s = (await LP.recarregarSessao()) || LP.sessao;
    if (!LP.visivel(cfg.corpo)) return;
    if (!s || s.etapa !== 'pronto') { LP.trocar(cfg.corpo, LP.estadoErro(new LP.ErroApi(0, 'rede', 'Não deu para ler a sua sessão.'), montarMinhaConta)); return; }
    const q = s.quem || {};
    const av = s.avisos || [];
    LP.subAba('A sua entrada no painel: senha, PIN e os aparelhos com o painel aberto.');
    const cards = [];
    cards.push(cartao('Quem é você aqui', '', h('dl', { class: 'perfil-dados' },
      LP.dado('Nome', q.nome), LP.dado('E-mail', q.email ? LP.email(q.email) : '—'), LP.dado('Papel', q.papelNome || q.papel),
      LP.dado('PIN', q.temPin ? 'cadastrado' : 'sem PIN'), LP.dado('Sessão vence', s.expiraEm ? LP.dataHoraAno(s.expiraEm) : '—'),
      LP.dado('Poderes', (s.poderes || []).map((p) => LP.NOMES_PODER[p] || p).join(', ')))));
    if (q.daConfig) {
      cards.push(cartao('Conta Dono de emergência', 'senha do arquivo de config', [
        h('p', { class: 'texto-2' }, 'Você entrou com a senha do arquivo de config. Ela continua valendo para emergência (sem e-mail na entrada). Para trocá-la, gere um hash novo (LEIAME §2): pelo painel não dá.'),
        !q.temPin ? formCriarPin() : h('p', { class: 'faixa faixa-ok' }, 'PIN cadastrado: toda entrada com a senha do arquivo pede o PIN.'),
        av.includes('crie_conta') ? formCriarConta() : null]));
    } else if (q.id) {
      cards.push(cartao('Trocar a minha senha', '12 caracteres ou mais', formTrocarSenha()));
    }
    cards.push(cartaoAparelhos(s));
    LP.trocar(cfg.corpo, h('div', { class: 'config-grade' }, cards));
  }
  function campoSenha(id, rotulo, auto) {
    const i = h('input', { id: id, type: 'password', autocomplete: auto || 'new-password', maxlength: 256 });
    return { entrada: i, no: h('div', { class: 'campo' }, h('label', { class: 'rotulo', for: id }, rotulo), h('div', { class: 'senha-linha' }, i, LP.botaoMostrarSenha(i))) };
  }
  function formTrocarSenha() {
    const atual = campoSenha('ms-atual', 'Senha atual', 'current-password');
    const nova = campoSenha('ms-nova', 'Senha nova');
    const rep = campoSenha('ms-rep', 'Repita a senha nova');
    const forca = h('div', { class: 'forca', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'));
    const dica = h('p', { class: 'ajuda' }, 'Dica: uma frase com espaços é forte e fácil de lembrar. As outras sessões caem quando você troca.');
    nova.entrada.addEventListener('input', () => { forca.className = 'forca n' + LP.forcaSenha(nova.entrada.value); });
    const erro = h('p', { class: 'erro', role: 'alert', hidden: true });
    const enviar = LP.botao('Trocar senha', async () => {
      erro.hidden = true;
      if (nova.entrada.value.length < 12) { erro.hidden = false; erro.textContent = 'A senha nova precisa de 12 caracteres ou mais.'; return; }
      if (nova.entrada.value !== rep.entrada.value) { erro.hidden = false; erro.textContent = 'As duas senhas novas não são iguais.'; return; }
      try {
        const r = await LP.painelPost({ acao: 'minha_senha', atual: atual.entrada.value, nova: nova.entrada.value });
        LP.avisar('Senha trocada · ' + LP.plural(r.sessoesEncerradas || 0, 'outra sessão encerrada', 'outras sessões encerradas') + '.');
        [atual, nova, rep].forEach((c) => { c.entrada.value = ''; });
        montarMinhaConta();
      } catch (e) {
        if (e && e.status === 401 && e.codigo !== 'credenciais') return;
        erro.hidden = false;
        erro.textContent = LP.mensagem(e);
      }
    }, { tipo: 'ouro', gerundio: 'Trocando…' });
    const form = h('form', { class: 'campo', novalidate: true }, h('input', { type: 'text', autocomplete: 'username', class: 'fora-da-tela', 'aria-hidden': 'true', tabindex: '-1', value: (LP.sessao && LP.sessao.quem && LP.sessao.quem.email) || '' }),
      atual.no, nova.no, forca, rep.no, dica, erro, h('div', { class: 'botoes' }, enviar));
    form.addEventListener('submit', (ev) => { ev.preventDefault(); enviar.click(); });
    return form;
  }
  function formCriarPin() {
    const senha = campoSenha('cp-senha', 'Senha do arquivo de config (de novo, por segurança)', 'current-password');
    const pin = h('input', { type: 'password', inputmode: 'numeric', maxlength: 6, autocomplete: 'off', id: 'cp-pin', pattern: '[0-9]*' });
    const rep = h('input', { type: 'password', inputmode: 'numeric', maxlength: 6, autocomplete: 'off', id: 'cp-rep', pattern: '[0-9]*' });
    const erro = h('p', { class: 'erro', role: 'alert', hidden: true });
    const enviar = LP.botao('Criar PIN', async () => {
      erro.hidden = true;
      try {
        await LP.painelPost({ acao: 'criar_pin', pin: pin.value, repetir: rep.value, senha: senha.entrada.value });
        LP.avisar('PIN criado. A partir de agora, a entrada com a senha do arquivo pede o PIN.');
        await LP.recarregarSessao();
        montarMinhaConta();
      } catch (e) {
        if (e && e.status === 401 && e.codigo !== 'credenciais') return;
        erro.hidden = false;
        erro.textContent = LP.mensagem(e);
      }
    }, { tipo: 'ouro', gerundio: 'Criando…' });
    return h('div', { class: 'campo' }, h('h3', null, 'Criar PIN'),
      h('p', { class: 'faixa faixa-ouro' }, 'Cadastre o seu PIN: com ele, quem copiar a senha do arquivo não entra.'),
      senha.no,
      h('div', { class: 'campo-linha' }, h('div', { class: 'campo' }, h('label', { class: 'rotulo', for: 'cp-pin' }, 'PIN (6 números)'), pin), h('div', { class: 'campo' }, h('label', { class: 'rotulo', for: 'cp-rep' }, 'Repita o PIN'), rep)),
      h('p', { class: 'ajuda' }, 'Não use sequência (123456) nem número repetido (111111).'), erro, h('div', { class: 'botoes' }, enviar));
  }
  function formCriarConta() {
    const nome = h('input', { type: 'text', id: 'cc-nome', maxlength: 60, autocomplete: 'name' });
    const email = h('input', { type: 'email', id: 'cc-email', maxlength: 190, autocomplete: 'email' });
    const senha = campoSenha('cc-senha', 'Senha (12+ caracteres)');
    const rep = campoSenha('cc-rep', 'Repita a senha');
    const erro = h('p', { class: 'erro', role: 'alert', hidden: true });
    const enviar = LP.botao('Criar a minha conta', async () => {
      erro.hidden = true;
      if (senha.entrada.value !== rep.entrada.value) { erro.hidden = false; erro.textContent = 'As duas senhas não são iguais.'; return; }
      try {
        await LP.painelPost({ acao: 'criar_conta', nome: nome.value.trim(), email: email.value.trim(), senha: senha.entrada.value });
        LP.avisar('Conta criada. Entre com o seu e-mail e a senha nova: o painel pede para criar o PIN.');
        setTimeout(() => location.reload(), 1600);
      } catch (e) {
        erro.hidden = false;
        erro.textContent = LP.mensagem(e);
      }
    }, { tipo: 'ouro', gerundio: 'Criando…' });
    return h('div', { class: 'campo' }, h('h3', null, 'Criar a minha conta'),
      h('p', { class: 'texto-2' }, 'Uma conta com o seu e-mail, a sua senha e um PIN: o registro passa a mostrar o seu nome, e você troca a senha pelo painel. A senha do arquivo continua valendo para emergência.'),
      h('div', { class: 'campo' }, h('label', { class: 'rotulo', for: 'cc-nome' }, 'Nome'), nome),
      h('div', { class: 'campo' }, h('label', { class: 'rotulo', for: 'cc-email' }, 'E-mail'), email),
      senha.no, rep.no, erro, h('div', { class: 'botoes' }, enviar));
  }
  function cartaoAparelhos(s) {
    const sess = Array.isArray(s.sessoes) ? s.sessoes : [];
    const outras = sess.filter((x) => !x.atual).length;
    return cartao('Aparelhos com o painel aberto', LP.plural(sess.length, 'sessão', 'sessões'), [
      sess.length ? LP.lista({
        itens: sess,
        colunas: [
          { rotulo: 'Aparelho', principal: true, celula: (x) => h('span', { class: 'chips' }, LP.aparelho(x.aparelho), x.atual ? LP.chip('este', 'ouro', { semPonto: true }) : null) },
          { rotulo: 'Entrou', celula: (x) => LP.quando(x.criadaEm) },
          { rotulo: 'Visto', celula: (x) => LP.quando(x.vistoEm) },
          { rotulo: 'Ações', acoes: true, celula: (x) => (x.atual ? null : LP.botao('Encerrar', async () => {
            try { await LP.equipePost({ acao: 'sessao_encerrar', sessao: x.id }); LP.avisar('Sessão encerrada.'); montarMinhaConta(); } catch (e) { LP.avisarErro(e); }
          }, { tipo: 'fantasma', pequeno: true, icone: 'sair', gerundio: 'Encerrando…' })) },
        ],
      }) : h('p', { class: 'texto-3' }, 'Só este aparelho.'),
      h('div', { class: 'botoes' }, LP.botao('Sair de todos os outros', async () => {
        if (!LP.confirmar('Sair do painel em todos os outros aparelhos?')) return;
        try {
          const r = await LP.painelPost({ acao: 'sair_todos' });
          LP.avisar(LP.plural(r.encerradas || 0, 'sessão encerrada', 'sessões encerradas') + '.');
          montarMinhaConta();
        } catch (e) { LP.avisarErro(e); }
      }, { tipo: 'fantasma', icone: 'sair', gerundio: 'Saindo…', disabled: !outras })),
    ]);
  }

  // ── Backup (P1-15, O3, O4) ──
  async function montarBackup() {
    LP.subAba('Baixe uma cópia antes de qualquer atualização. O arquivo tem e-mails dos jogadores: guarde fora do servidor e não compartilhe.');
    const medicao = h('input', { type: 'checkbox' });
    const baixar = LP.botao('Baixar backup', async () => {
      try {
        await LP.baixarDoServidor(LP.urlEquipe('backup', { medicao: medicao.checked ? 1 : '' }));
        LP.avisar('O backup (.json.gz) está baixando. Fica anotado no Registro.', 'info');
        setTimeout(montarBackup, 2500);
      } catch (e) { LP.avisarErro(e); }
    }, { tipo: 'ouro', icone: 'baixar', gerundio: 'Preparando…' });
    const ultimo = h('p', { class: 'texto-2' }, 'Último backup: conferindo…');
    const entra = h('table', { class: 'tabela-entra' }, h('tbody', null,
      h('tr', null, h('th', null, 'Entra'), h('td', null, 'contas, carreiras (com os dados), conquistas, indicações, bônus, denúncias, decisões da moderação, a config do site, a lixeira (sem a cópia), 90 dias do registro, a equipe (sem senha nem PIN), papéis e recados; com a caixa marcada, 30 dias de visitas e eventos')),
      h('tr', null, h('th', null, 'Fica de fora'), h('td', null, 'sessões de login e do painel, códigos de troca de senha e tentativas (são temporários), a fotografia do Hall (é refeita) e o arquivo de config (tem os segredos: guarde à parte)'))));
    const copias = h('div');
    LP.trocar(cfg.corpo, h('div', { class: 'config-grade' },
      cartao('Baixar backup', 'para guardar fora do servidor', [entra, h('label', { class: 'caixa' }, medicao, ' incluir a medição (visitas e eventos de 30 dias)'), h('div', { class: 'botoes' }, baixar), ultimo,
        h('p', { class: 'faixa faixa-alerta' }, 'Faça antes de qualquer atualização do site.'),
        h('p', { class: 'faixa faixa-info' }, 'LGPD: o arquivo tem e-mails e os hashes das senhas dos jogadores. Guarde fora do servidor, num lugar só seu, e não compartilhe.')]),
      cartao('Cópias no servidor', 'uma por dia, fora do public_html', copias)));
    try {
      const [a, b] = await Promise.all([LP.adminGet('log', { acao: 'backup' }), LP.adminGet('log', { acao: 'backup_guardar' })]);
      const ems = [].concat(a.itens || [], b.itens || []).map((x) => x.em).sort().reverse();
      ultimo.textContent = ems.length ? 'Último backup: ' + LP.relativo(ems[0]) + ' (' + LP.dataHoraAno(ems[0]) + ').' : 'Nenhum backup ainda.';
    } catch (e) { ultimo.textContent = ''; }
    carregarCopias(copias);
  }
  async function carregarCopias(caixa) {
    LP.trocar(caixa, LP.estadoCarregando(3));
    try {
      const d = await LP.equipeGet('copias');
      const pasta = d.pasta || {};
      const itens = Array.isArray(d.itens) ? d.itens : [];
      const dono = LP.sessao && LP.sessao.quem && LP.sessao.quem.nivel >= 100;
      const guardar = LP.botao('Guardar cópia agora', async () => {
        try {
          const r = await LP.equipePost({ acao: 'backup_guardar' }, { tempo: 120000 });
          LP.avisar('Cópia guardada: ' + r.arquivo + ' (' + LP.compacto(r.bytes || 0) + ' bytes).');
          carregarCopias(caixa);
        } catch (e) { LP.avisarErro(e); }
      }, { tipo: 'fantasma', icone: 'arquivo', gerundio: 'Guardando…', disabled: !pasta.ok });
      const TIPOS = { diaria: 'diária', manual: 'manual', antes: 'antes de restaurar', outro: 'outra' };
      LP.trocar(caixa,
        pasta.ok ? h('p', { class: 'texto-3' }, 'Até ' + (d.maximo || 10) + ' cópias; a mais velha sai. ' + (d.diaria ? 'Cópia do dia: ' + (d.diaria.ok ? 'feita ' + LP.relativo(d.diaria.em) : 'falhou') + '.' : '')) : h('p', { class: 'faixa faixa-alerta' }, 'Sem pasta para as cópias: ' + (pasta.motivo || 'veja o LEIAME §5.') ),
        h('div', { class: 'botoes espaco-baixo' }, guardar),
        itens.length ? LP.lista({
          itens: itens,
          chave: (x) => x.arquivo,
          colunas: [
            { rotulo: 'Cópia', principal: true, classe: 'quebra', celula: (x) => h('div', { class: 'celula-dupla' }, h('span', null, LP.dataHoraAno(x.em)), h('span', { class: 'mono' }, x.arquivo)) },
            { rotulo: 'Tipo', celula: (x) => TIPOS[x.tipo] || x.tipo },
            { rotulo: 'Tamanho', num: true, celula: (x) => LP.compacto(x.bytes || 0) + ' B' },
            { rotulo: 'Ações', acoes: true, celula: (x) => [
              LP.botao('Baixar', async () => { try { await LP.baixarDoServidor(LP.urlEquipe('copia', { arquivo: x.arquivo })); } catch (e) { LP.avisarErro(e); } }, { tipo: 'fantasma', pequeno: true, icone: 'baixar' }),
              dono ? LP.botao('Restaurar', () => restaurar(x, caixa), { tipo: 'perigo', pequeno: true, icone: 'restaurar' }) : null,
            ] },
          ],
        }) : LP.estadoVazio('Nenhuma cópia ainda', pasta.ok ? 'A primeira sai na primeira entrada do painel no dia, ou em "Guardar cópia agora".' : ''));
    } catch (e) {
      LP.trocar(caixa, LP.estadoErro(e, () => carregarCopias(caixa)));
    }
  }
  async function restaurar(x, caixa) {
    const r = await LP.dialogo({
      titulo: 'Restaurar a cópia de ' + LP.dataHoraAno(x.em),
      perigo: true,
      botao: 'Restaurar',
      gerundio: 'Restaurando…',
      texto: [
        'Antes de mexer em qualquer coisa, o servidor confere o arquivo inteiro e guarda uma cópia "antes de restaurar" do estado de agora.',
        h('p', { class: 'faixa faixa-alerta' }, 'Contas que o próprio jogador excluiu depois desta cópia voltam ao restaurar. Prefira cópias recentes.'),
        'A equipe volta desativada, sem senha e sem PIN (dê uma senha provisória na aba Equipe).',
      ],
      campos: [{ nome: 'modo', rotulo: 'Como', tipo: 'opcoes', valor: 'completar', opcoes: [{ valor: 'completar', rotulo: 'Completar (só acrescenta o que falta)' }, { valor: 'substituir', rotulo: 'Substituir (apaga e regrava)' }] }],
      digitar: 'RESTAURAR',
      executar: (v) => LP.equipePost({ acao: 'backup_restaurar', arquivo: x.arquivo, modo: v.modo, confirma: v.confirma }, { tempo: 300000 }),
    });
    if (!r) return;
    // o servidor manda gravadas por tabela ({usuarios: 0, carreiras: 3, …}) e puladas como número (ou por tabela)
    const soma = (x) => (x && typeof x === 'object' ? Object.values(x).reduce((t, n) => t + (Number(n) || 0), 0) : Number(x) || 0);
    const quais = r.gravadas && typeof r.gravadas === 'object' ? Object.keys(r.gravadas).filter((k) => Number(r.gravadas[k]) > 0).map((k) => k + ' ' + LP.inteiro(r.gravadas[k])) : [];
    LP.avisar('Cópia restaurada (' + r.modo + '): ' + LP.plural(soma(r.gravadas), 'linha gravada', 'linhas gravadas') + (quais.length ? ' (' + quais.join(', ') + ')' : '') + ', ' + LP.plural(soma(r.puladas), 'pulada', 'puladas') + '. A cópia de antes ficou como ' + r.antes + '.');
    carregarCopias(caixa);
    LP.depoisDeAgir();
  }

  LP.abas.config = {
    titulo: 'Configurações',
    sub: '',
    montar: montarConfig,
    recarregar: () => { if (cfg.parte === 'site') { if (!LP.configSujo()) carregarConfig(); } else if (cfg.parte === 'conta') montarMinhaConta(); else montarBackup(); },
    podeSair: () => !LP.configSujo(),
    sair: () => { cfg.valores = null; cfg.form = null; document.body.classList.remove('com-barra'); },
  };

  // ═══ Testes (Imersivo, Live, testers) ════════════════════════════════════════════════════════
  function montarTestes(raiz) {
    const site = (LP.resumo && LP.resumo.site) || null;
    const st = (publico, abertoTxt, fechadoTxt) => (site === null ? LP.chip('carregando…', '', { semPonto: true }) : publico ? LP.chip(abertoTxt, 'alerta') : LP.chip(fechadoTxt, 'ok'));
    const conferir = LP.botao('Conferir agora', async () => {
      try {
        await LP.painelGet('?so=eu');
        LP.avisar('Confirmado: este navegador está como admin. O jogo libera o Imersivo e a Live aqui.');
      } catch (e) { LP.avisarErro(e); }
    }, { tipo: 'fantasma', icone: 'check', gerundio: 'Conferindo…' });
    const testers = h('div');
    LP.trocar(raiz,
      h('p', { class: 'faixa faixa-info' }, 'Os botões abrem o jogo em outra aba. O que é só da equipe abre porque este navegador tem o cookie do painel (vale 8 h, só aqui). Os testers abrem o Imersivo e a Live pela própria conta. Para ver como o público vê, use uma janela anônima.'),
      h('div', { class: 'grade-testes' },
        h('section', { class: 'cartao' },
          h('h2', null, 'Modo Imersivo', st(site && site.imersivoPublico, 'Aberto a todos', 'Público: "Em desenvolvimento"')),
          h('p', { class: 'texto-2' }, 'Base de teste: jogue à vontade até publicar. Carreiras do Imersivo não entram no Hall público enquanto ele estiver fechado.'),
          h('div', { class: 'botoes' },
            LP.linkJogo('Nova carreira no Imersivo', '#/identidade?modo=imersivo', { tipo: 'ouro', icone: 'jogar' }),
            LP.linkJogo('Continuar a carreira', '#/imersivo', { tipo: 'fantasma' }))),
        h('section', { class: 'cartao' },
          h('h2', null, 'Live interativa (TikTok)', st(site && site.livePublica, 'Visível a todos', 'Só a equipe vê')),
          h('p', { class: 'texto-2' }, 'Para o público ela some do menu, da tela inicial e do rodapé, e #/live mostra "Página não encontrada".'),
          h('div', { class: 'botoes' }, LP.linkJogo('Abrir a Live', '#/live', { tipo: 'ouro', icone: 'jogar' }))),
        h('section', { class: 'cartao' },
          h('h2', null, 'Outras telas'),
          h('p', { class: 'texto-2' }, 'Design kit (só a equipe no site) e o Hall das Lendas com as carreiras da comunidade.'),
          h('div', { class: 'botoes' },
            LP.linkJogo('Design kit', '#/kit', { tipo: 'fantasma' }),
            LP.linkJogo('Hall da comunidade', '#/hall?seg=comunidade', { tipo: 'fantasma' }),
            LP.linkJogo('Jogo (início)', '#/', { tipo: 'fantasma' }))),
        h('section', { class: 'cartao' },
          h('h2', null, 'Este navegador'),
          h('p', { class: 'texto-2' }, 'Confere com o servidor se o cookie do painel ainda vale (o jogo pergunta a mesma coisa).'),
          h('div', { class: 'botoes' }, conferir, h('a', { href: '#/config', class: 'botao-fantasma' }, 'Mudar o que é público')))),
      h('section', { class: 'cartao' }, h('div', { class: 'cartao-cabeca' }, h('h2', null, 'Testers ', h('span', { class: 'texto-3' }, 'contas que abrem o Imersivo e a Live (com o selo "Teste"), sem o painel'))), testers));
    carregarTesters(testers);
  }
  async function carregarTesters(caixa) {
    const entrada = h('input', { type: 'search', placeholder: 'Marcar como tester: apelido, e-mail ou #id', 'aria-label': 'Marcar como tester', maxlength: 100, autocomplete: 'off', spellcheck: 'false' });
    const marcar = LP.botao('Marcar como tester', async () => {
      const q = entrada.value.trim();
      if (q.length < 2 && !/^#?\d+$/.test(q)) { LP.avisar('Digite o apelido, o e-mail ou o #id da conta.', 'erro'); return; }
      try {
        const d = await LP.adminGet('usuarios', { q: q });
        const itens = d.itens || [];
        const exato = itens.find((u) => u.apelido.toLowerCase() === q.toLowerCase() || u.email.toLowerCase() === q.toLowerCase() || '#' + u.id === q || String(u.id) === q);
        const u = exato || (itens.length === 1 ? itens[0] : null);
        if (!u) { LP.avisar(itens.length ? LP.plural(itens.length, 'conta encontrada', 'contas encontradas') + ': seja mais específico (o #id é o mais certo).' : 'Nenhuma conta com isso.', 'erro'); return; }
        if (u.tipo === 'tester') { LP.avisar('@' + u.apelido + ' já é tester.', 'info'); return; }
        if (!LP.confirmar('Mudar @' + u.apelido + ' para tester? Ela passa a abrir o Imersivo e a Live.')) return;
        await LP.adminPost({ acao: 'mudar_tipo', id: u.id, tipo: 'tester' });
        LP.avisar('@' + u.apelido + ' agora é tester.');
        entrada.value = '';
        carregarTesters(caixa);
      } catch (e) { LP.avisarErro(e); }
    }, { tipo: 'ouro', icone: 'mais', gerundio: 'Marcando…', disabled: !LP.pode('usuarios') });
    entrada.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); marcar.click(); } });
    const lista = h('div', null, LP.estadoCarregando(3));
    LP.trocar(caixa, h('div', { class: 'ferramentas' }, h('div', { class: 'busca' }, LP.icone('busca'), entrada), marcar), lista);
    try {
      const d = await LP.adminGet('usuarios', { tipo: 'tester' });
      const itens = d.itens || [];
      LP.trocar(lista, itens.length ? LP.lista({
        itens: itens,
        aoClicar: (u) => LP.abrirConta(u.id),
        rotuloLinha: (u) => 'Abrir ' + u.apelido,
        colunas: [
          { rotulo: 'Quem', principal: true, celula: (u) => h('div', { class: 'celula-dupla' }, h('span', null, u.apelido), h('span', null, LP.email(u.email))) },
          // quando virou tester (o tipoEm do ?r=usuarios; servidor antigo: —)
          { rotulo: 'Desde', celula: (u) => LP.quando(u.tipoEm || null) },
          { rotulo: 'Situação', celula: (u) => LP.chipStatus(u.status) },
          { rotulo: 'Último acesso', celula: (u) => LP.quando(u.ultimoAcesso) },
          { rotulo: 'Ações', acoes: true, celula: (u) => (LP.pode('usuarios') ? LP.botao('Tirar', async () => {
            if (!LP.confirmar('Tirar @' + u.apelido + ' dos testers? Ela deixa de abrir o Imersivo e a Live.')) return;
            try { await LP.adminPost({ acao: 'mudar_tipo', id: u.id, tipo: 'jogador' }); LP.avisar('@' + u.apelido + ' voltou a ser jogador.'); carregarTesters(caixa); } catch (e) { LP.avisarErro(e); }
          }, { tipo: 'fantasma', pequeno: true, icone: 'x', gerundio: 'Tirando…' }) : null) },
        ],
      }) : LP.estadoVazio('Nenhum tester', 'Marque uma conta aqui ou na ficha dela (Tipo de conta).'));
    } catch (e) { LP.trocar(lista, LP.estadoErro(e, () => carregarTesters(caixa))); }
  }
  LP.abas.testes = { titulo: 'Testes', sub: 'Só a equipe e os testers: Modo Imersivo (em desenvolvimento) e Live interativa', montar: montarTestes, recarregar: () => { const s = document.getElementById('aba-testes'); if (s) montarTestes(s); } };

  // ═══ Saúde (P1-14) ═══════════════════════════════════════════════════════════════════════════
  const saude = { corpo: null };
  function montarSaude(raiz) {
    saude.corpo = h('div');
    LP.trocar(raiz, saude.corpo);
    LP.acoesAba(LP.botao('Verificar de novo', () => carregarSaude(), { tipo: 'fantasma', icone: 'atualizar', gerundio: 'Verificando…' }));
    LP.trocar(saude.corpo, LP.estadoCarregando(8));
    return carregarSaude();
  }
  async function carregarSaude() {
    try {
      const d = await LP.equipeGet('saude');
      if (!LP.visivel(saude.corpo)) return;
      desenharSaude(d);
    } catch (e) {
      if ((e && e.status === 401) || !LP.visivel(saude.corpo)) return;
      LP.trocar(saude.corpo, LP.estadoErro(e, carregarSaude));
    }
  }
  function desenharSaude(d) {
    const probs = Array.isArray(d.problemas) ? d.problemas : [];
    const ok = d.tudoCerto !== false && !probs.some((p) => p.grave);
    LP.subAba('Verificado às ' + LP.hora(d.horaServidor || new Date().toISOString()) + ' · só sim/não e contagens: nenhum segredo nem caminho de arquivo');
    const caixa = h('div', { class: 'saude-caixa ' + (ok ? 'saude-ok' : 'saude-ruim'), role: 'status' },
      h('b', null, ok ? (probs.length ? 'Funcionando, com ' + LP.plural(probs.length, 'ponto', 'pontos') + ' para olhar' : 'Tudo no lugar') : LP.plural(probs.filter((p) => p.grave).length, 'problema', 'problemas')),
      h('span', null, ok ? 'O jogo, as contas e o Hall estão respondendo.' : 'Veja como resolver abaixo.'));
    const lista = probs.length ? h('section', { class: 'cartao' }, h('h2', null, 'O que olhar'), probs.map((p) => h('div', { class: 'problema' + (p.grave ? '' : ' leve') },
      h('b', null, (p.grave ? '⚠ ' : '· ') + p.texto), p.resolver ? h('p', { class: 'texto-2' }, 'Como resolver: ' + p.resolver) : null))) : null;
    const sn = (v) => h('span', { class: v ? 'sim' : 'nao', 'aria-hidden': 'true' }, v ? '✓' : '✗');
    const linha = (v, t) => h('li', null, sn(v), h('span', null, t));
    const ph = d.php || {};
    const ext = ph.extensoes || {};
    const bd = d.banco || {};
    const sc = d.schema || {};
    const cf = d.config || {};
    const hl = d.hall || null;
    const md = d.medicao || {};
    const cp = d.copias || {};
    const dd = d.dados || {};
    const L = LP.ladrilho;
    LP.trocar(saude.corpo, caixa, lista,
      h('div', { class: 'ladrilhos espaco-baixo' },
        L('Contas', LP.inteiro(dd.contas)), L('Carreiras', LP.inteiro(dd.carreiras)), L('No Hall', LP.inteiro(dd.noHall)),
        L('Denúncias abertas', LP.inteiro(dd.denunciasAbertas), '', { href: '#/denuncias', classe: dd.denunciasAbertas ? 'ladrilho-alerta' : '' })),
      h('div', { class: 'config-grade' },
        h('section', { class: 'cartao' }, h('h2', null, 'Servidor'), h('ul', { class: 'lista-checagem' },
          linha(true, 'PHP ' + (ph.versao || '—')),
          ['pdo_mysql', 'mbstring', 'intl', 'zlib', 'apcu'].map((k) => linha(!!ext[k], k + (k === 'intl' && !ext[k] ? ' (sem ela o filtro de apelido fica menos preciso)' : k === 'apcu' && !ext[k] ? ' (opcional: cache dos números)' : ''))),
          linha(!!bd.ok, 'Banco ' + (bd.versao || '') + (bd.fuso ? ' · fuso ' + bd.fuso : '')),
          linha(!(sc.faltam && sc.faltam.length), sc.faltam && sc.faltam.length ? 'Faltam ' + LP.plural(sc.faltam.length, 'item', 'itens') + ' no banco: ' + sc.faltam.slice(0, 6).map((x) => x.tabela + (x.coluna ? '.' + x.coluna : x.indice ? ' (' + x.indice + ')' : '')).join(', ') + ' — rode o instalar.php de novo (LEIAME §5)' : 'Banco com todas as tabelas e colunas'))),
        h('section', { class: 'cartao' }, h('h2', null, 'Arquivo de config'), h('ul', { class: 'lista-checagem' },
          linha(!!cf.segredo, 'Segredo definido'), linha(!!cf.senhaPainel, 'Senha do painel definida'), linha(!!cf.token, 'Token de script definido'),
          linha((cf.origens || 0) > 0, LP.plural(cf.origens || 0, 'origem permitida', 'origens permitidas')),
          linha(!!cf.emailRemetente, 'Remetente dos e-mails'), linha(cf.emailModo !== 'arquivo', 'Envio de e-mail: ' + (cf.emailModo || '—')),
          linha(!!cf.cookieSeguro, 'Cookie só por HTTPS'), linha(true, LP.plural(cf.contasPainel || 0, 'conta no painel', 'contas no painel')))),
        h('section', { class: 'cartao' }, h('h2', null, 'Jogo agora'), h('ul', { class: 'lista-checagem' },
          linha(hl && !hl.atrasado, hl ? 'Hall: fotografia ' + LP.relativo(hl.em) + ' · ' + LP.plural(hl.total || 0, 'carreira', 'carreiras') + ' · ' + LP.inteiro(hl.ms || 0) + ' ms' + (hl.atrasado ? ' (atrasada)' : '') : 'Hall ainda não montado'),
          linha(!!md.ultimaVisita, md.ultimaVisita ? 'Última visita ' + LP.relativo(md.ultimaVisita) + ' · ' + LP.plural(md.visitas1h || 0, 'visita', 'visitas') + ' na última hora' : 'Nenhuma visita registrada'),
          linha(!(d.email && d.email.falhas24h), d.email && d.email.falhas24h !== null && d.email.falhas24h !== undefined ? LP.plural(d.email.falhas24h, 'e-mail falhou', 'e-mails falharam') + ' em 24 h' : 'E-mails: sem registro ainda'))),
        h('section', { class: 'cartao' }, h('h2', null, 'Cópias no servidor'), h('ul', { class: 'lista-checagem' },
          linha(!!cp.ok, cp.ok ? LP.plural(cp.quantas || 0, 'cópia guardada', 'cópias guardadas') : 'Sem pasta para as cópias: ' + (cp.motivo || '')),
          linha(!!cp.ultima, cp.ultima ? 'Última: ' + LP.relativo(cp.ultima.em || cp.ultima) + (cp.ultima.bytes ? ' · ' + LP.compacto(cp.ultima.bytes) + ' B' : '') : 'Nenhuma ainda'),
          linha(!!cp.ultimaDiaria, cp.ultimaDiaria ? 'Cópia diária de ' + LP.diaCurto(cp.ultimaDiaria) : 'Cópia diária ainda não feita')),
          h('a', { href: '#/config?parte=backup', class: 'botao-fantasma botao-pequeno' }, 'Abrir Backup'))));
  }
  LP.abas.saude = { titulo: 'Saúde', sub: '', montar: montarSaude, recarregar: () => carregarSaude() };
})();
