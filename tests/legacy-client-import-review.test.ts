import assert from "node:assert/strict";
import { test } from "node:test";

const reviewModule = await import(
  "../client/src/components/clients/legacy-client-import-dialog"
);

const profile = {
  firstName: "Testfirst1",
  lastName: "Testlast1",
  dateOfBirth: null,
  email: null,
  phone: null,
  phoneCode: null,
  gender: null,
  ethnicOrigin: null,
  nationalInsuranceNumber: null,
  disabilityOrHealthCondition: null,
  additionalNeeds: null,
  addressLine1: null,
  addressLine2: null,
  city: null,
  postcode: null,
  country: null,
};

function member(
  personKey: string,
  row: number,
  errors: Array<{ code: string; message: string }> = [],
  profileOverrides: Partial<typeof profile> = {},
  sourceRole: "client_1" | "client_2" = "client_1",
) {
  return {
    personKey,
    sourceRowNumber: row,
    sourceRole,
    legacyReference: `SS-2601-${row}`,
    profile: { ...profile, ...profileOverrides },
    originalValues: {},
    legacyOnlyValues: {},
    errors,
    warnings: [],
  };
}

function group(overrides: Record<string, unknown> = {}) {
  return {
    groupId: "row-2:client_1|row-3:client_1",
    memberKeys: ["row-2:client_1", "row-3:client_1"],
    members: [member("row-2:client_1", 2), member("row-3:client_1", 3)],
    candidates: [],
    ...overrides,
  };
}

test("split review groups retain only the CRM candidates matching each person", () => {
  const split = reviewModule.splitReviewGroup(
    group({
      candidates: [
        {
          clientId: "client-1",
          reasons: ["email"],
          memberKeys: ["row-2:client_1"],
          client: { ...profile, id: "client-1" },
        },
      ],
    }) as never,
  );

  assert.equal(split.length, 2);
  assert.equal(split[0].candidates.length, 1);
  assert.equal(split[1].candidates.length, 0);
});

test("review classification moves split prior imports to Errors and clean people to Ready", () => {
  assert.equal(
    reviewModule.classifyReviewGroup(
      group({
        groupId: "imported",
        memberKeys: ["row-2:client_1"],
        members: [
          member("row-2:client_1", 2, [
            { code: "already_imported", message: "Imported previously" },
          ]),
        ],
      }) as never,
    ),
    "Errors",
  );
  assert.equal(
    reviewModule.classifyReviewGroup(
      group({
        groupId: "ready",
        memberKeys: ["row-2:client_1"],
        members: [member("row-2:client_1", 2)],
      }) as never,
    ),
    "Ready",
  );
});

test("bulk linking is allowed only for unambiguous non-imported groups", () => {
  const unique = group({
    candidates: [
      {
        clientId: "client-1",
        reasons: ["email"],
        memberKeys: ["row-2:client_1", "row-3:client_1"],
        client: { ...profile, id: "client-1" },
      },
    ],
  });
  const ambiguous = group({
    candidates: [
      { clientId: "client-1", reasons: ["email"], memberKeys: [], client: { ...profile, id: "client-1" } },
      { clientId: "client-2", reasons: ["name_dob"], memberKeys: [], client: { ...profile, id: "client-2" } },
    ],
  });
  const imported = group({
    members: [member("row-2:client_1", 2, [{ code: "already_imported", message: "Imported previously" }])],
  });

  assert.equal(reviewModule.canBulkResolve([unique] as never, "use_existing"), true);
  assert.equal(reviewModule.canBulkResolve([ambiguous] as never, "use_existing"), false);
  assert.equal(reviewModule.canBulkResolve([imported] as never, "create_new"), false);
  assert.equal(reviewModule.canBulkResolve([imported] as never, "skip"), true);
});

