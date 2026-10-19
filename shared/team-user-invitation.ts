export function canSendTeamUserInvite(user: { role: string; status: string }): boolean {
  return (user.role === "subadmin" || user.role === "staff")
    && (user.status === "pending" || user.status === "active");
}
