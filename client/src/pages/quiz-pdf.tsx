import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Download, FileText, Eye, Settings } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Quiz } from "@shared/schema";
import { generateQuizPDF } from "@/utils/quiz-pdf-generator";
import { useTenant, tenantPdfBranding } from "@/lib/tenant";

export default function QuizPDF() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const tenant = useTenant();
  
  const [options, setOptions] = useState({
    includeAnswerKey: true,
    includeQRCode: true,
    orientation: 'portrait' as 'portrait' | 'landscape',
    downloadAutomatically: true
  });
  
  const [isGenerating, setIsGenerating] = useState(false);

  const { data: quiz, isLoading } = useQuery<Quiz>({
    queryKey: ["/api/quizzes", id],
    enabled: !!id
  });

  const handleGeneratePDF = async () => {
    if (!quiz) return;
    
    setIsGenerating(true);
    
    try {
      toast({
        title: "Generating PDF...",
        description: "Your professionally formatted quiz PDF is being created.",
      });

      await generateQuizPDF(quiz, {
        includeQRCode: options.includeQRCode,
        includeAnswerKey: options.includeAnswerKey,
        orientation: options.orientation,
        branding: await tenantPdfBranding(tenant)
      });

      toast({
        title: "PDF Generated Successfully",
        description: "Your quiz PDF has been downloaded with all requested formatting.",
      });
    } catch (error) {
      console.error('PDF generation error:', error);
      toast({
        title: "PDF Generation Failed",
        description: "There was an error creating your PDF. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-abraj-primary mx-auto mb-4"></div>
          <p className="text-lg text-gray-600">Loading quiz...</p>
        </div>
      </div>
    );
  }

  if (!quiz) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <p className="text-lg text-gray-600 mb-4">Quiz not found</p>
            <Button onClick={() => setLocation("/")} className="abraj-primary">
              Go Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const questions = quiz.questions as any[];

  return (
    <div className="min-h-screen py-8 bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <Button
            variant="ghost"
            onClick={() => setLocation("/")}
            className="mb-4 text-gray-600 hover:text-gray-800"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Home
          </Button>
          
          <div className="text-center">
            <h1 className="font-bold text-4xl text-gray-800 mb-4 flex items-center justify-center gap-3">
              <FileText className="w-10 h-10 text-abraj-primary" />
              Generate Quiz PDF
            </h1>
            <p className="text-xl text-gray-600">Create a professionally formatted PDF document</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Quiz Preview */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Eye className="w-5 h-5 text-abraj-primary" />
                Quiz Preview
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <h3 className="font-bold text-xl text-abraj-primary">{quiz.title}</h3>
                  {quiz.description && (
                    <p className="text-gray-600 mt-2">{quiz.description}</p>
                  )}
                </div>
                
                <div className="bg-gray-50 p-4 rounded-lg">
                  <h4 className="font-semibold text-gray-800 mb-2">Quiz Statistics</h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-600">Total Questions:</span>
                      <span className="font-semibold ml-2">{questions.length}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Quiz ID:</span>
                      <span className="font-semibold ml-2">{quiz.id}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Created:</span>
                      <span className="font-semibold ml-2">
                        {new Date(quiz.createdAt || Date.now()).toLocaleDateString()}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-600">Background:</span>
                      <span className="font-semibold ml-2 capitalize">{quiz.background}</span>
                    </div>
                  </div>
                </div>

                <div className="max-h-60 overflow-y-auto">
                  <h4 className="font-semibold text-gray-800 mb-2">Questions Preview</h4>
                  {questions.slice(0, 3).map((question, index) => (
                    <div key={index} className="mb-3 p-3 bg-white rounded-lg border">
                      <p className="font-medium text-sm">
                        {index + 1}. {question.question.slice(0, 100)}
                        {question.question.length > 100 ? '...' : ''}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        {question.answers.length} answer options
                      </p>
                    </div>
                  ))}
                  {questions.length > 3 && (
                    <p className="text-sm text-gray-500 text-center">
                      + {questions.length - 3} more questions
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* PDF Options */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="w-5 h-5 text-abraj-primary" />
                PDF Generation Options
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Orientation */}
              <div>
                <Label className="text-base font-semibold">Page Orientation</Label>
                <p className="text-sm text-gray-600 mb-3">
                  Landscape is recommended for longer questions or answers
                </p>
                <RadioGroup
                  value={options.orientation}
                  onValueChange={(value) => setOptions(prev => ({ ...prev, orientation: value as 'portrait' | 'landscape' }))}
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="portrait" id="portrait" />
                    <Label htmlFor="portrait" className="cursor-pointer">
                      Portrait (Standard)
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="landscape" id="landscape" />
                    <Label htmlFor="landscape" className="cursor-pointer">
                      Landscape (Wide format)
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              {/* Content Options */}
              <div>
                <Label className="text-base font-semibold">Content Options</Label>
                <div className="space-y-3 mt-3">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="answerKey"
                      checked={options.includeAnswerKey}
                      onCheckedChange={(checked) => 
                        setOptions(prev => ({ ...prev, includeAnswerKey: !!checked }))
                      }
                    />
                    <Label htmlFor="answerKey" className="cursor-pointer">
                      Include Answer Key (correct answers highlighted)
                    </Label>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="qrCode"
                      checked={options.includeQRCode}
                      onCheckedChange={(checked) => 
                        setOptions(prev => ({ ...prev, includeQRCode: !!checked }))
                      }
                    />
                    <Label htmlFor="qrCode" className="cursor-pointer">
                      Include QR Code (link to online quiz)
                    </Label>
                  </div>
                </div>
              </div>

              {/* PDF Features */}
              <div className="bg-blue-50 p-4 rounded-lg">
                <h4 className="font-semibold text-blue-800 mb-2">Included Features</h4>
                <ul className="text-sm text-blue-700 space-y-1">
                  <li>✓ Professional {tenant.branding.appName} branding and logo</li>
                  <li>✓ Numbered questions with clear formatting</li>
                  <li>✓ A, B, C, D labeled answer options</li>
                  <li>✓ Summary table with all correct answers</li>
                  <li>✓ Creation date and footer branding</li>
                  <li>✓ Page numbers and section headings</li>
                  <li>✓ Clean spacing and readable fonts</li>
                </ul>
              </div>

              {/* Generate Button */}
              <Button
                onClick={handleGeneratePDF}
                disabled={isGenerating}
                className="w-full h-12 text-lg font-bold abraj-primary hover:abraj-secondary"
              >
                {isGenerating ? (
                  <div className="flex items-center gap-2">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    Generating PDF...
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Download className="w-5 h-5" />
                    Generate & Download PDF
                  </div>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}