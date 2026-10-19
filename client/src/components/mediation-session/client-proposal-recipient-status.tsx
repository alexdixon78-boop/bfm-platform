import React from "react";

export type ClientProposalRecipientView = {
  id: string;
  partyId?: string | null;
  responseStatus: string;
  respondedAt?: string | Date | null;
};

function formatResponseTime(value: string | Date): string {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ClientProposalRecipientStatusList({
  recipients,
}: {
  recipients: ClientProposalRecipientView[];
}) {
  if (recipients.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="client-proposal-response-empty">
        No response request is linked to your account.
      </p>
    );
  }

  return (
    <div className="grid gap-2" data-testid="client-proposal-response-list">
      {recipients.map((recipient) => (
        <div key={recipient.id} className="rounded-md border bg-muted/10 p-3 text-xs min-w-0">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <p className="font-medium">Your response</p>
            <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 font-semibold capitalize">
              {recipient.responseStatus.replace(/_/g, " ")}
            </span>
          </div>
          <p className="mt-2 text-muted-foreground">
            {recipient.respondedAt
              ? `Responded ${formatResponseTime(recipient.respondedAt)}`
              : "Awaiting your response"}
          </p>
        </div>
      ))}
    </div>
  );
}
