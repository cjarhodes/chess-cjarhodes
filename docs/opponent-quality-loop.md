# Opponent quality loop

Audited 20 October 2026 against main `6cf89c4`. The existing unfinished difficulty work was integrated into the current release checkout; the original checkout and its unrelated changes were preserved.

## Acceptance criteria

- Stop deliberately choosing from an uncapped worst-move tail.
- Preserve engine-detected mates, reject forced-mate losses when a non-mating line exists, and retain quieter alternatives.
- Verify a decreasing move-loss trend across every slider keyframe, without fitting an invented human-rating curve.
- Exercise actual Coach games, reviews, endings, results, and reloads at 400, 1200, and 2400.
- Pass all validators, the complete browser suite, calibration, and live-domain checks.

## Changes and measured cycles

1. **Audit and bounded selection.** The old 400 setting combined a 40% worst-third branch with a 90% error branch, leaving no ordinary best-move branch. Even its highest setting could discard a forced mate. The replacement searches at full native skill, applies weakening once, retains sound alternatives, favors smaller losses, and caps candidate loss at 500 centipawns relative to its search. Invalid or unordered scored lines are handled before sampling. A detected winning mate is converted; if all candidates are losing mates, the longest resistance is selected.
2. **Tactical and quiet browser audit.** A genuine immediate Scholar's Mate threat replaced an earlier blocked-threat regression fixture. For 128 seeded draws per position at each of 400, 1200, and 2400, the new selector always took the available mate in one and free queen, conceded no immediate mate, and produced varied quiet moves. At 400, the old selector took mate in **0/128** draws, captured the free queen in **85/128**, and conceded immediate mate in **49/128** against the direct threat. The replacement scored **128/128**, **128/128**, and **0/128** respectively. In the quiet fixture it chose 18 distinct moves at 400, 16 at 1200, and 10 at 2400. These are repeated samples of each searched candidate list, not independent games.
3. **Games and regression verification.** Actual Coach play finished a queen-and-king ending at all three settings: `1. Kg6+ Kg8 2. Qg7#`. Game identity, PGN, and completed result survived reload. Three ordinary games each reached six reviewed user moves and six legal opponent replies before resignation. Page errors: zero. `scripts/verify-opponent-journeys.js` now repeats these workflows as part of `scripts/verify-browser.sh`; it also accepts a legitimate earlier checkmate. Existing Library, daily training, practice, teaching, and interruption-recovery journeys remain covered.

## Calibration

Vendored Stockfish.js 10; reference depth 12; seed 20260921; 62 positions from opening lines, middlegames, endings, and tactical fixtures; 16 selections per position, yielding 992 samples per level. Every new keyframe was measured; the prior selector was measured at 400, 1200, and 2400 with the same harness and seed. See [machine-readable results](opponent-quality-calibration.json).

| Relative level | Prior ACPL | New ACPL | Prior loss ≥300cp | New loss ≥300cp | New loss ≥500cp |
|---|---:|---:|---:|---:|---:|
| 400 | 195.9 | 80.6 | 18.1% | 6.9% | 0.7% |
| 600 | — | 74.2 | — | 6.0% | 0.5% |
| 800 | — | 70.2 | — | 5.8% | 0.4% |
| 1000 | — | 62.0 | — | 4.5% | 0.2% |
| 1200 | 84.8 | 52.0 | 7.6% | 3.6% | 0.2% |
| 1400 | — | 41.5 | — | 3.0% | 0.0% |
| 1600 | — | 37.6 | — | 3.4% | 0.0% |
| 1800 | — | 24.2 | — | 1.4% | 0.0% |
| 2000 | — | 19.3 | — | 0.7% | 0.0% |
| 2200 | — | 17.0 | — | 0.3% | 0.0% |
| 2400 | 20.3 | 16.8 | 0.5% | 0.1% | 0.0% |

All 10,912 new selections were legal; no mate-in-one concessions occurred in the calibration set. Unrounded mean loss decreased at all 11 keyframes. The top two settings were nearly tied (16.96 versus 16.83cp), so this does not establish a meaningful strength gap between them. The direct-threat browser audit above is separate and caught a weakness the older calibration fixture did not expose.

ACPL is the mean nonnegative difference between the chosen move's child-position score and the reference best move's child-position score, clipped to 1500 centipawns. Both children use the same reference depth. Large-loss rates use this reference, not the selector's shallower score, so a 500cp selection cap is not a guarantee against larger reference losses. Samples share positions and candidate searches; they are not independent human games. Browser audits separately exercise the immediate-mate threat omitted by the older tactical fixture.

Severe-loss rates are not strictly monotonic: 1400 measured 3.0% at ≥300cp and 1600 measured 3.4%, despite a lower mean loss. Deeper searches and different sampled alternatives can change individual positions; the keyframes were not tuned again to erase this small reversal in a fixed suite.

The suite does not establish Chess.com, Lichess, or FIDE Elo. It uses the same engine for selection and reference, covers a small fixed position set, and uses finite search. Search timings vary with concurrent workloads and Node/browser runtimes. Lower settings remain capable of odd quiet choices and mistakes; this is a weakened engine rather than a model trained on human moves. The lowest settings are stronger than before, and human playtesting is still needed to assess their accessibility.

## Reproduce

```sh
git show 6cf89c4:app.js > /tmp/opponent-before.js
APP_FILE=/tmp/opponent-before.js LEVELS=400,1200,2400 OUT=/tmp/opponent-before.json node scripts/calibrate-difficulty.js
OUT=/tmp/opponent-after.json node scripts/calibrate-difficulty.js
node --check app.js
node --check growth.js
for validator in scripts/validate-*.js; do node "$validator" || exit 1; done
scripts/verify-browser.sh
```

The browser suite includes mate conversion, direct mate defense, free-queen capture, quiet variety, full endings, opening sessions, and result recovery. Browser checks use isolated test storage and the real vendored engine; no account or backend changes were required.

The live run exposed a smoke-harness navigation bug: Vercel canonicalizes `/health.html` to `/health`, so deriving the app URL from the redirected path left the test on the health page. The harness now stores the app root before navigating away. This change affects test navigation only.

## Release verification

Opponent code commit `e956a95` deployed to `https://chess.cjarhodes.com` in READY production deployment `dpl_4AhNsoAmqzLeYCVzakgbLdpey8yy`. The live `app.js` and HTML matched the release files byte for byte. Live tactical checks, complete opponent endings, six-turn opening games, result recovery, adaptive planning, drills, practice-to-play transfer, progress persistence, and Library smoke checks passed with zero page errors. All local validators and the combined browser, teaching, recovery, and opponent suites passed.
