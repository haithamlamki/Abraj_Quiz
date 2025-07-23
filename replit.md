# Abraj Quiz Application

## Overview

This is a real-time quiz application rebranded as "Abraj Quiz", built with React (frontend) and Express.js (backend). The application allows users to create quizzes, host live quiz games with PIN-based joining, and provides real-time gameplay with leaderboards and scoring. Features a custom turquoise/teal color scheme matching the Abraj brand identity. Now integrated with PostgreSQL database for persistent data storage.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter for client-side routing
- **UI Components**: Radix UI primitives with shadcn/ui design system
- **Styling**: Tailwind CSS with custom Abraj brand colors (turquoise/teal theme)
- **State Management**: TanStack Query (React Query) for server state
- **Build Tool**: Vite with custom configuration for monorepo structure

### Backend Architecture
- **Framework**: Express.js with TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **Database Provider**: Neon Database (serverless PostgreSQL)
- **API Style**: REST API with JSON responses
- **Development**: Hot module replacement via Vite middleware in development

### Key Design Decisions

**Monorepo Structure**: The application uses a monorepo with shared schema between client and server, enabling type safety across the full stack.

**Real-time Features**: While WebSocket infrastructure isn't visible in the current codebase, the application is designed for real-time gameplay with polling-based updates (evident from refetchInterval usage in queries).

**Component-based UI**: Leverages Radix UI for accessibility and shadcn/ui for consistent design patterns, with custom Abraj-inspired turquoise/teal theming.

## Key Components

### Database Schema (shared/schema.ts)
- **Users**: Authentication and user management
- **Quizzes**: Quiz content with JSONB questions storage
- **Games**: Live game sessions with PIN-based access
- **Game Responses**: Player answers and scoring data

### API Routes (server/routes.ts)
- **Quiz Management**: CRUD operations for quizzes
- **Game Management**: Creating and managing live game sessions
- **Real-time Gameplay**: Player joining, answer submission, and results

### Frontend Pages
- **Home**: Quiz discovery and game PIN entry
- **Create Quiz**: Interactive quiz builder with question management
- **Host Game**: Real-time game control and player management
- **Join/Play Game**: Player experience with answer submission
- **Game Results**: Leaderboards and final scoring

### Storage Layer
- **Interface-based Design**: IStorage interface allows for multiple implementations
- **Database Storage**: Production implementation using PostgreSQL via Drizzle ORM
- **Memory Storage**: Legacy development/testing implementation (replaced)

## Data Flow

1. **Quiz Creation**: Users create quizzes with questions stored as JSONB
2. **Game Hosting**: Host creates game session with generated PIN
3. **Player Joining**: Players join via PIN, stored in game's players array
4. **Real-time Gameplay**: Questions displayed, answers submitted, results calculated
5. **Scoring**: Point calculation based on correctness and response time
6. **Leaderboards**: Real-time score updates and final rankings

## External Dependencies

