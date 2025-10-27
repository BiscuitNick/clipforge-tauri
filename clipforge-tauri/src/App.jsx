import "./App.css";
import ImportPanel from "./components/ImportPanel";
import Timeline from "./components/Timeline";
import { useTimeline } from "./hooks/useTimeline";

function App() {
  const timeline = useTimeline();

  const handleImport = (videoMetadata) => {
    console.log("Adding videos to timeline:", videoMetadata);
    timeline.addClips(videoMetadata);
  };

  return (
    <main className="container">
      <h1>ClipForge</h1>
      <p className="subtitle">Video Editing Made Simple</p>
      <ImportPanel onImport={handleImport} />

      <div className="timeline-section">
        <h2>Timeline</h2>
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
        />
      </div>
    </main>
  );
}

export default App;
