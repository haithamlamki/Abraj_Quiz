import jsPDF from 'jspdf';
import logo from "@assets/ABRJ.OM - Copy_1753146533010.png";

interface PdfData {
  game: any;
  players: any[];
  responses: any[];
  totalQuestions: number;
}

interface ThemeColors {
  primary: [number, number, number];
  secondary: [number, number, number];
  accent: [number, number, number];
  name: string;
}

export const generateEnhancedPDF = async (data: PdfData) => {
  const { game, players, responses, totalQuestions } = data;
  const sortedPlayers = [...players].sort((a, b) => (b.score || 0) - (a.score || 0));
  
  // Create PDF with landscape orientation
  const pdf = new jsPDF('l', 'mm', 'a4');
  let yPosition = 20;
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  // Determine theme based on quiz background
  const quizBackground = game.quiz?.background || 'classroom';
  let currentTheme: ThemeColors = {
    primary: [1, 158, 189], // Abraj turquoise
    secondary: [240, 253, 255],
    accent: [0, 174, 209],
    name: 'Custom Background Theme'
  };

  // Theme colors for different backgrounds
  if (quizBackground && quizBackground.startsWith('data:image/')) {
    // Custom uploaded background - use Abraj brand colors
    currentTheme = {
      primary: [1, 158, 189],
      secondary: [240, 253, 255],
      accent: [0, 174, 209],
      name: 'Custom Background Theme'
    };
  } else {
    // Standard background themes
    const themes: Record<string, ThemeColors> = {
      classroom: { primary: [70, 130, 180], secondary: [245, 250, 255], accent: [100, 149, 237], name: 'Academic Classroom' },
      space: { primary: [75, 0, 130], secondary: [230, 230, 250], accent: [138, 43, 226], name: 'Cosmic Explorer' },
      ocean: { primary: [0, 119, 190], secondary: [240, 248, 255], accent: [30, 144, 255], name: 'Ocean Adventure' },
      forest: { primary: [34, 139, 34], secondary: [240, 255, 240], accent: [50, 205, 50], name: 'Forest Explorer' },
      city: { primary: [105, 105, 105], secondary: [248, 248, 255], accent: [169, 169, 169], name: 'Urban Landscape' }
    };
    currentTheme = themes[quizBackground] || currentTheme;
  }

  // Add background matching quiz theme
  if (quizBackground && quizBackground.startsWith('data:image/')) {
    try {
      // Add custom background image with transparency
      pdf.addImage(quizBackground, 'JPEG', 0, 0, pageWidth, pageHeight);
      pdf.setFillColor(255, 255, 255, 0.85);
      pdf.rect(0, 0, pageWidth, pageHeight, 'F');
    } catch (error) {
      // Fallback to themed background
      pdf.setFillColor(currentTheme.secondary[0], currentTheme.secondary[1], currentTheme.secondary[2]);
      pdf.rect(0, 0, pageWidth, pageHeight, 'F');
    }
  } else {
    // Use themed background
    pdf.setFillColor(currentTheme.secondary[0], currentTheme.secondary[1], currentTheme.secondary[2]);
    pdf.rect(0, 0, pageWidth, pageHeight, 'F');
  }

  // Header with theme colors
  pdf.setFillColor(currentTheme.primary[0], currentTheme.primary[1], currentTheme.primary[2]);
  pdf.rect(0, 0, pageWidth, 40, 'F');

  // Add logo
  try {
    const logoWidth = 35;
    const logoHeight = 30;
    pdf.addImage(logo, 'PNG', 20, yPosition, logoWidth, logoHeight);
  } catch (error) {
    console.warn('Could not add logo to PDF:', error);
  }

  // Title with theme styling
  pdf.setFontSize(28);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(255, 255, 255);
  pdf.text('ABRAJ QUIZ COMPLETE REPORT', pageWidth / 2, yPosition + 18, { align: 'center' });
  
  // Subtitle with theme name
  pdf.setFontSize(12);
  pdf.setFont('helvetica', 'normal');
  pdf.text(`${currentTheme.name} • Generated ${new Date().toLocaleDateString()}`, pageWidth / 2, yPosition + 28, { align: 'center' });
  yPosition += 50;

  // Quiz Information Section
  pdf.setFillColor(currentTheme.accent[0], currentTheme.accent[1], currentTheme.accent[2]);
  pdf.roundedRect(20, yPosition, pageWidth - 40, 35, 5, 5, 'F');
  
  pdf.setFontSize(20);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(255, 255, 255);
  pdf.text('📋 Quiz Details', 30, yPosition + 12);
  
  pdf.setFontSize(14);
  pdf.setFont('helvetica', 'normal');
  pdf.text(`Title: ${game.quiz?.title || 'Untitled Quiz'}`, 30, yPosition + 22);
  pdf.text(`Game PIN: ${game.gamePin}`, pageWidth / 2, yPosition + 22);
  pdf.text(`Questions: ${totalQuestions}`, 30, yPosition + 30);
  pdf.text(`Players: ${players.length}`, pageWidth / 2, yPosition + 30);
  yPosition += 45;

  // Questions Section with Theme Styling
  if (game.quiz?.questions && Array.isArray(game.quiz.questions)) {
    pdf.setFontSize(22);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(currentTheme.primary[0], currentTheme.primary[1], currentTheme.primary[2]);
    pdf.text('📚 INTERACTIVE QUESTION BREAKDOWN', 25, yPosition);
    yPosition += 20;

    game.quiz.questions.forEach((question: any, index: number) => {
      if (yPosition > pageHeight - 60) {
        pdf.addPage();
        // Reapply background for new page
        if (quizBackground && quizBackground.startsWith('data:image/')) {
          try {
            pdf.addImage(quizBackground, 'JPEG', 0, 0, pageWidth, pageHeight);
            pdf.setFillColor(255, 255, 255, 0.85);
            pdf.rect(0, 0, pageWidth, pageHeight, 'F');
          } catch (error) {
            pdf.setFillColor(currentTheme.secondary[0], currentTheme.secondary[1], currentTheme.secondary[2]);
            pdf.rect(0, 0, pageWidth, pageHeight, 'F');
          }
        } else {
          pdf.setFillColor(currentTheme.secondary[0], currentTheme.secondary[1], currentTheme.secondary[2]);
          pdf.rect(0, 0, pageWidth, pageHeight, 'F');
        }
        yPosition = 25;
      }

      // Question header with theme colors
      pdf.setDrawColor(currentTheme.primary[0], currentTheme.primary[1], currentTheme.primary[2]);
      pdf.setFillColor(currentTheme.primary[0], currentTheme.primary[1], currentTheme.primary[2]);
      pdf.roundedRect(25, yPosition - 2, pageWidth - 50, 12, 2, 2, 'FD');
      
      pdf.setFontSize(14);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(255, 255, 255);
      pdf.text(`Question ${index + 1}: ${question.question}`, 30, yPosition + 6);
      yPosition += 18;

      // Answer choices in 2x2 grid with enhanced styling
      const answerPositions = [
        { x: 30, y: yPosition, label: 'A' },
        { x: pageWidth / 2 + 15, y: yPosition, label: 'B' },
        { x: 30, y: yPosition + 15, label: 'C' },
        { x: pageWidth / 2 + 15, y: yPosition + 15, label: 'D' }
      ];

      question.answers.forEach((answer: string, answerIndex: number) => {
        const pos = answerPositions[answerIndex];
        const isCorrect = answerIndex === question.correctAnswer;
        
        // Enhanced styling for correct answer
        if (isCorrect) {
          pdf.setDrawColor(34, 197, 94);
          pdf.setFillColor(240, 253, 244);
          pdf.roundedRect(pos.x - 2, pos.y - 3, (pageWidth / 2) - 35, 12, 2, 2, 'FD');
          
          // Add sparkle effect for correct answer
          pdf.setTextColor(34, 197, 94);
          pdf.setFontSize(10);
          pdf.text('✨', pos.x + (pageWidth / 2) - 50, pos.y + 3);
        } else {
          pdf.setDrawColor(currentTheme.accent[0], currentTheme.accent[1], currentTheme.accent[2]);
          pdf.setFillColor(248, 249, 250);
          pdf.roundedRect(pos.x - 2, pos.y - 3, (pageWidth / 2) - 35, 12, 2, 2, 'FD');
        }
        
        pdf.setFontSize(11);
        pdf.setFont('helvetica', isCorrect ? 'bold' : 'normal');
        pdf.setTextColor(isCorrect ? 34 : 64, isCorrect ? 197 : 64, isCorrect ? 94 : 64);
        pdf.text(`${pos.label}. ${answer}`, pos.x, pos.y + 4);
      });
      yPosition += 35;

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
        const fastestPlayerName = players.find(p => p.id === fastestPlayer.playerId)?.name || 'Unknown';
        pdf.text(`🚀 Fastest Correct: ${fastestPlayerName}`, pageWidth / 2, yPosition + 12);
      }

      yPosition += 25;
    });
  }

  // Player Performance Section
  pdf.addPage();
  // Reapply background
  if (quizBackground && quizBackground.startsWith('data:image/')) {
    try {
      pdf.addImage(quizBackground, 'JPEG', 0, 0, pageWidth, pageHeight);
      pdf.setFillColor(255, 255, 255, 0.85);
      pdf.rect(0, 0, pageWidth, pageHeight, 'F');
    } catch (error) {
      pdf.setFillColor(currentTheme.secondary[0], currentTheme.secondary[1], currentTheme.secondary[2]);
      pdf.rect(0, 0, pageWidth, pageHeight, 'F');
    }
  } else {
    pdf.setFillColor(currentTheme.secondary[0], currentTheme.secondary[1], currentTheme.secondary[2]);
    pdf.rect(0, 0, pageWidth, pageHeight, 'F');
  }
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

    // Silver and Bronze
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

  // Table headers
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
      // Reapply background
      if (quizBackground && quizBackground.startsWith('data:image/')) {
        try {
          pdf.addImage(quizBackground, 'JPEG', 0, 0, pageWidth, pageHeight);
          pdf.setFillColor(255, 255, 255, 0.85);
          pdf.rect(0, 0, pageWidth, pageHeight, 'F');
        } catch (error) {
          pdf.setFillColor(currentTheme.secondary[0], currentTheme.secondary[1], currentTheme.secondary[2]);
          pdf.rect(0, 0, pageWidth, pageHeight, 'F');
        }
      } else {
        pdf.setFillColor(currentTheme.secondary[0], currentTheme.secondary[1], currentTheme.secondary[2]);
        pdf.rect(0, 0, pageWidth, pageHeight, 'F');
      }
      yPosition = 25;
    }

    // Alternating row colors
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

  // Enhanced footer with theme
  const finalPageHeight = pdf.internal.pageSize.getHeight();
  pdf.setDrawColor(currentTheme.primary[0], currentTheme.primary[1], currentTheme.primary[2]);
  pdf.setLineWidth(1);
  pdf.line(25, finalPageHeight - 25, pageWidth - 25, finalPageHeight - 25);
  
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'italic');
  pdf.setTextColor(currentTheme.primary[0], currentTheme.primary[1], currentTheme.primary[2]);
  pdf.text(`Generated by Abraj Quiz System - ${currentTheme.name}`, 25, finalPageHeight - 18);
  pdf.text(`${new Date().toLocaleString()} • Complete Interactive Learning Report`, 25, finalPageHeight - 12);
  pdf.text('© 2025 Abraj Quiz Platform - Enhancing Education Through Interactive Technology', 25, finalPageHeight - 6);

  // Save with enhanced filename
  const fileName = `${(game.quiz?.title || 'Quiz').replace(/[^a-zA-Z0-9]/g, '_')}_Interactive_Report_${game.gamePin}_${new Date().toISOString().split('T')[0]}.pdf`;
  pdf.save(fileName);
};