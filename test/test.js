var test = require('tape')

var levi = require('../')
var similarity = require('../lib/util/similarity')
var H = require('highland')

var lv
test('clean up', function (t) {
  levi.destroy('./test/db', function (err) {
    t.notOk(err, 'destroy')

    lv = levi('./test/db')
    .use(levi.tokenizer())
    .use(levi.stemmer())
    .use(levi.stopword())

    t.end()
  })
})

test('pipeline', function (t) {
  t.plan(7)

  lv.pipeline('including a foo !a!b!c! of instanceof constructor.', function (err, tokens) {
    t.notOk(err)
    t.deepEqual(tokens, [
      'includ', 'foo', 'abc', 'instanceof', 'constructor'
    ], 'stemmer, stopwords, js reserved words')
    lv.pipeline(tokens, function (err, tokens2) {
      t.notOk(err)
      t.deepEqual(tokens, tokens2, 'idempotent')
    })
  })

  lv.pipeline({
    a: 'foo bar',
    c: ['hello'],
    d: { asdf: { ghjk: 'world' } },
    e: 167,
    f: null
  }, function (err, tokens) {
    t.notOk(err)
    t.deepEqual(tokens, [
      'foo', 'bar', 'hello', 'world'
    ], 'text extraction from object')
  })

  var cyclic = { a: 'foo', b: { asdf: 'bar' } }
  cyclic.b.boom = cyclic
  lv.pipeline(cyclic, function (err) {
    t.equal(err.message, 'Cycle detected')
  })
})

test('similarity', function (t) {
  t.equal(Math.round(similarity(
    {x: 1, y: 3, z: -5, foo: 0},
    {x: 4, y: -2, z: -1}
  ) * 1000) / 1000, 0.111, 'cosine similarity')

  t.equal(similarity(
    {x: 1, y: 3, z: -5},
    {x: 0, y: 0, z: 0}
  ), 0, 'zero magitude vector')

  t.end()
})

test('CRUD', function (t) {
  var aObj = {
    a: 'hello world'
  }
  lv.put('a', aObj, function () {
    lv.get('a', function (err, value) {
      t.notOk(err)
      t.deepEqual(value, aObj, 'put object')
    })
  })

  var bText = 'Lorem Ipsum is simply dummy text of the printing and typesetting industry.'
  lv.put('b', new Buffer(bText), function () {
    lv.get('b', function (err, value) {
      t.notOk(err)
      t.equal(value, bText, 'put buffer')
      t.equal(typeof value, 'string', 'buffer converted to string')
    })
  })

  var ar = ['hello', 'printing', 'a']
  var cText = 'Aldus PageMaker including versions of Lorem Ipsum.'

  lv.batch([
    {type: 'put', key: 'ar', value: ar},
    {type: 'put', key: 'c', value: cText},
    {type: 'del', key: 'ar'},
    {type: 'del', key: 'c'},
    {type: 'put', key: 'ar', value: ar}, // repeated put
    {type: 'put', key: 'c', value: cText},
    {type: 'put', key: 'ar', value: ar},
    {type: 'put', key: 'c', value: cText}
  ], function (err) {
    t.notOk(err, 'batch put')
    lv.get('ar', function (err, value) {
      t.notOk(err)
      t.deepEqual(value, ar, 'put array')
    })
    lv.get('c', function (err, value) {
      t.notOk(err)
      t.equal(value, cText, 'put string')
    })
  })

  for (var i = 0; i < 10; i++) {
    lv.batch([
      {type: 'put', key: 'on99' + i, value: 'on99'},
      {type: 'put', key: 'abc'}, // error
      {type: 'del', key: '168'}
    ], function (err) {
      t.ok(err)
      lv.get('on99' + i, function (err, val) {
        t.notOk(val, 'err not comitted')
        t.ok(err.notFound, 'err not comitted')
      })
    })
  }

  lv.put('d', 'Rick rolling', function (err) {
    t.notOk(err)
    lv.searchStream('rolling and hatin').toArray(function (arr) {
      t.equal(arr.length, 1, 'correct put')
      t.equal(arr[0].key, 'd', 'correct put')
      t.equal(arr[0].value, 'Rick rolling', 'correct put')
      lv.put('d', 'Rick Ashley', function (err) {
        t.notOk(err)
        lv.searchStream('rolling').toArray(function (arr) {
          t.equal(arr.length, 0, 'correct clean up')
          lv.searchStream('ashley').toArray(function (arr) {
            t.equal(arr.length, 1, 'correct upsert')
            t.equal(arr[0].key, 'd', 'correct upsert')
            t.equal(arr[0].value, 'Rick Ashley', 'correct upsert')

            lv.meta.get('size', function (err, size) {
              t.notOk(err)
              t.equal(size, 5, 'size correct')

              lv.del('c')
              lv.del('d')
              lv.batch([
                {type: 'del', key: 'a'},
                {type: 'del', key: 'ar'},
                {type: 'del', key: 'b'},
                {type: 'del', key: 'a'},
                {type: 'del', key: 'ar'},
                {type: 'del', key: 'b'},
                {type: 'del', key: 'a'}, // repeated delete
                {type: 'del', key: 'ar'},
                {type: 'del', key: 'b'}
              ], function (err) {
                t.notOk(err)
                lv.meta.get('size', function (err, size) {
                  t.notOk(err && !err.notFound)
                  t.notOk(size, 'empty after delete all')
                  t.end()
                })
              })
            })
          })
        })
      })
    })
  })
})

