# OpenClaw Adapter

The OpenClaw adapter is the first built-in `adapters/` workspace for
`xmtp-signet`.

This branch only establishes the reference package shape:

- adapter manifest and registration surface
- process-backed adapter CLI entrypoint
- stub `setup`, `status`, and `doctor` verbs
- dedicated `artifacts/`, `bridge/`, and `config/` modules for follow-on work

Later branches replace the stubs with real provisioning and bridge behavior.
