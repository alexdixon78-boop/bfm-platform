import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3, Briefcase, CalendarClock, Clock, PoundSterling } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

type AdminReportSummary = {
  range: { from: string; to: string };
  totalCases: number;
  totalSessions: number;
  upcomingSessionsCount: number;
  casesByStage: Array<{ stage: string; count: number }>;
  closureReasons: Array<{ reason: string; count: number }>;
  sessionStatuses: Array<{ status: string; count: number }>;
  sessionOutcomes: Array<{ outcome: string; count: number }>;
  postSessionReviews: Array<{ status: string; count: number }>;
  upcomingSessions: Array<{ id: string; dateTime: string; type: string; mediator: string; clientNames: string; status: string }>;
  revenue?: {
    totalRevenuePence: number;
    monthlyRevenue: Array<{ month: string; revenuePence: number }>;
  };
};

const COLORS = ["#5a7d58", "#b8825a", "#6b7280", "#a7baa4", "#dcae96", "#374151"];

function isoDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function defaultFromDate(): string {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 1);
  return isoDateInput(date);
}

function formatPence(amountPence?: number | null): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format((amountPence ?? 0) / 100);
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function MetricCard({ title, value, icon: Icon, loading }: { title: string; value: string | number; icon: typeof Briefcase; loading?: boolean }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            {loading ? <Skeleton className="mt-2 h-8 w-20" /> : <p className="mt-1 text-3xl font-bold text-foreground">{value}</p>}
          </div>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#a7baa4]/15">
            <Icon className="h-5 w-5 text-[#5a7d58]" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyChart() {
  return (
    <div className="flex h-[260px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
      No report data for this date range
    </div>
  );
}

export default function ReportsPage() {
  const { user } = useAuth();
  const isSuperadmin = user?.role === "superadmin";
  const [from, setFrom] = useState(defaultFromDate);
  const [to, setTo] = useState(() => isoDateInput(new Date()));
  const queryString = useMemo(() => new URLSearchParams({ from, to }).toString(), [from, to]);

  const { data, isLoading } = useQuery<AdminReportSummary>({
    queryKey: ["/api/reports/admin-summary", from, to],
    queryFn: async () => {
      const res = await fetch(`/api/reports/admin-summary?${queryString}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load reports");
      return res.json();
    },
  });

  const revenueData = data?.revenue?.monthlyRevenue.map((row) => ({
    month: row.month,
    revenue: row.revenuePence / 100,
  })) ?? [];

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6 lg:p-8" data-testid="reports-page">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-heading font-semibold text-foreground">
            <BarChart3 className="h-6 w-6 text-[#5a7d58]" />
            Admin reports
          </h1>
          <p className="mt-1 text-muted-foreground">Case, session, closure, and performance reporting.</p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:w-[360px]">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">From</label>
            <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} data-testid="input-reports-from" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">To</label>
            <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} data-testid="input-reports-to" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard title="Total cases" value={data?.totalCases ?? 0} icon={Briefcase} loading={isLoading} />
        <MetricCard title="Total sessions" value={data?.totalSessions ?? 0} icon={Clock} loading={isLoading} />
        <MetricCard title="Upcoming sessions" value={data?.upcomingSessionsCount ?? 0} icon={CalendarClock} loading={isLoading} />
        {isSuperadmin && <MetricCard title="Paid invoice revenue" value={formatPence(data?.revenue?.totalRevenuePence)} icon={PoundSterling} loading={isLoading} />}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Cases by stage</CardTitle>
            <CardDescription>Open and closed cases grouped by their current stage.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-[260px] w-full" /> : data?.casesByStage.length ? (
              <ChartContainer config={{ count: { label: "Cases", color: "#5a7d58" } }} className="h-[260px] w-full">
                <BarChart data={data.casesByStage} layout="vertical" margin={{ left: 20, right: 20 }}>
                  <CartesianGrid horizontal={false} />
                  <XAxis type="number" allowDecimals={false} />
                  <YAxis dataKey="stage" type="category" width={130} tickLine={false} axisLine={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="count" fill="var(--color-count)" radius={4} />
                </BarChart>
              </ChartContainer>
            ) : <EmptyChart />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Closure reasons</CardTitle>
            <CardDescription>Closed cases grouped by reason code.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-[260px] w-full" /> : data?.closureReasons.length ? (
              <div className="grid gap-4 md:grid-cols-[1fr_220px]">
                <ChartContainer config={{ count: { label: "Closures" } }} className="h-[260px] w-full">
                  <PieChart>
                    <Pie data={data.closureReasons} dataKey="count" nameKey="reason" innerRadius={54} outerRadius={92} paddingAngle={2}>
                      {data.closureReasons.map((entry, index) => (
                        <Cell key={entry.reason} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <ChartTooltip content={<ChartTooltipContent nameKey="reason" />} />
                  </PieChart>
                </ChartContainer>
                <div className="space-y-2">
                  {data.closureReasons.map((row, index) => (
                    <div key={row.reason} className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate">
                        <span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                        {row.reason}
                      </span>
                      <Badge variant="secondary">{row.count}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            ) : <EmptyChart />}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Session summaries</CardTitle>
            <CardDescription>Status, outcome, and post-session review counts.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {isLoading ? <Skeleton className="h-[260px] w-full" /> : (
              <>
                <ChartContainer config={{ count: { label: "Sessions", color: "#b8825a" } }} className="h-[220px] w-full">
                  <BarChart data={data?.sessionStatuses ?? []}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="status" tickLine={false} axisLine={false} />
                    <YAxis allowDecimals={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="count" fill="var(--color-count)" radius={4} />
                  </BarChart>
                </ChartContainer>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-md border p-3">
                    <p className="text-sm font-medium">Outcomes</p>
                    <div className="mt-2 space-y-1.5">
                      {(data?.sessionOutcomes ?? []).map((row) => <p key={row.outcome} className="flex justify-between text-sm"><span>{row.outcome}</span><span>{row.count}</span></p>)}
                    </div>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-sm font-medium">Review status</p>
                    <div className="mt-2 space-y-1.5">
                      {(data?.postSessionReviews ?? []).map((row) => <p key={row.status} className="flex justify-between text-sm"><span>{row.status}</span><span>{row.count}</span></p>)}
                    </div>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Upcoming sessions</CardTitle>
            <CardDescription>Future held or confirmed appointments.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-[260px] w-full" /> : data?.upcomingSessions.length ? (
              <div className="space-y-3">
                {data.upcomingSessions.map((session) => (
                  <div key={session.id} className="rounded-md border p-3" data-testid={`report-upcoming-session-${session.id}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{session.clientNames}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{session.type} · {session.mediator}</p>
                      </div>
                      <Badge variant="outline" className="capitalize">{session.status}</Badge>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{formatDateTime(session.dateTime)}</p>
                  </div>
                ))}
              </div>
            ) : <EmptyChart />}
          </CardContent>
        </Card>
      </div>

      {isSuperadmin && (
        <Card>
          <CardHeader>
            <CardTitle>Revenue trend</CardTitle>
            <CardDescription>Paid invoice revenue grouped by invoice update month.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-[260px] w-full" /> : revenueData.length ? (
              <ChartContainer config={{ revenue: { label: "Revenue", color: "#5a7d58" } }} className="h-[260px] w-full">
                <BarChart data={revenueData}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={(value) => `£${value}`} />
                  <ChartTooltip content={<ChartTooltipContent formatter={(value) => formatPence(Number(value) * 100)} />} />
                  <Bar dataKey="revenue" fill="var(--color-revenue)" radius={4} />
                </BarChart>
              </ChartContainer>
            ) : <EmptyChart />}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
