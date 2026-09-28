# Créditos e licenças

O LENDA é um projeto **pessoal e não comercial**. Esta página lista cada imagem de terceiros
usada, com fonte, autor e licença. As licenças CC BY e CC BY-SA exigem esse crédito. O conteúdo
também aparece dentro do jogo, na tela **Créditos** (`#/creditos`, link no menu e no rodapé da
página inicial), que lê as tabelas das seções 1 e 2 deste arquivo
(`src/ui/shared/credits/parse.ts`) e o `PHOTO_CREDITS` de `src/ui/art/photos.ts`. Mantenha o
formato das tabelas (uma linha por arquivo, começando com o nome entre crases); o teste
`src/ui/shared/credits/parse.test.ts` confere que todo troféu e toda foto do jogo têm crédito.

> **Aviso.** Os troféus, escudos, logos e nomes de competições são marcas e desenhos dos
> respectivos donos (FIFA, UEFA, CONMEBOL, CBF, ligas e clubes). As licenças abaixo cobrem
> **as fotografias**, não os direitos sobre os desenhos dos troféus nem sobre as marcas.
> Nenhuma dessas entidades apoia este projeto, e nenhuma tem vínculo com ele.

---

## 1. Troféus: recortes fotográficos (`public/trophies/<id>.webp`)

Todas as fotos são do **Wikimedia Commons**. Os links apontam para a página de descrição do
arquivo, onde estão a licença completa e o histórico.

**Modificações feitas em todos os arquivos:**
- Recorte na altura do troféu.
- Remoção do fundo: segmentação automática com BiRefNet-lite (rembg), limpeza de ilhas soltas e
  descontaminação de cor nas bordas.
- Redimensionamento para 720 px de altura e exportação em WebP com canal alfa.

Ajustes pontuais estão na coluna "Notas". Quem cria um derivado de arquivo **CC BY-SA** precisa
distribuí-lo sob a mesma licença, e os recortes indicados como CC BY-SA seguem essa regra.

