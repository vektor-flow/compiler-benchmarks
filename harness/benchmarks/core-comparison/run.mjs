import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, posix, relative, resolve, win32 } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

import { parallelCombinedVkfSource } from './materialize-parallel-vkf.mjs';

const benchmarkRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(benchmarkRoot, '..', '..');
const packageVersion = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')).version;
export function benchmarkWorkRoot(
  hostPlatform = platform(),
  temporaryRoot = tmpdir(),
  repositoryWorkRoot = resolve(benchmarkRoot, '.work')
) {
  return hostPlatform === 'win32'
    ? win32.resolve(temporaryRoot, 'vektor-flow-core-comparison')
    : posix.resolve(repositoryWorkRoot);
}

const workRoot = benchmarkWorkRoot();
const resultsRoot = resolve(benchmarkRoot, 'results');
const executableExtension = platform() === 'win32' ? '.exe' : '';
const libraryExtension = platform() === 'win32' ? '.dll' : platform() === 'darwin' ? '.dylib' : '.so';
const broadLanguageSet = Object.freeze([
  'vkf', 'c', 'cpp', 'python-efficient', 'rust', 'zig', 'go', 'julia'
]);

function standardCases(definition, sizes) {
  return sizes.map(({ label, count }) => Object.freeze({
    ...definition,
    id: `${definition.template}-${label}`,
    size: label,
    count
  }));
}

const cases = Object.freeze([
  Object.freeze({
    id: 'startup',
    template: 'startup',
    operation: 'startup',
    data: 'empty process',
    size: 'empty',
    requiresDirectVkf: true,
    tolerance: 0,
    comparisonMode: 'matched',
    approach: 'print one numeric value',
    languages: broadLanguageSet
  }),
  Object.freeze({
    id: 'scalar-control-small',
    template: 'scalar-control',
    operation: 'compiler regression: arithmetic + branch',
    data: 'scalar f64; not a comparative language benchmark',
    size: 'regression',
    count: 20_000,
    requiresDirectVkf: true,
    tolerance: 1e-9,
    comparisonMode: 'engineering-regression',
    approach: 'VKF-only historical 20,000-iteration acceptance gate',
    pythonExtension: 'py',
    languages: Object.freeze(['vkf'])
  }),
  ...standardCases(Object.freeze({
    template: 'spectral-norm',
    operation: 'spectral norm by power method',
    data: 'dense f64 vectors and implicit matrix',
    requiresDirectVkf: true,
    tolerance: 1e-9,
    comparisonMode: 'idiomatic',
    approach: 'Benchmarks Game power method; NumPy and Julia use optimized matrix operations',
    pythonExtension: 'numpy.py',
    languages: broadLanguageSet
  }), Object.freeze([
    Object.freeze({ label: 'small', count: 100 }),
    Object.freeze({ label: 'medium', count: 250 }),
    Object.freeze({ label: 'large', count: 500 })
  ])),
  ...standardCases(Object.freeze({
    template: 'fannkuch-redux',
    operation: 'fannkuch-redux permutations',
    data: 'fixed integer sequence and indexed mutation',
    requiresDirectVkf: true,
    tolerance: 0,
    comparisonMode: 'matched',
    approach: 'Benchmarks Game permutation order, checksum, and maximum-flip algorithm',
    pythonExtension: 'py',
    languages: broadLanguageSet
  }), Object.freeze([
    Object.freeze({ label: 'small', count: 7 }),
    Object.freeze({ label: 'medium', count: 8 }),
    Object.freeze({ label: 'large', count: 10 })
  ])),
  ...standardCases(Object.freeze({
    template: 'n-body',
    operation: 'five-body symplectic integration',
    data: 'five bodies with f64 position, velocity, mass, and final kinetic checksum',
    requiresDirectVkf: true,
    tolerance: 1e-9,
    comparisonMode: 'matched',
    approach: 'Benchmarks Game Jovian-body constants and pairwise symplectic integrator; final kinetic checksum',
    pythonExtension: 'py',
    languages: broadLanguageSet
  }), Object.freeze([
    Object.freeze({ label: 'small', count: 1_000 }),
    Object.freeze({ label: 'medium', count: 10_000 }),
    Object.freeze({ label: 'large', count: 200_000 })
  ])),
  Object.freeze({
    id: 'combined-kernels-large',
    template: 'combined-kernels',
    operation: 'serial combined',
    data: 'spectral n=500 for 60 iterations, two Fannkuch n=9 runs, and 200,000 N-body steps',
    size: 'large',
    count: 3,
    requiresDirectVkf: true,
    tolerance: 1e-9,
    absoluteTolerance: 1e-8,
    comparisonMode: 'matched',
    approach: 'larger matched kernels amortize fixed execution overhead; one scalar checksum',
    languages: Object.freeze(['vkf', 'cpp', 'rust', 'zig'])
  }),
  Object.freeze({
    id: 'combined-kernels-parallel-large',
    sourceCaseId: 'combined-kernels-large',
    template: 'combined-kernels',
    operation: 'parallel combined',
    data: 'spectral n=500 for 60 iterations, two Fannkuch n=9 runs, and 200,000 N-body steps',
    size: 'large',
    count: 3,
    requiresDirectVkf: true,
    tolerance: 1e-9,
    absoluteTolerance: 1e-8,
    comparisonMode: 'matched',
    approach: 'VKF automatically schedules the larger independent roots across exactly two compute threads; peers retain the matched serial source',
    parallelCombined: true,
    languages: Object.freeze(['vkf', 'cpp', 'rust', 'zig'])
  })
]);

export function parseOptions(argv) {
  const options = {
    caseId: null,
    languageId: null,
    outputStem: 'latest',
    compileRuns: 100,
    compileWarmups: 1,
    runs: 100,
    warmups: 5,
    processRuns: 10,
    processWarmups: 1,
    functionLandscapeRuns: 0,
    maxCores: 2,
    enforceRelativeGate: false,
    relativeLimit: 1.5
  };
  const names = new Map([
    ['compile-runs', 'compileRuns'],
    ['compile-warmups', 'compileWarmups'],
    ['runs', 'runs'],
    ['warmups', 'warmups'],
    ['process-runs', 'processRuns'],
    ['process-warmups', 'processWarmups'],
    ['function-landscape-runs', 'functionLandscapeRuns'],
    ['max-cores', 'maxCores']
  ]);
  for (const arg of argv) {
    const match = /^--([^=]+)=(.+)$/.exec(arg);
    if (!match) throw new Error(`unknown option: ${arg}`);
    if (match[1] === 'case') {
      options.caseId = match[2];
      continue;
    }
    if (match[1] === 'language') {
      options.languageId = match[2];
      continue;
    }
    if (match[1] === 'output') {
      if (!/^[a-z0-9][a-z0-9._-]*$/.test(match[2])) {
        throw new Error(`${arg} must be a safe result name`);
      }
      options.outputStem = match[2];
      continue;
    }
    if (match[1] === 'enforce-relative-gate') {
      if (match[2] !== 'true' && match[2] !== 'false') {
        throw new Error(`${arg} must be true or false`);
      }
      options.enforceRelativeGate = match[2] === 'true';
      continue;
    }
    if (match[1] === 'numeric-ssa-research') {
      if (!['true', 'false'].includes(match[2])) throw new Error(`${arg} must be true or false`);
      options.numericSsaResearch = match[2] === 'true';
      continue;
    }
    if (match[1] === 'relative-limit') {
      const value = Number(match[2]);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`${arg} must be positive`);
      }
      options.relativeLimit = value;
      continue;
    }
    if (!names.has(match[1])) throw new Error(`unknown option: ${arg}`);
    const value = Number(match[2]);
    const minimum = match[1] === 'function-landscape-runs' ? 0 : 1;
    if (!Number.isInteger(value) || value < minimum) {
      throw new Error(`${arg} must be ${minimum === 0 ? 'a non-negative' : 'a positive'} integer`);
    }
    if (match[1] === 'max-cores' && value > 3) {
      throw new Error(`${arg} must be at most 3`);
    }
    options[names.get(match[1])] = value;
  }
  return options;
}

export function seriesStats(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error('timing series must not be empty');
  }
  const sorted = samples.map(Number).sort((a, b) => a - b);
  const count = sorted.length;
  const mean = sorted.reduce((sum, value) => sum + value, 0) / count;
  const median = count % 2 === 0
    ? (sorted[count / 2 - 1] + sorted[count / 2]) / 2
    : sorted[(count - 1) / 2];
  const variance = count > 1
    ? sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (count - 1)
    : 0;
  const stddev = Math.sqrt(variance);
  const margin = count > 1 ? 1.96 * stddev / Math.sqrt(count) : 0;
  const round = (value) => Number(value.toFixed(6));
  return Object.freeze({
    count,
    meanMs: round(mean),
    medianMs: round(median),
    minMs: round(sorted[0]),
    maxMs: round(sorted.at(-1)),
    p95Ms: round(sorted[Math.ceil(count * 0.95) - 1]),
    stddevMs: round(stddev),
    ci95LowerMs: round(Math.max(0, mean - margin)),
    ci95UpperMs: round(mean + margin)
  });
}

export function valuesAgree(left, right, tolerance, absoluteTolerance = Infinity) {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  const relativeBound = tolerance * Math.max(1, Math.abs(left), Math.abs(right));
  return Math.abs(left - right) <= Math.min(relativeBound, absoluteTolerance);
}

function commandAvailable(command, args = ['--version']) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
  return result.status === 0;
}

function firstTool(candidates, label) {
  for (const candidate of candidates) {
    if (
      commandAvailable(candidate.command, candidate.versionArgs)
      && (!candidate.probeArgs || commandAvailable(candidate.command, candidate.probeArgs))
    ) return candidate;
  }
  throw new Error(`${label} unavailable; install it locally or run this benchmark in a matching Docker image`);
}

function toolVersion(tool) {
  const result = spawnSync(tool.command, tool.versionArgs, {
    encoding: 'utf8',
    windowsHide: true
  });
  return `${result.stdout || ''}${result.stderr || ''}`.trim().split(/\r?\n/, 1)[0];
}

function runCommand(command, args, { env = {}, timeoutMs = 180_000 } = {}) {
  const started = performance.now();
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, ...env }
  });
  const elapsedMs = performance.now() - started;
  if (result.error || result.status !== 0) {
    const detail = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    throw new Error(`${command} ${args.join(' ')} failed: ${result.error?.message || detail}`);
  }
  return { elapsedMs, stdout: result.stdout };
}

export function parseBatchCompileSummaries(stdout, expectedCount) {
  const summaries = String(stdout)
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
  if (summaries.length !== expectedCount) {
    throw new Error(`batch compiler returned ${summaries.length} summaries; expected ${expectedCount}`);
  }
  for (const summary of summaries) {
    if (!Number.isFinite(summary.batch_ms) || summary.batch_ms < 0) {
      throw new Error(`batch compiler returned invalid batch_ms: ${summary.batch_ms}`);
    }
  }
  return summaries;
}

function sourcePath(template, extension) {
  return resolve(benchmarkRoot, 'programs', `${template}.${extension}`);
}

function sourceSize(path) {
  const text = readFileSync(path, 'utf8');
  return Object.freeze({
    bytes: Buffer.byteLength(text),
    lines: text.trimEnd().split(/\r?\n/).length
  });
}

function fileSha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function sourceFileSha256(path) {
  const source = readFileSync(path, 'utf8').replace(/\r\n/g, '\n').replace(/\n$/, '');
  return createHash('sha256').update(source).digest('hex');
}

export function cppBenchmarkSource(source) {
  const declaration = 'BENCH_EXPORT double vkf_benchmark';
  const occurrences = String(source).split(declaration).length - 1;
  if (occurrences !== 1) {
    throw new Error('C++ benchmark source must declare exactly one benchmark entry');
  }
  return String(source).replace(declaration, `extern "C" ${declaration}`);
}

