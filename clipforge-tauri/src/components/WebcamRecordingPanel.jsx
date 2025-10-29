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

  // MediaStream and recording state
  const [stream, setStream] = useState(null);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [includeAudio, setIncludeAudio] = useState(true);

  // Refs
  const videoRef = useRef(null);
  const chunksRef = useRef([]);
  const timerIntervalRef = useRef(null);
  const startTimeRef = useRef(null);
  const finalDurationRef = useRef(0);

  // Load available cameras on mount
  useEffect(() => {
    loadCameras();
    return () => {
      // Cleanup on unmount
      stopStream();
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

  // Start camera preview
  const startPreview = async () => {
    try {
      // Stop existing stream if any
      stopStream();

      const constraints = {
        video: selectedCameraId ? { deviceId: { exact: selectedCameraId } } : true,
        audio: includeAudio
      };

      const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      setStream(mediaStream);

      // Attach to video element
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
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

  // Start preview when camera or audio settings change
  useEffect(() => {
    if (selectedCameraId) {
      startPreview();
    }
    return () => {
      stopStream();
    };
  }, [selectedCameraId, includeAudio]);

  // Handle camera selection change
  const handleCameraChange = (e) => {
    setSelectedCameraId(e.target.value);
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

          console.log('[WebcamRecording] Recording saved to:', filePath);
          console.log('[WebcamRecording] Final duration from ref:', duration, 'State duration:', recordingDuration);

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
      startTimeRef.current = Date.now();
      console.log('[WebcamRecording] Recording started at:', startTimeRef.current);
      timerIntervalRef.current = setInterval(() => {
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
      } else {
        console.warn('[WebcamRecording] startTimeRef is null when stopping!');
      }

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
