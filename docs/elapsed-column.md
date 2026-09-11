# Agents elapsed column

Mosaic publishes `$elapsed` as a 3-cell value on every agent pane it refreshes. The width is a product requirement. It is not a measured average of live sidebar rows.

The agents row still has one `$elapsed` token. Herdr draws ` · ` between that token and the next visible token. Mosaic does not add a second separator.

## Published values

`src/elapsed.py` fits every published clock to `WIDTH = 3`.

| Age | Published value | Cells |
|---|---|---|
| No observed completion | U+2800 three times | 3 |
| Under 30 seconds | `now` | 3 |
| 1 to 9 minutes | `Nm` plus one U+2800 | 3 |
| 10 to 60 minutes | `NNm` | 3 |
| 1 to 9 hours | `Nh` plus one U+2800 | 3 |
| 10 to 24 hours | `NNh` | 3 |
| 1 to 9 days | `Nd` plus one U+2800 | 3 |
| 10 to 99 days | `NNd` | 3 |
| Older than 99 days | `99d` | 3 |

Short labels take U+2800 only for the cells they lack. Rounding is unchanged: nearest minute, hour, or day, with `now` below 30 seconds. Days stop at `99d` so the unit stays visible.

A missing clock is three blank cells, not `now`, and not a JSON null, while the worker is publishing.

## Why the blank is U+2800

The requirement asked for spaces. Herdr 0.8.2 does not keep them.

`pane.report_metadata` trims the token value, strips controls, then treats a value that is empty after trim as a clear. A disposable probe on the installed binary stored these results:

| Sent | Stored |
|---|---|
| three ASCII spaces | absent |
| `2m` plus one ASCII space | `2m` |
| empty string | absent |
| JSON null | absent |
| three NBSP (U+00A0) | absent |
| three figure spaces (U+2007) | absent |
| three U+2800 | three U+2800 |
| `2m` plus one U+2800 | `2m` plus one U+2800 |
| `now`, `2m`, `10m` | unchanged |

U+2800 is the existing pad character. It occupies one terminal cell and survives that ingest path. The published column is three blank cells, not three ASCII spaces.

Re-run the probe with:

```sh
python3 scripts/check-elapsed-column.py
```

## Missing while publishing, then expiry

The worker still refreshes every 30 seconds and still sets `ttl_ms` to 45000 on every elapsed report. Uninstall still sends a null clear. Mosaic does not own `$themed_model_tier`.

Those two missing cases are not the same:

- **Missing while publishing.** The pane has no `last_settled_at`. Mosaic publishes the 3-cell blank. The `$elapsed` key stays present, so Herdr keeps the token and the ` · ` after it. Titles stay put for `now`, `2m`, `10m`, `99d`, and the blank.
- **Expired or cleared metadata.** Herdr drops the key. A missing custom token is omitted from the row, and its separator goes with it. The title moves left. That is host behaviour. Mosaic cannot hold the column after TTL expiry without dropping the 45-second TTL or changing Herdr.

Do not read the 3-cell publish contract as a guarantee after a failed refresh, a disabled worker, or uninstall. Those paths still collapse the column.

## What the tests prove

`tests/test_elapsed.py` and `tests/test_sidebar.py` prove Mosaic fits labels to 3 cells and publishes the blank instead of null.

`scripts/check-elapsed-column.py` checks ingestion in a disposable HOME, config, socket, and registry. With `termctrl`, it also checks rendered titles. Probe names appear only in agent rows, so workspace headings cannot produce a false pass.

The Herdr 0.8.2 rendering check passed: blank, `2m`, `now`, `10m`, and `99d` all start their titles at zero-based column 9. Changing one pane through those values keeps column 9. Clearing its metadata moves the title to column 3, confirming the host limitation.

If `termctrl` is a package-manager shim that cannot run inside the disposable HOME, set `TERMCTRL_BIN` to its native executable. A missing or unlaunchable renderer is reported as unverified, not as a rendering pass.

`scripts/check-standalone.py` proves the placeholder is published before the first completion, `now` still appears after a completion, the timer still advances a 3-cell clock, and a disabled worker still lets the token expire.