function buildNativeCompilerTools(tools) {
  const toolRoot = resolve(workRoot, 'native-compiler');
  mkdirSync(toolRoot, { recursive: true });
  // The native driver embeds this identity to keep its generated linalg kernel
  // coupled to the normalized stdlib source, just as the release build does.
  const linalgSource = readFileSync(
    resolve(repoRoot, 'compiler', 'self_hosted', 'stdlib', 'linalg.vkf'),
    'utf8'
  ).replace(/\r/g, '');
  const linalgDigest = createHash('sha256').update(linalgSource).digest('hex');
  const identityTemplate = readFileSync(
    resolve(repoRoot, 'compiler', 'native', 'vkf_stdlib_kernel_identity.hpp.in'),
    'utf8'
  );
  writeFileSync(
    resolve(toolRoot, 'vkf_stdlib_kernel_identity.generated.hpp'),
    identityTemplate.replace('@VKF_LINALG_SOURCE_SHA256@', linalgDigest),
    'utf8'
  );
  const reuseNativeTools = process.env.VKF_BENCH_REUSE_NATIVE_TOOLS === '1';
  const externalDriver = process.env.VKF_BENCH_DRIVER
    ? resolve(process.env.VKF_BENCH_DRIVER)
    : null;
  if (externalDriver && !existsSync(externalDriver)) {
    throw new Error(`VKF_BENCH_DRIVER does not exist: ${externalDriver}`);
  }
  const compilerOptimization = process.env.VKF_BENCH_COMPILER_OPT || '-O2';
  if (!/^-O(?:0|1|2|3|s|z)$/.test(compilerOptimization)) {
    throw new Error(`invalid VKF_BENCH_COMPILER_OPT: ${compilerOptimization}`);
  }
  const processTimer = resolve(toolRoot, `native-process-timer${executableExtension}`);
  const entryTimer = resolve(toolRoot, `native-entry-timer${executableExtension}`);
  const libraryTimer = resolve(toolRoot, `native-library-timer${executableExtension}`);
  if (platform() === 'win32' && !(reuseNativeTools && existsSync(processTimer))) {
    runCommand(tools.c.command, [
      '-O2', '-std=c17',
      resolve(benchmarkRoot, 'native_process_timer.c'),
      '-o', processTimer
    ]);
  }
  if (!(reuseNativeTools && existsSync(entryTimer))) {
    runCommand(tools.c.command, [
      '-O2', '-std=c17',
      resolve(benchmarkRoot, 'native_entry_timer.c'),
      '-o', entryTimer,
      ...(platform() === 'win32' ? [] : ['-lm', '-pthread'])
    ]);
  }
  if (!(reuseNativeTools && existsSync(libraryTimer))) {
    runCommand(tools.c.command, [
      '-O2', '-std=c17',
      resolve(benchmarkRoot, 'native_library_timer.c'),
      '-o', libraryTimer,
      ...(platform() === 'win32' ? [] : ['-lm']),
      ...(platform() === 'linux' ? ['-ldl'] : [])
    ]);
  }
  const jsonSource = resolve(repoRoot, 'native', 'VfOverlay', 'vf', 'json.cpp');
  const trigRoot = resolve(repoRoot, 'compiler', 'native', 'runtime', 'trig');
  const trigObjects = externalDriver ? [] : [
    'sin.c', 'cos.c', '__sin.c', '__cos.c', '__rem_pio2.c',
    '__rem_pio2_large.c', 'scalbn.c', 'floor.c'
  ].map((sourceName) => {
    const object = resolve(toolRoot, `${sourceName}.o`);
    if (!(reuseNativeTools && existsSync(object))) {
      runCommand(tools.c.command, [
        '-std=c11', compilerOptimization, '-ffp-contract=off', '-fno-fast-math',
        '-fno-builtin', '-fexcess-precision=standard', '-c',
        resolve(trigRoot, sourceName), '-o', object
      ]);
    }
    return object;
  });
  const arm64Host = platform() === 'darwin' && process.arch === 'arm64';
  const x64MacHost = platform() === 'darwin' && process.arch === 'x64';
  const definitions = externalDriver
    ? []
    : [['driver', 'vkf_driver_artifact_smoke.cpp', true]];
  if (x64MacHost) {
    definitions.push([
      'x64Template', 'vkf_x64_runner_template.cpp', false,
      'vkf_x64_runner_template'
    ]);
  }
  const built = externalDriver ? { driver: externalDriver } : {};
  if (platform() === 'win32') built.processTimer = processTimer;
  built.entryTimer = entryTimer;
  built.libraryTimer = libraryTimer;
  for (const [name, sourceName, needsJson, outputStem = `vkf-${name}`] of definitions) {
    const output = resolve(toolRoot, `${outputStem}${executableExtension}`);
    if (reuseNativeTools && existsSync(output)) {
      built[name] = output;
      continue;
    }
    const sources = [resolve(repoRoot, 'compiler', 'native', sourceName)];
    const compileArgs = [];
    if (name === 'driver') {
      sources.push(
        resolve(repoRoot, 'compiler', 'native', 'vkf_lexer_cursor_smoke.cpp'),
        resolve(repoRoot, 'compiler', 'native', 'vkf_parser_token_stream_smoke.cpp'),
        resolve(repoRoot, 'compiler', 'native', 'vkf_ast_to_ir_smoke.cpp'),
        resolve(repoRoot, 'compiler', 'native', 'vkf_csv_demand_source_scanner.cpp'),
        ...trigObjects
      );
      if (arm64Host) {
        compileArgs.push('-DVKF_ARM64_BACKEND_LIBRARY', '-DVKF_NATIVE_FRONTEND_LIBRARY');
      } else {
        sources.push(resolve(repoRoot, 'compiler', 'native', 'vkf_x64_artifact.cpp'));
        compileArgs.push('-DVKF_X64_BACKEND_LIBRARY', '-DVKF_NATIVE_FRONTEND_LIBRARY');
      }
    }
    if (name === 'x64Template') sources.push(...trigObjects);
    if (needsJson) sources.push(jsonSource);
    const linkArgs = name === 'x64Template' && platform() === 'win32'
      ? [
          '-Xlinker', '/nodefaultlib',
          '-Xlinker', 'legacy_stdio_definitions.lib',
          '-Xlinker', 'legacy_stdio_wide_specifiers.lib',
          '-Xlinker', 'ucrt.lib',
          '-Xlinker', 'kernel32.lib'
        ]
      : [];
    runCommand(tools.cpp.command, [
      '-std=c++17', compilerOptimization, '-DNDEBUG', '-I', repoRoot, '-I', toolRoot,
      '-I', resolve(repoRoot, 'native', 'VfOverlay'),
      ...compileArgs, ...sources, ...linkArgs, '-o', output
    ], { timeoutMs: 600_000 });
    built[name] = output;
  }
  return Object.freeze(built);
}

function nativeProcessSamples(processTimer, output, warmups, runs) {
  const result = runCommand(processTimer, [
    output,
    String(warmups),
    String(runs)
  ]);
  const payload = JSON.parse(result.stdout);
  if (!Array.isArray(payload.samples_ms) || payload.samples_ms.length !== runs) {
    throw new Error(`native timer returned ${payload.samples_ms?.length ?? 0} samples; expected ${runs}`);
  }
  return payload.samples_ms.map(Number);
}

function interleavedProcessSamples(entries, benchmarkCase, warmups, runs) {
  const states = new Map(entries.map(({ language }) => [language.id, {
    samples: [],
    value: null
  }]));
  const executeRound = (round, measured) => {
    for (let position = 0; position < entries.length; position += 1) {
      const entry = entries[(round + position) % entries.length];
      const result = entry.language.runtime(
        entry.compiled.runtimeArtifact,
        entry.compiled.source
      );
      const value = parseNumericOutput(
        result.stdout,
        entry.language.id,
        benchmarkCase.id
      );
      if (!measured) continue;
      const state = states.get(entry.language.id);
      if (state.value !== null && !valuesAgree(
        state.value,
        value,
        benchmarkCase.tolerance,
        benchmarkCase.absoluteTolerance
      )) {
        throw new Error(`${entry.language.id}/${benchmarkCase.id} produced unstable results`);
      }
      state.value = value;
      state.samples.push(result.elapsedMs);
    }
  };
  for (let warmup = 0; warmup < warmups; warmup += 1) executeRound(warmup, false);
  for (let iteration = 0; iteration < runs; iteration += 1) {
    executeRound(warmups + iteration, true);
  }
  return states;
}

export function vkfCompileArguments(
  source,
  { reuseFunctionPolicy = false, optimizerPolicy = 'auto' } = {}
) {
  void reuseFunctionPolicy;
  if (!/^mask-[0-9a-f]+$|^auto$/u.test(optimizerPolicy)) {
    throw new Error(`invalid VKF compile policy: ${optimizerPolicy}`);
  }
  return [
    '--aot',
    '--optimizer-policy', optimizerPolicy,
    ...(optimizerPolicy === 'auto'
      ? ['--optimizer-runs', '1000', '--optimizer-time-limit-ms', '60000']
      : []),
    '--source', source
  ];
}

export function strictFloatingPointCompileFlags() {
  return ['-ffp-contract=off', '-fno-fast-math'];
}

export function vkfFunctionLandscapeTrainingArguments(source, runs) {
  if (!Number.isInteger(runs) || runs < 1) {
    throw new Error('function landscape runs must be a positive integer');
  }
  return [
    '--aot',
    '--optimizer-policy', 'tune',
    '--optimizer-landscape-runs', String(runs),
    '--optimizer-runs', '1000',
    '--optimizer-time-limit-ms', '600000',
    '--source', source
  ];
}

export function vkfRuntimePreparationArguments(
  source,
  optimizerPolicy,
  { reuseFunctionPolicy = false } = {}
) {
  if (!/^mask-[0-9a-f]+$|^auto$|^mixed$|^scalar$/.test(optimizerPolicy)) {
    throw new Error(`invalid measured VKF optimizer policy: ${optimizerPolicy}`);
  }
  const selectedPolicy = reuseFunctionPolicy || optimizerPolicy === 'mixed'
    ? 'auto' : optimizerPolicy;
  return [
    '--aot',
    '--diagnostics',
    '--optimizer-policy', selectedPolicy,
    ...(selectedPolicy === 'auto'
      ? ['--optimizer-runs', '1000', '--optimizer-time-limit-ms', '60000']
      : []),
    '--source', source
  ];
}

export function measuredVkfOptimizerPolicy(summary) {
  const policy = summary?.optimizer_policy == null
    ? 'auto' : String(summary.optimizer_policy);
  if (!/^mask-[0-9a-f]+$|^auto$|^mixed$|^scalar$/.test(policy)) {
    throw new Error(`invalid measured VKF optimizer policy: ${policy}`);
  }
  return policy;
}

