import { lazy, Suspense } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TenantProvider } from "@/lib/tenant";
import Navigation from "@/components/navigation";
import classroomBg from "@assets/classroom-background.jpg";

const Home = lazy(() => import("@/pages/home"));
const CreateQuiz = lazy(() => import("@/pages/create-quiz"));
const HostGame = lazy(() => import("@/pages/host-game"));
const JoinGame = lazy(() => import("@/pages/join-game"));
const PlayGame = lazy(() => import("@/pages/play-game"));
const GameResults = lazy(() => import("@/pages/game-results"));
const Login = lazy(() => import("@/pages/login"));
const Signup = lazy(() => import("@/pages/signup"));
const QuizHistory = lazy(() => import("@/pages/quiz-history"));
const HostQuizSetup = lazy(() => import("./pages/host-quiz-setup"));
const EditQuiz = lazy(() => import("@/pages/edit-quiz"));
const QuizPDF = lazy(() => import("@/pages/quiz-pdf"));
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
        <Route path="/create" component={CreateQuiz} />
        <Route path="/my-quizzes" component={QuizHistory} />
        <Route path="/host/:pin" component={HostGame} />
        <Route path="/host-quiz/:quizId" component={HostQuizSetup} />
        <Route path="/edit-quiz/:quizId" component={EditQuiz} />
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
              <Router />
            </div>
            <Toaster />
          </div>
        </TooltipProvider>
      </TenantProvider>
    </QueryClientProvider>
  );
}

export default App;
