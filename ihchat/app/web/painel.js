/* IHchat - painel do atendente.
   Sem framework de propósito: o painel é uma tela só, e o que muda nela chega
   pelos eventos do servidor (eventos.js: EventSource no app Python, consulta a
   cada 2 s no PHP da hospedagem compartilhada). */

const estado = {
  token: localStorage.getItem("ihchat_token") || null,
  atendente: null,
  conversas: [],
  atualId: null,
  detalhe: null,
  // conversa sendo aberta: o que chega pelos eventos durante o GET dela fica
  // guardado aqui e entra no detalhe quando ele volta (ver abrirConversa)
  abrindo: null,
  filtro: { tipo: "aberta" },
  busca: "",
  canais: [],
  etiquetas: [],
  respostas: [],
  atendentes: [],
  modo: "resposta",
  eventos: null, // IHchatEventos: stream ou consulta, conforme o /saude
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
    localStorage.setItem("ihchat_token", token);
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
  localStorage.removeItem("ihchat_token");
  estado.token = null;
  estado.atendente = null; // o próximo login pode ser de outra pessoa, com outro papel
  if (estado.eventos) estado.eventos.fechar();
  estado.eventos = null;
  estado.atualId = null;
  estado.detalhe = null;
  estado.abrindo = null;
  $("#app").classList.remove("com-conversa");
  fecharCanais();
  fecharEquipe();
  fecharPerfil();
  fecharFicha();
  esquecerCanais();
  $("#abrir-canais").hidden = true;
  $("#abrir-equipe").hidden = true;
  $("#app").hidden = true;
  $("#tela-login").hidden = false;
}

