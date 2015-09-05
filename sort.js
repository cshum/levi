var H = require('highland')
var iterate = require('stream-iterate')

// Stream merge sort modified from
// https://github.com/mafintosh/stream-iterate/blob/master/test.js

function toKey (val) {
  return val[0].key
}

module.exports = function (streamA, streamB) {
  var readA = iterate(streamA)
  var readB = iterate(streamB)

  return H(function (push, next) {
    readA(function (err, dataA, nextA) {
      if (err) return push(err)
      readB(function (err, dataB, nextB) {
        if (err) return push(err)

        if (!dataA && !dataB) return push(null, H.nil)

        if (!dataB || dataA < dataB) {
          push(null, dataA)
          nextA()
          return next()
        }

        if (!dataA || dataA > dataB) {
          push(null, dataB)
          nextB()
          return next()
        }

        push(null, dataA)
        push(null, dataB)
        nextA()
        nextB()
        next()
      })
    })
  })
}
