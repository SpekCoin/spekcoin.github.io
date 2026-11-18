// Applies the saved theme before first paint (loaded blocking in <head>), then
// wires the toggle once the page is parsed. With no saved choice the page
// follows the system setting through the prefers-color-scheme media query.
(function () {
  var root = document.documentElement;
  var KEY = 'spek-theme';
  function read() {
    try { return window.localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function write(value) {
    try { window.localStorage.setItem(KEY, value); } catch (e) { /* storage blocked: the choice lasts for this page only */ }
  }
  function systemDark() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function effective() {
    var saved = read();
    if (saved === 'light' || saved === 'dark') return saved;
    return systemDark() ? 'dark' : 'light';
  }
  var saved = read();
  if (saved === 'light' || saved === 'dark') root.setAttribute('data-theme', saved);

  document.addEventListener('DOMContentLoaded', function () {
    var button = document.getElementById('theme-toggle');
    if (!button) return;
    function label() {
      var next = effective() === 'dark' ? 'light' : 'dark';
      button.textContent = next === 'dark' ? 'Dark theme' : 'Light theme';
      button.setAttribute('aria-label', 'Switch to ' + next + ' theme');
    }
    button.hidden = false;
    label();
    button.addEventListener('click', function () {
      var next = effective() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      write(next);
      label();
    });
  });
})();
