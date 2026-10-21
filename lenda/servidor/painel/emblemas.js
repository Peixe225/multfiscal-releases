/* LENDA · painel — emblemas dos desafios (v3.4, CONTRATO-v34 §C): a moeda com o ícone e a cor, desenhada como o jogo
 * desenha (src/ui/shared/emblemas/Emblema.tsx), os nomes da dificuldade e dos ícones, e o seletor de ícone e cor do
 * editor de desafio. Os traços dos ícones são os do lucide (lucide-react 1.48.0, licença ISC, © Lucide Contributors),
 * os mesmos do mapa das conquistas do jogo (src/ui/shared/achievements/meta.ts): ícone fora do mapa = a medalha e cor
 * fora de #rrggbb = o bronze, como no jogo. A cor entra pelo CSSOM (--emb), nunca por style="" (a CSP barra). */
'use strict';

(function () {
  const LP = window.LP;
  const { h } = LP;

  // [tag, atributos] de cada ícone (viewBox 24 × 24, traço), gerados do node_modules/lucide-react/dist/esm/icons/*.mjs
  const ICONES = {
    'arrow-up': [["path",{"d":"m5 12 7-7 7 7"}],["path",{"d":"M12 19V5"}]],
    award: [["path",{"d":"m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526"}],["circle",{"cx":"12","cy":"8","r":"6"}]],
    baby: [["path",{"d":"M10 16c.5.3 1.2.5 2 .5s1.5-.2 2-.5"}],["path",{"d":"M15 12h.01"}],["path",{"d":"M19.38 6.813A9 9 0 0 1 20.8 10.2a2 2 0 0 1 0 3.6 9 9 0 0 1-17.6 0 2 2 0 0 1 0-3.6A9 9 0 0 1 12 3c2 0 3.5 1.1 3.5 2.5s-.9 2.5-2 2.5c-.8 0-1.5-.4-1.5-1"}],["path",{"d":"M9 12h.01"}]],
    backpack: [["path",{"d":"M4 10a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"}],["path",{"d":"M8 10h8"}],["path",{"d":"M8 18h8"}],["path",{"d":"M8 22v-6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v6"}],["path",{"d":"M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"}]],
    badge: [["path",{"d":"M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"}]],
    'brick-wall': [["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2"}],["path",{"d":"M12 9v6"}],["path",{"d":"M16 15v6"}],["path",{"d":"M16 3v6"}],["path",{"d":"M3 15h18"}],["path",{"d":"M3 9h18"}],["path",{"d":"M8 15v6"}],["path",{"d":"M8 3v6"}]],
    calendar: [["path",{"d":"M8 2v3"}],["path",{"d":"M16 2v3"}],["rect",{"x":"3","y":"3","width":"18","height":"18","rx":"2"}],["path",{"d":"M3 9h18"}]],
    'circle-dot': [["circle",{"cx":"12","cy":"12","r":"1"}],["circle",{"cx":"12","cy":"12","r":"10"}]],
    'circle-off': [["path",{"d":"m2 2 20 20"}],["path",{"d":"M8.35 2.69A10 10 0 0 1 21.3 15.65"}],["path",{"d":"M19.08 19.08A10 10 0 1 1 4.92 4.92"}]],
    compass: [["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"}]],
    crown: [["path",{"d":"M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z"}],["path",{"d":"M5 21h14"}]],
    flag: [["path",{"d":"M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"}]],
    flame: [["path",{"d":"M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4"}]],
    footprints: [["path",{"d":"M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z"}],["path",{"d":"M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z"}],["path",{"d":"M16 17h4"}],["path",{"d":"M4 13h4"}]],
    gem: [["path",{"d":"M10.5 3 8 9l4 13 4-13-2.5-6"}],["path",{"d":"M17 3a2 2 0 0 1 1.6.8l3 4a2 2 0 0 1 .013 2.382l-7.99 10.986a2 2 0 0 1-3.247 0l-7.99-10.986A2 2 0 0 1 2.4 7.8l2.998-3.997A2 2 0 0 1 7 3z"}],["path",{"d":"M2 9h20"}]],
    globe: [["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"}],["path",{"d":"M2 12h20"}]],
    'globe-2': [["path",{"d":"M21.54 15H17a2 2 0 0 0-2 2v4.54"}],["path",{"d":"M7 3.34V5a3 3 0 0 0 3 3a2 2 0 0 1 2 2c0 1.1.9 2 2 2a2 2 0 0 0 2-2c0-1.1.9-2 2-2h3.17"}],["path",{"d":"M11 21.95V18a2 2 0 0 0-2-2a2 2 0 0 1-2-2v-1a2 2 0 0 0-2-2H2.05"}],["circle",{"cx":"12","cy":"12","r":"10"}]],
    goal: [["path",{"d":"M12 13V2l8 4-8 4"}],["path",{"d":"M20.561 10.222a9 9 0 1 1-12.55-5.29"}],["path",{"d":"M8.002 9.997a5 5 0 1 0 8.9 2.02"}]],
    hand: [["path",{"d":"M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"}],["path",{"d":"M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"}],["path",{"d":"M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"}],["path",{"d":"M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"}]],
    'hand-helping': [["path",{"d":"M11 12h2a2 2 0 1 0 0-4h-3c-.6 0-1.1.2-1.4.6L3 14"}],["path",{"d":"m7 18 1.6-1.4c.3-.4.8-.6 1.4-.6h4c1.1 0 2.1-.4 2.8-1.2l4.6-4.4a2 2 0 0 0-2.75-2.91l-4.2 3.9"}],["path",{"d":"m2 13 6 6"}]],
    heart: [["path",{"d":"M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"}]],
    infinity: [["path",{"d":"M6 16c5 0 7-8 12-8a4 4 0 0 1 0 8c-5 0-7-8-12-8a4 4 0 1 0 0 8"}]],
    layers: [["path",{"d":"M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"}],["path",{"d":"M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"}],["path",{"d":"M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"}]],
    map: [["path",{"d":"M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"}],["path",{"d":"M15 5.764v15"}],["path",{"d":"M9 3.236v15"}]],
    medal: [["path",{"d":"M7.21 15 2.66 7.14a2 2 0 0 1 .13-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.14a2 2 0 0 1 .14 2.2L16.79 15"}],["path",{"d":"M11 12 5.12 2.2"}],["path",{"d":"m13 12 5.88-9.8"}],["path",{"d":"M8 7h8"}],["circle",{"cx":"12","cy":"17","r":"5"}],["path",{"d":"M12 18v-2h-.5"}]],
    mountain: [["path",{"d":"m8 3 4 8 5-5 5 15H2L8 3z"}]],
    plane: [["path",{"d":"M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"}]],
    shield: [["path",{"d":"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"}]],
    'shield-check': [["path",{"d":"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"}],["path",{"d":"m9 12 2 2 4-4"}]],
    shirt: [["path",{"d":"M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"}]],
    sparkles: [["path",{"d":"M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"}],["path",{"d":"M20 2v4"}],["path",{"d":"M22 4h-4"}],["circle",{"cx":"4","cy":"20","r":"2"}]],
    star: [["path",{"d":"M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"}]],
    sunrise: [["path",{"d":"M12 2v8"}],["path",{"d":"m4.93 10.93 1.41 1.41"}],["path",{"d":"M2 18h2"}],["path",{"d":"M20 18h2"}],["path",{"d":"m19.07 10.93-1.41 1.41"}],["path",{"d":"M22 22H2"}],["path",{"d":"m8 6 4-4 4 4"}],["path",{"d":"M16 18a4 4 0 0 0-8 0"}]],
    swords: [["path",{"d":"m13 19 6-6"}],["path",{"d":"M14.5 17.5 3.586 6.586A2 2 0 013 5.172V3h2.172a2 2 0 011.414.586L17.5 14.5"}],["path",{"d":"m14.828 6.172 2.586-2.586A2 2 0 0118.828 3H21v2.172a2 2 0 01-.586 1.414l-2.586 2.586"}],["path",{"d":"m16 16 4 4"}],["path",{"d":"m19 21 2-2"}],["path",{"d":"m5 14 4 4"}],["path",{"d":"m5 21-2-2"}],["path",{"d":"M7.5 16.5 4 20"}]],
    target: [["circle",{"cx":"12","cy":"12","r":"10"}],["circle",{"cx":"12","cy":"12","r":"6"}],["circle",{"cx":"12","cy":"12","r":"2"}]],
    'trending-up': [["path",{"d":"M16 7h6v6"}],["path",{"d":"m22 7-8.5 8.5-5-5L2 17"}]],
    trophy: [["path",{"d":"M10 14.66V17a1 1 0 0 1-1 1 2 2 0 0 0-2 2v2"}],["path",{"d":"M14 14.66V17a1 1 0 0 0 1 1 2 2 0 0 1 2 2v2"}],["path",{"d":"M17.916 10H19.5A2.5 2.5 0 0 0 22 7.5V5a1 1 0 0 0-1-1h-3"}],["path",{"d":"M4 22h16"}],["path",{"d":"M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z"}],["path",{"d":"M6.084 10H4.5A2.5 2.5 0 0 1 2 7.5V5a1 1 0 0 1 1-1h3"}]],
    zap: [["path",{"d":"M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z"}]],
  };
  LP.NOMES_ICONE_EMBLEMA = {
    'arrow-up': 'Seta para cima', award: 'Prêmio', baby: 'Bebê', backpack: 'Mochila', badge: 'Distintivo', 'brick-wall': 'Muro',
    calendar: 'Calendário', 'circle-dot': 'Bola', 'circle-off': 'Círculo cortado', compass: 'Bússola', crown: 'Coroa', flag: 'Bandeira',
    flame: 'Chama', footprints: 'Pegadas', gem: 'Joia', globe: 'Globo', 'globe-2': 'Planeta', goal: 'Gol', hand: 'Mão', 'hand-helping': 'Mão estendida',
    heart: 'Coração', infinity: 'Infinito', layers: 'Camadas', map: 'Mapa', medal: 'Medalha', mountain: 'Montanha', plane: 'Avião', shield: 'Escudo',
    'shield-check': 'Escudo com visto', shirt: 'Camisa', sparkles: 'Brilhos', star: 'Estrela', sunrise: 'Nascer do sol', swords: 'Espadas',
    target: 'Alvo', 'trending-up': 'Em alta', trophy: 'Troféu', zap: 'Raio',
  };
  /** Os ícones que o editor oferece (os do mapa das conquistas do jogo, sem o apelido "goat" = coroa). */
  LP.ICONES_EMBLEMA = Object.keys(ICONES);
  LP.NOMES_DIFICULDADE = { facil: 'Fácil', medio: 'Médio', dificil: 'Difícil', lendario: 'Lendário' };
  LP.DIFICULDADES = ['facil', 'medio', 'dificil', 'lendario'];
  /** As cores prontas: as quatro da raridade das conquistas (as dos 10 de fábrica) e mais algumas. */
  LP.CORES_EMBLEMA = [
    { cor: '#b98652', nome: 'Bronze (fácil)' }, { cor: '#c8d0dc', nome: 'Prata (médio)' }, { cor: '#f2c75a', nome: 'Ouro (difícil)' },
    { cor: '#c9b8ff', nome: 'Lilás (lendário)' }, { cor: '#52c48e', nome: 'Verde' }, { cor: '#6aa8ff', nome: 'Azul' }, { cor: '#ff8a65', nome: 'Laranja' },
    { cor: '#f06292', nome: 'Rosa' },
  ];
  /** A cor sugerida para cada dificuldade (o editor troca a cor junto, se ela ainda era a da dificuldade de antes). */
  LP.COR_DA_DIFICULDADE = { facil: '#b98652', medio: '#c8d0dc', dificil: '#f2c75a', lendario: '#c9b8ff' };

  const COR_RE = /^#[0-9a-f]{6}$/i;
  const ICONE_RE = /^[a-z0-9-]{1,24}$/;
  LP.corEmblemaValida = (c) => typeof c === 'string' && COR_RE.test(c);
  // §E da v3.4: só um ícone do mapa (hasOwnProperty: "constructor" passava no [a-z0-9-] e achava a função Object do protótipo)
  const temIcone = (i) => typeof i === 'string' && Object.prototype.hasOwnProperty.call(ICONES, i);
  LP.iconeEmblemaValido = (i) => typeof i === 'string' && ICONE_RE.test(i) && temIcone(i);
  /** O ícone (SVG de traço) de um emblema; fora do mapa, a medalha (como o jogo). */
  LP.iconeEmblema = function (nome) {
    const s = LP.svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', class: 'emblema-icone', fill: 'none', stroke: 'currentColor', 'stroke-width': '2.3', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    (temIcone(nome) ? ICONES[nome] : ICONES.medal).forEach(([tag, a]) => s.appendChild(LP.svg(tag, a)));
    return s;
  };
  /**
   * A moeda do emblema. e = {icone, cor, titulo?}; o.tamanho = 'p' (14 px) | '' (22 px) | 'g' (40 px) | 'xg' (64 px);
   * o.rotulo = o nome para leitores de tela e o title (null = decorativo, quando o nome já está escrito ao lado).
   */
  LP.emblema = function (e, o) {
    o = o || {};
    const x = e || {};
    const nome = o.rotulo === null ? null : o.rotulo || (x.titulo ? 'Emblema: ' + x.titulo : 'Emblema');
    const s = h('span', { class: 'emblema' + (o.tamanho ? ' emblema-' + o.tamanho : '') + (o.apagado ? ' emblema-apagado' : ''), role: nome ? 'img' : null,
      'aria-label': nome, 'aria-hidden': nome ? null : 'true', title: nome });
    s.style.setProperty('--emb', LP.corEmblemaValida(x.cor) ? x.cor.toLowerCase() : '#b98652');
    s.appendChild(LP.iconeEmblema(LP.iconeEmblemaValido(x.icone) ? x.icone : 'medal'));
    return s;
  };
  /** Pílula da dificuldade (fácil bronze, médio prata, difícil ouro, lendário lilás); null = nada. */
  LP.chipDificuldade = function (d) {
    if (!d || !LP.NOMES_DIFICULDADE[d]) return null;
    return LP.chip(LP.NOMES_DIFICULDADE[d], '', { semPonto: true, classe: 'chip-dif chip-dif-' + d, title: 'Dificuldade (a da calibração: quanto mais difícil, mais raro numa carreira)' });
  };
  LP.NOMES_ESTADO_EMBLEMA = { ativo: 'Com o emblema', retirado: 'Retirado' };
  /** Pílula do emblema de uma conta: ativo (verde) ou retirado (tracejado). */
  LP.chipEstadoEmblema = function (st) {
    return st === 'retirado' ? LP.chip('Retirado', 'tracejado', { semPonto: true, title: 'A equipe (ou o sistema) tirou: a conta não mostra mais. Não volta sozinho.' })
      : LP.chip('Com o emblema', 'ok');
  };

  /**
   * O seletor do editor: os ícones em grade (botões com aria-pressed), as cores prontas, a cor livre (input color) e a
   * moeda de prévia. o = {icone, cor, desabilitado, aoMudar({icone, cor})}. Devolve {no, definir({icone, cor})}.
   */
  LP.seletorEmblema = function (o) {
    let atual = { icone: LP.iconeEmblemaValido(o.icone) ? o.icone : 'medal', cor: LP.corEmblemaValida(o.cor) ? o.cor.toLowerCase() : '#b98652' };
    const previa = h('div', { class: 'emblema-previa', 'aria-live': 'polite' });
    const grade = h('div', { class: 'emblema-icones', role: 'group', 'aria-label': 'Ícone do emblema' });
    const botoesIcone = {};
    LP.ICONES_EMBLEMA.forEach((k) => {
      const b = h('button', { type: 'button', class: 'emblema-opcao', 'aria-pressed': 'false', title: LP.NOMES_ICONE_EMBLEMA[k] || k, 'aria-label': LP.NOMES_ICONE_EMBLEMA[k] || k, disabled: !!o.desabilitado, dataset: { icone: k } },
        LP.iconeEmblema(k));
      b.addEventListener('click', () => mudar({ icone: k }));
      botoesIcone[k] = b;
      grade.appendChild(b);
    });
    const cores = h('div', { class: 'emblema-cores', role: 'group', 'aria-label': 'Cor do emblema' });
    const botoesCor = {};
    LP.CORES_EMBLEMA.forEach((c) => {
      const b = h('button', { type: 'button', class: 'emblema-cor', 'aria-pressed': 'false', title: c.nome + ' · ' + c.cor, 'aria-label': c.nome, disabled: !!o.desabilitado, dataset: { cor: c.cor } });
      b.style.setProperty('--emb', c.cor);
      b.addEventListener('click', () => mudar({ cor: c.cor }));
      botoesCor[c.cor] = b;
      cores.appendChild(b);
    });
    const livre = h('input', { type: 'color', id: 'dz-emblema-cor', 'aria-label': 'Outra cor', title: 'Outra cor', disabled: !!o.desabilitado });
    livre.addEventListener('input', () => mudar({ cor: livre.value }));
    const hex = h('span', { class: 'mono texto-3 emblema-hex' });
    cores.appendChild(h('label', { class: 'emblema-livre' }, livre, h('span', null, 'Outra')));
    cores.appendChild(hex);
    function pintar() {
      LP.trocar(previa, LP.emblema(atual, { tamanho: 'xg', rotulo: 'Prévia do emblema: ' + (LP.NOMES_ICONE_EMBLEMA[atual.icone] || atual.icone) }),
        h('div', { class: 'emblema-previa-txt' }, h('b', null, LP.NOMES_ICONE_EMBLEMA[atual.icone] || atual.icone), h('span', { class: 'texto-3 mono' }, atual.icone + ' · ' + atual.cor),
          h('span', { class: 'emblema-previa-tamanhos', 'aria-hidden': 'true' }, LP.emblema(atual, { tamanho: 'g', rotulo: null }), LP.emblema(atual, { rotulo: null }), LP.emblema(atual, { tamanho: 'p', rotulo: null })),
          h('span', { class: 'texto-3' }, 'no jogo: na tela Desafios, na conta, no perfil e, pequeno, ao lado do apelido no Hall')));
      Object.keys(botoesIcone).forEach((k) => botoesIcone[k].setAttribute('aria-pressed', String(k === atual.icone)));
      Object.keys(botoesCor).forEach((k) => botoesCor[k].setAttribute('aria-pressed', String(k === atual.cor)));
      livre.value = atual.cor;
      hex.textContent = atual.cor;
    }
    function mudar(p) {
      atual = Object.assign({}, atual, p);
      if (p.cor) atual.cor = String(p.cor).toLowerCase();
      pintar();
      if (o.aoMudar) o.aoMudar(Object.assign({}, atual));
    }
    pintar();
    const no = h('div', { class: 'seletor-emblema' }, previa, h('p', { class: 'rotulo' }, 'Ícone'), grade, h('p', { class: 'rotulo' }, 'Cor'), cores);
    return { no: no, definir: (p) => { atual = Object.assign({}, atual, p); pintar(); }, valor: () => Object.assign({}, atual) };
  };
})();
