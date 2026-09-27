import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Copies text to the clipboard and remembers, for 2.5 s, that it did - so a
 * button can say "Copied". Resolves false when the browser refuses, and the
 * caller decides the fallback (a mailto: link, say).
 */
export function useCopy() {
  const [copied, setCopied] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = useCallback(async (text: string) => {
    try {
      if (!navigator.clipboard?.writeText) return false;
      await navigator.clipboard.writeText(text);
    } catch {
      return false;
    }
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 2500);
    return true;
  }, []);

  return { copied, copy };
}

/** "Copy the address" with a mailto: fallback when the clipboard is off limits. */
export function useCopyEmail(address: string) {
  const { copied, copy } = useCopy();
  const copyOrMail = useCallback(
    async (e?: React.MouseEvent) => {
      e?.preventDefault();
      if (!(await copy(address))) window.location.href = `mailto:${address}`;
    },
    [copy, address]
  );
  return { copied, copyOrMail };
}
