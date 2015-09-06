# Levi

Streaming text search for Node.js and browsers. Using LevelDB as storage backend.

Levi heavily inspired from [lunr.js](http://lunrjs.com/). 
But instead of synchronous in-memory store, Levi leverages [LevelUP](https://github.com/Level/levelup) for asynchronous, 
[transactional](https://github.com/cshum/level-transactions/) storage interface.
By default, Levi uses [LevelDB](https://github.com/Level/leveldown) on Node.js and IndexedDB on browser. 
Also works with a variety of LevelDOWN compatible backends.

Levi search interface is built on [Highland](http://highlandjs.org/), a Node compatible stream with async and functional programming concepts. 
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

Levi provides text processing pipeline: Tokenizer, Porter Stemmer, and English Stopwords Filter. These are exposed as [Ginga](https://github.com/cshum/ginga) plugins so that they can be swapped for different configurations.

### .put(key, value, [opts])
### .del(key, [opts])

### .searchStream(query, [opts])

* TF-IDF
* Cosine similarity

### .liveStream(query, [opts])

`liveStream()` approximates relevancy score for live incoming results. 
This is done using TF-ICF - TF-IDF approximation based on the already existing corpus.
From the evaluation of 
[TF-ICF: A New Term Weighting Scheme for Clustering Dynamic Data Streams](http://cda.ornl.gov/publications/ICMLA06.pdf), 
such score can be relatively accurate to TF-IDF when the corpus 
is sufficiently large and diverse.
This a very preferable for live changing data feeds since `liveStream()` does not require database scans, 
which means significantly faster processing.
