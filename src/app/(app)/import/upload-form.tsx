"use client";

import { FileSpreadsheet, Upload, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";

import { Alert, Button, Card } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/format";
import { uploadStockFile } from "@/server/actions/import.actions";
import type { ActionResult } from "@/server/actions/result";

export function UploadForm({ hasPending }: { hasPending: boolean }) {
  const [state, formAction, pending] = useActionState<
    ActionResult<{ id: string }> | null,
    FormData
  >(uploadStockFile, null);

  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const toast = useToast();

  useEffect(() => {
    if (state?.ok && state.data?.id) {
      toast.success(state.message);
      router.push(`/import/${state.data.id}`);
    }
  }, [state, toast, router]);

  /** Keep the native input in step when a file arrives by drag and drop. */
  function accept(next: File | null) {
    setFile(next);
    if (inputRef.current && next) {
      const transfer = new DataTransfer();
      transfer.items.add(next);
      inputRef.current.files = transfer.files;
    }
  }

  return (
    <Card className="p-4">
      <form action={formAction} className="space-y-3">
        {state && !state.ok && <Alert>{state.error}</Alert>}

        {hasPending && (
          <Alert tone="warning">
            A file is already waiting for review. Uploading another one replaces it.
          </Alert>
        )}

        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const dropped = event.dataTransfer.files?.[0];
            if (dropped) accept(dropped);
          }}
          className={cn(
            "rounded-xl border-2 border-dashed p-6 text-center transition-colors",
            dragging
              ? "border-primary bg-primary-soft/40"
              : "border-border-strong bg-surface-2",
          )}
        >
          <input
            ref={inputRef}
            type="file"
            name="file"
            accept=".xlsx,.xls"
            required
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="sr-only"
            id="stock-file"
          />

          {file ? (
            <div className="flex items-center justify-center gap-3">
              <FileSpreadsheet className="h-8 w-8 shrink-0 text-primary" />
              <div className="min-w-0 text-left">
                <p className="truncate text-sm font-semibold text-foreground">
                  {file.name}
                </p>
                <p className="text-xs text-muted">
                  {(file.size / 1024).toFixed(0)} KB · ready to read
                </p>
              </div>
              <button
                type="button"
                aria-label="Remove file"
                onClick={() => {
                  setFile(null);
                  if (inputRef.current) inputRef.current.value = "";
                }}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <>
              <Upload className="mx-auto h-8 w-8 text-muted" />
              <p className="mt-2 text-sm font-medium text-foreground">
                Drop the stock summary here
              </p>
              <p className="mt-0.5 text-xs text-muted">
                Tally → Stock Summary → Export as Excel (.xlsx)
              </p>
              <label
                htmlFor="stock-file"
                className="mt-3 inline-flex h-10 cursor-pointer items-center rounded-lg border border-border-strong bg-surface px-4 text-sm font-medium text-foreground transition-colors hover:bg-surface-hover"
              >
                Choose file
              </label>
            </>
          )}
        </div>

        <Button type="submit" size="lg" block disabled={pending || !file}>
          {pending ? "Reading the file…" : "Read file and show changes"}
        </Button>

        <p className="text-center text-xs text-muted">
          Nothing is changed until you review the differences and approve them.
        </p>
      </form>
    </Card>
  );
}
