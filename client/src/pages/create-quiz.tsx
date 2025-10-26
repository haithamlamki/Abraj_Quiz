import { useState, useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Trash2, Triangle, Diamond, Circle, Square, Upload, Link as LinkIcon, Wand2, BookOpen, Image, X, PlusCircle, Download, FileText } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import type { Question } from "@shared/schema";
import { generateQuizPDF } from "@/utils/quiz-pdf-generator";

interface QuizForm {
  title: string;
  description: string;
  questions: Question[];
  background: string;
}

const answerIcons = [Triangle, Diamond, Circle, Square];
const answerColors = ['abraj-red', 'abraj-blue', 'abraj-green', 'abraj-yellow'];

export default function CreateQuiz() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user, isAuthenticated, isLoading } = useAuth();

  // All hooks must be called before any conditional returns
  const [quiz, setQuiz] = useState<QuizForm>({
    title: "",
    description: "",
    background: "classroom",
    questions: [
      {
        question: "",
        answers: ["", "", "", ""],
        correctAnswer: 0,
        timeLimit: 10
      }
    ]
  });
  
  const [backgroundImage, setBackgroundImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [topicsInput, setTopicsInput] = useState("");
  const [textInput, setTextInput] = useState("");
  const [activeTab, setActiveTab] = useState("manual");

  // Handle background image upload
  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Check file type
      if (!file.type.startsWith('image/')) {
        toast({
          title: "Invalid file type",
          description: "Please select an image file (JPG, PNG, GIF, etc.)",
          variant: "destructive",
        });
        return;
      }

      // Check file size (limit to 5MB)
      if (file.size > 5 * 1024 * 1024) {
        toast({
          title: "File too large",
          description: "Please select an image smaller than 5MB",
          variant: "destructive",
        });
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        setBackgroundImage(dataUrl);
        setQuiz(prev => ({ ...prev, background: dataUrl }));
      };
      reader.readAsDataURL(file);
    }
  };

  const removeBackgroundImage = () => {
    setBackgroundImage(null);
    setQuiz(prev => ({ ...prev, background: 'classroom' }));
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // All mutations and effects declared first
  const createQuizMutation = useMutation({
    mutationFn: async (quizData: QuizForm) => {
      if (!user?.id) {
        throw new Error("You must be logged in to create a quiz");
      }
      
      const payload = {
        title: quizData.title,
        description: quizData.description,
        questions: quizData.questions,
        background: quizData.background,
        createdBy: user.id,
        isPublic: true
      };
      
      console.log("Sending quiz data:", payload);
      
      const response = await apiRequest("POST", "/api/quizzes", payload);
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Quiz Created!",
        description: "Redirecting to host your quiz game...",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/quizzes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/my-quizzes"] });
      setLocation(`/host-quiz/${data.id}`);
    },
    onError: (error: any) => {
      console.error("Quiz creation error:", error);
      console.error("Error response:", error?.response);
      
      let errorMessage = "Failed to create quiz. Please try again.";
      
      if (error?.response?.status === 400) {
        const errorData = error.response.data;
        console.log("Error data:", errorData);
        
        if (errorData?.errors && Array.isArray(errorData.errors)) {
          // Handle Zod validation errors
          const validationErrors = errorData.errors.map((err: any) => {
            if (err.path && err.path.length > 0) {
              return `${err.path.join('.')}: ${err.message}`;
            }
            return err.message;
          });
          errorMessage = validationErrors.join("; ");
        } else if (errorData?.message) {
          errorMessage = errorData.message;
        }
      }
      
      toast({
        title: "Validation Error",
        description: errorMessage,
        variant: "destructive",
      });
    }
  });

  const generateFromPdf = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('pdf', file);
      
      const response = await fetch('/api/generate-quiz/pdf', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to generate quiz from PDF');
      }

      return response.json();
    },
    onSuccess: (generatedQuiz) => {
      // Ensure we have valid questions array before setting state
      if (generatedQuiz && generatedQuiz.questions && Array.isArray(generatedQuiz.questions)) {
        setQuiz({
          title: generatedQuiz.title || "Generated Quiz",
          description: generatedQuiz.description || "",
          background: "classroom",
          questions: generatedQuiz.questions
        });
        setSelectedFile(null);
        setIsGenerating(false);
        setActiveTab("manual");
        toast({ 
          title: "Success", 
          description: `Generated ${generatedQuiz.questions.length} questions from PDF. Review and edit before creating your quiz.` 
        });
      } else {
        throw new Error("Invalid response format from PDF generation");
      }
    },
    onError: (error: any) => {
      setIsGenerating(false);
      toast({
        title: "Error",
        description: error.message || "Failed to generate quiz from PDF",
        variant: "destructive",
      });
    },
  });

  const generateFromUrl = useMutation({
    mutationFn: async (url: string) => {
      const response = await apiRequest("POST", "/api/generate-quiz/url", { url });
      return response.json();
    },
    onSuccess: (generatedQuiz) => {
      // Ensure we have valid questions array before setting state
      if (generatedQuiz && generatedQuiz.questions && Array.isArray(generatedQuiz.questions)) {
        setQuiz({
          title: generatedQuiz.title || "Generated Quiz",
          description: generatedQuiz.description || "",
          background: "classroom",
          questions: generatedQuiz.questions
        });
        setUrlInput('');
        setIsGenerating(false);
        setActiveTab("manual");
        toast({ 
          title: "Success", 
          description: `Generated ${generatedQuiz.questions.length} questions from URL. Review and edit before creating your quiz.` 
        });
      } else {
        throw new Error("Invalid response format from URL generation");
      }
    },
    onError: (error: any) => {
      setIsGenerating(false);
      toast({
        title: "Error",
        description: error.message || "Failed to generate quiz from URL",
        variant: "destructive",
      });
    },
  });

  const generateFromTopics = useMutation({
    mutationFn: async (topics: string) => {
      const response = await apiRequest("POST", "/api/generate-quiz/topics", { topics });
      return response.json();
    },
    onSuccess: (generatedQuiz) => {
      // Ensure we have valid questions array before setting state
      if (generatedQuiz && generatedQuiz.questions && Array.isArray(generatedQuiz.questions)) {
        setQuiz({
          title: generatedQuiz.title || "Generated Quiz",
          description: generatedQuiz.description || "",
          background: "classroom",
          questions: generatedQuiz.questions
        });
        setTopicsInput('');
        setIsGenerating(false);
        setActiveTab("manual");
        toast({ 
          title: "Success", 
          description: `Generated ${generatedQuiz.questions.length} questions from topics. Review and edit before creating your quiz.` 
        });
      } else {
        throw new Error("Invalid response format from topics generation");
      }
    },
    onError: (error: any) => {
      setIsGenerating(false);
      toast({
        title: "Error",
        description: error.message || "Failed to generate quiz from topics",
        variant: "destructive",
      });
    },
  });

  const generateFromText = useMutation({
    mutationFn: async (text: string) => {
      const response = await apiRequest("POST", "/api/generate-quiz/text", { text });
      return response.json();
    },
    onSuccess: (generatedQuiz) => {
      // Ensure we have valid questions array before setting state
      if (generatedQuiz && generatedQuiz.questions && Array.isArray(generatedQuiz.questions)) {
        setQuiz({
          title: generatedQuiz.title || "Generated Quiz",
          description: generatedQuiz.description || "",
          background: "classroom",
          questions: generatedQuiz.questions
        });
        setTextInput('');
        setIsGenerating(false);
        setActiveTab("manual");
        toast({ 
          title: "Success", 
          description: `Generated ${generatedQuiz.questions.length} questions from text content. Review and edit before creating your quiz.` 
        });
      } else {
        throw new Error("Invalid response format from text generation");
      }
    },
    onError: (error: any) => {
      setIsGenerating(false);
      toast({
        title: "Error",
        description: error.message || "Failed to generate quiz from text",
        variant: "destructive",
      });
    },
  });

  const generateBackgroundMutation = useMutation({
    mutationFn: async () => {
      if (!quiz.title || quiz.title.trim().length < 3) {
        throw new Error("Please enter a quiz title before generating a background");
      }
      const response = await apiRequest("POST", "/api/generate-background", { 
        title: quiz.title, 
        description: quiz.description 
      });
      return response.json();
    },
    onSuccess: (data) => {
      if (data && data.backgroundUrl) {
        setBackgroundImage(data.backgroundUrl);
        setQuiz(prev => ({ ...prev, background: data.backgroundUrl }));
        toast({ 
          title: "Success", 
          description: "AI-generated background created successfully!" 
        });
      } else {
        throw new Error("Invalid response format from background generation");
      }
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to generate background image",
        variant: "destructive",
      });
    },
  });

  // Handler for generating background
  const handleGenerateBackground = () => {
    if (!quiz.title || quiz.title.trim().length < 3) {
      toast({
        title: "Error",
        description: "Please enter a quiz title before generating a background",
        variant: "destructive",
      });
      return;
    }
    generateBackgroundMutation.mutate();
  };

  // Effects for authentication and bounds checking
  useEffect(() => {
    if (quiz.questions && quiz.questions.length > 0 && currentQuestionIndex >= quiz.questions.length) {
      setCurrentQuestionIndex(quiz.questions.length - 1);
    }
  }, [quiz.questions, currentQuestionIndex]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      // Don't redirect immediately, let the component render the login prompt
    }
  }, [isAuthenticated, isLoading]);

  // Early returns after all hooks
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-100 via-purple-50 to-pink-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-abraj-primary mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-100 via-purple-50 to-pink-100 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto w-16 h-16 bg-abraj-primary rounded-full flex items-center justify-center mb-4">
              <PlusCircle className="w-8 h-8 text-white" />
            </div>
            <CardTitle className="text-2xl">Create Quiz</CardTitle>
            <p className="text-gray-600">You need to log in to create quizzes</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-center text-sm text-gray-500">
              Sign in to access the quiz creation tools and save your quizzes
            </p>
            <div className="flex flex-col gap-3">
              <Button 
                onClick={() => setLocation("/login")}
                className="w-full abraj-primary hover:abraj-secondary text-white"
              >
                Log In
              </Button>
              <Button 
                onClick={() => setLocation("/signup")}
                variant="outline"
                className="w-full"
              >
                Create Account
              </Button>
            </div>
            <div className="text-center">
              <Button 
                onClick={() => setLocation("/")}
                variant="ghost"
                className="text-sm text-gray-500"
              >
                ← Back to Home
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const addQuestion = () => {
    setQuiz(prev => ({
      ...prev,
      questions: [...prev.questions, {
        question: "",
        answers: ["", "", "", ""],
        correctAnswer: 0,
        timeLimit: 10
      }]
    }));
    setCurrentQuestionIndex(quiz.questions.length);
  };

  const removeQuestion = (index: number) => {
    if (quiz.questions.length <= 1) return;
    
    setQuiz(prev => ({
      ...prev,
      questions: prev.questions.filter((_, i) => i !== index)
    }));
    
    if (currentQuestionIndex >= index && currentQuestionIndex > 0) {
      setCurrentQuestionIndex(currentQuestionIndex - 1);
    }
  };

  const updateQuestion = (index: number, field: keyof Question, value: any) => {
    setQuiz(prev => ({
      ...prev,
      questions: prev.questions.map((q, i) => 
        i === index ? { ...q, [field]: value } : q
      )
    }));
  };

  const updateAnswer = (questionIndex: number, answerIndex: number, value: string) => {
    setQuiz(prev => ({
      ...prev,
      questions: prev.questions.map((q, i) => 
        i === questionIndex ? {
          ...q,
          answers: q.answers.map((a, ai) => ai === answerIndex ? value : a)
        } : q
      )
    }));
  };

  const handleSubmit = () => {
    // Validate quiz title
    if (!quiz.title.trim()) {
      toast({
        title: "Error",
        description: "Please enter a quiz title.",
        variant: "destructive",
      });
      return;
    }

    // Validate questions
    for (let i = 0; i < quiz.questions.length; i++) {
      const question = quiz.questions[i];
      
      if (!question.question.trim()) {
        toast({
          title: "Error",
          description: `Question ${i + 1} text is required.`,
          variant: "destructive",
        });
        return;
      }

      // Check if all answers are filled
      for (let j = 0; j < question.answers.length; j++) {
        if (!question.answers[j].trim()) {
          toast({
            title: "Error",
            description: `Question ${i + 1}, Answer option ${j + 1} is required.`,
            variant: "destructive",
          });
          return;
        }
      }

      // Validate time limit
      if (question.timeLimit < 5 || question.timeLimit > 120) {
        toast({
          title: "Error",
          description: `Question ${i + 1} time limit must be between 5 and 120 seconds.`,
          variant: "destructive",
        });
        return;
      }
    }

    // All validations passed, create the quiz
    createQuizMutation.mutate(quiz);
  };



  const handleGenerateFromUrl = () => {
    if (!urlInput.trim()) {
      toast({
        title: "Error",
        description: "Please enter a valid URL.",
        variant: "destructive",
      });
      return;
    }
    setIsGenerating(true);
    generateFromUrl.mutate(urlInput);
  };

  const handleGenerateFromPdf = () => {
    if (!selectedFile) {
      toast({
        title: "Error", 
        description: "Please select a PDF file.",
        variant: "destructive",
      });
      return;
    }
    setIsGenerating(true);
    generateFromPdf.mutate(selectedFile);
  };

  const handleGenerateFromTopics = () => {
    if (!topicsInput.trim()) {
      toast({
        title: "Error",
        description: "Please enter topics or subjects for the quiz.",
        variant: "destructive",
      });
      return;
    }
    setIsGenerating(true);
    generateFromTopics.mutate(topicsInput);
  };

  const handleGenerateFromText = () => {
    if (!textInput.trim()) {
      toast({
        title: "Error",
        description: "Please paste some text content to generate a quiz from.",
        variant: "destructive",
      });
      return;
    }
    setIsGenerating(true);
    generateFromText.mutate(textInput);
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type === 'application/pdf') {
      setSelectedFile(file);
    } else {
      toast({
        title: "Error",
        description: "Please select a valid PDF file.",
        variant: "destructive",
      });
    }
  };

  const handleDownloadPDF = async () => {
    try {
      // Validate quiz has content
      if (!quiz.title.trim()) {
        toast({
          title: "Missing Quiz Title",
          description: "Please add a title to your quiz before generating PDF.",
          variant: "destructive",
        });
        return;
      }

      if (!quiz.questions.some(q => q.question.trim())) {
        toast({
          title: "No Questions Found",
          description: "Please add at least one question before generating PDF.",
          variant: "destructive",
        });
        return;
      }

      // Create a mock quiz object with proper structure for PDF generation
      const quizForPDF = {
        id: Date.now(), // Temporary ID for PDF generation
        title: quiz.title,
        description: quiz.description || null,
        questions: quiz.questions.filter(q => q.question.trim()), // Only include questions with content
        createdBy: 1, // Default user ID for PDF generation
        createdAt: new Date(),
        background: quiz.background || null,
        isPublic: false
      };

      toast({
        title: "Generating PDF...",
        description: "Your quiz PDF is being created. This may take a moment.",
      });

      await generateQuizPDF(quizForPDF, {
        includeQRCode: true,
        includeAnswerKey: true,
        orientation: 'portrait'
      });

      toast({
        title: "PDF Downloaded",
        description: "Your quiz PDF has been successfully generated and downloaded.",
      });
    } catch (error) {
      console.error('PDF generation error:', error);
      toast({
        title: "PDF Generation Failed",
        description: "There was an error generating your quiz PDF. Please try again.",
        variant: "destructive",
      });
    }
  };

  const currentQuestion = (quiz.questions && quiz.questions[currentQuestionIndex]) || {
    question: "",
    answers: ["", "", "", ""],
    correctAnswer: 0,
    timeLimit: 10
  };

  return (
    <div className="min-h-screen py-8 bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 animate-gradient">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-8 animate-scale-in">
          <h1 className="font-bold text-4xl gradient-text mb-4">Create Your Quiz</h1>
          <p className="text-xl text-gray-600">Build engaging quizzes manually or auto-generate from content</p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground grid w-full grid-cols-2 mt-[21px] mb-[21px] pt-[0px] pb-[0px]">
            <TabsTrigger value="manual" className="ml-[8px] mr-[8px] data-[state=active]:bg-[#019ebd] data-[state=active]:text-white">Manual Creation</TabsTrigger>
            <TabsTrigger value="generate" className="ml-[8px] mr-[8px] pt-[5px] pb-[5px] data-[state=active]:bg-[#019ebd] data-[state=active]:text-white">Auto Generate</TabsTrigger>
          </TabsList>

          <TabsContent value="generate" className="animate-scale-in">
            <Card className="mb-8 card-3d-enhanced glass">
              <CardHeader>
                <CardTitle className="text-2xl text-center text-gray-800 flex items-center justify-center gap-2">
                  <Wand2 className="w-6 h-6" />
                  Auto Generate Quiz
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <Tabs defaultValue="url" className="w-full">
                  <TabsList className="grid w-full grid-cols-4">
                    <TabsTrigger value="url" className="data-[state=active]:bg-[#019ebd] data-[state=active]:text-white">From URL</TabsTrigger>
                    <TabsTrigger value="pdf" className="data-[state=active]:bg-[#019ebd] data-[state=active]:text-white">From PDF</TabsTrigger>
                    <TabsTrigger value="topics" className="data-[state=active]:bg-[#019ebd] data-[state=active]:text-white">From Topics</TabsTrigger>
                    <TabsTrigger value="text" className="data-[state=active]:bg-[#019ebd] data-[state=active]:text-white">Paste Text</TabsTrigger>
                  </TabsList>

                  <TabsContent value="url" className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Paste Article or Content URL
                      </label>
                      <div className="flex gap-3">
                        <Input
                          placeholder="https://example.com/article"
                          value={urlInput}
                          onChange={(e) => setUrlInput(e.target.value)}
                          className="flex-1"
                          disabled={isGenerating}
                        />
                        <Button 
                          onClick={handleGenerateFromUrl}
                          disabled={isGenerating || !urlInput.trim()}
                          className="abraj-primary hover:abraj-secondary text-white flex items-center gap-2"
                        >
                          {isGenerating ? (
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                          ) : (
                            <LinkIcon className="w-4 h-4" />
                          )}
                          Generate
                        </Button>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="pdf" className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Upload PDF Document
                      </label>
                      <div className="space-y-3">
                        <div className="flex items-center justify-center w-full">
                          <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-gray-300 border-dashed rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100">
                            <div className="flex flex-col items-center justify-center pt-5 pb-6">
                              <Upload className="w-8 h-8 mb-2 text-gray-500" />
                              <p className="mb-2 text-sm text-gray-500">
                                <span className="font-semibold">Click to upload</span> or drag and drop
                              </p>
                              <p className="text-xs text-gray-500">PDF files only</p>
                            </div>
                            <input 
                              type="file" 
                              className="hidden" 
                              accept="application/pdf"
                              onChange={handleFileSelect}
                              disabled={isGenerating}
                            />
                          </label>
                        </div>
                        {selectedFile && (
                          <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                            <span className="text-sm text-blue-800">{selectedFile.name}</span>
                            <Button
                              onClick={() => setSelectedFile(null)}
                              variant="ghost"
                              size="sm"
                              className="text-blue-600 hover:text-blue-800"
                            >
                              Remove
                            </Button>
                          </div>
                        )}
                        <Button 
                          onClick={handleGenerateFromPdf}
                          disabled={isGenerating || !selectedFile}
                          className="w-full abraj-primary hover:abraj-secondary text-white flex items-center gap-2"
                        >
                          {isGenerating ? (
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                          ) : (
                            <Upload className="w-4 h-4" />
                          )}
                          Generate Quiz from PDF
                        </Button>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="topics" className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Enter Topics or Subjects
                      </label>
                      <div className="space-y-3">
                        <Textarea
                          placeholder="Enter topics, subjects, or keywords for your quiz (e.g., World War II, Photosynthesis, JavaScript basics, Ancient Rome)"
                          value={topicsInput}
                          onChange={(e) => setTopicsInput(e.target.value)}
                          className="w-full h-32 resize-none"
                          disabled={isGenerating}
                        />
                        <div className="text-xs text-gray-500">
                          <p>💡 Tips for better results:</p>
                          <ul className="list-disc ml-4 mt-1 space-y-1">
                            <li>Be specific with your topics (e.g., "Mitosis cell division" instead of just "Biology")</li>
                            <li>You can include multiple topics separated by commas</li>
                            <li>Add context like grade level or difficulty (e.g., "High school chemistry")</li>
                          </ul>
                        </div>
                        <Button 
                          onClick={handleGenerateFromTopics}
                          disabled={isGenerating || !topicsInput.trim()}
                          className="w-full abraj-primary hover:abraj-secondary text-white flex items-center gap-2"
                        >
                          {isGenerating ? (
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                          ) : (
                            <BookOpen className="w-4 h-4" />
                          )}
                          Generate Quiz from Topics
                        </Button>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="text" className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Paste Text Content  
                      </label>
                      <div className="space-y-3">
                        <Textarea
                          placeholder="Paste article content, study notes, textbook excerpts, or any educational text here..."
                          value={textInput}
                          onChange={(e) => setTextInput(e.target.value)}
                          className="w-full h-40 resize-none"
                          disabled={isGenerating}
                        />
                        <div className="text-xs text-gray-500">
                          <p>💡 Tips for better results:</p>
                          <ul className="list-disc ml-4 mt-1 space-y-1">
                            <li>Paste substantial content (at least a few paragraphs)</li>
                            <li>Include clear facts, concepts, and details</li>
                            <li>Educational content works best (articles, textbooks, study guides)</li>
                          </ul>
                        </div>
                        <Button 
                          onClick={handleGenerateFromText}
                          disabled={isGenerating || !textInput.trim()}
                          className="w-full abraj-primary hover:abraj-secondary text-white flex items-center gap-2"
                        >
                          {isGenerating ? (
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                          ) : (
                            <BookOpen className="w-4 h-4" />
                          )}
                          Generate Quiz from Text
                        </Button>
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
                
                {isGenerating && (
                  <div className="text-center p-6 bg-blue-50 rounded-lg">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-abraj-primary mx-auto mb-4"></div>
                    <p className="text-gray-600">Analyzing content and generating quiz questions...</p>
                    <p className="text-sm text-gray-500 mt-2">This may take a few moments</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="manual">
            <div className="grid lg:grid-cols-3 gap-8">
              {/* Quiz Details */}
              <div className="lg:col-span-1 space-y-6 animate-scale-in">
            <Card className="card-3d-enhanced glass">
              <CardHeader>
                <CardTitle>Quiz Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Title</label>
                  <Input
                    value={quiz.title}
                    onChange={(e) => setQuiz(prev => ({ ...prev, title: e.target.value }))}
                    placeholder="Enter quiz title"
                    className="shimmer focus:ring-2 focus:ring-abraj-primary transition-all"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                  <Textarea
                    value={quiz.description}
                    onChange={(e) => setQuiz(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Describe your quiz"
                    rows={3}
                    className="shimmer focus:ring-2 focus:ring-abraj-primary transition-all"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Game Background</label>
                  
                  {backgroundImage ? (
                    <div className="relative">
                      <div className="w-full h-32 bg-gray-100 rounded-lg border-2 border-dashed border-gray-300 relative overflow-hidden card-3d-enhanced">
                        <img 
                          src={backgroundImage} 
                          alt="Background preview" 
                          className="w-full h-full object-cover rounded-lg"
                        />
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={removeBackgroundImage}
                          className="absolute top-2 right-2 h-8 w-8 p-0"
                          data-testid="button-remove-background"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">Custom background image</p>
                    </div>
                  ) : (
                    <>
                      <div 
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full h-32 bg-gray-100 rounded-lg border-2 border-dashed border-gray-300 flex flex-col items-center justify-center cursor-pointer hover:bg-gray-50 transition-all hover:scale-105 mb-3 glass card-3d-enhanced"
                        data-testid="button-upload-background"
                      >
                        <Upload className="w-8 h-8 text-gray-400 mb-2" />
                        <p className="text-sm text-gray-600 font-medium">Upload Background Image</p>
                        <p className="text-xs text-gray-500">Click to select an image file</p>
                      </div>
                      
                      <Button
                        type="button"
                        onClick={handleGenerateBackground}
                        disabled={generateBackgroundMutation.isPending || !quiz.title || quiz.title.trim().length < 3}
                        className="w-full abraj-primary hover:abraj-secondary text-white"
                        data-testid="button-generate-background"
                      >
                        {generateBackgroundMutation.isPending ? (
                          <>
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                            Generating...
                          </>
                        ) : (
                          <>
                            <Wand2 className="w-4 h-4 mr-2" />
                            Generate Background with AI
                          </>
                        )}
                      </Button>
                    </>
                  )}
                  
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="hidden"
                  />
                  
                  <p className="text-xs text-gray-500 mt-2">
                    {backgroundImage 
                      ? "Background will be used throughout the game session" 
                      : "Upload an image or generate one with AI based on your quiz title"}
                  </p>
                </div>

                <div className="text-center">
                  <span className="text-sm text-gray-600">
                    {(quiz.questions && quiz.questions.length) || 0} question{((quiz.questions && quiz.questions.length) || 0) !== 1 ? 's' : ''}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Question Navigation */}
            <Card className="card-3d-enhanced glass">
              <CardHeader>
                <CardTitle>Questions</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {(quiz.questions && quiz.questions.length > 0) ? quiz.questions.map((q, index) => (
                    <div
                      key={index}
                      className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-all hover:scale-105 player-card-float ${
                        index === currentQuestionIndex 
                          ? 'bg-teal-100 border-2 border-abraj-primary card-3d-enhanced' 
                          : 'bg-gray-50 hover:bg-gray-100'
                      }`}
                      onClick={() => setCurrentQuestionIndex(index)}
                    >
                      <span className="text-sm font-medium">
                        Q{index + 1}: {q.question || "Untitled"}
                      </span>
                      {quiz.questions.length > 1 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeQuestion(index);
                          }}
                          className="text-red-500 hover:text-red-700 hover:scale-110 transition-transform"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  )) : (
                    <div className="text-center text-gray-500 p-4">
                      No questions yet. Add a question to get started.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Question Editor */}
          <div className="lg:col-span-2 animate-scale-in">
            <Card className="card-3d-enhanced glass">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Question {currentQuestionIndex + 1} of {quiz.questions.length}</CardTitle>
                  <Badge variant="secondary">Multiple Choice</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Question</label>
                  <Input
                    value={currentQuestion.question}
                    onChange={(e) => updateQuestion(currentQuestionIndex, 'question', e.target.value)}
                    placeholder="Enter your question"
                    className="text-lg shimmer focus:ring-2 focus:ring-abraj-primary transition-all"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-4">Answer Options</label>
                  <div className="space-y-4">
                    {currentQuestion.answers.map((answer, answerIndex) => {
                      const IconComponent = answerIcons[answerIndex];
                      const colorClass = answerColors[answerIndex];
                      
                      return (
                        <div
                          key={answerIndex}
                          className={`${colorClass} text-white p-4 rounded-lg cursor-pointer hover:scale-105 transition-transform card-3d-enhanced`}
                        >
                          <div className="flex items-center justify-end mb-2">
                            <IconComponent className="w-5 h-5" />
                          </div>
                          <Input
                            value={answer}
                            onChange={(e) => updateAnswer(currentQuestionIndex, answerIndex, e.target.value)}
                            placeholder={`Answer option ${answerIndex + 1}`}
                            className="w-full border-none text-white placeholder:text-white/70 focus:outline-none bg-[#ffffff85] shimmer"
                          />
                          <div className="flex items-center space-x-2 mt-2">
                            <Checkbox
                              checked={currentQuestion.correctAnswer === answerIndex}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  updateQuestion(currentQuestionIndex, 'correctAnswer', answerIndex);
                                }
                              }}
                              className="border-white data-[state=checked]:bg-white data-[state=checked]:text-black"
                            />
                            <span className="text-sm opacity-90">Correct answer</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <label className="text-sm font-medium text-gray-700">Time limit:</label>
                    <select
                      value={currentQuestion.timeLimit}
                      onChange={(e) => updateQuestion(currentQuestionIndex, 'timeLimit', parseInt(e.target.value))}
                      className="border border-gray-300 rounded-md px-3 py-1 glass focus:ring-2 focus:ring-abraj-primary transition-all"
                    >
                      <option value={5}>5 seconds</option>
                      <option value={10}>10 seconds</option>
                      <option value={15}>15 seconds</option>
                      <option value={20}>20 seconds</option>
                      <option value={30}>30 seconds</option>
                      <option value={60}>60 seconds</option>
                    </select>
                  </div>

                  <div className="flex space-x-3">
                    <Button
                      variant="outline"
                      onClick={() => setCurrentQuestionIndex(Math.max(0, currentQuestionIndex - 1))}
                      disabled={currentQuestionIndex === 0}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setCurrentQuestionIndex(Math.min(quiz.questions.length - 1, currentQuestionIndex + 1))}
                      disabled={currentQuestionIndex === quiz.questions.length - 1}
                    >
                      Next
                    </Button>
                  </div>
                </div>

                <div className="flex justify-center mt-4">
                  <Button onClick={addQuestion} size="sm" className="abraj-primary btn-glow">
                    <Plus className="w-4 h-4 mr-1" />
                    Add Question
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Submit */}
            <div className="mt-8 flex justify-center gap-4">
              <Button
                onClick={handleDownloadPDF}
                variant="outline"
                className="h-10 px-6 py-3 text-lg font-bold border-[#019ebd] text-[#019ebd] hover:bg-[#019ebd] hover:text-white transition-colors"
              >
                <Download className="w-5 h-5 mr-2" />
                Download PDF
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={createQuizMutation.isPending}
                className="hover:bg-primary/90 h-10 abraj-primary hover:abraj-secondary px-8 py-3 text-lg font-bold bg-[#22c55e] text-[#ffffff] btn-glow shimmer"
              >
                {createQuizMutation.isPending ? "Creating..." : "Create Quiz"}
              </Button>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
