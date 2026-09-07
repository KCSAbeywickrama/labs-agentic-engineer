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

// dependencygate.go — the dependency.json / sdk.json write-gate, an EXACT
// port of the agent's zod gate (packages/agent-stream/src/dependency-design-
// schema.ts `checkDependencyDesign`). The two must agree: a write the agent's
// bundle accepts must fold here, and one it rejects must reject here, or the
// agent would self-correct against one rule and the fold would enforce
// another. Kept as a hand-written mirror (like designgate.go) rather than a
// JSON-schema check because half the rules are shape rules the schema cannot
// say — name equals directory, candidates and a provider never coexist, the
// contract file name fits the style, `assumed` is echoed but never authored.

package agentfold

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

var (
	// dependencyDesignRe is DEPENDENCY_DESIGN_JSON_RE; sdkManifestRe is SDK_MANIFEST_JSON_RE.
	dependencyDesignRe = regexp.MustCompile(`^specs/design/dependencies/([^/]+)/dependency\.json$`)
	sdkManifestRe      = regexp.MustCompile(`^specs/design/dependencies/([^/]+)/sdk\.json$`)
	sha256HexRe        = regexp.MustCompile(`^[0-9a-f]{64}$`)
	packageRefRe       = regexp.MustCompile(`^[a-z][a-z0-9-]*:.+`)

	dependencyStyles          = map[string]bool{"rest-api": true, "graphql": true, "sdk": true}
	dependencySources         = map[string]bool{"project": true, "org": true}
	dependencyDefinitionKeys  = map[string]bool{"name": true, "description": true, "source": true, "provider": true, "style": true, "contract": true, "sdk": true, "provenance": true, "candidates": true, "config": true, "assumed": true}
	provenanceKeys            = map[string]bool{"sourceUrl": true, "sha256": true, "fetchedAt": true, "sliced": true}
	assumptionKeys            = map[string]bool{"by": true, "at": true, "note": true}
	candidateKeys             = map[string]bool{"name": true, "style": true, "description": true, "package": true}
	configKeyKeys             = map[string]bool{"key": true, "secret": true, "description": true, "defaultValue": true}
	sdkManifestKeys           = map[string]bool{"packages": true, "docsUrl": true, "calls": true}
	contractFilesByStyle      = map[string][]string{"rest-api": {"openapi.yaml", "openapi.yml", "openapi.json"}, "graphql": {"schema.graphql", "schema.graphqls"}}
	sdkManifestFile           = "sdk.json"
	dependencyContractAnyFile = append(append([]string{}, contractFilesByStyle["rest-api"]...), contractFilesByStyle["graphql"]...)
)

// checkDependencyDesignGuard mirrors checkDependencyDesign: a dependency.json
// or sdk.json body must validate before it folds. `prior` is the file as it
// stands before this write (nil when it does not exist) — the one input the
// assumed-is-echoed rule needs.
func checkDependencyDesignGuard(path, content string, prior *string) (ErrCode, string) {
	if m := sdkManifestRe.FindStringSubmatch(path); m != nil {
		if p := validateSdkManifest(content); p != nil {
			return p.code, path + ": " + p.message
		}
		return "", ""
	}
	m := dependencyDesignRe.FindStringSubmatch(path)
	if m == nil {
		return "", ""
	}
	if p := validateDependencyDesign(content, m[1], prior); p != nil {
		return p.code, path + ": " + p.message
	}
	return "", ""
}

