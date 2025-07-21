import { useState, useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { QrCode, X } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";

export default function JoinGame() {
  const { pin: urlPin } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user, isAuthenticated } = useAuth();
  
  const [gamePin, setGamePin] = useState(urlPin || "");
  const [playerName, setPlayerName] = useState("");
  const [step, setStep] = useState<"pin" | "name">(urlPin ? "name" : "pin");
  const [showScanner, setShowScanner] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Auto-fill player name if user is authenticated
  useEffect(() => {
    if (isAuthenticated && user && !playerName) {
      setPlayerName(user.username);
    }
  }, [isAuthenticated, user, playerName]);

  // Camera access and QR scanning functions
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

  const handleVideoClick = () => {
    // Simulate QR code detection when user taps the video area
    const scannedPin = prompt("For demo: Enter the game PIN from the QR code you're scanning:");
    
    if (scannedPin && scannedPin.trim()) {
      setGamePin(scannedPin.trim());
      setShowScanner(false);
      stopCamera();
      toast({
        title: "QR Code Scanned!",
        description: `Game PIN ${scannedPin.trim()} has been entered.`,
      });
    }
  };

  const handleScanClick = () => {
    setShowScanner(true);
  };

  const handleCloseScanner = () => {
    setShowScanner(false);
    stopCamera();
  };

  // Start scanning when camera is ready
  useEffect(() => {
    if (showScanner && videoRef.current) {
      startCamera();
      return () => {
        stopCamera();
      };
    }
  }, [showScanner]);

  const checkGameMutation = useMutation({
    mutationFn: async (pin: string) => {
      const response = await apiRequest("GET", `/api/games/${pin}`, {});
      return response.json();
    },
    onSuccess: () => {
      setStep("name");
    },
    onError: () => {
      toast({
        title: "Game Not Found",
        description: "Please check the game PIN and try again.",
        variant: "destructive",
      });
    }
  });

  const joinGameMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/games/${gamePin}/join`, {
        playerName: playerName.trim()
      });
      return response.json();
    },
    onSuccess: () => {
      setLocation(`/play/${gamePin}?player=${encodeURIComponent(playerName.trim())}`);
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Join",
        description: error.message || "Unable to join the game. Please try again.",
        variant: "destructive",
      });
    }
  });

  const handlePinSubmit = () => {
    if (!gamePin.trim()) {
      toast({
        title: "Invalid PIN",
        description: "Please enter a valid game PIN.",
        variant: "destructive",
      });
      return;
    }
    checkGameMutation.mutate(gamePin.trim());
  };

  const handleNameSubmit = () => {
    if (!playerName.trim()) {
      toast({
        title: "Invalid Name",
        description: "Please enter your name.",
        variant: "destructive",
      });
      return;
    }
    joinGameMutation.mutate();
  };

  return (
    <div className="min-h-screen flex items-center justify-center py-8">
      <div className="max-w-md w-full mx-4">
        {step === "pin" ? (
          <Card className="shadow-2xl">
            <CardHeader>
              <CardTitle className="text-center text-2xl">Join a Game</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="text-center">
                <img 
                  src="https://images.unsplash.com/photo-1434030216411-0b793f4b4173?ixlib=rb-4.0.3&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=400&h=200" 
                  alt="Students actively using mobile devices to participate in quiz" 
                  className="rounded-lg w-full h-32 object-cover mb-4"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Game PIN
                </label>
                <div className="flex gap-2">
                  <Input
                    type="text"
                    value={gamePin}
                    onChange={(e) => setGamePin(e.target.value)}
                    placeholder="Enter Game PIN"
                    className="text-center text-2xl font-bold flex-1"
                    onKeyPress={(e) => e.key === 'Enter' && handlePinSubmit()}
                    autoFocus
                  />
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button
                        variant="outline"
                        onClick={handleScanClick}
                        className="px-4 py-3 text-lg font-medium"
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
              </div>
              
              <Button
                onClick={handlePinSubmit}
                disabled={checkGameMutation.isPending}
                className="w-full abraj-primary hover:abraj-secondary text-white font-bold text-lg py-3 rounded-xl shadow-lg"
              >
                {checkGameMutation.isPending ? "Checking..." : "Continue"}
              </Button>
              
              <div className="text-center">
                <Button
                  variant="ghost"
                  onClick={() => setLocation("/")}
                  className="text-gray-500"
                >
                  Back to Home
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="shadow-2xl">
            <CardHeader>
              <CardTitle className="text-center text-2xl">Enter Your Name</CardTitle>
              <p className="text-center text-gray-600">Game PIN: {gamePin}</p>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="text-center">
                <div className="abraj-primary text-white w-20 h-20 rounded-full flex items-center justify-center font-bold text-3xl mx-auto mb-4">
                  {playerName.charAt(0).toUpperCase() || "?"}
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Your Name
                  {isAuthenticated && user && (
                    <span className="text-abraj-primary text-xs ml-2">
                      (Auto-filled from your account)
                    </span>
                  )}
                </label>
                <Input
                  type="text"
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  placeholder={isAuthenticated && user ? user.username : "Enter your name"}
                  className="text-center text-xl font-medium px-4 py-3 rounded-xl input-3d"
                  maxLength={20}
                  onKeyPress={(e) => e.key === 'Enter' && handleNameSubmit()}
                  autoFocus
                />
                {isAuthenticated && user && (
                  <p className="text-xs text-abraj-primary text-center mt-2">
                    Your name is auto-filled from your account
                  </p>
                )}
                {!isAuthenticated && (
                  <p className="text-xs text-gray-500 mt-2 text-center">
                    <Button
                      variant="link"
                      onClick={() => setLocation("/login")}
                      className="text-abraj-primary p-0 h-auto text-xs hover:underline"
                    >
                      Login
                    </Button>
                    {" "}to auto-fill your name
                  </p>
                )}
              </div>
              
              <Button
                onClick={handleNameSubmit}
                disabled={joinGameMutation.isPending}
                className="w-full abraj-green hover:bg-green-600 text-white font-bold text-lg py-3 rounded-xl shadow-lg"
              >
                {joinGameMutation.isPending ? "Joining..." : "Join Game"}
              </Button>
              
              <div className="text-center">
                <Button
                  variant="ghost"
                  onClick={() => setStep("pin")}
                  className="text-gray-500"
                >
                  Change PIN
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
