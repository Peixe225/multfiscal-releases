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
    // a validação do FastAPI (422) devolve uma lista de problemas, não uma frase
    const texto = Array.isArray(detalhe.detail)
      ? detalhe.detail.map((problema) => problema.msg).join("; ")
      : detalhe.detail;
    throw new Error(texto || `falha na requisição (${resposta.status})`);
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
  estado.atendente = null; // o próximo login pode ser de outra pessoa, com outro papel
  if (estado.fonte) estado.fonte.close();
  fecharCanais();
  esquecerCanais();
  $("#abrir-canais").hidden = true;
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
  // a API recusa do mesmo jeito; esconder só poupa o atendente de um 403
  $("#abrir-canais").hidden = estado.atendente.papel !== "admin";

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
    if (!canal.ativo) {
      botao.append(criar("span", "contagem", "desativado"));
    } else if (!canal.configurado && canal.tipo !== "webchat") {
      botao.append(criar("span", "contagem", "sandbox"));
    } else if (telaCanais.testes[canal.id] === "falha") {
      // só o admin testa; para ele, sumir o "sandbox" não pode parecer "funciona"
      botao.append(criar("span", "contagem falhou", "falhou"));
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

  if (mensagem.anexos?.length) elemento.append(desenharAnexos(mensagem.anexos));

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

function desenharAnexos(anexos) {
  const caixa = criar("div", "anexos");
  for (const anexo of anexos) {
    // o token vai na query porque <img> e <a download> não mandam cabeçalho
    const endereco = anexo.url ? `${anexo.url}?token=${encodeURIComponent(estado.token)}` : null;

    if (!endereco) {
      const falho = criar("div", "arquivo indisponivel");
      falho.append(criar("span", "icone", "⚠"));
      const corpo = criar("div");
      corpo.append(criar("div", "nome", anexo.nome));
      corpo.append(criar("div", "tamanho", anexo.erro || "arquivo não recuperado"));
      falho.append(corpo);
      caixa.append(falho);
      continue;
    }

    if (anexo.imagem) {
      const imagem = criar("img");
      imagem.src = endereco;
      imagem.alt = anexo.nome;
      imagem.loading = "lazy";
      imagem.onclick = () => window.open(endereco, "_blank", "noopener");
      caixa.append(imagem);
      continue;
    }

    const link = criar("a", "arquivo");
    link.href = endereco;
    link.download = anexo.nome;
    link.append(criar("span", "icone", "📄"));
    const corpo = criar("div");
    corpo.append(criar("div", "nome", anexo.nome));
    corpo.append(criar("div", "tamanho", tamanhoLegivel(anexo.tamanho)));
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

const campoArquivo = $("#arquivo");
$("#botao-anexar").addEventListener("click", () => campoArquivo.click());

campoArquivo.addEventListener("change", async () => {
  const arquivo = campoArquivo.files?.[0];
  if (!arquivo || !estado.atualId) return;
  if (estado.modo === "nota") {
    avisar("Anexo vai junto com a resposta, não com a nota interna.", true);
    campoArquivo.value = "";
    return;
  }

  const formulario = new FormData();
  formulario.append("arquivo", arquivo);
  formulario.append("conteudo", caixaTexto.value.trim()); // o texto vira legenda
  const botao = $("#botao-anexar");
  botao.disabled = true;
  try {
    // sem Content-Type: o navegador precisa definir o boundary do multipart
    const resposta = await fetch(`/api/conversas/${estado.atualId}/anexos`, {
      method: "POST",
      headers: { Authorization: `Bearer ${estado.token}` },
      body: formulario,
    });
    const corpo = await resposta.json().catch(() => ({}));
    if (!resposta.ok) throw new Error(corpo.detail || "não foi possível enviar o arquivo");
    caixaTexto.value = "";
    acrescentarMensagem(corpo);
    if (corpo.status === "falhou") avisar(`Arquivo guardado, mas não saiu: ${corpo.erro}`, true);
  } catch (erro) {
    avisar(erro.message, true);
  } finally {
    botao.disabled = false;
    campoArquivo.value = ""; // permite reenviar o mesmo arquivo
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

/* ---------------------------------------------------------------- canais */
/* Tela do admin para ligar os canais sem curl: colar o token, salvar e ver na
   hora se o provedor aceitou. O formulário sai de /api/canais/tipos, então um
   campo novo num adaptador aparece aqui sem mexer no painel. */

function telaCanaisVazia() {
  return {
    tipos: null, // campos de cada tipo; não mudam com o servidor no ar
    credenciais: {}, // por canal: o que não é segredo e quais segredos existem
    // último resultado mostrado em cada canal (teste, ou erro ao salvar e
    // remover). Sobrevive a fechar a gaveta: sem ele o selo voltaria a dizer
    // "Conectado" logo depois de o provedor recusar
    resultados: {},
    testes: {}, // por canal: "andamento", "ok", "ressalva" ou "falha"
    vezDoTeste: {}, // por canal: o teste mais recente, o único que vale
    editando: null, // id do canal no formulário; null = lista
    criando: false,
    removendo: null, // id do canal com a confirmação de remoção aberta
    focoAnterior: null,
  };
}

const telaCanais = telaCanaisVazia();
const gavetaCanais = $("#canais");
const corpoCanais = $("#corpo-canais");
let sequenciaCampo = 0;
let sequenciaTeste = 0;

/* Chamado ao sair: a próxima pessoa na mesma aba pode ser uma atendente, e o
   secret_token do Telegram guardado aqui deixaria forjar mensagens. */
function esquecerCanais() {
  Object.assign(telaCanais, telaCanaisVazia());
}

$("#abrir-canais").addEventListener("click", abrirCanais);
$("#canais-fechar").addEventListener("click", fecharCanais);
$("#canais-voltar").addEventListener("click", () => mostrarListaCanais(telaCanais.editando));
$("#canais-novo").addEventListener("click", () => {
  telaCanais.criando = true;
  mostrarListaCanais();
  $("#novo-canal-tipo")?.focus();
});

// o fundo escuro fora da gaveta também fecha, como em qualquer janela sobreposta
gavetaCanais.addEventListener("mousedown", (evento) => {
  if (evento.target === gavetaCanais) fecharCanais();
});

document.addEventListener("keydown", (evento) => {
  if (gavetaCanais.hidden) return;
  if (evento.key === "Escape") {
    evento.preventDefault();
    fecharCanais();
  } else if (evento.key === "Tab") {
    prenderFoco(evento);
  }
});

/* Com a gaveta aberta o Tab não pode cair na caixa de entrada escondida atrás
   dela: quem navega por teclado se perderia sem ver onde está o foco. */
function prenderFoco(evento) {
  const focaveis = [...gavetaCanais.querySelectorAll("button, a[href], input, select, textarea, [tabindex='0']")]
    .filter((elemento) => !elemento.disabled && elemento.offsetParent !== null);
  if (!focaveis.length) return;
  const primeiro = focaveis[0];
  const ultimo = focaveis[focaveis.length - 1];
  const dentro = gavetaCanais.contains(document.activeElement);
  if (evento.shiftKey && (!dentro || document.activeElement === primeiro)) {
    evento.preventDefault();
    ultimo.focus();
  } else if (!evento.shiftKey && (!dentro || document.activeElement === ultimo)) {
    evento.preventDefault();
    primeiro.focus();
  }
}

async function abrirCanais() {
  telaCanais.focoAnterior = document.activeElement;
  Object.assign(telaCanais, { editando: null, criando: false, removendo: null });
  gavetaCanais.hidden = false;
  mostrarCabecalhoCanais();
  corpoCanais.replaceChildren(criar("p", "dica", "Carregando canais…"));
  $("#canais-novo").focus();
  try {
    telaCanais.tipos = telaCanais.tipos || (await api("GET", "/api/canais/tipos"));
    await recarregarCanais();
    mostrarListaCanais();
  } catch (erro) {
    corpoCanais.replaceChildren(criar("p", "erro", `Não foi possível carregar os canais: ${erro.message}`));
  }
}

function fecharCanais() {
  if (gavetaCanais.hidden) return;
  gavetaCanais.hidden = true;
  corpoCanais.replaceChildren();
  telaCanais.focoAnterior?.focus?.();
}

/* Toda mudança passa por aqui: a barra lateral e a lista de conversas mostram
   o nome e o estado dos canais, e ficariam desatualizadas. */
async function recarregarCanais() {
  const sessao = estado.token;
  const canais = await api("GET", "/api/canais");
  const credenciais = await Promise.all(canais.map((canal) => api("GET", `/api/canais/${canal.id}/credenciais`)));
  // quem saiu enquanto isto carregava não deixa credenciais na aba para o próximo
  if (estado.token !== sessao) return;
  estado.canais = canais;
  telaCanais.credenciais = Object.fromEntries(canais.map((canal, i) => [canal.id, credenciais[i]]));
  // filtro num canal que foi removido deixaria a lista vazia sem motivo aparente
  if (estado.filtro.tipo === "canal" && !estado.canais.some((canal) => canal.id === estado.filtro.valor)) {
    estado.filtro = { tipo: "aberta" };
  }
  desenharFiltros();
  carregarConversas().catch((erro) => console.warn("lista de conversas não atualizou", erro));
}

function mostrarCabecalhoCanais() {
  const editando = telaCanais.editando !== null;
  $("#canais-voltar").hidden = !editando;
  $("#canais-novo").hidden = editando;
  $("#titulo-canais").textContent = editando ? "Editar canal" : "Canais";
}

function mostrarListaCanais(focarCanalId = null) {
  telaCanais.editando = null;
  mostrarCabecalhoCanais();
  const itens = [];
  if (telaCanais.criando) itens.push(formularioNovoCanal());
  if (!estado.canais.length && !telaCanais.criando) {
    itens.push(criar("p", "dica", "Nenhum canal ainda. Comece por “Novo canal”."));
  }
  for (const canal of estado.canais) itens.push(cartaoDoCanal(canal));
  corpoCanais.replaceChildren(...itens);
  // voltando da edição, o foco volta para onde a pessoa estava
  if (focarCanalId !== null) {
    corpoCanais.querySelector(`[data-canal="${focarCanalId}"] .editar`)?.focus();
  }
}

function redesenharCartao(canalId, seletorFoco) {
  const antigo = corpoCanais.querySelector(`article[data-canal="${canalId}"]`);
  const canal = estado.canais.find((c) => c.id === canalId);
  if (!antigo || !canal) return mostrarListaCanais();
  const novo = cartaoDoCanal(canal);
  antigo.replaceWith(novo);
  if (seletorFoco) novo.querySelector(seletorFoco)?.focus();
}

function situacaoDoCanal(canal) {
  if (!canal.ativo) {
    return ["Desativado", "desativado", "Não recebe mensagens novas: webhook, polling e widget ficam desligados."];
  }
  if (canal.tipo === "webchat") {
    return ["Conectado", "conectado", "Não depende de provedor: funciona assim que o trecho estiver no site."];
  }
  if (!canal.configurado) {
    return ["Sandbox", "sandbox", "Sem credenciais: as respostas ficam só registradas aqui, não saem de verdade."];
  }
  // "configurado" só quer dizer campos preenchidos; quem diz se conecta é o teste
  switch (telaCanais.testes[canal.id]) {
    case "andamento":
      return ["Testando…", "andamento", "Conferindo as credenciais no provedor."];
    case "ok":
      return ["Conectado", "conectado", "O provedor aceitou as credenciais no último teste."];
    case "ressalva":
      return ["Conectado, com ressalva", "ressalva", "O provedor aceitou, mas o último teste deixou um aviso: veja abaixo."];
    case "falha":
      return ["Falhou no teste", "falhou", "O provedor recusou no último teste: veja o motivo abaixo e corrija em Editar."];
    default:
      return ["Não testado", "nao-testado", "Credenciais salvas, ainda não conferidas: “Testar conexão” pergunta ao provedor."];
  }
}

/* Atualiza o selo sem redesenhar o cartão, que tiraria o foco do botão. */
function pintarSituacao(canalId) {
  const canal = estado.canais.find((c) => c.id === canalId);
  const cartao = corpoCanais.querySelector(`article[data-canal="${canalId}"]`);
  if (!canal || !cartao) return;
  const [rotulo, classe, explicacao] = situacaoDoCanal(canal);
  const marca = cartao.querySelector(".situacao");
  marca.className = `situacao ${classe}`;
  marca.textContent = rotulo;
  cartao.querySelector(".explicacao").textContent = explicacao;
}

function botaoPequeno(texto, classe) {
  const botao = criar("button", classe, texto);
  botao.type = "button";
  return botao;
}

function alertaCanal(texto) {
  return criar("p", "alerta-canal", texto);
}

function campoRotulado(rotulo, controle, ajuda, obrigatorio) {
  controle.id = controle.id || `campo-canal-${++sequenciaCampo}`;
  const caixa = criar("div", "campo-canal");
  const etiqueta = criar("label", "", rotulo);
  etiqueta.htmlFor = controle.id;
  if (obrigatorio) etiqueta.append(criar("span", "obrigatorio", "obrigatório"));
  caixa.append(etiqueta, controle);
  if (ajuda) {
    const dica = criar("small", "dica", ajuda);
    dica.id = `${controle.id}-ajuda`;
    controle.setAttribute("aria-describedby", dica.id);
    caixa.append(dica);
  }
  return caixa;
}

/* O navegador conta espaço no minLength: "   " passava e voltava da API como
   erro. Aqui a mensagem sai em português, no próprio campo. */
function nomeValido(campo) {
  const valor = campo.value.trim();
  campo.setCustomValidity(valor.length >= 2 ? "" : "Use pelo menos 2 caracteres (espaços não contam).");
  return campo.reportValidity() ? valor : null;
}

function campoDeNome(valor) {
  const nome = criar("input");
  Object.assign(nome, { value: valor, required: true, maxLength: 120, autocomplete: "off" });
  nome.addEventListener("input", () => nome.setCustomValidity(""));
  return nome;
}

function formularioNovoCanal() {
  const form = criar("form", "cartao-canal novo-canal");
  form.setAttribute("aria-label", "Novo canal");
  form.append(criar("h3", "", "Novo canal"));

  const tipo = criar("select");
  tipo.id = "novo-canal-tipo";
  for (const chave of Object.keys(telaCanais.tipos)) tipo.append(new Option(NOMES_CANAL[chave] || chave, chave));
  const nome = campoDeNome("");
  const sugerirNome = () => (nome.placeholder = `Ex.: ${NOMES_CANAL[tipo.value] || tipo.value} Suporte`);
  tipo.addEventListener("change", sugerirNome);
  sugerirNome();

  const linha = criar("div", "linha-form");
  linha.append(campoRotulado("Tipo", tipo), campoRotulado("Nome", nome));
  const erro = criar("p", "erro");
  erro.setAttribute("role", "alert");
  const criarBotao = criar("button", "botao pequeno", "Criar e configurar");
  criarBotao.type = "submit";
  const cancelar = botaoPequeno("Cancelar", "botao discreto pequeno");
  cancelar.onclick = () => {
    telaCanais.criando = false;
    mostrarListaCanais();
    $("#canais-novo").focus();
  };
  const acoes = criar("div", "acoes-canal");
  acoes.append(criarBotao, cancelar);
  form.append(linha, erro, acoes);

  form.onsubmit = async (evento) => {
    evento.preventDefault();
    const nomeLimpo = nomeValido(nome);
    if (nomeLimpo === null) return;
    criarBotao.disabled = true;
    erro.textContent = "";
    try {
      const canal = await api("POST", "/api/canais", { nome: nomeLimpo, tipo: tipo.value });
      telaCanais.criando = false;
      await recarregarCanais();
      avisar(`Canal “${canal.nome}” criado.`);
      abrirEdicao(canal.id);
    } catch (falha) {
      erro.textContent = falha.message;
      criarBotao.disabled = false;
    }
  };
  return form;
}

function cartaoDoCanal(canal) {
  const cartao = criar("article", `cartao-canal${canal.ativo ? "" : " inativo"}`);
  cartao.dataset.canal = canal.id;
  const titulo = criar("h3", "", canal.nome);
  titulo.id = `canal-${canal.id}-nome`;
  cartao.setAttribute("aria-labelledby", titulo.id);

  const [rotulo, classe, explicacao] = situacaoDoCanal(canal);
  const topo = criar("div", "linha");
  topo.append(titulo, selo(canal.tipo, NOMES_CANAL[canal.tipo] || canal.tipo), criar("span", `situacao ${classe}`, rotulo));
  cartao.append(topo, criar("p", "dica explicacao", explicacao), blocoParaCopiar(canal));

  cartao.append(areaDeResultado(canal.id));
  cartao.append(telaCanais.removendo === canal.id ? confirmacaoRemover(canal) : acoesDoCanal(canal));
  // cada botão diz a que canal pertence, para quem usa leitor de tela
  cartao.querySelectorAll(".acoes-canal button").forEach((botao) => botao.setAttribute("aria-describedby", titulo.id));
  return cartao;
}

function acoesDoCanal(canal) {
  const acoes = criar("div", "acoes-canal");
  const testar = botaoDeTeste("Testar conexão", "botao pequeno testar", canal.id);
  testar.onclick = () => testarCanal(canal.id);
  const editar = botaoPequeno("Editar", "botao discreto pequeno editar");
  editar.onclick = () => abrirEdicao(canal.id);
  const alternar = botaoPequeno(canal.ativo ? "Desativar" : "Ativar", "botao discreto pequeno alternar");
  alternar.onclick = () => alternarCanal(canal, alternar);
  const remover = botaoPequeno("Remover", "botao discreto pequeno perigo-texto remover");
  remover.onclick = () => {
    telaCanais.removendo = canal.id;
    redesenharCartao(canal.id, ".cancelar-remocao");
  };
  acoes.append(testar, editar, alternar, remover);
  return acoes;
}

function confirmacaoRemover(canal) {
  const caixa = criar("div", "confirmacao");
  caixa.setAttribute("role", "group");
  caixa.setAttribute("aria-label", `Confirmar remoção de ${canal.nome}`);
  caixa.append(
    criar(
      "p",
      "",
      `Remover “${canal.nome}” de vez? Não dá para desfazer. Canal com conversas não pode ser ` +
        "removido: desative-o para parar de receber sem perder o histórico."
    )
  );
  const acoes = criar("div", "acoes-canal");
  const confirmar = botaoPequeno("Remover de vez", "botao pequeno perigo");
  // o foco começa em "Cancelar": um Enter distraído não apaga nada
  const cancelar = botaoPequeno("Cancelar", "botao discreto pequeno cancelar-remocao");
  cancelar.onclick = () => {
    telaCanais.removendo = null;
    redesenharCartao(canal.id, ".remover");
  };
  confirmar.onclick = async () => {
    confirmar.disabled = true;
    try {
      await api("DELETE", `/api/canais/${canal.id}`);
      telaCanais.removendo = null;
      delete telaCanais.resultados[canal.id];
      delete telaCanais.testes[canal.id];
      await recarregarCanais();
      mostrarListaCanais();
      $("#canais-novo").focus();
      avisar(`Canal “${canal.nome}” removido.`);
    } catch (erro) {
      telaCanais.removendo = null;
      telaCanais.resultados[canal.id] = { ok: false, titulo: "Não foi removido.", mensagem: erro.message };
      redesenharCartao(canal.id, ".alternar");
    }
  };
  acoes.append(confirmar, cancelar);
  caixa.append(acoes);
  return caixa;
}

async function alternarCanal(canal, botao) {
  botao.disabled = true;
  try {
    await api("PATCH", `/api/canais/${canal.id}`, { ativo: !canal.ativo });
    await recarregarCanais();
    redesenharCartao(canal.id, ".alternar");
    avisar(canal.ativo ? `“${canal.nome}” desativado: não recebe mensagens novas.` : `“${canal.nome}” ativado.`);
  } catch (erro) {
    botao.disabled = false;
    avisar(erro.message, true);
  }
}

/* ------------------------------------------------ canais: teste de conexão */
function areaDeResultado(canalId) {
  // sempre no DOM (vazia some pelo CSS): leitor de tela só anuncia mudança
  // numa região "status" que já existia antes dela
  const area = criar("div", "resultado-teste");
  area.setAttribute("role", "status");
  area.tabIndex = -1; // recebe o foco depois de salvar, quando o formulário é refeito
  area.dataset.resultadoCanal = canalId;
  mostrarResultado(area, telaCanais.resultados[canalId]);
  return area;
}

function mostrarResultado(area, resultado) {
  area.className = "resultado-teste";
  area.replaceChildren();
  if (!resultado) return;
  if (resultado.andamento) {
    area.classList.add("andamento");
    area.textContent = "Testando a conexão com o provedor…";
    return;
  }
  const ressalva = resultado.ok && resultado.alerta;
  area.classList.add(ressalva ? "ressalva" : resultado.ok ? "ok" : "falha");
  const titulo =
    resultado.titulo || (ressalva ? "⚠ Conectou, com ressalva." : resultado.ok ? "✓ Funcionou." : "✗ Não conectou.");
  area.append(criar("strong", "", titulo), document.createTextNode(` ${resultado.mensagem}`));
  if (ressalva) area.append(criar("span", "alerta-teste", `Atenção: ${resultado.alerta}.`));
}

/* Botão que dispara teste: fica "Testando…" e desabilitado enquanto houver
   teste daquele canal em andamento, mesmo se o cartão for redesenhado. */
function botaoDeTeste(texto, classe, canalId) {
  const botao = botaoPequeno(texto, classe);
  botao.dataset.rotulo = texto;
  botao.dataset.testarCanal = canalId;
  marcarBotaoDeTeste(botao, telaCanais.testes[canalId] === "andamento");
  return botao;
}

function marcarBotaoDeTeste(botao, andamento) {
  botao.disabled = andamento;
  botao.textContent = andamento ? "Testando…" : botao.dataset.rotulo;
}

/* O resultado vai para o que estiver na tela quando o provedor responder, não
   para o que estava quando o teste começou: Editar, Desativar, Novo canal ou
   Voltar à lista no meio do teste redesenham tudo, e o SMTP ou a Meta levam
   até 20 s. Sem isto o "Testando…" ficava na tela para sempre. */
function refletirTeste(canalId) {
  const resultado = telaCanais.resultados[canalId];
  corpoCanais.querySelectorAll(`[data-resultado-canal="${canalId}"]`).forEach((area) => mostrarResultado(area, resultado));
  const andamento = telaCanais.testes[canalId] === "andamento";
  corpoCanais.querySelectorAll(`[data-testar-canal="${canalId}"]`).forEach((botao) => marcarBotaoDeTeste(botao, andamento));
  pintarSituacao(canalId);
}

async function testarCanal(canalId) {
  const vez = ++sequenciaTeste;
  telaCanais.vezDoTeste[canalId] = vez;
  telaCanais.testes[canalId] = "andamento";
  telaCanais.resultados[canalId] = { andamento: true };
  refletirTeste(canalId);
  let resultado;
  try {
    resultado = await api("POST", `/api/canais/${canalId}/testar`);
  } catch (erro) {
    resultado = { ok: false, mensagem: erro.message };
  }
  // um teste mais novo, ou outra pessoa entrando na aba, manda mais que este
  if (telaCanais.vezDoTeste[canalId] !== vez) return resultado;
  telaCanais.testes[canalId] = resultado.ok ? (resultado.alerta ? "ressalva" : "ok") : "falha";
  telaCanais.resultados[canalId] = resultado;
  refletirTeste(canalId);
  desenharFiltros(); // a barra lateral marca o canal que falhou
  return resultado;
}

/* ------------------------------------------- canais: o que levar ao provedor */
/* A URL copiada é a do endereço em que o painel foi aberto. Em localhost ou
   sem HTTPS, a Meta (e o Telegram no modo webhook) a recusam sem dizer por
   quê; melhor avisar aqui do que deixar o dono colar e esperar. */
function avisoDeEnderecoLocal(quem) {
  const host = location.hostname;
  const soNaRede =
    host === "localhost" ||
    host === "[::1]" ||
    host.endsWith(".local") ||
    /^(127|10)\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (!soNaRede && location.protocol === "https:") return null;
  const motivo = soNaRede ? "que a internet não alcança" : "sem HTTPS";
  return alertaCanal(
    `${quem} só entrega num endereço HTTPS público, e este painel está em ${location.origin}, ${motivo}. ` +
      "Publique o servidor com HTTPS ou use um túnel (ex.: cloudflared) e copie a URL de lá. " +
      "Para testar sem provedor nenhum, use o Simulador."
  );
}

function blocoParaCopiar(canal) {
  const bloco = criar("div", "copiar-bloco");
  const dados = telaCanais.credenciais[canal.id] || { credenciais: {}, secretos_definidos: [] };
  const url = `${location.origin}${canal.url_webhook}`;
  const juntar = (...itens) => bloco.append(...itens.filter(Boolean));

  if (canal.tipo === "whatsapp") {
    juntar(linhaCopiavel("URL do webhook — na Meta: WhatsApp → Configuração → Webhook", url), avisoDeEnderecoLocal("A Meta"));
    const verificacao = dados.credenciais.token_verificacao;
    if (verificacao) {
      juntar(linhaCopiavel("Token de verificação — o mesmo, no cadastro do webhook", verificacao));
    } else {
      juntar(criar("p", "dica", "Defina um token de verificação em Editar: a Meta pede para confirmar o webhook."));
    }
    if (dados.assinatura === "legada") {
      // base semeada antes da correção: o segredo aleatório recusa toda entrega real
      juntar(
        alertaCanal(
          "Há um segredo antigo, gerado pelo sistema, que a Meta não conhece: toda entrega da Meta " +
            "será recusada até você preencher o App Secret em Editar."
        )
      );
    } else if (dados.assinatura === "nenhuma") {
      const texto =
        "Sem o App Secret, a assinatura das entregas não é conferida: quem souber a URL do webhook pode " +
        "forjar mensagens de clientes. Preencha-o em Editar.";
      // em sandbox ainda não há cliente de verdade para imitar
      juntar(canal.configurado ? alertaCanal(texto) : criar("p", "dica", texto));
    }
  } else if (canal.tipo === "telegram") {
    if ((dados.credenciais.modo_recebimento || "polling") === "webhook") {
      juntar(linhaCopiavel("URL do webhook — vai no setWebhook do bot", url), avisoDeEnderecoLocal("O Telegram"));
      if (dados.segredo_webhook) juntar(linhaCopiavel("secret_token do setWebhook", dados.segredo_webhook));
    } else {
      juntar(criar("p", "dica", "Recebe por polling: não precisa de URL pública, funciona até neste computador."));
    }
  } else if (canal.tipo === "email") {
    const imap = dados.credenciais.imap_host;
    if (imap) {
      juntar(criar("p", "dica", `Recebe lendo a caixa ${imap} a cada minuto: não precisa de URL pública.`));
    } else {
      juntar(
        linhaCopiavel("Sem IMAP: aponte o webhook de entrada do provedor (Mailgun, SendGrid) para", url),
        avisoDeEnderecoLocal("O provedor de e-mail")
      );
    }
  } else if (canal.tipo === "webchat" && canal.chave_publica) {
    juntar(linhaCopiavel("Cole no site, antes do </body>", trechoDoWidget(canal.chave_publica), true));
    const demo = criar("a", "link-externo", "Testar o widget numa página de exemplo ↗");
    demo.href = `/widget/demo?chave=${encodeURIComponent(canal.chave_publica)}`;
    demo.target = "_blank";
    demo.rel = "noopener";
    juntar(demo);
  }
  return bloco;
}

function trechoDoWidget(chave) {
  return [
    `<script src="${location.origin}/widget.js"`,
    `        data-chave="${chave}"`,
    `        data-titulo="Fale com a gente"`,
    `        data-cor="#2c5cf6"></script>`,
  ].join("\n");
}

function linhaCopiavel(rotulo, texto, multilinha = false) {
  const caixa = criar("div", "copiavel");
  const linha = criar("div", "linha-copiavel");
  const valor = criar(multilinha ? "pre" : "code", "valor", texto);
  valor.tabIndex = 0; // rola na horizontal; pelo teclado também
  const botao = botaoPequeno("Copiar", "botao discreto pequeno");
  botao.setAttribute("aria-label", `Copiar: ${rotulo}`);
  botao.onclick = () => copiar(texto, botao);
  linha.append(valor, botao);
  caixa.append(criar("div", "rotulo", rotulo), linha);
  return caixa;
}

async function copiar(texto, botao) {
  try {
    await navigator.clipboard.writeText(texto);
  } catch {
    // fora de HTTPS (e de localhost) o navegador não expõe a área de transferência
    const area = criar("textarea");
    area.value = texto;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;opacity:0;pointer-events:none";
    document.body.append(area);
    area.select();
    const copiou = document.execCommand("copy");
    area.remove();
    botao.focus();
    if (!copiou) {
      avisar("Não deu para copiar: selecione o texto e use Ctrl+C.", true);
      return;
    }
  }
  botao.textContent = "Copiado ✓";
  setTimeout(() => (botao.textContent = "Copiar"), 1600);
}

/* ---------------------------------------------------------- canais: edição */
function abrirEdicao(canalId, seletorFoco = "input, select") {
  const canal = estado.canais.find((c) => c.id === canalId);
  if (!canal) return mostrarListaCanais();
  telaCanais.editando = canalId;
  telaCanais.removendo = null;
  mostrarCabecalhoCanais();
  corpoCanais.replaceChildren(formularioDeEdicao(canal));
  corpoCanais.scrollTop = 0; // a lista podia estar rolada até o último canal
  corpoCanais.querySelector(seletorFoco)?.focus();
}

const PARA_MANTER = "definido — deixe em branco para manter";

function controleDoCampo(campo, dados) {
  let controle;
  if (campo.opcoes.length) {
    controle = criar("select");
    for (const opcao of campo.opcoes) controle.append(new Option(opcao, opcao));
  } else {
    controle = criar("input");
    controle.spellcheck = false;
    // o valor de um segredo nunca vem do servidor: em branco = manter o atual
    controle.type = campo.secreto ? "password" : "text";
    controle.autocomplete = campo.secreto ? "new-password" : "off";
    if (!campo.secreto) controle.placeholder = campo.padrao || "";
    if (campo.chave.endsWith("_porta")) {
      // o teclado numérico no celular; quem valida de verdade é a API
      controle.inputMode = "numeric";
      controle.maxLength = 5;
    }
  }
  controle.name = campo.chave;
  const atual = dados.credenciais[campo.chave];
  if (campo.secreto) {
    controle.placeholder = dados.secretos_definidos.includes(campo.chave) ? PARA_MANTER : "";
  } else if (campo.opcoes.length) {
    controle.value = atual ?? (campo.padrao || campo.opcoes[0]);
  } else {
    controle.value = atual ?? "";
  }
  // o que está gravado: ao salvar, só vai o que a pessoa mudou
  controle.dataset.salvo = campo.secreto ? "" : controle.value;
  return controle;
}

/* Em branco quer dizer "manter" (o valor nunca volta à tela), então apagar um
   segredo é um pedido à parte. É também o caminho de volta ao sandbox depois
   de colar um token de teste num canal de demonstração. */
function botaoApagar(campo, controle) {
  const botao = botaoPequeno("Apagar", "botao discreto pequeno apagar-segredo");
  botao.setAttribute("aria-pressed", "false");
  botao.setAttribute("aria-label", `Apagar ${campo.rotulo} ao salvar`);
  botao.onclick = () => {
    const apagar = botao.getAttribute("aria-pressed") !== "true";
    botao.setAttribute("aria-pressed", String(apagar));
    controle.dataset.limpar = apagar ? "1" : "";
    controle.disabled = apagar;
    controle.value = "";
    controle.placeholder = apagar ? "será apagado ao salvar" : PARA_MANTER;
    controle.dispatchEvent(new Event("input"));
  };
  return botao;
}

function formularioDeEdicao(canal) {
  const dados = telaCanais.credenciais[canal.id] || { credenciais: {}, secretos_definidos: [] };
  const campos = telaCanais.tipos[canal.tipo] || [];
  const form = criar("form", "cartao-canal form-canal");
  form.dataset.canal = canal.id;

  const titulo = criar("h3", "", canal.nome);
  const topo = criar("div", "linha");
  topo.append(titulo, selo(canal.tipo, NOMES_CANAL[canal.tipo] || canal.tipo));
  form.append(topo);

  if (campos.length && !canal.configurado) {
    // colar um token de teste tira o canal do sandbox: sem o aviso, o
    // Simulador "some" com ele e ninguém sabe por quê
    form.append(
      alertaCanal(
        "Este canal está no sandbox: as respostas ficam só registradas aqui e o Simulador faz o papel " +
          "do cliente. Com as credenciais salvas, ele passa a falar com o provedor de verdade: o Simulador " +
          "deixa de oferecê-lo e as respostas saem de fato. Para voltar, use “Apagar” ao lado de cada segredo."
      )
    );
  }

  const nome = campoDeNome(canal.nome);
  form.append(campoRotulado("Nome do canal", nome, "Só para a equipe: aparece nos filtros e em cada conversa."));

  const porChave = {};
  const controles = campos.map((campo) => {
    const controle = controleDoCampo(campo, dados);
    porChave[campo.chave] = controle;
    const caixa = campoRotulado(campo.rotulo, controle, campo.ajuda, campo.obrigatorio);
    if (campo.secreto && dados.secretos_definidos.includes(campo.chave)) caixa.append(botaoApagar(campo, controle));
    form.append(caixa);
    return [campo, controle];
  });
  if (!campos.length) {
    form.append(criar("p", "dica", "O webchat não tem credenciais: basta colar o trecho no site."), blocoParaCopiar(canal));
  }

  // Trocar o servidor com uma senha guardada exige digitá-la de novo: a API
  // recusa, para que a senha não siga para um host que só quem editou
  // escolheu. Marcar aqui poupa a ida e volta.
  const haSenhaGuardada = dados.secretos_definidos.length > 0;
  const exigirSenhas = () => {
    for (const [campo, controle] of controles) {
      if (!campo.destinos?.length || controle.dataset.limpar) continue;
      const mudou = campo.destinos.some((chave) => {
        const alvo = porChave[chave];
        return alvo && alvo.value.trim() && alvo.value.trim() !== alvo.dataset.salvo.trim();
      });
      controle.required = mudou && haSenhaGuardada;
      const definido = dados.secretos_definidos.includes(campo.chave);
      controle.placeholder = controle.required ? "digite de novo: o servidor mudou" : definido ? PARA_MANTER : "";
    }
  };
  for (const [, controle] of controles) controle.addEventListener("input", exigirSenhas);

  const resultado = areaDeResultado(canal.id);
  const salvar = botaoDeTeste("Salvar e testar", "botao pequeno salvar", canal.id);
  salvar.type = "submit";
  const voltar = botaoPequeno("Voltar à lista", "botao discreto pequeno");
  voltar.onclick = () => mostrarListaCanais(canal.id);
  const acoes = criar("div", "acoes-canal");
  acoes.append(salvar, voltar);
  form.append(resultado, acoes);

  form.onsubmit = async (evento) => {
    evento.preventDefault();
    const nomeLimpo = nomeValido(nome);
    if (nomeLimpo === null) return;
    // só o que mudou: segredo em branco fica de fora (o servidor mantém o
    // atual), campo comum apagado vai vazio (o servidor limpa)
    const corpo = {};
    if (nomeLimpo !== canal.nome) corpo.nome = nomeLimpo;
    const credenciais = {};
    const limpar = [];
    for (const [campo, controle] of controles) {
      if (controle.dataset.limpar) {
        limpar.push(campo.chave);
        continue;
      }
      const valor = controle.value.trim();
      if (campo.secreto ? valor : valor !== controle.dataset.salvo.trim()) credenciais[campo.chave] = valor;
    }
    if (Object.keys(credenciais).length) corpo.credenciais = credenciais;
    if (limpar.length) corpo.limpar = limpar;

    salvar.disabled = true;
    try {
      if (Object.keys(corpo).length) {
        await api("PATCH", `/api/canais/${canal.id}`, corpo);
        await recarregarCanais();
        // refeito com o que ficou gravado: o segredo digitado some, o "Apagar"
        // aparece ou some, o aviso de sandbox sai. Só se a pessoa ainda está aqui
        if (telaCanais.editando === canal.id) abrirEdicao(canal.id, `[data-resultado-canal="${canal.id}"]`);
      }
      await testarCanal(canal.id);
    } catch (erro) {
      telaCanais.resultados[canal.id] = { ok: false, titulo: "Não foi salvo.", mensagem: erro.message };
      refletirTeste(canal.id);
    } finally {
      marcarBotaoDeTeste(salvar, telaCanais.testes[canal.id] === "andamento");
    }
  };
  return form;
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
