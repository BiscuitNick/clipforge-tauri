# Timeline Clip Drag & Drop Enhancement Plan

## Overview
This plan enhances the timeline with intelligent clip placement, visual feedback, auto-snapping, reordering capabilities, and undo/redo support while maintaining the existing canvas-based architecture.

---

## Phase 0: Undo/Redo System
**Files to modify**: `src/hooks/useTimeline.js`

**New state and functions**:
```javascript
// History management
const [history, setHistory] = useState([])
const [historyIndex, setHistoryIndex] = useState(-1)
const MAX_HISTORY = 50 // Limit history stack

// Save state before mutations
const saveHistory = useCallback(() => {
  const newHistory = history.slice(0, historyIndex + 1)
  newHistory.push(JSON.parse(JSON.stringify(timelineClips)))

  // Limit history size
  if (newHistory.length > MAX_HISTORY) {
    newHistory.shift()
  } else {
    setHistoryIndex(prev => prev + 1)
  }

  setHistory(newHistory)
}, [history, historyIndex, timelineClips])

// Undo function
const undo = useCallback(() => {
  if (historyIndex > 0) {
    setHistoryIndex(historyIndex - 1)
    setTimelineClips(JSON.parse(JSON.stringify(history[historyIndex - 1])))
  }
}, [history, historyIndex])

// Redo function
const redo = useCallback(() => {
  if (historyIndex < history.length - 1) {
    setHistoryIndex(historyIndex + 1)
    setTimelineClips(JSON.parse(JSON.stringify(history[historyIndex + 1])))
  }
}, [history, historyIndex])

// Check if undo/redo available
const canUndo = historyIndex > 0
const canRedo = historyIndex < history.length - 1
```

**Integration points**:
- Call `saveHistory()` before ANY clip mutation:
  - `addClip()`
  - `removeClip()`
  - `updateClipTrim()`
  - `moveClip()` (new)
  - `insertClipWithShift()` (new)
- Export `undo`, `redo`, `canUndo`, `canRedo` from hook

**Keyboard shortcuts** (add to Timeline.jsx or App.jsx):
```javascript
useEffect(() => {
  const handleKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
      e.preventDefault()
      if (e.shiftKey) {
        timeline.redo()
      } else {
        timeline.undo()
      }
    }
  }

  window.addEventListener('keydown', handleKeyDown)
  return () => window.removeEventListener('keydown', handleKeyDown)
}, [timeline])
```

**UI indicators** (optional but recommended):
- Add undo/redo buttons to timeline toolbar
- Show enabled/disabled state based on `canUndo`/`canRedo`
- Display keyboard shortcuts in tooltips (⌘Z / Ctrl+Z, ⌘⇧Z / Ctrl+Shift+Z)

**Estimated complexity**: Medium

---

## Phase 1: First Clip Auto-Positioning
**Files to modify**: `src/hooks/useTimeline.js`, `src/App.jsx`

**Changes**:
1. **Update `addClip()` in useTimeline.js** (around line 43):
   - **Call `saveHistory()` BEFORE mutation**
   - Check if `timelineClips.length === 0`
   - If empty timeline and no `targetPosition` provided, force `startTime = 0`
   - Otherwise use provided `targetPosition` or append after last clip

2. **Update drop handler in App.jsx** (around line 87):
   - Pass `timelineClips.length` to determine if first clip
   - If first clip, ignore calculated drop position and use 0

**Estimated complexity**: Low

---

## Phase 2: Visual Cursor Indicators (Combination)
**Files to modify**: `src/components/Timeline.jsx`, `src/App.jsx`

**New state needed**:
```javascript
// In App.jsx
const [dragPreview, setDragPreview] = useState(null)
// Structure: { position: number, duration: number, isValid: boolean, snapType: 'start'|'end'|null }
```

**Changes**:

1. **Update `handleDragMove()` in App.jsx** (lines 59-84):
   - Calculate drop position from mouse coordinates
   - Get dragged clip duration from drag data
   - Calculate snap position (call `timeline.calculateSnapPosition()`)
   - Determine validity
   - Update `dragPreview` state with position, duration, validity, and snapType

