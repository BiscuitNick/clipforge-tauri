import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useDraggable } from "@dnd-kit/core";
import ScreenRecordingModal from "./ScreenRecordingModal";
import { usePiPConfig } from "../hooks/usePiPConfig";
import usePiPRecording from "../hooks/usePiPRecording";
import "./MediaLibraryPanel.css";

/**
 * Format duration in seconds to MM:SS format
 */
function formatDuration(seconds) {
  if (!seconds || seconds === 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Format file size in bytes to human-readable format
 */
function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Draggable wrapper for media items
 */
function DraggableMediaItem({ item, isSelected, onSelect }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: item.id,
    data: {
      type: 'media-item',
      mediaId: item.id,
      filename: item.filename,
      filepath: item.filepath,
      duration: item.duration,
      width: item.width,
      height: item.height,
      frameRate: item.frameRate
    }
  });

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    opacity: isDragging ? 0.5 : 1,
  } : undefined;

  const handleClick = (e) => {
    console.log("[MediaLibraryPanel] Media item clicked:", item);
    // Stop event propagation to prevent drag handlers from interfering
    e.stopPropagation();
    if (onSelect) {
      onSelect(item);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`media-item ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`}
      {...attributes}
    >
      <div
        className="media-item-content"
        onClick={handleClick}
      >
        <div className="media-thumbnail" {...listeners}>
          {item.thumbnailPath ? (
            <img
              src={`asset://localhost/${item.thumbnailPath}`}
              alt={item.filename}
              className="thumbnail-image"
            />
          ) : (
            <svg
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
          )}
        </div>
        <div className="media-info">
          <div className="media-title-row">
            <span className="media-filename" title={item.filename}>
              {item.filename}
            </span>
            {item.usedInTimeline && (
              <span className="usage-indicator" title="Used in timeline">
                ●
              </span>
            )}
          </div>
          <div className="media-metadata">
            <span className="media-duration">
              {formatDuration(item.duration)}
            </span>
            {item.width && item.height && (
              <span className="media-resolution">
                {item.width}×{item.height}
              </span>
            )}
            {item.fileSize && (
              <span className="media-filesize">
                {formatFileSize(item.fileSize)}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Media Library Panel - Staging area for imported media
 * Users import files here, which can then be added to the timeline multiple times
 */
function MediaLibraryPanel({ mediaItems = [], onMediaImport, onMediaSelect, selectedMediaId, onRecordingStateChange, isRecording, onPlayPauseMedia, onStopMedia, isLibraryPlaying = false, onWebcamStreamChange, onWebcamRecordingDurationChange, onWebcamPausedChange, onPiPConfigChange, onPiPRecordingChange }) {
  const [isDragging, setIsDragging] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState(""); // "success", "error", "loading"
  const [isLoading, setIsLoading] = useState(false);
  const [isRecordingModalOpen, setIsRecordingModalOpen] = useState(false);
  const [mode, setMode] = useState("media"); // "media", "record-screen", "record-video"
  const [selectedRecordingSource, setSelectedRecordingSource] = useState(null); // Stores selected screen/window and config
  const [isPaused, setIsPaused] = useState(false); // Track recording pause state
  const [countdown, setCountdown] = useState(null); // Countdown timer before recording starts

  // Webcam recording state
  const [isWebcamRecording, setIsWebcamRecording] = useState(false);
  const [isWebcamPaused, setIsWebcamPaused] = useState(false);
  const [webcamStream, setWebcamStream] = useState(null);
  const [webcamRecordingDuration, setWebcamRecordingDuration] = useState(0);
  const webcamMediaRecorderRef = useRef(null);
  const webcamRecordedChunksRef = useRef([]);
  const webcamRecordingStartTimeRef = useRef(null);
  const webcamRecordingTimerRef = useRef(null);
  const webcamFinalDurationRef = useRef(0); // Capture final duration at stop time

  // Webcam device state (inline controls instead of modal)
  const [cameraDevices, setCameraDevices] = useState([]);
  const [audioDevices, setAudioDevices] = useState([]);
  const {
    config: pipConfig,
    setPosition: setPipPosition,
    setSize: setPipSize,
    setCameraId: setPipCameraId,
    setIncludeAudio: setPipIncludeAudio,
    setAudioDeviceId: setPipAudioDeviceId,
  } = usePiPConfig();
  const {
    isPaused: pipIsPaused,
    startRecording: startPiPRecording,
    stopRecording: stopPiPRecording,
    pauseRecording: pausePiPRecording,
    resumeRecording: resumePiPRecording,
    error: pipError,
  } = usePiPRecording();
  const [isPiPEnabled, setIsPiPEnabled] = useState(false);
  const [isPiPActive, setIsPiPActive] = useState(false);
  const pipSessionRef = useRef(null);
  const [selectedCameraId, setSelectedCameraId] = useState(pipConfig.cameraId || null);
  const [selectedAudioId, setSelectedAudioId] = useState(pipConfig.audioDeviceId || null);
  const [includeAudio, setIncludeAudio] = useState(
    pipConfig.includeAudio !== undefined ? pipConfig.includeAudio : true
  );
  const [isMuted, setIsMuted] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const audioAnimationRef = useRef(null);

  // Cleanup webcam recording timer on unmount or mode change
  useEffect(() => {
    return () => {
      if (webcamRecordingTimerRef.current) {
        clearInterval(webcamRecordingTimerRef.current);
        webcamRecordingTimerRef.current = null;
      }
    };
  }, [mode]);

  useEffect(() => {
    if (selectedCameraId) {
      setPipCameraId(selectedCameraId);
    }
  }, [selectedCameraId, setPipCameraId]);

  useEffect(() => {
    setPipIncludeAudio(includeAudio);
  }, [includeAudio, setPipIncludeAudio]);

  useEffect(() => {
    if (selectedAudioId) {
      setPipAudioDeviceId(selectedAudioId);
    }
  }, [selectedAudioId, setPipAudioDeviceId]);

  // Notify parent when pipConfig changes
  useEffect(() => {
    if (isPiPEnabled && onPiPConfigChange) {
      onPiPConfigChange(pipConfig);
    }
  }, [pipConfig, isPiPEnabled, onPiPConfigChange]);

  useEffect(() => {
    if (pipError) {
      setMessage(`PiP error: ${pipError}`);
      setMessageType("error");
    }
  }, [pipError]);

  useEffect(() => {
    if (isPiPEnabled) {
      if (cameraDevices.length === 0) {
        loadCameras();
      }
      if (includeAudio && audioDevices.length === 0) {
        loadAudioDevices();
      }
      if (!webcamStream) {
        startWebcamPreview();
      }
    } else if (mode !== 'record-video') {
      if (webcamStream) {
        webcamStream.getTracks().forEach(track => track.stop());
        setWebcamStream(null);
        if (onWebcamStreamChange) {
          onWebcamStreamChange(null);
        }
      }
      stopAudioMonitoring();
    }
  }, [
    isPiPEnabled,
    includeAudio,
    cameraDevices.length,
    audioDevices.length,
    mode,
    webcamStream,
    onWebcamStreamChange,
  ]);

  // Set up Tauri file drop event listeners
  useEffect(() => {
    const appWindow = getCurrentWindow();

    const dropHandler = appWindow.listen("tauri://drag-drop", (event) => {
      console.log("Media Library - File drop event:", event);
      setIsDragging(false);

      if (event.payload && event.payload.paths) {
        handleFileImport(event.payload.paths);
      }
    });

    const dragEnterHandler = appWindow.listen("tauri://drag-enter", () => {
      setIsDragging(true);
    });

    const dragLeaveHandler = appWindow.listen("tauri://drag-leave", () => {
      setIsDragging(false);
    });

    const dragOverHandler = appWindow.listen("tauri://drag-over", () => {
      // Keep drag state active
    });

    return () => {
      dropHandler.then(unlisten => unlisten());
      dragEnterHandler.then(unlisten => unlisten());
      dragLeaveHandler.then(unlisten => unlisten());
      dragOverHandler.then(unlisten => unlisten());
    };
  }, []);

  const handleFileImport = async (filePaths) => {
    // Validate file extensions
    const validFiles = filePaths.filter(path => {
      const lower = path.toLowerCase();
      return lower.endsWith('.mp4') || lower.endsWith('.mov');
    });

    const invalidCount = filePaths.length - validFiles.length;

    if (invalidCount > 0) {
      setMessage(`Error: ${invalidCount} unsupported file(s). Only MP4 and MOV formats are supported.`);
      setMessageType("error");
      setTimeout(() => {
        setMessage("");
        setMessageType("");
      }, 5000);

      if (validFiles.length === 0) {
        return;
      }
    }

    await importVideos(validFiles);
  };

  // Shared import logic for both drag-drop and file picker
  const importVideos = async (filePaths) => {
    if (!filePaths || filePaths.length === 0) {
      return;
    }

    setIsLoading(true);
    setMessage(`Importing ${filePaths.length} file(s)...`);
    setMessageType("loading");

    try {
      const result = await invoke("import_video", { paths: filePaths });

      setMessage(`Successfully imported ${result.length} file(s) to Media Library!`);
      setMessageType("success");
      console.log("Media Library - Import result:", result);

      // Call onMediaImport callback with the imported video metadata
      if (onMediaImport && result.length > 0) {
        onMediaImport(result);
      }

      setTimeout(() => {
        setMessage("");
        setMessageType("");
      }, 3000);
    } catch (error) {
      console.error("Media Library - Import error:", error);
      setMessage(`Error importing files: ${error}`);
      setMessageType("error");

      setTimeout(() => {
        setMessage("");
        setMessageType("");
      }, 5000);
    } finally {
      setIsLoading(false);
    }
  };

  const handleImportClick = async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [{
          name: 'Video',
          extensions: ['mp4', 'mov']
        }],
        title: 'Select Video Files to Import'
      });

      if (selected) {
        // selected can be a single path (string) or array of paths
        const filePaths = Array.isArray(selected) ? selected : [selected];
        await importVideos(filePaths);
      }
    } catch (error) {
      console.error("File picker error:", error);
      setMessage(`Error opening file picker: ${error}`);
      setMessageType("error");

      setTimeout(() => {
        setMessage("");
        setMessageType("");
      }, 5000);
    }
  };

  // Handle source selection from modal
  const handleSourceSelect = (selection) => {
    console.log("[MediaLibraryPanel] Source selected:", selection);
    setSelectedRecordingSource(selection);

    // Notify parent to show live preview of selected source
    if (onRecordingStateChange) {
      onRecordingStateChange({
        type: 'source-selected',
        source: selection.source,
        config: selection.config
      });
    }
  };

  // Handle starting the recording
  const handleStartRecording = async () => {
    if (!selectedRecordingSource) {
      setMessage("Please select a screen or window first");
      setMessageType("error");
      setTimeout(() => {
        setMessage("");
        setMessageType("");
      }, 3000);
      return;
    }

    // Start countdown
    setIsLoading(true);
    for (let i = 3; i > 0; i--) {
      setCountdown(i);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    setCountdown(null);

    setMessage("Starting recording...");
    setMessageType("loading");

    try {
      if (isPiPEnabled) {
        if (!selectedCameraId) {
          throw new Error('Select a camera before starting overlay recording');
        }
        const stream = webcamStream || (await startWebcamPreview());
        if (!stream) {
          throw new Error('Unable to access webcam for overlay');
        }

        const videoTrack = stream.getVideoTracks()[0];
        const settings = videoTrack?.getSettings ? videoTrack.getSettings() : {};
        const webcamDimensions = {
          width: settings.width || 1280,
          height: settings.height || 720,
        };
        const currentPiPConfig = {
          ...pipConfig,
          cameraId: selectedCameraId || pipConfig.cameraId,
          includeAudio,
          audioDeviceId: selectedAudioId || pipConfig.audioDeviceId,
        };

        const { screenRecording } = await startPiPRecording({
          screenSource: selectedRecordingSource.source,
          pipConfig: currentPiPConfig,
          webcamStream: stream,
          screenRecordingConfig: selectedRecordingSource.config,
          includeSystemAudio: selectedRecordingSource.includeAudio,
        });

        pipSessionRef.current = {
          pipConfig: currentPiPConfig,
          screenDimensions: {
            width:
              selectedRecordingSource.config?.width || selectedRecordingSource.source.width,
            height:
              selectedRecordingSource.config?.height || selectedRecordingSource.source.height,
          },
          webcamDimensions,
        };

        setIsPiPActive(true);
        setIsPaused(false);
        setMessage("");
        setMessageType("");

        // Notify parent that PiP recording has started
        if (onPiPRecordingChange) {
          onPiPRecordingChange(true);
        }

        if (onRecordingStateChange) {
          onRecordingStateChange({
            ...screenRecording,
            isRecording: true,
            isPiPRecording: true,
            source: selectedRecordingSource.source,
            config: selectedRecordingSource.config,
          });
        }

        return;
      }

      const result = await invoke('start_recording', {
        recordingType: 'screen',
        sourceId: selectedRecordingSource.source.id,
        config: selectedRecordingSource.config,
        includeAudio: selectedRecordingSource.includeAudio
      });

      console.log('[MediaLibraryPanel] Recording started:', result);

      // Notify parent about recording start with source information
      if (onRecordingStateChange) {
        onRecordingStateChange({
          ...result,
          isRecording: true,
          source: selectedRecordingSource.source,
          config: selectedRecordingSource.config
        });
      }

      setMessage("");
      setMessageType("");
    } catch (err) {
      console.error('[MediaLibraryPanel] Failed to start recording:', err);
      setMessage(`Failed to start recording: ${err}`);
      setMessageType("error");
      setCountdown(null); // Clear countdown on error
      setTimeout(() => {
        setMessage("");
        setMessageType("");
      }, 5000);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle changing screen/window selection
  const handleChangeSource = () => {
    setIsRecordingModalOpen(true);
  };

  // Handle pause/resume recording
  const handlePauseResumeRecording = async () => {
    if (!isRecording) return;

    if (isPiPActive) {
      try {
        if (pipIsPaused) {
          resumePiPRecording();
          setIsPaused(false);
        } else {
          pausePiPRecording();
          setIsPaused(true);
        }
        setMessage("");
        setMessageType("");
      } catch (err) {
        console.error('[MediaLibraryPanel] Failed to toggle PiP pause:', err);
        setMessage(`Failed to toggle overlay recording: ${err}`);
        setMessageType('error');
        setTimeout(() => {
          setMessage('');
          setMessageType('');
        }, 5000);
      }
      return;
    }

    try {
      if (isPaused) {
        // Resume recording
        setIsLoading(true);
        setMessage("Resuming recording...");
        setMessageType("loading");

        const result = await invoke('resume_recording');
        console.log('[MediaLibraryPanel] Recording resumed:', result);
        setIsPaused(false);
        setMessage("");
        setMessageType("");
      } else {
        // Pause recording
        setIsLoading(true);
        setMessage("Pausing recording...");
        setMessageType("loading");

        const result = await invoke('pause_recording');
        console.log('[MediaLibraryPanel] Recording paused:', result);
        setIsPaused(true);
        setMessage("");
        setMessageType("");
      }
    } catch (err) {
      console.error('[MediaLibraryPanel] Failed to pause/resume recording:', err);
      setMessage(`Failed to ${isPaused ? 'resume' : 'pause'} recording: ${err}`);
      setMessageType("error");
      setTimeout(() => {
        setMessage("");
        setMessageType("");
      }, 5000);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle stop recording
  const handleStopRecording = async () => {
    if (!isRecording) return;

    try {
      setIsLoading(true);
      setMessage("Stopping recording and processing video...");
      setMessageType("loading");

      if (isPiPActive && pipSessionRef.current) {
        const session = pipSessionRef.current;
        const result = await stopPiPRecording({
          pipConfig: session.pipConfig,
          screenDimensions: session.screenDimensions,
          webcamDimensions: session.webcamDimensions,
        });

        console.log('[MediaLibraryPanel] PiP recording stopped:', result);

        setIsPiPActive(false);
        pipSessionRef.current = null;
        setIsPaused(false);
        setSelectedRecordingSource(null);

        // Notify parent that PiP recording has stopped
        if (onPiPRecordingChange) {
          onPiPRecordingChange(false);
        }

        if (onWebcamStreamChange) {
          onWebcamStreamChange(null);
        }

        if (onRecordingStateChange) {
          onRecordingStateChange({
            file_path: result.compositedFilePath,
          });
        }

        setMode("media");
        if (result.compositeSucceeded) {
          setMessage("Recording saved with webcam overlay!");
          setMessageType("success");
        } else {
          setMessage("Recording saved (webcam overlay unavailable).");
          setMessageType("error");
        }

        setTimeout(() => {
          setMessage("");
          setMessageType("");
        }, 3000);
        return;
      }

      const result = await invoke('stop_recording');
      console.log('[MediaLibraryPanel] Recording stopped:', result);

      // Reset state
      setIsPaused(false);
      setSelectedRecordingSource(null);

      // Notify parent
      if (onRecordingStateChange) {
        onRecordingStateChange(result);
      }

      // Switch to media files view
      setMode("media");
      setMessage("Recording saved successfully!");
      setMessageType("success");

      setTimeout(() => {
        setMessage("");
        setMessageType("");
      }, 3000);
    } catch (err) {
      console.error('[MediaLibraryPanel] Failed to stop recording:', err);
      if (isPiPActive) {
        setIsPiPActive(false);
        pipSessionRef.current = null;
        if (onPiPRecordingChange) {
          onPiPRecordingChange(false);
        }
        if (onWebcamStreamChange) {
          onWebcamStreamChange(null);
        }
      }
      setMessage(`Failed to stop recording: ${err}`);
      setMessageType("error");
      setTimeout(() => {
        setMessage("");
        setMessageType("");
      }, 5000);
    } finally {
      setIsLoading(false);
    }
  };

  // Load available cameras
  const loadCameras = async () => {
    try {
      // Request camera access to trigger permission prompt
      const tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });

      // Enumerate devices
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(device => device.kind === 'videoinput');

      // Stop temp stream
      tempStream.getTracks().forEach(track => track.stop());

      // Convert to camera format
      const cameras = videoDevices.map((device, index) => ({
        id: device.deviceId,
        name: device.label || `Camera ${index + 1}`,
        is_default: index === 0
      }));

      setCameraDevices(cameras);

      // Auto-select default
      if (cameras.length > 0 && !selectedCameraId) {
        setSelectedCameraId(cameras[0].id);
      }
    } catch (err) {
      console.error('[MediaLibraryPanel] Failed to enumerate cameras:', err);
      setMessage(`Failed to load cameras: ${err.message || err}`);
      setMessageType("error");
      setTimeout(() => {
        setMessage("");
        setMessageType("");
      }, 5000);
    }
  };

  // Load available audio devices
  const loadAudioDevices = async () => {
    try {
      // Request audio access
      const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Enumerate audio input devices
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(device => device.kind === 'audioinput');

      // Stop temp stream
      tempStream.getTracks().forEach(track => track.stop());

      // Convert to audio format
      const audioDevs = audioInputs.map((device, index) => ({
        id: device.deviceId,
        name: device.label || `Microphone ${index + 1}`,
        is_default: index === 0
      }));

      setAudioDevices(audioDevs);

      // Auto-select default
      if (audioDevs.length > 0 && !selectedAudioId) {
        setSelectedAudioId(audioDevs[0].id);
      }
    } catch (err) {
      console.error('[MediaLibraryPanel] Failed to enumerate audio devices:', err);
      // Don't show error - audio is optional
    }
  };

  // Start audio level monitoring
  const startAudioMonitoring = (mediaStream) => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }

      const audioContext = audioContextRef.current;
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      analyserRef.current = analyser;

      const source = audioContext.createMediaStreamSource(mediaStream);
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const updateAudioLevel = () => {
        if (!analyserRef.current) return;

        analyser.getByteFrequencyData(dataArray);
        const sum = dataArray.reduce((a, b) => a + b, 0);
        const average = sum / dataArray.length;
        const normalizedLevel = Math.min(100, (average / 255) * 100);

        setAudioLevel(isMuted ? 0 : normalizedLevel);
        audioAnimationRef.current = requestAnimationFrame(updateAudioLevel);
      };

      updateAudioLevel();
    } catch (err) {
      console.error('[MediaLibraryPanel] Failed to start audio monitoring:', err);
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

  // Load devices when entering record-video mode
  useEffect(() => {
    if (mode === 'record-video') {
      loadCameras();
      loadAudioDevices();
    } else {
      // Cleanup when leaving record-video mode
      stopAudioMonitoring();
    }

    return () => {
      stopAudioMonitoring();
    };
  }, [mode]);

  // Start webcam preview when device selections change
  const startWebcamPreview = async () => {
    if (!selectedCameraId || isWebcamRecording) return;

    try {
      // Stop existing stream
      if (webcamStream) {
        webcamStream.getTracks().forEach(track => track.stop());
      }
      stopAudioMonitoring();

      const constraints = {
        video: { deviceId: { exact: selectedCameraId } },
        audio: includeAudio && selectedAudioId ? { deviceId: { exact: selectedAudioId } } : includeAudio
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      setWebcamStream(stream);

      // Start audio monitoring if audio is enabled
      if (includeAudio && stream.getAudioTracks().length > 0) {
        startAudioMonitoring(stream);
      }

      // Notify parent to show webcam preview
      if (onWebcamStreamChange) {
        onWebcamStreamChange(stream);
      }

      return stream;
    } catch (err) {
      console.error('[MediaLibraryPanel] Failed to start webcam stream:', err);
      setMessage(`Failed to start webcam: ${err.message}`);
      setMessageType("error");
      setTimeout(() => {
        setMessage("");
        setMessageType("");
      }, 5000);
      if (onWebcamStreamChange) {
        onWebcamStreamChange(null);
      }
      return null;
    }
  };

  // Start preview when device selections change
  useEffect(() => {
    if ((mode === 'record-video' || isPiPEnabled) && selectedCameraId) {
      startWebcamPreview();
    }
  }, [selectedCameraId, selectedAudioId, includeAudio, isPiPEnabled, mode]);

  // Handle mute toggle
  const handleMuteToggle = () => {
    setIsMuted(!isMuted);
    if (webcamStream) {
      const audioTracks = webcamStream.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = isMuted; // Will be flipped after state updates
      });
    }
  };

  // Handle starting webcam recording
  const handleStartWebcamRecording = async () => {
    if (!webcamStream) {
      setMessage("Please configure camera first");
      setMessageType("error");
      setTimeout(() => {
        setMessage("");
        setMessageType("");
      }, 3000);
      return;
    }

    try {
      setIsWebcamRecording(true);
      setIsWebcamPaused(false);

      // Reset all recording state
      webcamRecordedChunksRef.current = [];
      webcamFinalDurationRef.current = 0;

      console.log('[MediaLibraryPanel] Starting webcam recording, stream tracks:', webcamStream.getTracks().length);

      // Create MediaRecorder with the stream
      const options = {
        mimeType: 'video/webm;codecs=vp8,opus',
        videoBitsPerSecond: 2500000
      };

      const mediaRecorder = new MediaRecorder(webcamStream, options);
      webcamMediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          console.log('[MediaLibraryPanel] Data chunk received, size:', event.data.size, 'total chunks:', webcamRecordedChunksRef.current.length + 1);
          webcamRecordedChunksRef.current.push(event.data);
        } else {
          console.warn('[MediaLibraryPanel] Received empty data chunk');
        }
      };

      mediaRecorder.onstop = async () => {
        console.log('[MediaLibraryPanel] Webcam recording stopped, saving...');
        console.log('[MediaLibraryPanel] Chunks collected:', webcamRecordedChunksRef.current.length);

        // Stop timer
        if (webcamRecordingTimerRef.current) {
          clearInterval(webcamRecordingTimerRef.current);
          webcamRecordingTimerRef.current = null;
        }

        // Use the captured final duration
        const finalDuration = webcamFinalDurationRef.current;
        console.log('[MediaLibraryPanel] Using final duration:', finalDuration);

        // Create blob from recorded chunks
        const blob = new Blob(webcamRecordedChunksRef.current, {
          type: 'video/webm'
        });

        console.log('[MediaLibraryPanel] Blob size:', blob.size, 'bytes');

        if (blob.size === 0) {
          console.error('[MediaLibraryPanel] Blob is empty! No data recorded.');
          setMessage("Recording failed: No data captured");
          setMessageType("error");
          setTimeout(() => {
            setMessage("");
            setMessageType("");
          }, 5000);
          return;
        }

        try {
          // Convert blob to array buffer
          const arrayBuffer = await blob.arrayBuffer();
          const uint8Array = new Uint8Array(arrayBuffer);

          // Convert to array of numbers (required for Tauri serialization)
          const dataArray = [...uint8Array];

          console.log('[MediaLibraryPanel] Saving webcam recording, size:', dataArray.length, 'bytes, duration:', finalDuration);

          // Save the recording
          const result = await invoke('save_webcam_recording', {
            data: dataArray,
            mimeType: 'video/webm',
            duration: finalDuration
          });

          console.log('[MediaLibraryPanel] Webcam recording saved:', result);

          // Import the saved recording by fetching its path
          // The result is the file path, so we need to import it
          const importResult = await invoke('import_video', {
            paths: [result]
          });

          console.log('[MediaLibraryPanel] Webcam recording imported:', importResult);

          // Add to media library
          if (onMediaImport && importResult && importResult.length > 0) {
            onMediaImport(importResult);
          }

          setMessage("Webcam recording saved successfully!");
          setMessageType("success");

          setTimeout(() => {
            setMessage("");
            setMessageType("");
          }, 3000);

          // Reset and go back to media view
          setMode("media");
          setWebcamRecordingDuration(0);
          if (webcamStream) {
            webcamStream.getTracks().forEach(track => track.stop());
            setWebcamStream(null);
          }
          // Reset to default camera for next recording
          if (cameraDevices.length > 0) {
            setSelectedCameraId(cameraDevices[0].id);
          }
        } catch (err) {
          console.error('[MediaLibraryPanel] Failed to save webcam recording:', err);
          setMessage(`Failed to save recording: ${err}`);
          setMessageType("error");
          setTimeout(() => {
            setMessage("");
            setMessageType("");
          }, 5000);
        }
      };

      // Start recording
      mediaRecorder.start(1000); // Collect data every second
      console.log('[MediaLibraryPanel] Webcam recording started');

      // Start timer
      webcamRecordingStartTimeRef.current = Date.now();
      setWebcamRecordingDuration(0);
      if (onWebcamRecordingDurationChange) {
        onWebcamRecordingDurationChange(0);
      }
      webcamRecordingTimerRef.current = setInterval(() => {
        const elapsed = (Date.now() - webcamRecordingStartTimeRef.current) / 1000;
        setWebcamRecordingDuration(elapsed);
        if (onWebcamRecordingDurationChange) {
          onWebcamRecordingDurationChange(elapsed);
        }
      }, 100); // Update every 100ms for smooth display

      setMessage("Recording started");
      setMessageType("success");
      setTimeout(() => {
        setMessage("");
        setMessageType("");
      }, 2000);
    } catch (err) {
      console.error('[MediaLibraryPanel] Failed to start webcam recording:', err);
      setMessage(`Failed to start recording: ${err.message}`);
      setMessageType("error");
      setTimeout(() => {
        setMessage("");
        setMessageType("");
      }, 5000);
      setIsWebcamRecording(false);
    }
  };

  // Handle pausing/resuming webcam recording
  const handleToggleWebcamPause = () => {
    const recorder = webcamMediaRecorderRef.current;
    if (!recorder) return;

    if (isWebcamPaused) {
      // Resume recording and timer
      recorder.resume();
      setIsWebcamPaused(false);
      if (onWebcamPausedChange) {
        onWebcamPausedChange(false);
      }
      // Restart timer from where we paused
      webcamRecordingStartTimeRef.current = Date.now() - (webcamRecordingDuration * 1000);
      webcamRecordingTimerRef.current = setInterval(() => {
        const elapsed = (Date.now() - webcamRecordingStartTimeRef.current) / 1000;
        setWebcamRecordingDuration(elapsed);
        if (onWebcamRecordingDurationChange) {
          onWebcamRecordingDurationChange(elapsed);
        }
      }, 100);
      console.log('[MediaLibraryPanel] Webcam recording resumed');
    } else {
      // Pause recording and timer
      recorder.pause();
      setIsWebcamPaused(true);
      if (onWebcamPausedChange) {
        onWebcamPausedChange(true);
      }
      if (webcamRecordingTimerRef.current) {
        clearInterval(webcamRecordingTimerRef.current);
        webcamRecordingTimerRef.current = null;
      }
      console.log('[MediaLibraryPanel] Webcam recording paused');
    }
  };

  // Handle stopping webcam recording
  const handleStopWebcamRecording = () => {
    const recorder = webcamMediaRecorderRef.current;
    if (!recorder) return;

    // Capture final duration before stopping
    if (webcamRecordingStartTimeRef.current) {
      const finalDuration = (Date.now() - webcamRecordingStartTimeRef.current) / 1000;
      webcamFinalDurationRef.current = finalDuration;
      console.log('[MediaLibraryPanel] Capturing final duration:', finalDuration);
    }

    if (recorder.state !== 'inactive') {
      recorder.stop();
    }

    setIsWebcamRecording(false);
    setIsWebcamPaused(false);
    console.log('[MediaLibraryPanel] Webcam recording stopped');
  };

  return (
    <div className="media-library-panel">
      {/* Countdown Overlay */}
      {countdown !== null && (
        <div className="countdown-overlay">
          <div className="countdown-content">
            <div className="countdown-number">{countdown}</div>
            <div className="countdown-text">Recording starts in...</div>
          </div>
        </div>
      )}

      <div className="panel-header">
        <h2>Media Library</h2>
        <div className="header-controls">
          <select
            className="mode-selector"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            disabled={isRecording}
          >
            <option value="media">Media Files</option>
            <option value="record-screen">Record Screen</option>
            <option value="record-video">Record Video</option>
          </select>
          {mode === "media" && (
            <span className="media-count">{mediaItems.length} items</span>
          )}
        </div>
      </div>

      <div className="panel-content-scrollable">
        {mode === "media" && (
          <>
            {mediaItems.length === 0 ? (
              // Show drop zone when no media is imported
              <div className={`drop-zone ${isDragging ? "dragging" : ""}`}>
                <div className="drop-zone-content">
                  <svg
                    className="drop-zone-icon"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                    />
                  </svg>
                  <h3>Drop Media Here</h3>
                  <p>Supports MP4 and MOV</p>
                  <button
                    className="import-button"
                    onClick={handleImportClick}
                    disabled={isLoading}
                  >
                    {isLoading ? 'Importing...' : 'Browse Files'}
                  </button>
                </div>
              </div>
            ) : (
              // Show media list when items exist
              <div className="media-list">
                <div className="media-items">
                  {mediaItems.map((item) => (
                    <DraggableMediaItem
                      key={item.id}
                      item={item}
                      isSelected={selectedMediaId === item.id}
                      onSelect={onMediaSelect}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {mode === "record-screen" && (
          <div className="recording-mode-view">
            {!selectedRecordingSource ? (
              <div className="recording-mode-centered">
                <button
                  className="select-source-button"
                  onClick={() => setIsRecordingModalOpen(true)}
                  disabled={isLoading || isRecording}
                >
                  Select Screen/Window
                </button>
              </div>
            ) : (
              <div className="recording-mode-centered">
                <div className="selected-source-compact">
                  <span className="source-details">
                    {selectedRecordingSource.source.name} • {selectedRecordingSource.config.width} × {selectedRecordingSource.config.height}
                    {selectedRecordingSource.resolution !== 'native' && ` (${selectedRecordingSource.resolution})`}
                  </span>
                  <button
                    className="change-source-button-compact"
                    onClick={handleChangeSource}
                    disabled={isLoading || isRecording || isPiPActive}
                  >
                    Change Source
                  </button>
                </div>
                <div className="pip-overlay-settings">
                  <label className="config-checkbox">
                    <input
                      type="checkbox"
                      checked={isPiPEnabled}
                      onChange={(e) => setIsPiPEnabled(e.target.checked)}
                      disabled={isRecording || isPiPActive}
                    />
                    <span>Include webcam overlay</span>
                  </label>

                  {isPiPEnabled && (
                    <div className="pip-settings-panel">
                      <div className="pip-settings-row">
                        <label className="config-label">Camera</label>
                        <select
                          className="config-select"
                          value={selectedCameraId || ''}
                          onChange={(e) => setSelectedCameraId(e.target.value)}
                          disabled={isRecording || isPiPActive || cameraDevices.length === 0}
                        >
                          {cameraDevices.length === 0 ? (
                            <option>No cameras found</option>
                          ) : (
                            cameraDevices.map(camera => (
                              <option key={camera.id} value={camera.id}>
                                {camera.name}
                              </option>
                            ))
                          )}
                        </select>
                      </div>

                      <div className="pip-settings-row">
                        <label className="config-label">Overlay Size</label>
                        <div className="pip-size-options">
                          {['small', 'medium', 'large'].map(sizeOption => (
                            <button
                              key={sizeOption}
                              type="button"
                              className={`pip-size-button ${pipConfig.size === sizeOption ? 'active' : ''}`}
                              onClick={() => setPipSize(sizeOption)}
                              disabled={isRecording || isPiPActive}
                            >
                              {sizeOption === 'small' ? 'Small' : sizeOption === 'medium' ? 'Medium' : 'Large'}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="pip-settings-row">
                        <label className="config-label">Position</label>
                        <div className="pip-position-grid">
                          {['topLeft', 'topRight', 'bottomLeft', 'bottomRight'].map(pos => (
                            <button
                              key={pos}
                              type="button"
                              className={`pip-position-button ${pipConfig.position === pos ? 'active' : ''}`}
                              onClick={() => setPipPosition(pos)}
                              disabled={isRecording || isPiPActive}
                              title={pos.replace(/([A-Z])/g, ' $1')}
                            >
                              {pos === 'topLeft' && '↖'}
                              {pos === 'topRight' && '↗'}
                              {pos === 'bottomLeft' && '↙'}
                              {pos === 'bottomRight' && '↘'}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="pip-settings-row">
                        <label className="config-checkbox">
                          <input
                            type="checkbox"
                            checked={includeAudio}
                            onChange={(e) => setIncludeAudio(e.target.checked)}
                            disabled={isRecording || isPiPActive}
                          />
                          <span>Include webcam audio</span>
                        </label>
                        {includeAudio && audioDevices.length > 0 && (
                          <select
                            className="config-select"
                            value={selectedAudioId || ''}
                            onChange={(e) => setSelectedAudioId(e.target.value)}
                            disabled={isRecording || isPiPActive}
                          >
                            {audioDevices.map(device => (
                              <option key={device.id} value={device.id}>
                                {device.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>

                      <div className="pip-preview-row">
                        <div className="pip-preview-label">Webcam Preview</div>
                        <div className="pip-preview-box">
                          {webcamStream ? (
                            <video
                              ref={(el) => {
                                if (el && webcamStream && el.srcObject !== webcamStream) {
                                  el.srcObject = webcamStream;
                                  el.play().catch(() => {});
                                }
                              }}
                              autoPlay
                              muted
                              playsInline
                            />
                          ) : (
                            <div className="pip-preview-placeholder">Camera inactive</div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {mode === "record-video" && (
          <div className="webcam-config-inline">
            {/* Camera Selection */}
            <div className="config-row">
              <label className="config-label">Camera:</label>
              <select
                className="config-select"
                value={selectedCameraId || ''}
                onChange={(e) => setSelectedCameraId(e.target.value)}
                disabled={isWebcamRecording || cameraDevices.length === 0}
              >
                {cameraDevices.length === 0 ? (
                  <option>No cameras found</option>
                ) : (
                  cameraDevices.map(camera => (
                    <option key={camera.id} value={camera.id}>
                      {camera.name}
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* Audio Toggle */}
            <div className="config-row">
              <label className="config-checkbox">
                <input
                  type="checkbox"
                  checked={includeAudio}
                  onChange={(e) => setIncludeAudio(e.target.checked)}
                  disabled={isWebcamRecording}
                />
                <span>Include Audio</span>
              </label>
            </div>

            {/* Audio Device Selection */}
            {includeAudio && audioDevices.length > 0 && (
              <div className="config-row">
                <label className="config-label">Microphone:</label>
                <select
                  className="config-select"
                  value={selectedAudioId || ''}
                  onChange={(e) => setSelectedAudioId(e.target.value)}
                  disabled={isWebcamRecording}
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
            {includeAudio && webcamStream && webcamStream.getAudioTracks().length > 0 && (
              <div className="config-row audio-meter-row">
                <button
                  className={`mute-btn ${isMuted ? 'muted' : ''}`}
                  onClick={handleMuteToggle}
                  title={isMuted ? 'Unmute' : 'Mute'}
                  disabled={isWebcamRecording}
                >
                  {isMuted ? '🔇' : '🔊'}
                </button>
                <div className="vu-meter">
                  <div
                    className="vu-meter-fill"
                    style={{
                      width: `${audioLevel}%`,
                      backgroundColor: audioLevel < 30 ? '#27ae60' : audioLevel < 70 ? '#f39c12' : '#e74c3c'
                    }}
                  />
                </div>
                <span className="audio-level-text">{Math.round(audioLevel)}%</span>
              </div>
            )}
          </div>
        )}

        {message && (
          <div className={`message ${messageType}`}>
            {message}
          </div>
        )}
      </div>

      {/* Video Controls - Context-based */}
      <div className="media-library-controls">
        {mode === "media" ? (
          // Media Files controls: Add Media button + Play/Stop for selected media
          <>
            {mediaItems.length > 0 && (
              <>
                <button
                  className="control-btn add-media-btn"
                  onClick={handleImportClick}
                  disabled={isLoading}
                  title="Add Media"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                    <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
                  </svg>
                </button>
                <div className="controls-separator" />
              </>
            )}
            <div className="media-library-controls-playback">
              <button
                className="control-btn stop-btn"
                onClick={onStopMedia}
                disabled={!selectedMediaId}
                title="Stop"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                  <path d="M6 6h12v12H6z" />
                </svg>
              </button>
              <button
                className={`control-btn ${isLibraryPlaying ? 'pause-btn' : 'play-btn'}`}
                onClick={onPlayPauseMedia}
                disabled={!selectedMediaId}
                title={isLibraryPlaying ? "Pause" : "Play"}
              >
                {isLibraryPlaying ? (
                  <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                    <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>
            </div>
          </>
        ) : mode === "record-screen" ? (
          // Record Screen controls: Record/Pause/Stop (centered)
          <div className="media-library-controls-playback">
            <button
              className="control-btn stop-btn"
              onClick={handleStopRecording}
              disabled={!isRecording}
              title="Stop Recording"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                <path d="M6 6h12v12H6z" />
              </svg>
            </button>
            <button
              className="control-btn record-btn"
              onClick={isRecording ? handlePauseResumeRecording : handleStartRecording}
              disabled={(!selectedRecordingSource && !isRecording) || (isPiPEnabled && !selectedCameraId)}
              title={isRecording ? (isPaused ? "Resume Recording" : "Pause Recording") : "Start Recording"}
            >
              {isRecording ? (
                isPaused ? (
                  <svg fill="currentColor" viewBox="0 0 20 20" width="18" height="18">
                    <circle cx="10" cy="10" r="6" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                    <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                  </svg>
                )
              ) : (
                <svg fill="currentColor" viewBox="0 0 20 20" width="18" height="18">
                  <circle cx="10" cy="10" r="6" />
                </svg>
              )}
            </button>
          </div>
        ) : mode === "record-video" ? (
          // Record Video (Webcam) controls: Stop/Record/Pause (centered)
          <div className="media-library-controls-playback">
            <button
              className="control-btn stop-btn"
              onClick={handleStopWebcamRecording}
              disabled={!isWebcamRecording}
              title="Stop Recording"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                <path d="M6 6h12v12H6z" />
              </svg>
            </button>
            <button
              className="control-btn record-btn"
              onClick={() => {
                if (isWebcamRecording) {
                  handleToggleWebcamPause();
                } else {
                  handleStartWebcamRecording();
                }
              }}
              disabled={!webcamStream && !isWebcamRecording}
              title={isWebcamRecording ? (isWebcamPaused ? "Resume Recording" : "Pause Recording") : "Start Recording"}
            >
              {isWebcamRecording ? (
                isWebcamPaused ? (
                  <svg fill="currentColor" viewBox="0 0 20 20" width="18" height="18">
                    <circle cx="10" cy="10" r="6" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                    <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                  </svg>
                )
              ) : (
                <svg fill="currentColor" viewBox="0 0 20 20" width="18" height="18">
                  <circle cx="10" cy="10" r="6" />
                </svg>
              )}
            </button>
          </div>
        ) : null}
      </div>

      <ScreenRecordingModal
        isOpen={isRecordingModalOpen}
        onClose={() => setIsRecordingModalOpen(false)}
        onSourceSelect={handleSourceSelect}
      />
    </div>
  );
}

export default MediaLibraryPanel;
