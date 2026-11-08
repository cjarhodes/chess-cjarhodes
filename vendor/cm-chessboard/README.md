# cm-chessboard 8.15.4

Vendored from the npm package `cm-chessboard@8.15.4`
(https://github.com/shaack/cm-chessboard), MIT licence (see `LICENSE`).

Only the core is kept, unmodified: `src/Chessboard.js`, `src/model/`,
`src/view/`, `src/lib/` and `assets/chessboard.css`. The extensions
(markers, arrows, promotion dialog, accessibility, …), the bundled piece
sprites and the SCSS sources are left out: the app draws its own square marks,
coordinates and overlay, and uses the cburnett sprite in
`vendor/pieces/cburnett/sprite.svg`.

The app never imports these files directly. `src/ui/board-module.js` imports
them and `src/ui/board.js` wraps them in the small chessboard.js-style API the
rest of the app uses. To upgrade, replace these files with the same paths from
the new package, then run `scripts/verify-browser.sh`.
