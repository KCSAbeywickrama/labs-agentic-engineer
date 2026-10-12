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

package cmd

import (
	"io"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/spf13/viper"
)

// captureStdout returns what fn printed to stdout.
func captureStdout(t *testing.T, fn func()) string {
	t.Helper()
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	orig := os.Stdout
	os.Stdout = w
	fn()
	os.Stdout = orig
	_ = w.Close()
	out, _ := io.ReadAll(r)
	return string(out)
}

// An install made before the relay persisted webhook.local_smee.enabled, not
// ae_studio.webhook_relay.enabled. The legacy key stands in only while the
// new one is absent, and says so once.
func TestWebhookRelayEnabled_LegacySmeeKey(t *testing.T) {
	cases := []struct {
		name         string
		newKey       *bool
		legacy       *bool
		want         bool
		wantNoticeIn bool
	}{
		{name: "neither set", want: false},
		{name: "new key only", newKey: ptr(true), want: true},
		{name: "legacy on, new absent", legacy: ptr(true), want: true, wantNoticeIn: true},
		{name: "legacy off, new absent", legacy: ptr(false), want: false, wantNoticeIn: true},
		{name: "new key wins over legacy", newKey: ptr(false), legacy: ptr(true), want: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Cleanup(viper.Reset)
			resetLegacyRelayNotice(t)
			// LoadFromCluster loads ConfigMap entries as defaults.
			if tc.newKey != nil {
				viper.SetDefault("ae_studio.webhook_relay.enabled", *tc.newKey)
			}
			if tc.legacy != nil {
				viper.SetDefault("webhook.local_smee.enabled", *tc.legacy)
			}
			var got bool
			out := captureStdout(t, func() {
				got = webhookRelayEnabled()
				got2 := webhookRelayEnabled()
				if got2 != got {
					t.Errorf("not stable: %t then %t", got, got2)
				}
			})
			if got != tc.want {
				t.Errorf("webhookRelayEnabled() = %t, want %t", got, tc.want)
			}
			n := strings.Count(out, "webhook.local_smee.enabled")
			if tc.wantNoticeIn && n != 1 {
				t.Errorf("want the legacy-key notice exactly once, got %d: %q", n, out)
			}
			if !tc.wantNoticeIn && n != 0 {
				t.Errorf("no notice expected, got %q", out)
			}
		})
	}
}

// The install-time overrides follow the same resolution.
func TestAEStudioOverrides_WebhookRelayLegacyKey(t *testing.T) {
	t.Cleanup(viper.Reset)
	resetLegacyRelayNotice(t)
	viper.SetDefault("webhook.local_smee.enabled", "true")
	var got string
	captureStdout(t, func() { got = strings.Join(aeStudioOverrides("wso2-aep"), " ") })
	if !strings.Contains(got, "--set aeStudio.webhookRelay.enabled=true") {
		t.Errorf("legacy key on, new absent: want the relay on, got %s", got)
	}
}

func ptr[T any](v T) *T { return &v }

// resetLegacyRelayNotice gives the test a fresh once-only notice.
func resetLegacyRelayNotice(t *testing.T) {
	t.Helper()
	orig := legacyRelayNotice
	legacyRelayNotice = &sync.Once{}
	t.Cleanup(func() { legacyRelayNotice = orig })
}
