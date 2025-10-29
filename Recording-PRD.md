# Phase 1: Recording Infrastructure

**Priority:** 1 (Critical)  
**Goal:** Enable users to create content directly within the app

---

## Overview

Phase 1 adds complete recording capabilities to ClipForge, allowing users to capture:
- Screen content (full screen or specific windows)
- Webcam video
- Microphone audio
- System audio (screen recording)
- Combined screen + webcam (Picture-in-Picture)

This is the most critical missing feature from the requirements and provides the highest user value.

---

## 1.1 Screen Recording

### Backend (Rust/Tauri)

**Core Commands:**
- List available screens and windows
- Start screen recording with audio options
- Stop recording and return file path
- Get recording status (duration, file size)

**Data Requirements:**
- Screen source ID, name, and type (screen/window)
- Recording status (is_recording, duration, file_size)
- Optional thumbnail previews

**Recording Configuration:**
- Resolution: 1920x1080 or native display resolution
- Frame Rate: 30 fps (configurable to 60 fps)
- Video Codec: H.264
- Audio Codec: AAC
- Container: MP4 or WebM

**Key Tasks:**
- Create `recording.rs` module in commands
- Handle system permissions for screen/audio capture
- Implement recording state management
- Add recording duration tracking
- Handle file writing with cleanup on errors

### Frontend (React)

**New Components:**
- Recording button in Media Library panel
- Recording modal with screen/window selection
- Recording status indicator (red dot, timer)
- Stop recording controls

**Modal UI Elements:**
- Thumbnail grid of available screens/windows
- Audio inclusion checkbox
- Start/Stop recording buttons
- Recording duration display (MM:SS)
- Cancel option

**Integration:**
- Auto-import completed recordings to media library
- Generate thumbnails for recorded files
- Handle recording errors with user-friendly messages

---

## 1.2 Webcam Recording

### Backend (Rust/Tauri)

**Core Commands:**
- List available cameras
- Start webcam recording with resolution options
- Handle camera permissions

**Alternative Approach:**
- Use web standard MediaRecorder API in frontend
- Tauri command to save blob data to file
- Optional: Convert WebM to MP4 using FFmpeg

### Frontend (React)

**Key Features:**
- "Record Webcam" button in Media Library
- Camera selection dropdown
- Live preview window during recording
- Recording controls (start, stop, pause)
- Audio inclusion toggle

**Implementation:**
- Use `navigator.mediaDevices.getUserMedia()` for camera access
- MediaRecorder API for recording
- Save recorded blob via Tauri command
- Display live preview with HTML5 video element

---

## 1.3 Audio Capture

### Backend (Rust/Tauri)

**Core Commands:**
- List available audio input devices (microphones)
- Configure audio capture alongside video

**Integration:**
- Screen recording includes system audio
- Webcam recording uses MediaRecorder for microphone audio

### Frontend (React)

**Key Features:**
- Microphone selection in recording modals
- Audio level indicator (VU meter)
- Mute/unmute toggle
- Visual feedback for audio levels

**Audio Level Indicator:**
- Use Web Audio API with AnalyserNode
- Display real-time audio levels
- Color coding (green = normal, red = clipping)

---

## 1.4 Picture-in-Picture Recording

### Backend (Rust/Tauri)

**Core Commands:**
- Start simultaneous screen + webcam capture
- Configure PiP position and size

**PiP Configuration:**
- Position: top-left, top-right, bottom-left, bottom-right
- Size: small, medium, large
- Margin from edges (pixels)

**Implementation Approach:**
- **Option 1:** Composite during recording (complex, real-time)
- **Option 2:** Record separately, composite during export (recommended)

### Frontend (React)

**Key Features:**
- "Record Screen + Webcam" option
- PiP position selector (4 corners)
- PiP size selector (small/medium/large)
- Live preview showing composite layout

**PiP Configuration UI:**
- Visual position selector with preview
- Size dropdown
- Preview showing webcam overlay position

**Export Integration:**
- Store both video file paths with PiP config
- Use FFmpeg overlay filter during export
- Calculate position based on configuration

---

## Testing Checklist

### Screen Recording
- [ ] List available screens and windows
- [ ] Record full screen
- [ ] Record specific window
- [ ] Include/exclude system audio
- [ ] Handle permission dialogs
- [ ] Stop recording cleanly
- [ ] Auto-import to media library

### Webcam Recording
- [ ] List available cameras
- [ ] Live preview during recording
- [ ] Include/exclude microphone audio
- [ ] Select different microphone
- [ ] Audio level indicator works
- [ ] Recording duration displayed

### PiP Recording
- [ ] Record screen + webcam simultaneously
- [ ] Configure PiP position (all 4 corners)
- [ ] Configure PiP size (small, medium, large)
- [ ] Preview shows correct layout
- [ ] Export composites correctly
- [ ] Audio from screen recording only

### Edge Cases
- [ ] No camera available
- [ ] No microphone available
- [ ] Permission denied
- [ ] Cancel recording
- [ ] Disk space error during recording
- [ ] Recording long videos (>30 min)

---

## Performance Considerations

**Memory Management:**
- Don't buffer entire recording in memory
- Write to disk in chunks
- Clean up temp files on errors

**CPU Usage:**
- Use hardware encoding when available
- Limit frame rate to 30fps for better performance
- Consider lower resolution options

**File Size:**
- Use reasonable bitrate (5-8 Mbps for 1080p)
- Avoid lossless recording
- Consider max recording duration limits

---

## Error Handling

**Common Errors:**
- Permission denied (screen/camera/microphone)
- Device not available
- Disk space error
- Encoding failure

**User-Friendly Messages:**
- "Please grant permission to record your screen in System Settings"
- "Could not find recording device. Please check your camera/microphone"
- "Not enough disk space to save recording"
- "Recording failed. Please try again"

---

## Next Steps After Phase 1

Once recording is complete:
1. Test all recording modes thoroughly
2. Ensure recordings appear in media library
3. Verify recordings can be added to timeline
4. Confirm recordings can be trimmed and edited
5. Test export with recorded content
6. Move to Phase 2: Split Clips & Multi-track

**Success Criteria:**
- Users can record screen with audio
- Users can record webcam with audio
- Users can record PiP (screen + webcam)
- All recordings automatically import to media library
- Recordings work with existing editing features