export function vkfFunctionPolicyReceipt(summary, manifest = null) {
  const tuning = manifest?.empirical_tuning ?? summary?.empirical_tuning ?? {};
  const flow = manifest?.automatic_flow_limits ?? summary?.automatic_flow_limits ?? {};
  const moduleAbiPolicy = String(tuning.module_abi_policy ?? '');
  const phaseFields = {
    lowering: 'lowering_ms', cacheLookup: 'cache_lookup_ms',
    candidateEncoding: 'candidate_encoding_ms',
    trainingExecution: 'training_execution_ms', finalEncoding: 'final_encoding_ms'
  };
  const hasPhaseCosts = Object.values(phaseFields).some(field => tuning[field] != null);
  const optimizerPhaseMs = hasPhaseCosts ? Object.fromEntries(
    Object.entries(phaseFields).map(([name, field]) => {
      const value = tuning[field];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new Error(`invalid VKF optimizer phase cost: ${field}`);
      }
      return [name, value];
    })
  ) : null;
  if (tuning.candidate_fingerprinting_ms != null) {
    if (typeof tuning.candidate_fingerprinting_ms !== 'number' ||
        !Number.isFinite(tuning.candidate_fingerprinting_ms) || tuning.candidate_fingerprinting_ms < 0 ||
        optimizerPhaseMs === null) throw new Error('invalid VKF candidate fingerprinting cost');
    optimizerPhaseMs.candidateFingerprinting = tuning.candidate_fingerprinting_ms;
  }
  const artifactFields = {
    hits: 'function_artifact_cache_hits', misses: 'function_artifact_cache_misses',
    retainedBytes: 'function_artifact_cache_bytes'
  };
  const functionArtifactCache = Object.values(artifactFields).some(field => tuning[field] != null)
    ? Object.fromEntries(Object.entries(artifactFields).map(([name, field]) => {
      const value = tuning[field];
      if (!Number.isSafeInteger(value) || value < 0)
        throw new Error(`invalid VKF function artifact cache counter: ${field}`);
      return [name, value];
    })) : null;
  if (tuning.function_artifact_cache_aliases != null) {
    if (!Number.isSafeInteger(tuning.function_artifact_cache_aliases) ||
        tuning.function_artifact_cache_aliases < 0 || functionArtifactCache === null)
      throw new Error('invalid VKF function artifact alias counter');
    functionArtifactCache.aliases = tuning.function_artifact_cache_aliases;
  }
  const dagPlanFields = {
    hits: 'dag_plan_cache_hits', misses: 'dag_plan_cache_misses',
    retainedBytes: 'dag_plan_cache_bytes'
  };
  const dagPlanCache = Object.values(dagPlanFields).some(field => tuning[field] != null)
    ? Object.fromEntries(Object.entries(dagPlanFields).map(([name, field]) => {
      const value = tuning[field];
      if (!Number.isSafeInteger(value) || value < 0)
        throw new Error(`invalid VKF DAG plan cache counter: ${field}`);
      return [name, value];
    })) : null;
  const invariantPlanFields = {
    hits: 'invariant_plan_cache_hits', misses: 'invariant_plan_cache_misses',
    retainedBytes: 'invariant_plan_cache_bytes'
  };
  const invariantPlanCache = Object.values(invariantPlanFields).some(field => tuning[field] != null)
    ? Object.fromEntries(Object.entries(invariantPlanFields).map(([name, field]) => {
      const value = tuning[field];
      if (!Number.isSafeInteger(value) || value < 0 ||
          (name === 'retainedBytes' && value > 32 * 1024 * 1024))
        throw new Error(`invalid VKF invariant plan cache counter: ${field}`);
      return [name, value];
    })) : null;
  const scalarFrameFields = {
    hits: 'scalar_frame_liveness_cache_hits', misses: 'scalar_frame_liveness_cache_misses',
    retainedBytes: 'scalar_frame_liveness_cache_bytes'
  };
  const scalarFrameLivenessCache = Object.values(scalarFrameFields).some(field => tuning[field] != null)
    ? Object.fromEntries(Object.entries(scalarFrameFields).map(([name, field]) => {
      const value = tuning[field];
      if (!Number.isSafeInteger(value) || value < 0 ||
          (name === 'retainedBytes' && value > 4 * 1024 * 1024))
        throw new Error(`invalid VKF scalar frame liveness cache counter: ${field}`);
      return [name, value];
    })) : null;
  const rawPolicies = Array.isArray(tuning.function_policies)
    ? tuning.function_policies : [];
  const loweringPasses = tuning.lowering_passes == null ? null : tuning.lowering_passes;
  if (loweringPasses !== null && (!Array.isArray(loweringPasses) ||
      loweringPasses.some(pass => typeof pass?.name !== 'string' || pass.name.length === 0 ||
        typeof pass?.elapsed_ms !== 'number' || !Number.isFinite(pass.elapsed_ms) || pass.elapsed_ms < 0) ||
      new Set(loweringPasses.map(pass => pass.name)).size !== loweringPasses.length))
    throw new Error('invalid VKF lowering pass timings');
  const functionPolicies = rawPolicies.map((selection, index) => {
    const name = String(selection?.name ?? '');
    const selectedPolicy = String(selection?.selected_policy ?? '');
    const optimizationEnabled = Boolean(selection?.optimization_enabled);
    const concretePolicy = /^(?:mask-[0-9a-f]+|scalar)$/.test(selectedPolicy);
    const intentionallyUntuned = selectedPolicy === 'auto' && !optimizationEnabled;
    if (name.length === 0 || (!concretePolicy && !intentionallyUntuned)) {
      throw new Error(`invalid VKF function-policy selection at index ${index}`);
    }
    return Object.freeze({
      name,
      selectedPolicy,
      optimizationEnabled
    });
    });
  return Object.freeze({
    selectedPolicy: measuredVkfOptimizerPolicy({
      optimizer_policy: /^mask-[0-9a-f]+$/.test(moduleAbiPolicy)
        ? moduleAbiPolicy
        : summary?.optimizer_policy
    }),
    cacheHit: Boolean(tuning.cache_hit ?? summary?.optimizer_cache_hit),
    compositionCacheHit: Boolean(tuning.composition_cache_hit),
    moduleAbiPolicy: String(tuning.module_abi_policy ?? 'not-applicable'),
    armPolicyMask: tuning.arm_policy_mask == null ? null : Number(tuning.arm_policy_mask),
    totalRuns: Number(tuning.total_runs ?? 0),
    candidateCount: tuning.evidence_cache_hit === true ? 0
      : Array.isArray(tuning.candidates) ? tuning.candidates.length : 0,
    evidenceCandidateCount: Array.isArray(tuning.candidates) ? tuning.candidates.length : 0,
    searchCount: Number(tuning.function_landscape_search_count ?? 0),
    reusedCount: Number(tuning.function_landscape_reused_count ?? 0),
    parallelEligible: Boolean(tuning.parallel_eligible),
    parallelSelected: Boolean(tuning.parallel_selected),
    parallelThreadsCreated: Number(tuning.parallel_threads_created ?? 0),
    parallelThreadsJoined: Number(tuning.parallel_threads_joined ?? 0),
    parallelThreadHandlesClosed: Number(tuning.parallel_thread_handles_closed ?? 0),
    parallelWidth: Number(tuning.parallel_width ?? 0),
    availableCores: Number(flow.available_cores ?? 0),
    cpuPartitionLimit: Number(flow.cpu_partition_limit ?? 0),
    functionPolicies: Object.freeze(functionPolicies),
    machineCodeFingerprint: String(summary?.machine_code_fingerprint ?? ''),
    optimizerPhaseMs: optimizerPhaseMs && Object.freeze(optimizerPhaseMs),
    functionArtifactCache: functionArtifactCache && Object.freeze(functionArtifactCache),
    dagPlanCache: dagPlanCache && Object.freeze(dagPlanCache),
    invariantPlanCache: invariantPlanCache && Object.freeze(invariantPlanCache),
    scalarFrameLivenessCache: scalarFrameLivenessCache && Object.freeze(scalarFrameLivenessCache),
    loweringPasses: loweringPasses && Object.freeze(loweringPasses.map(pass => Object.freeze({ ...pass })))
  });
}

export function vkfPolicyEvidence(summary, manifest = null) {
  const tuning = manifest?.empirical_tuning ?? summary?.empirical_tuning ?? {};
  const candidates = Array.isArray(tuning.candidates) ? tuning.candidates : [];
  const contexts = Array.isArray(tuning.search_contexts) ? tuning.search_contexts : [];
  const functionPolicies = Array.isArray(tuning.function_policies)
    ? tuning.function_policies : [];
  const fingerprint = String(tuning.experiment_fingerprint ?? '');
  const policyMask = Number(tuning.arm_policy_mask);
  // Historical six-policy receipts use the upper six adaptive bits. The
  // additional ARM policies use otherwise alias-only adaptive bits; keep all
  // recorded schemas verifiable without relabeling their observations.
  const armMaskOf = (logicalMask) => (logicalMask >>> 2) |
    ((policyMask & 64) ? ((logicalMask & 1) << 6) : 0) |
    ((policyMask & 128) ? ((logicalMask & 2) << 6) : 0);
  const logicalMaskOf = (armMask) => ((armMask & 63) << 2) |
    ((policyMask & 64) ? ((armMask & 64) >>> 6) : 0) |
    ((policyMask & 128) ? ((armMask & 128) >>> 6) : 0);
  const near = (left, right) => Number.isFinite(left) && Number.isFinite(right) &&
    Math.abs(left - right) <= Math.max(1e-12, Math.abs(right) * 1e-12);
  if (tuning.arm_policy_mask == null) {
    if (candidates.length === 0) return null;
    const x64Fingerprint = String(tuning.fingerprint ?? '');
    if (!/^[0-9a-f]{16,64}$/u.test(x64Fingerprint)) {
      throw new Error('VKF x64 policy evidence lacks optimizer identity');
    }
    for (const candidate of candidates) {
      const runs = Number(candidate?.runs);
      if (!Number.isInteger(runs) || runs < 0 || !Array.isArray(candidate?.samples_ns) ||
          candidate.samples_ns.length !== runs ||
          candidate.samples_ns.some((sample) => !Number.isFinite(Number(sample)) || Number(sample) < 0) ||
          typeof candidate?.correct !== 'boolean' ||
          !/^[0-9a-f]{16}$/u.test(String(candidate?.code_hash ?? ''))) {
        throw new Error('VKF x64 policy evidence lost measurements');
      }
    }
    return Object.freeze({
      schema: 'vkf-x64-policy-evidence-v1',
      fingerprint: x64Fingerprint,
      cacheHit: Boolean(tuning.cache_hit),
      candidates: Object.freeze(candidates),
      functionPolicies: Object.freeze(functionPolicies)
    });
  }
  if (!/^[0-9a-f]{64}$/u.test(fingerprint) || !Number.isInteger(policyMask) ||
      policyMask < 0 || policyMask > 255) {
    throw new Error('VKF policy evidence lacks exact-IR identity or policy schema');
  }
  if (contexts.length !== functionPolicies.length) {
    throw new Error('VKF policy evidence lacks ordered search contexts');
  }
  const byFunction = new Map(functionPolicies.map(({ name }) => [String(name), new Map()]));
  for (const candidate of candidates) {
    const functionName = String(candidate?.function ?? '');
    const logicalMask = Number(candidate?.adaptive_mask);
    const armMask = Number(candidate?.arm_mask);
    const representative = Number(candidate?.representative_arm_mask);
    const runs = Number(candidate?.runs);
    const codeHash = String(candidate?.code_hash ?? '');
    const group = byFunction.get(functionName);
    if (!group || !Number.isInteger(logicalMask) || logicalMask < 0 || logicalMask > 255 ||
        !Number.isInteger(armMask) || armMask < 0 || armMask > policyMask ||
        armMask !== armMaskOf(logicalMask) ||
        candidate.normalized_to_baseline !== (logicalMask !== logicalMaskOf(armMask)) ||
        !Number.isInteger(representative) || representative < 0 || representative > policyMask ||
        !Number.isInteger(runs) || runs < 0 || candidate?.tested !== true ||
        typeof candidate?.correct !== 'boolean' || !/^[0-9a-f]{16}$/u.test(codeHash) ||
        !/^[0-9a-f]{64}$/u.test(String(candidate?.code_sha256 ?? ''))) {
      throw new Error(`invalid VKF policy evidence for ${functionName || '<missing>'}`);
    }
    if (group.has(logicalMask)) {
      throw new Error(`duplicate VKF policy evidence for ${functionName}/mask-${logicalMask.toString(16)}`);
    }
    if (candidate.normalized_to_baseline !== true) {
      const samples = candidate?.samples_ns;
      const observed = candidate?.observed_samples_ns;
      const validity = candidate?.sample_correct;
      const attempted = Number(candidate?.attempted_runs);
      if (!Array.isArray(samples) || samples.length !== runs ||
          samples.some((sample) => !Number.isFinite(Number(sample)) || Number(sample) < 0)) {
        throw new Error(`VKF policy evidence lost samples for ${functionName}/mask-${logicalMask.toString(16)}`);
      }
      if (!Number.isInteger(attempted) || attempted < runs ||
          !Array.isArray(observed) || observed.length !== attempted ||
          !Array.isArray(validity) || validity.length !== attempted ||
          validity.some((valid) => typeof valid !== 'boolean') ||
          observed.some((sample) => !Number.isFinite(Number(sample)) || Number(sample) < 0) ||
          validity.filter(Boolean).length !== runs) {
        throw new Error(`VKF policy evidence lost incorrect observations for ${functionName}/mask-${logicalMask.toString(16)}`);
      }
      const ratio = candidate?.relative_to_baseline;
      if (runs > 0 && (!Number.isFinite(Number(ratio)) || Number(ratio) <= 0)) {
        throw new Error(`VKF policy evidence lost regression ratio for ${functionName}/mask-${logicalMask.toString(16)}`);
      }
    }
    group.set(logicalMask, candidate);
  }
  for (let index = 0; index < functionPolicies.length; index += 1) {
    const name = String(functionPolicies[index]?.name ?? '');
    const group = byFunction.get(name);
    if (!group || group.size !== 256 ||
        Array.from({ length: 256 }, (_, mask) => mask).some((mask) => !group.has(mask))) {
      throw new Error(`VKF policy evidence incomplete for ${name}`);
    }
    const context = contexts[index];
    if (String(context?.function ?? '') !== name ||
        Number(context?.search_position) !== index ||
        !Array.isArray(context?.retained_prefix) ||
        context.retained_prefix.length !== index) {
      throw new Error(`VKF policy evidence search context mismatch for ${name}`);
    }
    const uniqueMasks = context?.unique_arm_masks;
    const events = context?.measurement_events;
    const expectedBits = String(context?.expected_result_bits ?? '');
    if (!Array.isArray(uniqueMasks) || uniqueMasks.length === 0 ||
        new Set(uniqueMasks).size !== uniqueMasks.length || uniqueMasks[0] !== 0 ||
        uniqueMasks.some((mask) => !Number.isInteger(mask) || mask < 0 || mask > policyMask) ||
        !Array.isArray(events) || !/^[0-9a-f]{16}$/u.test(expectedBits) ||
        context?.timing_protocol !== 'rotated-candidates-v1') {
      throw new Error(`VKF policy evidence lacks replay protocol for ${name}`);
    }
    const eventsByMask = new Map(uniqueMasks.map((mask) => [mask, []]));
    let lastOrder = -1;
    for (const event of events) {
      const round = Number(event?.round);
      const position = Number(event?.position);
      const mask = Number(event?.arm_mask);
      const elapsed = Number(event?.elapsed_ns);
      const order = round * uniqueMasks.length + position;
      if (!Number.isInteger(round) || round < 0 || !Number.isInteger(position) ||
          position < 0 || position >= uniqueMasks.length || order <= lastOrder ||
          mask !== uniqueMasks[(round + position) % uniqueMasks.length] ||
          !Number.isFinite(elapsed) || elapsed < 0 || typeof event?.correct !== 'boolean' ||
          !/^[0-9a-f]{16}$/u.test(String(event?.result_bits ?? '')) ||
          event.correct !== (event.result_bits === expectedBits)) {
        throw new Error(`VKF policy evidence contains invalid measurement order/result for ${name}`);
      }
      eventsByMask.get(mask).push(event);
      lastOrder = order;
    }
    const canonical = new Map([...group.values()].filter((candidate) =>
      candidate.normalized_to_baseline !== true).map((candidate) =>
      [Number(candidate.arm_mask), candidate]));
    if (canonical.size !== policyMask + 1) {
      throw new Error(`VKF policy evidence lacks canonical policy vectors for ${name}`);
    }
    for (const candidate of group.values()) {
      const source = canonical.get(Number(candidate.arm_mask));
      if (!source || candidate.code_sha256 !== source.code_sha256 ||
          candidate.correct !== source.correct || candidate.runs !== source.runs ||
          candidate.median_ns !== source.median_ns ||
          candidate.representative_arm_mask !== source.representative_arm_mask) {
        throw new Error(`VKF policy evidence logical alias mismatch for ${name}`);
      }
    }
    for (let prior = 0; prior < index; prior += 1) {
      const prefix = context.retained_prefix[prior];
      const priorSelection = functionPolicies[prior];
      const selectedMask = Number.parseInt(String(priorSelection.selected_policy).slice(5), 16);
      if (String(prefix?.name ?? '') !== String(priorSelection.name) ||
          Number(prefix?.arm_mask) !== armMaskOf(selectedMask)) {
        throw new Error(`VKF policy evidence retained prefix mismatch for ${name}`);
      }
    }
    const selectedMask = Number.parseInt(String(functionPolicies[index].selected_policy).slice(5), 16);
    if (Number(context?.winner_arm_mask) !== armMaskOf(selectedMask)) {
      throw new Error(`VKF policy evidence winner context mismatch for ${name}`);
    }
    for (const candidate of canonical.values()) {
      const representative = canonical.get(Number(candidate.representative_arm_mask));
      const recorded = eventsByMask.get(Number(candidate.representative_arm_mask));
      if (!representative || !recorded || candidate.code_sha256 !== representative.code_sha256 ||
          JSON.stringify(candidate.observed_samples_ns) !==
            JSON.stringify(recorded.map((event) => event.elapsed_ns)) ||
          JSON.stringify(candidate.sample_correct) !==
            JSON.stringify(recorded.map((event) => event.correct))) {
        throw new Error(`VKF policy evidence alias/sample mismatch for ${name}`);
      }
      const validSamples = recorded.filter((event) => event.correct).map((event) => event.elapsed_ns);
      const sorted = [...validSamples].sort((left, right) => left - right);
      const middle = Math.floor(sorted.length / 2);
      const median = sorted.length === 0 ? 0 : sorted.length % 2 === 1
        ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
      if (JSON.stringify(candidate.samples_ns) !== JSON.stringify(validSamples) ||
          !near(Number(candidate.median_ns), median) ||
          candidate.measured !== (validSamples.length > 0)) {
        throw new Error(`VKF policy evidence statistics not derived from samples for ${name}`);
      }
      const baselineMedian = Number(canonical.get(0)?.median_ns);
      const expectedRatio = baselineMedian > 0 && median > 0 ? median / baselineMedian : null;
      if (expectedRatio === null ? candidate.relative_to_baseline !== null
        : !near(Number(candidate.relative_to_baseline), expectedRatio)) {
        throw new Error(`VKF policy evidence regression ratio mismatch for ${name}`);
      }
    }
    const measured = [...group.values()].filter((candidate) =>
      candidate.normalized_to_baseline !== true && candidate.correct === true &&
      candidate.measured === true);
    if (measured.length > 0) {
      const winner = group.get(Number.parseInt(
        String(functionPolicies[index]?.selected_policy ?? 'mask-0').slice(5), 16));
      const best = Math.min(...measured.map((candidate) => Number(candidate.median_ns)));
      if (!winner || Number(winner.median_ns) !== best) {
        throw new Error(`VKF selected policy is not measured winner for ${name}`);
      }
    }
  }
  return Object.freeze({
    schema: 'vkf-arm64-policy-evidence-v1',
    fingerprint,
    policyMask,
    cacheHit: Boolean(tuning.evidence_cache_hit),
    historyId: String(tuning.evidence_history_id ?? ''),
    hostFingerprint: String(tuning.host_fingerprint ?? ''),
    implementationFingerprint: String(tuning.implementation_fingerprint ?? ''),
    policyDefinitions: Object.freeze(tuning.policy_definitions ?? []),
    candidates: Object.freeze(candidates),
    searchContexts: Object.freeze(contexts)
  });
}

