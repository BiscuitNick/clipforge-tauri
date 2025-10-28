# ClipForge MVP - Product Requirements Document

**Version:** 1.0
**Date:** October 27, 2025
**Target Deadline:** Tuesday, October 28, 2025 at 10:59 PM CT
**Author:** Product Team

---

## Executive Summary

ClipForge is a desktop video editing application built with Tauri and React that enables users to import, arrange, trim, and export video clips. The MVP focuses on core video editing functionality with a native desktop experience, proving the fundamental capability to handle media files in a desktop context.

**MVP Goal:** Deliver a functional, packaged desktop application that demonstrates the complete video editing loop: import → preview → trim → export.

---

## Product Overview

### Vision
Build a production-grade desktop video editor that makes video editing accessible and intuitive, starting with essential features and expanding to compete with tools like CapCut.

### MVP Scope
The MVP is a **hard gate** that validates our core technology stack and media processing pipeline. Success means having a shippable, native macOS application that handles basic video editing workflows.

### Target Platform
- **Primary:** macOS (Intel & Apple Silicon)
- **Framework:** Tauri 2.x
- **Frontend:** React 18+ with TypeScript
- **Styling:** Tailwind CSS

---

## Objectives & Success Criteria

### Primary Objectives
1. ✅ Launch as a native macOS desktop application
2. ✅ Import and display video files (MP4/MOV)
3. ✅ Provide real-time video preview playback
4. ✅ Enable basic trim functionality
5. ✅ Export edited videos to MP4
6. ✅ Package as a distributable .app bundle

### Success Criteria
| Metric | Target |
|--------|--------|
| App launches successfully | 100% success rate |
| Video import (drag & drop + picker) | Both methods working |
| Timeline displays imported clips | Visual representation present |
| Video playback in preview | Smooth 30fps minimum |
| Trim functionality | Set in/out points on single clip |
| Export completes | Generates valid MP4 file |
| Packaged build | .dmg or .app bundle created |
| App launch time | < 5 seconds |

---

## MVP Requirements

### 1. Desktop Application Launch
**Must Have:**
- Application launches from built .app bundle (not dev mode)
- Window opens with proper dimensions (1280x720 minimum)
- Application icon and name configured
- Menu bar integration (File, Edit, View menus)

**Technical Requirements:**
- Tauri `tauri.conf.json` properly configured
- Built using `tauri build` command
- Code signing for macOS (development certificate minimum)

---

### 2. Video Import

#### 2.1 Drag & Drop
**User Story:** As a user, I want to drag video files from Finder directly into the app so I can quickly import clips.

**Acceptance Criteria:**
- Drag video file(s) from Finder onto app window
- Visual feedback during drag (highlight drop zone)
- Accepts MP4 and MOV formats
- Shows import progress/confirmation
- Rejects unsupported formats with error message

#### 2.2 File Picker
**User Story:** As a user, I want to click an "Import" button to browse and select video files.

**Acceptance Criteria:**
- "Import Video" button visible in main UI
- Opens native macOS file picker
- Filters to show only MP4/MOV files
- Supports multiple file selection
- Imports selected files to media library

**Technical Implementation:**
```rust
// Tauri command example
#[tauri::command]
async fn import_video(path: String) -> Result<VideoMetadata, String>
```

---

### 3. Timeline View

**User Story:** As a user, I want to see my imported clips arranged on a timeline so I can visualize my video sequence.

**Acceptance Criteria:**
- Canvas-based timeline component renders correctly
- Shows imported clips as visual blocks/thumbnails
- Displays clip duration and position
- Playhead indicator shows current time
- Time ruler shows timestamps
- Horizontal scrolling for longer sequences

**Visual Requirements:**
- Timeline track minimum height: 80px
- Clip thumbnails: extracted first frame or default video icon
- Color-coded clips (optional but nice)
- Grid lines for time divisions

