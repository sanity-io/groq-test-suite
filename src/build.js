const fs = require('fs')
const path = require('path')
const yaml = require('js-yaml')
const {promisify} = require('util')
const glob = promisify(require('glob'))
const ndjson = require('ndjson')
const crypto = require('crypto')
const {doc} = require('prettier')
const parseArgs = require('minimist')

const DEFAULT_OUTFILE = 'suite.ndjson'
const DEFAULT_BASEDIR = path.resolve(__dirname + '/../test')
const DEFAULT_PATTERN = '**/*.yml'
const DATASETS = {
  movies:
    'https://groq-test-suite.storage.googleapis.com/datasets/movies/movies-8807c4bb9fa31a9a6c21a4f7e41662d6.ndjson',
}

function sha1(s) {
  return crypto.createHash('sha1').update(s).digest('hex')
}

/**
 * Takes an object which can have array values and generates each "combination".
 *
 * eachCombination({a: [1, 2], b: [3, 4]}, ['a', 'b']) will yield [1,3], [1,4], [2,3], [2,4].
 *
 * @param {object} obj
 */
function* eachCombination(obj, keys = Object.keys(obj)) {
  let state = []

  for (;;) {
    let didAdvance = false
    let i = 0
    let alt = []

    for (let key of keys) {
      let value = obj[key]

      if (Array.isArray(value)) {
        if (!(i in state)) state.push(0)

        let current = state[i]

        if (!didAdvance) {
          state[i]++
          if (state[i] == value.length) {
            // There's no more choices here. Start again, and rather try to advance
            // the next variable.
            state[i] = 0
          } else {
            // We did successfully advance to the next alternative
            didAdvance = true
          }
        }

        i++
        alt.push(value[current])
      } else {
        alt.push(value)
      }
    }

    yield alt

    if (!didAdvance) {
      // There were no more alternatives *anywhere*
      break
    }
  }
}

/**
 * Replaces variables in a query.
 *
 * @param {string} query
 * @param {Array<string>} variables
 */
function replaceVariables(query, variables) {
  let idx = 0
  return query.replace(/~(\w+)~/g, (_, name) => {
    return variables[idx++]
  })
}

/**
 * Returns all variables used in a query.
 *
 * @param {string} query
 */
function variableKeys(query) {
  return [...query.matchAll(/~(\w+)~/g)].map((x) => x[1])
}

function containsVariables(query) {
  return /~(\w+)~/.test(query)
}

class IdGenerator {
  constructor() {
    this.used = new Set()
  }

  generate() {
    let parts = []
    for (let i = 0; i < arguments.length; i++) {
      let value = arguments[i]
      if (value == null) continue
      let sanitized = value.toLowerCase().replace(/[^a-zA-Z0-9.]+/g, '-')
      parts.push(sanitized)
    }

    let baseId = parts.join('-')
    let finalId = baseId
    let nonce = 2

    while (this.used.has(finalId)) {
      finalId = baseId + '-' + nonce
      nonce++
    }

    this.used.add(finalId)

    return finalId
  }
}

class GeneratedDataset {
  constructor() {
    this.datasetId = 'dataset-generated-' + Date.now()
    this.idGenerator = new IdGenerator()
    this.documents = []
    this.json = new Map()
  }

  /**
   * Adds a value to the generated dataset with an unique field.
   */
  addValue(v) {
    let docId = this.idGenerator.generate('d')
    let fieldId = this.idGenerator.generate('f').replace(/-/g, '_')
    this.documents.push({_id: docId, _type: "doc", [fieldId]: v})
    return {docId, fieldId}
  }

  /**
   * Attempts to parse the string as a JSON value and adds it to the dataset if it's unique.
   */
  addJSON(s) {
    if (this.json.has(s)) return this.json.get(s)

    let res
    try {
      res = this.addValue(JSON.parse(s))
    } catch (err) {
      res = null
    }

    this.json.set(s, res)
    return res
  }

  entry() {
    return {
      _id: this.datasetId,
      _type: 'dataset',
      name: 'Generated',
      url: 'generated',
      documents: this.documents,
    }
  }