test("skip-all separates mixed prior-import groups without skipping fresh people", () => {
  const mixed = group({
    members: [
      member("row-2:client_1", 2, [
        { code: "already_imported", message: "Imported previously" },
      ]),
      member("row-3:client_1", 3),
    ],
  });
  const prepared = reviewModule.preparePriorImportSkips(
    [mixed] as never,
    {
      [mixed.groupId]: {
        targetKey: mixed.groupId,
        action: "create_new",
        memberKeys: mixed.memberKeys,
        clientData: profile,
      },
    } as never,
  );

  assert.deepEqual(
    prepared.groups.map((candidate) => candidate.groupId),
    ["row-2:client_1", "row-3:client_1"],
  );
  assert.equal(prepared.resolutions["row-2:client_1"].action, "skip");
  assert.equal(prepared.resolutions["row-3:client_1"], undefined);
  assert.equal(prepared.resolutions[mixed.groupId], undefined);
});

test("confirmation rows expand every reviewed person with its chosen destination", () => {
  const rows = reviewModule.buildConfirmationRows(
    [group()] as never,
    {
      "row-2:client_1|row-3:client_1": {
        targetKey: "row-2:client_1|row-3:client_1",
        action: "create_new",
        memberKeys: ["row-2:client_1", "row-3:client_1"],
        clientData: profile,
      },
    } as never,
  );

  assert.deepEqual(
    rows.map((row) => [row.personKey, row.action, row.destination]),
    [
      ["row-2:client_1", "create_new", "New CRM client"],
      ["row-3:client_1", "create_new", "New CRM client"],
    ],
  );
});

test("duplicate reason labels are readable and never expose internal reason codes", () => {
  assert.equal(reviewModule.formatDuplicateReason("email"), "Same email");
  assert.equal(
    reviewModule.formatDuplicateReason("name_dob"),
    "Same name and date of birth",
  );
  assert.equal(
    reviewModule.formatDuplicateReason("phone_last_name"),
    "Same phone and last name",
  );
  assert.equal(
    reviewModule.formatDuplicateReason("future_rule"),
    "Matching client details",
  );
});

test("duplicate comparisons associate exact match fields with each candidate member", () => {
  const emailMember = member("row-2:client_1", 2, [], {
    firstName: "Alex",
    lastName: "Email",
    email: "alex@example.com",
  });
  const nameMember = member(
    "row-3:client_2",
    3,
    [],
    {
      firstName: "Jamie",
      lastName: "Name",
      dateOfBirth: "1985-04-03",
    },
    "client_2",
  );
  const comparisons = reviewModule.buildDuplicateCandidateComparisons(
    group({
      members: [emailMember, nameMember],
      candidates: [
        {
          clientId: "client-1",
          reasons: ["email", "name_dob"],
          memberKeys: [emailMember.personKey, nameMember.personKey],
          client: {
            ...profile,
            id: "client-1",
            firstName: "Jamie",
            lastName: "Name",
            dateOfBirth: "1985-04-03",
            email: "ALEX@EXAMPLE.COM",
          },
        },
      ],
    }) as never,
  );

  assert.equal(comparisons.length, 1);
  assert.deepEqual(comparisons[0].reasonLabels, [
    "Same email",
    "Same name and date of birth",
  ]);
  assert.deepEqual(
    comparisons[0].sources.map((source) => [
      source.personKey,
      source.sourceRole,
      source.reasonLabels,
      source.fields.filter((field) => field.matched).map((field) => field.key),
    ]),
    [
      ["row-2:client_1", "client_1", ["Same email"], ["email"]],
      [
        "row-3:client_2",
        "client_2",
        ["Same name and date of birth"],
        ["firstName", "lastName", "dateOfBirth"],
      ],
    ],
  );
});

