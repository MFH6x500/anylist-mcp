# AnyList UUID v4 compatibility

The pinned AnyList fork uses only `require('uuid/v4')()` with no arguments.
This package preserves that call using Node's `crypto.randomUUID()` and removes
the retired uuid 3 dependency. It does not implement uuid's other APIs; passing
arguments refuses explicitly. The root dependency and AnyList override must be
installed together through `npm ci`.
