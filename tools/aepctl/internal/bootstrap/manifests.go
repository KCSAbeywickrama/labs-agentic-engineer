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

package bootstrap

import (
	"strings"

	"gopkg.in/yaml.v3"
)

// Config holds the runtime values needed to render the bootstrap manifests.
// Secrets are no longer included here — they are stored in OpenBao.
type Config struct {
	Namespace      string
	ReleaseName    string
	ThunderURL     string
	PlatformAPIURL string
}

// Manifests returns a YAML string containing the bootstrap Kubernetes resources
// that must exist before Helm installs the AEP chart. Currently this is only
// the platform-configs ConfigMap; secrets are managed via OpenBao + ESO.
func Manifests(c Config) (string, error) {
	resources := []map[string]interface{}{
		platformConfigMap(c),
	}

	var buf strings.Builder
	for _, r := range resources {
		b, err := yaml.Marshal(r)
		if err != nil {
			return "", err
		}
		buf.Write(b)
		buf.WriteString("---\n")
	}
	return buf.String(), nil
}

func helmMeta(name, namespace, releaseName string) map[string]interface{} {
	return map[string]interface{}{
		"name":      name,
		"namespace": namespace,
		"annotations": map[string]interface{}{
			"meta.helm.sh/release-name":      releaseName,
			"meta.helm.sh/release-namespace": namespace,
		},
		"labels": map[string]interface{}{
			"app.kubernetes.io/managed-by": "Helm",
		},
	}
}

func platformConfigMap(c Config) map[string]interface{} {
	return map[string]interface{}{
		"apiVersion": "v1",
		"kind":       "ConfigMap",
		"metadata":   helmMeta("platform-configs", c.Namespace, c.ReleaseName),
		"data": map[string]interface{}{
			"PLATFORM_API_SERVICE_BASE_URL": c.PlatformAPIURL,
			"JWKS_URL":                      c.ThunderURL + "/oauth2/jwks",
			"JWT_ISSUER":                    c.ThunderURL,
		},
	}
}
