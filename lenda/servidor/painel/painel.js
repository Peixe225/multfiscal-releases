/* LENDA · painel do administrador — liga tudo: a entrada (../api/painel.php: senha, e-mail, PIN, senha provisória;
 * cookie lenda_painel), a sessão e os poderes (?so=sessao), as abas em ordem fixa (rota no hash, painel lateral por
 * conta=/carreira=), o pulso de 15 s (?so=agora: online, números de ação, alertas, filas, equipe, recados), o
 * "Precisa de atenção" (admin.php?r=atencao), os recados internos, a aparência, o modo discreto e os atalhos. */
'use strict';

(function () {
  const LP = window.LP;
  const { h } = LP;
  const $ = LP.$;

  // Ordem fixa das abas (a mesma em toda tela). tecla: atalho; poder: o que o papel precisa para abrir (sem ele, a
  // aba aparece com cadeado e a tela explica). v3.3: Mensagens (Fale conosco) e Desafios entram sem tecla, para as de
  // sempre não mudarem de número.
  const D = {
    visao: ['M3 3v18h18', 'M7 15l4-4 3 3 5-6'],
    area: ['M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z', 'M12 7a2 2 0 1 0 0 4 2 2 0 0 0 0-4z'],
    usuarios: ['M9 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M2 21a7 7 0 0 1 14 0', 'M16 4a4 4 0 0 1 0 8', 'M22 21a7 7 0 0 0-5-6.7'],
    mensagens: ['M4 5h16v11H9l-5 4z', 'M8 9.5h8', 'M8 12.5h5'],
    hall: ['M6 9H4a2 2 0 0 1 0-4h2', 'M18 9h2a2 2 0 0 0 0-4h-2', 'M6 3h12v7a6 6 0 0 1-12 0z', 'M12 16v3', 'M8 21h8'],
    denuncias: ['M4 22V4a1 1 0 0 1 1-1h11l-2 4 2 4H5'],
    indicacoes: ['M20 12v9H4v-9', 'M2 7h20v5H2z', 'M12 21V7', 'M12 7H8a2.5 2.5 0 0 1 0-5c3 0 4 5 4 5z', 'M12 7h4a2.5 2.5 0 0 0 0-5c-3 0-4 5-4 5z'],
    desafios: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z', 'M12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z'],
    conquistas: ['M12 3a6 6 0 1 0 0 12 6 6 0 0 0 0-12z', 'm8.5 14-1.5 8 5-3 5 3-1.5-8'],
    relatorios: ['M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z', 'M14 3v6h6', 'M8 17v-3', 'M12 17v-6', 'M16 17v-4'],
    tempo: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 7v5l3 2'],
    registro: ['M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z', 'M14 3v6h6', 'M8 13h8', 'M8 17h5'],
    saude: ['M3 12h4l3-8 4 16 3-8h4'],
    equipe: ['M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', 'M9 12l2 2 4-4'],
    config: ['M4 21v-7', 'M4 10V3', 'M12 21v-9', 'M12 8V3', 'M20 21v-5', 'M20 12V3', 'M1 14h6', 'M9 8h6', 'M17 16h6'],
    testes: ['M9 3h6', 'M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3', 'M7 15h10'],
  };
  const ABAS = [
    { id: 'visao', titulo: 'Visão geral', tecla: '1' },
    { id: 'area', titulo: 'Na área', tecla: '2' },
    { id: 'usuarios', titulo: 'Usuários', tecla: '3' },
    { id: 'mensagens', titulo: 'Mensagens' },
    { id: 'hall', titulo: 'Hall público', tecla: '4' },
    { id: 'denuncias', titulo: 'Denúncias', tecla: '5' },
    { id: 'indicacoes', titulo: 'Indicações e bônus', tecla: '6' },
    { id: 'desafios', titulo: 'Desafios' },
    { id: 'conquistas', titulo: 'Conquistas', tecla: '7' },
    { id: 'relatorios', titulo: 'Relatórios', tecla: '8' },
    { id: 'tempo', titulo: 'Tempo de jogo', tecla: '9' },
    { id: 'registro', titulo: 'Registro', tecla: '0' },
    { id: 'saude', titulo: 'Saúde', poder: 'sistema' },
    { id: 'equipe', titulo: 'Equipe', poder: 'equipe' },
    { id: 'config', titulo: 'Configurações' },
    { id: 'testes', titulo: 'Testes', selo: 'só a equipe' },
  ];
  LP.ABAS = ABAS;
  const estado = {
    logado: false, atual: null, baseAtual: '', hashAtual: '', timerAgora: 0, timerResumo: 0, timerAtencao: 0, resumoNoAr: false,
    resumoDeNovo: false, titulo: 'Visão geral', falhas: 0, ultimoAgora: null, alertasChave: '', recadosN: -1, atencaoNoAr: false, atencaoChave: '',
    atencaoAberta: false,
  };
  LP.resumo = null;
  LP.agora = null;

  // ── preferências do aparelho (só conveniência): tema e modo discreto ───────────────────────────
  function lerPref() {
    try { return JSON.parse(localStorage.getItem('lenda:painel') || '{}') || {}; } catch (e) { return {}; }
  }
  function gravarPref(mudar) {
    try {
      const p = lerPref();
      Object.assign(p, mudar);
      localStorage.setItem('lenda:painel', JSON.stringify(p));
    } catch (e) { /* sem armazenamento: vale só nesta página */ }
  }
  const TEMAS = [['original', 'Original'], ['claro', 'Claro'], ['alto', 'Alto contraste']];
  const temaAtual = () => document.documentElement.getAttribute('data-tema') || 'original';
  function aplicarTema(novo, avisar) {
    const t = TEMAS.find((x) => x[0] === novo) || TEMAS[0];
    if (t[0] === 'original') document.documentElement.removeAttribute('data-tema');
    else document.documentElement.setAttribute('data-tema', t[0]);
    gravarPref({ tema: t[0] });
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', getComputedStyle(document.body).backgroundColor);
    if (avisar) LP.avisar('Aparência: ' + t[1] + '. Fica salva neste navegador (T troca).', 'info', 3500);
    if (LP.redesenharGraficos) LP.redesenharGraficos();
  }
  function trocarTema() {
    const i = TEMAS.findIndex((t) => t[0] === temaAtual());
    aplicarTema(TEMAS[(i + 1) % TEMAS.length][0], true);
  }
  function discretoLigado() { return document.documentElement.getAttribute('data-discreto') !== '0'; }
  function trocarDiscreto(querLigar) {
    const ligar = typeof querLigar === 'boolean' ? querLigar : !discretoLigado();
    document.documentElement.setAttribute('data-discreto', ligar ? '1' : '0');
    gravarPref({ discreto: ligar });
    marcarDiscreto();
    LP.avisar(ligar ? 'Modo discreto ligado: os e-mails aparecem mascarados (M desliga).' : 'Modo discreto desligado: os e-mails aparecem inteiros (M liga).', 'info', 3500);
  }

  // ── menu "⋯" do celular (v3.5): no topo do celular, no lugar de Aparência e Sair soltos; junta o que no computador fica
  // no pé da lateral (estado do site, Abrir o jogo, Discreto) e pergunta antes de sair (entrar de novo pede senha e PIN) ──
  function abrirMenuCelular() {
    if (LP.dialogoAberto()) return;
    const chips = Array.from($('estado-site').children).map((c) => c.cloneNode(true));
    const estadoSite = h('div', { class: 'estado-site menu-estado', role: 'group', 'aria-label': 'Estado do site' },
      chips.length ? chips : h('span', { class: 'texto-3' }, 'carregando…'));
    const tema = LP.segmentos('Aparência', TEMAS.map(([v, n]) => ({ valor: v, rotulo: n })), temaAtual(), (v) => {
      aplicarTema(v, false);
      tema.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.valor === v)));
    });
    const discreto = h('input', { type: 'checkbox', role: 'switch', checked: discretoLigado(), 'aria-label': 'Modo discreto: e-mails mascarados' });
    const txtDiscreto = h('span', { class: 'estado-txt' }, discreto.checked ? 'Ligado' : 'Desligado');
    discreto.addEventListener('change', () => { trocarDiscreto(discreto.checked); txtDiscreto.textContent = discreto.checked ? 'Ligado' : 'Desligado'; });
    const sairBotao = LP.botao('Sair do painel', async () => {
      const ok = await LP.dialogo({
        titulo: 'Sair do painel?',
        texto: 'Para entrar de novo, você vai precisar digitar a senha e o PIN.',
        botao: 'Sair',
        perigo: true,
      });
      if (!ok) return;
      LP.fecharDialogo(true);
      sair();
    }, { tipo: 'perigo', classe: 'botao-bloco', icone: 'sair' });
    const corpo = h('div', { class: 'menu-celular' },
      h('section', { class: 'menu-parte' }, h('h3', null, 'Estado do site'), estadoSite),
      h('section', { class: 'menu-parte' }, h('h3', null, 'Aparência'), tema),
      h('section', { class: 'menu-parte' }, h('h3', null, 'Modo discreto'),
        h('label', { class: 'interruptor' }, discreto, h('span', { class: 'trilho', 'aria-hidden': 'true' }), txtDiscreto),
        h('p', { class: 'ajuda' }, 'Ligado, os e-mails aparecem mascarados (bom para mostrar a tela a alguém).')),
      h('a', { href: '../', target: '_blank', rel: 'noopener', class: 'botao-fantasma botao-bloco' }, 'Abrir o jogo ↗'),
      sairBotao);
    LP.dialogo({ titulo: 'Painel', soFechar: true, corpo: corpo });
  }
  function marcarDiscreto() {
    const b = $('botao-discreto');
    if (b) b.setAttribute('aria-pressed', String(discretoLigado()));
  }

  // ── cabeçalho da aba ────────────────────────────────────────────────────────────────────────
  LP.acoesAba = function () {
    const caixa = $('acoes-aba');
    LP.limpar(caixa);
    for (let i = 0; i < arguments.length; i++) LP.anexar(caixa, arguments[i]);
  };
  LP.subAba = (t) => { $('sub-aba').textContent = t || ''; };
  LP.tituloAba = function (t) {
    estado.titulo = t || '';
    $('titulo-aba').textContent = estado.titulo;
    tituloDocumento();
  };
  LP.tituloAbaAtual = () => {
    const a = ABAS.find((x) => x.id === estado.atual);
    return a ? a.titulo : 'a lista';
  };
  function tituloDocumento() {
    const a = LP.agora && LP.agora.acao;
    const n = a ? a.denunciasAbertas || 0 : (LP.resumo && LP.resumo.denunciasAbertas) || 0;
    document.title = (n ? '(' + n + ') ' : '') + 'LENDA · Painel' + (estado.titulo ? ' · ' + estado.titulo : '');
  }

  // ── navegação ───────────────────────────────────────────────────────────────────────────────
  function montarNav() {
    const nav = $('abas');
    LP.limpar(nav);
    ABAS.forEach((a) => {
      const icone = LP.svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' });
      (D[a.id] || []).forEach((d) => icone.appendChild(LP.svg('path', { d: d })));
      const trancada = a.poder && !LP.pode(a.poder);
      const link = h('a', { href: '#/' + a.id, dataset: { aba: a.id }, class: trancada ? 'trancada' : null, title: trancada ? 'O seu papel não abre esta parte' : null },
        icone, h('span', { class: 'aba-nome' }, a.titulo),
        trancada ? h('span', { class: 'cadeado', 'aria-label': 'trancada' }, LP.icone('cadeado')) : null,
        a.selo ? h('span', { class: 'selo-admin' }, a.selo) : null,
        h('span', { class: 'contador', id: 'cont-' + a.id, hidden: true }),
        a.tecla ? h('kbd', { 'aria-hidden': 'true' }, a.tecla) : null);
      nav.appendChild(link);
    });
  }
  function contador(id, n, tipo, titulo) {
    const c = $('cont-' + id);
    if (!c) return;
    c.hidden = !n;
    c.className = 'contador' + (tipo ? ' contador-' + tipo : '');
    c.textContent = n ? LP.inteiro(n) : '';
    if (titulo) c.title = titulo;
  }

  // ── pulso: online, números de ação, alertas, filas, equipe, recados (15 s) ──────────────────
  // curto: o rótulo no celular (4 colunas × 2 linhas)
  const NUMEROS = [
    { k: 'online', rotulo: 'Online agora', curto: 'Online', href: '#/area', cor: 'ok', title: 'Abas do jogo abertas no último minuto · abre Na área' },
    { k: 'jogando', rotulo: 'Jogando agora', curto: 'Jogando', href: '#/area?ver=jogando', title: 'Com uma partida em andamento' },
    { k: 'denunciasAbertas', rotulo: 'Denúncias abertas', curto: 'Denúncias', href: '#/hall?filtro=denunciadas', title: 'Abre Hall público · denunciadas' },
    { k: 'suspeitas', rotulo: 'Suspeitas', curto: 'Suspeitas', href: '#/hall?filtro=suspeitas', title: 'Carreiras suspeitas fora do Hall, esperando você' },
    { k: 'indicacoesPendentes', rotulo: 'Indicações pendentes', curto: 'Indicações', href: '#/indicacoes?status=pendente', title: 'O amigo ainda não terminou a 1ª carreira' },
    { k: 'mensagensNovas', rotulo: 'Mensagens novas', curto: 'Mensagens', href: '#/mensagens?status=nova', title: 'Fale conosco: mensagens que ninguém abriu ainda' },
    { k: 'candidatosPendentes', rotulo: 'Candidatos a desafio', curto: 'Candidatos', href: '#/desafios', title: 'Carreiras que cumpriram um desafio e esperam a verificação no jogo (ou o vencedor)' },
    { k: 'contasHoje', rotulo: 'Contas hoje', curto: 'Contas hoje', href: '#/usuarios', title: 'Contas criadas hoje (Brasília)' },
  ];
  function montarNumeros() {
    LP.trocar($('numeros-acao'), NUMEROS.map((n) => h('a', { href: n.href, class: 'numero-acao', id: 'na-' + n.k, title: n.title },
      h('b', { class: 'numero-acao-valor', id: 'nav-' + n.k }, '–'), h('span', { class: 'na-longo' }, n.rotulo), h('span', { class: 'na-curto' }, n.curto))));
  }
  function desenharPulso(a) {
    LP.agora = a;
    $('lat-online').textContent = LP.num(a.online || 0);
    $('lat-jogando').textContent = LP.num(a.jogando || 0);
    if (LP.desenharAgoraVisao) LP.desenharAgoraVisao(a);
    const ac = a.acao || {};
    const val = { online: a.online, jogando: a.jogando, denunciasAbertas: ac.denunciasAbertas, suspeitas: ac.suspeitas, indicacoesPendentes: ac.indicacoesPendentes, contasHoje: ac.contasHoje,
      mensagensNovas: ac.mensagensNovas, candidatosPendentes: ac.candidatosPendentes };
    NUMEROS.forEach((n) => {
      const v = val[n.k];
      LP.mudarTexto($('nav-' + n.k), v === undefined || v === null ? '–' : LP.num(v));
      const caixa = $('na-' + n.k);
      if (!caixa) return;
      caixa.classList.toggle('na-ok', n.k === 'online');
      caixa.classList.toggle('na-alerta', (n.k === 'denunciasAbertas' && v > 0 && !ac.ocultasPorDenuncia) || ((n.k === 'suspeitas' || n.k === 'indicacoesPendentes' || n.k === 'mensagensNovas' || n.k === 'candidatosPendentes') && v > 0));
      caixa.classList.toggle('na-perigo', n.k === 'denunciasAbertas' && (ac.ocultasPorDenuncia || 0) > 0);
    });
    if (ac.ocultasPorDenuncia) $('na-denunciasAbertas').title = LP.plural(ac.ocultasPorDenuncia, 'carreira escondida', 'carreiras escondidas') + ' por denúncias esperando a sua decisão · abre Hall público';
    // pílulas das abas
    const al = a.alertas || null;
    contador('visao', al ? al.grave : 0, 'perigo', al ? LP.plural(al.grave, 'alerta grave', 'alertas graves') : '');
    contador('area', a.online || 0, 'ok', 'online agora');
    contador('usuarios', ac.contasHoje || 0, '', LP.plural(ac.contasHoje || 0, 'conta nova hoje', 'contas novas hoje'));
    const hallN = (ac.denunciasAbertas || 0) + (ac.ocultasPorDenuncia || 0);
    contador('hall', hallN, ac.ocultasPorDenuncia ? 'perigo' : 'alerta', 'denúncias abertas + carreiras escondidas por denúncia');
    contador('denuncias', ac.denunciasAbertas || 0, 'perigo', 'denúncias abertas');
    contador('indicacoes', ac.indicacoesPendentes || 0, 'alerta', 'indicações pendentes');
    contador('mensagens', ac.mensagensNovas || 0, 'alerta', LP.plural(ac.mensagensNovas || 0, 'mensagem nova', 'mensagens novas') + ' no Fale conosco');
    contador('desafios', ac.candidatosPendentes || 0, 'alerta', LP.plural(ac.candidatosPendentes || 0, 'candidato esperando decisão', 'candidatos esperando decisão'));
    tituloDocumento();
    // equipe no painel agora (S13): a faixa só com 2+ pessoas
    desenharFaixas();
    // alertas mudaram? refaz o "Precisa de atenção"
    const chave = al ? al.grave + '/' + al.acao : 'x';
    if (estado.alertasChave && chave !== estado.alertasChave) carregarAtencao();
    estado.alertasChave = chave;
    // recados novos da equipe
    const nr = Number(a.recadosNaoLidos || 0);
    if (estado.recadosN >= 0 && nr > estado.recadosN) {
      carregarRecados();
      // aviso próprio (origem 'recados'): não troca o "N novas — clique para ver" da fila da aba aberta
      LP.novidade(nr - estado.recadosN === 1 ? 'Recado novo da equipe — clique para ver' : (nr - estado.recadosN) + ' recados novos da equipe — clique para ver', () => {
        const r = $('recados');
        if (r && r.firstChild) r.scrollIntoView({ behavior: LP.calmo() ? 'auto' : 'smooth', block: 'center' });
      }, 'recados');
    }
    estado.recadosN = nr;
    // a aba aberta decide se a fila dela mudou (P1-13)
    const m = estado.atual && LP.abas[estado.atual];
    if (m && m.aoPulso) m.aoPulso(a);
  }
  /** Online/jogando que chegam junto com os números do período (painel.php sem ?so=): a lateral e os cartões grandes. */
  LP.mostrarAgora = function (a) {
    if (!a) return;
    $('lat-online').textContent = LP.num(a.online || 0);
    $('lat-jogando').textContent = LP.num(a.jogando || 0);
    if (LP.desenharAgoraVisao) LP.desenharAgoraVisao(a);
  };
  function selo(texto, tipo) {
    const s = $('selo-atualizado');
    s.textContent = texto;
    s.className = 'selo-atualizado' + (tipo ? ' selo-' + tipo : '');
  }
  async function carregarAgora() {
    if (document.hidden || !estado.logado) return;
    try {
      const r = await LP.painelGet('?so=agora');
      if (!estado.logado) return;
      estado.falhas = 0;
      if (r.agora) desenharPulso(r.agora);
      selo('atualizado às ' + LP.hora((r.agora && r.agora.atualizadoEm) || new Date().toISOString(), true));
    } catch (e) {
      if (e && e.status === 401) return;
      estado.falhas++;
      if (estado.falhas >= 3) selo('sem conexão com o servidor', 'perigo');
    }
  }

  // ── faixas: avisos da sessão (criar PIN, criar a conta) e a equipe no painel agora ──────────
  function desenharFaixas() {
    const caixa = $('faixas');
    const itens = [];
    const av = (LP.sessao && LP.sessao.avisos) || [];
    if (av.includes('crie_conta')) {
      itens.push(h('p', { class: 'faixa faixa-ouro' }, h('b', null, 'Você está entrando com a senha única. '),
        'Crie a sua conta (com PIN) para ter o seu nome no registro e poder trocar a senha pelo painel. ',
        h('a', { href: '#/config?parte=conta' }, 'Minha conta → Criar a minha conta')));
    }
    if (av.includes('criar_pin')) {
      itens.push(h('p', { class: 'faixa faixa-ouro' }, h('b', null, 'Cadastre o seu PIN. '),
        'A conta Dono de emergência entra só com a senha do arquivo; com o PIN, quem copiar a senha não entra. ',
        h('a', { href: '#/config?parte=conta' }, 'Configurações → Minha conta → Criar PIN')));
    }
    const eq = (LP.agora && Array.isArray(LP.agora.equipe)) ? LP.agora.equipe : [];
    if (eq.length >= 2) {
      itens.push(h('p', { class: 'faixa faixa-equipe' }, h('span', { class: 'rotulo-versalete' }, 'Da equipe agora'),
        eq.map((p, i) => [i ? ' · ' : '', h('b', null, p.nome), ' ', h('span', { class: 'texto-3' }, (p.papel || '') + (p.eu ? ' (você)' : ''))])));
    }
    LP.trocar(caixa, itens);
  }

  // ── Precisa de atenção (P0-1) ───────────────────────────────────────────────────────────────
  function linkAlerta(l) {
    const f = l && l.filtro;
    switch (l && l.aba) {
      case 'hall': return f === 'denunciadas' || f === 'suspeitas' || f === 'revisao' ? '#/hall?filtro=' + f : '#/hall';
      case 'indicacoes':
        if (f === 'indicador' && l.id) return '#/indicacoes?indicador=' + encodeURIComponent(l.id);
        if (f === 'recusada') return '#/indicacoes?status=recusada';
        if (f === 'aparelho') return '#/indicacoes?status=aparelho';
        return '#/indicacoes';
      case 'registro':
        if (f === 'seguranca' || f === 'emails') return '#/registro?parte=' + f;
        if (f === 'quem' && l.id) return '#/registro?quem=' + encodeURIComponent(l.id);
        if (f) return '#/registro?acao=' + encodeURIComponent(f);
        return '#/registro';
      case 'config': return f === 'conta' || f === 'backup' ? '#/config?parte=' + f : '#/config';
      case 'saude': return '#/saude';
      case 'mensagens': return /^(nova|lida|respondida|arquivada)$/.test(f || '') ? '#/mensagens?status=' + f : '#/mensagens';
      case 'desafios': return l.id && /^\d+$/.test(String(l.id)) ? '#/desafios?id=' + l.id : '#/desafios';
      case 'usuarios': return '#/usuarios';
      default: return '#/' + ((l && l.aba) || 'visao');
    }
  }
  async function carregarAtencao(forcar) {
    if (!estado.logado || estado.atencaoNoAr) return;
    estado.atencaoNoAr = true;
    try {
      const r = await LP.adminGet('atencao', { atualizar: forcar ? 1 : '' });
      desenharAtencao(r);
    } catch (e) {
      if (e && e.status === 503) desenharAtencao({ alertas: [], dispensados: [] });
    } finally {
      estado.atencaoNoAr = false;
    }
  }
  LP.recarregarAtencao = () => carregarAtencao(true);
  function desenharAtencao(r) {
    const caixa = $('atencao');
    const alertas = Array.isArray(r.alertas) ? r.alertas : [];
    const disp = Array.isArray(r.dispensados) ? r.dispensados : [];
    const graves = alertas.filter((a) => a.nivel === 'grave').length;
    contador('visao', graves, 'perigo', LP.plural(graves, 'alerta grave', 'alertas graves'));
    if (!alertas.length) { caixa.hidden = true; LP.limpar(caixa); estado.atencaoChave = ''; return; }
    const sub = (graves ? LP.plural(graves, 'grave', 'graves') + ' · ' : '') + 'refeito a cada minuto' + (r.geradoEm ? ' · ' + LP.hora(r.geradoEm) : '');
    // o mesmo conteúdo do minuto anterior: só a hora muda (o "N dispensados" aberto e o foco ficam como estão)
    const chave = JSON.stringify([alertas.map((a) => [a.chave, a.nivel, a.texto, a.desde, a.dispensavel]), disp.map((x) => [x.chave, x.texto, x.em, x.por])]);
    const subNo = caixa.querySelector('.atencao-sub');
    if (chave === estado.atencaoChave && subNo && !caixa.hidden) { subNo.textContent = sub; aplicarAtencaoAberta(); return; }
    estado.atencaoChave = chave;
    const dispAberto = !!caixa.querySelector('details.atencao-dispensados[open]');
    const foco = LP.guardarFoco(caixa);
    const linhas = alertas.map((a) => {
      const marca = a.nivel === 'leve' ? '·' : '⚠';
      const link = h('a', { href: linkAlerta(a.link), class: 'atencao-texto' }, a.texto);
      // no celular: tocar no alerta recolhe a caixa e mostra a aba (mesmo endereço de agora: só rola até ela)
      link.addEventListener('click', () => {
        estado.atencaoAberta = false;
        aplicarAtencaoAberta();
        if (link.getAttribute('href') === location.hash) LP.rolarParaAba();
      });
      const extra = a.desde && a.nivel !== 'leve' ? h('span', { class: 'texto-3 atencao-desde', title: LP.dataHoraAno(a.desde) }, LP.relativo(a.desde)) : null;
      const dispensar = a.dispensavel && LP.pode('ver') ? LP.botao('Está tudo certo', async (ev, b) => {
        if (!LP.confirmar('Some até aparecer um caso novo. Confirmar?')) return;
        try {
          await LP.adminPost({ acao: 'alerta_dispensar', chave: a.chave });
          LP.avisar('Alerta dispensado. Volta sozinho se aparecer um caso novo.');
          carregarAtencao(true);
        } catch (e) { LP.avisarErro(e); }
      }, { tipo: 'fantasma', pequeno: true, gerundio: 'Dispensando…' }) : null;
      return h('li', { class: 'atencao-linha atencao-' + a.nivel, dataset: { foco: 'a:' + a.chave } },
        h('span', { class: 'atencao-marca', 'aria-hidden': 'true' }, marca),
        h('span', { class: 'fora-da-tela' }, a.nivel === 'grave' ? 'Grave: ' : a.nivel === 'acao' ? 'Pede ação: ' : 'Para saber: '),
        link, extra, dispensar);
    });
    const detalhes = disp.length ? h('details', { class: 'atencao-dispensados', open: dispAberto, dataset: { foco: 'dispensados' } },
      h('summary', null, LP.plural(disp.length, 'dispensado', 'dispensados')),
      h('ul', null, disp.map((x) => h('li', { dataset: { foco: 'd:' + x.chave } }, h('span', null, x.texto || x.chave), ' ', h('span', { class: 'texto-3' }, (x.em ? LP.relativo(x.em) : '') + (x.por ? ' · ' + x.por : '')), ' ',
        LP.botao('Reabrir', async () => {
          try {
            await LP.adminPost({ acao: 'alerta_reabrir', chave: x.chave });
            carregarAtencao(true);
          } catch (e) { LP.avisarErro(e); }
        }, { tipo: 'fantasma', pequeno: true, gerundio: 'Reabrindo…' }))))) : null;
    // no celular a caixa fica recolhida numa linha ("⚠ 9 alertas · 3 graves ▸"): com tudo aberto, a aba começava 1 a 2
    // telas abaixo. No computador o botão some e a lista fica sempre à vista.
    const acao = alertas.filter((a) => a.nivel === 'acao').length;
    const dobrar = h('button', { type: 'button', class: 'atencao-dobrar' + (graves ? ' tem-grave' : ''), 'aria-controls': 'atencao-corpo', 'aria-expanded': 'false' },
      h('span', { class: 'atencao-marca', 'aria-hidden': 'true' }, graves || acao ? '⚠' : '·'),
      h('span', { class: 'atencao-resumo' }, LP.plural(alertas.length, 'alerta', 'alertas'),
        graves ? h('b', { class: 'atencao-graves' }, ' · ' + LP.plural(graves, 'grave', 'graves')) : null,
        h('span', { class: 'fora-da-tela' }, ' · Precisa de atenção')),
      h('span', { class: 'atencao-seta', 'aria-hidden': 'true' }));
    dobrar.addEventListener('click', () => {
      estado.atencaoAberta = !estado.atencaoAberta;
      aplicarAtencaoAberta();
    });
    LP.trocar(caixa,
      h('div', { class: 'atencao-cabeca' }, h('h2', { id: 'atencao-titulo' }, 'Precisa de atenção'), h('span', { class: 'texto-3 atencao-sub' }, sub), dobrar),
      h('div', { class: 'atencao-corpo', id: 'atencao-corpo' }, h('ul', { class: 'atencao-lista' }, linhas), detalhes));
    caixa.hidden = false;
    aplicarAtencaoAberta();
    foco();
  }
  function aplicarAtencaoAberta() {
    const caixa = $('atencao');
    const b = caixa && caixa.querySelector('.atencao-dobrar');
    if (!b) return;
    caixa.classList.toggle('aberta', !!estado.atencaoAberta);
    b.setAttribute('aria-expanded', String(!!estado.atencaoAberta));
  }

  // ── recados internos (S14): os não lidos no topo, com × por pessoa; os fixos ficam (sem ×) ────
  async function carregarRecados() {
    if (!estado.logado) return;
    try {
      const r = await LP.equipeGet('recados');
      desenharRecados(Array.isArray(r.itens) ? r.itens : []);
    } catch (e) { /* sem equipe.php (ou sem a tabela): sem recados */ }
  }
  LP.recarregarRecados = carregarRecados;
  function desenharRecados(itens) {
    const caixa = $('recados');
    // no topo: os fixos (lidos ou não: "não sai do topo quando alguém lê") e os outros ainda não lidos
    const topo = itens.filter((x) => x.fixo || !x.lido);
    LP.trocar(caixa, topo.slice(0, 4).map((x) => {
      const cartao = h('article', { class: 'recado recado-' + (x.tom || 'nota') + (x.fixo ? ' recado-fixo' : '') },
        h('div', { class: 'recado-cabeca' }, h('b', null, x.titulo), x.fixo ? LP.chip('fixo', 'info', { semPonto: true, title: 'Recado fixo: fica no topo enquanto estiver no ar' }) : null),
        x.texto ? h('p', { class: 'recado-texto' }, x.texto) : null,
        h('p', { class: 'texto-3' }, 'de ' + ((x.por && x.por.nome) || 'alguém da equipe') + ' · ' + LP.relativo(x.criadoEm) + (x.ate ? ' · até ' + LP.dataHora(x.ate) : '')));
      if (x.lido) return cartao;
      // o × de quem leu (o fixo marca como lido e continua no topo, sem o ×)
      const marcar = x.fixo
        ? h('button', { type: 'button', class: 'botao-fantasma botao-pequeno recado-ciente', title: 'Marcar como lido (só para você); o recado fixo continua aqui' }, 'Marcar como lido')
        : h('button', { type: 'button', class: 'botao-icone recado-fechar', 'aria-label': 'Marcar como lido: ' + x.titulo, title: 'Marcar como lido (só para você)' }, LP.icone('x'));
      cartao.querySelector('.recado-cabeca').appendChild(marcar);
      marcar.addEventListener('click', async () => {
        if (marcar.disabled) return;
        marcar.disabled = true;
        try {
          await LP.equipePost({ acao: 'recado_lido', id: x.id });
          if (x.fixo) marcar.remove(); else cartao.remove();
          estado.recadosN = Math.max(0, estado.recadosN - 1);
        } catch (e) { marcar.disabled = false; LP.avisarErro(e); }
      });
      return cartao;
    }), topo.length > 4 ? h('a', { href: '#/equipe?parte=recados', class: 'texto-3' }, 'Mais ' + (topo.length - 4) + ' recados →') : null);
  }

  // ── resumo da plataforma (estado do site, ladrilhos da visão geral, contadores das abas) ────
  LP.atualizarResumo = async function () {
    if (!estado.logado) return;
    if (estado.resumoNoAr) { estado.resumoDeNovo = true; return; }
    estado.resumoNoAr = true;
    try {
      LP.resumo = await LP.adminGet('resumo');
      desenharResumo();
    } catch (e) {
      if (!LP.resumo && LP.desenharPlataforma) LP.desenharPlataforma(null);
    } finally {
      estado.resumoNoAr = false;
      if (estado.resumoDeNovo) { estado.resumoDeNovo = false; LP.atualizarResumo(); }
    }
  };
  /** Depois de uma ação: números, alertas e o pulso na hora (sem esperar os 15 s). */
  LP.depoisDeAgir = function () {
    LP.atualizarResumo();
    carregarAtencao(true);
    carregarAgora();
  };
  function desenharResumo() {
    const r = LP.resumo || {};
    const s = r.site || {};
    const chips = [];
    if (s.manutencao) chips.push(LP.chip('Manutenção ligada', 'perigo'));
    if (s.cadastroAberto === false) chips.push(LP.chip('Cadastro fechado', 'alerta'));
    if (s.aviso) chips.push(LP.chip('Aviso no ar', 'info', { title: s.aviso.texto }));
    if (Array.isArray(s.avisos) && s.avisos.length) chips.push(LP.chip(LP.plural(s.avisos.length, 'aviso no jogo', 'avisos no jogo'), 'info'));
    chips.push(s.livePublica ? LP.chip('Live pública', 'alerta') : LP.chip('Live: só a equipe', 'ok', { title: 'O público não vê a Live interativa' }));
    chips.push(s.imersivoPublico ? LP.chip('Imersivo público', 'alerta') : LP.chip('Imersivo: só a equipe', 'ok', { title: 'O público vê "Em desenvolvimento"' }));
    LP.trocar($('estado-site'), chips);
    // no celular o estado do site fica no menu "⋯": um ponto vermelho nele com a manutenção ligada ou o cadastro fechado
    const menu = document.querySelector('.botoes-topo-celular [data-acao="menu"]');
    if (menu) menu.classList.toggle('com-alerta', !!s.manutencao || s.cadastroAberto === false);
    const m = estado.atual && LP.abas[estado.atual];
    if (m && m.aoResumo) m.aoResumo(r);
    tituloDocumento();
  }

  function ligarTimers() {
    pararTimers();
    carregarAgora();
    estado.timerAgora = setInterval(carregarAgora, 15000);
    estado.timerResumo = setInterval(() => { if (!document.hidden) LP.atualizarResumo(); }, 60000);
    estado.timerAtencao = setInterval(() => { if (!document.hidden) carregarAtencao(); }, 60000);
  }
  function pararTimers() {
    clearInterval(estado.timerAgora);
    clearInterval(estado.timerResumo);
    clearInterval(estado.timerAtencao);
    estado.timerAgora = estado.timerResumo = estado.timerAtencao = 0;
  }

  // ── entrada ─────────────────────────────────────────────────────────────────────────────────
  const ETAPAS = ['form-entrar', 'form-pin', 'form-criar-pin', 'form-trocar-senha', 'painel-desligado'];
  function mostrarEtapa(id) {
    ETAPAS.forEach((x) => { $(x).hidden = x !== id; });
    $('tela-painel').hidden = true;
    $('tela-entrar').hidden = false;
    LP.gaveta.esconder();
  }
  function tremer() {
    const c = $('cartao-entrar');
    if (LP.calmo()) return;
    c.classList.remove('tremer');
    void c.offsetWidth;
    c.classList.add('tremer');
    setTimeout(() => c.classList.remove('tremer'), 600);
  }
  function erroEtapa(id, msg) {
    const e = $(id);
    e.hidden = !msg;
    e.textContent = msg || '';
    if (msg) tremer();
  }
  /** Seis caixas de um dígito: avançam sozinhas, aceitam colar, respondem a Backspace e às setas. */
  function caixasPin(raiz, aoCompletar, primeiraAutocompletar) {
    LP.limpar(raiz);
    const cs = [];
    const oculto = h('input', { type: 'hidden' });
    for (let i = 0; i < 6; i++) {
      const c = h('input', { type: 'text', inputmode: 'numeric', pattern: '[0-9]*', maxlength: 6, class: 'pin-caixa', 'aria-label': 'Dígito ' + (i + 1) + ' de 6',
        autocomplete: i === 0 && primeiraAutocompletar ? 'one-time-code' : 'off' });
      c.addEventListener('input', () => {
        const d = c.value.replace(/\D/g, '');
        if (d.length > 1) { espalhar(d, i); return; }
        c.value = d;
        sincronizar();
        if (d && i < 5) cs[i + 1].focus();
        if (d && i === 5 && oculto.value.length === 6 && aoCompletar) aoCompletar();
      });
      c.addEventListener('keydown', (ev) => {
        if (ev.key === 'Backspace' && !c.value && i > 0) { ev.preventDefault(); cs[i - 1].value = ''; cs[i - 1].focus(); sincronizar(); }
        else if (ev.key === 'ArrowLeft' && i > 0) { ev.preventDefault(); cs[i - 1].focus(); }
        else if (ev.key === 'ArrowRight' && i < 5) { ev.preventDefault(); cs[i + 1].focus(); }
      });
      c.addEventListener('paste', (ev) => {
        const t = (ev.clipboardData && ev.clipboardData.getData('text')) || '';
        const d = t.replace(/\D/g, '');
        if (d) { ev.preventDefault(); espalhar(d, i); }
      });
      c.addEventListener('focus', () => c.select());
      cs.push(c);
      raiz.appendChild(c);
    }
    raiz.appendChild(oculto);
    function espalhar(d, de) {
      for (let k = 0; k < 6 - de && k < d.length; k++) cs[de + k].value = d[k];
      sincronizar();
      const prox = Math.min(5, de + d.length);
      cs[prox].focus();
      if (oculto.value.length === 6 && aoCompletar) aoCompletar();
    }
    function sincronizar() { oculto.value = cs.map((x) => x.value).join(''); }
    return {
      valor: () => oculto.value,
      limpar: () => { cs.forEach((x) => { x.value = ''; }); sincronizar(); },
      focar: () => cs[0].focus(),
    };
  }
  let pinEntrada = null;
  let pinNovo = null;
  let pinRepetir = null;

  async function mostrarEntrar(msg) {
    pararTimers();
    LP.fecharDialogo(true);
    if (estado.atual && LP.abas[estado.atual] && LP.abas[estado.atual].sair) LP.abas[estado.atual].sair();
    estado.atual = null;
    estado.baseAtual = '';
    document.title = 'LENDA · Painel';
    let modo = 'senha';
    try {
      const r = await LP.painelGet('?so=modo', { semExpirar: true });
      modo = r.modo || 'senha';
    } catch (e) { /* sem resposta: a tela de senha de sempre */ }
    if (modo === 'desligado') { mostrarEtapa('painel-desligado'); return; }
    $('campo-email').hidden = modo !== 'contas';
    mostrarEtapa('form-entrar');
    erroEtapa('erro-entrar', '');
    if (msg) { const e = $('erro-entrar'); e.hidden = false; e.textContent = msg; }
    $('senha').value = '';
    (modo === 'contas' && !$('email').value ? $('email') : $('senha')).focus();
  }
  /** Segue a etapa que o servidor mandou (pin → criar_pin → trocar_senha → pronto). */
  async function seguirEtapa(r) {
    const etapa = r && r.etapa;
    if (etapa === 'pin') {
      mostrarEtapa('form-pin');
      erroEtapa('erro-pin', '');
      $('pin-quem').textContent = r.quem && r.quem.nome ? 'Entrando como ' + r.quem.nome + '.' : 'A senha conferiu. Falta o PIN de 6 dígitos.';
      $('pin-restam').textContent = typeof r.restam === 'number' ? 'Restam ' + LP.plural(r.restam, 'tentativa', 'tentativas') + '.' : '';
      // requestSubmit() só existe a partir do Safari 16 (iOS 15 não tem): sem ele, o clique no "Entrar" faz o mesmo
      pinEntrada = caixasPin($('pin-caixas'), () => {
        const f = $('form-pin');
        if (typeof f.requestSubmit === 'function') f.requestSubmit(); else $('botao-pin').click();
      }, true);
      pinEntrada.focar();
      return;
    }
    if (etapa === 'criar_pin') {
      mostrarEtapa('form-criar-pin');
      erroEtapa('erro-criar-pin', '');
      pinNovo = caixasPin($('pin-novo'), () => pinRepetir.focar());
      pinRepetir = caixasPin($('pin-repetir'), null);
      pinNovo.focar();
      return;
    }
    if (etapa === 'trocar_senha') {
      mostrarEtapa('form-trocar-senha');
      erroEtapa('erro-trocar', '');
      $('nova-senha').value = '';
      $('nova-senha-2').value = '';
      $('nova-senha').focus();
      return;
    }
    if (etapa === 'pronto') { await iniciarSessao(); return; }
    mostrarEntrar('');
  }
  LP.aoExpirar = function (codigo) {
    if (!estado.logado) return;
    estado.logado = false;
    LP.sessao = null;
    mostrarEntrar(codigo === 'etapa_expirou' ? 'Demorou demais. Entre de novo.' : 'A sessão do painel acabou (vale 8 h, e cai com 2 h sem uso). Entre de novo: você volta para onde estava.');
  };
  async function iniciarSessao() {
    let s;
    try {
      s = await LP.painelGet('?so=sessao', { semExpirar: true });
    } catch (e) {
      mostrarEntrar(e && e.status === 401 ? (e.codigo === 'etapa_expirou' ? 'Demorou demais. Entre de novo.' : '') : LP.mensagem(e));
      return;
    }
    if (s.etapa !== 'pronto') { seguirEtapa(s); return; }
    LP.sessao = s;
    estado.logado = true;
    estado.recadosN = -1;
    estado.alertasChave = '';
    estado.atencaoChave = '';
    const q = s.quem || {};
    LP.trocar($('quem-sou'), h('span', null, q.nome || 'Admin'), ' ', h('span', { class: 'chip chip-ouro sem-ponto' }, q.papelNome || q.papel || ''));
    montarNav();
    montarNumeros();
    desenharFaixas();
    $('tela-entrar').hidden = true;
    $('tela-painel').hidden = false;
    ligarTimers();
    LP.atualizarResumo();
    carregarAtencao();
    carregarRecados();
    renderizar(true);
  }
  LP.recarregarSessao = async function () {
    try {
      const s = await LP.painelGet('?so=sessao');
      if (s.etapa === 'pronto') { LP.sessao = s; desenharFaixas(); }
      return s;
    } catch (e) { return null; }
  };
  async function sair() {
    if (!(await podeSairDaAba())) return;
    try { await LP.painelPost({ acao: 'sair' }, { semExpirar: true }); } catch (e) { /* sai mesmo assim */ }
    estado.logado = false;
    LP.sessao = null;
    if (LP.abas.visao.esquecer) LP.abas.visao.esquecer();
    LP.resumo = null;
    LP.agora = null;
    mostrarEntrar('');
  }
  LP.sairDoPainel = sair;

  function ligarEntrada() {
    $('mostrar-senha').addEventListener('click', () => {
      const e = $('senha');
      const oculta = e.type === 'password';
      e.type = oculta ? 'text' : 'password';
      $('mostrar-senha').textContent = oculta ? 'ocultar' : 'mostrar';
      $('mostrar-senha').setAttribute('aria-pressed', String(oculta));
      $('mostrar-senha').setAttribute('aria-label', oculta ? 'Ocultar a senha' : 'Mostrar a senha');
      e.focus();
    });
    $('form-entrar').addEventListener('submit', async (e) => {
      e.preventDefault();
      const botao = $('botao-entrar');
      const senha = $('senha').value;
      if (!senha) { erroEtapa('erro-entrar', 'Digite a senha.'); return; }
      LP.ocupado(botao, true, 'Entrando…');
      erroEtapa('erro-entrar', '');
      try {
        const corpo = { acao: 'entrar', senha: senha };
        const email = $('campo-email').hidden ? '' : $('email').value.trim();
        if (email) corpo.email = email;
        const r = await LP.painelPost(corpo, { semExpirar: true });
        $('senha').value = '';
        await seguirEtapa(r);
      } catch (err) {
        if (err && err.codigo === 'painel_desligado') { mostrarEtapa('painel-desligado'); return; }
        erroEtapa('erro-entrar', LP.mensagem(err));
        $('senha').select();
      } finally {
        LP.ocupado(botao, false);
      }
    });
    $('form-pin').addEventListener('submit', async (e) => {
      e.preventDefault();
      const pin = pinEntrada ? pinEntrada.valor() : '';
      if (pin.length !== 6) { erroEtapa('erro-pin', 'O PIN tem 6 dígitos.'); return; }
      const botao = $('botao-pin');
      LP.ocupado(botao, true, 'Conferindo…');
      try {
        const r = await LP.painelPost({ acao: 'conferir_pin', pin: pin }, { semExpirar: true });
        await seguirEtapa(r);
      } catch (err) {
        if (err && err.codigo === 'etapa_expirou') { mostrarEntrar('Demorou demais. Entre de novo.'); return; }
        if (err && err.status === 401 && err.codigo === 'nao_logado') { mostrarEntrar('Entre de novo.'); return; }
        erroEtapa('erro-pin', LP.mensagem(err));
        if (err && err.json && typeof err.json.restam === 'number') $('pin-restam').textContent = 'Restam ' + LP.plural(err.json.restam, 'tentativa', 'tentativas') + '.';
        if (err && err.codigo === 'pin_travado') $('pin-restam').textContent = '';
        if (pinEntrada) { pinEntrada.limpar(); pinEntrada.focar(); }
      } finally {
        LP.ocupado(botao, false);
      }
    });
    $('form-criar-pin').addEventListener('submit', async (e) => {
      e.preventDefault();
      const pin = pinNovo ? pinNovo.valor() : '';
      const rep = pinRepetir ? pinRepetir.valor() : '';
      if (pin.length !== 6) { erroEtapa('erro-criar-pin', 'O PIN tem 6 dígitos (só números).'); return; }
      if (rep !== pin) { erroEtapa('erro-criar-pin', 'Os dois PINs não são iguais.'); pinRepetir.limpar(); pinRepetir.focar(); return; }
      const botao = $('botao-criar-pin');
      LP.ocupado(botao, true, 'Criando…');
      try {
        const r = await LP.painelPost({ acao: 'criar_pin', pin: pin, repetir: rep }, { semExpirar: true });
        await seguirEtapa(r);
      } catch (err) {
        if (err && err.codigo === 'etapa_expirou') { mostrarEntrar('Demorou demais. Entre de novo.'); return; }
        erroEtapa('erro-criar-pin', LP.mensagem(err));
        pinNovo.limpar();
        pinRepetir.limpar();
        pinNovo.focar();
      } finally {
        LP.ocupado(botao, false);
      }
    });
    const forca = () => {
      const n = LP.forcaSenha($('nova-senha').value);
      $('forca-nova').className = 'forca n' + n;
    };
    $('nova-senha').addEventListener('input', forca);
    $('form-trocar-senha').addEventListener('submit', async (e) => {
      e.preventDefault();
      const nova = $('nova-senha').value;
      if (nova.length < 12) { erroEtapa('erro-trocar', 'A senha nova precisa de 12 caracteres ou mais.'); return; }
      if (nova !== $('nova-senha-2').value) { erroEtapa('erro-trocar', 'As duas senhas não são iguais.'); return; }
      const botao = $('botao-trocar');
      LP.ocupado(botao, true, 'Salvando…');
      try {
        const r = await LP.painelPost({ acao: 'trocar_senha', nova: nova }, { semExpirar: true });
        await seguirEtapa(r);
      } catch (err) {
        if (err && err.codigo === 'etapa_expirou') { mostrarEntrar('Demorou demais. Entre de novo.'); return; }
        erroEtapa('erro-trocar', LP.mensagem(err));
      } finally {
        LP.ocupado(botao, false);
      }
    });
    document.querySelectorAll('[data-acao="voltar-entrada"]').forEach((b) => b.addEventListener('click', async () => {
      try { await LP.painelPost({ acao: 'sair' }, { semExpirar: true }); } catch (e) { /* ok */ }
      mostrarEntrar('');
    }));
    const campoSenha = $('nova-senha').parentNode;
    campoSenha.appendChild(LP.botaoMostrarSenha($('nova-senha')));
  }

  // ── abas e painel lateral ───────────────────────────────────────────────────────────────────
  /**
   * A ficha do hash (conta= / carreira= / mensagem=). `anterior`: o hash de antes deste hashchange. Se a ficha abriu vindo
   * da lista da mesma aba (sem ficha), a entrada nova é marcada com essa origem: fechar pelo botão vira history.back().
   * A ficha que fecha (ou troca) pelo voltar leva junto o diálogo que estiver aberto por cima dela (LP.gaveta).
   */
  function sincronizarGaveta(rota, anterior) {
    const q = rota.query;
    const aberta = LP.gaveta.aberta();
    const daLista = !!anterior && !LP.PARAMS_GAVETA.some((k) => LP.rotaDe(anterior).query[k]) && LP.hashBase(anterior) === LP.hashBase(location.hash);
    let abriu = false;
    if (q.conta && LP.abrirFichaConta) {
      if (!aberta || aberta.tipo !== 'conta' || aberta.id !== String(q.conta)) { LP.abrirFichaConta(q.conta); abriu = true; }
    } else if (q.carreira && LP.abrirFichaCarreira) {
      if (!aberta || aberta.tipo !== 'carreira' || aberta.id !== String(q.carreira)) { LP.abrirFichaCarreira(q.carreira); abriu = true; }
    } else if (q.mensagem && LP.abrirFichaMensagem) {
      if (!aberta || aberta.tipo !== 'mensagem' || aberta.id !== String(q.mensagem)) { LP.abrirFichaMensagem(q.mensagem); abriu = true; }
    } else if (aberta) {
      LP.gaveta.esconder();
    }
    if (abriu && daLista) LP.gaveta.marcarOrigem(anterior);
  }
  function renderizar(forcar) {
    let rota = LP.rota();
    // endereço da v3: #/usuario/12 → a ficha no painel lateral da aba Usuários
    if (rota.aba === 'usuario' && rota.partes[1]) {
      history.replaceState(null, '', LP.hash('usuarios', { conta: rota.partes[1] }));
      rota = LP.rota();
    }
    const aba = LP.abas[rota.aba] && ABAS.some((a) => a.id === rota.aba) ? rota.aba : 'visao';
    const base = LP.hashBase(location.hash || '#/visao');
    if (!forcar && aba === estado.atual && base === estado.baseAtual) {
      const anterior = estado.hashAtual;
      estado.hashAtual = location.hash;
      sincronizarGaveta(rota, anterior);
      return;
    }
    const mod = LP.abas[aba];
    const anterior = estado.atual && LP.abas[estado.atual];
    if (anterior && anterior.sair) anterior.sair();
    LP.fecharDialogo(true);
    LP.esconderNovidade();
    document.body.classList.remove('com-lote', 'com-barra');
    document.querySelectorAll('.aba').forEach((s) => { s.hidden = true; });
    const sec = $('aba-' + aba);
    sec.hidden = false;
    sec.classList.remove('esmaecido');
    document.querySelectorAll('.abas a[data-aba]').forEach((a) => {
      if (a.dataset.aba === aba) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    // trocou de aba: o "Precisa de atenção" do celular volta a ficar recolhido
    if (!forcar) { estado.atencaoAberta = false; aplicarAtencaoAberta(); }
    LP.acoesAba();
    const def = ABAS.find((a) => a.id === aba);
    LP.subAba(mod.sub || '');
    LP.tituloAba(mod.titulo || (def && def.titulo));
    if (LP.esconderDica) LP.esconderDica();
    estado.atual = aba;
    estado.baseAtual = base;
    estado.hashAtual = location.hash || '#/visao';
    if (def && def.poder && !LP.pode(def.poder)) {
      LP.trocar(sec, LP.estadoVazio('O seu papel não abre esta parte', 'Peça para quem cuida da equipe (papel Dono) se precisar dela. O servidor barra mesmo que o endereço seja digitado.'));
    } else {
      mod.montar(sec, rota);
    }
    // no computador, o topo; no celular, o título da aba logo abaixo do topo fixo (LP.rolarParaAba)
    if (!forcar) LP.rolarParaAba();
    centralizarAbaAtiva();
    sincronizarGaveta(rota);
  }
  /**
   * A barra de abas do celular rola de lado: a aba ativa fica no meio dela (chegando pelos números, por um alerta, pelo
   * voltar ou por um link, ela ficava cortada na borda). Depois de desenhar (a pílula do contador muda a largura).
   */
  function centralizarAbaAtiva() {
    requestAnimationFrame(() => {
      const nav = $('abas');
      const a = nav && nav.querySelector('a[aria-current="page"]');
      if (!a || nav.scrollWidth <= nav.clientWidth + 1) return;
      const rn = nav.getBoundingClientRect();
      const ra = a.getBoundingClientRect();
      nav.scrollLeft = Math.max(0, nav.scrollLeft + (ra.left - rn.left) - (rn.width - ra.width) / 2);
    });
  }
  async function podeSairDaAba() {
    const atual = estado.atual && LP.abas[estado.atual];
    if (!atual || !atual.podeSair || atual.podeSair()) return true;
    const ok = await LP.dialogo({
      titulo: 'Sair sem salvar?',
      perigo: true,
      botao: 'Descartar alterações',
      texto: (atual.textoSair && atual.textoSair()) || 'Há alterações não salvas nas Configurações. Se sair agora, elas se perdem.',
    });
    if (ok && atual.sair) atual.sair();
    return !!ok;
  }
  // a aba trocou a query sozinha (filtro, busca, página: replaceState, sem hashchange)
  LP.aoTrocarQuery = () => {
    if (!estado.atual) return;
    estado.baseAtual = LP.hashBase(location.hash);
    estado.hashAtual = location.hash;
  };
  window.addEventListener('hashchange', async (ev) => {
    if (!estado.logado) return;
    // a volta do "fechar a ficha" chegou depois de outra navegação: refaz a navegação (LP.gaveta.conferirVolta)
    if (LP.gaveta.conferirVolta(ev)) return;
    const atual = estado.atual && LP.abas[estado.atual];
    const rota = LP.rota();
    const anterior = estado.hashAtual;
    const mudaAba = LP.hashBase(location.hash) !== estado.baseAtual;
    if (mudaAba && atual && atual.podeSair && !atual.podeSair()) {
      const destino = location.hash;
      history.replaceState(null, '', estado.hashAtual);
      if (await podeSairDaAba()) {
        history.replaceState(null, '', destino);
        renderizar();
      }
      return;
    }
    if (!mudaAba) { estado.hashAtual = location.hash; sincronizarGaveta(rota, anterior); return; }
    renderizar();
  });
  window.addEventListener('beforeunload', (e) => {
    if (estado.logado && ((LP.configSujo && LP.configSujo()) || (LP.desafioSujo && LP.desafioSujo()))) { e.preventDefault(); e.returnValue = ''; }
  });

  // ── atalhos ─────────────────────────────────────────────────────────────────────────────────
  function mostrarAtalhos() {
    const linhas = [
      ['/', 'Buscar (nas abas com busca)'],
      ['1 – 9, 0', 'Ir para a aba (na ordem da lateral)'],
      ['R', 'Atualizar a aba'],
      ['T', 'Aparência: Original, Claro ou Alto contraste'],
      ['M', 'Modo discreto (e-mails mascarados)'],
      ['Esc', 'Fechar o diálogo, a ficha ou limpar a busca'],
      ['?', 'Esta lista'],
    ];
    const t = h('table', { class: 'tabela-atalhos' }, h('tbody', null, linhas.map(([k, d]) => h('tr', null, h('td', null, h('kbd', null, k)), h('td', null, d)))));
    LP.dialogo({ titulo: 'Atalhos do teclado', soFechar: true, corpo: t });
  }
  document.addEventListener('keydown', (e) => {
    if (!estado.logado || e.ctrlKey || e.metaKey || e.altKey) return;
    if (LP.dialogoAberto()) return;
    const t = e.target;
    const digitando = t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    if (e.key === 'Escape' && LP.gaveta.aberta() && !(digitando && t.type === 'search' && t.value)) {
      e.preventDefault();
      LP.gaveta.fechar();
      return;
    }
    if (digitando) {
      if (e.key === 'Escape' && t.type !== 'search' && typeof t.blur === 'function') t.blur();
      return;
    }
    if (e.key === '/') {
      const b = document.querySelector('.aba:not([hidden]) [data-busca]');
      if (b) { e.preventDefault(); b.focus(); if (b.select) b.select(); }
    } else if (/^[0-9]$/.test(e.key)) {
      const a = ABAS.find((x) => x.tecla === e.key);
      if (a) { e.preventDefault(); location.hash = '#/' + a.id; }
    } else if (e.key === 'r' || e.key === 'R') {
      const m = LP.abas[estado.atual];
      if (m && m.recarregar) {
        e.preventDefault();
        m.recarregar();
        LP.atualizarResumo();
        carregarAtencao(true);
      }
    } else if (e.key === 't' || e.key === 'T') {
      e.preventDefault();
      trocarTema();
    } else if (e.key === 'm' || e.key === 'M') {
      e.preventDefault();
      trocarDiscreto();
    } else if (e.key === '?') {
      e.preventDefault();
      mostrarAtalhos();
    }
  });

  // ── início ──────────────────────────────────────────────────────────────────────────────────
  function iniciar() {
    ligarEntrada();
    marcarDiscreto();
    document.addEventListener('click', (ev) => {
      const b = ev.target instanceof Element ? ev.target.closest('[data-acao]') : null;
      if (!b) return;
      const acao = b.getAttribute('data-acao');
      if (acao === 'tema') trocarTema();
      else if (acao === 'discreto') trocarDiscreto();
      else if (acao === 'atalhos') mostrarAtalhos();
      else if (acao === 'sair') sair();
      else if (acao === 'menu') abrirMenuCelular();
    });
    // campo de texto em foco (teclado do celular aberto): body.digitando solta a barra "N alterações não salvas" e esconde
    // a barra de lote e a pílula de novidade, que ficariam por cima do campo na janela encolhida (painel.css)
    const digitando = (t) => t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'TEXTAREA'
      || (t.tagName === 'INPUT' && !/^(checkbox|radio|range|color|button|submit|reset|file|hidden|image)$/i.test(t.type || '')));
    // girar o celular (ou o teclado encolher a janela) muda a barra de abas: a ativa volta para o meio
    window.addEventListener('resize', LP.debounce(() => { if (estado.logado) centralizarAbaAtiva(); }, 200));
    document.addEventListener('focusin', (ev) => document.body.classList.toggle('digitando', digitando(ev.target)));
    document.addEventListener('focusout', () => setTimeout(() => document.body.classList.toggle('digitando', digitando(document.activeElement)), 0));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && estado.logado) { carregarAgora(); LP.atualizarResumo(); }
    });
    // Já logado? (?so=sessao diz em que etapa a entrada parou)
    iniciarSessao();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
