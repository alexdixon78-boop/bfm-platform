import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X } from "lucide-react";

export const CASE_EMAIL_ATTACHMENT_LIMIT = 10;
export const CASE_EMAIL_ATTACHMENT_LIMIT_MESSAGE = "You can attach up to 10 attachments in total.";

type NamedFile = { name: string };

export function appendQueuedAttachments<T extends NamedFile>(
  currentFiles: readonly T[],
  incomingFiles: readonly T[],
  selectedDocumentCount: number,
): { files: T[]; error: string | null } {
  if (selectedDocumentCount + currentFiles.length + incomingFiles.length > CASE_EMAIL_ATTACHMENT_LIMIT) {
    return { files: [...currentFiles], error: CASE_EMAIL_ATTACHMENT_LIMIT_MESSAGE };
  }
  return { files: [...currentFiles, ...incomingFiles], error: null };
}

export function removeQueuedAttachment<T>(files: readonly T[], index: number): T[] {
  return files.filter((_, fileIndex) => fileIndex !== index);
}

export async function uploadQueuedAttachments<T>(
  existingDocumentIds: readonly string[],
  files: readonly T[],
  upload: (file: T) => Promise<string>,
): Promise<{ documentIds: string[]; failedFiles: T[]; errors: unknown[] }> {
  if (existingDocumentIds.length + files.length > CASE_EMAIL_ATTACHMENT_LIMIT) {
    throw new Error(CASE_EMAIL_ATTACHMENT_LIMIT_MESSAGE);
  }
  const settledUploads = await Promise.allSettled(files.map(upload));
  const uploadedDocumentIds: string[] = [];
  const failedFiles: T[] = [];
  const errors: unknown[] = [];
  settledUploads.forEach((result, index) => {
    if (result.status === "fulfilled") uploadedDocumentIds.push(result.value);
    else {
      failedFiles.push(files[index]);
      errors.push(result.reason);
    }
  });
  return { documentIds: [...existingDocumentIds, ...uploadedDocumentIds], failedFiles, errors };
}

export function caseEmailAttachmentStateAfterSend(sent: boolean, documentIds: readonly string[]) {
  return sent
    ? { documentIds: [] as string[], shouldClose: true }
    : { documentIds: [...documentIds], shouldClose: false };
}

export function CaseEmailAttachmentPicker({
  files,
  attachmentCount,
  error,
  disabled,
  onFilesSelected,
  onRemove,
}: {
  files: readonly File[];
  attachmentCount: number;
  error: string | null;
  disabled: boolean;
  onFilesSelected: (files: File[]) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="mt-2 space-y-2">
      <Input
        type="file"
        multiple
        disabled={disabled}
        onChange={(event) => {
          onFilesSelected(Array.from(event.currentTarget.files || []));
          event.currentTarget.value = "";
        }}
      />
      <p className="text-xs text-muted-foreground">
        {attachmentCount} of {CASE_EMAIL_ATTACHMENT_LIMIT} attachments selected
      </p>
      {files.length > 0 && (
        <div className="space-y-1">
          {files.map((file, index) => (
            <div key={`${file.name}-${file.lastModified}-${index}`} className="flex items-center justify-between gap-2 rounded border px-3 py-2 text-sm">
              <span className="min-w-0 truncate" title={file.name}>{file.name}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                aria-label={`Remove ${file.name}`}
                onClick={() => onRemove(index)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
