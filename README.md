# dailynotes.dev

Minimalist PWA for daily work notes. Offline-first, auto-sync, stored in your Google Drive.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Go Version](https://img.shields.io/badge/Go-1.23+-00ADD8?logo=go)](https://go.dev/)

**[dailynotes.dev](https://dailynotes.dev)** • [Documentation](DEVELOPMENT.md) • [Report Bug](https://github.com/gmoqa/daily-notes/issues)

---

## Features

- Offline-first with automatic sync
- Notes stored in your Google Drive (CSV format)
- Context-based organization (projects, clients, etc.)
- Auto-save after 500ms of inactivity
- Dark/light mode
- PWA support
- Calendar view

## Quick Start

Visit **[dailynotes.dev](https://dailynotes.dev)** and sign in with your Google account.

### Self-Host

```bash
git clone https://github.com/gmoqa/daily-notes.git
cd daily-notes

export GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"

# Run with Docker
docker-compose up -d

# Or with Go
go run main.go
```

See [DEVELOPMENT.md](DEVELOPMENT.md) for complete setup instructions.

## Tech Stack

- Go + Fiber
- Vanilla JavaScript (ES6 modules)
- Google Drive API (CSV storage)
- Google OAuth 2.0
- Bulma CSS

## Data Storage

Notes are stored in your Google Drive as CSV files. You have full control - view, edit, export, or delete them anytime.

```
Google Drive/
└── daily-notes/
    ├── config.json
    ├── Project-A/
    │   └── 2025.csv
    └── Project-B/
        └── 2025.csv
```

## Contributing

Contributions welcome! See [DEVELOPMENT.md](DEVELOPMENT.md) for guidelines.

## License

MIT License - see [LICENSE](LICENSE) file for details.

---

Built by [@gmoqa](https://github.com/gmoqa) • [dailynotes.dev](https://dailynotes.dev)
