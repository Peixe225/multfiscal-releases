/* OmniChannel 2 - simulador de clientes.
   Faz o papel do contato: o que se escreve aqui entra pelo adaptador do canal,
   como um webhook de verdade, e a resposta do atendente volta pelo mesmo fluxo
   de eventos que alimenta o painel. Sem framework, como o painel. */

const PERSONAS = [
  { id: "ian", nome: "Ian Dantas", tipo: "whatsapp", identificador: "5533991269149" },
  { id: "marcos", nome: "Marcos Contabilidade", tipo: "telegram", identificador: "884412" },
  { id: "financeiro", nome: "Financeiro Loja Exemplo", tipo: "email", identificador: "financeiro@lojaexemplo.com.br" },
  { id: "novo", nome: "Novo cliente", tipo: null },
];

const NOMES_CANAL = { whatsapp: "WhatsApp", telegram: "Telegram", email: "E-mail", webchat: "Webchat" };

const CAMPO_IDENTIFICADOR = {
  whatsapp: { rotulo: "Número com DDI e DDD", exemplo: "55 11 91234-5678", tipo: "tel" },
  telegram: { rotulo: "ID do chat (negativo para grupos)", exemplo: "123456789", tipo: "text" },
  email: { rotulo: "E-mail", exemplo: "cliente@empresa.com.br", tipo: "email" },
};

// o que o cliente nunca vê: conversa da equipe e envio que o provedor recusou
const INTERNAS = new Set(["nota_interna", "sistema"]);

const CHAVE_PREFERENCIAS = "omni_simulador";

const estado = {
  token: lerArmazenado("omni_token"),
  canais: [],
  personaId: "ian",
  canalPorPersona: {},
  novo: { identificador: "", nome: "" },
  contatoId: null,
  conversas: new Map(), // conversa_id -> assunto (o e-mail mostra em cada cartão)
  mostradas: new Set(),
  ultimoDia: null,
  geracao: 0, // descarta a resposta de um histórico pedido antes de trocar de cliente
  fonte: null,
  jaConectou: false, // depois da primeira conexão, reconectar pede o que se perdeu
  naoVistas: 0,
};

const $ = (selecao) => document.querySelector(selecao);
const criar = (tag, classe, texto) => {
  const elemento = document.createElement(tag);
  if (classe) elemento.className = classe;
  if (texto !== undefined) elemento.textContent = texto;
  return elemento;
};

/* ------------------------------------------------------------ armazenamento */
// localStorage pode não existir (aba anônima, bloqueio): o simulador segue sem ele
function lerArmazenado(chave) {
  try { return localStorage.getItem(chave); } catch { return null; }
}
function gravarArmazenado(chave, valor) {
  try {
    if (valor === null) localStorage.removeItem(chave);
    else localStorage.setItem(chave, valor);
  } catch { /* sem armazenamento, só não lembra */ }
}

function lembrarPreferencias() {
  gravarArmazenado(CHAVE_PREFERENCIAS, JSON.stringify({
    personaId: estado.personaId, canalPorPersona: estado.canalPorPersona, novo: estado.novo,
  }));
}

function recuperarPreferencias() {
  try {
    const salvas = JSON.parse(lerArmazenado(CHAVE_PREFERENCIAS) || "{}");
    if (PERSONAS.some((p) => p.id === salvas.personaId)) estado.personaId = salvas.personaId;
    if (salvas.canalPorPersona) estado.canalPorPersona = salvas.canalPorPersona;
    if (salvas.novo) estado.novo = { identificador: salvas.novo.identificador || "", nome: salvas.novo.nome || "" };
  } catch { /* preferência corrompida: começa do zero */ }
}

/* -------------------------------------------------------------------- rede */
class ErroApi extends Error {
  constructor(mensagem, situacao) {
    super(mensagem);
    this.situacao = situacao;
  }
}

