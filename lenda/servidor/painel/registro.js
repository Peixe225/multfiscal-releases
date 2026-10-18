/* LENDA · painel — Registro: as ações da equipe (admin.php?r=log, com filtros por ação, alvo, quem, texto e período, e
 * as ações por dia, A9), o bloco Segurança (equipe.php?r=seguranca, P1-3), os e-mails que o servidor tentou mandar
 * (?r=emails, P1-10) e o que os jogadores fizeram (?r=eventos, A14). */
'use strict';

(function () {
  const LP = window.LP;
  const { h } = LP;

  const PARTES = [['acoes', 'Ações'], ['seguranca', 'Segurança'], ['emails', 'E-mails'], ['jogadores', 'Jogadores']];
  const NOMES_CHAVE = {
    apelido: 'apelido', motivo: 'motivo', dias: 'dias', sessoes: 'sessões', valor: 'valor', bonusId: 'bônus', origem: 'origem', usuario: 'conta',
    jogador: 'jogador', antes: 'antes', denunciasFechadas: 'denúncias fechadas', lote: 'em lote', avisou: 'avisou o autor', lixeiraId: 'lixeira',
    feitos: 'feitos', pulados: 'pulados', operacao: 'operação', resultado: 'resultado', fechadas: 'fechadas', denuncia: 'denúncia',
    carreiras: 'carreiras', de: 'de', para: 'para', tipo: 'tipo', linhas: 'linhas', tamanho: 'tamanho', nivel: 'nível', existia: 'existia',
    enviado: 'enviado', canais: 'canais', sim: 'sim', aparelho: 'aparelho', restam: 'restam', limite: 'limite', admin: 'admin', papel: 'papel',
    email: 'e-mail', encerradas: 'encerradas', conta: 'tipo de conta', copia: 'cópia', arquivo: 'arquivo', modo: 'modo', gravadas: 'gravadas',
    puladas: 'puladas', medicao: 'medição', total: 'total', ms: 'ms', poder: 'poder', acao: 'ação', indicador: 'indicador', bonusTirado: 'bônus tirado',
    recusadas: 'recusadas', bonusTirados: 'bônus tirados', ativo: 'ativo', nome: 'nome', sorteada: 'senha sorteada',
    // v3.3: desafios e Fale conosco
    slug: 'desafio', novo: 'novo', campos: 'campos', candidatosNovos: 'candidatos novos', candidato: 'candidato', carreira: 'carreira',
    ok: 'bateu', status: 'situação',
  };
  const ACOES_SEGURANCA = ['painel_falha', 'painel_limite', 'painel_pin_errado', 'painel_pin_travado', 'negado', 'minha_senha_falha', 'painel_entrar',
    'painel_sair', 'minha_senha', 'sair_todos', 'pin_definido', 'senha_trocada', 'sessao_encerrar', 'criar_conta', 'etapa_expirou'];
  const reg = { parte: 'acoes', f: {}, pagina: 1, corpo: null, topo: null, temDados: false };

  function montar(raiz, rota) {
    const q = rota.query;
    reg.parte = PARTES.some((p) => p[0] === q.parte) ? q.parte : 'acoes';
    reg.f = {};
    ['acao', 'alvo', 'quem', 'q', 'de', 'ate', 'email', 'tipo', 'dias'].forEach((k) => { if (q[k]) reg.f[k] = String(q[k]).slice(0, 80); });
    reg.pagina = Math.max(1, parseInt(q.pagina, 10) || 1);
    reg.temDados = false;
    reg.mostrarQuem = null;
    reg.topo = h('div');
    reg.corpo = h('div');
    const chips = h('div', { class: 'filtros-chips partes', role: 'group', 'aria-label': 'Partes do registro' }, PARTES.map(([k, t]) => {
      const trancada = k === 'seguranca' && !LP.pode('sistema');
      const b = h('button', { type: 'button', class: 'chip-filtro', 'aria-pressed': String(k === reg.parte), title: trancada ? 'O seu papel não abre o bloco Segurança' : null, disabled: trancada }, t);
      b.addEventListener('click', () => { location.hash = LP.hash('registro', k === 'acoes' ? {} : { parte: k }); });
      return b;
    }));
    LP.trocar(raiz, chips, reg.topo, reg.corpo);
    if (reg.parte === 'acoes') montarAcoes();
    else if (reg.parte === 'seguranca') carregarSeguranca();
    else if (reg.parte === 'emails') montarEmails();
    else montarJogadores();
  }
  function trocarQ() {
    LP.trocarQuery('registro', Object.assign({ parte: reg.parte === 'acoes' ? '' : reg.parte, pagina: reg.pagina > 1 ? reg.pagina : '' }, reg.f));
  }

  // ── valores dos detalhes como "chave: valor" (nunca JSON cru) ──
  function textoValor(v) {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'boolean') return v ? 'sim' : 'não';
    if (Array.isArray(v)) return v.length ? v.map(textoValor).join(', ') : 'nenhum';
    if (typeof v === 'object') {
      const ks = Object.keys(v);
      if (!ks.length) return 'nenhum';
      return ks.map((k) => (NOMES_CHAVE[k] || k) + ' ' + textoValor(v[k])).join(', ');
    }
    const s = String(v);
    return s.length > 160 ? s.slice(0, 157) + '…' : s;
  }
  const NOMES_CONFIG = {
    manutencao: 'Manutenção', cadastro_aberto: 'Cadastro aberto', imersivo_publico: 'Imersivo público', live_publica: 'Live pública',
    aviso: 'Aviso no topo', avisos: 'Avisos no jogo', regras: 'Convite de conta', bonus: 'Bônus de OVR', hall_intervalo_min: 'Intervalo do Hall',
    hall_revisao_nota: 'Revisão do Hall', aviso_celular: 'Aviso no celular', hall: 'Hall', partidas_dia_max: 'Partidas por dia',
  };
  function detalhes(x) {
    const d = x.detalhes && typeof x.detalhes === 'object' ? x.detalhes : {};
    const linhas = Object.keys(d).filter((k) => k !== 'via').map((k) => {
      const v = d[k];
      if (x.acao === 'config' && v && typeof v === 'object' && 'para' in v) return h('span', null, h('b', null, (NOMES_CONFIG[k] || k) + ': '), textoValor(v.de) + ' → ' + textoValor(v.para));
      return h('span', null, h('b', null, (x.acao === 'config' ? NOMES_CONFIG[k] || k : NOMES_CHAVE[k] || k) + ': '), textoValor(v));
    });
    return linhas.length ? h('div', { class: 'detalhes-log' }, linhas) : '—';
  }
  function alvo(a) {
    const s = String(a || '');
    let m = /^usuario:(\d+)$/.exec(s);
    if (m) return LP.linkUsuario({ id: Number(m[1]), apelido: 'conta #' + m[1] });
    m = /^carreira:(\d+)$/.exec(s);
    if (m) return LP.linkCarreira(Number(m[1]), 'carreira #' + m[1]);
    m = /^indicacao:(\d+)$/.exec(s);
    if (m) return 'indicação #' + m[1];
    // v3.3: desafio:<id> abre o desafio; suporte:<id> abre a mensagem (por cima das Mensagens); suporte = um lote
    m = /^desafio:(\d+)$/.exec(s);
    if (m) return h('a', { href: '#/desafios?id=' + m[1], class: 'link-discreto' }, 'desafio #' + m[1]);
    m = /^suporte:(\d+)$/.exec(s);
    if (m) return h('a', { href: LP.hash('mensagens', { status: 'todas', mensagem: m[1] }), class: 'link-discreto' }, 'mensagem #' + m[1]);
    if (s === 'suporte') return h('a', { href: '#/mensagens', class: 'link-discreto' }, 'mensagens (lote)');
    m = /^admin:(\d+)$/.exec(s);
    if (m) return h('a', { href: '#/equipe', class: 'link-discreto' }, 'equipe #' + m[1]);
    if (/^alerta:/.test(s)) return h('span', { class: 'texto-3' }, 'alerta');
    return s || '—';
  }
  // o nome é um link que filtra o registro por essa pessoa (ninguém precisa saber o código interno "a1")
  function quem(x) {
    if (!x.quem) return h('span', { class: 'texto-3' }, x.detalhes && x.detalhes.via === 'token' ? 'script' : '—');
    if (!x.quem.codigo) return h('span', { class: 'texto-3' }, 'ninguém (tentativa)');
    const nome = x.quem.codigo === 'token' ? 'script (token)' : x.quem.codigo === 'sistema' ? 'sistema' : x.quem.nome || 'pessoa da equipe';
    if (reg.parte !== 'acoes' || reg.f.quem === x.quem.codigo) return h('span', null, nome);
    const a = h('a', { href: LP.hash('registro', Object.assign({}, reg.f, { quem: x.quem.codigo })), class: 'link-discreto', title: 'Ver só o que ' + nome + ' fez' }, nome);
    a.addEventListener('click', (ev) => { ev.preventDefault(); reg.quemNome = nome; setF('quem', x.quem.codigo); });
    return a;
  }
  /** "Quem": a equipe pelo nome (equipe.php?r=equipe, com o poder Equipe; sem ele, você), script e sistema. */
  function selecaoQuem() {
    const sel = h('select', { 'aria-label': 'Quem' });
    const encher = (pessoas) => {
      LP.limpar(sel);
      sel.appendChild(h('option', { value: '' }, 'Todos'));
      pessoas.forEach((p) => sel.appendChild(h('option', { value: 'a' + p.id }, p.nome)));
      sel.appendChild(h('option', { value: 'token' }, 'Script (token)'));
      sel.appendChild(h('option', { value: 'sistema' }, 'Sistema'));
      if (reg.f.quem && !Array.from(sel.options).some((o) => o.value === reg.f.quem)) sel.appendChild(h('option', { value: reg.f.quem }, reg.quemNome || 'Pessoa da equipe'));
      sel.value = reg.f.quem || '';
    };
    const eu = LP.sessao && LP.sessao.quem && LP.sessao.quem.id ? [{ id: LP.sessao.quem.id, nome: (LP.sessao.quem.nome || 'Você') + ' (você)' }] : [];
    encher(eu);
    if (LP.pode('equipe')) {
      LP.equipeGet('equipe').then((d) => {
        if (!sel.isConnected) return;
        const gente = (Array.isArray(d.itens) ? d.itens : []).map((p) => ({ id: p.id, nome: (p.daConfig ? 'Dono (senha do arquivo)' : p.nome) + (p.eu ? ' (você)' : '') }));
        if (gente.length) encher(gente);
      }).catch(() => {});
    }
    sel.addEventListener('change', () => { reg.quemNome = sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : ''; setF('quem', sel.value); });
    // o link no nome de uma linha também filtra: o seletor mostra a mesma pessoa
    reg.mostrarQuem = () => {
      if (reg.f.quem && !Array.from(sel.options).some((o) => o.value === reg.f.quem)) sel.appendChild(h('option', { value: reg.f.quem }, reg.quemNome || 'Pessoa da equipe'));
      sel.value = reg.f.quem || '';
    };
    return h('label', { class: 'rotulo-inline' }, h('span', null, 'Quem'), sel);
  }
  function colunasLog() {
    return [
      { rotulo: 'Quando', principal: true, celula: (x) => h('span', { title: LP.dataHoraAno(x.em) + ' (Brasília)' }, LP.dataHora(x.em)) },
      { rotulo: 'O quê', celula: (x) => (x.grave ? LP.chip(LP.NOMES_ACAO_LOG[x.acao] || x.acao, 'perigo', { semPonto: true, title: x.acao }) : h('b', { title: x.acao }, LP.NOMES_ACAO_LOG[x.acao] || x.acao)) },
      { rotulo: 'Quem', celula: quem },
      { rotulo: 'Alvo', celula: (x) => alvo(x.alvo) },
      { rotulo: 'Aparelho do dia', celula: (x) => (x.ipDia ? h('span', { class: 'mono texto-3', title: 'Código do aparelho só deste dia (não é o IP)' }, x.ipDia) : '—') },
      { rotulo: 'Detalhe', classe: 'quebra', celula: detalhes },
    ];
  }

  // ═══ ações ═══
  function montarAcoes() {
    const sel = h('select', { 'aria-label': 'Ação' });
    sel.appendChild(h('option', { value: '' }, 'Todas as ações'));
    Object.keys(LP.NOMES_ACAO_LOG).sort((a, b) => LP.NOMES_ACAO_LOG[a].localeCompare(LP.NOMES_ACAO_LOG[b])).forEach((k) => sel.appendChild(h('option', { value: k, selected: reg.f.acao === k }, LP.NOMES_ACAO_LOG[k])));
    if (reg.f.acao && !LP.NOMES_ACAO_LOG[reg.f.acao]) sel.appendChild(h('option', { value: reg.f.acao, selected: true }, reg.f.acao));
    sel.addEventListener('change', () => { setF('acao', sel.value); });
    const campo = (k, ph, rot, tipo) => {
      const i = h('input', { type: tipo || 'search', placeholder: ph, 'aria-label': rot, maxlength: 80, autocomplete: 'off', spellcheck: 'false' });
      i.value = reg.f[k] || '';
      const aplicar = LP.debounce(() => setF(k, i.value.trim()), 350);
      i.addEventListener(tipo === 'date' ? 'change' : 'input', aplicar);
      return h('label', { class: 'rotulo-inline' }, h('span', null, rot), i);
    };
    const graf = h('div', { class: 'grafico grafico-baixo' });
    LP.trocar(reg.topo,
      h('section', { class: 'cartao espaco-baixo' }, h('div', { class: 'cartao-cabeca' }, h('h2', null, 'Ações da equipe por dia ', h('span', { class: 'texto-3' }, 'últimos 14 dias, sem entrar/sair do painel'))), graf),
      h('div', { class: 'ferramentas' }, h('label', { class: 'rotulo-inline' }, h('span', null, 'Ação'), sel),
        campo('alvo', 'usuario:12, carreira:55…', 'Alvo'), selecaoQuem(), campo('q', 'texto nos detalhes', 'Texto'),
        campo('de', '', 'De', 'date'), campo('ate', '', 'Até', 'date'),
        Object.keys(reg.f).length ? LP.botao('Limpar filtros', () => { location.hash = '#/registro'; }, { tipo: 'fantasma', pequeno: true }) : null));
    reg.graf = graf;
    carregarAcoes(true);
  }
  function setF(k, v) {
    if (v) reg.f[k] = v; else delete reg.f[k];
    if (k === 'quem' && reg.mostrarQuem) reg.mostrarQuem();
    reg.pagina = 1;
    carregarAcoes(false);
  }
  async function carregarAcoes(comGrafico) {
    if (!LP.visivel(reg.corpo)) return;
    trocarQ();
    if (!reg.temDados) LP.trocar(reg.corpo, LP.estadoCarregando(6)); else reg.corpo.classList.add('esmaecido');
    try {
      const d = await LP.adminGet('log', Object.assign({ pagina: reg.pagina, porDia: comGrafico ? 14 : '' }, reg.f), { sinal: LP.unico('log') });
      if (!LP.visivel(reg.corpo)) return;
      reg.temDados = true;
      reg.corpo.classList.remove('esmaecido');
      if (comGrafico && Array.isArray(d.porDia) && reg.graf) LP.graficoColunas(reg.graf, d.porDia, [{ chave: 'n', nome: 'ações', classe: 'serie-1' }], { rotulo: 'Ações da equipe por dia' });
      const itens = Array.isArray(d.itens) ? d.itens : [];
      const filtrado = Object.keys(reg.f).length > 0;
      LP.subAba(LP.plural(d.total || 0, 'linha no registro', 'linhas no registro') + (filtrado ? ' com esse filtro' : ''));
      if (!itens.length) {
        LP.trocar(reg.corpo, LP.estadoVazio(filtrado ? 'Nada com esse filtro' : 'Nenhuma ação ainda', 'Tudo o que a equipe muda pelo painel (ou por script) fica anotado aqui, com quem e quando.',
          filtrado ? LP.botao('Limpar filtros', () => { location.hash = '#/registro'; }, { tipo: 'fantasma' }) : null));
        return;
      }
      LP.trocar(reg.corpo, LP.lista({ itens: itens, classeLinha: (x) => (x.grave ? 'linha-grave' : null), colunas: colunasLog() }),
        LP.paginacao(d.total || 0, d.pagina || reg.pagina, d.porPagina || 50, (p) => { reg.pagina = p; carregarAcoes(false); window.scrollTo(0, 0); }));
    } catch (e) {
      if (LP.cancelado(e)) return;
      reg.corpo.classList.remove('esmaecido');
      if ((e && e.status === 401) || !LP.visivel(reg.corpo)) return;
      reg.temDados = false;
      LP.trocar(reg.corpo, LP.estadoErro(e, () => carregarAcoes(true)));
    }
  }

  // ═══ segurança (P1-3) ═══
  async function carregarSeguranca() {
    if (!LP.visivel(reg.corpo)) return;
    trocarQ();
    if (!reg.temDados) LP.trocar(reg.corpo, LP.estadoCarregando(6)); else reg.corpo.classList.add('esmaecido');
    try {
      const d = await LP.equipeGet('seguranca', { pagina: reg.pagina, acao: reg.f.acao }, { sinal: LP.unico('seguranca') });
      if (!LP.visivel(reg.corpo)) return;
      reg.temDados = true;
      reg.corpo.classList.remove('esmaecido');
      const r = d.resumo || {};
      const L = LP.ladrilho;
      const sel = h('select', { 'aria-label': 'Filtrar por tipo' });
      sel.appendChild(h('option', { value: '' }, 'Tudo de acesso'));
      ACOES_SEGURANCA.forEach((k) => sel.appendChild(h('option', { value: k, selected: reg.f.acao === k }, LP.NOMES_ACAO_LOG[k] || k)));
      sel.addEventListener('change', () => { if (sel.value) reg.f.acao = sel.value; else delete reg.f.acao; reg.pagina = 1; carregarSeguranca(); });
      LP.trocar(reg.topo,
        h('div', { class: 'ladrilhos espaco-baixo' },
          L('Senhas erradas em 24 h', LP.inteiro(r.falhas24h), 'no painel', { classe: r.falhas24h ? 'ladrilho-alerta' : 'ladrilho-ok' }),
          L('Bloqueios em 24 h', LP.inteiro(r.limites24h), 'limite de tentativas', { classe: r.limites24h ? 'ladrilho-perigo' : 'ladrilho-ok' }),
          L('Negados em 24 h', LP.inteiro(r.negados24h), 'papel sem o poder', { classe: r.negados24h ? 'ladrilho-alerta' : 'ladrilho-ok' }),
          L('Sessões abertas', LP.inteiro(r.sessoesAtivas), LP.plural(r.tentativasAgora || 0, 'tentativa', 'tentativas') + ' nos últimos 10 min')),
        h('div', { class: 'ferramentas' }, h('label', { class: 'rotulo-inline' }, h('span', null, 'Tipo'), sel)));
      const itens = Array.isArray(d.itens) ? d.itens : [];
      LP.subAba('Entradas, falhas, bloqueios, saídas e negados no painel · o IP nunca é guardado');
      if (!itens.length) { LP.trocar(reg.corpo, LP.estadoVazio('Nada registrado. É o que se espera.', '')); return; }
      LP.trocar(reg.corpo, LP.lista({ itens: itens, colunas: colunasLog() }),
        LP.paginacao(d.total || 0, d.pagina || reg.pagina, d.porPagina || 50, (p) => { reg.pagina = p; carregarSeguranca(); window.scrollTo(0, 0); }));
    } catch (e) {
      if (LP.cancelado(e)) return;
      reg.corpo.classList.remove('esmaecido');
      if ((e && e.status === 401) || !LP.visivel(reg.corpo)) return;
      reg.temDados = false;
      LP.trocar(reg.corpo, LP.estadoErro(e, carregarSeguranca));
    }
  }

  // ═══ e-mails (P1-10) ═══
  function montarEmails() {
    const busca = LP.busca('E-mail exato (o endereço não é guardado de novo: a busca é pelo código dele)', reg.f.email || '', (v) => {
      if (v) reg.f.email = v; else delete reg.f.email;
      reg.pagina = 1;
      carregarEmails();
    }, { min: 5, maxlength: 190 });
    reg.buscaEmail = busca;
    LP.trocar(reg.topo, h('div', { class: 'resumo-emails' }), h('div', { class: 'ferramentas' }, busca));
    carregarEmails();
  }
  async function carregarEmails() {
    if (!LP.visivel(reg.corpo)) return;
    trocarQ();
    if (!reg.temDados) LP.trocar(reg.corpo, LP.estadoCarregando(6)); else reg.corpo.classList.add('esmaecido');
    try {
      const d = await LP.adminGet('emails', { email: reg.f.email, pagina: reg.pagina }, { sinal: LP.unico('emails') });
      if (!LP.visivel(reg.corpo)) return;
      reg.temDados = true;
      reg.corpo.classList.remove('esmaecido');
      const r = d.resumo || {};
      const L = LP.ladrilho;
      const caixa = reg.topo.querySelector('.resumo-emails');
      LP.trocar(caixa,
        h('div', { class: 'ladrilhos espaco-baixo' },
          L('Envios em 24 h', LP.inteiro(r.envios24h), 'tentativas do servidor'),
          L('Falharam', LP.inteiro(r.falhas24h), 'nas últimas 24 h', { classe: r.falhas24h ? 'ladrilho-perigo' : 'ladrilho-ok' }),
          L('Modo de envio', r.via === 'arquivo' ? 'arquivo' : r.via === 'smtp' ? 'SMTP' : 'mail()', r.via === 'arquivo' ? 'teste: grava em pasta, não manda' : r.via === 'smtp' ? 'a caixa de e-mail, com senha e TLS' : 'o PHP da hospedagem'),
          L('Último aceito', r.ultimoOkEm ? LP.relativo(r.ultimoOkEm) : '—', r.ultimoOkEm ? LP.dataHoraAno(r.ultimoOkEm) : 'nenhum ainda')),
        r.via === 'mail' ? h('p', { class: 'faixa faixa-alerta' }, 'O envio é pelo mail() da hospedagem: "aceito" quer dizer que o servidor recebeu, não que chegou. Pode cair no spam; o SMTP da caixa da Hostinger resolve (LEIAME §2).') : null);
      const itens = Array.isArray(d.itens) ? d.itens : [];
      LP.subAba('O que o servidor tentou mandar (guardado por 90 dias, com o endereço mascarado)');
      if (reg.buscaEmail) reg.buscaEmail.estado(reg.f.email ? LP.plural(d.total || 0, 'encontrado', 'encontrados') : '');
      if (!itens.length) { LP.trocar(reg.corpo, LP.estadoVazio(reg.f.email ? 'Nenhum envio para esse e-mail' : 'Nenhum e-mail ainda', 'Os códigos de troca de senha, as confirmações de e-mail e as respostas do Fale conosco aparecem aqui.')); return; }
      const TIPOS = { esqueci: 'Esqueci a senha', admin_redef: 'Código mandado pela equipe', verificacao: 'Confirmação do e-mail', admin_verif: 'Confirmação mandada pela equipe', suporte: 'Resposta do Fale conosco', outro: 'Outro' };
      LP.trocar(reg.corpo, LP.lista({
        itens: itens,
        colunas: [
          { rotulo: 'Quando', principal: true, celula: (x) => h('span', { title: LP.dataHoraAno(x.em) }, LP.dataHora(x.em)) },
          { rotulo: 'Para', celula: (x) => h('span', { class: 'mono' }, x.para) },
          { rotulo: 'Tipo', celula: (x) => TIPOS[x.tipo] || x.tipo },
          { rotulo: 'Como saiu', celula: (x) => (x.via === 'arquivo' ? 'arquivo (teste)' : x.via === 'smtp' ? 'SMTP da caixa' : 'mail()') },
          { rotulo: 'Resultado', classe: 'quebra', celula: (x) => (x.ok ? LP.chip(x.via === 'smtp' ? 'aceito pela caixa' : 'aceito pelo servidor', 'ok') : h('span', { class: 'chips' }, LP.chip('falhou', 'perigo'), x.detalhe ? h('span', { class: 'texto-3' }, x.detalhe) : null)) },
        ],
      }), LP.paginacao(d.total || 0, d.pagina || reg.pagina, d.porPagina || 50, (p) => { reg.pagina = p; carregarEmails(); window.scrollTo(0, 0); }));
    } catch (e) {
      if (LP.cancelado(e)) return;
      reg.corpo.classList.remove('esmaecido');
      if ((e && e.status === 401) || !LP.visivel(reg.corpo)) return;
      reg.temDados = false;
      LP.trocar(reg.corpo, LP.estadoErro(e, carregarEmails));
    }
  }

  // ═══ jogadores (A14) ═══
  const TIPOS_FEED = [['', 'Tudo'], ['cadastro', 'Cadastros'], ['login', 'Logins'], ['jogo_fim', 'Fins de jogo'], ['compartilhar', 'Compartilhamentos']];
  function montarJogadores() {
    const desenhar = () => LP.trocar(reg.topo, h('div', { class: 'ferramentas' },
      LP.segmentos('Tipo', TIPOS_FEED.map(([v, r]) => ({ valor: v, rotulo: r })), reg.f.tipo || '', (v) => { if (v) reg.f.tipo = v; else delete reg.f.tipo; reg.pagina = 1; desenhar(); carregarJogadores(); }),
      LP.selecao('Período', [{ valor: '1', rotulo: 'Último dia' }, { valor: '7', rotulo: '7 dias' }, { valor: '30', rotulo: '30 dias' }, { valor: '90', rotulo: '90 dias' }], reg.f.dias || '30',
        (v) => { reg.f.dias = v; reg.pagina = 1; carregarJogadores(); })));
    desenhar();
    carregarJogadores();
  }
  async function carregarJogadores() {
    if (!LP.visivel(reg.corpo)) return;
    trocarQ();
    if (!reg.temDados) LP.trocar(reg.corpo, LP.estadoCarregando(6)); else reg.corpo.classList.add('esmaecido');
    try {
      const d = await LP.adminGet('eventos', { tipo: reg.f.tipo, dias: reg.f.dias, pagina: reg.pagina }, { sinal: LP.unico('eventos') });
      if (!LP.visivel(reg.corpo)) return;
      reg.temDados = true;
      reg.corpo.classList.remove('esmaecido');
      const itens = Array.isArray(d.itens) ? d.itens : [];
      LP.subAba(LP.plural(d.total || 0, 'evento', 'eventos') + ' dos jogadores nos últimos ' + LP.plural(d.dias || 30, 'dia', 'dias'));
      if (!itens.length) { LP.trocar(reg.corpo, LP.estadoVazio('Nada neste período', 'Cadastros, logins, fins de jogo e compartilhamentos aparecem aqui.')); return; }
      LP.trocar(reg.corpo, LP.lista({
        itens: itens,
        colunas: [
          { rotulo: 'Quando', principal: true, celula: (x) => h('span', { title: LP.dataHoraAno(x.em) }, LP.dataHora(x.em)) },
          { rotulo: 'Quem', celula: (x) => (x.conta ? LP.linkUsuario(x.conta) : h('span', { class: 'texto-3' }, 'visitante ', h('span', { class: 'mono' }, x.aparelho || ''))) },
          { rotulo: 'Evento', celula: (x) => LP.NOMES_EVENTO[x.tipo] || x.tipo },
          { rotulo: 'Modo', celula: (x) => (x.modo ? LP.NOMES_MODO[x.modo] || x.modo : '—') },
          { rotulo: 'Detalhes', classe: 'quebra', celula: (x) => (LP.dadosEvento ? LP.dadosEvento(x) : '') },
        ],
      }), LP.paginacao(d.total || 0, d.pagina || reg.pagina, d.porPagina || 50, (p) => { reg.pagina = p; carregarJogadores(); window.scrollTo(0, 0); }));
    } catch (e) {
      if (LP.cancelado(e)) return;
      reg.corpo.classList.remove('esmaecido');
      if ((e && e.status === 401) || !LP.visivel(reg.corpo)) return;
      reg.temDados = false;
      LP.trocar(reg.corpo, LP.estadoErro(e, carregarJogadores));
    }
  }

  LP.abas.registro = {
    titulo: 'Registro',
    sub: '',
    montar: montar,
    recarregar: () => {
      if (reg.parte === 'acoes') carregarAcoes(true);
      else if (reg.parte === 'seguranca') carregarSeguranca();
      else if (reg.parte === 'emails') carregarEmails();
      else carregarJogadores();
    },
  };
})();
