import { useState, useEffect, useRef } from 'react';
import { usePiPConfig } from '../hooks/usePiPConfig';
import PiPPreview from './PiPPreview';
import './PiPConfigurationModal.css';

/**
 * PiP Configuration Modal - Configure Picture-in-Picture settings
 * Allows users to select position, size, and camera/audio devices for PiP recording
 */
function PiPConfigurationModal({ isOpen, onClose, onConfirm, screenSource, screenStream }) {
  const {
    config,
    setPosition,
    setSize,
    setCameraId,
    setIncludeAudio,
    setAudioDeviceId,
  } = usePiPConfig();

  // Device state
  const [cameras, setCameras] = useState([]);
  const [audioDevices, setAudioDevices] = useState([]);
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);
  const [error, setError] = useState('');

  // Audio monitoring
  const [audioLevel, setAudioLevel] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const audioAnimationRef = useRef(null);
  const audioStreamRef = useRef(null);

  // Video preview
  const videoRef = useRef(null);
  const videoStreamRef = useRef(null);

  // Load devices when modal opens
  useEffect(() => {
    if (isOpen) {
      loadDevices();
      startCameraPreview();
    } else {
      setError('');
      stopAudioMonitoring();
      stopCameraPreview();
    }

    return () => {
      stopAudioMonitoring();
      stopCameraPreview();
    };
  }, [isOpen]);

  // Update preview when camera selection changes
  useEffect(() => {
    if (isOpen && config.cameraId) {
      startCameraPreview();
    }
  }, [config.cameraId, isOpen]);

  // Start/stop audio monitoring when settings change
  useEffect(() => {
    if (isOpen && config.includeAudio && config.audioDeviceId) {
      startAudioMonitoring();
    } else {
      stopAudioMonitoring();
    }
  }, [config.includeAudio, config.audioDeviceId, isOpen]);

  /**
   * Load available cameras and audio devices
   */
  const loadDevices = async () => {
    setIsLoadingDevices(true);
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

      // Auto-select first camera if none selected
      if (cameraDevices.length > 0 && !config.cameraId) {
        setCameraId(cameraDevices[0].id);
      }

      // Filter audio inputs
      const audioInputs = devices.filter(device => device.kind === 'audioinput');
      const audioInputDevices = audioInputs.map((device, index) => ({
        id: device.deviceId,
        name: device.label || `Microphone ${index + 1}`,
        is_default: index === 0
      }));
      setAudioDevices(audioInputDevices);

      // Auto-select default audio device if none selected
      if (audioInputDevices.length > 0 && !config.audioDeviceId) {
        const defaultAudio = audioInputDevices.find(dev => dev.is_default);
        setAudioDeviceId(defaultAudio ? defaultAudio.id : audioInputDevices[0].id);
      }
    } catch (err) {
      console.error('[PiPConfigurationModal] Failed to enumerate devices:', err);
      setError(`Failed to access camera/microphone: ${err.message}`);
    } finally {
      setIsLoadingDevices(false);
    }
  };

  /**
   * Start camera preview
   */
  const startCameraPreview = async () => {
    try {
      // Stop existing stream
      stopCameraPreview();

      if (!config.cameraId) return;

      const constraints = {
        video: { deviceId: { exact: config.cameraId } }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      videoStreamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error('[PiPConfigurationModal] Failed to start camera preview:', err);
    }
  };

  /**
   * Stop camera preview
   */
  const stopCameraPreview = () => {
    if (videoStreamRef.current) {
      videoStreamRef.current.getTracks().forEach(track => track.stop());
      videoStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  /**
   * Start audio level monitoring
   */
  const startAudioMonitoring = async () => {
    try {
      // Stop existing monitoring
      stopAudioMonitoring();

      if (!config.audioDeviceId) return;

      const constraints = {
        audio: { deviceId: { exact: config.audioDeviceId } }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      audioStreamRef.current = stream;

      // Create audio context
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }

      const audioContext = audioContextRef.current;
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      analyserRef.current = analyser;

      // Connect source to analyser
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

        setAudioLevel(isMuted ? 0 : normalizedLevel);
        audioAnimationRef.current = requestAnimationFrame(updateAudioLevel);
      };

      updateAudioLevel();
    } catch (err) {
      console.error('[PiPConfigurationModal] Failed to start audio monitoring:', err);
    }
  };

  /**
   * Stop audio monitoring
   */
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

  /**
   * Handle mute toggle
   */
  const handleMuteToggle = () => {
    setIsMuted(!isMuted);
  };

  /**
   * Get VU meter color based on audio level
   */
  const getVUMeterColor = (level) => {
    if (level < 30) return '#27ae60';
    if (level < 70) return '#f39c12';
    return '#e74c3c';
  };

  /**
   * Handle confirm button click
   */
  const handleConfirm = () => {
    if (!config.cameraId) {
      setError('Please select a camera');
      return;
    }

    // Stop monitoring before closing
    stopAudioMonitoring();
    stopCameraPreview();

    // Pass configuration to parent
    if (onConfirm) {
      onConfirm(config);
    }

    onClose();
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content pip-config-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Picture-in-Picture Configuration</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          {error && (
            <div className="error-message">
              {error}
            </div>
          )}

          {/* Live Preview */}
          <div className="config-section">
            <h3 className="section-title">Preview</h3>
            <PiPPreview
              pipConfig={config}
              screenSource={screenSource}
              screenStream={screenStream}
              webcamStream={videoStreamRef.current}
            />
            <p className="preview-hint">
              The webcam overlay will appear in the selected position during recording
            </p>
          </div>

          {/* Position Selector */}
          <div className="config-section">
            <h3 className="section-title">Webcam Position</h3>
            <div className="position-selector">
              <div className="position-grid">
                <button
                  className={`position-btn top-left ${config.position === 'topLeft' ? 'selected' : ''}`}
                  onClick={() => setPosition('topLeft')}
                  title="Top Left"
                >
                  <div className="position-indicator"></div>
                </button>
                <button
                  className={`position-btn top-right ${config.position === 'topRight' ? 'selected' : ''}`}
                  onClick={() => setPosition('topRight')}
                  title="Top Right"
                >
                  <div className="position-indicator"></div>
                </button>
                <button
                  className={`position-btn bottom-left ${config.position === 'bottomLeft' ? 'selected' : ''}`}
                  onClick={() => setPosition('bottomLeft')}
                  title="Bottom Left"
                >
                  <div className="position-indicator"></div>
                </button>
                <button
                  className={`position-btn bottom-right ${config.position === 'bottomRight' ? 'selected' : ''}`}
                  onClick={() => setPosition('bottomRight')}
                  title="Bottom Right"
                >
                  <div className="position-indicator"></div>
                </button>
              </div>
            </div>
          </div>

          {/* Size Selector */}
          <div className="config-section">
            <h3 className="section-title">Webcam Size</h3>
            <div className="size-selector">
              <button
                className={`size-btn ${config.size === 'small' ? 'selected' : ''}`}
                onClick={() => setSize('small')}
              >
                <div className="size-preview small"></div>
                <span>Small (15%)</span>
              </button>
              <button
                className={`size-btn ${config.size === 'medium' ? 'selected' : ''}`}
                onClick={() => setSize('medium')}
              >
                <div className="size-preview medium"></div>
                <span>Medium (25%)</span>
              </button>
              <button
                className={`size-btn ${config.size === 'large' ? 'selected' : ''}`}
                onClick={() => setSize('large')}
              >
                <div className="size-preview large"></div>
                <span>Large (35%)</span>
              </button>
            </div>
          </div>

          {/* Camera Selection */}
          <div className="config-section">
            <h3 className="section-title">Camera</h3>
            <div className="camera-preview-container">
              <video
                ref={videoRef}
                className="camera-preview"
                autoPlay
                muted
                playsInline
              />
            </div>
            <select
              className="device-select"
              value={config.cameraId || ''}
              onChange={(e) => setCameraId(e.target.value)}
              disabled={isLoadingDevices}
            >
              {isLoadingDevices ? (
                <option>Loading cameras...</option>
              ) : cameras.length === 0 ? (
                <option>No cameras found</option>
              ) : (
                cameras.map(camera => (
                  <option key={camera.id} value={camera.id}>
                    {camera.name}
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Audio Settings */}
          <div className="config-section">
            <h3 className="section-title">Audio</h3>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={config.includeAudio}
                onChange={(e) => setIncludeAudio(e.target.checked)}
              />
              <span>Include Microphone Audio</span>
            </label>

            {config.includeAudio && audioDevices.length > 0 && (
              <>
                <select
                  className="device-select"
                  value={config.audioDeviceId || ''}
                  onChange={(e) => setAudioDeviceId(e.target.value)}
                  disabled={isLoadingDevices}
                >
                  {audioDevices.map(device => (
                    <option key={device.id} value={device.id}>
                      {device.name}
                    </option>
                  ))}
                </select>

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
              </>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button className="button-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button-primary"
            onClick={handleConfirm}
            disabled={!config.cameraId || isLoadingDevices}
          >
            {isLoadingDevices ? 'Loading...' : 'Start PiP Recording'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default PiPConfigurationModal;
