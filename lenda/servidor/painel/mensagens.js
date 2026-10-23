/* LENDA · painel — Mensagens (Fale conosco, v3.3): a caixa de entrada das mensagens que os jogadores mandam pelo jogo
 * (admin.php?r=suporte: filtros por situação e assunto, busca, páginas), a fila ao vivo das novas (o pulso traz
 * filas.mensagens), as ações em lote (suporte_lote) e a ficha da mensagem no painel lateral (mensagem=<id> no hash, em
 * qualquer aba): o texto inteiro, quem mandou, a resposta por e-mail (suporte_responder, com prévia) e a situação
 * (suporte_status). Abrir uma mensagem nova marca como lida (quem tem o poder Contas). Texto do jogador entra só por
 * textContent. */
'use strict';

(function () {
  const LP = window.LP;
  const { h } = LP;

  const STATUS = ['nova', 'lida', 'respondida', 'arquivada'];
  const TIPOS = ['duvida', 'ideia', 'problema', 'recomendacao', 'outro'];
  const RESPOSTA_MAX = 4000;
  // respostas prontas: só um começo de texto (a pessoa completa); nada de promessa que a equipe não pode cumprir
  const PRONTAS = [
    { rotulo: 'Agradecer a ideia', texto: 'Obrigado pela ideia! Anotamos aqui e ela vai para a lista do que podemos fazer nas próximas versões do LENDA.' },
    { rotulo: 'Pedir mais detalhes', texto: 'Obrigado por avisar. Para a gente achar o problema, conte um pouco mais: em que tela aconteceu, se foi no celular ou no computador e o que você fez antes.' },
    { rotulo: 'Problema resolvido', texto: 'Obrigado por avisar! Já corrigimos: recarregue o jogo e tente de novo. Se continuar, responda este e-mail.' },
  ];

  const msg = {
    status: 'nova', tipo: '', q: '', pagina: 1, corpo: null, filtros: null, filtrosTipo: null, busca: null, contato: null, temDados: false,
    itens: [], marcados: new Set(), lote: null, tabela: null, fila: null, contagens: null, novasPorTipo: null, emailContato: '',
  };
  /** Rascunhos da resposta por mensagem (só nesta aba: fechar a ficha não perde o texto). */
  const rascunhos = new Map();

  const trecho = (t, n) => {
    const s = String(t || '').replace(/\s+/g, ' ').trim();
    return s.length > (n || 160) ? s.slice(0, (n || 160) - 1) + '…' : s;
  };
  const chipTipo = (t) => LP.chip(LP.NOMES_TIPO_SUPORTE[t] || t || '—', t === 'problema' ? 'perigo' : t === 'ideia' || t === 'recomendacao' ? 'ouro' : 'info', { semPonto: true });

  // ═══ lista ═════════════════════════════════════════════════════════════════════════════════
  function montar(raiz, rota) {
    const q = rota.query;
    msg.status = q.status === 'todas' ? '' : STATUS.includes(q.status) ? q.status : 'nova';
    msg.tipo = TIPOS.includes(q.tipo) ? q.tipo : '';
    msg.q = String(q.q || '').slice(0, 100);
    msg.pagina = Math.max(1, parseInt(q.pagina, 10) || 1);
    msg.temDados = false;
    msg.marcados = new Set();
    msg.fila = null;
    msg.corpo = h('div');
    msg.filtros = h('div');
    msg.filtrosTipo = h('div');
    msg.contato = h('div', { class: 'msg-contato' });
    msg.busca = LP.busca('Buscar no texto, apelido, protocolo, e-mail ou #id', msg.q, (v) => { msg.q = v; msg.pagina = 1; msg.marcados.clear(); carregar(); });
    LP.trocar(raiz,
      LP.ajuda('O que os jogadores mandam pelo "Fale conosco" do jogo (com ou sem conta). Abrir uma mensagem nova marca como lida; "Responder" manda a resposta por e-mail, com a mensagem original embaixo, e marca como respondida.'),
      msg.contato,
      h('div', { class: 'ferramentas' }, msg.filtros),
      h('div', { class: 'ferramentas' }, msg.filtrosTipo, msg.busca),
      msg.corpo);
    desenharFiltros();
    carregar();
  }

  function desenharFiltros() {
    if (!msg.filtros || !msg.filtros.isConnected) return;
    const c = msg.contagens || {};
    const ac = (LP.agora && LP.agora.acao) || {};
    const novas = ac.mensagensNovas !== undefined ? ac.mensagensNovas : c.nova;
    LP.trocarSegmentos(msg.filtros, 'Situação', [
      { valor: 'nova', rotulo: 'Novas', contador: novas, tipoContador: 'alerta' },
      { valor: 'lida', rotulo: 'Lidas', contador: c.lida },
      { valor: 'respondida', rotulo: 'Respondidas', contador: c.respondida },
      { valor: 'arquivada', rotulo: 'Arquivadas', contador: c.arquivada },
      { valor: '', rotulo: 'Todas' },
    ], msg.status, (v) => { msg.status = v; msg.pagina = 1; msg.marcados.clear(); msg.fila = null; desenharFiltros(); carregar(); });
    const pt = msg.novasPorTipo || {};
    LP.trocarSegmentos(msg.filtrosTipo, 'Assunto', [{ valor: '', rotulo: 'Todos os assuntos' }].concat(TIPOS.map((t) => ({
      valor: t, rotulo: LP.NOMES_TIPO_SUPORTE[t], contador: msg.status === 'nova' ? pt[t] : undefined, tipoContador: 'alerta',
      title: msg.status === 'nova' && pt[t] ? LP.plural(pt[t], 'nova', 'novas') + ' com este assunto' : null,
    }))), msg.tipo, (v) => { msg.tipo = v; msg.pagina = 1; msg.marcados.clear(); msg.fila = null; desenharFiltros(); carregar(); });
  }

  function desenharContato() {
    if (!msg.contato || !msg.contato.isConnected || !msg.emailContato) return;
    if (msg.contato.dataset.email === msg.emailContato) return;
    msg.contato.dataset.email = msg.emailContato;
    LP.trocar(msg.contato, h('p', { class: 'texto-3' }, 'E-mail de contato que o jogo mostra no Fale conosco: ',
      h('span', { class: 'mono' }, msg.emailContato), ' ',
      LP.botao('Copiar', (ev, b) => LP.copiar(msg.emailContato, b), { tipo: 'fantasma', pequeno: true, icone: 'copiar', title: 'Copiar o e-mail de contato' })));
  }

  function queryLista() {
    return { status: msg.status === 'nova' ? '' : msg.status || 'todas', tipo: msg.tipo, q: msg.q, pagina: msg.pagina > 1 ? msg.pagina : '' };
  }

  async function carregar(silencioso, novos) {
    if (!LP.visivel(msg.corpo)) return null;
    LP.trocarQuery('mensagens', queryLista());
    if (!silencioso) {
      msg.fila = LP.filaDoPulso('mensagens');
      if (!msg.temDados) LP.trocar(msg.corpo, LP.estadoCarregando(6));
      else msg.corpo.classList.add('esmaecido');
      if (msg.q) msg.busca.estado('buscando…');
    }
    try {
      const st = msg.status;
      const tp = msg.tipo;
      const d = await LP.adminGet('suporte', { status: st, tipo: tp, q: msg.q, pagina: msg.pagina }, { sinal: LP.unico(silencioso ? 'suporte-pulso' : 'suporte') });
      if (!LP.visivel(msg.corpo) || st !== msg.status || tp !== msg.tipo) return null;
      msg.corpo.classList.remove('esmaecido');
      msg.contagens = d.contagens || msg.contagens;
      msg.novasPorTipo = d.novasPorTipo || msg.novasPorTipo;
      msg.emailContato = typeof d.contato === 'string' ? d.contato : msg.emailContato;
      desenharFiltros();
      desenharContato();
      if (silencioso) return d;
      msg.temDados = true;
      LP.esconderNovidade();
      desenharLista(d, novos);
      return d;
    } catch (e) {
      if (LP.cancelado(e)) return null;
      msg.corpo.classList.remove('esmaecido');
      if (silencioso || (e && e.status === 401) || !LP.visivel(msg.corpo)) return null;
      msg.temDados = false;
      msg.busca.estado('');
      LP.trocar(msg.corpo, LP.estadoErro(e, () => carregar()));
      return null;
    }
  }

  function celulaMensagem(x) {
    return h('div', { class: 'celula-msg' },
      h('span', { class: 'chips msg-topo' }, chipTipo(x.tipo), h('span', { class: 'mono texto-3' }, x.protocolo)),
      h('span', { class: 'msg-trecho' }, trecho(x.mensagem)));
  }
  function celulaDe(x) {
    if (x.usuario) return h('div', { class: 'celula-dupla' }, LP.linkUsuario(x.usuario), h('span', { class: 'linha-email' }, LP.email(x.email)));
    return h('div', { class: 'celula-dupla' }, h('span', { class: 'texto-3' }, x.comConta ? 'conta excluída' : 'sem conta'), h('span', { class: 'linha-email' }, LP.email(x.email)));
  }
  function celulaSituacao(x) {
    return h('span', { class: 'chips' }, LP.chipStatusSuporte(x.status),
      x.status === 'respondida' && x.respondidaEm ? h('span', { class: 'texto-3', title: LP.dataHoraAno(x.respondidaEm) }, LP.relativo(x.respondidaEm) + (x.quem && x.quem.nome ? ' · ' + x.quem.nome : '')) : null);
  }

  function desenharLista(d, novos) {
    const itens = Array.isArray(d.itens) ? d.itens : [];
    msg.itens = itens;
    const total = d.total || 0;
    const filtrado = !!(msg.q || msg.tipo);
    const nome = { nova: ['mensagem nova', 'mensagens novas'], lida: ['lida', 'lidas'], respondida: ['respondida', 'respondidas'], arquivada: ['arquivada', 'arquivadas'] }[msg.status] || ['mensagem', 'mensagens'];
    LP.subAba(LP.plural(total, nome[0], nome[1]) + (filtrado ? ' com esse filtro' : ''));
    msg.busca.estado(msg.q ? LP.plural(total, 'encontrada', 'encontradas') : '');
    if (!itens.length) {
      document.body.classList.remove('com-lote');
      const vazio = msg.status === 'nova' && !filtrado
        ? LP.estadoVazio('Nenhuma mensagem nova', 'As que chegarem aparecem aqui sozinhas (e o número "Mensagens novas" lá em cima avisa).',
          LP.botao('Ver todas', () => { location.hash = '#/mensagens?status=todas'; }, { tipo: 'fantasma' }))
        : LP.estadoVazio(filtrado ? 'Nada com esse filtro' : 'Nenhuma mensagem aqui', filtrado ? 'Confira a busca: texto, apelido, protocolo (8 letras), e-mail inteiro ou #id.' : 'O Fale conosco fica no menu do jogo e em Minha conta.',
          filtrado ? LP.botao('Limpar filtros', () => { location.hash = '#/mensagens' + (msg.status === 'nova' ? '' : '?status=' + (msg.status || 'todas')); }, { tipo: 'fantasma' }) : null);
      LP.trocarNoLugar(msg.corpo, vazio);
      return;
    }
    const comLote = LP.pode('usuarios');
    const lote = comLote ? LP.barraLote({
      itens: () => msg.itens,
      marcados: msg.marcados,
      nome: ['mensagem', 'mensagens', 'f'],
      rotuloMarcar: (n) => 'Marcar as ' + LP.inteiro(n) + ' desta página',
      aoMudar: () => { if (msg.tabela) msg.tabela.sincronizarSelecao(); },
      acoes: [
        { rotulo: (n) => 'Marcar como lida' + (n ? ' (' + n + ')' : ''), tipo: 'fantasma', icone: 'check', executar: (ids) => emLote(ids, 'lida') },
        { rotulo: (n) => 'Arquivar' + (n ? ' (' + n + ')' : ''), tipo: 'fantasma', icone: 'arquivar', executar: (ids) => emLote(ids, 'arquivada') },
        { rotulo: (n) => 'Voltar para nova' + (n ? ' (' + n + ')' : ''), tipo: 'fantasma', icone: 'restaurar', executar: (ids) => emLote(ids, 'nova') },
      ],
    }) : null;
    msg.lote = lote;
    msg.tabela = LP.lista({
      itens: itens,
      novos: novos,
      classe: 'lista-mensagens',
      aoClicar: (x) => LP.abrirMensagem(x.id),
      rotuloLinha: (x) => 'Abrir a mensagem ' + x.protocolo,
      classeLinha: (x) => (x.status === 'nova' ? 'msg-nova' : null),
      selecao: comLote ? { marcados: msg.marcados, aoMudar: () => lote.atualizar() } : null,
      colunas: [
        { rotulo: 'Mensagem', principal: true, classe: 'celula-larga', celula: celulaMensagem },
        { rotulo: 'De', classe: 'de-celula', celula: celulaDe },
        { rotulo: 'Tela', celula: (x) => (x.pagina ? h('span', { class: 'mono texto-3' }, x.pagina) : '—') },
        { rotulo: 'Recebida', celula: (x) => LP.quando(x.criadoEm) },
        { rotulo: 'Situação', classe: 'situacao', celula: celulaSituacao },
        { rotulo: 'Ações', acoes: true, celula: (x) => LP.botao('Abrir', () => LP.abrirMensagem(x.id), { tipo: 'fantasma', pequeno: true, icone: 'olho', compacto: true, title: 'Abrir a mensagem inteira (e responder)' }) },
      ],
    });
    LP.trocarNoLugar(msg.corpo, lote ? lote.no : null, msg.tabela,
      LP.paginacao(total, d.pagina || msg.pagina, d.porPagina || 50, (p) => { msg.pagina = p; msg.marcados.clear(); carregar(); LP.rolarParaAba(); }));
    if (lote) lote.atualizar();
  }

  async function emLote(ids, status) {
    const n = ids.length;
    const verbo = { lida: ['marcada como lida', 'marcadas como lidas'], arquivada: ['arquivada', 'arquivadas'], nova: ['de volta para nova', 'de volta para novas'] }[status];
    try {
      const r = await LP.adminPost({ acao: 'suporte_lote', ids: ids.map(Number), status: status });
      const feitos = (r.feitos || []).map(String);
      LP.avisar(LP.resumoLote(feitos.length, r.pulados, verbo, LP.PULOS) + '.');
      feitos.forEach((id) => msg.marcados.delete(id));
      LP.marcarFeitos('mensagem', feitos);
      LP.depoisDeAgir();
      // saíram do filtro de agora: somem; senão, a lista é refeita no lugar
      if (msg.status && msg.status !== status) LP.sumirLinhas(msg.corpo, feitos, () => carregar());
      else carregar();
      if (n && LP.gaveta.aberta() && LP.gaveta.aberta().tipo === 'mensagem' && feitos.includes(LP.gaveta.aberta().id)) carregarFicha();
    } catch (e) { LP.avisarErro(e); }
  }

  /** A fila de novas mudou noutro lugar (P1-13): o pulso traz a marca das 100 novas mais recentes. */
  async function fila(a) {
    if (!a.filas || msg.status !== 'nova' || msg.pagina > 1 || msg.q || msg.tipo) return;
    const novo = a.filas.mensagens;
    if (!novo || novo === msg.fila) return;
    msg.fila = novo;
    const d = await carregar(true);
    if (!d) return;
    LP.atualizarFila({
      raiz: msg.corpo,
      antes: msg.itens.map((x) => x.id),
      depois: (d.itens || []).map((x) => x.id),
      marcados: msg.marcados,
      tipo: 'mensagem',
      rotuloNovos: (n) => LP.plural(n, 'mensagem nova', 'mensagens novas') + ' no Fale conosco — clique para ver',
      redesenhar: (novos) => desenharLista(d, novos),
      recarregar: (novos) => carregar(false, novos),
      aoMudarSelecao: () => { if (msg.lote) msg.lote.atualizar(); },
    });
  }

  LP.abas.mensagens = {
    titulo: 'Mensagens',
    sub: '',
    montar: montar,
    recarregar: () => carregar(),
    sair: () => { document.body.classList.remove('com-lote'); },
    aoPulso: (a) => { desenharFiltros(); fila(a); },
    aoMudarFora: () => carregar(),
  };
  LP.recarregarListaMensagens = () => { if (LP.visivel(msg.corpo)) carregar(); };

  // ═══ ficha da mensagem (painel lateral) ═════════════════════════════════════════════════════
  const fm = { id: 0, corpo: null, pedido: 0, x: null, lidaAoAbrir: false };

  LP.abrirFichaMensagem = function (id) {
    fm.id = parseInt(id, 10) || 0;
    fm.x = msg.itens.find((x) => x.id === fm.id) || null;
    fm.lidaAoAbrir = false;
    fm.corpo = LP.gaveta.abrir('mensagem', id, 'Mensagem #' + id);
    if (!fm.corpo) return;
    if (fm.x) desenharFicha(fm.x); else LP.trocar(fm.corpo, LP.estadoCarregando(6));
    carregarFicha(true);
  };

  /** Não há rota de uma mensagem só: a busca pelo protocolo (ou "#id") traz a linha certa entre as da conta. */
  async function carregarFicha(aoAbrir) {
    const n = ++fm.pedido;
    const corpo = fm.corpo;
    if (!fm.id) { LP.trocar(corpo, LP.estadoVazio('Mensagem não encontrada', 'O endereço não tem um id válido.')); return; }
    try {
      const q = fm.x && fm.x.protocolo ? fm.x.protocolo : '#' + fm.id;
      const d = await LP.adminGet('suporte', { q: q });
      if (n !== fm.pedido || !corpo.isConnected) return;
      const x = (Array.isArray(d.itens) ? d.itens : []).find((i) => i.id === fm.id);
      if (!x) {
        LP.gaveta.titulo('Mensagem');
        LP.trocar(corpo, LP.estadoVazio('Mensagem não encontrada', 'Ela pode ter sido apagada (a conta foi excluída ou passou de 12 meses).'));
        return;
      }
      if (typeof d.contato === 'string') msg.emailContato = d.contato;
      fm.x = x;
      const rol = corpo.scrollTop;
      desenharFicha(x);
      corpo.scrollTop = rol;
      // abriu uma nova: fica lida (quem tem o poder Contas); a linha da lista muda no lugar
      if (aoAbrir && x.status === 'nova' && LP.pode('usuarios')) marcarLidaAoAbrir(x);
    } catch (e) {
      if (n !== fm.pedido || (e && e.status === 401) || !corpo.isConnected) return;
      LP.trocar(corpo, LP.estadoErro(e, () => carregarFicha(false)));
    }
  }

  async function marcarLidaAoAbrir(x) {
    try {
      await LP.adminPost({ acao: 'suporte_status', id: x.id, status: 'lida' });
      if (fm.x !== x) return;
      x.status = 'lida';
      x.atualizadaEm = new Date().toISOString();
      x.quem = { nome: (LP.sessao && LP.sessao.quem && LP.sessao.quem.nome) || 'você' };
      fm.lidaAoAbrir = true;
      LP.marcarFeitos('mensagem', [x.id]);
      atualizarLinha(x);
      if (fm.corpo && fm.corpo.isConnected) desenharFicha(x);
      LP.depoisDeAgir();
    } catch (e) { if (e && e.status !== 401) LP.avisarErro(e); }
  }

  /** A linha da lista (se estiver na tela) com a situação nova, sem refazer a lista. */
  function atualizarLinha(x) {
    const i = msg.itens.findIndex((y) => y.id === x.id);
    if (i >= 0) msg.itens[i] = Object.assign({}, msg.itens[i], x);
    if (!msg.corpo) return;
    msg.corpo.querySelectorAll('tr[data-id="' + x.id + '"]').forEach((tr) => {
      tr.classList.toggle('msg-nova', x.status === 'nova');
      const td = tr.querySelector('td.situacao');
      if (td) LP.trocar(td, celulaSituacao(x));
    });
  }

  function depoisNaFicha() {
    carregarFicha(false);
    LP.depoisDeAgir();
    LP.recarregarListaMensagens();
    const m = LP.abas[LP.rota().aba];
    if (m && m !== LP.abas.mensagens && m.aoMudarFora) m.aoMudarFora();
  }

  async function mudarStatus(x, status, botao) {
    try {
      await LP.adminPost({ acao: 'suporte_status', id: x.id, status: status });
      LP.avisar({ lida: 'Mensagem marcada como lida.', nova: 'Mensagem de volta para as novas.', arquivada: 'Mensagem arquivada.', respondida: 'Mensagem marcada como respondida.' }[status]);
      fm.lidaAoAbrir = false;
      LP.marcarFeitos('mensagem', [x.id]);
      depoisNaFicha();
    } catch (e) { LP.avisarErro(e); }
  }

  /** O e-mail como a pessoa vai receber (o mesmo formato do servidor: olá, a resposta, a assinatura e a mensagem citada). */
  function previaEmail(x, resposta) {
    const nome = x.usuario && x.usuario.apelido ? ', ' + x.usuario.apelido : '';
    const citado = String(x.mensagem || '').slice(0, 1500).split('\n').map((l) => '> ' + l).join('\n');
    return 'Olá' + nome + '!\n\n' + resposta + '\n\n— Equipe LENDA · https://oprojeto.online/lenda/\n\n' +
      'Sua mensagem (protocolo ' + x.protocolo + ', ' + LP.data(x.criadoEm) + '):\n' + citado + '\n\n' +
      'Para falar de novo com a gente, use o Fale conosco no jogo ou escreva para ' + (msg.emailContato || 'contato@oprojeto.online') + '.';
  }

  async function responder(x, texto, aoMandar) {
    const resposta = String(texto || '').trim();
    if (resposta.length < 2) { LP.avisar('Escreva a resposta antes de mandar.', 'erro'); return; }
    let resultado = null;
    const r = await LP.dialogo({
      titulo: 'Mandar a resposta por e-mail',
      largo: true,
      botao: 'Mandar resposta',
      gerundio: 'Mandando…',
      texto: [h('p', null, 'Vai para ', h('b', { class: 'mono' }, LP.mascarar(x.email)), x.usuario ? ' (o e-mail da conta de ' + x.usuario.apelido + ')' : ' (o e-mail que a pessoa deixou)',
        '. A mensagem fica como respondida e o registro anota só que houve resposta, nunca o texto.')],
      corpo: h('div', null, h('span', { class: 'rotulo' }, 'Prévia do e-mail · assunto: LENDA: resposta à sua mensagem (protocolo ' + x.protocolo + ')'),
        h('pre', { class: 'previa-email' }, previaEmail(x, resposta))),
      executar: async () => { resultado = await LP.adminPost({ acao: 'suporte_responder', id: x.id, resposta: resposta }); return resultado; },
    });
    if (!r || !resultado) return;
    if (resultado.enviado) {
      LP.avisar('Resposta mandada para ' + (resultado.para || LP.mascarar(x.email)) + ' (aceita pelo servidor de e-mail; pode cair no spam). A mensagem ficou como respondida.');
      rascunhos.delete(x.id);
      if (aoMandar) aoMandar();
    } else {
      LP.avisar('O e-mail não saiu para ' + (resultado.para || LP.mascarar(x.email)) + '. A resposta ficou guardada aqui: tente de novo mais tarde (veja Registro → E-mails).', 'erro');
    }
    LP.marcarFeitos('mensagem', [x.id]);
    depoisNaFicha();
  }

  function desenharFicha(x) {
    const corpo = fm.corpo;
    if (!corpo || !corpo.isConnected) return;
    LP.gaveta.titulo('Mensagem ' + x.protocolo);
    const podeMexer = LP.pode('usuarios');
    // ── topo: assunto, situação, quem mandou ──
    const copiarEmail = x.email ? LP.botao('', (ev, b) => LP.copiar(x.email, b), { tipo: 'fantasma', pequeno: true, icone: 'copiar', rotulo: 'Copiar o e-mail', title: 'Copiar o e-mail (inteiro)' }) : null;
    const topo = h('section', { class: 'cartao' },
      h('div', { class: 'perfil-nome' }, h('h2', null, LP.NOMES_TIPO_SUPORTE[x.tipo] || x.tipo), LP.chipStatusSuporte(x.status), h('span', { class: 'mono texto-3' }, x.protocolo)),
      h('dl', { class: 'perfil-dados' },
        LP.dado('De', x.usuario ? LP.linkUsuario(x.usuario) : h('span', { class: 'texto-3' }, x.comConta ? 'conta excluída' : 'sem conta (não estava logado)')),
        LP.dado('E-mail', x.email ? h('span', { class: 'chips' }, LP.email(x.email), copiarEmail) : '—', { largo: true }),
        LP.dado('Recebida', h('span', { title: LP.dataHoraAno(x.criadoEm) + ' (Brasília)' }, LP.dataHoraAno(x.criadoEm) + ' · ' + LP.relativo(x.criadoEm))),
        LP.dado('Tela do jogo', x.pagina ? h('span', { class: 'mono' }, x.pagina) : '—'),
        LP.dado('Protocolo', h('span', { class: 'chips' }, h('span', { class: 'mono' }, x.protocolo), LP.botao('', (ev, b) => LP.copiar(x.protocolo, b), { tipo: 'fantasma', pequeno: true, icone: 'copiar', rotulo: 'Copiar o protocolo', title: 'Copiar o protocolo' }))),
        LP.dado('Mexida por último', x.atualizadaEm ? LP.relativo(x.atualizadaEm) + (x.quem && x.quem.nome ? ' · ' + x.quem.nome : '') : '—')),
      fm.lidaAoAbrir ? h('p', { class: 'faixa faixa-info' }, 'Era nova: ficou como lida ao abrir. ',
        LP.botao('Voltar para nova', (ev, b) => mudarStatus(x, 'nova', b), { tipo: 'fantasma', pequeno: true, gerundio: 'Voltando…' })) : null);
    // ── o texto ──
    const texto = h('section', { class: 'cartao ficha-msg' }, h('h3', null, 'Mensagem'), h('p', { class: 'msg-texto' }, x.mensagem || ''));
    // ── resposta já mandada (ou guardada) ──
    // resposta guardada sem respondidaEm = o e-mail não saiu (o servidor guarda o texto para tentar de novo)
    const naoSaiu = !!x.resposta && !x.respondidaEm;
    const anterior = x.resposta ? h('section', { class: 'cartao ficha-msg msg-resposta' },
      h('h3', null, naoSaiu ? 'Resposta guardada (o e-mail não saiu)' : 'Resposta da equipe'),
      naoSaiu ? h('p', { class: 'faixa faixa-alerta' }, 'O servidor não conseguiu mandar o e-mail desta resposta. Ela está no campo abaixo: confira e mande de novo.') : null,
      h('p', { class: 'msg-texto' }, x.resposta),
      x.respondidaEm ? h('p', { class: 'texto-3' }, 'Mandada ' + LP.dataHoraAno(x.respondidaEm) + (x.quem && x.quem.nome ? ' por ' + x.quem.nome : '')) : null) : null;
    // ── responder ──
    let cResponder = null;
    if (podeMexer && x.email) {
      const txt = h('textarea', { rows: 7, maxlength: RESPOSTA_MAX, 'aria-label': 'Resposta', placeholder: 'Escreva a resposta. O e-mail já sai com "Olá", a assinatura da equipe e a mensagem original embaixo.' });
      txt.value = rascunhos.has(x.id) ? rascunhos.get(x.id) : naoSaiu ? x.resposta : '';
      const cont = h('span', { class: 'texto-3' });
      const atualizar = () => { cont.textContent = txt.value.length + '/' + LP.inteiro(RESPOSTA_MAX); rascunhos.set(x.id, txt.value); };
      txt.addEventListener('input', atualizar);
      atualizar();
      const prontas = h('div', { class: 'motivos-rapidos', role: 'group', 'aria-label': 'Respostas prontas' }, PRONTAS.map((p) => h('button', {
        type: 'button', class: 'chip-motivo', title: p.texto,
        onclick: () => { txt.value = (txt.value.trim() ? txt.value.replace(/\s+$/, '') + '\n\n' : '') + p.texto; txt.dispatchEvent(new Event('input')); txt.focus(); },
      }, p.rotulo)));
      const mandar = LP.botao(x.status === 'respondida' ? 'Mandar outra resposta' : 'Responder por e-mail', () => responder(x, txt.value, () => { txt.value = ''; }), { tipo: 'ouro', icone: 'responder' });
      cResponder = h('section', { class: 'cartao ficha-msg' }, h('h3', null, x.status === 'respondida' ? 'Responder de novo' : 'Responder'),
        prontas, txt, h('div', { class: 'msg-rodape' }, cont, mandar),
        h('p', { class: 'ajuda' }, 'Vai para ' + LP.mascarar(x.email) + '. Não peça senha nem documento por e-mail.'));
    } else if (!x.email) {
      cResponder = h('p', { class: 'faixa faixa-alerta' }, 'Esta mensagem não tem e-mail para responder.');
    }
    // ── situação ──
    const acoes = [];
    if (podeMexer) {
      if (x.status === 'nova') acoes.push(LP.botao('Marcar como lida', (ev, b) => mudarStatus(x, 'lida', b), { tipo: 'fantasma', icone: 'check', gerundio: 'Marcando…' }));
      if (x.status !== 'nova' && !fm.lidaAoAbrir) acoes.push(LP.botao('Voltar para nova', (ev, b) => mudarStatus(x, 'nova', b), { tipo: 'fantasma', icone: 'restaurar', gerundio: 'Voltando…', title: 'Volta para a fila das novas (para alguém responder depois)' }));
      if (x.status !== 'arquivada') acoes.push(LP.botao('Arquivar', (ev, b) => mudarStatus(x, 'arquivada', b), { tipo: 'fantasma', icone: 'arquivar', gerundio: 'Arquivando…', title: 'Sai das listas de novas e lidas (continua em Arquivadas)' }));
      else acoes.push(LP.botao('Desarquivar', (ev, b) => mudarStatus(x, x.resposta && x.respondidaEm ? 'respondida' : 'lida', b), { tipo: 'fantasma', icone: 'restaurar', gerundio: 'Desarquivando…' }));
    }
    acoes.push(h('a', { href: LP.hash('registro', { alvo: 'suporte:' + x.id }), class: 'botao-fantasma', title: 'O que a equipe fez nesta mensagem' }, LP.icone('arquivo'), h('span', null, 'Ver no Registro')));
    if (x.usuario) acoes.push(LP.botao('Ficha da conta', () => LP.abrirConta(x.usuario.id), { tipo: 'fantasma', icone: 'olho' }));
    const cAcoes = h('section', { class: 'cartao' }, h('div', { class: 'perfil-acoes' }, acoes),
      !podeMexer ? h('p', { class: 'ajuda' }, 'O seu papel só lê as mensagens (responder e mudar a situação pedem o poder Contas).') : null);
    LP.trocar(corpo, topo, texto, anterior, cResponder, cAcoes);
  }
})();
