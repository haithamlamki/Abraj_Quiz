import jsPDF from 'jspdf';
import QRCode from 'qrcode';
import type { Quiz } from '@shared/schema';
import logo from '@assets/logo.jpg';
import type { PdfBranding } from "./enhanced-pdf-generator";

interface QuizPDFOptions {
  quiz: Quiz;
  includeQRCode?: boolean;
  orientation?: 'portrait' | 'landscape';
  includeAnswerKey?: boolean;
  branding?: PdfBranding;
}

export class QuizPDFGenerator {
  private pdf: jsPDF;
  private quiz: Quiz;
  private options: QuizPDFOptions;
  private yPosition: number = 20;
  private pageHeight: number;
  private pageWidth: number;
  private leftMargin: number = 20;
  private rightMargin: number = 20;
  private currentPage: number = 1;

  constructor(options: QuizPDFOptions) {
    this.quiz = options.quiz;
    this.options = options;
    
    // Determine orientation based on content or user preference
    const orientation = this.shouldUseLandscape() ? 'landscape' : (options.orientation || 'portrait');
    
    this.pdf = new jsPDF(orientation === 'landscape' ? 'l' : 'p', 'mm', 'a4');
    this.pageHeight = this.pdf.internal.pageSize.getHeight();
    this.pageWidth = this.pdf.internal.pageSize.getWidth();
    
    if (orientation === 'landscape') {
      this.leftMargin = 30;
      this.rightMargin = 30;
    }
  }

  private shouldUseLandscape(): boolean {
    if (this.options.orientation === 'landscape') return true;
    if (this.options.orientation === 'portrait') return false;
    
    // Auto-detect if landscape is needed based on content length
    const questions = this.quiz.questions as any[];
    const hasLongContent = questions.some(q => 
      q.question.length > 80 || 
      q.answers.some((answer: string) => answer.length > 50)
    );
    
    return hasLongContent;
  }

  private addPageNumber(): void {
    this.pdf.setFontSize(10);
    this.pdf.setFont('helvetica', 'normal');
    this.pdf.setTextColor(128, 128, 128);
    this.pdf.text(
      `Page ${this.currentPage}`,
      this.pageWidth - this.rightMargin,
      this.pageHeight - 10,
      { align: 'right' }
    );
  }

  private addFooter(): void {
    const footerY = this.pageHeight - 20;
    
    // Add separator line
    this.pdf.setDrawColor(1, 158, 189);
    this.pdf.setLineWidth(0.5);
    this.pdf.line(this.leftMargin, footerY - 5, this.pageWidth - this.rightMargin, footerY - 5);
    
    // Add footer text
    this.pdf.setFontSize(9);
    this.pdf.setFont('helvetica', 'normal');
    this.pdf.setTextColor(100, 100, 100);
    
    const creationDate = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    
    this.pdf.text(
      `Quiz created on ${creationDate} • ${this.options.branding?.footerText ?? '© 2025 Abraj Quiz Platform'}`,
      this.leftMargin,
      footerY
    );
    
    this.addPageNumber();
  }

  private checkPageBreak(requiredSpace: number = 30): void {
    if (this.yPosition + requiredSpace > this.pageHeight - 40) {
      this.addFooter();
      this.pdf.addPage();
      this.currentPage++;
      this.yPosition = 20;
    }
  }

