import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import abrajLogo from "@assets/ABRJ.OM - Copy_1753085299475.png";

export default function Navigation() {
  const [location] = useLocation();

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
            <div className="ml-10 flex items-baseline space-x-4">
              <Link href="/create">
                <span className={`px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                  location === '/create' 
                    ? 'text-abraj-primary bg-teal-50' 
                    : 'text-gray-700 hover:text-abraj-primary'
                }`}>
                  Create
                </span>
              </Link>
              <Link href="/join">
                <span className={`px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                  location.startsWith('/join') 
                    ? 'text-abraj-primary bg-teal-50' 
                    : 'text-gray-700 hover:text-abraj-primary'
                }`}>
                  Play
                </span>
              </Link>
              <Link href="/">
                <span className={`px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                  location === '/' 
                    ? 'text-abraj-primary bg-teal-50' 
                    : 'text-gray-700 hover:text-abraj-primary'
                }`}>
                  Discover
                </span>
              </Link>
            </div>
          </div>
          
          <div className="flex items-center space-x-3">
            <Button className="abraj-primary hover:abraj-secondary text-white font-medium">
              Sign up
            </Button>
            <Button 
              variant="outline" 
              className="text-abraj-primary border-abraj-primary hover:abraj-primary hover:text-white font-medium"
            >
              Log in
            </Button>
          </div>
        </div>
      </div>
    </nav>
  );
}
