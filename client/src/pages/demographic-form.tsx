import { useState, useEffect } from "react";
import { useRoute } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import {
  GENDERS, ETHNIC_GROUPS, DISABILITY_OPTIONS, EMPLOYMENT_STATUSES,
  COURT_PROCEEDINGS_STATUSES, COMMON_LANGUAGES, COUNTRIES_OF_BIRTH,
  INTERPRETER_SUPPORT_OPTIONS, LEGAL_AID_OPTIONS, VOUCHER_SCHEME_OPTIONS,
  CAFCASS_OPTIONS, SOLICITOR_OPTIONS, EMOTIONAL_WELLBEING_LABELS,
} from "@shared/schema";
import bfmLogo from "@assets/Main_use_colour_logo_1771923374051.png";

type FormData = {
  dateOfBirth: string;
  genderIdentity: string;
  genderSelfDescription: string;
  ethnicity: string;
  ethnicSelfDisclose: string;
  countryOfBirth: string;
  countryOfBirthOther: string;
  firstLanguage: string;
  firstLanguageOther: string;
  interpreterNeeded: string;
  interpreterLanguage: string;
  disabilityOrHealthConditions: string[];
  additionalNeeds: string;
  employmentStatus: string;
  legalAidEligible: string;
  voucherSchemeEligible: string;
  courtProceedingsStatus: string;
  courtReference: string;
  courtName: string;
  cafcassInvolved: string;
  solicitorInvolved: string;
  solicitorName: string;
  childrenAges: string;
  lifeSatisfaction: number | null;
  anxietyScore: number | null;
  emotionalWellbeing: number | null;
};

const initialFormData: FormData = {
  dateOfBirth: "",
  genderIdentity: "",
  genderSelfDescription: "",
  ethnicity: "",
  ethnicSelfDisclose: "",
  countryOfBirth: "",
  countryOfBirthOther: "",
  firstLanguage: "",
  firstLanguageOther: "",
  interpreterNeeded: "",
  interpreterLanguage: "",
  disabilityOrHealthConditions: [],
  additionalNeeds: "",
  employmentStatus: "",
  legalAidEligible: "",
  voucherSchemeEligible: "",
  courtProceedingsStatus: "",
  courtReference: "",
  courtName: "",
  cafcassInvolved: "",
  solicitorInvolved: "",
  solicitorName: "",
  childrenAges: "",
  lifeSatisfaction: null,
  anxietyScore: null,
  emotionalWellbeing: null,
};

const REQUIRED_FIELDS: (keyof FormData)[] = [
  "genderIdentity", "ethnicity", "firstLanguage", "interpreterNeeded",
  "employmentStatus", "legalAidEligible", "voucherSchemeEligible",
  "courtProceedingsStatus", "cafcassInvolved",
  "lifeSatisfaction", "anxietyScore", "emotionalWellbeing",
];

function RequiredStar() {
  return <span className="text-red-500 ml-0.5">*</span>;
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-red-500 mt-0.5">{message}</p>;
}

