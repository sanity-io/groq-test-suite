const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const {promisify} = require('util');
const glob = promisify(require('glob'));
const ndjson = require('ndjson');
const crypto = require('crypto');

const DATASETS = {
  movies: 'https://groq-test-suite.storage.googleapis.com/datasets/movies/movies-f6fd5605328d7e1d6c667addc455aff2.ndjson'
}

function sha1(s) {
  return crypto.createHash('sha1').update(s).digest('hex')
}

function* expandQueryVariables(query, variables) {
  let state = []
  let isDone = false

  while (!isDone) {
    let didAdvance = false
    let i = 0

    let fullQuery = query.replace(/~(\w+)~/g, (_, name) => {
      if (!variables.hasOwnProperty(name)) {
        throw new Error(`Template variable '${name}' is missing`);
      }

      let value = variables[name]

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
        return value[current]
      } else {
        return value
      }
    });

    yield fullQuery

    if (!didAdvance) {
      // There were no more alternatives *anywhere*
      break
    }
  }
}

function containsVariables(query) {
  return /~(\w+)~/.test(query)
}

class IdGenerator {
  constructor() {
    this.used = new Set();
  }

  generate() {
    let parts = [];
    for (let i = 0; i < arguments.length; i++) {
      let value = arguments[i];
      if (value == null) continue;
      let sanitized = value.toLowerCase().replace(/[^a-zA-Z0-9.]+/g, "-");
      parts.push(sanitized);
    }

    let baseId = parts.join(".");
    let finalId = baseId;
    let nonce = 2;

    while (this.used.has(finalId)) {
      finalId = baseId + "." + nonce;
      nonce++;
    }

    this.used.add(finalId);

    return finalId;
  }
}

class Builder {
  constructor(emitter) {
    this.idGenerator = new IdGenerator();
    this.datasetMapping = new Map();
    this.emit = emitter;
  }

  process(test, extra) {
    test = this.exportDocuments(test, extra);

    let hasResult = test.hasOwnProperty('result')
    let hasQuery = test.query != null

    if (hasResult && hasQuery) {
      if (test.variables != null) {
        for (let query of expandQueryVariables(test.query, test.variables)) {
          this.emitTest(test, query, extra)
        }
      } else if (!containsVariables(test.query)) {
        this.emitTest(test, test.query, extra)
      }
    }

    // Process children
    if (test.tests != null) {
      for (let child of test.tests) {
        let name = (test.name != null && child.name != null)
          ? (test.name + " / " + child.name)
          : (child.name || test.name)
        this.process({...test, tests: null, ...child, name}, extra);
      }
    }
  }

  emitTest(test, query, extra) {
    let _id = this.idGenerator.generate("test", test.name);

    let entry = {
      _id,
      _type: "test",
      dataset: test.dataset,
      name: test.name,
      query,
      result: test.result,
      ...extra,
    }

    this.emit(entry);
  }

  exportDocuments(test, extra) {
    let {dataset, documents, ...rest} = test;

    if (documents) {
      dataset = documents
    }

    let datasetId

    if (Array.isArray(dataset)) {
      datasetId = this.createDatasetFromDocuments(documents, extra);
    } else if (typeof dataset == 'string') {
      if (!DATASETS.hasOwnProperty(dataset)) {
        throw new Error(`[${extra.filename}] Unknown dataset: ${dataset}`)
      }
      datasetId = this.createDatasetFromURL(DATASETS[dataset])
    }

    if (datasetId != null) {
      dataset = {_ref: datasetId}
    }

    return {dataset, ...rest};
  }

  createDatasetFromDocuments(documents, extra) {
    let _id = this.idGenerator.generate("dataset");
    let entry = {
      _id,
      _type: "dataset",
      documents,
      url: `file://${extra.filename}`,
    }
    this.emit(entry);
    return _id;
  }

  createDatasetFromURL(url) {
    if (!this.datasetMapping.has(url)) {
      let _id = sha1(url)
      let entry = {
        _id,
        _type: "dataset",
        url,
      }
      this.emit(entry);
      this.datasetMapping.set(url, _id);
    }
    return this.datasetMapping.get(url)
  }
}

const BASEDIR = path.resolve(__dirname + "/../test");
const PATTERN = BASEDIR + "/**/*.yml";

async function build(emitter) {
  let testPaths = await glob(PATTERN);
  let builder = new Builder(emitter);

  for (let testPath of testPaths) {
    let filename = path.relative(BASEDIR, testPath);
    let data = fs.readFileSync(testPath);
    let test = yaml.safeLoad(data);
    let extra = {filename};
    builder.process(test, extra);
  }
}

async function main() {
  let serialize = ndjson.serialize();
  serialize.pipe(process.stdout);

  await build(entry => {
    serialize.write(entry);
  });

  serialize.end();
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});


