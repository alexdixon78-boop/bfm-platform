type RevealFirstInvalidFormFieldOptions = {
  errors: object;
  fieldOrder: readonly string[];
  container: ParentNode | null;
  prefersReducedMotion?: boolean;
};

function userPrefersReducedMotion() {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function revealFirstInvalidFormField({
  errors,
  fieldOrder,
  container,
  prefersReducedMotion = userPrefersReducedMotion(),
}: RevealFirstInvalidFormFieldOptions) {
  const errorMap = errors as Record<string, unknown>;
  const firstInvalidField = fieldOrder.find((fieldName) => Boolean(errorMap[fieldName]));
  if (!firstInvalidField || !container) return;

  const target = container.querySelector<HTMLElement>(`[data-form-field="${firstInvalidField}"]`);
  if (!target) return;

  target.scrollIntoView({
    behavior: prefersReducedMotion ? "auto" : "smooth",
    block: "center",
    inline: "nearest",
  });
  target.focus({ preventScroll: true });
}
