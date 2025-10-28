# ClipForge Video Editor

A modern, lightweight video editing application built with Tauri and React. ClipForge provides a streamlined timeline-based editing experience with drag-and-drop functionality, real-time preview, and professional export capabilities.

## Features

### Core Editing
- **Media Library**: Import and organize video files with thumbnail previews
- **Timeline Editor**: Visual timeline with precise clip placement and trimming
- **Video Preview**: Real-time preview of media library items and timeline playback
- **Drag & Drop**: Intuitive clip placement with visual feedback and auto-snapping
- **Trim Tools**: Frame-accurate trimming with visual trim handles
- **Undo/Redo**: Full history support (50 states) with keyboard shortcuts

### Advanced Features
- **Smart Clip Placement**:
  - First clip auto-positions at timeline start
  - Intelligent snap-to-clip behavior (2-second threshold)
  - Automatic clip shifting to prevent overlaps
  - Maintains click offset during drag operations
- **Timeline Playback**: Play/pause with space bar, scrub through timeline
- **Clip Management**: Copy, paste, delete, and reorder clips
- **Professional Export**:
  - MP4/H.264 output with configurable quality
  - Automatic resolution and frame rate normalization
  - Gap handling with black frames
  - Real-time progress feedback

### Keyboard Shortcuts
- `Cmd/Ctrl + Z`: Undo
- `Cmd/Ctrl + Shift + Z`: Redo
- `Cmd/Ctrl + C`: Copy selected clip
- `Cmd/Ctrl + V`: Paste clip at playhead
- `Cmd/Ctrl + E`: Export timeline
- `Delete/Backspace`: Remove selected clip
- `Space`: Play/pause timeline

## Architecture

### Frontend (React)
```
src/
├── components/
│   ├── MediaLibraryPanel.jsx    # Media import and library management
│   ├── VideoPreviewPanel.jsx    # Video preview with playback controls
│   ├── TimelineClipsPanel.jsx   # Clip properties and management
│   └── Timeline.jsx              # Canvas-based timeline editor
├── hooks/
│   ├── useTimeline.js            # Timeline state and operations
│   └── useMediaLibrary.js        # Media library state management
└── App.jsx                       # Main application layout and orchestration
```

### Backend (Rust/Tauri)
```
src-tauri/src/
├── commands/
│   ├── video_import.rs           # Video file import handling
│   ├── metadata.rs               # Video metadata extraction (FFprobe)
│   ├── export.rs                 # Timeline export with FFmpeg
│   └── ffmpeg_utils.rs           # FFmpeg executable detection
└── lib.rs                        # Tauri app setup and menu configuration
```

### Key Design Patterns
- **State Management**: React hooks for local component state, lifting state for shared data
- **Command Pattern**: Undo/redo implementation with deep cloning
- **Canvas Rendering**: HTML5 Canvas for performant timeline visualization
- **Event-Driven**: Tauri events for export progress and async operations
- **Drag & Drop**: @dnd-kit for media library, custom canvas drag for timeline

## Prerequisites

