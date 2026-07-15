import jsPDF from 'jspdf';
import logo from "@assets/ABRJ.OM - Copy_1753146533010.png";

export interface PdfBranding {
  appName: string;
  headerText: string;
  footerText: string;
  primaryColor: number[];
  logoDataUrl?: string;
}

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

export const generateEnhancedPDF = async (data: PdfData, branding?: PdfBranding) => {
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
    primary: (branding?.primaryColor ?? [1, 158, 189]) as [number, number, number], // tenant primary
    secondary: [240, 253, 255],
    accent: [0, 174, 209],
    name: 'Custom Background Theme'
  };

  // Theme colors for different backgrounds
  if (quizBackground && quizBackground.startsWith('data:image/')) {
    currentTheme = {
      primary: [1, 158, 189],
      secondary: [240, 253, 255],
      accent: [0, 174, 209],
      name: 'Custom Background Theme'
    };
  } else {
    const themes: Record<string, ThemeColors> = {
      classroom: { primary: [70, 130, 180], secondary: [245, 250, 255], accent: [100, 149, 237], name: 'Academic Classroom' },
      space: { primary: [75, 0, 130], secondary: [230, 230, 250], accent: [138, 43, 226], name: 'Cosmic Explorer' },
      ocean: { primary: [0, 119, 190], secondary: [240, 248, 255], accent: [30, 144, 255], name: 'Ocean Adventure' },
      forest: { primary: [34, 139, 34], secondary: [240, 255, 240], accent: [50, 205, 50], name: 'Forest Explorer' },
      city: { primary: [105, 105, 105], secondary: [248, 248, 255], accent: [169, 169, 169], name: 'Urban Landscape' }
    };
    currentTheme = themes[quizBackground] || currentTheme;
  }

  // Helper function to apply background
  const applyBackground = () => {
    if (quizBackground && quizBackground.startsWith('data:image/')) {
      try {
        pdf.addImage(quizBackground, 'JPEG', 0, 0, pageWidth, pageHeight);
        pdf.setFillColor(255, 255, 255, 0.90);
        pdf.rect(0, 0, pageWidth, pageHeight, 'F');
      } catch (error) {
        pdf.setFillColor(currentTheme.secondary[0], currentTheme.secondary[1], currentTheme.secondary[2]);
        pdf.rect(0, 0, pageWidth, pageHeight, 'F');
      }
    } else {
      pdf.setFillColor(currentTheme.secondary[0], currentTheme.secondary[1], currentTheme.secondary[2]);
      pdf.rect(0, 0, pageWidth, pageHeight, 'F');
    }
  };

  // Apply initial background
  applyBackground();

  // Modern gradient header with depth effect
  pdf.setFillColor(currentTheme.primary[0], currentTheme.primary[1], currentTheme.primary[2]);
  pdf.rect(0, 0, pageWidth, 45, 'F');
  
  // Add subtle shadow to header
  pdf.setFillColor(0, 0, 0);
  pdf.setGState(pdf.GState({ opacity: 0.1 }));
  pdf.rect(0, 43, pageWidth, 2, 'F');
  pdf.setGState(pdf.GState({ opacity: 1 }));

  // Add logo
  try {
    const logoWidth = 35;
    const logoHeight = 30;
    const logoData = branding?.logoDataUrl || logo;
    const logoFormat = typeof logoData === "string" && logoData.startsWith("data:image/jpeg") ? "JPEG" : "PNG";
    pdf.addImage(logoData, logoFormat, 20, yPosition, logoWidth, logoHeight);
  } catch (error) {
    console.warn('Could not add logo to PDF:', error);
  }

  // Modern title with clean design
  pdf.setFontSize(30);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(255, 255, 255);
  pdf.text(branding?.headerText ?? 'ABRAJ QUIZ COMPLETE REPORT', pageWidth / 2, yPosition + 16, { align: 'center' });
  
  // Subtitle
  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'normal');
  pdf.text(`${currentTheme.name} • Generated ${new Date().toLocaleDateString()}`, pageWidth / 2, yPosition + 26, { align: 'center' });
  yPosition += 55;

  // Quiz Information Card - Modern Card Design (calculate dynamic height based on description)
  let descriptionLines = 0;
  if (game.quiz?.description) {
    const tempDescLines = pdf.splitTextToSize(game.quiz.description, pageWidth - 90);
    descriptionLines = tempDescLines.length;
  }
  const quizCardHeight = 55 + (descriptionLines > 0 ? (descriptionLines - 1) * 5 : 0);
  
  pdf.setDrawColor(currentTheme.primary[0], currentTheme.primary[1], currentTheme.primary[2]);
  pdf.setLineWidth(0.5);
  pdf.setFillColor(255, 255, 255);
  pdf.roundedRect(20, yPosition, pageWidth - 40, quizCardHeight, 4, 4, 'FD');
  
  // Card shadow effect
  pdf.setFillColor(0, 0, 0);
  pdf.setGState(pdf.GState({ opacity: 0.08 }));
  pdf.roundedRect(20.5, yPosition + 0.5, pageWidth - 40, quizCardHeight, 4, 4, 'F');
  pdf.setGState(pdf.GState({ opacity: 1 }));
  
  // Section header bar
  pdf.setFillColor(currentTheme.accent[0], currentTheme.accent[1], currentTheme.accent[2]);
  pdf.roundedRect(20, yPosition, pageWidth - 40, 12, 4, 4, 'F');
  pdf.setFillColor(255, 255, 255);
  pdf.rect(20, yPosition + 8, pageWidth - 40, 4, 'F');
  
  pdf.setFontSize(16);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(255, 255, 255);
  pdf.text('QUIZ DETAILS', 30, yPosition + 8);
  
  // Quiz information in modern grid layout
  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(100, 100, 100);
  const quizInfoY = yPosition + 22;
  
  pdf.text('Title:', 30, quizInfoY);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(40, 40, 40);
  pdf.text(game.quiz?.title || 'Untitled Quiz', 60, quizInfoY);
  
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(100, 100, 100);
  pdf.text('Game PIN:', pageWidth / 2 + 10, quizInfoY);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(40, 40, 40);
  pdf.text(game.gamePin, pageWidth / 2 + 45, quizInfoY);
  
  // Track vertical offset for dynamic spacing
  let quizInfoOffset = 8;
  
  // Quiz description if available
  if (game.quiz?.description) {
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(100, 100, 100);
    pdf.text('Description:', 30, quizInfoY + quizInfoOffset);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(60, 60, 60);
    const descLines = pdf.splitTextToSize(game.quiz.description, pageWidth - 90);
    pdf.text(descLines, 78, quizInfoY + quizInfoOffset);
    // Account for description height
    quizInfoOffset += descLines.length * 5;
  }
  
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(100, 100, 100);
  pdf.text('Total Questions:', 30, quizInfoY + quizInfoOffset);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(40, 40, 40);
  pdf.text(totalQuestions.toString(), 78, quizInfoY + quizInfoOffset);
  
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(100, 100, 100);
  pdf.text('Total Players:', pageWidth / 2 + 10, quizInfoY + quizInfoOffset);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(40, 40, 40);
  pdf.text(players.length.toString(), pageWidth / 2 + 58, quizInfoY + quizInfoOffset);
  
  quizInfoOffset += 8;
  
  // Calculate total quiz duration
  const totalTimeLimit = game.quiz?.questions?.reduce((sum: number, q: any) => sum + (q.timeLimit || 30), 0) || 0;
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(100, 100, 100);
  pdf.text('Total Duration:', 30, quizInfoY + quizInfoOffset);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(40, 40, 40);
  pdf.text(`${totalTimeLimit} seconds`, 78, quizInfoY + quizInfoOffset);
  
  yPosition += quizCardHeight + 10;

  // Questions Section Header
  pdf.setFontSize(24);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(currentTheme.primary[0], currentTheme.primary[1], currentTheme.primary[2]);
  pdf.text('QUESTION BREAKDOWN & ANALYTICS', 25, yPosition);
  yPosition += 15;

  // Questions with modern card design
  if (game.quiz?.questions && Array.isArray(game.quiz.questions) && game.quiz.questions.length > 0) {
    game.quiz.questions.forEach((question: any, index: number) => {
      // Pre-calculate all content sizes first
      const questionLines = pdf.splitTextToSize(question.question, pageWidth - 70);
      const questionHeight = questionLines.length * 5;
      
      const answerTextArrays = question.answers.map((ans: string) => 
        pdf.splitTextToSize(ans, (pageWidth / 2) - 62)
      );
      const maxAnswerLines = Math.max(...answerTextArrays.map((arr: string | string[]) => Array.isArray(arr) ? arr.length : 1));
      const answerBoxHeight = Math.max(11, maxAnswerLines * 4 + 4);
      const totalAnswerSectionHeight = Math.ceil(question.answers.length / 2) * (answerBoxHeight + 2);
      
      // Calculate total card height needed
      const cardHeight = 14 + 8 + questionHeight + 8 + totalAnswerSectionHeight + 25; // header + spacing + question + spacing + answers + analytics
      
      // Check if we need a new page
      if (yPosition + cardHeight > pageHeight - 20) {
        pdf.addPage();
        applyBackground();
        yPosition = 25;
      }

      const cardStartY = yPosition;
      
      // Question card with modern styling - dynamic height
      pdf.setDrawColor(currentTheme.primary[0], currentTheme.primary[1], currentTheme.primary[2]);
      pdf.setLineWidth(0.5);
      pdf.setFillColor(255, 255, 255);
      pdf.roundedRect(25, cardStartY, pageWidth - 50, cardHeight, 3, 3, 'FD');
      
      // Card shadow
      pdf.setFillColor(0, 0, 0);
      pdf.setGState(pdf.GState({ opacity: 0.08 }));
      pdf.roundedRect(25.5, cardStartY + 0.5, pageWidth - 50, cardHeight, 3, 3, 'F');
      pdf.setGState(pdf.GState({ opacity: 1 }));
      
      // Question header with gradient effect
      pdf.setFillColor(currentTheme.primary[0], currentTheme.primary[1], currentTheme.primary[2]);
      pdf.roundedRect(25, cardStartY, pageWidth - 50, 14, 3, 3, 'F');
      pdf.setFillColor(255, 255, 255);
      pdf.rect(25, cardStartY + 10, pageWidth - 50, 4, 'F');
      
      pdf.setFontSize(13);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(255, 255, 255);
      pdf.text(`Question ${index + 1}`, 32, cardStartY + 9);
      
      // Time limit badge
      const timeLimit = question.timeLimit || 30;
      pdf.setFillColor(255, 255, 255);
      pdf.setGState(pdf.GState({ opacity: 0.25 }));
      pdf.roundedRect(pageWidth - 95, cardStartY + 3, 35, 8, 2, 2, 'F');
      pdf.setGState(pdf.GState({ opacity: 1 }));
      pdf.setFontSize(9);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(255, 255, 255);
      pdf.text(`${timeLimit}s`, pageWidth - 78, cardStartY + 8.5, { align: 'center' });
      
      // Question text
      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(40, 40, 40);
      pdf.text(questionLines, 32, cardStartY + 22);
      
      // Calculate dynamic answer position based on question length
      let answerYPos = cardStartY + 22 + questionHeight + 8;

      // Answer choices with color-coded styling like the web UI
      const answerColors = [
        { bg: [255, 77, 79], light: [255, 235, 235], label: 'A' }, // Red
        { bg: [45, 136, 255], light: [230, 242, 255], label: 'B' }, // Blue
        { bg: [255, 192, 0], light: [255, 250, 230], label: 'C' }, // Yellow
        { bg: [38, 208, 124], light: [230, 252, 242], label: 'D' }  // Green
      ];

      // Render answers using pre-calculated sizes
      question.answers.forEach((answer: string, answerIndex: number) => {
        const isCorrect = answerIndex === question.correctAnswer;
        const color = answerColors[answerIndex];
        const xPos = answerIndex % 2 === 0 ? 32 : pageWidth / 2 + 12;
        const yPos = answerYPos + Math.floor(answerIndex / 2) * (answerBoxHeight + 2);
        
        // Answer box with color coding
        if (isCorrect) {
          // Correct answer - enhanced green styling
          pdf.setDrawColor(34, 197, 94);
          pdf.setLineWidth(1.5);
          pdf.setFillColor(240, 253, 244);
          pdf.roundedRect(xPos, yPos - 2, (pageWidth / 2) - 50, answerBoxHeight, 2, 2, 'FD');
          
          // "CORRECT" badge
          pdf.setFillColor(34, 197, 94);
          pdf.roundedRect(xPos + (pageWidth / 2) - 75, yPos - 1, 22, 7, 1.5, 1.5, 'F');
          pdf.setFontSize(7);
          pdf.setFont('helvetica', 'bold');
          pdf.setTextColor(255, 255, 255);
          pdf.text('CORRECT', xPos + (pageWidth / 2) - 64, yPos + 3.5, { align: 'center' });
        } else {
          // Regular answer with color theme
          pdf.setDrawColor(color.bg[0], color.bg[1], color.bg[2]);
          pdf.setLineWidth(0.8);
          pdf.setFillColor(color.light[0], color.light[1], color.light[2]);
          pdf.roundedRect(xPos, yPos - 2, (pageWidth / 2) - 50, answerBoxHeight, 2, 2, 'FD');
        }
        
        // Answer label and text
        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'bold');
        
        if (isCorrect) {
          pdf.setTextColor(34, 197, 94);
        } else {
          pdf.setTextColor(color.bg[0], color.bg[1], color.bg[2]);
        }
        pdf.text(`${color.label}.`, xPos + 2, yPos + 4);
        
        pdf.setFont('helvetica', isCorrect ? 'bold' : 'normal');
        pdf.setTextColor(isCorrect ? 34 : 50, isCorrect ? 197 : 50, isCorrect ? 94 : 50);
        const answerText = answerTextArrays[answerIndex];
        pdf.text(answerText, xPos + 8, yPos + 4);
      });

      // Question analytics card - dynamic position based on content
      const questionResponses = responses?.filter(r => r.questionIndex === index) || [];
      const correctResponses = questionResponses.filter(r => r.selectedAnswer === question.correctAnswer).length;
      const totalResponses = questionResponses.length;
      const accuracyRate = totalResponses > 0 ? (correctResponses / totalResponses * 100).toFixed(0) : '0';
      
      // Calculate analytics position using pre-calculated values
      const analyticsY = answerYPos + totalAnswerSectionHeight + 8;
      pdf.setDrawColor(200, 200, 200);
      pdf.setLineWidth(0.3);
      pdf.line(32, analyticsY - 4, pageWidth - 57, analyticsY - 4);
      
      pdf.setFontSize(8);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(100, 100, 100);
      pdf.text('ANALYTICS', 32, analyticsY);
      
      pdf.setFont('helvetica', 'normal');
      pdf.text(`Accuracy: ${accuracyRate}% (${correctResponses}/${totalResponses})`, 32, analyticsY + 5);
      
      const avgResponseTime = questionResponses.length > 0 ? 
        (questionResponses.reduce((sum, r) => sum + (r.responseTime || 0), 0) / questionResponses.length / 1000).toFixed(1) : '0';
      pdf.text(`Avg Time: ${avgResponseTime}s`, pageWidth / 2 + 12, analyticsY + 5);
      
      const fastestPlayer = questionResponses
        .filter(r => r.selectedAnswer === question.correctAnswer)
        .sort((a, b) => (a.responseTime || 0) - (b.responseTime || 0))[0];
      
      if (fastestPlayer) {
        const fastestPlayerName = players.find(p => p.id === fastestPlayer.playerId)?.name || 'Unknown';
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(currentTheme.primary[0], currentTheme.primary[1], currentTheme.primary[2]);
        pdf.text(`Fastest: ${fastestPlayerName}`, pageWidth - 120, analyticsY + 5);
      }

      // Advance yPosition using pre-calculated card height + margin for spacing between cards
      yPosition += cardHeight + 10;
    });
  }

  // Player Performance Section - New Page
  pdf.addPage();
  applyBackground();
  yPosition = 20;

  // Section header
  pdf.setFontSize(28);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(currentTheme.primary[0], currentTheme.primary[1], currentTheme.primary[2]);
  pdf.text('PLAYER PERFORMANCE & RANKINGS', pageWidth / 2, yPosition, { align: 'center' });
  yPosition += 20;

  // Championship podium for top 3 players - Modern Card Design
  if (sortedPlayers.length > 0) {
    // Winner's podium card
    pdf.setDrawColor(218, 165, 32);
    pdf.setLineWidth(1.2);
    pdf.setFillColor(255, 250, 240);
    pdf.roundedRect(pageWidth / 2 - 70, yPosition, 140, 32, 4, 4, 'FD');
    
    // Gold accent bar
    pdf.setFillColor(218, 165, 32);
    pdf.roundedRect(pageWidth / 2 - 70, yPosition, 140, 6, 4, 4, 'F');
    pdf.setFillColor(255, 250, 240);
    pdf.rect(pageWidth / 2 - 70, yPosition + 3, 140, 3, 'F');
    
    pdf.setFontSize(14);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(218, 165, 32);
    pdf.text('1ST PLACE CHAMPION', pageWidth / 2, yPosition + 14, { align: 'center' });
    pdf.setFontSize(13);
    pdf.setTextColor(40, 40, 40);
    pdf.text(sortedPlayers[0].name, pageWidth / 2, yPosition + 22, { align: 'center' });
    pdf.setFontSize(12);
    pdf.setTextColor(100, 100, 100);
    pdf.text(`${(sortedPlayers[0].score || 0).toLocaleString()} points`, pageWidth / 2, yPosition + 28, { align: 'center' });
    yPosition += 42;

    // Silver and Bronze cards
    if (sortedPlayers.length > 1) {
      const secondPlace = sortedPlayers[1];
      
      // Silver card
      pdf.setDrawColor(169, 169, 169);
      pdf.setLineWidth(0.8);
      pdf.setFillColor(248, 248, 248);
      pdf.roundedRect(40, yPosition, (pageWidth / 2) - 65, 24, 3, 3, 'FD');
      
      pdf.setFillColor(169, 169, 169);
      pdf.roundedRect(40, yPosition, (pageWidth / 2) - 65, 5, 3, 3, 'F');
      pdf.setFillColor(248, 248, 248);
      pdf.rect(40, yPosition + 2.5, (pageWidth / 2) - 65, 2.5, 'F');
      
      pdf.setFontSize(11);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(169, 169, 169);
      pdf.text('2ND PLACE', 45, yPosition + 11);
      pdf.setFontSize(10);
      pdf.setTextColor(40, 40, 40);
      pdf.text(secondPlace.name, 45, yPosition + 17);
      pdf.setFontSize(9);
      pdf.setTextColor(100, 100, 100);
      pdf.text(`${(secondPlace.score || 0).toLocaleString()} pts`, 45, yPosition + 21);

      if (sortedPlayers.length > 2) {
        const thirdPlace = sortedPlayers[2];
        
        // Bronze card
        pdf.setDrawColor(205, 127, 50);
        pdf.setLineWidth(0.8);
        pdf.setFillColor(250, 240, 230);
        pdf.roundedRect(pageWidth / 2 + 20, yPosition, (pageWidth / 2) - 65, 24, 3, 3, 'FD');
        
        pdf.setFillColor(205, 127, 50);
        pdf.roundedRect(pageWidth / 2 + 20, yPosition, (pageWidth / 2) - 65, 5, 3, 3, 'F');
        pdf.setFillColor(250, 240, 230);
        pdf.rect(pageWidth / 2 + 20, yPosition + 2.5, (pageWidth / 2) - 65, 2.5, 'F');
        
        pdf.setFontSize(11);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(205, 127, 50);
        pdf.text('3RD PLACE', pageWidth / 2 + 25, yPosition + 11);
        pdf.setFontSize(10);
        pdf.setTextColor(40, 40, 40);
        pdf.text(thirdPlace.name, pageWidth / 2 + 25, yPosition + 17);
        pdf.setFontSize(9);
        pdf.setTextColor(100, 100, 100);
        pdf.text(`${(thirdPlace.score || 0).toLocaleString()} pts`, pageWidth / 2 + 25, yPosition + 21);
      }
      yPosition += 34;
    }
  }

  // Complete player rankings table
  pdf.setFontSize(18);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(currentTheme.primary[0], currentTheme.primary[1], currentTheme.primary[2]);
  pdf.text('COMPLETE RANKINGS', 25, yPosition);
  yPosition += 12;

  // Modern table design
  pdf.setDrawColor(currentTheme.primary[0], currentTheme.primary[1], currentTheme.primary[2]);
  pdf.setLineWidth(0.5);
  pdf.setFillColor(currentTheme.primary[0], currentTheme.primary[1], currentTheme.primary[2]);
  pdf.roundedRect(25, yPosition, pageWidth - 50, 10, 2, 2, 'F');
  
  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(255, 255, 255);
  pdf.text('RANK', 32, yPosition + 6.5);
  pdf.text('PLAYER NAME', 75, yPosition + 6.5);
  pdf.text('FINAL SCORE', 175, yPosition + 6.5);
  pdf.text('PERFORMANCE', 230, yPosition + 6.5);
  yPosition += 15;

  // Player rows with modern styling
  sortedPlayers.forEach((player, index) => {
    if (yPosition > pageHeight - 30) {
      pdf.addPage();
      applyBackground();
      yPosition = 25;
    }

    // Alternating row colors with modern design
    if (index % 2 === 0) {
      pdf.setFillColor(252, 252, 252);
    } else {
      pdf.setFillColor(247, 247, 247);
    }
    pdf.rect(25, yPosition - 2, pageWidth - 50, 11, 'F');
    
    // Subtle border between rows
    pdf.setDrawColor(230, 230, 230);
    pdf.setLineWidth(0.2);
    pdf.line(25, yPosition - 2, pageWidth - 25, yPosition - 2);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    pdf.setTextColor(80, 80, 80);
    
    // Special styling for top 3 performers
    if (index < 3) {
      pdf.setFont('helvetica', 'bold');
      if (index === 0) {
        pdf.setTextColor(218, 165, 32); // Gold
      } else if (index === 1) {
        pdf.setTextColor(169, 169, 169); // Silver
      } else if (index === 2) {
        pdf.setTextColor(205, 127, 50); // Bronze
      }
    }
    
    pdf.text(`#${index + 1}`, 32, yPosition + 5);
    pdf.text(player.name, 75, yPosition + 5);
    pdf.text((player.score || 0).toLocaleString(), 175, yPosition + 5);
    
    // Performance badge
    const performance = index === 0 ? 'Outstanding' : index < 3 ? 'Excellent' : index < 5 ? 'Good' : 'Participant';
    const perfColors = {
      'Outstanding': [218, 165, 32],
      'Excellent': [34, 197, 94],
      'Good': [59, 130, 246],
      'Participant': [156, 163, 175]
    };
    const perfColor = perfColors[performance as keyof typeof perfColors];
    
    pdf.setFillColor(perfColor[0], perfColor[1], perfColor[2]);
    pdf.setGState(pdf.GState({ opacity: 0.15 }));
    pdf.roundedRect(228, yPosition - 0.5, 42, 7, 1.5, 1.5, 'F');
    pdf.setGState(pdf.GState({ opacity: 1 }));
    
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    pdf.setTextColor(perfColor[0], perfColor[1], perfColor[2]);
    pdf.text(performance, 230, yPosition + 4.5);
    
    yPosition += 11;
  });

  // Modern footer design
  yPosition = pageHeight - 20;
  pdf.setDrawColor(currentTheme.primary[0], currentTheme.primary[1], currentTheme.primary[2]);
  pdf.setLineWidth(0.5);
  pdf.line(25, yPosition, pageWidth - 25, yPosition);
  
  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(100, 100, 100);
  pdf.text(`Generated by ${branding?.appName ?? 'Abraj Quiz'} System - ${currentTheme.name}`, 25, yPosition + 6);
  
  pdf.setFontSize(8);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(140, 140, 140);
  pdf.text(`${new Date().toLocaleString()} • Complete Interactive Learning Report`, 25, yPosition + 11);
  pdf.text(branding?.footerText ?? '© 2025 Abraj Quiz Platform - Enhancing Education Through Interactive Technology', 25, yPosition + 15);

  // Save with enhanced filename
  const fileName = `${(game.quiz?.title || 'Quiz').replace(/[^a-zA-Z0-9]/g, '_')}_Report_${game.gamePin}_${new Date().toISOString().split('T')[0]}_${Date.now()}.pdf`;
  pdf.save(fileName);
};
