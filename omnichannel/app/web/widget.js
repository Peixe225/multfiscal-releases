/* OmniChannel 2 - widget de webchat para incorporar no site.
 *
 *   <script src="https://SEU-HOST/widget.js"
 *           data-chave="wc_..."            chave pública do canal de webchat
 *           data-titulo="Suporte"
 *           data-cor="#2c5cf6"
 *           data-saudacao="Como podemos ajudar?"></script>
 *
 * Tudo vive dentro de um shadow root, então o CSS do site não interfere no
 * widget e o do widget não vaza para o site.
 */
(function () {
  "use strict";

  const script = document.currentScript;
  const config = {
    chave: script.dataset.chave,
    titulo: script.dataset.titulo || "Fale com a gente",
    cor: script.dataset.cor || "#2c5cf6",
    saudacao: script.dataset.saudacao || "Olá! Como podemos ajudar?",
    base: new URL(script.src).origin,
  };

  if (!config.chave) {
    console.error("OmniChannel: informe data-chave no <script> do widget.");
    return;
  }

  const CHAVE_ARMAZENAMENTO = `omni_widget_${config.chave}`;
  let token = null;
  try {
    token = localStorage.getItem(CHAVE_ARMAZENAMENTO);
  } catch (erro) {
    token = null; // navegação privada ou cookies bloqueados
  }
  let fonte = null;
  let aberto = false;

  const hospedeiro = document.createElement("div");
  hospedeiro.style.cssText = "position:fixed;bottom:0;right:0;z-index:2147483000";
  const raiz = hospedeiro.attachShadow({ mode: "open" });
  document.body.appendChild(hospedeiro);

  raiz.innerHTML = `
    <style>
      :host, * { box-sizing: border-box; }
      .bolha {
        position: fixed; bottom: 20px; right: 20px; width: 58px; height: 58px;
        border-radius: 50%; border: 0; cursor: pointer; color: #fff; background: ${config.cor};
        box-shadow: 0 6px 24px rgba(0,0,0,.24); font-size: 24px; line-height: 1;
        display: grid; place-items: center; transition: transform .15s ease;
      }
      .bolha:hover { transform: scale(1.06); }
      .janela {
        position: fixed; bottom: 90px; right: 20px; width: min(370px, calc(100vw - 32px));
        height: min(540px, calc(100vh - 120px));
        background: #fff; color: #131a2a; border-radius: 16px; overflow: hidden;
        box-shadow: 0 18px 60px rgba(0,0,0,.28); display: none;
        grid-template-rows: auto 1fr auto;
        font: 15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      }
      .janela.aberta { display: grid; }
      header { background: ${config.cor}; color: #fff; padding: 14px 16px; }
      header b { display: block; font-size: 15px; }
      header span { font-size: 12px; opacity: .85; }
      .conversa { overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 8px; background: #f5f7fb; }
      .msg { max-width: 84%; padding: 9px 12px; border-radius: 14px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; }
      .msg.entrada { align-self: flex-end; background: ${config.cor}; color: #fff; border-bottom-right-radius: 4px; }
      .msg.saida { align-self: flex-start; background: #fff; border: 1px solid #e2e7f0; border-bottom-left-radius: 4px; }
      .msg .autor { display: block; font-size: 11px; opacity: .7; margin-bottom: 2px; }
      form { display: flex; gap: 8px; padding: 12px; border-top: 1px solid #e2e7f0; background: #fff; align-items: center; }
      .clipe {
        border: 1px solid #dde3ef; background: #f5f7fb; border-radius: 10px;
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
        flex: 1; border: 1px solid #dde3ef; border-radius: 10px; padding: 9px 11px;
        font: inherit; resize: none; min-width: 0;
      }
      button.enviar { border: 0; background: ${config.cor}; color: #fff; border-radius: 10px; padding: 0 16px; cursor: pointer; font-weight: 600; }
      .apresentacao { padding: 16px; display: grid; gap: 10px; align-content: start; background: #f5f7fb; }
      .apresentacao p { margin: 0 0 4px; color: #66708a; font-size: 13px; }
      .aviso { font-size: 12px; color: #d93a3a; padding: 0 14px 8px; background: #f5f7fb; }
      @media (prefers-color-scheme: dark) {
        .janela { background: #161c2e; color: #e8ecf6; }
        .conversa, .apresentacao { background: #0e1220; }
        .msg.saida { background: #1e2740; border-color: #2a3348; }
        form { background: #161c2e; border-color: #2a3348; }
        input, textarea { background: #1e2740; border-color: #2a3348; color: #e8ecf6; }
      }
    </style>

    <button class="bolha" part="bolha" aria-label="Abrir conversa">💬</button>

    <section class="janela" role="dialog" aria-label="${config.titulo}">
      <header><b>${config.titulo}</b><span>Costumamos responder em poucos minutos</span></header>

      <div class="apresentacao" id="apresentacao">
        <p>${config.saudacao}</p>
        <input id="nome" placeholder="Seu nome" autocomplete="name">
        <input id="email" type="email" placeholder="Seu e-mail (opcional)" autocomplete="email">
        <button class="enviar" id="comecar" style="padding:10px">Começar conversa</button>
      </div>

      <div class="conversa" id="conversa" style="display:none"></div>
      <div class="aviso" id="aviso" style="display:none"></div>

      <form id="form" style="display:none">
        <input type="file" id="arquivo" hidden>
        <button type="button" class="clipe" id="clipe" title="Anexar arquivo">📎</button>
        <textarea id="texto" rows="1" placeholder="Escreva sua mensagem…"></textarea>
        <button class="enviar" type="submit">Enviar</button>
      </form>
    </section>
  `;

  const q = (selecao) => raiz.querySelector(selecao);
  const janela = q(".janela");

  q(".bolha").addEventListener("click", () => {
    aberto = !aberto;
    janela.classList.toggle("aberta", aberto);
    q(".bolha").textContent = aberto ? "✕" : "💬";
    if (aberto && token) abrirConversa();
  });

  q("#comecar").addEventListener("click", async () => {
    const corpo = { chave_publica: config.chave };
    const nome = q("#nome").value.trim();
    const email = q("#email").value.trim();
    if (nome) corpo.nome = nome;
    if (email) corpo.email = email;
    try {
      const resposta = await fetch(`${config.base}/api/widget/sessao`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
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
    }
  });

  q("#form").addEventListener("submit", async (evento) => {
    evento.preventDefault();
    const conteudo = q("#texto").value.trim();
    if (!conteudo) return;
    q("#texto").value = "";
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
      q("#texto").value = conteudo;
      mostrarAviso(erro.message);
    }
  });

  q("#clipe").addEventListener("click", () => q("#arquivo").click());

  q("#arquivo").addEventListener("change", async () => {
    const arquivo = q("#arquivo").files?.[0];
    if (!arquivo) return;
    const formulario = new FormData();
    formulario.append("arquivo", arquivo);
    formulario.append("conteudo", q("#texto").value.trim());
    q("#clipe").disabled = true;
    try {
      // sem Content-Type: o navegador define o boundary do multipart
      const resposta = await fetch(`${config.base}/api/widget/anexos`, {
        method: "POST",
        headers: { "X-Sessao": token },
        body: formulario,
      });
      if (resposta.status === 401) return reiniciarSessao();
      if (!resposta.ok) throw new Error("não foi possível enviar o arquivo");
      q("#texto").value = "";
      desenhar(await resposta.json());
    } catch (erro) {
      mostrarAviso(erro.message);
    } finally {
      q("#clipe").disabled = false;
      q("#arquivo").value = "";
    }
  });

  q("#texto").addEventListener("keydown", (evento) => {
    if (evento.key === "Enter" && !evento.shiftKey) {
      evento.preventDefault();
      q("#form").requestSubmit();
    }
  });

  async function abrirConversa() {
    q("#apresentacao").style.display = "none";
    q("#conversa").style.display = "flex";
    q("#form").style.display = "flex";
    try {
      const resposta = await fetch(`${config.base}/api/widget/mensagens`, {
        headers: { "X-Sessao": token },
      });
      if (resposta.status === 401) return reiniciarSessao();
      q("#conversa").innerHTML = "";
      (await resposta.json()).forEach(desenhar);
    } catch (erro) {
      mostrarAviso("não foi possível carregar o histórico");
    }
    escutar();
  }

  function reiniciarSessao() {
    try {
      localStorage.removeItem(CHAVE_ARMAZENAMENTO);
    } catch (erro) {
      /* nada a limpar */
    }
    token = null;
    if (fonte) fonte.close();
    q("#apresentacao").style.display = "grid";
    q("#conversa").style.display = "none";
    q("#form").style.display = "none";
    mostrarAviso("sua conversa anterior expirou; comece de novo");
  }

  function escutar() {
    if (fonte) fonte.close();
    fonte = new EventSource(`${config.base}/api/widget/stream?token=${encodeURIComponent(token)}`);
    fonte.addEventListener("mensagem.nova", (evento) => {
      const mensagem = JSON.parse(evento.data);
      desenhar({ ...mensagem, direcao: "saida" });
      if (!aberto) q(".bolha").textContent = "🔔";
    });
  }

  function desenhar(mensagem) {
    const elemento = document.createElement("div");
    elemento.className = `msg ${mensagem.direcao}`;
    if (mensagem.direcao === "saida" && mensagem.autor) {
      const autor = document.createElement("span");
      autor.className = "autor";
      autor.textContent = mensagem.autor;
      elemento.appendChild(autor);
    }
    if (mensagem.conteudo) elemento.appendChild(document.createTextNode(mensagem.conteudo));
    for (const anexo of mensagem.anexos || []) {
      // o id basta: o widget monta a própria URL, com o token da sessão
      const endereco = `${config.base}/api/widget/anexos/${anexo.id}?token=${encodeURIComponent(token)}`;
      if (anexo.imagem) {
        const imagem = document.createElement("img");
        imagem.src = endereco;
        imagem.alt = anexo.nome;
        imagem.onclick = () => window.open(endereco, "_blank", "noopener");
        elemento.appendChild(imagem);
      } else {
        const link = document.createElement("a");
        link.className = "arquivo";
        link.href = endereco;
        link.download = anexo.nome;
        link.textContent = `📄 ${anexo.nome}`;
        elemento.appendChild(link);
      }
    }
    const conversa = q("#conversa");
    conversa.appendChild(elemento);
    conversa.scrollTop = conversa.scrollHeight;
  }

  function mostrarAviso(texto) {
    const aviso = q("#aviso");
    aviso.textContent = texto;
    aviso.style.display = "block";
    setTimeout(() => (aviso.style.display = "none"), 4000);
  }

  if (token) {
    // sessão já existente: a bolha avisa quando o atendente responder
    escutar();
  }
})();
