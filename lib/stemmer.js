var ginga = require('ginga')
var H = require('highland')
var stemmer = require('stemmer')

module.exports = function (fn) {
  fn = fn || stemmer

  return ginga().use('pipeline', function (ctx) {
    ctx.tokens = H(ctx.tokens).map(fn)
  })
}
