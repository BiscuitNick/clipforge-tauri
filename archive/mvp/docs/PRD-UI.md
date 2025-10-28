# ClipForge UI/UX Overhaul - Key Changes Summary

## Critical Behavioral Changes from MVP

### 1. Media Library Staging Area (NEW)
**Previous (MVP):** Imported media immediately added to timeline  
**New Behavior:** 
- Media imports to staging library first
- User must explicitly drag to timeline or double-click to add
- Same media can be added multiple times as independent instances
- Each instance can have different trim settings

### 2. Timeline Positioning with Gaps
**Previous (MVP):** Clips were contiguous, auto-reflow on changes  
**New Behavior:**
- Clips have **absolute positions** on timeline
- **Gaps allowed** between clips (play as black screen)
- Deleting clip **leaves gap** (no automatic reflow)
- Drag operations only work in **empty spaces** (no overlap allowed)
- Cannot drop where another clip exists (shows "not allowed" cursor)

### 3. Drag-to-Timeline Behavior
**Previous (MVP):** Basic drag support, auto-positioning  
**New Behavior:**
- Drag from Media Library to timeline
- **Default drop position:** End of last clip (immediate following)
- Can drag to any **empty space** on timeline
- Insertion indicator shows valid drop locations
- **First clip** starts at 00:00
- **Subsequent clips** add at end: `lastClipPosition + lastClipDuration`

### 4. Independent Clip Instances
**Previous (MVP):** One media item = one timeline presence  
**New Behavior:**
- Same media can appear multiple times on timeline
- Each instance has **unique clip ID**
- Each instance has **independent trim points**
- Each instance has **independent position**
- Example: Interview.mp4 can appear 3 times with different In/Out points

### 5. No Auto-Play Preview
**Previous (MVP):** Clicking media/timeline may have auto-played  
**New Behavior:**
- Clicking media library item → loads preview **paused** at first frame
- Clicking timeline/clip → moves playhead, loads preview **paused**
- **User must click Play button** to start playback
- Media library clips loop when playing
- Timeline plays from clicked position to end (no loop)

### 6. Timeline Click Behavior
**Previous (MVP):** Various behaviors  
**New Behavior:**
- Click ruler → playhead jumps to position (paused)
- Click clip → selects clip, playhead to clip start (paused)
- Click Play button → plays from current playhead to end of timeline
- Gaps play as black screen with silence

### 7. Keyboard Controls
**Previous (MVP):** Limited or no keyboard shortcuts  
**New Behavior:**
- **Delete/Backspace**: Remove selected clip (leaves gap)
- **Cmd+C / Ctrl+C**: Copy selected clip
- **Cmd+V / Ctrl+V**: Paste clip to end of timeline
- **Space / K**: Play/Pause
- **J / L**: Rewind/Fast forward (-5s / +5s)
- **Left/Right Arrow**: Frame step or seek
- **Tab / Shift+Tab**: Cycle through clip selection
- **Escape**: Deselect current clip
- **Home/End**: Jump to start/end of timeline
- **Cmd+= / Cmd+-**: Zoom in/out
- **Cmd+0**: Fit all clips in viewport

### 8. Copy & Paste System
**Previous (MVP):** No copy/paste functionality  
**New Behavior:**
- Copy selected timeline clip with all trim settings
- Paste creates new independent instance at end of timeline
- Can paste multiple times - each is unique instance
- Clipboard persists until new clip copied or app closed
- Visual feedback: toast notifications, clip flash on copy
- Toolbar buttons + keyboard shortcuts available

### 9. Timeline Clips Panel Scope
**Previous (MVP):** May have shown all media  
**New Behavior:**
- **Only shows clips on timeline** (not media library)
- Sorted by chronological position
- Same media can appear multiple times with different sequence numbers
- Each entry is expandable to show trim details

## Layout Structure

```
┌─────────────────────────────────────────────────────────────┐
│ TOP 2/3 (480px) - Three equal horizontal panels            │
├───────────────┬───────────────┬─────────────────────────────┤
│ Media Library │ Video Preview │ Timeline Clips Panel        │
│ (Import/Stage)│ (Playback)    │ (Edit/Configure)            │
│               │               │                             │
│ - Drop Zone   │ - Mode Indic. │ - Clip List (timeline only) │
│ - Media List  │ - Player      │ - Expandable Details        │
│ - Thumbnails  │ - Controls    │ - Trim Point Editors        │
│               │               │ - Position Display          │
├───────────────┴───────────────┴─────────────────────────────┤
│ BOTTOM 1/3 (240px) - Full width timeline                   │
│                                                             │
│ - Toolbar (Zoom, Delete, etc.)                             │
│ - Time Ruler (Click to move playhead)                      │
│ - Video Track (Drag clips, Trim handles, Gaps visible)     │
│ - Scrollbar                                                 │
└─────────────────────────────────────────────────────────────┘
```