export function retainVkfPolicyExperiment(ledger, evidence, use) {
  if (evidence == null) return null;
  const { cacheHit, ...observation } = evidence;
  const observationId = createHash('sha256').update(JSON.stringify(observation)).digest('hex');
  let retained = ledger.find((entry) => entry.observationId === observationId);
  if (!retained) {
    retained = { observationId, evidence: observation, uses: [] };
    ledger.push(retained);
  }
  retained.uses.push({ ...use, cacheHit: Boolean(cacheHit) });
  return observationId;
}

export function assertVkfParallelExecutionReceipt(
  receipt,
  maxCores,
  context = 'VKF parallel combined'
) {
  if (maxCores !== 2) {
    throw new Error(`${context} must use exactly two compute threads`);
  }
  const observedWorker = receipt?.parallelThreadsCreated === 1 &&
    receipt?.parallelThreadsJoined === 1 &&
    receipt?.parallelThreadHandlesClosed === 1;
  const reusedWorkerProof = receipt?.cacheHit === true &&
    receipt?.parallelThreadsCreated === 0 &&
    receipt?.parallelThreadsJoined === 0 &&
    receipt?.parallelThreadHandlesClosed === 0;
  if (!receipt || receipt.availableCores < 2 || receipt.cpuPartitionLimit !== 2 ||
      !receipt.parallelEligible || !receipt.parallelSelected ||
      receipt.parallelWidth !== 2 ||
      (!observedWorker && !reusedWorkerProof)) {
    throw new Error(
      `${context} lacks an exact two-thread execution receipt ` +
      `(available=${receipt?.availableCores ?? 0}, limit=${receipt?.cpuPartitionLimit ?? 0}, ` +
      `eligible=${receipt?.parallelEligible ?? false}, selected=${receipt?.parallelSelected ?? false}, ` +
      `width=${receipt?.parallelWidth ?? 0}, ` +
      `workers=${receipt?.parallelThreadsCreated ?? 0}/` +
      `${receipt?.parallelThreadsJoined ?? 0}/` +
      `${receipt?.parallelThreadHandlesClosed ?? 0})`
    );
  }
}

export function assertVkfParallelRuntimeReceipt(
  compilerReceipt,
  runtimeReceipt,
  maxCores,
  context = 'VKF parallel combined'
) {
  assertVkfParallelExecutionReceipt(compilerReceipt, maxCores, context);
  if (!runtimeReceipt || runtimeReceipt.width !== 2 ||
      runtimeReceipt.threadsCreated !== 1 ||
      runtimeReceipt.threadsJoined !== 1 ||
      runtimeReceipt.threadHandlesClosed !== 1) {
    throw new Error(`${context} did not execute one worker beside the caller`);
  }
}

export function assertVkfFunctionPolicyReuse(training, reuse, context = 'VKF') {
  if (!reuse.cacheHit || !reuse.compositionCacheHit) {
    throw new Error(
      `${context} must reuse a retained full-program function composition ` +
      `(cacheHit=${reuse.cacheHit}, compositionCacheHit=${reuse.compositionCacheHit}, ` +
      `totalRuns=${reuse.totalRuns}, candidateCount=${reuse.candidateCount})`
    );
  }
  if (reuse.totalRuns !== 0 || reuse.candidateCount !== 0) {
    throw new Error(`${context} cache reuse must perform zero optimizer runs`);
  }
  if (reuse.selectedPolicy !== training.selectedPolicy ||
      reuse.moduleAbiPolicy !== training.moduleAbiPolicy ||
      reuse.machineCodeFingerprint !== training.machineCodeFingerprint ||
      JSON.stringify(reuse.functionPolicies) !== JSON.stringify(training.functionPolicies)) {
    throw new Error(`${context} changed the retained ordered function-policy composition`);
  }
}

export function assertVkfFunctionCompositionReuse(training, reuse, context = 'VKF') {
  if (!reuse.compositionCacheHit) {
    throw new Error(
      `${context} must reuse every retained function lowering ` +
      `(compositionCacheHit=${reuse.compositionCacheHit})`
    );
  }
  if (reuse.selectedPolicy !== training.selectedPolicy ||
      reuse.moduleAbiPolicy !== training.moduleAbiPolicy ||
      JSON.stringify(reuse.functionPolicies) !== JSON.stringify(training.functionPolicies)) {
    throw new Error(`${context} changed the retained ordered function-policy composition`);
  }
}

export function assertVkfFunctionPolicyLandscape(receipt, candidates, landscapeRuns, context = 'VKF') {
  if (receipt.cacheHit || receipt.totalRuns < 1 || receipt.functionPolicies.length < 1 ||
      receipt.searchCount < 1 || receipt.reusedCount < 0 ||
      receipt.searchCount + receipt.reusedCount !== receipt.functionPolicies.length) {
    throw new Error(`${context} did not measure or reuse a complete per-function policy landscape`);
  }
  const expectedMasks = new Set(Array.from(
    { length: 256 }, (_, mask) => `mask-${mask.toString(16)}`
  ));
  const candidatesByFunction = new Map(receipt.functionPolicies.map(({ name }) => [name, []]));
  for (const candidate of candidates ?? []) {
    const group = candidatesByFunction.get(String(candidate?.function ?? ''));
    if (!group) throw new Error(`${context} reported a policy for an unknown function`);
    if (candidate.tested !== true || candidate.correct !== true ||
        Number(candidate.runs) !== landscapeRuns) {
      throw new Error(`${context} contains an unproven policy artifact`);
    }
    if (candidate.normalized_to_baseline === true &&
        !/^[0-9a-f]{16}$/u.test(String(candidate.rejected_code_hash ?? ''))) {
      throw new Error(`${context} contains an undisclosed rejected policy artifact`);
    }
    group.push(String(candidate.policy ?? ''));
  }
  for (const selection of receipt.functionPolicies) {
    const masks = new Set(candidatesByFunction.get(selection.name));
    if (masks.size !== expectedMasks.size ||
        [...expectedMasks].some((mask) => !masks.has(mask))) {
      throw new Error(`${context}/${selection.name} must report all 256 policy masks`);
    }
    const selectedMask = Number.parseInt(selection.selectedPolicy.slice('mask-'.length), 16);
    const aliasBits = receipt.armPolicyMask === 255 ? 0 : receipt.armPolicyMask === 127 ? 0x2 : 0x3;
    if (!masks.has(selection.selectedPolicy) || (selectedMask & aliasBits) !== 0) {
      throw new Error(`${context}/${selection.name} selected an invalid function-local policy`);
    }
  }
}

export function vkfOptimizerCacheEnvironment(cacheRoot) {
  if (!isAbsolute(cacheRoot)) throw new Error('VKF optimizer cache root must be absolute');
  return Object.freeze({ VKF_OPTIMIZER_CACHE_ROOT: cacheRoot });
}

