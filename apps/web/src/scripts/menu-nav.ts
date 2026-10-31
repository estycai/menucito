import { activeSectionIndex } from "../lib/scroll-spy";

/**
 * Progressive enhancement of the category bar (plain anchors without JavaScript):
 * - marks the bar as stuck once it reaches the top, which shows the identity bar and turns pills into tabs;
 * - keeps `aria-current` on the chip of the section being read and scrolls the chip list sideways to show it.
 */
function init() {
  const nav = document.querySelector<HTMLElement>("[data-category-nav]");
  const sentinel = document.querySelector<HTMLElement>("[data-nav-sentinel]");
  const list = nav?.querySelector<HTMLElement>("ul");
  if (!nav || !sentinel || !list) return;

  const chips = Array.from(nav.querySelectorAll<HTMLAnchorElement>("a.chip"));
  const sections = chips.map((chip) => document.getElementById(chip.hash.slice(1))?.closest("section") ?? null);
  if (chips.length === 0 || sections.some((section) => section === null)) return;

  const barHeight = () => parseFloat(getComputedStyle(nav).top) || 0;

  // The sentinel sits right before the bar, so it leaves the viewport (below the identity bar) as the bar sticks.
  new IntersectionObserver(
    ([entry]) => {
      if (entry) nav.toggleAttribute("data-stuck", !entry.isIntersecting && entry.boundingClientRect.top < barHeight());
    },
    { rootMargin: `-${barHeight()}px 0px 0px 0px` },
  ).observe(sentinel);

  let current = -1;

  function showChip(chip: HTMLElement) {
    const pad = 16;
    const left = chip.offsetLeft - pad;
    const right = chip.offsetLeft + chip.offsetWidth + pad - list!.clientWidth;
    // Only the chip list moves, never the page (so no scrollIntoView).
    let target = list!.scrollLeft;
    if (left < target) target = left;
    else if (right > target) target = right;
    if (target === list!.scrollLeft) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    list!.scrollTo({ left: Math.max(0, target), behavior: reduced ? "auto" : "smooth" });
  }

  function update() {
    const line = barHeight() + nav!.offsetHeight + 16;
    const tops = sections.map((section) => section!.getBoundingClientRect().top);
    let index = activeSectionIndex(tops, line);
    // The last section can be too short to ever reach the line: at the very bottom it is the one being read.
    const atBottom = window.scrollY > 0 && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
    if (atBottom) index = chips.length - 1;
    if (index === current) return;
    current = index;
    chips.forEach((chip, position) => {
      if (position === index) chip.setAttribute("aria-current", "true");
      else chip.removeAttribute("aria-current");
    });
    showChip(chips[index]!);
  }

  let frame = 0;
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      update();
    });
  };

  addEventListener("scroll", schedule, { passive: true });
  addEventListener("resize", schedule);
  update();
}

init();
