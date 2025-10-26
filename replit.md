# ImageDrop - Instant Image Hosting

## Overview

ImageDrop is a single-page image hosting application that enables users to upload, manage, and share images instantly. The application provides multiple upload methods (drag-and-drop, file browsing, clipboard paste, and camera capture) with a clean, minimal interface inspired by Imgur and Postimages. Users receive shareable URLs immediately upon upload for easy embedding anywhere online.

**Recent Updates** (October 2025):
- **HEIC/HEIF Support**: Automatic client-side conversion of iPhone HEIC/HEIF images to PNG using heic2any library
- **Extended Auto-Delete Timer**: Countdown increased to 10 seconds for better workflow with simultaneous photo/audio capture
- **Continuous Capture Mode**: Toggle switch enables rapid-fire photo taking that auto-uploads each shot while keeping camera open
- **Real-Time Sync**: Gallery auto-refreshes every 3 seconds for immediate updates
- **Bulk Management**: Delete All button with confirmation dialog removes all images and cloud storage objects as well as transcriptions
- **Always-Visible Timestamps**: Date/time stamps permanently visible for easy text capture (Ctrl+C) during class notes
- **Inline Timeline View**: Images and transcriptions display chronologically mixed together - oldest first - showing exactly when each photo was taken and each transcription was created
- **Persistent Recording Bar**: Background audio recording with pause/resume, auto-transcription every 30 seconds, non-blocking UI allows photo capture during recording

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Framework & Build System**
- React 18+ with TypeScript for type safety and modern React features
- Vite as the build tool and development server for fast HMR and optimized production builds
- Single-page application (SPA) architecture using Wouter for lightweight client-side routing

**UI Component System**
- shadcn/ui component library (New York style) built on Radix UI primitives
- Tailwind CSS for utility-first styling with custom design tokens
- CSS variables for theming with light/dark mode support
- Responsive design with mobile-first breakpoints (768px mobile breakpoint)

**State Management**
- TanStack Query (React Query) for server state management, caching, and data synchronization
- Real-time polling with 3-second refetch interval for automatic gallery and transcription updates
- Local React state for UI interactions and component-level state
- Query invalidation pattern for real-time updates after mutations
- Timeline merging: Images and transcriptions combined client-side into chronological order sorted by timestamp

**Upload Mechanism**
- Uppy file uploader integration for robust multi-method uploads:
  - Drag-and-drop zone
  - File browser input
  - Clipboard paste (Ctrl+V)
  - Camera capture via WebRTC MediaDevices API with continuous mode toggle
- AWS S3-compatible upload strategy using pre-signed URLs
- Client-side image validation (file type, size limits)
- HEIC/HEIF conversion: Automatic conversion to PNG using heic2any before upload for iPhone compatibility

**Camera Capture Features**
- Instant camera initialization on back camera (environment-facing)
- Continuous capture mode: toggle for rapid-fire photo taking without preview interruptions
- Auto-upload each photo while maintaining camera stream
- Flip camera button for switching between back and front cameras
- Orientation toggle: "Sideways (Landscape)" mode rotates captured photos 90° clockwise for sideways phone holding
- Per-device localStorage: Both continuous mode and orientation preferences are saved per device

### Backend Architecture

**Server Framework**
- Express.js server with TypeScript
- ESM module system for modern JavaScript features
- Custom middleware for request logging and JSON body parsing with raw body capture
- Development/production environment separation

**API Design Pattern**
- RESTful API endpoints:
  - `POST /api/objects/upload` - Generate pre-signed upload URLs
  - `POST /api/images` - Create image metadata records
  - `GET /api/images` - Retrieve all images (auto-polled every 3 seconds)
  - `DELETE /api/images/:id` - Remove single image record and cloud object
  - `DELETE /api/images` - Bulk delete all images and cloud objects
  - `POST /api/transcribe` - Upload audio segment and transcribe via OpenAI Whisper
  - `GET /api/transcriptions` - Retrieve all transcriptions (auto-polled every 3 seconds)
  - `GET /objects/:objectPath(*)` - Serve uploaded files
- JSON request/response format with Zod schema validation
- Error handling with appropriate HTTP status codes
- Proper error surfacing for failed mutations via toast notifications

**Storage Abstraction**
- Interface-based storage pattern (`IStorage`) for flexibility
- In-memory storage implementation (`MemStorage`) as default
- Database-ready architecture with Drizzle ORM configured for PostgreSQL migration
- Separation of object storage (files) and metadata storage (database records)

### Data Storage

**Database Schema** (Drizzle ORM with PostgreSQL)
```typescript
images table:
  - id: varchar (primary key)
  - objectPath: text (file location in object storage)
  - fileName: text (original filename)
  - fileSize: text (human-readable size)
  - mimeType: text (image content type)
  - uploadedAt: timestamp (automatic creation time)
```

**Rationale**: Simple, flat schema optimized for fast retrieval and chronological ordering. Metadata separated from binary storage for efficient querying.

**Object Storage**
- Google Cloud Storage integration via `@google-cloud/storage`
- Replit sidecar authentication using external account credentials
- Public object access configuration for shareable image URLs
- ACL (Access Control List) system prepared for future permission management

**Current State**: Using in-memory storage for development; PostgreSQL schema defined and ready for production deployment via Drizzle Kit migrations.

### External Dependencies

**Cloud Services**
- **Google Cloud Storage**: Primary object storage for uploaded images
  - Authentication: Replit sidecar credential service (http://127.0.0.1:1106)
  - Access pattern: External account with automatic token refresh
  - Configuration: Service account-style authentication without API keys

**Third-Party Libraries**
- **Uppy** (@uppy/core, @uppy/aws-s3, @uppy/dashboard, @uppy/react): File upload management
  - Features: Progress tracking, retry logic, multi-file support
  - Integration: S3-compatible pre-signed URL uploads
  
- **Radix UI**: Unstyled, accessible component primitives (20+ components)
  - Dialogs, dropdowns, toasts, tooltips, form controls
  - ARIA-compliant with keyboard navigation
  
- **TanStack Query**: Server state synchronization
  - Automatic background refetching
  - Optimistic updates
  - Cache invalidation strategies

**Database & ORM**
- **Drizzle ORM** with **@neondatabase/serverless**: Type-safe database client
  - PostgreSQL dialect
  - Schema-first design with TypeScript inference
  - Migration system via Drizzle Kit
  - Prepared for Neon serverless PostgreSQL deployment

**Development Tools**
- **Vite plugins**: 
  - @replit/vite-plugin-runtime-error-modal (error overlay)
  - @replit/vite-plugin-cartographer (navigation)
  - @replit/vite-plugin-dev-banner (development banner)
- **TypeScript**: Strict mode enabled with path aliases (@/, @shared/, @assets/)
- **ESBuild**: Production server bundling

**Design System**
- **Tailwind CSS**: Utility-first CSS framework
  - Custom spacing scale (2, 4, 8, 12, 16 units)
  - Extended border radius values
  - HSL color system with CSS variable theming
  
- **Fonts**: 
  - Inter (primary interface font via Google Fonts)
  - System font stack fallback
  - Monospace fonts for URL display