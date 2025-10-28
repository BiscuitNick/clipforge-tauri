import { useRef, useState, useEffect } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import "./VideoPreviewPanel.css";

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
 * Supports two modes:
 * - library: Preview a single media item from the library
 * - timeline: Play back the timeline with clips and gaps
 */
function VideoPreviewPanel({ selectedMedia, mode = "library", timelineState = null }) {
  const videoRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const [videoSrc, setVideoSrc] = useState(null);
  const [showBlackScreen, setShowBlackScreen] = useState(false);

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

  // Handle timeline playback mode
  useEffect(() => {
    if (mode !== "timeline" || !timelineState) {
      return;
    }

    const { playheadPosition, getClipAtTime, isPlaying: timelinePlaying } = timelineState;
    const activeClipData = getClipAtTime(playheadPosition);

    if (!activeClipData) {
      // In a gap - show black screen
      setShowBlackScreen(true);
      setVideoSrc(null);
      if (videoRef.current) {
        videoRef.current.pause();
      }
      return;
    }

    const { clip, sourceTime } = activeClipData;
    setShowBlackScreen(false);

    // Load the clip's video if not already loaded
    const assetUrl = convertFileSrc(clip.videoPath);
    if (videoSrc !== assetUrl) {
      console.log("Timeline - Loading clip:", clip.filename);
      setVideoSrc(assetUrl);
    }

    // Sync video time with timeline
    if (videoRef.current && videoRef.current.readyState >= 2) {
      const videoTime = videoRef.current.currentTime;
      const timeDiff = Math.abs(videoTime - sourceTime);

      // Only seek if significantly out of sync (> 0.1s)
      if (timeDiff > 0.1) {
        videoRef.current.currentTime = sourceTime;
      }

      // Sync play/pause state
      if (timelinePlaying && videoRef.current.paused) {
        videoRef.current.play();
      } else if (!timelinePlaying && !videoRef.current.paused) {
        videoRef.current.pause();
      }
    }
  }, [mode, timelineState, videoSrc]);

  // Load video when selectedMedia changes (library mode)
  useEffect(() => {
    console.log("[VideoPreview] useEffect triggered - mode:", mode, "selectedMedia:", selectedMedia);

    if (mode !== "library") {
      console.log("[VideoPreview] Not in library mode, skipping");
      return;
    }

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
    if (!videoRef.current) return;
    videoRef.current.play();
  };

  // Handle pause
  const handlePause = () => {
    if (!videoRef.current) return;
    videoRef.current.pause();
  };

  // Handle stop (pause and seek to beginning)
  const handleStop = () => {
    if (!videoRef.current) return;
    videoRef.current.pause();
    videoRef.current.currentTime = 0;
    setCurrentTime(0);
  };

  // Handle scrubber change
  const handleScrubberChange = (e) => {
    if (!videoRef.current) return;
    const newTime = parseFloat(e.target.value);
    videoRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  // Handle scrubber drag start
  const handleScrubberMouseDown = () => {
    setIsSeeking(true);
  };

  // Handle scrubber drag end
  const handleScrubberMouseUp = () => {
    setIsSeeking(false);
  };

  return (
    <div className="video-preview-panel">
      <div className="panel-header">
        <h2>Video Preview</h2>
        <span className="preview-mode-indicator">{mode === "library" ? "Library" : "Timeline"}</span>
      </div>

      <div className="panel-content">
        <div className="video-player">
          <div className="video-container">
            {showBlackScreen ? (
              <div className="black-screen">
                <div className="black-screen-message">Gap in Timeline</div>
              </div>
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
              <div className="preview-placeholder">
                <svg
                  className="placeholder-icon"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
                <p className="placeholder-text">Select media to preview</p>
                <p className="placeholder-hint">Click a media item in the library</p>
              </div>
            )}
          </div>

          <div className="timeline-scrubber">
            <input
              type="range"
              className="scrubber"
              min="0"
              max={duration || 0}
              step="0.1"
              value={currentTime}
              onChange={handleScrubberChange}
              onMouseDown={handleScrubberMouseDown}
              onMouseUp={handleScrubberMouseUp}
              onTouchStart={handleScrubberMouseDown}
              onTouchEnd={handleScrubberMouseUp}
              disabled={!videoSrc}
            />
          </div>

          <div className="video-controls">
            <button
              className="play-pause-btn"
              onClick={handleStop}
              disabled={!videoSrc}
              title="Stop"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                <path d="M6 6h12v12H6z" />
              </svg>
            </button>

            <button
              className={`play-pause-btn ${isPlaying ? 'playing' : ''}`}
              onClick={isPlaying ? handlePause : handlePlay}
              disabled={!videoSrc}
              title={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? (
                <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                  <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>

            <div className="time-display">
              {formatTime(currentTime)} / {formatTime(duration)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default VideoPreviewPanel;
