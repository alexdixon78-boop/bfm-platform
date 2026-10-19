import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  Mail,
  Phone,
  MapPin,
  UserRound,
  Briefcase,
  Building2,
  Pencil,
  Trash2,
  ExternalLink,
} from "lucide-react";
import { StatusBadge, getStatusStyle } from "@/components/shared/status-badge";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { LegacyCrmHistoryPanel } from "@/components/clients/legacy-crm-history-panel";
import { ClientRepresentativesPanel } from "@/pages/clients";

const PORTAL_STATUS_STYLES = {
  inactive: {
    dot: "bg-gray-400",
    badge:
      "bg-gray-100 text-gray-500 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700",
  },
  invited: {
    dot: "bg-[#b8825a]",
    badge: "bg-[#dcae96]/15 text-[#b8825a] border-[#dcae96]/30",
  },
  active: {
    dot: "bg-[#5a7d58]",
    badge: "bg-[#a7baa4]/15 text-[#5a7d58] border-[#a7baa4]/30",
  },
} as const;

export default function ClientDetailPage() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { canEdit } = usePermissions();
  const isSuperadmin = user?.role === "superadmin";

  const { data, isLoading, isError } = useQuery({
    queryKey: ["/api/clients", params.id],
    queryFn: async () => {
      const res = await fetch(`/api/clients/${params.id}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load client details");
      return res.json();
    },
    enabled: !!params.id,
  });

  const portalStyle = useMemo(() => {
    if (!data?.portalStatus) return PORTAL_STATUS_STYLES.inactive;
    return getStatusStyle(data.portalStatus, PORTAL_STATUS_STYLES);
  }, [data?.portalStatus]);

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="p-6">
        <Button
          variant="outline"
          onClick={() => navigate("/clients")}
          className="mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to clients
        </Button>
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Client details could not be loaded.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("/clients")}
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Client record
            </p>
            <h1 className="text-3xl font-heading font-semibold mt-1">
              {data.firstName} {data.lastName}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {canEdit("clients") && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/clients")}
            >
              <Pencil className="w-4 h-4 mr-2" />
              Edit
            </Button>
          )}
          {isSuperadmin && data.cases?.length === 0 && (
            <Button variant="destructive" size="sm" className="gap-2">
              <Trash2 className="w-4 h-4" />
              Delete
            </Button>
          )}
          <StatusBadge
            label={data.portalStatus}
            dotColor={portalStyle.dot}
            badgeClass={portalStyle.badge + " text-sm px-3 py-1"}
            testId="badge-client-detail-portal"
          />
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <UserRound className="w-4 h-4 text-[#b8825a]" />
                Personal details
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">First name</p>
                <p className="text-sm font-medium">{data.firstName}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Last name</p>
                <p className="text-sm font-medium">{data.lastName}</p>
              </div>
              {data.dateOfBirth && (
                <div className="sm:col-span-2">
                  <p className="text-xs text-muted-foreground">Date of birth</p>
                  <p className="text-sm">
                    {new Date(data.dateOfBirth).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </p>
                </div>
              )}
              {data.gender && (
                <div>
                  <p className="text-xs text-muted-foreground">Gender</p>
                  <p className="text-sm">{data.gender}</p>
                </div>
              )}
              {data.ethnicOrigin && (
                <div>
                  <p className="text-xs text-muted-foreground">Ethnic origin</p>
                  <p className="text-sm">{data.ethnicOrigin}</p>
                </div>
              )}
              {data.nationalInsuranceNumber && (
                <div className="sm:col-span-2">
                  <p className="text-xs text-muted-foreground">
                    National Insurance number
                  </p>
                  <p className="text-sm">{data.nationalInsuranceNumber}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="w-4 h-4 text-[#b8825a]" />
                Contact & address
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-muted-foreground">Email</p>
                  <div className="mt-1 flex items-center gap-2 text-sm">
                    <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                    {data.email || "—"}
                  </div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Phone</p>
                  <div className="mt-1 flex items-center gap-2 text-sm">
                    <Phone className="w-3.5 h-3.5 text-muted-foreground" />
                    {data.phone
                      ? `${data.phoneCode || "+44"} ${data.phone}`
                      : "—"}
                  </div>
                </div>
              </div>

              {(data.addressLine1 || data.city || data.postcode) && (
                <div>
                  <p className="text-xs text-muted-foreground">Address</p>
                  <div className="mt-1 flex items-start gap-2 text-sm">
                    <MapPin className="w-3.5 h-3.5 text-muted-foreground mt-0.5" />
                    <div>
                      {data.addressLine1 && <p>{data.addressLine1}</p>}
                      {data.addressLine2 && <p>{data.addressLine2}</p>}
                      {(data.city || data.postcode) && (
                        <p>
                          {[data.city, data.postcode]
                            .filter(Boolean)
                            .join(", ")}
                        </p>
                      )}
                      {data.country && data.country !== "United Kingdom" && (
                        <p>{data.country}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {(data.disabilityOrHealthCondition || data.additionalNeeds) && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Briefcase className="w-4 h-4 text-[#b8825a]" />
                  Additional information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {data.disabilityOrHealthCondition && (
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Disability / health condition
                    </p>
                    <p className="text-sm">
                      {data.disabilityOrHealthCondition}
                    </p>
                  </div>
                )}
                {data.additionalNeeds && (
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Additional needs
                    </p>
                    <p className="text-sm">{data.additionalNeeds}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <div className="space-y-6">
            <ClientRepresentativesPanel
              clientId={data.id}
              cases={data.cases ?? []}
            />
            <LegacyCrmHistoryPanel clientId={data.id} />
          </div>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Briefcase className="w-4 h-4 text-[#b8825a]" />
                Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Cases</span>
                <Badge variant="secondary">{data.cases?.length ?? 0}</Badge>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Portal status</span>
                <StatusBadge
                  label={data.portalStatus}
                  dotColor={portalStyle.dot}
                  badgeClass={portalStyle.badge}
                />
              </div>
              {data.userId && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Portal account</span>
                  <span className="font-medium">Linked</span>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Briefcase className="w-4 h-4 text-[#b8825a]" />
                Related cases
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!data.cases || data.cases.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No linked cases.
                </p>
              ) : (
                <div className="space-y-2">
                  {data.cases.map((caseItem) => (
                    <button
                      key={caseItem.caseId}
                      onClick={() => navigate(`/cases/${caseItem.caseId}`)}
                      className="w-full rounded-md border bg-muted/20 p-3 text-left hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-[#5a7d58]">
                          {caseItem.caseRef}
                        </span>
                        <Badge variant="outline" className="text-[10px]">
                          {caseItem.caseStatus}
                        </Badge>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span>{caseItem.role}</span>
                        <span className="inline-flex items-center gap-1">
                          {caseItem.mediatorName || "No mediator"}
                          <ExternalLink className="w-3 h-3" />
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
