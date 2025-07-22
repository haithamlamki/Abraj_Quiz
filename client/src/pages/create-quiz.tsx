import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2, Triangle, Diamond, Circle, Square } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import type { Question } from "@shared/schema";

interface QuizForm {
  title: string;
  description: string;
  questions: Question[];
}

const answerIcons = [Triangle, Diamond, Circle, Square];
const answerColors = ['abraj-red', 'abraj-blue', 'abraj-green', 'abraj-yellow'];

export default function CreateQuiz() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAuthenticated, isLoading } = useAuth();

  // All hooks must be called before any conditional returns
  const [quiz, setQuiz] = useState<QuizForm>({
    title: "",
    description: "",
    questions: [
      {
        question: "",
        answers: ["", "", "", ""],
        correctAnswer: 0,
        timeLimit: 10
      }
    ]
  });

  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      toast({
        title: "Authentication Required",
        description: "Please login to create quizzes.",
        variant: "destructive",
      });
      setLocation("/login");
    }
  }, [isAuthenticated, isLoading, setLocation, toast]);

  // Show loading while checking authentication
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

  // Don't render the form if not authenticated
  if (!isAuthenticated) {
    return null;
  }

  const createQuizMutation = useMutation({
    mutationFn: async (quizData: QuizForm) => {
      const payload = {
        title: quizData.title,
        description: quizData.description,
        questions: quizData.questions,
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

  const currentQuestion = quiz.questions[currentQuestionIndex];

  return (
    <div className="min-h-screen py-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-8">
          <h1 className="font-bold text-4xl text-gray-800 mb-4">Create Your Quiz</h1>
          <p className="text-xl text-gray-600">Build engaging quizzes in minutes</p>
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
                    placeholder="Describe your quiz"
                    rows={3}
                  />
                </div>

                <div className="text-center">
                  <span className="text-sm text-gray-600">
                    {quiz.questions.length} question{quiz.questions.length !== 1 ? 's' : ''}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Question Navigation */}
            <Card>
              <CardHeader>
                <CardTitle>Questions</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {quiz.questions.map((q, index) => (
                    <div
                      key={index}
                      className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors ${
                        index === currentQuestionIndex 
                          ? 'bg-teal-100 border-2 border-abraj-primary' 
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
                          className="text-red-500 hover:text-red-700"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Question Editor */}
          <div className="lg:col-span-2">
            <Card>
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
                    className="text-lg"
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
                          className={`${colorClass} text-white p-4 rounded-lg cursor-pointer hover:scale-105 transition-transform`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-bold">{String.fromCharCode(65 + answerIndex)}</span>
                            <IconComponent className="w-5 h-5" />
                          </div>
                          <Input
                            value={answer}
                            onChange={(e) => updateAnswer(currentQuestionIndex, answerIndex, e.target.value)}
                            placeholder={`Answer ${String.fromCharCode(65 + answerIndex)}`}
                            className="w-full bg-transparent border-none text-white placeholder:text-white/70 focus:outline-none"
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
                      className="border border-gray-300 rounded-md px-3 py-1"
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
                  <Button onClick={addQuestion} size="sm" className="abraj-primary">
                    <Plus className="w-4 h-4 mr-1" />
                    Add Question
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Submit */}
            <div className="mt-8 flex justify-center">
              <Button
                onClick={handleSubmit}
                disabled={createQuizMutation.isPending}
                className="abraj-primary hover:abraj-secondary text-white px-8 py-3 text-lg font-bold"
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
