# dailynotes.dev

Your daily work notes, organized & synced. Minimalist workspace for tracking daily progress. Works offline, syncs to Google Drive, organized by projects.

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL%20v3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Go Version](https://img.shields.io/badge/Go-1.24+-00ADD8?logo=go)](https://go.dev/)

**[dailynotes.dev](https://dailynotes.dev)** • [Documentation](DEVELOPMENT.md) • [Report Bug](https://github.com/gmoqa/daily-notes/issues)

---

## Features

- **Offline-first with automatic sync** - Work without internet, sync when ready
- **Notes stored in your Google Drive** - Markdown format, full control over your data
- **Context-based organization** - Organize by projects, clients, or any context
- **Auto-save** - Your notes save automatically after 500ms of inactivity
- **Dark/light mode** - Comfortable viewing in any lighting condition
- **Calendar view** - Navigate your notes by date
- **Markdown support** - Rich WYSIWYG editor with markdown syntax
- **Timezone support** - Configure your preferred timezone for accurate timestamps
- **Customizable date format** - Choose between DD-MM-YY or MM-DD-YY formats
- **Week start preference** - Set calendar to start on any day of the week
- **Customizable UI** - Toggle breadcrumb navigation, markdown toolbar, and more

## Quick Start

Visit **[dailynotes.dev](https://dailynotes.dev)** and sign in with your Google account.

### Self-Host

```bash
git clone https://github.com/gmoqa/daily-notes.git
cd daily-notes

# Set required environment variables
export GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
export GOOGLE_CLIENT_SECRET="your-client-secret"

# Run with Docker
docker-compose up -d

# Or run locally with Go
# 1. Install dependencies
npm install
go mod download

# 2. Build frontend
npm run build

# 3. Generate Go templates
go install github.com/a-h/templ/cmd/templ@latest
templ generate

# 4. Run the application
go run main.go
```

See [DEVELOPMENT.md](DEVELOPMENT.md) for complete setup instructions.

## Tech Stack

- **Backend**: Go 1.24 + Fiber
- **Templates**: Templ (type-safe Go templates)
- **Frontend**: TypeScript + Vite
- **Editor**: Quill (WYSIWYG markdown editor)
- **Storage**: Google Drive API (Markdown files)
- **Local Storage**: SQLite + IndexedDB
- **Auth**: Google OAuth 2.0
- **Styling**: Bulma CSS
- **PWA**: Service Worker for offline support
- **Build Tool**: Vite with legacy browser support

## Data Storage

Notes are stored in your Google Drive as Markdown files. You have full control - view, edit, export, or delete them anytime.

```
Google Drive/
└── dailynotes.dev/
    ├── config.json
    ├── Project-A/
    │   ├── 2025-01-15.md
    │   ├── 2025-01-16.md
    │   └── 2025-01-17.md
    └── Project-B/
        ├── 2025-01-15.md
        └── 2025-01-16.md
```

Each note is a separate Markdown file named by date (`YYYY-MM-DD.md`), organized by context/project folders.

## Contributing

Contributions welcome! See [DEVELOPMENT.md](DEVELOPMENT.md) for guidelines.

## License

This project is licensed under the GNU General Public License v3.0 - see [LICENSE](LICENSE) file for details.

This is free software: you are free to change and redistribute it under the terms of the GPL-3.0 license.

---

Built by [@gmoqa](https://github.com/gmoqa) • [dailynotes.dev](https://dailynotes.dev)
