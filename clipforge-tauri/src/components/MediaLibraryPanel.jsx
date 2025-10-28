import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useDraggable } from "@dnd-kit/core";
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`media-item ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`}
      onClick={() => onSelect && onSelect(item)}
      {...listeners}
      {...attributes}
    >
      <div className="media-thumbnail">
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
  );
}

/**
 * Media Library Panel - Staging area for imported media
 * Users import files here, which can then be added to the timeline multiple times
 */
function MediaLibraryPanel({ mediaItems = [], onMediaImport, onMediaSelect, selectedMediaId }) {
  const [isDragging, setIsDragging] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState(""); // "success", "error", "loading"
  const [isLoading, setIsLoading] = useState(false);

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

  return (
    <div className="media-library-panel">
      <div className="panel-header">
        <h2>Media Library</h2>
        <span className="media-count">{mediaItems.length} items</span>
      </div>

      <div className="panel-content">
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
            <button
              className="import-button compact"
              onClick={handleImportClick}
              disabled={isLoading}
            >
              + Add Media
            </button>
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

        {message && (
          <div className={`message ${messageType}`}>
            {message}
          </div>
        )}
      </div>
    </div>
  );
}

export default MediaLibraryPanel;
