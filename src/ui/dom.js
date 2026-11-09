// Small DOM helpers shared by the app's classic scripts (they replaced
// jQuery). Call sites use plain DOM APIs; these cover only what the DOM has
// no one-liner for. Loaded first, so every later script can use them. Nothing
// here touches the DOM at load time (Node validators load this file too).

function byId(id) { return document.getElementById(id); }
function qs(selector, root) { return (root || document).querySelector(selector); }
function qsa(selector, root) { return Array.from((root || document).querySelectorAll(selector)); }

// An element, null, or a list of elements, as a list.
function domList(target) {
  if (!target) return [];
  if (target.nodeType || (typeof window !== 'undefined' && target === window)) return [target];
  return Array.from(target);
}

// on(target, type, handler) binds directly; on(target, type, selector,
// handler) delegates to descendants matching selector. `this` is the bound
// element (or the matched descendant), as handlers expect.
function on(target, type, selector, handler) {
  if (typeof selector === 'function') { handler = selector; selector = null; }
  domList(target).forEach(node => node.addEventListener(type, function(event) {
    if (!selector) return handler.call(node, event);
    const start = event.target && (event.target.nodeType === 1 ? event.target : event.target.parentElement);
    const match = start && start.closest(selector);
    if (!match || (node !== document && !node.contains(match))) return;
    if (type === 'click' && match.disabled === true) return;
    return handler.call(match, event);
  }));
}

// Run fn once the document has loaded, after every DOMContentLoaded listener
// (each in its own task, in the order registered). This is the order the
// app's startup code has always run in: it builds on what the feature
// modules set up at DOMContentLoaded.
const domReadyQueue = [];
let domReadyFired = false;
function onReady(fn) {
  if (domReadyFired || document.readyState !== 'loading') setTimeout(fn);
  else domReadyQueue.push(fn);
}
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('DOMContentLoaded', () => {
    domReadyFired = true;
    domReadyQueue.splice(0).forEach(fn => setTimeout(fn));
  });
}

// Showing and hiding by inline display. Hiding remembers an inline display
// (say flex) so showing restores it; an element its stylesheet hides is shown
// with its tag's default display.
const domSavedDisplay = new WeakMap();
const domDefaultDisplay = {};
function domHiddenByStyle(el) {
  return el.style.display === 'none' ||
    (el.style.display === '' && el.isConnected && getComputedStyle(el).display === 'none');
}
function domTagDisplay(el) {
  const name = el.nodeName;
  if (!domDefaultDisplay[name]) {
    const probe = document.body.appendChild(document.createElement(name));
    const display = getComputedStyle(probe).display;
    probe.remove();
    domDefaultDisplay[name] = display === 'none' ? 'block' : display;
  }
  return domDefaultDisplay[name];
}
function domSetShown(el, shown) {
  if (!el || !el.style) return;
  if (shown) {
    if (el.style.display === 'none') el.style.display = domSavedDisplay.get(el) || '';
    if (el.style.display === '' && domHiddenByStyle(el)) el.style.display = domTagDisplay(el);
  } else if (el.style.display !== 'none') {
    domSavedDisplay.set(el, el.style.display);
    el.style.display = 'none';
  }
}
function showEl(target) { domList(target).forEach(el => domSetShown(el, true)); }
function hideEl(target) { domList(target).forEach(el => domSetShown(el, false)); }
// toggleEl(target, shown) with a boolean shows or hides; without one it flips.
function toggleEl(target, shown) {
  domList(target).forEach(el => {
    if (!el || !el.style) return;
    domSetShown(el, typeof shown === 'boolean' ? shown : domHiddenByStyle(el));
  });
}

// True when any of the elements takes up space on the page.
function isVisible(target) {
  return domList(target).some(el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length));
}

// makeEl('div', 'practice-row', 'text'): a new element with a class and text.
function makeEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined && text !== null) el.textContent = text;
  return el;
}
