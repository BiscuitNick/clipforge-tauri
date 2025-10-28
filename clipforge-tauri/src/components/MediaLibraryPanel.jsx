import "./MediaLibraryPanel.css";

/**
 * Media Library Panel - Staging area for imported media
 * Replaces direct import-to-timeline with drag-and-drop workflow
 */
function MediaLibraryPanel() {
  return (
    <div className="media-library-panel">
      <div className="panel-header">
        <h2>Media Library</h2>
      </div>
      <div className="panel-content">
        <p className="placeholder-text">Media Library Panel</p>
        <p className="placeholder-hint">Import/Stage media here</p>
      </div>
    </div>
  );
}

export default MediaLibraryPanel;
