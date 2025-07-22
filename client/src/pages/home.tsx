import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Trophy, Clock, Image, Users, BarChart, BookOpen, Play, QrCode, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

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

export default function Home() {
  const [gamePin, setGamePin] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [showScanner, setShowScanner] = useState(false);
  const [, setLocation] = useLocation();
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Fetch user's quizzes when authenticated
  const { data: userQuizzes } = useQuery<Quiz[]>({
    queryKey: ["/api/my-quizzes"],
    enabled: isAuthenticated,
  });

  // Auto-fill player name if user is authenticated
  useEffect(() => {
    if (isAuthenticated && user && !playerName) {
      setPlayerName(user.username);
    }
  }, [isAuthenticated, user, playerName]);

  // Camera access and QR scanning
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } // Use back camera if available
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
    } catch (error) {
      toast({
        title: "Camera Access Failed",
        description: "Please allow camera access to scan QR codes.",
        variant: "destructive",
      });
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
  };

  // Simple QR code detection function
  // In production, you would use a proper QR library like jsQR
  const scanQRCode = () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');

    if (!context || video.videoWidth === 0 || video.videoHeight === 0) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    // For demonstration, we'll check if user clicks the video area to simulate scanning
    // In a real app, you'd integrate with jsQR or similar library
  };

  const handleVideoClick = () => {
    // Simulate QR code detection when user taps the video area
    const currentUrl = window.location.origin;
    const gamePin = prompt("For demo: Enter the game PIN from the QR code you're scanning:");
    
    if (gamePin && gamePin.trim()) {
      setGamePin(gamePin.trim());
      setShowScanner(false);
      stopCamera();
      toast({
        title: "QR Code Scanned!",
        description: `Game PIN ${gamePin.trim()} has been entered.`,
      });
    }
  };

  // Start scanning when camera is ready
  useEffect(() => {
    if (showScanner && videoRef.current) {
      startCamera();
      const interval = setInterval(scanQRCode, 500); // Scan every 500ms
      return () => {
        clearInterval(interval);
        stopCamera();
      };
    }
  }, [showScanner]);

  const handleScanClick = () => {
    setShowScanner(true);
  };

  const handleCloseScanner = () => {
    setShowScanner(false);
    stopCamera();
  };

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
                      <Dialog open={showScanner} onOpenChange={setShowScanner}>
                        <DialogTrigger asChild>
                          <Button
                            variant="outline"
                            onClick={handleScanClick}
                            className="px-4 py-3 rounded-xl text-lg font-medium"
                            title="Scan QR Code"
                          >
                            <QrCode className="w-6 h-6" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-md">
                          <DialogHeader>
                            <DialogTitle className="text-center flex items-center gap-2 justify-center">
                              <QrCode className="w-5 h-5" />
                              Scan QR Code
                            </DialogTitle>
                          </DialogHeader>
                          <div className="flex flex-col items-center space-y-4 p-4">
                            <div className="relative bg-black rounded-lg overflow-hidden cursor-pointer" onClick={handleVideoClick}>
                              <video
                                ref={videoRef}
                                className="w-64 h-64 object-cover"
                                autoPlay
                                playsInline
                                muted
                              />
                              <canvas
                                ref={canvasRef}
                                className="hidden"
                              />
                              <div className="absolute inset-0 border-2 border-white/50 m-8 pointer-events-none">
                                <div className="absolute top-0 left-0 w-8 h-8 border-l-4 border-t-4 border-abraj-primary"></div>
                                <div className="absolute top-0 right-0 w-8 h-8 border-r-4 border-t-4 border-abraj-primary"></div>
                                <div className="absolute bottom-0 left-0 w-8 h-8 border-l-4 border-b-4 border-abraj-primary"></div>
                                <div className="absolute bottom-0 right-0 w-8 h-8 border-r-4 border-b-4 border-abraj-primary"></div>
                              </div>
                              <div className="absolute bottom-2 left-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded pointer-events-none">
                                Tap to scan QR code (Demo)
                              </div>
                            </div>
                            <div className="text-center">
                              <p className="text-sm text-gray-600 mb-2">Point your camera at a QR code and tap to scan</p>
                              <p className="text-xs text-gray-500">The game PIN will be automatically entered</p>
                            </div>
                            <Button
                              variant="outline"
                              onClick={handleCloseScanner}
                              className="w-full"
                            >
                              <X className="w-4 h-4 mr-2" />
                              Cancel
                            </Button>
                          </div>
                        </DialogContent>
                      </Dialog>
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
            {/* Show Recent Quizzes for authenticated users, Create Quiz for others */}
            {isAuthenticated && userQuizzes && userQuizzes.length > 0 ? (
              <div className="mb-12">
                <div className="text-center mb-6">
                  <h3 className="font-bold text-2xl text-gray-800 mb-4">Your Recent Quizes</h3>
                  <Link href="/create">
                    <Button className="abraj-primary hover:abraj-secondary text-white font-medium">
                      Create New Quiz
                    </Button>
                  </Link>
                </div>
                
                <div className="flex flex-wrap justify-center gap-4">
                  {userQuizzes.slice(0, 4).map((quiz) => (
                    <Card key={quiz.id} className="bg-white shadow-lg hover:shadow-xl transition-shadow duration-300 card-3d w-72 flex-shrink-0">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-lg font-bold text-gray-800 line-clamp-2">
                          {quiz.title}
                        </CardTitle>
                        <p className="text-sm text-gray-600 line-clamp-2">
                          {quiz.description}
                        </p>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <div className="flex items-center justify-between text-sm text-gray-500 mb-3">
                          <span className="flex items-center gap-1">
                            <BookOpen className="w-4 h-4" />
                            {quiz.questions.length} questions
                          </span>
                          <span className={`px-2 py-1 rounded-full text-xs ${
                            quiz.isPublic ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                          }`}>
                            {quiz.isPublic ? 'Public' : 'Private'}
                          </span>
                        </div>
                        <Link href={`/host-quiz/${quiz.id}`}>
                          <Button className="w-full abraj-primary hover:abraj-secondary text-white font-medium">
                            <Play className="w-4 h-4 mr-2" />
                            Host Quiz
                          </Button>
                        </Link>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            ) : (
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
                      <div className="abraj-yellow text-white p-4 rounded-lg text-center font-bold">
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
            )}
            
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
      <footer className="py-4 bg-[#11182700] text-[#0f0000]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center text-sm text-gray-400">
            <p>© 2025 Abraj Quiz. All rights reserved. Built for educational purposes by Haitham Al-Lamki.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
