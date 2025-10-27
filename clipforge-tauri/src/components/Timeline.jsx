import { useRef, useEffect, useState } from "react";
import "./Timeline.css";

const RULER_HEIGHT = 30;
const TRACK_HEIGHT = 60;
const TRACK_PADDING = 10;

function Timeline({ clips, playheadPosition, zoomLevel, panOffset, selectedClipId, onClipSelect, onPlayheadMove, onZoom, onPan }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [lastMouseX, setLastMouseX] = useState(0);

  // Calculate timeline width based on clips
  const getTotalDuration = () => {
    if (!clips || clips.length === 0) return 60;
    return Math.max(...clips.map(c => c.startTime + c.duration), 60);
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
    const clipWidth = (clip.duration * zoomLevel);
    const y = RULER_HEIGHT + TRACK_PADDING;
    const clipHeight = TRACK_HEIGHT - (TRACK_PADDING * 2);

    // Skip if clip is outside visible area
    if (startX + clipWidth < 0 || startX > canvasWidth) return;

    const isSelected = clip.id === selectedClipId;

    // Draw clip background
    ctx.fillStyle = isSelected ? "#4a7ba7" : "#3a5f7d";
    ctx.fillRect(startX, y, clipWidth, clipHeight);

    // Draw clip border
    ctx.strokeStyle = isSelected ? "#6a9bc7" : "#4a6f8d";
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.strokeRect(startX, y, clipWidth, clipHeight);

    // Draw clip label
    ctx.fillStyle = "#fff";
    ctx.font = "12px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.textAlign = "left";

    // Clip text to clip bounds
    ctx.save();
    ctx.beginPath();
    ctx.rect(startX + 5, y, clipWidth - 10, clipHeight);
    ctx.clip();

    ctx.fillText(clip.filename, startX + 8, y + 18);
    ctx.fillText(`${clip.duration.toFixed(2)}s`, startX + 8, y + 33);

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

    // Check if clicking on a clip
    if (y > RULER_HEIGHT && y < RULER_HEIGHT + TRACK_HEIGHT) {
      const clickTime = pixelToTime(x);
      const clickedClip = clips?.find(clip =>
        clickTime >= clip.startTime && clickTime <= clip.startTime + clip.duration
      );

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
    } else if (isPanning) {
      const deltaX = lastMouseX - x;
      onPan?.(deltaX);
      setLastMouseX(x);
    }
  };

  const handleMouseUp = () => {
    setIsDraggingPlayhead(false);
    setIsPanning(false);
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

  return (
    <div className="timeline-container" ref={containerRef}>
      <div className="timeline-controls">
        <button onClick={() => onZoom?.(0.5)}>Zoom In</button>
        <button onClick={() => onZoom?.(-0.5)}>Zoom Out</button>
        <span className="zoom-level">Zoom: {zoomLevel.toFixed(1)}x</span>
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
