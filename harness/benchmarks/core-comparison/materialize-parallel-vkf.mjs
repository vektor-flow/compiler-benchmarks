import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function parallelCombinedVkfSource(source, maxCores = 3) {
  if (!Number.isInteger(maxCores) || maxCores < 1 || maxCores > 3) {
    throw new Error('MAX_CORES must be an integer from 1 through 3');
  }
  const marker = ':: fannkuch(9) + fannkuch(9) + spectral_norm() + n_body(200000)';
  if (!source.includes(marker)) throw new Error('combined-kernel output marker is missing');
  const roots = `left_root() -> num: fannkuch(9) + spectral_norm()
right_root() -> num: fannkuch(9) + n_body(200000)

left_result: left_root()
right_result: right_root()
:: left_result + right_result`;
  return `process.max_cores: ${maxCores}\n${source.replace(marker, roots)}`;
}

export function main(argv = process.argv.slice(2)) {
  const [input, output, coreText = '3'] = argv;
  if (!input || !output) {
    throw new Error('usage: materialize-parallel-vkf.mjs INPUT OUTPUT MAX_CORES(1..3)');
  }
  writeFileSync(
    output,
    parallelCombinedVkfSource(readFileSync(input, 'utf8'), Number(coreText)),
    'utf8'
  );
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) main();
