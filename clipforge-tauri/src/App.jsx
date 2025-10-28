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

  // Handle drag end - when media is dropped on timeline
  const handleDragEnd = (event) => {
    const { active, over } = event;

    if (!over || over.id !== 'timeline-drop-zone') {
      return;
    }

    // Get the dragged media item data
    const mediaData = active.data.current;
    if (mediaData && mediaData.type === 'media-item') {
      console.log("Dropped media on timeline:", mediaData);
      timeline.addClip(mediaData);
    }
  };

  return (
    <DndContext onDragEnd={handleDragEnd}>
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
          mode="library"
        />
        <TimelineClipsPanel />
      </div>

      {/* Bottom section: Timeline */}
      <div className="bottom-timeline">
        <Timeline
          clips={timeline.clips}
          playheadPosition={timeline.playheadPosition}
          zoomLevel={timeline.zoomLevel}
          panOffset={timeline.panOffset}
          selectedClipId={timeline.selectedClipId}
          onClipSelect={timeline.setSelectedClipId}
          onPlayheadMove={timeline.setPlayheadPosition}
          onZoom={timeline.zoom}
          onPan={timeline.pan}
          onTrimUpdate={timeline.updateClipTrim}
        />
      </div>
    </div>
    </DndContext>
  );
}

export default App;
