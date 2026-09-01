/* OmniChannel 2 - painel do atendente.
   Sem framework de propósito: o painel é uma tela só, e o que muda nela chega
   pelo fluxo de eventos do servidor. */

const estado = {
  token: localStorage.getItem("omni_token") || null,
  atendente: null,
  conversas: [],
  atualId: null,
  detalhe: null,
  filtro: { tipo: "aberta" },
  busca: "",
  canais: [],
  etiquetas: [],
  respostas: [],
  atendentes: [],
  modo: "resposta",
  fonte: null,
  marcada: 0,
};

const $ = (selecao) => document.querySelector(selecao);
const criar = (tag, classe, texto) => {
  const elemento = document.createElement(tag);
  if (classe) elemento.className = classe;
  if (texto !== undefined) elemento.textContent = texto;
  return elemento;
};

const FILTROS_FIXOS = [
  { chave: "aberta", rotulo: "Abertas", params: { status: "aberta" } },
  { chave: "minhas", rotulo: "Minhas", params: { atendente: "eu" } },
  { chave: "sem", rotulo: "Sem atendente", params: { atendente: "sem" } },
  { chave: "pendente", rotulo: "Pendentes", params: { status: "pendente" } },
  { chave: "resolvida", rotulo: "Resolvidas", params: { status: "resolvida" } },
  { chave: "todas", rotulo: "Todas", params: {} },
];

const NOMES_CANAL = { whatsapp: "WhatsApp", telegram: "Telegram", email: "E-mail", webchat: "Webchat" };

/* ----------------------------------------------------------------- rede */
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
    sair();
    throw new Error("sessão expirada");
  }
  if (!resposta.ok) {
    const detalhe = await resposta.json().catch(() => ({}));
    throw new Error(detalhe.detail || `falha na requisição (${resposta.status})`);
  }
  return resposta.status === 204 ? null : resposta.json();
}

function avisar(mensagem, falha = false) {
  const aviso = criar("div", `aviso${falha ? " falha" : ""}`, mensagem);
  document.body.appendChild(aviso);
  setTimeout(() => aviso.remove(), 3200);
}

/* ---------------------------------------------------------------- login */
$("#form-login").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const dados = Object.fromEntries(new FormData(evento.target));
  const botao = evento.target.querySelector("button");
  botao.disabled = true;
  try {
    const resposta = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dados),
    });
    if (!resposta.ok) throw new Error("E-mail ou senha inválidos.");
    const { token, atendente } = await resposta.json();
    localStorage.setItem("omni_token", token);
    estado.token = token;
    estado.atendente = atendente;
    await iniciar();
  } catch (erro) {
    $("#erro-login").textContent = erro.message;
  } finally {
    botao.disabled = false;
  }
});

$("#sair").addEventListener("click", sair);

function sair() {
  localStorage.removeItem("omni_token");
  estado.token = null;
  if (estado.fonte) estado.fonte.close();
  $("#app").hidden = true;
  $("#tela-login").hidden = false;
}

/* --------------------------------------------------------------- início */
async function iniciar() {
  $("#tela-login").hidden = true;
  $("#app").hidden = false;

  estado.atendente = estado.atendente || (await api("GET", "/api/auth/eu"));
  $("#nome-atendente").textContent = estado.atendente.nome;
  $("#avatar").textContent = iniciais(estado.atendente.nome);

  [estado.canais, estado.etiquetas, estado.respostas, estado.atendentes] = await Promise.all([
    api("GET", "/api/canais"),
    api("GET", "/api/etiquetas"),
    api("GET", "/api/respostas-rapidas"),
    api("GET", "/api/atendentes"),
  ]);

  desenharFiltros();
  await Promise.all([carregarConversas(), carregarMetricas()]);
  conectarEventos();
}

function iniciais(nome) {
  return nome.split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
}

