/* LENDA · painel — Na área agora (P1-4): quem está com o jogo aberto (último batimento há até 60 s), em que tela,
 * jogando ou com a aba aberta (admin.php?r=agora). Atualiza junto com o pulso de 15 s, só com a aba aberta. Nunca IP. */
'use strict';

(function () {
  const LP = window.LP;
  const { h } = LP;

  const VER = [{ valor: '', rotulo: 'Todos' }, { valor: 'conta', rotulo: 'Com conta' }, { valor: 'jogando', rotulo: 'Jogando' }];
  const area = { ver: '', bots: false, corpo: null, filtros: null, chips: null, d: null, noAr: false };

  function montar(raiz, rota) {
    area.ver = VER.some((v) => v.valor === rota.query.ver) ? rota.query.ver : '';
    area.bots = rota.query.bots === '1';
    area.corpo = h('div');
    area.filtros = h('div', { class: 'ferramentas' });
    area.chips = null;
    area.d = null;
    LP.trocar(raiz, LP.ajuda('Conta quem está com a aba do jogo visível (batimento a cada 15 s, some 60 s depois do último). "Jogando" é com uma partida em andamento. As visitas sem conta aparecem só pelo começo do código anônimo da sessão.'),
      area.filtros, area.corpo);
    desenharFiltros();
    LP.trocar(area.corpo, LP.estadoCarregando(5));
    carregar();
  }

  // os chips e a caixa são feitos uma vez e atualizados no lugar a cada pulso (o foco do teclado não se perde)
  function desenharFiltros() {
    const d = area.d || {};
    if (!area.chips) {
      area.chips = h('div');
      const bots = h('input', { type: 'checkbox', checked: area.bots });
      bots.addEventListener('change', () => { area.bots = bots.checked; carregar(); });
      LP.trocar(area.filtros, area.chips, h('label', { class: 'caixa' }, bots, ' incluir robôs/testes'));
    }
    LP.trocarSegmentos(area.chips, 'Mostrar', VER.map((v) => ({ valor: v.valor, rotulo: v.rotulo,
      contador: v.valor === '' ? d.total : v.valor === 'conta' ? d.comConta : d.jogando, tipoContador: v.valor === '' ? 'ok' : '' })), area.ver,
    (v) => { area.ver = v; desenharFiltros(); desenhar(); LP.trocarQuery('area', { ver: area.ver, bots: area.bots ? 1 : '' }); });
  }

  async function carregar() {
    if (area.noAr || !LP.visivel(area.corpo)) return;
    area.noAr = true;
    LP.trocarQuery('area', { ver: area.ver, bots: area.bots ? 1 : '' });
    try {
      area.d = await LP.adminGet('agora', { bots: area.bots ? 1 : '' });
      if (!LP.visivel(area.corpo)) return;
      desenharFiltros();
      desenhar();
    } catch (e) {
      if ((e && e.status === 401) || !LP.visivel(area.corpo)) return;
      if (!area.d) LP.trocar(area.corpo, LP.estadoErro(e, carregar));
    } finally {
      area.noAr = false;
    }
  }

  function desenhar() {
    const d = area.d || { itens: [] };
    LP.tituloAba('Na área agora (' + LP.inteiro(d.total || 0) + ')');
    LP.subAba(LP.plural(d.comConta || 0, 'com conta', 'com conta') + ' · ' + LP.inteiro(d.jogando || 0) + ' jogando · atualizado às ' + LP.hora(d.atualizadoEm || new Date().toISOString(), true));
    let itens = Array.isArray(d.itens) ? d.itens : [];
    if (area.ver === 'conta') itens = itens.filter((x) => x.conta);
    if (area.ver === 'jogando') itens = itens.filter((x) => x.jogando);
    if (!itens.length) {
      LP.trocar(area.corpo, LP.estadoVazio(area.ver ? 'Ninguém com esse filtro agora' : 'Ninguém com o jogo aberto agora.', 'A lista se atualiza sozinha a cada 15 s.'));
      return;
    }
    // a cada pulso: a rolagem e o foco do teclado (pela linha, data-id = sessão) ficam onde estavam
    LP.trocarNoLugar(area.corpo, LP.lista({
      itens: itens,
      chave: (x) => x.sessao,
      aoClicar: (x) => { if (x.conta) LP.abrirConta(x.conta.id); },
      rotuloLinha: (x) => (x.conta ? 'Abrir ' + x.conta.apelido : 'Visitante ' + x.sessao),
      colunas: [
        { rotulo: 'Quem', principal: true, celula: (x) => (x.conta ? h('span', { class: 'chips' }, LP.linkUsuario(x.conta), x.bot ? LP.chip('robô/teste', 'alerta') : null)
          : h('span', { class: 'chips' }, h('span', { class: 'texto-2' }, 'visitante'), h('span', { class: 'mono texto-3' }, x.sessao), x.bot ? LP.chip('robô/teste', 'alerta') : null)) },
        { rotulo: 'Onde', celula: (x) => h('span', { class: 'selo-onde' }, h('span', { title: x.rota || '' }, x.onde || 'Outra tela'), x.modo ? LP.chip(LP.NOMES_MODO[x.modo] || x.modo, 'info', { semPonto: true }) : null) },
        { rotulo: 'Agora', celula: (x) => (x.jogando ? h('span', { class: 'selo-jogando' }, 'jogando') : h('span', { class: 'selo-aberta' }, 'aba aberta')) },
        { rotulo: 'Entrou', celula: (x) => LP.quando(x.entrouEm) },
        { rotulo: 'Tempo ativo', num: true, celula: (x) => LP.duracao(x.tempoS) },
        { rotulo: 'Aparelho', celula: (x) => LP.aparelho(x.aparelho) },
        { rotulo: 'Origem', celula: (x) => LP.origemCurta(x.origem) },
      ],
    }));
  }

  LP.abas.area = {
    titulo: 'Na área agora',
    sub: '',
    montar: montar,
    recarregar: () => carregar(),
    aoPulso: () => carregar(),
  };
})();
