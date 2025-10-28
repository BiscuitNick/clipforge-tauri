import "./App.css";
import MediaLibraryPanel from "./components/MediaLibraryPanel";
import VideoPreviewPanel from "./components/VideoPreviewPanel";
import TimelineClipsPanel from "./components/TimelineClipsPanel";
import Timeline from "./components/Timeline";
import { useTimeline } from "./hooks/useTimeline";
import { useMediaLibrary } from "./hooks/useMediaLibrary";

function App() {
  const timeline = useTimeline();
  const mediaLibrary = useMediaLibrary();

  // Handle media import from Media Library Panel
  const handleMediaImport = (videoMetadataArray) => {
    console.log("App - Media imported:", videoMetadataArray);
    mediaLibrary.addMediaItems(videoMetadataArray);
  };

  return (
    <div className="app-layout">
      {/* Top section: Three equal panels */}
      <div className="top-panels">
        <MediaLibraryPanel
          mediaItems={mediaLibrary.mediaItems}
          onMediaImport={handleMediaImport}
        />
        <VideoPreviewPanel />
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
  );
}

export default App;