/* -------------------------------------------------------------- filtros */
function desenharFiltros() {
  const fixos = $("#filtros-fixos");
  fixos.innerHTML = "";
  for (const filtro of FILTROS_FIXOS) {
    const botao = criar("button", "filtro", filtro.rotulo);
    botao.dataset.chave = filtro.chave;
    botao.onclick = () => aplicarFiltro({ tipo: filtro.chave });
    fixos.appendChild(botao);
  }

  const canais = $("#filtros-canais");
  canais.innerHTML = "";
  for (const canal of estado.canais) {
    const botao = criar("button", "filtro");
    botao.dataset.chave = `canal-${canal.id}`;
    botao.append(criar("span", "", canal.nome));
    if (!canal.configurado && canal.tipo !== "webchat") {
      botao.append(criar("span", "contagem", "sandbox"));
    }
    botao.onclick = () => aplicarFiltro({ tipo: "canal", valor: canal.id });
    canais.appendChild(botao);
  }

  const etiquetas = $("#filtros-etiquetas");
  etiquetas.innerHTML = "";
  for (const etiqueta of estado.etiquetas) {
    const botao = criar("button", "filtro");
    botao.dataset.chave = `etiqueta-${etiqueta.id}`;
    const ponto = criar("i", "ponto-etiqueta");
    ponto.style.background = etiqueta.cor;
    botao.append(ponto, criar("span", "", etiqueta.nome));
    botao.onclick = () => aplicarFiltro({ tipo: "etiqueta", valor: etiqueta.id });
    etiquetas.appendChild(botao);
  }
  marcarFiltroAtivo();
}

function chaveDoFiltro() {
  const { tipo, valor } = estado.filtro;
  return tipo === "canal" || tipo === "etiqueta" ? `${tipo}-${valor}` : tipo;
}

function marcarFiltroAtivo() {
  const alvo = chaveDoFiltro();
  document.querySelectorAll(".filtro").forEach((botao) => {
    botao.classList.toggle("ativo", botao.dataset.chave === alvo);
  });
}

function aplicarFiltro(filtro) {
  estado.filtro = filtro;
  marcarFiltroAtivo();
  carregarConversas();
}

$("#busca").addEventListener("input", (evento) => {
  estado.busca = evento.target.value.trim();
  clearTimeout(estado.temporizadorBusca);
  estado.temporizadorBusca = setTimeout(carregarConversas, 300);
});

/* --------------------------------------------------------------- listas */
function parametrosDoFiltro() {
  const { tipo, valor } = estado.filtro;
  if (tipo === "canal") return { canal_id: valor };
  if (tipo === "etiqueta") return { etiqueta_id: valor };
  return FILTROS_FIXOS.find((f) => f.chave === tipo)?.params || {};
}

async function carregarConversas() {
  const parametros = new URLSearchParams(parametrosDoFiltro());
  if (estado.busca) parametros.set("q", estado.busca);
  estado.conversas = await api("GET", `/api/conversas?${parametros}`);
  desenharLista();
}

function desenharLista() {
  const lista = $("#lista-conversas");
  lista.innerHTML = "";
  if (!estado.conversas.length) {
    lista.append(criar("div", "vazio", "Nenhuma conversa neste filtro."));
    return;
  }
  for (const conversa of estado.conversas) lista.appendChild(itemDaLista(conversa));
}

function itemDaLista(conversa) {
  const item = criar("button", "item");
  item.dataset.id = conversa.id;
  if (conversa.id === estado.atualId) item.classList.add("ativo");

  const linha = criar("div", "linha");
  linha.append(criar("strong", "nome", conversa.contato.nome));
  linha.append(criar("span", "quando", quando(conversa.ultima_mensagem_em)));
  item.append(linha, criar("div", "previa", conversa.previa || "—"));

  const rodape = criar("div", "rodape");
  rodape.append(selo(conversa.canal.tipo, NOMES_CANAL[conversa.canal.tipo] || conversa.canal.tipo));
  if (conversa.prioridade === "alta") rodape.append(criar("span", "selo alta", "urgente"));
  if (conversa.atendente) rodape.append(criar("span", "selo", conversa.atendente.nome.split(" ")[0]));
  for (const etiqueta of conversa.etiquetas) {
    const pilula = criar("span", "selo", etiqueta.nome);
    pilula.style.borderColor = etiqueta.cor;
    rodape.append(pilula);
  }
  if (conversa.nao_lidas > 0) {
    const bolha = criar("span", "bolha-nao-lidas", String(conversa.nao_lidas));
    bolha.style.marginLeft = "auto";
    rodape.append(bolha);
  }
  item.append(rodape);
  item.onclick = () => abrirConversa(conversa.id);
  return item;
}