function interleavedNativeRuntimeSamples(entries, benchmarkCase, warmups, runs) {
  // Rotate languages in short steady-state batches. Five local warmups keep
  // mapping/page costs out of the samples; five measured calls bound the time
  // any one language holds a thermal/turbo state before the next language.
  const batchWarmups = 5;
  const batchRuns = 5;
  const eligible = entries.filter(({ language, compiled }) =>
    compiled.nativeRuntimeArtifact && language.nativeRuntimeBatch);
  const states = new Map(eligible.map(({ language }) => [language.id, {
    samples: [],
    value: null,
    affinityCpu: null,
    parallelReceipt: null,
    researchReceipts: []
  }]));
  const executeRound = (round, measured) => {
    for (let offset = 0; offset < eligible.length; offset += 1) {
      const entry = eligible[(round + offset) % eligible.length];
      const result = entry.language.nativeRuntimeBatch(
        entry.compiled.nativeRuntimeArtifact,
        batchWarmups,
        batchRuns
      );
      if (!Array.isArray(result.samples) || result.samples.length !== batchRuns) {
        throw new Error(
          `${entry.language.id}/${benchmarkCase.id} raw timer must return ${batchRuns} interleaved samples`
        );
      }
      const state = states.get(entry.language.id);
      if (!Number.isInteger(result.affinityCpu)) {
        throw new Error(`${entry.language.id}/${benchmarkCase.id} raw timer did not report CPU affinity`);
      }
      if (state.affinityCpu !== null && state.affinityCpu !== result.affinityCpu) {
        throw new Error(
          `${entry.language.id}/${benchmarkCase.id} raw timer moved from CPU ` +
          `${state.affinityCpu} to CPU ${result.affinityCpu}`
        );
      }
      state.affinityCpu = result.affinityCpu;
      if (result.researchReceipt) state.researchReceipts.push(result.researchReceipt);
      if (result.parallelReceipt) {
        if (state.parallelReceipt &&
            JSON.stringify(state.parallelReceipt) !==
              JSON.stringify(result.parallelReceipt)) {
          throw new Error(
            `${entry.language.id}/${benchmarkCase.id} changed its parallel runtime receipt`
          );
        }
        state.parallelReceipt = result.parallelReceipt;
      }
      if (state.value !== null && !valuesAgree(
        state.value,
        result.value,
        benchmarkCase.tolerance,
        benchmarkCase.absoluteTolerance
      )) {
        throw new Error(
          `${entry.language.id}/${benchmarkCase.id} produced unstable raw results`
        );
      }
      state.value = result.value;
      if (measured) {
        for (const sample of result.samples) {
          if (state.samples.length < runs) state.samples.push(Number(sample));
        }
      }
    }
  };
  for (let warmup = 0; warmup < Math.ceil(warmups / batchRuns); warmup += 1) {
    executeRound(warmup, false);
  }
  for (let iteration = 0; iteration < Math.ceil(runs / batchRuns); iteration += 1) {
    executeRound(Math.ceil(warmups / batchRuns) + iteration, true);
  }
  assertSameNativeRuntimeAffinity(
    [...states].map(([language, state]) => ({ language, affinityCpu: state.affinityCpu })),
    benchmarkCase.id,
    { allowUnavailable: platform() === 'darwin' }
  );
  return states;
}

export function assertSameNativeRuntimeAffinity(
  entries,
  context = 'native runtime',
  { allowUnavailable = false } = {}
) {
  if (entries.length < 2) return;
  if (allowUnavailable && entries.every((entry) => entry.affinityCpu === -1)) return;
  const expected = entries[0].affinityCpu;
  for (const entry of entries) {
    if (!Number.isInteger(entry.affinityCpu) || entry.affinityCpu < 0) {
      throw new Error(`${entry.language}/${context} is not pinned to a logical CPU`);
    }
    if (entry.affinityCpu !== expected) {
      throw new Error(
        `${context} raw timers must share one logical CPU: ` +
        `${entries[0].language}=CPU${expected}, ${entry.language}=CPU${entry.affinityCpu}`
      );
    }
  }
}

export function assertNativeTimingPayload(payload, runs, context) {
  if (!Array.isArray(payload.samples_ms) || payload.samples_ms.length !== runs ||
      payload.samples_ms.some((sample) => !Number.isFinite(sample) || sample < 0)) {
    throw new Error(`${context} must return ${runs} finite nonnegative timing samples`);
  }
  if (!Number.isFinite(payload.result) ||
      !Array.isArray(payload.sample_values) || payload.sample_values.length !== runs ||
      payload.sample_values.some((value) => !Number.isFinite(value) || value !== payload.result)) {
    throw new Error(`${context} must return ${runs} identical finite results`);
  }
}

function languageDefinitions(tools, nativeCompiler, requestedLanguages = null, numericSsaResearch = false) {
  const nativeRuntimeBatch = nativeCompiler.processTimer
    ? (output, warmups, runs) => nativeProcessSamples(
        nativeCompiler.processTimer, output, warmups, runs)
    : null;
  const nativeEntryRuntimeBatch = (artifact, warmups, runs) => {
    const code = typeof artifact === 'string' ? artifact : artifact.code;
    const data = typeof artifact === 'string' ? null : artifact.data;
    let researchReceipt = null;
    if (numericSsaResearch && process.arch === 'x64' && artifact?.typedIr &&
        artifact?.functionPolicyReceipt?.parallelWidth !== 2) {
      const dumper = process.env.VKF_NUMERIC_SSA_DUMPER;
      if (!dumper) throw new Error('changed-backend research requires VKF_NUMERIC_SSA_DUMPER');
      const result = runCommand(process.env.VKF_NUMERIC_SSA_PYTHON || 'python', [
        resolve(repoRoot, 'compiler/native/diagnostics/llvm-numeric/source-entry-timer.py'),
        dumper, artifact.typedIr, code, String(warmups), String(runs),
        resolve(dirname(artifact.typedIr), 'numeric-ssa-research')
      ], { timeoutMs: 600_000 });
      const payload = JSON.parse(result.stdout);
      researchReceipt = payload.research_receipt;
      if (payload.eligible) {
        assertNativeTimingPayload(payload, runs, 'changed numeric SSA entry timer');
        return {
          samples: payload.samples_ms.map(Number), value: Number(payload.result),
          affinityCpu: Number(payload.affinity_cpu), parallelReceipt: null, researchReceipt
        };
      }
    } else if (numericSsaResearch) {
      researchReceipt = {
        research_only: true, selected_backend: 'existing-native', changed_backend_executed: false,
        candidate_rejected_reason: process.arch !== 'x64'
          ? 'SSA research policy has only been validated on x64'
          : 'parallel/runtime entry retains the validated native artifact'
      };
    }
    const result = runCommand(nativeCompiler.entryTimer, [
      code,
      ...(data ? [data] : []),
      String(warmups),
      String(runs),
      ...(artifact?.functionPolicyReceipt?.parallelWidth === 2 ? ['2'] : [])
    ]);
    const payload = JSON.parse(result.stdout);
    assertNativeTimingPayload(payload, runs, 'native entry timer');
    return {
      samples: payload.samples_ms.map(Number),
      value: Number(payload.result),
      affinityCpu: Number(payload.affinity_cpu),
      researchReceipt,
      parallelReceipt: Number(payload.parallel_width) === 2
        ? Object.freeze({
            width: Number(payload.parallel_width),
            threadsCreated: Number(payload.threads_created),
            threadsJoined: Number(payload.threads_joined),
            threadHandlesClosed: Number(payload.thread_handles_closed)
          })
        : null
    };
  };
  const nativeLibraryRuntimeBatch = (library, warmups, runs) => {
    const result = runCommand(nativeCompiler.libraryTimer, [
      library, String(warmups), String(runs)
    ]);
    const payload = JSON.parse(result.stdout);
    assertNativeTimingPayload(payload, runs, 'native library timer');
    return {
      samples: payload.samples_ms.map(Number),
      value: Number(payload.result),
      affinityCpu: Number(payload.affinity_cpu)
    };
  };
  const enabled = (language) => requestedLanguages === null || requestedLanguages.has(language);
  const definitions = [
    Object.freeze({
      id: 'vkf',
      extension: 'vkf',
      version: `${runCommand(nativeCompiler.driver, ['-v']).stdout.trim()}; built with ${toolVersion(tools.cpp)}`,
      compileModel: `fresh VKF process + fail-closed automatic retained-policy lookup + Python-free integrated frontend + compiler-owned direct ${process.arch} artifact`,
      freshSourcePerCompile: true,
      trainFunctionPolicyLandscape(source, runs, { optimizerCacheRoot }) {
        const result = runCommand(
          nativeCompiler.driver,
          vkfFunctionLandscapeTrainingArguments(source, runs),
          { timeoutMs: 3_600_000, env: vkfOptimizerCacheEnvironment(optimizerCacheRoot) }
        );
        const summary = JSON.parse(result.stdout);
        const receipt = vkfFunctionPolicyReceipt(summary);
        const candidates = summary.empirical_tuning?.candidates;
        assertVkfFunctionPolicyLandscape(receipt, candidates, runs, source);
        return Object.freeze({
          elapsedMs: result.elapsedMs,
          internalElapsedMs: Number(summary.total_ms),
          optimizerElapsedMs: Number(summary.optimizer_ms),
          landscapeRuns: runs,
          normalizedToBaselineCount: (candidates ?? []).filter(
            (candidate) => candidate.normalized_to_baseline === true
          ).length,
          policyEvidence: vkfPolicyEvidence(summary),
          ...receipt
        });
      },
      compile(source, _output, {
        reuseFunctionPolicy = false,
        optimizerCacheRoot,
        optimizerPolicy = 'auto'
      } = {}) {
        const execution = { timeoutMs: 600_000 };
        if (optimizerCacheRoot) {
          execution.env = vkfOptimizerCacheEnvironment(optimizerCacheRoot);
        }
        const result = runCommand(
          nativeCompiler.driver,
          vkfCompileArguments(source, { reuseFunctionPolicy, optimizerPolicy }),
          execution
        );
        const summary = JSON.parse(result.stdout);
        const functionPolicyReceipt = vkfFunctionPolicyReceipt(summary);
        return {
          ...result,
          internalElapsedMs: Number(summary.total_ms),
          optimizerElapsedMs: Number(summary.optimizer_ms),
          optimizerPolicy: measuredVkfOptimizerPolicy(summary),
          optimizerCacheHit: Boolean(summary.optimizer_cache_hit),
          policyEvidence: vkfPolicyEvidence(summary),
          functionPolicyReceipt,
          machineCodeFingerprint: String(summary.machine_code_fingerprint),
          runtimeArtifact: summary.artifact_path,
          artifactFallback: Boolean(summary.artifact_fallback),
          artifactFallbackReason: summary.artifact_fallback_reason || ''
        };
      },
      runtime(output) {
        return runCommand(output, []);
      },
      runtimeBatch: nativeRuntimeBatch,
      prepareNativeRuntime(
        source,
        optimizerPolicy,
        { optimizerCacheRoot, reuseFunctionPolicy = false } = {}
      ) {
        const execution = { timeoutMs: 600_000 };
        if (optimizerCacheRoot) {
          execution.env = vkfOptimizerCacheEnvironment(optimizerCacheRoot);
        }
        const result = runCommand(
          nativeCompiler.driver,
          vkfRuntimePreparationArguments(source, optimizerPolicy, { reuseFunctionPolicy }),
          execution
        );
        const summary = JSON.parse(result.stdout);
        const manifest = JSON.parse(readFileSync(summary.manifest_path, 'utf8'));
        const functionPolicyReceipt = vkfFunctionPolicyReceipt(summary, manifest);
        return {
          code: manifest.code_path,
          typedIr: summary.typed_ir_path,
          data: manifest.data_path,
          executable: summary.artifact_path,
          optimizerPolicy: functionPolicyReceipt.selectedPolicy,
          machineCodeFingerprint: summary.machine_code_fingerprint,
          functionPolicyReceipt,
          policyEvidence: vkfPolicyEvidence(summary, manifest)
        };
      },
      nativeRuntimeBatch: nativeEntryRuntimeBatch
    }),
  ];
  if (enabled('c')) definitions.push(Object.freeze({
      id: 'c',
      extension: 'c',
      version: toolVersion(tools.c),
      compileModel: 'Clang -O3 -march=native native link',
      compile(source, output) {
        return runCommand(tools.c.command, [
          '-O3', '-march=native', '-std=c17', source, '-o', output,
          ...(platform() === 'win32' ? [] : ['-lm'])
        ]);
      },
      runtime(output) {
        return runCommand(output, []);
      },
      runtimeBatch: nativeRuntimeBatch,
      prepareNativeRuntime(source) {
        const output = `${source}${libraryExtension}`;
        runCommand(tools.c.command, [
          '-O3', '-march=native', '-std=c17', '-shared',
          ...(platform() === 'win32' ? [] : ['-fPIC']),
          source, '-o', output,
          ...(platform() === 'win32' ? [] : ['-lm'])
        ]);
        return output;
      },
      nativeRuntimeBatch: nativeLibraryRuntimeBatch
    }));
  if (enabled('cpp')) definitions.push(Object.freeze({
      id: 'cpp',
      extension: 'cpp',
      version: toolVersion(tools.cpp),
      compileModel: 'Clang++ -O3 -march=native strict IEEE native link',
      compile(source, output) {
        return runCommand(tools.cpp.command, [
          '-O3', '-march=native', '-std=c++17',
          ...strictFloatingPointCompileFlags(), source, '-o', output,
          ...(platform() === 'win32' ? [] : ['-lm'])
        ]);
      },
      runtime(output) {
        return runCommand(output, []);
      },
      runtimeBatch: nativeRuntimeBatch,
      prepareNativeRuntime(source) {
        const output = `${source}${libraryExtension}`;
        runCommand(tools.cpp.command, [
          '-O3', '-march=native', '-std=c++17',
          ...strictFloatingPointCompileFlags(), '-shared',
          ...(platform() === 'win32' ? [] : ['-fPIC']),
          source, '-o', output,
          ...(platform() === 'win32' ? [] : ['-lm'])
        ]);
        return output;
      },
      nativeRuntimeBatch: nativeLibraryRuntimeBatch
    }));
  if (enabled('python-efficient')) {
    const pythonRuntime = (source) => runCommand(
      tools.python.command,
      [...tools.python.prefix, source],
      { env: { PYTHONDONTWRITEBYTECODE: '1' } }
    );
    const pythonCompile = (source, output) => runCommand(tools.python.command, [
      ...tools.python.prefix,
      '-c',
      'import py_compile,sys;py_compile.compile(sys.argv[1],cfile=sys.argv[2],doraise=True)',
      source,
      output
    ], { env: { PYTHONDONTWRITEBYTECODE: '1' } });
    const pythonVersion = toolVersion(tools.python);
    const packageVersions = runCommand(tools.python.command, [
      ...tools.python.prefix,
      '-c',
      "import numpy,scipy;print(f'NumPy {numpy.__version__}; SciPy {scipy.__version__}')"
    ]).stdout.trim();
    definitions.push(Object.freeze({
      id: 'python-efficient',
      extension: null,
      version: `${pythonVersion}; ${packageVersions}`,
      compileModel: 'CPython bytecode compile',
      compile: pythonCompile,
      runtime(_output, source) {
        return pythonRuntime(source);
      }
    }));
  }
  if (enabled('rust')) definitions.push(Object.freeze({
      id: 'rust',
      extension: 'rs',
      version: toolVersion(tools.rust),
      compileModel: 'rustc -O -C target-cpu=native native link',
      compile(source, output) {
        return runCommand(tools.rust.command, ['-O', '-C', 'target-cpu=native', source, '-o', output]);
      },
      runtime(output) {
        return runCommand(output, []);
      },
      runtimeBatch: nativeRuntimeBatch,
      prepareNativeRuntime(source) {
        const output = `${source}${libraryExtension}`;
        runCommand(tools.rust.command, [
          '-O', '-C', 'target-cpu=native', '--crate-type', 'cdylib', source, '-o', output
        ]);
        return output;
      },
      nativeRuntimeBatch: nativeLibraryRuntimeBatch
    }));
  if (enabled('zig')) definitions.push(Object.freeze({
    id: 'zig',
    extension: 'zig',
    version: toolVersion(tools.zig),
    compileModel: 'zig build-exe -O ReleaseFast -mcpu native -lc',
    compile(source, output) {
      return runCommand(tools.zig.command, [
        'build-exe', source, '-O', 'ReleaseFast', '-mcpu', 'native', '-lc',
        `-femit-bin=${output}`
      ], { timeoutMs: 600_000 });
    },
    runtime(output) {
      return runCommand(output, []);
    },
    runtimeBatch: nativeRuntimeBatch,
    prepareNativeRuntime(source) {
      const output = `${source}${libraryExtension}`;
      runCommand(tools.zig.command, [
        'build-lib', source, '-dynamic', '-O', 'ReleaseFast', '-mcpu', 'native', '-lc',
        `-femit-bin=${output}`
      ], { timeoutMs: 600_000 });
      return output;
    },
    nativeRuntimeBatch: nativeLibraryRuntimeBatch
  }));
  if (enabled('go')) definitions.push(Object.freeze({
    id: 'go',
    extension: 'go',
    version: toolVersion(tools.go),
    compileModel: 'go build -trimpath -ldflags=-s -w',
    compile(source, output) {
      return runCommand(tools.go.command, [
        'build', '-trimpath', '-ldflags=-s -w', '-o', output, source
      ]);
    },
    runtime(output) {
      return runCommand(output, []);
    },
    runtimeBatch: nativeRuntimeBatch
  }));
  if (enabled('julia')) definitions.push(Object.freeze({
    id: 'julia',
    extension: 'jl',
    version: toolVersion(tools.julia),
    compileModel: 'Julia source parse in a fresh process (not native AOT compilation)',
    compile(source, output) {
      return runCommand(tools.julia.command, [
        '--startup-file=no', '--history-file=no', '-e',
        'source=read(ARGS[1],String);Meta.parse("begin\\n"*source*"\\nend");write(ARGS[2],"parsed")',
        source, output
      ]);
    },
    runtime(_output, source) {
      return runCommand(tools.julia.command, [
        '--startup-file=no', '--history-file=no', source
      ]);
    }
  }));
  return Object.freeze(definitions);
}