**Technical Implementation:**
- HTML5 Canvas for rendering
- React component managing canvas state
- Zoom level: default to fit all clips, zoom in/out functionality (stretch)

---

### 4. Video Preview Player

**User Story:** As a user, I want to see my video playing in a preview window so I can review my edits.

**Acceptance Criteria:**
- Video player displays currently selected/hovered clip
- Play/Pause button functional
- Clicking on timeline clip loads it in preview
- Video maintains aspect ratio
- Audio plays synchronized with video

**Recommended Video Player:**
**Option 1 (Recommended): HTML5 `<video>` element**
- Simplest implementation
- Native browser support
- Zero dependencies
- Perfect for MVP scope

**Option 2: react-player**
- React wrapper around HTML5 video
- Slightly easier React integration
- Minimal overhead (48KB)
- npm: `react-player`

**Option 3: Plyr (if more controls needed)**
- Lightweight (23KB)
- Customizable controls
- Good UX out of the box
- npm: `plyr-react`

**Implementation Note:** Start with HTML5 `<video>` element wrapped in a React component. Add react-player or Plyr only if you need custom controls quickly.

**Technical Requirements:**
```tsx
// Basic implementation
<video
  ref={videoRef}
  src={currentClipUrl}
  controls
  style={{ width: '100%', maxHeight: '400px' }}
/>
```

---

### 5. Basic Trim Functionality

**User Story:** As a user, I want to set in and out points on a video clip so I can use only the portion I need.

**Acceptance Criteria:**
- Select a clip on timeline
- UI shows trim handles/markers at clip edges
- Drag left handle to set IN point (trim start)
- Drag right handle to set OUT point (trim end)
- Preview updates to show trimmed region
- Trimmed clip updates on timeline visually
- Original file remains unchanged (non-destructive)

**UI Behavior:**
- Trim handles appear when clip is selected
- Visual indicator shows trimmed vs. untrimmed regions
- Numeric display shows current IN/OUT timecodes
- Option to reset trim to original length

**Technical Implementation:**
- Store trim metadata: `{ clipId, inPoint, outPoint, originalDuration }`
- Update canvas rendering to show trimmed region
- Use FFmpeg `-ss` (start time) and `-t` (duration) for export

---

### 6. Export to MP4

**User Story:** As a user, I want to export my edited timeline as a single MP4 file so I can share or use my video.

**Acceptance Criteria:**
- "Export" button visible in main UI
- Opens save dialog to choose output location
- Exports timeline (even if single clip) to MP4
- Shows progress bar during export
- Completion notification when done
- Exported video is playable in QuickTime/VLC

**Technical Requirements:**
- **FFmpeg Integration:** Native Rust bindings via Tauri
  - Use `ffmpeg-next` or `ffmpeg-sys-next` Rust crate
  - Alternative: Bundle FFmpeg binary and shell out via Tauri command
- **Output Settings:**
  - Format: MP4 (H.264 video, AAC audio)
  - Resolution: Match source or 1080p default
  - Frame rate: Match source (30fps typical)
  - Bitrate: 5-8 Mbps for quality/size balance

**FFmpeg Command Example:**
```bash
# Single clip trim export
ffmpeg -i input.mp4 -ss 00:00:05 -t 00:00:10 -c:v libx264 -c:a aac -strict experimental output.mp4

# Multiple clips (requires concat filter)
ffmpeg -f concat -safe 0 -i filelist.txt -c:v libx264 -c:a aac output.mp4
```

**Tauri Command Structure:**
```rust
#[tauri::command]
async fn export_video(
    clips: Vec<ClipData>,
    output_path: String,
    progress_callback: tauri::Window
) -> Result<String, String>
```

**Progress Reporting:**
- Emit progress events to frontend: `0-100%`
- Show estimated time remaining (nice to have)
- Allow cancel operation (stretch goal)

---

### 7. Packaged Native App

**User Story:** As a user, I want to download and run ClipForge as a regular macOS application.

