import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useDraggable } from "@dnd-kit/core";
import ScreenRecordingModal from "./ScreenRecordingModal";
import "./MediaLibraryPanel.css";

/**
 * Format duration in seconds to MM:SS format
 */
function formatDuration(seconds) {
  if (!seconds || seconds === 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Draggable wrapper for media items
 */
function DraggableMediaItem({ item, isSelected, onSelect }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: item.id,
    data: {
      type: 'media-item',
      mediaId: item.id,
      filename: item.filename,
      filepath: item.filepath,
      duration: item.duration,
      width: item.width,
      height: item.height,
      frameRate: item.frameRate
    }
  });

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    opacity: isDragging ? 0.5 : 1,
  } : undefined;

  const handleClick = (e) => {
    console.log("[MediaLibraryPanel] Media item clicked:", item);
    // Stop event propagation to prevent drag handlers from interfering
    e.stopPropagation();
    if (onSelect) {
      onSelect(item);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`media-item ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`}
      {...attributes}
    >
      <div
        className="media-item-content"
        onClick={handleClick}
      >
        <div className="media-thumbnail" {...listeners}>
          <svg
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
        </div>
        <div className="media-info">
          <div className="media-title-row">
            <span className="media-filename" title={item.filename}>
              {item.filename}
            </span>
            {item.usedInTimeline && (
              <span className="usage-indicator" title="Used in timeline">
                ●
              </span>
            )}
          </div>
          <div className="media-metadata">
            <span className="media-duration">
              {formatDuration(item.duration)}
            </span>
            {item.width && item.height && (
              <span className="media-resolution">
                {item.width}×{item.height}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Media Library Panel - Staging area for imported media
 * Users import files here, which can then be added to the timeline multiple times
 */
function MediaLibraryPanel({ mediaItems = [], onMediaImport, onMediaSelect, selectedMediaId, onRecordingStateChange, isRecording, onPlayPauseMedia, onStopMedia, isLibraryPlaying = false }) {
  const [isDragging, setIsDragging] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState(""); // "success", "error", "loading"
  const [isLoading, setIsLoading] = useState(false);
  const [isRecordingModalOpen, setIsRecordingModalOpen] = useState(false);
  const [mode, setMode] = useState("media"); // "media", "record-screen", "record-video"
  const [selectedRecordingSource, setSelectedRecordingSource] = useState(null); // Stores selected screen/window and config
  const [isPaused, setIsPaused] = useState(false); // Track recording pause state

  // Set up Tauri file drop event listeners
  useEffect(() => {
    const appWindow = getCurrentWindow();

    const dropHandler = appWindow.listen("tauri://drag-drop", (event) => {
      console.log("Media Library - File drop event:", event);
      setIsDragging(false);

      if (event.payload && event.payload.paths) {
        handleFileImport(event.payload.paths);
      }
    });

    const dragEnterHandler = appWindow.listen("tauri://drag-enter", () => {
      setIsDragging(true);
    });

    const dragLeaveHandler = appWindow.listen("tauri://drag-leave", () => {
      setIsDragging(false);
    });

    const dragOverHandler = appWindow.listen("tauri://drag-over", () => {
      // Keep drag state active
    });

    return () => {
      dropHandler.then(unlisten => unlisten());
      dragEnterHandler.then(unlisten => unlisten());
      dragLeaveHandler.then(unlisten => unlisten());
      dragOverHandler.then(unlisten => unlisten());
    };
  }, []);

  const handleFileImport = async (filePaths) => {
    // Validate file extensions
    const validFiles = filePaths.filter(path => {
      const lower = path.toLowerCase();
      return lower.endsWith('.mp4') || lower.endsWith('.mov');
    });

    const invalidCount = filePaths.length - validFiles.length;

    if (invalidCount > 0) {
      setMessage(`Error: ${invalidCount} unsupported file(s). Only MP4 and MOV formats are supported.`);
      setMessageType("error");
      setTimeout(() => {
        setMessage("");
        setMessageType("");
      }, 5000);

      if (validFiles.length === 0) {
        return;
      }
    }

    await importVideos(validFiles);
  };

  // Shared import logic for both drag-drop and file picker
  const importVideos = async (filePaths) => {
    if (!filePaths || filePaths.length === 0) {
      return;
    }

    setIsLoading(true);
    setMessage(`Importing ${filePaths.length} file(s)...`);
    setMessageType("loading");

    try {
      const result = await invoke("import_video", { paths: filePaths });

      setMessage(`Successfully imported ${result.length} file(s) to Media Library!`);
      setMessageType("success");
      console.log("Media Library - Import result:", result);

      // Call onMediaImport callback with the imported video metadata
      if (onMediaImport && result.length > 0) {
        onMediaImport(result);
      }

      setTimeout(() => {
        setMessage("");
        setMessageType("");
      }, 3000);
    } catch (error) {
      console.error("Media Library - Import error:", error);
      setMessage(`Error importing files: ${error}`);
      setMessageType("error");

      setTimeout(() => {
        setMessage("");
        setMessageType("");
      }, 5000);
    } finally {
      setIsLoading(false);
    }
  };

  const handleImportClick = async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [{
          name: 'Video',
          extensions: ['mp4', 'mov']
        }],
        title: 'Select Video Files to Import'
      });

      if (selected) {
        // selected can be a single path (string) or array of paths
        const filePaths = Array.isArray(selected) ? selected : [selected];
        await importVideos(filePaths);
      }
    } catch (error) {
      console.error("File picker error:", error);
      setMessage(`Error opening file picker: ${error}`);
      setMessageType("error");

      setTimeout(() => {
        setMessage("");
        setMessageType("");
      }, 5000);
    }
  };

  // Handle source selection from modal
  const handleSourceSelect = (selection) => {
    console.log("[MediaLibraryPanel] Source selected:", selection);
    setSelectedRecordingSource(selection);

    // Notify parent to show live preview of selected source
    if (onRecordingStateChange) {
      onRecordingStateChange({
        type: 'source-selected',
        source: selection.source,
        config: selection.config
      });
    }
  };

  // Handle starting the recording
  const handleStartRecording = async () => {
    if (!selectedRecordingSource) {
      setMessage("Please select a screen or window first");
      setMessageType("error");
      setTimeout(() => {
        setMessage("");
        setMessageType("");
      }, 3000);
      return;
    }

    setIsLoading(true);
    setMessage("Starting recording...");
    setMessageType("loading");

    try {
      const result = await invoke('start_recording', {
        recordingType: 'screen',
        sourceId: selectedRecordingSource.source.id,
        config: selectedRecordingSource.config,
        includeAudio: selectedRecordingSource.includeAudio
      });

      console.log('[MediaLibraryPanel] Recording started:', result);

      // Notify parent about recording start
      if (onRecordingStateChange) {
        onRecordingStateChange({ ...result, isRecording: true });
      }

      setMessage("");
      setMessageType("");
    } catch (err) {
      console.error('[MediaLibraryPanel] Failed to start recording:', err);
      setMessage(`Failed to start recording: ${err}`);
      setMessageType("error");
      setTimeout(() => {
        setMessage("");
        setMessageType("");
      }, 5000);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle changing screen/window selection
  const handleChangeSource = () => {
    setIsRecordingModalOpen(true);
  };

  // Handle pause/resume recording
  const handlePauseResumeRecording = async () => {
    if (!isRecording) return;

    try {
      if (isPaused) {
        // Resume recording
        setIsLoading(true);
        setMessage("Resuming recording...");
        setMessageType("loading");

        const result = await invoke('resume_recording');
        console.log('[MediaLibraryPanel] Recording resumed:', result);
        setIsPaused(false);
        setMessage("");
        setMessageType("");
      } else {
        // Pause recording
        setIsLoading(true);
        setMessage("Pausing recording...");
        setMessageType("loading");

        const result = await invoke('pause_recording');
        console.log('[MediaLibraryPanel] Recording paused:', result);
        setIsPaused(true);
        setMessage("");
        setMessageType("");
      }
    } catch (err) {
      console.error('[MediaLibraryPanel] Failed to pause/resume recording:', err);
      setMessage(`Failed to ${isPaused ? 'resume' : 'pause'} recording: ${err}`);
      setMessageType("error");
      setTimeout(() => {
        setMessage("");
        setMessageType("");
      }, 5000);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle stop recording
  const handleStopRecording = async () => {
    if (!isRecording) return;

    try {
      setIsLoading(true);
      setMessage("Stopping recording and processing video...");
      setMessageType("loading");

      const result = await invoke('stop_recording');
      console.log('[MediaLibraryPanel] Recording stopped:', result);

      // Reset state
      setIsPaused(false);
      setSelectedRecordingSource(null);

      // Notify parent
      if (onRecordingStateChange) {
        onRecordingStateChange(result);
      }

      // Switch to media files view
      setMode("media");
      setMessage("Recording saved successfully!");
      setMessageType("success");

      setTimeout(() => {
        setMessage("");
        setMessageType("");
      }, 3000);
    } catch (err) {
      console.error('[MediaLibraryPanel] Failed to stop recording:', err);
      setMessage(`Failed to stop recording: ${err}`);
      setMessageType("error");
      setTimeout(() => {
        setMessage("");
        setMessageType("");
      }, 5000);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="media-library-panel">
      <div className="panel-header">
        <h2>Media Library</h2>
        <div className="header-controls">
          <select
            className="mode-selector"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            disabled={isRecording}
          >
            <option value="media">Media Files</option>
            <option value="record-screen">Record Screen</option>
            <option value="record-video">Record Video</option>
          </select>
          {mode === "media" && (
            <span className="media-count">{mediaItems.length} items</span>
          )}
        </div>
      </div>

      <div className="panel-content-scrollable">
        {mode === "media" && (
          <>
            {mediaItems.length === 0 ? (
              // Show drop zone when no media is imported
              <div className={`drop-zone ${isDragging ? "dragging" : ""}`}>
                <div className="drop-zone-content">
                  <svg
                    className="drop-zone-icon"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                    />
                  </svg>
                  <h3>Drop Media Here</h3>
                  <p>Supports MP4 and MOV</p>
                  <button
                    className="import-button"
                    onClick={handleImportClick}
                    disabled={isLoading}
                  >
                    {isLoading ? 'Importing...' : 'Browse Files'}
                  </button>
                </div>
              </div>
            ) : (
              // Show media list when items exist
              <div className="media-list">
                <div className="media-items">
                  {mediaItems.map((item) => (
                    <DraggableMediaItem
                      key={item.id}
                      item={item}
                      isSelected={selectedMediaId === item.id}
                      onSelect={onMediaSelect}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {mode === "record-screen" && (
          <div className="recording-mode-view">
            <div className="recording-mode-content">
              <svg
                className="recording-mode-icon"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
              <h3>Screen Recording</h3>

              {!selectedRecordingSource ? (
                <>
                  <p>Select a screen or window to record</p>
                  <button
                    className="record-button large"
                    onClick={() => setIsRecordingModalOpen(true)}
                    disabled={isLoading || isRecording}
                  >
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="20" height="20">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Select Screen/Window
                  </button>
                </>
              ) : (
                <>
                  <div className="selected-source-info">
                    <p className="source-name-display">{selectedRecordingSource.source.name}</p>
                    <p className="source-resolution-display">
                      {selectedRecordingSource.config.width} × {selectedRecordingSource.config.height}
                      {selectedRecordingSource.resolution !== 'native' && ` (${selectedRecordingSource.resolution})`}
                    </p>
                  </div>
                  <div className="recording-actions">
                    <button
                      className="record-button large primary"
                      onClick={handleStartRecording}
                      disabled={isLoading || isRecording}
                    >
                      <svg fill="currentColor" viewBox="0 0 20 20" width="20" height="20">
                        <circle cx="10" cy="10" r="6" />
                      </svg>
                      Start Recording
                    </button>
                    <button
                      className="change-source-button"
                      onClick={handleChangeSource}
                      disabled={isLoading || isRecording}
                    >
                      Change Source
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {mode === "record-video" && (
          <div className="recording-mode-view">
            <div className="recording-mode-content">
              <svg
                className="recording-mode-icon"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
              <h3>Webcam Recording</h3>
              <p>Coming soon...</p>
            </div>
          </div>
        )}

        {message && (
          <div className={`message ${messageType}`}>
            {message}
          </div>
        )}
      </div>

      {/* Video Controls - Context-based */}
      <div className="media-library-controls">
        {mode === "media" ? (
          // Media Files controls: Add Media button + Play/Stop for selected media
          <>
            {mediaItems.length > 0 && (
              <>
                <button
                  className="control-btn add-media-btn"
                  onClick={handleImportClick}
                  disabled={isLoading}
                  title="Add Media"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                    <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
                  </svg>
                </button>
                <div className="controls-separator" />
              </>
            )}
            <div className="media-library-controls-playback">
              <button
                className="control-btn stop-btn"
                onClick={onStopMedia}
                disabled={!selectedMediaId}
                title="Stop"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                  <path d="M6 6h12v12H6z" />
                </svg>
              </button>
              <button
                className={`control-btn ${isLibraryPlaying ? 'pause-btn' : 'play-btn'}`}
                onClick={onPlayPauseMedia}
                disabled={!selectedMediaId}
                title={isLibraryPlaying ? "Pause" : "Play"}
              >
                {isLibraryPlaying ? (
                  <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                    <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>
            </div>
          </>
        ) : mode === "record-screen" ? (
          // Record Screen controls: Record/Pause/Stop (centered)
          <div className="media-library-controls-playback">
            <button
              className="control-btn stop-btn"
              onClick={handleStopRecording}
              disabled={!isRecording}
              title="Stop Recording"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                <path d="M6 6h12v12H6z" />
              </svg>
            </button>
            <button
              className="control-btn record-btn"
              onClick={isRecording ? handlePauseResumeRecording : handleStartRecording}
              disabled={!selectedRecordingSource && !isRecording}
              title={isRecording ? (isPaused ? "Resume Recording" : "Pause Recording") : "Start Recording"}
            >
              {isRecording ? (
                isPaused ? (
                  <svg fill="currentColor" viewBox="0 0 20 20" width="18" height="18">
                    <circle cx="10" cy="10" r="6" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                    <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                  </svg>
                )
              ) : (
                <svg fill="currentColor" viewBox="0 0 20 20" width="18" height="18">
                  <circle cx="10" cy="10" r="6" />
                </svg>
              )}
            </button>
          </div>
        ) : null}
      </div>

      <ScreenRecordingModal
        isOpen={isRecordingModalOpen}
        onClose={() => setIsRecordingModalOpen(false)}
        onSourceSelect={handleSourceSelect}
      />
    </div>
  );
}

export default MediaLibraryPanel;