export function parseNumericOutput(stdout, languageId, caseId) {
  const text = String(stdout).trim();
  const tokens = text.length === 0 ? [] : text.split(/\s+/);
  if (tokens.length !== 1) {
    throw new Error(
      `${languageId}/${caseId} must print exactly one numeric result; got ${tokens.length}: ${stdout}`
    );
  }
  const value = Number(tokens[0]);
  if (!Number.isFinite(value)) {
    throw new Error(`${languageId}/${caseId} did not print one finite numeric result: ${stdout}`);
  }
  return value;
}

function materializeSource(language, benchmarkCase, caseWork) {
  let extension = language.extension;
  if (language.id === 'python-efficient') {
    extension = benchmarkCase.pythonExtension || 'scipy.py';
  }
  const publishedExtension = language.id === 'python-efficient' ? 'py' : extension;
  const published = resolve(
    benchmarkRoot,
    'published',
    benchmarkCase.sourceCaseId ?? benchmarkCase.id,
    `${language.id}.${publishedExtension}`
  );
  let template = existsSync(published)
    ? published
    : sourcePath(benchmarkCase.template, extension);
  if (language.id === 'cpp' && !existsSync(template)) {
    template = sourcePath(benchmarkCase.template, 'c');
  }
  let text = readFileSync(template, 'utf8');
  if (language.id === 'cpp') text = cppBenchmarkSource(text);
  if (language.id === 'vkf' && benchmarkCase.parallelCombined) {
    text = parallelCombinedVkfSource(text, benchmarkCase.maxCores);
  }
  if (benchmarkCase.count !== undefined) {
    text = text.replaceAll('{{COUNT}}', String(benchmarkCase.count));
    text = text.replaceAll(
      '{{VALUES}}',
      Array.from(
        { length: benchmarkCase.count },
        (_, index) => benchmarkCase.explicitF64Values ? `${index + 1}.0` : String(index + 1)
      ).join(', ')
    );
    text = text.replaceAll(
      '{{VALIDATION_VALUES}}',
      Array.from(
        { length: benchmarkCase.count },
        (_, index) => (index + 1) % 97 === 0 ? `${index + 1}.5` : `${index + 1}.0`
      ).join(', ')
    );
  }
  const sources = resolve(caseWork, 'sources');
  mkdirSync(sources, { recursive: true });
  const source = resolve(sources, `${language.id}.${extension}`);
  writeFileSync(source, text, 'utf8');
  return Object.freeze({ source, template });
}

function compileLanguageCase(language, benchmarkCase, options, caseWork) {
  const configuredCase = benchmarkCase.parallelCombined
    ? { ...benchmarkCase, maxCores: options.maxCores }
    : benchmarkCase;
  const { source, template } = materializeSource(language, configuredCase, caseWork);
  const optimizerCacheRoot = resolve(workRoot, 'function-policy-cache');
  const functionPolicyTraining = options.functionLandscapeRuns > 0 &&
      language.trainFunctionPolicyLandscape
    ? language.trainFunctionPolicyLandscape(source, options.functionLandscapeRuns, {
        optimizerCacheRoot
      })
    : null;
  const samples = [];
  const internalCompileSamples = [];
  const optimizerSamples = [];
  let runtimeArtifact = null;
  let optimizerPolicy = null;
  let machineCodeFingerprint = null;
  let artifactFallback = false;
  let artifactFallbackReason = '';
  let policyEvidenceId = null;
  const policyExperiments = [];
  const optimizerCompileReceipts = [];
  if (functionPolicyTraining?.policyEvidence) {
    policyEvidenceId = retainVkfPolicyExperiment(policyExperiments,
      functionPolicyTraining.policyEvidence, {
      phase: 'explicit-training', index: 0
    });
  }
  const total = options.compileWarmups + options.compileRuns;
  const compileSources = [];
  for (let index = 0; index < total; index += 1) {
    if (!language.freshSourcePerCompile) {
      compileSources.push(source);
      continue;
    }
    const freshRoot = resolve(caseWork, 'fresh-sources', String(index));
    mkdirSync(freshRoot, { recursive: true });
    // Keep each compile isolated while preserving the source-graph identity.
    // Native build fingerprints deliberately include the source filename, so
    // index-specific filenames would prevent an identical measured compile
    // from reusing the warmup's retained optimization proof.
    const freshSource = resolve(freshRoot, `program.${language.extension}`);
    writeFileSync(freshSource, readFileSync(source));
    compileSources.push(freshSource);
  }
  for (let index = 0; index < total; index += 1) {
    const suffix = language.id === 'python-efficient' ? '.pyc' : executableExtension;
    const output = resolve(caseWork, `${language.id}-compile-${index}${suffix}`);
    const result = language.compile(compileSources[index], output, {
      reuseFunctionPolicy: functionPolicyTraining !== null,
      optimizerCacheRoot,
      optimizerPolicy: 'auto'
    });
    if (result.functionPolicyReceipt) {
      optimizerCompileReceipts.push({
        phase: index < options.compileWarmups ? 'compile-warmup' : 'compile-measured',
        index, elapsedMs: result.elapsedMs,
        internalElapsedMs: result.internalElapsedMs,
        optimizerElapsedMs: result.optimizerElapsedMs,
        receipt: result.functionPolicyReceipt
      });
    }
    if (language.id === 'vkf' && benchmarkCase.requiresDirectVkf && result.artifactFallback) {
      throw new Error(`${benchmarkCase.id} requires direct VKF machine code: ${result.artifactFallbackReason}`);
    }
    // The unmeasured compile warmup may establish the separate proof-gated
    // parallel scheduling decision. Every measured compile must reuse both
    // that decision and the already trained function-policy composition.
    if (functionPolicyTraining && index >= options.compileWarmups) {
      const assertReuse = benchmarkCase.parallelCombined
        ? assertVkfFunctionCompositionReuse
        : assertVkfFunctionPolicyReuse;
      assertReuse(
        functionPolicyTraining,
        result.functionPolicyReceipt,
        `${benchmarkCase.id} measured compile ${index}`
      );
    }
    if (index >= options.compileWarmups) {
      samples.push(result.elapsedMs);
      if (Number.isFinite(result.internalElapsedMs)) {
        internalCompileSamples.push(result.internalElapsedMs);
      }
      if (Number.isFinite(result.optimizerElapsedMs)) {
        optimizerSamples.push(result.optimizerElapsedMs);
      }
    }
    runtimeArtifact = result.runtimeArtifact || output;
    optimizerPolicy = benchmarkCase.parallelCombined && language.id === 'vkf'
      ? 'auto'
      : result.optimizerPolicy || null;
    machineCodeFingerprint = result.machineCodeFingerprint || null;
    artifactFallback = result.artifactFallback || false;
    artifactFallbackReason = result.artifactFallbackReason || '';
    policyEvidenceId = retainVkfPolicyExperiment(policyExperiments, result.policyEvidence, {
      phase: index < options.compileWarmups ? 'compile-warmup' : 'compile-measured',
      index
    }) ?? policyEvidenceId;
  }
  const nativeRuntimeArtifact = language.prepareNativeRuntime
    ? language.prepareNativeRuntime(source, optimizerPolicy, {
        optimizerCacheRoot,
        reuseFunctionPolicy: functionPolicyTraining !== null
      })
    : null;
  if (nativeRuntimeArtifact?.executable) {
    runtimeArtifact = nativeRuntimeArtifact.executable;
    optimizerPolicy = nativeRuntimeArtifact.optimizerPolicy;
    machineCodeFingerprint = nativeRuntimeArtifact.machineCodeFingerprint;
    policyEvidenceId = retainVkfPolicyExperiment(
      policyExperiments, nativeRuntimeArtifact.policyEvidence,
      { phase: 'runtime-preparation', index: 0 }) ?? policyEvidenceId;
  }
  if (functionPolicyTraining) {
    const assertReuse = benchmarkCase.parallelCombined
      ? assertVkfFunctionCompositionReuse
      : assertVkfFunctionPolicyReuse;
    assertReuse(
      functionPolicyTraining,
      nativeRuntimeArtifact.functionPolicyReceipt,
      benchmarkCase.id
    );
  }
  const executionReceipt = nativeRuntimeArtifact?.functionPolicyReceipt ?? null;
  if (benchmarkCase.parallelCombined && language.id === 'vkf') {
    assertVkfParallelExecutionReceipt(
      executionReceipt,
      options.maxCores,
      `${benchmarkCase.id}/${process.platform}-${process.arch}`
    );
  }
  const { policyEvidence: _trainingEvidence, ...trainingReport } = functionPolicyTraining ?? {};
  return {
    source,
    sourceTemplate: relative(repoRoot, template).replaceAll('\\', '/'),
    sourceTemplateSha256: sourceFileSha256(template),
    sourceSha256: sourceFileSha256(source),
    runtimeArtifact,
    nativeRuntimeArtifact,
    nativeCodeSha256: nativeRuntimeArtifact
      ? fileSha256(typeof nativeRuntimeArtifact === 'string'
          ? nativeRuntimeArtifact
          : nativeRuntimeArtifact.code)
      : null,
    optimizerPolicy,
    machineCodeFingerprint,
    functionPolicies: functionPolicyTraining?.functionPolicies ?? null,
    functionPolicyTraining: functionPolicyTraining ? trainingReport : null,
    executionReceipt,
    policyEvidenceId,
    policyExperiments,
    optimizerCompileReceipts,
    compileModel: functionPolicyTraining
      ? `explicit incremental 256-mask landscape per canonical function (${options.functionLandscapeRuns} exact samples/distinct emitted artifact), then full-program composition cache hits with zero optimizer runs`
      : language.compileModel,
    samples,
    internalCompileSamples: internalCompileSamples.length > 0 ? internalCompileSamples : null,
    optimizerSamples: optimizerSamples.length > 0 ? optimizerSamples : null,
    artifactFallback,
    artifactFallbackReason
  };
}