**Acceptance Criteria:**
- Built using `tauri build`
- Generates .app bundle in `src-tauri/target/release/bundle/macos/`
- Optional: Create .dmg installer using `tauri build --bundles dmg`
- Application can be copied to /Applications folder
- Runs without requiring terminal/dev environment
- No dev tools or debug windows visible

**Build Configuration:**
```json
// tauri.conf.json
{
  "bundle": {
    "identifier": "com.clipforge.app",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/icon.icns"
    ],
    "active": true,
    "targets": "all",
    "macOS": {
      "minimumSystemVersion": "10.15"
    }
  }
}
```

**Deliverables:**
- .app bundle (minimum)
- .dmg installer (recommended)
- Build instructions in README.md
- System requirements documented

---

## Technical Architecture

### System Architecture

```
┌─────────────────────────────────────────────────┐
│              Frontend (React + TS)               │
│  ┌────────────┬──────────────┬───────────────┐  │
│  │  Import UI │  Timeline    │  Preview      │  │
│  │            │  (Canvas)    │  Player       │  │
│  └────────────┴──────────────┴───────────────┘  │
│                                                   │
│  State Management: React Context / Zustand       │
└─────────────────┬───────────────────────────────┘
                  │ Tauri Commands (IPC)
┌─────────────────┴───────────────────────────────┐
│              Backend (Rust / Tauri)              │
│  ┌────────────────────────────────────────────┐ │
│  │  File System    │  Video Processing        │ │
│  │  (import/export)│  (FFmpeg integration)    │ │
│  └────────────────────────────────────────────┘ │
│                                                   │
│  ┌────────────────────────────────────────────┐ │
│  │  Video Metadata Extraction                  │ │
│  │  (duration, resolution, codec)              │ │
│  └────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────┘
```

### Technology Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Desktop Framework | Tauri | 2.x | Native app runtime |
| Frontend Framework | React | 18.x | UI components |
| Language | TypeScript | 5.x | Type safety |
| Styling | Tailwind CSS | 3.x | Rapid UI development |
| Timeline Rendering | HTML5 Canvas | Native | Performance |
| Video Player | HTML5 `<video>` | Native | Video playback |
| Video Processing | FFmpeg (Rust) | Latest | Encoding/decoding |
| State Management | React Context / Zustand | - | Application state |
| Build Tool | Vite | 5.x | Fast dev & build |

### Project Structure

```
ClipForge-Tauri/
├── src/                          # React frontend
│   ├── components/
│   │   ├── ImportPanel.tsx       # Drag & drop + file picker
│   │   ├── Timeline.tsx          # Canvas-based timeline
│   │   ├── PreviewPlayer.tsx     # Video preview
│   │   ├── TrimControls.tsx      # Trim UI
│   │   └── ExportButton.tsx      # Export functionality
│   ├── hooks/
│   │   ├── useVideoImport.ts     # Import logic
│   │   └── useTimeline.ts        # Timeline state
│   ├── store/
│   │   └── videoStore.ts         # Global state
│   ├── types/
│   │   └── video.types.ts        # TypeScript types
│   └── App.tsx                   # Main app component
├── src-tauri/                    # Rust backend
│   ├── src/
│   │   ├── main.rs               # Tauri entry point
│   │   ├── commands/
│   │   │   ├── import.rs         # File import commands
│   │   │   ├── export.rs         # Export/FFmpeg commands
│   │   │   └── metadata.rs       # Video metadata extraction
│   │   └── utils/
│   │       └── ffmpeg.rs         # FFmpeg wrapper
│   ├── Cargo.toml                # Rust dependencies
│   └── tauri.conf.json           # Tauri configuration
├── public/
│   └── icons/                    # App icons
├── package.json
└── README.md
```

---

## Data Models

