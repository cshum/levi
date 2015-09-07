// cosine similarity between two object vectors

function dot (a, b) {
  var sum = 0
  for (var key in a) {
    if (key in b) sum += a[key] * b[key]
  }
  return sum
}

module.exports = function similarity (a, b) {
  var magA = Math.sqrt(dot(a, a))
  var magB = Math.sqrt(dot(b, b))
  if (magA && magB) return dot(a, b) / (magA * magB)
  else return 0
}
