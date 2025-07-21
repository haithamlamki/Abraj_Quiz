import { useQuery } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Leaderboard from "@/components/leaderboard";
import { Trophy, Home, RotateCcw } from "lucide-react";

import logo from "@assets/logo.jpg";

export default function GameResults() {
  const { pin } = useParams();
  const [, setLocation] = useLocation();
  
  // Get player name from URL params if viewing as player
  const urlParams = new URLSearchParams(window.location.search);
  const playerName = urlParams.get('player');

  const { data: results, isLoading } = useQuery<{
    game: any;
    players: any[];
    responses: any[];
    totalQuestions: number;
  }>({
    queryKey: ["/api/games", pin, "results"],
    enabled: !!pin
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-abraj-primary mx-auto mb-4"></div>
          <p className="text-lg text-gray-600">Loading results...</p>
        </div>
      </div>
    );
  }

  if (!results) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-md mx-4">
          <CardContent className="pt-6 text-center">
            <p className="text-lg text-gray-600 mb-4">Results not found</p>
            <Button onClick={() => setLocation("/")} className="abraj-primary">
              Go Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { game, players, responses, totalQuestions } = results;
  const sortedPlayers = [...players].sort((a, b) => (b.score || 0) - (a.score || 0));
  
  // Calculate stats
  const totalResponses = responses.length;
  const correctResponses = responses.filter((r: any) => r.isCorrect).length;
  const averageScore = players.length > 0 ? Math.round(players.reduce((sum: number, p: any) => sum + (p.score || 0), 0) / players.length) : 0;
  const accuracy = totalResponses > 0 ? Math.round((correctResponses / totalResponses) * 100) : 0;

  if (playerName) {
    // Player view
    const playerData = players.find((p: any) => p.name === playerName);
    const playerRank = sortedPlayers.findIndex((p: any) => p.name === playerName) + 1;
    
    return (
      <div className="min-h-screen py-8">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-8">
            <div className="abraj-green text-white w-24 h-24 rounded-full flex items-center justify-center font-bold text-3xl mx-auto mb-4 animate-bounce-gentle">
              <Trophy className="w-12 h-12" />
            </div>
            <h1 className="font-bold text-4xl text-gray-800 mb-2">Game Complete!</h1>
            <p className="text-xl text-gray-600">{game.quiz?.title || "Quiz"}</p>
          </div>

          <div className="space-y-6">
            {/* Player Performance */}
            <Card className="shadow-xl">
              <CardHeader>
                <CardTitle className="text-center">Your Performance</CardTitle>
              </CardHeader>
              <CardContent className="text-center space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gradient-to-r from-abraj-primary to-abraj-secondary rounded-xl p-4 text-white">
                    <p className="text-sm opacity-90">Final Score</p>
                    <p className="font-bold text-2xl">{(playerData?.score || 0).toLocaleString()}</p>
                  </div>
                  
                  <div className={`rounded-xl p-4 text-white ${
                    playerRank === 1 ? 'abraj-green' :
                    playerRank === 2 ? 'bg-gray-400' :
                    playerRank === 3 ? 'bg-orange-500' :
                    'abraj-primary'
                  }`}>
                    <p className="text-sm opacity-90">Final Rank</p>
                    <p className="font-bold text-2xl">{playerRank}</p>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="bg-gray-100 rounded-lg p-3">
                    <p className="text-gray-600">Questions</p>
                    <p className="font-bold text-lg">{totalQuestions}</p>
                  </div>
                  <div className="bg-gray-100 rounded-lg p-3">
                    <p className="text-gray-600">Players</p>
                    <p className="font-bold text-lg">{players.length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Top 3 */}
            <Card className="shadow-xl">
              <CardHeader>
                <CardTitle className="text-center">Top 3 Players</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex justify-center items-end space-x-4">
                  {sortedPlayers.slice(0, 3).map((player, index) => (
                    <div key={player.name} className="text-center">
                      <div className={`w-16 h-16 rounded-full flex items-center justify-center font-bold text-xl mb-2 ${
                        index === 0 ? 'bg-yellow-400 text-yellow-900' :
                        index === 1 ? 'bg-gray-300 text-gray-700' :
                        'bg-orange-400 text-orange-900'
                      }`}>
                        {index === 0 ? <Trophy className="w-8 h-8" /> : index + 1}
                      </div>
                      <div className={`${
                        index === 0 ? 'bg-yellow-400 h-24' :
                        index === 1 ? 'bg-gray-300 h-16' :
                        'bg-orange-400 h-12'
                      } w-20 rounded-t-lg flex items-center justify-center px-2`}>
                        <span className="font-bold text-sm truncate text-center">
                          {player.name}
                        </span>
                      </div>
                      <p className="text-xs text-gray-600 mt-2">{(player.score || 0).toLocaleString()}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="mt-8 flex justify-center space-x-4">
            <Button onClick={() => setLocation("/")} className="abraj-primary">
              <Home className="w-4 h-4 mr-2" />
              Home
            </Button>
            <Button onClick={() => setLocation("/join")} variant="outline">
              <RotateCcw className="w-4 h-4 mr-2" />
              Play Again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Host view
  return (
    <div className="min-h-screen py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h1 className="font-bold text-4xl text-gray-800 mb-4">Game Results</h1>
          <div className="flex justify-center items-center space-x-4 mb-6">
            <Badge variant="secondary" className="text-lg px-4 py-2">
              PIN: {game.gamePin}
            </Badge>
            <Badge variant="outline" className="text-lg px-4 py-2">
              {totalQuestions} Questions
            </Badge>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Final Leaderboard */}
          <div className="lg:col-span-2 space-y-6">
            <Card className="shadow-xl">
              <CardContent className="p-8">
                <Leaderboard players={players} showPodium={true} title="Final Results" />
              </CardContent>
            </Card>
            
            {/* All Players List */}
            <Card className="shadow-xl">
              <CardHeader>
                <CardTitle className="text-center">All Players & Points</CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div className="space-y-3">
                  {sortedPlayers.map((player, index) => (
                    <div key={player.name} className="flex items-center justify-between bg-gray-50 rounded-lg p-4 hover:bg-gray-100 transition-colors border">
                      <div className="flex items-center space-x-4">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${
                          index === 0 ? 'bg-yellow-400 text-yellow-900' :
                          index === 1 ? 'bg-gray-300 text-gray-700' :
                          index === 2 ? 'bg-orange-400 text-orange-900' :
                          'bg-blue-500 text-white'
                        }`}>
                          {index === 0 ? <Trophy className="w-5 h-5" /> : index + 1}
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">{player.name}</p>
                          <p className="text-sm text-gray-500">Rank #{index + 1}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-lg text-gray-900">{(player.score || 0).toLocaleString()}</p>
                        <p className="text-sm text-gray-500">points</p>
                      </div>
                    </div>
                  ))}
                </div>
                
                {players.length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    <p>No players joined this quiz.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Game Statistics */}
          <div className="space-y-6">
            <Card className="shadow-lg">
              <CardHeader>
                <CardTitle>Game Statistics</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Total Players</span>
                  <span className="font-bold text-abraj-primary">{players.length}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Questions</span>
                  <span className="font-bold text-abraj-blue">{totalQuestions}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Average Score</span>
                  <span className="font-bold text-abraj-green">{averageScore.toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Accuracy</span>
                  <span className="font-bold text-abraj-orange">{accuracy}%</span>
                </div>
              </CardContent>
            </Card>

            {/* Celebration Image */}
            <img 
              src={logo} 
              alt="Quiz competition celebration with trophy and confetti" 
              className="rounded-xl shadow-lg w-full h-40 object-cover"
            />

            {/* Actions */}
            <Card className="shadow-lg">
              <CardContent className="p-6 space-y-3">
                <Button onClick={() => setLocation("/create")} className="w-full abraj-primary">
                  Create New Quiz
                </Button>
                <Button onClick={() => setLocation("/")} variant="outline" className="w-full">
                  <Home className="w-4 h-4 mr-2" />
                  Back to Home
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
