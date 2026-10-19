type AdminRoleMutation = {
  operation: "create" | "update" | "delete";
  currentRole?: string;
  requestedRole?: string;
};

export function validateAdminRoleMutation(input: AdminRoleMutation): string | null {
  if (input.operation === "delete" && input.currentRole === "superadmin") {
    return "The bootstrap superadmin cannot be deleted";
  }
  if (input.operation === "update" && input.currentRole === "superadmin" && input.requestedRole && input.requestedRole !== "superadmin") {
    return "The bootstrap superadmin cannot be demoted";
  }
  if (input.requestedRole === "superadmin" && input.currentRole !== "superadmin") {
    return "Only the bootstrap superadmin account may have the superadmin role";
  }
  return null;
}
