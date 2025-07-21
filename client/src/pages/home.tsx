import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Trophy, Clock, Image, Users, BarChart } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

export default function Home() {
  const [gamePin, setGamePin] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [, setLocation] = useLocation();
  const { user, isAuthenticated } = useAuth();

  // Auto-fill player name if user is authenticated
  useEffect(() => {
    if (isAuthenticated && user && !playerName) {
      setPlayerName(user.username);
    }
  }, [isAuthenticated, user, playerName]);

  const handleJoinGame = () => {
    if (gamePin.trim()) {
      if (playerName.trim()) {
        setLocation(`/play/${gamePin.trim()}?player=${encodeURIComponent(playerName.trim())}`);
      } else {
        setLocation(`/join/${gamePin.trim()}`);
      }
    }
  };

  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <section className="relative overflow-hidden py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto text-center">
            
            {/* Main Content */}
            <div>
              <h1 className="font-bold text-5xl lg:text-6xl leading-tight" style={{color: 'var(--abraj-primary)'}}>
                Make Learning Awesome!
              </h1>
              <p className="mt-6 text-xl text-gray-600 max-w-2xl mx-auto">
                Abraj Quiz makes it easy to create, share and play learning games or trivia quizzes in minutes.
              </p>
              
              {/* Game PIN Entry */}
              <Card className="mt-8 shadow-xl border border-gray-100 max-w-lg mx-auto">
                <CardContent className="p-8">
                  <h3 className="font-bold text-2xl text-gray-800 mb-4">Join a game</h3>
                  <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row gap-3">
                      <Input
                        type="text"
                        placeholder="Game PIN"
                        value={gamePin}
                        onChange={(e) => setGamePin(e.target.value)}
                        className="flex-1 px-4 py-3 border-2 border-gray-200 rounded-xl text-lg font-medium text-center focus:border-abraj-primary"
                        onKeyPress={(e) => e.key === 'Enter' && handleJoinGame()}
                      />
                    </div>
                    <div className="flex flex-col sm:flex-row gap-3">
                      <Input
                        type="text"
                        placeholder={isAuthenticated && user ? user.username : "Player name"}
                        value={playerName}
                        onChange={(e) => setPlayerName(e.target.value)}
                        className="flex-1 px-4 py-3 border-2 border-gray-200 rounded-xl text-lg font-medium text-center focus:border-abraj-primary"
                        maxLength={20}
                        onKeyPress={(e) => e.key === 'Enter' && handleJoinGame()}
                      />
                      <Button 
                        onClick={handleJoinGame}
                        className="abraj-primary hover:abraj-secondary text-white px-8 py-3 rounded-xl font-bold text-lg shadow-lg"
                      >
                        Join Game
                      </Button>
                    </div>
                    {isAuthenticated && user && (
                      <p className="text-xs text-abraj-primary text-center">
                        Your name is auto-filled from your account
                      </p>
                    )}
                    {!isAuthenticated && (
                      <p className="text-xs text-gray-500 text-center">
                        <Link href="/login" className="text-abraj-primary hover:underline">Login</Link>
                        {" "}to auto-fill your name
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
            
            
          </div>
        </div>
      </section>
      {/* Quick Actions */}
      <section className="py-16 bg-[#ffffff00]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="font-bold text-4xl text-gray-800 mb-4">Get Started</h2>
            <p className="text-xl text-gray-600">Create your quiz in minutes with our intuitive editor</p>
          </div>
          
          <div className="max-w-5xl mx-auto">
            {/* Quick Create Preview - Centered */}
            <div className="bg-gradient-to-br from-purple-50 to-blue-50 rounded-2xl p-8 shadow-xl max-w-md mx-auto mb-12">
              <div className="bg-white rounded-xl p-6 shadow-lg">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="font-bold text-xl text-gray-800">Create New Quiz</h3>
                  <div className="abraj-blue text-white px-3 py-1 rounded-full text-sm font-medium">
                    Quick Start
                  </div>
                </div>
                
                <div className="space-y-4">
                  <Input placeholder="Quiz Title" className="w-full" />
                  <Input placeholder="Description" className="w-full" />
                  
                  <div className="grid grid-cols-2 gap-3">
                    <div className="abraj-red text-white p-4 rounded-lg text-center font-bold">
                      A
                    </div>
                    <div className="abraj-blue text-white p-4 rounded-lg text-center font-bold">
                      B
                    </div>
                    <div className="abraj-green text-white p-4 rounded-lg text-center font-bold">
                      C
                    </div>
                    <div className="abraj-orange text-white p-4 rounded-lg text-center font-bold">
                      D
                    </div>
                  </div>
                  
                  <Link href="/create">
                    <Button className="w-full abraj-primary hover:abraj-secondary text-white font-bold">
                      Start Creating
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
            
            {/* Features Grid - Horizontal */}
            <div className="max-w-6xl mx-auto">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-gradient-to-br from-abraj-primary to-teal-600 p-6 rounded-xl text-center text-[#029ebd]">
                  <Clock className="w-8 h-8 mb-2 mx-auto" />
                  <h4 className="font-bold">Time Limits</h4>
                  <p className="text-sm opacity-90">Set custom timers</p>
                </div>
                
                <div className="bg-gradient-to-br from-abraj-green to-green-600 p-6 rounded-xl text-center text-[#019ebd]">
                  <Image className="w-8 h-8 mb-2 mx-auto" />
                  <h4 className="font-bold">Rich Media</h4>
                  <p className="text-sm opacity-90">Add images & videos</p>
                </div>
                
                <div className="bg-gradient-to-br from-abraj-blue to-blue-600 p-6 rounded-xl text-center text-[#019ebd]">
                  <Users className="w-8 h-8 mb-2 mx-auto" />
                  <h4 className="font-bold">Team Mode</h4>
                  <p className="text-sm opacity-90">Collaborative play</p>
                </div>
                
                <div className="bg-gradient-to-br from-abraj-red to-red-600 p-6 rounded-xl text-center text-[#019ebd]">
                  <BarChart className="w-8 h-8 mb-2 mx-auto" />
                  <h4 className="font-bold">Analytics</h4>
                  <p className="text-sm opacity-90">Track performance</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
      {/* Footer */}
      <footer className="bg-gray-900 text-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-4 gap-8">
            <div>
              <div className="flex items-center space-x-2 mb-4">
                <span className="font-bold text-xl">Abraj Quiz</span>
              </div>
              <p className="text-gray-400 text-sm">
                Making learning awesome for millions of people around the world.
              </p>
            </div>
            
            <div>
              <h4 className="font-bold text-lg mb-4">Platform</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><Link href="/create" className="hover:text-white transition-colors">Create</Link></li>
                <li><Link href="/join" className="hover:text-white transition-colors">Play</Link></li>
                <li><Link href="/" className="hover:text-white transition-colors">Discover</Link></li>
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
                <a href="#" className="bg-gray-800 hover:abraj-primary w-10 h-10 rounded-lg flex items-center justify-center transition-colors">
                  <span className="text-sm">𝕏</span>
                </a>
                <a href="#" className="bg-gray-800 hover:abraj-primary w-10 h-10 rounded-lg flex items-center justify-center transition-colors">
                  <span className="text-sm">f</span>
                </a>
              </div>
            </div>
          </div>
          
          <div className="border-t border-gray-800 mt-8 pt-8 text-center text-sm text-gray-400">
            <p>&copy; 2024 Abraj Quiz. All rights reserved. Built for educational purposes.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
