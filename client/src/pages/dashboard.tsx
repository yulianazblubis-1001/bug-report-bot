import { useQuery } from "@tanstack/react-query";
import type { BotStatus, ReportLog } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Activity,
  Bug,
  CheckCircle2,
  Clock,
  MessageSquare,
  Shield,
  Smartphone,
  Users,
  Zap,
  ExternalLink,
  ArrowRight,
  AlertTriangle,
  Settings,
  Hash,
  Globe,
  Key,
  FileText,
} from "lucide-react";
import { SiSlack, SiWhatsapp } from "react-icons/si";
import { Link } from "wouter";

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatTimestamp(ts: string): string {
  const date = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMs / 3600000);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHrs < 24) return `${diffHrs}h ago`;

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusIndicator({ active }: { active: boolean }) {
  return (
    <span
      data-testid={`status-indicator-${active ? "active" : "inactive"}`}
      className={`inline-block w-2 h-2 rounded-full ${
        active
          ? "bg-emerald-500 dark:bg-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.4)]"
          : "bg-red-400 dark:bg-red-500"
      }`}
    />
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof Bug;
  label: string;
  value: string | number;
  accent?: string;
}) {
  return (
    <Card className="relative overflow-visible">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {label}
            </p>
            <p className="text-2xl font-semibold tracking-tight" data-testid={`stat-${label.toLowerCase().replace(/\s/g, "-")}`}>
              {value}
            </p>
          </div>
          <div
            className={`p-2.5 rounded-md ${
              accent || "bg-muted/60"
            }`}
          >
            <Icon className="w-4 h-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ConfigRow({
  label,
  configured,
  icon: Icon,
}: {
  label: string;
  configured: boolean;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex items-center justify-between py-2.5" data-testid={`config-${label.toLowerCase().replace(/\s/g, "-")}`}>
      <div className="flex items-center gap-2.5">
        <Icon className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm">{label}</span>
      </div>
      <Badge variant={configured ? "default" : "destructive"} className="text-xs">
        {configured ? "Connected" : "Missing"}
      </Badge>
    </div>
  );
}

function FlowStep({ step, index }: { step: string; index: number }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium mt-0.5">
        {index + 1}
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">{step}</p>
    </div>
  );
}

