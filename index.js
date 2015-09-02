var levelup = require('levelup')
var sublevel = require('sublevelup')
var ginga = require('ginga')
var xtend = require('xtend')
var transaction = require('level-transactions')
var H = require('highland')

var defaults = {}
defaults.db = process.browser ?
  require('leveldown') :
  require('level-js')

function params () {
  var names = Array.prototype.slice.call(arguments)
  var l = names.length
  return function (ctx) {
    for(var i = 0; i < l; i++) {
      ctx[names[i]] = ctx.args[i];
    }
  }
}

function Levi (dir, opts) {
  if (!(this instanceof Levi)) {
    return new Levi(dir, opts)
  }
  opts = xtend(defaults, opts)
  var db = typeof dir === 'string' ?
    sublevel(levelup(dir, opts)) :
    sublevel(dir, opts)

  this.options = db.options
  this.store = db
  this.tokens = db.sublevel('tokens')
}

var L = ginga(Levi.prototype)

function pre (ctx) {
  ctx.options = xtend(this.options, ctx.options)
}

function get (ctx, done) {
  this.store.get(ctx.key, ctx.options, done)
}

function put (ctx, done) {
  // todo: del current index, put new index
  var tx = transaction(this.store)
  tx.get(ctx.key, function (err, value) {
  })
}

function del (ctx, done) {
  // todo: del current index

}

L.define('get', params('key', 'options'), pre, get)
L.define('del', params('key', 'options'), pre, put)
L.define('put', params('key', 'value', 'options'), pre, del)

L.createSearchStream = 
L.searchStream = function (q, opts) {
  opts = xtend(this.options, opts)
}

L.createLiveStream = 
L.liveStream = function (q, opts) {
  opts = xtend(this.options, opts)
}

module.exports = Levi
