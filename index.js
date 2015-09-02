var levelup = require('levelup')
var sublevel = require('sublevelup')
var transaction = require('level-transactions')
var ginga = require('ginga')
var xtend = require('xtend')
var H = require('highland')
var iterate = require('./iterate')
var through = require('through2')

var defaults = {
  db: process.browser ? require('leveldown') : require('level-js'),
  fields: {
    '*': true
  }
}
var override = {
  keyEncoding: 'utf8',
  valueEncoding: 'json'
}

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
  opts = xtend(defaults, opts, override)
  var db = typeof dir === 'string' ?
    sublevel(levelup(dir, opts)) :
    sublevel(dir, opts)

  this.options = db.options
  this.store = db
  this.tokens = db.sublevel('tokens')

  // token: token!key -> tf
}

var L = ginga(Levi.prototype)

L.define('get', params('key', 'options'), function (ctx, done) {
  ctx.options = xtend(this.options, ctx.options)
  this.store.get(ctx.key, function (err, doc) {
    done(err, doc ? doc.value : null)
  })
})

function pre (ctx) {
  ctx.options = xtend(this.options, ctx.options)
  ctx.tx = transaction(this.store)
  ctx.on('end', function (err) {
    if(err && !err.notFound) ctx.tx.rollback(err)
  })
}

function clean (ctx, next) {
  var self = this
  ctx.tx.get(ctx.key, function (err, doc) {
    if(!value) return next()
    ctx.value = doc.value
    ctx.tx.del(ctx.key)
    // todo: delete all tokens that contains key
    doc.tokens.forEach(function (token) {
      ctx.tx.del(token + '!' + ctx.key, { prefix: self.tokens })
    })
    next()
  })
}

function index (ctx, next) {
  var fields = ctx.options.fields
  if (typeof ctx.value === 'string') {
    // string value: tokenize with score 1
  }
  for (field in ctx.value) {
    var score = Number(fields[field] || fields['*'])
    if (!!score) {
      // todo: index field
    }
  }
}

function commit (ctx, done) {
  ctx.tx.commit(done)
}

L.define('del', params('key', 'options'), pre, clean, commit)
L.define('put', params('key', 'value', 'options'), pre, clean, index, commit)
L.define('index', params('key', 'options'), pre, clean, index, commit)

L.define('tokenize', params('value'), function (ctx, done) {
  if(ctx.tokens) done(new Error()) // todo: no tokenize pipeline error
  else done(null, ctx.tokens)
})

L.createSearchStream = 
L.searchStream = function (q, opts) {
  opts = xtend(this.options, opts)
}

L.createLiveStream = 
L.liveStream = function (q, opts) {
  opts = xtend(this.options, opts)
}

module.exports = Levi
