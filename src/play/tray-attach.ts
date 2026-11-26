/**
 * Keep an effect layer attached to the dice tray of a board section. The 2.5D dice row is rebuilt by
 * React on each throw, which used to drop canvases prepended into it (boards, synergy and 2.5D item
 * effects vanished after the first roll). This re-creates the layer whenever the tray element changes.
 */
export function attachToTray(section: HTMLElement, create: (tray: HTMLElement) => { dispose(): void }, selector = ".dice-tray-area, .dice-row") {
  let tray: HTMLElement | null = null;
  let layer: { dispose(): void } | null = null;
  let scheduled = 0;
  const check = () => {
    scheduled = 0;
    const next = section.querySelector<HTMLElement>(selector);
    if (next === tray && next?.isConnected) return;
    layer?.dispose();
    layer = null;
    tray = next;
    if (tray) layer = create(tray);
  };
  const mo = new MutationObserver(() => {
    if (!scheduled) scheduled = window.setTimeout(check, 60);
  });
  mo.observe(section, { childList: true, subtree: true });
  check();
  return () => {
    mo.disconnect();
    window.clearTimeout(scheduled);
    layer?.dispose();
  };
}
