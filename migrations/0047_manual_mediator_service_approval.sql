ALTER TABLE mediator_service_approvals
  ADD COLUMN IF NOT EXISTS manual_approval_note TEXT;
