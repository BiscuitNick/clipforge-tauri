import React, { useRef, useEffect, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import './PreviewWindow.css';
import usePreviewStream from '../hooks/usePreviewStream';

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
  const containerRef = useRef(null);

  // State
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [position, setPosition] = useState({ x: 20, y: 20 });
  const [size, setSize] = useState({ width: 320, height: 180 });
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const { canvasRef, fps, actualFps, metrics, isRecording } = usePreviewStream(isVisible);

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
