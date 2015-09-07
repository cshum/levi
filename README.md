# Levi

Streaming full-text search for Node.js and browsers. Using LevelDB as storage backend.

```
npm install levi
```

Full-text search using TF-IDF and cosine similarity. 
Stream based query mechanism plus query-time field boost options. 
Provided with configurable text processing pipeline: Tokenizer, Stemmer, and Stopwords filter.

Levi is built on [LevelUP](https://github.com/Level/levelup) - a fast, asynchronous, 
[transactional](https://github.com/cshum/level-transactions/) storage interface.
By default, it uses [LevelDB](https://github.com/Level/leveldown) on Node.js and [IndexedDB](https://github.com/maxogden/level.js) on browser. 
Also works with a variety of LevelDOWN compatible backends.

In addition, Levi provides relevancy scoring for live changing data using [TF-ICF](http://cda.ornl.gov/publications/ICMLA06.pdf) - a TF-IDF approximation based on existing corpus.
Such scoring matches comparably close to TF-IDF when existing corpus is sufficiently large,
and with significantly better performance O(N) instead of O(N^2).

## API

### levi(path, [options])
### levi(sublevel, [options])

Create a new Levi instance with [LevelUP](https://github.com/Level/levelup#ctor) database path.

```js
var levi = require('levi')

// passing db location
var lv = levi('db') 
.use(levi.tokenizer())
.use(levi.stemmer())
.use(levi.stopword())

```
alternatively passing a section of [SublevelUP](https://github.com/cshum/sublevelup).

```js
var sublevel = require('sublevelup')
var db = sublevel(levelup('db'))

// passing db section `levi`
var lv = levi(db.sublevel('levi'))
.use(levi.tokenizer())
.use(levi.stemmer())
.use(levi.stopword())

```

Text processing pipeline `levi.tokenizer()`, `levi.stemmer()`, `levi.stopword()` are required for indexing.
These are exposed as plugins so that they can be swapped for different language configurations.

### .put(key, value, [options], [callback])

Index document identified by `key`. `value` can be object or string.
Use object fields for `value` if you want field boost options for search.

```js
// string as value
lv.put('a', 'Lorem Ipsum is simply dummy text.', function (err) { ... })

// object fields as value
lv.put('b', {
  id: 'b',
  title: 'Lorem Ipsum',
  body: 'Dummy text of the printing and typesetting industry.'
}, function (err) { ... })
```

### .del(key, [options], [callback])
Delete document `key` from index.

### .get(key, [options], [callback])
Fetch value from the store. Behaves exactly like LevelUP's [`get()`](https://github.com/Level/levelup#get)

### .searchStream(query, [options])
The main search interface of Levi, a Node compatible [highland](http://highlandjs.org/) stream.
`query` can be a string or tokenized array.

#### options

```js
lv.searchStream('lorem ipsum')
.toArray(function (results) { ... }) // highland method

lv.searchStream('lorem ipsum', {
  fields: { title: 10, '*': 1 } // title field boost
}).pipe(...)

lv.searchStream('lorem ipusm', {
  fields: { title: true }, // title only
  values: false // omit value
}).pipe(...)
```

### .liveStream(query, [options])

Approximates relevancy score as soon as documents being indexed. 
This a very preferable for live changing data since this requires very little database scans, 
which means significantly faster processing.

## License

MIT
