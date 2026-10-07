# PLANO — rodada de polimento antes do contrato

Cada passo só fecha quando estiver perfeito na tela (celular primeiro, depois computador) e 100% funcional:
conferido em prints, nas suítes (`scripts/celulares.mjs`, `scripts/revisao.mjs`, `scripts/conferir-mensagem.mjs`),
por um revisor independente e no ar.

## F0 · Sem "prévia" — feito
- [x] Selo PRÉVIA do celular, painel da prévia (pendências e troca de home) e bloco da lateral saem.
- [x] Textos "na prévia" viram "por enquanto"; rodapé assina "Desenvolvido por I&H Soluções Digitais".
- [x] Dados de exemplo continuam (`dadosDeExemplo`), sem carimbo (`carimboDeExemplo: false`): horário de exemplo não aparece, taxa de exemplo vira "a confirmar".
- [x] `noindex` continua (`indexar: false`) até o catálogo ter só dados reais.

## F1 · Início
- [ ] Uma home só (sai Home 1/Home 2, `?home`, balão, rosto do mercador na barra, passo do mercador no story); `/home2/` continua abrindo a home.
- [ ] Celular: story → faixa → perfil (igual) → destaques → grade do catálogo → rodapé dos @.
- [ ] Destaques do Início: abas primeiro (destaque do estado, Buscar, Teste minha sorte, Por estado), separador, filtros à direita (Tudo, Importadas, Destilados, Sedas, Piteiras, Acessórios) filtrando a grade no lugar.
- [ ] Início termina na grade, sem o mercador e sem o Teste minha sorte; aba Catálogo e busca como estão.
- [ ] Computador: [mercador natural | perfil | story], sem o adesivo do Teste minha sorte; mesmo catálogo embaixo.
- [ ] "Ver loja" rola até os destaques; desempenho igual ao de antes.

## F2 · Sacola vazia
- [ ] Mercador segurando a garrafa no lugar do bonequinho; resto igual.

## F3 · Prêmio do Teste minha sorte
- [ ] Cartão com o prêmio em destaque, uma linha de apoio e o código; condições em "Ver condições".
- [ ] Comemoração curta na revelação.
- [ ] (Depois) redesenhar o formato do prêmio, sem o papel que desenrola.

## F4 · Pedido
- [ ] WhatsApp da loja (33) 99113-9036 para todos os estados, só no fechamento do pedido completo (e da encomenda).
- [ ] "Pagar com Pix aqui no site" com selo EM BREVE, que devolve para o WhatsApp.
- [ ] Dúvidas e "Avisar quando chegar" vão para o Instagram do estado.

## F5 · Revisão, suítes e publicação
- [ ] Revisão independente por frente, contraprova, correções.
- [ ] Suítes completas, conferência no ar, prints para o cliente.

## F6 · Depois do front: painel do dono (backend)
- [ ] Login do dono; produtos, preços, fotos e estoque por estado.
- [ ] Prêmios e regras do Teste minha sorte; contas de cliente e cupons validados no servidor.
- [ ] Pedidos recebidos e Pix direto no site.
