import { useState, useEffect, useRef } from 'react';
import './WebcamConfigurationModal.css';

/**
 * Webcam Configuration Modal - Select camera and audio settings
 */
function WebcamConfigurationModal({ isOpen, onClose, onConfigSelect }) {
  const [cameras, setCameras] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState(null);
  const [audioDevices, setAudioDevices] = useState([]);
  const [selectedAudioId, setSelectedAudioId] = useState(null);
  const [includeAudio, setIncludeAudio] = useState(true);
  const [includeMicrophone, setIncludeMicrophone] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Audio refs
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const audioAnimationRef = useRef(null);
  const audioStreamRef = useRef(null);

  // Fetch available cameras and audio devices when modal opens
  useEffect(() => {
    if (isOpen) {
      loadDevices();
    } else {
      setError('');
      stopAudioMonitoring();
    }
  }, [isOpen]);

  // Start/stop audio monitoring when microphone setting changes
  useEffect(() => {
    if (includeMicrophone && selectedAudioId) {
      startAudioMonitoring();
    } else {
      stopAudioMonitoring();
    }
    return () => stopAudioMonitoring();
  }, [includeMicrophone, selectedAudioId]);

  const loadDevices = async () => {
    setIsLoading(true);
    setError('');

    try {
      // Request permissions to get device labels
      const tempStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });

      // Enumerate devices
      const devices = await navigator.mediaDevices.enumerateDevices();

      // Stop temp stream
      tempStream.getTracks().forEach(track => track.stop());

      // Filter video inputs (cameras)
      const videoInputs = devices.filter(device => device.kind === 'videoinput');
      const cameraDevices = videoInputs.map((device, index) => ({
        id: device.deviceId,
        name: device.label || `Camera ${index + 1}`,
        is_default: index === 0
      }));
      setCameras(cameraDevices);

      // Auto-select first camera
      if (cameraDevices.length > 0) {
        setSelectedCameraId(cameraDevices[0].id);
      }

      // Filter audio inputs
      const audioInputs = devices.filter(device => device.kind === 'audioinput');
      const audioInputDevices = audioInputs.map((device, index) => ({
        id: device.deviceId,
        name: device.label || `Microphone ${index + 1}`,
        is_default: index === 0
      }));
      setAudioDevices(audioInputDevices);

      // Auto-select default audio device
      const defaultAudio = audioInputDevices.find(dev => dev.is_default);
      if (defaultAudio) {
        setSelectedAudioId(defaultAudio.id);
      } else if (audioInputDevices.length > 0) {
        setSelectedAudioId(audioInputDevices[0].id);
      }
    } catch (err) {
      console.error('[WebcamConfigurationModal] Failed to enumerate devices:', err);
      setError(`Failed to access camera/microphone: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Start audio level monitoring using Web Audio API
  const startAudioMonitoring = async () => {
    try {
      // Stop existing monitoring
      stopAudioMonitoring();

      // Get audio stream
      const constraints = {
        audio: selectedAudioId ? { deviceId: { exact: selectedAudioId } } : true
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      audioStreamRef.current = stream;

      // Create audio context if it doesn't exist
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }

      const audioContext = audioContextRef.current;

      // Create analyser node
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      analyserRef.current = analyser;

      // Create media stream source
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      // Start monitoring loop
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const updateAudioLevel = () => {
        if (!analyserRef.current) return;

        analyser.getByteFrequencyData(dataArray);

        // Calculate average audio level (0-100)
        const sum = dataArray.reduce((a, b) => a + b, 0);
        const average = sum / dataArray.length;
        const normalizedLevel = Math.min(100, (average / 255) * 100);

        // Apply mute
        setAudioLevel(isMuted ? 0 : normalizedLevel);

        audioAnimationRef.current = requestAnimationFrame(updateAudioLevel);
      };

      updateAudioLevel();
    } catch (err) {
      console.error('[WebcamConfigurationModal] Failed to start audio monitoring:', err);
    }
  };

  // Stop audio monitoring
  const stopAudioMonitoring = () => {
    if (audioAnimationRef.current) {
      cancelAnimationFrame(audioAnimationRef.current);
      audioAnimationRef.current = null;
    }
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(track => track.stop());
      audioStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setAudioLevel(0);
  };

  // Handle mute toggle
  const handleMuteToggle = () => {
    setIsMuted(!isMuted);
  };

  // Get VU meter color based on audio level
  const getVUMeterColor = (level) => {
    if (level < 30) return '#27ae60'; // Green - low
    if (level < 70) return '#f39c12'; // Orange - medium
    return '#e74c3c'; // Red - high/clipping
  };

  const handleConfirmSelection = () => {
    if (!selectedCameraId) {
      setError('Please select a camera');
      return;
    }

    // Stop audio monitoring before closing
    stopAudioMonitoring();

    const selectedCamera = cameras.find(cam => cam.id === selectedCameraId);

    // Pass configuration to parent
    if (onConfigSelect) {
      onConfigSelect({
        cameraId: selectedCameraId,
        cameraName: selectedCamera?.name || 'Unknown Camera',
        includeAudio: includeAudio,
        includeMicrophone: includeMicrophone,
        microphoneDeviceId: selectedAudioId
      });
    }

    // Close modal
    onClose();
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content webcam-configuration-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Configure Camera & Audio</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          {error && (
            <div className="error-message">
              {error}
            </div>
          )}

          {isLoading ? (
            <div className="loading-state">
              <p>Loading devices...</p>
            </div>
          ) : (
            <>
              {/* Camera Selection */}
              <div className="device-section">
                <label className="device-label">Camera:</label>
                <select
                  className="device-select"
                  value={selectedCameraId || ''}
                  onChange={(e) => setSelectedCameraId(e.target.value)}
                  disabled={cameras.length === 0}
                >
                  {cameras.length === 0 ? (
                    <option value="">No cameras found</option>
                  ) : (
                    cameras.map(camera => (
                      <option key={camera.id} value={camera.id}>
                        {camera.name}
                      </option>
                    ))
                  )}
                </select>
              </div>

              {/* Audio Controls */}
              <div className="audio-controls">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={includeAudio}
                    onChange={(e) => setIncludeAudio(e.target.checked)}
                  />
                  <span>Include System Audio</span>
                </label>

                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={includeMicrophone}
                    onChange={(e) => setIncludeMicrophone(e.target.checked)}
                  />
                  <span>Include Microphone</span>
                </label>

                {/* Microphone device selection */}
                {includeMicrophone && audioDevices.length > 0 && (
                  <div className="microphone-controls">
                    <div className="audio-device-selector">
                      <label htmlFor="mic-select">Microphone:</label>
                      <select
                        id="mic-select"
                        value={selectedAudioId || ''}
                        onChange={(e) => setSelectedAudioId(e.target.value)}
                      >
                        {audioDevices.map(device => (
                          <option key={device.id} value={device.id}>
                            {device.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Audio Level Meter */}
                    <div className="audio-level-container">
                      <button
                        className={`mute-btn ${isMuted ? 'muted' : ''}`}
                        onClick={handleMuteToggle}
                        title={isMuted ? 'Unmute' : 'Mute'}
                      >
                        {isMuted ? '🔇' : '🔊'}
                      </button>
                      <div className="vu-meter">
                        <div
                          className="vu-meter-fill"
                          style={{
                            width: `${audioLevel}%`,
                            backgroundColor: getVUMeterColor(audioLevel)
                          }}
                        />
                      </div>
                      <span className="audio-level-text">{Math.round(audioLevel)}%</span>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button className="button-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button-primary"
            onClick={handleConfirmSelection}
            disabled={!selectedCameraId || isLoading}
          >
            {isLoading ? 'Loading...' : 'Confirm Selection'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default WebcamConfigurationModal;
