package database

import (
	"daily-notes/models"
	"database/sql"
	"time"
)

// ==================== CONTEXT OPERATIONS ====================

// GetContexts retrieves all contexts for a user
func (r *Repository) GetContexts(userID string) ([]models.Context, error) {
	rows, err := r.db.Query(`
		SELECT id, user_id, name, color, created_at
		FROM contexts
		WHERE user_id = ?
		ORDER BY created_at ASC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	// Initialize with empty slice to avoid returning nil
	contexts := make([]models.Context, 0)
	for rows.Next() {
		var ctx models.Context
		if err := rows.Scan(&ctx.ID, &ctx.UserID, &ctx.Name, &ctx.Color, &ctx.CreatedAt); err != nil {
			return nil, err
		}
		contexts = append(contexts, ctx)
	}

	return contexts, rows.Err()
}

// GetContextByName retrieves a context by name for a user
func (r *Repository) GetContextByName(userID, name string) (*models.Context, error) {
	var ctx models.Context
	err := r.db.QueryRow(`
		SELECT id, user_id, name, color, created_at
		FROM contexts
		WHERE user_id = ? AND name = ?
	`, userID, name).Scan(&ctx.ID, &ctx.UserID, &ctx.Name, &ctx.Color, &ctx.CreatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	return &ctx, nil
}

// GetContextByID retrieves a context by its ID
func (r *Repository) GetContextByID(contextID string) (*models.Context, error) {
	var ctx models.Context
	err := r.db.QueryRow(`
		SELECT id, user_id, name, color, created_at
		FROM contexts
		WHERE id = ?
	`, contextID).Scan(&ctx.ID, &ctx.UserID, &ctx.Name, &ctx.Color, &ctx.CreatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	return &ctx, nil
}

// CreateContext creates a new context
func (r *Repository) CreateContext(ctx *models.Context) error {
	_, err := r.db.Exec(`
		INSERT INTO contexts (id, user_id, name, color, drive_folder_id, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`,
		ctx.ID, ctx.UserID, ctx.Name, ctx.Color, ctx.ID, ctx.CreatedAt, time.Now(),
	)
	return err
}

// UpdateContext updates a context's name and color
func (r *Repository) UpdateContext(contextID string, name string, color string) error {
	_, err := r.db.Exec(`
		UPDATE contexts SET
			name = ?,
			color = ?,
			updated_at = ?
		WHERE id = ?
	`, name, color, time.Now(), contextID)
	return err
}

// UpdateNotesContextName updates the context field for all notes when a context is renamed
func (r *Repository) UpdateNotesContextName(oldName string, newName string, userID string) error {
	_, err := r.db.Exec(`
		UPDATE notes SET
			context = ?,
			updated_at = ?
		WHERE context = ? AND user_id = ?
	`, newName, time.Now(), oldName, userID)
	return err
}

// DeleteContext deletes a context by ID
func (r *Repository) DeleteContext(contextID string) error {
	_, err := r.db.Exec("DELETE FROM contexts WHERE id = ?", contextID)
	return err
}
