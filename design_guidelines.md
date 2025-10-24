# Design Guidelines: Image Hosting Application

## Design Approach
**Reference-Based Approach** drawing from industry leaders in image hosting and sharing:
- **Imgur**: Clean upload interface, efficient gallery views, instant shareable links
- **Postimages**: Streamlined upload flow, minimal distractions
- **Google Photos**: Intuitive drag-drop, smart grid layouts

**Core Principle**: Prioritize speed and clarity. Every element serves the primary goal of getting images uploaded and shared with zero friction.

## Layout System
**Spacing Primitives**: Use Tailwind units of **2, 4, 8, 12, and 16** for consistent rhythm (p-4, m-8, gap-12, etc.)

**Page Structure**:
- **Single-page application** with persistent upload zone
- **Two-panel layout** on desktop: Upload area (left 40%) + Gallery (right 60%)
- **Stacked layout** on mobile: Upload zone fixed at top, scrollable gallery below
- Container: `max-w-7xl mx-auto` with `px-4 md:px-8` padding

## Typography
**Font Stack**: 
- Primary: Inter or System UI (-apple-system, BlinkMacSystemFont)
- Monospace (for URLs): SF Mono, Monaco, 'Courier New'

**Hierarchy**:
- Page Title: text-2xl md:text-3xl, font-bold
- Section Headers: text-lg md:text-xl, font-semibold
- Body Text: text-base, font-normal
- Helper Text: text-sm, font-normal
- Links/URLs: text-sm md:text-base, font-mono

## Core Components

### Upload Zone (Primary Interaction Area)
**Multi-method Input Panel**:
- Large dropzone area (min-h-64 md:min-h-80) with dashed border (border-2 border-dashed)
- Central icon and text: "Drop images here, paste (Ctrl+V), or click to browse"
- Three distinct action buttons horizontally arranged with gap-4:
  - "Browse Files" (primary button)
  - "Paste Image" (secondary button with keyboard shortcut indicator)
  - "Take Photo" (secondary button with camera icon)
- Visual feedback states: Default, Hover (border emphasis), Drag-over (highlighted), Uploading (progress indicator)

### Image Gallery Grid
**Masonry-style grid layout**:
- Desktop: `grid grid-cols-3 lg:grid-cols-4 gap-4`
- Tablet: `grid-cols-2 gap-3`
- Mobile: `grid-cols-1 gap-4`

**Image Card Structure**:
- Image thumbnail with aspect-ratio preservation (object-cover)
- Overlay on hover showing:
  - Copy link button (top-right corner, absolute positioning)
  - Delete button (top-left corner)
  - File size and dimensions (bottom overlay, semi-transparent)
- Each card: rounded-lg overflow-hidden with subtle shadow

### Link Display & Copy Interface
**For each uploaded image**:
- Direct URL field: full-width input with monospace font, rounded border
- Copy button: positioned at input's right edge (absolute right-2) with success state feedback
- Quick copy icon button: Clipboard icon that changes to checkmark on click
- Alternative link formats dropdown: Direct link, Markdown, HTML, BBCode (accordion-style reveal)

### Camera Capture Modal
**Fullscreen overlay** (when "Take Photo" is clicked):
- Live camera feed: 16:9 aspect ratio, centered with max-w-2xl
- Bottom action bar: Capture button (large, circular, centered), Cancel button (left), Switch camera button (right) if multiple cameras available
- Preview after capture: Same layout with Retake and Use Photo buttons

### Header
**Minimal top bar** (sticky position):
- Logo/App name (left, text-xl font-bold)
- Upload count indicator (center, text-sm)
- Settings/Clear all button (right, icon button)

### Toast Notifications
**Fixed positioning** (top-right on desktop, top-center on mobile):
- Success state: "Image uploaded! Link copied to clipboard"
- Error state: "Upload failed. Please try again"
- Auto-dismiss after 3 seconds with slide-in/out animation

## Interaction Patterns

**Upload Flow**:
1. User drops/selects/pastes/captures image
2. Immediate thumbnail preview appears in upload zone
3. Progress indicator during upload (linear progress bar)
4. On completion: thumbnail moves to gallery, shareable link auto-copies
5. Success toast notification confirms

**Paste Anywhere**: 
- Global paste detection active when page has focus
- Works on upload zone, gallery, or any blank area
- Visual flash feedback on successful paste detection

**Gallery Interactions**:
- Click image: Opens full-size lightbox view
- Hover: Reveals action buttons overlay
- Quick copy: Single click on copy icon instantly copies link
- Delete: Click trash icon → inline confirmation → remove from gallery

## Responsive Behavior

**Desktop (lg and above)**:
- Two-panel side-by-side layout
- Gallery shows 4 columns
- Upload zone remains visible while scrolling gallery

**Tablet (md)**:
- Upload zone above gallery, both full-width
- Gallery shows 2 columns
- Sticky upload summary bar when scrolling

**Mobile**:
- Single column stacked layout
- Upload zone collapsible after first upload
- Gallery full-width, single column
- Bottom sheet for link options instead of dropdown

## Accessibility
- All buttons have clear focus states (ring-2 ring-offset-2)
- Upload zone keyboard accessible (Enter to trigger file browser)
- Image alt text auto-generated from filename
- Copy success announced to screen readers
- Camera permissions clearly requested with explanatory text

## Images
This application does not require a hero image. The upload zone IS the hero element. All images are user-generated content displayed in the gallery grid. No placeholder or decorative images needed.