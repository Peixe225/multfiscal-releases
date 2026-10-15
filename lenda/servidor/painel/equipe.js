/* LENDA · painel — Equipe (equipe.php, poder "equipe"): pessoas (criar, papel, ativar, zerar PIN, senha provisória
 * mostrada uma vez, excluir), papéis de fábrica e personalizados, as sessões abertas de todo mundo e os recados
 * internos. O servidor confere a hierarquia (ninguém mexe em quem está no mesmo nível ou acima). */
'use strict';

(function () {
  const LP = window.LP;
  const { h } = LP;

  const PARTES = [['pessoas', 'Pessoas'], ['papeis', 'Papéis'], ['sessoes', 'Sessões'], ['recados', 'Recados']];
  const eq = { parte: 'pessoas', corpo: null, papeis: null, pessoas: null };

  function montar(raiz, rota) {
    eq.parte = PARTES.some((p) => p[0] === rota.query.parte) ? rota.query.parte : 'pessoas';
    eq.corpo = h('div');
    const chips = h('div', { class: 'filtros-chips partes', role: 'group', 'aria-label': 'Partes da equipe' }, PARTES.map(([k, t]) => {
      const b = h('button', { type: 'button', class: 'chip-filtro', 'aria-pressed': String(k === eq.parte) }, t);
      b.addEventListener('click', () => { location.hash = LP.hash('equipe', k === 'pessoas' ? {} : { parte: k }); });
      return b;
    }));
    LP.trocar(raiz, chips, eq.corpo);
    carregar();
  }
  function carregar() {
    LP.trocar(eq.corpo, LP.estadoCarregando(5));
    if (eq.parte === 'papeis') return carregarPapeis();
    if (eq.parte === 'sessoes') return carregarSessoes();
    if (eq.parte === 'recados') return carregarRecados();
    return carregarPessoas();
  }
  async function papeis() {
    if (!eq.papeis) eq.papeis = await LP.equipeGet('papeis');
    return eq.papeis;
  }

  /** Caixa da senha provisória: aparece uma vez, com "Copiar". */
  function caixaSenha(nome, senha) {
    const b = LP.botao('Copiar senha', (ev, bt) => LP.copiar(senha, bt), { tipo: 'ouro', pequeno: true, icone: 'copiar' });
    return h('div', { class: 'caixa-segredo', role: 'status' },
      h('p', { class: 'aviso-segredo' }, 'Senha provisória de ' + nome + ' · vale uma entrada'),
      h('code', null, senha), h('div', { class: 'botoes' }, b),
      h('p', { class: 'aviso-segredo' }, '⚠ Anote ou mande agora. Fechando ou recarregando, ela some e não fica guardada em lugar nenhum.'),
      h('p', { class: 'texto-3' }, 'Na primeira entrada a pessoa troca por uma senha dela e cria o PIN de 6 dígitos.'));
  }
  async function mostrarSenha(nome, senha) {
    await LP.dialogo({ titulo: 'Senha provisória', soFechar: true, corpo: caixaSenha(nome, senha) });
  }

  // ═══ pessoas ═══
  async function carregarPessoas() {
    try {
      const [d, p] = await Promise.all([LP.equipeGet('equipe'), papeis()]);
      if (!LP.visivel(eq.corpo)) return;
      eq.pessoas = d;
      desenharPessoas(d, p);
    } catch (e) {
      if ((e && e.status === 401) || !LP.visivel(eq.corpo)) return;
      LP.trocar(eq.corpo, LP.estadoErro(e, carregarPessoas));
    }
  }
  function opcoesPapel(p, so) {
    const todos = [].concat(p.fabrica || [], p.personalizados || []);
    return todos.filter((x) => !so || x.possoDar).map((x) => ({ valor: x.chave, rotulo: x.nome + (x.fabrica ? '' : ' (personalizado)') }));
  }
  function desenharPessoas(d, p) {
    const itens = Array.isArray(d.itens) ? d.itens : [];
    LP.subAba(LP.plural(itens.length, 'pessoa', 'pessoas') + ' · ' + LP.plural(d.donosAtivos || 0, 'dono ativo', 'donos ativos') + ' · modo de entrada: ' + (d.modo === 'contas' ? 'contas pessoais' : 'só a senha do arquivo'));
    const criar = LP.botao('Pôr alguém na equipe', () => criarPessoa(p), { tipo: 'ouro', icone: 'mais' });
    LP.acoesAba(criar);
    LP.trocar(eq.corpo, LP.ajuda('Cada pessoa entra com o próprio e-mail, a própria senha e um PIN. O papel decide o que ela vê e faz (o servidor confere em toda ação). Ninguém mexe em quem está no mesmo nível ou acima; o último dono ativo não sai.'),
      LP.lista({
        itens: itens,
        rotuloLinha: (x) => x.nome,
        colunas: [
          { rotulo: 'Pessoa', principal: true, celula: (x) => h('div', { class: 'celula-dupla' },
            h('span', { class: 'com-chips' }, x.nome, x.eu ? LP.chip('você', 'ouro', { semPonto: true }) : null, x.daConfig ? LP.chip('senha do arquivo', '', { semPonto: true, title: 'A conta Dono de emergência (entra com a senha do arquivo de config)' }) : null),
            h('span', { class: 'linha-email' }, x.email ? LP.email(x.email) : 'sem e-mail')) },
          { rotulo: 'Papel', celula: (x) => LP.chip(x.papelNome || x.papel, x.papel === 'dono' ? 'ouro' : 'info', { semPonto: true }) },
          { rotulo: 'Situação', celula: (x) => h('span', { class: 'chips' }, x.ativo ? LP.chip('Ativa', 'ok') : LP.chip('Desativada', 'perigo'),
            x.online ? LP.chip('no painel agora', 'ok', { semPonto: true }) : null, x.trocarSenha ? LP.chip('senha provisória', 'alerta', { semPonto: true }) : null) },
          { rotulo: 'Último acesso', celula: (x) => h('span', null, x.ultimoAcesso ? LP.quando(x.ultimoAcesso) : 'nunca', h('span', { class: 'texto-3' }, x.temPin ? ' · com PIN' : ' · sem PIN')) },
          { rotulo: 'Criada', celula: (x) => LP.quando(x.criadoEm) },
          { rotulo: 'Ações', acoes: true, classe: 'acoes-quebram', celula: (x) => (x.podeMexer ? acoesPessoa(x, p) : null) },
        ],
      }));
  }
  function acoesPessoa(x, p) {
    // rev3 (§E.7): reativar, zerar o PIN e a senha provisória dão acesso à conta da pessoa: pedem também todos os
    // poderes dela (podeAssumir; servidor antigo, sem o campo = pode). O servidor recusa com 403 hierarquia de todo jeito.
    const assume = x.podeAssumir !== false;
    return [
      LP.botao('Papel', () => mudarPapel(x, p), { tipo: 'fantasma', pequeno: true, icone: 'escudo' }),
      x.ativo || assume ? LP.botao(x.ativo ? 'Desativar' : 'Ativar', () => ativar(x, !x.ativo), { tipo: x.ativo ? 'fantasma' : 'ok', pequeno: true, icone: x.ativo ? 'bloquear' : 'reativar' }) : null,
      x.temPin && assume ? LP.botao('Zerar PIN', () => zerarPin(x), { tipo: 'fantasma', pequeno: true, icone: 'cadeado', gerundio: 'Zerando…', title: 'Esqueceu o PIN: cria outro na próxima entrada' }) : null,
      !x.daConfig && assume ? LP.botao('Senha provisória', () => senhaProvisoria(x), { tipo: 'fantasma', pequeno: true, icone: 'lapis' }) : null,
      !x.daConfig ? LP.botao('Tirar da equipe', () => excluirPessoa(x), { tipo: 'perigo', pequeno: true, icone: 'lixo' }) : null,
    ];
  }
  async function criarPessoa(p) {
    let nome = '';
    const r = await LP.dialogo({
      titulo: 'Pôr alguém na equipe',
      botao: 'Criar acesso',
      gerundio: 'Criando…',
      texto: 'A pessoa entra com este e-mail. Sem senha: o painel sorteia uma provisória (mostrada uma vez) e ela troca no primeiro acesso.',
      campos: [
        { nome: 'nome', rotulo: 'Nome', maxlength: 60, obrigatorio: true, placeholder: 'Ex.: Bia (moderação)' },
        { nome: 'email', rotulo: 'E-mail', tipo: 'email', maxlength: 190, obrigatorio: true },
        { nome: 'papel', rotulo: 'Papel', tipo: 'selecao', valor: 'moderador', opcoes: opcoesPapel(p, true) },
        { nome: 'senha', rotulo: 'Senha (opcional, 12+ caracteres)', tipo: 'senha', maxlength: 256, ajuda: 'Deixe vazio para sortear uma provisória de 14 caracteres.',
          validar: (v) => (v && v.length < 12 ? 'A senha precisa de 12 caracteres ou mais.' : null) },
      ],
      executar: (v) => { nome = v.nome; return LP.equipePost({ acao: 'equipe_criar', nome: v.nome, email: v.email, papel: v.papel, senha: v.senha || undefined }); },
    });
    if (!r) return;
    LP.avisar('Acesso criado para ' + nome + '.');
    if (r.sorteada && r.senha) await mostrarSenha(nome, r.senha);
    carregarPessoas();
  }
  async function mudarPapel(x, p) {
    const r = await LP.dialogo({
      titulo: 'Papel de ' + x.nome,
      botao: 'Mudar papel',
      gerundio: 'Mudando…',
      campos: [{ nome: 'papel', rotulo: 'Papel', tipo: 'selecao', valor: x.papel, opcoes: opcoesPapel(p, true) }],
      executar: (v) => LP.equipePost({ acao: 'equipe_papel', adminId: x.id, papel: v.papel }),
    });
    if (!r) return;
    LP.avisar(x.nome + ' agora tem o papel ' + r.papel + '.');
    carregarPessoas();
  }
  async function ativar(x, sim) {
    const r = await LP.dialogo({
      titulo: (sim ? 'Ativar ' : 'Desativar ') + x.nome + '?',
      perigo: !sim,
      tipoBotao: sim ? 'ok' : 'perigo',
      botao: sim ? 'Ativar' : 'Desativar',
      gerundio: sim ? 'Ativando…' : 'Desativando…',
      texto: sim ? 'A pessoa volta a entrar.' : 'A pessoa sai de todos os aparelhos e não entra mais (a conta fica, para voltar depois).',
      executar: () => LP.equipePost({ acao: 'equipe_ativar', adminId: x.id, ativo: sim }),
    });
    if (!r) return;
    LP.avisar(sim ? x.nome + ' ativada.' : x.nome + ' desativada · ' + LP.plural(r.sessoesEncerradas || 0, 'sessão encerrada', 'sessões encerradas') + '.');
    carregarPessoas();
  }
  async function zerarPin(x) {
    if (!LP.confirmar('Zerar o PIN de ' + x.nome + '? Ela sai dos aparelhos e cria um PIN novo na próxima entrada.')) return;
    try {
      const r = await LP.equipePost({ acao: 'equipe_zerar_pin', adminId: x.id });
      LP.avisar('PIN de ' + x.nome + ' zerado · ' + LP.plural(r.sessoesEncerradas || 0, 'sessão encerrada', 'sessões encerradas') + '.');
      carregarPessoas();
    } catch (e) { LP.avisarErro(e); }
  }
  async function senhaProvisoria(x) {
    const r = await LP.dialogo({
      titulo: 'Senha provisória para ' + x.nome,
      botao: 'Gerar senha',
      gerundio: 'Gerando…',
      texto: 'A senha atual deixa de valer e a pessoa sai dos aparelhos. A nova vale uma entrada: ela troca por uma dela.',
      campos: [{ nome: 'senha', rotulo: 'Senha (opcional, 12+ caracteres)', tipo: 'senha', maxlength: 256, ajuda: 'Vazio: o painel sorteia uma de 14 caracteres.',
        validar: (v) => (v && v.length < 12 ? 'A senha precisa de 12 caracteres ou mais.' : null) }],
      executar: (v) => LP.equipePost({ acao: 'equipe_senha', adminId: x.id, senha: v.senha || undefined }),
    });
    if (!r) return;
    if (r.sorteada && r.senha) await mostrarSenha(x.nome, r.senha);
    else LP.avisar('Senha provisória gravada para ' + x.nome + '.');
    carregarPessoas();
  }
  async function excluirPessoa(x) {
    const r = await LP.dialogo({
      titulo: 'Tirar ' + x.nome + ' da equipe',
      perigo: true,
      botao: 'Tirar da equipe',
      gerundio: 'Tirando…',
      texto: 'A conta do painel some (o registro guarda nome, e-mail mascarado e papel, sem senha). Para só pausar, use "Desativar".',
      digitar: x.nome,
      digitarLivre: true,
      executar: () => LP.equipePost({ acao: 'equipe_excluir', adminId: x.id }),
    });
    if (!r) return;
    LP.avisar(x.nome + ' saiu da equipe.');
    carregarPessoas();
  }

  // ═══ papéis ═══
  async function carregarPapeis() {
    try {
      eq.papeis = null;
      const p = await papeis();
      if (!LP.visivel(eq.corpo)) return;
      desenharPapeis(p);
    } catch (e) {
      if ((e && e.status === 401) || !LP.visivel(eq.corpo)) return;
      LP.trocar(eq.corpo, LP.estadoErro(e, carregarPapeis));
    }
  }
  function desenharPapeis(p) {
    const poderes = Array.isArray(p.poderes) ? p.poderes : [];
    const texto = {};
    poderes.forEach((x) => { texto[x.chave] = x.texto; });
    LP.subAba('Os de fábrica não mudam; os personalizados sempre têm "ver" e ficam abaixo do dono.');
    LP.acoesAba(LP.botao('Novo papel', () => editarPapel(null, poderes), { tipo: 'ouro', icone: 'mais' }));
    const cartao = (x) => h('section', { class: 'cartao' },
      h('div', { class: 'cartao-cabeca' }, h('h2', null, x.nome, ' ', h('span', { class: 'texto-3' }, x.fabrica ? 'de fábrica' : 'personalizado')),
        h('div', { class: 'botoes' }, LP.chip(LP.plural(x.emUso || 0, 'pessoa', 'pessoas'), '', { semPonto: true }),
          !x.fabrica ? LP.botao('Editar', () => editarPapel(x, poderes), { tipo: 'fantasma', pequeno: true, icone: 'lapis' }) : null,
          !x.fabrica ? LP.botao('Apagar', () => apagarPapel(x), { tipo: 'perigo', pequeno: true, icone: 'lixo', gerundio: 'Apagando…', disabled: (x.emUso || 0) > 0, title: x.emUso ? 'Em uso: mude o papel das pessoas antes' : '' }) : null)),
      x.descricao ? h('p', { class: 'texto-2' }, x.descricao) : null,
      h('ul', { class: 'lista-checagem' }, (x.poderes || []).map((k) => h('li', null, h('span', { class: 'sim', 'aria-hidden': 'true' }, '✓'), h('span', null, (LP.NOMES_PODER[k] || k) + ': ', h('span', { class: 'texto-3' }, texto[k] || ''))))));
    LP.trocar(eq.corpo, h('div', { class: 'config-grade' }, [].concat(p.fabrica || [], p.personalizados || []).map(cartao)));
  }
  async function editarPapel(x, poderes) {
    const caixas = poderes.map((pd) => ({ nome: 'p_' + pd.chave, tipo: 'caixa', rotulo: (LP.NOMES_PODER[pd.chave] || pd.chave) + ': ' + pd.texto, valor: x ? (x.poderes || []).includes(pd.chave) : pd.chave === 'ver' }));
    const r = await LP.dialogo({
      titulo: x ? 'Papel ' + x.nome : 'Novo papel',
      botao: 'Salvar papel',
      gerundio: 'Salvando…',
      largo: false,
      campos: [
        { nome: 'chave', rotulo: 'Chave (minúsculas, sem espaço)', valor: x ? x.chave : '', maxlength: 20, obrigatorio: true, placeholder: 'ex.: atendimento',
          validar: (v) => (/^[a-z][a-z0-9_]{2,19}$/.test(v) ? null : 'De 3 a 20: letras minúsculas, números e _ (começa com letra).') },
        { nome: 'nome', rotulo: 'Nome', valor: x ? x.nome : '', maxlength: 40, obrigatorio: true },
        { nome: 'descricao', rotulo: 'Descrição (opcional)', tipo: 'textarea', valor: x ? x.descricao || '' : '', maxlength: 200, linhas: 2 },
      ].concat(caixas),
      executar: (v) => LP.equipePost({ acao: 'papel_salvar', chave: v.chave, nome: v.nome, descricao: v.descricao || undefined,
        poderes: poderes.map((pd) => pd.chave).filter((k) => v['p_' + k]) }),
    });
    if (!r) return;
    LP.avisar('Papel salvo.');
    carregarPapeis();
  }
  async function apagarPapel(x) {
    if (!LP.confirmar('Apagar o papel ' + x.nome + '?')) return;
    try {
      await LP.equipePost({ acao: 'papel_apagar', chave: x.chave });
      LP.avisar('Papel apagado.');
      carregarPapeis();
    } catch (e) { LP.avisarErro(e); }
  }

  // ═══ sessões ═══
  async function carregarSessoes() {
    try {
      const d = await LP.equipeGet('sessoes');
      if (!LP.visivel(eq.corpo)) return;
      const itens = Array.isArray(d.itens) ? d.itens : [];
      LP.subAba(LP.plural(itens.length, 'sessão aberta', 'sessões abertas') + ' no painel · cai com 8 h, ou 2 h sem uso');
      LP.trocar(eq.corpo, itens.length ? LP.lista({
        itens: itens,
        colunas: [
          { rotulo: 'Pessoa', principal: true, celula: (s) => h('span', { class: 'chips' }, h('b', null, (s.admin && s.admin.nome) || '—'), s.atual ? LP.chip('este aparelho', 'ouro', { semPonto: true }) : null) },
          { rotulo: 'Etapa', celula: (s) => (s.etapa === 'pronto' ? LP.etapa('pronto') : LP.chip(LP.etapa(s.etapa), 'alerta', { semPonto: true, title: 'Entrou com a senha e parou neste passo' })) },
          { rotulo: 'Aparelho', celula: (s) => LP.aparelho(s.aparelho) },
          { rotulo: 'Entrou', celula: (s) => LP.quando(s.criadaEm) },
          { rotulo: 'Visto', celula: (s) => LP.quando(s.vistoEm) },
          { rotulo: 'Vence', celula: (s) => LP.quando(s.expiraEm) },
          { rotulo: 'Ações', acoes: true, celula: (s) => LP.botao('Encerrar', async () => {
            if (!LP.confirmar('Encerrar esta sessão de ' + ((s.admin && s.admin.nome) || 'alguém') + '?')) return;
            try {
              const r = await LP.equipePost({ acao: 'sessao_encerrar', sessao: s.id });
              if (r.atual) { LP.aoExpirar(); return; }
              LP.avisar('Sessão encerrada.');
              carregarSessoes();
            } catch (e) { LP.avisarErro(e); }
          }, { tipo: 'fantasma', pequeno: true, icone: 'sair', gerundio: 'Encerrando…' }) },
        ],
      }) : LP.estadoVazio('Nenhuma sessão aberta', ''));
    } catch (e) {
      if ((e && e.status === 401) || !LP.visivel(eq.corpo)) return;
      LP.trocar(eq.corpo, LP.estadoErro(e, carregarSessoes));
    }
  }

  // ═══ recados ═══
  async function carregarRecados() {
    try {
      const [d, pessoas] = await Promise.all([LP.equipeGet('recados'), LP.equipeGet('equipe').catch(() => null)]);
      if (!LP.visivel(eq.corpo)) return;
      const itens = Array.isArray(d.itens) ? d.itens : [];
      const gente = pessoas && Array.isArray(pessoas.itens) ? pessoas.itens.filter((x) => x.ativo) : [];
      LP.subAba(LP.plural(itens.length, 'recado em vigor', 'recados em vigor') + ' · ' + LP.plural(d.naoLidos || 0, 'não lido', 'não lidos') + ' por você');
      LP.acoesAba(LP.botao('Escrever recado', () => escrever(gente), { tipo: 'ouro', icone: 'mais' }));
      LP.trocar(eq.corpo, itens.length ? h('div', { class: 'recados-topo' }, itens.map((x) => h('article', { class: 'recado recado-' + (x.tom || 'nota') },
        h('div', { class: 'recado-cabeca' }, h('b', null, x.titulo), h('span', { class: 'chips' }, x.lido ? LP.chip('lido', '', { semPonto: true }) : LP.chip('não lido', 'ouro', { semPonto: true }), x.fixo ? LP.chip('fixo', 'info', { semPonto: true }) : null)),
        x.texto ? h('p', { class: 'recado-texto' }, x.texto) : null,
        h('p', { class: 'texto-3' }, 'de ' + ((x.por && x.por.nome) || '—') + ' · ' + LP.relativo(x.criadoEm) + ' · para ' + (x.para && x.para.length ? x.para.map((p) => p.nome).join(', ') : 'toda a equipe') + (x.ate ? ' · até ' + LP.dataHora(x.ate) : '')),
        h('div', { class: 'botoes' },
          !x.lido ? LP.botao('Marcar como lido', async () => { try { await LP.equipePost({ acao: 'recado_lido', id: x.id }); carregarRecados(); LP.recarregarRecados(); } catch (e) { LP.avisarErro(e); } }, { tipo: 'fantasma', pequeno: true, icone: 'check', gerundio: 'Marcando…' }) : null,
          x.podeApagar ? LP.botao('Apagar', async () => {
            if (!LP.confirmar('Apagar este recado para todo mundo?')) return;
            try { await LP.equipePost({ acao: 'recado_apagar', id: x.id }); LP.avisar('Recado apagado.'); carregarRecados(); LP.recarregarRecados(); } catch (e) { LP.avisarErro(e); }
          }, { tipo: 'perigo', pequeno: true, icone: 'lixo', gerundio: 'Apagando…' }) : null)))) : LP.estadoVazio('Nenhum recado', 'Recados aparecem no topo de todas as abas para quem não leu, com um × por pessoa (o fixo fica até sair do ar).'));
    } catch (e) {
      if ((e && e.status === 401) || !LP.visivel(eq.corpo)) return;
      LP.trocar(eq.corpo, LP.estadoErro(e, carregarRecados));
    }
  }
  async function escrever(gente) {
    const campos = [
      { nome: 'titulo', rotulo: 'Título', maxlength: 90, obrigatorio: true, placeholder: 'Ex.: Live hoje às 20h: fiquem de olho nas denúncias' },
      { nome: 'texto', rotulo: 'Texto (opcional)', tipo: 'textarea', maxlength: 600, linhas: 4 },
      { nome: 'tom', rotulo: 'Tom', tipo: 'opcoes', valor: 'nota', opcoes: [{ valor: 'nota', rotulo: 'Nota' }, { valor: 'aviso', rotulo: 'Aviso' }, { valor: 'urgente', rotulo: 'Urgente' }] },
      { nome: 'fixo', tipo: 'caixa', rotulo: 'Fixo (não sai do topo quando alguém lê)', valor: false },
      { nome: 'ate', rotulo: 'Vale até (opcional)', tipo: 'data' },
    ].concat(gente.map((p) => ({ nome: 'para_' + p.id, tipo: 'caixa', rotulo: 'Só para ' + p.nome + ' (sem marcar ninguém: toda a equipe)', valor: false })));
    const r = await LP.dialogo({
      titulo: 'Escrever recado para a equipe',
      botao: 'Publicar recado',
      gerundio: 'Publicando…',
      campos: campos,
      executar: (v) => LP.equipePost({ acao: 'recado_criar', titulo: v.titulo, texto: v.texto || undefined, tom: v.tom, fixo: !!v.fixo, ate: v.ate || undefined,
        para: gente.filter((p) => v['para_' + p.id]).map((p) => p.id) }),
    });
    if (!r) return;
    LP.avisar('Recado publicado. Aparece no topo do painel de quem não leu.');
    carregarRecados();
    LP.recarregarRecados();
  }

  LP.abas.equipe = { titulo: 'Equipe', sub: '', montar: montar, recarregar: () => { eq.papeis = null; carregar(); } };
})();
