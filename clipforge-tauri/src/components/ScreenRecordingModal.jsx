import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import './ScreenRecordingModal.css';

/**
 * Screen Recording Modal - Select screen/window source and resolution
 */
function ScreenRecordingModal({ isOpen, onClose, onSourceSelect }) {
  const [sources, setSources] = useState([]);
  const [selectedSource, setSelectedSource] = useState(null);
  const [sourceType, setSourceType] = useState('screen'); // 'screen' or 'window'
  const [includeAudio, setIncludeAudio] = useState(true);
  const [resolution, setResolution] = useState('native'); // 'native', '1080p', '720p', '480p'
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Fetch available sources when modal opens
  useEffect(() => {
    if (isOpen) {
      fetchSources();
    } else {
      // Reset error when modal closes
      setError('');
    }
  }, [isOpen]);

  const fetchSources = async () => {
    setIsLoading(true);
    setError('');

    try {
      const screens = await invoke('enumerate_screens');
      const windows = await invoke('enumerate_windows');

      setSources({ screens, windows });

      // Auto-select first screen by default
      if (screens.length > 0) {
        setSelectedSource(screens[0]);
        setSourceType('screen');
      }
    } catch (err) {
      console.error('Failed to fetch sources:', err);
      setError(`Failed to enumerate sources: ${err}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Calculate actual recording dimensions based on resolution setting
  const getRecordingDimensions = () => {
    if (!selectedSource) return { width: 1920, height: 1080 };

    if (resolution === 'native') {
      return { width: selectedSource.width, height: selectedSource.height };
    }

    // Calculate aspect ratio
    const aspectRatio = selectedSource.width / selectedSource.height;

    switch (resolution) {
      case '1080p':
        return { width: 1920, height: 1080 };
      case '720p':
        return { width: 1280, height: 720 };
      case '480p':
        return { width: 854, height: 480 };
      default:
        return { width: selectedSource.width, height: selectedSource.height };
    }
  };

  const handleConfirmSelection = () => {
    if (!selectedSource) {
      setError('Please select a screen or window to record');
      return;
    }

    const dimensions = getRecordingDimensions();

    // Create config with selected resolution
    const config = {
      width: dimensions.width,
      height: dimensions.height,
      frame_rate: 30,
      video_bitrate: 5000,
      video_codec: "h264",
      audio_sample_rate: 48000,
      audio_channels: 2,
      audio_bitrate: 128,
      audio_codec: "aac",
      output_format: "mp4"
    };

    console.log('[ScreenRecordingModal] Source selected with config:', config);

    // Pass selection to parent
    if (onSourceSelect) {
      onSourceSelect({
        source: selectedSource,
        config: config,
        includeAudio: includeAudio,
        resolution: resolution
      });
    }

    // Close modal
    onClose();
  };

  if (!isOpen) {
    return null;
  }

  const recordingDimensions = getRecordingDimensions();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content screen-recording-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Select Recording Source</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          {error && (
            <div className="error-message">
              {error}
            </div>
          )}

          <>
              {/* Source type tabs */}
              <div className="source-tabs">
                <button
                  className={`tab ${sourceType === 'screen' ? 'active' : ''}`}
                  onClick={() => {
                    setSourceType('screen');
                    if (sources.screens && sources.screens.length > 0) {
                      setSelectedSource(sources.screens[0]);
                    }
                  }}
                >
                  Screens ({sources.screens?.length || 0})
                </button>
                <button
                  className={`tab ${sourceType === 'window' ? 'active' : ''}`}
                  onClick={() => {
                    setSourceType('window');
                    if (sources.windows && sources.windows.length > 0) {
                      setSelectedSource(sources.windows[0]);
                    }
                  }}
                >
                  Windows ({sources.windows?.length || 0})
                </button>
              </div>

              {/* Source grid */}
              <div className="source-grid">
                {isLoading ? (
                  <div className="loading-state">
                    <p>Loading sources...</p>
                  </div>
                ) : (
                  (sourceType === 'screen' ? sources.screens : sources.windows)?.map((source) => (
                    <div
                      key={source.id}
                      className={`source-item ${selectedSource?.id === source.id ? 'selected' : ''}`}
                      onClick={() => setSelectedSource(source)}
                    >
                      <div className="source-thumbnail">
                        {source.thumbnail ? (
                          <img src={`data:image/png;base64,${source.thumbnail}`} alt={source.name} />
                        ) : (
                          <div className="thumbnail-placeholder">
                            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                            </svg>
                          </div>
                        )}
                      </div>
                      <div className="source-name">
                        {source.name}
                        {source.is_primary && <span className="primary-badge">Primary</span>}
                      </div>
                      <div className="source-resolution">
                        {source.width} × {source.height}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Resolution selector */}
              <div className="resolution-controls">
                <label className="resolution-label">Recording Resolution:</label>
                <div className="resolution-options">
                  <button
                    className={`resolution-btn ${resolution === 'native' ? 'active' : ''}`}
                    onClick={() => setResolution('native')}
                  >
                    Native
                    {selectedSource && (
                      <span className="resolution-info">
                        {selectedSource.width} × {selectedSource.height}
                      </span>
                    )}
                  </button>
                  <button
                    className={`resolution-btn ${resolution === '1080p' ? 'active' : ''}`}
                    onClick={() => setResolution('1080p')}
                  >
                    1080p
                    <span className="resolution-info">1920 × 1080</span>
                  </button>
                  <button
                    className={`resolution-btn ${resolution === '720p' ? 'active' : ''}`}
                    onClick={() => setResolution('720p')}
                  >
                    720p
                    <span className="resolution-info">1280 × 720</span>
                  </button>
                  <button
                    className={`resolution-btn ${resolution === '480p' ? 'active' : ''}`}
                    onClick={() => setResolution('480p')}
                  >
                    480p
                    <span className="resolution-info">854 × 480</span>
                  </button>
                </div>
                <div className="selected-resolution">
                  Will record at: {recordingDimensions.width} × {recordingDimensions.height}
                </div>
              </div>

              {/* Audio controls */}
              <div className="audio-controls">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={includeAudio}
                    onChange={(e) => setIncludeAudio(e.target.checked)}
                  />
                  <span>Include System Audio</span>
                </label>
              </div>
            </>
        </div>

        <div className="modal-footer">
          <button className="button-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button-primary"
            onClick={handleConfirmSelection}
            disabled={!selectedSource || isLoading}
          >
            {isLoading ? 'Loading...' : 'Confirm Selection'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ScreenRecordingModal;