  private addLogo(): Promise<void> {
    return new Promise((resolve) => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const img = new Image();
        
        img.onload = () => {
          canvas.width = img.width;
          canvas.height = img.height;
          ctx?.drawImage(img, 0, 0);

          try {
            const dataURL = canvas.toDataURL('image/png', 0.8);
            const logoWidth = 25;
            const logoHeight = 20;
            const logoX = this.pageWidth - this.rightMargin - logoWidth;

            this.pdf.addImage(dataURL, 'PNG', logoX, this.yPosition, logoWidth, logoHeight);
          } catch (error) {
            console.warn('Could not add logo to PDF:', error);
          }
          resolve();
        };

        img.onerror = () => resolve();
        img.src = this.options.branding?.logoDataUrl || logo;
      } catch (error) {
        console.warn('Logo processing failed:', error);
        resolve();
      }
    });
  }

  private async addQRCode(): Promise<void> {
    if (!this.options.includeQRCode) return;
    
    try {
      const quizUrl = `${window.location.origin}/quiz/${this.quiz.id}`;
      const qrCodeDataUrl = await QRCode.toDataURL(quizUrl, {
        width: 200,
        margin: 2,
        color: {
          dark: '#019ebd',
          light: '#ffffff'
        }
      });
      
      const qrSize = 30;
      const qrX = this.leftMargin;
      const qrY = this.yPosition;
      
      this.pdf.addImage(qrCodeDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);
      
      // Add QR code description
      this.pdf.setFontSize(8);
      this.pdf.setFont('helvetica', 'normal');
      this.pdf.setTextColor(100, 100, 100);
      this.pdf.text('Scan to access', qrX, qrY + qrSize + 5);
      this.pdf.text('online quiz', qrX, qrY + qrSize + 10);
      
    } catch (error) {
      console.warn('Could not generate QR code:', error);
    }
  }

  private addHeader(): void {
    // Title
    this.pdf.setFontSize(24);
    this.pdf.setFont('helvetica', 'bold');
    this.pdf.setTextColor(1, 158, 189);
    this.pdf.text(this.quiz.title, this.leftMargin, this.yPosition);
    this.yPosition += 15;
    
    // Description (if exists)
    if (this.quiz.description && this.quiz.description.trim()) {
      this.pdf.setFontSize(12);
      this.pdf.setFont('helvetica', 'normal');
      this.pdf.setTextColor(80, 80, 80);
      
      const descriptionLines = this.pdf.splitTextToSize(
        this.quiz.description,
        this.pageWidth - this.leftMargin - this.rightMargin - 40
      );
      
      descriptionLines.forEach((line: string) => {
        this.pdf.text(line, this.leftMargin, this.yPosition);
        this.yPosition += 6;
      });
      
      this.yPosition += 5;
    }
    
    // Separator line
    this.pdf.setDrawColor(1, 158, 189);
    this.pdf.setLineWidth(1);
    this.pdf.line(this.leftMargin, this.yPosition, this.pageWidth - this.rightMargin, this.yPosition);
    this.yPosition += 15;
  }

  private addQuestionSection(): void {
    const questions = this.quiz.questions as any[];
    
    // Section header
    this.pdf.setFontSize(18);
    this.pdf.setFont('helvetica', 'bold');
    this.pdf.setTextColor(1, 158, 189);
    this.pdf.text('Quiz Questions', this.leftMargin, this.yPosition);
    this.yPosition += 15;
    
    questions.forEach((question, index) => {
      this.checkPageBreak(50);
      
      // Question number and text
      this.pdf.setFontSize(14);
      this.pdf.setFont('helvetica', 'bold');
      this.pdf.setTextColor(0, 0, 0);
      
      const questionText = `${index + 1}. ${question.question}`;
      const questionLines = this.pdf.splitTextToSize(
        questionText,
        this.pageWidth - this.leftMargin - this.rightMargin
      );
      
      questionLines.forEach((line: string) => {
        this.pdf.text(line, this.leftMargin, this.yPosition);
        this.yPosition += 7;
      });
      
      this.yPosition += 3;
      
      // Answer options
      this.pdf.setFontSize(11);
      this.pdf.setFont('helvetica', 'normal');
      
      const correctIdx: number[] = Array.isArray(question.correctAnswers)
        ? question.correctAnswers
        : typeof question.correctAnswer === "number" ? [question.correctAnswer] : [];
      question.answers.forEach((answer: string, answerIndex: number) => {
        const isCorrect = correctIdx.includes(answerIndex);
        const optionLabel = String.fromCharCode(65 + answerIndex); // A, B, C, D
        
        if (isCorrect && this.options.includeAnswerKey !== false) {
          // Highlight correct answer
          this.pdf.setFont('helvetica', 'bold');
          this.pdf.setTextColor(0, 120, 0); // Green color
          this.pdf.text('✓', this.leftMargin, this.yPosition);
        } else {
          this.pdf.setFont('helvetica', 'normal');
          this.pdf.setTextColor(0, 0, 0);
        }
        
        const optionText = `${optionLabel}. ${answer}`;
        const optionLines = this.pdf.splitTextToSize(
          optionText,
          this.pageWidth - this.leftMargin - this.rightMargin - 10
        );
        
        optionLines.forEach((line: string, lineIndex: number) => {
          const xOffset = lineIndex === 0 && isCorrect && this.options.includeAnswerKey !== false ? 8 : 0;
          this.pdf.text(line, this.leftMargin + 5 + xOffset, this.yPosition);
          this.yPosition += 6;
        });
      });
      
      this.yPosition += 8;
    });
  }

  private addAnswerKey(): void {
    if (this.options.includeAnswerKey === false) return;
    
    this.checkPageBreak(60);
    
    // Section header
    this.pdf.setFontSize(18);
    this.pdf.setFont('helvetica', 'bold');
    this.pdf.setTextColor(1, 158, 189);
    this.pdf.text('Answer Key', this.leftMargin, this.yPosition);
    this.yPosition += 15;
    
    // Create summary table
    const questions = this.quiz.questions as any[];
    const tableData: string[][] = [];
    
    questions.forEach((question, index) => {
      const correctIdx: number[] = Array.isArray(question.correctAnswers)
        ? question.correctAnswers
        : typeof question.correctAnswer === "number" ? [question.correctAnswer] : [];
      const correctAnswerLabel = correctIdx.map((i) => String.fromCharCode(65 + i)).join(", ");
      const correctAnswerText = correctIdx.map((i) => question.answers[i]).join(", ");
      
      tableData.push([
        `${index + 1}`,
        correctAnswerLabel,
        correctAnswerText.length > 50 ? correctAnswerText.substring(0, 47) + '...' : correctAnswerText
      ]);
    });
    
    // Table headers
    this.pdf.setFontSize(12);
    this.pdf.setFont('helvetica', 'bold');
    this.pdf.setTextColor(0, 0, 0);
    
    const colWidths = [20, 20, this.pageWidth - this.leftMargin - this.rightMargin - 40];
    const headers = ['Question', 'Answer', 'Correct Option'];
    
    // Draw table header
    this.pdf.setFillColor(240, 248, 255);
    this.pdf.rect(this.leftMargin, this.yPosition - 5, this.pageWidth - this.leftMargin - this.rightMargin, 10, 'F');
    
    let xPos = this.leftMargin + 5;
    headers.forEach((header, index) => {
      this.pdf.text(header, xPos, this.yPosition);
      xPos += colWidths[index];
    });
    
    this.yPosition += 10;
    
    // Draw table rows
    this.pdf.setFont('helvetica', 'normal');
    this.pdf.setFontSize(10);
    
    tableData.forEach((row, rowIndex) => {
      this.checkPageBreak(15);
      
      if (rowIndex % 2 === 0) {
        this.pdf.setFillColor(248, 248, 248);
        this.pdf.rect(this.leftMargin, this.yPosition - 5, this.pageWidth - this.leftMargin - this.rightMargin, 10, 'F');
      }
      
      xPos = this.leftMargin + 5;
      row.forEach((cell, cellIndex) => {
        this.pdf.text(cell, xPos, this.yPosition);
        xPos += colWidths[cellIndex];
      });
      
      this.yPosition += 8;
    });
  }

  public async generatePDF(): Promise<jsPDF> {
    // Add logo and QR code
    await this.addLogo();
    await this.addQRCode();
    
    // Add header
    this.addHeader();
    
    // Add main content
    this.addQuestionSection();
    this.addAnswerKey();
    
    // Add footer to last page
    this.addFooter();
    
    return this.pdf;
  }

  public async downloadPDF(filename?: string): Promise<void> {
    const pdf = await this.generatePDF();
    const fileName = filename || `${this.quiz.title.replace(/[^a-zA-Z0-9]/g, '_')}_Quiz.pdf`;
    pdf.save(fileName);
  }
}

// Utility function for easy use
export async function generateQuizPDF(quiz: Quiz, options: Partial<QuizPDFOptions> = {}): Promise<void> {
  const generator = new QuizPDFGenerator({
    quiz,
    includeQRCode: true,
    includeAnswerKey: true,
    ...options
  });
  
  await generator.downloadPDF();
}