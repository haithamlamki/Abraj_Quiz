import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { downloadFile } from "@/lib/download";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LabelList, ResponsiveContainer,
} from "recharts";
import { formatQuizDate } from "@/lib/language";

interface QuizInsights {
  gamesPlayed: number;
  totalPlayers: number;
  avgScore: number;
  lastPlayedAt: string | null;
  questions: Array<{ questionIndex: number; question: string; totalResponses: number; correctRate: number; avgResponseMs: number }>;
  recentGames: Array<{ id: number; gamePin: string; createdAt: string | null; playerCount: number; avgScore: number }>;
}

function StatTile({ testId, label, value }: { testId: string; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-6 text-center">
        <div className="text-3xl font-bold text-gray-900" data-testid={`stat-${testId}`}>{value}</div>
        <div className="text-sm text-gray-500 mt-1">{label}</div>
      </CardContent>
    </Card>
  );
}

export default function QuizInsightsPage() {
  const { t, i18n } = useTranslation();
  const [, params] = useRoute("/quiz-insights/:id");
  const quizId = params?.id;
  const { data, isLoading, isError, refetch } = useQuery<QuizInsights>({
    queryKey: [`/api/quizzes/${quizId}/insights`],
    enabled: !!quizId,
  });

  const { toast } = useToast();
  const lang = i18n.language.startsWith("ar") ? "ar" : "en";
  const download = async (path: string, filename: string) => {
    const ok = await downloadFile(`${path}?lang=${lang}`, filename);
    if (!ok) toast({ title: t("reports.failedTitle"), variant: "destructive" });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="flex items-center justify-center py-24 text-gray-500">{t("insights.loading")}</div>
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="min-h-screen bg-gray-50">
        <ErrorState description={t("insights.loadError")} onRetry={() => refetch()} />
      </div>
    );
  }

  const chartData = data.questions.map((q) => ({
    name: `${t("insights.questionAxisPrefix", { n: q.questionIndex + 1 })} ${q.question.length > 28 ? q.question.slice(0, 28) + "…" : q.question}`,
    fullQuestion: q.question,
    pct: Math.round(q.correctRate * 100),
    responses: q.totalResponses,
    avgSec: Math.round(q.avgResponseMs / 100) / 10,
  }));

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
        <div className="flex items-center gap-3">
          <Link href="/my-quizzes"><Button variant="ghost" size="sm" data-testid="button-back-insights"><ArrowLeft className="w-4 h-4 me-1 rtl:rotate-180" />{t("insights.myQuizzes")}</Button></Link>
          <h1 className="text-2xl font-bold">{t("insights.title")}</h1>
          <div className="ms-auto flex items-center gap-2">
            <span className="text-sm text-gray-500 hidden sm:inline">{t("reports.downloadTitle")}</span>
            <Button variant="outline" size="sm" data-testid="button-quiz-report-xlsx"
              onClick={() => download(`/api/quizzes/${quizId}/report.xlsx`, `quiz-${quizId}-report.xlsx`)}>
              <Download className="w-4 h-4 me-1" /> {t("reports.excel")}
            </Button>
            <Button variant="outline" size="sm" data-testid="button-quiz-report-csv"
              onClick={() => download(`/api/quizzes/${quizId}/report.csv`, `quiz-${quizId}-report.csv`)}>
              <Download className="w-4 h-4 me-1" /> {t("reports.csv")}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatTile testId="games-played" label={t("insights.gamesPlayed")} value={String(data.gamesPlayed)} />
          <StatTile testId="total-players" label={t("insights.totalPlayers")} value={String(data.totalPlayers)} />
          <StatTile testId="average-score" label={t("insights.averageScore")} value={String(Math.round(data.avgScore))} />
        </div>

        <Card>
          <CardHeader><CardTitle>{t("insights.chartTitle")}</CardTitle></CardHeader>
          <CardContent>
            {data.gamesPlayed === 0 || chartData.length === 0 ? (
              <EmptyState title={t("insights.noGamesYet")} />
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(160, chartData.length * 44)}>
                <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 40 }}>
                  <CartesianGrid stroke="#e5e7eb" horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} stroke="#6b7280" fontSize={12} />
                  <YAxis type="category" dataKey="name" width={230} stroke="#6b7280" fontSize={12} />
                  <Tooltip
                    formatter={(value: number) => [t("insights.percentCorrect", { value }), ""]}
                    labelFormatter={(_label: string, payload: any[]) => {
                      const p = payload?.[0]?.payload;
                      return p ? t("insights.tooltipLabel", { question: p.fullQuestion, responses: p.responses, avgSec: p.avgSec }) : "";
                    }}
                  />
                  <Bar dataKey="pct" fill="#019ebd" barSize={18} radius={[0, 4, 4, 0]}>
                    <LabelList dataKey="pct" position="right" formatter={(v: number) => `${v}%`} className="fill-gray-700" fontSize={12} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t("insights.recentGames")}</CardTitle></CardHeader>
          <CardContent>
            {data.recentGames.length === 0 ? (
              <p className="text-gray-500 py-4 text-center">{t("insights.noRecentGames")}</p>
            ) : (
              <table className="w-full text-sm" data-testid="table-recent-games">
                <thead>
                  <tr className="text-start text-gray-500 border-b">
                    <th className="py-2 pe-4">{t("insights.pin")}</th>
                    <th className="py-2 pe-4">{t("insights.date")}</th>
                    <th className="py-2 pe-4">{t("insights.players")}</th>
                    <th className="py-2 pe-4">{t("insights.avgScore")}</th>
                    <th className="py-2 text-end">{t("reports.downloadTitle")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentGames.map((g) => (
                    <tr key={g.id} className="border-b last:border-0">
                      <td className="py-2 pe-4 font-mono">{g.gamePin}</td>
                      <td className="py-2 pe-4">{g.createdAt ? formatQuizDate(g.createdAt, i18n.language) : "—"}</td>
                      <td className="py-2 pe-4">{g.playerCount}</td>
                      <td className="py-2 pe-4">{Math.round(g.avgScore)}</td>
                      <td className="py-2 text-end whitespace-nowrap">
                        <Button variant="ghost" size="sm" className="h-7 px-2" data-testid={`button-game-report-xlsx-${g.id}`}
                          onClick={() => download(`/api/games/${g.gamePin}/report.xlsx`, `game-${g.gamePin}-report.xlsx`)}>
                          {t("reports.excel")}
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 px-2" data-testid={`button-game-report-csv-${g.id}`}
                          onClick={() => download(`/api/games/${g.gamePin}/report.csv`, `game-${g.gamePin}-report.csv`)}>
                          {t("reports.csv")}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
