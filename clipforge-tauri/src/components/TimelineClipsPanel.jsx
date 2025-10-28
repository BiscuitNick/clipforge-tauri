import { useState, useMemo } from "react";
import "./TimelineClipsPanel.css";

/**
 * Timeline Clips Panel - Shows clips currently on timeline
 * Provides expandable details and trim point editors
 */
function TimelineClipsPanel({
  clips = [],
  selectedClipId,
  onClipSelect,
  onClipUpdate,
  onClipRemove
}) {
  const [expandedClipId, setExpandedClipId] = useState(null);
  const [editValues, setEditValues] = useState({});

  // Sort clips by position (startTime)
  const sortedClips = useMemo(() => {
    return [...clips].sort((a, b) => a.startTime - b.startTime);
  }, [clips]);

  // Format time in MM:SS format
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  // Toggle expansion for a clip
  const handleToggleExpand = (clipId) => {
    if (expandedClipId === clipId) {
      setExpandedClipId(null);
      setEditValues({});
    } else {
      const clip = clips.find(c => c.id === clipId);
      if (clip) {
        setExpandedClipId(clipId);
        // Initialize edit values
        setEditValues({
          trimStart: clip.trimStart || 0,
          trimEnd: clip.trimEnd || clip.duration,
          startTime: clip.startTime || 0
        });
      }
    }
  };

  // Handle input changes
  const handleInputChange = (field, value) => {
    setEditValues(prev => ({
      ...prev,
      [field]: parseFloat(value) || 0
    }));
  };

  // Apply edits to a clip
  const handleApplyEdits = (clipId) => {
    const clip = clips.find(c => c.id === clipId);
    if (!clip) return;

    // Validate trim points
    let trimStart = Math.max(0, Math.min(editValues.trimStart, clip.duration));
    let trimEnd = Math.max(trimStart, Math.min(editValues.trimEnd, clip.duration));
    let startTime = Math.max(0, editValues.startTime);

    // Ensure trimEnd > trimStart
    if (trimEnd <= trimStart) {
      trimEnd = Math.min(trimStart + 0.1, clip.duration);
    }

    // Update the clip
    onClipUpdate(clipId, {
      trimStart,
      trimEnd,
      startTime
    });

    // Collapse after applying
    setExpandedClipId(null);
    setEditValues({});
  };

  // Cancel editing
  const handleCancelEdits = () => {
    setExpandedClipId(null);
    setEditValues({});
  };

  if (sortedClips.length === 0) {
    return (
      <div className="timeline-clips-panel">
        <div className="panel-header">
          <h2>Timeline Clips</h2>
          <span className="clip-count">0 clips</span>
        </div>
        <div className="panel-content empty">
          <p className="empty-message">No clips on timeline</p>
          <p className="empty-hint">Drag media from the library to add clips</p>
        </div>
      </div>
    );
  }

  return (
    <div className="timeline-clips-panel">
      <div className="panel-header">
        <h2>Timeline Clips</h2>
        <span className="clip-count">{sortedClips.length} {sortedClips.length === 1 ? 'clip' : 'clips'}</span>
      </div>
      <div className="panel-content">
        <div className="clips-list">
          {sortedClips.map((clip, index) => {
            const isExpanded = expandedClipId === clip.id;
            const isSelected = selectedClipId === clip.id;
            const trimStart = clip.trimStart || 0;
            const trimEnd = clip.trimEnd || clip.duration;
            const clipDuration = trimEnd - trimStart;

            return (
              <div
                key={clip.id}
                className={`clip-item ${isExpanded ? 'expanded' : ''} ${isSelected ? 'selected' : ''}`}
              >
                <div
                  className="clip-header"
                  onClick={() => onClipSelect && onClipSelect(clip.id)}
                >
                  <div className="clip-info">
                    <span className="clip-number">#{index + 1}</span>
                    <span className="clip-filename" title={clip.filename}>
                      {clip.filename}
                    </span>
                  </div>
                  <div className="clip-meta">
                    <span className="clip-position">{formatTime(clip.startTime)}</span>
                    <button
                      className="expand-button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleExpand(clip.id);
                      }}
                      aria-label={isExpanded ? "Collapse" : "Expand"}
                    >
                      {isExpanded ? '▼' : '▶'}
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="clip-details">
                    <div className="detail-row">
                      <label>Position (s):</label>
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={editValues.startTime ?? clip.startTime}
                        onChange={(e) => handleInputChange('startTime', e.target.value)}
                      />
                    </div>
                    <div className="detail-row">
                      <label>In Point (s):</label>
                      <input
                        type="number"
                        min="0"
                        max={clip.duration}
                        step="0.1"
                        value={editValues.trimStart ?? trimStart}
                        onChange={(e) => handleInputChange('trimStart', e.target.value)}
                      />
                    </div>
                    <div className="detail-row">
                      <label>Out Point (s):</label>
                      <input
                        type="number"
                        min="0"
                        max={clip.duration}
                        step="0.1"
                        value={editValues.trimEnd ?? trimEnd}
                        onChange={(e) => handleInputChange('trimEnd', e.target.value)}
                      />
                    </div>
                    <div className="detail-row info">
                      <label>Duration:</label>
                      <span>{formatTime(clipDuration)}</span>
                    </div>
                    <div className="detail-row info">
                      <label>Source Duration:</label>
                      <span>{formatTime(clip.duration)}</span>
                    </div>
                    <div className="detail-actions">
                      <button
                        className="apply-button"
                        onClick={() => handleApplyEdits(clip.id)}
                      >
                        Apply
                      </button>
                      <button
                        className="cancel-button"
                        onClick={handleCancelEdits}
                      >
                        Cancel
                      </button>
                      <button
                        className="remove-button"
                        onClick={() => {
                          if (onClipRemove) {
                            onClipRemove(clip.id);
                            setExpandedClipId(null);
                            setEditValues({});
                          }
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default TimelineClipsPanel;