function runLanguageCase(language, benchmarkCase, compiled, options) {
  if (language.runtimeBatch) {
    const validation = language.runtime(compiled.runtimeArtifact, compiled.source);
    const value = parseNumericOutput(validation.stdout, language.id, benchmarkCase.id);
    const samples = language.runtimeBatch(
      compiled.runtimeArtifact,
      options.warmups,
      options.runs
    );
    return { samples, value };
  }
  const samples = [];
  const values = [];
  const total = options.warmups + options.runs;
  for (let index = 0; index < total; index += 1) {
    const result = language.runtime(compiled.runtimeArtifact, compiled.source);
    const value = parseNumericOutput(result.stdout, language.id, benchmarkCase.id);
    if (index >= options.warmups) {
      samples.push(result.elapsedMs);
      values.push(value);
    }
  }
  if (!values.every((value) => valuesAgree(
    value, values[0], benchmarkCase.tolerance, benchmarkCase.absoluteTolerance
  ))) {
    throw new Error(`${language.id}/${benchmarkCase.id} produced unstable results`);
  }
  return { samples, value: values[0] };
}

export function assertCrossLanguageParity(caseId, tolerance, results, absoluteTolerance) {
  if (results.length < 2) return;
  const referenceResult = results.find(({ language }) => language === 'python-efficient')
    ?? results[0];
  for (const result of results) {
    if (!valuesAgree(referenceResult.value, result.value, tolerance, absoluteTolerance)) {
      throw new Error(
        `${caseId} mismatch: ${referenceResult.language}=${referenceResult.value}, ` +
        `${result.language}=${result.value}`
      );
    }
  }
}

