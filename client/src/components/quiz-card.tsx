import { Card } from "@/components/ui/card";
import type { Quiz } from "@shared/schema";

interface QuizCardProps {
  quiz: Quiz;
  onSelect?: (quiz: Quiz) => void;
  className?: string;
}

const cardGradients = [
  "from-purple-500 to-pink-500",
  "from-blue-500 to-cyan-500", 
  "from-green-500 to-teal-500",
  "from-red-500 to-orange-500",
  "from-indigo-500 to-purple-500",
  "from-yellow-500 to-red-500"
];

export default function QuizCard({ quiz, onSelect, className = "" }: QuizCardProps) {
  const gradientClass = cardGradients[quiz.id % cardGradients.length];
  const questions = Array.isArray(quiz.questions) ? quiz.questions : [];
  
  return (
    <Card 
      className={`bg-gradient-to-br ${gradientClass} rounded-2xl p-6 text-white transform hover:scale-105 transition-transform shadow-xl cursor-pointer ${className}`}
      onClick={() => onSelect?.(quiz)}
    >
      <div className="mb-4">
        <div className="rounded-lg w-full h-32 bg-white/20 backdrop-blur-sm flex items-center justify-center text-4xl">
          🧠
        </div>
      </div>
      
      <h3 className="font-bold text-xl mb-2">{quiz.title}</h3>
      <p className="text-sm opacity-90 mb-4 line-clamp-2">{quiz.description}</p>
      
      <div className="flex justify-between items-center text-sm">
        <span>{questions.length} questions</span>
        <span>Public</span>
      </div>
    </Card>
  );
}
