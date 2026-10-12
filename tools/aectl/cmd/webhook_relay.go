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
	"context"
	"fmt"
	"sync"

	"github.com/spf13/viper"

	"github.com/wso2/aep/aectl/internal/bootstrap"
	"github.com/wso2/aep/aectl/internal/ui"
)

// webhookRelaySeedPath keys every org's AE Studio relay channel (aep-api's
// AE_STUDIO_WEBHOOK_RELAY_SEED). Seeded with the install's secrets but not in
// requiredOpenBaoPaths: an install that predates the relay is topped up by
// `platform update` (topUpWebhookRelaySeed), it is not a wiped store.
const webhookRelaySeedPath = "aep/webhook-relay-seed"

// webhookRelaySeed is 32 random bytes as hex text: `platform secret import`
// trims values, so the seed is stored and used (as the HMAC key) as text.
func webhookRelaySeed() (string, error) { return bootstrap.GenerateHex(32) }

// legacyRelayNotice makes the legacy-key notice print once per run.
var legacyRelayNotice = &sync.Once{}

// webhookRelayEnabled is the per-org webhook relay switch. An install made
// before the relay persisted webhook.local_smee.enabled (the install-wide smee
// client the relay replaces); while ae_studio.webhook_relay.enabled is absent
// that legacy key stands in, so an upgrade keeps webhook delivery.
func webhookRelayEnabled() bool {
	const key, legacyKey = "ae_studio.webhook_relay.enabled", "webhook.local_smee.enabled"
	if viper.IsSet(key) || !viper.IsSet(legacyKey) {
		return viper.GetBool(key)
	}
	enabled := viper.GetBool(legacyKey)
	legacyRelayNotice.Do(func() {
		ui.Warn(fmt.Sprintf("%s is not set; using the legacy %s=%t. Set %s in the aectl config to silence this.",
			key, legacyKey, enabled, key))
	})
	return enabled
}

// ensureWebhookRelaySeed tops up aep/webhook-relay-seed in OpenBao for an
// install that predates the relay, or whose in-memory OpenBao restarted
// (create-only), before the chart's ExternalSecret for it is rendered.
func ensureWebhookRelaySeed(ctx context.Context, platformNamespace string) error {
	if !webhookRelayEnabled() {
		return nil
	}
	s, err := openOpenBaoSession(ctx)
	if err != nil {
		return fmt.Errorf("connect to OpenBao: %w", err)
	}
	defer s.stop()
	recover, err := newClusterSecretRecovery(ctx, platformNamespace)
	if err != nil {
		return err
	}
	return topUpWebhookRelaySeed(s.seedStore(ctx, recover))
}

// topUpWebhookRelaySeed seeds aep/webhook-relay-seed create-only when the
// relay is enabled: the seed the cluster's Secret still holds when there is
// one (a new seed moves every org's channel off the URL its hooks deliver to),
// a fresh one otherwise. It says what it wrote, never the value. With the
// relay off it does not touch the store.
func topUpWebhookRelaySeed(st seedStore) error {
	if !webhookRelayEnabled() {
		return nil
	}
	seeded, err := seedGeneratedSecrets([]generatedSecret{webhookRelaySeedSecret}, st)
	if err != nil {
		return err
	}
	for _, line := range describeSeeded(seeded) {
		ui.Success(line)
	}
	return nil
}