func validateDependencyDesign(content, dirName string, prior *string) *designProblem {
	var parsed any
	if err := json.Unmarshal([]byte(content), &parsed); err != nil {
		return &designProblem{code: ErrInvalidJSON, message: "content is not valid JSON: " + err.Error()}
	}
	obj, ok := parsed.(map[string]any)
	if !ok {
		return &designProblem{code: ErrSchemaViolation, message: "must be an object"}
	}
	for k := range obj {
		if !dependencyDefinitionKeys[k] {
			return &designProblem{code: ErrSchemaViolation, message: "unknown property " + k}
		}
	}
	name, ok := obj["name"].(string)
	if !ok || name == "" {
		return &designProblem{code: ErrSchemaViolation, message: "name: must be a non-empty string"}
	}
	for _, f := range []string{"description", "provider", "contract", "sdk"} {
		if v, present := obj[f]; present {
			s, ok := v.(string)
			if !ok || (f != "description" && s == "") {
				return &designProblem{code: ErrSchemaViolation, message: f + ": must be a non-empty string"}
			}
		}
	}
	if v, present := obj["source"]; present {
		if s, ok := v.(string); !ok || !dependencySources[s] {
			return &designProblem{code: ErrSchemaViolation, message: fmt.Sprintf("source: %q is not an allowed value", v)}
		}
	}
	style, _ := obj["style"].(string)
	if v, present := obj["style"]; present {
		if s, ok := v.(string); !ok || !dependencyStyles[s] {
			return &designProblem{code: ErrSchemaViolation, message: fmt.Sprintf("style: %q is not an allowed value", v)}
		}
	}
	if p := validateProvenance(obj["provenance"]); p != nil {
		return p
	}
	if p := validateAssumption(obj["assumed"]); p != nil {
		return p
	}
	candidates, hasCandidates := obj["candidates"]
	if hasCandidates {
		if p := validateCandidates(candidates); p != nil {
			return p
		}
	}
	if cfg, present := obj["config"]; present {
		if p := validateConfigKeys(cfg); p != nil {
			return p
		}
	}

	provider, _ := obj["provider"].(string)
	contract, hasContract := obj["contract"].(string)
	sdk, hasSDK := obj["sdk"].(string)
	if name != dirName {
		return &designProblem{code: ErrSchemaViolation, message: fmt.Sprintf("\"name\" must equal the dependency directory (%q), got %q.", dirName, name)}
	}
	if hasCandidates && provider != "" {
		return &designProblem{code: ErrSchemaViolation, message: `"candidates" and "provider" never coexist — choosing one option REMOVES candidates and sets provider + style; keep candidates only while the choice is open.`}
	}
	if hasCandidates && (style != "" || hasContract || hasSDK) {
		return &designProblem{code: ErrSchemaViolation, message: `while "candidates" are open, "style", "contract" and "sdk" stay unset — they describe the chosen provider, and none is chosen yet.`}
	}
	if (hasContract || hasSDK) && style == "" {
		return &designProblem{code: ErrSchemaViolation, message: `"style" is required once a "contract" or "sdk" is named — it says how the component talks to the system.`}
	}
	if hasContract {
		if strings.Contains(contract, "/") {
			return &designProblem{code: ErrSchemaViolation, message: fmt.Sprintf(`"contract" is a file name in this directory (e.g. "openapi.yaml"), not a path — got %q.`, contract)}
		}
		allowed := contractFilesByStyle[style]
		if style == "sdk" {
			allowed = dependencyContractAnyFile
		}
		if !containsString(allowed, contract) {
			return &designProblem{code: ErrSchemaViolation, message: fmt.Sprintf(`"contract" for style %q must be one of %s, got %q.`, style, quoteAll(allowed), contract)}
		}
	}
	if hasSDK {
		if style != "sdk" {
			return &designProblem{code: ErrSchemaViolation, message: fmt.Sprintf(`"sdk" is only meaningful on style "sdk", got style %q.`, style)}
		}
		if sdk != sdkManifestFile {
			return &designProblem{code: ErrSchemaViolation, message: fmt.Sprintf(`"sdk" must be %q (the manifest beside this file), got %q.`, sdkManifestFile, sdk)}
		}
	}
	if style == "sdk" && !hasSDK {
		return &designProblem{code: ErrSchemaViolation, message: fmt.Sprintf(`style "sdk" needs its manifest: write specs/design/dependencies/%s/%s and set "sdk": %q.`, dirName, sdkManifestFile, sdkManifestFile)}
	}
	if assumptionAuthored(obj["assumed"], prior) {
		return &designProblem{code: ErrSchemaViolation, message: `"assumed" is the user's permission record — it is written when the user accepts your proposal on the dependency page, never by you. Leave the field exactly as the file already has it (or omit it), and ask the user to accept the assumption instead.`}
	}
	return nil
}

