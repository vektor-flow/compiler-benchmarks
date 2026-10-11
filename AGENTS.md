# Compiler benchmark repository

This repository is public. Read README.md before changing workflows.
The integration coordinator owns the compiler pins, benchmark acceptance and
publication of results; this repository supplies public standard runner jobs.

Publish only explicitly selected workflows, benchmark harness files and reviewed
result summaries. Keep private compiler source, repository history, build trees
and unrestricted raw logs out of commits and public artifacts. Private inputs
may be retrieved inside trusted manually dispatched jobs using a narrowly scoped
read credential or a separately encrypted input bundle. Never print credentials.
The public repository's GITHUB_TOKEN cannot read another private repository.

Use standard GitHub-hosted runners only. Keep manual dispatch and full action SHA
pins. Do not add pull-request triggers to jobs that access private inputs.
Keep workloads, numerical oracles, ten-repetition counts and source/artifact pins
exact. Missing results and failures receive no successful measurement credit.
Preview benchmarks do not certify C0/P0, stable releases or physical GPU acceptance.
Physical GPU STOP remains; do not run hardware sessions or reset drivers.

Do not edit the paired compiler repositories from here. Submit integration
information through the shared coordination files. No agents are spawned.
