# AnyList protobuf compatibility

This local package replaces only the pinned AnyList fork's legacy protobuf
module. It converts the trusted bundled v5 JSON schema to the maintained
protobufjs JSON schema, explicitly retaining proto2 presence rules. Message
objects retain absent scalars as null, repeated fields as arrays, and 64-bit
integers as decimal strings. The wrapper exposes the constructors and methods
used by that fork; it is not a general protobufjs 5 implementation.

Encoding and decoding use `protobufjs-modern`, an npm alias pinned to protobufjs
8.8.1. That runtime bounds wire recursion. This wrapper separately refuses
buffers above 16 MiB. It does not stream or limit HTTP downloads. Unknown wire
fields are handled by protobufjs; callers cannot install schemas through MCP.

Keep the root overrides and the committed lockfile together. Verify deployment
with `npm ci`, `npm test` and `npm audit`. The wire fixtures and synthetic MCP
suites cover categories, quantities, recipes, ingredient operations and calendar
operations. Never replace their assertions with the adapter's own output as the
expected legacy fixture.
