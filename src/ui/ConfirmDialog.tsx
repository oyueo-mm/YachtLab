import { ActivityVisible } from "../shell/activity-visible";
import { useContext, useEffect, useId, useRef } from "react";

/** Modal confirmation used before abandoning or resetting a game in progress. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel = "계속 플레이",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const visible = useContext(ActivityVisible);
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && visible && !dialog.open) dialog.showModal?.();
    if ((!open || !visible) && dialog.open) dialog.close();
  }, [open, visible]);
  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      aria-labelledby={id + "t"}
      aria-describedby={id + "m"}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <h2 id={id + "t"}>{title}</h2>
      <p id={id + "m"}>{message}</p>
      <div className="confirm-actions">
        <button type="button" className="secondary" onClick={onCancel} autoFocus>
          {cancelLabel}
        </button>
        <button type="button" className="primary" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

/** Small helper: run `action` directly when nothing is at stake, otherwise ask first. */
export type PendingAction = { title: string; message: string; confirmLabel: string; run: () => void } | null;
