#!/usr/bin/env node
'use strict';

const core = require('./index.js');
const argv = require('yargs/yargs')(process.argv.slice(2))
  .usage('Usage: $0 --ddl=<path> --dml=<path> --apikey=<parsers.dev api key> --db=postgresql')
  .default({ db: 'postgresql' })
  .demandOption(['ddl', 'dml', 'apikey']).argv;

(async () => {
  await core.check(argv);
})();