export function benchmarkCorrectness(benchmarkCases, results) {
  const failures = [];
  for (const benchmarkCase of benchmarkCases) {
    try {
      assertCrossLanguageParity(
        benchmarkCase.id, benchmarkCase.tolerance,
        results.filter((result) => result.case === benchmarkCase.id),
        benchmarkCase.absoluteTolerance
      );
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { passed: failures.length === 0, failures };
}

function cleanWorkRoot() {
  const repositoryWorkRoot = resolve(benchmarkRoot, '.work');
  const temporaryWorkRoot = resolve(tmpdir(), 'vektor-flow-core-comparison');
  const expectedRepositoryRoot = workRoot === repositoryWorkRoot
    && dirname(workRoot) === resolve(benchmarkRoot);
  const expectedWindowsTemporaryRoot = platform() === 'win32'
    && workRoot === temporaryWorkRoot
    && dirname(workRoot) === resolve(tmpdir());
  if (!expectedRepositoryRoot && !expectedWindowsTemporaryRoot) {
    throw new Error(`refusing to clean unexpected work path: ${workRoot}`);
  }
  if (process.env.VKF_BENCH_REUSE_NATIVE_TOOLS === '1') {
    mkdirSync(workRoot, { recursive: true });
    for (const entry of readdirSync(workRoot, { withFileTypes: true })) {
      if (entry.name === 'native-compiler') continue;
      rmSync(resolve(workRoot, entry.name), { recursive: true, force: true });
    }
    return;
  }
  rmSync(workRoot, { recursive: true, force: true });
  mkdirSync(workRoot, { recursive: true });
}

function formatMs(value) {
  return value.toFixed(3);
}

function meanStd(stats) {
  return `${formatMs(stats.meanMs)} ± ${formatMs(stats.stddevMs)}`;
}

function markdownTable(payload, metric) {
  const allLanguages = broadLanguageSet;
  const languages = allLanguages.filter((language) => payload.results.some((result) => result.language === language));
  const labels = {
    vkf: 'VKF', c: 'C', cpp: 'C++', 'python-efficient': 'Python efficient',
    rust: 'Rust', zig: 'Zig', go: 'Go', julia: 'Julia'
  };
  const title = metric === 'compile' ? 'Compile time (ms)'
    : metric === 'nativeRuntime' ? 'Raw kernel runtime (ms)'
    : 'Runtime (ms)';
  const lines = [
    `## ${title}`,
    '',
    `| operation | mode | data | size | count | ${languages.map((language) => labels[language]).join(' | ')} |`,
    `| --- | --- | --- | --- | ---: | ${languages.map(() => '---:').join(' | ')} |`
  ];
  for (const benchmarkCase of payload.cases) {
    const byLanguage = new Map(payload.results
      .filter((result) => result.case === benchmarkCase.id)
      .map((result) => [result.language, result]));
    lines.push([
      benchmarkCase.operation,
      benchmarkCase.comparisonMode,
      benchmarkCase.data,
      benchmarkCase.size,
      benchmarkCase.count ?? 0,
      ...languages.map((language) => {
        const result = byLanguage.get(language);
        return result?.[metric] ? meanStd(result[metric]) : 'N/A';
      })
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }
  return lines.join('\n');
}

export function nativeRuntimeRatioTable(payload) {
  const rows = [];
  for (const benchmarkCase of payload.cases) {
    const caseResults = payload.results.filter((result) => result.case === benchmarkCase.id);
    const vkf = caseResults.find((result) => result.language === 'vkf');
    if (!vkf?.nativeRuntime) continue;
    const ratio = (language) => {
      const peer = caseResults.find((result) => result.language === language);
      return peer?.nativeRuntime
        ? `${(vkf.nativeRuntime.meanMs / peer.nativeRuntime.meanMs).toFixed(3)}×`
        : 'N/A';
    };
    rows.push(`| ${benchmarkCase.operation} | ${ratio('cpp')} | ${ratio('rust')} | ${ratio('zig')} |`);
  }
  return rows.length === 0 ? [] : [
    '',
    '## VKF raw-kernel runtime ratio',
    '',
    'VKF time divided by the peer time on the same pinned CPU; below 1× means VKF is faster.',
    '',
    '| operation | VKF / C++ | VKF / Rust | VKF / Zig |',
    '| --- | ---: | ---: | ---: |',
    ...rows
  ];
}

function createReport(payload) {
  const functionTrainingResults = payload.results.filter((result) => result.functionPolicyTraining);
  const functionTrainingTable = functionTrainingResults.length === 0 ? [] : [
    '',
    '## VKF incremental per-function policy landscape',
    '',
    'This one-time search is separate from cached compilation. Adaptive masks select lowering only; parallel execution remains a separate proof-gated decision.',
    '',
    '| operation | searched | reused | masks | rejected → baseline | wall (ms) | function policy | module ABI | function winners | parallel eligible / selected | threads created / joined / closed |',
    '| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- | --- |',
    ...functionTrainingResults.map((result) => {
      const training = result.functionPolicyTraining;
      const winners = training.functionPolicies
        .map(({ name, selectedPolicy }) => `${name}: ${selectedPolicy}`).join('; ');
      return `| ${result.operation} | ${training.searchCount} | ${training.reusedCount} | ${training.candidateCount} | ${training.normalizedToBaselineCount} | ${formatMs(training.elapsedMs)} | ${training.selectedPolicy} | ${training.moduleAbiPolicy} | ${winners} | ${training.parallelEligible} / ${training.parallelSelected} | ${training.parallelThreadsCreated} / ${training.parallelThreadsJoined} / ${training.parallelThreadHandlesClosed} |`;
    })
  ];
  const internalCompileResults = payload.results.filter((result) => result.internalCompile);
  const internalCompileTable = internalCompileResults.length === 0 ? [] : [
    '',
    '## VKF internal compiler-core time, including optimizer (ms)',
    '',
    '| operation | data | size | count | VKF |',
    '| --- | --- | --- | ---: | ---: |',
    ...internalCompileResults.map((result) =>
      `| ${result.operation} | ${result.data} | ${result.size} | ${result.count} | ${meanStd(result.internalCompile)} |`
    )
  ];
  const optimizerResults = payload.results.filter((result) => result.optimizer);
  const optimizerTable = optimizerResults.length === 0 ? [] : [
    '',
    '## VKF empirical optimizer time within compilation (ms)',
    '',
    '| operation | data | size | count | VKF |',
    '| --- | --- | --- | ---: | ---: |',
    ...optimizerResults.map((result) =>
      `| ${result.operation} | ${result.data} | ${result.size} | ${result.count} | ${meanStd(result.optimizer)} |`
    )
  ];
  const hasNativeRuntime = payload.results.some((result) => result.nativeRuntime);
  return [
    '# Core language benchmark',
    '',
    `${payload.options.compileRuns} compile runs, ${payload.options.processRuns} fresh-process runs, and ${payload.options.runs} raw runtime runs. Values shown as mean ± sample standard deviation in ms. Compile warmups: ${payload.options.compileWarmups}. Process warmups: ${payload.options.processWarmups}. Raw runtime warmups: ${payload.options.warmups}.`,
    '',
    'Matched rows keep the same algorithm. Idiomatic rows allow each ecosystem\'s normal optimized implementation; inspect the linked source before comparing them.',
    ...(payload.correctness?.passed === false ? [
      '', '## Invalid correctness results', '',
      'These measurements failed numerical validation and are not accepted benchmark results.',
      ...payload.correctness.failures.map((failure) => `- ${failure}`)
    ] : []),
    ...functionTrainingTable,
    '',
    markdownTable(payload, 'compile'),
    '',
    markdownTable(payload, 'runtime'),
    ...internalCompileTable,
    ...optimizerTable,
    ...(hasNativeRuntime ? [
      '',
      markdownTable(payload, 'nativeRuntime'),
      ...nativeRuntimeRatioTable(payload)
    ] : []),
    ''
  ].join('\n');
}

const VKF_ACCEPTANCE_BUDGETS = new Map([
  ['scalar-control-small', { compileMeanMs: 10, nativeRuntimeMeanMs: 0.5 }]
]);

export function assertVkfAcceptanceBudgets(results) {
  const failures = [];
  for (const result of results) {
    if (result.language !== 'vkf' || result.internalCompile?.count < 100 ||
        result.nativeRuntime?.count < 100) continue;
    const budget = VKF_ACCEPTANCE_BUDGETS.get(result.case);
    if (!budget) continue;
    if (result.internalCompile.meanMs >= budget.compileMeanMs) {
      failures.push(
        `${result.case} compiler core ${result.internalCompile.meanMs.toFixed(6)} ms must be under ` +
        `${budget.compileMeanMs.toFixed(3)} ms`
      );
    }
    if (result.nativeRuntime.meanMs >= budget.nativeRuntimeMeanMs) {
      failures.push(
        `${result.case} raw runtime ${result.nativeRuntime.meanMs.toFixed(6)} ms must be under ` +
        `${budget.nativeRuntimeMeanMs.toFixed(3)} ms`
      );
    }
  }
  if (failures.length > 0) {
    throw new Error(`VKF acceptance budget exceeded: ${failures.join('; ')}`);
  }
}

export function assertVkfRelativeKernelGate(
  results,
  { maxRatio = 1.5, minimumSamples = 100,
    cases = ['spectral-norm-large', 'fannkuch-redux-large', 'n-body-large'],
    competitors = ['cpp', 'rust', 'zig'] } = {}
) {
  const failures = [];
  for (const caseId of cases) {
    const rows = results.filter((result) => result.case === caseId);
    const vkf = rows.find((result) => result.language === 'vkf');
    if (!vkf || vkf.nativeRuntime?.count < minimumSamples) {
      failures.push(
        `${caseId} vs peers: VKF needs ${minimumSamples} raw samples`
      );
      continue;
    }
    for (const language of competitors) {
      const competitor = rows.find((result) => result.language === language);
      if (!competitor || competitor.nativeRuntime?.count < minimumSamples) {
        failures.push(
          `${caseId} vs ${language}: both lanes need ${minimumSamples} raw samples`
        );
        continue;
      }
      const ratio = vkf.nativeRuntime.meanMs / competitor.nativeRuntime.meanMs;
      if (!(ratio < maxRatio)) {
        failures.push(`${caseId} vs ${language}: ${ratio.toFixed(4)}x must be under ${maxRatio.toFixed(1)}x`);
      }
    }
  }
  if (failures.length > 0) {
    throw new Error(`VKF relative kernel gate exceeded: ${failures.join('; ')}`);
  }
}

function printReport(payload, report, resultsPath, reportPath) {
  console.log(`Core comparison: compile ${payload.options.compileRuns} measured runs; process ${payload.options.processRuns} measured runs; raw runtime ${payload.options.runs} measured runs`);
  console.log(report);
  console.log(`JSON: ${relative(repoRoot, resultsPath)}`);
  console.log(`Table: ${relative(repoRoot, reportPath)}`);
}

export function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  const resultsPath = resolve(resultsRoot, `${options.outputStem}.json`);
  const reportPath = resolve(resultsRoot, `${options.outputStem}.md`);
  const requestedCaseIds = options.caseId === null
    ? null
    : options.caseId.split(',').filter(Boolean);
  const casesById = new Map(cases.map((benchmarkCase) => [benchmarkCase.id, benchmarkCase]));
  if (requestedCaseIds !== null) {
    for (const caseId of requestedCaseIds) {
      if (!casesById.has(caseId)) throw new Error(`unknown benchmark case: ${caseId}`);
    }
  }
  const selectedCases = requestedCaseIds === null
    ? cases
    : requestedCaseIds.map((caseId) => casesById.get(caseId));
  if (selectedCases.length === 0) throw new Error(`unknown benchmark case: ${options.caseId}`);
  const requestedLanguages = options.languageId === null
    ? null
    : new Set(options.languageId.split(',').filter(Boolean));
  const supportedLanguages = new Set(broadLanguageSet);
  if (requestedLanguages) {
    for (const languageId of requestedLanguages) {
      if (!supportedLanguages.has(languageId)) {
        throw new Error(`unknown benchmark language: ${languageId}`);
      }
    }
  }
  const python = requestedLanguages === null || requestedLanguages.has('python-efficient')
    ? firstTool([
    {
      command: 'py',
      prefix: ['-3.13'],
      versionArgs: ['-3.13', '--version'],
      probeArgs: ['-3.13', '-c', 'import numpy,scipy']
    },
    {
      command: 'py',
      prefix: ['-3'],
      versionArgs: ['-3', '--version'],
      probeArgs: ['-3', '-c', 'import numpy,scipy']
    },
    {
      command: 'python',
      prefix: [],
      versionArgs: ['--version'],
      probeArgs: ['-c', 'import numpy,scipy']
    },
    {
      command: 'python3',
      prefix: [],
      versionArgs: ['--version'],
      probeArgs: ['-c', 'import numpy,scipy']
    }
      ], 'Python')
    : null;
  const tools = Object.freeze({
    python,
    c: firstTool([
      { command: 'clang', versionArgs: ['--version'] },
      { command: 'gcc', versionArgs: ['--version'] },
      { command: 'cc', versionArgs: ['--version'] }
    ], 'C compiler'),
    cpp: firstTool([
      { command: 'clang++', versionArgs: ['--version'] },
      { command: 'g++', versionArgs: ['--version'] }
    ], 'C++ compiler'),
    rust: requestedLanguages === null || requestedLanguages.has('rust')
      ? firstTool([{ command: 'rustc', versionArgs: ['--version'] }], 'Rust compiler')
      : null,
    zig: requestedLanguages === null || requestedLanguages.has('zig')
      ? firstTool([{ command: 'zig', versionArgs: ['version'] }], 'Zig compiler')
      : null,
    go: requestedLanguages === null || requestedLanguages.has('go')
      ? firstTool([{ command: 'go', versionArgs: ['version'] }], 'Go compiler')
      : null,
    julia: requestedLanguages === null || requestedLanguages.has('julia')
      ? firstTool([{ command: 'julia', versionArgs: ['--version'] }], 'Julia runtime')
      : null
  });
  cleanWorkRoot();
  const nativeCompiler = buildNativeCompilerTools(tools);
  const languages = languageDefinitions(tools, nativeCompiler, requestedLanguages, options.numericSsaResearch === true);
  const languageById = new Map(languages.map((language) => [language.id, language]));
  const results = [];
  for (const benchmarkCase of selectedCases) {
    const caseWork = resolve(workRoot, benchmarkCase.id);
    mkdirSync(caseWork, { recursive: true });
    const caseResults = [];
    const prepared = [];
    for (const languageId of benchmarkCase.languages) {
      if (requestedLanguages && !requestedLanguages.has(languageId)) continue;
      const language = languageById.get(languageId);
      if (!language) throw new Error(`unknown language lane: ${languageId}`);
      const compiled = compileLanguageCase(language, benchmarkCase, options, caseWork);
      prepared.push({ language, compiled });
    }
    const interleavedRuntime = interleavedProcessSamples(
      prepared,
      benchmarkCase,
      options.processWarmups,
      options.processRuns
    );
    const interleavedNativeRuntime = interleavedNativeRuntimeSamples(
      prepared,
      benchmarkCase,
      options.warmups,
      options.runs
    );
    for (const { language, compiled } of prepared) {
      const runtime = interleavedRuntime.get(language.id);
      const nativeRuntime = interleavedNativeRuntime.get(language.id) || null;
      if (nativeRuntime && !valuesAgree(
        nativeRuntime.value, runtime.value, benchmarkCase.tolerance,
        benchmarkCase.absoluteTolerance
      )) {
        throw new Error(
          `${language.id}/${benchmarkCase.id} raw result mismatch: executable=${runtime.value}, ` +
          `entry=${nativeRuntime.value}, policy=${compiled.optimizerPolicy || 'n/a'}, ` +
          `code=${compiled.machineCodeFingerprint || 'n/a'}`
        );
      }
      if (benchmarkCase.parallelCombined && language.id === 'vkf') {
        assertVkfParallelRuntimeReceipt(
          compiled.executionReceipt,
          nativeRuntime?.parallelReceipt,
          options.maxCores,
          `${benchmarkCase.id}/${process.platform}-${process.arch}`
        );
      }
      const result = Object.freeze({
        case: benchmarkCase.id,
        operation: benchmarkCase.operation,
        data: benchmarkCase.data,
        size: benchmarkCase.size,
        count: benchmarkCase.count ?? 0,
        comparisonMode: benchmarkCase.comparisonMode,
        approach: benchmarkCase.approach,
        language: language.id,
        version: language.version,
        compileModel: compiled.compileModel,
        artifactFallback: compiled.artifactFallback,
        artifactFallbackReason: compiled.artifactFallbackReason,
        source: Object.freeze({
          ...sourceSize(compiled.source),
          sha256: compiled.sourceSha256,
          template: compiled.sourceTemplate,
          templateSha256: compiled.sourceTemplateSha256
        }),
        compile: seriesStats(compiled.samples),
        internalCompile: compiled.internalCompileSamples
          ? seriesStats(compiled.internalCompileSamples)
          : null,
        optimizer: compiled.optimizerSamples ? seriesStats(compiled.optimizerSamples) : null,
        runtime: seriesStats(runtime.samples),
        nativeRuntime: nativeRuntime ? {
          ...seriesStats(nativeRuntime.samples),
          samplesMs: [...nativeRuntime.samples]
        } : null,
        nativeRuntimeAffinityCpu: nativeRuntime?.affinityCpu ?? null,
        nativeRuntimeParallelReceipt: nativeRuntime?.parallelReceipt ?? null,
        nativeRuntimeResearchReceipts: nativeRuntime?.researchReceipts ?? [],
        nativeCodeSha256: compiled.nativeCodeSha256,
        optimizerPolicy: compiled.optimizerPolicy,
        optimizerCacheHit: compiled.functionPolicyTraining ? true : null,
        functionPolicies: compiled.functionPolicies,
        functionPolicyTraining: compiled.functionPolicyTraining,
        executionReceipt: compiled.executionReceipt,
        policyEvidenceId: compiled.policyEvidenceId,
        policyExperiments: compiled.policyExperiments,
        optimizerCompileReceipts: compiled.optimizerCompileReceipts,
        machineCodeFingerprint: compiled.machineCodeFingerprint,
        value: runtime.value
      });
      caseResults.push(result);
      results.push(result);
    }
  }
  const startupMeans = new Map(
    results
      .filter((result) => result.case === 'startup')
      .map((result) => [result.language, result.runtime.meanMs])
  );
  const normalizedResults = results.map((result) => Object.freeze({
    ...result,
    runtime: Object.freeze({
      ...result.runtime,
      startupAdjustedMeanMs: Number(Math.max(
        0,
        result.runtime.meanMs - (startupMeans.get(result.language) || 0)
      ).toFixed(6))
    })
  }));
  const payload = Object.freeze({
    schema: 'vektor-flow/core-language-comparison-v1',
    ...(options.numericSsaResearch ? {
      compilerImplementation: 'experimental numeric SSA research over the native compiler; eligible ordinary entries only',
      productionReleaseEvidence: false
    } : {}),
    version: packageVersion,
    generatedAt: new Date().toISOString(),
    sourceRevision: spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoRoot, encoding: 'utf8', windowsHide: true
    }).stdout?.trim() || null,
    sourceModified: spawnSync('git', ['diff', '--quiet', 'HEAD', '--'], {
      cwd: repoRoot, windowsHide: true
    }).status !== 0,
    correctness: benchmarkCorrectness(selectedCases, normalizedResults),
    environment: Object.freeze({
      platform: `${platform()} ${release()}`,
      architecture: process.arch,
      cpu: cpus()[0]?.model || 'unknown',
      logicalCpuCount: cpus().length,
      node: process.version
    }),
    cases: selectedCases,
    options,
    results: normalizedResults
  });
  mkdirSync(dirname(resultsPath), { recursive: true });
  writeFileSync(resultsPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  const report = createReport(payload);
  writeFileSync(reportPath, report, 'utf8');
  printReport(payload, report, resultsPath, reportPath);
  if (!payload.correctness.passed) {
    throw new Error(payload.correctness.failures.join('\n'));
  }
  if (options.enforceRelativeGate) {
    assertVkfAcceptanceBudgets(normalizedResults);
    const relativeGateCases = selectedCases
      .map((benchmarkCase) => benchmarkCase.id)
      .filter((caseId) => [
        'spectral-norm-large',
        'fannkuch-redux-large',
        'n-body-large',
        'combined-kernels-large',
        'combined-kernels-parallel-large'
      ].includes(caseId));
    if (relativeGateCases.length > 0) {
      assertVkfRelativeKernelGate(normalizedResults, {
        maxRatio: options.relativeLimit,
        minimumSamples: options.runs,
        cases: relativeGateCases,
        competitors: ['cpp', 'rust', 'zig']
      });
    }
  }
  return payload;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
