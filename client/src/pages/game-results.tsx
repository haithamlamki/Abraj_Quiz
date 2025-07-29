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

  // Enhanced PDF generation with comprehensive interactive details and themed backgrounds
  const downloadPDF = async () => {
    if (!results) return;

    const { game, players, totalQuestions, responses } = results;
    const sortedPlayers = [...players].sort((a, b) => (b.score || 0) - (a.score || 0));
    
    // Create new PDF document with landscape orientation for more space
    const pdf = new jsPDF('l', 'mm', 'a4');
    let yPosition = 20;
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    // Background Theme Colors based on quiz background
    const backgroundThemes = {
      classroom: { 
        primary: [70, 130, 180], 
        secondary: [245, 250, 255], 
        accent: [100, 149, 237],
        name: 'Academic Classroom' 
      },
      space: { 
        primary: [75, 0, 130], 
        secondary: [230, 230, 250], 
        accent: [138, 43, 226],
        name: 'Cosmic Explorer' 
      },
      ocean: { 
        primary: [0, 105, 148], 
        secondary: [240, 248, 255], 
        accent: [64, 224, 208],
        name: 'Ocean Depths' 
      },
      forest: { 
        primary: [34, 139, 34], 
        secondary: [240, 255, 240], 
        accent: [46, 139, 87],
        name: 'Forest Adventure' 
      },
      city: { 
        primary: [105, 105, 105], 
        secondary: [248, 248, 255], 
        accent: [169, 169, 169],
        name: 'Urban Explorer' 
      }
    };

    const currentTheme = backgroundThemes[game.quiz?.background as keyof typeof backgroundThemes] || backgroundThemes.classroom;

    // Add themed header background
    pdf.setFillColor(currentTheme.primary[0], currentTheme.primary[1], currentTheme.primary[2]);
    pdf.rect(0, 0, pageWidth, 40, 'F');

    // Add ABRAJ logo with enhanced positioning
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
            const logoWidth = 35;
            const logoHeight = 30;
            const logoX = 20;
            
            pdf.addImage(dataURL, 'PNG', logoX, yPosition, logoWidth, logoHeight);
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

    // Enhanced Header with Theme
    pdf.setFontSize(32);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(255, 255, 255);
    pdf.text('ABRAJ QUIZ', pageWidth / 2, yPosition + 15, { align: 'center' });
    
    pdf.setFontSize(16);
    pdf.setFont('helvetica', 'normal');
    pdf.text(`${currentTheme.name} Edition - Complete Interactive Report`, pageWidth / 2, yPosition + 25, { align: 'center' });
    
    yPosition = 50;

    // Enhanced Quiz Information Panel with Theme
    pdf.setDrawColor(currentTheme.accent[0], currentTheme.accent[1], currentTheme.accent[2]);
    pdf.setFillColor(currentTheme.secondary[0], currentTheme.secondary[1], currentTheme.secondary[2]);
    pdf.roundedRect(15, yPosition, pageWidth - 30, 40, 5, 5, 'FD');
    
    pdf.setFontSize(18);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(currentTheme.primary[0], currentTheme.primary[1], currentTheme.primary[2]);
    pdf.text('📊 Quiz Session Overview', 25, yPosition + 12);
    
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(0, 0, 0);
    const currentDate = new Date().toLocaleString();
    
    const leftColumn = [
      `📚 Quiz: ${game.quiz?.title || 'Untitled Quiz'}`,
      `🎯 Game PIN: ${game.gamePin}`,
      `👥 Players: ${players.length} participants`
    ];
    
    const rightColumn = [
      `🎓 Host: ${game.hostName || 'Quiz Master'}`,
      `📅 Date: ${currentDate}`,
      `❓ Questions: ${totalQuestions} total`
    ];

    leftColumn.forEach((info, index) => {
      pdf.text(info, 25, yPosition + 22 + (index * 6));
    });
    
    rightColumn.forEach((info, index) => {
      pdf.text(info, pageWidth / 2 + 20, yPosition + 22 + (index * 6));
    });

    yPosition += 50;

    // === INTERACTIVE LEARNING SECTION ===
    pdf.addPage();
    yPosition = 20;
    
    // Add themed background pattern
    pdf.setFillColor(currentTheme.secondary[0], currentTheme.secondary[1], currentTheme.secondary[2]);
    pdf.rect(0, 0, pageWidth, pageHeight, 'F');
    
    pdf.setFontSize(28);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(currentTheme.primary[0], currentTheme.primary[1], currentTheme.primary[2]);
    pdf.text('🎓 INTERACTIVE LEARNING GUIDE', pageWidth / 2, yPosition, { align: 'center' });
    yPosition += 15;
    
    pdf.setFontSize(14);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(80, 80, 80);
    pdf.text('Complete study material with detailed explanations, interactive elements, and performance insights', pageWidth / 2, yPosition, { align: 'center' });
    yPosition += 25;

    if (game.quiz?.questions) {
      game.quiz.questions.forEach((question: any, index: number) => {
        // Check for page break with more generous spacing
        if (yPosition > pageHeight - 80) {
          pdf.addPage();
          pdf.setFillColor(currentTheme.secondary[0], currentTheme.secondary[1], currentTheme.secondary[2]);
          pdf.rect(0, 0, pageWidth, pageHeight, 'F');
          yPosition = 25;
        }

        // Enhanced Question Container with Theme
        const questionBoxHeight = 25;
        pdf.setDrawColor(currentTheme.primary[0], currentTheme.primary[1], currentTheme.primary[2]);
        pdf.setFillColor(255, 255, 255);
        pdf.roundedRect(20, yPosition, pageWidth - 40, questionBoxHeight, 4, 4, 'FD');

        // Question number badge
        pdf.setFillColor(currentTheme.primary[0], currentTheme.primary[1], currentTheme.primary[2]);
        pdf.circle(35, yPosition + 12, 8, 'F');
        pdf.setFontSize(14);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(255, 255, 255);
        pdf.text(`${index + 1}`, 35, yPosition + 15, { align: 'center' });

        // Question text with enhanced formatting
        pdf.setFontSize(14);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(currentTheme.primary[0], currentTheme.primary[1], currentTheme.primary[2]);
        const questionText = `🤔 ${question.question}`;
        const splitQuestion = pdf.splitTextToSize(questionText, pageWidth - 100);
        pdf.text(splitQuestion, 50, yPosition + 12);
        
        // Interactive elements: difficulty and time indicators
        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(120, 120, 120);
        pdf.text(`⏱️ ${question.timeLimit || 10}s`, pageWidth - 60, yPosition + 8);
        
        const difficulty = question.timeLimit > 15 ? 'Hard' : question.timeLimit > 10 ? 'Medium' : 'Easy';
        const difficultyColor = difficulty === 'Hard' ? [255, 99, 99] : difficulty === 'Medium' ? [255, 165, 0] : [99, 255, 99];
        pdf.setTextColor(difficultyColor[0], difficultyColor[1], difficultyColor[2]);
        pdf.text(`🎯 ${difficulty}`, pageWidth - 60, yPosition + 18);
        
        yPosition += questionBoxHeight + 5;

        // Enhanced Answer Grid with Interactive Design
        const answerLabels = ['A', 'B', 'C', 'D'];
        const answerColors = [
          [255, 87, 87],   // Red
          [66, 133, 244],  // Blue  
          [52, 168, 83],   // Green
          [255, 152, 0]    // Orange
        ];
        
        const answersPerRow = 2;
        const answerWidth = (pageWidth - 60) / answersPerRow - 10;
        const answerHeight = 20;
        
        question.answers.forEach((answer: string, answerIndex: number) => {
          const isCorrect = answerIndex === question.correctAnswer;
          const row = Math.floor(answerIndex / answersPerRow);
          const col = answerIndex % answersPerRow;
          const answerX = 25 + col * (answerWidth + 10);
          const answerY = yPosition + row * (answerHeight + 8);
          
          // Interactive answer box with enhanced styling
          if (isCorrect) {
            // Correct answer - special highlighting with success theme
            pdf.setDrawColor(52, 168, 83);
            pdf.setFillColor(232, 245, 233);
            pdf.setLineWidth(2);
            pdf.roundedRect(answerX, answerY, answerWidth, answerHeight, 3, 3, 'FD');
            
            // Success badge
            pdf.setFillColor(52, 168, 83);
            pdf.circle(answerX + answerWidth - 8, answerY + 6, 4, 'F');
            pdf.setFontSize(8);
            pdf.setTextColor(255, 255, 255);
            pdf.text('✓', answerX + answerWidth - 8, answerY + 8, { align: 'center' });
            
            // Sparkle effects for correct answer
            pdf.setTextColor(255, 215, 0);
            pdf.text('✨', answerX + answerWidth - 20, answerY + 8);
            pdf.text('✨', answerX + answerWidth - 35, answerY + 15);
          } else {
            // Regular answer styling
            pdf.setDrawColor(200, 200, 200);
            pdf.setFillColor(250, 250, 250);
            pdf.setLineWidth(1);
            pdf.roundedRect(answerX, answerY, answerWidth, answerHeight, 3, 3, 'FD');
          }
          
          // Colored answer label with 3D effect
          pdf.setFillColor(answerColors[answerIndex][0], answerColors[answerIndex][1], answerColors[answerIndex][2]);
          pdf.circle(answerX + 12, answerY + 10, 6, 'F');
          
          // Add subtle shadow effect
          pdf.setFillColor(0, 0, 0, 0.2);
          pdf.circle(answerX + 13, answerY + 11, 6, 'F');
          pdf.setFillColor(answerColors[answerIndex][0], answerColors[answerIndex][1], answerColors[answerIndex][2]);
          pdf.circle(answerX + 12, answerY + 10, 6, 'F');
          
          pdf.setTextColor(255, 255, 255);
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(12);
          pdf.text(answerLabels[answerIndex], answerX + 12, answerY + 13, { align: 'center' });
          
          // Answer text with responsive formatting
          pdf.setFontSize(10);
          if (isCorrect) {
            pdf.setTextColor(21, 87, 36);
            pdf.setFont('helvetica', 'bold');
          } else {
            pdf.setTextColor(66, 66, 66);
            pdf.setFont('helvetica', 'normal');
          }
          
          const answerText = pdf.splitTextToSize(answer, answerWidth - 35);
          pdf.text(answerText, answerX + 25, answerY + 8);
        });

        yPosition += Math.ceil(question.answers.length / answersPerRow) * (answerHeight + 8) + 10;
        
        // Player Performance Analytics for each question
        const questionResponses = responses?.filter(r => r.questionIndex === index) || [];
        const correctResponses = questionResponses.filter(r => r.selectedAnswer === question.correctAnswer).length;
        const totalResponses = questionResponses.length;
        const accuracyRate = totalResponses > 0 ? (correctResponses / totalResponses * 100).toFixed(1) : '0';
        
        // Performance insights box
        pdf.setDrawColor(currentTheme.accent[0], currentTheme.accent[1], currentTheme.accent[2]);
        pdf.setFillColor(248, 249, 250);
        pdf.roundedRect(25, yPosition, pageWidth - 50, 18, 2, 2, 'FD');
        
        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(currentTheme.primary[0], currentTheme.primary[1], currentTheme.primary[2]);
        pdf.text('📈 Question Analytics:', 30, yPosition + 6);
        pdf.text(`Accuracy: ${accuracyRate}% (${correctResponses}/${totalResponses} correct)`, 30, yPosition + 12);
        
        const avgResponseTime = questionResponses.length > 0 ? 
          (questionResponses.reduce((sum, r) => sum + (r.responseTime || 0), 0) / questionResponses.length / 1000).toFixed(1) : '0';
        pdf.text(`Average Response Time: ${avgResponseTime}s`, pageWidth / 2, yPosition + 6);
        
        const fastestPlayer = questionResponses
          .filter(r => r.selectedAnswer === question.correctAnswer)
          .sort((a, b) => (a.responseTime || 0) - (b.responseTime || 0))[0];
        
        if (fastestPlayer) {
          const playerName = players.find(p => p.id === fastestPlayer.playerId)?.name || 'Unknown';
          pdf.text(`🚀 Fastest Correct: ${playerName}`, pageWidth / 2, yPosition + 12);
        }

        yPosition += 25;
      });
    }

    // === PLAYER PERFORMANCE SECTION ===
    pdf.addPage();
    pdf.setFillColor(currentTheme.secondary[0], currentTheme.secondary[1], currentTheme.secondary[2]);
    pdf.rect(0, 0, pageWidth, pageHeight, 'F');
    yPosition = 20;

    pdf.setFontSize(28);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(currentTheme.primary[0], currentTheme.primary[1], currentTheme.primary[2]);
    pdf.text('🏆 PLAYER PERFORMANCE & RANKINGS', pageWidth / 2, yPosition, { align: 'center' });
    yPosition += 25;

    // Championship podium for top 3 players
    if (sortedPlayers.length > 0) {
      // Gold Medal Winner
      pdf.setDrawColor(218, 165, 32);
      pdf.setFillColor(255, 248, 220);
      pdf.roundedRect(pageWidth / 2 - 60, yPosition, 120, 25, 4, 4, 'FD');
      
      pdf.setFontSize(16);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(218, 165, 32);
      pdf.text('🥇 CHAMPION', pageWidth / 2, yPosition + 8, { align: 'center' });
      pdf.setFontSize(14);
      pdf.setTextColor(0, 0, 0);
      pdf.text(sortedPlayers[0].name, pageWidth / 2, yPosition + 16, { align: 'center' });
      pdf.text(`${(sortedPlayers[0].score || 0).toLocaleString()} points`, pageWidth / 2, yPosition + 22, { align: 'center' });
      yPosition += 35;

      // Silver and Bronze (if available)
      if (sortedPlayers.length > 1) {
        const secondPlace = sortedPlayers[1];
        pdf.setDrawColor(169, 169, 169);
        pdf.setFillColor(248, 248, 248);
        pdf.roundedRect(40, yPosition, pageWidth / 2 - 60, 20, 3, 3, 'FD');
        pdf.setFontSize(12);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(169, 169, 169);
        pdf.text('🥈 RUNNER-UP', 45, yPosition + 8);
        pdf.setTextColor(0, 0, 0);
        pdf.text(`${secondPlace.name} - ${(secondPlace.score || 0).toLocaleString()}`, 45, yPosition + 15);

        if (sortedPlayers.length > 2) {
          const thirdPlace = sortedPlayers[2];
          pdf.setDrawColor(205, 127, 50);
          pdf.setFillColor(245, 235, 220);
          pdf.roundedRect(pageWidth / 2 + 20, yPosition, pageWidth / 2 - 60, 20, 3, 3, 'FD');
          pdf.setFontSize(12);
          pdf.setFont('helvetica', 'bold');
          pdf.setTextColor(205, 127, 50);
          pdf.text('🥉 THIRD PLACE', pageWidth / 2 + 25, yPosition + 8);
          pdf.setTextColor(0, 0, 0);
          pdf.text(`${thirdPlace.name} - ${(thirdPlace.score || 0).toLocaleString()}`, pageWidth / 2 + 25, yPosition + 15);
        }
        yPosition += 30;
      }
    }

    // Complete player rankings table
    pdf.setFontSize(18);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(currentTheme.primary[0], currentTheme.primary[1], currentTheme.primary[2]);
    pdf.text('📊 Complete Rankings', 25, yPosition);
    yPosition += 15;

    // Table headers with theme colors
    pdf.setDrawColor(currentTheme.primary[0], currentTheme.primary[1], currentTheme.primary[2]);
    pdf.setFillColor(currentTheme.primary[0], currentTheme.primary[1], currentTheme.primary[2]);
    pdf.rect(25, yPosition - 2, pageWidth - 50, 10, 'F');
    
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(255, 255, 255);
    pdf.text('Rank', 30, yPosition + 5);
    pdf.text('Player Name', 80, yPosition + 5);
    pdf.text('Final Score', 180, yPosition + 5);
    pdf.text('Performance', 230, yPosition + 5);
    yPosition += 15;

    // Player performance rows
    sortedPlayers.forEach((player, index) => {
      if (yPosition > pageHeight - 30) {
        pdf.addPage();
        pdf.setFillColor(currentTheme.secondary[0], currentTheme.secondary[1], currentTheme.secondary[2]);
        pdf.rect(0, 0, pageWidth, pageHeight, 'F');
        yPosition = 25;
      }

      // Alternating row colors with theme
      if (index % 2 === 0) {
        pdf.setFillColor(250, 250, 250);
        pdf.rect(25, yPosition - 2, pageWidth - 50, 12, 'F');
      }

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(11);
      pdf.setTextColor(0, 0, 0);
      
      // Special styling for top performers
      if (index < 3) {
        pdf.setFont('helvetica', 'bold');
        if (index === 0) pdf.setTextColor(218, 165, 32); // Gold
        else if (index === 1) pdf.setTextColor(169, 169, 169); // Silver
        else if (index === 2) pdf.setTextColor(205, 127, 50); // Bronze
      }
      
      pdf.text(`#${index + 1}`, 30, yPosition + 6);
      pdf.text(player.name, 80, yPosition + 6);
      pdf.text((player.score || 0).toLocaleString(), 180, yPosition + 6);
      
      const performance = index === 0 ? 'Outstanding' : index < 3 ? 'Excellent' : index < 5 ? 'Good' : 'Participant';
      pdf.text(performance, 230, yPosition + 6);
      
      yPosition += 12;
    });

    // Enhanced statistics section
    yPosition += 20;
    pdf.setFontSize(18);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(currentTheme.primary[0], currentTheme.primary[1], currentTheme.primary[2]);
    pdf.text('📈 Game Analytics & Insights', 25, yPosition);
    yPosition += 15;

    const totalResponses = responses?.length || 0;
    const correctResponses = responses?.filter((r: any) => r.isCorrect).length || 0;
    const averageScore = players.length > 0 ? Math.round(players.reduce((sum: number, p: any) => sum + (p.score || 0), 0) / players.length) : 0;
    const accuracy = totalResponses > 0 ? Math.round((correctResponses / totalResponses) * 100) : 0;

    const analyticsData = [
      { icon: '👥', label: 'Total Participants', value: players.length.toString() },
      { icon: '❓', label: 'Questions Asked', value: totalQuestions.toString() },
      { icon: '✅', label: 'Total Responses', value: totalResponses.toString() },
      { icon: '🎯', label: 'Correct Answers', value: correctResponses.toString() },
      { icon: '📊', label: 'Overall Accuracy', value: `${accuracy}%` },
      { icon: '⭐', label: 'Average Score', value: averageScore.toLocaleString() },
      { icon: '🏆', label: 'Highest Score', value: (sortedPlayers[0]?.score || 0).toLocaleString() },
      { icon: '📉', label: 'Score Range', value: `${(sortedPlayers[sortedPlayers.length - 1]?.score || 0).toLocaleString()} - ${(sortedPlayers[0]?.score || 0).toLocaleString()}` }
    ];

    // Display analytics in a grid
    analyticsData.forEach((item, index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const itemX = 25 + col * (pageWidth / 2 - 25);
      const itemY = yPosition + row * 15;

      if (itemY > pageHeight - 40) {
        pdf.addPage();
        pdf.setFillColor(currentTheme.secondary[0], currentTheme.secondary[1], currentTheme.secondary[2]);
        pdf.rect(0, 0, pageWidth, pageHeight, 'F');
        yPosition = 25;
        return;
      }

      pdf.setFontSize(11);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(currentTheme.primary[0], currentTheme.primary[1], currentTheme.primary[2]);
      pdf.text(`${item.icon} ${item.label}:`, itemX, itemY);
      
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(0, 0, 0);
      pdf.text(item.value, itemX + 80, itemY);
    });

    // Enhanced footer with theme
    const finalPageHeight = pdf.internal.pageSize.getHeight();
    pdf.setDrawColor(currentTheme.primary[0], currentTheme.primary[1], currentTheme.primary[2]);
    pdf.setLineWidth(1);
    pdf.line(25, finalPageHeight - 25, pageWidth - 25, finalPageHeight - 25);
    
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'italic');
    pdf.setTextColor(currentTheme.primary[0], currentTheme.primary[1], currentTheme.primary[2]);
    pdf.text(`Generated by Abraj Quiz System - ${currentTheme.name} Theme`, 25, finalPageHeight - 18);
    pdf.text(`${new Date().toLocaleString()} • Complete Interactive Learning Report`, 25, finalPageHeight - 12);
    pdf.text('© 2025 Abraj Quiz Platform - Enhancing Education Through Interactive Technology', 25, finalPageHeight - 6);

    // Save with enhanced filename
    const fileName = `${(game.quiz?.title || 'Quiz').replace(/[^a-zA-Z0-9]/g, '_')}_Interactive_Complete_Report_${game.gamePin}_${new Date().toISOString().split('T')[0]}.pdf`;
    pdf.save(fileName);
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