## User Workflows

### Basic Edit Workflow
1. **Import** → Drop files into Media Library (top left)
2. **Preview** → Click media item, click Play to review
3. **Add to Timeline** → Drag to timeline OR double-click (adds to end)
4. **Arrange** → Drag clips on timeline to empty spaces
5. **Trim** → Click clip, drag trim handles OR edit in Timeline Clips Panel
6. **Preview Edit** → Click timeline position, click Play
7. **Export** → Save final video

### Advanced: Using Same Clip Multiple Times
1. Import video to Media Library
2. Drag to timeline → Instance #1
3. Trim Instance #1 via Timeline Clips Panel: In=00:10, Out=00:20
4. Drag **same video** from Media Library again → Instance #2 (adds at end)
5. Trim Instance #2 differently: In=00:45, Out=00:55
6. Both instances on timeline with independent settings
7. Timeline Clips Panel shows two entries for same source file

### Creating Gaps (Black Space)
1. Add Clip A at 00:00
2. Add Clip B at 00:30 (end of A)
3. Want 5-second pause before Clip B
4. Drag Clip B to position 00:35
5. Timeline now: Clip A (00:00-00:30), Gap (00:30-00:35), Clip B (00:35-01:05)
6. Playback shows black screen during gap

## Key Technical Points

### State Structure
```typescript
// Media Library
interface MediaItem {
  id: string;              // Source media UUID
  filename: string;
  filepath: string;
  duration: number;
  thumbnailPath: string;
  usedInTimeline: boolean; // Green dot indicator
}

// Timeline Clip (can have multiple instances of same mediaId)
interface TimelineClip {
  id: string;              // UNIQUE per timeline instance
  mediaId: string;         // Reference to MediaItem
  position: number;        // Absolute timeline position (seconds)
  inPoint: number;         // Trim start (independent per instance)
  outPoint: number;        // Trim end (independent per instance)
  // ... other fields
}
```

### Gap Detection
- Timeline duration = last_clip_position + last_clip_duration
- Gaps exist where position[n] + duration[n] < position[n+1]
- Render gaps as empty space (dark background)
- During playback, display black frame when playhead in gap

### Collision Detection
```typescript
function canDropAtPosition(pos: number, duration: number, clips: TimelineClip[]): boolean {
  for (const clip of clips) {
    const clipStart = clip.position;
    const clipEnd = clip.position + (clip.outPoint - clip.inPoint);
    
    // Check for any overlap
    if ((pos >= clipStart && pos < clipEnd) ||
        (pos + duration > clipStart && pos + duration <= clipEnd) ||
        (pos <= clipStart && pos + duration >= clipEnd)) {
      return false; // Overlap detected
    }
  }
  return true; // Valid position
}
```

## Migration from MVP

### Changes Required
1. **Remove auto-add to timeline** on import
2. **Add Media Library panel** with staging area
3. **Remove auto-reflow** logic on delete/move
4. **Add gap rendering** and black frame playback
5. **Add overlap detection** for drag operations
6. **Support multiple instances** of same media (unique clip IDs)
7. **Update preview behavior** - no auto-play, explicit Play button required
8. **Add Timeline Clips Panel** with expandable details
9. **Update playback** to start from clicked position to end (not loop)
10. **Add keyboard controls** - Delete, Copy, Paste, Tab navigation, etc.
11. **Implement clipboard system** for copy/paste operations

### Implementation Notes
- This is a brand new app in early development
- **No data migration needed** - fresh start with new architecture
- Existing MVP code serves as reference but this is a complete UI rewrite
- Focus on building the new three-panel layout from scratch

## Open Questions / Future Enhancements
- [ ] Snap-to-grid settings (1s, 5s, off)
- [ ] Magnetic timeline (clips snap to adjacent edges)
- [ ] Fill gap function (drag clips to close gaps automatically)
- [ ] Multi-select clips for batch operations (Shift+Click, Cmd+Click)
- [ ] Undo/redo system (Cmd+Z, Cmd+Shift+Z)
- [ ] Keyboard shortcuts for precise positioning (nudge left/right by frames)
- [ ] Timeline markers/labels
- [ ] Nested sequences
- [ ] Cut operation (split clip at playhead: Cmd+B)
- [ ] Select all clips (Cmd+A)
- [ ] Ripple delete (delete clip and close gap: Shift+Delete)
- [ ] Duplicate clip in place (Cmd+D)