  ref() {
    return {
      _type: 'reference',
      _ref: this.datasetId,
    }
  }
}

class Builder {
  constructor(emitter) {
    this.idGenerator = new IdGenerator()
    this.datasetMapping = new Map()
    this.generatedDataset = new GeneratedDataset()
    this.emit = emitter
  }

  finalize() {
    this.emit(this.generatedDataset.entry())
  }

  process(test, extra) {
    test = this.exportDocuments(test, extra)

    let hasResult = test.hasOwnProperty('result')
    let isInvalid = test.valid === false
    let hasQuery = test.query != null

    if (hasQuery && (hasResult || isInvalid)) {
      if (test.variables != null) {
        for (let expanded of this.expandQueryVariables(test)) {
          this.emitTest({...test, ...expanded}, extra)
        }
      } else if (!containsVariables(test.query)) {
        this.emitTest(test, extra)
      }
    }

    // Process children
    if (test.tests != null) {
      for (let child of test.tests) {
        let name =
          test.name != null && child.name != null
            ? test.name + ' / ' + child.name
            : child.name || test.name
        let variables =
          test.variables != null || child.variables != null
            ? Object.assign({}, test.variables, child.variables)
            : null
        this.process({...test, tests: null, ...child, name, variables}, extra)
      }
    }
  }

  emitTest(test, extra) {
    let _id = this.idGenerator.generate('test', test.name)

    let dataset = test.dataset || {
      _ref: this.createEmptyDataset(),
      _type: 'reference',
    }
    let valid = test.valid != null ? test.valid : true
    let features = test.features || []

    const params = test.params || null
    if (params != null && !(typeof params === 'object')) {
      throw new Error('Invalid parameters: ' + JSON.stringify(params))
    }

    // TODO: Do semver range format validation here
    let version = test.version
    if (version != null && typeof version !== 'string') {
      throw new Error(`[${_id}] invalid version: ${JSON.stringify(version)}`)
    }

    let entry = {
      ...test,
      _id,
      _type: 'test',
      dataset,
      name: test.name,
      query: test.query,
      result: valid ? test.result : null,
      valid,
      version,
      features,
      params,
      ...extra,
    }

    this.emit(entry)
  }

  exportDocuments(test, extra) {
    let {dataset, documents, ...rest} = test

    let datasetId

    if (documents) {
      datasetId = this.createDatasetFromDocuments(documents, extra)
    } else if (typeof dataset == 'string') {
      if (!DATASETS.hasOwnProperty(dataset)) {
        throw new Error(`[${extra.filename}] Unknown dataset: ${dataset}`)
      }
      datasetId = this.createDatasetFromURL(dataset, DATASETS[dataset])
    }

    if (datasetId != null) {
      dataset = {_ref: datasetId, _type: 'reference'}
    }

    return {dataset, ...rest}
  }

  createDatasetFromDocuments(documents, extra) {
    let _id = this.idGenerator.generate(sha1(extra.filename))
    let entry = {
      _id,
      _type: 'dataset',
      name: 'inline',
      documents,
      url: `file://${extra.filename}`,
    }

    for (let document of documents) {
      if (document["_type"] === undefined) {
        throw new Error('Document missing "_type" attribute: ' + JSON.stringify(document))
      }
    }

    this.emit(entry)
    return _id
  }

  createDatasetFromURL(name, url) {
    if (!this.datasetMapping.has(url)) {
      let _id = sha1(url)
      let entry = {
        _id,
        _type: 'dataset',
        name,
        url,
      }
      this.emit(entry)
      this.datasetMapping.set(url, _id)
    }
    return this.datasetMapping.get(url)
  }

  createEmptyDataset() {
    let url = 'about:blank'

    if (!this.datasetMapping.has(url)) {
      let _id = sha1(url)
      let entry = {
        _id,
        _type: 'dataset',
        name: 'empty',
        url,
        documents: [],
      }
      this.emit(entry)
      this.datasetMapping.set(url, _id)
    }
    return this.datasetMapping.get(url)
  }

