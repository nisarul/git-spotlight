# Changelog

All notable changes to Git Spotlight will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-01-19

### Added
- **Highlight by Author**: Color-code lines by author with unique, consistent colors
- **Highlight by Commit**: Color-code lines by commit with unique colors
- **Highlight Specific Author**: Select and highlight only one author's changes
- **Highlight Specific Commit**: Select and highlight only one commit's changes
- New color generator utility for consistent, visually distinct colors
- Quick pick menus to select authors and commits from the file
- Configuration for color saturation, lightness, and opacity
- `selectedHighlightColor` setting for specific author/commit highlighting

### Changed
- **Renamed extension** from "Git Age Highlighter" to "Git Spotlight"
- Configuration section changed from `gitAgeHighlighter` to `gitSpotlight`
- Command prefix changed from `gitAgeHighlighter` to `gitSpotlight`
- `highlightColor` setting renamed to `ageHighlightColor`
- Status bar now shows current mode with appropriate icon
- Improved decorator architecture for multi-mode support

### Fixed
- Better handling of dynamic decorations for author/commit modes
- Improved cleanup when switching between modes

## [1.0.0] - 2026-01-19

### Added
- Initial release as "Git Age Highlighter"
- Toggle command to enable/disable highlighting
- Configurable duration (days, weeks, months, years, or ISO date)
- Highlight recently modified lines with configurable background color
- Highlight uncommitted lines with different style (red underline)
- Status bar item showing current state
- Hover information showing author, date, and commit
- Performance optimizations:
  - Debounced git blame execution
  - Blame result caching by (file, HEAD)
  - File size limit to skip large files
  - Binary file detection
- Auto-refresh on:
  - Active editor change
  - File save
  - Git HEAD change (branch switch, pull)
- Multi-root workspace support
- Graceful error handling

### Security
- Uses `child_process.execFile` to prevent shell injection
- Git commands have configurable timeout