### Video Clip
```typescript
interface VideoClip {
  id: string;                    // Unique identifier
  name: string;                  // Original filename
  path: string;                  // Absolute file path
  duration: number;              // Total duration in seconds
  resolution: {
    width: number;
    height: number;
  };
  frameRate: number;
  format: 'mp4' | 'mov';
  thumbnail?: string;            // Base64 or path to thumbnail
  inPoint: number;               // Trim start (seconds)
  outPoint: number;              // Trim end (seconds)
  timelinePosition: number;      // Position on timeline (seconds)
}
```

### Timeline State
```typescript
interface TimelineState {
  clips: VideoClip[];
  currentTime: number;           // Playhead position
  selectedClipId: string | null;
  duration: number;              // Total timeline duration
  zoom: number;                  // Zoom level (1.0 = default)
}
```

---

## User Flows

### Flow 1: Import and Trim a Single Video

1. **Launch App**
   - User double-clicks ClipForge.app
   - App opens to main window with empty timeline

2. **Import Video**
   - User clicks "Import Video" button OR drags MP4 file from Finder
   - File picker opens (if button clicked) or drop zone activates
   - User selects video file
   - App processes file and extracts metadata
   - Clip appears on timeline as visual block

3. **Preview Video**
   - User clicks on clip in timeline
   - Clip loads in preview player
   - User clicks Play to watch video

4. **Trim Video**
   - User selects clip (already selected from preview)
   - Trim handles appear at clip edges on timeline
   - User drags left handle to set IN point at 5 seconds
   - User drags right handle to set OUT point at 15 seconds
   - Preview updates to show 10-second trimmed segment
   - User clicks Play to verify trim

5. **Export Video**
   - User clicks "Export" button
   - Save dialog opens
   - User chooses location and filename "my-video.mp4"
   - User clicks Save
   - Progress bar appears showing export progress
   - Notification appears: "Export complete!"
   - User opens output file in QuickTime to verify

**Success:** User has successfully imported, trimmed, and exported a video clip.

---

## Technical Implementation Details

### Phase 1: Project Setup (Est. 2 hours)
- [x] Initialize Tauri project: `npm create tauri-app`
- [x] Configure React + TypeScript + Vite
- [x] Set up Tailwind CSS
- [x] Configure Tauri permissions in `tauri.conf.json`
- [x] Add FFmpeg Rust dependencies to `Cargo.toml`

### Phase 2: Video Import (Est. 4 hours)
**Frontend:**
- Create `ImportPanel` component with drag-and-drop zone
- Implement file picker using Tauri dialog API
- Handle file validation (check format)

**Backend:**
- Create Rust command `import_video(path: String)`
- Extract video metadata using FFmpeg
- Return metadata to frontend

**Key Code:**
```rust
// src-tauri/src/commands/import.rs
use tauri::command;
use ffmpeg_next as ffmpeg;

#[command]
pub async fn import_video(path: String) -> Result<VideoMetadata, String> {
    // Initialize FFmpeg
    ffmpeg::init().unwrap();

    // Open video file
    let input = ffmpeg::format::input(&path)
        .map_err(|e| format!("Failed to open video: {}", e))?;

    // Extract metadata
    let duration = input.duration() as f64 / f64::from(ffmpeg::ffi::AV_TIME_BASE);

    // ... extract resolution, frame rate, etc.

    Ok(VideoMetadata { /* ... */ })
}
```

### Phase 3: Timeline UI (Est. 6 hours)
**Implementation:**
- Create Canvas-based timeline component
- Render clips as rectangles with thumbnails
- Implement playhead rendering
- Add time ruler with timestamps
- Handle clip selection (click events)

**Canvas Rendering Loop:**
```typescript
useEffect(() => {
  const canvas = canvasRef.current;
  const ctx = canvas.getContext('2d');

  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw time ruler
  drawTimeRuler(ctx, duration, zoom);

  // Draw clips
  clips.forEach(clip => {
    drawClip(ctx, clip, zoom);
  });

  // Draw playhead
  drawPlayhead(ctx, currentTime, zoom);
}, [clips, currentTime, zoom]);
```

