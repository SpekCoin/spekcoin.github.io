// Copy buttons for hash displays. Without JavaScript the buttons stay hidden
// and the full value is still selectable and carried in the title attribute.
(function () {
  document.querySelectorAll('button[data-copy]').forEach(function (button) {
    button.hidden = false;
    button.addEventListener('click', function () {
      var value = button.getAttribute('data-copy');
      var done = function () {
        var original = button.textContent;
        button.textContent = 'Copied';
        window.setTimeout(function () { button.textContent = original; }, 1500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(value).then(done, function () {});
      }
    });
  });
})();
