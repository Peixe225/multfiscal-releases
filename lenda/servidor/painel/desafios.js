/* LENDA · painel — Desafios. v3.3 ("As Taças do Rei"): a lista (admin.php?r=desafios), o desafio com os candidatos na
 * ordem em que cumpriram (?r=desafio&id=), o editor (desafio_salvar: título, critério, requisitos, prêmio, regulamento,
 * início/fim, ordem) e as decisões: ativar/desativar (desafio_ativar), "Verificar no jogo" (abre o #/verificar do jogo,
 * que refaz a carreira e registra o resultado), recusar com motivo (candidato_recusar), declarar o vencedor com
 * confirmação digitada (desafio_declarar_vencedor) e reabrir (desafio_reabrir). O prêmio é o texto que o admin escreve.
 * v3.4 (CONTRATO-v34 §C): o tipo "emblema" (todo mundo que cumprir ganha o emblema, concedido sozinho pelo servidor): o
 * editor com o tipo, os critérios novos (Champions, Bolas de Ouro, Copas pela seleção, títulos, gols, nota, clubes,
 * temporadas no mesmo clube, seleção), o ícone e a cor do emblema, a dificuldade e a faixa da tela inicial; e, no desafio
 * de emblema, quem ganhou (paginado, com o filtro) com "Tirar" (emblema_retirar, motivo que o jogador vê) e "Devolver"
 * (emblema_devolver). Com o servidor de antes (sem `modo`), tudo como na v3.3. Endereços: #/desafios,
 * #/desafios?id=N[&estado=][&pagina=], #/desafios?id=N&parte=editar, #/desafios?parte=novo (com prêmio, como na v3.3) e
 * #/desafios?parte=novo&modo=emblema. */
'use strict';

