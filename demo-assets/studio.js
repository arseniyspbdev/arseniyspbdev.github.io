// Observe only regular content. Pinned 3D scenes keep their own animation lifecycle.
(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || !('IntersectionObserver' in window)) return;
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    }
  }, { threshold: .06 });
  document.querySelectorAll('.section-head,.service,.kind,.master,.plan-card,.format,.studio-footer').forEach((element) => {
    if (element.getBoundingClientRect().top < innerHeight) return;
    element.classList.add('studio-reveal');
    observer.observe(element);
  });
})();