### Phase 4: Video Preview Player (Est. 3 hours)
**Implementation:**
- Create `PreviewPlayer` component with HTML5 `<video>`
- Load selected clip using Tauri `convertFileSrc()` for proper URL
- Add play/pause controls
- Sync playhead with video currentTime

**Key Code:**
```tsx
// src/components/PreviewPlayer.tsx
import { convertFileSrc } from '@tauri-apps/api/tauri';

const PreviewPlayer = ({ clip }: { clip: VideoClip }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoSrc = convertFileSrc(clip.path);

  return (
    <video
      ref={videoRef}
      src={videoSrc}
      controls
      style={{ width: '100%', maxHeight: '400px' }}
    />
  );
};
```

### Phase 5: Trim Functionality (Est. 4 hours)
**Implementation:**
- Add trim handles to selected clip on timeline
- Implement drag handlers for trim handles
- Update clip `inPoint` and `outPoint` in state
- Update canvas to show trimmed region (different color/pattern)
- Update preview player to respect trim points

**Trim Handle Logic:**
```typescript
const handleTrimDrag = (clipId: string, handle: 'in' | 'out', deltaX: number) => {
  const clip = clips.find(c => c.id === clipId);
  if (!clip) return;

  const deltaTime = deltaX / pixelsPerSecond;

  if (handle === 'in') {
    const newInPoint = Math.max(0, clip.inPoint + deltaTime);
    updateClip(clipId, { inPoint: newInPoint });
  } else {
    const newOutPoint = Math.min(clip.duration, clip.outPoint + deltaTime);
    updateClip(clipId, { outPoint: newOutPoint });
  }
};
```

### Phase 6: Export (Est. 6 hours)
**Frontend:**
- Create Export dialog with save location picker
- Show progress bar during export
- Handle completion/errors

**Backend:**
- Create Rust command `export_video(clips, output_path)`
- Use FFmpeg to trim and export
- Report progress via Tauri events

**Export Implementation:**
```rust
// src-tauri/src/commands/export.rs
#[command]
pub async fn export_video(
    clips: Vec<ClipData>,
    output_path: String,
    window: tauri::Window
) -> Result<String, String> {
    for (i, clip) in clips.iter().enumerate() {
        // Build FFmpeg command
        let output = Command::new("ffmpeg")
            .args(&[
                "-i", &clip.path,
                "-ss", &clip.in_point.to_string(),
                "-t", &(clip.out_point - clip.in_point).to_string(),
                "-c:v", "libx264",
                "-c:a", "aac",
                &output_path
            ])
            .output()
            .map_err(|e| format!("FFmpeg failed: {}", e))?;

        // Emit progress
        let progress = ((i + 1) as f32 / clips.len() as f32) * 100.0;
        window.emit("export-progress", progress).unwrap();
    }

    Ok(output_path)
}
```

### Phase 7: Build & Package (Est. 2 hours)
- Configure `tauri.conf.json` with app metadata
- Add app icons (32x32, 128x128, 512x512, .icns)
- Run `tauri build`
- Test packaged .app bundle
- Create .dmg installer (optional but recommended)
- Document build process in README

---

## Performance Requirements

| Metric | Target | Testing Method |
|--------|--------|----------------|
| App launch time | < 5 seconds | Time from click to UI ready |
| Video import | < 2 seconds per file | Import 100MB MP4 file |
| Timeline rendering | 60fps | Monitor canvas render time |
| Video playback | 30fps minimum | Play 1080p video smoothly |
| Export (single clip) | Real-time or faster | 10-second clip exports in ≤ 10s |
| Memory usage | < 500MB idle | Activity Monitor |
| Memory leaks | None after 15min | Extended editing session |

---

## Testing Strategy

### Manual Testing Checklist

**Import Tests:**
- [ ] Import MP4 file via drag & drop
- [ ] Import MOV file via file picker
- [ ] Attempt to import unsupported format (should reject)
- [ ] Import multiple files at once
- [ ] Import large file (>500MB)

