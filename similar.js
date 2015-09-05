// calculate similarity
// i.e. cosine between two object vectors

function dot (a, b) {
  var sum = 0
  for (var key in a) {
    if (key in b) sum += a[key] * b[key]
  }
  return sum
}

module.exports = function similar (a, b) {
  return dot(a, b) / (Math.sqrt(dot(a, a)) * Math.sqrt(dot(b, b)))
}