function selo(tipo, texto) {
  return criar("span", `selo canal-${tipo}`, texto);
}

/* ------------------------------------------------------------- conversa */
async function abrirConversa(id) {
  estado.atualId = id;
  estado.detalhe = await api("GET", `/api/conversas/${id}`);
  const local = estado.conversas.find((c) => c.id === id);
  if (local) local.nao_lidas = 0;
  desenharLista();
  desenharConversa();
  carregarMetricas();
}

function desenharConversa() {
  const conversa = estado.detalhe;
  $("#conversa-vazia").hidden = Boolean(conversa);
  $("#conversa-conteudo").hidden = !conversa;
  if (!conversa) return;

  $("#titulo-conversa").textContent = conversa.contato.nome;
  $("#subtitulo-conversa").textContent =
    `${NOMES_CANAL[conversa.canal.tipo] || conversa.canal.tipo} · ${conversa.canal.nome}` +
    (conversa.assunto ? ` · ${conversa.assunto}` : "");

  const seletor = $("#seletor-atendente");
  seletor.innerHTML = "";
  seletor.append(new Option("Sem atendente", ""));
  for (const pessoa of estado.atendentes) {
    seletor.append(new Option(pessoa.nome, String(pessoa.id)));
  }
  seletor.value = conversa.atendente ? String(conversa.atendente.id) : "";
  $("#seletor-status").value = conversa.status;
  $("#seletor-prioridade").value = conversa.prioridade;

  desenharLinhaDoTempo(conversa.mensagens);
  desenharFicha(conversa);
}

function desenharLinhaDoTempo(mensagens) {
  const alvo = $("#linha-do-tempo");
  alvo.innerHTML = "";
  let ultimoDia = null;
  for (const mensagem of mensagens) {
    const dia = new Date(mensagem.criada_em).toDateString();
    if (dia !== ultimoDia) {
      alvo.append(criar("div", "dia", diaLegivel(mensagem.criada_em)));
      ultimoDia = dia;
    }
    alvo.append(balao(mensagem));
  }
  alvo.scrollTop = alvo.scrollHeight;
}

function balao(mensagem) {
  const nota = mensagem.tipo === "nota_interna";
  const classe = nota ? "balao nota" : `balao ${mensagem.direcao}`;
  const elemento = criar("div", classe);
  elemento.dataset.id = mensagem.id;
  elemento.append(criar("div", "texto", mensagem.conteudo));

  const meta = criar("div", "meta");
  meta.append(criar("span", "", `${nota ? "nota de " : ""}${mensagem.autor || ""}`));
  meta.append(criar("span", "", hora(mensagem.criada_em)));
  if (mensagem.direcao === "saida" && !nota) meta.append(criar("span", "estado", rotuloStatus(mensagem.status)));
  if (mensagem.status === "falhou") {
    elemento.classList.add("falhou");
    meta.append(criar("span", "", mensagem.erro || ""));
    const reenviar = criar("button", "aba", "Reenviar");
    reenviar.onclick = () => enviar(mensagem.conteudo, "resposta");
    meta.append(reenviar);
  }
  elemento.append(meta);
  return elemento;
}

function rotuloStatus(status) {
  return { enviada: "✓ enviada", entregue: "✓✓ entregue", lida: "✓✓ lida", falhou: "⚠ falhou", simulada: "sandbox" }[status] || status;
}

