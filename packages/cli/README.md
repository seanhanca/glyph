# @glyph/cli

Command-line interface for [Glyph](../../).

```bash
npx @glyph/cli render examples/01-bar-rides-by-hour.json -o chart.svg
npx @glyph/cli describe taxi.parquet --json
npx @glyph/cli query examples/01-bar-rides-by-hour.json "WHERE rides > 1000"
npx @glyph/cli check examples/01-bar-rides-by-hour.json baseline.svg
```

Apache 2.0. Pre-alpha — see the [MVP plan](../../mvp.md).
