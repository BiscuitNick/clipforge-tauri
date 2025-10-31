import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';

/**
 * Shared hook for subscribing to ScreenCapture preview events and rendering
 * frames into a canvas element. Returns refs and metrics so multiple components
 * (floating overlay, inline panel) can present the same live feed.
 *
 * @param {boolean} enabled Whether the preview should be active for this consumer.
 */
export function usePreviewStream(enabled = true) {
  const canvasRef = useRef(null);
  const pendingImageRef = useRef(null);
  const lastFrameTimeRef = useRef(null);
  const frameCountRef = useRef(0);

  const [isRecording, setIsRecording] = useState(false);
  const [metrics, setMetrics] = useState(null);
  const [fps, setFps] = useState(0);
  const [actualFps, setActualFps] = useState(0);
  const [hasFrame, setHasFrame] = useState(false);

  const resetState = useCallback(() => {
    setMetrics(null);
    setFps(0);
    setActualFps(0);
    setIsRecording(false);
    setHasFrame(false);
    lastFrameTimeRef.current = null;
    frameCountRef.current = 0;
  }, []);

  const handlePreviewFrame = useCallback((event) => {
    const { imageData, width, height } = event.payload;
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      return;
    }

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const pendingImage = pendingImageRef.current ?? new Image();
    pendingImageRef.current = pendingImage;

    pendingImage.onload = () => {
      ctx.drawImage(pendingImage, 0, 0, width, height);

      const now = performance.now();
      const last = lastFrameTimeRef.current;
      if (last) {
        const elapsed = (now - last) / 1000;
        if (elapsed > 0) {
          setActualFps(1 / elapsed);
        }
      }
      lastFrameTimeRef.current = now;
      frameCountRef.current += 1;
      if (!hasFrame) {
        setHasFrame(true);
      }
    };

    pendingImage.onerror = () => {
      // Failed to decode preview frame
    };

    pendingImage.src = `data:image/jpeg;base64,${imageData}`;
  }, [hasFrame]);

  const handlePreviewMetrics = useCallback((event) => {
    const metricsData = event.payload;
    setMetrics(metricsData);
    setFps(metricsData.currentFps || 0);
  }, []);

  const handlePreviewStarted = useCallback(() => {
    setIsRecording(true);
    lastFrameTimeRef.current = null;
    frameCountRef.current = 0;
  }, []);

  const handlePreviewStopped = useCallback(() => {
    setIsRecording(false);
  }, []);

  useEffect(() => {
    if (!enabled) {
      resetState();
      return;
    }

    let unlistenFrame;
    let unlistenMetrics;
    let unlistenStarted;
    let unlistenStopped;

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
  }, [
    enabled,
    handlePreviewFrame,
    handlePreviewMetrics,
    handlePreviewStarted,
    handlePreviewStopped,
    resetState,
  ]);

  useEffect(() => {
    if (!enabled) {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      }
    }
  }, [enabled]);

  return useMemo(() => ({
    canvasRef,
    metrics,
    fps,
    actualFps,
    isRecording,
    hasFrame,
  }), [metrics, fps, actualFps, isRecording, hasFrame]);
}

export default usePreviewStream;
