// Atalho antigo da Home 2 (oprojeto.online/greencheese/home2/), que ficou em teste e saiu: leva para a loja e mantém o
// resto do link (?uf=rj, ?aba=catalogo, ?produto=…) sem as chaves home*. Arquivo à parte porque a CSP do site não
// deixa script em linha.
;(function () {
  var resto = location.search
    .replace(/^\?/, '')
    .split('&')
    .filter(function (p) {
      return p && !/^home(-?[12])?(=|$)/i.test(p)
    })
  location.replace('../' + (resto.length ? '?' + resto.join('&') : '') + location.hash)
})()