(function () {
  const LP = window.LP;
  const { h } = LP;

  const ESTADOS = ['pendente', 'verificada', 'recusada', 'vencedora'];
  const ESTADOS_EMBLEMA = ['ativo', 'retirado'];
  const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
  const ROTULO_CAMPO = {
    copas: 'Copas do Mundo', libertadores: 'Libertadores', bolasOuro: 'Bolas de Ouro', titulos: 'Títulos', gols: 'Gols', pico: 'Pico de OVR',
    nota: 'Nota de Legado', jogos: 'Jogos', temporadas: 'Temporadas', id: 'Semente', identidade: 'Seleção e posição', replay: 'Replay', trofeus: 'Taças',
    contagem: 'Contagem de taças', bonus: 'Bônus de OVR', servidor: 'Números do servidor',
    // v3.4: os números dos critérios novos e a lista de conquistas na verificação por replay
    champions: 'Champions League', clubes: 'Clubes diferentes', mesmoClube: 'Temporadas no mesmo clube', copasSelecao: 'Copas pela seleção',
    conquistas: 'Conquistas',
  };
  /** §E da v3.3 (servidor de antes da v3.4): o desafio de todas as conquistas não tem prova, o servidor não deixa ativar. */
  const SEM_PROVA = 'O desafio de todas as conquistas não pode ser ativado: as conquistas vêm do aparelho do jogador, sem prova que dê para conferir.';
  const NUMEROS = ['copas', 'libertadores', 'bolasOuro', 'titulos', 'gols', 'pico', 'nota', 'jogos', 'temporadas', 'champions', 'clubes', 'mesmoClube', 'copasSelecao'];
  /**
   * v3.4: as chaves numéricas do critério (CONTRATO-v34 A.0/A.7), na ordem em que aparecem: [chave, rótulo do campo,
   * máximo, singular, plural, ajuda]. Só `copas` e `libertadores` existem no servidor de antes.
   */
  const CHAVES = [
    ['copas', 'Copas do Mundo', 30, 'Copa do Mundo', 'Copas do Mundo', ''],
    ['copasPelaSelecao', 'Copas pela própria seleção', 30, 'Copa do Mundo pela própria seleção', 'Copas do Mundo pela própria seleção', 'Pela seleção com que o jogador foi criado.'],
    ['libertadores', 'Libertadores', 30, 'Libertadores', 'Libertadores', ''],
    ['champions', 'Champions League', 30, 'Champions League', 'Champions League', ''],
    ['bolasOuro', 'Bolas de Ouro', 30, 'Bola de Ouro', 'Bolas de Ouro', ''],
    ['titulos', 'Títulos (todos)', 500, 'título', 'títulos', 'Soma de todas as taças da carreira.'],
    ['gols', 'Gols', 5000, 'gol', 'gols', '"Mais de 1.000" = 1.001.'],
    ['nota', 'Nota de Legado', 100, '', '', 'Ou mais (só a nota da versão de hoje).'],
    ['clubes', 'Clubes diferentes', 40, 'clube diferente', 'clubes diferentes', ''],
    ['temporadasMesmoClube', 'Temporadas no mesmo clube', 30, 'temporada no mesmo clube', 'temporadas no mesmo clube', 'O clube com mais temporadas (as passagens somadas).'],
  ];
  const CHAVES_V33 = ['copas', 'libertadores'];
  const REQ_EMBLEMA = { partidasMin: 0, emailVerificado: false, publicadoNoHall: false, top3Perfil: false };
  const REQ_PREMIO = { partidasMin: 30, emailVerificado: true, publicadoNoHall: true, top3Perfil: true };
  /**
   * A chance medida na calibração (CONTRATO-v34 §K.3 e §K.4: "1 em N carreiras" de quem joga para isso / ao acaso),
   * só para os de fábrica e só enquanto o critério for o de fábrica (mudou o critério, a conta não vale mais).
   */
  const CALIBRACAO = {
    'noite-de-gala': [{ bolasOuro: 1, champions: 1 }, 12, 24], 'andarilho-campeao': [{ clubes: 12, titulos: 20 }, 11, 74],
    'bandeira-do-clube': [{ temporadasMesmoClube: 18, titulos: 20 }, 9, 417],
    'hexa-e-gloria-eterna': [{ copas: 1, libertadores: 2, bolasOuro: 1, nacionalidade: ['BRA'], copasPelaSelecao: 1 }, 66, null],
    'era-de-ouro': [{ bolasOuro: 5, champions: 3 }, 79, 287], 'artilheiro-do-mundo': [{ gols: 800, copas: 1 }, 114, 7740],
    'bi-do-mundo-bi-da-america': [{ copas: 2, libertadores: 2 }, 350, null], imortal: [{ copas: 2, nota: 92 }, 583, null],
    'tacas-do-rei-emblema': [{ copas: 3, libertadores: 2 }, 9577, null], 'mil-gols-e-o-tri': [{ copas: 3, gols: 1001 }, 5250, null],
    'tacas-do-rei': [{ copas: 3, libertadores: 2 }, 9577, null], 'tacas-do-rei-copas': [{ copas: 3 }, 1050, null],
  };

  const dz = {
    modo: 'lista', id: 0, estado: '', pagina: 1, corpo: null, d: null, itens: [], total: 0, conquistasTotal: 87, partidasDiaMax: null,
    pedido: 0, pendentes: null, form: null, original: null, barra: null, erros: {}, salvando: false,
    // v3.4: o servidor manda `modo`? (null = ainda não sei); os países (nomes.json) para a seleção do critério
    v34: null, paises: {}, emblemas: null, novoModo: 'primeiro',
  };

  // ── textos ──────────────────────────────────────────────────────────────────────────────────
  const ehEmblema = (D) => !!D && D.modo === 'emblema';
  const nomePais = (c) => dz.paises[c] || c;
  /** "3 Copas do Mundo + 2 Libertadores numa carreira do Clássico" / "Todas as 87 conquistas provadas na conta". */
  function textoCriterio(c, total) {
    c = c || {};
    if (c.todasConquistas) return 'Todas as ' + LP.inteiro(total || dz.conquistasTotal) + ' conquistas ' + (dz.v34 ? 'provadas ' : '') + 'na conta';
    const p = [];
    const copas = Number(c.copas) || 0;
    const pela = Number(c.copasPelaSelecao) || 0;
    CHAVES.forEach(([k, , , um, varios]) => {
      const n = Number(c[k]) || 0;
      if (!n) return;
      // as Copas e as Copas pela própria seleção juntas ("3 Copas do Mundo (1 pela própria seleção)")
      if (k === 'copas' && pela && pela >= n) return;
      if (k === 'copas' && pela) { p.push(LP.plural(n, um, varios) + ' (' + LP.inteiro(pela) + ' pela própria seleção)'); return; }
      if (k === 'copasPelaSelecao' && copas && copas > n) return;
      if (k === 'nota') p.push('Nota de Legado ' + LP.inteiro(n) + ' ou mais');
      else if (k === 'gols' && n > 1000 && n % 1000 === 1) p.push('mais de ' + LP.inteiro(n - 1) + ' gols');
      else p.push(LP.plural(n, um, varios));
    });
    let t = p.join(' + ');
    t = t ? t + ' numa carreira do Clássico' : '';
    if (Array.isArray(c.nacionalidade) && c.nacionalidade.length) {
      const sel = (c.nacionalidade.length === 1 ? 'seleção: ' : 'seleções: ') + c.nacionalidade.map(nomePais).join(', ') + ' (a mesma do começo ao fim)';
      t = t ? t + ' · ' + sel : 'Uma carreira do Clássico · ' + sel;
    }
    return t || '—';
  }
  function chipsRequisitos(r, criterio, emblema) {
    r = r || {};
    const conq = criterio && criterio.todasConquistas;
    const cs = [];
    if (r.partidasMin) cs.push(LP.chip(LP.plural(r.partidasMin, 'partida', 'partidas') + ' com a conta', 'info', { semPonto: true }));
    if (r.emailVerificado) cs.push(LP.chip('E-mail confirmado', 'info', { semPonto: true }));
    if (r.publicadoNoHall && !conq) cs.push(LP.chip('Publicada no Hall', 'info', { semPonto: true }));
    if (r.top3Perfil && !conq) cs.push(LP.chip('Entre as 3 do perfil', 'info', { semPonto: true }));
    if (emblema && !cs.length) cs.push(LP.chip('Sem requisito de conta', '', { semPonto: true, title: 'Toda conta com uma carreira-prova que cumpre o critério ganha' }));
    if (!conq) {
      cs.push(dz.v34 ? LP.chip('Carreira-prova (semente do servidor + replay)', '', { semPonto: true, title: 'Carreira do Clássico começada com a conta (a semente que o servidor sorteou) e com o replay: é o que deixa a equipe refazer e conferir' })
        : LP.chip('Com replay (Clássico desta versão)', '', { semPonto: true, title: 'O jogo grava as escolhas da carreira: é o que deixa a equipe refazer a carreira e conferir' }));
    }
    return cs.length ? h('span', { class: 'chips' }, cs) : h('span', { class: 'texto-3' }, 'sem requisitos');
  }
  /** Situação do desafio: Tem vencedor / Encerrado / Valendo / Começa em… / Desativado. */
  function situacao(D) {
    const agora = Date.now();
    if (D.vencedor) return LP.chip('Tem vencedor', 'ouro', { semPonto: true });
    if (D.encerrado) return LP.chip('Encerrado', '', { title: D.fim ? 'Acabou em ' + LP.dataHoraAno(D.fim) : '' });
    if (D.valendo) return LP.chip('Valendo', 'ok', { title: ehEmblema(D) ? 'Ativo e no prazo: quem cumprir ganha o emblema na hora' : 'Ativo e no prazo: quem cumprir tudo vira candidato agora' });
    if (D.ativo && D.inicio && Date.parse(D.inicio) > agora) return LP.chip('Começa ' + LP.dataHora(D.inicio), 'info');
    return LP.chip('Desativado', 'tracejado', { semPonto: true, title: ehEmblema(D) ? 'Não aparece no jogo e ninguém ganha o emblema' : 'Não aparece no jogo e ninguém vira candidato' });
  }
  function textoPrazo(D) {
    const ini = D.inicio ? 'de ' + LP.dataHoraAno(D.inicio) : 'começa quando for ativado';
    const fim = D.fim ? 'até ' + LP.dataHoraAno(D.fim) : 'sem data para acabar';
    return ini + ' · ' + fim + ' (Brasília)';
  }
  /** A chance da calibração ("~1 em 12 carreiras de quem joga para isso · 1 em 24 ao acaso"), só no critério de fábrica. */
  function textoChance(D) {
    const c = CALIBRACAO[D.slug];
    if (!c || JSON.stringify(ordenado(D.criterio)) !== JSON.stringify(ordenado(c[0]))) return null;
    return '~1 em ' + LP.inteiro(c[1]) + ' carreiras de quem joga para isso' + (c[2] ? ' · 1 em ' + LP.inteiro(c[2]) + ' ao acaso' : ' · ao acaso, não saiu');
  }
  const ordenado = (o) => Object.keys(o || {}).sort().reduce((a, k) => { a[k] = o[k]; return a; }, {});
  /** ISO com milésimos → "18/10/2026 09:00:00,123" (Brasília): o "em" decide quem foi o primeiro. */
  function comMilesimos(iso) {
    const t = Date.parse(iso || '');
    if (isNaN(t)) return '—';
    const d = new Date(t - LP.FUSO_MS);
    const z = (n, k) => String(n).padStart(k || 2, '0');
    return z(d.getUTCDate()) + '/' + z(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear() + ' ' + z(d.getUTCHours()) + ':' + z(d.getUTCMinutes()) + ':' + z(d.getUTCSeconds()) + ',' + z(d.getUTCMilliseconds(), 3);
  }
  const curto = (t, n) => { const x = String(t || '').trim(); return x.length > n ? x.slice(0, n - 1) + '…' : x; };
  const diaDeIso = (iso) => (iso ? new Date(Date.parse(iso) - LP.FUSO_MS).toISOString().slice(0, 10) : '');
  const somaCand = (D) => ((D.candidatos && D.candidatos.pendente) || 0) + ((D.candidatos && D.candidatos.verificada) || 0);
  const ganharam = (D) => (D.emblemas && D.emblemas.ativos) || 0;
  const emblemaDe = (D) => Object.assign({ titulo: D.titulo }, D.emblema || {});
  const linkJogoAbs = (texto, href, o) => {
    const a = h('a', { href: href, target: '_blank', rel: 'noopener', class: (o && o.tipo ? 'botao-' + o.tipo : 'botao') + (o && o.pequeno ? ' botao-pequeno' : ''), title: o && o.title });
    a.appendChild(LP.icone((o && o.icone) || 'externo'));
    a.appendChild(h('span', null, texto));
    a.addEventListener('click', (ev) => ev.stopPropagation());
    return a;
  };
  LP.linkJogoAbs = linkJogoAbs;
  /**
   * v3.4: id → D (a lista do ?r=desafios, guardada por 60 s): a ficha da conta e a da carreira tiram dela o ícone, a cor e
   * a dificuldade dos emblemas (o ?r=usuario e o ?r=carreira só mandam {id, slug, titulo} do desafio).
   */
  let mapaGuardado = null;
  LP.mapaDesafios = function () {
    if (mapaGuardado && Date.now() - mapaGuardado.em < 60000) return mapaGuardado.p;
    const p = LP.adminGet('desafios').then((r) => {
      const m = {};
      (Array.isArray(r.itens) ? r.itens : []).forEach((D) => { m[D.id] = D; });
      return m;
    });
    mapaGuardado = { em: Date.now(), p: p };
    p.catch(() => { mapaGuardado = null; });
    return p;
  };
  LP.esquecerMapaDesafios = () => { mapaGuardado = null; };
  const lerV34 = (itens) => { if (itens.length) dz.v34 = itens.some((D) => D && D.modo !== undefined); };

  // ═══ montar ════════════════════════════════════════════════════════════════════════════════
  function montar(raiz, rota) {
    const q = rota.query;
    dz.id = /^\d{1,10}$/.test(q.id || '') ? Number(q.id) : 0;
    dz.modo = q.parte === 'novo' ? 'novo' : dz.id && q.parte === 'editar' ? 'editar' : dz.id ? 'detalhe' : 'lista';
    dz.estado = ESTADOS.includes(q.estado) || ESTADOS_EMBLEMA.includes(q.estado) ? q.estado : '';
    dz.pagina = Math.max(1, parseInt(q.pagina, 10) || 1);
    dz.novoModo = q.modo === 'emblema' ? 'emblema' : 'primeiro';
    dz.d = null;
    dz.form = null;
    dz.original = null;
    dz.pendentes = null;
    dz.emblemas = null;
    // um pedido da tela anterior (a recarga que o pulso pediu) que chegar depois não desenha por cima desta
    dz.pedido++;
    LP.unico('desafio');
    LP.unico('desafios');
    dz.corpo = h('div');
    LP.trocar(raiz, dz.corpo);
    LP.trocar(dz.corpo, LP.estadoCarregando(6));
    if (dz.modo === 'lista') carregarLista();
    else if (dz.modo === 'novo') carregarParaNovo();
    else carregarDesafio();
  }
  /** Os países do nomes.json (a seleção do critério com o nome); sem o arquivo, os códigos. */
  const nomesPaises = () => LP.nomes().then((n) => { dz.paises = (n && n.paises) || {}; }).catch(() => {});

  // ═══ lista ═════════════════════════════════════════════════════════════════════════════════
  async function carregarLista(silencioso) {
    const n = ++dz.pedido;
    if (silencioso && dz.corpo) dz.corpo.classList.add('esmaecido');
    try {
      const [r] = await Promise.all([LP.adminGet('desafios', {}, { sinal: LP.unico('desafios') }), nomesPaises()]);
      if (n !== dz.pedido || !LP.visivel(dz.corpo) || dz.modo !== 'lista') return;
      dz.conquistasTotal = r.conquistasTotal || dz.conquistasTotal;
      dz.partidasDiaMax = r.partidasDiaMax !== undefined ? r.partidasDiaMax : dz.partidasDiaMax;
      dz.pendentes = (LP.agora && LP.agora.acao && LP.agora.acao.candidatosPendentes) ?? null;
      const itens = Array.isArray(r.itens) ? r.itens : [];
      lerV34(itens);
      desenharLista(itens);
    } catch (e) {
      if (LP.cancelado(e) || n !== dz.pedido || (e && e.status === 401) || !LP.visivel(dz.corpo)) return;
      LP.trocar(dz.corpo, LP.estadoErro(e, () => carregarLista()));
    } finally {
      if (dz.corpo) dz.corpo.classList.remove('esmaecido');
    }
  }

  function desenharLista(itens) {
    LP.trocarQuery('desafios', {});
    const valendo = itens.filter((D) => D.valendo);
    const emb = itens.filter(ehEmblema);
    const premio = itens.filter((D) => !ehEmblema(D));
    const esperando = premio.reduce((t, D) => t + somaCand(D), 0);
    const dados = emb.reduce((t, D) => t + ganharam(D), 0);
    const retirados = emb.reduce((t, D) => t + ((D.emblemas && D.emblemas.retirados) || 0), 0);
    LP.subAba(LP.plural(itens.length, 'desafio', 'desafios') + ' · ' + (valendo.length ? LP.plural(valendo.length, 'valendo agora', 'valendo agora') : 'nenhum valendo agora'));
    // v3.4: os dois tipos têm o seu botão (o endereço de sempre, #/desafios?parte=novo, continua sendo o de prêmio)
    const criar = !LP.pode('config') ? [] : dz.v34
      ? [LP.botao('Criar desafio de emblema', () => { location.hash = '#/desafios?parte=novo&modo=emblema'; }, { tipo: 'ouro', icone: 'mais' }),
        LP.botao('Criar com prêmio', () => { location.hash = '#/desafios?parte=novo'; }, { tipo: 'fantasma', icone: 'mais', title: 'Um vencedor (o primeiro que cumprir, verificado no jogo) e o prêmio que você escreve' })]
      : [LP.botao('Criar desafio', () => { location.hash = '#/desafios?parte=novo'; }, { tipo: 'ouro', icone: 'mais' })];
    LP.acoesAba(...criar, LP.linkJogo('Ver no jogo', '#/desafios', { tipo: 'fantasma', title: 'A tela Desafios do jogo (outra aba)' }));
    const L = LP.ladrilho;
    const valEmb = valendo.filter(ehEmblema).length;
    const ladrilhos = h('div', { class: 'ladrilhos espaco-baixo' },
      L('Valendo agora', LP.inteiro(valendo.length), !valendo.length ? 'ative um desafio para ele aparecer no jogo'
        : emb.length ? LP.plural(valEmb, 'de emblema', 'de emblema') + ' · ' + LP.plural(valendo.length - valEmb, 'com prêmio', 'com prêmio') : valendo.map((D) => D.titulo).join(' · '),
      { classe: valendo.length ? 'ladrilho-ok' : '' }),
      emb.length ? L('Emblemas dados', LP.inteiro(dados), LP.plural(emb.filter((D) => ganharam(D) > 0).length, 'desafio com dono', 'desafios com dono') + (retirados ? ' · ' + LP.plural(retirados, 'retirado', 'retirados') : '')) : null,
      L('Candidatos esperando', LP.inteiro(esperando), emb.length ? 'nos desafios com prêmio' : 'verificação no jogo ou o vencedor', { classe: esperando ? 'ladrilho-alerta' : '' }),
      L('Partidas por dia que contam', dz.partidasDiaMax === null || dz.partidasDiaMax === undefined ? '—' : LP.inteiro(dz.partidasDiaMax), 'muda em Configurações', { href: '#/config' }),
      L('Conquistas no jogo', LP.inteiro(dz.conquistasTotal), 'o desafio de todas as conquistas'));
    const ajuda = LP.ajuda(dz.v34
      ? 'Dois tipos. Emblema: toda conta com uma carreira-prova (semente do servidor + replay) que cumpre o critério ganha o emblema na hora, sozinha — inclusive as carreiras que já estavam na conta; a equipe pode tirar. Prêmio: quem cumpre tudo vira candidato (a hora com milésimos decide o primeiro); antes de declarar o vencedor, "Verificar no jogo" refaz a carreira e registra se bateu. O prêmio é o texto que você escreve.'
      : 'Quem cumpre o critério e todos os requisitos vira candidato sozinho (o servidor anota a hora com milésimos: o primeiro é o de menor hora). Antes de declarar o vencedor, use "Verificar no jogo": o jogo refaz a carreira com as mesmas escolhas e registra aqui se bateu. Os desafios nascem desativados e o prêmio é o texto que você escreve.');
    if (!itens.length) {
      LP.trocar(dz.corpo, ajuda, ladrilhos, LP.estadoVazio('Nenhum desafio', 'O instalar.php cria os de fábrica.',
        LP.pode('config') ? LP.botao('Criar desafio', () => { location.hash = '#/desafios?parte=novo'; }, { tipo: 'ouro', icone: 'mais' }) : null));
      return;
    }
    if (!emb.length) {
      LP.trocarNoLugar(dz.corpo, ajuda, ladrilhos, h('div', { class: 'grade-desafios' }, itens.map(cartaoDesafio)));
      return;
    }
    const grupo = (id, titulo, sub, lista) => (lista.length ? h('section', { class: 'grupo-desafios', 'aria-labelledby': id },
      h('div', { class: 'grupo-cabeca' }, h('h2', { id: id }, titulo), h('span', { class: 'texto-3' }, sub)),
      h('div', { class: 'grade-desafios' }, lista.map(cartaoDesafio))) : null);
    LP.trocarNoLugar(dz.corpo, ajuda, ladrilhos,
      grupo('dz-g-emblema', 'Desafios com emblema', 'todo mundo que cumprir ganha · ' + LP.plural(emb.filter((D) => D.valendo).length, 'valendo', 'valendo') + ' · ' + LP.plural(emb.filter((D) => D.home).length, 'na faixa da tela inicial', 'na faixa da tela inicial'), emb),
      grupo('dz-g-premio', 'Desafios com prêmio', 'o primeiro que cumprir, verificado no jogo', premio));
  }

  function cartaoDesafio(D) {
    if (ehEmblema(D)) return cartaoEmblema(D);
    const esp = somaCand(D);
    const c = D.candidatos || {};
    const contagens = [];
    if (c.pendente) contagens.push(LP.chip(LP.plural(c.pendente, 'esperando verificação', 'esperando verificação'), 'alerta', { semPonto: true }));
    if (c.verificada) contagens.push(LP.chip(LP.plural(c.verificada, 'verificada', 'verificadas'), 'ok', { semPonto: true }));
    if (c.recusada) contagens.push(LP.chip(LP.plural(c.recusada, 'recusada', 'recusadas'), '', { semPonto: true }));
    const abrir = () => { location.hash = '#/desafios?id=' + D.id; };
    const art = h('article', { class: 'cartao-desafio' + (D.valendo ? ' valendo' : '') + (D.vencedor ? ' com-vencedor' : ''), dataset: { id: D.id, modo: 'primeiro' } },
      h('div', { class: 'desafio-topo' },
        h('div', { class: 'desafio-titulo' }, LP.icone('trofeu'), h('h2', null, h('a', { href: '#/desafios?id=' + D.id, class: 'link-discreto' }, D.titulo))),
        situacao(D)),
      h('p', { class: 'mono texto-3 quebra' }, D.slug),
      D.descricao ? h('p', { class: 'texto-2' }, D.descricao) : null,
      h('dl', { class: 'desafio-dados' },
        LP.dado('O que vale', h('b', null, textoCriterio(D.criterio)), { largo: true }),
        LP.dado('Requisitos', chipsRequisitos(D.requisitos, D.criterio), { largo: true }),
        LP.dado('Prêmio', D.premio ? h('span', { class: 'desafio-premio' }, curto(D.premio, 160))
          : h('span', { class: 'texto-3' }, 'vazio: o jogo mostra "O prêmio deste desafio será anunciado aqui"'), { largo: true }),
        LP.dado('Prazo', textoPrazo(D), { largo: true }),
        LP.dado('Candidatos', contagens.length ? h('span', { class: 'chips' }, contagens) : h('span', { class: 'texto-3' }, 'nenhum ainda'), { largo: true })),
      D.vencedor ? h('p', { class: 'faixa faixa-ouro' }, h('b', null, 'Vencedor: '), D.vencedor.excluido ? 'conta excluída (LGPD)' : [LP.linkUsuario(D.vencedor.usuario), D.vencedor.carreira && D.vencedor.carreira.jogador ? ' · ' + D.vencedor.carreira.jogador : ''],
        D.vencedor.declaradoEm ? h('span', { class: 'texto-3' }, ' · declarado ' + LP.relativo(D.vencedor.declaradoEm)) : null) : null,
      h('div', { class: 'botoes desafio-botoes' },
        LP.botao(esp ? 'Ver ' + LP.plural(esp, 'candidato', 'candidatos') : 'Abrir', abrir, { tipo: esp ? 'ouro' : 'fantasma', pequeno: true, icone: 'olho' }),
        LP.pode('config') ? LP.botao('Editar', () => { location.hash = '#/desafios?id=' + D.id + '&parte=editar'; }, { tipo: 'fantasma', pequeno: true, icone: 'lapis' }) : null,
        LP.pode('config') && !D.vencedor ? botaoAtivar(D, () => carregarLista(true), true) : null));
    return art;
  }

  /** v3.4: o cartão do desafio de emblema (a moeda, a dificuldade, a faixa da tela inicial e quantos ganharam). */
  function cartaoEmblema(D) {
    const e = D.emblemas || {};
    const n = e.ativos || 0;
    const chance = textoChance(D);
    const contagens = [];
    if (n) contagens.push(LP.chip(LP.plural(n, 'conta com o emblema', 'contas com o emblema'), 'ok', { semPonto: true }));
    if (e.retirados) contagens.push(LP.chip(LP.plural(e.retirados, 'retirado', 'retirados'), 'tracejado', { semPonto: true }));
    const abrir = () => { location.hash = '#/desafios?id=' + D.id; };
    return h('article', { class: 'cartao-desafio cartao-emblema' + (D.valendo ? ' valendo' : ''), dataset: { id: D.id, modo: 'emblema' } },
      h('div', { class: 'desafio-topo' },
        h('div', { class: 'desafio-titulo' }, LP.emblema(emblemaDe(D), { tamanho: 'g', rotulo: null }),
          h('h2', null, h('a', { href: '#/desafios?id=' + D.id, class: 'link-discreto' }, D.titulo))),
        situacao(D)),
      h('div', { class: 'chips' }, h('span', { class: 'mono texto-3 quebra' }, D.slug), LP.chipDificuldade(D.dificuldade),
        D.home ? LP.chip('Na faixa da tela inicial', 'info', { semPonto: true, title: 'Aparece na faixa discreta de desafios da tela inicial do jogo (os marcados vêm primeiro)' }) : null),
      D.descricao ? h('p', { class: 'texto-2' }, D.descricao) : null,
      h('dl', { class: 'desafio-dados' },
        LP.dado('O que vale', h('b', null, textoCriterio(D.criterio)), { largo: true }),
        LP.dado('Requisitos', chipsRequisitos(D.requisitos, D.criterio, true), { largo: true }),
        chance ? LP.dado('Calibração', chance, { largo: true }) : null,
        LP.dado('Prazo', textoPrazo(D), { largo: true }),
        LP.dado('Ganharam', contagens.length ? h('span', { class: 'chips' }, contagens) : h('span', { class: 'texto-3' }, 'ninguém ainda'), { largo: true })),
      h('div', { class: 'botoes desafio-botoes' },
        LP.botao(n || e.retirados ? 'Ver quem ganhou (' + LP.inteiro(n) + ')' : 'Abrir', abrir, { tipo: 'fantasma', pequeno: true, icone: 'olho' }),
        LP.pode('config') ? LP.botao('Editar', () => { location.hash = '#/desafios?id=' + D.id + '&parte=editar'; }, { tipo: 'fantasma', pequeno: true, icone: 'lapis' }) : null,
        LP.pode('config') ? botaoAtivar(D, () => carregarLista(true), true) : null));
  }

  // ═══ ativar / desativar ════════════════════════════════════════════════════════════════════
  function botaoAtivar(D, depois, pequeno) {
    // §E da v3.3: com o servidor de antes, o de todas as conquistas não ativa (sem prova); na v3.4 a prova são as carreiras
    if (!D.ativo && D.criterio && D.criterio.todasConquistas && D.modo === undefined) {
      return LP.botao('Ativar', () => {}, { tipo: 'ok', pequeno: !!pequeno, icone: 'jogar', disabled: true, title: SEM_PROVA });
    }
    return D.ativo
      ? LP.botao('Desativar', () => ativar(D, false, depois), { tipo: 'fantasma', pequeno: !!pequeno, icone: 'bloquear' })
      : LP.botao('Ativar', () => ativar(D, true, depois), { tipo: 'ok', pequeno: !!pequeno, icone: 'jogar' });
  }
  async function ativar(D, sim, depois) {
    const emb = ehEmblema(D);
    const texto = [];
    if (sim) {
      if (emb) {
        texto.push(h('p', null, 'O desafio aparece no jogo (tela Desafios' + (D.home ? ' e a faixa da tela inicial' : '') + ') e o servidor dá o emblema a toda conta com uma carreira-prova que cumpre o critério — também às carreiras que já estão nas contas, agora.'));
        if (D.criterio && D.criterio.todasConquistas) texto.push(h('p', { class: 'faixa faixa-info' }, 'Todas as conquistas: vale a conta com as ' + LP.inteiro(dz.conquistasTotal) + ' provadas por carreiras (as do aparelho não contam).'));
      } else {
        texto.push(h('p', null, 'O desafio aparece no jogo (tela Desafios e o destaque na tela inicial) e o servidor passa a marcar como candidato quem cumprir tudo, na ordem da hora.'));
        if (!D.premio) texto.push(h('p', { class: 'faixa faixa-alerta' }, 'O prêmio está vazio: o jogo mostra "O prêmio deste desafio será anunciado aqui". Dá para escrever depois em Editar.'));
        if (D.criterio && D.criterio.todasConquistas && D.modo !== undefined) texto.push(h('p', { class: 'faixa faixa-info' }, 'Todas as conquistas: vira candidata a conta com as ' + LP.inteiro(dz.conquistasTotal) + ' provadas por carreiras; o vencedor só sai com as ' + LP.inteiro(dz.conquistasTotal) + ' conferidas no replay (o lote do #/verificar).'));
      }
      if (!D.inicio) texto.push(h('p', { class: 'faixa faixa-info' }, emb ? 'Sem data de início: ele começa agora (as carreiras-prova de antes também valem: emblema não é corrida).' : 'Sem data de início: ele começa agora. Carreiras salvas antes de agora não valem.'));
      else if (Date.parse(D.inicio) > Date.now()) texto.push(h('p', { class: 'faixa faixa-info' }, 'Começa em ' + LP.dataHoraAno(D.inicio) + ' (Brasília). Até lá aparece no jogo como "Começa em…".'));
      const item = (cond, t) => h('li', null, h('span', { class: cond ? 'sim' : 'nao', 'aria-hidden': 'true' }, cond ? '✓' : '✗'), h('span', null, t));
      texto.push(h('ul', { class: 'lista-checagem' },
        item(true, 'O que vale: ' + textoCriterio(D.criterio)),
        item(true, 'Prazo: ' + textoPrazo(D)),
        emb ? item(true, 'Emblema: ' + (LP.NOMES_ICONE_EMBLEMA[(D.emblema || {}).icone] || 'medalha') + (D.dificuldade ? ' · ' + LP.NOMES_DIFICULDADE[D.dificuldade] : ''))
          : item(!!D.premio, D.premio ? 'Prêmio escrito' : 'Prêmio ainda vazio'),
        item(!!D.regulamento, D.regulamento ? 'Regulamento escrito' : 'Regulamento vazio')));
    } else {
      texto.push(h('p', null, emb ? 'O desafio sai do jogo e ninguém mais ganha o emblema. Quem já ganhou continua com ele (dá para tirar um por um em "Quem ganhou").'
        : 'O desafio sai do jogo e para de marcar candidatos. Os candidatos que já existem continuam aqui, com o estado de agora.'));
    }
    let resp = null;
    const r = await LP.dialogo({
      titulo: (sim ? 'Ativar' : 'Desativar') + ' “' + D.titulo + '”',
      botao: sim ? 'Ativar desafio' : 'Desativar desafio',
      gerundio: sim ? 'Ativando…' : 'Desativando…',
      tipoBotao: sim ? 'ok' : 'perigo',
      texto: texto,
      executar: async () => { resp = await LP.adminPost({ acao: 'desafio_ativar', id: D.id, ativo: sim }); return resp; },
    });
    if (!r || !resp) return;
    const novos = emb ? resp.emblemasNovos ?? resp.candidatosNovos : resp.candidatosNovos;
    LP.esquecerMapaDesafios();
    LP.avisar(sim ? '“' + D.titulo + '” ativado' + (novos ? ' · ' + (emb ? LP.plural(novos, 'conta ganhou o emblema', 'contas ganharam o emblema') : LP.plural(novos, 'candidato novo', 'candidatos novos')) : '') + '. Já aparece no jogo.' : '“' + D.titulo + '” desativado. Saiu do jogo.');
    LP.depoisDeAgir();
    if (depois) depois(resp.desafio);
  }

  // ═══ desafio + candidatos (ou quem ganhou o emblema) ═══════════════════════════════════════
  async function carregarDesafio(silencioso) {
    const n = ++dz.pedido;
    if (silencioso && dz.corpo) dz.corpo.classList.add('esmaecido');
    try {
      const modo = dz.modo;
      const est = dz.modo === 'detalhe' ? dz.estado : '';
      const [r] = await Promise.all([LP.adminGet('desafio', { id: dz.id, estado: est, pagina: dz.modo === 'detalhe' ? dz.pagina : 1 }, { sinal: LP.unico('desafio') }), nomesPaises()]);
      if (n !== dz.pedido || !LP.visivel(dz.corpo) || dz.modo !== modo || (modo !== 'detalhe' && modo !== 'editar')) return;
      dz.d = r.desafio;
      lerV34([dz.d]);
      const cs = ehEmblema(dz.d) && r.emblemas ? r.emblemas : r.candidatos || {};
      dz.itens = Array.isArray(cs.itens) ? cs.itens : [];
      dz.total = cs.total || 0;
      dz.porPagina = cs.porPagina || 50;
      dz.pendentes = (LP.agora && LP.agora.acao && LP.agora.acao.candidatosPendentes) ?? null;
      if (dz.modo === 'editar') montarEditor(dz.d);
      else desenharDesafio();
    } catch (e) {
      if (LP.cancelado(e) || n !== dz.pedido || (e && e.status === 401) || !LP.visivel(dz.corpo)) return;
      LP.trocar(dz.corpo, e && e.status === 404
        ? LP.estadoVazio('Desafio não encontrado', 'O endereço tem um id que não existe.', h('a', { href: '#/desafios', class: 'botao-fantasma' }, 'Ver todos os desafios'))
        : LP.estadoErro(e, () => carregarDesafio()));
    } finally {
      if (dz.corpo) dz.corpo.classList.remove('esmaecido');
    }
  }
  const recarregarDesafio = () => { if (dz.modo === 'detalhe') carregarDesafio(true); };

  function desenharDesafio() {
    const D = dz.d;
    const emb = ehEmblema(D);
    // o filtro de um tipo não vale no outro (#/desafios?id=N&estado=pendente num desafio de emblema = todos)
    if (dz.estado && (emb ? !ESTADOS_EMBLEMA.includes(dz.estado) : !ESTADOS.includes(dz.estado))) dz.estado = '';
    LP.tituloAba(D.titulo);
    LP.subAba((emb ? 'Desafio de emblema · ' : 'Desafio · ') + D.slug);
    LP.trocarQuery('desafios', { id: D.id, estado: dz.estado, pagina: dz.pagina > 1 ? dz.pagina : '' });
    const acoes = [];
    if (LP.pode('config')) {
      acoes.push(LP.botao('Editar', () => { location.hash = '#/desafios?id=' + D.id + '&parte=editar'; }, { tipo: 'fantasma', icone: 'lapis' }));
      if (!D.vencedor) acoes.push(botaoAtivar(D, recarregarDesafio));
      if (D.vencedor) acoes.push(LP.botao('Reabrir (tirar o vencedor)', () => reabrir(D), { tipo: 'perigo', icone: 'restaurar' }));
    }
    acoes.push(LP.linkJogo('Ver no jogo', emb ? '#/desafios?d=' + encodeURIComponent(D.slug) : '#/desafios', { tipo: 'fantasma', title: 'A tela Desafios do jogo (outra aba)' }));
    acoes.push(h('a', { href: LP.hash('registro', { alvo: 'desafio:' + D.id }), class: 'botao-fantasma', title: 'Tudo o que a equipe fez neste desafio' }, LP.icone('arquivo'), h('span', null, 'Ver no Registro')));
    LP.acoesAba();
    const voltar = h('a', { href: '#/desafios', class: 'link-voltar-aba' }, LP.icone('voltar'), h('span', null, 'Todos os desafios'));
    const chance = textoChance(D);
    const ficha = h('section', { class: 'cartao ficha-desafio' + (emb ? ' ficha-emblema' : '') },
      h('div', { class: 'desafio-topo' }, h('div', { class: 'desafio-titulo' }, emb ? LP.emblema(emblemaDe(D), { tamanho: 'xg', rotulo: 'Emblema: ' + D.titulo }) : LP.icone('trofeu'), h('h2', null, D.titulo)), situacao(D)),
      emb ? h('div', { class: 'chips' }, LP.chipDificuldade(D.dificuldade), D.home ? LP.chip('Na faixa da tela inicial', 'info', { semPonto: true }) : LP.chip('Fora da faixa da tela inicial', '', { semPonto: true }),
        LP.chip('Todo mundo que cumprir ganha', 'ok', { semPonto: true })) : null,
      D.descricao ? h('p', { class: 'texto-2' }, D.descricao) : null,
      h('dl', { class: 'desafio-dados' },
        LP.dado('O que vale', h('b', null, textoCriterio(D.criterio)), { largo: true }),
        LP.dado('Requisitos', chipsRequisitos(D.requisitos, D.criterio, emb), { largo: true }),
        emb ? null : LP.dado('Prêmio', D.premio ? h('span', { class: 'desafio-premio' }, D.premio) : h('span', { class: 'texto-3' }, 'vazio: o jogo mostra "O prêmio deste desafio será anunciado aqui"'), { largo: true }),
        chance ? LP.dado('Calibração', chance, { largo: true }) : null,
        LP.dado('Prazo', textoPrazo(D), { largo: true }),
        LP.dado('Endereço', h('span', { class: 'mono quebra' }, D.slug)),
        LP.dado('Ordem no jogo', LP.inteiro(D.ordem)),
        LP.dado('Criado', D.criadoEm ? LP.dataHoraAno(D.criadoEm) : '—'),
        LP.dado('Mudado', D.atualizadoEm ? LP.relativo(D.atualizadoEm) : '—')),
      D.regulamento ? h('details', { class: 'cartao-secundario desafio-regulamento' }, h('summary', null, 'Regulamento'), h('p', { class: 'msg-texto' }, D.regulamento))
        : h('p', { class: 'faixa faixa-alerta' }, 'Sem regulamento: escreva em Editar antes de ativar.'),
      h('div', { class: 'perfil-acoes' }, acoes));
    const venc = D.vencedor ? h('section', { class: 'cartao cartao-vencedor' },
      h('h2', null, LP.icone('trofeu'), ' Vencedor'),
      D.vencedor.excluido ? h('p', { class: 'texto-2' }, 'A conta do vencedor foi excluída (LGPD): o desafio continua vencido, sem o nome.')
        : h('dl', { class: 'perfil-dados' },
          LP.dado('Conta', LP.linkUsuario(D.vencedor.usuario)),
          LP.dado('Carreira', D.vencedor.carreira ? LP.linkCarreira(D.vencedor.carreira.pk, D.vencedor.carreira.jogador || 'carreira #' + D.vencedor.carreira.pk) : '—'),
          LP.dado('Cumpriu em', comMilesimos(D.vencedor.em)),
          LP.dado('Declarado', D.vencedor.declaradoEm ? LP.dataHoraAno(D.vencedor.declaradoEm) : '—')),
      h('p', { class: 'ajuda' }, 'O jogo mostra o vencedor em Desafios e a conta dele recebeu o aviso em Minha conta. A equipe fala com ele pelo e-mail da conta.')) : null;
    LP.trocarNoLugar(dz.corpo, voltar, ficha, venc, emb ? secaoGanharam() : secaoCandidatos());
  }

  // ── v3.4: quem ganhou o emblema (E), os mais novos primeiro ──
  function secaoGanharam() {
    const D = dz.d;
    const e = D.emblemas || {};
    const filtros = LP.segmentos('Situação do emblema', [
      { valor: '', rotulo: 'Todos', contador: (e.ativos || 0) + (e.retirados || 0) },
      { valor: 'ativo', rotulo: 'Com o emblema', contador: e.ativos, tipoContador: 'ok' },
      { valor: 'retirado', rotulo: 'Retirados', contador: e.retirados },
    ], dz.estado, (v) => { dz.estado = v; dz.pagina = 1; carregarDesafio(true); });
    const atualizar = LP.botao('Atualizar', () => carregarDesafio(true), { tipo: 'fantasma', pequeno: true, icone: 'atualizar', title: 'Busca de novo quem ganhou' });
    const cab = h('div', { class: 'cartao-cabeca' }, h('h2', null, 'Quem ganhou ', h('span', { class: 'texto-3' }, 'os mais novos primeiro · o servidor dá sozinho, na hora')), atualizar);
    let lista;
    if (!dz.itens.length) {
      lista = LP.estadoVazio(dz.estado ? 'Ninguém nessa situação' : 'Ninguém ganhou ainda',
        D.valendo ? 'Quem salvar uma carreira-prova que cumpre o critério ganha na hora e aparece aqui.' : D.ativo ? 'O desafio ainda não está valendo (fora do prazo).' : 'O desafio está desativado: ative para começar a valer.');
    } else {
      lista = LP.lista({
        itens: dz.itens,
        chave: (x) => x.id,
        classeLinha: (x) => (x.estado === 'retirado' ? 'emblema-retirado' : null),
        aoClicar: (x) => { if (x.usuario && x.usuario.id) LP.abrirConta(x.usuario.id); },
        rotuloLinha: (x) => 'Abrir a conta ' + ((x.usuario && x.usuario.apelido) || ''),
        colunas: [
          { rotulo: 'Conta', principal: true, celula: (x) => h('span', { class: 'chips' }, LP.linkUsuario(x.usuario && x.usuario.id ? x.usuario : null, 'conta excluída'),
            x.usuario && x.usuario.status === 'suspenso' ? LP.chip('Conta suspensa', 'perigo', { title: 'Conta suspensa: o emblema não aparece no público enquanto ela estiver suspensa' }) : null) },
          { rotulo: 'Carreira', celula: celulaCarreiraE },
          { rotulo: 'Ganhou em', celula: (x) => h('span', { title: comMilesimos(x.em) + ' (Brasília)' }, LP.dataHoraAno(x.em)) },
          { rotulo: 'Situação', classe: 'situacao quebra', celula: (x) => h('div', { class: 'celula-dupla' }, LP.chipEstadoEmblema(x.estado),
            x.estado === 'retirado' ? h('span', { class: 'texto-3' }, (x.motivo || 'sem motivo') + (x.retiradoEm ? ' · ' + LP.relativo(x.retiradoEm) : '') + (x.quem && x.quem.nome ? ' · ' + x.quem.nome : ''))
              : x.motivo ? h('span', { class: 'texto-3' }, 'devolvido: ' + x.motivo) : null) },
          { rotulo: 'Ações', acoes: true, celula: (x) => botoesEmblema(x, x.usuario && x.usuario.apelido, recarregarDesafio) },
        ],
      });
    }
    return h('section', { class: 'cartao cartao-ganharam' }, cab, h('div', { class: 'ferramentas' }, filtros), lista,
      dz.total > (dz.porPagina || 50) ? LP.paginacao(dz.total, dz.pagina, dz.porPagina || 50, (p) => { dz.pagina = p; carregarDesafio(true); LP.rolarParaAba(); }) : null);
  }
  function celulaCarreiraE(x) {
    const c = x.carreira;
    if (!c) return h('span', { class: 'texto-3' }, 'a conta (sem carreira)');
    return h('span', { class: 'chips' }, c.existe ? LP.linkCarreira(c.pk, c.jogador || 'carreira #' + c.pk) : h('span', null, c.jogador || 'carreira'),
      c.existe ? null : LP.chip('Carreira apagada', '', { semPonto: true, title: 'O dono apagou a carreira: o emblema fica (só a moderação tira)' }));
  }
  /** Os botões de um emblema (E): abrir a carreira, verificar no jogo, tirar ou devolver. Também na ficha da conta. */
  function botoesEmblema(x, apelido, depois) {
    const bs = [];
    if (x.links && x.links.resumo) bs.push(linkJogoAbs('Abrir a carreira', x.links.resumo, { tipo: 'fantasma', pequeno: true, title: 'O resumo da carreira no jogo (outra aba)' }));
    if (x.links && x.links.verificar && LP.pode('moderar')) bs.push(linkJogoAbs('Verificar no jogo', x.links.verificar, { tipo: 'fantasma', pequeno: true, icone: 'jogar', title: 'Abre o jogo (outra aba): ele refaz a carreira com as mesmas escolhas e registra se bateu. Não bateu: o emblema sai sozinho.' }));
    if (LP.pode('moderar')) {
      bs.push(x.estado === 'retirado' ? LP.botao('Devolver', () => LP.devolverEmblema(x, apelido, depois), { tipo: 'ok', pequeno: true, icone: 'restaurar' })
        : LP.botao('Tirar', () => LP.retirarEmblema(x, apelido, depois), { tipo: 'perigo', pequeno: true, icone: 'x' }));
    }
    return bs;
  }
  LP.botoesEmblema = botoesEmblema;
  /** emblema_retirar {id, motivo}: o motivo é obrigatório e o jogador vê (no desafio). */
  LP.retirarEmblema = async function (x, apelido, depois) {
    const quem = apelido ? '@' + apelido : 'a conta';
    let resp = null;
    const r = await LP.dialogoMotivo({
      titulo: 'Tirar o emblema de ' + quem,
      perigo: true,
      botao: 'Tirar emblema',
      gerundio: 'Tirando…',
      rotuloMotivo: 'Motivo (o jogador vê no desafio; fica no registro)',
      chips: [{ rotulo: 'A carreira não bateu na verificação pelo jogo.' }, { rotulo: 'Trapaça: números que o jogo não dá.' }, { rotulo: 'Conta com mais de uma pessoa ou várias contas.' }, { rotulo: 'Outro', vazio: true }],
      texto: 'O emblema sai da conta (Minha conta, perfil público e Hall). Ele não volta sozinho, nem se a conta cumprir de novo: só com "Devolver".',
      executar: async (v) => { resp = await LP.adminPost({ acao: 'emblema_retirar', id: x.id, motivo: v.motivo }); return resp; },
    });
    if (!r || !resp) return;
    LP.avisar('Emblema retirado de ' + quem + '. O jogador vê o motivo no desafio.');
    LP.depoisDeAgir();
    if (depois) depois(resp.emblema);
  };
  /** emblema_devolver {id, motivo?}. */
  LP.devolverEmblema = async function (x, apelido, depois) {
    const quem = apelido ? '@' + apelido : 'a conta';
    let resp = null;
    const r = await LP.dialogoMotivo({
      titulo: 'Devolver o emblema a ' + quem,
      botao: 'Devolver emblema',
      gerundio: 'Devolvendo…',
      tipoBotao: 'ok',
      obrigatorio: false,
      chips: [{ rotulo: 'Retirado por engano.' }, { rotulo: 'Conferido: a carreira bate.' }, { rotulo: 'Outro', vazio: true }],
      texto: 'O emblema volta para a conta (Minha conta, perfil público e Hall), com a mesma data em que foi ganho.' + (x.motivo ? ' Tinha saído por: “' + x.motivo + '”.' : ''),
      executar: async (v) => { resp = await LP.adminPost(Object.assign({ acao: 'emblema_devolver', id: x.id }, v.motivo ? { motivo: v.motivo } : {})); return resp; },
    });
    if (!r || !resp) return;
    LP.avisar('Emblema devolvido a ' + quem + '.');
    LP.depoisDeAgir();
    if (depois) depois(resp.emblema);
  };

  function secaoCandidatos() {
    const D = dz.d;
    const c = D.candidatos || {};
    const filtros = LP.segmentos('Estado dos candidatos', [
      { valor: '', rotulo: 'Todos', contador: c.total },
      { valor: 'pendente', rotulo: 'Esperando verificação', contador: c.pendente, tipoContador: 'alerta' },
      { valor: 'verificada', rotulo: 'Verificados', contador: c.verificada, tipoContador: 'ok' },
      { valor: 'recusada', rotulo: 'Recusados', contador: c.recusada },
      { valor: 'vencedora', rotulo: 'Vencedor', contador: c.vencedora },
    ], dz.estado, (v) => { dz.estado = v; dz.pagina = 1; carregarDesafio(true); });
    const atualizar = LP.botao('Atualizar', () => carregarDesafio(true), { tipo: 'fantasma', pequeno: true, icone: 'atualizar', title: 'Depois de verificar no jogo (outra aba), a lista volta atualizada sozinha; este botão força agora' });
    const cab = h('div', { class: 'cartao-cabeca' }, h('h2', null, 'Candidatos ', h('span', { class: 'texto-3' }, 'na ordem em que cumpriram tudo (hora do servidor, com milésimos)')), atualizar);
    let lista;
    if (!dz.itens.length) {
      lista = LP.estadoVazio(dz.estado ? 'Nenhum candidato com esse estado' : 'Nenhum candidato ainda',
        D.valendo ? 'Quem cumprir o critério e os requisitos aparece aqui sozinho.' : D.ativo ? 'O desafio ainda não está valendo (fora do prazo).' : 'O desafio está desativado: ative para começar a valer.');
    } else {
      const base = (dz.pagina - 1) * (dz.porPagina || 50);
      lista = h('div', { class: 'lista-candidatos' }, dz.itens.map((k, i) => cartaoCandidato(k, dz.estado ? null : base + i + 1)));
    }
    return h('section', { class: 'cartao' }, cab, h('div', { class: 'ferramentas' }, filtros), lista,
      dz.total > (dz.porPagina || 50) ? LP.paginacao(dz.total, dz.pagina, dz.porPagina || 50, (p) => { dz.pagina = p; carregarDesafio(true); LP.rolarParaAba(); }) : null);
  }

  function linkVerificar(k, texto, tipo) {
    const href = k.links && k.links.verificar ? k.links.verificar : '../#/verificar?id=' + encodeURIComponent(k.carreira.pk) + '&candidato=' + encodeURIComponent(k.id);
    return linkJogoAbs(texto, href, { tipo: tipo, pequeno: true, icone: 'jogar', title: 'Abre o jogo (outra aba): ele refaz a carreira com as mesmas escolhas, compara e registra aqui se bateu' });
  }

  function cartaoCandidato(k, posicao) {
    const D = dz.d;
    const u = k.usuario || {};
    const c = k.carreira;
    const conq = D.criterio && D.criterio.todasConquistas;
    // v3.4: o de todas as conquistas vale pelas conquistas PROVADAS (as carreiras-prova da conta, verificadas em lote)
    const conqProva = conq && D.modo !== undefined;
    const chipsConta = [LP.chipTipo(u.tipo), u.status === 'suspenso' ? LP.chip('Conta suspensa', 'perigo') : null,
      u.emailVerificado === false ? LP.chip('E-mail não confirmado', 'tracejado', { semPonto: true }) : null,
      u.partidasConta !== undefined ? h('span', { class: 'texto-3' }, LP.plural(u.partidasConta, 'partida', 'partidas') + ' com a conta') : null];
    const linhaCarreira = c ? h('div', { class: 'chips' },
      c.existe ? LP.linkCarreira(c.pk, h('b', null, c.jogador || 'carreira #' + c.pk)) : h('b', null, c.jogador || 'carreira'),
      h('span', { class: 'texto-2' }, [c.copas !== null && c.copas !== undefined ? LP.plural(c.copas, 'Copa', 'Copas') : null,
        c.libertadores !== null && c.libertadores !== undefined ? LP.plural(c.libertadores, 'Libertadores', 'Libertadores') : null,
        c.nota !== null && c.nota !== undefined ? 'nota ' + LP.inteiro(c.nota) : null].filter(Boolean).join(' · ')),
      !c.existe ? LP.chip('Carreira apagada', 'perigo') : c.temReplay ? LP.chip('com replay', 'ok', { semPonto: true }) : LP.chip('sem replay', 'perigo', { semPonto: true }))
      : conq ? h('p', { class: 'texto-2' }, conqProva ? 'Desafio de conquistas: vale a conta (as ' + LP.inteiro(dz.conquistasTotal) + ' provadas por carreiras-prova).'
        : 'Desafio de conquistas: vale a conta (todas as ' + LP.inteiro(dz.conquistasTotal) + ' sincronizadas).') : null;
    // ── decisões ──
    const bs = [];
    const podeVerificar = c && c.existe && k.estado !== 'vencedora' && LP.pode('moderar');
    if (podeVerificar && c.temReplay) bs.push(linkVerificar(k, k.estado === 'pendente' ? 'Verificar no jogo' : 'Verificar de novo', k.estado === 'pendente' ? 'ouro' : 'fantasma'));
    // v3.4: o candidato de todas as conquistas é verificado pelas carreiras-prova da conta, em lote (#/verificar?conta=)
    if (!c && conqProva && k.links && k.links.verificar && k.estado !== 'vencedora' && LP.pode('moderar')) {
      bs.push(linkJogoAbs(k.estado === 'pendente' ? 'Verificar as provas no jogo' : 'Verificar as provas de novo', k.links.verificar, { tipo: k.estado === 'pendente' ? 'ouro' : 'fantasma', pequeno: true, icone: 'jogar',
        title: 'Abre o jogo (outra aba) e refaz, uma a uma, as carreiras que provam as conquistas da conta; com as ' + LP.inteiro(dz.conquistasTotal) + ' conferidas, o candidato vira verificado sozinho' }));
    }
    if (c && c.existe && k.links && k.links.resumo) bs.push(linkJogoAbs('Abrir a carreira', k.links.resumo, { tipo: 'fantasma', pequeno: true, title: 'O resumo da carreira no jogo (outra aba)' }));
    if (k.estado !== 'vencedora' && k.estado !== 'recusada' && LP.pode('moderar')) bs.push(LP.botao('Recusar', () => recusar(k), { tipo: 'perigo', pequeno: true, icone: 'x' }));
    // §E: conferido agora pelo servidor (a carreira guardada de agora, o critério de agora, os requisitos, o Hall)
    const naoVale = k.valeAgora && k.valeAgora.ok === false ? (k.valeAgora.texto || 'não cumpre mais o desafio') : null;
    if (k.estado === 'verificada' && !D.vencedor && LP.pode('config') && (!conq || conqProva)) {
      const b = LP.botao('Declarar vencedor', () => declarar(k), { tipo: 'ouro', pequeno: true, icone: 'trofeu',
        disabled: !k.primeiro || !!naoVale, title: naoVale ? 'Não vale agora: ' + naoVale : k.primeiro ? 'O primeiro que cumpriu tudo, verificado no jogo' : 'Há um candidato que cumpriu antes esperando decisão: verifique ou recuse esse primeiro' });
      bs.push(b);
    }
    // §E: o "Conferi as conquistas" saiu — ele marcava como verificado sem conferir nada (as conquistas vinham do aparelho)
    return h('article', { class: 'candidato candidato-' + k.estado + (k.primeiro ? ' primeiro' : ''), dataset: { id: k.id } },
      h('div', { class: 'candidato-topo' },
        h('div', { class: 'chips' },
          posicao ? h('span', { class: 'candidato-pos', title: 'Posição na ordem da hora' }, posicao + 'º') : null,
          k.primeiro ? LP.chip('O primeiro que ainda conta', 'ouro', { semPonto: true, title: 'O de menor hora entre os pendentes, verificados e o vencedor' }) : null,
          LP.linkUsuario(u.id ? u : null, 'conta excluída'), chipsConta),
        LP.chipCandidato(k.estado)),
      linhaCarreira,
      h('p', { class: 'texto-3' }, 'Cumpriu tudo em ', h('b', { class: 'mono' }, comMilesimos(k.em)), ' (Brasília)',
        k.decididoEm ? ' · decidido ' + LP.relativo(k.decididoEm) + (k.quem && k.quem.nome ? ' por ' + k.quem.nome : '') : ''),
      blocoVerificacao(k),
      naoVale ? h('p', { class: 'faixa faixa-alerta' }, h('b', null, 'Não vale agora: '), naoVale,
        ' O servidor confere de novo ao declarar; se for da carreira, ele recusa sozinho.') : null,
      conq && !conqProva && k.estado !== 'recusada' ? h('p', { class: 'faixa faixa-alerta' }, SEM_PROVA + ' Recuse com o motivo.') : null,
      conqProva && k.estado === 'pendente' ? h('p', { class: 'faixa faixa-info' }, 'Verifique no jogo as carreiras-prova da conta (em lote): quando as ' + LP.inteiro(dz.conquistasTotal)
        + ' conquistas estiverem provadas por carreiras que bateram no replay, o candidato vira "verificado" sozinho. Uma que não bate sai das provas (e a conta volta a não ter as ' + LP.inteiro(dz.conquistasTotal) + ').') : null,
      k.motivo && k.estado === 'recusada' ? h('p', { class: 'moderacao-nota' }, h('b', null, 'Motivo (o jogador vê): '), k.motivo) : null,
      c && c.existe && !c.temReplay && k.estado !== 'recusada' ? h('p', { class: 'faixa faixa-alerta' }, 'Sem replay: não dá para refazer no jogo. Recuse com o motivo.') : null,
      bs.length ? h('div', { class: 'botoes' }, bs) : null);
  }

  /** O que o jogo registrou ao refazer a carreira (bateu ou não; as diferenças; o guardado × o refeito). */
  function blocoVerificacao(k) {
    const v = k.verificacao;
    if (!v || typeof v !== 'object') return null;
    const det = v.detalhes && typeof v.detalhes === 'object' ? v.detalhes : {};
    const quando = (v.em ? LP.dataHoraAno(v.em) : '') + (k.quem && k.quem.nome ? ' · ' + k.quem.nome : '');
    // v3.4: o de todas as conquistas verificado sozinho pelas carreiras-prova (detalhes.provas)
    const titulo = det.provas ? 'Verificado pelas carreiras-prova (as ' + LP.inteiro(dz.conquistasTotal) + ' conferidas no replay)'
      : det.manual ? (v.ok ? 'Conferido pela equipe (as conquistas da conta)' : 'Recusado na conferência da equipe')
        : v.ok ? 'Bateu na verificação pelo jogo' : 'Não bateu na verificação pelo jogo';
    const difs = Array.isArray(det.diferencas) ? det.diferencas : [];
    const g = det.guardado && typeof det.guardado === 'object' ? det.guardado : null;
    const r = det.refeito && typeof det.refeito === 'object' ? det.refeito : null;
    // tabela simples (não vira cartões no celular): os números, a linha diferente em vermelho
    const fmt = (x) => (x === null || x === undefined ? '—' : LP.inteiro(x));
    const tabela = g && r ? h('table', { class: 'tabela-verif' },
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Número'), h('th', { scope: 'col', class: 'num' }, 'Guardado'), h('th', { scope: 'col', class: 'num' }, 'Refeito no jogo'))),
      h('tbody', null, NUMEROS.filter((k2) => (k2 in g || k2 in r) && (typeof g[k2] !== 'object' || g[k2] === null)).map((k2) => {
        const dif = g[k2] !== r[k2];
        return h('tr', { class: dif ? 'diferente' : null },
          h('td', null, dif ? h('span', { class: 'fora-da-tela' }, 'Diferente: ') : null, ROTULO_CAMPO[k2] || k2, dif ? h('span', { 'aria-hidden': 'true' }, ' ≠') : null),
          h('td', { class: 'num' }, fmt(g[k2])), h('td', { class: 'num' }, fmt(r[k2])));
      }))) : null;
    const outras = difs.filter((d) => !NUMEROS.includes(d.campo));
    const avisos = Array.isArray(det.avisos) ? det.avisos.filter((a) => typeof a === 'string') : [];
    const dados = det.dadosCarreira && det.dadosJogo && det.dadosCarreira !== det.dadosJogo
      ? h('p', { class: 'faixa faixa-info' }, 'A carreira foi jogada com outra versão dos dados (' + det.dadosCarreira + ' × ' + det.dadosJogo + '): uma diferença pode vir daí, e não de trapaça.') : null;
    const texto = (x) => (x === null || x === undefined ? '—' : Array.isArray(x) ? x.join(', ') || '—' : typeof x === 'object' ? JSON.stringify(x) : String(x));
    return h('details', { class: 'verificacao ' + (v.ok ? 'verificacao-ok' : 'verificacao-nao'), open: !v.ok },
      h('summary', null, h('span', { class: v.ok ? 'sim' : 'nao', 'aria-hidden': 'true' }, v.ok ? '✓' : '✗'), ' ', titulo,
        h('span', { class: 'texto-3' }, ' · ' + quando + (typeof det.ms === 'number' ? ' · ' + LP.nf1.format(det.ms / 1000) + ' s' : '') + (typeof det.passos === 'number' ? ' · ' + LP.plural(det.passos, 'decisão', 'decisões') : ''))),
      !v.ok && det.motivo ? h('p', { class: 'texto-2' }, String(det.motivo)) : null,
      dados,
      outras.length ? h('ul', { class: 'texto-2' }, outras.map((d) => h('li', null, h('b', null, (ROTULO_CAMPO[d.campo] || d.campo) + ': '), texto(d.guardado) + ' → ' + texto(d.refeito)))) : null,
      tabela,
      avisos.length ? h('ul', { class: 'texto-3' }, avisos.map((a) => h('li', null, a))) : null);
  }
  LP.blocoVerificacao = blocoVerificacao;

  // ── decisões ──
  async function recusar(k) {
    const u = k.usuario || {};
    const r = await LP.dialogoMotivo({
      titulo: 'Recusar o candidato ' + (u.apelido ? '@' + u.apelido : '#' + k.id),
      perigo: true,
      botao: 'Recusar candidato',
      gerundio: 'Recusando…',
      rotuloMotivo: 'Motivo (o jogador vê no desafio; fica no registro)',
      chips: [{ rotulo: 'Não bateu na verificação pelo jogo.' }, { rotulo: 'Carreira sem replay: não dá para conferir.' }, { rotulo: 'Trapaça: números que o jogo não dá.' }, { rotulo: 'Conta com mais de uma pessoa ou várias contas.' }, { rotulo: 'Outro', vazio: true }],
      texto: 'O candidato sai da disputa deste desafio (a carreira continua na conta). Se ele cumprir de novo com outra carreira, vira candidato outra vez.',
      executar: (v) => LP.adminPost({ acao: 'candidato_recusar', id: k.id, motivo: v.motivo }),
    });
    if (!r) return;
    LP.avisar('Candidato recusado. O jogador vê o motivo no desafio.');
    LP.depoisDeAgir();
    recarregarDesafio();
  }
  async function declarar(k) {
    const D = dz.d;
    const u = k.usuario || {};
    const c = k.carreira;
    const ok = (cond, texto) => h('li', null, h('span', { class: cond ? 'sim' : 'nao', 'aria-hidden': 'true' }, cond ? '✓' : '✗'), h('span', null, texto));
    const corpo = h('div', { class: 'dialogo-carreira' },
      h('ul', { class: 'lista-checagem' },
        ok(k.estado === 'verificada', 'Verificado no jogo' + (k.verificacao && k.verificacao.em ? ' (' + LP.dataHoraAno(k.verificacao.em) + ')' : '')),
        ok(!!k.primeiro, k.primeiro ? 'É o primeiro que cumpriu tudo (' + comMilesimos(k.em) + ')' : 'Há um candidato anterior esperando decisão'),
        ok(u.status !== 'suspenso', 'Conta ' + (u.status === 'suspenso' ? 'suspensa' : 'ativa')),
        ok(u.emailVerificado !== false, 'E-mail confirmado'),
        c ? ok(c.existe, c.existe ? 'Carreira ' + (c.jogador || '') + ' na conta' : 'A carreira foi apagada') : null),
      h('p', { class: 'texto-2' }, 'Ao declarar: o jogo mostra @' + (u.apelido || '—') + ' como vencedor de “' + D.titulo + '” para todo mundo, ninguém mais vira candidato e a conta recebe o aviso em Minha conta. A equipe combina o prêmio pelo e-mail da conta.'),
      h('p', { class: 'faixa faixa-alerta' }, 'Dá para desfazer em "Reabrir", mas o jogador e o público podem já ter visto.'));
    let resp = null;
    const r = await LP.dialogo({
      titulo: 'Declarar @' + (u.apelido || '—') + ' vencedor',
      tipoBotao: 'ouro',
      botao: 'Declarar vencedor',
      gerundio: 'Declarando…',
      corpo: corpo,
      digitar: u.apelido || 'VENCEDOR',
      digitarLivre: true,
      executar: async () => { resp = await LP.adminPost({ acao: 'desafio_declarar_vencedor', candidatoId: k.id }); return resp; },
    });
    if (!r || !resp) return;
    LP.avisar('@' + (u.apelido || '—') + ' é o vencedor de “' + D.titulo + '”. O jogo já mostra.');
    LP.depoisDeAgir();
    recarregarDesafio();
  }
  async function reabrir(D) {
    const r = await LP.dialogoMotivo({
      titulo: 'Reabrir “' + D.titulo + '”',
      perigo: true,
      botao: 'Reabrir desafio',
      gerundio: 'Reabrindo…',
      chips: [{ rotulo: 'Declarado por engano' }, { rotulo: 'Trapaça descoberta depois' }, { rotulo: 'O vencedor desistiu' }, { rotulo: 'Outro', vazio: true }],
      texto: 'O vencedor sai (o candidato volta a "verificado") e o aviso dele em Minha conta some, se ainda não foi lido. Os candidatos voltam a contar na ordem da hora.',
      executar: (v) => LP.adminPost({ acao: 'desafio_reabrir', id: D.id, motivo: v.motivo }),
    });
    if (!r) return;
    LP.avisar('Desafio reaberto: sem vencedor.');
    LP.depoisDeAgir();
    recarregarDesafio();
  }

  // ═══ editor ════════════════════════════════════════════════════════════════════════════════
  /** Novo desafio aberto direto pelo endereço: a lista diz antes se o servidor é da v3.4 (o tipo emblema) e o limite do dia. */
  async function carregarParaNovo() {
    const n = ++dz.pedido;
    if (dz.v34 === null || dz.partidasDiaMax === null) {
      try {
        const [r] = await Promise.all([LP.adminGet('desafios', {}, { sinal: LP.unico('desafios') }), nomesPaises()]);
        if (n !== dz.pedido || dz.modo !== 'novo' || !LP.visivel(dz.corpo)) return;
        dz.conquistasTotal = r.conquistasTotal || dz.conquistasTotal;
        dz.partidasDiaMax = r.partidasDiaMax !== undefined ? r.partidasDiaMax : dz.partidasDiaMax;
        lerV34(Array.isArray(r.itens) ? r.itens : []);
      } catch (e) {
        if (LP.cancelado(e) || n !== dz.pedido || (e && e.status === 401)) return;
        // sem a lista: o editor abre como o de sempre (o servidor confere tudo ao salvar)
      }
    } else {
      await nomesPaises();
    }
    if (n !== dz.pedido || dz.modo !== 'novo' || !LP.visivel(dz.corpo)) return;
    montarEditor(null);
  }

  const slugDe = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-').slice(0, 40).replace(/-+$/, '');
  function formDe(D) {
    const c = (D && D.criterio) || {};
    const modo = D ? (D.modo === 'emblema' ? 'emblema' : 'primeiro') : dz.v34 ? dz.novoModo : 'primeiro';
    const r = (D && D.requisitos) || (modo === 'emblema' ? REQ_EMBLEMA : REQ_PREMIO);
    const f = {
      titulo: D ? D.titulo : '', slug: D ? D.slug : '', descricao: (D && D.descricao) || '',
      modo: modo, tipo: c.todasConquistas ? 'conquistas' : 'tacas',
      nacionalidade: Array.isArray(c.nacionalidade) ? c.nacionalidade.slice() : [],
      partidasMin: r.partidasMin === undefined ? 30 : r.partidasMin, emailVerificado: r.emailVerificado !== false, publicadoNoHall: r.publicadoNoHall !== false, top3Perfil: r.top3Perfil !== false,
      premio: (D && D.premio) || '', regulamento: (D && D.regulamento) || '', inicio: D ? diaDeIso(D.inicio) : '', fim: D ? diaDeIso(D.fim) : '', ordem: D ? D.ordem : 0,
      dificuldade: (D && D.dificuldade) || '', home: !!(D && D.home),
      icone: D && D.emblema && D.emblema.icone ? D.emblema.icone : 'star', cor: D && D.emblema && D.emblema.cor ? D.emblema.cor : '#f2c75a',
    };
    CHAVES.forEach(([k]) => { f[k] = c[k] || 0; });
    if (!D) f.copas = 1;
    return f;
  }
  const chavesVisiveis = () => (dz.v34 ? CHAVES : CHAVES.filter(([k]) => CHAVES_V33.includes(k)));
  function criterioDoForm(f) {
    if (f.tipo === 'conquistas') return { todasConquistas: true };
    const c = {};
    chavesVisiveis().forEach(([k]) => { if (Number(f[k]) > 0) c[k] = Number(f[k]); });
    if (dz.v34 && f.nacionalidade.length) c.nacionalidade = f.nacionalidade.slice();
    return c;
  }
  function requisitosDoForm(f) {
    const conq = f.tipo === 'conquistas';
    return { partidasMin: Number(f.partidasMin), emailVerificado: !!f.emailVerificado, publicadoNoHall: conq ? false : !!f.publicadoNoHall, top3Perfil: conq ? false : !!f.top3Perfil };
  }
  const emblemaDoForm = (f) => ({ icone: f.icone, cor: String(f.cor).toLowerCase() });
  const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  /** Os campos que mudaram, no formato do desafio_salvar (só eles vão: o início gravado na ativação não é trocado sem querer). */
  function mudancas() {
    const f = dz.form;
    const o = dz.original;
    if (!f || !o) return {};
    const m = {};
    const novo = !dz.d;
    const emb = f.modo === 'emblema';
    if (novo) m.slug = f.slug;
    ['titulo', 'descricao', 'premio', 'regulamento'].forEach((k) => { if (String(f[k]).trim() !== String(o[k]).trim()) m[k] = String(f[k]).trim() || (k === 'premio' ? '' : null); });
    if (novo && !String(f.regulamento).trim()) delete m.regulamento; // novo sem regulamento: o servidor escreve o de partida
    if (emb && 'premio' in m && novo) delete m.premio; // o de emblema não tem prêmio
    if (!igual(criterioDoForm(f), criterioDoForm(o))) m.criterio = criterioDoForm(f);
    if (!igual(requisitosDoForm(f), requisitosDoForm(o))) m.requisitos = requisitosDoForm(f);
    if (f.inicio !== o.inicio) m.inicio = f.inicio || null;
    if (f.fim !== o.fim) m.fim = f.fim || null;
    if (Number(f.ordem) !== Number(o.ordem)) m.ordem = Number(f.ordem);
    if (dz.v34) {
      // v3.4: o tipo, a dificuldade, o emblema e a faixa da tela inicial (só os do de emblema; o novo manda o tipo sempre)
      if (novo || f.modo !== o.modo) m.modo = f.modo;
      if (emb) {
        if (novo || f.dificuldade !== o.dificuldade) { if (!novo || f.dificuldade) m.dificuldade = f.dificuldade || null; }
        if (novo || !igual(emblemaDoForm(f), emblemaDoForm(o))) m.emblema = emblemaDoForm(f);
        if (novo ? f.home : f.home !== o.home) m.home = !!f.home;
      }
    }
    if (novo) { m.titulo = String(f.titulo).trim(); m.criterio = criterioDoForm(f); if (!m.requisitos) m.requisitos = requisitosDoForm(f); }
    return m;
  }
  function validar() {
    const f = dz.form;
    const e = {};
    const int = (v, a, b) => Number.isInteger(Number(v)) && String(v).trim() !== '' && Number(v) >= a && Number(v) <= b;
    const t = String(f.titulo).trim();
    if (t.length < 3 || t.length > 80) e.titulo = 'O título tem de 3 a 80 caracteres.';
    if (!dz.d && (!SLUG_RE.test(f.slug) || f.slug.includes('--'))) e.slug = 'De 3 a 40 letras minúsculas, números e hífens (sem "--", sem hífen nas pontas).';
    if (String(f.descricao).trim().length > 400) e.descricao = 'Até 400 caracteres.';
    if (String(f.premio).length > 2000) e.premio = 'Até 2.000 caracteres.';
    if (String(f.regulamento).length > 20000) e.regulamento = 'Até 20.000 caracteres.';
    if (f.tipo === 'tacas') {
      let algum = false;
      chavesVisiveis().forEach(([k, , max]) => {
        if (!int(f[k], 0, max)) e[k] = 'De 0 a ' + LP.inteiro(max) + '.';
        else if (Number(f[k]) > 0) algum = true;
      });
      if (dz.v34 && f.nacionalidade.length > 30) e.nacionalidade = 'Até 30 seleções.';
      if (dz.v34 && f.nacionalidade.length) algum = true;
      if (!algum && !chavesVisiveis().some(([k]) => e[k])) e.criterio = dz.v34 ? 'Peça pelo menos um número (ou uma seleção).' : 'Peça pelo menos 1 Copa do Mundo ou 1 Libertadores.';
    }
    if (!int(f.partidasMin, 0, 10000)) e.partidasMin = 'De 0 a 10.000.';
    if (!int(f.ordem, 0, 999)) e.ordem = 'De 0 a 999.';
    if (f.inicio && f.fim && f.fim < f.inicio) e.datas = 'O fim tem de ser no mesmo dia do início ou depois.';
    if (dz.d && dz.d.ativo && dz.original.inicio && !f.inicio) e.datas = 'Com o desafio ativo, o início não fica vazio (ele já começou).';
    if (f.modo === 'emblema' && (!LP.iconeEmblemaValido(f.icone) || !LP.corEmblemaValida(f.cor))) e.emblema = 'Escolha o ícone e a cor do emblema.';
    return e;
  }
  /** Tem alteração não salva no editor? (novo: algo escrito; editar: algum campo diferente do salvo) */
  LP.desafioSujo = function () {
    if (!dz.form || dz.salvando || (dz.modo !== 'editar' && dz.modo !== 'novo') || !LP.visivel(dz.corpo)) return false;
    if (dz.modo === 'novo') return ['titulo', 'descricao', 'premio', 'regulamento'].some((k) => String(dz.form[k] || '').trim() !== '');
    return Object.keys(mudancas()).length > 0;
  };
  /** O tipo não muda depois que alguém virou candidato ou ganhou o emblema (o servidor responde 409 modo_travado). */
  const modoTravado = (D) => !!D && (!!D.vencedor || ((D.candidatos && D.candidatos.total) || 0) > 0 || ((D.emblemas && ((D.emblemas.ativos || 0) + (D.emblemas.retirados || 0))) || 0) > 0);

  function montarEditor(D) {
    dz.form = formDe(D);
    dz.original = formDe(D);
    dz.erros = {};
    dz.tocados = new Set();
    dz.mostrarErros = false;
    dz.slugManual = !!D;
    dz.reqTocado = !!D;
    const f = dz.form;
    const novo = !D;
    LP.tituloAba(novo ? 'Criar desafio' : 'Editar · ' + D.titulo);
    LP.subAba(novo ? 'Nasce desativado: ative depois de conferir.' : (ehEmblema(D) ? 'Desafio de emblema · ' : 'Desafio · ') + D.slug);
    LP.acoesAba();
    const podeMexer = LP.pode('config');
    const erro = (k) => { const p = h('p', { class: 'erro-campo', role: 'alert', hidden: true }); dz.erros[k] = p; return p; };
    const campoTexto = (k, rotulo, o) => {
      const id = 'dz-' + k;
      const el = o.linhas ? h('textarea', { id: id, rows: o.linhas, maxlength: o.max, placeholder: o.placeholder, disabled: !podeMexer || o.disabled })
        : h('input', { id: id, type: 'text', maxlength: o.max, placeholder: o.placeholder, autocomplete: 'off', spellcheck: o.spell ? 'true' : 'false', disabled: !podeMexer || o.disabled });
      el.value = f[k] === null || f[k] === undefined ? '' : String(f[k]);
      const cont = o.contador ? h('span', { class: 'contador-campo' }) : null;
      const at = () => { if (cont) cont.textContent = el.value.length + '/' + LP.inteiro(o.max); };
      el.addEventListener('input', () => { f[k] = el.value; dz.tocados.add(k); if (o.aoMudar) o.aoMudar(el.value); at(); atualizar(); });
      at();
      return h('div', { class: 'campo' }, h('label', { class: 'rotulo', for: id }, rotulo), el, cont, o.ajuda ? h('p', { class: 'ajuda' }, o.ajuda) : null, erro(k));
    };
    const campoNum = (k, rotulo, min, max, unidade, o) => {
      const id = 'dz-' + k;
      const el = h('input', { id: id, type: 'number', min: min, max: max, step: 1, inputmode: 'numeric', disabled: !podeMexer || (o && o.disabled) });
      el.value = String(f[k]);
      el.addEventListener('input', () => { f[k] = el.value.trim() === '' ? '' : Number(el.value); dz.tocados.add(k); if (o && o.req) dz.reqTocado = true; atualizar(); });
      return h('div', { class: 'campo' }, h('label', { class: 'rotulo', for: id }, rotulo), h('span', { class: 'numero-campo' }, el, unidade ? h('span', null, unidade) : null),
        o && o.ajuda ? h('p', { class: 'ajuda' }, o.ajuda) : null, erro(k));
    };
    const caixas = {};
    const caixa = (k, rotulo, ajuda, o) => {
      const id = 'dz-' + k;
      const el = h('input', { id: id, type: 'checkbox', role: 'switch', checked: !!f[k], disabled: !podeMexer });
      const sim = (o && o.sim) || 'Pedido';
      const nao = (o && o.nao) || 'Não pedido';
      const txt = h('span', { class: 'estado-txt' }, el.checked ? sim : nao);
      el.addEventListener('change', () => { f[k] = el.checked; txt.textContent = el.checked ? sim : nao; if (!(o && o.naoReq)) dz.reqTocado = true; atualizar(); });
      caixas[k] = { el: el, txt: txt, sim: sim, nao: nao };
      return h('div', { class: 'config-item', 'data-campo': k }, h('div', null, h('span', { class: 'rotulo-item' }, rotulo)),
        h('label', { class: 'interruptor' }, el, h('span', { class: 'trilho', 'aria-hidden': 'true' }), txt), ajuda ? h('p', { class: 'ajuda' }, ajuda) : null);
    };
    const campoData = (k, rotulo, ajuda) => {
      const id = 'dz-' + k;
      const el = h('input', { id: id, type: 'date', disabled: !podeMexer });
      el.value = f[k] || '';
      el.addEventListener('change', () => { f[k] = el.value || ''; dz.tocados.add(k); atualizar(); });
      const limpar = LP.botao('Limpar', () => { el.value = ''; f[k] = ''; dz.tocados.add(k); atualizar(); }, { tipo: 'fantasma', pequeno: true, disabled: !podeMexer });
      return h('div', { class: 'campo' }, h('label', { class: 'rotulo', for: id }, rotulo), h('div', { class: 'campo-linha campo-data' }, el, limpar), h('p', { class: 'ajuda' }, ajuda));
    };

    // ── o que é (v3.4: o tipo, emblema ou prêmio) ──
    const slug = campoTexto('slug', 'Endereço (slug)', { max: 40, disabled: !novo, ajuda: novo ? 'Só letras minúsculas, números e hífens. Não muda depois de criado.' : 'Não muda depois de criado.' });
    const entradaSlug = slug.querySelector('input');
    entradaSlug.addEventListener('input', () => { dz.slugManual = true; });
    const titulo = campoTexto('titulo', 'Título (3 a 80)', { max: 80, spell: true, aoMudar: (v) => {
      if (novo && !dz.slugManual) { f.slug = slugDe(v); entradaSlug.value = f.slug; }
    } });
    const descricao = campoTexto('descricao', 'Descrição curta (até 400)', { max: 400, linhas: 2, contador: true, spell: true, ajuda: 'Aparece no cartão do desafio no jogo, embaixo do título.' });
    const travado = modoTravado(D);
    const caixaModo = h('div');
    const ajudaModo = h('p', { class: 'ajuda' });
    const desenharModo = () => {
      LP.trocar(caixaModo, LP.segmentos('Tipo do desafio', [
        { valor: 'emblema', rotulo: 'Emblema · todo mundo que cumprir ganha', title: 'O servidor dá o emblema sozinho a toda conta com uma carreira-prova que cumpre o critério' },
        { valor: 'primeiro', rotulo: 'Prêmio · o primeiro que cumprir', title: 'Um vencedor: o primeiro que cumprir tudo, verificado no jogo; o prêmio é o texto que você escreve' },
      ], f.modo, (v) => {
        if (travado || !podeMexer || v === f.modo) return;
        f.modo = v;
        // os requisitos de partida de cada tipo (só se ninguém mexeu neles ainda)
        if (novo && !dz.reqTocado) {
          const r = v === 'emblema' ? REQ_EMBLEMA : REQ_PREMIO;
          Object.keys(r).forEach((k) => { f[k] = r[k]; });
          ['emailVerificado', 'publicadoNoHall', 'top3Perfil'].forEach((k) => { const c = caixas[k]; if (c) { c.el.checked = !!f[k]; c.txt.textContent = f[k] ? c.sim : c.nao; } });
          const pm = document.getElementById('dz-partidasMin');
          if (pm) pm.value = String(f.partidasMin);
        }
        desenharModo();
        atualizar();
      }));
      caixaModo.querySelectorAll('button').forEach((b) => { b.disabled = travado || !podeMexer; });
      ajudaModo.textContent = f.modo === 'emblema'
        ? 'Emblema: sem vencedor e sem verificação antes de dar; não é corrida (as carreiras-prova de antes também valem). A equipe pode tirar o emblema de uma conta.'
        : 'Prêmio: quem cumpre tudo vira candidato na ordem da hora; o vencedor é declarado depois de verificar no jogo.';
      const emb = f.modo === 'emblema';
      if (cEmblema) cEmblema.hidden = !emb;
      if (cTexto) { premio.hidden = emb; }
      if (dz.previa) atualizar();
    };
    const cSobre = h('section', { class: 'cartao' }, h('div', { class: 'cartao-cabeca' }, h('h2', null, 'O desafio')),
      dz.v34 ? h('div', { class: 'campo' }, h('span', { class: 'rotulo' }, 'Tipo'), caixaModo, ajudaModo,
        travado ? h('p', { class: 'faixa faixa-info' }, 'O tipo não muda depois que alguém virou candidato ou ganhou o emblema (crie outro desafio).') : null, erro('modo')) : null,
      titulo, slug, descricao);

    // ── critério ──
    const vencido = !!(D && D.vencedor);
    const grade = h('div', { class: 'grade-criterio' }, chavesVisiveis().map(([k, rot, max, , , aj]) => campoNum(k, rot, 0, max, null, { disabled: vencido, ajuda: dz.v34 ? aj : null })));
    // v3.4: a seleção (nacionalidade): a da criação tem de ser a do fim
    const selecao = dz.v34 ? campoSelecao(f, podeMexer && !vencido, erro('nacionalidade')) : null;
    const caixaNumeros = h('div', null, grade, selecao);
    const tipos = h('div');
    const reqCarreira = h('div');
    const desenharTipo = () => {
      LP.trocar(tipos, LP.segmentos('Tipo do critério', [{ valor: 'tacas', rotulo: dz.v34 ? 'Números numa carreira' : 'Taças numa carreira' }, { valor: 'conquistas', rotulo: 'Todas as conquistas' }], f.tipo, (v) => {
        if (vencido || !podeMexer) return;
        f.tipo = v; desenharTipo(); atualizar();
      }));
      caixaNumeros.hidden = f.tipo !== 'tacas';
      reqCarreira.hidden = f.tipo !== 'tacas';
      textoConq.hidden = f.tipo !== 'conquistas';
      textoTacas.hidden = f.tipo !== 'tacas';
    };
    const textoConq = h('p', { class: 'ajuda' }, dz.v34
      ? 'Todas as conquistas: vale a conta com as ' + LP.inteiro(dz.conquistasTotal) + ' conquistas PROVADAS por carreiras-prova (semente do servidor + replay); as que vieram só do aparelho não contam. No de prêmio, o vencedor só sai com as ' + LP.inteiro(dz.conquistasTotal) + ' conferidas no replay (o lote do #/verificar).'
      : 'Todas as conquistas: vale a primeira conta com as ' + LP.inteiro(dz.conquistasTotal) + ' conquistas do jogo sincronizadas. ' + SEM_PROVA);
    const textoTacas = h('p', { class: 'ajuda' }, dz.v34
      ? 'Tudo numa mesma carreira, tirado da carreira guardada na conta (o que ela mostra no resumo). 0 = não pede aquele número; cada número vale "ou mais".'
      : 'Copas e Libertadores saem da carreira guardada na conta. 0 = não pede aquela taça.');
    const cCriterio = h('section', { class: 'cartao' + (dz.v34 ? ' larga' : '') }, h('div', { class: 'cartao-cabeca' }, h('h2', null, 'O que vale'), h('span', { class: 'texto-3' }, 'critério')),
      vencido ? h('p', { class: 'faixa faixa-info' }, 'O desafio já tem vencedor: o critério não muda (reabra antes, se precisar).') : null,
      tipos, caixaNumeros, textoConq, textoTacas, erro('criterio'));

    // ── v3.4: o emblema (ícone, cor, dificuldade, faixa da tela inicial) ──
    let cEmblema = null;
    if (dz.v34) {
      const seletor = LP.seletorEmblema({ icone: f.icone, cor: f.cor, desabilitado: !podeMexer, aoMudar: (v) => { f.icone = v.icone; f.cor = v.cor; dz.tocados.add('emblema'); atualizar(); } });
      const caixaDif = h('div');
      const desenharDif = () => {
        LP.trocar(caixaDif, LP.segmentos('Dificuldade', [{ valor: '', rotulo: 'Sem' }].concat(LP.DIFICULDADES.map((d) => ({ valor: d, rotulo: LP.NOMES_DIFICULDADE[d] }))), f.dificuldade, (v) => {
          if (!podeMexer) return;
          // a cor acompanha a dificuldade enquanto ela ainda for a da dificuldade de antes (ou a de partida)
          const corAntes = LP.COR_DA_DIFICULDADE[f.dificuldade] || '#f2c75a';
          if (v && String(f.cor).toLowerCase() === corAntes) { f.cor = LP.COR_DA_DIFICULDADE[v]; seletor.definir({ cor: f.cor }); }
          f.dificuldade = v;
          desenharDif();
          atualizar();
        }));
        caixaDif.querySelectorAll('button').forEach((b) => { b.disabled = !podeMexer; });
      };
      desenharDif();
      cEmblema = h('section', { class: 'cartao cartao-editor-emblema' }, h('div', { class: 'cartao-cabeca' }, h('h2', null, 'Emblema'), h('span', { class: 'texto-3' }, 'o que a conta ganha')),
        seletor.no, erro('emblema'),
        h('div', { class: 'campo' }, h('span', { class: 'rotulo' }, 'Dificuldade'), caixaDif,
          h('p', { class: 'ajuda' }, 'Aparece no cartão do jogo e ordena os emblemas da conta (lendário primeiro). A da calibração: fácil ~1 em 10 carreiras, médio ~1 em 70–110, difícil ~1 em 350–600, lendário ~1 em 5.000 ou mais.'), erro('dificuldade')),
        caixa('home', 'Na faixa da tela inicial', 'A linha discreta de desafios da tela inicial do jogo mostra os marcados primeiro (cabem 2 ou 3).', { sim: 'Na faixa', nao: 'Fora da faixa', naoReq: true }), erro('home'));
    }

    // ── requisitos ──
    LP.anexar(reqCarreira, [caixa('publicadoNoHall', 'Carreira publicada no Hall das Lendas', 'Ela aparece no Hall público pelas regras de agora (a que espera a revisão da nota alta também conta).'),
      caixa('top3Perfil', 'Entre as 3 carreiras do perfil público', 'O perfil público mostra as 3 que o jogador tem no Hall.')]);
    const cReq = h('section', { class: 'cartao' }, h('div', { class: 'cartao-cabeca' }, h('h2', null, 'Requisitos'), h('span', { class: 'texto-3' }, 'para valer')),
      campoNum('partidasMin', 'Partidas mínimas com a conta', 0, 10000, 'partidas', { req: true }),
      h('p', { class: 'ajuda' }, 'Contam até ' + (dz.partidasDiaMax ? LP.plural(dz.partidasDiaMax, 'partida', 'partidas') : 'o limite') + ' por dia por conta (Configurações). Carreira salva num dia em que a conta passou do limite não vale.'),
      caixa('emailVerificado', 'E-mail confirmado', 'A conta digitou o código de 6 dígitos que o site mandou para o e-mail.'),
      reqCarreira, erro('requisitos'),
      dz.v34 ? h('p', { class: 'ajuda' }, 'Os de emblema de fábrica não pedem nada da conta: vale a carreira-prova.') : null);
    desenharTipo();

    // ── prêmio e regulamento ──
    const premio = campoTexto('premio', 'Prêmio (texto livre, até 2.000)', { max: 2000, linhas: 3, contador: true, spell: true,
      ajuda: 'O texto que o jogo mostra como prêmio. Vazio: o jogo mostra "O prêmio deste desafio será anunciado aqui".' });
    const regulamento = campoTexto('regulamento', 'Regulamento (até 20.000)', { max: 20000, linhas: 12, contador: true, spell: true,
      ajuda: novo ? 'Vazio: o servidor escreve o regulamento de partida com o critério e os requisitos (dá para mudar depois).' : 'Quebras de linha ficam. O jogo mostra num bloco que abre e fecha.' });
    const cTexto = h('section', { class: 'cartao larga' }, h('div', { class: 'cartao-cabeca' }, h('h2', null, dz.v34 ? 'Regulamento e prêmio' : 'Prêmio e regulamento')), premio, regulamento);

    // ── prazo e ordem ──
    const cPrazo = h('section', { class: 'cartao' }, h('div', { class: 'cartao-cabeca' }, h('h2', null, 'Prazo'), h('span', { class: 'texto-3' }, 'dias em Brasília')),
      campoData('inicio', 'Início', D && D.inicio ? 'Hoje: ' + LP.dataHoraAno(D.inicio) + '. Escolher um dia faz começar às 00:00 dele; vazio = começa quando for ativado.' : 'Vazio = começa quando for ativado. Um dia = começa às 00:00 dele.'),
      campoData('fim', 'Fim', D && D.fim ? 'Hoje: ' + LP.dataHoraAno(D.fim) + '. O fim vale até as 23:59:59 do dia.' : 'Vazio = sem data para acabar. O fim vale até as 23:59:59 do dia.'),
      erro('datas'),
      campoNum('ordem', 'Ordem na tela do jogo', 0, 999, '(menor primeiro)'));

    // ── prévia ──
    dz.previa = h('div', { class: 'previa-desafio', 'aria-live': 'polite' });
    const cPrevia = h('section', { class: 'cartao' }, h('div', { class: 'cartao-cabeca' }, h('h2', null, 'Prévia'), h('span', { class: 'texto-3' }, 'o essencial do cartão no jogo')), dz.previa);

    dz.barra = h('div', { class: 'barra-salvar', hidden: true, role: 'region', 'aria-label': 'Alterações não salvas' },
      h('span', { class: 'texto-2', id: 'dz-resumo' }),
      h('div', { class: 'botoes' },
        LP.botao(novo ? 'Cancelar' : 'Descartar', () => { dz.form = null; location.hash = novo ? '#/desafios' : '#/desafios?id=' + D.id; }, { tipo: 'fantasma' }),
        LP.botao(novo ? 'Criar desafio' : 'Salvar', () => salvarEditor(), { tipo: 'ouro', icone: 'check' })));
    const voltar = h('a', { href: novo ? '#/desafios' : '#/desafios?id=' + D.id, class: 'link-voltar-aba' }, LP.icone('voltar'), h('span', null, novo ? 'Todos os desafios' : 'Voltar para o desafio'));
    if (dz.v34) desenharModo();
    LP.trocar(dz.corpo, voltar,
      !podeMexer ? h('p', { class: 'faixa faixa-info' }, 'O seu papel só vê: criar e mudar desafios pede o poder Configurações.') : null,
      h('div', { class: 'config-grade editor-desafio' }, cSobre, cPrevia, cEmblema, cCriterio, cReq, cTexto, cPrazo), dz.barra);
    atualizar();
  }

  /** v3.4: a seleção do critério (nacionalidade): escolher na lista dos países do jogo e "Pôr"; as escolhidas em pílulas com ×. */
  function campoSelecao(f, podeMexer, erroEl) {
    const lista = h('div', { class: 'chips selecoes-escolhidas', 'aria-live': 'polite' });
    const sel = h('select', { id: 'dz-nacionalidade', 'aria-label': 'Seleção', disabled: !podeMexer });
    const codigos = Object.keys(dz.paises).sort((a, b) => String(dz.paises[a]).localeCompare(String(dz.paises[b]), 'pt-BR'));
    sel.appendChild(h('option', { value: '' }, codigos.length ? 'Escolha a seleção…' : 'Digite o código abaixo'));
    codigos.forEach((c) => sel.appendChild(h('option', { value: c }, dz.paises[c] + ' (' + c + ')')));
    const codigo = h('input', { type: 'text', id: 'dz-nacionalidade-codigo', maxlength: 4, placeholder: 'BRA', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Código da seleção (3 letras)', disabled: !podeMexer });
    // o aviso do código digitado é só deste campo (não passa pelo validar: o que vai ao servidor é a lista)
    const erroCodigo = h('p', { class: 'erro-campo', role: 'alert', hidden: true });
    const por = (c) => {
      const x = String(c || '').trim().toUpperCase();
      if (!/^[A-Z]{2,4}$/.test(x)) { erroCodigo.hidden = false; erroCodigo.textContent = 'O código da seleção tem de 2 a 4 letras (como no jogo: BRA, ARG, FRA).'; return; }
      erroCodigo.hidden = true;
      if (!f.nacionalidade.includes(x) && f.nacionalidade.length < 30) f.nacionalidade.push(x);
      sel.value = '';
      codigo.value = '';
      dz.tocados.add('nacionalidade');
      pintar();
      atualizar();
    };
    sel.addEventListener('change', () => { if (sel.value) por(sel.value); });
    codigo.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); por(codigo.value); } });
    const botaoPor = LP.botao('Pôr', () => por(codigo.value || sel.value), { tipo: 'fantasma', pequeno: true, icone: 'mais', disabled: !podeMexer });
    function pintar() {
      LP.trocar(lista, f.nacionalidade.length ? f.nacionalidade.map((c) => h('span', { class: 'chip sem-ponto chip-selecao' }, (dz.paises[c] || 'código ' + c + ' (o jogo não tem)') + ' · ' + c,
        podeMexer ? h('button', { type: 'button', class: 'chip-x', 'aria-label': 'Tirar ' + (dz.paises[c] || c), title: 'Tirar', onclick: () => { f.nacionalidade = f.nacionalidade.filter((x) => x !== c); dz.tocados.add('nacionalidade'); pintar(); atualizar(); } }, '×') : null))
        : h('span', { class: 'texto-3' }, 'qualquer seleção'));
    }
    pintar();
    return h('div', { class: 'campo campo-selecao' }, h('label', { class: 'rotulo', for: 'dz-nacionalidade' }, 'Seleção do jogador'),
      h('div', { class: 'campo-linha' }, sel, codigo, botaoPor), lista,
      h('p', { class: 'ajuda' }, 'A seleção com que o jogador foi criado tem de ser a mesma do fim da carreira (quem trocou de seleção não vale). Vazio = qualquer seleção.'), erroCodigo, erroEl);
  }

  function atualizar() {
    if (!dz.form || !dz.barra) return;
    const f = dz.form;
    const e = validar();
    // o erro de um campo aparece depois de mexer nele (ou de tentar salvar), não no formulário recém-aberto
    const DE = { criterio: CHAVES.map(([k]) => k).concat(['nacionalidade']), datas: ['inicio', 'fim'] };
    const mostrar = (k) => dz.mostrarErros || dz.tocados.has(k) || (DE[k] || []).some((x) => dz.tocados.has(x));
    for (const k in dz.erros) {
      const msg = mostrar(k) ? e[k] : null;
      dz.erros[k].hidden = !msg;
      dz.erros[k].textContent = msg || '';
      const el = document.getElementById('dz-' + k);
      if (el) el.setAttribute('aria-invalid', msg ? 'true' : 'false');
    }
    const m = mudancas();
    const nomes = { titulo: 'título', slug: 'endereço', descricao: 'descrição', premio: 'prêmio', regulamento: 'regulamento', criterio: 'critério', requisitos: 'requisitos', inicio: 'início', fim: 'fim', ordem: 'ordem',
      modo: 'tipo', dificuldade: 'dificuldade', emblema: 'emblema', home: 'faixa da tela inicial' };
    const novo = !dz.d;
    const ks = Object.keys(m).filter((k) => !novo || k !== 'slug');
    dz.barra.hidden = !novo && ks.length === 0;
    document.body.classList.toggle('com-barra', !dz.barra.hidden);
    const t = document.getElementById('dz-resumo');
    if (t) t.textContent = novo ? (f.modo === 'emblema' && dz.v34 ? 'Desafio de emblema novo (nasce desativado)' : 'Desafio novo (nasce desativado)') : ks.length ? LP.plural(ks.length, 'alteração não salva', 'alterações não salvas') + ': ' + ks.map((k) => nomes[k] || k).join(', ') : '';
    // prévia
    if (dz.previa) {
      const emb = dz.v34 && f.modo === 'emblema';
      LP.trocar(dz.previa,
        h('div', { class: 'desafio-titulo' }, emb ? LP.emblema({ icone: f.icone, cor: f.cor }, { tamanho: 'g', rotulo: null }) : LP.icone('trofeu'), h('b', null, String(f.titulo).trim() || 'Título do desafio')),
        emb ? h('div', { class: 'chips' }, LP.chipDificuldade(f.dificuldade), f.home ? LP.chip('Na faixa da tela inicial', 'info', { semPonto: true }) : null) : null,
        String(f.descricao).trim() ? h('p', { class: 'texto-2' }, String(f.descricao).trim()) : null,
        h('p', null, h('span', { class: 'texto-3' }, 'O que vale: '), textoCriterio(criterioDoForm(f))),
        emb ? h('p', null, h('span', { class: 'texto-3' }, 'Quem ganha: '), 'todo mundo que cumprir, na hora (o emblema na conta, no perfil e no Hall)')
          : h('p', null, h('span', { class: 'texto-3' }, 'Prêmio: '), String(f.premio).trim() ? h('span', { class: 'desafio-premio' }, String(f.premio).trim()) : h('span', { class: 'texto-3' }, 'O prêmio deste desafio será anunciado aqui')),
        h('p', { class: 'texto-3' }, (f.inicio ? 'Começa em ' + f.inicio.split('-').reverse().join('/') : 'Começa quando for ativado') + ' · ' + (f.fim ? 'até ' + f.fim.split('-').reverse().join('/') : 'sem data para acabar')),
        chipsRequisitos(requisitosDoForm(f), criterioDoForm(f), emb));
    }
  }

  async function salvarEditor() {
    const e = validar();
    if (Object.keys(e).length) {
      dz.mostrarErros = true;
      atualizar();
      LP.avisar('Corrija os campos marcados antes de salvar.', 'erro');
      const k = Object.keys(e)[0];
      const el = document.getElementById('dz-' + k);
      if (el && el.focus) el.focus();
      return;
    }
    const D = dz.d;
    const m = mudancas();
    if (D && !Object.keys(m).length) return;
    const emb = dz.form.modo === 'emblema';
    const riscos = [];
    if (D && D.valendo && (m.criterio || m.requisitos || 'inicio' in m || 'fim' in m)) {
      riscos.push(emb ? 'O desafio está valendo: o servidor confere de novo todas as contas e quem passar a cumprir ganha o emblema agora (quem já ganhou continua com ele).'
        : 'O desafio está valendo: o servidor confere de novo todas as contas e quem passar a cumprir vira candidato agora.');
    }
    if (D && D.ativo && m.inicio && dz.original.inicio && m.inicio < dz.original.inicio && !emb) riscos.push('Antecipar o início faz valer carreiras salvas entre o novo início e o de antes.');
    if (m.requisitos && D && (m.requisitos.partidasMin < D.requisitos.partidasMin || (!m.requisitos.emailVerificado && D.requisitos.emailVerificado))) {
      riscos.push(emb ? 'Afrouxar um requisito pode dar o emblema a mais contas.' : 'Afrouxar um requisito pode criar candidatos novos (e mudar quem foi o primeiro).');
    }
    if ('premio' in m && D && D.ativo && !emb) riscos.push('O prêmio novo aparece no jogo para todo mundo.');
    if (D && D.ativo && emb && (m.emblema || m.dificuldade !== undefined || m.home !== undefined)) riscos.push('O emblema muda no jogo para todo mundo que já tem (a conta, o perfil e o Hall).');
    if (m.modo && D) riscos.push('O tipo muda de ' + (D.modo === 'emblema' ? 'emblema para prêmio' : 'prêmio para emblema') + '.');
    const corpo = riscos.length ? riscos.map((x) => h('p', { class: 'faixa faixa-alerta' }, x)) : null;
    let resp = null;
    dz.salvando = true;
    const r = await LP.dialogo({
      titulo: D ? 'Salvar as alterações de “' + D.titulo + '”?' : 'Criar o desafio “' + String(dz.form.titulo).trim() + '”?',
      botao: D ? 'Salvar' : 'Criar desafio',
      gerundio: 'Salvando…',
      texto: D ? [] : [emb && dz.v34 ? 'Ele nasce desativado: não aparece no jogo nem dá o emblema até você ativar. Ao ativar, as contas que já cumprem ganham na hora.'
        : 'Ele nasce desativado: não aparece no jogo nem marca candidatos até você ativar.'],
      corpo: corpo ? h('div', null, corpo) : null,
      executar: async () => {
        try {
          resp = await LP.adminPost(Object.assign({ acao: 'desafio_salvar' }, D ? { id: D.id } : {}, m));
          return resp;
        } catch (er) {
          // o servidor diz qual campo: mostra no formulário (e fecha o diálogo com o erro em toast)
          const k = er && er.codigo === 'slug_em_uso' ? 'slug' : er && er.codigo === 'vencido' ? 'criterio' : er && er.codigo === 'modo_travado' ? 'modo' : er && er.codigo;
          if (k && dz.erros[k]) { dz.erros[k].hidden = false; dz.erros[k].textContent = LP.mensagem(er); }
          throw er;
        }
      },
    });
    dz.salvando = false;
    if (!r || !resp) return;
    LP.esquecerMapaDesafios();
    const novo = resp.desafio;
    const nEmb = ehEmblema(novo);
    LP.avisar(D ? 'Desafio salvo' + (resp.candidatosNovos ? ' · ' + (nEmb ? LP.plural(resp.candidatosNovos, 'conta ganhou o emblema', 'contas ganharam o emblema') : LP.plural(resp.candidatosNovos, 'candidato novo', 'candidatos novos')) : '') + '.'
      : '“' + novo.titulo + '” criado (desativado). Ative quando estiver pronto.');
    dz.form = null;
    LP.depoisDeAgir();
    location.hash = '#/desafios?id=' + novo.id;
  }

  // ═══ ligação com o painel ══════════════════════════════════════════════════════════════════
  function recarregar() {
    if (dz.modo === 'lista') carregarLista(true);
    else if (dz.modo === 'detalhe') carregarDesafio(true);
  }
  // voltou da aba do jogo (o #/verificar registrou o resultado): a lista de candidatos vem atualizada
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !dz.corpo || !LP.visivel(dz.corpo) || LP.dialogoAberto()) return;
    if (dz.modo === 'detalhe' || dz.modo === 'lista') recarregar();
  });

  LP.abas.desafios = {
    titulo: 'Desafios',
    sub: '',
    montar: montar,
    recarregar: recarregar,
    sair: () => { document.body.classList.remove('com-barra'); dz.form = null; dz.pedido++; },
    podeSair: () => !LP.desafioSujo(),
    textoSair: () => 'Há alterações não salvas no desafio. Se sair agora, elas se perdem.',
    aoPulso: (a) => {
      // candidato novo (ou decidido noutra aba): a tela de agora se refaz sozinha, se ninguém estiver no meio de algo
      const n = a && a.acao ? a.acao.candidatosPendentes : undefined;
      if (n === undefined || n === dz.pendentes) return;
      const antes = dz.pendentes;
      dz.pendentes = n;
      if (antes === null || LP.dialogoAberto() || !LP.visivel(dz.corpo)) return;
      if (dz.modo === 'lista' || dz.modo === 'detalhe') recarregar();
    },
    aoMudarFora: recarregar,
  };
})();
