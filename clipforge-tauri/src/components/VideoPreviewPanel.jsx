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

  // Handle timeline playback mode
  useEffect(() => {
    if (mode !== "timeline" || !timelineState || !videoRef.current) {
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
    if (mode !== "library") return;

    if (!selectedMedia || !videoRef.current) {
      setVideoSrc(null);
      setIsPlaying(false);
      setShowBlackScreen(false);
      return;
    }

    // Convert filepath to Tauri asset URL
    const assetUrl = convertFileSrc(selectedMedia.filepath);
    console.log("Loading video:", selectedMedia.filepath, "->", assetUrl);
    setVideoSrc(assetUrl);
    setIsPlaying(false);
    setShowBlackScreen(false);
  }, [selectedMedia, mode]);

  // Setup video event listeners
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedMetadata = () => {
      console.log("Video metadata loaded, duration:", video.duration);
      setDuration(video.duration);
      setCurrentTime(0);
      video.currentTime = 0;
      // Ensure video is paused on load
      video.pause();
      setIsPlaying(false);
    };

    const handleTimeUpdate = () => {
      if (!isSeeking) {
        setCurrentTime(video.currentTime);
      }
    };

    const handlePlay = () => {
      setIsPlaying(true);
    };

    const handlePause = () => {
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
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('ended', handleEnded);

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('ended', handleEnded);
    };
  }, [isSeeking, mode]);

  // Handle play/pause toggle
  const togglePlayPause = () => {
    if (!videoRef.current) return;

    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play();
    }
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
        {showBlackScreen ? (
          <div className="video-player">
            <div className="video-container black-screen">
              <div className="black-screen-message">Gap in Timeline</div>
            </div>
          </div>
        ) : videoSrc ? (
          <div className="video-player">
            <div className="video-container">
              <video
                ref={videoRef}
                className="video-element"
                src={videoSrc}
                preload="metadata"
                playsInline
              >
                Your browser does not support the video tag.
              </video>
            </div>

            <div className="video-controls">
              <button
                className="play-pause-button"
                onClick={togglePlayPause}
                aria-label={isPlaying ? "Pause" : "Play"}
              >
                {isPlaying ? (
                  // Pause icon
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                  </svg>
                ) : (
                  // Play icon
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>

              <div className="time-display">
                {formatTime(currentTime)} / {formatTime(duration)}
              </div>

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
              />
            </div>
          </div>
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
    </div>
  );
}

export default VideoPreviewPanel;
