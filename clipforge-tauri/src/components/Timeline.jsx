import { useRef, useEffect, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import "./Timeline.css";

const RULER_HEIGHT = 30;
const TRACK_HEIGHT = 60;
const TRACK_PADDING = 10;
const TRIM_HANDLE_WIDTH = 8;

function Timeline({
  clips,
  playheadPosition,
  zoomLevel,
  panOffset,
  selectedClipId,
  onClipSelect,
  onPlayheadMove,
  onZoom,
  onPan,
  onTrimUpdate,
  canDrop = true,
  isPlaying = false,
  onTogglePlayback,
  onCopyClip,
  onPasteClip,
  onDeleteClip,
  hasClipboard
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [lastMouseX, setLastMouseX] = useState(0);
  const [draggingTrimHandle, setDraggingTrimHandle] = useState(null); // { clipId, handle: 'start' | 'end' }

  // Make timeline a drop zone for media items
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: 'timeline-drop-zone'
  });

  // Calculate timeline width based on clips
  const getTotalDuration = () => {
    if (!clips || clips.length === 0) return 60;
    return Math.max(...clips.map(c => {
      const trimStart = c.trimStart || 0;
      const trimEnd = c.trimEnd || c.duration;
      const trimmedDuration = trimEnd - trimStart;
      return c.startTime + trimmedDuration;
    }), 60);
  };

  const timeToPixel = (time) => {
    return time * zoomLevel - panOffset;
  };

  const pixelToTime = (pixel) => {
    return (pixel + panOffset) / zoomLevel;
  };

  // Draw timeline on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const { width, height } = canvas.getBoundingClientRect();

    // Set canvas resolution
    canvas.width = width * window.devicePixelRatio;
    canvas.height = height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Draw ruler background
    ctx.fillStyle = "#2a2a2a";
    ctx.fillRect(0, 0, width, RULER_HEIGHT);

    // Draw time ruler
    drawTimeRuler(ctx, width);

    // Draw track background
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, RULER_HEIGHT, width, TRACK_HEIGHT);

    // Draw clips
    if (clips && clips.length > 0) {
      clips.forEach(clip => drawClip(ctx, clip, width));
    }

    // Draw playhead
    drawPlayhead(ctx, width, height);

  }, [clips, playheadPosition, zoomLevel, panOffset, selectedClipId]);

  const drawTimeRuler = (ctx, width) => {
    ctx.strokeStyle = "#444";
    ctx.fillStyle = "#aaa";
    ctx.font = "11px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.textAlign = "center";

    const totalDuration = getTotalDuration();
    const secondsPerMajorTick = zoomLevel < 10 ? 10 : zoomLevel < 30 ? 5 : 1;
    const secondsPerMinorTick = secondsPerMajorTick / 5;

    // Draw ticks
    for (let time = 0; time <= totalDuration; time += secondsPerMinorTick) {
      const x = timeToPixel(time);
      if (x < -50 || x > width + 50) continue;

      const isMajorTick = time % secondsPerMajorTick === 0;

      if (isMajorTick) {
        // Major tick
        ctx.beginPath();
        ctx.moveTo(x, RULER_HEIGHT - 15);
        ctx.lineTo(x, RULER_HEIGHT);
        ctx.stroke();

        // Time label
        const minutes = Math.floor(time / 60);
        const seconds = Math.floor(time % 60);
        const label = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        ctx.fillText(label, x, RULER_HEIGHT - 18);
      } else {
        // Minor tick
        ctx.beginPath();
        ctx.moveTo(x, RULER_HEIGHT - 8);
        ctx.lineTo(x, RULER_HEIGHT);
        ctx.stroke();
      }
    }
  };

  const drawClip = (ctx, clip, canvasWidth) => {
    const startX = timeToPixel(clip.startTime);
    const trimStart = clip.trimStart || 0;
    const trimEnd = clip.trimEnd || clip.duration;
    const trimmedDuration = trimEnd - trimStart;
    const clipWidth = trimmedDuration * zoomLevel; // Use trimmed duration for width
    const y = RULER_HEIGHT + TRACK_PADDING;
    const clipHeight = TRACK_HEIGHT - (TRACK_PADDING * 2);

    // Skip if clip is outside visible area
    if (startX + clipWidth < 0 || startX > canvasWidth) return;

    const isSelected = clip.id === selectedClipId;

    // Draw clip background (only show trimmed portion)
    ctx.fillStyle = isSelected ? "#4a7ba7" : "#3a5f7d";
    ctx.fillRect(startX, y, clipWidth, clipHeight);

    // Draw clip border
    ctx.strokeStyle = isSelected ? "#6a9bc7" : "#4a6f8d";
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.strokeRect(startX, y, clipWidth, clipHeight);

    // Draw trim handles for selected clip
    if (isSelected) {
      // Left trim handle at the start of the clip
      ctx.fillStyle = "#ffcc00";
      ctx.fillRect(startX, y, TRIM_HANDLE_WIDTH, clipHeight);
      ctx.strokeStyle = "#ffaa00";
      ctx.lineWidth = 1;
      ctx.strokeRect(startX, y, TRIM_HANDLE_WIDTH, clipHeight);

      // Right trim handle at the end of the clip
      ctx.fillStyle = "#ffcc00";
      ctx.fillRect(startX + clipWidth - TRIM_HANDLE_WIDTH, y, TRIM_HANDLE_WIDTH, clipHeight);
      ctx.strokeStyle = "#ffaa00";
      ctx.lineWidth = 1;
      ctx.strokeRect(startX + clipWidth - TRIM_HANDLE_WIDTH, y, TRIM_HANDLE_WIDTH, clipHeight);

      // Draw vertical lines on handles for grip
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1;
      const gripY1 = y + clipHeight / 3;
      const gripY2 = y + (clipHeight * 2) / 3;

      // Left handle grips
      ctx.beginPath();
      ctx.moveTo(startX + 3, gripY1);
      ctx.lineTo(startX + 3, gripY2);
      ctx.moveTo(startX + 5, gripY1);
      ctx.lineTo(startX + 5, gripY2);
      ctx.stroke();

      // Right handle grips
      ctx.beginPath();
      ctx.moveTo(startX + clipWidth - 3, gripY1);
      ctx.lineTo(startX + clipWidth - 3, gripY2);
      ctx.moveTo(startX + clipWidth - 5, gripY1);
      ctx.lineTo(startX + clipWidth - 5, gripY2);
      ctx.stroke();
    }

    // Draw clip label
    ctx.fillStyle = "#fff";
    ctx.font = "12px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.textAlign = "left";

    // Clip text to clip bounds
    ctx.save();
    ctx.beginPath();
    ctx.rect(startX + (isSelected ? TRIM_HANDLE_WIDTH + 2 : 5), y, clipWidth - (isSelected ? TRIM_HANDLE_WIDTH * 2 + 4 : 10), clipHeight);
    ctx.clip();

    ctx.fillText(clip.filename, startX + (isSelected ? TRIM_HANDLE_WIDTH + 5 : 8), y + 18);
    ctx.fillText(`${trimmedDuration.toFixed(2)}s`, startX + (isSelected ? TRIM_HANDLE_WIDTH + 5 : 8), y + 33);

    ctx.restore();
  };

  const drawPlayhead = (ctx, width, height) => {
    const x = timeToPixel(playheadPosition);

    // Only draw if playhead is visible
    if (x < -10 || x > width + 10) return;

    // Draw playhead line
    ctx.strokeStyle = "#ff4444";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, RULER_HEIGHT);
    ctx.lineTo(x, height);
    ctx.stroke();

    // Draw playhead handle
    ctx.fillStyle = "#ff4444";
    ctx.beginPath();
    ctx.moveTo(x, RULER_HEIGHT);
    ctx.lineTo(x - 6, RULER_HEIGHT - 8);
    ctx.lineTo(x + 6, RULER_HEIGHT - 8);
    ctx.closePath();
    ctx.fill();
  };

  // Mouse event handlers
  const handleMouseDown = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Check if clicking on playhead
    const playheadX = timeToPixel(playheadPosition);
    if (Math.abs(x - playheadX) < 10 && y < RULER_HEIGHT + TRACK_HEIGHT) {
      setIsDraggingPlayhead(true);
      return;
    }

    // Check if clicking on trim handles (only for selected clip)
    if (selectedClipId && y > RULER_HEIGHT && y < RULER_HEIGHT + TRACK_HEIGHT) {
      const selectedClip = clips?.find(c => c.id === selectedClipId);
      if (selectedClip) {
        const startX = timeToPixel(selectedClip.startTime);
        const trimStart = selectedClip.trimStart || 0;
        const trimEnd = selectedClip.trimEnd || selectedClip.duration;
        const trimmedDuration = trimEnd - trimStart;
        const clipWidth = trimmedDuration * zoomLevel;

        // Check left trim handle
        if (x >= startX && x <= startX + TRIM_HANDLE_WIDTH) {
          setDraggingTrimHandle({ clipId: selectedClipId, handle: 'start' });
          return;
        }

        // Check right trim handle
        if (x >= startX + clipWidth - TRIM_HANDLE_WIDTH && x <= startX + clipWidth) {
          setDraggingTrimHandle({ clipId: selectedClipId, handle: 'end' });
          return;
        }
      }
    }

    // Check if clicking on a clip
    if (y > RULER_HEIGHT && y < RULER_HEIGHT + TRACK_HEIGHT) {
      const clickTime = pixelToTime(x);
      const clickedClip = clips?.find(clip => {
        const trimStart = clip.trimStart || 0;
        const trimEnd = clip.trimEnd || clip.duration;
        const trimmedDuration = trimEnd - trimStart;
        return clickTime >= clip.startTime && clickTime <= clip.startTime + trimmedDuration;
      });

      if (clickedClip) {
        onClipSelect?.(clickedClip.id);
        return;
      } else {
        onClipSelect?.(null);
      }
    }

    // Start panning
    if (e.button === 0) { // Left mouse button
      setIsPanning(true);
      setLastMouseX(x);
    }
  };

  const handleMouseMove = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;

    if (isDraggingPlayhead) {
      const newTime = Math.max(0, pixelToTime(x));
      onPlayheadMove?.(newTime);
    } else if (draggingTrimHandle) {
      // Handle trim handle dragging
      const clip = clips?.find(c => c.id === draggingTrimHandle.clipId);
      if (clip) {
        const currentTrimStart = clip.trimStart || 0;
        const currentTrimEnd = clip.trimEnd || clip.duration;
        const clipStartX = timeToPixel(clip.startTime);
        const relativeX = x - clipStartX;
        const deltaTime = relativeX / zoomLevel;

        if (draggingTrimHandle.handle === 'start') {
          // Dragging left trim handle - adjust trim start
          const newTrimStart = currentTrimStart + deltaTime;
          const validTrimStart = Math.max(0, Math.min(newTrimStart, currentTrimEnd - 0.1)); // Keep min 0.1s duration
          onTrimUpdate?.(clip.id, validTrimStart, currentTrimEnd);
        } else if (draggingTrimHandle.handle === 'end') {
          // Dragging right trim handle - adjust trim end
          const currentTrimmedDuration = currentTrimEnd - currentTrimStart;
          const newTrimEnd = currentTrimStart + deltaTime;
          const validTrimEnd = Math.max(currentTrimStart + 0.1, Math.min(newTrimEnd, clip.duration));
          onTrimUpdate?.(clip.id, currentTrimStart, validTrimEnd);
        }
      }
    } else if (isPanning) {
      const deltaX = lastMouseX - x;
      onPan?.(deltaX);
      setLastMouseX(x);
    }
  };

  const handleMouseUp = () => {
    setIsDraggingPlayhead(false);
    setIsPanning(false);
    setDraggingTrimHandle(null);
  };

  const handleWheel = (e) => {
    e.preventDefault();

    if (e.ctrlKey || e.metaKey) {
      // Zoom
      const rect = canvasRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const zoomDelta = -e.deltaY * 0.01;
      onZoom?.(zoomDelta, mouseX);
    } else {
      // Pan
      onPan?.(e.deltaX);
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignore if typing in an input field
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }

      // Copy: Cmd/Ctrl+C
      if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
        e.preventDefault();
        onCopyClip?.();
      }
      // Paste: Cmd/Ctrl+V
      else if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
        e.preventDefault();
        onPasteClip?.();
      }
      // Delete: Delete or Backspace
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (selectedClipId) {
          onDeleteClip?.(selectedClipId);
        }
      }
      // Play/Pause: Space or K
      else if (e.key === ' ' || e.key === 'k') {
        e.preventDefault();
        onTogglePlayback?.();
      }
      // Seek backward 5s: J
      else if (e.key === 'j') {
        e.preventDefault();
        const newTime = Math.max(0, playheadPosition - 5);
        onPlayheadMove?.(newTime);
      }
      // Seek forward 5s: L
      else if (e.key === 'l') {
        e.preventDefault();
        const totalDuration = getTotalDuration();
        const newTime = Math.min(totalDuration, playheadPosition + 5);
        onPlayheadMove?.(newTime);
      }
      // Frame step backward: ArrowLeft
      else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const frameTime = 1 / 30; // Assume 30fps for frame stepping
        const newTime = Math.max(0, playheadPosition - frameTime);
        onPlayheadMove?.(newTime);
      }
      // Frame step forward: ArrowRight
      else if (e.key === 'ArrowRight') {
        e.preventDefault();
        const frameTime = 1 / 30; // Assume 30fps for frame stepping
        const totalDuration = getTotalDuration();
        const newTime = Math.min(totalDuration, playheadPosition + frameTime);
        onPlayheadMove?.(newTime);
      }
      // Cycle through clips: Tab
      else if (e.key === 'Tab') {
        e.preventDefault();
        if (!clips || clips.length === 0) return;

        // Sort clips by position
        const sortedClips = [...clips].sort((a, b) => a.startTime - b.startTime);

        if (!selectedClipId) {
          // No selection, select first clip
          onClipSelect?.(sortedClips[0].id);
        } else {
          // Find current index and move to next (or previous if Shift+Tab)
          const currentIndex = sortedClips.findIndex(c => c.id === selectedClipId);
          if (currentIndex !== -1) {
            let nextIndex;
            if (e.shiftKey) {
              // Shift+Tab: previous clip
              nextIndex = currentIndex - 1;
              if (nextIndex < 0) nextIndex = sortedClips.length - 1; // Wrap to end
            } else {
              // Tab: next clip
              nextIndex = currentIndex + 1;
              if (nextIndex >= sortedClips.length) nextIndex = 0; // Wrap to start
            }
            onClipSelect?.(sortedClips[nextIndex].id);
          }
        }
      }
      // Clear selection: Escape
      else if (e.key === 'Escape') {
        e.preventDefault();
        onClipSelect?.(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedClipId, clips, playheadPosition, onCopyClip, onPasteClip, onDeleteClip, onTogglePlayback, onPlayheadMove, onClipSelect, getTotalDuration]);

  return (
    <div className="timeline-container" ref={containerRef}>
      <div
        ref={setDropRef}
        className={`timeline-drop-overlay ${isOver ? (canDrop ? 'active' : 'invalid') : ''}`}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none', zIndex: isOver ? 10 : -1 }}
      />
      <div className="timeline-controls">
        <div className="toolbar-section">
          <button
            className={`play-pause-btn ${isPlaying ? 'playing' : ''}`}
            onClick={onTogglePlayback}
            title={isPlaying ? "Pause (Space)" : "Play (Space)"}
          >
            {isPlaying ? (
              // Pause icon
              <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
              </svg>
            ) : (
              // Play icon
              <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>
          <button onClick={() => onZoom?.(0.5)} title="Zoom In">Zoom In</button>
          <button onClick={() => onZoom?.(-0.5)} title="Zoom Out">Zoom Out</button>
          <span className="zoom-level">Zoom: {zoomLevel.toFixed(1)}x</span>
        </div>
        <div className="toolbar-section">
          <button
            onClick={onCopyClip}
            disabled={!selectedClipId}
            title="Copy clip (Cmd/Ctrl+C)"
          >
            Copy
          </button>
          <button
            onClick={onPasteClip}
            disabled={!hasClipboard}
            title="Paste clip (Cmd/Ctrl+V)"
          >
            Paste
          </button>
          <button
            onClick={() => selectedClipId && onDeleteClip?.(selectedClipId)}
            disabled={!selectedClipId}
            title="Delete clip (Delete/Backspace)"
          >
            Delete
          </button>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        className="timeline-canvas"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      />
    </div>
  );
}

export default Timeline;
