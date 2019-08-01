const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const {promisify} = require('util');
const glob = promisify(require('glob'));
const ndjson = require('ndjson');

const PATTERN = __dirname + "/../test/**/*.yml";

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

async function readDocuments(cb) {
  let idGenerator = new IdGenerator();

  let fileNames = await glob(PATTERN);
  for (let fileName of fileNames) {
    let latestDataset;
    let latestTemplate;
    let data = fs.readFileSync(fileName);
    let documents = yaml.safeLoad(data);
    let baseName = path.basename(fileName, ".yml");

    for (let doc of documents) {
      if (doc._id == null) {
        doc._id = idGenerator.generate(doc._type, baseName, doc.name);
      }

      if (doc._type == "dataset") {
        latestDataset = doc._id;
      }

      if (doc._type == "template") {
        latestTemplate = doc._id;
      }

      if (doc._type == "test") {
        if (doc.dataset == null) {
          doc.dataset = {_ref: latestDataset};
        }

        if (doc.template != null && doc.template._ref == null) {
          doc.template._ref = latestTemplate;
        }
      }

      cb(doc);
    }
  }
}

function expandTemplates(docs) {
  for (let doc of docs.values()) {
    if (doc._type == "test" && doc.template != null) {
      let template = docs.get(doc.template._ref);
      if (!template) throw new Error(`[${doc._id} Could not find template ${doc.template._ref}`);
      doc.query = template.query.replace(/\$\{(\w+)\}/g, (_, name) => {
        if (!doc.template.hasOwnProperty(name)) {
          throw new Error(`[${doc._id}] Template variable '${name}' is missing`);
        }

        return doc.template[name];
      });
    }
  }
}

async function build() {
  let documents = new Map();

  await readDocuments(doc => {
    documents.set(doc._id, doc);
  });

  expandTemplates(documents);

  return Array.from(documents.values());
}

async function main() {
  let serialize = ndjson.serialize();
  serialize.pipe(process.stdout);

  let documents = await build();
  for (let doc of documents) {
    serialize.write(doc);
  }
  serialize.end();
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});


