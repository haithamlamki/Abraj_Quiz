import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import QuizCard from "@/components/quiz-card";
import { Trophy, Clock, Image, Users, BarChart } from "lucide-react";
import type { Quiz } from "@shared/schema";

export default function Home() {
  const [gamePin, setGamePin] = useState("");
  const [, setLocation] = useLocation();

  const { data: quizzes = [], isLoading } = useQuery<Quiz[]>({
    queryKey: ["/api/quizzes"]
  });

  const handleJoinGame = () => {
    if (gamePin.trim()) {
      setLocation(`/join/${gamePin.trim()}`);
    }
  };

  const handleSelectQuiz = (quiz: Quiz) => {
    // For now, just navigate to create page - could be extended to show quiz details
    console.log("Selected quiz:", quiz);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-100 via-purple-50 to-pink-100">
      {/* Hero Section */}
      <section className="relative overflow-hidden py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            
            {/* Left Content */}
            <div className="text-center lg:text-left">
              <h1 className="font-bold text-5xl lg:text-6xl text-gray-800 leading-tight">
                Make Learning
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-kahoot-purple to-kahoot-blue">
                  {" "}Awesome!
                </span>
              </h1>
              <p className="mt-6 text-xl text-gray-600 max-w-lg">
                Kahoot! makes it easy to create, share and play learning games or trivia quizzes in minutes.
              </p>
              
              {/* Game PIN Entry */}
              <Card className="mt-8 shadow-xl border border-gray-100">
                <CardContent className="p-8">
                  <h3 className="font-bold text-2xl text-gray-800 mb-4">Join a game</h3>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <Input
                      type="text"
                      placeholder="Game PIN"
                      value={gamePin}
                      onChange={(e) => setGamePin(e.target.value)}
                      className="flex-1 px-4 py-3 border-2 border-gray-200 rounded-xl text-lg font-medium text-center focus:border-kahoot-purple"
                      onKeyPress={(e) => e.key === 'Enter' && handleJoinGame()}
                    />
                    <Button 
                      onClick={handleJoinGame}
                      className="kahoot-purple hover:bg-purple-600 text-white px-8 py-3 rounded-xl font-bold text-lg shadow-lg"
                    >
                      Enter
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
            
            {/* Right Content - Featured Image */}
            <div className="relative">
              <img 
                src="https://images.unsplash.com/photo-1522202176988-66273c2fd55f?ixlib=rb-4.0.3&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=800&h=600" 
                alt="Students engaged in interactive quiz competition" 
                className="rounded-2xl shadow-2xl w-full h-auto transform rotate-2 hover:rotate-0 transition-transform duration-300"
              />
              <div className="absolute -top-4 -right-4 kahoot-green text-white w-16 h-16 rounded-full flex items-center justify-center font-bold text-2xl animate-bounce-gentle">
                <Trophy className="w-8 h-8" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Quick Actions */}
      <section className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="font-bold text-4xl text-gray-800 mb-4">Get Started</h2>
            <p className="text-xl text-gray-600">Create your quiz in minutes with our intuitive editor</p>
          </div>
          
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Quick Create Preview */}
            <div className="bg-gradient-to-br from-purple-50 to-blue-50 rounded-2xl p-8 shadow-xl">
              <div className="bg-white rounded-xl p-6 shadow-lg">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="font-bold text-xl text-gray-800">Create New Quiz</h3>
                  <div className="kahoot-blue text-white px-3 py-1 rounded-full text-sm font-medium">
                    Quick Start
                  </div>
                </div>
                
                <div className="space-y-4">
                  <Input placeholder="Quiz Title" className="w-full" />
                  <Input placeholder="Description" className="w-full" />
                  
                  <div className="grid grid-cols-2 gap-3">
                    <div className="kahoot-red text-white p-4 rounded-lg text-center font-bold">
                      A
                    </div>
                    <div className="kahoot-blue text-white p-4 rounded-lg text-center font-bold">
                      B
                    </div>
                    <div className="kahoot-green text-white p-4 rounded-lg text-center font-bold">
                      C
                    </div>
                    <div className="kahoot-orange text-white p-4 rounded-lg text-center font-bold">
                      D
                    </div>
                  </div>
                  
                  <Link href="/create">
                    <Button className="w-full kahoot-purple hover:bg-purple-600 text-white font-bold">
                      Start Creating
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
            
            {/* Features Grid */}
            <div className="space-y-6">
              <img 
                src="https://images.unsplash.com/photo-1611224923853-80b023f02d71?ixlib=rb-4.0.3&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=800&h=400" 
                alt="Colorful user interface elements and design components" 
                className="rounded-xl shadow-lg w-full h-48 object-cover"
              />
              
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gradient-to-br from-kahoot-purple to-purple-600 text-white p-6 rounded-xl">
                  <Clock className="w-8 h-8 mb-2" />
                  <h4 className="font-bold">Time Limits</h4>
                  <p className="text-sm opacity-90">Set custom timers</p>
                </div>
                
                <div className="bg-gradient-to-br from-kahoot-green to-green-600 text-white p-6 rounded-xl">
                  <Image className="w-8 h-8 mb-2" />
                  <h4 className="font-bold">Rich Media</h4>
                  <p className="text-sm opacity-90">Add images & videos</p>
                </div>
                
                <div className="bg-gradient-to-br from-kahoot-blue to-blue-600 text-white p-6 rounded-xl">
                  <Users className="w-8 h-8 mb-2" />
                  <h4 className="font-bold">Team Mode</h4>
                  <p className="text-sm opacity-90">Collaborative play</p>
                </div>
                
                <div className="bg-gradient-to-br from-kahoot-red to-red-600 text-white p-6 rounded-xl">
                  <BarChart className="w-8 h-8 mb-2" />
                  <h4 className="font-bold">Analytics</h4>
                  <p className="text-sm opacity-90">Track performance</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Popular Quizzes */}
      <section className="py-16 bg-gradient-to-br from-gray-50 to-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="font-bold text-4xl text-gray-800 mb-4">Discover Popular Quizzes</h2>
            <p className="text-xl text-gray-600">Join millions of learners worldwide</p>
          </div>
          
          {isLoading ? (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="bg-gray-200 animate-pulse rounded-2xl h-64"></div>
              ))}
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
              {quizzes.slice(0, 6).map((quiz) => (
                <QuizCard 
                  key={quiz.id} 
                  quiz={quiz} 
                  onSelect={handleSelectQuiz}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-4 gap-8">
            <div>
              <div className="flex items-center space-x-2 mb-4">
                <div className="kahoot-purple text-white w-8 h-8 rounded-lg flex items-center justify-center font-bold">
                  K
                </div>
                <span className="font-bold text-xl">Kahoot!</span>
              </div>
              <p className="text-gray-400 text-sm">
                Making learning awesome for millions of people around the world.
              </p>
            </div>
            
            <div>
              <h4 className="font-bold text-lg mb-4">Platform</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><Link href="/create"><a className="hover:text-white transition-colors">Create</a></Link></li>
                <li><Link href="/join"><a className="hover:text-white transition-colors">Play</a></Link></li>
                <li><Link href="/"><a className="hover:text-white transition-colors">Discover</a></Link></li>
              </ul>
            </div>
            
            <div>
              <h4 className="font-bold text-lg mb-4">Resources</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><a href="#" className="hover:text-white transition-colors">Help Center</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Blog</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Community</a></li>
              </ul>
            </div>
            
            <div>
              <h4 className="font-bold text-lg mb-4">Connect</h4>
              <div className="flex space-x-4">
                <a href="#" className="bg-gray-800 hover:kahoot-purple w-10 h-10 rounded-lg flex items-center justify-center transition-colors">
                  <span className="text-sm">𝕏</span>
                </a>
                <a href="#" className="bg-gray-800 hover:kahoot-purple w-10 h-10 rounded-lg flex items-center justify-center transition-colors">
                  <span className="text-sm">f</span>
                </a>
              </div>
            </div>
          </div>
          
          <div className="border-t border-gray-800 mt-8 pt-8 text-center text-sm text-gray-400">
            <p>&copy; 2024 Kahoot! Clone. All rights reserved. Built for educational purposes.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