test('Search options', function (t) {
  t.plan(29)

  var live = lv.liveStream('green plant')
  var liveM = lv.liveStream('green plant asdf')
  var liveGt = lv.liveStream('green plant', { gt: 'b' })
  var live2 = lv.searchStream('watering plant', { fields: { title: 1, body: 10 } })
  var live2Lt = lv.liveStream('watering plant', { fields: { title: 1, body: 10 }, lt: 'c' })
  var live3 = lv.searchStream({
    title: 'Professor Plumb loves plant',
    message: 'He has a green plant in his study'
  })

  var list = [{
    id: 'a',
    title: 'Mr. Green kills Colonel Mustard',
    body: 'Mr. Green killed Colonel Mustard in the study with the candlestick. ' +
      'Mr. Green is not a very nice fellow.'
  }, {
    id: 'b',
    title: 'Plumb waters plant',
    body: 'Professor Plumb has a green plant in his study'
  }, {
    id: 'c',
    title: 'Scarlett helps Professor',
    body: 'Miss Scarlett watered Professor Plumbs green plant while he was away ' +
      'from his office last week.'
  }, {
    id: 'd',
    title: 'foo',
    body: 'bar'
  }]

  lv.batch(list.map(function (doc) {
    return {type: 'put', key: doc.id, value: doc}
  }), function () {
    lv.readStream({gt: 'a'}).pluck('value').toArray(function (arr) {
      t.deepEqual(arr, list.slice(1), 'readStream')
    })

    lv.searchStream('green plant').toArray(function (arr) {
      t.equal(arr.length, 3, 'search: correct number of results')
      t.equal(arr[0].key, 'b', 'search: correct score')

      lv.searchStream(['green', 'plant']).toArray(function (arr2) {
        t.deepEqual(arr2, arr, 'tokenized query')
      })

      lv.searchStream('green plant', { values: false }).toArray(function (arr) {
        t.notOk(arr[0].value, 'values: false')
      })

      lv.searchStream('green plant', { offset: 1 }).toArray(function (arr2) {
        t.deepEqual(arr2, arr.slice(1), 'query offset')
      })

      lv.searchStream('green plant', { limit: 1 }).toArray(function (arr2) {
        t.deepEqual(arr2, arr.slice(0, 1), 'limit')
      })

      live.take(3).last().pull(function (err, res) {
        t.notOk(err)
        t.equal(res.score, arr[2].score,
          'live: last score identical to search score')
      })

    })

    liveM.pluck('key').take(3).toArray(function (arr) {
      t.deepEqual(arr, ['a', 'b', 'c'], 'liveStream with missing idf')
    })

    lv.scoreStream('green plant').pluck('key').toArray(function (arr) {
      t.deepEqual(arr, ['a', 'b', 'c'], 'scoreStream')
    })

    lv.searchStream('green plant', { gt: 'b' }).toArray(function (arr) {
      t.equal(arr.length, 1, 'gt correct # of result')
      t.equal(arr[0].key, 'c', 'gt correct first result')
      liveGt.take(1).last().pull(function (err, res) {
        t.notOk(err)
        t.equal(res.score, arr[0].score, 'live: last score identical to search gt score')
      })
    })

    lv.searchStream('green', { fields: { title: true } }).toArray(function (arr) {
      t.equal(arr.length, 1, 'fielded: correct number of results')
      t.equal(arr[0].key, 'a', 'fielded: correct result')
    })

    lv.searchStream('watering plant', { fields: { title: 1, body: 10 } }).toArray(function (arr) {
      t.equal(arr.length, 2, 'field boosting: correct number of results')
      t.equal(arr[0].key, 'c', 'field boosting: correct boosted result')

      live2.take(2).last().pull(function (err, res) {
        t.notOk(err)
        t.equal(res.score, arr[1].score,
          'live: last score identical to search score')
      })
    })

    lv.searchStream('watering plant', { fields: { title: 1, body: 10 }, lt: 'c' }).toArray(function (arr) {
      t.equal(arr.length, 1, 'upper bound: correct number of results')
      t.equal(arr[0].key, 'b', 'upper bound: correct boosted result')

      live2Lt.take(1).last().pull(function (err, res) {
        t.notOk(err)
        t.equal(res.score, arr[0].score,
          'upper bound: last score identical to search score')
      })
    })

    lv.searchStream({
      title: 'Professor Plumb loves plant',
      message: 'He has a green plant in his study'
    }).toArray(function (arr) {
      t.equal(arr.length, 3, 'object search: correct number of results')
      H(arr).pluck('key').toArray(function (arr) {
        t.deepEqual(arr, ['b', 'c', 'a'], 'object search: correct order')
      })
      live3.take(3).last().pull(function (err, res) {
        t.notOk(err)
        t.equal(res.score, arr[2].score,
          'live: last score identical to search score')
      })
    })
  })
})
