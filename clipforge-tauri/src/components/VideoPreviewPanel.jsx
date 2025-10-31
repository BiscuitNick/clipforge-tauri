import { useRef, useState, useEffect } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import "./VideoPreviewPanel.css";
import usePreviewStream from "../hooks/usePreviewStream";
import useCompositePreview from "../hooks/useCompositePreview";

/**
 * Format time in seconds to MM:SS format
 */
function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Video Preview Panel - Central playback area
 * Loads selected media and provides playback controls
 * Videos remain paused on load until user clicks play
 * Supports multiple modes:
 * - library: Preview a single media item from the library
 * - timeline: Play back the timeline with clips and gaps
 * - recording: Show live recording preview and controls
 * - webcam-recording: Show live webcam stream during recording
 * - pip-recording: Show combined screen + webcam overlay preview
 */
function VideoPreviewPanel({ selectedMedia, mode = "library", timelineState = null, recordingState = null, onStopRecording, libraryPlaybackCommand = null, webcamStream = null, webcamRecordingDuration = 0, isWebcamPaused = false, panelLabel = "Video Preview", onCollapse = null, pipConfig = null, isPiPRecording = false }) {
  const videoRef = useRef(null);
  const webcamVideoRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const [videoSrc, setVideoSrc] = useState(null);
  const [showBlackScreen, setShowBlackScreen] = useState(false);
  const [currentClipId, setCurrentClipId] = useState(null); // Track currently loaded clip
  const previewEnabled = mode === "recording" || mode === "recording-preview" || (mode === "pip-recording" && isPiPRecording);
  const {
    canvasRef: previewCanvasRef,
    hasFrame: hasPreviewFrame,
    actualFps: previewActualFps,
    isRecording: previewIsRecording,
  } = usePreviewStream(previewEnabled);

  // Composite preview for PiP - show during recording AND during preview (when PiP is configured)
  // Enable composite when:
  // 1. Currently recording with PiP (mode === "pip-recording")
  // 2. Ready to record with PiP (mode === "recording-preview" and pipConfig exists)
  const isPiPConfigured = pipConfig && pipConfig.cameraId && webcamStream;
  const compositeEnabled = (
    (mode === "pip-recording" && isPiPRecording) ||
    (mode === "recording-preview" && isPiPConfigured)
  ) && hasPreviewFrame && webcamStream;

  const { compositeCanvasRef } = useCompositePreview(
    previewCanvasRef.current,
    webcamVideoRef.current,
    pipConfig,
    compositeEnabled
  );

  // Debug: Log props changes
  useEffect(() => {  }, [selectedMedia, mode, timelineState, isPiPConfigured, compositeEnabled]);

  // Debug: Log videoSrc changes
  useEffect(() => {  }, [videoSrc]);

  // Handle webcam stream changes
  useEffect(() => {
    const shouldShowWebcam =
      mode === "webcam-recording" ||
      mode === "pip-recording" ||
      (mode === "recording-preview" && isPiPConfigured);

    if (!shouldShowWebcam) {
      // Clear webcam stream when not needed
      if (webcamVideoRef.current) {
        webcamVideoRef.current.srcObject = null;
      }
      return;
    }

    const video = webcamVideoRef.current;
    if (!video) return;

    if (webcamStream) {      video.srcObject = webcamStream;
      video.play().catch(err => console.error("[VideoPreview] Webcam play failed:", err));
    } else {      video.srcObject = null;
    }
  }, [webcamStream, mode, isPiPConfigured]);

  // Handle library playback commands (from Media Library controls)
  useEffect(() => {
    if (!libraryPlaybackCommand || mode !== "library") return;

    const video = videoRef.current;
    if (!video) return;

    if (libraryPlaybackCommand === 'play') {      video.play().catch(err => console.error("[VideoPreview] Play failed:", err));
    } else if (libraryPlaybackCommand === 'pause') {      video.pause();
    } else if (libraryPlaybackCommand === 'stop') {      video.pause();
      video.currentTime = 0;
      setCurrentTime(0);
    }
  }, [libraryPlaybackCommand, mode]);

  // Handle timeline playback mode
  useEffect(() => {
    if (mode !== "timeline" || !timelineState) {      setCurrentClipId(null);
      return;
    }

    const { playheadPosition, getClipAtTime, isPlaying: timelinePlaying } = timelineState;
    const activeClipData = getClipAtTime(playheadPosition);
    if (!activeClipData) {
      // In a gap - show black screen      setShowBlackScreen(true);
      setVideoSrc(null);
      setCurrentClipId(null);
      if (videoRef.current) {
        videoRef.current.pause();
      }
      return;
    }

    const { clip, sourceTime } = activeClipData;    setShowBlackScreen(false);

    // Load the clip's video if not already loaded
    const assetUrl = convertFileSrc(clip.videoPath);
    const isClipChange = currentClipId !== clip.id;
    if (isClipChange) {      setVideoSrc(assetUrl);
      setCurrentClipId(clip.id);

      // Set duration from clip
      if (clip.duration) {
        setDuration(clip.duration);
      }

      // When video loads, seek to correct position
      const video = videoRef.current;
      if (video) {
        const handleCanPlayTimeline = () => {          video.currentTime = sourceTime;
          setCurrentTime(sourceTime);

          // Start playback if timeline is playing
          if (timelinePlaying) {
            video.play().catch(err => console.error("[VideoPreview] Play failed:", err));
          }

          video.removeEventListener('canplay', handleCanPlayTimeline);
        };

        video.addEventListener('canplay', handleCanPlayTimeline);

        // Cleanup
        return () => {
          video.removeEventListener('canplay', handleCanPlayTimeline);
        };
      }
    } else {
      // Same clip - only sync if needed
      const video = videoRef.current;
      if (video && video.readyState >= 2) {
        const videoTime = video.currentTime;
        const timeDiff = Math.abs(videoTime - sourceTime);

        // Only seek if severely out of sync (> 0.5s) or if paused
        // This prevents constant seeking during playback which causes choppiness
        if (timeDiff > 0.5 || !timelinePlaying) {
          console.log("[VideoPreview] Timeline - Syncing time from", videoTime, "to", sourceTime, "(diff:", timeDiff, ")");
          video.currentTime = sourceTime;
        }

        // Sync play/pause state
        if (timelinePlaying && video.paused) {          video.play().catch(err => console.error("[VideoPreview] Play failed:", err));
        } else if (!timelinePlaying && !video.paused) {          video.pause();
        }
      }
    }
  }, [mode, timelineState, currentClipId]);

  // Load video when selectedMedia changes (library mode)
  useEffect(() => {
    if (mode !== "library") {      return;
    }

    // Clear clip tracking when in library mode
    setCurrentClipId(null);

    if (!selectedMedia) {      setVideoSrc(null);
      setDuration(0);
      setCurrentTime(0);
      setIsPlaying(false);
      setShowBlackScreen(false);
      return;
    }

    // Convert filepath to Tauri asset URL
    const assetUrl = convertFileSrc(selectedMedia.filepath);
    // Set duration from media metadata (FFprobe) immediately
    if (selectedMedia.duration) {      setDuration(selectedMedia.duration);
    }

    setVideoSrc(assetUrl);
    setCurrentTime(0);
    setIsPlaying(false);
    setShowBlackScreen(false);
  }, [selectedMedia, mode]);

  // Setup video event listeners
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedMetadata = () => {
      if (video.duration && !isNaN(video.duration) && isFinite(video.duration)) {
        setDuration(video.duration);      } else {      }

      setCurrentTime(0);
      video.currentTime = 0;
      // Ensure video is paused on load
      video.pause();
      setIsPlaying(false);
    };

    const handleError = (e) => {
      console.error("[VideoPreview] Video error:", e);
      console.error("[VideoPreview] Video src:", video.src);
      console.error("[VideoPreview] Video error code:", video.error?.code);
      console.error("[VideoPreview] Video error message:", video.error?.message);
    };

    const handleLoadStart = () => {    };

    const handleCanPlay = () => {      // Sometimes duration is only available after canplay
      if (video.duration && !isNaN(video.duration) && isFinite(video.duration)) {
        if (duration === 0) {          setDuration(video.duration);
        }
      }
    };

    const handleDurationChange = () => {      if (video.duration && !isNaN(video.duration) && isFinite(video.duration)) {
        setDuration(video.duration);
      }
    };

    const handleTimeUpdate = () => {
      if (!isSeeking) {
        setCurrentTime(video.currentTime);
      }
    };

    const handlePlayEvent = () => {
      setIsPlaying(true);
    };

    const handlePauseEvent = () => {
      setIsPlaying(false);
    };

    const handleEnded = () => {
      // Loop if in library mode
      if (mode === "library") {
        video.currentTime = 0;
        video.play();
      } else {
        setIsPlaying(false);
      }
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('durationchange', handleDurationChange);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('play', handlePlayEvent);
    video.addEventListener('pause', handlePauseEvent);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('error', handleError);
    video.addEventListener('loadstart', handleLoadStart);
    video.addEventListener('canplay', handleCanPlay);

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('durationchange', handleDurationChange);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('play', handlePlayEvent);
      video.removeEventListener('pause', handlePauseEvent);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('error', handleError);
      video.removeEventListener('loadstart', handleLoadStart);
      video.removeEventListener('canplay', handleCanPlay);
    };
  }, [isSeeking, mode, duration]);

  // Handle play
  const handlePlay = () => {
    if (mode === "timeline" && timelineState) {
      timelineState.play();
    } else if (videoRef.current) {
      videoRef.current.play();
    }
  };

  // Handle pause
  const handlePause = () => {
    if (mode === "timeline" && timelineState) {
      timelineState.pause();
    } else if (videoRef.current) {
      videoRef.current.pause();
    }
  };

  // Handle stop (pause and seek to beginning)
  const handleStop = () => {
    if (mode === "timeline" && timelineState) {
      timelineState.pause();
      timelineState.setPlayheadPosition(0);
    } else if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
      setCurrentTime(0);
    }
  };

  // Handle scrubber change
  const handleScrubberChange = (e) => {
    const newTime = parseFloat(e.target.value);

    if (mode === "timeline" && timelineState) {
      timelineState.setPlayheadPosition(newTime);
    } else if (videoRef.current) {
      videoRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    }
  };

  // Handle scrubber drag start
  const handleScrubberMouseDown = () => {
    setIsSeeking(true);
  };

  // Handle scrubber drag end
  const handleScrubberMouseUp = () => {
    setIsSeeking(false);
  };

  // Get mode display text
  const getModeText = () => {
    if (mode === "recording") return "Recording";
    if (mode === "pip-recording") return "Recording (Screen + Webcam)";
    if (mode === "recording-preview") return "Ready to Record";
    if (mode === "webcam-recording") return "Webcam Recording";
    if (mode === "timeline") return "Timeline";
    return "Library";
  };

  return (
    <div className="video-preview-panel">
      <div className="panel-header">
        <h2>{panelLabel}</h2>
        {onCollapse && (
          <button
            className="collapse-button"
            onClick={onCollapse}
            aria-label="Hide panel"
            title="Hide panel"
          >
            ✕
          </button>
        )}
      </div>

      <div className="panel-content">
        <div className="video-player">
          <div className="video-container">
            {/* Hidden webcam video for composite preview */}
            {(mode === "pip-recording" || (mode === "recording-preview" && isPiPConfigured)) && webcamStream && (
              <video
                ref={webcamVideoRef}
                style={{ display: 'none' }}
                autoPlay
                playsInline
                muted
                onLoadedMetadata={() => console.log("[VideoPreview] Webcam video loaded for composite")}
              >
                Your browser does not support the video tag.
              </video>
            )}

            {mode === "webcam-recording" ? (
              <>
                <video
                  ref={webcamVideoRef}
                  className="video-element webcam-preview"
                  autoPlay
                  playsInline
                  muted
                >
                  Your browser does not support the video tag.
                </video>
                {webcamStream && webcamRecordingDuration > 0 && (
                  <>
                    <div className="recording-indicator-bottom-left">
                      <div className={isWebcamPaused ? "recording-dot-paused" : "recording-dot-pulse"}></div>
                    </div>
                    <div className="recording-timer-bottom-right">
                      {formatTime(webcamRecordingDuration)}
                    </div>
                  </>
                )}
              </>
            ) : compositeEnabled ? (
              <div className="live-preview-container">
                {/* Hidden screen preview canvas (used by composite) */}
                <canvas
                  ref={previewCanvasRef}
                  style={{ display: 'none' }}
                />
                {/* Composite preview canvas (screen + webcam overlay) */}
                <canvas
                  ref={compositeCanvasRef}
                  className="video-element preview-stream-canvas"
                />
                {mode === "pip-recording" && recordingState && (
                  <>
                    <div className="recording-indicator-bottom-left">
                      <div className="recording-dot-pulse"></div>
                    </div>
                    <div className="recording-timer-bottom-right">
                      {formatTime(recordingState.duration)}
                    </div>
                  </>
                )}
                {mode === "recording-preview" && !hasPreviewFrame && (
                  <div className="preview-status-badge">Preparing preview…</div>
                )}
                {previewIsRecording && (
                  <div className="preview-fps-pill">
                    {previewActualFps > 0 ? `${previewActualFps.toFixed(1)} FPS` : '-- FPS'}
                  </div>
                )}
              </div>
            ) : previewEnabled ? (
              <div className="live-preview-container">
                <canvas
                  ref={previewCanvasRef}
                  className="video-element preview-stream-canvas"
                />
                {!hasPreviewFrame && recordingState?.source?.thumbnail && (
                  <div className="preview-fallback-overlay">
                    <img
                      src={`data:image/png;base64,${recordingState.source.thumbnail}`}
                      alt="Preview"
                      className="preview-thumbnail-image"
                    />
                  </div>
                )}
                {mode === "recording" && recordingState && (
                  <>
                    <div className="recording-indicator-bottom-left">
                      <div className="recording-dot-pulse"></div>
                    </div>
                    <div className="recording-timer-bottom-right">
                      {formatTime(recordingState.duration)}
                    </div>
                  </>
                )}
                {mode === "recording-preview" && !hasPreviewFrame && (
                  <div className="preview-status-badge">Preparing preview…</div>
                )}
                {mode === "recording" && previewIsRecording && (
                  <div className="preview-fps-pill">
                    {previewActualFps > 0 ? `${previewActualFps.toFixed(1)} FPS` : '-- FPS'}
                  </div>
                )}
              </div>
            ) : showBlackScreen ? (
              <div className="black-screen"></div>
            ) : videoSrc ? (
              <video
                ref={videoRef}
                key={videoSrc}
                className="video-element"
                src={videoSrc}
                preload="metadata"
                playsInline
              >
                Your browser does not support the video tag.
              </video>
            ) : (
              <div className="preview-placeholder"></div>
            )}
          </div>

          {/* Hide scrubber in recording modes */}
          {mode !== "recording" && mode !== "webcam-recording" && mode !== "recording-preview" && mode !== "pip-recording" && (
            <div className="video-scrubber-container">
              <input
                type="range"
                className="video-scrubber minimalistic"
                min="0"
                max={mode === "timeline" && timelineState ? timelineState.getTotalDuration() : (duration || 0)}
                step="0.1"
                value={mode === "timeline" && timelineState ? timelineState.playheadPosition : currentTime}
                onChange={handleScrubberChange}
                onMouseDown={handleScrubberMouseDown}
                onMouseUp={handleScrubberMouseUp}
                onTouchStart={handleScrubberMouseDown}
                onTouchEnd={handleScrubberMouseUp}
                disabled={mode === "timeline" ? !timelineState : !videoSrc}
              />
              <div className="video-time-display">
                {mode === "timeline" && timelineState
                  ? `${formatTime(timelineState.playheadPosition)} / ${formatTime(timelineState.getTotalDuration())}`
                  : `${formatTime(currentTime)} / ${formatTime(duration)}`
                }
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default VideoPreviewPanel;