/* ---------------------------------------------------------------- ficha */
function desenharFicha(conversa) {
  const ficha = $("#ficha");
  ficha.innerHTML = "";
  const contato = conversa.contato;

  const bloco = criar("div", "bloco");
  bloco.append(criar("h3", "", "Contato"));
  for (const [rotulo, valor] of [
    ["Nome", contato.nome],
    ["Empresa", contato.empresa],
    ["CNPJ/CPF", contato.documento],
    ["E-mail", contato.email],
    ["Telefone", contato.telefone],
  ]) {
    if (!valor) continue;
    const dado = criar("div", "dado");
    dado.append(criar("span", "", rotulo), document.createTextNode(valor));
    bloco.append(dado);
  }
  ficha.append(bloco);

  if (contato.identidades.length) {
    const canais = criar("div", "bloco");
    canais.append(criar("h3", "", "Também fala por"));
    const lista = criar("div", "etiquetas");
    for (const identidade of contato.identidades) {
      lista.append(selo(identidade.canal_tipo, `${NOMES_CANAL[identidade.canal_tipo]}: ${identidade.identificador}`));
    }
    canais.append(lista);
    ficha.append(canais);
  }

  const blocoEtiquetas = criar("div", "bloco");
  blocoEtiquetas.append(criar("h3", "", "Etiquetas"));
  const atuais = criar("div", "etiquetas");
  for (const etiqueta of conversa.etiquetas) {
    const pilula = criar("span", "pilula");
    const ponto = criar("i", "ponto-etiqueta");
    ponto.style.background = etiqueta.cor;
    const remover = criar("button", "", "×");
    remover.title = "Remover etiqueta";
    remover.onclick = async () => {
      await api("DELETE", `/api/conversas/${conversa.id}/etiquetas/${etiqueta.id}`);
      estado.detalhe = await api("GET", `/api/conversas/${conversa.id}`);
      desenharConversa();
    };
    pilula.append(ponto, criar("span", "", etiqueta.nome), remover);
    atuais.append(pilula);
  }
  blocoEtiquetas.append(atuais);

  const disponiveis = estado.etiquetas.filter((e) => !conversa.etiquetas.some((a) => a.id === e.id));
  if (disponiveis.length) {
    const seletor = criar("select");
    seletor.style.marginTop = "10px";
    seletor.style.width = "100%";
    seletor.append(new Option("Adicionar etiqueta…", ""));
    for (const etiqueta of disponiveis) seletor.append(new Option(etiqueta.nome, String(etiqueta.id)));
    seletor.onchange = async () => {
      if (!seletor.value) return;
      await api("POST", `/api/conversas/${conversa.id}/etiquetas`, { etiqueta_id: Number(seletor.value) });
      estado.detalhe = await api("GET", `/api/conversas/${conversa.id}`);
      desenharConversa();
    };
    blocoEtiquetas.append(seletor);
  }
  ficha.append(blocoEtiquetas);

  const resumo = criar("div", "bloco");
  resumo.append(criar("h3", "", "Atendimento"));
  const aberta = criar("div", "dado");
  aberta.append(criar("span", "", "Aberta em"), document.createTextNode(dataHora(conversa.criada_em)));
  resumo.append(aberta);
  const mensagens = criar("div", "dado");
  mensagens.append(criar("span", "", "Mensagens"), document.createTextNode(String(conversa.mensagens.length)));
  resumo.append(mensagens);
  ficha.append(resumo);
}

/* ------------------------------------------------------------- controles */
$("#seletor-atendente").addEventListener("change", async (evento) => {
  const valor = evento.target.value;
  await api("POST", `/api/conversas/${estado.atualId}/atribuir`, {
    atendente_id: valor ? Number(valor) : null,
  });
  avisar(valor ? "Conversa atribuída." : "Conversa devolvida à fila.");
});

$("#seletor-status").addEventListener("change", async (evento) => {
  await api("POST", `/api/conversas/${estado.atualId}/status`, { status: evento.target.value });
  avisar(`Conversa marcada como ${evento.target.value}.`);
  carregarConversas();
  carregarMetricas();
});

$("#seletor-prioridade").addEventListener("change", async (evento) => {
  await api("POST", `/api/conversas/${estado.atualId}/prioridade`, { prioridade: evento.target.value });
});

