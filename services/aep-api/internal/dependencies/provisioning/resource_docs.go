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
	"fmt"
	"net/url"
	"strings"
	"unicode/utf8"

	"github.com/wso2/aep/aep-api/internal/clients/openchoreo"
	"github.com/wso2/aep/aep-api/internal/gen"
	"github.com/wso2/aep/aep-api/internal/platform/apierr"
)

// resolveResourceDocs validates write rows and returns catalog pointers.
// File rows call CommitUTF8; URL and keep-path rows never mint the repo.
func (s *Service) resolveResourceDocs(ctx context.Context, orgID, logicalName string, in []gen.ResourceDocWriteDTO) ([]openchoreo.ResourceDoc, error) {
	if len(in) == 0 {
		return nil, nil
	}
	out := make([]openchoreo.ResourceDoc, 0, len(in))
	for i, d := range in {
		doc, err := s.resolveResourceDoc(ctx, orgID, logicalName, i, d)
		if err != nil {
			return nil, err
		}
		out = append(out, doc)
	}
	return out, nil
}

func (s *Service) resolveResourceDoc(ctx context.Context, orgID, logicalName string, i int, d gen.ResourceDocWriteDTO) (openchoreo.ResourceDoc, error) {
	if !d.Type.Valid() {
		return openchoreo.ResourceDoc{}, apierr.BadRequest(fmt.Sprintf("resourceDocs[%d]: unknown type %q", i, d.Type))
	}

	u := strings.TrimSpace(d.URL)
	path := strings.TrimSpace(d.Path)
	fileName := strings.TrimSpace(d.FileName)
	content := d.Content
	fileNameSet := fileName != ""
	contentSet := content != ""
	if fileNameSet != contentSet {
		return openchoreo.ResourceDoc{}, apierr.BadRequest(fmt.Sprintf("resourceDocs[%d]: fileName and content must both be provided", i))
	}

	n := 0
	if u != "" {
		n++
	}
	if path != "" {
		n++
	}
	if fileNameSet {
		n++
	}
	if n != 1 {
		return openchoreo.ResourceDoc{}, apierr.BadRequest(fmt.Sprintf("resourceDocs[%d]: exactly one of url, path, or fileName+content is required", i))
	}

	switch {
	case u != "":
		parsed, perr := url.Parse(u)
		if perr != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
			return openchoreo.ResourceDoc{}, apierr.BadRequest(fmt.Sprintf("resourceDocs[%d]: url must be a valid http or https URL", i))
		}
		return openchoreo.ResourceDoc{Type: string(d.Type), URL: u}, nil
	case path != "":
		if strings.Contains(path, "..") || strings.Contains(path, "\\") {
			return openchoreo.ResourceDoc{}, apierr.BadRequest(fmt.Sprintf("resourceDocs[%d]: path must not contain .. or backslash", i))
		}
		return openchoreo.ResourceDoc{Type: string(d.Type), Path: path}, nil
	default:
		if strings.ContainsAny(fileName, `/\`) || strings.Contains(fileName, "..") {
			return openchoreo.ResourceDoc{}, apierr.BadRequest(fmt.Sprintf("resourceDocs[%d]: fileName must be a single path segment", i))
		}
		if !utf8.ValidString(content) {
			return openchoreo.ResourceDoc{}, apierr.BadRequest(fmt.Sprintf("resourceDocs[%d]: content must be valid UTF-8", i))
		}
		if s.orgResourceDocs == nil {
			return openchoreo.ResourceDoc{}, fmt.Errorf("provisioning: org resource docs store is not configured")
		}
		committed, err := s.orgResourceDocs.CommitUTF8(ctx, orgID, logicalName, fileName, content)
		if err != nil {
			return openchoreo.ResourceDoc{}, fmt.Errorf("provisioning: commit resource doc %q: %w", fileName, err)
		}
		return openchoreo.ResourceDoc{Type: string(d.Type), Path: committed}, nil
	}
}
