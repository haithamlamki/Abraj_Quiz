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