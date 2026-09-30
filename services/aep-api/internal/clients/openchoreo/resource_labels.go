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

package openchoreo

import (
	"fmt"
	"maps"
	"regexp"
	"strings"

	ocgen "github.com/wso2/aep/aep-api/internal/clients/openchoreo/gen"
)

// resourceLabels are the labels every write carries (Config.ResourceLabels).
//
// They exist because a platform in front of OpenChoreo can need facts about
// AEP on the objects themselves. wso2cloud's platform API stamps the caller's
// product (`cloud.wso2.com/product-name`) on a write made with a user's token,
// but deliberately not on one made with the impersonating service token — and
// that is how every background write goes out (webhooks, sweeps, the run
// supervisor). Its build workflow copies the label onto the build pod and fails
// to render without it, and it selects a product's ReleaseBindings on it to
// suspend the product. So the product is stamped here, on every write, by
// whoever configures it (the cloud overlay's entrypoint); OSS configures none.
//
// A configured label wins over one the write set itself, and every other label
// on the object is kept.
type resourceLabels map[string]string

func newResourceLabels(labels map[string]string) resourceLabels {
	if len(labels) == 0 {
		return nil
	}
	return resourceLabels(maps.Clone(labels))
}

// stamp sets the labels on a typed object's metadata.
func (l resourceLabels) stamp(meta *ocgen.ObjectMeta) {
	if len(l) == 0 {
		return
	}
	if meta.Labels == nil {
		meta.Labels = &map[string]string{}
	}
	maps.Copy(*meta.Labels, l)
}

// stampOC sets the labels on a hand-rolled client's object metadata (the
// Resource-model and project-cell clients). Like the rest of those clients'
// writes, it sets them on the caller's object in place.
func (l resourceLabels) stampOC(meta *OCObjectMeta) {
	if len(l) == 0 {
		return
	}
	if meta.Labels == nil {
		meta.Labels = map[string]string{}
	}
	maps.Copy(meta.Labels, l)
}

// stampedObject returns an untyped object body (the ComponentType writes carry
// theirs as a map) with the labels set on its metadata. The caller's map is
// not modified: the top level, metadata and labels are copied on the way.
func (l resourceLabels) stampedObject(body map[string]any) map[string]any {
	if len(l) == 0 {
		return body
	}
	out := maps.Clone(body)
	if out == nil {
		out = map[string]any{}
	}
	meta, _ := out["metadata"].(map[string]any)
	meta = maps.Clone(meta)
	if meta == nil {
		meta = map[string]any{}
	}
	labels, _ := meta["labels"].(map[string]any)
	labels = maps.Clone(labels)
	if labels == nil {
		labels = map[string]any{}
	}
	for k, v := range l {
		labels[k] = v
	}
	meta["labels"] = labels
	out["metadata"] = meta
	return out
}

var (
	labelNameRE   = regexp.MustCompile(`^[A-Za-z0-9]([-A-Za-z0-9_.]*[A-Za-z0-9])?$`)
	labelPrefixRE = regexp.MustCompile(`^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$`)
)

// ValidateResourceLabels refuses labels the Kubernetes API server would reject,
// so a misconfiguration fails the boot instead of every write: a key is an
// optional DNS-subdomain prefix (≤253) and a name (≤63), a value is empty or a
// name-shaped string (≤63).
func ValidateResourceLabels(labels map[string]string) error {
	for key, value := range labels {
		prefix, name, hasPrefix := strings.Cut(key, "/")
		if !hasPrefix {
			name, prefix = prefix, ""
		}
		if hasPrefix && (prefix == "" || len(prefix) > 253 || !labelPrefixRE.MatchString(prefix)) {
			return fmt.Errorf("resource label key %q: prefix must be a lowercase DNS subdomain of at most 253 characters", key)
		}
		if len(name) == 0 || len(name) > 63 || !labelNameRE.MatchString(name) {
			return fmt.Errorf("resource label key %q: name must be 1-63 alphanumerics, '-', '_' or '.', starting and ending alphanumeric", key)
		}
		if value != "" && (len(value) > 63 || !labelNameRE.MatchString(value)) {
			return fmt.Errorf("resource label %q: value %q must be at most 63 alphanumerics, '-', '_' or '.', starting and ending alphanumeric", key, value)
		}
	}
	return nil
}
