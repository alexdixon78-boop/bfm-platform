export function eligibleCaseTaskAssignees(
  people: ReadonlyArray<{ id: string; role: string; status: string }>,
  mediatorIds: ReadonlySet<string>,
  superadminId: string,
  hasLeadMediator: boolean,
): string[] {
  return people.filter((person) => person.status === "active" && (
    (person.role === "superadmin" && person.id === superadminId && !hasLeadMediator)
    || (person.role === "mediator" && mediatorIds.has(person.id))
  )).map((person) => person.id);
}
