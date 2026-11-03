import { useEffect } from "react";

/** Stops the page behind a modal from scrolling while the calling component is mounted. */
export function useScrollLock() {
  useEffect(() => {
    const html = document.documentElement;
    const previous = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      html.style.overflow = previous;
    };
  }, []);
}
