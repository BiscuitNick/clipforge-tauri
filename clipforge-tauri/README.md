# ClipForge

A powerful timeline-based video editor built with Tauri, React, and Rust.

## Platform Support

**✅ macOS** - Fully tested and verified
**⚠️ Windows/Linux** - Not yet verified (may work but untested)

ClipForge uses native macOS frameworks (ScreenCaptureKit) for screen recording, which provides optimal performance on Apple Silicon and Intel Macs. Windows and Linux support is planned for future releases.

## Features

- **Timeline-Based Editing** - Drag and drop video clips onto a professional timeline
- **Real-Time Preview** - See your edits in real-time with smooth playback
- **Screen Recording** - Native screen and window capture with live preview
- **Webcam Recording** - Record from your webcam with Picture-in-Picture support
- **Trim & Split** - Precise clip trimming and splitting tools
- **Professional Export** - High-quality video export powered by FFmpeg
- **Keyboard Shortcuts** - Full keyboard shortcut support for efficient editing

## Recent Updates

### v4.6 (Latest)
- **Fixed**: Timeline video playback black screen bug
  - Video preview now correctly resumes playback after clip ends
  - Playback works reliably when moving between clips and gaps
  - Video element properly maintains state during timeline navigation

### v4.5
- Fixed macOS app permissions error

### v4.4
- Fixed macOS app launch issue

## Requirements

### macOS (Recommended)
- macOS 11.0 (Big Sur) or later
- FFmpeg installed via Homebrew: `brew install ffmpeg`

### Windows/Linux (Untested)
- FFmpeg must be installed separately
  - Windows: Download from [ffmpeg.org](https://ffmpeg.org/download.html)
  - Linux: `sudo apt install ffmpeg` or `sudo dnf install ffmpeg`

## Installation

### macOS
1. Download the latest `.dmg` file from [Releases](https://github.com/yourusername/clipforge/releases)
2. Open the DMG and drag ClipForge to Applications
3. Install FFmpeg if not already installed: `brew install ffmpeg`
4. Launch ClipForge from Applications

### Building from Source
```bash
# Install dependencies
cd clipforge-tauri
npm install

# Development mode
npm run start

# Build production app
npm run build:macos
```

## Usage

### Basic Workflow
1. **Import Media** - Click "Import" in the Media Library panel
2. **Add to Timeline** - Drag clips from the library to the timeline
3. **Edit Clips** - Select clips to trim, split, or reorder
4. **Preview** - Use the play button on the timeline to preview your edit
5. **Export** - Click "Export" to render your final video

### Keyboard Shortcuts

#### Playback
- `Space` or `K` - Play/Pause timeline
- `J` - Seek backward 5 seconds
- `L` - Seek forward 5 seconds
- `Arrow Left/Right` - Step one frame backward/forward

#### Editing
- `Cmd/Ctrl + C` - Copy selected clip
- `Cmd/Ctrl + V` - Paste clip
- `Cmd/Ctrl + Shift + S` - Split clip at playhead
- `Delete` or `Backspace` - Delete selected clip
- `Tab` - Select next clip
- `Shift + Tab` - Select previous clip
- `Escape` - Clear selection

#### Timeline
- `Cmd/Ctrl + Z` - Undo
- `Cmd/Ctrl + Shift + Z` - Redo
- `Cmd/Ctrl + E` - Export timeline

#### Panels
- `Cmd/Ctrl + P` - Toggle preview window

## Known Issues

- Windows and Linux builds are untested and may have platform-specific issues
- Large video files (>1GB) may require significant memory during export

## Development

### Tech Stack
- **Frontend**: React + Vite
- **Backend**: Rust + Tauri 2.0
- **Video Processing**: FFmpeg
- **Recording**: ScreenCaptureKit (macOS)

### Project Structure
```
clipforge-tauri/
├── src/                    # React frontend
│   ├── components/        # UI components
│   ├── hooks/            # Custom React hooks
│   └── App.jsx           # Main app component
├── src-tauri/            # Rust backend
│   └── src/
│       ├── commands/     # Tauri commands
│       └── lib.rs        # Main Rust entry point
└── README.md
```

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## License

[Add your license here]

## Contributing

Contributions are welcome! Please open an issue or pull request.

## Support

If you encounter any issues, please [open an issue](https://github.com/yourusername/clipforge/issues) with:
- Your operating system and version
- Steps to reproduce the problem
- Any error messages or logs
