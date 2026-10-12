/**
 * Sticky header behavior recreating the original WordPress Libre theme
 * with a smooth transition from big header to compact header.
 */
(function () {
  const header = document.querySelector(".site-header");
  if (!header) return;

  let sentinel = document.querySelector(".site-header-sentinel");
  if (!sentinel) {
    sentinel = document.createElement("div");
    sentinel.className = "site-header-sentinel";
    sentinel.setAttribute("aria-hidden", "true");
    header.parentNode.insertBefore(sentinel, header);
  }

  function setSticking(sticking) {
    if (sticking) {
      document.body.classList.add("sticking");
    } else {
      document.body.classList.remove("sticking");
    }
  }

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      function (entries) {
        const entry = entries[0];
        // When the sentinel is above the viewport top, header is stuck
        setSticking(!entry.isIntersecting && entry.boundingClientRect.top <= 0);
      },
      { threshold: 0 }
    );
    observer.observe(sentinel);
  } else {
    function onScroll() {
      const rect = sentinel.getBoundingClientRect();
      setSticking(rect.top <= 0);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }
})();
