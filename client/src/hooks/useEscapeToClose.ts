import { useEffect, useRef } from "react";

// Open popups, newest last. Escape closes only the topmost one, so a confirmation shown over a form
// closes without also closing the form.
const openStack: symbol[] = [];

/** Closes the popup on Escape while `open`; `disabled` (e.g. while saving) ignores Escape but keeps its place on top. */
export function useEscapeToClose(open: boolean, onClose: () => void, disabled = false) {
  const close = useRef(onClose);
  const blocked = useRef(disabled);
  close.current = onClose;
  blocked.current = disabled;

  useEffect(() => {
    if (!open) return;
    const id = Symbol("popup");
    openStack.push(id);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || openStack[openStack.length - 1] !== id || blocked.current) return;
      event.preventDefault();
      close.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      openStack.splice(openStack.indexOf(id), 1);
    };
  }, [open]);
}
