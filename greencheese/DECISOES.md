# DECISÕES

1. **Conceito**: o site é o Instagram da Green Cheese funcionando como loja — hero = story rodando com os disponíveis do estado; card = story em miniatura; produto = story em tela cheia; adesivo de localização = seletor de estado; destaques = categorias; "Enviar mensagem…" = pedido; DM = chat guiado.
2. **Paleta**: #000 (Preto Story), #262626, #636363, #A8A8A8, #FFF. Interface sem cor; a cor vem do produto (halo pontilhado). Verde só no ✅ — o halo de produto verde ou roxo vira cinza por trava de matiz.
3. **Tipografia**: Pixelify Sans para o que a marca "posta" (nome, preço, DISPONÍVEL, @); system-ui para o que o app desenharia. Pixelify só nos pesos 400 (16 px) e 500 — no 700 o "C" fecha e "COCA" vira "OOOA". Silkscreen (larga, til desalinhado) e Jersey 15 (sem "Nº") testadas e descartadas.
4. **Artes em código**: os prints não vieram; produtos desenhados em canvas e tratados em dither Bayer (a foto entra no mesmo tratamento via `npm run recortar`); logo redesenhado em SVG; ícones, emblemas e cliente em pixel art (grade de texto → SVG `crispEdges`).
5. **Motion em duas vozes**: "pixel" (`steps()`, decorativo) e "app" (liso, funcional). Três momentos: abertura em 3 quadros (logo montado em pixels, tesoura recorta o adesivo de enquete do +18, adesivo de local cola e voa pro topo); card → story; revelação do chiado ao entrar na tela / ao trocar de estado. Só transform/opacity; reduced-motion = cortes secos.
6. **Folhas** pretas com canto em degrau de pixel; fundo atrás em screen-door (sem blur/vidro).
7. **Estado**: URL > escolha salva > IP (ipwho.is e geojs em paralelo, 2,5 s, sempre pergunta "É daí?"; IP de estado sem atendimento só avisa) > seletor. Trocar de estado com sacola cheia pede confirmação.
8. **Pedido**: mensagem exatamente no formato do briefing; `<a href>` montado antes do toque (sem `target` no celular); sem número cadastrado → `wa.me/?text=` + "Copiar pedido e abrir a DM"; nada é inventado (preço "Consultar", taxa "a confirmar").
9. **Honestidade da prévia**: valores demo e produtos de exemplo marcados; somem com `modoPrevia: false`. Contagens do perfil saem do catálogo (nada de seguidores).
10. **Stack**: Vite + React + TS, GSAP (ScrollTrigger, Flip carregado depois), Lenis só com mouse, Zustand com persistência segura. Camadas (story, chat, sacola) em chunks separados. Saída estática com `base: './'`.
11. **Projeto na pasta `greencheese/`** deste repositório (que já tinha outro conteúdo), na branch `claude/keen-ride-4epxve`; `dist/` e o zip de entrega versionados para baixar e subir na Hostinger.