2. **Add new rendering in Timeline.jsx**:
   - Create `drawDropPreview(dragPreview)` function to render:
     - **Vertical insertion line**: 2px wide, full height, blue color
     - **Ghost clip**: Semi-transparent rectangle (opacity: 0.4) showing clip dimensions at drop position
     - **Snap indicator**: If `snapType` exists, show dotted lines connecting to the clip being snapped to

3. **Update `draw()` function in Timeline.jsx**:
   - Call `drawDropPreview()` after drawing clips but before playhead
   - Only render if `dragPreview` exists

**Estimated complexity**: Medium

---

## Phase 3: Auto-Snap Logic (2-second seamless)
**Files to modify**: `src/hooks/useTimeline.js`

**New function**: `calculateSnapPosition(targetPosition, duration, excludeClipId = null)`

**Logic**:
```javascript
calculateSnapPosition(targetPosition, duration, excludeClipId = null) {
  const SNAP_THRESHOLD = 2.0 // seconds
  let snappedPosition = targetPosition
  let snapType = null // 'start', 'end', or null
  let snapToClipId = null

  // Check all existing clips for snap opportunities
  for (const clip of timelineClips) {
    if (clip.id === excludeClipId) continue

    const clipStart = clip.startTime
    const clipEnd = clip.startTime + (clip.trimEnd - clip.trimStart)

    // Snap to end of clip (seamless continuation)
    if (Math.abs(targetPosition - clipEnd) < SNAP_THRESHOLD) {
      snappedPosition = clipEnd
      snapType = 'end'
      snapToClipId = clip.id
      break
    }

    // Snap to start of clip (place before)
    const newClipEnd = targetPosition + duration
    if (Math.abs(clip.startTime - newClipEnd) < SNAP_THRESHOLD) {
      snappedPosition = clip.startTime - duration
      snapType = 'start'
      snapToClipId = clip.id
      break
    }
  }

  // Ensure position doesn't go negative
  snappedPosition = Math.max(0, snappedPosition)

  return { position: snappedPosition, snapType, snapToClipId }
}
```

**Integration points**:
- Call from `handleDragMove()` to show snap preview
- Call from drop handler before `addClip()` or `insertClipWithShift()`
- Call from `handleMouseMove()` during clip reordering (Phase 5)
- Export from hook for use in App.jsx

**Estimated complexity**: Medium

---

## Phase 4: Clip Overlap Handling (Shift All Clips)
**Files to modify**: `src/hooks/useTimeline.js`

**New function**: `insertClipWithShift(newClip, targetPosition)`

**Logic**:
```javascript
insertClipWithShift(newClip, targetPosition) {
  // Save history BEFORE mutation
  saveHistory()

  const duration = newClip.trimEnd - newClip.trimStart
  const insertEnd = targetPosition + duration

  // Find first clip that overlaps or comes after insertion point
  const sortedClips = [...timelineClips].sort((a, b) => a.startTime - b.startTime)
  const firstConflictIndex = sortedClips.findIndex(clip => {
    return clip.startTime < insertEnd
  })

  if (firstConflictIndex !== -1) {
    const firstConflict = sortedClips[firstConflictIndex]
    const shiftAmount = insertEnd - firstConflict.startTime

    // Shift all clips from conflict point onward
    const updatedClips = sortedClips.map((clip, idx) => {
      if (idx >= firstConflictIndex) {
        return { ...clip, startTime: clip.startTime + shiftAmount }
      }
      return clip
    })

    // Add new clip and sort
    const finalClips = [...updatedClips, newClip].sort((a, b) => a.startTime - b.startTime)
    setTimelineClips(finalClips)
  } else {
    // No conflicts, just add and sort
    const finalClips = [...timelineClips, newClip].sort((a, b) => a.startTime - b.startTime)
    setTimelineClips(finalClips)
  }
}
```