test("duplicate comparisons omit unrelated members and render missing identity values safely", () => {
  const matched = member("row-2:client_1", 2, [], {
    lastName: "Person",
    phoneCode: "+44",
    phone: "07700 900123",
  });
  const unrelated = member("row-3:client_1", 3);
  const comparisons = reviewModule.buildDuplicateCandidateComparisons(
    group({
      members: [matched, unrelated],
      candidates: [
        {
          clientId: "client-1",
          reasons: ["phone_last_name"],
          memberKeys: [matched.personKey],
          client: {
            ...profile,
            id: "client-1",
            firstName: "",
            lastName: "Person",
            phoneCode: "44",
            phone: "7700900123",
          },
        },
      ],
    }) as never,
  );

  assert.deepEqual(
    comparisons[0].sources.map((source) => source.personKey),
    [matched.personKey],
  );
  assert.deepEqual(comparisons[0].sources[0].reasonLabels, [
    "Same phone and last name",
  ]);
  assert.equal(
    comparisons[0].sources[0].fields.find(
      (field) => field.key === "firstName",
    )?.crmValue,
    "—",
  );
});

test("duplicate comparisons keep multiple CRM candidates as separate cards", () => {
  const matched = member("row-2:client_1", 2, [], {
    firstName: "Taylor",
    lastName: "Example",
    email: "taylor@example.com",
    dateOfBirth: "1990-01-02",
  });
  const comparisons = reviewModule.buildDuplicateCandidateComparisons(
    group({
      members: [matched],
      candidates: [
        {
          clientId: "email-client",
          reasons: ["email"],
          memberKeys: [matched.personKey],
          client: {
            ...profile,
            id: "email-client",
            email: "taylor@example.com",
          },
        },
        {
          clientId: "name-client",
          reasons: ["name_dob"],
          memberKeys: [matched.personKey],
          client: {
            ...profile,
            id: "name-client",
            firstName: "Taylor",
            lastName: "Example",
            dateOfBirth: "1990-01-02",
          },
        },
      ],
    }) as never,
  );

  assert.deepEqual(
    comparisons.map((comparison) => [
      comparison.clientId,
      comparison.sources[0].reasonLabels,
    ]),
    [
      ["email-client", ["Same email"]],
      ["name-client", ["Same name and date of birth"]],
    ],
  );
});

test("split duplicate comparisons remove reasons contributed by other members", () => {
  const emailMember = member("row-2:client_1", 2, [], {
    firstName: "Email",
    lastName: "Person",
    email: "email@example.com",
  });
  const nameMember = member("row-3:client_1", 3, [], {
    firstName: "Name",
    lastName: "Person",
    dateOfBirth: "1992-02-03",
  });
  const split = reviewModule.splitReviewGroup(
    group({
      members: [emailMember, nameMember],
      candidates: [
        {
          clientId: "client-1",
          reasons: ["email", "name_dob"],
          memberKeys: [emailMember.personKey, nameMember.personKey],
          client: {
            ...profile,
            id: "client-1",
            firstName: "Name",
            lastName: "Person",
            dateOfBirth: "1992-02-03",
            email: "email@example.com",
          },
        },
      ],
    }) as never,
  );

  assert.deepEqual(
    reviewModule.buildDuplicateCandidateComparisons(split[0] as never)[0]
      .reasonLabels,
    ["Same email"],
  );
});

test("duplicate comparisons treat a country code without a phone number as missing", () => {
  const matched = member("row-2:client_1", 2, [], {
    email: "match@example.com",
    phoneCode: "+44",
    phone: null,
  });
  const comparisons = reviewModule.buildDuplicateCandidateComparisons(
    group({
      members: [matched],
      candidates: [
        {
          clientId: "client-1",
          reasons: ["email"],
          memberKeys: [matched.personKey],
          client: {
            ...profile,
            id: "client-1",
            email: "match@example.com",
            phoneCode: "+44",
            phone: null,
          },
        },
      ],
    }) as never,
  );
  const phone = comparisons[0].sources[0].fields.find(
    (field) => field.key === "phone",
  );

  assert.equal(phone?.workbookValue, "—");
  assert.equal(phone?.crmValue, "—");
});
