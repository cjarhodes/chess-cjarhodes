# Coach teaching quality loop — October 20, 2026

Goal: a player should understand the consequence of a mistake, compare a stronger
continuation on the board, retry with progressive help, and leave with one reusable
check for the next game. Five representative legal positions define this release's
functional acceptance criteria; they are examples, not a claim to cover all chess.

## Pass 1: Make the consequence and decision visible

The browser audit showed a queen-hanging move receiving a first-glance lesson
about bishop development. The queen capture was hidden inside Engine details.
Every mistake's visible cue asked the player to remember the preferred SAN move.
The endgame position's stalemate was not explained at first glance.

The review now leads with a consequence grounded in the legal position: a possible
capture, checkmate, missed immediate mate, or terminal stalemate. A separate cue
teaches a future decision, such as checking enemy captures on a destination square.
Lesson priority follows immediate consequences; an endgame queen or knight move
is not automatically described as opening development. Capture wording does not
claim a material win without calculating the exchange.

## Pass 2: Replay what the mistake allows

Show consequence replays the player's move and the engine's possible continuation
on the main board. Show why retains the recommended line. Both use legal move
generation, stop at illegal or terminal continuations, and preserve the real PGN,
game identity, and statistics. Proposed replies are explicitly labeled possible,
including the deeper comparison boards; they are not presented as moves played.

## Pass 3: Make practice a decision exercise

Practice starts by asking about the opponent's threat and candidate moves. Hints
then reveal an idea, the piece's source, its destination, and finally the legal SAN
answer. The initial prompt no longer duplicates the first hint. Minor-piece hints
distinguish moving off a home rank from repositioning an active piece.

On completion, the drill displays its saved decision cue for the next game. New
local insight records retain this cue; older records reconstruct a supported cue
from their board position without inventing a missing engine reply. Assisted
results remain assisted, and the existing engine-based alternative grading remains
in place.

## Five acceptance journeys

- Hanging a piece: Qxe5+ after e4 e5 Qh5 Nc6 permits Nxe5 to capture the queen;
  the lesson prioritizes destination safety over generic development.
- Missing a tactic: Qe4 in a queen-and-king mating position skips immediate mate;
  the lesson starts with a scan of checking moves and legal defenses.
- Exposing the king: g4 after f3 e5 allows Qh4#; the cue checks opponent checks
  and diagonals toward the king before a kingside pawn commitment.
- Poor development: h4 after e4 e5 Nf3 Nc6 is compared with bringing a minor piece
  into play; the quiet opponent continuation is labeled an engine suggestion.
- Endgame mistake: Qf5 with White Kf7/Qg6 against Kh8 stalemates, while mating
  alternatives exist; the cue checks legal replies and whether the king is in check.

The executable browser journeys use real game moves and engine reviews, inspect
visible explanations, replay both lines, reject the original mistake, exercise
progressive hints, accept safe alternatives when available (including equivalent
mates), check the completion cue, preserve live games, and verify local persistence.
The suite reports zero page errors. Chess-rule validators additionally cover
truncated PVs, terminal draws, missing legacy fields, and misleading lesson priority.

Run all validators and scripts/verify-browser.sh. The browser script also runs
scripts/verify-teaching-journeys.js in its isolated browser; the same journey body
can be used with Playwright CLI run-code against the public custom domain.

## Limits and next work

- These checks establish teaching functionality and state preservation, not human
  understanding, long-term retention, or improved results in future games.
- Quiet positional explanations use supported move facts and general decision
  questions; they do not claim to identify the engine's complete strategic reason.
- Revisit hint difficulty and cue usefulness after observing actual training sessions.
- Account storage schema is unchanged. New cues persist in local insight JSON;
  older or remotely reconstructed records use the legal-position fallback.
- The original checkout's unrelated difficulty changes remain outside this release.
