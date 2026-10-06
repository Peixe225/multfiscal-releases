// Atalho da Home 2 (oprojeto.online/greencheese/home2/): leva para a loja com ?home=2 e mantém o resto do link
// (?uf=rj, ?aba=catalogo, ?produto=…). Arquivo à parte porque a CSP do site não deixa script em linha.
;(function () {
  var resto = location.search
    .replace(/^\?/, '')
    .split('&')
    .filter(function (p) {
      return p && !/^home(-?[12])?(=|$)/i.test(p)
    })
  location.replace('../?' + ['home=2'].concat(resto).join('&') + location.hash)
})()
