package config

import (
	"log"
	"os"

	"github.com/joho/godotenv"
)

type Config struct {
	Port               string
	Env                string
	GoogleClientID     string
	GoogleClientSecret string
	GoogleRedirectURL  string
}

var AppConfig *Config

func Load() {
	_ = godotenv.Load()

	env := GetEnv("ENV", "development")
	port := GetEnv("PORT", "3000")

	// Auto-detect redirect URL based on environment
	redirectURL := GetEnv("GOOGLE_REDIRECT_URL", "")
	if redirectURL == "" {
		if env == "production" {
			redirectURL = "https://dailynotes.dev/auth/google/callback"
		} else {
			redirectURL = "http://localhost:" + port + "/auth/google/callback"
		}
		log.Printf("[CONFIG] Auto-detected GOOGLE_REDIRECT_URL: %s", redirectURL)
	}

	AppConfig = &Config{
		Port:               port,
		Env:                env,
		GoogleClientID:     GetEnv("GOOGLE_CLIENT_ID", ""),
		GoogleClientSecret: GetEnv("GOOGLE_CLIENT_SECRET", ""),
		GoogleRedirectURL:  redirectURL,
	}

	if AppConfig.GoogleClientID == "" {
		log.Fatal("GOOGLE_CLIENT_ID is required")
	}
	if AppConfig.GoogleClientSecret == "" {
		log.Fatal("GOOGLE_CLIENT_SECRET is required")
	}
}

func GetEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
