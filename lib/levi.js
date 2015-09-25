var levelup = require('levelup')
var sublevel = require('sublevelup')
var transaction = require('level-transactions')
var ginga = require('ginga')
var H = require('highland')
var extract = require('extract-object')
var xtend = require('xtend')
var ltgt = require('ltgt')
var inherits = require('util').inherits
var EventEmitter = require('events').EventEmitter
var merge = require('./util/merge')
var group = require('./util/group')
var similarity = require('./util/similarity')

var END = '\uffff'

var defaults = {
  db: process.browser ? require('level-js') : require('leveldown'),
  ttl: 60 * 1000, // transaction ttl
  fields: { '*': true }
}
var override = {
  keyEncoding: 'utf8',
  valueEncoding: 'json'
}

function Levi (dir, opts) {
  if (!(this instanceof Levi)) return new Levi(dir, opts)
  opts = xtend(defaults, opts, override)

  var db = typeof dir === 'string'
    ? sublevel(levelup(dir, opts))
    : sublevel(dir, opts)

  this.options = db.options

  // meta: size -> N
  // store: key -> value
  // tokens: key -> tokens
  // weight: token! -> nt
  // weight: token!key -> tf

  this.db = db
  this.store = db
  this.meta = db.sublevel('mt')
  this.tokens = db.sublevel('tk')
  this.weight = db.sublevel('wt')

  EventEmitter.call(this)
  this.setMaxListeners(Infinity)
}

// Pipeline plugins
Levi.tokenizer = require('./tokenizer')
Levi.stemmer = require('./stemmer')
Levi.stopword = require('./stopword')

function countTokens (tokens) {
  var counts = {}
  for (var i = 0, l = tokens.length; i < l; i++) {
    // avoid conflict with obj reserved words
    var key = '@' + tokens[i]
    counts[key] = (counts[key] || 0) + 1
  }
  return counts
}
// ginga params middleware factory
function params () {
  var names = Array.prototype.slice.call(arguments)
  var len = names.length
  return function (ctx) {
    var l = Math.min(ctx.args.length, len)
    for (var i = 0; i < l; i++) ctx[names[i]] = ctx.args[i]
  }
}

function noop () {}

inherits(Levi, EventEmitter)
Levi.fn = ginga(Levi.prototype)

Levi.fn.define('get', params('key', 'options'), function (ctx, done) {
  this.store.get(ctx.key, xtend(this.options, ctx.options), done)
})

var RESERVED = /!/g

Levi.fn.define('pipeline', params('tokens', 'field'), function (ctx, next) {
  // init with highland stream
  try {
    ctx.tokens = H(extract(ctx.tokens))
    next()
  } catch (e) {
    next(e)
  }
}, function (ctx, done) {
  // finalize with trimming and padding
  H(ctx.tokens)
  .reject(function (token) {
    return typeof token !== 'string' || token.trim() === ''
  })
  .map(function (token) {
    // prevent conflict with reserved words
    return token.replace(RESERVED, '')
  })
  .collect()
  .pull(done)
})

// transaction increment
function incr (key, options, cb) {
  this.get(key, options, function (e, val) {
    options = xtend(options, {unsafe: true})
    val = (val || 0) + 1
    this.put(key, val, options)
    if (cb) cb(null, val)
  })
}
// transaction decrement
function decr (key, options, cb) {
  this.get(key, options, function (e, val) {
    options = xtend(options, {unsafe: true})
    val = (val || 0) - 1
    if (val === 0) this.del(key, options)
    else this.put(key, val, options)
    if (cb) cb(null, val)
  })
}

