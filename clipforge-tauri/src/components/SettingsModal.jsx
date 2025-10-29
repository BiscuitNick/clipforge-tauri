import React, { useState, useEffect } from 'react';
import './SettingsModal.css';

/**
 * Settings Modal - Configure application settings
 * Currently supports:
 * - Preview frame rate during recording
 */
function SettingsModal({ isOpen, onClose }) {
  const [previewFPS, setPreviewFPS] = useState(1);

  // Load settings from localStorage on mount
  useEffect(() => {
    const savedFPS = localStorage.getItem('previewFPS');
    if (savedFPS) {
      setPreviewFPS(parseInt(savedFPS, 10));
    }
  }, []);

  // Save settings when changed
  const handleFPSChange = (e) => {
    const newFPS = parseInt(e.target.value, 10);
    setPreviewFPS(newFPS);
    localStorage.setItem('previewFPS', newFPS.toString());
  };

  const handleClose = () => {
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="settings-modal-overlay" onClick={handleClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="close-btn" onClick={handleClose}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" />
            </svg>
          </button>
        </div>

        <div className="settings-content">
          <div className="setting-section">
            <h3>Recording Preview</h3>

            <div className="setting-item">
              <label htmlFor="preview-fps">Live Preview Frame Rate</label>
              <p className="setting-description">
                Controls how often preview frames are captured during recording. Higher rates use more CPU.
              </p>

              <div className="fps-control">
                <input
                  id="preview-fps"
                  type="range"
                  min="0.5"
                  max="10"
                  step="0.5"
                  value={previewFPS}
                  onChange={handleFPSChange}
                  className="fps-slider"
                />
                <div className="fps-labels">
                  <span className="fps-value">{previewFPS} FPS</span>
                  <span className="fps-range">0.5 - 10 FPS</span>
                </div>
              </div>

              <div className="fps-presets">
                <button
                  className={`preset-btn ${previewFPS === 0.5 ? 'active' : ''}`}
                  onClick={() => {
                    setPreviewFPS(0.5);
                    localStorage.setItem('previewFPS', '0.5');
                  }}
                >
                  Low (0.5)
                </button>
                <button
                  className={`preset-btn ${previewFPS === 1 ? 'active' : ''}`}
                  onClick={() => {
                    setPreviewFPS(1);
                    localStorage.setItem('previewFPS', '1');
                  }}
                >
                  Normal (1)
                </button>
                <button
                  className={`preset-btn ${previewFPS === 2 ? 'active' : ''}`}
                  onClick={() => {
                    setPreviewFPS(2);
                    localStorage.setItem('previewFPS', '2');
                  }}
                >
                  High (2)
                </button>
                <button
                  className={`preset-btn ${previewFPS === 5 ? 'active' : ''}`}
                  onClick={() => {
                    setPreviewFPS(5);
                    localStorage.setItem('previewFPS', '5');
                  }}
                >
                  Very High (5)
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="settings-footer">
          <button className="save-btn" onClick={handleClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export default SettingsModal;
