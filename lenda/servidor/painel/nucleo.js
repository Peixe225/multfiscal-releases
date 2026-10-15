/* LENDA · painel do administrador — núcleo: formatação, nomes, DOM, rede (com cancelamento), avisos (toasts),
 * diálogos (motivo, confirmação digitada), listas com seleção e lote, paginação, busca ao vivo, fila ao vivo, rota
 * no hash e o painel lateral (ficha da conta / da carreira).
 * Os outros arquivos usam o que fica em window.LP. Regra da casa: texto vindo do servidor entra só por textContent /
 * createElement — nunca innerHTML; nada de style="" (a CSP barra): só CSSOM (el.style.x) e classes. */
'use strict';

(function () {
  const LP = (window.LP = window.LP || {});
  LP.abas = LP.abas || {};

  const API_PAINEL = '../api/painel.php';
  const API_ADMIN = '../api/admin.php';
  const API_EQUIPE = '../api/equipe.php';
  const FUSO_MS = 3 * 3600 * 1000; // America/Sao_Paulo = UTC-3 fixo
  const SVG_NS = 'http://www.w3.org/2000/svg';
  LP.FUSO_MS = FUSO_MS;
  LP.API_ADMIN = API_ADMIN;
  LP.API_EQUIPE = API_EQUIPE;
  LP.API_PAINEL = API_PAINEL;
  LP.$ = (id) => document.getElementById(id);
  const calmo = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  LP.calmo = calmo;

  // ── formatação ──────────────────────────────────────────────────────────────────────────────
  const nf = new Intl.NumberFormat('pt-BR');
  const nf1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
  LP.nf = nf;
  LP.nf1 = nf1;
  LP.num = function (n) {
    n = Number(n) || 0;
    if (Math.abs(n) >= 100000) return nf1.format(n / 1000) + ' mil';
    return nf.format(n);
  };
  LP.inteiro = (n) => nf.format(Number(n) || 0);
  LP.compacto = function (n) {
    n = Number(n) || 0;
    if (n >= 1000000) return nf1.format(n / 1000000) + ' mi';
    if (n >= 1000) return nf1.format(n / 1000) + ' mil';
    return nf.format(n);
  };
  LP.duracao = function (s) {
    s = Math.round(Number(s) || 0);
    if (s < 60) return s + ' s';
    const m = Math.floor(s / 60);
    const r = s % 60;
    if (m < 60) return r ? m + ' min ' + r + ' s' : m + ' min';
    const h = Math.floor(m / 60);
    return h + ' h ' + (m % 60) + ' min';
  };
  /** Segundos em horas e minutos, sem os segundos ("3 h 20 min", "45 min"). */
  LP.tempo = function (s) {
    const m = Math.round((Number(s) || 0) / 60);
    if (m < 60) return m + ' min';
    const h = Math.floor(m / 60);
    return h + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '');
  };
  LP.minutos = function (min) {
    min = Math.round(Number(min) || 0);
    if (min < 60) return min + ' min';
    const h = Math.floor(min / 60);
    const r = min % 60;
    return r ? h + ' h ' + r + ' min' : h + ' h';
  };
  /** Horas com uma casa ("1,5 h"); null → "—". */
  LP.horas = (h) => (h === null || h === undefined ? '—' : h < 1 ? Math.round(h * 60) + ' min' : nf1.format(h) + ' h');
  LP.pct = function (a, b) {
    if (!b) return '—';
    const v = (a / b) * 100;
    return (v >= 10 || v === 0 ? Math.round(v) : nf1.format(v)) + '%';
  };
  LP.diaCurto = function (iso) { // "2026-10-14" → "14/10"
    const p = String(iso).split('-');
    return p.length === 3 ? p[2] + '/' + p[1] : String(iso);
  };
  LP.diaLongo = function (iso) {
    const d = new Date(iso + 'T12:00:00Z');
    if (isNaN(d)) return String(iso);
    return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' });
  };
  function partesSp(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d)) return null;
    const b = new Date(d.getTime() - FUSO_MS);
    const z = (n) => String(n).padStart(2, '0');
    return { dd: z(b.getUTCDate()), mm: z(b.getUTCMonth() + 1), aaaa: String(b.getUTCFullYear()), hh: z(b.getUTCHours()), mi: z(b.getUTCMinutes()), ss: z(b.getUTCSeconds()) };
  }
  /** UTC ISO → "14/10 09:30" em Brasília. */
  LP.dataHora = function (iso) {
    const p = partesSp(iso);
    return p ? p.dd + '/' + p.mm + ' ' + p.hh + ':' + p.mi : '';
  };
  /** UTC ISO → "14/10/2026 09:30" em Brasília. */
  LP.dataHoraAno = function (iso) {
    const p = partesSp(iso);
    return p ? p.dd + '/' + p.mm + '/' + p.aaaa + ' ' + p.hh + ':' + p.mi : '';
  };
  LP.data = function (iso) {
    const p = partesSp(iso);
    return p ? p.dd + '/' + p.mm + '/' + p.aaaa : '';
  };
  LP.hora = function (iso, comSegundos) {
    const p = partesSp(iso);
    return p ? p.hh + ':' + p.mi + (comSegundos ? ':' + p.ss : '') : '';
  };
  /** "há 5 min", "há 3 h", "ontem 09:30", "em 20 min"; mais longe: a data. */
  LP.relativo = function (iso) {
    if (!iso) return '—';
    const t = Date.parse(iso);
    if (isNaN(t)) return '—';
    const s = Math.round((Date.now() - t) / 1000);
    const futuro = s < 0;
    const a = Math.abs(s);
    if (a < 45) return futuro ? 'em instantes' : 'agora';
    if (a < 3600) { const m = Math.max(1, Math.round(a / 60)); return futuro ? 'em ' + m + ' min' : 'há ' + m + ' min'; }
    if (a < 86400 && !futuro) return 'há ' + Math.round(a / 3600) + ' h';
    if (a < 86400) { const h = Math.floor(a / 3600); const m = Math.round((a % 3600) / 60); return 'em ' + h + ' h' + (m ? ' ' + m + ' min' : ''); }
    if (!futuro && a < 2 * 86400) return 'ontem ' + LP.hora(iso);
    if (futuro && a < 60 * 86400) return 'em ' + Math.round(a / 86400) + ' dias';
    if (!futuro && a < 14 * 86400) return 'há ' + Math.round(a / 86400) + ' dias';
    return new Date(t).getUTCFullYear() === new Date().getUTCFullYear() ? LP.dataHora(iso) : LP.dataHoraAno(iso);
  };
  LP.hojeSp = () => new Date(Date.now() - FUSO_MS).toISOString().slice(0, 10);
  LP.diasAntes = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') - n * 86400000).toISOString().slice(0, 10);
  /** "1 denúncia", "3 denúncias" (com o número). */
  LP.plural = (n, um, varios) => LP.inteiro(n) + ' ' + (Number(n) === 1 ? um : varios);
  /** O mesmo, sem o número ("denúncia"/"denúncias"). */
  LP.palavra = (n, um, varios) => (Number(n) === 1 ? um : varios);

  // ── nomes ───────────────────────────────────────────────────────────────────────────────────
  LP.NOMES_MODO = { classico: 'Clássico', imersivo: 'Imersivo', live: 'Live', outro: 'Fora de partida' };
  LP.NOMES_ORIGEM = { tiktok: 'TikTok', youtube: 'YouTube', instagram: 'Instagram', google: 'Google', direto: 'Direto (link ou digitado)' };
  LP.NOMES_APARELHO = { mobile: 'Celular', desktop: 'Computador', tablet: 'Tablet', outro: 'Outro' };
  LP.NOMES_STATUS_INDICACAO = { pendente: 'Pendente', valida: 'Válida', recusada: 'Recusada' };
  LP.NOMES_MOTIVO_INDICACAO = {
    propria_conta: 'a própria conta', mesmo_aparelho: 'mesmo aparelho do indicador', suspenso: 'indicador suspenso',
    limite: 'indicador já no limite', admin: 'recusada pelo admin',
  };
  LP.NOMES_SUSPEITA = {
    temporadas: 'temporadas', pico: 'pico de OVR', nota: 'nota', gols: 'gols demais', bolas: 'Bolas de Ouro demais',
    titulos: 'títulos demais', idade: 'idade final', bonus: 'bônus sem registro', nome: 'nome ou texto proibido',
    copas: 'Copas do Mundo demais', dados: 'dados que não batem', copia: 'cópia de outra conta', revisao: 'nota alta: esperando revisão',
  };
  LP.NOMES_DENUNCIA = { nome: 'Nome ofensivo', trapaca: 'Trapaça', outro: 'Outro' };
  LP.NOMES_ORIGEM_BONUS = { indicacao: 'Indicação', compartilhar: 'Compartilhar', admin: 'Dado pelo admin' };
  LP.NOMES_HALL_PUBLICO = { auto: 'As 3 melhores', manual: 'Ele escolhe', nao: 'Não aparece' };
  LP.NOMES_RARIDADE = { comum: 'Comum', rara: 'Rara', epica: 'Épica', lendaria: 'Lendária' };
  LP.NOMES_TIPO_CONTA = { jogador: 'Jogador', tester: 'Tester', criador: 'Criador', oficial: 'Oficial', teste: 'Teste' };
  LP.AJUDA_TIPO_CONTA = {
    jogador: 'Conta comum.',
    tester: 'Abre o Imersivo e a Live (com o selo "Teste"), sem o painel do admin. As carreiras do Imersivo dela não entram no Hall.',
    criador: 'Criador de conteúdo (só um rótulo, para você achar fácil).',
    oficial: 'Conta do próprio jogo. As visitas dela ficam fora dos números (sem "incluir robôs/testes").',
    teste: 'Conta de teste. As visitas dela ficam fora dos números (sem "incluir robôs/testes").',
  };
  LP.NOMES_EVENTO = {
    view: 'Abriu tela', jogo_inicio: 'Começou um jogo', jogo_fim: 'Terminou um jogo', partida_fim: 'Partida no Imersivo',
    gate_ver: 'Viu o convite de conta', gate_fechar: 'Fechou o convite', cadastro: 'Criou a conta', login: 'Entrou',
    logout: 'Saiu', compartilhar: 'Compartilhou',
  };
  LP.NOMES_ACAO_LOG = {
    suspender: 'Suspendeu conta', reativar: 'Reativou conta', deslogar: 'Deslogou', renomear: 'Renomeou',
    excluir_usuario: 'Excluiu conta', dar_bonus: 'Deu bônus', tirar_bonus: 'Tirou bônus', tirar_bonus_lote: 'Tirou bônus em lote',
    recusar_indicacao: 'Recusou indicação', indicacoes_lote: 'Recusou indicações em lote',
    ocultar_carreira: 'Ocultou carreira', mostrar_carreira: 'Mostrou / liberou carreira', apagar_carreira: 'Apagou carreira',
    carreiras_lote: 'Carreiras em lote', restaurar_carreira: 'Restaurou carreira', liberar_reenvio: 'Liberou reenvio',
    destacar_carreira: 'Destaque da carreira', atualizar_hall: 'Atualizou o Hall', resolver_denuncia: 'Resolveu denúncia',
    resolver_denuncias_lote: 'Denúncias em lote', bloquear_hall: 'Tirou/devolveu ao Hall', nota: 'Anotou na conta',
    nota_apagada: 'Apagou anotação', mudar_tipo: 'Mudou o tipo de conta', enviar_redefinicao: 'Mandou código de senha',
    config: 'Mudou configurações', testar_aviso: 'Testou o aviso no celular', exportar: 'Exportou',
    alerta_dispensar: 'Dispensou alerta', alerta_reabrir: 'Reabriu alerta',
    painel_entrar: 'Entrou no painel', painel_sair: 'Saiu do painel', painel_falha: 'Errou a senha do painel',
    painel_limite: 'Bloqueio de tentativas', painel_pin_errado: 'Errou o PIN', painel_pin_travado: 'PIN bloqueado',
    pin_definido: 'Criou o PIN', senha_trocada: 'Trocou a senha provisória', minha_senha: 'Trocou a própria senha',
    minha_senha_falha: 'Errou a senha atual', sair_todos: 'Saiu dos outros aparelhos', criar_conta: 'Criou a conta pessoal',
    negado: 'Ação negada (papel)', sessao_encerrar: 'Encerrou sessão', etapa_expirou: 'Entrada vencida',
    equipe_criar: 'Pôs alguém na equipe', equipe_papel: 'Mudou o papel', equipe_ativar: 'Ativou/desativou pessoa',
    equipe_zerar_pin: 'Zerou o PIN', zerar_pin: 'Zerou o PIN', equipe_senha: 'Senha provisória', equipe_excluir: 'Tirou da equipe',
    papel_salvar: 'Salvou papel', papel_apagar: 'Apagou papel', recado_criar: 'Escreveu recado', recado_apagar: 'Apagou recado',
    backup: 'Baixou backup', backup_guardar: 'Guardou cópia', backup_restaurar: 'Restaurou cópia', backup_restaurar_recusado: 'Restauração recusada',
    copia_baixar: 'Baixou cópia do servidor',
  };
  /** Em que passo da entrada a sessão do painel parou (Equipe → Sessões). */
  LP.NOMES_ETAPA = { pronto: 'dentro', senha: 'digitando a senha', pin: 'digitando o PIN', criar_pin: 'criando o PIN', trocar_senha: 'trocando a senha provisória' };
  LP.etapa = (e) => LP.NOMES_ETAPA[e] || 'entrando';
  LP.NOMES_PODER = {
    ver: 'Ver', moderar: 'Moderar', usuarios: 'Contas', excluir: 'Excluir contas', bonus: 'Bônus', config: 'Configurações',
    exportar: 'Exportar', equipe: 'Equipe', sistema: 'Sistema',
  };
  LP.origem = (o) => LP.NOMES_ORIGEM[o] || o || '—';
  /** Para tabelas: "Direto" no lugar de "Direto (link ou digitado)". */
  LP.origemCurta = (o) => (o === 'direto' ? 'Direto' : LP.origem(o));
  LP.aparelho = (a) => LP.NOMES_APARELHO[a] || a || '—';
  LP.motivosSuspeita = (s) => String(s || '').split(',').map((m) => LP.NOMES_SUSPEITA[m.trim()] || m.trim()).filter(Boolean).join(', ');

  /** Nomes de clubes, países, troféus, prêmios e conquistas (nomes.json, gerado pelo scripts/painel-nomes.mjs). Falhou: mapas vazios. */
  let nomesPromessa = null;
  LP.nomes = function () {
    if (!nomesPromessa) {
      nomesPromessa = fetch('nomes.json?v=3.2.0', { credentials: 'same-origin' })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
        .then((j) => {
          const o = j && typeof j === 'object' ? j : {};
          const mapa = (x) => (x && typeof x === 'object' ? x : {});
          return { clubes: mapa(o.clubes), paises: mapa(o.paises), trofeus: mapa(o.trofeus), premios: mapa(o.premios), conquistas: mapa(o.conquistas) };
        });
    }
    return nomesPromessa;
  };

  // ── DOM ─────────────────────────────────────────────────────────────────────────────────────
  const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'hidden', 'indeterminate', 'open']);
  /** h('div', {class, text, title, onclick, ...atributos}, ...filhos). Filhos texto viram nós de texto. Nunca style="". */
  function h(tag, props) {
    const e = document.createElement(tag);
    if (props) {
      for (const k in props) {
        const v = props[k];
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = String(v);
        else if (k === 'dataset') Object.assign(e.dataset, v);
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') e.addEventListener(k.slice(2), v);
        else if (PROPS.has(k)) e[k] = v;
        else if (k !== 'style') e.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (let i = 2; i < arguments.length; i++) anexar(e, arguments[i]);
    return e;
  }
  function anexar(e, k) {
    if (k === null || k === undefined || k === false || k === true) return;
    if (Array.isArray(k)) { k.forEach((x) => anexar(e, x)); return; }
    e.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  LP.h = h;
  LP.anexar = anexar;
  LP.svg = function (tag, attrs) {
    const e = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) e.setAttribute(k, String(attrs[k]));
    return e;
  };
  LP.limpar = function (no) { while (no && no.firstChild) no.removeChild(no.firstChild); return no; };
  LP.trocar = function (no) { LP.limpar(no); for (let i = 1; i < arguments.length; i++) anexar(no, arguments[i]); return no; };

  const ICONES = {
    busca: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'M21 21l-4.3-4.3'],
    atualizar: ['M21 12a9 9 0 1 1-2.64-6.36', 'M21 3v6h-6'],
    baixar: ['M12 3v12', 'm7 10 5 5 5-5', 'M5 21h14'],
    voltar: ['M19 12H5', 'm12 19-7-7 7-7'],
    externo: ['M15 3h6v6', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],
    olho: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
    ocultar: ['M3 3l18 18', 'M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2', 'M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6', 'M9.9 9.9a3 3 0 0 0 4.2 4.2'],
    lixo: ['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6'],
    bloquear: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M5.6 5.6l12.8 12.8'],
    reativar: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'm8 12 3 3 5-6'],
    sair: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'm16 17 5-5-5-5', 'M21 12H9'],
    lapis: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'],
    presente: ['M20 12v9H4v-9', 'M2 7h20v5H2z', 'M12 21V7'],
    check: ['M20 6 9 17l-5-5'],
    x: ['M18 6 6 18', 'M6 6l12 12'],
    bandeira: ['M4 22V4a1 1 0 0 1 1-1h11l-2 4 2 4H5'],
    arquivo: ['M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z', 'M14 3v6h6'],
    jogar: ['M7 4l13 8-13 8z'],
    copiar: ['M9 9h11v11H9z', 'M5 15H4V4h11v1'],
    menos: ['M5 12h14'],
    mais: ['M12 5v14', 'M5 12h14'],
    nota: ['M4 4h16v12H8l-4 4z', 'M8 9h8', 'M8 12h5'],
    estrela: ['m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z'],
    escudo: ['M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z'],
    envelope: ['M3 5h18v14H3z', 'm3 6 9 7 9-7'],
    restaurar: ['M3 12a9 9 0 1 0 3-6.7', 'M3 4v5h5'],
    cadeado: ['M5 11h14v10H5z', 'M8 11V7a4 4 0 0 1 8 0v4'],
    sino: ['M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9', 'M10.3 21a1.9 1.9 0 0 0 3.4 0'],
    tema: ['M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z'],
    mascara: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z', 'M3 3l18 18'],
    info: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 11v6', 'M12 7.5v.5'],
  };
  /** Ícone SVG (traço, 16px pelo CSS). */
  LP.icone = function (nome) {
    const s = LP.svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', class: 'icone' });
    (ICONES[nome] || []).forEach((d) => s.appendChild(LP.svg('path', { d: d })));
    return s;
  };
  /**
   * Botão com ícone opcional. tipo: '' | 'fantasma' | 'ouro' | 'perigo' | 'ok'; pequeno; compacto (só o ícone nas
   * tabelas do computador); gerundio: o texto enquanto trabalha ("Ocultando…"). aoClicar(ev, botao) pode devolver uma
   * Promise: o botão fica travado (com o gerúndio) até ela terminar.
   */
  LP.botao = function (texto, aoClicar, opcoes) {
    const o = opcoes || {};
    const cls = (o.tipo ? 'botao-' + o.tipo : 'botao') + (o.pequeno ? ' botao-pequeno' : '') + (o.compacto ? ' botao-compacto' : '') + (o.classe ? ' ' + o.classe : '');
    const b = h('button', { type: o.submit ? 'submit' : 'button', class: cls, title: o.title || (o.compacto ? texto : undefined), 'aria-label': o.rotulo, disabled: o.disabled, dataset: o.dataset });
    if (o.icone) b.appendChild(LP.icone(o.icone));
    if (texto) b.appendChild(h('span', { class: o.compacto ? 'rotulo-btn' : 'rotulo-texto' }, texto));
    if (o.gerundio) b.dataset.gerundio = o.gerundio;
    if (aoClicar) {
      b.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        if (b.getAttribute('aria-busy') === 'true') return;
        const r = aoClicar(ev, b);
        if (r && typeof r.then === 'function' && o.gerundio) {
          LP.ocupado(b, true);
          try { await r; } finally { if (b.isConnected) LP.ocupado(b, false); }
        }
      });
    }
    return b;
  };
  /** Link para o jogo (outra aba). hash: '#/live', '#/resumo?id=…'. */
  LP.linkJogo = function (texto, hash, opcoes) {
    const o = opcoes || {};
    const a = h('a', { href: '../' + hash, target: '_blank', rel: 'noopener', class: (o.tipo ? 'botao-' + o.tipo : 'botao') + (o.pequeno ? ' botao-pequeno' : '') + (o.compacto ? ' botao-compacto' : ''), title: o.title || (o.compacto ? texto : undefined) });
    if (o.icone !== false) a.appendChild(LP.icone(o.icone || 'externo'));
    a.appendChild(h('span', { class: o.compacto ? 'rotulo-btn' : null }, texto));
    a.addEventListener('click', (ev) => ev.stopPropagation());
    return a;
  };
  /** Liga ou desliga o "trabalhando" de um botão: travado, girando e com o verbo no gerúndio (data-gerundio). */
  LP.ocupado = function (b, sim, gerundio) {
    if (!b) return;
    const rot = b.querySelector('.rotulo-texto, .rotulo-btn, span:not(.girando)');
    if (sim) {
      b.disabled = true;
      b.setAttribute('aria-busy', 'true');
      if (!b.querySelector('.girando')) b.insertBefore(h('span', { class: 'girando', 'aria-hidden': 'true' }), b.firstChild);
      const g = gerundio || b.dataset.gerundio;
      if (g && rot) { if (b.dataset.textoAntes === undefined) b.dataset.textoAntes = rot.textContent; rot.textContent = g; }
    } else {
      b.disabled = false;
      b.removeAttribute('aria-busy');
      const g = b.querySelector('.girando');
      if (g) g.remove();
      if (rot && b.dataset.textoAntes !== undefined) { rot.textContent = b.dataset.textoAntes; delete b.dataset.textoAntes; }
    }
  };
  LP.chip = function (texto, tipo, opcoes) {
    const o = opcoes || {};
    return h('span', { class: 'chip' + (tipo ? ' chip-' + tipo : '') + (o.semPonto ? ' sem-ponto' : '') + (o.classe ? ' ' + o.classe : ''), title: o.title }, texto);
  };
  /** Pílula de situação da conta: ativo (verde), suspenso (vermelho), suspenso até dd/mm (ouro). */
  LP.chipStatus = function (status, ate) {
    if (status !== 'suspenso') return LP.chip('Ativo', 'ok');
    return ate ? LP.chip('Suspenso até ' + LP.dataHora(ate).slice(0, 5), 'alerta', { title: 'Volta sozinha em ' + LP.dataHoraAno(ate) }) : LP.chip('Suspenso', 'perigo');
  };
  /** Pílula do tipo de conta (nada para jogador): tester azul, criador/oficial ouro, teste cinza. */
  LP.chipTipo = function (tipo) {
    if (!tipo || tipo === 'jogador') return null;
    const cor = tipo === 'tester' ? 'info' : tipo === 'teste' ? '' : 'ouro';
    return LP.chip(LP.NOMES_TIPO_CONTA[tipo] || tipo, cor, { semPonto: true, title: LP.AJUDA_TIPO_CONTA[tipo] || '' });
  };
  /** Texto com a data relativa e a data completa no title. */
  LP.quando = function (iso) {
    return h('span', { class: 'quando', title: iso ? LP.dataHoraAno(iso) + ' (Brasília)' : '' }, iso ? LP.relativo(iso) : '—');
  };
  LP.ladrilho = function (rotulo, valor, extra, opcoes) {
    const o = opcoes || {};
    const c = h(o.href ? 'a' : 'div', { class: 'ladrilho' + (o.classe ? ' ' + o.classe : ''), href: o.href, title: o.title });
    c.appendChild(h('div', { class: 'ladrilho-rotulo' }, rotulo));
    c.appendChild(h('div', { class: 'ladrilho-valor' + (String(valor).length > 8 ? ' ladrilho-valor-longo' : '') }, valor));
    if (extra) c.appendChild(h('div', { class: 'ladrilho-extra' }, extra));
    return c;
  };
  LP.dado = function (rotulo, valor, opcoes) {
    return h('div', { class: 'dado' + (opcoes && opcoes.largo ? ' dado-largo' : '') }, h('dt', null, rotulo), h('dd', null, valor === null || valor === undefined || valor === '' ? '—' : valor));
  };
  LP.debounce = function (fn, ms) {
    let t = 0;
    const f = function () { const a = arguments; clearTimeout(t); t = setTimeout(() => fn.apply(null, a), ms); };
    f.cancelar = () => clearTimeout(t);
    return f;
  };
  /** Copia um texto; com o botão, ele vira "Copiado" por 1,8 s. */
  LP.copiar = async function (texto, botao) {
    let ok = false;
    try {
      await navigator.clipboard.writeText(texto);
      ok = true;
    } catch (e) {
      const t = h('textarea', { class: 'fora-da-tela', 'aria-hidden': 'true' });
      t.value = texto;
      document.body.appendChild(t);
      t.select();
      try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      t.remove();
    }
    if (botao) {
      const rot = botao.querySelector('.rotulo-texto') || botao;
      const antes = rot.textContent;
      rot.textContent = ok ? 'Copiado' : 'Não deu: copie à mão';
      setTimeout(() => { if (rot.isConnected) rot.textContent = antes; }, 1800);
    } else {
      LP.avisar(ok ? 'Copiado.' : 'Não deu para copiar. Selecione e copie à mão.', ok ? 'ok' : 'erro');
    }
    return ok;
  };
  /** Baixa um texto como arquivo (JSON da carreira etc.). */
  LP.baixar = function (nome, conteudo, tipo) {
    const url = URL.createObjectURL(new Blob([conteudo], { type: tipo || 'application/json' }));
    const a = h('a', { href: url, download: nome, class: 'fora-da-tela' });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };
  /**
   * Baixa um arquivo do servidor (CSV, backup): confere antes se a sessão vale (senão o "arquivo" seria a página de
   * erro) e então abre o endereço num <a download>. O registro do servidor anota a exportação.
   */
  LP.baixarDoServidor = async function (url) {
    await LP.painelGet('?so=eu');
    const a = h('a', { href: url, download: '', class: 'fora-da-tela' });
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  /** Número que muda pisca em ouro por 1,4 s (classe .mudou; sem animação com movimento reduzido). */
  LP.mudarTexto = function (el, texto) {
    if (!el) return;
    const novo = String(texto);
    if (el.textContent !== novo) {
      const tinha = el.textContent !== '' && el.textContent !== '–';
      el.textContent = novo;
      if (tinha) {
        el.classList.remove('mudou');
        void el.offsetWidth; // reinicia a animação
        el.classList.add('mudou');
        clearTimeout(el._mudou);
        el._mudou = setTimeout(() => el.classList.remove('mudou'), 1400);
      }
    }
  };

  // ── e-mail no modo discreto (atalho M): "jo***@gmail.com" com "mostrar" por linha ─────────────
  LP.mascarar = function (email) {
    const s = String(email || '');
    const i = s.indexOf('@');
    if (i < 0) return s ? s.slice(0, 2) + '***' : '';
    return s.slice(0, Math.min(2, i)) + '***' + s.slice(i);
  };
  /**
   * E-mail que respeita o modo discreto: os dois textos ficam no DOM e o CSS (html[data-discreto]) escolhe qual
   * aparece; "mostrar" revela só esta linha. Trocar o modo não redesenha nada.
   */
  LP.email = function (email, opcoes) {
    const o = opcoes || {};
    if (!email) return h('span', { class: 'texto-3' }, '—');
    const caixa = h('span', { class: 'email' + (o.classe ? ' ' + o.classe : '') });
    caixa.appendChild(h('span', { class: 'email-mascara mono' }, LP.mascarar(email)));
    caixa.appendChild(h('span', { class: 'email-real mono' }, email));
    const b = h('button', { type: 'button', class: 'email-mostrar', title: 'Mostrar o e-mail só nesta linha', 'aria-label': 'Mostrar o e-mail' }, 'mostrar');
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      caixa.classList.toggle('revelado');
      b.textContent = caixa.classList.contains('revelado') ? 'esconder' : 'mostrar';
    });
    caixa.appendChild(b);
    return caixa;
  };

  // ── sinais (P0-3 / P1-9): graves à vista em vermelho, leves recolhidos ───────────────────────
  /** Sinais de um item: {graves: nó|null, leves: nó|null}. */
  LP.sinais = function (item, opcoes) {
    const o = opcoes || {};
    const ss = Array.isArray(item && item.sinais) ? item.sinais : [];
    const graves = ss.filter((s) => s.nivel === 'grave');
    const leves = ss.filter((s) => s.nivel !== 'grave');
    const nGraves = graves.length ? h('div', { class: 'sinais sinais-graves', role: 'note', 'aria-label': 'Sinais graves' },
      graves.map((s) => h('span', { class: 'sinal sinal-grave', title: s.codigo }, h('span', { class: 'sinal-marca', 'aria-hidden': 'true' }, '⚠'), s.texto))) : null;
    let nLeves = null;
    if (leves.length) {
      nLeves = o.semRecolher
        ? h('div', { class: 'sinais' }, leves.map((s) => h('span', { class: 'sinal sinal-leve', title: s.codigo }, '· ', s.texto)))
        : h('details', { class: 'sinais-leves' },
          h('summary', null, LP.plural(leves.length, 'sinal leve', 'sinais leves')),
          h('div', { class: 'sinais' }, leves.map((s) => h('span', { class: 'sinal sinal-leve', title: s.codigo }, '· ', s.texto))));
    }
    return { graves: nGraves, leves: nLeves, nGraves: graves.length, nLeves: leves.length };
  };
  LP.celulaSinais = function (item) {
    const s = LP.sinais(item);
    if (!s.graves && !s.leves) return h('span', { class: 'texto-3' }, 'sem alerta');
    return h('div', { class: 'celula-sinais' }, s.graves, s.leves);
  };

  // ── rede ────────────────────────────────────────────────────────────────────────────────────
  class ErroApi extends Error {
    constructor(status, codigo, mensagem, json) {
      super(mensagem);
      this.status = status;
      this.codigo = codigo;
      this.json = json || null;
    }
  }
  LP.ErroApi = ErroApi;
  function mensagemPadrao(status, cod) {
    if (status === 400) return 'O servidor recusou o pedido (dados inválidos).';
    if (status === 403 && cod === 'origem') return 'Pedido recusado (origem): abra o painel pelo endereço do site e tente de novo.';
    if (status === 403) return 'O servidor recusou o pedido.';
    if (status === 404) return 'Não encontrado (pode ter sido apagado agora).';
    if (status === 409) return 'Não deu: o estado mudou. Atualize e tente de novo.';
    if (status === 413) return 'Pedido grande demais.';
    if (status === 429) return 'Muitas tentativas seguidas. Espere um pouco e tente de novo.';
    if (status === 503) return 'Esta parte ainda não está instalada no servidor: rode o instalar.php (LEIAME §5).';
    if (status >= 500) return 'O servidor teve um problema. Tente de novo em instantes.';
    return 'Não deu certo (erro ' + status + ').';
  }
  /** Erro de pedido cancelado (o usuário pediu outra coisa antes de este responder): quem chamou ignora. */
  LP.cancelado = (e) => !!e && e.codigo === 'cancelado';
  /**
   * Pedido JSON. Opções: corpo (POST), sinal (AbortSignal de fora: cancela), tempo (ms, padrão 25 s), semExpirar
   * (401 não derruba a sessão do painel). Erro HTTP/rede: ErroApi com a mensagem do servidor (pt-BR).
   */
  async function pedir(url, opcoes) {
    const o = opcoes || {};
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    let porTempo = false;
    const tempo = setTimeout(() => { porTempo = true; if (ctl) ctl.abort(); }, o.tempo || 25000);
    const aoCancelar = () => ctl && ctl.abort();
    if (o.sinal) {
      if (o.sinal.aborted) aoCancelar();
      else o.sinal.addEventListener('abort', aoCancelar, { once: true });
    }
    const init = { method: o.corpo !== undefined ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }, signal: ctl ? ctl.signal : undefined };
    if (o.corpo !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(o.corpo);
    }
    let r;
    let json = null;
    try {
      r = await fetch(url, init);
      try { json = await r.json(); } catch (e) { json = null; }
    } catch (e) {
      if (e && e.name === 'AbortError' && !porTempo) throw new ErroApi(-1, 'cancelado', 'Pedido cancelado.');
      throw new ErroApi(0, 'rede', porTempo
        ? 'O servidor demorou demais para responder. Tente de novo.'
        : 'Sem conexão com o servidor. Confira a internet e tente de novo.');
    } finally {
      clearTimeout(tempo);
      if (o.sinal) o.sinal.removeEventListener('abort', aoCancelar);
    }
    if (o.sinal && o.sinal.aborted) throw new ErroApi(-1, 'cancelado', 'Pedido cancelado.');
    if (r.status === 401 && !o.semExpirar) {
      if (typeof LP.aoExpirar === 'function') LP.aoExpirar(json && json.erro);
      throw new ErroApi(401, (json && json.erro) || 'nao_logado', 'A sessão do painel acabou. Entre de novo.', json);
    }
    if (!r.ok) {
      const cod = json && typeof json.erro === 'string' ? json.erro : 'http_' + r.status;
      // 404 sem o JSON da API = o arquivo da rota não está no servidor (painel novo com a api/ antiga)
      const msg = json && typeof json.mensagem === 'string' && json.mensagem ? json.mensagem
        : r.status === 404 ? 'Esta parte do servidor ainda não foi publicada: suba a pasta api/ nova e rode o instalar.php (veja o LEIAME).'
          : mensagemPadrao(r.status, cod);
      throw new ErroApi(r.status, cod, msg, json);
    }
    if (!json || typeof json !== 'object') {
      // 200 sem JSON (página de erro da hospedagem, proxy, resposta cortada): erro, nunca "lista vazia"
      throw new ErroApi(r.status, 'formato', 'O servidor respondeu algo inesperado. Tente de novo em instantes.');
    }
    return json;
  }
  LP.pedir = pedir;
  const comQuery = (base, r, params) => {
    const q = new URLSearchParams(r ? { r: r } : {});
    for (const k in params || {}) {
      const v = params[k];
      if (v !== undefined && v !== null && v !== '' && v !== false) q.set(k, String(v === true ? 1 : v));
    }
    const s = q.toString();
    return base + (s ? '?' + s : '');
  };
  LP.urlAdmin = (r, params) => comQuery(API_ADMIN, r, params);
  LP.urlEquipe = (r, params) => comQuery(API_EQUIPE, r, params);
  LP.painelGet = (qs, opcoes) => pedir(API_PAINEL + (qs || ''), opcoes);
  LP.painelPost = (corpo, opcoes) => pedir(API_PAINEL, Object.assign({ corpo: corpo }, opcoes || {}));
  LP.adminGet = (r, params, opcoes) => pedir(comQuery(API_ADMIN, r, params), opcoes);
  LP.adminPost = (corpo, opcoes) => pedir(API_ADMIN, Object.assign({ corpo: corpo }, opcoes || {}));
  LP.equipeGet = (r, params, opcoes) => pedir(comQuery(API_EQUIPE, r, params), opcoes);
  LP.equipePost = (corpo, opcoes) => pedir(API_EQUIPE, Object.assign({ corpo: corpo }, opcoes || {}));
  /** Mensagem de um erro qualquer, para mostrar. */
  LP.mensagem = (e) => (e && e.message) || 'Não deu certo. Tente de novo.';
  /**
   * Um pedido por chave de cada vez: pedir de novo cancela o anterior (busca ao vivo, filtros clicados depressa).
   * LP.unico('usuarios') → AbortSignal novo (o anterior da mesma chave é cancelado).
   */
  const unicos = {};
  LP.unico = function (chave) {
    if (unicos[chave]) unicos[chave].abort();
    unicos[chave] = new AbortController();
    return unicos[chave].signal;
  };

  // ── poderes (do ?so=sessao; quem barra mesmo é o servidor) ──────────────────────────────────
  LP.sessao = null;
  /** O papel desta sessão tem o poder? Sem sessão carregada ainda: sim (o servidor decide). */
  LP.pode = (poder) => !LP.sessao || !Array.isArray(LP.sessao.poderes) || LP.sessao.poderes.includes(poder);

  // ── avisos (toasts) ─────────────────────────────────────────────────────────────────────────
  // No rodapé, ao centro. Sucesso (✓) some em 8 s; erro (!) fica até fechar no ×, com role="alert". Até 3 de uma vez.
  LP.avisar = function (msg, tipo, ms) {
    const caixa = LP.$('avisos');
    if (!caixa || !msg) return null;
    const t = tipo || 'ok';
    const marca = t === 'erro' ? '!' : t === 'info' ? 'i' : '✓';
    const fechar = h('button', { type: 'button', class: 'aviso-fechar', 'aria-label': 'Fechar aviso' }, '×');
    const a = h('div', { class: 'aviso-flutuante ' + t, role: t === 'erro' ? 'alert' : 'status' },
      h('span', { class: 'marca-aviso', 'aria-hidden': 'true' }, marca), h('div', { class: 'aviso-texto' }, msg), fechar);
    const tirar = () => { if (a.parentNode) a.parentNode.removeChild(a); };
    fechar.addEventListener('click', tirar);
    caixa.appendChild(a);
    while (caixa.children.length > 3) {
      // sai primeiro o sucesso mais antigo; os erros ficam até o ×
      const velho = Array.from(caixa.children).find((x) => !x.classList.contains('erro')) || caixa.firstChild;
      caixa.removeChild(velho);
    }
    if (t !== 'erro') setTimeout(tirar, ms || 8000);
    return a;
  };
  LP.avisarErro = (e) => { if (!e || (e.status !== 401 && !LP.cancelado(e))) LP.avisar(LP.mensagem(e), 'erro'); };

  // ── diálogo (confirmar, formulário, motivo, detalhe) ────────────────────────────────────────
  const pilha = [];
  const MOTIVOS_RAPIDOS = [
    { rotulo: 'Nome ofensivo', aviso: 'nome' },
    { rotulo: 'Números impossíveis / trapaça', aviso: 'trapaca' },
    { rotulo: 'Repetida / spam', aviso: 'repetida' },
    { rotulo: 'Pedido do jogador', aviso: 'pedido' },
    { rotulo: 'Outro', aviso: 'outro', vazio: true },
  ];
  LP.MOTIVOS_RAPIDOS = MOTIVOS_RAPIDOS;
  /**
   * Abre um <dialog> com showModal(). Opções: titulo, texto (ou lista), corpo (nó ou função → nó), campos [{nome,
   * rotulo, tipo: 'texto'|'textarea'|'numero'|'opcoes'|'motivo'|'caixa'|'senha'|'selecao'|'data'|'email', valor, min,
   * max, maxlength, obrigatorio, ajuda, placeholder, opcoes:[{valor, rotulo}], atalhos:[{rotulo, valor}], chips (motivo:
   * os motivos rápidos), validar(v, todos) → msg|null}], digitar (texto que tem de ser digitado para liberar o botão;
   * digitarLivre: sem diferenciar maiúsculas/espaços nas pontas), botao, tipoBotao ('ouro'|'perigo'|'ok'), gerundio
   * (texto do botão trabalhando), perigo, largo, soFechar, executar(valores) → Promise (erro aparece dentro do
   * diálogo, no campo certo quando o servidor diz qual; deu certo, fecha). Resolve com o retorno de executar (ou os
   * valores), ou null.
   */
  LP.dialogo = function (op) {
    return new Promise((resolver) => {
      let trabalhando = false;
      let terminado = false;
      const n = pilha.length + 1;
      const sufixo = '-' + n + '-' + Math.random().toString(36).slice(2, 7);
      const d = h('dialog', { class: 'dialogo' + (op.largo ? ' largo' : '') + (op.perigo ? ' dialogo-perigo' : ''), 'aria-labelledby': 'dialogo-titulo' + sufixo, 'aria-modal': 'true' });
      const antes = document.activeElement;
      const form = h('form', { method: 'dialog', novalidate: true });
      const fecharX = h('button', { type: 'button', class: 'botao-icone', 'aria-label': 'Fechar' }, LP.icone('x'));
      form.appendChild(h('div', { class: 'dialogo-cabeca' }, h('h2', { id: 'dialogo-titulo' + sufixo }, op.titulo || ''), fecharX));
      const corpo = h('div', { class: 'dialogo-corpo' });
      [].concat(op.texto || []).forEach((t) => corpo.appendChild(t instanceof Node ? t : h('p', null, t)));
      if (op.corpo) corpo.appendChild(typeof op.corpo === 'function' ? op.corpo() : op.corpo);
      const entradas = {};
      const errosCampo = {};
      (op.campos || []).forEach((c) => {
        const id = 'campo-' + c.nome + sufixo;
        const caixa = h('div', { class: 'campo' + (c.tipo === 'caixa' ? ' campo-caixa' : '') });
        if (c.rotulo && c.tipo !== 'caixa') caixa.appendChild(h('label', { class: 'rotulo', for: id }, c.rotulo));
        let entrada;
        if (c.tipo === 'textarea' || c.tipo === 'motivo') {
          entrada = h('textarea', { id: id, maxlength: c.maxlength || (c.tipo === 'motivo' ? 200 : undefined), placeholder: c.placeholder, rows: c.linhas || (c.tipo === 'motivo' ? 2 : 3) });
          entrada.value = c.valor || '';
          if (c.tipo === 'motivo' && c.chips !== false) {
            let escolhido = null;
            const lista = Array.isArray(c.chips) ? c.chips : MOTIVOS_RAPIDOS;
            const chips = h('div', { class: 'motivos-rapidos', role: 'group', 'aria-label': 'Motivos rápidos' });
            lista.forEach((m) => {
              const b = h('button', { type: 'button', class: 'chip-motivo', 'aria-pressed': 'false' }, m.rotulo);
              b.addEventListener('click', () => {
                escolhido = m;
                chips.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
                if (m.vazio) { if (lista.some((x) => x.rotulo === entrada.value)) entrada.value = ''; }
                else entrada.value = m.rotulo;
                entrada.dispatchEvent(new Event('input'));
                entrada.focus();
              });
              chips.appendChild(b);
            });
            caixa.appendChild(chips);
            entrada.lerAviso = () => (escolhido ? escolhido.aviso : 'outro');
          }
        } else if (c.tipo === 'opcoes') {
          entrada = h('div', { class: 'segmentos', role: 'radiogroup', 'aria-label': c.rotulo || c.nome, id: id });
          let valorAtual = c.valor;
          const botoes = (c.opcoes || []).map((op2) => {
            const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(op2.valor === valorAtual), 'aria-pressed': String(op2.valor === valorAtual) }, op2.rotulo);
            b.addEventListener('click', () => {
              valorAtual = op2.valor;
              botoes.forEach((x, i) => { const sim = (c.opcoes[i].valor === valorAtual); x.setAttribute('aria-pressed', String(sim)); x.setAttribute('aria-checked', String(sim)); });
              if (c.aoMudar) c.aoMudar(valorAtual);
            });
            entrada.appendChild(b);
            return b;
          });
          entrada.lerValor = () => valorAtual;
        } else if (c.tipo === 'selecao') {
          entrada = h('select', { id: id });
          (c.opcoes || []).forEach((o2) => entrada.appendChild(h('option', { value: o2.valor, selected: o2.valor === c.valor }, o2.rotulo)));
        } else if (c.tipo === 'caixa') {
          entrada = h('input', { id: id, type: 'checkbox', checked: !!c.valor });
          entrada.lerValor = () => entrada.checked;
          caixa.appendChild(h('label', { class: 'caixa', for: id }, entrada, h('span', null, c.rotulo)));
        } else {
          const tipo = c.tipo === 'numero' ? 'number' : c.tipo === 'senha' ? 'password' : c.tipo === 'data' ? 'date' : c.tipo === 'email' ? 'email' : 'text';
          entrada = h('input', { id: id, type: tipo, inputmode: c.tipo === 'numero' ? 'numeric' : undefined,
            min: c.min, max: c.max, maxlength: c.maxlength, placeholder: c.placeholder,
            autocomplete: c.tipo === 'senha' ? (c.autocomplete || 'new-password') : c.tipo === 'email' ? 'email' : 'off', spellcheck: 'false' });
          entrada.value = c.valor === undefined || c.valor === null ? '' : String(c.valor);
        }
        if (c.tipo !== 'caixa') {
          if (c.tipo === 'senha') caixa.appendChild(h('div', { class: 'senha-linha' }, entrada, LP.botaoMostrarSenha(entrada)));
          else caixa.appendChild(entrada);
        }
        if (c.atalhos && c.atalhos.length) {
          const at = h('div', { class: 'atalhos-dias', role: 'group', 'aria-label': 'Atalhos' });
          const marcar = (valor) => at.querySelectorAll('button').forEach((x, i) => x.setAttribute('aria-pressed', String(c.atalhos[i].valor === valor)));
          c.atalhos.forEach((x) => at.appendChild(h('button', { type: 'button', class: 'chip-motivo', 'aria-pressed': String(x.valor === c.valor || (x.valor === null && (c.valor === null || c.valor === undefined || c.valor === ''))),
            onclick: () => { entrada.value = x.valor === null ? '' : String(x.valor); marcar(x.valor); entrada.dispatchEvent(new Event('input')); } }, x.rotulo)));
          entrada.addEventListener('input', () => { const v = entrada.value.trim(); marcar(v === '' ? null : Number(v)); });
          caixa.appendChild(at);
        }
        if (c.tipo === 'motivo' || (c.maxlength && (c.tipo === 'textarea'))) {
          const cont = h('span', { class: 'contador-campo', 'aria-live': 'polite' });
          const max = c.maxlength || 200;
          const atualizar = () => { cont.textContent = entrada.value.length + '/' + max + (c.ajudaContador ? ' · ' + c.ajudaContador : ''); };
          entrada.addEventListener('input', atualizar);
          atualizar();
          caixa.appendChild(cont);
        }
        if (c.ajuda) caixa.appendChild(h('p', { class: 'ajuda' }, c.ajuda));
        const erroC = h('p', { class: 'erro-campo', hidden: true, role: 'alert' });
        caixa.appendChild(erroC);
        // mexeu no campo (ou escolheu um motivo rápido): o aviso de erro dele some até o próximo envio
        const limparErro = () => { erroC.hidden = true; if (entrada.setAttribute) entrada.setAttribute('aria-invalid', 'false'); };
        entrada.addEventListener('input', limparErro);
        entrada.addEventListener('change', limparErro);
        entradas[c.nome] = entrada;
        errosCampo[c.nome] = erroC;
        corpo.appendChild(caixa);
      });
      let entradaDigitar = null;
      const confere = (v) => (op.digitarLivre ? v.trim().toLowerCase() === String(op.digitar).trim().toLowerCase() : v.trim() === String(op.digitar).trim());
      if (op.digitar) {
        entradaDigitar = h('input', { type: 'text', id: 'campo-digitar' + sufixo, autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off' });
        corpo.appendChild(h('div', { class: 'campo confirmar-digitando' },
          h('label', { class: 'rotulo', for: 'campo-digitar' + sufixo }, 'Digite ', h('code', null, '«' + op.digitar + '»'), ' para confirmar'),
          entradaDigitar));
        errosCampo.confirma = h('p', { class: 'erro-campo', hidden: true, role: 'alert' });
        corpo.lastChild.appendChild(errosCampo.confirma);
      }
      const erroGeral = h('p', { class: 'dialogo-erro', role: 'alert', hidden: true });
      corpo.appendChild(erroGeral);
      form.appendChild(corpo);

      const pe = h('div', { class: 'dialogo-pe' });
      const cancelar = h('button', { type: 'button', class: 'botao-fantasma' }, op.soFechar ? 'Fechar' : (op.cancelar || 'Cancelar'));
      pe.appendChild(cancelar);
      let confirmar = null;
      if (!op.soFechar) {
        const tipoB = op.tipoBotao || (op.perigo ? 'perigo' : 'ouro');
        confirmar = h('button', { type: 'submit', class: 'botao-' + tipoB + (tipoB === 'perigo' ? ' cheio' : '') }, h('span', { class: 'rotulo-texto' }, op.botao || 'Confirmar'));
        if (op.gerundio) confirmar.dataset.gerundio = op.gerundio;
        pe.appendChild(confirmar);
      }
      if (op.extrasRodape) [].concat(op.extrasRodape).forEach((x) => pe.insertBefore(x, pe.firstChild));
      form.appendChild(pe);
      d.appendChild(form);

      const conferirDigitar = () => {
        if (confirmar && entradaDigitar) confirmar.disabled = !confere(entradaDigitar.value);
      };
      if (entradaDigitar) { entradaDigitar.addEventListener('input', conferirDigitar); conferirDigitar(); }

      function fim(valor) {
        if (terminado) return;
        terminado = true;
        const i = pilha.indexOf(controle);
        if (i >= 0) pilha.splice(i, 1);
        if (d.open) d.close();
        d.remove();
        if (antes && antes.isConnected && typeof antes.focus === 'function') antes.focus();
        resolver(valor);
      }
      function lerValores() {
        const v = {};
        let ok = true;
        (op.campos || []).forEach((c) => {
          const e = entradas[c.nome];
          let x = e.lerValor ? e.lerValor() : e.value;
          if (typeof x === 'string' && c.tipo !== 'senha') x = x.trim();
          let msg = null;
          if (c.tipo === 'numero') {
            if (x === '') x = null;
            else {
              const nn = Number(x);
              if (!Number.isInteger(nn)) msg = 'Use um número inteiro.';
              else if ((c.min !== undefined && nn < c.min) || (c.max !== undefined && nn > c.max)) msg = 'Use um número de ' + c.min + ' a ' + c.max + '.';
              x = nn;
            }
          }
          if (!msg && c.obrigatorio && (x === null || x === '')) msg = c.tipo === 'motivo' ? 'Escreva o motivo: ele fica no registro.' : 'Preencha este campo.';
          if (!msg && c.validar) msg = c.validar(x, v);
          errosCampo[c.nome].hidden = !msg;
          errosCampo[c.nome].textContent = msg || '';
          if (e.setAttribute) e.setAttribute('aria-invalid', msg ? 'true' : 'false');
          if (msg) ok = false;
          v[c.nome] = x;
          if (e.lerAviso) v[c.nome + 'Aviso'] = e.lerAviso();
        });
        if (entradaDigitar) v.confirma = entradaDigitar.value.trim();
        return ok ? v : null;
      }
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        if (trabalhando || !confirmar) return;
        if (entradaDigitar && !confere(entradaDigitar.value)) return;
        const v = lerValores();
        if (!v) {
          const errado = d.querySelector('[aria-invalid="true"]');
          if (errado && errado.focus) errado.focus();
          return;
        }
        if (!op.executar) { fim(v); return; }
        trabalhando = true;
        erroGeral.hidden = true;
        LP.ocupado(confirmar, true);
        cancelar.disabled = true;
        try {
          const r = await op.executar(v);
          fim(r === undefined ? v : r);
        } catch (e) {
          if (e && e.status === 401) { fim(null); return; }
          // o servidor diz qual campo: {chave} (config) ou o próprio código do erro (motivo, confirma, texto, senha…)
          const chave = e && e.json && typeof e.json.chave === 'string' ? e.json.chave : e && e.codigo;
          if (chave && errosCampo[chave]) {
            errosCampo[chave].hidden = false;
            errosCampo[chave].textContent = LP.mensagem(e);
            const ent = entradas[chave] || (chave === 'confirma' ? entradaDigitar : null);
            if (ent && ent.focus) ent.focus();
          } else {
            erroGeral.hidden = false;
            erroGeral.textContent = LP.mensagem(e);
          }
        } finally {
          trabalhando = false;
          if (!terminado) {
            LP.ocupado(confirmar, false);
            cancelar.disabled = false;
            conferirDigitar();
          }
        }
      });
      cancelar.addEventListener('click', () => { if (!trabalhando) fim(null); });
      fecharX.addEventListener('click', () => { if (!trabalhando) fim(null); });
      // Esc fecha (menos no meio de uma ação). Atribuição (não addEventListener): cada diálogo troca a do anterior.
      d.oncancel = (ev) => {
        ev.preventDefault();
        if (!trabalhando) fim(null);
      };
      d.onclose = () => { if (!terminado) fim(null); };
      const controle = { cancelar: () => fim(null) };
      pilha.push(controle);
      document.body.appendChild(d);
      d.showModal();
      const primeiro = op.campos && op.campos.length ? entradas[op.campos[0].nome] : entradaDigitar;
      if (primeiro && primeiro.focus && primeiro.tagName !== 'DIV' && primeiro.type !== 'checkbox') primeiro.focus();
      else if (confirmar && !op.perigo) confirmar.focus();
      else cancelar.focus();
    });
  };
  LP.dialogoAberto = () => pilha.length > 0;
  /** Fecha o diálogo de cima (todos: tudo = true, ex.: a sessão acabou). */
  LP.fecharDialogo = (tudo) => {
    if (tudo) { while (pilha.length) pilha[pilha.length - 1].cancelar(); return; }
    if (pilha.length) pilha[pilha.length - 1].cancelar();
  };
  /** confirm() nativo para o que é simples e reversível (dispensar alerta, mudar tipo). */
  LP.confirmar = (texto) => window.confirm(texto);
  /** Botão "mostrar" ao lado de um campo de senha. */
  LP.botaoMostrarSenha = function (entrada) {
    const b = h('button', { type: 'button', class: 'botao-fantasma botao-pequeno mostrar-senha', 'aria-label': 'Mostrar a senha', 'aria-pressed': 'false' }, 'mostrar');
    b.addEventListener('click', () => {
      const oculta = entrada.type === 'password';
      entrada.type = oculta ? 'text' : 'password';
      b.textContent = oculta ? 'ocultar' : 'mostrar';
      b.setAttribute('aria-pressed', String(oculta));
      b.setAttribute('aria-label', oculta ? 'Ocultar a senha' : 'Mostrar a senha');
      entrada.focus();
    });
    return b;
  };
  /** Força da senha (0–4) para a dica "fraca / boa / forte". */
  LP.forcaSenha = function (s) {
    let n = 0;
    s = String(s || '');
    if (s.length >= 12) n++;
    if (s.length >= 16) n++;
    if (/[^a-zA-Z0-9]/.test(s) || (/[a-z]/.test(s) && /[A-Z]/.test(s))) n++;
    if (/\d/.test(s) && s.length >= 12) n++;
    return Math.min(4, n);
  };

  /**
   * O diálogo das ações destrutivas (P0-4): título com o verbo, motivos rápidos em chips, contador N/200, e o botão
   * com o verbo e o número. o: {titulo, texto, botao, gerundio, obrigatorio (padrão true), avisar (mostra "Avisar o
   * autor"), perigo, executar({motivo, avisar, avisoMotivo})}.
   */
  LP.dialogoMotivo = function (o) {
    const campos = [{ nome: 'motivo', rotulo: o.rotuloMotivo || (o.obrigatorio === false ? 'Motivo (opcional, fica no registro)' : 'Motivo (fica no registro)'), tipo: 'motivo', obrigatorio: o.obrigatorio !== false, maxlength: 200, chips: o.chips }];
    if (o.avisar) campos.push({ nome: 'avisar', tipo: 'caixa', rotulo: 'Avisar o autor em Minha conta (texto padrão, sem o motivo escrito aqui)', valor: false,
      ajuda: 'Ele vê: "Uma carreira sua saiu do Hall público por: …" com o motivo do chip escolhido.' });
    return LP.dialogo({
      titulo: o.titulo, texto: o.texto, corpo: o.corpo, perigo: o.perigo, botao: o.botao, gerundio: o.gerundio, tipoBotao: o.tipoBotao,
      campos: campos,
      executar: (v) => o.executar({ motivo: v.motivo || null, avisar: !!v.avisar, avisoMotivo: v.motivoAviso || 'outro' }),
    });
  };

  // ── estados de carregando / vazio / erro ────────────────────────────────────────────────────
  LP.estadoCarregando = function (linhas) {
    const c = h('div', { class: 'estado estado-carregando', 'aria-busy': 'true', 'aria-label': 'Carregando' });
    for (let i = 0; i < (linhas || 4); i++) c.appendChild(h('span', { class: 'esqueleto' }));
    return c;
  };
  LP.estadoVazio = function (titulo, texto, acao) {
    return h('div', { class: 'estado' }, h('p', { class: 'estado-titulo' }, titulo), texto ? h('p', { class: 'texto-3' }, texto) : null, acao || null);
  };
  LP.estadoErro = function (erro, tentar) {
    const instalar = erro && erro.status === 503;
    const semPoder = erro && erro.status === 403 && erro.codigo === 'sem_poder';
    return h('div', { class: 'estado estado-erro', role: 'alert' },
      h('p', { class: 'estado-titulo' }, instalar ? 'Falta atualizar o banco' : semPoder ? 'O seu papel não abre esta parte' : 'Não deu para carregar'),
      h('p', { class: 'texto-3' }, LP.mensagem(erro)),
      tentar && !semPoder ? LP.botao('Tentar de novo', tentar, { icone: 'atualizar' }) : null);
  };

  // ── lista (tabela que vira cartões no celular e no painel lateral) ──────────────────────────
  /**
   * colunas: [{rotulo, celula(item) → nó|texto, num, classe, principal (no cartão vira o título), ordenar (chave),
   * acoes}], itens, aoClicar(item), ordem {chave, dir}, aoOrdenar(chave), rotuloLinha(item), chave(item) (id da linha:
   * data-id), classeLinha(item), selecao: {marcados: Set, aoMudar(), pode(item) → bool} (caixa por linha e no
   * cabeçalho), novos: Set de ids (fundo ouro por 0,9 s).
   */
  LP.lista = function (op) {
    op = Object.assign({}, op, { colunas: (op.colunas || []).filter(Boolean) });
    const t = h('table', { class: 'lista cartoes' + (op.classe ? ' ' + op.classe : '') + (op.selecao ? ' com-selecao' : '') });
    const cab = h('tr');
    const chave = op.chave || ((x) => x.id);
    const sel = op.selecao;
    let caixaTodos = null;
    const caixas = [];
    const sincronizarTodos = () => {
      if (!caixaTodos) return;
      const podem = caixas.filter((c) => !c.disabled);
      const n = podem.filter((c) => c.checked).length;
      caixaTodos.checked = podem.length > 0 && n === podem.length;
      caixaTodos.indeterminate = n > 0 && n < podem.length;
    };
    if (sel) {
      caixaTodos = h('input', { type: 'checkbox', 'aria-label': 'Marcar todos desta página' });
      caixaTodos.addEventListener('change', () => {
        caixas.forEach((c) => {
          if (c.disabled) return;
          c.checked = caixaTodos.checked;
          const id = c.dataset.id;
          if (c.checked) sel.marcados.add(id); else sel.marcados.delete(id);
          c.closest('tr').classList.toggle('marcada', c.checked);
        });
        if (sel.aoMudar) sel.aoMudar();
      });
      cab.appendChild(h('th', { class: 'selecao', scope: 'col' }, h('label', { class: 'alvo-caixa' }, caixaTodos)));
    }
    op.colunas.forEach((c) => {
      const th = h('th', { class: [c.num ? 'num' : '', c.acoes ? 'acoes' : '', c.ordenar ? 'ordenavel' : '', c.principal ? 'principal-th' : ''].join(' ').trim() || null, scope: 'col' });
      if (c.ordenar && op.aoOrdenar) {
        const ativo = op.ordem && op.ordem.chave === c.ordenar;
        th.setAttribute('aria-sort', ativo ? (op.ordem.dir === 'asc' ? 'ascending' : 'descending') : 'none');
        th.appendChild(h('button', { type: 'button', class: 'ordenar', onclick: () => op.aoOrdenar(c.ordenar) }, c.rotulo));
      } else {
        th.textContent = c.rotulo;
      }
      cab.appendChild(th);
    });
    t.appendChild(h('thead', null, cab));
    const corpo = h('tbody');
    op.itens.forEach((item) => {
      const id = String(chave(item));
      const tr = h('tr', { dataset: { id: id } });
      if (op.classeLinha) { const cl = op.classeLinha(item); if (cl) tr.className = cl; }
      if (op.novos && op.novos.has(id)) tr.classList.add('novo');
      if (op.aoClicar) {
        tr.classList.add('clicavel');
        tr.tabIndex = 0;
        if (op.rotuloLinha) tr.setAttribute('aria-label', op.rotuloLinha(item));
        tr.addEventListener('click', (ev) => {
          if (tr.classList.contains('resolvido')) return;
          if (ev.target instanceof Element && ev.target.closest('a, button, input, select, textarea, label, summary, details')) return;
          op.aoClicar(item, ev);
        });
        tr.addEventListener('keydown', (ev) => {
          if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === tr) { ev.preventDefault(); op.aoClicar(item, ev); }
        });
      }
      if (sel) {
        const pode = sel.pode ? sel.pode(item) : true;
        const c = h('input', { type: 'checkbox', 'aria-label': 'Marcar ' + (op.rotuloLinha ? op.rotuloLinha(item).replace(/^Abrir /, '') : 'item'), disabled: !pode, dataset: { id: id } });
        c.checked = pode && sel.marcados.has(id);
        if (c.checked) tr.classList.add('marcada');
        c.addEventListener('change', () => {
          if (c.checked) sel.marcados.add(id); else sel.marcados.delete(id);
          tr.classList.toggle('marcada', c.checked);
          sincronizarTodos();
          if (sel.aoMudar) sel.aoMudar();
        });
        caixas.push(c);
        tr.appendChild(h('td', { class: 'selecao', 'data-rotulo': 'Marcar' }, h('label', { class: 'alvo-caixa' }, c)));
      }
      op.colunas.forEach((c) => {
        const td = h('td', { class: [c.num ? 'num' : '', c.acoes ? 'acoes' : '', c.principal ? 'principal-celula' : '', c.classe || ''].join(' ').trim() || null, 'data-rotulo': c.rotulo });
        const v = c.celula(item);
        if (c.acoes) {
          const caixa = h('div', { class: 'botoes' });
          anexar(caixa, v);
          if (caixa.childNodes.length) td.appendChild(caixa);
        } else {
          anexar(td, v === undefined || v === null || v === '' ? (c.num ? '—' : '') : v);
        }
        tr.appendChild(td);
      });
      corpo.appendChild(tr);
    });
    t.appendChild(corpo);
    sincronizarTodos();
    const caixa = h('div', { class: 'rolagem' }, t);
    caixa.sincronizarSelecao = () => {
      caixas.forEach((c) => { c.checked = !c.disabled && sel.marcados.has(c.dataset.id); c.closest('tr').classList.toggle('marcada', c.checked); });
      sincronizarTodos();
    };
    return caixa;
  };

  /** Paginação numérica: primeira, última, 2 vizinhas, reticências, aria-current, aria-disabled nas pontas. */
  LP.paginacao = function (total, pagina, porPagina, ir) {
    const pp = porPagina || 50;
    const paginas = Math.max(1, Math.ceil((total || 0) / pp));
    const p = Math.min(Math.max(1, pagina || 1), paginas);
    const de = total ? (p - 1) * pp + 1 : 0;
    const ate = Math.min(total, p * pp);
    const caixa = h('nav', { class: 'paginacao', 'aria-label': 'Páginas' },
      h('span', { class: 'paginacao-total' }, total ? 'Mostrando ' + LP.inteiro(de) + '–' + LP.inteiro(ate) + ' de ' + LP.inteiro(total) : 'Nenhum resultado'));
    if (paginas > 1) {
      const lista = h('div', { class: 'paginas' });
      const botao = (rot, alvo, extra) => {
        const b = h('button', { type: 'button', class: 'pagina' + (extra && extra.classe ? ' ' + extra.classe : ''), 'aria-label': extra && extra.rotulo });
        b.textContent = rot;
        if (alvo === null) { b.setAttribute('aria-disabled', 'true'); b.disabled = true; } else if (alvo === p && !(extra && extra.seta)) { b.setAttribute('aria-current', 'page'); } else b.addEventListener('click', () => ir(alvo));
        return b;
      };
      lista.appendChild(botao('‹', p > 1 ? p - 1 : null, { seta: true, rotulo: 'Página anterior', classe: 'pagina-seta' }));
      const mostrar = new Set([1, paginas, p - 2, p - 1, p, p + 1, p + 2].filter((x) => x >= 1 && x <= paginas));
      let ultimo = 0;
      Array.from(mostrar).sort((a, b) => a - b).forEach((x) => {
        if (x - ultimo > 1) lista.appendChild(h('span', { class: 'reticencias', 'aria-hidden': 'true' }, '…'));
        lista.appendChild(botao(LP.inteiro(x), x, { rotulo: 'Página ' + x }));
        ultimo = x;
      });
      lista.appendChild(botao('›', p < paginas ? p + 1 : null, { seta: true, rotulo: 'Próxima página', classe: 'pagina-seta' }));
      caixa.appendChild(lista);
    }
    return caixa;
  };

  /** Chips de filtro (um valor só). opcoes: [{valor, rotulo, contador, tipoContador ('alerta'|'perigo'|'ok'), title}]. */
  LP.segmentos = function (rotulo, opcoes, atual, aoEscolher) {
    const g = h('div', { class: 'segmentos', role: 'group', 'aria-label': rotulo });
    g._aoEscolher = aoEscolher;
    g._valores = opcoes.map((o) => String(o.valor)).join('\u0001');
    opcoes.forEach((o) => {
      const b = h('button', { type: 'button', 'aria-pressed': String(o.valor === atual), title: o.title, dataset: { valor: o.valor } }, o.rotulo);
      if (o.contador) b.appendChild(h('span', { class: 'contador' + (o.tipoContador ? ' contador-' + o.tipoContador : '') }, LP.inteiro(o.contador)));
      b.addEventListener('click', () => g._aoEscolher(o.valor));
      g.appendChild(b);
    });
    return g;
  };
  /**
   * Os mesmos chips, atualizados no lugar (pulso, resumo, clique): com os mesmos valores, só o aria-pressed e o texto dos
   * contadores mudam — o botão continua o mesmo e o foco do teclado não se perde. Valores diferentes: desenha de novo.
   */
  LP.trocarSegmentos = function (caixa, rotulo, opcoes, atual, aoEscolher) {
    if (!caixa) return null;
    const g = caixa.firstElementChild;
    if (!g || caixa.children.length !== 1 || !g.classList.contains('segmentos') || g._valores !== opcoes.map((o) => String(o.valor)).join('\u0001')) {
      const novo = LP.segmentos(rotulo, opcoes, atual, aoEscolher);
      LP.trocar(caixa, novo);
      return novo;
    }
    g._aoEscolher = aoEscolher;
    Array.from(g.children).forEach((b, i) => {
      const o = opcoes[i];
      b.setAttribute('aria-pressed', String(o.valor === atual));
      if (o.title) b.title = o.title;
      let c = b.querySelector('.contador');
      if (o.contador) {
        if (!c) { c = h('span'); b.appendChild(c); }
        c.className = 'contador' + (o.tipoContador ? ' contador-' + o.tipoContador : '');
        c.textContent = LP.inteiro(o.contador);
      } else if (c) {
        c.remove();
      }
    });
    return g;
  };
  /**
   * Antes de redesenhar uma parte da tela sozinho (pulso, resumo): guarda onde está o foco do teclado (a linha pelo
   * data-id, o chip pelo data-valor, o elemento pelo data-foco) e devolve uma função que o põe de volta no equivalente
   * novo — só se o foco se perdeu no redesenho (foi para o BODY).
   */
  LP.guardarFoco = function (raiz) {
    const a = document.activeElement;
    if (!raiz || !a || a === document.body || !raiz.contains(a)) return () => {};
    const FOCAVEIS = 'a[href], button, input, select, textarea, summary, [tabindex]';
    const marca = a.closest('[data-foco]');
    const linha = a.closest('[data-id]:not(input)');
    const chave = marca && raiz.contains(marca) ? ['data-foco', marca.dataset.foco, marca]
      : linha && raiz.contains(linha) ? ['data-id', linha.dataset.id, linha]
        : a.dataset && a.dataset.valor !== undefined ? ['data-valor', a.dataset.valor, a] : null;
    if (!chave) return () => {};
    const dentro = chave[2] === a ? -1 : Array.from(chave[2].querySelectorAll(FOCAVEIS)).indexOf(a);
    return () => {
      const agora = document.activeElement;
      if (agora && agora !== document.body && agora.isConnected) return;
      const novo = raiz.querySelector('[' + chave[0] + '="' + CSS.escape(chave[1]) + '"]:not(input)') || raiz.querySelector('[' + chave[0] + '="' + CSS.escape(chave[1]) + '"]');
      if (!novo) return;
      const alvo = dentro >= 0 ? novo.querySelectorAll(FOCAVEIS)[dentro] || novo : novo;
      if (alvo && typeof alvo.focus === 'function') alvo.focus({ preventScroll: true });
    };
  };
  /**
   * Busca ao vivo (atalho "/"): debounce de 300 ms, a partir de 2 letras (1 dígito para #id), o estado em versalete
   * ao lado ("DIGITE 2+ LETRAS / BUSCANDO… / N ENCONTRADAS"), o campo nunca é redesenhado (quem chama não recria).
   * aoMudar(texto) só é chamado com um texto que vale (ou vazio, para limpar). Devolve o nó, com .estado(txt).
   */
  LP.busca = function (placeholder, valor, aoMudar, opcoes) {
    const o = opcoes || {};
    const min = o.min === undefined ? 2 : o.min;
    const i = h('input', { type: 'search', placeholder: placeholder, 'aria-label': placeholder, 'data-busca': '1', autocomplete: 'off', spellcheck: 'false', maxlength: o.maxlength || 100, enterkeyhint: 'search' });
    i.value = valor || '';
    const estado = h('span', { class: 'busca-estado', 'aria-live': 'polite' });
    const vale = (v) => v === '' || v.length >= min || /^#?\d+$/.test(v);
    let ultimo = (valor || '').trim();
    const disparar = (v) => {
      if (!vale(v)) { estado.textContent = 'digite ' + min + '+ letras'; return; }
      if (v === ultimo && !o.sempre) return;
      ultimo = v;
      estado.textContent = v ? 'buscando…' : '';
      aoMudar(v);
    };
    const atrasado = LP.debounce((v) => disparar(v), o.ms || 300);
    i.addEventListener('input', () => {
      const v = i.value.trim();
      if (!vale(v)) { atrasado.cancelar(); estado.textContent = 'digite ' + min + '+ letras'; return; }
      atrasado(v);
    });
    i.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); atrasado.cancelar(); disparar(i.value.trim()); }
      if (ev.key === 'Escape' && i.value) { ev.preventDefault(); ev.stopPropagation(); i.value = ''; atrasado.cancelar(); disparar(''); }
    });
    const caixa = h('div', { class: 'busca' }, LP.icone('busca'), i, h('kbd', { 'aria-hidden': 'true' }, '/'), estado);
    caixa.estado = (t) => { estado.textContent = t || ''; };
    caixa.entrada = i;
    return caixa;
  };
  LP.selecao = function (rotulo, opcoes, atual, aoMudar) {
    const s = h('select', { 'aria-label': rotulo });
    opcoes.forEach((o) => s.appendChild(h('option', { value: o.valor, selected: o.valor === atual }, o.rotulo)));
    s.addEventListener('change', () => aoMudar(s.value));
    return h('label', { class: 'rotulo-inline' }, h('span', null, rotulo), s);
  };
  /** Caixa ⓘ com a frase de ajuda da seção. */
  LP.ajuda = (texto) => h('p', { class: 'caixa-ajuda' }, h('span', { class: 'caixa-ajuda-i', 'aria-hidden': 'true' }, 'i'), h('span', null, texto));

  // ── lote (P0-3): barra "EM LOTE" ─────────────────────────────────────────────────────────────
  /**
   * Barra das ações em lote de uma lista. o: {itens (da página), marcados (Set de ids em texto), chave(item),
   * aoMudar() (redesenhar as caixas), acoes: [{rotulo(n), tipo, executar(ids, itens) → Promise}], nome: ['carreira',
   * 'carreiras']}. Devolve {no, atualizar()}. Fica fixa no rodapé no celular (com a área segura do aparelho).
   */
  LP.barraLote = function (o) {
    const chave = o.chave || ((x) => String(x.id));
    const no = h('div', { class: 'barra-lote', role: 'region', 'aria-label': 'Ações em lote' });
    const atualizar = () => {
      const itens = (o.itens() || []).filter((x) => !o.pode || o.pode(x));
      const marcados = o.marcados;
      // marcados que não estão mais na lista saem da seleção (a seleção sobrevive à atualização ao vivo, por id)
      const ids = new Set(itens.map((x) => String(chave(x))));
      Array.from(marcados).forEach((id) => { if (!ids.has(id)) marcados.delete(id); });
      const seguros = itens.filter((x) => x.seguro !== false);
      const comAlerta = itens.filter((x) => x.seguro === false);
      const n = marcados.size;
      const [um, varios, genero] = o.nome || ['item', 'itens', 'm'];
      const art = genero === 'f' ? 'as' : 'os';
      const marc = genero === 'f' ? ['marcada', 'marcadas'] : ['marcado', 'marcados'];
      const btnSeguros = LP.botao('Marcar ' + art + ' ' + LP.inteiro(seguros.length) + ' sem alerta', () => {
        marcados.clear();
        seguros.forEach((x) => marcados.add(String(chave(x))));
        o.aoMudar();
        atualizar();
      }, { tipo: 'fantasma', pequeno: true, disabled: !seguros.length, classe: 'marcar-varios' });
      const btnTodos = comAlerta.length ? LP.botao('Marcar ' + (genero === 'f' ? 'todas' : 'todos') + ', inclusive ' + art + ' ' + LP.inteiro(comAlerta.length) + ' com alerta', () => {
        const graves = [];
        comAlerta.forEach((x) => (x.sinais || []).filter((s) => s.nivel === 'grave').forEach((s) => graves.push('· ' + (o.rotulo ? o.rotulo(x) + ': ' : '') + s.texto)));
        if (!LP.confirmar('Marcar também ' + LP.plural(comAlerta.length, um + ' com alerta grave', varios + ' com alerta grave') + '?\n\n' + graves.slice(0, 12).join('\n') + (graves.length > 12 ? '\n…' : ''))) return;
        itens.forEach((x) => marcados.add(String(chave(x))));
        o.aoMudar();
        atualizar();
      }, { tipo: 'fantasma', pequeno: true, classe: 'marcar-varios' }) : null;
      const btnDesmarcar = LP.botao('Desmarcar', () => { marcados.clear(); o.aoMudar(); atualizar(); }, { tipo: 'fantasma', pequeno: true, disabled: !n, classe: 'so-com-marcados' });
      const acoes = (o.acoes || []).map((a) => {
        const b = LP.botao(a.rotulo(n), async (ev, botao) => {
          const sel = itens.filter((x) => marcados.has(String(chave(x))));
          if (!sel.length) return;
          await a.executar(sel.map((x) => chave(x)), sel, botao);
        }, { tipo: a.tipo || 'fantasma', pequeno: true, disabled: !n, icone: a.icone });
        return b;
      });
      LP.trocar(no,
        h('span', { class: 'barra-lote-titulo' }, h('b', null, 'Em lote'), h('span', { class: 'texto-3', 'aria-live': 'polite' }, n ? LP.plural(n, um + ' ' + marc[0], varios + ' ' + marc[1]) : 'nada marcado')),
        h('div', { class: 'botoes' }, btnSeguros, btnTodos, btnDesmarcar),
        h('div', { class: 'botoes barra-lote-acoes' }, acoes));
      no.classList.toggle('com-marcados', n > 0);
      document.body.classList.toggle('com-lote', n > 0 && no.isConnected);
    };
    return { no: no, atualizar: atualizar };
  };
  /** Resumo do lote para o toast: "7 ocultadas · 2 puladas (já estavam ocultas)". */
  LP.resumoLote = function (feitos, pulados, verbos, motivosPulo) {
    const [um, varios] = verbos;
    const partes = [LP.plural(feitos, um, varios)];
    const p = Array.isArray(pulados) ? pulados : [];
    if (p.length) {
      const por = {};
      p.forEach((x) => { por[x.motivo] = (por[x.motivo] || 0) + 1; });
      partes.push(LP.plural(p.length, 'pulada', 'puladas') + ' (' + Object.keys(por).map((k) => (motivosPulo && motivosPulo[k] ? motivosPulo[k] : k) + (Object.keys(por).length > 1 ? ': ' + por[k] : '')).join(', ') + ')');
    }
    return partes.join(' · ');
  };
  /** As linhas feitas somem com fade (e depois saem). */
  LP.sumirLinhas = function (raiz, ids, depois) {
    const set = new Set(ids.map(String));
    let algum = false;
    raiz.querySelectorAll('[data-id]').forEach((tr) => { if (set.has(tr.dataset.id)) { tr.classList.add('saindo'); algum = true; } });
    setTimeout(() => { if (depois) depois(); }, algum && !calmo() ? 450 : 0);
  };

  // ── fila ao vivo (P1-13): não atrapalhar quem está trabalhando ───────────────────────────────
  /** Está "ocupado"? (caixa marcada, campo em foco, diálogo ou painel lateral aberto): nada se redesenha sozinho. */
  LP.ocupadoAgora = function (raiz, marcados) {
    if (marcados && marcados.size) return true;
    if (LP.dialogoAberto()) return true;
    const a = document.activeElement;
    if (a && raiz && raiz.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return true;
    return false;
  };
  /**
   * Compara a lista nova com a da tela. o: {raiz (onde estão as linhas [data-id]), antes: [ids], depois: [ids],
   * marcados, redesenhar(novos: Set), rotuloNovos(n) → texto do aviso}. Ocupado: as linhas que saíram ficam apagadas
   * ("Resolvido em outra aba") e somem em 4 s, e um aviso flutuante chama para ver as novas. Livre: redesenha no lugar
   * (rolagem guardada), com as novas em fundo ouro.
   */
  /** A marca (md5) da fila `nome` no último pulso, ou null antes do primeiro: a lista guarda esta ao carregar. */
  LP.filaDoPulso = (nome) => (nome && LP.agora && LP.agora.filas && LP.agora.filas[nome]) || null;
  /**
   * O que esta aba acabou de decidir (por tipo: 'carreira' = pk da carreira, 'indicacao' = id da indicação), por 60 s:
   * o pulso que a própria ação pede chega antes da lista ser refeita, e essas linhas não são "resolvidas em outra aba".
   */
  const feitosAqui = {};
  LP.marcarFeitos = function (tipo, ids) {
    const m = feitosAqui[tipo] || (feitosAqui[tipo] = new Map());
    const ate = Date.now() + 60000;
    (ids || []).forEach((id) => m.set(String(id), ate));
  };
  LP.feitosAqui = function (tipo) {
    const s = new Set();
    const m = feitosAqui[tipo];
    if (!m) return s;
    const t = Date.now();
    m.forEach((ate, id) => { if (ate < t) m.delete(id); else s.add(id); });
    return s;
  };
  /**
   * o (além do de cima): tipo (o dos feitos desta aba), recarregar(novos) (busca a lista de novo e desenha com as novas
   * em ouro: o clique no aviso e o fim dos 4 s nunca desenham uma resposta guardada, que pode estar velha).
   */
  LP.atualizarFila = function (o) {
    const antes = new Set(o.antes.map(String));
    const depois = new Set(o.depois.map(String));
    const meus = LP.feitosAqui(o.tipo);
    const novos = new Set(Array.from(depois).filter((x) => !antes.has(x)));
    const sairam = Array.from(antes).filter((x) => !depois.has(x) && !meus.has(x));
    const deNovo = (nv) => (o.recarregar ? o.recarregar(nv) : o.redesenhar(nv));
    const avisarNovos = () => { if (novos.size) LP.novidade(o.rotuloNovos(novos.size), () => deNovo(novos)); };
    const marcarResolvidas = () => {
      sairam.forEach((id) => {
        // a linha ou o cartão (a caixa de marcar também tem data-id: o selo não vai para dentro dela)
        o.raiz.querySelectorAll('[data-id="' + CSS.escape(id) + '"]:not(input)').forEach((tr) => {
          if (tr.classList.contains('resolvido')) return;
          tr.classList.add('resolvido');
          tr.setAttribute('aria-disabled', 'true');
          tr.querySelectorAll('button, input, a').forEach((x) => { x.disabled = true; x.tabIndex = -1; });
          const alvo = tr.querySelector('.principal-celula, td:not(.selecao)') || tr;
          alvo.appendChild(h('span', { class: 'selo-resolvido' }, 'Resolvido em outra aba'));
          if (o.marcados) o.marcados.delete(id);
          setTimeout(() => { if (tr.isConnected) tr.remove(); }, 4000);
        });
      });
      if (sairam.length) LP.avisar(LP.plural(sairam.length, 'item resolvido', 'itens resolvidos') + ' em outra aba ou aparelho.', 'info', 5000);
    };
    if (!novos.size && !sairam.length) return;
    if (LP.ocupadoAgora(o.raiz, o.marcados)) {
      marcarResolvidas();
      avisarNovos();
      if (o.aoMudarSelecao) o.aoMudarSelecao();
      return;
    }
    if (sairam.length) {
      marcarResolvidas();
      // 4 s depois: confere de novo (o admin pode ter começado a trabalhar) e busca a lista de agora
      setTimeout(() => {
        if (!LP.visivel(o.raiz)) return;
        if (LP.ocupadoAgora(o.raiz, o.marcados)) { avisarNovos(); return; }
        deNovo(novos);
      }, 4000);
    } else {
      // a resposta acabou de chegar: desenha com ela (quem desenha guarda a rolagem na hora de trocar)
      o.redesenhar(novos);
    }
  };
  /**
   * Aviso flutuante clicável ("3 denúncias novas — clique para ver"), um por origem: 'fila' (a lista da aba aberta;
   * some ao trocar de aba ou quando a lista é refeita) e 'recados' (da equipe). Um não troca o outro.
   */
  LP.novidade = function (texto, aoClicar, origem) {
    const caixa = LP.$('novidade');
    if (!caixa) return;
    const de = origem || 'fila';
    const velho = caixa.querySelector('[data-origem="' + de + '"]');
    const item = h('div', { class: 'novidade-item', dataset: { origem: de } });
    const tirar = () => { item.remove(); caixa.hidden = !caixa.firstChild; };
    LP.trocar(item, h('button', { type: 'button', class: 'novidade-botao', onclick: () => { tirar(); aoClicar(); } }, LP.icone('sino'), h('span', null, texto)),
      h('button', { type: 'button', class: 'novidade-fechar', 'aria-label': 'Dispensar', onclick: tirar }, '×'));
    if (velho) caixa.replaceChild(item, velho); else caixa.appendChild(item);
    caixa.hidden = false;
  };
  /** Tira o aviso de uma origem (padrão: 'fila'; 'todas' tira tudo). */
  LP.esconderNovidade = (origem) => {
    const c = LP.$('novidade');
    if (!c) return;
    if (origem === 'todas') LP.limpar(c);
    else { const x = c.querySelector('[data-origem="' + (origem || 'fila') + '"]'); if (x) x.remove(); }
    c.hidden = !c.firstChild;
  };
  /** Troca o conteúdo de uma lista viva sem a tela pular: a rolagem de agora (não a de 4 s atrás) fica onde estava. */
  LP.trocarNoLugar = function (no) {
    const y = window.scrollY;
    const foco = LP.guardarFoco(no);
    LP.trocar.apply(null, arguments);
    if (window.scrollY !== y) window.scrollTo(0, y);
    foco();
    return no;
  };

  // ── rota (hash): #/aba?chave=valor (+ conta=<id> ou carreira=<pk>: o painel lateral) ─────────
  const PARAMS_GAVETA = ['conta', 'carreira'];
  LP.PARAMS_GAVETA = PARAMS_GAVETA;
  LP.rota = function () {
    const bruto = location.hash.replace(/^#\/?/, '');
    const i = bruto.indexOf('?');
    const caminho = i >= 0 ? bruto.slice(0, i) : bruto;
    const q = i >= 0 ? bruto.slice(i + 1) : '';
    const partes = caminho.split('/').filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch (e) { return p; } });
    const query = {};
    new URLSearchParams(q).forEach((v, k) => { query[k] = v; });
    return { aba: partes[0] || 'visao', partes: partes, query: query };
  };
  LP.hash = function (caminho, query) {
    const q = new URLSearchParams();
    for (const k in query || {}) {
      const v = query[k];
      if (v !== undefined && v !== null && v !== '' && v !== false) q.set(k, String(v));
    }
    const s = q.toString();
    return '#/' + caminho + (s ? '?' + s : '');
  };
  /** O hash da aba sem os parâmetros do painel lateral (para saber se a aba mudou ou só a ficha). */
  LP.hashBase = function (hash) {
    const bruto = String(hash || '').replace(/^#\/?/, '');
    const i = bruto.indexOf('?');
    if (i < 0) return '#/' + bruto;
    const q = new URLSearchParams(bruto.slice(i + 1));
    PARAMS_GAVETA.forEach((k) => q.delete(k));
    q.delete('de');
    const s = q.toString();
    return '#/' + bruto.slice(0, i) + (s ? '?' + s : '');
  };
  /** Troca a query da aba atual sem remontar (substitui no histórico), mantendo o painel lateral aberto. */
  LP.trocarQuery = function (caminho, query) {
    const r = LP.rota();
    if (r.aba !== caminho) return; // resposta atrasada de uma aba que já foi trocada
    const q = Object.assign({}, query);
    PARAMS_GAVETA.forEach((k) => { if (r.query[k]) q[k] = r.query[k]; });
    const novo = LP.hash(caminho, q);
    if (location.hash !== novo) {
      history.replaceState(null, '', novo);
      // o painel passa a saber que a aba está neste endereço: "Limpar filtros" (#/aba sem nada) remonta a aba
      if (typeof LP.aoTrocarQuery === 'function') LP.aoTrocarQuery();
    }
  };
  /** O nó está na aba que aparece agora? (respostas atrasadas de outra aba não desenham nem mexem no título) */
  LP.visivel = (no) => !!no && no.isConnected && !no.closest('.aba[hidden]');
  /** Hash que abre a ficha de uma conta por cima da aba atual. */
  LP.hashGaveta = function (tipo, id) {
    const r = LP.rota();
    const q = Object.assign({}, r.query);
    PARAMS_GAVETA.forEach((k) => delete q[k]);
    q[tipo] = id;
    return LP.hash(r.partes.join('/') || 'visao', q);
  };
  LP.usuarioHash = (id) => LP.hashGaveta('conta', id);
  LP.abrirConta = (id) => { location.hash = LP.hashGaveta('conta', id); };
  LP.abrirCarreira = (pk) => { location.hash = LP.hashGaveta('carreira', pk); };
  /** Link para a ficha de uma conta (apelido), aberta no painel lateral. */
  LP.linkUsuario = function (u, extra) {
    if (!u || !u.id) return h('span', { class: 'texto-3' }, extra || 'conta excluída');
    const a = h('a', { href: LP.usuarioHash(u.id), class: 'link-discreto', title: 'Abrir a ficha de #' + u.id }, u.apelido || '#' + u.id);
    a.addEventListener('click', (ev) => { ev.stopPropagation(); ev.preventDefault(); LP.abrirConta(u.id); });
    return a;
  };
  LP.linkCarreira = function (pk, texto) {
    const a = h('a', { href: LP.hashGaveta('carreira', pk), class: 'link-discreto' }, texto);
    a.addEventListener('click', (ev) => { ev.stopPropagation(); ev.preventDefault(); LP.abrirCarreira(pk); });
    return a;
  };
  /** X4: "Abrir no jogo" — o jogo lê a carreira pelo admin.php (só com a sessão do painel), mesmo oculta/suspeita. */
  LP.linkAbrirNoJogo = (pk, opcoes) => LP.linkJogo('Abrir no jogo', '#/resumo?id=' + encodeURIComponent(pk) + '&de=admin',
    Object.assign({ tipo: 'fantasma', title: 'Abre esta carreira no Resumo do jogo (outra aba), mesmo oculta ou suspeita' }, opcoes || {}));

  // ── painel lateral (ficha da conta / da carreira) ───────────────────────────────────────────
  // Um só, por cima da aba: 420–560 px à direita no computador, tela cheia no celular. Aberto pelo hash (conta= ou
  // carreira=), então recarregar volta para a mesma ficha. Esc fecha; o foco volta para onde estava.
  const gav = { aberta: null, foco: null, conteudo: null };
  LP.gaveta = {
    /** Abre com um título e devolve o nó do corpo (quem chama desenha dentro). */
    abrir: function (tipo, id, titulo) {
      const g = LP.$('gaveta');
      if (!g) return null;
      if (!gav.aberta) gav.foco = document.activeElement;
      gav.aberta = { tipo: tipo, id: String(id) };
      const corpo = h('div', { class: 'gaveta-corpo' });
      const voltar = h('button', { type: 'button', class: 'gaveta-voltar' }, LP.icone('voltar'), h('span', null, 'Voltar para ' + (LP.tituloAbaAtual ? LP.tituloAbaAtual() : 'a lista')));
      voltar.addEventListener('click', () => LP.gaveta.fechar());
      const x = h('button', { type: 'button', class: 'botao-icone', 'aria-label': 'Fechar a ficha' }, LP.icone('x'));
      x.addEventListener('click', () => LP.gaveta.fechar());
      LP.trocar(g, h('div', { class: 'gaveta-cabeca' }, voltar, h('h2', { id: 'gaveta-titulo', class: 'gaveta-titulo' }, titulo || ''), x), corpo);
      g.hidden = false;
      g.setAttribute('aria-labelledby', 'gaveta-titulo');
      document.body.classList.add('com-gaveta');
      gav.conteudo = corpo;
      requestAnimationFrame(() => { if (!g.contains(document.activeElement)) voltar.focus(); });
      return corpo;
    },
    titulo: function (t) { const e = LP.$('gaveta-titulo'); if (e) e.textContent = t || ''; },
    aberta: () => gav.aberta,
    corpo: () => gav.conteudo,
    /** Fecha (tira conta=/carreira= do hash; a aba de baixo fica como estava). */
    fechar: function () {
      const r = LP.rota();
      if (PARAMS_GAVETA.some((k) => r.query[k])) {
        const q = Object.assign({}, r.query);
        PARAMS_GAVETA.forEach((k) => delete q[k]);
        delete q.de;
        location.hash = LP.hash(r.partes.join('/') || 'visao', q);
        return;
      }
      LP.gaveta.esconder();
    },
    esconder: function () {
      const g = LP.$('gaveta');
      if (!g || g.hidden) { gav.aberta = null; return; }
      g.hidden = true;
      LP.limpar(g);
      gav.aberta = null;
      gav.conteudo = null;
      document.body.classList.remove('com-gaveta');
      if (gav.foco && gav.foco.isConnected && gav.foco.focus) gav.foco.focus();
      gav.foco = null;
    },
  };
})();