function pre (ctx, next) {
  ctx.options = xtend(this.options, ctx.options)

  if (ctx.tx) {
    // nested transaction
    ctx.root = false
    if (!(ctx.tx instanceof transaction)) {
      return next('Invalid transaction instance.')
    }
  } else {
    // root transaction
    ctx.root = true
    ctx.tx = transaction(this.store)
    ctx.tx.incr = incr
    ctx.tx.decr = decr
  }

  // rollback transaction if error
  ctx.on('end', function (err) {
    if (err) ctx.tx.rollback(err)
  })

  if (ctx.method === 'batch') {
    // batch
    if (!Array.isArray(ctx.batch)) {
      return next(new Error('batch must be Array.'))
    }
  } else {
    // put or del
    // key check
    if (
      ctx.key === '' ||
      ctx.key === null ||
      ctx.key === undefined
    ) return next(new Error('Key required.'))

    ctx.key = String(ctx.key)
  }

  next()
}

// clean up old index
function del (ctx, next) {
  var self = this
  if (!ctx.value) {
    ctx.tx.on('end', function (err) {
      if (err) return
      self.emit('del', { key: ctx.key })
    })
  }
  ctx.tx.get(ctx.key, function (err, value) {
    if (err && !err.notFound) return next(err)
    // skip if not exists
    if (!value) return next()
    // keep value if reindexing
    if (!ctx.value) ctx.value = value
    // del store item
    ctx.tx.del(ctx.key)
    // decrement size
    ctx.tx.decr('size', { prefix: self.meta })
    // delete all tfs that contains key
    ctx.tx.get(ctx.key, { prefix: self.tokens }, function (err, tokens) {
      if (err) return next(err)
      tokens.forEach(function (token) {
        // decrement nt
        ctx.tx.decr(token + '!', { prefix: self.weight })
        // del tf
        ctx.tx.del(token + '!' + ctx.key, { prefix: self.weight, unsafe: true })
      })
      // delete tokens
      ctx.tx.del(ctx.key, { prefix: self.tokens, unsafe: true })
      next()
    })
  })
}

// put new index
function put (ctx, next) {
  var self = this

  if (!ctx.value) return next(new Error('Value required.'))
  if (Buffer.isBuffer(ctx.value)) {
    ctx.value = ctx.value.toString('binary')
  }

  // result for emitter
  var result = {
    key: ctx.key,
    value: ctx.value,
    nts: {}
  }
  ctx.tx.on('end', function (err) {
    if (err) return
    self.emit('put', { key: ctx.key, value: ctx.value })
    self.emit('_write', result)
  })

  // increment size
  ctx.tx.incr('size', { prefix: self.meta }, function (e, val) {
    result.size = val
  })

  var value
  if (typeof ctx.value === 'string' || Array.isArray(ctx.value)) {
    // string means no field boost
    value = { '*': ctx.value }
  } else {
    value = ctx.value
  }

  var tfs = {}
  var fields = Object.keys(value)
  var len = fields.length
  var count = 0

  // init tf all fields zero
  var tfInit = {}
  for (var field in value) tfInit[field] = 0

  ctx.tx.defer(function (cb) {
    for (var field in value) {
      self.pipeline(value[field], field, function (err, tokens) {
        if (err) return cb(err)
        var total = tokens.length
        var counts = countTokens(tokens)
        for (var token in counts) {
          tfs[token] = tfs[token] || xtend(tfInit)
          tfs[token][field] = counts[token] / total
        }
        count++
        if (count === len) cb()
      })
    }
  })
  ctx.tx.defer(function (cb) {
    // put store item
    ctx.tx.put(ctx.key, ctx.value)

    var uniqs = Object.keys(tfs)
    uniqs.forEach(function (token) {
      // increment nt
      ctx.tx.incr(token + '!', { prefix: self.weight }, function (e, val) {
        result.nts[token] = val
      })
      // put tf object
      ctx.tx.put(token + '!' + ctx.key, tfs[token], {
        prefix: self.weight, unsafe: true
      })
    })
    result.tfs = tfs
    // put tokens
    ctx.tx.put(ctx.key, uniqs, { prefix: self.tokens, unsafe: true })

    cb()
  })

  next()
}

