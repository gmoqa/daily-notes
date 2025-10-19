package database

// Repository provides database operations organized by domain
// See domain-specific files:
// - users.go: User and settings operations
// - contexts.go: Context operations
// - notes.go: Note CRUD operations
// - sync.go: Sync-related operations
type Repository struct {
	db *DB
}

// NewRepository creates a new repository instance
func NewRepository(db *DB) *Repository {
	return &Repository{db: db}
}
