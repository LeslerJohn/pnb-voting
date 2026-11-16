"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";

export type Confirmation = {
  title: string;
  message: string;
  label: string;
  onConfirm: () => void;
  destructive?: boolean;
};

export function ConfirmDialog({ request, onDismiss }: { request: Confirmation | null; onDismiss: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (request && !dialog.current?.open) dialog.current?.showModal();
    if (!request && dialog.current?.open) dialog.current.close();
  }, [request]);

  return <dialog ref={dialog} className="confirm-dialog" aria-labelledby="confirm-title" aria-describedby="confirm-message"
    onCancel={(event) => { event.preventDefault(); onDismiss(); }}>
    {request && <>
      <h2 id="confirm-title">{request.title}</h2>
      <p id="confirm-message">{request.message}</p>
      <div>
        <Button type="button" variant="outline" autoFocus onClick={onDismiss}>Cancel</Button>
        <Button type="button" variant={request.destructive ? "destructive" : "default"} onClick={() => {
          onDismiss();
          request.onConfirm();
        }}>{request.label}</Button>
      </div>
    </>}
  </dialog>;
}