**Integration**:
- Call from drop handler in App.jsx instead of current `addClip()`
- Remove collision validation check
- Visual preview (Phase 2) shows where clips will shift

**Estimated complexity**: High

---

## Phase 5: Timeline Clip Reordering
**Files to modify**: `src/components/Timeline.jsx`, `src/hooks/useTimeline.js`

**New state in Timeline.jsx**:
```javascript
const [draggingClip, setDraggingClip] = useState(null)
// Structure: { clipId: string, originalPosition: number, currentPosition: number }
```

**Changes**:

1. **Update `handleMouseDown()` in Timeline.jsx** (around line 291):
   - Check priority order:
     1. Trim handle (existing - highest priority)
     2. Clip body for dragging (new - medium priority)
     3. Timeline background (existing - lowest priority)
   - If clicking on clip body (not trim handle):
     - Set `draggingClip` state
     - Store original position
     - Change cursor to `grabbing`

2. **Update `handleMouseMove()` in Timeline.jsx**:
   - Check priority order:
     1. Trim handle dragging (existing)
     2. Clip reordering (new)
     3. Playhead seeking (existing)
   - If `draggingClip` exists:
     - Calculate new position from mouse coordinates using `pixelToTime()`
     - Get clip duration for snap calculation
     - Apply snap logic: `timeline.calculateSnapPosition(newPos, duration, draggingClip.clipId)`
     - Update `draggingClip.currentPosition`
     - Trigger redraw

3. **Update `handleMouseUp()` in Timeline.jsx**:
   - If `draggingClip` exists:
     - Call `timeline.moveClip(clipId, currentPosition)`
     - Clear `draggingClip` state
     - Reset cursor

4. **New function in useTimeline.js**: `moveClip(clipId, newPosition)`
   ```javascript
   moveClip(clipId, newPosition) {
     // Save history BEFORE mutation
     saveHistory()

     const updatedClips = timelineClips.map(clip => {
       if (clip.id === clipId) {
         return { ...clip, startTime: Math.max(0, newPosition) }
       }
       return clip
     })

     // Sort clips by start time for visual consistency
     updatedClips.sort((a, b) => a.startTime - b.startTime)
     setTimelineClips(updatedClips)
   }
   ```

**Visual feedback during drag**:
- Render dragged clip with 50% opacity at new position
- Show original position with dotted outline (different color)
- Show snap indicators if within range (dotted line to snap target)

**Estimated complexity**: High

---

## Phase 6: Rendering Updates
**Files to modify**: `src/components/Timeline.jsx`

**Changes**:
1. **Update `drawClip()`** to accept optional `opacity` parameter (default: 1.0)
2. **Add `drawClipOutline(clip, color)`** for showing original position during reorder:
   ```javascript
   drawClipOutline(clip, color = '#888') {
     const x = timeToPixel(clip.startTime)
     const duration = clip.trimEnd - clip.trimStart
     const width = duration * zoomLevel

     ctx.strokeStyle = color
     ctx.setLineDash([5, 5])
     ctx.lineWidth = 2
     ctx.strokeRect(x, TIMELINE_TOP, width, TIMELINE_HEIGHT)
     ctx.setLineDash([])
   }
   ```

3. **Update `draw()` loop** to handle dragging clip:
   ```javascript
   // Draw all clips except the one being dragged
   timelineClips.forEach(clip => {
     if (draggingClip && clip.id === draggingClip.clipId) {
       // Draw outline at original position
       drawClipOutline(clip, '#666')
     } else {
       drawClip(clip)
     }
   })

   // Draw dragging clip at new position
   if (draggingClip) {
     const draggingClipData = timelineClips.find(c => c.id === draggingClip.clipId)
     const tempClip = { ...draggingClipData, startTime: draggingClip.currentPosition }
     drawClip(tempClip, 0.5) // 50% opacity
   }
   ```

**Estimated complexity**: Low

---

## Phase 7: Undo/Redo UI
**Files to modify**: `src/components/Timeline.jsx` or create new `TimelineToolbar.jsx`

