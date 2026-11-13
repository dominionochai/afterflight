#!/usr/bin/env node
import { main } from '../src/dc-cli.js';

main(process.argv.slice(2), process.env).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
