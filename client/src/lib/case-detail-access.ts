export type PrivateNotesAccess = "author_only" | "review_all" | null | undefined;

export function getCaseDetailCapabilities({
  canViewOperationalStaffData,
  privateNotesAccess,
  canViewCourtForms,
}: {
  canViewOperationalStaffData: boolean;
  privateNotesAccess: PrivateNotesAccess;
  canViewCourtForms: boolean;
}) {
  const canViewPrivateNotes = privateNotesAccess === "author_only" || privateNotesAccess === "review_all";

  return {
    canViewPrivateNotes,
    canAccessNotesTab: canViewOperationalStaffData || canViewPrivateNotes,
    canViewCourtFormsStatus: canViewCourtForms,
  };
}

export function shouldRedirectFromNotesTab({
  activeTab,
  caseDetailLoaded,
  canAccessNotesTab,
}: {
  activeTab: string;
  caseDetailLoaded: boolean;
  canAccessNotesTab: boolean;
}) {
  return activeTab === "notes" && caseDetailLoaded && !canAccessNotesTab;
}
