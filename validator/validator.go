package validator

import (
	"fmt"
	"reflect"
	"regexp"
	"strings"

	"github.com/go-playground/validator/v10"
)

// Validator wraps the go-playground validator
type Validator struct {
	validate *validator.Validate
}

// ValidationError represents a single validation error
type ValidationError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
	Tag     string `json:"tag"`
	Value   string `json:"value,omitempty"`
}

// ValidationErrors is a collection of validation errors
type ValidationErrors []ValidationError

// Error implements the error interface
func (v ValidationErrors) Error() string {
	var messages []string
	for _, err := range v {
		messages = append(messages, err.Message)
	}
	return strings.Join(messages, "; ")
}

// New creates a new validator instance
func New() *Validator {
	v := validator.New()

	// Register custom tag name function to use JSON tags
	v.RegisterTagNameFunc(func(fld reflect.StructField) string {
		name := strings.SplitN(fld.Tag.Get("json"), ",", 2)[0]
		if name == "-" {
			return ""
		}
		return name
	})

	// Register custom validators
	v.RegisterValidation("contextname", validateContextName)
	v.RegisterValidation("dateformat", validateDateFormat)
	v.RegisterValidation("bulmacolor", validateBulmaColor)
	v.RegisterValidation("theme", validateTheme)
	v.RegisterValidation("timezone", validateTimezone)

	return &Validator{validate: v}
}

// Validate validates a struct and returns validation errors
func (v *Validator) Validate(i interface{}) error {
	err := v.validate.Struct(i)
	if err == nil {
		return nil
	}

	// Convert validation errors to our custom format
	var validationErrs ValidationErrors
	for _, err := range err.(validator.ValidationErrors) {
		validationErrs = append(validationErrs, ValidationError{
			Field:   err.Field(),
			Message: msgForTag(err),
			Tag:     err.Tag(),
			Value:   fmt.Sprintf("%v", err.Value()),
		})
	}

	return validationErrs
}

// msgForTag returns a human-readable error message for a validation tag
func msgForTag(fe validator.FieldError) string {
	field := fe.Field()

	switch fe.Tag() {
	case "required":
		return fmt.Sprintf("%s is required", field)
	case "min":
		return fmt.Sprintf("%s must be at least %s characters", field, fe.Param())
	case "max":
		return fmt.Sprintf("%s must be at most %s characters", field, fe.Param())
	case "email":
		return fmt.Sprintf("%s must be a valid email address", field)
	case "url":
		return fmt.Sprintf("%s must be a valid URL", field)
	case "contextname":
		return fmt.Sprintf("%s contains invalid characters (only letters, numbers, spaces, and -_.,&() are allowed)", field)
	case "dateformat":
		return fmt.Sprintf("%s must be in YYYY-MM-DD format", field)
	case "bulmacolor":
		return fmt.Sprintf("%s must be one of: text, link, primary, info, success, warning, danger", field)
	case "theme":
		return fmt.Sprintf("%s must be either 'light' or 'dark'", field)
	case "timezone":
		return fmt.Sprintf("%s must be a valid timezone", field)
	case "gte":
		return fmt.Sprintf("%s must be greater than or equal to %s", field, fe.Param())
	case "lte":
		return fmt.Sprintf("%s must be less than or equal to %s", field, fe.Param())
	case "oneof":
		return fmt.Sprintf("%s must be one of: %s", field, fe.Param())
	default:
		return fmt.Sprintf("%s failed validation (%s)", field, fe.Tag())
	}
}

// Custom validators

// validateContextName validates context name format
func validateContextName(fl validator.FieldLevel) bool {
	contextName := fl.Field().String()
	// Allow letters (any language), numbers, spaces, and specific symbols
	validName := regexp.MustCompile(`^[\p{L}\p{N}\s\-_.,&()]+$`)
	return validName.MatchString(contextName)
}

// validateDateFormat validates YYYY-MM-DD format
func validateDateFormat(fl validator.FieldLevel) bool {
	date := fl.Field().String()
	// Match YYYY-MM-DD format
	datePattern := regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	return datePattern.MatchString(date)
}

// validateBulmaColor validates Bulma CSS color names
func validateBulmaColor(fl validator.FieldLevel) bool {
	color := fl.Field().String()
	validColors := map[string]bool{
		"text":    true,
		"link":    true,
		"primary": true,
		"info":    true,
		"success": true,
		"warning": true,
		"danger":  true,
	}
	return validColors[color]
}

// validateTheme validates theme selection
func validateTheme(fl validator.FieldLevel) bool {
	theme := fl.Field().String()
	return theme == "light" || theme == "dark"
}

// validateTimezone validates timezone format (simplified)
func validateTimezone(fl validator.FieldLevel) bool {
	timezone := fl.Field().String()
	// Basic validation - just check it's not empty and has reasonable format
	// In production, you might want to check against time.LoadLocation
	return len(timezone) > 0 && len(timezone) < 100
}