func validateProvenance(v any) *designProblem {
	if v == nil {
		return nil
	}
	obj, ok := v.(map[string]any)
	if !ok {
		return &designProblem{code: ErrSchemaViolation, message: "provenance: must be an object"}
	}
	for k := range obj {
		if !provenanceKeys[k] {
			return &designProblem{code: ErrSchemaViolation, message: "provenance: unknown property " + k}
		}
	}
	for _, f := range []string{"sourceUrl", "sha256", "fetchedAt"} {
		if fv, present := obj[f]; present {
			if _, ok := fv.(string); !ok {
				return &designProblem{code: ErrSchemaViolation, message: "provenance." + f + ": must be a string"}
			}
		}
	}
	if s, present := obj["sha256"].(string); present && !sha256HexRe.MatchString(s) {
		return &designProblem{code: ErrSchemaViolation, message: "provenance.sha256: a lower-case hex SHA-256"}
	}
	if sv, present := obj["sliced"]; present {
		if _, ok := sv.(bool); !ok {
			return &designProblem{code: ErrSchemaViolation, message: "provenance.sliced: must be a boolean"}
		}
	}
	return nil
}

func validateAssumption(v any) *designProblem {
	if v == nil {
		return nil
	}
	obj, ok := v.(map[string]any)
	if !ok {
		return &designProblem{code: ErrSchemaViolation, message: "assumed: must be an object"}
	}
	for k := range obj {
		if !assumptionKeys[k] {
			return &designProblem{code: ErrSchemaViolation, message: "assumed: unknown property " + k}
		}
	}
	for _, f := range []string{"by", "at"} {
		s, ok := obj[f].(string)
		if !ok || s == "" {
			return &designProblem{code: ErrSchemaViolation, message: "assumed." + f + ": must be a non-empty string"}
		}
	}
	if nv, present := obj["note"]; present {
		if _, ok := nv.(string); !ok {
			return &designProblem{code: ErrSchemaViolation, message: "assumed.note: must be a string"}
		}
	}
	return nil
}

func validateCandidates(v any) *designProblem {
	list, ok := v.([]any)
	if !ok {
		return &designProblem{code: ErrSchemaViolation, message: "candidates: must be an array"}
	}
	if len(list) < 2 {
		return &designProblem{code: ErrSchemaViolation, message: "candidates: 2 or more, or omit the field — a lone option is a provider, not a candidate"}
	}
	for i, c := range list {
		obj, ok := c.(map[string]any)
		if !ok {
			return &designProblem{code: ErrSchemaViolation, message: fmt.Sprintf("candidates[%d]: must be an object", i)}
		}
		for k := range obj {
			if !candidateKeys[k] {
				return &designProblem{code: ErrSchemaViolation, message: fmt.Sprintf("candidates[%d]: unknown property %s", i, k)}
			}
		}
		if n, ok := obj["name"].(string); !ok || n == "" {
			return &designProblem{code: ErrSchemaViolation, message: fmt.Sprintf("candidates[%d].name: must be a non-empty string", i)}
		}
		if s, ok := obj["style"].(string); !ok || !dependencyStyles[s] {
			return &designProblem{code: ErrSchemaViolation, message: fmt.Sprintf("candidates[%d].style: %q is not an allowed value", i, obj["style"])}
		}
	}
	return nil
}

