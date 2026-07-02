// Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
//
// WSO2 LLC. licenses this file to you under the Apache License,
// Version 2.0 (the "License"); you may not use this file except
// in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/wso2/aep/aep-api/config"
	"github.com/wso2/aep/aep-api/database"
	"github.com/wso2/aep/aep-api/database/migrations"
	"github.com/wso2/aep/aep-api/middleware/logger"
	"github.com/wso2/aep/aep-api/models"
)

// main is the process entry point: load+validate config, open the DB, run
// migrations, assemble the app graph (buildApp), then serve until a signal.
// All wiring lives in buildApp (app.go) so it is reachable from a test with
// faked deps; main owns only process lifecycle.
func main() {
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to load config: %v\n", err)
		os.Exit(1)
	}

	setupLogger(cfg.LogLevel)

	// Database. ComponentTask + ComponentConfig + webhook + push-rendezvous
	// tables. org_credentials lives in git-service — the BFF does not
	// auto-migrate or read it locally.
	db, err := database.Open(cfg.DatabaseURL,
		&models.ComponentTask{},
		&models.ComponentConfig{},
		&models.WebhookDelivery{},
		&models.WebhookPayload{},
		&models.Organization{},
	)
	if err != nil {
		slog.Error("database init failed", "error", err)
		os.Exit(1)
	}

	// Schema bootstrap + migrations. RunBootstrapGrants self-grants privileges
	// on owned schema objects (non-fatal) so FK-creating migrations don't trip
	// over a managed-DB REVOKE that stripped REFERENCES/TRIGGER from the owner
	// role. RunAll then applies every migration in dependency order (each
	// context-taking step gets its own timeout internally).
	{
		c, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		_ = migrations.RunBootstrapGrants(c, db)
		cancel()
	}
	if err := migrations.RunAll(context.Background(), db, cfg.DeploymentTier); err != nil {
		slog.Error("migrations failed", "error", err)
		os.Exit(1)
	}

	app, err := buildApp(cfg, db)
	if err != nil {
		slog.Error("app init failed", "error", err)
		os.Exit(1)
	}

	server := &http.Server{
		Addr:              fmt.Sprintf("%s:%d", cfg.ServerHost, cfg.ServerPort),
		Handler:           app.Handler,
		ReadHeaderTimeout: 15 * time.Second,
		WriteTimeout:      15 * time.Minute, // AI design generation can take up to 10 min
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		slog.Info("server started", "addr", server.Addr)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	// Background watchers. State lives in Postgres, so a restart resumes from
	// the next tick — a plain goroutine per watcher is enough. All share
	// watcherCtx, cancelled on shutdown.
	watcherCtx, cancelWatcher := context.WithCancel(context.Background())
	defer cancelWatcher()
	for _, w := range app.Watchers {
		go w.Run(watcherCtx)
	}
	slog.Info("background watchers started", "count", len(app.Watchers))

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	slog.Info("shutting down server")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		slog.Error("server shutdown failed", "error", err)
		os.Exit(1)
	}
	slog.Info("server stopped")
}

func setupLogger(level string) {
	var logLevel slog.Level
	switch level {
	case "debug":
		logLevel = slog.LevelDebug
	case "warn":
		logLevel = slog.LevelWarn
	case "error":
		logLevel = slog.LevelError
	default:
		logLevel = slog.LevelInfo
	}
	base := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: logLevel})
	slog.SetDefault(slog.New(logger.NewContextHandler(base)))
}
