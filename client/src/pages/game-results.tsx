import { useQuery } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Leaderboard from "@/components/leaderboard";
import { Trophy, Home, RotateCcw, Star, Award, Crown, Download } from "lucide-react";
import { getBackgroundStyle } from "@/utils/backgrounds";

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

  // Enhanced PDF generation matching quiz background, format, shapes and colors
  const downloadPDF = async () => {
    if (!results) return;

    try {
      const { generateEnhancedPDF } = await import('@/utils/enhanced-pdf-generator');
      await generateEnhancedPDF(results);
    } catch (error) {
      console.error('PDF generation failed:', error);
      // Simple fallback PDF generation
      const jsPDF = (await import('jspdf')).default;
      const { game, players, totalQuestions } = results;
      const pdf = new jsPDF('l', 'mm', 'a4');
      
      pdf.setFontSize(20);
      pdf.text('Abraj Quiz Results', 20, 20);
      pdf.setFontSize(14);
      pdf.text(`Quiz: ${game.quiz?.title || 'Untitled Quiz'}`, 20, 40);
      pdf.text(`Game PIN: ${game.gamePin}`, 20, 50);
      pdf.text(`Players: ${players.length}`, 20, 60);
      pdf.text(`Questions: ${totalQuestions}`, 20, 70);
      
      const fileName = `Quiz_${game.gamePin}_${new Date().toISOString().split('T')[0]}.pdf`;
      pdf.save(fileName);
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
      <div className="min-h-screen py-8" style={getBackgroundStyle(game.quiz?.background || 'classroom')}>
        {showCelebration && <ConfettiParticles />}
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-8 animate-in slide-in-from-top-4 duration-700">
            <div className="backdrop-blur-md bg-white/90 rounded-2xl p-8 shadow-2xl border border-white/20">
              <div className="flex justify-center mb-4">
                {playerRank === 1 ? (
                  <Crown className="h-16 w-16 text-yellow-500 animate-bounce" />
                ) : playerRank === 2 ? (
                  <Award className="h-16 w-16 text-gray-400 animate-pulse" />
                ) : playerRank === 3 ? (
                  <Trophy className="h-16 w-16 text-amber-600 animate-pulse" />
                ) : (
                  <Star className="h-16 w-16 text-blue-500" />
                )}
              </div>
              
              <h1 className="text-4xl font-bold text-gray-900 mb-2">
                {playerRank === 1 ? "🎉 Champion!" : 
                 playerRank === 2 ? "🥈 Runner-up!" :
                 playerRank === 3 ? "🥉 Third Place!" :
                 "Great Job!"}
              </h1>
              
              <div className="space-y-4">
                <div>
                  <p className="text-lg text-gray-600">Your Rank</p>
                  <p className="text-3xl font-bold text-abraj-primary">#{playerRank}</p>
                </div>
                
                <div>
                  <p className="text-lg text-gray-600">Your Score</p>
                  <p className="text-3xl font-bold text-abraj-primary">{(playerData?.score || 0).toLocaleString()}</p>
                </div>
                
                <div className="grid grid-cols-2 gap-4 text-center">
                  <div>
                    <p className="text-sm text-gray-600">Total Players</p>
                    <p className="text-xl font-bold">{players.length}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Questions</p>
                    <p className="text-xl font-bold">{totalQuestions}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <Card className="backdrop-blur-md bg-white/90 border-white/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trophy className="h-5 w-5" />
                Leaderboard
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Leaderboard players={sortedPlayers} />
            </CardContent>
          </Card>

          <div className="flex flex-col sm:flex-row gap-4 mt-8">
            <Button onClick={() => setLocation("/")} className="flex-1">
              <Home className="mr-2 h-4 w-4" />
              Home
            </Button>
            <Button 
              onClick={() => setLocation(`/join-game?pin=${pin}`)} 
              variant="outline" 
              className="flex-1"
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Play Again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Host view
  return (
    <div className="min-h-screen py-8" style={getBackgroundStyle(game.quiz?.background || 'classroom')}>
      {showCelebration && <ConfettiParticles />}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-8 animate-in slide-in-from-top-4 duration-700">
          <div className="backdrop-blur-md bg-white/90 rounded-2xl p-8 shadow-2xl border border-white/20">
            <Trophy className="h-16 w-16 text-yellow-500 mx-auto mb-4 animate-bounce" />
            <h1 className="text-4xl font-bold text-gray-900 mb-2">Quiz Complete!</h1>
            <p className="text-xl text-gray-600 mb-6">{game.quiz?.title || 'Untitled Quiz'}</p>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="text-center">
                <div className="text-2xl font-bold text-abraj-primary">{players.length}</div>
                <div className="text-sm text-gray-600">Players</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-abraj-primary">{totalQuestions}</div>
                <div className="text-sm text-gray-600">Questions</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-abraj-primary">{accuracy}%</div>
                <div className="text-sm text-gray-600">Accuracy</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-abraj-primary">{averageScore.toLocaleString()}</div>
                <div className="text-sm text-gray-600">Avg Score</div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button onClick={downloadPDF} className="abraj-primary">
                <Download className="mr-2 h-4 w-4" />
                Download PDF Report
              </Button>
              <Button onClick={() => setLocation("/")} variant="outline">
                <Home className="mr-2 h-4 w-4" />
                Create New Quiz
              </Button>
              <Button 
                onClick={() => setLocation(`/host-quiz/${game.quizId}`)} 
                variant="outline"
                data-testid="button-host-again"
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Host Again
              </Button>
            </div>
          </div>
        </div>

        {/* Winner's Podium */}
        {sortedPlayers.length > 0 && (
          <div className="mb-8">
            <Card className="backdrop-blur-md bg-white/90 border-white/20">
              <CardHeader>
                <CardTitle className="text-center flex items-center justify-center gap-2">
                  <Crown className="h-6 w-6 text-yellow-500" />
                  Winner's Podium
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex justify-center items-end space-x-4">
                  {/* Second Place */}
                  {sortedPlayers[1] && (
                    <div className="text-center">
                      <div className="bg-gray-300 p-4 rounded-lg mb-2 h-20 flex items-end">
                        <div className="w-full">
                          <div className="text-lg font-bold">#2</div>
                          <Award className="h-8 w-8 text-gray-500 mx-auto" />
                        </div>
                      </div>
                      <div className="font-semibold">{sortedPlayers[1].name}</div>
                      <div className="text-sm text-gray-600">{(sortedPlayers[1].score || 0).toLocaleString()}</div>
                    </div>
                  )}

                  {/* First Place */}
                  <div className="text-center">
                    <div className="bg-yellow-300 p-4 rounded-lg mb-2 h-32 flex items-end">
                      <div className="w-full">
                        <div className="text-xl font-bold">#1</div>
                        <Crown className="h-10 w-10 text-yellow-600 mx-auto" />
                      </div>
                    </div>
                    <div className="font-bold text-lg">{sortedPlayers[0].name}</div>
                    <div className="text-sm text-gray-600">{(sortedPlayers[0].score || 0).toLocaleString()}</div>
                  </div>

                  {/* Third Place */}
                  {sortedPlayers[2] && (
                    <div className="text-center">
                      <div className="bg-amber-300 p-4 rounded-lg mb-2 h-16 flex items-end">
                        <div className="w-full">
                          <div className="text-lg font-bold">#3</div>
                          <Trophy className="h-6 w-6 text-amber-600 mx-auto" />
                        </div>
                      </div>
                      <div className="font-semibold">{sortedPlayers[2].name}</div>
                      <div className="text-sm text-gray-600">{(sortedPlayers[2].score || 0).toLocaleString()}</div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Full Leaderboard */}
        <Card className="backdrop-blur-md bg-white/90 border-white/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5" />
              Final Leaderboard
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Leaderboard players={sortedPlayers} showPodium />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}