function batch (ctx, next) {
  for (var i = 0, l = ctx.batch.length; i < l; i++) {
    var op = ctx.batch[i]
    if (op.type === 'put') {
      this.put(op.key, op.value, op, ctx.tx)
    } else if (op.type === 'del') {
      this.del(op.key, op, ctx.tx)
    } else {
      return next(new Error('Invalid batch operation'))
    }
  }
  next()
}

// commit index write
function write (ctx, done) {
  if (ctx.root) {
    ctx.tx.commit(done)
  } else {
    // no need commit if nested tx
    done()
  }
}

Levi.fn.define('del', params('key', 'options', 'tx'), pre, del, write)
Levi.fn.define('put', params('key', 'value', 'options', 'tx'), pre, del, put, write)
Levi.fn.define('reindex', params('key', 'options'), pre, del, put, write)
Levi.fn.define('batch', params('batch', 'options'), pre, batch, write)

Levi.fn.createReadStream =
Levi.fn.readStream = function (opts) {
  return H(this.store.createReadStream(
    xtend(this.options, opts)
  ))
}

Levi.fn.createSearchStream =
Levi.fn.searchStream = function (q, opts) {
  opts = opts || {}
  var self = this
  var values = opts.values !== false
  var offset = Number(opts.offset) > 0 ? opts.offset : 0
  var limit = Number(opts.limit) > 0 ? opts.limit : Infinity

  return this.scoreStream(q, opts)
  .sortBy(function (a, b) {
    // sort by score desc
    // todo optimize this
    return b.score - a.score
  })
  .drop(offset)
  .take(limit)
  .map(H.wrapCallback(function (doc, cb) {
    if (values) {
      // fetch value if values true
      self.get(doc.key, function (err, val) {
        if (err && !err.notFound) return cb(err)
        doc.value = val
        cb(null, doc)
      })
    } else {
      cb(null, doc)
    }
  }))
  .series()
}

Levi.fn.createScoreStream =
Levi.fn.scoreStream = function (q, opts) {
  opts = xtend(this.options, opts)
  var self = this
  var fields = opts.fields || { '*': 1 }
  var N
  var query = {}

  return H(function (push, next) {
    // pipeline query
    self.pipeline(q, function (err, tokens) {
      if (err) return push(err)
      var total = tokens.length
      var counts = countTokens(tokens)
      for (var token in counts) {
        // calculate tf for query
        query[token] = counts[token] / total
      }
      // get N
      self.meta.get('size', function (err, size) {
        if (err && !err.notFound) return push(err)
        if (!size) return next(H([]))
        N = size
        next(H(Object.keys(counts)))
      })
    })
  })
  .map(function (token) {
    var idf
    var len = token.length + 1 // token! length
    var startKey = token + '!'

    var ltgtOpts = {}
    if ('gt' in opts) ltgtOpts.gt = startKey + String(opts.gt)
    else if ('gte' in opts) ltgtOpts.gte = startKey + String(opts.gte)
    else ltgtOpts.gte = startKey

    if ('lt' in opts) ltgtOpts.lt = startKey + String(opts.lt)
    else if ('lte' in opts) ltgtOpts.lte = startKey + String(opts.lte)
    else ltgtOpts.lt = startKey + END

    // scan through nt and tf of token.
    return H(function (push, next) {
      var stream = self.weight.createReadStream(ltgtOpts)
      if (
        ltgt.lowerBound(ltgtOpts) === startKey &&
        !ltgt.lowerBoundExclusive(ltgtOpts)
      ) {
        // grab nt and tf in 1 scan
        next(H(stream))
      } else {
        // custom lower bound exists, have to grab nt separately
        self.weight.get(startKey, function (err, nt) {
          if (err && !err.notFound) return push(err)
          if (nt) push(null, {key: startKey, value: nt})

          next(H(stream))
        })
      }
    })
    .map(function (data) {
      if (data.key === startKey) {
        // retrieve nt, tfidf for query
        var nt = data.value || 0
        // idf smooth
        idf = Math.log(1 + N / nt)

        // tfidf for query
        query[token] *= idf
      } else {
        // retrieve tf, tfidf with field boost for result
        // tfidf group by fields
        var tfidf = {}
        for (var field in data.value) {
          var tf = data.value[field]
          tfidf[field] = tf * idf
        }
        return {
          token: token,
          key: data.key.slice(len),
          tfidf: tfidf
        }
      }
    })
    .filter(function (data) {
      return !!data
    })
  })
  .reduce1(merge) // weight sorted by key, merge sort
  .series()
  .through(group)
  .map(function (data) {
    // tfidf group by fields, tokens
    // tfidf[field] becomes term vector
    var tfidf = {}
    var field
    for (var i = 0, l = data.length; i < l; i++) {
      var item = data[i]
      for (field in item.tfidf) {
        tfidf[field] = tfidf[field] || {}
        tfidf[field][item.token] = item.tfidf[field]
      }
    }
    var boostTotal = 0
    var score = 0
    for (field in tfidf) {
      var boost = Number(fields[field] || fields['*']) || 0
      score += similarity(query, tfidf[field]) * boost
      boostTotal += boost
    }
    if (boostTotal > 0) {
      score /= boostTotal // normalize
    } else {
      score = 0
    }
    return {
      key: data[0].key,
      score: score
    }
  })
  .filter(function (data) {
    return data.score > 0
  })
}

