import React, { useRef, useEffect, useState, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import './PreviewWindow.css';

/**
 * PreviewWindow - Real-time screen capture preview component
 *
 * Features:
 * - Listens for preview-frame events from Tauri backend
 * - Canvas-based rendering for low-latency previews
 * - Floating overlay with drag and resize functionality
 * - FPS counter and recording indicator
 * - Performance optimizations with React.memo and useCallback
 */
const PreviewWindow = React.memo(({
  isVisible = false,
  onToggleVisibility,
  isPictureInPicture = false
}) => {
  // Canvas ref for single buffer rendering
  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  // State
  const [fps, setFps] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [metrics, setMetrics] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [position, setPosition] = useState({ x: 20, y: 20 });
  const [size, setSize] = useState({ width: 320, height: 180 });
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [lastFrameTime, setLastFrameTime] = useState(null);
  const [actualFps, setActualFps] = useState(0);
  const [frameCount, setFrameCount] = useState(0);
  const pendingImageRef = useRef(null);

  // FPS calculation interval
  const fpsIntervalRef = useRef(null);

  /**
   * Handle preview frame event from Tauri
   * Decodes JPEG payloads and draws them into the canvas.
   */
  const handlePreviewFrame = useCallback((event) => {
    const { imageData, width, height, timestamp, frameNumber, jpegSize } = event.payload;

    if (frameNumber <= 5 || frameNumber % 60 === 0) {
      console.log('[PreviewWindow] Frame received', {
        frameNumber,
        jpegSize,
        base64Length: imageData?.length ?? 0,
        width,
        height,
      });
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    // Set canvas dimensions if changed to preserve pixel fidelity
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    // Create image from base64 data
    const pendingImage = pendingImageRef.current ?? new Image();
    pendingImageRef.current = pendingImage;
    pendingImage.onload = () => {
      // Draw image to canvas
      ctx.drawImage(pendingImage, 0, 0, width, height);

      // Update FPS calculation
      const now = performance.now();
      if (lastFrameTime) {
        const elapsed = (now - lastFrameTime) / 1000; // Convert to seconds
        if (elapsed > 0) {
          const currentFps = 1 / elapsed;
          setActualFps(currentFps);
        }
      }
      setLastFrameTime(now);
      setFrameCount(prev => prev + 1);
    };
    pendingImage.onerror = (err) => {
      console.error('[PreviewWindow] Failed to decode preview frame', err);
    };
    pendingImage.src = `data:image/jpeg;base64,${imageData}`;
  }, [lastFrameTime]);

  /**
   * Handle preview metrics event from Tauri
   */
  const handlePreviewMetrics = useCallback((event) => {
    const metricsData = event.payload;
    setMetrics(metricsData);
    setFps(metricsData.currentFps || 0);
  }, []);

  /**
   * Handle preview lifecycle events
   */
  const handlePreviewStarted = useCallback(() => {
    console.log('[PreviewWindow] Preview started');
    setIsRecording(true);
    setFrameCount(0);
    setLastFrameTime(null);
  }, []);

  const handlePreviewStopped = useCallback(() => {
    console.log('[PreviewWindow] Preview stopped');
    setIsRecording(false);
  }, []);

  /**
   * Start preview stream
   */
  const startPreview = useCallback(async () => {
    try {
      await invoke('start_preview');
      console.log('[PreviewWindow] Preview started via invoke');
    } catch (error) {
      console.error('[PreviewWindow] Failed to start preview:', error);
    }
  }, []);

  /**
   * Stop preview stream
   */
  const stopPreview = useCallback(async () => {
    try {
      await invoke('stop_preview');
      console.log('[PreviewWindow] Preview stopped via invoke');
    } catch (error) {
      console.error('[PreviewWindow] Failed to stop preview:', error);
    }
  }, []);

  /**
   * Get current preview settings
   */
  const getPreviewSettings = useCallback(async () => {
    try {
      const settings = await invoke('get_preview_settings');
      console.log('[PreviewWindow] Preview settings:', settings);
      return settings;
    } catch (error) {
      console.error('[PreviewWindow] Failed to get preview settings:', error);
      return null;
    }
  }, []);

  /**
   * Update preview settings
   */
  const updatePreviewSettings = useCallback(async (settings) => {
    try {
      await invoke('update_preview_settings', { settings });
      console.log('[PreviewWindow] Preview settings updated:', settings);
    } catch (error) {
      console.error('[PreviewWindow] Failed to update preview settings:', error);
    }
  }, []);

  // Set up event listeners
  useEffect(() => {
    let unlistenFrame, unlistenMetrics, unlistenStarted, unlistenStopped;

    const setupListeners = async () => {
      unlistenFrame = await listen('preview-frame', handlePreviewFrame);
      unlistenMetrics = await listen('preview-metrics', handlePreviewMetrics);
      unlistenStarted = await listen('preview-started', handlePreviewStarted);
      unlistenStopped = await listen('preview-stopped', handlePreviewStopped);
    };

    setupListeners();

    return () => {
      if (unlistenFrame) unlistenFrame();
      if (unlistenMetrics) unlistenMetrics();
      if (unlistenStarted) unlistenStarted();
      if (unlistenStopped) unlistenStopped();
    };
  }, [handlePreviewFrame, handlePreviewMetrics, handlePreviewStarted, handlePreviewStopped]);

  // FPS counter update interval (every second)
  useEffect(() => {
    if (isRecording) {
      fpsIntervalRef.current = setInterval(() => {
        // FPS is already being updated in handlePreviewFrame
      }, 1000);
    } else {
      if (fpsIntervalRef.current) {
        clearInterval(fpsIntervalRef.current);
        fpsIntervalRef.current = null;
      }
    }

    return () => {
      if (fpsIntervalRef.current) {
        clearInterval(fpsIntervalRef.current);
      }
    };
  }, [isRecording]);

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

      {/* Canvas Container */}
      <div className="preview-canvas-container">
        <canvas
          ref={canvasRef}
          className="preview-canvas"
        />
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
