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

package provisioning

import (
	"context"
	"crypto/sha256"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	"github.com/wso2/aep/aep-api/internal/gen"
	"github.com/wso2/aep/aep-api/internal/platform/apierr"
	"github.com/wso2/aep/aep-api/internal/spec"
)

// maxContractBytes caps a registered resource's contract document: the same
// 5 MiB the project side accepts for a file (spec.maxFileBytes) and fetches
// (FetchSpecFromURL). A larger document is refused with a message; the admin
// uploads a trimmed one.
const maxContractBytes = 5 << 20

// RegisterExternalResource authors a Registered External resource on the org
// catalog: an OpenChoreo ResourceType (Ensure only — no project Resource
// instance) plus org value-plane cells. Secret bytes are optionally written
// through OrgSecretWriter with projectName "org-catalog"; the returned vault
// key is stored on those cells as SecretStorePath.
func (s *Service) RegisterExternalResource(ctx context.Context, orgID string, req gen.RegisterExternalResourceRequest) (ExternalResourceView, error) {
	name, keys, writes, envNames, valueByEnvKey, err := s.validateRegisterRequest(ctx, orgID, req)
	if err != nil {
		return ExternalResourceView{}, err
	}
	contractWrite, err := validateContractWrite(req.Contract)
	if err != nil {
		return ExternalResourceView{}, err
	}

	if s.rtCatalog == nil {
		return ExternalResourceView{}, fmt.Errorf("provisioning: external RT catalog is not configured")
	}
	existing, err := s.rtCatalog.List(ctx, orgID)
	if err != nil {
		return ExternalResourceView{}, fmt.Errorf("provisioning: list external resources: %w", err)
	}
	for _, def := range existing {
		if strings.EqualFold(def.Name, name) {
			return ExternalResourceView{}, apierr.Conflict("external resource " + name + " is already registered")
		}
	}

	docs, err := s.commitResourceDocs(ctx, orgID, name, writes)
	if err != nil {
		return ExternalResourceView{}, err
	}
	contract, provenance, err := s.commitResourceContract(ctx, orgID, name, contractWrite)
	if err != nil {
		return ExternalResourceView{}, err
	}
	rt, err := openchoreo.BuildExternalResourceType(openchoreo.ExternalResourceTypeSpec{
		Name:                    name,
		Description:             strings.TrimSpace(req.Description),
		Keys:                    keys,
		Scope:                   openchoreo.ExternalResourceScopeOrg,
		Provider:                strings.TrimSpace(req.Provider),
		Contract:                contract,
		Provenance:              provenance,
		ConsumptionInstructions: strings.TrimSpace(req.ConsumptionInstructions),
		ResourceDocs:            docs,
	})
	if err != nil {
		return ExternalResourceView{}, apierr.BadRequest(err.Error())
	}

	cells := make([]EnvCell, 0, len(keys)*len(envNames))
	for _, env := range envNames {
		for _, k := range keys {
			cell := EnvCell{
				Environment: env,
				Key:         k.Key,
				Status:      "configured",
				Value:       valueByEnvKey[envValueKey(env, k.Key)],
			}
			cells = append(cells, cell)
		}
	}
	vaultByEnv := map[string]string{}
	if s.orgSecrets != nil {
		for _, env := range envNames {
			secrets := map[string]string{}
			for _, k := range keys {
				if k.Secret {
					secrets[k.Key] = valueByEnvKey[envValueKey(env, k.Key)]
				}
			}
			if len(secrets) == 0 {
				continue
			}
			vaultKey, err := s.orgSecrets.WriteOrgCatalogSecret(ctx, orgID, name+"-"+env, secrets)
			if err != nil {
				return ExternalResourceView{}, fmt.Errorf("provisioning: write org-catalog secret %q: %w", name+"-"+env, err)
			}
			vaultByEnv[env] = vaultKey
		}
	}
	stampSecretStorePath(cells, vaultByEnv)
	if s.catalogValuePlane != nil {
		s.catalogValuePlane.PutEnvCells(orgID, name, cells)
	}
	// Ensure last: List treats the name as registered only after the RT exists.
	// A failed Ensure must not 409 a retry solely because cells/secrets already landed.
	if err := s.rtCatalog.Ensure(ctx, orgID, rt); err != nil {
		return ExternalResourceView{}, fmt.Errorf("provisioning: ensure external resource type %q: %w", name, err)
	}

	return ExternalResourceView{
		Name:                    name,
		Description:             strings.TrimSpace(req.Description),
		Provider:                strings.TrimSpace(req.Provider),
		Config:                  toConfigKeys(keys),
		Contract:                contract,
		Provenance:              provenance,
		Scope:                   openchoreo.ExternalResourceScopeOrg,
		ConsumptionInstructions: strings.TrimSpace(req.ConsumptionInstructions),
		EnvCells:                cells,
		ResourceDocs:            docs,
	}, nil
}