export default function Dashboard() {
  const { data: status, isLoading: statusLoading } = useQuery<BotStatus>({
    queryKey: ["/api/bot/status"],
    refetchInterval: 10000,
    staleTime: 5000,
  });

  const { data: logs, isLoading: logsLoading } = useQuery<ReportLog[]>({
    queryKey: ["/api/bot/logs"],
    refetchInterval: 10000,
    staleTime: 5000,
  });

  const conversationSteps = [
    "Agronomist types START to begin",
    "Selects Bug Report (1) or Admin Request (2)",
    "Describes the issue in their own words (Indonesian)",
    "Claude AI evaluates and asks smart follow-ups (max 3)",
    "Bot shows summary for confirmation",
    "KIRIM to submit — report posted to Slack in English",
  ];

  const commands = [
    { cmd: "START / HI / HALO", desc: "Begin a new report" },
    { cmd: "1", desc: "Select Bug Report" },
    { cmd: "2", desc: "Select Admin Request" },
    { cmd: "KIRIM / SUBMIT", desc: "Submit the report" },
    { cmd: "ULANG / RESTART", desc: "Start over" },
    { cmd: "CANCEL / BATAL", desc: "Cancel everything" },
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-md bg-primary flex items-center justify-center">
              <Zap className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight" data-testid="text-app-title">
                Rize Report Bot
              </h1>
              <p className="text-xs text-muted-foreground">
                WhatsApp to Slack Reporter
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/credit-limit">
              <button className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-xs font-medium hover:bg-primary/90 transition-colors">
                <FileText className="w-3.5 h-3.5" />
                Credit Limit Form
              </button>
            </Link>
            {statusLoading ? (
              <Badge variant="secondary" className="text-xs">Loading...</Badge>
            ) : status?.status === "ready" ? (
              <Badge variant="default" className="text-xs gap-1.5" data-testid="status-badge">
                <StatusIndicator active />
                All Systems Ready
              </Badge>
            ) : (
              <Badge variant="destructive" className="text-xs gap-1.5" data-testid="status-badge">
                <AlertTriangle className="w-3 h-3" />
                Configuration Needed
              </Badge>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            icon={Activity}
            label="Total Reports"
            value={status?.stats.total ?? 0}
            accent="bg-primary/10 text-primary"
          />
          <StatCard
            icon={Bug}
            label="Bug Reports"
            value={status?.stats.bugs ?? 0}
            accent="bg-red-500/10 text-red-500 dark:bg-red-400/10 dark:text-red-400"
          />
          <StatCard
            icon={Settings}
            label="Admin Requests"
            value={status?.stats.admins ?? 0}
            accent="bg-amber-500/10 text-amber-600 dark:bg-amber-400/10 dark:text-amber-400"
          />
          <StatCard
            icon={Clock}
            label="Uptime"
            value={status ? formatUptime(status.uptime) : "—"}
            accent="bg-blue-500/10 text-blue-600 dark:bg-blue-400/10 dark:text-blue-400"
          />
        </div>

        <div className="grid lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            <Tabs defaultValue="activity" className="w-full">
              <TabsList className="w-full grid grid-cols-3" data-testid="tabs-main">
                <TabsTrigger value="activity" data-testid="tab-activity">Activity</TabsTrigger>
                <TabsTrigger value="flows" data-testid="tab-flows">Flows</TabsTrigger>
                <TabsTrigger value="setup" data-testid="tab-setup">Setup Guide</TabsTrigger>
              </TabsList>

              <TabsContent value="activity" className="mt-3">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <MessageSquare className="w-4 h-4" />
                      Recent Reports
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    {logsLoading ? (
                      <div className="p-8 text-center">
                        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
                        <p className="text-sm text-muted-foreground mt-3">Loading activity...</p>
                      </div>
                    ) : !logs || logs.length === 0 ? (
                      <div className="p-8 text-center" data-testid="empty-activity">
                        <div className="w-12 h-12 rounded-full bg-muted/60 flex items-center justify-center mx-auto mb-3">
                          <MessageSquare className="w-5 h-5 text-muted-foreground" />
                        </div>
                        <p className="text-sm font-medium">No reports yet</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Reports will appear here when agronomists send messages via WhatsApp
                        </p>
                      </div>
                    ) : (
                      <ScrollArea className="max-h-[400px]">
                        <div className="divide-y">
                          {logs.map((log) => (
                            <div
                              key={log.id}
                              className="flex items-start gap-3 px-5 py-3.5"
                              data-testid={`log-entry-${log.id}`}
                            >
                              <div
                                className={`flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center mt-0.5 ${
                                  log.type === "bug"
                                    ? "bg-red-500/10 text-red-500 dark:bg-red-400/10 dark:text-red-400"
                                    : "bg-amber-500/10 text-amber-600 dark:bg-amber-400/10 dark:text-amber-400"
                                }`}
                              >
                                {log.type === "bug" ? (
                                  <Bug className="w-3.5 h-3.5" />
                                ) : (
                                  <Settings className="w-3.5 h-3.5" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-medium truncate">{log.reporter}</span>
                                  <Badge variant="secondary" className="text-[10px]">
                                    {log.type === "bug" ? "Bug" : "Admin"}
                                  </Badge>
                                </div>
                                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                                  {log.summary}
                                </p>
                              </div>
                              <span className="text-[10px] text-muted-foreground whitespace-nowrap flex-shrink-0 mt-0.5">
                                {formatTimestamp(log.timestamp)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="flows" className="mt-3 space-y-3">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-primary" />
                      Conversational Flow
                      <Badge variant="secondary" className="text-[10px] ml-auto">AI-Powered</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="space-y-0.5">
                      {conversationSteps.map((step, i) => (
                        <FlowStep key={i} step={step} index={i} />
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Hash className="w-4 h-4" />
                      Bot Commands
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="space-y-2">
                      {commands.map((c) => (
                        <div key={c.cmd} className="flex items-center gap-3 py-1">
                          <code className="text-xs bg-muted px-2 py-1 rounded font-mono whitespace-nowrap">
                            {c.cmd}
                          </code>
                          <ArrowRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                          <span className="text-sm text-muted-foreground">{c.desc}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="setup" className="mt-3">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <ExternalLink className="w-4 h-4" />
                      Webhook Configuration
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        WATI Webhook
                      </h4>
                      <div className="bg-muted/50 rounded-md p-3">
                        <code className="text-xs font-mono break-all" data-testid="text-wati-webhook-url">
                          {typeof window !== "undefined"
                            ? `${window.location.origin}/webhook`
                            : "/webhook"}
                        </code>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Go to WATI Dashboard, then Webhooks, and set this URL. Enable message events.
                      </p>
                    </div>

                    <Separator />

                    <div className="space-y-2">
                      <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Slack Events
                      </h4>
                      <div className="bg-muted/50 rounded-md p-3">
                        <code className="text-xs font-mono break-all" data-testid="text-slack-events-url">
                          {typeof window !== "undefined"
                            ? `${window.location.origin}/slack-events`
                            : "/slack-events"}
                        </code>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Go to api.slack.com/apps, then Event Subscriptions. Set this as the Request URL.
                        Subscribe to <code className="text-xs">reaction_added</code> events.
                      </p>
                    </div>

                    <Separator />

                    <div className="space-y-3">
                      <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        How It Works
                      </h4>
                      <div className="flex flex-col gap-2">
                        {([
                          { icon: SiWhatsapp as React.ComponentType<{className?: string}>, text: "Agronomist sends message via WhatsApp" },
                          { icon: MessageSquare as React.ComponentType<{className?: string}>, text: "Claude AI guides conversation naturally" },
                          { icon: CheckCircle2 as React.ComponentType<{className?: string}>, text: "Asks smart follow-ups (max 3) in Indonesian" },
                          { icon: Globe as React.ComponentType<{className?: string}>, text: "Translates and structures report in English" },
                          { icon: SiSlack as React.ComponentType<{className?: string}>, text: "Posts enriched card to Slack with profile" },
                          { icon: Smartphone as React.ComponentType<{className?: string}>, text: "Slack reaction notifies user on WhatsApp" },
                        ]).map((item, i) => (
                          <div key={i} className="flex items-center gap-3 py-1.5">
                            <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                              <item.icon className="w-3.5 h-3.5 text-primary" />
                            </div>
                            <span className="text-sm text-muted-foreground">{item.text}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Shield className="w-4 h-4" />
                  Service Status
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {statusLoading ? (
                  <div className="py-6 text-center">
                    <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
                  </div>
                ) : (
                  <div className="divide-y">
                    <ConfigRow
                      label="WATI API"
                      configured={status?.config.wati ?? false}
                      icon={SiWhatsapp}
                    />
                    <ConfigRow
                      label="Slack (Bugs)"
                      configured={status?.config.slackBug ?? false}
                      icon={SiSlack}
                    />
                    <ConfigRow
                      label="Slack (Admin)"
                      configured={status?.config.slackAdmin ?? false}
                      icon={SiSlack}
                    />
                    <ConfigRow
                      label="Claude AI"
                      configured={status?.config.anthropic ?? false}
                      icon={Globe}
                    />
                    <ConfigRow
                      label="Slack Signing"
                      configured={status?.config.slackSigning ?? false}
                      icon={Key}
                    />
                    <div className="flex items-center justify-between py-2.5">
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm" data-testid="text-whitelist-label">Whitelist</span>
                      </div>
                      <Badge
                        variant={status?.whitelist?.enabled ? "default" : "secondary"}
                        className="text-xs"
                        data-testid="badge-whitelist-status"
                      >
                        {status?.whitelist?.enabled
                          ? `${status.whitelist.count} numbers`
                          : "Open (all allowed)"}
                      </Badge>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Activity className="w-4 h-4" />
                  Bot Info
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Active Sessions</span>
                  <span className="text-sm font-medium" data-testid="text-active-sessions">
                    {status?.activeSessions ?? 0}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Session Timeout</span>
                  <span className="text-sm font-medium">30 min</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Reports Today</span>
                  <span className="text-sm font-medium" data-testid="text-today-reports">
                    {status?.stats.today ?? 0}
                  </span>
                </div>
                <Separator />
                <div className="space-y-1.5">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                    Architecture
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {[
                      "Claude AI conversational agent",
                      "Smart follow-ups (max 3 questions)",
                      "Auto-translation to English",
                      "70 agronomist profiles loaded",
                    ].map((f) => (
                      <div key={f} className="flex items-center gap-2">
                        <CheckCircle2 className="w-3 h-3 text-primary flex-shrink-0" />
                        <span className="text-xs text-muted-foreground">{f}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
