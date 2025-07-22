import { useQuery } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Leaderboard from "@/components/leaderboard";
import { Trophy, Home, RotateCcw, Star, Award, Crown } from "lucide-react";

import logo from "@assets/logo.jpg";

export default function GameResults() {
  const { pin } = useParams();
  const [, setLocation] = useLocation();
  const [showCelebration, setShowCelebration] = useState(false);
  
  // Get player name from URL params if viewing as player
  const urlParams = new URLSearchParams(window.location.search);
  const playerName = urlParams.get('player');

  // Celebration sound effects
  const playCelebrationSound = () => {
    if (typeof Audio !== 'undefined') {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      // Play celebration chord progression
      const frequencies = [523, 659, 784, 1047]; // C, E, G, C
      frequencies.forEach((freq, index) => {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.value = freq;
        oscillator.type = 'sine';
        gainNode.gain.setValueAtTime(0.15, audioContext.currentTime + index * 0.15);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + index * 0.15 + 1);
        
        oscillator.start(audioContext.currentTime + index * 0.15);
        oscillator.stop(audioContext.currentTime + index * 0.15 + 1);
      });
    }
  };

  const { data: results, isLoading } = useQuery<{
    game: any;
    players: any[];
    responses: any[];
    totalQuestions: number;
  }>({
    queryKey: ["/api/games", pin, "results"],
    enabled: !!pin
  });

  // Trigger celebration effects when results load
  useEffect(() => {
    if (results && !showCelebration) {
      setShowCelebration(true);
      playCelebrationSound();
    }
  }, [results, showCelebration]);

  // Create confetti particles
  const ConfettiParticles = () => {
    const particles = Array.from({ length: 20 }, (_, i) => (
      <div
        key={i}
        className={`fixed w-3 h-3 animate-confetti-fall ${
          i % 4 === 0 ? 'bg-yellow-400' :
          i % 4 === 1 ? 'bg-pink-500' :
          i % 4 === 2 ? 'bg-blue-500' :
          'bg-green-500'
        }`}
        style={{
          left: `${Math.random() * 100}%`,
          animationDelay: `${Math.random() * 3}s`,
          animationDuration: `${3 + Math.random() * 2}s`
        }}
      />
    ));
    return <div className="fixed inset-0 pointer-events-none z-50">{particles}</div>;
  };

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
      <div className="min-h-screen py-8 bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50">
        {showCelebration && <ConfettiParticles />}
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-8 animate-in slide-in-from-top-4 duration-700">
            <div className={`w-24 h-24 rounded-full flex items-center justify-center font-bold text-3xl mx-auto mb-4 ${
              playerRank === 1 ? 'bg-gradient-to-r from-yellow-400 to-yellow-600 animate-pulse' :
              playerRank === 2 ? 'bg-gradient-to-r from-gray-400 to-gray-600' :
              playerRank === 3 ? 'bg-gradient-to-r from-orange-400 to-orange-600' :
              'bg-gradient-to-r from-purple-500 to-pink-500'
            } text-white shadow-lg transform transition-all duration-300 hover:scale-110`}>
              {playerRank === 1 ? <Crown className="w-12 h-12" /> :
               playerRank === 2 ? <Award className="w-12 h-12" /> :
               playerRank === 3 ? <Star className="w-12 h-12" /> :
               <Trophy className="w-12 h-12" />}
            </div>
            <h1 className="font-bold text-4xl text-gray-800 mb-2">
              {playerRank === 1 ? "🎉 Champion!" : 
               playerRank === 2 ? "🥈 Runner-up!" :
               playerRank === 3 ? "🥉 Third Place!" :
               "Game Complete!"}
            </h1>
            <p className="text-xl text-gray-600">{game.quiz?.title || "Quiz"}</p>
          </div>

          <div className="space-y-6">
            {/* Player Performance */}
            <Card className="shadow-xl animate-in slide-in-from-bottom-4 duration-700 delay-200">
              <CardHeader>
                <CardTitle className="text-center">Your Performance</CardTitle>
              </CardHeader>
              <CardContent className="text-center space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl p-4 text-white shadow-lg transform transition-all duration-300 hover:scale-105">
                    <p className="text-sm opacity-90">Final Score</p>
                    <p className="font-bold text-2xl">{(playerData?.score || 0).toLocaleString()}</p>
                  </div>
                  
                  <div className={`rounded-xl p-4 text-white shadow-lg transform transition-all duration-300 hover:scale-105 ${
                    playerRank === 1 ? 'bg-gradient-to-r from-yellow-400 to-yellow-600 animate-pulse' :
                    playerRank === 2 ? 'bg-gradient-to-r from-gray-400 to-gray-600' :
                    playerRank === 3 ? 'bg-gradient-to-r from-orange-400 to-orange-600' :
                    'bg-gradient-to-r from-blue-400 to-blue-600'
                  }`}>
                    <p className="text-sm opacity-90">Final Rank</p>
                    <p className="font-bold text-2xl">#{playerRank}</p>
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

            {/* All Players Results */}
            <Card className="shadow-xl border-2 border-abraj-primary">
              <CardHeader className="bg-abraj-primary text-white">
                <CardTitle className="text-center">
                  🏆 Final Rankings ({players.length} Players)
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                {players.length > 0 ? (
                  <div className="space-y-2">
                    {sortedPlayers.map((player, index) => (
                      <div key={`${player.name}-${index}`} className={`flex items-center justify-between rounded-lg p-3 border-2 transition-colors ${
                        player.name === playerName 
                          ? 'bg-abraj-primary text-white border-abraj-primary shadow-lg' 
                          : 'bg-white border-gray-200 hover:border-abraj-primary'
                      }`}>
                        <div className="flex items-center space-x-3">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${
                            index === 0 ? 'bg-yellow-400 text-yellow-900 shadow-lg' :
                            index === 1 ? 'bg-gray-300 text-gray-700 shadow-lg' :
                            index === 2 ? 'bg-orange-400 text-orange-900 shadow-lg' :
                            player.name === playerName ? 'bg-white text-abraj-primary shadow-md' : 'bg-blue-500 text-white shadow-md'
                          }`}>
                            {index === 0 ? <Trophy className="w-5 h-5" /> : index + 1}
                          </div>
                          <div>
                            <p className={`font-bold ${
                              player.name === playerName ? 'text-white' : 'text-gray-900'
                            }`}>
                              {player.name}
                              {player.name === playerName && <span className="ml-2 text-xs">(You)</span>}
                            </p>
                            <p className={`text-xs ${
                              player.name === playerName ? 'text-white opacity-90' : 'text-gray-500'
                            }`}>
                              Rank #{index + 1} of {players.length}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={`font-bold text-lg ${
                            player.name === playerName ? 'text-white' : 'text-abraj-primary'
                          }`}>
                            {(player.score || 0).toLocaleString()}
                          </p>
                          <p className={`text-xs font-medium ${
                            player.name === playerName ? 'text-white opacity-90' : 'text-gray-500'
                          }`}>
                            points
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <p>No players found</p>
                  </div>
                )}
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
    <div className="min-h-screen py-8 bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      {showCelebration && <ConfettiParticles />}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12 animate-in slide-in-from-top-4 duration-700">
          <div className="w-20 h-20 bg-gradient-to-r from-yellow-400 to-yellow-600 rounded-full flex items-center justify-center mx-auto mb-6 animate-celebration-bounce">
            <Trophy className="w-10 h-10 text-white animate-trophy-shine" />
          </div>
          <h1 className="font-bold text-4xl text-gray-800 mb-4">🎉 Game Complete!</h1>
          <div className="flex justify-center items-center space-x-4 mb-6">
            <Badge variant="secondary" className="text-lg px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white">
              PIN: {game.gamePin}
            </Badge>
            <Badge variant="outline" className="text-lg px-4 py-2 border-2 border-purple-400 text-purple-700">
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
            
            {/* All Players List - Always Show */}
            <Card className="shadow-xl border-2 border-abraj-primary">
              <CardHeader className="bg-abraj-primary text-white">
                <CardTitle className="text-center text-xl">
                  🏆 All Players & Points ({players.length} Total)
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                {players.length > 0 ? (
                  <div className="space-y-3">
                    {sortedPlayers.map((player, index) => (
                      <div key={`${player.name}-${index}`} className={`flex items-center justify-between bg-white rounded-lg p-4 border-2 shadow-sm transform transition-all duration-300 hover:scale-[1.02] animate-in slide-in-from-left-4 ${
                        index === 0 ? 'border-yellow-400 bg-gradient-to-r from-yellow-50 to-yellow-100 animate-victory-glow' :
                        index === 1 ? 'border-gray-400 bg-gradient-to-r from-gray-50 to-gray-100' :
                        index === 2 ? 'border-orange-400 bg-gradient-to-r from-orange-50 to-orange-100' :
                        'border-gray-200 hover:border-abraj-primary'
                      }`} style={{ animationDelay: `${index * 150}ms` }}>
                        <div className="flex items-center space-x-4">
                          <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-sm transform transition-all duration-300 hover:scale-110 ${
                            index === 0 ? 'bg-gradient-to-r from-yellow-400 to-yellow-600 text-white shadow-lg animate-pulse-glow' :
                            index === 1 ? 'bg-gradient-to-r from-gray-400 to-gray-600 text-white shadow-lg' :
                            index === 2 ? 'bg-gradient-to-r from-orange-400 to-orange-600 text-white shadow-lg' :
                            'bg-gradient-to-r from-blue-400 to-blue-600 text-white shadow-md'
                          }`}>
                            {index === 0 ? <Crown className="w-6 h-6" /> :
                             index === 1 ? <Award className="w-6 h-6" /> :
                             index === 2 ? <Star className="w-6 h-6" /> :
                             index + 1}
                          </div>
                          <div>
                            <p className="font-bold text-lg text-gray-900">{player.name}</p>
                            <p className="text-sm text-gray-500">
                              {index === 0 ? '🎉 Champion!' :
                               index === 1 ? '🥈 Runner-up' :
                               index === 2 ? '🥉 Third Place' :
                               `Rank #${index + 1} of ${players.length}`}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={`font-bold text-2xl animate-score-pop ${
                            index === 0 ? 'text-yellow-600' :
                            index === 1 ? 'text-gray-600' :
                            index === 2 ? 'text-orange-600' :
                            'text-abraj-primary'
                          }`}>
                            {(player.score || 0).toLocaleString()}
                          </p>
                          <p className="text-sm text-gray-500 font-medium">points</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 text-gray-500">
                    <p className="text-lg">No players joined this quiz.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Game Statistics */}
          <div className="space-y-6 animate-in slide-in-from-right-4 duration-700 delay-500">
            <Card className="shadow-xl bg-gradient-to-br from-white to-purple-50 border-2 border-purple-200">
              <CardHeader className="text-center">
                <CardTitle className="text-xl text-purple-700">🎯 Game Statistics</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between items-center p-3 bg-gradient-to-r from-blue-50 to-blue-100 rounded-lg animate-score-pop">
                  <span className="text-blue-700 font-medium">Total Players</span>
                  <span className="font-bold text-2xl text-blue-600">{players.length}</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-gradient-to-r from-purple-50 to-purple-100 rounded-lg animate-score-pop" style={{ animationDelay: '0.1s' }}>
                  <span className="text-purple-700 font-medium">Questions</span>
                  <span className="font-bold text-2xl text-purple-600">{totalQuestions}</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-gradient-to-r from-green-50 to-green-100 rounded-lg animate-score-pop" style={{ animationDelay: '0.2s' }}>
                  <span className="text-green-700 font-medium">Average Score</span>
                  <span className="font-bold text-2xl text-green-600">{averageScore.toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-gradient-to-r from-orange-50 to-orange-100 rounded-lg animate-score-pop" style={{ animationDelay: '0.3s' }}>
                  <span className="text-orange-700 font-medium">Accuracy</span>
                  <span className="font-bold text-2xl text-orange-600">{accuracy}%</span>
                </div>
              </CardContent>
            </Card>

            {/* Celebration Image */}
            <div className="animate-float">
              <img 
                src={logo} 
                alt="Quiz competition celebration with trophy and confetti" 
                className="rounded-xl shadow-lg w-full h-40 object-cover border-4 border-yellow-200 transform transition-all duration-300 hover:scale-105"
              />
            </div>

            {/* Actions */}
            <Card className="shadow-xl bg-gradient-to-br from-white to-green-50 border-2 border-green-200">
              <CardHeader className="text-center">
                <CardTitle className="text-lg text-green-700">🚀 What's Next?</CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-3">
                <Button 
                  onClick={() => setLocation("/create")} 
                  className="w-full bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white transform transition-all duration-300 hover:scale-105 shadow-lg"
                >
                  ✨ Create New Quiz
                </Button>
                <Button 
                  onClick={() => setLocation("/")} 
                  variant="outline" 
                  className="w-full border-2 border-green-400 text-green-700 hover:bg-green-50 transform transition-all duration-300 hover:scale-105"
                >
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
