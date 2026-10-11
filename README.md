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