async function api(metodo, caminho, corpo) {
  const resposta = await fetch(caminho, {
    method: metodo,
    headers: {
      "Content-Type": "application/json",
      ...(estado.token ? { Authorization: `Bearer ${estado.token}` } : {}),
    },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  if (resposta.status === 401) {
    mostrarLogin();
    throw new ErroApi("sessão expirada: entre de novo", 401);
  }
  if (!resposta.ok) {
    const detalhe = await resposta.json().catch(() => ({}));
    // erros do pydantic chegam como lista; os nossos, como frase
    const texto = typeof detalhe.detail === "string" ? detalhe.detail : `falha na requisição (${resposta.status})`;
    throw new ErroApi(texto, resposta.status);
  }
  return resposta.status === 204 ? null : resposta.json();
}

function avisar(mensagem, falha = false) {
  const aviso = criar("div", `aviso${falha ? " falha" : ""}`, mensagem);
  aviso.setAttribute("role", "status");
  document.body.appendChild(aviso);
  setTimeout(() => aviso.remove(), 4000);
}

/* ------------------------------------------------------------------- telas */
function mostrarTela(id) {
  for (const tela of ["#tela-carregando", "#tela-login", "#tela-desligado", "#app"]) {
    $(tela).hidden = tela !== id;
  }
  $("#usuario").hidden = id !== "#app";
}

function mostrarLogin() {
  if (estado.fonte) estado.fonte.close();
  estado.fonte = null;
  mostrarTela("#tela-login");
  $("#form-login [name=email]").focus();
}

$("#form-login").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const dados = Object.fromEntries(new FormData(evento.target));
  const botao = evento.target.querySelector("button");
  botao.disabled = true;
  $("#erro-login").textContent = "";
  try {
    const resposta = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dados),
    });
    if (!resposta.ok) throw new Error("E-mail ou senha inválidos.");
    const { token } = await resposta.json();
    // mesma chave do painel: quem entra aqui abre o painel já logado
    gravarArmazenado("omni_token", token);
    estado.token = token;
    await iniciar();
  } catch (erro) {
    $("#erro-login").textContent = erro.message;
  } finally {
    botao.disabled = false;
  }
});

$("#trocar").addEventListener("click", () => {
  gravarArmazenado("omni_token", null);
  estado.token = null;
  mostrarLogin();
});

/* ------------------------------------------------------------------ início */
async function iniciar() {
  if (!estado.token) return mostrarLogin();
  mostrarTela("#tela-carregando");
  let atendente;
  try {
    atendente = await api("GET", "/api/auth/eu");
    estado.canais = await api("GET", "/api/simulador/canais");
  } catch (erro) {
    if (erro.situacao === 401) return; // api() já trocou para o login
    if (erro.situacao === 404) return mostrarTela("#tela-desligado");
    $("#tela-carregando p").textContent = `Não foi possível carregar o simulador: ${erro.message}`;
    return;
  }
  $("#nome-atendente").textContent = atendente.nome;
  mostrarTela("#app");
  recuperarPreferencias();
  conectarEventos();
  selecionarPersona(estado.personaId);
}

/* -------------------------------------------------------------- personas */
const personaAtual = () => PERSONAS.find((p) => p.id === estado.personaId);

function canaisDaPersona(persona) {
  return persona.tipo ? estado.canais.filter((c) => c.tipo === persona.tipo) : estado.canais;
}

function canalAtual() {
  const id = estado.canalPorPersona[estado.personaId];
  return estado.canais.find((c) => c.id === id && c.disponivel) || null;
}

function escolherCanalPadrao(persona) {
  if (canalAtual()) return;
  const primeiro = canaisDaPersona(persona).find((c) => c.disponivel);
  estado.canalPorPersona[persona.id] = primeiro ? primeiro.id : null;
}

function selecionarPersona(id) {
  estado.personaId = id;
  const persona = personaAtual();
  escolherCanalPadrao(persona);
  desenharPersonas();
  desenharCanais();
  prepararFormNovo();
  lembrarPreferencias();
  carregarConversa();
}

function iniciais(nome) {
  return nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
}

