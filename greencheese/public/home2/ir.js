// A Home 2 (oprojeto.online/greencheese/home2/, e Home2/ e HOME2/ pelo publicar.mjs): o celular com o topo de 08/10 e
// a rua do mercador no fim do Início. Leva para a loja com ?home=2 na frente e o resto do link (?uf=rj, ?aba=mercado,
// ?produto=…) sem as outras chaves home*; o site mantém o ?home=2 a visita inteira (src/lib/url.ts). A página fica na
// pasta da loja, não aqui: o ./api/ e os pedaços continuam no lugar. Arquivo à parte porque a CSP do site não deixa
// script em linha.
;(function () {
  var resto = location.search
    .replace(/^\?/, '')
    .split('&')
    .filter(function (p) {
      return p && !/^home(-?[12])?(=|$)/i.test(p)
    })
  location.replace('../?' + ['home=2'].concat(resto).join('&') + location.hash)
})()
