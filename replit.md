# Abraj Quiz Application

## Overview

Abraj Quiz is a real-time, interactive quiz application designed for creating and hosting live quiz games. It features a custom turquoise/teal brand identity. The application facilitates PIN-based game joining, real-time gameplay with dynamic leaderboards, and detailed scoring. Its core purpose is to provide an engaging and user-friendly platform for interactive educational and entertainment-based quizzes, with ambitions to serve a wide market through its robust feature set and engaging user experience.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter
- **UI Components**: Radix UI primitives with shadcn/ui design system
- **Styling**: Tailwind CSS with custom Abraj brand colors (turquoise/teal theme)
- **State Management**: TanStack Query (React Query) for server state
- **Build Tool**: Vite

### Backend Architecture
- **Framework**: Express.js with TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **API Style**: REST API with JSON responses

### Key Design Decisions
- **Monorepo Structure**: Utilizes a monorepo with shared schema for full-stack type safety.
- **Real-time Features**: Designed for real-time gameplay with polling-based updates.
- **Component-based UI**: Employs Radix UI and shadcn/ui for accessibility and consistent design, with custom Abraj theming.
- **Storage Layer**: Interface-based design (`IStorage`) allowing for flexible storage implementations, primarily using PostgreSQL.
- **UI/UX**: Features interactive animations, sound effects, and a consistent visual theme (e.g., classroom background, themed backgrounds for quizzes).
- **Advanced Features**: Includes AI-powered quiz generation from various sources (PDF, URL, topics, text paste), and comprehensive PDF reporting with themed backgrounds and analytics.
- **Scoring System**: Implements a delayed, Kahoot-style scoring system where scores are revealed after the question timer expires.

### Key Components
- **Database Schema**: Includes Users, Quizzes (with JSONB for questions), Games, and Game Responses.
- **API Routes**: Covers Quiz Management (CRUD), Game Management, and Real-time Gameplay interactions.
- **Frontend Pages**: Home, Create Quiz, Host Game, Join/Play Game, Game Results.
- **AI Integration**: Leverages OpenAI GPT-4o for generating quizzes from uploaded content (PDFs, URLs), free-form text, or specified topics.
- **Interactive Elements**: Features QR code generation for game joining, enhanced sound effects for correct/incorrect answers, and dynamic UI animations for engaging user feedback.

## External Dependencies

### Core Dependencies
- **@neondatabase/serverless**: For serverless PostgreSQL connections.
- **drizzle-orm**: For type-safe database operations.
- **@tanstack/react-query**: For server state management.
- **@radix-ui/***: For accessible UI primitives.
- **tailwindcss**: For utility-first CSS styling.
- **jsPDF** and **jsPDF-autoTable**: For PDF generation.
- **pdf-parse**: For parsing PDF content for AI generation.
- **axios** and **cheerio**: For URL content scraping for AI generation.
- **multer**: For handling file uploads (e.g., PDF) securely.
- **qrcode**: For generating QR codes.
- **OpenAI GPT-4o**: For AI-powered quiz generation.

### Development Tools
- **tsx**: TypeScript execution.
- **esbuild**: Fast bundling.
- **drizzle-kit**: For database migrations and schema management.