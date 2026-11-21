# CSV Reader Speed — a faster drop-in for csv-reader 1.0.0

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Dhikas182/csv-reader-speed/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Dhikas182/csv-reader-speed/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A make.fun entry for
[csv-reader-speed-01-run-20261121](https://make.fun/bounty/csv-reader-speed-01-run-20261121):
a faster drop-in for make.fun's own csv-reader 1.0.0 that answers
exactly as it does on every case.

## What it is

`solve.js` is a dependency-free ES module whose `run(input)` returns
csv-reader 1.0.0's answer — `{columns, rows, errors}` — for an input
`{text, header}`, byte for byte. `main.ts` is the house driver (kept
verbatim): it reads every case from `/input/cases.json`, answers each
with `run`, and writes `/output/answers.json`. Node 22, no dependencies,
no WASM, no native code.

## How it is fast

The reference reads one character at a time. This reader never does:

- **Record-level fast path** — a record whose first line holds no quote
  and no stray CR ends at that line break: `split(',')` takes the whole
  record at once. About a quarter of the practice records go this way.
- **`indexOf`-driven fields** — an unquoted field ends at the nearest of
  `,`, `\n`, `\r`, found with `indexOf`; a quoted field is found with
  `indexOf` and taken with `slice`. No per-character loop anywhere.
- **Quoted spans by slice** — a quoted field with no `""` and no line
  break inside it is the slice itself; only spans holding `""` or a
  break go through the collapsing pass (which also counts the breaks,
  so `line` stays exact).
- **No work per case beyond the parse** — nothing is kept from one call
  to the next, and every answer is built in one pass, left to right.

## What it gets right (the reference's own policy, verified against it)

- U+FEFF dropped at the very start only; empty lines are no records.
- A record ends at LF or CRLF; a CR not followed by LF outside quotes
  is dropped with a `stray_cr` error — including a lone CR at the very
  end of the text.
- A field opening with a quote runs to the next non-doubled quote;
  `""` inside it is one quote; each CRLF or lone CR inside it reads as
  LF; what follows the closing quote, up to the next comma or line
  break, is appended as it stands (`quote_junk`, when the field ends).
- A quote that never closes is a literal character, and the text after
  it is read again as unquoted (`unterminated_quote`).
- A quote inside an unquoted field is a literal character.
- Fields stay strings, never trimmed or converted.
- `columns` is the first record when `header` is true, else `null`;
  rows are padded with `""` (`short_row`, with `fields:` its field
  count) or cut (`long_row`, with `extra:` the cut fields) to the first
  record's width.
- Each error is `{code, line, row}` in the order met; `line` is the
  1-based line its record starts on (every LF, CRLF and lone CR inside
  quotes counted), `row` its record's index in `rows` (`null` for the
  header).

## Verification (this machine, Node 24.22.1)

- **Practice set: 6/6 cases identical** to csv-reader 1.0.0 (kit scorer,
  `passed: 1`).
- **Differential testing: 5,018/5,018 identical** — 107 hand-written
  edge cases, 3,000 random strings, 2,000 structured fuzz cases, and
  18 full-size cases drawn by the kit's own generator with fresh seeds.
- **Speed on the practice set** (6 cases, ~10.2 MB of CSV): `run()`
  warm median **121 ms** vs the house baseline's **602 ms** — about
  **5× faster**. Full entry wall time ~1.1 s vs ~2.0 s. Deterministic:
  two runs produce byte-identical `answers.json`.

## Files

- `solve.js` — the reader (10 KB).
- `main.ts` — the house driver, verbatim from the kit baseline.
- `LICENSE` — MIT.
