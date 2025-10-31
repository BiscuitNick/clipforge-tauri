import { useRef, useEffect, useCallback } from 'react';

/**
 * Hook for compositing screen preview with webcam overlay
 * Creates a combined preview canvas that shows screen + webcam overlay
 * matching the final output layout
 *
 * @param {Object} screenCanvas - Canvas element with screen preview
 * @param {Object} webcamVideo - Video element with webcam stream
 * @param {Object} pipConfig - PiP configuration (position, size)
 * @param {boolean} enabled - Whether compositing is enabled
 */
export function useCompositePreview(screenCanvas, webcamVideo, pipConfig, enabled = false) {
  const compositeCanvasRef = useRef(null);
  const animationFrameRef = useRef(null);

  /**
   * Calculate webcam overlay dimensions and position based on pipConfig
   */
  const calculateOverlayLayout = useCallback((screenWidth, screenHeight, webcamWidth, webcamHeight) => {
    if (!pipConfig) return null;

    // Size multipliers (matching backend composite logic)
    const sizeMultipliers = {
      small: 0.2,
      medium: 0.3,
      large: 0.4
    };

    const multiplier = sizeMultipliers[pipConfig.size] || 0.25;
    const overlayWidth = Math.floor(screenWidth * multiplier);
    const overlayHeight = Math.floor(overlayWidth * (webcamHeight / webcamWidth));

    // Position offsets (10% padding from edges)
    const padding = Math.floor(screenWidth * 0.05);

    let x, y;
    switch (pipConfig.position) {
      case 'topLeft':
        x = padding;
        y = padding;
        break;
      case 'topRight':
        x = screenWidth - overlayWidth - padding;
        y = padding;
        break;
      case 'bottomLeft':
        x = padding;
        y = screenHeight - overlayHeight - padding;
        break;
      case 'bottomRight':
      default:
        x = screenWidth - overlayWidth - padding;
        y = screenHeight - overlayHeight - padding;
        break;
    }

    return { x, y, width: overlayWidth, height: overlayHeight };
  }, [pipConfig]);

  /**
   * Composite screen and webcam onto output canvas
   */
  const renderComposite = useCallback(() => {
    if (!enabled || !compositeCanvasRef.current || !screenCanvas || !webcamVideo) {
      return;
    }

    const compositeCanvas = compositeCanvasRef.current;
    const ctx = compositeCanvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    // Get screen dimensions
    const screenWidth = screenCanvas.width;
    const screenHeight = screenCanvas.height;

    if (screenWidth === 0 || screenHeight === 0) {
      // Screen canvas not ready yet
      animationFrameRef.current = requestAnimationFrame(renderComposite);
      return;
    }

    // Set composite canvas size to match screen
    if (compositeCanvas.width !== screenWidth || compositeCanvas.height !== screenHeight) {
      compositeCanvas.width = screenWidth;
      compositeCanvas.height = screenHeight;
    }

    // Draw screen content first
    ctx.drawImage(screenCanvas, 0, 0, screenWidth, screenHeight);

    // Get webcam dimensions
    const webcamWidth = webcamVideo.videoWidth || 1280;
    const webcamHeight = webcamVideo.videoHeight || 720;

    if (webcamWidth > 0 && webcamHeight > 0 && webcamVideo.readyState >= 2) {
      // Calculate overlay layout
      const overlay = calculateOverlayLayout(screenWidth, screenHeight, webcamWidth, webcamHeight);

      if (overlay) {
        // Draw webcam overlay with rounded corners
        ctx.save();

        // Create rounded rectangle path
        const radius = 8; // Corner radius
        ctx.beginPath();
        ctx.moveTo(overlay.x + radius, overlay.y);
        ctx.lineTo(overlay.x + overlay.width - radius, overlay.y);
        ctx.quadraticCurveTo(overlay.x + overlay.width, overlay.y, overlay.x + overlay.width, overlay.y + radius);
        ctx.lineTo(overlay.x + overlay.width, overlay.y + overlay.height - radius);
        ctx.quadraticCurveTo(overlay.x + overlay.width, overlay.y + overlay.height, overlay.x + overlay.width - radius, overlay.y + overlay.height);
        ctx.lineTo(overlay.x + radius, overlay.y + overlay.height);
        ctx.quadraticCurveTo(overlay.x, overlay.y + overlay.height, overlay.x, overlay.y + overlay.height - radius);
        ctx.lineTo(overlay.x, overlay.y + radius);
        ctx.quadraticCurveTo(overlay.x, overlay.y, overlay.x + radius, overlay.y);
        ctx.closePath();
        ctx.clip();

        // Draw webcam video
        ctx.drawImage(
          webcamVideo,
          overlay.x,
          overlay.y,
          overlay.width,
          overlay.height
        );

        ctx.restore();

        // Draw border around webcam overlay
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(overlay.x + radius, overlay.y);
        ctx.lineTo(overlay.x + overlay.width - radius, overlay.y);
        ctx.quadraticCurveTo(overlay.x + overlay.width, overlay.y, overlay.x + overlay.width, overlay.y + radius);
        ctx.lineTo(overlay.x + overlay.width, overlay.y + overlay.height - radius);
        ctx.quadraticCurveTo(overlay.x + overlay.width, overlay.y + overlay.height, overlay.x + overlay.width - radius, overlay.y + overlay.height);
        ctx.lineTo(overlay.x + radius, overlay.y + overlay.height);
        ctx.quadraticCurveTo(overlay.x, overlay.y + overlay.height, overlay.x, overlay.y + overlay.height - radius);
        ctx.lineTo(overlay.x, overlay.y + radius);
        ctx.quadraticCurveTo(overlay.x, overlay.y, overlay.x + radius, overlay.y);
        ctx.closePath();
        ctx.stroke();
      }
    }

    // Continue animation loop
    animationFrameRef.current = requestAnimationFrame(renderComposite);
  }, [enabled, screenCanvas, webcamVideo, calculateOverlayLayout]);

  // Start/stop compositing based on enabled state
  useEffect(() => {
    if (enabled) {
      console.log('[useCompositePreview] Starting composite rendering');
      renderComposite();
    } else {
      console.log('[useCompositePreview] Stopping composite rendering');
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [enabled, renderComposite]);

  return {
    compositeCanvasRef
  };
}

export default useCompositePreview;
