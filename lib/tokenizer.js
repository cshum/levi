var ginga = require('ginga')
var H = require('highland')

var SEP = /[\|' \.,\-|(\n)]+/

module.exports = function tokenizer (sep) {
  sep = sep || SEP

  return ginga().use('pipeline', function (ctx) {
    // tokenizer
    ctx.tokens = H(ctx.tokens)
    .flatMap(function (value) {
      return H(value.split(SEP))
    })
    .map(function (token) {
      return token.trim().toLowerCase()
    })
  })
}
