import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./ImportPanel.css";

function ImportPanel({ onImport }) {
  const [isDragging, setIsDragging] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState(""); // "success", "error", "loading"
  const [isLoading, setIsLoading] = useState(false);

  // Set up Tauri file drop event listeners
  useEffect(() => {
    const appWindow = getCurrentWindow();

    const dropHandler = appWindow.listen("tauri://drag-drop", (event) => {
      console.log("File drop event:", event);
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

      setMessage(`Successfully imported ${result.length} video file(s)!`);
      setMessageType("success");
      console.log("Import result:", result);

      // Call onImport callback with the imported video metadata
      if (onImport && result.length > 0) {
        onImport(result);
      }

      setTimeout(() => {
        setMessage("");
        setMessageType("");
      }, 3000);
    } catch (error) {
      console.error("Import error:", error);
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
    <div className="import-panel">
      <div
        className={`drop-zone ${isDragging ? "dragging" : ""}`}
      >
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
          <h2>Drop Video Files Here</h2>
          <p>Supports MP4 and MOV formats</p>
          <button
            className="import-button"
            onClick={handleImportClick}
            disabled={isLoading}
          >
            <svg
              className="button-icon"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            {isLoading ? 'Importing...' : 'Import Video'}
          </button>
        </div>
      </div>

      {message && (
        <div className={`message ${messageType}`}>
          {message}
        </div>
      )}
    </div>
  );
}

export default ImportPanel;
