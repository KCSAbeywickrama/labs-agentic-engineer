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
	"errors"
	"testing"
)

func pipelineOf(paths ...[2]any) *deploymentPipeline {
	p := &deploymentPipeline{}
	for _, path := range paths {
		src := path[0].(string)
		var tgts []string
		if path[1] != nil {
			tgts = path[1].([]string)
		}
		entry := struct {
			SourceEnvironmentRef struct {
				Name string `json:"name"`
			} `json:"sourceEnvironmentRef"`
			TargetEnvironmentRefs []struct {
				Name string `json:"name"`
			} `json:"targetEnvironmentRefs"`
		}{}
		entry.SourceEnvironmentRef.Name = src
		for _, t := range tgts {
			entry.TargetEnvironmentRefs = append(entry.TargetEnvironmentRefs, struct {
				Name string `json:"name"`
			}{Name: t})
		}
		p.Spec.PromotionPaths = append(p.Spec.PromotionPaths, entry)
	}
	return p
}

func TestPipelineRoot(t *testing.T) {
	cases := []struct {
		name    string
		p       *deploymentPipeline
		want    string
		wantErr error
	}{
		{"k3d quickstart chain", pipelineOf([2]any{"development", []string{"staging"}}, [2]any{"staging", []string{"production"}}), "development", nil},
		{"chain listed out of order", pipelineOf([2]any{"staging", []string{"production"}}, [2]any{"development", []string{"staging"}}), "development", nil},
		{"single source, no targets", pipelineOf([2]any{"default", nil}), "default", nil},
		{"two roots: first in list order wins", pipelineOf([2]any{"dev-b", []string{"prod"}}, [2]any{"dev-a", []string{"prod"}}), "dev-b", nil},
		{"cyclic", pipelineOf([2]any{"a", []string{"b"}}, [2]any{"b", []string{"a"}}), "", ErrPipelineCyclic},
		{"self edge", pipelineOf([2]any{"default", []string{"default"}}), "", ErrPipelineCyclic},
		{"no promotion paths", &deploymentPipeline{}, "", ErrPipelineEmpty},
		{"nil pipeline", nil, "", ErrPipelineEmpty},
		{"only empty sources", pipelineOf([2]any{"", []string{"staging"}}), "", ErrPipelineCyclic},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := PipelineRoot("default", tc.p)
			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Fatalf("err = %v, want %v", err, tc.wantErr)
				}
				return
			}
			if err != nil || got != tc.want {
				t.Fatalf("PipelineRoot = (%q, %v), want (%q, nil)", got, err, tc.want)
			}
		})
	}
}
