import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { PlusCircle, BookOpen, Gamepad2 } from "lucide-react";
import abrajLogo from "@assets/ABRJ.OM - Copy_1753085299475.png";

export default function Navigation() {
  const [location] = useLocation();
  const { user, isAuthenticated, logout, isLoggingOut } = useAuth();
  const { toast } = useToast();

  return (
    <nav className="bg-white shadow-lg border-b-4 border-abraj-primary sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center space-x-4">
            <Link href="/">
              <div className="flex items-center space-x-3 cursor-pointer">
                <img 
                  src={abrajLogo} 
                  alt="Abraj Quiz Logo" 
                  className="w-10 h-10 object-contain"
                />
                <h1 className="font-bold text-2xl text-gray-800">Abraj Quiz</h1>
              </div>
            </Link>
          </div>
          
          <div className="hidden md:block">
            <div className="ml-10 flex items-center space-x-6">
              <Link href="/create">
                <span className={`px-4 py-3 rounded-md text-lg font-medium transition-colors cursor-pointer flex items-center space-x-2 ${
                  location === '/create' 
                    ? 'text-abraj-primary bg-teal-50' 
                    : 'text-gray-700 hover:text-abraj-primary'
                }`}>
                  <PlusCircle className="w-8 h-8" />
                  <span>Create</span>
                </span>
              </Link>
              {isAuthenticated && (
                <Link href="/my-quizzes">
                  <span className={`px-4 py-3 rounded-md text-lg font-medium transition-colors cursor-pointer flex items-center space-x-2 ${
                    location === '/my-quizzes' 
                      ? 'text-abraj-primary bg-teal-50' 
                      : 'text-gray-700 hover:text-abraj-primary'
                  }`}>
                    <BookOpen className="w-8 h-8" />
                    <span>My Quizes</span>
                  </span>
                </Link>
              )}
              <Link href="/join">
                <span className={`px-4 py-3 rounded-md text-lg font-medium transition-colors cursor-pointer flex items-center space-x-2 ${
                  location.startsWith('/join') 
                    ? 'text-abraj-primary bg-teal-50' 
                    : 'text-gray-700 hover:text-abraj-primary'
                }`}>
                  <Gamepad2 className="w-8 h-8" />
                  <span>Play</span>
                </span>
              </Link>
            </div>
          </div>
          
          <div className="flex items-center space-x-3">
            {isAuthenticated ? (
              <>
                <span className="text-sm text-gray-600 hidden sm:block">
                  Welcome, <span className="font-medium text-abraj-primary">{user?.username}</span>
                </span>
                <Button 
                  variant="outline" 
                  className="text-abraj-primary border-abraj-primary hover:abraj-primary hover:text-white font-medium"
                  onClick={() => {
                    logout();
                    toast({
                      title: "Logged out",
                      description: "You have been successfully logged out.",
                    });
                  }}
                  disabled={isLoggingOut}
                >
                  {isLoggingOut ? "Logging out..." : "Log out"}
                </Button>
              </>
            ) : (
              <>
                <Link href="/signup">
                  <Button className="abraj-primary hover:abraj-secondary text-white font-medium">
                    Sign up
                  </Button>
                </Link>
                <Link href="/login">
                  <Button 
                    variant="outline" 
                    className="text-abraj-primary border-abraj-primary hover:abraj-primary hover:text-white font-medium"
                  >
                    Log in
                  </Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