### Core Dependencies
- **@neondatabase/serverless**: Serverless PostgreSQL connection
- **drizzle-orm**: Type-safe database operations
- **@tanstack/react-query**: Server state management
- **@radix-ui/***: Accessible UI primitives
- **tailwindcss**: Utility-first CSS framework

### Development Tools
- **tsx**: TypeScript execution for development
- **esbuild**: Fast bundling for production
- **drizzle-kit**: Database migrations and schema management

## Deployment Strategy

### Build Process
- **Frontend**: Vite builds React app to `dist/public`
- **Backend**: esbuild bundles Express server to `dist/index.js`
- **Database**: Drizzle migrations handle schema updates

### Environment Configuration
- **DATABASE_URL**: PostgreSQL connection string (required)
- **NODE_ENV**: Environment detection for development features
- **REPL_ID**: Replit-specific features when deployed on Replit

### Production Considerations
- Static file serving handled by Express in production
- Database migrations via `db:push` script
- Serverless-compatible architecture with Neon Database

## Recent Changes

**Quiz History Feature (January 21, 2025)**
- ✓ Added comprehensive authentication system with login/signup functionality
- ✓ Implemented password hashing with bcrypt for secure user authentication
- ✓ Created quiz history page for users to view and manage their created quizzes
- ✓ Added "/my-quizzes" API endpoint to fetch user-specific quizzes
- ✓ Updated navigation to show "My Quizzes" link for authenticated users
- ✓ Fixed quiz creation validation issues for authenticated users
- ✓ Quiz creation now properly assigns createdBy from user session

**Database Integration (January 21, 2025)**
- ✓ Integrated PostgreSQL database using Neon Database
- ✓ Replaced MemStorage with DatabaseStorage implementation
- ✓ Successfully pushed database schema using Drizzle ORM
- ✓ Fixed TypeScript errors in storage layer and frontend components
- ✓ Application now uses persistent PostgreSQL storage for all data
- ✓ Maintained complete compatibility with existing IStorage interface

**Game Logic Fixes (January 21, 2025)**
- ✓ Fixed JSX structure errors in home page that were preventing app startup
- ✓ Fixed React hooks ordering issue in create-quiz component
- ✓ Removed nested anchor tag warnings in footer navigation
- ✓ Improved gameplay logic: Players no longer see correct/incorrect feedback immediately after answering
- ✓ Results now only display after the question timer expires, creating proper Kahoot-style experience
- ✓ Maintained answer submission and scoring while hiding premature feedback

**User Experience Improvements (January 21, 2025)**
- ✓ Added automatic name filling for registered users in game joining flow
- ✓ Enhanced home page with player name input field alongside game PIN entry
- ✓ Added visual indicators when names are auto-filled from user accounts  
- ✓ Provided login prompts for non-authenticated users to enable auto-fill
- ✓ Streamlined game joining process: users can now join directly from home page with name pre-filled
- ✓ Maintained backward compatibility with existing join flow via separate join-game page

**QR Code and Sharing Features (January 21, 2025)**
- ✓ Integrated QRCode library for generating unique QR codes for each game
- ✓ Added QR code generation in host-quiz-setup page when game is created
- ✓ Enhanced host game waiting screen with QR code display toggle and share options
- ✓ Implemented copy-to-clipboard functionality for game PINs and join links
- ✓ Created visual share interface with copy buttons for PIN and shareable URLs
- ✓ QR codes use custom Abraj blue branding colors for consistent visual identity
- ✓ Players can now join games by scanning QR codes or clicking shared links
- ✓ Added QR code scanning functionality to home page for easy game joining
- ✓ Implemented camera access with user-friendly scanning interface
- ✓ Added tap-to-scan demo functionality with proper UI feedback

**Interactive Animations and Sound Effects (January 21, 2025)**
- ✓ Replicated player page layout in host game view with vertical answer arrangement
- ✓ Updated Badge components to use consistent brand colors (#019ebd background, white text)
- ✓ Implemented hover effects that slightly enlarge interactive elements
- ✓ Added click animations with visual feedback using scale transforms
- ✓ Created Web Audio API-based sound effects for enhanced user engagement
- ✓ Added countdown timer sounds that play when clicked or interacted with
- ✓ Implemented different sound effects for correct and wrong answers
- ✓ Enhanced both host and player pages with consistent interactive animations
- ✓ Maintained default time limits of 10 seconds with options for 5, 10, 15, 20, 30, 60 seconds
- ✓ Added bounce animation for correct answers during results display
- ✓ Implemented responsive design with mobile-first approach matching player experience
- ✓ Added game start countdown animation (3-2-1) with distinct visual styles and sound effects
- ✓ Implemented urgent timer warnings for last 3 seconds with enhanced animations and sounds
- ✓ Created full-screen countdown overlay with color-coded animations (red/yellow/green)
- ✓ Added timer animations that change from pulse to bounce to ping based on urgency

**Time-Up Effects and UI Improvements (January 21, 2025)**
- ✓ Implemented "Time's Up" overlay effect for players who don't answer within time limit
- ✓ Added distinctive time-up sound effect with descending tone sequence
- ✓ Created full-screen red overlay with clock emoji and animated "TIME'S UP!" message
- ✓ Fixed countdown synchronization issues between host and players
- ✓ Removed player-side countdown logic that caused infinite loops
- ✓ Fixed all player list scrolling issues by removing max-height constraints
- ✓ Enhanced player lists in host view, game results, and waiting screens to show all players without scrolling
- ✓ Time-up effect automatically dismisses after 3 seconds for better user experience

**Classroom Background Update (January 22, 2025)**
- ✓ Updated all game pages with new classroom background image
- ✓ Applied modern cartoon-style classroom background across host-game, play-game, and game-results pages
- ✓ Enhanced visual consistency with backdrop blur effects on all card components
- ✓ Maintained 2x2 answer grid layout with larger text for better readability
- ✓ Preserved all interactive animations and sound effects with new background theme

**PDF Report Feature (January 22, 2025)**
- ✓ Integrated jsPDF and jsPDF-autoTable libraries for PDF generation
- ✓ Added comprehensive PDF download feature to Host Results Page only
- ✓ PDF includes Abraj logo at top, quiz information (title, ID, host, date/time)
- ✓ Complete question list with all answer choices and correct answers highlighted
- ✓ Player rankings table with scores and achievements in branded design
- ✓ Game statistics section with accuracy and performance metrics
- ✓ Professional PDF layout with proper pagination and styling
- ✓ Download button prominently placed in host actions section

**AI-Powered Auto-Generation Feature (January 22, 2025)**
- ✓ Integrated OpenAI GPT-4o for intelligent quiz generation from external content
- ✓ Added tabbed interface to create-quiz page with Manual Creation and Auto Generate options
- ✓ Implemented PDF upload and parsing using pdf-parse library for content extraction
- ✓ Added URL content scraping using axios and cheerio for web article processing
- ✓ Created backend API endpoints /api/generate-quiz/pdf and /api/generate-quiz/url
- ✓ Added comprehensive error handling and content validation for AI-generated quizzes
- ✓ Enhanced UI with file upload area, URL input field, and loading animations
- ✓ Auto-generated quizzes include 8-12 questions with proper Abraj formatting
- ✓ Questions are editable after generation before finalizing quiz creation
- ✓ Added multer middleware for secure PDF file handling with 10MB size limit

**UI Enhancements and Quiz Background Feature (January 23, 2025)**
- ✓ Updated input backgrounds to semi-transparent (#ffffff85) for better visual appeal
- ✓ Added quiz background selection feature with 5 theme options (Classroom, Space, Ocean, Forest, City)
- ✓ Extended database schema with background field and default "classroom" theme
- ✓ Integrated background selection into Quiz Details section of create-quiz page
- ✓ Repositioned "Next Question"/"Finish Game" button to top right of host game page
- ✓ Background themes now stored in database and applied throughout entire game sessions
- ✓ Enhanced user experience with clear instructions that backgrounds affect all game pages

**Topics Auto-Generation Feature (January 23, 2025)**
- ✓ Added third "From Topics" tab to auto-generate interface with 3-column grid layout
- ✓ Created generateQuizFromTopics function using GPT-4o for topic-based quiz creation
- ✓ Implemented comprehensive API endpoint /api/generate-quiz/topics with input validation
- ✓ Added user-friendly textarea interface with helpful tips for better AI results
- ✓ Maintained consistent error handling, loading states, and Abraj brand styling
- ✓ Users can generate educational quizzes from simple topic inputs like "World War II, JavaScript basics"

**Enhanced Home Page Animations (January 23, 2025)**
- ✓ Added smooth fade-in-up animation to main heading "Powered by Our Dedicated Team"
- ✓ Implemented sequential animation timing with delayed effects for subtitle and card elements
- ✓ Added hover pulse effect to main heading with cursor interaction
- ✓ Created CSS keyframes for fade-in-up animation with 30px translateY start position
- ✓ Applied staggered timing: title (0s), subtitle (0.5s), join game card (1s) for natural flow
- ✓ Maintained Abraj brand color consistency throughout animated elements

**Latest Quiz Results Feature (January 23, 2025)**
- ✓ Added "Latest Quiz Champions" section displaying top 3 players from most recent completed game
- ✓ Created getLatestCompletedGame method in storage interface with PostgreSQL and memory implementations
- ✓ Implemented /api/latest-results endpoint with comprehensive game and player data
- ✓ Designed elegant UI with gold/silver/bronze styling using Crown, Medal, and Award icons
- ✓ Added gradient backgrounds and hover animations for enhanced visual appeal
- ✓ Displays quiz title, game PIN, question count, and player rankings with scores
- ✓ Auto-refreshes every 30 seconds to show latest completed games
- ✓ TypeScript interfaces ensure type safety for latest results data structure