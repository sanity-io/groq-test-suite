const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const { promisify } = require("util");
const glob = promisify(require("glob"));
const ndjson = require("ndjson");
const crypto = require("crypto");

const DATASETS = {
  movies:
    "https://groq-test-suite.storage.googleapis.com/datasets/movies/movies-7d858de5318a6bc27d92a638899957ef.ndjson",
};

function sha1(s) {
  return crypto.createHash("sha1").update(s).digest("hex");
}

function* expandQueryVariables(query, variables) {
  let state = [];
  let isDone = false;

  while (!isDone) {
    let didAdvance = false;
    let i = 0;

    let fullQuery = query.replace(/~(\w+)~/g, (_, name) => {
      if (!variables.hasOwnProperty(name)) {
        throw new Error(`Template variable '${name}' is missing`);
      }

      let value = variables[name];

      if (Array.isArray(value)) {
        if (!(i in state)) state.push(0);

        let current = state[i];

        if (!didAdvance) {
          state[i]++;
          if (state[i] == value.length) {
            // There's no more choices here. Start again, and rather try to advance
            // the next variable.
            state[i] = 0;
          } else {
            // We did successfully advance to the next alternative
            didAdvance = true;
          }
        }

        i++;
        return value[current];
      } else {
        return value;
      }
    });

    yield fullQuery;

    if (!didAdvance) {
      // There were no more alternatives *anywhere*
      break;
    }
  }
}

function containsVariables(query) {
  return /~(\w+)~/.test(query);
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

    let baseId = parts.join("-");
    let finalId = baseId;
    let nonce = 2;

    while (this.used.has(finalId)) {
      finalId = baseId + "-" + nonce;
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

    let hasResult = test.hasOwnProperty("result");
    let isInvalid = test.valid === false;
    let hasQuery = test.query != null;

    if (hasQuery && (hasResult || isInvalid)) {
      if (test.variables != null) {
        for (let query of expandQueryVariables(test.query, test.variables)) {
          this.emitTest(test, query, extra);
        }
      } else if (!containsVariables(test.query)) {
        this.emitTest(test, test.query, extra);
      }
    }

    // Process children
    if (test.tests != null) {
      for (let child of test.tests) {
        let name =
          test.name != null && child.name != null
            ? test.name + " / " + child.name
            : child.name || test.name;
        let variables =
          test.variables != null || child.variables != null
            ? Object.assign({}, test.variables, child.variables)
            : null;
        this.process(
          { ...test, tests: null, ...child, name, variables },
          extra
        );
      }
    }
  }

  emitTest(test, query, extra) {
    let _id = this.idGenerator.generate("test", test.name);

    let dataset = test.dataset || {
      _ref: this.createEmptyDataset(),
      _type: "reference",
    };
    let valid = test.valid != null ? test.valid : true;

    let entry = {
      _id,
      _type: "test",
      dataset,
      name: test.name,
      query,
      result: valid ? test.result : null,
      valid,
      ...extra,
    };

    this.emit(entry);
  }

  exportDocuments(test, extra) {
    let { dataset, documents, ...rest } = test;

    let datasetId;

    if (documents) {
      datasetId = this.createDatasetFromDocuments(documents, extra);
    } else if (typeof dataset == "string") {
      if (!DATASETS.hasOwnProperty(dataset)) {
        throw new Error(`[${extra.filename}] Unknown dataset: ${dataset}`);
      }
      datasetId = this.createDatasetFromURL(dataset, DATASETS[dataset]);
    }

    if (datasetId != null) {
      dataset = { _ref: datasetId, _type: "reference" };
    }

    return { dataset, ...rest };
  }

  createDatasetFromDocuments(documents, extra) {
    let _id = this.idGenerator.generate(sha1(extra.filename));
    let entry = {
      _id,
      _type: "dataset",
      name: "inline",
      documents,
      url: `file://${extra.filename}`,
    };
    this.emit(entry);
    return _id;
  }

  createDatasetFromURL(name, url) {
    if (!this.datasetMapping.has(url)) {
      let _id = sha1(url);
      let entry = {
        _id,
        _type: "dataset",
        name,
        url,
      };
      this.emit(entry);
      this.datasetMapping.set(url, _id);
    }
    return this.datasetMapping.get(url);
  }

  createEmptyDataset() {
    let url = "about:blank";

    if (!this.datasetMapping.has(url)) {
      let _id = sha1(url);
      let entry = {
        _id,
        _type: "dataset",
        name: "empty",
        url,
        documents: [],
      };
      this.emit(entry);
      this.datasetMapping.set(url, _id);
    }
    return this.datasetMapping.get(url);
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
    let extra = { filename };
    builder.process(test, extra);
  }
}

async function main() {
  let serialize = ndjson.serialize();
  serialize.pipe(process.stdout);

  await build((entry) => {
    serialize.write(entry);
  });

  serialize.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
