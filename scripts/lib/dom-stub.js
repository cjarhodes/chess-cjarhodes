// Stand-ins for the DOM helpers in src/ui/dom.js, for Node validators that run
// app logic without a page. Every element lookup returns one inert element
// that accepts any property and method call; ready handlers never run (the
// validators call what they test themselves).
function inertElement() {
  const store = {};
  const element = new Proxy(function() {}, {
    get(target, key) {
      if (key in store) return store[key];
      if (key === 'classList') return { add() {}, remove() {}, toggle() {}, contains: () => false, replace() {} };
      if (key === 'style' || key === 'dataset') return (store[key] = {});
      if (key === 'children' || key === 'childNodes') return [];
      if (typeof key === 'symbol') return undefined;
      return () => element;
    },
    set(target, key, value) { store[key] = value; return true; },
    apply: () => element
  });
  return element;
}

function domStub() {
  const element = inertElement();
  return {
    byId: () => element,
    qs: () => element,
    qsa: () => [],
    domList: target => (target ? [target] : []),
    on: () => {},
    onReady: () => {},
    showEl: () => {},
    hideEl: () => {},
    toggleEl: () => {},
    isVisible: () => false,
    makeEl: () => inertElement()
  };
}

module.exports = { domStub, inertElement };
