// First visit to the English home page: phones and browsers set to Macedonian go to /mk/.
// Choosing a language in the header is remembered and wins over the device setting.
(function () {
  var stored = null;
  try { stored = localStorage.getItem("lang"); } catch (e) { /* storage blocked: follow the device */ }
  document.addEventListener("click", function (event) {
    var link = event.target.closest && event.target.closest("[data-lang]");
    if (link) try { localStorage.setItem("lang", link.getAttribute("data-lang")); } catch (e) { /* not remembered */ }
  });
  if (location.pathname !== "/" && location.pathname !== "/index.html") return;
  var languages = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ""];
  var prefersMk = String(languages[0] || "").toLowerCase().indexOf("mk") === 0;
  if (stored === "mk" || (!stored && prefersMk)) location.replace("/mk/" + location.hash);
})();
