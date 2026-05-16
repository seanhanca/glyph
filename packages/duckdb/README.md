# @glyph/duckdb

DuckDB Node implementation of the [`@glyph/core`](../core/) `ComputeEngine` interface.

```ts
import { createDuckDBEngine, materializeSpec } from "@glyph/duckdb";

const engine = await createDuckDBEngine();
const { handle, result } = await materializeSpec(engine, spec);
// result.rows is the data that backs the chart
// handle.viewName lets you query it back later
```

Apache 2.0. Pre-alpha — see the [MVP plan](../../mvp.md).