function telefoneLegivel(numero) {
  const d = numero.replace(/\D/g, "");
  if (d.startsWith("55") && d.length === 13) return `+55 ${d.slice(2, 4)} ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.startsWith("55") && d.length === 12) return `+55 ${d.slice(2, 4)} ${d.slice(4, 8)}-${d.slice(8)}`;
  return `+${d}`;
}

function identificadorLegivel(tipo, identificador) {
  return tipo === "whatsapp" ? telefoneLegivel(identificador) : identificador;
}

function desenharPersonas() {
  const alvo = $("#personas");
  alvo.replaceChildren();
  for (const persona of PERSONAS) {
    const botao = criar("button", "persona");
    botao.type = "button";
    botao.classList.toggle("ativo", persona.id === estado.personaId);
    botao.onclick = () => selecionarPersona(persona.id);

    const avatar = criar("span", `avatar tipo-${persona.tipo || "novo"}`, persona.tipo ? iniciais(persona.nome) : "+");
    const corpo = criar("span", "corpo");
    corpo.append(criar("div", "nome", persona.nome));

    if (persona.tipo) {
      const semCanal = !canaisDaPersona(persona).some((c) => c.disponivel);
      botao.classList.toggle("esmaecido", semCanal);
      const linha = semCanal
        ? `nenhum canal de ${NOMES_CANAL[persona.tipo]} disponível`
        : `${NOMES_CANAL[persona.tipo]} · ${identificadorLegivel(persona.tipo, persona.identificador)}`;
      corpo.append(criar("div", "linha", linha));
    } else {
      corpo.append(criar("div", "linha", estado.novo.identificador || "canal, número e nome livres"));
    }
    botao.append(avatar, corpo);
    alvo.append(botao);
  }
}

function desenharCanais() {
  const alvo = $("#canais");
  alvo.replaceChildren();
  const persona = personaAtual();
  const lista = canaisDaPersona(persona);
  if (!lista.length) {
    const tipo = persona.tipo ? NOMES_CANAL[persona.tipo] : "nenhum tipo";
    alvo.append(criar("p", "vazio-lista", `Nenhum canal ativo de ${tipo}. Cadastre um no painel.`));
    return;
  }
  const escolhido = estado.canalPorPersona[persona.id];
  for (const canal of lista) {
    const botao = criar("button", "canal");
    botao.type = "button";
    botao.disabled = !canal.disponivel;
    botao.classList.toggle("esmaecido", !canal.disponivel);
    botao.classList.toggle("ativo", canal.disponivel && canal.id === escolhido);
    botao.onclick = () => {
      // um número de WhatsApp não serve de e-mail: trocar de tipo zera o campo
      if (!persona.tipo && canalAtual()?.tipo !== canal.tipo) estado.novo.identificador = "";
      estado.canalPorPersona[persona.id] = canal.id;
      desenharCanais();
      prepararFormNovo();
      lembrarPreferencias();
      carregarConversa();
    };

    const corpo = criar("span", "corpo");
    corpo.append(criar("div", "nome", canal.nome));
    if (!canal.disponivel) {
      const motivo = criar("div", "linha", canal.motivo || "indisponível");
      // o webchat tem página própria de teste; o motivo já diz qual
      if (canal.link && canal.link.startsWith("/")) {
        motivo.textContent = "tem widget de verdade: ";
        const link = criar("a", "", "abrir o widget ↗");
        link.href = canal.link;
        link.target = "_blank";
        link.rel = "noopener";
        motivo.append(link);
      }
      corpo.append(motivo);
    } else if (!persona.tipo) {
      corpo.append(criar("div", "linha", "modo sandbox: nada sai para o provedor"));
    }
    botao.append(corpo, criar("span", `selo canal-${canal.tipo}`, NOMES_CANAL[canal.tipo] || canal.tipo));
    alvo.append(botao);
  }
}

/* ---------------------------------------------------------- novo cliente */
function prepararFormNovo() {
  const form = $("#form-novo");
  const novo = estado.personaId === "novo";
  form.hidden = !novo;
  if (!novo) return;
  const canal = canalAtual();
  const campo = canal ? CAMPO_IDENTIFICADOR[canal.tipo] : null;
  const entrada = $("#novo-identificador");
  $("#rotulo-identificador").textContent = campo ? campo.rotulo : "Escolha um canal abaixo";
  entrada.placeholder = campo ? campo.exemplo : "";
  entrada.type = campo ? campo.tipo : "text";
  entrada.disabled = !campo;
  entrada.value = estado.novo.identificador;
  $("#novo-nome").value = estado.novo.nome;
  $("#erro-novo").textContent = "";
}

$("#form-novo").addEventListener("submit", (evento) => {
  evento.preventDefault();
  estado.novo = {
    identificador: $("#novo-identificador").value.trim(),
    nome: $("#novo-nome").value.trim(),
  };
  $("#erro-novo").textContent = "";
  lembrarPreferencias();
  desenharPersonas();
  carregarConversa();
});

function clienteAtual() {
  const persona = personaAtual();
  const canal = canalAtual();
  if (!canal) return null;
  if (persona.tipo) return { canal, identificador: persona.identificador, nome: persona.nome };
  if (!estado.novo.identificador) return null;
  return { canal, identificador: estado.novo.identificador, nome: estado.novo.nome || null };
}

/* ---------------------------------------------------------------- celular */
function vestirCelular(cliente) {
  const canal = cliente?.canal || canalAtual();
  const tipo = canal?.tipo || personaAtual().tipo || "whatsapp";
  $("#celular").dataset.tipo = tipo;
  $("#tela-avatar").textContent = canal ? iniciais(canal.nome) : "?";
  $("#tela-nome").textContent = canal ? canal.nome : "Sem canal";
  const subtitulos = { whatsapp: "Conta comercial", telegram: "bot", email: "Caixa de entrada do cliente" };
  $("#tela-sub").textContent = subtitulos[tipo] || "";
  $("#assunto").hidden = tipo !== "email";
  $("#texto").placeholder = tipo === "email" ? "Escreva o e-mail…" : "Mensagem";

  const quem = $("#quem");
  quem.replaceChildren();
  if (cliente) {
    quem.append("Você é ", criar("b", "", cliente.nome || "cliente sem nome"), ` · ${identificadorLegivel(tipo, cliente.identificador)} · escrevendo para `, criar("b", "", canal.nome));
  } else {
    quem.textContent = "Escolha quem você é e por qual canal.";
  }
}

function travarRedator(motivo) {
  const travado = Boolean(motivo);
  $("#texto").disabled = travado;
  $("#enviar").disabled = travado;
  $("#assunto").disabled = travado;
  if (travado) $("#texto").placeholder = motivo;
}

function limparConversa() {
  estado.mostradas.clear();
  estado.conversas.clear();
  estado.ultimoDia = null;
  $("#conversa").replaceChildren();
}

function mostrarVazio(texto) {
  const conversa = $("#conversa");
  conversa.querySelector(".tela-vazia")?.remove();
  conversa.append(criar("p", "tela-vazia", texto));
}

async function carregarConversa() {
  const geracao = ++estado.geracao;
  const cliente = clienteAtual();
  estado.contatoId = null;
  limparConversa();
  vestirCelular(cliente);

  if (!cliente) {
    const persona = personaAtual();
    if (!canalAtual()) {
      const tipo = persona.tipo ? `de ${NOMES_CANAL[persona.tipo]} ` : "";
      mostrarVazio(`Nenhum canal ${tipo}disponível para simular. Veja o motivo na lista de canais.`);
      travarRedator("Sem canal disponível");
    } else {
      mostrarVazio("Preencha quem é o novo cliente e clique em “Abrir a conversa”.");
      travarRedator("Preencha quem é o cliente");
    }
    return;
  }
  travarRedator(null);

  try {
    const parametros = new URLSearchParams({ canal_id: cliente.canal.id, identificador: cliente.identificador });
    const resposta = await api("GET", `/api/simulador/conversa?${parametros}`);
    if (geracao !== estado.geracao) return; // trocou de cliente no meio do caminho
    estado.contatoId = resposta.contato_id;
    desenharHistorico(resposta.mensagens);
    if (!resposta.mensagens.length) {
      mostrarVazio("Nenhuma mensagem ainda. Escreva abaixo como se fosse o cliente.");
    }
    preencherAssunto(resposta.mensagens);
  } catch (erro) {
    if (geracao !== estado.geracao || erro.situacao === 401) return;
    if (estado.personaId === "novo") {
      $("#erro-novo").textContent = erro.message;
      mostrarVazio("Confira o identificador ao lado.");
      travarRedator("Identificador inválido");
    } else {
      mostrarVazio(`Não foi possível carregar a conversa: ${erro.message}`);
    }
  }
}

function preencherAssunto(mensagens) {
  // e-mail respondido mantém a thread: o assunto segue o da conversa
  const campo = $("#assunto");
  const ultimo = [...mensagens].reverse().find((m) => m.assunto);
  campo.value = ultimo ? (/^re:/i.test(ultimo.assunto) ? ultimo.assunto : `Re: ${ultimo.assunto}`) : "";
}

function desenharHistorico(mensagens) {
  limparConversa();
  for (const mensagem of mensagens) acrescentar(mensagem, false);
  rolarParaFim();
}

function visivelParaCliente(mensagem) {
  return !INTERNAS.has(mensagem.tipo) && mensagem.status !== "falhou";
}

function acrescentar(mensagem, animar = true) {
  if (estado.mostradas.has(mensagem.id) || !visivelParaCliente(mensagem)) return;
  estado.mostradas.add(mensagem.id);
  if (!estado.conversas.has(mensagem.conversa_id) || mensagem.assunto) {
    estado.conversas.set(mensagem.conversa_id, mensagem.assunto || estado.conversas.get(mensagem.conversa_id) || null);
  }
  const conversa = $("#conversa");
  conversa.querySelector(".tela-vazia")?.remove();

  const dia = data(mensagem.criada_em).toDateString();
  if (dia !== estado.ultimoDia) {
    conversa.append(criar("div", "dia", diaLegivel(mensagem.criada_em)));
    estado.ultimoDia = dia;
  }
  const elemento = $("#celular").dataset.tipo === "email" ? cartaoEmail(mensagem) : balao(mensagem);
  if (animar) elemento.classList.add("nova");
  conversa.append(elemento);
}

function rolarParaFim() {
  const conversa = $("#conversa");
  conversa.scrollTop = conversa.scrollHeight;
}

function balao(mensagem) {
  const minha = mensagem.direcao === "entrada";
  const elemento = criar("div", `msg ${minha ? "minha" : "deles"}`);
  elemento.dataset.id = mensagem.id;
  // o nome do atendente ajuda quem testa; o cliente real veria só a empresa
  if (!minha && mensagem.autor) elemento.append(criar("div", "autor", mensagem.autor));
  if (mensagem.conteudo) elemento.append(criar("div", "texto", mensagem.conteudo));
  if (mensagem.anexos?.length) elemento.append(desenharAnexos(mensagem.anexos));
  elemento.append(criar("div", "meta", `${hora(mensagem.criada_em)}${minha ? " ✓✓" : ""}`));
  return elemento;
}

function cartaoEmail(mensagem) {
  const minha = mensagem.direcao === "entrada";
  const cliente = clienteAtual();
  const canal = cliente?.canal;
  const elemento = criar("article", `carta ${minha ? "minha" : "deles"}`);
  elemento.dataset.id = mensagem.id;

  const assunto = estado.conversas.get(mensagem.conversa_id) || "(sem assunto)";
  const cabecalho = criar("div", "cabecalho");
  cabecalho.append(criar("div", "assunto-linha", minha || /^re:/i.test(assunto) ? assunto : `Re: ${assunto}`));
  const voce = cliente ? `${cliente.nome ? `${cliente.nome} ` : ""}<${cliente.identificador}>` : "você";
  const empresa = canal ? canal.nome : "suporte";
  const de = minha ? voce : `${empresa}${mensagem.autor ? ` (${mensagem.autor})` : ""}`;
  cabecalho.append(criar("div", "", `De: ${de}`));
  cabecalho.append(criar("div", "", `Para: ${minha ? empresa : voce}`));
  cabecalho.append(criar("div", "", dataHora(mensagem.criada_em)));
  elemento.append(cabecalho);

  if (mensagem.conteudo) elemento.append(criar("div", "texto", mensagem.conteudo));
  if (mensagem.anexos?.length) elemento.append(desenharAnexos(mensagem.anexos));
  return elemento;
}

function desenharAnexos(anexos) {
  const caixa = criar("div", "anexos");
  for (const anexo of anexos) {
    // o token vai na query porque <img> e <a download> não mandam cabeçalho
    const endereco = anexo.url ? `${anexo.url}?token=${encodeURIComponent(estado.token)}` : null;
    if (!endereco) {
      const falho = criar("div", "arquivo indisponivel");
      falho.append(criar("span", "", "⚠"));
      const corpo = criar("div");
      corpo.append(criar("div", "nome", anexo.nome), criar("div", "tamanho", anexo.erro || "arquivo não recuperado"));
      falho.append(corpo);
      caixa.append(falho);
      continue;
    }
    if (anexo.imagem) {
      const imagem = criar("img");
      imagem.src = endereco;
      imagem.alt = anexo.nome;
      imagem.loading = "lazy";
      imagem.onload = rolarParaFim; // a altura só existe depois de carregar
      imagem.onclick = () => window.open(endereco, "_blank", "noopener");
      caixa.append(imagem);
      continue;
    }
    const link = criar("a", "arquivo");
    link.href = endereco;
    link.download = anexo.nome;
    link.append(criar("span", "", "📄"));
    const corpo = criar("div");
    corpo.append(criar("div", "nome", anexo.nome), criar("div", "tamanho", tamanhoLegivel(anexo.tamanho)));
    link.append(corpo);
    caixa.append(link);
  }
  return caixa;
}

function tamanhoLegivel(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

/* ------------------------------------------------------------------ envio */
$("#redator").addEventListener("submit", (evento) => {
  evento.preventDefault();
  enviar();
});

$("#texto").addEventListener("keydown", (evento) => {
  if (evento.key === "Enter" && !evento.shiftKey && !evento.isComposing) {
    evento.preventDefault();
    enviar();
  }
});

$("#texto").addEventListener("input", ajustarAltura);

function ajustarAltura() {
  const campo = $("#texto");
  campo.style.height = "auto";
  campo.style.height = `${Math.min(campo.scrollHeight, 132)}px`;
}

async function enviar() {
  const cliente = clienteAtual();
  const campo = $("#texto");
  const conteudo = campo.value.trim();
  if (!cliente || !conteudo || $("#enviar").disabled) return;

  const corpo = {
    canal_id: cliente.canal.id,
    identificador: cliente.identificador,
    nome: cliente.nome,
    conteudo,
  };
  if (cliente.canal.tipo === "email") corpo.assunto = $("#assunto").value.trim() || null;

  const geracao = estado.geracao;
  $("#enviar").disabled = true;
  try {
    const mensagem = await api("POST", "/api/simulador/mensagens", corpo);
    // o texto só sai do campo quando o servidor aceitou: nada se perde
    campo.value = "";
    ajustarAltura();
    if (geracao !== estado.geracao) return;
    estado.contatoId = mensagem.contato_id;
    acrescentar(mensagem);
    rolarParaFim();
    if (cliente.canal.tipo === "email" && mensagem.assunto) preencherAssunto([mensagem]);
  } catch (erro) {
    if (erro.situacao !== 401) avisar(erro.message, true);
  } finally {
    $("#enviar").disabled = false;
    campo.focus();
  }
}

/* ----------------------------------------------------------------- eventos */
function conectarEventos() {
  if (estado.fonte) estado.fonte.close();
  const fonte = new EventSource(`/api/eventos/stream?token=${encodeURIComponent(estado.token)}`);
  estado.fonte = fonte;
  const indicador = $("#ao-vivo");

  fonte.onopen = () => {
    indicador.textContent = "ao vivo";
    indicador.classList.add("ligado");
    // o barramento não guarda eventos: o que chegou com o fluxo caído só
    // aparece pedindo o histórico de novo
    if (estado.jaConectou) sincronizar(false);
    estado.jaConectou = true;
  };

  fonte.addEventListener("mensagem.nova", (evento) => {
    const mensagem = JSON.parse(evento.data);
    // o que o cliente escreveu vem da resposta do POST, que traz o assunto;
    // o eco pelo fluxo pode chegar antes dela e desenharia o cartão sem ele
    if (mensagem.direcao !== "saida") return;
    if (!estado.contatoId || mensagem.contato_id !== estado.contatoId) return;
    if (!visivelParaCliente(mensagem)) return;
    if (estado.conversas.has(mensagem.conversa_id)) {
      acrescentar(mensagem);
      rolarParaFim();
      sinalizarNaoVista();
      return;
    }
    // mesmo contato, conversa desconhecida: pode ser de outro canal; o
    // histórico do servidor é quem sabe filtrar por canal
    sincronizar(true);
  });

  fonte.onerror = () => {
    indicador.classList.remove("ligado");
    if (fonte.readyState === EventSource.CLOSED) {
      // resposta que não é 200 (token vencido, por exemplo) não reconecta
      // sozinha: confere a sessão e tenta de novo
      indicador.textContent = "desconectado";
      setTimeout(() => reconectar(fonte), 3000);
    } else {
      indicador.textContent = "reconectando…";
    }
  };
}

async function reconectar(fonte) {
  if (estado.fonte !== fonte) return; // já trocaram de fluxo ou de usuário
  try {
    await api("GET", "/api/auth/eu");
    conectarEventos();
  } catch (erro) {
    if (erro.situacao === 401) return; // o login já está na tela
    setTimeout(() => reconectar(fonte), 5000);
  }
}

async function sincronizar(veioDoAtendente) {
  const cliente = clienteAtual();
  if (!cliente) return;
  const geracao = estado.geracao;
  try {
    const parametros = new URLSearchParams({ canal_id: cliente.canal.id, identificador: cliente.identificador });
    const dados = await api("GET", `/api/simulador/conversa?${parametros}`);
    if (geracao !== estado.geracao) return;
    const novas = dados.mensagens.filter((m) => !estado.mostradas.has(m.id));
    if (!novas.length) return;
    estado.contatoId = dados.contato_id;
    desenharHistorico(dados.mensagens);
    if (veioDoAtendente) sinalizarNaoVista();
  } catch { /* a próxima mensagem tenta de novo */ }
}

// com o simulador em outra aba, o título avisa que o atendente respondeu
const TITULO = document.title;
function sinalizarNaoVista() {
  if (!document.hidden) return;
  estado.naoVistas += 1;
  document.title = `(${estado.naoVistas}) ${TITULO}`;
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  estado.naoVistas = 0;
  document.title = TITULO;
});

/* ------------------------------------------------------------------- datas */
const HORA = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const DATA_HORA = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const DIA = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long" });

// o SQLite devolve datas sem fuso; elas são UTC, e sem o "Z" o navegador as
// leria como hora local
function data(valor) {
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(valor) ? valor : `${valor}Z`);
}
const hora = (valor) => HORA.format(data(valor));
const dataHora = (valor) => DATA_HORA.format(data(valor));

function diaLegivel(valor) {
  const alvo = data(valor);
  const hoje = new Date();
  const ontem = new Date(hoje.getTime() - 86400000);
  if (alvo.toDateString() === hoje.toDateString()) return "Hoje";
  if (alvo.toDateString() === ontem.toDateString()) return "Ontem";
  return DIA.format(alvo);
}

iniciar();
