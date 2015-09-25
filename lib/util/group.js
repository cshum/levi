var H = require('highland')

// concat data with same key into an array

module.exports = function (s) {
  var key, stack
  return H(function (push, next) {
    s.pull(function (err, x) {
      if (err) return push(err)
      if (x === H.nil) {
        if (stack && stack.length > 0) push(null, stack)
        push(null, H.nil)
      } else {
        if (x.key === key) {
          stack.push(x)
        } else {
          if (stack && stack.length > 0) push(null, stack)
          stack = [x]
          key = x.key
        }
        next()
      }
    })
  })
}
