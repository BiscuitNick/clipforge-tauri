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

  const handleExport = async () => {
    if (timeline.clips.length === 0) {
      alert("No clips to export");
      return;
    }

    try {
      // Import the invoke function
      const { invoke } = await import("@tauri-apps/api/core");
      const { save } = await import("@tauri-apps/plugin-dialog");

      // Show save dialog
      const savePath = await save({
        defaultPath: "export.mp4",
        filters: [{
          name: "Video",
          extensions: ["mp4"]
        }]
      });

      if (!savePath) return; // User cancelled

      // Prepare clips data for export
      const clipsData = timeline.clips.map(clip => ({
        videoPath: clip.videoPath,
        startTime: clip.startTime,
        trimStart: clip.trimStart || 0,
        trimEnd: clip.trimEnd || clip.duration,
        duration: clip.duration
      }));

      console.log("Exporting clips:", clipsData);
      console.log("Output path:", savePath);

      // Call the export command
      await invoke("export_timeline", {
        clips: clipsData,
        outputPath: savePath
      });

      alert("Export completed successfully!");
    } catch (error) {
      console.error("Export failed:", error);
      alert(`Export failed: ${error}`);
    }
  };

  // Get the selected clip data
  const selectedClip = useMemo(() => {
    if (!timeline.selectedClipId) return null;
    return timeline.clips.find(clip => clip.id === timeline.selectedClipId);
  }, [timeline.selectedClipId, timeline.clips]);

  // Handle clip end - automatically play next clip
  const handleClipEnd = () => {
    if (!selectedClip) return;

    // Find the current clip index
    const currentIndex = timeline.clips.findIndex(c => c.id === selectedClip.id);

    // Check if there's a next clip
    if (currentIndex >= 0 && currentIndex < timeline.clips.length - 1) {
      const nextClip = timeline.clips[currentIndex + 1];
      timeline.setSelectedClipId(nextClip.id);
      // The PreviewPlayer will automatically start playing the new clip
    }
  };

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
          onClipEnd={handleClipEnd}
        />
      </div>

      <div className="timeline-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h2 style={{ margin: 0 }}>Timeline</h2>
          <button
            onClick={handleExport}
            disabled={timeline.clips.length === 0}
            style={{
              padding: '8px 16px',
              fontSize: '14px',
              fontWeight: 'bold',
              backgroundColor: timeline.clips.length === 0 ? '#666' : '#4CAF50',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: timeline.clips.length === 0 ? 'not-allowed' : 'pointer'
            }}
          >
            Export Video
          </button>
        </div>
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
