import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import './ScreenRecordingModal.css';

/**
 * Screen Recording Modal - Select screen/window source and control recording
 */
function ScreenRecordingModal({ isOpen, onClose, onRecordingComplete }) {
  const [step, setStep] = useState('select'); // 'select', 'recording'
  const [sources, setSources] = useState([]);
  const [selectedSource, setSelectedSource] = useState(null);
  const [sourceType, setSourceType] = useState('screen'); // 'screen' or 'window'
  const [includeAudio, setIncludeAudio] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingState, setRecordingState] = useState(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Fetch available sources when modal opens
  useEffect(() => {
    if (isOpen) {
      fetchSources();
    } else {
      // Reset state when modal closes
      setStep('select');
      setSelectedSource(null);
      setError('');
      setRecordingState(null);
    }
  }, [isOpen]);

  // Listen for recording duration updates
  useEffect(() => {
    let unlisten;

    const setupListener = async () => {
      unlisten = await listen('recording:duration-update', (event) => {
        console.log('Duration update:', event.payload);
        setRecordingState(event.payload);
      });
    };

    if (isRecording) {
      setupListener();
    }

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [isRecording]);

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

  const handleStartRecording = async () => {
    if (!selectedSource) {
      setError('Please select a screen or window to record');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const result = await invoke('start_recording', {
        recordingType: 'screen',
        sourceId: selectedSource.id,
        config: null, // Use default config
        includeAudio: includeAudio
      });

      console.log('Recording started:', result);
      setRecordingState(result);
      setIsRecording(true);

      // Close modal immediately after starting recording
      // Parent component will handle showing recording status and preview
      onClose();

      // Notify parent about recording start
      if (onRecordingComplete) {
        // Pass recording state to parent so it can show live preview
        onRecordingComplete({ ...result, isRecording: true });
      }
    } catch (err) {
      console.error('Failed to start recording:', err);
      setError(`Failed to start recording: ${err}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleStopRecording = async () => {
    setIsLoading(true);
    setError('');

    try {
      const result = await invoke('stop_recording');
      console.log('Recording stopped:', result);

      setIsRecording(false);

      // Notify parent component
      if (onRecordingComplete) {
        onRecordingComplete(result);
      }

      // Close modal
      onClose();
    } catch (err) {
      console.error('Failed to stop recording:', err);
      setError(`Failed to stop recording: ${err}`);
    } finally {
      setIsLoading(false);
    }
  };

  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content screen-recording-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            {step === 'select' ? 'Select Recording Source' : 'Recording'}
          </h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          {error && (
            <div className="error-message">
              {error}
            </div>
          )}

          {step === 'select' && (
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
          )}

          {step === 'recording' && (
            <div className="recording-view">
              <div className="recording-indicator">
                <div className="recording-dot"></div>
                <span>Recording in progress...</span>
              </div>

              <div className="recording-timer">
                {formatDuration(recordingState?.duration || 0)}
              </div>

              <div className="recording-info">
                <p>Recording: {selectedSource?.name}</p>
                {includeAudio && <p>System audio: Enabled</p>}
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          {step === 'select' ? (
            <>
              <button className="button-secondary" onClick={onClose}>
                Cancel
              </button>
              <button
                className="button-primary"
                onClick={handleStartRecording}
                disabled={!selectedSource || isLoading}
              >
                {isLoading ? 'Starting...' : 'Start Recording'}
              </button>
            </>
          ) : (
            <>
              <button
                className="button-danger"
                onClick={handleStopRecording}
                disabled={isLoading}
              >
                {isLoading ? 'Stopping...' : 'Stop Recording'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default ScreenRecordingModal;