/* --------------------------------------------------------------- início */
async function iniciar() {
  $("#tela-login").hidden = true;
  $("#app").hidden = false;

  estado.atendente = estado.atendente || (await api("GET", "/api/auth/eu"));
  desenharPerfil();
  // a API recusa do mesmo jeito; esconder só poupa o atendente de um 403
  $("#abrir-canais").hidden = estado.atendente.papel !== "admin";
  $("#abrir-equipe").hidden = estado.atendente.papel !== "admin";

  // o cursor dos eventos vem ANTES das listas: o que chegar enquanto elas
  // carregam é entregue depois (repetido, no máximo, e os desenhos ignoram)
  criarEventos();
  await estado.eventos.preparar().catch(() => null);

  [estado.canais, estado.etiquetas, estado.respostas, estado.atendentes] = await Promise.all([
    api("GET", "/api/canais"),
    api("GET", "/api/etiquetas"),
    api("GET", "/api/respostas-rapidas"),
    api("GET", "/api/atendentes"),
  ]);

  desenharFiltros();
  await Promise.all([carregarConversas(), carregarMetricas()]);
  estado.eventos.iniciar();
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
/* O detalhe é um retrato do servidor. O que chegar pelos eventos enquanto ele
   viaja (o cliente mandando várias mensagens seguidas bem na hora do clique)
   já passou do cursor e não volta: fica guardado em estado.abrindo e entra no
   detalhe quando ele chega, sem repetir o que o retrato já tinha. */
async function abrirConversa(id) {
  const abrindo = { id, mensagens: new Map(), status: new Map() };
  estado.abrindo = abrindo;
  estado.atualId = id;
  $("#app").classList.add("com-conversa");
  let detalhe;
  try {
    detalhe = await api("GET", `/api/conversas/${id}`);
  } finally {
    if (estado.abrindo === abrindo) estado.abrindo = null;
  }
  if (estado.atualId !== id) return; // outro clique chegou antes desta resposta
  juntarChegadas(detalhe, abrindo);
  estado.detalhe = detalhe;
  const local = estado.conversas.find((c) => c.id === id);
  if (local) local.nao_lidas = 0;
  desenharLista();
  desenharConversa();
  agendarMetricas();
}

function juntarChegadas(detalhe, abrindo) {
  const vistos = new Set(detalhe.mensagens.map((m) => m.id));
  let novas = false;
  for (const mensagem of abrindo.mensagens.values()) {
    if (vistos.has(mensagem.id)) continue;
    detalhe.mensagens.push(mensagem);
    novas = true;
  }
  if (novas) detalhe.mensagens.sort((a, b) => data(a.criada_em) - data(b.criada_em) || a.id - b.id);
  for (const mensagem of detalhe.mensagens) {
    if (abrindo.status.has(mensagem.id)) mensagem.status = abrindo.status.get(mensagem.id);
  }
}

$("#voltar-lista").addEventListener("click", () => {
  $("#app").classList.remove("com-conversa");
  fecharFicha();
  document.querySelector(`#lista-conversas .item[data-id="${Number(estado.atualId)}"]`)?.focus();
});

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
    const dia = data(mensagem.criada_em).toDateString();
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
  if (nota) {
    meta.append(criar("span", "", `nota de ${mensagem.autor || ""}`));
  } else if (mensagem.direcao === "saida" && mensagem.assinatura) {
    // exatamente o que o cliente viu: nome e setor gravados no envio
    const quem = criar("span", "quem", linhaAssinatura(mensagem.assinatura));
    quem.title = "Como o cliente viu quem respondeu";
    meta.append(quem);
  } else {
    meta.append(criar("span", "", mensagem.autor || ""));
  }
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
  const ficha = $("#corpo-ficha");
  ficha.replaceChildren();
  const contato = conversa.contato;

  const bloco = criar("div", "bloco");
  bloco.append(criar("h3", "", "Contato"));
  for (const [rotulo, valor] of [
    ["Nome", contato.nome],
    ["Empresa", contato.empresa],
    ["CNPJ/CPF", contato.documento],
    ["E-mail", contato.email],
    ["Telefone", contato.telefone],
    // o e-mail digitado no widget fica aqui, não confirmado
    ["Observações", contato.observacoes],
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
      // no webchat o identificador é um código aleatório da sessão: não diz nada
      const quem = identidade.canal_tipo === "webchat" ? "visitante do site" : identidade.identificador;
      lista.append(selo(identidade.canal_tipo, `${NOMES_CANAL[identidade.canal_tipo] || identidade.canal_tipo}: ${quem}`));
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
  if (estado.abrindo && estado.abrindo.id === mensagem.conversa_id) {
    estado.abrindo.mensagens.set(mensagem.id, mensagem);
  }
  // o detalhe na tela é o de ESTA conversa: durante a abertura de outra, ele
  // ainda é o da anterior, e o balão iria parar na conversa errada
  if (!estado.detalhe || estado.detalhe.id !== mensagem.conversa_id) return;
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
function criarEventos() {
  if (estado.eventos) estado.eventos.fechar();
  const token = encodeURIComponent(estado.token);
  const cursor = (depois) => (depois === null || depois === undefined ? "" : `&depois=${depois}`);
  estado.eventos = IHchatEventos.criar({
    stream: (depois) => `/api/eventos/stream?token=${token}${cursor(depois)}`,
    desde: (depois) => `/api/eventos/desde?token=${token}${cursor(depois)}`,
    tipos: ["mensagem.nova", "mensagem.status", "conversa.atualizada"],
    aoEvento: tratarEvento,
    aoEstado: (situacao) => {
      if (situacao === "reconectando" || situacao === "desconectado") console.warn(`eventos: ${situacao}`);
    },
    aoRecusar: sair,
  });
}

function tratarEvento(tipo, dados) {
  if (tipo === "mensagem.nova") {
    acrescentarMensagem(dados);
    if (dados.direcao === "entrada" && dados.conversa_id !== estado.atualId) {
      avisarNovaMensagem(dados.autor);
    }
  } else if (tipo === "mensagem.status") {
    if (estado.abrindo && estado.abrindo.id === dados.conversa_id) estado.abrindo.status.set(dados.id, dados.status);
    const guardada = estado.detalhe?.mensagens.find((m) => m.id === dados.id);
    if (guardada) guardada.status = dados.status;
    const balaoExistente = document.querySelector(`.balao[data-id="${Number(dados.id)}"] .estado`);
    if (balaoExistente) balaoExistente.textContent = rotuloStatus(dados.status);
  } else if (tipo === "conversa.atualizada") {
    atualizarConversaNaLista(dados);
  }
}

/* Na consulta (PHP) os eventos chegam em lote: depois de uma queda de rede
   ou de a aba voltar, até 200 de uma vez. Cada um redesenhando a lista, pedindo
   as métricas e empilhando um aviso virava uma rajada de requisições (cada
   uma um processo PHP na hospedagem) e de avisos. Os efeitos se juntam:
   a lista é redesenhada uma vez por lote, as métricas no máximo uma vez a
   cada ESPERA_METRICAS, e os avisos viram um resumo. */
const ESPERA_METRICAS = 1500;
let listaAgendada = false;
let metricasAgendadas = null;
const avisosPendentes = [];

function agendarLista() {
  if (listaAgendada) return;
  listaAgendada = true;
  // microtarefa: roda depois do laço que entrega o lote, mesmo com a aba oculta
  queueMicrotask(() => {
    listaAgendada = false;
    desenharLista();
  });
}

function agendarMetricas() {
  if (metricasAgendadas !== null) return;
  metricasAgendadas = setTimeout(() => {
    metricasAgendadas = null;
    if (estado.token) carregarMetricas().catch(() => null);
  }, ESPERA_METRICAS);
}

function avisarNovaMensagem(autor) {
  avisosPendentes.push(autor || "cliente");
  if (avisosPendentes.length > 1) return;
  setTimeout(() => {
    const autores = [...new Set(avisosPendentes)];
    const total = avisosPendentes.length;
    avisosPendentes.length = 0;
    if (total === 1) return avisar(`Nova mensagem de ${autores[0]}`);
    const quem = autores.length <= 2 ? autores.join(" e ") : `${autores.slice(0, 2).join(", ")} e mais ${autores.length - 2}`;
    avisar(`${total} mensagens novas (${quem})`);
  }, 400);
}

function atualizarConversaNaLista(conversa) {
  const indice = estado.conversas.findIndex((c) => c.id === conversa.id);
  if (indice >= 0) estado.conversas[indice] = conversa;
  else if (cabeNoFiltro(conversa)) estado.conversas.unshift(conversa);
  // a conversa aberta já foi lida por quem está olhando
  if (conversa.id === estado.atualId) {
    const local = estado.conversas.find((c) => c.id === conversa.id);
    if (local) local.nao_lidas = 0;
  }
  estado.conversas.sort((a, b) => data(b.ultima_mensagem_em) - data(a.ultima_mensagem_em));
  agendarLista();
  agendarMetricas();
}

/* Conversa nova só entra na lista se for do filtro em uso: sem isto, uma
   conversa do WhatsApp aparecia no filtro "Telegram" até recarregar. */
function cabeNoFiltro(conversa) {
  const { tipo, valor } = estado.filtro;
  if (estado.busca) return false; // a busca é do servidor: espera a próxima
  if (tipo === "canal") return conversa.canal.id === valor;
  if (tipo === "etiqueta") return conversa.etiquetas.some((e) => e.id === valor);
  if (tipo === "minhas") return conversa.atendente?.id === estado.atendente?.id;
  if (tipo === "sem") return !conversa.atendente;
  if (["aberta", "pendente", "resolvida"].includes(tipo)) return conversa.status === tipo;
  return true;
}

/* ---------------------------------------------------------------- perfil */
/* O cliente vê o nome e o setor de quem responde. Cada atendente define o
   seu setor aqui (sugestões ou texto livre) e se está disponível. */
const SETORES = ["Suporte técnico", "Financeiro", "Comercial", "Implantação"];
const telaPerfil = $("#perfil");

function linhaAssinatura(assinatura) {
  if (!assinatura) return "";
  return assinatura.setor ? `${assinatura.nome} · ${assinatura.setor}` : assinatura.nome;
}

function desenharPerfil() {
  const eu = estado.atendente;
  if (!eu) return;
  const linha = linhaAssinatura({ nome: eu.nome, setor: eu.setor });
  $("#nome-atendente").textContent = linha;
  $("#avatar").textContent = iniciais(eu.nome);
  const ponto = $("#ponto-disponivel");
  ponto.classList.toggle("fora", !eu.disponivel);
  ponto.title = eu.disponivel ? "Disponível para conversas novas" : "Fora da distribuição de conversas novas";
  $("#abrir-perfil").setAttribute("aria-label", `Atendendo como ${linha}. Mudar setor ou disponibilidade`);
  const assinatura = $("#assinatura-redator");
  assinatura.replaceChildren("· O cliente vê ", criar("b", "", linha));
}

$("#abrir-perfil").addEventListener("click", abrirPerfil);
$("#fechar-perfil").addEventListener("click", fecharPerfil);
$("#cancelar-perfil").addEventListener("click", fecharPerfil);
telaPerfil.addEventListener("mousedown", (evento) => {
  if (evento.target === telaPerfil) fecharPerfil();
});
$("#perfil-setor").addEventListener("input", previaDoPerfil);

function abrirPerfil() {
  const eu = estado.atendente;
  if (!eu) return;
  $("#perfil-setor").value = eu.setor || "";
  $("#perfil-disponivel").checked = Boolean(eu.disponivel);
  $("#erro-perfil").textContent = "";
  const sugestoes = $("#sugestoes-setor");
  sugestoes.replaceChildren(
    ...SETORES.map((setor) => {
      const botao = criar("button", "", setor);
      botao.type = "button";
      botao.onclick = () => {
        $("#perfil-setor").value = setor;
        previaDoPerfil();
      };
      return botao;
    })
  );
  previaDoPerfil();
  telaPerfil.hidden = false;
  $("#perfil-setor").focus();
}

function previaDoPerfil() {
  const setor = $("#perfil-setor").value.trim();
  $("#previa-assinatura").textContent = linhaAssinatura({ nome: estado.atendente?.nome || "", setor });
  $("#sugestoes-setor").querySelectorAll("button").forEach((botao) => {
    botao.setAttribute("aria-pressed", String(botao.textContent === setor));
  });
}

function fecharPerfil() {
  if (telaPerfil.hidden) return;
  telaPerfil.hidden = true;
  $("#abrir-perfil").focus();
}

$("#form-perfil").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const botao = $("#salvar-perfil");
  botao.disabled = true;
  $("#erro-perfil").textContent = "";
  try {
    const atualizado = await api("PATCH", `/api/atendentes/${estado.atendente.id}`, {
      setor: $("#perfil-setor").value.trim() || null,
      disponivel: $("#perfil-disponivel").checked,
    });
    estado.atendente = atualizado;
    const naLista = estado.atendentes.findIndex((a) => a.id === atualizado.id);
    if (naLista >= 0) estado.atendentes[naLista] = atualizado;
    desenharPerfil();
    fecharPerfil();
    avisar(`Agora o cliente vê: ${linhaAssinatura(atualizado)}`);
  } catch (erro) {
    $("#erro-perfil").textContent = erro.message;
  } finally {
    botao.disabled = false;
  }
});

/* ------------------------------------------------------ ficha como gaveta */
/* Em tela média (até 1200 px) a ficha sai da grade e vira gaveta. Tem de
   fechar de todo jeito: o × dentro dela, o Esc e um clique fora. */
const ficha = $("#ficha");
const fundoFicha = $("#fundo-ficha");
const fichaEmGaveta = window.matchMedia("(max-width: 1200px)");

$("#abrir-ficha").addEventListener("click", () => (ficha.classList.contains("aberta") ? fecharFicha() : abrirFicha()));
$("#fechar-ficha").addEventListener("click", () => fecharFicha(true));
fundoFicha.addEventListener("mousedown", () => fecharFicha(true));
// voltou a caber como coluna: some o fundo escuro que ficaria preso na tela
fichaEmGaveta.addEventListener("change", () => fichaEmGaveta.matches || fecharFicha());

function abrirFicha() {
  if (!estado.detalhe) return;
  ficha.classList.add("aberta");
  fundoFicha.hidden = false;
  ficha.setAttribute("role", "dialog");
  ficha.setAttribute("aria-modal", "true");
  $("#abrir-ficha").setAttribute("aria-expanded", "true");
  $("#fechar-ficha").focus();
}

function fecharFicha(devolverFoco = false) {
  const estavaAberta = ficha.classList.contains("aberta");
  ficha.classList.remove("aberta");
  fundoFicha.hidden = true;
  ficha.removeAttribute("role");
  ficha.removeAttribute("aria-modal");
  $("#abrir-ficha").setAttribute("aria-expanded", "false");
  if (estavaAberta && devolverFoco) $("#abrir-ficha").focus();
}

document.addEventListener("keydown", (evento) => {
  if (evento.key !== "Escape") return;
  if (!telaPerfil.hidden) {
    evento.preventDefault();
    fecharPerfil();
  } else if (ficha.classList.contains("aberta")) {
    evento.preventDefault();
    fecharFicha(true);
  }
});

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
    // o servidor tem as rotas de webhook do Telegram? Os dois têm; um servidor
    // anterior responde 404 no clique, e aí os botões somem (acaoDeWebhook)
    rotasDeWebhook: true,
  };
}

