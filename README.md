# Levi

Streaming text search for Node.js and browsers. Using LevelDB as storage backend.

Levi heavily inspired from [lunr.js](http://lunrjs.com/). 
But instead of synchronous in-memory store, Levi leverages [LevelUP](https://github.com/Level/levelup) for asynchronous, durable storage interface.
By default, Levi uses [LevelDB](https://github.com/Level/leveldown) on Node.js and IndexedDB on browser. 
Also works with a variety of LevelDOWN compatible backends.

Levi search interface is built on [Highland](http://highlandjs.org/), a Node compatible stream with async and functional concepts. 
Stream avoid processing whole batch of data in one go, 
Levi is designed to be non-blocking and memory efficient.

### levi(dir, opts)
### levi(sublevel, opts)

```js
var lv = levi('db', {
  fields: {
    title: 1,
    body: 1,
    tags: 10
  }
})
.use(levi.tokenizer())
.use(levi.stemmer())
.use(levi.stopword())
```

Levi provides text processing pipeline: Tokenizer, Porter Stemmer, and English Stopwords Filter. These are exposed as plugins so that they can be swapped for different configurations.

### .put(key, value, [opts])
### .del(key, [opts])

### .searchStream(query, [opts])

* TF-IDF
* Cosine similarity

### .liveStream(query, [opts])

`liveStream()` approximates score for live incoming results. This is done based on the evaluation of 
[TF-ICF: A New Term Weighting Scheme for Clustering Dynamic Data Streams](http://cda.ornl.gov/publications/ICMLA06.pdf), 
where TC-ICF approximate TF-IDF score based on corpus already have.
The score can be relatively accurate to TF-IDF when the corpus size is large. 
This a very preferable for live changing data feeds since TF-ICF is
O(n) plus `liveStream()` does not require database scans, 
which means significantly faster processing.
