import { lazy, Suspense } from "react";
import { Switch, Route } from "wouter";
import * as Sentry from "@sentry/react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TenantProvider } from "@/lib/tenant";
import Navigation from "@/components/navigation";
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
const HostQuizSetup = lazy(() => import("./pages/host-quiz-setup"));
const QuizPDF = lazy(() => import("@/pages/quiz-pdf"));
const QuizInsights = lazy(() => import("@/pages/quiz-insights"));
const AdminTenants = lazy(() => import("@/pages/admin-tenants"));
const NotFound = lazy(() => import("@/pages/not-found"));

function LoadingFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-abraj-primary mx-auto mb-4"></div>
        <p className="text-lg text-gray-600">Loading...</p>
      </div>
    </div>
  );
}

function Router() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/login" component={Login} />
        <Route path="/signup" component={Signup} />
        <Route path="/create" component={QuizEditor} />
        <Route path="/my-quizzes" component={QuizHistory} />
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

function App() {
  return (
    <QueryClientProvider client={queryClient}>
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
              <Navigation />
              {/*
                Root error boundary: outside Suspense (so a render error inside
                a lazy-loaded route doesn't unmount the boundary that's meant to
                catch it) but inside all providers (so it can still use them if
                needed). The fallback strings are deliberately hardcoded English,
                not run through i18next's t() -- if the crash originates in the
                i18n layer itself, a translated fallback could throw again and
                leave the user with a blank screen instead of a reload button.
              */}
              <Sentry.ErrorBoundary
                fallback={
                  <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
                    <p className="text-lg text-gray-700">Something went wrong.</p>
                    <button
                      onClick={() => window.location.reload()}
                      className="px-4 py-2 rounded bg-[#019ebd] text-white font-medium"
                      data-testid="button-error-reload"
                    >
                      Reload
                    </button>
                  </div>
                }
              >
                <Router />
              </Sentry.ErrorBoundary>
            </div>
            <Toaster />
          </div>
        </TooltipProvider>
      </TenantProvider>
    </QueryClientProvider>
  );
}

export default App;
