/* LENDA · painel — Desafios (v3.3, "As Taças do Rei"): a lista (admin.php?r=desafios), o desafio com os candidatos na
 * ordem em que cumpriram (?r=desafio&id=), o editor (desafio_salvar: título, critério, requisitos, prêmio, regulamento,
 * início/fim, ordem) e as decisões: ativar/desativar (desafio_ativar), "Verificar no jogo" (abre o #/verificar do jogo,
 * que refaz a carreira e registra o resultado), recusar com motivo (candidato_recusar), declarar o vencedor com
 * confirmação digitada (desafio_declarar_vencedor) e reabrir (desafio_reabrir). O prêmio é o texto que o admin escreve;
 * os desafios nascem desativados. Endereços: #/desafios, #/desafios?id=N[&estado=], #/desafios?id=N&parte=editar,
 * #/desafios?parte=novo. */
'use strict';

(function () {
  const LP = window.LP;
  const { h } = LP;

  const ESTADOS = ['pendente', 'verificada', 'recusada', 'vencedora'];
  const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
  const ROTULO_CAMPO = {
    copas: 'Copas do Mundo', libertadores: 'Libertadores', bolasOuro: 'Bolas de Ouro', titulos: 'Títulos', gols: 'Gols', pico: 'Pico de OVR',
    nota: 'Nota de Legado', jogos: 'Jogos', temporadas: 'Temporadas', id: 'Semente', identidade: 'Seleção e posição', replay: 'Replay', trofeus: 'Taças',
  };
  const NUMEROS = ['copas', 'libertadores', 'bolasOuro', 'titulos', 'gols', 'pico', 'nota', 'jogos', 'temporadas'];

  const dz = {
    modo: 'lista', id: 0, estado: '', pagina: 1, corpo: null, d: null, itens: [], total: 0, conquistasTotal: 87, partidasDiaMax: null,
    pedido: 0, pendentes: null, form: null, original: null, barra: null, erros: {}, salvando: false,
  };

  // ── textos ──────────────────────────────────────────────────────────────────────────────────
  /** "3 Copas do Mundo + 2 Libertadores numa carreira" / "Todas as 87 conquistas na conta". */
  function textoCriterio(c, total) {
    c = c || {};
    if (c.todasConquistas) return 'Todas as ' + LP.inteiro(total || dz.conquistasTotal) + ' conquistas na conta';
    const p = [];
    if (c.copas) p.push(LP.plural(c.copas, 'Copa do Mundo', 'Copas do Mundo'));
    if (c.libertadores) p.push(LP.plural(c.libertadores, 'Libertadores', 'Libertadores'));
    return p.length ? p.join(' + ') + ' numa carreira do Clássico' : '—';
  }
  function chipsRequisitos(r, criterio) {
    r = r || {};
    const conq = criterio && criterio.todasConquistas;
    const cs = [];
    if (r.partidasMin) cs.push(LP.chip(LP.plural(r.partidasMin, 'partida', 'partidas') + ' com a conta', 'info', { semPonto: true }));
    if (r.emailVerificado) cs.push(LP.chip('E-mail confirmado', 'info', { semPonto: true }));
    if (r.publicadoNoHall && !conq) cs.push(LP.chip('Publicada no Hall', 'info', { semPonto: true }));
    if (r.top3Perfil && !conq) cs.push(LP.chip('Entre as 3 do perfil', 'info', { semPonto: true }));
    if (!conq) cs.push(LP.chip('Com replay (Clássico desta versão)', '', { semPonto: true, title: 'O jogo grava as escolhas da carreira: é o que deixa a equipe refazer a carreira e conferir' }));
    return cs.length ? h('span', { class: 'chips' }, cs) : h('span', { class: 'texto-3' }, 'sem requisitos');
  }
  /** Situação do desafio: Tem vencedor / Encerrado / Valendo / Começa em… / Desativado. */
  function situacao(D) {
    const agora = Date.now();
    if (D.vencedor) return LP.chip('Tem vencedor', 'ouro', { semPonto: true });
    if (D.encerrado) return LP.chip('Encerrado', '', { title: D.fim ? 'Acabou em ' + LP.dataHoraAno(D.fim) : '' });
    if (D.valendo) return LP.chip('Valendo', 'ok', { title: 'Ativo e no prazo: quem cumprir tudo vira candidato agora' });
    if (D.ativo && D.inicio && Date.parse(D.inicio) > agora) return LP.chip('Começa ' + LP.dataHora(D.inicio), 'info');
    return LP.chip('Desativado', 'tracejado', { semPonto: true, title: 'Não aparece no jogo e ninguém vira candidato' });
  }
  function textoPrazo(D) {
    const ini = D.inicio ? 'de ' + LP.dataHoraAno(D.inicio) : 'começa quando for ativado';
    const fim = D.fim ? 'até ' + LP.dataHoraAno(D.fim) : 'sem data para acabar';
    return ini + ' · ' + fim + ' (Brasília)';
  }
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
  const linkJogoAbs = (texto, href, o) => {
    const a = h('a', { href: href, target: '_blank', rel: 'noopener', class: (o && o.tipo ? 'botao-' + o.tipo : 'botao') + (o && o.pequeno ? ' botao-pequeno' : ''), title: o && o.title });
    a.appendChild(LP.icone((o && o.icone) || 'externo'));
    a.appendChild(h('span', null, texto));
    a.addEventListener('click', (ev) => ev.stopPropagation());
    return a;
  };

  // ═══ montar ════════════════════════════════════════════════════════════════════════════════
  function montar(raiz, rota) {
    const q = rota.query;
    dz.id = /^\d{1,10}$/.test(q.id || '') ? Number(q.id) : 0;
    dz.modo = q.parte === 'novo' ? 'novo' : dz.id && q.parte === 'editar' ? 'editar' : dz.id ? 'detalhe' : 'lista';
    dz.estado = ESTADOS.includes(q.estado) ? q.estado : '';
    dz.pagina = Math.max(1, parseInt(q.pagina, 10) || 1);
    dz.d = null;
    dz.form = null;
    dz.original = null;
    dz.pendentes = null;
    dz.corpo = h('div');
    LP.trocar(raiz, dz.corpo);
    LP.trocar(dz.corpo, LP.estadoCarregando(6));
    if (dz.modo === 'lista') carregarLista();
    else if (dz.modo === 'novo') montarEditor(null);
    else carregarDesafio();
  }

  // ═══ lista ═════════════════════════════════════════════════════════════════════════════════
  async function carregarLista(silencioso) {
    const n = ++dz.pedido;
    if (silencioso && dz.corpo) dz.corpo.classList.add('esmaecido');
    try {
      const r = await LP.adminGet('desafios', {}, { sinal: LP.unico('desafios') });
      if (n !== dz.pedido || !LP.visivel(dz.corpo) || dz.modo !== 'lista') return;
      dz.conquistasTotal = r.conquistasTotal || dz.conquistasTotal;
      dz.partidasDiaMax = r.partidasDiaMax !== undefined ? r.partidasDiaMax : dz.partidasDiaMax;
      dz.pendentes = (LP.agora && LP.agora.acao && LP.agora.acao.candidatosPendentes) ?? null;
      desenharLista(Array.isArray(r.itens) ? r.itens : []);
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
    const esperando = itens.reduce((t, D) => t + somaCand(D), 0);
    LP.subAba(LP.plural(itens.length, 'desafio', 'desafios') + ' · ' + (valendo.length ? LP.plural(valendo.length, 'valendo agora', 'valendo agora') : 'nenhum valendo agora'));
    LP.acoesAba(LP.pode('config') ? LP.botao('Criar desafio', () => { location.hash = '#/desafios?parte=novo'; }, { tipo: 'ouro', icone: 'mais' }) : null,
      LP.linkJogo('Ver no jogo', '#/desafios', { tipo: 'fantasma', title: 'A tela Desafios do jogo (outra aba)' }));
    const L = LP.ladrilho;
    const ladrilhos = h('div', { class: 'ladrilhos espaco-baixo' },
      L('Valendo agora', LP.inteiro(valendo.length), valendo.length ? valendo.map((D) => D.titulo).join(' · ') : 'ative um desafio para ele aparecer no jogo', { classe: valendo.length ? 'ladrilho-ok' : '' }),
      L('Candidatos esperando', LP.inteiro(esperando), 'verificação no jogo ou o vencedor', { classe: esperando ? 'ladrilho-alerta' : '' }),
      L('Partidas por dia que contam', dz.partidasDiaMax === null || dz.partidasDiaMax === undefined ? '—' : LP.inteiro(dz.partidasDiaMax), 'muda em Configurações', { href: '#/config' }),
      L('Conquistas no jogo', LP.inteiro(dz.conquistasTotal), 'o desafio de todas as conquistas'));
    const ajuda = LP.ajuda('Quem cumpre o critério e todos os requisitos vira candidato sozinho (o servidor anota a hora com milésimos: o primeiro é o de menor hora). Antes de declarar o vencedor, use "Verificar no jogo": o jogo refaz a carreira com as mesmas escolhas e registra aqui se bateu. Os desafios nascem desativados e o prêmio é o texto que você escreve.');
    if (!itens.length) {
      LP.trocar(dz.corpo, ajuda, ladrilhos, LP.estadoVazio('Nenhum desafio', 'O instalar.php da v3.3 cria os três de fábrica (desativados).',
        LP.pode('config') ? LP.botao('Criar desafio', () => { location.hash = '#/desafios?parte=novo'; }, { tipo: 'ouro', icone: 'mais' }) : null));
      return;
    }
    LP.trocarNoLugar(dz.corpo, ajuda, ladrilhos, h('div', { class: 'grade-desafios' }, itens.map(cartaoDesafio)));
  }

  function cartaoDesafio(D) {
    const esp = somaCand(D);
    const c = D.candidatos || {};
    const contagens = [];
    if (c.pendente) contagens.push(LP.chip(LP.plural(c.pendente, 'esperando verificação', 'esperando verificação'), 'alerta', { semPonto: true }));
    if (c.verificada) contagens.push(LP.chip(LP.plural(c.verificada, 'verificada', 'verificadas'), 'ok', { semPonto: true }));
    if (c.recusada) contagens.push(LP.chip(LP.plural(c.recusada, 'recusada', 'recusadas'), '', { semPonto: true }));
    const abrir = () => { location.hash = '#/desafios?id=' + D.id; };
    const art = h('article', { class: 'cartao-desafio' + (D.valendo ? ' valendo' : '') + (D.vencedor ? ' com-vencedor' : ''), dataset: { id: D.id } },
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

  // ═══ ativar / desativar ════════════════════════════════════════════════════════════════════
  function botaoAtivar(D, depois, pequeno) {
    return D.ativo
      ? LP.botao('Desativar', () => ativar(D, false, depois), { tipo: 'fantasma', pequeno: !!pequeno, icone: 'bloquear' })
      : LP.botao('Ativar', () => ativar(D, true, depois), { tipo: 'ok', pequeno: !!pequeno, icone: 'jogar' });
  }
  async function ativar(D, sim, depois) {
    const texto = [];
    if (sim) {
      texto.push(h('p', null, 'O desafio aparece no jogo (tela Desafios e o destaque na tela inicial) e o servidor passa a marcar como candidato quem cumprir tudo, na ordem da hora.'));
      if (!D.premio) texto.push(h('p', { class: 'faixa faixa-alerta' }, 'O prêmio está vazio: o jogo mostra "O prêmio deste desafio será anunciado aqui". Dá para escrever depois em Editar.'));
      if (!D.inicio) texto.push(h('p', { class: 'faixa faixa-info' }, 'Sem data de início: ele começa agora. Carreiras salvas antes de agora não valem.'));
      else if (Date.parse(D.inicio) > Date.now()) texto.push(h('p', { class: 'faixa faixa-info' }, 'Começa em ' + LP.dataHoraAno(D.inicio) + ' (Brasília). Até lá aparece no jogo como "Começa em…".'));
      texto.push(h('ul', { class: 'lista-checagem' },
        h('li', null, h('span', { class: 'sim', 'aria-hidden': 'true' }, '✓'), h('span', null, 'O que vale: ' + textoCriterio(D.criterio))),
        h('li', null, h('span', { class: 'sim', 'aria-hidden': 'true' }, '✓'), h('span', null, 'Prazo: ' + textoPrazo(D))),
        h('li', null, h('span', { class: D.premio ? 'sim' : 'nao', 'aria-hidden': 'true' }, D.premio ? '✓' : '✗'), h('span', null, D.premio ? 'Prêmio escrito' : 'Prêmio ainda vazio')),
        h('li', null, h('span', { class: D.regulamento ? 'sim' : 'nao', 'aria-hidden': 'true' }, D.regulamento ? '✓' : '✗'), h('span', null, D.regulamento ? 'Regulamento escrito' : 'Regulamento vazio'))));
    } else {
      texto.push(h('p', null, 'O desafio sai do jogo e para de marcar candidatos. Os candidatos que já existem continuam aqui, com o estado de agora.'));
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
    LP.avisar(sim ? '“' + D.titulo + '” ativado' + (resp.candidatosNovos ? ' · ' + LP.plural(resp.candidatosNovos, 'candidato novo', 'candidatos novos') : '') + '. Já aparece no jogo.' : '“' + D.titulo + '” desativado. Saiu do jogo.');
    LP.depoisDeAgir();
    if (depois) depois(resp.desafio);
  }

  // ═══ desafio + candidatos ══════════════════════════════════════════════════════════════════
  async function carregarDesafio(silencioso) {
    const n = ++dz.pedido;
    if (silencioso && dz.corpo) dz.corpo.classList.add('esmaecido');
    try {
      const r = await LP.adminGet('desafio', { id: dz.id, estado: dz.estado, pagina: dz.pagina }, { sinal: LP.unico('desafio') });
      if (n !== dz.pedido || !LP.visivel(dz.corpo)) return;
      dz.d = r.desafio;
      const cs = r.candidatos || {};
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
  const recarregarDesafio = () => carregarDesafio(true);

  function desenharDesafio() {
    const D = dz.d;
    LP.tituloAba(D.titulo);
    LP.subAba('Desafio · ' + D.slug);
    LP.trocarQuery('desafios', { id: D.id, estado: dz.estado, pagina: dz.pagina > 1 ? dz.pagina : '' });
    const acoes = [];
    if (LP.pode('config')) {
      acoes.push(LP.botao('Editar', () => { location.hash = '#/desafios?id=' + D.id + '&parte=editar'; }, { tipo: 'fantasma', icone: 'lapis' }));
      if (!D.vencedor) acoes.push(botaoAtivar(D, recarregarDesafio));
      if (D.vencedor) acoes.push(LP.botao('Reabrir (tirar o vencedor)', () => reabrir(D), { tipo: 'perigo', icone: 'restaurar' }));
    }
    acoes.push(LP.linkJogo('Ver no jogo', '#/desafios', { tipo: 'fantasma', title: 'A tela Desafios do jogo (outra aba)' }));
    acoes.push(h('a', { href: LP.hash('registro', { alvo: 'desafio:' + D.id }), class: 'botao-fantasma', title: 'Tudo o que a equipe fez neste desafio' }, LP.icone('arquivo'), h('span', null, 'Ver no Registro')));
    LP.acoesAba();
    const voltar = h('a', { href: '#/desafios', class: 'link-voltar-aba' }, LP.icone('voltar'), h('span', null, 'Todos os desafios'));
    const ficha = h('section', { class: 'cartao ficha-desafio' },
      h('div', { class: 'desafio-topo' }, h('div', { class: 'desafio-titulo' }, LP.icone('trofeu'), h('h2', null, D.titulo)), situacao(D)),
      D.descricao ? h('p', { class: 'texto-2' }, D.descricao) : null,
      h('dl', { class: 'desafio-dados' },
        LP.dado('O que vale', h('b', null, textoCriterio(D.criterio)), { largo: true }),
        LP.dado('Requisitos', chipsRequisitos(D.requisitos, D.criterio), { largo: true }),
        LP.dado('Prêmio', D.premio ? h('span', { class: 'desafio-premio' }, D.premio) : h('span', { class: 'texto-3' }, 'vazio: o jogo mostra "O prêmio deste desafio será anunciado aqui"'), { largo: true }),
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
    LP.trocarNoLugar(dz.corpo, voltar, ficha, venc, secaoCandidatos());
  }

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
      dz.total > (dz.porPagina || 50) ? LP.paginacao(dz.total, dz.pagina, dz.porPagina || 50, (p) => { dz.pagina = p; carregarDesafio(true); window.scrollTo(0, 0); }) : null);
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
    const chipsConta = [LP.chipTipo(u.tipo), u.status === 'suspenso' ? LP.chip('Conta suspensa', 'perigo') : null,
      u.emailVerificado === false ? LP.chip('E-mail não confirmado', 'tracejado', { semPonto: true }) : null,
      u.partidasConta !== undefined ? h('span', { class: 'texto-3' }, LP.plural(u.partidasConta, 'partida', 'partidas') + ' com a conta') : null];
    const linhaCarreira = c ? h('div', { class: 'chips' },
      c.existe ? LP.linkCarreira(c.pk, h('b', null, c.jogador || 'carreira #' + c.pk)) : h('b', null, c.jogador || 'carreira'),
      h('span', { class: 'texto-2' }, [c.copas !== null && c.copas !== undefined ? LP.plural(c.copas, 'Copa', 'Copas') : null,
        c.libertadores !== null && c.libertadores !== undefined ? LP.plural(c.libertadores, 'Libertadores', 'Libertadores') : null,
        c.nota !== null && c.nota !== undefined ? 'nota ' + LP.inteiro(c.nota) : null].filter(Boolean).join(' · ')),
      !c.existe ? LP.chip('Carreira apagada', 'perigo') : c.temReplay ? LP.chip('com replay', 'ok', { semPonto: true }) : LP.chip('sem replay', 'perigo', { semPonto: true }))
      : conq ? h('p', { class: 'texto-2' }, 'Desafio de conquistas: vale a conta (todas as ' + LP.inteiro(dz.conquistasTotal) + ' sincronizadas).') : null;
    // ── decisões ──
    const bs = [];
    const podeVerificar = c && c.existe && k.estado !== 'vencedora' && LP.pode('moderar');
    if (podeVerificar && c.temReplay) bs.push(linkVerificar(k, k.estado === 'pendente' ? 'Verificar no jogo' : 'Verificar de novo', k.estado === 'pendente' ? 'ouro' : 'fantasma'));
    if (c && c.existe && k.links && k.links.resumo) bs.push(linkJogoAbs('Abrir a carreira', k.links.resumo, { tipo: 'fantasma', pequeno: true, title: 'O resumo da carreira no jogo (outra aba)' }));
    if (k.estado !== 'vencedora' && k.estado !== 'recusada' && LP.pode('moderar')) bs.push(LP.botao('Recusar', () => recusar(k), { tipo: 'perigo', pequeno: true, icone: 'x' }));
    if (k.estado === 'verificada' && !D.vencedor && LP.pode('config')) {
      const b = LP.botao('Declarar vencedor', () => declarar(k), { tipo: 'ouro', pequeno: true, icone: 'trofeu',
        disabled: !k.primeiro, title: k.primeiro ? 'O primeiro que cumpriu tudo, verificado no jogo' : 'Há um candidato que cumpriu antes esperando decisão: verifique ou recuse esse primeiro' });
      bs.push(b);
    }
    if (conq && k.estado === 'pendente' && LP.pode('moderar')) {
      // sem carreira para refazer: a equipe confere as conquistas da conta e registra
      bs.unshift(LP.botao('Conferi as conquistas', () => conferirConquistas(k), { tipo: 'ok', pequeno: true, icone: 'check', title: 'Marca como verificado (a conta tem as conquistas no servidor)' }));
    }
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
    const titulo = det.manual ? (v.ok ? 'Conferido pela equipe (as conquistas da conta)' : 'Recusado na conferência da equipe')
      : v.ok ? 'Bateu na verificação pelo jogo' : 'Não bateu na verificação pelo jogo';
    const difs = Array.isArray(det.diferencas) ? det.diferencas : [];
    const g = det.guardado && typeof det.guardado === 'object' ? det.guardado : null;
    const r = det.refeito && typeof det.refeito === 'object' ? det.refeito : null;
    // tabela simples (não vira cartões no celular): os 9 números, a linha diferente em vermelho
    const fmt = (x) => (x === null || x === undefined ? '—' : LP.inteiro(x));
    const tabela = g && r ? h('table', { class: 'tabela-verif' },
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Número'), h('th', { scope: 'col', class: 'num' }, 'Guardado'), h('th', { scope: 'col', class: 'num' }, 'Refeito no jogo'))),
      h('tbody', null, NUMEROS.filter((k) => k in g || k in r).map((k) => {
        const dif = g[k] !== r[k];
        return h('tr', { class: dif ? 'diferente' : null },
          h('td', null, dif ? h('span', { class: 'fora-da-tela' }, 'Diferente: ') : null, ROTULO_CAMPO[k] || k, dif ? h('span', { 'aria-hidden': 'true' }, ' ≠') : null),
          h('td', { class: 'num' }, fmt(g[k])), h('td', { class: 'num' }, fmt(r[k])));
      }))) : null;
    const outras = difs.filter((d) => !NUMEROS.includes(d.campo));
    const avisos = Array.isArray(det.avisos) ? det.avisos.filter((a) => typeof a === 'string') : [];
    const dados = det.dadosCarreira && det.dadosJogo && det.dadosCarreira !== det.dadosJogo
      ? h('p', { class: 'faixa faixa-info' }, 'A carreira foi jogada com outra versão dos dados (' + det.dadosCarreira + ' × ' + det.dadosJogo + '): uma diferença pode vir daí, e não de trapaça.') : null;
    return h('details', { class: 'verificacao ' + (v.ok ? 'verificacao-ok' : 'verificacao-nao'), open: !v.ok },
      h('summary', null, h('span', { class: v.ok ? 'sim' : 'nao', 'aria-hidden': 'true' }, v.ok ? '✓' : '✗'), ' ', titulo,
        h('span', { class: 'texto-3' }, ' · ' + quando + (typeof det.ms === 'number' ? ' · ' + LP.nf1.format(det.ms / 1000) + ' s' : '') + (typeof det.passos === 'number' ? ' · ' + LP.plural(det.passos, 'decisão', 'decisões') : ''))),
      !v.ok && det.motivo ? h('p', { class: 'texto-2' }, String(det.motivo)) : null,
      dados,
      outras.length ? h('ul', { class: 'texto-2' }, outras.map((d) => h('li', null, h('b', null, (ROTULO_CAMPO[d.campo] || d.campo) + ': '), String(d.guardado ?? '—') + ' → ' + String(d.refeito ?? '—')))) : null,
      tabela,
      avisos.length ? h('ul', { class: 'texto-3' }, avisos.map((a) => h('li', null, a))) : null);
  }

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
  async function conferirConquistas(k) {
    const u = k.usuario || {};
    if (!LP.confirmar('Marcar @' + (u.apelido || k.id) + ' como verificado? Confira antes, na ficha da conta, que ela tem todas as conquistas.')) return;
    try {
      await LP.adminPost({ acao: 'candidato_verificar', id: k.id, resultado: { ok: true, detalhes: { v: 1, manual: true, conquistas: true } } });
      LP.avisar('Candidato verificado.');
      LP.depoisDeAgir();
      recarregarDesafio();
    } catch (e) { LP.avisarErro(e); }
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
  const slugDe = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-').slice(0, 40).replace(/-+$/, '');
  function formDe(D) {
    const c = (D && D.criterio) || {};
    const r = (D && D.requisitos) || { partidasMin: 30, emailVerificado: true, publicadoNoHall: true, top3Perfil: true };
    return {
      titulo: D ? D.titulo : '', slug: D ? D.slug : '', descricao: (D && D.descricao) || '',
      tipo: c.todasConquistas ? 'conquistas' : 'tacas', copas: D ? c.copas || 0 : 1, libertadores: c.libertadores || 0,
      partidasMin: r.partidasMin === undefined ? 30 : r.partidasMin, emailVerificado: r.emailVerificado !== false, publicadoNoHall: r.publicadoNoHall !== false, top3Perfil: r.top3Perfil !== false,
      premio: (D && D.premio) || '', regulamento: (D && D.regulamento) || '', inicio: D ? diaDeIso(D.inicio) : '', fim: D ? diaDeIso(D.fim) : '', ordem: D ? D.ordem : 0,
    };
  }
  function criterioDoForm(f) {
    if (f.tipo === 'conquistas') return { todasConquistas: true };
    const c = {};
    if (Number(f.copas) > 0) c.copas = Number(f.copas);
    if (Number(f.libertadores) > 0) c.libertadores = Number(f.libertadores);
    return c;
  }
  function requisitosDoForm(f) {
    const conq = f.tipo === 'conquistas';
    return { partidasMin: Number(f.partidasMin), emailVerificado: !!f.emailVerificado, publicadoNoHall: conq ? false : !!f.publicadoNoHall, top3Perfil: conq ? false : !!f.top3Perfil };
  }
  const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  /** Os campos que mudaram, no formato do desafio_salvar (só eles vão: o início gravado na ativação não é trocado sem querer). */
  function mudancas() {
    const f = dz.form;
    const o = dz.original;
    if (!f || !o) return {};
    const m = {};
    if (!dz.d) m.slug = f.slug;
    ['titulo', 'descricao', 'premio', 'regulamento'].forEach((k) => { if (String(f[k]).trim() !== String(o[k]).trim()) m[k] = String(f[k]).trim() || (k === 'premio' ? '' : null); });
    if (!dz.d && !String(f.regulamento).trim()) delete m.regulamento; // novo sem regulamento: o servidor escreve o de partida
    if (!igual(criterioDoForm(f), criterioDoForm(o))) m.criterio = criterioDoForm(f);
    if (!igual(requisitosDoForm(f), requisitosDoForm(o))) m.requisitos = requisitosDoForm(f);
    if (f.inicio !== o.inicio) m.inicio = f.inicio || null;
    if (f.fim !== o.fim) m.fim = f.fim || null;
    if (Number(f.ordem) !== Number(o.ordem)) m.ordem = Number(f.ordem);
    if (!dz.d) { m.titulo = String(f.titulo).trim(); m.criterio = criterioDoForm(f); if (!m.requisitos) m.requisitos = requisitosDoForm(f); }
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
      if (!int(f.copas, 0, 30)) e.copas = 'De 0 a 30.';
      if (!int(f.libertadores, 0, 30)) e.libertadores = 'De 0 a 30.';
      if (!e.copas && !e.libertadores && Number(f.copas) < 1 && Number(f.libertadores) < 1) e.criterio = 'Peça pelo menos 1 Copa do Mundo ou 1 Libertadores.';
    }
    if (!int(f.partidasMin, 0, 10000)) e.partidasMin = 'De 0 a 10.000.';
    if (!int(f.ordem, 0, 999)) e.ordem = 'De 0 a 999.';
    if (f.inicio && f.fim && f.fim < f.inicio) e.datas = 'O fim tem de ser no mesmo dia do início ou depois.';
    if (dz.d && dz.d.ativo && dz.original.inicio && !f.inicio) e.datas = 'Com o desafio ativo, o início não fica vazio (ele já começou).';
    return e;
  }
  /** Tem alteração não salva no editor? (novo: algo escrito; editar: algum campo diferente do salvo) */
  LP.desafioSujo = function () {
    if (!dz.form || dz.salvando || (dz.modo !== 'editar' && dz.modo !== 'novo') || !LP.visivel(dz.corpo)) return false;
    if (dz.modo === 'novo') return ['titulo', 'descricao', 'premio', 'regulamento'].some((k) => String(dz.form[k] || '').trim() !== '');
    return Object.keys(mudancas()).length > 0;
  };

  function montarEditor(D) {
    dz.form = formDe(D);
    dz.original = formDe(D);
    dz.erros = {};
    dz.tocados = new Set();
    dz.mostrarErros = false;
    dz.slugManual = !!D;
    const f = dz.form;
    const novo = !D;
    LP.tituloAba(novo ? 'Criar desafio' : 'Editar · ' + D.titulo);
    LP.subAba(novo ? 'Nasce desativado: ative depois de conferir.' : 'Desafio · ' + D.slug);
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
      el.addEventListener('input', () => { f[k] = el.value.trim() === '' ? '' : Number(el.value); dz.tocados.add(k); atualizar(); });
      return h('div', { class: 'campo' }, h('label', { class: 'rotulo', for: id }, rotulo), h('span', { class: 'numero-campo' }, el, unidade ? h('span', null, unidade) : null), erro(k));
    };
    const caixa = (k, rotulo, ajuda) => {
      const id = 'dz-' + k;
      const el = h('input', { id: id, type: 'checkbox', role: 'switch', checked: !!f[k], disabled: !podeMexer });
      const txt = h('span', { class: 'estado-txt' }, el.checked ? 'Pedido' : 'Não pedido');
      el.addEventListener('change', () => { f[k] = el.checked; txt.textContent = el.checked ? 'Pedido' : 'Não pedido'; atualizar(); });
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

    // ── o que é ──
    const slug = campoTexto('slug', 'Endereço (slug)', { max: 40, disabled: !novo, ajuda: novo ? 'Só letras minúsculas, números e hífens. Não muda depois de criado.' : 'Não muda depois de criado.' });
    const entradaSlug = slug.querySelector('input');
    entradaSlug.addEventListener('input', () => { dz.slugManual = true; });
    const titulo = campoTexto('titulo', 'Título (3 a 80)', { max: 80, spell: true, aoMudar: (v) => {
      if (novo && !dz.slugManual) { f.slug = slugDe(v); entradaSlug.value = f.slug; }
    } });
    const descricao = campoTexto('descricao', 'Descrição curta (até 400)', { max: 400, linhas: 2, contador: true, spell: true, ajuda: 'Aparece no cartão do desafio no jogo, embaixo do título.' });
    const cSobre = h('section', { class: 'cartao' }, h('div', { class: 'cartao-cabeca' }, h('h2', null, 'O desafio')), titulo, slug, descricao);

    // ── critério ──
    const vencido = !!(D && D.vencedor);
    const caixaTacas = h('div', { class: 'campo-linha' },
      campoNum('copas', 'Copas do Mundo', 0, 30, 'na carreira', { disabled: vencido }), campoNum('libertadores', 'Libertadores', 0, 30, 'na carreira', { disabled: vencido }));
    const tipos = h('div');
    const reqCarreira = h('div');
    const desenharTipo = () => {
      LP.trocar(tipos, LP.segmentos('Tipo do critério', [{ valor: 'tacas', rotulo: 'Taças numa carreira' }, { valor: 'conquistas', rotulo: 'Todas as conquistas' }], f.tipo, (v) => {
        if (vencido || !podeMexer) return;
        f.tipo = v; desenharTipo(); atualizar();
      }));
      caixaTacas.hidden = f.tipo !== 'tacas';
      reqCarreira.hidden = f.tipo !== 'tacas';
      textoConq.hidden = f.tipo !== 'conquistas';
      textoTacas.hidden = f.tipo !== 'tacas';
    };
    const textoConq = h('p', { class: 'ajuda' }, 'Todas as conquistas: vale a primeira conta com as ' + LP.inteiro(dz.conquistasTotal) + ' conquistas do jogo sincronizadas (não há carreira para refazer: a equipe confere as conquistas da conta).');
    const textoTacas = h('p', { class: 'ajuda' }, 'Copas e Libertadores saem da carreira guardada na conta. 0 = não pede aquela taça.');
    const cCriterio = h('section', { class: 'cartao' }, h('div', { class: 'cartao-cabeca' }, h('h2', null, 'O que vale'), h('span', { class: 'texto-3' }, 'critério')),
      vencido ? h('p', { class: 'faixa faixa-info' }, 'O desafio já tem vencedor: o critério não muda (reabra antes, se precisar).') : null,
      tipos, caixaTacas, textoConq, textoTacas, erro('criterio'));

    // ── requisitos ──
    LP.anexar(reqCarreira, [caixa('publicadoNoHall', 'Carreira publicada no Hall das Lendas', 'Ela aparece no Hall público pelas regras de agora (a que espera a revisão da nota alta também conta).'),
      caixa('top3Perfil', 'Entre as 3 carreiras do perfil público', 'O perfil público mostra as 3 que o jogador tem no Hall.')]);
    const cReq = h('section', { class: 'cartao' }, h('div', { class: 'cartao-cabeca' }, h('h2', null, 'Requisitos'), h('span', { class: 'texto-3' }, 'para valer')),
      campoNum('partidasMin', 'Partidas mínimas com a conta', 0, 10000, 'partidas'),
      h('p', { class: 'ajuda' }, 'Contam até ' + (dz.partidasDiaMax ? LP.plural(dz.partidasDiaMax, 'partida', 'partidas') : 'o limite') + ' por dia por conta (Configurações). Carreira salva num dia em que a conta passou do limite não vale.'),
      caixa('emailVerificado', 'E-mail confirmado', 'A conta digitou o código de 6 dígitos que o site mandou para o e-mail.'),
      reqCarreira, erro('requisitos'));
    desenharTipo();

    // ── prêmio e regulamento ──
    const premio = campoTexto('premio', 'Prêmio (texto livre, até 2.000)', { max: 2000, linhas: 3, contador: true, spell: true,
      ajuda: 'O texto que o jogo mostra como prêmio. Vazio: o jogo mostra "O prêmio deste desafio será anunciado aqui".' });
    const regulamento = campoTexto('regulamento', 'Regulamento (até 20.000)', { max: 20000, linhas: 12, contador: true, spell: true,
      ajuda: novo ? 'Vazio: o servidor escreve o regulamento de partida com o critério e os requisitos (dá para mudar depois).' : 'Quebras de linha ficam. O jogo mostra num bloco que abre e fecha.' });
    const cTexto = h('section', { class: 'cartao larga' }, h('div', { class: 'cartao-cabeca' }, h('h2', null, 'Prêmio e regulamento')), premio, regulamento);

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
    LP.trocar(dz.corpo, voltar,
      !podeMexer ? h('p', { class: 'faixa faixa-info' }, 'O seu papel só vê: criar e mudar desafios pede o poder Configurações.') : null,
      h('div', { class: 'config-grade editor-desafio' }, cSobre, cPrevia, cCriterio, cReq, cTexto, cPrazo), dz.barra);
    atualizar();
  }

  function atualizar() {
    if (!dz.form || !dz.barra) return;
    const f = dz.form;
    const e = validar();
    // o erro de um campo aparece depois de mexer nele (ou de tentar salvar), não no formulário recém-aberto
    const DE = { criterio: ['copas', 'libertadores'], datas: ['inicio', 'fim'] };
    const mostrar = (k) => dz.mostrarErros || dz.tocados.has(k) || (DE[k] || []).some((x) => dz.tocados.has(x));
    for (const k in dz.erros) {
      const msg = mostrar(k) ? e[k] : null;
      dz.erros[k].hidden = !msg;
      dz.erros[k].textContent = msg || '';
      const el = document.getElementById('dz-' + k);
      if (el) el.setAttribute('aria-invalid', msg ? 'true' : 'false');
    }
    const m = mudancas();
    const nomes = { titulo: 'título', slug: 'endereço', descricao: 'descrição', premio: 'prêmio', regulamento: 'regulamento', criterio: 'critério', requisitos: 'requisitos', inicio: 'início', fim: 'fim', ordem: 'ordem' };
    const ks = Object.keys(m).filter((k) => dz.d || k !== 'slug');
    const novo = !dz.d;
    dz.barra.hidden = !novo && ks.length === 0;
    document.body.classList.toggle('com-barra', !dz.barra.hidden);
    const t = document.getElementById('dz-resumo');
    if (t) t.textContent = novo ? 'Desafio novo (nasce desativado)' : ks.length ? LP.plural(ks.length, 'alteração não salva', 'alterações não salvas') + ': ' + ks.map((k) => nomes[k] || k).join(', ') : '';
    // prévia
    if (dz.previa) {
      LP.trocar(dz.previa,
        h('div', { class: 'desafio-titulo' }, LP.icone('trofeu'), h('b', null, String(f.titulo).trim() || 'Título do desafio')),
        String(f.descricao).trim() ? h('p', { class: 'texto-2' }, String(f.descricao).trim()) : null,
        h('p', null, h('span', { class: 'texto-3' }, 'O que vale: '), textoCriterio(criterioDoForm(f))),
        h('p', null, h('span', { class: 'texto-3' }, 'Prêmio: '), String(f.premio).trim() ? h('span', { class: 'desafio-premio' }, String(f.premio).trim()) : h('span', { class: 'texto-3' }, 'O prêmio deste desafio será anunciado aqui')),
        h('p', { class: 'texto-3' }, (f.inicio ? 'Começa em ' + f.inicio.split('-').reverse().join('/') : 'Começa quando for ativado') + ' · ' + (f.fim ? 'até ' + f.fim.split('-').reverse().join('/') : 'sem data para acabar')),
        chipsRequisitos(requisitosDoForm(f), criterioDoForm(f)));
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
    const riscos = [];
    if (D && D.valendo && (m.criterio || m.requisitos || 'inicio' in m || 'fim' in m)) riscos.push('O desafio está valendo: o servidor confere de novo todas as contas e quem passar a cumprir vira candidato agora.');
    if (D && D.ativo && m.inicio && dz.original.inicio && m.inicio < dz.original.inicio) riscos.push('Antecipar o início faz valer carreiras salvas entre o novo início e o de antes.');
    if (m.requisitos && D && (m.requisitos.partidasMin < D.requisitos.partidasMin || (!m.requisitos.emailVerificado && D.requisitos.emailVerificado))) riscos.push('Afrouxar um requisito pode criar candidatos novos (e mudar quem foi o primeiro).');
    if ('premio' in m && D && D.ativo) riscos.push('O prêmio novo aparece no jogo para todo mundo.');
    const corpo = riscos.length ? riscos.map((x) => h('p', { class: 'faixa faixa-alerta' }, x)) : null;
    let resp = null;
    dz.salvando = true;
    const r = await LP.dialogo({
      titulo: D ? 'Salvar as alterações de “' + D.titulo + '”?' : 'Criar o desafio “' + String(dz.form.titulo).trim() + '”?',
      botao: D ? 'Salvar' : 'Criar desafio',
      gerundio: 'Salvando…',
      texto: D ? [] : ['Ele nasce desativado: não aparece no jogo nem marca candidatos até você ativar.'],
      corpo: corpo ? h('div', null, corpo) : null,
      executar: async () => {
        try {
          resp = await LP.adminPost(Object.assign({ acao: 'desafio_salvar' }, D ? { id: D.id } : {}, m));
          return resp;
        } catch (er) {
          // o servidor diz qual campo: mostra no formulário (e fecha o diálogo com o erro em toast)
          const k = er && er.codigo === 'slug_em_uso' ? 'slug' : er && er.codigo === 'vencido' ? 'criterio' : er && er.codigo;
          if (k && dz.erros[k]) { dz.erros[k].hidden = false; dz.erros[k].textContent = LP.mensagem(er); }
          throw er;
        }
      },
    });
    dz.salvando = false;
    if (!r || !resp) return;
    const novo = resp.desafio;
    LP.avisar(D ? 'Desafio salvo' + (resp.candidatosNovos ? ' · ' + LP.plural(resp.candidatosNovos, 'candidato novo', 'candidatos novos') : '') + '.' : '“' + novo.titulo + '” criado (desativado). Ative quando estiver pronto.');
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
    sair: () => { document.body.classList.remove('com-barra'); dz.form = null; },
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
