import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LabelList, ResponsiveContainer,
} from "recharts";

interface QuizInsights {
  gamesPlayed: number;
  totalPlayers: number;
  avgScore: number;
  lastPlayedAt: string | null;
  questions: Array<{ questionIndex: number; question: string; totalResponses: number; correctRate: number; avgResponseMs: number }>;
  recentGames: Array<{ id: number; gamePin: string; createdAt: string | null; playerCount: number; avgScore: number }>;
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-6 text-center">
        <div className="text-3xl font-bold text-gray-900" data-testid={`stat-${label.toLowerCase().replace(/\s/g, "-")}`}>{value}</div>
        <div className="text-sm text-gray-500 mt-1">{label}</div>
      </CardContent>
    </Card>
  );
}

export default function QuizInsightsPage() {
  const [, params] = useRoute("/quiz-insights/:id");
  const quizId = params?.id;
  const { data, isLoading, isError } = useQuery<QuizInsights>({
    queryKey: [`/api/quizzes/${quizId}/insights`],
    enabled: !!quizId,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="flex items-center justify-center py-24 text-gray-500">Loading insights…</div>
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <p className="text-gray-600">Couldn't load insights for this quiz.</p>
          <Link href="/my-quizzes"><Button variant="outline"><ArrowLeft className="w-4 h-4 mr-1" />Back to My Quizzes</Button></Link>
        </div>
      </div>
    );
  }

  const chartData = data.questions.map((q) => ({
    name: `Q${q.questionIndex + 1}. ${q.question.length > 28 ? q.question.slice(0, 28) + "…" : q.question}`,
    fullQuestion: q.question,
    pct: Math.round(q.correctRate * 100),
    responses: q.totalResponses,
    avgSec: Math.round(q.avgResponseMs / 100) / 10,
  }));

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
        <div className="flex items-center gap-3">
          <Link href="/my-quizzes"><Button variant="ghost" size="sm" data-testid="button-back-insights"><ArrowLeft className="w-4 h-4 mr-1" />My Quizzes</Button></Link>
          <h1 className="text-2xl font-bold">Quiz Insights</h1>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatTile label="Games played" value={String(data.gamesPlayed)} />
          <StatTile label="Total players" value={String(data.totalPlayers)} />
          <StatTile label="Average score" value={String(Math.round(data.avgScore))} />
        </div>

        <Card>
          <CardHeader><CardTitle>Correct answers by question</CardTitle></CardHeader>
          <CardContent>
            {data.gamesPlayed === 0 || chartData.length === 0 ? (
              <p className="text-gray-500 py-8 text-center">No completed games yet — host this quiz to start collecting insights.</p>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(160, chartData.length * 44)}>
                <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 40 }}>
                  <CartesianGrid stroke="#e5e7eb" horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} stroke="#6b7280" fontSize={12} />
                  <YAxis type="category" dataKey="name" width={230} stroke="#6b7280" fontSize={12} />
                  <Tooltip
                    formatter={(value: number) => [`${value}% correct`, ""]}
                    labelFormatter={(_label: string, payload: any[]) => {
                      const p = payload?.[0]?.payload;
                      return p ? `${p.fullQuestion} — ${p.responses} responses, avg ${p.avgSec}s` : "";
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
          <CardHeader><CardTitle>Recent games</CardTitle></CardHeader>
          <CardContent>
            {data.recentGames.length === 0 ? (
              <p className="text-gray-500 py-4 text-center">No completed games yet.</p>
            ) : (
              <table className="w-full text-sm" data-testid="table-recent-games">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="py-2 pr-4">PIN</th>
                    <th className="py-2 pr-4">Date</th>
                    <th className="py-2 pr-4">Players</th>
                    <th className="py-2">Avg score</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentGames.map((g) => (
                    <tr key={g.id} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-mono">{g.gamePin}</td>
                      <td className="py-2 pr-4">{g.createdAt ? new Date(g.createdAt).toLocaleString() : "—"}</td>
                      <td className="py-2 pr-4">{g.playerCount}</td>
                      <td className="py-2">{Math.round(g.avgScore)}</td>
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
