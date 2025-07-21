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
          <div className="flex justify-center">
            {/* Centered Content */}
            <div className="text-center max-w-4xl">
              <h1 className="font-bold text-5xl lg:text-6xl text-gray-800 leading-tight">
                Make Learning
                <span className="bg-clip-text bg-gradient-to-r from-abraj-primary to-abraj-secondary text-[#019ebd]">
                  {" "}Awesome!
                </span>
              </h1>
              <p className="mt-6 text-xl text-gray-600 max-w-2xl mx-auto">
                Abraj Quiz makes it easy to create, share and play learning games or trivia quizzes in minutes.
              </p>
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
