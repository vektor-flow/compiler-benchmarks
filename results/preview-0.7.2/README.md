# Source983 0.7.2 preview report — execution ongoing

40/64 primary rows have complete attempts: 21 qualified comparisons and 19
failed or unqualified rows. Remaining24 rows are running or pending. These
counts do not certify P0/C0, a stable release or quiet-host performance.

Linux core5 and linalg7, macOS ARM core5 and WASM core4 qualify. ARM's original
seven linalg ABI failures and all remaining WASM trap/timer/concurrency failures
are preserved. Public run38111620514 supplies remaining Windows and ARM symbolic
attempts plus additional Intel coverage. Local symbolic118 supplies Linux's
original full-peer attempt. Missing measurements are not marked completed.

`raw-samples.json` contains156 reviewed ten-sample timing series with original
host conditions and evidence hashes. Partial Linux VKF/SymPy and WASM parallel
diagnostics are retained without full comparison credit. Compiler source is
`fb41913c619e0dac6c66b08ee44e1ee18ce67aa8`; exact recipe11 SHA256:
`3c4e14a9df56328078ad79bd56e13003af8cbd01c504192737fe27b41642aaa7`.
Portable PP browser artifact SHA256:
`9011f6cfd67a925043cbdb33cbc3d55553db7d5a4470949c4d838cf37534629b`.
Ten repetitions do not imply a10x speedup. Original419 C0 counts remain
17 historical closures and402 open, pending Source983 requalification.
