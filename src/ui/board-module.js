// Loads cm-chessboard (vendored ES modules) and hands it to the classic
// scripts as window.CMChessboard; src/ui/board.js wraps it in the board API
// the app uses. Module scripts run after every classic script has been parsed
// but before DOMContentLoaded, so the app's ready handlers (onReady, where it
// builds its boards) always find it.
import { Chessboard, COLOR, INPUT_EVENT_TYPE, FEN } from '../../vendor/cm-chessboard/src/Chessboard.js';
import { Extension, EXTENSION_POINT } from '../../vendor/cm-chessboard/src/model/Extension.js';

// Lets the wrapper redraw its square marks and coordinates whenever
// cm-chessboard rebuilds the squares (resize, orientation).
class BoardDecorations extends Extension {
  constructor(chessboard, props) {
    super(chessboard);
    this.registerExtensionPoint(EXTENSION_POINT.afterRedrawBoard, () => props.redraw(chessboard));
  }
}

const SPRITE = 'vendor/pieces/cburnett/sprite.svg';

// cm-chessboard fetches the sprite when the first board is built and keeps it
// in a hidden element with this id. Start the fetch now instead, so pieces
// are ready by the time the first board appears.
function preloadSprite() {
  if (typeof document === 'undefined' || document.getElementById('cm-chessboard-sprite')) return;
  const wrapper = document.createElement('div');
  wrapper.id = 'cm-chessboard-sprite';
  wrapper.setAttribute('aria-hidden', 'true');
  wrapper.style.cssText = 'position:absolute;transform:scale(0);width:0;height:0;overflow:hidden';
  (document.body || document.documentElement).appendChild(wrapper);
  fetch(SPRITE).then(r => (r.ok ? r.text() : Promise.reject(new Error(r.status))))
    .then(text => { wrapper.insertAdjacentHTML('afterbegin', text); })
    .catch(() => {
      // Let cm-chessboard try again on the next board.
      wrapper.remove();
    });
}

preloadSprite();
globalThis.CMChessboard = { Chessboard, COLOR, INPUT_EVENT_TYPE, FEN, EXTENSION_POINT, BoardDecorations, SPRITE };
