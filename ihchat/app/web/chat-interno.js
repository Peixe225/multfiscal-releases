/* IHchat - chat interno da equipe ("Chat da equipe" no topo do painel).

   Os atendentes conversam entre si sem misturar com os clientes: a sala Geral
   (todo mundo), uma sala por setor, conversas diretas e grupos. Quem decide
   quem vê o quê é o servidor (/api/interno/...: quem não é membro recebe 404),
   e os eventos "interno.*" só chegam a membros da sala.

   Não depende do painel.js:
   - descobre o login observando #app (o painel o mostra e esconde) e lê o
     token que o painel guarda em localStorage;
   - pega carona na conexão de tempo real do painel (IHchatEventos.assinar):
     nada de uma segunda consulta a cada 2 s na hospedagem;
   - o cartão de "conversa de cliente" dispara o CustomEvent
     "ihchat:abrir-conversa" (detail: {id}, cancelável, sobe até window). Quem
     abrir a conversa chama evento.preventDefault(); sem ninguém tratar, usa a
     função global abrirConversa do painel, se existir.

   window.IHchatInterno.compartilharConversa(conversaId) abre a gaveta pronta
   para mandar o cartão daquela conversa numa sala.

   Nada de innerHTML com dado de fora: todo texto entra por textContent. */
