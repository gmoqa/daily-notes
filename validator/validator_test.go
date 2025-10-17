package validator

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

type TestCreateNoteRequest struct {
	Context string `json:"context" validate:"required,min=1,max=100,contextname"`
	Date    string `json:"date" validate:"required,dateformat"`
	Content string `json:"content"`
}

type TestCreateContextRequest struct {
	Name  string `json:"name" validate:"required,min=2,max=100,contextname"`
	Color string `json:"color" validate:"required,bulmacolor"`
}

type TestUpdateSettingsRequest struct {
	Theme      string `json:"theme" validate:"required,theme"`
	WeekStart  int    `json:"weekStart" validate:"gte=0,lte=6"`
	Timezone   string `json:"timezone" validate:"required,timezone"`
	DateFormat string `json:"dateFormat" validate:"required,oneof=DD-MM-YY MM-DD-YY YYYY-MM-DD"`
}

func TestValidator_CreateNote(t *testing.T) {
	v := New()

	tests := []struct {
		name      string
		req       TestCreateNoteRequest
		wantError bool
		errorMsg  string
	}{
		{
			name: "Valid note request",
			req: TestCreateNoteRequest{
				Context: "Work",
				Date:    "2025-10-17",
				Content: "Test content",
			},
			wantError: false,
		},
		{
			name: "Missing context",
			req: TestCreateNoteRequest{
				Context: "",
				Date:    "2025-10-17",
				Content: "Test",
			},
			wantError: true,
			errorMsg:  "context is required",
		},
		{
			name: "Missing date",
			req: TestCreateNoteRequest{
				Context: "Work",
				Date:    "",
				Content: "Test",
			},
			wantError: true,
			errorMsg:  "date is required",
		},
		{
			name: "Invalid date format",
			req: TestCreateNoteRequest{
				Context: "Work",
				Date:    "17-10-2025",
				Content: "Test",
			},
			wantError: true,
			errorMsg:  "date must be in YYYY-MM-DD format",
		},
		{
			name: "Context name too long",
			req: TestCreateNoteRequest{
				Context: string(make([]byte, 101)),
				Date:    "2025-10-17",
				Content: "Test",
			},
			wantError: true,
		},
		{
			name: "Invalid context characters",
			req: TestCreateNoteRequest{
				Context: "Work@#$%",
				Date:    "2025-10-17",
				Content: "Test",
			},
			wantError: true,
			errorMsg:  "invalid characters",
		},
		{
			name: "Empty content is valid",
			req: TestCreateNoteRequest{
				Context: "Work",
				Date:    "2025-10-17",
				Content: "",
			},
			wantError: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := v.Validate(&tt.req)

			if tt.wantError {
				assert.Error(t, err)
				if tt.errorMsg != "" {
					assert.Contains(t, err.Error(), tt.errorMsg)
				}
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

func TestValidator_CreateContext(t *testing.T) {
	v := New()

	tests := []struct {
		name      string
		req       TestCreateContextRequest
		wantError bool
		errorMsg  string
	}{
		{
			name: "Valid context request",
			req: TestCreateContextRequest{
				Name:  "Work",
				Color: "primary",
			},
			wantError: false,
		},
		{
			name: "Missing name",
			req: TestCreateContextRequest{
				Name:  "",
				Color: "primary",
			},
			wantError: true,
			errorMsg:  "name is required",
		},
		{
			name: "Name too short",
			req: TestCreateContextRequest{
				Name:  "A",
				Color: "primary",
			},
			wantError: true,
			errorMsg:  "at least 2 characters",
		},
		{
			name: "Invalid color",
			req: TestCreateContextRequest{
				Name:  "Work",
				Color: "invalid",
			},
			wantError: true,
			errorMsg:  "one of: text, link, primary, info, success, warning, danger",
		},
		{
			name: "Valid context with special characters",
			req: TestCreateContextRequest{
				Name:  "Work - Projects (2025)",
				Color: "info",
			},
			wantError: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := v.Validate(&tt.req)

			if tt.wantError {
				assert.Error(t, err)
				if tt.errorMsg != "" {
					assert.Contains(t, err.Error(), tt.errorMsg)
				}
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

func TestValidator_UpdateSettings(t *testing.T) {
	v := New()

	tests := []struct {
		name      string
		req       TestUpdateSettingsRequest
		wantError bool
		errorMsg  string
	}{
		{
			name: "Valid settings request",
			req: TestUpdateSettingsRequest{
				Theme:      "dark",
				WeekStart:  0,
				Timezone:   "UTC",
				DateFormat: "DD-MM-YY",
			},
			wantError: false,
		},
		{
			name: "Invalid theme",
			req: TestUpdateSettingsRequest{
				Theme:      "blue",
				WeekStart:  0,
				Timezone:   "UTC",
				DateFormat: "DD-MM-YY",
			},
			wantError: true,
			errorMsg:  "must be either 'light' or 'dark'",
		},
		{
			name: "Week start out of range (negative)",
			req: TestUpdateSettingsRequest{
				Theme:      "dark",
				WeekStart:  -1,
				Timezone:   "UTC",
				DateFormat: "DD-MM-YY",
			},
			wantError: true,
			errorMsg:  "greater than or equal to 0",
		},
		{
			name: "Week start out of range (too high)",
			req: TestUpdateSettingsRequest{
				Theme:      "dark",
				WeekStart:  7,
				Timezone:   "UTC",
				DateFormat: "DD-MM-YY",
			},
			wantError: true,
			errorMsg:  "less than or equal to 6",
		},
		{
			name: "Invalid date format",
			req: TestUpdateSettingsRequest{
				Theme:      "dark",
				WeekStart:  0,
				Timezone:   "UTC",
				DateFormat: "YYYY/MM/DD",
			},
			wantError: true,
			errorMsg:  "must be one of: DD-MM-YY MM-DD-YY YYYY-MM-DD",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := v.Validate(&tt.req)

			if tt.wantError {
				assert.Error(t, err)
				if tt.errorMsg != "" {
					assert.Contains(t, err.Error(), tt.errorMsg)
				}
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

func TestValidationErrors_Error(t *testing.T) {
	errs := ValidationErrors{
		{Field: "name", Message: "name is required", Tag: "required"},
		{Field: "color", Message: "color must be valid", Tag: "bulmacolor"},
	}

	errMsg := errs.Error()
	assert.Contains(t, errMsg, "name is required")
	assert.Contains(t, errMsg, "color must be valid")
}
