import { lazy, Suspense, useState } from "react";
import { Switch, Route } from "wouter";
import * as Sentry from "@sentry/react";
import { useTranslation } from "react-i18next";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TenantProvider } from "@/lib/tenant";
import { ThemeProvider } from "@/components/theme-provider";
import Navigation from "@/components/navigation";
import { PageLoader } from "@/components/page-loader";
import { isChunkLoadError, reloadOnceForStaleChunk } from "@/lib/chunk-reload";
import classroomBg from "@assets/classroom-background.jpg";

const Home = lazy(() => import("@/pages/home"));
const QuizEditor = lazy(() => import("@/pages/quiz-editor"));
const QuizPreview = lazy(() => import("@/pages/quiz-preview"));
const HostGame = lazy(() => import("@/pages/host-game"));
const JoinGame = lazy(() => import("@/pages/join-game"));
const PlayGame = lazy(() => import("@/pages/play-game"));
const GameResults = lazy(() => import("@/pages/game-results"));
const Login = lazy(() => import("@/pages/login"));
const Signup = lazy(() => import("@/pages/signup"));
const QuizHistory = lazy(() => import("@/pages/quiz-history"));
const QuestionBank = lazy(() => import("@/pages/question-bank"));
const HostQuizSetup = lazy(() => import("./pages/host-quiz-setup"));
const QuizPDF = lazy(() => import("@/pages/quiz-pdf"));
const QuizInsights = lazy(() => import("@/pages/quiz-insights"));
const AdminTenants = lazy(() => import("@/pages/admin-tenants"));
const NotFound = lazy(() => import("@/pages/not-found"));

function Router() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/login" component={Login} />
        <Route path="/signup" component={Signup} />
        <Route path="/create" component={QuizEditor} />
        <Route path="/my-quizzes" component={QuizHistory} />
        <Route path="/question-bank" component={QuestionBank} />
        <Route path="/quiz-insights/:id" component={QuizInsights} />
        <Route path="/host/:pin" component={HostGame} />
        <Route path="/host-quiz/:quizId" component={HostQuizSetup} />
        <Route path="/edit-quiz/:quizId" component={QuizEditor} />
        <Route path="/preview/:quizId" component={QuizPreview} />
        <Route path="/quiz-pdf/:id" component={QuizPDF} />
        <Route path="/join/:pin?" component={JoinGame} />
        <Route path="/play/:pin" component={PlayGame} />
        <Route path="/results/:pin" component={GameResults} />
        <Route path="/admin/tenants" component={AdminTenants} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

// Fallback strings are deliberately hardcoded English, not run through
// i18next's t() — if the crash originates in the i18n layer itself, a
// translated fallback could throw again and leave a blank screen.
function AppErrorFallback({ error }: { error: unknown }) {
  // Stale-deploy chunk failures thrown from React.lazy land here instead of
  // vite:preloadError (Sentry ABRAJ-QUIZ-CLIENT-C/D/E). Self-heal with the
  // same guarded one-shot reload; the lazy useState initializer runs the
  // side effect exactly once per fallback mount. When the reload was already
  // spent (guard window), fall through to the manual Reload button.
  const [reloading] = useState(
    () => isChunkLoadError(error) && reloadOnceForStaleChunk(),
  );
  if (reloading) {
    return (
      <div className="page-fill flex items-center justify-center p-6">
        <p className="text-lg text-gray-700">Updating…</p>
      </div>
    );
  }
  return (
    <div className="page-fill flex flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-lg text-gray-700">Something went wrong.</p>
      <button
        onClick={() => window.location.reload()}
        className="px-4 py-2 rounded bg-primary text-primary-foreground font-medium"
        data-testid="button-error-reload"
      >
        Reload
      </button>
    </div>
  );
}

function App() {
  const { t } = useTranslation();
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TenantProvider>
          <TooltipProvider>
          <div className="min-h-screen relative">
            {/* Classroom background */}
            <div
              className="classroom-background"
              style={{ backgroundImage: `url(${classroomBg})` }}
            />

            {/* Content */}
            <div className="relative z-10">
              <a
                href="#main-content"
                className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:start-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
              >
                {t("common.skipToContent")}
              </a>
              <Navigation />
              {/*
                Root error boundary: outside Suspense (so a render error inside
                a lazy-loaded route doesn't unmount the boundary that's meant to
                catch it) but inside all providers (so it can still use them if
                needed). See AppErrorFallback for the hardcoded-English rule and
                the stale-chunk self-heal.
              */}
              <Sentry.ErrorBoundary
                fallback={({ error }) => <AppErrorFallback error={error} />}
              >
                <main id="main-content">
                  <Router />
                </main>
              </Sentry.ErrorBoundary>
            </div>
            <Toaster />
          </div>
        </TooltipProvider>
      </TenantProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
