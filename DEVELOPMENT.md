# Development Guide

Complete technical documentation for developers contributing to dailynotes.dev.

## Table of Contents

- [Architecture](#architecture)
- [Setup](#setup)
- [Development](#development)
- [Project Structure](#project-structure)
- [Code Style](#code-style)
- [Configuration](#configuration)
- [Deployment](#deployment)

## Architecture

### Storage

Notes are stored in **your personal Google Drive** in the following structure:

```
Google Drive/
└── daily-notes/
    ├── config.json           # Contexts and user settings
    ├── Project-A/
    │   ├── 2025.csv
    │   └── 2024.csv
    └── Project-B/
        └── 2025.csv
```

- **config.json**: Stores your contexts (projects) and app settings
- **Context folders**: One per project/context
- **Year CSV files**: One file per year with daily notes (columns: `date`, `content`, `context`, `created_at`, `updated_at`)

### Authentication

- Frontend: Google Identity Services with OAuth2 token client
- Backend: Validates access tokens via Google's userinfo endpoint
- OAuth2 scopes: `drive.file`, `openid`, `profile`, `email`
- Session storage: In-memory store with periodic cleanup
- All `/api/*` routes require authentication

### Frontend Architecture

- Single-page app in `views/index.jet` (Jet template engine)
- Google Identity Services loaded from CDN
- **Optimistic UI updates** - instant response without waiting for server
- **IndexedDB cache** - local storage for offline access
- **Sync queue with automatic retry** - resilient background synchronization
- **Event-driven architecture** - decoupled components with custom events
- Server-synchronized clock with timezone support
- Auto-save after 500ms of inactivity
- Service worker caches static assets and handles offline fallback

### Tech Stack

- **Backend**: Go 1.23 + Fiber v2
- **Authentication**: Google OAuth + Drive API
- **Storage**: Google Drive (CSV format)
- **Frontend**: Vanilla JavaScript (ES6 modules)
- **CSS**: Bulma v1.0.2 + Custom styles
- **Template Engine**: Jet v6
- **PWA**: Service Worker + Web Manifest

## Setup

### 1. Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project or select existing
3. Enable **Google Drive API**
4. Create OAuth 2.0 credentials:
   - Application type: Web application
   - Add authorized JavaScript origins: `http://localhost:3000`
   - Add authorized redirect URIs: `http://localhost:3000`
5. Add test users in OAuth consent screen (if app is in testing mode)
6. Copy the Client ID

The app requests these scopes:
- `https://www.googleapis.com/auth/drive.file` - Access to app-created files only
- `openid`, `profile`, `email` - Basic user info

### 2. Install Dependencies

```bash
# Install Go dependencies
go mod download

# Verify installation
go version  # Should be 1.23 or higher
```

### 3. Environment Variables

Create a `.env` file in the root directory:

```bash
# Required
GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"

# Optional
GOOGLE_CLIENT_SECRET=""  # For OAuth refresh token flow
PORT=3000
ENV=development
CORS_ORIGINS="*"
LOG_LEVEL=info
```

### 4. Run Development Server

```bash
go run main.go
```

The app will be available at `http://localhost:3000`

## Development

### Common Commands

```bash
go run main.go          # Run development server
go mod download         # Install dependencies
go mod tidy            # Clean up dependencies
go fmt ./...           # Format code
go vet ./...           # Run static analysis
go test ./...          # Run tests (when available)
```

### Hot Reload

For development with hot reload, you can use:

```bash
# Using air (install: go install github.com/cosmtrek/air@latest)
air

# Or using entr
ls **/*.go | entr -r go run main.go
```

## Project Structure

```
daily-notes/
├── config/          # Application configuration
│   └── config.go
├── drive/           # Google Drive API client wrapper
│   └── client.go
├── handlers/        # HTTP handlers
│   ├── auth.go      # Authentication endpoints
│   ├── contexts.go  # Context management
│   ├── notes.go     # Notes CRUD operations
│   └── pages.go     # Page rendering
├── middleware/      # HTTP middleware
│   ├── auth.go      # Authentication middleware
│   ├── logger.go    # Request logging
│   └── security.go  # Security headers
├── models/          # Data models
│   ├── context.go
│   ├── note.go
│   └── user.go
├── session/         # Session management
│   └── store.go     # In-memory session store
├── static/          # Static assets
│   ├── css/         # Stylesheets
│   ├── js/          # JavaScript modules
│   ├── icons/       # PWA icons
│   ├── manifest.json
│   └── sw.js        # Service worker
├── views/           # Jet templates
│   └── index.jet    # Main SPA template
├── scripts/         # Deployment scripts
├── .env.example     # Environment variables template
├── go.mod           # Go dependencies
├── go.sum           # Dependency checksums
├── main.go          # Application entry point
├── Dockerfile       # Production Docker image
├── docker-compose.yml
├── Makefile         # Build commands
└── README.md        # User-facing documentation
```

### Key Components

#### Backend

- **`main.go`**: Application entry point, sets up Fiber server and routes
- **`config/`**: Configuration management and environment variables
- **`drive/`**: Google Drive API client wrapper with CSV operations
- **`handlers/`**: HTTP request handlers organized by domain
- **`middleware/`**: Authentication, logging, and security middleware
- **`session/`**: In-memory session store with automatic cleanup

#### Frontend

- **`static/js/main.js`**: Application entry point and initialization
- **`static/js/state.js`**: Global state management
- **`static/js/auth.js`**: Authentication and Google OAuth
- **`static/js/api.js`**: Backend API client
- **`static/js/cache.js`**: IndexedDB caching layer
- **`static/js/sync.js`**: Background sync queue with retry logic
- **`static/js/notes.js`**: Notes management
- **`static/js/contexts.js`**: Context management
- **`static/js/calendar.js`**: Calendar widget
- **`static/js/ui.js`**: UI utilities and components
- **`static/js/events.js`**: Event bus for component communication
- **`static/sw.js`**: Service worker for offline support

## Code Style

### Go

- Follow standard Go conventions and idioms
- Use `go fmt` for formatting
- Prefer simplicity over cleverness
- Minimal comments - code should be self-explanatory
- Error handling: return errors, don't panic
- Use context for cancellation and timeouts

### JavaScript

- ES6+ features (modules, async/await, arrow functions)
- Modular architecture - one module per concern
- Event-driven communication between modules
- Async operations with proper error handling
- Clear variable names - avoid abbreviations

### CSS

- BEM methodology for naming
- CSS variables for theming
- Mobile-first responsive design
- Prefer flexbox and grid over floats
- Transitions and animations for better UX

## Configuration

### Environment Variables

**Required:**
- `GOOGLE_CLIENT_ID` - Google OAuth client ID from Google Cloud Console

**Optional:**
- `GOOGLE_CLIENT_SECRET` - For OAuth refresh token flow
- `PORT` - Server port (default: 3000)
- `ENV` - Environment: `development` or `production` (default: development)
- `CORS_ORIGINS` - Allowed CORS origins (default: "*")
- `LOG_LEVEL` - Logging level: `debug`, `info`, `warn`, `error` (default: info)

### PWA Configuration

PWA icons should be placed in `static/icons/`:
- `icon-72x72.png`
- `icon-96x96.png`
- `icon-128x128.png`
- `icon-144x144.png`
- `icon-152x152.png`
- `icon-192x192.png`
- `icon-384x384.png`
- `icon-512x512.png`
- `apple-touch-icon.png`

Use [Real Favicon Generator](https://realfavicongenerator.net) to generate all sizes.

## Deployment

For complete production deployment instructions, see [DEPLOYMENT.md](DEPLOYMENT.md).

### Quick Options

#### Docker (Recommended)
```bash
docker-compose up -d
```

#### Traditional VPS
```bash
make prod-build
./scripts/deploy-vps.sh
```

#### Platform-as-a-Service
- Railway.app
- Fly.io
- Render.com

See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed platform-specific instructions.

## Testing

```bash
# Run all tests
go test ./...

# Run tests with coverage
go test -cover ./...

# Run tests with verbose output
go test -v ./...
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Guidelines

- Keep commits atomic and well-described
- Update documentation for new features
- Ensure code follows the style guide
- Test your changes thoroughly
- Update CHANGELOG.md if applicable

## Troubleshooting

### Common Issues

**Port already in use:**
```bash
# Find and kill the process using port 3000
lsof -ti:3000 | xargs kill -9
```

**Google OAuth errors:**
- Verify your Client ID is correct
- Check that your domain is in authorized origins
- Ensure test users are added if app is in testing mode

**Drive API errors:**
- Verify Drive API is enabled in Google Cloud Console
- Check OAuth scopes are correct
- Ensure user has granted necessary permissions

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