const telaCanais = telaCanaisVazia();
const gavetaCanais = $("#canais");
const corpoCanais = $("#corpo-canais");
let sequenciaCampo = 0;
let sequenciaTeste = 0;

/* Dois jeitos de ligar o WhatsApp: a API oficial da Meta ("whatsapp") e o QR
   Code, com a sessão num provedor online ("whatsapp_qr"). Na caixa de entrada
   os dois são só "WhatsApp" (é onde o cliente está); aqui, cada tipo diz o que é. */
NOMES_CANAL.whatsapp_qr ??= "WhatsApp";
const ROTULOS_DE_TIPO = { whatsapp: "WhatsApp (API oficial)", whatsapp_qr: "WhatsApp (QR Code)" };
const rotuloDoTipo = (tipo) => ROTULOS_DE_TIPO[tipo] || NOMES_CANAL[tipo] || tipo;

/* Campos de cada provedor do QR Code: o formulário mostra só os do escolhido.
   Os obrigatórios são os mesmos que o servidor exige (campos_obrigatorios). */
const PROVEDORES_QR = {
  zapi: {
    rotulo: "Z-API (online, nada para instalar)",
    nome: "Z-API",
    campos: ["instancia_id", "instancia_token", "client_token"],
    obrigatorios: ["instancia_id", "instancia_token"],
  },
  evolution: {
    rotulo: "Evolution API (servidor próprio)",
    nome: "Evolution API",
    campos: ["url_servidor", "api_key", "nome_instancia"],
    obrigatorios: ["url_servidor", "api_key", "nome_instancia"],
  },
};
const provedorQrDe = (credenciais) => PROVEDORES_QR[credenciais?.provedor] || PROVEDORES_QR.zapi;

const AVISO_NAO_OFICIAL =
  "Conexão não oficial (a mesma do WhatsApp Web): o WhatsApp pode bloquear o número que mandar mensagens em " +
  "massa ou receber muitas denúncias. Para uso oficial, use o tipo “WhatsApp (API oficial)”.";

/* "5511988887777" -> "+55 (11) 98888-7777"; outro país ou id oculto (@lid) sai como veio. */
function numeroLegivel(numero) {
  const digitos = String(numero || "");
  const br = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(digitos);
  if (br) return `+55 (${br[1]}) ${br[2]}-${br[3]}`;
  return /^\d+$/.test(digitos) ? `+${digitos}` : digitos;
}

/* Chamado ao sair: a próxima pessoa na mesma aba pode ser uma atendente, e o
   secret_token do Telegram guardado aqui deixaria forjar mensagens. */
function esquecerCanais() {
  fecharDialogoQr();
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
  // o diálogo do QR Code (modal, por cima da gaveta) cuida das próprias teclas
  if (gavetaCanais.hidden || dialogoQr.elemento?.open) return;
  if (evento.key === "Escape") {
    evento.preventDefault();
    fecharCanais();
  } else if (evento.key === "Tab") {
    prenderFoco(evento);
  }
});

/* Com a gaveta aberta o Tab não pode cair na caixa de entrada escondida atrás
   dela: quem navega por teclado se perderia sem ver onde está o foco. */
function prenderFoco(evento, gaveta = gavetaCanais) {
  const focaveis = [...gaveta.querySelectorAll("button, a[href], input, select, textarea, [tabindex='0']")]
    .filter((elemento) => !elemento.disabled && elemento.offsetParent !== null);
  if (!focaveis.length) return;
  const primeiro = focaveis[0];
  const ultimo = focaveis[focaveis.length - 1];
  const dentro = gaveta.contains(document.activeElement);
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
  // "Novo canal" só depois de carregar: clicado antes, o formulário era
  // redesenhado quando a lista chegava e o tipo escolhido voltava ao
  // primeiro da lista (criava um WhatsApp em vez do Telegram escolhido)
  const novo = $("#canais-novo");
  novo.disabled = true;
  try {
    telaCanais.tipos = telaCanais.tipos || (await api("GET", "/api/canais/tipos"));
    await recarregarCanais();
    mostrarListaCanais();
  } catch (erro) {
    corpoCanais.replaceChildren(criar("p", "erro", `Não foi possível carregar os canais: ${erro.message}`));
  } finally {
    novo.disabled = false;
    if (!gavetaCanais.hidden && !gavetaCanais.contains(document.activeElement)) novo.focus();
  }
}

