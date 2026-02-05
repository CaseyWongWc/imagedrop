# ImageDrop V2 - AI-Powered Lecture Capture

## Overview

ImageDrop V2 is a lecture capture application that combines live transcription, photo annotation, and organized notebooks. Users can capture photos during lectures, record audio transcriptions, and organize everything into class-specific notebooks with chronological timelines.

**Version 2 Updates** (February 2026):
- **Notebooks System**: Organize captures by class/date (CS4800, CS2520, etc.)
- **PostgreSQL Persistence**: Data survives restarts - no more lost content
- **Timeline View**: Merged photos, transcripts, and checkpoints in chronological order
- **Checkpoints**: Manual checkpoint button + auto-checkpoint timer for lecture segmentation
- **Font Size Control**: Adjustable text size (10-24px)
- **Photo Scale Control**: Adjustable image display size (25-100%)
- **Link-Based Export**: Markdown export with photo URLs (not base64 embedded)
- **Mobile-First Design**: Optimized for in-class phone usage

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Framework & Build System**
- React 18+ with TypeScript
- Vite for build and dev server
- Wouter for client-side routing

**UI Component System**
- shadcn/ui component library on Radix UI
- Tailwind CSS with custom design tokens
- Mobile-first responsive design

**State Management**
- TanStack Query for server state and caching
- localStorage for user preferences (font size, photo scale, selected notebook)
- Query invalidation for real-time updates

**Key Components**
- `Home.tsx` - Main page with notebook selection and timeline view
- `RecordingBar.tsx` - Audio recording with 30-second auto-transcription
- `CameraCapture.tsx` - Camera modal with HEIC conversion support

### Backend Architecture

**Server Framework**
- Express.js with TypeScript
- PostgreSQL database via Drizzle ORM

**API Endpoints**
```
Notebooks:
  POST /api/notebooks - Create notebook
  GET /api/notebooks - List all notebooks
  GET /api/notebooks/:id - Get single notebook
  DELETE /api/notebooks/:id - Delete notebook (cascades to content)
  GET /api/notebooks/:id/timeline - Get merged timeline items

Images:
  POST /api/objects/upload - Get pre-signed upload URL
  POST /api/images - Create image record (with notebookId)
  GET /api/images - Get all images
  DELETE /api/images/:id - Delete single image

Transcriptions:
  POST /api/transcribe - Upload audio and transcribe (with notebookId)
  GET /api/transcriptions - Get all transcriptions

Checkpoints:
  POST /api/checkpoints - Create checkpoint (notebookId + optional label)
  GET /api/notebooks/:id/checkpoints - Get checkpoints for notebook
  DELETE /api/checkpoints/:id - Delete checkpoint

Objects:
  GET /objects/:objectPath(*) - Serve uploaded files
```

### Database Schema (PostgreSQL)

```typescript
notebooks:
  - id: varchar (primary key)
  - title: text
  - className: text (optional, e.g., "CS4800")
  - createdAt: timestamp

images:
  - id: varchar (primary key)
  - notebookId: varchar (foreign key -> notebooks.id, cascade delete)
  - objectPath: text
  - fileName: text
  - fileSize: text
  - mimeType: text
  - uploadedAt: timestamp

transcriptions:
  - id: varchar (primary key)
  - notebookId: varchar (foreign key -> notebooks.id, cascade delete)
  - text: text
  - createdAt: timestamp

checkpoints:
  - id: varchar (primary key)
  - notebookId: varchar (foreign key -> notebooks.id, cascade delete)
  - label: text (optional)
  - createdAt: timestamp
```

### Storage

**Database**: PostgreSQL with Drizzle ORM (`DbStorage` class)
- All metadata stored in PostgreSQL
- Foreign key relationships with cascade delete

**Object Storage**: Replit Object Storage (GCS-backed)
- Photos stored with permanent public URLs
- No base64 embedding in exports

### Key Files

```
shared/schema.ts - Database schema and types
server/db.ts - Database connection
server/storage.ts - DbStorage implementation
server/routes.ts - API endpoints
client/src/pages/Home.tsx - Main UI
client/src/components/RecordingBar.tsx - Audio recording
```

### Configuration

**Environment Variables (auto-configured)**:
- `DATABASE_URL` - PostgreSQL connection
- Object storage credentials

**User Settings (localStorage)**:
- `selected-notebook-id` - Currently selected notebook
- `font-size` - Text size (default: 14)
- `photo-scale` - Image scale (default: 100)
- `auto-checkpoint-enabled` - Auto checkpoint toggle
- `auto-checkpoint-minutes` - Auto checkpoint interval (default: 5)

## Development

**Commands**:
- `npm run dev` - Start development server
- `npm run db:push` - Push schema changes to database

**Workflow**: "Start application" runs `npm run dev`
