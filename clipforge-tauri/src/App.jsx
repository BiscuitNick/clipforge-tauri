import React from "react";
import "./App.css";
import MediaLibraryPanel from "./components/MediaLibraryPanel";
import VideoPreviewPanel from "./components/VideoPreviewPanel";
import TimelineClipsPanel from "./components/TimelineClipsPanel";
import Timeline from "./components/Timeline";
import { useTimeline } from "./hooks/useTimeline";
import { useMediaLibrary } from "./hooks/useMediaLibrary";
import { DndContext } from "@dnd-kit/core";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

function App() {
  const timeline = useTimeline();
  const mediaLibrary = useMediaLibrary();
  const [selectedMedia, setSelectedMedia] = React.useState(null);
  const [previewMode, setPreviewMode] = React.useState("library");
  const [dropTimePosition, setDropTimePosition] = React.useState(null);
  const [canDrop, setCanDrop] = React.useState(true);
  const [dragPreview, setDragPreview] = React.useState(null);
  const [isExporting, setIsExporting] = React.useState(false);
  const [exportProgress, setExportProgress] = React.useState(null);
  const [recordingState, setRecordingState] = React.useState(null);
  const [libraryPlaybackCommand, setLibraryPlaybackCommand] = React.useState(null); // 'play', 'pause', or 'stop'
  const [isLibraryPlaying, setIsLibraryPlaying] = React.useState(false); // Track library playback state
  const timelineRef = React.useRef(null);

  // Memoize timeline state to prevent unnecessary re-renders in VideoPreviewPanel
  const timelineState = React.useMemo(() => {
    if (previewMode !== "timeline") return null;
    return {
      playheadPosition: timeline.playheadPosition,
      getClipAtTime: timeline.getClipAtTime,
      isPlaying: timeline.isPlaying,
      getTotalDuration: timeline.getTotalDuration,
      setPlayheadPosition: timeline.setPlayheadPosition,
      play: timeline.play,
      pause: timeline.pause,
      togglePlayback: timeline.togglePlayback
    };
  }, [
    previewMode,
    timeline.playheadPosition,
    timeline.isPlaying,
    timeline.getClipAtTime,
    timeline.getTotalDuration,
    timeline.setPlayheadPosition,
    timeline.play,
    timeline.pause,
    timeline.togglePlayback
  ]);

  // Handle media import from Media Library Panel
  const handleMediaImport = (videoMetadataArray) => {
    console.log("App - Media imported:", videoMetadataArray);
    mediaLibrary.addMediaItems(videoMetadataArray);
  };

  // Handle media selection from Media Library
  const handleMediaSelect = (mediaItem) => {
    console.log("[App] Media selected:", mediaItem);
    console.log("[App] Setting previewMode to: library");
    setSelectedMedia(mediaItem);
    setPreviewMode("library");
    setIsLibraryPlaying(false); // Reset playback state when selecting new media
  };

  // Handle recording state changes (source selection, start, and complete)
  const handleRecordingStateChange = (state) => {
    console.log("[App] Recording state changed:", state);

    if (state.type === 'source-selected') {
      // User selected a screen/window - show live preview
      setRecordingState({
        type: 'preview',
        source: state.source,
        config: state.config
      });
      setPreviewMode("recording-preview");
      setSelectedMedia(null);
    } else if (state.isRecording) {
      // Recording just started - update to recording state but keep source info
      setRecordingState(prev => ({
        ...state,
        type: 'recording',
        // Preserve source info from preview state
        source: prev?.source,
        config: prev?.config
      }));
      setPreviewMode("recording");
      setSelectedMedia(null);
    } else if (state.file_path) {
      // Recording completed - import the video
      setRecordingState(null);
      setPreviewMode("library");
      invoke("import_video", { paths: [state.file_path] })
        .then((result) => {
          console.log("[App] Recording imported:", result);
          mediaLibrary.addMediaItems(result);
        })
        .catch((error) => {
          console.error("[App] Failed to import recording:", error);
        });
    }
  };

  // Handle stop recording
  const handleStopRecording = async () => {
    try {
      const result = await invoke('stop_recording');
      console.log("[App] Recording stopped:", result);
      handleRecordingStateChange(result);
    } catch (error) {
      console.error("[App] Failed to stop recording:", error);
    }
  };

  // Handle play/pause toggle from Media Library
  const handlePlayPauseMedia = () => {
    console.log("[App] Play/Pause media from library, current state:", isLibraryPlaying);
    if (isLibraryPlaying) {
      setLibraryPlaybackCommand('pause');
      setIsLibraryPlaying(false);
    } else {
      setLibraryPlaybackCommand('play');
      setIsLibraryPlaying(true);
    }
    setTimeout(() => setLibraryPlaybackCommand(null), 100); // Reset after command is processed
  };

  // Handle stop media from Media Library
  const handleStopMedia = () => {
    console.log("[App] Stop media from library");
    setLibraryPlaybackCommand('stop');
    setIsLibraryPlaying(false);
    setTimeout(() => setLibraryPlaybackCommand(null), 100); // Reset after command is processed
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

      // Get media data for duration
      const mediaData = active.data.current;
      if (mediaData && mediaData.duration) {
        // Calculate snap position
        const snapResult = timeline.calculateSnapPosition(validPosition, mediaData.duration);

        // Update drop position (use snapped position)
        setDropTimePosition(snapResult.position);

        // Always allow drop (clips will shift automatically)
        setCanDrop(true);

        // Update drag preview (always valid since we auto-shift)
        setDragPreview({
          position: snapResult.position,
          duration: mediaData.duration,
          isValid: true,
          snapType: snapResult.snapType,
          snapToClipId: snapResult.snapToClipId
        });
      }
    } else {
      // Clear preview when not over timeline
      setDragPreview(null);
    }
  };

  // Handle drag end - when media is dropped on timeline
  const handleDragEnd = (event) => {
    const { active, over } = event;

    if (!over || over.id !== 'timeline-drop-zone') {
      setDropTimePosition(null);
      setCanDrop(true);
      setDragPreview(null);
      return;
    }

    // Get the dragged media item data
    const mediaData = active.data.current;
    if (mediaData && mediaData.type === 'media-item') {
      console.log("Dropped media on timeline at position:", dropTimePosition);
      // Use insertClipWithShift to automatically handle overlaps
      timeline.insertClipWithShift(mediaData, dropTimePosition);

      setDropTimePosition(null);
      setCanDrop(true);
      setDragPreview(null);
    }
  };

  // Handle clip updates from Timeline Clips Panel
  const handleClipUpdate = (clipId, updates) => {
    // Update trim points if provided
    if (updates.trimStart !== undefined && updates.trimEnd !== undefined) {
      timeline.updateClipTrim(clipId, updates.trimStart, updates.trimEnd);
    }

    // Update position if provided - use moveClip to handle overlaps
    if (updates.startTime !== undefined) {
      timeline.moveClip(clipId, updates.startTime);
    }
  };

  // Handle export
  const handleExport = async () => {
    if (timeline.clips.length === 0) {
      alert("No clips to export");
      return;
    }

    try {
      // Show save dialog
      const filePath = await save({
        filters: [{
          name: 'Video',
          extensions: ['mp4']
        }],
        defaultPath: 'export.mp4'
      });

      if (!filePath) {
        // User cancelled
        return;
      }

      setIsExporting(true);
      setExportProgress({ current: 0, total: 1, message: 'Starting export...' });

      // Prepare clips data for export
      const clipsData = timeline.clips.map(clip => ({
        videoPath: clip.videoPath,
        startTime: clip.startTime,
        trimStart: clip.trimStart,
        trimEnd: clip.trimEnd,
        duration: clip.duration,
        width: clip.width,
        height: clip.height,
        frameRate: clip.frameRate
      }));

      // Call Rust export command
      await invoke('export_timeline', {
        clips: clipsData,
        outputPath: filePath
      });

      alert('Export completed successfully!');
    } catch (error) {
      console.error('Export failed:', error);
      alert(`Export failed: ${error}`);
    } finally {
      setIsExporting(false);
      setExportProgress(null);
    }
  };

  // Listen for export progress events
  React.useEffect(() => {
    const unlisten = listen('export-progress', (event) => {
      setExportProgress(event.payload);
    });

    return () => {
      unlisten.then(fn => fn());
    };
  }, []);

  // Listen for recording duration updates
  React.useEffect(() => {
    const unlisten = listen('recording:duration-update', (event) => {
      console.log("[App] Recording duration update:", event.payload);
      setRecordingState(event.payload);
    });

    return () => {
      unlisten.then(fn => fn());
    };
  }, []);

  // Keyboard shortcuts for undo/redo
  React.useEffect(() => {
    const handleKeyDown = (e) => {
      // Check for Cmd+Z (Mac) or Ctrl+Z (Windows/Linux)
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          // Redo: Cmd+Shift+Z or Ctrl+Shift+Z
          timeline.redo();
        } else {
          // Undo: Cmd+Z or Ctrl+Z
          timeline.undo();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [timeline.undo, timeline.redo]);

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
          onRecordingStateChange={handleRecordingStateChange}
          isRecording={recordingState?.type === 'recording'}
          onPlayPauseMedia={handlePlayPauseMedia}
          onStopMedia={handleStopMedia}
          isLibraryPlaying={isLibraryPlaying}
        />
        <VideoPreviewPanel
          selectedMedia={selectedMedia}
          mode={previewMode}
          timelineState={timelineState}
          recordingState={recordingState}
          onStopRecording={handleStopRecording}
          libraryPlaybackCommand={libraryPlaybackCommand}
        />
        <TimelineClipsPanel
          clips={timeline.clips}
          selectedClipId={timeline.selectedClipId}
          onClipSelect={timeline.setSelectedClipId}
          onClipUpdate={handleClipUpdate}
          onClipRemove={timeline.removeClip}
          onSnapLeft={timeline.snapLeft}
          onSnapRight={timeline.snapRight}
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
            // Don't allow timeline interaction during recording
            if (recordingState?.type === 'recording') return;
            setPreviewMode("timeline");
            setSelectedMedia(null);
            setIsLibraryPlaying(false); // Reset library playback state
            timeline.pause(); // Pause when manually moving playhead
            timeline.setPlayheadPosition(pos);
          }}
          onZoom={(delta) => {
            // Don't allow timeline interaction during recording
            if (recordingState?.type === 'recording') return;
            setPreviewMode("timeline");
            setSelectedMedia(null);
            setIsLibraryPlaying(false); // Reset library playback state
            timeline.zoom(delta);
          }}
          onPan={(delta) => {
            // Don't allow timeline interaction during recording
            if (recordingState?.type === 'recording') return;
            setPreviewMode("timeline");
            setSelectedMedia(null);
            setIsLibraryPlaying(false); // Reset library playback state
            timeline.pan(delta);
          }}
          onTrimUpdate={timeline.updateClipTrim}
          onMoveClip={timeline.moveClip}
          calculateSnapPosition={timeline.calculateSnapPosition}
          onUndo={timeline.undo}
          onRedo={timeline.redo}
          canUndo={timeline.canUndo}
          canRedo={timeline.canRedo}
          canDrop={canDrop}
          dragPreview={dragPreview}
          isPlaying={timeline.isPlaying}
          onTogglePlayback={() => {
            // Don't allow timeline playback during recording
            if (recordingState?.type === 'recording') return;
            setPreviewMode("timeline");
            setSelectedMedia(null);
            setIsLibraryPlaying(false); // Reset library playback state
            timeline.togglePlayback();
          }}
          onCopyClip={timeline.copyClip}
          onPasteClip={timeline.pasteClip}
          onDeleteClip={timeline.removeClip}
          hasClipboard={!!timeline.clipboardClip}
          onExport={handleExport}
          isExporting={isExporting}
        />
      </div>

      {/* Export Progress Overlay */}
      {isExporting && exportProgress && (
        <div className="export-overlay">
          <div className="export-modal">
            <h2>Exporting Timeline</h2>
            <div className="export-progress">
              <div
                className="export-progress-bar"
                style={{ width: `${(exportProgress.current / exportProgress.total) * 100}%` }}
              />
            </div>
            <p>{exportProgress.message}</p>
            <p className="export-step">
              Step {exportProgress.current} of {exportProgress.total}
            </p>
          </div>
        </div>
      )}
    </div>
    </DndContext>
  );
}

export default App;
