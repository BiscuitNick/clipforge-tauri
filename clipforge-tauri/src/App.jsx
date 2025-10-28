import React from "react";
import "./App.css";
import MediaLibraryPanel from "./components/MediaLibraryPanel";
import VideoPreviewPanel from "./components/VideoPreviewPanel";
import TimelineClipsPanel from "./components/TimelineClipsPanel";
import Timeline from "./components/Timeline";
import { useTimeline } from "./hooks/useTimeline";
import { useMediaLibrary } from "./hooks/useMediaLibrary";
import { DndContext } from "@dnd-kit/core";

function App() {
  const timeline = useTimeline();
  const mediaLibrary = useMediaLibrary();
  const [selectedMedia, setSelectedMedia] = React.useState(null);
  const [dropTimePosition, setDropTimePosition] = React.useState(null);
  const [canDrop, setCanDrop] = React.useState(true);
  const timelineRef = React.useRef(null);

  // Handle media import from Media Library Panel
  const handleMediaImport = (videoMetadataArray) => {
    console.log("App - Media imported:", videoMetadataArray);
    mediaLibrary.addMediaItems(videoMetadataArray);
  };

  // Handle media selection from Media Library
  const handleMediaSelect = (mediaItem) => {
    console.log("App - Media selected:", mediaItem);
    setSelectedMedia(mediaItem);
  };

  // Handle drag move - track position for drop calculation
  const handleDragMove = (event) => {
    const { over, delta, active } = event;

    if (over && over.id === 'timeline-drop-zone' && timelineRef.current) {
      // Get timeline bounds
      const rect = timelineRef.current.getBoundingClientRect();

      // Calculate current mouse position from initial position + delta
      const initialX = active.rect?.current?.initial?.left || 0;
      const currentX = initialX + delta.x;
      const relativeX = currentX - rect.left;

      // Calculate time position using timeline's conversion utilities
      const timePosition = timeline.pixelToTime(relativeX);
      const validPosition = Math.max(0, timePosition);
      setDropTimePosition(validPosition);

      // Check for collision
      const mediaData = active.data.current;
      if (mediaData && mediaData.duration) {
        const canDropHere = timeline.canDropAtPosition(validPosition, mediaData.duration);
        setCanDrop(canDropHere);
      }
    }
  };

  // Handle drag end - when media is dropped on timeline
  const handleDragEnd = (event) => {
    const { active, over } = event;

    if (!over || over.id !== 'timeline-drop-zone') {
      setDropTimePosition(null);
      setCanDrop(true);
      return;
    }

    // Get the dragged media item data
    const mediaData = active.data.current;
    if (mediaData && mediaData.type === 'media-item') {
      // Only add if position is valid
      if (canDrop) {
        console.log("Dropped media on timeline at position:", dropTimePosition);
        timeline.addClip(mediaData, dropTimePosition);
      } else {
        console.warn("Cannot drop clip - position is occupied");
      }

      setDropTimePosition(null);
      setCanDrop(true);
    }
  };

  // Handle clip updates from Timeline Clips Panel
  const handleClipUpdate = (clipId, updates) => {
    // Update trim points if provided
    if (updates.trimStart !== undefined && updates.trimEnd !== undefined) {
      timeline.updateClipTrim(clipId, updates.trimStart, updates.trimEnd);
    }

    // Update position if provided
    if (updates.startTime !== undefined) {
      timeline.updateClipPosition(clipId, updates.startTime);
    }
  };

  return (
    <DndContext onDragMove={handleDragMove} onDragEnd={handleDragEnd}>
      <div className="app-layout">
      {/* Top section: Three equal panels */}
      <div className="top-panels">
        <MediaLibraryPanel
          mediaItems={mediaLibrary.mediaItems}
          onMediaImport={handleMediaImport}
          onMediaSelect={handleMediaSelect}
          selectedMediaId={selectedMedia?.id}
        />
        <VideoPreviewPanel
          selectedMedia={selectedMedia}
          mode={timeline.clips.length > 0 ? "timeline" : "library"}
          timelineState={timeline.clips.length > 0 ? {
            playheadPosition: timeline.playheadPosition,
            getClipAtTime: timeline.getClipAtTime,
            isPlaying: timeline.isPlaying
          } : null}
        />
        <TimelineClipsPanel
          clips={timeline.clips}
          selectedClipId={timeline.selectedClipId}
          onClipSelect={timeline.setSelectedClipId}
          onClipUpdate={handleClipUpdate}
          onClipRemove={timeline.removeClip}
        />
      </div>

      {/* Bottom section: Timeline */}
      <div className="bottom-timeline" ref={timelineRef}>
        <Timeline
          clips={timeline.clips}
          playheadPosition={timeline.playheadPosition}
          zoomLevel={timeline.zoomLevel}
          panOffset={timeline.panOffset}
          selectedClipId={timeline.selectedClipId}
          onClipSelect={timeline.setSelectedClipId}
          onPlayheadMove={(pos) => {
            timeline.pause(); // Pause when manually moving playhead
            timeline.setPlayheadPosition(pos);
          }}
          onZoom={timeline.zoom}
          onPan={timeline.pan}
          onTrimUpdate={timeline.updateClipTrim}
          canDrop={canDrop}
          isPlaying={timeline.isPlaying}
          onTogglePlayback={timeline.togglePlayback}
          onCopyClip={timeline.copyClip}
          onPasteClip={timeline.pasteClip}
          onDeleteClip={timeline.removeClip}
          hasClipboard={!!timeline.clipboardClip}
        />
      </div>
    </div>
    </DndContext>
  );
}

export default App;