  *expandQueryVariables({
    query,
    variables,
    result,
    dataset,
    standaloneVariables,
    genFilter = true,
    genFetch = true,
    genJoin = true,
  }) {
    let keys = variableKeys(query)

    function isStandalone(varName) {
      return standaloneVariables ? standaloneVariables.includes(varName) : true
    }

    for (let alt of eachCombination(variables, keys)) {
      yield {query: replaceVariables(query, alt), result}

      // Nothing to generate at all
      if (!(genFetch || genFilter || genJoin)) continue

      // The test depends on an explicit dataset
      if (dataset) continue

      for (let i = 0; i < keys.length; i++) {
        let key = keys[i]

        // The variable is not valid in top-level scope
        if (!isStandalone(key)) continue

        let genDoc = this.generatedDataset.addJSON(alt[i])

        // Not valid JSON
        if (!genDoc) continue

        let fetchDocQuery = `*[_id == ${JSON.stringify(genDoc.docId)}]`

        if (genFilter) {
          let genAlt = alt.slice()
          genAlt[i] = genDoc.fieldId
          let filter = replaceVariables(query, genAlt)

          {
            // Regular query
            let fullQuery = `${fetchDocQuery}[${filter}][]._id`
            let expected = result === true ? [genDoc.docId] : []

            yield {
              query: fullQuery,
              result: expected,
              dataset: this.generatedDataset.ref(),
            }
          }

          {
            // Negated query
            let fullQuery = `${fetchDocQuery}[!(${filter})][]._id`
            let expected = result === false ? [genDoc.docId] : []

            yield {
              query: fullQuery,
              result: expected,
              dataset: this.generatedDataset.ref(),
            }
          }
        }

        if (genFetch) {
          let attr = `${fetchDocQuery}[0].${genDoc.fieldId}`
          let genAlt = alt.slice()
          genAlt[i] = attr

          yield {
            query: replaceVariables(query, genAlt),
            dataset: this.generatedDataset.ref(),
          }
        }

        if (genJoin && (typeof result === 'boolean' || result === null)) {
          for (let j = i + 1; j < keys.length; j++) {
            let otherKey = keys[j]

            // The variable is not valid in top-level scope
            if (!isStandalone(otherKey)) continue

            let genDoc2 = this.generatedDataset.addJSON(alt[j])

            // Not valid JSON
            if (!genDoc2) continue

            let genAlt = alt.slice()
            genAlt[i] = `^.${genDoc.fieldId}`
            genAlt[j] = genDoc2.fieldId
            let filter = replaceVariables(query, genAlt)

            let fetchDoc2Query = `*[_id == ${JSON.stringify(genDoc2.docId)}]`
            let innerQuery = `${fetchDoc2Query}[${filter}]`
            let fullQuery = `${fetchDocQuery}{"children":${innerQuery}[]._id}`

            let innerExpeced = result === true ? [genDoc2.docId] : []
            let expected = [{children: innerExpeced}]

            yield {
              query: fullQuery,
              result: expected,
              dataset: this.generatedDataset.ref(),
            }
          }
        }
      }
    }
  }
}

async function build(baseDir, pattern, emitter) {
  let testPaths = await glob(pattern)
  let builder = new Builder(emitter)

  for (let testPath of testPaths) {
    let filename = path.relative(baseDir, testPath)
    let data = fs.readFileSync(testPath)
    let test = yaml.safeLoad(data)
    let extra = {filename}
    builder.process(test, extra)
  }

  builder.finalize()
}

async function main() {
  let argv = parseArgs(process.argv.slice(2))
  let serialize = ndjson.serialize()

  if (argv.stdout) {
    serialize.pipe(process.stdout)
  }

  let outFile = argv.out ? argv.out : DEFAULT_OUTFILE
  let outStream = fs.createWriteStream(outFile)
  serialize.pipe(outStream)

  const baseDir = argv.baseDir ? argv.baseDir : DEFAULT_BASEDIR
  const pattern = argv.pattern ? argv.pattern : DEFAULT_PATTERN

  await build(baseDir, path.join(baseDir, pattern), (entry) => {
    serialize.write(entry)
  })

  serialize.end()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
