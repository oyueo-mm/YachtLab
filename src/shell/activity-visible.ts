import { createContext, useContext, useLayoutEffect, type RefObject } from "react";

/** An in-place activity suspended for a quick match. */
export const ActivityVisible = createContext(true);

export function useActivityDialog(dialog: RefObject<HTMLDialogElement | null>, open = true) {
  const visible = useContext(ActivityVisible);
  useLayoutEffect(() => {
    const surface = dialog.current;
    if (!surface) return;
    if (visible && open && !surface.open) surface.showModal();
    else if ((!visible || !open) && surface.open) surface.close();
  }, [dialog, visible, open]);
}
