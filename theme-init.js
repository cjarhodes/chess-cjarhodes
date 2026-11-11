// Applies the saved colour and board themes before the first paint, so the
// page never flashes the wrong theme. src/views/shell.js owns the settings controls.
(function () {
  var root = document.documentElement;
  try {
    var theme = localStorage.getItem('ui:theme');
    if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
    var board = localStorage.getItem('ui:board-theme');
    if (board === 'ivory') board = 'walnut';
    if (board === 'walnut' || board === 'green' || board === 'blue' || board === 'contrast') root.setAttribute('data-board-theme', board);
  } catch (e) { /* storage unavailable: device theme and default board */ }
}());
