export function onboardingDestination(role: string): string | null {
  if (role === "contractor") return "/contractor-home";
  if (role === "staff" || role === "subadmin") return "/dashboard";
  return null;
}
