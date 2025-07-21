import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";

export default function Navigation() {
  const [location] = useLocation();

  return (
    <nav className="bg-white shadow-lg border-b-4 border-kahoot-purple sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center space-x-4">
            <Link href="/">
              <div className="flex items-center space-x-2 cursor-pointer">
                <div className="bg-kahoot-purple text-white w-10 h-10 rounded-xl flex items-center justify-center font-bold text-xl">
                  K
                </div>
                <h1 className="font-bold text-2xl text-gray-800">Kahoot!</h1>
              </div>
            </Link>
          </div>
          
          <div className="hidden md:block">
            <div className="ml-10 flex items-baseline space-x-4">
              <Link href="/create">
                <a className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  location === '/create' 
                    ? 'text-kahoot-purple bg-purple-50' 
                    : 'text-gray-700 hover:text-kahoot-purple'
                }`}>
                  Create
                </a>
              </Link>
              <Link href="/join">
                <a className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  location.startsWith('/join') 
                    ? 'text-kahoot-purple bg-purple-50' 
                    : 'text-gray-700 hover:text-kahoot-purple'
                }`}>
                  Play
                </a>
              </Link>
              <Link href="/">
                <a className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  location === '/' 
                    ? 'text-kahoot-purple bg-purple-50' 
                    : 'text-gray-700 hover:text-kahoot-purple'
                }`}>
                  Discover
                </a>
              </Link>
            </div>
          </div>
          
          <div className="flex items-center space-x-3">
            <Button className="kahoot-purple hover:bg-purple-600 text-white font-medium">
              Sign up
            </Button>
            <Button 
              variant="outline" 
              className="text-kahoot-purple border-kahoot-purple hover:kahoot-purple hover:text-white font-medium"
            >
              Log in
            </Button>
          </div>
        </div>
      </div>
    </nav>
  );
}