(function () {
  "use strict";

  const TIPOS = ["interno.mensagem", "interno.mensagem.atualizada", "interno.sala", "interno.lida"];
  const NOMES_CANAL = {
    whatsapp: "WhatsApp",
    whatsapp_qr: "WhatsApp",
    telegram: "Telegram",
    email: "E-mail",
    webchat: "Chat do site",
  };
  const MAX_CONTEUDO = 4000;
  const PAGINA = 50;
  const AGRUPAR_MS = 5 * 60 * 1000; // mensagens seguidas da mesma pessoa dividem o cabeçalho
  const MAX_TOASTS = 3;

  const estado = {
    token: null,
    eu: null,
    salas: new Map(), // id -> SalaSaida
    ordem: [], // ids na ordem do servidor
    aberta: null, // id da sala aberta na gaveta
    detalhes: new Map(), // id -> SalaDetalhe (membros)
    mensagens: new Map(), // id -> {lista, temMais, carregada}
    mencionado: new Set(), // salas com menção a mim ainda não lida
    anexada: null, // conversa de cliente anexada ao redator
    compartilhando: null, // conversa esperando a escolha da sala
    editando: null, // id da mensagem em edição
    rascunho: "", // o texto da edição: sobrevive ao redesenho quando chega evento
    pararEventos: null,
    conexaoPropria: null,
    esperaConexao: null,
    recarga: null,
    leitura: null,
    atendentes: null, // cache de /api/atendentes para os formulários
    iniciando: null,
    carregandoSalas: null, // a recarga da lista em andamento (uma só por vez)
    salasSujas: false, // chegou pedido de recarga durante a que está em andamento
    salasCarregadas: false, // já veio a primeira lista (antes disso, sala "nova" não é novidade)
    pendentes: new Map(), // sala ainda desconhecida -> mensagens que chegaram dela
    novasAbaixo: 0, // chegaram com a pessoa lendo mais acima: não contam como lidas
    naoEnviada: null, // {conteudo, conversa, sala}: a sala sumiu no envio; volta no redator
  };

  /* ----------------------------------------------------------- utilidades */
  function el(tag, classe, texto) {
    const elemento = document.createElement(tag);
    if (classe) elemento.className = classe;
    if (texto !== undefined && texto !== null) elemento.textContent = texto;
    return elemento;
  }

  /**
   * Redesenha sem perder o foco de quem navega pelo teclado: o elemento
   * focado é achado de novo (pelo seletor que `chave` devolver) depois.
   */
  function semPerderFoco(raiz, chave, redesenhar) {
    const ativo = document.activeElement;
    const alvo = ativo && raiz.contains(ativo) ? chave(ativo) : null;
    const selecao = alvo && typeof ativo.selectionStart === "number" ? [ativo.selectionStart, ativo.selectionEnd] : null;
    redesenhar();
    if (!alvo) return;
    const novo = raiz.querySelector(alvo);
    if (!novo) return;
    novo.focus({ preventScroll: true });
    if (selecao && novo.setSelectionRange) novo.setSelectionRange(...selecao);
  }

  function botao(texto, classe, rotulo) {
    const b = el("button", classe, texto);
    b.type = "button";
    if (rotulo) b.setAttribute("aria-label", rotulo);
    return b;
  }

  class ErroApi extends Error {
    constructor(mensagem, situacao) {
      super(mensagem);
      this.situacao = situacao;
    }
  }

  async function api(metodo, caminho, corpo) {
    const resposta = await fetch(caminho, {
      method: metodo,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${estado.token}` },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      cache: "no-store",
    });
    if (resposta.status === 401) {
      // o painel cuida de voltar ao login; aqui só para de tentar
      encerrar();
      throw new ErroApi("sessão expirada", 401);
    }
    if (!resposta.ok) {
      const detalhe = await resposta.json().catch(() => ({}));
      const texto = Array.isArray(detalhe.detail)
        ? detalhe.detail.map((problema) => problema.msg).join("; ")
        : detalhe.detail;
      throw new ErroApi(texto || `falha na requisição (${resposta.status})`, resposta.status);
    }
    return resposta.status === 204 ? null : resposta.json();
  }

  function data(iso) {
    return iso ? new Date(iso) : null;
  }

  function hora(iso) {
    const d = data(iso);
    return d ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
  }

  function diaDe(iso) {
    const d = data(iso);
    if (!d) return "";
    const hoje = new Date();
    const ontem = new Date();
    ontem.setDate(hoje.getDate() - 1);
    if (d.toDateString() === hoje.toDateString()) return "Hoje";
    if (d.toDateString() === ontem.toDateString()) return "Ontem";
    return d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
  }

  function quandoCurto(iso) {
    const d = data(iso);
    if (!d) return "";
    if (d.toDateString() === new Date().toDateString()) return hora(iso);
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  }

  function iniciais(nome) {
    const partes = String(nome || "?").trim().split(/\s+/);
    return ((partes[0] || "?")[0] + (partes.length > 1 ? partes[partes.length - 1][0] : "")).toUpperCase();
  }

  function semAcento(texto) {
    return String(texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  }

  function escaparRegex(texto) {
    return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function resumo(texto, limite = 90) {
    const limpo = String(texto || "").replace(/\s+/g, " ").trim();
    return limpo.length > limite ? `${limpo.slice(0, limite - 1)}…` : limpo;
  }

  function previaDe(mensagem) {
    if (!mensagem) return "Nenhuma mensagem ainda";
    if (mensagem.apagada) return "Mensagem apagada";
    const quem = mensagem.autor ? (mensagem.autor.id === estado.eu?.id ? "Você" : mensagem.autor.nome.split(" ")[0]) : "Alguém";
    const texto = mensagem.conteudo || (mensagem.conversa ? `compartilhou a conversa de ${mensagem.conversa.contato}` : "");
    return `${quem}: ${resumo(texto, 70)}`;
  }

  /* ------------------------------------------------------------ elementos */
  const app = document.getElementById("app");
  const abrirBotao = document.getElementById("abrir-interno");
  const contador = document.getElementById("contador-interno");
  if (!app || !abrirBotao) return; // página sem o gancho: nada a fazer

  const gaveta = el("aside", "interno");
  gaveta.id = "interno";
  gaveta.hidden = true;
  gaveta.setAttribute("role", "dialog");
  gaveta.setAttribute("aria-modal", "false");
  gaveta.setAttribute("aria-labelledby", "interno-titulo");
  gaveta.dataset.visao = "lista";

  const topo = el("header", "interno-topo");
  const titulo = el("h2", "", "Chat da equipe");
  titulo.id = "interno-titulo";
  const alertas = botao("Ativar alertas", "interno-alertas");
  alertas.title = "Avisar pelo navegador quando chegar mensagem direta ou menção com esta aba em segundo plano";
  alertas.hidden = true;
  const fechar = botao("×", "icone-gaveta", "Fechar o chat da equipe (Esc)");
  topo.append(titulo, alertas, fechar);

  const faixaCompartilhar = el("div", "interno-faixa");
  faixaCompartilhar.hidden = true;
  faixaCompartilhar.setAttribute("role", "status");
  const faixaTexto = el("span");
  const faixaCancelar = botao("Cancelar", "botao discreto pequeno");
  faixaCompartilhar.append(faixaTexto, faixaCancelar);

  const grade = el("div", "interno-grade");

  // lista de salas
  const lista = el("nav", "interno-lista");
  lista.setAttribute("aria-label", "Salas do chat da equipe");
  const acoesLista = el("div", "interno-novo");
  const novaDireta = botao("Conversa direta", "botao pequeno");
  const novoGrupo = botao("Novo grupo", "botao discreto pequeno");
  acoesLista.append(novaDireta, novoGrupo);
  const secoes = el("div", "interno-secoes");
  lista.append(acoesLista, secoes);

  // sala aberta
  const sala = el("section", "interno-sala");
  sala.setAttribute("aria-labelledby", "interno-sala-titulo");
  const salaTopo = el("header", "interno-sala-topo");
  const voltar = botao("←", "icone-gaveta interno-voltar", "Voltar às salas");
  const salaTitulos = el("div", "interno-sala-titulos");
  const salaTitulo = el("h3", "", "");
  salaTitulo.id = "interno-sala-titulo";
  const salaSub = el("p", "interno-sala-sub", "");
  salaTitulos.append(salaTitulo, salaSub);
  const silenciar = botao("Silenciar", "botao discreto pequeno interno-silenciar");
  silenciar.setAttribute("aria-pressed", "false");
  silenciar.title = "Sem aviso nem contador para esta sala (menção a você continua avisando)";
  const verMembros = botao("Membros", "botao discreto pequeno");
  verMembros.setAttribute("aria-controls", "interno-form");
  salaTopo.append(voltar, salaTitulos, silenciar, verMembros);

  const rolagem = el("div", "interno-mensagens");
  rolagem.setAttribute("role", "log");
  rolagem.setAttribute("aria-live", "polite");
  rolagem.setAttribute("aria-relevant", "additions");
  rolagem.setAttribute("aria-labelledby", "interno-sala-titulo");
  rolagem.tabIndex = 0;
  // "N mensagens novas": quem está lendo mais acima não é puxado para baixo,
  // e o que chegou não conta como lido até ele descer
  const areaMensagens = el("div", "interno-mensagens-area");
  const novasBotao = botao("", "interno-novas");
  novasBotao.hidden = true;
  areaMensagens.append(rolagem, novasBotao);

  const redator = el("form", "interno-redator");
  redator.setAttribute("aria-label", "Escrever para a sala");
  const anexo = el("div", "interno-anexo");
  anexo.hidden = true;
  const sugestoes = el("ul", "interno-sugestoes");
  sugestoes.id = "interno-sugestoes";
  sugestoes.setAttribute("role", "listbox");
  sugestoes.setAttribute("aria-label", "Pessoas para mencionar");
  sugestoes.hidden = true;
  const texto = el("textarea", "interno-texto");
  texto.rows = 1;
  texto.maxLength = MAX_CONTEUDO;
  texto.placeholder = "Escreva para a equipe…";
  texto.setAttribute("aria-label", "Mensagem para a sala");
  texto.setAttribute("aria-autocomplete", "list");
  texto.setAttribute("aria-controls", "interno-sugestoes");
  texto.setAttribute("aria-expanded", "false");
  const rodapeRedator = el("div", "interno-redator-rodape");
  const anexarConversa = botao("+ Conversa aberta", "botao discreto pequeno");
  anexarConversa.title = "Anexar como cartão a conversa de cliente aberta no painel";
  // sempre ativo: a conversa aberta no painel muda por trás da gaveta, e o
  // clique confere qual é (sem nenhuma, avisa)
  const dicaRedator = el("span", "interno-dica", "Enter envia · Shift+Enter quebra linha · @ menciona");
  const enviarBotao = el("button", "botao pequeno", "Enviar");
  enviarBotao.type = "submit";
  rodapeRedator.append(anexarConversa, dicaRedator, enviarBotao);
  const erroRedator = el("p", "erro interno-erro");
  erroRedator.setAttribute("role", "alert");
  redator.append(anexo, sugestoes, texto, rodapeRedator, erroRedator);

  const salaVazia = el("div", "interno-vazio");
  salaVazia.append(
    el("p", "", "Escolha uma sala para conversar com a equipe."),
    el("p", "interno-dica", "Nada daqui chega aos clientes."),
  );
  sala.append(salaTopo, areaMensagens, redator);
  sala.hidden = true;

  // formulários (conversa direta, novo grupo, membros)
  const painelForm = el("section", "interno-form");
  painelForm.id = "interno-form";
  painelForm.hidden = true;

  grade.append(lista, sala, salaVazia, painelForm);
  gaveta.append(topo, faixaCompartilhar, grade);

  const toasts = el("div", "interno-toasts");
  toasts.setAttribute("aria-live", "polite");

  document.body.append(gaveta, toasts);

  /* ------------------------------------------------------ login e início */
  function conferirLogin() {
    const token = localStorage.getItem("ihchat_token");
    const logado = !app.hidden && Boolean(token);
    if (logado && token !== estado.token) iniciar(token);
    else if (!logado && estado.token) encerrar();
  }

  async function iniciar(token) {
    encerrar();
    estado.token = token;
    const esta = {};
    estado.iniciando = esta;
    try {
      const eu = await api("GET", "/api/auth/eu");
      if (estado.iniciando !== esta) return; // saiu (ou trocou de pessoa) no meio
      estado.eu = eu;
      // criar grupo depende do cargo (chat.criar_grupo); sem a lista (servidor
      // antigo), o botão fica e o servidor decide
      novoGrupo.hidden = Array.isArray(eu.permissoes) && !eu.permissoes.includes("chat.criar_grupo");
    } catch {
      return;
    }
    abrirBotao.hidden = false;
    estado.pararEventos = IHchatEventos.assinar(TIPOS, tratarEvento);
    garantirConexao();
    atualizarAlertas();
    await carregarSalas().catch(() => null);
  }

  function encerrar() {
    estado.iniciando = null;
    if (estado.pararEventos) estado.pararEventos();
    estado.pararEventos = null;
    if (estado.conexaoPropria) estado.conexaoPropria.fechar();
    estado.conexaoPropria = null;
    clearTimeout(estado.esperaConexao);
    clearTimeout(estado.recarga);
    clearTimeout(estado.leitura);
    Object.assign(estado, {
      token: null,
      eu: null,
      aberta: null,
      anexada: null,
      compartilhando: null,
      editando: null,
      ordem: [],
      atendentes: null,
      salasCarregadas: false,
      salasSujas: false,
      novasAbaixo: 0,
      naoEnviada: null,
    });
    estado.pendentes.clear();
    atualizarNovasAbaixo();
    estado.salas.clear();
    estado.detalhes.clear();
    estado.mensagens.clear();
    estado.mencionado.clear();
    fecharGaveta(false);
    abrirBotao.hidden = true;
    toasts.replaceChildren();
    atualizarContador();
  }

  /** Sem a conexão do painel (outra tela, erro), abre a própria depois de um tempo. */
  function garantirConexao() {
    clearTimeout(estado.esperaConexao);
    estado.esperaConexao = setTimeout(() => {
      if (!estado.token || IHchatEventos.conexoes > 0 || estado.conexaoPropria) return;
      const token = encodeURIComponent(estado.token);
      const cursor = (depois) => (depois === null || depois === undefined ? "" : `&depois=${depois}`);
      const conexao = IHchatEventos.criar({
        stream: (depois) => `/api/eventos/stream?token=${token}${cursor(depois)}`,
        desde: (depois) => `/api/eventos/desde?token=${token}${cursor(depois)}`,
        tipos: TIPOS,
        aoRecusar: encerrar,
      });
      estado.conexaoPropria = conexao;
      conexao.preparar().then(() => estado.conexaoPropria === conexao && conexao.iniciar()).catch(() => null);
      carregarSalas().catch(() => null); // o que chegou antes da conexão
    }, 5000);
  }

  new MutationObserver(conferirLogin).observe(app, { attributes: true, attributeFilter: ["hidden"] });
  window.addEventListener("storage", (evento) => {
    if (evento.key === "ihchat_token") conferirLogin();
  });

  /* ---------------------------------------------------------------- salas */
  /**
   * Recarrega a lista de salas, um pedido por vez: um lote de eventos chega
   * de uma vez só (várias mensagens de uma sala nova), e cada uma pedindo a
   * lista viraria uma rajada de GETs (na hospedagem, um processo PHP cada).
   * Quem pede durante a recarga recebe a mesma promessa, e ela refaz uma vez
   * no fim (o que chegou pode ser mais novo que a resposta em andamento).
   */
  function carregarSalas() {
    if (!estado.token) return Promise.resolve();
    if (estado.carregandoSalas) {
      estado.salasSujas = true;
      return estado.carregandoSalas;
    }
    const esta = (async () => {
      try {
        do {
          estado.salasSujas = false;
          await buscarSalas();
        } while (estado.salasSujas && estado.token);
      } finally {
        if (estado.carregandoSalas === esta) estado.carregandoSalas = null;
      }
    })();
    estado.carregandoSalas = esta;
    return esta;
  }

  async function buscarSalas() {
    const token = estado.token;
    const salas = await api("GET", "/api/interno/salas");
    if (estado.token !== token) return; // saiu (ou trocou de pessoa) no meio
    estado.salasCarregadas = true;
    estado.salas = new Map(salas.map((s) => [s.id, s]));
    estado.ordem = salas.map((s) => s.id);
    for (const id of [...estado.mencionado]) {
      const s = estado.salas.get(id);
      if (!s || !s.nao_lidas) estado.mencionado.delete(id);
    }
    if (estado.aberta !== null && !estado.salas.has(estado.aberta)) {
      fecharSala();
    } else if (estado.aberta !== null) {
      desenharCabecalhoSala();
    }
    desenharLista();
    atualizarContador();
  }

  function recarregarSalasEmBreve() {
    clearTimeout(estado.recarga);
    estado.recarga = setTimeout(() => carregarSalas().catch(() => null), 300);
  }

  function totalNaoLidas() {
    let total = 0;
    for (const s of estado.salas.values()) {
      if (!s.silenciada || estado.mencionado.has(s.id)) total += s.nao_lidas || 0;
    }
    return total;
  }

  function atualizarContador() {
    const total = totalNaoLidas();
    contador.hidden = total === 0;
    contador.textContent = total > 99 ? "99+" : String(total);
    abrirBotao.setAttribute(
      "aria-label",
      total ? `Chat da equipe, ${total} ${total === 1 ? "mensagem não lida" : "mensagens não lidas"}` : "Chat da equipe",
    );
  }

  function secao(tituloTexto, itens) {
    if (!itens.length) return null;
    const bloco = el("section", "interno-secao");
    const cabecalho = el("h3", "interno-secao-titulo", tituloTexto);
    const ul = el("ul", "interno-itens");
    for (const s of itens) {
      const li = el("li");
      li.append(itemDaSala(s));
      ul.append(li);
    }
    bloco.append(cabecalho, ul);
    return bloco;
  }

  function desenharLista() {
    const salas = estado.ordem.map((id) => estado.salas.get(id)).filter(Boolean);
    const blocos = [
      secao("Equipe", salas.filter((s) => s.tipo === "geral" || s.tipo === "setor")),
      secao("Grupos", salas.filter((s) => s.tipo === "grupo")),
      secao("Diretas", salas.filter((s) => s.tipo === "direta")),
    ].filter(Boolean);
    if (!blocos.length) blocos.push(el("p", "interno-dica interno-carregando", "Carregando as salas…"));
    semPerderFoco(
      secoes,
      (ativo) => {
        const id = Number(ativo.closest("[data-sala]")?.dataset.sala);
        return Number.isInteger(id) ? `.interno-item[data-sala="${id}"]` : null;
      },
      () => secoes.replaceChildren(...blocos),
    );
  }

  function itemDaSala(s) {
    const item = botao(undefined, "interno-item");
    item.dataset.sala = s.id;
    if (s.id === estado.aberta) item.setAttribute("aria-current", "true");
    if (s.nao_lidas) item.classList.add("tem-nao-lidas");

    const icone = el("span", `interno-icone tipo-${s.tipo}`);
    icone.setAttribute("aria-hidden", "true");
    if (s.tipo === "direta") {
      icone.textContent = iniciais(s.nome);
      const ponto = el("i", `interno-ponto ${s.com?.ativo === false ? "inativo" : s.com?.disponivel ? "disponivel" : "ausente"}`);
      icone.append(ponto);
    } else {
      icone.textContent = s.tipo === "geral" ? "#" : s.tipo === "setor" ? "◆" : "●";
    }

    const corpo = el("span", "interno-item-corpo");
    const linha = el("span", "interno-item-linha");
    linha.append(el("span", "interno-item-nome", s.nome));
    if (s.silenciada) {
      const mudo = el("span", "interno-mudo", "silenciada");
      linha.append(mudo);
    }
    linha.append(el("span", "interno-item-quando", quandoCurto(s.ultima_mensagem?.criada_em)));
    const segunda = el("span", "interno-item-linha");
    let subtitulo = previaDe(s.ultima_mensagem);
    if (s.tipo === "direta" && s.com && !s.ultima_mensagem) {
      subtitulo = s.com.ativo === false ? "inativo" : s.com.setor || "sem setor";
    }
    segunda.append(el("span", "interno-item-previa", subtitulo));
    if (estado.mencionado.has(s.id)) segunda.append(el("span", "interno-arroba", "@"));
    if (s.nao_lidas) segunda.append(el("span", "bolha-nao-lidas", s.nao_lidas > 99 ? "99+" : String(s.nao_lidas)));
    corpo.append(linha, segunda);
    item.append(icone, corpo);

    const partes = [s.nome];
    if (s.tipo === "direta") partes.push("conversa direta");
    else if (s.tipo === "grupo") partes.push("grupo");
    else if (s.tipo === "setor") partes.push("sala do setor");
    if (s.nao_lidas) partes.push(`${s.nao_lidas} não lidas`);
    if (estado.mencionado.has(s.id)) partes.push("mencionaram você");
    item.setAttribute("aria-label", partes.join(", "));
    item.addEventListener("click", () => abrirSala(s.id));
    return item;
  }

  /* --------------------------------------------------------------- gaveta */
  let focoAntes = null;

  function abrirGaveta(salaId) {
    if (!estado.token) return;
    if (gaveta.hidden) focoAntes = document.activeElement;
    gaveta.hidden = false;
    abrirBotao.setAttribute("aria-expanded", "true");
    atualizarAnexarConversa();
    carregarSalas().catch(() => null); // o servidor acerta Geral e setores
    if (salaId) return abrirSala(salaId);
    if (estado.aberta !== null) {
      mostrar("sala");
      marcarLidaEmBreve();
      texto.focus();
    } else {
      mostrar("lista");
      (secoes.querySelector(".interno-item") || novaDireta).focus();
    }
  }

  function fecharGaveta(devolverFoco = true) {
    if (gaveta.hidden) return;
    const estavaDentro = gaveta.contains(document.activeElement);
    gaveta.hidden = true;
    abrirBotao.setAttribute("aria-expanded", "false");
    fecharSugestoes();
    estado.compartilhando = null;
    faixaCompartilhar.hidden = true;
    if (devolverFoco && estavaDentro) (focoAntes && document.contains(focoAntes) ? focoAntes : abrirBotao).focus();
  }

  function mostrar(visao) {
    gaveta.dataset.visao = visao;
    sala.hidden = estado.aberta === null || visao === "form";
    salaVazia.hidden = estado.aberta !== null || visao === "form";
    painelForm.hidden = visao !== "form";
  }

  abrirBotao.addEventListener("click", () => (gaveta.hidden ? abrirGaveta() : fecharGaveta()));

  // Clicar numa conversa da lista do painel com a gaveta por cima da coluna
  // da conversa (notebook): a conversa abriria escondida, sem retorno
  // nenhum. Fecha a gaveta (como o cartão faz); o que estava na sala fica.
  // Em captura: o painel pode redesenhar a lista no próprio clique.
  document.addEventListener(
    "click",
    (evento) => {
      if (gaveta.hidden || !evento.target.closest?.("#lista-conversas .item")) return;
      const conversa = document.querySelector(".conversa");
      if (!conversa) return;
      const r = conversa.getBoundingClientRect();
      const g = gaveta.getBoundingClientRect();
      const coberto = Math.max(0, Math.min(r.right, g.right) - Math.max(r.left, g.left));
      if (r.width === 0 || coberto > r.width / 2) fecharGaveta(false);
    },
    true,
  );
  fechar.addEventListener("click", () => fecharGaveta());
  voltar.addEventListener("click", () => {
    fecharSala();
    (secoes.querySelector(".interno-item") || novaDireta).focus();
  });

  gaveta.addEventListener("keydown", (evento) => {
    if (evento.key !== "Escape") return;
    // Esc é da gaveta: o painel não fecha a ficha por baixo
    evento.stopPropagation();
    if (!sugestoes.hidden) return fecharSugestoes();
    if (estado.editando !== null) return cancelarEdicao();
    if (gaveta.dataset.visao === "form") {
      evento.preventDefault();
      return fecharForm();
    }
    evento.preventDefault();
    fecharGaveta();
  });

  /* ----------------------------------------------------------------- sala */
  async function abrirSala(id) {
    const anterior = estado.aberta;
    estado.aberta = id;
    estado.editando = null;
    if (estado.compartilhando !== null) {
      estado.anexada = estado.compartilhando;
      estado.compartilhando = null;
      faixaCompartilhar.hidden = true;
    }
    if (anterior !== id) {
      texto.value = "";
      ajustarAltura();
      estado.novasAbaixo = 0;
      atualizarNovasAbaixo();
    }
    const perdida = estado.naoEnviada;
    if (perdida && perdida.sala !== id) {
      // a mensagem que não foi (a sala sumiu no envio) volta para ser revista aqui
      estado.naoEnviada = null;
      texto.value = perdida.conteudo;
      if (perdida.conversa !== null) estado.anexada = perdida.conversa;
      ajustarAltura();
    }
    desenharAnexo();
    mostrar("sala");
    desenharCabecalhoSala();
    desenharLista();
    desenharMensagens(true);
    texto.focus();
    try {
      const [detalhe] = await Promise.all([api("GET", `/api/interno/salas/${id}`), carregarMensagens(id)]);
      if (estado.aberta !== id) return;
      estado.detalhes.set(id, detalhe);
      guardarSala(detalhe);
      desenharCabecalhoSala();
      desenharMensagens(true);
      marcarLidaEmBreve();
    } catch (erro) {
      if (erro.situacao === 404) return salaSumiu(id);
      mostrarErro(`Não foi possível abrir a sala: ${erro.message}`);
    }
  }

  function guardarSala(s) {
    const { membros, ...saida } = s;
    estado.salas.set(s.id, { ...estado.salas.get(s.id), ...saida });
    if (!estado.ordem.includes(s.id)) estado.ordem.push(s.id);
  }

  function fecharSala() {
    estado.aberta = null;
    estado.editando = null;
    estado.novasAbaixo = 0;
    atualizarNovasAbaixo();
    fecharSugestoes();
    mostrar("lista");
    desenharLista();
  }

  /**
   * A sala deixou de ser minha (tirada do grupo, setor trocado, 404). Se eu
   * estava escrevendo nela, o texto (e o cartão) não se perde: volta no
   * redator da próxima sala que eu abrir. `motivo` "envio": era o envio.
   */
  function salaSumiu(id, motivo) {
    const nome = estado.salas.get(id)?.nome || estado.naoEnviada?.nome;
    const escrevendo = estado.aberta === id && (texto.value.trim() !== "" || estado.anexada !== null);
    if (escrevendo) estado.naoEnviada = { conteudo: texto.value, conversa: estado.anexada, sala: id, nome };
    estado.salas.delete(id);
    estado.ordem = estado.ordem.filter((x) => x !== id);
    estado.detalhes.delete(id);
    estado.mensagens.delete(id);
    estado.mencionado.delete(id);
    if (estado.aberta === id) fecharSala();
    else desenharLista();
    atualizarContador();
    const onde = nome ? `“${nome}”` : "essa sala";
    if (motivo === "envio") {
      avisar(`Sua mensagem não foi enviada: você não participa mais de ${onde}. O texto volta no campo quando você abrir outra sala.`);
    } else if (nome || escrevendo) {
      avisar(
        `Você não participa mais de ${onde}.${escrevendo ? " O que você estava escrevendo volta no campo quando abrir outra sala." : ""}`,
      );
    }
  }

  function desenharCabecalhoSala() {
    const s = estado.salas.get(estado.aberta);
    if (!s) return;
    const detalhe = estado.detalhes.get(s.id);
    salaTitulo.textContent = s.nome;
    const pessoas = `${s.total_membros} ${s.total_membros === 1 ? "pessoa" : "pessoas"}`;
    let sub;
    if (s.tipo === "geral") sub = `Todos da equipe · ${pessoas}`;
    else if (s.tipo === "setor") sub = `Setor · ${pessoas}`;
    else if (s.tipo === "grupo") sub = `Grupo · ${pessoas}${s.administrador ? " · você administra" : ""}`;
    else if (s.com) {
      sub = [
        s.com.setor || "sem setor",
        s.com.ativo === false ? "inativo" : s.com.disponivel ? "disponível" : "ausente",
      ].join(" · ");
    } else sub = "Conversa direta";
    salaSub.textContent = sub;
    silenciar.setAttribute("aria-pressed", s.silenciada ? "true" : "false");
    silenciar.textContent = s.silenciada ? "Silenciada" : "Silenciar";
    verMembros.textContent = s.tipo === "direta" ? "Detalhes" : "Membros";
    const inativo = s.tipo === "direta" && s.com?.ativo === false;
    texto.placeholder = inativo
      ? `${s.nome} está inativo e não vai ler`
      : `Escreva para ${s.tipo === "direta" ? s.nome : `“${s.nome}”`}…`;
    if (detalhe) padraoDeMencao(detalhe); // prepara o destaque
  }

  silenciar.addEventListener("click", async () => {
    const s = estado.salas.get(estado.aberta);
    if (!s) return;
    silenciar.disabled = true;
    try {
      const detalhe = await api("PATCH", `/api/interno/salas/${s.id}`, { silenciada: !s.silenciada });
      estado.detalhes.set(s.id, detalhe);
      guardarSala(detalhe);
      desenharCabecalhoSala();
      desenharLista();
      atualizarContador();
    } catch (erro) {
      mostrarErro(erro.message);
    } finally {
      silenciar.disabled = false;
    }
  });

  /* ------------------------------------------------------------ mensagens */
  async function carregarMensagens(id, antes) {
    const parametros = new URLSearchParams({ limite: String(PAGINA) });
    if (antes) parametros.set("antes", String(antes));
    const pagina = await api("GET", `/api/interno/salas/${id}/mensagens?${parametros}`);
    const guardadas = estado.mensagens.get(id) || { lista: [], temMais: false, carregada: false };
    const porId = new Map(guardadas.lista.map((m) => [m.id, m]));
    for (const m of pagina.mensagens) porId.set(m.id, m);
    guardadas.lista = [...porId.values()].sort((a, b) => a.id - b.id);
    // "tem mais" vale para a página mais antiga pedida
    if (antes || !guardadas.carregada) guardadas.temMais = pagina.tem_mais;
    guardadas.carregada = true;
    estado.mensagens.set(id, guardadas);
    return guardadas;
  }

  function guardarMensagem(m) {
    const guardadas = estado.mensagens.get(m.sala_id);
    if (!guardadas) return false;
    const indice = guardadas.lista.findIndex((x) => x.id === m.id);
    if (indice >= 0) guardadas.lista[indice] = m;
    else {
      guardadas.lista.push(m);
      guardadas.lista.sort((a, b) => a.id - b.id);
    }
    return indice < 0;
  }

  function pertoDoFim() {
    return rolagem.scrollHeight - rolagem.scrollTop - rolagem.clientHeight < 80;
  }

  function desenharMensagens(irParaFim = false) {
    const id = estado.aberta;
    if (id === null) return;
    const guardadas = estado.mensagens.get(id);
    const colar = irParaFim || pertoDoFim();
    const nos = [];
    if (!guardadas || !guardadas.carregada) {
      nos.push(el("p", "interno-dica interno-carregando", "Carregando as mensagens…"));
    } else {
      if (guardadas.temMais) {
        const anteriores = botao("Carregar mensagens anteriores", "botao discreto pequeno interno-anteriores");
        anteriores.disabled = Boolean(estado.carregandoAnteriores);
        anteriores.addEventListener("click", () => carregarAnteriores(anteriores));
        nos.push(anteriores);
      }
      if (!guardadas.lista.length) {
        nos.push(el("p", "interno-dica interno-comeco", "Nenhuma mensagem ainda. Diga oi!"));
      }
      let dia = null;
      let anterior = null;
      for (const m of guardadas.lista) {
        const d = diaDe(m.criada_em);
        if (d !== dia) {
          const separador = el("p", "interno-dia");
          separador.append(el("span", "", d));
          nos.push(separador);
          dia = d;
          anterior = null;
        }
        const continua =
          anterior &&
          !anterior.apagada &&
          anterior.autor?.id === m.autor?.id &&
          data(m.criada_em) - data(anterior.criada_em) < AGRUPAR_MS;
        nos.push(elementoDaMensagem(m, continua));
        anterior = m;
      }
    }
    const topoAntes = rolagem.scrollTop;
    semPerderFoco(
      rolagem,
      (ativo) => {
        if (ativo.classList.contains("interno-anteriores")) return ".interno-anteriores";
        const id = Number(ativo.closest(".interno-msg")?.dataset.id);
        if (!Number.isInteger(id)) return null;
        const acao = ativo.dataset.acao;
        return `.interno-msg[data-id="${id}"]${acao ? ` [data-acao="${acao}"]` : ""}`;
      },
      () => rolagem.replaceChildren(...nos),
    );
    rolagem.scrollTop = colar ? rolagem.scrollHeight : topoAntes;
  }

  async function carregarAnteriores(gatilho) {
    const id = estado.aberta;
    const guardadas = estado.mensagens.get(id);
    if (!guardadas?.lista.length) return;
    gatilho.disabled = true;
    estado.carregandoAnteriores = true;
    const altura = rolagem.scrollHeight;
    const topoAntes = rolagem.scrollTop;
    const primeira = guardadas.lista[0].id;
    try {
      await carregarMensagens(id, primeira);
      estado.carregandoAnteriores = false;
      if (estado.aberta !== id) return;
      desenharMensagens();
      // mantém na tela a mensagem que estava no alto, e o foco nela
      rolagem.scrollTop = rolagem.scrollHeight - altura + topoAntes;
      rolagem.querySelector(`.interno-msg[data-id="${Number(primeira)}"]`)?.focus({ preventScroll: true });
    } catch (erro) {
      estado.carregandoAnteriores = false;
      gatilho.disabled = false;
      mostrarErro(erro.message);
    }
  }

  // ---- destaque de menções: "@Nome Completo" e "@Primeiro" (se único na sala)
  const padroes = new Map(); // sala id -> {regex, meus: Set}

  function padraoDeMencao(detalhe) {
    const membros = detalhe.membros || [];
    const contagem = new Map();
    for (const m of membros) {
      const primeiro = semAcento(m.nome.split(/\s+/)[0]);
      contagem.set(primeiro, (contagem.get(primeiro) || 0) + 1);
    }
    const nomes = [];
    const meus = new Set();
    for (const m of membros) {
      const partes = m.nome.trim().split(/\s+/);
      const completo = partes.map(escaparRegex).join("\\s+");
      nomes.push(completo);
      if (m.id === estado.eu?.id) meus.add(semAcento(partes.join(" ")));
      if (contagem.get(semAcento(partes[0])) === 1 && partes.length > 1) {
        nomes.push(escaparRegex(partes[0]));
        if (m.id === estado.eu?.id) meus.add(semAcento(partes[0]));
      }
    }
    nomes.sort((a, b) => b.length - a.length); // o nome completo antes do primeiro nome
    let regex = null;
    if (nomes.length) {
      try {
        regex = new RegExp(`(?<![\\p{L}\\p{N}_])@(?:${nomes.join("|")})(?![\\p{L}\\p{N}_])`, "giu");
      } catch {
        regex = null; // navegador sem lookbehind: sem destaque, o resto funciona
      }
    }
    const padrao = { regex, meus };
    padroes.set(detalhe.id, padrao);
    return padrao;
  }

  const ENDERECO = /\bhttps?:\/\/[^\s<>"'()]+[^\s<>"'().,;:!?]/g;

  function comMencoes(alvo, trecho, padrao) {
    if (!padrao?.regex) {
      alvo.append(document.createTextNode(trecho));
      return;
    }
    padrao.regex.lastIndex = 0;
    let inicio = 0;
    for (const achado of trecho.matchAll(padrao.regex)) {
      if (achado.index > inicio) alvo.append(document.createTextNode(trecho.slice(inicio, achado.index)));
      const nome = semAcento(achado[0].slice(1).replace(/\s+/g, " "));
      alvo.append(el("mark", padrao.meus.has(nome) ? "interno-mencao eu" : "interno-mencao", achado[0]));
      inicio = achado.index + achado[0].length;
    }
    if (inicio < trecho.length) alvo.append(document.createTextNode(trecho.slice(inicio)));
  }

  function textoRico(conteudo, padrao) {
    const p = el("p", "interno-msg-texto");
    const linhas = String(conteudo).split("\n");
    linhas.forEach((linha, i) => {
      if (i > 0) p.append(el("br"));
      let inicio = 0;
      for (const achado of linha.matchAll(ENDERECO)) {
        if (achado.index > inicio) comMencoes(p, linha.slice(inicio, achado.index), padrao);
        let endereco = null;
        try {
          const url = new URL(achado[0]);
          if (url.protocol === "http:" || url.protocol === "https:") endereco = url.href;
        } catch {
          endereco = null;
        }
        if (endereco) {
          const link = el("a", "", achado[0]);
          link.href = endereco;
          link.target = "_blank";
          link.rel = "noopener noreferrer nofollow";
          p.append(link);
        } else {
          p.append(document.createTextNode(achado[0]));
        }
        inicio = achado.index + achado[0].length;
      }
      if (inicio < linha.length) comMencoes(p, linha.slice(inicio), padrao);
    });
    return p;
  }

  function cartaoDaConversa(conversa) {
    const cartao = botao(undefined, "interno-cartao");
    cartao.title = "Abrir esta conversa no painel";
    const canal = NOMES_CANAL[conversa.canal_tipo] || conversa.canal_tipo;
    const topoCartao = el("span", "interno-cartao-topo");
    topoCartao.append(
      el("span", "interno-cartao-rotulo", `Conversa de cliente #${conversa.id}`),
      el("span", `interno-cartao-status status-${conversa.status}`, conversa.status),
    );
    const nome = el("strong", "interno-cartao-nome", conversa.contato);
    const detalhe = el("span", "interno-cartao-detalhe", [canal, conversa.canal_nome, conversa.assunto].filter(Boolean).join(" · "));
    cartao.append(topoCartao, nome, detalhe, el("span", "interno-cartao-abrir", "Abrir conversa →"));
    cartao.setAttribute("aria-label", `Abrir a conversa de ${conversa.contato} (${canal}, ${conversa.status})`);
    cartao.dataset.acao = "cartao";
    cartao.addEventListener("click", () => abrirConversaDoCliente(conversa.id));
    return cartao;
  }

  function seloAdmin() {
    const selo = el("span", "interno-selo", "admin");
    selo.title = "Administrador do IHchat (o nome e o setor cada um muda no perfil; isto não)";
    return selo;
  }

  /** Nomes que aparecem mais de uma vez na lista: esses ganham o #id ao lado. */
  function nomesRepetidos(pessoas) {
    const contagem = new Map();
    for (const p of pessoas) {
      const chave = semAcento(String(p.nome).trim().replace(/\s+/g, " "));
      contagem.set(chave, (contagem.get(chave) || 0) + 1);
    }
    return (p) => (contagem.get(semAcento(String(p.nome).trim().replace(/\s+/g, " "))) || 0) > 1;
  }

  function elementoDaMensagem(m, continua) {
    const minha = m.autor?.id === estado.eu?.id;
    const mencionaMe = !m.apagada && (m.mencoes || []).includes(estado.eu?.id);
    const artigo = el("article", "interno-msg");
    artigo.dataset.id = m.id;
    artigo.tabIndex = -1;
    if (continua) artigo.classList.add("continua");
    if (minha) artigo.classList.add("minha");
    if (mencionaMe) artigo.classList.add("para-mim");
    if (m.apagada) artigo.classList.add("apagada");

    const autor = m.autor?.nome || "Atendente removido";
    const cabecalho = el("header", "interno-msg-topo");
    const avatar = el("span", "interno-avatar", iniciais(autor));
    avatar.setAttribute("aria-hidden", "true");
    cabecalho.append(avatar, el("strong", "interno-msg-autor", autor));
    // vem do papel (só o admin muda); nome e setor qualquer um troca no perfil
    if (m.autor?.admin) cabecalho.append(seloAdmin());
    if (m.autor?.setor) cabecalho.append(el("span", "interno-msg-setor", m.autor.setor));
    const quando = el("time", "interno-msg-hora", hora(m.criada_em));
    quando.dateTime = m.criada_em;
    quando.title = data(m.criada_em)?.toLocaleString("pt-BR") || "";
    cabecalho.append(quando);
    if (m.editada_em && !m.apagada) cabecalho.append(el("span", "interno-msg-editada", "(editada)"));
    artigo.append(cabecalho);
    if (continua) artigo.setAttribute("aria-label", `${autor}, ${hora(m.criada_em)}`);

    const padrao = padroes.get(m.sala_id);
    if (m.apagada) {
      artigo.append(el("p", "interno-msg-texto interno-apagada", "Mensagem apagada"));
    } else if (estado.editando === m.id) {
      artigo.append(formularioDeEdicao(m));
    } else {
      if (m.conteudo) artigo.append(textoRico(m.conteudo, padrao));
      if (m.conversa) artigo.append(cartaoDaConversa(m.conversa));
    }

    // editar é só de quem escreveu; apagar, também de quem modera o chat
    // (chat.moderar). O servidor confere de novo: aqui só não oferece o que dá 403
    const modera = (estado.eu?.permissoes || []).includes("chat.moderar");
    if ((minha || modera) && !m.apagada && estado.editando !== m.id) {
      const acoes = el("div", "interno-msg-acoes");
      if (minha) {
        const editar = botao("Editar", "interno-acao", "Editar a mensagem");
        editar.dataset.acao = "editar";
        editar.addEventListener("click", () => iniciarEdicao(m.id));
        acoes.append(editar);
      }
      const apagar = botao("Apagar", "interno-acao perigo", minha ? "Apagar a mensagem" : "Apagar a mensagem (moderação)");
      apagar.dataset.acao = "apagar";
      apagar.addEventListener("click", () => apagarMensagem(m));
      acoes.append(apagar);
      artigo.append(acoes);
    }
    return artigo;
  }

  /* ---------------------------------------------------- editar e apagar */
  function iniciarEdicao(id) {
    estado.editando = id;
    estado.rascunho = estado.mensagens.get(estado.aberta)?.lista.find((m) => m.id === id)?.conteudo || "";
    desenharMensagens();
    rolagem.querySelector(`.interno-msg[data-id="${Number(id)}"] textarea`)?.focus();
  }

  function cancelarEdicao() {
    const id = estado.editando;
    estado.editando = null;
    estado.rascunho = "";
    desenharMensagens();
    rolagem.querySelector(`.interno-msg[data-id="${Number(id)}"] .interno-acao`)?.focus();
  }

  function formularioDeEdicao(m) {
    const form = el("form", "interno-edicao");
    const campo = el("textarea", "interno-texto");
    campo.value = estado.rascunho;
    campo.maxLength = MAX_CONTEUDO;
    campo.rows = Math.min(8, Math.max(2, campo.value.split("\n").length));
    campo.setAttribute("aria-label", "Editar a mensagem");
    campo.dataset.acao = "editar-texto";
    campo.addEventListener("input", () => (estado.rascunho = campo.value));
    const acoes = el("div", "interno-edicao-acoes");
    const salvar = el("button", "botao pequeno", "Salvar");
    salvar.type = "submit";
    const cancelar = botao("Cancelar", "botao discreto pequeno");
    const dica = el("span", "interno-dica", "Enter salva · Esc cancela");
    acoes.append(salvar, cancelar, dica);
    form.append(campo, acoes);
    cancelar.addEventListener("click", cancelarEdicao);
    campo.addEventListener("keydown", (evento) => {
      if (evento.key === "Enter" && !evento.shiftKey && !evento.isComposing) {
        evento.preventDefault();
        form.requestSubmit();
      }
    });
    form.addEventListener("submit", async (evento) => {
      evento.preventDefault();
      const conteudo = campo.value.trim();
      if (!conteudo && !m.conversa) return mostrarErro("A mensagem não pode ficar vazia.");
      salvar.disabled = true;
      try {
        const editada = await api("PATCH", `/api/interno/mensagens/${m.id}`, { conteudo });
        estado.editando = null;
        estado.rascunho = "";
        receberMensagem(editada, true);
        rolagem.querySelector(`.interno-msg[data-id="${Number(m.id)}"]`)?.focus();
      } catch (erro) {
        salvar.disabled = false;
        mostrarErro(erro.message);
      }
    });
    return form;
  }

  async function apagarMensagem(m) {
    if (!window.confirm("Apagar esta mensagem para todos? No lugar dela fica “Mensagem apagada”.")) return;
    try {
      const apagada = await api("DELETE", `/api/interno/mensagens/${m.id}`);
      receberMensagem(apagada, true);
      texto.focus();
    } catch (erro) {
      mostrarErro(erro.message);
    }
  }

  /* --------------------------------------------------------------- enviar */
  function mostrarErro(mensagem) {
    erroRedator.textContent = mensagem || "";
    if (mensagem) setTimeout(() => erroRedator.textContent === mensagem && (erroRedator.textContent = ""), 6000);
  }

  function ajustarAltura() {
    texto.style.height = "auto";
    texto.style.height = `${Math.min(texto.scrollHeight, 160)}px`;
  }

  redator.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    const id = estado.aberta;
    if (id === null) return;
    const conteudo = texto.value.trim();
    const conversaId = estado.anexada;
    if (conteudo.length > MAX_CONTEUDO) return mostrarErro(`A mensagem pode ter no máximo ${MAX_CONTEUDO} caracteres.`);
    if (!conteudo && conversaId === null) return;
    enviarBotao.disabled = true;
    mostrarErro("");
    try {
      const corpo = { conteudo };
      if (conversaId !== null) corpo.conversa_id = conversaId;
      const mensagem = await api("POST", `/api/interno/salas/${id}/mensagens`, corpo);
      texto.value = "";
      ajustarAltura();
      estado.anexada = null;
      desenharAnexo();
      // o cartão compartilhado já foi: a faixa "anexado nesta sala" sai junto
      if (conversaId !== null && estado.compartilhando === null) faixaCompartilhar.hidden = true;
      receberMensagem(mensagem, true);
    } catch (erro) {
      if (erro.situacao === 404 && erro.message.includes("sala")) {
        // a sala sumiu (setor trocado, tirada do grupo): o texto não se perde,
        // volta no redator da próxima sala aberta
        // (se o aviso de "saiu" chegou antes da resposta, o texto já foi guardado)
        if (!estado.naoEnviada) {
          estado.naoEnviada = { conteudo, conversa: conversaId, sala: id, nome: estado.salas.get(id)?.nome };
        }
        return salaSumiu(id, "envio");
      }
      mostrarErro(erro.message);
    } finally {
      enviarBotao.disabled = false;
      texto.focus();
    }
  });

  texto.addEventListener("keydown", (evento) => {
    if (!sugestoes.hidden && navegarSugestoes(evento)) return;
    if (evento.key === "Enter" && !evento.shiftKey && !evento.isComposing) {
      evento.preventDefault();
      redator.requestSubmit();
    }
  });
  texto.addEventListener("input", () => {
    ajustarAltura();
    atualizarSugestoes();
  });
  texto.addEventListener("click", atualizarSugestoes);
  texto.addEventListener("blur", () => setTimeout(fecharSugestoes, 150));

  /* ------------------------------------------------------------ menções @ */
  let sugestaoAtiva = -1;
  let consultaAtual = null;

  function consultaDeMencao() {
    const antes = texto.value.slice(0, texto.selectionStart);
    const achado = antes.match(/(?:^|[^\p{L}\p{N}_])@([\p{L}\p{N}_.\- ]{0,30})$/u);
    if (!achado) return null;
    const termo = achado[1];
    if (/\s{2}/.test(termo) || termo.startsWith(" ")) return null;
    return { termo, inicio: antes.length - termo.length - 1 };
  }

  function candidatosDaSala() {
    const detalhe = estado.detalhes.get(estado.aberta);
    if (!detalhe) return [];
    return detalhe.membros.filter((m) => m.ativo && m.id !== estado.eu?.id);
  }

  function atualizarSugestoes() {
    consultaAtual = consultaDeMencao();
    if (!consultaAtual) return fecharSugestoes();
    const termo = semAcento(consultaAtual.termo.trim());
    const achados = candidatosDaSala()
      .filter((m) => {
        if (!termo) return true;
        const nome = semAcento(m.nome);
        return nome.startsWith(termo) || nome.split(/\s+/).some((parte) => parte.startsWith(termo));
      })
      .slice(0, 6);
    if (!achados.length) return fecharSugestoes();
    const repetido = nomesRepetidos(estado.detalhes.get(estado.aberta)?.membros || []);
    sugestoes.replaceChildren(
      ...achados.map((m, i) => {
        const li = el("li", "interno-sugestao");
        li.id = `interno-sugestao-${m.id}`;
        li.setAttribute("role", "option");
        li.dataset.nome = m.nome;
        li.append(el("strong", "", m.nome));
        if (m.admin) li.append(seloAdmin());
        // nome repetido na sala: o servidor não menciona ninguém por ele
        if (repetido(m)) li.append(el("span", "interno-repetido", `#${m.id} · nome repetido, não avisa`));
        if (m.setor) li.append(el("span", "", m.setor));
        li.addEventListener("mousedown", (evento) => {
          evento.preventDefault(); // não tira o foco do texto
          escolherSugestao(i);
        });
        return li;
      }),
    );
    sugestoes.hidden = false;
    texto.setAttribute("aria-expanded", "true");
    marcarSugestao(0);
  }

  function marcarSugestao(indice) {
    const itens = [...sugestoes.children];
    sugestaoAtiva = Math.max(0, Math.min(indice, itens.length - 1));
    itens.forEach((item, i) => item.setAttribute("aria-selected", i === sugestaoAtiva ? "true" : "false"));
    const ativo = itens[sugestaoAtiva];
    if (ativo) {
      texto.setAttribute("aria-activedescendant", ativo.id);
      ativo.scrollIntoView({ block: "nearest" });
    }
  }

  function navegarSugestoes(evento) {
    const total = sugestoes.children.length;
    if (evento.key === "ArrowDown") marcarSugestao((sugestaoAtiva + 1) % total);
    else if (evento.key === "ArrowUp") marcarSugestao((sugestaoAtiva - 1 + total) % total);
    else if (evento.key === "Enter" || evento.key === "Tab") escolherSugestao(sugestaoAtiva);
    else if (evento.key === "Escape") {
      fecharSugestoes();
      evento.stopPropagation();
    } else return false;
    evento.preventDefault();
    return true;
  }

  function escolherSugestao(indice) {
    const item = sugestoes.children[indice];
    if (!item || !consultaAtual) return fecharSugestoes();
    const inicio = consultaAtual.inicio;
    const fim = texto.selectionStart;
    const inserido = `@${item.dataset.nome} `;
    texto.value = texto.value.slice(0, inicio) + inserido + texto.value.slice(fim);
    const cursor = inicio + inserido.length;
    texto.setSelectionRange(cursor, cursor);
    fecharSugestoes();
    ajustarAltura();
    texto.focus();
  }

  function fecharSugestoes() {
    sugestoes.hidden = true;
    sugestoes.replaceChildren();
    texto.setAttribute("aria-expanded", "false");
    texto.removeAttribute("aria-activedescendant");
    sugestaoAtiva = -1;
  }

  /* ------------------------------------------------ conversa de cliente */
  function conversaAbertaNoPainel() {
    // o painel marca a conversa na tela, mesmo fora do filtro da lista; o item
    // ativo da lista fica como reserva para um painel antigo em cache
    const aberta = document.querySelector("#conversa-conteudo:not([hidden])[data-conversa-id]");
    const item = aberta ? null : document.querySelector("#lista-conversas .item.ativo[data-id]");
    const id = Number(aberta ? aberta.dataset.conversaId : item?.dataset.id);
    return Number.isInteger(id) && id > 0 ? id : null;
  }

  /** Só o título: o botão fica sempre ativo e o clique confere a conversa. */
  function atualizarAnexarConversa() {
    const id = conversaAbertaNoPainel();
    anexarConversa.title =
      id === null
        ? "Anexar como cartão a conversa de cliente aberta no painel (abra uma na lista)"
        : `Anexar a conversa #${id} (aberta no painel) como cartão`;
  }

  anexarConversa.addEventListener("pointerenter", atualizarAnexarConversa);
  anexarConversa.addEventListener("focus", atualizarAnexarConversa);
  anexarConversa.addEventListener("click", () => {
    const id = conversaAbertaNoPainel();
    atualizarAnexarConversa();
    if (id === null) {
      mostrarErro("Nenhuma conversa de cliente aberta: abra uma na lista do painel e clique de novo.");
      return texto.focus();
    }
    mostrarErro("");
    estado.anexada = id;
    desenharAnexo();
    texto.focus();
  });

  function desenharAnexo() {
    if (estado.anexada === null) {
      anexo.hidden = true;
      anexo.replaceChildren();
      return;
    }
    const tirar = botao("×", "interno-anexo-tirar", "Tirar o cartão da conversa");
    tirar.addEventListener("click", () => {
      estado.anexada = null;
      desenharAnexo();
      texto.focus();
    });
    anexo.replaceChildren(el("span", "", `Cartão da conversa de cliente #${estado.anexada} vai junto`), tirar);
    anexo.hidden = false;
  }

  function abrirConversaDoCliente(id) {
    const evento = new CustomEvent("ihchat:abrir-conversa", { detail: { id }, bubbles: true, cancelable: true });
    const ninguemTratou = document.dispatchEvent(evento);
    if (ninguemTratou) {
      if (typeof window.abrirConversa === "function") window.abrirConversa(id);
      else return avisar(`Abra a conversa #${id} pela lista de conversas.`);
    }
    // a gaveta cobre a conversa: fecha para mostrar o que foi aberto
    fecharGaveta(false);
  }

  function compartilharConversa(conversaId) {
    const id = Number(conversaId);
    if (!Number.isInteger(id) || id <= 0 || !estado.token) return false;
    abrirGaveta();
    if (estado.aberta !== null) {
      estado.anexada = id;
      desenharAnexo();
      mostrar("sala");
      texto.focus();
      faixaTexto.textContent = `Cartão da conversa #${id} anexado nesta sala. Para mandar em outra, escolha na lista.`;
    } else {
      estado.compartilhando = id;
      faixaTexto.textContent = `Escolha a sala para compartilhar a conversa de cliente #${id}.`;
    }
    faixaCompartilhar.hidden = false;
    return true;
  }

  faixaCancelar.addEventListener("click", () => {
    estado.compartilhando = null;
    estado.anexada = null;
    faixaCompartilhar.hidden = true;
    desenharAnexo();
  });

  /* ------------------------------------------------------ formulários */
  async function atendentesAtivos() {
    const todos = await api("GET", "/api/atendentes");
    estado.atendentes = todos.filter((a) => a.ativo && a.id !== estado.eu?.id);
    return estado.atendentes;
  }

  function abrirForm(tituloTexto, montar) {
    const cabecalho = el("header", "interno-form-topo");
    const voltarForm = botao("←", "icone-gaveta", "Voltar");
    voltarForm.addEventListener("click", fecharForm);
    const h = el("h3", "", tituloTexto);
    h.id = "interno-form-titulo";
    cabecalho.append(voltarForm, h);
    const corpo = el("div", "interno-form-corpo");
    painelForm.setAttribute("aria-labelledby", "interno-form-titulo");
    painelForm.replaceChildren(cabecalho, corpo);
    mostrar("form");
    montar(corpo);
  }

  function fecharForm() {
    painelForm.replaceChildren();
    mostrar(estado.aberta !== null ? "sala" : "lista");
    (estado.aberta !== null ? texto : secoes.querySelector(".interno-item") || novaDireta).focus();
  }

  function listaDePessoas(corpo, pessoas, { escolher, marcar = null, vazio = "Ninguém encontrado." }) {
    const busca = el("input", "interno-busca");
    busca.type = "search";
    busca.placeholder = "Buscar pelo nome ou setor…";
    busca.setAttribute("aria-label", "Buscar pessoa");
    const ul = el("ul", "interno-pessoas");
    function desenhar() {
      const termo = semAcento(busca.value.trim());
      const filtradas = pessoas.filter((p) => !termo || semAcento(`${p.nome} ${p.setor || ""}`).includes(termo));
      ul.replaceChildren(
        ...(filtradas.length
          ? filtradas.map((p) => {
              const li = el("li");
              const linha = marcar ? el("label", "interno-pessoa") : botao(undefined, "interno-pessoa");
              const avatar = el("span", "interno-avatar", iniciais(p.nome));
              avatar.setAttribute("aria-hidden", "true");
              const nome = el("span", "interno-pessoa-nome");
              nome.append(el("strong", "", p.nome), el("span", "", p.setor || "sem setor"));
              const ponto = el("i", `interno-ponto ${p.disponivel ? "disponivel" : "ausente"}`);
              ponto.title = p.disponivel ? "disponível" : "ausente";
              if (marcar) {
                const caixa = el("input");
                caixa.type = "checkbox";
                caixa.checked = marcar.has(p.id);
                caixa.addEventListener("change", () => (caixa.checked ? marcar.add(p.id) : marcar.delete(p.id)));
                linha.append(caixa, avatar, nome, ponto);
              } else {
                linha.append(avatar, nome, ponto);
                linha.addEventListener("click", () => escolher(p, linha));
              }
              li.append(linha);
              return li;
            })
          : [el("li", "interno-dica", vazio)]),
      );
    }
    busca.addEventListener("input", desenhar);
    desenhar();
    corpo.append(busca, ul);
    return busca;
  }

  novaDireta.addEventListener("click", () =>
    abrirForm("Conversa direta", async (corpo) => {
      corpo.append(el("p", "interno-dica", "Só vocês dois veem esta conversa."));
      const erro = el("p", "erro");
      erro.setAttribute("role", "alert");
      try {
        const pessoas = await atendentesAtivos();
        const busca = listaDePessoas(corpo, pessoas, {
          vazio: "Nenhum outro atendente ativo.",
          escolher: async (pessoa, linha) => {
            linha.disabled = true;
            try {
              const detalhe = await api("POST", "/api/interno/diretas", { atendente_id: pessoa.id });
              estado.detalhes.set(detalhe.id, detalhe);
              guardarSala(detalhe);
              painelForm.replaceChildren();
              abrirSala(detalhe.id);
            } catch (falha) {
              linha.disabled = false;
              erro.textContent = falha.message;
            }
          },
        });
        corpo.append(erro);
        busca.focus();
      } catch (falha) {
        corpo.append(el("p", "erro", `Não foi possível carregar a equipe: ${falha.message}`));
      }
    }),
  );

  novoGrupo.addEventListener("click", () =>
    abrirForm("Novo grupo", async (corpo) => {
      const form = el("form", "interno-form-grupo");
      const rotulo = el("label", "interno-campo", "Nome do grupo");
      const nome = el("input");
      nome.maxLength = 80;
      nome.required = true;
      nome.placeholder = "Ex.: Plantão de sábado";
      rotulo.append(nome);
      const escolhidos = new Set();
      form.append(rotulo, el("p", "interno-dica", "Quem cria administra: renomeia e põe ou tira pessoas."));
      const erro = el("p", "erro");
      erro.setAttribute("role", "alert");
      const criarBotao = el("button", "botao pequeno", "Criar grupo");
      criarBotao.type = "submit";
      corpo.append(form);
      nome.focus();
      try {
        const pessoas = await atendentesAtivos();
        listaDePessoas(form, pessoas, { marcar: escolhidos, vazio: "Nenhum outro atendente ativo." });
      } catch (falha) {
        erro.textContent = `Não foi possível carregar a equipe: ${falha.message}`;
      }
      form.append(erro, criarBotao);
      form.addEventListener("submit", async (evento) => {
        evento.preventDefault();
        if (!nome.value.trim()) {
          erro.textContent = "Dê um nome ao grupo.";
          return nome.focus();
        }
        criarBotao.disabled = true;
        try {
          const detalhe = await api("POST", "/api/interno/grupos", { nome: nome.value, membros: [...escolhidos] });
          estado.detalhes.set(detalhe.id, detalhe);
          guardarSala(detalhe);
          painelForm.replaceChildren();
          abrirSala(detalhe.id);
        } catch (falha) {
          criarBotao.disabled = false;
          erro.textContent = falha.message;
        }
      });
    }),
  );

  verMembros.addEventListener("click", () => {
    const id = estado.aberta;
    const s = estado.salas.get(id);
    if (!s) return;
    abrirForm(s.tipo === "direta" ? s.nome : `Membros de “${s.nome}”`, async (corpo) => {
      corpo.append(el("p", "interno-dica", "Carregando…"));
      let detalhe;
      try {
        detalhe = await api("GET", `/api/interno/salas/${id}`);
      } catch (falha) {
        if (falha.situacao === 404) return salaSumiu(id);
        return corpo.replaceChildren(el("p", "erro", falha.message));
      }
      estado.detalhes.set(id, detalhe);
      guardarSala(detalhe);
      desenharMembros(corpo, detalhe);
    });
  });

  function desenharMembros(corpo, detalhe) {
    const erro = el("p", "erro");
    erro.setAttribute("role", "alert");
    const explicacao = {
      geral: "Todos os atendentes ativos estão aqui. Quem é desativado sai sozinho.",
      setor: "Quem tem este setor no perfil está aqui. Mudou o setor, muda de sala.",
      grupo: detalhe.administrador ? "Você administra este grupo." : "Quem criou o grupo administra.",
      direta: "Só vocês dois veem esta conversa.",
    }[detalhe.tipo];
    const nos = [el("p", "interno-dica", explicacao)];

    if (detalhe.tipo === "grupo" && detalhe.administrador) {
      const renomear = el("form", "interno-linha-form");
      const campo = el("input");
      campo.value = detalhe.nome;
      campo.maxLength = 80;
      campo.setAttribute("aria-label", "Nome do grupo");
      const salvar = el("button", "botao discreto pequeno", "Renomear");
      salvar.type = "submit";
      renomear.append(campo, salvar);
      renomear.addEventListener("submit", async (evento) => {
        evento.preventDefault();
        await alterarGrupo(corpo, detalhe.id, { nome: campo.value }, erro);
      });
      nos.push(renomear);
    }

    const ul = el("ul", "interno-pessoas");
    const repetido = nomesRepetidos(detalhe.membros);
    for (const m of detalhe.membros) {
      const li = el("li", "interno-pessoa");
      const avatar = el("span", "interno-avatar", iniciais(m.nome));
      avatar.setAttribute("aria-hidden", "true");
      const nome = el("span", "interno-pessoa-nome");
      const extra = [m.setor || "sem setor"];
      if (m.admin) extra.push("admin do IHchat");
      if (repetido(m)) extra.push(`#${m.id}, nome repetido`);
      if (!m.ativo) extra.push("inativo");
      if (detalhe.tipo === "grupo" && m.id === detalhe.criada_por) extra.push("administra");
      if (m.id === estado.eu?.id) extra.push("você");
      nome.append(el("strong", "", m.nome), el("span", "", extra.join(" · ")));
      const ponto = el("i", `interno-ponto ${!m.ativo ? "inativo" : m.disponivel ? "disponivel" : "ausente"}`);
      ponto.title = !m.ativo ? "inativo" : m.disponivel ? "disponível" : "ausente";
      li.append(avatar, nome, ponto);
      if (m.id !== estado.eu?.id && m.ativo && detalhe.tipo !== "direta") {
        const conversar = botao("Direta", "interno-acao", `Conversa direta com ${m.nome}`);
        conversar.addEventListener("click", async () => {
          try {
            const direta = await api("POST", "/api/interno/diretas", { atendente_id: m.id });
            estado.detalhes.set(direta.id, direta);
            guardarSala(direta);
            painelForm.replaceChildren();
            abrirSala(direta.id);
          } catch (falha) {
            erro.textContent = falha.message;
          }
        });
        li.append(conversar);
      }
      if (detalhe.tipo === "grupo" && detalhe.administrador && m.id !== estado.eu?.id) {
        const tirar = botao("Tirar", "interno-acao perigo", `Tirar ${m.nome} do grupo`);
        tirar.addEventListener("click", () => alterarGrupo(corpo, detalhe.id, { remover: [m.id] }, erro));
        li.append(tirar);
      }
      ul.append(li);
    }
    nos.push(ul);

    if (detalhe.tipo === "grupo" && detalhe.administrador) {
      const adicionar = el("form", "interno-linha-form");
      const seletor = el("select");
      seletor.setAttribute("aria-label", "Pessoa para pôr no grupo");
      seletor.append(new Option("Pôr alguém no grupo…", ""));
      const botaoPor = el("button", "botao discreto pequeno", "Pôr");
      botaoPor.type = "submit";
      adicionar.append(seletor, botaoPor);
      atendentesAtivos()
        .then((pessoas) => {
          const dentro = new Set(detalhe.membros.map((m) => m.id));
          for (const p of pessoas) if (!dentro.has(p.id)) seletor.append(new Option(p.nome, String(p.id)));
        })
        .catch(() => null);
      adicionar.addEventListener("submit", async (evento) => {
        evento.preventDefault();
        if (!seletor.value) return;
        await alterarGrupo(corpo, detalhe.id, { adicionar: [Number(seletor.value)] }, erro);
      });
      nos.push(adicionar);
    }
    if (detalhe.tipo === "grupo") {
      const sair = botao("Sair do grupo", "botao discreto pequeno perigo-texto interno-sair");
      sair.addEventListener("click", async () => {
        if (!window.confirm(`Sair de “${detalhe.nome}”? Para voltar, alguém do grupo precisa pôr você de novo.`)) return;
        try {
          await api("POST", `/api/interno/salas/${detalhe.id}/sair`);
          painelForm.replaceChildren();
          salaSumiu(detalhe.id);
        } catch (falha) {
          erro.textContent = falha.message;
        }
      });
      nos.push(sair);
    }
    nos.push(erro);
    corpo.replaceChildren(...nos);
  }

  async function alterarGrupo(corpo, id, mudanca, erro) {
    try {
      const detalhe = await api("PATCH", `/api/interno/salas/${id}`, mudanca);
      estado.detalhes.set(id, detalhe);
      guardarSala(detalhe);
      desenharMembros(corpo, detalhe);
      desenharCabecalhoSala();
      desenharLista();
    } catch (falha) {
      erro.textContent = falha.message;
    }
  }

  /* ----------------------------------------------------------- leitura */
  function vendo(salaId) {
    return (
      !gaveta.hidden &&
      estado.aberta === salaId &&
      !document.hidden &&
      !sala.hidden &&
      sala.getClientRects().length > 0 // no celular, a lista ocupa o lugar dela
    );
  }

  function marcarLidaEmBreve() {
    clearTimeout(estado.leitura);
    estado.leitura = setTimeout(async () => {
      const id = estado.aberta;
      const s = estado.salas.get(id);
      if (!s || !vendo(id)) return;
      if (!pertoDoFim()) return atualizarNovasAbaixo(); // lendo mais acima: o que está embaixo não foi lido
      const ultima = estado.mensagens.get(id)?.lista.at(-1)?.id || s.ultima_mensagem?.id || 0;
      if (!s.nao_lidas && s.lida_ate >= ultima && !estado.mencionado.has(id)) return;
      try {
        const lida = await api("POST", `/api/interno/salas/${id}/lida`, { ate: ultima });
        aplicarLida(lida.sala_id, lida.lida_ate, lida.nao_lidas);
      } catch {
        /* tenta de novo na próxima mensagem */
      }
    }, 400);
  }

  function aplicarLida(salaId, lidaAte, naoLidas) {
    const s = estado.salas.get(salaId);
    if (!s) return;
    s.lida_ate = Math.max(s.lida_ate || 0, lidaAte);
    if (naoLidas !== undefined) s.nao_lidas = naoLidas;
    else if (s.ultima_mensagem && s.lida_ate >= s.ultima_mensagem.id) s.nao_lidas = 0;
    else recarregarSalasEmBreve();
    if (!s.nao_lidas) estado.mencionado.delete(salaId);
    desenharLista();
    atualizarContador();
  }

  function atualizarNovasAbaixo() {
    const n = estado.novasAbaixo;
    novasBotao.hidden = n === 0;
    novasBotao.textContent = n === 1 ? "1 mensagem nova ↓" : `${n} mensagens novas ↓`;
    novasBotao.setAttribute("aria-label", `${novasBotao.textContent.slice(0, -2)}: ir para o fim`);
  }

  novasBotao.addEventListener("click", () => {
    rolagem.scrollTop = rolagem.scrollHeight;
    chegouAoFim();
    rolagem.focus({ preventScroll: true });
  });

  function chegouAoFim() {
    if (!estado.novasAbaixo || !pertoDoFim()) return;
    estado.novasAbaixo = 0;
    atualizarNovasAbaixo();
    marcarLidaEmBreve();
  }

  rolagem.addEventListener("scroll", chegouAoFim, { passive: true });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && estado.aberta !== null) marcarLidaEmBreve();
  });

  /* ----------------------------------------------------------- eventos */
  function receberMensagem(m, minha = false) {
    const s = estado.salas.get(m.sala_id);
    const nova = guardarMensagem(m);
    if (s) {
      if (!s.ultima_mensagem || m.id >= s.ultima_mensagem.id) {
        s.ultima_mensagem = m;
        if (nova) s.atualizada_em = m.criada_em;
      }
      if (minha || m.autor?.id === estado.eu?.id) s.lida_ate = Math.max(s.lida_ate || 0, m.id);
    }
    if (estado.aberta === m.sala_id) desenharMensagens(minha);
    desenharLista();
    return nova;
  }

  function tratarEvento(tipo, dados) {
    if (!estado.token || !dados) return;
    if (tipo === "interno.mensagem") return chegouMensagem(dados);
    if (tipo === "interno.mensagem.atualizada") {
      const s = estado.salas.get(dados.sala_id);
      if (s?.ultima_mensagem?.id === dados.id) s.ultima_mensagem = dados;
      guardarMensagem(dados);
      if (dados.apagada) {
        // chegou (e contou, e avisou) antes de ser apagada: o aviso sai da
        // tela e o total volta do servidor, que não conta mensagem apagada
        for (const aviso of toasts.querySelectorAll(".interno-toast[data-mensagem]")) {
          if (Number(aviso.dataset.mensagem) === dados.id) aviso.remove();
        }
        if (s && dados.autor?.id !== estado.eu?.id && dados.id > (s.lida_ate || 0)) recarregarSalasEmBreve();
      }
      if (estado.editando === dados.id && dados.apagada) {
        estado.editando = null; // apagada em outra aba: não há o que editar
        estado.rascunho = "";
      }
      if (estado.aberta === dados.sala_id) desenharMensagens();
      desenharLista();
      return;
    }
    if (tipo === "interno.sala") {
      if (dados.acao === "saiu") return salaSumiu(dados.sala_id);
      estado.detalhes.delete(dados.sala_id);
      if (estado.salasCarregadas && !estado.salas.has(dados.sala_id)) {
        // sala que eu não tinha: me puseram num grupo (criado ou "atualizado"
        // com adicionar), entrei num setor. Recarrega já e avisa.
        const id = dados.sala_id;
        carregarSalas()
          .then(() => avisarInclusao(id))
          .catch(() => null);
      } else {
        recarregarSalasEmBreve();
      }
      if (estado.aberta === dados.sala_id) {
        api("GET", `/api/interno/salas/${dados.sala_id}`)
          .then((detalhe) => {
            estado.detalhes.set(detalhe.id, detalhe);
            guardarSala(detalhe);
            desenharCabecalhoSala();
          })
          .catch((erro) => erro.situacao === 404 && salaSumiu(dados.sala_id));
      }
      return;
    }
    if (tipo === "interno.lida") aplicarLida(dados.sala_id, dados.lida_ate);
  }

  function chegouMensagem(m) {
    const s = estado.salas.get(m.sala_id);
    const minha = m.autor?.id === estado.eu?.id;
    const mencionaMe = !m.apagada && (m.mencoes || []).includes(estado.eu?.id);
    if (!s) {
      if (!m.apagada) chegouDeSalaNova(m);
      return;
    }
    // já vista: repetida pela reconexão, ou contada quando a lista veio
    const jaVista =
      (s.ultima_mensagem && m.id <= s.ultima_mensagem.id) ||
      Boolean(estado.mensagens.get(m.sala_id)?.lista.some((x) => x.id === m.id));
    const noFim = pertoDoFim(); // antes de redesenhar com a mensagem nova
    receberMensagem(m);
    // apagada antes de chegar (a fila guarda a versão apagada): só ocupa o
    // lugar; não é não lida (o servidor também não conta) nem avisa
    if (jaVista || minha || m.apagada) return;
    if (vendo(m.sala_id)) {
      if (noFim) {
        marcarLidaEmBreve();
        return;
      }
      // lendo mais acima: fica não lida, com o "N mensagens novas ↓"
      s.nao_lidas = (s.nao_lidas || 0) + 1;
      if (mencionaMe) estado.mencionado.add(s.id);
      estado.novasAbaixo += 1;
      atualizarNovasAbaixo();
      desenharLista();
      atualizarContador();
      return;
    }
    s.nao_lidas = (s.nao_lidas || 0) + 1;
    if (mencionaMe) estado.mencionado.add(s.id);
    desenharLista();
    atualizarContador();
    if (!s.silenciada || mencionaMe) avisarMensagem(m, s);
  }

  /**
   * Mensagem de uma sala que ainda não está na lista (alguém abriu uma direta
   * ou me pôs num grupo). As do mesmo lote esperam UMA recarga da lista e
   * viram UM aviso; o servidor já as conta como não lidas.
   */
  function chegouDeSalaNova(m) {
    const fila = estado.pendentes.get(m.sala_id);
    if (fila) {
      fila.push(m);
      return;
    }
    estado.pendentes.set(m.sala_id, [m]);
    carregarSalas()
      .catch(() => null)
      .then(() => avisarPendentes(m.sala_id));
  }

  function avisarPendentes(salaId) {
    const fila = estado.pendentes.get(salaId) || [];
    estado.pendentes.delete(salaId);
    const s = estado.salas.get(salaId);
    if (!s) return;
    const deOutros = fila.filter((m) => m.autor?.id !== estado.eu?.id && !m.apagada && m.id > (s.lida_ate || 0));
    if (!deOutros.length) return;
    const mencionaMe = deOutros.some((m) => (m.mencoes || []).includes(estado.eu?.id));
    if (mencionaMe) estado.mencionado.add(salaId);
    desenharLista();
    atualizarContador();
    if (!s.silenciada || mencionaMe) avisarMensagem(deOutros[deOutros.length - 1], s, deOutros.length, mencionaMe);
  }

  /** "Você foi incluído no grupo": sem isto a pessoa só descobria abrindo a gaveta. */
  function avisarInclusao(salaId) {
    const s = estado.salas.get(salaId);
    // direta nova avisa pela primeira mensagem; a mensagem do mesmo lote já avisa
    if (!s || s.tipo === "direta" || estado.pendentes.has(salaId)) return;
    if (s.tipo === "grupo" && s.criada_por === estado.eu?.id) return; // eu mesmo criei (o evento chegou antes da resposta)
    if (!gaveta.hidden && lista.getClientRects().length > 0) return; // a sala nova já aparece na lista
    const textoAviso = s.tipo === "grupo" ? `Você foi incluído no grupo “${s.nome}”.` : `Você agora participa de “${s.nome}”.`;
    const toast = botao(undefined, "interno-toast");
    // a primeira mensagem da sala toma o lugar deste aviso (um aviso por sala)
    toast.dataset.sala = String(salaId);
    toast.dataset.quantas = "0";
    toast.append(el("span", "interno-toast-topo", textoAviso), el("span", "interno-toast-texto", "Abrir no chat da equipe"));
    toast.setAttribute("aria-label", `${textoAviso} Abrir no chat da equipe`);
    toast.addEventListener("click", () => {
      toast.remove();
      abrirGaveta(salaId);
    });
    mostrarToast(toast, 6500);
  }

  /* ------------------------------------------------ toast e navegador */
  /**
   * Os avisos ficam acima do redator que estiver na tela (o da resposta ao
   * cliente ou o do próprio chat): por cima dele, um clique no "Enviar" caía
   * no aviso e a resposta não ia. Sem redator à vista, no canto de baixo.
   */
  function posicionarToasts() {
    const redatores = [document.getElementById("redator")];
    if (!gaveta.hidden && !sala.hidden) redatores.push(redator);
    let topo = Infinity;
    for (const r of redatores) {
      if (!r || !r.getClientRects().length) continue;
      const caixa = r.getBoundingClientRect();
      if (caixa.height > 0 && caixa.top > 0 && caixa.top < window.innerHeight) topo = Math.min(topo, caixa.top);
    }
    toasts.style.bottom = topo === Infinity ? "" : `${Math.max(16, Math.round(window.innerHeight - topo + 12))}px`;
  }

  function mostrarToast(toast, duracao) {
    posicionarToasts();
    toasts.append(toast);
    while (toasts.children.length > MAX_TOASTS) toasts.firstChild.remove();
    setTimeout(() => toast.remove(), duracao);
  }

  function avisar(mensagem) {
    mostrarToast(el("div", "interno-toast simples", mensagem), 4000);
  }

  /**
   * Aviso de mensagem nova. Um por sala: se já há um desta sala na tela, ele
   * passa a contar esta também ("3 mensagens novas"), em vez de empilhar um
   * por mensagem. `quantas` > 1 quando várias chegaram juntas.
   */
  function avisarMensagem(m, s, quantas = 1, mencionaTodas = null) {
    if (m.apagada) return; // nada a mostrar: nem aviso vazio, nem Notification
    const autor = m.autor?.nome || "Alguém da equipe";
    const onde = s ? (s.tipo === "direta" ? "mensagem direta" : s.nome) : "chat da equipe";
    let mencionaMe = mencionaTodas ?? (m.mencoes || []).includes(estado.eu?.id);
    const ultima = m.conteudo ? resumo(m.conteudo, 120) : m.conversa ? `Compartilhou a conversa de ${m.conversa.contato}` : "";
    const juntar = (n) => (n > 1 ? `${n} mensagens novas. Última: ${ultima}` : ultima);

    if (document.hidden) {
      notificarNavegador(m, s, autor, onde, juntar(quantas), mencionaMe);
      return;
    }
    if (vendo(m.sala_id)) return;
    // gaveta aberta com a lista à vista: o contador na sala já é o aviso
    if (!gaveta.hidden && lista.getClientRects().length > 0) return;
    const anterior = [...toasts.querySelectorAll(".interno-toast[data-sala]")].find(
      (t) => Number(t.dataset.sala) === m.sala_id,
    );
    if (anterior) {
      quantas += Number(anterior.dataset.quantas ?? 1);
      mencionaMe = mencionaMe || anterior.classList.contains("mencao");
      anterior.remove();
    }
    const corpo = juntar(quantas);
    const toast = botao(undefined, `interno-toast${mencionaMe ? " mencao" : ""}`);
    toast.dataset.sala = String(m.sala_id);
    toast.dataset.mensagem = String(m.id); // se ela for apagada, o aviso sai
    toast.dataset.quantas = String(quantas);
    const linha = el("span", "interno-toast-topo");
    linha.append(el("strong", "", autor), el("span", "", mencionaMe ? `mencionou você em ${onde}` : onde));
    toast.append(linha, el("span", "interno-toast-texto", corpo));
    toast.setAttribute("aria-label", `${autor} (${onde}): ${corpo}. Abrir no chat da equipe`);
    toast.addEventListener("click", () => {
      toast.remove();
      abrirGaveta(m.sala_id);
    });
    mostrarToast(toast, 6500);
  }

  function notificarNavegador(m, s, autor, onde, corpo, mencionaMe) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    // só o que é para a pessoa: direta ou menção (a Geral inteira seria barulho)
    if (!mencionaMe && s?.tipo !== "direta") return;
    try {
      const aviso = new Notification(mencionaMe ? `${autor} mencionou você` : `${autor} (direta)`, {
        body: s && s.tipo !== "direta" ? `${onde}: ${corpo}` : corpo,
        tag: `ihchat-interno-${m.sala_id}`,
        icon: "/static/marca/favicon-32.png",
      });
      aviso.onclick = () => {
        window.focus();
        abrirGaveta(m.sala_id);
        aviso.close();
      };
    } catch {
      /* alguns navegadores só notificam por service worker: fica o contador */
    }
  }

  function atualizarAlertas() {
    alertas.hidden = !("Notification" in window) || Notification.permission !== "default";
  }

  alertas.addEventListener("click", async () => {
    try {
      await Notification.requestPermission();
    } catch {
      /* navegador antigo: sem aviso fora da aba */
    }
    atualizarAlertas();
    avisar(
      Notification.permission === "granted"
        ? "Pronto: mensagem direta e menção avisam mesmo com a aba em segundo plano."
        : "Sem permissão do navegador: os avisos ficam só dentro do IHchat.",
    );
    (gaveta.hidden ? abrirBotao : fechar).focus();
  });

  /* ------------------------------------------------------------ público */
  window.IHchatInterno = {
    compartilharConversa,
    abrir: (salaId) => abrirGaveta(salaId),
    fechar: () => fecharGaveta(),
    get naoLidas() { return totalNaoLidas(); },
  };

  conferirLogin();
})();
