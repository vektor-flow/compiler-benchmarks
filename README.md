# Vektor Flow compiler benchmarks

This repository publishes the Source983 0.7.2 preview workflows, selected original
benchmark harness files and reviewed results. [The preview report](results/preview-0.7.2/README.md)
separates terminal workload attempts, qualified comparisons and failed observations.
The 64 primary rows cover Linux, macOS ARM, Windows and WASM: five original core,
seven linalg and four symbolic workloads per platform, ten measured repetitions
for each working case. macOS Intel is additional coverage.

## Trusted hosted execution

Manually dispatch `.github/workflows/preview-072.yml` on `working` with target
`windows-x64`, `macos-arm64`, `macos-x64` or `all`. These use standard GitHub-hosted
Windows 2022, macOS 15 ARM and macOS 15 Intel runners. `suites=auto` selects the remaining
native coverage; `core`, `linalg` and `symbolic` permit a focused evidence retry.
Linux native and WASM results adopt matching original compiler/input identities
and retain their actual host conditions; they are not relabeled as hosted runs.
Runner-availability probe 38111143757 succeeded but supplies no benchmark evidence.
Historical private-run billing refusals remain external evidence; no spending
settings have been changed.

Inputs are the original candidate11 archive/manifest 58, benchmark revision
`7d19ea16551b6956a044af3d4c99da49d4767b25`. The selected public `harness/` files have
individual original-file hashes in `harness/original-inputs.json`; execution uses
the complete 414-file pinned harness inside authenticated encrypted inputs.
Core retains C++/Rust/Zig, linalg retains Eigen/faer/SciPy, and symbolic retains
SymEngine/SymPy/Symbolics. Original workloads, oracles, timing boundaries and
sample counts remain unchanged.

## Private inputs and frozen compilers

`inputs/source983-01.enc` uses AES-256-GCM with a separately held key supplied by
the repository Actions secret `SOURCE983_INPUT_KEY`. The runner verifies the
ciphertext/plaintext archive pins, exact recipe and source-file manifest before
execution. Source pin is `fb41913c619e0dac6c66b08ee44e1ee18ce67aa8`; recipe11 SHA256 is
`3c4e14a9df56328078ad79bd56e13003af8cbd01c504192737fe27b41642aaa7`.
No credentials, plaintext compiler source, private repository history or unrestricted
build directory is published. The repository read-only Actions token only fetches
this repository's selected encrypted artifacts; it provides no private source access.

Windows reconstructs the exact source, builds once per measurement attempt and
freezes the selected compiler tools for every case/repetition. macOS adopts the
hash-verified frozen Source983 compiler from run 38095145038. ARM core raw-phase capture
reuses that same compiler. Linux and WASM use their retained frozen compiler pins.
The initial Windows public attempt 38111620514 built successfully but failed peer
CMake setup before workloads. Those ephemeral binaries were not retained, so
retry 38112707596 necessarily builds a second compiler; no workload measurement
rebuilds it. This exception and both identities remain disclosed.

Subsequent jobs retain `frozen-tools.enc`, an encrypted allowlisted executable/tool
bundle with its exact source proof and file hashes. For a measured Windows retry,
set `frozen_tools_run` to its terminal originating run. Authenticated decryption,
source/recipe proof and every tool hash must match before adoption; this skips
compiler rebuilding. Actions artifacts have short retention, so the coordinator
retains original sealed evidence and reviewed durable results separately.

## Evidence and preview scope

Jobs expose safe phase names, exit codes, hashes and status. Selected receipts,
raw logs and results are encrypted for coordinator review; compiler sources and
build trees are excluded from evidence uploads. Only reviewed field allowlists
become public JSON/CSV/Markdown. Raw valid ten-sample series, rejected arrays,
correctness outcomes, failures, compiler/toolchain/runner identities and
comparison qualification are separately recorded under `results/preview-0.7.2/`.
Failed or unstarted jobs receive no successful timing credit. Historical samples
and diagnostic retries are preserved without replacing current failures.

Portable Platonic Play browser artifact SHA256:
`9011f6cfd67a925043cbdb33cbc3d55553db7d5a4470949c4d838cf37534629b`.
This is a preview, not P0/C0, a stable release or quiet-host performance acceptance.
Original 419 repair progress remains separate: 17 historical closures, 402 open,
pending current-Source983 requalification. Physical GPU STOP remains in force.
