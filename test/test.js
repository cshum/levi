require('rimraf').sync('./test/db')
var levi = require('../')

var test = require('tape')
var levelup = require('levelup')
var down = require('jsondown')
// var down = require('leveldown')
var db = levelup('./test/db', { db: down })
var H = require('highland')

var lv = levi(db)
  .use(levi.tokenizer())
  .use(levi.stemmer())
  .use(levi.stopword())

test('put', function (t) {
  var aObj = {
    a: 'hello world',
    b: 'the world sucks'
  }
  lv.put('a', aObj, {
    fields: {a: 2, b: 1}
  }, function () {
    lv.get('a', function (err, value) {
      t.notOk(err)
      t.deepEqual(value, aObj, 'fielded object')
    })
  })
  var bText = 'Lorem Ipsum sucks text of the printing and typesetting industry.'
  lv.put('b', new Buffer(bText), function () {
    lv.get('b', function (err, value) {
      t.notOk(err)
      t.equal(value, bText, 'put buffer')
      t.equal(typeof value, 'string', 'buffer converted to string')
    })
  })
  var cText = 'Aldus PageMaker including versions of Lorem Ipsum.'
  lv.put('c', cText, function () {
    lv.get('c', function (err, value) {
      t.notOk(err)
      t.equal(value, cText, 'put string')
      lv.meta.get('size', function (err, size) {
        t.notOk(err)
        t.equal(size, 3, 'size correct')
        t.end()
      })
    })
  })
})

test('del', function (t) {
  lv.del('a')
  lv.del('b')
  lv.del('c', function (err) {
    t.notOk(err)
    lv.meta.get('size', function (err, size) {
      t.notOk(err && !err.notFound)
      t.notOk(size, 'empty after delete all')
      H(db.readStream()).toArray(function (arr) {
        t.equal(arr.length, 0, 'empty after delete all')
        t.end()
      })
    })
  })
})

// test data from https://github.com/olivernn/lunr.js/blob/master/test/search_test.js
test('Search', function (t) {
  H([{
    id: 'a',
    title: 'Mr. Green kills Colonel Mustard',
    body: 'Mr. Green killed Colonel Mustard in the study with the candlestick. Mr. Green is not a very nice fellow.'
  }, {
    id: 'b',
    title: 'Plumb waters plant',
    body: 'Professor Plumb has a green plant in his study'
  }, {
    id: 'c',
    title: 'Scarlett helps Professor',
    body: 'Miss Scarlett watered Professor Plumbs green plant while he was away from his office last week.'
  }, {
    id: 'd',
    title: 'title',
    body: 'handsome'
  }, {
    id: 'e',
    title: 'title',
    body: 'hand'
  }])
  .map(H.wrapCallback(function (doc, cb) {
    lv.put(doc.id, doc, { fields: { title: 10, body: 1 } }, cb)
  }))
  .series()
  .done(function () {
    lv.searchStream('green plant').toArray(function (arr) {
      console.log(arr)
      t.equal(arr.length, 2, 'correct result')
      t.equal(arr[0].id, 'b', 'correct result')
    })

  })
})
