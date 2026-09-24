/* IHchat - tempo real para o painel e o simulador.

   O mesmo front conversa com dois servidores:
   - o app Python segura a conexão aberta (Server-Sent Events): /saude diz
     {"eventos": "stream"} e aqui se usa EventSource;
   - o PHP da hospedagem compartilhada não segura conexão longa: /saude diz
     {"eventos": "consulta"} e aqui se pergunta a cada 2 s "o que há depois
     do id N" em /api/eventos/desde.

   Nos dois casos cada evento tem um id crescente, e o módulo guarda o último
   visto (o cursor). Caiu a conexão, a próxima começa dali: nada se perde e
   nada se repete (id já visto é descartado). Com a aba oculta, a consulta
   fica mais espaçada (ou para, se quem usa pedir), e volta na hora ao reabrir.

     const eventos = IHchatEventos.criar({
       stream: (depois) => `/api/eventos/stream?token=...&depois=${depois}`,
       desde: (depois) => `/api/eventos/desde?token=...&depois=${depois}`,
       tipos: ["mensagem.nova", "conversa.atualizada"],
       aoEvento: (tipo, dados, id) => {...},
       aoEstado: (estado) => {...},   // "conectando" | "ao-vivo" | "reconectando" | "desconectado"
       aoRecusar: () => {...},        // 401: sessão vencida; o módulo para
     });
     await eventos.preparar();   // pega o cursor ANTES de carregar as listas
     eventos.iniciar();          // começa a entregar o que veio depois dele
     eventos.fechar();

   O widget (embutido em sites de terceiros) tem uma cópia enxuta desta
   lógica dentro dele: precisa ser um arquivo só. */
