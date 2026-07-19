import jsPDF from 'jspdf';
import QRCode from 'qrcode';
import type { Quiz } from '@shared/schema';
import logo from '@assets/logo.jpg';
import type { PdfBranding } from "./enhanced-pdf-generator";
import { derivePdfTheme, fitText, rgbToHex, type PdfTheme } from "./pdf-theme";

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
  private theme: PdfTheme;

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

    this.theme = derivePdfTheme(options.branding?.primaryColor);
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
    this.pdf.setDrawColor(this.theme.primary[0], this.theme.primary[1], this.theme.primary[2]);
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

  private loadLogoDataUrl(): Promise<string | undefined> {
    return new Promise((resolve) => {
      const source = this.options.branding?.logoDataUrl || logo;
      if (source.startsWith("data:")) {
        resolve(source);
        return;
      }
      try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        const img = new Image();
        img.onload = () => {
          canvas.width = img.width;
          canvas.height = img.height;
          ctx?.drawImage(img, 0, 0);
          try {
            resolve(canvas.toDataURL("image/png", 0.8));
          } catch (error) {
            console.warn("Could not convert logo for PDF:", error);
            resolve(undefined);
          }
        };
        img.onerror = () => resolve(undefined);
        img.src = source;
      } catch (error) {
        console.warn("Logo processing failed:", error);
        resolve(undefined);
      }
    });
  }

  private async addHeader(): Promise<void> {
    const bandHeight = 40;
    const [pr, pg, pb] = this.theme.primary;

    // Brand band across the full page width
    this.pdf.setFillColor(pr, pg, pb);
    this.pdf.rect(0, 0, this.pageWidth, bandHeight, "F");

    // Logo on the right, vertically centered inside the band
    const logoWidth = 24;
    const logoHeight = 19;
    const logoX = this.pageWidth - this.rightMargin - logoWidth;
    const logoDataUrl = await this.loadLogoDataUrl();
    if (logoDataUrl) {
      try {
        this.pdf.addImage(logoDataUrl, "PNG", logoX, (bandHeight - logoHeight) / 2, logoWidth, logoHeight);
      } catch (error) {
        console.warn("Could not add logo to PDF:", error);
      }
    }

    // Title on the left, wrapped to stop before the logo, max 2 lines
    const titleMaxWidth = this.pageWidth - this.leftMargin - this.rightMargin - logoWidth - 8;
    this.pdf.setFontSize(20);
    this.pdf.setFont("helvetica", "bold");
    this.pdf.setTextColor(255, 255, 255);
    let titleLines: string[] = this.pdf.splitTextToSize(this.quiz.title, titleMaxWidth);
    if (titleLines.length > 2) {
      titleLines = [
        titleLines[0],
        fitText(titleLines.slice(1).join(" "), titleMaxWidth, (s) => this.pdf.getTextWidth(s)),
      ];
    }
    const titleY = titleLines.length > 1 ? 15 : 19;
    titleLines.forEach((line, i) => {
      this.pdf.text(line, this.leftMargin, titleY + i * 9);
    });

    // Subtitle inside the band
    const questionCount = (this.quiz.questions as any[]).length;
    const creationDate = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    this.pdf.setFontSize(10);
    this.pdf.setFont("helvetica", "normal");
    this.pdf.text(`${questionCount} questions  |  ${creationDate}`, this.leftMargin, bandHeight - 6);

    this.yPosition = bandHeight + 12;
  }

  private async addIntroSection(): Promise<void> {
    const qrSize = 30;
    const hasQR = !!this.options.includeQRCode;
    const startY = this.yPosition;
    let textBottom = startY;
    let qrBottom = startY;

    // Description wraps in the space left of the QR column
    const textWidth = this.pageWidth - this.leftMargin - this.rightMargin - (hasQR ? qrSize + 10 : 0);
    if (this.quiz.description && this.quiz.description.trim()) {
      this.pdf.setFontSize(11);
      this.pdf.setFont("helvetica", "normal");
      this.pdf.setTextColor(80, 80, 80);
      const lines: string[] = this.pdf.splitTextToSize(this.quiz.description, textWidth);
      lines.forEach((line, i) => {
        this.pdf.text(line, this.leftMargin, startY + i * 6);
      });
      textBottom = startY + lines.length * 6;
    }

    if (hasQR) {
      try {
        const quizUrl = `${window.location.origin}/quiz/${this.quiz.id}`;
        const qrCodeDataUrl = await QRCode.toDataURL(quizUrl, {
          width: 200,
          margin: 2,
          color: { dark: rgbToHex(this.theme.primary), light: "#ffffff" },
        });
        const qrX = this.pageWidth - this.rightMargin - qrSize;
        const qrY = startY - 4;
        this.pdf.addImage(qrCodeDataUrl, "PNG", qrX, qrY, qrSize, qrSize);
        this.pdf.setFontSize(8);
        this.pdf.setFont("helvetica", "normal");
        this.pdf.setTextColor(100, 100, 100);
        this.pdf.text("Scan to open quiz", qrX + qrSize / 2, qrY + qrSize + 4, { align: "center" });
        qrBottom = qrY + qrSize + 6;
      } catch (error) {
        console.warn("Could not generate QR code:", error);
      }
    }

    this.yPosition = Math.max(textBottom, qrBottom) + 4;

    // Separator line
    const [pr, pg, pb] = this.theme.primary;
    this.pdf.setDrawColor(pr, pg, pb);
    this.pdf.setLineWidth(1);
    this.pdf.line(this.leftMargin, this.yPosition, this.pageWidth - this.rightMargin, this.yPosition);
    this.yPosition += 12;
  }

  private drawCheck(x: number, y: number): void {
    this.pdf.setDrawColor(0, 120, 0);
    this.pdf.setLineWidth(0.9);
    this.pdf.line(x, y - 1.6, x + 1.2, y - 0.2);
    this.pdf.line(x + 1.2, y - 0.2, x + 3.4, y - 3.4);
  }

  private addQuestionSection(): void {
    const questions = this.quiz.questions as any[];
    
    // Section header
    this.pdf.setFontSize(18);
    this.pdf.setFont('helvetica', 'bold');
    this.pdf.setTextColor(this.theme.primary[0], this.theme.primary[1], this.theme.primary[2]);
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
          this.drawCheck(this.leftMargin, this.yPosition);
          this.pdf.setFont('helvetica', 'bold');
          this.pdf.setTextColor(0, 120, 0);
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
    this.pdf.setTextColor(this.theme.primary[0], this.theme.primary[1], this.theme.primary[2]);
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
    this.pdf.setFillColor(this.theme.tintStrong[0], this.theme.tintStrong[1], this.theme.tintStrong[2]);
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
    await this.addHeader();
    await this.addIntroSection();
    this.addQuestionSection();
    this.addAnswerKey();
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