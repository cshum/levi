# Levi

Streaming full-text search for Node.js and browsers. Using LevelDB as storage backend.

[![Build Status](https://travis-ci.org/cshum/levi.svg?branch=master)](https://travis-ci.org/cshum/levi)

```
npm install levi
```

Full-text search using TF-IDF and cosine similarity. 
Stream based query mechanism plus query-time field boost options. 
Provided with configurable text processing pipeline: Tokenizer, Porter Stemmer and Stopwords filter.

Levi is built on [LevelUP](https://github.com/Level/levelup) - a fast, asynchronous, 
[transactional](https://github.com/cshum/level-transactions/) storage interface.
By default, it uses [LevelDB](https://github.com/Level/leveldown) on Node.js and [IndexedDB](https://github.com/maxogden/level.js) on browser. 
Also works with a variety of LevelDOWN compatible backends.

In addition, Levi provides relevancy scoring for live changing data using [TF-ICF](http://cda.ornl.gov/publications/ICMLA06.pdf) - a TF-IDF approximation based on existing corpus.
Such scoring matches comparably close to TF-IDF when existing corpus is sufficiently large,
with significantly better performance O(N) instead of O(N^2).

## API

### levi(path, [options])
### levi(sublevel, [options])

Create a new Levi instance with [LevelUP](https://github.com/Level/levelup#ctor) database path,
or a section of [SublevelUP](https://github.com/cshum/sublevelup).

```js
var levi = require('levi')

// levi instance of database path `db`
var lv = levi('db') 
.use(levi.tokenizer())
.use(levi.stemmer())
.use(levi.stopword())

```

Text processing pipeline `levi.tokenizer()`, `levi.stemmer()`, `levi.stopword()` are required for indexing.
These are exposed as [ginga](https://github.com/cshum/ginga) plugins so that they can be swapped for different language configurations.

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
Fetch value from the store. Works exactly like LevelUP's [`get()`](https://github.com/Level/levelup#get)

### .readStream([options])
Obtain a ReadStream of documents, lexicographically sorted by key.
Works exactly like LevelUP's [`readStream()`](https://github.com/Level/levelup#dbcreatereadstreamoptions)

### .searchStream(query, [options])
The main search interface of Levi is a Node compatible [highland](http://highlandjs.org/) object stream.
`query` can be a string or object fields. 

Accepts following `options`:
* `fields` object, default scoring every fields by default. Set fields for controlling relevancy by
  * `'*': true`: * any fields, true is identical to 1
  * `field: boost`: number for multiplying scoring factor of a field.
* `values` boolean, default true. Set to false to omit attaching document value for faster query performance.
* `offset` number, offset results. Default 0.
* `limit` number, limit number of results. Default infinity.

A "more like this" query can be done by searching the document itself.

```js
lv.searchStream('lorem ipsum').toArray(function (results) { ... }) // highland method

lv.searchStream('lorem ipsum', {
  fields: { title: 10, '*': 1 } // title field boost
}).pipe(...)

lv.searchStream('lorem ipusm', {
  fields: { title: true }, // title only
  values: false // omit value
}).pipe(...)

// search with object
lv.searchStream({ 
  title: 'Lorem Ipsum',
  body: 'Dummy text of the printing and typesetting industry.'
}).pipe(...)

```

result is of form

```js
{
  key: 'b',
  score: 0.5972843431749838,
  value: { 
    id: 'b',
    title: 'Lorem Ipsum',
    body: 'Dummy text of the printing and typesetting industry.'
  } 
}
```

### .liveStream(query, [options])

Approximate relevancy score as soon as documents being indexed. 
A never-ending [highland](http://highlandjs.org/) object stream.

This should be used only when having sufficiently large amount of indexed documents, as relevancy score may be fluctuating at the beginning.
But very preferable for large amount of live streaming data since `liveStream()` requires almost no database scans, which means significantly faster processing.

## License

MIT