(function (global) {
  "use strict";

  const INTERVALO = 2000;
  const LIMITE = 200; // o mesmo padrão do servidor: veio cheio, pergunta de novo na hora
  const ESPERA_MAXIMA = 30000;

  const modos = new Map(); // origem -> Promise<"stream" | "consulta">

  /** Pergunta ao servidor como ele entrega eventos (uma vez por origem). */
  function modo(base = "") {
    if (!modos.has(base)) {
      const pedido = fetch(`${base}/saude`, { cache: "no-store" })
        .then((resposta) => (resposta.ok ? resposta.json() : Promise.reject(new Error(String(resposta.status)))))
        .then((dados) => (dados.eventos === "stream" && "EventSource" in global ? "stream" : "consulta"))
        .catch(() => {
          // sem resposta, a consulta é o caminho que funciona nos dois
          // servidores; a próxima tela pergunta de novo
          modos.delete(base);
          return "consulta";
        });
      modos.set(base, pedido);
    }
    return modos.get(base);
  }

  class ErroDeEventos extends Error {
    constructor(mensagem, situacao) {
      super(mensagem);
      this.situacao = situacao;
    }
  }

  async function pedirJson(url) {
    const resposta = await fetch(url, { cache: "no-store" });
    if (!resposta.ok) throw new ErroDeEventos(`eventos: ${resposta.status}`, resposta.status);
    return resposta.json();
  }

  function criar(opcoes) {
    const cfg = {
      base: "",
      tipos: [],
      intervalo: INTERVALO,
      // aba oculta: null para parar de todo; um número para espaçar
      intervaloOculto: 15000,
      aoEvento: () => {},
      aoEstado: () => {},
      aoRecusar: () => {},
      ...opcoes,
    };
    let cursor = null; // id do último evento entregue (null = ainda não sei)
    let forma = null; // "stream" | "consulta"
    let fonte = null;
    let temporizador = null;
    let falhas = 0;
    let ativo = false;
    let estado = null;
    let pedindo = false;

    function mudar(novo) {
      if (novo === estado) return;
      estado = novo;
      try { cfg.aoEstado(novo); } catch (erro) { console.error(erro); }
    }

    function entregar(id, tipo, dados) {
      if (cursor !== null && id <= cursor) return; // já visto (reconexão, lote repetido)
      cursor = id;
      try { cfg.aoEvento(tipo, dados, id); } catch (erro) { console.error("evento não tratado", tipo, erro); }
    }

    function espera() {
      // 2 s, 4 s, 8 s... até 30 s: servidor fora do ar não é martelado
      return Math.min(ESPERA_MAXIMA, cfg.intervalo * 2 ** Math.min(falhas, 4));
    }

    function recusado() {
      fechar();
      mudar("desconectado");
      cfg.aoRecusar();
    }

    /** Descobre o cursor atual ("começar de agora"). */
    async function preparar() {
      forma = forma || (await modo(cfg.base));
      if (cursor !== null) return cursor;
      try {
        const dados = await pedirJson(cfg.desde(null));
        cursor = Number(dados.ultimo) || 0;
      } catch (erro) {
        if (erro.situacao === 401) {
          recusado();
          throw erro;
        }
        // sem cursor agora: o fluxo começa "de agora" quando conectar
      }
      return cursor;
    }

    async function iniciar() {
      if (ativo) return;
      ativo = true;
      forma = forma || (await modo(cfg.base));
      if (!ativo) return; // fechado enquanto perguntava ao /saude
      mudar("conectando");
      if (forma === "stream") abrirFluxo();
      else consultar();
    }

    // ------------------------------------------------------------- stream
    function abrirFluxo() {
      if (!ativo) return;
      if (fonte) fonte.close();
      const atual = new EventSource(cfg.stream(cursor));
      fonte = atual;
      atual.onopen = () => {
        falhas = 0;
        mudar("ao-vivo");
      };
      const receber = (evento) => {
        const id = Number(evento.lastEventId);
        let dados = null;
        try { dados = JSON.parse(evento.data); } catch { return; }
        if (Number.isFinite(id) && id > 0) entregar(id, evento.type, dados);
        else {
          // servidor antigo, sem id: entrega mesmo assim (sem como deduplicar)
          try { cfg.aoEvento(evento.type, dados, null); } catch (erro) { console.error(erro); }
        }
      };
      for (const tipo of cfg.tipos) atual.addEventListener(tipo, receber);
      atual.onerror = () => {
        if (fonte !== atual) return;
        if (atual.readyState === EventSource.CONNECTING) {
          // o navegador reconecta sozinho, mandando Last-Event-ID
          mudar("reconectando");
          return;
        }
        // fechado de vez (resposta não-200): 401 é sessão vencida; o resto,
        // tenta de novo a partir do cursor
        atual.close();
        fonte = null;
        mudar("desconectado");
        falhas += 1;
        conferirEDepois(abrirFluxo);
      };
    }

    async function conferirEDepois(acao) {
      try {
        await pedirJson(cfg.desde(null)); // só confere a sessão: o fluxo reabre do cursor
      } catch (erro) {
        if (erro.situacao === 401) return recusado();
      }
      if (!ativo) return;
      clearTimeout(temporizador);
      temporizador = setTimeout(acao, espera());
    }

    // ----------------------------------------------------------- consulta
    async function consultar() {
      clearTimeout(temporizador);
      temporizador = null;
      if (!ativo || pedindo) return;
      if (document.hidden && cfg.intervaloOculto === null) return; // volta no visibilitychange
      pedindo = true;
      let dados = null;
      let pedido = null;
      try {
        if (cursor === null) await preparar();
        pedido = cursor;
        dados = await pedirJson(cfg.desde(pedido));
        falhas = 0;
        mudar("ao-vivo");
      } catch (erro) {
        pedindo = false;
        if (erro.situacao === 401) return recusado();
        falhas += 1;
        mudar("reconectando");
        if (ativo) temporizador = setTimeout(consultar, espera());
        return;
      }
      pedindo = false;
      if (!ativo) return;
      for (const evento of dados.eventos || []) entregar(Number(evento.id), evento.tipo, evento.dados);
      // o cursor anda mesmo quando o filtro do servidor não devolveu nada
      const ultimo = Number(dados.ultimo);
      if (Number.isFinite(ultimo) && (cursor === null || ultimo > cursor)) cursor = ultimo;
      // veio cheio: o servidor leu LIMITE ids (o filtro dele pode ter devolvido
      // menos, como no widget). ultimo - depois >= LIMITE só erra para mais
      // (lacuna de id), e aí custa uma consulta extra, não um atraso
      const cheio =
        (dados.eventos || []).length >= LIMITE || (pedido !== null && Number.isFinite(ultimo) && ultimo - pedido >= LIMITE);
      const pausa = cheio ? 0 : document.hidden ? cfg.intervaloOculto : cfg.intervalo;
      temporizador = setTimeout(consultar, pausa);
    }

    function aoMudarVisibilidade() {
      if (!ativo || forma !== "consulta" || document.hidden) return;
      consultar(); // voltou à aba: busca na hora o que chegou
    }
    document.addEventListener("visibilitychange", aoMudarVisibilidade);

    function fechar() {
      ativo = false;
      clearTimeout(temporizador);
      temporizador = null;
      if (fonte) fonte.close();
      fonte = null;
    }

    function destruir() {
      fechar();
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
    }

    return {
      preparar,
      iniciar,
      fechar: destruir,
      /** Pede já (depois de enviar algo, por exemplo); no stream não precisa. */
      agora: () => forma === "consulta" && ativo && consultar(),
      get cursor() { return cursor; },
      get forma() { return forma; },
    };
  }

  global.IHchatEventos = { criar, modo };
})(window);