**Timeline Tests:**
- [ ] Clips appear on timeline after import
- [ ] Click to select clip
- [ ] Playhead is visible and positioned correctly
- [ ] Timeline scrolls horizontally when clips exceed width

**Preview Tests:**
- [ ] Selected clip plays in preview
- [ ] Play/pause buttons work
- [ ] Audio plays synchronized with video
- [ ] Video maintains aspect ratio

**Trim Tests:**
- [ ] Trim handles appear when clip selected
- [ ] Drag left handle to set IN point
- [ ] Drag right handle to set OUT point
- [ ] Preview shows trimmed region only
- [ ] Timeline visually reflects trim

**Export Tests:**
- [ ] Export single untrimmed clip
- [ ] Export single trimmed clip
- [ ] Progress bar shows during export
- [ ] Exported MP4 plays in QuickTime
- [ ] Exported MP4 has correct duration
- [ ] Exported MP4 maintains quality

**Build Tests:**
- [ ] `tauri build` completes without errors
- [ ] .app bundle created in target directory
- [ ] .app launches successfully
- [ ] No dev tools or console visible
- [ ] App runs on fresh macOS machine (no dev environment)

---

## Timeline & Milestones

**Total Time: ~27 hours (realistic for MVP)**

| Phase | Task | Est. Hours | Deadline |
|-------|------|-----------|----------|
| 1 | Project setup & architecture | 2h | Mon evening |
| 2 | Video import (drag & drop + picker) | 4h | Mon night |
| 3 | Timeline UI (Canvas-based) | 6h | Tue morning |
| 4 | Preview player | 3h | Tue afternoon |
| 5 | Trim functionality | 4h | Tue afternoon |
| 6 | Export to MP4 | 6h | Tue evening |
| 7 | Build & package | 2h | Tue night |
| | **Testing & debugging buffer** | 4h | Tue night |
| | **MVP DEADLINE** | | **Tue 10:59 PM** |

**Critical Path:**
Import → Timeline → Preview → Export → Package

**Priority:**
1. Import & Preview (validates media pipeline)
2. Export (proves end-to-end flow)
3. Timeline & Trim (core editing features)
4. Package (submission requirement)

---

## Out of Scope (Post-MVP)

The following features are **NOT required for MVP** but planned for full submission:

- Screen recording
- Webcam recording
- Multi-track timeline
- Multiple clips on timeline (MVP: single clip focus)
- Split clip functionality
- Text overlays
- Transitions
- Audio controls (volume, fade)
- Filters/effects
- Upload to cloud storage
- Keyboard shortcuts
- Undo/redo
- Auto-save
- Project file save/load
- Windows/Linux builds

---

## Risks & Mitigation

### High-Risk Items

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|------------|
| FFmpeg Rust integration complex | High | Medium | Use bundled FFmpeg binary + shell commands as fallback |
| Canvas timeline performance poor | High | Low | Optimize render loop, implement dirty region rendering |
| Export takes too long | Medium | Medium | Start with simple single-clip export, optimize later |
| Video player doesn't support codec | Medium | Low | Test with common MP4/MOV files, document supported codecs |
| Tauri build/signing issues | High | Medium | Test build process early (Phase 7), use dev cert |
| Time constraint (27+ hours in 2 days) | Critical | High | Cut features ruthlessly, focus on core loop, parallelize work if possible |

### Mitigation Strategies

1. **FFmpeg Complexity:**
   - Option A: Use `ffmpeg-sys-next` Rust crate
   - Option B: Bundle FFmpeg binary, shell out via `std::process::Command`
   - **Decision:** Start with Option B for speed, migrate to A if time permits

2. **Time Management:**
   - Build in order of critical path
   - Test export by Tuesday afternoon at latest
   - Package/build test by Tuesday evening
   - Keep scope laser-focused on MVP requirements

3. **Technical Unknowns:**
   - Allocate 4-hour debugging buffer
   - Document blockers immediately
   - Seek help early if stuck >30 minutes