// contractWrite is one validated contract-document write: a URL to fetch, or
// a file name plus content to commit. Type is the document's kind.
type contractWrite struct {
	Type     string
	URL      string
	FileName string
	Content  string
}

// validateContractWrite is the pure validator for the register/update
// `contract` field: a type, and exactly one of url or fileName+content. A
// nil field is allowed (a provider that publishes no document) and yields
// nil.
func validateContractWrite(in *gen.ResourceContractWriteDTO) (*contractWrite, error) {
	if in == nil {
		return nil, nil
	}
	t := strings.TrimSpace(string(in.Type))
	if _, ok := resourceContractTypes[t]; !ok {
		return nil, apierr.BadRequest(fmt.Sprintf("contract: unknown type %q", in.Type))
	}
	u, fileName, content := strings.TrimSpace(in.URL), strings.TrimSpace(in.FileName), in.Content
	fileNameSet, contentSet := fileName != "", content != ""
	if fileNameSet != contentSet {
		return nil, apierr.BadRequest("contract: fileName and content must both be provided")
	}
	if (u != "") == fileNameSet {
		return nil, apierr.BadRequest("contract: exactly one of url, or fileName+content, is required")
	}
	if u != "" {
		return &contractWrite{Type: t, URL: u}, nil
	}
	if strings.ContainsAny(fileName, `/\`) || strings.Contains(fileName, "..") {
		return nil, apierr.BadRequest("contract: fileName must be a single path segment")
	}
	if !utf8.ValidString(content) {
		return nil, apierr.BadRequest("contract: content must be valid UTF-8")
	}
	if len(content) > maxContractBytes {
		return nil, apierr.BadRequest("contract: the document is larger than 5 MiB — upload a trimmed one")
	}
	return &contractWrite{Type: t, FileName: fileName, Content: content}, nil
}

// resourceContractTypes is the ResourceContractWriteDTO.type enum.
var resourceContractTypes = map[string]struct{}{
	"openapi": {}, "graphql": {}, "sdk": {}, "asyncapi": {}, "protobuf": {}, "documentation": {},
}

// commitResourceContract lands the resource's contract document in the org
// docs repo and returns the record's `{type, path}` pointer plus provenance.
// A URL is fetched by the platform (https only, public hosts only, 5 MiB cap
// — spec.FetchSpecFromURL's guards) and kept only as provenance: the record
// never points at the internet. A nil write yields nil, nil.
func (s *Service) commitResourceContract(ctx context.Context, orgID, logicalName string, w *contractWrite) (*openchoreo.ResourceContractPointer, *openchoreo.ResourceRecordProvenance, error) {
	if w == nil {
		return nil, nil, nil
	}
	if s.orgResourceDocs == nil {
		return nil, nil, fmt.Errorf("provisioning: org resource docs store is not configured")
	}
	content, fileName, sourceURL := w.Content, w.FileName, ""
	if w.URL != "" {
		fetched, err := spec.FetchSpecFromURL(ctx, w.URL)
		if err != nil {
			return nil, nil, apierr.BadRequest("contract: could not fetch the document: " + err.Error())
		}
		if !utf8.Valid(fetched) {
			return nil, nil, apierr.BadRequest("contract: the fetched document is not valid UTF-8")
		}
		content, sourceURL = string(fetched), w.URL
		fileName = defaultContractFileName(w.Type)
	}
	path, err := s.orgResourceDocs.CommitUTF8(ctx, orgID, logicalName, fileName, content)
	if err != nil {
		return nil, nil, fmt.Errorf("provisioning: commit contract %q: %w", fileName, err)
	}
	sum := sha256.Sum256([]byte(content))
	return &openchoreo.ResourceContractPointer{Type: w.Type, Path: path},
		&openchoreo.ResourceRecordProvenance{SourceURL: sourceURL, SHA256: fmt.Sprintf("%x", sum), ReadOn: time.Now().UTC().Format(time.RFC3339)},
		nil
}

// defaultContractFileName names a fetched document by its type, the way the
// project side names its own contract files.
func defaultContractFileName(contractType string) string {
	switch contractType {
	case "graphql":
		return "schema.graphql"
	case "sdk":
		return "sdk.json"
	case "asyncapi":
		return "asyncapi.yaml"
	case "protobuf":
		return "service.proto"
	case "documentation":
		return "documentation.md"
	default:
		return "openapi.yaml"
	}
}

func (s *Service) validateRegisterRequest(ctx context.Context, orgID string, req gen.RegisterExternalResourceRequest) (
	name string,
	keys []openchoreo.ExternalResourceConfigKey,
	writes []resourceDocWrite,
	envNames []string,
	valueByEnvKey map[string]string,
	err error,
) {
	name = strings.TrimSpace(req.Name)
	if name == "" {
		return "", nil, nil, nil, nil, apierr.BadRequest("name is required")
	}
	if strings.TrimSpace(req.Description) == "" {
		return "", nil, nil, nil, nil, apierr.BadRequest("description is required")
	}
	if strings.TrimSpace(req.ConsumptionInstructions) == "" {
		return "", nil, nil, nil, nil, apierr.BadRequest("consumptionInstructions is required")
	}
	if strings.TrimSpace(req.Provider) == "" {
		return "", nil, nil, nil, nil, apierr.BadRequest("provider is required")
	}
	if len(req.Config) == 0 {
		return "", nil, nil, nil, nil, apierr.BadRequest("config must have at least one key")
	}
	keys = make([]openchoreo.ExternalResourceConfigKey, 0, len(req.Config))
	for i, k := range req.Config {
		key := strings.TrimSpace(k.Key)
		if key == "" {
			return "", nil, nil, nil, nil, apierr.BadRequest(fmt.Sprintf("config[%d]: key is required", i))
		}
		if strings.TrimSpace(k.Description) == "" {
			return "", nil, nil, nil, nil, apierr.BadRequest(fmt.Sprintf("config key %q: description is required", key))
		}
		keys = append(keys, openchoreo.ExternalResourceConfigKey{
			Key:          key,
			Secret:       k.Secret,
			Description:  strings.TrimSpace(k.Description),
			DefaultValue: k.DefaultValue,
		})
	}

	writes, err = validateResourceDocWrites(req.ResourceDocs)
	if err != nil {
		return "", nil, nil, nil, nil, err
	}

	envNames, err = s.ListOrgEnvironments(ctx, orgID)
	if err != nil {
		return "", nil, nil, nil, nil, err
	}

	valueByEnvKey = make(map[string]string, len(req.EnvValues))
	for _, row := range req.EnvValues {
		env, key := strings.TrimSpace(row.Environment), strings.TrimSpace(row.Key)
		if env == "" || key == "" {
			continue
		}
		valueByEnvKey[envValueKey(env, key)] = row.Value
	}
	for _, env := range envNames {
		for _, k := range keys {
			val, ok := valueByEnvKey[envValueKey(env, k.Key)]
			if !ok || strings.TrimSpace(val) == "" {
				return "", nil, nil, nil, nil, apierr.BadRequest(fmt.Sprintf("missing env value for key %q in environment %q", k.Key, env))
			}
		}
	}
	return name, keys, writes, envNames, valueByEnvKey, nil
}

func envValueKey(env, key string) string {
	return env + "\x00" + key
}
