# Source983 0.7.2 preview report — execution ongoing

48/64 primary workload attempts terminal; 26
qualified comparisons; 22 failed or unqualified;
16 pending. Intel is additional coverage (16/16 terminal, 2 qualified). Availability probe38111143757
is infrastructure evidence only. Public execution run38111620514 and local symbolic118
retain actual runner/host identities and original failures. Missing jobs receive no credit.

`raw-samples.json` contains272 reviewed ten-sample timing series;
`sample-summary.csv` provides means, medians and sample standard deviations.
Individually valid peers and scalar-only parallel diagnostics remain observations
without full comparison credit. Symbolic attempts and failures are separately retained.
Original workloads, numerical oracles, rotating order and timing boundaries are unchanged.
This preview does not certify P0/C0, a stable release or quiet-host performance.

Compiler source: `fb41913c619e0dac6c66b08ee44e1ee18ce67aa8`. Exact recipe11 SHA256:
`3c4e14a9df56328078ad79bd56e13003af8cbd01c504192737fe27b41642aaa7`.
Portable PP browser artifact SHA256:
`9011f6cfd67a925043cbdb33cbc3d55553db7d5a4470949c4d838cf37534629b`.
Compiler source, private repository history and unrestricted build/log directories remain
private. Reviewed identities and selected diagnostics are public; sealed originals are retained.
Original419 C0 counts remain17 historical closures and402 open, pending Source983
requalification. Physical GPU STOP remains; no hardware sessions occurred.

| Platform | Terminal attempts | Qualified | Failed or unqualified |
| --- | ---: | ---: | ---: |
| linux | 16/16 | 15 | 1 |
| macos-arm64 | 16/16 | 7 | 9 |
| windows | 0/16 | 0 | 0 |
| wasm | 16/16 | 4 | 12 |
| macos-x64 (additional) | 16/16 | 2 | 14 |

The remaining preview limitations include ARM private ABI argument overflow and
oversized list literals, a current ARM parallel entry-timer failure, Intel native
runner code capacity and zero internal timers, and WASM execution traps, unavailable
internal timers and unverified two-worker execution. Symbolics expand1 exceeded the
original120000ms process deadline on Linux and ARM. Exact diagnostics and all failed
attempts are retained; these observations do not establish a new C0 fault count.
See `failures.json`, `symbolic-outcomes.json` and `measurement-identities.json`.

The first public Windows attempt built its exact compiler but stopped at a peer
CMake path-escape setup error before any workload. Its original ephemeral tools
were not retained, so the setup retry necessarily built a second compiler. That
retry freezes one exact compiler for every actual Windows measurement, then seals
selected tools for future adoption. No workload measurement rebuilds the compiler.
macOS uses the existing exact frozen compiler for all suites; ARM core raw-phase
capture reuses it. Linux and WASM adopt matching existing compiler identities.

The core comparison report retains kernel, compilation and process boundaries.
Linalg and symbolic comparisons retain their original operation boundary. Historical
ARM kernel samples and WASM adapter retry diagnostics remain separate observations;
failed comparisons never receive successful timing credit. This report records a
preview attempt matrix, independently from compiler repair and acceptance gates.
