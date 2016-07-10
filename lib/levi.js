var levelup = require('levelup')
var sublevel = require('sublevelup')
var transaction = require('level-transactions')
var ginga = require('ginga')
var H = require('highland')
var merge = require('sorted-merge-stream')
var group = require('group-stream')
var extract = require('extract-object')
var similarity = require('cosine-similarity')
var xtend = require('xtend')
var inherits = require('util').inherits
var EventEmitter = require('events').EventEmitter

var END = '\uffff'

var defaults = {
  db: require('leveldown'),
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
  // docCount: token -> nt
  // termFreq: token!key -> tf

  this.db = db
  this.store = db.sublevel('st')
  this.meta = db.sublevel('mt')
  this.tokens = db.sublevel('tk')
  this.docCount = db.sublevel('nt')
  this.termFreq = db.sublevel('tf')

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

function objectize (arr, val) {
  if (!Array.isArray(arr)) return arr
  var obj = {}
  arr.forEach(function (key) {
    obj[key] = val
  })
  return obj
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
  var self = this
  this.get(key, options, function (e, val) {
    val = (val || 0) + 1
    self.put(key, val, options)
    if (cb) cb(null, val)
  })
}
// transaction decrement
function decr (key, options, cb) {
  var self = this
  this.get(key, options, function (e, val) {
    val = (val || 0) - 1
    if (val === 0) self.del(key, options)
    else self.put(key, val, options)
    if (cb) cb(null, val)
  })
}

function pre (ctx, next) {
  ctx.options = xtend(this.options, ctx.options)

  if (ctx.options.transaction) {
    ctx.tx = ctx.options.transaction
    // nested transaction
    ctx.root = false
    if (!(ctx.tx instanceof transaction)) {
      return next('Invalid transaction instance.')
    }
  } else {
    // root transaction
    ctx.root = true
    ctx.tx = transaction(this.store)
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
  ctx.tx.get(ctx.key, { prefix: self.store }, function (err, value) {
    if (err && !err.notFound) return next(err)
    // skip if not exists
    if (!value) return next()
    // keep value if reindexing
    if (!ctx.value) ctx.value = value
    // del store item
    ctx.tx.del(ctx.key, { prefix: self.store })
    // decrement size
    decr.call(ctx.tx, 'size', { prefix: self.meta })
    // delete all tfs that contains key
    ctx.tx.get(ctx.key, { prefix: self.tokens }, function (err, tokens) {
      if (err) return next(err)
      // can set unsafe since size is locked
      tokens.forEach(function (token) {
        // decrement nt
        decr.call(ctx.tx, token, { prefix: self.docCount, unsafe: true })
        // del tf
        ctx.tx.del(token + '!' + ctx.key, { prefix: self.termFreq, unsafe: true })
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
  ctx.tx.on('end', function (err) {
    if (err) return
    self.emit('put', { key: ctx.key, value: ctx.value })
  })

  // increment size
  incr.call(ctx.tx, 'size', { prefix: self.meta })

  var value
  if (typeof ctx.value === 'string' || Array.isArray(ctx.value)) {
    // string means no field boost
    value = { '*': ctx.value }
  } else {
    value = ctx.value
  }

  var tfs = {}
  // init tf all fields zero
  var tfInit = {}
  var fieldsOpts = objectize(ctx.options.fields || ['*'], true)
  var fields = []
  for (var field in value) {
    if (
      value.hasOwnProperty(field) &&
      (fieldsOpts[field] || fieldsOpts['*'])
    ) {
      tfInit[field] = 0
      fields.push(field)
    }
  }

  fields.forEach(function (field) {
    ctx.tx.defer(function (cb) {
      self.pipeline(value[field], field, function (err, tokens) {
        if (err) return cb(err)
        var total = tokens.length
        var counts = countTokens(tokens)
        for (var token in counts) {
          tfs[token] = tfs[token] || xtend(tfInit)
          tfs[token][field] = counts[token] / total
        }
        cb()
      })
    })
  })
  ctx.tx.defer(function (cb) {
    // put store item
    ctx.tx.put(ctx.key, ctx.value, { prefix: self.store })

    // can set unsafe since size is locked
    var uniqs = Object.keys(tfs)
    uniqs.forEach(function (token) {
      // increment nt
      incr.call(ctx.tx, token, { prefix: self.docCount, unsafe: true })
      // put tf object
      ctx.tx.put(token + '!' + ctx.key, tfs[token], {
        prefix: self.termFreq, unsafe: true
      })
    })
    // put tokens
    ctx.tx.put(ctx.key, uniqs, { prefix: self.tokens, unsafe: true })

    cb()
  })

  next()
}

function batch (ctx, next) {
  for (var i = 0, l = ctx.batch.length; i < l; i++) {
    var op = xtend(ctx.batch[i], {
      transaction: ctx.tx
    })
    if (op.type === 'put') {
      this.put(op.key, op.value, op)
    } else if (op.type === 'del') {
      this.del(op.key, op)
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

Levi.fn.define('del', params('key', 'options'), pre, del, write)
Levi.fn.define('put', params('key', 'value', 'options'), pre, del, put, write)
Levi.fn.define('reindex', params('key', 'options'), pre, del, put, write)
Levi.fn.define('batch', params('batch', 'options'), pre, batch, write)

Levi.fn.createReadStream =
Levi.fn.readStream = function (opts) {
  return H(this.store.createReadStream(
    xtend(this.options, opts)
  ))
}

Levi.fn.createTermStream =
Levi.fn.termStream = function (o) {
  var opts = { limit: o.limit }
  if (o.prefix) {
    opts.gt = '@' + o.prefix
    opts.lt = '@' + o.prefix + END
  }
  return H(this.docCount.createReadStream(opts))
}

Levi.fn.createSearchStream =
Levi.fn.searchStream = function (q, opts) {
  opts = opts || {}
  var self = this
  var offset = Number(opts.offset) > 0 ? opts.offset : 0
  var limit = Number(opts.limit) > 0 ? opts.limit : Infinity

  return this.scoreStream(q, opts)
  .sortBy(function (a, b) {
    // sort by score desc
    return b.score - a.score
  })
  .drop(offset)
  .take(limit)
  .flatMap(H.wrapCallback(function (doc, cb) {
    self.get(doc.key, function (err, val) {
      if (err && !err.notFound) return cb(err)
      doc.value = val
      cb(null, doc)
    })
  }))
}

Levi.fn.createScoreStream =
Levi.fn.scoreStream = function (q, opts) {
  opts = xtend(this.options, opts)
  var self = this
  var fieldsOpts = objectize(opts.fields || ['*'], 1)
  var N
  var query = {}

  return H(function (push, next) {
    // pipeline query
    self.pipeline(q, function (err, tokens) {
      if (err) return push(err)
      var total = tokens.length
      var counts = countTokens(tokens)

      // get doc count for each token
      var stream = H(Object.keys(counts))
      .flatMap(H.wrapCallback(function (token, cb) {
        self.docCount.get(token, function (err, nt) {
          if (err && !err.notFound) return cb(err)
          if (!nt) return cb(null, null)

          // calculate tf for query if token exists
          query[token] = counts[token] / total
          cb(null, {key: token, value: nt})
        })
      }))
      .filter(function (data) {
        return !!data
      })

      // expansions for last token
      if (tokens.length && opts.expansions) {
        var expansions = self.termStream({
          prefix: tokens[tokens.length - 1],
          limit: opts.expansions
        })
        .map(function (data) {
          // treat token count as 1
          query[data.key] = (1 + (counts[data.key] || 0)) / total
          return data
        })
        // combine expansion into stream
        stream = H([stream, expansions]).series()
      }

      // get N
      self.meta.get('size', function (err, size) {
        if (err && !err.notFound) return push(err)
        if (!size) return next(H([]))
        N = size
        next(stream)
      })
    })
  })
  .map(function (data) {
    var token = data.key
    var nt = data.value

    // idf smooth
    var idf = Math.log(1 + N / nt)
    // tfidf for query
    query[token] *= idf

    var len = token.length + 1 // token! length
    var startKey = token + '!'
    var ltgtOpts = {}
    if ('gt' in opts) ltgtOpts.gt = startKey + String(opts.gt)
    else if ('gte' in opts) ltgtOpts.gte = startKey + String(opts.gte)
    else ltgtOpts.gt = startKey

    if ('lt' in opts) ltgtOpts.lt = startKey + String(opts.lt)
    else if ('lte' in opts) ltgtOpts.lte = startKey + String(opts.lte)
    else ltgtOpts.lt = startKey + END

    // scan through nt and tf of token.
    return H(self.termFreq.createReadStream(ltgtOpts))
    .map(function (data) {
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
    })
  })
  .reduce1(merge) // weight sorted by key, merge sort
  .flatMap(H)
  .through(group())
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
      var boost = Number(fieldsOpts[field] || fieldsOpts['*']) || 0
      if (boost) {
        score += similarity(query, tfidf[field]) * boost
        boostTotal += boost
      }
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

ginga(Levi)

Levi.define('destroy', params('path'), function (ctx, done) {
  defaults.db.destroy(ctx.path, done)
})

module.exports = Levi
