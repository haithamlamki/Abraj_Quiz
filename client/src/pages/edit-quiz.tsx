import { useState, useEffect } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, Save, ArrowLeft, Clock } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import Navigation from "@/components/navigation";
import { insertQuizSchema } from "@shared/schema";
import { z } from "zod";

const editQuizFormSchema = insertQuizSchema.extend({
  questions: z.array(z.object({
    question: z.string().min(1, "Question is required"),
    answers: z.array(z.string().min(1, "Answer cannot be empty")).length(4, "Each question must have exactly 4 answers"),
    correctAnswer: z.number().min(0).max(3, "Correct answer must be between 0 and 3"),
    timeLimit: z.number().min(10).max(120, "Time limit must be between 10 and 120 seconds")
  })).min(1, "At least one question is required")
});

type EditQuizFormData = z.infer<typeof editQuizFormSchema>;

interface Quiz {
  id: number;
  title: string;
  description: string;
  createdBy: number;
  questions: Array<{
    question: string;
    answers: string[];
    correctAnswer: number;
    timeLimit: number;
  }>;
  isPublic: boolean;
  createdAt: string;
}

export default function EditQuiz() {
  const { quizId } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAuthenticated, isLoading, user } = useAuth();

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      toast({
        title: "Authentication Required",
        description: "Please login to edit quizzes.",
        variant: "destructive",
      });
      setLocation("/login");
    }
  }, [isAuthenticated, isLoading, setLocation, toast]);

  const { data: quiz, isLoading: quizLoading } = useQuery<Quiz>({
    queryKey: ["/api/quizzes", quizId],
    enabled: !!quizId && isAuthenticated,
  });

  const form = useForm<EditQuizFormData>({
    resolver: zodResolver(editQuizFormSchema),
    defaultValues: {
      title: "",
      description: "",
      questions: [],
      isPublic: true
    }
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "questions"
  });

  // Update form when quiz data is loaded
  useEffect(() => {
    if (quiz) {
      // Check if user owns this quiz
      if (quiz.createdBy !== user?.id) {
        toast({
          title: "Access Denied",
          description: "You can only edit your own quizzes.",
          variant: "destructive",
        });
        setLocation("/my-quizzes");
        return;
      }

      form.reset({
        title: quiz.title,
        description: quiz.description,
        questions: quiz.questions,
        isPublic: quiz.isPublic
      });
    }
  }, [quiz, form, user, toast, setLocation]);

  const updateQuizMutation = useMutation({
    mutationFn: async (data: EditQuizFormData) => {
      const response = await apiRequest("PUT", `/api/quizzes/${quizId}`, data);
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Quiz Updated!",
        description: "Your quiz has been updated successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/quizzes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/my-quizzes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quizzes", quizId] });
      setLocation("/my-quizzes");
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update quiz. Please try again.",
        variant: "destructive",
      });
    }
  });

  const addQuestion = () => {
    append({
      question: "",
      answers: ["", "", "", ""],
      correctAnswer: 0,
      timeLimit: 10
    });
  };

  const onSubmit = (data: EditQuizFormData) => {
    updateQuizMutation.mutate(data);
  };

  if (isLoading || quizLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-abraj-primary mx-auto mb-4"></div>
            <p className="text-gray-600">Loading quiz...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  if (!quiz) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center py-12">
          <h1 className="text-2xl font-bold text-gray-800 mb-4">Quiz Not Found</h1>
          <p className="text-gray-600 mb-6">The quiz you're looking for doesn't exist.</p>
          <Button onClick={() => setLocation("/my-quizzes")} className="abraj-primary hover:abraj-secondary text-white">
            Back to My Quizzes
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-4 mb-8">
            <Button
              variant="outline"
              onClick={() => setLocation("/my-quizzes")}
              className="flex items-center gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to My Quizzes
            </Button>
            <div>
              <h1 className="text-3xl font-bold text-gray-800">Edit Quiz</h1>
              <p className="text-gray-600">Update your quiz details and questions</p>
            </div>
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
              <Card className="bg-white shadow-lg">
                <CardHeader>
                  <CardTitle>Quiz Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <FormField
                    control={form.control}
                    name="title"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Quiz Title</FormLabel>
                        <FormControl>
                          <Input placeholder="Enter quiz title" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description (Optional)</FormLabel>
                        <FormControl>
                          <Textarea placeholder="Describe your quiz" {...field} value={field.value || ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="isPublic"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between">
                        <div>
                          <FormLabel>Public Quiz</FormLabel>
                          <p className="text-sm text-gray-600">Make this quiz discoverable by other users</p>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value || false}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>

              <Card className="bg-white shadow-lg">
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>Questions ({fields.length})</CardTitle>
                  <Button
                    type="button"
                    onClick={addQuestion}
                    className="abraj-primary hover:abraj-secondary text-white"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add Question
                  </Button>
                </CardHeader>
                <CardContent className="space-y-6">
                  {fields.length === 0 && (
                    <div className="text-center py-8 text-gray-500">
                      <p className="mb-4">No questions yet. Add your first question to get started!</p>
                      <Button
                        type="button"
                        onClick={addQuestion}
                        variant="outline"
                        className="abraj-primary hover:abraj-secondary text-white"
                      >
                        <Plus className="w-4 h-4 mr-2" />
                        Add First Question
                      </Button>
                    </div>
                  )}

                  {fields.map((field, questionIndex) => (
                    <Card key={field.id} className="p-6 border-2 border-gray-200">
                      <div className="flex items-center justify-between mb-4">
                        <Badge variant="outline" className="text-abraj-primary border-abraj-primary">
                          Question {questionIndex + 1}
                        </Badge>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => remove(questionIndex)}
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>

                      <div className="space-y-4">
                        <FormField
                          control={form.control}
                          name={`questions.${questionIndex}.question`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Question</FormLabel>
                              <FormControl>
                                <Textarea placeholder="Enter your question" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {[0, 1, 2, 3].map((answerIndex) => (
                            <FormField
                              key={answerIndex}
                              control={form.control}
                              name={`questions.${questionIndex}.answers.${answerIndex}`}
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Answer {answerIndex + 1}</FormLabel>
                                  <FormControl>
                                    <Input placeholder={`Answer ${answerIndex + 1}`} {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          ))}
                        </div>

                        <div className="flex gap-4">
                          <FormField
                            control={form.control}
                            name={`questions.${questionIndex}.correctAnswer`}
                            render={({ field }) => (
                              <FormItem className="flex-1">
                                <FormLabel>Correct Answer</FormLabel>
                                <Select onValueChange={(value) => field.onChange(parseInt(value))} value={field.value?.toString()}>
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue placeholder="Select correct answer" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="0">Answer 1</SelectItem>
                                    <SelectItem value="1">Answer 2</SelectItem>
                                    <SelectItem value="2">Answer 3</SelectItem>
                                    <SelectItem value="3">Answer 4</SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name={`questions.${questionIndex}.timeLimit`}
                            render={({ field }) => (
                              <FormItem className="flex-1">
                                <FormLabel className="flex items-center gap-2">
                                  <Clock className="w-4 h-4" />
                                  Time Limit (seconds)
                                </FormLabel>
                                <FormControl>
                                  <Input
                                    type="number"
                                    min="10"
                                    max="120"
                                    placeholder="30"
                                    {...field}
                                    onChange={(e) => field.onChange(parseInt(e.target.value) || 30)}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                      </div>
                    </Card>
                  ))}
                </CardContent>
              </Card>

              <div className="flex justify-end gap-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setLocation("/my-quizzes")}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={updateQuizMutation.isPending || fields.length === 0}
                  className="abraj-primary hover:abraj-secondary text-white"
                >
                  {updateQuizMutation.isPending ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Updating...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4 mr-2" />
                      Update Quiz
                    </>
                  )}
                </Button>
              </div>
            </form>
          </Form>
        </div>
      </div>
    </div>
  );
}