func validateConfigKeys(v any) *designProblem {
	list, ok := v.([]any)
	if !ok {
		return &designProblem{code: ErrSchemaViolation, message: "config: must be an array"}
	}
	for i, c := range list {
		obj, ok := c.(map[string]any)
		if !ok {
			return &designProblem{code: ErrSchemaViolation, message: fmt.Sprintf("config[%d]: must be an object", i)}
		}
		for k := range obj {
			if !configKeyKeys[k] {
				return &designProblem{code: ErrSchemaViolation, message: fmt.Sprintf("config[%d]: unknown property %s", i, k)}
			}
		}
		key, ok := obj["key"].(string)
		if !ok || key == "" {
			return &designProblem{code: ErrSchemaViolation, message: fmt.Sprintf("config[%d].key: must be a non-empty string", i)}
		}
		secret, _ := obj["secret"].(bool)
		if _, hasDefault := obj["defaultValue"]; hasDefault && secret {
			return &designProblem{code: ErrSchemaViolation, message: fmt.Sprintf("config key %q is secret and cannot carry a defaultValue.", key)}
		}
	}
	return nil
}

func validateSdkManifest(content string) *designProblem {
	var parsed any
	if err := json.Unmarshal([]byte(content), &parsed); err != nil {
		return &designProblem{code: ErrInvalidJSON, message: "content is not valid JSON: " + err.Error()}
	}
	obj, ok := parsed.(map[string]any)
	if !ok {
		return &designProblem{code: ErrSchemaViolation, message: "must be an object"}
	}
	for k := range obj {
		if !sdkManifestKeys[k] {
			return &designProblem{code: ErrSchemaViolation, message: "unknown property " + k}
		}
	}
	packages, ok := obj["packages"].(map[string]any)
	if !ok {
		return &designProblem{code: ErrSchemaViolation, message: "packages: must be an object"}
	}
	if len(packages) == 0 {
		return &designProblem{code: ErrSchemaViolation, message: `"packages" needs at least one language → package entry (e.g. "typescript": "npm:stripe@^14").`}
	}
	for lang, pv := range packages {
		pkg, ok := pv.(string)
		if !ok || pkg == "" {
			return &designProblem{code: ErrSchemaViolation, message: "packages." + lang + ": must be a non-empty string"}
		}
		if lang != strings.ToLower(lang) {
			return &designProblem{code: ErrSchemaViolation, message: fmt.Sprintf("language keys are lower-case (%q), got %q.", strings.ToLower(lang), lang)}
		}
		if !packageRefRe.MatchString(pkg) {
			return &designProblem{code: ErrSchemaViolation, message: fmt.Sprintf(`package for %q must be ecosystem-prefixed ("npm:…", "go:…", "pypi:…", "ballerina:…"), got %q.`, lang, pkg)}
		}
	}
	if cv, present := obj["calls"]; present {
		list, ok := cv.([]any)
		if !ok {
			return &designProblem{code: ErrSchemaViolation, message: "calls: must be an array"}
		}
		for i, c := range list {
			if s, ok := c.(string); !ok || s == "" {
				return &designProblem{code: ErrSchemaViolation, message: fmt.Sprintf("calls[%d]: must be a non-empty string", i)}
			}
		}
	}
	return nil
}

// assumptionAuthored mirrors the zod gate's assumptionChanged: the write
// introduces or alters the record relative to the file already there. No
// prior file means the write is authoring it; omitting a record the file has
// is allowed — the platform's own path when a real contract replaces one.
func assumptionAuthored(next any, prior *string) bool {
	if next == nil {
		return false
	}
	if prior == nil {
		return true
	}
	var before map[string]any
	if err := json.Unmarshal([]byte(*prior), &before); err != nil {
		return true
	}
	was, _ := json.Marshal(before["assumed"])
	now, _ := json.Marshal(next)
	return string(was) != string(now)
}

func containsString(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

func quoteAll(list []string) string {
	q := make([]string, 0, len(list))
	for _, x := range list {
		q = append(q, fmt.Sprintf("%q", x))
	}
	return strings.Join(q, ", ")
}