| Arquivo | Foto original (Commons) | Autor | Licença | Notas |
|---|---|---|---|---|
| `world-cup.webp` | [FIFA World Cup Trophy photo by Djuradj Vujcic.jpg](https://commons.wikimedia.org/wiki/File:FIFA_World_Cup_Trophy_photo_by_Djuradj_Vujcic.jpg) | Djuradj Vujcic | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | |
| `club-world-cup.webp` | [The White House - 54443385493.jpg](https://commons.wikimedia.org/wiki/File:The_White_House_-_54443385493.jpg) | The White House (governo dos EUA) | Domínio público | Troféu de 2025, recortado de foto de grupo no Salão Oval |
| `champions-league.webp` | [Trofeo UEFA Champions League.jpg](https://commons.wikimedia.org/wiki/File:Trofeo_UEFA_Champions_League.jpg) | David Flores | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | Ampliado cerca de 1,3× (original de 594 px) |
| `conference-league.webp` | [UEFA Europa Conference League Trophy West Ham.jpg](https://commons.wikimedia.org/wiki/File:UEFA_Europa_Conference_League_Trophy_West_Ham.jpg) | Hammersfan | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Pedestal de exposição removido |
| `libertadores.webp` | [TaçaLibertadores2024.jpg](https://commons.wikimedia.org/wiki/File:Ta%C3%A7aLibertadores2024.jpg) | Phill ad | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | Pedestal de exposição removido |
| `sudamericana.webp` | [Taça da Copa Sul-Americana de 2016.jpg](https://commons.wikimedia.org/wiki/File:Ta%C3%A7a_da_Copa_Sul-Americana_de_2016.jpg) | ChapeTerror | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | Reflexo verde do painel de fundo atenuado |
| `recopa.webp` | [Trofeo de la Conmebol Recopa.png](https://commons.wikimedia.org/wiki/File:Trofeo_de_la_Conmebol_Recopa.png) | Futbolero44 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Já era um recorte, só redimensionado |
| `copa-america.webp` | [Copa america trofeo.jpg](https://commons.wikimedia.org/wiki/File:Copa_america_trofeo.jpg) | Hazaña17 (foto); troféu da Casa Escasany | Domínio público | Tom quente da vitrine reduzido para voltar ao prateado |
| `euro.webp` | [Coupe Henri Delaunay 2017.jpg](https://commons.wikimedia.org/wiki/File:Coupe_Henri_Delaunay_2017.jpg) | Кирилл Венедиктов | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | Reflexo azul-petróleo do fundo dessaturado |
| `brasileirao.webp` | [Troféu Campeonato Brasileiro 2024.jpg](https://commons.wikimedia.org/wiki/File:Trof%C3%A9u_Campeonato_Brasileiro_2024.jpg) | Phill ad | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | |
| `copa-do-brasil.webp` | [12.11.2025 - Troféu Copa do Brasil - Flamengo.jpg](https://commons.wikimedia.org/wiki/File:12.11.2025_-_Trof%C3%A9u_Copa_do_Brasil_-_Flamengo.jpg) | Vinicius Loures / Câmara dos Deputados | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | A base já vem cortada na foto original |
| `premier-league.webp` | [Trophy of FA Premier League in Singapore, 2023.jpg](https://commons.wikimedia.org/wiki/File:Trophy_of_FA_Premier_League_in_Singapore,_2023.jpg) | Pangalau | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | |
| `fa-cup.webp` | [FA Cup Trophy at Manchester National Football Museum (Ank Kumar) 02.jpg](https://commons.wikimedia.org/wiki/File:FA_Cup_Trophy_at_Manchester_National_Football_Museum_(Ank_Kumar)_02.jpg) | Ank Kumar | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | |
| `laliga.webp` | [Trofeo de La Liga 9900.jpg](https://commons.wikimedia.org/wiki/File:Trofeo_de_La_Liga_9900.jpg) | Lisímaco de Egipto | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | Reflexo verde do gramado atenuado |
| `copa-del-rey.webp` | [Copa del Rey 2010.jpg](https://commons.wikimedia.org/wiki/File:Copa_del_Rey_2010.jpg) | CarlosVdeHabsburgo | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | Reflexo vermelho do fundo parcialmente dessaturado |
| `bundesliga.webp` | [Frankfurter Buchmesse 2015 - Meisterschale (cropped).JPG](https://commons.wikimedia.org/wiki/File:Frankfurter_Buchmesse_2015_-_Meisterschale_(cropped).JPG) | JCS | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | |
| `coupe-de-france.webp` | [Coupe-de-France-2023-TFC.png](https://commons.wikimedia.org/wiki/File:Coupe-de-France-2023-TFC.png) | Laurie Laberinto | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | A fita do Toulouse faz parte da foto; ampliado 1,1× (usada a miniatura de 500 px) |
| `liga-mx.webp` | [Liga MX Trophy.jpg](https://commons.wikimedia.org/wiki/File:Liga_MX_Trophy.jpg) | Hefebreo | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | Gravação "Apertura 2012" original; reflexo verde atenuado |
| `ballon-dor.webp` | [Cristiano Ronaldo's 2008 Ballon d'Or trophy, Real Madrid Museum… (Ank Kumar, Infosys Limited) 01.jpg](https://commons.wikimedia.org/wiki/File:Cristiano_Ronaldo%27s_2008_Ballon_d%27Or_trophy,_Real_Madrid_Museum,_Santiago_Bernab%C3%A9u,_Madrid,_Spain_(Ank_Kumar,_Infosys_Limited)_01.jpg) | Ank Kumar | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | Nome e ano apagados da plaqueta (retoque) |
| `golden-boot.webp` | [Messi's Golden Shoe (51937265513).jpg](https://commons.wikimedia.org/wiki/File:Messi%27s_Golden_Shoe_(51937265513).jpg) | Radek Kucharski (Varsóvia, Polônia) | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | Chuteira de Ouro europeia; base de exposição removida |

**Sem foto livre boa o bastante.** Estes troféus usam a arte SVG ou a genérica:
- Liga Europa: o cachecol de fundo se sobrepõe à taça e o recorte ficou danificado.
- Serie A (Coppa Campioni d'Italia): só há ilustrações ou fotos com transparência falsa.
- Coppa Italia: a taça aparece segurada por mãos.
- DFB-Pokal e MLS Cup: só há fotos em que o troféu sai minúsculo.
- Ligue 1: o único candidato é um render não oficial.
- Liga Profesional e Copa Argentina: só há ilustrações.

Arquivos com licença suspeita foram descartados, como os PNGs de sites de "PNG download".

Arte SVG em `src/ui/trophies/svg/`: desenho próprio do projeto.

---

## 2. Fotos de eventos (`public/photos/<tema>-<n>.webp`)

Todas as fotos são do **[Unsplash](https://unsplash.com)** e seguem a
[Licença Unsplash](https://unsplash.com/license): uso gratuito, inclusive com modificações, sem
necessidade de atribuição. É proibido vender cópias sem alteração e compilar as fotos para montar
um serviço concorrente. Mesmo assim, creditamos cada autor.

**Modificações:** redimensionadas para 900 px de largura, recortadas para 3:2 quando a foto
original é vertical, e reencodadas em WebP. O `<EventArt>` ainda aplica gradiente, vinheta e grão
por cima.

Links: `https://unsplash.com/photos/<id>`. O arquivo foi baixado de
`https://images.unsplash.com/<id>?w=900&fm=webp`.

| Arquivo | Autor | Unsplash id | Mostra |
|---|---|---|---|
| `injury-1.webp` | Omar Ramadan | photo-1713711437257-0232e837f40c | jogador caído, companheiro ao lado |
| `injury-2.webp` | Matheus Protzen | photo-1774201426987-73ed89d3aa39 | jogador com dor no gramado |
| `injury-3.webp` | Luis Quintero | photo-1645114429601-46077d470ca8 | jogadores em volta de atleta caído |
| `training-1.webp` | Max Zindel | photo-1650897877790-0e171d2207dc | cones no campo |
| `training-2.webp` | Vikram TKV | photo-1551958219-acbc608c6377 | três bolas no gramado |
| `training-3.webp` | Nigel Msipa | photo-1600679472829-3044539ce8ed | chuteira sobre a bola |
| `rest-1.webp` | Danai Tsoutreli | photo-1646668072507-b2215b873c70 | rede entre coqueiros na praia |
| `rest-2.webp` | Simon Spring | photo-1672841828459-bc913fdcd995 | praia tropical |
| `press-1.webp` | Bogomil Mihaylov | photo-1516280440614-37939bbacd81 | microfone sob luz |
| `press-2.webp` | Andrew Medhat | photo-1570563568161-e4f5e8c6e27f | microfones no escuro |
| `press-3.webp` | Headway | photo-1540575467063-178a50c2df87 | plateia em sala escura |
| `phone-1.webp` | Adem AY | photo-1611926653458-09294b3142bf | pasta de apps de redes sociais |
| `phone-2.webp` | Berke Citak | photo-1724862936518-ae7fcfc052c1 | mão segurando celular |
| `contract-1.webp` | Cytonn Photography | photo-1521791055366-0d553872125f | caneta assinando contrato |
| `contract-2.webp` | Amina Atar | photo-1681505531034-8d67054e07f6 | aperto de mão sobre documentos |
| `contract-3.webp` | Scott Graham | photo-1450101499163-c8848c66ca85 | assinando papéis |
| `crowd-1.webp` | Krzysztof Dubiel | photo-1629217855633-79a6925d6c47 | estádio lotado à noite |
| `crowd-2.webp` | Piero Huerto Gago | photo-1569863959165-56dae551d4fc | papel picado na arquibancada |
| `crowd-3.webp` | Igor Batista | photo-1705593973313-75de7bf95b56 | estádio iluminado |
| `celebration-1.webp` | Waldemar Brandt | photo-1551390415-0de411440ca3 | time saudando a torcida |
| `celebration-2.webp` | Hanson Lu | photo-1558151748-f2621b5e52f0 | torcida comemorando |
| `celebration-3.webp` | Anders Krøgh Jørgensen | photo-1561917423-2ce508445fe4 | sinalizadores na arquibancada |
| `locker-1.webp` | Cristian Tarzi | photo-1676498110083-89a7f89e8f88 | camisas penduradas no vestiário |
| `locker-2.webp` | Michelle Myers | photo-1637028253736-ccf0e0e2da47 | banco e armários azuis |
| `national-1.webp` | Alfonso Scarpa | photo-1765046804547-06375f9a707b | time perfilado (hino) |
| `national-2.webp` | Omar Ramadan | photo-1641159009736-8a5fd4e52fef | roda de jogadores |
| `national-3.webp` | Olumide Adekunle | photo-1783434423781-b942fefc59a0 | camisa da seleção brasileira (só para jogadores do BRA) |
| `airport-1.webp` | Oskar Kadaksoo | photo-1553619948-505cc1cdc320 | portão de embarque com avião |
| `airport-2.webp` | Daniel | photo-1653795163859-9ee39ecc6d62 | viajantes no terminal |
| `money-1.webp` | Lance Asper | photo-1614200179396-2bdb77ebf81b | Ferrari vermelha |
| `money-2.webp` | Victor Furtuna | photo-1618418721668-0d1f72aa4bab | carro de luxo à noite |
| `money-3.webp` | omid armin | photo-1580048915913-4f8f5cb481c4 | mão com leque de euros e dólares |
| `doctor-1.webp` | yury kirillov | photo-1649751361457-01d3a696c7e6 | fisioterapeuta examinando a perna |
| `doctor-2.webp` | Toralf Thomassen | photo-1545463913-5083aa7359a6 | mãos de luva no joelho |
| `doctor-3.webp` | Online Marketing | photo-1532938911079-1b06ac7ceec7 | médico com estetoscópio |
| `tattoo-1.webp` | Allef Vinicius | photo-1482329033286-79a3d24413b4 | tatuador trabalhando |
| `tattoo-2.webp` | Kristian Angelo | photo-1552627019-947c3789ffb5 | tatuador (P&B) |
| `school-1.webp` | Debby Hudson | photo-1517673132405-a56a62b18caf | livros, papel e caneta |
| `school-2.webp` | Fa Barboza | photo-1610050731641-f855ccdaf3f6 | estudando com livro aberto |
| `family-1.webp` | Pablo Merchán Montes | photo-1533777419517-3e4017e2e15a | brinde em família à mesa |
| `family-2.webp` | National Cancer Institute | photo-1576089073624-b5751a8f4de9 | família jantando |
| `tv-1.webp` | Vanilla Bear Films | photo-1543235074-4768b5c2233c | câmera de ombro |
| `tv-2.webp` | Simone Impei | photo-1567506476376-1282584643ca | câmera filmando palco |
| `tv-3.webp` | Jakob Owens | photo-1625690303837-654c9666d2d0 | filmagem com luz azul e vermelha |
| `captain-1.webp` | Elist Nguyen | photo-1781863075425-91c985451a4a | jogador com o pé na bola em estádio vazio |

---

## 3. Outros recursos visuais

| Recurso | Onde | Fonte | Licença |
|---|---|---|---|
| Bandeiras | `public/flags/4x3/*.svg` | [flag-icons](https://github.com/lipis/flag-icons) (Panayiotis Lipiridis e colaboradores) | [MIT](https://github.com/lipis/flag-icons/blob/main/LICENSE) |
| Ícones | UI (`lucide-react`) | [Lucide](https://lucide.dev) | [ISC](https://lucide.dev/license) |
| Escudos de clubes e logos de ligas/copas | `public/crests/`, `public/leagues/` | CDN da ESPN (`a.espncdn.com`), baixados pelo `scripts/build-data.mjs` | Marcas dos respectivos donos, usadas só para identificação em projeto pessoal e não comercial |

## 4. Fontes tipográficas

Empacotadas via [Fontsource](https://fontsource.org). Todas estão sob a
[SIL Open Font License 1.1](https://openfontlicense.org):

- **Inter** e **Inter Tight**, de Rasmus Andersson.
- **Barlow** e **Barlow Condensed**, de Jeremy Tribby.
- **Cormorant Garamond**, de Christian Thalmann (Catharsis Fonts).

## 5. Dados

| Dado | Fonte | Observação |
|---|---|---|
| Tabelas de hoje, clubes, cores, escudos, calendário e copas em andamento | API pública da ESPN (`site.api.espn.com`, `sports.core.api.espn.com`) | Endpoint não documentado, sem garantias. Snapshot gerado em build (`npm run data`) |
| Notas dos jogadores (EA SPORTS FC 27) | API pública do [fut.gg](https://www.fut.gg) | "EA SPORTS FC" é marca da Electronic Arts. As notas servem só como referência de força, em uso pessoal e não comercial |
| Catálogos de ligas, vagas, troféus e eventos | Escritos à mão para o projeto | — |

O uso desses dados e marcas vale **apenas para uso pessoal e não comercial**. Publicar ou
monetizar o jogo exigiria rever cada item desta página.
