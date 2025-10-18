package utils

import (
	"encoding/json"
	"log/slog"
	"os"
	"sync"
)

// ManifestEntry represents a Vite manifest entry
type ManifestEntry struct {
	File    string `json:"file"`
	Name    string `json:"name"`
	Src     string `json:"src"`
	IsEntry bool   `json:"isEntry"`
}

// ViteManifest holds the parsed Vite manifest
type ViteManifest map[string]ManifestEntry

var (
	manifestCache     ViteManifest
	manifestCacheMu   sync.RWMutex
	manifestCacheOnce sync.Once
)

// LoadViteManifest loads and caches the Vite manifest file
func LoadViteManifest(logger *slog.Logger) (ViteManifest, error) {
	var err error

	manifestCacheOnce.Do(func() {
		manifestPath := "static/dist/.vite/manifest.json"

		data, readErr := os.ReadFile(manifestPath)
		if readErr != nil {
			logger.Error("Failed to read Vite manifest", "error", readErr, "path", manifestPath)
			err = readErr
			return
		}

		var manifest ViteManifest
		if parseErr := json.Unmarshal(data, &manifest); parseErr != nil {
			logger.Error("Failed to parse Vite manifest", "error", parseErr)
			err = parseErr
			return
		}

		manifestCacheMu.Lock()
		manifestCache = manifest
		manifestCacheMu.Unlock()

		logger.Info("Vite manifest loaded successfully", "entries", len(manifest))
	})

	if err != nil {
		return nil, err
	}

	manifestCacheMu.RLock()
	defer manifestCacheMu.RUnlock()

	return manifestCache, nil
}

// GetMainScript returns the path to the main JS bundle
func GetMainScript(logger *slog.Logger) string {
	manifest, err := LoadViteManifest(logger)
	if err != nil {
		// Fallback to development path
		logger.Warn("Using fallback main.js path", "error", err)
		return "/static/js/main.js"
	}

	// Try to get the modern (non-legacy) main entry
	if entry, ok := manifest["src/main.ts"]; ok {
		return "/static/dist/" + entry.File
	}

	// Fallback
	logger.Warn("Main entry not found in manifest, using fallback")
	return "/static/js/main.js"
}

// GetLegacyScripts returns paths to legacy polyfills and main script
func GetLegacyScripts(logger *slog.Logger) (polyfills string, main string) {
	manifest, err := LoadViteManifest(logger)
	if err != nil {
		logger.Warn("Using fallback legacy paths", "error", err)
		return "", ""
	}

	// Get polyfills
	if entry, ok := manifest["vite/legacy-polyfills-legacy"]; ok {
		polyfills = "/static/dist/" + entry.File
	}

	// Get legacy main
	if entry, ok := manifest["src/main-legacy.ts"]; ok {
		main = "/static/dist/" + entry.File
	}

	return polyfills, main
}
