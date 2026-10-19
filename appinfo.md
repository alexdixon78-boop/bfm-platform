# Brighter Future Mediation App Info

## Xero-owned billing

Xero-owned billing is the preferred payment route for new payable MIAM bookings and new mediation-session party invoices. Bank transfer is preferred, and the Xero invoice number is the client-facing payment reference.

In Xero mode the CRM creates authorised Xero invoices and stores the Xero invoice ID, Xero invoice number, online invoice URL, and local finance mirror. Clients can use the Xero online invoice link to pay now; card payment, if available, happens through Xero's online invoice page. The CRM does not create a CRM-owned Stripe Checkout Session in Xero mode.

Xero is the reconciliation point. Booking and mediation-session confirmation waits until Xero reports the relevant invoice paid through invoice webhook/sync. Xero webhook configuration should subscribe to **Invoices**.

Superadmins can see the current Xero readiness checklist and copy the environment-specific Xero webhook endpoint from Settings -> Booking Payment Mode. The endpoint is `/api/public/integrations/xero/webhook` on the configured app origin, and only configured/missing status is shown for secrets. Runtime secrets may be loaded from AWS Secrets Manager when `CONFIG_SOURCE=aws`.

For joint mediation sessions, each active billed party has a separate Xero invoice. One party paying does not confirm the joint session. Confirmation requires every required party invoice to be paid or payment-not-required and all mandatory forms to be complete.

If a client says they have paid by bank transfer, the CRM records money in flight, pauses the relevant hold release, and creates an admin task to check Xero/bank reconciliation. It does not mark the invoice paid.

## Stripe fallback

Direct Stripe Checkout remains available only when a superadmin selects direct Stripe mode in Settings. Existing appointments and invoices keep their original payment provider and links.
