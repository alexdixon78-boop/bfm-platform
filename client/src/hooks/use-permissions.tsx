import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./use-auth";
import { canViewSection, canEditSection, type PermissionEntry, DEFAULT_PERMISSIONS } from "@shared/permissions";

export function usePermissions() {
  const { user } = useAuth();

  const { data: permissions, isLoading } = useQuery<PermissionEntry[]>({
    queryKey: ["/api/permissions"],
    staleTime: 5 * 60 * 1000,
  });

  const perms = permissions ?? DEFAULT_PERMISSIONS;

  return {
    canView: (section: string) => user ? canViewSection(perms, user.role, section) : false,
    canEdit: (section: string) => user ? canEditSection(perms, user.role, section) : false,
    permissions: perms,
    isLoading,
    role: user?.role ?? "mediator",
  };
}