**Optional UI additions**:
```javascript
// Add to timeline controls area
<div className="timeline-controls">
  <button
    onClick={timeline.undo}
    disabled={!timeline.canUndo}
    title="Undo (⌘Z)"
  >
    ↶ Undo
  </button>
  <button
    onClick={timeline.redo}
    disabled={!timeline.canRedo}
    title="Redo (⌘⇧Z)"
  >
    ↷ Redo
  </button>
</div>
```

**Estimated complexity**: Low

---

## Testing Strategy

### Phase 0 - Undo/Redo
- [ ] Add clip → undo → clip removed
- [ ] Add clip → undo → redo → clip restored
- [ ] Multiple operations → undo multiple times → correct state
- [ ] Undo to beginning → canUndo = false
- [ ] Redo to end → canRedo = false
- [ ] Keyboard shortcuts work (⌘Z, ⌘⇧Z / Ctrl+Z, Ctrl+Shift+Z)
- [ ] History limit respected (max 50 states)
- [ ] New operation after undo → clears redo history

### Phase 1 - First Clip
- [ ] Empty timeline: drop clip → starts at 0
- [ ] Empty timeline: drop clip at cursor position → ignores cursor, starts at 0
- [ ] Undo first clip addition → timeline empty again

### Phase 3 - Auto-Snap
- [ ] Drop within 2sec of clip end → snaps seamlessly
- [ ] Drop within 2sec of clip start → snaps before with no gap
- [ ] Drop >2sec away → no snapping, exact cursor position
- [ ] Snap doesn't create negative position (clamps to 0)

### Phase 2 - Visual Feedback
- [ ] Drag over timeline → vertical line follows cursor
- [ ] Drag over timeline → ghost clip shows at cursor
- [ ] Snap detected → dotted line shows connection to target clip

### Phase 4 - Shift Clips
- [ ] Drop on occupied position → all clips shift right
- [ ] Shift amount equals new clip duration
- [ ] Clips maintain relative spacing after shift
- [ ] Undo shift operation → all clips return to original positions

### Phase 5 - Reorder
- [ ] Click and drag clip → moves on timeline
- [ ] Drag near another clip → snaps if within 2sec
- [ ] Drop creates gap → gap is allowed
- [ ] Can drag clip to any position including time=0
- [ ] Undo reorder → clip returns to original position
- [ ] Original position shows as dotted outline while dragging
- [ ] Dragged clip shows at 50% opacity

### Edge Cases
- [ ] Undo/redo with trimmed clips → trim values preserved
- [ ] Multiple rapid drops → history tracks each operation
- [ ] Undo during active drag → safe handling
- [ ] Drag clip while another operation in progress → proper priority handling

---

## Implementation Order

1. **Phase 0** (Undo/Redo System) - Foundation for all operations
2. **Phase 1** (First clip auto-positioning) - Simple starting point
3. **Phase 3** (Snap logic) - Core algorithm needed by other phases
4. **Phase 2** (Visual indicators) - Uses snap logic for preview
5. **Phase 4** (Shift clips) - Replaces collision prevention
6. **Phase 5** (Reordering) - Uses snap logic and visual patterns from Phase 2
7. **Phase 6** (Rendering updates) - Polish for reordering
8. **Phase 7** (Undo/Redo UI) - Optional polish

---

## Key Files Summary

| File | Changes |
|------|---------|
| `src/hooks/useTimeline.js` | **New**: `saveHistory`, `undo`, `redo`, `calculateSnapPosition`, `insertClipWithShift`, `moveClip`; **Modified**: `addClip`, `removeClip`, `updateClipTrim` (add saveHistory calls) |
| `src/components/Timeline.jsx` | **New**: `drawDropPreview`, `drawClipOutline`; **Modified**: mouse handlers for reordering, `draw()` loop; **New state**: `draggingClip`; **New effect**: keyboard shortcuts |
| `src/App.jsx` | **New state**: `dragPreview`; **Modified**: `handleDragMove`, drop handler |