function GroupedEthnicitySelect({ value, onValueChange, testId }: {
  value: string;
  onValueChange: (v: string) => void;
  testId: string;
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger data-testid={testId}>
        <SelectValue placeholder="Select ethnicity" />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(ETHNIC_GROUPS).map(([group, options]) => (
          <SelectGroup key={group}>
            <SelectLabel className="text-xs font-semibold text-muted-foreground">{group}</SelectLabel>
            {options.map((opt) => (
              <SelectItem key={opt} value={opt}>{opt.replace(/^(White|Mixed|Asian|Black|Other) - /, "")}</SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

function MultiSelectCheckboxes({ options, selected, onChange, testId }: {
  options: readonly string[];
  selected: string[];
  onChange: (v: string[]) => void;
  testId: string;
}) {
  const handleToggle = (opt: string) => {
    if (opt === "None") {
      onChange(selected.includes("None") ? [] : ["None"]);
      return;
    }
    let next = selected.filter(s => s !== "None");
    if (next.includes(opt)) {
      next = next.filter(s => s !== opt);
    } else {
      next.push(opt);
    }
    onChange(next);
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" data-testid={testId}>
      {options.map((opt) => (
        <label key={opt} className="flex items-center gap-2 text-sm cursor-pointer">
          <Checkbox
            checked={selected.includes(opt)}
            onCheckedChange={() => handleToggle(opt)}
            data-testid={`checkbox-${testId}-${opt.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
          />
          <span className="leading-tight">{opt}</span>
        </label>
      ))}
    </div>
  );
}

export default function DemographicFormPage() {
  const [, params] = useRoute("/demographic-form/:token");
  const token = params?.token;
  const { toast } = useToast();
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const formQuery = useQuery({
    queryKey: ["/api/public/demographic-form", token],
    queryFn: async () => {
      const res = await fetch(`/api/public/demographic-form/${token}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to load form");
      }
      return res.json();
    },
    enabled: !!token,
    retry: false,
  });

  useEffect(() => {
    if (formQuery.data) {
      const d = formQuery.data;
      const existing = d.existingData;
      setFormData((prev) => ({
        ...prev,
        dateOfBirth: existing?.dateOfBirth || d.dateOfBirth || "",
        genderIdentity: existing?.genderIdentity || d.gender || "",
        ethnicity: existing?.ethnicity || d.ethnicOrigin || "",
        ...(existing ? {
          genderSelfDescription: existing.genderSelfDescription || "",
          ethnicSelfDisclose: existing.ethnicSelfDisclose || "",
          countryOfBirth: existing.countryOfBirth || "",
          countryOfBirthOther: existing.countryOfBirthOther || "",
          firstLanguage: existing.firstLanguage || "",
          firstLanguageOther: existing.firstLanguageOther || "",
          interpreterNeeded: existing.interpreterNeeded || "",
          interpreterLanguage: existing.interpreterLanguage || "",
          disabilityOrHealthConditions: parseMultiSelect(existing.disabilityOrHealthConditions),
          additionalNeeds: existing.additionalNeeds || "",
          employmentStatus: existing.employmentStatus || "",
          legalAidEligible: existing.legalAidEligible || "",
          voucherSchemeEligible: existing.voucherSchemeEligible || "",
          courtProceedingsStatus: existing.courtProceedingsStatus || "",
          courtReference: existing.courtReference || "",
          courtName: existing.courtName || "",
          cafcassInvolved: existing.cafcassInvolved || "",
          solicitorInvolved: existing.solicitorInvolved || "",
          solicitorName: existing.solicitorName || "",
          childrenAges: existing.childrenAges || "",
          lifeSatisfaction: existing.lifeSatisfaction ?? null,
          anxietyScore: existing.anxietyScore ?? null,
          emotionalWellbeing: existing.emotionalWellbeing ?? null,
        } : {}),
      }));
    }
  }, [formQuery.data]);

  function parseMultiSelect(val: any): string[] {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    try { return JSON.parse(val); } catch { return val ? [val] : []; }
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    for (const field of REQUIRED_FIELDS) {
      const val = formData[field];
      if (val === null || val === undefined || val === "" || (typeof val === "number" && isNaN(val))) {
        const label = field.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase());
        errs[field] = `${label} is required`;
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  const submitMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const payload = {
        ...data,
        disabilityOrHealthConditions: JSON.stringify(data.disabilityOrHealthConditions),
      };
      const res = await fetch(`/api/public/demographic-form/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to submit form");
      }
      return res.json();
    },
    onSuccess: () => {
      setSubmitted(true);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (!validate()) {
      toast({ title: "Please fill in all required fields", description: "Required fields are marked with *", variant: "destructive" });
      return;
    }
    submitMutation.mutate(formData);
  };

  const updateField = <K extends keyof FormData>(key: K, value: FormData[K]) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) {
      setErrors((prev) => { const n = { ...prev }; delete n[key]; return n; });
    }
  };

  if (formQuery.isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#f5f0eb] via-white to-[#f0f5ef] flex items-center justify-center p-4">
        <Card className="w-full max-w-2xl">
          <CardContent className="p-8 space-y-4">
            <Skeleton className="h-8 w-48 mx-auto" />
            <Skeleton className="h-4 w-64 mx-auto" />
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (formQuery.error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#f5f0eb] via-white to-[#f0f5ef] flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center space-y-4">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto" />
            <h2 className="text-lg font-semibold">Unable to Load Form</h2>
            <p className="text-sm text-muted-foreground">{(formQuery.error as Error).message}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#f5f0eb] via-white to-[#f0f5ef] flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center space-y-4" data-testid="demographic-form-success">
            <CheckCircle2 className="w-12 h-12 text-[#5a7d58] mx-auto" />
            <h2 className="text-lg font-semibold">Form Submitted Successfully</h2>
            <p className="text-sm text-muted-foreground">
              Thank you for completing your demographic information. Your mediator will review the details.
            </p>
            <p className="text-xs text-muted-foreground">You can safely close this page.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#f5f0eb] via-white to-[#f0f5ef] py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="text-center space-y-3">
          <img src={bfmLogo} alt="Brighter Future Mediation" className="h-16 mx-auto" />
          <h1 className="text-2xl font-heading font-bold text-gray-800">Demographic Information</h1>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Please complete this demographic information form.
            This information is required for FMC and MOJ reporting and will be kept strictly confidential.
          </p>
          <p className="text-xs text-muted-foreground">Fields marked with <span className="text-red-500">*</span> are required.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base font-heading">Personal Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-sm">Date of Birth</Label>
                <Input
                  type="date"
                  value={formData.dateOfBirth}
                  onChange={(e) => updateField("dateOfBirth", e.target.value)}
                  data-testid="input-dob"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Gender Identity<RequiredStar /></Label>
                <Select value={formData.genderIdentity} onValueChange={(v) => updateField("genderIdentity", v)}>
                  <SelectTrigger data-testid="select-gender" className={errors.genderIdentity ? "border-red-500" : ""}>
                    <SelectValue placeholder="Select gender identity" />
                  </SelectTrigger>
                  <SelectContent>
                    {GENDERS.map((g) => (
                      <SelectItem key={g} value={g}>{g}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError message={errors.genderIdentity} />
              </div>
            </div>

            {formData.genderIdentity === "Self-describe" && (
              <div className="space-y-1.5">
                <Label className="text-sm">Please describe your gender identity</Label>
                <Input
                  value={formData.genderSelfDescription}
                  onChange={(e) => updateField("genderSelfDescription", e.target.value)}
                  placeholder="How do you describe your gender?"
                  data-testid="input-gender-self-description"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-sm">Ethnicity<RequiredStar /></Label>
              <GroupedEthnicitySelect
                value={formData.ethnicity}
                onValueChange={(v) => updateField("ethnicity", v)}
                testId="select-ethnicity"
              />
              <FieldError message={errors.ethnicity} />
            </div>

            {formData.ethnicity === "Self-disclose" && (
              <div className="space-y-1.5">
                <Label className="text-sm">Please describe your ethnicity</Label>
                <Input
                  value={formData.ethnicSelfDisclose}
                  onChange={(e) => updateField("ethnicSelfDisclose", e.target.value)}
                  placeholder="How do you describe your ethnicity?"
                  data-testid="input-ethnic-self-disclose"
                />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-sm">Country of Birth</Label>
                <Select value={formData.countryOfBirth} onValueChange={(v) => updateField("countryOfBirth", v)}>
                  <SelectTrigger data-testid="select-country-of-birth">
                    <SelectValue placeholder="Select country" />
                  </SelectTrigger>
                  <SelectContent>
                    {COUNTRIES_OF_BIRTH.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {(formData.countryOfBirth === "EU country (specify)" || formData.countryOfBirth === "Other country (specify)") && (
                <div className="space-y-1.5">
                  <Label className="text-sm">Specify country</Label>
                  <Input
                    value={formData.countryOfBirthOther}
                    onChange={(e) => updateField("countryOfBirthOther", e.target.value)}
                    placeholder="Enter country of birth"
                    data-testid="input-country-other"
                  />
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-sm">First Language<RequiredStar /></Label>
                <Select value={formData.firstLanguage} onValueChange={(v) => updateField("firstLanguage", v)}>
                  <SelectTrigger data-testid="select-first-language" className={errors.firstLanguage ? "border-red-500" : ""}>
                    <SelectValue placeholder="Select language" />
                  </SelectTrigger>
                  <SelectContent>
                    {COMMON_LANGUAGES.map((l) => (
                      <SelectItem key={l} value={l}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError message={errors.firstLanguage} />
              </div>
              {formData.firstLanguage === "Other (specify below)" && (
                <div className="space-y-1.5">
                  <Label className="text-sm">Specify language</Label>
                  <Input
                    value={formData.firstLanguageOther}
                    onChange={(e) => updateField("firstLanguageOther", e.target.value)}
                    placeholder="Enter first language"
                    data-testid="input-language-other"
                  />
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm">Interpreter or language support needed?<RequiredStar /></Label>
              <Select value={formData.interpreterNeeded} onValueChange={(v) => updateField("interpreterNeeded", v)}>
                <SelectTrigger data-testid="select-interpreter" className={errors.interpreterNeeded ? "border-red-500" : ""}>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {INTERPRETER_SUPPORT_OPTIONS.map((o) => (
                    <SelectItem key={o} value={o}>{o}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError message={errors.interpreterNeeded} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base font-heading">Health & Additional Needs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-sm">Disability / health condition(s)</Label>
              <p className="text-xs text-muted-foreground mb-2">Tick all that apply</p>
              <MultiSelectCheckboxes
                options={DISABILITY_OPTIONS}
                selected={formData.disabilityOrHealthConditions}
                onChange={(v) => updateField("disabilityOrHealthConditions", v)}
                testId="checkbox-disability"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm">Additional needs / reasonable adjustments</Label>
              <Textarea
                value={formData.additionalNeeds}
                onChange={(e) => updateField("additionalNeeds", e.target.value.slice(0, 500))}
                placeholder="Is there anything we should know to help make the process easier for you?"
                className="min-h-[60px]"
                maxLength={500}
                data-testid="textarea-additional-needs"
              />
              <p className="text-xs text-muted-foreground">{formData.additionalNeeds.length}/500 characters</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base font-heading">Employment & Financial</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-sm">Employment Status<RequiredStar /></Label>
              <Select value={formData.employmentStatus} onValueChange={(v) => updateField("employmentStatus", v)}>
                <SelectTrigger data-testid="select-employment" className={errors.employmentStatus ? "border-red-500" : ""}>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  {EMPLOYMENT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError message={errors.employmentStatus} />
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm">Legal aid eligible?<RequiredStar /></Label>
              <Select value={formData.legalAidEligible} onValueChange={(v) => updateField("legalAidEligible", v)}>
                <SelectTrigger data-testid="select-legal-aid" className={errors.legalAidEligible ? "border-red-500" : ""}>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {LEGAL_AID_OPTIONS.map((o) => (
                    <SelectItem key={o} value={o}>{o}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError message={errors.legalAidEligible} />
              {formData.legalAidEligible === "Yes" && (
                <p className="text-xs text-amber-700 bg-amber-50 p-2 rounded mt-1">
                  Note: BFM does not offer legal aid funding. Check eligibility at{" "}
                  <a href="https://www.gov.uk/check-legal-aid" target="_blank" rel="noopener noreferrer" className="underline font-medium">
                    www.gov.uk/check-legal-aid
                  </a>
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm">Voucher scheme eligible?<RequiredStar /></Label>
              <Select value={formData.voucherSchemeEligible} onValueChange={(v) => updateField("voucherSchemeEligible", v)}>
                <SelectTrigger data-testid="select-voucher" className={errors.voucherSchemeEligible ? "border-red-500" : ""}>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {VOUCHER_SCHEME_OPTIONS.map((o) => (
                    <SelectItem key={o} value={o}>{o}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError message={errors.voucherSchemeEligible} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base font-heading">Legal & Court Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-sm">Currently in court proceedings?<RequiredStar /></Label>
              <Select value={formData.courtProceedingsStatus} onValueChange={(v) => updateField("courtProceedingsStatus", v)}>
                <SelectTrigger data-testid="select-court-proceedings" className={errors.courtProceedingsStatus ? "border-red-500" : ""}>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  {COURT_PROCEEDINGS_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError message={errors.courtProceedingsStatus} />
            </div>

            {(formData.courtProceedingsStatus === "Yes - active proceedings" ||
              formData.courtProceedingsStatus === "Yes - proceedings threatened or imminent") && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-sm">Court Reference Number</Label>
                  <Input
                    value={formData.courtReference}
                    onChange={(e) => updateField("courtReference", e.target.value)}
                    placeholder="e.g. C100/2026/12345"
                    data-testid="input-court-reference"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm">Court Name and Location</Label>
                  <Input
                    value={formData.courtName}
                    onChange={(e) => updateField("courtName", e.target.value)}
                    placeholder="e.g. Bromley Family Court"
                    data-testid="input-court-name"
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-sm">CAFCASS involvement?<RequiredStar /></Label>
              <Select value={formData.cafcassInvolved} onValueChange={(v) => updateField("cafcassInvolved", v)}>
                <SelectTrigger data-testid="select-cafcass" className={errors.cafcassInvolved ? "border-red-500" : ""}>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {CAFCASS_OPTIONS.map((o) => (
                    <SelectItem key={o} value={o}>{o}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError message={errors.cafcassInvolved} />
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm">Solicitor acting for client?</Label>
              <Select value={formData.solicitorInvolved} onValueChange={(v) => updateField("solicitorInvolved", v)}>
                <SelectTrigger data-testid="select-solicitor">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {SOLICITOR_OPTIONS.map((o) => (
                    <SelectItem key={o} value={o}>{o}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {formData.solicitorInvolved === "Yes" && (
              <div className="space-y-1.5">
                <Label className="text-sm">Solicitor Name / Firm</Label>
                <Input
                  value={formData.solicitorName}
                  onChange={(e) => updateField("solicitorName", e.target.value)}
                  placeholder="Name of solicitor or firm"
                  data-testid="input-solicitor-name"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-sm">Ages of Children (if applicable)</Label>
              <Input
                value={formData.childrenAges}
                onChange={(e) => updateField("childrenAges", e.target.value)}
                placeholder="e.g. 4, 7, 12"
                data-testid="input-children-ages"
              />
              <p className="text-xs text-muted-foreground">Separate ages with commas</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base font-heading">Baseline Wellbeing</CardTitle>
            <p className="text-xs text-muted-foreground">
              These questions help us understand your current wellbeing. There are no right or wrong answers.
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-3">
              <div>
                <Label className="text-sm font-medium">Life Satisfaction<RequiredStar /></Label>
                <p className="text-xs text-muted-foreground mt-0.5">Overall, how satisfied are you with your life nowadays? (0 = not at all, 10 = completely)</p>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-xs text-muted-foreground w-4">0</span>
                <Slider
                  value={[formData.lifeSatisfaction ?? 5]}
                  onValueChange={([v]) => updateField("lifeSatisfaction", v)}
                  min={0}
                  max={10}
                  step={1}
                  className="flex-1"
                  data-testid="slider-life-satisfaction"
                />
                <span className="text-xs text-muted-foreground w-4">10</span>
                <span className="text-sm font-semibold w-8 text-center bg-muted rounded px-1 py-0.5">{formData.lifeSatisfaction ?? "—"}</span>
              </div>
              <FieldError message={errors.lifeSatisfaction} />
            </div>

            <div className="space-y-3">
              <div>
                <Label className="text-sm font-medium">Anxiety<RequiredStar /></Label>
                <p className="text-xs text-muted-foreground mt-0.5">Overall, how anxious did you feel yesterday? (0 = not at all, 10 = completely)</p>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-xs text-muted-foreground w-4">0</span>
                <Slider
                  value={[formData.anxietyScore ?? 5]}
                  onValueChange={([v]) => updateField("anxietyScore", v)}
                  min={0}
                  max={10}
                  step={1}
                  className="flex-1"
                  data-testid="slider-anxiety"
                />
                <span className="text-xs text-muted-foreground w-4">10</span>
                <span className="text-sm font-semibold w-8 text-center bg-muted rounded px-1 py-0.5">{formData.anxietyScore ?? "—"}</span>
              </div>
              <FieldError message={errors.anxietyScore} />
            </div>

            <div className="space-y-3">
              <div>
                <Label className="text-sm font-medium">Emotional Wellbeing<RequiredStar /></Label>
                <p className="text-xs text-muted-foreground mt-0.5">How would you rate your emotional wellbeing right now? (1 = very poor, 5 = very good)</p>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-xs text-muted-foreground w-12">1 Very poor</span>
                <Slider
                  value={[formData.emotionalWellbeing ?? 3]}
                  onValueChange={([v]) => updateField("emotionalWellbeing", v)}
                  min={1}
                  max={5}
                  step={1}
                  className="flex-1"
                  data-testid="slider-wellbeing"
                />
                <span className="text-xs text-muted-foreground w-12 text-right">5 Very good</span>
                <span className="text-sm font-semibold w-20 text-center bg-muted rounded px-1 py-0.5">
                  {formData.emotionalWellbeing ? `${formData.emotionalWellbeing} - ${EMOTIONAL_WELLBEING_LABELS[formData.emotionalWellbeing]}` : "—"}
                </span>
              </div>
              <FieldError message={errors.emotionalWellbeing} />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3 pb-8">
          <Button
            size="lg"
            className="bg-[#5a7d58] hover:bg-[#4a6c49] text-white px-8"
            onClick={handleSubmit}
            disabled={submitMutation.isPending}
            data-testid="button-submit-demographic-form"
          >
            {submitMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Submitting...
              </>
            ) : (
              "Submit Form"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
