/* LENDA · painel — aparência e modo discreto aplicados ANTES do primeiro desenho (carregado sem defer no <head>;
 * a CSP não deixa script embutido). Lê localStorage['lenda:painel'] = {tema: 'original'|'claro'|'alto', discreto: bool}.
 * Sem armazenamento (janela anônima, bloqueado): fica o Original, com o modo discreto ligado. */
'use strict';
(function () {
  var p = {};
  try { p = JSON.parse(localStorage.getItem('lenda:painel') || '{}') || {}; } catch (e) { p = {}; }
  var raiz = document.documentElement;
  if (p.tema === 'claro' || p.tema === 'alto') raiz.setAttribute('data-tema', p.tema);
  raiz.setAttribute('data-discreto', p.discreto === false ? '0' : '1');
})();
