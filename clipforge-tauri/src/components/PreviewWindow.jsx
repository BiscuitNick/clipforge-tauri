import React, { useRef, useEffect, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import './PreviewWindow.css';
import usePreviewStream from '../hooks/usePreviewStream';
import useCompositePreview from '../hooks/useCompositePreview';

/**
 * PreviewWindow - Real-time preview component with source selection
 *
 * Features:
 * - Multiple preview sources (Screen, Webcam, Screen+Webcam, Timeline)
 * - Canvas-based rendering for low-latency previews
 * - Floating overlay with drag and resize functionality
 * - FPS counter and recording indicator
 * - Performance optimizations with React.memo and useCallback
 */
const PreviewWindow = React.memo(({
  isVisible = false,
  onToggleVisibility,
  isPictureInPicture = false,
  // Additional props for different preview sources
  webcamStream = null,
  pipConfig = null,
  isPiPRecording = false,
  timelineState = null,
  selectedMedia = null,
  previewMode = 'library'
}) => {
  const containerRef = useRef(null);
  const webcamVideoRef = useRef(null);
  const timelineVideoRef = useRef(null);

  // State
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [position, setPosition] = useState({ x: 20, y: 20 });
  const [size, setSize] = useState({ width: 320, height: 180 });
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [selectedSource, setSelectedSource] = useState('screen'); // 'screen', 'webcam', 'composite', 'timeline'

  // Preview streams for different sources
  // Enable screen preview when showing screen OR composite (composite needs screen as input)
  const { canvasRef: screenCanvasRef, fps, actualFps, metrics, isRecording, hasFrame: hasPreviewFrame } = usePreviewStream(
    isVisible && (selectedSource === 'screen' || selectedSource === 'composite')
  );

  // Composite preview (Screen + Webcam) - needs both screen canvas and webcam video
  const isPiPConfigured = pipConfig && pipConfig.cameraId && webcamStream;
  const compositeEnabled = isVisible && selectedSource === 'composite' && isPiPConfigured && hasPreviewFrame && webcamStream;

  const { compositeCanvasRef } = useCompositePreview(
    screenCanvasRef.current,
    webcamVideoRef.current,
    pipConfig,
    compositeEnabled
  );

  // Set up webcam video element when webcam stream is available
  useEffect(() => {
    const shouldShowWebcam =
      isVisible && (selectedSource === 'webcam' || selectedSource === 'composite');

    const video = webcamVideoRef.current;
    if (!video) return;

    if (shouldShowWebcam && webcamStream) {
      video.srcObject = webcamStream;
      video.play().catch(() => {
        // Webcam play failed
      });
    } else {
      video.srcObject = null;
    }
  }, [webcamStream, selectedSource, isVisible]);

  // Set up timeline video playback
  useEffect(() => {
    if (selectedSource === 'timeline' && timelineVideoRef.current && timelineState) {
      const clip = timelineState.getClipAtTime(timelineState.playheadPosition);
      if (clip) {
        // Update video source if clip changed
        if (timelineVideoRef.current.src !== clip.videoPath) {
          timelineVideoRef.current.src = clip.videoPath;
        }

        // Calculate time within the clip
        const timeInClip = timelineState.playheadPosition - clip.startTime + clip.trimStart;

        // Sync video time if needed
        if (Math.abs(timelineVideoRef.current.currentTime - timeInClip) > 0.1) {
          timelineVideoRef.current.currentTime = timeInClip;
        }

        // Play/pause based on timeline state
        if (timelineState.isPlaying && timelineVideoRef.current.paused) {
          timelineVideoRef.current.play();
        } else if (!timelineState.isPlaying && !timelineVideoRef.current.paused) {
          timelineVideoRef.current.pause();
        }
      }
    }
  }, [selectedSource, timelineState]);

  // Handle source selection change
  const handleSourceChange = useCallback((e) => {
    setSelectedSource(e.target.value);
  }, []);

  /**
   * Drag functionality
   */
  const handleMouseDown = useCallback((e) => {
    if (e.target.classList.contains('preview-drag-handle')) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
      e.preventDefault();
    }
  }, [position]);

  const handleMouseMove = useCallback((e) => {
    if (isDragging) {
      setPosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    } else if (isResizing) {
      const newWidth = Math.max(160, resizeStart.width + (e.clientX - resizeStart.x));
      const newHeight = Math.max(90, resizeStart.height + (e.clientY - resizeStart.y));
      setSize({ width: newWidth, height: newHeight });
    }
  }, [isDragging, isResizing, dragStart, resizeStart]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setIsResizing(false);
  }, []);

  /**
   * Resize functionality
   */
  const handleResizeMouseDown = useCallback((e) => {
    setIsResizing(true);
    setResizeStart({
      x: e.clientX,
      y: e.clientY,
      width: size.width,
      height: size.height
    });
    e.preventDefault();
    e.stopPropagation();
  }, [size]);

  // Add/remove global mouse event listeners for drag and resize
  useEffect(() => {
    if (isDragging || isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, isResizing, handleMouseMove, handleMouseUp]);

  if (!isVisible) {
    return null;
  }

  const containerStyle = {
    left: `${position.x}px`,
    top: `${position.y}px`,
    width: `${size.width}px`,
    height: `${size.height}px`
  };

  return (
    <div
      ref={containerRef}
      className={`preview-window ${isPictureInPicture ? 'pip-mode' : ''} ${isDragging ? 'dragging' : ''} ${isResizing ? 'resizing' : ''}`}
      style={containerStyle}
    >
      {/* Drag Handle */}
      <div className="preview-drag-handle" onMouseDown={handleMouseDown}>
        <span className="preview-title">Preview</span>
        <select
          className="preview-source-selector"
          value={selectedSource}
          onChange={handleSourceChange}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <option value="screen">Selected Screen</option>
          <option value="webcam" disabled={!webcamStream}>Webcam</option>
          <option value="composite" disabled={!webcamStream || !pipConfig}>Screen + Webcam</option>
          <option value="timeline" disabled={!timelineState}>Timeline</option>
        </select>
        <div className="preview-controls">
          {!isPictureInPicture && (
            <button
              className="preview-control-btn"
              onClick={onToggleVisibility}
              title="Hide preview"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Canvas/Video Container */}
      <div className="preview-canvas-container">
        {/* Selected Screen - ScreenCaptureKit preview */}
        {selectedSource === 'screen' && (
          <canvas
            ref={screenCanvasRef}
            className="preview-canvas"
          />
        )}

        {/* Webcam only */}
        {selectedSource === 'webcam' && (
          <video
            ref={webcamVideoRef}
            className="preview-video"
            autoPlay
            playsInline
            muted
          />
        )}

        {/* Screen + Webcam composite */}
        {selectedSource === 'composite' && (
          <>
            {/* Hidden screen canvas for composite source */}
            <canvas
              ref={screenCanvasRef}
              style={{ display: 'none' }}
            />
            {/* Hidden webcam video for composite source */}
            <video
              ref={webcamVideoRef}
              autoPlay
              playsInline
              muted
              style={{ display: 'none' }}
            />
            {/* Visible composite canvas */}
            <canvas
              ref={compositeCanvasRef}
              className="preview-canvas"
            />
          </>
        )}

        {/* Timeline playback */}
        {selectedSource === 'timeline' && (
          <video
            ref={timelineVideoRef}
            className="preview-video"
            playsInline
          />
        )}
      </div>

      {/* Overlay Information */}
      <div className="preview-overlay">
        {/* Recording Indicator */}
        {isRecording && (
          <div className="preview-recording-indicator">
            <span className="recording-dot"></span>
            <span className="recording-text">REC</span>
          </div>
        )}

        {/* FPS Counter */}
        <div className="preview-fps-counter">
          {actualFps > 0 ? `${actualFps.toFixed(1)} FPS` : '-- FPS'}
        </div>

        {/* Metrics Display (optional, for debugging) */}
        {metrics && (
          <div className="preview-metrics">
            <div className="metric-item">Frames: {metrics.totalFrames}</div>
            <div className="metric-item">Dropped: {metrics.droppedFrames}</div>
            <div className="metric-item">Queue: {metrics.queueSize}</div>
          </div>
        )}
      </div>

      {/* Resize Handle */}
      <div className="preview-resize-handle" onMouseDown={handleResizeMouseDown}>
        <div className="resize-corner"></div>
      </div>
    </div>
  );
});

PreviewWindow.displayName = 'PreviewWindow';

export default PreviewWindow;
