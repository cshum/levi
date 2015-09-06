require('rimraf').sync('./test/db')
var levi = require('../')

var sublevel = require('sublevelup')
var levelup = require('levelup')
var test = require('tape')
var down = require('jsondown')
var db = sublevel(levelup('./test/db', { db: down }))
var H = require('highland')

// var down = require('leveldown')
function factory (name) {
  return levi(db.sublevel(name), { db: down })
    .use(levi.tokenizer())
    .use(levi.stemmer())
    .use(levi.stopword())
}

(function (lv) {
  test('PUT', function (t) {
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

  test('DEL', function (t) {
    lv.del('a')
    lv.del('b')
    lv.del('c', function (err) {
      t.notOk(err)
      lv.meta.get('size', function (err, size) {
        t.notOk(err && !err.notFound)
        t.notOk(size, 'empty after delete all')
        H(db.createReadStream({
          gt: '!crud',
          lt: '!crud~'
        }))
        .toArray(function (arr) {
          t.notOk(arr.length, 'empty after delete all')
          t.end()
        })
      })
    })
  })

})(factory('crud'))

/*
test('Search', function (t) {
  live
  .each(console.log.bind(console, 'live'))

  lv
  .searchStream('hello lorem sucks')
  .each(console.log.bind(console, 'search'))
})
*/
