const PUBLIC_ROUTE_PATTERNS = [
  /^\/book\/[^/]+\/?$/,
  /^\/demographic-form\/[^/]+\/?$/,
  /^\/consent\/representative\/[^/]+\/?$/,
  /^\/consent\/[^/]+\/?$/,
  /^\/case-follow-up-consent\/[^/]+\/?$/,
  /^\/session-availability\/[^/]+\/?$/,
  /^\/apply\/mediator\/[^/]+\/?$/,
  /^\/apply\/contractor\/[^/]+\/?$/,
  /^\/update-application\/[^/]+\/?$/,
  /^\/register\/[^/]+\/?$/,
  /^\/forgot-password\/?$/,
  /^\/reset-password\/[^/]+\/?$/,
  /^\/onboarding\/?$/,
];

export function isPublicRoute(path: string): boolean {
  const pathname = path.split(/[?#]/, 1)[0] || "/";
  return PUBLIC_ROUTE_PATTERNS.some((pattern) => pattern.test(pathname));
}
