# Service Drawer Design

## Goal
Build a service-level drawer that opens from the mediator services list and becomes the single place to review status, upload proof, review schedule slots, and inspect history for one service at a time.

## Scope
This spec covers the mediator-facing services list and the service drawer that opens from it.

Included:
- Open a drawer when a service row is clicked.
- Show service identity, per-service status, expiry, and proof state.
- Allow file/link proof upload for services that still need action.
- Show request/review/approval/rejection history for the selected service.
- Show schedule slots for approved services and let the mediator manage slots from the drawer.
- Keep the drawer compact by using collapsible sections under the proof controls.

Out of scope for this slice:
- The dashboard auto-open scheduling popup.
- A separate profile settings redesign.
- Any new payment, messaging, or case-management flow.

## User Experience

### Entry point
The `/services` page remains the list view. Clicking any service row opens a right-side drawer instead of navigating away.

### Drawer layout
The drawer uses a stacked layout:
1. Header
   - service name
   - category
   - current status badge
   - expiry date when present
2. Proof and action area
   - for pending/requested/rejected/expired services, show file upload, link input, expiry date, and `Send request`
   - for approved services, hide upload controls and show the approved state only
   - for admin users reviewing a pending service, show approve/reject actions and rejection reason input
3. Collapsible sections
   - `Schedule`
   - `History`

### Collapsible sections
- `Schedule` opens below the proof area and shows all captured slots for that service.
- `History` opens below schedule and lists a compact timeline of approval, rejection, expiry, reminder, and reupload events.
- Both sections can be collapsed independently so the drawer stays readable on smaller screens.

## Behavior Rules

### Status visibility
- Show the real per-service status only.
- Do not show proof controls for an approved service.
- If a service is rejected or expired, only that service should show reupload controls and the rejection reason.
- If a service is pending review, the mediator can only wait for admin review unless the flow explicitly allows resubmission from a rejection or expiry state.

### Proof submission
- Mediator can upload either a file or a supporting link, or both.
- Submitting proof updates the selected service only.
- Validation must block submission when a starred/requested service lacks proof.

### Schedule
- Approved services can show and manage availability slots.
- A service can have multiple slots.
- Slots must be validated against:
  - other slots for the same service
  - approved services owned by the same mediator
  - existing booked appointments
- The drawer should surface the current slot count and expose the schedule editor from the service context.

### History
The history panel should show:
- proof submitted
- admin requested more documents
- admin approved
- admin rejected with reason
- service expired
- reminder sent
- schedule saved

## Data Requirements

The drawer depends on the existing per-service approval record and schedule slot data.

Needed fields for the service card and drawer:
- service name
- service category
- approval status
- effective approval status
- proof file metadata
- proof link
- expiry date
- rejection reason
- submitted/reviewed timestamps
- schedule slot rows

If a field is missing from the current API response, the service detail endpoint should be extended rather than duplicating logic in the client.

## Responsive Behavior

- On desktop, the drawer should slide in from the right and keep the service list visible.
- On mobile, the drawer can take full width.
- Long history lists should scroll inside the drawer rather than pushing the whole page down.

## Error Handling

- If the service is not eligible for upload, hide upload controls instead of showing a failed action.
- If schedule save fails, keep the drawer open and show the server error in place.
- If the selected service expires while the drawer is open, refresh the status before allowing a save.

## Testing

### Manual checks
- Click a service row and confirm the drawer opens.
- Verify approved services hide proof controls.
- Verify rejected and expired services still show the reupload path.
- Verify schedule and history can be collapsed independently.
- Verify slot counts and status badges update after save.

### Regression checks
- A mediator approved for one service should not see upload controls on other approved services.
- A pending review service should remain pending until admin review completes.
- A rejected service should preserve and show the rejection reason.
- Expired services should display as expired once the expiry date is reached.

## Implementation Notes

- Reuse the existing service approval status logic instead of duplicating status computation in the UI.
- Keep the drawer state local to the services page so navigation stays simple.
- Prefer the existing service approval and schedule service endpoints as the backend source of truth.
- Document any new service-specific fields in `replit.md` when the feature is implemented.

