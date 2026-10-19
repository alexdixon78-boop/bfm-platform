type AccountIdentity = {
  id?: string | null;
  role?: string | null;
};

export function getMediatorDetailsPath(user: AccountIdentity | null | undefined): string | null {
  if (user?.role !== "mediator" || !user.id) return null;
  return `/mediators/${user.id}`;
}

export function getMediatorDetailBackNavigation(role: string | null | undefined) {
  return role === "mediator"
    ? { href: "/my-profile", label: "My profile" }
    : { href: "/mediators", label: "Mediators" };
}