Levi.fn.createLiveStream =
Levi.fn.liveStream = function (q, opts) {
  opts = xtend(this.options, opts)
  var self = this
  var values = opts.values !== false
  var fields = opts.fields || { '*': 1 }

  var live = H('_write', this)
  var query = {}
  var nts = {}

  return H(function (push, next) {
    // pipeline query
    self.pipeline(q, function (err, tokens) {
      if (err) return push(err)
      var total = tokens.length
      var counts = countTokens(tokens)
      var uniqs = Object.keys(counts)
      var len = uniqs.length
      var count = 0
      for (var token in counts) {
        // calculate tf for query
        query[token] = counts[token] / total
        // cache initial nt for query
        self.weight.get(token + '!', function (e, nt) {
          count++
          if (nt) nts[token] = nt
          if (count === len) next(live)
        })
      }
    })
  })
  .map(function (data) {
    // clone query coz idfs are different on every updates
    var xquery = xtend(query)
    var field
    // tfidf group by fields, tokens
    // tfidf[field] becomes term vector
    var tfidf = {}
    for (var token in query) {
      var idf, nt
      var N = data.size
      if (token in data.nts) {
        nt = data.nts[token]
        nts[token] = nt // update cached nt
        idf = Math.log(1 + N / nt)
        for (field in data.tfs[token]) {
          var tf = data.tfs[token][field]
          tfidf[field] = tfidf[field] || {}
          tfidf[field][token] = tf * idf
        }
        xquery[token] *= idf
      } else if (token in nts) {
        // use cached nt if not exists
        nt = nts[token]
        idf = Math.log(1 + N / nt)
        xquery[token] *= idf
      } else {
        // no corpus for token
        delete xquery[token]
      }
    }

    if (!ltgt.contains(opts, data.key)) return

    var boostTotal = 0
    var score = 0
    for (field in tfidf) {
      var boost = Number(fields[field] || fields['*']) || 0
      score += similarity(xquery, tfidf[field]) * boost
      boostTotal += boost
    }
    if (boostTotal > 0) {
      score /= boostTotal // normalize
    } else {
      score = 0
    }
    return {
      key: data.key,
      score: score,
      value: values ? data.value : undefined
    }
  })
  .filter(function (data) {
    return data && data.score > 0
  })
}

Levi.destroy = function (path, cb) {
  defaults.db.destroy(path, cb || noop)
}

module.exports = Levi