document.querySelectorAll(".abas-redator .aba").forEach((aba) => {
  aba.onclick = () => {
    estado.modo = aba.dataset.modo;
    document.querySelectorAll(".abas-redator .aba").forEach((outra) => {
      outra.classList.toggle("ativa", outra === aba);
    });
    const nota = estado.modo === "nota";
    $("#texto").placeholder = nota
      ? "Anotação visível só para a equipe…"
      : "Escreva sua resposta…  (/ para respostas rápidas)";
    $("#dica-redator").textContent = nota
      ? "A nota não é enviada ao contato"
      : "Enter envia · Shift+Enter quebra linha";
  };
});

/* ------------------------------------------------------- respostas rápidas */
const caixaTexto = $("#texto");
const sugestoes = $("#sugestoes");

caixaTexto.addEventListener("input", () => {
  const valor = caixaTexto.value;
  if (!valor.startsWith("/") || valor.includes("\n")) return fecharSugestoes();
  const termo = valor.slice(1).toLowerCase();
  const achados = estado.respostas.filter(
    (r) => r.atalho.toLowerCase().startsWith(termo) || r.titulo.toLowerCase().includes(termo)
  );
  if (!achados.length) return fecharSugestoes();
  estado.marcada = 0;
  sugestoes.innerHTML = "";
  achados.slice(0, 8).forEach((resposta, indice) => {
    const item = criar("button", `sugestao${indice === 0 ? " marcada" : ""}`);
    item.type = "button";
    item.append(criar("b", "", `/${resposta.atalho}`), criar("span", "", resposta.conteudo));
    item.onclick = () => usarResposta(resposta);
    sugestoes.append(item);
  });
  sugestoes.hidden = false;
});

function fecharSugestoes() {
  sugestoes.hidden = true;
  sugestoes.innerHTML = "";
}

function usarResposta(resposta) {
  const nome = estado.detalhe?.contato.nome?.split(" ")[0] || "";
  caixaTexto.value = resposta.conteudo.replace(/\{\{\s*nome\s*\}\}/gi, nome);
  fecharSugestoes();
  caixaTexto.focus();
}

caixaTexto.addEventListener("keydown", (evento) => {
  if (!sugestoes.hidden) {
    const itens = [...sugestoes.querySelectorAll(".sugestao")];
    if (evento.key === "ArrowDown" || evento.key === "ArrowUp") {
      evento.preventDefault();
      estado.marcada = (estado.marcada + (evento.key === "ArrowDown" ? 1 : itens.length - 1)) % itens.length;
      itens.forEach((item, indice) => item.classList.toggle("marcada", indice === estado.marcada));
      return;
    }
    if (evento.key === "Enter" || evento.key === "Tab") {
      evento.preventDefault();
      itens[estado.marcada]?.click();
      return;
    }
    if (evento.key === "Escape") return fecharSugestoes();
  }
  if (evento.key === "Enter" && !evento.shiftKey) {
    evento.preventDefault();
    $("#redator").requestSubmit();
  }
});

$("#redator").addEventListener("submit", (evento) => {
  evento.preventDefault();
  const conteudo = caixaTexto.value.trim();
  if (conteudo) enviar(conteudo, estado.modo);
});

async function enviar(conteudo, modo) {
  const rota = modo === "nota" ? "notas" : "mensagens";
  const anterior = caixaTexto.value;
  caixaTexto.value = "";
  try {
    const mensagem = await api("POST", `/api/conversas/${estado.atualId}/${rota}`, { conteudo });
    acrescentarMensagem(mensagem);
    if (mensagem.status === "falhou") avisar(`Não foi possível enviar: ${mensagem.erro}`, true);
    if (mensagem.status === "simulada") avisar("Canal em modo sandbox: a mensagem não saiu de verdade.");
  } catch (erro) {
    caixaTexto.value = anterior; // devolve o texto para não perder o que foi escrito
    avisar(erro.message, true);
  }
}

function acrescentarMensagem(mensagem) {
  if (mensagem.conversa_id !== estado.atualId || !estado.detalhe) return;
  if (estado.detalhe.mensagens.some((m) => m.id === mensagem.id)) return;
  estado.detalhe.mensagens.push(mensagem);
  const alvo = $("#linha-do-tempo");
  const coladoEmbaixo = alvo.scrollHeight - alvo.scrollTop - alvo.clientHeight < 120;
  alvo.append(balao(mensagem));
  if (coladoEmbaixo) alvo.scrollTop = alvo.scrollHeight;
}

