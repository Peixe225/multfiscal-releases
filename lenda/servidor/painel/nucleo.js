/* LENDA · painel do administrador — núcleo: formatação, DOM, rede, avisos, diálogos, listas e paginação.
 * Os outros arquivos (visao.js, usuarios.js, moderacao.js, sistema.js, painel.js) usam o que fica em window.LP.
 * Regra da casa: todo texto vindo do servidor entra por textContent / createElement — nunca innerHTML. */
'use strict';

(function () {
  const LP = (window.LP = window.LP || {});
  LP.abas = LP.abas || {};

  const API_PAINEL = '../api/painel.php';
  const API_ADMIN = '../api/admin.php';
  const FUSO_MS = 3 * 3600 * 1000; // America/Sao_Paulo = UTC-3 fixo
  const SVG_NS = 'http://www.w3.org/2000/svg';
  LP.FUSO_MS = FUSO_MS;
  LP.API_ADMIN = API_ADMIN;
  LP.$ = (id) => document.getElementById(id);

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
  LP.minutos = function (min) {
    min = Math.round(Number(min) || 0);
    if (min < 60) return min + ' min';
    const h = Math.floor(min / 60);
    const r = min % 60;
    return r ? h + ' h ' + r + ' min' : h + ' h';
  };
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
    return new Date(t).getUTCFullYear() === new Date().getUTCFullYear() ? LP.dataHora(iso) : LP.dataHoraAno(iso);
  };
  LP.hojeSp = () => new Date(Date.now() - FUSO_MS).toISOString().slice(0, 10);
  LP.diasAntes = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') - n * 86400000).toISOString().slice(0, 10);

  // ── nomes ───────────────────────────────────────────────────────────────────────────────────
  LP.NOMES_MODO = { classico: 'Clássico', imersivo: 'Imersivo', live: 'Live' };
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
  LP.NOMES_EVENTO = {
    view: 'Abriu tela', jogo_inicio: 'Começou um jogo', jogo_fim: 'Terminou um jogo', partida_fim: 'Partida no Imersivo',
    gate_ver: 'Viu o convite de conta', gate_fechar: 'Fechou o convite', cadastro: 'Criou a conta', login: 'Entrou',
    logout: 'Saiu', compartilhar: 'Compartilhou',
  };
  LP.NOMES_ACAO_LOG = {
    suspender: 'Suspendeu conta', reativar: 'Reativou conta', deslogar: 'Deslogou', renomear: 'Renomeou',
    excluir_usuario: 'Excluiu conta', dar_bonus: 'Deu bônus', tirar_bonus: 'Tirou bônus', recusar_indicacao: 'Recusou indicação',
    ocultar_carreira: 'Ocultou carreira', mostrar_carreira: 'Mostrou / liberou carreira', apagar_carreira: 'Apagou carreira',
    atualizar_hall: 'Atualizou o Hall', resolver_denuncia: 'Resolveu denúncia', config: 'Mudou configurações', exportar: 'Exportou usuários',
  };
  LP.origem = (o) => LP.NOMES_ORIGEM[o] || o || '—';
  /** Para tabelas: "Direto" no lugar de "Direto (link ou digitado)". */
  LP.origemCurta = (o) => (o === 'direto' ? 'Direto' : LP.origem(o));
  LP.aparelho = (a) => LP.NOMES_APARELHO[a] || a || '—';

  /** Nomes de clubes, países, troféus, prêmios e conquistas (nomes.json, gerado dos dados do jogo). Falhou: mapas vazios. */
  let nomesPromessa = null;
  LP.nomes = function () {
    if (!nomesPromessa) {
      nomesPromessa = fetch('nomes.json?v=3.0.0', { credentials: 'same-origin' })
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
  /** h('div', {class, text, title, onclick, ...atributos}, ...filhos). Filhos texto viram nós de texto. */
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
        else e.setAttribute(k, v === true ? '' : String(v));
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
  };
  /** Ícone SVG (traço, 16px pelo CSS). */
  LP.icone = function (nome) {
    const s = LP.svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', class: 'icone' });
    (ICONES[nome] || []).forEach((d) => s.appendChild(LP.svg('path', { d: d })));
    return s;
  };
  /** Botão com ícone opcional. tipo: '' | 'fantasma' | 'ouro' | 'perigo' | 'ok'; pequeno: true. */
  LP.botao = function (texto, aoClicar, opcoes) {
    const o = opcoes || {};
    const cls = (o.tipo ? 'botao-' + o.tipo : 'botao') + (o.pequeno ? ' botao-pequeno' : '') + (o.compacto ? ' botao-compacto' : '') + (o.classe ? ' ' + o.classe : '');
    const b = h('button', { type: o.submit ? 'submit' : 'button', class: cls, title: o.title || (o.compacto ? texto : undefined), 'aria-label': o.rotulo, disabled: o.disabled });
    if (o.icone) b.appendChild(LP.icone(o.icone));
    if (texto) b.appendChild(h('span', { class: o.compacto ? 'rotulo-btn' : null }, texto));
    if (aoClicar) b.addEventListener('click', (ev) => { ev.stopPropagation(); aoClicar(ev, b); });
    return b;
  };
  /** Link para o jogo (outra aba). caminho: '#/live', '#/resumo?id=…'. */
  LP.linkJogo = function (texto, hash, opcoes) {
    const o = opcoes || {};
    const a = h('a', { href: '../' + hash, target: '_blank', rel: 'noopener', class: (o.tipo ? 'botao-' + o.tipo : 'botao') + (o.pequeno ? ' botao-pequeno' : '') + (o.compacto ? ' botao-compacto' : ''), title: o.title || (o.compacto ? texto : undefined) });
    if (o.icone !== false) a.appendChild(LP.icone(o.icone || 'externo'));
    a.appendChild(h('span', { class: o.compacto ? 'rotulo-btn' : null }, texto));
    a.addEventListener('click', (ev) => ev.stopPropagation());
    return a;
  };
  /** Liga ou desliga o "trabalhando" de um botão (girando + desabilitado). */
  LP.ocupado = function (b, sim) {
    if (!b) return;
    if (sim) {
      b.disabled = true;
      b.setAttribute('aria-busy', 'true');
      if (!b.querySelector('.girando')) b.insertBefore(h('span', { class: 'girando', 'aria-hidden': 'true' }), b.firstChild);
    } else {
      b.disabled = false;
      b.removeAttribute('aria-busy');
      const g = b.querySelector('.girando');
      if (g) g.remove();
    }
  };
  LP.chip = function (texto, tipo, opcoes) {
    const o = opcoes || {};
    return h('span', { class: 'chip' + (tipo ? ' chip-' + tipo : '') + (o.semPonto ? ' sem-ponto' : ''), title: o.title }, texto);
  };
  LP.chipStatus = function (status) {
    return status === 'suspenso' ? LP.chip('Suspenso', 'perigo') : LP.chip('Ativo', 'ok');
  };
  /** Texto com a data relativa e a data completa no title. */
  LP.quando = function (iso) {
    return h('span', { title: iso ? LP.dataHoraAno(iso) + ' (Brasília)' : '' }, iso ? LP.relativo(iso) : '—');
  };
  LP.ladrilho = function (rotulo, valor, extra, opcoes) {
    const o = opcoes || {};
    const c = h(o.href ? 'a' : 'div', { class: 'ladrilho' + (o.classe ? ' ' + o.classe : ''), href: o.href, title: o.title });
    c.appendChild(h('div', { class: 'ladrilho-rotulo' }, rotulo));
    c.appendChild(h('div', { class: 'ladrilho-valor' + (String(valor).length > 8 ? ' ladrilho-valor-longo' : '') }, valor));
    if (extra) c.appendChild(h('div', { class: 'ladrilho-extra' }, extra));
    return c;
  };
  LP.dado = function (rotulo, valor) {
    return h('div', { class: 'dado' }, h('dt', null, rotulo), h('dd', null, valor === null || valor === undefined || valor === '' ? '—' : valor));
  };
  LP.debounce = function (fn, ms) {
    let t = 0;
    const f = function () { const a = arguments; clearTimeout(t); t = setTimeout(() => fn.apply(null, a), ms); };
    f.cancelar = () => clearTimeout(t);
    return f;
  };
  LP.copiar = async function (texto) {
    try {
      await navigator.clipboard.writeText(texto);
      LP.avisar('Copiado.', 'ok', 2200);
    } catch (e) {
      const t = h('textarea', { class: 'so-celular', 'aria-hidden': 'true' });
      t.value = texto;
      document.body.appendChild(t);
      t.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      t.remove();
      LP.avisar(ok ? 'Copiado.' : 'Não deu para copiar. Selecione e copie à mão.', ok ? 'ok' : 'erro', 2600);
    }
  };
  /** Baixa um texto como arquivo (JSON da carreira etc.). */
  LP.baixar = function (nome, conteudo, tipo) {
    const url = URL.createObjectURL(new Blob([conteudo], { type: tipo || 'application/json' }));
    const a = h('a', { href: url, download: nome, class: 'so-celular' });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
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
  function mensagemPadrao(status) {
    if (status === 400) return 'O servidor recusou o pedido (dados inválidos).';
    if (status === 403) return 'O servidor recusou o pedido.';
    if (status === 404) return 'Não encontrado (pode ter sido apagado agora).';
    if (status === 409) return 'Não deu: o estado mudou. Atualize e tente de novo.';
    if (status === 413) return 'Pedido grande demais.';
    if (status === 429) return 'Muitas tentativas seguidas. Espere um pouco e tente de novo.';
    if (status >= 500) return 'O servidor teve um problema. Tente de novo em instantes.';
    return 'Não deu certo (erro ' + status + ').';
  }
  /** Pedido JSON. Erro HTTP/rede: ErroApi com a mensagem do servidor (pt-BR). 401: sessão acabou (LP.aoExpirar). */
  async function pedir(url, opcoes) {
    const o = opcoes || {};
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const tempo = setTimeout(() => ctl && ctl.abort(), o.tempo || 25000);
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
      throw new ErroApi(0, 'rede', e && e.name === 'AbortError'
        ? 'O servidor demorou demais para responder. Tente de novo.'
        : 'Sem conexão com o servidor. Confira a internet e tente de novo.');
    } finally {
      clearTimeout(tempo);
    }
    if (r.status === 401 && !o.semExpirar) {
      if (typeof LP.aoExpirar === 'function') LP.aoExpirar();
      throw new ErroApi(401, 'nao_logado', 'A sessão do painel acabou. Entre de novo.', json);
    }
    if (!r.ok) {
      const cod = json && typeof json.erro === 'string' ? json.erro : 'http_' + r.status;
      // 404 sem o JSON da API = o arquivo da rota não está no servidor (painel novo com a api/ antiga)
      const msg = json && typeof json.mensagem === 'string' && json.mensagem ? json.mensagem
        : r.status === 404 ? 'Esta parte do servidor ainda não foi publicada: suba a pasta api/ nova e rode o instalar.php (veja o LEIAME).'
          : mensagemPadrao(r.status);
      throw new ErroApi(r.status, cod, msg, json);
    }
    if (!json || typeof json !== 'object') {
      // 200 sem JSON (página de erro da hospedagem, proxy, resposta cortada): erro, nunca "lista vazia"
      throw new ErroApi(r.status, 'formato', 'O servidor respondeu algo inesperado. Tente de novo em instantes.');
    }
    return json;
  }
  LP.pedir = pedir;
  LP.painelGet = (qs, opcoes) => pedir(API_PAINEL + (qs || ''), opcoes);
  LP.painelPost = (corpo, opcoes) => pedir(API_PAINEL, Object.assign({ corpo: corpo }, opcoes || {}));
  LP.adminGet = function (r, params, opcoes) {
    const q = new URLSearchParams({ r: r });
    for (const k in params || {}) {
      const v = params[k];
      if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
    }
    return pedir(API_ADMIN + '?' + q.toString(), opcoes);
  };
  LP.adminPost = (corpo, opcoes) => pedir(API_ADMIN, Object.assign({ corpo: corpo }, opcoes || {}));
  /** Mensagem de um erro qualquer, para mostrar. */
  LP.mensagem = (e) => (e && e.message) || 'Não deu certo. Tente de novo.';

  // ── avisos (toasts) ─────────────────────────────────────────────────────────────────────────
  LP.avisar = function (msg, tipo, ms) {
    const caixa = LP.$('avisos');
    if (!caixa || !msg) return;
    const t = tipo || 'ok';
    const marca = t === 'erro' ? '!' : t === 'info' ? 'i' : '✓';
    const fechar = h('button', { type: 'button', 'aria-label': 'Fechar aviso' }, '×');
    const a = h('div', { class: 'aviso-flutuante ' + t, role: t === 'erro' ? 'alert' : 'status' },
      h('span', { class: 'marca-aviso', 'aria-hidden': 'true' }, marca), h('div', null, msg), fechar);
    const tirar = () => { if (a.parentNode) a.parentNode.removeChild(a); };
    fechar.addEventListener('click', tirar);
    caixa.appendChild(a);
    while (caixa.children.length > 4) caixa.removeChild(caixa.firstChild);
    setTimeout(tirar, ms || (t === 'erro' ? 9000 : 4500));
  };
  LP.avisarErro = (e) => { if (!e || e.status !== 401) LP.avisar(LP.mensagem(e), 'erro'); };

  // ── diálogo (confirmar, formulário, detalhe) ────────────────────────────────────────────────
  // Pilha: um diálogo pode abrir outro por cima (ex.: confirmar uma ação no detalhe da carreira).
  const pilha = [];
  /**
   * Abre o diálogo. Opções: titulo, texto (ou lista de textos), corpo (nó ou função → nó), campos [{nome, rotulo, tipo:
   * 'texto'|'textarea'|'numero'|'opcoes', valor, min, max, maxlength, obrigatorio, ajuda, placeholder, opcoes:[{valor,
   * rotulo}], atalhos:[{rotulo, valor}], validar(v, todos) → msg|null}], digitar (texto que tem de ser digitado para
   * liberar o botão), botao, tipoBotao ('ouro'|'perigo'), perigo, largo, soFechar (só "Fechar"), executar(valores) →
   * Promise (erro mostra dentro do diálogo; deu certo, fecha). Resolve com o retorno de executar (ou os valores), ou null.
   */
  LP.dialogo = function (op) {
    return new Promise((resolver) => {
      let trabalhando = false;
      let terminado = false;
      const d = h('dialog', { class: 'dialogo' + (op.largo ? ' largo' : '') + (op.perigo ? ' dialogo-perigo' : ''), 'aria-labelledby': 'dialogo-titulo-' + (pilha.length + 1) });
      const antes = document.activeElement;
      const sufixo = '-' + (pilha.length + 1);
      const form = h('form', { method: 'dialog', novalidate: true });
      const fecharX = h('button', { type: 'button', class: 'botao-icone', 'aria-label': 'Fechar' }, LP.icone('x'));
      form.appendChild(h('div', { class: 'dialogo-cabeca' }, h('h2', { id: 'dialogo-titulo-' + (pilha.length + 1) }, op.titulo || ''), fecharX));
      const corpo = h('div', { class: 'dialogo-corpo' });
      [].concat(op.texto || []).forEach((t) => corpo.appendChild(t instanceof Node ? t : h('p', null, t)));
      if (op.corpo) corpo.appendChild(typeof op.corpo === 'function' ? op.corpo() : op.corpo);
      const entradas = {};
      const errosCampo = {};
      (op.campos || []).forEach((c) => {
        const id = 'campo-' + c.nome + sufixo;
        const caixa = h('div', { class: 'campo' });
        if (c.rotulo) caixa.appendChild(h('label', { class: 'rotulo', for: id }, c.rotulo));
        let entrada;
        if (c.tipo === 'textarea') {
          entrada = h('textarea', { id: id, maxlength: c.maxlength, placeholder: c.placeholder, rows: c.linhas || 3 });
          entrada.value = c.valor || '';
        } else if (c.tipo === 'opcoes') {
          entrada = h('div', { class: 'segmentos', role: 'radiogroup', 'aria-label': c.rotulo || c.nome, id: id });
          let valorAtual = c.valor;
          const botoes = (c.opcoes || []).map((op2) => {
            const b = h('button', { type: 'button', role: 'radio', 'aria-pressed': String(op2.valor === valorAtual), 'aria-checked': String(op2.valor === valorAtual) }, op2.rotulo);
            b.addEventListener('click', () => {
              valorAtual = op2.valor;
              botoes.forEach((x, i) => { const sim = (c.opcoes[i].valor === valorAtual); x.setAttribute('aria-pressed', String(sim)); x.setAttribute('aria-checked', String(sim)); });
            });
            entrada.appendChild(b);
            return b;
          });
          entrada.lerValor = () => valorAtual;
        } else {
          entrada = h('input', { id: id, type: c.tipo === 'numero' ? 'number' : 'text', inputmode: c.tipo === 'numero' ? 'numeric' : undefined,
            min: c.min, max: c.max, maxlength: c.maxlength, placeholder: c.placeholder, autocomplete: 'off', spellcheck: 'false' });
          entrada.value = c.valor === undefined || c.valor === null ? '' : String(c.valor);
        }
        caixa.appendChild(entrada);
        if (c.atalhos && c.atalhos.length) {
          const at = h('div', { class: 'atalhos-dias' });
          c.atalhos.forEach((x) => at.appendChild(LP.botao(x.rotulo, () => { entrada.value = x.valor === null ? '' : String(x.valor); entrada.focus(); }, { tipo: 'fantasma', pequeno: true })));
          caixa.appendChild(at);
        }
        if (c.ajuda) caixa.appendChild(h('p', { class: 'ajuda' }, c.ajuda));
        const erroC = h('p', { class: 'erro-campo', hidden: true, role: 'alert' });
        caixa.appendChild(erroC);
        entradas[c.nome] = entrada;
        errosCampo[c.nome] = erroC;
        corpo.appendChild(caixa);
      });
      let entradaDigitar = null;
      if (op.digitar) {
        entradaDigitar = h('input', { type: 'text', id: 'campo-digitar' + sufixo, autocomplete: 'off', spellcheck: 'false' });
        corpo.appendChild(h('div', { class: 'campo confirmar-digitando' },
          h('label', { class: 'rotulo', for: 'campo-digitar' + sufixo }, 'Para confirmar, digite ', h('code', null, op.digitar)),
          entradaDigitar));
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
        confirmar = h('button', { type: 'submit', class: 'botao-' + tipoB + (tipoB === 'perigo' ? ' cheio' : '') }, h('span', null, op.botao || 'Confirmar'));
        pe.appendChild(confirmar);
      }
      if (op.extrasRodape) [].concat(op.extrasRodape).forEach((x) => pe.insertBefore(x, pe.firstChild));
      form.appendChild(pe);
      d.appendChild(form);

      const conferirDigitar = () => {
        if (confirmar && entradaDigitar) confirmar.disabled = entradaDigitar.value.trim() !== String(op.digitar).trim();
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
          if (typeof x === 'string') x = x.trim();
          let msg = null;
          if (c.tipo === 'numero') {
            if (x === '') x = null;
            else {
              const n = Number(x);
              if (!Number.isInteger(n)) msg = 'Use um número inteiro.';
              else if ((c.min !== undefined && n < c.min) || (c.max !== undefined && n > c.max)) msg = 'Use um número de ' + c.min + ' a ' + c.max + '.';
              x = n;
            }
          }
          if (!msg && c.obrigatorio && (x === null || x === '')) msg = 'Preencha este campo.';
          if (!msg && c.validar) msg = c.validar(x, v);
          errosCampo[c.nome].hidden = !msg;
          errosCampo[c.nome].textContent = msg || '';
          if (e.setAttribute) e.setAttribute('aria-invalid', msg ? 'true' : 'false');
          if (msg) ok = false;
          v[c.nome] = x;
        });
        return ok ? v : null;
      }
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        if (trabalhando || !confirmar) return;
        if (entradaDigitar && entradaDigitar.value.trim() !== String(op.digitar).trim()) return;
        const v = lerValores();
        if (!v) return;
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
          const chave = e && e.json && typeof e.json.chave === 'string' ? e.json.chave : null;
          if (chave && errosCampo[chave]) {
            errosCampo[chave].hidden = false;
            errosCampo[chave].textContent = LP.mensagem(e);
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
      // Esc: fecha (menos no meio de uma ação). Atribuição (não addEventListener): cada diálogo troca a do anterior.
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
      if (primeiro && primeiro.focus && primeiro.tagName !== 'DIV') primeiro.focus();
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
    return h('div', { class: 'estado estado-erro', role: 'alert' },
      h('p', { class: 'estado-titulo' }, 'Não deu para carregar'),
      h('p', { class: 'texto-3' }, LP.mensagem(erro)),
      tentar ? LP.botao('Tentar de novo', tentar, { icone: 'atualizar' }) : null);
  };

  // ── lista (tabela que vira cartões no celular) ──────────────────────────────────────────────
  /**
   * colunas: [{rotulo, celula(item) → nó|texto, num, classe, principal (no celular vira o título do cartão), ordenar
   * (chave), acoes}], itens, aoClicar(item), ordem {chave, dir}, aoOrdenar(chave), rotuloLinha(item).
   */
  LP.lista = function (op) {
    const t = h('table', { class: 'lista cartoes' + (op.classe ? ' ' + op.classe : '') });
    const cab = h('tr');
    op.colunas.forEach((c) => {
      const th = h('th', { class: [c.num ? 'num' : '', c.acoes ? 'acoes' : '', c.ordenar ? 'ordenavel' : ''].join(' ').trim() || null, scope: 'col' });
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
      const tr = h('tr');
      if (op.aoClicar) {
        tr.className = 'clicavel';
        tr.tabIndex = 0;
        if (op.rotuloLinha) tr.setAttribute('aria-label', op.rotuloLinha(item));
        tr.addEventListener('click', (ev) => {
          if (ev.target instanceof Element && ev.target.closest('a, button, input, select, textarea')) return;
          op.aoClicar(item, ev);
        });
        tr.addEventListener('keydown', (ev) => {
          if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === tr) { ev.preventDefault(); op.aoClicar(item, ev); }
        });
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
    return h('div', { class: 'rolagem' }, t);
  };

  /** "Mostrando 1–50 de 1.234" + Anterior / Página X de Y / Próxima. */
  LP.paginacao = function (total, pagina, porPagina, ir) {
    const paginas = Math.max(1, Math.ceil((total || 0) / (porPagina || 50)));
    const p = Math.min(Math.max(1, pagina || 1), paginas);
    const de = total ? (p - 1) * porPagina + 1 : 0;
    const ate = Math.min(total, p * porPagina);
    const caixa = h('div', { class: 'paginacao' }, h('span', null, total ? 'Mostrando ' + LP.inteiro(de) + '–' + LP.inteiro(ate) + ' de ' + LP.inteiro(total) : 'Nenhum resultado'));
    if (paginas > 1) {
      const botoes = h('div', { class: 'botoes' });
      botoes.appendChild(LP.botao('Anterior', () => ir(p - 1), { tipo: 'fantasma', pequeno: true, disabled: p <= 1 }));
      botoes.appendChild(h('span', { class: 'pagina-atual' }, 'Página ' + LP.inteiro(p) + ' de ' + LP.inteiro(paginas)));
      botoes.appendChild(LP.botao('Próxima', () => ir(p + 1), { tipo: 'fantasma', pequeno: true, disabled: p >= paginas }));
      caixa.appendChild(botoes);
    }
    return caixa;
  };

  /** Segmentos (filtro de um valor só). opcoes: [{valor, rotulo, contador}]. */
  LP.segmentos = function (rotulo, opcoes, atual, aoEscolher) {
    const g = h('div', { class: 'segmentos', role: 'group', 'aria-label': rotulo });
    opcoes.forEach((o) => {
      const b = h('button', { type: 'button', 'aria-pressed': String(o.valor === atual) }, o.rotulo);
      if (o.contador) b.appendChild(h('span', { class: 'contador' + (o.tipoContador ? ' contador-' + o.tipoContador : '') }, LP.inteiro(o.contador)));
      b.addEventListener('click', () => aoEscolher(o.valor));
      g.appendChild(b);
    });
    return g;
  };
  /** Caixa de busca (com o atalho "/"). */
  LP.busca = function (placeholder, valor, aoMudar) {
    const i = h('input', { type: 'search', placeholder: placeholder, 'aria-label': placeholder, 'data-busca': '1', autocomplete: 'off', spellcheck: 'false', maxlength: 100 });
    i.value = valor || '';
    const atrasado = LP.debounce((v) => aoMudar(v), 350);
    i.addEventListener('input', () => atrasado(i.value.trim()));
    i.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { atrasado.cancelar(); aoMudar(i.value.trim()); }
      if (ev.key === 'Escape' && i.value) { ev.preventDefault(); i.value = ''; atrasado.cancelar(); aoMudar(''); }
    });
    return h('div', { class: 'busca' }, LP.icone('busca'), i, h('kbd', { 'aria-hidden': 'true' }, '/'));
  };
  LP.selecao = function (rotulo, opcoes, atual, aoMudar) {
    const s = h('select', { 'aria-label': rotulo });
    opcoes.forEach((o) => s.appendChild(h('option', { value: o.valor, selected: o.valor === atual }, o.rotulo)));
    s.addEventListener('change', () => aoMudar(s.value));
    return h('label', { class: 'rotulo-inline' }, h('span', null, rotulo), s);
  };

  // ── rota (hash): #/aba/parte?chave=valor ────────────────────────────────────────────────────
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
  /** Troca a query da aba atual sem remontar (substitui no histórico). */
  LP.trocarQuery = function (caminho, query) {
    if (LP.rota().aba !== caminho) return; // resposta atrasada de uma aba que já foi trocada
    const novo = LP.hash(caminho, query);
    if (location.hash !== novo) history.replaceState(null, '', novo);
  };
  /** O nó está na aba que aparece agora? (respostas atrasadas de outra aba não desenham nem mexem no título) */
  LP.visivel = (no) => !!no && no.isConnected && !no.closest('.aba[hidden]');
  LP.usuarioHash = (id) => '#/usuario/' + encodeURIComponent(String(id));
  /** Link para o detalhe de um usuário (apelido). */
  LP.linkUsuario = function (u, extra) {
    if (!u || !u.id) return h('span', { class: 'texto-3' }, extra || 'conta excluída');
    const a = h('a', { href: LP.usuarioHash(u.id), class: 'link-discreto', title: 'Abrir o usuário #' + u.id }, u.apelido || '#' + u.id);
    a.addEventListener('click', (ev) => ev.stopPropagation());
    return a;
  };
})();