---

## Definition of Done

The MVP is complete when:

- [x] User can launch ClipForge.app from Applications folder
- [x] User can import an MP4 file via drag & drop
- [x] User can import a MOV file via file picker
- [x] Imported clip appears on timeline
- [x] User can click clip to preview in video player
- [x] User can play/pause video in preview
- [x] User can drag trim handles to set IN/OUT points
- [x] User can export trimmed clip to MP4
- [x] Exported video plays correctly in QuickTime
- [x] Application is packaged as .app bundle or .dmg
- [x] README includes build and run instructions
- [x] No critical bugs in core workflow

**Ship Criteria:**
- All core features functional
- No crashes during import → preview → trim → export flow
- Export produces valid, playable MP4 file

---

## Appendix

### A. Video Player Recommendation

**Selected: HTML5 `<video>` element**

**Rationale:**
- Zero dependencies (faster setup)
- Native browser performance
- Built-in controls available
- Works seamlessly with Tauri's `convertFileSrc()`
- Perfect for MVP scope

**If more features needed:**
- **react-player**: Easy React integration, supports multiple sources
- **Plyr**: Beautiful default UI, customizable, accessible

**Implementation:**
```tsx
import { convertFileSrc } from '@tauri-apps/api/tauri';

const VideoPlayer = ({ filePath }: { filePath: string }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const src = convertFileSrc(filePath);

  return (
    <div className="player-container">
      <video
        ref={videoRef}
        src={src}
        controls
        className="w-full max-h-96"
        onLoadedMetadata={(e) => {
          console.log('Duration:', e.currentTarget.duration);
        }}
      />
    </div>
  );
};
```

### B. FFmpeg Integration Options

**Selected: Bundled FFmpeg Binary + Shell Commands**

**Setup:**
1. Download FFmpeg static binary for macOS
2. Place in `src-tauri/resources/ffmpeg`
3. Configure Tauri to bundle resource:
```json
{
  "tauri": {
    "bundle": {
      "resources": ["resources/ffmpeg"]
    }
  }
}
```
4. Execute via Rust:
```rust
use std::process::Command;

let output = Command::new("./resources/ffmpeg")
    .args(&["-i", input_path, /* ... */])
    .output()?;
```

**Alternative (if time permits):**
- Use `ffmpeg-next` Rust crate for native bindings
- Better performance, more control
- Steeper learning curve

### C. Useful Tauri APIs

```typescript
// File dialogs
import { open, save } from '@tauri-apps/api/dialog';

// Open file picker
const selected = await open({
  multiple: false,
  filters: [{
    name: 'Video',
    extensions: ['mp4', 'mov']
  }]
});

// Save dialog
const savePath = await save({
  defaultPath: 'output.mp4',
  filters: [{
    name: 'Video',
    extensions: ['mp4']
  }]
});

// Convert file path for video src
import { convertFileSrc } from '@tauri-apps/api/tauri';
const videoUrl = convertFileSrc('/path/to/video.mp4');

// Invoke Rust commands
import { invoke } from '@tauri-apps/api/tauri';
const metadata = await invoke('import_video', { path: filePath });
```

### D. Critical Dependencies

**Frontend (package.json):**
```json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "@tauri-apps/api": "^2.0.0"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.0.0",
    "typescript": "^5.0.0",
    "vite": "^5.0.0",
    "tailwindcss": "^3.4.0"
  }
}
```

**Backend (Cargo.toml):**
```toml
[dependencies]
tauri = { version = "2.0", features = ["dialog-all", "fs-all", "shell-all"] }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
tokio = { version = "1", features = ["full"] }
```

---

**Document Approval:**
- [ ] Product Lead
- [ ] Engineering Lead
- [ ] Ready to Build ✅

**Questions/Clarifications:**
Contact: [Your contact info]

---

*Good luck! Focus on the core loop and ship something that works. 72 hours goes fast.* 🚀
