import { useQuery } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Leaderboard from "@/components/leaderboard";
import { Trophy, Home, RotateCcw, Star, Award, Crown, Download } from "lucide-react";
import jsPDF from 'jspdf';

import logo from "@assets/ABRJ.OM - Copy_1753146533010.png";
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

  // PDF generation function
  const downloadPDF = async () => {
    if (!results) return;

    const { game, players, totalQuestions } = results;
    const sortedPlayers = [...players].sort((a, b) => (b.score || 0) - (a.score || 0));
    
    // Create new PDF document
    const pdf = new jsPDF();
    let yPosition = 20;

    // Add ABRAJ logo
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      await new Promise((resolve) => {
        img.onload = () => {
          canvas.width = img.width;
          canvas.height = img.height;
          ctx?.drawImage(img, 0, 0);
          
          try {
            const dataURL = canvas.toDataURL('image/png', 0.8);
            const logoWidth = 25;
            const logoHeight = 20;
            const pageWidth = pdf.internal.pageSize.getWidth();
            const logoX = (pageWidth - logoWidth) / 2;
            
            pdf.addImage(dataURL, 'PNG', logoX, yPosition, logoWidth, logoHeight);
            yPosition += logoHeight + 5;
          } catch (error) {
            console.warn('Could not add logo to PDF:', error);
          }
          resolve(true);
        };
        img.onerror = () => resolve(true);
        img.src = logo;
      });
    } catch (error) {
      console.warn('Logo processing failed:', error);
    }

    // Add ABRAJ QUIZ title
    pdf.setFontSize(24);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(1, 158, 189); // Abraj blue color
    pdf.text('ABRAJ QUIZ', pdf.internal.pageSize.getWidth() / 2, yPosition, { align: 'center' });
    yPosition += 10;

    // Quiz Results Report subtitle
    pdf.setFontSize(16);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(1, 158, 189); // Abraj blue color
    pdf.text('Quiz Results Report', pdf.internal.pageSize.getWidth() / 2, yPosition, { align: 'center' });
    yPosition += 20;

    // Quiz Information
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(1, 158, 189); // Abraj blue color
    const currentDate = new Date().toLocaleString();
    
    const quizInfo = [
      `Quiz Title: ${game.quiz?.title || 'Untitled Quiz'}`,
      `Quiz ID: ${game.quizId}`,
      `Game PIN: ${game.gamePin}`,
      `Host: ${game.hostName || 'Unknown'}`,
      `Date & Time: ${currentDate}`,
      `Total Questions: ${totalQuestions}`,
      `Total Players: ${players.length}`
    ];

    quizInfo.forEach(info => {
      pdf.text(info, 20, yPosition);
      yPosition += 8;
    });

    yPosition += 15;

    // Questions and Answers Section
    pdf.setFontSize(16);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(1, 158, 189); // Abraj blue color
    pdf.text('Questions and Answers', 20, yPosition);
    yPosition += 15;

    if (game.quiz?.questions) {
      game.quiz.questions.forEach((question: any, index: number) => {
        // Check if we need a new page
        if (yPosition > 240) {
          pdf.addPage();
          yPosition = 20;
        }

        // Question number and text
        pdf.setFontSize(12);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(0, 0, 0);
        pdf.text(`Question ${index + 1}: ${question.question}`, 20, yPosition);
        yPosition += 12;

        // Answer choices with colors and highlighting
        pdf.setFontSize(10);
        question.answers.forEach((answer: string, answerIndex: number) => {
          const isCorrect = answerIndex === question.correctAnswer;
          const prefix = String.fromCharCode(65 + answerIndex); // A, B, C, D
          
          if (isCorrect) {
            // Highlight correct answer
            pdf.setFillColor(144, 238, 144); // Light green background
            pdf.rect(25, yPosition - 4, 140, 8, 'F');
            pdf.setFont('helvetica', 'bold');
            pdf.setTextColor(0, 100, 0); // Dark green text
            pdf.text(`${prefix}. ${answer} ✓ (CORRECT)`, 30, yPosition);
          } else {
            pdf.setFont('helvetica', 'normal');
            pdf.setTextColor(0, 0, 0);
            pdf.text(`${prefix}. ${answer}`, 30, yPosition);
          }
          yPosition += 8;
        });
        
        yPosition += 8;
      });
    }

    // Players and Scores Section
    if (yPosition > 200) {
      pdf.addPage();
      yPosition = 20;
    }

    pdf.setFontSize(16);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(1, 158, 189); // Abraj blue color
    pdf.text('Player Rankings and Scores', 20, yPosition);
    yPosition += 15;

    // Add player rankings manually
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(0, 0, 0);
    pdf.text('Player Rankings:', 20, yPosition);
    yPosition += 10;

    // Add table headers
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Rank', 20, yPosition);
    pdf.text('Player Name', 50, yPosition);
    pdf.text('Score', 120, yPosition);
    pdf.text('Achievement', 150, yPosition);
    yPosition += 8;

    // Add line under headers
    pdf.line(20, yPosition - 2, 190, yPosition - 2);
    yPosition += 5;

    // Add player data
    pdf.setFont('helvetica', 'normal');
    sortedPlayers.forEach((player, index) => {
      const achievement = index === 0 ? 'Champion' : 
                         index === 1 ? 'Runner-up' : 
                         index === 2 ? 'Third Place' : '';
      
      if (yPosition > 250) {
        pdf.addPage();
        yPosition = 20;
      }

      pdf.text(`#${index + 1}`, 20, yPosition);
      pdf.text(player.name, 50, yPosition);
      pdf.text((player.score || 0).toLocaleString(), 120, yPosition);
      pdf.text(achievement, 150, yPosition);
      yPosition += 7;
    });

    yPosition += 10;

    // Calculate statistics
    const totalResponses = results.responses.length;
    const correctResponses = results.responses.filter((r: any) => r.isCorrect).length;
    const averageScore = players.length > 0 ? Math.round(players.reduce((sum: number, p: any) => sum + (p.score || 0), 0) / players.length) : 0;
    const accuracy = totalResponses > 0 ? Math.round((correctResponses / totalResponses) * 100) : 0;

    // Add statistics section
    const finalY = yPosition + 15;
    pdf.setFontSize(16);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(1, 158, 189); // Abraj blue color
    pdf.text('Game Statistics', 20, finalY);
    
    const statsY = finalY + 15;
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(0, 0, 0);
    pdf.text(`Average Score: ${averageScore}`, 20, statsY);
    pdf.text(`Overall Accuracy: ${accuracy}%`, 20, statsY + 8);
    pdf.text(`Total Responses: ${totalResponses}`, 20, statsY + 16);

    // Add footer
    const pageHeight = pdf.internal.pageSize.getHeight();
    pdf.setFontSize(8);
    pdf.setFont('helvetica', 'italic');
    pdf.setTextColor(128, 128, 128);
    pdf.text('Generated by Abraj Quiz Platform', pdf.internal.pageSize.getWidth() / 2, pageHeight - 10, { align: 'center' });

    // Save the PDF
    pdf.save(`Abraj_Quiz_${game.gamePin}_Results.pdf`);
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
            <Card className="bg-white/95 backdrop-blur-sm shadow-xl animate-in slide-in-from-bottom-4 duration-700 delay-200">
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
            <Card className="bg-white/95 backdrop-blur-sm shadow-xl border-2 border-abraj-primary">
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
    <div className="min-h-screen py-8" style={getBackgroundStyle(game.quiz?.background || 'classroom')}>
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

            {/* All Players List - Always Show */}
            <Card className="bg-white/95 backdrop-blur-sm shadow-xl border-2 border-abraj-primary">
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
            <Card className="bg-white/95 backdrop-blur-sm shadow-xl bg-gradient-to-br from-white to-purple-50 border-2 border-purple-200">
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
            <Card className="bg-white/95 backdrop-blur-sm shadow-xl bg-gradient-to-br from-white to-green-50 border-2 border-green-200">
              <CardHeader className="text-center">
                <CardTitle className="text-lg text-green-700">🚀 What's Next?</CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-3">
                <Button 
                  onClick={downloadPDF} 
                  className="w-full bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white transform transition-all duration-300 hover:scale-105 shadow-lg"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download PDF Report
                </Button>
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
