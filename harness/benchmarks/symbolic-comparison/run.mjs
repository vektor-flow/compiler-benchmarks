import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpus,
  hostname,
  platform,
  arch,
  release,
  totalmem,
  tmpdir,
} from 'node:os';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const benchmarkRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(benchmarkRoot, '..', '..');
const executableSuffix = platform() === 'win32' ? '.exe' : '';
const expectedOutputs = Object.freeze({
  expand1: 39711,
  expand2: 6272,
  add1: 2998,
  series: 166167000,
});
const allKernels = Object.keys(expectedOutputs);
const allLanguages = ['vkf', 'symengine', 'sympy', 'symbolics'];

function parseArguments(argv) {
  const values = new Map();
  for (const argument of argv) {
    if (!argument.startsWith('--') || !argument.includes('=')) {
      throw new Error(`expected --name=value, received ${argument}`);
    }
    const [name, ...rest] = argument.slice(2).split('=');
    values.set(name, rest.join('='));
  }
  const list = (name, fallback) => (values.get(name) ?? fallback)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const integer = (name, fallback) => {
    const value = Number(values.get(name) ?? fallback);
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`--${name} must be a positive integer`);
    }
    return value;
  };
  const positiveNumber = (name, fallback) => {
    const value = Number(values.get(name) ?? fallback);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`--${name} must be a positive number`);
    }
    return value;
  };
  const boolean = (name, fallback) => {
    const value = values.get(name) ?? fallback;
    if (value !== 'true' && value !== 'false') {
      throw new Error(`--${name} must be true or false`);
    }
    return value === 'true';
  };
  const kernels = list('kernels', allKernels.join(','));
  const languages = list('languages', allLanguages.join(','));
  for (const kernel of kernels) {
    if (!allKernels.includes(kernel)) throw new Error(`unknown kernel ${kernel}`);
  }
  for (const language of languages) {
    if (!allLanguages.includes(language)) throw new Error(`unknown language ${language}`);
  }
  if (!languages.includes('vkf')) throw new Error('--languages must include vkf');
  return {
    compiler: resolve(values.get('compiler') ?? join(
      repoRoot,
      'build',
      'native-compiler-clang',
      'bin',
      `vkf-strict${executableSuffix}`,
    )),
    python: values.get('python') ?? (platform() === 'win32' ? 'python' : 'python3'),
    julia: values.get('julia') ?? 'julia',
    juliaProject: resolve(values.get('julia-project') ?? join(benchmarkRoot, 'julia')),
    juliaDepot: values.get('julia-depot') ? resolve(values.get('julia-depot')) : undefined,
    symengine: values.get('symengine') ? resolve(values.get('symengine')) : undefined,
    runs: integer('runs', 3),
    timeoutMs: integer('timeout-ms', 30000),
    relativeLimit: positiveNumber('relative-limit', 1.0),
    enforceRelativeGate: boolean('enforce-relative-gate', 'true'),
    optimizerPolicy: values.get('optimizer-policy') ?? 'auto',
    kernels,
    languages,
    output: resolve(values.get('output') ?? join(
      benchmarkRoot,
      'results',
      `${platform()}-${arch()}-local.json`,
    )),
  };
}

export function parseKeyValueOutput(stdout) {
  const fields = new Map();
  for (const line of String(stdout).trim().split(/\r?\n/)) {
    const separator = line.indexOf('=');
    if (separator > 0) fields.set(line.slice(0, separator), line.slice(separator + 1));
  }
  const elapsedMs = Number(fields.get('elapsed_ms'));
  const output = Number(fields.get('output'));
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || !Number.isFinite(output)) {
    throw new Error(`invalid benchmark output: ${JSON.stringify(String(stdout))}`);
  }
  return { elapsedMs, output, fields: Object.fromEntries(fields) };
}

export function parseVkfOutput(stdout) {
  const lines = String(stdout).trim().split(/\r?\n/).map(Number);
  if (lines.length !== 2 || lines.some((value) => !Number.isFinite(value))) {
    throw new Error(`invalid VKF benchmark output: ${JSON.stringify(String(stdout))}`);
  }
  return { elapsedMs: lines[0], output: lines[1] };
}

export function seriesStats(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error('cannot summarize an empty sample series');
  }
  const meanMs = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const variance = samples.length > 1
    ? samples.reduce((sum, value) => sum + (value - meanMs) ** 2, 0) /
      (samples.length - 1)
    : 0;
  return { count: samples.length, meanMs, stddevMs: Math.sqrt(variance) };
}

