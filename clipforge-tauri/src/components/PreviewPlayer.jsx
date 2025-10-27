import { useRef, useState, useEffect } from "react";
import "./PreviewPlayer.css";

function PreviewPlayer({ videoSrc, onTimeUpdate, playheadPosition }) {
  const videoRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isSeeking, setIsSeeking] = useState(false);
  const [isExternalSeek, setIsExternalSeek] = useState(false);

  // Debug: Log the videoSrc prop
  useEffect(() => {
    console.log("PreviewPlayer received videoSrc:", videoSrc);
    if (videoRef.current && videoSrc) {
      console.log("Video element src attribute:", videoRef.current.src);
    }
  }, [videoSrc]);

  // Handle play/pause toggle
  const togglePlayPause = () => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
    } else {
      video.play();
    }
    setIsPlaying(!isPlaying);
  };

  // Handle video time updates
  const handleTimeUpdate = () => {
    if (isSeeking || isExternalSeek) return; // Don't update during seeking

    const video = videoRef.current;
    if (!video) return;

    const time = video.currentTime;
    setCurrentTime(time);
    onTimeUpdate?.(time);
  };

  // Handle video metadata loaded
  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;

    setDuration(video.duration);
    setCurrentTime(0);
  };

  // Handle volume change
  const handleVolumeChange = (e) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);

    const video = videoRef.current;
    if (video) {
      video.volume = newVolume;
    }
  };

  // Handle progress bar seek
  const handleProgressSeek = (e) => {
    const video = videoRef.current;
    if (!video || !duration) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    const newTime = percentage * duration;

    setCurrentTime(newTime);
    video.currentTime = newTime;
    // Note: Don't call onTimeUpdate here as it would cause a feedback loop
  };

  // Handle progress bar drag
  const handleProgressMouseDown = (e) => {
    setIsSeeking(true);
    handleProgressSeek(e);
  };

  const handleProgressMouseMove = (e) => {
    if (!isSeeking) return;
    handleProgressSeek(e);
  };

  const handleProgressMouseUp = () => {
    setIsSeeking(false);
  };

  // Handle external playhead changes from timeline
  useEffect(() => {
    const video = videoRef.current;
    if (!video || playheadPosition === undefined || playheadPosition === null) return;

    // Check if the difference is significant enough to warrant a seek
    const timeDiff = Math.abs(video.currentTime - playheadPosition);

    // Only seek if difference is > 0.5 seconds (avoids feedback loops)
    if (timeDiff > 0.5) {
      setIsExternalSeek(true);
      video.currentTime = playheadPosition;
      setCurrentTime(playheadPosition);

      // Reset external seek flag after a brief delay
      setTimeout(() => {
        setIsExternalSeek(false);
      }, 100);
    }
  }, [playheadPosition]);

  // Reset when video source changes
  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);

    const video = videoRef.current;
    if (video) {
      video.pause();
    }
  }, [videoSrc]);

  // Format time as MM:SS
  const formatTime = (time) => {
    if (!time || isNaN(time)) return "0:00";
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Calculate progress percentage
  const progressPercentage = duration ? (currentTime / duration) * 100 : 0;

  return (
    <div className="preview-player">
      <div className="video-container">
        {videoSrc ? (
          <video
            ref={videoRef}
            src={videoSrc}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onEnded={() => setIsPlaying(false)}
            className="video-element"
          />
        ) : (
          <div className="no-video-placeholder">
            <p>Select a clip from the timeline to preview</p>
          </div>
        )}
      </div>

      <div className="controls">
        <button
          className="play-pause-btn"
          onClick={togglePlayPause}
          disabled={!videoSrc}
        >
          {isPlaying ? "⏸" : "▶"}
        </button>

        <span className="time-display">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        <div
          className="progress-bar"
          onMouseDown={handleProgressMouseDown}
          onMouseMove={handleProgressMouseMove}
          onMouseUp={handleProgressMouseUp}
          onMouseLeave={handleProgressMouseUp}
        >
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: `${progressPercentage}%` }}
            />
            <div
              className="progress-handle"
              style={{ left: `${progressPercentage}%` }}
            />
          </div>
        </div>

        <div className="volume-control">
          <span className="volume-icon">🔊</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={handleVolumeChange}
            className="volume-slider"
          />
        </div>
      </div>
    </div>
  );
}

export default PreviewPlayer;
