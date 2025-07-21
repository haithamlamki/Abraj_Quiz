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
              <Card className="mt-8 card-3d max-w-lg mx-auto">
                <CardContent className="p-8">
                  <h3 className="font-bold text-2xl text-gray-800 mb-4">Join a game</h3>
                  <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row gap-3">
                      <Input
                        type="text"
                        placeholder="Game PIN"
                        value={gamePin}
                        onChange={(e) => setGamePin(e.target.value)}
                        className="flex-1 px-4 py-3 rounded-xl text-lg font-medium text-center input-3d"
                        onKeyPress={(e) => e.key === 'Enter' && handleJoinGame()}
                      />
                    </div>
                    <div className="flex flex-col sm:flex-row gap-3">
                      <Input
                        type="text"
                        placeholder={isAuthenticated && user ? user.username : "Player name"}
                        value={playerName}
                        onChange={(e) => setPlayerName(e.target.value)}
                        className="flex-1 px-4 py-3 rounded-xl text-lg font-medium text-center input-3d"
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
            <div className="bg-gradient-to-br from-purple-50 to-blue-50 rounded-2xl p-8 card-3d max-w-md mx-auto mb-12">
              <div className="bg-white rounded-xl p-6 card-3d">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="font-bold text-xl text-gray-800">Create New Quiz</h3>
                  <div className="abraj-blue text-white px-3 py-1 rounded-full text-sm font-medium">
                    Quick Start
                  </div>
                </div>
                
                <div className="space-y-4">
                  <Input placeholder="Quiz Title" className="w-full input-3d" />
                  <Input placeholder="Description" className="w-full input-3d" />
                  
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
                    <Button className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 bg-primary hover:bg-primary/90 h-10 px-4 py-2 w-full abraj-primary hover:abraj-secondary text-white font-bold pt-[2px] pb-[2px] pl-[13px] pr-[13px] mt-[14px] mb-[14px]">
                      Start Creating
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
            
            {/* Features Grid - Horizontal */}
            <div className="max-w-6xl mx-auto">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-transparent p-6 rounded-xl text-center card-3d text-[#019ebd]">
                  <Clock className="w-8 h-8 mb-2 mx-auto" />
                  <h4 className="font-bold">Time Limits</h4>
                  <p className="text-sm opacity-90">Set custom timers</p>
                </div>
                
                <div className="bg-transparent p-6 rounded-xl text-center card-3d text-[#019ebd]">
                  <Image className="w-8 h-8 mb-2 mx-auto" />
                  <h4 className="font-bold">Rich Media</h4>
                  <p className="text-sm opacity-90">Add images & videos</p>
                </div>
                
                <div className="bg-transparent p-6 rounded-xl text-center card-3d text-[#019ebd]">
                  <Users className="w-8 h-8 mb-2 mx-auto" />
                  <h4 className="font-bold">Team Mode</h4>
                  <p className="text-sm opacity-90">Collaborative play</p>
                </div>
                
                <div className="bg-transparent p-6 rounded-xl text-center card-3d text-[#019ebd]">
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
      <footer className="bg-gray-900 text-white py-4">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center text-sm text-gray-400">
            <p>© 2025 Abraj Quiz. All rights reserved. Built for educational purposes.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
