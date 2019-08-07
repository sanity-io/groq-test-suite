const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const {promisify} = require('util');
const glob = promisify(require('glob'));
const ndjson = require('ndjson');

function expandQueryVariables(query, variables) {
  return query.replace(/~(\w+)~/g, (_, name) => {
    if (!variables.hasOwnProperty(name)) {
      throw new Error(`Template variable '${name}' is missing`);
    }

    return variables[name];
  });
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
    this.emit = emitter;
  }

  process(test, extra) {
    test = this.exportDocuments(test, extra);

    if (test.query != null && test.hasOwnProperty('result')) {
      let query = test.query;

      if (test.variables != null) {
        query = expandQueryVariables(query, test.variables);
      }

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

  exportDocuments(test, extra) {
    let {dataset, documents, ...rest} = test;

    if (documents != null) {
      dataset = this.createDataset(documents, extra);
    }

    return {dataset, ...rest};
  }

  createDataset(documents, extra) {
    let _id = this.idGenerator.generate("dataset");
    let entry = {
      _id,
      _type: "dataset",
      documents,
      ...extra,
    }
    this.emit(entry);
    return _id;
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
    let didWrite = serialize.write(entry);
    if (!didWrite) throw new Error("Failed to write entry");
  });
  serialize.end();
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});


