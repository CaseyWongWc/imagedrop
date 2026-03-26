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
  PATCH /api/notebooks/:id - Update notebook (title, className)
  DELETE /api/notebooks/:id - Delete notebook (cascades to content)
  GET /api/notebooks/:id/timeline - Get merged timeline items
  GET /api/notion/pages - List accessible Notion pages (for parent page selection)
  POST /api/notebooks/:id/export/notion - Export notebook to a new Notion page (body: { parentPageId?: string | null })

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

## Project Roadmap

### P1: Core Foundation (COMPLETED)
Everything in this phase is built and working.
- PostgreSQL persistence with Drizzle ORM (data survives restarts)
- Notebooks system: create, edit (title + className), delete notebooks
- Timeline view: merged photos, transcripts, and checkpoints in chronological order (oldest first)
- Photo capture: camera modal, file upload, paste support, HEIC conversion
- Audio transcription: 30-second recording chunks, OpenAI Whisper API integration
- Checkpoints: manual checkpoint button + auto-checkpoint timer (configurable interval)
- Display controls: adjustable font size (10-24px) and photo scale (25-100%)
- Link-based Markdown export with photo URLs (not base64)
- Auto-download photos to browser Downloads folder
- Mobile-first responsive design with icon-only action bar (Camera, Upload, Mic, Checkpoint)
- Object storage for photos (Replit Object Storage / GCS-backed, permanent public URLs)

### P1.5: Notion Export (COMPLETED)
- Notion integration via Replit Connectors SDK (`@replit/connectors-sdk`)
- "Send to Notion" button in notebook header (Notion icon)
- Creates a new Notion page titled: `notebook title — class — date`
- Full timeline exported in chronological order: image blocks, transcription paragraphs, checkpoint dividers/headings
- Success toast with clickable "Open in Notion" link
- Error toast with descriptive message on failure
- New endpoint: `POST /api/notebooks/:id/export/notion`
- New server module: `server/notion.ts`

### P2: AI-Powered Features (IN PROGRESS)
These features build on the P1 foundation. Do not rewrite existing upload/object storage.

**Completed:**
- OCR: Auto-extract text from photos on upload (GPT-4o-mini vision, background non-blocking)
- Manual "Scan" button per photo and "Scan all unscanned" batch button per notebook
- Global "Show OCR" toggle in settings bar (persisted to localStorage)
- OCR text included in Markdown export
- New endpoints: `POST /api/images/:id/ocr`, `POST /api/notebooks/:id/ocr-all`
- New server module: `server/vision.ts`

**Not started:**
- AI-generated summaries per notebook (using OpenAI GPT)
- Smart search across all notebooks (transcription text + image metadata)
- Suggested checkpoint labels based on transcript context
- Study guide generation from notebook content

### P3: Collaboration & Polish (NOT STARTED)
- Shareable notebook links (read-only public view)
- Multi-device sync improvements
- Notebook templates (preset class names, recurring schedules)
- Bulk operations (select multiple items, batch delete)
- Dark mode theme toggle
- Notification/reminder for upcoming lectures

### Golden Rules (for any LLM working on this project)
1. **Do NOT rewrite the upload/object storage system** — it works, uses Replit Object Storage with GCS, and should be left alone
2. **Prioritize persistence** — all data goes through PostgreSQL via Drizzle ORM (`DbStorage` class in `server/storage.ts`)
3. **Notebooks are the foundation** — every image, transcription, and checkpoint belongs to a notebook via `notebookId` foreign key

## Development

**Commands**:
- `npm run dev` - Start development server
- `npm run db:push` - Push schema changes to database

**Workflow**: "Start application" runs `npm run dev`
