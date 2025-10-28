# ClipForge Playback Guide

## Overview
ClipForge has two playback modes: **Library Mode** and **Timeline Mode**. The video preview panel automatically switches between these modes based on user actions.

---

## Video Preview Panel

### Play Button
The video preview panel has a dedicated **Play/Pause button** located in the video controls at the bottom of the preview area.

### Mode Indicator
The top-right corner of the preview panel shows the current mode:
- **"Library"** - Previewing media from the library
- **"Timeline"** - Playing back the timeline

---

## Library Mode

### Activating Library Mode
Library mode activates when you:
1. Click on a media item in the Media Library panel
2. The preview switches to "Library" mode
3. Timeline playback automatically pauses

### Playback Behavior
- **Auto-pause on load**: Video loads paused at the first frame
- **Manual play**: Click the play button in the video preview to start
- **Looping**: Video automatically loops when it reaches the end
- **Independent**: Playback is independent of the timeline

### Controls
- **Play/Pause button**: In the video preview controls
- **Scrubber**: Drag to seek to any position
- **Time display**: Shows current time / total duration

---

## Timeline Mode

### Activating Timeline Mode
Timeline mode activates when you:
1. Click the **Play button** on the timeline toolbar (when clips exist)
2. Press **Space** or **K** keyboard shortcut
3. The preview switches to "Timeline" mode

### Playback Behavior
- **Plays from playhead position**: Starts at the current playhead location
- **Multi-clip playback**: Seamlessly plays through all clips in sequence
- **Gap handling**: Shows black screen during gaps between clips
- **No looping**: Playback stops at the end of the timeline
- **Synced scrubbing**: Click the timeline ruler to seek

### Timeline Controls
- **Timeline Play/Pause button**: Primary playback control
- **Keyboard shortcuts**:
  - **Space** or **K**: Play/Pause
  - **J**: Seek backward 5 seconds
  - **L**: Seek forward 5 seconds
  - **Arrow Left/Right**: Step one frame backward/forward

---

## Switching Between Modes

### From Library to Timeline
When you're previewing media in library mode and want to play the timeline:
1. Click the Play button on the **timeline toolbar** (or press Space)
2. Preview automatically switches to timeline mode
3. Timeline playback begins

### From Timeline to Library
When you're in timeline mode and want to preview media:
1. Click any media item in the Media Library
2. Preview automatically switches to library mode
3. Timeline playback stops
4. Selected media loads paused at first frame

---

## Key Differences

| Feature | Library Mode | Timeline Mode |
|---------|-------------|---------------|
| **Source** | Single media file | All clips on timeline |
| **Loop** | Yes | No |
| **Gaps** | N/A | Black screen |
| **Trimming** | Full media | Respects trim points |
| **Activation** | Click media library item | Click timeline play |
| **Playhead** | Independent | Synced with timeline |

---

## Tips

1. **Preview before adding**: Use library mode to preview media before dragging to timeline
2. **Quick timeline preview**: Press Space to instantly switch to timeline playback
3. **Return to editing**: Click any media item to stop timeline and preview that media
4. **Frame-accurate review**: Use Arrow keys in timeline mode to step through frames
5. **Visual feedback**: Watch the mode indicator to know which mode you're in

---

## Troubleshooting

### Video won't play in library mode
- Make sure you've clicked on a media item in the library first
- Check that the play button in the video preview is clicked
- Verify the video file format is supported (MP4, MOV)

### Timeline won't play
- Ensure you have clips on the timeline
- Click the timeline Play button (not the preview play button)
- Or press Space/K keyboard shortcut
- Check that you're not in library mode (see mode indicator)

### Mode keeps switching unexpectedly
- Clicking media library items switches to library mode
- Clicking timeline play switches to timeline mode
- This is intentional behavior for smooth workflow
