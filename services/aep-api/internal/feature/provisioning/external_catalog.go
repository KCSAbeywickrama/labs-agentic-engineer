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

	"github.com/wso2/aep/aep-api/models"
	"github.com/wso2/aep/aep-api/repositories"
)

// ExternalResourceView is one org external-resource catalog entry with its
// config schema and current consumers (the in-use delete guard input). Values
// are never included — the catalog holds schema + references only.
type ExternalResourceView struct {
	Name        string
	Description string
	Config      []models.ConfigKey
	Consumers   []repositories.ExternalResourceConsumer
}

// ListExternalResources returns the org's external-resource catalog with each
// entry's consumers (the components across the org whose design declares an
// external dependency of that name).
func (s *Service) ListExternalResources(ctx context.Context, orgID string) ([]ExternalResourceView, error) {
	list, err := s.catalog.List(ctx, orgID)
	if err != nil {
		return nil, fmt.Errorf("provisioning: list external resources: %w", err)
	}
	out := make([]ExternalResourceView, 0, len(list))
	for i := range list {
		er := &list[i]
		consumers, cerr := s.catalog.Consumers(ctx, orgID, er.Name)
		if cerr != nil {
			return nil, fmt.Errorf("provisioning: list consumers of %q: %w", er.Name, cerr)
		}
		out = append(out, ExternalResourceView{
			Name:        er.Name,
			Description: er.Description,
			Config:      er.ConfigKeys,
			Consumers:   consumers,
		})
	}
	return out, nil
}

// DeleteExternalResource removes an org external-resource catalog entry. It is
// guarded: a resource with consumers returns ErrExternalResourceInUse (→ 409).
func (s *Service) DeleteExternalResource(ctx context.Context, orgID, name string) error {
	consumers, err := s.catalog.Consumers(ctx, orgID, name)
	if err != nil {
		return fmt.Errorf("provisioning: check consumers of %q: %w", name, err)
	}
	if len(consumers) > 0 {
		return ErrExternalResourceInUse
	}
	return s.catalog.Delete(ctx, orgID, name)
}
