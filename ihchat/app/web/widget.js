/* IHchat - widget de webchat para incorporar no site.
 *
 *   <script src="https://SEU-HOST/widget.js"
 *           data-chave="wc_..."            chave pública do canal de webchat
 *           data-titulo="Suporte"
 *           data-cor="#ff9e3d"             opcional; o padrão é o laranja da I&H
 *           data-saudacao="Como podemos ajudar?"></script>
 *
 * Tudo vive dentro de um shadow root, então o CSS do site não interfere no
 * widget e o do widget não vaza para o site.
 *
 * Cada resposta mostra quem atende: "Ana · Suporte técnico". O cliente
 * precisa saber com quem está falando.
 *
 * Tempo real nos dois servidores: /api/widget/saude diz se o servidor segura
 * conexão aberta ("stream": EventSource, no app Python) ou não ("consulta":
 * pergunta a cada 2 s, no PHP da hospedagem compartilhada). É uma rota do
 * widget, com o mesmo CORS do resto do /api/widget/* nos dois servidores (o
 * /saude geral depende de origens_permitidas). Os eventos têm id
 * crescente; o widget guarda o último visto e, ao reconectar, pede a partir
 * dele: nada se perde, nada se repete. É a mesma lógica de app/web/eventos.js,
 * copiada aqui porque o widget precisa ser um arquivo só.
 */