### Required
- **Node.js** (v18 or higher)
- **Rust** (latest stable) - Install via [rustup](https://rustup.rs/)
- **FFmpeg** - Must be installed and available in PATH
  - macOS: `brew install ffmpeg`

### Development Tools
- npm or yarn
- Tauri CLI: `npm install -g @tauri-apps/cli`

## Getting Started

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd ClipForge-Tauri/clipforge-tauri
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Verify FFmpeg installation**
   ```bash
   ffmpeg -version
   ffprobe -version
   ```

### Development

**Run the application in development mode:**
```bash
npm run tauri:dev
```

This will:
- Start the Vite development server for hot-reloading
- Build and launch the Tauri application
- Enable React DevTools and developer console

**Development workflow:**
- Frontend changes hot-reload automatically
- Rust changes require app restart (Ctrl+C and rerun)
- Check console for errors and logs

### Building for Production

**Create an optimized production build:**
```bash
npm run tauri:build
```

This generates:
- **macOS**: `.dmg` installer in `src-tauri/target/release/bundle/dmg/`
- Optimized binary in `src-tauri/target/release/`

**Build artifacts:**
- Application bundle: `ClipForge Video Editor.app`
- Installer: `ClipForge Video Editor_<version>_<arch>.dmg`

## Usage

### Basic Workflow

1. **Import Media**
   - Click "Import Video" in the Media Library panel
   - Select one or more video files
   - Thumbnails appear in the media library

2. **Build Timeline**
   - Drag clips from media library to timeline
   - First clip auto-positions at start
   - Additional clips snap to existing clips or cursor position
   - Clips automatically shift to prevent overlaps

3. **Edit Clips**
   - Click a clip in timeline to select it
   - Drag trim handles to adjust in/out points
   - Drag clip body to reorder (maintains click offset)
   - Use Timeline Clips panel to view/edit properties

4. **Preview**
   - Click media library items to preview in Video Preview panel
   - Use timeline playhead to preview edited sequence
   - Play/pause with space bar or play button
   - Scrub timeline by dragging playhead

5. **Export**
   - Click "Export" button in timeline toolbar (or Cmd+E)
   - Choose output location and filename
   - Monitor progress in export modal
   - Final video respects all trims and timeline gaps

## Project Structure

```
clipforge-tauri/
├── src/                          # React frontend source
│   ├── components/               # React components
│   ├── hooks/                    # Custom React hooks
│   ├── App.jsx                   # Main application component
│   ├── App.css                   # Application styles
│   └── main.jsx                  # React entry point
├── src-tauri/                    # Rust backend source
│   ├── src/
│   │   ├── commands/             # Tauri command handlers
│   │   └── lib.rs                # Main Rust application
│   ├── Cargo.toml                # Rust dependencies
│   ├── tauri.conf.json           # Tauri configuration
│   └── build.rs                  # Build script
├── public/                       # Static assets
├── package.json                  # Node.js dependencies
└── vite.config.js                # Vite bundler configuration
```

## Technical Details

### Video Processing
- **Import**: FFprobe extracts metadata (duration, resolution, frame rate)
- **Preview**: HTML5 video element with currentTime control
- **Export**: FFmpeg processes clips with:
  - Trimming: `-ss` (start) and `-t` (duration)
  - Scaling: `scale` filter with padding for aspect ratio
  - Frame rate: `fps` filter for normalization
  - Encoding: libx264 (medium preset) + AAC audio
  - Concatenation: FFmpeg concat demuxer

### Timeline Implementation
- **Canvas Rendering**: Draws ruler, clips, playhead, and drag feedback
- **Time Calculations**: Pixel ↔ time conversions based on zoom level
- **Snap Logic**: Checks clip boundaries within 2-second threshold
- **Overlap Detection**: Geometric intersection detection with shift calculation
- **History Management**: Deep clones of clip array (max 50 states)

### Performance Optimizations
- **useMemo**: Memoized timeline state to prevent unnecessary re-renders
- **Canvas**: Hardware-accelerated rendering for smooth timeline interaction
- **Event Throttling**: Mouse move events processed efficiently
- **Temp Files**: FFmpeg uses temp directory for intermediate processing

## Troubleshooting

### FFmpeg not found
**Error**: "ffmpeg not found. Please install FFmpeg."

**Solution**: Ensure FFmpeg is installed and in your system PATH
```bash
# macOS
brew install ffmpeg

# Verify installation
which ffmpeg
ffmpeg -version
```

### Build fails with Rust errors
**Solution**: Update Rust toolchain
```bash
rustup update stable
```

### Import fails or shows incorrect duration
**Solution**: Verify FFprobe is installed alongside FFmpeg
```bash
ffprobe -version
```

### Export produces corrupted video
**Possible causes**:
- Mismatched codecs between clips
- Unsupported video formats
- Insufficient disk space

**Solution**: Use common formats (MP4/H.264) and ensure adequate storage

## System Requirements

### Minimum
- macOS 10.15 (Catalina) or higher
- 4GB RAM
- 2GB free disk space (plus space for projects)
- FFmpeg 4.0 or higher

### Recommended
- macOS 11.0 (Big Sur) or higher
- 8GB RAM
- SSD storage for better performance
- FFmpeg 5.0 or higher

## License

This project is licensed under the Apache License 2.0 - see the LICENSE file for details.

## Acknowledgments

Built with:
- [Tauri](https://tauri.app/) - Desktop application framework
- [React](https://react.dev/) - UI library
- [Vite](https://vitejs.dev/) - Build tool
- [FFmpeg](https://ffmpeg.org/) - Video processing
- [@dnd-kit](https://dndkit.com/) - Drag and drop utilities
