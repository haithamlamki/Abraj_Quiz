import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Plus, X, Image, ChevronLeft, ChevronRight } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Question } from "@shared/schema";

export default function CreateQuizSimple() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [quiz, setQuiz] = useState({
    title: "",
    description: "",
    questions: [
      {
        question: "",
        answers: ["", "", "", ""],
        correctAnswer: 0,
        timeLimit: 10
      }
    ] as Question[],
    background: "classroom",
    isPublic: true
  });

  const [backgroundImage, setBackgroundImage] = useState<string | null>(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);

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

  const createQuizMutation = useMutation({
    mutationFn: async (data: typeof quiz) => {
      console.log("Sending quiz data:", data);
      const response = await apiRequest("POST", "/api/quizzes", data);
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/quizzes"] });
      toast({
        title: "Success!",
        description: "Quiz created successfully. You can now host a game.",
      });
      setLocation(`/host-quiz/${data.id}`);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create quiz",
        variant: "destructive",
      });
    }
  });

  const addQuestion = () => {
    const newQuestion: Question = {
      question: "",
      answers: ["", "", "", ""],
      correctAnswer: 0,
      timeLimit: 10
    };
    setQuiz(prev => ({
      ...prev,
      questions: [...prev.questions, newQuestion]
    }));
    setCurrentQuestionIndex(quiz.questions.length);
  };

  const removeQuestion = (index: number) => {
    if (quiz.questions.length <= 1) {
      toast({
        title: "Cannot remove question",
        description: "Quiz must have at least one question.",
        variant: "destructive",
      });
      return;
    }
    
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
            description: `Question ${i + 1}, Answer ${String.fromCharCode(65 + j)} is required.`,
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

  const currentQuestion = quiz.questions[currentQuestionIndex] || {
    question: "",
    answers: ["", "", "", ""],
    correctAnswer: 0,
    timeLimit: 10
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Create Your Quiz</h1>
          <p className="text-gray-600">Build engaging quizzes with custom backgrounds</p>
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Quiz Details */}
          <div className="lg:col-span-1 space-y-6">
            <Card>
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
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                  <Textarea
                    value={quiz.description}
                    onChange={(e) => setQuiz(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Enter quiz description"
                    rows={3}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Game Background</label>
                  
                  {backgroundImage ? (
                    <div className="relative">
                      <div className="w-full h-32 bg-gray-100 rounded-lg border-2 border-dashed border-gray-300 relative overflow-hidden">
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
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">Custom background image uploaded</p>
                    </div>
                  ) : (
                    <div 
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full h-32 bg-gray-100 rounded-lg border-2 border-dashed border-gray-300 flex flex-col items-center justify-center cursor-pointer hover:bg-gray-50 transition-colors"
                    >
                      <Image className="w-8 h-8 text-gray-400 mb-2" />
                      <p className="text-sm text-gray-600 font-medium">Upload Background Image</p>
                      <p className="text-xs text-gray-500">Click to select an image file</p>
                    </div>
                  )}
                  
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="hidden"
                  />
                  
                  <p className="text-xs text-gray-500 mt-1">
                    This background will be used throughout the game session. Maximum file size: 5MB
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Questions Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {quiz.questions.map((_, index) => (
                    <div
                      key={index}
                      onClick={() => setCurrentQuestionIndex(index)}
                      className={`p-3 rounded-lg cursor-pointer transition-colors ${
                        index === currentQuestionIndex
                          ? "bg-[#019ebd] text-white"
                          : "bg-gray-100 hover:bg-gray-200"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">Question {index + 1}</span>
                        {quiz.questions.length > 1 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeQuestion(index);
                            }}
                            className={`h-6 w-6 p-0 ${
                              index === currentQuestionIndex
                                ? "text-white hover:bg-white/20"
                                : "text-gray-500 hover:text-red-600"
                            }`}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                
                <Button
                  onClick={addQuestion}
                  variant="outline"
                  className="w-full mt-4"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add Question
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Question Editor */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Question {currentQuestionIndex + 1} of {quiz.questions.length}</CardTitle>
                  <div className="flex items-center space-x-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentQuestionIndex(Math.max(0, currentQuestionIndex - 1))}
                      disabled={currentQuestionIndex === 0}
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentQuestionIndex(Math.min(quiz.questions.length - 1, currentQuestionIndex + 1))}
                      disabled={currentQuestionIndex === quiz.questions.length - 1}
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Question Text</label>
                  <Textarea
                    value={currentQuestion.question}
                    onChange={(e) => updateQuestion(currentQuestionIndex, "question", e.target.value)}
                    placeholder="Enter your question here..."
                    rows={3}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-3">Answer Options</label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {currentQuestion.answers.map((answer, answerIndex) => (
                      <div key={answerIndex} className="space-y-2">
                        <div className="flex items-center space-x-2">
                          <Badge 
                            variant={currentQuestion.correctAnswer === answerIndex ? "default" : "secondary"}
                            className={`w-8 h-8 rounded-full flex items-center justify-center ${
                              currentQuestion.correctAnswer === answerIndex ? 'bg-green-500' : ''
                            }`}
                          >
                            {String.fromCharCode(65 + answerIndex)}
                          </Badge>
                          <Input
                            value={answer}
                            onChange={(e) => updateAnswer(currentQuestionIndex, answerIndex, e.target.value)}
                            placeholder={`Answer ${String.fromCharCode(65 + answerIndex)}`}
                            className="flex-1"
                          />
                        </div>
                        <div className="ml-10">
                          <label className="flex items-center space-x-2">
                            <input
                              type="radio"
                              name={`correct-answer-${currentQuestionIndex}`}
                              checked={currentQuestion.correctAnswer === answerIndex}
                              onChange={() => updateQuestion(currentQuestionIndex, "correctAnswer", answerIndex)}
                              className="text-green-500"
                            />
                            <span className="text-sm text-gray-600">Correct answer</span>
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Time Limit (seconds)</label>
                  <div className="flex items-center space-x-4">
                    <Input
                      type="number"
                      min="5"
                      max="120"
                      value={currentQuestion.timeLimit}
                      onChange={(e) => updateQuestion(currentQuestionIndex, "timeLimit", parseInt(e.target.value) || 10)}
                      className="w-24"
                    />
                    <div className="flex space-x-2">
                      {[5, 10, 15, 20, 30, 60].map((time) => (
                        <Button
                          key={time}
                          type="button"
                          variant={currentQuestion.timeLimit === time ? "default" : "outline"}
                          size="sm"
                          onClick={() => updateQuestion(currentQuestionIndex, "timeLimit", time)}
                        >
                          {time}s
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="mt-6 flex justify-end space-x-4">
              <Button
                variant="outline"
                onClick={() => setLocation("/")}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={createQuizMutation.isPending}
                className="abraj-primary hover:abraj-secondary text-white"
              >
                {createQuizMutation.isPending ? "Creating..." : "Create Quiz"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}