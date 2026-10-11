# Vektor Flow compiler benchmarks

Public workflow repository for reproducible Vektor Flow compiler benchmarks on
standard Linux, Windows and macOS GitHub-hosted runners. WASM runs use the Linux
host. Public standard runner compute is free under GitHub's current billing rules:
https://docs.github.com/en/billing/concepts/product-billing/github-actions
Artifact and cache storage have separate allowances.

The initial workflow checks actual runner availability and records tool versions.
It does not run the compiler benchmark suite or claim benchmark completion.
Linux x64, Windows x64, macOS ARM and additional macOS Intel probes are manually
dispatched. Only this repository's newly written workflow/probe code is public;
no private compiler source or credentials have been copied here.

The integration coordinator will connect exact isolated0.7.2 inputs and the
original ten-repetition five-core, seven-linalg and four-symbolic workloads.
Compiler source remains private. A narrowly scoped read credential or encrypted
input bundle can supply it inside the temporary runner workspace. The public
GITHUB_TOKEN alone does not grant cross-repository private access:
https://docs.github.com/en/actions/concepts/security/github_token

Public commits, logs and uploaded artifacts can remain accessible after a run.
Commit and upload only selected harness files and reviewed result summaries.
Retain full private raw evidence in the coordinator's existing evidence store.
Public runner availability, diagnostic preview measurements and full compiler
acceptance are separate claims. No P0/C0 or physical GPU acceptance is implied.

## Source983 preview execution

`preview-072.yml` runs trusted manual jobs on standard Windows 2022, macOS ARM
and additional macOS Intel hosts. Successful availability run38111143757
is infrastructure evidence only. Inputs use AES-256-GCM in
`inputs/source983-01.enc`; the key exists only in the repository Actions secret
and coordinator's private store. Compiler source and private Git history
remain encrypted; no read credential or unrestricted build tree is public.

Windows builds the exact compiler once and freezes its complete tool bundle.
macOS adopts previously built, hash-verified Source983 tools from run38095145038.
ARM's five valid core results and seven original linalg failures are adopted;
remaining symbolic cases run here. Intel runs all three suites as additional
coverage. Existing Linux native and WASM evidence retain their original host
identities; symbolic attempt118 remains the sole Linux full-peer attempt.

Selected original workload/oracle/peer files are in `harness/`; each public
file is checked against candidate11's original benchmark manifest58. This is
a selected inspection set; actual execution uses the complete pinned harness
inside encrypted inputs. Numerical gates, ten valid repetitions and timing
boundaries stay exact. Failed programs retain diagnostics and earn no timing
credit. Jobs expose only phase names, exit codes, hashes and safe status.
Selected raw receipts, diagnostics and samples are encrypted in an allowlisted
artifact for coordinator review; source and build directories are excluded.
Only reviewed results become public JSON/CSV/Markdown.

Primary reporting has64 rows: Linux, macOS ARM, Windows and WASM, each with
5 core,7 linalg and4 symbolic workloads. Completed attempts, successful
comparisons and compiler acceptance are separate counts. PP portable browser
artifact SHA256:
`9011f6cfd67a925043cbdb33cbc3d55553db7d5a4470949c4d838cf37534629b`.

Windows attempt38111620514 built the exact compiler but stopped before workloads:
SymEngineConfig.cmake parsed a backslash in BOOST_ROOT as an invalid escape.
No Windows row is credited from that setup attempt. Retry uses forward-slash
CMake paths and a fresh hosted runner. The first tool identity is preserved;
its binaries were not retained before the ephemeral runner ended. Each measurement
attempt still freezes one compiler and reuses it for all repetitions. Subsequent
jobs retain an encrypted, hash-verified selected frozen-tool bundle so setup
failures do not require another compiler build. No source or build tree is uploaded.

For a measured setup retry after frozen tools have been retained, set
`frozen_tools_run` to that terminal Windows run. The workflow's repository-scoped
read-only Actions token downloads the encrypted selected tool artifact; exact
Source/recipe/binary hashes and the full728-file source proof must match before
adoption. This skips compiler rebuilding. It never reads another private repository.
