import { useRef, useState, useEffect } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import "./VideoPreviewPanel.css";
import usePreviewStream from "../hooks/usePreviewStream";

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
 */
function VideoPreviewPanel({ selectedMedia, mode = "library", timelineState = null, recordingState = null, onStopRecording, libraryPlaybackCommand = null, webcamStream = null, webcamRecordingDuration = 0, isWebcamPaused = false, panelLabel = "Video Preview", onCollapse = null }) {
  const videoRef = useRef(null);
  const webcamVideoRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const [videoSrc, setVideoSrc] = useState(null);
  const [showBlackScreen, setShowBlackScreen] = useState(false);
  const [currentClipId, setCurrentClipId] = useState(null); // Track currently loaded clip
  const previewEnabled = mode === "recording" || mode === "recording-preview";
  const {
    canvasRef: previewCanvasRef,
    hasFrame: hasPreviewFrame,
    actualFps: previewActualFps,
    isRecording: previewIsRecording,
  } = usePreviewStream(previewEnabled);

  // Debug: Log props changes
  useEffect(() => {
    console.log("[VideoPreview] Props changed:", {
      mode,
      selectedMedia: selectedMedia ? {
        id: selectedMedia.id,
        filename: selectedMedia.filename,
        filepath: selectedMedia.filepath
      } : null,
      hasTimelineState: !!timelineState
    });
  }, [selectedMedia, mode, timelineState]);

  // Debug: Log videoSrc changes
  useEffect(() => {
    console.log("[VideoPreview] videoSrc changed to:", videoSrc);
  }, [videoSrc]);

  // Handle webcam stream changes
  useEffect(() => {
    if (mode !== "webcam-recording") {
      // Clear webcam stream when not in webcam recording mode
      if (webcamVideoRef.current) {
        webcamVideoRef.current.srcObject = null;
      }
      return;
    }

    const video = webcamVideoRef.current;
    if (!video) return;

    if (webcamStream) {
      console.log("[VideoPreview] Setting webcam stream");
      video.srcObject = webcamStream;
      video.play().catch(err => console.error("[VideoPreview] Webcam play failed:", err));
    } else {
      console.log("[VideoPreview] Clearing webcam stream");
      video.srcObject = null;
    }
  }, [webcamStream, mode]);

  // Handle library playback commands (from Media Library controls)
  useEffect(() => {
    if (!libraryPlaybackCommand || mode !== "library") return;

    const video = videoRef.current;
    if (!video) return;

    if (libraryPlaybackCommand === 'play') {
      console.log("[VideoPreview] Library command: Play");
      video.play().catch(err => console.error("[VideoPreview] Play failed:", err));
    } else if (libraryPlaybackCommand === 'pause') {
      console.log("[VideoPreview] Library command: Pause");
      video.pause();
    } else if (libraryPlaybackCommand === 'stop') {
      console.log("[VideoPreview] Library command: Stop");
      video.pause();
      video.currentTime = 0;
      setCurrentTime(0);
    }
  }, [libraryPlaybackCommand, mode]);

  // Handle timeline playback mode
  useEffect(() => {
    if (mode !== "timeline" || !timelineState) {
      console.log("[VideoPreview] Timeline mode check failed - mode:", mode, "hasTimelineState:", !!timelineState);
      setCurrentClipId(null);
      return;
    }

    const { playheadPosition, getClipAtTime, isPlaying: timelinePlaying } = timelineState;
    const activeClipData = getClipAtTime(playheadPosition);
    console.log("[VideoPreview] Timeline - playhead at", playheadPosition, "activeClip:", activeClipData);

    if (!activeClipData) {
      // In a gap - show black screen
      console.log("[VideoPreview] Timeline - No clip at playhead, showing black screen");
      setShowBlackScreen(true);
      setVideoSrc(null);
      setCurrentClipId(null);
      if (videoRef.current) {
        videoRef.current.pause();
      }
      return;
    }

    const { clip, sourceTime } = activeClipData;
    console.log("[VideoPreview] Timeline - Found clip:", {
      filename: clip.filename,
      videoPath: clip.videoPath,
      sourceTime,
      duration: clip.duration
    });
    setShowBlackScreen(false);

    // Load the clip's video if not already loaded
    const assetUrl = convertFileSrc(clip.videoPath);
    const isClipChange = currentClipId !== clip.id;

    console.log("[VideoPreview] Timeline - Current clip:", currentClipId, "New clip:", clip.id, "Changed:", isClipChange);

    if (isClipChange) {
      console.log("[VideoPreview] Timeline - Loading new clip:", clip.filename);
      setVideoSrc(assetUrl);
      setCurrentClipId(clip.id);

      // Set duration from clip
      if (clip.duration) {
        setDuration(clip.duration);
      }

      // When video loads, seek to correct position
      const video = videoRef.current;
      if (video) {
        const handleCanPlayTimeline = () => {
          console.log("[VideoPreview] Timeline - Video ready, seeking to:", sourceTime);
          video.currentTime = sourceTime;
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
        if (timelinePlaying && video.paused) {
          console.log("[VideoPreview] Timeline - Starting playback");
          video.play().catch(err => console.error("[VideoPreview] Play failed:", err));
        } else if (!timelinePlaying && !video.paused) {
          console.log("[VideoPreview] Timeline - Pausing playback");
          video.pause();
        }
      }
    }
  }, [mode, timelineState, currentClipId]);

  // Load video when selectedMedia changes (library mode)
  useEffect(() => {
    console.log("[VideoPreview] useEffect triggered - mode:", mode, "selectedMedia:", selectedMedia);

    if (mode !== "library") {
      console.log("[VideoPreview] Not in library mode, skipping");
      return;
    }

    // Clear clip tracking when in library mode
    setCurrentClipId(null);

    if (!selectedMedia) {
      console.log("[VideoPreview] No selectedMedia, clearing video");
      setVideoSrc(null);
      setDuration(0);
      setCurrentTime(0);
      setIsPlaying(false);
      setShowBlackScreen(false);
      return;
    }

    // Convert filepath to Tauri asset URL
    const assetUrl = convertFileSrc(selectedMedia.filepath);
    console.log("[VideoPreview] Loading video:", selectedMedia.filepath, "->", assetUrl);

    // Set duration from media metadata (FFprobe) immediately
    if (selectedMedia.duration) {
      console.log("[VideoPreview] Setting duration from selectedMedia:", selectedMedia.duration);
      setDuration(selectedMedia.duration);
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
      console.log("[VideoPreview] Video metadata loaded");
      console.log("[VideoPreview] Duration:", video.duration);
      console.log("[VideoPreview] ReadyState:", video.readyState);
      console.log("[VideoPreview] VideoWidth:", video.videoWidth);
      console.log("[VideoPreview] VideoHeight:", video.videoHeight);

      if (video.duration && !isNaN(video.duration) && isFinite(video.duration)) {
        setDuration(video.duration);
        console.log("[VideoPreview] Duration set to:", video.duration);
      } else {
        console.warn("[VideoPreview] Invalid duration:", video.duration);
      }

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

    const handleLoadStart = () => {
      console.log("[VideoPreview] Video load started, src:", video.src);
    };

    const handleCanPlay = () => {
      console.log("[VideoPreview] Video can play");
      // Sometimes duration is only available after canplay
      if (video.duration && !isNaN(video.duration) && isFinite(video.duration)) {
        if (duration === 0) {
          console.log("[VideoPreview] Setting duration from canplay:", video.duration);
          setDuration(video.duration);
        }
      }
    };

    const handleDurationChange = () => {
      console.log("[VideoPreview] Duration changed:", video.duration);
      if (video.duration && !isNaN(video.duration) && isFinite(video.duration)) {
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
          {mode !== "recording" && mode !== "webcam-recording" && mode !== "recording-preview" && (
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
