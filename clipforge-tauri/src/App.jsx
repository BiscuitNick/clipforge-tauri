import "./App.css";
import MediaLibraryPanel from "./components/MediaLibraryPanel";
import VideoPreviewPanel from "./components/VideoPreviewPanel";
import TimelineClipsPanel from "./components/TimelineClipsPanel";
import Timeline from "./components/Timeline";
import { useTimeline } from "./hooks/useTimeline";

function App() {
  const timeline = useTimeline();

  return (
    <div className="app-layout">
      {/* Top section: Three equal panels */}
      <div className="top-panels">
        <MediaLibraryPanel />
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