/* ------------------------------------------------------------- métricas */
async function carregarMetricas() {
  const resumo = await api("GET", "/api/metricas/resumo");
  const alvo = $("#indicadores");
  alvo.innerHTML = "";
  const cartoes = [
    ["Abertas", resumo.abertas],
    ["Pendentes", resumo.pendentes],
    ["Sem atendente", resumo.sem_atendente],
    ["Resolvidas hoje", resumo.resolvidas_hoje],
  ];
  if (resumo.tempo_medio_primeira_resposta_seg !== null) {
    cartoes.push(["1ª resposta", duracao(resumo.tempo_medio_primeira_resposta_seg)]);
  }
  for (const [rotulo, valor] of cartoes) {
    const cartao = criar("div", "indicador");
    cartao.append(criar("b", "", String(valor)), criar("span", "", rotulo));
    alvo.append(cartao);
  }
}

/* --------------------------------------------------------------- eventos */
function conectarEventos() {
  if (estado.fonte) estado.fonte.close();
  const fonte = new EventSource(`/api/eventos/stream?token=${encodeURIComponent(estado.token)}`);
  estado.fonte = fonte;

  fonte.addEventListener("mensagem.nova", (evento) => {
    const mensagem = JSON.parse(evento.data);
    acrescentarMensagem(mensagem);
    if (mensagem.direcao === "entrada" && mensagem.conversa_id !== estado.atualId) {
      avisar(`Nova mensagem de ${mensagem.autor}`);
    }
  });

  fonte.addEventListener("mensagem.status", (evento) => {
    const mensagem = JSON.parse(evento.data);
    const balaoExistente = document.querySelector(`.balao[data-id="${mensagem.id}"] .estado`);
    if (balaoExistente) balaoExistente.textContent = rotuloStatus(mensagem.status);
  });

  fonte.addEventListener("conversa.atualizada", (evento) => {
    const conversa = JSON.parse(evento.data);
    const indice = estado.conversas.findIndex((c) => c.id === conversa.id);
    if (indice >= 0) estado.conversas[indice] = conversa;
    else estado.conversas.unshift(conversa);
    estado.conversas.sort((a, b) => new Date(b.ultima_mensagem_em) - new Date(a.ultima_mensagem_em));
    desenharLista();
    carregarMetricas();
  });

  // o navegador reconecta sozinho; só avisamos quem está olhando
  fonte.onerror = () => console.warn("fluxo de eventos caiu; reconectando…");
}

/* ------------------------------------------------------------------ datas */
const HORA = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const DATA_HORA = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const DIA = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long" });

const hora = (valor) => HORA.format(new Date(valor));
const dataHora = (valor) => DATA_HORA.format(new Date(valor));

function diaLegivel(valor) {
  const data = new Date(valor);
  const hoje = new Date();
  const ontem = new Date(hoje.getTime() - 86400000);
  if (data.toDateString() === hoje.toDateString()) return "Hoje";
  if (data.toDateString() === ontem.toDateString()) return "Ontem";
  return DIA.format(data);
}

function quando(valor) {
  const data = new Date(valor);
  const minutos = Math.round((Date.now() - data.getTime()) / 60000);
  if (minutos < 1) return "agora";
  if (minutos < 60) return `${minutos} min`;
  if (data.toDateString() === new Date().toDateString()) return hora(valor);
  if (minutos < 60 * 24 * 7) return `${Math.floor(minutos / 1440)} d`;
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(data);
}

function duracao(segundos) {
  if (segundos < 60) return `${Math.round(segundos)}s`;
  if (segundos < 3600) return `${Math.round(segundos / 60)}min`;
  return `${(segundos / 3600).toFixed(1)}h`;
}

/* ------------------------------------------------------------------ boot */
if (estado.token) {
  iniciar().catch(sair);
} else {
  $("#tela-login").hidden = false;
}
