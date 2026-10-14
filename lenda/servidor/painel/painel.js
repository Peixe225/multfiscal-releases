/* LENDA · painel do administrador — liga tudo: senha (../api/painel.php, cookie lenda_painel), abas por endereço
 * (#/usuarios, #/usuario/12, #/hall?filtro=suspeitas…), "agora" a cada 15 s, resumo da plataforma, atalhos. */
'use strict';

(function () {
  const LP = window.LP;
  const { h } = LP;
  const $ = LP.$;

  const ORDEM = ['visao', 'usuarios', 'hall', 'denuncias', 'conquistas', 'indicacoes', 'config', 'testes', 'registro'];
  const estado = { logado: false, atual: null, hashAtual: '', timerAgora: 0, timerResumo: 0, resumoNoAr: false, resumoDeNovo: false, titulo: 'Visão geral' };

  LP.resumo = null;

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
  function tituloDocumento() {
    const n = (LP.resumo && LP.resumo.denunciasAbertas) || 0;
    document.title = (n ? '(' + n + ') ' : '') + 'LENDA · Painel' + (estado.titulo ? ' · ' + estado.titulo : '');
  }

  // ── agora (online / jogando) ────────────────────────────────────────────────────────────────
  LP.mostrarAgora = function (a) {
    if (!a) return;
    $('lat-online').textContent = LP.num(a.online || 0);
    $('lat-jogando').textContent = LP.num(a.jogando || 0);
    if (LP.desenharAgoraVisao) LP.desenharAgoraVisao(a);
  };
  async function carregarAgora() {
    if (document.hidden || !estado.logado) return;
    try {
      const r = await LP.painelGet('?so=agora');
      if (r.agora) LP.mostrarAgora(r.agora);
    } catch (e) { /* tenta no próximo ciclo */ }
  }

  // ── resumo da plataforma (contadores da lateral, estado do site, ladrilhos da visão geral) ──
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
  function contador(id, n, titulo) {
    const c = $(id);
    c.hidden = !n;
    c.textContent = n ? LP.inteiro(n) : '';
    if (titulo) c.title = titulo;
  }
  function desenharResumo() {
    const r = LP.resumo || {};
    const u = r.usuarios || {};
    const c = r.carreiras || {};
    contador('cont-denuncias', r.denunciasAbertas || 0);
    contador('cont-hall', c.suspeitas || 0);
    contador('cont-usuarios', u.novosHoje || 0, LP.plural(u.novosHoje || 0, 'conta nova hoje', 'contas novas hoje'));
    const s = r.site || {};
    const chips = [];
    if (s.manutencao) chips.push(LP.chip('Manutenção ligada', 'perigo'));
    if (s.cadastroAberto === false) chips.push(LP.chip('Cadastro fechado', 'alerta'));
    if (s.aviso) chips.push(LP.chip('Aviso no ar', 'info', { title: s.aviso.texto }));
    chips.push(s.livePublica ? LP.chip('Live pública', 'alerta') : LP.chip('Live: só você', 'ok', { title: 'O público não vê a Live interativa' }));
    chips.push(s.imersivoPublico ? LP.chip('Imersivo público', 'alerta') : LP.chip('Imersivo: só você', 'ok', { title: 'O público vê "Em desenvolvimento"' }));
    LP.trocar($('estado-site'), chips);
    if (estado.atual === 'visao' && LP.desenharPlataforma) LP.desenharPlataforma(r);
    if (estado.atual === 'hall' && LP.desenharInfoHall) LP.desenharInfoHall();
    if (estado.atual === 'denuncias' && LP.desenharFiltrosDenuncias) LP.desenharFiltrosDenuncias();
    if (estado.atual === 'indicacoes' && LP.desenharTopoIndicacoes) LP.desenharTopoIndicacoes();
    tituloDocumento();
  }

  function ligarTimers() {
    pararTimers();
    carregarAgora();
    estado.timerAgora = setInterval(carregarAgora, 15000);
    estado.timerResumo = setInterval(() => { if (!document.hidden) LP.atualizarResumo(); }, 60000);
  }
  function pararTimers() {
    clearInterval(estado.timerAgora);
    clearInterval(estado.timerResumo);
    estado.timerAgora = estado.timerResumo = 0;
  }

  // ── telas: senha × painel ───────────────────────────────────────────────────────────────────
  function mostrarEntrar(msg) {
    pararTimers();
    LP.fecharDialogo(true);
    if (estado.atual && LP.abas[estado.atual] && LP.abas[estado.atual].sair) LP.abas[estado.atual].sair();
    estado.atual = null;
    $('tela-painel').hidden = true;
    $('tela-entrar').hidden = false;
    const e = $('erro-entrar');
    e.hidden = !msg;
    e.textContent = msg || '';
    $('senha').value = '';
    $('senha').focus();
    document.title = 'LENDA · Painel';
  }
  function mostrarPainel() {
    $('tela-entrar').hidden = true;
    $('tela-painel').hidden = false;
  }
  LP.aoExpirar = function () {
    if (!estado.logado) return;
    estado.logado = false;
    mostrarEntrar('A sessão do painel acabou (ela vale 12 h). Entre de novo: você volta para onde estava.');
  };
  async function iniciarSessao() {
    estado.logado = true;
    mostrarPainel();
    ligarTimers();
    LP.atualizarResumo();
    renderizar();
  }
  async function sair() {
    if (!(await podeSairDaAba())) return;
    try { await LP.painelPost({ acao: 'sair' }, { semExpirar: true }); } catch (e) { /* sai mesmo assim */ }
    estado.logado = false;
    if (LP.abas.visao.esquecer) LP.abas.visao.esquecer();
    LP.resumo = null;
    mostrarEntrar('');
  }

  // ── abas ────────────────────────────────────────────────────────────────────────────────────
  function renderizar() {
    const rota = LP.rota();
    const aba = LP.abas[rota.aba] ? rota.aba : 'visao';
    const mod = LP.abas[aba];
    const anterior = estado.atual && LP.abas[estado.atual];
    if (anterior && anterior.sair) anterior.sair();
    LP.fecharDialogo(true); // ex.: clicou no dono dentro do detalhe da carreira
    document.querySelectorAll('.aba').forEach((s) => { s.hidden = true; });
    const sec = $('aba-' + aba);
    sec.hidden = false;
    sec.classList.remove('esmaecido');
    const menu = mod.menu || aba;
    document.querySelectorAll('.abas a[data-aba]').forEach((a) => {
      if (a.dataset.aba === menu) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    const ativo = document.querySelector('.abas a[aria-current="page"]');
    if (ativo && ativo.scrollIntoView && window.matchMedia('(max-width: 960px)').matches) ativo.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    LP.acoesAba();
    LP.subAba(mod.sub || '');
    LP.tituloAba(mod.titulo);
    if (LP.esconderDica) LP.esconderDica();
    estado.atual = aba;
    estado.hashAtual = location.hash || '#/visao';
    window.scrollTo(0, 0);
    mod.montar(sec, rota);
  }
  async function podeSairDaAba() {
    const atual = estado.atual && LP.abas[estado.atual];
    if (!atual || !atual.podeSair || atual.podeSair()) return true;
    const ok = await LP.dialogo({
      titulo: 'Sair sem salvar?',
      perigo: true,
      botao: 'Descartar alterações',
      texto: 'Há alterações não salvas nas Configurações. Se sair agora, elas se perdem.',
    });
    if (ok && atual.sair) atual.sair();
    return !!ok;
  }
  window.addEventListener('hashchange', async () => {
    if (!estado.logado) return;
    const atual = estado.atual && LP.abas[estado.atual];
    if (atual && atual.podeSair && !atual.podeSair()) {
      const destino = location.hash;
      history.replaceState(null, '', estado.hashAtual);
      if (await podeSairDaAba()) {
        history.replaceState(null, '', destino);
        renderizar();
      }
      return;
    }
    renderizar();
  });
  window.addEventListener('beforeunload', (e) => {
    if (estado.logado && LP.configSujo && LP.configSujo()) { e.preventDefault(); e.returnValue = ''; }
  });

  // ── atalhos ─────────────────────────────────────────────────────────────────────────────────
  function mostrarAtalhos() {
    const linhas = [
      ['/', 'Buscar (nas abas com busca)'],
      ['1 – 9', 'Ir para a aba (na ordem da lateral)'],
      ['R', 'Atualizar a aba'],
      ['Esc', 'Fechar o diálogo / limpar a busca'],
      ['?', 'Esta lista'],
    ];
    const t = h('table', { class: 'tabela-atalhos' }, h('tbody', null, linhas.map(([k, d]) => h('tr', null, h('td', null, h('kbd', null, k)), h('td', null, d)))));
    LP.dialogo({ titulo: 'Atalhos do teclado', soFechar: true, corpo: t });
  }
  document.addEventListener('keydown', (e) => {
    if (!estado.logado || LP.dialogoAberto() || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    const digitando = t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    if (digitando) {
      if (e.key === 'Escape' && t.type !== 'search' && typeof t.blur === 'function') t.blur();
      return;
    }
    if (e.key === '/') {
      const b = document.querySelector('.aba:not([hidden]) [data-busca]');
      if (b) { e.preventDefault(); b.focus(); if (b.select) b.select(); }
    } else if (/^[1-9]$/.test(e.key)) {
      e.preventDefault();
      location.hash = '#/' + ORDEM[Number(e.key) - 1];
    } else if (e.key === 'r' || e.key === 'R') {
      const m = LP.abas[estado.atual];
      if (m && m.recarregar) {
        e.preventDefault();
        m.recarregar();
        LP.atualizarResumo();
      }
    } else if (e.key === '?') {
      e.preventDefault();
      mostrarAtalhos();
    }
  });

  // ── início ──────────────────────────────────────────────────────────────────────────────────
  function iniciar() {
    $('form-entrar').addEventListener('submit', async (e) => {
      e.preventDefault();
      const botao = $('botao-entrar');
      const senha = $('senha').value;
      if (!senha) return;
      botao.disabled = true;
      $('erro-entrar').hidden = true;
      try {
        await LP.painelPost({ acao: 'entrar', senha: senha }, { semExpirar: true });
        $('senha').value = '';
        await iniciarSessao();
      } catch (err) {
        mostrarEntrar(err && err.status === 401 ? (err.message || 'Senha incorreta.') : LP.mensagem(err));
      } finally {
        botao.disabled = false;
      }
    });
    $('botao-sair').addEventListener('click', sair);
    $('botao-sair-celular').addEventListener('click', sair);
    $('botao-atalhos').addEventListener('click', mostrarAtalhos);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && estado.logado) { carregarAgora(); LP.atualizarResumo(); }
    });
    // Já logado? (só confere o cookie, sem tocar no banco)
    LP.painelGet('?so=eu', { semExpirar: true })
      .then(() => iniciarSessao())
      .catch((e) => mostrarEntrar(e && e.status === 401 ? '' : LP.mensagem(e)));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