export function comparisonGate(vkfMeanMs, competitor, relativeLimit = 1.0) {
  // The process deadline includes startup and input construction. Without an
  // operation-start marker, it cannot bound operation-only elapsed time.
  if (!Number.isFinite(vkfMeanMs) || competitor.censored || competitor.failures > 0 || !competitor.stats) {
    return { incomplete: true, pass: false };
  }
  const ratio = vkfMeanMs / competitor.stats.meanMs;
  return {
    ratio,
    pass: ratio < relativeLimit,
  };
}

export function reportPass(kernels, enforceRelativeGate) {
  return kernels.every(kernel => kernel.complete &&
    (!enforceRelativeGate || kernel.pass));
}

export function formatRatio(value, upperBound = false) {
  const magnitude = value < 0.001 ? value.toExponential(2) : value.toFixed(3);
  return `${upperBound ? '<' : ''}${magnitude}×`;
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function execute(command, args, { timeoutMs, env, allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
    env: env ? { ...process.env, ...env } : process.env,
  });
  const timedOut = result.error?.code === 'ETIMEDOUT';
  if (!allowFailure && !timedOut && (result.error || result.status !== 0)) {
    const detail = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
    throw new Error(`${command} ${args.join(' ')} failed: ${result.error?.message ?? detail}`);
  }
  return { timedOut, status: result.status, signal: result.signal,
    error: result.error?.message ?? null,
    stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function version(command, args, options = {}) {
  const result = execute(command, args, { timeoutMs: 30000, ...options });
  return `${result.stdout}\n${result.stderr}`.trim();
}

function compileVkfPrograms(options, workRoot) {
  const executables = new Map();
  for (const kernel of options.kernels) {
    const source = join(benchmarkRoot, 'programs', `${kernel}-timed.vkf`);
    const output = join(workRoot, `${kernel}${executableSuffix}`);
    execute(options.compiler, [
      '-b', source,
      '-o', output,
      '--optimizer-policy', options.optimizerPolicy,
    ], { timeoutMs: 120000 });
    executables.set(kernel, output);
  }
  return executables;
}

function languageEntries(options, vkfExecutables) {
  const entries = {
    vkf: {
      command: (kernel) => [vkfExecutables.get(kernel), []],
      parse: parseVkfOutput,
    },
    symengine: {
      command: (kernel) => {
        if (!options.symengine) throw new Error('--symengine=<runner> is required');
        return [options.symengine, [kernel]];
      },
      parse: parseKeyValueOutput,
    },
    sympy: {
      command: (kernel) => [options.python, [
        join(benchmarkRoot, 'competitors', 'sympy_runner.py'), kernel,
      ]],
      parse: parseKeyValueOutput,
    },
    symbolics: {
      command: (kernel) => [options.julia, [
        `--project=${options.juliaProject}`,
        '--startup-file=no',
        '--history-file=no',
        join(benchmarkRoot, 'competitors', 'symbolics_runner.jl'),
        kernel,
      ]],
      env: options.juliaDepot ? { JULIA_DEPOT_PATH: options.juliaDepot } : undefined,
      parse: parseKeyValueOutput,
    },
  };
  return options.languages.map((id) => ({ id, ...entries[id] }));
}

function summarizeLanguage(raw, timeoutMs) {
  const completed = raw.samplesMs.length;
  const censored = raw.timeouts > 0;
  const summary = {
    samplesMs: raw.samplesMs,
    attempts: raw.attempts,
    failures: raw.failures,
    timeouts: raw.timeouts,
    censored,
  };
  if (completed > 0) summary.stats = seriesStats(raw.samplesMs);
  if (censored) {
    summary.processTimeoutMs = timeoutMs;
  }
  return summary;
}

export function runKernel(kernel, entries, options, kernelIndex, executeSample = execute) {
  const raw = Object.fromEntries(entries.map(({ id }) => [id,
    { samplesMs: [], attempts: [], failures: 0, timeouts: 0 }]));
  for (let round = 0; round < options.runs; round += 1) {
    const offset = (round + kernelIndex) % entries.length;
    const ordered = [...entries.slice(offset), ...entries.slice(0, offset)];
    for (const [position, entry] of ordered.entries()) {
      const [command, args] = entry.command(kernel);
      const result = executeSample(command, args, {
        timeoutMs: options.timeoutMs,
        env: entry.env,
        allowFailure: true,
      });
      const receipt = { round, position, timedOut: result.timedOut,
        status: result.status, signal: result.signal ?? null,
        stdout: result.stdout, stderr: result.stderr,
        elapsedMs: null, output: null, correct: false, error: result.error ?? null };
      raw[entry.id].attempts.push(receipt);
      if (result.timedOut) {
        raw[entry.id].timeouts += 1;
        continue;
      }
      try {
        if (result.error || result.status !== 0) throw new Error(result.error ?? `process status ${result.status}`);
        const parsed = entry.parse(result.stdout);
        receipt.elapsedMs = parsed.elapsedMs;
        receipt.output = parsed.output;
        receipt.fields = parsed.fields ?? null;
        if (parsed.output !== expectedOutputs[kernel])
          throw new Error(`${kernel}/${entry.id} output ${parsed.output}; expected ${expectedOutputs[kernel]}`);
        receipt.correct = true;
        raw[entry.id].samplesMs.push(parsed.elapsedMs);
      } catch (error) {
        receipt.error = error.message;
        raw[entry.id].failures += 1;
      }
    }
  }
  const languages = Object.fromEntries(
    entries.map(({ id }) => [id, summarizeLanguage(raw[id], options.timeoutMs)]),
  );
  const completeLanguage = (language) => !language.censored && language.failures === 0 &&
    language.stats?.count === options.runs && language.attempts.length === options.runs &&
    language.attempts.every(attempt => attempt.correct);
  const vkfMeanMs = completeLanguage(languages.vkf) ? languages.vkf.stats.meanMs : NaN;
  const comparisons = {};
  for (const entry of entries) {
    if (entry.id === 'vkf') continue;
    comparisons[entry.id] = comparisonGate(
      vkfMeanMs,
      languages[entry.id],
      options.relativeLimit,
    );
  }
  return {
    id: kernel,
    expectedOutput: expectedOutputs[kernel],
    languages,
    comparisons,
    complete: Object.values(languages).every(completeLanguage),
    pass: Object.values(comparisons).every((comparison) => comparison.pass),
  };
}

export function markdown(report) {
  const enforced = report.conditions.enforceRelativeGate !== false;
  const cells = (kernel) => report.conditions.languages.slice(1).map((language) => {
    const comparison = kernel.comparisons[language];
    return comparison.incomplete ? 'INCOMPLETE' : formatRatio(comparison.ratio);
  });
  const headings = report.conditions.languages.slice(1).map((id) => `VKF / ${id}`);
  const rows = report.kernels.map((kernel) => {
    const vkf = kernel.languages.vkf.stats;
    const outcome = Object.values(kernel.languages).some(language => language.failures > 0) ? 'FAIL' :
      !kernel.complete ? 'INCOMPLETE' :
      enforced ? (kernel.pass ? 'PASS' : 'FAIL') : 'measured';
    const time = vkf ? `${vkf.meanMs.toFixed(3)} ± ${vkf.stddevMs.toFixed(3)} ms` : 'INCOMPLETE';
    return `| ${kernel.id} | ${time} | ${cells(kernel).join(' | ')} | ${outcome} |`;
  });
  return [
    '# VKF symbolic comparison evidence',
    '',
    `Compiler: \`${report.tools.vkf}\``,
    `Host: \`${report.machine.cpu}\`, ${report.machine.platform}-${report.machine.architecture}`,
    `Requested samples: ${report.conditions.runs} per kernel/language; process timeout: ${report.conditions.timeoutMs} ms`,
    '',
    enforced
      ? `| Kernel | VKF mean ± std | ${headings.join(' | ')} | <${report.conditions.relativeLimit}× each |`
      : `| Kernel | VKF mean ± std | ${headings.join(' | ')} | Measurement |`,
    `| --- | ---: | ${headings.map(() => '---:').join(' | ')} | --- |`,
    ...rows,
    '',
    'Ratios are VKF operation time divided by competitor operation time on this host.',
    enforced ? 'The release performance threshold is enforced.' : 'No performance threshold is enforced.',
    'Process timeouts include startup and setup. Incomplete operation samples provide no operation-time bound and cannot pass either stage.',
    'Ratios below 0.001 use scientific notation so a nonzero measurement is never displayed as zero.',
    '',
  ].join('\n');
}

function toolMetadata(options) {
  const metadata = {
    vkf: version(options.compiler, ['-v']),
    compilerSha256: sha256(options.compiler),
  };
  if (options.languages.includes('sympy')) {
    metadata.python = version(options.python, ['--version']);
    metadata.sympy = version(options.python, [
      '-c', 'import sympy; print(sympy.__version__)',
    ]);
    metadata.sympyRunnerSha256 = sha256(join(benchmarkRoot, 'competitors', 'sympy_runner.py'));
  }
  if (options.languages.includes('symbolics')) {
    metadata.julia = version(options.julia, ['--version']);
    metadata.symbolics = version(options.julia, [
      `--project=${options.juliaProject}`,
      '--startup-file=no',
      '-e',
      'using Symbolics; print(pkgversion(Symbolics))',
    ], {
      env: options.juliaDepot ? { JULIA_DEPOT_PATH: options.juliaDepot } : undefined,
    });
    metadata.symbolicsProjectSha256 = sha256(join(options.juliaProject, 'Project.toml'));
    metadata.symbolicsRunnerSha256 = sha256(join(benchmarkRoot, 'competitors', 'symbolics_runner.jl'));
  }
  if (options.languages.includes('symengine')) {
    if (!options.symengine) throw new Error('--symengine=<runner> is required');
    metadata.symengineCommit = '0c183629a35dd9d8123fafcc47b0e0283bbae80d';
    metadata.symengineRunnerSha256 = sha256(join(
      benchmarkRoot, 'competitors', 'symengine_runner.cpp',
    ));
    metadata.symengineExecutableSha256 = sha256(options.symengine);
  }
  return metadata;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const workRoot = mkdtempSync(join(tmpdir(), 'vkf-symbolic-comparison-'));
  try {
    const executables = compileVkfPrograms(options, workRoot);
    const entries = languageEntries(options, executables);
    const report = {
      schema: 'vkf.symbolic-comparison',
      schemaVersion: 3,
      generatedAt: new Date().toISOString(),
      revision: version('git', ['rev-parse', 'HEAD']),
      machine: {
        hostname: hostname(),
        platform: platform(),
        architecture: arch(),
        osRelease: release(),
        cpu: cpus()[0]?.model ?? 'unknown',
        logicalCpus: cpus().length,
        memoryBytes: totalmem(),
      },
      conditions: {
        runs: options.runs,
        timeoutMs: options.timeoutMs,
        relativeLimit: options.relativeLimit,
        enforceRelativeGate: options.enforceRelativeGate,
        kernels: options.kernels,
        languages: options.languages,
        scheduling: 'rotating same-host process order within every kernel round',
        timer: 'each language times only its symbolic operation; process startup and setup are excluded',
        optimizerPolicy: options.optimizerPolicy,
      },
      tools: toolMetadata(options),
      sources: Object.fromEntries(options.kernels.map((kernel) => [kernel, {
        vkfSha256: sha256(join(benchmarkRoot, 'programs', `${kernel}-timed.vkf`)),
      }])),
      kernels: [],
    };
    for (let index = 0; index < options.kernels.length; index += 1) {
      const kernel = options.kernels[index];
      process.stderr.write(`benchmarking ${kernel}\n`);
      report.kernels.push(runKernel(kernel, entries, options, index));
      report.complete = report.kernels.length === options.kernels.length &&
        report.kernels.every(row => row.complete);
      report.pass = report.complete && reportPass(report.kernels, options.enforceRelativeGate);
      mkdirSync(dirname(options.output), { recursive: true });
      writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`);
    }
    report.complete = report.kernels.every(kernel => kernel.complete);
    report.pass = reportPass(report.kernels, options.enforceRelativeGate);
    mkdirSync(dirname(options.output), { recursive: true });
    writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(options.output.replace(/\.json$/i, '.md'), markdown(report));
    process.stdout.write(`${markdown(report)}\nJSON: ${options.output}\n`);
    if (!report.pass) process.exitCode = 1;
  } finally {
    const resolvedWork = resolve(workRoot);
    const resolvedTemp = resolve(tmpdir());
    if (!resolvedWork.startsWith(`${resolvedTemp}\\`) &&
        !resolvedWork.startsWith(`${resolvedTemp}/`)) {
      throw new Error(`refusing to remove non-temporary path ${resolvedWork}`);
    }
    rmSync(resolvedWork, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
