import { useRef, useState, useEffect, useCallback } from "react";
import "./PreviewPlayer.css";

function PreviewPlayer({ videoSrc, onTimeUpdate, playheadPosition, trimStart = 0, trimEnd, clipStartTime = 0, onClipEnd }) {
  const videoRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isSeeking, setIsSeeking] = useState(false);
  const [isExternalSeek, setIsExternalSeek] = useState(false);

  // Get effective trim points
  const effectiveTrimStart = trimStart || 0;
  const effectiveTrimEnd = trimEnd || duration;

  // Convert video time to timeline position
  const videoTimeToTimelinePosition = useCallback((videoTime) => {
    // Timeline position = clip start time + (video time - trim start)
    return clipStartTime + (videoTime - effectiveTrimStart);
  }, [clipStartTime, effectiveTrimStart]);

  // Debug: Log the videoSrc prop
  useEffect(() => {    if (videoRef.current && videoSrc) {    }
  }, [videoSrc]);

  // Handle play/pause toggle
  const togglePlayPause = () => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
    } else {
      // Before playing, ensure we're within the trimmed range
      if (video.currentTime < effectiveTrimStart || video.currentTime >= effectiveTrimEnd) {
        video.currentTime = effectiveTrimStart;
        setCurrentTime(effectiveTrimStart);
      }
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

    // If playing before trim start, jump to trim start
    if (time < effectiveTrimStart) {
      video.currentTime = effectiveTrimStart;
      setCurrentTime(effectiveTrimStart);
      onTimeUpdate?.(videoTimeToTimelinePosition(effectiveTrimStart));
      return;
    }

    // When we reach the trim end point, move to next clip or stop
    if (effectiveTrimEnd && time >= effectiveTrimEnd) {
      if (onClipEnd) {
        // Try to play the next clip
        onClipEnd();
      } else {
        // No next clip handler, just stop
        video.pause();
        video.currentTime = effectiveTrimEnd;
        setIsPlaying(false);
      }
      setCurrentTime(effectiveTrimEnd);
      onTimeUpdate?.(videoTimeToTimelinePosition(effectiveTrimEnd));
      return;
    }

    setCurrentTime(time);
    onTimeUpdate?.(videoTimeToTimelinePosition(time));
  };

  // Handle video metadata loaded
  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;

    setDuration(video.duration);
    // Start at trim start point
    const startTime = effectiveTrimStart || 0;
    video.currentTime = startTime;
    setCurrentTime(startTime);
    // Notify parent of initial position (in timeline coordinates)
    onTimeUpdate?.(videoTimeToTimelinePosition(startTime));
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
    const percentage = Math.max(0, Math.min(1, x / rect.width));

    // Map percentage to trimmed range
    const trimmedDuration = effectiveTrimEnd - effectiveTrimStart;
    const newTime = effectiveTrimStart + (percentage * trimmedDuration);

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

    // Convert timeline position to video time
    // video_time = trimStart + (timeline_position - clipStartTime)
    const videoTime = effectiveTrimStart + (playheadPosition - clipStartTime);

    // Clamp video time to trim range
    const clampedVideoTime = Math.max(effectiveTrimStart, Math.min(videoTime, effectiveTrimEnd));

    // Check if the difference is significant enough to warrant a seek
    const timeDiff = Math.abs(video.currentTime - clampedVideoTime);

    // Only seek if difference is > 0.5 seconds (avoids feedback loops)
    if (timeDiff > 0.5) {
      setIsExternalSeek(true);
      video.currentTime = clampedVideoTime;
      setCurrentTime(clampedVideoTime);

      // Reset external seek flag after a brief delay
      setTimeout(() => {
        setIsExternalSeek(false);
      }, 100);
    }
  }, [playheadPosition, effectiveTrimStart, effectiveTrimEnd, clipStartTime]);

  // Reset when video source or trim points change
  useEffect(() => {
    const wasPlaying = isPlaying;
    setIsPlaying(false);

    const video = videoRef.current;
    if (video) {
      video.pause();
      const startTime = effectiveTrimStart || 0;
      video.currentTime = startTime;
      setCurrentTime(startTime);
      // Notify parent of new position (in timeline coordinates)
      onTimeUpdate?.(videoTimeToTimelinePosition(startTime));

      // Auto-play if we were previously playing (for continuous playback)
      if (wasPlaying && videoSrc) {
        setTimeout(() => {
          video.play().then(() => {
            setIsPlaying(true);
          }).catch(err => {
            console.error("Auto-play failed:", err);
          });
        }, 100);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoSrc, trimStart, trimEnd, effectiveTrimStart, videoTimeToTimelinePosition]);

  // Format time as MM:SS
  const formatTime = (time) => {
    if (!time || isNaN(time)) return "0:00";
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Calculate progress percentage within trimmed range
  const trimmedDuration = effectiveTrimEnd - effectiveTrimStart;
  const trimmedCurrentTime = Math.max(0, currentTime - effectiveTrimStart);
  const progressPercentage = trimmedDuration ? (trimmedCurrentTime / trimmedDuration) * 100 : 0;

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
          {formatTime(trimmedCurrentTime)} / {formatTime(trimmedDuration)}
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
