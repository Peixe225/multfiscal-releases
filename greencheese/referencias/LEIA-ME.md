# referencias/

Coloque aqui os 16 prints do Instagram da Green Cheese (1242×2688).

Eles **não vieram** junto com o projeto. Enquanto isso, o site usa artes dos produtos desenhadas em código (pixel art com dither) e o logo redesenhado em SVG a partir da descrição do briefing.

Quando os prints estiverem aqui:

1. Liste em `scripts/recortes.json` qual print tem qual produto (o id está em `src/dados/catalogo.json`).
2. Rode `npm run recortar`. As fotos saem em `public/produtos/*.webp` e o catálogo já passa a usá-las.
3. Compare o logo SVG (`src/arte/Logo.tsx`) com a foto de perfil. Se não estiver fiel, recorte o logo do print e troque.

Não usar: a figura encapuzada (personagem de jogo) nem o perfil pessoal citado na bio.
