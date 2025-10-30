import { useEffect, useRef, useState } from 'react';
import { calculatePiPCoordinates, getPiPOverlayStyles } from '../types/recording';
import './PiPPreview.css';

/**
 * PiP Preview Component
 * Shows a live preview of the screen with webcam overlay positioned according to PiP configuration
 */
function PiPPreview({ pipConfig, screenSource, screenStream, webcamStream }) {
  const containerRef = useRef(null);
  const screenVideoRef = useRef(null);
  const webcamVideoRef = useRef(null);
  const [containerDimensions, setContainerDimensions] = useState({ width: 0, height: 0 });
  const [overlayStyles, setOverlayStyles] = useState({});

  // Update container dimensions on resize
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const { width, height } = containerRef.current.getBoundingClientRect();
        setContainerDimensions({ width, height });
      }
    };

    updateDimensions();

    // Listen for window resize
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  // Attach screen stream to video element
  useEffect(() => {
    if (screenVideoRef.current && screenStream) {
      screenVideoRef.current.srcObject = screenStream;
    }

    return () => {
      if (screenVideoRef.current) {
        screenVideoRef.current.srcObject = null;
      }
    };
  }, [screenStream]);

  // Attach webcam stream to video element
  useEffect(() => {
    if (webcamVideoRef.current && webcamStream) {
      webcamVideoRef.current.srcObject = webcamStream;
    }

    return () => {
      if (webcamVideoRef.current) {
        webcamVideoRef.current.srcObject = null;
      }
    };
  }, [webcamStream]);

  // Calculate webcam overlay position and size
  useEffect(() => {
    if (!pipConfig || containerDimensions.width === 0) return;

    // Get webcam aspect ratio (assume 16:9 if not available)
    const webcamAspectRatio = 16 / 9;

    // Calculate coordinates based on container dimensions
    const coordinates = calculatePiPCoordinates(
      pipConfig,
      containerDimensions.width,
      containerDimensions.height,
      webcamAspectRatio
    );

    // Convert to CSS styles with percentage-based positioning for responsiveness
    const styles = {
      position: 'absolute',
      left: `${(coordinates.x / containerDimensions.width) * 100}%`,
      top: `${(coordinates.y / containerDimensions.height) * 100}%`,
      width: `${(coordinates.width / containerDimensions.width) * 100}%`,
      height: `${(coordinates.height / containerDimensions.height) * 100}%`,
      transition: 'all 0.3s ease',
    };

    setOverlayStyles(styles);
  }, [pipConfig, containerDimensions]);

  return (
    <div className="pip-preview-container" ref={containerRef}>
      {/* Screen Preview */}
      <div className="screen-preview">
        {screenStream ? (
          <video
            ref={screenVideoRef}
            className="screen-video"
            autoPlay
            muted
            playsInline
          />
        ) : (
          <div className="preview-placeholder">
            <div className="placeholder-content">
              <svg
                width="64"
                height="64"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                <line x1="8" y1="21" x2="16" y2="21"></line>
                <line x1="12" y1="17" x2="12" y2="21"></line>
              </svg>
              <p>Screen preview will appear here</p>
              {screenSource && (
                <p className="source-name">{screenSource.name}</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Webcam Overlay */}
      {webcamStream && (
        <div className="webcam-overlay" style={overlayStyles}>
          <video
            ref={webcamVideoRef}
            className="webcam-video"
            autoPlay
            muted
            playsInline
          />
          <div className="overlay-label">Webcam</div>
        </div>
      )}

      {/* Position indicator for configuration */}
      {!screenStream && !webcamStream && pipConfig && (
        <div className="position-indicator-overlay" style={overlayStyles}>
          <div className="indicator-box">
            <span>Webcam Position</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default PiPPreview;
