import { useEffect } from "react";
import { documentTitle } from "./nav";

/** Sets `document.title` to "<section> · Menucito". Nothing is restored on unmount. */
export function useDocumentTitle(section: string | undefined) {
  useEffect(() => {
    if (section) document.title = documentTitle(section);
  }, [section]);
}
