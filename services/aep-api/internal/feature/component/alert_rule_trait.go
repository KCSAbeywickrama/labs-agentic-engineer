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

package component

import (
	"fmt"

	"github.com/wso2/aep/aep-api/models"
)

// autoRCALogQueries are the default log phrases the platform watches for on
// every service component. TWO instances because the logs-adapter compiles a
// rule's `query` into a case-sensitive `wildcard: *<phrase>*` against the raw
// log line — so "error" and "ERROR" need separate rules to catch both the
// lowercase (structured/slog-style) and uppercase (level-prefix-style) forms.
// Tune here to change coverage (e.g. drop to one for less RCA volume).
var autoRCALogQueries = []struct{ suffix, query string }{
	{suffix: "error", query: "error"},
	{suffix: "error-uc", query: "ERROR"},
}

// autoRCADefaultChannel is the notification channel stamped on auto-provisioned
// rules. The trait requires ≥1 channel (incident-only rules are rejected);
// "default" is a placeholder the observer accepts when no real channel exists.
const autoRCADefaultChannel = "default"

// DesiredObservabilityAlertRuleTraits returns the default "error → RCA"
// observability-alert-rule trait instances (+ their per-environment configs)
// for a component. componentName is the k8s-shaped name; instances are named
// `<componentName>-auto-rca-<suffix>`.
//
// The split mirrors the api-configuration trait: rule shape (source/query,
// condition) lives in the component-level trait Parameters; the incident /
// triggerAiRca action lives in the per-environment config (the trait template
// reads triggerAiRca from environmentConfigs). incident.enabled is set true
// because the trait validation requires it whenever triggerAiRca is true.
func DesiredObservabilityAlertRuleTraits(componentName string) (traits []models.ComponentTrait, configs map[string]map[string]interface{}) {
	configs = map[string]map[string]interface{}{}
	for _, q := range autoRCALogQueries {
		inst := componentName + "-auto-rca-" + q.suffix
		traits = append(traits, models.ComponentTrait{
			InstanceName: inst,
			Kind:         "ClusterTrait",
			Name:         "observability-alert-rule",
			Parameters: map[string]interface{}{
				"description": fmt.Sprintf(
					"Auto-provisioned: trigger RCA when %s logs a %q line.",
					componentName, q.query),
				"severity": "critical",
				"source": map[string]interface{}{
					"type":  "log",
					"query": q.query,
				},
				"condition": map[string]interface{}{
					"window":    "5m",
					"interval":  "1m",
					"operator":  "gte",
					"threshold": 1,
				},
			},
		})
		configs[inst] = map[string]interface{}{
			"enabled": true,
			"actions": map[string]interface{}{
				"notifications": map[string]interface{}{
					"channels": []interface{}{autoRCADefaultChannel},
				},
				"incident": map[string]interface{}{
					"enabled":      true,
					"triggerAiRca": true,
				},
			},
		}
	}
	return traits, configs
}
