'use client';

import { Upload } from 'lucide-react';
import { type DragEvent, useId, useRef, useState } from 'react';

import { cn } from '@/utils/cn';

export interface FileDropzoneProps {
  /** Visible label, e.g. "Choose an image or drop it here". */
  label: string;
  /** Allowed types and size, shown before upload (PLT-07 UI). */
  hint: string;
  accept: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  onFile: (file: File) => void;
}

/**
 * The shared file picker (PLT-07): a real file input behind a large drop area, so it works
 * with a keyboard, a screen reader and a phone camera roll alike.
 */
export function FileDropzone({
  label,
  hint,
  accept,
  disabled,
  invalid,
  describedBy,
  onFile,
}: FileDropzoneProps) {
  const inputId = useId();
  const hintId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file && !disabled) onFile(file);
  };

  return (
    <label
      htmlFor={inputId}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => {
        setDragging(false);
      }}
      onDrop={handleDrop}
      className={cn(
        'flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border p-6 text-center hover:bg-muted focus-within:outline-2 focus-within:outline-offset-2',
        dragging && 'border-primary bg-muted',
        invalid && 'border-danger',
        disabled && 'pointer-events-none opacity-60',
      )}
    >
      <Upload aria-hidden className="size-7 text-muted-foreground" />
      <span className="font-medium">{label}</span>
      <span id={hintId} className="text-sm text-muted-foreground">
        {hint}
      </span>
      <input
        ref={input}
        id={inputId}
        type="file"
        accept={accept}
        disabled={disabled}
        aria-describedby={describedBy ? `${hintId} ${describedBy}` : hintId}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          // Allow choosing the same file again after an error.
          event.target.value = '';
        }}
      />
    </label>
  );
}
