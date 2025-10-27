import "./App.css";
import { useMemo } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import ImportPanel from "./components/ImportPanel";
import Timeline from "./components/Timeline";
import PreviewPlayer from "./components/PreviewPlayer";
import { useTimeline } from "./hooks/useTimeline";

function App() {
  const timeline = useTimeline();

  const handleImport = (videoMetadata) => {
    console.log("Adding videos to timeline:", videoMetadata);
    timeline.addClips(videoMetadata);
  };

  // Get the selected clip data
  const selectedClip = useMemo(() => {
    if (!timeline.selectedClipId) return null;
    return timeline.clips.find(clip => clip.id === timeline.selectedClipId);
  }, [timeline.selectedClipId, timeline.clips]);

  // Convert file path to Tauri asset URL
  const videoSrc = useMemo(() => {
    if (!selectedClip?.videoPath) return null;
    const assetUrl = convertFileSrc(selectedClip.videoPath);
    console.log("Video path:", selectedClip.videoPath);
    console.log("Asset URL:", assetUrl);
    return assetUrl;
  }, [selectedClip]);

  return (
    <main className="container">
      <h1>ClipForge</h1>
      <p className="subtitle">Video Editing Made Simple</p>
      <ImportPanel onImport={handleImport} />

      <div className="preview-section">
        <h2>Preview</h2>
        <PreviewPlayer
          videoSrc={videoSrc}
          onTimeUpdate={timeline.setPlayheadPosition}
          playheadPosition={timeline.playheadPosition}
          trimStart={selectedClip?.trimStart}
          trimEnd={selectedClip?.trimEnd}
          clipStartTime={selectedClip?.startTime}
        />
      </div>

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
          onTrimUpdate={timeline.updateClipTrim}
        />
      </div>
    </main>
  );
}

export default App;
