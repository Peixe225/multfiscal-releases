# PLANO — rodada de polimento antes do contrato

Cada passo só fecha quando estiver perfeito na tela (celular primeiro, depois computador) e 100% funcional:
conferido em prints, nas suítes (`scripts/celulares.mjs`, `scripts/revisao.mjs`, `scripts/conferir-mensagem.mjs`),
por um revisor independente e no ar.

## F0 · Sem "prévia" — feito
- [x] Selo PRÉVIA do celular, painel da prévia (pendências e troca de home) e bloco da lateral saem.
- [x] Textos "na prévia" viram "por enquanto"; rodapé assina "Desenvolvido por I&H Soluções Digitais".
- [x] Dados de exemplo continuam (`dadosDeExemplo`), sem carimbo (`carimboDeExemplo: false`): horário de exemplo não aparece, taxa de exemplo vira "a confirmar".
- [x] `noindex` continua (`indexar: false`) até o catálogo ter só dados reais.

## F1 · Início — feito
- [x] Uma home só (sai Home 1/Home 2, `?home`, balão, rosto do mercador na barra, passo do mercador no story); `/home2/` continua abrindo a home.
- [x] Celular: story → faixa → perfil (igual) → destaques → grade do catálogo → rodapé dos @.
- [x] Destaques do Início: abas primeiro (destaque do estado, Buscar, Teste minha sorte, Por estado), separador, filtros à direita (Tudo, Importadas, Destilados, Sedas, Piteiras, Acessórios) filtrando a grade no lugar.
- [x] Início termina na grade, sem o mercador e sem o Teste minha sorte; aba Catálogo e busca como estão.
- [x] Computador: [mercador natural | perfil | story], sem o adesivo do Teste minha sorte; mesmo catálogo embaixo.
- [x] "Ver loja" rola até os destaques; desempenho igual ao de antes.

## F2 · Sacola vazia — feito
- [x] Mercador segurando a garrafa no lugar do bonequinho; resto igual.

## F3 · Prêmio do Teste minha sorte — feito
- [x] Cartão com o prêmio em destaque, uma linha de apoio e o código; condições em "Ver condições".
- [x] Comemoração curta na revelação.
- [x] Formato do prêmio redesenhado (ver F7).

## F4 · Pedido — feito
- [x] WhatsApp da loja (33) 99113-9036 para todos os estados, só no fechamento do pedido completo (e da encomenda).
- [x] "Pagar com Pix aqui no site" com selo EM BREVE, que devolve para o WhatsApp.
- [x] Dúvidas e "Avisar quando chegar" vão para o Instagram do estado.

## F5 · Revisão, suítes e publicação — feito
- [x] Revisão independente por frente, contraprova, correções.
- [x] Suítes completas, conferência no ar, prints para o cliente.

## F7 · Prêmio novo: story dos Melhores amigos — feito
- [x] Sai o beck que desenrola: a tampa sai, a câmera mergulha na câmara do dichavador e o preto de dentro vira um story só pra pessoa.
- [x] Story com anel e selo verde dos Melhores amigos, produto flutuando, destaque grande, adesivo do código (trancado até guardar) e adesivo de contagem da validade.
- [x] Cupons da Minha conta e da sacola na mesma linguagem; textos sem "beck".

## F8 · Servidor (PHP + SQLite) e painel do dono — base — feito
- [x] API em `public/api/` com banco SQLite protegido, sessão do dono, CSRF, limite de tentativas, envio de imagem e diagnóstico (contrato em `API.md`).
- [x] Primeiro acesso com código de instalação; entrar, sair, trocar senha.
- [x] Painel em `/painel/` (celular primeiro), fora do site público e sem indexar.
- [x] Ambiente de desenvolvimento (`npm run api`) e publicação que nunca sobe banco nem envios.

## F9 · Rateio — feito
- [x] Site: aba Rateio (barra, lateral, destaque do Início), cartões com contador "8/10", preço no rateio × quando chegar, previsão de 6 a 10 dias, "?" com o como funciona.
- [x] Entrar com nome e WhatsApp → vaga reservada com código → fechar no WhatsApp da loja; Pix no site "Em breve"; "Minhas vagas" com o status.
- [x] Painel: criar rateio, participantes, confirmar pagamento (o contador sobe), mensagens prontas no WhatsApp, avançar status (fechado, pedido feito, a caminho, chegou).
- [x] Webhook do Pix preparado: quando o Pix existir, o contador sobe sozinho.
- [x] Sem servidor (zip, desenvolvimento): o rateio continua funcionando pelo WhatsApp.

## F10 · Painel: a loja inteira no controle do dono — feito
- [x] Produtos: foto (thumbnail), nome, descrição, preço, combos, variações, disponível/indisponível por estado e "restam X unidades".
- [x] Stories do Início: quais produtos passam e em que ordem (e a rua do mercador no fim do Início do celular, liga e desliga).
- [x] Estados: WhatsApp por estado (ou um só pra todos), Instagram, cidades, horários de entrega, taxa, entrega grátis em um ou mais dias, formas de pagamento; estado novo ativado pelo painel.
- [x] Pedido guiado: as falas de cada passo editáveis (Textos do pedido); prêmios e regras do Teste minha sorte (valem também no giro do servidor); textos da loja e as falas do mercador.
- [x] O site lê tudo do servidor, com o que está embutido de reserva (nunca fica em branco).

## F11 · Início vivo e Mercado — feito
- [x] Início: o mercador anda pela rua, bebe (refrigerante importado: álcool e tabaco fora da animação) e vende para 4 personagens bem diferentes, cada um com uma interação própria com ele — celular e computador.
- [x] Aba Catálogo vira "Mercado", com o mercador e a animação que ele já tem.
- [x] Celular: a rua do mercador no fim do Início, depois da grade e antes do rodapé (pedido do Ian em 09/10); o topo volta a ser o de 08/10 (o 1º story é de produto, faixa e perfil logo depois) e a rua só baixa quando chega perto da tela.

## F12 · Pedido completo no WhatsApp da Green Cheese — feito (falta o gateway da loja)
- [x] Ao fechar, o pedido fica salvo no servidor (com o código GC-XXXXX na mensagem) e o aviso sai completo e formatado pro grupo privado do WhatsApp por um gateway (Z-API, Evolution API ou webhook), configurado em Avisos no WhatsApp, com envio de teste e reenvio.
- [x] Painel: pedidos recebidos com status, mensagens prontas de cada passo e os dados apagáveis depois de entregue.
- [ ] A loja escolher o gateway, ter o chip de envio, criar o grupo e tocar em "Enviar teste" (PENDENCIAS, "Pedidos e avisos no WhatsApp").

## F13 · Contas: cliente e equipe — feito
- [x] Equipe: dono, gerente por estado e atendente (papéis e estados permitidos), cada um com seu login e a senha provisória trocada no 1º acesso.
- [x] Cliente: entrar com WhatsApp + código enviado pelo WhatsApp da loja (pelo gateway); Minha conta com endereços, pedidos, cupons, giros e vagas de rateio validados no servidor.
- [ ] Tela de estoque do gerente (o disponível e o estoque dos estados dele; o servidor já deixa).

## F14 · Pix direto no site
- [ ] QR dinâmico e confirmação automática (pedido e rateio), quando a loja escolher o provedor.

## Publicação
- [ ] Publicar F7–F13 no ar (pede o ok do Ian) e criar o acesso do dono com o código de instalação.
