import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Navigation from "@/components/navigation";
import Home from "@/pages/home";
import CreateQuiz from "@/pages/create-quiz";
import HostGame from "@/pages/host-game";
import JoinGame from "@/pages/join-game";
import PlayGame from "@/pages/play-game";
import GameResults from "@/pages/game-results";
import Login from "@/pages/login";
import Signup from "@/pages/signup";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/login" component={Login} />
      <Route path="/signup" component={Signup} />
      <Route path="/create" component={CreateQuiz} />
      <Route path="/host/:pin" component={HostGame} />
      <Route path="/join/:pin?" component={JoinGame} />
      <Route path="/play/:pin" component={PlayGame} />
      <Route path="/results/:pin" component={GameResults} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div className="min-h-screen bg-gradient-to-br from-indigo-100 via-purple-50 to-pink-100">
          <Navigation />
          <Router />
          <Toaster />
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