function fecharCanais() {
  if (gavetaCanais.hidden) return;
  fecharDialogoQr();
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
  if (canal.tipo === "whatsapp_qr" && !telaCanais.testes[canal.id]) return situacaoDoQr(canal);
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

/* WhatsApp pelo QR Code sem teste nesta sessão: vale o que o servidor soube
   do provedor por último (o /qr, o teste ou um evento de conexão). */
function situacaoDoQr(canal) {
  const credenciais = telaCanais.credenciais[canal.id]?.credenciais || {};
  if (credenciais.estado_conexao === "conectado") {
    const numero = credenciais.numero_conectado ? ` ao número ${numeroLegivel(credenciais.numero_conectado)}` : "";
    return ["Conectado", "conectado", `WhatsApp conectado${numero}. A sessão fica online, no provedor.`];
  }
  if (credenciais.estado_conexao) {
    return ["Desconectado", "nao-testado", "O número não está conectado: use “Conectar pelo QR Code” e leia o código com o celular."];
  }
  return ["Falta o QR Code", "nao-testado", "Credenciais salvas. Falta conectar o número: use “Conectar pelo QR Code”."];
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
  for (const chave of Object.keys(telaCanais.tipos)) tipo.append(new Option(rotuloDoTipo(chave), chave));
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
  topo.append(titulo, selo(canal.tipo, rotuloDoTipo(canal.tipo)), criar("span", `situacao ${classe}`, rotulo));
  cartao.append(topo, criar("p", "dica explicacao", explicacao), blocoParaCopiar(canal));

  cartao.append(areaDeResultado(canal.id));
  cartao.append(telaCanais.removendo === canal.id ? confirmacaoRemover(canal) : acoesDoCanal(canal));
  // cada botão diz a que canal pertence, para quem usa leitor de tela
  cartao.querySelectorAll(".acoes-canal button").forEach((botao) => botao.setAttribute("aria-describedby", titulo.id));
  return cartao;
}

function acoesDoCanal(canal) {
  const acoes = criar("div", "acoes-canal");
  const qr = canal.tipo === "whatsapp_qr";
  if (qr) acoes.append(botaoDoQr(canal));
  const testar = botaoDeTeste("Testar conexão", qr ? "botao discreto pequeno testar" : "botao pequeno testar", canal.id);
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
  acoes.append(testar, editar, alternar);
  acoes.append(...botoesDeWebhook(canal), ...botoesDeWebhookQr(canal));
  acoes.append(remover);
  return acoes;
}

/* Telegram: o servidor faz o setWebhook/deleteWebhook do bot (o token nunca
   passa pelo navegador). PHP e Python têm as rotas; num servidor anterior o
   clique dá 404 e os botões somem. "Conectar" ainda exige o endereço público
   com HTTPS (url_publica), que é quando a url_webhook do canal já vem
   absoluta: sem isso o Telegram recusa. */

function botoesDeWebhook(canal) {
  if (canal.tipo !== "telegram" || telaCanais.rotasDeWebhook !== true) return [];
  const dados = telaCanais.credenciais[canal.id] || { credenciais: {} };
  const emWebhook = (dados.credenciais.modo_recebimento || "polling") === "webhook";
  // no polling, o teste avisa quando um webhook de outro sistema trava a entrega
  // e manda usar "Remover webhook": o botão precisa estar lá
  const ultimo = telaCanais.resultados[canal.id];
  const pedeRemocao = /remover webhook/i.test(`${ultimo?.mensagem || ""} ${ultimo?.alerta || ""}`);
  const botoes = [];
  if (/^https:\/\//i.test(canal.url_webhook || "") && canal.configurado) {
    const conectar = botaoDeTeste(emWebhook ? "Reconectar webhook" : "Conectar webhook", "botao discreto pequeno conectar-webhook", canal.id);
    conectar.title = `O Telegram passa a entregar as mensagens em ${canal.url_webhook}`;
    conectar.onclick = () =>
      acaoDeWebhook(canal, "conectar-webhook", "Conectando o webhook no Telegram…", "✓ Webhook conectado.", "✗ Não conectou.");
    botoes.push(conectar);
  }
  if (emWebhook || pedeRemocao) {
    const remover = botaoDeTeste("Remover webhook", "botao discreto pequeno remover-webhook", canal.id);
    remover.title = "Apaga o webhook do bot e volta a buscar as mensagens por polling";
    remover.onclick = () =>
      acaoDeWebhook(canal, "remover-webhook", "Removendo o webhook do Telegram…", "✓ Webhook removido.", "✗ Não removeu.");
    botoes.push(remover);
  }
  return botoes;
}

async function acaoDeWebhook(canal, rota, andamento, tituloOk, tituloFalha) {
  const vez = ++sequenciaTeste;
  const situacaoAntes = telaCanais.testes[canal.id];
  telaCanais.vezDoTeste[canal.id] = vez;
  telaCanais.testes[canal.id] = "andamento";
  telaCanais.resultados[canal.id] = { andamento: true };
  refletirTeste(canal.id);
  corpoCanais.querySelector(`[data-resultado-canal="${canal.id}"]`)?.replaceChildren(andamento);
  let resultado;
  let semRota = false;
  try {
    const resposta = await fetch(`/api/canais/${canal.id}/${rota}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${estado.token}` },
    });
    if (resposta.status === 401) {
      sair();
      return;
    }
    const corpo = await resposta.json().catch(() => ({}));
    if (resposta.status === 404 && corpo.detail === "Not Found") {
      semRota = true;
      resultado = { ok: false, mensagem: "este servidor não oferece esta ação; faça pelo próprio Telegram (API do bot)." };
    } else if (!resposta.ok) {
      resultado = { ok: false, mensagem: corpo.detail || `falha na requisição (${resposta.status})` };
    } else {
      resultado = corpo;
    }
  } catch (erro) {
    resultado = { ok: false, mensagem: erro.message };
  }
  if (telaCanais.vezDoTeste[canal.id] !== vez) return;
  const removendo = rota === "remover-webhook";
  resultado = { ...resultado, titulo: resultado.ok ? (resultado.alerta ? undefined : tituloOk) : tituloFalha };
  // remover que falha não diz nada sobre as credenciais: o selo fica como estava
  telaCanais.testes[canal.id] = resultado.ok
    ? resultado.alerta ? "ressalva" : "ok"
    : removendo || semRota ? situacaoAntes : "falha";
  telaCanais.resultados[canal.id] = resultado;
  if (semRota) {
    telaCanais.rotasDeWebhook = false;
    if (telaCanais.editando === null) redesenharCartao(canal.id, `[data-resultado-canal="${canal.id}"]`);
  } else if (resultado.ok) {
    // o modo de recebimento mudou (webhook ou polling): o cartão mostra o novo
    await recarregarCanais().catch(() => null);
    if (telaCanais.editando === null) redesenharCartao(canal.id, `[data-resultado-canal="${canal.id}"]`);
  }
  refletirTeste(canal.id);
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
  // o servidor PHP já manda a URL absoluta (o endereço público configurado,
  // url_publica); o Python manda o caminho, e vale o endereço deste painel
  const absoluta = /^https?:\/\//i.test(canal.url_webhook || "");
  const url = absoluta ? canal.url_webhook : `${location.origin}${canal.url_webhook}`;
  const juntar = (...itens) => bloco.append(...itens.filter(Boolean));
  const avisoLocal = (quem) => (absoluta && /^https:/i.test(url) ? null : avisoDeEnderecoLocal(quem));

  if (canal.tipo === "whatsapp") {
    juntar(linhaCopiavel("URL do webhook — na Meta: WhatsApp → Configuração → Webhook", url), avisoLocal("A Meta"));
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
      juntar(linhaCopiavel("URL do webhook — vai no setWebhook do bot", url), avisoLocal("O Telegram"));
      if (dados.segredo_webhook) juntar(linhaCopiavel("secret_token do setWebhook", dados.segredo_webhook));
    } else {
      juntar(criar("p", "dica", "Recebe por polling: não precisa de URL pública, funciona até neste computador."));
    }
  } else if (canal.tipo === "whatsapp_qr") {
    const webhook = dados.credenciais.webhook_url;
    if (!canal.configurado) {
      juntar(criar("p", "dica", "Preencha em Editar as credenciais do provedor (Z-API ou Evolution API) e depois use “Conectar pelo QR Code”."));
    } else if (webhook) {
      juntar(criar("p", "dica", `Recebe as mensagens pelo webhook ${webhook} (cadastrado no provedor).`));
    } else {
      juntar(
        criar(
          "p",
          "dica",
          absoluta
            ? "Falta conectar o webhook: sem ele as mensagens dos clientes não chegam. Use “Conectar webhook”."
            : "Para as mensagens chegarem, o provedor precisa de um endereço público deste IHchat (url_publica). " +
                "Sem ele, cadastre à mão, no provedor, a URL abaixo."
        )
      );
      // a URL leva o token do canal: é o que o webhook confere (só o admin a vê)
      if (dados.segredo_webhook) {
        juntar(
          linhaCopiavel("URL do webhook, com o token do canal", `${url}?token=${encodeURIComponent(dados.segredo_webhook)}`),
          avisoLocal("O provedor")
        );
      }
    }
  } else if (canal.tipo === "email") {
    const imap = dados.credenciais.imap_host;
    if (imap) {
      juntar(criar("p", "dica", `Recebe lendo a caixa ${imap} a cada minuto: não precisa de URL pública.`));
    } else {
      juntar(
        linhaCopiavel("Sem IMAP: aponte o webhook de entrada do provedor (Mailgun, SendGrid) para", url),
        avisoLocal("O provedor de e-mail")
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
  topo.append(titulo, selo(canal.tipo, rotuloDoTipo(canal.tipo)));
  form.append(topo);
  if (canal.tipo === "whatsapp_qr") form.append(criar("p", "dica aviso-nao-oficial", AVISO_NAO_OFICIAL));

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
  acoes.append(salvar);
  if (canal.tipo === "whatsapp_qr") {
    prepararCamposDoQr(controles, porChave);
    // o QR usa o que está GRAVADO: com mudança por salvar, ele falaria com o provedor antigo
    const conectar = botaoDoQr(canal);
    conectar.onclick = () => {
      const mudou = controles.some(([campo, controle]) =>
        campo.secreto ? controle.value.trim() || controle.dataset.limpar : controle.value.trim() !== controle.dataset.salvo.trim()
      );
      if (mudou) {
        avisar("Salve as credenciais (“Salvar e testar”) antes de conectar pelo QR Code.", true);
        salvar.focus();
        return;
      }
      abrirDialogoQr(canal.id, conectar);
    };
    acoes.append(conectar);
  }
  acoes.append(voltar);
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

/* ---------------------------------------- canais: WhatsApp pelo QR Code */
/* A sessão do WhatsApp fica num provedor online (Z-API ou Evolution API): o
   servidor pergunta a ele e devolve só o estado e a imagem do QR, nunca token
   nem API key. O diálogo confere o estado a cada ~3 s (?so_estado=1, sem gerar
   QR) e pede um QR novo a cada ~15 s: o WhatsApp troca o código a cada ~20 s e
   a Z-API pede de 10 a 20 s entre um pedido e outro. Depois de alguns códigos
   sem leitura ele para e oferece gerar outro (também recomendação da Z-API),
   em vez de ficar chamando o provedor com a janela esquecida aberta. */

const QR_INTERVALO_ESTADO = 3000;
const QR_INTERVALO_CODIGO = 15000;
const QR_MAXIMO_DE_CODIGOS = 4;

const dialogoQr = {
  elemento: null, // o <dialog> aberto (um por vez)
  canalId: null,
  origem: null, // o botão que abriu: o foco volta para ele
  timers: [],
  vez: 0, // cada ciclo novo invalida as respostas do anterior ainda no caminho
  codigos: 0, // QR Codes mostrados sem leitura
  webhookTentado: false,
};

function botaoDoQr(canal) {
  const botao = botaoPequeno("Conectar pelo QR Code", "botao pequeno conectar-qr");
  botao.setAttribute("aria-haspopup", "dialog");
  botao.onclick = () => abrirDialogoQr(canal.id, botao);
  return botao;
}

/* O webhook do provedor aponta para este IHchat (url_publica + /webhooks/{id}
   com o token do canal). Sem endereço absoluto, o cartão ensina o caminho à mão. */
function botoesDeWebhookQr(canal) {
  if (canal.tipo !== "whatsapp_qr" || !canal.configurado || !/^https?:\/\//i.test(canal.url_webhook || "")) return [];
  const conectado = Boolean(telaCanais.credenciais[canal.id]?.credenciais?.webhook_url);
  const botao = botaoDeTeste(conectado ? "Reconectar webhook" : "Conectar webhook", "botao discreto pequeno conectar-webhook", canal.id);
  botao.title = `O provedor passa a entregar as mensagens em ${canal.url_webhook}`;
  botao.onclick = () =>
    acaoDeWebhook(canal, "conectar-webhook", "Cadastrando o webhook no provedor…", "✓ Webhook conectado.", "✗ Não conectou.");
  return [botao];
}

/* Formulário do QR Code: só os campos do provedor escolhido, com os
   obrigatórios dele, e o provedor com um nome que diga o que é. */
function prepararCamposDoQr(controles, porChave) {
  const escolha = porChave.provedor;
  if (!escolha) return;
  for (const opcao of escolha.options) opcao.textContent = PROVEDORES_QR[opcao.value]?.rotulo || opcao.value;
  const mostrar = () => {
    const provedor = PROVEDORES_QR[escolha.value] || PROVEDORES_QR.zapi;
    for (const [campo, controle] of controles) {
      const caixa = controle.closest(".campo-canal");
      const deAlgum = Object.values(PROVEDORES_QR).some((p) => p.campos.includes(campo.chave));
      if (!caixa || !deAlgum) continue;
      caixa.hidden = !provedor.campos.includes(campo.chave);
      const etiqueta = caixa.querySelector("label");
      etiqueta.querySelector(".obrigatorio")?.remove();
      if (provedor.obrigatorios.includes(campo.chave)) etiqueta.append(criar("span", "obrigatorio", "obrigatório"));
    }
  };
  escolha.addEventListener("change", mostrar);
  mostrar();
}

function pararConsultasQr() {
  dialogoQr.timers.forEach(clearTimeout);
  dialogoQr.timers = [];
  dialogoQr.vez += 1;
}

function agendarQr(acao, espera) {
  dialogoQr.timers.push(setTimeout(acao, espera));
}

function fecharDialogoQr() {
  pararConsultasQr();
  if (dialogoQr.elemento?.open) dialogoQr.elemento.close(); // o "close" arruma o resto
}

function abrirDialogoQr(canalId, origem) {
  const canal = estado.canais.find((c) => c.id === canalId);
  if (!canal) return;
  fecharDialogoQr();
  dialogoQr.elemento?.remove();
  Object.assign(dialogoQr, { canalId, origem, codigos: 0, webhookTentado: false });

  const dialogo = criar("dialog", "dialogo-qr");
  dialogo.setAttribute("aria-labelledby", "qr-titulo");
  dialogo.setAttribute("aria-describedby", "qr-passos");
  const cabecalho = criar("div", "cabecalho-dialogo");
  const titulo = criar("h2", "", "Conectar o WhatsApp pelo QR Code");
  titulo.id = "qr-titulo";
  const fechar = criar("button", "icone-gaveta", "×");
  Object.assign(fechar, { type: "button", title: "Fechar" });
  fechar.setAttribute("aria-label", "Fechar");
  fechar.onclick = fecharDialogoQr;
  cabecalho.append(titulo, fechar);

  const provedor = provedorQrDe(telaCanais.credenciais[canal.id]?.credenciais);
  const quem = criar("p", "dica qr-canal", `Canal “${canal.nome}”, pela ${provedor.nome}.`);

  // região "status" que já existe antes de mudar: o leitor de tela anuncia cada troca
  const situacao = criar("div", "qr-situacao");
  situacao.setAttribute("role", "status");
  const selo = criar("span", "situacao andamento", "Consultando…");
  const frase = criar("span", "qr-frase", "Perguntando ao provedor como está a conexão…");
  situacao.append(selo, frase);

  const imagem = criar("div", "qr-imagem");
  const passos = criar("ol", "qr-passos");
  passos.id = "qr-passos";
  const passo = (...partes) => {
    const item = criar("li");
    item.append(...partes.map((parte) => (Array.isArray(parte) ? criar("strong", "", parte[0]) : parte)));
    return item;
  };
  passos.append(
    passo("Abra o ", ["WhatsApp"], " no celular do número que vai atender."),
    passo("Toque em ", ["⋮ Mais opções"], " (Android) ou ", ["Configurações"], " (iPhone) → ", ["Aparelhos conectados"], " → ", ["Conectar aparelho"], "."),
    passo("Aponte a câmera do celular para este QR Code e espere: esta janela avisa quando conectar.")
  );
  const corpo = criar("div", "qr-corpo");
  corpo.append(imagem, passos);

  const webhook = criar("p", "dica qr-webhook");
  webhook.setAttribute("role", "status");

  const acoes = criar("div", "acoes-canal qr-acoes");
  const confirmacao = criar("div", "confirmacao qr-confirmacao");
  confirmacao.hidden = true;

  dialogo.append(cabecalho, quem, situacao, corpo, webhook, acoes, confirmacao);
  // Esc fecha só o diálogo (a gaveta e a ficha atrás dele têm os próprios Esc)
  dialogo.addEventListener("keydown", (evento) => {
    if (evento.key !== "Escape") return;
    evento.preventDefault();
    evento.stopPropagation();
    if (!confirmacao.hidden) return cancelarDesconexao();
    fecharDialogoQr();
  });
  // outros pedidos de fechar (o "voltar" do Android) passam pelo mesmo caminho
  dialogo.addEventListener("cancel", (evento) => {
    evento.preventDefault();
    if (!confirmacao.hidden) cancelarDesconexao();
    else fecharDialogoQr();
  });
  dialogo.addEventListener("close", () => aoFecharDialogoQr(dialogo));
  // clique no fundo escuro (fora da caixa) também fecha
  dialogo.addEventListener("mousedown", (evento) => {
    if (evento.target === dialogo) fecharDialogoQr();
  });
  document.body.append(dialogo);
  dialogoQr.elemento = dialogo;
  dialogo.showModal();
  fechar.focus();
  cicloQr();
}

function aoFecharDialogoQr(dialogo) {
  pararConsultasQr();
  const canalId = dialogoQr.canalId;
  const origem = dialogoQr.origem;
  dialogo.remove();
  if (dialogoQr.elemento === dialogo) dialogoQr.elemento = null;
  if (origem?.isConnected) origem.focus();
  // o diálogo acabou de perguntar ao provedor: um "Testar conexão" de antes
  // (ex.: "falta ler o QR Code") não pode continuar pintando o cartão
  delete telaCanais.testes[canalId];
  delete telaCanais.resultados[canalId];
  refletirTeste(canalId);
  // o estado da conexão mudou no servidor: o cartão mostra o novo
  if (!gavetaCanais.hidden && estado.token) {
    recarregarCanais()
      .then(() => {
        if (!gavetaCanais.hidden && telaCanais.editando === null) redesenharCartao(canalId, ".conectar-qr");
      })
      .catch(() => null);
  }
}

/* Um QR Code novo (e a consulta de estado que o acompanha). */
function cicloQr() {
  pararConsultasQr();
  consultarQr(false, dialogoQr.vez);
}

async function consultarQr(soEstado, vez) {
  const canalId = dialogoQr.canalId;
  let resposta;
  try {
    resposta = await api("GET", `/api/canais/${canalId}/qr${soEstado ? "?so_estado=1" : ""}`);
  } catch (erro) {
    resposta = { status: "erro", qr: null, numero: null, mensagem: erro.message };
  }
  // fechado, ou já veio um ciclo mais novo: esta resposta não vale mais
  if (vez !== dialogoQr.vez || !dialogoQr.elemento?.open) return;

  if (resposta.status === "conectado") {
    pararConsultasQr();
    desenharQr(resposta);
    conectarWebhookDoQr();
    return;
  }
  if (resposta.status === "erro") {
    pararConsultasQr();
    desenharQr(resposta);
    return;
  }
  if (soEstado) {
    // ainda não leu: o QR na tela continua valendo
    agendarQr(() => consultarQr(true, vez), QR_INTERVALO_ESTADO);
    return;
  }
  desenharQr(resposta);
  conectarWebhookDoQr(); // a instância já existe no provedor
  if (resposta.status !== "aguardando_leitura") return; // desconectado: o botão pede um QR
  if (!resposta.qr) {
    // o provedor ainda está gerando o código: pergunta de novo logo
    agendarQr(cicloQr, QR_INTERVALO_ESTADO);
    return;
  }
  dialogoQr.codigos += 1;
  agendarQr(() => consultarQr(true, vez), QR_INTERVALO_ESTADO);
  agendarQr(() => {
    if (dialogoQr.codigos >= QR_MAXIMO_DE_CODIGOS) {
      pararConsultasQr();
      desenharQr({
        status: "expirado",
        qr: null,
        numero: null,
        mensagem: "O QR Code expirou sem ser lido. Gere outro quando estiver com o celular em mãos.",
      });
    } else {
      cicloQr();
    }
  }, QR_INTERVALO_CODIGO);
}

const SITUACOES_QR = {
  conectado: ["Conectado", "conectado"],
  aguardando_leitura: ["Aguardando leitura", "nao-testado"],
  desconectado: ["Desconectado", "desativado"],
  expirado: ["QR Code expirado", "desativado"],
  erro: ["Não conectou", "falhou"],
};

function desenharQr(resposta) {
  const dialogo = dialogoQr.elemento;
  if (!dialogo) return;
  const [rotulo, classe] = SITUACOES_QR[resposta.status] || SITUACOES_QR.erro;
  const selo = dialogo.querySelector(".qr-situacao .situacao");
  selo.className = `situacao ${classe}`;
  selo.textContent = rotulo;
  const frase =
    resposta.status === "conectado" && resposta.numero
      ? `WhatsApp conectado ao número ${numeroLegivel(resposta.numero)}. Já pode fechar esta janela.`
      : resposta.status === "conectado"
        ? "WhatsApp conectado. Já pode fechar esta janela."
        : resposta.mensagem || "";
  dialogo.querySelector(".qr-frase").textContent = frase;
  dialogo.classList.toggle("com-erro", resposta.status === "erro");
  dialogo.classList.toggle("sem-qr", resposta.status !== "aguardando_leitura");

  const imagem = dialogo.querySelector(".qr-imagem");
  const passos = dialogo.querySelector(".qr-passos");
  const aguardando = resposta.status === "aguardando_leitura";
  passos.hidden = !aguardando;
  imagem.hidden = resposta.status === "erro";
  if (aguardando && resposta.qr) {
    let foto = imagem.querySelector("img");
    if (!foto) {
      foto = criar("img");
      foto.alt = "QR Code para conectar o WhatsApp: leia com o celular";
      foto.width = 264;
      foto.height = 264;
      imagem.replaceChildren(foto);
    }
    // só "data:image/...": o servidor normaliza, e nada mais vira src aqui
    if (/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(resposta.qr)) foto.src = resposta.qr;
  } else if (aguardando) {
    imagem.replaceChildren(criar("span", "qr-marcador", "Gerando o QR Code…"));
  } else if (resposta.status === "conectado") {
    imagem.replaceChildren(criar("span", "qr-marcador qr-ok", "✓"));
  } else {
    const aviso = resposta.status === "expirado" ? "O QR Code expirou" : "Nenhum número conectado";
    imagem.replaceChildren(criar("span", "qr-marcador", aviso));
  }

  const acoes = dialogo.querySelector(".qr-acoes");
  const botoes = [];
  if (resposta.status === "conectado") {
    const desconectar = botaoPequeno("Desconectar este número", "botao discreto pequeno perigo-texto qr-desconectar");
    desconectar.onclick = pedirDesconexao;
    botoes.push(desconectar);
  } else if (resposta.status !== "aguardando_leitura") {
    const denovo = botaoPequeno(resposta.status === "erro" ? "Tentar de novo" : "Gerar QR Code", "botao pequeno qr-gerar");
    denovo.onclick = () => {
      dialogoQr.codigos = 0;
      desenharQr({ status: "aguardando_leitura", qr: null, numero: null, mensagem: "Pedindo um QR Code ao provedor…" });
      cicloQr();
    };
    botoes.push(denovo);
  }
  const fechar = botaoPequeno("Fechar", resposta.status === "conectado" ? "botao pequeno" : "botao discreto pequeno");
  fechar.onclick = fecharDialogoQr;
  botoes.push(fechar);
  const focado = acoes.contains(document.activeElement);
  acoes.replaceChildren(...botoes);
  acoes.hidden = !dialogo.querySelector(".qr-confirmacao").hidden;
  // o botão que tinha o foco sumiu: o foco não pode cair no fundo da página
  if (focado) botoes[0].focus();
}

function pedirDesconexao() {
  const dialogo = dialogoQr.elemento;
  const caixa = dialogo.querySelector(".qr-confirmacao");
  caixa.setAttribute("role", "group");
  caixa.setAttribute("aria-label", "Confirmar desconexão");
  const texto = criar(
    "p",
    "",
    "Desconectar este número do IHchat? As mensagens dos clientes param de chegar aqui até alguém ler um QR Code de novo. " +
      "O WhatsApp no celular continua funcionando normalmente."
  );
  const sim = botaoPequeno("Sim, desconectar", "botao perigo pequeno qr-confirmar");
  const nao = botaoPequeno("Cancelar", "botao discreto pequeno");
  nao.onclick = cancelarDesconexao;
  sim.onclick = async () => {
    sim.disabled = nao.disabled = true;
    sim.textContent = "Desconectando…";
    let resultado;
    try {
      resultado = await api("POST", `/api/canais/${dialogoQr.canalId}/desconectar`);
    } catch (erro) {
      resultado = { ok: false, mensagem: erro.message };
    }
    if (dialogoQr.elemento !== dialogo) return;
    caixa.hidden = true;
    caixa.replaceChildren();
    if (resultado.ok) {
      avisar("WhatsApp desconectado.");
      desenharQr({ status: "desconectado", qr: null, numero: null, mensagem: resultado.mensagem });
    } else {
      desenharQr({ status: "erro", qr: null, numero: null, mensagem: `Não desconectou: ${resultado.mensagem}` });
    }
    dialogo.querySelector(".qr-acoes button")?.focus();
  };
  const linha = criar("div", "acoes-canal");
  linha.append(sim, nao);
  caixa.replaceChildren(texto, linha);
  caixa.hidden = false;
  dialogo.querySelector(".qr-acoes").hidden = true;
  nao.focus();
}

function cancelarDesconexao() {
  const dialogo = dialogoQr.elemento;
  if (!dialogo) return;
  const caixa = dialogo.querySelector(".qr-confirmacao");
  caixa.hidden = true;
  caixa.replaceChildren();
  const acoes = dialogo.querySelector(".qr-acoes");
  acoes.hidden = false;
  acoes.querySelector(".qr-desconectar, button")?.focus();
}

/* Sem webhook cadastrado, o número conecta mas nenhuma mensagem chega. Com o
   endereço público configurado, o servidor cadastra sozinho (uma vez por
   abertura); sem ele, a linha explica o que falta. */
async function conectarWebhookDoQr() {
  const canal = estado.canais.find((c) => c.id === dialogoQr.canalId);
  const dados = telaCanais.credenciais[dialogoQr.canalId];
  const linha = dialogoQr.elemento?.querySelector(".qr-webhook");
  if (!canal || !linha || dialogoQr.webhookTentado || dados?.credenciais?.webhook_url) return;
  dialogoQr.webhookTentado = true;
  if (!/^https?:\/\//i.test(canal.url_webhook || "")) {
    linha.textContent =
      "Atenção: este IHchat ainda não tem endereço público (url_publica), então o provedor não tem para onde mandar " +
      "as mensagens. Configure-o, ou cadastre no provedor a URL do webhook mostrada no cartão do canal.";
    return;
  }
  linha.textContent = "Cadastrando o webhook no provedor, para as mensagens chegarem aqui…";
  let resultado;
  try {
    resultado = await api("POST", `/api/canais/${canal.id}/conectar-webhook`);
  } catch (erro) {
    resultado = { ok: false, mensagem: erro.message };
  }
  if (!dialogoQr.elemento?.contains(linha)) return;
  linha.textContent = resultado.ok
    ? "✓ Webhook conectado: as mensagens dos clientes vão chegar ao IHchat."
    : `⚠ O webhook não foi cadastrado: ${resultado.mensagem}. Tente “Conectar webhook” no cartão do canal.`;
}

/* ------------------------------------------------------------------ datas */
const HORA = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const DATA_HORA = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const DIA = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long" });

/* Os dois servidores mandam as datas em UTC COM fuso ("...Z" ou "+00:00"),
   e o navegador mostra no horário local. O "Z" acrescentado aqui é defesa
   para uma data sem fuso: lida como local, ficaria três horas deslocada. */
function data(valor) {
  if (valor instanceof Date) return valor;
  const texto = String(valor || "");
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(texto) ? texto : `${texto}Z`);
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

function quando(valor) {
  const alvo = data(valor);
  const minutos = Math.round((Date.now() - alvo.getTime()) / 60000);
  if (minutos < 1) return "agora";
  if (minutos < 60) return `${minutos} min`;
  if (alvo.toDateString() === new Date().toDateString()) return hora(valor);
  if (minutos < 60 * 24 * 7) return `${Math.floor(minutos / 1440)} d`;
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(alvo);
}

function duracao(segundos) {
  if (segundos < 60) return `${Math.round(segundos)}s`;
  if (segundos < 3600) return `${Math.round(segundos / 60)}min`;
  return `${(segundos / 3600).toFixed(1)}h`;
}

/* ---------------------------------------------------------------- equipe */
/* Só o administrador: quem atende, com que papel e setor, e quem saiu (fica
   desativado, não apagado: o histórico continua dizendo quem respondeu). Sem
   esta tela o dono chamaria a API na mão — e na hospedagem não há /docs. As
   regras são as de /api/atendentes, iguais nos dois servidores. */
const gavetaEquipe = $("#equipe");
const corpoEquipe = $("#corpo-equipe");
const telaEquipe = { editando: null, criando: false, focoAnterior: null };
const PAPEIS = { atendente: "Atendente", admin: "Administrador" };
// o bcrypt guarda só os 72 primeiros bytes da senha (a API recusa acima disso)
const SENHA_MAX_BYTES = 72;

$("#abrir-equipe").addEventListener("click", abrirEquipe);
$("#equipe-fechar").addEventListener("click", fecharEquipe);
$("#equipe-novo").addEventListener("click", () => {
  Object.assign(telaEquipe, { criando: true, editando: null });
  desenharEquipe();
  corpoEquipe.querySelector("form input")?.focus();
});
gavetaEquipe.addEventListener("mousedown", (evento) => {
  if (evento.target === gavetaEquipe) fecharEquipe();
});
document.addEventListener("keydown", (evento) => {
  if (gavetaEquipe.hidden) return;
  if (evento.key === "Escape") {
    evento.preventDefault();
    fecharEquipe();
  } else if (evento.key === "Tab") {
    prenderFoco(evento, gavetaEquipe);
  }
});

async function abrirEquipe() {
  telaEquipe.focoAnterior = document.activeElement;
  Object.assign(telaEquipe, { editando: null, criando: false });
  gavetaEquipe.hidden = false;
  corpoEquipe.replaceChildren(criar("p", "dica", "Carregando a equipe…"));
  // mesmo motivo do "Novo canal": clicado antes de a lista chegar, o
  // formulário seria redesenhado por cima do que a pessoa já digitou
  const novo = $("#equipe-novo");
  novo.disabled = true;
  try {
    estado.atendentes = await api("GET", "/api/atendentes");
    desenharEquipe();
  } catch (erro) {
    corpoEquipe.replaceChildren(criar("p", "erro", `Não foi possível carregar a equipe: ${erro.message}`));
  } finally {
    novo.disabled = false;
    if (!gavetaEquipe.hidden && !gavetaEquipe.contains(document.activeElement)) novo.focus();
  }
}

function fecharEquipe() {
  if (gavetaEquipe.hidden) return;
  gavetaEquipe.hidden = true;
  corpoEquipe.replaceChildren();
  telaEquipe.focoAnterior?.focus?.();
}

function desenharEquipe() {
  const itens = [];
  if (telaEquipe.criando) itens.push(formularioAtendente(null));
  for (const pessoa of estado.atendentes) {
    itens.push(telaEquipe.editando === pessoa.id ? formularioAtendente(pessoa) : cartaoDoAtendente(pessoa));
  }
  corpoEquipe.replaceChildren(...itens);
}

function cartaoDoAtendente(pessoa) {
  const eu = pessoa.id === estado.atendente?.id;
  const cartao = criar("article", `cartao-canal cartao-atendente${pessoa.ativo ? "" : " inativo"}`);
  cartao.dataset.atendente = pessoa.id;
  const titulo = criar("h3", "", pessoa.nome);
  titulo.id = `atendente-${pessoa.id}-nome`;
  cartao.setAttribute("aria-labelledby", titulo.id);

  const [rotulo, classe] = !pessoa.ativo
    ? ["Desativado", "desativado"]
    : pessoa.disponivel
      ? ["Disponível", "conectado"]
      : ["Fora da distribuição", "sandbox"];
  const topo = criar("div", "linha");
  topo.append(titulo, criar("span", "selo", PAPEIS[pessoa.papel] || pessoa.papel));
  if (eu) topo.append(criar("span", "selo", "você"));
  topo.append(criar("span", `situacao ${classe}`, rotulo));
  cartao.append(topo, criar("p", "dica explicacao", pessoa.email));
  cartao.append(criar("p", "dica", `O cliente vê: ${linhaAssinatura(pessoa)}`));

  const acoes = criar("div", "acoes-canal");
  const editar = botaoPequeno("Editar", "botao discreto pequeno editar");
  editar.onclick = () => {
    Object.assign(telaEquipe, { editando: pessoa.id, criando: false });
    desenharEquipe();
    corpoEquipe.querySelector(`form[data-atendente="${pessoa.id}"] input`)?.focus();
  };
  acoes.append(editar);
  if (!eu) {
    // desativar a si mesmo trancaria o administrador do lado de fora
    const alternar = botaoPequeno(pessoa.ativo ? "Desativar" : "Reativar", "botao discreto pequeno alternar");
    alternar.onclick = () => alternarAtendente(pessoa, alternar);
    acoes.append(alternar);
  }
  // cada botão diz a quem pertence, para quem usa leitor de tela
  acoes.querySelectorAll("button").forEach((botao) => botao.setAttribute("aria-describedby", titulo.id));
  cartao.append(acoes);
  return cartao;
}

async function alternarAtendente(pessoa, botao) {
  botao.disabled = true;
  try {
    const atualizado = await api("PATCH", `/api/atendentes/${pessoa.id}`, { ativo: !pessoa.ativo });
    guardarAtendente(atualizado);
    avisar(atualizado.ativo ? `${atualizado.nome} pode entrar de novo.` : `${atualizado.nome} não entra mais; o histórico fica.`);
    desenharEquipe();
    corpoEquipe.querySelector(`[data-atendente="${pessoa.id}"] .alternar`)?.focus();
  } catch (erro) {
    avisar(erro.message, true);
    botao.disabled = false;
  }
}

/* A lista de atendentes também alimenta o seletor da conversa aberta e, se
   for o próprio perfil, o "Atendendo como" do topo. */
function guardarAtendente(atualizado) {
  const posicao = estado.atendentes.findIndex((pessoa) => pessoa.id === atualizado.id);
  if (posicao >= 0) estado.atendentes[posicao] = atualizado;
  else estado.atendentes.push(atualizado);
  estado.atendentes.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  if (atualizado.id === estado.atendente?.id) {
    estado.atendente = atualizado;
    desenharPerfil();
  }
  if (estado.detalhe) desenharConversa();
}

/* Conferido aqui, em português, antes de ir à API (a validação do servidor
   continua valendo; a do Python responderia em inglês). */
function problemaDaSenha(senha, obrigatoria) {
  if (!senha) return obrigatoria ? "Defina uma senha." : null;
  if (senha.length < 6) return "A senha precisa ter pelo menos 6 caracteres.";
  if (new TextEncoder().encode(senha).length > SENHA_MAX_BYTES) {
    return `A senha pode ter no máximo ${SENHA_MAX_BYTES} bytes (letra com acento conta 2).`;
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(senha)) return "A senha não pode ter tabulação nem quebra de linha.";
  return null;
}

function formularioAtendente(pessoa) {
  const novo = pessoa === null;
  const eu = !novo && pessoa.id === estado.atendente?.id;
  const form = criar("form", "cartao-canal form-atendente");
  form.noValidate = true;
  form.setAttribute("aria-label", novo ? "Novo atendente" : `Editar ${pessoa.nome}`);
  if (!novo) form.dataset.atendente = pessoa.id;
  form.append(criar("h3", "", novo ? "Novo atendente" : pessoa.nome));

  const nome = campoDeNome(pessoa?.nome || "");
  nome.name = "nome";
  const email = criar("input");
  Object.assign(email, { name: "email", type: "email", value: pessoa?.email || "", maxLength: 160, autocomplete: "off" });
  // o e-mail é o login: a API não o troca depois do cadastro
  email.readOnly = !novo;
  email.addEventListener("input", () => email.setCustomValidity(""));
  const senha = criar("input");
  Object.assign(senha, { name: "senha", type: "password", autocomplete: "new-password" });
  if (!novo) senha.placeholder = "em branco = mantém a atual";
  const papel = criar("select");
  papel.name = "papel";
  for (const [valor, rotulo] of Object.entries(PAPEIS)) papel.append(new Option(rotulo, valor));
  papel.value = pessoa?.papel || "atendente";
  // tirar de si mesmo o papel de administrador fecharia esta tela para sempre
  papel.disabled = eu;
  const setor = criar("input");
  Object.assign(setor, { name: "setor", value: pessoa?.setor || "", maxLength: 60, autocomplete: "off", placeholder: "Ex.: Suporte técnico" });
  setor.setAttribute("list", "setores-sugeridos");

  form.append(
    campoRotulado("Nome", nome, "Vai em cada resposta ao cliente", true),
    campoRotulado("E-mail", email, novo ? "É o login" : "É o login; não muda", novo),
    campoRotulado("Senha", senha, novo ? "Pelo menos 6 caracteres" : "Só para trocar a senha", novo),
    campoRotulado("Papel", papel, eu ? "Você não muda o próprio papel" : "Administrador cuida dos canais e da equipe"),
    campoRotulado("Setor", setor, "Aparece ao lado do nome; em branco, só o nome"),
  );
  const previa = criar("p", "dica previa-equipe");
  const atualizarPrevia = () => {
    previa.textContent = `O cliente verá: ${linhaAssinatura({ nome: nome.value.trim() || "…", setor: setor.value.trim() })}`;
  };
  nome.addEventListener("input", atualizarPrevia);
  setor.addEventListener("input", atualizarPrevia);
  atualizarPrevia();

  const erro = criar("p", "erro");
  erro.setAttribute("role", "alert");
  const salvar = criar("button", "botao pequeno", novo ? "Cadastrar" : "Salvar");
  salvar.type = "submit";
  const cancelar = botaoPequeno("Cancelar", "botao discreto pequeno");
  cancelar.onclick = () => {
    Object.assign(telaEquipe, { criando: false, editando: null });
    desenharEquipe();
    (novo ? $("#equipe-novo") : corpoEquipe.querySelector(`[data-atendente="${pessoa.id}"] .editar`))?.focus();
  };
  const acoes = criar("div", "acoes-canal");
  acoes.append(salvar, cancelar);
  form.append(previa, erro, acoes);

  form.onsubmit = async (evento) => {
    evento.preventDefault();
    erro.textContent = "";
    const nomeLimpo = nomeValido(nome);
    if (nomeLimpo === null) return;
    if (novo) {
      email.setCustomValidity(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim()) ? "" : "Informe um e-mail válido.");
      if (!email.reportValidity()) return;
    }
    const problema = problemaDaSenha(senha.value, novo);
    if (problema) {
      erro.textContent = problema;
      senha.focus();
      return;
    }
    const corpo = { nome: nomeLimpo, setor: setor.value.trim() || null };
    if (!eu) corpo.papel = papel.value;
    if (novo) corpo.email = email.value.trim();
    if (senha.value) corpo.senha = senha.value;
    salvar.disabled = true;
    try {
      const salvo = novo
        ? await api("POST", "/api/atendentes", corpo)
        : await api("PATCH", `/api/atendentes/${pessoa.id}`, corpo);
      guardarAtendente(salvo);
      Object.assign(telaEquipe, { criando: false, editando: null });
      avisar(novo ? `${salvo.nome} cadastrado. Passe a ele o e-mail e a senha.` : "Alterações salvas.");
      desenharEquipe();
      corpoEquipe.querySelector(`[data-atendente="${salvo.id}"] .editar`)?.focus();
    } catch (falha) {
      erro.textContent = falha.message;
      salvar.disabled = false;
    }
  };
  return form;
}

/* ------------------------------------------------------------------ boot */
if (estado.token) {
  iniciar().catch(sair);
} else {
  $("#tela-login").hidden = false;
}
