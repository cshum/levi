var ginga = require('ginga')
var H = require('highland')

var SEP = /[\|' \.,\-|(\n)]+/

module.exports = function tokenizer (sep) {
  sep = sep || SEP

  return ginga().use('pipeline', function (ctx) {
    // tokenizer
    if (Array.isArray(ctx.value)) {
      ctx.tokens = H(ctx.value.slice)
    } else if (typeof ctx.value === 'string') {
      ctx.tokens = H(ctx.value.trim().split(SEP))
    } else {
      ctx.tokens = H([])
    }
    ctx.tokens = ctx.tokens.map(function (token) {
      return String(token).toLowerCase()
    })
  })
}
