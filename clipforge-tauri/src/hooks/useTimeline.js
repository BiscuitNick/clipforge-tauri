import { useState, useCallback } from "react";

/**
 * Custom hook for managing timeline state
 * Handles clips, playhead position, zoom level, and pan offset
 */
export function useTimeline() {
  const [clips, setClips] = useState([]);
  const [playheadPosition, setPlayheadPosition] = useState(0); // in seconds
  const [zoomLevel, setZoomLevel] = useState(1); // pixels per second
  const [panOffset, setPanOffset] = useState(0); // horizontal pan in pixels
  const [selectedClipId, setSelectedClipId] = useState(null);
  const [isPanning, setIsPanning] = useState(false);

  // Check if a position would cause collision with existing clips
  const canDropAtPosition = useCallback((position, duration, excludeClipId = null) => {
    const endPosition = position + duration;

    for (const clip of clips) {
      // Skip the clip being moved (for repositioning)
      if (clip.id === excludeClipId) continue;

      const clipStart = clip.startTime;
      const clipTrimStart = clip.trimStart || 0;
      const clipTrimEnd = clip.trimEnd || clip.duration;
      const clipDuration = clipTrimEnd - clipTrimStart;
      const clipEnd = clipStart + clipDuration;

      // Check for overlap
      const overlaps = (position < clipEnd) && (endPosition > clipStart);
      if (overlaps) {
        return false; // Collision detected
      }
    }

    return true; // No collision
  }, [clips]);

  // Add a single clip from drag-and-drop
  const addClip = useCallback((mediaData, targetPosition = null) => {
    // Calculate start position
    let startTime;
    if (targetPosition !== null && targetPosition !== undefined) {
      // Use the provided position (absolute positioning)
      startTime = Math.max(0, targetPosition);

      // Check for collision before adding
      if (!canDropAtPosition(startTime, mediaData.duration)) {
        console.warn("Cannot drop clip at position", startTime, "- collision detected");
        return null; // Don't add the clip
      }
    } else {
      // Default: append to end
      startTime = clips.length > 0
        ? Math.max(...clips.map(c => {
            const trimStart = c.trimStart || 0;
            const trimEnd = c.trimEnd || c.duration;
            const trimmedDuration = trimEnd - trimStart;
            return c.startTime + trimmedDuration;
          }))
        : 0;
    }

    const newClip = {
      id: `clip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      mediaId: mediaData.mediaId,
      videoPath: mediaData.filepath,
      filename: mediaData.filename,
      duration: mediaData.duration,
      width: mediaData.width,
      height: mediaData.height,
      frameRate: mediaData.frameRate,
      startTime: startTime,
      trimStart: 0, // inPoint defaults to 0
      trimEnd: mediaData.duration, // outPoint defaults to full duration
    };

    setClips(prev => [...prev, newClip]);
    return newClip;
  }, [clips, canDropAtPosition]);

  // Add clips from imported videos
  const addClips = useCallback((videoMetadata) => {
    const newClips = videoMetadata.map((video, index) => ({
      id: `clip-${Date.now()}-${index}`,
      videoPath: video.path,
      filename: video.filename,
      duration: video.duration,
      width: video.width,
      height: video.height,
      frameRate: video.frame_rate,
      startTime: clips.length > 0
        ? Math.max(...clips.map(c => {
            const trimStart = c.trimStart || 0;
            const trimEnd = c.trimEnd || c.duration;
            const trimmedDuration = trimEnd - trimStart;
            return c.startTime + trimmedDuration;
          }))
        : 0,
      trimStart: 0,
      trimEnd: video.duration,
    }));

    setClips(prev => [...prev, ...newClips]);
    return newClips;
  }, [clips]);

  // Remove a clip by ID
  const removeClip = useCallback((clipId) => {
    setClips(prev => prev.filter(c => c.id !== clipId));
    if (selectedClipId === clipId) {
      setSelectedClipId(null);
    }
  }, [selectedClipId]);

  // Update clip position
  const updateClipPosition = useCallback((clipId, newStartTime) => {
    setClips(prev => prev.map(clip =>
      clip.id === clipId
        ? { ...clip, startTime: Math.max(0, newStartTime) }
        : clip
    ));
  }, []);

  // Update clip trim points
  const updateClipTrim = useCallback((clipId, trimStart, trimEnd) => {
    setClips(prev => prev.map(clip => {
      if (clip.id !== clipId) return clip;

      // Ensure trim points are within valid range
      const validTrimStart = Math.max(0, Math.min(trimStart, clip.duration));
      const validTrimEnd = Math.max(validTrimStart, Math.min(trimEnd, clip.duration));

      return {
        ...clip,
        trimStart: validTrimStart,
        trimEnd: validTrimEnd,
      };
    }));
  }, []);

  // Handle zoom
  const zoom = useCallback((delta, mouseX) => {
    setZoomLevel(prev => {
      const newZoom = Math.max(0.1, Math.min(10, prev + delta));

      // Adjust pan to zoom towards mouse position
      if (mouseX !== undefined) {
        const timeAtMouse = (mouseX + panOffset) / prev;
        const newMouseX = timeAtMouse * newZoom;
        setPanOffset(prev => prev + (mouseX - newMouseX + panOffset));
      }

      return newZoom;
    });
  }, [panOffset]);

  // Handle pan
  const pan = useCallback((deltaX) => {
    setPanOffset(prev => Math.max(0, prev + deltaX));
  }, []);

  // Get total timeline duration
  const getTotalDuration = useCallback(() => {
    if (clips.length === 0) return 60; // Default 60 seconds for empty timeline
    return Math.max(...clips.map(c => c.startTime + c.duration), 60);
  }, [clips]);

  // Convert time to pixel position
  const timeToPixel = useCallback((time) => {
    return time * zoomLevel - panOffset;
  }, [zoomLevel, panOffset]);

  // Convert pixel position to time
  const pixelToTime = useCallback((pixel) => {
    return (pixel + panOffset) / zoomLevel;
  }, [zoomLevel, panOffset]);

  return {
    // State
    clips,
    playheadPosition,
    zoomLevel,
    panOffset,
    selectedClipId,
    isPanning,

    // Setters
    setPlayheadPosition,
    setSelectedClipId,
    setIsPanning,

    // Actions
    addClip,
    addClips,
    removeClip,
    updateClipPosition,
    updateClipTrim,
    zoom,
    pan,

    // Validation
    canDropAtPosition,

    // Computed
    getTotalDuration,
    timeToPixel,
    pixelToTime,
  };
}
