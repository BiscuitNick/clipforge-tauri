import { useState, useCallback, useRef, useEffect } from "react";

/**
 * Custom hook for managing timeline state
 * Handles clips, playhead position, zoom level, and pan offset
 */
export function useTimeline() {
  const [clips, setClips] = useState([]);
  const [playheadPosition, setPlayheadPosition] = useState(0); // in seconds
  const [zoomLevel, setZoomLevel] = useState(10); // pixels per second (10px = 1s at zoom 1.0)
  const [panOffset, setPanOffset] = useState(0); // horizontal pan in pixels
  const [selectedClipId, setSelectedClipId] = useState(null);
  const [isPanning, setIsPanning] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [clipboardClip, setClipboardClip] = useState(null); // Clipboard for copy/paste
  const animationFrameRef = useRef(null);
  const lastTimeRef = useRef(null);

  // Undo/Redo history management
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const MAX_HISTORY = 50;

  // Save current state to history before mutations
  const saveHistory = useCallback(() => {
    // Create a deep copy of the current clips state
    const currentState = JSON.parse(JSON.stringify(clips));

    // Truncate history after current index (removes redo history)
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(currentState);

    // Limit history size
    if (newHistory.length > MAX_HISTORY) {
      newHistory.shift();
      setHistory(newHistory);
      // Don't increment index since we removed the oldest entry
    } else {
      setHistory(newHistory);
      setHistoryIndex(prev => prev + 1);
    }
  }, [clips, history, historyIndex, MAX_HISTORY]);

  // Undo to previous state
  const undo = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setClips(JSON.parse(JSON.stringify(history[newIndex])));
    }
  }, [history, historyIndex]);

  // Redo to next state
  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setClips(JSON.parse(JSON.stringify(history[newIndex])));
    }
  }, [history, historyIndex]);

  // Check if undo/redo available
  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

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

  // Calculate snap position for seamless clip placement
  const calculateSnapPosition = useCallback((targetPosition, duration, excludeClipId = null) => {
    const SNAP_THRESHOLD = 2.0; // seconds
    let snappedPosition = targetPosition;
    let snapType = null; // 'start', 'end', or null
    let snapToClipId = null;

    // Check all existing clips for snap opportunities
    for (const clip of clips) {
      if (clip.id === excludeClipId) continue;

      const clipStart = clip.startTime;
      const clipTrimStart = clip.trimStart || 0;
      const clipTrimEnd = clip.trimEnd || clip.duration;
      const clipDuration = clipTrimEnd - clipTrimStart;
      const clipEnd = clipStart + clipDuration;

      // Snap to end of clip (seamless continuation)
      if (Math.abs(targetPosition - clipEnd) < SNAP_THRESHOLD) {
        snappedPosition = clipEnd;
        snapType = 'end';
        snapToClipId = clip.id;
        break;
      }

      // Snap to start of clip (place before)
      const newClipEnd = targetPosition + duration;
      if (Math.abs(clipStart - newClipEnd) < SNAP_THRESHOLD) {
        snappedPosition = clipStart - duration;
        snapType = 'start';
        snapToClipId = clip.id;
        break;
      }
    }

    // Ensure position doesn't go negative
    snappedPosition = Math.max(0, snappedPosition);

    return { position: snappedPosition, snapType, snapToClipId };
  }, [clips]);

  // Add a single clip from drag-and-drop
  const addClip = useCallback((mediaData, targetPosition = null) => {
    // Calculate start position
    let startTime;

    // If this is the first clip on the timeline, always start at 0
    if (clips.length === 0) {
      startTime = 0;
    } else if (targetPosition !== null && targetPosition !== undefined) {
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

    // Save history before mutation
    saveHistory();

    setClips(prev => [...prev, newClip]);
    return newClip;
  }, [clips, canDropAtPosition, saveHistory]);

  // Insert clip with automatic shifting of overlapping clips
  const insertClipWithShift = useCallback((mediaData, targetPosition) => {
    // If this is the first clip, use regular addClip
    if (clips.length === 0) {
      return addClip(mediaData, targetPosition);
    }

    // Save history before mutation
    saveHistory();

    // Calculate the new clip's duration
    const duration = mediaData.duration;
    const insertEnd = targetPosition + duration;

    // Sort clips by start time
    const sortedClips = [...clips].sort((a, b) => a.startTime - b.startTime);

    // Find first clip that actually overlaps with the new clip
    const firstConflictIndex = sortedClips.findIndex(clip => {
      const clipTrimStart = clip.trimStart || 0;
      const clipTrimEnd = clip.trimEnd || clip.duration;
      const clipDuration = clipTrimEnd - clipTrimStart;
      const clipEnd = clip.startTime + clipDuration;

      // Check for actual overlap: clip ends after new clip starts AND clip starts before new clip ends
      return clipEnd > targetPosition && clip.startTime < insertEnd;
    });

    if (firstConflictIndex !== -1) {
      const firstConflict = sortedClips[firstConflictIndex];
      const shiftAmount = insertEnd - firstConflict.startTime;

      // Shift all clips from conflict point onward
      const updatedClips = sortedClips.map((clip, idx) => {
        if (idx >= firstConflictIndex) {
          return { ...clip, startTime: clip.startTime + shiftAmount };
        }
        return clip;
      });

      // Create the new clip
      const newClip = {
        id: `clip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        mediaId: mediaData.mediaId,
        videoPath: mediaData.filepath,
        filename: mediaData.filename,
        duration: mediaData.duration,
        width: mediaData.width,
        height: mediaData.height,
        frameRate: mediaData.frameRate,
        startTime: targetPosition,
        trimStart: 0,
        trimEnd: mediaData.duration,
      };

      // Add new clip and sort
      const finalClips = [...updatedClips, newClip].sort((a, b) => a.startTime - b.startTime);
      setClips(finalClips);
      return newClip;
    } else {
      // No conflicts, just add the clip normally
      const newClip = {
        id: `clip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        mediaId: mediaData.mediaId,
        videoPath: mediaData.filepath,
        filename: mediaData.filename,
        duration: mediaData.duration,
        width: mediaData.width,
        height: mediaData.height,
        frameRate: mediaData.frameRate,
        startTime: targetPosition,
        trimStart: 0,
        trimEnd: mediaData.duration,
      };

      const finalClips = [...clips, newClip].sort((a, b) => a.startTime - b.startTime);
      setClips(finalClips);
      return newClip;
    }
  }, [clips, saveHistory, addClip]);

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

    // Save history before mutation
    saveHistory();

    setClips(prev => [...prev, ...newClips]);
    return newClips;
  }, [clips, saveHistory]);

  // Remove a clip by ID
  const removeClip = useCallback((clipId) => {
    // Save history before mutation
    saveHistory();

    setClips(prev => prev.filter(c => c.id !== clipId));
    if (selectedClipId === clipId) {
      setSelectedClipId(null);
    }
  }, [selectedClipId, saveHistory]);

  // Update clip position
  const updateClipPosition = useCallback((clipId, newStartTime) => {
    // Save history before mutation
    saveHistory();

    setClips(prev => prev.map(clip =>
      clip.id === clipId
        ? { ...clip, startTime: Math.max(0, newStartTime) }
        : clip
    ));
  }, [saveHistory]);

  // Move clip to new position (for drag-and-drop reordering)
  const moveClip = useCallback((clipId, newPosition) => {
    // Save history before mutation
    saveHistory();

    // Find the clip being moved
    const movingClip = clips.find(c => c.id === clipId);
    if (!movingClip) return;

    // Calculate the moving clip's duration
    const trimStart = movingClip.trimStart || 0;
    const trimEnd = movingClip.trimEnd || movingClip.duration;
    const duration = trimEnd - trimStart;
    const insertEnd = newPosition + duration;

    // Sort all OTHER clips by start time (exclude the clip being moved)
    const otherClips = clips.filter(c => c.id !== clipId).sort((a, b) => a.startTime - b.startTime);

    // Find first clip that overlaps with the new position
    const firstConflictIndex = otherClips.findIndex(clip => {
      const clipTrimStart = clip.trimStart || 0;
      const clipTrimEnd = clip.trimEnd || clip.duration;
      const clipDuration = clipTrimEnd - clipTrimStart;
      const clipEnd = clip.startTime + clipDuration;

      // Check for actual overlap: clip ends after new position starts AND clip starts before new position ends
      return clipEnd > newPosition && clip.startTime < insertEnd;
    });

    let updatedClips;
    if (firstConflictIndex !== -1) {
      // There's an overlap - shift clips to make room
      const firstConflict = otherClips[firstConflictIndex];
      const shiftAmount = insertEnd - firstConflict.startTime;

      // Shift all clips from conflict point onward
      updatedClips = otherClips.map((clip, idx) => {
        if (idx >= firstConflictIndex) {
          return { ...clip, startTime: clip.startTime + shiftAmount };
        }
        return clip;
      });
    } else {
      // No overlap - keep other clips as they are
      updatedClips = otherClips;
    }

    // Add the moved clip at its new position
    const movedClip = { ...movingClip, startTime: Math.max(0, newPosition) };
    updatedClips.push(movedClip);

    // Sort clips by start time for visual consistency
    updatedClips.sort((a, b) => a.startTime - b.startTime);
    setClips(updatedClips);
  }, [clips, saveHistory]);

  // Snap clip to the left (snap to nearest previous clip's end)
  const snapLeft = useCallback((clipId) => {
    const clip = clips.find(c => c.id === clipId);
    if (!clip) return;

    const clipStart = clip.startTime;

    // Find the nearest clip that ends before this clip starts
    let nearestClipEnd = 0;
    for (const otherClip of clips) {
      if (otherClip.id === clipId) continue;

      const otherTrimStart = otherClip.trimStart || 0;
      const otherTrimEnd = otherClip.trimEnd || otherClip.duration;
      const otherDuration = otherTrimEnd - otherTrimStart;
      const otherEnd = otherClip.startTime + otherDuration;

      // Find clips that end before current clip starts
      if (otherEnd <= clipStart && otherEnd > nearestClipEnd) {
        nearestClipEnd = otherEnd;
      }
    }

    // Move clip to snap to the nearest clip's end
    moveClip(clipId, nearestClipEnd);
  }, [clips, moveClip]);

  // Snap clip to the right (snap to nearest next clip's start)
  const snapRight = useCallback((clipId) => {
    const clip = clips.find(c => c.id === clipId);
    if (!clip) return;

    const trimStart = clip.trimStart || 0;
    const trimEnd = clip.trimEnd || clip.duration;
    const duration = trimEnd - trimStart;
    const clipEnd = clip.startTime + duration;

    // Find the nearest clip that starts after this clip ends
    let nearestClipStart = Infinity;
    for (const otherClip of clips) {
      if (otherClip.id === clipId) continue;

      const otherStart = otherClip.startTime;

      // Find clips that start after current clip ends
      if (otherStart >= clipEnd && otherStart < nearestClipStart) {
        nearestClipStart = otherStart;
      }
    }

    // If we found a clip to snap to, move current clip so it ends at that clip's start
    if (nearestClipStart !== Infinity) {
      const newPosition = nearestClipStart - duration;
      moveClip(clipId, newPosition);
    }
  }, [clips, moveClip]);

  // Update clip trim points
  const updateClipTrim = useCallback((clipId, trimStart, trimEnd) => {
    // Save history before mutation
    saveHistory();

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
  }, [saveHistory]);

  // Handle zoom
  const zoom = useCallback((delta, mouseX) => {
    setZoomLevel(prev => {
      // Min: 1 (0.1x), Max: 100 (10.0x), delta is in 0.5x increments (5 pixels/sec)
      const newZoom = Math.max(1, Math.min(100, prev + (delta * 10)));

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

  // Find the active clip at a given time position
  const getClipAtTime = useCallback((time) => {
    for (const clip of clips) {
      const clipStart = clip.startTime;
      const trimStart = clip.trimStart || 0;
      const trimEnd = clip.trimEnd || clip.duration;
      const trimmedDuration = trimEnd - trimStart;
      const clipEnd = clipStart + trimmedDuration;

      if (time >= clipStart && time < clipEnd) {
        // Calculate the source media time accounting for trim
        const offsetInClip = time - clipStart;
        const sourceTime = trimStart + offsetInClip;
        return { clip, sourceTime };
      }
    }
    return null; // Gap or outside timeline
  }, [clips]);

  // Playback loop using requestAnimationFrame
  useEffect(() => {
    if (!isPlaying) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      lastTimeRef.current = null;
      return;
    }

    const animate = (timestamp) => {
      if (!lastTimeRef.current) {
        lastTimeRef.current = timestamp;
      }

      const deltaTime = (timestamp - lastTimeRef.current) / 1000; // Convert to seconds
      lastTimeRef.current = timestamp;

      setPlayheadPosition(prev => {
        const newPosition = prev + deltaTime;

        // Get total timeline duration
        const totalDuration = clips.length > 0
          ? Math.max(...clips.map(c => {
              const trimStart = c.trimStart || 0;
              const trimEnd = c.trimEnd || c.duration;
              const trimmedDuration = trimEnd - trimStart;
              return c.startTime + trimmedDuration;
            }))
          : 0;

        // Stop at end of timeline
        if (newPosition >= totalDuration) {
          setIsPlaying(false);
          return totalDuration;
        }

        return newPosition;
      });

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying, clips]);

  // Toggle play/pause
  const togglePlayback = useCallback(() => {
    setIsPlaying(prev => !prev);
  }, []);

  // Play
  const play = useCallback(() => {
    setIsPlaying(true);
  }, []);

  // Pause
  const pause = useCallback(() => {
    setIsPlaying(false);
  }, []);

  // Copy selected clip to clipboard
  const copyClip = useCallback(() => {
    if (!selectedClipId) {
      console.warn("No clip selected to copy");
      return false;
    }

    const clipToCopy = clips.find(c => c.id === selectedClipId);
    if (!clipToCopy) {
      console.warn("Selected clip not found");
      return false;
    }

    // Store clip data without the unique ID
    const { id, ...clipData } = clipToCopy;
    setClipboardClip(clipData);
    console.log("Clip copied to clipboard:", clipData.filename);
    return true;
  }, [selectedClipId, clips]);

  // Paste clip from clipboard
  const pasteClip = useCallback(() => {
    if (!clipboardClip) {
      console.warn("No clip in clipboard to paste");
      return null;
    }

    // Calculate position to append at end of timeline
    const endPosition = clips.length > 0
      ? Math.max(...clips.map(c => {
          const trimStart = c.trimStart || 0;
          const trimEnd = c.trimEnd || c.duration;
          const trimmedDuration = trimEnd - trimStart;
          return c.startTime + trimmedDuration;
        }))
      : 0;

    // Create new clip with unique ID and clipboard data
    const newClip = {
      ...clipboardClip,
      id: `clip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      startTime: endPosition,
    };

    // Save history before mutation
    saveHistory();

    setClips(prev => [...prev, newClip]);
    console.log("Clip pasted at position:", endPosition);
    return newClip;
  }, [clipboardClip, clips, saveHistory]);

  // Split clip at specified time
  const splitClip = useCallback((clipId, splitTime) => {
    const clip = clips.find(c => c.id === clipId);
    if (!clip) {
      console.warn("Clip not found:", clipId);
      return null;
    }

    // Calculate the clip's effective duration
    const trimStart = clip.trimStart || 0;
    const trimEnd = clip.trimEnd || clip.duration;
    const clipDuration = trimEnd - trimStart;
    const clipEnd = clip.startTime + clipDuration;

    // Validate split position
    if (splitTime <= clip.startTime || splitTime >= clipEnd) {
      console.warn("Split position must be within clip boundaries");
      return null;
    }

    // Prevent splits that would create clips shorter than 1 frame
    const MIN_CLIP_DURATION = 1 / (clip.frameRate || 30); // At least 1 frame
    const leftDuration = splitTime - clip.startTime;
    const rightDuration = clipEnd - splitTime;

    if (leftDuration < MIN_CLIP_DURATION || rightDuration < MIN_CLIP_DURATION) {
      console.warn("Split would create clips shorter than minimum duration");
      return null;
    }

    // Calculate split point in source media time
    const splitOffsetInClip = splitTime - clip.startTime;
    const splitPointInSource = trimStart + splitOffsetInClip;

    // Create two new clips from the original
    const leftClip = {
      ...clip,
      id: `clip-${Date.now()}-left-${Math.random().toString(36).substr(2, 9)}`,
      trimEnd: splitPointInSource,
      // startTime stays the same
    };

    const rightClip = {
      ...clip,
      id: `clip-${Date.now()}-right-${Math.random().toString(36).substr(2, 9)}`,
      startTime: splitTime,
      trimStart: splitPointInSource,
      // trimEnd stays the same
    };

    // Save history before mutation
    saveHistory();

    // Replace the original clip with the two new clips
    setClips(prev => {
      const otherClips = prev.filter(c => c.id !== clipId);
      return [...otherClips, leftClip, rightClip].sort((a, b) => a.startTime - b.startTime);
    });

    // If the split clip was selected, select the left part
    if (selectedClipId === clipId) {
      setSelectedClipId(leftClip.id);
    }

    console.log(`Split clip at ${splitTime}s`, { leftClip, rightClip });
    return { leftClip, rightClip };
  }, [clips, selectedClipId, saveHistory]);

  return {
    // State
    clips,
    playheadPosition,
    zoomLevel,
    panOffset,
    selectedClipId,
    isPanning,
    isPlaying,
    clipboardClip,

    // Setters
    setPlayheadPosition,
    setSelectedClipId,
    setIsPanning,

    // Actions
    addClip,
    addClips,
    insertClipWithShift,
    removeClip,
    updateClipPosition,
    moveClip,
    snapLeft,
    snapRight,
    updateClipTrim,
    zoom,
    pan,

    // Clipboard
    copyClip,
    pasteClip,

    // Split
    splitClip,

    // Undo/Redo
    undo,
    redo,
    canUndo,
    canRedo,

    // Playback
    togglePlayback,
    play,
    pause,
    getClipAtTime,

    // Validation
    canDropAtPosition,
    calculateSnapPosition,

    // Computed
    getTotalDuration,
    timeToPixel,
    pixelToTime,
  };
}