(function () {
  "use strict";

  const script = document.currentScript;
  if (!script) return;
  const config = {
    chave: script.dataset.chave,
    titulo: script.dataset.titulo || "Fale com a gente",
    cor: corSegura(script.dataset.cor) || "#ff9e3d", // laranja da I&H
    saudacao: script.dataset.saudacao || "Olá! Como podemos ajudar?",
    base: new URL(script.src).origin,
  };

  if (!config.chave) {
    console.error("IHchat: informe data-chave no <script> do widget.");
    return;
  }

  // a cor entra no CSS: só formatos de cor, nada que feche a regra
  function corSegura(valor) {
    const texto = String(valor || "").trim();
    return /^(#[0-9a-f]{3,8}|[a-z]{3,20}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\))$/i.test(texto) ? texto : null;
  }

  const CHAVE_ARMAZENAMENTO = `ihchat_widget_${config.chave}`;
  let token = null;
  try {
    token = localStorage.getItem(CHAVE_ARMAZENAMENTO);
  } catch (erro) {
    token = null; // navegação privada ou cookies bloqueados
  }
  let aberto = false;
  const mostradas = new Set(); // ids já desenhados: evento e histórico se cruzam
  // enquanto o histórico carrega, o que for desenhado (resposta que chegou
  // pelos eventos, mensagem que o visitante mandou) fica anotado aqui para
  // sobreviver à troca da tela pelo histórico (ver abrirConversa)
  let durante = null;

  // ------------------------------------------------------------ montagem
  const hospedeiro = document.createElement("div");
  hospedeiro.style.cssText = "position:fixed;bottom:0;right:0;z-index:2147483000";
  const raiz = hospedeiro.attachShadow({ mode: "open" });
  document.body.appendChild(hospedeiro);

  const estilo = document.createElement("style");
  estilo.textContent = `
    :host, * { box-sizing: border-box; }
    .bolha {
      position: fixed; bottom: 20px; right: 20px; width: 58px; height: 58px;
      border-radius: 50%; border: 0; cursor: pointer; color: var(--cor-texto); background: var(--cor);
      box-shadow: 0 6px 24px rgba(0,0,0,.24); font-size: 24px; line-height: 1;
      display: grid; place-items: center; transition: transform .15s ease;
    }
    .bolha:hover { transform: scale(1.06); }
    .janela {
      position: fixed; bottom: 90px; right: 20px; width: min(370px, calc(100vw - 32px));
      height: min(540px, calc(100vh - 120px));
      background: #fff; color: #0e1222; border-radius: 16px; overflow: hidden;
      box-shadow: 0 18px 60px rgba(0,0,0,.28); display: none;
      grid-template-rows: auto 1fr auto auto;
      font: 15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    }
    .janela.aberta { display: grid; }
    header { background: var(--cor); color: var(--cor-texto); padding: 14px 16px; }
    header b { display: block; font-size: 15px; }
    header span { font-size: 12px; opacity: .9; display: block; }
    .conversa { overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 8px; background: #f4f5fa; }
    .msg { max-width: 84%; padding: 9px 12px; border-radius: 14px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; }
    .msg.entrada { align-self: flex-end; background: var(--cor); color: var(--cor-texto); border-bottom-right-radius: 4px; }
    .msg.saida { align-self: flex-start; background: #fff; border: 1px solid #dcdfeb; border-bottom-left-radius: 4px; }
    .msg .autor { display: block; font-size: 12px; margin-bottom: 3px; white-space: normal; }
    .msg .autor b { font-weight: 700; }
    .msg .autor .setor { opacity: .7; }
    form { display: flex; gap: 8px; padding: 12px; border-top: 1px solid #dcdfeb; background: #fff; align-items: center; }
    .clipe {
      border: 1px solid #dcdfeb; background: #f4f5fa; border-radius: 10px;
      width: 36px; height: 36px; cursor: pointer; font-size: 15px; flex: none;
    }
    .clipe:disabled { opacity: .5; cursor: progress; }
    .msg img { max-width: 100%; border-radius: 9px; display: block; margin-top: 6px; cursor: zoom-in; }
    .msg .arquivo {
      display: flex; align-items: center; gap: 7px; margin-top: 6px; padding: 7px 9px;
      border-radius: 9px; text-decoration: none; color: inherit; font-size: 13px;
      background: rgba(127, 127, 127, .16);
    }
    input, textarea {
      flex: 1; border: 1px solid #dcdfeb; border-radius: 10px; padding: 9px 11px;
      font: inherit; resize: none; min-width: 0;
    }
    button.enviar { border: 0; background: var(--cor); color: var(--cor-texto); border-radius: 10px; padding: 0 16px; cursor: pointer; font-weight: 600; min-height: 38px; }
    .apresentacao { padding: 16px; display: grid; gap: 10px; align-content: start; background: #f4f5fa; }
    .apresentacao p { margin: 0 0 4px; color: #585f76; font-size: 13px; }
    .aviso { font-size: 12px; color: #c42b2b; padding: 6px 14px; background: #f4f5fa; }
    /* escuro: o azul-noite e o lilás do logo da I&H */
    @media (prefers-color-scheme: dark) {
      .janela { background: #0d1120; color: #eaedf7; }
      .conversa, .apresentacao, .aviso { background: #060912; }
      .apresentacao p { color: #9ba2bd; }
      .aviso { color: #ff6b6b; }
      .msg.saida { background: #161b2e; border-color: #262c43; }
      form { background: #0d1120; border-color: #262c43; }
      input, textarea, .clipe { background: #161b2e; border-color: #262c43; color: #eaedf7; }
    }
  `;
  raiz.appendChild(estilo);
  hospedeiro.style.setProperty("--cor", config.cor);
  hospedeiro.style.setProperty("--cor-texto", textoSobre(config.cor));

  /* Branco ou azul-noite, o que contrastar mais com a cor do site. Branco no
     laranja da I&H dá 2,06:1 (WCAG pede 4,5:1); azul-noite dá 9,67:1. A cor
     pode vir em qualquer formato CSS, então o navegador a converte para rgb. */
  function textoSobre(cor) {
    const sonda = document.createElement("span");
    sonda.style.color = cor;
    sonda.style.display = "none";
    document.body.appendChild(sonda);
    const partes = (getComputedStyle(sonda).color.match(/[\d.]+/g) || []).map(Number);
    sonda.remove();
    if (partes.length < 3) return "#fff";
    const canal = (c) => {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const luz = 0.2126 * canal(partes[0]) + 0.7152 * canal(partes[1]) + 0.0722 * canal(partes[2]);
    const contraBranco = 1.05 / (luz + 0.05);
    const contraNoite = (luz + 0.05) / (0.0028 + 0.05); // #060912 tem luminância ~0,0028
    return contraBranco >= contraNoite ? "#fff" : "#060912";
  }

  /** Elemento com texto (nunca HTML: título e saudação vêm do site). */
  function el(tag, atributos = {}, ...filhos) {
    const elemento = document.createElement(tag);
    for (const [nome, valor] of Object.entries(atributos)) {
      if (nome === "classe") elemento.className = valor;
      else if (nome === "texto") elemento.textContent = valor;
      else elemento.setAttribute(nome, valor);
    }
    elemento.append(...filhos);
    return elemento;
  }

  const bolha = el("button", { classe: "bolha", part: "bolha", "aria-label": "Abrir conversa", texto: "💬" });
  const subtitulo = el("span", { texto: "Costumamos responder em poucos minutos" });
  const nome = el("input", { id: "nome", placeholder: "Seu nome", autocomplete: "name", maxlength: "160" });
  const email = el("input", { id: "email", type: "email", placeholder: "Seu e-mail (opcional)", autocomplete: "email" });
  const comecar = el("button", { classe: "enviar", type: "button", texto: "Começar conversa" });
  const apresentacao = el("div", { classe: "apresentacao" }, el("p", { texto: config.saudacao }), nome, email, comecar);
  const conversa = el("div", { classe: "conversa", "aria-live": "polite" });
  const aviso = el("div", { classe: "aviso", role: "status" });
  const campoArquivo = el("input", { type: "file", hidden: "" });
  const clipe = el("button", { type: "button", classe: "clipe", title: "Anexar arquivo", "aria-label": "Anexar arquivo", texto: "📎" });
  const texto = el("textarea", { rows: "1", placeholder: "Escreva sua mensagem…", "aria-label": "Mensagem" });
  const formulario = el("form", {}, campoArquivo, clipe, texto, el("button", { classe: "enviar", type: "submit", texto: "Enviar" }));
  const janela = el(
    "section",
    { classe: "janela", role: "dialog", "aria-label": config.titulo },
    el("header", {}, el("b", { texto: config.titulo }), subtitulo),
    apresentacao,
    conversa,
    aviso,
    formulario
  );
  raiz.append(bolha, janela);
  conversa.style.display = "none";
  formulario.style.display = "none";
  aviso.style.display = "none";

  // ------------------------------------------------------------ interação
  bolha.addEventListener("click", () => {
    aberto = !aberto;
    janela.classList.toggle("aberta", aberto);
    bolha.textContent = aberto ? "✕" : "💬";
    bolha.setAttribute("aria-label", aberto ? "Fechar conversa" : "Abrir conversa");
    if (aberto && token) abrirConversa();
  });

  comecar.addEventListener("click", async () => {
    const corpo = { chave_publica: config.chave };
    if (nome.value.trim()) corpo.nome = nome.value.trim();
    if (email.value.trim()) corpo.email = email.value.trim();
    comecar.disabled = true;
    try {
      const resposta = await fetch(`${config.base}/api/widget/sessao`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      if (resposta.status === 422) throw new Error("confira o e-mail informado");
      if (!resposta.ok) throw new Error("não foi possível iniciar a conversa");
      token = (await resposta.json()).token;
      try {
        localStorage.setItem(CHAVE_ARMAZENAMENTO, token);
      } catch (erro) {
        /* segue sem persistir: a conversa vale para esta aba */
      }
      abrirConversa();
    } catch (erro) {
      mostrarAviso(erro.message);
    } finally {
      comecar.disabled = false;
    }
  });

  formulario.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    const conteudo = texto.value.trim();
    if (!conteudo) return;
    texto.value = "";
    try {
      const resposta = await fetch(`${config.base}/api/widget/mensagens`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Sessao": token },
        body: JSON.stringify({ conteudo }),
      });
      if (resposta.status === 401) return reiniciarSessao();
      if (!resposta.ok) throw new Error("não foi possível enviar");
      desenhar(await resposta.json());
    } catch (erro) {
      texto.value = conteudo; // nada do que foi escrito se perde
      mostrarAviso(erro.message);
    }
  });

  clipe.addEventListener("click", () => campoArquivo.click());

  campoArquivo.addEventListener("change", async () => {
    const arquivo = campoArquivo.files && campoArquivo.files[0];
    if (!arquivo) return;
    const dados = new FormData();
    dados.append("arquivo", arquivo);
    dados.append("conteudo", texto.value.trim());
    clipe.disabled = true;
    try {
      // sem Content-Type: o navegador define o boundary do multipart
      const resposta = await fetch(`${config.base}/api/widget/anexos`, {
        method: "POST",
        headers: { "X-Sessao": token },
        body: dados,
      });
      if (resposta.status === 401) return reiniciarSessao();
      if (resposta.status === 413) throw new Error("arquivo grande demais");
      if (!resposta.ok) throw new Error("não foi possível enviar o arquivo");
      texto.value = "";
      desenhar(await resposta.json());
    } catch (erro) {
      mostrarAviso(erro.message);
    } finally {
      clipe.disabled = false;
      campoArquivo.value = "";
    }
  });

  texto.addEventListener("keydown", (evento) => {
    if (evento.key === "Enter" && !evento.shiftKey && !evento.isComposing) {
      evento.preventDefault();
      formulario.requestSubmit();
    }
  });

  async function abrirConversa() {
    apresentacao.style.display = "none";
    conversa.style.display = "flex";
    formulario.style.display = "flex";
    // o cursor ANTES do histórico: o que chegar enquanto ele carrega vem
    // pelos eventos (e o que vier repetido é descartado pelo id)
    await eventos.preparar();
    const chegadas = new Map();
    durante = chegadas;
    try {
      const resposta = await fetch(`${config.base}/api/widget/mensagens`, {
        headers: { "X-Sessao": token },
      });
      if (resposta.status === 401) return reiniciarSessao();
      if (!resposta.ok) throw new Error();
      const historico = await resposta.json();
      if (durante !== chegadas) return; // outra abertura começou no meio
      // o histórico é um retrato de quando o servidor o montou: a resposta
      // que chegou pelos eventos depois disso já passou do cursor e não
      // volta. Então a tela nova é o histórico MAIS o que chegou no meio
      const vistos = new Set(historico.map((m) => m.id));
      const todas = historico.concat([...chegadas.values()].filter((m) => !vistos.has(m.id)));
      todas.sort((a, b) => a.id - b.id);
      durante = null;
      conversa.replaceChildren();
      mostradas.clear();
      todas.forEach(desenhar);
    } catch (erro) {
      mostrarAviso("não foi possível carregar o histórico");
    } finally {
      if (durante === chegadas) durante = null;
    }
    eventos.iniciar();
    texto.focus();
  }

  function reiniciarSessao() {
    try {
      localStorage.removeItem(CHAVE_ARMAZENAMENTO);
    } catch (erro) {
      /* nada a limpar */
    }
    token = null;
    eventos.fechar();
    apresentacao.style.display = "grid";
    conversa.style.display = "none";
    formulario.style.display = "none";
    mostrarAviso("sua conversa anterior expirou; comece de novo");
  }

  // ---------------------------------------------------------------- desenho
  /** "Ana · Suporte técnico" de quem respondeu (gravado no envio). */
  function quemRespondeu(mensagem) {
    const assinatura = mensagem.assinatura;
    if (assinatura && assinatura.nome) return { nome: assinatura.nome, setor: assinatura.setor || null };
    return mensagem.autor ? { nome: mensagem.autor, setor: null } : null;
  }

  function desenhar(mensagem) {
    if (durante && mensagem.id !== undefined) durante.set(mensagem.id, mensagem);
    if (mensagem.id !== undefined) {
      if (mostradas.has(mensagem.id)) return;
      mostradas.add(mensagem.id);
    }
    const elemento = el("div", { classe: `msg ${mensagem.direcao}` });
    const quem = mensagem.direcao === "saida" ? quemRespondeu(mensagem) : null;
    if (quem) {
      const autor = el("span", { classe: "autor" }, el("b", { texto: quem.nome }));
      if (quem.setor) autor.append(el("span", { classe: "setor", texto: ` · ${quem.setor}` }));
      elemento.appendChild(autor);
      // o topo da janela diz com quem se está falando agora
      subtitulo.textContent = `Você está falando com ${quem.nome}${quem.setor ? ` · ${quem.setor}` : ""}`;
    }
    if (mensagem.conteudo) elemento.appendChild(document.createTextNode(mensagem.conteudo));
    for (const anexo of mensagem.anexos || []) {
      if (!anexo.url) continue; // arquivo que não chegou a ser guardado
      // o id basta: o widget monta a própria URL, com o token da sessão
      const endereco = `${config.base}/api/widget/anexos/${Number(anexo.id)}?token=${encodeURIComponent(token)}`;
      if (anexo.imagem) {
        const imagem = el("img", { src: endereco, alt: anexo.nome });
        imagem.addEventListener("click", () => window.open(endereco, "_blank", "noopener"));
        imagem.addEventListener("load", rolarParaFim);
        elemento.appendChild(imagem);
      } else {
        elemento.appendChild(el("a", { classe: "arquivo", href: endereco, download: anexo.nome, texto: `📄 ${anexo.nome}` }));
      }
    }
    conversa.appendChild(elemento);
    rolarParaFim();
  }

  function rolarParaFim() {
    conversa.scrollTop = conversa.scrollHeight;
  }

  let temporizadorAviso = null;
  function mostrarAviso(mensagem) {
    aviso.textContent = mensagem;
    aviso.style.display = "block";
    clearTimeout(temporizadorAviso);
    temporizadorAviso = setTimeout(() => (aviso.style.display = "none"), 4000);
  }

  // --------------------------------------------------------------- eventos
  // Cópia enxuta de app/web/eventos.js (ver o comentário do topo).
  const eventos = (function () {
    const INTERVALO = 2000;
    const LIMITE = 200; // o padrão do servidor por consulta
    let modo = null; // "stream" | "consulta"
    let perguntaModo = null;
    let cursor = null;
    let fonte = null;
    let temporizador = null;
    let ativo = false;
    let falhas = 0;
    let pedindo = false;

    const url = (caminho, depois) =>
      `${config.base}${caminho}?token=${encodeURIComponent(token)}${depois === null ? "" : `&depois=${depois}`}`;

    /* Uma pergunta só, e a resposta fica: sem isto, uma falha deixava o
       modo sem definir, e a volta da aba (que só religa a consulta) nunca
       mais pedia nada. Na falha fica "consulta", que funciona nos dois
       servidores (o Python também responde /api/widget/eventos/desde). */
    function descobrirModo() {
      if (modo) return Promise.resolve(modo);
      if (!perguntaModo) {
        perguntaModo = fetch(`${config.base}/api/widget/saude`, { cache: "no-store" })
          .then((resposta) => (resposta.ok ? resposta.json() : {}))
          .catch(() => ({}))
          .then((dados) => {
            modo = dados.eventos === "stream" && "EventSource" in window ? "stream" : "consulta";
            return modo;
          });
      }
      return perguntaModo;
    }

    async function perguntar(depois) {
      const resposta = await fetch(url("/api/widget/eventos/desde", depois), { cache: "no-store" });
      if (resposta.status === 401) {
        const erro = new Error("sessão");
        erro.sessao = true;
        throw erro;
      }
      if (!resposta.ok) throw new Error(String(resposta.status));
      return resposta.json();
    }

    function entregar(id, mensagem) {
      if (cursor !== null && id <= cursor) return;
      cursor = id;
      chegou(mensagem);
    }

    async function preparar() {
      await descobrirModo();
      if (cursor !== null || !token) return;
      try {
        cursor = Number((await perguntar(null)).ultimo) || 0;
      } catch (erro) {
        if (erro.sessao) reiniciarSessao();
      }
    }

    async function iniciar() {
      if (ativo || !token) return;
      ativo = true;
      const forma = await descobrirModo();
      if (!ativo) return;
      if (forma === "stream") abrirFluxo();
      else consultar();
    }

    function abrirFluxo() {
      if (!ativo) return;
      if (fonte) fonte.close();
      const atual = new EventSource(url("/api/widget/stream", cursor));
      fonte = atual;
      atual.onopen = () => (falhas = 0);
      atual.addEventListener("mensagem.nova", (evento) => {
        let mensagem;
        try { mensagem = JSON.parse(evento.data); } catch (erro) { return; }
        const id = Number(evento.lastEventId);
        if (Number.isFinite(id) && id > 0) entregar(id, mensagem);
        else chegou(mensagem);
      });
      atual.onerror = () => {
        if (fonte !== atual || atual.readyState !== EventSource.CLOSED) return; // o navegador reconecta com Last-Event-ID
        atual.close();
        fonte = null;
        falhas += 1;
        // fechado de vez: a sessão pode ter expirado; confere e tenta de novo do cursor
        perguntar(null)
          .catch((erro) => erro.sessao && reiniciarSessao())
          .finally(() => ativo && (temporizador = setTimeout(abrirFluxo, espera())));
      };
    }

    function espera() {
      return Math.min(30000, INTERVALO * 2 ** Math.min(falhas, 4));
    }

    async function consultar() {
      clearTimeout(temporizador);
      if (!ativo || pedindo) return;
      // aba oculta: para de perguntar; ao voltar, busca na hora do cursor
      if (document.hidden) return;
      pedindo = true;
      try {
        if (cursor === null) await preparar();
        const pedido = cursor;
        const dados = await perguntar(pedido);
        falhas = 0;
        for (const evento of dados.eventos || []) {
          if (evento.tipo === "mensagem.nova") entregar(Number(evento.id), evento.dados);
        }
        const ultimo = Number(dados.ultimo);
        if (Number.isFinite(ultimo) && (cursor === null || ultimo > cursor)) cursor = ultimo;
        pedindo = false;
        // o servidor lê até 200 ids e só devolve os do visitante: quase nunca
        // vêm 200 eventos, mas o cursor anda 200 quando havia mais a ler
        // (depois da aba oculta, por exemplo). Aí pergunta de novo na hora
        const cheio =
          (dados.eventos || []).length >= LIMITE || (pedido !== null && Number.isFinite(ultimo) && ultimo - pedido >= LIMITE);
        if (ativo) temporizador = setTimeout(consultar, cheio ? 0 : INTERVALO);
      } catch (erro) {
        pedindo = false;
        if (erro.sessao) return reiniciarSessao();
        falhas += 1;
        if (ativo) temporizador = setTimeout(consultar, espera());
      }
    }

    document.addEventListener("visibilitychange", () => {
      // no stream o navegador cuida da conexão; nos outros casos, pergunta já
      if (!document.hidden && ativo && modo !== "stream") consultar();
    });

    function fechar() {
      ativo = false;
      cursor = null;
      clearTimeout(temporizador);
      if (fonte) fonte.close();
      fonte = null;
    }

    return { preparar, iniciar, fechar };
  })();

  /** Resposta do atendente (o filtro do servidor só manda as do visitante). */
  function chegou(mensagem) {
    if (conversa.style.display !== "none") desenhar({ ...mensagem, direcao: "saida" });
    if (!aberto) bolha.textContent = "🔔";
  }

  if (token) {
    // sessão já existente: a bolha avisa quando o atendente responder
    eventos.preparar().then(() => eventos.iniciar());
  }
})();
