import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./WebcamRecordingPanel.css";

/**
 * WebcamRecordingPanel - Handles webcam recording with MediaRecorder API
 */
function WebcamRecordingPanel({ onRecordingComplete, onError }) {
  // Camera state
  const [cameras, setCameras] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState(null);
  const [isLoadingCameras, setIsLoadingCameras] = useState(true);

  // Audio state
  const [audioDevices, setAudioDevices] = useState([]);
  const [selectedAudioId, setSelectedAudioId] = useState(null);
  const [includeAudio, setIncludeAudio] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);

  // MediaStream and recording state
  const [stream, setStream] = useState(null);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);

  // Refs
  const videoRef = useRef(null);
  const chunksRef = useRef([]);
  const timerIntervalRef = useRef(null);
  const startTimeRef = useRef(null);
  const finalDurationRef = useRef(0);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const audioAnimationRef = useRef(null);

  // Load available cameras and audio devices on mount
  useEffect(() => {
    loadCameras();
    loadAudioDevices();
    return () => {
      // Cleanup on unmount
      stopStream();
      stopAudioMonitoring();
    };
  }, []);

  // Load cameras using browser API
  const loadCameras = async () => {
    try {
      setIsLoadingCameras(true);

      // First, request camera access to trigger permission prompt
      // This is required before enumerateDevices will show device labels
      const tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });

      // Now enumerate devices (will have labels after permission granted)
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(device => device.kind === 'videoinput');

      // Stop the temporary stream
      tempStream.getTracks().forEach(track => track.stop());

      // Convert to our camera format
      const cameraDevices = videoDevices.map((device, index) => ({
        id: device.deviceId,
        name: device.label || `Camera ${index + 1}`,
        is_default: index === 0, // First camera is usually default
        resolutions: [[1920, 1080], [1280, 720], [640, 480]], // Standard resolutions
        has_audio: false
      }));

      setCameras(cameraDevices);

      // Auto-select default camera
      const defaultCamera = cameraDevices.find(cam => cam.is_default);
      if (defaultCamera) {
        setSelectedCameraId(defaultCamera.id);
      } else if (cameraDevices.length > 0) {
        setSelectedCameraId(cameraDevices[0].id);
      }
    } catch (err) {
      console.error('[WebcamRecording] Failed to enumerate cameras:', err);
      if (onError) {
        onError(`Failed to load cameras: ${err.message || err}`);
      }
    } finally {
      setIsLoadingCameras(false);
    }
  };

  // Load audio devices using browser API
  const loadAudioDevices = async () => {
    try {
      // Request audio access to get device labels
      const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Enumerate audio input devices
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(device => device.kind === 'audioinput');

      // Stop temp stream
      tempStream.getTracks().forEach(track => track.stop());

      // Convert to our format
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
      console.error('[WebcamRecording] Failed to enumerate audio devices:', err);
      // Don't show error to user - audio is optional
    }
  };

  // Start camera preview
  const startPreview = async () => {
    try {
      // Stop existing stream if any
      stopStream();
      stopAudioMonitoring();

      const constraints = {
        video: selectedCameraId ? { deviceId: { exact: selectedCameraId } } : true,
        audio: includeAudio && selectedAudioId ? { deviceId: { exact: selectedAudioId } } : includeAudio
      };

      const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      setStream(mediaStream);

      // Attach to video element
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }

      // Set up audio monitoring if audio is enabled
      if (includeAudio && mediaStream.getAudioTracks().length > 0) {
        startAudioMonitoring(mediaStream);
      }
    } catch (err) {
      console.error('[WebcamRecording] Failed to start preview:', err);
      if (onError) {
        onError(`Failed to access camera: ${err.message}`);
      }
    }
  };

  // Stop camera stream
  const stopStream = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  // Start audio level monitoring using Web Audio API
  const startAudioMonitoring = (mediaStream) => {
    try {
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
      const source = audioContext.createMediaStreamSource(mediaStream);
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
      console.error('[WebcamRecording] Failed to start audio monitoring:', err);
    }
  };

  // Stop audio monitoring
  const stopAudioMonitoring = () => {
    if (audioAnimationRef.current) {
      cancelAnimationFrame(audioAnimationRef.current);
      audioAnimationRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setAudioLevel(0);
  };

  // Start preview when camera or audio settings change
  useEffect(() => {
    if (selectedCameraId) {
      startPreview();
    }
    return () => {
      stopStream();
      stopAudioMonitoring();
    };
  }, [selectedCameraId, selectedAudioId, includeAudio]);

  // Handle camera selection change
  const handleCameraChange = (e) => {
    setSelectedCameraId(e.target.value);
  };

  // Handle audio device selection change
  const handleAudioDeviceChange = (e) => {
    setSelectedAudioId(e.target.value);
  };

  // Handle mute toggle
  const handleMuteToggle = () => {
    setIsMuted(!isMuted);
    if (stream) {
      const audioTracks = stream.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = isMuted; // Will be flipped after state updates
      });
    }
  };

  // Start recording
  const handleStartRecording = async () => {
    if (!stream) {
      if (onError) {
        onError('No camera stream available');
      }
      return;
    }

    try {
      chunksRef.current = [];

      // Determine supported MIME type
      let mimeType = 'video/webm;codecs=vp9';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm;codecs=vp8';
      }
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm';
      }
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/mp4';
      }

      const options = {
        mimeType,
        videoBitsPerSecond: 2500000 // 2.5 Mbps
      };

      const recorder = new MediaRecorder(stream, options);

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        try {
          // Create blob from recorded chunks
          const blob = new Blob(chunksRef.current, { type: mimeType });

          // Convert blob to array buffer for Tauri
          const arrayBuffer = await blob.arrayBuffer();
          const uint8Array = new Uint8Array(arrayBuffer);

          // Use the captured final duration
          const duration = finalDurationRef.current;

          // Save file via Tauri command with duration
          const filePath = await invoke('save_webcam_recording', {
            data: Array.from(uint8Array),
            mimeType,
            duration
          });
          if (onRecordingComplete) {
            onRecordingComplete({
              filePath,
              mimeType,
              duration
            });
          }

          // Reset state
          chunksRef.current = [];
          finalDurationRef.current = 0;
          setRecordingDuration(0);
        } catch (err) {
          console.error('[WebcamRecording] Error processing recording:', err);
          if (onError) {
            onError(`Failed to process recording: ${err.message}`);
          }
        }
      };

      recorder.onerror = (event) => {
        console.error('[WebcamRecording] Recorder error:', event.error);
        if (onError) {
          onError(`Recording error: ${event.error.message}`);
        }
      };

      recorder.start(1000); // Collect data every second
      setMediaRecorder(recorder);
      setIsRecording(true);

      // Start timer
      startTimeRef.current = Date.now();      timerIntervalRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
        setRecordingDuration(elapsed);
      }, 1000);

    } catch (err) {
      console.error('[WebcamRecording] Failed to start recording:', err);
      if (onError) {
        onError(`Failed to start recording: ${err.message}`);
      }
    }
  };

  // Stop recording
  const handleStopRecording = () => {
    if (mediaRecorder && isRecording) {
      // Calculate final duration before clearing timer
      if (startTimeRef.current) {
        const finalDuration = Math.floor((Date.now() - startTimeRef.current) / 1000);
        finalDurationRef.current = finalDuration;
        console.log('[WebcamRecording] Stopping - startTime:', startTimeRef.current, 'now:', Date.now(), 'duration:', finalDuration);
      } else {      }

      mediaRecorder.stop();
      setIsRecording(false);
      setIsPaused(false);

      // Clear timer
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    }
  };

  // Pause recording
  const handlePauseRecording = () => {
    if (mediaRecorder && isRecording && !isPaused) {
      mediaRecorder.pause();
      setIsPaused(true);

      // Pause timer
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    }
  };

  // Resume recording
  const handleResumeRecording = () => {
    if (mediaRecorder && isRecording && isPaused) {
      mediaRecorder.resume();
      setIsPaused(false);

      // Resume timer
      startTimeRef.current = Date.now() - (recordingDuration * 1000);
      timerIntervalRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
        setRecordingDuration(elapsed);
      }, 1000);
    }
  };

  // Format duration as MM:SS
  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Get VU meter color based on audio level
  const getVUMeterColor = (level) => {
    if (level < 30) return '#27ae60'; // Green - low
    if (level < 70) return '#f39c12'; // Orange - medium
    return '#e74c3c'; // Red - high/clipping
  };

  return (
    <div className="webcam-recording-panel">
      {/* Camera Preview */}
      <div className="webcam-preview-container">
        {isLoadingCameras && (
          <div className="loading-message">
            <p>Requesting camera access...</p>
            <p style={{fontSize: '0.85rem', opacity: 0.7}}>Please allow camera permissions when prompted</p>
          </div>
        )}

        {!isLoadingCameras && cameras.length === 0 && (
          <div className="loading-message">
            <p>No camera detected</p>
            <p style={{fontSize: '0.85rem', opacity: 0.7}}>Please connect a camera and refresh</p>
          </div>
        )}

        <video
          ref={videoRef}
          className="webcam-preview"
          autoPlay
          muted
          playsInline
          style={{ display: isLoadingCameras || cameras.length === 0 ? 'none' : 'block' }}
        />

        {isRecording && (
          <div className="recording-indicator">
            <span className="recording-dot"></span>
            <span className="recording-time">{formatDuration(recordingDuration)}</span>
          </div>
        )}
      </div>

      {/* Camera Selection */}
      <div className="webcam-controls">
        <div className="camera-selector">
          <label htmlFor="camera-select">Camera:</label>
          <select
            id="camera-select"
            value={selectedCameraId || ''}
            onChange={handleCameraChange}
            disabled={isLoadingCameras || isRecording}
          >
            {isLoadingCameras ? (
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

        {/* Audio Toggle */}
        <div className="audio-toggle">
          <label>
            <input
              type="checkbox"
              checked={includeAudio}
              onChange={(e) => setIncludeAudio(e.target.checked)}
              disabled={isRecording}
            />
            Include Audio
          </label>
        </div>

        {/* Audio Device Selection */}
        {includeAudio && audioDevices.length > 0 && (
          <div className="audio-device-selector">
            <label htmlFor="audio-select">Microphone:</label>
            <select
              id="audio-select"
              value={selectedAudioId || ''}
              onChange={handleAudioDeviceChange}
              disabled={isRecording}
            >
              {audioDevices.map(device => (
                <option key={device.id} value={device.id}>
                  {device.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Audio Level Meter */}
        {includeAudio && stream && stream.getAudioTracks().length > 0 && (
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
        )}
      </div>

      {/* Recording Controls */}
      <div className="recording-controls">
        {!isRecording ? (
          <button
            className="control-btn start-recording-btn"
            onClick={handleStartRecording}
            disabled={!stream || cameras.length === 0}
          >
            Start Recording
          </button>
        ) : (
          <>
            {!isPaused ? (
              <button
                className="control-btn pause-recording-btn"
                onClick={handlePauseRecording}
              >
                Pause
              </button>
            ) : (
              <button
                className="control-btn resume-recording-btn"
                onClick={handleResumeRecording}
              >
                Resume
              </button>
            )}
            <button
              className="control-btn stop-recording-btn"
              onClick={handleStopRecording}
            >
              Stop Recording
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default WebcamRecordingPanel;
